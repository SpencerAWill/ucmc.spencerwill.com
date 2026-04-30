/**
 * Site-level metadata: repository URL, maintainer contact, etc.
 * Anything site-identity-shaped that's referenced from more than one
 * place (footer, colophon, About page, error fallbacks) lives here so
 * the strings can change in one spot. Compliance/legal text lives in
 * `./legal` — keep the two files orthogonal.
 */

export const GITHUB_REPO_URL =
  "https://github.com/SpencerAWill/ucmc.spencerwill.com";

/** Where bug reports and feature requests should land. */
export const GITHUB_ISSUES_URL = `${GITHUB_REPO_URL}/issues`;

/** Public-facing maintainer contact. Surfaced on the colophon. */
export const MAINTAINER_NAME = "Spencer Will";
export const MAINTAINER_EMAIL = "spencer.a.will@gmail.com";
