-- Isolated staging only; wrap in BEGIN/ROLLBACK. No fixtures are retained.
DO $$
DECLARE
  a uuid; b uuid; owner_a uuid; owner_b uuid; agent_a uuid; agent_b uuid; viewer_a uuid;
  contact_a uuid; contact_b uuid; n integer; statement text; checks integer := 0;
BEGIN
  SELECT id, owner_user_id INTO STRICT a, owner_a FROM accounts WHERE name='Empresa A - Homologacao';
  SELECT id, owner_user_id INTO STRICT b, owner_b FROM accounts WHERE name='Empresa B - Homologacao';
  SELECT user_id INTO STRICT agent_a FROM profiles WHERE account_id=a AND account_role='agent' AND email LIKE '%@example.test';
  SELECT user_id INTO STRICT agent_b FROM profiles WHERE account_id=b AND account_role='agent' AND email LIKE '%@example.test';
  SELECT user_id INTO STRICT viewer_a FROM profiles WHERE account_id=a AND account_role='viewer' AND email LIKE '%@example.test';
  INSERT INTO contacts(account_id,user_id,name,phone) VALUES(a,owner_a,'Role fixture',gen_random_uuid()::text) RETURNING id INTO contact_a;
  INSERT INTO contacts(account_id,user_id,name,phone) VALUES(b,owner_b,'Role fixture',gen_random_uuid()::text) RETURNING id INTO contact_b;
  PERFORM set_config('request.jwt.claim.sub',agent_a::text,true);
  PERFORM set_config('request.jwt.claims',json_build_object('sub',agent_a,'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  UPDATE contacts SET name='Agent permitted' WHERE id=contact_a;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'Agent own write failed'; END IF;
  FOREACH statement IN ARRAY ARRAY[
    format('UPDATE profiles SET account_role=''owner'' WHERE user_id=%L',agent_a),
    format('UPDATE profiles SET account_id=%L WHERE user_id=%L',b,agent_a)
  ] LOOP
    BEGIN EXECUTE statement; RAISE EXCEPTION 'Escalation allowed';
    EXCEPTION WHEN insufficient_privilege THEN checks := checks+1; END;
  END LOOP;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub',viewer_a::text,true);
  PERFORM set_config('request.jwt.claims',json_build_object('sub',viewer_a,'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  UPDATE contacts SET name='Viewer forbidden' WHERE id=contact_a;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'Viewer write allowed'; END IF;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub',owner_a::text,true);
  PERFORM set_config('request.jwt.claims',json_build_object('sub',owner_a,'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  FOREACH statement IN ARRAY ARRAY[
    format('UPDATE accounts SET owner_user_id=%L WHERE id=%L',owner_b,a),
    format('SELECT set_member_role(%L,''admin'')',agent_b),
    format('SELECT remove_account_member(%L)',agent_b),
    format('SELECT transfer_account_ownership(%L)',owner_b),
    format('INSERT INTO contacts(account_id,user_id,name,phone) VALUES(%L,%L,''forged'',%L)',b,owner_a,gen_random_uuid())
  ] LOOP
    BEGIN EXECUTE statement; RAISE EXCEPTION 'Cross-account action allowed';
    EXCEPTION WHEN insufficient_privilege THEN checks := checks+1; END;
  END LOOP;
  BEGIN
    INSERT INTO conversations(account_id,user_id,contact_id) VALUES(a,owner_a,contact_b);
    RAISE EXCEPTION 'Cross-tenant reference allowed';
  EXCEPTION WHEN check_violation THEN checks := checks+1; END;
  RESET ROLE;
  IF checks <> 8 THEN RAISE EXCEPTION 'Expected eight denials'; END IF;
END $$;
