-- Single-use enforcement for embed/launch bridge tokens.
--
-- Bridge tokens travel in the OAuth redirect URL fragment and previously had
-- no consumption record, so any captured fragment could be exchanged
-- repeatedly within its TTL. Now that launch_web bridges carry a Supabase
-- refresh token (Phase 0 session refresh), replay would mint a 30-day
-- session — the jti must burn atomically on first consumption.
--
-- Rows are short-lived (bridge TTL is <= 120 seconds); consumers
-- opportunistically delete expired rows.

CREATE TABLE IF NOT EXISTS public.embed_bridge_consumptions (
  jti text PRIMARY KEY,
  aud text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.embed_bridge_consumptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.embed_bridge_consumptions FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.embed_bridge_consumptions TO service_role;

CREATE INDEX IF NOT EXISTS embed_bridge_consumptions_expires_at_idx
  ON public.embed_bridge_consumptions(expires_at);
