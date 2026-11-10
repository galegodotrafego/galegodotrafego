import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/ai/admin-client";
import { PlatformAccessError, requirePlatformAdmin } from "@/lib/platform/admin";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

export const runtime = "nodejs";

function platformError(error: unknown): NextResponse {
  if (error instanceof PlatformAccessError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error("[platform/companies] unexpected error", error);
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

    const temporaryPassword = randomBytes(24).toString("base64url");
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
      const duplicate = createError?.status === 422 || createError?.status === 409;
      return NextResponse.json(
        { error: duplicate ? "Este e-mail já possui uma conta." : "Não foi possível criar o acesso." },
        { status: duplicate ? 409 : 502 },
      );
    }

    const newUserId = data.user.id;
    // The existing auth trigger should have inserted the personal account.
    const { data: account, error: accountError } = await admin
      .from("accounts")
      .select("id")
      .eq("owner_user_id", newUserId)
      .maybeSingle();

    let updated = false;
    if (!accountError && account) {
      const { error: renameError } = await admin
        .from("accounts")
        .update({ name: companyName })
        .eq("id", account.id);
      updated = !renameError;
      if (renameError) console.error("[platform/companies] rename failed", renameError);
    }

    if (!updated) {
      // Auth and database writes cannot be made in one transaction here.
      // Compensate so the operator can retry without a stranded login.
      if (account) {
        const { error: cleanupError } = await admin
          .from("accounts")
          .delete()
          .eq("id", account.id);
        if (cleanupError) console.error("[platform/companies] cleanup failed", cleanupError);
      }
      const { error: deleteUserError } = await admin.auth.admin.deleteUser(newUserId);
      if (deleteUserError) console.error("[platform/companies] auth rollback failed", deleteUserError);
      return NextResponse.json(
        { error: "Falha ao configurar a empresa. Verifique o cadastro antes de tentar novamente." },
        { status: 500 },
      );
    }

    return NextResponse.json({
      company: {
        id: account!.id,
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
