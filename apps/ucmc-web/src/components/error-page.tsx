import { AlertTriangle, Home, RefreshCw } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";

import { Alert, AlertDescription, AlertTitle } from "#/components/ui/alert";
import { Button } from "#/components/ui/button";

/**
 * TanStack Router types `ErrorComponentProps["error"]` as `unknown` — a thrown
 * value is not required to be an `Error`, and a route that rejects with a
 * string or a plain object would otherwise render `undefined` here. Narrow
 * once, so both boundaries below agree on what is safe to display.
 */
function errorMessage(error: unknown): string | undefined {
  return error instanceof Error && error.message ? error.message : undefined;
}

export function ErrorPage({ error, reset }: ErrorComponentProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 p-8 text-center">
      <AlertTriangle className="size-16 text-destructive" />
      <div className="space-y-2">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          Something went wrong
        </h1>
        <p className="text-muted-foreground">
          An unexpected error occurred. You can try again or head home.
        </p>
      </div>
      {errorMessage(error) ? (
        <pre className="max-w-2xl overflow-x-auto rounded-md border bg-muted px-4 py-3 text-left text-xs text-muted-foreground">
          {errorMessage(error)}
        </pre>
      ) : null}
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Button onClick={reset} variant="default">
          <RefreshCw />
          Try again
        </Button>
        <Button asChild variant="outline">
          <Link to="/">
            <Home />
            Go home
          </Link>
        </Button>
      </div>
    </div>
  );
}

/**
 * Compact fallback for route-segment-level error boundaries. Renders inside
 * the parent layout (header / sidebar / tabs stay intact) so a failure in one
 * section doesn't take the whole app down. Use as `errorComponent` on routes
 * that own meaningful UI; `ErrorPage` (above) remains the global default.
 */
export function RouteErrorFallback({ error, reset }: ErrorComponentProps) {
  return (
    <Alert variant="destructive" className="my-6">
      <AlertTriangle />
      <AlertTitle>Something went wrong loading this section.</AlertTitle>
      <AlertDescription className="gap-3">
        {errorMessage(error) ? (
          <pre className="max-w-full overflow-x-auto rounded-sm bg-background/60 px-2 py-1 text-xs text-muted-foreground">
            {errorMessage(error)}
          </pre>
        ) : null}
        <Button size="sm" variant="outline" onClick={reset}>
          <RefreshCw className="size-3.5" />
          Try again
        </Button>
      </AlertDescription>
    </Alert>
  );
}
