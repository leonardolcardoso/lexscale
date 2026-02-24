import type { DashboardData, DashboardFilters } from "@/types/dashboard";

const TRIBUNAL_FACTORS: Record<string, number> = {
  "Todos os Tribunais": 1,
  TJSP: 1.12,
  TJRJ: 1.04,
  TJDFT: 0.95,
  TRF5: 0.9,
  TRT2: 1.08,
  TRF3: 0.98,
  STJ: 0.82,
};

const JUDGE_FACTORS: Record<string, number> = {
  "Todos os Juizes": 1,
  "Dr. Joao Silva": 1.05,
  "Dra. Maria Santos": 0.98,
  "Dr. Pedro Oliveira": 0.94,
};

const ACTION_FACTORS: Record<string, number> = {
  "Todos os Tipos": 1,
  Trabalhista: 1.08,
  Civel: 1.01,
  Tributario: 0.9,
  Comercial: 1.13,
  Familia: 0.96,
};

const CLAIM_FACTORS: Record<string, number> = {
  "Todos os Valores": 1,
  "0-100k": 1.22,
  "100k-500k": 1,
  ">500k": 0.72,
};

const PERIOD_FACTORS: Record<string, number> = {
  "Ultimos 3 meses": 0.62,
  "Ultimos 6 meses": 1,
  "Ultimos 12 meses": 1.64,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, decimals = 0): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function hashString(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededBetween(seed: number, salt: string, min: number, max: number): number {
  const local = hashString(`${seed}:${salt}`);
  const ratio = (local % 1000) / 999;
  return min + (max - min) * ratio;
}

function formatHours(value: number): string {
  return `${round(value, 1).toFixed(1)}h`;
}

function formatMonths(value: number): string {
  return `${round(value, 1).toFixed(1)} meses`;
}

function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}

function buildCaseId(seed: number, salt: string): string {
  const local = hashString(`${seed}:${salt}`);
  const year = 2022 + (local % 4);
  const serial = 1000 + (Math.floor(local / 7) % 9000);
  return `PROC-${year}-${serial}`;
}

function reorderColumns(baseColumns: string[], selectedTribunal: string): string[] {
  if (!selectedTribunal || selectedTribunal === "Todos os Tribunais" || !baseColumns.includes(selectedTribunal)) {
    return baseColumns;
  }
  return [selectedTribunal, ...baseColumns.filter((item) => item !== selectedTribunal)];
}

export function buildMockDashboardData(filters: DashboardFilters): DashboardData {
  const now = new Date();
  const filterKey = `${filters.tribunal}|${filters.juiz}|${filters.tipo_acao}|${filters.faixa_valor}|${filters.periodo}`;
  const seed = hashString(filterKey);

  const tribunalFactor = TRIBUNAL_FACTORS[filters.tribunal] ?? 1;
  const judgeFactor = JUDGE_FACTORS[filters.juiz] ?? 1;
  const actionFactor = ACTION_FACTORS[filters.tipo_acao] ?? 1;
  const claimFactor = CLAIM_FACTORS[filters.faixa_valor] ?? 1;
  const periodFactor = PERIOD_FACTORS[filters.periodo] ?? 1;

  const demandFactor = tribunalFactor * claimFactor * periodFactor;
  const strategyFactor = judgeFactor * actionFactor;

  const selectedTribunal = filters.tribunal === "Todos os Tribunais" ? "TJSP" : filters.tribunal;
  const selectedJudge = filters.juiz === "Todos os Juizes" ? "Dr. Joao Silva" : filters.juiz;
  const selectedAction = filters.tipo_acao === "Todos os Tipos" ? "Trabalhista" : filters.tipo_acao;

  const processedDocuments = Math.max(
    120,
    Math.round(1247 * demandFactor * seededBetween(seed, "docs-noise", 0.94, 1.06)),
  );
  const savedHours = clamp(3.4 * strategyFactor * seededBetween(seed, "hours-noise", 0.9, 1.1), 1.8, 6.9);
  const precision = clamp(
    98.7 + (strategyFactor - 1) * 1.8 - (demandFactor - 1) * 1.4 + seededBetween(seed, "precision-noise", -0.5, 0.5),
    95.1,
    99.9,
  );

  const riskScore = clamp(
    Math.round(38 + (1 - actionFactor) * 50 + (filters.faixa_valor === ">500k" ? 10 : 0) + seededBetween(seed, "risk", -6, 6)),
    19,
    92,
  );
  const complexityScore = clamp(Math.round(46 + (demandFactor - 1) * 14 + seededBetween(seed, "complexity", -6, 6)), 24, 94);
  const agreementScore = clamp(
    Math.round(72 + (strategyFactor - 1) * 22 - (riskScore - 50) * 0.28 + seededBetween(seed, "agreement", -5, 5)),
    28,
    96,
  );
  const confidenceScore = clamp(
    Math.round(78 + (precision - 97) * 4 - (complexityScore - 50) * 0.18 + seededBetween(seed, "confidence", -4, 4)),
    44,
    98,
  );

  const radar = [
    { subject: "Provas", baseCurrent: 71, baseCluster: 65 },
    { subject: "Jurisprudencia", baseCurrent: 79, baseCluster: 69 },
    { subject: "Risco financeiro", baseCurrent: 57, baseCluster: 61 },
    { subject: "Tempo processual", baseCurrent: 62, baseCluster: 58 },
    { subject: "Chance de acordo", baseCurrent: 76, baseCluster: 63 },
  ].map((item, index) => {
    const current = clamp(
      Math.round(
        item.baseCurrent +
          (agreementScore - 70) * 0.2 -
          (riskScore - 45) * 0.15 +
          seededBetween(seed, `radar-current-${index}`, -4, 4),
      ),
      35,
      95,
    );
    const cluster = clamp(
      Math.round(item.baseCluster + (demandFactor - 1) * 10 + seededBetween(seed, `radar-cluster-${index}`, -3, 3)),
      30,
      90,
    );
    return {
      subject: item.subject,
      current,
      cluster_avg: cluster,
    };
  });

  const weeklyWeights = [0.17, 0.21, 0.19, 0.24, 0.19];
  const weeklyLabels = ["Seg", "Ter", "Qua", "Qui", "Sex"];
  const weeklyActivity = weeklyLabels.map((name, index) => ({
    name,
    value: Math.max(
      8,
      Math.round(processedDocuments * weeklyWeights[index] * 0.09 + seededBetween(seed, `week-${index}`, -3, 4)),
    ),
  }));

  const daysUntilCritical = Math.max(1, Math.round(seededBetween(seed, "days-critical", 1, 3)));
  const daysUntilWarning = Math.max(3, Math.round(seededBetween(seed, "days-warning", 4, 8)));
  const daysUntilInfo = Math.max(7, Math.round(seededBetween(seed, "days-info", 9, 14)));

  const marketSuccess = clamp(
    Math.round(58 + (tribunalFactor - 1) * 12 + seededBetween(seed, "market-success", -3, 3)),
    45,
    85,
  );
  const userSuccess = clamp(Math.round(marketSuccess + seededBetween(seed, "success-gap", 6, 14)), 48, 95);
  const userTime = clamp(round(9.5 - savedHours * 0.36 + (complexityScore - 50) * 0.02 + seededBetween(seed, "time-user", -0.4, 0.4), 1), 4.4, 14);
  const marketTime = clamp(round(userTime + seededBetween(seed, "time-gap", 0.8, 1.8), 1), 5.2, 16.5);
  const userAgreements = clamp(Math.round(30 + agreementScore * 0.22 + seededBetween(seed, "agreements-user", -4, 4)), 15, 80);
  const marketAgreements = clamp(userAgreements - Math.round(seededBetween(seed, "agreements-gap", 4, 10)), 8, 70);

  const successDiff = userSuccess - marketSuccess;
  const agreementDiff = userAgreements - marketAgreements;
  const timeDiff = round(userTime - marketTime, 1);
  const timeDiffText = timeDiff >= 0 ? `+${timeDiff.toFixed(1)}` : timeDiff.toFixed(1);

  const conservativeSuccess = clamp(Math.round(agreementScore - 5 + seededBetween(seed, "scenario-cons", -2, 2)), 35, 95);
  const balancedSuccess = clamp(Math.round(agreementScore + seededBetween(seed, "scenario-bal", -2, 2)), 38, 96);
  const aggressiveSuccess = clamp(Math.round(agreementScore + 4 - riskScore * 0.04 + seededBetween(seed, "scenario-agg", -2, 2)), 30, 95);

  const costBase = filters.faixa_valor === "0-100k" ? 24 : filters.faixa_valor === "100k-500k" ? 39 : filters.faixa_valor === ">500k" ? 68 : 45;
  const conservativeCost = Math.round(costBase * seededBetween(seed, "cost-cons", 0.82, 0.9));
  const balancedCost = Math.round(costBase * seededBetween(seed, "cost-bal", 0.96, 1.05));
  const aggressiveCost = Math.round(costBase * seededBetween(seed, "cost-agg", 1.15, 1.28));

  const conservativeTime = clamp(round(userTime + seededBetween(seed, "months-cons", 0.7, 1.3), 1), 4.8, 16.5);
  const balancedTime = clamp(round(userTime + seededBetween(seed, "months-bal", -0.2, 0.5), 1), 4.3, 15.2);
  const aggressiveTime = clamp(round(userTime + seededBetween(seed, "months-agg", -0.9, -0.1), 1), 3.5, 14.4);

  const scenarioBySuccess = [
    { title: "Conservadora", success: conservativeSuccess },
    { title: "Equilibrada", success: balancedSuccess },
    { title: "Agressiva", success: aggressiveSuccess },
  ];
  const bestScenario = scenarioBySuccess.reduce((best, item) => (item.success > best.success ? item : best), scenarioBySuccess[0]);

  const opportunitiesCount = Math.max(1, Math.round((agreementScore - 45) / 12));
  const alertDetails: DashboardData["alertas"]["details"] = [
    {
      type: "critical",
      title: `Prazo de contestacao no ${selectedTribunal}`,
      time: "ha 12 min",
      desc: `Revisar peca do caso ${buildCaseId(seed, "critical")} com ${selectedJudge}. Vencimento estimado em ${daysUntilCritical} dia(s).`,
    },
    {
      type: "warning",
      title: `Volume acima da media em ${selectedAction}`,
      time: "ha 31 min",
      desc: `Filtro atual mostra maior concentracao de demandas em ${selectedTribunal}. Priorize triagem para reduzir risco operacional.`,
    },
    {
      type: "opportunity",
      title: `Oportunidade de acordo em ${opportunitiesCount} processo(s)`,
      time: "ha 58 min",
      desc: `Com os filtros aplicados, a chance media de acordo ficou em ${agreementScore}%. Simule contraproposta na aba de simulacoes.`,
    },
    {
      type: "info",
      title: "Dados de demonstracao recalculados",
      time: "ha 2h",
      desc: "Os graficos foram atualizados com base nos filtros selecionados, mantendo a experiencia em modo mock.",
    },
  ];

  const alertCounters = {
    critical: alertDetails.filter((item) => item.type === "critical").length,
    warning: alertDetails.filter((item) => item.type === "warning").length,
    info: alertDetails.filter((item) => item.type === "info").length,
    opportunity: alertDetails.filter((item) => item.type === "opportunity").length,
  };

  const heatmapColumns = reorderColumns(["TJSP", "TJRJ", "TRF3", "TRT2"], selectedTribunal);
  const heatmapRows = [
    { name: "Dano Moral", base: 73 },
    { name: "Horas Extras", base: 69 },
    { name: "Rescisao", base: 65 },
  ].map((row, rowIndex) => ({
    name: row.name,
    values: heatmapColumns.map((column, colIndex) => {
      const tribunalBoost = column === selectedTribunal ? 6 : 0;
      const actionBoost = selectedAction === "Trabalhista" && row.name === "Horas Extras" ? 5 : 0;
      const value = row.base + tribunalBoost + actionBoost + seededBetween(seed, `heat-${rowIndex}-${colIndex}`, -8, 8);
      return clamp(Math.round(value), 42, 95);
    }),
  }));

  const similarTypeA = selectedAction;
  const similarTypeB = selectedAction === "Trabalhista" ? "Civel" : "Trabalhista";
  const similarTypeC = selectedAction === "Tributario" ? "Comercial" : "Tributario";

  return {
    updated_label: `Atualizado agora (demo • ${filters.periodo})`,
    filters,
    generated_at: now.toISOString(),
    visao_geral: {
      stats: [
        {
          title: "Documentos processados",
          value: processedDocuments.toLocaleString("pt-BR"),
          subtitle: `${filters.periodo} • ${selectedTribunal}`,
          footer: "Base de demonstracao filtrada",
          color: "blue",
          updated: "Atualizado ha 2 min",
        },
        {
          title: "Tempo economizado",
          value: formatHours(savedHours),
          subtitle: `media por analise (${selectedAction})`,
          footer: "Estimativa automatica",
          color: "blue",
        },
        {
          title: "Taxa de precisao",
          value: `${precision.toFixed(1)}%`,
          subtitle: "media das extracoes no recorte",
          footer: "Modelo IA v2.1",
          color: "orange",
          warning: "Somente dados ficticios",
        },
      ],
      scores: [
        { title: "Risco", value: riskScore, color: "orange" },
        { title: "Complexidade", value: complexityScore, color: "blue" },
        { title: "Acordo", value: agreementScore, color: "emerald" },
        { title: "Confianca", value: confidenceScore, color: "emerald" },
      ],
      radar,
      insights: [
        {
          title: "Padrao do juizo",
          text: `No recorte de ${selectedTribunal}, peticoes objetivas para ${selectedJudge} tendem a reduzir retrabalho.`,
        },
        {
          title: "Janela de acordo",
          text: `Com chance media de acordo em ${agreementScore}%, a melhor janela segue antes da segunda audiencia.`,
        },
        {
          title: "Ponto de atencao",
          text: `Risco atual em ${riskScore}% indica atencao aos prazos dos proximos ${daysUntilWarning} dias para evitar multas.`,
        },
      ],
      weekly_activity: weeklyActivity,
      critical_deadlines: [
        { label: `Contestacao ${buildCaseId(seed, "deadline-a")}`, date: `${daysUntilCritical} dias`, color: "red" },
        { label: `Audiencia ${buildCaseId(seed, "deadline-b")}`, date: `${daysUntilWarning} dias`, color: "orange" },
        { label: `Pericia ${buildCaseId(seed, "deadline-c")}`, date: `${daysUntilInfo} dias`, color: "blue" },
      ],
    },
    inteligencia: {
      similar_processes: [
        {
          id: buildCaseId(seed, "similar-a"),
          similarity: `${clamp(Math.round(agreementScore + seededBetween(seed, "sim-a", 8, 15)), 55, 98)}%`,
          result: agreementScore >= 60 ? "Favoravel" : "Parcial",
          result_color: "emerald",
          time: formatMonths(conservativeTime),
          type: similarTypeA,
        },
        {
          id: buildCaseId(seed, "similar-b"),
          similarity: `${clamp(Math.round(agreementScore + seededBetween(seed, "sim-b", 3, 11)), 50, 97)}%`,
          result: "Acordo",
          result_color: "emerald",
          time: formatMonths(balancedTime),
          type: similarTypeB,
        },
        {
          id: buildCaseId(seed, "similar-c"),
          similarity: `${clamp(Math.round(agreementScore + seededBetween(seed, "sim-c", -14, -4)), 38, 92)}%`,
          result: "Parcial",
          result_color: "red",
          time: formatMonths(aggressiveTime + 0.6),
          type: similarTypeC,
        },
      ],
      heatmap_columns: heatmapColumns,
      heatmap_rows: heatmapRows,
      benchmark: [
        {
          label: "Taxa de sucesso",
          user: formatPercent(userSuccess),
          market: formatPercent(marketSuccess),
          trend: `${successDiff >= 0 ? "+" : ""}${successDiff}pp`,
          trend_color: successDiff >= 0 ? "emerald" : "orange",
        },
        {
          label: "Tempo medio",
          user: userTime.toFixed(1),
          market: marketTime.toFixed(1),
          trend: `${timeDiffText}`,
          trend_color: timeDiff <= 0 ? "blue" : "orange",
          unit: " meses",
        },
        {
          label: "Acordos",
          user: formatPercent(userAgreements),
          market: formatPercent(marketAgreements),
          trend: `${agreementDiff >= 0 ? "+" : ""}${agreementDiff}pp`,
          trend_color: agreementDiff >= 0 ? "emerald" : "orange",
        },
      ],
    },
    simulacoes: {
      description:
        `Com os filtros aplicados (${selectedTribunal} • ${selectedAction}), o modelo estima impacto de estrategia em prazo, custo e probabilidade de exito.`,
      scenarios: [
        {
          title: "Estrategia Conservadora",
          tag: "Risco baixo",
          tag_color: "emerald",
          data: [
            { label: "Prob. sucesso", val: formatPercent(conservativeSuccess), color: "emerald" },
            { label: "Tempo medio", val: formatMonths(conservativeTime), color: "blue" },
            { label: "Custo esperado", val: `R$ ${conservativeCost}k`, color: "orange" },
          ],
          footer: "Prioriza previsibilidade e menor variacao de resultado.",
        },
        {
          title: "Estrategia Equilibrada",
          tag: "Padrao",
          tag_color: "blue",
          data: [
            { label: "Prob. sucesso", val: formatPercent(balancedSuccess), color: "emerald" },
            { label: "Tempo medio", val: formatMonths(balancedTime), color: "blue" },
            { label: "Custo esperado", val: `R$ ${balancedCost}k`, color: "orange" },
          ],
          footer: "Combina velocidade com boa chance de acordo favoravel.",
        },
        {
          title: "Estrategia Agressiva",
          tag: "Maior retorno",
          tag_color: "orange",
          data: [
            { label: "Prob. sucesso", val: formatPercent(aggressiveSuccess), color: "emerald" },
            { label: "Tempo medio", val: formatMonths(aggressiveTime), color: "blue" },
            { label: "Custo esperado", val: `R$ ${aggressiveCost}k`, color: "orange" },
          ],
          footer: "Pode elevar custos no curto prazo em troca de ganho potencial.",
        },
      ],
      impact_metrics: [
        {
          label: "Cenario",
          icon: "trophy",
          title: "Melhor resultado",
          val: bestScenario.title,
          trend: `${bestScenario.success}% exito`,
          trend_bg: "emerald",
        },
        {
          label: "Risco",
          icon: "shield",
          title: "Exposicao",
          val: riskScore <= 40 ? "Baixa" : riskScore <= 65 ? "Moderada" : "Alta",
          trend: `${riskScore}%`,
          trend_bg: riskScore <= 55 ? "blue" : "orange",
        },
        {
          label: "Prazo",
          icon: "zap",
          title: "Reducao media",
          val: `${Math.abs(timeDiff).toFixed(1)} meses`,
          trend: `${timeDiff <= 0 ? "-" : "+"}${Math.abs(timeDiff).toFixed(1)} vs mercado`,
          trend_bg: timeDiff <= 0 ? "emerald" : "orange",
        },
      ],
    },
    alertas: {
      counts: [
        { count: alertCounters.critical, label: "CRITICOS", color: "red" },
        { count: alertCounters.warning, label: "ATENCAO", color: "orange" },
        { count: alertCounters.info, label: "INFORMATIVOS", color: "blue" },
        { count: alertCounters.opportunity, label: "OPORTUNIDADES", color: "emerald" },
      ],
      details: alertDetails,
    },
  };
}
