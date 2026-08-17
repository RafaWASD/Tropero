# Rebrand — dominio de fixtures `@rafaq-test.local` → `@mitropero-test.local`

**2026-08-17** · Fase 7, punto 1 de `progress/rebrand-fases-4-5-preparacion.md`. HEAD al arrancar:
`fbfa4765efc83a59818f410f78dcd680d1ed51d5`.

Es el resto que ninguna fase del plan cubría: la fase 2 acotó la categoría G a `app/e2e/`, y este
dominio vive **fuera de `app/`** (suites backend + un script de seed).

---

## 1. Inventario medido (no el del plan)

`git grep -c "rafaq-test\.local"` sobre `fbfa476` → **27 archivos**. De ahí, sólo **16 archivos /
34 ocurrencias son CÓDIGO**; el resto es documentación/historial.

**Corrección de conteo**: `progress/rebrand-fase2-e2e.md` dice **35** ocurrencias fuera de `app/`.
Son **34**, contadas de verdad (`git diff -U0 | grep -o … | wc -l` post-rename = 34, una por línea).
`git grep -c` cuenta LÍNEAS con match, no ocurrencias — acá coinciden porque no hay dos en la misma
línea, pero el 35 del doc de la fase 2 era un error de suma, no una ocurrencia perdida.

### 1.a Código — lo que se renombra (34 ocurrencias, 16 archivos)

| Archivo | Ocurrencias | Dónde |
|---|---:|---|
| `supabase/tests/edge/run.cjs` | 11 | `createTestUser` + 10 emails de invitación/intruso/expirado/no-verificado |
| `supabase/tests/user_private/run.cjs` | 6 | `createTestUser` + dup/changed/sentinel/phone_changed/phone_confirmed |
| `supabase/tests/rls/run.cjs` | 3 | `createTestUser` + invitee + intruso |
| `supabase/tests/sync_streams/run.cjs` | 2 | `createTestUser` + invitee |
| `supabase/tests/animal/run.cjs` | 1 | `createTestUser` |
| `supabase/tests/audit/run.cjs` | 1 | `createTestUser` |
| `supabase/tests/custom/run.cjs` | 1 | `createTestUser` |
| `supabase/tests/import/run.cjs` | 1 | `createTestUser` |
| `supabase/tests/maneuvers/run.cjs` | 1 | `createTestUser` |
| `supabase/tests/operaciones_rodeo/run.cjs` | 1 | `createTestUser` |
| `supabase/tests/puesta-en-servicio/run.cjs` | 1 | `createTestUser` |
| `supabase/tests/reports/run.cjs` | 1 | `createTestUser` |
| `supabase/tests/scrotal/run.cjs` | 1 | `createTestUser` |
| `supabase/tests/sigsa/run.cjs` | 1 | `createTestUser` |
| `supabase/tests/treatments/run.cjs` | 1 | `createTestUser` |
| `scripts/seed-facundina.mjs` | 1 | `bootstrap()` — usuario del establecimiento DESCARTABLE |

**Corrección al plan**: los docs de las fases 2 y 7 dicen *"20 suites backend"*. Son **15**.
`supabase/tests/` tiene **16** directorios y `health/` no usa el dominio (no crea usuarios).

### 1.b Comentario que queda mintiendo tras el rename (1 archivo, 2 ocurrencias)

`app/e2e/helpers/admin.ts:10-11` — la fase 2 dejó el nombre viejo **a propósito** ahí, con la nota
*"es el dominio que HOY usan las 20 suites backend […] que se renombran en su propia pasada"*.
Esta ES esa pasada, así que el comentario pasa a ser falso. Se corrige (ver §6).

### 1.c Historial — NO se toca (7 archivos)

`progress/rebrand-fase{2,3,4,5}-*.md` · `progress/rebrand-fases-4-5-preparacion.md` ·
`progress/security_code_15-powersync.md` · `progress/impl_14-pii-user-private.md` ·
`feature_list.json` (nota histórica de la spec 14) · `docs/rebrand-mitropero-plan.md` (el plan
describe la categoría por su nombre de entonces). Reescribirlos falsearía el registro.

`docs/backlog.md` (4 ocurrencias) **sí** se actualiza, pero por contenido, no por nombre: la lista de
dominios a purgar del remoto cambia (§5).

---

## 2. Las tres preguntas de riesgo, verificadas

### 2.1 ¿Hay usuarios de fixture PRE-SEMBRADOS en el remoto? → **NO. Todos se crean por corrida.**

Verificado leyendo el mecanismo, no asumiendo. Las **15** suites tienen el mismo helper:

```js
const email = `${RUN_TAG}_${label}@rafaq-test.local`;
const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true, ... });
```

`RUN_TAG` es único por corrida (`<suite>_test_${Date.now()}_${rand}`). Después se entra con
`signInWithPassword(email, PASSWORD)` **usando el email recién creado**, nunca uno buscado.

Contraprueba (la que importa): **ninguna suite busca un usuario preexistente**.
`git grep -nE "listUsers|getUserByEmail|like\(.email|ilike\(.email" -- supabase/tests` → **cero
resultados**. Y `git grep -nE "@[a-z0-9.-]+\.(local|test|com|ar|io)" -- supabase/tests
scripts/seed-facundina.mjs` sin el dominio viejo → **cero**: no hay ningún literal de email fuera
del namespace `RUN_TAG`. O sea que no existe un email de fixture "fijo" que pueda quedar huérfano.

Los 3 `.eq('email', …)` / `updateUserById` de `edge` y `user_private` operan sobre emails que la
misma corrida acaba de fabricar con su `RUN_TAG` — se renombran en bloque con el resto.

**Confirmado EMPÍRICAMENTE, no sólo leyendo** (`auth.admin.listUsers` paginado sobre DEV, read-only,
2026-08-17): **452 usuarios de auth**, repartidos en `rafaq-test.local` **410**, `rafaq-e2e.test`
**33**, `gmail.com` **8**, `privaterelay.appleid.com` **1**. O sea: los únicos usuarios que existen
con el dominio viejo son **410 huérfanos de corridas interrumpidas** (el más nuevo del 2026-08-11) —
no hay ninguna cuenta "de sistema" ni fixture fijo que alguna suite espere encontrar.

**Riesgo residual: cero.** Renombrar sólo cambia el sufijo de un email que se crea y se borra dentro
de la misma corrida.

### 2.2 `scripts/seed-facundina.mjs` → **no toca la cuenta real. Se renombra.**

El dominio aparece **una sola vez**, en `bootstrap()` (línea 1005), bajo el título
*"bootstrap / teardown del establecimiento DESCARTABLE"*:

```js
const email = `seed_test_${stamp}@rafaq-test.local`;   // + establecimiento marcado SEED-TEST
```

`bootstrap()` es la utilidad para fabricarse un campo de prueba tirable; el `--teardown` se **niega**
si el establecimiento no lleva la marca `SEED-TEST`. El seed real de La Facundina recibe
`--establishment-id` / `--owner-id` por argumento y **nunca** pasa por ahí.

`grep -n "iamfadolf" scripts/seed-facundina.mjs` → **cero**. La cuenta real de Facundo no está en el
script en ninguna forma. **Se renombra sin tocar nada de La Facundina.**

### 2.3 ¿Existe una allowlist de dominios? → **NO. Reconfirmado.**

- `grep -n "rafaq\|\.local\|mitropero" supabase/config.toml` → **cero**.
- `git grep -n "rafaq-test" -- supabase/migrations supabase/functions .github` → **cero**.
- No hay seed SQL ni helper que valide el dominio; el dominio sólo se **concatena** para construir un
  email.

Un detalle que sí importa y que se preservó a propósito: **el TLD no cambia** (`.local` → `.local`).
Hay antecedente de que Supabase Auth **rechaza** ciertos dominios en el path *user-initiated*
(nota de `feature_list.json`, spec 14 T23/R7.2). Hoy las suites sólo usan el path **admin**
(`admin.createUser` / `admin.updateUserById`), que acepta `.local` — y como el TLD queda igual, la
clase de comportamiento de Auth no cambia.

### 2.4 ¿Algún barrido automático barre por dominio? → **NO. Verificado en las dos puntas.**

- **E2E** (`app/e2e/helpers/admin.ts::cleanupAll`, l. 1689-1737): borra por **ids trackeados**
  (`createdEstablishmentIds` / `createdUserIds`) + un sweep de `establishments` por
  `.like('name', '${RUN_TAG}%')`. **Ninguna query filtra por email/dominio.** El comentario que
  nombra el namespace describe de dónde salen esos ids, no un predicado.
- **Suites backend**: mismo patrón (ids trackeados). Cero `like('email', …)`.
- `scripts/cleanup-test-orphan.mjs`: es del tag `'9'×64` de la Animal suite, no toca usuarios.

**No hay barrido automático que este rename rompa.** Lo único afectado es el **purgado MANUAL** del
remoto, que vive como entrada de `docs/backlog.md` (§5).

---

## 3. Baseline de atribución (ANTES de tocar nada)

`node scripts/check.mjs` completo sobre `fbfa476` con el árbol tal cual (incluye las modificaciones
sin commitear de la otra terminal en `app/src/services/ble/*`). Es el baseline correcto: corre las
**15** suites afectadas + typecheck + los guards, todo de una.

> ⚠️ Flakes catalogados a descartar antes de atribuir: (a) `Request rate limit reached` + cascada de
> `undefined.id` = rate-limit de auth de Supabase por dos terminales activas; (b) orphans de
> `field_definitions` en la suite Custom; (c) `animals_tag_unique` con `'9'×64` en la Animal suite.

**Resultado baseline**: ver §7.

---

## 4. El cambio

`@rafaq-test.local` → `@mitropero-test.local` en los 16 archivos de §1.a. Nada más: no cambia el
mecanismo, ni el `RUN_TAG`, ni el TLD, ni el password de fixture, ni ningún cleanup.

---

## 5. La consecuencia: ahora son CUATRO dominios en el remoto, no tres

Los usuarios ya creados en el remoto con el dominio viejo **se quedan ahí** (nadie los migra: son
huérfanos de corridas interrumpidas). Después de este rename conviven:

| Dominio | Estado | Quién lo creó |
|---|---|---|
| `@mitropero-test.local` | **vivo** | las 15 suites backend + `seed-facundina --bootstrap` (desde hoy) |
| `@mitropero-e2e.test` | **vivo** | la suite E2E (desde el rebrand fase 2) |
| `@rafaq-test.local` | **residuo** | las mismas 15 suites, antes de hoy |
| `@rafaq-e2e.test` | **residuo** | la suite E2E, antes de la fase 2 |

Se actualizan las **dos** entradas de purgado de `docs/backlog.md` (2026-06-05 y 2026-06-08), que la
fase 2 había dejado enumerando **tres**.

---

## 6. Qué queda afuera

- **Historial** (§1.c): `progress/*`, `feature_list.json`, `docs/rebrand-mitropero-plan.md`.
- **Lo prohibido por la consigna**: `RAFAQ_ENV` / `RAFAQ_CONFIRM_PROD` / `RAFAQ_KNOWN_PROD_REFS`
  (acoplamiento externo), `~/.rafaq-backups` + `rafaq-prod-*`, `rafaq-beta` (PowerSync), `design/**`,
  `rafaq.db`, las migraciones históricas con `rafaq.is_`, la fase 6 (Expo).
- **`scripts/run-tests.mjs`**: NO se toca (no contiene el dominio; se verificó).
- **La E2E no se corre**: el único archivo de `app/` que se toca es un **comentario** en
  `app/e2e/helpers/admin.ts` (§1.b). No hay cambio de comportamiento; lo cubre el typecheck.

---

## 7. Verificación

### 7.0 El baseline con `check.mjs` NO SIRVE, y por un motivo ya documentado

Primer intento de baseline: `node scripts/check.mjs` sobre `fbfa476` → **RC=1**, y **los stages de
backend nunca corrieron**. Causa: la entrada 🔴 del 2026-08-17 de `docs/backlog.md` — `run()` de
`scripts/run-tests.mjs` usa `execSync` sin `try`, así que el primer stage rojo mata el proceso.

El stage que estaba rojo era **ajeno**: `app/plugins/with-bluetooth-classic.test.ts` (2 tests), por el
alta de `react-native-ble-plx@3.5.1` en `app/package.json` que estaba en vuelo en la otra terminal
(su config plugin cambia el manifiesto mergeado: desaparece `tools:targetApi=31` de `BLUETOOTH_SCAN` y
aparece `ACCESS_FINE_LOCATION` en el caso de falsificación). Se **anotó, no se arregló**. Quedó
resuelto solo cuando esa terminal commiteó `3272227`.

Por eso el baseline de atribución se tomó **corriendo las 16 suites backend una por una** (mismo
transporte que `run-tests.mjs`: `.env.local` en el env + `TZ=America/Argentina/Buenos_Aires`).

### 7.1 Las 16 suites backend — ANTES vs DESPUÉS (idénticas, suite por suite)

| Suite | Baseline (`fbfa476`, dominio viejo) | Después (dominio nuevo) |
|---|---|---|
| rls | 22/22, fail 0, RC 0 | 22/22, fail 0, RC 0 |
| edge | 47 tests · 42 pass · 5 skipped · fail 0, RC 0 | 47 · 42 · 5 skipped · fail 0, RC 0 |
| animal | 139/139, fail 0, RC 0 | 139/139, fail 0, RC 0 |
| maneuvers | 14/14, fail 0, RC 0 | 14/14, fail 0, RC 0 |
| puesta-en-servicio | 11/11, fail 0, RC 0 | 11/11, fail 0, RC 0 |
| reports | 36/36, fail 0, RC 0 | 36/36, fail 0, RC 0 |
| custom | 20/20, fail 0, RC 0 | 20/20, fail 0, RC 0 |
| scrotal | 12/12, fail 0, RC 0 | 12/12, fail 0, RC 0 |
| user_private | 28/28, fail 0, RC 0 | 28/28, fail 0, RC 0 |
| import | 25/25, fail 0, RC 0 | 25/25, fail 0, RC 0 |
| sync_streams | 25/25, fail 0, RC 0 | 25/25, fail 0, RC 0 |
| operaciones_rodeo | 22/22, fail 0, RC 0 | 22/22, fail 0, RC 0 |
| sigsa | 72/72, fail 0, RC 0 | 72/72, fail 0, RC 0 |
| treatments | 11/11, fail 0, RC 0 | 11/11, fail 0, RC 0 |
| audit | 21/21, fail 0, RC 0 | 21/21, fail 0, RC 0 |
| health | 5/5, fail 0, RC 0 | 5/5, fail 0, RC 0 |
| **TOTAL** | **510 tests · 505 pass · 5 skipped · 0 fail** | **510 · 505 · 5 skipped · 0 fail** |

Ningún flake catalogado apareció en ninguna de las dos corridas (ni rate-limit, ni orphans de
`field_definitions`, ni `animals_tag_unique`).

### 7.2 …y el verde NO alcanza: la falsificación

Las 16 suites pasarían verdes con **cualquier** dominio sintáctico: el dominio no tiene rol semántico,
sólo se concatena. Verde después ⇏ el rename tomó efecto. Se verificó de verdad, en tres patas:

1. **Estática**: `git grep "rafaq-test\.local" -- supabase/tests scripts` → **0**. El diff son
   **34 líneas, 34 ocurrencias, todas puro swap de dominio** (`git diff -U0 | grep -E "^[+-][^+-]"`
   revisado línea por línea: no se coló ningún otro cambio).
2. **En vuelo, contra el remoto** (lo que ninguna aserción de la suite mira): con un poller read-only
   (`auth.admin.listUsers` cada 2 s) corriendo, se lanzó la suite `rls`. Capturados **9 usuarios**
   creados con el dominio NUEVO, p. ej.:
   `rls_test_1786950647173_bvsi8s_usera@mitropero-test.local  (2026-08-17T07:10:48Z)`.
   Esto prueba a la vez las dos cosas que importaban: **Supabase Auth acepta el dominio nuevo** por el
   path admin (el riesgo heredado de la spec 14 T23/R7.2) y **el email que llega al remoto es el nuevo**.
3. **El cleanup sigue cerrando**: el total de usuarios de auth volvió a **452** al terminar la corrida
   (los 9 se borraron). El rename no agrega residuo nuevo.

### 7.3 `node scripts/check.mjs` completo → **RC=0**

Con el árbol de hoy (ya con el commit `3272227` de la otra terminal), los **22 stages** en verde,
incluidos los 16 backend:

```
ℹ tests 3155 · pass 3155 · fail 0     (client unit tests)
<<< RLS suite OK … <<< Health EF suite (spec 16 Run C) OK
All tests passed.
[OK]    Entorno listo. Podés trabajar.
RC=0
```

### 7.4 `pnpm -C app typecheck` → **RC=0** (`tsc --noEmit`, sin salida)

⚠️ Con una salvedad honesta: `app/tsconfig.json` **excluye `e2e`**, así que el typecheck NO cubre
`app/e2e/helpers/admin.ts`. Lo que sí lo cubre: el cambio ahí son **8 líneas de comentario `//`** y
nada más (verificado en el diff). No se corrió la E2E — no hace falta para un comentario.

### 7.5 Autorrevisión adversarial — qué busqué y qué encontré

| Qué busqué | Resultado |
|---|---|
| Dominio armado por concatenación o vía constante (que el grep no vería) | Ninguno. Los 34 son literales inline. El único `NAMESPACE` exportado es el de la E2E, que no se toca. |
| Otro literal de email fuera del namespace `RUN_TAG` (un fixture "fijo" que quedara huérfano) | Cero (`git grep -nE "@[a-z0-9.-]+\.(local\|test\|com\|ar\|io)" -- supabase/tests scripts/seed-facundina.mjs` sin el dominio viejo). |
| Fixtures `.sql` / seeds en `supabase/tests` | No existen: los 16 directorios tienen **sólo** `run.cjs`. |
| Cota de largo del email (el dominio nuevo es 4 chars más largo) | `user_private_email_len_chk` / `invitations_email_len_chk` = **320**. El email más largo que se fabrica ronda **64**. Sin riesgo. |
| Allowlist de dominios en `config.toml` / migraciones / EFs / CI | Cero en las cuatro. Y las EFs no tienen ningún trato especial para dominios de test. |
| Barrido automático por dominio que el rename rompiera | Ninguno, verificado en las dos puntas (§2.4). |
| Churn de CRLF (bug de clase del repo en Windows) | `git diff --stat` == `git diff -w --stat` en los 18 archivos, y `file` no reporta CRLF en ninguno. |
| El comentario nuevo, ¿afirma de más? | Sí: la primera redacción decía *"lo que los separa es el TLD"*, y en realidad difieren en label **y** TLD. Corregido antes de terminar. |

**Observación (no la ejecuté, no está en scope)**: las 15 suites backend hardcodean el dominio en 16
lugares, mientras que la E2E lo tiene en **una** constante exportada (`E2E_NAMESPACE`). Por eso este
rename tocó 34 líneas y el de la fase 2 tocó una. Si hay otra pasada, un `FIXTURE_DOMAIN` compartido
lo dejaría en un solo lugar. Es cosmético; queda como observación para el leader, no como acción.

### 7.6 Lo rojo que NO es mío

- `app/plugins/with-bluetooth-classic.test.ts` (2 tests) estuvo rojo durante el baseline por el alta
  de `react-native-ble-plx@3.5.1` en vuelo en la otra terminal. **Ya no está rojo**: lo cerró el
  commit `3272227` de esa terminal. No lo toqué.
- La entrada 🔴 de `docs/backlog.md` (2026-08-17) sobre `run-tests.mjs` **sigue abierta**: el
  `execSync` sin `try` hace que un stage temprano rojo tape los 16 backend. Me pegó de lleno (§7.0).
  El fix vive en `scripts/run-tests.mjs`, que tiene **instrucción explícita de no tocar** sin avisar
  primero. Reportado, no ejecutado.
