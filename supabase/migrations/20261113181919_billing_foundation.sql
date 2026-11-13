-- Billing is sandbox-only until an explicitly reviewed real provider is integrated.
CREATE TABLE public.billing_plans (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL CHECK(length(name) BETWEEN 1 AND 100),
 amount_cents integer NOT NULL CHECK(amount_cents >= 0), currency text NOT NULL DEFAULT 'BRL' CHECK(currency='BRL'),
 limits jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(limits)='object'), features text[] NOT NULL DEFAULT '{}',
 grace_days integer NOT NULL DEFAULT 0 CHECK(grace_days BETWEEN 0 AND 30), active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.account_subscriptions (
 account_id uuid PRIMARY KEY REFERENCES public.accounts ON DELETE CASCADE,
 plan_id uuid NOT NULL REFERENCES public.billing_plans,
 status text NOT NULL CHECK(status IN ('trialing','active','past_due','suspended','canceled')),
 current_period_start timestamptz NOT NULL, current_period_end timestamptz NOT NULL,
 grace_until timestamptz, cancel_at_period_end boolean NOT NULL DEFAULT false,
 manual_suspended boolean NOT NULL DEFAULT false, provider text NOT NULL DEFAULT 'sandbox' CHECK(provider='sandbox'),
 version integer NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(current_period_end > current_period_start)
);
CREATE TABLE public.billing_invoices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL REFERENCES public.accounts ON DELETE CASCADE,
 plan_id uuid NOT NULL REFERENCES public.billing_plans, subscription_version integer NOT NULL,
 period_start timestamptz NOT NULL, period_end timestamptz NOT NULL,
 amount_cents integer NOT NULL CHECK(amount_cents>=0), currency text NOT NULL DEFAULT 'BRL' CHECK(currency='BRL'),
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','paid','void')),
 paid_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(account_id,period_start), CHECK(period_end>period_start)
);
CREATE INDEX billing_invoices_account_created ON public.billing_invoices(account_id,created_at DESC);
CREATE TABLE public.billing_events (
 provider text NOT NULL CHECK(provider='sandbox'), event_id text NOT NULL CHECK(length(event_id) BETWEEN 1 AND 200),
 payload_hash text NOT NULL, invoice_id uuid NOT NULL REFERENCES public.billing_invoices,
 outcome text NOT NULL, processed_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(provider,event_id)
);
CREATE TABLE public.billing_requests (
 request_key text PRIMARY KEY CHECK(length(request_key) BETWEEN 8 AND 200), payload jsonb NOT NULL,
 response jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.billing_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, actor_id uuid, account_id uuid REFERENCES public.accounts ON DELETE SET NULL,
 action text NOT NULL, details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
-- Deliberately independent of entitlement: suspended owners must read invoices to recover.
CREATE FUNCTION public.billing_can_read(p_account uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM public.profiles WHERE user_id=auth.uid() AND account_id=p_account)
$$;
REVOKE ALL ON FUNCTION public.billing_can_read(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.billing_can_read(uuid) TO authenticated,service_role;
ALTER TABLE public.billing_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_plans,public.account_subscriptions,public.billing_invoices,public.billing_events,public.billing_requests,public.billing_audit FROM anon,authenticated;
GRANT SELECT ON public.billing_plans,public.account_subscriptions,public.billing_invoices TO authenticated;
GRANT ALL ON public.billing_plans,public.account_subscriptions,public.billing_invoices,public.billing_events,public.billing_requests,public.billing_audit TO service_role;
GRANT USAGE,SELECT ON SEQUENCE public.billing_audit_id_seq TO service_role;
CREATE POLICY billing_plan_read ON public.billing_plans FOR SELECT TO authenticated USING (
 EXISTS(SELECT 1 FROM public.account_subscriptions s WHERE s.plan_id=id AND public.billing_can_read(s.account_id))
);
CREATE POLICY billing_subscription_read ON public.account_subscriptions FOR SELECT TO authenticated USING(public.billing_can_read(account_id));
CREATE POLICY billing_invoice_read ON public.billing_invoices FOR SELECT TO authenticated USING(public.billing_can_read(account_id));

CREATE FUNCTION public.billing_start_subscription(p_account uuid,p_plan uuid,p_key text,p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE p billing_plans; s account_subscriptions; i billing_invoices; existing billing_requests; result jsonb; args jsonb;
BEGIN
 IF length(p_key) NOT BETWEEN 8 AND 200 OR p_key IS NULL THEN RAISE EXCEPTION 'Invalid idempotency key' USING ERRCODE='22023'; END IF;
 args:=jsonb_build_object('account',p_account,'plan',p_plan,'actor',p_actor);
 PERFORM pg_advisory_xact_lock(hashtextextended(p_key,0));
 SELECT * INTO existing FROM billing_requests WHERE request_key=p_key;
 IF FOUND THEN
  IF existing.payload<>args THEN RAISE EXCEPTION 'Idempotency conflict' USING ERRCODE='23505'; END IF;
  RETURN existing.response;
 END IF;
 PERFORM 1 FROM accounts WHERE id=p_account FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Account missing' USING ERRCODE='22023'; END IF;
 SELECT * INTO p FROM billing_plans WHERE id=p_plan AND active;
 IF NOT FOUND THEN RAISE EXCEPTION 'Plan unavailable' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM account_subscriptions WHERE account_id=p_account) THEN RAISE EXCEPTION 'Subscription already exists' USING ERRCODE='23505'; END IF;
 INSERT INTO account_subscriptions(account_id,plan_id,status,current_period_start,current_period_end)
 VALUES(p_account,p_plan,'past_due',now(),now()+interval '1 month') RETURNING * INTO s;
 INSERT INTO billing_invoices(account_id,plan_id,subscription_version,period_start,period_end,amount_cents)
 VALUES(p_account,p_plan,s.version,s.current_period_start,s.current_period_end,p.amount_cents) RETURNING * INTO i;
 result:=jsonb_build_object('subscription',to_jsonb(s),'invoice',to_jsonb(i));
 INSERT INTO billing_requests VALUES(p_key,args,result,now());
 INSERT INTO billing_audit(actor_id,account_id,action,details) VALUES(p_actor,p_account,'subscription.created',jsonb_build_object('plan_id',p_plan,'invoice_id',i.id));
 RETURN result;
END $$;

CREATE FUNCTION public.billing_subscription_action(p_account uuid,p_action text,p_actor uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s account_subscriptions; p billing_plans; i billing_invoices;
BEGIN
 SELECT * INTO s FROM account_subscriptions WHERE account_id=p_account FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Subscription missing' USING ERRCODE='22023'; END IF;
 CASE p_action
 WHEN 'suspend' THEN UPDATE account_subscriptions SET manual_suspended=true WHERE account_id=p_account;
 WHEN 'resume' THEN UPDATE account_subscriptions SET manual_suspended=false WHERE account_id=p_account;
 WHEN 'cancel' THEN UPDATE account_subscriptions SET cancel_at_period_end=true WHERE account_id=p_account;
 WHEN 'uncancel' THEN
  IF s.status='canceled' THEN RAISE EXCEPTION 'Use reactivate after cancellation' USING ERRCODE='22023'; END IF;
  UPDATE account_subscriptions SET cancel_at_period_end=false WHERE account_id=p_account;
 WHEN 'reactivate' THEN
  IF s.status<>'canceled' THEN RAISE EXCEPTION 'Only canceled subscriptions can reactivate' USING ERRCODE='22023'; END IF;
  SELECT * INTO p FROM billing_plans WHERE id=s.plan_id AND active;
  IF NOT FOUND THEN RAISE EXCEPTION 'Plan unavailable' USING ERRCODE='22023'; END IF;
  UPDATE account_subscriptions SET status='past_due',cancel_at_period_end=false,current_period_start=now(),current_period_end=now()+interval '1 month',grace_until=NULL,version=version+1 WHERE account_id=p_account RETURNING * INTO s;
  INSERT INTO billing_invoices(account_id,plan_id,subscription_version,period_start,period_end,amount_cents)
  VALUES(p_account,s.plan_id,s.version,s.current_period_start,s.current_period_end,p.amount_cents);
 ELSE RAISE EXCEPTION 'Unknown action' USING ERRCODE='22023';
 END CASE;
 UPDATE account_subscriptions SET updated_at=now() WHERE account_id=p_account RETURNING * INTO s;
 INSERT INTO billing_audit(actor_id,account_id,action) VALUES(p_actor,p_account,'subscription.'||p_action);
 RETURN to_jsonb(s);
END $$;

CREATE FUNCTION public.billing_apply_event(p_event text,p_hash text,p_invoice uuid,p_amount integer,p_outcome text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE e billing_events; i billing_invoices; s account_subscriptions;
BEGIN
 IF p_outcome NOT IN ('paid','failed') OR p_outcome IS NULL THEN RAISE EXCEPTION 'Invalid outcome' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('sandbox:'||p_event,0));
 SELECT * INTO e FROM billing_events WHERE provider='sandbox' AND event_id=p_event;
 IF FOUND THEN
  IF e.payload_hash<>p_hash THEN RAISE EXCEPTION 'Event conflict' USING ERRCODE='23505'; END IF;
  RETURN jsonb_build_object('duplicate',true);
 END IF;
 -- Lock subscription first consistently with reconciliation, then invoice.
 SELECT * INTO i FROM billing_invoices WHERE id=p_invoice;
 IF NOT FOUND OR i.amount_cents<>p_amount THEN RAISE EXCEPTION 'Invoice mismatch' USING ERRCODE='22023'; END IF;
 SELECT * INTO s FROM account_subscriptions WHERE account_id=i.account_id FOR UPDATE;
 SELECT * INTO i FROM billing_invoices WHERE id=p_invoice FOR UPDATE;
 IF p_outcome='paid' AND i.status='open' THEN
  UPDATE billing_invoices SET status='paid',paid_at=now() WHERE id=i.id;
  IF s.status<>'canceled' AND s.version=i.subscription_version AND i.period_end>now() THEN
   UPDATE account_subscriptions SET status='active',current_period_start=i.period_start,current_period_end=i.period_end,grace_until=NULL,updated_at=now() WHERE account_id=i.account_id;
  END IF;
 END IF;
 -- A late failure never reverses a confirmed payment. Failure grants no access.
 INSERT INTO billing_events(provider,event_id,payload_hash,invoice_id,outcome) VALUES('sandbox',p_event,p_hash,p_invoice,p_outcome);
 INSERT INTO billing_audit(account_id,action,details) VALUES(i.account_id,'invoice.'||p_outcome,jsonb_build_object('invoice_id',i.id,'event_id',p_event));
 RETURN jsonb_build_object('duplicate',false);
END $$;

CREATE FUNCTION public.billing_reconcile() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s account_subscriptions; p billing_plans; n integer:=0;
BEGIN
 FOR s IN SELECT * FROM account_subscriptions WHERE status IN ('active','trialing') AND current_period_end<=now() FOR UPDATE SKIP LOCKED LOOP
  IF s.cancel_at_period_end THEN
   UPDATE account_subscriptions SET status='canceled',grace_until=NULL,updated_at=now() WHERE account_id=s.account_id;
  ELSE
   SELECT * INTO p FROM billing_plans WHERE id=s.plan_id;
   INSERT INTO billing_invoices(account_id,plan_id,subscription_version,period_start,period_end,amount_cents)
   VALUES(s.account_id,s.plan_id,s.version,s.current_period_end,s.current_period_end+interval '1 month',p.amount_cents)
   ON CONFLICT(account_id,period_start) DO NOTHING;
   UPDATE account_subscriptions SET status='past_due',grace_until=s.current_period_end+make_interval(days=>p.grace_days),updated_at=now() WHERE account_id=s.account_id;
  END IF;
  n:=n+1;
 END LOOP;
 RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.billing_start_subscription(uuid,uuid,text,uuid),public.billing_subscription_action(uuid,text,uuid),public.billing_apply_event(text,text,uuid,integer,text),public.billing_reconcile() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.billing_start_subscription(uuid,uuid,text,uuid),public.billing_subscription_action(uuid,text,uuid),public.billing_apply_event(text,text,uuid,integer,text),public.billing_reconcile() TO service_role;
