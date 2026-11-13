/** Canonical activation origin, never derived from untrusted request headers. */
export function activationBaseUrl(): string {
  const url = new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "");
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash ||
      (url.protocol !== "https:" && !(local && url.protocol === "http:"))) {
    throw new Error("Configure a secure NEXT_PUBLIC_SITE_URL");
  }
  return url.origin;
}
