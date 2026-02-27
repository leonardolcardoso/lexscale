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

  if (profileQuery.isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-300">
        Carregando perfil...
      </div>
    );
  }

  const user = profileQuery.data;
  const inputClass =
    "h-11 rounded-xl border-slate-700/70 bg-slate-950/55 text-slate-100 placeholder:text-slate-500 focus-visible:border-cyan-400/60 focus-visible:ring-cyan-400/50";
  const sectionClass = "rounded-2xl border border-slate-700/60 bg-slate-950/35 p-5 sm:p-6";
  const labelClass = "text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-300";

  return (
    <div className="profile-shell relative isolate min-h-screen overflow-hidden bg-[radial-gradient(circle_at_15%_10%,rgba(59,130,246,0.28),transparent_40%),radial-gradient(circle_at_85%_0%,rgba(20,184,166,0.2),transparent_35%),linear-gradient(180deg,#050b1d_0%,#040916_100%)] p-4 sm:p-6 md:p-10">
      <div className="pointer-events-none absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(148,163,184,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.08)_1px,transparent_1px)] [background-size:36px_36px] [mask-image:radial-gradient(circle_at_top,black_15%,transparent_72%)]" />
      <div className="pointer-events-none absolute -top-24 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-cyan-500/15 blur-[110px]" />

      <div className="relative mx-auto w-full max-w-5xl space-y-5">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <Link href="/" className="inline-flex items-center gap-2 text-slate-900 dark:text-white">
              <Scale className="h-5 w-5 text-cyan-300" />
              <span className="font-bold">LexScale</span>
            </Link>
            <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-cyan-300/75">PROFILE WORKSPACE</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="h-10 rounded-xl border-slate-700 bg-slate-900/45 text-slate-100 hover:bg-slate-800/85" onClick={goBack}>
              <ArrowLeft className="mr-1 h-4 w-4" />
              Voltar
            </Button>
            <Button
              variant="outline"
              className="h-10 rounded-xl border-slate-700 bg-slate-900/45 text-slate-100 hover:bg-slate-800/85"
              onClick={() => logoutMutation.mutate()}
              disabled={logoutMutation.isPending}
            >
              {logoutMutation.isPending ? "Saindo..." : "Sair"}
            </Button>
          </div>
        </header>

        <Card className="relative overflow-hidden border border-slate-700/70 bg-slate-900/78 text-slate-100 shadow-[0_32px_70px_rgba(2,6,23,0.58)] backdrop-blur-2xl">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300/55 to-transparent" />
          <CardHeader className="space-y-4 border-b border-slate-700/45 pb-5">
            <div className="inline-flex w-fit items-center gap-2 rounded-full border border-cyan-400/35 bg-cyan-400/10 px-3 py-1 text-xs font-medium text-cyan-200">
              <Bot className="h-3.5 w-3.5" />
              Painel Inteligente de Perfil
            </div>

            <div className="space-y-1.5">
              <CardTitle className="text-2xl font-semibold tracking-tight md:text-[30px]">Meu Perfil</CardTitle>
              <CardDescription className="max-w-2xl text-sm leading-relaxed text-slate-300">
                Atualize seus dados com uma interface limpa e orientada para produtividade jurídica com IA.
              </CardDescription>
            </div>

            <div className="grid gap-2 sm:grid-cols-3">
              <div className="flex items-center gap-2 rounded-xl border border-slate-700/60 bg-slate-950/45 px-3 py-2 text-xs text-slate-200">
                <Shield className="h-3.5 w-3.5 text-emerald-300" />
                Sessão protegida
              </div>
              <div className="flex items-center gap-2 rounded-xl border border-slate-700/60 bg-slate-950/45 px-3 py-2 text-xs text-slate-200">
                <Bot className="h-3.5 w-3.5 text-cyan-300" />
                Assistência ativa
              </div>
              <div className="truncate rounded-xl border border-slate-700/60 bg-slate-950/45 px-3 py-2 text-xs text-slate-300">
                Conta: {user?.email || "não informado"}
              </div>
            </div>
          </CardHeader>

          <CardContent className="space-y-6 pt-6">
            <section className={sectionClass}>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold tracking-wide text-slate-100">Identidade</h3>
                <span className="rounded-full border border-slate-700 bg-slate-900/65 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-300">Essencial</span>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="first_name" className={labelClass}>Nome</Label>
                  <Input id="first_name" value={form.first_name} onChange={(event) => setForm((prev) => ({ ...prev, first_name: event.target.value }))} className={inputClass} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="last_name" className={labelClass}>Sobrenome</Label>
                  <Input id="last_name" value={form.last_name} onChange={(event) => setForm((prev) => ({ ...prev, last_name: event.target.value }))} className={inputClass} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email" className={labelClass}>E-mail</Label>
                  <Input id="email" value={user?.email || ""} disabled className={`${inputClass} text-slate-400 disabled:opacity-100`} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phone" className={labelClass}>Telefone</Label>
                  <Input id="phone" value={form.phone} onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))} className={inputClass} />
                </div>
              </div>
            </section>

            <section className={sectionClass}>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold tracking-wide text-slate-100">Perfil Profissional</h3>
                <span className="rounded-full border border-cyan-400/35 bg-cyan-400/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-200">Equipe</span>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="company" className={labelClass}>Empresa</Label>
                  <Input id="company" value={form.company} onChange={(event) => setForm((prev) => ({ ...prev, company: event.target.value }))} className={inputClass} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="role" className={labelClass}>Cargo</Label>
                  <Input id="role" value={form.role} onChange={(event) => setForm((prev) => ({ ...prev, role: event.target.value }))} className={inputClass} />
                </div>
              </div>
            </section>

            <section className={sectionClass}>
              <h3 className="mb-2 text-sm font-semibold tracking-wide text-slate-100">Bio Estratégica</h3>
              <p className="mb-3 text-xs leading-relaxed text-slate-400">Descreva especialidades e objetivos para personalizar melhor análises e recomendações.</p>
              <Textarea
                id="bio"
                value={form.bio}
                onChange={(event) => setForm((prev) => ({ ...prev, bio: event.target.value }))}
                className="min-h-[140px] rounded-xl border-slate-700/70 bg-slate-950/55 text-slate-100 placeholder:text-slate-500 focus-visible:border-cyan-400/60 focus-visible:ring-cyan-400/50"
                placeholder="Descreva sua área de atuação, especialidades e objetivos."
              />
            </section>

            <div className="flex flex-wrap items-center justify-end gap-3">
              <p className="text-xs text-slate-400">Dados salvos com segurança no seu workspace.</p>
              <Button className="h-11 rounded-xl border border-blue-400/45 bg-blue-600 text-white shadow-[0_10px_28px_rgba(37,99,235,0.38)] hover:bg-blue-500" onClick={() => updateMutation.mutate()} disabled={updateMutation.isPending}>
                {updateMutation.isPending ? "Salvando..." : "Salvar Alterações"}
              </Button>
            </div>

            <section className={sectionClass}>
              <div className="mb-4 flex items-start gap-3">
                <div className="mt-0.5 rounded-xl border border-cyan-400/35 bg-cyan-500/10 p-2">
                  <Database className="h-4 w-4 text-cyan-200" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold tracking-wide text-slate-100">Integração com API pública</h3>
                  <p className="text-xs leading-relaxed text-slate-400">Opcional. Conecte uma fonte própria para sincronização de dados externos.</p>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="source_name" className={labelClass}>Nome da fonte</Label>
                  <Input
                    id="source_name"
                    value={sourceForm.name}
                    onChange={(event) => setSourceForm((prev) => ({ ...prev, name: event.target.value }))}
                    className={inputClass}
                  />
                </div>
                <div className="space-y-2">
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
                  className="h-10 rounded-xl border-slate-700 bg-slate-900/50 text-slate-100 hover:bg-slate-800"
                  onClick={() => sourceMutation.mutate()}
                  disabled={sourceMutation.isPending}
                >
                  {sourceMutation.isPending ? "Salvando..." : "Salvar Fonte"}
                </Button>
              </div>
            </section>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
