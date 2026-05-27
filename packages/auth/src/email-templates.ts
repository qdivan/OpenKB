export type AuthEmailPurpose = "email_verification" | "password_reset" | "account_setup";
export type AuthEmailLocale = "en" | "zh-CN";

export type RenderAuthEmailInput = {
  purpose: AuthEmailPurpose;
  linkUrl: string | null;
  locale?: string | null;
  subject?: string | null;
};

export type RenderedAuthEmail = {
  locale: AuthEmailLocale;
  subject: string;
  text: string;
  html: string;
};

type PurposeCopy = {
  subject: string;
  eyebrow: string;
  title: string;
  intro: string;
  instruction: string;
  button: string;
  fallback: string;
  ignore: string;
  expiry: string;
  footer: string;
};

const COPY: Record<AuthEmailLocale, Record<AuthEmailPurpose, PurposeCopy>> = {
  en: {
    email_verification: {
      subject: "Verify your OpenKB email",
      eyebrow: "Account security",
      title: "Verify your OpenKB email",
      intro:
        "You are receiving this message because an OpenKB account action was requested for this email address.",
      instruction: "Please open the following link to continue:",
      button: "Verify email",
      fallback: "If the button is unavailable, open this link:",
      ignore: "If you did not request this message, you can ignore it.",
      expiry: "This link may expire for security reasons.",
      footer: "OpenKB sends account emails only when an account action is requested."
    },
    account_setup: {
      subject: "Set up your OpenKB account",
      eyebrow: "Account setup",
      title: "Set up your OpenKB account",
      intro:
        "You are receiving this message because an OpenKB account action was requested for this email address.",
      instruction: "Please open the following link to continue:",
      button: "Set password",
      fallback: "If the button is unavailable, open this link:",
      ignore: "If you did not request this message, you can ignore it.",
      expiry: "This link may expire for security reasons.",
      footer: "OpenKB sends account emails only when an account action is requested."
    },
    password_reset: {
      subject: "Reset your OpenKB password",
      eyebrow: "Account recovery",
      title: "Reset your OpenKB password",
      intro:
        "You are receiving this message because an OpenKB account action was requested for this email address.",
      instruction: "Please open the following link to continue:",
      button: "Reset password",
      fallback: "If the button is unavailable, open this link:",
      ignore: "If you did not request this message, you can ignore it.",
      expiry: "This link may expire for security reasons.",
      footer: "OpenKB sends account emails only when an account action is requested."
    }
  },
  "zh-CN": {
    email_verification: {
      subject: "验证你的 OpenKB 邮箱",
      eyebrow: "账号安全",
      title: "验证你的 OpenKB 邮箱",
      intro: "你收到这封邮件，是因为有人为这个邮箱地址请求了一项 OpenKB 账号操作。",
      instruction: "请打开以下链接继续：",
      button: "验证邮箱",
      fallback: "如果按钮无法打开，请复制或打开以下链接：",
      ignore: "如果这不是你本人请求的操作，可以忽略这封邮件。",
      expiry: "出于安全原因，此链接可能会过期。",
      footer: "OpenKB 只会在有人请求账号操作时发送账号邮件。"
    },
    account_setup: {
      subject: "设置你的 OpenKB 账号",
      eyebrow: "账号设置",
      title: "设置你的 OpenKB 账号",
      intro: "你收到这封邮件，是因为有人为这个邮箱地址请求了一项 OpenKB 账号操作。",
      instruction: "请打开以下链接继续：",
      button: "设置密码",
      fallback: "如果按钮无法打开，请复制或打开以下链接：",
      ignore: "如果这不是你本人请求的操作，可以忽略这封邮件。",
      expiry: "出于安全原因，此链接可能会过期。",
      footer: "OpenKB 只会在有人请求账号操作时发送账号邮件。"
    },
    password_reset: {
      subject: "重置你的 OpenKB 密码",
      eyebrow: "账号恢复",
      title: "重置你的 OpenKB 密码",
      intro: "你收到这封邮件，是因为有人为这个邮箱地址请求了一项 OpenKB 账号操作。",
      instruction: "请打开以下链接继续：",
      button: "重置密码",
      fallback: "如果按钮无法打开，请复制或打开以下链接：",
      ignore: "如果这不是你本人请求的操作，可以忽略这封邮件。",
      expiry: "出于安全原因，此链接可能会过期。",
      footer: "OpenKB 只会在有人请求账号操作时发送账号邮件。"
    }
  }
};

export function normalizeAuthEmailLocale(locale: string | null | undefined): AuthEmailLocale {
  const normalized = locale?.trim().toLowerCase();
  return normalized?.startsWith("zh") ? "zh-CN" : "en";
}

export function renderAuthActionEmail(input: RenderAuthEmailInput): RenderedAuthEmail {
  const locale = normalizeAuthEmailLocale(input.locale);
  const copy = COPY[locale][input.purpose];
  const subject = input.subject?.trim() || copy.subject;
  return {
    locale,
    subject,
    text: renderAuthEmailText(copy, input.linkUrl),
    html: renderAuthEmailHtml(copy, input.linkUrl)
  };
}

function renderAuthEmailText(copy: PurposeCopy, linkUrl: string | null): string {
  const parts = [
    copy.title,
    "",
    copy.intro,
    "",
    copy.instruction,
    linkUrl ?? "",
    "",
    copy.ignore,
    copy.expiry
  ];
  return parts.join("\n").trim();
}

function renderAuthEmailHtml(copy: PurposeCopy, linkUrl: string | null): string {
  const safeTitle = escapeHtml(copy.title);
  const safeIntro = escapeHtml(copy.intro);
  const safeInstruction = escapeHtml(copy.instruction);
  const safeFallback = escapeHtml(copy.fallback);
  const safeIgnore = escapeHtml(copy.ignore);
  const safeExpiry = escapeHtml(copy.expiry);
  const safeFooter = escapeHtml(copy.footer);
  const safeEyebrow = escapeHtml(copy.eyebrow);
  const safeButton = escapeHtml(copy.button);
  const safeLink = linkUrl ? escapeHtml(linkUrl) : "";
  const button = linkUrl
    ? `<a href="${safeLink}" style="display:inline-block;border-radius:6px;background:#059669;color:#ffffff;font-family:Inter,Segoe UI,Arial,sans-serif;font-size:14px;font-weight:700;line-height:20px;padding:12px 18px;text-decoration:none;">${safeButton}</a>`
    : "";
  const fallback = linkUrl
    ? `<p style="margin:18px 0 0;color:#64748b;font-size:13px;line-height:20px;">${safeFallback}</p><p style="margin:6px 0 0;word-break:break-all;color:#0f766e;font-size:13px;line-height:20px;"><a href="${safeLink}" style="color:#0f766e;text-decoration:underline;">${safeLink}</a></p>`
    : "";

  return `<!doctype html>
<html>
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${safeTitle}</title>
  </head>
  <body style="margin:0;padding:0;background:#eef2f7;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${safeIntro}</div>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#eef2f7;border-collapse:collapse;margin:0;padding:0;">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;max-width:640px;overflow:hidden;border-radius:12px;background:#ffffff;box-shadow:0 18px 45px rgba(15,23,42,0.12);">
            <tr>
              <td style="background:#0f172a;background-image:linear-gradient(135deg,#0f172a 0%,#111827 58%,#064e3b 100%);padding:28px 32px;">
                <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;">
                  <tr>
                    <td style="vertical-align:middle;">
                      <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
                        <tr>
                          <td align="center" style="width:40px;height:40px;border-radius:10px;background:#059669;color:#ffffff;font-family:Inter,Segoe UI,Arial,sans-serif;font-size:15px;font-weight:800;letter-spacing:0;line-height:40px;">KB</td>
                          <td style="padding-left:12px;color:#ffffff;font-family:Inter,Segoe UI,Arial,sans-serif;font-size:18px;font-weight:800;letter-spacing:0;">OpenKB</td>
                        </tr>
                      </table>
                    </td>
                    <td align="right" style="vertical-align:middle;">
                      <span style="display:inline-block;border:1px solid rgba(255,255,255,0.24);border-radius:999px;color:#d1fae5;font-family:Inter,Segoe UI,Arial,sans-serif;font-size:12px;font-weight:700;line-height:18px;padding:5px 10px;">${safeEyebrow}</span>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:34px 32px 28px;">
                <h1 style="margin:0;color:#0f172a;font-family:Inter,Segoe UI,Arial,sans-serif;font-size:26px;font-weight:800;letter-spacing:0;line-height:34px;">${safeTitle}</h1>
                <p style="margin:18px 0 0;color:#334155;font-family:Inter,Segoe UI,Arial,sans-serif;font-size:15px;line-height:24px;">${safeIntro}</p>
                <p style="margin:18px 0 0;color:#334155;font-family:Inter,Segoe UI,Arial,sans-serif;font-size:15px;line-height:24px;">${safeInstruction}</p>
                <div style="margin:24px 0 0;">${button}</div>
                ${fallback}
                <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;margin-top:28px;border-top:1px solid #e2e8f0;">
                  <tr>
                    <td style="padding-top:18px;">
                      <p style="margin:0;color:#64748b;font-family:Inter,Segoe UI,Arial,sans-serif;font-size:13px;line-height:21px;">${safeIgnore}</p>
                      <p style="margin:6px 0 0;color:#64748b;font-family:Inter,Segoe UI,Arial,sans-serif;font-size:13px;line-height:21px;">${safeExpiry}</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
          <p style="max-width:640px;margin:16px auto 0;color:#94a3b8;font-family:Inter,Segoe UI,Arial,sans-serif;font-size:12px;line-height:18px;">${safeFooter}</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
