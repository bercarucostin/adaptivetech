-- Only HMAC-SHA256 keys are stored; no raw account identifiers or IP addresses.
CREATE TABLE IF NOT EXISTS public.login_rate_limits (
  scope text NOT NULL CHECK (scope IN ('ip', 'account')),
  key_hash text NOT NULL CHECK (key_hash ~ '^[a-f0-9]{64}$'),
  window_start timestamptz NOT NULL,
  attempts integer NOT NULL CHECK (attempts > 0),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (scope, key_hash)
);
CREATE INDEX IF NOT EXISTS login_rate_limits_expiry_idx ON public.login_rate_limits (expires_at);
ALTER TABLE public.login_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.login_rate_limits FROM PUBLIC, anon, authenticated;
-- Callers use the security-definer function; table access is unnecessary even for service_role.
REVOKE ALL ON public.login_rate_limits FROM service_role;
CREATE OR REPLACE FUNCTION public.consume_login_rate_limit(p_scope text, p_key text)
RETURNS TABLE (allowed boolean, retry_after integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_limit integer;
  v_seconds integer;
  v_attempts integer;
  v_expiry timestamptz;
BEGIN
  IF p_scope NOT IN ('ip', 'account') OR p_scope IS NULL OR p_key IS NULL OR p_key !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'Invalid rate-limit key';
  END IF;
  v_limit := CASE WHEN p_scope = 'ip' THEN 60 ELSE 10 END;
  v_seconds := CASE WHEN p_scope = 'ip' THEN 60 ELSE 900 END;

  -- Bounded indexed cleanup on each call. Row locks avoid races with active counters.
  DELETE FROM public.login_rate_limits WHERE (scope, key_hash) IN (
    SELECT scope, key_hash FROM public.login_rate_limits
    WHERE expires_at <= v_now ORDER BY expires_at LIMIT 100 FOR UPDATE SKIP LOCKED
  );
  INSERT INTO public.login_rate_limits AS bucket (scope, key_hash, window_start, attempts, expires_at)
  VALUES (p_scope, p_key, v_now, 1, v_now + make_interval(secs => v_seconds))
  ON CONFLICT (scope, key_hash) DO UPDATE SET
    window_start = CASE WHEN bucket.expires_at <= v_now THEN v_now ELSE bucket.window_start END,
    attempts = CASE WHEN bucket.expires_at <= v_now THEN 1 ELSE LEAST(bucket.attempts + 1, v_limit + 1) END,
    expires_at = CASE WHEN bucket.expires_at <= v_now THEN v_now + make_interval(secs => v_seconds) ELSE bucket.expires_at END
  RETURNING attempts, expires_at INTO v_attempts, v_expiry;
  RETURN QUERY SELECT v_attempts <= v_limit,
    CASE WHEN v_attempts <= v_limit THEN 0 ELSE GREATEST(1, ceil(extract(epoch FROM v_expiry - v_now))::integer) END;
END;
$$;
REVOKE ALL ON FUNCTION public.consume_login_rate_limit(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_login_rate_limit(text, text) TO service_role;
