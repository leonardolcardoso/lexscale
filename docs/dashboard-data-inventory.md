# Inventário Completo de Dados do Dashboard

Este documento lista todos os dados consumidos pela tela de dashboard atual e o plano de geração para dados reais.

Arquivo de referência do frontend:
- `/Users/pedrobrugger/Projects/lexScale/repos/lexscale/client/src/pages/dashboard.tsx`

## 1) Filtros Globais
- `tribunal`
- `juiz`
- `tipo_acao`
- `faixa_valor`
- `periodo`

## 2) Visão Geral

### 2.1 Cards principais (3)
Para cada card:
- `title`
- `value`
- `subtitle`
- `footer`
- `color`
- `updated` (opcional)
- `warning` (opcional)

Cards:
1. Probabilidade de êxito
2. Probabilidade de acordo
3. Tempo estimado de decisão

### 2.2 Scores do processo (4)
Cada score:
- `title`
- `value` (0-100)
- `color`

Scores:
1. Risco
2. Chance de êxito
3. Chance de acordo
4. Complexidade

### 2.3 Radar do processo
Cada ponto:
- `subject`
- `current` (processo atual)
- `cluster_avg` (média do cluster)

Subjects:
- Complexidade
- Chance êxito
- Valor
- Tempo
- Risco

### 2.4 Insights narrativos por IA
Cada insight:
- `title`
- `text`

### 2.5 Atividade semanal (gráfico de barras)
Cada ponto:
- `name` (dia)
- `value`

### 2.6 Prazos críticos
Cada prazo:
- `label`
- `date`
- `color`

## 3) Inteligência Estratégica

### 3.1 Processos similares
Cada item:
- `id`
- `similarity`
- `result`
- `result_color`
- `time`
- `type`

### 3.2 Heatmap de comportamento judicial
- `heatmap_columns` (5 colunas)
- `heatmap_rows`

Cada linha:
- `name`
- `values` (5 valores percentuais)

### 3.3 Benchmark vs mercado
Cada item:
- `label`
- `user`
- `market`
- `trend`
- `trend_color`
- `unit` (opcional)
- `sample_user` (opcional)
- `sample_market` (opcional)
- `min_user_observations` (opcional)
- `min_market_observations` (opcional)
- `is_comparable` (opcional)
- `confidence_level` (opcional)
- `confidence_label` (opcional)

### 3.4 Ações Rescisórias
- `summary`
- `kpis`
- `candidates`

Cada KPI:
- `label`
- `value`
- `tone`

Cada candidato:
- `case_id`
- `process_number`
- `eligibility_status` (`eligible|uncertain|ineligible`)
- `viability_score` (0-100)
- `recommendation` (`recommend_filing|monitor|do_not_recommend`)
- `grounds_detected`
- `financial_projection`

`financial_projection`:
- `estimated_cost_brl`
- `projected_upside_brl`
- `projected_net_brl`

## 4) Simulações Avançadas

### 4.1 Bloco explicativo
- `description`

### 4.2 Cenários (A/B/C)
Cada cenário:
- `title`
- `tag`
- `tag_color`
- `data` (lista de métricas)
- `footer`

Cada métrica do cenário:
- `label`
- `val`
- `color` (opcional)

### 4.3 Comparativo de impacto
Cada item:
- `label`
- `icon`
- `title`
- `val`
- `trend`
- `trend_bg`

## 5) Alertas Estratégicos

### 5.1 Contadores
Cada contador:
- `count`
- `label`
- `color`

### 5.2 Alertas detalhados
Cada alerta:
- `type`
- `title`
- `time`
- `desc`
- `action_target` (opcional)

`action_target`:
- `tab`
- `module` (opcional)
- `case_id` (opcional)
- `reason` (opcional)

## 6) Endpoint Backend Consolidado

Endpoint implementado:
- `GET /api/dashboard`

Contrato de resposta:
- `/Users/pedrobrugger/Projects/lexScale/repos/lexscale/backend/schemas/dashboard.py`

Gerador atual:
- `/Users/pedrobrugger/Projects/lexScale/repos/lexscale/backend/services/dashboard.py`

Status atual:
- O endpoint já consolida dados reais do Postgres (`process_cases`, `case_deadlines`, `public_case_records`).
- Quando não há dados suficientes para algum bloco, o backend aplica fallback numérico seguro para manter o dashboard completo.

## 7) Pipeline Real de Geração (próximo passo)

### 7.1 Fontes de dados
1. Upload de processo do usuário (PDF/DOCX/IMG)
2. Extração estruturada por IA (partes, pedidos, valores, prazos, tema, classe)
3. APIs públicas (tribunais, dados governamentais, jurisprudência, movimentações)
4. Base interna histórica (processos, resultados, acordos, tempos, juiz/vara/tribunal)

Endpoints operacionais:
- `POST /api/cases/upload`
- `POST /api/public-data/sources`
- `POST /api/public-data/sync`
- `POST /api/public-data/records`

APIs reais conectadas por padrão:
- TJDFT Jurisprudência (`https://jurisdf.tjdft.jus.br/api/v1/pesquisa`)
- TRF5 Transparência (`https://api-transparencia.trf5.jus.br/api/v1/documento/tipo`)

### 7.2 Agregações necessárias
1. Features do processo atual
2. Cluster de casos similares
3. Scores probabilísticos (êxito, acordo, risco, complexidade)
4. Série temporal semanal
5. Prazos e alertas por regras + anomalias
6. Simulações de cenários com baseline histórico
7. Benchmark escritório vs mercado

### 7.3 Saída final
Todos os blocos acima devem ser preenchidos exclusivamente por dados de banco derivados dessas fontes.
