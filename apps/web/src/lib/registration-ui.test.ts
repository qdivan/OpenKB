import { describe, expect, it } from "vitest";

import type { PublicRegistrationSettings } from "./openkb-api";
import { getRegistrationUnavailableMessageKey } from "./registration-ui";

const baseSettings: PublicRegistrationSettings = {
  registration_enabled: true,
  login_registration_enabled: true,
  invite_required: false,
  allowed_email_domains_enabled: false,
  allowed_email_domains: [],
  registration_available: true
};

describe("registration UI helpers", () => {
  it("distinguishes backend registration shutdown from login-page registration visibility", () => {
    expect(
      getRegistrationUnavailableMessageKey({
        ...baseSettings,
        registration_enabled: false,
        login_registration_enabled: true,
        registration_available: false
      })
    ).toBe("Registration is disabled by the administrator.");
    expect(
      getRegistrationUnavailableMessageKey({
        ...baseSettings,
        login_registration_enabled: false,
        registration_available: false
      })
    ).toBe("Public registration is not available from the login page.");
  });

  it("keeps invite-only and unreachable states explicit", () => {
    expect(getRegistrationUnavailableMessageKey(null)).toBe(
      "API service is unreachable. Please confirm the API server is running."
    );
    expect(
      getRegistrationUnavailableMessageKey({
        ...baseSettings,
        invite_required: true,
        registration_available: false
      })
    ).toBe("Public registration is closed. Please use an invitation link.");
  });
});
