# impl — spec 03 Stream B / B1 (DESIGN-SPIKE del selector de meses de servicio)

baseline_commit: 11f1d1dfa558c4299d0161ad921f6772cc16a99e

> **RE-ITERACIÓN 2 (2026-06-23):** constraint nuevo de Raf — **UN solo período CONTIGUO por rodeo** (NO
> disjunto), con **wrap de fin de año**. El selector pasa de "toggle de meses" (iteración 1) a "período
> inicio→fin contiguo por construcción". Specs `RPSC.2.3/2.8/2.9` + Gate 0 §6 ya actualizados por el leader.
> Ver "Plan (tasks) — re-iteración 2", "Autorrevisión adversarial — RE-ITERACIÓN 2" y "Reconciliación de
> specs — RE-ITERACIÓN 2" más abajo. Las secciones marcadas "(HISTÓRICO)" son de la iteración 1.

## Qué es esto

**Design-spike del chunk B1** (Stream B del modelo reproductivo, delta de spec 03). "Visual antes de
plomería" (ADR-023, paridad con M2.0/M6-C.0): construir el componente reutilizable + la lógica pura +
capturas Playwright a 360/412 web táctil, para que el leader lo vete con `design-review` ANTES de
cablearlo al alta/edición real de rodeo.

**NO se cablea** a `create_rodeo`/`set_rodeo_service_months`/outbox/schema todavía (post-veto). Es
spike visual + lógica pura. Frontend puro → **Gate 1 N/A**. Gate 2 = se evalúa al cierre (lógica pura
+ componente display sin I/O → probablemente N/A; lo confirma el leader/security_analyzer).

**Pre-condición**: specs Stream B `spec_ready` + veto del leader PASS (requirements §VETO 2026-06-23);
feature 03 = `done` con Stream B trackeado bajo notas (patrón establecido por B4). Procedo por dispatch
explícito del leader (igual que B4 — ver `impl_03-streamB-b4.md`).

## Fuente de verdad

- `requirements-puesta-en-servicio-cliente.md` — **RPSC.2.1/RPSC.2.2/RPSC.2.3/RPSC.2.6** (alta:
  selector 12 meses + primavera pre-tildada + destildar libre + array 1–12 único) y **RPSC.3.2**
  (edición: "sin configurar" ≠ "no hace servicio", sin pre-tildar primavera).
- `design-puesta-en-servicio-cliente.md` — **§3.1 design-spike B1** (grid 12 meses + atajos +
  recorte de descendentes + dónde en el alta) + **DD-PSC-5** (componente reutilizable
  `ServiceMonthsSelector` + util puro `service-months.ts` con `SPRING_DEFAULT`/`parseServiceMonths`/
  `toServiceMonthsArray`/`isMonthChecked`).

## RE-ITERACIÓN 2 (2026-06-23) — CONTIGÜIDAD POR CONSTRUCCIÓN (constraint nuevo de Raf)

Constraint nuevo (firme, Raf 2026-06-23): **UN solo período CONTIGUO por rodeo** (NO disjunto), con **wrap
de fin de año** (Nov-Dic-Ene válido). El spike anterior permitía toggle de meses DISJUNTOS (Oct + Mar
separados) → ahora **prohibido**. Specs ya actualizadas por el leader: `requirements-puesta-en-servicio-
cliente.md` **RPSC.2.3/RPSC.2.8/RPSC.2.9** + `docs/modelo-reproductivo-puesta-en-servicio.md` §6. Rediseño
la selección manual de "toggle" → **período "inicio → fin" contiguo por construcción**.

### Decisión de interacción (la PRIMARIA del leader — inicio→fin con wrap)

Elegí la **opción primaria**: **tap = inicio del período; 2º tap = fin → se rellena el run HACIA ADELANTE
(orden de calendario, wrap-aware)**. Un 3er tap **reinicia** (nuevo inicio). Tap único = período de 1 mes.
Mantiene la **grilla 3×4** pura (a Raf le gustó el look) y es **imposible armar un set disjunto** desde la
grilla. Descarté la alternativa "inicio + duración (stepper)" porque NO hacía falta el desempate: la
ambigüedad que el leader anticipó del "hacia adelante" se resuelve con **feedback en vivo del estado de la
máquina** — un **resumen-guía** que mientras espera el 2º tap dice explícitamente "Tocá el mes de fin ·
Empezó en Oct", y un **chip-anchor con estado visual propio** (borde grueso $primary + fondo $greenLight)
que marca el inicio fijado. Con esa visibilidad (Nielsen #1), "hacia adelante con wrap" es predecible y no
necesita perder la grilla. El **label SIEMPRE** muestra el período resultante + conteo ("Servicio: Oct →
Dic · 3 meses" / "Nov → Ene · 3 meses") en ORDEN DE SERVICIO (no min/max).

### Cómo se garantiza la contigüidad POR CONSTRUCCIÓN

- La grilla NO togglea meses sueltos: cada par de taps produce `buildContiguousRun(inicio, fin)`, que SÓLO
  puede emitir un run conexo (probado: para los 144 pares inicio×fin, `isContiguousWrap` del resultado ==
  true; y `nextRangeSelection` sobre los 144 pares produce siempre contiguo). No hay camino desde la UI a un
  set disjunto.
- Los **atajos** (Primavera/Otoño/Todo/Ninguno) son todos contiguos (test: cada uno pasa `isContiguousWrap`).
- El `wrap` es trivial en la aritmética circular (módulo 12): `buildContiguousRun(11,1)→[1,11,12]`,
  `(12,2)→[1,2,12]`, vuelta completa `(10,9)→[1..12]`.

## Plan (tasks) — re-iteración 2

- [x] T1 — Rediseño de `app/src/utils/service-months.ts`: agregado `isContiguousWrap` (RPSC.2.9),
  `buildContiguousRun` (run inicio→fin con wrap), `serviceRunBounds` (extremos en orden de servicio),
  `describeServicePeriod` (label "Oct → Dic · N meses" / wrap / sin-config / disjunto-persistido), máquina
  pura de rango `initialRangeSelection`/`nextRangeSelection`/`applyShortcutSelection`/`isPendingAnchor`.
  **Eliminado `toggleMonth`** (permitía disjunto — incompatible con el constraint). `service-months.test.ts`
  reescrito → **82 casos** node:test (incl. wrap Nov-Dic-Ene, rechazo de disjunto, propiedad exhaustiva de
  contigüidad sobre los 144 pares). **82/82 verde.**
- [x] T2 — `app/app/_components/ServiceMonthsSelector.tsx`: grilla pasa a selección de período inicio→fin
  (estado local `anchor`); 3 estados visuales del chip (in/anchor/out); tarjeta de RESUMEN en vivo
  `PeriodSummary` (Nielsen #1, modo guía cuando hay anchor); pista de la interacción; atajos resetean anchor.
- [x] T3 — `app/app/maniobra/service-months-spike.tsx`: estado `custom` ahora es el WRAP (Nov→Ene); copy y
  comentarios al nuevo modelo. Comentarios "12 MESES" → "MESES" en `app/app/_layout.tsx` (route sin cambio).
- [x] T4 — `app/e2e/captures/service-months-spike.capture.ts`: **4 estados** (alta/sin-config/wrap/
  intermedio) × 360/412 + verificación TÁCTIL de la contigüidad (inicio→fin rellena el run, wrap) +
  anti-recorte del título. Capturas en `tests/stream-b/` (gitignoreado).
- [x] T5 — `check.mjs` verde end-to-end (`service-months.test.ts` ya registrado en `run-tests.mjs`).
- [x] T6 — Autorrevisión adversarial + reconciliación de specs + nota de cierre (este archivo).

## Plan (tasks) — iteración 1 (HISTÓRICO, superseded por la re-iteración 2)

- [x] T1 — `service-months.ts` (DD-PSC-5) + test (40 casos). [contrato base + toggle disjunto — superseded]
- [x] T2 — `ServiceMonthsSelector.tsx` (grid de chips toggle). [superseded: ahora período inicio→fin]
- [x] T3 — Spike route mock + registro `DEV_WEB_ROUTES` + `<Stack.Screen>`. [mantenido, copy actualizado]
- [x] T4 — Harness de captura (3 estados, 2/2 verde). [superseded: ahora 4 estados + verificación táctil]
- [x] T5 — Registro en `run-tests.mjs` + `check.mjs` verde.
- [x] T6 — Autorrevisión + reconciliación + nota de cierre.

## Archivos

**Creados:**
- `app/src/utils/service-months.ts` — lógica pura (DD-PSC-5 + helpers de presentación/atajos).
- `app/src/utils/service-months.test.ts` — 40 casos node:test.
- `app/app/_components/ServiceMonthsSelector.tsx` — componente reutilizable controlado.
- `app/app/maniobra/service-months-spike.tsx` — mock route del spike (DEV_WEB_ROUTES).
- `app/e2e/captures/service-months-spike.capture.ts` — harness de captura web táctil.

**Modificados:**
- `app/app/_layout.tsx` — `service-months-spike` en `DEV_WEB_ROUTES` + `<Stack.Screen>`.
- `scripts/run-tests.mjs` — `service-months.test.ts` en la lista de client unit tests.
- `specs/active/03-modo-maniobras/design-puesta-en-servicio-cliente.md` — nota AS-BUILT en §3.1.

**Capturas (gitignoreado, `tests/stream-b/`) — re-iteración 2:**
`alta-primavera-{360,412}.png` · `edicion-sin-config-{360,412}.png` · `custom-wrap-{360,412}.png` (Nov→Ene) ·
`intermedio-{360,412}.png` (inicio tocado, esperando el fin). *(La iteración 1 emitía `custom-nov-dic-ene-*`,
renombrado a `custom-wrap-*`; + el estado `intermedio-*` es nuevo.)*

## Mapa requisito → test (cobertura del spike)

> Nota: B1 es un **design-spike** (visual antes de plomería). Los `RPSC.x` de B1 NO se cierran acá — el
> *qué* (selector, primavera pre-tildada, sin-configurar, array 1–12 único) se cubre a nivel de **lógica
> pura + estado del componente + capturas**, no a nivel de persistencia (cableado = POST-VETO). El mapa de
> abajo es la cobertura ALCANZABLE en el spike.

| Requisito | Cobertura (test / captura) |
|---|---|
| RPSC.2.1 (selector de meses) | `service-months.test.ts` (ALL_MONTHS=1..12) + `service-months-spike.capture.ts` (grid 3×4 visible) |
| RPSC.2.2 (primavera pre-tildada en alta) | `SPRING_DEFAULT=[10,11,12]` test + captura `alta-primavera-*` (chips 10/11/12 `aria-pressed=true`, atajo Primavera activo, label "Oct → Dic · 3 meses") |
| **RPSC.2.3 (un período CONTIGUO; ninguno/los 12; NO disjunto; WRAP)** | `isContiguousWrap` tests (contiguo simple/wrap→true, disjunto→false, vacío/1/12) + `nextRangeSelection` (2 taps→run, wrap, 3er reinicia, fin==inicio→1 mes) + `describeServicePeriod` wrap "Nov → Ene" + `toServiceMonthsArray(Set())→[]` + `activeShortcutId([])→'ninguno'`/`(los 12)→'todo'` + captura `custom-wrap-*` + verificación táctil del run/wrap en el capture |
| **RPSC.2.8 (contigüidad POR CONSTRUCCIÓN — no validar-y-rechazar)** | `nextRangeSelection`: propiedad exhaustiva (los 144 pares inicio×fin → siempre contiguo) + `buildContiguousRun` (144 pares → `isContiguousWrap`==true) + atajos contiguos test + captura `intermedio-*` (estado anchor) + verificación táctil "inicio→fin rellena el medio" / "wrap no se pasa de largo" |
| **RPSC.2.9 (contigüidad en la lógica pura — `isContiguousWrap`, construcción del run, parse tolerante)** | `isContiguousWrap` (todos los casos del spec: contiguo, wrap, disjunto, vacío, 12, null) + `buildContiguousRun` + `serviceRunBounds` (round-trip) + `parseServiceMonths` tolerante (lee un disjunto histórico tal cual, no filtra — el enforce es del selector) |
| RPSC.2.6 (array 1–12 único, sin dup, en rango) | `toServiceMonthsArray` tests (ordena/dedup/filtra fuera de rango) + `buildContiguousRun` devuelve ordenado/único + `parseServiceMonths` filtra `[0,13,99]` |
| RPSC.3.2 (edición "sin configurar" ≠ "no hace servicio"; no pre-tildar primavera) | `activeShortcutId(null)→null` (NO resalta "Ninguno") + `isMonthChecked(null,*)→false` + `describeServicePeriod(null)→"Todavía sin configurar"` vs `([])→"No hace servicio"` + captura `edicion-sin-config-*` (banner + sin meses/atajos + resumen "sin configurar") |
| RPSC.3.7 (parseo tolerante del TEXT de PowerSync) | `parseServiceMonths` tests: TEXT JSON `[10,11,12]`, literal Postgres `{10,11,12}`, null/''/corrupto→null, `[]`→[], strings num, fuera de rango filtrado, no-array→null, NaN/Inf filtrados, disjunto histórico leído tal cual |
| design §3.1 recorte de descendentes | `assertTitleNotClipped` en la captura (bounding-box del título con '¿','q','j','g'), en los 4 estados |

## Autorrevisión adversarial — RE-ITERACIÓN 2 (contigüidad por construcción)

Pasada hostil sobre el rediseño contiguo (NO pasamanos):
1. **¿Hay ALGÚN camino desde la UI a un set DISJUNTO?** NO. El componente NO togglea meses sueltos: `onTapMonth`
   → `nextRangeSelection` (siempre `buildContiguousRun`), `onPickShortcut` → `applyShortcutSelection` (atajo
   contiguo). Eliminé `toggleMonth` por completo. **Probado exhaustivamente**: `nextRangeSelection` sobre los
   144 pares inicio×fin → `isContiguousWrap`==true siempre; `buildContiguousRun` sobre los 144 pares idem. La
   contigüidad es por construcción, no validar-y-rechazar (RPSC.2.8). **0 hallazgos.**
2. **¿El WRAP se rellena bien y NO se pasa de largo?** Verificado en aritmética circular (módulo 12) +
   round-trip `serviceRunBounds∘buildContiguousRun` (los extremos se recuperan, salvo los 12 que normaliza a
   {1,12}) + verificación TÁCTIL en el capture: inicio Nov → fin Ene rellena Nov/Dic/Ene y deja Feb FUERA
   (no rellena los 11 meses de Feb..Nov). **0 hallazgos.**
3. **Ambigüedad del "inicio→fin hacia adelante" (lo que el leader anticipó).** Resuelta con visibilidad
   (Nielsen #1): un **resumen-guía** que mientras espera el 2º tap dice "Tocá el mes de fin · Empezó en Oct"
   + un **chip-anchor** con estado visual propio (borde grueso $primary + fondo $greenLight, distinto del run
   lleno y del vacío). Verificado en `intermedio-*` por captura + aserción del aria-label "inicio del período".
   Por eso NO necesité caer a la alternativa "inicio+duración" (no perdí la grilla). **Cerrado por diseño.**
4. **Estado `anchor` stale si el `value` cambia desde AFUERA.** En el componente, todo cambio de `value` pasa
   por mis handlers (`onTapMonth`/`onPickShortcut`), que SIEMPRE setean `anchor` consistente. El único caso de
   `value` externo es el cableado real (post-veto) — ahí el caller que reemplace `value` debería remontar o
   resetear; lo anoto como nota para el cableado. En el spike (alcanzado siempre por `goto`/recarga completa)
   no aplica. **No es un bug del spike; nota para post-veto.**
5. **`chipState` precedencia anchor vs in.** Tras el 1er tap, el chip de inicio está EN el run (`value=[10]`)
   Y es el anchor → `chipState` chequea anchor PRIMERO → se ve como inicio-pendiente (no como run cerrado),
   que es lo correcto visualmente. Verificado por captura (aria-pressed=false + aria-label "inicio"). **OK.**
6. **`describeServicePeriod` con dato persistido DISJUNTO** (sólo viene de la DB, no de la grilla): devuelve
   "N meses (sin período definido)" sin inventar un rango falso; `serviceRunBounds`→null lo soporta. Test +
   `parseServiceMonths('[10,3]')→[3,10]` (lee tal cual, NO filtra — el enforce es del selector, RPSC.2.9).
   **OK.**
7. **Recorte de descendentes** ('¿','q','j','g','p'): `assertTitleNotClipped` en los 4 estados × 360/412.
   Inspección visual de las 8 capturas: título completo (1 o 2 líneas según ancho), labels "Jun/Jul" con la
   'j' completa, resumen sin recorte. **OK.**
8. **Densidad / grilla 3×4 a 360px** (angosto): inspección visual — la grilla holdea a 3 columnas, los atajos
   wrappean "Ninguno" a 2ª fila sin recorte, el resumen y el título entran. Una decisión por pantalla,
   manga-friendly. **OK.**
9. **No-cableado (restricción dura del leader).** Confirmado por `git status`: sólo los 5 archivos del spike
   (util + test + componente + route + capture) + `_layout.tsx` (solo comentarios). NO toqué `create_rodeo`/
   `set_rodeo_service_months`/`outbox.ts`/`upload.ts`/`schema.ts`/`rodeos.ts`/`crear-rodeo.tsx`/
   `editar-plantilla.tsx`/`feature_list.json`/otros `progress/`. **0 hallazgos.**

**Re-iteración 2: hallazgos abiertos = 0** (item 4 es una nota para el cableado post-veto, no un defecto del
spike). `check.mjs` verde end-to-end; capturas 2/2 verde (incl. aserciones táctiles del run/wrap).

## Autorrevisión adversarial — iteración 1 (HISTÓRICO)

Pasada hostil sobre mi propio trabajo (NO pasamanos):
1. **¿El componente cumple RPSC.2.2 (pre-tildado) por sí solo?** NO — es controlado; el default lo pone
   el caller. **Verificado correcto** contra DD-PSC-5 ("la lógica pura... default primavera es
   testeable"; el componente es el grid reutilizable). El spike pasa `SPRING_DEFAULT` en `mode='alta'`.
   Documentado en el JSDoc de props y en la nota as-built. No es un gap, es el diseño.
2. **`aria-pressed` no aparecía sobre el testID** (la 1ª corrida de captura falló). Causa: el testID
   estaba en el `View` interno y el a11y en el `Pressable` padre. **Cerrado**: moví el testID al
   `Pressable` (a11y + testID co-locados, y el tap target ES el Pressable). Re-build + re-run → 2/2.
3. **Edge cases del parseo** (NULL, '', corrupto, `[]`, `{}` literal Postgres, fuera de rango, dup,
   strings numéricas, NaN/Inf, no-array, los 12): todos cubiertos con test explícito. `parseServiceMonths`
   NUNCA tira (try/catch en el JSON.parse; todo lo demás es chequeo de tipo). Distingue `null`
   ("sin configurar") de `[]` ("no hace servicio") — la distinción LOAD-BEARING de RPSC.3.2.
4. **Inyección (focus Gate 2 §0)**: el parseo sale siempre `number[]` (cada elemento entero 1–12) o
   `null`; sin `eval`, sin interpolación a query. No-injectable. (Y es spike: nada cableado.)
5. **`sameMonthSet` tenía una rama muerta** (`if (lengths differ) return sb.length===0 && sa.length===0`
   → siempre false). **Cerrado**: simplificado a `return false` (comportamiento idéntico, más claro).
   Re-corrí los 40 tests → verde.
6. **"sin configurar" no debe resaltar "Ninguno"** (sería mentira: "no hace servicio"). Test explícito
   `activeShortcutId(null)→null` + captura `edicion-sin-config` lo verifica (`shortcut-ninguno`
   `aria-pressed=false`). Cerrado.
7. **360px (angosto)**: verifiqué la captura — el grid 3×4 holdea a 3 columnas; la fila de atajos
   wrappea "Ninguno" a 2ª línea (flexWrap, sin recorte); título wrappea a 2 líneas sin recortar
   descendentes. OK.
8. **No-cableado (restricción dura del leader)**: NO toqué `create_rodeo`/`set_rodeo_service_months`/
   `outbox.ts`/`upload.ts`/`schema.ts`/`rodeos.ts`/`crear-rodeo.tsx`/`editar-plantilla.tsx`. Verificado
   por `git status` (solo los 5 archivos nuevos + 3 modificados de spike/infra). El componente es
   import-only desde el mock route; ninguna pantalla real lo monta todavía.
9. **`feature_list.json` / otros `progress/`**: NO tocados (solo este impl + `current.md`).

**Hallazgos: 2 (item 2 testID, item 5 rama muerta) → ambos corregidos y re-verificados. 0 abiertos.**

## Reconciliación de specs — RE-ITERACIÓN 2

- **`requirements.md`** (`RPSC.2.3`/`RPSC.2.8`/`RPSC.2.9`): el *qué* (1 período CONTIGUO por rodeo, wrap, NO
  disjunto, contigüidad por construcción, `isContiguousWrap` en la lógica pura) ya lo **actualizó el leader**
  ANTES de este dispatch — no escribo EARS nuevos. Mi as-built cumple esos EARS al pie. Sin nota mía.
- **`design.md §3.1`**: **RECONCILIADO al as-built de la re-iteración 2**. Actualicé (a) las viñetas del
  spike (de "chips toggle tildables" → "período inicio→fin contiguo por construcción" + label en vivo +
  estado-anchor + wrap) y (b) el bloque AS-BUILT entero (nueva superficie de `service-months.ts` con
  `isContiguousWrap`/`buildContiguousRun`/`serviceRunBounds`/`describeServicePeriod`/máquina de rango;
  `toggleMonth` eliminado; componente con 3 estados de chip + `PeriodSummary`; 4 capturas; la decisión de
  UX inicio→fin y la nota para el cableado). El design ya **no miente** respecto del código.
- **`docs/modelo-reproductivo-puesta-en-servicio.md §6`**: actualizado por el leader (1 período contiguo +
  wrap). No lo toco (es del leader / Gate 0).
- **`tasks.md`** del delta Stream B: no tiene ledger de tasks B1 separado (las tasks B1 viven en este impl,
  marcadas `[x]` en "Plan (tasks) — re-iteración 2"). No se tocó.

## Reconciliación de specs — iteración 1 (HISTÓRICO)

- B1 es spike → los EARS `RPSC.2`/`RPSC.3` NO cambian (no se completan acá: el wiring es post-veto). No
  hay nota de reconciliación en `requirements.md` (el *qué* no cambió).
- `design.md §3.1`: agregada nota **AS-BUILT del design-spike B1** (componente + util + mock route +
  capturas + adiciones de presentación al contrato DD-PSC-5 + la decisión de UX que queda para el veto).
- `tasks.md` del delta Stream B: no tiene un ledger de tasks B1 separado.

## Estado — RE-ITERACIÓN 2 (contigüidad por construcción)

- **`check.mjs` VERDE end-to-end** (typecheck + anti-hardcode 0 + client unit incl. **service-months 82/82**
  + backend suites; exit 0 "Entorno listo"). Capturas **2/2 verde** a 360/412 (incl. aserciones TÁCTILES de
  la contigüidad por construcción + el wrap).
- **8 capturas** en `tests/stream-b/` (gitignoreado), 4 estados × 2 anchos: `alta-primavera-{360,412}` ·
  `edicion-sin-config-{360,412}` · `custom-wrap-{360,412}` (Nov→Ene) · `intermedio-{360,412}` (anchor). Los 2
  huérfanos de la iteración 1 (`custom-nov-dic-ene-*`) borrados. **Auto-veto del implementer = PASS** (inspección
  visual de las 8: grilla 3×4 mantenida, label en vivo correcto incl. wrap en orden de servicio, estado-anchor
  inconfundible, sin recorte de descendentes, densidad OK a 360).
- **Gate 1 N/A** (frontend puro, sin schema/RLS/Edge — design §0 + RPSC.8.4). **Gate 2** = lógica pura +
  componente display sin I/O/auth/inputs-externos/schema → mismo criterio que la iteración 1 y que M6-C.2
  (probablemente N/A; lo confirma el leader/security_analyzer). El parseo sale siempre `number[]` (entero 1–12)
  o `null` → no-injectable; nada cableado.
- **Cómo se garantiza la contigüidad por construcción** (resumen para el re-veto): la grilla NO togglea meses
  sueltos — cada par de taps emite `buildContiguousRun(inicio,fin)` (run conexo, wrap-aware) y los atajos son
  todos contiguos; eliminé `toggleMonth`. Probado con la propiedad exhaustiva sobre los 144 pares inicio×fin
  (`nextRangeSelection`/`buildContiguousRun` → `isContiguousWrap`==true siempre) + verificación táctil en el
  capture (inicio→fin rellena el medio; wrap Nov→Ene no se pasa a Feb). **Imposible armar un set disjunto desde
  la UI.**
- **Interacción elegida y por qué** (decisión del implementer, para el re-veto): **inicio→fin con wrap** (no
  inicio+duración) — mantiene la grilla 3×4 que a Raf le gustó, y la ambigüedad del "hacia adelante" se cierra
  con el **resumen-guía** ("Tocá el mes de fin · Empezó en Oct") + el **chip-anchor** visual (Nielsen #1), sin
  perder la grilla.
- **Pendiente**: **RE-VETO del leader (design-review)** sobre las 8 capturas de `tests/stream-b/` ANTES de
  mostrárselas a Raf. POST-VETO: el cableado real (B1 cableado) — `ServiceMonthsSelector` enchufado a
  `crear-rodeo.tsx` (alta) + `editar-plantilla.tsx`/`rodeos.tsx` (edición) por el camino offline
  (`createRodeo` con `p_service_months` + `enqueueSetRodeoServiceMonths` + `schema.ts` `service_months:
  column.text` + lecturas), con su propio reviewer + Gate 2. **NO marco done** (espero al reviewer/veto).
- **Observación de estado** (igual que B4): feature 03 = `done`, Stream B trackeado bajo notas; procedí
  por dispatch explícito del leader. El leader confirma el tracking de estado al cerrar.
