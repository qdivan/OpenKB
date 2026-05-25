import type { PublicRegistrationSettings } from "./openkb-api";

export function getRegistrationUnavailableMessageKey(
  settings: PublicRegistrationSettings | null
): string {
  if (!settings) {
    return "API service is unreachable. Please confirm the API server is running.";
  }
  if (!settings.registration_enabled) {
    return "Registration is disabled by the administrator.";
  }
  if (settings.invite_required) {
    return "Public registration is closed. Please use an invitation link.";
  }
  if (!settings.login_registration_enabled) {
    return "Public registration is not available from the login page.";
  }
  return "Public registration is not available from the login page.";
}
