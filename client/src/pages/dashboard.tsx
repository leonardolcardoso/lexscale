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
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, Radar, BarChart, Bar, XAxis, CartesianGrid, Tooltip } from "recharts";
import { useToast } from "@/hooks/use-toast";
import { buildInitials, fetchMe, isUnauthorizedError, logout } from "@/lib/auth";
import { mapNetworkError, parseApiErrorResponse } from "@/lib/http-errors";
import { buildMockDashboardData } from "@/lib/mock-dashboard";
import type {
  CaseAIStatus,
  CaseAIStatusResponse,
  CaseExtractionPreviewResponse,
  DashboardData,
  DashboardFilters,
  UploadCaseResponse,
  UserCaseListItem,
} from "@/types/dashboard";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const DEFAULT_FILTERS: DashboardFilters = {
  tribunal: "Todos os Tribunais",
  juiz: "Todos os Juízes",
  tipo_acao: "Todos os Tipos",
  faixa_valor: "Todos os Valores",
  periodo: "Últimos 6 meses",
};

const FILTER_OPTIONS = {
  tribunal: ["Todos os Tribunais", "TJSP", "TJRJ", "TJDFT", "TRF5", "TRT2", "TRF3", "STJ"],
  juiz: ["Todos os Juízes", "Dr. João Silva", "Dra. Maria Santos", "Dr. Pedro Oliveira"],
  tipo_acao: ["Todos os Tipos", "Trabalhista", "Cível", "Tributário", "Comercial", "Família"],
  faixa_valor: ["Todos os Valores", "0-100k", "100k-500k", ">500k"],
  periodo: ["Últimos 3 meses", "Últimos 6 meses", "Últimos 12 meses"],
};

const PANEL_CLASS = "rounded-2xl border border-slate-800/90 bg-slate-900/70 backdrop-blur-xl shadow-[0_18px_40px_rgba(2,6,23,0.45)]";
const PANEL_SOFT_CLASS = "rounded-2xl border border-slate-800/80 bg-slate-900/45 backdrop-blur-xl shadow-[0_14px_30px_rgba(2,6,23,0.35)]";
const EMPTY_UPLOAD_FORM = {
  process_number: "",
  tribunal: "",
  judge: "",
  action_type: "",
  claim_value: "",
};

type DashboardTab = "visao-geral" | "inteligencia" | "simulacoes" | "alertas";
type CardDetailVariant = "default" | "scenario";

type CardDetail = {
  title: string;
  description?: string;
  lines?: string[];
  variant?: CardDetailVariant;
  badgeLabel?: string;
  recommendationTitle?: string;
  recommendationText?: string;
  sourceNote?: string;
  targetTab?: DashboardTab;
  targetScenarioTitle?: string;
};

type SimilarProcessSource = DashboardData["inteligencia"]["similar_processes"][number];
type SimulationScenarioSource = DashboardData["simulacoes"]["scenarios"][number];

type SimilarProcessTimeline = {
  date: string;
  title: string;
  description: string;
};

type SimilarProcessRecommendation = {
  title: string;
  description: string;
};

type SimilarProcessDetail = {
  id: string;
  similarity: string;
  resultLabel: string;
  resultColor: string;
  time: string;
  closureType: string;
  similarityReasons: string[];
  timeline: SimilarProcessTimeline[];
  courtPatternSummary: string;
  courtPatternBullets: string[];
  riskLevel: "baixo" | "medio" | "alto";
  riskSummary: string;
  riskDescription: string;
  recommendations: SimilarProcessRecommendation[];
  comparison: {
    similarity: string;
    successProbability: string;
    estimatedTime: string;
    primaryRecommendation: string;
  };
  lgpdNotice: string;
};

type AlertCategory = "critical" | "warning" | "info" | "opportunity";
type StrategicAlertStatus = "new" | "read" | "dismissed";

type DashboardAlertItem = DashboardData["alertas"]["details"][number] & {
  alert_id?: string;
  status?: StrategicAlertStatus;
};

type StrategicAlertItem = {
  alert_id: string;
  type: string;
  title: string;
  desc: string;
  status: StrategicAlertStatus;
  source: string;
  occurrence_count: number;
  contexts: string[];
  time: string;
  created_at: string;
  last_detected_at: string;
  notified_at?: string | null;
  read_at?: string | null;
  dismissed_at?: string | null;
};

type StrategicAlertListResponse = {
  total: number;
  status_filter: string;
  generated_at: string;
  items: StrategicAlertItem[];
};

type ProcessingProgressTone = "processing" | "success" | "warning";

function parsePercentValue(raw: string, fallback = 70): number {
  const numeric = Number(raw.replace("%", "").replace(",", ".").trim());
  if (!Number.isFinite(numeric)) return fallback;
  return Math.round(numeric);
}

function resolveClosureType(result: string): string {
  const normalized = normalizeSearchText(result);
  if (normalized.includes("acordo")) return "Acordo";
  if (normalized.includes("favor")) return "Procedência parcial";
  return "Composição parcial";
}

function resolveValueRangeLabel(faixaValor: string): string {
  if (faixaValor === "0-100k") return "R$ 45.000 a R$ 75.000";
  if (faixaValor === "100k-500k") return "R$ 90.000 a R$ 180.000";
  if (faixaValor === ">500k") return "R$ 320.000 a R$ 580.000";
  return "R$ 80.000 a R$ 120.000";
}

function normalizeSearchText(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function resolveRiskTone(level: "baixo" | "medio" | "alto") {
  if (level === "alto") {
    return {
      badge: "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-200",
      container: "border-red-200 bg-red-50 dark:border-red-500/30 dark:bg-red-500/10",
      label: "RISCO ALTO",
    };
  }
  if (level === "medio") {
    return {
      badge: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-200",
      container: "border-amber-200 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10",
      label: "RISCO MÉDIO",
    };
  }
  return {
    badge: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200",
    container: "border-emerald-200 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/10",
    label: "RISCO BAIXO",
  };
}

function parseDayCount(label: string | undefined, fallback: number): number {
  if (!label) return fallback;
  const match = label.match(/\d+/);
  if (!match) return fallback;
  const value = Number(match[0]);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return value;
}

function buildSimilarProcessDetail(item: SimilarProcessSource, filters: DashboardFilters, isDemoMode: boolean): SimilarProcessDetail {
  const similarityValue = parsePercentValue(item.similarity, 68);
  const successProbabilityValue = item.result_color === "red" ? Math.max(38, similarityValue - 20) : Math.min(96, similarityValue - 8);
  const riskLevel: "baixo" | "medio" | "alto" =
    item.result_color === "red" || similarityValue < 60 ? "alto" : similarityValue < 78 ? "medio" : "baixo";
  const closureType = resolveClosureType(item.result);
  const yearMatch = item.id.match(/20\d{2}/);
  const timelineYear = yearMatch ? yearMatch[0] : String(new Date().getFullYear() - 1);

  const tribunalLabel = filters.tribunal === "Todos os Tribunais" ? "recorte multi-tribunal" : filters.tribunal;
  const actionLabel = filters.tipo_acao === "Todos os Tipos" ? item.type : filters.tipo_acao;
  const valueRange = resolveValueRangeLabel(filters.faixa_valor);
  const judgeScope = filters.juiz === "Todos os Juízes" ? "órgão julgador público" : "vara do juiz filtrado";

  const recommendationsByRisk: Record<"baixo" | "medio" | "alto", SimilarProcessRecommendation[]> = {
    baixo: [
      {
        title: "Propor acordo antes da audiência de instrução",
        description: "Histórico agregado indica alta taxa de composição nessa fase.",
      },
      {
        title: "Faixa sugerida para proposta",
        description: `Intervalo estimado de aceitação: ${valueRange}.`,
      },
      {
        title: "Timing ideal",
        description: "Atuar em até 15 dias para manter a janela de negociação favorável.",
      },
      {
        title: "Argumentação recomendada",
        description: "Enfatizar economia de tempo e previsibilidade de custo para ambas as partes.",
      },
    ],
    medio: [
      {
        title: "Reforçar proposta com condições escalonadas",
        description: "Modelar concessões progressivas melhora conversão em cenários moderados.",
      },
      {
        title: "Faixa sugerida para proposta",
        description: `Intervalo inicial recomendado: ${valueRange}.`,
      },
      {
        title: "Timing ideal",
        description: "Protocolar memoriais objetivos e abrir canal de acordo antes da próxima audiência.",
      },
      {
        title: "Argumentação recomendada",
        description: "Priorizar pontos de prova documental pública e risco de alongamento processual.",
      },
    ],
    alto: [
      {
        title: "Reavaliar chance de acordo imediato",
        description: "Histórico agregado sugere baixa aderência à composição sem reforço probatório.",
      },
      {
        title: "Faixa sugerida para proposta",
        description: `Trabalhar com teto controlado dentro de ${valueRange} para reduzir exposição.`,
      },
      {
        title: "Timing ideal",
        description: "Priorizar consolidação de provas e ajustar estratégia em até 10 dias.",
      },
      {
        title: "Argumentação recomendada",
        description: "Focar em robustez técnica, jurisprudência pública e mitigação de risco financeiro.",
      },
    ],
  };

  const primaryRecommendationByRisk: Record<"baixo" | "medio" | "alto", string> = {
    baixo: "Acordo imediato",
    medio: "Acordo com margem",
    alto: "Reforçar provas",
  };

  const riskSummaryByLevel: Record<"baixo" | "medio" | "alto", string> = {
    baixo: "Perfil favorável para composição",
    medio: "Perfil moderado com pontos de atenção",
    alto: "Perfil de risco elevado para acordo rápido",
  };

  const riskDescriptionByLevel: Record<"baixo" | "medio" | "alto", string> = {
    baixo: "Não foram identificados riscos significativos no recorte público analisado.",
    medio: "Há volatilidade moderada no histórico público do órgão julgador para casos equivalentes.",
    alto: "Existe risco relevante de prolongamento e decisão menos previsível no histórico público.",
  };

  const resultLabel = item.result_color === "red" ? "Parcial" : "Êxito";
  const timeline: SimilarProcessTimeline[] = [
    {
      date: `15/03/${timelineYear}`,
      title: "Distribuição do processo",
      description: "Autuação registrada em base pública com classificação processual compatível.",
    },
    {
      date: `28/04/${timelineYear}`,
      title: "Audiência de conciliação",
      description: "Tentativa inicial de composição sem identificadores pessoais das partes.",
    },
    {
      date: `15/06/${timelineYear}`,
      title: closureType === "Acordo" ? "Acordo homologado" : "Desfecho processual",
      description:
        closureType === "Acordo"
          ? "Composição homologada conforme movimentações públicas agregadas."
          : "Encerramento com decisão registrada em publicações oficiais.",
    },
  ];

  return {
    id: item.id,
    similarity: item.similarity,
    resultLabel,
    resultColor: item.result_color,
    time: item.time,
    closureType,
    similarityReasons: [
      `Mesmo recorte de tribunal: ${tribunalLabel}.`,
      `Classe processual equivalente: ${actionLabel}.`,
      `Faixa de valor pública compatível: ${valueRange}.`,
      "Fase processual semelhante: audiência de conciliação.",
      "Perfil agregado das partes: pessoa jurídica versus pessoa física.",
    ],
    timeline,
    courtPatternSummary: `${judgeScope} com histórico agregado de incentivo à composição em casos similares nos últimos 24 meses.`,
    courtPatternBullets: [
      `Taxa pública de acordo em casos semelhantes: ${Math.max(42, successProbabilityValue - 9)}%.`,
      `Tempo médio até desfecho em casos equivalentes: ${item.time}.`,
      `Faixa média de resultado financeiro observada: ${valueRange}.`,
      "Preferência histórica: resolução consensual antes da instrução completa.",
    ],
    riskLevel,
    riskSummary: riskSummaryByLevel[riskLevel],
    riskDescription: riskDescriptionByLevel[riskLevel],
    recommendations: recommendationsByRisk[riskLevel],
    comparison: {
      similarity: item.similarity,
      successProbability: `${successProbabilityValue}%`,
      estimatedTime: item.time,
      primaryRecommendation: primaryRecommendationByRisk[riskLevel],
    },
    lgpdNotice: isDemoMode
      ? "Dados anonimizados em modo demo. Informações sintéticas com base em padrões públicos."
      : "Dados anonimizados e agregados de fontes públicas. Sem nomes, CPF/CNPJ, contatos ou dados sensíveis.",
  };
}

function resolveScenarioFromMetric(title: string): string | undefined {
  const key = normalizeSearchText(title);
  if (key.includes("acordo")) return "Cenário A: Acordo Imediato";
  if (key.includes("exito")) return "Cenário B: Julgamento Final";
  if (key.includes("tempo")) return "Cenário A: Acordo Imediato";
  if (key.includes("complex")) return "Cenário C: Estratégia Alternativa";
  return undefined;
}

function buildScenarioDetail(scenario: SimulationScenarioSource, isDemoMode: boolean): CardDetail {
  const titleKey = normalizeSearchText(scenario.title);
  const defaultNextStep = titleKey.includes("acordo")
    ? "Consolidar proposta objetiva e checklist de concessões para abrir negociação ainda antes da audiência."
    : titleKey.includes("julgamento")
      ? "Preparar memoriais, reforçar prova documental e mapear risco recursal por etapa."
      : "Executar plano de mediação com roteiro de argumentos e limite de concessão por rodada.";

  return {
    title: "Cenário",
    description: scenario.detail_summary || scenario.title,
    lines: [...scenario.data.map((item) => `${item.label}: ${item.val}`), scenario.footer],
    variant: "scenario",
    badgeLabel: scenario.detail_title || "Detalhes",
    recommendationTitle: scenario.next_step_title || "Próximo passo recomendado:",
    recommendationText: scenario.next_step_text || defaultNextStep,
    sourceNote: isDemoMode
      ? "Dados fictícios em modo demo para validação visual e de fluxo."
      : "Dados reais calculados pela IA a partir do processo do usuário e da base pública sincronizada.",
    targetTab: "simulacoes",
    targetScenarioTitle: scenario.title,
  };
}

function buildDashboardUrl(filters: DashboardFilters) {
  const params = new URLSearchParams();
  params.set("tribunal", filters.tribunal);
  params.set("juiz", filters.juiz);
  params.set("tipo_acao", filters.tipo_acao);
  params.set("faixa_valor", filters.faixa_valor);
  params.set("periodo", filters.periodo);
  return `/api/dashboard?${params.toString()}`;
}

async function parseJsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    throw await parseApiErrorResponse(res);
  }
  return (await res.json()) as T;
}

async function fetchDashboard(filters: DashboardFilters): Promise<DashboardData> {
  try {
    const res = await fetch(buildDashboardUrl(filters), { credentials: "include" });
    return await parseJsonOrThrow<DashboardData>(res);
  } catch (error) {
    throw mapNetworkError(error, "Não foi possível carregar o dashboard agora. Tente novamente.");
  }
}

async function fetchStrategicAlerts(status: "new" | "active" | "all" = "new", limit = 100): Promise<StrategicAlertListResponse> {
  try {
    const params = new URLSearchParams();
    params.set("status", status);
    params.set("limit", String(limit));
    const res = await fetch(`/api/strategic-alerts?${params.toString()}`, { credentials: "include" });
    return await parseJsonOrThrow<StrategicAlertListResponse>(res);
  } catch (error) {
    throw mapNetworkError(error, "Não foi possível carregar alertas estratégicos agora.");
  }
}

async function fetchUserCases(limit = 30): Promise<UserCaseListItem[]> {
  try {
    const params = new URLSearchParams();
    params.set("limit", String(limit));
    const res = await fetch(`/api/cases?${params.toString()}`, { credentials: "include" });
    return await parseJsonOrThrow<UserCaseListItem[]>(res);
  } catch (error) {
    throw mapNetworkError(error, "Não foi possível carregar os casos do usuário agora.");
  }
}

async function reprocessCaseAI(caseId: string): Promise<CaseAIStatusResponse> {
  try {
    const res = await fetch(`/api/cases/${caseId}/reprocess-ai`, {
      method: "POST",
      credentials: "include",
    });
    return await parseJsonOrThrow<CaseAIStatusResponse>(res);
  } catch (error) {
    throw mapNetworkError(error, "Não foi possível reprocessar este caso agora.");
  }
}

async function runStrategicScan(): Promise<void> {
  try {
    const res = await fetch("/api/strategic-alerts/scan", {
      method: "POST",
      credentials: "include",
    });
    await parseJsonOrThrow<Record<string, unknown>>(res);
  } catch (error) {
    throw mapNetworkError(error, "Não foi possível atualizar alertas estratégicos agora.");
  }
}

async function markStrategicAlert(alertId: string, action: "read" | "dismiss"): Promise<void> {
  try {
    const res = await fetch(`/api/strategic-alerts/${alertId}/${action}`, {
      method: "POST",
      credentials: "include",
    });
    await parseJsonOrThrow<Record<string, unknown>>(res);
  } catch (error) {
    throw mapNetworkError(error, "Não foi possível atualizar este alerta agora.");
  }
}

function getCaseAIStatusMeta(status: CaseAIStatus) {
  switch (status) {
    case "completed":
      return { label: "Concluída", badge: "border-emerald-500/40 bg-emerald-500/15 text-emerald-200" };
    case "processing":
      return { label: "Processando", badge: "border-sky-500/40 bg-sky-500/15 text-sky-200" };
    case "failed_retryable":
      return { label: "Falha com retry", badge: "border-amber-500/40 bg-amber-500/15 text-amber-200" };
    case "failed":
      return { label: "Falha", badge: "border-red-500/40 bg-red-500/15 text-red-200" };
    case "manual_review":
      return { label: "Revisão manual", badge: "border-orange-500/40 bg-orange-500/15 text-orange-200" };
    case "queued":
    default:
      return { label: "Na fila", badge: "border-slate-600 bg-slate-800/70 text-slate-200" };
  }
}

function isCaseAIInFlight(status: CaseAIStatus): boolean {
  return status === "queued" || status === "processing" || status === "failed_retryable";
}

function formatDateTimeLabel(value?: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function formatProbabilityPercent(value?: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  const normalized = value <= 1 ? value * 100 : value;
  return `${Math.round(normalized)}%`;
}

function estimateCaseAIProgressFallback(caseItem: UserCaseListItem): number {
  const attempts = Math.max(0, Number(caseItem.ai_attempts) || 0);
  switch (caseItem.ai_status) {
    case "queued":
      return Math.min(25, 8 + attempts * 4);
    case "processing":
      return Math.min(90, 35 + attempts * 12);
    case "failed_retryable":
      return Math.min(85, 40 + attempts * 9);
    case "completed":
    case "failed":
    case "manual_review":
    default:
      return 100;
  }
}

function resolveCaseAIProgress(caseItem: UserCaseListItem): number {
  const backendValue = caseItem.ai_progress_percent;
  if (typeof backendValue === "number" && Number.isFinite(backendValue)) {
    return Math.max(0, Math.min(100, Math.round(backendValue)));
  }
  return estimateCaseAIProgressFallback(caseItem);
}

function resolveCaseAIStageLabel(caseItem: UserCaseListItem): string {
  if (typeof caseItem.ai_stage_label === "string" && caseItem.ai_stage_label.trim()) {
    return caseItem.ai_stage_label.trim();
  }

  switch (caseItem.ai_stage) {
    case "extraction":
      return "Extração concluída.";
    case "analysis_ai":
      return "Análise IA em andamento.";
    case "cross_data":
      return "Cruzando dados.";
    case "publication":
      return "Publicando indicadores.";
    case "completed":
      return "Processamento concluído.";
    case "failed":
      return "Processamento interrompido.";
    case "queued":
      return "Na fila de processamento.";
    default:
      return "Processamento em andamento.";
  }
}

function resolveTabLabel(tab: DashboardTab): string {
  switch (tab) {
    case "visao-geral":
      return "Visão Geral";
    case "inteligencia":
      return "Inteligência Estratégica";
    case "simulacoes":
      return "Simulações Avançadas";
    case "alertas":
      return "Alertas Estratégicos";
    default:
      return "Dashboard";
  }
}

function parseExtractedClaimValue(rawClaimValue: unknown): { textValue: string; numericValue: number | null } {
  if (typeof rawClaimValue === "number" && Number.isFinite(rawClaimValue)) {
    return { textValue: String(rawClaimValue), numericValue: rawClaimValue };
  }
  if (typeof rawClaimValue === "string" && rawClaimValue.trim()) {
    const normalized = rawClaimValue.trim();
    const parsed = Number(normalized.replace(/\./g, "").replace(",", ".").replace(/[^\d.-]/g, ""));
    return {
      textValue: normalized,
      numericValue: Number.isFinite(parsed) ? parsed : null,
    };
  }
  return { textValue: "", numericValue: null };
}

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState<DashboardTab>("visao-geral");
  const [focusedSimulationScenario, setFocusedSimulationScenario] = useState<string | null>(null);
  const [isFiltering, setIsFiltering] = useState(false);
  const [draftFilters, setDraftFilters] = useState<DashboardFilters>(DEFAULT_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<DashboardFilters>(DEFAULT_FILTERS);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadForm, setUploadForm] = useState(EMPTY_UPLOAD_FORM);
  const [sourceForm, setSourceForm] = useState({
    name: "",
    base_url: "",
    tribunal: "",
  });
  const [currentPath, setLocation] = useLocation();
  const isDemoMode = currentPath === "/dashboard-demo";
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [dismissedAlerts, setDismissedAlerts] = useState<string[]>([]);
  const [selectedCardDetail, setSelectedCardDetail] = useState<CardDetail | null>(null);
  const [selectedSimilarProcess, setSelectedSimilarProcess] = useState<SimilarProcessDetail | null>(null);
  const [isStrategicRecommendationsModalOpen, setIsStrategicRecommendationsModalOpen] = useState(false);
  const hasTriggeredInitialStrategicScan = useRef(false);
  const seenStrategicAlertIds = useRef<Set<string>>(new Set());
  const casePollingBoostTimeoutRef = useRef<number | null>(null);
  const casesLifecycleSignatureRef = useRef<string>("");
  const [isCasePollingBoosted, setIsCasePollingBoosted] = useState(false);

  const activateCasePollingBoost = useCallback((durationMs = 2 * 60 * 1000) => {
    if (casePollingBoostTimeoutRef.current) {
      window.clearTimeout(casePollingBoostTimeoutRef.current);
    }
    setIsCasePollingBoosted(true);
    casePollingBoostTimeoutRef.current = window.setTimeout(() => {
      setIsCasePollingBoosted(false);
      casePollingBoostTimeoutRef.current = null;
    }, durationMs);
  }, []);

  const refreshDashboardAndRelatedData = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["dashboard-data"] });
    queryClient.invalidateQueries({ queryKey: ["user-cases"] });
    queryClient.invalidateQueries({ queryKey: ["strategic-alerts"] });
    void queryClient.refetchQueries({ queryKey: ["dashboard-data"], type: "active" });
    void queryClient.refetchQueries({ queryKey: ["user-cases"], type: "active" });
    void queryClient.refetchQueries({ queryKey: ["strategic-alerts"], type: "active" });
  }, [queryClient]);

  const meQuery = useQuery({
    queryKey: ["auth-me"],
    queryFn: fetchMe,
    enabled: !isDemoMode,
    retry: false,
  });

  const dashboardQuery = useQuery({
    queryKey: ["dashboard-data", isDemoMode ? "demo" : "live", appliedFilters],
    queryFn: () => (isDemoMode ? Promise.resolve(buildMockDashboardData(appliedFilters)) : fetchDashboard(appliedFilters)),
    enabled: isDemoMode || meQuery.isSuccess,
    refetchInterval: isDemoMode ? false : isCasePollingBoosted ? 5000 : 15000,
    refetchIntervalInBackground: !isDemoMode,
    retry: false,
  });

  const strategicAlertsQuery = useQuery({
    queryKey: ["strategic-alerts", "new"],
    queryFn: () => fetchStrategicAlerts("new", 100),
    enabled: !isDemoMode && meQuery.isSuccess,
    retry: false,
    refetchInterval: isCasePollingBoosted ? 10000 : 60000,
    refetchIntervalInBackground: true,
  });

  const userCasesQuery = useQuery({
    queryKey: ["user-cases"],
    queryFn: () => fetchUserCases(30),
    enabled: !isDemoMode && meQuery.isSuccess,
    retry: false,
    refetchInterval: isCasePollingBoosted ? 5000 : 20000,
    refetchIntervalInBackground: true,
  });

  const strategicScanMutation = useMutation({
    mutationFn: runStrategicScan,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["strategic-alerts"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-data"] });
    },
  });

  const readStrategicAlertMutation = useMutation({
    mutationFn: (alertId: string) => markStrategicAlert(alertId, "read"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["strategic-alerts"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-data"] });
    },
  });

  const dismissStrategicAlertMutation = useMutation({
    mutationFn: (alertId: string) => markStrategicAlert(alertId, "dismiss"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["strategic-alerts"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-data"] });
    },
  });

  const reprocessCaseMutation = useMutation<CaseAIStatusResponse, Error, string>({
    mutationFn: (caseId: string) => reprocessCaseAI(caseId),
    onSuccess: (payload) => {
      queryClient.setQueryData<UserCaseListItem[]>(["user-cases"], (previous) =>
        (previous ?? []).map((item) =>
          item.case_id === payload.case_id
            ? {
                ...item,
                ai_status: payload.ai_status,
                ai_attempts: payload.ai_attempts,
                ai_stage: payload.ai_stage ?? item.ai_stage ?? "extraction",
                ai_stage_label: payload.ai_stage_label ?? item.ai_stage_label ?? null,
                ai_progress_percent: payload.ai_progress_percent ?? item.ai_progress_percent ?? null,
                ai_stage_updated_at: payload.ai_stage_updated_at ?? item.ai_stage_updated_at ?? null,
                ai_next_retry_at: payload.ai_next_retry_at ?? null,
                ai_processed_at: payload.ai_processed_at ?? null,
                ai_last_error: payload.ai_last_error ?? null,
              }
            : item,
        ),
      );
      activateCasePollingBoost();

      toast({
        title: "Reprocessamento iniciado",
        description: `Caso reenviado para a fila de IA (${getCaseAIStatusMeta(payload.ai_status).label.toLowerCase()}).`,
      });
      refreshDashboardAndRelatedData();
    },
    onError: (error: Error) => {
      toast({
        title: "Falha ao reprocessar",
        description: error.message,
      });
    },
  });

  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      queryClient.clear();
      setLocation("/auth?tab=login", { replace: true });
    },
    onError: (error) => {
      toast({
        title: "Falha ao encerrar sessão",
        description: error instanceof Error ? error.message : "Erro desconhecido",
      });
    },
  });

  const applyExtractedUploadForm = useCallback((extracted: UploadCaseResponse["extracted"] | undefined | null, processNumberFromPayload?: string) => {
    const safeExtracted = extracted || {};
    const { textValue: extractedClaimValue } = parseExtractedClaimValue((safeExtracted as { claim_value?: unknown }).claim_value);
    setUploadForm((previous) => ({
      process_number: safeExtracted.process_number || processNumberFromPayload || previous.process_number,
      tribunal: safeExtracted.tribunal || previous.tribunal,
      judge: safeExtracted.judge || previous.judge,
      action_type: safeExtracted.action_type || previous.action_type,
      claim_value: extractedClaimValue || previous.claim_value,
    }));
  }, []);

  const extractPreviewMutation = useMutation({
    mutationFn: async (selectedFile: File): Promise<CaseExtractionPreviewResponse> => {
      const formData = new FormData();
      formData.append("file", selectedFile);

      try {
        const res = await fetch("/api/cases/extract", {
          method: "POST",
          body: formData,
          credentials: "include",
        });
        return await parseJsonOrThrow<CaseExtractionPreviewResponse>(res);
      } catch (error) {
        throw mapNetworkError(error, "Não foi possível extrair os dados automáticos do processo.");
      }
    },
    onSuccess: (payload) => {
      applyExtractedUploadForm(payload.extracted, payload.process_number);
    },
    onError: (error) => {
      toast({
        title: "Falha na extração automática",
        description: error instanceof Error ? error.message : "Erro desconhecido",
      });
    },
  });

  const handleUploadFileChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const selectedFile = event.target.files?.[0] ?? null;
      setUploadFile(selectedFile);
      setUploadForm({ ...EMPTY_UPLOAD_FORM });

      if (!selectedFile) return;
      extractPreviewMutation.mutate(selectedFile);
    },
    [extractPreviewMutation],
  );

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

      try {
        const res = await fetch("/api/cases/upload", {
          method: "POST",
          body: formData,
          credentials: "include",
        });
        return await parseJsonOrThrow<UploadCaseResponse>(res);
      } catch (error) {
        throw mapNetworkError(error, "Não foi possível enviar este processo. Tente novamente.");
      }
    },
    onSuccess: (payload) => {
      const extracted = payload.extracted || {};
      const extractedProcess = extracted.process_number || payload.process_number || "";
      const { numericValue: extractedClaimValueNumeric } = parseExtractedClaimValue((extracted as { claim_value?: unknown }).claim_value);

      toast({
        title: "Processo enviado",
        description:
          payload.ai_status === "completed"
            ? extractedProcess
              ? `Processo ${extractedProcess} analisado com sucesso.`
              : "Documento analisado com sucesso."
            : payload.ai_status === "failed" || payload.ai_status === "manual_review"
              ? "Documento salvo, mas a análise por IA falhou. Use o reprocessamento para tentar novamente."
              : extractedProcess
                ? `Processo ${extractedProcess} recebido e enviado para análise por IA.`
                : "Documento recebido e enviado para análise por IA.",
      });
      setUploadFile(null);
      applyExtractedUploadForm(extracted, payload.process_number);
      queryClient.setQueryData<UserCaseListItem[]>(["user-cases"], (previous) => {
        const optimisticItem: UserCaseListItem = {
          case_id: payload.case_id,
          process_number: extractedProcess || payload.process_number,
          tribunal: extracted.tribunal ?? uploadForm.tribunal ?? null,
          judge: extracted.judge ?? uploadForm.judge ?? null,
          action_type: extracted.action_type ?? uploadForm.action_type ?? null,
          claim_value: extractedClaimValueNumeric,
          status: extracted.status ?? null,
          success_probability: null,
          settlement_probability: null,
          expected_decision_months: null,
          risk_score: null,
          complexity_score: null,
          ai_status: payload.ai_status,
          ai_attempts: payload.ai_attempts,
          ai_stage: payload.ai_stage ?? "extraction",
          ai_stage_label: payload.ai_stage_label ?? "Extração concluída, aguardando análise por IA.",
          ai_progress_percent: payload.ai_progress_percent ?? 25,
          ai_stage_updated_at: payload.ai_stage_updated_at ?? null,
          ai_next_retry_at: payload.ai_next_retry_at ?? null,
          ai_processed_at: null,
          ai_last_error: payload.ai_last_error ?? null,
          created_at: payload.created_at,
        };

        const deduped = (previous ?? []).filter((item) => item.case_id !== optimisticItem.case_id);
        return [optimisticItem, ...deduped].slice(0, 30);
      });
      activateCasePollingBoost();
      refreshDashboardAndRelatedData();
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
      try {
        const res = await fetch("/api/public-data/sync", {
          method: "POST",
          credentials: "include",
        });
        return await parseJsonOrThrow<Record<string, unknown>>(res);
      } catch (error) {
        throw mapNetworkError(error, "Não foi possível sincronizar as APIs públicas agora.");
      }
    },
    onSuccess: () => {
      toast({
        title: "Bases públicas sincronizadas",
        description: "Dados públicos atualizados no banco com sucesso.",
      });
      queryClient.invalidateQueries({ queryKey: ["dashboard-data"] });
    },
    onError: (error) => {
      toast({
        title: "Falha na sincronização",
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
        return await parseJsonOrThrow<Record<string, unknown>>(res);
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

  const handleApplyFilters = () => {
    setIsFiltering(true);
    setAppliedFilters(draftFilters);
    setTimeout(() => setIsFiltering(false), 400);
  };

  const baseDashboardData = dashboardQuery.data;

  const strategicAlertItems = strategicAlertsQuery.data?.items ?? [];
  const userCases = userCasesQuery.data ?? [];
  const dashboardData = useMemo(() => baseDashboardData, [baseDashboardData]);
  const processingProgress = useMemo(() => {
    if (isDemoMode || userCases.length === 0) {
      return null;
    }

    const orderedCases = [...userCases].sort((a, b) => {
      const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
      const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
      return bTime - aTime;
    });
    const inFlightCases = orderedCases.filter((item) => isCaseAIInFlight(item.ai_status));
    const referenceCase = inFlightCases[0] ?? orderedCases[0];
    if (!referenceCase) {
      return null;
    }

    const percent = resolveCaseAIProgress(referenceCase);
    const processLabel = referenceCase.process_number?.trim()
      ? referenceCase.process_number
      : `Caso ${referenceCase.case_id.slice(0, 8)}`;
    const tabLabel = resolveTabLabel(activeTab);
    const stageLabel = resolveCaseAIStageLabel(referenceCase);

    let tone: ProcessingProgressTone = "processing";
    let detail = `${stageLabel} ${inFlightCases.length} caso(s) aguardando conclusão da IA.`;
    if (inFlightCases.length === 0 && referenceCase.ai_status === "completed") {
      tone = "success";
      detail = `${stageLabel} Último caso concluído: ${processLabel}.`;
    } else if (inFlightCases.length === 0) {
      tone = "warning";
      detail = `${stageLabel} Último caso com revisão/falha: ${processLabel}.`;
    }

    return {
      percent,
      tone,
      title: `${tabLabel} · Processamento IA`,
      detail,
      inFlightCount: inFlightCases.length,
    };
  }, [activeTab, isDemoMode, userCases]);

  const strategicModalData = useMemo(() => {
    const scores = dashboardData?.visao_geral.scores || [];
    const resolveScore = (title: string, fallback: number) => scores.find((item) => item.title.toLowerCase() === title)?.value ?? fallback;
    const marketSuccess =
      dashboardData?.inteligencia.benchmark.find((item) => item.label.toLowerCase().includes("sucesso"))?.market || "64%";
    const criticalDeadlines = dashboardData?.visao_geral.critical_deadlines || [];

    return {
      successScore: resolveScore("confianca", 78),
      riskScore: resolveScore("risco", 68),
      agreementScore: resolveScore("acordo", 64),
      marketSuccess,
      agreementWindowDays: parseDayCount(criticalDeadlines[1]?.date, 15),
      riskWindowDays: parseDayCount(criticalDeadlines[0]?.date, 6),
      monitoringWindowDays: appliedFilters.periodo === "Últimos 3 meses" ? 90 : appliedFilters.periodo === "Últimos 12 meses" ? 180 : 120,
      judgeLabel: appliedFilters.juiz === "Todos os Juízes" ? "órgão julgador analisado" : appliedFilters.juiz,
      highlights: dashboardData?.visao_geral.insights.slice(0, 3) || [],
    };
  }, [appliedFilters.juiz, appliedFilters.periodo, dashboardData]);

  useEffect(() => {
    setDismissedAlerts([]);
  }, [dashboardData?.generated_at]);

  useEffect(() => {
    if (isDemoMode || !meQuery.isSuccess || hasTriggeredInitialStrategicScan.current) {
      return;
    }
    hasTriggeredInitialStrategicScan.current = true;
    strategicScanMutation.mutate();
  }, [isDemoMode, meQuery.isSuccess, strategicScanMutation]);

  useEffect(() => {
    if (isDemoMode || userCases.length === 0) {
      return;
    }
    if (userCases.some((item) => isCaseAIInFlight(item.ai_status))) {
      activateCasePollingBoost();
    }
  }, [activateCasePollingBoost, isDemoMode, userCases]);

  useEffect(() => {
    if (isDemoMode) {
      return;
    }
    const lifecycleSignature = userCases
      .map(
        (item) =>
          `${item.case_id}:${item.ai_status}:${item.ai_stage ?? ""}:${item.ai_progress_percent ?? ""}:${item.ai_processed_at ?? ""}:${item.ai_attempts}:${item.ai_last_error ?? ""}`,
      )
      .join("|");

    if (!lifecycleSignature) {
      casesLifecycleSignatureRef.current = "";
      return;
    }

    if (casesLifecycleSignatureRef.current && casesLifecycleSignatureRef.current !== lifecycleSignature) {
      queryClient.invalidateQueries({ queryKey: ["dashboard-data"] });
      queryClient.invalidateQueries({ queryKey: ["strategic-alerts"] });
      void queryClient.refetchQueries({ queryKey: ["dashboard-data"], type: "active" });
      void queryClient.refetchQueries({ queryKey: ["strategic-alerts"], type: "active" });
    }
    casesLifecycleSignatureRef.current = lifecycleSignature;
  }, [isDemoMode, queryClient, userCases]);

  useEffect(() => {
    if (isDemoMode || strategicAlertItems.length === 0) return;

    const currentIds = new Set(strategicAlertItems.map((item) => item.alert_id));
    if (seenStrategicAlertIds.current.size === 0) {
      seenStrategicAlertIds.current = currentIds;
      return;
    }

    const newItems = strategicAlertItems.filter((item) => !seenStrategicAlertIds.current.has(item.alert_id));
    if (newItems.length > 0) {
      toast({
        title: newItems.length === 1 ? "Novo alerta estratégico" : `${newItems.length} novos alertas estratégicos`,
        description: newItems[0].title,
      });
    }
    seenStrategicAlertIds.current = currentIds;
  }, [isDemoMode, strategicAlertItems, toast]);

  useEffect(() => {
    if (isDemoMode) {
      return;
    }
    if (!meQuery.error) {
      return;
    }
    if (isUnauthorizedError(meQuery.error)) {
      setLocation("/auth?tab=login", { replace: true });
      return;
    }
    toast({
      title: "Falha ao carregar sessão",
      description: meQuery.error instanceof Error ? meQuery.error.message : "Erro desconhecido",
    });
  }, [isDemoMode, meQuery.error, setLocation, toast]);

  useEffect(() => {
    if (isDemoMode) {
      return;
    }
    if (!dashboardQuery.error) {
      return;
    }
    if (isUnauthorizedError(dashboardQuery.error)) {
      setLocation("/auth?tab=login", { replace: true });
    }
  }, [dashboardQuery.error, isDemoMode, setLocation]);

  useEffect(() => {
    if (isDemoMode) {
      return;
    }
    if (!strategicAlertsQuery.error) {
      return;
    }
    if (isUnauthorizedError(strategicAlertsQuery.error)) {
      setLocation("/auth?tab=login", { replace: true });
    }
  }, [isDemoMode, setLocation, strategicAlertsQuery.error]);

  useEffect(() => {
    if (isDemoMode) {
      return;
    }
    if (!userCasesQuery.error) {
      return;
    }
    if (isUnauthorizedError(userCasesQuery.error)) {
      setLocation("/auth?tab=login", { replace: true });
    }
  }, [isDemoMode, setLocation, userCasesQuery.error]);

  useEffect(() => {
    return () => {
      if (casePollingBoostTimeoutRef.current) {
        window.clearTimeout(casePollingBoostTimeoutRef.current);
        casePollingBoostTimeoutRef.current = null;
      }
    };
  }, []);

  const userInitials = useMemo(() => {
    if (isDemoMode) {
      return "DM";
    }
    if (!meQuery.data?.full_name) {
      return "US";
    }
    return buildInitials(meQuery.data.full_name);
  }, [isDemoMode, meQuery.data?.full_name]);

  const radarData = useMemo(
    () =>
      (dashboardData?.visao_geral.radar || []).map((item) => ({
        subject: item.subject,
        A: item.current,
        B: item.cluster_avg,
      })),
    [dashboardData],
  );

  if (!isDemoMode && meQuery.isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-300">
        Carregando sessão...
      </div>
    );
  }

  const getAlertKey = (item: DashboardAlertItem) => (item.alert_id ? `id::${item.alert_id}` : `${item.type}::${item.title}::${item.time}`);
  const resolveAlertToastVariant = (type: string): "default" | "warning" | "destructive" => {
    const normalized = type.toLowerCase().trim();
    if (normalized === "critical" || normalized.includes("crit")) return "destructive";
    if (normalized === "warning" || normalized.includes("warn") || normalized.includes("aten")) return "warning";
    return "default";
  };

  const handleViewAlert = (item: DashboardAlertItem) => {
    toast({
      title: item.title,
      description: item.desc.length > 220 ? `${item.desc.slice(0, 220)}...` : item.desc,
      variant: resolveAlertToastVariant(item.type),
    });
  };

  const handleResolveAlert = (item: DashboardAlertItem) => {
    const key = getAlertKey(item);
    setDismissedAlerts((prev) => (prev.includes(key) ? prev : [...prev, key]));
    if (!isDemoMode && item.alert_id) {
      readStrategicAlertMutation.mutate(item.alert_id, {
        onSuccess: () => {
          toast({
            title: "Alerta marcado como resolvido",
            description: item.title,
            variant: "success",
          });
        },
        onError: (error) => {
          setDismissedAlerts((prev) => prev.filter((entry) => entry !== key));
          toast({
            title: "Falha ao atualizar alerta",
            description: error instanceof Error ? error.message : "Erro desconhecido",
          });
        },
      });
      return;
    }
    toast({
      title: "Alerta marcado como resolvido",
      description: item.title,
      variant: "success",
    });
  };

  const handleDismissAlert = (item: DashboardAlertItem) => {
    const key = getAlertKey(item);
    setDismissedAlerts((prev) => (prev.includes(key) ? prev : [...prev, key]));
    if (!isDemoMode && item.alert_id) {
      dismissStrategicAlertMutation.mutate(item.alert_id, {
        onSuccess: () => {
          toast({
            title: "Alerta dispensado",
            description: item.title,
            variant: "success",
          });
        },
        onError: (error) => {
          setDismissedAlerts((prev) => prev.filter((entry) => entry !== key));
          toast({
            title: "Falha ao dispensar alerta",
            description: error instanceof Error ? error.message : "Erro desconhecido",
          });
        },
      });
      return;
    }
    toast({
      title: "Alerta dispensado",
      description: item.title,
      variant: "success",
    });
  };

  const handlePrimaryAlertAction = (item: { type: string; title: string }) => {
    const normalized = item.type.toLowerCase();
    if (normalized === "opportunity" || normalized.includes("oppor") || normalized.includes("oportun")) {
      setActiveTab("simulacoes");
      toast({
        title: "Abrindo Simulações Avançadas",
        description: item.title,
      });
      return;
    }
    setActiveTab("inteligencia");
    toast({
      title: "Abrindo Inteligência Estratégica",
      description: item.title,
    });
  };

  const openCardDetail = (detail: CardDetail) => {
    const targetTab = detail.targetTab ?? activeTab;
    if (targetTab !== activeTab) {
      setActiveTab(targetTab);
    }
    setSelectedSimilarProcess(null);
    if (targetTab === "simulacoes") {
      setFocusedSimulationScenario(detail.targetScenarioTitle || null);
    } else {
      setFocusedSimulationScenario(null);
    }
    const dataSourceLine = isDemoMode
      ? "Fonte: modo DEMO com dados simulados."
      : "Fonte: dados reais do backend (IA + APIs externas sincronizadas, ex.: Jusbrasil).";
    const incomingLines = detail.lines || [];

    if (detail.variant === "scenario") {
      setSelectedCardDetail({
        ...detail,
        lines: incomingLines,
        sourceNote: detail.sourceNote || dataSourceLine,
      });
      return;
    }

    setSelectedCardDetail({
      ...detail,
      variant: "default",
      lines: incomingLines.includes(dataSourceLine) ? incomingLines : [...incomingLines, dataSourceLine],
      sourceNote: detail.sourceNote || dataSourceLine,
    });
  };

  const openSimilarProcessDetail = (item: SimilarProcessSource) => {
    if (activeTab !== "inteligencia") {
      setActiveTab("inteligencia");
    }
    setFocusedSimulationScenario(null);
    setSelectedCardDetail(null);
    setSelectedSimilarProcess(buildSimilarProcessDetail(item, appliedFilters, isDemoMode));
  };
  const isScenarioDetailModal = selectedCardDetail?.variant === "scenario";
  const alertTabBadgeCount = dashboardData?.alertas.details.length || 0;

  return (
    <div className="dashboard-shell min-h-screen flex flex-col bg-[radial-gradient(circle_at_8%_-10%,rgba(37,99,235,0.35),transparent_35%),radial-gradient(circle_at_90%_-20%,rgba(20,184,166,0.2),transparent_35%),linear-gradient(180deg,#070b1a_0%,#090f22_55%,#070c1a_100%)]">
      <header className="sticky top-0 z-50 border-b border-slate-800/80 bg-slate-950/85 px-4 py-3 backdrop-blur-xl lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(560px,760px)_minmax(0,1fr)] lg:items-center lg:gap-3 lg:px-5 lg:py-2 xl:h-16 xl:px-6 xl:py-0">
        <Link
          href="/"
          className="brand-logo-chip flex items-center gap-2 rounded-xl px-2.5 py-1.5 shadow-sm transition-colors xl:justify-self-start"
        >
          <Scale className="brand-logo-icon h-6 w-6" />
          <span className="brand-logo-title text-xl font-bold tracking-tight">LexScale</span>
        </Link>

        <div className="mx-auto mt-3 w-full max-w-[840px] rounded-xl border border-slate-800 bg-slate-900/80 p-1 lg:mt-0 lg:w-full lg:max-w-[760px] lg:justify-self-center">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <TabButton active={activeTab === "visao-geral"} onClick={() => setActiveTab("visao-geral")} icon={<LayoutDashboard size={16} />} text="Visão Geral" />
            <TabButton active={activeTab === "inteligencia"} onClick={() => setActiveTab("inteligencia")} icon={<BrainCircuit size={16} />} text="Inteligência Estratégica" />
            <TabButton active={activeTab === "simulacoes"} onClick={() => setActiveTab("simulacoes")} icon={<ActivitySquare size={16} />} text="Simulações Avançadas" />
            <TabButton
              active={activeTab === "alertas"}
              onClick={() => setActiveTab("alertas")}
              icon={<BellRing size={16} />}
              text="Alertas Estratégicos"
              badgeCount={alertTabBadgeCount}
            />
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-center gap-2 sm:gap-3 lg:mt-0 lg:justify-end lg:justify-self-end">
          <div className="hidden items-center gap-2 text-sm text-slate-300 xl:flex">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            {dashboardData?.updated_label || "Atualizando..."}
          </div>
          {processingProgress ? (
            <div className="hidden items-center gap-2 rounded-full border border-cyan-400/30 bg-cyan-500/10 px-3 py-1 text-xs font-bold text-cyan-200 xl:flex">
              <ActivitySquare size={12} />
              IA {processingProgress.percent}%
            </div>
          ) : null}
          {isDemoMode ? (
            <>
              <span className="rounded-full border border-cyan-400/40 bg-cyan-500/15 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-200">
                Modo Demo
              </span>
              <Button
                variant="outline"
                size="sm"
                className="border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-200 dark:hover:bg-slate-800"
                onClick={() => setLocation("/auth?tab=login")}
              >
                Fazer Login
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                size="sm"
                className="border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-200 dark:hover:bg-slate-800"
                onClick={() => setLocation("/profile")}
              >
                Perfil
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-200 dark:hover:bg-slate-800"
                onClick={() => logoutMutation.mutate()}
                disabled={logoutMutation.isPending}
              >
                {logoutMutation.isPending ? "Saindo..." : "Sair"}
              </Button>
              <Button variant="ghost" size="icon" className="rounded-full" onClick={() => setLocation("/profile")}>
                <div className="w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold text-sm">{userInitials}</div>
              </Button>
            </>
          )}
        </div>
      </header>

      <main className={`flex-1 p-6 max-w-[1400px] mx-auto w-full transition-opacity duration-300 ${isFiltering ? "opacity-50 pointer-events-none" : "opacity-100"}`}>
        {isDemoMode ? (
          <section className={`${PANEL_SOFT_CLASS} p-4 mb-6`}>
            <p className="text-sm text-slate-300">
              Dashboard de demonstração com dados fictícios. Recursos de upload e integrações externas estão disponíveis apenas para contas autenticadas.
            </p>
          </section>
        ) : (
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
              {syncMutation.isPending ? "Sincronizando..." : "Sincronizar APIs Públicas"}
            </Button>
          </div>

          <div className="grid md:grid-cols-6 gap-3 items-end">
            <div className="md:col-span-2">
              <label className="text-xs font-semibold text-slate-400 uppercase">Arquivo do processo</label>
              <input
                type="file"
                className="mt-1 block w-full text-sm text-slate-300 file:mr-3 file:py-2 file:px-3 file:rounded-md file:border file:border-slate-700 file:bg-slate-900 file:text-cyan-200 hover:file:bg-slate-800"
                onChange={handleUploadFileChange}
                disabled={extractPreviewMutation.isPending || uploadMutation.isPending}
              />
              {extractPreviewMutation.isPending ? <p className="mt-1 text-[11px] text-cyan-300">Extraindo campos automaticamente...</p> : null}
            </div>
            <InputField label="Número do processo" value={uploadForm.process_number} onChange={(value) => setUploadForm((s) => ({ ...s, process_number: value }))} />
            <InputField label="Tribunal" value={uploadForm.tribunal} onChange={(value) => setUploadForm((s) => ({ ...s, tribunal: value }))} />
            <InputField label="Juiz" value={uploadForm.judge} onChange={(value) => setUploadForm((s) => ({ ...s, judge: value }))} />
            <InputField label="Tipo de ação" value={uploadForm.action_type} onChange={(value) => setUploadForm((s) => ({ ...s, action_type: value }))} />
          </div>
          <div className="grid md:grid-cols-6 gap-3 items-end mt-3">
            <InputField label="Valor causa (R$)" value={uploadForm.claim_value} onChange={(value) => setUploadForm((s) => ({ ...s, claim_value: value }))} />
            <div className="md:col-span-5 flex justify-end">
              <Button
                onClick={() => uploadMutation.mutate()}
                disabled={uploadMutation.isPending || extractPreviewMutation.isPending || !uploadFile}
                className="bg-cyan-500 hover:bg-cyan-400 text-slate-950 gap-2 h-[38px] px-6 font-bold"
              >
                <Upload size={16} />
                {extractPreviewMutation.isPending ? "Extraindo..." : uploadMutation.isPending ? "Enviando..." : "Enviar para Analise"}
              </Button>
            </div>
          </div>

          <div className="mt-5 pt-4 border-t border-slate-800">
            <p className="text-xs font-semibold text-slate-400 uppercase mb-3">Cadastro de fonte pública</p>
            <div className="grid md:grid-cols-6 gap-3 items-end">
              <InputField label="Nome da fonte" value={sourceForm.name} onChange={(value) => setSourceForm((s) => ({ ...s, name: value }))} />
              <div className="md:col-span-3">
                <InputField label="URL da API pública" value={sourceForm.base_url} onChange={(value) => setSourceForm((s) => ({ ...s, base_url: value }))} />
              </div>
              <InputField label="Tribunal (opcional)" value={sourceForm.tribunal} onChange={(value) => setSourceForm((s) => ({ ...s, tribunal: value }))} />
              <div className="flex justify-end">
                <Button onClick={() => sourceMutation.mutate()} disabled={sourceMutation.isPending} variant="outline" className="h-[38px] gap-2 border-slate-700 bg-slate-900/50 text-slate-100 hover:bg-slate-800">
                  {sourceMutation.isPending ? "Salvando..." : "Salvar Fonte"}
                </Button>
              </div>
            </div>
          </div>

          <div className="mt-5 border-t border-slate-800 pt-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-xs font-semibold uppercase text-slate-400">Análises AI dos seus casos</p>
              {isCasePollingBoosted ? (
                <span className="rounded-full border border-cyan-400/40 bg-cyan-500/15 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-cyan-200">
                  Monitoramento intensivo ativo
                </span>
              ) : null}
            </div>
            {userCasesQuery.isLoading ? (
              <div className="rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-5 text-sm text-slate-300">Carregando status das análises...</div>
            ) : userCasesQuery.isError ? (
              <div className="rounded-xl border border-red-500/30 bg-red-950/30 px-4 py-5 text-sm text-red-200">
                Falha ao carregar casos: {userCasesQuery.error instanceof Error ? userCasesQuery.error.message : "erro desconhecido"}
              </div>
            ) : userCases.length === 0 ? (
              <div className="rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-5 text-sm text-slate-300">Nenhum caso enviado ainda.</div>
            ) : (
              <div className="space-y-2">
                {userCases.slice(0, 8).map((item) => {
                  const statusMeta = getCaseAIStatusMeta(item.ai_status);
                  const createdAtLabel = formatDateTimeLabel(item.created_at);
                  const processedAtLabel = formatDateTimeLabel(item.ai_processed_at);
                  const retryAtLabel = formatDateTimeLabel(item.ai_next_retry_at);
                  const stageProgress = resolveCaseAIProgress(item);
                  const stageLabel = resolveCaseAIStageLabel(item);
                  const canReprocess = item.ai_status === "failed" || item.ai_status === "manual_review" || item.ai_status === "failed_retryable";
                  const isReprocessingThisCase = reprocessCaseMutation.isPending && reprocessCaseMutation.variables === item.case_id;
                  const processLabel = item.process_number?.trim() ? item.process_number : `Caso ${item.case_id.slice(0, 8)}`;

                  return (
                    <div key={item.case_id} className="rounded-xl border border-slate-800 bg-slate-900/45 px-4 py-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-bold text-slate-100">{processLabel}</p>
                          <p className="text-[11px] text-slate-400">
                            {createdAtLabel ? `Enviado em ${createdAtLabel}` : "Data de envio indisponível"}
                            {processedAtLabel ? ` • Último processamento: ${processedAtLabel}` : ""}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${statusMeta.badge}`}>
                            {statusMeta.label}
                          </span>
                          {canReprocess ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 border-slate-700 bg-slate-900/60 px-3 text-[11px] font-bold text-slate-100 hover:bg-slate-800"
                              disabled={isReprocessingThisCase}
                              onClick={() => reprocessCaseMutation.mutate(item.case_id)}
                            >
                              {isReprocessingThisCase ? "Reprocessando..." : "Reprocessar AI"}
                            </Button>
                          ) : null}
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-300">
                        <span className="rounded-md border border-slate-700 bg-slate-800/60 px-2 py-0.5">Êxito: {formatProbabilityPercent(item.success_probability)}</span>
                        <span className="rounded-md border border-slate-700 bg-slate-800/60 px-2 py-0.5">Acordo: {formatProbabilityPercent(item.settlement_probability)}</span>
                        <span className="rounded-md border border-slate-700 bg-slate-800/60 px-2 py-0.5">
                          Risco: {typeof item.risk_score === "number" && Number.isFinite(item.risk_score) ? `${Math.round(item.risk_score)} / 100` : "--"}
                        </span>
                        <span className="rounded-md border border-slate-700 bg-slate-800/60 px-2 py-0.5">
                          Tentativas IA: {typeof item.ai_attempts === "number" ? item.ai_attempts : 0}
                        </span>
                        <span className="rounded-md border border-cyan-500/35 bg-cyan-500/10 px-2 py-0.5 text-cyan-200">
                          Progresso IA: {stageProgress}%
                        </span>
                      </div>
                      <p className="mt-2 text-[11px] text-slate-300">{stageLabel}</p>
                      {retryAtLabel && item.ai_status === "failed_retryable" ? (
                        <p className="mt-2 text-[11px] text-amber-200">Nova tentativa automática prevista para {retryAtLabel}.</p>
                      ) : null}
                      {item.ai_last_error ? <p className="mt-2 text-[11px] text-red-200">Último erro: {item.ai_last_error}</p> : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          </section>
        )}

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
            label="Tipo de Ação"
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
            label="Período"
            value={draftFilters.periodo}
            options={FILTER_OPTIONS.periodo}
            onChange={(value) => setDraftFilters((prev) => ({ ...prev, periodo: value }))}
          />
          <Button onClick={handleApplyFilters} className="bg-blue-600 hover:bg-blue-500 text-white gap-2 h-[38px] px-6">
            <CheckSquare size={16} /> Aplicar Filtros
          </Button>
        </div>

        {processingProgress ? (
          <ProcessingProgressBanner
            percent={processingProgress.percent}
            title={processingProgress.title}
            detail={processingProgress.detail}
            tone={processingProgress.tone}
            isInFlight={processingProgress.inFlightCount > 0}
          />
        ) : null}

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
                onOpenStrategicRecommendations={() => setIsStrategicRecommendationsModalOpen(true)}
                onOpenCardDetail={openCardDetail}
              />
            )}
            {activeTab === "inteligencia" && (
              <InteligenciaView data={dashboardData} onOpenCardDetail={openCardDetail} onOpenSimilarProcess={openSimilarProcessDetail} />
            )}
            {activeTab === "simulacoes" && (
              <SimulacoesView
                data={dashboardData}
                onOpenCardDetail={openCardDetail}
                focusedScenarioTitle={focusedSimulationScenario}
                isDemoMode={isDemoMode}
              />
            )}
            {activeTab === "alertas" && (
              <AlertasView
                data={dashboardData}
                dismissedAlerts={dismissedAlerts}
                getAlertKey={getAlertKey}
                onViewAlert={handleViewAlert}
                onResolveAlert={handleResolveAlert}
                onDismissAlert={handleDismissAlert}
                onPrimaryAlertAction={handlePrimaryAlertAction}
                onOpenCardDetail={openCardDetail}
              />
            )}
          </>
        )}
      </main>
      <Dialog open={isStrategicRecommendationsModalOpen} onOpenChange={setIsStrategicRecommendationsModalOpen}>
        <DialogContent className="max-w-3xl max-h-[88vh] overflow-y-auto border-slate-200 bg-slate-50 text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100">
          <div className="space-y-6">
            <DialogHeader className="border-b border-slate-200 pb-4 dark:border-slate-800">
              <DialogTitle className="flex items-center gap-2 text-2xl font-black">
                <BrainCircuit className="h-6 w-6 text-slate-900 dark:text-slate-100" />
                Insights Narrativos por IA
              </DialogTitle>
              <DialogDescription className="text-slate-600 dark:text-slate-300">
                Leitura estratégica consolidada para apoiar tomada de decisão imediata.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 text-base leading-relaxed">
              <p>
                <strong>Análise Estratégica:</strong> O processo apresenta uma <strong>probabilidade de êxito de {strategicModalData.successScore}%</strong>,
                situando-se acima da média do mercado ({strategicModalData.marketSuccess}) para casos similares. O desempenho é influenciado pelo histórico do{" "}
                {strategicModalData.judgeLabel} em ações deste perfil.
              </p>
              <p>
                <strong>Cenário de Risco:</strong> O score de risco de <strong>{strategicModalData.riskScore} pontos</strong> indica atenção necessária.
                Casos similares com este perfil costumam demandar ajustes técnicos para evitar extensão de prazo.
              </p>
              <p>
                <strong>Oportunidade de Acordo:</strong> A probabilidade de acordo de <strong>{strategicModalData.agreementScore}%</strong> sugere janela
                estratégica para negociação antes da segunda audiência.
              </p>
            </div>

            {strategicModalData.highlights.length > 0 ? (
              <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900/60">
                <h4 className="text-sm font-bold uppercase tracking-wide text-slate-600 dark:text-slate-300">Sinais observados no recorte atual</h4>
                <div className="space-y-2">
                  {strategicModalData.highlights.map((insight, idx) => (
                    <p key={idx} className="text-sm text-slate-700 dark:text-slate-200">
                      <strong>{insight.title}:</strong> {insight.text}
                    </p>
                  ))}
                </div>
              </section>
            ) : null}

            <section className="space-y-3">
              <h4 className="text-xl font-black">Recomendações Estratégicas</h4>
              <ul className="space-y-3 text-base">
                <li>
                  <strong>Imediata:</strong> Considerar proposta de acordo antes da audiência de conciliação (janela ideal nos próximos{" "}
                  {strategicModalData.agreementWindowDays} dias).
                </li>
                <li>
                  <strong>Curto prazo:</strong> Reforçar argumentação técnica nos pontos de maior complexidade e blindar os prazos dos próximos{" "}
                  {strategicModalData.riskWindowDays} dias.
                </li>
                <li>
                  <strong>Monitoramento:</strong> Acompanhar mudanças no comportamento decisório do juiz (janela de {strategicModalData.monitoringWindowDays}{" "}
                  dias).
                </li>
              </ul>
            </section>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={selectedCardDetail !== null || selectedSimilarProcess !== null}
        onOpenChange={(open) => {
          if (open) return;
          setSelectedCardDetail(null);
          setSelectedSimilarProcess(null);
        }}
      >
        <DialogContent
          className={
            selectedSimilarProcess
              ? "max-w-5xl max-h-[90vh] overflow-y-auto border-slate-200 bg-slate-50 text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              : isScenarioDetailModal
                ? "max-w-4xl border-slate-200 bg-slate-50 text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 [&>button]:right-4 [&>button]:top-4 [&>button]:h-8 [&>button]:w-8 [&>button]:rounded-xl [&>button]:bg-slate-200 [&>button]:text-slate-700 [&>button]:opacity-100 [&>button]:hover:bg-slate-300 dark:[&>button]:bg-slate-800 dark:[&>button]:text-slate-200 dark:[&>button]:hover:bg-slate-700"
                : "max-w-2xl border-slate-700 bg-slate-950 text-slate-100"
          }
        >
          {selectedSimilarProcess ? (
            <SimilarProcessDetailContent detail={selectedSimilarProcess} />
          ) : isScenarioDetailModal ? (
            <div className="space-y-5">
              <DialogHeader className="border-b border-slate-200 pb-4 dark:border-slate-800">
                <DialogTitle className="text-3xl font-black text-slate-900 dark:text-slate-100">{selectedCardDetail?.title || "Cenário"}</DialogTitle>
                {selectedCardDetail?.description ? <DialogDescription className="text-base text-slate-500 dark:text-slate-400">{selectedCardDetail.description}</DialogDescription> : null}
              </DialogHeader>
              <span className="inline-flex rounded-full bg-blue-100 px-4 py-1.5 text-sm font-bold text-blue-700 dark:bg-blue-500/20 dark:text-blue-200">{selectedCardDetail?.badgeLabel || "Detalhes"}</span>
              <div className="rounded-xl border border-slate-200 bg-slate-100 p-5 dark:border-slate-800 dark:bg-slate-900/60">
                <p className="mb-2 text-[28px] font-black leading-none text-slate-700 dark:text-slate-100">{selectedCardDetail?.recommendationTitle || "Próximo passo recomendado:"}</p>
                <p className="text-[19px] leading-relaxed text-slate-600 dark:text-slate-300">{selectedCardDetail?.recommendationText || ""}</p>
              </div>
              {selectedCardDetail?.sourceNote ? <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{selectedCardDetail.sourceNote}</p> : null}
            </div>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle className="text-slate-100">{selectedCardDetail?.title || "Detalhes do card"}</DialogTitle>
                <DialogDescription className="text-slate-300">{selectedCardDetail?.description || ""}</DialogDescription>
              </DialogHeader>
              <div className="space-y-2 rounded-lg border border-slate-800 bg-slate-900/60 p-4">
                {(selectedCardDetail?.lines || []).map((line, index) => (
                  <p key={index} className="text-sm text-slate-200 leading-relaxed">
                    {line}
                  </p>
                ))}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function VisaoGeralView({
  data,
  radarData,
  onOpenStrategicRecommendations,
  onOpenCardDetail,
}: {
  data: DashboardData;
  radarData: Array<{ subject: string; A: number; B: number }>;
  onOpenStrategicRecommendations: () => void;
  onOpenCardDetail: (detail: CardDetail) => void;
}) {
  const weeklyActivity = data.visao_geral.weekly_activity;
  const bestWeekDay = weeklyActivity.length
    ? weeklyActivity.reduce((best, item) => (item.value > best.value ? item : best), weeklyActivity[0])
    : { name: "-", value: 0 };
  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        {data.visao_geral.stats.slice(0, 3).map((item, idx) => (
          <MetricCard
            key={idx}
            {...item}
            onClick={() =>
              onOpenCardDetail({
                title: item.title,
                description: item.subtitle,
                lines: [
                  `Valor atual: ${item.value}`,
                  `Fonte: ${item.footer}`,
                  ...(item.updated ? [`Atualização: ${item.updated}`] : []),
                  ...(item.warning ? [`Atenção: `] : []),
                ],
                targetTab: "simulacoes",
                targetScenarioTitle: resolveScenarioFromMetric(item.title),
              })
            }
          />
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className={`${PANEL_CLASS} p-6 lg:col-span-2`}>
          <div className="flex items-center gap-2 mb-8">
            <BarChart3 className="text-cyan-300 w-5 h-5" />
            <h3 className="font-bold text-lg text-slate-100 uppercase tracking-tight">Scores do Processo</h3>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-12">
            {data.visao_geral.scores.map((score, idx) => {
              const scoreKey = score.title.toLowerCase();
              const targetTab: DashboardTab = scoreKey.includes("risco")
                ? "alertas"
                : scoreKey.includes("chance") || scoreKey.includes("complex")
                ? "simulacoes"
                : "inteligencia";
              return (
                <ScoreCardCircle
                  key={idx}
                  title={score.title}
                  value={score.value}
                  color={score.color}
                  icon={scoreKey.includes("risco") ? <AlertTriangle size={20} /> : scoreKey.includes("complex") ? <BrainCircuit size={20} /> : scoreKey.includes("acordo") ? <CheckSquare size={20} /> : <Trophy size={20} />}
                  onClick={() =>
                    onOpenCardDetail({
                      title: `Score: ${score.title}`,
                      description: `Leitura atual: ${score.value}/100`,
                      lines: [
                        `Pontuação: ${score.value}%`,
                        "Use este score em conjunto com os demais indicadores para priorização estratégica.",
                      ],
                      targetTab,
                      targetScenarioTitle: targetTab === "simulacoes" ? resolveScenarioFromMetric(score.title) : undefined,
                    })
                  }
                />
              );
            })}
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

            <div
              className="bg-blue-600 text-white p-8 rounded-2xl shadow-xl shadow-blue-200/20 relative overflow-hidden group cursor-pointer"
              onClick={() =>
                onOpenCardDetail({
                  title: "Insights Narrativos por IA",
                  description: "Resumo gerado a partir dos sinais atuais do processo.",
                  lines: data.visao_geral.insights.slice(0, 3).map((insight) => `${insight.title}: ${insight.text}`),
                  targetTab: "inteligencia",
                })
              }
            >
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
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpenStrategicRecommendations();
                  }}
                  className="w-full mt-8 border border-blue-200/80 bg-white text-blue-700 hover:bg-blue-50 dark:border-[#1b2c6b] dark:bg-[#000a33] dark:text-blue-100 dark:hover:bg-[#001042] font-bold h-12 gap-2"
                >
                  <FileText size={18} /> Recomendações Estratégicas
                </Button>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div
            className={`${PANEL_SOFT_CLASS} p-6 cursor-pointer transition-all hover:border-cyan-500/40`}
            onClick={() =>
              onOpenCardDetail({
                title: "Atividade Semanal",
                description: "Resumo dos volumes processados no periodo.",
                lines: [
                  `Pico da semana: ${bestWeekDay.name} (${bestWeekDay.value} registros)`,
                  `Total da semana: ${weeklyActivity.reduce((sum, item) => sum + item.value, 0)} registros`,
                ],
                targetTab: "alertas",
              })
            }
          >
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
              <Clock size={18} className="text-orange-400" /> Prazos Críticos
            </h3>
            <div className="space-y-4">
              {data.visao_geral.critical_deadlines.map((p, i) => (
                <button
                  key={i}
                  type="button"
                  className="w-full flex items-center justify-between p-3 rounded-lg bg-slate-900/75 border border-slate-800 hover:border-cyan-500/40 transition-colors text-left"
                  onClick={() =>
                    onOpenCardDetail({
                      title: `Prazo Critico: ${p.label}`,
                      description: `Janela estimada: ${p.date}`,
                      lines: [`Classificação atual: ${p.color.toUpperCase()}`, "Recomendação: priorize revisão e protocolo com antecedência."],
                      targetTab: "alertas",
                    })
                  }
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-1.5 h-8 rounded-full ${deadlineTone(p.color).line}`}></div>
                    <span className="text-xs font-bold text-slate-200">{p.label}</span>
                  </div>
                  <span className={`text-[10px] font-black uppercase px-2 py-1 rounded ${deadlineTone(p.color).badge}`}>{p.date}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function InteligenciaView({
  data,
  onOpenCardDetail,
  onOpenSimilarProcess,
}: {
  data: DashboardData;
  onOpenCardDetail: (detail: CardDetail) => void;
  onOpenSimilarProcess: (process: SimilarProcessSource) => void;
}) {
  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 space-y-8">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 bg-cyan-500/20 border border-cyan-400/40 rounded-lg flex items-center justify-center">
          <BrainCircuit className="text-white w-6 h-6" />
        </div>
        <h2 className="text-2xl font-bold text-slate-100">Inteligência Estratégica</h2>
      </div>

      <section>
        <div className="flex items-center gap-2 mb-6 text-slate-100">
          <FileText size={20} className="text-cyan-300" />
          <h3 className="font-bold uppercase tracking-tight text-sm">Processos Similares</h3>
        </div>
        <div className="grid md:grid-cols-3 gap-6">
          {data.inteligencia.similar_processes.map((item, idx) => (
            <SimilarProcessCard
              key={idx}
              id={item.id}
              similarity={item.similarity}
              result={item.result}
              resultColor={item.result_color}
              time={item.time}
              type={item.type}
              onClick={() => onOpenSimilarProcess(item)}
            />
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
                <HeatmapRow
                  key={idx}
                  name={row.name}
                  values={row.values}
                  columns={data.inteligencia.heatmap_columns}
                  onValueClick={(column: string, value: number) =>
                    onOpenCardDetail({
                      title: `Heatmap: ${row.name} x ${column}`,
                      description: "Comportamento histórico da corte para a combinação selecionada.",
                      lines: [
                        `Taxa observada: ${value}%`,
                        value >= 80 ? "Faixa alta de aderencia." : value >= 60 ? "Faixa moderada de aderencia." : "Faixa baixa de aderencia.",
                      ],
                      targetTab: "inteligencia",
                    })
                  }
                />
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex justify-center gap-6 mt-12">
          <HeatmapLegend color="bg-emerald-300 dark:bg-emerald-200" text="Alto (>80%)" />
          <HeatmapLegend color="bg-yellow-200 dark:bg-yellow-100" text="Medio-Alto (70-79%)" />
          <HeatmapLegend color="bg-orange-200 dark:bg-orange-100" text="Medio (60-69%)" />
          <HeatmapLegend color="bg-red-200 dark:bg-red-100" text="Baixo (<50%)" />
        </div>
      </section>

      <section className={`${PANEL_CLASS} p-8`}>
        <div className="flex items-center gap-2 mb-8 text-slate-100">
          <BarChart3 size={20} className="text-cyan-300" />
          <h3 className="font-bold uppercase tracking-tight text-sm">Benchmark vs Mercado</h3>
        </div>
        <div className="grid md:grid-cols-3 gap-12 text-center">
          {data.inteligencia.benchmark.map((item, idx) => (
            <BenchmarkStat
              key={idx}
              label={item.label}
              user={item.user}
              market={item.market}
              trend={item.trend}
              trendColor={item.trend_color}
              unit={item.unit || ""}
              onClick={() =>
                onOpenCardDetail({
                  title: `Benchmark: ${item.label}`,
                  description: "Comparativo entre escritorio e mercado.",
                  lines: [`Seu escritorio: ${item.user}${item.unit || ""}`, `Mercado: ${item.market}${item.unit || ""}`, `Diferencial: ${item.trend}`],
                  targetTab: "inteligencia",
                })
              }
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function SimulacoesView({
  data,
  onOpenCardDetail,
  focusedScenarioTitle,
  isDemoMode,
}: {
  data: DashboardData;
  onOpenCardDetail: (detail: CardDetail) => void;
  focusedScenarioTitle: string | null;
  isDemoMode: boolean;
}) {
  useEffect(() => {
    if (!focusedScenarioTitle) return;
    const targetId = `scenario-${focusedScenarioTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    const element = document.getElementById(targetId);
    if (!element) return;
    element.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusedScenarioTitle]);

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 space-y-8">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 bg-cyan-500/20 border border-cyan-400/40 rounded-lg flex items-center justify-center">
          <ActivitySquare className="text-cyan-200 w-6 h-6" />
        </div>
        <h2 className="text-2xl font-bold text-slate-100">Simulações Avançadas - Gêmeo Digital</h2>
      </div>

      <div
        className="bg-slate-900/85 text-white p-6 rounded-xl border border-slate-800 border-l-4 border-cyan-400 cursor-pointer hover:border-cyan-500/60 transition-colors"
        onClick={() =>
          onOpenCardDetail({
            title: "Gemeo Digital",
            description: "Resumo da leitura automatica do caso atual.",
            lines: [data.simulacoes.description],
            targetTab: "simulacoes",
            sourceNote: isDemoMode
              ? "Dados fictícios em modo demo para validação visual e de fluxo."
              : "Dados reais calculados pela IA a partir do processo do usuário e da base pública sincronizada.",
          })
        }
      >
        <div className="flex gap-4 items-start">
          <div className="bg-cyan-500/20 p-2 rounded shrink-0">
            <BrainCircuit size={20} className="text-cyan-300" />
          </div>
          <p className="text-sm text-slate-200 leading-relaxed">
            <strong>Gêmeo Digital:</strong> {data.simulacoes.description}
          </p>
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        {data.simulacoes.scenarios.map((scenario, idx) => (
          <ScenarioCard
            key={idx}
            id={`scenario-${scenario.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
            title={scenario.title}
            tag={scenario.tag}
            tagColor={scenario.tag_color}
            data={scenario.data}
            footer={scenario.footer}
            isFocused={focusedScenarioTitle === scenario.title}
            onClick={() => onOpenCardDetail(buildScenarioDetail(scenario, isDemoMode))}
          />
        ))}
      </div>

      <div className={`${PANEL_CLASS} p-8`}>
        <div className="flex items-center gap-2 mb-12 text-slate-100">
          <Scale size={20} className="text-cyan-300" />
          <h3 className="font-bold uppercase tracking-tight text-sm">Comparativo de Impacto</h3>
        </div>
        <div className="grid md:grid-cols-3 gap-12">
          {data.simulacoes.impact_metrics.map((metric, idx) => (
            <ImpactMetric
              key={idx}
              label={metric.label}
              icon={metric.icon}
              title={metric.title}
              val={metric.val}
              trend={metric.trend}
              trendBg={metric.trend_bg}
              onClick={() =>
                onOpenCardDetail({
                  title: `${metric.label} - ${metric.title}`,
                  description: metric.val,
                  lines: [`Tendência: `],
                  targetTab: "simulacoes",
                  targetScenarioTitle: normalizeSearchText(metric.title).includes("cenario a")
                    ? "Cenário A: Acordo Imediato"
                    : normalizeSearchText(metric.title).includes("cenario b")
                      ? "Cenário B: Julgamento Final"
                      : normalizeSearchText(metric.title).includes("cenario c")
                        ? "Cenário C: Estratégia Alternativa"
                        : undefined,
                })
              }
            />
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
  onOpenCardDetail,
}: {
  data: DashboardData & { alertas: { counts: DashboardData["alertas"]["counts"]; details: DashboardAlertItem[] } };
  dismissedAlerts: string[];
  getAlertKey: (item: DashboardAlertItem) => string;
  onViewAlert: (item: DashboardAlertItem) => void;
  onResolveAlert: (item: DashboardAlertItem) => void;
  onDismissAlert: (item: DashboardAlertItem) => void;
  onPrimaryAlertAction: (item: { type: string; title: string }) => void;
  onOpenCardDetail: (detail: CardDetail) => void;
}) {
  const resolveAlertCategory = (type: string): AlertCategory => {
    const normalized = type.toLowerCase().trim();
    if (normalized === "critical" || normalized.includes("crit")) return "critical";
    if (normalized === "warning" || normalized.includes("warn") || normalized.includes("aten")) return "warning";
    if (normalized === "opportunity" || normalized.includes("oppor") || normalized.includes("oportun")) return "opportunity";
    if (normalized === "info" || normalized.includes("info")) return "info";
    return "info";
  };

  const [activeCategoryFilter, setActiveCategoryFilter] = useState<AlertCategory | null>(null);
  const visibleAlerts = data.alertas.details.filter((item) => !dismissedAlerts.includes(getAlertKey(item)));
  const counters: Record<AlertCategory, number> = {
    critical: 0,
    warning: 0,
    info: 0,
    opportunity: 0,
  };
  visibleAlerts.forEach((item) => {
    counters[resolveAlertCategory(item.type)] += 1;
  });

  const countsToRender: Array<{ type: AlertCategory; label: string; color: string; count: number }> = [
    { type: "critical", label: "CRITICOS", color: "red", count: counters.critical },
    { type: "warning", label: "ATENCAO", color: "orange", count: counters.warning },
    { type: "info", label: "INFORMATIVOS", color: "blue", count: counters.info },
    { type: "opportunity", label: "OPORTUNIDADES", color: "emerald", count: counters.opportunity },
  ];

  const filteredAlerts = activeCategoryFilter
    ? visibleAlerts.filter((item) => resolveAlertCategory(item.type) === activeCategoryFilter)
    : visibleAlerts;

  const activeFilterLabel = countsToRender.find((item) => item.type === activeCategoryFilter)?.label ?? null;

  const toggleCategoryFilter = (category: AlertCategory) => {
    setActiveCategoryFilter((prev) => (prev === category ? null : category));
  };

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 space-y-8">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 bg-cyan-500/20 border border-cyan-400/40 rounded-lg flex items-center justify-center">
          <BellRing className="text-cyan-200 w-6 h-6" />
        </div>
        <h2 className="text-2xl font-bold text-slate-100">Alertas Estratégicos</h2>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
        {countsToRender.map((item) => (
          <AlertCountCard
            key={item.type}
            count={item.count}
            label={item.label}
            color={item.color}
            isActive={activeCategoryFilter === item.type}
            onClick={() => toggleCategoryFilter(item.type)}
          />
        ))}
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          {activeFilterLabel ? `Filtrando por ${activeFilterLabel}` : "Exibindo todos os alertas"}
        </p>
        {activeCategoryFilter && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setActiveCategoryFilter(null)}
            className="h-8 border-slate-700 bg-slate-900/40 text-slate-200 hover:bg-slate-800"
          >
            Limpar filtro
          </Button>
        )}
      </div>

      <div className="space-y-4">
        {filteredAlerts.length === 0 ? (
          <div className={`${PANEL_SOFT_CLASS} p-6 text-sm text-slate-300`}>
            {visibleAlerts.length === 0
              ? "Nenhum alerta pendente no momento."
              : `Não há alertas pendentes na categoria ${activeFilterLabel ?? "selecionada"}.`}
          </div>
        ) : (
          filteredAlerts.map((item, idx) => (
            <DetailedAlert
              key={`${getAlertKey(item)}::${idx}`}
              type={item.type}
              title={item.title}
              time={item.time}
              desc={item.desc}
              onCardClick={() =>
                onOpenCardDetail({
                  title: item.title,
                  description: item.time,
                  lines: [item.desc],
                  targetTab: "alertas",
                })
              }
              onView={() => onViewAlert(item)}
              onResolve={() => onResolveAlert(item)}
              onPrimaryAction={() => onPrimaryAlertAction(item)}
              onDismiss={() => onDismissAlert(item)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function SimilarProcessDetailContent({ detail }: { detail: SimilarProcessDetail }) {
  const processLabel = detail.id.startsWith("#") ? detail.id : `#${detail.id}`;
  const riskTone = resolveRiskTone(detail.riskLevel);
  const resultIsPositive = detail.resultColor !== "red";

  return (
    <div className="space-y-8 text-slate-900 dark:text-slate-100">
      <DialogHeader className="border-b border-slate-200 pb-4 dark:border-slate-800">
        <DialogTitle className="text-4xl font-black text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <FileText size={22} className="text-slate-900 dark:text-slate-100" /> Processo {processLabel}
        </DialogTitle>
        <DialogDescription className="text-sm text-slate-500 dark:text-slate-400">{detail.lgpdNotice}</DialogDescription>
      </DialogHeader>

      <section className="grid md:grid-cols-2 gap-4">
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900/70">
          <p className="text-xs font-bold uppercase text-slate-500 dark:text-slate-400 tracking-wider mb-2">Similaridade</p>
          <p className="text-4xl font-black text-slate-900 dark:text-slate-100">{detail.similarity}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900/70">
          <p className="text-xs font-bold uppercase text-slate-500 dark:text-slate-400 tracking-wider mb-2">Resultado</p>
          <p className={`text-3xl font-black flex items-center gap-2 ${resultIsPositive ? "text-emerald-600 dark:text-emerald-300" : "text-amber-600 dark:text-amber-300"}`}>
            {resultIsPositive ? <CheckSquare size={20} /> : <AlertTriangle size={20} />} {detail.resultLabel}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900/70">
          <p className="text-xs font-bold uppercase text-slate-500 dark:text-slate-400 tracking-wider mb-2">Tempo de tramitação</p>
          <p className="text-4xl font-black text-slate-900 dark:text-slate-100">{detail.time}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900/70">
          <p className="text-xs font-bold uppercase text-slate-500 dark:text-slate-400 tracking-wider mb-2">Tipo de desfecho</p>
          <p className="text-4xl font-black text-slate-900 dark:text-slate-100">{detail.closureType}</p>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-3xl font-black text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <CheckSquare size={20} /> Motivos de Similaridade
        </h3>
        <div className="rounded-xl border border-slate-200 bg-slate-100 p-6 dark:border-slate-800 dark:bg-slate-900/60">
          <p className="text-base text-slate-600 dark:text-slate-300 mb-4">Este processo foi identificado como similar com base em dados públicos anonimizados:</p>
          <ul className="list-disc space-y-2 pl-6 text-base text-slate-700 dark:text-slate-200">
            {detail.similarityReasons.map((reason, index) => (
              <li key={index}>{reason}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-3xl font-black text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <Clock size={20} /> Linha do Tempo
        </h3>
        <div className="relative pl-8">
          <div className="absolute left-[13px] top-2 bottom-2 w-px bg-slate-300 dark:bg-slate-700"></div>
          <div className="space-y-6">
            {detail.timeline.map((event, index) => (
              <div key={index} className="relative">
                <span className="absolute -left-[28px] top-2 h-4 w-4 rounded-full bg-sky-500 ring-4 ring-sky-100 dark:ring-sky-900/60"></span>
                <p className="text-sm font-bold text-slate-500 dark:text-slate-400">{event.date}</p>
                <div className="mt-2 rounded-xl border border-slate-200 bg-slate-100 p-5 dark:border-slate-800 dark:bg-slate-900/60">
                  <p className="text-2xl font-black text-slate-900 dark:text-slate-100 mb-2">{event.title}</p>
                  <p className="text-base text-slate-600 dark:text-slate-300">{event.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-3xl font-black text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <Database size={20} /> Padrão Decisório do Órgão Julgador
        </h3>
        <div className="rounded-xl border border-slate-200 bg-slate-100 p-6 dark:border-slate-800 dark:bg-slate-900/60">
          <p className="text-base text-slate-700 dark:text-slate-200 mb-3">{detail.courtPatternSummary}</p>
          <ul className="list-disc pl-6 space-y-2 text-base text-slate-700 dark:text-slate-200">
            {detail.courtPatternBullets.map((bullet, index) => (
              <li key={index}>{bullet}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-3xl font-black text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <AlertTriangle size={20} /> Riscos Detectados
        </h3>
        <div className={`rounded-xl border p-6 ${riskTone.container}`}>
          <div className="flex flex-wrap items-center gap-3 mb-3">
            <span className={`rounded-full px-4 py-1 text-xs font-black tracking-wider ${riskTone.badge}`}>{riskTone.label}</span>
            <p className="text-base font-semibold text-slate-700 dark:text-slate-200">{detail.riskSummary}</p>
          </div>
          <p className="text-base text-slate-600 dark:text-slate-300">{detail.riskDescription}</p>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-3xl font-black text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <Zap size={20} /> Recomendações Acionáveis
        </h3>
        <div className="space-y-3">
          {detail.recommendations.map((item, index) => (
            <div key={index} className="rounded-lg border border-slate-200 bg-slate-100 pl-3 dark:border-slate-800 dark:bg-slate-900/60">
              <div className="border-l-4 border-sky-500 dark:border-sky-400 pl-4 py-4 pr-4">
                <p className="text-base font-black text-slate-900 dark:text-slate-100">{item.title}</p>
                <p className="text-base text-slate-600 dark:text-slate-300">{item.description}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-3xl font-black text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <Scale size={20} /> Comparação com Seu Processo
        </h3>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900/70">
            <p className="text-xs font-bold uppercase text-slate-500 dark:text-slate-400 tracking-wider mb-2">Similaridade geral</p>
            <p className="text-4xl font-black text-slate-900 dark:text-slate-100">{detail.comparison.similarity}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900/70">
            <p className="text-xs font-bold uppercase text-slate-500 dark:text-slate-400 tracking-wider mb-2">Probabilidade de êxito similar</p>
            <p className="text-4xl font-black text-emerald-600 dark:text-emerald-300">{detail.comparison.successProbability}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900/70">
            <p className="text-xs font-bold uppercase text-slate-500 dark:text-slate-400 tracking-wider mb-2">Tempo estimado similar</p>
            <p className="text-4xl font-black text-slate-900 dark:text-slate-100">{detail.comparison.estimatedTime}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900/70">
            <p className="text-xs font-bold uppercase text-slate-500 dark:text-slate-400 tracking-wider mb-2">Recomendação principal</p>
            <p className="text-4xl font-black text-sky-600 dark:text-sky-300">{detail.comparison.primaryRecommendation}</p>
          </div>
        </div>
      </section>
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

function SimilarProcessCard({ id, similarity, result, time, type, resultColor = "emerald", onClick }: any) {
  const tone = resultTone(resultColor);
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${PANEL_SOFT_CLASS} w-full p-6 hover:border-cyan-500/40 transition-colors cursor-pointer group text-left`}
    >
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
    </button>
  );
}

function HeatmapRow({ name, values, columns, onValueClick }: any) {
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
          <button
            type="button"
            className={`h-12 w-full rounded flex items-center justify-center font-bold text-sm transition-all hover:scale-[1.02] ${getBg(v)}`}
            onClick={() => onValueClick(columns?.[i] || `Coluna ${i + 1}`, v)}
          >
            {v}%
          </button>
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

function BenchmarkStat({ label, user, market, trend, trendColor, unit = "", onClick }: any) {
  const tone = trendTone(trendColor);
  return (
    <button type="button" onClick={onClick} className="text-left md:text-center hover:opacity-95 transition-opacity">
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
    </button>
  );
}

function ScenarioCard({ id, title, tag, tagColor, data, footer, onClick, isFocused = false }: any) {
  const tone = tagTone(tagColor);
  return (
    <button
      id={id}
      type="button"
      onClick={onClick}
      className={`${PANEL_SOFT_CLASS} overflow-hidden flex flex-col h-full text-left hover:border-cyan-500/40 transition-colors ${
        isFocused ? "ring-2 ring-cyan-400/70 border-cyan-400/60 shadow-[0_0_0_1px_rgba(56,189,248,0.35)]" : ""
      }`}
    >
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
    </button>
  );
}

function iconFromKey(key: string) {
  if (key === "trophy") return <Trophy className="text-cyan-300" />;
  if (key === "shield") return <Shield className="text-emerald-300" />;
  if (key === "zap") return <Zap className="text-orange-300" />;
  return <BarChart3 className="text-cyan-300" />;
}

function ImpactMetric({ label, icon, title, val, trend, trendBg, onClick }: any) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${label}: ${title}. Clique para ver detalhes`}
      className="group w-full rounded-2xl border border-slate-800/80 bg-slate-900/45 p-6 text-center cursor-pointer transition-all duration-200 hover:-translate-y-1 hover:border-cyan-400/60 hover:bg-slate-900/70 hover:shadow-[0_14px_28px_rgba(34,211,238,0.14)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/80 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
    >
      <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-6">{label}</p>
      <div className="w-12 h-12 bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-4 transition-colors duration-200 group-hover:bg-slate-700">
        {iconFromKey(icon)}
      </div>
      <h4 className="text-xl font-black text-slate-100 mb-1">{title}</h4>
      <p className="text-xs text-slate-300 mb-4">{val}</p>
      <div className="mt-3 flex flex-col items-center gap-3">
        <div className={`inline-flex px-3 py-1 rounded text-[10px] font-black uppercase tracking-widest ${impactTrendTone(trendBg)} text-slate-100`}>{trend}</div>
        <div className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-cyan-300/85 transition-colors duration-200 group-hover:text-cyan-200">
          <Eye size={12} />
          Ver detalhes
        </div>
      </div>
    </button>
  );
}

function AlertCountCard({ count, label, color, isActive = false, onClick }: any) {
  const tone = countTone(color);
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${PANEL_SOFT_CLASS} w-full p-6 text-center transition-colors ${
        isActive ? "border-cyan-400/80 ring-2 ring-cyan-400/25" : "hover:border-cyan-500/40"
      }`}
    >
      <div className={`text-4xl font-black mb-2 ${tone}`}>{count}</div>
      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{label}</div>
    </button>
  );
}

function DetailedAlert({ type, title, time, desc, onCardClick, onView, onResolve, onPrimaryAction, onDismiss }: any) {
  const configs: any = {
    critical: { icon: <AlertTriangle size={20} />, color: "text-red-300", bg: "bg-red-500/15", border: "border-red-500/40", tag: "CRITICO", tagBg: "bg-red-600", line: "bg-red-500" },
    warning: { icon: <TrendingUp size={20} />, color: "text-orange-300", bg: "bg-orange-500/15", border: "border-orange-500/35", tag: "ATENCAO", tagBg: "bg-orange-500", line: "bg-orange-500" },
    opportunity: { icon: <Zap size={20} />, color: "text-emerald-300", bg: "bg-emerald-500/15", border: "border-emerald-500/35", tag: "OPORTUNIDADE", tagBg: "bg-emerald-500", line: "bg-emerald-500" },
    info: { icon: <BarChart3 size={20} />, color: "text-cyan-300", bg: "bg-cyan-500/15", border: "border-cyan-500/35", tag: "INFORMATIVO", tagBg: "bg-cyan-600", line: "bg-cyan-500" },
  };
  const c = configs[type] || configs.info;
  return (
    <div className={`rounded-xl border ${c.border} overflow-hidden shadow-sm flex bg-slate-900/65 cursor-pointer`} onClick={onCardClick}>
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
              <Button
                onClick={(event) => {
                  event.stopPropagation();
                  onView();
                }}
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-slate-500 hover:text-slate-300"
              >
                <Eye size={14} />
              </Button>
              <Button
                onClick={(event) => {
                  event.stopPropagation();
                  onResolve();
                }}
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-slate-500 hover:text-slate-300"
              >
                <CheckSquare size={14} />
              </Button>
            </div>
          </div>
          <h4 className="font-black text-slate-100 mb-2">{title}</h4>
          <p className="text-xs text-slate-300 leading-relaxed mb-6">{desc}</p>
          <div className="flex gap-3">
            <Button
              onClick={(event) => {
                event.stopPropagation();
                onPrimaryAction();
              }}
              size="sm"
              className="bg-cyan-500 text-slate-950 h-8 text-[11px] px-4 font-bold gap-2 hover:bg-cyan-400"
            >
              <Search size={14} /> Ver Detalhes
            </Button>
            <Button
              onClick={(event) => {
                event.stopPropagation();
                onDismiss();
              }}
              size="sm"
              variant="outline"
              className="h-8 text-[11px] px-4 font-bold text-slate-300 border-slate-700 bg-slate-900/40 hover:bg-slate-800"
            >
              Dispensar
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ScoreCardCircle({ title, value, icon, color, onClick }: any) {
  const tone = scoreTone(color);
  return (
    <button type="button" onClick={onClick} className="flex flex-col items-center text-center group cursor-pointer">
      <div className={`mb-6 transition-transform group-hover:scale-110 duration-300 ${tone.text}`}>{icon}</div>
      <div className="text-4xl font-black text-slate-100 mb-1">{value}</div>
      <div className="text-[9px] font-black text-slate-400 uppercase tracking-[0.2em]">{title}</div>
      <div className={`w-full h-1 mt-6 rounded-full bg-slate-800 overflow-hidden`}>
        <div className={`h-full ${tone.bar}`} style={{ width: `${value}%` }}></div>
      </div>
    </button>
  );
}

function TabButton({ active, icon, text, onClick, badgeCount = 0 }: any) {
  return (
    <button
      onClick={onClick}
      className={`flex min-h-[40px] w-full items-center justify-center gap-2 rounded-md px-3 py-2 text-[12px] font-medium leading-tight transition-all sm:text-[13px] lg:whitespace-nowrap ${
        active ? "bg-blue-600 text-white shadow-sm" : "text-slate-700 hover:bg-slate-200 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
      }`}
    >
      {icon}
      {text}
      {badgeCount > 0 ? (
        <span className="inline-flex min-w-5 items-center justify-center rounded-full border border-cyan-300/35 bg-cyan-500/25 px-1.5 py-0.5 text-[10px] font-black text-cyan-100">
          {badgeCount > 99 ? "99+" : badgeCount}
        </span>
      ) : null}
    </button>
  );
}

function ProcessingProgressBanner({
  percent,
  title,
  detail,
  tone,
  isInFlight,
}: {
  percent: number;
  title: string;
  detail: string;
  tone: ProcessingProgressTone;
  isInFlight: boolean;
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  const toneMap: Record<ProcessingProgressTone, { badge: string; bar: string; panel: string }> = {
    processing: {
      badge: "border-cyan-400/40 bg-cyan-500/20 text-cyan-200",
      bar: "bg-cyan-400",
      panel: `${PANEL_SOFT_CLASS} border-cyan-500/30`,
    },
    success: {
      badge: "border-emerald-400/40 bg-emerald-500/20 text-emerald-200",
      bar: "bg-emerald-400",
      panel: `${PANEL_SOFT_CLASS} border-emerald-500/30`,
    },
    warning: {
      badge: "border-amber-400/40 bg-amber-500/20 text-amber-200",
      bar: "bg-amber-400",
      panel: `${PANEL_SOFT_CLASS} border-amber-500/30`,
    },
  };
  const styles = toneMap[tone];

  return (
    <section className={`${styles.panel} mb-6 p-4`}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ActivitySquare size={16} className="text-slate-200" />
          <p className="text-sm font-bold text-slate-100">{title}</p>
        </div>
        <span className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-bold ${styles.badge}`}>
          {isInFlight ? <RefreshCcw size={12} className="animate-spin" /> : null}
          {clamped}%
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800/80">
        <div className={`h-full rounded-full transition-all duration-500 ${styles.bar}`} style={{ width: `${clamped}%` }} />
      </div>
      <p className="mt-2 text-xs text-slate-300">{detail}</p>
    </section>
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

function MetricCard({ title, value, subtitle, footer, color, updated, warning, onClick }: any) {
  const tone = metricTone(color);
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${PANEL_SOFT_CLASS} w-full p-6 flex flex-col justify-between relative overflow-hidden h-full hover:border-cyan-500/40 transition-colors text-left`}
    >
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
    </button>
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
