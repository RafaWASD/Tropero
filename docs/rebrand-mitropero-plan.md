# Rebrand RAFAQ → miTropero — plan de ejecución (handoff para otra sesión)

> ## Estado de ejecución
>
> | Fase | Estado |
> |---|---|
> | 1 — Prosa (docs/specs/CONTEXT/.github) | ✅ **HECHA** (2026-08-16). 66 archivos, 139 ocurrencias. 308 protegidas por ser plomería. |
> | 2 — Infra de E2E (globals + fixtures) | ✅ **HECHA** (2026-08-16, `c055e6e`). 96 archivos, 11 globals de window + fixtures. La fila decía `⏳ pendiente` por descuido de esa fase; corregida acá. |
> | 3 — PowerSync (`rafaq.yaml` → `mitropero.yaml`) | ✅ **HECHA** (2026-08-16). 57 archivos: 145 ocurrencias del literal en 55, más 2 docs editados a criterio. **Sin deploy**: el nombre del archivo fuente es local (el script lo copia a `sync-config.yaml`, que es lo único que ve la instancia). Ver `progress/rebrand-fase3-powersync.md`. |
> | 4 — GUCs de Postgres | ✅ **HECHA** (2026-08-17). Migración `0132` aplicada a **DEV** (autorización de Raf en sesión; PROD no se tocó): `CREATE OR REPLACE` de las 6 funciones que nombran una GUC, en **una sola transacción**. 9 archivos de spec/doc reconciliados. **Falsificada** (ver abajo). Detalle: `progress/rebrand-fase4-gucs.md`. |
> | 5 — Headers HTTP | ✅ **HECHA** (2026-08-17). **Rename en DOS TIEMPOS, no corte seco**: migración `0133` a **DEV** + las 10 Edge Functions redeployadas (autorización de Raf en sesión; PROD no se tocó). El servidor **lee los dos** nombres (`x-mitropero-*` y, si no está, `x-rafaq-*`); cliente y EFs **escriben sólo el nuevo**. La limpieza del fallback es una fase aparte, anotada en `docs/backlog.md` con la condición que la habilita. **Devuelve el árbol a verde** (era el fallo único del baseline). Detalle: `progress/rebrand-fase5-headers.md`. |
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
> ### ⚠️ El guard de marca (regla B) le dispara al nombre NUEVO en identificadores — lo van a pisar las fases 5 y 6
>
> Lo descubrió la **fase 2** al renombrar los globals: `brand-name-guard.test.ts` tenía el concepto de
> "flag global interno" (`INTERNAL_FLAG_PREFIX = '__'`) pero **sólo lo aplicaba a la regla A** (nombre
> VIEJO). Tenía sentido mientras todos los identificadores internos llevaran "rafaq". Al pasarlos a
> `mitropero`, cayeron bajo la **regla B** ("el nombre nuevo se escribe SIEMPRE `miTropero`") — que los
> reportó como grafía equivocada del wordmark siendo que **no son wordmark**. 10 líneas en rojo.
>
> **Cerrado en fase 2**: el carve-out `__` se extendió a la regla B (misma constante, mismo predicado),
> con 3 mutantes que lo falsifican y contrapruebas de que `mitropero` en TEXTO sigue prohibido.
>
> **Lo que viene, y conviene tenerlo presente ANTES de empezar cada fase** (la regla B mira
> `app/app` + `app/src`, con carve-out sólo para DOMINIO —punto + letra— y flag `__` pegado):
>
> | Fase | Identificador nuevo | ¿Dispara la regla B? |
> |---|---|---|
> | 5 — headers | `'X-Mitropero-Request-Id'` — hoy en UN solo lugar, `app/src/utils/request-id.ts` (la constante compartida que consumen los tres call-sites) | **SÍ** (`Mitropero` precedido de `-`, no de `__`) → **RESUELTO con VÁLVULA por línea**, no con carve-out: con una sola definición la población es de UNO, y un carve-out de forma ("precedido de `-`" / "empieza con `X-`") eximiría también texto de UI con esa forma. Justificación completa en `progress/rebrand-fase5-headers.md` §5; falsificado con un mutante (sacar la válvula ⇒ regla B roja). |
> | 4 — GUCs | ~~`set_config('mitropero.is_transfer', …)` en el cliente~~ **no existe** | **No, y no por accidente**: la fase 4 (hecha el 17/08) confirmó que el cliente **no setea ninguna GUC** — el identificador nuevo no aparece en `app/app` ni en `app/src`, así que la regla B ni lo mira. La preocupación del carve-out de DOMINIO era sobre una línea de cliente que nunca existió. |
> | 6 — Expo | `slug: 'mitropero-app'`, `owner`, `scheme` en `app.config.ts` | **SÍ** (`-a` después, no es dominio ni `__`) |
>
> No hace falta resolverlo ahora: hace falta **no descubrirlo con la fase a medio hacer**.

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

> ## ✅ HECHA (2026-08-17, migración `0132`, DEV). Y este apartado estaba equivocado en lo principal.
>
> **Lo que decía y era falso:** *"cambiar TODOS los `set_config`/`current_setting` en el cliente y en RPCs,
> en sync"* y *"Deploy coordinado"*. Medido:
> `git grep -nE "set_config|current_setting" -- app supabase/functions` → **cero**. Ni el cliente ni las
> Edge Functions tocan estas GUCs: viven **enteramente dentro de Postgres**. **No hay skew posible** →
> una sola migración atómica, no un deploy coordinado. El riesgo real era 🟠, no 🔴.
>
> **Lo que decía y era cierto, y sí mordió:** moldear sobre el cuerpo **vigente en el remoto**. Mordió
> **tres veces**: `transfer_animal` vigente es la de `0122` (no `0087`),
> `tg_animal_profiles_set_override_on_manual` es la de `0040` (no `0021`), y hay un sexto lector que este
> apartado ni menciona, `tg_animal_profiles_record_rodeo_change` (`0127`). Copiar de las migraciones que
> este plan cita habría revertido `0122` y `0040` en silencio.
>
> **Además, el inventario se sacó del CATÁLOGO, no del grep:** `pg_proc` + `pg_db_role_setting` + vistas +
> constraints + policies + `WHEN` de triggers + defaults de columna + índices. Todo lo no-función dio
> vacío. Son 6 funciones y nada más.
>
> **Falsificación (lo que hace que esto no sea un "confío en que anda"):** con la migración aplicada, se
> revirtieron **sólo los 4 lectores** al nombre viejo dejando los 2 setters en el nuevo — el escenario
> exacto de desalineación — y la suite `animal` pasó de **139/139 a 122 pass / 17 fail**, en dos clusters
> limpios: 6 tests por `is_auto_transition` (*"transición auto no marca override"*, `actual: true`) y 9 +
> 2 nodos padre por `is_transfer` (`23514 immutable column changed on animal_event …`). Después se
> restauró y volvió a 139/139. O sea: el guard **sí** está cubierto por tests.
>
> Detalle completo, baseline literal y hallazgos: `progress/rebrand-fase4-gucs.md`.

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

> ## ✅ HECHA (2026-08-17, migración `0133` + redeploy de las 10 EFs, DEV). Y el "deploy-ordering" de abajo no alcanzaba.
>
> **Lo que decía y era insuficiente:** *"Backend (migración + funciones) junto o antes del OTA del frontend."*
> **No hay OTA.** `app/app.config.ts` no tiene bloque `updates` (expo-updates es Fase 0, pendiente). La
> única forma de que un cliente instalado cambie de header es que un tester instale una build nueva a mano,
> y eso puede no pasar nunca — o sea que **ningún orden de deploy** resuelve el skew: con corte seco, el
> TestFlight y el APK que ya están afuera quedarían escribiendo el nombre viejo por tiempo indefinido y
> todo lo que hicieran entraría al audit con `request_id` **NULL**. No rompe nada visible: la correlación
> se pierde **en silencio**, el peor modo de falla para una feature de auditoría.
>
> **Lo que se hizo en su lugar — rename en DOS TIEMPOS**: (1) servidor **tolerante**, lee el nombre nuevo y
> si no está el viejo (`0133` re-CREA los dos resolvers; `_shared/request-headers.ts` es la única
> definición del lado TS y `cors.ts` **deriva** su Allow-Headers de ahí, así el skew de CORS es imposible
> por construcción); (2) cliente y admin client escriben **sólo el nuevo**; (3) limpieza del fallback en una
> fase aparte, anotada en `docs/backlog.md` con su condición. Los dos invariantes de los resolvers quedan
> intactos y verificados: **TOTAL** (nunca lanzan → no pueden abortar el write del operario) y
> **SPOOF-SAFE** (el header sólo se lee dentro del gate `request.jwt.claims->>'role' = 'service_role'`; el
> fallback vive DENTRO de ese gate, no abre canal nuevo).
>
> **Falsificado en tres capas** (no es "confío en que anda"): un bloque `DO` **dentro de la migración**
> ejerce las 8 combinaciones de header y aborta si alguna falla · la suite `audit` pasó de 15 a **20 tests**
> (TA.17/TA.19 = header VIEJO contra servidor NUEVO se registra igual; TA.20 control negativo; TA.21 spoof
> con las DOS grafías) · y **antes** de aplicar la migración se corrió la suite a propósito: TA.12/TA.18
> (nombres nuevos) FALLARON y TA.17/TA.19 (viejos) pasaron — o sea que los tests ejercen el path real.
>
> Detalle completo, baseline literal y la decisión del guard de marca: `progress/rebrand-fase5-headers.md`.

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
