import { Socket } from "node:net";
import { connect as tlsConnect, TLSSocket } from "node:tls";

import { decryptModelSecret, encryptModelSecret, getModelSecretLast4 } from "@openkb/model-client";

export const EMAIL_PACKAGE_NAME = "@openkb/email";
export const DEFAULT_SMTP_TIMEOUT_MS = 10_000;

export type StoredSmtpSetting = {
  enabled: boolean;
  host: string | null;
  port: number | null;
  secure: boolean;
  username: string | null;
  from_email: string | null;
  reply_to: string | null;
  encrypted_password: string | null;
  password_last4: string | null;
  updated_at?: Date | null;
  updated_by?: string | null;
};

export type SmtpConfig = {
  enabled: boolean;
  host?: string;
  port?: number;
  secure: boolean;
  username?: string;
  password?: string;
  fromEmail?: string;
  replyTo?: string;
  source: "db" | "env" | "dev";
  passwordLast4?: string | null;
  secretError?: string;
};

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

export type EmailSendResult = {
  ok: boolean;
  source: SmtpConfig["source"];
  message?: string;
  error?: string;
};

export class EmailConfigError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}

export function getSmtpConfig(
  env: NodeJS.ProcessEnv = process.env,
  setting?: StoredSmtpSetting | null
): SmtpConfig {
  if (setting?.enabled) {
    const password = decryptOptionalSecret(setting.encrypted_password, env);
    return {
      enabled: true,
      host: emptyToUndefined(setting.host),
      port: setting.port ?? undefined,
      secure: setting.secure,
      username: emptyToUndefined(setting.username),
      password: password.value,
      fromEmail: emptyToUndefined(setting.from_email),
      replyTo: emptyToUndefined(setting.reply_to),
      source: "db",
      passwordLast4: setting.password_last4 ?? null,
      secretError: password.error
    };
  }

  const envConfig: SmtpConfig = {
    enabled: Boolean(env.OPENKB_SMTP_HOST && env.OPENKB_SMTP_FROM),
    host: emptyToUndefined(env.OPENKB_SMTP_HOST),
    port: parsePositiveInt(env.OPENKB_SMTP_PORT),
    secure: parseBoolean(env.OPENKB_SMTP_SECURE, true),
    username: emptyToUndefined(env.OPENKB_SMTP_USER),
    password: emptyToUndefined(env.OPENKB_SMTP_PASSWORD),
    fromEmail: emptyToUndefined(env.OPENKB_SMTP_FROM),
    replyTo: emptyToUndefined(env.OPENKB_SMTP_REPLY_TO),
    source: "env",
    passwordLast4: env.OPENKB_SMTP_PASSWORD ? getModelSecretLast4(env.OPENKB_SMTP_PASSWORD) : null
  };

  return envConfig.enabled ? envConfig : { enabled: false, secure: true, source: "dev" };
}

export function encryptSmtpPassword(password: string | undefined | null): {
  encrypted: string | null;
  last4: string | null;
} {
  const normalized = password?.trim();
  if (!normalized) {
    return { encrypted: null, last4: null };
  }
  return {
    encrypted: encryptModelSecret(normalized),
    last4: getModelSecretLast4(normalized)
  };
}

export function assertValidSmtpConfig(config: SmtpConfig): void {
  if (!config.enabled) {
    throw new EmailConfigError("SMTP_NOT_CONFIGURED", "SMTP is not enabled.");
  }
  if (config.secretError) {
    throw new EmailConfigError("SMTP_SECRET_UNAVAILABLE", config.secretError);
  }
  if (!config.host || !config.fromEmail) {
    throw new EmailConfigError("SMTP_NOT_CONFIGURED", "SMTP host and from address are required.");
  }
  if (config.port !== undefined && (!Number.isInteger(config.port) || config.port <= 0)) {
    throw new EmailConfigError("INVALID_INPUT", "SMTP port must be a positive integer.");
  }
}

export async function sendEmail(
  config: SmtpConfig,
  message: EmailMessage,
  options: { timeoutMs?: number; transport?: SmtpTransport } = {}
): Promise<EmailSendResult> {
  try {
    assertValidSmtpConfig(config);
    assertValidEmailMessage(config, message);
    const transport = options.transport ?? new NodeSmtpTransport(options.timeoutMs);
    await transport.send(config, message);
    return { ok: true, source: config.source, message: "Email sent." };
  } catch (error) {
    return {
      ok: false,
      source: config.source,
      error: error instanceof Error ? error.message : "Email delivery failed."
    };
  }
}

export interface SmtpTransport {
  send(config: SmtpConfig, message: EmailMessage): Promise<void>;
}

class NodeSmtpTransport implements SmtpTransport {
  constructor(private readonly timeoutMs = DEFAULT_SMTP_TIMEOUT_MS) {}

  async send(config: SmtpConfig, message: EmailMessage): Promise<void> {
    const host = config.host;
    if (!host) {
      throw new EmailConfigError("SMTP_NOT_CONFIGURED", "SMTP host is required.");
    }
    const port = config.port ?? (config.secure ? 465 : 587);
    let socket: Socket | TLSSocket = config.secure
      ? tlsConnect({ host, port, servername: host })
      : new Socket().connect(port, host);
    socket.setTimeout(this.timeoutMs);

    const client = new SmtpConversation(socket);
    try {
      const from = parseMailboxAddress(config.fromEmail, "from address");
      const to = parseMailboxAddress(message.to, "recipient address");
      await client.expect(220);
      await client.command(`EHLO openkb.local`, 250);
      if (!config.secure) {
        await client.command("STARTTLS", 220);
        socket = tlsConnect({ socket, servername: host });
        client.replaceSocket(socket);
        await client.command(`EHLO openkb.local`, 250);
      }
      if (config.username && config.password) {
        await client.command(
          "AUTH PLAIN " +
            Buffer.from(`\0${config.username}\0${config.password}`).toString("base64"),
          235
        );
      }
      await client.command(`MAIL FROM:<${from.address}>`, 250);
      await client.command(`RCPT TO:<${to.address}>`, [250, 251]);
      await client.command("DATA", 354);
      await client.writeData(formatSmtpMessage(config, message));
      await client.expect(250);
      await client.command("QUIT", 221).catch(() => undefined);
    } finally {
      socket.destroy();
    }
  }
}

class SmtpConversation {
  private buffer = "";
  private waiters: Array<() => void> = [];

  constructor(private socket: Socket | TLSSocket) {
    this.bindSocket();
  }

  replaceSocket(socket: Socket | TLSSocket): void {
    this.socket = socket;
    this.buffer = "";
    this.bindSocket();
  }

  async command(command: string, expected: number | number[]): Promise<string> {
    this.socket.write(`${command}\r\n`);
    return this.expect(expected);
  }

  async writeData(data: string): Promise<void> {
    this.socket.write(`${data}\r\n.\r\n`);
  }

  async expect(expected: number | number[]): Promise<string> {
    const expectedCodes = Array.isArray(expected) ? expected : [expected];
    while (true) {
      const line = this.shiftResponse();
      if (line) {
        const code = Number(line.slice(0, 3));
        if (!expectedCodes.includes(code)) {
          throw new EmailConfigError(
            "SMTP_REQUEST_FAILED",
            `SMTP expected ${expectedCodes.join("/")}, got ${line}`
          );
        }
        return line;
      }
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => {
          cleanup();
          reject(error);
        };
        const onTimeout = () => {
          cleanup();
          reject(new EmailConfigError("SMTP_TIMEOUT", "SMTP request timed out."));
        };
        const cleanup = () => {
          this.socket.off("error", onError);
          this.socket.off("timeout", onTimeout);
          this.waiters = this.waiters.filter((waiter) => waiter !== resolve);
        };
        this.socket.once("error", onError);
        this.socket.once("timeout", onTimeout);
        this.waiters.push(resolve);
      });
    }
  }

  private bindSocket(): void {
    this.socket.on("data", (chunk) => {
      this.buffer += chunk.toString("utf8");
      for (const waiter of this.waiters.splice(0)) {
        waiter();
      }
    });
  }

  private shiftResponse(): string | null {
    const result = shiftSmtpResponse(this.buffer);
    this.buffer = result.buffer;
    return result.line;
  }
}

export function shiftSmtpResponse(buffer: string): { line: string | null; buffer: string } {
  const marker = "\r\n";
  let remaining = buffer;
  while (true) {
    const end = remaining.indexOf(marker);
    if (end === -1) {
      return { line: null, buffer: remaining };
    }
    const line = remaining.slice(0, end);
    remaining = remaining.slice(end + marker.length);
    if (/^\d{3}-/.test(line)) {
      continue;
    }
    return { line, buffer: remaining };
  }
}

export function formatSmtpMessage(config: SmtpConfig, message: EmailMessage): string {
  const from = parseMailboxAddress(config.fromEmail, "from address");
  const to = parseMailboxAddress(message.to, "recipient address");
  const replyTo = config.replyTo ? parseMailboxAddress(config.replyTo, "reply-to address") : null;
  const headers = [
    `From: ${from.header}`,
    `To: ${to.header}`,
    `Subject: ${sanitizeHeader(message.subject)}`,
    "MIME-Version: 1.0",
    message.html
      ? "Content-Type: text/html; charset=utf-8"
      : "Content-Type: text/plain; charset=utf-8"
  ];
  if (replyTo) {
    headers.push(`Reply-To: ${replyTo.header}`);
  }
  return `${headers.join("\r\n")}\r\n\r\n${normalizeSmtpData(message.html ?? message.text)}`;
}

function decryptOptionalSecret(
  encrypted: string | null | undefined,
  env: NodeJS.ProcessEnv
): { value?: string; error?: string } {
  if (!encrypted) {
    return {};
  }
  try {
    return { value: decryptModelSecret(encrypted, env.OPENKB_CONFIG_ENCRYPTION_KEY) };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "SMTP secret could not be decrypted."
    };
  }
}

function emptyToUndefined(value: string | null | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function parsePositiveInt(value: string | undefined): number | undefined {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function assertValidEmailMessage(config: SmtpConfig, message: EmailMessage): void {
  parseMailboxAddress(config.fromEmail, "from address");
  parseMailboxAddress(message.to, "recipient address");
  if (config.replyTo) {
    parseMailboxAddress(config.replyTo, "reply-to address");
  }
  sanitizeHeader(message.subject);
}

function parseMailboxAddress(
  value: string | undefined,
  fieldName: string
): { header: string; address: string } {
  const normalized = value?.trim();
  if (!normalized) {
    throw new EmailConfigError("INVALID_INPUT", `SMTP ${fieldName} is required.`);
  }
  assertNoHeaderBreaks(normalized, fieldName);
  const angleMatch = normalized.match(/^(.+?)<([^<>]+)>$/);
  const address = (angleMatch?.[2] ?? normalized).trim();
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(address)) {
    throw new EmailConfigError("INVALID_INPUT", `SMTP ${fieldName} is invalid.`);
  }
  return { header: sanitizeHeader(normalized), address };
}

function sanitizeHeader(value: string): string {
  assertNoHeaderBreaks(value, "header");
  return value.trim();
}

function assertNoHeaderBreaks(value: string, fieldName: string): void {
  if (/[\r\n]/.test(value)) {
    throw new EmailConfigError("INVALID_INPUT", `SMTP ${fieldName} must not contain line breaks.`);
  }
}

function normalizeSmtpData(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => (line.startsWith(".") ? `.${line}` : line))
    .join("\r\n");
}
