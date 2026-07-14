# Contexto — 16-ambientes-y-release (Gate 0, ADR-022)

> Refinamiento de contexto previo a la spec. Cierra las decisiones de fondo para que `spec_author` no improvise.
> Estado: **propuesto** — pendiente de aprobación humana (Raf) para pasar a `context_ready`.
> Fecha: 2026-07-12. Origen: plan aprobado `C:/Users/RAR20313/.claude/plans/quiero-planificar-la-implementacion-noble-journal.md` (Fases 1 y 5).

## Objetivo

Pasar de **UN solo backend de facto** (dev = tests = beta) a **2 backends + 3 targets de app**, para que la beta con el peón de Chascomús corra contra un **PROD limpio** sin contaminar (ni ser contaminada por) el desarrollo y las 14 suites de `check.mjs`. El proyecto Supabase actual (`xrhlxxdnfzvdnztacofj`) **queda como DEV** — los tests siguen corriendo ahí, cero disrupción — y **prod nace limpio**.

Cubre las **Fases 1 (separación de ambientes)** y **5 (ops livianas)** del plan. La **Fase 0** (fix del Gradle del primer APK + re-aplicación de la config OTA) es **chore PRE-SDD**, prerequisito fuera de este `context.md` (ver "Prerequisito" abajo).

## Estado actual (verificado contra `main`, 2026-07-12)

- **Un solo ambiente**: `xrhlxxdnfzvdnztacofj` + PowerSync "Development" compartidos por dev, las 14 suites de `check.mjs` y la beta. Contaminación real documentada (`docs/backlog.md`).
- **`app/eas.json`**: los 3 profiles (`preview`/`development`/`production`) embeben las **mismas** `EXPO_PUBLIC_*` apuntando al backend DEV. **No** tienen `channel` (la config OTA vive solo en la rama `apk-prep`).
- **`app/app.json`**: `extra.supabaseUrl` **hardcodeada** (línea 47); `owner: rafaqsorg`, `eas.projectId` presente; sin config de `expo-updates`.
- **`app/src/utils/env.ts`**: lee `process.env[name]` **dinámico** (key computada) + fallback a `Constants.expoConfig.extra` → babel NO lo inlinea en build web (gotcha). El shim E2E (`app/e2e/helpers/fixtures.ts:24-40`) inyecta las 3 vars en `globalThis.process.env`. `env-resolve.ts` valida el set `{supabaseUrl, supabaseAnonKey, powersyncUrl}` fail-closed.
- **PowerSync "Production"** creada sin provisionar (`6a260fd10ef84ed6719fd6bf`, `powersync/README.md`).
- **Rama `apk-prep` STALE**: `main`-de-2026-07-07 + 1 commit OTA (`5426d99`); `main` avanzó con todo el batch de la 2da demo → se re-aplica la config OTA fresca, NO se mergea.
- **Secretos reales en `.env.local`** (service_role, tokens) — pendientes de rotar antes de prod.

## Decisiones de Gate 0 (lo que se cierra)

### D1 — Dos backends: DEV = actual, PROD = nuevo y limpio
- **DEV** = el proyecto actual `xrhlxxdnfzvdnztacofj` + PowerSync "Development" + profile EAS `development`. **Las 14 suites + E2E siguen corriendo acá, sin cambios.**
- **PROD** = proyecto Supabase **nuevo** (misma región que dev) + instancia PowerSync "Production" (provisionar la ya-creada) + profile `production`.
- **Por qué no un 3er backend "homo"**: en mobile el riesgo vive en el binario, no en el server; un staging con datos sintéticos no reproduce nada y duplica mantenimiento para un solo dev. El free tier cubre **exactamente** 2 proyectos Supabase + 2 instancias PowerSync.

### D2 — Tres targets de app EAS
- `development` → backend **DEV** (dev client, bundle id `ar.rafq.app.dev`, instalable **junto** a prod).
- `preview` → backend **PROD** + canal `preview` (el binario candidato que Facundo/el peón prueban contra datos reales; "homo" del banco = este canal + staged rollout, **no** un server).
- `production` → backend **PROD** + canal `production`.
- Vars movidas a **EAS Environment Variables** (el campo `env` del build profile **NO** aplica a `eas update` → usar `eas update --environment <env>`). Nueva var `EXPO_PUBLIC_ENV` ∈ `{development, preview, production, e2e}`.

### D3 — Estado de PROD por replay ordenado de migraciones (no dump de schema)
- Las ~123 migraciones son la **fuente canónica**; el replay ordenado **valida reproducibilidad**. Ensayar el replay contra Supabase **local/docker** primero.
- Ledger `ops.applied_migrations` en la DB target (bootstrap + catch-up por release).
- Tras aplicar a prod: `pg_dump --schema-only` de dev vs prod + **diff** → cada delta se vuelve **migración 0124+**, nunca fix manual.

### D4 — Config de la app: `app.config.ts` + lecturas estáticas
- Migrar `app/app.json` → `app/app.config.ts` con `APP_VARIANT` (development → "RAFAQ (Dev)" + package `.dev`; ojo: cambiar package **invalida el dev client instalado** → rebuild).
- `env.ts`: anteponer lecturas **ESTÁTICAS** (una por var, literales) con fallback al reader dinámico actual y a `extra` → el shim E2E sigue funcionando **sin tocar los ~70 specs**. Antes de borrar `extra.supabaseUrl`: grep de quién la consume.
- Extender `fixtures.ts` para setear `EXPO_PUBLIC_ENV='e2e'` + flag `window.__RAFAQ_E2E__` (mismo patrón que `ble-e2e-flag.ts`).

### D5 — Scripts parametrizados con guarda de prod + backup/health desde día 1
- `scripts/apply-migration.mjs --env prod` (default dev = **cero cambio**; con prod imprime el ref y exige `RAFAQ_CONFIRM_PROD=1`); nuevo `scripts/apply-all-migrations.mjs` (replay + ledger); `scripts/powersync-deploy.sh --env prod`; deploy de las 8 Edge Functions a prod.
- `scripts/backup-db.mjs` (pg_dump contra el **pooler** de prod, comprimido, timestampeado) + GitHub Action cron diaria (`RafaWASD/Tropero`, connection string como secret, artifacts 90 días).
- Edge Function `health` (`SELECT 1` + versión de schema del ledger) en **ambos** proyectos (el ping de UptimeRobot además evita la pausa por inactividad del free tier).

### D6 — PROD nace vacío (decisión de Raf, no re-preguntar)
- El campo de Chascomús se recarga vía **import** (feature 12) — de paso smoke-testea el import en prod. Se pierde el historial de las 2 demos (rescate a mano solo si Raf lo pide un dato puntual). Usuarios se **re-crean** (smoke real del flujo invitaciones + Resend en prod).

### D7 — Riesgo `preview → PROD`: tenant de prueba aislado
- Con `preview` apuntando a PROD, las pruebas diarias de Raf escriben en prod → crear un establecimiento **"Campo de prueba RAFAQ"** en prod y **filtrar ese tenant** en PostHog/Sentry (coordina con feature 17).

## Checklist manual que el replay NO cubre (va al runbook, E.5)

- **Auth**: SMTP/Resend, templates es-AR, Site URL / redirect URLs.
- **Secrets de Edge Functions**: `supabase secrets set --project-ref <prod>`.
- **SQL de setup de PowerSync**: rol de replicación + **publication `FOR TABLE` explícita** — verificado que **NO** está en las migraciones (fue setup manual en dev). (Además es pre-requisito del audit log de feature 17: si fuera `ALL TABLES`, el audit entraría al WAL replicado.)

## Edge cases (a cubrir en requirements)

- **`check.mjs` verde SIN cambios**: los tests apuntan a dev por diseño; el default de los scripts es dev.
- **Shim E2E intacto**: las lecturas estáticas conviven con el fallback dinámico → los ~70 specs no se tocan; se agrega `EXPO_PUBLIC_ENV='e2e'` al shim.
- **`extra.supabaseUrl`**: grep de consumidores antes de borrarla (puede haber un lector legacy).
- **Bundle `.dev`**: cambiar el package invalida el dev client ya instalado de Raf → rebuild (aceptado).
- **`eas update` vs `env` de build**: el `env` del profile no viaja a los updates OTA → EAS Environment Variables + `--environment`.
- **pg_dump**: contra el **pooler** (no la conexión directa); restore drill probado **una vez** (backup no probado no es backup).

## Fuera de scope (este bloque)

3er backend "homo", Supabase branching (requiere Pro), PITR (~US$100/mes), particionado, CI de tests (ticket aparte), **limpiar la contaminación de dev** (ticket aparte). El audit log, Sentry y PostHog son **feature 17** (no acá).

## Prerequisito — Fase 0 (chore PRE-SDD, fuera de este context.md)

Diagnosticar+arreglar el fallo de Gradle del primer APK (build `68cc88d7`) **con el árbol actual** + re-aplicar la config OTA (`expo-updates`) sobre `main`. **Bloqueado** por el log del build EAS (cuenta Expo de Raf). Se maneja como chore antes de que E.2 (Sentry) apile variables sobre el build.

## Dependencias externas (cuenta de Raf — gatean la implementación)

1. **Crear proyecto Supabase PROD** (misma región que dev) — cuenta/org de Raf.
2. **Provisionar la instancia PowerSync "Production"** (`6a260fd10ef84ed6719fd6bf`): conexión a la DB prod, auth `supabase: true`.
3. **GitHub secret** con connection string de prod (para la Action de backup) en `RafaWASD/Tropero`.
4. **Cuenta UptimeRobot** (E.5).
5. **(Prerequisito Fase 0)** log del build EAS `68cc88d7`.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| Replay de migraciones no reproducible en prod | Ensayar contra Supabase local/docker primero; ledger `ops.applied_migrations`; diff pg_dump dev/prod obligatorio. |
| Divergencia silenciosa dev/prod | Todo delta del diff → migración 0124+, nunca fix manual. |
| `preview → PROD` ensucia prod con pruebas de Raf | Tenant "Campo de prueba RAFAQ" + filtro en observabilidad (feature 17). |
| Backup nunca probado | Restore drill contra Postgres local, UNA vez, documentado en el runbook. |
| Setup PowerSync manual olvidado en prod | Checklist explícito en el runbook (role + publication `FOR TABLE`). |

## Gate de seguridad

**Gate 1 (security_analyzer modo `spec`) OBLIGATORIO** antes de la Puerta 1: toca env/secrets, scripts de migración contra la DB compartida, Edge Functions (`health` + deploy a prod), auth de PowerSync, y backup con connection string. Foco: la guarda de prod de los scripts (no aplicar a prod por accidente), secrets fuera de archivos committeados, el `health` no filtra datos, la connection string del backup solo en GitHub secret / `.env.local`.

## Preguntas para la Puerta 0 (Raf)

1. **¿Confirmás el package `ar.rafq.app.dev` para el target dev?** (invalida el dev client que tengas instalado → rebuild; es lo que permite tener dev + prod en el mismo teléfono).
2. **Mientras E.0/E.1 esperan tus cuentas (Expo/Supabase), ¿arranco en paralelo el Gate 0 + spec del audit log (E.4, feature 17)?** Es la parte 100% autónoma (server-side, testeable contra dev, sin cuenta externa).
3. Todo lo demás (2 backends, replay de migraciones, prod vacío + re-import, tenant de prueba) ya está decidido en el plan — no lo re-abro salvo que quieras.
