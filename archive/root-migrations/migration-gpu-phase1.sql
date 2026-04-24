-- Migration: GPU Compute Runtime — Phase 1 (Provider Foundation)
-- Adds GPU runtime columns to apps table, GPU endpoints tracking table,
-- and platform-managed GPU rate table.

-- ---------------------------------------------------------------------------
-- 1. GPU runtime columns on apps table
-- ---------------------------------------------------------------------------

-- Runtime selector: 'deno' (existing sandbox) or 'gpu' (new GPU containers)
ALTER TABLE apps ADD COLUMN IF NOT EXISTS runtime TEXT DEFAULT 'deno';

-- GPU hardware type (e.g. 'A100-80GB-SXM', 'H100-PCIe')
ALTER TABLE apps ADD COLUMN IF NOT EXISTS gpu_type TEXT;

-- Lifecycle status: building | benchmarking | live | build_failed | benchmark_failed
ALTER TABLE apps ADD COLUMN IF NOT EXISTS gpu_status TEXT;

-- Provider endpoint ID (e.g. RunPod serverless endpoint)
ALTER TABLE apps ADD COLUMN IF NOT EXISTS gpu_endpoint_id TEXT;

-- Parsed ultralight.gpu.yaml config (JSONB)
ALTER TABLE apps ADD COLUMN IF NOT EXISTS gpu_config JSONB;

-- Benchmark statistics from 5-run benchmark (JSONB, BenchmarkStats shape)
ALTER TABLE apps ADD COLUMN IF NOT EXISTS gpu_benchmark JSONB;

-- GPU-specific pricing config (JSONB, GpuPricingConfig shape)
ALTER TABLE apps ADD COLUMN IF NOT EXISTS gpu_pricing_config JSONB;

-- Max execution time ceiling in milliseconds (suggested by platform from benchmark)
ALTER TABLE apps ADD COLUMN IF NOT EXISTS gpu_max_duration_ms INTEGER;

-- Per-function concurrency limit (default 5, configurable by tier)
ALTER TABLE apps ADD COLUMN IF NOT EXISTS gpu_concurrency_limit INTEGER DEFAULT 5;

-- ---------------------------------------------------------------------------
-- 2. GPU endpoints tracking table
-- Maps app+version to provider endpoint. Tracks build status and invocations.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS gpu_endpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id UUID NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'runpod',
  endpoint_id TEXT NOT NULL,
  gpu_type TEXT NOT NULL,
  status TEXT DEFAULT 'building',  -- building | active | error | deleted
  build_logs JSONB DEFAULT '[]',
  build_started_at TIMESTAMPTZ DEFAULT now(),
  build_completed_at TIMESTAMPTZ,
  last_invoked_at TIMESTAMPTZ,
  invocation_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gpu_endpoints_app ON gpu_endpoints(app_id, version);
CREATE INDEX IF NOT EXISTS idx_gpu_endpoints_status ON gpu_endpoints(status);

-- ---------------------------------------------------------------------------
-- 3. GPU rate table
-- Platform-managed pricing. Queryable at runtime for billing computations.
-- Rates are in dollars per millisecond, including platform markup (10-13x).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS gpu_rate_table (
  gpu_type TEXT PRIMARY KEY,
  rate_per_ms FLOAT NOT NULL,
  vram_gb INTEGER NOT NULL,
  provider TEXT NOT NULL DEFAULT 'runpod',
  active BOOLEAN DEFAULT true,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Seed the rate table with all supported GPU types
-- Rates derived from RunPod community cloud pricing with consistent 10-13x markup
INSERT INTO gpu_rate_table (gpu_type, rate_per_ms, vram_gb) VALUES
  ('A40',            0.000001,  48),
  ('L40',            0.000002,  48),
  ('L40S',           0.0000022, 48),
  ('A100-80GB-PCIe', 0.000004,  80),
  ('A100-80GB-SXM',  0.000005,  80),
  ('H100-PCIe',      0.000007,  80),
  ('H100-SXM',       0.000009,  80),
  ('H100-NVL',       0.000009,  94),
  ('H200',           0.000012,  141),
  ('B200',           0.000020,  180)
ON CONFLICT (gpu_type) DO NOTHING;
