"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Building2, CheckCircle2, Copy, Plus, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Company = {
  id: string;
  name: string;
  owner_name: string;
  owner_email: string;
  created_at: string;
};

type Credentials = {
  email: string;
  temporary_password: string;
};

export default function PlatformCompaniesPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyName, setCompanyName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [allowed, setAllowed] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/platform/companies", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Falha ao carregar empresas.");
      setCompanies(payload.companies);
      setAllowed(true);
      setError(null);
    } catch (cause) {
      setAllowed(false);
      setError(cause instanceof Error ? cause.message : "Não foi possível carregar as empresas.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  async function registerCompany(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    // Never retain an older temporary password once provisioning is attempted.
    setCredentials(null);
    try {
      const response = await fetch("/api/platform/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_name: companyName,
          owner_name: ownerName,
          owner_email: ownerEmail,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Falha ao cadastrar empresa.");
      setCredentials(result.credentials);
      setCompanyName("");
      setOwnerName("");
      setOwnerEmail("");
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível criar o acesso.");
    } finally {
      setSaving(false);
    }
  }

  async function copyCredentials() {
    if (!credentials) return;
    await navigator.clipboard.writeText(
      `Acesso ao CRM\nEndereço: ${window.location.origin}/login\nE-mail: ${credentials.email}\nSenha provisória: ${credentials.temporary_password}\nAltere a senha após entrar no sistema.`,
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Building2 className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight">Empresas clientes</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Cadastre cada empresa após a contratação e entregue o acesso ao responsável.
          </p>
        </div>
        <Button variant="outline" onClick={() => void reload()} disabled={loading}>
          <RefreshCw className="mr-2 size-4" /> Atualizar
        </Button>
      </header>

      {error && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}

      {!loading && allowed && (
        <>
          <form onSubmit={registerCompany} className="space-y-4 rounded-xl border border-border bg-card p-5">
            <div className="flex items-center gap-2 font-semibold">
              <Plus className="size-4" /> Nova empresa
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="platform-company-name">Nome da empresa</Label>
                <Input id="platform-company-name" value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)} maxLength={80}
                  placeholder="Ex.: Ótica Central" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="platform-owner-name">Nome do responsável</Label>
                <Input id="platform-owner-name" value={ownerName}
                  onChange={(e) => setOwnerName(e.target.value)} maxLength={80} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="platform-owner-email">E-mail para login</Label>
                <Input id="platform-owner-email" type="email" value={ownerEmail}
                  onChange={(e) => setOwnerEmail(e.target.value)} maxLength={254} required />
              </div>
            </div>
            <Button type="submit" disabled={saving}>
              {saving ? "Criando acesso..." : "Cadastrar empresa e gerar acesso"}
            </Button>
          </form>

          {credentials && (
            <div className="space-y-3 rounded-xl border border-primary/40 bg-primary/5 p-5" role="status">
              <div className="flex items-center gap-2 font-semibold">
                <CheckCircle2 className="size-5 text-primary" /> Empresa cadastrada
              </div>
              <p className="text-sm">Copie os dados agora. A senha provisória não poderá ser consultada novamente.</p>
              <p className="break-all text-sm"><strong>Login:</strong> {credentials.email}</p>
              <p className="break-all text-sm"><strong>Senha provisória:</strong> <code>{credentials.temporary_password}</code></p>
              <Button variant="outline" type="button" onClick={() => void copyCredentials()}>
                <Copy className="mr-2 size-4" /> Copiar acesso
              </Button>
              <p className="text-xs text-muted-foreground">
                Envie por um canal seguro. Oriente o responsável a trocar a senha imediatamente.
              </p>
            </div>
          )}

          <section className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="border-b border-border p-4">
              <h2 className="font-semibold">Empresas cadastradas</h2>
              <p className="text-xs text-muted-foreground">Exibindo até 100 empresas recentes.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-left text-sm">
                <thead className="border-b border-border bg-muted/30 text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">Empresa</th>
                    <th className="px-4 py-3">Responsável</th>
                    <th className="px-4 py-3">E-mail</th>
                    <th className="px-4 py-3">Cadastro</th>
                  </tr>
                </thead>
                <tbody>
                  {companies.map((company) => (
                    <tr key={company.id} className="border-b border-border last:border-0">
                      <td className="px-4 py-3 font-medium">{company.name}</td>
                      <td className="px-4 py-3">{company.owner_name || "—"}</td>
                      <td className="px-4 py-3">{company.owner_email || "—"}</td>
                      <td className="px-4 py-3">{new Date(company.created_at).toLocaleDateString("pt-BR")}</td>
                    </tr>
                  ))}
                  {companies.length === 0 && (
                    <tr><td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">Nenhuma empresa cadastrada.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
      {loading && <p className="text-sm text-muted-foreground">Carregando empresas...</p>}
    </div>
  );
}
