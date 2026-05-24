import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  formatWorkspaceMigrationReportMarkdown,
  generateWorkspaceMigrationReport
} from "./workspace-migration-report";

type CliOptions = {
  format: "markdown" | "json";
  output: string | null;
};

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = await generateWorkspaceMigrationReport();
  const rendered =
    options.format === "json"
      ? `${JSON.stringify(report, null, 2)}\n`
      : formatWorkspaceMigrationReportMarkdown(report);

  if (options.output) {
    const outputPath = resolve(options.output);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, rendered, "utf8");
    console.log(`Workspace migration report written to ${outputPath}`);
    return;
  }

  process.stdout.write(rendered);
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = { format: "markdown", output: null };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--format") {
      const value = args[index + 1];
      if (value !== "json" && value !== "markdown") {
        throw new Error("--format must be json or markdown.");
      }
      options.format = value;
      index += 1;
      continue;
    }
    if (arg === "--output") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("--output requires a file path.");
      }
      options.output = value;
      index += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function printHelp() {
  console.log(`Usage: pnpm --filter @openkb/db workspace:migration-report [options]

Options:
  --format markdown|json   Output format. Defaults to markdown.
  --output <path>          Write the report to a file instead of stdout.
  -h, --help               Show this help message.
`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
