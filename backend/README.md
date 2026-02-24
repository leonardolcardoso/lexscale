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
- `POST /api/cases/upload`
- `GET /api/public-data/sources`
- `POST /api/public-data/sources`
- `POST /api/public-data/sync`
- `POST /api/public-data/records`
- `POST /api/ai/chat`
- `GET /api/ai/history`
- `POST /api/ai/search`

Observacao: todos os endpoints `/api/*` (exceto login/registro) exigem sessao autenticada via cookie HTTP-only.

Inventario completo dos dados do dashboard:
- `/Users/pedrobrugger/Projects/lexScale/repos/lexscale/docs/dashboard-data-inventory.md`

Exemplo de body:

```json
{
  "prompt": "Resuma os principais riscos desta clausula contratual.",
  "system_prompt": "Voce e um advogado senior especializado em contratos.",
  "model": "gpt-4.1-mini",
  "temperature": 0.2,
  "max_output_tokens": 600
}
```

Exemplo de cadastro de fonte publica:

```json
{
  "name": "tjsp_api",
  "base_url": "https://seu-endpoint-publico/casos",
  "tribunal": "TJSP",
  "headers": {},
  "enabled": true
}
```

## APIs reais ja conectadas por padrao

Na inicializacao, o backend cadastra automaticamente:
- `tjdft_jurisprudencia` -> `https://jurisdf.tjdft.jus.br/api/v1/pesquisa`
- `trf5_transparencia_documentos` -> `https://api-transparencia.trf5.jus.br/api/v1/documento/tipo`

Controle da coleta TJDFT via ambiente:
- `PUBLIC_SYNC_TJDFT_QUERY` (default: `direito civil`)
- `PUBLIC_SYNC_TJDFT_PAGE_SIZE` (default: `40`)

Exemplo de ingestao manual de registros:

```json
{
  "source_name": "seed_tjsp",
  "records": [
    {
      "process_number": "0001234-56.2024.8.26.0100",
      "tribunal": "TJSP",
      "judge": "Dr. Joao Silva",
      "action_type": "Trabalhista",
      "status": "sentenca",
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

Deploy recomendado: **1 servico Docker** (FastAPI + frontend buildado).

1. Crie um projeto no Railway e conecte este repo.
2. Adicione um banco Postgres no Railway.
3. Configure as variaveis de ambiente:
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
