import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <h1 className="text-center text-5xl font-bold tracking-tight text-muted-foreground sm:text-6xl md:text-7xl">
        Work in Progress
      </h1>
    </div>
  );
}
