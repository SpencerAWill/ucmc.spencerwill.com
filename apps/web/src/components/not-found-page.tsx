import { Home } from "lucide-react";
import { Link } from "@tanstack/react-router";

import { Button } from "#/components/ui/button";

export function NotFoundPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 p-8 text-center">
      <p className="text-8xl font-bold tracking-tight text-muted-foreground sm:text-9xl">
        404
      </p>
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Page not found
        </h1>
        <p className="text-muted-foreground">
          The page you&apos;re looking for doesn&apos;t exist or has moved.
        </p>
      </div>
      <Button asChild variant="default">
        <Link to="/">
          <Home />
          Go home
        </Link>
      </Button>
    </div>
  );
}
