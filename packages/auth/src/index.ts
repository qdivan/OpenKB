export * from "./service";
export * from "./email-templates";

export const AUTH_PACKAGE_NAME = "@openkb/auth";

export type AuthUserStatus =
  | "pending_email_verification"
  | "pending_activation"
  | "active"
  | "suspended"
  | "deleted";

export type AuthPackageStatus = {
  packageName: typeof AUTH_PACKAGE_NAME;
  implementsLogin: true;
};

export const authPackageStatus: AuthPackageStatus = {
  packageName: AUTH_PACKAGE_NAME,
  implementsLogin: true
};
