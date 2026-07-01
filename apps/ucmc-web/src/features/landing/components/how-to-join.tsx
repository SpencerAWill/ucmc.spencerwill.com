import { Link } from "@tanstack/react-router";

import { Button } from "#/components/ui/button";

const steps = [
  {
    number: "1",
    title: "Create an account",
    body: "Sign up with your email — we&apos;ll send you a magic link.",
  },
  {
    number: "2",
    title: "Submit your profile",
    body: "Tell us your name, year, and an emergency contact. Takes about a minute.",
  },
  {
    number: "3",
    title: "Wait for approval",
    body: "An officer will review your registration. Usually within a few days.",
  },
];

export function HowToJoin() {
  return (
    <section className="border-b py-16 md:py-20">
      <div className="mx-auto max-w-5xl px-6">
        <div className="mb-10 space-y-2 text-center">
          <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
            How to join
          </h2>
          <p className="text-muted-foreground">
            Three steps. We approve manually so we know who&apos;s coming on
            trips.
          </p>
        </div>
        <ol className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {steps.map((step) => (
            <li
              key={step.number}
              className="flex flex-col items-start gap-3 rounded-lg border bg-card p-6"
            >
              <span className="flex size-10 items-center justify-center rounded-full bg-primary text-lg font-semibold text-primary-foreground">
                {step.number}
              </span>
              <h3 className="text-lg font-semibold">{step.title}</h3>
              <p className="text-sm text-muted-foreground">{step.body}</p>
            </li>
          ))}
        </ol>
        <div className="mt-10 flex justify-center">
          <Button asChild size="lg">
            <Link to="/sign-in" search={{ register: true }}>
              Get started
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
