/**
 * The termination notice on `/deactivated`. It answers only someone who
 * has proved who they are: the account's own session, or the signed
 * magic-link proof cookie for a blocked address (the visitor has just
 * shown they control that inbox). Anyone else gets null, so the page
 * never confirms to a stranger that an address or person was terminated.
 *
 * The session is read with `loadCurrentSession`, not
 * `loadCurrentPrincipal`: the principal loader answers null for a
 * deactivated account, and a terminated account is deactivated.
 */
import {
  findActiveTerminationStatementByFingerprint,
  findActiveTerminationStatementFor,
} from "#/features/conduct/server/record-repo.server";
import { readProofCookie } from "#/server/auth/proof-cookie.server";
import { loadCurrentSession } from "#/server/auth/session.server";
import { emailFingerprint } from "#/server/conduct/email-fingerprint.server";
import { APPEAL_LINE } from "#/server/email/conduct-email";

export interface TerminationNotice {
  statement: string;
  appealText: string;
}

export async function getMyTerminationNoticeAction(): Promise<TerminationNotice | null> {
  const session = await loadCurrentSession();
  if (session) {
    const statement = await findActiveTerminationStatementFor(session.userId);
    if (statement !== null) {
      return { statement, appealText: APPEAL_LINE };
    }
  }

  const proof = await readProofCookie();
  if (proof) {
    // The same match `isBlockedEmail` makes (an unlifted termination's
    // fingerprint), returning the statement rather than a boolean.
    const statement = await findActiveTerminationStatementByFingerprint(
      await emailFingerprint(proof.email),
    );
    if (statement !== null) {
      return { statement, appealText: APPEAL_LINE };
    }
  }
  return null;
}
