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
  History,
  ChevronDown,
  ChevronUp,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, Radar, BarChart, Bar, XAxis, CartesianGrid, Tooltip } from "recharts";
import { useToast } from "@/hooks/use-toast";
import { buildInitials, fetchMe, isUnauthorizedError, logout } from "@/lib/auth";
import { mapNetworkError, parseApiErrorResponse } from "@/lib/http-errors";
import { buildMockDashboardContextForUpload, buildMockDashboardData, buildMockUploadHistory } from "@/lib/mock-dashboard";
import type {
  CaseAIStatus,
  CaseAIStatusResponse,
  CaseExtractionPreviewResponse,
  DashboardData,
  DashboardFilters,
  UploadHistoryFilterOptions,
  UploadHistoryItem,
  UploadHistoryListResponse,
  UploadHistoryQueryFilters,
  UploadCaseResponse,
  UserCaseListItem,
} from "@/types/dashboard";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const DEFAULT_FILTERS: DashboardFilters = {
  tribunal: "Todos os Tribunais",
  juiz: "Todos os Juízes",
  tipo_acao: "Todos os Tipos",
  faixa_valor: "Todos os Valores",
  periodo: "Últimos 6 meses",
};

const DEFAULT_UPLOAD_HISTORY_QUERY_FILTERS: UploadHistoryQueryFilters = {
  search: "",
  status_filter: "all",
  judge: "",
  tribunal: "",
  action_type: "",
};
const UPLOAD_HISTORY_PAGE_SIZE = 20;

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
  user_party: "" as "" | "author" | "defendant",
};

const UPLOAD_FORM_LABEL = "block min-h-[1.25rem] text-xs font-semibold uppercase tracking-wide text-slate-300";

type DashboardTab = "visao-geral" | "inteligencia" | "simulacoes" | "alertas" | "historico-uploads";
type StrategicModule = "analise-decisoes" | "simulacoes-avancadas" | "gemeo-digital" | "acoes-rescisorias";
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
  targetModule?: StrategicModule;
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
  action_target?: {
    tab: string;
    module?: string | null;
    case_id?: string | null;
    reason?: string | null;
  } | null;
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
type LeadingSide = "user" | "counterparty" | "balanced";

type FavorabilitySummary = {
  userPct: number;
  counterpartyPct: number;
  leadingSide: LeadingSide;
  spread: number;
};

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

function resolveLatestProcessNumber(items: Array<{ process_number?: string | null; created_at?: string | null }>): string | null {
  const ordered = [...items].sort((a, b) => {
    const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
    const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
    return bTime - aTime;
  });

  for (const item of ordered) {
    const processNumber = item.process_number?.trim();
    if (processNumber) return processNumber;
  }

  return null;
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
  const scenarioFavorability = scenario.data.reduce((found: FavorabilitySummary | null, item) => {
    if (found) return found;
    return resolveFavorabilitySummary({
      favorableToUser: item.value_favorable_to_user,
      favorableToCounterparty: item.value_favorable_to_counterparty,
    });
  }, null);
  const defaultNextStep = titleKey.includes("acordo")
    ? "Consolidar proposta objetiva e checklist de concessões para abrir negociação ainda antes da audiência."
    : titleKey.includes("julgamento")
      ? "Preparar memoriais, reforçar prova documental e mapear risco recursal por etapa."
      : "Executar plano de mediação com roteiro de argumentos e limite de concessão por rodada.";

  return {
    title: "Cenário",
    description: scenario.detail_summary || scenario.title,
    lines: [
      ...(scenarioFavorability
        ? [`${resolveLeadingLabel(scenarioFavorability)} (${formatPercentLabel(scenarioFavorability.userPct)} x ${formatPercentLabel(scenarioFavorability.counterpartyPct)})`]
        : []),
      ...scenario.data.map((item) => `${item.label}: ${item.val}`),
      scenario.footer,
    ],
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

function formatUpdatedLabel(lastUpdateAt: string | undefined): string {
  if (!lastUpdateAt) return "Nenhum dado de upload ainda";
  const then = new Date(lastUpdateAt).getTime();
  if (Number.isNaN(then)) return "Nenhum dado de upload ainda";
  const now = Date.now();
  const diffMs = Math.max(0, now - then);
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffH = Math.floor(diffMin / 60);
  if (diffSec < 60) return "Atualizado: agora";
  if (diffMin < 60) return `Atualizado: há ${diffMin} min`;
  if (diffH < 24) return `Atualizado: há ${diffH} h`;
  const diffDays = Math.floor(diffH / 24);
  return `Atualizado: há ${diffDays} dia(s)`;
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

async function fetchUploadHistory(
  page: number,
  pageSize: number,
  filters: UploadHistoryQueryFilters = DEFAULT_UPLOAD_HISTORY_QUERY_FILTERS,
): Promise<UploadHistoryListResponse> {
  try {
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("page_size", String(pageSize));
    if (filters.search.trim()) params.set("search", filters.search.trim());
    if (filters.status_filter !== "all") params.set("status_filter", filters.status_filter);
    if (filters.judge.trim()) params.set("judge", filters.judge.trim());
    if (filters.tribunal.trim()) params.set("tribunal", filters.tribunal.trim());
    if (filters.action_type.trim()) params.set("action_type", filters.action_type.trim());
    const res = await fetch(`/api/cases/upload-history?${params.toString()}`, { credentials: "include" });
    const payload = await parseJsonOrThrow<UploadHistoryListResponse | UploadHistoryItem[]>(res);
    if (Array.isArray(payload)) {
      // Compatibilidade com backend legado: retornava lista simples sem metadados de paginação.
      return {
        items: payload,
        total_count: payload.length,
        page,
        page_size: pageSize,
        total_pages: payload.length > 0 ? Math.ceil(payload.length / pageSize) : 0,
      };
    }
    return {
      items: Array.isArray(payload.items) ? payload.items : [],
      total_count: typeof payload.total_count === "number" ? payload.total_count : Array.isArray(payload.items) ? payload.items.length : 0,
      page: typeof payload.page === "number" ? payload.page : page,
      page_size: typeof payload.page_size === "number" ? payload.page_size : pageSize,
      total_pages:
        typeof payload.total_pages === "number"
          ? payload.total_pages
          : typeof payload.total_count === "number"
            ? payload.total_count > 0
              ? Math.ceil(payload.total_count / pageSize)
              : 0
            : 0,
    };
  } catch (error) {
    throw mapNetworkError(error, "Não foi possível carregar o histórico de uploads agora.");
  }
}

async function fetchUploadHistoryFilterOptions(): Promise<UploadHistoryFilterOptions> {
  try {
    const res = await fetch("/api/cases/upload-history/filters", { credentials: "include" });
    if (res.status === 404) {
      // Compatibilidade com backend legado: rota de opções ainda inexistente.
      return { judges: [], tribunals: [], action_types: [] };
    }
    return await parseJsonOrThrow<UploadHistoryFilterOptions>(res);
  } catch (error) {
    throw mapNetworkError(error, "Não foi possível carregar os filtros do histórico agora.");
  }
}

async function fetchCaseDashboardContext(caseId: string): Promise<DashboardData> {
  try {
    const res = await fetch(`/api/cases/${caseId}/dashboard-context`, { credentials: "include" });
    return await parseJsonOrThrow<DashboardData>(res);
  } catch (error) {
    throw mapNetworkError(error, "Não foi possível carregar os comparativos deste upload agora.");
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

async function deleteCase(caseId: string): Promise<void> {
  const res = await fetch(`/api/cases/${caseId}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) {
    const parsedError = await parseApiErrorResponse(res).catch(() => "Não foi possível excluir este upload.");
    const message = typeof parsedError === "string" ? parsedError : parsedError.message || "Não foi possível excluir este upload.";
    throw mapNetworkError(new Error(message), message);
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
      return {
        label: "Concluída",
        badge: "border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-200",
      };
    case "processing":
      return {
        label: "Processando",
        badge: "border-sky-300 bg-sky-100 text-sky-800 dark:border-sky-500/40 dark:bg-sky-500/15 dark:text-sky-200",
      };
    case "failed_retryable":
      return {
        label: "Falha com retry",
        badge: "border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-200",
      };
    case "failed":
      return {
        label: "Falha",
        badge: "border-red-300 bg-red-100 text-red-800 dark:border-red-500/40 dark:bg-red-500/15 dark:text-red-200",
      };
    case "manual_review":
      return {
        label: "Revisão manual",
        badge: "border-orange-300 bg-orange-100 text-orange-800 dark:border-orange-500/40 dark:bg-orange-500/15 dark:text-orange-200",
      };
    case "queued":
    default:
      return {
        label: "Na fila",
        badge: "border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-600 dark:bg-slate-800/70 dark:text-slate-200",
      };
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

function formatCurrencyBRL(value?: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 2,
  }).format(value);
}

function toPercentageValue(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return Math.max(0, Math.min(100, value <= 1 ? value * 100 : value));
  }
  if (typeof value === "string") {
    const cleaned = value.replace("%", "").replace(",", ".").trim();
    if (!cleaned) return null;
    const parsed = Number(cleaned);
    if (!Number.isFinite(parsed)) return null;
    return Math.max(0, Math.min(100, parsed <= 1 ? parsed * 100 : parsed));
  }
  return null;
}

function formatPercentLabel(value: number): string {
  return `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(value)}%`;
}

function resolveFavorabilitySummary({
  favorableToUser,
  favorableToCounterparty,
  successProbability,
  userParty,
}: {
  favorableToUser?: string | number | null;
  favorableToCounterparty?: string | number | null;
  successProbability?: number | null;
  userParty?: "author" | "defendant" | null;
}): FavorabilitySummary | null {
  let userPct = toPercentageValue(favorableToUser ?? null);
  let counterpartyPct = toPercentageValue(favorableToCounterparty ?? null);

  if (userPct == null && counterpartyPct != null) {
    userPct = Math.max(0, Math.min(100, 100 - counterpartyPct));
  }
  if (counterpartyPct == null && userPct != null) {
    counterpartyPct = Math.max(0, Math.min(100, 100 - userPct));
  }

  if ((userPct == null || counterpartyPct == null) && userParty && typeof successProbability === "number" && Number.isFinite(successProbability)) {
    const successPct = Math.max(0, Math.min(100, successProbability <= 1 ? successProbability * 100 : successProbability));
    if (userParty === "author") {
      userPct = successPct;
      counterpartyPct = 100 - successPct;
    } else {
      userPct = 100 - successPct;
      counterpartyPct = successPct;
    }
  }

  if (userPct == null || counterpartyPct == null) return null;

  const spread = Math.round(Math.abs(userPct - counterpartyPct) * 10) / 10;
  const leadingSide: LeadingSide = spread < 0.5 ? "balanced" : userPct > counterpartyPct ? "user" : "counterparty";

  return {
    userPct: Math.round(userPct * 10) / 10,
    counterpartyPct: Math.round(counterpartyPct * 10) / 10,
    leadingSide,
    spread,
  };
}

function resolveLeadingLabel(summary: FavorabilitySummary): string {
  if (summary.leadingSide === "balanced") return "Empate técnico";
  if (summary.leadingSide === "user") return "Você à frente";
  return "Contraparte à frente";
}

function resolveDashboardFavorability(data: DashboardData): FavorabilitySummary | null {
  for (const metric of data.visao_geral.stats) {
    const summary = resolveFavorabilitySummary({
      favorableToUser: metric.value_favorable_to_user,
      favorableToCounterparty: metric.value_favorable_to_counterparty,
      userParty: data.case_context?.user_party ?? null,
    });
    if (summary) return summary;
  }

  for (const scenario of data.simulacoes.scenarios) {
    for (const entry of scenario.data) {
      const summary = resolveFavorabilitySummary({
        favorableToUser: entry.value_favorable_to_user,
        favorableToCounterparty: entry.value_favorable_to_counterparty,
        userParty: data.case_context?.user_party ?? null,
      });
      if (summary) return summary;
    }
  }

  return null;
}

/** Formata número para exibição no campo Valor causa (R$): "100.000,00" */
function formatClaimValueForInput(value?: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/** Converte valor do campo (pt-BR ou número) para string numérica para envio à API. */
function claimValueForSubmit(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const parsed = Number(trimmed.replace(/\./g, "").replace(",", ".").replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? String(parsed) : trimmed;
}

function formatContentTypeLabel(contentType?: string | null): string {
  if (!contentType || typeof contentType !== "string") return "Não informado";
  const normalized = contentType.toLowerCase();
  if (normalized.includes("pdf")) return "PDF";
  if (normalized.includes("officedocument.wordprocessingml.document")) return "DOCX";
  if (normalized.includes("msword")) return "DOC";
  if (normalized.startsWith("image/")) return `Imagem (${normalized.replace("image/", "").toUpperCase()})`;
  return contentType;
}

function estimateCaseAIProgressFallback(caseItem: { ai_attempts?: number | null; ai_status: CaseAIStatus }): number {
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

function resolveCaseAIProgress(caseItem: { ai_status: CaseAIStatus; ai_attempts?: number | null; ai_progress_percent?: number | null }): number {
  const backendValue = caseItem.ai_progress_percent;
  if (typeof backendValue === "number" && Number.isFinite(backendValue) && backendValue > 0) {
    return Math.max(0, Math.min(100, Math.round(backendValue)));
  }
  return estimateCaseAIProgressFallback(caseItem);
}

function resolveCaseAIStageLabel(caseItem: { ai_stage_label?: string | null; ai_stage?: string | null }): string {
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
    case "historico-uploads":
      return "Histórico de Uploads";
    default:
      return "Dashboard";
  }
}

function resolveStrategicModuleLabel(module: StrategicModule): string {
  switch (module) {
    case "analise-decisoes":
      return "Análise de Decisões";
    case "simulacoes-avancadas":
      return "Simulações Avançadas";
    case "gemeo-digital":
      return "Gêmeo Digital";
    case "acoes-rescisorias":
      return "Ações Rescisórias";
    default:
      return "Análise de Decisões";
  }
}

function normalizeTabForNavigation(tab: DashboardTab): DashboardTab {
  return tab === "simulacoes" ? "inteligencia" : tab;
}

function parseModuleParam(raw: string | null): StrategicModule | null {
  if (!raw) return null;
  if (raw === "analise-decisoes") return "analise-decisoes";
  if (raw === "simulacoes-avancadas") return "simulacoes-avancadas";
  if (raw === "gemeo-digital") return "gemeo-digital";
  if (raw === "acoes-rescisorias") return "acoes-rescisorias";
  return null;
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
  const [strategicModule, setStrategicModule] = useState<StrategicModule>("analise-decisoes");
  const [focusedSimulationScenario, setFocusedSimulationScenario] = useState<string | null>(null);
  const [navigationOrigin, setNavigationOrigin] = useState<string | null>(null);
  const [navigationAlertId, setNavigationAlertId] = useState<string | null>(null);
  const [navigationCaseId, setNavigationCaseId] = useState<string | null>(null);
  const [forcedAlertCategoryFilter, setForcedAlertCategoryFilter] = useState<AlertCategory | null>(null);
  const [isFiltering, setIsFiltering] = useState(false);
  const [isUploadPanelOpen, setIsUploadPanelOpen] = useState(true);
  const [draftFilters, setDraftFilters] = useState<DashboardFilters>(DEFAULT_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<DashboardFilters>(DEFAULT_FILTERS);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadForm, setUploadForm] = useState(EMPTY_UPLOAD_FORM);
  const [currentPath, setLocation] = useLocation();
  const isDemoMode = currentPath === "/dashboard-demo";
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [dismissedAlerts, setDismissedAlerts] = useState<string[]>([]);
  const [selectedCardDetail, setSelectedCardDetail] = useState<CardDetail | null>(null);
  const [selectedSimilarProcess, setSelectedSimilarProcess] = useState<SimilarProcessDetail | null>(null);
  const [selectedHistoryCase, setSelectedHistoryCase] = useState<UploadHistoryItem | null>(null);
  const [uploadHistoryFilters, setUploadHistoryFilters] = useState<UploadHistoryQueryFilters>(DEFAULT_UPLOAD_HISTORY_QUERY_FILTERS);
  const [uploadHistoryPage, setUploadHistoryPage] = useState(1);
  const [isStrategicRecommendationsModalOpen, setIsStrategicRecommendationsModalOpen] = useState(false);
  const hasTriggeredInitialStrategicScan = useRef(false);
  const seenStrategicAlertIds = useRef<Set<string>>(new Set());
  const casePollingBoostTimeoutRef = useRef<number | null>(null);
  const casesLifecycleSignatureRef = useRef<string>("");
  const [isCasePollingBoosted, setIsCasePollingBoosted] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);

  const handleUploadHistoryFiltersChange = useCallback((next: UploadHistoryQueryFilters) => {
    setUploadHistoryFilters(next);
    setUploadHistoryPage(1);
  }, []);

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
    queryClient.invalidateQueries({ queryKey: ["upload-history"] });
    queryClient.invalidateQueries({ queryKey: ["strategic-alerts"] });
    void queryClient.refetchQueries({ queryKey: ["dashboard-data"], type: "active" });
    void queryClient.refetchQueries({ queryKey: ["user-cases"], type: "active" });
    void queryClient.refetchQueries({ queryKey: ["upload-history"], type: "active" });
    void queryClient.refetchQueries({ queryKey: ["strategic-alerts"], type: "active" });
  }, [queryClient]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedTab = params.get("tab");
    const requestedModule = parseModuleParam(params.get("module"));

    if (requestedTab === "visao-geral" || requestedTab === "inteligencia" || requestedTab === "alertas" || requestedTab === "historico-uploads") {
      setActiveTab(requestedTab);
    } else if (requestedTab === "simulacoes") {
      setActiveTab("inteligencia");
      setStrategicModule("simulacoes-avancadas");
    }

    if (requestedModule) {
      setStrategicModule(requestedModule);
    }

    const origin = params.get("from");
    setNavigationOrigin(origin || null);
    setNavigationAlertId(params.get("alertId"));
    setNavigationCaseId(params.get("caseId"));
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set("tab", normalizeTabForNavigation(activeTab));

    if (normalizeTabForNavigation(activeTab) === "inteligencia") {
      params.set("module", strategicModule);
    } else {
      params.delete("module");
    }

    if (navigationOrigin) params.set("from", navigationOrigin);
    else params.delete("from");
    if (navigationAlertId) params.set("alertId", navigationAlertId);
    else params.delete("alertId");
    if (navigationCaseId) params.set("caseId", navigationCaseId);
    else params.delete("caseId");

    const query = params.toString();
    const nextUrl = `${window.location.pathname}${query ? `?${query}` : ""}`;
    const currentUrl = `${window.location.pathname}${window.location.search}`;
    if (nextUrl !== currentUrl) {
      window.history.replaceState(window.history.state, "", nextUrl);
    }
  }, [activeTab, navigationAlertId, navigationCaseId, navigationOrigin, strategicModule]);

  const meQuery = useQuery({
    queryKey: ["auth-me"],
    queryFn: fetchMe,
    enabled: !isDemoMode,
    retry: false,
  });
  const userCasesQueryKey = ["user-cases", meQuery.data?.user_id ?? "unknown-user"] as const;

  const dashboardQuery = useQuery({
    queryKey: ["dashboard-data", isDemoMode ? "demo" : "live", appliedFilters],
    queryFn: () => (isDemoMode ? Promise.resolve(buildMockDashboardData(appliedFilters)) : fetchDashboard(appliedFilters)),
    enabled: isDemoMode || meQuery.isSuccess,
    refetchInterval: isDemoMode ? false : isCasePollingBoosted ? 5000 : 15000,
    refetchIntervalInBackground: !isDemoMode,
    retry: false,
  });

  const strategicAlertsQuery = useQuery({
    queryKey: ["strategic-alerts", "active"],
    queryFn: () => fetchStrategicAlerts("active", 100),
    enabled: !isDemoMode && meQuery.isSuccess,
    retry: false,
    refetchInterval: isCasePollingBoosted ? 10000 : 60000,
    refetchIntervalInBackground: true,
  });

  const userCasesQuery = useQuery({
    queryKey: userCasesQueryKey,
    queryFn: () => fetchUserCases(30),
    enabled: !isDemoMode && meQuery.isSuccess,
    retry: false,
    refetchInterval: isCasePollingBoosted ? 5000 : 20000,
    refetchIntervalInBackground: true,
  });

  const uploadHistoryQuery = useQuery({
    queryKey: ["upload-history", uploadHistoryFilters, uploadHistoryPage, UPLOAD_HISTORY_PAGE_SIZE],
    queryFn: () => fetchUploadHistory(uploadHistoryPage, UPLOAD_HISTORY_PAGE_SIZE, uploadHistoryFilters),
    enabled: !isDemoMode && meQuery.isSuccess,
    retry: false,
    refetchInterval: isCasePollingBoosted ? 7000 : 25000,
    refetchIntervalInBackground: true,
  });

  const uploadHistoryFilterOptionsQuery = useQuery({
    queryKey: ["upload-history", "filters"],
    queryFn: fetchUploadHistoryFilterOptions,
    enabled: !isDemoMode && meQuery.isSuccess,
    retry: false,
    refetchInterval: isCasePollingBoosted ? 15000 : 45000,
    refetchIntervalInBackground: true,
  });

  const selectedHistoryCaseId = selectedHistoryCase?.case_id ?? null;
  const caseDashboardContextQuery = useQuery({
    queryKey: ["case-dashboard-context", selectedHistoryCaseId],
    queryFn: () => fetchCaseDashboardContext(selectedHistoryCaseId as string),
    enabled: !isDemoMode && meQuery.isSuccess && Boolean(selectedHistoryCaseId),
    retry: false,
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
      queryClient.setQueryData<UserCaseListItem[]>(userCasesQueryKey, (previous) =>
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
      queryClient.setQueriesData<UploadHistoryListResponse>({ queryKey: ["upload-history"] }, (previous) => {
        if (!previous) return previous;
        return {
          ...previous,
          items: previous.items.map((item) =>
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
        };
      });
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

  const deleteCaseMutation = useMutation({
    mutationFn: (caseId: string) => deleteCase(caseId),
    onSuccess: (_data, caseId) => {
      queryClient.setQueryData<UserCaseListItem[]>(userCasesQueryKey, (previous) =>
        (previous ?? []).filter((item) => item.case_id !== caseId),
      );
      queryClient.setQueriesData<UploadHistoryListResponse>({ queryKey: ["upload-history"] }, (previous) => {
        if (!previous) return previous;
        const nextItems = previous.items.filter((item) => item.case_id !== caseId);
        if (nextItems.length === previous.items.length) return previous;
        const nextTotalCount = Math.max(0, previous.total_count - 1);
        const nextTotalPages = nextTotalCount > 0 ? Math.ceil(nextTotalCount / previous.page_size) : 0;
        return {
          ...previous,
          items: nextItems,
          total_count: nextTotalCount,
          total_pages: nextTotalPages,
        };
      });
      queryClient.invalidateQueries({ queryKey: ["upload-history"] });
      queryClient.invalidateQueries({ queryKey: ["user-cases"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-data"] });
      if (selectedHistoryCase?.case_id === caseId) setSelectedHistoryCase(null);
      toast({ title: "Upload excluído", description: "O documento e todos os dados relacionados foram removidos." });
    },
    onError: (error: Error) => {
      toast({ title: "Falha ao excluir", description: error.message });
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
    const { textValue: extractedClaimRaw, numericValue: extractedClaimNumeric } = parseExtractedClaimValue((safeExtracted as { claim_value?: unknown }).claim_value);
    const claimDisplay = extractedClaimNumeric != null ? formatClaimValueForInput(extractedClaimNumeric) : extractedClaimRaw;
    setUploadForm((previous) => ({
      process_number: safeExtracted.process_number || processNumberFromPayload || previous.process_number,
      tribunal: safeExtracted.tribunal || previous.tribunal,
      judge: (safeExtracted as { authority_display?: string | null }).authority_display || safeExtracted.judge || previous.judge,
      action_type: safeExtracted.action_type || previous.action_type,
      claim_value: claimDisplay || previous.claim_value,
      user_party: previous.user_party ?? "",
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
      if (uploadForm.claim_value.trim()) formData.append("claim_value", claimValueForSubmit(uploadForm.claim_value));
      if (uploadForm.user_party === "author" || uploadForm.user_party === "defendant") formData.append("user_party", uploadForm.user_party);

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
      queryClient.setQueryData<UserCaseListItem[]>(userCasesQueryKey, (previous) => {
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
      setLastSyncAt(new Date().toISOString());
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

  const handleApplyFilters = () => {
    setIsFiltering(true);
    setAppliedFilters(draftFilters);
    setTimeout(() => setIsFiltering(false), 400);
  };

  const baseDashboardData = dashboardQuery.data;

  const strategicAlertItems = strategicAlertsQuery.data?.items ?? [];
  const userCases = userCasesQuery.data ?? [];
  const uploadHistoryItems = useMemo(
    () => (isDemoMode ? buildMockUploadHistory(appliedFilters) : uploadHistoryQuery.data?.items ?? []),
    [appliedFilters, isDemoMode, uploadHistoryQuery.data],
  );
  const uploadHistoryTotalCount = isDemoMode ? uploadHistoryItems.length : uploadHistoryQuery.data?.total_count ?? 0;
  const uploadHistoryTotalPages = isDemoMode
    ? 1
    : uploadHistoryQuery.data?.total_pages ?? Math.ceil(uploadHistoryTotalCount / UPLOAD_HISTORY_PAGE_SIZE);

  useEffect(() => {
    if (isDemoMode) return;
    if (uploadHistoryTotalPages === 0 && uploadHistoryPage !== 1) {
      setUploadHistoryPage(1);
      return;
    }
    if (uploadHistoryTotalPages > 0 && uploadHistoryPage > uploadHistoryTotalPages) {
      setUploadHistoryPage(uploadHistoryTotalPages);
    }
  }, [isDemoMode, uploadHistoryPage, uploadHistoryTotalPages]);

  const selectedHistoryContextData = useMemo(() => {
    if (!selectedHistoryCase) return null;
    if (isDemoMode) {
      return buildMockDashboardContextForUpload(selectedHistoryCase, appliedFilters);
    }
    return caseDashboardContextQuery.data ?? null;
  }, [appliedFilters, caseDashboardContextQuery.data, isDemoMode, selectedHistoryCase]);
  const dashboardData = useMemo(() => baseDashboardData, [baseDashboardData]);

  const lastUpdatedAt = useMemo(() => {
    const dates: number[] = [];
    if (lastSyncAt) {
      const t = new Date(lastSyncAt).getTime();
      if (Number.isFinite(t)) dates.push(t);
    }
    for (const item of uploadHistoryItems) {
      if (item.created_at) {
        const t = new Date(item.created_at).getTime();
        if (Number.isFinite(t)) dates.push(t);
      }
      if (item.ai_processed_at) {
        const t = new Date(item.ai_processed_at).getTime();
        if (Number.isFinite(t)) dates.push(t);
      }
    }
    for (const item of userCases) {
      if (item.created_at) {
        const t = new Date(item.created_at).getTime();
        if (Number.isFinite(t)) dates.push(t);
      }
      if (item.ai_processed_at) {
        const t = new Date(item.ai_processed_at).getTime();
        if (Number.isFinite(t)) dates.push(t);
      }
    }
    if (dates.length === 0) return undefined;
    return new Date(Math.max(...dates)).toISOString();
  }, [lastSyncAt, uploadHistoryItems, userCases]);

  const inboxAlertDetails = useMemo<DashboardAlertItem[]>(() => {
    if (isDemoMode || strategicAlertItems.length === 0) {
      return (dashboardData?.alertas.details as DashboardAlertItem[] | undefined) ?? [];
    }
    return strategicAlertItems.map((item) => ({
      type: item.type,
      title: item.title,
      time: item.time,
      desc: item.desc,
      alert_id: item.alert_id,
      status: item.status,
      action_target: item.action_target ?? undefined,
    }));
  }, [dashboardData?.alertas.details, isDemoMode, strategicAlertItems]);
  const dashboardAlertData = useMemo(() => {
    if (!dashboardData) return null;
    return {
      ...dashboardData,
      alertas: {
        ...dashboardData.alertas,
        details: inboxAlertDetails,
      },
    };
  }, [dashboardData, inboxAlertDetails]);
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

  const prevInFlightCountRef = useRef<number | null>(null);
  useEffect(() => {
    const inFlight = processingProgress?.inFlightCount ?? 0;
    const prev = prevInFlightCountRef.current;
    prevInFlightCountRef.current = inFlight;
    if (prev !== null && prev > 0 && inFlight === 0) {
      toast({
        title: "Upload concluído e processado pela IA com sucesso",
        description: "O processo foi analisado e os indicadores estão disponíveis.",
        variant: "success",
      });
    }
  }, [processingProgress?.inFlightCount, toast]);

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
  const analysisProcessNumber = useMemo(() => {
    const processFromContext = dashboardData?.case_context?.process_number?.trim();
    if (processFromContext) return processFromContext;

    if (navigationCaseId && dashboardData) {
      const processFromNavigationCase = dashboardData.inteligencia.acoes_rescisorias.candidates
        .find((item) => item.case_id === navigationCaseId)
        ?.process_number?.trim();
      if (processFromNavigationCase) return processFromNavigationCase;
    }

    const processFromUserCases = resolveLatestProcessNumber(userCases);
    if (processFromUserCases) return processFromUserCases;

    return resolveLatestProcessNumber(uploadHistoryItems);
  }, [dashboardData, navigationCaseId, uploadHistoryItems, userCases]);

  useEffect(() => {
    setDismissedAlerts([]);
  }, [dashboardData?.generated_at]);

  const [, setUpdatedLabelTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      setUpdatedLabelTick((t) => t + 1);
      if (!isDemoMode) {
        queryClient.invalidateQueries({ queryKey: ["dashboard-data"] });
        queryClient.invalidateQueries({ queryKey: ["upload-history"] });
        queryClient.invalidateQueries({ queryKey: ["user-cases"] });
      }
    }, 60_000);
    return () => clearInterval(id);
  }, [isDemoMode, queryClient]);

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
    if (isDemoMode) {
      return;
    }
    if (!uploadHistoryQuery.error) {
      return;
    }
    if (isUnauthorizedError(uploadHistoryQuery.error)) {
      setLocation("/auth?tab=login", { replace: true });
    }
  }, [isDemoMode, setLocation, uploadHistoryQuery.error]);

  useEffect(() => {
    if (isDemoMode) {
      return;
    }
    if (!caseDashboardContextQuery.error) {
      return;
    }
    if (isUnauthorizedError(caseDashboardContextQuery.error)) {
      setLocation("/auth?tab=login", { replace: true });
    }
  }, [caseDashboardContextQuery.error, isDemoMode, setLocation]);

  useEffect(() => {
    return () => {
      if (casePollingBoostTimeoutRef.current) {
        window.clearTimeout(casePollingBoostTimeoutRef.current);
        casePollingBoostTimeoutRef.current = null;
      }
    };
  }, []);

  const userInitials = useMemo(() => {
    if (meQuery.data?.full_name) {
      return buildInitials(meQuery.data.full_name);
    }
    if (isDemoMode) {
      return "DM";
    }
    return "US";
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
  const resolveAlertCategory = (type: string): AlertCategory => {
    const normalized = type.toLowerCase().trim();
    if (normalized === "critical" || normalized.includes("crit")) return "critical";
    if (normalized === "warning" || normalized.includes("warn") || normalized.includes("aten")) return "warning";
    if (normalized === "opportunity" || normalized.includes("oppor") || normalized.includes("oportun")) return "opportunity";
    return "info";
  };
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

  const handlePrimaryAlertAction = (item: DashboardAlertItem) => {
    // Na aba Alertas, "Ver Detalhes" deve abrir o detalhe do alerta, não redirecionar para outra aba
    if (activeTab === "alertas") {
      openCardDetail({
        title: item.title,
        description: item.time,
        lines: [item.desc],
        targetTab: "alertas",
      });
      return;
    }

    const target = item.action_target;
    const parsedModule = parseModuleParam(target?.module ?? null);
    const normalizedType = item.type.toLowerCase();

    if (target?.tab === "historico-uploads") {
      setActiveTab("historico-uploads");
      setNavigationOrigin("alerta");
      setNavigationAlertId(item.alert_id ?? null);
      setNavigationCaseId(target.case_id ?? null);
      toast({
        title: "Abrindo Histórico de Uploads",
        description: item.title,
      });
      return;
    }

    if (target?.tab === "alertas") {
      setActiveTab("alertas");
      setNavigationOrigin("alerta");
      setNavigationAlertId(item.alert_id ?? null);
      setNavigationCaseId(target.case_id ?? null);
      toast({
        title: "Abrindo Alertas Estratégicos",
        description: item.title,
      });
      return;
    }

    setActiveTab("inteligencia");
    setStrategicModule(
      parsedModule ??
        (normalizedType === "opportunity" || normalizedType.includes("oportun")
          ? "acoes-rescisorias"
          : "analise-decisoes"),
    );
    setNavigationOrigin("alerta");
    setNavigationAlertId(item.alert_id ?? null);
    setNavigationCaseId(target?.case_id ?? null);
    toast({
      title: "Abrindo Inteligência Estratégica",
      description: item.title,
    });
  };

  const openCardDetail = (detail: CardDetail) => {
    const targetTab = detail.targetTab === "simulacoes" ? "inteligencia" : detail.targetTab ?? activeTab;
    if (targetTab !== activeTab) {
      setActiveTab(targetTab);
    }
    if (targetTab === "inteligencia") {
      if (detail.targetModule) {
        setStrategicModule(detail.targetModule);
      } else if (detail.targetTab === "simulacoes") {
        setStrategicModule("simulacoes-avancadas");
      }
    }
    setSelectedSimilarProcess(null);
    if (detail.targetTab === "simulacoes" || detail.targetModule === "simulacoes-avancadas") {
      setFocusedSimulationScenario(detail.targetScenarioTitle || null);
    } else {
      setFocusedSimulationScenario(null);
    }
    const dataSourceLine = isDemoMode
      ? "Fonte: modo DEMO com dados simulados."
      : "Fonte: IA + JusBrasil e outras fontes públicas.";
    const processReferenceLine = analysisProcessNumber ? `Processo de referência: ${analysisProcessNumber}.` : null;
    const baseSourceNote = detail.sourceNote || dataSourceLine;
    const sourceNote =
      processReferenceLine && !baseSourceNote.includes(processReferenceLine)
        ? `${baseSourceNote} ${processReferenceLine}`
        : baseSourceNote;
    const incomingLines = detail.lines || [];
    const linesWithProcessReference =
      processReferenceLine && !incomingLines.some((line) => line.includes(processReferenceLine))
        ? [...incomingLines, processReferenceLine]
        : incomingLines;

    if (detail.variant === "scenario") {
      setSelectedCardDetail({
        ...detail,
        lines: linesWithProcessReference,
        sourceNote,
      });
      return;
    }

    setSelectedCardDetail({
      ...detail,
      variant: "default",
      lines: linesWithProcessReference.includes(dataSourceLine) ? linesWithProcessReference : [...linesWithProcessReference, dataSourceLine],
      sourceNote,
    });
  };

  const openSimilarProcessDetail = (item: SimilarProcessSource) => {
    if (activeTab !== "inteligencia") {
      setActiveTab("inteligencia");
    }
    setStrategicModule("analise-decisoes");
    setFocusedSimulationScenario(null);
    setSelectedCardDetail(null);
    setSelectedSimilarProcess(buildSimilarProcessDetail(item, appliedFilters, isDemoMode));
  };
  const isScenarioDetailModal = selectedCardDetail?.variant === "scenario";
  const alertTabBadgeCount = inboxAlertDetails.length || 0;
  const highlightedRescisoriaScore =
    navigationCaseId && dashboardData
      ? dashboardData.inteligencia.acoes_rescisorias.candidates.find((item) => item.case_id === navigationCaseId)?.viability_score ?? null
      : null;
  const breadcrumbLabel =
    normalizeTabForNavigation(activeTab) === "inteligencia"
      ? `Dashboard > ${resolveTabLabel("inteligencia")} > ${resolveStrategicModuleLabel(strategicModule)}`
      : `Dashboard > ${resolveTabLabel(normalizeTabForNavigation(activeTab))}`;

  return (
    <div className="dashboard-shell min-h-screen flex flex-col bg-[radial-gradient(circle_at_8%_-10%,rgba(37,99,235,0.35),transparent_35%),radial-gradient(circle_at_90%_-20%,rgba(20,184,166,0.2),transparent_35%),linear-gradient(180deg,#070b1a_0%,#090f22_55%,#070c1a_100%)]">
      <header className="sticky top-0 z-50 border-b border-slate-800/80 bg-slate-950/85 px-4 py-3 backdrop-blur-xl lg:flex lg:items-center lg:px-5 lg:py-2 xl:h-16 xl:px-6 xl:py-0">
        <div className="mx-auto flex w-full flex-col gap-3 lg:h-full lg:grid lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:items-center lg:gap-3">
          <Link
            href="/"
            className="brand-logo-chip flex items-center gap-2 rounded-xl px-2.5 py-1.5 shadow-sm transition-colors lg:justify-self-start"
          >
            <Scale className="brand-logo-icon h-6 w-6" />
            <span className="brand-logo-title text-xl font-bold tracking-tight">LexScale</span>
          </Link>

          <div className="w-full rounded-xl border border-slate-800 bg-slate-900/80 p-1 lg:w-auto lg:max-w-full lg:justify-self-center lg:overflow-x-auto">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:flex lg:w-max lg:justify-center lg:gap-2">
              <TabButton active={activeTab === "visao-geral"} onClick={() => setActiveTab("visao-geral")} icon={<LayoutDashboard size={16} />} text="Visão Geral" />
              <TabButton active={activeTab === "inteligencia"} onClick={() => setActiveTab("inteligencia")} icon={<BrainCircuit size={16} />} text="Inteligência Estratégica" />
              <TabButton
                active={activeTab === "alertas"}
                onClick={() => setActiveTab("alertas")}
                icon={<BellRing size={16} />}
                text="Alertas Estratégicos"
                badgeCount={alertTabBadgeCount}
              />
              <TabButton
                active={activeTab === "historico-uploads"}
                onClick={() => setActiveTab("historico-uploads")}
                icon={<History size={16} />}
                text="Histórico de Uploads"
                badgeCount={uploadHistoryItems.length}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3 lg:justify-self-end lg:justify-end">
            {isDemoMode ? (
              <span className="rounded-full border border-cyan-400/40 bg-cyan-500/15 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-200">
                Modo Demo
              </span>
            ) : null}
            {meQuery.data ? (
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
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-200 dark:hover:bg-slate-800"
                onClick={() => setLocation("/auth?tab=login")}
              >
                Fazer Login
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className={`flex-1 w-full max-w-[1400px] mx-auto p-4 sm:p-6 transition-opacity duration-300 ${isFiltering ? "opacity-50 pointer-events-none" : "opacity-100"}`}>
        <section className={`${PANEL_SOFT_CLASS} mb-4 flex flex-wrap items-center justify-between gap-3 p-3`}>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">{breadcrumbLabel}</p>
          <div className="flex items-center gap-2 text-xs sm:text-sm text-slate-300">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            <span className="whitespace-nowrap">{formatUpdatedLabel(lastUpdatedAt)}</span>
          </div>
        </section>
        <section className={`${PANEL_SOFT_CLASS} mb-4 border-cyan-400/35 bg-cyan-500/10 p-3`}>
          <p className="text-xs font-semibold text-cyan-100">
            {activeTab === "historico-uploads" ? (
              "No histórico, cada análise exibe explicitamente o número do processo correspondente em cada card."
            ) : analysisProcessNumber ? (
              <>
                Dados de análise desta aba referem-se ao processo nº <span className="font-mono font-bold">{analysisProcessNumber}</span>.
              </>
            ) : (
              "Processo de referência não identificado neste recorte. Use o número do processo exibido em cada bloco para manter o contexto."
            )}
          </p>
        </section>
        {isDemoMode ? (
          <section className={`${PANEL_SOFT_CLASS} p-4 mb-6`}>
            <p className="text-sm text-slate-300">
              Dashboard de demonstração com dados fictícios. Recursos de upload e integrações externas estão disponíveis apenas para contas autenticadas.
            </p>
          </section>
        ) : activeTab === "visao-geral" ? (
          <section className={`${PANEL_CLASS} mb-6 p-4`}>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h3 className="flex items-center gap-2 font-bold text-slate-100">
                <Upload size={18} className="text-cyan-300" />
                Upload de Processo e Enriquecimento
              </h3>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 gap-2 border-slate-700 bg-slate-900/50 text-slate-100 hover:bg-slate-800"
                  onClick={() => setIsUploadPanelOpen((prev) => !prev)}
                  aria-expanded={isUploadPanelOpen}
                  aria-controls="upload-processo-panel"
                >
                  <ChevronDown size={14} className={`transition-transform ${isUploadPanelOpen ? "rotate-180" : ""}`} />
                  {isUploadPanelOpen ? "Recolher" : "Expandir"}
                </Button>
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
            </div>

            {isUploadPanelOpen ? (
              <div id="upload-processo-panel" className="space-y-6">
                <div className="grid items-start gap-x-4 gap-y-0 md:grid-cols-6 md:gap-y-4">
                  <div className="flex min-w-0 flex-col gap-2.5 md:col-span-2">
                    <label className={UPLOAD_FORM_LABEL}>Arquivo do processo</label>
                    <div className="flex min-h-[38px] items-center rounded-md border border-slate-700 bg-slate-900/70 px-2 py-1.5">
                      <input
                        type="file"
                        className="block w-full min-w-0 text-sm text-slate-300 file:mr-3 file:min-h-[28px] file:rounded file:border-0 file:border-slate-700 file:bg-slate-900 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-cyan-200 hover:file:bg-slate-800"
                        onChange={handleUploadFileChange}
                        disabled={extractPreviewMutation.isPending || uploadMutation.isPending}
                      />
                    </div>
                    {extractPreviewMutation.isPending ? <p className="text-[11px] text-cyan-300">Extraindo campos automaticamente...</p> : null}
                  </div>
                  <InputField label="Número do processo" value={uploadForm.process_number} onChange={(value) => setUploadForm((s) => ({ ...s, process_number: value }))} placeholder="Ex.: 0000000-00.2025.4.01.0000" />
                  <div className="flex min-w-0 flex-col gap-2.5">
                    <label className={UPLOAD_FORM_LABEL}>Você é neste processo</label>
                    <select
                      value={uploadForm.user_party}
                      onChange={(e) => setUploadForm((s) => ({ ...s, user_party: (e.target.value || "") as "" | "author" | "defendant" }))}
                      className="h-[38px] min-w-0 rounded-md border border-slate-700 bg-slate-900/70 px-3 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
                    >
                      <option value="">Não informar</option>
                      <option value="author">Autor</option>
                      <option value="defendant">Réu</option>
                    </select>
                    <p className="text-[11px] leading-tight text-slate-400">Define a perspectiva dos indicadores (favorável a você ou à contraparte).</p>
                  </div>
                  <InputField label="Tribunal" value={uploadForm.tribunal} onChange={(value) => setUploadForm((s) => ({ ...s, tribunal: value }))} placeholder="Ex.: TRF1, TJSP, TRT 2ª Região" />
                  <div className="hidden min-w-0 md:block md:col-span-1" aria-hidden />
                </div>
                <div className="grid items-start gap-x-4 gap-y-4 md:grid-cols-6">
                  <div className="hidden min-w-0 md:block md:col-span-2" aria-hidden />
                  <div className="min-w-0 md:col-span-2">
                    <InputField label="Autoridade Responsável" value={uploadForm.judge} onChange={(value) => setUploadForm((s) => ({ ...s, judge: value }))} placeholder="Ex.: Juiz (1º grau): Nome; Des. Federal / Relator: Nome" />
                  </div>
                  <InputField label="Valor causa (R$)" value={uploadForm.claim_value} onChange={(value) => setUploadForm((s) => ({ ...s, claim_value: value }))} placeholder="Ex.: 50.000,00" />
                  <InputField label="Tipo de ação" value={uploadForm.action_type} onChange={(value) => setUploadForm((s) => ({ ...s, action_type: value }))} placeholder="Ex.: Ação de conhecimento, Mandado de segurança" />
                </div>
                <div className="grid items-start gap-x-4 gap-y-4 md:grid-cols-6">
                  <div className="hidden min-w-0 md:block md:col-span-4" aria-hidden />
                  <div className="flex min-w-0 justify-end md:col-span-2">
                    <Button
                      onClick={() => uploadMutation.mutate()}
                      disabled={uploadMutation.isPending || extractPreviewMutation.isPending || !uploadFile}
                      className="h-[38px] gap-2 bg-cyan-500 px-6 font-bold text-slate-950 hover:bg-cyan-400"
                    >
                      <Upload size={16} />
                      {extractPreviewMutation.isPending ? "Extraindo..." : uploadMutation.isPending ? "Enviando..." : "Enviar para Analise"}
                    </Button>
                  </div>
                </div>

                <div className="border-t border-slate-200 pt-4 dark:border-slate-800">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <p className="text-xs font-semibold uppercase text-slate-300">Análises AI dos seus casos</p>
                    {isCasePollingBoosted ? (
                      <span className="rounded-full border border-cyan-300 bg-cyan-100 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-cyan-800 dark:border-cyan-400/40 dark:bg-cyan-500/15 dark:text-cyan-200">
                        Monitoramento intensivo ativo
                      </span>
                    ) : null}
                  </div>
                  {userCasesQuery.isLoading ? (
                    <div className="rounded-xl border border-slate-200 bg-white px-4 py-5 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-300">
                      Carregando status das análises...
                    </div>
                  ) : userCasesQuery.isError ? (
                    <div className="rounded-xl border border-red-500/30 bg-red-950/30 px-4 py-5 text-sm text-red-200">
                      Falha ao carregar casos: {userCasesQuery.error instanceof Error ? userCasesQuery.error.message : "erro desconhecido"}
                    </div>
                  ) : userCases.length === 0 ? (
                    <div className="rounded-xl border border-slate-200 bg-white px-4 py-5 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-300">
                      Nenhum caso enviado ainda.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {userCases.slice(0, 3).map((item) => {
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
                          <div key={item.case_id} className="rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900/45">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <p className="text-sm font-bold text-slate-900 dark:text-slate-100">{processLabel}</p>
                                <p className="text-[11px] text-slate-600 dark:text-slate-400">
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
                                    className="h-7 border-slate-300 bg-white px-3 text-[11px] font-bold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-100 dark:hover:bg-slate-800"
                                    disabled={isReprocessingThisCase}
                                    onClick={() => reprocessCaseMutation.mutate(item.case_id)}
                                  >
                                    {isReprocessingThisCase ? "Reprocessando..." : "Reprocessar AI"}
                                  </Button>
                                ) : null}
                              </div>
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-700 dark:text-slate-300">
                              <span className="rounded-md border border-slate-300 bg-slate-100 px-2 py-0.5 dark:border-slate-700 dark:bg-slate-800/60">
                                Êxito: {formatProbabilityPercent(item.success_probability)}
                              </span>
                              <span className="rounded-md border border-slate-300 bg-slate-100 px-2 py-0.5 dark:border-slate-700 dark:bg-slate-800/60">
                                Acordo: {formatProbabilityPercent(item.settlement_probability)}
                              </span>
                              <span className="rounded-md border border-slate-300 bg-slate-100 px-2 py-0.5 dark:border-slate-700 dark:bg-slate-800/60">
                                Risco: {typeof item.risk_score === "number" && Number.isFinite(item.risk_score) ? `${Math.round(item.risk_score)} / 100` : "--"}
                              </span>
                              <span className="rounded-md border border-slate-300 bg-slate-100 px-2 py-0.5 dark:border-slate-700 dark:bg-slate-800/60">
                                Tentativas IA: {typeof item.ai_attempts === "number" ? item.ai_attempts : 0}
                              </span>
                              <span className="rounded-md border border-cyan-300 bg-cyan-100 px-2 py-0.5 text-cyan-800 dark:border-cyan-500/35 dark:bg-cyan-500/10 dark:text-cyan-200">
                                Progresso IA: {stageProgress}%
                              </span>
                            </div>
                            <p className="mt-2 text-[11px] text-slate-700 dark:text-slate-300">{stageLabel}</p>
                            {retryAtLabel && item.ai_status === "failed_retryable" ? (
                              <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-200">Nova tentativa automática prevista para {retryAtLabel}.</p>
                            ) : null}
                            {item.ai_last_error ? <p className="mt-2 text-[11px] text-red-700 dark:text-red-200">Último erro: {item.ai_last_error}</p> : null}
                          </div>
                        );
                      })}
                      <div className="pt-2">
                        <Button
                          type="button"
                          variant="outline"
                          className="h-8 gap-2 border-cyan-500/40 bg-transparent text-cyan-300 hover:bg-cyan-500/15 dark:text-cyan-200 dark:hover:bg-cyan-500/20"
                          onClick={() => setActiveTab("historico-uploads")}
                        >
                          <History size={14} />
                          Ver Todos
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div
                id="upload-processo-panel"
                className="rounded-xl border border-dashed border-slate-700 bg-slate-950/35 px-4 py-5 text-sm text-slate-300"
              >
                Painel de upload recolhido. Clique em <strong>Expandir</strong> para enviar novos processos.
              </div>
            )}
          </section>
        ) : null}

        <div className={`${PANEL_SOFT_CLASS} mb-8 grid gap-4 p-4 md:grid-cols-2 xl:grid-cols-6 xl:items-end`}>
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
          <Button onClick={handleApplyFilters} className="h-[38px] w-full gap-2 bg-blue-600 px-6 text-white hover:bg-blue-500 xl:w-auto">
            <CheckSquare size={16} /> Aplicar Filtros
          </Button>
        </div>

        {processingProgress && processingProgress.inFlightCount > 0 ? (
          <ProcessingProgressBanner
            percent={processingProgress.percent}
            title={processingProgress.title}
            detail={processingProgress.detail}
            tone={processingProgress.tone}
            isInFlight={true}
          />
        ) : null}

        {activeTab === "visao-geral" && inboxAlertDetails.length > 0 ? (
          <section className={`${PANEL_SOFT_CLASS} mb-6 p-4`}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-sm font-bold uppercase tracking-wide text-slate-200">Sinais do dia</h3>
              <Button
                size="sm"
                variant="outline"
                className="h-8 border-slate-700 bg-slate-900/40 text-slate-200 hover:bg-slate-800"
                onClick={() => setActiveTab("alertas")}
              >
                Abrir Alertas Estratégicos
              </Button>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              {inboxAlertDetails.slice(0, 3).map((item, idx) => (
                <div key={`${getAlertKey(item)}::signal::${idx}`} className="rounded-lg border border-slate-700/80 bg-slate-900/40 p-3">
                  <p className="text-xs font-bold text-slate-100">{item.title}</p>
                  <p className="mt-1 line-clamp-2 text-[11px] text-slate-300">{item.desc}</p>
                  <div className="mt-3 flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 border-slate-700 bg-slate-900/40 px-2 text-[11px] text-slate-200 hover:bg-slate-800"
                      onClick={() => {
                        setActiveTab("alertas");
                        setForcedAlertCategoryFilter(resolveAlertCategory(item.type));
                        setNavigationOrigin("alerta");
                        setNavigationAlertId(item.alert_id ?? null);
                      }}
                    >
                      Ver alerta
                    </Button>
                    <Button
                      size="sm"
                      className="h-7 bg-cyan-500 px-2 text-[11px] font-bold text-slate-950 hover:bg-cyan-400"
                      onClick={() => handlePrimaryAlertAction(item)}
                    >
                      Ver análise relacionada
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {dashboardQuery.isLoading && (
          <div className={`${PANEL_SOFT_CLASS} p-6 text-slate-300 sm:p-8`}>Carregando dashboard...</div>
        )}

        {dashboardQuery.isError && (
          <div className="rounded-xl border border-red-500/30 bg-red-950/35 p-6 text-red-200 sm:p-8">
            Falha ao carregar dashboard: {dashboardQuery.error instanceof Error ? dashboardQuery.error.message : "erro desconhecido"}
          </div>
        )}

        {dashboardData && dashboardAlertData && (
          <>
            {activeTab === "visao-geral" && (
              <VisaoGeralView
                data={dashboardData}
                radarData={radarData}
                referenceProcessNumber={analysisProcessNumber}
                onOpenStrategicRecommendations={() => setIsStrategicRecommendationsModalOpen(true)}
                onOpenCardDetail={openCardDetail}
              />
            )}
            {(activeTab === "inteligencia" || activeTab === "simulacoes") && (
              <div className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)] xl:items-start">
                <aside
                  className={`${PANEL_SOFT_CLASS} order-1 border-slate-200 bg-white/95 shadow-[0_16px_38px_rgba(15,23,42,0.12)] dark:border-cyan-500/20 dark:bg-[linear-gradient(160deg,rgba(6,26,58,0.85)_0%,rgba(5,15,38,0.85)_100%)] dark:shadow-[0_14px_30px_rgba(2,6,23,0.35)] p-4 xl:sticky xl:top-20`}
                >
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-cyan-700 dark:text-cyan-200">Módulos de Inteligência Estratégica</p>
                    <span className="rounded-full border border-cyan-300 bg-cyan-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-cyan-700 dark:border-cyan-400/35 dark:bg-cyan-500/15 dark:text-cyan-100">
                      4 módulos
                    </span>
                  </div>
                  <nav className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-1">
                    <TabButton
                      active={strategicModule === "analise-decisoes"}
                      onClick={() => setStrategicModule("analise-decisoes")}
                      icon={<BrainCircuit size={15} />}
                      text="Análise de Decisões"
                      variant="strategic-sidebar"
                    />
                    <TabButton
                      active={strategicModule === "simulacoes-avancadas"}
                      onClick={() => setStrategicModule("simulacoes-avancadas")}
                      icon={<ActivitySquare size={15} />}
                      text="Simulações Avançadas"
                      variant="strategic-sidebar"
                    />
                    <TabButton
                      active={strategicModule === "gemeo-digital"}
                      onClick={() => setStrategicModule("gemeo-digital")}
                      icon={<Database size={15} />}
                      text="Gêmeo Digital"
                      variant="strategic-sidebar"
                    />
                    <TabButton
                      active={strategicModule === "acoes-rescisorias"}
                      onClick={() => setStrategicModule("acoes-rescisorias")}
                      icon={<Scale size={15} />}
                      text="Ações Rescisórias"
                      variant="strategic-sidebar"
                    />
                  </nav>
                  <div className="mt-3 rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-xs text-slate-700 dark:border-cyan-500/25 dark:bg-slate-950/55 dark:text-slate-200">
                    Módulo ativo: <strong>{resolveStrategicModuleLabel(strategicModule)}</strong>
                    {navigationCaseId ? (
                      <>
                        {" • "}
                        {dashboardData?.case_context?.case_id === navigationCaseId && dashboardData.case_context.process_number ? (
                          <>Processo: <span className="font-mono">{dashboardData.case_context.process_number}</span></>
                        ) : (
                          <>Caso de referência: {navigationCaseId.slice(0, 8)}...</>
                        )}
                        {dashboardData?.case_context?.case_id === navigationCaseId && dashboardData.case_context.user_party && (
                          <> • Perspectiva: <strong>{dashboardData.case_context.user_party === "author" ? "Autor" : "Réu"}</strong></>
                        )}
                      </>
                    ) : null}
                    {typeof highlightedRescisoriaScore === "number" ? ` • Score: ${highlightedRescisoriaScore}/100` : ""}
                    {navigationOrigin ? ` • Origem: ${navigationOrigin}` : ""}
                  </div>
                </aside>

                <div className="order-2 min-w-0 space-y-4">
                  {dashboardData?.case_context && (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 dark:border-slate-700 dark:bg-slate-800/50">
                      <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                        Processo: <span className="font-mono">{dashboardData.case_context.process_number}</span>
                        {dashboardData.case_context.case_title ? ` — ${dashboardData.case_context.case_title}` : ""}
                        {dashboardData.case_context.user_party && (
                          <span className="ml-2 text-xs font-medium text-slate-600 dark:text-slate-400">
                            • Perspectiva: você como <strong>{dashboardData.case_context.user_party === "author" ? "Autor" : "Réu"}</strong>
                          </span>
                        )}
                      </p>
                    </div>
                  )}
                  {strategicModule === "analise-decisoes" ? (
                    <InteligenciaView
                      data={dashboardData}
                      referenceProcessNumber={analysisProcessNumber}
                      onOpenCardDetail={openCardDetail}
                      onOpenSimilarProcess={openSimilarProcessDetail}
                    />
                  ) : null}
                  {strategicModule === "simulacoes-avancadas" ? (
                    <SimulacoesView
                      data={dashboardData}
                      referenceProcessNumber={analysisProcessNumber}
                      onOpenCardDetail={openCardDetail}
                      focusedScenarioTitle={focusedSimulationScenario}
                      isDemoMode={isDemoMode}
                    />
                  ) : null}
                  {strategicModule === "gemeo-digital" ? (
                    <GemeoDigitalView data={dashboardData} referenceProcessNumber={analysisProcessNumber} onOpenCardDetail={openCardDetail} />
                  ) : null}
                  {strategicModule === "acoes-rescisorias" ? (
                    <AcoesRescisoriasView
                      data={dashboardData}
                      referenceProcessNumber={analysisProcessNumber}
                      highlightedCaseId={navigationCaseId}
                      onOpenFromCandidate={(caseId) => {
                        setNavigationCaseId(caseId);
                        setNavigationOrigin((prev) => prev ?? "inteligencia");
                      }}
                    />
                  ) : null}
                </div>
              </div>
            )}
            {activeTab === "alertas" && (
              <AlertasView
                data={dashboardAlertData}
                referenceProcessNumber={analysisProcessNumber}
                dismissedAlerts={dismissedAlerts}
                getAlertKey={getAlertKey}
                onViewAlert={handleViewAlert}
                onResolveAlert={handleResolveAlert}
                onDismissAlert={handleDismissAlert}
                onPrimaryAlertAction={handlePrimaryAlertAction}
                onOpenCardDetail={openCardDetail}
                forcedCategoryFilter={forcedAlertCategoryFilter}
                onForcedCategoryApplied={() => setForcedAlertCategoryFilter(null)}
              />
            )}
            {activeTab === "historico-uploads" && (
              <UploadHistoryView
                items={uploadHistoryItems}
                isLoading={!isDemoMode && uploadHistoryQuery.isLoading}
                isError={!isDemoMode && uploadHistoryQuery.isError}
                errorMessage={uploadHistoryQuery.error instanceof Error ? uploadHistoryQuery.error.message : "erro desconhecido"}
                onReprocessCase={(caseId: string) => reprocessCaseMutation.mutate(caseId)}
                isReprocessingCaseId={reprocessCaseMutation.isPending ? reprocessCaseMutation.variables : null}
                onOpenCompleteAnalysis={(item) => setSelectedHistoryCase(item)}
                onDeleteCase={(caseId) => deleteCaseMutation.mutate(caseId)}
                isDeletingCaseId={deleteCaseMutation.isPending ? deleteCaseMutation.variables : null}
                serverFilters={uploadHistoryFilters}
                onServerFiltersChange={handleUploadHistoryFiltersChange}
                filterOptions={uploadHistoryFilterOptionsQuery.data}
                currentPage={uploadHistoryPage}
                pageSize={UPLOAD_HISTORY_PAGE_SIZE}
                totalCount={uploadHistoryTotalCount}
                totalPages={uploadHistoryTotalPages}
                onPageChange={setUploadHistoryPage}
                onOpenRescisoriaCase={(caseId) => {
                  setActiveTab("inteligencia");
                  setStrategicModule("acoes-rescisorias");
                  setNavigationOrigin("historico");
                  setNavigationCaseId(caseId);
                }}
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
              ? "w-[calc(100%-1.5rem)] max-w-5xl max-h-[90vh] overflow-y-auto border-slate-200 bg-slate-50 text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              : isScenarioDetailModal
                ? "w-[calc(100%-1.5rem)] max-w-4xl max-h-[90vh] overflow-y-auto border-slate-200 bg-slate-50 text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 [&>button]:right-4 [&>button]:top-4 [&>button]:h-8 [&>button]:w-8 [&>button]:rounded-xl [&>button]:bg-slate-200 [&>button]:text-slate-700 [&>button]:opacity-100 [&>button]:hover:bg-slate-300 dark:[&>button]:bg-slate-800 dark:[&>button]:text-slate-200 dark:[&>button]:hover:bg-slate-700"
                : "max-w-2xl border-slate-700 bg-slate-950 text-slate-100"
          }
        >
          {selectedSimilarProcess ? (
            <SimilarProcessDetailContent detail={selectedSimilarProcess} />
          ) : isScenarioDetailModal ? (
            <div className="space-y-5">
              <DialogHeader className="border-b border-slate-200 pb-4 dark:border-slate-800">
                <DialogTitle className="text-2xl font-black text-slate-900 dark:text-slate-100 sm:text-3xl">{selectedCardDetail?.title || "Cenário"}</DialogTitle>
                {selectedCardDetail?.description ? <DialogDescription className="text-base text-slate-600 dark:text-slate-400">{selectedCardDetail.description}</DialogDescription> : null}
              </DialogHeader>
              <span className="inline-flex rounded-full bg-blue-100 px-4 py-1.5 text-sm font-bold text-blue-700 dark:bg-blue-500/20 dark:text-blue-200">{selectedCardDetail?.badgeLabel || "Detalhes"}</span>
              <div className="rounded-xl border border-slate-200 bg-slate-100 p-5 dark:border-slate-800 dark:bg-slate-900/60">
                <p className="mb-2 text-2xl font-black leading-tight text-slate-700 dark:text-slate-100 sm:text-[28px]">{selectedCardDetail?.recommendationTitle || "Próximo passo recomendado:"}</p>
                <p className="text-base leading-relaxed text-slate-600 dark:text-slate-300 sm:text-[19px]">{selectedCardDetail?.recommendationText || ""}</p>
              </div>
              {selectedCardDetail?.sourceNote ? <p className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">{selectedCardDetail.sourceNote}</p> : null}
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
      <Dialog
        open={selectedHistoryCase !== null}
        onOpenChange={(open) => {
          if (open) return;
          setSelectedHistoryCase(null);
        }}
      >
        <DialogContent className="w-[calc(100%-1.5rem)] max-w-6xl max-h-[90vh] overflow-y-auto border-slate-200 bg-slate-50 text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100">
          <DialogHeader className="border-b border-slate-200 pb-4 dark:border-slate-800">
            <DialogTitle className="text-xl font-black sm:text-2xl">Visão Estratégica Completa do Upload</DialogTitle>
            <DialogDescription className="text-slate-600 dark:text-slate-300">
              {selectedHistoryCase
                ? `${selectedHistoryCase.filename || "Arquivo"} • Processo ${selectedHistoryCase.process_number || selectedHistoryCase.case_id.slice(0, 8)}`
                : ""}
            </DialogDescription>
          </DialogHeader>

          {!isDemoMode && caseDashboardContextQuery.isLoading ? (
            <div className="py-10 text-center text-sm text-slate-600 dark:text-slate-300">Carregando comparativos deste upload...</div>
          ) : !isDemoMode && caseDashboardContextQuery.isError ? (
            <div className="mt-4 rounded-xl border border-red-500/30 bg-red-950/30 p-4 text-sm text-red-200">
              Falha ao carregar visão completa: {caseDashboardContextQuery.error instanceof Error ? caseDashboardContextQuery.error.message : "erro desconhecido"}
            </div>
          ) : selectedHistoryContextData ? (
            <UploadHistoryCompleteInsights
              data={selectedHistoryContextData}
              caseItem={selectedHistoryCase}
            />
          ) : (
            <div className="py-10 text-center text-sm text-slate-600 dark:text-slate-300">Sem dados de contexto para este upload.</div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function VisaoGeralView({
  data,
  radarData,
  referenceProcessNumber,
  onOpenStrategicRecommendations,
  onOpenCardDetail,
}: {
  data: DashboardData;
  radarData: Array<{ subject: string; A: number; B: number }>;
  referenceProcessNumber: string | null;
  onOpenStrategicRecommendations: () => void;
  onOpenCardDetail: (detail: CardDetail) => void;
}) {
  const weeklyActivity = data.visao_geral.weekly_activity;
  const bestWeekDay = weeklyActivity.length
    ? weeklyActivity.reduce((best, item) => (item.value > best.value ? item : best), weeklyActivity[0])
    : { name: "-", value: 0 };
  const ctx = data.case_context;
  const displayedProcessNumber = ctx?.process_number?.trim() || referenceProcessNumber;
  const perspectiveLabel = ctx?.user_party === "author" ? "Autor" : ctx?.user_party === "defendant" ? "Réu" : null;
  const favorabilitySummary = resolveDashboardFavorability(data);
  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      {displayedProcessNumber && (
        <div className="mb-6 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/50">
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            Processo: <span className="font-mono">{displayedProcessNumber}</span>
            {ctx?.case_title ? ` — ${ctx.case_title}` : ""}
          </p>
          {perspectiveLabel && (
            <p className="mt-1 text-xs font-medium text-slate-600 dark:text-slate-400">
              Perspectiva: você como <strong>{perspectiveLabel}</strong>
            </p>
          )}
          {favorabilitySummary && (
            <p className="mt-1 text-xs font-semibold text-cyan-700 dark:text-cyan-300">
              {resolveLeadingLabel(favorabilitySummary)} ({formatPercentLabel(favorabilitySummary.userPct)} x {formatPercentLabel(favorabilitySummary.counterpartyPct)})
            </p>
          )}
        </div>
      )}
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
                <div className="flex items-center gap-2 text-[10px] font-bold text-slate-300 uppercase">
                  <div className="w-3 h-3 rounded-full bg-cyan-400"></div> Processo Atual
                </div>
                <div className="flex items-center gap-2 text-[10px] font-bold text-slate-300 uppercase">
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
                <div className="space-y-4 text-sm leading-relaxed text-white/90 dark:text-blue-50/90">
                  {data.visao_geral.insights.slice(0, 3).map((insight, idx) => (
                    <p key={idx}>
                      <strong className="text-white">{insight.title}:</strong> {insight.text}
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
              <MoreHorizontal size={18} className="text-slate-300 cursor-pointer" />
            </div>
            <div className="h-[200px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.visao_geral.weekly_activity}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1e293b" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "#94a3b8" }} />
                  <Tooltip cursor={false} contentStyle={{ borderRadius: "8px", border: "1px solid #334155", background: "#0f172a", color: "#cbd5e1" }} />
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
  referenceProcessNumber,
  onOpenCardDetail,
  onOpenSimilarProcess,
}: {
  data: DashboardData;
  referenceProcessNumber: string | null;
  onOpenCardDetail: (detail: CardDetail) => void;
  onOpenSimilarProcess: (process: SimilarProcessSource) => void;
}) {
  const referenceProcess = data.case_context?.process_number?.trim() || referenceProcessNumber;
  const perspective = data.case_context?.user_party ?? null;
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
        {referenceProcess && (
          <p className="mb-3 text-xs font-medium text-slate-300">
            Processo de referência: <span className="font-mono">{referenceProcess}</span>
          </p>
        )}
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
              perspective={perspective}
              onClick={() => onOpenSimilarProcess(item)}
            />
          ))}
        </div>
      </section>

      <section className={`${PANEL_CLASS} p-5 sm:p-8`}>
        <div className="flex items-center gap-2 mb-8 text-slate-100">
          <ActivitySquare size={20} className="text-cyan-300" />
          <h3 className="font-bold uppercase tracking-tight text-sm">Mapa de Comportamento Judicial (Heatmap)</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-slate-300 font-medium">
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
        <div className="mt-8 flex flex-wrap justify-center gap-3 sm:mt-12 sm:gap-6">
          <HeatmapLegend color="bg-emerald-300 dark:bg-emerald-200" text="Alto (>80%)" />
          <HeatmapLegend color="bg-yellow-200 dark:bg-yellow-100" text="Medio-Alto (70-79%)" />
          <HeatmapLegend color="bg-orange-200 dark:bg-orange-100" text="Medio (60-69%)" />
          <HeatmapLegend color="bg-red-200 dark:bg-red-100" text="Baixo (<50%)" />
        </div>
      </section>

      <section className={`${PANEL_CLASS} p-5 sm:p-8`}>
        <div className="flex items-center gap-2 mb-8 text-slate-100">
          <BarChart3 size={20} className="text-cyan-300" />
          <h3 className="font-bold uppercase tracking-tight text-sm">Benchmark vs Mercado</h3>
        </div>
        <div className="grid gap-8 text-center md:grid-cols-3 md:gap-12">
          {data.inteligencia.benchmark.map((item, idx) => {
            const sampleSummary = formatBenchmarkSampleSummary({
              sampleUser: item.sample_user,
              sampleMarket: item.sample_market,
              minUserObservations: item.min_user_observations,
              minMarketObservations: item.min_market_observations,
            });
            const comparabilityLine = resolveBenchmarkComparabilityLine({
              isComparable: item.is_comparable,
              minUserObservations: item.min_user_observations,
              minMarketObservations: item.min_market_observations,
            });
            const confidenceLine = formatBenchmarkConfidenceLine(item.confidence_label, item.confidence_level);

            return (
              <BenchmarkStat
                key={idx}
                label={item.label}
                user={item.user}
                market={item.market}
                trend={item.trend}
                trendColor={item.trend_color}
                unit={item.unit || ""}
                sampleUser={item.sample_user}
                sampleMarket={item.sample_market}
                minUserObservations={item.min_user_observations}
                minMarketObservations={item.min_market_observations}
                isComparable={item.is_comparable}
                confidenceLevel={item.confidence_level}
                confidenceLabel={item.confidence_label}
                onClick={() =>
                  onOpenCardDetail({
                    title: `Benchmark: ${item.label}`,
                    description: "Comparativo entre escritorio e mercado.",
                    lines: [
                      `Seu escritorio: ${item.user}${item.unit || ""}`,
                      `Mercado: ${item.market}${item.unit || ""}`,
                      `Diferencial: ${item.trend}`,
                      ...(sampleSummary ? [sampleSummary] : []),
                      ...(comparabilityLine ? [comparabilityLine] : []),
                      ...(confidenceLine ? [confidenceLine] : []),
                    ],
                    targetTab: "inteligencia",
                  })
                }
              />
            );
          })}
        </div>
      </section>
    </div>
  );
}

function SimulacoesView({
  data,
  referenceProcessNumber,
  onOpenCardDetail,
  focusedScenarioTitle,
  isDemoMode,
}: {
  data: DashboardData;
  referenceProcessNumber: string | null;
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
      {referenceProcessNumber && (
        <p className="text-xs font-medium text-slate-300">
          Processo de referência: <span className="font-mono">{referenceProcessNumber}</span>
        </p>
      )}

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

      <div className={`${PANEL_CLASS} p-5 sm:p-8`}>
        <div className="flex items-center gap-2 mb-12 text-slate-100">
          <Scale size={20} className="text-cyan-300" />
          <h3 className="font-bold uppercase tracking-tight text-sm">Comparativo de Impacto</h3>
        </div>
        <div className="grid gap-8 md:grid-cols-3 md:gap-12">
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

function GemeoDigitalView({
  data,
  referenceProcessNumber,
  onOpenCardDetail,
}: {
  data: DashboardData;
  referenceProcessNumber: string | null;
  onOpenCardDetail: (detail: CardDetail) => void;
}) {
  const referenceProcess = data.case_context?.process_number?.trim() || referenceProcessNumber;
  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 space-y-6">
      <div className={`${PANEL_CLASS} p-6`}>
        <div className="mb-3 flex items-center gap-2 text-slate-100">
          <Database size={20} className="text-cyan-300" />
          <h3 className="text-lg font-bold">Gêmeo Digital</h3>
        </div>
        <p className="text-sm leading-relaxed text-slate-300">{data.simulacoes.description}</p>
        {referenceProcess && (
          <p className="mt-2 text-xs font-medium text-slate-400">
            Processo de referência: <span className="font-mono">{referenceProcess}</span>
          </p>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {data.simulacoes.scenarios.map((scenario) => {
          const favorabilitySummary = scenario.data.reduce((found: FavorabilitySummary | null, entry) => {
            if (found) return found;
            return resolveFavorabilitySummary({
              favorableToUser: entry.value_favorable_to_user,
              favorableToCounterparty: entry.value_favorable_to_counterparty,
            });
          }, null);

          return (
            <button
              key={scenario.title}
              type="button"
              className={`${PANEL_SOFT_CLASS} p-4 text-left transition-colors hover:border-cyan-500/40`}
              onClick={() =>
                onOpenCardDetail({
                  title: scenario.title,
                  description: scenario.footer,
                  lines: scenario.data.map((entry) => `${entry.label}: ${entry.val}`),
                  targetTab: "inteligencia",
                  targetModule: "simulacoes-avancadas",
                  targetScenarioTitle: scenario.title,
                })
              }
            >
              <p className="text-xs font-bold uppercase tracking-wide text-cyan-200">{scenario.tag}</p>
              <p className="mt-1 text-sm font-bold text-slate-100">{scenario.title}</p>
              {favorabilitySummary && (
                <p className="mt-2 text-xs font-semibold text-cyan-200">
                  {resolveLeadingLabel(favorabilitySummary)} ({formatPercentLabel(favorabilitySummary.userPct)} x {formatPercentLabel(favorabilitySummary.counterpartyPct)})
                </p>
              )}
              <p className="mt-2 text-xs text-slate-300">{scenario.footer}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function AcoesRescisoriasView({
  data,
  referenceProcessNumber,
  highlightedCaseId,
  onOpenFromCandidate,
}: {
  data: DashboardData;
  referenceProcessNumber: string | null;
  highlightedCaseId: string | null;
  onOpenFromCandidate: (caseId: string) => void;
}) {
  const module = data.inteligencia.acoes_rescisorias;
  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 space-y-6">
      <div className={`${PANEL_CLASS} p-6`}>
        <div className="mb-2 flex items-center gap-2 text-slate-100">
          <Scale size={20} className="text-emerald-300" />
          <h3 className="text-lg font-bold">Ações Rescisórias</h3>
        </div>
        <p className="text-sm leading-relaxed text-slate-300">{module.summary}</p>
        <p className="mt-2 text-xs text-slate-400">
          Ferramenta de reversão de decisões transitadas em julgado com análise probabilística e financeira.
        </p>
        {referenceProcessNumber && (
          <p className="mt-2 text-xs font-medium text-slate-300">
            Processo de referência: <span className="font-mono">{referenceProcessNumber}</span>
          </p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {module.kpis.map((kpi, idx) => (
          <div key={`${kpi.label}-${idx}`} className={`${PANEL_SOFT_CLASS} p-4`}>
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-300">{kpi.label}</p>
            <p className="mt-2 text-3xl font-black text-slate-100">{kpi.value}</p>
          </div>
        ))}
      </div>

      <div className={`${PANEL_CLASS} p-5`}>
        <h4 className="text-sm font-bold uppercase tracking-wide text-slate-200">Casos priorizados</h4>
        <div className="mt-4 space-y-3">
          {module.candidates.length === 0 ? (
            <div className={`${PANEL_SOFT_CLASS} p-4 text-sm text-slate-300`}>Nenhum caso com potencial rescisório no recorte atual.</div>
          ) : (
            module.candidates.map((candidate) => {
              const highlighted = highlightedCaseId === candidate.case_id;
              const eligibilityTone =
                candidate.eligibility_status === "eligible"
                  ? "text-emerald-700 bg-emerald-100 border-emerald-300 dark:text-emerald-200 dark:bg-emerald-500/15 dark:border-emerald-500/30"
                  : candidate.eligibility_status === "uncertain"
                    ? "text-amber-700 bg-amber-100 border-amber-300 dark:text-amber-200 dark:bg-amber-500/15 dark:border-amber-500/30"
                    : "text-red-700 bg-red-100 border-red-300 dark:text-red-200 dark:bg-red-500/15 dark:border-red-500/30";

              return (
                <div
                  key={candidate.case_id}
                  className={`rounded-xl border p-4 ${highlighted ? "border-cyan-400 bg-cyan-500/10" : "border-slate-700 bg-slate-900/35"}`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-bold text-slate-100">{candidate.process_number}</p>
                    <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${eligibilityTone}`}>
                      {candidate.eligibility_status}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                    <span className="rounded-md border border-slate-600 bg-slate-900/50 px-2 py-0.5 text-slate-200">Score: {candidate.viability_score}/100</span>
                    <span className="rounded-md border border-slate-600 bg-slate-900/50 px-2 py-0.5 text-slate-200">Recomendação: {candidate.recommendation}</span>
                    <span className="rounded-md border border-slate-600 bg-slate-900/50 px-2 py-0.5 text-slate-200">
                      Líquido proj.: {formatCurrencyBRL(candidate.financial_projection.projected_net_brl)}
                    </span>
                  </div>
                  {candidate.grounds_detected.length > 0 ? (
                    <p className="mt-2 text-xs text-slate-300">Fundamentos: {candidate.grounds_detected.join(" • ")}</p>
                  ) : null}
                  <div className="mt-3">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 border-cyan-400/40 bg-cyan-500/10 text-cyan-100 hover:bg-cyan-500/20"
                      onClick={() => onOpenFromCandidate(candidate.case_id)}
                    >
                      Focar neste caso
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

function UploadHistoryView({
  items,
  isLoading,
  isError,
  errorMessage,
  onReprocessCase,
  isReprocessingCaseId,
  onOpenCompleteAnalysis,
  onDeleteCase,
  isDeletingCaseId,
  serverFilters,
  onServerFiltersChange,
  filterOptions,
  currentPage,
  pageSize,
  totalCount,
  totalPages,
  onPageChange,
  onOpenRescisoriaCase,
}: {
  items: UploadHistoryItem[];
  isLoading: boolean;
  isError: boolean;
  errorMessage: string;
  onReprocessCase: (caseId: string) => void;
  isReprocessingCaseId: string | null;
  onOpenCompleteAnalysis: (item: UploadHistoryItem) => void;
  onDeleteCase: (caseId: string) => void;
  isDeletingCaseId: string | null;
  serverFilters: UploadHistoryQueryFilters;
  onServerFiltersChange: (filters: UploadHistoryQueryFilters) => void;
  filterOptions?: UploadHistoryFilterOptions;
  currentPage: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onOpenRescisoriaCase: (caseId: string) => void;
}) {
  const [expandedCaseIds, setExpandedCaseIds] = useState<string[]>([]);
  const [caseToDelete, setCaseToDelete] = useState<UploadHistoryItem | null>(null);

  const toggleExpanded = (caseId: string) => {
    setExpandedCaseIds((prev) => (prev.includes(caseId) ? prev.filter((id) => id !== caseId) : [...prev, caseId]));
  };

  const summary = useMemo(() => {
    const completed = items.filter((item) => item.ai_status === "completed").length;
    const inFlight = items.filter((item) => isCaseAIInFlight(item.ai_status)).length;
    const requiresAttention = items.filter((item) => item.ai_status === "failed" || item.ai_status === "manual_review" || item.ai_status === "failed_retryable").length;
    return { total: totalCount, completed, inFlight, requiresAttention };
  }, [items, totalCount]);

  const filteredItems = items;

  const hasFilters =
    serverFilters.search.trim().length > 0 ||
    serverFilters.status_filter !== "all" ||
    serverFilters.judge.trim().length > 0 ||
    serverFilters.tribunal.trim().length > 0 ||
    serverFilters.action_type.trim().length > 0;

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 space-y-8">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 bg-cyan-500/20 border border-cyan-400/40 rounded-lg flex items-center justify-center">
          <History className="text-cyan-200 w-6 h-6" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-slate-100">Histórico de Uploads</h2>
          <p className="text-sm text-slate-300">Arquivos enviados, campos extraídos e resultados de IA por processo.</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className={`${PANEL_SOFT_CLASS} p-4`}>
          <p className="text-[10px] uppercase tracking-wider font-bold text-slate-300">Total de uploads</p>
          <p className="mt-2 text-3xl font-black text-slate-100">{summary.total}</p>
        </div>
        <div className={`${PANEL_SOFT_CLASS} p-4`}>
          <p className="text-[10px] uppercase tracking-wider font-bold text-slate-300">Concluídos</p>
          <p className="mt-2 text-3xl font-black text-emerald-300">{summary.completed}</p>
        </div>
        <div className={`${PANEL_SOFT_CLASS} p-4`}>
          <p className="text-[10px] uppercase tracking-wider font-bold text-slate-300">Em processamento</p>
          <p className="mt-2 text-3xl font-black text-cyan-300">{summary.inFlight}</p>
        </div>
        <div className={`${PANEL_SOFT_CLASS} p-4`}>
          <p className="text-[10px] uppercase tracking-wider font-bold text-slate-300">Exigem atenção</p>
          <p className="mt-2 text-3xl font-black text-orange-300">{summary.requiresAttention}</p>
        </div>
      </div>

      <div className={`${PANEL_SOFT_CLASS} p-4`}>
        <div className="grid md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_220px_220px_220px_220px_auto] gap-3 items-end">
          <div>
            <label className="text-xs font-semibold text-slate-300 uppercase">Buscar no histórico</label>
            <input
              value={serverFilters.search}
              onChange={(event) => onServerFiltersChange({ ...serverFilters, search: event.target.value })}
              placeholder="Arquivo, processo, tribunal, juiz..."
              className="mt-1 h-[38px] w-full px-3 border border-slate-700 rounded-md bg-slate-900/70 text-sm text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-300 uppercase">Status IA</label>
            <select
              value={serverFilters.status_filter}
              onChange={(event) =>
                onServerFiltersChange({ ...serverFilters, status_filter: event.target.value as UploadHistoryQueryFilters["status_filter"] })
              }
              className="mt-1 h-[38px] w-full px-3 border border-slate-700 rounded-md bg-slate-900/70 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
            >
              <option value="all">Todos</option>
              <option value="in_flight">Em processamento</option>
              <option value="completed">Concluídos</option>
              <option value="failed">Com falha/revisão</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-300 uppercase">Tribunal</label>
            <select
              value={serverFilters.tribunal}
              onChange={(event) => onServerFiltersChange({ ...serverFilters, tribunal: event.target.value })}
              className="mt-1 h-[38px] w-full px-3 border border-slate-700 rounded-md bg-slate-900/70 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
            >
              <option value="">Todos</option>
              {(filterOptions?.tribunals ?? []).map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-300 uppercase">Juiz</label>
            <select
              value={serverFilters.judge}
              onChange={(event) => onServerFiltersChange({ ...serverFilters, judge: event.target.value })}
              className="mt-1 h-[38px] w-full px-3 border border-slate-700 rounded-md bg-slate-900/70 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
            >
              <option value="">Todos</option>
              {(filterOptions?.judges ?? []).map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-300 uppercase">Tipo da ação</label>
            <select
              value={serverFilters.action_type}
              onChange={(event) => onServerFiltersChange({ ...serverFilters, action_type: event.target.value })}
              className="mt-1 h-[38px] w-full px-3 border border-slate-700 rounded-md bg-slate-900/70 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
            >
              <option value="">Todos</option>
              {(filterOptions?.action_types ?? []).map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
          <div className="md:justify-self-end">
            <Button
              type="button"
              variant="outline"
              className="h-[38px] border-slate-700 bg-slate-900/50 text-slate-100 hover:bg-slate-800"
              disabled={!hasFilters}
              onClick={() => onServerFiltersChange(DEFAULT_UPLOAD_HISTORY_QUERY_FILTERS)}
            >
              Limpar filtros
            </Button>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-slate-300">
          Exibindo{" "}
          {totalCount === 0 ? 0 : (currentPage - 1) * pageSize + 1}
          -
          {Math.min(currentPage * pageSize, totalCount)} de {totalCount}
        </p>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            className="h-8 border-slate-700 bg-slate-900/50 px-3 text-slate-100 hover:bg-slate-800"
            disabled={isLoading || currentPage <= 1}
            onClick={() => onPageChange(Math.max(1, currentPage - 1))}
          >
            Anterior
          </Button>
          <span className="text-xs text-slate-300">
            Página {Math.max(currentPage, 1)} de {Math.max(totalPages, 1)}
          </span>
          <Button
            type="button"
            variant="outline"
            className="h-8 border-slate-700 bg-slate-900/50 px-3 text-slate-100 hover:bg-slate-800"
            disabled={isLoading || currentPage >= Math.max(totalPages, 1)}
            onClick={() => onPageChange(Math.min(Math.max(totalPages, 1), currentPage + 1))}
          >
            Próxima
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className={`${PANEL_SOFT_CLASS} p-6 text-sm text-slate-600 dark:text-slate-300`}>Carregando histórico de uploads...</div>
      ) : isError ? (
        <div className="rounded-xl border border-red-500/30 bg-red-950/30 px-4 py-5 text-sm text-red-200">Falha ao carregar histórico: {errorMessage}</div>
      ) : filteredItems.length === 0 ? (
        <div className={`${PANEL_SOFT_CLASS} p-6 text-sm text-slate-600 dark:text-slate-300`}>
          {hasFilters ? "Nenhum upload encontrado com os filtros aplicados." : "Nenhum upload registrado até o momento."}
        </div>
      ) : (
        <div className="space-y-4">
          {filteredItems.map((item) => {
            const statusMeta = getCaseAIStatusMeta(item.ai_status);
            const createdAtLabel = formatDateTimeLabel(item.created_at);
            const processedAtLabel = formatDateTimeLabel(item.ai_processed_at);
            const retryAtLabel = formatDateTimeLabel(item.ai_next_retry_at);
            const stageProgress = resolveCaseAIProgress(item);
            const stageLabel = resolveCaseAIStageLabel(item);
            const canReprocess = item.ai_status === "failed" || item.ai_status === "manual_review" || item.ai_status === "failed_retryable";
            const isReprocessingThisCase = isReprocessingCaseId === item.case_id;
            const extracted = item.generated_data?.extracted ?? {};
            const keyFacts = Array.isArray(extracted.key_facts)
              ? extracted.key_facts.filter((fact): fact is string => typeof fact === "string" && fact.trim().length > 0).slice(0, 3)
              : [];
            const deadlines = Array.isArray(extracted.deadlines)
              ? extracted.deadlines.filter((deadline) => deadline && typeof deadline.label === "string" && deadline.label.trim().length > 0).slice(0, 3)
              : [];
            const analyzedInputFields = [
              { label: "Arquivo", value: item.filename || "--" },
              { label: "Formato", value: formatContentTypeLabel(item.content_type) },
              { label: "Nº do processo", value: extracted.process_number || item.process_number || "--" },
              { label: "Tribunal", value: extracted.tribunal || item.tribunal || "--" },
              { label: "Autoridade Responsável", value: extracted.authority_display || extracted.judge || item.authority_display || item.judge || "--" },
              { label: "Tipo da ação", value: extracted.action_type || item.action_type || "--" },
              {
                label: "Valor da causa",
                value: formatCurrencyBRL(typeof extracted.claim_value === "number" ? extracted.claim_value : item.claim_value),
              },
              { label: "Status processual", value: extracted.status || item.status || "--" },
            ];
            const populatedAnalyzedFields = analyzedInputFields.filter((entry) => entry.value !== "--" && entry.value !== "Não informado").length;
            const aiMetricsCount = [
              item.generated_data?.success_probability,
              item.generated_data?.settlement_probability,
              item.generated_data?.risk_score,
              item.generated_data?.complexity_score,
              item.generated_data?.expected_decision_months,
            ].filter((value) => typeof value === "number" && Number.isFinite(value)).length;
            const rescisoria = item.generated_data?.rescisoria;
            const isRescisoriaCandidate = typeof rescisoria?.viability_score === "number" && rescisoria.viability_score >= 70;
            const authorityDisplay = item.generated_data?.extracted?.authority_display ?? item.authority_display ?? null;
            const favorabilitySummary = resolveFavorabilitySummary({
              favorableToUser: item.generated_data?.favorable_to_user_pct,
              favorableToCounterparty: item.generated_data?.favorable_to_counterparty_pct,
              successProbability: item.generated_data?.success_probability,
              userParty: item.user_party ?? null,
            });

            const isExpanded = expandedCaseIds.includes(item.case_id);
            const isDeletingThis = isDeletingCaseId === item.case_id;

            return (
              <article
                key={item.case_id}
                className={`${PANEL_SOFT_CLASS} p-5 transition-colors`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-base font-bold text-slate-900 dark:text-slate-100">{item.filename || "Arquivo não identificado"}</p>
                    <p className="text-[12px] text-slate-300">
                      Processo: <span className="font-mono font-semibold">{item.process_number || `Caso ${item.case_id.slice(0, 8)}`}</span>
                      {item.user_party ? (
                        <span className="ml-2 inline-flex rounded-full border border-slate-400 bg-slate-200 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-700 dark:border-slate-500 dark:bg-slate-700 dark:text-slate-200">
                          {item.user_party === "author" ? "Autor" : "Réu"}
                        </span>
                      ) : null}
                      {createdAtLabel ? ` • Enviado em ${createdAtLabel}` : ""}
                      {processedAtLabel ? ` • Último processamento: ${processedAtLabel}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${statusMeta.badge}`}>
                      {statusMeta.label}
                    </span>
                    {isRescisoriaCandidate ? (
                      <span className="inline-flex rounded-full border border-emerald-300 bg-emerald-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-200">
                        Potencial Rescisório
                      </span>
                    ) : null}
                    {canReprocess ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 border-slate-300 bg-white px-3 text-[11px] font-bold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-100 dark:hover:bg-slate-800"
                        disabled={isReprocessingThisCase}
                        onClick={(e) => { e.stopPropagation(); onReprocessCase(item.case_id); }}
                      >
                        {isReprocessingThisCase ? "Reprocessando..." : "Reprocessar AI"}
                      </Button>
                    ) : null}
                    <button
                      type="button"
                      aria-label="Excluir upload"
                      className="rounded-md p-1.5 text-red-400 hover:bg-red-500/15 hover:text-red-300 transition-colors disabled:opacity-50"
                      disabled={isDeletingThis}
                      onClick={(e) => {
                        e.stopPropagation();
                        setCaseToDelete(item);
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-slate-700 dark:text-slate-300">
                  <span className="rounded-md border border-slate-300 bg-slate-100 px-2 py-0.5 dark:border-slate-700 dark:bg-slate-800/60">Tribunal: {item.tribunal || "--"}</span>
                  <span className="rounded-md border border-slate-300 bg-slate-100 px-2 py-0.5 dark:border-slate-700 dark:bg-slate-800/60" title={authorityDisplay || undefined}>Autoridade: {(authorityDisplay || item.judge || "--").length > 50 ? `${(authorityDisplay || item.judge || "--").slice(0, 47)}...` : (authorityDisplay || item.judge || "--")}</span>
                  <span className="rounded-md border border-slate-300 bg-slate-100 px-2 py-0.5 dark:border-slate-700 dark:bg-slate-800/60">Tipo: {item.action_type || "--"}</span>
                  <span className="rounded-md border border-slate-300 bg-slate-100 px-2 py-0.5 dark:border-slate-700 dark:bg-slate-800/60">Valor: {formatCurrencyBRL(item.claim_value)}</span>
                  <span className="rounded-md border border-cyan-300 bg-cyan-100 px-2 py-0.5 text-cyan-800 dark:border-cyan-500/35 dark:bg-cyan-500/10 dark:text-cyan-200">Progresso IA: {stageProgress}%</span>
                  {favorabilitySummary && (
                    <span className="rounded-md border border-emerald-300 bg-emerald-100 px-2 py-0.5 text-emerald-800 dark:border-emerald-500/35 dark:bg-emerald-500/10 dark:text-emerald-200">
                      {resolveLeadingLabel(favorabilitySummary)} ({formatPercentLabel(favorabilitySummary.userPct)} x {formatPercentLabel(favorabilitySummary.counterpartyPct)})
                    </span>
                  )}
                </div>

                <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-800/90">
                  <div className="h-full rounded-full bg-cyan-400 transition-all duration-500" style={{ width: `${stageProgress}%` }} />
                </div>
                <p className="mt-2 text-[11px] text-slate-700 dark:text-slate-300">{stageLabel}</p>
                {retryAtLabel && item.ai_status === "failed_retryable" ? (
                  <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-200">Nova tentativa automática prevista para {retryAtLabel}.</p>
                ) : null}
                {item.ai_last_error ? <p className="mt-1 text-[11px] text-red-700 dark:text-red-200">Último erro: {item.ai_last_error}</p> : null}

                <div className="mt-3">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 gap-1.5 text-cyan-600 hover:text-cyan-400 hover:bg-cyan-500/10 dark:text-cyan-400 dark:hover:text-cyan-300"
                    onClick={() => toggleExpanded(item.case_id)}
                  >
                    {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    {isExpanded ? "Ver menos" : "Ver mais detalhes"}
                  </Button>
                </div>

                {isExpanded ? (
                  <>
                    <div className="mt-4 rounded-lg border border-cyan-200 bg-cyan-50/70 p-3 dark:border-cyan-500/25 dark:bg-cyan-500/10">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-[11px] font-bold uppercase tracking-wide text-cyan-800 dark:text-cyan-200">Dados usados na análise deste documento</p>
                        <span className="rounded-full border border-cyan-300 bg-white px-2 py-0.5 text-[10px] font-bold text-cyan-700 dark:border-cyan-400/40 dark:bg-cyan-500/15 dark:text-cyan-200">
                          {populatedAnalyzedFields}/{analyzedInputFields.length} campos preenchidos
                        </span>
                      </div>
                      <p className="mt-2 text-xs text-slate-700 dark:text-slate-300">
                        A IA gerou os resultados com base nestes dados deste upload específico.
                      </p>
                      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                        {analyzedInputFields.map((field) => (
                          <div key={field.label} className={`rounded-md border border-cyan-200/80 bg-white/85 p-2 dark:border-cyan-500/20 dark:bg-slate-900/40 ${field.label === "Autoridade Responsável" ? "sm:col-span-2 xl:col-span-4" : ""}`}>
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">{field.label}</p>
                            {field.label === "Autoridade Responsável" && field.value !== "--" && field.value.includes("; ") ? (
                              <div className="mt-1.5 space-y-1">
                                {field.value.split("; ").map((line, i) => (
                                  <p key={i} className="text-xs font-medium text-slate-800 dark:text-slate-200 rounded bg-slate-100 dark:bg-slate-800/50 px-2 py-1">{line.trim()}</p>
                                ))}
                              </div>
                            ) : (
                              <p className="mt-1 break-all text-xs font-medium text-slate-800 dark:text-slate-200">{field.value}</p>
                            )}
                          </div>
                        ))}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                        <span className="rounded-md border border-cyan-300 bg-white px-2 py-0.5 text-cyan-700 dark:border-cyan-500/30 dark:bg-slate-900/30 dark:text-cyan-200">
                          Fatos-chave identificados: {keyFacts.length}
                        </span>
                        <span className="rounded-md border border-cyan-300 bg-white px-2 py-0.5 text-cyan-700 dark:border-cyan-500/30 dark:bg-slate-900/30 dark:text-cyan-200">
                          Prazos identificados: {deadlines.length}
                        </span>
                        <span className="rounded-md border border-cyan-300 bg-white px-2 py-0.5 text-cyan-700 dark:border-cyan-500/30 dark:bg-slate-900/30 dark:text-cyan-200">
                          Métricas calculadas: {aiMetricsCount}
                        </span>
                      </div>
                    </div>

                    <div className="mt-4 grid md:grid-cols-2 gap-4">
                      <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900/45">
                        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-600 dark:text-slate-400">Resultado da extração automática</p>
                        <div className="mt-2 space-y-1.5 text-sm text-slate-800 dark:text-slate-200">
                          <p>Título: {extracted.title || item.case_title || "--"}</p>
                          <p>Número: {extracted.process_number || item.process_number || "--"}</p>
                          <p>Status: {extracted.status || item.status || "--"}</p>
                          {keyFacts.length > 0 ? <p>Fatos-chave: {keyFacts.join(" • ")}</p> : null}
                          {deadlines.length > 0 ? (
                            <p>
                              Prazos:{" "}
                              {deadlines
                                .map((deadline) => `${deadline.label}${deadline.due_date ? ` (${formatDateTimeLabel(deadline.due_date) || deadline.due_date})` : ""}`)
                                .join(" • ")}
                            </p>
                          ) : null}
                        </div>
                      </div>

                      <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900/45">
                        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-600 dark:text-slate-400">Resultado da análise da IA</p>
                        <div className="mt-2 space-y-1.5 text-sm text-slate-800 dark:text-slate-200">
                          {favorabilitySummary ? (
                            <div className="rounded-md border border-cyan-200 bg-cyan-50 px-2.5 py-2 text-xs dark:border-cyan-500/30 dark:bg-cyan-500/10">
                              <p className="font-semibold text-cyan-800 dark:text-cyan-100">
                                {resolveLeadingLabel(favorabilitySummary)} no processo {item.process_number || "--"}
                              </p>
                              <p className="mt-1 text-cyan-700 dark:text-cyan-200">
                                Você: {formatPercentLabel(favorabilitySummary.userPct)} • Contraparte: {formatPercentLabel(favorabilitySummary.counterpartyPct)}
                              </p>
                            </div>
                          ) : null}
                          {item.user_party ? (
                            <p>Você neste processo: <strong>{item.user_party === "author" ? "Autor" : "Réu"}</strong></p>
                          ) : null}
                          {item.generated_data?.favorable_to_user_pct != null || item.generated_data?.favorable_to_counterparty_pct != null ? (
                            <>
                              <p className="text-emerald-600 dark:text-emerald-400">Favorável a você: {item.generated_data?.favorable_to_user_pct != null ? `${item.generated_data.favorable_to_user_pct}%` : "--"}</p>
                              <p className="text-amber-600 dark:text-amber-400">Favorável à contraparte: {item.generated_data?.favorable_to_counterparty_pct != null ? `${item.generated_data.favorable_to_counterparty_pct}%` : "--"}</p>
                            </>
                          ) : (
                            <p>Êxito: {formatProbabilityPercent(item.generated_data?.success_probability)}</p>
                          )}
                          <p>Acordo: {formatProbabilityPercent(item.generated_data?.settlement_probability)} <span className="text-[10px] text-slate-500 dark:text-slate-400">(chance de resolução; não indica favorabilidade)</span></p>
                          <p>Risco: {typeof item.generated_data?.risk_score === "number" ? `${Math.round(item.generated_data.risk_score)} / 100` : "--"}</p>
                          <p>Complexidade: {typeof item.generated_data?.complexity_score === "number" ? `${Math.round(item.generated_data.complexity_score)} / 100` : "--"}</p>
                          <p>Tempo estimado: {typeof item.generated_data?.expected_decision_months === "number" ? `${item.generated_data.expected_decision_months.toFixed(1)} meses` : "--"}</p>
                        </div>
                      </div>
                    </div>

                    {item.generated_data?.ai_summary ? (
                      <div className="mt-4 rounded-lg border border-cyan-300 bg-cyan-50 p-3 dark:border-cyan-500/20 dark:bg-cyan-500/10">
                        <p className="text-[11px] font-bold uppercase tracking-wide text-cyan-800 dark:text-cyan-200">Conclusão da IA para este documento</p>
                        <p className="mt-1 text-sm text-slate-800 leading-relaxed dark:text-slate-200">{item.generated_data.ai_summary}</p>
                      </div>
                    ) : null}

                    <div className="mt-4 flex justify-end">
                      {isRescisoriaCandidate ? (
                        <Button
                          type="button"
                          variant="outline"
                          className="mr-2 h-8 border-emerald-300 bg-emerald-50 px-3 text-[11px] font-bold text-emerald-800 hover:bg-emerald-100 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-100 dark:hover:bg-emerald-500/20"
                          onClick={(e) => { e.stopPropagation(); onOpenRescisoriaCase(item.case_id); }}
                        >
                          Abrir Ações Rescisórias deste caso
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        variant="outline"
                        className="h-8 border-cyan-300 bg-cyan-50 px-3 text-[11px] font-bold text-cyan-800 hover:bg-cyan-100 dark:border-cyan-500/40 dark:bg-cyan-500/10 dark:text-cyan-100 dark:hover:bg-cyan-500/20"
                        onClick={(e) => { e.stopPropagation(); onOpenCompleteAnalysis(item); }}
                      >
                        Abrir visão completa deste upload
                      </Button>
                    </div>
                  </>
                ) : null}
              </article>
            );
          })}
        </div>
      )}

      <AlertDialog open={caseToDelete !== null} onOpenChange={(open) => !open && setCaseToDelete(null)}>
        <AlertDialogContent className="border-slate-200 bg-slate-50 text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100">
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir upload?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação irá remover permanentemente este documento e todos os dados relacionados (análises, métricas, prazos). Não é possível desfazer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100" disabled={!!isDeletingCaseId}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700 focus:ring-red-600 dark:bg-red-700 dark:hover:bg-red-800 disabled:opacity-70"
              disabled={!!isDeletingCaseId}
              onClick={() => {
                if (caseToDelete) {
                  onDeleteCase(caseToDelete.case_id);
                  setCaseToDelete(null);
                }
              }}
            >
              {isDeletingCaseId ? "Excluindo…" : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function UploadHistoryCompleteInsights({
  data,
  caseItem,
}: {
  data: DashboardData;
  caseItem: UploadHistoryItem | null;
}) {
  const ctx = data.case_context ?? (caseItem ? { case_id: caseItem.case_id, process_number: caseItem.process_number || "", case_title: caseItem.case_title ?? null, user_party: caseItem.user_party ?? null } : null);
  const perspectiveLabel = ctx?.user_party === "author" ? "Autor" : ctx?.user_party === "defendant" ? "Réu" : null;
  const favorabilitySummary =
    resolveFavorabilitySummary({
      favorableToUser: caseItem?.generated_data?.favorable_to_user_pct,
      favorableToCounterparty: caseItem?.generated_data?.favorable_to_counterparty_pct,
      successProbability: caseItem?.generated_data?.success_probability,
      userParty: ctx?.user_party ?? null,
    }) ?? resolveDashboardFavorability(data);

  return (
    <div className="mt-5 space-y-6">
      {ctx && (
        <section className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/50">
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
            Processo: <span className="font-mono">{ctx.process_number}</span>
            {ctx.case_title ? ` — ${ctx.case_title}` : ""}
          </p>
          {perspectiveLabel && (
            <p className="mt-1 text-xs font-medium text-slate-600 dark:text-slate-400">
              Você neste processo: <strong>{perspectiveLabel}</strong>
            </p>
          )}
        </section>
      )}
      {favorabilitySummary && (
        <section className="rounded-xl border border-cyan-200 bg-cyan-50 p-4 dark:border-cyan-500/30 dark:bg-cyan-500/10">
          <p className="text-[11px] font-bold uppercase tracking-wide text-cyan-800 dark:text-cyan-200">Favorabilidade consolidada do caso</p>
          <p className="mt-1 text-sm font-semibold text-cyan-900 dark:text-cyan-100">
            {resolveLeadingLabel(favorabilitySummary)}
            {ctx?.process_number ? (
              <>
                {" "}• Processo <span className="font-mono">{ctx.process_number}</span>
              </>
            ) : null}
          </p>
          <p className="mt-1 text-xs text-cyan-700 dark:text-cyan-200">
            Você: {formatPercentLabel(favorabilitySummary.userPct)} • Contraparte: {formatPercentLabel(favorabilitySummary.counterpartyPct)}
          </p>
        </section>
      )}
      <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900/60">
        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-600 dark:text-slate-400">Contexto aplicado automaticamente</p>
        <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
          <span className="rounded-md border border-slate-300 bg-slate-100 px-2 py-0.5 dark:border-slate-700 dark:bg-slate-800/60">Tribunal: {data.filters.tribunal}</span>
          <span className="rounded-md border border-slate-300 bg-slate-100 px-2 py-0.5 dark:border-slate-700 dark:bg-slate-800/60">Juiz: {data.filters.juiz}</span>
          <span className="rounded-md border border-slate-300 bg-slate-100 px-2 py-0.5 dark:border-slate-700 dark:bg-slate-800/60">Tipo: {data.filters.tipo_acao}</span>
          <span className="rounded-md border border-slate-300 bg-slate-100 px-2 py-0.5 dark:border-slate-700 dark:bg-slate-800/60">Faixa: {data.filters.faixa_valor}</span>
          <span className="rounded-md border border-slate-300 bg-slate-100 px-2 py-0.5 dark:border-slate-700 dark:bg-slate-800/60">Período: {data.filters.periodo}</span>
        </div>
        {caseItem ? (
          <p className="mt-2 text-xs text-slate-700 dark:text-slate-300">
            Documento de referência: <strong>{caseItem.filename || "arquivo sem nome"}</strong>
          </p>
        ) : null}
      </section>

      <section className="space-y-3">
        <h4 className="text-sm font-bold uppercase tracking-wide text-slate-700 dark:text-slate-300">Métricas principais</h4>
        <div className="grid gap-3 md:grid-cols-3">
          {data.visao_geral.stats.map((metric, idx) => {
            const metricFavorability = resolveFavorabilitySummary({
              favorableToUser: metric.value_favorable_to_user,
              favorableToCounterparty: metric.value_favorable_to_counterparty,
            });
            return (
              <div key={`${metric.title}-${idx}`} className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900/60">
                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{metric.title}</p>
                <p className="mt-2 text-2xl font-black text-slate-900 dark:text-slate-100">{metric.value}</p>
                {(metric.value_favorable_to_user != null || metric.value_favorable_to_counterparty != null) && (
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-xs font-semibold">
                    {metricFavorability && <span className="text-cyan-700 dark:text-cyan-300">{resolveLeadingLabel(metricFavorability)}</span>}
                    {metric.value_favorable_to_user != null && <span className="text-emerald-600 dark:text-emerald-400">Favorável a você: {metric.value_favorable_to_user}</span>}
                    {metric.value_favorable_to_counterparty != null && <span className="text-amber-600 dark:text-amber-400">Favorável à contraparte: {metric.value_favorable_to_counterparty}</span>}
                  </div>
                )}
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{metric.subtitle}</p>
                <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">{metric.footer}</p>
              </div>
            );
          })}
        </div>
      </section>

      <section className="space-y-3">
        <h4 className="text-sm font-bold uppercase tracking-wide text-slate-700 dark:text-slate-300">Scores e comparação de perfil</h4>
        <div className="grid gap-3 md:grid-cols-4">
          {data.visao_geral.scores.map((score, idx) => (
            <div key={`${score.title}-${idx}`} className="rounded-xl border border-slate-200 bg-white p-4 text-center dark:border-slate-800 dark:bg-slate-900/60">
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{score.title}</p>
              <p className="mt-2 text-3xl font-black text-slate-900 dark:text-slate-100">{score.value}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h4 className="text-sm font-bold uppercase tracking-wide text-slate-700 dark:text-slate-300">Processos similares e benchmark</h4>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900/60">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Processos similares</p>
            <div className="mt-3 space-y-2">
              {data.inteligencia.similar_processes.length === 0 ? (
                <p className="text-sm text-slate-600 dark:text-slate-300">Sem registros similares para este recorte.</p>
              ) : (
                data.inteligencia.similar_processes.map((item, idx) => (
                  <div key={`${item.id}-${idx}`} className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/70">
                    <p className="text-xs font-bold text-slate-800 dark:text-slate-100">{item.id}</p>
                    <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                      Similaridade: {item.similarity} • Resultado: {item.result} • Tempo: {item.time}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900/60">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Benchmark vs Mercado</p>
            <div className="mt-3 space-y-2">
              {data.inteligencia.benchmark.map((item, idx) => {
                const sampleSummary = formatBenchmarkSampleSummary({
                  sampleUser: item.sample_user,
                  sampleMarket: item.sample_market,
                  minUserObservations: item.min_user_observations,
                  minMarketObservations: item.min_market_observations,
                });
                const confidenceLine = formatBenchmarkConfidenceLine(item.confidence_label, item.confidence_level);
                return (
                  <div key={`${item.label}-${idx}`} className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/70">
                    <p className="text-xs font-bold text-slate-800 dark:text-slate-100">{item.label}</p>
                    <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                      Seu escritório: {item.user}
                      {item.unit || ""} • Mercado: {item.market}
                      {item.unit || ""} • Tendência: {item.trend}
                    </p>
                    {sampleSummary ? <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{sampleSummary}</p> : null}
                    {confidenceLine ? <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{confidenceLine}</p> : null}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h4 className="text-sm font-bold uppercase tracking-wide text-slate-700 dark:text-slate-300">Simulações e cenários</h4>
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900/60">
          <p className="text-sm text-slate-700 dark:text-slate-200">
            <strong>Gêmeo digital:</strong> {data.simulacoes.description}
          </p>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            {data.simulacoes.scenarios.map((scenario, idx) => {
              const scenarioFavorability = scenario.data.reduce((found: FavorabilitySummary | null, entry) => {
                if (found) return found;
                return resolveFavorabilitySummary({
                  favorableToUser: entry.value_favorable_to_user,
                  favorableToCounterparty: entry.value_favorable_to_counterparty,
                });
              }, null);
              return (
                <div key={`${scenario.title}-${idx}`} className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/70">
                  <p className="text-xs font-bold text-slate-800 dark:text-slate-100">{scenario.title}</p>
                  <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{scenario.tag}</p>
                  {scenarioFavorability && (
                    <p className="mt-1 text-[11px] font-semibold text-cyan-700 dark:text-cyan-300">
                      {resolveLeadingLabel(scenarioFavorability)} ({formatPercentLabel(scenarioFavorability.userPct)} x {formatPercentLabel(scenarioFavorability.counterpartyPct)})
                    </p>
                  )}
                  <div className="mt-2 space-y-1">
                    {scenario.data.map((entry, entryIdx) => (
                      <p key={`${entry.label}-${entryIdx}`} className="text-xs text-slate-700 dark:text-slate-300">
                        {entry.label}: {entry.val}
                      </p>
                    ))}
                  </div>
                  <p className="mt-2 text-[11px] text-slate-600 dark:text-slate-300">{scenario.footer}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h4 className="text-sm font-bold uppercase tracking-wide text-slate-700 dark:text-slate-300">Alertas e insights históricos</h4>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900/60">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Alertas estratégicos</p>
            <div className="mt-3 space-y-2">
              {data.alertas.details.length === 0 ? (
                <p className="text-sm text-slate-600 dark:text-slate-300">Nenhum alerta encontrado para este recorte.</p>
              ) : (
                data.alertas.details.slice(0, 6).map((alert, idx) => (
                  <div key={`${alert.title}-${idx}`} className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/70">
                    <p className="text-xs font-bold text-slate-800 dark:text-slate-100">{alert.title}</p>
                    <p className="mt-1 text-[11px] text-slate-600 dark:text-slate-300">{alert.desc}</p>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900/60">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">Insights narrativos</p>
            <div className="mt-3 space-y-2">
              {data.visao_geral.insights.slice(0, 3).map((insight, idx) => (
                <div key={`${insight.title}-${idx}`} className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/70">
                  <p className="text-xs font-bold text-slate-800 dark:text-slate-100">{insight.title}</p>
                  <p className="mt-1 text-[11px] text-slate-600 dark:text-slate-300">{insight.text}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function AlertasView({
  data,
  referenceProcessNumber,
  dismissedAlerts,
  getAlertKey,
  onViewAlert,
  onResolveAlert,
  onDismissAlert,
  onPrimaryAlertAction,
  onOpenCardDetail,
  forcedCategoryFilter,
  onForcedCategoryApplied,
}: {
  data: DashboardData & { alertas: { counts: DashboardData["alertas"]["counts"]; details: DashboardAlertItem[] } };
  referenceProcessNumber: string | null;
  dismissedAlerts: string[];
  getAlertKey: (item: DashboardAlertItem) => string;
  onViewAlert: (item: DashboardAlertItem) => void;
  onResolveAlert: (item: DashboardAlertItem) => void;
  onDismissAlert: (item: DashboardAlertItem) => void;
  onPrimaryAlertAction: (item: DashboardAlertItem) => void;
  onOpenCardDetail: (detail: CardDetail) => void;
  forcedCategoryFilter: AlertCategory | null;
  onForcedCategoryApplied: () => void;
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
  useEffect(() => {
    if (!forcedCategoryFilter) return;
    setActiveCategoryFilter(forcedCategoryFilter);
    onForcedCategoryApplied();
  }, [forcedCategoryFilter, onForcedCategoryApplied]);
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
        <div>
          <h2 className="text-2xl font-bold text-slate-100">Alertas Estratégicos</h2>
          {referenceProcessNumber && (
            <p className="text-xs font-medium text-slate-300">
              Processo de referência: <span className="font-mono">{referenceProcessNumber}</span>
            </p>
          )}
        </div>
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
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-300">
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
        <DialogTitle className="flex items-center gap-2 text-2xl font-black leading-tight text-slate-900 dark:text-slate-100 sm:text-4xl">
          <FileText size={22} className="text-slate-900 dark:text-slate-100" /> Processo {processLabel}
        </DialogTitle>
        <DialogDescription className="text-sm text-slate-600 dark:text-slate-400">{detail.lgpdNotice}</DialogDescription>
      </DialogHeader>

      <section className="grid md:grid-cols-2 gap-4">
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900/70">
          <p className="text-xs font-bold uppercase text-slate-600 dark:text-slate-400 tracking-wider mb-2">Similaridade</p>
          <p className="text-3xl font-black text-slate-900 dark:text-slate-100 sm:text-4xl">{detail.similarity}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900/70">
          <p className="text-xs font-bold uppercase text-slate-600 dark:text-slate-400 tracking-wider mb-2">Resultado</p>
          <p className={`flex items-center gap-2 text-2xl font-black sm:text-3xl ${resultIsPositive ? "text-emerald-600 dark:text-emerald-300" : "text-amber-600 dark:text-amber-300"}`}>
            {resultIsPositive ? <CheckSquare size={20} /> : <AlertTriangle size={20} />} {detail.resultLabel}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900/70">
          <p className="text-xs font-bold uppercase text-slate-600 dark:text-slate-400 tracking-wider mb-2">Tempo de tramitação</p>
          <p className="text-3xl font-black text-slate-900 dark:text-slate-100 sm:text-4xl">{detail.time}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900/70">
          <p className="text-xs font-bold uppercase text-slate-600 dark:text-slate-400 tracking-wider mb-2">Tipo de desfecho</p>
          <p className="break-words text-2xl font-black text-slate-900 dark:text-slate-100 sm:text-4xl">{detail.closureType}</p>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="flex items-center gap-2 text-xl font-black text-slate-900 dark:text-slate-100 sm:text-3xl">
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
        <h3 className="flex items-center gap-2 text-xl font-black text-slate-900 dark:text-slate-100 sm:text-3xl">
          <Clock size={20} /> Linha do Tempo
        </h3>
        <div className="relative pl-8">
          <div className="absolute left-[13px] top-2 bottom-2 w-px bg-slate-300 dark:bg-slate-700"></div>
          <div className="space-y-6">
            {detail.timeline.map((event, index) => (
              <div key={index} className="relative">
                <span className="absolute -left-[28px] top-2 h-4 w-4 rounded-full bg-sky-500 ring-4 ring-sky-100 dark:ring-sky-900/60"></span>
                <p className="text-sm font-bold text-slate-600 dark:text-slate-400">{event.date}</p>
                <div className="mt-2 rounded-xl border border-slate-200 bg-slate-100 p-5 dark:border-slate-800 dark:bg-slate-900/60">
                  <p className="mb-2 text-xl font-black text-slate-900 dark:text-slate-100 sm:text-2xl">{event.title}</p>
                  <p className="text-base text-slate-600 dark:text-slate-300">{event.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="flex items-center gap-2 text-xl font-black text-slate-900 dark:text-slate-100 sm:text-3xl">
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
        <h3 className="flex items-center gap-2 text-xl font-black text-slate-900 dark:text-slate-100 sm:text-3xl">
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
        <h3 className="flex items-center gap-2 text-xl font-black text-slate-900 dark:text-slate-100 sm:text-3xl">
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
        <h3 className="flex items-center gap-2 text-xl font-black text-slate-900 dark:text-slate-100 sm:text-3xl">
          <Scale size={20} /> Comparação com Seu Processo
        </h3>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900/70">
            <p className="text-xs font-bold uppercase text-slate-600 dark:text-slate-400 tracking-wider mb-2">Similaridade geral</p>
            <p className="text-3xl font-black text-slate-900 dark:text-slate-100 sm:text-4xl">{detail.comparison.similarity}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900/70">
            <p className="text-xs font-bold uppercase text-slate-600 dark:text-slate-400 tracking-wider mb-2">Probabilidade de êxito similar</p>
            <p className="text-3xl font-black text-emerald-600 dark:text-emerald-300 sm:text-4xl">{detail.comparison.successProbability}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900/70">
            <p className="text-xs font-bold uppercase text-slate-600 dark:text-slate-400 tracking-wider mb-2">Tempo estimado similar</p>
            <p className="text-3xl font-black text-slate-900 dark:text-slate-100 sm:text-4xl">{detail.comparison.estimatedTime}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900/70">
            <p className="text-xs font-bold uppercase text-slate-600 dark:text-slate-400 tracking-wider mb-2">Recomendação principal</p>
            <p className="break-words text-2xl font-black text-sky-600 dark:text-sky-300 sm:text-4xl">{detail.comparison.primaryRecommendation}</p>
          </div>
        </div>
      </section>
    </div>
  );
}

function InputField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return (
    <div className="flex w-full min-w-0 flex-col gap-2.5">
      <label className={UPLOAD_FORM_LABEL}>{label}</label>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-[38px] w-full min-w-0 rounded-md border border-slate-700 bg-slate-900/70 px-3 text-sm text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
      />
    </div>
  );
}

function SimilarProcessCard({ id, similarity, result, time, type, resultColor = "emerald", perspective = null, onClick }: any) {
  const tone = resultTone(resultColor);
  const normalizedResult = normalizeSearchText(result || "");
  const isOpenOutcome = normalizedResult.includes("sem desfecho");
  const isAuthorPositive = !isOpenOutcome && resultColor !== "red";
  const userLeading =
    perspective === "author" ? isAuthorPositive : perspective === "defendant" ? !isAuthorPositive : null;
  const trendLabel =
    userLeading == null
      ? "Sem perspectiva definida"
      : isOpenOutcome
      ? "Sem desfecho comparável"
      : userLeading
      ? "Tendência favorável a você"
      : "Tendência favorável à contraparte";

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
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
        <div>
          <p className="text-[10px] text-slate-300 font-bold uppercase mb-2">Resultado</p>
          <div className="flex items-center gap-1">
            <div className={`w-2 h-2 rounded-full ${tone.dot}`}></div>
            <span className={`text-xs font-bold ${tone.text}`}>{result}</span>
          </div>
        </div>
        <div>
          <p className="text-[10px] text-slate-300 font-bold uppercase mb-2">Tempo</p>
          <span className="text-xs font-bold text-slate-200">{time}</span>
        </div>
        <div>
          <p className="text-[10px] text-slate-300 font-bold uppercase mb-2">Tipo</p>
          <span className="text-xs font-bold text-slate-200">{type}</span>
        </div>
      </div>
      <div className="mt-3 rounded-md border border-cyan-500/25 bg-cyan-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-cyan-100">
        {trendLabel}
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
      <span className="text-[10px] font-bold text-slate-300 uppercase tracking-widest">{text}</span>
    </div>
  );
}

function formatBenchmarkMetricValue(value: unknown, unit: unknown): string {
  const valueText = typeof value === "number" ? String(value) : String(value ?? "").trim();
  const unitText = String(unit ?? "").trim();
  if (!unitText || !valueText) return valueText;

  if (valueText.toLowerCase().endsWith(unitText.toLowerCase())) {
    return valueText;
  }

  const attachWithoutSpace = unitText === "%" || unitText.startsWith("%") || unitText.startsWith("°") || unitText === "x";
  return attachWithoutSpace ? `${valueText}${unitText}` : `${valueText} ${unitText}`;
}

function formatBenchmarkSampleSummary({
  sampleUser,
  sampleMarket,
  minUserObservations,
  minMarketObservations,
}: {
  sampleUser?: number;
  sampleMarket?: number;
  minUserObservations?: number;
  minMarketObservations?: number;
}): string | null {
  if (typeof sampleUser !== "number" && typeof sampleMarket !== "number") return null;
  const userLabel =
    typeof sampleUser === "number"
      ? `${sampleUser}${typeof minUserObservations === "number" ? `/${minUserObservations}` : ""}`
      : "N/D";
  const marketLabel =
    typeof sampleMarket === "number"
      ? `${sampleMarket}${typeof minMarketObservations === "number" ? `/${minMarketObservations}` : ""}`
      : "N/D";
  return `Amostra (seu/mercado): ${userLabel} • ${marketLabel}`;
}

function resolveBenchmarkComparabilityLine({
  isComparable,
  minUserObservations,
  minMarketObservations,
}: {
  isComparable?: boolean;
  minUserObservations?: number;
  minMarketObservations?: number;
}): string | null {
  if (isComparable !== false) return null;
  if (typeof minUserObservations === "number" && typeof minMarketObservations === "number") {
    return `Comparação liberada a partir de ${minUserObservations} observações do seu escritório e ${minMarketObservations} do mercado.`;
  }
  return "Comparação bloqueada por amostra insuficiente.";
}

function formatBenchmarkConfidenceLine(confidenceLabel?: string, confidenceLevel?: string): string | null {
  const label = (confidenceLabel || "").trim();
  if (label) return `Confiabilidade da comparação: ${label}`;
  if (!confidenceLevel) return null;
  if (confidenceLevel === "high") return "Confiabilidade da comparação: Alta";
  if (confidenceLevel === "medium") return "Confiabilidade da comparação: Média";
  if (confidenceLevel === "low") return "Confiabilidade da comparação: Baixa";
  return null;
}

function benchmarkConfidenceTone(level?: string): string {
  if (level === "high") return "border border-emerald-500/40 bg-emerald-500/15 text-emerald-200";
  if (level === "medium") return "border border-amber-500/40 bg-amber-500/15 text-amber-200";
  return "border border-slate-500/40 bg-slate-500/15 text-slate-200";
}

function BenchmarkStat({
  label,
  user,
  market,
  trend,
  trendColor,
  unit = "",
  sampleUser,
  sampleMarket,
  minUserObservations,
  minMarketObservations,
  isComparable,
  confidenceLevel,
  confidenceLabel,
  onClick,
}: any) {
  const tone = trendTone(trendColor);
  const userValue = formatBenchmarkMetricValue(user, unit);
  const marketValue = formatBenchmarkMetricValue(market, unit);
  const sampleSummary = formatBenchmarkSampleSummary({ sampleUser, sampleMarket, minUserObservations, minMarketObservations });
  const comparabilityLine = resolveBenchmarkComparabilityLine({ isComparable, minUserObservations, minMarketObservations });
  const confidenceLine = formatBenchmarkConfidenceLine(confidenceLabel, confidenceLevel);
  const confidenceTone = benchmarkConfidenceTone(confidenceLevel);
  const leadershipLabel =
    trendColor === "emerald"
      ? "Seu escritório à frente"
      : trendColor === "orange"
        ? "Mercado à frente"
        : "Comparação inconclusiva";
  return (
    <button type="button" onClick={onClick} className="cursor-pointer text-left transition-opacity hover:opacity-95 md:text-center">
      <p className="text-[10px] text-slate-300 font-bold uppercase tracking-widest mb-6">{label}</p>
      <div className="mb-4 flex flex-wrap items-center justify-center gap-4 sm:gap-8">
        <div>
          <div className="mb-1 whitespace-nowrap text-3xl font-black text-cyan-300">{userValue}</div>
          <p className="text-[9px] font-bold text-slate-300 uppercase">Seu Escritorio</p>
        </div>
        <div className="text-slate-300 font-light text-xl">vs</div>
        <div>
          <div className="mb-1 whitespace-nowrap text-3xl font-black text-slate-100">{marketValue}</div>
          <p className="text-[9px] font-bold text-slate-300 uppercase">Mercado</p>
        </div>
      </div>
      <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${tone}`}>
        <TrendingUp size={12} /> {trend}
      </div>
      <p className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-slate-300">{leadershipLabel}</p>
      {sampleSummary ? <p className="mt-2 text-[10px] text-slate-400">{sampleSummary}</p> : null}
      {comparabilityLine ? <p className="mt-1 text-[10px] text-cyan-300">{comparabilityLine}</p> : null}
      {confidenceLine ? <p className={`mt-1 inline-flex rounded-full px-2 py-1 text-[10px] font-semibold ${confidenceTone}`}>{confidenceLine}</p> : null}
    </button>
  );
}

function ScenarioCard({ id, title, tag, tagColor, data, footer, onClick, isFocused = false }: any) {
  const tone = tagTone(tagColor);
  const favorabilitySummary = data.reduce((found: FavorabilitySummary | null, item: { value_favorable_to_user?: string | null; value_favorable_to_counterparty?: string | null }) => {
    if (found) return found;
    return resolveFavorabilitySummary({
      favorableToUser: item.value_favorable_to_user,
      favorableToCounterparty: item.value_favorable_to_counterparty,
    });
  }, null);

  return (
    <button
      id={id}
      type="button"
      onClick={onClick}
      className={`${PANEL_SOFT_CLASS} flex h-full cursor-pointer flex-col overflow-hidden text-left transition-colors hover:border-cyan-500/40 ${
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
        {favorabilitySummary && (
          <div className="mb-5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-cyan-100">
            {resolveLeadingLabel(favorabilitySummary)} ({formatPercentLabel(favorabilitySummary.userPct)} x {formatPercentLabel(favorabilitySummary.counterpartyPct)})
          </div>
        )}
        <div className="space-y-6 flex-1">
          {data.map((d: { label: string; val: string; color?: string; value_favorable_to_user?: string | null; value_favorable_to_counterparty?: string | null }, i: number) => (
            <div key={i} className="flex flex-col gap-1">
              <div className="flex justify-between items-center">
                <span className="text-xs text-slate-300 font-medium">{d.label}</span>
                <span className={`text-sm font-black ${valueTone(d.color)}`}>{d.val}</span>
              </div>
              {(d.value_favorable_to_user != null || d.value_favorable_to_counterparty != null) && (
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] font-semibold pl-0.5">
                  {d.value_favorable_to_user != null && <span className="text-emerald-400">Favorável a você: {d.value_favorable_to_user}</span>}
                  {d.value_favorable_to_counterparty != null && <span className="text-amber-400/90">Favorável à contraparte: {d.value_favorable_to_counterparty}</span>}
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="mt-8 pt-6 border-t border-slate-800">
          <p className="text-[11px] text-slate-300 leading-relaxed italic">{footer}</p>
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
      <p className="text-[10px] text-slate-300 font-bold uppercase tracking-widest mb-6">{label}</p>
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
      className={`${PANEL_SOFT_CLASS} w-full cursor-pointer p-6 text-center transition-colors ${
        isActive ? "border-cyan-400/80 ring-2 ring-cyan-400/25" : "hover:border-cyan-500/40"
      }`}
    >
      <div className={`text-4xl font-black mb-2 ${tone}`}>{count}</div>
      <div className="text-[10px] font-bold text-slate-300 uppercase tracking-widest">{label}</div>
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
      <div className="flex flex-1 items-start gap-4 p-4 sm:gap-6 sm:p-6">
        <div className={`${c.bg} p-3 rounded-lg ${c.color} shrink-0`}>{c.icon}</div>
        <div className="flex-1">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              <span className={`${c.tagBg} text-white text-[9px] font-black px-2 py-0.5 rounded`}>{c.tag}</span>
              <span className="text-[10px] text-slate-300 font-medium">{time}</span>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={(event) => {
                  event.stopPropagation();
                  onView();
                }}
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-slate-300 hover:text-slate-200"
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
                className="h-6 w-6 text-slate-300 hover:text-slate-200"
              >
                <CheckSquare size={14} />
              </Button>
            </div>
          </div>
          <h4 className="mb-2 font-black text-slate-100">{title}</h4>
          <p className="mb-6 text-xs leading-relaxed text-slate-300">{desc}</p>
          <div className="flex flex-wrap gap-2 sm:gap-3">
            <Button
              onClick={(event) => {
                event.stopPropagation();
                onPrimaryAction();
              }}
              size="sm"
              className="h-8 min-w-[120px] gap-2 bg-cyan-500 px-4 text-[11px] font-bold text-slate-950 hover:bg-cyan-400"
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
              className="h-8 min-w-[120px] border-slate-700 bg-slate-900/40 px-4 text-[11px] font-bold text-slate-300 hover:bg-slate-800"
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
      <div className="text-[9px] font-black text-slate-300 uppercase tracking-[0.2em]">{title}</div>
      <div className={`w-full h-1 mt-6 rounded-full bg-slate-800 overflow-hidden`}>
        <div className={`h-full ${tone.bar}`} style={{ width: `${value}%` }}></div>
      </div>
    </button>
  );
}

function TabButton({ active, icon, text, onClick, badgeCount = 0, variant = "default" }: any) {
  const isStrategic = variant === "strategic" || variant === "strategic-sidebar";
  const isStrategicSidebar = variant === "strategic-sidebar";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center justify-center gap-2 rounded-md px-3 text-[12px] font-medium leading-tight transition-all sm:text-[13px] ${
        isStrategic
          ? isStrategicSidebar
            ? "min-h-[48px] border py-2.5"
            : "min-h-[46px] border lg:w-full"
          : "min-h-[40px] py-2 lg:w-auto lg:min-h-[36px] lg:flex-none lg:whitespace-nowrap"
      } ${
        active
          ? isStrategic
            ? isStrategicSidebar
              ? "justify-start border-cyan-300/70 bg-gradient-to-r from-cyan-500 to-blue-500 px-3.5 text-left text-white shadow-[0_10px_28px_rgba(8,145,178,0.35)] ring-1 ring-cyan-300/45"
              : "border-cyan-300/70 bg-gradient-to-r from-cyan-500 to-blue-500 text-white shadow-[0_10px_28px_rgba(8,145,178,0.35)] ring-1 ring-cyan-300/45"
            : "bg-blue-600 text-white shadow-sm"
          : isStrategic
            ? isStrategicSidebar
              ? "justify-start border-slate-300 bg-white px-3.5 py-2.5 text-left text-slate-800 hover:border-cyan-400/60 hover:bg-cyan-50 hover:text-slate-900 dark:border-slate-700/80 dark:bg-slate-950/45 dark:text-slate-100 dark:hover:border-cyan-500/35 dark:hover:bg-slate-900/75 dark:hover:text-cyan-100"
              : "border-slate-300 bg-white py-2.5 text-slate-800 hover:border-cyan-400/60 hover:bg-cyan-50 hover:text-slate-900 dark:border-slate-700/80 dark:bg-slate-950/45 dark:text-slate-100 dark:hover:border-cyan-500/35 dark:hover:bg-slate-900/75 dark:hover:text-cyan-100"
            : "text-slate-700 hover:bg-slate-200 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
      }`}
    >
      <span className={isStrategic && !active ? "text-cyan-700 dark:text-cyan-300" : ""}>{icon}</span>
      <span className={isStrategic ? `font-semibold tracking-[0.01em] ${isStrategicSidebar ? "text-left" : ""}` : ""}>{text}</span>
      {badgeCount > 0 ? (
        <span
          className={`inline-flex min-w-5 items-center justify-center rounded-full border px-1.5 py-0.5 text-[10px] font-black ${
            isStrategic
              ? active
                ? "border-white/40 bg-white/20 text-white"
                : "border-cyan-300 bg-cyan-50 text-cyan-700 dark:border-cyan-300/35 dark:bg-cyan-500/20 dark:text-cyan-100"
              : "border-cyan-300/35 bg-cyan-500/25 text-cyan-100"
          }`}
        >
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
    <div className="flex w-full flex-col gap-1">
      <label className="text-xs font-semibold text-slate-300 uppercase">{label}</label>
      <select
        className="h-[38px] w-full min-w-0 rounded-md border border-slate-700 bg-slate-900/70 px-3 text-sm text-slate-100 cursor-pointer hover:border-cyan-400 sm:min-w-[170px]"
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

function MetricCard({
  title,
  value,
  subtitle,
  footer,
  color,
  updated,
  warning,
  value_favorable_to_user,
  value_favorable_to_counterparty,
  onClick,
}: {
  title: string;
  value: string;
  subtitle: string;
  footer: string;
  color: string;
  updated?: string | null;
  warning?: string | null;
  value_favorable_to_user?: string | null;
  value_favorable_to_counterparty?: string | null;
  onClick?: () => void;
}) {
  const tone = metricTone(color);
  const hasPerspective = value_favorable_to_user != null || value_favorable_to_counterparty != null;
  const favorabilitySummary = resolveFavorabilitySummary({
    favorableToUser: value_favorable_to_user,
    favorableToCounterparty: value_favorable_to_counterparty,
  });
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${PANEL_SOFT_CLASS} relative flex h-full w-full cursor-pointer flex-col justify-between overflow-hidden p-6 text-left transition-colors hover:border-cyan-500/40`}
    >
      <div className={`absolute top-0 left-0 w-1 h-full ${tone.line}`}></div>
      <div className="mb-4">
        <div className="flex items-center gap-2 mb-4">
          <FileText className={`w-4 h-4 text-cyan-300`} />
          <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wide">{title}</h4>
        </div>
        <div className="text-4xl font-black text-slate-100 mb-2">{value}</div>
        {hasPerspective && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 mb-2 text-sm font-semibold">
            {favorabilitySummary && (
              <span className="text-cyan-300">{resolveLeadingLabel(favorabilitySummary)}</span>
            )}
            {value_favorable_to_user != null && (
              <span className="text-emerald-400">Favorável a você: {value_favorable_to_user}</span>
            )}
            {value_favorable_to_counterparty != null && (
              <span className="text-amber-400/90">Favorável à contraparte: {value_favorable_to_counterparty}</span>
            )}
          </div>
        )}
        <div className="text-sm text-slate-300 font-medium">{subtitle}</div>
      </div>

      <div className="pt-4 border-t border-slate-800 flex flex-col gap-2">
        <div className="flex items-center gap-2 text-[10px] font-bold text-slate-300 uppercase tracking-tight">
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
