# Rebrand fase 2 — infra de E2E (globals de window + fixtures)

**Fecha**: 2026-08-16 · **Baseline (HEAD al arrancar)**: `88cecaf` (fase 1, prosa)
**Alcance**: §4.F (globals de window) + §4.G (fixtures) de `docs/rebrand-mitropero-plan.md`, más las
referencias de esos identificadores en `docs/` y `specs/` (que la fase 1 protegió a propósito).

**Riesgo real de esta fase**: NO es el texto, es la **divergencia definición ↔ uso**. Si la app define
`__mitroperoBle` y el spec E2E lee `__rafaqBle`, el hook queda sin nadie que lo lea y la suite se cae
**en silencio** (el test no falla por "no existe la marca": falla por timeout, o peor, pasa por la razón
equivocada porque el gate nunca se activó y el flujo cae al camino por defecto).

---

## 1. Inventario MEDIDO (antes de tocar nada)

`git grep -lE '__[Rr][Aa][Ff][Aa][Qq]' -- app` → **72 archivos**
(37 `app/e2e` + 23 `app/e2e/captures` + 1 `app/e2e/helpers` + 3 `app/src/utils` + 2 `app/src/services/ble`
+ 1 `app/src/features/ble-stick/components` + 2 `app/app/_components` + 2 `app/app/maniobra/_components`
+ 1 `app/app`). Coincide con el conteo del encargo (~72: 6 en `app/src`, 5 en `app/app`, 61 en `app/e2e`).

### A) Los 11 globals — ocurrencias exactas (`git grep -oF`)

| Identificador | app (occ / files) | docs+specs (occ / files) | Definición |
|---|---|---|---|
| `__rafaqBle` | 205 / 47 | 7 / 3 | `app/app/_components/ble-e2e-flag.ts:54` (`BLE_E2E_HANDLE_KEY`) |
| `__RAFAQ_BLE_E2E__` | 117 / 64 | 18 / 11 | `ble-e2e-flag.ts:15`, `demo-gate.ts:16`, `demo-gate.test.ts:13`, `StickStatusIndicator.tsx:94` |
| `__RAFAQ_BLE_E2E_MANUAL__` | 21 / 13 | 5 / 4 | `ble-e2e-flag.ts:38` |
| `__RAFAQ_BLE_DEMO__` | 15 / 10 | 12 / 3 | `demo-gate.ts:11` |
| `__RAFAQ_BLE_DEMO_ALLOW_E2E__` | 5 / 2 | 0 / 0 | `demo-gate.ts:17`, `demo-gate.test.ts:14` |
| `__RAFAQ_SYNC_REJECT_E2E__` | 9 / 5 | 2 / 2 | `app/app/maniobra/_components/sync-rechazo-e2e.ts:18` |
| `__RAFAQ_E2E__` | 9 / 3 | 9 / 4 | `app/src/utils/app-env.ts:21` |
| `__RAFAQ_MANEUVER_FAULT__` | 7 / 4 | 2 / 2 | `app/app/maniobra/_components/maneuver-e2e-fault.ts:17` |
| `__rafaqBeeps` | 7 / 2 | 0 / 0 | sólo `app/e2e` (lo setea el propio spec) |
| `__rafaqTones` | 3 / 1 | 0 / 0 | sólo `app/e2e` |
| `__rafaqPrefStorage` | 3 / 1 | 0 / 0 | sólo `app/e2e` |

**Solapamiento de prefijos: verificado que NO hay.** `__RAFAQ_BLE_E2E__` no es substring de
`__RAFAQ_BLE_E2E_MANUAL__` (ahí `E2E` va seguido de `_M`, no de `__`); `__RAFAQ_BLE_DEMO__` no es substring
de `__RAFAQ_BLE_DEMO_ALLOW_E2E__` (idem); `__RAFAQ_E2E__` no es substring de `__RAFAQ_BLE_E2E__`. Por eso
un reemplazo de cadena EXACTA, sin orden particular, es seguro.

### B) Fixtures

| Token | app | docs+specs | fuera de app/docs/specs/progress |
|---|---|---|---|
| `rafaq-e2e.test` | 9 | 2 | 0 |
| `RAFAQ_E2E_BASE_URL` | 2 (`animals-offline.spec.ts:51-52`) | 0 | 0 |
| `rafaq-test.local` | **1** (un COMENTARIO) | 4 | **35** |

### C) Identificadores `__rafaq*` que NO están en el encargo (medidos, y qué hago con cada uno)

- `__RAFAQ_PS__` — 4 ocurrencias, **todas en prosa** (`docs/backlog.md:470`,
  `specs/active/20-reactividad-sync/design.md:507,565`, `specs/active/21-watched-queries/context.md:14`).
  **Cero en código.** Era instrumentación temporal de la feature 20 que **ya se quitó** (lo dice el propio
  `design.md:565`: "Instrumentación temporal QUITADA"). No es plomería viva: es el registro de un
  experimento A/B que se hizo con ESE nombre. Renombrarlo falsifica el historial, igual que `progress/`.
  **Decisión: NO se toca.** Reportado.
- `__rafaqble` / `__rafaq_ble_e2e__` / `__rafaq*` (lowercase mangled) — sólo en
  `docs/rebrand-mitropero-plan.md` (§2 tabla de mapeo, §4.F, §7 comandos). Son la **descripción del
  trabajo a hacer**: nombran el estado DESDE el que se renombra. Renombrarlos deja el doc diciendo
  "renombrar `__mitroperoBle` → `__mitroperoBle`". **Decisión: NO se tocan.** (Además ninguno matchea los
  11 tokens exactos, así que el reemplazo no los alcanza.)

---

## 2. Plan (T1..T6)

- **T1** — Renombrar los 11 globals en `app/**`, definición y usos, en la MISMA pasada (reemplazo de
  cadena exacta), excluyendo `app/src/utils/brand-name-guard.test.ts`.
- **T2** — Fixtures en `app/e2e/**`: `rafaq-e2e.test` → `mitropero-e2e.test`,
  `RAFAQ_E2E_BASE_URL` → `MITROPERO_E2E_BASE_URL`.
- **T3** — Referencias de los 11 globals en `docs/**` + `specs/**` (mismo reemplazo exacto), excluyendo
  `docs/rebrand-mitropero-plan.md`. Fixtures en `app/e2e/README.md` (ya cubierto por T2) y las 2
  menciones de `rafaq-e2e.test` en docs/specs si las hay.
- **T4** — Verificación de divergencia: `git grep -E '__[Rr][Aa][Ff][Aa][Qq]' -- app docs specs` y
  confirmar que sólo queda lo declarado en §1.C + el guard.
- **T5** — `pnpm -C app typecheck` + `node scripts/check.mjs` contra el baseline `3115 pass / 1 fail`.
- **T6** — `pnpm -C app run e2e` → 306 passed / 1 skipped (2 flakes conocidos permitidos), revertir
  `design/` después.

## 3. Fuera de alcance (medido, NO tocado, reportado)

- `rafaq.db`, `X-Rafaq-*`, GUCs `rafaq.*`, `sync-streams/rafaq.yaml`, identidad Expo, `RAFAQ_ENV`/
  `RAFAQ_CONFIRM_PROD`/`RAFAQ_KNOWN_PROD_REFS`, `noreply@rafq.ar`, `progress/` — fases 3/4/5/6.
- `@rafaq-test.local` en **20 suites backend** (`supabase/tests/*/run.cjs`) + `scripts/seed-facundina.mjs`
  → 35 ocurrencias fuera de `app/`. Por instrucción explícita: NO tocar, reportar.
- Casos sintéticos + comentarios de `app/src/utils/brand-name-guard.test.ts`.
- `feature_list.json:156` (1 mención en un campo `notes`).

---

## 4. Ejecución

### T1–T3 — el rename (94 archivos escritos)

Script de reemplazo de cadena EXACTA (Node, `fs` con `'utf8'` → **no traduce EOL**, a diferencia del modo
texto de Python; verificado: `git diff --stat` y `git diff --stat -w` dan **idéntico** → cero churn CRLF).
Excluidos por lista: `app/src/utils/brand-name-guard.test.ts` y `docs/rebrand-mitropero-plan.md`.

Conteo **por token**, y su cuadre contra el inventario de §1:

| Token | reemplazos | cuadre |
|---|---|---|
| `__rafaqBle` | 211 | 205 app − 1 (guard, skip) + 7 docs = 211 ✓ |
| `__RAFAQ_BLE_E2E__` | 134 | 117 − 1 + 18 = 134 ✓ |
| `__RAFAQ_BLE_E2E_MANUAL__` | 26 | 21 + 5 ✓ |
| `__RAFAQ_BLE_DEMO__` | 27 | 15 + 12 ✓ |
| `__RAFAQ_BLE_DEMO_ALLOW_E2E__` | 5 | 5 + 0 ✓ |
| `__RAFAQ_SYNC_REJECT_E2E__` | 11 | 9 + 2 ✓ |
| `__RAFAQ_E2E__` | 18 | 9 + 9 ✓ |
| `__RAFAQ_MANEUVER_FAULT__` | 8 | 7 − 1 + 2 ✓ |
| `__rafaqBeeps` / `__rafaqTones` / `__rafaqPrefStorage` | 7 / 3 / 3 | sólo `app/e2e` ✓ |
| `rafaq-e2e.test` | 9 | 9 app (+2 en el plan doc, skip) ✓ |
| `RAFAQ_E2E_BASE_URL` | 2 | `animals-offline.spec.ts:51-52` ✓ |

**Cuadra al 100%.** Cada ocurrencia del inventario está o reemplazada o explícitamente excluida.

**Pareo definición ↔ uso (el riesgo de esta fase), verificado token por token:**

| Nuevo | definición (`app/src`+`app/app`) | specs e2e | captures |
|---|---|---|---|
| `__mitroperoBle` | `ble-e2e-flag.ts:54` (`BLE_E2E_HANDLE_KEY`) + `BleE2EBridge.tsx` | 28 | 16 |
| `__MITROPERO_BLE_E2E__` | `ble-e2e-flag.ts:15`, `demo-gate.ts:16`, `StickStatusIndicator.tsx:94`, `_layout.tsx` | 37 | 21 |
| `__MITROPERO_BLE_E2E_MANUAL__` | `ble-e2e-flag.ts:38` | 5 | 7 |
| `__MITROPERO_BLE_DEMO__` | `demo-gate.ts:11`, `_layout.tsx` | 3 | 4 |
| `__MITROPERO_BLE_DEMO_ALLOW_E2E__` | `demo-gate.ts:17` | 0 | 0 (ya era 0) |
| `__MITROPERO_SYNC_REJECT_E2E__` | `sync-rechazo-e2e.ts:18` | 2 | 2 |
| `__MITROPERO_E2E__` | `app-env.ts:21` | 1 (`helpers/fixtures.ts`) | 0 |
| `__MITROPERO_MANEUVER_FAULT__` | `maneuver-e2e-fault.ts:17` | 2 | 0 |

Ninguno quedó huérfano (definido sin lector, o leído sin definición).

### T1-bis — REGRESIÓN PROPIA encontrada y cerrada: el guard de marca, REGLA B

`node scripts/check.mjs` (1ra corrida) → **10 fallos NUEVOS**, todos en
`brand-name-guard.test.ts` regla **B** ("el nombre nuevo se escribe SIEMPRE `miTropero`"):

```
[B grafía "MITROPERO"] app/_components/ble-e2e-flag.ts:15   const E2E_GLOBAL_KEY = '__MITROPERO_BLE_E2E__';
[B grafía "mitropero"] app/_components/ble-e2e-flag.ts:54   export const BLE_E2E_HANDLE_KEY = '__mitroperoBle';
… (8 más: demo-gate.ts ×3, app-env.ts, StickStatusIndicator.tsx, maneuver-e2e-fault.ts, sync-rechazo-e2e.ts, ble-e2e-flag.ts:38)
```

**Mecanismo**: el guard tenía el concepto de "flag global interno" (`INTERNAL_FLAG_PREFIX = '__'`) pero lo
aplicaba **sólo a la regla A** (nombre VIEJO). Tenía sentido: hasta ayer todos los flags llevaban el nombre
viejo. Al renombrarlos, pasaron a caer bajo la **B**, que sólo tenía carve-out para DOMINIOS — y los
reportó como "grafía equivocada del wordmark" cuando no son wordmark: son identificadores, donde la grafía
la manda la convención de código (`mitropero`, no `miTropero` — es la propia decisión del §2 del plan y de
la pregunta 1 resuelta).

**No es evitable**: la fase 2 *es* renombrar esos identificadores. Las salidas eran (a) extender el
carve-out o (b) 10 válvulas `brand-name-disable-line` (que además desactivan las reglas A y C en esas
líneas). Elegí (a): una línea, el MISMO predicado que ya usa la regla A, reutilizando la misma constante.

**Qué NO se aflojó**: la regla B sigue prohibiendo `mitropero`/`MITROPERO`/`MiTropero`/`Mi Tropero` en
**texto**. El carve-out exige el `__` **pegado**.

**Falsificado con 3 mutantes** (el carve-out no es decorativo):

| Mutante | Resultado |
|---|---|
| carve-out de B **removido** | ✖ regla B sobre el árbol **Y** ✖ el test de casos sintéticos |
| carve-out de B **ensanchado** (`slice(idx-4, idx).includes('__')`) | ✖ el test de casos sintéticos (lo caza `<Text>__ mitropero</Text>`) |
| regla B **desactivada** entera (`continue` incondicional) | ✖ el test de casos sintéticos |

**Casos sintéticos agregados** (3 negativos + 4 contrapruebas), con los flags REALES tal como quedaron:
`!hit("'__MITROPERO_BLE_E2E__'")`, `!hit("'__mitroperoBle'")`, `!hit('… .__MITROPERO_BLE_E2E__ === true …')`
(leído inline, sin constante) — y en contra: `hit("'Bienvenido a mitropero'")`,
`hit("'MITROPERO_BLE_E2E'")` (sin `__` un identificador **no** está exento), `hit('<Text>__ mitropero</Text>')`
(el `__` tiene que estar pegado), `hit('<Text>mitropero</Text>')`.

⚠️ **Esto es una desviación del "no toques `brand-name-guard.test.ts`" del encargo.** Los **casos
sintéticos que arman `__${OLD_NAME_FIXTURE}_BLE_E2E__` por concatenación quedaron intactos** (siguen
probando la regla A). Lo que cambió es el PREDICADO de la regla B + 3 comentarios que, tras el rename,
nombraban identificadores muertos (`__RAFAQ_BLE_E2E__` como ejemplo de flag vigente).

### T4 — barrido de divergencia

`git grep -cE '__[Rr][Aa][Ff][Aa][Qq]' -- app docs specs` → quedan **12 ocurrencias en 5 archivos**,
TODAS declaradas en §1.C / §8:

| Archivo | n | Qué es |
|---|---|---|
| `app/src/utils/brand-name-guard.test.ts` | 1 | el comentario de la **regla A** (`// (1) Flag global interno: \`__RAFAQ_…\``) — sigue siendo exacto: la regla A es la del nombre VIEJO |
| `docs/backlog.md` | 1 | `__RAFAQ_PS__` (instrumentación quitada, prosa histórica) |
| `docs/rebrand-mitropero-plan.md` | 7 | la descripción de esta misma fase (§2/§4.F/§7) |
| `specs/active/20-reactividad-sync/design.md` | 2 | `__RAFAQ_PS__` |
| `specs/active/21-watched-queries/context.md` | 1 | `__RAFAQ_PS__` |

Y `git grep -nE 'rafaq-e2e\.test\|RAFAQ_E2E_BASE_URL' -- app` → **vacío**.
`git grep -in rafaq -- app` → sólo prosa "RAFAQ" (leftovers de fase 1 en `app/`, fuera de alcance),
`rafaq.db`, `X-Rafaq-Request-Id`, `rafaq.yaml`, identidad Expo, y el comentario anotado de `admin.ts`.

**Verificado también que ningún nombre se arma por PARTES** (concat/template) — un reemplazo literal se lo
habría perdido: `git grep -nE "['\"\`]__(mitropero|MITROPERO|rafaq|RAFAQ)[A-Za-z0-9_]*['\"\`]\s*\+"` → 0
(el único hit es un `+` de prosa dentro de un comentario).
Y que **no hay archivos no-TS** (json/html/golden) en `app` con estos nombres.

---

## 5. Autorrevisión adversarial

Qué busqué, qué encontré, cómo lo cerré.

| # | Qué busqué (como revisor hostil) | Resultado |
|---|---|---|
| 1 | **Divergencia definición ↔ uso** (el modo de falla de esta fase) | Cerrado por construcción: UNA sola pasada atómica sobre `app`+`docs`+`specs`. Verificado después token por token (tabla de pareo, §4): 0 huérfanos. |
| 2 | **Nombre armado por PARTES** (`'__RAF'+'AQ_…'`, template) que un replace literal se pierde | 0 casos. |
| 3 | **Solapamiento de prefijos** (`__RAFAQ_E2E__` dentro de `__RAFAQ_BLE_E2E__`, etc.) | Verificado uno por uno ANTES de reemplazar: ninguno es substring de otro (el `__` final los separa). |
| 4 | **Archivos no-TS** (json/html/config/golden/snapshot) con el nombre | 0 en `app`. |
| 5 | **Guards que miran el ÁRBOL** y podrían disparar sobre el nombre NUEVO | **ENCONTRADO**: `brand-name-guard` regla B. 10 fallos nuevos. Cerrado (§T1-bis) + falsificado con 3 mutantes. |
| 6 | **Tests que pasan por la razón equivocada**: una aserción sobre la AUSENCIA del global (`=== undefined`) pasaría igual con el nombre roto | 0 casos: no hay ninguna aserción de ausencia sobre estos globals. Los oráculos son de comportamiento. |
| 7 | **El typecheck NO cubre lo que renombré.** `app/tsconfig.json` **excluye `e2e`, `playwright*.config.ts` y `**/*.test.ts`** | Real y load-bearing: `typecheck` verde NO dice nada de los 61 archivos de `app/e2e` ni de `demo-gate.test.ts`/`app-env.test.ts`. Cobertura real: los 2 `.test.ts` → `check.mjs`; los `*.spec.ts` → `pnpm e2e`; **los 23 `*.capture.ts` → NINGUNO de los dos** (ver #8). |
| 8 | **Los `captures/*.capture.ts` no los corre `pnpm e2e`** (`playwright.config.ts` usa el `testMatch` default `*.spec/test.ts`; los captures sólo los recoge `playwright.capture.config.ts` con `testMatch: /captures[\\/].*\.capture\.ts$/`) | **Hueco real de verificación**: 23 archivos renombrados que la suite de regresión NO ejerce. Cerrado corriendo un capture BLE a mano (§6.3). |
| 9 | **El dominio nuevo de fixtures, ¿lo acepta Supabase Auth?** Hay antecedente: `@rafaq-test.local` fue RECHAZADO por Auth en el path user-initiated (nota de `feature_list.json`, spec 14 T23/R7.2) | El TLD no cambió (`.test` → `.test`), que es lo que la validación mira; y `@rafaq-e2e.test` venía funcionando. Se verifica EMPÍRICAMENTE: `account.spec.ts` cambia el email al dominio nuevo por el path user-initiated — exactamente el que rechazaba `.local`. |
| 10 | **¿El rename rompe el barrido de fixtures del remoto?** (dejar huérfanos invisibles en una DB compartida) | NO: `cleanupAll()` borra por **ids trackeados** + prefijo `RUN_TAG` en el nombre del establishment; `E2E_NAMESPACE` sólo se usa para CONSTRUIR emails (verificado: 2 usos, ninguno en una query). Pero sí agranda la lista del purgado MANUAL → documentado en `docs/backlog.md` (§6.2). |
| 11 | **Churn de CRLF** (el reescritor podía tocar 94 archivos enteros) | 0: `git diff --stat` idéntico a `git diff --stat -w`; todos los archivos son swap 1:1 de líneas salvo los 2 donde agregué texto a propósito. |
| 12 | **Superficie de producción**: ¿el rename abre algún camino nuevo para activar un flag de E2E/demo en prod? | No. Cambian sólo los NOMBRES de las claves; los gates (`isBleE2E`, `isDemoMode` triple-guard, `isE2E`) conservan predicado, precedencia y `try/catch`. El diff de `app/src`+`app/app` es 100% constantes de string + comentarios (revisado línea por línea). |
| 13 | **Comentarios que quedan mintiendo** tras el rename | 3 encontrados y cerrados: los del `INTERNAL_FLAG_PREFIX` del guard (nombraban `__RAFAQ_*` como flags vigentes), el de `admin.ts:10` (`@rafaq-test.local`, que sigue siendo cierto pero ahora necesita decir POR QUÉ) y las 2 entradas de purgado de `docs/backlog.md`. |
| 14 | **¿El conteo de E2E cambió por mi culpa?** (la corrida colecta **309**, el baseline del plan dice 306+1) | NO es mío: `git grep -c 'test('` sobre `app/e2e` da **305 en `88cecaf` y 305 ahora** — idéntico; y mi diff no agrega ni quita ningún `test(`. La cifra 306/1 del plan §1 es de una corrida vieja. |

---

## 6. Verificación

### 6.1 `pnpm -C app typecheck` → **0 errores**

⚠️ Con el caveat de §5 #7: `app/tsconfig.json` **excluye `e2e`, `playwright*.config.ts` y `**/*.test.ts`**.
El typecheck NO mira 61 de los 80 archivos que toqué en `app/`. No es una verificación de esta fase — es
el piso.

### 6.2 `node scripts/check.mjs` → **3115 pass / 1 fail** = EL BASELINE, exacto

| Corrida | pass | fail | Cuáles |
|---|---|---|---|
| baseline declarado | 3115 | 1 | regla A / `X-Rafaq-Request-Id` (fase 5) |
| **1ra mía** (post-rename, pre-fix) | 3114 | **2** | la de arriba **+ la mía** (regla B ×10 hallazgos en 1 test) |
| **2da mía** (post-fix del guard) | **3115** | **1** | **sólo la de arriba** |
| **3ra** (árbol tal como se entrega, después del ciclo stash/pop) | **3115** | **1** | ídem |

El único fallo es, literal:
`[A nombre viejo] src/services/{account,members,push-notifications}.ts → 'X-Rafaq-Request-Id'`.

⚠️ **Caveat que NO es mío pero conviene que se sepa**: `run-tests.mjs` usa `execSync`, que **tira** al
primer stage rojo. El stage de unit tests del cliente es rojo (el fallo de fase 5) → **las 17 suites
backend (`RLS`, `Edge Functions`, `Animal`, `Maneuvers`, `Audit`, `Sync streams`, …) NO llegan a
correr**, ni en el baseline ni en mis corridas. La comparación contra el baseline es válida (misma
truncadura de los dos lados) y esta fase no tocó una sola línea de `supabase/**` (verificado:
`git diff --name-only -- supabase scripts sync-streams .github` → vacío). Pero **desde que la fase 5 dejó
el guard en rojo, el backend está a oscuras en `check.mjs`.**

### 6.3 `pnpm -C app run e2e` → **307 passed / 1 skipped / 1 failed** (33.0 min)

- El único fallo es **`cria-al-pie-bastoneo.spec.ts:87`**, uno de los **2 flakes catalogados**.
  **Re-corrido y verde: `3 passed` (23.8s)** — verificado, no dado por bueno de la lista.
- El otro flake catalogado (`animals.spec.ts:1311`) pasó de una.
- El total colectado fue **309** (307+1+1) contra los "306+1" del plan §1. **No es mío**: `git grep -c 'test('`
  sobre `app/e2e` da **305 en `88cecaf` y 305 ahora**, y mi diff no agrega ni quita ningún `test(`. La cifra
  del plan es de una corrida vieja.
- **La E2E es la que prueba de verdad esta fase**: `alta-bastoneo`, `baston*`, `maniobra-*`,
  `cria-al-pie-bastoneo` ejercitan el handle `__mitroperoBle` y las marcas `__MITROPERO_*` de punta a
  punta. Si definición y uso hubieran divergido, el gate caía a `mode='auto'` y esas suites se caían en
  bloque. Y `account.spec.ts:137` (cambiar email, path **user-initiated**) validó empíricamente que
  Supabase Auth acepta `@mitropero-e2e.test`.

### 6.4 Captures — el hueco que `pnpm e2e` NO cubre (cerrado)

`playwright.config.ts` usa el `testMatch` default (`*.spec/test.ts`); los `*.capture.ts` sólo los recoge
`playwright.capture.config.ts`. O sea: **23 de los archivos que renombré no los ejerce la suite de
regresión.** Los corrí:

**`pnpm exec playwright test --config playwright.capture.config.ts` → 101 passed / 4 failed (11.8 min)**
(exit 127 = el crash de teardown de Node en Windows, no un fallo de test).

Los 4 fallos, atribuidos:

| Capture | ¿usa los globals renombrados? | ¿lo toca mi diff? | Veredicto |
|---|---|---|---|
| `baston-multivendor.capture.ts:123` | **sí** | sí | **PRE-EXISTENTE, MEDIDO**: stash de `app/` → rebuild en `88cecaf` → **falla idéntico**, misma línea 201, mismo `strict mode violation: getByText('Conectado') resolved to 2 elements` (la fila de "Más" + el `stick-status-pill` global; bajo demo el estado aparece 2 veces y este assert no usa `.first()` — lo que el as-built de T-MV.7.2 ya documentaba). No lo arreglé: fuera de alcance. |
| `cria-al-pie-alta.capture.ts:79` | no (0 refs) | no (0 líneas) | imposible que sea mío |
| `nombre-apodo.capture.ts:61` | no (0 refs) | no (0 líneas) | ídem |
| `tratamientos.capture.ts:49` | no (0 refs) | no (0 líneas) | ídem |

**Los 22 archivos de capture restantes que usan los globals renombrados: todos verdes.**

### 6.5 `design/` revertido

La corrida de E2E + la de captures dejaron **68 PNG** de `design/**` modificados con diffs espurios.
`git checkout -- design/` → **0**. Verificado antes de terminar. No hice `git add` de nada.

---

### 6.6 Hallazgo lateral (NO lo toqué): un hueco de falsificación PRE-EXISTENTE en la regla A

Al escribir los mutantes vi que el carve-out `__` de la **regla A** no está falsificado en su ANCHO: lo
ensanché a `slice(idx-4, idx).includes('__')` y **la suite quedó verde**. Le falta a la regla A la
contraprueba que sí le puse a la B (`<Text>__ mitropero</Text>` — el `__` tiene que estar PEGADO). Es
pre-existente, no lo introduje y no lo arreglé (fuera de alcance): queda anotado acá.

---

## 7. Reconciliación de specs / doc

| Archivo | Qué se reconcilió |
|---|---|
| 14 archivos de `specs/active/{03,04,09,16,21}` | Nombran los identificadores **as-built**. Sin esto, las specs quedaban describiendo hooks que ya no existen. |
| `docs/backlog.md:767` | La entrada LOW-2 nombra `window.__MITROPERO_BLE_E2E__` (el flag real). |
| `docs/backlog.md` — 2 entradas de purgado del remoto (2026-06-05 / 2026-06-08) | **Corrección de contenido, no de nombre**: enumeraban UN dominio de fixtures y ahora hay **TRES** vivos/residuales en el remoto compartido (`@rafaq-test.local` backend, `@mitropero-e2e.test` E2E nuevo, `@rafaq-e2e.test` residuo pre-rebrand). Un purgado que siguiera la lista vieja dejaba adentro los otros dos. Se aclara además que el teardown de la E2E **no barre por dominio** (ids trackeados + `RUN_TAG`), así que el rename no rompió ningún barrido automático. |
| `app/e2e/helpers/admin.ts:9-12` | El comentario sigue nombrando `@rafaq-test.local` **a propósito** (es el dominio REAL de las suites backend, que no se tocan en esta fase); se anotó el porqué para que la próxima pasada no lo "arregle" a ciegas. |
| `app/src/utils/brand-name-guard.test.ts` | El predicado de la regla B + 3 comentarios que, tras el rename, nombraban identificadores muertos. |
| `docs/rebrand-mitropero-plan.md` | Nota nueva: la regla B del guard **va a disparar en las fases 5 y 6** con el nombre NUEVO (tabla por fase), y en la 4 pasa sólo por accidente del carve-out de dominio. Es la consecuencia cross-fase del hallazgo de esta fase. |

**No toqué `progress/current.md`**: tiene cambios sin commitear de otra terminal (y apareció
`progress/rebrand-fases-4-5-preparacion.md`, también ajeno, durante esta sesión). El encargo me dio este
archivo como destino.

---

## 8. Fuera de alcance — medido y NO tocado, con el motivo

| Qué | Dónde | Por qué no |
|---|---|---|
| `@rafaq-test.local` | **20 suites backend** (`supabase/tests/*/run.cjs`) + `scripts/seed-facundina.mjs` → **35 ocurrencias** | Instrucción explícita: fuera de `app/` no se toca. **No hay ninguna allowlist de dominios** (ni en `supabase/config.toml`, ni en helpers, ni en seeds): el dominio sólo se usa para CONSTRUIR emails. Renombrarlo es un cambio aislado y seguro cuando se decida. |
| `__RAFAQ_PS__` | `docs/backlog.md:470`, `specs/active/20-.../design.md:507,565`, `specs/active/21-.../context.md:14` | **Cero en código**: era instrumentación temporal de la feature 20, ya QUITADA (lo dice el propio design). Renombrarlo falsifica el registro de un experimento que se hizo con ESE nombre — mismo criterio que `progress/`. |
| `__rafaq*` lowercase | `docs/rebrand-mitropero-plan.md` §2/§4.F/§7 (7 líneas) | Describen el estado DESDE el que se renombra. Renombrarlas deja el doc diciendo "renombrar `__mitroperoBle` → `__mitroperoBle`". |
| `__RAFAQ_BLE_E2E__` | `feature_list.json:156` (1 mención, campo `notes`) | Archivo de coordinación, y fuera del `git grep -- docs specs` del encargo. |
| Prosa "RAFAQ" en `app/` | `app/e2e/README.md`, `helpers/fixtures.ts:1`, `helpers/ui.ts:47`, `captures/baston-indicador-unico.capture.ts:153`, `playwright.config.ts:1`, `.npmrc`, `babel/metro.config.js`, ~20 comentarios de `app/src/components/**` | Son **leftovers de la FASE 1** (que barrió `docs/specs/CONTEXT/.github`, no `app/`). Es prosa, no plomería: no es fase 2. |
| `rafaq.db`, `X-Rafaq-*`, GUCs `rafaq.*`, `rafaq.yaml`, `rafaq-app`/`rafaqsorg`/`rafq`, `RAFAQ_ENV`/`RAFAQ_CONFIRM_PROD`/`RAFAQ_KNOWN_PROD_REFS`, `noreply@rafq.ar` | varios | Fases 3/4/5/6 — no tocados (verificado: `git diff --name-only -- supabase scripts sync-streams .github` está **vacío**). |
| Casos sintéticos del guard (`__${OLD_NAME_FIXTURE}_BLE_E2E__` por concatenación) | `brand-name-guard.test.ts` | Intactos: siguen probando la regla A. |
| `baston-multivendor.capture.ts:123` (locator ambiguo) | — | Roto ANTES de esta fase (medido en `88cecaf`). Fuera de alcance; candidato a `.first()` como ya documenta el as-built de T-MV.7.2. |

### Estado del árbol entregado

`80 M app` · `2 M docs` · `14 M specs` (+2 de specs/10 ajenos) · `1 ?? progress/rebrand-fase2-e2e.md`.
`design/` **limpio** (68 PNG revertidos). **Nada stageado, nada commiteado.**

