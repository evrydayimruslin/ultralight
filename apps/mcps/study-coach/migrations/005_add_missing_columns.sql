-- Add columns that were added to migration files after initial apply
-- quiz_answers: question_type, feedback, score, rubric, misconceptions
ALTER TABLE quiz_answers ADD COLUMN question_type TEXT DEFAULT 'mc';
ALTER TABLE quiz_answers ADD COLUMN feedback TEXT;
ALTER TABLE quiz_answers ADD COLUMN score INTEGER;
ALTER TABLE quiz_answers ADD COLUMN rubric TEXT;
ALTER TABLE quiz_answers ADD COLUMN misconceptions TEXT;
