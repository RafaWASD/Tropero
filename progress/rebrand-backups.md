# Rebrand RAFAQ → miTropero — Cat. H: directorio y prefijo de los backups

**Fecha**: 2026-08-17 · **HEAD de arranque**: `21be5cf` · **Árbol**: verde (`check.mjs` RC=0, 3155 tests).

Cat. H del plan (`docs/rebrand-mitropero-plan.md` §H) — la única categoría que **ninguna fase tenía
asignada** (`progress/rebrand-fases-4-5-preparacion.md` §"Fase 7", punto 2).

## 0. Qué se renombra y qué NO

| Renombra | De | A |
|---|---|---|
| Dir default del backup | `~/.rafaq-backups` | `~/.mitropero-backups` |
| Prefijo del dump | `rafaq-prod-<ISO>.sql.gz` | `mitropero-prod-<ISO>.sql.gz` |
| Artifacts de CI | `rafaq-prod-backup` / `rafaq-prod-manifest` | `mitropero-prod-backup` / `mitropero-prod-manifest` |

**NO se migran los backups ya existentes en `~/.rafaq-backups/`.** Son locales, se quedan donde están, y
el script no los busca (nunca listó el dir: solo escribe `outPath`). Consecuencia asumida: a partir de
este cambio hay dos dirs locales; el viejo queda como archivo histórico.

**Fuera de alcance (NO TOCAR)**: `RAFAQ_ENV` / `RAFAQ_CONFIRM_PROD` / `RAFAQ_KNOWN_PROD_REFS`
(acoplamiento externo: secret de Supabase + memoria muscular de Raf + el propio workflow), `rafaq-beta`
(instancia de PowerSync), `design/**`, `rafaq.db`, `progress/`, migraciones con `rafaq.is_`, fase 6 (Expo).

## 1. Inventario (`git grep -n "rafaq-backups\|rafaq-prod"` sobre `21be5cf`)

### 1.a — Se cambian (código + CI + tests)

| Archivo:línea | Qué | Clase |
|---|---|---|
| `scripts/lib/backup-cmd.mjs:73` | `return \`rafaq-prod-${isoStamp(now)}.sql.gz\`` | **FUENTE del prefijo** |
| `scripts/lib/backup-cmd.mjs:78` | `path.join(homedir, '.rafaq-backups')` | **FUENTE del dir** |
| `scripts/lib/backup-cmd.mjs:8` | comentario H1/R5.10 | prosa |
| `scripts/backup-db.mjs:6` | comentario de uso (`~/.rafaq-backups/rafaq-prod-<ISO>.sql.gz`) | prosa |
| `.gitignore:32` | comentario de la red de contención | prosa |
| `.github/workflows/backup-prod.yml:51` | **glob del cifrado** `"$RUNNER_TEMP"/rafaq-prod-*.sql.gz` | 🔴 acoplado |
| `.github/workflows/backup-prod.yml:132` | **glob del descifrado** `"$RUNNER_TEMP"/dl/rafaq-prod-*.sql.gz.gpg` | 🔴 acoplado |
| `.github/workflows/backup-prod.yml:61,75` | `name:` de los **upload**-artifact | 🔴 acoplado |
| `.github/workflows/backup-prod.yml:117,122` | `name:` de los **download**-artifact (job `verify-restore`) | 🔴 acoplado |
| `.github/workflows/backup-prod.yml:3` | comentario `(rafaq-prod)` — nombra el **proyecto Supabase de PROD**, que es un recurso EXTERNO fuera del alcance de esta unidad (mismo criterio que `rafaq-beta` en PowerSync). Se reescribe el comentario para que **no hardcodee** un nombre externo, en vez de renombrar algo que vive en el dashboard | prosa |
| `scripts/lib/backup-cmd.test.mjs:43,45,50,53` | tests que asertan dir y filename | test |

Los 6 sitios 🔴 del workflow son el acoplamiento silencioso: si el prefijo cambia y el glob no,
**el paso de cifrado no encuentra nada** y el backup del día se pierde sin que nadie mire.
El upload y el download son un par: el job `verify-restore` baja lo que subió el mismo run.

### 1.b — Se reconcilian (specs del as-built; regla "correcciones se reflejan en specs")

| Archivo:línea | Qué |
|---|---|
| `specs/active/16-ambientes-y-release/design.md:279,411,414,424` | tabla de `backup-db.mjs` + snippet del workflow + nota H1/R5.10 |
| `specs/active/16-ambientes-y-release/tasks.md:106,133` | B4 (output fuera del tree) + B7 (`git check-ignore`) |

### 1.c — NO se tocan (registro histórico o estado previo, a propósito)

| Archivo | Por qué |
|---|---|
| `progress/**` (impl_16-runB, review_16-runB, security_*, impl_campanas-congeladas, rebrand-*) | bitácora: dicen lo que pasó cuando pasó |
| `docs/rebrand-mitropero-plan.md:251-254` | es el plan que describe **este** trabajo y el estado previo |
| `specs/active/07-reportes-basicos/tasks-campanas-congeladas.md:599` | `~/.rafaq-backups/facundina-pre-reseed-2026-08-07.json` es un **archivo real que existe en esa ruta**. Reescribirlo lo volvería falso. |

## 2. El guard (lo que hace que el rename valga la pena)

Hoy nada ata `scripts/lib/backup-cmd.mjs` con `.github/workflows/backup-prod.yml`. Cambiar el prefijo en
uno y no en el otro rompe el backup de PROD **en silencio** — la clase de falla que costó 8 corridas mudas
el 2026-08-09.

**Archivo**: `scripts/lib/backup-ci-consistency.test.mjs`
**Registro**: stage `scripts unit tests` de `scripts/run-tests.mjs` (⚠️ lista explícita: un test que no
figura ahí NUNCA corre).

Escrito **sobre la ausencia** y **derivando**, no hardcodeando:

1. Deriva el prefijo y el sufijo POR COMPORTAMIENTO: llama a `backupFilename(now)` e `isoStamp(now)` y
   parte el resultado por el stamp. No hay literal `mitropero-prod-` en el guard.
2. Ancla: el workflow tiene que invocar `scripts/backup-db.mjs`, y `backup-db.mjs` tiene que importar de
   `./lib/backup-cmd.mjs` — si no, el guard estaría derivando de un módulo que el CI no usa.
3. **Globs**: extrae del YAML *todos* los tokens con `*` que terminan en `.sql.gz`/`.sql.gz.gpg` y exige
   que **cada uno matchee el filename real** que produce el script (el `.gpg` contra `<real>.gpg`).
   Oráculo por comportamiento: "el glob encuentra el archivo", no "el glob dice tal string".
4. **Artifacts**: extrae los `name:` de cada `actions/upload-artifact` y `actions/download-artifact`;
   exige (a) que **todos** empiecen con el prefijo derivado y (b) que **todo download exista como
   upload** (son un par dentro del mismo run).
5. Cotas anti-vacío: ≥3 globs y ≥2 artifacts por lado — si la regex deja de extraer, el guard no pasa
   en verde por no haber mirado nada.

**Falsificación exigida** (mutantes, aplicados al árbol y revertidos):
- M1: prefijo cambiado **sólo en `backup-cmd.mjs`** → rojo.
- M2: prefijo cambiado **sólo en un glob** del workflow → rojo.
- M3: nombre de artifact cambiado **sólo en el upload** (o sólo en el download) → rojo.
Si algún mutante pasa en verde, el guard no sirve y se reporta.

## 3. Plan de ejecución

1. `progress/rebrand-backups.md` (este archivo) — hecho antes de tocar nada.
2. `scripts/lib/backup-cmd.mjs`: prefijo + dir + comentario.
3. `scripts/lib/backup-cmd.test.mjs`: actualizar las 4 aserciones al nombre nuevo.
4. `.github/workflows/backup-prod.yml`: los 2 globs + los 4 `name:` de artifact + el comentario del header.
5. `scripts/backup-db.mjs` + `.gitignore`: comentarios.
6. Guard nuevo + registro en `scripts/run-tests.mjs`.
7. Falsificar el guard con M1/M2/M3.
8. Reconciliar `specs/active/16-ambientes-y-release/{design,tasks}.md`.
9. Verificación: `node --test scripts/lib/backup-cmd.test.mjs` · guard verde + 3 mutantes rojos ·
   `node scripts/check.mjs` RC=0 · `pnpm -C app typecheck` · `git grep` limpio.

## 4. Lo que NO se verifica (y no se intenta)

**No se dispara el workflow**: corre contra PROD. La verificación es **estática** (el guard) + los unit
tests. Si hiciera falta una corrida real, se pide; no se lanza.

El workflow está agendado (`cron: '0 6 * * *'`), así que el rename entra solo en la próxima corrida
programada. **No pude mirar el historial de corridas**: no hay `gh` CLI en este entorno (`gh: command not
found`, y tampoco está en `C:\Program Files\GitHub CLI`). O sea: que el guard esté verde dice que los
nombres son consistentes entre sí, **no** que la corrida de mañana vaya a salir verde.

## 5. Ejecución (se completa al terminar)

Ver el reporte final de la sesión.
