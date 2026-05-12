import type { FastifyCorsOptions } from "@fastify/cors";

const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:3001",
  "http://127.0.0.1:3001"
] as const;

export function createCorsOptions(env: NodeJS.ProcessEnv = process.env): FastifyCorsOptions {
  const allowedOrigins = new Set([
    ...(shouldAllowLocalOrigins(env) ? DEFAULT_ALLOWED_ORIGINS : []),
    ...splitOrigins(env.CORS_ORIGINS),
    ...splitOrigins(env.WEB_BASE_URL),
    ...splitOrigins(env.APP_BASE_URL)
  ]);

  return {
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["content-type", "authorization", "x-openkb-csrf"],
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error("Not allowed by CORS"), false);
    }
  };
}

function shouldAllowLocalOrigins(env: NodeJS.ProcessEnv): boolean {
  const explicit = parseOptionalBoolean(env.OPENKB_ALLOW_LOCAL_CORS);
  if (explicit !== null) {
    return explicit;
  }
  return env.NODE_ENV !== "production";
}

function splitOrigins(value: string | undefined): string[] {
  return value
    ? value
        .split(",")
        .map((origin) => origin.trim().replace(/\/$/, ""))
        .filter(Boolean)
    : [];
}

function parseOptionalBoolean(value: string | undefined): boolean | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === "auto") {
    return null;
  }
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return null;
}
