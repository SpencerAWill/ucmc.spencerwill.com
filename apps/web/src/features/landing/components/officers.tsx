import { Avatar, AvatarFallback, AvatarImage } from "#/components/ui/avatar";
import { Card, CardContent } from "#/components/ui/card";

type Officer = {
  name: string;
  role: string;
  bio: string;
  photoSrc?: string;
};

// TODO(content): replace with the current officer roster. Drop optional
// headshots into apps/web/public/landing/officers/ and set photoSrc.
const officers: Array<Officer> = [
  {
    name: "TODO(content): Name",
    role: "President",
    bio: "TODO(content): one-line bio",
  },
  {
    name: "TODO(content): Name",
    role: "Vice President",
    bio: "TODO(content): one-line bio",
  },
  {
    name: "TODO(content): Name",
    role: "Treasurer",
    bio: "TODO(content): one-line bio",
  },
  {
    name: "TODO(content): Name",
    role: "Trip Coordinator",
    bio: "TODO(content): one-line bio",
  },
];

function initials(name: string): string {
  const cleaned = name.replace(/^TODO\(content\):\s*/i, "").trim();
  if (!cleaned) {
    return "?";
  }
  return cleaned
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");
}

export function Officers() {
  return (
    <section className="border-b py-16 md:py-20">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mb-10 space-y-2 text-center">
          <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
            Meet the officers
          </h2>
          <p className="text-muted-foreground">
            The folks running trips, training, and meetings this year.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {officers.map((officer) => (
            <Card key={officer.role}>
              <CardContent className="flex flex-col items-center gap-3 pt-6 text-center">
                <Avatar className="size-20">
                  {officer.photoSrc ? (
                    <AvatarImage src={officer.photoSrc} alt={officer.name} />
                  ) : null}
                  <AvatarFallback className="text-lg">
                    {initials(officer.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="space-y-1">
                  <p className="font-semibold">{officer.name}</p>
                  <p className="text-sm text-primary">{officer.role}</p>
                  <p className="text-sm text-muted-foreground">{officer.bio}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
