import { McpAuthService } from "./auth";

async function main() {
  const auth = new McpAuthService();
  try {
    const result = await auth.createPersonalAccessToken({
      userEmail: process.env.MCP_PAT_USER_EMAIL ?? "",
      name: process.env.MCP_PAT_NAME ?? "",
      scopes: process.env.MCP_PAT_SCOPES
        ? process.env.MCP_PAT_SCOPES.split(",").map((scope) => scope.trim())
        : undefined,
      expiresDays: process.env.MCP_PAT_EXPIRES_DAYS
        ? Number.parseInt(process.env.MCP_PAT_EXPIRES_DAYS, 10)
        : null
    });

    console.log(
      JSON.stringify(
        {
          id: result.id,
          user_id: result.userId,
          tenant_id: result.tenantId,
          name: result.name,
          scopes: result.scopes,
          expires_at: result.expiresAt,
          token: result.token
        },
        null,
        2
      )
    );
  } finally {
    await auth.disconnect();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
