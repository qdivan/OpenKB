import { DifyAuthService } from "./auth";

async function main() {
  const auth = new DifyAuthService();
  try {
    const result = await auth.createApiKey({
      createdByEmail: process.env.DIFY_KEY_CREATED_BY_EMAIL ?? "",
      name: process.env.DIFY_API_KEY_NAME ?? "",
      knowledgeId: process.env.DIFY_KNOWLEDGE_ID ?? "",
      knowledgeBaseId: process.env.DIFY_KNOWLEDGE_BASE_ID ?? "",
      topKLimit: process.env.DIFY_TOP_K_LIMIT
        ? Number.parseInt(process.env.DIFY_TOP_K_LIMIT, 10)
        : null,
      expiresDays: process.env.DIFY_KEY_EXPIRES_DAYS
        ? Number.parseInt(process.env.DIFY_KEY_EXPIRES_DAYS, 10)
        : null
    });

    console.log(JSON.stringify(result, null, 2));
  } finally {
    await auth.disconnect();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
