-- Seed the /history narrative with markdown ported from the original
-- HISTORY_BODY config (apps/ucmc-web/src/config/legal.ts). Single-row pattern:
-- id = 1 is the convention enforced at the action layer; this seed
-- inserts that row so the page renders something useful on a fresh DB
-- before any officer has used the edit affordance.
--
-- The reference link to /scholarships is preserved as a relative
-- markdown link. The MarkdownContent component renders relative links
-- (no http/https scheme) in-tab; absolute http(s) links open in a new
-- tab. Curly quotes and em-dashes are preserved verbatim from the
-- original copy.

INSERT OR IGNORE INTO history_content (id, narrative_markdown) VALUES
  (1,
   '## Founding (1971)

UCMC traces its origins to 1971. Between 1969 and 1971, Denny Conners and Terry Barnhart had been climbing, backpacking, and camping with a small group of UC outdoor enthusiasts — Gerry Papania, John Frasca, Juanita Janigan, and Jane Conners among them — as their school schedules allowed.

Over Spring Break 1971, Terry, Gerry, and John drove to Seneca Rocks, West Virginia. On that trip, in Terry''s words, "the idea for a club evolved." Back in Cincinnati, Michael Murphy asked the University how to charter an official club. UC assigned an advisor, the group put up a display in the lower level of the student union, reserved a room, and held an organizational meeting. Enough people came that the founders began holding periodic meetings in the student union and organizing trips. Terry Barnhart drew the first posters: HIKE PRICE HILL and CAMP MT. ADAMS.

## The first gear

"We were all equipment freaks, but lacked sufficient funds to buy much," Terry recalled. The first equipment order arrived late winter quarter, 1972 — a rope, carabiners, pitons, webbing, and a helmet or two, ordered through Terry''s REI member number. The seniors had little time to use it before graduating, but the club they''d founded took root.

## Decades of camaraderie

The trips Terry and the founders ran in the early 1970s look much like trips UCMC runs today: someone at a Wednesday meeting decides where they want to go, asks others to come along, the group decides who''s driving and how long they can be away, and off they go. Major expeditions — Mt. McKinley in 1997, the international trips that filled the Goosedown Gazette through the 2010s — required more preparation, but the everyday rhythm has stayed remarkably constant.

Terry summed up the early years in one sentence: "Our trips cemented our friendships." That tradition has continued for over fifty years and counting.

See also: the [Goosedown Gazette archive (legacy site)](https://ucmountaineering.weebly.com/goosedown-gazette.html).

## Steve Must — in memoriam

Steve Must joined UCMC in the mid-1980s and discovered a passion for rock climbing and mountaineering through the club. As his skills grew he became a generous mentor to other members; later, after moving to the Pacific Northwest, he spent years in the mountains, completing numerous expeditions with the legendary Fred Beckey and traveling to China in search of new climbing.

In 1999, the Outdoor Leadership Scholarship — a long-running alumni-funded program supporting club members pursuing advanced outdoor training — was renamed in Steve''s memory. At the April 21, 1999 club meeting, alumnus Bob Kessler dedicated the renamed scholarship, noting that "although his death was much too soon, his life was certainly full and varied. We who knew him were enriched by the knowing of him." A duplicate of the bronze dedication plaque was presented to Steve''s parents, Pat and Clancy Must.

The [Steve Must Memorial Scholarship](/scholarships) continues today; details are on the scholarships page.');
