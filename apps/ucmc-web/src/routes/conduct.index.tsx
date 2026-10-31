import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/conduct/")({
  beforeLoad: () => {
    throw redirect({ to: "/conduct/records", replace: true });
  },
});
