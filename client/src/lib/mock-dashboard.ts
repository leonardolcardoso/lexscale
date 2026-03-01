import type { DashboardData, DashboardFilters, UploadHistoryItem } from "@/types/dashboard";

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
  "Todos os Juízes": 1,
  "Dr. João Silva": 1.05,
  "Dra. Maria Santos": 0.98,
  "Dr. Pedro Oliveira": 0.94,
};

const ACTION_FACTORS: Record<string, number> = {
  "Todos os Tipos": 1,
  Trabalhista: 1.08,
  Cível: 1.01,
  Tributário: 0.9,
  Comercial: 1.13,
  Família: 0.96,
};

const CLAIM_FACTORS: Record<string, number> = {
  "Todos os Valores": 1,
  "0-100k": 1.22,
  "100k-500k": 1,
  ">500k": 0.72,
};

const PERIOD_FACTORS: Record<string, number> = {
  "Últimos 3 meses": 0.62,
  "Últimos 6 meses": 1,
  "Últimos 12 meses": 1.64,
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

function formatCurrency(value: number): string {
  return `R$ ${Math.round(value).toLocaleString("pt-BR")}`;
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
  const selectedJudge = filters.juiz === "Todos os Juízes" ? "Dr. João Silva" : filters.juiz;
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
  const conservativeRisk = clamp(Math.round(riskScore * seededBetween(seed, "risk-cons", 0.36, 0.5)), 10, 70);
  const balancedRisk = clamp(Math.round(riskScore * seededBetween(seed, "risk-bal", 0.75, 0.95)), 16, 88);
  const aggressiveRisk = clamp(Math.round(riskScore * seededBetween(seed, "risk-agg", 0.58, 0.82)), 12, 82);
  const scenarioAValue = conservativeCost * 1000;
  const scenarioBValue = balancedCost * 1000;
  const scenarioCValue = aggressiveCost * 1000;
  const scenarioASample = Math.max(48, Math.round(128 * periodFactor * seededBetween(seed, "sample-a", 0.86, 1.26)));
  const scenarioBSample = Math.max(72, Math.round(224 * periodFactor * seededBetween(seed, "sample-b", 0.9, 1.22)));
  const scenarioCSample = Math.max(36, Math.round(96 * periodFactor * seededBetween(seed, "sample-c", 0.84, 1.2)));

  const scenarioStats = [
    { shortTitle: "Cenário A", fullTitle: "Cenário A: Acordo Imediato", value: scenarioAValue, risk: conservativeRisk, time: conservativeTime },
    { shortTitle: "Cenário B", fullTitle: "Cenário B: Julgamento Final", value: scenarioBValue, risk: balancedRisk, time: balancedTime },
    { shortTitle: "Cenário C", fullTitle: "Cenário C: Estratégia Alternativa", value: scenarioCValue, risk: aggressiveRisk, time: aggressiveTime },
  ];
  const bestValueScenario = scenarioStats.reduce((best, item) => (item.value > best.value ? item : best), scenarioStats[0]);
  const lowestRiskScenario = scenarioStats.reduce((best, item) => (item.risk < best.risk ? item : best), scenarioStats[0]);
  const fastestScenario = scenarioStats.reduce((best, item) => (item.time < best.time ? item : best), scenarioStats[0]);
  const bestValueVsA = scenarioAValue > 0 ? Math.round(((bestValueScenario.value - scenarioAValue) / scenarioAValue) * 100) : 0;
  const lowestRiskVsB = Math.round(balancedRisk - lowestRiskScenario.risk);
  const fastestVsB = round(balancedTime - fastestScenario.time, 1);
  const bestScenarioCopy = `${bestScenario.title.toLowerCase()} (${formatPercent(bestScenario.success)})`;

  const opportunitiesCount = Math.max(1, Math.round((agreementScore - 45) / 12));
  const alertDetails: DashboardData["alertas"]["details"] = [
    {
      type: "critical",
      title: `Prazo de contestação no ${selectedTribunal}`,
      time: "há 12 min",
      desc: `Revisar peça do caso ${buildCaseId(seed, "critical")} com ${selectedJudge}. Vencimento estimado em ${daysUntilCritical} dia(s).`,
    },
    {
      type: "warning",
      title: `Volume acima da média em ${selectedAction}`,
      time: "há 31 min",
      desc: `Filtro atual mostra maior concentração de demandas em ${selectedTribunal}. Priorize triagem para reduzir risco operacional.`,
    },
    {
      type: "warning",
      title: "Sinal de variação no tempo médio",
      time: "há 43 min",
      desc: `A estimativa de tramitação subiu ${Math.max(0.3, Math.abs(timeDiff)).toFixed(1)} mes(es) no recorte recente. Reavalie prioridades de acompanhamento.`,
    },
    {
      type: "opportunity",
      title: `Oportunidade de acordo em ${opportunitiesCount} processo(s)`,
      time: "há 58 min",
      desc: `Com os filtros aplicados, a chance média de acordo ficou em ${agreementScore}%. Simule contraproposta na aba de simulações.`,
    },
    {
      type: "opportunity",
      title: "Janela de acordo antes da próxima audiência",
      time: "há 1h 11 min",
      desc: `Casos com perfil similar indicam taxa de fechamento acima de ${Math.max(55, agreementScore - 8)}% quando a proposta é enviada em até ${daysUntilWarning} dia(s).`,
    },
    {
      type: "info",
      title: "Dados de demonstração recalculados",
      time: "há 2h",
      desc: "Os gráficos foram atualizados com base nos filtros selecionados, mantendo a experiência em modo mock.",
    },
    {
      type: "info",
      title: "Benchmark atualizado para o recorte atual",
      time: "há 3h",
      desc: `Comparativo de mercado sincronizado para ${selectedAction} em ${selectedTribunal}, com horizonte de ${daysUntilInfo} dia(s).`,
    },
    {
      type: "critical",
      title: "Pendência de documento probatório",
      time: "há 4h",
      desc: `Processo ${buildCaseId(seed, "critical-doc")} segue sem anexo complementar. Risco de impacto no prazo em ${daysUntilCritical} dia(s).`,
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
  const similarTypeB = selectedAction === "Trabalhista" ? "Cível" : "Trabalhista";
  const similarTypeC = selectedAction === "Tributário" ? "Comercial" : "Tributário";

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
          footer: "Base de demonstração filtrada",
          color: "blue",
          updated: "Atualizado há 2 min",
        },
        {
          title: "Tempo economizado",
          value: formatHours(savedHours),
          subtitle: `média por análise (${selectedAction})`,
          footer: "Estimativa automática",
          color: "blue",
        },
        {
          title: "Taxa de precisão",
          value: `${precision.toFixed(1)}%`,
          subtitle: "média das extrações no recorte",
          footer: "Modelo IA v2.1",
          color: "orange",
          warning: "Somente dados fictícios",
        },
      ],
      scores: [
        { title: "Risco", value: riskScore, color: "orange" },
        { title: "Complexidade", value: complexityScore, color: "blue" },
        { title: "Acordo", value: agreementScore, color: "emerald" },
        { title: "Confiança", value: confidenceScore, color: "emerald" },
      ],
      radar,
      insights: [
        {
          title: "Padrão do juízo",
          text: `No recorte de ${selectedTribunal}, petições objetivas para ${selectedJudge} tendem a reduzir retrabalho.`,
        },
        {
          title: "Janela de acordo",
          text: `Com chance média de acordo em ${agreementScore}%, a melhor janela segue antes da segunda audiência.`,
        },
        {
          title: "Ponto de atenção",
          text: `Risco atual em ${riskScore}% indica atenção aos prazos dos próximos ${daysUntilWarning} dias para evitar multas.`,
        },
      ],
      weekly_activity: weeklyActivity,
      critical_deadlines: [
        { label: `Contestação ${buildCaseId(seed, "deadline-a")}`, date: `${daysUntilCritical} dias`, color: "red" },
        { label: `Audiência ${buildCaseId(seed, "deadline-b")}`, date: `${daysUntilWarning} dias`, color: "orange" },
        { label: `Perícia ${buildCaseId(seed, "deadline-c")}`, date: `${daysUntilInfo} dias`, color: "blue" },
      ],
    },
    inteligencia: {
      acoes_rescisorias: {
        summary:
          `Triagem rescisória com ${Math.max(3, opportunitiesCount + 2)} casos priorizados no recorte atual.`,
        kpis: [
          { label: "Casos avaliados", value: `${Math.max(3, opportunitiesCount + 2)}`, tone: "blue" },
          { label: "Elegíveis", value: `${Math.max(1, opportunitiesCount)}`, tone: "emerald" },
          { label: "Monitoramento", value: `${Math.max(1, opportunitiesCount - 1)}`, tone: "orange" },
          { label: "Score médio", value: `${Math.round((conservativeSuccess + balancedSuccess + aggressiveSuccess) / 3)}`, tone: "cyan" },
        ],
        candidates: [
          {
            case_id: buildCaseId(seed, "resc-a"),
            process_number: buildCaseId(seed, "resc-a"),
            eligibility_status: "eligible",
            viability_score: clamp(Math.round(conservativeSuccess), 70, 96),
            recommendation: "recommend_filing",
            grounds_detected: ["Erro de fato", "Violacao manifesta de norma juridica"],
            financial_projection: {
              estimated_cost_brl: Math.round(costBase * 1000 * 0.035),
              projected_upside_brl: Math.round(scenarioAValue * 0.6),
              projected_net_brl: Math.round(scenarioAValue * 0.6 - costBase * 1000 * 0.035),
            },
          },
          {
            case_id: buildCaseId(seed, "resc-b"),
            process_number: buildCaseId(seed, "resc-b"),
            eligibility_status: "uncertain",
            viability_score: clamp(Math.round(balancedSuccess), 52, 79),
            recommendation: "monitor",
            grounds_detected: ["Prova nova"],
            financial_projection: {
              estimated_cost_brl: Math.round(costBase * 1000 * 0.04),
              projected_upside_brl: Math.round(scenarioBValue * 0.42),
              projected_net_brl: Math.round(scenarioBValue * 0.42 - costBase * 1000 * 0.04),
            },
          },
        ],
      },
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
          sample_user: 42,
          sample_market: 318,
          min_user_observations: 10,
          min_market_observations: 30,
          is_comparable: true,
          confidence_level: "high",
          confidence_label: "Alta",
        },
        {
          label: "Tempo médio",
          user: userTime.toFixed(1),
          market: marketTime.toFixed(1),
          trend: `${timeDiffText}`,
          trend_color: timeDiff <= 0 ? "blue" : "orange",
          unit: " meses",
          sample_user: 37,
          sample_market: 296,
          min_user_observations: 10,
          min_market_observations: 30,
          is_comparable: true,
          confidence_level: "high",
          confidence_label: "Alta",
        },
        {
          label: "Acordos",
          user: formatPercent(userAgreements),
          market: formatPercent(marketAgreements),
          trend: `${agreementDiff >= 0 ? "+" : ""}${agreementDiff}pp`,
          trend_color: agreementDiff >= 0 ? "emerald" : "orange",
          sample_user: 40,
          sample_market: 301,
          min_user_observations: 10,
          min_market_observations: 30,
          is_comparable: true,
          confidence_level: "high",
          confidence_label: "Alta",
        },
      ],
    },
    simulacoes: {
      description:
        `Cenários simulados para o recorte atual (${selectedAction} em ${selectedTribunal}). No filtro aplicado, a estratégia ${bestScenarioCopy} apresentou o maior potencial de êxito.`,
      scenarios: [
        {
          title: "Cenário A: Acordo Imediato",
          tag: "RECOMENDADO",
          tag_color: "emerald",
          data: [
            { label: "Probabilidade de Sucesso", val: formatPercent(conservativeSuccess), color: "emerald" },
            { label: "Valor Estimado", val: formatCurrency(scenarioAValue) },
            { label: "Tempo Estimado", val: formatMonths(conservativeTime) },
            { label: "Nível de Risco", val: formatPercent(conservativeRisk), color: "emerald" },
          ],
          footer:
            `Baseado em ${scenarioASample} casos simulados para ${selectedAction}. Acordo antes da audiência tende a reduzir prazo para ${formatMonths(conservativeTime)} no recorte atual.`,
          detail_title: "Detalhes",
          detail_summary: "Cenário A: Acordo Imediato.",
          next_step_title: "Próximo passo recomendado:",
          next_step_text:
            "Estruture proposta objetiva com faixa de concessão, prazo de resposta e argumentos de custo/tempo para acelerar composição.",
        },
        {
          title: "Cenário B: Julgamento Final",
          tag: "EQUILIBRADO",
          tag_color: "blue",
          data: [
            { label: "Probabilidade de Sucesso", val: formatPercent(balancedSuccess), color: "emerald" },
            { label: "Valor Estimado", val: formatCurrency(scenarioBValue) },
            { label: "Tempo Estimado", val: formatMonths(balancedTime) },
            { label: "Nível de Risco", val: formatPercent(balancedRisk), color: "orange" },
          ],
          footer:
            `Baseado em ${scenarioBSample} casos simulados para ${selectedTribunal}. Manter até sentença melhora valor potencial, com tempo médio de ${formatMonths(balancedTime)}.`,
          detail_title: "Detalhes",
          detail_summary: "Cenário B: Julgamento Final.",
          next_step_title: "Próximo passo recomendado:",
          next_step_text: "Consolidar provas documentais e preparar linha de sustentação para reduzir risco recursal.",
        },
        {
          title: "Cenário C: Estratégia Alternativa",
          tag: "ALTERNATIVA",
          tag_color: "orange",
          data: [
            { label: "Probabilidade de Sucesso", val: formatPercent(aggressiveSuccess), color: "orange" },
            { label: "Valor Estimado", val: formatCurrency(scenarioCValue) },
            { label: "Tempo Estimado", val: formatMonths(aggressiveTime) },
            { label: "Nível de Risco", val: formatPercent(aggressiveRisk), color: "blue" },
          ],
          footer:
            `Baseado em ${scenarioCSample} casos simulados. Estratégia alternativa reduz risco para ${formatPercent(aggressiveRisk)} com prazo estimado de ${formatMonths(aggressiveTime)}.`,
          detail_title: "Detalhes",
          detail_summary: "Cenário C: Estratégia Alternativa.",
          next_step_title: "Próximo passo recomendado:",
          next_step_text: "Validar perfil de mediação e estruturar proposta escalonada para acelerar composição.",
        },
      ],
      impact_metrics: [
        {
          label: "MELHOR VALOR",
          icon: "trophy",
          title: bestValueScenario.shortTitle,
          val: `${formatCurrency(bestValueScenario.value)} estimado`,
          trend: `${bestValueVsA >= 0 ? "+" : ""}${bestValueVsA}% vs Cenário A`,
          trend_bg: "emerald",
        },
        {
          label: "MENOR RISCO",
          icon: "shield",
          title: lowestRiskScenario.shortTitle,
          val: `${formatPercent(lowestRiskScenario.risk)} de risco`,
          trend: `${lowestRiskVsB >= 0 ? "-" : "+"}${Math.abs(lowestRiskVsB)}pp vs Cenário B`,
          trend_bg: "emerald",
        },
        {
          label: "MAIS RÁPIDO",
          icon: "zap",
          title: fastestScenario.shortTitle,
          val: formatMonths(fastestScenario.time),
          trend: `${fastestVsB >= 0 ? "-" : "+"}${Math.abs(fastestVsB).toFixed(1)} meses vs Cenário B`,
          trend_bg: "emerald",
        },
      ],
    },
    alertas: {
      counts: [
        { count: alertCounters.critical, label: "CRITICOS", color: "red" },
        { count: alertCounters.warning, label: "ATENÇÃO", color: "orange" },
        { count: alertCounters.info, label: "INFORMATIVOS", color: "blue" },
        { count: alertCounters.opportunity, label: "OPORTUNIDADES", color: "emerald" },
      ],
      details: alertDetails,
    },
  };
}

function toIso(date: Date): string {
  return date.toISOString();
}

function buildAiSummary(actionType: string, tribunal: string, claimValue: number): string {
  const formattedValue = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 2,
  }).format(claimValue);
  return `Caso ${actionType.toLowerCase()} no ${tribunal} com valor estimado em ${formattedValue}. A leitura simulada indica pontos de prova consistentes, risco controlado e janela viável para acordo com estratégia ativa de negociação.`;
}

export function buildMockUploadHistory(filters: DashboardFilters): UploadHistoryItem[] {
  const now = new Date();
  const filterKey = `${filters.tribunal}|${filters.juiz}|${filters.tipo_acao}|${filters.faixa_valor}|${filters.periodo}`;
  const seed = hashString(filterKey);

  const selectedTribunal = filters.tribunal === "Todos os Tribunais" ? "TJSP" : filters.tribunal;
  const selectedAction = filters.tipo_acao === "Todos os Tipos" ? "Trabalhista" : filters.tipo_acao;
  const selectedJudge = filters.juiz === "Todos os Juízes" ? "Dra. Maria Santos" : filters.juiz;

  const actionPool = [selectedAction, "Cível", "Tributário", "Comercial", "Família"];
  const tribunalPool = [selectedTribunal, "TJRJ", "TRT2", "TRF3", "TJDFT"];
  const judgePool = [selectedJudge, "Dr. João Silva", "Dr. Pedro Oliveira", "Dra. Ana Cardoso"];

  const itemTemplates: Array<{
    salt: string;
    filename: string;
    contentType: string;
    userParty: "author" | "defendant";
    aiStatus: UploadHistoryItem["ai_status"];
    aiAttempts: number;
    aiStage: string;
    aiStageLabel: string;
    aiProgress: number;
    elapsedHours: number;
    processedHours?: number;
    riskScore?: number;
    complexityScore?: number;
    successProbability?: number;
    settlementProbability?: number;
    expectedDecisionMonths?: number;
    aiSummary?: string;
    needsRetryAtHours?: number;
    aiLastError?: string;
  }> = [
    {
      salt: "upload-1",
      filename: "peticao_inicial_trabalhista.pdf",
      contentType: "application/pdf",
      userParty: "author",
      aiStatus: "completed",
      aiAttempts: 1,
      aiStage: "completed",
      aiStageLabel: "Processamento concluído com sucesso.",
      aiProgress: 100,
      elapsedHours: 3,
      processedHours: 2.7,
      riskScore: 41,
      complexityScore: 46,
      successProbability: 0.74,
      settlementProbability: 0.58,
      expectedDecisionMonths: 7.2,
    },
    {
      salt: "upload-2",
      filename: "contestacao_fornecedor.docx",
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      userParty: "defendant",
      aiStatus: "processing",
      aiAttempts: 1,
      aiStage: "analysis_ai",
      aiStageLabel: "Analisando documento com IA.",
      aiProgress: 62,
      elapsedHours: 1.2,
    },
    {
      salt: "upload-3",
      filename: "anexos_probatorios.zip",
      contentType: "application/zip",
      userParty: "author",
      aiStatus: "failed_retryable",
      aiAttempts: 2,
      aiStage: "failed",
      aiStageLabel: "Falha temporária na análise. Nova tentativa agendada.",
      aiProgress: 36,
      elapsedHours: 5,
      needsRetryAtHours: 0.5,
      aiLastError: "Timeout no provedor externo de jurisprudência durante enriquecimento.",
    },
    {
      salt: "upload-4",
      filename: "sentenca_1_grau.pdf",
      contentType: "application/pdf",
      userParty: "defendant",
      aiStatus: "manual_review",
      aiAttempts: 1,
      aiStage: "publication",
      aiStageLabel: "Documento marcado para revisão manual.",
      aiProgress: 83,
      elapsedHours: 9,
      aiLastError: "Inconsistência entre valor extraído e valor informado na petição.",
    },
    {
      salt: "upload-5",
      filename: "recurso_apelacao_cliente.pdf",
      contentType: "application/pdf",
      userParty: "author",
      aiStatus: "completed",
      aiAttempts: 1,
      aiStage: "completed",
      aiStageLabel: "Processamento concluído com sucesso.",
      aiProgress: 100,
      elapsedHours: 18,
      processedHours: 17.4,
      riskScore: 58,
      complexityScore: 63,
      successProbability: 0.61,
      settlementProbability: 0.42,
      expectedDecisionMonths: 11.5,
    },
  ];

  return itemTemplates.map((template, index) => {
    const localSeed = hashString(`${seed}:${template.salt}`);
    const processNumber = `000${(1000 + (localSeed % 8999)).toString().padStart(4, "0")}-${(10 + (localSeed % 90)).toString().padStart(2, "0")}.202${(localSeed % 4) + 1}.8.${(10 + (localSeed % 89)).toString().padStart(2, "0")}.0100`;
    const actionType = actionPool[index % actionPool.length];
    const tribunal = tribunalPool[index % tribunalPool.length];
    const judge = judgePool[index % judgePool.length];
    const claimValue = Math.round(seededBetween(localSeed, "claim", 42000, 540000));
    const createdAt = new Date(now.getTime() - template.elapsedHours * 60 * 60 * 1000);
    const processedAt = template.processedHours ? new Date(now.getTime() - template.processedHours * 60 * 60 * 1000) : null;
    const retryAt = template.needsRetryAtHours ? new Date(now.getTime() + template.needsRetryAtHours * 60 * 60 * 1000) : null;
    const successProbability = typeof template.successProbability === "number" ? Math.max(0, Math.min(1, template.successProbability)) : null;
    const favorableToUserPct = successProbability == null
      ? null
      : template.userParty === "author"
      ? round(successProbability * 100, 1)
      : round((1 - successProbability) * 100, 1);
    const favorableToCounterpartyPct = successProbability == null ? null : round(100 - (favorableToUserPct ?? 0), 1);

    const keyFacts = [
      `Peça vinculada ao processo ${processNumber}.`,
      `Ação classificada como ${actionType.toLowerCase()} no ${tribunal}.`,
      "Partes com histórico prévio de tentativa de composição extrajudicial.",
    ];

    return {
      case_id: `demo-case-${localSeed.toString(16).slice(0, 12)}`,
      process_number: processNumber,
      user_party: template.userParty,
      case_title: `${actionType} - ${tribunal}`,
      filename: template.filename,
      content_type: template.contentType,
      tribunal,
      judge,
      action_type: actionType,
      claim_value: claimValue,
      status: "em_andamento",
      ai_status: template.aiStatus,
      ai_attempts: template.aiAttempts,
      ai_stage: template.aiStage,
      ai_stage_label: template.aiStageLabel,
      ai_progress_percent: template.aiProgress,
      ai_stage_updated_at: toIso(new Date(createdAt.getTime() + 20 * 60 * 1000)),
      ai_next_retry_at: retryAt ? toIso(retryAt) : null,
      ai_processed_at: processedAt ? toIso(processedAt) : null,
      ai_last_error: template.aiLastError ?? null,
      created_at: toIso(createdAt),
      generated_data: {
        extracted: {
          process_number: processNumber,
          title: `${actionType} - ${tribunal}`,
          tribunal,
          judge,
          action_type: actionType,
          claim_value: claimValue,
          status: "Em andamento",
          parties: {
            author: "Parte autora",
            defendant: "Parte ré",
          },
          key_facts: keyFacts,
          deadlines: [
            {
              label: "Prazo para manifestação",
              due_date: toIso(new Date(now.getTime() + (index + 2) * 24 * 60 * 60 * 1000)),
              severity: index % 2 === 0 ? "alta" : "media",
            },
          ],
        },
        success_probability: template.successProbability ?? null,
        settlement_probability: template.settlementProbability ?? null,
        expected_decision_months: template.expectedDecisionMonths ?? null,
        risk_score: template.riskScore ?? null,
        complexity_score: template.complexityScore ?? null,
        ai_summary:
          template.aiSummary ??
          (template.aiStatus === "completed"
            ? buildAiSummary(actionType, tribunal, claimValue)
            : null),
        favorable_to_user_pct: favorableToUserPct,
        favorable_to_counterparty_pct: favorableToCounterpartyPct,
      },
    };
  });
}

function resolveMockClaimRange(claimValue?: number | null): DashboardFilters["faixa_valor"] {
  if (typeof claimValue !== "number" || !Number.isFinite(claimValue)) return "Todos os Valores";
  if (claimValue <= 100000) return "0-100k";
  if (claimValue <= 500000) return "100k-500k";
  return ">500k";
}

export function buildMockDashboardContextForUpload(
  uploadItem: UploadHistoryItem,
  fallbackFilters: DashboardFilters,
): DashboardData {
  const tribunal = uploadItem.tribunal && TRIBUNAL_FACTORS[uploadItem.tribunal] ? uploadItem.tribunal : fallbackFilters.tribunal;
  const juiz = uploadItem.judge && JUDGE_FACTORS[uploadItem.judge] ? uploadItem.judge : fallbackFilters.juiz;
  const tipoAcao = uploadItem.action_type && ACTION_FACTORS[uploadItem.action_type] ? uploadItem.action_type : fallbackFilters.tipo_acao;
  const faixaValor = resolveMockClaimRange(uploadItem.claim_value);

  return buildMockDashboardData({
    tribunal,
    juiz,
    tipo_acao: tipoAcao,
    faixa_valor: faixaValor,
    periodo: fallbackFilters.periodo,
  });
}
