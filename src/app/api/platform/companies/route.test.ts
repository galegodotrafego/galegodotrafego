import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ guard: vi.fn(), admin: vi.fn(), create: vi.fn(), remove: vi.fn(), limit: vi.fn() }));
vi.mock("@/lib/platform/admin", async (original) => ({
  ...await original<typeof import("@/lib/platform/admin")>(), requirePlatformAdmin: mocks.guard,
}));
vi.mock("@/lib/ai/admin-client", () => ({ supabaseAdmin: mocks.admin }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.limit, RATE_LIMITS: { adminAction: {} }, rateLimitResponse: () => Response.json({}, { status: 429 }) }));
vi.mock("@/lib/distributed-rate-limit", () => ({ checkDistributedRateLimit: mocks.limit }));
import { GET, POST } from "./route";
import { PlatformAccessError } from "@/lib/platform/admin";
const body = { company_name: "Company A", owner_name: "Owner A", owner_email: "client@example.com" };
function request(payload: unknown = body, headers: Record<string, string> = {}) {
  return new Request("https://crm.example/api/platform/companies", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(payload) });
}
let results: unknown[];
let queries: Array<{ table: string; calls: unknown[][] }>;
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("PLATFORM_ADMIN_EMAILS", "operator@example.com");
  mocks.guard.mockResolvedValue({ id: "operator", email: "operator@example.com" });
  mocks.limit.mockReturnValue({ success: true });
  mocks.create.mockResolvedValue({ data: { user: { id: "new-user" } }, error: null });
  mocks.remove.mockResolvedValue({ error: null });
  results = [
    { data: { id: "account-a" }, error: null },
    { data: { account_id: "account-a", account_role: "owner" }, error: null },
    { data: { id: "account-a" }, error: null },
  ];
  queries = [];
  mocks.admin.mockReturnValue({ auth: { admin: { createUser: mocks.create, deleteUser: mocks.remove } }, from(table: string) {
    const result = results.shift();
    const calls: unknown[][] = []; queries.push({ table, calls });
    const q: Record<string, unknown> = {};
    for (const method of ["select", "eq", "in", "order", "limit", "update", "delete", "single"]) {
      q[method] = (...args: unknown[]) => { calls.push([method, ...args]); return q; };
    }
    q.then = (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) =>
      result instanceof Error ? Promise.reject(result).then(resolve, reject) : Promise.resolve(result).then(resolve, reject);
    return q;
  } });
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
describe("platform companies", () => {
  it.each([401, 403, 503] as const)("denies GET and POST with %s before service-role access", async (status) => {
    mocks.guard.mockRejectedValue(new PlatformAccessError("denied", status));
    expect((await GET()).status).toBe(status);
    expect((await POST(request())).status).toBe(status);
    expect(mocks.admin).not.toHaveBeenCalled();
  });
  it("limits provisioning before any mutation", async () => {
    mocks.limit.mockReturnValue({ success: false });
    expect((await POST(request())).status).toBe(429);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it.each<Record<string, string>>([{ "Content-Type": "text/plain" }, { "sec-fetch-site": "cross-site" }])("rejects cross-site/form requests", async (headers) => {
    expect((await POST(request(body, headers))).status).toBe(403);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it.each([{}, null, { ...body, owner_email: "bad" }, { ...body, company_name: "x".repeat(81) }])("rejects invalid fields", async (payload) => {
    expect((await POST(request(payload))).status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("cannot provision a platform operator as a customer", async () => {
    expect((await POST(request({ ...body, owner_email: " OPERATOR@example.com " }))).status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("checks the owner profile and returns non-cacheable strong credentials", async () => {
    const response = await POST(request());
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const payload = await response.json();
    expect(payload.company.id).toBe("account-a");
    expect(payload.credentials.temporary_password).toMatch(/^Aa1![A-Za-z0-9_-]{32}$/);
    expect(queries[1].calls).toContainEqual(["eq", "user_id", "new-user"]);
    expect(queries[2].calls).toContainEqual(["eq", "owner_user_id", "new-user"]);
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it.each(["email_exists", "user_already_exists"])("maps %s to conflict without deleting existing data", async (code) => {
    mocks.create.mockResolvedValue({ data: { user: null }, error: { code, status: 422 } });
    expect((await POST(request())).status).toBe(409);
    expect(queries).toHaveLength(0);
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it("does not mislabel a password-policy rejection as a duplicate", async () => {
    mocks.create.mockResolvedValue({ data: { user: null }, error: { code: "weak_password", status: 422 } });
    expect((await POST(request())).status).toBe(502);
  });
  it.each([
    { data: null, error: null },
    { data: { account_id: "victim", account_role: "owner" }, error: null },
    { data: { account_id: "account-a", account_role: "agent" }, error: null },
  ])("rolls back missing or incorrectly linked profiles", async (profile) => {
    results = [results[0], profile, { error: null }];
    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("temporary_password");
    expect(queries[2].calls).toContainEqual(["eq", "owner_user_id", "new-user"]);
    expect(mocks.remove).toHaveBeenCalledWith("new-user");
  });
  it("compensates when the account read throws", async () => {
    results = [new Error("transport failure"), { error: null }];
    expect((await POST(request())).status).toBe(500);
    expect(mocks.remove).toHaveBeenCalledWith("new-user");
  });
  it("does not accept a rename that affected no rows", async () => {
    results[2] = { data: null, error: null }; results.push({ error: null });
    expect((await POST(request())).status).toBe(500);
    expect(mocks.remove).toHaveBeenCalledWith("new-user");
  });
  it("does not attempt Auth deletion if account cleanup fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    results = [new Error("read"), { error: { message: "sensitive provider detail" } }];
    expect((await POST(request())).status).toBe(500);
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(JSON.stringify(log.mock.calls)).not.toContain("sensitive");
  });
  it("lists owners without returning credentials", async () => {
    results = [{ data: [{ id: "a", name: "A", owner_user_id: "u", created_at: "2026-01-01" }], error: null }, { data: [{ user_id: "u", full_name: "Owner", email: "owner@example.com" }], error: null }];
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect((await response.json()).companies[0].owner_name).toBe("Owner");
    expect(queries[0].calls).toContainEqual(["limit", 100]);
  });
});
