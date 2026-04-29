import { WorkbenchClient } from "@/components/workbench/workbench-client";

export default async function KnowledgeBasePage({ params }: { params: Promise<{ kbId: string }> }) {
  const { kbId } = await params;

  return <WorkbenchClient initialKnowledgeBaseId={kbId} />;
}
