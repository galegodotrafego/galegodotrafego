-- Apply in staging first. No existing rows are modified by this migration.
BEGIN;

-- Profiles are created by the Auth trigger, never by an untrusted browser.
-- The old INSERT policy allowed an orphaned Auth user to choose a tenant/role.
DROP POLICY IF EXISTS profiles_insert ON public.profiles;

-- Direct tenant updates may rename an account, but ownership changes must
-- go through the authorized SECURITY DEFINER transfer RPC.
CREATE OR REPLACE FUNCTION public.enforce_account_owner_column()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
     AND current_user = 'authenticated' THEN
    RAISE EXCEPTION 'Use transfer_account_ownership to change owner'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION public.enforce_account_owner_column() OWNER TO postgres;
DROP TRIGGER IF EXISTS enforce_account_owner_column ON public.accounts;
CREATE TRIGGER enforce_account_owner_column BEFORE UPDATE ON public.accounts
FOR EACH ROW EXECUTE FUNCTION public.enforce_account_owner_column();

-- Auth + account + profile bootstrap must succeed or roll back together.
-- Previously a swallowed exception could leave a valid login without a tenant.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_full_name TEXT;
  v_account_id UUID;
BEGIN
  v_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', '');

  INSERT INTO public.accounts (name, owner_user_id)
  VALUES (COALESCE(NULLIF(v_full_name, ''), NEW.email, 'My account'), NEW.id)
  RETURNING id INTO v_account_id;

  INSERT INTO public.profiles (user_id, full_name, email, account_id, account_role)
  VALUES (NEW.id, v_full_name, NEW.email, v_account_id, 'owner');

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.handle_new_user() OWNER TO postgres;


COMMIT;
