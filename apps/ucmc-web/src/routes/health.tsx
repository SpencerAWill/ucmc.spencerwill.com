import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, XCircle } from "lucide-react";

import { checkHealth } from "#/server/health";
import { cn } from "#/lib/utils";

export const Route = createFileRoute("/health")({
  loader: () => checkHealth(),
  component: HealthPage,
  // Always re-run on revisit — stale health data is misleading.
  staleTime: 0,
});

function HealthPage() {
  const report = Route.useLoaderData();
  const ok = report.status === "pass";
  return (
    <div className="flex flex-1 items-start justify-center p-8">
      <div className="w-full max-w-xl space-y-6">
        <header className="flex items-center gap-3">
          {ok ? (
            <CheckCircle2 className="h-8 w-8 text-emerald-600" />
          ) : (
            <XCircle className="h-8 w-8 text-destructive" />
          )}
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {ok ? "All systems operational" : "Service unhealthy"}
            </h1>
            <p className="text-sm text-muted-foreground">
              Live readiness check — refresh to re-run.
            </p>
          </div>
        </header>

        <section className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">Checks</h2>
          <ul className="divide-y rounded-lg border">
            {report.checks.map((check) => {
              const passed = check.status === "pass";
              return (
                <li
                  key={check.name}
                  className="flex items-start justify-between gap-4 p-4"
                >
                  <div className="space-y-1">
                    <p className="font-mono text-sm">{check.name}</p>
                    {check.output ? (
                      <p className="text-xs text-muted-foreground">
                        {check.output}
                      </p>
                    ) : null}
                    <p className="text-xs text-muted-foreground">
                      {check.time}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-xs font-medium",
                      passed
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
                        : "bg-destructive/10 text-destructive",
                    )}
                  >
                    {check.status}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </div>
  );
}
