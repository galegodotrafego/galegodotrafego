import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/ai/admin-client";
import { isPlatformOperator, PlatformAccessError, requirePlatformAdmin } from "@/lib/platform/admin";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

export const runtime = "nodejs";

function platformError(error: unknown): NextResponse {
  if (error instanceof PlatformAccessError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error("[platform/companies] unexpected error");
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

/**
 * List tenants for the platform operator. This is deliberately NOT available
 * to a customer's "owner" role, which only grants access to their own tenant.
 */
export async function GET() {
  try {
    await requirePlatformAdmin();
    const admin = supabaseAdmin();
    const { data: accounts, error } = await admin
      .from("accounts")
      .select("id, name, owner_user_id, created_at")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw error;

    const ownerIds = (accounts ?? []).map((account) => account.owner_user_id as string);
    const { data: profiles, error: profileError } = ownerIds.length
      ? await admin
          .from("profiles")
          .select("user_id, full_name, email")
          .in("user_id", ownerIds)
      : { data: [], error: null };
    if (profileError) throw profileError;

    const owners = new Map((profiles ?? []).map((profile) => [profile.user_id, profile]));
    return NextResponse.json({
      companies: (accounts ?? []).map((account) => ({
        id: account.id,
        name: account.name,
        created_at: account.created_at,
        owner_name: owners.get(account.owner_user_id)?.full_name ?? "",
        owner_email: owners.get(account.owner_user_id)?.email ?? "",
      })),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return platformError(error);
  }
}

/**
 * Provision one company after a sale:
 * 1. Supabase Auth creates the owner (random initial password).
 * 2. Existing handle_new_user trigger creates the owner profile + isolated account.
 * 3. We name that account after the contracted company.
 *
 * The temporary password is returned ONCE to the platform operator and
 * is never saved in application tables, logs, or source control.
 */
export async function POST(request: Request) {
  try {
    const operator = await requirePlatformAdmin();
    // JSON-only requests cannot be sent by a cross-site HTML form.
    if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json" ||
        request.headers.get("sec-fetch-site") === "cross-site") {
      return NextResponse.json({ error: "Invalid request origin or content type" }, { status: 403 });
    }
    const limit = checkRateLimit(
      `platform:provision:${operator.id}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const payload = await request.json().catch(() => null);
    const companyName = typeof payload?.company_name === "string"
      ? payload.company_name.trim()
      : "";
    const ownerName = typeof payload?.owner_name === "string"
      ? payload.owner_name.trim()
      : "";
    const ownerEmail = typeof payload?.owner_email === "string"
      ? payload.owner_email.trim().toLowerCase()
      : "";

    if (!companyName || companyName.length > 80 ||
        !ownerName || ownerName.length > 80 ||
        ownerEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) {
      return NextResponse.json(
        { error: "Informe empresa, responsável e e-mail válidos (nomes até 80 caracteres)." },
        { status: 400 },
      );
    }

    // Never auto-confirm an address that grants platform-wide privileges.
    if (isPlatformOperator(ownerEmail)) {
      return NextResponse.json({ error: "Este e-mail é reservado à administração da plataforma." }, { status: 400 });
    }

    // Fixed classes satisfy common Supabase password-complexity settings;
    // the random portion still provides 192 bits of entropy.
    const temporaryPassword = `Aa1!${randomBytes(24).toString("base64url")}`;
    const admin = supabaseAdmin();
    const { data, error: createError } = await admin.auth.admin.createUser({
      email: ownerEmail,
      password: temporaryPassword,
      email_confirm: true,
      user_metadata: { full_name: ownerName },
    });

    if (createError || !data.user) {
      // Supabase commonly returns 422 for an existing email. Do not reveal
      // internal provider details or echo credentials in the error.
      const duplicate = createError?.code === "email_exists" || createError?.code === "user_already_exists";
      return NextResponse.json(
        { error: duplicate ? "Este e-mail já possui uma conta." : "Não foi possível criar o acesso." },
        { status: duplicate ? 409 : 502 },
      );
    }

    const newUserId = data.user.id;
    let accountId: string | null = null;
    try {
      const { data: account, error: accountError } = await admin
        .from("accounts").select("id").eq("owner_user_id", newUserId).single();
      if (accountError || !account) throw new Error("Account bootstrap failed");
      accountId = account.id;

      const { data: profile, error: profileError } = await admin
        .from("profiles").select("account_id, account_role")
        .eq("user_id", newUserId).single();
      if (profileError || profile?.account_id !== accountId || profile?.account_role !== "owner") {
        throw new Error("Owner profile bootstrap failed");
      }

      const { data: renamed, error: renameError } = await admin
        .from("accounts").update({ name: companyName })
        .eq("id", accountId).eq("owner_user_id", newUserId).select("id").single();
      if (renameError || !renamed) throw new Error("Account rename failed");
    } catch {
      // Restrict compensation to this newly-created owner's accounts, even
      // when the first read failed. Never delete an existing customer's user.
      // Account deletion must precede Auth deletion (owner FK is RESTRICT).
      try {
        const { error: cleanupError } = await admin.from("accounts")
          .delete().eq("owner_user_id", newUserId);
        if (cleanupError) throw new Error("Account cleanup failed");
        const { error: deleteUserError } = await admin.auth.admin.deleteUser(newUserId);
        if (deleteUserError) throw new Error("Auth cleanup failed");
      } catch {
        // Log only a correlation ID, never provider objects/credentials.
        console.error("[platform/companies] rollback requires manual review", { userId: newUserId });
      }
      return NextResponse.json(
        { error: "Falha ao configurar a empresa. Verifique o cadastro antes de tentar novamente." },
        { status: 500, headers: { "Cache-Control": "no-store" } },
      );
    }

    return NextResponse.json({
      company: {
        id: accountId,
        name: companyName,
        owner_name: ownerName,
        owner_email: ownerEmail,
      },
      credentials: { email: ownerEmail, temporary_password: temporaryPassword },
    }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return platformError(error);
  }
}
