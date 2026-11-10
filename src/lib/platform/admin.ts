import { createClient } from "@/lib/supabase/server";

/**
 * Platform operators are independent from a customer's account role.
 * The allow-list is server-only and must never use a NEXT_PUBLIC_ prefix.
 */
export function isPlatformOperator(
  email: string | undefined | null,
  allowList = process.env.PLATFORM_ADMIN_EMAILS ?? "",
): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  return allowList
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
    .includes(normalized);
}

export class PlatformAccessError extends Error {
  constructor(
    message: string,
    public readonly status: 401 | 403 | 503,
  ) {
    super(message);
    this.name = "PlatformAccessError";
  }
}

export async function requirePlatformAdmin(): Promise<{ id: string; email: string }> {
  if (!process.env.PLATFORM_ADMIN_EMAILS?.trim()) {
    throw new PlatformAccessError("Platform administrators are not configured", 503);
  }

  const supabase = await createClient();
  // getUser validates the session with Supabase Auth. Do not trust getSession
  // or an email passed by the browser to authorize service-role operations.
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    throw new PlatformAccessError("Authentication required", 401);
  }
  if (!user.email_confirmed_at || !isPlatformOperator(user.email)) {
    throw new PlatformAccessError("Access denied", 403);
  }
  return { id: user.id, email: user.email! };
}
