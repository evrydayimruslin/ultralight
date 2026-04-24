-- Migration: GPU Compute Runtime — Phase 2 (Build Events)
-- Tracks GPU build and benchmark events for audit and debugging.
-- Run after migration-gpu-phase1.sql has been applied.

CREATE TABLE IF NOT EXISTS gpu_build_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id UUID NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  event_type TEXT NOT NULL,  -- 'build_started' | 'build_completed' | 'build_failed' | 'benchmark_started' | 'benchmark_completed' | 'benchmark_failed'
  details JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gpu_build_events_app ON gpu_build_events(app_id);
CREATE INDEX IF NOT EXISTS idx_gpu_build_events_type ON gpu_build_events(event_type);
