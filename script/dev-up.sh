#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

find_free_port() {
  local port="$1"
  while lsof -nP -iTCP:"${port}" -sTCP:LISTEN >/dev/null 2>&1; do
    port=$((port + 1))
  done
  echo "${port}"
}

require_command() {
  local cmd="$1"
  if ! command -v "${cmd}" >/dev/null 2>&1; then
    echo "[lexscale] comando obrigatório não encontrado: ${cmd}" >&2
    exit 1
  fi
}

require_command lsof
require_command docker
require_command npm
require_command curl

if [[ ! -x ".venv/bin/python" ]]; then
  echo "[lexscale] Python da virtualenv não encontrado em .venv/bin/python" >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "[lexscale] Docker não está disponível. Inicie o Docker/Colima e tente novamente." >&2
  exit 1
fi

RUNNING_DB_CONTAINER="$(docker ps --filter "label=com.lexscale.dev=postgres" --format "{{.Names}}" | head -n 1)"
if [[ -z "${RUNNING_DB_CONTAINER}" ]]; then
  RUNNING_DB_CONTAINER="$(docker ps --filter "name=^lexscale-postgres-" --format "{{.Names}}" | head -n 1)"
fi
if [[ -n "${RUNNING_DB_CONTAINER}" ]]; then
  DB_CONTAINER="${RUNNING_DB_CONTAINER}"
  DB_PORT="$(docker port "${DB_CONTAINER}" 5432/tcp | awk -F: 'NR==1 {print $2}')"
  echo "[lexscale] reutilizando banco ${DB_CONTAINER} na porta ${DB_PORT}"
else
  DB_PORT="$(find_free_port "${DB_START_PORT:-5436}")"
  DB_CONTAINER="lexscale-postgres-${DB_PORT}"
  if docker ps -a --format "{{.Names}}" | rg -x "${DB_CONTAINER}" >/dev/null 2>&1; then
    echo "[lexscale] iniciando banco existente ${DB_CONTAINER} na porta ${DB_PORT}"
    docker start "${DB_CONTAINER}" >/dev/null
  else
    echo "[lexscale] iniciando banco ${DB_CONTAINER} na porta ${DB_PORT}"
    docker run \
      --name "${DB_CONTAINER}" \
      --label com.lexscale.dev=postgres \
      -e POSTGRES_DB=lexscale \
      -e POSTGRES_USER=postgres \
      -e POSTGRES_PASSWORD=postgres \
      -p "${DB_PORT}:5432" \
      -d pgvector/pgvector:pg16 >/dev/null
  fi
fi

for _ in $(seq 1 90); do
  if docker exec "${DB_CONTAINER}" pg_isready -U postgres -d lexscale >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! docker exec "${DB_CONTAINER}" pg_isready -U postgres -d lexscale >/dev/null 2>&1; then
  echo "[lexscale] banco não ficou pronto a tempo." >&2
  exit 1
fi

docker exec "${DB_CONTAINER}" psql -U postgres -d lexscale -c "CREATE EXTENSION IF NOT EXISTS vector;" >/dev/null

FRONTEND_PORT="$(find_free_port "${FRONTEND_START_PORT:-5000}")"
BACKEND_PORT="$(find_free_port "${BACKEND_START_PORT:-8000}")"
if [[ "${FRONTEND_PORT}" == "${BACKEND_PORT}" ]]; then
  BACKEND_PORT="$(find_free_port "$((BACKEND_PORT + 1))")"
fi

BACKEND_LOG="${ROOT_DIR}/.backend.dev.log"
FRONTEND_LOG="${ROOT_DIR}/.frontend.dev.log"

echo "[lexscale] backend:  http://localhost:${BACKEND_PORT}"
echo "[lexscale] frontend: http://localhost:${FRONTEND_PORT}"
echo "[lexscale] logs: ${BACKEND_LOG} | ${FRONTEND_LOG}"

DATABASE_URL="postgresql+psycopg://postgres:postgres@localhost:${DB_PORT}/lexscale" \
CORS_ORIGINS="http://localhost:${FRONTEND_PORT},http://127.0.0.1:${FRONTEND_PORT}" \
.venv/bin/python -m uvicorn backend.main:app --host 0.0.0.0 --port "${BACKEND_PORT}" \
  >"${BACKEND_LOG}" 2>&1 &
BACKEND_PID=$!

for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${BACKEND_PORT}/health" >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "${BACKEND_PID}" >/dev/null 2>&1; then
    echo "[lexscale] backend falhou ao iniciar. Confira ${BACKEND_LOG}" >&2
    exit 1
  fi
  sleep 1
done

if ! curl -fsS "http://127.0.0.1:${BACKEND_PORT}/health" >/dev/null 2>&1; then
  echo "[lexscale] backend não respondeu /health a tempo. Confira ${BACKEND_LOG}" >&2
  exit 1
fi

BACKEND_PROXY_TARGET="http://127.0.0.1:${BACKEND_PORT}" \
npm run dev:client -- --host 0.0.0.0 --port "${FRONTEND_PORT}" >"${FRONTEND_LOG}" 2>&1 &
FRONTEND_PID=$!

cleanup() {
  if [[ -n "${FRONTEND_PID:-}" ]]; then
    kill "${FRONTEND_PID}" >/dev/null 2>&1 || true
  fi
  if [[ -n "${BACKEND_PID:-}" ]]; then
    kill "${BACKEND_PID}" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT INT TERM

echo "[lexscale] ambiente pronto."
echo "[lexscale] para acompanhar logs:"
echo "  tail -f ${BACKEND_LOG}"
echo "  tail -f ${FRONTEND_LOG}"
echo "[lexscale] Ctrl+C encerra frontend/backend (o container do banco permanece ativo)."

while true; do
  if ! kill -0 "${BACKEND_PID}" >/dev/null 2>&1; then
    echo "[lexscale] backend encerrou. Finalizando o restante..."
    exit 1
  fi
  if ! kill -0 "${FRONTEND_PID}" >/dev/null 2>&1; then
    echo "[lexscale] frontend encerrou. Finalizando o restante..."
    exit 1
  fi
  sleep 1
done
