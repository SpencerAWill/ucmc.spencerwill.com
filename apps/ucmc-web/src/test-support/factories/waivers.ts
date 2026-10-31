/**
 * D1 factory for waiver attestations (#323).
 */
import { currentSeason } from "#/config/club-season";
import { WAIVER_VERSION } from "#/config/legal";
import { getDb, schema } from "#/server/db";

type WaiverAttestationInsert = typeof schema.waiverAttestations.$inferInsert;

/**
 * A live attestation of the current waiver for the current season,
 * which is what "waiver current" means everywhere it is checked. Pass
 * `cycle`, `version` or `revokedAt` to build the stale cases.
 */
export async function createWaiverAttestation(
  overrides: Partial<WaiverAttestationInsert> & { userId: string },
) {
  const [attestation] = await getDb()
    .insert(schema.waiverAttestations)
    .values({
      id: `wat_${crypto.randomUUID()}`,
      cycle: currentSeason(),
      version: WAIVER_VERSION,
      attestedAt: Temporal.Now.instant(),
      ...overrides,
    })
    .returning();
  return attestation;
}
