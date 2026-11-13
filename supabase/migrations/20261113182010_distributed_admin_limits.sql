-- Private storage; only server-side callers can consume limits.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
CREATE TABLE private.admin_rate_limits (
  key_hash text PRIMARY KEY CHECK (key_hash ~ '^[a-f0-9]{64}$'),
  hits integer NOT NULL,
  reset_at timestamptz NOT NULL
);
ALTER TABLE private.admin_rate_limits ENABLE ROW LEVEL SECURITY;
CREATE INDEX admin_rate_limits_reset_idx ON private.admin_rate_limits(reset_at);
REVOKE ALL ON private.admin_rate_limits FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.consume_admin_rate_limit(p_key_hash text, p_limit integer, p_window_ms integer)
RETURNS TABLE(allowed boolean, remaining integer, reset_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_row private.admin_rate_limits; v_now timestamptz := clock_timestamp();
BEGIN
  IF p_key_hash IS NULL OR p_key_hash !~ '^[a-f0-9]{64}$' OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 10000
     OR p_window_ms IS NULL OR p_window_ms NOT BETWEEN 1000 AND 86400000 THEN
    RAISE EXCEPTION 'Invalid rate limit configuration' USING ERRCODE='22023';
  END IF;
  INSERT INTO private.admin_rate_limits AS limits(key_hash,hits,reset_at)
  VALUES(p_key_hash,1,v_now + p_window_ms * interval '1 millisecond')
  ON CONFLICT(key_hash) DO UPDATE SET
    hits = CASE WHEN limits.reset_at <= v_now THEN 1 ELSE least(limits.hits + 1,10001) END,
    reset_at = CASE WHEN limits.reset_at <= v_now THEN EXCLUDED.reset_at ELSE limits.reset_at END
  RETURNING * INTO v_row;
  -- Bounded cleanup, no scheduler or additional service required.
  DELETE FROM private.admin_rate_limits WHERE key_hash IN
    (SELECT x.key_hash FROM private.admin_rate_limits x WHERE x.reset_at < v_now - interval '1 day' LIMIT 100);
  RETURN QUERY SELECT v_row.hits <= p_limit, greatest(0,p_limit-v_row.hits), v_row.reset_at;
END $$;
REVOKE ALL ON FUNCTION public.consume_admin_rate_limit(text,integer,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_admin_rate_limit(text,integer,integer) TO service_role;
