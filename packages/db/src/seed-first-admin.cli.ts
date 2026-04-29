import { seedFirstAdmin } from "./seed-first-admin";

async function main() {
  const result = await seedFirstAdmin();
  console.log(
    JSON.stringify(
      {
        status: "ok",
        tenant_id: result.tenantId,
        user_id: result.userId,
        email: result.email
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
