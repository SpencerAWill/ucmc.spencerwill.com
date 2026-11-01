const OUTCOME_LABELS: Record<string, string> = {
  returned: "SCCS returned it to the club",
  sccs_sanctioned: "SCCS sanctioned the member",
};

/**
 * A record's audit row as a timeline entry. Audit metadata carries the
 * level, the transition and ids only, so that is all an entry can say.
 * Pure, so the wording is testable without a component.
 */
export function historyLabel(
  action: string,
  metadataJson: string | null,
): string {
  const metadata = parseMetadata(metadataJson);
  switch (action) {
    case "conduct.record_created":
      return metadata.scocState === "referred"
        ? "Record created and referred to SCCS"
        : "Record created";
    case "conduct.record_updated":
      return "Internal notes edited";
    case "conduct.referred":
      return "Referred to SCCS";
    case "conduct.sccs_outcome":
      return typeof metadata.to === "string" &&
        Object.hasOwn(OUTCOME_LABELS, metadata.to)
        ? OUTCOME_LABELS[metadata.to]
        : "SCCS outcome recorded";
    case "conduct.lifted":
      return metadata.supersededBy ? "Lifted by a correction" : "Lifted";
    default:
      return action;
  }
}

function parseMetadata(json: string | null): Record<string, unknown> {
  if (json === null) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(json);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
