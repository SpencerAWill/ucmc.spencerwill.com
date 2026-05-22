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
 * UCMC's governing constitution and bylaws. Single-sourced from the
 * legacy constitution.html. Where the source uses block quotes,
 * those are reproduced verbatim; the rest is faithful paraphrase to
 * fit the LegalSection structure without changing meaning.
 *
 * Amendments require a two-thirds vote of the voting membership per
 * Article VIII; any future amendment that changes this page should be
 * accompanied by the corresponding vote in the meeting minutes.
 */
export const CONSTITUTION_BODY: readonly LegalSection[] = [
  {
    heading: "Article I — Name",
    paragraphs: [
      '"This organization shall be called the University of Cincinnati Mountaineering Club (UCMC)."',
    ],
  },
  {
    heading: "Article II — Purpose",
    paragraphs: [
      'The organization\'s purpose includes wilderness activities such as mountaineering, backpacking, caving, whitewater sports, and bicycling. "Through participating in these activities it is our purpose to develop an appreciation of the outdoors, to preserve the natural balance, and to proceed safely." The club provides educational services through outings, lectures, and instruction courses.',
    ],
  },
  {
    heading: "Article III — Membership",
    bullets: [
      "§3.1 — Three membership classes exist: voting, non-voting, and honorary.",
      "§3.2 — Voting membership is available to full- or part-time undergraduate and graduate students enrolled in any University college, school, or division.",
      "§3.3 — Non-voting membership is available to students, faculty, community members, and administrative staff.",
      "§3.4 — Honorary membership is available to any person elected by majority voting-member vote.",
      '§3.5 — "There shall be no limit on the size of the membership of the Mountaineering Club, provided that the number of the non-voting and honorary members together shall not exceed the number of voting members."',
    ],
  },
  {
    heading: "Article IV — Officers",
    bullets: [
      "§4.1 — Elected officer positions are President, Vice-President, Secretary, Treasurer, and Trip Coordinator.",
      "§4.2 — The President, Vice-President, Secretary, and Treasurer appoint Equipment Managers.",
      "§4.3 — Officers must be voting members, matriculating students with a minimum 2.300 semester GPA, and in good standing with their college.",
      "§4.4 — Officers unable to complete their term are removed, with successor election or appointment required.",
      "§4.5 — Officers required to co-op out of town may appoint a replacement for the co-op semester(s), subject to majority voting-member ratification.",
    ],
  },
  {
    heading: "Article V — Meetings",
    bullets: [
      "§5.1 — Regular meetings occur a minimum of twice per operating semester.",
      "§5.2 — The Executive Committee may call special meetings at any time.",
    ],
  },
  {
    heading: "Article VI — Liability and waivers",
    paragraphs: [
      '§6.1 — "The U.C. Mountaineering Club officers, employees, servants, or agents do not have any responsibility, legal or otherwise, expressed or implied, in connection with the Club\'s activity," and participants accept all injury and damage risks.',
      "§6.2 — Officers and agents are held harmless from responsibility for injuries or damages from club participation or member conduct.",
      "§6.3 — All members should obtain personal insurance coverage.",
      '§6.4 — All members must receive and sign "Waiver, Release, Indemnity and Gear" forms as a membership condition.',
    ],
  },
  {
    heading: "Article VII — University advisor",
    paragraphs: [
      "The club shall have a University Advisor who is a full-time faculty, staff, or administration member, selected by the Executive Board.",
    ],
  },
  {
    heading: "Article VIII — Amendments",
    bullets: [
      "§8.1 — Any member may propose constitutional amendments.",
      "§8.2 — Two weeks' prior notification is required before an amendment vote.",
      '§8.3 — "This Constitution may be amended by a two-thirds (2/3) affirmative vote of the membership present, with the approval of the Student Activities Board."',
      "§8.4 — Mandated amendments from the Student Activities Board may have the notification period suspended by the President with two-thirds voting-member approval.",
    ],
  },
  {
    heading: "Article IX — Ratification",
    paragraphs: [
      '"This Constitution will be ratified by a majority affirmative vote of the voting members present at the meeting at which it is presented, and with the approval of the Student Activities Board."',
    ],
  },
  {
    heading: "By-laws §1 — Elected positions (duties)",
    bullets: [
      "§1.1 President — presides over all UCMC and Executive Committee meetings; ex-officio committee member; sanctions outings and courses; registers the club annually; secures meeting space; guides the club generally.",
      "§1.2 Vice-President — maintains correspondence with other organizations; manages marketing and club displays; serves as liaison on gear-space issues; performs quarterly fund audits with another executive member; assists the President and acts as President when absent.",
      '§1.3 Treasurer — "responsible in conjunction with the University Advisor for all fiscal matters of the Student Organization." Collects funds, deposits them, approves expenditures with the Advisor, co-signs checks, maintains the membership roster including medical information, educates successors, keeps inspectable books, and makes semester reports.',
      "§1.4 Secretary — updates the club website and Facebook page; keeps Executive and general meeting minutes; posts minutes and approved trip announcements via listserv and social media; manages external fundraising and volunteering; assists officers; attends every meeting.",
      "§1.5 Equipment / Gear Manager — maintains current and historical equipment inventory; assumes full responsibility for club gear (except that the President, Vice-President, and Treasurer together may retire unsafe equipment). Acquires and retires gear, marks equipment for identification, updates sign-out procedures, assesses fines, withholds gear from violators, and may file service blocks for non-returners or code-of-conduct violators.",
      "§1.6 Trip Coordinator — one or more individuals; ensures trip leaders follow the UCMC Trip Leader Checklist; submits emergency contact sheets and rosters to the trip monitor and advisor for funded trips; plans weekly trips; schedules large break trips 6–8 weeks in advance; fosters new trip leader development; presents large trips to the Executive board 3–4 weeks ahead; copies themselves on trip leader emails; ensures safety-gate-guideline compliance; maintains sign-up sheets at general meetings.",
    ],
  },
  {
    heading: "By-laws §2 — University Advisor",
    bullets: [
      "§2.1 — The Advisor consults with the club and ensures activities align with organizational purposes.",
      "§2.2 — The Advisor approves all off-campus activities where students formally represent the club.",
      "§2.3 — The Advisor must file official academic-standing certifications for officers with the Student Activities and Programming Office each semester.",
      '§2.4 — "The University Advisor has an obligation to know the rules and regulations governing the handling of all funds and to assist and advise the Treasurer in all financial matters and to co-sign checks."',
      "§2.5 — The Advisor must attend programs featuring off-campus speakers.",
    ],
  },
  {
    heading: "By-laws §3 — Executive Committee",
    bullets: [
      "§3.1 — The Committee consists of President, Vice-President, Treasurer, Secretary, Equipment Manager, Trip Coordinator, and University Advisor.",
      "§3.2 — The Committee determines policies and activities, disciplines members, approves budgets, and manages the club generally.",
      "§3.3 — The Committee meets once each operating semester with the Equipment Committee.",
    ],
  },
  {
    heading: "By-laws §4 — General meetings",
    bullets: [
      "§4.1 — Regular meetings occur weekly at times and places determined by the Executive Committee.",
      '§4.2 — "At all meetings a quorum shall be one-half (1/2) of the voting members of the U.C. Mountaineering Club. A quorum is necessary for the Club to conduct official business."',
    ],
  },
  {
    heading: "By-laws §5 — Executive elections",
    bullets: [
      "§5.1 — Normal elections occur at the tenth meeting of Spring semester.",
      "§5.2 — Special elections occur at the first regular meeting after an officer cannot fulfill their term.",
      "§5.3 — Elected officers are chosen by majority ballot vote with a quorum present.",
      "§5.4 — Officers take office during the first week of Summer semester following election and serve one-year terms.",
      "§5.5 — The Vice-President collects absentee ballots before elections.",
    ],
  },
  {
    heading: "By-laws §6 — Funding and equipment fees",
    bullets: [
      '§6.1 — "Equipment usage fees shall be sixty dollars ($60.00) per year (September through August); twenty dollars ($20.00) per Semester (fall, winter and summer)." Alumni rates match student rates.',
      "§6.2 — Revenue from other sources may be raised as determined by the Executive Committee and approved by the club and appropriate University office.",
      "§6.3 — The Committee determines revenue disbursement with club and University policy approval; primary use is replacing previously received University funds for equipment.",
    ],
  },
  {
    heading: "By-laws §7 — Special committees",
    bullets: [
      "§7.1 — The Executive Committee may establish special committees performing defined duties.",
      "§7.2 — The Committee appoints and may remove chairpersons and members.",
    ],
  },
  {
    heading: "By-laws §8 — UCMC trips",
    paragraphs: [
      '"A U.C. Mountaineering Club trip shall be: any activity that is approved by the UCMC President, or the Executive Committee; is listed on the UCMC Outgoing trips slide during the UCMC meetings; contained in the official UCMC meeting announcement sent out by an Executive member, or is funded with University Funding Board funds."',
    ],
  },
  {
    heading: "By-laws §9 — Order and conduct",
    bullets: [
      "§9.1 — The club has no standing rules of order.",
      "§9.2 — The club adopts Creative Conflict rules when the President deems necessary.",
      "§9.3 — The President determines meeting format and recognizes speakers as necessary.",
    ],
  },
  {
    heading: "By-laws §10 — Violations of club rules",
    bullets: [
      "§10.1 — Members repeatedly abusing or misusing club equipment or the club name, after Executive Committee warning, may have membership terminated by a two-thirds Executive Committee vote.",
      "§10.2 — Terminated members forfeit all interest in club funds or property and cannot use the club name.",
      "§10.3 — Members may appeal expulsion in writing within two weeks to the Student Activities Board, and if upheld, may further appeal within two weeks to the Student Activities and Leadership Development Office.",
    ],
  },
  {
    heading: "By-laws §11 — Amendments to the by-laws",
    bullets: [
      "§11.1 — Any member may propose by-law amendments.",
      "§11.2 — One week's prior notification is required before an amendment vote.",
      '§11.3 — "These by-laws may be amended by a majority affirmative vote of the voting members present, with the approval of the Student Activities Board."',
      "§11.4 — Mandated amendments may have the notification period suspended by the President with two-thirds voting-member approval.",
    ],
  },
  {
    heading: "By-laws §14 — Title IX, anti-hazing, and non-discrimination",
    paragraphs: [
      "§14.1 — Ohio state laws and University of Cincinnati anti-hazing policies are observed.",
      '§14.2 — "Hazing shall be defined as participating in or allowing any act or coercing another, including the victim, to do any act that creates a substantial risk of causing mental or physical harm to any person."',
      "§14.3 — Explicitly prohibited activities include any activity creating substantial physical or mental harm risk; paddling, beating, or hitting individuals; wearing degrading or uncomfortable items; depriving individuals of six hours daily sleep, proper nutrition, or hygiene access; and any activity interfering with academics through exhaustion or study-time loss.",
      '§14.4 — "All people are given equal opportunity in all club matters and shall not be discriminated based on race, ethnicity, religion, gender, sexual orientation, age, or any other membership to another group."',
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
    href: "/constitution",
    label: "Constitution and by-laws",
    description:
      "UCMC's governing document — officer duties, membership classes, equipment fees, and the formal anti-hazing and non-discrimination commitments.",
  },
  {
    href: "/open-source",
    label: "Open source",
    description: "How this site is built, maintained, and licensed.",
  },
];
