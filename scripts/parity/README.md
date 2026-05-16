# OpenKB / Dify parity helpers

This folder contains lightweight helpers for Dify parity analysis. Large reports, raw API responses, screenshots, and generated run output must stay under `.codex-runtime/` and must not be committed.

## Summarize an existing report

```powershell
node scripts/parity/run-dify-openkb-parity.mjs `
  --report-dir .codex-runtime/reports/openkb-dify-parity-v2-20260515-000821/openkb-dify-parity-v2-20260515-000821
```

The command writes:

```text
.codex-runtime/parity-runs/<timestamp>/parity-summary.json
.codex-runtime/parity-runs/<timestamp>/parity-summary.zh-CN.md
```

## Extract a zip then summarize

```powershell
node scripts/parity/run-dify-openkb-parity.mjs --zip "D:\path\to\openkb-dify-parity.zip"
```

The zip is extracted under `.codex-runtime/parity-runs/<timestamp>/extracted/`.

## Generate comparable Markdown fixtures

```powershell
node scripts/parity/run-dify-openkb-parity.mjs --generate-fixtures --fixture-count 40
```

The generated fixtures cover at least 40 focused Markdown samples: frontmatter, tables, code blocks, lists, blockquotes, URLs/emails, Markdown links/images, emoji, mixed Chinese/English text, and long paragraphs. They are meant for local Dify/OpenKB test imports, not for direct commit.

The fixture directory also includes `splitter-golden-fixtures.json`. Use it as the small, reviewable baseline for comparing:

- raw Markdown
- Milkdown-normalized Markdown
- indexed/preprocessed text
- Dify 1.14.1 splitter output
- OpenKB splitter output

Large comparison outputs still belong under `.codex-runtime/parity-runs/<timestamp>/`.

## Download a public Markdown corpus and compare splitters

```powershell
node scripts/parity/run-dify-openkb-parity.mjs --public-corpus-run --corpus-count 100
```

This downloads public Markdown documents into `.codex-runtime/parity-runs/<timestamp>/corpus/`, then runs the local Dify-reference splitter and the OpenKB splitter across:

- standard automatic
- standard custom with `\n`, `\n\n`, `。`, `. `, and space separators
- hierarchical paragraph parent
- hierarchical full-doc parent
- QA model rows generated from the corpus manifest

The script first tries the GitHub tree API. If anonymous API quota is exhausted, it falls back to sparse `git clone` under `.codex-runtime`. It clears transient GitHub proxy settings for that clone path and never commits downloaded source files.

## Re-run splitter comparison from an existing corpus

```powershell
node scripts/parity/run-dify-openkb-parity.mjs `
  --splitter-parity `
  --retrieval-probe `
  --corpus-dir .codex-runtime/parity-runs/<timestamp>/corpus
```

`--retrieval-probe` writes a sanitized environment report. By default the script loads `.env` for non-printing local model evidence; use `--env-file <path>` to point it at another local env file. It does not print raw keys. Live Dify/OpenKB retrieval still requires a Dify dataset/API token, an OpenKB session cookie or equivalent harness, and proof that both sides indexed the same corpus.

## Run live retrieval parity

Live retrieval parity compares Dify console hit-testing with OpenKB `/api/search` against the same corpus and retrieval settings. It refuses to run if required inputs are missing, and writes a blocked report instead of producing misleading metrics.

Required local environment variables:

```text
DIFY_CONSOLE_API_BASE_URL=http://localhost:18080/console/api
DIFY_DATASET_ID=<dify dataset id>
DIFY_CONSOLE_TOKEN=<token>              # or DIFY_CONSOLE_COOKIE=<cookie>
OPENKB_API_BASE_URL=http://localhost:4101
OPENKB_KNOWLEDGE_BASE_ID=<openkb kb id>
OPENKB_SEARCH_COOKIE=<cookie>
OPENKB_CSRF_TOKEN=<csrf token>          # optional if OPENKB_SEARCH_COOKIE already contains openkb_csrf
PARITY_CONFIRM_SAME_CORPUS_INDEXED=true
```

Optional retrieval controls:

```text
DIFY_SEARCH_METHOD=hybrid_search
DIFY_TOP_K=5
DIFY_SCORE_THRESHOLD=0
DIFY_RERANK_ENABLE=true
DIFY_KEYWORD_WEIGHT=0.5
DIFY_VECTOR_WEIGHT=0.5
DIFY_EMBEDDING_MODEL=qwen3-vl-embedding
DIFY_RERANK_PROVIDER_NAME=<dify provider name>
DIFY_RERANK_MODEL=qwen3-vl-rerank
DIFY_RERANK_MODE=reranking_model
```

When rerank is enabled, Dify hit-testing needs both `DIFY_RERANK_PROVIDER_NAME` and `DIFY_RERANK_MODEL` so the request override uses the same reranking model as OpenKB. OpenKB `/api/search` is a cookie-authenticated mutation, so the script sends `x-openkb-csrf` from `OPENKB_CSRF_TOKEN` or the configured CSRF cookie name inside `OPENKB_SEARCH_COOKIE`.

Run:

```powershell
node scripts/parity/run-dify-openkb-parity.mjs `
  --live-retrieval `
  --corpus-dir .codex-runtime/parity-runs/<timestamp>/corpus `
  --query-count 240 `
  --confirm-same-corpus-indexed
```

Outputs stay under `.codex-runtime/parity-runs/<timestamp>/retrieval/`:

- `corpus-import/`: runtime-only Markdown copies with `PARITY_ID` markers for importing into both systems.
- `live-retrieval-queries.json`: exact marker, semantic, and ambiguous queries.
- `live-retrieval-raw.sanitized.json`: raw response bodies without request headers or secrets.
- `live-retrieval-normalized.json`: normalized Dify/OpenKB result rows.
- `live-retrieval-summary.json` and `.zh-CN.md`: top1/top3/top5 overlap, MRR/nDCG, score/rerank score, and attribution.

## Secret handling

Do not pass API keys as command arguments. If live model checks are added, read keys from temporary environment variables only and write only sanitized status output.
