/**
 * Local D1 seed. Runs `wrangler d1 execute` against the local database to
 * apply seed.sql, then optionally promotes a developer email (SEED_ADMIN_EMAIL
 * from .dev.vars) to system_admin.
 *
 * Usage: pnpm db:seed:local
 */
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const DB_NAME = "ucmc-web-dev";
const ROOT = resolve(import.meta.dirname, "..");

function run(command: string) {
  console.log(`$ ${command}`);
  execSync(command, { cwd: ROOT, stdio: "inherit" });
}

function exec(sql: string) {
  // Escape double quotes for the shell.
  const escaped = sql.replace(/"/g, '\\"');
  run(`wrangler d1 execute ${DB_NAME} --local --command "${escaped}"`);
}

function readDevVars(): Record<string, string | undefined> {
  const path = resolve(ROOT, ".dev.vars");
  if (!existsSync(path)) return {};
  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const eq = line.indexOf("=");
        return [line.slice(0, eq).trim(), line.slice(eq + 1).trim()];
      }),
  );
}

console.log("→ Applying drizzle/seed.sql");
run(`wrangler d1 execute ${DB_NAME} --local --file drizzle/seed.sql`);

const devVars = readDevVars();
const adminEmail = devVars.SEED_ADMIN_EMAIL?.toLowerCase();
if (adminEmail) {
  console.log(`→ Promoting ${adminEmail} to system_admin`);
  const userId = `user_${randomUUID()}`;
  exec(
    `INSERT OR IGNORE INTO users (id, email, status, approved_at) VALUES ('${userId}', '${adminEmail}', 'approved', unixepoch() * 1000);`,
  );
  exec(
    `INSERT OR IGNORE INTO user_roles (user_id, role_id) SELECT id, 'role_system_admin' FROM users WHERE email = '${adminEmail}';`,
  );
} else {
  console.log(
    "→ No SEED_ADMIN_EMAIL in .dev.vars; skipping system_admin seed.",
  );
}

console.log("✔ Seed complete.");
