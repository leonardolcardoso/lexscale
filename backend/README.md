# Backend Python (FastAPI)

## 1) Subir Postgres com pgvector

Opcao recomendada (Docker):

```bash
docker run --name lexscale-postgres \
  -e POSTGRES_DB=lexscale \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -p 5436:5432 \
  -d pgvector/pgvector:pg16
```

## 2) Instalar dependencias

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
```

## 3) Configurar ambiente

```bash
cp backend/.env.example backend/.env
```

Defina no `backend/.env`:
- `DATABASE_URL`
- `OPENAI_API_KEY`

## 4) Rodar backend

```bash
npm run dev:backend
```

## Endpoints

- `GET /health`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET /api/profile`
- `PUT /api/profile`
- `GET /api/dashboard`
- `GET /api/cases`
- `GET /api/cases/{case_id}/dashboard-context`
- `GET /api/cases/upload-history`
- `POST /api/cases/extract`
- `POST /api/cases/upload`
- `GET /api/public-data/sources`
- `POST /api/public-data/sources`
- `POST /api/public-data/sync`
- `GET /api/public-data/ops`
- `POST /api/public-data/records`
- `POST /api/ai/chat`
- `GET /api/ai/history`
- `POST /api/ai/search`
- `GET /api/ai/usage/summary`
- `GET /api/ai/usage/logs`
- `GET /api/strategic-alerts`
- `POST /api/strategic-alerts/scan`
- `POST /api/strategic-alerts/{alert_id}/read`
- `POST /api/strategic-alerts/{alert_id}/dismiss`

Observação sobre histórico consolidado por upload:
- O endpoint `GET /api/cases/{case_id}/dashboard-context` retorna um snapshot congelado do dashboard por documento.
- Esse snapshot é salvo automaticamente quando o processamento assíncrono do upload termina (concluído ou falha final).
- Alterações de filtros posteriores não sobrescrevem o snapshot salvo.

Observação: todos os endpoints `/api/*` (exceto login/registro) exigem sessão autenticada via cookie HTTP-only.

## Alertas estratégicos (scheduler)

O backend executa um scan recorrente para gerar alertas por usuário e evitar spam com cooldown por categoria.

Configurações via ambiente:
- `STRATEGIC_ALERT_SCAN_INTERVAL_MINUTES` (default: `30`)
- `STRATEGIC_ALERT_MAX_SCOPES` (default: `8`)
- `STRATEGIC_ALERT_COOLDOWN_CRITICAL_MINUTES` (default: `60`)
- `STRATEGIC_ALERT_COOLDOWN_WARNING_MINUTES` (default: `180`)
- `STRATEGIC_ALERT_COOLDOWN_OPPORTUNITY_MINUTES` (default: `240`)
- `STRATEGIC_ALERT_COOLDOWN_INFO_MINUTES` (default: `360`)
- `STRATEGIC_ALERT_SCAN_LOCK_KEY` (default: `91350231`, lock distribuído no Postgres)

## Pipeline IA de Upload (cobertura completa do documento)

O processamento assíncrono do upload agora pode operar em modo de cobertura completa:
- o backend divide o documento em blocos e gera um mapa consolidado (map-reduce),
- usa esse mapa na análise final para reduzir perda de contexto em arquivos longos,
- cruza a análise com benchmark de dados públicos já sincronizados.

Configurações:
- `OPENAI_CASE_ANALYSIS_MODEL` (opcional; fallback para `OPENAI_MODEL`)
- `CASE_AI_FULL_DOCUMENT_ENABLED` (default: `true`)
- `CASE_AI_CHUNK_SIZE` (default: `14000`)
- `CASE_AI_CHUNK_OVERLAP` (default: `1200`)
- `CASE_AI_MAX_CHUNKS` (default: `8`)
- `CASE_AI_TEMPERATURE` (default: `0`)
- `CASE_AI_MAX_OUTPUT_TOKENS` (default: `2200`)
- `CASE_AI_MIN_TEXT_CHARS` (default: `300`; abaixo disso o caso vai para revisão manual)

## Scheduler de sincronização de bases públicas

Além do botão manual (`POST /api/public-data/sync`), o backend roda sync automático recorrente.

Configurações:
- `PUBLIC_DATA_SYNC_INTERVAL_MINUTES` (default: `60`)
- `PUBLIC_DATA_SYNC_RUN_ON_STARTUP` (default: `true`)
- `PUBLIC_DATA_SYNC_ON_CASE_PROCESSING` (default: `true`; tenta sincronizar antes de cada análise de upload)
- `PUBLIC_DATA_SYNC_CASE_MIN_FRESHNESS_MINUTES` (default: `0`; `0` força sync em todo upload, `>0` só sincroniza quando dados estiverem mais antigos que esse limite)

Observabilidade operacional:
- `GET /api/public-data/ops?days=30` retorna métricas de execução por upload (conclusão, sync por caso, p95 de sync), saúde das fontes e consumo de IA no pipeline assíncrono de enrichment.

Inventário completo dos dados do dashboard:
- `/Users/pedrobrugger/Projects/lexScale/repos/lexscale/docs/dashboard-data-inventory.md`

Exemplo de body:

```json
{
  "prompt": "Resuma os principais riscos desta cláusula contratual.",
  "system_prompt": "Você é um advogado sênior especializado em contratos.",
  "model": "gpt-4.1-mini",
  "temperature": 0.2,
  "max_output_tokens": 600
}
```

## Controle de uso OpenAI (tokens e custo estimado)

Toda chamada OpenAI passa a gerar log no servidor com:
- operacao (`operation`)
- modelo (`model`)
- tokens de entrada/saida/total
- custo estimado em USD (`estimated_cost_usd`)
- acumulado mensal global e por usuario

Persistencia no banco:
- tabela `ai_usage_logs`

Endpoints para consulta autenticada:
- `GET /api/ai/usage/summary?days=30` -> agregados por periodo
- `GET /api/ai/usage/logs?limit=50` -> eventos individuais recentes

Configuracao opcional de precificacao por ambiente (USD por 1M tokens):
- `OPENAI_PRICING_GPT_4_1_MINI_INPUT_PER_1M`
- `OPENAI_PRICING_GPT_4_1_MINI_OUTPUT_PER_1M`
- `OPENAI_PRICING_TEXT_EMBEDDING_3_SMALL_INPUT_PER_1M`
- `OPENAI_PRICING_DEFAULT_INPUT_PER_1M`
- `OPENAI_PRICING_DEFAULT_OUTPUT_PER_1M`

Exemplo de cadastro de fonte pública:

```json
{
  "name": "tjsp_api",
  "base_url": "https://seu-endpoint-publico/casos",
  "tribunal": "TJSP",
  "headers": {},
  "enabled": true
}
```

## APIs reais já conectadas por padrão

Na inicialização, o backend cadastra automaticamente:
- `tjdft_jurisprudencia` -> `https://jurisdf.tjdft.jus.br/api/v1/pesquisa`
- `trf5_transparencia_documentos` -> `https://api-transparencia.trf5.jus.br/api/v1/documento/tipo`
- `dados_gov_br_catalogo_piloto` -> `https://dados.gov.br/dados/api/publico/conjuntos-dados` (criada desabilitada quando `DADOS_GOV_BR_API_KEY` não estiver definida)

Controle da coleta TJDFT via ambiente:
- `PUBLIC_SYNC_TJDFT_QUERY` (default: `direito civil`)
- `PUBLIC_SYNC_TJDFT_PAGE_SIZE` (default: `40`)

Conector piloto dados.gov.br (1 dataset por sincronização):
- `DADOS_GOV_BR_API_KEY` (opcional, recomendado; header `chave-api-dados-abertos`)
- `DADOS_GOV_BR_PILOT_QUERY` (default: `justica`)
- `DADOS_GOV_BR_PAGE` (default: `1`)
- `DADOS_GOV_BR_DATASET_ID` (opcional; força dataset específico)
- `DADOS_GOV_BR_RESOURCE_ID` (opcional; força recurso específico do dataset)
- `DADOS_GOV_BR_PILOT_MAX_ITEMS` (default: `50`; limite de linhas importadas do recurso piloto)

Observações do conector piloto:
- Se o dataset tiver recurso JSON/API ou CSV, o backend importa até `DADOS_GOV_BR_PILOT_MAX_ITEMS` linhas.
- O backend sempre salva 1 registro de metadados do dataset (mesmo quando o recurso não puder ser importado).
- Sem autenticação válida, o portal pode redirecionar para login e a sincronização retorna erro dessa fonte.

Exemplo de ingestão manual de registros:

```json
{
  "source_name": "seed_tjsp",
  "records": [
    {
      "process_number": "0001234-56.2024.8.26.0100",
      "tribunal": "TJSP",
      "judge": "Dr. João Silva",
      "action_type": "Trabalhista",
      "status": "sentença",
      "outcome": "procedente",
      "claim_value": 82000,
      "duration_days": 146,
      "is_settlement": false,
      "is_success": true
    }
  ]
}
```

## Deploy no Railway

Deploy recomendado: **1 serviço Docker** (FastAPI + frontend buildado).

1. Crie um projeto no Railway e conecte este repo.
2. Adicione um banco Postgres no Railway.
3. Configure as variáveis de ambiente:
   - `DATABASE_URL` (do Postgres do Railway)
   - `OPENAI_API_KEY`
   - `OPENAI_MODEL` (opcional)
   - `OPENAI_EMBEDDING_MODEL` (opcional)
   - `OPENAI_EMBEDDING_DIMENSIONS` (opcional, default `1536`)
   - `SESSION_COOKIE_SECURE=true`
   - `SESSION_COOKIE_SAMESITE=lax`
   - `SESSION_TTL_HOURS=168` (opcional)
   - `AUTH_COOKIE_NAME=lexscale_session` (opcional)
4. O Railway vai buildar via `Dockerfile` e iniciar com `uvicorn` em `PORT` automatico.

Observacoes:
- O backend agora serve o frontend buildado (`dist/public`) no mesmo dominio.
- Se frontend e backend ficarem em dominios diferentes, ajuste:
  - `SESSION_COOKIE_SAMESITE=none`
  - `SESSION_COOKIE_SECURE=true`
  - `CORS_ORIGINS` com a URL do frontend.
