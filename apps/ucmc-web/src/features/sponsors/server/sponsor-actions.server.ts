/**
 * /sponsors actions (issue #185).
 *
 * The read is anonymous-safe and gated at the route layer by
 * `public_sponsors:view`; every write gates on `public_sponsors:manage`
 * here at the action layer and records one audit event.
 *
 * **The perk projection is the load-bearing part of this file.**
 * `sponsors.member_perk` holds a discount code or how-to-claim
 * instructions — a membership benefit, on a page an anonymous visitor
 * can load. So the field is *omitted from the payload entirely* for a
 * viewer without `public_sponsors:perks`, rather than being sent and
 * hidden by the client. Hiding it client-side would still ship every
 * sponsor's code inside the SSR HTML of a public page, where View
 * Source is the whole attack.
 *
 * The client *also* checks `hasPermission("public_sponsors:perks")`
 * before rendering, and that is not redundant: the server answers the
 * **real** principal by design, so a sys admin previewing `member` or
 * `anonymous` is still served the perks. The client check is what makes
 * role preview narrow the page the way it narrows the sidebar — the
 * exact "never test a payload field's presence" rule that hid the
 * waiver card's gate on /members/$publicId.
 *
 * Neither markdown band is edited here. Both go through the generic
 * `markdown_pages` action keyed on slug `sponsors` / `sponsors_pitch`,
 * whose slug → permission map routes back to `public_sponsors:manage`,
 * so the per-page gate is preserved without a second write path.
 *
 * Logo flow mirrors the Album's:
 *   1. Client fits the source inside a 640 px box preserving aspect
 *      (`useImageResize`), emits a base64 WebP data URL plus the exact
 *      output dimensions.
 *   2. This action decodes the base64, verifies the RIFF/WEBP magic
 *      bytes and the size cap, content-hashes it, and uploads to
 *      `BUCKET_PUBLIC` under `sponsors/<id>/<hash>.webp`.
 *   3. The D1 row stores the key plus the dimensions, which exist to
 *      reserve the card's space rather than to size the box.
 * On replacement the new file goes to a new key and the old one is
 * best-effort deleted; a failed delete is picked up by the orphan sweep
 * in `retention.server.ts` on its next run.
 */
import { eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";

import {
  requireSponsorManager,
  viewerHoldsPerks,
} from "#/features/sponsors/server/sponsor-permissions.server";
import {
  getSponsorById,
  listSponsors,
  nextSponsorSortOrder,
} from "#/features/sponsors/server/sponsor-repo.server";
import type {
  CreateSponsorInput,
  DeleteSponsorInput,
  ReorderSponsorsInput,
  UpdateSponsorInput,
} from "#/features/sponsors/server/sponsor-schemas";
import { recordAuditEvent } from "#/server/audit/audit-log.server";
import { generatePublicId } from "#/server/auth/ids";
import { getDb, schema } from "#/server/db";
import {
  decodeImageDataUrl,
  shortContentHash,
} from "#/server/r2/image-codec.server";
import {
  deleteSponsorLogo,
  putSponsorLogo,
  SPONSOR_LOGO_MAX_BYTES,
  sponsorLogoKey,
} from "#/server/r2/sponsor-logos.server";

// ── public shapes ───────────────────────────────────────────────────────

export interface SponsorEntry {
  id: string;
  publicId: string;
  name: string;
  websiteUrl: string | null;
  blurb: string;
  /**
   * Member-only. **Absent, not null, for a viewer without
   * `public_sponsors:perks`** — `null` is a real value here meaning
   * "this sponsor offers no perk", and conflating the two would leak
   * which sponsors have one.
   */
  memberPerk?: string | null;
  logoKey: string | null;
  logoWidthPx: number | null;
  logoHeightPx: number | null;
}

export interface SponsorsContent {
  sponsors: SponsorEntry[];
  /**
   * Whether the payload carries perks at all. The client uses
   * `hasPermission` to decide what to *render*; this tells it whether
   * the server considered the question, which is what lets the officer
   * form show the perk field only when it was actually loaded rather
   * than blanking a column it never received.
   */
  perksIncluded: boolean;
}

type SponsorRow = Awaited<ReturnType<typeof listSponsors>>[number];

function toEntry(row: SponsorRow, includePerks: boolean): SponsorEntry {
  const entry: SponsorEntry = {
    id: row.id,
    publicId: row.publicId,
    name: row.name,
    websiteUrl: row.websiteUrl,
    blurb: row.blurb,
    logoKey: row.logoKey,
    logoWidthPx: row.logoWidthPx,
    logoHeightPx: row.logoHeightPx,
  };
  if (includePerks) {
    entry.memberPerk = row.memberPerk;
  }
  return entry;
}

// ── read ────────────────────────────────────────────────────────────────

export async function getSponsorsContentAction(): Promise<SponsorsContent> {
  const [rows, includePerks] = await Promise.all([
    listSponsors(),
    viewerHoldsPerks(),
  ]);
  return {
    sponsors: rows.map((row) => toEntry(row, includePerks)),
    perksIncluded: includePerks,
  };
}

// ── writes (public_sponsors:manage) ─────────────────────────────────────

/**
 * Decode, validate and store one uploaded logo, returning the column
 * values for the row.
 */
async function storeLogo(
  sponsorId: string,
  logo: { dataUrl: string; widthPx: number; heightPx: number },
): Promise<{ logoKey: string; logoWidthPx: number; logoHeightPx: number }> {
  const { bytes } = decodeImageDataUrl(logo.dataUrl, SPONSOR_LOGO_MAX_BYTES);
  const hash = await shortContentHash(bytes);
  const key = sponsorLogoKey(sponsorId, hash);
  await putSponsorLogo(key, bytes);
  return {
    logoKey: key,
    logoWidthPx: logo.widthPx,
    logoHeightPx: logo.heightPx,
  };
}

export async function createSponsorAction(
  input: CreateSponsorInput,
): Promise<{ id: string; publicId: string }> {
  const principal = await requireSponsorManager();
  const id = `spon_${uuidv7()}`;
  const publicId = generatePublicId();
  const sortOrder = await nextSponsorSortOrder();
  const logo = input.logo ? await storeLogo(id, input.logo) : null;

  await getDb()
    .insert(schema.sponsors)
    .values({
      id,
      publicId,
      name: input.name,
      websiteUrl: input.websiteUrl,
      blurb: input.blurb,
      memberPerk: input.memberPerk,
      logoKey: logo?.logoKey ?? null,
      logoWidthPx: logo?.logoWidthPx ?? null,
      logoHeightPx: logo?.logoHeightPx ?? null,
      sortOrder,
      createdBy: principal.userId,
      updatedBy: principal.userId,
    });

  await recordAuditEvent({
    actorUserId: principal.userId,
    action: "sponsor.created",
    targetType: "sponsor",
    targetId: id,
    // The name, so the row stays readable after the sponsor is deleted.
    // The perk's *presence* but never its text — an audit row is not the
    // place to copy a discount code out of the one column that's
    // withheld from anonymous readers.
    metadata: { name: input.name, hasPerk: input.memberPerk !== null },
  });
  return { id, publicId };
}

export async function updateSponsorAction(
  input: UpdateSponsorInput,
): Promise<{ ok: true }> {
  const principal = await requireSponsorManager();
  const existing = await getSponsorById(input.id);
  if (!existing) {
    throw new Error("Sponsor not found");
  }

  // Three states, and they are not the same: `undefined` leaves the
  // existing logo alone (a copy edit), an object replaces it, `null`
  // removes it.
  let logoColumns: {
    logoKey: string | null;
    logoWidthPx: number | null;
    logoHeightPx: number | null;
  } | null = null;
  if (input.logo !== undefined) {
    logoColumns = input.logo
      ? await storeLogo(input.id, input.logo)
      : { logoKey: null, logoWidthPx: null, logoHeightPx: null };
  }

  await getDb()
    .update(schema.sponsors)
    .set({
      name: input.name,
      websiteUrl: input.websiteUrl,
      blurb: input.blurb,
      memberPerk: input.memberPerk,
      ...(logoColumns ?? {}),
      updatedAt: Temporal.Now.instant(),
      updatedBy: principal.userId,
    })
    .where(eq(schema.sponsors.id, input.id));

  // Best-effort cleanup of the replaced object, *after* the row points
  // at the new key — the reverse order would leave the card briefly
  // pointing at bytes that no longer exist. A failure here is fine: the
  // orphan sweep in `retention.server.ts` lists the `sponsors/` prefix
  // and deletes anything no row references.
  if (
    logoColumns &&
    existing.logoKey &&
    existing.logoKey !== logoColumns.logoKey
  ) {
    try {
      await deleteSponsorLogo(existing.logoKey);
    } catch {
      // Swept later.
    }
  }

  await recordAuditEvent({
    actorUserId: principal.userId,
    action: "sponsor.updated",
    targetType: "sponsor",
    targetId: input.id,
    metadata: {
      name: input.name,
      hasPerk: input.memberPerk !== null,
      // Lets an audit reader tell a copy edit from a new mark going up.
      logoReplaced: input.logo !== undefined,
    },
  });
  return { ok: true };
}

export async function deleteSponsorAction(
  input: DeleteSponsorInput,
): Promise<{ ok: true }> {
  const principal = await requireSponsorManager();
  // `.returning()` proves a row actually went away, so the audit event
  // carries the name it had and deleting an already-gone id doesn't
  // write a misleading row.
  const deleted = await getDb()
    .delete(schema.sponsors)
    .where(eq(schema.sponsors.id, input.id))
    .returning({
      name: schema.sponsors.name,
      logoKey: schema.sponsors.logoKey,
    });
  if (deleted.length === 0) {
    throw new Error("Sponsor not found");
  }

  const logoKey = deleted[0]?.logoKey;
  if (logoKey) {
    try {
      await deleteSponsorLogo(logoKey);
    } catch {
      // Swept later.
    }
  }

  await recordAuditEvent({
    actorUserId: principal.userId,
    action: "sponsor.deleted",
    targetType: "sponsor",
    targetId: input.id,
    metadata: { name: deleted[0]?.name },
  });
  return { ok: true };
}

export async function reorderSponsorsAction(
  input: ReorderSponsorsInput,
): Promise<{ ok: true; count: number }> {
  const principal = await requireSponsorManager();
  const { ids } = input;
  if (ids.length === 0) {
    return { ok: true, count: 0 };
  }
  // Rewrite every row's sort_order to (index + 1) so the canonical order
  // stays dense (1..N) across mixed add / reorder / delete sequences.
  const db = getDb();
  const now = Temporal.Now.instant();
  const stmts = ids.map((id, idx) =>
    db
      .update(schema.sponsors)
      .set({ sortOrder: idx + 1, updatedAt: now })
      .where(eq(schema.sponsors.id, id)),
  );
  await db.batch(stmts as [(typeof stmts)[number], ...typeof stmts]);
  await recordAuditEvent({
    actorUserId: principal.userId,
    action: "sponsor.reordered",
    targetType: "sponsor_list",
    targetId: "1",
    metadata: { count: ids.length },
  });
  return { ok: true, count: ids.length };
}
