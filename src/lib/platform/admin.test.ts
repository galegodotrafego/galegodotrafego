import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getUser = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
}));

const {
  isPlatformOperator,
  PlatformAccessError,
  requirePlatformAdmin,
} = await import("./admin");

const originalAllowList = process.env.PLATFORM_ADMIN_EMAILS;

beforeEach(() => {
  getUser.mockReset();
});

afterEach(() => {
  if (originalAllowList === undefined) {
    delete process.env.PLATFORM_ADMIN_EMAILS;
  } else {
    process.env.PLATFORM_ADMIN_EMAILS = originalAllowList;
  }
});

describe("platform administrator guard", () => {
  it("matches email addresses case-insensitively but not partial matches", () => {
    expect(isPlatformOperator("Admin@Example.com", " other@site.com, admin@example.com ")).toBe(true);
    expect(isPlatformOperator("eviladmin@example.com", "admin@example.com")).toBe(false);
    expect(isPlatformOperator(null, "admin@example.com")).toBe(false);
    expect(isPlatformOperator("admin@example.com", "")).toBe(false);
  });

  it("rejects requests when the allow-list has not been configured", async () => {
    delete process.env.PLATFORM_ADMIN_EMAILS;
    await expect(requirePlatformAdmin()).rejects.toMatchObject({
      status: 503,
    } satisfies Partial<PlatformAccessError>);
    expect(getUser).not.toHaveBeenCalled();
  });

  it("rejects a request without an authenticated session", async () => {
    process.env.PLATFORM_ADMIN_EMAILS = "admin@example.com";
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    await expect(requirePlatformAdmin()).rejects.toMatchObject({
      status: 401,
    });
  });

  it("rejects an unconfirmed administrator email", async () => {
    process.env.PLATFORM_ADMIN_EMAILS = "admin@example.com";
    getUser.mockResolvedValue({
      data: { user: { id: "user-1", email: "admin@example.com", email_confirmed_at: null } },
      error: null,
    });
    await expect(requirePlatformAdmin()).rejects.toMatchObject({
      status: 403,
    });
  });

  it("rejects a customer owner not in the platform allow-list", async () => {
    process.env.PLATFORM_ADMIN_EMAILS = "admin@example.com";
    getUser.mockResolvedValue({
      data: { user: { id: "customer", email: "customer@example.com", email_confirmed_at: "2026-11-10" } },
      error: null,
    });
    await expect(requirePlatformAdmin()).rejects.toMatchObject({
      status: 403,
    });
  });

  it("permits only an authenticated, confirmed platform administrator", async () => {
    process.env.PLATFORM_ADMIN_EMAILS = "ADMIN@example.com";
    getUser.mockResolvedValue({
      data: { user: { id: "admin-1", email: "admin@example.com", email_confirmed_at: "2026-11-10" } },
      error: null,
    });
    await expect(requirePlatformAdmin()).resolves.toEqual({
      id: "admin-1",
      email: "admin@example.com",
    });
  });
});
