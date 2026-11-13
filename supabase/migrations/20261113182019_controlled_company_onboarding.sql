-- Only the server may reserve a new company. Public signup can redeem a
-- valid invitation, but cannot choose a tenant or create a new company.
CREATE TABLE public.company_provisioning_requests (
  id uuid PRIMARY KEY,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  company_name text NOT NULL,
  owner_name text NOT NULL,
  owner_email text NOT NULL UNIQUE CHECK (owner_email = lower(owner_email)),
  plan_id uuid NOT NULL,
  requested_by uuid NOT NULL REFERENCES auth.users(id),
  user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE RESTRICT,
  account_id uuid UNIQUE REFERENCES public.accounts(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
ALTER TABLE public.company_provisioning_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.company_provisioning_requests FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.company_provisioning_requests TO service_role;

CREATE FUNCTION public.reserve_company_provisioning(
  p_id uuid, p_hash text, p_company text, p_name text, p_email text,
  p_plan uuid, p_actor uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE r public.company_provisioning_requests%ROWTYPE;
BEGIN
  INSERT INTO public.company_provisioning_requests(id,payload_hash,company_name,owner_name,owner_email,plan_id,requested_by)
  VALUES(p_id,p_hash,p_company,p_name,lower(p_email),p_plan,p_actor)
  ON CONFLICT(id) DO NOTHING;
  SELECT * INTO STRICT r FROM public.company_provisioning_requests WHERE id=p_id;
  IF r.payload_hash <> p_hash THEN
    RAISE EXCEPTION 'Idempotency key reused for different request' USING ERRCODE='23505';
  END IF;
  RETURN to_jsonb(r);
END $$;
REVOKE ALL ON FUNCTION public.reserve_company_provisioning(uuid,text,text,text,text,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_company_provisioning(uuid,text,text,text,text,uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE
  r public.company_provisioning_requests%ROWTYPE;
  inv public.account_invitations%ROWTYPE;
  account uuid;
  request_id text := NEW.raw_app_meta_data->>'provisioning_request_id';
  invite_token text := NEW.raw_user_meta_data->>'invitation_token';
BEGIN
  IF request_id IS NOT NULL THEN
    SELECT * INTO r FROM public.company_provisioning_requests WHERE id=request_id::uuid FOR UPDATE;
    IF NOT FOUND OR r.owner_email <> lower(NEW.email) OR r.user_id IS NOT NULL THEN
      RAISE EXCEPTION 'Invalid provisioning reservation' USING ERRCODE='42501';
    END IF;
    INSERT INTO public.accounts(name,owner_user_id) VALUES(r.company_name,NEW.id) RETURNING id INTO account;
    INSERT INTO public.profiles(user_id,full_name,email,account_id,account_role)
    VALUES(NEW.id,r.owner_name,NEW.email,account,'owner');
    UPDATE public.company_provisioning_requests SET user_id=NEW.id,account_id=account WHERE id=r.id;
  ELSE
    -- This metadata is an untrusted bearer credential, NOT an authorization
    -- claim: hash it and validate the single-use DB invitation under a lock.
    IF invite_token IS NULL OR invite_token !~ '^[A-Za-z0-9_-]{43}$' THEN
      RAISE EXCEPTION 'An invitation is required' USING ERRCODE='42501';
    END IF;
    SELECT * INTO inv FROM public.account_invitations
      WHERE token_hash=encode(digest(invite_token,'sha256'),'hex') FOR UPDATE;
    IF NOT FOUND OR inv.accepted_at IS NOT NULL OR inv.expires_at <= now() THEN
      RAISE EXCEPTION 'Invalid or expired invitation' USING ERRCODE='42501';
    END IF;
    INSERT INTO public.profiles(user_id,full_name,email,account_id,account_role)
    VALUES(NEW.id,left(coalesce(NEW.raw_user_meta_data->>'full_name',''),80),NEW.email,inv.account_id,inv.role);
    UPDATE public.account_invitations SET accepted_at=now(),accepted_by_user_id=NEW.id WHERE id=inv.id;
    -- Do not retain the raw invitation credential in user-editable metadata.
    UPDATE auth.users SET raw_user_meta_data=raw_user_meta_data-'invitation_token' WHERE id=NEW.id;
  END IF;
  RETURN NEW;
END $$;
ALTER FUNCTION public.handle_new_user() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC,anon,authenticated;
