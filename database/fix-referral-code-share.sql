-- Ensure every authenticated user can recover their referral code.

CREATE OR REPLACE FUNCTION ensure_my_referral_code()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_user_id UUID := auth.uid();
  existing_code TEXT;
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT referral_code
    INTO existing_code
    FROM user_referral_codes
   WHERE user_id = current_user_id
   LIMIT 1;

  IF existing_code IS NOT NULL THEN
    RETURN existing_code;
  END IF;

  INSERT INTO user_referral_codes (user_id, referral_code)
  VALUES (current_user_id, generate_referral_code(current_user_id))
  ON CONFLICT (user_id) DO UPDATE
    SET referral_code = user_referral_codes.referral_code
  RETURNING referral_code INTO existing_code;

  RETURN existing_code;
END;
$$;

GRANT EXECUTE ON FUNCTION ensure_my_referral_code() TO authenticated;
