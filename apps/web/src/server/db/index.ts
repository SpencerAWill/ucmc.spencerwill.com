import { drizzle } from "drizzle-orm/d1";
import type { DrizzleD1Database } from "drizzle-orm/d1";

import { env } from "#/server/cloudflare-env";
import * as schema from "../../../drizzle/schema.ts";

// Lazy singleton so the D1 binding is only touched when a server-fn handler
// actually runs. Module-level evaluation stays pure — important because this
// file can end up in the client bundle (TanStack Start's RPC compiler
// doesn't strip transitive server-module imports), and the client-side stub
// for `cloudflare:workers` throws if accessed.
let _db: DrizzleD1Database<typeof schema> | null = null;

export function getDb(): DrizzleD1Database<typeof schema> {
  if (!_db) {
    _db = drizzle(env.DB, { schema });
  }
  return _db;
}

export { schema };
