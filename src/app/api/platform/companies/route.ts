import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/ai/admin-client";
import { isPlatformOperator, PlatformAccessError, requirePlatformAdmin } from "@/lib/platform/admin";
import { rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

import { checkDistributedRateLimit } from "@/lib/distributed-rate-limit";
import { activationBaseUrl } from "@/lib/platform/activation";

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
 * A service-only reservation makes Auth + account bootstrap retry-safe.
 * No initial password is disclosed; the operator delivers a recovery link.
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
    const limit = await checkDistributedRateLimit(
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

    const requestId = request.headers.get("idempotency-key") ?? "";
    const planId = typeof payload?.plan_id === "string" ? payload.plan_id : "";
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuid.test(requestId) || !uuid.test(planId)) {
      return NextResponse.json({ error: "Informe um plano válido e Idempotency-Key UUID." }, { status: 400 });
    }
    const baseUrl = activationBaseUrl(); // Fail before mutations if redirect config is unsafe.
    const admin = supabaseAdmin();
    const hash = createHash("sha256").update(JSON.stringify([companyName, ownerName, ownerEmail, planId])).digest("hex");
    const { data: reserved, error: reserveError } = await admin.rpc("reserve_company_provisioning", {
      p_id: requestId, p_hash: hash, p_company: companyName, p_name: ownerName,
      p_email: ownerEmail, p_plan: planId, p_actor: operator.id,
    });
    if (reserveError || !reserved) {
      return NextResponse.json({ error: "Não foi possível reservar o cadastro. Confira o e-mail e a chave da tentativa." }, { status: reserveError?.code === "23505" ? 409 : 502 });
    }
    let entry = reserved;
    const replayed = Boolean(entry.user_id);
    if (!entry.user_id) {
      const { error: createError } = await admin.auth.admin.createUser({
        email: ownerEmail,
        password: `Aa1!${randomBytes(24).toString("base64url")}`,
        email_confirm: true,
        app_metadata: { provisioning_request_id: requestId },
        user_metadata: { full_name: ownerName },
      });
      // Read the ledger even on a transport/duplicate error: Auth may have
      // committed before its response was lost. Never delete a resumed user.
      const { data: persisted, error: readError } = await admin.from("company_provisioning_requests")
        .select("user_id,account_id,completed_at").eq("id", requestId).single();
      if (readError || !persisted?.user_id || !persisted.account_id) {
        const duplicate = createError?.code === "email_exists" || createError?.code === "user_already_exists";
        return NextResponse.json({ error: "Cadastro não concluído. Repita com a mesma chave da tentativa." }, { status: duplicate ? 409 : 502 });
      }
      entry = persisted;
    }
    // Service-only billing RPC is independently idempotent. A failure leaves
    // the account unentitled and the reservation resumable; never a second tenant.
    const { error: billingError } = await admin.rpc("billing_start_subscription", {
      p_account: entry.account_id, p_plan: planId, p_key: `provision:${requestId}`, p_actor: operator.id,
    });
    if (billingError) {
      return NextResponse.json({ error: "Empresa reservada; assinatura pendente. Repita com a mesma chave." }, { status: 502 });
    }
    const { data: profile, error: profileError } = await admin.from("profiles")
      .select("account_id,account_role").eq("user_id",entry.user_id).single();
    if (profileError || profile?.account_id !== entry.account_id || profile.account_role !== "owner") throw new Error("Invalid owner bootstrap");
    const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: "recovery", email: ownerEmail });
    if (linkError || !link.properties?.hashed_token) {
      return NextResponse.json({ error: "Empresa criada; não foi possível emitir a ativação. Repita com a mesma chave." }, { status: 502 });
    }
    const { error: completeError } = await admin.from("company_provisioning_requests")
      .update({ completed_at: new Date().toISOString() }).eq("id",requestId);
    if (completeError) throw new Error("Provisioning completion failed");
    return NextResponse.json({
      company: { id: entry.account_id, name: companyName, owner_name: ownerName, owner_email: ownerEmail },
      activation_url: `${baseUrl}/activate#token_hash=${encodeURIComponent(link.properties.hashed_token)}`,
      replayed,
    }, { status: replayed ? 200 : 201, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) {
    return platformError(error);
  }
}
