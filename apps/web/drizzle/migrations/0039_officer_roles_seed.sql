-- Flag the constitutionally-seeded officer roles as surfacing on the
-- public "Meet the officers" home-page section. Subsequent officer roles
-- (Vice President, Trip Coordinator, Gear Cave Keeper, ...) are
-- operator-managed via /members/roles and get this flag set through the
-- editor.

UPDATE `roles` SET `is_officer` = 1
WHERE `id` IN (
  'role_president',
  'role_treasurer'
);
