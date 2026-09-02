-- Adicionar text_input e rating_star ao question_type
ALTER TYPE question_type ADD VALUE IF NOT EXISTS 'text_input';
ALTER TYPE question_type ADD VALUE IF NOT EXISTS 'rating_star';
