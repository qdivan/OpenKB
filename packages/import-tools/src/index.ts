import { spawn } from "node:child_process";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";

import {
  createAssetImageMarkdown,
  createAssetLinkMarkdown,
  normalizeMarkdownSource,
  validateMarkdownForImport
} from "@openkb/editor";
import {
  convertImportFile,
  MarkdownConversionError,
  type ImportConversionWarning
} from "@openkb/markdown";

export const IMPORT_TOOLS_PACKAGE_NAME = "@openkb/import-tools";

export const INTERNAL_IMPORT_CONVERTERS = ["markdown", "text", "html", "csv"] as const;
export const EXTERNAL_IMPORT_TOOL_KEYS = [
  "markitdown",
  "mineru",
  "pandoc",
  "tesseract_ocr"
] as const;
export const REQUESTED_IMPORT_CONVERTERS = [
  "auto",
  ...INTERNAL_IMPORT_CONVERTERS,
  ...EXTERNAL_IMPORT_TOOL_KEYS
] as const;
export const COMPLEX_IMPORT_FORMATS = ["pdf", "docx", "pptx", "xlsx", "image"] as const;
export const IMPORT_TOOL_MODES = ["local_cli", "http_api"] as const;

export type InternalImportConverter = (typeof INTERNAL_IMPORT_CONVERTERS)[number];
export type ExternalImportToolKey = (typeof EXTERNAL_IMPORT_TOOL_KEYS)[number];
export type RequestedImportConverter = (typeof REQUESTED_IMPORT_CONVERTERS)[number];
export type ComplexImportFormat = (typeof COMPLEX_IMPORT_FORMATS)[number];
export type ImportToolMode = (typeof IMPORT_TOOL_MODES)[number];
export type DetectedImportFormat = InternalImportConverter | ComplexImportFormat | "unknown";

export type ImportToolErrorCode =
  | "CONVERTER_UNAVAILABLE"
  | "CONVERSION_FAILED"
  | "IMPORT_TOOL_AUTH_FAILED"
  | "IMPORT_TOOL_NOT_CONFIGURED"
  | "IMPORT_TOOL_TIMEOUT"
  | "IMPORT_TOOL_UNAVAILABLE"
  | "MARKDOWN_DIALECT_ERROR";

export class ImportToolError extends Error {
  constructor(
    public readonly code: ImportToolErrorCode,
    message: string,
    public readonly warnings: ImportConversionWarning[] = [],
    public readonly statusCode = 400
  ) {
    super(message);
  }
}

export type StoredImportToolSetting = {
  tool_key: string;
  enabled: boolean;
  mode: string;
  endpoint: string | null;
  command: string | null;
  timeout_ms: number | null;
  max_file_mb: number | null;
  encrypted_api_key: string | null;
  api_key_last4: string | null;
  options: unknown;
  updated_by: string;
  updated_at?: Date;
};

export type StoredImportFormatRoute = {
  format: string;
  enabled: boolean;
  primary_tool: string;
  fallback_tools: string[];
  updated_by: string;
  updated_at?: Date;
};

export type ImportToolEffectiveConfig = {
  toolKey: ExternalImportToolKey;
  enabled: boolean;
  configured: boolean;
  source: "db" | "env" | "default" | "disabled" | "none";
  mode: ImportToolMode;
  endpoint: string | null;
  command: string | null;
  timeoutMs: number;
  maxFileMb: number;
  apiKey?: string;
  hasSecret: boolean;
  apiKeyLast4: string | null;
  secretError?: string;
  options: Record<string, unknown>;
};

export type ImportFormatRoute = {
  format: ComplexImportFormat;
  enabled: boolean;
  source: "db" | "default";
  primaryTool: ExternalImportToolKey;
  fallbackTools: ExternalImportToolKey[];
};

export type ImportToolRuntimeConfig = {
  tools: Record<ExternalImportToolKey, ImportToolEffectiveConfig>;
  routes: Record<ComplexImportFormat, ImportFormatRoute>;
};

export type ImportExtractedAsset = {
  placeholderId: string;
  filename: string;
  contentType: string;
  body: Buffer;
  kind: "image" | "attachment";
};

export type ImportToolConversionResult = {
  converter: string;
  title: string;
  markdown: string;
  warnings: ImportConversionWarning[];
  metadata: Record<string, unknown>;
  assets: ImportExtractedAsset[];
};

export type ConvertImportSourceInput = {
  filename: string;
  mimeType?: string;
  content: Buffer | Uint8Array | string;
  converter?: RequestedImportConverter | string;
  runtimeConfig?: ImportToolRuntimeConfig;
  env?: NodeJS.ProcessEnv;
  adapters?: Partial<Record<ExternalImportToolKey, ImportToolAdapter>>;
};

export type ImportToolAdapterInput = {
  tool: ImportToolEffectiveConfig;
  format: ComplexImportFormat;
  filename: string;
  mimeType?: string;
  content: Buffer;
};

export type ImportToolAdapter = (
  input: ImportToolAdapterInput
) => Promise<Omit<ImportToolConversionResult, "converter">>;

type CommandResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

export const DEFAULT_IMPORT_FORMAT_ROUTES: Record<
  ComplexImportFormat,
  { primaryTool: ExternalImportToolKey; fallbackTools: ExternalImportToolKey[] }
> = {
  pdf: { primaryTool: "markitdown", fallbackTools: ["mineru"] },
  docx: { primaryTool: "markitdown", fallbackTools: ["pandoc", "mineru"] },
  pptx: { primaryTool: "markitdown", fallbackTools: ["pandoc", "mineru"] },
  xlsx: { primaryTool: "markitdown", fallbackTools: ["pandoc", "mineru"] },
  image: { primaryTool: "markitdown", fallbackTools: ["tesseract_ocr", "mineru"] }
};

export const IMPORT_TOOL_CAPABILITIES: Record<
  ExternalImportToolKey,
  {
    label: string;
    modes: ImportToolMode[];
    formats: ComplexImportFormat[];
    defaultMode: ImportToolMode;
    defaultCommand: string | null;
    envCommand?: string;
    envEndpoint?: string;
    envApiKey?: string;
  }
> = {
  markitdown: {
    label: "MarkItDown",
    modes: ["local_cli"],
    formats: ["pdf", "docx", "pptx", "xlsx", "image"],
    defaultMode: "local_cli",
    defaultCommand: "markitdown",
    envCommand: "OPENKB_MARKITDOWN_COMMAND"
  },
  mineru: {
    label: "MinerU",
    modes: ["http_api"],
    formats: ["pdf", "docx", "pptx", "xlsx", "image"],
    defaultMode: "http_api",
    defaultCommand: null,
    envEndpoint: "OPENKB_MINERU_ENDPOINT",
    envApiKey: "OPENKB_MINERU_API_KEY"
  },
  pandoc: {
    label: "Pandoc",
    modes: ["local_cli"],
    formats: ["docx", "pptx", "xlsx"],
    defaultMode: "local_cli",
    defaultCommand: "pandoc",
    envCommand: "OPENKB_PANDOC_COMMAND"
  },
  tesseract_ocr: {
    label: "Tesseract OCR",
    modes: ["local_cli"],
    formats: ["image"],
    defaultMode: "local_cli",
    defaultCommand: "tesseract",
    envCommand: "OPENKB_TESSERACT_COMMAND"
  }
};

export function isRequestedImportConverter(value: string): value is RequestedImportConverter {
  return REQUESTED_IMPORT_CONVERTERS.includes(value as RequestedImportConverter);
}

export function isExternalImportToolKey(value: string): value is ExternalImportToolKey {
  return EXTERNAL_IMPORT_TOOL_KEYS.includes(value as ExternalImportToolKey);
}

export function isComplexImportFormat(value: string): value is ComplexImportFormat {
  return COMPLEX_IMPORT_FORMATS.includes(value as ComplexImportFormat);
}

export function isInternalImportConverter(value: string): value is InternalImportConverter {
  return INTERNAL_IMPORT_CONVERTERS.includes(value as InternalImportConverter);
}

export function toolSupportsFormat(toolKey: string, format: string): boolean {
  if (!isExternalImportToolKey(toolKey) || !isComplexImportFormat(format)) {
    return false;
  }
  return IMPORT_TOOL_CAPABILITIES[toolKey].formats.includes(format);
}

export function detectImportFormat(filename: string, mimeType?: string): DetectedImportFormat {
  const extension = extname(filename.trim().toLowerCase());
  if (extension === ".md" || extension === ".markdown") return "markdown";
  if (extension === ".txt") return "text";
  if (extension === ".html" || extension === ".htm") return "html";
  if (extension === ".csv") return "csv";
  if (extension === ".pdf") return "pdf";
  if (extension === ".doc" || extension === ".docx") return "docx";
  if (extension === ".ppt" || extension === ".pptx") return "pptx";
  if (extension === ".xls" || extension === ".xlsx") return "xlsx";
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp"].includes(extension)) return "image";

  const normalizedMime = mimeType?.toLowerCase() ?? "";
  if (normalizedMime === "text/markdown") return "markdown";
  if (normalizedMime.startsWith("text/plain")) return "text";
  if (normalizedMime.includes("html")) return "html";
  if (normalizedMime.includes("csv")) return "csv";
  if (normalizedMime.includes("pdf")) return "pdf";
  if (normalizedMime.includes("wordprocessingml") || normalizedMime.includes("msword")) {
    return "docx";
  }
  if (normalizedMime.includes("presentationml") || normalizedMime.includes("powerpoint")) {
    return "pptx";
  }
  if (normalizedMime.includes("spreadsheetml") || normalizedMime.includes("excel")) {
    return "xlsx";
  }
  if (normalizedMime.startsWith("image/")) return "image";
  return "unknown";
}

export function getImportToolRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
  settings: StoredImportToolSetting[] = [],
  routes: StoredImportFormatRoute[] = []
): ImportToolRuntimeConfig {
  const settingByTool = new Map(settings.map((setting) => [setting.tool_key, setting]));
  const routeByFormat = new Map(routes.map((route) => [route.format, route]));
  const tools = Object.fromEntries(
    EXTERNAL_IMPORT_TOOL_KEYS.map((toolKey) => [
      toolKey,
      resolveToolConfig(toolKey, env, settingByTool.get(toolKey))
    ])
  ) as Record<ExternalImportToolKey, ImportToolEffectiveConfig>;
  const routeEntries = COMPLEX_IMPORT_FORMATS.map((format) => [
    format,
    resolveFormatRoute(format, routeByFormat.get(format))
  ]);

  return {
    tools,
    routes: Object.fromEntries(routeEntries) as Record<ComplexImportFormat, ImportFormatRoute>
  };
}

export async function convertImportSource(
  input: ConvertImportSourceInput
): Promise<ImportToolConversionResult> {
  const converter = normalizeRequested(input.converter ?? "auto");
  const format = detectImportFormat(input.filename, input.mimeType);

  if (converter === "auto" || isInternalImportConverter(converter)) {
    if (isInternalImportConverter(format)) {
      return wrapInternalConversion(
        convertImportFile({
          filename: input.filename,
          mimeType: input.mimeType,
          content: input.content,
          converter: converter === "auto" ? "auto" : converter
        })
      );
    }
    if (converter !== "auto") {
      return wrapInternalConversion(
        convertImportFile({
          filename: input.filename,
          mimeType: input.mimeType,
          content: input.content,
          converter
        })
      );
    }
  }

  if (!isComplexImportFormat(format)) {
    throw new ImportToolError("CONVERTER_UNAVAILABLE", "Converter is not available.", [
      {
        code: "CONVERTER_UNAVAILABLE",
        message: "No enabled import adapter matches this file type."
      }
    ]);
  }

  const runtimeConfig =
    input.runtimeConfig ?? getImportToolRuntimeConfig(input.env ?? process.env, [], []);
  const toolRoute = converter === "auto" ? routeTools(runtimeConfig.routes[format]) : [converter];
  const warnings: ImportConversionWarning[] = [];
  const contentBuffer = toBuffer(input.content);

  if (toolRoute.length === 0) {
    throw new ImportToolError("IMPORT_TOOL_NOT_CONFIGURED", `${format} import route is disabled.`, [
      {
        code: "IMPORT_TOOL_NOT_CONFIGURED",
        message: `${format} import route is disabled.`
      }
    ]);
  }

  for (const toolKey of toolRoute) {
    if (!isExternalImportToolKey(toolKey) || !toolSupportsFormat(toolKey, format)) {
      warnings.push({
        code: "CONVERTER_UNAVAILABLE",
        message: `${toolKey} does not support ${format} import.`
      });
      continue;
    }
    const tool = runtimeConfig.tools[toolKey];
    if (!tool.enabled || !tool.configured) {
      warnings.push({
        code: "IMPORT_TOOL_NOT_CONFIGURED",
        message: `${IMPORT_TOOL_CAPABILITIES[toolKey].label} is not configured.`
      });
      continue;
    }
    if (tool.secretError) {
      warnings.push({
        code: "IMPORT_TOOL_AUTH_FAILED",
        message: `${IMPORT_TOOL_CAPABILITIES[toolKey].label}: ${tool.secretError}`
      });
      continue;
    }
    if (contentBuffer.byteLength > tool.maxFileMb * 1024 * 1024) {
      warnings.push({
        code: "CONVERTER_UNAVAILABLE",
        message: `${IMPORT_TOOL_CAPABILITIES[toolKey].label} max file size is ${tool.maxFileMb}MB.`
      });
      continue;
    }

    try {
      const adapter = input.adapters?.[toolKey] ?? defaultAdapters[toolKey];
      const result = await adapter({
        tool,
        format,
        filename: input.filename,
        mimeType: input.mimeType,
        content: contentBuffer
      });
      const markdown = validateMarkdown(result.markdown, [...warnings, ...result.warnings]);
      return {
        converter: toolKey,
        title: result.title,
        markdown,
        warnings: [...warnings, ...result.warnings],
        metadata: {
          ...result.metadata,
          format,
          selected_tool: toolKey,
          attempted_tools: toolRoute.slice(0, toolRoute.indexOf(toolKey) + 1)
        },
        assets: result.assets
      };
    } catch (error) {
      const failure = toImportToolFailure(error, toolKey);
      warnings.push(...failure.warnings);
    }
  }

  throw new ImportToolError(
    warnings.some((warning) => warning.code === "IMPORT_TOOL_UNAVAILABLE")
      ? "IMPORT_TOOL_UNAVAILABLE"
      : "CONVERTER_UNAVAILABLE",
    "No import adapter could convert this file.",
    warnings
  );
}

export async function probeImportTool(
  tool: ImportToolEffectiveConfig
): Promise<{ configured: boolean; ok: boolean; latency_ms?: number; error?: string }> {
  if (!tool.enabled || !tool.configured) {
    return { configured: false, ok: false, error: "Import tool is not configured." };
  }
  if (tool.secretError) {
    return { configured: true, ok: false, error: tool.secretError };
  }
  const startedAt = Date.now();
  try {
    if (tool.mode === "http_api") {
      if (!tool.endpoint) {
        return { configured: false, ok: false, error: "Import tool endpoint is missing." };
      }
      const response = await fetch(tool.endpoint, {
        method: "GET",
        headers: tool.apiKey ? { authorization: `Bearer ${tool.apiKey}` } : undefined
      });
      if (!response.ok && response.status !== 405) {
        return {
          configured: true,
          ok: false,
          latency_ms: Date.now() - startedAt,
          error: `HTTP ${response.status}`
        };
      }
      return { configured: true, ok: true, latency_ms: Date.now() - startedAt };
    }

    const command = parseCommand(tool.command);
    const result = await runCommand(command.executable, [...command.args, "--version"], {
      timeoutMs: Math.min(tool.timeoutMs, 10_000)
    });
    return result.exitCode === 0
      ? { configured: true, ok: true, latency_ms: Date.now() - startedAt }
      : {
          configured: true,
          ok: false,
          latency_ms: Date.now() - startedAt,
          error: result.stderr || result.stdout || `Exit ${result.exitCode}`
        };
  } catch (error) {
    return {
      configured: true,
      ok: false,
      latency_ms: Date.now() - startedAt,
      error: error instanceof Error ? error.message : "Import tool probe failed."
    };
  }
}

export function encryptImportToolSecret(
  secret: string,
  encryptionKey = process.env.OPENKB_CONFIG_ENCRYPTION_KEY
): string {
  const normalized = secret.trim();
  if (!normalized) {
    throw new ImportToolError("IMPORT_TOOL_AUTH_FAILED", "Import tool API key cannot be empty.");
  }
  const key = deriveEncryptionKey(encryptionKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(normalized, "utf8"), cipher.final()]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url")
  ].join(":");
}

export function decryptImportToolSecret(
  encryptedSecret: string,
  encryptionKey = process.env.OPENKB_CONFIG_ENCRYPTION_KEY
): string {
  const key = deriveEncryptionKey(encryptionKey);
  const parts = encryptedSecret.split(":");
  if (parts.length !== 4 || parts[0] !== "v1") {
    throw new ImportToolError(
      "IMPORT_TOOL_AUTH_FAILED",
      "Import tool API key ciphertext is invalid."
    );
  }
  try {
    const [, ivPart, tagPart, ciphertextPart] = parts as [string, string, string, string];
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivPart, "base64url"));
    decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextPart, "base64url")),
      decipher.final()
    ]).toString("utf8");
  } catch {
    throw new ImportToolError(
      "IMPORT_TOOL_AUTH_FAILED",
      "Import tool API key cannot be decrypted with the current OPENKB_CONFIG_ENCRYPTION_KEY.",
      [],
      500
    );
  }
}

export function getImportToolSecretLast4(secret: string): string {
  return secret.trim().slice(-4);
}

const defaultAdapters: Record<ExternalImportToolKey, ImportToolAdapter> = {
  markitdown: convertWithMarkItDown,
  mineru: convertWithMinerU,
  pandoc: convertWithPandoc,
  tesseract_ocr: convertWithTesseract
};

async function convertWithMarkItDown(input: ImportToolAdapterInput) {
  return withTempDir(async (dir) => {
    const inputPath = await writeTempInput(dir, input.filename, input.content);
    const outputPath = join(dir, "output.md");
    const command = parseCommand(input.tool.command);
    const result = await runCommand(
      command.executable,
      [...command.args, inputPath, "-o", outputPath],
      { timeoutMs: input.tool.timeoutMs }
    );
    assertCommandSucceeded(result, "MarkItDown");
    const markdown = await readFile(outputPath, "utf8").catch(() => result.stdout);
    return {
      title: titleFromFilename(input.filename),
      markdown: normalizeMarkdownSource(markdown || result.stdout),
      warnings: commandWarnings(result, "MARKITDOWN_STDERR"),
      metadata: { tool_mode: "local_cli" },
      assets: [] as ImportExtractedAsset[]
    };
  });
}

async function convertWithPandoc(input: ImportToolAdapterInput) {
  return withTempDir(async (dir) => {
    const inputPath = await writeTempInput(dir, input.filename, input.content);
    const outputPath = join(dir, "output.md");
    const mediaDir = join(dir, "media");
    const command = parseCommand(input.tool.command);
    const result = await runCommand(
      command.executable,
      [...command.args, inputPath, "--to", "gfm", "--extract-media", mediaDir, "-o", outputPath],
      { timeoutMs: input.tool.timeoutMs }
    );
    assertCommandSucceeded(result, "Pandoc");
    const mediaAssets = await collectExtractedAssets(mediaDir);
    const markdown = await readFile(outputPath, "utf8").catch(() => result.stdout);
    const rewritten = rewriteMediaLinks(markdown || result.stdout, mediaAssets);
    return {
      title: titleFromFilename(input.filename),
      markdown: normalizeMarkdownSource(rewritten.markdown),
      warnings: commandWarnings(result, "PANDOC_STDERR"),
      metadata: { tool_mode: "local_cli", extracted_assets: rewritten.assets.length },
      assets: rewritten.assets
    };
  });
}

async function convertWithTesseract(input: ImportToolAdapterInput) {
  return withTempDir(async (dir) => {
    const inputPath = await writeTempInput(dir, input.filename, input.content);
    const outputBase = join(dir, "ocr-output");
    const language =
      typeof input.tool.options.language === "string" ? input.tool.options.language : "eng";
    const command = parseCommand(input.tool.command);
    const result = await runCommand(
      command.executable,
      [...command.args, inputPath, outputBase, "-l", language],
      {
        timeoutMs: input.tool.timeoutMs
      }
    );
    assertCommandSucceeded(result, "Tesseract OCR");
    const text = await readFile(`${outputBase}.txt`, "utf8").catch(() => result.stdout);
    const title = titleFromFilename(input.filename);
    return {
      title,
      markdown: normalizeMarkdownSource(`# ${escapeInlineMarkdown(title)}\n\n${text.trim()}`),
      warnings: [
        ...commandWarnings(result, "TESSERACT_STDERR"),
        {
          code: "OCR_LAYOUT_LIMITED",
          message:
            "Tesseract OCR output is plain text and may lose layout, tables, and reading order."
        }
      ],
      metadata: { tool_mode: "local_cli", language },
      assets: [] as ImportExtractedAsset[]
    };
  });
}

async function convertWithMinerU(input: ImportToolAdapterInput) {
  if (!input.tool.endpoint) {
    throw new ImportToolError("IMPORT_TOOL_NOT_CONFIGURED", "MinerU endpoint is not configured.");
  }
  const form = new FormData();
  const blob = new Blob([input.content], { type: input.mimeType || "application/octet-stream" });
  form.append("file", blob, input.filename);
  form.append("format", input.format);
  form.append("output", "markdown");

  const response = await fetch(input.tool.endpoint, {
    method: "POST",
    headers: input.tool.apiKey ? { authorization: `Bearer ${input.tool.apiKey}` } : undefined,
    body: form,
    signal: AbortSignal.timeout(input.tool.timeoutMs)
  }).catch((error) => {
    const message =
      error instanceof Error && error.name === "TimeoutError"
        ? `MinerU request timed out after ${input.tool.timeoutMs}ms.`
        : error instanceof Error
          ? error.message
          : "MinerU request failed.";
    throw new ImportToolError(
      message.includes("timed out") ? "IMPORT_TOOL_TIMEOUT" : "CONVERSION_FAILED",
      message
    );
  });

  if (response.status === 401 || response.status === 403) {
    throw new ImportToolError(
      "IMPORT_TOOL_AUTH_FAILED",
      `MinerU returned HTTP ${response.status}.`
    );
  }
  if (!response.ok) {
    throw new ImportToolError("CONVERSION_FAILED", `MinerU returned HTTP ${response.status}.`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("json") ? await response.json() : await response.text();
  const markdown = extractMinerUMarkdown(payload);
  const warnings = extractMinerUWarnings(payload);
  return {
    title: titleFromFilename(input.filename),
    markdown: normalizeMarkdownSource(markdown),
    warnings,
    metadata: { tool_mode: "http_api" },
    assets: [] as ImportExtractedAsset[]
  };
}

function wrapInternalConversion(result: {
  converter: InternalImportConverter;
  title: string;
  markdown: string;
  warnings: ImportConversionWarning[];
}): ImportToolConversionResult {
  return {
    converter: result.converter,
    title: result.title,
    markdown: result.markdown,
    warnings: result.warnings,
    metadata: { format: result.converter, selected_tool: "internal" },
    assets: []
  };
}

function normalizeRequested(value: string): RequestedImportConverter {
  if (isRequestedImportConverter(value)) {
    return value;
  }
  throw new ImportToolError("CONVERTER_UNAVAILABLE", "Converter is not available.", [
    { code: "CONVERTER_UNAVAILABLE", message: `${value} is not an enabled import converter.` }
  ]);
}

function resolveToolConfig(
  toolKey: ExternalImportToolKey,
  env: NodeJS.ProcessEnv,
  setting: StoredImportToolSetting | undefined
): ImportToolEffectiveConfig {
  const capability = IMPORT_TOOL_CAPABILITIES[toolKey];
  const globalTimeout = parsePositiveInt(env.OPENKB_IMPORT_TOOL_TIMEOUT_MS, 120_000);
  const globalMaxFileMb = parsePositiveInt(env.OPENKB_IMPORT_MAX_FILE_MB, 100);
  const envCommand = capability.envCommand ? emptyToNull(env[capability.envCommand]) : null;
  const envEndpoint = capability.envEndpoint ? emptyToNull(env[capability.envEndpoint]) : null;
  const envApiKey = capability.envApiKey ? emptyToNull(env[capability.envApiKey]) : null;

  if (setting) {
    if (!setting.enabled) {
      return {
        toolKey,
        enabled: false,
        configured: false,
        source: "disabled",
        mode: normalizeMode(setting.mode, capability.defaultMode),
        endpoint: null,
        command: null,
        timeoutMs: normalizePositiveNumber(setting.timeout_ms, globalTimeout),
        maxFileMb: normalizePositiveNumber(setting.max_file_mb, globalMaxFileMb),
        hasSecret: false,
        apiKeyLast4: null,
        options: normalizeOptions(setting.options)
      };
    }
    const mode = normalizeMode(setting.mode, capability.defaultMode);
    const secret = resolveDbSecret(setting.encrypted_api_key, env.OPENKB_CONFIG_ENCRYPTION_KEY);
    const command = emptyToNull(setting.command) ?? envCommand ?? capability.defaultCommand;
    const endpoint = emptyToNull(setting.endpoint) ?? envEndpoint;
    return {
      toolKey,
      enabled: true,
      configured: mode === "http_api" ? Boolean(endpoint) : Boolean(command),
      source: "db",
      mode,
      endpoint,
      command,
      timeoutMs: normalizePositiveNumber(setting.timeout_ms, globalTimeout),
      maxFileMb: normalizePositiveNumber(setting.max_file_mb, globalMaxFileMb),
      apiKey: secret.apiKey ?? (secret.error ? undefined : (envApiKey ?? undefined)),
      hasSecret: Boolean(setting.encrypted_api_key || envApiKey),
      apiKeyLast4:
        setting.api_key_last4 ?? (envApiKey ? getImportToolSecretLast4(envApiKey) : null),
      secretError: secret.error,
      options: normalizeOptions(setting.options)
    };
  }

  const source =
    envCommand || envEndpoint || envApiKey ? "env" : capability.defaultCommand ? "default" : "none";
  const command = envCommand ?? capability.defaultCommand;
  const endpoint = envEndpoint;
  return {
    toolKey,
    enabled: true,
    configured: capability.defaultMode === "http_api" ? Boolean(endpoint) : Boolean(command),
    source,
    mode: capability.defaultMode,
    endpoint,
    command,
    timeoutMs: globalTimeout,
    maxFileMb: globalMaxFileMb,
    apiKey: envApiKey ?? undefined,
    hasSecret: Boolean(envApiKey),
    apiKeyLast4: envApiKey ? getImportToolSecretLast4(envApiKey) : null,
    options: {}
  };
}

function resolveDbSecret(
  encryptedApiKey: string | null,
  encryptionKey: string | undefined
): { apiKey?: string; error?: string } {
  if (!encryptedApiKey) {
    return {};
  }
  try {
    return { apiKey: decryptImportToolSecret(encryptedApiKey, encryptionKey) };
  } catch (error) {
    if (error instanceof ImportToolError) {
      return { error: error.message };
    }
    throw error;
  }
}

function resolveFormatRoute(
  format: ComplexImportFormat,
  stored: StoredImportFormatRoute | undefined
): ImportFormatRoute {
  const fallback = DEFAULT_IMPORT_FORMAT_ROUTES[format];
  if (!stored) {
    return {
      format,
      enabled: true,
      source: "default",
      primaryTool: fallback.primaryTool,
      fallbackTools: fallback.fallbackTools
    };
  }
  if (!stored.enabled) {
    return {
      format,
      enabled: false,
      source: "db",
      primaryTool: fallback.primaryTool,
      fallbackTools: []
    };
  }
  const primaryTool = isExternalImportToolKey(stored.primary_tool)
    ? stored.primary_tool
    : fallback.primaryTool;
  const fallbackTools = stored.fallback_tools.filter(isExternalImportToolKey);
  return {
    format,
    enabled: true,
    source: "db",
    primaryTool,
    fallbackTools
  };
}

function routeTools(route: ImportFormatRoute): ExternalImportToolKey[] {
  if (!route.enabled) {
    return [];
  }
  return [...new Set([route.primaryTool, ...route.fallbackTools])];
}

function validateMarkdown(markdownInput: string, warnings: ImportConversionWarning[]) {
  const markdown = normalizeMarkdownSource(markdownInput);
  const validation = validateMarkdownForImport(markdown);
  if (!validation.ok) {
    throw new ImportToolError(
      "MARKDOWN_DIALECT_ERROR",
      "Imported Markdown is outside the enabled Milkdown dialect.",
      [
        ...warnings,
        ...validation.issues.map((issue) => ({
          code: issue.code,
          message: `${issue.message} Line ${issue.line}.`
        }))
      ]
    );
  }
  return markdown;
}

function toImportToolFailure(
  error: unknown,
  toolKey: ExternalImportToolKey
): { warnings: ImportConversionWarning[] } {
  if (error instanceof MarkdownConversionError) {
    return {
      warnings: [
        ...error.warnings,
        ...error.issues.map((issue) => ({
          code: issue.code,
          message: `${IMPORT_TOOL_CAPABILITIES[toolKey].label}: ${issue.message} Line ${issue.line}.`
        }))
      ]
    };
  }
  if (error instanceof ImportToolError) {
    return {
      warnings: error.warnings.length
        ? error.warnings
        : [
            {
              code: error.code,
              message: `${IMPORT_TOOL_CAPABILITIES[toolKey].label}: ${error.message}`
            }
          ]
    };
  }
  return {
    warnings: [
      {
        code: "CONVERSION_FAILED",
        message: `${IMPORT_TOOL_CAPABILITIES[toolKey].label}: ${
          error instanceof Error ? error.message : "Conversion failed."
        }`
      }
    ]
  };
}

async function withTempDir<T>(callback: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "openkb-import-"));
  try {
    return await callback(dir);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function writeTempInput(dir: string, filename: string, content: Buffer): Promise<string> {
  const safeName = basename(filename).replace(/[^A-Za-z0-9._-]/g, "_") || "input.bin";
  const inputPath = join(dir, safeName);
  await writeFile(inputPath, content);
  return inputPath;
}

function parseCommand(command: string | null): { executable: string; args: string[] } {
  const parts = splitCommand(command ?? "");
  const executable = parts.shift();
  if (!executable) {
    throw new ImportToolError(
      "IMPORT_TOOL_NOT_CONFIGURED",
      "Import tool command is not configured."
    );
  }
  return { executable, args: parts };
}

function splitCommand(value: string): string[] {
  const parts: string[] = [];
  const pattern = /"([^"]+)"|'([^']+)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value))) {
    parts.push(match[1] ?? match[2] ?? match[3] ?? "");
  }
  return parts.filter(Boolean);
}

function runCommand(
  executable: string,
  args: string[],
  options: { timeoutMs: number }
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => {
      child.kill();
      settled = true;
      reject(
        new ImportToolError(
          "IMPORT_TOOL_TIMEOUT",
          `Import tool timed out after ${options.timeoutMs}ms.`
        )
      );
    }, options.timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += Buffer.from(chunk).toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += Buffer.from(chunk).toString("utf8");
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      if (settled) return;
      clearTimeout(timeout);
      reject(
        new ImportToolError(
          error.code === "ENOENT" ? "IMPORT_TOOL_UNAVAILABLE" : "CONVERSION_FAILED",
          error.message
        )
      );
    });
    child.on("close", (exitCode) => {
      if (settled) return;
      clearTimeout(timeout);
      resolve({ exitCode, stdout, stderr });
    });
  });
}

function assertCommandSucceeded(result: CommandResult, label: string) {
  if (result.exitCode !== 0) {
    throw new ImportToolError(
      "CONVERSION_FAILED",
      `${label} exited with code ${result.exitCode}.`,
      commandWarnings(result, `${label.toUpperCase()}_STDERR`)
    );
  }
}

function commandWarnings(result: CommandResult, code: string): ImportConversionWarning[] {
  const stderr = result.stderr.trim();
  return stderr ? [{ code, message: stderr.slice(0, 1000) }] : [];
}

async function collectExtractedAssets(mediaDir: string): Promise<ImportExtractedAsset[]> {
  const files = await listFiles(mediaDir).catch(() => []);
  const assets: ImportExtractedAsset[] = [];
  for (const file of files) {
    const body = await readFile(file);
    const filename = basename(file);
    const placeholderId = `import_asset_${assets.length}`;
    assets.push({
      placeholderId,
      filename,
      contentType: contentTypeFromFilename(filename),
      body,
      kind: isImageFilename(filename) ? "image" : "attachment"
    });
  }
  return assets;
}

async function listFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const next = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(next)));
    } else if (entry.isFile()) {
      files.push(next);
    }
  }
  return files;
}

function rewriteMediaLinks(markdown: string, assets: ImportExtractedAsset[]) {
  if (assets.length === 0) {
    return { markdown, assets };
  }
  const assetByFilename = new Map(assets.map((asset) => [asset.filename.toLowerCase(), asset]));
  const nextMarkdown = markdown.replace(
    /(!?\[[^\]]*\]\()([^)\s]+)(\))/g,
    (match, prefix, url, suffix) => {
      const file = assetByFilename.get(basename(String(url)).toLowerCase());
      if (!file) {
        return match;
      }
      const replacement =
        file.kind === "image"
          ? createAssetImageMarkdown(file.placeholderId, file.filename)
          : createAssetLinkMarkdown(file.placeholderId, file.filename);
      return replacement;
    }
  );
  return { markdown: nextMarkdown, assets };
}

function extractMinerUMarkdown(payload: unknown): string {
  if (typeof payload === "string") {
    return payload;
  }
  if (typeof payload !== "object" || payload === null) {
    throw new ImportToolError("CONVERSION_FAILED", "MinerU response is invalid.");
  }
  const record = payload as Record<string, unknown>;
  const candidates = [
    record.markdown,
    record.content,
    (record.result as Record<string, unknown> | undefined)?.markdown,
    (record.data as Record<string, unknown> | undefined)?.markdown
  ];
  const markdown = candidates.find((candidate) => typeof candidate === "string");
  if (!markdown) {
    throw new ImportToolError("CONVERSION_FAILED", "MinerU response did not include Markdown.");
  }
  return markdown;
}

function extractMinerUWarnings(payload: unknown): ImportConversionWarning[] {
  if (typeof payload !== "object" || payload === null) {
    return [];
  }
  const warnings = (payload as Record<string, unknown>).warnings;
  if (!Array.isArray(warnings)) {
    return [];
  }
  return warnings.map((warning) =>
    typeof warning === "string"
      ? { code: "MINERU_WARNING", message: warning }
      : {
          code:
            typeof (warning as Record<string, unknown>).code === "string"
              ? String((warning as Record<string, unknown>).code)
              : "MINERU_WARNING",
          message:
            typeof (warning as Record<string, unknown>).message === "string"
              ? String((warning as Record<string, unknown>).message)
              : JSON.stringify(warning)
        }
  );
}

function contentTypeFromFilename(filename: string): string {
  const extension = extname(filename).toLowerCase();
  if (extension === ".png") return "image/png";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".gif") return "image/gif";
  if (extension === ".webp") return "image/webp";
  if (extension === ".svg") return "image/svg+xml";
  return "application/octet-stream";
}

function isImageFilename(filename: string): boolean {
  return contentTypeFromFilename(filename).startsWith("image/");
}

function deriveEncryptionKey(value: string | undefined): Buffer {
  const normalized = value?.trim();
  if (!normalized) {
    throw new ImportToolError(
      "IMPORT_TOOL_AUTH_FAILED",
      "OPENKB_CONFIG_ENCRYPTION_KEY is required to save or read import tool API keys.",
      [],
      500
    );
  }
  if (/^[a-f0-9]{64}$/i.test(normalized)) {
    return Buffer.from(normalized, "hex");
  }
  try {
    const decoded = Buffer.from(normalized, "base64");
    if (decoded.length === 32) {
      return decoded;
    }
  } catch {
    // Fall through to hashed passphrase support.
  }
  return createHash("sha256").update(normalized).digest();
}

function toBuffer(value: Buffer | Uint8Array | string): Buffer {
  return typeof value === "string" ? Buffer.from(value) : Buffer.from(value);
}

function titleFromFilename(filename: string): string {
  const title = basename(filename)
    .replace(/\.[^.]+$/, "")
    .trim();
  return title || "Imported document";
}

function escapeInlineMarkdown(value: string): string {
  return value.replace(/([\\`*_{}\[\]()#+\-.!|>])/g, "\\$1");
}

function emptyToNull(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized || null;
}

function normalizeMode(value: string | undefined, fallback: ImportToolMode): ImportToolMode {
  return IMPORT_TOOL_MODES.includes(value as ImportToolMode) ? (value as ImportToolMode) : fallback;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizePositiveNumber(value: number | null | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function normalizeOptions(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
