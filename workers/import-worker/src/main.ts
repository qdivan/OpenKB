import { getImportWorkerHealth } from "./health";
import { runImportOnce, runImportWatch } from "./processor";

async function main() {
  if (process.argv.includes("--once")) {
    console.log(JSON.stringify(await runImportOnce()));
    return;
  }

  if (process.argv.includes("--watch")) {
    await runImportWatch();
    return;
  }

  console.log(JSON.stringify(getImportWorkerHealth()));
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
