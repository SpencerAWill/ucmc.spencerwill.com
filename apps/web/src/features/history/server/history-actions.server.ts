/**
 * Read-only history actions. /history is public — no auth, no rate
 * limiting beyond what the global health limiter does. The shape is
 * grouped-by-year so the view layer can render section headers cheaply.
 */
import {
  listHistoricalOfficers,
  listHonoraryMembers,
  readNarrativeMarkdown,
} from "#/features/history/server/history-repo.server";

export interface OfficerEntry {
  id: number;
  role: string;
  roleOrder: number;
  name: string;
  notes: string | null;
}

export interface OfficerYearGroup {
  schoolYear: string;
  startYear: number;
  officers: OfficerEntry[];
}

export interface HonoraryEntry {
  id: number;
  name: string;
  notes: string | null;
}

export interface HistoryContent {
  narrativeMarkdown: string;
  officersByYear: OfficerYearGroup[];
  honoraryMembers: HonoraryEntry[];
}

export async function getHistoryContentAction(): Promise<HistoryContent> {
  const [narrativeMarkdown, officers, honorary] = await Promise.all([
    readNarrativeMarkdown(),
    listHistoricalOfficers(),
    listHonoraryMembers(),
  ]);

  // Already sorted by start_year DESC, role_order ASC from the repo.
  // Group adjacent rows by schoolYear.
  const officersByYear: OfficerYearGroup[] = [];
  for (const row of officers) {
    const last = officersByYear.at(-1);
    if (last?.schoolYear === row.schoolYear) {
      last.officers.push({
        id: row.id,
        role: row.role,
        roleOrder: row.roleOrder,
        name: row.name,
        notes: row.notes,
      });
    } else {
      officersByYear.push({
        schoolYear: row.schoolYear,
        startYear: row.startYear,
        officers: [
          {
            id: row.id,
            role: row.role,
            roleOrder: row.roleOrder,
            name: row.name,
            notes: row.notes,
          },
        ],
      });
    }
  }

  return {
    narrativeMarkdown,
    officersByYear,
    honoraryMembers: honorary.map((h) => ({
      id: h.id,
      name: h.name,
      notes: h.notes,
    })),
  };
}
