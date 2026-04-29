import { WorkbenchClient } from "@/components/workbench/workbench-client";

export default async function DocumentPage({
  params
}: {
  params: Promise<{ kbId: string; docId: string }>;
}) {
  const { kbId, docId } = await params;

  return <WorkbenchClient initialDocumentId={docId} initialKnowledgeBaseId={kbId} />;
}
