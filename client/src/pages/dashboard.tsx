import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import {
  Scale,
  LayoutDashboard,
  BrainCircuit,
  ActivitySquare,
  BellRing,
  Filter,
  Search,
  AlertTriangle,
  Trophy,
  Shield,
  CheckSquare,
  Zap,
  Clock,
  TrendingUp,
  Database,
  FileText,
  BarChart3,
  MoreHorizontal,
  Eye,
  Upload,
  RefreshCcw,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, Radar, BarChart, Bar, XAxis, CartesianGrid, Tooltip } from "recharts";
import { useToast } from "@/hooks/use-toast";
import type { DashboardData, DashboardFilters, UploadCaseResponse } from "@/types/dashboard";

const DEFAULT_FILTERS: DashboardFilters = {
  tribunal: "Todos os Tribunais",
  juiz: "Todos os Juizes",
  tipo_acao: "Todos os Tipos",
  faixa_valor: "Todos os Valores",
  periodo: "Ultimos 6 meses",
};

const FILTER_OPTIONS = {
  tribunal: ["Todos os Tribunais", "TJSP", "TJRJ", "TJDFT", "TRF5", "TRT2", "TRF3", "STJ"],
  juiz: ["Todos os Juizes", "Dr. Joao Silva", "Dra. Maria Santos", "Dr. Pedro Oliveira"],
  tipo_acao: ["Todos os Tipos", "Trabalhista", "Civel", "Tributario", "Comercial", "Familia"],
  faixa_valor: ["Todos os Valores", "0-100k", "100k-500k", ">500k"],
  periodo: ["Ultimos 3 meses", "Ultimos 6 meses", "Ultimos 12 meses"],
};

const PANEL_CLASS = "rounded-2xl border border-slate-800/90 bg-slate-900/70 backdrop-blur-xl shadow-[0_18px_40px_rgba(2,6,23,0.45)]";
const PANEL_SOFT_CLASS = "rounded-2xl border border-slate-800/80 bg-slate-900/45 backdrop-blur-xl shadow-[0_14px_30px_rgba(2,6,23,0.35)]";

function buildDashboardUrl(filters: DashboardFilters) {
  const params = new URLSearchParams();
  params.set("tribunal", filters.tribunal);
  params.set("juiz", filters.juiz);
  params.set("tipo_acao", filters.tipo_acao);
  params.set("faixa_valor", filters.faixa_valor);
  params.set("periodo", filters.periodo);
  return `/api/dashboard?${params.toString()}`;
}

async function fetchDashboard(filters: DashboardFilters): Promise<DashboardData> {
  const res = await fetch(buildDashboardUrl(filters), { credentials: "include" });
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
  return await res.json();
}

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState("visao-geral");
  const [isFiltering, setIsFiltering] = useState(false);
  const [draftFilters, setDraftFilters] = useState<DashboardFilters>(DEFAULT_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<DashboardFilters>(DEFAULT_FILTERS);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadForm, setUploadForm] = useState({
    process_number: "",
    tribunal: "",
    judge: "",
    action_type: "",
    claim_value: "",
  });
  const [sourceForm, setSourceForm] = useState({
    name: "",
    base_url: "",
    tribunal: "",
  });
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [dismissedAlerts, setDismissedAlerts] = useState<string[]>([]);

  const dashboardQuery = useQuery({
    queryKey: ["dashboard-data", appliedFilters],
    queryFn: () => fetchDashboard(appliedFilters),
  });

  const uploadMutation = useMutation({
    mutationFn: async (): Promise<UploadCaseResponse> => {
      if (!uploadFile) {
        throw new Error("Selecione um arquivo para upload.");
      }
      const formData = new FormData();
      formData.append("file", uploadFile);
      if (uploadForm.process_number.trim()) formData.append("process_number", uploadForm.process_number.trim());
      if (uploadForm.tribunal.trim()) formData.append("tribunal", uploadForm.tribunal.trim());
      if (uploadForm.judge.trim()) formData.append("judge", uploadForm.judge.trim());
      if (uploadForm.action_type.trim()) formData.append("action_type", uploadForm.action_type.trim());
      if (uploadForm.claim_value.trim()) formData.append("claim_value", uploadForm.claim_value.trim());

      const res = await fetch("/api/cases/upload", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) {
        const text = (await res.text()) || res.statusText;
        throw new Error(`${res.status}: ${text}`);
      }
      return await res.json();
    },
    onSuccess: (payload) => {
      toast({
        title: "Processo enviado",
        description: `Processo ${payload.process_number} processado com sucesso.`,
      });
      setUploadFile(null);
      setUploadForm({ process_number: "", tribunal: "", judge: "", action_type: "", claim_value: "" });
      queryClient.invalidateQueries({ queryKey: ["dashboard-data"] });
    },
    onError: (error) => {
      toast({
        title: "Falha no upload",
        description: error instanceof Error ? error.message : "Erro desconhecido",
      });
    },
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/public-data/sync", {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const text = (await res.text()) || res.statusText;
        throw new Error(`${res.status}: ${text}`);
      }
      return await res.json();
    },
    onSuccess: () => {
      toast({
        title: "Bases publicas sincronizadas",
        description: "Dados publicos atualizados no banco com sucesso.",
      });
      queryClient.invalidateQueries({ queryKey: ["dashboard-data"] });
    },
    onError: (error) => {
      toast({
        title: "Falha na sincronizacao",
        description: error instanceof Error ? error.message : "Erro desconhecido",
      });
    },
  });

  const sourceMutation = useMutation({
    mutationFn: async () => {
      if (!sourceForm.name.trim() || !sourceForm.base_url.trim()) {
        throw new Error("Informe nome e URL da fonte publica.");
      }
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
        const text = (await res.text()) || res.statusText;
        throw new Error(`${res.status}: ${text}`);
      }
      return await res.json();
    },
    onSuccess: () => {
      toast({
        title: "Fonte cadastrada",
        description: "Fonte publica cadastrada com sucesso.",
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

  const recommendationMutation = useMutation({
    mutationFn: async () => {
      if (!dashboardData) {
        throw new Error("Dashboard ainda nao carregou.");
      }
      const summary = dashboardData.visao_geral.stats
        .map((item) => `${item.title}: ${item.value} (${item.subtitle})`)
        .join("; ");
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          prompt: `Com base nestes dados do dashboard juridico, gere 3 recomendacoes praticas e objetivas para o advogado: ${summary}`,
          system_prompt: "Voce e um especialista juridico estrategico no Brasil. Responda de forma objetiva.",
          temperature: 0.2,
          max_output_tokens: 500,
        }),
      });
      if (!res.ok) {
        const text = (await res.text()) || res.statusText;
        throw new Error(`${res.status}: ${text}`);
      }
      const payload = await res.json();
      return payload.text as string;
    },
    onSuccess: (text) => {
      toast({
        title: "Recomendacoes geradas",
        description: text.length > 220 ? `${text.slice(0, 220)}...` : text,
      });
    },
    onError: (error) => {
      toast({
        title: "Falha ao gerar recomendacoes",
        description: error instanceof Error ? error.message : "Erro desconhecido",
      });
    },
  });

  const handleApplyFilters = () => {
    setIsFiltering(true);
    setAppliedFilters(draftFilters);
    setTimeout(() => setIsFiltering(false), 400);
  };

  const dashboardData = dashboardQuery.data;

  useEffect(() => {
    setDismissedAlerts([]);
  }, [dashboardData?.generated_at]);
  const radarData = useMemo(
    () =>
      (dashboardData?.visao_geral.radar || []).map((item) => ({
        subject: item.subject,
        A: item.current,
        B: item.cluster_avg,
      })),
    [dashboardData],
  );

  const getAlertKey = (item: { type: string; title: string; time: string }) => `${item.type}::${item.title}::${item.time}`;

  const handleViewAlert = (item: { title: string; desc: string }) => {
    toast({
      title: item.title,
      description: item.desc.length > 220 ? `${item.desc.slice(0, 220)}...` : item.desc,
    });
  };

  const handleResolveAlert = (item: { type: string; title: string; time: string }) => {
    const key = getAlertKey(item);
    setDismissedAlerts((prev) => (prev.includes(key) ? prev : [...prev, key]));
    toast({
      title: "Alerta marcado como resolvido",
      description: item.title,
    });
  };

  const handleDismissAlert = (item: { type: string; title: string; time: string }) => {
    const key = getAlertKey(item);
    setDismissedAlerts((prev) => (prev.includes(key) ? prev : [...prev, key]));
    toast({
      title: "Alerta dispensado",
      description: item.title,
    });
  };

  const handlePrimaryAlertAction = (item: { type: string; title: string }) => {
    if (item.type === "opportunity") {
      setActiveTab("simulacoes");
      toast({
        title: "Abrindo Simulacoes Avancadas",
        description: item.title,
      });
      return;
    }
    setActiveTab("inteligencia");
    toast({
      title: "Abrindo Inteligencia Estrategica",
      description: item.title,
    });
  };

  return (
    <div className="min-h-screen flex flex-col bg-[radial-gradient(circle_at_8%_-10%,rgba(37,99,235,0.35),transparent_35%),radial-gradient(circle_at_90%_-20%,rgba(20,184,166,0.2),transparent_35%),linear-gradient(180deg,#070b1a_0%,#090f22_55%,#070c1a_100%)]">
      <header className="h-16 flex items-center justify-between px-6 sticky top-0 z-50 border-b border-slate-800/80 bg-slate-950/85 backdrop-blur-xl">
        <Link href="/" className="flex items-center gap-2">
          <Scale className="h-6 w-6 text-cyan-300" />
          <span className="text-xl font-bold tracking-tight text-white">LexScale</span>
        </Link>

        <div className="flex gap-2 bg-slate-900/80 p-1 rounded-xl border border-slate-800">
          <TabButton active={activeTab === "visao-geral"} onClick={() => setActiveTab("visao-geral")} icon={<LayoutDashboard size={16} />} text="Visao Geral" />
          <TabButton active={activeTab === "inteligencia"} onClick={() => setActiveTab("inteligencia")} icon={<BrainCircuit size={16} />} text="Inteligencia Estrategica" />
          <TabButton active={activeTab === "simulacoes"} onClick={() => setActiveTab("simulacoes")} icon={<ActivitySquare size={16} />} text="Simulacoes Avancadas" />
          <TabButton active={activeTab === "alertas"} onClick={() => setActiveTab("alertas")} icon={<BellRing size={16} />} text="Alertas Estrategicos" />
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center text-sm text-slate-300 gap-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            {dashboardData?.updated_label || "Atualizando..."}
          </div>
          <Button variant="ghost" size="icon" className="rounded-full" onClick={() => setLocation("/auth")}>
            <div className="w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold text-sm">AD</div>
          </Button>
        </div>
      </header>

      <main className={`flex-1 p-6 max-w-[1400px] mx-auto w-full transition-opacity duration-300 ${isFiltering ? "opacity-50 pointer-events-none" : "opacity-100"}`}>
        <section className={`${PANEL_CLASS} p-4 mb-6`}>
          <div className="flex items-center justify-between gap-4 mb-4">
            <h3 className="font-bold text-slate-100 flex items-center gap-2">
              <Upload size={18} className="text-cyan-300" />
              Upload de Processo e Enriquecimento
            </h3>
            <Button
              onClick={() => syncMutation.mutate()}
              disabled={syncMutation.isPending}
              variant="outline"
              className="h-9 gap-2 border-slate-700 bg-slate-900/50 text-slate-100 hover:bg-slate-800"
            >
              <RefreshCcw size={14} className={syncMutation.isPending ? "animate-spin" : ""} />
              {syncMutation.isPending ? "Sincronizando..." : "Sincronizar APIs Publicas"}
            </Button>
          </div>

          <div className="grid md:grid-cols-6 gap-3 items-end">
            <div className="md:col-span-2">
              <label className="text-xs font-semibold text-slate-400 uppercase">Arquivo do processo</label>
              <input
                type="file"
                className="mt-1 block w-full text-sm text-slate-300 file:mr-3 file:py-2 file:px-3 file:rounded-md file:border file:border-slate-700 file:bg-slate-900 file:text-cyan-200 hover:file:bg-slate-800"
                onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)}
              />
            </div>
            <InputField label="Numero processo" value={uploadForm.process_number} onChange={(value) => setUploadForm((s) => ({ ...s, process_number: value }))} />
            <InputField label="Tribunal" value={uploadForm.tribunal} onChange={(value) => setUploadForm((s) => ({ ...s, tribunal: value }))} />
            <InputField label="Juiz" value={uploadForm.judge} onChange={(value) => setUploadForm((s) => ({ ...s, judge: value }))} />
            <InputField label="Tipo acao" value={uploadForm.action_type} onChange={(value) => setUploadForm((s) => ({ ...s, action_type: value }))} />
          </div>
          <div className="grid md:grid-cols-6 gap-3 items-end mt-3">
            <InputField label="Valor causa (R$)" value={uploadForm.claim_value} onChange={(value) => setUploadForm((s) => ({ ...s, claim_value: value }))} />
            <div className="md:col-span-5 flex justify-end">
              <Button onClick={() => uploadMutation.mutate()} disabled={uploadMutation.isPending} className="bg-cyan-500 hover:bg-cyan-400 text-slate-950 gap-2 h-[38px] px-6 font-bold">
                <Upload size={16} />
                {uploadMutation.isPending ? "Processando..." : "Enviar e Processar"}
              </Button>
            </div>
          </div>

          <div className="mt-5 pt-4 border-t border-slate-800">
            <p className="text-xs font-semibold text-slate-400 uppercase mb-3">Cadastro de fonte publica</p>
            <div className="grid md:grid-cols-6 gap-3 items-end">
              <InputField label="Nome da fonte" value={sourceForm.name} onChange={(value) => setSourceForm((s) => ({ ...s, name: value }))} />
              <div className="md:col-span-3">
                <InputField label="URL da API publica" value={sourceForm.base_url} onChange={(value) => setSourceForm((s) => ({ ...s, base_url: value }))} />
              </div>
              <InputField label="Tribunal (opcional)" value={sourceForm.tribunal} onChange={(value) => setSourceForm((s) => ({ ...s, tribunal: value }))} />
              <div className="flex justify-end">
                <Button onClick={() => sourceMutation.mutate()} disabled={sourceMutation.isPending} variant="outline" className="h-[38px] gap-2 border-slate-700 bg-slate-900/50 text-slate-100 hover:bg-slate-800">
                  {sourceMutation.isPending ? "Salvando..." : "Salvar Fonte"}
                </Button>
              </div>
            </div>
          </div>
        </section>

        <div className={`${PANEL_SOFT_CLASS} p-4 flex flex-wrap gap-4 items-end mb-8`}>
          <FilterSelect
            label="Tribunal"
            value={draftFilters.tribunal}
            options={FILTER_OPTIONS.tribunal}
            onChange={(value) => setDraftFilters((prev) => ({ ...prev, tribunal: value }))}
          />
          <FilterSelect
            label="Juiz"
            value={draftFilters.juiz}
            options={FILTER_OPTIONS.juiz}
            onChange={(value) => setDraftFilters((prev) => ({ ...prev, juiz: value }))}
          />
          <FilterSelect
            label="Tipo de Acao"
            value={draftFilters.tipo_acao}
            options={FILTER_OPTIONS.tipo_acao}
            onChange={(value) => setDraftFilters((prev) => ({ ...prev, tipo_acao: value }))}
          />
          <FilterSelect
            label="Faixa de Valor"
            value={draftFilters.faixa_valor}
            options={FILTER_OPTIONS.faixa_valor}
            onChange={(value) => setDraftFilters((prev) => ({ ...prev, faixa_valor: value }))}
          />
          <FilterSelect
            label="Periodo"
            value={draftFilters.periodo}
            options={FILTER_OPTIONS.periodo}
            onChange={(value) => setDraftFilters((prev) => ({ ...prev, periodo: value }))}
          />
          <Button onClick={handleApplyFilters} className="bg-blue-600 hover:bg-blue-500 text-white gap-2 h-[38px] px-6">
            <CheckSquare size={16} /> Aplicar Filtros
          </Button>
        </div>

        {dashboardQuery.isLoading && (
          <div className={`${PANEL_SOFT_CLASS} p-8 text-slate-300`}>Carregando dashboard...</div>
        )}

        {dashboardQuery.isError && (
          <div className="rounded-xl p-8 text-red-200 border border-red-500/30 bg-red-950/35">
            Falha ao carregar dashboard: {dashboardQuery.error instanceof Error ? dashboardQuery.error.message : "erro desconhecido"}
          </div>
        )}

        {dashboardData && (
          <>
            {activeTab === "visao-geral" && (
              <VisaoGeralView
                data={dashboardData}
                radarData={radarData}
                onGenerateRecommendations={() => recommendationMutation.mutate()}
                generatingRecommendations={recommendationMutation.isPending}
              />
            )}
            {activeTab === "inteligencia" && <InteligenciaView data={dashboardData} />}
            {activeTab === "simulacoes" && <SimulacoesView data={dashboardData} />}
            {activeTab === "alertas" && (
              <AlertasView
                data={dashboardData}
                dismissedAlerts={dismissedAlerts}
                getAlertKey={getAlertKey}
                onViewAlert={handleViewAlert}
                onResolveAlert={handleResolveAlert}
                onDismissAlert={handleDismissAlert}
                onPrimaryAlertAction={handlePrimaryAlertAction}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}

function VisaoGeralView({
  data,
  radarData,
  onGenerateRecommendations,
  generatingRecommendations,
}: {
  data: DashboardData;
  radarData: Array<{ subject: string; A: number; B: number }>;
  onGenerateRecommendations: () => void;
  generatingRecommendations: boolean;
}) {
  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        {data.visao_geral.stats.slice(0, 3).map((item, idx) => (
          <MetricCard key={idx} {...item} />
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className={`${PANEL_CLASS} p-6 lg:col-span-2`}>
          <div className="flex items-center gap-2 mb-8">
            <BarChart3 className="text-cyan-300 w-5 h-5" />
            <h3 className="font-bold text-lg text-slate-100 uppercase tracking-tight">Scores do Processo</h3>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-12">
            {data.visao_geral.scores.map((score, idx) => (
              <ScoreCardCircle
                key={idx}
                title={score.title}
                value={score.value}
                color={score.color}
                icon={score.title.toLowerCase().includes("risco") ? <AlertTriangle size={20} /> : score.title.toLowerCase().includes("complex") ? <BrainCircuit size={20} /> : score.title.toLowerCase().includes("acordo") ? <CheckSquare size={20} /> : <Trophy size={20} />}
              />
            ))}
          </div>

          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <BarChart3 className="text-cyan-300 w-4 h-4" />
                <h4 className="font-bold text-slate-100 text-sm">Radar do Processo</h4>
              </div>
              <div className="h-[280px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart cx="50%" cy="50%" outerRadius="80%" data={radarData}>
                    <PolarGrid stroke="#334155" />
                    <PolarAngleAxis dataKey="subject" tick={{ fill: "#94a3b8", fontSize: 11, fontWeight: 500 }} />
                    <Radar name="Processo Atual" dataKey="A" stroke="#38bdf8" strokeWidth={2} fill="#0ea5e9" fillOpacity={0.35} />
                    <Radar name="Media do Cluster" dataKey="B" stroke="#64748b" strokeDasharray="4 4" fill="#334155" fillOpacity={0.3} />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
              <div className="flex justify-center gap-6 mt-4">
                <div className="flex items-center gap-2 text-[10px] font-bold text-slate-400 uppercase">
                  <div className="w-3 h-3 rounded-full bg-cyan-400"></div> Processo Atual
                </div>
                <div className="flex items-center gap-2 text-[10px] font-bold text-slate-400 uppercase">
                  <div className="w-3 h-3 rounded-full bg-slate-500"></div> Media do Cluster
                </div>
              </div>
            </div>

            <div className="bg-blue-600 text-white p-8 rounded-2xl shadow-xl shadow-blue-200/20 relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:scale-110 transition-transform">
                <BrainCircuit size={120} />
              </div>
              <div className="relative z-10">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center backdrop-blur-sm">
                    <Zap className="w-6 h-6 text-yellow-300" />
                  </div>
                  <h4 className="font-bold text-xl">Insights Narrativos por IA</h4>
                </div>
                <div className="space-y-4 text-sm text-blue-50/90 leading-relaxed">
                  {data.visao_geral.insights.slice(0, 3).map((insight, idx) => (
                    <p key={idx}>
                      <strong>{insight.title}:</strong> {insight.text}
                    </p>
                  ))}
                </div>
                <Button
                  onClick={onGenerateRecommendations}
                  disabled={generatingRecommendations}
                  className="w-full mt-8 bg-cyan-500 text-slate-950 hover:bg-cyan-400 font-bold h-12 gap-2"
                >
                  <FileText size={18} /> Recomendacoes Estrategicas
                </Button>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className={`${PANEL_SOFT_CLASS} p-6`}>
            <div className="flex items-center justify-between mb-6">
              <h3 className="font-bold text-slate-100 flex items-center gap-2">
                <ActivitySquare size={18} className="text-cyan-300" /> Atividade Semanal
              </h3>
              <MoreHorizontal size={18} className="text-slate-500 cursor-pointer" />
            </div>
            <div className="h-[200px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.visao_geral.weekly_activity}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1e293b" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "#94a3b8" }} />
                  <Tooltip cursor={{ fill: "#0f172a" }} contentStyle={{ borderRadius: "8px", border: "1px solid #334155", background: "#0f172a", color: "#cbd5e1" }} />
                  <Bar dataKey="value" fill="#38bdf8" radius={[4, 4, 0, 0]} barSize={24} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className={`${PANEL_SOFT_CLASS} p-6`}>
            <h3 className="font-bold text-slate-100 flex items-center gap-2 mb-6">
              <Clock size={18} className="text-orange-400" /> Prazos Criticos
            </h3>
            <div className="space-y-4">
              {data.visao_geral.critical_deadlines.map((p, i) => (
                <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-slate-900/75 border border-slate-800">
                  <div className="flex items-center gap-3">
                    <div className={`w-1.5 h-8 rounded-full ${deadlineTone(p.color).line}`}></div>
                    <span className="text-xs font-bold text-slate-200">{p.label}</span>
                  </div>
                  <span className={`text-[10px] font-black uppercase px-2 py-1 rounded ${deadlineTone(p.color).badge}`}>{p.date}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function InteligenciaView({ data }: { data: DashboardData }) {
  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 space-y-8">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 bg-cyan-500/20 border border-cyan-400/40 rounded-lg flex items-center justify-center">
          <BrainCircuit className="text-white w-6 h-6" />
        </div>
        <h2 className="text-2xl font-bold text-slate-100">Inteligencia Estrategica</h2>
      </div>

      <section>
        <div className="flex items-center gap-2 mb-6 text-slate-100">
          <FileText size={20} className="text-cyan-300" />
          <h3 className="font-bold uppercase tracking-tight text-sm">Processos Similares</h3>
        </div>
        <div className="grid md:grid-cols-3 gap-6">
          {data.inteligencia.similar_processes.map((item, idx) => (
            <SimilarProcessCard key={idx} id={item.id} similarity={item.similarity} result={item.result} resultColor={item.result_color} time={item.time} type={item.type} />
          ))}
        </div>
      </section>

      <section className={`${PANEL_CLASS} p-8`}>
        <div className="flex items-center gap-2 mb-8 text-slate-100">
          <ActivitySquare size={20} className="text-cyan-300" />
          <h3 className="font-bold uppercase tracking-tight text-sm">Mapa de Comportamento Judicial (Heatmap)</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-slate-400 font-medium">
                <th className="pb-4 text-left font-normal"></th>
                {data.inteligencia.heatmap_columns.map((column, idx) => (
                  <th key={idx} className="pb-4 px-4 font-normal">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="space-y-2">
              {data.inteligencia.heatmap_rows.map((row, idx) => (
                <HeatmapRow key={idx} name={row.name} values={row.values} />
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex justify-center gap-6 mt-12">
          <HeatmapLegend color="bg-emerald-200" text="Alto (>80%)" />
          <HeatmapLegend color="bg-yellow-100" text="Medio-Alto (70-79%)" />
          <HeatmapLegend color="bg-orange-100" text="Medio (60-69%)" />
          <HeatmapLegend color="bg-red-100" text="Baixo (<50%)" />
        </div>
      </section>

      <section className={`${PANEL_CLASS} p-8`}>
        <div className="flex items-center gap-2 mb-8 text-slate-100">
          <BarChart3 size={20} className="text-cyan-300" />
          <h3 className="font-bold uppercase tracking-tight text-sm">Benchmark vs Mercado</h3>
        </div>
        <div className="grid md:grid-cols-3 gap-12 text-center">
          {data.inteligencia.benchmark.map((item, idx) => (
            <BenchmarkStat key={idx} label={item.label} user={item.user} market={item.market} trend={item.trend} trendColor={item.trend_color} unit={item.unit || ""} />
          ))}
        </div>
      </section>
    </div>
  );
}

function SimulacoesView({ data }: { data: DashboardData }) {
  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 space-y-8">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 bg-cyan-500/20 border border-cyan-400/40 rounded-lg flex items-center justify-center">
          <ActivitySquare className="text-cyan-200 w-6 h-6" />
        </div>
        <h2 className="text-2xl font-bold text-slate-100">Simulacoes Avancadas - Gemeo Digital</h2>
      </div>

      <div className="bg-slate-900/85 text-white p-6 rounded-xl border border-slate-800 border-l-4 border-cyan-400">
        <div className="flex gap-4 items-start">
          <div className="bg-cyan-500/20 p-2 rounded shrink-0">
            <BrainCircuit size={20} className="text-cyan-300" />
          </div>
          <p className="text-sm text-slate-200 leading-relaxed">
            <strong>Gemeo Digital:</strong> {data.simulacoes.description}
          </p>
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        {data.simulacoes.scenarios.map((scenario, idx) => (
          <ScenarioCard key={idx} title={scenario.title} tag={scenario.tag} tagColor={scenario.tag_color} data={scenario.data} footer={scenario.footer} />
        ))}
      </div>

      <div className={`${PANEL_CLASS} p-8`}>
        <div className="flex items-center gap-2 mb-12 text-slate-100">
          <Scale size={20} className="text-cyan-300" />
          <h3 className="font-bold uppercase tracking-tight text-sm">Comparativo de Impacto</h3>
        </div>
        <div className="grid md:grid-cols-3 gap-12">
          {data.simulacoes.impact_metrics.map((metric, idx) => (
            <ImpactMetric key={idx} label={metric.label} icon={metric.icon} title={metric.title} val={metric.val} trend={metric.trend} trendBg={metric.trend_bg} />
          ))}
        </div>
      </div>
    </div>
  );
}

function AlertasView({
  data,
  dismissedAlerts,
  getAlertKey,
  onViewAlert,
  onResolveAlert,
  onDismissAlert,
  onPrimaryAlertAction,
}: {
  data: DashboardData;
  dismissedAlerts: string[];
  getAlertKey: (item: { type: string; title: string; time: string }) => string;
  onViewAlert: (item: { title: string; desc: string }) => void;
  onResolveAlert: (item: { type: string; title: string; time: string }) => void;
  onDismissAlert: (item: { type: string; title: string; time: string }) => void;
  onPrimaryAlertAction: (item: { type: string; title: string }) => void;
}) {
  const visibleAlerts = data.alertas.details.filter((item) => !dismissedAlerts.includes(getAlertKey(item)));
  const counters = {
    critical: visibleAlerts.filter((item) => item.type === "critical").length,
    warning: visibleAlerts.filter((item) => item.type === "warning").length,
    info: visibleAlerts.filter((item) => item.type === "info").length,
    opportunity: visibleAlerts.filter((item) => item.type === "opportunity").length,
  };

  const countsToRender = [
    { label: "CRITICOS", color: "red", count: counters.critical },
    { label: "ATENCAO", color: "orange", count: counters.warning },
    { label: "INFORMATIVOS", color: "blue", count: counters.info },
    { label: "OPORTUNIDADES", color: "emerald", count: counters.opportunity },
  ];

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 space-y-8">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 bg-cyan-500/20 border border-cyan-400/40 rounded-lg flex items-center justify-center">
          <BellRing className="text-cyan-200 w-6 h-6" />
        </div>
        <h2 className="text-2xl font-bold text-slate-100">Alertas Estrategicos</h2>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
        {countsToRender.map((item, idx) => (
          <AlertCountCard key={idx} count={item.count} label={item.label} color={item.color} />
        ))}
      </div>

      <div className="space-y-4">
        {visibleAlerts.map((item, idx) => (
          <DetailedAlert
            key={idx}
            type={item.type}
            title={item.title}
            time={item.time}
            desc={item.desc}
            onView={() => onViewAlert(item)}
            onResolve={() => onResolveAlert(item)}
            onPrimaryAction={() => onPrimaryAlertAction(item)}
            onDismiss={() => onDismissAlert(item)}
          />
        ))}
      </div>
    </div>
  );
}

function InputField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-semibold text-slate-400 uppercase">{label}</label>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-[38px] px-3 border border-slate-700 rounded-md bg-slate-900/70 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
      />
    </div>
  );
}

function SimilarProcessCard({ id, similarity, result, time, type, resultColor = "emerald" }: any) {
  const tone = resultTone(resultColor);
  return (
    <div className={`${PANEL_SOFT_CLASS} p-6 hover:border-cyan-500/40 transition-colors cursor-pointer group`}>
      <div className="flex justify-between items-center mb-6">
        <span className="text-xs font-black text-slate-100 tracking-tight">{id}</span>
        <span className={`text-[10px] font-bold px-2 py-1 rounded-full uppercase tracking-widest ${tone.badge}`}>{similarity} Similar</span>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div>
          <p className="text-[10px] text-slate-400 font-bold uppercase mb-2">Resultado</p>
          <div className="flex items-center gap-1">
            <div className={`w-2 h-2 rounded-full ${tone.dot}`}></div>
            <span className={`text-xs font-bold ${tone.text}`}>{result}</span>
          </div>
        </div>
        <div>
          <p className="text-[10px] text-slate-400 font-bold uppercase mb-2">Tempo</p>
          <span className="text-xs font-bold text-slate-200">{time}</span>
        </div>
        <div>
          <p className="text-[10px] text-slate-400 font-bold uppercase mb-2">Tipo</p>
          <span className="text-xs font-bold text-slate-200">{type}</span>
        </div>
      </div>
    </div>
  );
}

function HeatmapRow({ name, values }: any) {
  const getBg = (v: number) => {
    if (v >= 80) return "bg-emerald-500/25 text-emerald-200 border border-emerald-400/30";
    if (v >= 70) return "bg-yellow-500/20 text-yellow-200 border border-yellow-400/30";
    if (v >= 60) return "bg-orange-500/20 text-orange-200 border border-orange-400/30";
    return "bg-red-500/20 text-red-200 border border-red-400/30";
  };
  return (
    <tr>
      <td className="py-2 text-xs font-bold text-slate-300 w-40">{name}</td>
      {values.map((v: number, i: number) => (
        <td key={i} className="py-1 px-1">
          <div className={`h-12 rounded flex items-center justify-center font-bold text-sm ${getBg(v)}`}>{v}%</div>
        </td>
      ))}
    </tr>
  );
}

function HeatmapLegend({ color, text }: any) {
  return (
    <div className="flex items-center gap-2">
      <div className={`w-3 h-3 rounded ${color}`}></div>
      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{text}</span>
    </div>
  );
}

function BenchmarkStat({ label, user, market, trend, trendColor, unit = "" }: any) {
  const tone = trendTone(trendColor);
  return (
    <div>
      <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-6">{label}</p>
      <div className="flex items-center justify-center gap-8 mb-4">
        <div>
          <div className="text-3xl font-black text-cyan-300 mb-1">{user}</div>
          <p className="text-[9px] font-bold text-slate-400 uppercase">Seu Escritorio</p>
        </div>
        <div className="text-slate-500 font-light text-xl">vs</div>
        <div>
          <div className="text-3xl font-black text-slate-100 mb-1">
            {market}
            {unit}
          </div>
          <p className="text-[9px] font-bold text-slate-400 uppercase">Mercado</p>
        </div>
      </div>
      <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${tone}`}>
        <TrendingUp size={12} /> {trend}
      </div>
    </div>
  );
}

function ScenarioCard({ title, tag, tagColor, data, footer }: any) {
  const tone = tagTone(tagColor);
  return (
    <div className={`${PANEL_SOFT_CLASS} overflow-hidden flex flex-col h-full`}>
      <div className={`h-1 ${tone.line}`}></div>
      <div className="p-6 flex-1 flex flex-col">
        <div className="flex justify-between items-center mb-8">
          <h4 className="font-bold text-slate-100 flex items-center gap-2 text-sm">
            <CheckSquare size={16} className={tone.text} /> {title}
          </h4>
          <span className={`text-[9px] font-black px-2 py-0.5 rounded uppercase tracking-widest ${tone.badge}`}>{tag}</span>
        </div>
        <div className="space-y-6 flex-1">
          {data.map((d: any, i: number) => (
            <div key={i} className="flex justify-between items-center">
              <span className="text-xs text-slate-400 font-medium">{d.label}</span>
              <span className={`text-sm font-black ${valueTone(d.color)}`}>{d.val}</span>
            </div>
          ))}
        </div>
        <div className="mt-8 pt-6 border-t border-slate-800">
          <p className="text-[11px] text-slate-400 leading-relaxed italic">{footer}</p>
        </div>
      </div>
    </div>
  );
}

function iconFromKey(key: string) {
  if (key === "trophy") return <Trophy className="text-cyan-300" />;
  if (key === "shield") return <Shield className="text-emerald-300" />;
  if (key === "zap") return <Zap className="text-orange-300" />;
  return <BarChart3 className="text-cyan-300" />;
}

function ImpactMetric({ label, icon, title, val, trend, trendBg }: any) {
  return (
    <div className="text-center">
      <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-6">{label}</p>
      <div className="w-12 h-12 bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-4">{iconFromKey(icon)}</div>
      <h4 className="text-xl font-black text-slate-100 mb-1">{title}</h4>
      <p className="text-xs text-slate-300 mb-4">{val}</p>
      <div className={`inline-flex px-3 py-1 rounded text-[10px] font-black uppercase tracking-widest ${impactTrendTone(trendBg)} text-slate-100`}>{trend}</div>
    </div>
  );
}

function AlertCountCard({ count, label, color }: any) {
  const tone = countTone(color);
  return (
    <div className={`${PANEL_SOFT_CLASS} p-6 text-center`}>
      <div className={`text-4xl font-black mb-2 ${tone}`}>{count}</div>
      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{label}</div>
    </div>
  );
}

function DetailedAlert({ type, title, time, desc, onView, onResolve, onPrimaryAction, onDismiss }: any) {
  const configs: any = {
    critical: { icon: <AlertTriangle size={20} />, color: "text-red-300", bg: "bg-red-500/15", border: "border-red-500/40", tag: "CRITICO", tagBg: "bg-red-600", line: "bg-red-500" },
    warning: { icon: <TrendingUp size={20} />, color: "text-orange-300", bg: "bg-orange-500/15", border: "border-orange-500/35", tag: "ATENCAO", tagBg: "bg-orange-500", line: "bg-orange-500" },
    opportunity: { icon: <Zap size={20} />, color: "text-emerald-300", bg: "bg-emerald-500/15", border: "border-emerald-500/35", tag: "OPORTUNIDADE", tagBg: "bg-emerald-500", line: "bg-emerald-500" },
    info: { icon: <BarChart3 size={20} />, color: "text-cyan-300", bg: "bg-cyan-500/15", border: "border-cyan-500/35", tag: "INFORMATIVO", tagBg: "bg-cyan-600", line: "bg-cyan-500" },
  };
  const c = configs[type] || configs.info;
  return (
    <div className={`rounded-xl border ${c.border} overflow-hidden shadow-sm flex bg-slate-900/65`}>
      <div className={`w-1.5 ${c.line}`}></div>
      <div className="p-6 flex gap-6 items-start flex-1">
        <div className={`${c.bg} p-3 rounded-lg ${c.color} shrink-0`}>{c.icon}</div>
        <div className="flex-1">
          <div className="flex justify-between items-center mb-3">
            <div className="flex items-center gap-3">
              <span className={`${c.tagBg} text-white text-[9px] font-black px-2 py-0.5 rounded`}>{c.tag}</span>
              <span className="text-[10px] text-slate-400 font-medium">{time}</span>
            </div>
            <div className="flex gap-2">
              <Button onClick={onView} variant="ghost" size="icon" className="h-6 w-6 text-slate-500 hover:text-slate-300">
                <Eye size={14} />
              </Button>
              <Button onClick={onResolve} variant="ghost" size="icon" className="h-6 w-6 text-slate-500 hover:text-slate-300">
                <CheckSquare size={14} />
              </Button>
            </div>
          </div>
          <h4 className="font-black text-slate-100 mb-2">{title}</h4>
          <p className="text-xs text-slate-300 leading-relaxed mb-6">{desc}</p>
          <div className="flex gap-3">
            <Button onClick={onPrimaryAction} size="sm" className="bg-cyan-500 text-slate-950 h-8 text-[11px] px-4 font-bold gap-2 hover:bg-cyan-400">
              <Search size={14} /> Ver Detalhes
            </Button>
            <Button onClick={onDismiss} size="sm" variant="outline" className="h-8 text-[11px] px-4 font-bold text-slate-300 border-slate-700 bg-slate-900/40 hover:bg-slate-800">
              Dispensar
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ScoreCardCircle({ title, value, icon, color }: any) {
  const tone = scoreTone(color);
  return (
    <div className="flex flex-col items-center text-center group cursor-pointer">
      <div className={`mb-6 transition-transform group-hover:scale-110 duration-300 ${tone.text}`}>{icon}</div>
      <div className="text-4xl font-black text-slate-100 mb-1">{value}</div>
      <div className="text-[9px] font-black text-slate-400 uppercase tracking-[0.2em]">{title}</div>
      <div className={`w-full h-1 mt-6 rounded-full bg-slate-800 overflow-hidden`}>
        <div className={`h-full ${tone.bar}`} style={{ width: `${value}%` }}></div>
      </div>
    </div>
  );
}

function TabButton({ active, icon, text, onClick }: any) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
        active ? "bg-blue-600 text-white shadow-sm" : "text-slate-300 hover:text-white hover:bg-slate-800"
      }`}
    >
      {icon}
      {text}
    </button>
  );
}

function FilterSelect({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-semibold text-slate-400 uppercase">{label}</label>
      <select
        className="h-[38px] px-3 border border-slate-700 rounded-md bg-slate-900/70 min-w-[170px] text-sm text-slate-100 cursor-pointer hover:border-cyan-400"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </div>
  );
}

function MetricCard({ title, value, subtitle, footer, color, updated, warning }: any) {
  const tone = metricTone(color);
  return (
    <div className={`${PANEL_SOFT_CLASS} p-6 flex flex-col justify-between relative overflow-hidden h-full`}>
      <div className={`absolute top-0 left-0 w-1 h-full ${tone.line}`}></div>
      <div className="mb-4">
        <div className="flex items-center gap-2 mb-4">
          <FileText className={`w-4 h-4 text-cyan-300`} />
          <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wide">{title}</h4>
        </div>
        <div className="text-4xl font-black text-slate-100 mb-2">{value}</div>
        <div className="text-sm text-slate-300 font-medium">{subtitle}</div>
      </div>

      <div className="pt-4 border-t border-slate-800 flex flex-col gap-2">
        <div className="flex items-center gap-2 text-[10px] font-bold text-slate-400 uppercase tracking-tight">
          <Database size={12} className={`text-cyan-300`} /> {footer}
        </div>
        {updated && <div className="flex items-center gap-2 text-[10px] font-bold text-emerald-400 uppercase">{updated}</div>}
        {warning && (
          <div className="flex items-center gap-2 text-[10px] font-bold text-orange-300 uppercase bg-orange-500/15 border border-orange-500/25 p-1.5 rounded">
            <AlertTriangle size={12} /> {warning}
          </div>
        )}
      </div>
    </div>
  );
}

function deadlineTone(color: string) {
  if (color === "red") return { line: "bg-red-500", badge: "bg-red-500/20 text-red-300 border border-red-500/30" };
  if (color === "orange") return { line: "bg-orange-500", badge: "bg-orange-500/20 text-orange-300 border border-orange-500/30" };
  if (color === "blue") return { line: "bg-cyan-500", badge: "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30" };
  return { line: "bg-slate-500", badge: "bg-slate-700 text-slate-200 border border-slate-600" };
}

function resultTone(color: string) {
  if (color === "red") return { dot: "bg-red-400", text: "text-red-300", badge: "bg-red-500/20 text-red-300 border border-red-500/30" };
  return { dot: "bg-emerald-400", text: "text-emerald-300", badge: "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30" };
}

function trendTone(color: string) {
  if (color === "blue") return "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30";
  if (color === "orange") return "bg-orange-500/20 text-orange-300 border border-orange-500/30";
  return "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30";
}

function tagTone(color: string) {
  if (color === "orange") return { line: "bg-orange-500", text: "text-orange-300", badge: "bg-orange-500/20 text-orange-300 border border-orange-500/30" };
  if (color === "blue") return { line: "bg-cyan-500", text: "text-cyan-300", badge: "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30" };
  return { line: "bg-emerald-500", text: "text-emerald-300", badge: "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30" };
}

function valueTone(color?: string) {
  if (color === "orange") return "text-orange-300";
  if (color === "blue") return "text-cyan-300";
  if (color === "emerald") return "text-emerald-300";
  return "text-slate-100";
}

function impactTrendTone(trendBg: string) {
  if (trendBg.includes("emerald")) return "bg-emerald-500/20 border border-emerald-500/30";
  if (trendBg.includes("orange")) return "bg-orange-500/20 border border-orange-500/30";
  return "bg-cyan-500/20 border border-cyan-500/30";
}

function countTone(color: string) {
  if (color === "red") return "text-red-400";
  if (color === "orange") return "text-orange-400";
  if (color === "blue") return "text-cyan-300";
  if (color === "emerald") return "text-emerald-400";
  return "text-slate-100";
}

function scoreTone(color: string) {
  if (color === "red") return { text: "text-red-400", bar: "bg-red-500" };
  if (color === "orange") return { text: "text-orange-400", bar: "bg-orange-500" };
  if (color === "blue") return { text: "text-cyan-300", bar: "bg-cyan-500" };
  return { text: "text-emerald-400", bar: "bg-emerald-500" };
}

function metricTone(color: string) {
  if (color === "orange") return { line: "bg-orange-500" };
  return { line: "bg-cyan-500" };
}
