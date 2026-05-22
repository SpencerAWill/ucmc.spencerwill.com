/**
 * Read + write actions for `markdown_pages`. Each mutation gates on
 * the slug's per-page `*:manage` permission (resolved via the
 * permission map in `./slugs`), so a `public_policies:manage` holder
 * can edit /policies but not /scholarships. The read mirrors the
 * `*:view` half of that pair so a slug whose view permission is not
 * granted to `role_anonymous` (e.g. `history.narrative`) can't be
 * fetched by signed-out callers via the server fn — the route guard
 * isn't the only enforcement point.
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
import { loadAnonymousPermissions } from "#/server/auth/principal.server";
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

/**
 * Server-side equivalent of `requireViewPermission` for this action
 * layer. We can't import the client-side guard (it takes a
 * QueryClient), so re-derive: an authenticated principal needs the
 * slug's view permission on their effective set; anonymous callers
 * need it on `role_anonymous`.
 */
async function assertCanViewSlug(
  slug: GetMarkdownPageInput["slug"],
): Promise<void> {
  const { view } = permissionsForSlug(slug);
  const principal = await loadCurrentPrincipal();
  if (principal) {
    if (!principal.permissions.includes(view)) {
      throw new Error(`Forbidden: missing ${view}`);
    }
    return;
  }
  const anonPerms = await loadAnonymousPermissions();
  if (!anonPerms.includes(view)) {
    throw new Error(`Forbidden: missing ${view}`);
  }
}

export async function getMarkdownPageAction(
  input: GetMarkdownPageInput,
): Promise<{ slug: GetMarkdownPageInput["slug"]; markdown: string }> {
  await assertCanViewSlug(input.slug);
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
