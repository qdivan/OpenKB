import { DEV_ADMIN_PASSWORD, seedDev } from "./seed-dev";

async function main() {
  const result = await seedDev();
  console.log(
    JSON.stringify(
      {
        status: "ok",
        email: result.email,
        password: DEV_ADMIN_PASSWORD,
        tenant_id: result.tenantId,
        user_id: result.userId,
        workspace_id: result.workspaceId,
        knowledge_base_id: result.knowledgeBaseId,
        folder_id: result.folderId,
        document_id: result.documentId
      },
      null,
      2
    )
  );
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
