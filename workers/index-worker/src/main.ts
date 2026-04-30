import { getIndexWorkerHealth } from "./health";
import { runIndexWatch, runRebuildOnce } from "./processor";

async function main() {
  if (process.argv.includes("--once") || process.argv.includes("--rebuild-once")) {
    console.log(JSON.stringify(await runRebuildOnce()));
    return;
  }

  if (process.argv.includes("--watch")) {
    await runIndexWatch();
    return;
  }

  console.log(JSON.stringify(getIndexWorkerHealth()));
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
