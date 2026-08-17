#!/usr/bin/env bash
# Deploy de sync streams a PowerSync Cloud, parametrizado por ambiente (spec 16 Run B, B5 / R5.9).
#
# Fuente canónica: sync-streams/mitropero.yaml (la audita Gate 1 — NO editar powersync/sync-config.yaml,
# es un artefacto generado por este script y está gitignoreado). El MISMO sync set apunta a la
# instancia dev o prod según --env (design §Offline-first: PROD reusa mitropero.yaml sin tocarlo).
#
# Token: PS_ADMIN_TOKEN por env var (o HKCU\Environment con `setx`). Para prod, PS_ADMIN_TOKEN_PROD si
# está seteado; si no, PS_ADMIN_TOKEN (el token es de management de TODA la cuenta → sirve para ambas
# instancias, ver powersync/README.md).
#
# Uso:
#   bash scripts/powersync-deploy.sh                       # DEV (default = IDÉNTICO a hoy)
#   bash scripts/powersync-deploy.sh --validate-only       # DEV, solo valida
#   bash scripts/powersync-deploy.sh --env prod            # PROD (exige MITROPERO_CONFIRM_PROD=1)
#   bash scripts/powersync-deploy.sh --env prod --validate-only
set -euo pipefail
cd "$(dirname "$0")/.."

# Versión pinneada: el CLI está en beta y ya tuvo breaking changes (0.8 → 0.9). Bumpear a propósito.
POWERSYNC_CLI="powersync@0.10.0"

# --- Parseo de flags (--env {dev,prod} + --validate-only, en cualquier orden). ---------------------
ENV_ARG="dev"
VALIDATE_ONLY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --env)   ENV_ARG="${2:-}"; shift 2;;
    --env=*) ENV_ARG="${1#*=}"; shift;;
    --validate-only) VALIDATE_ONLY=1; shift;;
    *) echo "ERROR: argumento desconocido '$1'. Uso: --env {dev,prod} [--validate-only]" >&2; exit 2;;
  esac
done
if [ "$ENV_ARG" != "dev" ] && [ "$ENV_ARG" != "prod" ]; then
  echo "ERROR: --env inválido '$ENV_ARG'. Valores válidos: dev | prod." >&2
  exit 2
fi

# --- Resolución del token del ambiente. -----------------------------------------------------------
if [ "$ENV_ARG" = "prod" ] && [ -n "${PS_ADMIN_TOKEN_PROD:-}" ]; then
  PS_ADMIN_TOKEN="$PS_ADMIN_TOKEN_PROD"
  export PS_ADMIN_TOKEN
fi
if [ -z "${PS_ADMIN_TOKEN:-}" ] && command -v reg >/dev/null 2>&1; then
  # Git Bash: `reg query ... /v NOMBRE` no sirve (MSYS convierte /v en path); filtrar la línea con sed.
  PS_ADMIN_TOKEN=$(reg query 'HKCU\Environment' | sed -n 's/^[[:space:]]*PS_ADMIN_TOKEN[[:space:]]*REG_SZ[[:space:]]*//p' | tr -d '\r')
  export PS_ADMIN_TOKEN
fi
if [ -z "${PS_ADMIN_TOKEN:-}" ]; then
  echo "ERROR: PS_ADMIN_TOKEN no seteado (ni env ni HKCU\\Environment). Ver powersync/README.md." >&2
  exit 1
fi

# --- Guarda de PROD + selección de la instancia (cli.yaml → link de instancia). -------------------
# DEV (default): usa powersync/cli.yaml tal cual → comportamiento IDÉNTICO al histórico (R5.9).
# PROD: exige MITROPERO_CONFIRM_PROD=1 + swap del link de instancia por powersync/cli.prod.yaml (lo
#       crea Run F/F5 al provisionar la instancia "Production", con su project_id real). El swap se
#       restaura SIEMPRE al salir (trap EXIT); el backup va a *.tmp (gitignoreado). Mecanismo
#       agnóstico al auto-discovery del CLI (lee powersync/cli.yaml desde el cwd).
#
# ⚠️ Este `if` es la ÚNICA copia en bash del criterio que en JS vive en `prodConfirmed()`
# (scripts/lib/env-target.mjs): un .sh no puede importar el módulo. Los nombres aceptados tienen que ser
# LOS MISMOS que los de allá — si divergen, la misma variable exportada abre una guarda y bloquea la
# otra. Lo ata `scripts/lib/env-target.test.mjs` (GUARD-ENV-SH), que deriva los nombres del módulo JS y
# exige que este archivo los mencione: agregar o renombrar un nombre allá pone este script en rojo.
# Se acepta el nombre PRE-rebrand (RAFAQ_CONFIRM_PROD) con aviso; el canónico es MITROPERO_CONFIRM_PROD.
if [ "$ENV_ARG" = "prod" ]; then
  if [ "${MITROPERO_CONFIRM_PROD:-}" = "1" ]; then
    :
  elif [ "${RAFAQ_CONFIRM_PROD:-}" = "1" ]; then
    echo "AVISO: confirmaste con RAFAQ_CONFIRM_PROD (nombre PRE-rebrand, sigue funcionando)." >&2
    echo "       El nombre nuevo es MITROPERO_CONFIRM_PROD — pasate cuando puedas: el viejo se va a sacar." >&2
  else
    echo "ABORTADO: --env prod requiere MITROPERO_CONFIRM_PROD=1 (guarda de destino PROD)." >&2
    exit 2
  fi
  if [ ! -f powersync/cli.prod.yaml ]; then
    echo "ERROR: falta powersync/cli.prod.yaml (link a la instancia PROD). Se crea en Run F/F5 al" >&2
    echo "       provisionar la instancia 'Production' (6a260fd10ef84ed6719fd6bf) con su project_id." >&2
    exit 1
  fi
  cp powersync/cli.yaml powersync/cli.yaml.tmp
  trap 'mv -f powersync/cli.yaml.tmp powersync/cli.yaml 2>/dev/null || true' EXIT
  cp powersync/cli.prod.yaml powersync/cli.yaml
  echo "PROD: instancia = powersync/cli.prod.yaml (swap temporal de cli.yaml)."
fi

cp sync-streams/mitropero.yaml powersync/sync-config.yaml

# El `validate` corre un connection-test contra la conexión descrita en powersync/service.yaml LOCAL,
# que apunta a la DB de DEV. La conexión de PROD NO vive acá: se gestiona (managed) en el dashboard de
# PowerSync y no se deploya por CLI (este script SOLO empuja sync-config, nunca service-config). Por eso
# contra prod el connection-test daría un FALSO NEGATIVO (probaría el password de prod contra el host de
# dev → "password authentication failed"). La conexión real de prod se valida aparte con `powersync
# status` (Status: connected). => en prod salteamos SOLO el connection-test; schema + sync-config siguen.
if [ "$ENV_ARG" = "prod" ]; then
  pnpm dlx "$POWERSYNC_CLI" validate --skip-validations=connections
else
  pnpm dlx "$POWERSYNC_CLI" validate
fi

if [ "$VALIDATE_ONLY" = "1" ]; then
  echo "OK: validación pasó ($ENV_ARG, no se deployó)."
  exit 0
fi

pnpm dlx "$POWERSYNC_CLI" deploy sync-config
echo "OK: sync streams deployadas ($ENV_ARG)."
