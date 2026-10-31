import { conductKeys } from "#/features/conduct/api/query-keys";
import type { ListRecordsFilter } from "#/features/conduct/server/limits";
import {
  getConductRecordFn,
  listConductRecordsFn,
  memberConductSummaryFn,
  searchConductSubjectsFn,
} from "#/features/conduct/server/record-fns";

export function conductRecordsQueryOptions(filter: ListRecordsFilter = {}) {
  return {
    queryKey: conductKeys.records(filter),
    queryFn: () => listConductRecordsFn({ data: filter }),
    staleTime: 30_000,
  } as const;
}

export function conductRecordQueryOptions(publicId: string) {
  return {
    queryKey: conductKeys.record(publicId),
    queryFn: () => getConductRecordFn({ data: { publicId } }),
    staleTime: 30_000,
  } as const;
}

export function conductSubjectsQueryOptions(q: string) {
  return {
    queryKey: conductKeys.subjects(q),
    queryFn: () => searchConductSubjectsFn({ data: { q } }),
    staleTime: 30_000,
  } as const;
}

export function memberConductSummaryQueryOptions(userId: string) {
  return {
    queryKey: conductKeys.member(userId),
    queryFn: () => memberConductSummaryFn({ data: { userId } }),
    staleTime: 30_000,
  } as const;
}
