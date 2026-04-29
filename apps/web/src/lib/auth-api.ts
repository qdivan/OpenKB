export function authApiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:4000";
}

export function authApiUrl(path: string): string {
  return `${authApiBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}
