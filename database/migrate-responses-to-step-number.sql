-- Migration: Re-key survey_responses answers from UUID keys to step_number keys
-- Run this ONCE in Supabase SQL Editor.

DO $$
DECLARE
  resp RECORD;
  old_keys text[];
  new_answers jsonb;
  i int;
  step_num int;
  key text;
  has_uuid boolean;
BEGIN
  FOR resp IN
    SELECT r.id, r.answers, r.survey_id
    FROM survey_responses r
    WHERE r.answers IS NOT NULL
      AND jsonb_typeof(r.answers) = 'object'
      AND r.answers != '{}'::jsonb
  LOOP
    old_keys := ARRAY(SELECT jsonb_object_keys(resp.answers));

    has_uuid := false;
    FOR i IN 1..array_length(old_keys, 1) LOOP
      key := old_keys[i];
      IF length(key) > 5 AND key LIKE '%-%-%-%' THEN
        has_uuid := true;
        EXIT;
      END IF;
    END LOOP;

    IF has_uuid THEN
      new_answers := '{}'::jsonb;
      FOR i IN 1..array_length(old_keys, 1) LOOP
        SELECT s.step_number INTO step_num
        FROM survey_steps s
        WHERE s.survey_id = resp.survey_id
        ORDER BY s.step_number ASC
        LIMIT 1 OFFSET i - 1;

        IF step_num IS NOT NULL THEN
          new_answers := new_answers || jsonb_build_object(
            step_num::text,
            resp.answers -> old_keys[i]
          );
        END IF;
      END LOOP;

      UPDATE survey_responses SET answers = new_answers WHERE id = resp.id;
    END IF;
  END LOOP;
END $$;
