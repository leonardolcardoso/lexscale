#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

if [[ ! -x ".venv/bin/python" ]]; then
  echo "[lexscale] Python da virtualenv não encontrado em .venv/bin/python" >&2
  exit 1
fi

if [[ $# -lt 1 ]]; then
  echo "uso: $0 '<DATABASE_URL_REMOTA>'" >&2
  echo "exemplo: $0 'postgres://user:pass@host:5432/db'" >&2
  exit 1
fi

REMOTE_DATABASE_URL="$1"

echo "[lexscale] aplicando atualização de schema no banco remoto (sem INSERT/UPDATE/DELETE)..."

DATABASE_URL="${REMOTE_DATABASE_URL}" DB_ALLOW_DATA_MIGRATIONS=false .venv/bin/python -c \
  "from backend.db import init_database; init_database(); print('schema-update-ok')"

echo "[lexscale] concluído."
