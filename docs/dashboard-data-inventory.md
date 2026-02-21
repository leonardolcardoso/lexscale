# Inventario Completo de Dados do Dashboard

Este documento lista todos os dados consumidos pela tela de dashboard atual e o plano de geracao para dados reais.

Arquivo de referencia do frontend:
- `/Users/pedrobrugger/Projects/lexScale/repos/lexscale/client/src/pages/dashboard.tsx`

## 1) Filtros Globais
- `tribunal`
- `juiz`
- `tipo_acao`
- `faixa_valor`
- `periodo`

## 2) Visao Geral

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
1. Probabilidade de exito
2. Probabilidade de acordo
3. Tempo estimado de decisao

### 2.2 Scores do processo (4)
Cada score:
- `title`
- `value` (0-100)
- `color`

Scores:
1. Risco
2. Chance de exito
3. Chance de acordo
4. Complexidade

### 2.3 Radar do processo
Cada ponto:
- `subject`
- `current` (processo atual)
- `cluster_avg` (media do cluster)

Subjects:
- Complexidade
- Chance exito
- Valor
- Tempo
- Risco

### 2.4 Insights narrativos por IA
Cada insight:
- `title`
- `text`

### 2.5 Atividade semanal (grafico de barras)
Cada ponto:
- `name` (dia)
- `value`

### 2.6 Prazos criticos
Cada prazo:
- `label`
- `date`
- `color`

## 3) Inteligencia Estrategica

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

## 4) Simulacoes Avancadas

### 4.1 Bloco explicativo
- `description`

### 4.2 Cenarios (A/B/C)
Cada cenario:
- `title`
- `tag`
- `tag_color`
- `data` (lista de metricas)
- `footer`

Cada metrica do cenario:
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

## 5) Alertas Estrategicos

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

## 6) Endpoint Backend Consolidado

Endpoint implementado:
- `GET /api/dashboard`

Contrato de resposta:
- `/Users/pedrobrugger/Projects/lexScale/repos/lexscale/backend/schemas/dashboard.py`

Gerador atual:
- `/Users/pedrobrugger/Projects/lexScale/repos/lexscale/backend/services/dashboard.py`

Status atual:
- O endpoint ja consolida dados reais do Postgres (`process_cases`, `case_deadlines`, `public_case_records`).
- Quando nao ha dados suficientes para algum bloco, o backend aplica fallback numerico seguro para manter o dashboard completo.

## 7) Pipeline Real de Geracao (proximo passo)

### 7.1 Fontes de dados
1. Upload de processo do usuario (PDF/DOCX/IMG)
2. Extracao estruturada por IA (partes, pedidos, valores, prazos, tema, classe)
3. APIs publicas (tribunais, dados governamentais, jurisprudencia, movimentacoes)
4. Base interna historica (processos, resultados, acordos, tempos, juiz/vara/tribunal)

Endpoints operacionais:
- `POST /api/cases/upload`
- `POST /api/public-data/sources`
- `POST /api/public-data/sync`
- `POST /api/public-data/records`

APIs reais conectadas por padrao:
- TJDFT Jurisprudencia (`https://jurisdf.tjdft.jus.br/api/v1/pesquisa`)
- TRF5 Transparencia (`https://api-transparencia.trf5.jus.br/api/v1/documento/tipo`)

### 7.2 Agregacoes necessarias
1. Features do processo atual
2. Cluster de casos similares
3. Scores probabilisticos (exito, acordo, risco, complexidade)
4. Serie temporal semanal
5. Prazos e alertas por regras + anomalias
6. Simulacoes de cenarios com baseline historico
7. Benchmark escritorio vs mercado

### 7.3 Saida final
Todos os blocos acima devem ser preenchidos exclusivamente por dados de banco derivados dessas fontes.
