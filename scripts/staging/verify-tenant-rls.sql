-- Staging-only fixtures. Execute inside BEGIN/ROLLBACK; never against production.
-- Uses real authenticated PostgreSQL role + JWT subject, not privileged reads
-- for the operations being tested. Requires the six example.test fixtures.
DO $$
DECLARE
  tenant record;
  actor record;
  target record;
  contact uuid;
  conversation uuid;
  message uuid;
  pipeline uuid;
  stage uuid;
  deal uuid;
  n integer;
  checks integer := 0;
  fixtures jsonb := '[]';
BEGIN
  IF (SELECT count(*) FROM accounts WHERE name IN
      ('Empresa A - Homologacao','Empresa B - Homologacao')) <> 2 THEN
    RAISE EXCEPTION 'Exclusive staging fixtures are required';
  END IF;
  FOR tenant IN SELECT a.id, p.user_id FROM accounts a JOIN profiles p
    ON p.account_id=a.id AND p.account_role='owner'
    WHERE a.name IN ('Empresa A - Homologacao','Empresa B - Homologacao')
      AND p.email LIKE '%@example.test'
  LOOP
    PERFORM set_config('request.jwt.claim.sub',tenant.user_id::text,true);
    PERFORM set_config('request.jwt.claims',json_build_object('sub',tenant.user_id,'role','authenticated')::text,true);
    SET LOCAL ROLE authenticated;
    INSERT INTO contacts(account_id,user_id,name,phone)
      VALUES(tenant.id,tenant.user_id,'SQL staging fixture',gen_random_uuid()::text) RETURNING id INTO contact;
    INSERT INTO conversations(account_id,user_id,contact_id)
      VALUES(tenant.id,tenant.user_id,contact) RETURNING id INTO conversation;
    INSERT INTO messages(conversation_id,sender_type,content_text)
      VALUES(conversation,'agent','SQL staging fixture') RETURNING id INTO message;
    INSERT INTO pipelines(account_id,user_id,name)
      VALUES(tenant.id,tenant.user_id,'SQL staging fixture') RETURNING id INTO pipeline;
    INSERT INTO pipeline_stages(pipeline_id,name,position)
      VALUES(pipeline,'Initial',0) RETURNING id INTO stage;
    INSERT INTO deals(account_id,user_id,pipeline_id,stage_id,contact_id,conversation_id,title)
      VALUES(tenant.id,tenant.user_id,pipeline,stage,contact,conversation,'SQL staging fixture') RETURNING id INTO deal;
    RESET ROLE;
    fixtures := fixtures || jsonb_build_array(jsonb_build_object(
      'account',tenant.id,'contacts',contact,'conversations',conversation,
      'messages',message,'pipelines',pipeline,'pipeline_stages',stage,'deals',deal));
  END LOOP;
  IF jsonb_array_length(fixtures) <> 2 THEN RAISE EXCEPTION 'Missing fixture owners'; END IF;
  FOR actor IN SELECT p.user_id,p.account_id FROM profiles p JOIN accounts a ON a.id=p.account_id
    WHERE a.name IN ('Empresa A - Homologacao','Empresa B - Homologacao')
      AND p.email LIKE '%@example.test' AND p.account_role IN ('owner','agent')
  LOOP
    FOR target IN SELECT kv.key AS tbl, kv.value::uuid AS id
      FROM jsonb_array_elements(fixtures) f, LATERAL jsonb_each_text(f) kv
      WHERE f->>'account' <> actor.account_id::text AND kv.key <> 'account'
    LOOP
      PERFORM set_config('request.jwt.claim.sub',actor.user_id::text,true);
      PERFORM set_config('request.jwt.claims',json_build_object('sub',actor.user_id,'role','authenticated')::text,true);
      SET LOCAL ROLE authenticated;
      EXECUTE format('SELECT count(*) FROM public.%I WHERE id=$1',target.tbl) INTO n USING target.id;
      IF n <> 0 THEN RAISE EXCEPTION 'Cross-tenant read on %',target.tbl; END IF;
      EXECUTE format('UPDATE public.%I SET id=id WHERE id=$1',target.tbl) USING target.id;
      GET DIAGNOSTICS n = ROW_COUNT;
      IF n <> 0 THEN RAISE EXCEPTION 'Cross-tenant update on %',target.tbl; END IF;
      EXECUTE format('DELETE FROM public.%I WHERE id=$1',target.tbl) USING target.id;
      GET DIAGNOSTICS n = ROW_COUNT;
      IF n <> 0 THEN RAISE EXCEPTION 'Cross-tenant delete on %',target.tbl; END IF;
      RESET ROLE;
      EXECUTE format('SELECT count(*) FROM public.%I WHERE id=$1',target.tbl) INTO n USING target.id;
      IF n <> 1 THEN RAISE EXCEPTION 'Victim row changed'; END IF;
      checks := checks + 3;
    END LOOP;
  END LOOP;
  IF checks <> 72 THEN RAISE EXCEPTION 'Expected 72 checks, got %',checks; END IF;
END $$;
