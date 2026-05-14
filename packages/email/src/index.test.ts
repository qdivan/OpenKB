import { describe, expect, it } from "vitest";

import {
  assertValidSmtpConfig,
  formatSmtpMessage,
  getSmtpConfig,
  sendEmail,
  shiftSmtpResponse,
  type SmtpTransport
} from "./index";

describe("@openkb/email", () => {
  it("falls back to dev outbox when SMTP env and DB config are absent", () => {
    expect(getSmtpConfig({}).source).toBe("dev");
    expect(getSmtpConfig({}).enabled).toBe(false);
  });

  it("uses env SMTP config when present", () => {
    const config = getSmtpConfig({
      OPENKB_SMTP_HOST: "smtp.example.com",
      OPENKB_SMTP_FROM: "OpenKB <noreply@example.com>",
      OPENKB_SMTP_PORT: "587",
      OPENKB_SMTP_SECURE: "false",
      OPENKB_SMTP_PASSWORD: "secret-value"
    });

    expect(config).toMatchObject({
      source: "env",
      enabled: true,
      host: "smtp.example.com",
      port: 587,
      secure: false,
      passwordLast4: "alue"
    });
  });

  it("validates required SMTP fields", () => {
    expect(() => assertValidSmtpConfig({ source: "db", enabled: true, secure: true })).toThrow(
      /host and from address/
    );
  });

  it("sends through an injected transport without logging the secret", async () => {
    const transport: SmtpTransport = {
      async send(config, message) {
        expect(config.password).toBe("secret");
        expect(message.to).toBe("user@example.com");
      }
    };

    await expect(
      sendEmail(
        {
          source: "env",
          enabled: true,
          secure: true,
          host: "smtp.example.com",
          fromEmail: "noreply@example.com",
          password: "secret"
        },
        { to: "user@example.com", subject: "Test", text: "hello" },
        { transport }
      )
    ).resolves.toMatchObject({ ok: true, source: "env" });
  });

  it("rejects SMTP envelope addresses containing header breaks", async () => {
    const transport: SmtpTransport = {
      async send() {
        throw new Error("transport should not be called");
      }
    };

    await expect(
      sendEmail(
        {
          source: "env",
          enabled: true,
          secure: true,
          host: "smtp.example.com",
          fromEmail: "noreply@example.com"
        },
        { to: "user@example.com\r\nBCC: attacker@example.com", subject: "Test", text: "hello" },
        { transport }
      )
    ).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/line breaks/) });
  });

  it("dot-stuffs SMTP DATA lines", () => {
    const message = formatSmtpMessage(
      {
        source: "env",
        enabled: true,
        secure: true,
        host: "smtp.example.com",
        fromEmail: "OpenKB <noreply@example.com>"
      },
      {
        to: "user@example.com",
        subject: "Test",
        text: "first\n.secret\n..already"
      }
    );

    expect(message).toContain("\r\nfirst\r\n..secret\r\n...already");
  });

  it("consumes SMTP multiline responses already present in one socket buffer", () => {
    const response = shiftSmtpResponse(
      "250-smtp.aliyun.com\r\n250-PIPELINING\r\n250-AUTH PLAIN LOGIN\r\n250 AUTH=PLAIN LOGIN\r\n"
    );

    expect(response).toEqual({
      line: "250 AUTH=PLAIN LOGIN",
      buffer: ""
    });
  });

  it("keeps partial SMTP multiline responses for later socket data", () => {
    const partial = shiftSmtpResponse("250-smtp.aliyun.com\r\n250 AUTH");
    expect(partial).toEqual({
      line: null,
      buffer: "250 AUTH"
    });

    const complete = shiftSmtpResponse(`${partial.buffer} PLAIN LOGIN\r\n`);
    expect(complete).toEqual({
      line: "250 AUTH PLAIN LOGIN",
      buffer: ""
    });
  });
});
