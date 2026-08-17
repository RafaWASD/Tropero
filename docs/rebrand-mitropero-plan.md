# Rebrand RAFAQ → miTropero — plan de ejecución (handoff para otra sesión)

> ## Estado de ejecución
>
> | Fase | Estado |
> |---|---|
> | 1 — Prosa (docs/specs/CONTEXT/.github) | ✅ **HECHA** (2026-08-16). 66 archivos, 139 ocurrencias. 308 protegidas por ser plomería. |
> | 2 — Infra de E2E (globals + fixtures) | ⏳ pendiente |
> | 3 — PowerSync (`rafaq.yaml`) | ⏳ pendiente — **pregunta 5 resuelta, ver abajo** |
> | 4 — GUCs de Postgres | ⏳ pendiente — Gate 1 |
> | 5 — Headers HTTP | ⏳ pendiente — Gate 1. **Además es lo que hoy tiene el árbol en rojo** |
> | 6 — Identidad Expo | 🔴 bloqueada por decisiones de Raf (§6.2) |
> | Assets (logo) | 🔴 bloqueada: falta el logo real |
>
> ### ⚠️ Corrección al §1: el baseline que este plan da por bueno NO existe
>
> El plan dice `check.mjs` → RC=0. **Medido el 2026-08-16: el árbol está ROJO**, con un solo fallo:
> el guard de marca (regla A) caza `'X-Rafaq-Request-Id'` en `app/src/services/{account,members,
> push-notifications}.ts`. Es la spec 23, que entró deployada y dejó el guard en rojo.
>
> **Baseline real, y el juez de las fases que siguen: `3115 pass / 1 fail`, ese fallo y sólo ese.**
> Cualquier fallo nuevo es de la fase en curso. Lo cierra la fase 5 (no hace falta tocar el guard).
>
> ### Pregunta 5 resuelta: los nombres de streams NO llevan "rafaq"
>
> Verificado sobre `sync-streams/rafaq.yaml`: las streams se llaman `catalog_species`,
> `self_user_private`, `est_establishments`, etc. La única mención al nombre viejo adentro del archivo
> es **el comentario de la línea 1**. O sea: la fase 3 es renombrar el archivo y sus referencias, y
> **no fuerza re-sync de los devices** — que era el riesgo que la pregunta buscaba descartar.
>
> ### Preguntas 1 y 3 resueltas por defecto (eran decisiones menores, no de Raf)
>
> - **Casing**: `mitropero` en identificadores, `miTropero` sólo en texto de marca. Es la propia
>   recomendación del plan y la convención que ya usa el repo.
> - **`progress/`**: se DEJA como historial. 323 archivos que son logs de sesión; el nombre viejo ahí
>   es historia fiel, igual que los mensajes de commit.
>
> ### Lo que la fase 1 protegió (y por qué el `sed` del §4.A habría roto la doc)
>
> El script enumeraba los GUCs a mano y se comió `rafaq.actor_id`, que no estaba en la lista:
> reescribió la spec 18 para que nombrara un GUC **que el trigger deployado no lee**. Se rehizo
> protegiendo **por forma** (`rafaq\.[a-z_]+`, `x-rafaq-*`, `__rafaq*`, `RAFAQ_*`, `rafaq-*`), con una
> invariante que compara protegidos-antes contra protegidos-después y **no escribe el archivo si no
> coinciden**. Es el mismo principio que el resto de los guards del repo: se escribe sobre la ausencia,
> así lo que aparezca mañana también queda cubierto.
>
> ---
>
> **Estado original:** DECIDIDO por Raf (2026-08-15), NO ejecutado. Se difirió a su propia sesión porque "rafaq"
> interno **no es texto: es plomería de runtime interconectada** (GUCs de DB, identidad Expo, config de
> PowerSync, globals de E2E, headers deployados). Un `sed` global rompe el beta.
>
> **Objetivo del doc:** que otra sesión pueda ejecutar el rebrand completo sin adivinar. Leer entero antes
> de tocar nada. Ver también la memoria [[project_rebrand_mitropero]] y [[project_rebrand_bloquea_invitaciones]].

## 0. Contexto

- La app/producto ahora es **miTropero** (antes RAFAQ). La capa **user-facing YA está rebrandeada** (dominio
  `mitropero.com.ar`, `app/src/utils/brand-name-guard.test.ts`, links de invitación; ~49 archivos con
  "mitropero"). El **Sentry org ya es `mitropero`** (`specs/active/17-observabilidad/external-setup.md`).
- Lo **interno sigue RAFAQ**: ~607 archivos tracked con "rafaq" (conteo de líneas: **1201 `RAFAQ`** mayús +
  **98 `Rafaq`** title + **713 `rafaq`** minús).
- Raf decidió el rename **COMPLETO, incluido lo interno**.

## 1. Baseline de verificación (NO romper esto)

Antes y después de cada fase, confirmar contra el baseline actual (2026-08-15):
- `node scripts/check.mjs` → **RC=0** (typecheck + unit + RLS/Edge/animal/maneuvers/import/sync_streams/…).
- `pnpm -C app run e2e` → **306 passed / 1 skipped**; 2 flakes conocidos de cría/register_birth
  (`animals.spec.ts:1311`, `cria-al-pie-bastoneo.spec.ts:87`) que pasan en re-run (NO son regresión).
- `pnpm -C app typecheck` → 0 errores.
- `app/src/utils/brand-name-guard.test.ts` verde (guarda las 4 puntas del link de marca).

## 2. Convenciones de mapeo (case-aware)

| Origen | Destino | Contexto |
|---|---|---|
| `RAFAQ` | `miTropero` | prosa / marca / texto user-facing |
| `Rafaq` | `MiTropero` | Title-case en prosa/tipos |
| `rafaq` | `mitropero` | identificadores lowercase, slugs, dominios de test |
| `RAFAQ_*` (env/secret) | `MITROPERO_*` | SCREAMING_SNAKE |
| `X-Rafaq-*` (header) | `X-Mitropero-*` | wire headers |
| GUC `rafaq.x` | `mitropero.x` | Postgres session config vars |
| `__rafaq*` (globals JS) | `__mitropero*` | test/e2e globals |

> Ojo con **camelCase interno de la marca**: la marca es `miTropero` (m minúscula, T mayúscula). Para
> identificadores de código conviene `mitropero` (todo minúscula) para evitar problemas de case-sensitivity /
> convención. Decidir por-categoría, no forzar `miTropero` en un identificador.

## 3. EXCLUIR del rename (renombrar esto ROMPE cosas — NO tocar)

- **Paths del filesystem**: `C:\DEV\RAFAQ\...`, `/c/DEV/RAFAQ/...`, `RAFAQ/app-ganado` — la carpeta real se
  llama `RAFAQ`. Mover la carpeta es una op de filesystem aparte (63 líneas `DEV[\\/]RAFAQ` en el repo).
- **GitHub**: repo `RafaWASD/Tropero`, user `RafaWASD` (no contiene "rafaq" pero no tocar de todos modos).
- **Dir de memoria de Claude**: `C--DEV-RAFAQ-app-ganado` (fuera del repo).
- **Historia de git**: commits inmutables; los mensajes viejos quedan como están.
- **`progress/` (319 de los 607 archivos)** — **RECOMENDACIÓN: DEJAR como historial.** Son logs de sesión;
  "rafaq" ahí es historia fiel (como los commits). Renombrarlos es 50% del esfuerzo por ~0 valor y ensucia el
  registro. Si Raf insiste, hacer un pase de texto al final, aparte.

## 4. Categorías de "rafaq" (cada una = riesgo + trabajo distinto)

### A. Prosa / docs / specs / CONTEXT / memoria — 🟢 BAJO riesgo
- Archivos: `docs/` (26), `specs/` (79), `CONTEXT/` (2), `.github/` (1), memoria (fuera del repo).
- Trabajo: swap de texto `RAFAQ`→`miTropero` con la exclusión de paths (§3). Reemplazo seguro:
  `perl -i -pe 's/(?<!DEV[\/\\])RAFAQ/miTropero/g; s/(?<![\/\\.-])Rafaq/MiTropero/g'` — **pero validar el
  lookbehind archivo por archivo** (hay paths y filenames embebidos). NO tocar `rafaq.yaml`, `x-rafaq-*`,
  `rafaq.is_*` literales que aparezcan citados en docs de specs técnicas (son referencias a runtime real —
  se renombran cuando se renombra el runtime, en las fases D/E/F, para no desincronizar la doc del código).
- Verificar: `brand-name-guard` verde, `git diff` sin paths corruptos.

### B. Identidad Expo / EAS — 🔴 ALTO riesgo / EXTERNO
- `app/app.config.ts`: `slug: 'rafaq-app'`, `owner: 'rafaqsorg'`, `scheme: 'rafq'`. `app.config.test.ts:62-78`
  asserta esos valores. **`app.config.ts:8` YA dice que cambiarlos "es fase 2 y depende de trabajo en …".**
- Qué significan y por qué es peligroso:
  - `owner: 'rafaqsorg'` = la **cuenta/org de Expo dueña del proyecto**. Cambiarlo = re-homear el proyecto a
    otra org de Expo (o renombrar la org en el dashboard de Expo) → afecta EAS builds, credenciales, OTA
    updates. NO es un rename de texto: es trabajo en el dashboard de Expo + posible re-linkeo del proyecto.
  - `slug: 'rafaq-app'` = identidad del proyecto Expo (URL/linkage de EAS). Cambiarlo puede desvincular builds/updates.
  - `scheme: 'rafq'` = el **URL scheme de deep-link** (`rafq://`). Cambiarlo **rompe deep-links / links de
    invitación** que usen el scheme hasta que la app nueva esté en las tiendas.
- Trabajo: coordinar con Expo (dashboard), decidir org-rename vs nuevo proyecto, actualizar `app.config.ts` +
  `app.config.test.ts`, y validar deep-links. **Candidato a su propia mini-feature.** Verificar EAS builds
  (con OK de Raf, recurso agotable — ver [[feedback_builds_eas_ok_explicito]]).

### C. GUCs de Postgres (`rafaq.is_transfer`, `rafaq.is_auto_transition`) — 🔴 ALTO riesgo / DEPLOYADO
- Son **session config vars** que usan triggers de DB deployados para early-return:
  - `rafaq.is_auto_transition` → migración **0031** (auto-transición de categoría; el cliente setea
    `set_config('rafaq.is_auto_transition','on',true)` para distinguir auto vs override manual).
  - `rafaq.is_transfer` → migración **0088** (early-return del trigger de inmutabilidad de `animal_events`
    en el re-parenting de `transfer_animal`; también en **0127**).
- Renombrar = migración(es) nueva(s) que re-CREAN esos triggers/funciones con el GUC nuevo (`mitropero.is_*`)
  + cambiar TODOS los `set_config`/`current_setting` en el cliente y en RPCs, **en sync**. Si el código setea
  `mitropero.is_transfer` pero el trigger lee `rafaq.is_transfer`, el guard deja de funcionar (el
  re-parenting rebota / el override se marca mal). Deploy coordinado + re-correr suites transfer_animal +
  animal + el flujo de categorías. Moldear sobre el cuerpo VIGENTE (ver [[reference_function_recreate_base]]).

### D. Headers HTTP deployados (`X-Rafaq-Request-Id`, `X-Rafaq-Actor`) — 🔴 ALTO riesgo / DEPLOYADO
- Spec 18 (audit, `X-Rafaq-Actor`) + spec 23 (`X-Rafaq-Request-Id`), **deployados hoy 2026-08-15**.
- Los leen `audit.resolve_actor()` / `audit.resolve_request_id()` del GUC `request.headers->>'x-rafaq-actor'`
  / `'x-rafaq-request-id'` (migraciones 0124 + 0131). Los setean: cliente
  (`app/src/services/{members,account,push-notifications}.ts`, `invitar.tsx`) y las Edge Functions
  (`_shared/serve.ts`, `_shared/supabase.ts` `createAdminClient`, las 9 EFs) + `_shared/cors.ts`
  (Allow-Headers). Tests: `supabase/tests/audit/run.cjs`, `serve-log.test.ts`.
- Renombrar = migración nueva (re-CREATE de `resolve_actor`/`resolve_request_id` leyendo `x-mitropero-*`) +
  cambiar el header en cliente + `serveEf` + `createAdminClient` + `cors.ts` (Allow-Headers) + tests +
  **re-deploy de las 9 funciones** + re-verificación (E2E 306 + landing en `audit.record_version`).
- **Deploy-ordering** (mismo tipo de skew que el CORS de spec 23): cliente y server NO pueden divergir en el
  nombre del header. Backend (migración + funciones) junto o antes del OTA del frontend. En web el skew
  rompe (CORS del header nuevo); en nativo no hay CORS pero la correlación se corta si divergen.
- Deploy: usar `scripts/deploy-23-dev.sh` como molde; auth de Supabase en `.env.local` (ver
  [[reference_supabase_deploy_from_session]]).

### E. Config de PowerSync (`sync-streams/rafaq.yaml`) — 🟠 MEDIO-ALTO / runtime de sync
- El archivo `sync-streams/rafaq.yaml` (fuente única de las sync streams, ver `powersync/README.md`) +
  referencias en `app/src/services/powersync/{local-reads,schema}.ts`, `.gitignore`, `scripts/powersync-deploy.sh`
  (memoria [[project_powersync_cli_deploys]]), `feature_list.json`, `docs/*`.
- Renombrar el archivo + todas las refs + **re-deploy de PowerSync** (`bash scripts/powersync-deploy.sh`).
  OJO si los **nombres de las streams** adentro del YAML contienen "rafaq" (revisar) — cambiarlos puede forzar
  re-sync de los devices. Verificar la suite `sync_streams` de `check.mjs`.

### F. Infra de globals de E2E (`window.__rafaqble`, `__rafaq_ble_e2e__`, …) — 🟠 MEDIO / interconectado
- ~300+ líneas: `__rafaqble` (78), `__rafaq_ble_e2e__` (59), `__rafaq_ble_e2e_manual__`, `__rafaq_ble_demo__`,
  `__rafaq_maneuver_fault__`, `__rafaq_sync_reject_e2e__`, etc. Son **globals de window** que la app DEFINE y
  los specs E2E USAN (hooks de test/demo BLE, inyección de fault, inyección de rechazo de sync).
- Renombrar la DEFINICIÓN y TODOS los usos **en sync**, o el E2E (306 verde) se cae. Contenido a app + e2e,
  pero muy entrelazado. Grep de arranque: `git grep -l '__rafaq' -- app/`. Verificar con `pnpm -C app run e2e`.

### G. Fixtures de test (`rafaq-test.local`, `rafaq-e2e.test`) — 🟡 BAJO-MEDIO
- Dominios/emails de los fixtures E2E (ej. `e2e_..._@rafaq-e2e.test`). Renombrar en los helpers/fixtures de
  `app/e2e/`. Si hay allowlist de dominios en algún lado, actualizarla. Verificar E2E.

### H. Directorio de backups (`~/.rafaq-backups`) — 🟡 BAJO
- Default de `scripts/backup-db.mjs` (`~/.rafaq-backups/rafaq-prod-<ISO>.sql.gz`) + comentario en `.gitignore`
  + `.github/workflows/backup-prod.yml` (usa `$RUNNER_TEMP` en CI). Renombrar el default; **los backups
  existentes en `~/.rafaq-backups/` quedan donde están** (no migrar, es local). Verificar el test de backup.

### I. Assets de diseño (logos) — 🟡 BAJO / diseño
- `design/stitch-iter-1/07-inicio-rafaq.png`, `09-rafaq-logo.png`, `design/stitch-iter-2/09b-rafaq-logo-v2.png`
  (~15 archivos design con "rafaq"). Son el **logo RAFAQ** — necesitan el **logo miTropero** real (¿existe?).
  Renombrar los PNG es cosmético; el asset visual del logo es trabajo de diseño aparte.

## 5. Plan de ejecución por fases (con verificación entre cada una)

Orden recomendado (de menor a mayor riesgo; runtime al final, coordinado):

1. **Fase 1 — Prosa** (Cat. A): docs/specs/CONTEXT/memoria. Script con exclusión de paths, revisar `git diff`.
   `progress/` se DEJA (historial). Verif: `brand-name-guard` + `check.mjs`.
2. **Fase 2 — E2E infra** (Cat. F + G): globals + fixtures, en sync. Verif: `pnpm -C app run e2e` = 306.
3. **Fase 3 — PowerSync** (Cat. E): `rafaq.yaml` + refs + `powersync-deploy.sh`. Verif: suite `sync_streams` +
   E2E. (Gate 1 si toca reglas de sync.)
4. **Fase 4 — GUCs de DB** (Cat. C): migración(es) `mitropero.is_*` + `set_config`/`current_setting` en sync.
   Deploy coordinado (Management API). Verif: suites transfer_animal + animal + categorías. Gate 1 (toca
   triggers deployados).
5. **Fase 5 — Headers** (Cat. D): migración `resolve_actor`/`resolve_request_id` con `x-mitropero-*` + cliente
   + `serveEf`/`createAdminClient`/`cors.ts` + tests + re-deploy 9 funciones + re-verif E2E + landing audit.
   Deploy-ordering. Gate 1 obligatorio.
6. **Fase 6 — Identidad Expo** (Cat. B): `slug`/`owner`/`scheme` + `app.config.test.ts` + dashboard de Expo +
   deep-links. La más externa/riesgosa. Su propia mini-feature; OK explícito de Raf para EAS builds.
7. **(Opcional) Assets** (Cat. I): logo miTropero real + rename de PNGs. Diseño.

Cada fase: `git diff --stat` + typecheck + tests relevantes + commit acotado por fase (reconciliar specs).
Ninguna fase deja el árbol rojo. El baseline (§1) es el juez.

## 6. Preguntas abiertas para Raf (resolver antes de ejecutar)

1. **Casing de identificadores**: ¿`mitropero` (todo minúscula) para código/GUC/globals/slug, o forzar
   `miTropero`? (recomendado: `mitropero` en identificadores, `miTropero` solo en texto de marca.)
2. **Expo (Cat. B)**: ¿renombrar la org `rafaqsorg` en el dashboard de Expo, o crear proyecto nuevo? ¿Cambiar
   el scheme `rafq://` ahora (rompe deep-links viejos) o esperar a estar en tiendas?
3. **`progress/`**: ¿se dejan como historial (recomendado) o se renombran también?
4. **Logo miTropero**: ¿existe el asset visual, o hay que diseñarlo (Cat. I)?
5. **Nombres de streams** dentro de `rafaq.yaml`: ¿contienen "rafaq"? (revisar; afecta re-sync de devices.)

## 7. Cómo re-derivar el reconocimiento (comandos)

```bash
# Conteo por variante de caso:
for v in RAFAQ Rafaq rafaq; do echo "$v: $(git grep -c "$v" -- . | awk -F: '{s+=$NF} END{print s+0}')"; done
# Paths a excluir:            git grep -iE 'DEV[\\/]+RAFAQ' -- .
# Filenames con rafaq:        git ls-files | grep -i rafaq
# Identificadores de código:  git grep -hoiE '[a-z0-9_.-]*rafaq[a-z0-9_.-]*' -- app supabase sync-streams scripts | sort | uniq -c | sort -rn
# GUCs:                       git grep -n 'rafaq\.is_' -- supabase app
# Headers:                    git grep -l 'X-Rafaq\|x-rafaq' -- supabase app
# Globals E2E:                git grep -l '__rafaq' -- app
# Distribución por área:      for a in app/src app/app supabase docs specs scripts sync-streams progress design; do echo "$a: $(git grep -il rafaq -- "$a/**" | wc -l)"; done
```

## 8. Resumen ejecutivo (1 párrafo)

El rebrand a miTropero está hecho en lo user-facing; falta lo interno (~607 archivos, 319 de ellos `progress/`
que conviene dejar como historial). Lo peligroso NO es el texto (docs, fase 1) sino **5 nudos de runtime**:
identidad Expo (owner/slug/scheme), GUCs de Postgres (`rafaq.is_*` en triggers deployados), headers
deployados (`X-Rafaq-*`), config de PowerSync (`rafaq.yaml`) e infra de globals de E2E. Cada nudo necesita el
mismo cuidado que la feature 23 de hoy (migración/deploy coordinado + re-verificación E2E), no un `sed`.
Ejecutar en 6 fases de menor a mayor riesgo, con el baseline (`check.mjs` RC=0 + E2E 306) como juez entre cada
una. Empezar por docs (seguro), terminar por Expo (externo). Preguntas abiertas en §6.
