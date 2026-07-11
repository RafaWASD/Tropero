#!/usr/bin/env bash
# Deploy de sync streams a PowerSync Cloud (instancia Development, ver powersync/cli.yaml).
#
# Fuente canónica: sync-streams/rafaq.yaml (la audita Gate 1 — NO editar powersync/sync-config.yaml,
# es un artefacto generado por este script y está gitignoreado).
#
# Token: PS_ADMIN_TOKEN por env var, o persistido a nivel usuario con `setx PS_ADMIN_TOKEN "<token>"`
# (se lee de HKCU\Environment — el `powersync login` interactivo no funciona en esta máquina, ver
# powersync/README.md).
#
# Uso:  bash scripts/powersync-deploy.sh [--validate-only]
set -euo pipefail
cd "$(dirname "$0")/.."

# Versión pinneada: el CLI está en beta y ya tuvo breaking changes (0.8 → 0.9). Bumpear a propósito.
POWERSYNC_CLI="powersync@0.10.0"

if [ -z "${PS_ADMIN_TOKEN:-}" ] && command -v reg >/dev/null 2>&1; then
  # Git Bash: `reg query ... /v NOMBRE` no sirve (MSYS convierte /v en path); filtrar la línea con sed.
  PS_ADMIN_TOKEN=$(reg query 'HKCU\Environment' | sed -n 's/^[[:space:]]*PS_ADMIN_TOKEN[[:space:]]*REG_SZ[[:space:]]*//p' | tr -d '\r')
  export PS_ADMIN_TOKEN
fi
if [ -z "${PS_ADMIN_TOKEN:-}" ]; then
  echo "ERROR: PS_ADMIN_TOKEN no seteado (ni env ni HKCU\\Environment). Ver powersync/README.md." >&2
  exit 1
fi

cp sync-streams/rafaq.yaml powersync/sync-config.yaml

pnpm dlx "$POWERSYNC_CLI" validate

if [ "${1:-}" = "--validate-only" ]; then
  echo "OK: validación pasó (no se deployó)."
  exit 0
fi

pnpm dlx "$POWERSYNC_CLI" deploy sync-config
echo "OK: sync streams deployadas."
