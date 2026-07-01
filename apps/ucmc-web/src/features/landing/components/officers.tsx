import { useQuery } from "@tanstack/react-query";

import { Card, CardContent } from "#/components/ui/card";
import { UserAvatar } from "#/components/user-avatar";
import { landingContentQueryOptions } from "#/features/landing/api/queries";

interface OfficerCard {
  key: string;
  userId: string;
  preferredName: string;
  avatarKey: string | null;
  roleDisplayName: string;
}

export function Officers() {
  const { data } = useQuery(landingContentQueryOptions());
  const officerRoles = data?.officers ?? [];

  // Flatten the grouped (role, members[]) shape into one card per person.
  // Role-position ordering is preserved by the server (`ORDER BY position`),
  // so iterating in order here keeps the visual ordering stable.
  const cards: OfficerCard[] = [];
  for (const role of officerRoles) {
    for (const member of role.members) {
      cards.push({
        key: `${role.roleId}:${member.userId}`,
        userId: member.userId,
        preferredName: member.preferredName,
        avatarKey: member.avatarKey,
        roleDisplayName: role.displayName,
      });
    }
  }

  // Section is hidden entirely when no officer role is flagged or none have
  // claimed members yet. Keeps the home page from showing a stub block before
  // the roster is populated.
  if (cards.length === 0) {
    return null;
  }

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
          {cards.map((card) => (
            <Card key={card.key}>
              <CardContent className="flex flex-col items-center gap-3 pt-6 text-center">
                <UserAvatar
                  avatarKey={card.avatarKey}
                  name={card.preferredName}
                  className="size-20"
                  fallbackClassName="text-lg"
                />
                <div className="space-y-1">
                  <p className="font-semibold">{card.preferredName}</p>
                  <p className="text-sm text-primary">{card.roleDisplayName}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
