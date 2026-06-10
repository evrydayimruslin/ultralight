-- Per-question timing and comprehensive post-quiz assessment
ALTER TABLE quiz_answers ADD COLUMN time_seconds INTEGER;
ALTER TABLE quiz_sessions ADD COLUMN assessment_json TEXT;
