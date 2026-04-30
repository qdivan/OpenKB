export const DIFY_API_KEY_PREFIX = "dify_";
export const DEFAULT_DIFY_MAX_TOP_K = 20;

export type DifyAdapterConfig = {
  apiKeyPrefix: string;
  maxTopK: number;
  resultBaseUrl: string;
};

export function getDifyAdapterConfig(env: NodeJS.ProcessEnv = process.env): DifyAdapterConfig {
  return {
    apiKeyPrefix: env.DIFY_API_KEY_PREFIX || DIFY_API_KEY_PREFIX,
    maxTopK: parsePositiveInt(env.DIFY_MAX_TOP_K, DEFAULT_DIFY_MAX_TOP_K),
    resultBaseUrl: normalizeBaseUrl(env.DIFY_RESULT_BASE_URL || env.APP_BASE_URL || "")
  };
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = value ? Number(value) : fallback;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}
