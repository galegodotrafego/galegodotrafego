-- Run on isolated staging after all migrations. No customer rows are changed.
-- Tests actual execution denial, including direct grants left by Supabase defaults.
DO $$
DECLARE
  role_name text;
  statement text;
  denied integer := 0;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    EXECUTE format('SET LOCAL ROLE %I', role_name);
    FOREACH statement IN ARRAY ARRAY[
      'SELECT public._bcast_bump(''00000000-0000-0000-0000-000000000000'', ''sent_count'', 1)',
      'SELECT public.recompute_broadcast_counts(''00000000-0000-0000-0000-000000000000'')',
      'SELECT public.claim_ai_reply_slot(''00000000-0000-0000-0000-000000000000'', 1)',
      'SELECT public.record_webhook_failure(''00000000-0000-0000-0000-000000000000'', 1)',
      'SELECT public.merge_duplicate_contacts()',
      'SELECT public.merge_duplicate_conversations()'
    ] LOOP
      BEGIN
        EXECUTE statement;
        RAISE EXCEPTION 'Unexpected internal RPC access';
      EXCEPTION WHEN insufficient_privilege THEN
        denied := denied + 1;
      END;
    END LOOP;
    RESET ROLE;
  END LOOP;
  IF denied <> 12 THEN RAISE EXCEPTION 'Expected twelve execution denials'; END IF;
END $$;
