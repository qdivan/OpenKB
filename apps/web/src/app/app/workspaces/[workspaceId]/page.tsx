import { WorkbenchClient } from "@/components/workbench/workbench-client";

export default async function WorkspacePage({
  params
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;

  return <WorkbenchClient initialWorkspaceId={workspaceId} />;
}
