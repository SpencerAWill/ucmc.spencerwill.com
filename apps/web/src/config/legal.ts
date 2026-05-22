import type { FileRoutesByTo } from "../routeTree.gen";

/**
 * Legal text + version constants. Single source of truth for:
 *   - The UC-mandated registration disclaimer (Rule 40-03-01) shown
 *     site-wide in the footer + on `/disclaimer`.
 *   - Non-discrimination and anti-hazing copy mirrored on public routes.
 *   - The UCMC paper waiver: filename, version, and the accessible
 *     transcription rendered on `/waiver`.
 *   - Policy + waiver version strings consumed by the registration form
 *     (`policies_version` column) and the attestation guard
 *     (`waiver_version` column). Bumping a version invalidates prior
 *     acceptances/attestations.
 *
 * No imports from features/ or server/ — this module is loaded by both
 * the client bundle and the worker, so it stays dependency-free and
 * deterministic.
 */

/**
 * Verbatim language from UC Rule 40-03-01 / Ohio Admin Code 3361:40-3-01,
 * with the RSO name substituted in. Must appear on every page that uses
 * the UC name. Render in Arial or Times New Roman per the rule.
 */
export const REGISTRATION_DISCLAIMER =
  "University of Cincinnati Mountaineering Club is registered at the University of Cincinnati. Registration shall not be construed as the University of Cincinnati's approval, disapproval, endorsement, or sponsorship of the student organization's publications, activities, statements, purposes, actions, or positions.";

/**
 * Short disambiguation surfaced near the disclaimer. UC Health / UC
 * Medical Center already uses "UCMC" internally, so we make the
 * mountaineering meaning explicit to head off CSI brand-review confusion.
 */
export const SUBBRAND_DISAMBIGUATION =
  "UCMC stands for University of Cincinnati Mountaineering Club, a Registered Student Organization. We are not affiliated with UC Health or UC Medical Center.";

/**
 * Version of the policies-acknowledgment block (anti-hazing +
 * non-discrimination) that members tick at registration. Captured on
 * the profile row as `policiesVersion` + `policiesAcknowledgedAt` at
 * submit time.
 *
 * Groundwork for a future re-ack flow: once a "stale ack" guard
 * exists (compare `profiles.policiesVersion` to this constant on
 * sign-in / on entry to gated routes, redirect to a re-ack screen
 * when they don't match), bumping this string will force every
 * member to re-acknowledge. No such enforcement exists yet —
 * versioning the column from day one means the data is ready when
 * the guard lands.
 */
export const POLICIES_VERSION = "v1";

/**
 * Version of the canonical paper waiver. Tied to the PDF filename in
 * `/public/legal/`. Bumping forces officers to re-attest under the new
 * version even if the cycle hasn't rolled.
 */
export const WAIVER_VERSION = "v1";

/**
 * Public path to the canonical blank waiver PDF. Cacheable static asset.
 */
export const WAIVER_PDF_PATH = `/legal/ucmc-waiver-${WAIVER_VERSION}.pdf`;

/**
 * Retention copy for deactivated accounts. Shared between the privacy
 * page (where it appears as a bullet under "Retention") and the
 * `/members/deactivated` tab so the policy text stays
 * single-sourced — bumping the retention window is a one-line change.
 */
export const RETENTION_DEACTIVATED_COPY =
  "Deactivated accounts are deleted 12 months after deactivation. Reactivation before then resets the clock.";

/**
 * Retention copy for rejected registrations. Same single-source
 * rationale as `RETENTION_DEACTIVATED_COPY`.
 */
export const RETENTION_REJECTED_COPY =
  "Rejected registrations are deleted 30 days after rejection. (If you re-register and are approved before then, the original row is reset and the clock starts over.)";

/**
 * Section of legal prose with a heading and one or more paragraphs.
 * Paragraphs are plain strings; the renderer maps each to a `<p>`.
 * Optional `bullets` render as a `<ul>` after the paragraphs. Optional
 * `references` render as labelled external links.
 */
export interface LegalSection {
  readonly heading: string;
  readonly paragraphs?: readonly string[];
  readonly bullets?: readonly string[];
  readonly references?: readonly { label: string; href: string }[];
}

/**
 * Accessible transcription of the legal text in the canonical waiver PDF.
 * Form-blank lines (name, phone, addresses, signature, medical info) are
 * intentionally omitted — those are filled on the printed paper. Only the
 * binding legal text lives here so screen-reader users can read what
 * they're agreeing to before printing.
 */
export const WAIVER_LEGAL_BODY: readonly LegalSection[] = [
  {
    heading: "About this waiver",
    paragraphs: [
      "The UCMC waiver is a paper form. Print it, fill in your information, sign it, and bring the signed copy to a club meeting. An officer will mark you attested in the member portal so you can participate in club activities.",
      "We do not collect or store signed waivers, medical information, or insurance information digitally. The Treasurer holds paper waivers off-platform per club bylaws. The portal only records that an officer has confirmed your paper waiver is on file.",
    ],
  },
  {
    heading: "Activities covered",
    paragraphs: [
      "As a member or guest of UCMC, you may participate in various outdoor activities, including but not limited to: mountaineering, rock climbing, caving, ice climbing, backpacking, hiking, biking, hang gliding, kayaking, white-water rafting, canoeing, mountain biking, downhill or cross-country skiing, snowboarding, snowshoeing, skydiving, geocaching, and any other UCMC activity, at state and national parks, forests, and any other recreational areas or venues throughout North America.",
    ],
  },
  {
    heading: "Risks",
    paragraphs: [
      "The risks associated with these activities include, but are not limited to: insect bites, scratches, skin irritations, allergic reactions, frostbite, cuts, falls, bumps, bruises, broken bones, dehydration, hyperthermia, sprains, puncture wounds, infections, disease, Lyme disease, bodily injuries, and death.",
    ],
  },
  {
    heading: "Reminders",
    bullets: [
      "The UC Student Code of Conduct applies to students engaged in clubs and other student activities.",
      "UC rules require students to maintain Student Health insurance or other medical insurance.",
      "UC student organizations are not part of, nor do they act on behalf of, the University of Cincinnati. Do NOT assume that club members or activities are covered by UC liability insurance.",
    ],
  },
  {
    heading:
      "Release and waiver of liability (for members 18 years of age or older)",
    paragraphs: [
      "In consideration of my participation in any UCMC event, for myself, my heirs, executors, administrators, and assigns, I hereby waive and relinquish any and all rights, claims, demands, and causes of action which I may have, and agree not to make any claim or file any lawsuit against the State of Ohio, the University of Cincinnati, its trustees, officers, employees, and agents, as well as the UC Mountaineering Club (UCMC), by reason of my participation in any event.",
      "I also hold harmless and agree to indemnify the University of Cincinnati, the State of Ohio, and their employees from any damages or injuries that I may cause through my participation in any event.",
      "I have been advised of the nature of this event, including any special risks, and I agree to follow any safety instructions, gear policies, and safety practices and to be personally responsible for myself and my behavior.",
      "I am submitting this release and waiver of liability declaration voluntarily and of my own free will.",
    ],
  },
  {
    heading: "Release and indemnity",
    paragraphs: [
      "As a member of the University of Cincinnati Mountaineering Club, by signing the waiver I agree to the following:",
    ],
    bullets: [
      "I voluntarily accept and assume the risk for any injury I may receive as a result of my participation in any UCMC activities.",
      "I release the University of Cincinnati, the UC Mountaineering Club, and their trustees, officers, employees, members, and agents from all liability for any injury I may receive as a result of my participation, and agree to hold them harmless and indemnify them for any claim made against them by virtue of my conduct in connection with my participation.",
      "I acknowledge that the University of Cincinnati requires that I obtain my own health insurance coverage (e.g. student health plan, family coverage).",
      "I have received, read, and agreed to the UCMC Equipment/Gear Policies.",
      "I agree to abide by all relevant UC, UCMC, event-specific, and equipment safety policies, procedures, and practices.",
      "I agree not to allow other UCMC members or non-members who have not signed the UCMC waivers/agreements to use or borrow UCMC equipment or to participate in club events/trips.",
      "I have read the foregoing release, assumption-of-risk, and indemnity agreement; I understand that I am giving up substantial rights by signing it; I sign it freely and without any inducement or assurance not stated herein; I intend it to be a complete and unconditional release, assumption of risk, and indemnity to the greatest extent allowed by law; and I agree that if any portion of this Agreement is held invalid the remainder shall continue in full force and effect.",
      "I am submitting this release and waiver of liability declaration voluntarily and of my own free will.",
    ],
  },
  {
    heading: "Equipment policy",
    paragraphs: [
      "The use of UCMC equipment is a privilege. The Gear Manager has discretion on all matters in the Gear Cave.",
    ],
    bullets: [
      "All members must complete waivers, be a member, and pay gear fees to access equipment.",
      "Members may only check out equipment for themselves.",
      "Equipment is checked out for one week unless prior arrangements are made; the Gear Cave is open before and after each meeting; equipment is first-come-first-served.",
      "Equipment must be returned in clean, dry, working condition. Penalties may be assessed for late returns, damage, or loss.",
      "Members may not allow people who have not completed waivers or paid gear fees to use UCMC equipment.",
      "I have a personal responsibility to treat all UCMC equipment as if it were my own, to know how to use the equipment I borrow safely and responsibly, and to ensure that any equipment I borrow is in safe working order before I check it out.",
      "Penalties are assessed by the Gear Manager and may include fines (a minimum of $5 per week up to the retail replacement value), deposits up to $100, and suspension of equipment privileges or club participation. Nonpayment or unreturned equipment beyond two weeks may result in a service block on transcripts/grades/registration; theft cases will be reported to UCPD.",
    ],
  },
];

/**
 * Public-facing non-discrimination statement. Mirrors UC's Notice of
 * Non-Discrimination protected categories, references Ohio SB 1 (2025),
 * and references the UC CAMPUS Act Policy + EO 2022-06D antisemitism
 * definition.
 */
export const NON_DISCRIMINATION_BODY: readonly LegalSection[] = [
  {
    heading: "Our commitment",
    paragraphs: [
      "The University of Cincinnati Mountaineering Club does not discriminate against any member or applicant for membership on the basis of age, ancestry, color, disability, gender identity or expression, genetic information, military status, national origin, parental status, pregnancy, race, religion, sex, sexual orientation, or any other category protected by federal or Ohio law.",
      "Membership is open to any UC student in good standing per Article III of the UCMC Constitution. The registration approval queue exists to verify eligibility (UC enrollment, deduplication, anti-bot), not to gatekeep on viewpoint or identity.",
    ],
  },
  {
    heading: "Antisemitism",
    paragraphs: [
      "Per UC's CAMPUS Act Policy (effective July 29, 2025) and Ohio Executive Order 2022-06D, UCMC adopts the definition of antisemitism used by the University of Cincinnati. Acts of antisemitism are a form of discrimination prohibited by this policy.",
    ],
  },
  {
    heading: "Reporting",
    paragraphs: [
      "If you experience or witness discrimination by a UCMC member or at a UCMC event, you may report it to a UCMC officer, to your faculty advisor, or directly to the University of Cincinnati's Office of Equal Opportunity.",
    ],
    references: [
      {
        label: "UC Notice of Non-Discrimination",
        href: "https://www.uc.edu/about/non-discrimination.html",
      },
      {
        label: "UC Office of Equal Opportunity",
        href: "https://www.uc.edu/about/ethics-compliance-community.html",
      },
    ],
  },
];

/**
 * Public-facing anti-hazing statement. Constitution Art XII makes
 * anti-hazing a constitutionally required commitment. Collin's Law (ORC
 * §2903.311) creates a mandatory-reporting obligation on members acting
 * in an official capacity.
 */
export const ANTI_HAZING_BODY: readonly LegalSection[] = [
  {
    heading: "Our commitment",
    paragraphs: [
      "The University of Cincinnati Mountaineering Club prohibits hazing of any kind, in any form, by any member or guest, on or off campus, in person or online. Hazing has no place in UCMC's culture and is incompatible with the trust required for safe outdoor activity.",
      "This commitment is part of the UCMC Constitution & Bylaws (Article XII) and is binding on every member and officer.",
    ],
  },
  {
    heading: "Mandatory reporting",
    paragraphs: [
      "Under Ohio's anti-hazing law (Ohio Revised Code §2903.311, also known as Collin's Law), UCMC officers and the faculty advisor — when acting in an official capacity — are required by law to report hazing they observe or learn about. Failure to report is a misdemeanor offense.",
    ],
  },
  {
    heading: "How to report",
    paragraphs: [
      "If you experience, witness, or learn about hazing involving UCMC members or activities, you can report it through any of the channels below. UC's Office of Student Conduct & Community Standards investigates organizational misconduct, including hazing.",
    ],
    references: [
      {
        label: "UC Hazing Report (Maxient)",
        href: "https://cm.maxient.com/reportingform.php?UnivofCincinnati",
      },
      {
        label: "UC Anti-Hazing & Organizational Misconduct",
        href: "https://www.uc.edu/campus-life/conduct/conduct-process/organizational-misconduct.html",
      },
      {
        label: "UC Hazing Transparency Report",
        href: "https://www.uc.edu/campus-life/conduct/conduct-process/organizational-misconduct/organizational-misconduct-history.html",
      },
      {
        label: "UC EthicsPoint anonymous hotline (1-800-889-1547)",
        href: "https://www.uc.edu/about/hotline.html",
      },
    ],
  },
];

/**
 * Public privacy notice. The promises here must match what the website
 * actually does — when adding a new column, processor, or retention
 * window, update this text first and treat the implementation as the
 * follow-on. Industry-standard plain-language notice; UC is silent on
 * RSO PII storage so this is not a UC compliance artifact, just a
 * good-faith disclosure.
 */
export const PRIVACY_BODY: readonly LegalSection[] = [
  {
    heading: "What we collect",
    paragraphs: [
      "When you register, we collect your email, full legal name, preferred name, phone number, UC affiliation, optional bio, optional avatar, and one or more emergency contacts (name, phone, relationship). We also record the date you acknowledged UCMC's anti-hazing and non-discrimination policies, plus the version of those policies you ticked.",
      "When an officer attests your paper waiver for the current academic cycle, we record that attestation: the cycle, the waiver version, the officer who attested, and the timestamp. We do not record the contents of the waiver itself.",
      "We capture the timestamp of your most recent visit to /announcements so the bell-icon unread count works.",
    ],
  },
  {
    heading: "What we explicitly do not collect",
    bullets: [
      "UC student/staff IDs (M-numbers). The Treasurer maintains the canonical roster — including IDs — on UC's official CampusLINK platform per Bylaw 1.3.",
      "Medical information, insurance information, and signed waivers. These exist only on the paper waiver, which lives off-platform with the Treasurer.",
      "Payment information. UCMC dues are collected off-platform.",
      "Third-party analytics, ad-tech identifiers, or any cross-site tracking beyond essential session cookies.",
    ],
  },
  {
    heading: "Why each thing is collected",
    bullets: [
      "Email — to send you a magic-link sign-in and identify your account.",
      "Names + UC affiliation + bio — to populate the member directory other approved members see.",
      "Phone + emergency contact — to reach you (or someone on your behalf) about a club activity.",
      "Avatar — purely cosmetic; you choose whether to upload one.",
      "Waiver attestation metadata — to gate participation in club activities on a current paper waiver.",
      "Policies-acknowledgment timestamp + version — to track that you've read the anti-hazing and non-discrimination policies, and to re-prompt if those policies are updated in a future version.",
    ],
  },
  {
    heading: "Who we share it with (processors)",
    paragraphs: [
      "The site runs on Cloudflare Workers; member data lives in Cloudflare's managed services in the United States. We do not sell, rent, or share member data with third parties beyond the technical processors listed below.",
    ],
    bullets: [
      "Cloudflare — hosting, edge TLS, D1 (database), R2 (avatars), KV (short-lived auth state), rate limiting, observability logs (~7 day retention).",
      "Cloudflare Turnstile — anti-bot challenge on the magic-link form. Turnstile passively scores bot-likeness from request signals (user-agent, headers, behavioral cues) on that one page; the resulting token is sent to Cloudflare for verification and is not retained server-side.",
      "Resend — outbound email delivery (the magic-link emails). Recipient address and email body are sent to Resend; Resend does not retain message content beyond the sending window.",
    ],
  },
  {
    heading: "Retention",
    bullets: [
      "Active member data is retained as long as your account is active.",
      RETENTION_REJECTED_COPY,
      RETENTION_DEACTIVATED_COPY,
      "Waiver attestation records (metadata only — not the paper waiver) are retained while still in effect; revoked attestations are deleted 90 days after revocation.",
      "Avatar images and landing-page images stored in object storage are reconciled against the database daily; any object no longer referenced by an active row is deleted.",
      "You can delete your account immediately at any time via the controls on /my/account/preferences; this also removes your avatar from R2 and signs you out everywhere.",
    ],
  },
  {
    heading: "Your rights",
    paragraphs: [
      "You can download a JSON copy of everything we have on you from /my/account/preferences. You can hard-delete your account from the same page; the deletion is immediate and irreversible. To correct or update individual fields, edit them on /my/account (public profile) or /my/account/details (private details and emergency contacts). To add, remove, or change the primary address for your sign-in emails, use /my/account/security.",
    ],
  },
  {
    heading: "Cookies",
    paragraphs: ["We set only essential cookies needed to operate the site:"],
    bullets: [
      "Session cookie (HTTP-only, SameSite=Strict, 30-day TTL with sliding refresh) — keeps you signed in.",
      "Proof cookie (HTTP-only, short-lived) — set after a magic-link click for first-time registrants who don't have an account row yet.",
      "WebAuthn ceremony cookie (HTTP-only, 5-minute TTL) — links a passkey-registration begin/finish pair.",
      "Theme + view-mode cookies — your light/dark/role-emulation UI preferences.",
    ],
  },
  {
    heading: "Contact",
    paragraphs: [
      "Questions, requests for correction, or privacy complaints can be emailed to the website maintainer (see the colophon for the current email).",
    ],
    references: [{ label: "Open source / colophon", href: "/open-source" }],
  },
];

/**
 * Public terms of use for the website itself. Distinct from the waiver
 * (which covers club activities) — these terms cover the use of the
 * member portal at ucmc.spencerwill.com. Plain-language and
 * intentionally short.
 */
export const TERMS_BODY: readonly LegalSection[] = [
  {
    heading: "What this is",
    paragraphs: [
      "This site is the member portal for the University of Cincinnati Mountaineering Club (UCMC), a Registered Student Organization at the University of Cincinnati. It is operated by UCMC officers on a personal Cloudflare account, independent of UC IT. By using the site you agree to the terms below.",
    ],
  },
  {
    heading: "Account responsibility",
    bullets: [
      "Don't share your sign-in link, session, or passkey with anyone else.",
      "If you suspect unauthorized access, sign out (which clears all your sessions) and contact a club officer.",
      "Keep your name, phone, and emergency contact accurate while your account is active. The information we hold may be used to reach you (or someone on your behalf) about a club activity.",
    ],
  },
  {
    heading: "Acceptable use",
    paragraphs: [
      "Don't use the site to harass, threaten, or impersonate anyone. Don't attempt to bypass auth, scrape the member directory, or interfere with site operations. Don't post content that violates UCMC's anti-hazing or non-discrimination policies (linked in the footer).",
    ],
  },
  {
    heading: "No UC endorsement",
    paragraphs: [
      "UCMC is registered at the University of Cincinnati but operates independently of UC IT. Registration is not endorsement — see the registration disclaimer in the footer for the verbatim notice required by UC Rule 40-03-01.",
    ],
  },
  {
    heading: "Liability",
    paragraphs: [
      "These terms cover use of the website. They do not replace the UCMC Waiver of Liability, which separately governs participation in club activities. Use of the site is provided as-is; the maintainer makes no warranty as to availability, fitness for a particular purpose, or accuracy of any information presented.",
    ],
  },
  {
    heading: "Account termination",
    paragraphs: [
      "You can delete your account at any time from /my/account; deletion is immediate and irreversible. UCMC officers may deactivate accounts that violate these terms or club policies; deactivated accounts can be reactivated by an officer.",
    ],
  },
  {
    heading: "Governing law",
    paragraphs: [
      "These terms are governed by the laws of the State of Ohio, without regard to conflict-of-law principles. Any dispute arising from use of the site will be brought in a court of competent jurisdiction in Hamilton County, Ohio.",
    ],
  },
];

/**
 * Public "about UCMC" copy. Frames the club, the open-membership
 * Article III §3.2 invariant, and the additive-not-canonical
 * relationship to CampusLINK.
 */
export const ABOUT_BODY: readonly LegalSection[] = [
  {
    heading: "Who we are",
    paragraphs: [
      "The University of Cincinnati Mountaineering Club (UCMC) is a student-run Registered Student Organization. We climb, hike, backpack, ice climb, kayak, and otherwise spend time outside together. New members of any experience level are welcome — including total beginners.",
    ],
  },
  {
    heading: "How we run",
    paragraphs: [
      "UCMC is governed by an elected officer board (President, Vice President, Treasurer, Secretary, Equipment Officer, Outings Officer) and a faculty advisor. Day-to-day operations — meetings, trips, gear lending, dues collection — happen at the club, not on this website.",
      "The canonical UCMC roster is maintained by the Treasurer on UC's official CampusLINK platform per Bylaw 1.3. This site is an additive operational tool: it surfaces announcements, lets officers track paper-waiver attestations, and gives members a place to update their contact information. It is never a replacement for the official roster.",
    ],
  },
  {
    heading: "Joining",
    paragraphs: [
      "Membership is open to any UC student in good standing per Article III §3.2 of our constitution. See the membership page for the full eligibility, dues, and registration flow.",
    ],
    references: [{ label: "Membership", href: "/membership" }],
  },
];

/**
 * Public membership/eligibility/dues/how-to-join page. The verification-
 * not-gatekeeping framing of the registration approval queue lives here
 * — it's the constitutional invariant from Art III §3.2 that the
 * approval flow is checking eligibility, not making discretionary
 * admission decisions.
 */
export const MEMBERSHIP_BODY: readonly LegalSection[] = [
  {
    heading: "Eligibility",
    paragraphs: [
      'Per Article III §3.2 of the UCMC Constitution, voting membership is open to "any full/part-time undergraduate or graduate student, enrolled in any of the colleges, schools or divisions of the University at the time of applying for membership." Non-voting membership is open more broadly to UC alumni, faculty, staff, family members, and guests.',
      "The approval queue exists to verify eligibility (UC enrollment, anti-bot, deduplication) — not to gatekeep on viewpoint, identity, or ideology. UCMC does not discriminate on any basis listed in our non-discrimination policy or in Ohio Senate Bill 1 (2025).",
    ],
    references: [{ label: "Non-discrimination", href: "/nondiscrimination" }],
  },
  {
    heading: "Dues",
    paragraphs: [
      "Per Bylaw §7.1, members pay an annual equipment fee of $60 to access club gear and participate in club trips. Dues are collected off-platform; this site does not process payments. Talk to the Treasurer at a club meeting for current payment options.",
    ],
  },
  {
    heading: "How to join",
    paragraphs: [
      "Sign up via the website. After you register, an officer will verify your eligibility and approve your account, usually within a week. Once approved, you'll be asked to print, sign, and bring UCMC's paper waiver to a club meeting; the Treasurer or President will mark you attested in the member portal so you can participate in club activities.",
      "The waiver is a paper form. We do not collect or store signed waivers, medical information, or insurance information digitally — those live with the Treasurer off-platform per Bylaw 1.3.",
    ],
    references: [
      { label: "Sign up", href: "/sign-in?register=true" },
      { label: "Waiver of liability (reference copy)", href: "/waiver" },
    ],
  },
  {
    heading: "Anti-hazing and non-discrimination",
    paragraphs: [
      "Membership in UCMC is conditioned on agreement with our anti-hazing and non-discrimination policies, which are constitutional commitments under Article XII. Both are linked in the footer of every page.",
    ],
  },
];

/**
 * Static narrative content for the /history page. The founding-era
 * story (paraphrased from Vicki Rumford's Fall 1999 Goosedown Gazette
 * article) and the Steve Must in-memoriam section live here as
 * config; the actual past-officers archive and honorary-members list
 * are dynamic — sourced from the `historical_officers` and
 * `honorary_members` D1 tables so they can be corrected and extended
 * over time without a code deploy.
 */
export const HISTORY_BODY: readonly LegalSection[] = [
  {
    heading: "Founding (1971)",
    paragraphs: [
      "UCMC traces its origins to 1971. Between 1969 and 1971, Denny Conners and Terry Barnhart had been climbing, backpacking, and camping with a small group of UC outdoor enthusiasts — Gerry Papania, John Frasca, Juanita Janigan, and Jane Conners among them — as their school schedules allowed.",
      'Over Spring Break 1971, Terry, Gerry, and John drove to Seneca Rocks, West Virginia. On that trip, in Terry\'s words, "the idea for a club evolved." Back in Cincinnati, Michael Murphy asked the University how to charter an official club. UC assigned an advisor, the group put up a display in the lower level of the student union, reserved a room, and held an organizational meeting. Enough people came that the founders began holding periodic meetings in the student union and organizing trips. Terry Barnhart drew the first posters: HIKE PRICE HILL and CAMP MT. ADAMS.',
    ],
  },
  {
    heading: "The first gear",
    paragraphs: [
      "\"We were all equipment freaks, but lacked sufficient funds to buy much,\" Terry recalled. The first equipment order arrived late winter quarter, 1972 — a rope, carabiners, pitons, webbing, and a helmet or two, ordered through Terry's REI member number. The seniors had little time to use it before graduating, but the club they'd founded took root.",
    ],
  },
  {
    heading: "Decades of camaraderie",
    paragraphs: [
      "The trips Terry and the founders ran in the early 1970s look much like trips UCMC runs today: someone at a Wednesday meeting decides where they want to go, asks others to come along, the group decides who's driving and how long they can be away, and off they go. Major expeditions — Mt. McKinley in 1997, the international trips that filled the Goosedown Gazette through the 2010s — required more preparation, but the everyday rhythm has stayed remarkably constant.",
      'Terry summed up the early years in one sentence: "Our trips cemented our friendships." That tradition has continued for over fifty years and counting.',
    ],
    references: [
      {
        label: "Goosedown Gazette archive (legacy site)",
        href: "https://ucmountaineering.weebly.com/goosedown-gazette.html",
      },
    ],
  },
  {
    heading: "Steve Must — in memoriam",
    paragraphs: [
      "Steve Must joined UCMC in the mid-1980s and discovered a passion for rock climbing and mountaineering through the club. As his skills grew he became a generous mentor to other members; later, after moving to the Pacific Northwest, he spent years in the mountains, completing numerous expeditions with the legendary Fred Beckey and traveling to China in search of new climbing.",
      "In 1999, the Outdoor Leadership Scholarship — a long-running alumni-funded program supporting club members pursuing advanced outdoor training — was renamed in Steve's memory. At the April 21, 1999 club meeting, alumnus Bob Kessler dedicated the renamed scholarship, noting that \"although his death was much too soon, his life was certainly full and varied. We who knew him were enriched by the knowing of him.\" A duplicate of the bronze dedication plaque was presented to Steve's parents, Pat and Clancy Must.",
      "The Steve Must Memorial Scholarship continues today; details are on the scholarships page.",
    ],
    references: [
      { label: "Steve Must Memorial Scholarship", href: "/scholarships" },
    ],
  },
];

/**
 * Static content for the /scholarships page. Consolidates four legacy
 * pages — scholarships.html (overview), earn-it.html (procedural rules
 * sometimes called the "Earn It" program), committee.html (selection
 * committee makeup), contribute.html (donation instructions),
 * experiences.html (past recipients) — into one config-driven page.
 *
 * The donation memo line and UC Foundation account number (F102341)
 * are exact strings; any donor cover letter or memo line needs to
 * reproduce them verbatim so the gift routes correctly inside UC's
 * accounting system.
 */
export const SCHOLARSHIPS_BODY: readonly LegalSection[] = [
  {
    heading: "Steve Must Memorial Scholarship",
    paragraphs: [
      "UCMC established the Outdoor Leadership Scholarship in 1997 to underwrite undergraduate members attending professional wilderness and outdoor education programs. In 1999 the fund was renamed in memory of Steve Must, a beloved 1980s-era club member who went on to spend years in the Pacific Northwest mountaineering with the legendary Fred Beckey.",
      'In the words of the program: "The goal of the UCMC Steve Must Memorial Scholarship (SMMS) is to further develop the outdoor leadership skills of UCMC student members who have proven commitment and leadership potential." Recipients are expected to return to the club and share what they learn — it is an investment, not a reward.',
    ],
    references: [
      {
        label: "Steve Must — in memoriam",
        href: "/history#steve-must-in-memoriam",
      },
    ],
  },
  {
    heading: "Eligibility",
    paragraphs: [
      "Applicants must be matriculated UC undergraduates in good standing with UCMC, with at least one year of undergraduate study remaining, a UCMC membership of at least 8 months at the time the funded course begins, and an academic record showing both:",
    ],
    bullets: [
      "Cumulative GPA of 2.25 or higher (maintained through the award);",
      "GPA of 2.00 or higher in each of the two quarters/semesters immediately preceding the course;",
      "Evidence that the applicant has first applied for any other available scholarships or financial aid;",
      "Consistent demonstration of leadership potential and commitment to UCMC.",
    ],
  },
  {
    heading: "Application timeline",
    paragraphs: [
      "Applications are reviewed twice per academic year by the Scholarship Committee. The cycles align with when courses tend to run.",
    ],
    bullets: [
      "Fall (for late-October-through-February courses): budget announced in Week 4; applications open Weeks 4–8; selections announced Week 9; recipients accept by Week 11.",
      "Spring (for March-through-September courses): remaining funds announced in Fall Week 13; applications open Fall Week 14 through Spring Week 4; selections announced Week 5; recipients accept by Week 7.",
      "Applications outside these windows are reviewed case-by-case.",
    ],
  },
  {
    heading: "Formal proposal",
    paragraphs: [
      "Every application is a formal written proposal submitted to the Executive and Scholarship Committees. It must include:",
    ],
    bullets: [
      "Course provider description and curriculum, including all prerequisites, costs, and required insurance;",
      "Documentation showing the applicant meets every provider prerequisite (medical exam, prior certifications, insurance);",
      "Proof of UC enrollment, current GPA, and active medical insurance;",
      "Copies of every other scholarship or financial-aid application the applicant has submitted;",
      "A written plan for how the acquired knowledge will be shared back with UCMC membership (lectures, trip leadership, gear training, Goosedown Gazette articles, etc.);",
      "A statement of the applicant's prior UCMC participation, leadership history, and committed service to the club.",
    ],
  },
  {
    heading: "Selection criteria",
    paragraphs: [
      "The committee weighs three questions when ranking proposals:",
    ],
    bullets: [
      "What outdoor-leadership development does UCMC currently need?",
      "Which programs would meet those needs?",
      "Which candidates are most likely to return their new knowledge to the club?",
    ],
  },
  {
    heading: "Refund policy",
    paragraphs: [
      'Awards are conditional on completing the funded course. "In the event that a scholarship recipient does not successfully complete the course for which the award was designated, the UCMC will require that the award amount be refunded." The Treasurer manages refund arrangements case-by-case.',
    ],
  },
  {
    heading: "Selection committee",
    paragraphs: [
      "The Scholarship Committee is a five-person body appointed by the Executive Committee: two UCMC alumni, two current student members, and the UCMC faculty advisor. Membership is documented in the bylaws and rotates annually as roles change.",
    ],
  },
  {
    heading: "Past recipients",
    paragraphs: [
      "A partial record of past awards — names, courses, and (where available) reflections written by the recipient — is preserved as historical context. The first scholarship (1997) was an informal collection from members and officers; the formal program with its current rules begins in 1999.",
    ],
    bullets: [
      "Emily Hannan, Spring 2020 — AAI Alpinism 1 on Mount Baker (Steve Must Memorial Scholarship).",
      "Several members, Fall 2002 — WFR (Wilderness First Responder); fees offset by the scholarship.",
      "Robert Sexton, Summer 2000 — ACA Whitewater Kayaking Instructor.",
      "Annelies Koob and three others, Spring 1999 — WMA Wilderness First Responder (72-hour course).",
      "Robert Sexton, Spring 1999 — ACA Swiftwater Rescue Instructor.",
      "Jeremy Sibert, Summer 1997 — NOLS Mountaineering in Alaska (the first, informal UCMC scholarship).",
    ],
    references: [
      {
        label: "Robert Sexton — recipient documentation (1 of 2)",
        href: "/scholarships/sexton_01.pdf",
      },
      {
        label: "Robert Sexton — recipient documentation (2 of 2)",
        href: "/scholarships/sexton_02.pdf",
      },
      {
        label: "Annelies Koob — recipient documentation",
        href: "/scholarships/koob.pdf",
      },
    ],
  },
  {
    heading: "How to donate",
    paragraphs: [
      "Donations are routed through the UC Foundation, which is a 501(c)(3) tax-exempt entity — gifts are tax-deductible to the extent allowed by law. Many employers offer matching programs for gifts to non-profits; ask your HR department.",
      'For mailed gifts: make checks payable to The UC Foundation. On the memo line, write: UCMC Steve Must Scholarship (F102341). Mail to The University of Cincinnati Foundation, PO Box 19970, Cincinnati, OH 45219-0970. A short cover letter noting the gift supports the "UC Mountaineering Club Steve Must Memorial Scholarship (F102341)" helps the Foundation\'s mailroom route it correctly.',
      "For online gifts: visit foundation.uc.edu/UCMC, enter the amount, complete the donor information, and submit.",
    ],
    references: [
      { label: "Give online", href: "https://foundation.uc.edu/UCMC" },
    ],
  },
];

/**
 * Public legal-page index — surfaces all five legal/policy routes
 * (disclaimer, non-discrimination, anti-hazing, waiver, privacy,
 * terms) plus the colophon, in one place. Not strictly required, but
 * useful as a "what's the official line on X" landing pad.
 */
export const LEGAL_INDEX_LINKS: readonly {
  href: keyof FileRoutesByTo;
  label: string;
  description: string;
}[] = [
  {
    href: "/disclaimer",
    label: "Registration disclaimer",
    description:
      "Verbatim notice required by UC Rule 40-03-01 — what UCMC's registration with UC does and does not mean.",
  },
  {
    href: "/nondiscrimination",
    label: "Non-discrimination",
    description:
      "Protected categories under federal law, Ohio SB 1 (2025), and UC's CAMPUS Act Policy.",
  },
  {
    href: "/anti-hazing",
    label: "Anti-hazing",
    description:
      "UCMC's commitment under Constitution Art XII and Ohio's Collin's Law (ORC §2903.311), with reporting links.",
  },
  {
    href: "/waiver",
    label: "Waiver of liability",
    description:
      "Reference copy of the paper waiver members sign before participating in club activities.",
  },
  {
    href: "/privacy",
    label: "Privacy",
    description:
      "What data this site collects, who it's shared with, how long it's kept, and how to delete it.",
  },
  {
    href: "/terms",
    label: "Terms of use",
    description: "Acceptable use of the website itself.",
  },
  {
    href: "/membership",
    label: "Membership",
    description:
      "Who can join, how dues work, and how the registration approval queue checks eligibility.",
  },
  {
    href: "/about",
    label: "About UCMC",
    description: "Who we are, how we operate, and how this site fits in.",
  },
  {
    href: "/open-source",
    label: "Open source",
    description: "How this site is built, maintained, and licensed.",
  },
];
