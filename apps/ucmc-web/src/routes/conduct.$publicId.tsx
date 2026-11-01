import { useQuery } from "@tanstack/react-query";
import { createFileRoute, notFound } from "@tanstack/react-router";

import { useAuth } from "#/features/auth/api/use-auth";
import { conductRecordQueryOptions } from "#/features/conduct/api/queries";
import { RecordDetail } from "#/features/conduct/components/record-detail";
import { requirePageFlag } from "#/features/settings/api/page-guards";

export const Route = createFileRoute("/conduct/$publicId")({
  beforeLoad: async ({ context }) => {
    await requirePageFlag(context.queryClient, "conduct");
  },
  loader: async ({ context, params }) => {
    const record = await context.queryClient.ensureQueryData(
      conductRecordQueryOptions(params.publicId),
    );
    if (!record) {
      throw notFound();
    }
  },
  component: RecordPage,
});

function RecordPage() {
  const { publicId } = Route.useParams();
  const { hasPermission } = useAuth();
  const { data } = useQuery(conductRecordQueryOptions(publicId));
  if (!data) {
    return null;
  }
  return (
    <RecordDetail record={data} canManage={hasPermission("conduct:manage")} />
  );
}
