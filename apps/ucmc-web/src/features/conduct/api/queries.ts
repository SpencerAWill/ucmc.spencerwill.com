import { conductKeys } from "#/features/conduct/api/query-keys";
import type {
  ListRecordsFilter,
  PreviewNoticeInput,
} from "#/features/conduct/server/limits";
import {
  listConductReportsFn,
  searchReportSubjectsFn,
} from "#/features/conduct/server/report-fns";
import {
  getConductRecordFn,
  getConductSubjectFn,
  getMyActiveSanctionsFn,
  listConductRecordsFn,
  memberConductSummaryFn,
  previewConductNoticeFn,
  searchConductSubjectsFn,
} from "#/features/conduct/server/record-fns";

export function conductReportsQueryOptions(
  status?: "new" | "accepted" | "dismissed",
) {
  return {
    queryKey: conductKeys.reports({ status }),
    queryFn: () => listConductReportsFn({ data: { status } }),
    staleTime: 30_000,
  } as const;
}

export function reportSubjectsQueryOptions(q: string) {
  return {
    queryKey: conductKeys.reportSubjects(q),
    queryFn: () => searchReportSubjectsFn({ data: { q } }),
    staleTime: 30_000,
  } as const;
}

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

export function conductSubjectQueryOptions(publicId: string) {
  return {
    queryKey: conductKeys.subject(publicId),
    queryFn: () => getConductSubjectFn({ data: { publicId } }),
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

export function myActiveSanctionsQueryOptions() {
  return {
    queryKey: conductKeys.mine,
    queryFn: () => getMyActiveSanctionsFn(),
    staleTime: 30_000,
  } as const;
}

/** Exactly what the member would be emailed. Never cached past the dialog. */
export function conductNoticePreviewQueryOptions(input: PreviewNoticeInput) {
  return {
    queryKey: conductKeys.preview(input),
    queryFn: () => previewConductNoticeFn({ data: input }),
    staleTime: 0,
    gcTime: 0,
    retry: false,
  } as const;
}
