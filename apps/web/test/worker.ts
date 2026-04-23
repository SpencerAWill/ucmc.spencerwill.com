/**
 * Minimal stub entrypoint for the vitest-pool-workers runtime. Tests
 * import application modules directly (server fns, db helpers, etc.) —
 * they never dispatch fetch events through this worker — so the
 * `fetch` handler below just exists to satisfy Miniflare's "a worker
 * must have an entry" requirement. The real production entry is
 * `@tanstack/react-start/server-entry`, which can't be resolved at
 * test time because the TanStack Start Vite plugin synthesizes it.
 */
export default {
  async fetch(): Promise<Response> {
    return new Response("test-only worker; use imports not fetch", {
      status: 501,
    });
  },
};
