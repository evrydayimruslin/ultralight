-- Code Integrity Verification System
-- Adds code safety scanning + originality gating for marketplace integrity
-- Run AFTER migration-marketplace.sql has been applied.

-- ============================================
-- 1. INTEGRITY COLUMNS ON APPS TABLE
-- ============================================

-- Normalized source fingerprint (SHA-256 hex, computed on every upload)
ALTER TABLE apps ADD COLUMN IF NOT EXISTS source_fingerprint TEXT;

-- Originality score from last publish gate (0.0 = clone, 1.0 = unique)
ALTER TABLE apps ADD COLUMN IF NOT EXISTS originality_score FLOAT;

-- When integrity was last checked
ALTER TABLE apps ADD COLUMN IF NOT EXISTS integrity_checked_at TIMESTAMPTZ;

-- Summary of last safety scan: 'pending' | 'clean' | 'warned' | 'blocked'
ALTER TABLE apps ADD COLUMN IF NOT EXISTS safety_status TEXT DEFAULT 'pending';

-- Index for fast fingerprint lookups during originality check
CREATE INDEX IF NOT EXISTS idx_apps_source_fingerprint
  ON apps(source_fingerprint)
  WHERE source_fingerprint IS NOT NULL;

-- ============================================
-- 2. CODE FINGERPRINTS TABLE (seller-relist detection)
-- ============================================
-- Stores fingerprints of sold apps at time of sale.
-- Written by recordSaleFingerprint() after accept_bid.
-- Queried at publish gate to detect seller re-uploading sold code.

CREATE TABLE IF NOT EXISTS app_code_fingerprints (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id      UUID NOT NULL REFERENCES apps(id),
  seller_id   UUID NOT NULL REFERENCES users(id),
  buyer_id    UUID NOT NULL REFERENCES users(id),
  fingerprint TEXT NOT NULL,
  sold_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  sale_id     UUID REFERENCES app_sales(id)
);

-- Index for seller-relist queries: "has this seller sold code with this fingerprint?"
CREATE INDEX IF NOT EXISTS idx_fingerprints_seller
  ON app_code_fingerprints(seller_id);

CREATE INDEX IF NOT EXISTS idx_fingerprints_hash
  ON app_code_fingerprints(fingerprint);

-- ============================================
-- 3. RPC: record_sale_fingerprint
-- ============================================
-- Called from marketplace service after accept_bid succeeds.
-- Snapshots apps.source_fingerprint into app_code_fingerprints
-- so the record persists even if the app is later modified or deleted.

CREATE OR REPLACE FUNCTION record_sale_fingerprint(
  p_sale_id   UUID,
  p_app_id    UUID,
  p_seller_id UUID,
  p_buyer_id  UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_fingerprint TEXT;
BEGIN
  SELECT source_fingerprint INTO v_fingerprint
  FROM apps WHERE id = p_app_id;

  -- Only record if the app has a fingerprint (computed at upload time)
  IF v_fingerprint IS NOT NULL THEN
    INSERT INTO app_code_fingerprints
      (app_id, seller_id, buyer_id, fingerprint, sale_id)
    VALUES
      (p_app_id, p_seller_id, p_buyer_id, v_fingerprint, p_sale_id);
  END IF;
END;
$$;

-- ============================================
-- 4. RPC: check_seller_relist
-- ============================================
-- Returns TRUE if the uploader has previously sold an app with this fingerprint.
-- Buyer exemption is implicit: only seller_id is stored, not buyer_id.
-- So if User B bought the app from User A, and User B re-uploads same code,
-- check_seller_relist(User_B, fingerprint) returns FALSE — B is not a seller.

CREATE OR REPLACE FUNCTION check_seller_relist(
  p_uploader_id UUID,
  p_fingerprint TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM app_code_fingerprints
    WHERE seller_id = p_uploader_id
      AND fingerprint = p_fingerprint
  );
END;
$$;
