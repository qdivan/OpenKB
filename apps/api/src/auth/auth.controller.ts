import { Body, Controller, Get, Inject, Post, Req, Res } from "@nestjs/common";
import { AuthService, getCookieValue } from "@openkb/auth";
import type { FastifyReply, FastifyRequest } from "fastify";

import { sendJsonError, setCookie } from "./http";

type RegisterBody = {
  email?: string;
  password?: string;
  display_name?: string;
  locale?: string;
};

type TokenBody = {
  token?: string;
};

type LoginBody = {
  email?: string;
  password?: string;
};

type EmailBody = {
  email?: string;
};

@Controller("api/auth")
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Get("registration-settings")
  async getPublicRegistrationSettings(@Res({ passthrough: true }) reply: FastifyReply) {
    try {
      return await this.auth.getPublicRegistrationSettings();
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Post("register")
  async register(
    @Body() body: RegisterBody,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Req() request?: FastifyRequest
  ) {
    try {
      const result = await this.auth.register({
        email: body.email ?? "",
        password: body.password ?? "",
        displayName: body.display_name,
        locale: body.locale ?? readPreferredLocale(request)
      });

      return {
        user: result.user,
        status: result.status,
        requires_email_verification: result.requiresEmailVerification
      };
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Post("verify-email")
  async verifyEmail(@Body() body: TokenBody, @Res({ passthrough: true }) reply: FastifyReply) {
    try {
      return await this.auth.verifyEmail(body.token ?? "");
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Post("login")
  async login(@Body() body: LoginBody, @Res({ passthrough: true }) reply: FastifyReply) {
    try {
      const result = await this.auth.login({
        email: body.email ?? "",
        password: body.password ?? ""
      });
      setCookie(reply, this.auth.createCookie(result.sessionToken, result.expiresAt));
      return result.me;
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Post("logout")
  async logout(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    try {
      await this.auth.logout(this.getSessionToken(request));
      setCookie(reply, this.auth.clearCookie());
      return { ok: true };
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Get("me")
  async me(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    try {
      return await this.auth.getMe(this.getSessionToken(request));
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Post("password-reset/request")
  async requestPasswordReset(
    @Body() body: EmailBody,
    @Res({ passthrough: true }) reply: FastifyReply
  ) {
    try {
      return await this.auth.requestPasswordReset(body.email ?? "");
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  @Post("password-reset/confirm")
  async confirmPasswordReset(
    @Body() body: LoginBody & TokenBody,
    @Res({ passthrough: true }) reply: FastifyReply
  ) {
    try {
      return await this.auth.confirmPasswordReset({
        token: body.token ?? "",
        password: body.password ?? ""
      });
    } catch (error) {
      return sendJsonError(error, reply);
    }
  }

  private getSessionToken(request: FastifyRequest): string | null {
    return getCookieValue(request.headers.cookie, this.auth.cookieName());
  }
}

function readPreferredLocale(request: FastifyRequest | undefined): string | undefined {
  const header = request?.headers["accept-language"];
  return Array.isArray(header) ? header[0] : header;
}
