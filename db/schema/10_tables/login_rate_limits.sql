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
