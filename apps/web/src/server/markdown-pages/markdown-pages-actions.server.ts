/**
 * Read + write actions for `markdown_pages`. Each mutation gates on
 * the slug's per-page `*:manage` permission (resolved via the
 * permission map in `./slugs`), so a `public_policies:manage` holder
 * can edit /policies but not /scholarships. The read is anonymous-safe
 * — gating is the route layer's job.
 *
 * One audit action covers every page edit: `markdown_page.updated`,
 * with `{ slug, markdownLength }` metadata. The legacy
 * `history.narrative_updated` action stays in the enum for older
 * audit rows but no new code emits it.
 */
import type {
  GetMarkdownPageInput,
  UpdateMarkdownPageInput,
} from "#/server/markdown-pages/markdown-pages-schemas";
import {
  readMarkdownPage,
  writeMarkdownPage,
} from "#/server/markdown-pages/markdown-pages-repo.server";
import { permissionsForSlug } from "#/server/markdown-pages/slugs";
import { recordAuditEvent } from "#/server/audit/audit-log.server";
import type { Principal } from "#/server/auth/principal.server";
import { loadCurrentPrincipal } from "#/server/auth/session.server";

async function requireMarkdownPageManager(
  slug: UpdateMarkdownPageInput["slug"],
): Promise<Principal> {
  const principal = await loadCurrentPrincipal();
  if (!principal) {
    throw new Error("Not signed in");
  }
  const { manage } = permissionsForSlug(slug);
  if (!principal.permissions.includes(manage)) {
    throw new Error(`Forbidden: missing ${manage}`);
  }
  return principal;
}

export async function getMarkdownPageAction(
  input: GetMarkdownPageInput,
): Promise<{ slug: GetMarkdownPageInput["slug"]; markdown: string }> {
  const markdown = await readMarkdownPage(input.slug);
  return { slug: input.slug, markdown };
}

export async function updateMarkdownPageAction(
  input: UpdateMarkdownPageInput,
): Promise<{ ok: true }> {
  const principal = await requireMarkdownPageManager(input.slug);
  await writeMarkdownPage(input.slug, input.markdown, principal.userId);
  await recordAuditEvent({
    actorUserId: principal.userId,
    action: "markdown_page.updated",
    targetType: "markdown_page",
    targetId: input.slug,
    // Length only, not the body — the markdown is public anyway, but
    // logging the full body on every edit would bloat audit rows.
    metadata: {
      slug: input.slug,
      markdownLength: input.markdown.length,
    },
  });
  return { ok: true };
}
