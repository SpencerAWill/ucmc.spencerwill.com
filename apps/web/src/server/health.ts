/**
 * Route-facing shell for the /health probe. The actual D1/R2/KV checks
 * live in `./health.server` and are loaded via dynamic import inside the
 * handler body so the client bundle never pulls in the server-only
 * binding modules.
 */
import { createServerFn } from "@tanstack/react-start";

/**
 * Per-check shape. `output` is set only on failure so the client can render
 * an inline error message without tripping an error boundary.
 */
export interface HealthCheck {
  name: string;
  status: "pass" | "fail";
  time: string;
  output?: string;
}

export interface HealthReport {
  status: "pass" | "fail";
  checks: HealthCheck[];
}

export const checkHealth = createServerFn({ method: "GET" }).handler(
  async (): Promise<HealthReport> => {
    const { performHealthChecks } = await import("#/server/health.server");
    return performHealthChecks();
  },
);
