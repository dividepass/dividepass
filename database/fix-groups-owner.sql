UPDATE groups
SET owner_id = (SELECT id FROM users WHERE role = 'admin' LIMIT 1)
WHERE owner_id IS NULL;
