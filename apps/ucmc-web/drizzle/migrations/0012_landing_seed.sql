-- Seed the editable landing page: the permission that gates editing,
-- plus the initial copy/activities/FAQ content that the home page reads.
-- Hero slides are NOT seeded — admins upload images post-deploy. Until
-- any slides exist the hero falls back to a logo + flat panel so the
-- page still looks intentional on day one.
--
-- system_admin auto-grants every permission via the bypass in
-- principal.server.ts, so no role_permissions row is needed for it.
-- The new permission appears in the Roles admin UI and can be granted
-- to any custom role (e.g. a "webmaster" role).

INSERT OR IGNORE INTO permissions (id, name, description) VALUES
  ('perm_landing_edit',
   'landing:edit',
   'Edit landing-page content (hero gallery, FAQ, about, activities, meeting info)');
--> statement-breakpoint

-- ── Hero overlay text + about paragraphs + meeting info ─────────────────
INSERT OR IGNORE INTO landing_settings (key, value_json) VALUES
  ('hero.heading',
   '"University of Cincinnati Mountaineering Club"'),
  ('hero.tagline',
   '"Climb, hike, and summit together — UC''s student-run community for climbers and mountaineers of every level."'),
  ('about.paragraphs',
   '["The University of Cincinnati Mountaineering Club is a student-run organization for anyone curious about rock climbing, mountaineering, and the wider outdoors. We run trips, training nights, and gear swaps throughout the school year.","You don''t need to be experienced to join. Most of our members started by tagging along on a beginner trip and learning from older members. What we ask is curiosity, respect for the people you climb with, and a willingness to belay safely.","We''re open to undergrads, grad students, and recent alumni at UC. If that''s you, scroll down to see how to get plugged in."]'),
  ('meeting.day_time',
   '"Wednesdays at 7pm during the school year"'),
  ('meeting.location',
   '"TBD — meeting location on campus"'),
  ('meeting.email',
   '"ucmc@example.com"'),
  ('meeting.instagram_url',
   '"https://instagram.com/uc.mountaineering"');
--> statement-breakpoint

-- ── Activity cards ──────────────────────────────────────────────────────
INSERT OR IGNORE INTO landing_activities (id, icon, title, blurb, sort_order) VALUES
  ('act_seed_rock', 'Mountain', 'Rock climbing',
   'Weekly gym nights at our partner climbing gym, plus weekend trips to the Red River Gorge and other regional crags.', 0),
  ('act_seed_mountaineering', 'MountainSnow', 'Mountaineering',
   'Bigger objectives in the Adirondacks, White Mountains, and Western ranges for members ready to step up from cragging.', 1),
  ('act_seed_backpacking', 'TentTree', 'Backpacking & hiking',
   'Multi-day trips into the Smokies, Daniel Boone, and beyond — a great entry point if you''re newer to the outdoors.', 2),
  ('act_seed_ice', 'Snowflake', 'Ice climbing',
   'Winter ice trips up north for members who''ve put in time on rock and want to swing tools.', 3),
  ('act_seed_training', 'Backpack', 'Training nights',
   'Regular skills nights covering belaying, anchors, navigation, and avalanche awareness — taught by senior members.', 4),
  ('act_seed_community', 'Users', 'Community',
   'Trip planning meetings, gear swaps, post-climb dinners, and a community that sticks around long after graduation.', 5);
--> statement-breakpoint

-- ── FAQ items ───────────────────────────────────────────────────────────
INSERT OR IGNORE INTO landing_faq_items (id, question, answer, sort_order) VALUES
  ('faq_seed_experience',
   'Do I need experience to join?',
   'No. Most members start out brand-new. We run beginner-friendly trips and teach the basics on training nights — bring curiosity and we''ll handle the rest.',
   0),
  ('faq_seed_gear',
   'Do I need my own gear?',
   'Not at first. The club has a small gear library (helmets, harnesses, ropes) you can borrow for trips. As you get into it, most members buy their own basics.',
   1),
  ('faq_seed_dues',
   'Are there dues?',
   'TODO: Yes / No, and how much. Mention what dues cover (gym passes, gear, trip subsidies).',
   2),
  ('faq_seed_safety',
   'Is it safe?',
   'Climbing and mountaineering have inherent risk. We take safety seriously: trip leaders are vetted, beginner trips are heavily supervised, and we don''t push people past their experience. Every trip has a written plan and emergency contact.',
   3),
  ('faq_seed_eligibility',
   'Can non-UC students join?',
   'TODO: describe whether non-UC students can join, and any caveats (e.g. limited-trip access, alumni status).',
   4),
  ('faq_seed_trips',
   'When do trips happen?',
   'Most trips run on weekends during the school year. Bigger trips are scheduled for fall break, winter break, and spring break. We post the calendar inside the members area once you''re approved.',
   5);
