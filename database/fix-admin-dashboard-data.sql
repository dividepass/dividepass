-- Fix data access for admin dashboard metrics

DROP POLICY IF EXISTS "Admins can view all payments" ON payments;
CREATE POLICY "Admins can view all payments"
  ON payments FOR SELECT
  USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can view all payment_attempts" ON payment_attempts;
CREATE POLICY "Admins can view all payment_attempts"
  ON payment_attempts FOR SELECT
  USING (public.is_admin());
