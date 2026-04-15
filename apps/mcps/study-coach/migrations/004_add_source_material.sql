-- Add source_material column to subjects (missing from original schema)
ALTER TABLE subjects ADD COLUMN source_material TEXT;
