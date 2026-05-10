import { Inject, Injectable } from "@nestjs/common";
import { AuthError, AuthService, type AuthenticatedUser } from "@openkb/auth";
import { createDatabaseClient, type Prisma, type PrismaClient } from "@openkb/db";
import {
  COMPLEX_IMPORT_FORMATS,
  DEFAULT_IMPORT_FORMAT_ROUTES,
  EXTERNAL_IMPORT_TOOL_KEYS,
  IMPORT_TOOL_CAPABILITIES,
  IMPORT_TOOL_MODES,
  encryptImportToolSecret,
  getImportToolRuntimeConfig,
  getImportToolSecretLast4,
  isComplexImportFormat,
  isExternalImportToolKey,
  probeImportTool,
  toolSupportsFormat,
  type ComplexImportFormat,
  type ExternalImportToolKey,
  type ImportToolMode,
  type StoredImportFormatRoute,
  type StoredImportToolSetting
} from "@openkb/import-tools";

export type UpdateImportToolSettingInput = {
  enabled?: boolean;
  mode?: string;
  endpoint?: string | null;
  command?: string | null;
  timeout_ms?: number | null;
  max_file_mb?: number | null;
  options?: Prisma.InputJsonValue;
  api_key?: string | null;
};

export type UpdateImportFormatRouteInput = {
  enabled?: boolean;
  primary_tool?: string;
  fallback_tools?: string[];
};

@Injectable()
export class ImportToolsAdminService {
  private readonly prisma: PrismaClient;

  constructor(@Inject(AuthService) private readonly auth: AuthService) {
    this.prisma = createDatabaseClient();
  }

  async disconnect(): Promise<void> {
    await this.prisma.$disconnect();
  }

  async list(sessionToken: string | null) {
    await this.requireSystemAdmin(sessionToken);
    const [settings, routes] = await Promise.all([
      this.prisma.importToolSetting.findMany({ orderBy: { tool_key: "asc" } }),
      this.prisma.importFormatRoute.findMany({ orderBy: { format: "asc" } })
    ]);
    const settingsByTool = new Map(settings.map((setting) => [setting.tool_key, setting]));
    const routesByFormat = new Map(routes.map((route) => [route.format, route]));

    return {
      tools: EXTERNAL_IMPORT_TOOL_KEYS.map((toolKey) =>
        toImportToolSettingDto(toolKey, settingsByTool.get(toolKey))
      ),
      routes: COMPLEX_IMPORT_FORMATS.map((format) =>
        toImportFormatRouteDto(format, routesByFormat.get(format))
      )
    };
  }

  async updateTool(
    sessionToken: string | null,
    toolKeyInput: string,
    input: UpdateImportToolSettingInput = {}
  ) {
    const me = await this.requireSystemAdmin(sessionToken);
    const toolKey = parseToolKey(toolKeyInput);
    const normalized = normalizeToolUpdate(toolKey, input);
    const secretUpdate = normalizeSecretUpdate(input);
    const now = new Date();

    const setting = await this.prisma.importToolSetting.upsert({
      where: { tool_key: toolKey },
      create: {
        tool_key: toolKey,
        enabled: normalized.enabled,
        mode: normalized.mode,
        endpoint: normalized.endpoint,
        command: normalized.command,
        timeout_ms: normalized.timeout_ms,
        max_file_mb: normalized.max_file_mb,
        options: normalized.options,
        encrypted_api_key: secretUpdate?.encrypted_api_key ?? null,
        api_key_last4: secretUpdate?.api_key_last4 ?? null,
        updated_by: me.user.id,
        created_at: now,
        updated_at: now
      },
      update: {
        enabled: normalized.enabled,
        mode: normalized.mode,
        endpoint: normalized.endpoint,
        command: normalized.command,
        timeout_ms: normalized.timeout_ms,
        max_file_mb: normalized.max_file_mb,
        options: normalized.options,
        ...(secretUpdate ?? {}),
        updated_by: me.user.id,
        updated_at: now
      }
    });

    await this.writeAudit(me, "admin.import_tool.update", "import_tool_setting", setting.id, {
      tool_key: toolKey,
      enabled: normalized.enabled,
      mode: normalized.mode,
      endpoint_present: Boolean(normalized.endpoint),
      command_present: Boolean(normalized.command),
      secret_updated: Boolean(secretUpdate)
    });

    return toImportToolSettingDto(toolKey, setting);
  }

  async clearSecret(sessionToken: string | null, toolKeyInput: string) {
    const me = await this.requireSystemAdmin(sessionToken);
    const toolKey = parseToolKey(toolKeyInput);
    const setting = await this.prisma.importToolSetting.findUnique({
      where: { tool_key: toolKey }
    });
    if (!setting) {
      throw new AuthError("OBJECT_NOT_FOUND", "Import tool setting was not found.", 404);
    }
    const updated = await this.prisma.importToolSetting.update({
      where: { tool_key: toolKey },
      data: {
        encrypted_api_key: null,
        api_key_last4: null,
        updated_by: me.user.id,
        updated_at: new Date()
      }
    });
    await this.writeAudit(me, "admin.import_tool.secret.clear", "import_tool_setting", updated.id, {
      tool_key: toolKey
    });
    return toImportToolSettingDto(toolKey, updated);
  }

  async probe(sessionToken: string | null, toolKeyInput: string) {
    await this.requireSystemAdmin(sessionToken);
    const toolKey = parseToolKey(toolKeyInput);
    const [settings, routes] = await Promise.all([
      this.prisma.importToolSetting.findMany(),
      this.prisma.importFormatRoute.findMany()
    ]);
    try {
      const config = getImportToolRuntimeConfig(
        process.env,
        settings.map(toStoredImportToolSetting),
        routes.map(toStoredImportFormatRoute)
      );
      return await probeImportTool(config.tools[toolKey]);
    } catch (error) {
      return {
        configured: true,
        ok: false,
        error: error instanceof Error ? error.message : "Import tool probe failed."
      };
    }
  }

  async updateRoute(
    sessionToken: string | null,
    formatInput: string,
    input: UpdateImportFormatRouteInput = {}
  ) {
    const me = await this.requireSystemAdmin(sessionToken);
    const format = parseFormat(formatInput);
    const primaryTool = parseToolKey(
      input.primary_tool ?? DEFAULT_IMPORT_FORMAT_ROUTES[format].primaryTool
    );
    const fallbackTools = normalizeFallbackTools(input.fallback_tools ?? []);
    const enabled = typeof input.enabled === "boolean" ? input.enabled : true;
    validateRoute(format, primaryTool, fallbackTools);
    if (enabled) {
      await this.assertRouteToolsConfigured([primaryTool, ...fallbackTools]);
    }

    const now = new Date();
    const route = await this.prisma.importFormatRoute.upsert({
      where: { format },
      create: {
        format,
        enabled,
        primary_tool: primaryTool,
        fallback_tools: fallbackTools,
        updated_by: me.user.id,
        created_at: now,
        updated_at: now
      },
      update: {
        enabled,
        primary_tool: primaryTool,
        fallback_tools: fallbackTools,
        updated_by: me.user.id,
        updated_at: now
      }
    });

    await this.writeAudit(me, "admin.import_tool.route.update", "import_format_route", route.id, {
      format,
      primary_tool: primaryTool,
      fallback_tools: fallbackTools,
      enabled: route.enabled
    });

    return toImportFormatRouteDto(format, route);
  }

  private async assertRouteToolsConfigured(tools: ExternalImportToolKey[]): Promise<void> {
    const settings = await this.prisma.importToolSetting.findMany();
    const runtime = getImportToolRuntimeConfig(
      process.env,
      settings.map(toStoredImportToolSetting),
      []
    );
    const unavailable = tools.filter((tool) => {
      const config = runtime.tools[tool];
      return !config.enabled || !config.configured || Boolean(config.secretError);
    });
    if (unavailable.length > 0) {
      throw new AuthError(
        "INVALID_INPUT",
        `Import tools are disabled or not configured: ${unavailable.join(", ")}`,
        400
      );
    }
  }

  private async requireSystemAdmin(sessionToken: string | null): Promise<AuthenticatedUser> {
    const me = await this.auth.getMe(sessionToken);
    if (!me.roles.includes("system_admin")) {
      throw new AuthError("ADMIN_REQUIRED", "System admin role is required.", 403);
    }
    return me;
  }

  private async writeAudit(
    me: AuthenticatedUser,
    action: string,
    objectType: string,
    objectId: string,
    metadata: Prisma.InputJsonObject
  ): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        tenant_id: me.tenantId,
        actor_user_id: me.user.id,
        actor_type: "user",
        action,
        object_type: objectType,
        object_id: objectId,
        metadata,
        created_at: new Date()
      }
    });
  }
}

function parseToolKey(value: string): ExternalImportToolKey {
  if (isExternalImportToolKey(value)) {
    return value;
  }
  throw new AuthError("INVALID_INPUT", "Unsupported import tool.", 400);
}

function parseFormat(value: string): ComplexImportFormat {
  if (isComplexImportFormat(value)) {
    return value;
  }
  throw new AuthError("INVALID_INPUT", "Unsupported import format.", 400);
}

function normalizeToolUpdate(toolKey: ExternalImportToolKey, input: UpdateImportToolSettingInput) {
  const capability = IMPORT_TOOL_CAPABILITIES[toolKey];
  const mode = normalizeMode(input.mode, capability.defaultMode);
  if (!capability.modes.includes(mode)) {
    throw new AuthError("INVALID_INPUT", "Import tool mode is not supported for this tool.", 400);
  }
  const enabled = typeof input.enabled === "boolean" ? input.enabled : false;
  const endpoint = normalizeOptionalText(input.endpoint);
  const command = normalizeOptionalText(input.command);
  if (enabled && mode === "http_api") {
    validateHttpEndpoint(endpoint);
  }
  if (enabled && mode === "local_cli" && !command) {
    throw new AuthError("INVALID_INPUT", "Import tool command is required.", 400);
  }
  return {
    enabled,
    mode,
    endpoint,
    command,
    timeout_ms: normalizeInt(input.timeout_ms, 120000, 1000, 600000),
    max_file_mb: normalizeInt(input.max_file_mb, 100, 1, 2048),
    options: normalizeJsonObject(input.options ?? {})
  };
}

function validateHttpEndpoint(value: string | null): void {
  if (!value) {
    throw new AuthError("INVALID_INPUT", "Import tool endpoint is required.", 400);
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("unsupported protocol");
    }
  } catch {
    throw new AuthError("INVALID_INPUT", "Import tool endpoint must be a valid HTTP URL.", 400);
  }
}

function normalizeMode(value: string | null | undefined, fallback: ImportToolMode): ImportToolMode {
  if (!value) {
    return fallback;
  }
  if (IMPORT_TOOL_MODES.includes(value as ImportToolMode)) {
    return value as ImportToolMode;
  }
  throw new AuthError("INVALID_INPUT", "Unsupported import tool mode.", 400);
}

function normalizeSecretUpdate(input: UpdateImportToolSettingInput) {
  const secret = typeof input.api_key === "string" ? input.api_key.trim() : "";
  if (!secret) {
    return null;
  }
  return {
    encrypted_api_key: encryptImportToolSecret(secret),
    api_key_last4: getImportToolSecretLast4(secret)
  };
}

function normalizeFallbackTools(values: string[]): ExternalImportToolKey[] {
  return [...new Set(values.map(parseToolKey))];
}

function validateRoute(
  format: ComplexImportFormat,
  primaryTool: ExternalImportToolKey,
  fallbackTools: ExternalImportToolKey[]
) {
  const tools = [primaryTool, ...fallbackTools];
  const unsupported = tools.filter((tool) => !toolSupportsFormat(tool, format));
  if (unsupported.length > 0) {
    throw new AuthError(
      "INVALID_INPUT",
      `Import tools do not support ${format}: ${unsupported.join(", ")}`,
      400
    );
  }
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized || null;
}

function normalizeInt(
  value: number | null | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  if (value === null || value === undefined) {
    return fallback;
  }
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new AuthError("INVALID_INPUT", "Numeric import tool setting is out of range.", 400);
  }
  return value;
}

function normalizeJsonObject(value: Prisma.InputJsonValue): Prisma.InputJsonValue {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value;
  }
  throw new AuthError("INVALID_INPUT", "options must be a JSON object.", 400);
}

function toImportToolSettingDto(
  toolKey: ExternalImportToolKey,
  setting:
    | {
        tool_key: string;
        enabled: boolean;
        mode: string;
        endpoint: string | null;
        command: string | null;
        timeout_ms: number | null;
        max_file_mb: number | null;
        encrypted_api_key: string | null;
        api_key_last4: string | null;
        options: Prisma.JsonValue;
        updated_by: string;
        updated_at: Date;
      }
    | null
    | undefined
) {
  const capability = IMPORT_TOOL_CAPABILITIES[toolKey];
  const envCommand = capability.envCommand ? process.env[capability.envCommand] : undefined;
  const envEndpoint = capability.envEndpoint ? process.env[capability.envEndpoint] : undefined;
  const envApiKey = capability.envApiKey ? process.env[capability.envApiKey] : undefined;
  const source = setting
    ? setting.enabled
      ? "db"
      : "disabled"
    : envCommand || envEndpoint || envApiKey
      ? "env"
      : capability.defaultCommand
        ? "default"
        : "none";

  return {
    tool_key: toolKey,
    label: capability.label,
    formats: capability.formats,
    modes: capability.modes,
    source,
    enabled: setting ? setting.enabled : true,
    configured:
      source === "disabled"
        ? false
        : (setting?.mode ?? capability.defaultMode) === "http_api"
          ? Boolean(setting?.endpoint ?? envEndpoint)
          : Boolean(setting?.command ?? envCommand ?? capability.defaultCommand),
    mode: setting?.mode ?? capability.defaultMode,
    endpoint: setting?.endpoint ?? envEndpoint ?? null,
    command: setting?.command ?? envCommand ?? capability.defaultCommand,
    timeout_ms:
      setting?.timeout_ms ?? parsePositiveEnvInt(process.env.OPENKB_IMPORT_TOOL_TIMEOUT_MS, 120000),
    max_file_mb:
      setting?.max_file_mb ?? parsePositiveEnvInt(process.env.OPENKB_IMPORT_MAX_FILE_MB, 100),
    has_secret: Boolean(setting?.encrypted_api_key || envApiKey),
    api_key_last4:
      setting?.api_key_last4 ?? (envApiKey?.trim() ? getImportToolSecretLast4(envApiKey) : null),
    options: setting?.options ?? {},
    updated_by: setting?.updated_by ?? null,
    updated_at: setting?.updated_at ? setting.updated_at.toISOString() : null
  };
}

function toImportFormatRouteDto(
  format: ComplexImportFormat,
  route:
    | {
        format: string;
        enabled: boolean;
        primary_tool: string;
        fallback_tools: string[];
        updated_by: string;
        updated_at: Date;
      }
    | null
    | undefined
) {
  const defaults = DEFAULT_IMPORT_FORMAT_ROUTES[format];
  return {
    format,
    enabled: route?.enabled ?? true,
    source: route ? "db" : "default",
    primary_tool: route?.primary_tool ?? defaults.primaryTool,
    fallback_tools: route?.fallback_tools ?? defaults.fallbackTools,
    updated_by: route?.updated_by ?? null,
    updated_at: route?.updated_at ? route.updated_at.toISOString() : null
  };
}

function toStoredImportToolSetting(setting: unknown): StoredImportToolSetting {
  const row = setting as StoredImportToolSetting;
  return {
    ...row,
    options: row.options ?? {}
  };
}

function toStoredImportFormatRoute(route: unknown): StoredImportFormatRoute {
  return route as StoredImportFormatRoute;
}

function parsePositiveEnvInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
