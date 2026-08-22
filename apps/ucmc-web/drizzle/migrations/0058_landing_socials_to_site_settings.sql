-- Move the club's social links out of the landing CMS and into
-- site_settings, so the footer and the landing page's "Where to find us"
-- card read one source of truth (same arrangement contact.clubEmail
-- already has). Before this, Instagram lived in `landing_settings` while
-- Facebook and YouTube were hardcoded in the footer JSX.
--
-- Instagram carries its configured value over, but ONLY if an officer
-- actually edited it: migration 0012 seeded a placeholder handle
-- (`uc.mountaineering`, alongside the equally placeholder
-- `ucmc@example.com`), while the footer has been shipping the real
-- account (`uc_mountaineering`). An untouched placeholder shouldn't win
-- over the live link, so the seeded value is excluded and the registry
-- default applies instead.
INSERT OR IGNORE INTO site_settings (key, value_json)
  SELECT 'contact.instagramUrl', value_json
    FROM landing_settings
   WHERE key = 'meeting.instagram_url'
     AND value_json <> '"https://instagram.com/uc.mountaineering"';
--> statement-breakpoint
-- Facebook and YouTube have no landing-CMS predecessor to carry over —
-- they were only ever hardcoded — so seed them from the URLs the footer
-- was already using. OR IGNORE keeps a hand-set row (or a re-run) safe.
INSERT OR IGNORE INTO site_settings (key, value_json) VALUES
  ('contact.facebookUrl', '"https://www.facebook.com/groups/19204046466/"'),
  ('contact.youtubeUrl', '"https://www.youtube.com/channel/UC1zpNSpQI784F-zOtVHjUMQ"');
--> statement-breakpoint
-- Drop both retired landing keys. `meeting.email` was already dead — no
-- reader since contact.clubEmail took over — and is removed here rather
-- than left as a confusing orphan next to the key it was retired with.
DELETE FROM landing_settings
 WHERE key IN ('meeting.instagram_url', 'meeting.email');
