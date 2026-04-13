import { createFileRoute } from "@tanstack/react-router";

import { ProfileForm } from "#/components/auth/profile-form";
import { requireAuth } from "#/lib/auth/guards";

export const Route = createFileRoute("/register/profile")({
  beforeLoad: async ({ context }) => {
    await requireAuth(context.queryClient, "/register/profile");
  },
  component: ProfilePage,
});

function ProfilePage() {
  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 p-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Tell us about yourself</h1>
        <p className="text-muted-foreground text-sm">
          We need this information to process your membership. After you submit,
          an exec member will review your application.
        </p>
      </header>
      <ProfileForm />
    </div>
  );
}
