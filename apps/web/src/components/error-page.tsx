import { AlertTriangle, Home, RefreshCw } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";

import { Button } from "#/components/ui/button";

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
      {error.message ? (
        <pre className="max-w-2xl overflow-x-auto rounded-md border bg-muted px-4 py-3 text-left text-xs text-muted-foreground">
          {error.message}
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
