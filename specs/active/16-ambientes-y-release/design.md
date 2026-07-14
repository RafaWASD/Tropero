# Spec 16 — Ambientes y release — Design

**Status**: spec_ready · **Fecha**: 2026-07-13
Fuente: `context.md` (Gate 0) + plan aprobado (Fases 1 y 5). Requisitos: `requirements.md`.

> Este feature es **infra/ops**, no producto. No agrega pantallas ni tablas de negocio. El único
> objeto de schema nuevo es una función `public.health_status()` + el ledger `ops.applied_migrations`.
> Toca las fronteras de: env/boot de la app (offline-first), separación multi-proyecto, secrets, Edge
> Functions y auth de PowerSync — por eso Gate 1 es obligatorio.
>
> **Gate 1 (2026-07-13): FAIL → reconciliado.** Los findings (H1 backups gitignore/out-of-tree, M1
> `REVOKE FROM PUBLIC`, M2 rate-limit del `health` público, M3 cifrado del artifact, M4 checklist Auth
> de PROD, M5 guarda destino-aware, L1–L6, + hallazgo en vivo publication `FOR TABLES IN SCHEMA public`)
> están foldeados en este design y en `requirements.md` §Historial de refinamiento. Reporte:
> `progress/security_spec_16-ambientes-y-release.md`.

## Multi-tenancy / RLS (regla dura — CLAUDE.md principio 6)

La feature no crea tablas de negocio, pero **sí toca** la frontera multi-tenant en dos puntos:

1. **PowerSync PROD — publication `FOR TABLES IN SCHEMA public`** (R6.6/R6.7/R6.7b): el aislamiento por
   `establishment_id` y la frontera WAL (`user_private` self-only, ADR-025) dependen de qué tablas
   alimenta la publicación lógica de replicación. **Hallazgo en vivo (autoritativo)**: la publication de
   **DEV** hoy es **`FOR ALL TABLES`** (`puballtables=true`, verificado contra dev; PG **17.6**; todas
   las tablas de la app viven en `public`), **no** `FOR TABLE` explícita como decía el context/spec. Para
   PROD el setup correcto desde el arranque es **`CREATE PUBLICATION ... FOR TABLES IN SCHEMA public`**
   (PG15+): mantiene el auto-include de tablas nuevas de `public` y deja **fuera** `audit` (feature 17/18)
   y `ops`. Si en PROD quedara `FOR ALL TABLES`, esos schemas entrarían al WAL replicado.
   **Ownership**: la **conversión** de la publication de DEV (ALL TABLES → FOR TABLES IN SCHEMA public) la
   owna **feature 18** (frontera WAL del audit log); acá en 16 solo va el setup correcto de PROD + la
   mención en el runbook + la aserción `puballtables=false` (R6.7b). Ítem **obligatorio** del checklist de PROD.
2. **`ops.applied_migrations` + `public.health_status()`**: `ops` es un schema de metadata de ops, **no
   expuesto por PostgREST** (no está en `config.toml` `api.schemas`) y con `REVOKE` a
   `anon`/`authenticated`. `health_status()` es `SECURITY DEFINER` y no lee ninguna tabla de tenant.

## Offline-first (regla dura — CLAUDE.md principio 3)

- La resolución de env (R3) corre en el **boot** de la app. Las lecturas estáticas + el fallback
  dinámico/`extra` no cambian la semántica de arranque offline: si las vars están inlineadas (build de
  prod) el cliente Supabase/PowerSync bootea igual sin red.
- PROD usa **el mismo** `sync-streams/rafaq.yaml` sin tocarlo (R6). Las estrategias de conflicto y los
  buckets no cambian: es el mismo sync set apuntando a otra DB.
- Cambiar el `package`/`bundleIdentifier` a `.dev` (R2.2) implica una **instalación nueva** → SQLite
  local fresco → primer sync completo. Aceptado (context.md, edge case "Bundle `.dev`").

---

## 1. Config de la app — `app/app.config.ts` (R2)

Migrar `app/app.json` → `app/app.config.ts` (TS, `export default ({ config }) => ({...})` con
`ConfigContext`). El discriminador es `process.env.APP_VARIANT` (lo setea EAS por profile).

```ts
// app/app.config.ts (forma; el implementer completa)
const IS_DEV = process.env.APP_VARIANT === 'development';
export default (): ExpoConfig => ({
  name: IS_DEV ? 'RAFAQ (Dev)' : 'RAFAQ',
  slug: 'rafaq-app',
  scheme: 'rafq',
  version: '0.1.0',
  // ...icon/orientation/userInterfaceStyle/plugins/web sin cambios
  ios: { ...ios, bundleIdentifier: IS_DEV ? 'ar.rafq.app.dev' : 'ar.rafq.app' },
  android: { ...android, package: IS_DEV ? 'ar.rafq.app.dev' : 'ar.rafq.app' },
  extra: {
    // supabaseUrl SOLO si sobrevive el grep de consumidores (R2.5); si no, se elimina.
    router: {},
    eas: { projectId: 'd8cf3a19-e8f7-4d7f-b417-54123e7f0d3e' },
  },
  owner: 'rafaqsorg',
});
```

- **R2.5 — grep de `extra.supabaseUrl`**: antes de borrarlo, `Grep` de `extra.supabaseUrl` /
  `expoConfig.extra` en `app/src`. `env.ts` ya lo lee como fallback (`extra[name]` con `name` =
  `EXPO_PUBLIC_*`, **no** `supabaseUrl`). Si no hay consumidor de la clave literal `supabaseUrl`, se
  elimina; si lo hay, se conserva hasta migrarlo. Documentar el resultado del grep en `impl_16`.
- **Dependencia de Fase 0 (OTA)**: el bloque `updates` (`updates.url`, `runtimeVersion`) + el plugin
  `expo-updates` los aporta Fase 0 (chore). `app.config.ts` debe quedar estructurado para recibirlos
  sin conflicto; esta spec **no** los redacta. Si Fase 0 ya corrió, se preservan.

## 2. Resolución de env — `app/src/utils/env.ts` + `env-resolve.ts` (R3)

Anteponer un **mapa estático** (accesos literales, inlineables por babel) al reader dinámico actual.
La composición del reader se extrae a `env-resolve.ts` (**puro**, testeable bajo `node:test`, sin
imports de expo) para preservar el patrón existente.

```ts
// env-resolve.ts (nuevo helper puro, además de resolveEnv que NO cambia)
export function composeReader(
  staticMap: Record<string, string | undefined>,
  dynamicRead: EnvReader,
  extraRead: EnvReader,
): EnvReader {
  return (name) => {
    const s = staticMap[name]; if (s && s.length) return s;      // R3.1
    const d = dynamicRead(name); if (d && d.length) return d;    // R3.2 (dev server + shim E2E)
    return extraRead(name);                                       // R3.2 (extra)
  };
}
```

```ts
// env.ts
const STATIC = {
  EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
  EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  EXPO_PUBLIC_POWERSYNC_URL: process.env.EXPO_PUBLIC_POWERSYNC_URL,
  EXPO_PUBLIC_ENV: process.env.EXPO_PUBLIC_ENV,
} as const;
const read = composeReader(STATIC, (n) => (process.env as any)[n], (n) => extra[n]);
export const getEnv = () => resolveEnv(read);   // resolveEnv INTACTO (R3.3, copy sin cambios)
```

- **`resolveEnv` no cambia** → el conjunto requerido sigue siendo `{supabaseUrl, supabaseAnonKey,
  powersyncUrl}` con el mismo error fail-closed en español (R3.3). `env-resolve.test.ts` sigue verde;
  se agregan casos para `composeReader` (orden estático → dinámico → extra).
- **`EXPO_PUBLIC_ENV`** (R3.4): nuevo módulo `app/src/utils/app-env.ts` (puro), con `getAppEnv(): 'development'|'preview'|'production'|'e2e'` (default `development`) e `isE2E()`.

> **Reconciliación as-built (Run A, 2026-07-14).** El STATIC de `env.ts` NO incluye `EXPO_PUBLIC_ENV`:
> `env.ts` compone el reader que consume **`resolveEnv`**, y `resolveEnv` no lee `EXPO_PUBLIC_ENV` (lo
> lee `app-env.ts`). Ponerlo en el STATIC de `env.ts` sería un acceso literal inlineado pero nunca
> consumido (código muerto). Por eso el acceso ESTÁTICO literal de `EXPO_PUBLIC_ENV` (R3.1) vive en
> **`app-env.ts`** (su consumidor real), con el mismo fallback dinámico por key variable (R3.2) — sin
> capa `extra`, porque el módulo es puro y no importa `expo-constants` (y `EXPO_PUBLIC_ENV` no viaja por
> `extra`). El STATIC de `env.ts` queda con las 4 vars que sí lee `resolveEnv`:
> `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_POWERSYNC_URL` y
> **`EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`** (agregada por la reconciliación con feature 19: público, se
> inlinea igual → el web build de la 19 obtiene el ID en vez de undefined). R3.1 se cumple: cada var
> pública se lee por un acceso estático literal, en el módulo que la consume.

### `app/src/utils/app-env.ts` — `isE2E()` (R3.6/R3.7)

Mismo patrón que `ble-e2e-flag.ts`: flag `window.__RAFAQ_E2E__` que **solo** Playwright pone con
`addInitScript` antes del bundle, más el discriminador `EXPO_PUBLIC_ENV==='e2e'`.

```ts
const E2E_GLOBAL_KEY = '__RAFAQ_E2E__';
export function isE2E(): boolean {
  try {
    if ((globalThis as any)[E2E_GLOBAL_KEY] === true) return true;
    return getAppEnv() === 'e2e';
  } catch { return false; }
}
export const APP_E2E_GLOBAL_KEY = E2E_GLOBAL_KEY;
```

Feature 17 consume `isE2E()` para gatear Sentry/PostHog. Pura (solo lee `globalThis`/`process.env`).

### Shim E2E — `app/e2e/helpers/fixtures.ts` (R3.5)

Extender **ambos** injectores (la fixture `page` y `applyEnvShim`) para setear también
`EXPO_PUBLIC_ENV='e2e'` y `window.__RAFAQ_E2E__ = true` en el `addInitScript`. Los ~70 specs no se
tocan (importan `test` de este archivo). El fallback dinámico de `env.ts` (R3.2) sigue captando las 3
vars del shim → el build web E2E arranca igual.

## 3. EAS — `app/eas.json` (R4)

Reescribir los 3 profiles: quitar el bloque `env` inline (hoy con la URL/anon/powersync de DEV en los
3) y reemplazarlo por `environment` (development/preview/production) + `channel` + `APP_VARIANT`. Las
`EXPO_PUBLIC_*`/`EXPO_PUBLIC_ENV` pasan a **EAS Environment Variables** por ambiente (dashboard/CLI),
de modo que **tanto el build como `eas update --environment <env>`** las reciban (R4.4/R4.5).

```jsonc
{
  "cli": { "appVersionSource": "remote" },
  "build": {
    "development": {
      "developmentClient": true, "distribution": "internal",
      "channel": "development", "environment": "development",
      "env": { "APP_VARIANT": "development" },        // solo el discriminador de config, NO secretos
      "android": { "buildType": "apk" }
    },
    "preview": {
      "distribution": "internal", "channel": "preview", "environment": "preview",
      "android": { "buildType": "apk" }               // → backend PROD vía EAS env vars
    },
    "production": {
      "autoIncrement": true, "channel": "production", "environment": "production"
    }
  }
}
```

- Las `EXPO_PUBLIC_*` **ya no viven en el repo** para preview/production (apuntan a PROD): se cargan en
  EAS Environment Variables por ambiente. `development` puede seguir tomando las de DEV (públicas por
  diseño). Detalle del comando `eas env:create` en el runbook.
- **`channel`** depende de la config OTA de Fase 0; si `expo-updates` aún no está, los `channel` son
  inertes hasta que Fase 0 los active (no rompe el build).

## 4. Scripts parametrizados (R5)

> **Reconciliación as-built (Run B, 2026-07-14).** La lógica pura se extrajo a **tres** módulos
> `scripts/lib/*.mjs` (no solo `env-target`), cada uno unit-testeado bajo `node:test` y registrado en
> `run-tests.mjs` (corren siempre, sin keys de Supabase):
> - `scripts/lib/env-target.mjs` — `resolveTarget(argv, env)` + `ProdGuardError` + `parseEnvFlag`/
>   `positionalArgs`/`knownProdRefs` (guarda destino-aware M5/R5.12).
> - `scripts/lib/ledger-plan.mjs` — `sortMigrations`/`planMigrations` (orden por prefijo numérico +
>   diff-contra-ledger + modo `--backfill`; R5.4–R5.6), consumido por `apply-all-migrations.mjs`.
> - `scripts/lib/backup-cmd.mjs` — `buildBackupPlan`/`parseConnString`/`safeSummary` (conn por libpq
>   env vars, output fuera del tree, log seguro; R5.7/R5.8/R5.10/R5.11/R5.13), consumido por `backup-db.mjs`.
>
> **Hardening de `backup-db.mjs` (más estricto que R5.2).** `backup-db` SIEMPRE apunta a PROD (lee
> `SUPABASE_DB_URL_PROD` y exfiltra PII) → exige `RAFAQ_CONFIRM_PROD=1` **siempre** (con o sin `--env`),
> no solo con `--env prod`. Fail-closed alineado a M5 (destino-aware). La Action lo setea; un run local
> exige exportarlo a mano. `apply-all-migrations.mjs` aplica cada migración y registra en el ledger en
> **dos** llamadas Management API separadas (no atómicas): si el apply commitea pero el INSERT falla, el
> re-run re-intenta esa migración (tool de ops supervisado, gateado — aceptado).

Extraer la lógica pura de selección de ambiente + guarda a `scripts/lib/env-target.mjs` (testeable con
`node:test`), consumida por todos los scripts:

```
resolveTarget(argv, env) -> { env: 'dev'|'prod', ref, token, host } | throws
  - sin --env  → 'dev' (R5.1)
  - --env prod → exige RAFAQ_CONFIRM_PROD=1, si no imprime ref y process.exit(2) (R5.2)
  - DESTINO-AWARE (M5, R5.12): si el ref resuelto para 'dev' == SUPABASE_PROJECT_REF_PROD
    (o ∈ una lista de refs de PROD conocidos), tratar como PROD y exigir RAFAQ_CONFIRM_PROD=1 igual.
    Así una env var mal seteada (slot dev apuntando a prod) NO bypassea la guarda.
```

**L4 (R5.13)**: ningún script imprime el header `Authorization` ni el `SUPABASE_ACCESS_TOKEN`. Se
loguea solo el project ref (no secreto) + un slice del body de respuesta, igual que
`apply-migration-mgmt.mjs` hoy. `apply-all-migrations.mjs` **hereda** ese patrón explícitamente.

Convención de env (`.env.local`): sufijo `_PROD` para el ambiente nuevo:
`SUPABASE_PROJECT_REF` / `SUPABASE_PROJECT_REF_PROD`, `SUPABASE_ACCESS_TOKEN` (cuenta, sirve para
ambos), `SUPABASE_DB_URL_PROD` (pooler, para backup), `PS_ADMIN_TOKEN` (cuenta), IDs de instancia
PowerSync por env.

| Script | Cambio | R |
|---|---|---|
| `apply-migration-mgmt.mjs` | `--env {dev,prod}` → elige ref/token; guarda de prod. Default dev = idéntico a hoy. (El plan lo llama `apply-migration.mjs`; se mantiene el nombre real para no romper las ~13 referencias.) | R5.1–R5.3 |
| `apply-all-migrations.mjs` **(nuevo)** | bootstrap del ledger → lista `supabase/migrations/*.sql` ordenada → aplica las **ausentes** del ledger vía Management API (`database/query`) → inserta en `ops.applied_migrations`. Flags: `--env`, `--backfill` (registra sin ejecutar). | R5.4–R5.6, R6.1 |
| `backup-db.mjs` **(nuevo)** | `pg_dump` contra el **pooler** de PROD. **Output por default FUERA del working tree** (H1/R5.10): `os.homedir()/.rafaq-backups/rafaq-prod-<ISO>.sql.gz` (override con `--out-dir`; la Action apunta a un dir del runner). Conn string a `pg_dump` **por env** (`PGPASSWORD`/URI en env, no argv — L2/R5.11). Aborta sin conn string (R5.8). Nunca loguea la conn string. | R5.7, R5.8, R5.10, R5.11 |
| `powersync-deploy.sh` | `--env {dev,prod}` → dev usa `powersync/cli.yaml` (idéntico a hoy); prod exige `RAFAQ_CONFIRM_PROD=1`, swappea el link de instancia por **`powersync/cli.prod.yaml`** (creado en Run F/F5, con `trap EXIT` que restaura + backup a `*.tmp` gitignoreado) y usa `PS_ADMIN_TOKEN_PROD` si está (si no, `PS_ADMIN_TOKEN`, account-level). Default dev. | R5.9 |

### Ledger `ops.applied_migrations` (tool-owned, **no** numerada)

```sql
CREATE SCHEMA IF NOT EXISTS ops;
CREATE TABLE IF NOT EXISTS ops.applied_migrations (
  filename    text PRIMARY KEY,
  applied_at  timestamptz NOT NULL DEFAULT now(),
  checksum    text
);
-- Defensa en profundidad (ops NO se expone por PostgREST igual): revocar de PUBLIC + roles.
REVOKE ALL ON SCHEMA ops FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA ops FROM PUBLIC, anon, authenticated;
```

Es metadata de la herramienta de replay (la crea `apply-all-migrations.mjs` en el bootstrap, **antes**
del loop) → no consume número de migración y existe en ambos ambientes. `ops` no se expone por
PostgREST. En DEV se puebla con `apply-all-migrations.mjs --backfill` (registra 0001–0124 sin
ejecutar, porque DEV ya está al día).

## 5. Migración `0125_health_status.sql` — primer delta `0125+` (R7.2, R6.4)

> **Reconciliación as-built (Run B, 2026-07-14).** El número es **0125**, no 0124: `0124_audit_log.sql`
> (spec 18, DONE) ya ocupaba 0124 al momento de Run B (el "0124+" del spec era un off-by-one — 0124 lo
> tomó spec 18 en el mismo commit que speceó el bloque de ambientes). Se usa el siguiente libre, 0125.
> El contenido SQL es idéntico al de acá abajo.

Único objeto de schema numerado del feature. `SECURITY DEFINER`, defensiva (si el ledger no existe,
devuelve `schema_version:'unknown'` sin romper `ok:true`), `REVOKE` a anon/authenticated.

```sql
CREATE OR REPLACE FUNCTION public.health_status()
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v text;
BEGIN
  BEGIN
    -- L1: solo el prefijo numérico de 4 dígitos, NO el filename completo (evita filtrar nombres de
    -- features/roadmap en un endpoint público). Coincide con el test C4 (^\d{4}$|^unknown$).
    SELECT substring(max(filename) from '^\d{4}') INTO v FROM ops.applied_migrations;
  EXCEPTION WHEN undefined_table OR invalid_schema_name THEN v := NULL; END;
  RETURN json_build_object('ok', true, 'schema_version', coalesce(v, 'unknown'));
END $$;
-- M1: revocar FROM PUBLIC (toda función nace con EXECUTE a PUBLIC; revocar solo anon/authenticated
-- NO alcanza — heredan el grant de PUBLIC). FROM anon, authenticated queda como defensa en profundidad.
REVOKE ALL ON FUNCTION public.health_status() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.health_status() FROM anon, authenticated;
-- Tras revocar PUBLIC, el único caller (la Edge Function `health`, con service_role) necesita EXECUTE
-- explícito — si no, el health rompe. Solo service_role; anon/authenticated NO.
GRANT EXECUTE ON FUNCTION public.health_status() TO service_role;
```

Se aplica a DEV vía `apply-migration-mgmt.mjs --env dev` (normal) — es decir
`apply-migration-mgmt.mjs --env dev supabase/migrations/0125_health_status.sql` — y a PROD dentro del replay. No expone
datos de negocio (R7.5) ni el filename completo de la migración (R7.2/L1). No rompe `check.mjs` (agrega
una función, ningún test asume su ausencia). El `REVOKE ... FROM PUBLIC` de `ops.applied_migrations`
(design §4) es defensa en profundidad (las tablas no traen grant default a PUBLIC).

## 6. Edge Function `health` (R7)

Nueva carpeta `supabase/functions/health/index.ts`. Sin auth de usuario (`verify_jwt=false`): la
invoca UptimeRobot sin JWT. Usa `createAdminClient()` (service_role) → `rpc('health_status')`.

```ts
Deno.serve(async (req) => {
  const pre = handleOptions(req); if (pre) return pre;
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc('health_status');   // SELECT 1 implícito + schema_version
    if (error) return serverError('health_db', error);          // R7.3 (copy genérico, sin driver msg)
    return jsonOk({ ok: true, schema_version: data.schema_version, env: Deno.env.get('RAFAQ_ENV') ?? 'unknown' });
  } catch (err) { return serverError('health_unexpected', err); }
});
```

- **`verify_jwt=false`**: agregar `[functions.health]\nverify_jwt = false` a `supabase/config.toml`
  **y** deployar con `supabase functions deploy health --no-verify-jwt --project-ref <ref>` (R7.4).
- **`RAFAQ_ENV`**: secret por proyecto (`supabase secrets set RAFAQ_ENV=production/development`).
- **Privacidad (R7.5/L1)**: la respuesta es exactamente `{ok, schema_version, env}`, con `schema_version`
  = **prefijo numérico de 4 dígitos** (no el filename). Ningún conteo de filas, ningún nombre de tabla de
  negocio, ninguna PII. Gate 1 valida esta superficie pública.
- **Input-free (M2/R7.9)**: `health` **no** lee body ni params del request. Invariante a proteger: como
  corre con service_role, su code-path debe permanecer libre de input de usuario a futuro.
- **Rate-limit (M2/R7.8)**: Supabase **no** rate-limitea Edge Functions. Postura adoptada:
  **aceptar-y-documentar** — el query es read-only trivial (`SELECT 1` + `max(filename)`), blast radius
  acotado a 1 RPC, y las invocaciones se monitorean vía feature 17. Se documenta en la tabla de rate
  limits del runbook (R7.8/R9.10). Alternativa si crece el abuso: cap por IP en el edge.
- **Test** (Edge suite, contra DEV): (a) `health` responde 200 con `ok:true` y `schema_version`
  matcheando `^\d{4}$|^unknown$`; (b) invocable **sin** Authorization header; (c) no incluye claves
  fuera del set `{ok,schema_version,env}`; (d) `anon` **no** puede ejecutar `POST /rest/v1/rpc/health_status`
  directo (REVOKE FROM PUBLIC, M1/R7.7).

## 7. Backup diario — GitHub Action (R8)

`.github/workflows/backup-prod.yml` en `RafaWASD/Tropero`:

```yaml
on: { schedule: [{ cron: '0 6 * * *' }], workflow_dispatch: {} }   # 06:00 UTC ~ 03:00 AR
jobs:
  backup:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: sudo apt-get update && sudo apt-get install -y postgresql-client
      - run: node scripts/backup-db.mjs --env prod --out-dir "$RUNNER_TEMP"   # H1: fuera del tree
        env: { RAFAQ_CONFIRM_PROD: '1', SUPABASE_DB_URL_PROD: ${{ secrets.SUPABASE_DB_URL_PROD }} }
      # M3: cifrar el dump ANTES de subirlo → artifact inútil sin la passphrase (secret aparte).
      - run: gpg --batch --yes --symmetric --cipher-algo AES256 --passphrase "$BK" "$RUNNER_TEMP"/rafaq-prod-*.sql.gz
        env: { BK: ${{ secrets.BACKUP_GPG_PASSPHRASE }} }
      - uses: actions/upload-artifact@v4
        with: { name: rafaq-prod-backup, path: ${{ runner.temp }}/*.sql.gz.gpg, retention-days: 90 }
```

- La conn string **solo** como secret `SUPABASE_DB_URL_PROD` (R8.2). `backup-db.mjs` la lee de env y
  nunca la imprime; se la pasa a `pg_dump` por env, no por argv (L2/R5.11). `fail-fast` del step ⇒
  Action roja si `pg_dump` falla (R8.5).
- **Cifrado en reposo (M3/R8.6)**: el `.sql.gz` se cifra con `gpg --symmetric AES256` (passphrase en el
  secret `BACKUP_GPG_PASSPHRASE`, distinto del secret de la conn string) → el artifact subido es
  `*.sql.gz.gpg`, inútil sin la passphrase. Runbook (R8.7/R9.10): el repo `RafaWASD/Tropero` debe ser
  **privado**; acceso a Actions/artifacts = acceso efectivo a la PII de PROD.
- **H1/R5.10**: el output nunca cae en el working tree (`--out-dir "$RUNNER_TEMP"` en CI; `~/.rafaq-backups`
  local). Además `backups/` va a `.gitignore` como red de contención (design §Archivos, task B7).
- **L6**: `RAFAQ_CONFIRM_PROD=1` se setea **solo** en esta Action (que corre `backup-db.mjs`, read-only).
  Invariante: nunca setear ese env a nivel workflow en un job que también corra scripts de escritura.
- **Restore drill (R8.4)**: una vez, descifrar (`gpg --decrypt`) + restaurar el `.gz` en un Postgres
  local (`gunzip | psql`) y verificar tablas clave; documentar comando + resultado en el runbook.
  `pg_dump`/`psql` locales pueden no estar en la máquina de Raf → el drill puede correrse en un runner o
  entorno con postgres-client; documentar la vía usada.

## 8. Ops livianas — `docs/runbook.md` + UptimeRobot (R9)

`docs/runbook.md` (1 página) con las secciones exactas de R9.1–R9.7 y R9.9. UptimeRobot (R9.8):
3 monitores (health PROD, health DEV, endpoint sync PowerSync PROD) @5min + alerta email; el ping
además evita la pausa por inactividad del free tier. La creación de los monitores es operativa (cuenta
de Raf); el runbook documenta URLs + config.

## Bring-up de PROD (R1.2, R6) — orden operativo

1. Raf: crear proyecto Supabase PROD (misma región) → refs a `.env.local` (`_PROD`).
2. `apply-all-migrations.mjs --env local` (ensayo, R6.2) → luego `--env prod` (replay, R6.1).
3. Checklist manual R6.6:
   - Auth (SMTP/Resend, templates es-AR, Site URL/redirects) **+ M4/R6.6b**: verificar/ajustar
     `[auth.rate_limit]` del dashboard de PROD (email/SMS/sign-in/token verifications), decidir captcha
     en signup, decidir `enable_confirmations` (email verification) — firmar la decisión en el runbook
     aunque sea "aceptar defaults" (PROD es el único ambiente internet-facing con signup público).
   - `supabase secrets set --project-ref <prod>` (incl. `RAFAQ_ENV=production`).
   - PowerSync: rol de replicación + `CREATE PUBLICATION powersync FOR TABLES IN SCHEMA public;` (R6.7,
     PG15+; **no** `FOR ALL TABLES`) → **asertar** `puballtables=false` y set ⊆ DEV vía query a
     `pg_publication`/`pg_publication_tables` (R6.7b, paso firmado, no solo el ojo en el diff).
4. Deploy de las **8** Edge Functions + `health` a PROD (`supabase functions deploy <fn> --project-ref
   <prod>`; `health` con `--no-verify-jwt`).
5. Provisionar PowerSync "Production" (conexión a DB PROD, `client_auth.supabase:true`) →
   `powersync-deploy.sh --env prod` con `sync-streams/rafaq.yaml` **sin tocar**.
6. `pg_dump --schema-only` DEV vs PROD → diff (R6.3); cada delta → `0124+` (R6.4).
7. EAS Environment Variables preview/production → PROD (R4.4).
8. GitHub secret + primer backup + restore drill (R8).
9. UptimeRobot (R9.8) + tenant "Campo de prueba RAFAQ" (R9.9).
10. Smoke manual (R6.8).

---

## Archivos a crear / modificar

**Crear**: `app/app.config.ts` · `app/src/utils/app-env.ts` (+ `.test.ts`) ·
`scripts/apply-all-migrations.mjs` · `scripts/backup-db.mjs` · `scripts/lib/env-target.mjs`
(+ `.test.mjs`) · `scripts/lib/ledger-plan.mjs` (+ `.test.mjs`) · `scripts/lib/backup-cmd.mjs`
(+ `.test.mjs`) · `supabase/migrations/0125_health_status.sql` (as-built; era `0124`, ver §5) ·
`supabase/functions/health/index.ts` · `.github/workflows/backup-prod.yml` · `docs/runbook.md` ·
(Run F) `powersync/cli.prod.yaml`.

**Modificar**: `app/app.json` (→ borrar tras migrar a `app.config.ts`) · `app/eas.json` ·
`app/src/utils/env.ts` · `app/src/utils/env-resolve.ts` (+ `.test.ts`, agregar `composeReader`) ·
`app/e2e/helpers/fixtures.ts` · `scripts/apply-migration-mgmt.mjs` · `scripts/powersync-deploy.sh` ·
`supabase/config.toml` (`[functions.health] verify_jwt=false`) · `scripts/run-tests.mjs` (registrar
las nuevas unit tests + el hook de la Edge suite `health`) · `.env.example` (docs de las vars `_PROD`,
solo placeholders — L5) · `powersync/README.md` (estado de la instancia Production) ·
**`.gitignore`** (H1/R5.10: agregar `backups/` — red de contención aunque el output default vaya fuera
del working tree).

## Alternativas descartadas

1. **Estado de PROD por dump de schema** (en vez de replay ordenado): descartada. Un dump copia el
   estado pero **no valida reproducibilidad** de las migraciones; si una migración no es replayable, se
   descubre en el próximo bootstrap (o nunca). El replay + diff DEV/PROD es el oráculo de que las ~123
   migraciones **son** la fuente canónica (D3). Costo: hay que ensayar el replay antes; se acepta.
2. **Un 3er backend "homo"**: descartado (context.md D1). En mobile el riesgo vive en el binario, no en
   el server; un staging sintético no reproduce nada y duplica mantenimiento para un solo dev. "Homo" =
   canal `preview`→PROD + staged rollout. Free tier = exactamente 2 proyectos.
3. **Ledger como migración numerada** (`0000_ops_ledger.sql`): descartado. La herramienta de replay
   necesita el ledger **antes** de registrar la migración #1 en un PROD fresco (chicken/egg). Tool-owned
   bootstrap (`IF NOT EXISTS` en `apply-all-migrations.mjs`) lo resuelve sin ensuciar el set numerado.
4. **`health` lee `ops.applied_migrations` exponiendo el schema `ops` por PostgREST**: descartado
   (filtraría metadata de ops a cualquier request). Se usa un RPC `SECURITY DEFINER` en `public`
   (`health_status()`) invocado solo por la Edge Function con service_role.
5. **Reusar `apply-migration-mgmt.mjs` para el replay completo (loop externo en bash)**: descartado en
   favor de `apply-all-migrations.mjs` dedicado, porque el ledger + la idempotencia (catch-up por
   release) + el `--backfill` de DEV necesitan estado que un loop de shell no maneja limpio.

## Verificación (mapa)

- **Automatizable** (entra a `check.mjs` / E2E): R3.1–R3.4/R3.6/R3.7 (unit `env-resolve`/`app-env`);
  R5.1/R5.2/R5.12 (unit `env-target`, incl. destino-aware); R5.4/R5.5/R5.6 (unit de la lógica de
  ledger/orden, pura); R5.8/R5.11 (unit `backup-db` sin conn string + no argv); R7.1–R7.5/R7.7 (Edge
  suite `health` contra DEV, incl. anon no puede `rpc/health_status`); R1.3/R3.5 (E2E completa verde sin
  tocar specs); R5.10 (assert `git check-ignore backups/x.sql.gz`).
- **Operativa documentada** (checklist firmado en runbook + artefacto committeado): R1.1/R1.2/R1.4,
  R2.4, R4.1–R4.5 (assert de `eas.json`/EAS env), R6.1–R6.8/R6.6b/R6.7/R6.7b, R8.1/R8.3/R8.4/R8.6/R8.7,
  R7.8, R9.1–R9.10.
