/**
 * Goosedown Gazette CRUD actions. Reads (`getGazetteIssuesAction`,
 * `getGazetteIssueByPublicIdAction`) are gated at the route layer by
 * `public_gazette:view`; writes gate on `public_gazette:manage` here
 * via `requireGazetteManager()` and record one audit event per
 * mutation.
 *
 * PDF flow:
 *   1. Client reads the file with FileReader.readAsDataURL → base64
 *      data URL.
 *   2. Action decodes the base64, verifies the `%PDF` magic bytes,
 *      checks the size cap, computes a content-hash, uploads to
 *      `BUCKET_PUBLIC` under `gazette/<id>/<hash>.pdf`.
 *   3. D1 row stores the key + file size. The CDN serves the bytes
 *      directly on subsequent reads.
 *
 * Replacement on update: when `pdfDataUrl` is supplied to
 * `updateGazetteIssueAction`, the new file is uploaded under a new
 * key and the old key is best-effort deleted. If the delete fails
 * (eventual consistency, R2 hiccup), the orphan-GC sweep in
 * `retention.server.ts` picks it up on the next daily run.
 */
import { eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";

import { requireGazetteManager } from "#/features/gazette/server/gazette-permissions.server";
import {
  getGazetteIssueByPublicId,
  listGazetteIssues,
} from "#/features/gazette/server/gazette-repo.server";
import type {
  CreateGazetteIssueInput,
  DeleteGazetteIssueInput,
  GetGazetteIssueByPublicIdInput,
  UpdateGazetteIssueInput,
} from "#/features/gazette/server/gazette-schemas";
import { recordAuditEvent } from "#/server/audit/audit-log.server";
import { generatePublicId } from "#/server/auth/ids";
import { getDb, schema } from "#/server/db";
import { shortContentHash } from "#/server/r2/image-codec.server";
import {
  deleteGazettePdf,
  gazettePdfKey,
  GAZETTE_MAX_BYTES,
  putGazettePdf,
} from "#/server/r2/gazette.server";

// ── public shapes ───────────────────────────────────────────────────────

export interface GazetteIssueSummary {
  id: string;
  publicId: string;
  schoolYear: string;
  startYear: number;
  issueNumber: number;
  title: string | null;
  editor: string | null;
  publishedAt: Date | null;
  description: string | null;
  pdfKey: string;
  pdfBytes: number;
}

// ── reads ───────────────────────────────────────────────────────────────

export async function getGazetteIssuesAction(): Promise<{
  issues: GazetteIssueSummary[];
}> {
  const rows = await listGazetteIssues();
  return {
    issues: rows.map((r) => ({
      id: r.id,
      publicId: r.publicId,
      schoolYear: r.schoolYear,
      startYear: r.startYear,
      issueNumber: r.issueNumber,
      title: r.title,
      editor: r.editor,
      publishedAt: r.publishedAt,
      description: r.description,
      pdfKey: r.pdfKey,
      pdfBytes: r.pdfBytes,
    })),
  };
}

export async function getGazetteIssueByPublicIdAction(
  input: GetGazetteIssueByPublicIdInput,
): Promise<GazetteIssueSummary | null> {
  const row = await getGazetteIssueByPublicId(input.publicId);
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    publicId: row.publicId,
    schoolYear: row.schoolYear,
    startYear: row.startYear,
    issueNumber: row.issueNumber,
    title: row.title,
    editor: row.editor,
    publishedAt: row.publishedAt,
    description: row.description,
    pdfKey: row.pdfKey,
    pdfBytes: row.pdfBytes,
  };
}

// ── mutations (public_gazette:manage) ───────────────────────────────────

const PDF_DATA_URL_RE = /^data:application\/pdf;base64,([A-Za-z0-9+/]+={0,2})$/;
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46]; // "%PDF"

function decodePdfDataUrl(dataUrl: string): ArrayBuffer {
  const match = PDF_DATA_URL_RE.exec(dataUrl);
  if (!match) {
    throw new Error("PDF data URL is not the expected application/pdf shape");
  }
  const binary = atob(match[1]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  if (bytes.byteLength > GAZETTE_MAX_BYTES) {
    throw new Error(
      `PDF exceeds ${GAZETTE_MAX_BYTES} bytes (got ${bytes.byteLength})`,
    );
  }
  // Magic-byte check: even if the dataUrl prefix says application/pdf,
  // an attacker who skips the client could lie. Validate the actual
  // bytes start with `%PDF`.
  if (
    bytes.length < 4 ||
    bytes[0] !== PDF_MAGIC[0] ||
    bytes[1] !== PDF_MAGIC[1] ||
    bytes[2] !== PDF_MAGIC[2] ||
    bytes[3] !== PDF_MAGIC[3]
  ) {
    throw new Error("PDF bytes do not begin with the %PDF magic header");
  }
  return bytes.buffer;
}

export async function createGazetteIssueAction(
  input: CreateGazetteIssueInput,
): Promise<{ publicId: string }> {
  const principal = await requireGazetteManager();

  const bytes = decodePdfDataUrl(input.pdfDataUrl);
  const id = uuidv7();
  const publicId = generatePublicId();
  const hash = await shortContentHash(bytes);
  const pdfKey = gazettePdfKey(id, hash);

  await putGazettePdf(pdfKey, bytes);

  try {
    await getDb().insert(schema.gazetteIssues).values({
      id,
      publicId,
      schoolYear: input.schoolYear,
      startYear: input.startYear,
      issueNumber: input.issueNumber,
      title: input.title,
      editor: input.editor,
      publishedAt: input.publishedAt,
      description: input.description,
      pdfKey,
      pdfBytes: bytes.byteLength,
      createdBy: principal.userId,
      updatedBy: principal.userId,
    });
  } catch (err) {
    // Insert failed (most likely unique-index violation on
    // school_year+issue_number). Clean up the orphan PDF we just
    // uploaded so we don't leak storage. Best-effort: if the delete
    // also fails, the orphan-GC sweep picks it up.
    void deleteGazettePdf(pdfKey).catch(() => {});
    throw err;
  }

  await recordAuditEvent({
    actorUserId: principal.userId,
    action: "gazette_issue.created",
    targetType: "gazette_issue",
    targetId: id,
    metadata: {
      schoolYear: input.schoolYear,
      issueNumber: input.issueNumber,
      title: input.title,
    },
  });

  return { publicId };
}

export async function updateGazetteIssueAction(
  input: UpdateGazetteIssueInput,
): Promise<{ ok: true }> {
  const principal = await requireGazetteManager();

  const existing = await getGazetteIssueByPublicId(input.publicId);
  if (!existing) {
    throw new Error("Gazette issue not found");
  }

  let pdfKey = existing.pdfKey;
  let pdfBytes = existing.pdfBytes;
  let oldKeyToDelete: string | null = null;

  if (input.pdfDataUrl) {
    const bytes = decodePdfDataUrl(input.pdfDataUrl);
    const hash = await shortContentHash(bytes);
    const newKey = gazettePdfKey(existing.id, hash);
    // Only swap if the content actually changed (hash differs).
    // Re-uploading identical bytes generates the same key and we
    // can skip the R2 + DB churn.
    if (newKey !== existing.pdfKey) {
      await putGazettePdf(newKey, bytes);
      oldKeyToDelete = existing.pdfKey;
      pdfKey = newKey;
      pdfBytes = bytes.byteLength;
    }
  }

  try {
    await getDb()
      .update(schema.gazetteIssues)
      .set({
        schoolYear: input.schoolYear,
        startYear: input.startYear,
        issueNumber: input.issueNumber,
        title: input.title,
        editor: input.editor,
        publishedAt: input.publishedAt,
        description: input.description,
        pdfKey,
        pdfBytes,
        updatedAt: new Date(),
        updatedBy: principal.userId,
      })
      .where(eq(schema.gazetteIssues.id, existing.id));
  } catch (err) {
    // UPDATE failed (most likely unique-index violation on
    // school_year+issue_number after edit). If we already PUT a
    // replacement PDF, that fresh key is now orphaned — clean it
    // up to mirror the symmetric handling on insert. The old PDF
    // is still referenced by the row, so we leave it alone.
    if (pdfKey !== existing.pdfKey) {
      void deleteGazettePdf(pdfKey).catch(() => {});
    }
    throw err;
  }

  // Best-effort cleanup of the previous PDF. If the delete fails the
  // orphan-GC sweep picks it up on the next daily run.
  if (oldKeyToDelete) {
    void deleteGazettePdf(oldKeyToDelete).catch(() => {});
  }

  await recordAuditEvent({
    actorUserId: principal.userId,
    action: "gazette_issue.updated",
    targetType: "gazette_issue",
    targetId: existing.id,
    metadata: {
      schoolYear: input.schoolYear,
      issueNumber: input.issueNumber,
      title: input.title,
    },
  });

  return { ok: true };
}

export async function deleteGazetteIssueAction(
  input: DeleteGazetteIssueInput,
): Promise<{ ok: true }> {
  const principal = await requireGazetteManager();

  const existing = await getGazetteIssueByPublicId(input.publicId);
  if (!existing) {
    throw new Error("Gazette issue not found");
  }

  await getDb()
    .delete(schema.gazetteIssues)
    .where(eq(schema.gazetteIssues.id, existing.id));

  // Best-effort R2 cleanup. The orphan-GC sweep covers any failure.
  void deleteGazettePdf(existing.pdfKey).catch(() => {});

  await recordAuditEvent({
    actorUserId: principal.userId,
    action: "gazette_issue.deleted",
    targetType: "gazette_issue",
    targetId: existing.id,
    metadata: {
      schoolYear: existing.schoolYear,
      issueNumber: existing.issueNumber,
      title: existing.title,
    },
  });

  return { ok: true };
}
