/**
 * A §9.1 committee vote as a bar over the whole committee, with the
 * two-thirds line marked. Decoration only (`aria-hidden`): the caller
 * always states the numbers in text beside it.
 */
export function VoteBar({
  votesFor,
  votesAgainst,
  votesAbstain,
  committeeSize,
}: {
  votesFor: number;
  votesAgainst: number;
  votesAbstain: number;
  committeeSize: number;
}) {
  if (committeeSize <= 0) {
    return null;
  }
  // Clamped so an over-count typed into the form cannot overflow the bar.
  const share = (n: number) =>
    `${Math.min(100, Math.max(0, (n / committeeSize) * 100))}%`;
  return (
    <div aria-hidden="true" className="relative py-1">
      <div className="flex h-3 overflow-hidden rounded-full bg-muted">
        <div
          className="bg-conduct-termination"
          style={{ width: share(votesFor) }}
        />
        <div
          className="bg-conduct-note"
          style={{ width: share(votesAgainst) }}
        />
        <div className="bg-border" style={{ width: share(votesAbstain) }} />
      </div>
      <div
        className="absolute top-0 h-5 w-0.5 -translate-x-1/2 rounded-full bg-foreground"
        style={{ left: `${(200 / 3).toFixed(3)}%` }}
      />
    </div>
  );
}
