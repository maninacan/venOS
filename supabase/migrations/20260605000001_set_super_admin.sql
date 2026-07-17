-- Bootstrap: grant super_admin role to the initial super admin user.
-- Uses jsonb merge (||) to preserve any existing app_metadata fields.
UPDATE auth.users
SET raw_app_meta_data = raw_app_meta_data || '{"role":"super_admin"}'::jsonb
WHERE email = 'jon.r.aaron@gmail.com';
