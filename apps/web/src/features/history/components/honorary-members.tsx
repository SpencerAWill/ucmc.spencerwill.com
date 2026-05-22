import type { HonoraryEntry } from "#/features/history/server/history-fns";

/**
 * Flat list of honorary UCMC members. Honorary membership is granted
 * by majority voting-member vote per Constitution §3.4. The list is
 * small and changes rarely; alphabetical sort by display order is
 * preserved from the legacy site rather than re-sorted in code.
 */
export function HonoraryMembers({ members }: { members: HonoraryEntry[] }) {
  if (members.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No honorary members on record yet.
      </p>
    );
  }
  return (
    <ul className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
      {members.map((m) => (
        <li key={m.id}>{m.name}</li>
      ))}
    </ul>
  );
}
