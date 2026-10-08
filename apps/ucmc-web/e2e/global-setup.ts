import { sweepSeededUsers } from "./fixtures/db";

/**
 * Clear the previous run's seeded users before the suite starts.
 *
 * Runs once per `playwright test` invocation, before any worker — see
 * {@link sweepSeededUsers} for why the accumulation is a correctness
 * problem and not just housekeeping.
 *
 * **Before rather than after.** A teardown sweep would leave the
 * database clean but throw away the rows behind a failure, exactly
 * when they are worth inspecting. Sweeping on the way in keeps the
 * last run's state available for debugging and still guarantees each
 * run starts from a known floor.
 *
 * It is deliberately not fatal. On CI the database is fresh and this
 * deletes nothing; if the file is missing entirely (no
 * `db:migrate:local` yet) the suite's own first seed will raise a far
 * clearer error than a failed global setup would.
 */
export default function globalSetup(): void {
  try {
    const removed = sweepSeededUsers();
    if (removed > 0) {
      console.log(`[e2e] swept ${removed} user(s) from previous runs`);
    }
  } catch (error) {
    console.warn(`[e2e] seeded-user sweep skipped: ${String(error)}`);
  }
}
