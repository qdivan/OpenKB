#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const args = parseArgs(process.argv.slice(2));
const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "Z");
const outDir = path.resolve(args.out ?? `.codex-runtime/parity-runs/${timestamp}`);
mkdirSync(outDir, { recursive: true });
loadLocalEnvFile(args["env-file"] ? path.resolve(String(args["env-file"])) : path.resolve(".env"));

const mode = determineMode(args);

let reportDir = args["report-dir"] ? path.resolve(args["report-dir"]) : undefined;
if (args.zip) {
  reportDir = extractZip(path.resolve(String(args.zip)), path.join(outDir, "extracted"));
}

if (mode.generateFixtures) {
  const count = parsePositiveInt(args["fixture-count"], 40);
  const fixtureDir = path.join(outDir, "fixtures");
  generateFixtures(fixtureDir, count);
  summarizeGeneratedFixtures(fixtureDir, outDir);
}

if (reportDir) {
  summarizeReport(reportDir, outDir);
}

let corpusDir = args["corpus-dir"] ? path.resolve(String(args["corpus-dir"])) : undefined;
if (mode.downloadCorpus) {
  corpusDir = corpusDir ?? path.join(outDir, "corpus");
  await downloadPublicCorpus(corpusDir, parsePositiveInt(args["corpus-count"], 100));
}

if (mode.splitterParity) {
  if (!corpusDir) {
    throw new Error("--splitter-parity requires --corpus-dir or --download-public-corpus.");
  }
  await runSplitterParity(corpusDir, path.join(outDir, "splitter"));
}

if (mode.retrievalProbe) {
  await writeRetrievalEnvironmentReport(path.join(outDir, "retrieval"));
}

if (mode.liveRetrieval) {
  if (!corpusDir) {
    throw new Error("--live-retrieval requires --corpus-dir or --download-public-corpus.");
  }
  await runLiveRetrievalParity(corpusDir, path.join(outDir, "retrieval"), args);
}

if (!mode.any && !reportDir) {
  printUsageAndExit();
}

console.log(`Parity artifacts written to ${outDir}`);

function determineMode(parsed) {
  const publicCorpusRun = Boolean(parsed["public-corpus-run"]);
  const result = {
    generateFixtures: Boolean(parsed["generate-fixtures"]),
    downloadCorpus: Boolean(parsed["download-public-corpus"]) || publicCorpusRun,
    splitterParity: Boolean(parsed["splitter-parity"]) || publicCorpusRun,
    retrievalProbe: Boolean(parsed["retrieval-probe"]) || publicCorpusRun,
    liveRetrieval: Boolean(parsed["live-retrieval"]),
    any: false
  };
  result.any =
    result.generateFixtures ||
    result.downloadCorpus ||
    result.splitterParity ||
    result.retrievalProbe ||
    result.liveRetrieval;
  return result;
}

async function downloadPublicCorpus(targetDir, requestedCount) {
  mkdirSync(targetDir, { recursive: true });
  const repositories = [
    {
      repo: "github/docs",
      branch: "main",
      license_hint: "CC-BY-4.0, MIT for code samples",
      sparse: ["content"],
      include: (file) =>
        file.path.startsWith("content/") &&
        /\.(md|mdx)$/i.test(file.path) &&
        !file.path.includes("/data/")
    },
    {
      repo: "mdn/content",
      branch: "main",
      license_hint: "CC-BY-SA-2.5",
      sparse: ["files/en-us"],
      include: (file) => file.path.startsWith("files/en-us/") && file.path.endsWith(".md")
    },
    {
      repo: "kubernetes/website",
      branch: "main",
      license_hint: "CC-BY-4.0",
      sparse: ["content/en/docs"],
      include: (file) => file.path.startsWith("content/en/docs/") && file.path.endsWith(".md")
    },
    {
      repo: "milvus-io/milvus-docs",
      branch: "v2.6.x",
      license_hint: "Apache-2.0 docs repository",
      include: (file) => /\.(md|mdx)$/i.test(file.path)
    },
    {
      repo: "modelcontextprotocol/specification",
      branch: "main",
      license_hint: "MCP specification repository",
      include: (file) => /\.(md|mdx)$/i.test(file.path)
    },
    {
      repo: "vitejs/vite",
      branch: "main",
      license_hint: "MIT",
      sparse: ["docs"],
      include: (file) => file.path.startsWith("docs/") && /\.(md|md)$/i.test(file.path)
    },
    {
      repo: "microsoft/TypeScript-Website",
      branch: "v2",
      license_hint: "Apache-2.0",
      sparse: ["packages/documentation/copy/en"],
      include: (file) =>
        file.path.startsWith("packages/documentation/copy/en/") && file.path.endsWith(".md")
    }
  ];

  const candidates = [];
  for (const repo of repositories) {
    try {
      const branch = repo.branch ?? (await fetchDefaultBranch(repo.repo));
      const tree = await fetchRepositoryTree(repo, branch, path.join(targetDir, ".source-cache"));
      for (const file of tree) {
        if (file.type !== "blob" || !repo.include(file)) {
          continue;
        }
        candidates.push({
          repo: repo.repo,
          branch,
          path: file.path,
          license_hint: repo.license_hint,
          raw_url:
            file.raw_url ??
            `https://raw.githubusercontent.com/${repo.repo}/${encodeURIComponent(branch)}/${file.path
              .split("/")
              .map(encodeURIComponent)
              .join("/")}`,
          local_file: file.local_file ?? null
        });
      }
    } catch (error) {
      console.warn(`Skipping ${repo.repo}: ${error.message}`);
    }
  }

  const shuffled = deterministicShuffle(candidates, "openkb-dify-parity-corpus-v1");
  const bucketTargets = {
    "0200-0500": 15,
    "0500-1000": 15,
    "1000-3000": 15,
    "3000-6000": 15,
    "6000-10000": 15
  };
  const accepted = [];
  const rejected = [];

  for (const candidate of shuffled) {
    if (accepted.length >= requestedCount && bucketTargetsSatisfied(accepted, bucketTargets)) {
      break;
    }
    const shouldTry =
      accepted.length < requestedCount || !bucketTargetsSatisfied(accepted, bucketTargets);
    if (!shouldTry) {
      break;
    }
    try {
      const raw = candidate.local_file
        ? readFileSync(candidate.local_file, "utf8")
        : await fetchText(candidate.raw_url);
      const markdown = normalizeMarkdownForParity(raw);
      const length = codePointLength(markdown);
      const bucket = lengthBucket(length);
      if (!bucket) {
        rejected.push({ ...candidate, reason: "length_out_of_range", length });
        continue;
      }
      const bucketCount = accepted.filter((item) => item.bucket === bucket).length;
      const bucketStillNeedsDocs = bucketCount < (bucketTargets[bucket] ?? 0);
      if (accepted.length >= requestedCount && !bucketStillNeedsDocs) {
        continue;
      }
      const index = accepted.length + 1;
      const slug = `${String(index).padStart(3, "0")}-${safeSlug(candidate.repo)}-${safeSlug(
        path.basename(candidate.path, path.extname(candidate.path))
      )}.md`;
      const localPath = path.join(targetDir, slug);
      writeFileSync(localPath, markdown);
      accepted.push({
        id: slug.replace(/\.md$/, ""),
        local_path: path.relative(targetDir, localPath),
        source_url: candidate.raw_url,
        repo: candidate.repo,
        branch: candidate.branch,
        source_path: candidate.path,
        license_hint: candidate.license_hint,
        length,
        bucket,
        hash: sha256(markdown),
        features: detectMarkdownFeatures(markdown)
      });
    } catch (error) {
      rejected.push({ ...candidate, reason: "download_failed", message: error.message });
    }
  }

  const manifest = {
    generated_at: new Date().toISOString(),
    requested_count: requestedCount,
    accepted_count: accepted.length,
    bucket_targets: bucketTargets,
    buckets: countBy(accepted, (item) => item.bucket),
    sources: [...new Set(accepted.map((item) => item.repo))].sort(),
    documents: accepted,
    rejected_count: rejected.length,
    rejected_sample: rejected.slice(0, 30)
  };
  writeJson(path.join(targetDir, "manifest.json"), manifest);
  writeFileSync(path.join(targetDir, "README.md"), renderCorpusReadme(manifest));
}

async function fetchRepositoryTree(repo, branch, cacheRoot) {
  const treeUrl = `https://api.github.com/repos/${repo.repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`;
  try {
    const tree = await fetchJson(treeUrl);
    return tree.tree ?? [];
  } catch (error) {
    console.warn(
      `GitHub API tree failed for ${repo.repo}: ${error.message}; falling back to git clone.`
    );
    return collectRepositoryTreeWithGit(repo, branch, cacheRoot);
  }
}

function collectRepositoryTreeWithGit(repo, branch, cacheRoot) {
  mkdirSync(cacheRoot, { recursive: true });
  const repoDir = path.join(cacheRoot, safeSlug(repo.repo));
  const gitBaseArgs = [
    "-c",
    "core.longpaths=true",
    "-c",
    "http.proxy=",
    "-c",
    "https.proxy=",
    "-c",
    "http.https://github.com.proxy="
  ];
  const gitEnv = {
    ...process.env,
    HTTP_PROXY: "",
    HTTPS_PROXY: "",
    ALL_PROXY: "",
    http_proxy: "",
    https_proxy: "",
    all_proxy: ""
  };
  if (!existsSync(path.join(repoDir, ".git"))) {
    const cloneArgs = [
      ...gitBaseArgs,
      "clone",
      "--depth",
      "1",
      "--filter=blob:none",
      "--sparse",
      "--branch",
      branch,
      `https://github.com/${repo.repo}.git`,
      repoDir
    ];
    execFileSync("git", cloneArgs, { env: gitEnv, stdio: "pipe", timeout: 600000 });
    if (repo.sparse?.length) {
      execFileSync(
        "git",
        [...gitBaseArgs, "-C", repoDir, "sparse-checkout", "set", ...repo.sparse],
        {
          env: gitEnv,
          stdio: "pipe",
          timeout: 300000
        }
      );
    }
  }
  const output = execFileSync("git", [...gitBaseArgs, "-C", repoDir, "ls-files"], {
    env: gitEnv,
    encoding: "utf8",
    stdio: "pipe",
    timeout: 120000
  });
  return output
    .split(/\r?\n/)
    .filter(Boolean)
    .map((filePath) => ({
      type: "blob",
      path: filePath.replace(/\\/g, "/"),
      local_file: path.join(repoDir, filePath)
    }));
}

async function runSplitterParity(corpusDir, targetDir) {
  mkdirSync(targetDir, { recursive: true });
  const manifestPath = path.join(corpusDir, "manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`Missing corpus manifest: ${manifestPath}`);
  }
  const manifest = readJson(manifestPath);
  const docs = manifest.documents ?? [];
  const openkbMarkdown = await loadOpenKbMarkdownPackage();
  const modes = splitterModeSpecs();
  const rows = [];
  const rawResults = [];

  for (const doc of docs) {
    const markdown = readFileSync(path.join(corpusDir, doc.local_path), "utf8");
    for (const spec of modes) {
      const raw = normalizeMarkdownForParity(markdown);
      const indexedText = applyDifyCleanProcessor(
        raw,
        spec.process_rule.pre_processing_rules ?? []
      );
      const qaPairsForDoc = spec.doc_form === "qa_model" ? buildQaRowsForMarkdown(doc, raw) : [];
      const difyChunks =
        spec.doc_form === "qa_model"
          ? runReferenceQaChunks(qaPairsForDoc)
          : runReferenceSplitter(indexedText, spec);
      const openkbChunks = runOpenKbSplitter(raw, spec, openkbMarkdown, qaPairsForDoc);
      const comparison = compareChunkOutputs(difyChunks, openkbChunks);
      const fidelity =
        spec.doc_form === "qa_model"
          ? {
              ok: true,
              not_applicable:
                "qa_model indexes generated question rows, not source Markdown blocks."
            }
          : checkMarkdownFidelity(markdown, openkbChunks);
      const row = {
        doc_id: doc.id,
        source_url: doc.source_url,
        bucket: doc.bucket,
        mode: spec.id,
        doc_length: doc.length,
        dify_chunk_count: difyChunks.length,
        openkb_chunk_count: openkbChunks.length,
        dify_parent_count: difyChunks.filter((chunk) => chunk.type === "parent").length,
        openkb_parent_count: openkbChunks.filter((chunk) => chunk.type === "parent").length,
        dify_child_count: difyChunks.filter((chunk) => chunk.type === "child").length,
        openkb_child_count: openkbChunks.filter((chunk) => chunk.type === "child").length,
        hash_overlap: comparison.hash_overlap,
        avg_best_similarity: comparison.avg_best_similarity,
        exact_sequence: comparison.exact_sequence,
        markdown_fidelity_ok: fidelity.ok,
        fidelity
      };
      rows.push(row);
      rawResults.push({
        ...row,
        raw_markdown_hash: sha256(raw),
        indexed_text_hash: sha256(indexedText),
        dify_chunks: difyChunks,
        openkb_chunks: openkbChunks
      });
    }
  }

  const qaRows = buildQaRowsFromCorpus(docs, corpusDir, 50);
  const summary = {
    generated_at: new Date().toISOString(),
    corpus_dir: corpusDir,
    corpus_count: docs.length,
    openkb_package_loaded: Boolean(openkbMarkdown),
    modes: summarizeSplitterRows(rows),
    buckets: countBy(docs, (item) => item.bucket),
    markdown_fidelity: summarizeFidelity(rows),
    worst_differences: rows
      .slice()
      .sort((a, b) => a.avg_best_similarity - b.avg_best_similarity)
      .slice(0, 30),
    qa: {
      generated_rows: qaRows.length,
      covered_documents: new Set(qaRows.map((row) => row.document_id)).size
    }
  };

  writeJson(path.join(targetDir, "splitter-results.raw.json"), rawResults);
  writeJson(path.join(targetDir, "splitter-summary.json"), summary);
  writeFileSync(path.join(targetDir, "splitter-summary.zh-CN.md"), renderSplitterSummary(summary));
  writeFileSync(path.join(targetDir, "qa-pairs.csv"), toCsv(qaRows));
}

async function writeRetrievalEnvironmentReport(targetDir) {
  mkdirSync(targetDir, { recursive: true });
  const report = await collectRetrievalEnvironmentReport();
  writeJson(path.join(targetDir, "retrieval-environment-report.json"), report);
  writeFileSync(
    path.join(targetDir, "retrieval-environment-report.zh-CN.md"),
    renderRetrievalReport(report)
  );
}

async function collectRetrievalEnvironmentReport() {
  const commonUrls = [
    {
      name: "openkb_api",
      url: openKbHealthUrl(process.env.OPENKB_API_BASE_URL ?? "http://localhost:4101")
    },
    {
      name: "openkb_dify_adapter",
      url: process.env.OPENKB_DIFY_ADAPTER_URL ?? "http://localhost:4200/health"
    },
    { name: "openkb_web_3100", url: "http://localhost:3100/" },
    { name: "dify_web_18080", url: "http://localhost:18080/" },
    { name: "dify_web_default", url: process.env.DIFY_BASE_URL ?? "http://localhost/" },
    { name: "dify_web_3000", url: "http://localhost:3000/" },
    { name: "dify_web_8080", url: "http://localhost:8080/" }
  ];
  const checks = [];
  for (const item of commonUrls) {
    checks.push(await checkHttp(item.name, item.url));
  }

  const modelEnv = {
    openkb_embedding_request_format: process.env.OPENKB_EMBEDDING_REQUEST_FORMAT ?? null,
    openkb_embedding_model: process.env.OPENKB_EMBEDDING_MODEL ?? null,
    openkb_embedding_dim: process.env.OPENKB_EMBEDDING_DIM ?? null,
    openkb_rerank_request_format: process.env.OPENKB_RERANK_REQUEST_FORMAT ?? null,
    openkb_rerank_model: process.env.OPENKB_RERANK_MODEL ?? null,
    has_openkb_embedding_key: Boolean(process.env.OPENKB_EMBEDDING_API_KEY),
    has_openkb_rerank_key: Boolean(process.env.OPENKB_RERANK_API_KEY),
    dify_console_api_base_url: sanitizeUrlForReport(process.env.DIFY_CONSOLE_API_BASE_URL ?? null),
    dify_embedding_provider_name: process.env.DIFY_EMBEDDING_PROVIDER_NAME ?? null,
    dify_embedding_model: process.env.DIFY_EMBEDDING_MODEL ?? null,
    dify_rerank_provider_name: process.env.DIFY_RERANK_PROVIDER_NAME ?? null,
    dify_rerank_model: process.env.DIFY_RERANK_MODEL ?? null,
    dify_top_k: process.env.DIFY_TOP_K ?? null,
    dify_score_threshold: process.env.DIFY_SCORE_THRESHOLD ?? null,
    dify_base_url: process.env.DIFY_BASE_URL ?? null,
    has_dify_api_key: Boolean(
      process.env.DIFY_API_KEY || process.env.DIFY_CONSOLE_TOKEN || process.env.DIFY_CONSOLE_COOKIE
    ),
    has_dify_csrf_token: Boolean(getDifyConsoleCsrfToken()),
    has_dify_dataset_id: Boolean(process.env.DIFY_DATASET_ID),
    has_openkb_knowledge_base_id: Boolean(process.env.OPENKB_KNOWLEDGE_BASE_ID),
    has_openkb_search_cookie: Boolean(process.env.OPENKB_SEARCH_COOKIE),
    has_openkb_csrf_token: Boolean(getOpenKbCsrfToken())
  };
  const missing = [];
  const openkbHealth = checks.find((check) => check.name === "openkb_api");
  const adapterHealth = checks.find((check) => check.name === "openkb_dify_adapter");
  if (!openkbHealth?.ok) missing.push("OPENKB_API_BASE_URL reachable health check");
  if (!adapterHealth?.ok) missing.push("OPENKB_DIFY_ADAPTER_URL reachable health check");
  if (!modelEnv.has_dify_api_key) missing.push("DIFY_CONSOLE_TOKEN or DIFY_CONSOLE_COOKIE");
  if (
    (process.env.DIFY_CONSOLE_COOKIE || process.env.DIFY_CONSOLE_TOKEN) &&
    !modelEnv.has_dify_csrf_token
  ) {
    missing.push("DIFY_CSRF_TOKEN or csrf_token cookie inside DIFY_CONSOLE_COOKIE");
  }
  if (!modelEnv.has_dify_dataset_id) missing.push("DIFY_DATASET_ID");
  if (!modelEnv.has_openkb_knowledge_base_id) missing.push("OPENKB_KNOWLEDGE_BASE_ID");
  if (!modelEnv.has_openkb_search_cookie) missing.push("OPENKB_SEARCH_COOKIE");
  if (modelEnv.has_openkb_search_cookie && !modelEnv.has_openkb_csrf_token) {
    missing.push("OPENKB_CSRF_TOKEN or csrf cookie inside OPENKB_SEARCH_COOKIE");
  }
  if (!modelEnv.openkb_embedding_model) missing.push("OPENKB_EMBEDDING_MODEL");
  if (!modelEnv.openkb_rerank_model) missing.push("OPENKB_RERANK_MODEL");
  const modelMismatch = detectModelMismatch(modelEnv);
  if (modelMismatch.length > 0) {
    missing.push(...modelMismatch);
  }

  return {
    generated_at: new Date().toISOString(),
    status:
      missing.length === 0
        ? "ready_for_live_retrieval"
        : modelMismatch.length > 0
          ? "blocked_model_mismatch"
          : "blocked_missing_live_inputs",
    health_checks: checks,
    model_environment: modelEnv,
    missing_live_retrieval_inputs: missing,
    note: "This script never prints raw keys. Live retrieval comparison needs Dify dataset credentials and an OpenKB session cookie or equivalent local test harness."
  };
}

async function runLiveRetrievalParity(corpusDir, targetDir, parsed) {
  mkdirSync(targetDir, { recursive: true });
  const manifestPath = path.join(corpusDir, "manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`Missing corpus manifest: ${manifestPath}`);
  }
  const manifest = readJson(manifestPath);
  const docs = Array.isArray(manifest.documents) ? manifest.documents : [];
  const importCorpusDir = path.join(targetDir, "corpus-import");
  const importManifest = writeLiveRetrievalImportCorpus(corpusDir, docs, importCorpusDir);
  const environment = await collectRetrievalEnvironmentReport();
  const config = buildLiveRetrievalConfig(parsed);
  const queryCount = parsePositiveInt(
    parsed["query-count"],
    Math.min(240, Math.max(1, docs.length * 3))
  );
  const queries = buildLiveRetrievalQueries(docs, corpusDir, importManifest, queryCount);
  const sameCorpusConfirmed =
    parsed["confirm-same-corpus-indexed"] === true ||
    parseBoolean(process.env.PARITY_CONFIRM_SAME_CORPUS_INDEXED, false);
  const missing = [...environment.missing_live_retrieval_inputs, ...config.missingInputs];
  if (!sameCorpusConfirmed) {
    missing.push("PARITY_CONFIRM_SAME_CORPUS_INDEXED=true or --confirm-same-corpus-indexed");
  }
  if (queries.length === 0) {
    missing.push("corpus manifest documents");
  }
  if (missing.length > 0) {
    const blocked = {
      generated_at: new Date().toISOString(),
      status:
        environment.status === "blocked_model_mismatch"
          ? "blocked_model_mismatch"
          : "blocked_missing_live_inputs",
      missing_live_retrieval_inputs: missing,
      environment,
      retrieval_config: config.safe,
      corpus_dir: corpusDir,
      generated_import_corpus: importCorpusDir,
      query_count: queries.length,
      note: "Live retrieval parity was not executed because at least one credential, indexed-corpus confirmation, or model-alignment input is missing. Runtime corpus copies stay under .codex-runtime and are not committed."
    };
    writeJson(path.join(targetDir, "live-retrieval-blocked.json"), blocked);
    writeFileSync(
      path.join(targetDir, "live-retrieval-summary.zh-CN.md"),
      renderLiveRetrievalBlocked(blocked)
    );
    return;
  }

  const difyBase = normalizeUrlBase(
    process.env.DIFY_CONSOLE_API_BASE_URL ??
      `${normalizeUrlBase(process.env.DIFY_BASE_URL ?? "http://localhost:18080")}/console/api`
  );
  const openkbBase = normalizeOpenKbApiBase(
    process.env.OPENKB_API_BASE_URL ?? "http://localhost:4101"
  );
  const difyDatasetId = process.env.DIFY_DATASET_ID;
  const openkbKnowledgeBaseId = process.env.OPENKB_KNOWLEDGE_BASE_ID;
  const rawRows = [];
  const normalizedRows = [];

  for (const query of queries) {
    const difyPayload = {
      query: query.query,
      retrieval_model: config.difyRetrievalModel
    };
    const openkbPayload = {
      query: query.query,
      knowledge_base_ids: [openkbKnowledgeBaseId],
      top_k: config.topK,
      score_threshold: config.scoreThreshold,
      retrieval_model: config.openkbRetrievalModel,
      filters: query.filters ?? {}
    };
    const [dify, openkb] = await Promise.all([
      postJsonForParity(
        joinUrl(difyBase, `/datasets/${encodeURIComponent(difyDatasetId)}/hit-testing`),
        difyPayload,
        buildDifyConsoleHeaders()
      ),
      postJsonForParity(
        joinUrl(openkbBase, "/api/search"),
        openkbPayload,
        buildOpenKbSearchHeaders()
      )
    ]);
    const difyRows = dify.ok ? normalizeDifyRows(dify.body) : [];
    const openkbRows = openkb.ok ? normalizeOpenKbRows(openkb.body) : [];
    rawRows.push({
      query,
      dify: sanitizeLiveResponseForStorage(dify),
      openkb: sanitizeLiveResponseForStorage(openkb)
    });
    normalizedRows.push(analyzeLiveRetrievalQuery(query, difyRows, openkbRows, dify, openkb));
  }

  const summary = summarizeLiveRetrievalRows(normalizedRows, {
    generated_at: new Date().toISOString(),
    corpus_dir: corpusDir,
    generated_import_corpus: importCorpusDir,
    query_count: queries.length,
    retrieval_config: config.safe,
    environment
  });
  writeJson(path.join(targetDir, "live-retrieval-environment.json"), environment);
  writeJson(path.join(targetDir, "live-retrieval-queries.json"), queries);
  writeJson(path.join(targetDir, "live-retrieval-raw.sanitized.json"), rawRows);
  writeJson(path.join(targetDir, "live-retrieval-normalized.json"), normalizedRows);
  writeJson(path.join(targetDir, "live-retrieval-summary.json"), summary);
  writeFileSync(
    path.join(targetDir, "live-retrieval-summary.zh-CN.md"),
    renderLiveRetrievalSummary(summary)
  );
}

function summarizeReport(inputReportDir, targetDir) {
  const required = [
    "chunk-analysis.json",
    "retrieval-dify-openkb.json",
    "metadata-filter-tests.json",
    "qa-tests.json",
    "segment-ops-tests.json",
    "metadata.json"
  ];
  for (const file of required) {
    const fullPath = path.join(inputReportDir, file);
    if (!existsSync(fullPath)) {
      throw new Error(`Missing report file: ${fullPath}`);
    }
  }

  const chunk = readJson(path.join(inputReportDir, "chunk-analysis.json"));
  const retrieval = readJson(path.join(inputReportDir, "retrieval-dify-openkb.json"));
  const metadataFilters = readJson(path.join(inputReportDir, "metadata-filter-tests.json"));
  const qa = readJson(path.join(inputReportDir, "qa-tests.json"));
  const segmentOps = readJson(path.join(inputReportDir, "segment-ops-tests.json"));
  const metadata = readJson(path.join(inputReportDir, "metadata.json"));

  const retrievalRows = retrieval.analysis?.rows ?? [];
  const summary = {
    run_id: metadata.run_id ?? "unknown",
    report_dir: inputReportDir,
    generated_at: new Date().toISOString(),
    chunk_modes: summarizeChunkModes(chunk),
    retrieval: {
      total_queries: retrieval.analysis?.total_queries ?? retrievalRows.length,
      same_top_marker: retrieval.analysis?.same_top_marker ?? sum(retrievalRows, "same_top_marker"),
      dify_expected_top_hits:
        retrieval.analysis?.dify_expected_top_hits ?? sum(retrievalRows, "dify_expected_hit"),
      openkb_expected_top_hits:
        retrieval.analysis?.openkb_expected_top_hits ?? sum(retrievalRows, "openkb_expected_hit"),
      avg_top3_marker_overlap:
        retrieval.analysis?.avg_top3_marker_overlap ?? avg(retrievalRows, "top3_marker_overlap"),
      by_mode: aggregateRetrieval(retrievalRows, (row) => row.mode),
      by_mode_and_kind: aggregateRetrieval(retrievalRows, (row) => `${row.mode}|${row.kind}`)
    },
    metadata_filters: {
      tests: metadataFilters.tests?.length ?? 0,
      dify_expected_hits: metadataFilters.dify_expected_hits ?? null,
      openkb_metadata_expected_hits: metadataFilters.openkb_metadata_expected_hits ?? null,
      openkb_tags_expected_hits: metadataFilters.openkb_tags_expected_hits ?? null
    },
    qa: {
      qa_rows_expected: qa.qa_rows_expected ?? null,
      dify_segment_count: qa.dify_segment_count ?? null,
      openkb_pair_count: qa.openkb_pair_count ?? null,
      openkb_chunk_count: qa.openkb_chunk_count ?? null,
      query_count: qa.queries?.length ?? 0,
      dify_marker_hits: qa.dify_marker_hits ?? null,
      openkb_marker_hits: qa.openkb_marker_hits ?? null
    },
    segment_ops: {
      mode: segmentOps.mode,
      slug: segmentOps.slug,
      openkb_supported: segmentOps.openkb?.supported ?? false,
      dify_child_chunks_supported: segmentOps.dify?.service_api_child_chunks_supported ?? false
    }
  };

  writeJson(path.join(targetDir, "parity-summary.json"), summary);
  writeFileSync(path.join(targetDir, "parity-summary.zh-CN.md"), renderSummaryMarkdown(summary));
}

function summarizeGeneratedFixtures(fixtureDir, targetDir) {
  const manifest = readJson(path.join(fixtureDir, "manifest.json"));
  const golden = readJson(path.join(fixtureDir, "splitter-golden-fixtures.json"));
  const goldenCases = Array.isArray(golden) ? golden : (golden.cases ?? []);
  copyFileSync(
    path.join(fixtureDir, "splitter-golden-fixtures.json"),
    path.join(targetDir, "splitter-golden-fixtures.json")
  );
  const summary = {
    mode: "generated_fixtures",
    generated_at: manifest.generated_at,
    fixture_count: manifest.fixture_count,
    qa_rows: manifest.qa_rows,
    splitter_golden_cases: goldenCases.length,
    golden_fields: [
      "raw_markdown",
      "milkdown_normalized_markdown",
      "indexed_text",
      "dify_splitter_output",
      "openkb_splitter_output",
      "comparison"
    ],
    artifact_paths: {
      fixtures: path.relative(targetDir, fixtureDir),
      qa_csv: path.relative(targetDir, path.join(fixtureDir, "qa-pairs.csv")),
      splitter_golden: "splitter-golden-fixtures.json"
    }
  };
  writeJson(path.join(targetDir, "parity-summary.json"), summary);
  writeFileSync(
    path.join(targetDir, "parity-summary.zh-CN.md"),
    `# Dify / OpenKB parity fixtures\n\n- 模式：生成 focused fixtures\n- Markdown fixtures：${summary.fixture_count}\n- QA rows：${summary.qa_rows}\n- Splitter golden cases：${summary.splitter_golden_cases}\n- Golden fields：${summary.golden_fields.join(", ")}\n\n大样本 raw response 和 live parity 输出仍应保留在 .codex-runtime，不进入 git。\n`
  );
}

function summarizeChunkModes(chunk) {
  return Object.fromEntries(
    Object.entries(chunk).map(([modeId, value]) => [
      modeId,
      {
        document_count: value.document_count,
        dify_segment_count: value.dify_segment_count,
        dify_child_count: value.dify_child_count,
        openkb_chunk_count: value.openkb_chunk_count,
        openkb_parent_count: value.openkb_parent_count,
        openkb_child_count: value.openkb_child_count,
        avg_aligned_similarity: value.avg_aligned_similarity,
        exact_document_sequences: value.exact_document_sequences
      }
    ])
  );
}

function aggregateRetrieval(rows, keyFn) {
  const buckets = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    const bucket = buckets.get(key) ?? {
      queries: 0,
      same_top_marker: 0,
      dify_expected_hits: 0,
      openkb_expected_hits: 0,
      top3_marker_overlap_sum: 0
    };
    bucket.queries += 1;
    bucket.same_top_marker += row.same_top_marker ? 1 : 0;
    bucket.dify_expected_hits += row.dify_expected_hit ? 1 : 0;
    bucket.openkb_expected_hits += row.openkb_expected_hit ? 1 : 0;
    bucket.top3_marker_overlap_sum += Number(row.top3_marker_overlap ?? 0);
    buckets.set(key, bucket);
  }
  return Object.fromEntries(
    [...buckets.entries()].map(([key, bucket]) => [
      key,
      {
        queries: bucket.queries,
        same_top_marker: bucket.same_top_marker,
        dify_expected_hits: bucket.dify_expected_hits,
        openkb_expected_hits: bucket.openkb_expected_hits,
        avg_top3_marker_overlap: round4(
          bucket.top3_marker_overlap_sum / Math.max(bucket.queries, 1)
        )
      }
    ])
  );
}

function renderSummaryMarkdown(summary) {
  const chunkRows = Object.entries(summary.chunk_modes)
    .map(
      ([modeId, row]) =>
        `| ${modeId} | ${row.document_count} | ${row.dify_segment_count} | ${row.dify_child_count} | ${row.openkb_chunk_count} | ${row.openkb_parent_count} | ${row.openkb_child_count} | ${row.avg_aligned_similarity} | ${row.exact_document_sequences} |`
    )
    .join("\n");
  const retrievalRows = Object.entries(summary.retrieval.by_mode)
    .map(
      ([modeId, row]) =>
        `| ${modeId} | ${row.queries} | ${row.same_top_marker} | ${row.dify_expected_hits} | ${row.openkb_expected_hits} | ${row.avg_top3_marker_overlap} |`
    )
    .join("\n");

  return `# Dify / OpenKB parity 摘要

- Run ID: \`${summary.run_id}\`
- Report: \`${summary.report_dir}\`
- Generated at: \`${summary.generated_at}\`

## Chunk modes

| 模式 | 文档数 | Dify segment | Dify child | OpenKB chunks | OpenKB parent | OpenKB child | 平均边界相似度 | 完全一致文档 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${chunkRows}

## Retrieval

| 模式 | 查询数 | top1 marker 一致 | Dify 期望命中 | OpenKB 期望命中 | 平均 top3 overlap |
| --- | ---: | ---: | ---: | ---: | ---: |
${retrievalRows}

## Metadata / QA / Segment

- Metadata filter tests: ${summary.metadata_filters.tests}
- Dify metadata expected hits: ${summary.metadata_filters.dify_expected_hits}
- OpenKB metadata expected hits: ${summary.metadata_filters.openkb_metadata_expected_hits}
- OpenKB tags expected hits: ${summary.metadata_filters.openkb_tags_expected_hits}
- QA rows expected: ${summary.qa.qa_rows_expected}
- Dify QA marker hits: ${summary.qa.dify_marker_hits}
- OpenKB QA marker hits: ${summary.qa.openkb_marker_hits}
- OpenKB segment ops supported: ${summary.segment_ops.openkb_supported}
- Dify child chunk service API supported: ${summary.segment_ops.dify_child_chunks_supported}
`;
}

function generateFixtures(fixtureDir, count) {
  mkdirSync(fixtureDir, { recursive: true });
  const topics = [
    ["technical-api", "API 网关与限流设计", "API Gateway, rate limiting, Redis Lua, observability"],
    ["contract", "采购合同与验收条款", "contract delivery, acceptance, penalty, invoice"],
    ["medical", "门诊随访与健康说明", "medical follow-up, symptoms, warning signs"],
    ["finance", "月度财务分析", "finance revenue, margin, AR aging, table"],
    ["education", "课程教案与作业设计", "education lesson plan, assessment, rubric"],
    ["manufacturing-sop", "产线点检 SOP", "manufacturing SOP, bearing temperature, safety"],
    ["travel", "贵阳四日旅行计划", "travel itinerary, Guiyang, logistics"],
    ["faq", "客服 FAQ 与工单处理", "FAQ, password reset, refund, shipping"],
    ["meeting", "项目会议纪要", "meeting notes, action items, risks"],
    ["code-doc", "Python SDK 使用说明", "code docs, timeout, auth, examples"]
  ];
  const rows = [];
  for (let index = 1; index <= count; index += 1) {
    const topic = topics[(index - 1) % topics.length];
    const slug = `${String(index).padStart(2, "0")}-${topic[0]}`;
    const marker = `PV2-GENERATED-DOC${String(index).padStart(2, "0")}`;
    const markdown = renderFixtureMarkdown(index, slug, topic[1], topic[2], marker);
    writeFileSync(path.join(fixtureDir, `${slug}.md`), markdown);
    for (let question = 1; question <= 4; question += 1) {
      const fact = `${marker}-SEC${String(question).padStart(2, "0")}-FACT${String(question).padStart(2, "0")}`;
      rows.push({
        question: `问题 ${question}: marker ${fact} 对应的测试目标是什么？`,
        answer: `答案 ${question}: ${fact} 用于验证 Dify 与 OpenKB 的分块、metadata 与检索排序一致性。`,
        document_id: slug
      });
    }
  }
  writeFileSync(path.join(fixtureDir, "qa-pairs.csv"), toCsv(rows));
  writeJson(path.join(fixtureDir, "splitter-golden-fixtures.json"), buildSplitterGoldenFixtures());
  writeJson(path.join(fixtureDir, "manifest.json"), {
    generated_at: new Date().toISOString(),
    fixture_count: count,
    qa_rows: rows.length,
    hash: hashDirectoryFixture(fixtureDir)
  });
}

function buildSplitterGoldenFixtures() {
  const cases = [
    {
      id: "cjk-punctuation",
      mode: "automatic",
      raw_markdown: `${"甲".repeat(240)}。${"乙".repeat(240)}。${"😀".repeat(80)}。${"丙".repeat(240)}`,
      process_rule: automaticRule(),
      expected_focus: ["CJK sentence separator", "emoji code point length", "automatic overlap"]
    },
    {
      id: "english-period",
      mode: "automatic",
      raw_markdown: `Alpha sentence. ${"Beta sentence with enough text. ".repeat(35)}Gamma sentence.`,
      process_rule: automaticRule(),
      expected_focus: ["English period separator", "space fallback"]
    },
    {
      id: "long-without-separator",
      mode: "automatic",
      raw_markdown: "A".repeat(1300),
      process_rule: automaticRule(),
      expected_focus: ["character fallback", "overlap"]
    },
    {
      id: "fixed-separator-recursive-fallback",
      mode: "custom",
      raw_markdown: `Alpha section\n---CUT---\n${"Beta sentence. ".repeat(80)}\n---CUT---\nGamma section`,
      process_rule: customRule("\n---CUT---\n", 120, 20),
      expected_focus: ["fixed separator", "recursive fallback", "English sentence separator"]
    },
    {
      id: "markdown-url-cleaning",
      mode: "custom",
      raw_markdown:
        "Alpha   beta user@example.com https://bare.example/path [keep](https://link.example/a) ![img](https://image.example/i.png)",
      process_rule: {
        pre_processing_rules: [
          { id: "remove_extra_spaces", enabled: true },
          { id: "remove_urls_emails", enabled: true }
        ],
        segmentation: { separator: "\n", max_tokens: 500, chunk_overlap: 50 }
      },
      expected_focus: [
        "bare URL/email removal",
        "markdown link preservation",
        "markdown image preservation"
      ]
    },
    {
      id: "table-and-list",
      mode: "custom",
      raw_markdown:
        "# Table\n\n| 指标 | 值 |\n| --- | ---: |\n| A | 1 |\n| B | 2 |\n\n- 一级\n  - 二级\n- 结束",
      process_rule: customRule("\n", 80, 10),
      expected_focus: ["table boundary", "list indentation", "line separator"]
    },
    {
      id: "frontmatter",
      mode: "custom",
      raw_markdown:
        "---\ntags:\n  - parity\npriority: 3\n---\n\n# 标题\n\n正文包含 frontmatter 和正文边界。",
      process_rule: customRule("\n", 80, 10),
      expected_focus: ["frontmatter", "heading boundary"]
    },
    {
      id: "hierarchical-paragraph",
      mode: "hierarchical",
      parent_mode: "paragraph",
      raw_markdown: `# Parent\n\n${"父段落一。".repeat(80)}\n\n${"父段落二 child text. ".repeat(80)}`,
      process_rule: hierarchicalRule("paragraph"),
      expected_focus: ["paragraph parent", "subchunk recursion"]
    },
    {
      id: "hierarchical-full-doc",
      mode: "hierarchical",
      parent_mode: "full_doc",
      raw_markdown: `# Full doc\n\n${"完整文档父块。".repeat(120)}\n\n${"child sentence. ".repeat(120)}`,
      process_rule: hierarchicalRule("full_doc"),
      expected_focus: ["full document parent", "child recursion"]
    },
    {
      id: "mixed-cjk-english-emoji",
      mode: "automatic",
      raw_markdown: `OpenKB 与 Dify 对齐。${"English sentence with emoji 🙂. ".repeat(45)}最后一段中文用于观察边界。`,
      process_rule: automaticRule(),
      expected_focus: ["mixed CJK English", "emoji", "recursive separators"]
    }
  ];

  return {
    purpose:
      "Small fixtures for comparing raw Markdown, Milkdown-normalized Markdown, indexed text, Dify splitter output, and OpenKB splitter output.",
    cases: cases.map((item) => buildGoldenCase(item))
  };
}

function buildGoldenCase(item) {
  const milkdownNormalized = normalizeMarkdownForParity(item.raw_markdown);
  const indexedText = applyDifyCleanProcessor(
    milkdownNormalized,
    item.process_rule.pre_processing_rules ?? []
  );
  const difyOutput = runReferenceSplitter(indexedText, item);
  const openkbOutput = runReferenceSplitter(indexedText, item);
  return {
    id: item.id,
    mode: item.mode,
    parent_mode: item.parent_mode ?? null,
    raw_markdown: item.raw_markdown,
    milkdown_normalized_markdown: milkdownNormalized,
    indexed_text: indexedText,
    process_rule: item.process_rule,
    dify_splitter_output: difyOutput,
    openkb_splitter_output: openkbOutput,
    comparison: compareChunkOutputs(difyOutput, openkbOutput),
    expected_focus: item.expected_focus
  };
}

function splitterModeSpecs() {
  return [
    {
      id: "standard_auto",
      mode: "automatic",
      doc_form: "text_model",
      process_rule: automaticRule()
    },
    {
      id: "standard_custom_newline",
      mode: "custom",
      doc_form: "text_model",
      process_rule: customRule("\n", 500, 50)
    },
    {
      id: "standard_custom_blankline",
      mode: "custom",
      doc_form: "text_model",
      process_rule: customRule("\n\n", 500, 50)
    },
    {
      id: "standard_custom_cjk_period",
      mode: "custom",
      doc_form: "text_model",
      process_rule: customRule("。", 500, 50)
    },
    {
      id: "standard_custom_en_period",
      mode: "custom",
      doc_form: "text_model",
      process_rule: customRule(". ", 500, 50)
    },
    {
      id: "standard_custom_space",
      mode: "custom",
      doc_form: "text_model",
      process_rule: customRule(" ", 500, 50)
    },
    {
      id: "parent_paragraph",
      mode: "hierarchical",
      doc_form: "hierarchical_model",
      parent_mode: "paragraph",
      process_rule: hierarchicalRule("paragraph")
    },
    {
      id: "parent_full_doc",
      mode: "hierarchical",
      doc_form: "hierarchical_model",
      parent_mode: "full_doc",
      process_rule: hierarchicalRule("full_doc")
    },
    {
      id: "qa_model",
      mode: "custom",
      doc_form: "qa_model",
      process_rule: customRule("\n", 500, 50)
    }
  ];
}

function automaticRule() {
  return {
    mode: "automatic",
    pre_processing_rules: [{ id: "remove_extra_spaces", enabled: true }],
    segmentation: { separator: "\n", max_tokens: 500, chunk_overlap: 50 }
  };
}

function customRule(separator, maxTokens, chunkOverlap) {
  return {
    mode: "custom",
    pre_processing_rules: [{ id: "remove_extra_spaces", enabled: true }],
    segmentation: { separator, max_tokens: maxTokens, chunk_overlap: chunkOverlap }
  };
}

function hierarchicalRule(parentMode) {
  return {
    mode: "hierarchical",
    parent_mode: parentMode,
    pre_processing_rules: [{ id: "remove_extra_spaces", enabled: true }],
    segmentation: {
      separator: "\n\n",
      max_tokens: parentMode === "full_doc" ? 5000 : 500,
      chunk_overlap: 50
    },
    subchunk_segmentation: { separator: "\n", max_tokens: 120, chunk_overlap: 20 }
  };
}

function runOpenKbSplitter(markdown, spec, markdownPackage, qaPairs = []) {
  if (!markdownPackage?.chunkMarkdownForIndex) {
    return spec.doc_form === "qa_model"
      ? runReferenceQaChunks(qaPairs)
      : runReferenceSplitter(
          applyDifyCleanProcessor(markdown, spec.process_rule.pre_processing_rules ?? []),
          spec
        );
  }
  const chunks = markdownPackage.chunkMarkdownForIndex(markdown, {
    doc_form: spec.doc_form,
    process_rule_mode: spec.mode,
    process_rule: spec.process_rule,
    parent_mode: spec.parent_mode,
    qa_pairs: qaPairs,
    settings_revision: 1
  });
  return chunks.map((chunk, index) => ({
    type: chunk.chunk_type ?? "general",
    ordinal: chunk.ordinal ?? index,
    parent_ordinal: chunk.parent_ordinal ?? null,
    child_ordinal: chunk.child_ordinal ?? null,
    content:
      spec.doc_form === "qa_model"
        ? (chunk.content_text ?? "")
        : (chunk.content_markdown ?? chunk.content_text ?? ""),
    length: codePointLength(
      spec.doc_form === "qa_model"
        ? (chunk.content_text ?? "")
        : (chunk.content_markdown ?? chunk.content_text ?? "")
    ),
    hash: sha256(
      spec.doc_form === "qa_model"
        ? (chunk.content_text ?? "")
        : (chunk.content_markdown ?? chunk.content_text ?? "")
    ).slice(0, 12),
    metadata: chunk.metadata ?? {}
  }));
}

function runReferenceQaChunks(qaPairs) {
  return qaPairs.map((pair, index) => ({
    type: "general",
    ordinal: index,
    parent_ordinal: null,
    child_ordinal: null,
    content: pair.question,
    length: codePointLength(pair.question),
    hash: sha256(pair.question).slice(0, 12),
    metadata: {
      hit_type: "qa",
      qa_pair_id: pair.id ?? null,
      qa_question: pair.question,
      qa_answer: pair.answer,
      qa_source: pair.source ?? "csv",
      source_chunk_id: pair.source_chunk_id ?? null
    }
  }));
}

function runReferenceSplitter(text, item) {
  const rule = item.process_rule;
  if (item.mode === "hierarchical") {
    return splitHierarchical(text, rule);
  }
  const segmentation = rule.segmentation ?? {};
  if (item.mode === "automatic") {
    return splitRecursive(text, segmentation.max_tokens ?? 500, segmentation.chunk_overlap ?? 50);
  }
  return splitFixedThenRecursive(
    text,
    segmentation.separator ?? "\n",
    segmentation.max_tokens ?? 500,
    segmentation.chunk_overlap ?? 50
  );
}

function splitHierarchical(text, rule) {
  const parentMode = rule.parent_mode === "full_doc" ? "full_doc" : "paragraph";
  const parentSegmentation = rule.segmentation ?? {};
  const childSegmentation = rule.subchunk_segmentation ?? {};
  const parents =
    parentMode === "full_doc"
      ? [{ ordinal: 0, content: text }]
      : splitFixedThenRecursive(
          text,
          parentSegmentation.separator ?? "\n\n",
          parentSegmentation.max_tokens ?? 500,
          parentSegmentation.chunk_overlap ?? 50
        ).map((chunk, index) => ({ ordinal: index, content: chunk.content }));
  return parents.flatMap((parent) => {
    const children = splitFixedThenRecursive(
      parent.content,
      childSegmentation.separator ?? "\n",
      childSegmentation.max_tokens ?? 120,
      childSegmentation.chunk_overlap ?? 20
    );
    return [
      {
        type: "parent",
        ordinal: parent.ordinal,
        parent_ordinal: parent.ordinal,
        child_ordinal: null,
        content: parent.content,
        length: codePointLength(parent.content),
        hash: sha256(parent.content).slice(0, 12)
      },
      ...children.map((child, index) => ({
        type: "child",
        ordinal: index,
        parent_ordinal: parent.ordinal,
        child_ordinal: index,
        content: child.content,
        length: child.length,
        hash: child.hash
      }))
    ];
  });
}

function splitFixedThenRecursive(text, separator, maxTokens, overlap) {
  const fixedSeparator = decodeDifySeparator(separator);
  const parts = fixedSeparator ? splitInitialFixedSeparator(text, fixedSeparator) : [text];
  return parts
    .flatMap((part) =>
      codePointLength(part) > maxTokens
        ? fixedRecursiveSplit(
            part,
            maxTokens,
            overlap,
            ["\n\n", "。", ". ", " ", ""],
            fixedSeparator !== " "
          )
        : [part]
    )
    .filter((part) => part.trim())
    .map((content, index) => ({
      type: "general",
      ordinal: index,
      parent_ordinal: null,
      child_ordinal: null,
      content: content.trim(),
      length: codePointLength(content.trim()),
      hash: sha256(content.trim()).slice(0, 12)
    }));
}

function splitRecursive(text, maxTokens, overlap) {
  const separators = ["\n\n", "。", ". ", " ", ""];
  return recursiveSplit(text, maxTokens, overlap, separators).map((content, index) => ({
    type: "general",
    ordinal: index,
    parent_ordinal: null,
    child_ordinal: null,
    content,
    length: codePointLength(content),
    hash: sha256(content).slice(0, 12)
  }));
}

function recursiveSplit(text, maxTokens, overlap, separators) {
  let separator = separators[separators.length - 1] ?? "";
  let nextSeparators = [];
  for (const [index, candidate] of separators.entries()) {
    if (candidate === "") {
      separator = candidate;
      break;
    }
    if (text.includes(candidate)) {
      separator = candidate;
      nextSeparators = separators.slice(index + 1);
      break;
    }
  }

  const splits = splitKeepSeparator(text, separator).filter((split) =>
    separator === "\n" ? split !== "" : split !== "" && split !== "\n"
  );
  const finalChunks = [];
  let goodSplits = [];
  let goodLengths = [];
  const lengths = splits.map(codePointLength);

  for (const [index, split] of splits.entries()) {
    const length = lengths[index] ?? 0;
    if (length < maxTokens) {
      goodSplits.push(split);
      goodLengths.push(length);
      continue;
    }
    if (goodSplits.length > 0) {
      finalChunks.push(
        ...mergeDifySplitsReference(goodSplits, "", goodLengths, maxTokens, overlap)
      );
      goodSplits = [];
      goodLengths = [];
    }
    if (nextSeparators.length === 0) {
      finalChunks.push(split);
    } else {
      finalChunks.push(...recursiveSplit(split, maxTokens, overlap, nextSeparators));
    }
  }

  if (goodSplits.length > 0) {
    finalChunks.push(...mergeDifySplitsReference(goodSplits, "", goodLengths, maxTokens, overlap));
  }

  return finalChunks;
}

function fixedRecursiveSplit(text, maxTokens, overlap, separators, preserveSpaceSeparator = false) {
  let separator = separators[separators.length - 1] ?? "";
  let nextSeparators = [];
  for (const [index, candidate] of separators.entries()) {
    if (candidate === "") {
      separator = candidate;
      break;
    }
    if (text.includes(candidate)) {
      separator = candidate;
      nextSeparators = separators.slice(index + 1);
      break;
    }
  }

  if (separator === "") {
    return splitFixedCharactersWithOverlap(text, maxTokens, overlap);
  }

  const splits = splitFixedSeparator(text, separator, preserveSpaceSeparator).filter((split) =>
    separator === "\n" ? split !== "" : split !== "" && split !== "\n"
  );
  const finalChunks = [];
  let goodSplits = [];
  let goodLengths = [];
  const lengths = splits.map(codePointLength);

  for (const [index, split] of splits.entries()) {
    const length = lengths[index] ?? 0;
    if (length < maxTokens) {
      goodSplits.push(split);
      goodLengths.push(length);
      continue;
    }
    if (goodSplits.length > 0) {
      finalChunks.push(
        ...mergeDifySplitsReference(goodSplits, "", goodLengths, maxTokens, overlap)
      );
      goodSplits = [];
      goodLengths = [];
    }
    if (nextSeparators.length === 0) {
      finalChunks.push(split);
    } else {
      finalChunks.push(...recursiveSplit(split, maxTokens, overlap, nextSeparators));
    }
  }

  if (goodSplits.length > 0) {
    finalChunks.push(...mergeDifySplitsReference(goodSplits, "", goodLengths, maxTokens, overlap));
  }

  return finalChunks;
}

function splitInitialFixedSeparator(text, separator) {
  if (separator === " ") {
    return text.split(/ +/);
  }
  if (separator === ". ") {
    return splitEnglishPeriodSeparator(text).map((part, index, parts) =>
      index < parts.length - 1 && part.endsWith(separator) ? part.slice(0, -separator.length) : part
    );
  }
  return text.split(separator);
}

function splitFixedSeparator(text, separator, preserveSpaceSeparator) {
  if (separator === " ") {
    return preserveSpaceSeparator ? splitKeepSeparator(text, separator) : text.split(/ +/);
  }
  if (separator === ". ") {
    return splitEnglishPeriodSeparator(text);
  }
  return splitKeepSeparator(text, separator);
}

function splitKeepSeparator(text, separator) {
  if (!separator) {
    return Array.from(text);
  }
  const pieces = text.split(separator);
  return pieces.flatMap((part, index) =>
    index < pieces.length - 1 ? [`${part}${separator}`] : [part]
  );
}

function splitEnglishPeriodSeparator(text) {
  const separator = ". ";
  const pieces = [];
  let start = 0;
  for (let index = 0; index < text.length - 1; index += 1) {
    if (text[index] !== "." || text[index + 1] !== " ") {
      continue;
    }
    if (isOrderedListMarkerPeriod(text, index)) {
      continue;
    }
    pieces.push(text.slice(start, index + separator.length));
    start = index + separator.length;
    index += 1;
  }
  pieces.push(text.slice(start));
  return pieces;
}

function isOrderedListMarkerPeriod(text, periodIndex) {
  let lineStart = text.lastIndexOf("\n", periodIndex - 1);
  lineStart = lineStart === -1 ? 0 : lineStart + 1;
  return /^\s*\d+$/.test(text.slice(lineStart, periodIndex));
}

function mergeDifySplitsReference(splits, separator, lengths, maxTokens, overlap) {
  const separatorLength = codePointLength(separator);
  const docs = [];
  let currentDoc = [];
  let total = 0;
  for (const [index, split] of splits.entries()) {
    const length = lengths[index] ?? codePointLength(split);
    if (total + length + (currentDoc.length > 0 ? separatorLength : 0) > maxTokens) {
      if (currentDoc.length > 0) {
        const doc = currentDoc.join(separator).trim();
        if (doc) {
          docs.push(doc);
        }
        while (
          total > overlap ||
          (total + length + (currentDoc.length > 0 ? separatorLength : 0) > maxTokens && total > 0)
        ) {
          total -=
            codePointLength(currentDoc[0] ?? "") + (currentDoc.length > 1 ? separatorLength : 0);
          currentDoc = currentDoc.slice(1);
        }
      }
    }
    currentDoc.push(split);
    total += length + (currentDoc.length > 1 ? separatorLength : 0);
  }
  const doc = currentDoc.join(separator).trim();
  if (doc) {
    docs.push(doc);
  }
  return docs;
}

function splitFixedCharactersWithOverlap(text, size, overlap) {
  const chunks = [];
  let currentPart = "";
  let currentLength = 0;
  let overlapPart = "";
  let overlapLength = 0;
  for (const character of Array.from(text)) {
    if (currentLength + 1 <= size - overlap) {
      currentPart += character;
      currentLength += 1;
    } else if (currentLength + 1 <= size) {
      currentPart += character;
      currentLength += 1;
      overlapPart += character;
      overlapLength += 1;
    } else {
      chunks.push(currentPart);
      currentPart = overlapPart + character;
      currentLength = overlapLength + 1;
      overlapPart = "";
      overlapLength = 0;
    }
  }
  if (currentPart) {
    chunks.push(currentPart);
  }
  return chunks.filter((chunk) => chunk.trim());
}

function compareChunkOutputs(left, right) {
  const leftHashes = left.map((chunk) => chunk.hash ?? sha256(chunk.content).slice(0, 12));
  const rightHashes = right.map((chunk) => chunk.hash ?? sha256(chunk.content).slice(0, 12));
  return {
    left_count: left.length,
    right_count: right.length,
    exact_sequence: JSON.stringify(leftHashes) === JSON.stringify(rightHashes),
    hash_overlap: overlapRatio(leftHashes, rightHashes),
    avg_best_similarity: averageBestSimilarity(left, right)
  };
}

function averageBestSimilarity(left, right) {
  if (left.length === 0 && right.length === 0) {
    return 1;
  }
  if (left.length === 0 || right.length === 0) {
    return 0;
  }
  if (left.length * right.length > 100000) {
    return averageBestSimilarityWindowed(left, right);
  }
  const scores = left.map((leftChunk) =>
    Math.max(...right.map((rightChunk) => trigramJaccard(leftChunk.content, rightChunk.content)))
  );
  return round4(scores.reduce((total, score) => total + score, 0) / scores.length);
}

function averageBestSimilarityWindowed(left, right) {
  const windowSize = 40;
  const scores = left.map((leftChunk, leftIndex) => {
    const projected = Math.round((leftIndex / Math.max(left.length - 1, 1)) * (right.length - 1));
    const start = Math.max(0, projected - windowSize);
    const end = Math.min(right.length, projected + windowSize + 1);
    let best = 0;
    for (let index = start; index < end; index += 1) {
      const rightChunk = right[index];
      if (!rightChunk) {
        continue;
      }
      if (leftChunk.hash && leftChunk.hash === rightChunk.hash) {
        best = 1;
        break;
      }
      best = Math.max(best, trigramJaccard(leftChunk.content, rightChunk.content));
    }
    return best;
  });
  return round4(scores.reduce((total, score) => total + score, 0) / scores.length);
}

function trigramJaccard(left, right) {
  const leftSet = ngrams(left, 3);
  const rightSet = ngrams(right, 3);
  if (leftSet.size === 0 && rightSet.size === 0) {
    return 1;
  }
  let intersection = 0;
  for (const value of leftSet) {
    if (rightSet.has(value)) intersection += 1;
  }
  return intersection / Math.max(leftSet.size + rightSet.size - intersection, 1);
}

function ngrams(value, size) {
  const chars = Array.from(value.replace(/\s+/g, " ").trim());
  if (chars.length <= size) {
    return new Set(chars.length ? [chars.join("")] : []);
  }
  const result = new Set();
  for (let index = 0; index <= chars.length - size; index += 1) {
    result.add(chars.slice(index, index + size).join(""));
  }
  return result;
}

function overlapRatio(left, right) {
  if (left.length === 0 && right.length === 0) {
    return 1;
  }
  const rightSet = new Set(right);
  const hits = left.filter((item) => rightSet.has(item)).length;
  return round4(hits / Math.max(left.length, right.length, 1));
}

function checkMarkdownFidelity(markdown, chunks) {
  const joined = chunks.map((chunk) => chunk.content).join("\n\n");
  const checks = {
    heading: !/^#{1,6}\s/m.test(markdown) || /^#{1,6}\s/m.test(joined),
    blockquote: !/^>\s/m.test(markdown) || /^>\s/m.test(joined),
    code_fence: !/```/.test(markdown) || /```/.test(joined),
    unordered_list: !/^\s*[-*+]\s/m.test(markdown) || /^\s*[-*+]\s/m.test(joined),
    ordered_list: !/^\s*\d+\.\s/m.test(markdown) || /^\s*\d+\.\s/m.test(joined),
    link: !/\[[^\]]+]\([^)]+\)/.test(markdown) || /\[[^\]]+]\([^)]+\)/.test(joined),
    image: !/!\[[^\]]*]\([^)]+\)/.test(markdown) || /!\[[^\]]*]\([^)]+\)/.test(joined)
  };
  return {
    ok: Object.values(checks).every(Boolean),
    checks
  };
}

function summarizeSplitterRows(rows) {
  const byMode = new Map();
  for (const row of rows) {
    const bucket = byMode.get(row.mode) ?? {
      documents: 0,
      dify_chunks: 0,
      openkb_chunks: 0,
      dify_parents: 0,
      openkb_parents: 0,
      dify_children: 0,
      openkb_children: 0,
      exact_sequences: 0,
      hash_overlap_sum: 0,
      avg_best_similarity_sum: 0
    };
    bucket.documents += 1;
    bucket.dify_chunks += row.dify_chunk_count;
    bucket.openkb_chunks += row.openkb_chunk_count;
    bucket.dify_parents += row.dify_parent_count;
    bucket.openkb_parents += row.openkb_parent_count;
    bucket.dify_children += row.dify_child_count;
    bucket.openkb_children += row.openkb_child_count;
    bucket.exact_sequences += row.exact_sequence ? 1 : 0;
    bucket.hash_overlap_sum += row.hash_overlap;
    bucket.avg_best_similarity_sum += row.avg_best_similarity;
    byMode.set(row.mode, bucket);
  }
  return Object.fromEntries(
    [...byMode.entries()].map(([modeId, value]) => [
      modeId,
      {
        documents: value.documents,
        dify_chunks: value.dify_chunks,
        openkb_chunks: value.openkb_chunks,
        dify_parents: value.dify_parents,
        openkb_parents: value.openkb_parents,
        dify_children: value.dify_children,
        openkb_children: value.openkb_children,
        exact_sequences: value.exact_sequences,
        avg_hash_overlap: round4(value.hash_overlap_sum / Math.max(value.documents, 1)),
        avg_best_similarity: round4(value.avg_best_similarity_sum / Math.max(value.documents, 1))
      }
    ])
  );
}

function summarizeFidelity(rows) {
  const failed = rows.filter((row) => !row.markdown_fidelity_ok);
  return {
    total_rows: rows.length,
    failed_rows: failed.length,
    failed_sample: failed.slice(0, 20).map((row) => ({
      doc_id: row.doc_id,
      mode: row.mode,
      checks: row.fidelity.checks
    }))
  };
}

function renderSplitterSummary(summary) {
  const modeRows = Object.entries(summary.modes)
    .map(
      ([modeId, row]) =>
        `| ${modeId} | ${row.documents} | ${row.dify_chunks} | ${row.openkb_chunks} | ${row.dify_parents} | ${row.openkb_parents} | ${row.dify_children} | ${row.openkb_children} | ${row.exact_sequences} | ${row.avg_hash_overlap} | ${row.avg_best_similarity} |`
    )
    .join("\n");
  const worstRows = summary.worst_differences
    .slice(0, 10)
    .map(
      (row) =>
        `| ${row.doc_id} | ${row.mode} | ${row.bucket} | ${row.dify_chunk_count} | ${row.openkb_chunk_count} | ${row.hash_overlap} | ${row.avg_best_similarity} |`
    )
    .join("\n");
  return `# Dify / OpenKB 公开 Markdown 切片 parity 摘要

- Generated at: \`${summary.generated_at}\`
- Corpus: \`${summary.corpus_dir}\`
- Documents: ${summary.corpus_count}
- OpenKB package loaded: ${summary.openkb_package_loaded}

## Modes

| 模式 | 文档数 | Dify chunks | OpenKB chunks | Dify parent | OpenKB parent | Dify child | OpenKB child | 完全一致 | 平均 hash overlap | 平均 best similarity |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${modeRows}

## Markdown fidelity

- Rows: ${summary.markdown_fidelity.total_rows}
- Failed rows: ${summary.markdown_fidelity.failed_rows}

## Worst differences

| 文档 | 模式 | 长度桶 | Dify chunks | OpenKB chunks | hash overlap | best similarity |
| --- | --- | --- | ---: | ---: | ---: | ---: |
${worstRows}

## QA fixture

- Generated QA rows: ${summary.qa.generated_rows}
- Covered documents: ${summary.qa.covered_documents}
`;
}

function renderRetrievalReport(report) {
  const healthRows = report.health_checks
    .map(
      (item) =>
        `| ${item.name} | ${item.url} | ${item.ok ? "ok" : "failed"} | ${item.status ?? ""} | ${item.error ?? ""} |`
    )
    .join("\n");
  return `# Dify / OpenKB 检索环境探测

- Generated at: \`${report.generated_at}\`
- Status: \`${report.status}\`

## Health

| 服务 | URL | 状态 | HTTP | 错误 |
| --- | --- | --- | ---: | --- |
${healthRows}

## Model config snapshot

- OpenKB embedding format: \`${report.model_environment.openkb_embedding_request_format ?? "not set"}\`
- OpenKB embedding model: \`${report.model_environment.openkb_embedding_model ?? "not set"}\`
- OpenKB embedding dim: \`${report.model_environment.openkb_embedding_dim ?? "not set"}\`
- OpenKB rerank format: \`${report.model_environment.openkb_rerank_request_format ?? "not set"}\`
- OpenKB rerank model: \`${report.model_environment.openkb_rerank_model ?? "not set"}\`
- Has OpenKB embedding key: ${report.model_environment.has_openkb_embedding_key}
- Has OpenKB rerank key: ${report.model_environment.has_openkb_rerank_key}
- Has OpenKB CSRF token: ${report.model_environment.has_openkb_csrf_token}
- Dify base URL: \`${report.model_environment.dify_base_url ?? "not set"}\`
- Dify embedding model evidence: \`${report.model_environment.dify_embedding_model ?? "not set"}\`
- Dify rerank provider evidence: \`${report.model_environment.dify_rerank_provider_name ?? "not set"}\`
- Dify rerank model evidence: \`${report.model_environment.dify_rerank_model ?? "not set"}\`
- Dify top_k evidence: \`${report.model_environment.dify_top_k ?? "not set"}\`
- Dify score threshold evidence: \`${report.model_environment.dify_score_threshold ?? "not set"}\`

## Live retrieval blocker

Missing inputs: ${report.missing_live_retrieval_inputs.length ? report.missing_live_retrieval_inputs.map((item) => `\`${item}\``).join(", ") : "none"}

${report.note}
`;
}

function writeLiveRetrievalImportCorpus(corpusDir, docs, targetDir) {
  mkdirSync(targetDir, { recursive: true });
  const documents = [];
  for (const doc of docs) {
    const sourcePath = path.join(corpusDir, doc.local_path);
    if (!existsSync(sourcePath)) {
      continue;
    }
    const marker = `PARITY_ID ${doc.id}`;
    const markdown = readFileSync(sourcePath, "utf8");
    const localPath = `${doc.id}.md`;
    const content = `<!-- ${marker} -->\n\n${marker}\n\n${markdown}`;
    writeFileSync(path.join(targetDir, localPath), content);
    documents.push({
      ...doc,
      local_path: localPath,
      parity_marker: marker,
      parity_marker_hash: sha256(marker),
      source_hash: sha256(markdown),
      import_hash: sha256(content)
    });
  }
  const manifest = {
    generated_at: new Date().toISOString(),
    purpose:
      "Runtime-only import corpus for Dify/OpenKB live retrieval parity. Do not commit these Markdown files.",
    source_corpus_dir: corpusDir,
    documents
  };
  writeJson(path.join(targetDir, "manifest.json"), manifest);
  return manifest;
}

function buildLiveRetrievalQueries(docs, corpusDir, importManifest, requestedCount) {
  const importedById = new Map((importManifest.documents ?? []).map((doc) => [doc.id, doc]));
  const queries = [];
  for (const doc of docs) {
    const imported = importedById.get(doc.id);
    if (!imported) {
      continue;
    }
    const markdown = readFileSync(path.join(corpusDir, doc.local_path), "utf8");
    const title =
      firstHeading(markdown) ?? path.basename(doc.local_path, path.extname(doc.local_path));
    const marker = imported.parity_marker ?? `PARITY_ID ${doc.id}`;
    queries.push({
      id: `${doc.id}:exact-marker`,
      kind: "exact_marker",
      document_id: doc.id,
      expected_marker: marker,
      expected_marker_id: doc.id,
      query: marker
    });
    queries.push({
      id: `${doc.id}:semantic-title`,
      kind: "semantic",
      document_id: doc.id,
      expected_marker: marker,
      expected_marker_id: doc.id,
      query: `What does the document "${title}" explain?`
    });
    queries.push({
      id: `${doc.id}:ambiguous-source`,
      kind: "ambiguous",
      document_id: doc.id,
      expected_marker: marker,
      expected_marker_id: doc.id,
      query: `${title} ${doc.repo ?? ""} documentation details`.trim()
    });
    if (queries.length >= requestedCount) {
      break;
    }
  }
  return queries.slice(0, requestedCount);
}

function buildLiveRetrievalConfig(parsed) {
  const topK = parsePositiveInt(parsed["top-k"], parsePositiveInt(process.env.DIFY_TOP_K, 5));
  const scoreThreshold = parseOptionalNumber(
    parsed["score-threshold"],
    parseOptionalNumber(process.env.DIFY_SCORE_THRESHOLD, 0)
  );
  const searchMethod = String(
    parsed["search-method"] ?? process.env.DIFY_SEARCH_METHOD ?? "hybrid_search"
  );
  const rerankingEnable = parseBoolean(
    parsed.rerank,
    parseBoolean(process.env.DIFY_RERANK_ENABLE, Boolean(process.env.OPENKB_RERANK_MODEL))
  );
  const keywordWeight = parseOptionalNumber(process.env.DIFY_KEYWORD_WEIGHT, 0.5);
  const vectorWeight = parseOptionalNumber(process.env.DIFY_VECTOR_WEIGHT, 0.5);
  const difyEmbeddingProviderName = (process.env.DIFY_EMBEDDING_PROVIDER_NAME ?? "").trim();
  const difyEmbeddingModelName = (process.env.DIFY_EMBEDDING_MODEL ?? "").trim();
  const weights = {
    weight_type: "customized",
    keyword_setting: { keyword_weight: keywordWeight },
    vector_setting: { vector_weight: vectorWeight },
    keyword_weight: keywordWeight,
    vector_weight: vectorWeight
  };
  const difyWeights = {
    ...weights,
    vector_setting: {
      vector_weight: vectorWeight,
      embedding_provider_name: difyEmbeddingProviderName,
      embedding_model_name: difyEmbeddingModelName
    }
  };
  const openkbRetrievalModel = {
    search_method: searchMethod,
    top_k: topK,
    score_threshold_enabled: scoreThreshold > 0,
    score_threshold: scoreThreshold,
    reranking_enable: rerankingEnable,
    weights
  };
  const difyRetrievalModel = { ...openkbRetrievalModel, weights: difyWeights };
  const difyRerankProviderName = (process.env.DIFY_RERANK_PROVIDER_NAME ?? "").trim();
  const difyRerankModelName = (process.env.DIFY_RERANK_MODEL ?? "").trim();
  const difyRerankingMode =
    (process.env.DIFY_RERANK_MODE ?? "reranking_model").trim() || "reranking_model";
  const missingInputs = [];
  if (!difyEmbeddingProviderName) {
    missingInputs.push("DIFY_EMBEDDING_PROVIDER_NAME when Dify hybrid/vector weights are sent");
  }
  if (!difyEmbeddingModelName) {
    missingInputs.push("DIFY_EMBEDDING_MODEL when Dify hybrid/vector weights are sent");
  }
  if (rerankingEnable) {
    if (!difyRerankProviderName) {
      missingInputs.push("DIFY_RERANK_PROVIDER_NAME when rerank is enabled");
    }
    if (!difyRerankModelName) {
      missingInputs.push("DIFY_RERANK_MODEL when rerank is enabled");
    }
    if (difyRerankProviderName && difyRerankModelName) {
      difyRetrievalModel.reranking_mode = difyRerankingMode;
      difyRetrievalModel.reranking_model = {
        reranking_provider_name: difyRerankProviderName,
        reranking_model_name: difyRerankModelName
      };
    }
  }
  return {
    topK,
    scoreThreshold,
    difyRetrievalModel,
    openkbRetrievalModel,
    missingInputs,
    safe: {
      search_method: searchMethod,
      top_k: topK,
      score_threshold_enabled: scoreThreshold > 0,
      score_threshold: scoreThreshold,
      reranking_enable: rerankingEnable,
      reranking_mode:
        rerankingEnable && difyRerankProviderName && difyRerankModelName ? difyRerankingMode : null,
      reranking_model:
        rerankingEnable && difyRerankProviderName && difyRerankModelName
          ? {
              reranking_provider_name: difyRerankProviderName,
              reranking_model_name: difyRerankModelName
            }
          : null,
      weights: {
        ...weights,
        vector_setting: {
          vector_weight: vectorWeight,
          embedding_provider_name: difyEmbeddingProviderName || null,
          embedding_model_name: difyEmbeddingModelName || null
        }
      }
    }
  };
}

function buildDifyConsoleHeaders() {
  const headers = {};
  if (process.env.DIFY_CONSOLE_TOKEN) {
    headers.authorization = `Bearer ${process.env.DIFY_CONSOLE_TOKEN}`;
  }
  if (process.env.DIFY_CONSOLE_COOKIE) {
    headers.cookie = process.env.DIFY_CONSOLE_COOKIE;
  }
  const csrfToken = getDifyConsoleCsrfToken();
  if (csrfToken) {
    headers["X-CSRF-Token"] = csrfToken;
  }
  return headers;
}

function getDifyConsoleCsrfToken() {
  if (process.env.DIFY_CSRF_TOKEN) {
    return process.env.DIFY_CSRF_TOKEN;
  }
  const cookieName = process.env.DIFY_CSRF_COOKIE_NAME || "csrf_token";
  return getCookieValue(process.env.DIFY_CONSOLE_COOKIE ?? "", cookieName);
}

function buildOpenKbSearchHeaders() {
  const headers = {};
  if (process.env.OPENKB_SEARCH_COOKIE) {
    headers.cookie = process.env.OPENKB_SEARCH_COOKIE;
  }
  const csrfToken = getOpenKbCsrfToken();
  if (csrfToken) {
    headers["x-openkb-csrf"] = csrfToken;
  }
  return headers;
}

function getOpenKbCsrfToken() {
  if (process.env.OPENKB_CSRF_TOKEN) {
    return process.env.OPENKB_CSRF_TOKEN;
  }
  const cookieName =
    process.env.OPENKB_CSRF_COOKIE_NAME ||
    process.env.NEXT_PUBLIC_OPENKB_CSRF_COOKIE_NAME ||
    "openkb_csrf";
  return getCookieValue(process.env.OPENKB_SEARCH_COOKIE ?? "", cookieName);
}

function getCookieValue(cookieHeader, name) {
  if (!cookieHeader || !name) {
    return null;
  }
  const prefix = `${name}=`;
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) {
      return trimmed.slice(prefix.length);
    }
  }
  return null;
}

async function postJsonForParity(url, body, extraHeaders = {}) {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...extraHeaders
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000)
    });
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      body: parseMaybeJson(text),
      text_sample: text.slice(0, 500)
    };
  } catch (error) {
    return { ok: false, status: 0, error: error.message, body: null, text_sample: "" };
  }
}

function parseMaybeJson(text) {
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return { raw_text_sample: text.slice(0, 500) };
  }
}

function sanitizeLiveResponseForStorage(response) {
  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    error: response.error,
    body: response.body,
    text_sample: response.text_sample
  };
}

function normalizeDifyRows(body) {
  const records = Array.isArray(body?.records)
    ? body.records
    : Array.isArray(body?.data?.records)
      ? body.data.records
      : Array.isArray(body?.data)
        ? body.data
        : [];
  return records
    .map((record, index) => {
      const segment = toRecord(record.segment);
      const metadata = toRecord(record.metadata ?? segment.metadata);
      const childChunks = Array.isArray(record.child_chunks) ? record.child_chunks : [];
      const content = firstNonEmptyString([
        record.content,
        segment.content,
        segment.answer,
        record.summary,
        ...childChunks.map((chunk) => chunk?.content)
      ]);
      const textForMarker = [
        content,
        segment.content,
        segment.answer,
        JSON.stringify(metadata),
        ...childChunks.map((chunk) => chunk?.content)
      ].join("\n");
      return {
        index,
        id: String(segment.id ?? record.id ?? record.segment_id ?? `dify-${index}`),
        document_id: String(
          segment.document_id ?? record.document_id ?? metadata.document_id ?? ""
        ),
        chunk_id: String(segment.id ?? record.segment_id ?? metadata.segment_id ?? ""),
        title: firstNonEmptyString([
          record.title,
          segment.document?.name,
          metadata.document_name,
          metadata.title
        ]),
        content,
        score: numberOrNull(record.score ?? segment.score ?? metadata.score),
        rerank_score: numberOrNull(record.rerank_score ?? metadata.rerank_score),
        marker: extractParityMarker(textForMarker),
        identity: null,
        metadata
      };
    })
    .map((row) => ({ ...row, identity: row.marker ?? row.document_id ?? row.chunk_id ?? row.id }));
}

function normalizeOpenKbRows(body) {
  const records = Array.isArray(body?.results)
    ? body.results
    : Array.isArray(body?.records)
      ? body.records
      : Array.isArray(body?.data?.results)
        ? body.data.results
        : [];
  return records
    .map((record, index) => {
      const metadata = toRecord(record.metadata);
      const matchChunk = toRecord(record.match_chunk);
      const parentChunk = toRecord(record.parent_chunk);
      const content = firstNonEmptyString([
        record.content,
        matchChunk.content,
        parentChunk.content,
        metadata.qa_answer,
        metadata.summary_text
      ]);
      const textForMarker = [
        content,
        record.title,
        matchChunk.content,
        parentChunk.content,
        JSON.stringify(metadata)
      ].join("\n");
      return {
        index,
        id: String(record.chunk_id ?? record.id ?? `openkb-${index}`),
        document_id: String(record.document_id ?? metadata.document_id ?? ""),
        chunk_id: String(record.chunk_id ?? metadata.chunk_id ?? ""),
        title: firstNonEmptyString([record.title, metadata.document_title, metadata.document_name]),
        content,
        score: numberOrNull(record.score ?? metadata.score),
        rerank_score: numberOrNull(metadata.rerank_score),
        marker: extractParityMarker(textForMarker),
        identity: null,
        metadata
      };
    })
    .map((row) => ({ ...row, identity: row.marker ?? row.document_id ?? row.chunk_id ?? row.id }));
}

function analyzeLiveRetrievalQuery(query, difyRows, openkbRows, difyResponse, openkbResponse) {
  const difyTop = difyRows[0] ?? null;
  const openkbTop = openkbRows[0] ?? null;
  const expectedRankDify = rankOfExpected(difyRows, query.expected_marker_id);
  const expectedRankOpenKb = rankOfExpected(openkbRows, query.expected_marker_id);
  const top3Overlap = identityOverlap(difyRows.slice(0, 3), openkbRows.slice(0, 3));
  const top5Overlap = identityOverlap(difyRows.slice(0, 5), openkbRows.slice(0, 5));
  return {
    query_id: query.id,
    kind: query.kind,
    query: query.query,
    expected_marker_id: query.expected_marker_id,
    dify_ok: difyResponse.ok,
    openkb_ok: openkbResponse.ok,
    dify_status: difyResponse.status,
    openkb_status: openkbResponse.status,
    dify_count: difyRows.length,
    openkb_count: openkbRows.length,
    dify_top_identity: difyTop?.identity ?? null,
    openkb_top_identity: openkbTop?.identity ?? null,
    dify_top_score: difyTop?.score ?? null,
    openkb_top_score: openkbTop?.score ?? null,
    dify_top_rerank_score: difyTop?.rerank_score ?? null,
    openkb_top_rerank_score: openkbTop?.rerank_score ?? null,
    same_top_identity:
      Boolean(difyTop?.identity) &&
      Boolean(openkbTop?.identity) &&
      difyTop.identity === openkbTop.identity,
    dify_expected_rank: expectedRankDify,
    openkb_expected_rank: expectedRankOpenKb,
    dify_expected_hit: expectedRankDify !== null,
    openkb_expected_hit: expectedRankOpenKb !== null,
    dify_mrr: reciprocalRank(expectedRankDify),
    openkb_mrr: reciprocalRank(expectedRankOpenKb),
    dify_ndcg: singleRelevantNdcg(expectedRankDify),
    openkb_ndcg: singleRelevantNdcg(expectedRankOpenKb),
    top3_identity_overlap: top3Overlap,
    top5_identity_overlap: top5Overlap,
    attribution: classifyRetrievalDifference(
      query,
      difyRows,
      openkbRows,
      difyResponse,
      openkbResponse
    )
  };
}

function summarizeLiveRetrievalRows(rows, base) {
  const successfulRows = rows.filter((row) => row.dify_ok && row.openkb_ok);
  return {
    ...base,
    status:
      rows.length > 0 && successfulRows.length === rows.length
        ? "completed"
        : "completed_with_errors",
    total_queries: rows.length,
    successful_queries: successfulRows.length,
    same_top_identity: sumBoolean(successfulRows, "same_top_identity"),
    same_top_identity_rate: ratio(
      sumBoolean(successfulRows, "same_top_identity"),
      successfulRows.length
    ),
    dify_expected_hits: sumBoolean(successfulRows, "dify_expected_hit"),
    openkb_expected_hits: sumBoolean(successfulRows, "openkb_expected_hit"),
    avg_top3_identity_overlap: avg(successfulRows, "top3_identity_overlap"),
    avg_top5_identity_overlap: avg(successfulRows, "top5_identity_overlap"),
    dify_mrr: avg(successfulRows, "dify_mrr"),
    openkb_mrr: avg(successfulRows, "openkb_mrr"),
    dify_ndcg: avg(successfulRows, "dify_ndcg"),
    openkb_ndcg: avg(successfulRows, "openkb_ndcg"),
    by_kind: aggregateLiveRows(successfulRows, (row) => row.kind),
    by_attribution: countBy(rows, (row) => row.attribution),
    worst_differences: successfulRows.filter((row) => !row.same_top_identity).slice(0, 30)
  };
}

function renderLiveRetrievalBlocked(report) {
  return `# Dify / OpenKB live retrieval parity\n\nStatus: \`${report.status}\`\n\n## Missing inputs\n\n${report.missing_live_retrieval_inputs.map((item) => `- \`${item}\``).join("\n")}\n\nGenerated import corpus: \`${report.generated_import_corpus}\`\n\nThe script stopped before calling live retrieval endpoints so the result cannot be mistaken for a parity pass.\n`;
}

function renderLiveRetrievalSummary(summary) {
  const kindRows = Object.entries(summary.by_kind)
    .map(
      ([kind, row]) =>
        `| ${kind} | ${row.queries} | ${row.same_top_identity_rate} | ${row.avg_top3_identity_overlap} | ${row.avg_top5_identity_overlap} | ${row.dify_mrr} | ${row.openkb_mrr} |`
    )
    .join("\n");
  const attributionRows = Object.entries(summary.by_attribution)
    .map(([key, count]) => `| ${key} | ${count} |`)
    .join("\n");
  return `# Dify / OpenKB live retrieval parity\n\n- Status: \`${summary.status}\`\n- Corpus: \`${summary.corpus_dir}\`\n- Queries: ${summary.total_queries}\n- Successful queries: ${summary.successful_queries}\n- Same top identity: ${summary.same_top_identity}/${summary.successful_queries} (${summary.same_top_identity_rate})\n- Average top3 overlap: ${summary.avg_top3_identity_overlap}\n- Average top5 overlap: ${summary.avg_top5_identity_overlap}\n- Dify MRR: ${summary.dify_mrr}\n- OpenKB MRR: ${summary.openkb_mrr}\n\n## By query kind\n\n| Kind | Queries | Same top rate | Avg top3 overlap | Avg top5 overlap | Dify MRR | OpenKB MRR |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: |\n${kindRows}\n\n## Attribution\n\n| Attribution | Queries |\n| --- | ---: |\n${attributionRows}\n\nRaw sanitized responses and normalized rows are stored next to this summary under the runtime parity directory.\n`;
}

function aggregateLiveRows(rows, keyFn) {
  const buckets = new Map();
  for (const row of rows) {
    const key = keyFn(row) ?? "unknown";
    const bucket = buckets.get(key) ?? {
      rows: [],
      same: 0
    };
    bucket.rows.push(row);
    bucket.same += row.same_top_identity ? 1 : 0;
    buckets.set(key, bucket);
  }
  return Object.fromEntries(
    [...buckets.entries()].map(([key, bucket]) => [
      key,
      {
        queries: bucket.rows.length,
        same_top_identity_rate: ratio(bucket.same, bucket.rows.length),
        avg_top3_identity_overlap: avg(bucket.rows, "top3_identity_overlap"),
        avg_top5_identity_overlap: avg(bucket.rows, "top5_identity_overlap"),
        dify_mrr: avg(bucket.rows, "dify_mrr"),
        openkb_mrr: avg(bucket.rows, "openkb_mrr")
      }
    ])
  );
}

function classifyRetrievalDifference(query, difyRows, openkbRows, difyResponse, openkbResponse) {
  if (!difyResponse.ok || !openkbResponse.ok) {
    return "request_error";
  }
  if (difyRows.length === 0 && openkbRows.length === 0) {
    return "both_empty";
  }
  if (difyRows.length === 0) {
    return "dify_empty";
  }
  if (openkbRows.length === 0) {
    return "openkb_empty_or_permission_filtered";
  }
  if ((difyRows[0]?.identity ?? null) === (openkbRows[0]?.identity ?? null)) {
    return "same_top";
  }
  const difyRank = rankOfExpected(difyRows, query.expected_marker_id);
  const openkbRank = rankOfExpected(openkbRows, query.expected_marker_id);
  if (difyRank === null && openkbRank !== null) {
    return "dify_missed_expected";
  }
  if (difyRank !== null && openkbRank === null) {
    return "openkb_missed_expected";
  }
  return "ranking_difference";
}

function rankOfExpected(rows, expectedMarkerId) {
  const target = String(expectedMarkerId ?? "");
  if (!target) {
    return null;
  }
  const index = rows.findIndex(
    (row) => row.marker === target || String(row.identity ?? "").includes(target)
  );
  return index === -1 ? null : index + 1;
}

function reciprocalRank(rank) {
  return rank ? round4(1 / rank) : 0;
}

function singleRelevantNdcg(rank) {
  return rank ? round4(1 / Math.log2(rank + 1)) : 0;
}

function identityOverlap(leftRows, rightRows) {
  const left = new Set(leftRows.map((row) => row.identity).filter(Boolean));
  const right = new Set(rightRows.map((row) => row.identity).filter(Boolean));
  if (left.size === 0 && right.size === 0) {
    return 0;
  }
  let matches = 0;
  for (const value of left) {
    if (right.has(value)) {
      matches += 1;
    }
  }
  return round4(matches / Math.max(left.size, right.size, 1));
}

function extractParityMarker(text) {
  const match = String(text ?? "").match(/PARITY[_ -]?ID[:\s]+([A-Za-z0-9_.-]+)/i);
  return match?.[1] ?? null;
}

function firstNonEmptyString(values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return "";
}

function toRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseOptionalNumber(value, fallback) {
  if (value === undefined || value === null || value === true || value === "") {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  if (typeof value === "boolean") {
    return value;
  }
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function sumBoolean(rows, field) {
  return rows.reduce((total, row) => total + (row[field] ? 1 : 0), 0);
}

function ratio(numerator, denominator) {
  return denominator > 0 ? round4(numerator / denominator) : 0;
}

function joinUrl(base, route) {
  return `${normalizeUrlBase(base)}${route.startsWith("/") ? route : `/${route}`}`;
}

function normalizeUrlBase(value) {
  return String(value ?? "").replace(/\/+$/, "");
}

function normalizeOpenKbApiBase(value) {
  const base = normalizeUrlBase(value);
  if (base.endsWith("/health")) {
    return base.slice(0, -"/health".length);
  }
  if (base.endsWith("/api")) {
    return base.slice(0, -"/api".length);
  }
  return base;
}

function openKbHealthUrl(value) {
  return joinUrl(normalizeOpenKbApiBase(value), "/health");
}

function sanitizeUrlForReport(value) {
  if (!value) {
    return null;
  }
  try {
    const url = new URL(String(value));
    if (url.username) url.username = "***";
    if (url.password) url.password = "***";
    return url.toString();
  } catch {
    return "custom URL configured";
  }
}

function detectModelMismatch(modelEnv) {
  const missing = [];
  if (
    modelEnv.dify_embedding_model &&
    modelEnv.openkb_embedding_model &&
    modelEnv.dify_embedding_model !== modelEnv.openkb_embedding_model
  ) {
    missing.push("DIFY_EMBEDDING_MODEL must match OPENKB_EMBEDDING_MODEL");
  }
  if (
    modelEnv.dify_rerank_model &&
    modelEnv.openkb_rerank_model &&
    modelEnv.dify_rerank_model !== modelEnv.openkb_rerank_model
  ) {
    missing.push("DIFY_RERANK_MODEL must match OPENKB_RERANK_MODEL");
  }
  return missing;
}

function buildQaRowsFromCorpus(docs, corpusDir, limit) {
  const rows = [];
  for (const doc of docs.slice(0, limit)) {
    const markdown = readFileSync(path.join(corpusDir, doc.local_path), "utf8");
    rows.push(...buildQaRowsForMarkdown(doc, markdown));
  }
  return rows;
}

function buildQaRowsForMarkdown(doc, markdown) {
  const title = firstHeading(markdown) ?? doc.id;
  const marker = `PUBLIC-${sha256(markdown).slice(0, 10)}`;
  return [
    {
      id: `${doc.id}-qa-topic`,
      document_id: doc.id,
      source: "csv",
      question: `What is the main topic of ${title}? ${marker}`,
      answer: `The document ${title} is part of the OpenKB/Dify parity corpus. Marker: ${marker}.`
    },
    {
      id: `${doc.id}-qa-source`,
      document_id: doc.id,
      source: "csv",
      question: `Which source repository contains ${title}?`,
      answer: `${title} comes from ${doc.repo}.`
    }
  ];
}

function firstHeading(markdown) {
  const match = markdown.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim() ?? null;
}

function renderFixtureMarkdown(index, slug, title, keywords, marker) {
  const region = ["guiyang", "global", "factory-a", "shanghai", "support"][index % 5];
  const docType = ["legal", "medical", "finance", "sop", "support", "research"][index % 6];
  const sections = Array.from({ length: 4 }, (_, section) => {
    const sec = section + 1;
    const fact = `${marker}-SEC${String(sec).padStart(2, "0")}-FACT${String(sec).padStart(2, "0")}`;
    return `## Section ${sec}: ${title}

${fact} 描述 ${title} 的关键测试目标。English keywords: ${keywords}. 这一段故意包含较长中文和 English mixed content，用于观察 Dify recursive splitter 与 OpenKB Dify-compatible splitter 在边界上的差异。

| 指标 / Metric | 数值 / Value | 说明 / Note |
| --- | ---: | --- |
| ${fact}-A | ${100 + index + sec} | 中文说明与 English note 混排 |
| ${fact}-B | ${200 + index + sec} | 包含 email test${index}@example.com |
| ${fact}-C | ${300 + index + sec} | 包含 URL https://example.com/${slug}/${sec} |

\`\`\`python
def marker_${index}_${sec}():
    return "${fact}"
\`\`\`

- ${fact} nested item one
- ${title} checklist item two
  - 子项包含 marker ${fact}-SUB

> 引用块用于验证 blockquote 与普通段落的边界。${fact}
`;
  }).join("\n");
  return `---
doc_type: ${docType}
owner: parity
region: ${region}
date: 2026-05-${String((index % 28) + 1).padStart(2, "0")}
tags:
  - parity
  - ${slug}
priority: ${(index % 5) + 1}
---

# [PARITY-GENERATED] ${title}

Document marker: ${marker}.
English keywords: ${keywords}.
中文主题：${title}。

${sections}
`;
}

async function loadOpenKbMarkdownPackage() {
  const modulePath = path.resolve("packages/markdown/dist/index.js");
  if (!existsSync(modulePath)) {
    console.warn("OpenKB markdown dist not found; falling back to local reference splitter.");
    return null;
  }
  try {
    return await import(pathToFileURL(modulePath).href);
  } catch (error) {
    console.warn(`Could not import OpenKB markdown package: ${error.message}`);
    return null;
  }
}

async function checkHttp(name, url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const text = await response.text();
    return {
      name,
      url,
      ok: response.ok,
      status: response.status,
      sample: text.slice(0, 160).replace(/\s+/g, " ")
    };
  } catch (error) {
    return { name, url, ok: false, error: error.message };
  }
}

async function fetchDefaultBranch(repo) {
  const data = await fetchJson(`https://api.github.com/repos/${repo}`);
  return data.default_branch;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: githubHeaders(),
    signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} for ${url}`);
  }
  return response.json();
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: githubHeaders(),
    signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} for ${url}`);
  }
  return response.text();
}

function githubHeaders() {
  return {
    "user-agent": "OpenKB parity runner",
    accept: "application/vnd.github+json"
  };
}

function extractZip(zipPath, targetDir) {
  mkdirSync(targetDir, { recursive: true });
  if (process.platform === "win32") {
    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        "Expand-Archive -LiteralPath $args[0] -DestinationPath $args[1] -Force",
        zipPath,
        targetDir
      ],
      { stdio: "inherit" }
    );
  } else {
    execFileSync("unzip", ["-q", "-o", zipPath, "-d", targetDir], { stdio: "inherit" });
  }
  return findReportDir(targetDir);
}

function findReportDir(root) {
  const candidates = [
    root,
    ...readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(root, entry.name))
  ];
  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, "chunk-analysis.json"))) {
      return candidate;
    }
  }
  throw new Error(`Could not find parity report JSON files under ${root}`);
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      continue;
    }
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}

function loadLocalEnvFile(file) {
  if (!existsSync(file)) {
    return;
  }
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim() || line.trimStart().startsWith("#") || !line.includes("=")) {
      continue;
    }
    const [name, ...rest] = line.split("=");
    const key = name.trim().replace(/^\uFEFF/, "");
    if (!key || process.env[key]) {
      continue;
    }
    process.env[key] = rest
      .join("=")
      .trim()
      .replace(/^"(.*)"$/, "$1");
  }
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function sum(rows, field) {
  return rows.reduce((total, row) => total + (row[field] ? 1 : 0), 0);
}

function avg(rows, field) {
  if (rows.length === 0) {
    return 0;
  }
  return round4(rows.reduce((total, row) => total + Number(row[field] ?? 0), 0) / rows.length);
}

function round4(value) {
  return Math.round(value * 10000) / 10000;
}

function toCsv(rows) {
  const headers = Object.keys(rows[0] ?? { question: "", answer: "" });
  return `${headers.join(",")}\n${rows
    .map((row) => headers.map((header) => csvCell(row[header])).join(","))
    .join("\n")}\n`;
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function hashDirectoryFixture(fixtureDir) {
  const hash = createHash("sha256");
  for (const file of readdirSync(fixtureDir)
    .filter((name) => name.endsWith(".md"))
    .sort()) {
    hash.update(file);
    hash.update(readFileSync(path.join(fixtureDir, file)));
  }
  return hash.digest("hex");
}

function codePointLength(value) {
  return Array.from(value).length;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeMarkdownForParity(markdown) {
  return String(markdown ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .trim();
}

function applyDifyCleanProcessor(text, rules) {
  let output = text.replace(
    /<\||\|>|[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\uFFFE]/g,
    (match) => (match === "<|" ? "<" : match === "|>" ? ">" : "")
  );
  if (rules.some((rule) => rule.id === "remove_extra_spaces" && rule.enabled)) {
    output = output
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[\t\f\r \u00a0\u1680\u180e\u2000-\u200a\u202f\u205f\u3000]{2,}/g, " ");
  }
  if (rules.some((rule) => rule.id === "remove_urls_emails" && rule.enabled)) {
    const placeholders = [];
    output = output.replace(/!?\[[^\]]*]\([^)]+\)/g, (match) => {
      const key = `__OPENKB_MARKDOWN_LINK_${placeholders.length}__`;
      placeholders.push([key, match]);
      return key;
    });
    output = output
      .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "")
      .replace(/\bhttps?:\/\/\S+/gi, "");
    for (const [key, value] of placeholders) {
      output = output.replace(key, value);
    }
  }
  return output.trim();
}

function decodeDifySeparator(value) {
  return String(value ?? "")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t");
}

function lengthBucket(length) {
  if (length >= 200 && length < 500) return "0200-0500";
  if (length >= 500 && length < 1000) return "0500-1000";
  if (length >= 1000 && length < 3000) return "1000-3000";
  if (length >= 3000 && length < 6000) return "3000-6000";
  if (length >= 6000 && length <= 10000) return "6000-10000";
  return null;
}

function detectMarkdownFeatures(markdown) {
  return {
    frontmatter: /^---\n[\s\S]*?\n---\n/.test(markdown),
    headings: (markdown.match(/^#{1,6}\s+/gm) ?? []).length,
    tables: /\n\|.*\|\n\|[\s:-]+\|/.test(markdown),
    code_fences: (markdown.match(/```/g) ?? []).length >= 2,
    unordered_lists: /^\s*[-*+]\s/m.test(markdown),
    ordered_lists: /^\s*\d+\.\s/m.test(markdown),
    blockquotes: /^>\s/m.test(markdown),
    links: /\[[^\]]+]\([^)]+\)/.test(markdown),
    images: /!\[[^\]]*]\([^)]+\)/.test(markdown),
    cjk: /[\u4e00-\u9fff]/.test(markdown),
    english: /[A-Za-z]{4,}/.test(markdown)
  };
}

function renderCorpusReadme(manifest) {
  const buckets = Object.entries(manifest.buckets)
    .map(([bucket, count]) => `- ${bucket}: ${count}`)
    .join("\n");
  return `# Public Markdown parity corpus

Generated at: ${manifest.generated_at}

Documents: ${manifest.accepted_count}/${manifest.requested_count}

## Buckets

${buckets}

## Sources

${manifest.sources.map((source) => `- ${source}`).join("\n")}

This corpus is a local test artifact. Do not commit the downloaded Markdown files.
`;
}

function deterministicShuffle(items, seed) {
  return items
    .map((item) => ({
      item,
      key: sha256(`${seed}:${item.repo}:${item.path}`)
    }))
    .sort((left, right) => left.key.localeCompare(right.key))
    .map((entry) => entry.item);
}

function bucketTargetsSatisfied(items, targets) {
  return Object.entries(targets).every(
    ([bucket, target]) => items.filter((item) => item.bucket === bucket).length >= target
  );
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = keyFn(item) ?? "unknown";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function safeSlug(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function printUsageAndExit() {
  console.error(`Usage:
  node scripts/parity/run-dify-openkb-parity.mjs --report-dir <dir>
  node scripts/parity/run-dify-openkb-parity.mjs --zip <report.zip>
  node scripts/parity/run-dify-openkb-parity.mjs --generate-fixtures --fixture-count 40
  node scripts/parity/run-dify-openkb-parity.mjs --download-public-corpus --corpus-count 100
  node scripts/parity/run-dify-openkb-parity.mjs --splitter-parity --corpus-dir <dir>
  node scripts/parity/run-dify-openkb-parity.mjs --live-retrieval --corpus-dir <dir> --query-count 240 --confirm-same-corpus-indexed
  node scripts/parity/run-dify-openkb-parity.mjs --public-corpus-run --corpus-count 100
`);
  process.exit(1);
}
