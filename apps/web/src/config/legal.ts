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
 * non-discrimination) that members tick at registration. Bumping this
 * forces re-acknowledgment on next sign-in.
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
