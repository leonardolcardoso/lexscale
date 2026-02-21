export type DashboardFilters = {
  tribunal: string;
  juiz: string;
  tipo_acao: string;
  faixa_valor: string;
  periodo: string;
};

export type DashboardData = {
  updated_label: string;
  filters: DashboardFilters;
  generated_at: string;
  visao_geral: {
    stats: Array<{
      title: string;
      value: string;
      subtitle: string;
      footer: string;
      color: string;
      updated?: string | null;
      warning?: string | null;
    }>;
    scores: Array<{
      title: string;
      value: number;
      color: string;
    }>;
    radar: Array<{
      subject: string;
      current: number;
      cluster_avg: number;
    }>;
    insights: Array<{
      title: string;
      text: string;
    }>;
    weekly_activity: Array<{
      name: string;
      value: number;
    }>;
    critical_deadlines: Array<{
      label: string;
      date: string;
      color: string;
    }>;
  };
  inteligencia: {
    similar_processes: Array<{
      id: string;
      similarity: string;
      result: string;
      result_color: string;
      time: string;
      type: string;
    }>;
    heatmap_columns: string[];
    heatmap_rows: Array<{
      name: string;
      values: number[];
    }>;
    benchmark: Array<{
      label: string;
      user: string;
      market: string;
      trend: string;
      trend_color: string;
      unit?: string;
    }>;
  };
  simulacoes: {
    description: string;
    scenarios: Array<{
      title: string;
      tag: string;
      tag_color: string;
      data: Array<{ label: string; val: string; color?: string | null }>;
      footer: string;
    }>;
    impact_metrics: Array<{
      label: string;
      icon: string;
      title: string;
      val: string;
      trend: string;
      trend_bg: string;
    }>;
  };
  alertas: {
    counts: Array<{
      count: number;
      label: string;
      color: string;
    }>;
    details: Array<{
      type: string;
      title: string;
      time: string;
      desc: string;
    }>;
  };
};

export type UploadCaseResponse = {
  case_id: string;
  process_number: string;
  extracted: {
    process_number?: string | null;
    title?: string | null;
    tribunal?: string | null;
    judge?: string | null;
    action_type?: string | null;
    claim_value?: number | null;
    status?: string | null;
  };
  scores: {
    success_probability: number;
    settlement_probability: number;
    expected_decision_months: number;
    risk_score: number;
    complexity_score: number;
    ai_summary: string;
  };
  created_at: string;
};
