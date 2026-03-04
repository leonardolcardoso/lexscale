import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Bot, Database, Scale, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useBackNavigation } from "@/hooks/use-back-navigation";
import { fetchProfile, isUnauthorizedError, logout, updateProfile } from "@/lib/auth";
import { mapNetworkError, parseApiErrorResponse } from "@/lib/http-errors";
import { SiteFooter } from "@/components/site-footer";

type PublicDataOpsSourceItem = {
  name: string;
  enabled: boolean;
  last_status?: string | null;
  last_error?: string | null;
  last_sync_at?: string | null;
  minutes_since_last_sync?: number | null;
  is_stale: boolean;
};

type PublicDataOpsResponse = {
  generated_at: string;
  cases: {
    period_days: number;
    uploads_total: number;
    completed_total: number;
    processing_total: number;
    failed_total: number;
    completed_rate_pct: number;
    avg_total_processing_seconds?: number | null;
    avg_total_processing_seconds_with_sync?: number | null;
    avg_total_processing_seconds_without_sync?: number | null;
  };
  sync: {
    sync_on_case_processing_enabled: boolean;
    case_sync_min_freshness_minutes: number;
    uploads_with_case_sync: number;
    uploads_without_case_sync: number;
    case_sync_execution_rate_pct: number;
    avg_case_sync_elapsed_ms?: number | null;
    p95_case_sync_elapsed_ms?: number | null;
    sources_enabled_total: number;
    sources_last_success: number;
    sources_last_error: number;
    sources_stale: number;
  };
  ai_usage: {
    period_days: number;
    total_calls: number;
    total_tokens: number;
    total_cost_usd: number;
    chunk_summary_calls: number;
    responses_calls: number;
    embeddings_calls: number;
  };
  sources: PublicDataOpsSourceItem[];
};

function formatNumber(value?: number | null, fallback = "--"): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return new Intl.NumberFormat("pt-BR").format(value);
}

function formatSeconds(value?: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  if (value < 60) return `${value.toFixed(1)}s`;
  return `${(value / 60).toFixed(1)} min`;
}

function formatMilliseconds(value?: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(2)} s`;
}

function formatPercent(value?: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  return `${value.toFixed(1)}%`;
}

function formatCurrencyUsd(value?: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 4,
  }).format(value);
}

export default function ProfilePage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const goBack = useBackNavigation("/dashboard");
  const [form, setForm] = useState({
    first_name: "",
    last_name: "",
    company: "",
    role: "",
    phone: "",
    bio: "",
  });
  const [sourceForm, setSourceForm] = useState({
    name: "",
    base_url: "",
    tribunal: "",
  });

  const profileQuery = useQuery({
    queryKey: ["profile"],
    queryFn: fetchProfile,
    retry: false,
  });

  const publicDataOpsQuery = useQuery({
    queryKey: ["public-data-ops", 30],
    queryFn: async () => {
      try {
        const res = await fetch("/api/public-data/ops?days=30", { credentials: "include" });
        if (!res.ok) {
          throw await parseApiErrorResponse(res);
        }
        return (await res.json()) as PublicDataOpsResponse;
      } catch (error) {
        throw mapNetworkError(error, "Não foi possível carregar métricas operacionais agora.");
      }
    },
    retry: false,
    refetchInterval: 60_000,
  });

  const updateMutation = useMutation({
    mutationFn: () => updateProfile(form),
    onSuccess: (user) => {
      setForm({
        first_name: user.first_name || "",
        last_name: user.last_name || "",
        company: user.company || "",
        role: user.role || "",
        phone: user.phone || "",
        bio: user.bio || "",
      });
      toast({ title: "Perfil atualizado", description: "Informações salvas com sucesso." });
    },
    onError: (error) => {
      toast({
        title: "Falha ao atualizar perfil",
        description: error instanceof Error ? error.message : "Erro desconhecido",
      });
    },
  });

  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      setLocation("/auth?tab=login", { replace: true });
    },
    onError: (error) => {
      toast({
        title: "Falha ao sair",
        description: error instanceof Error ? error.message : "Erro desconhecido",
      });
    },
  });

  const sourceMutation = useMutation({
    mutationFn: async () => {
      if (!sourceForm.name.trim() || !sourceForm.base_url.trim()) {
        throw new Error("Informe nome e URL da fonte pública.");
      }

      try {
        const res = await fetch("/api/public-data/sources", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            name: sourceForm.name.trim(),
            base_url: sourceForm.base_url.trim(),
            tribunal: sourceForm.tribunal.trim() || null,
            headers: {},
            enabled: true,
          }),
        });

        if (!res.ok) {
          throw await parseApiErrorResponse(res);
        }

        return (await res.json()) as Record<string, unknown>;
      } catch (error) {
        throw mapNetworkError(error, "Não foi possível cadastrar a fonte pública agora.");
      }
    },
    onSuccess: () => {
      toast({
        title: "Fonte cadastrada",
        description: "Fonte pública cadastrada com sucesso.",
      });
      setSourceForm({ name: "", base_url: "", tribunal: "" });
    },
    onError: (error) => {
      toast({
        title: "Falha ao cadastrar fonte",
        description: error instanceof Error ? error.message : "Erro desconhecido",
      });
    },
  });

  useEffect(() => {
    if (!profileQuery.data) {
      return;
    }
    setForm({
      first_name: profileQuery.data.first_name || "",
      last_name: profileQuery.data.last_name || "",
      company: profileQuery.data.company || "",
      role: profileQuery.data.role || "",
      phone: profileQuery.data.phone || "",
      bio: profileQuery.data.bio || "",
    });
  }, [profileQuery.data]);

  useEffect(() => {
    if (!profileQuery.error) {
      return;
    }
    if (isUnauthorizedError(profileQuery.error)) {
      setLocation("/auth?tab=login", { replace: true });
      return;
    }
    toast({
      title: "Falha ao carregar perfil",
      description: profileQuery.error instanceof Error ? profileQuery.error.message : "Erro desconhecido",
    });
  }, [profileQuery.error, setLocation, toast]);

  useEffect(() => {
    if (!publicDataOpsQuery.error) {
      return;
    }
    if (isUnauthorizedError(publicDataOpsQuery.error)) {
      setLocation("/auth?tab=login", { replace: true });
      return;
    }
    toast({
      title: "Falha ao carregar observabilidade",
      description: publicDataOpsQuery.error instanceof Error ? publicDataOpsQuery.error.message : "Erro desconhecido",
    });
  }, [publicDataOpsQuery.error, setLocation, toast]);

  if (profileQuery.isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-700 dark:bg-slate-950 dark:text-slate-300">
        Carregando perfil...
      </div>
    );
  }

  const user = profileQuery.data;
  const inputClass =
    "h-11 rounded-xl border border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 focus-visible:border-cyan-500/60 focus-visible:ring-cyan-500/35 dark:border-slate-700/70 dark:bg-slate-950/55 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus-visible:border-cyan-400/60 dark:focus-visible:ring-cyan-400/50";
  const sectionClass = "rounded-2xl border border-slate-200 bg-white/80 p-5 sm:p-6 dark:border-slate-700/60 dark:bg-slate-950/35";
  const labelClass = "block min-h-[1.25rem] text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300";
  const fieldGroupClass = "flex min-w-0 flex-col gap-2.5";
  const ops = publicDataOpsQuery.data;

  return (
    <div className="profile-shell relative isolate flex min-h-screen flex-col overflow-hidden bg-[radial-gradient(circle_at_15%_10%,rgba(59,130,246,0.14),transparent_40%),radial-gradient(circle_at_85%_0%,rgba(20,184,166,0.1),transparent_35%),linear-gradient(180deg,#f8fbff_0%,#eef5ff_100%)] dark:bg-[radial-gradient(circle_at_15%_10%,rgba(59,130,246,0.28),transparent_40%),radial-gradient(circle_at_85%_0%,rgba(20,184,166,0.2),transparent_35%),linear-gradient(180deg,#050b1d_0%,#040916_100%)]">
      <div className="pointer-events-none absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(148,163,184,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.08)_1px,transparent_1px)] [background-size:36px_36px] [mask-image:radial-gradient(circle_at_top,black_15%,transparent_72%)]" />
      <div className="pointer-events-none absolute -top-24 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-cyan-500/15 blur-[110px]" />

      <div className="relative mx-auto w-full max-w-5xl flex-1 space-y-5 p-4 sm:p-6 md:p-10">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <Link href="/" className="inline-flex items-center gap-2 text-slate-900 dark:text-white">
              <Scale className="h-5 w-5 text-cyan-600 dark:text-cyan-300" />
              <span className="font-bold">LexScale</span>
            </Link>
            <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-cyan-700/75 dark:text-cyan-300/75">PROFILE WORKSPACE</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="h-10 rounded-xl border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900/45 dark:text-slate-100 dark:hover:bg-slate-800/85" onClick={goBack}>
              <ArrowLeft className="mr-1 h-4 w-4" />
              Voltar
            </Button>
            <Button
              variant="outline"
              className="h-10 rounded-xl border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900/45 dark:text-slate-100 dark:hover:bg-slate-800/85"
              onClick={() => logoutMutation.mutate()}
              disabled={logoutMutation.isPending}
            >
              {logoutMutation.isPending ? "Saindo..." : "Sair"}
            </Button>
          </div>
        </header>

        <Card className="relative overflow-hidden border border-slate-200 bg-white/92 text-slate-900 shadow-[0_24px_54px_rgba(15,23,42,0.12)] backdrop-blur-2xl dark:border-slate-700/70 dark:bg-slate-900/78 dark:text-slate-100 dark:shadow-[0_32px_70px_rgba(2,6,23,0.58)]">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300/55 to-transparent" />
          <CardHeader className="space-y-4 border-b border-slate-200 pb-5 dark:border-slate-700/45">
            <div className="inline-flex w-fit items-center gap-2 rounded-full border border-cyan-300 bg-cyan-50 px-3 py-1 text-xs font-medium text-cyan-800 dark:border-cyan-400/35 dark:bg-cyan-400/10 dark:text-cyan-200">
              <Bot className="h-3.5 w-3.5" />
              Painel Inteligente de Perfil
            </div>

            <div className="space-y-1.5">
              <CardTitle className="text-2xl font-semibold tracking-tight md:text-[30px]">Meu Perfil</CardTitle>
              <CardDescription className="max-w-2xl text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                Atualize seus dados com uma interface limpa e orientada para produtividade jurídica com IA.
              </CardDescription>
            </div>

            <div className="grid gap-2 sm:grid-cols-3">
              <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 dark:border-slate-700/60 dark:bg-slate-950/45 dark:text-slate-200">
                <Shield className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-300" />
                Sessão protegida
              </div>
              <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 dark:border-slate-700/60 dark:bg-slate-950/45 dark:text-slate-200">
                <Bot className="h-3.5 w-3.5 text-cyan-700 dark:text-cyan-300" />
                Assistência ativa
              </div>
              <div className="truncate rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-slate-700/60 dark:bg-slate-950/45 dark:text-slate-300">
                Conta: {user?.email || "não informado"}
              </div>
            </div>
          </CardHeader>

          <CardContent className="space-y-6 pt-6">
            <section className={sectionClass}>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold tracking-wide text-slate-800 dark:text-slate-100">Identidade</h3>
                <span className="rounded-full border border-slate-300 bg-white px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-600 dark:border-slate-700 dark:bg-slate-900/65 dark:text-slate-300">Essencial</span>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className={fieldGroupClass}>
                  <Label htmlFor="first_name" className={labelClass}>Nome</Label>
                  <Input id="first_name" value={form.first_name} onChange={(event) => setForm((prev) => ({ ...prev, first_name: event.target.value }))} className={inputClass} />
                </div>
                <div className={fieldGroupClass}>
                  <Label htmlFor="last_name" className={labelClass}>Sobrenome</Label>
                  <Input id="last_name" value={form.last_name} onChange={(event) => setForm((prev) => ({ ...prev, last_name: event.target.value }))} className={inputClass} />
                </div>
                <div className={fieldGroupClass}>
                  <Label htmlFor="email" className={labelClass}>E-mail</Label>
                  <Input id="email" value={user?.email || ""} disabled className={`${inputClass} text-slate-500 dark:text-slate-400 disabled:opacity-100`} />
                </div>
                <div className={fieldGroupClass}>
                  <Label htmlFor="phone" className={labelClass}>Telefone</Label>
                  <Input id="phone" value={form.phone} onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))} className={inputClass} />
                </div>
              </div>
            </section>

            <section className={sectionClass}>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold tracking-wide text-slate-800 dark:text-slate-100">Perfil Profissional</h3>
                <span className="rounded-full border border-cyan-300 bg-cyan-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-800 dark:border-cyan-400/35 dark:bg-cyan-400/10 dark:text-cyan-200">Equipe</span>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className={fieldGroupClass}>
                  <Label htmlFor="company" className={labelClass}>Empresa</Label>
                  <Input id="company" value={form.company} onChange={(event) => setForm((prev) => ({ ...prev, company: event.target.value }))} className={inputClass} />
                </div>
                <div className={fieldGroupClass}>
                  <Label htmlFor="role" className={labelClass}>Cargo</Label>
                  <Input id="role" value={form.role} onChange={(event) => setForm((prev) => ({ ...prev, role: event.target.value }))} className={inputClass} />
                </div>
              </div>
            </section>

            <section className={sectionClass}>
              <h3 className="mb-2 text-sm font-semibold tracking-wide text-slate-800 dark:text-slate-100">Bio Estratégica</h3>
              <p className="mb-3 text-xs leading-relaxed text-slate-500 dark:text-slate-400">Descreva especialidades e objetivos para personalizar melhor análises e recomendações.</p>
              <Textarea
                id="bio"
                value={form.bio}
                onChange={(event) => setForm((prev) => ({ ...prev, bio: event.target.value }))}
                className="min-h-[140px] rounded-xl border border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 focus-visible:border-cyan-500/60 focus-visible:ring-cyan-500/35 dark:border-slate-700/70 dark:bg-slate-950/55 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus-visible:border-cyan-400/60 dark:focus-visible:ring-cyan-400/50"
                placeholder="Descreva sua área de atuação, especialidades e objetivos."
              />
            </section>

            <div className="flex flex-wrap items-center justify-end gap-3">
              <p className="text-xs text-slate-500 dark:text-slate-400">Dados salvos com segurança no seu workspace.</p>
              <Button className="h-11 rounded-xl border border-blue-400/45 bg-blue-600 text-white shadow-[0_10px_28px_rgba(37,99,235,0.38)] hover:bg-blue-500" onClick={() => updateMutation.mutate()} disabled={updateMutation.isPending}>
                {updateMutation.isPending ? "Salvando..." : "Salvar Alterações"}
              </Button>
            </div>

            <section className={sectionClass}>
              <div className="mb-4 flex items-start gap-3">
                <div className="mt-0.5 rounded-xl border border-cyan-300 bg-cyan-50 p-2 dark:border-cyan-400/35 dark:bg-cyan-500/10">
                  <Database className="h-4 w-4 text-cyan-700 dark:text-cyan-200" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold tracking-wide text-slate-800 dark:text-slate-100">Integração com API pública</h3>
                  <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">Opcional. Conecte uma fonte própria para sincronização de dados externos.</p>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className={fieldGroupClass}>
                  <Label htmlFor="source_name" className={labelClass}>Nome da fonte</Label>
                  <Input
                    id="source_name"
                    value={sourceForm.name}
                    onChange={(event) => setSourceForm((prev) => ({ ...prev, name: event.target.value }))}
                    className={inputClass}
                  />
                </div>
                <div className={fieldGroupClass}>
                  <Label htmlFor="source_tribunal" className={labelClass}>Tribunal (opcional)</Label>
                  <Input
                    id="source_tribunal"
                    value={sourceForm.tribunal}
                    onChange={(event) => setSourceForm((prev) => ({ ...prev, tribunal: event.target.value }))}
                    className={inputClass}
                  />
                </div>
              </div>

              <div className="mt-4 space-y-2">
                <Label htmlFor="source_base_url" className={labelClass}>URL da API pública</Label>
                <Input
                  id="source_base_url"
                  value={sourceForm.base_url}
                  onChange={(event) => setSourceForm((prev) => ({ ...prev, base_url: event.target.value }))}
                  className={inputClass}
                  placeholder="https://..."
                />
              </div>

              <div className="mt-4 flex justify-end">
                <Button
                  variant="outline"
                  className="h-10 rounded-xl border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-100 dark:hover:bg-slate-800"
                  onClick={() => sourceMutation.mutate()}
                  disabled={sourceMutation.isPending}
                >
                  {sourceMutation.isPending ? "Salvando..." : "Salvar Fonte"}
                </Button>
              </div>
            </section>

            <section className={sectionClass}>
              <div className="mb-4 flex items-start gap-3">
                <div className="mt-0.5 rounded-xl border border-emerald-300 bg-emerald-50 p-2 dark:border-emerald-400/35 dark:bg-emerald-500/10">
                  <Bot className="h-4 w-4 text-emerald-700 dark:text-emerald-200" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold tracking-wide text-slate-800 dark:text-slate-100">Observabilidade IA + APIs externas</h3>
                  <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">Métricas de execução real dos uploads, sincronização externa e consumo da IA.</p>
                </div>
              </div>

              {publicDataOpsQuery.isLoading ? (
                <p className="text-xs text-slate-500 dark:text-slate-400">Carregando métricas operacionais...</p>
              ) : ops ? (
                <div className="space-y-4">
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700/60 dark:bg-slate-900/45">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Uploads (30d)</p>
                      <p className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-100">{formatNumber(ops.cases.uploads_total)}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">Concluídos: {formatPercent(ops.cases.completed_rate_pct)}</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700/60 dark:bg-slate-900/45">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Tempo médio total</p>
                      <p className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-100">{formatSeconds(ops.cases.avg_total_processing_seconds)}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">Com sync: {formatSeconds(ops.cases.avg_total_processing_seconds_with_sync)}</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700/60 dark:bg-slate-900/45">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Sync por upload</p>
                      <p className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-100">{formatPercent(ops.sync.case_sync_execution_rate_pct)}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">p95: {formatMilliseconds(ops.sync.p95_case_sync_elapsed_ms)}</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700/60 dark:bg-slate-900/45">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Uso de IA (30d)</p>
                      <p className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-100">{formatNumber(ops.ai_usage.total_calls)} chamadas</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">{formatNumber(ops.ai_usage.total_tokens)} tokens • {formatCurrencyUsd(ops.ai_usage.total_cost_usd)}</p>
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700/60 dark:bg-slate-900/45">
                      <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">Saúde das fontes</p>
                      <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                        Ativas: {formatNumber(ops.sync.sources_enabled_total)} • Último sucesso: {formatNumber(ops.sync.sources_last_success)} • Com erro: {formatNumber(ops.sync.sources_last_error)} • Stale: {formatNumber(ops.sync.sources_stale)}
                      </p>
                      <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                        Sync no upload: {ops.sync.sync_on_case_processing_enabled ? "habilitado" : "desabilitado"} (freshness mínima: {formatNumber(ops.sync.case_sync_min_freshness_minutes, "0")} min)
                      </p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700/60 dark:bg-slate-900/45">
                      <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">Distribuição de chamadas IA</p>
                      <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                        Respostas: {formatNumber(ops.ai_usage.responses_calls)} • Embeddings: {formatNumber(ops.ai_usage.embeddings_calls)} • Chunk summary: {formatNumber(ops.ai_usage.chunk_summary_calls)}
                      </p>
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700/60 dark:bg-slate-900/45">
                    <p className="mb-2 text-xs font-semibold text-slate-700 dark:text-slate-200">Status por fonte</p>
                    <div className="space-y-2">
                      {ops.sources.length === 0 ? (
                        <p className="text-xs text-slate-500 dark:text-slate-400">Nenhuma fonte cadastrada.</p>
                      ) : (
                        ops.sources.slice(0, 8).map((source) => (
                          <div key={source.name} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950/35">
                            <div className="min-w-0">
                              <p className="truncate font-medium text-slate-800 dark:text-slate-100">{source.name}</p>
                              <p className="truncate text-slate-500 dark:text-slate-400">
                                {source.enabled ? "Ativa" : "Inativa"} • Último status: {source.last_status || "n/a"} • Último sync: {source.minutes_since_last_sync != null ? `${formatNumber(source.minutes_since_last_sync)} min atrás` : "nunca"}
                              </p>
                            </div>
                            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${source.is_stale ? "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-400/40 dark:bg-amber-500/10 dark:text-amber-200" : "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-400/40 dark:bg-emerald-500/10 dark:text-emerald-200"}`}>
                              {source.is_stale ? "Stale" : "OK"}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-slate-500 dark:text-slate-400">Métricas operacionais indisponíveis no momento.</p>
              )}
            </section>
          </CardContent>
        </Card>
      </div>
      <div className="relative z-10">
        <SiteFooter />
      </div>
    </div>
  );
}
