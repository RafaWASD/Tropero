baseline_commit: f518ea56b8dec3db34ec5e8427a6f1b95b0a858b

# impl 03 — M2.2 — Frame de carga rápida + resumen por animal + progreso

> Feature 03 MODO MANIOBRAS, chunk **M2.2** (frontend puro, backend done `0050-0057`). Gate 1 N/A;
> reviewer + Gate 2 después. Vertical slice DEMOABLE: identify (M2.1-core, done) → **carga rápida**
> (frame/engine de secuencia, dispatcher genérico por maniobra) → **tacto + pesaje** (spikes M2.0
> cableados a persistencia REAL con `session_id`) → **resumen por animal** (corregible) → **confirmar
> → siguiente animal + contador de progreso**. Todo OFFLINE.

## Plan (tasks del chunk M2.2)
- **T1 — Lógica pura de secuencia/resumen** (`app/src/utils/maneuver-sequence.ts` + test): build de la
  secuencia de pasos del animal en orden de `config.maniobras`, filtrando las que no aplican al rodeo
  real (R5.5, R5.14); estado de captura por maniobra; armado del resumen (R5.9); gate de "secuencia
  completa". PURO (sin RN), testeable node:test.
- **T2 — Dispatcher genérico de render por maniobra** (`maneuver-step-kind.ts` + test): clasifica cada
  ManeuverKind a un "tipo de UI" (`tacto` → binario+tamaño, `pesaje`/`pesaje_ternero` → keypad, resto →
  placeholder M3). PURO. Es el SEAM para que M3 enchufe las 10 sin reescribir el frame.
- **T3 — Esqueleto del orquestador de eventos** (`app/src/services/maneuver-events.ts` + test de shape):
  dado animal+sesión+maniobra+valor escribe el evento correcto con `session_id` (CRUD-plano offline,
  reusa events.ts). Arranca con tacto (addTacto) + pesaje (addWeight) + builders con session_id; M3.1 lo
  generaliza a las 10. Extensible.
- **T4 — Builders de evento con session_id** (`local-reads.ts`): `buildAddWeightInsert` /
  `buildAddTactoInsert` aceptan `sessionId` opcional (R5.11). No rompe los call-sites de la ficha
  (events.ts pasa null).
- **T5 — Frame/engine de carga rápida** (`app/app/maniobra/carga.tsx`): cablea el spike a real — lee
  sesión + animal (fetchAnimalDetail) + gating real (useManeuverGating), recorre la secuencia, render
  per-maniobra vía dispatcher, header de identidad real (R5.1/R12.4), persiste al confirmar cada paso
  (R5.11/R5.12 trigger), avanza paso a paso.
- **T6 — Resumen por animal** (`app/app/maniobra/_components/AnimalSummary.tsx`): al terminar, lista de
  maniobras capturadas + valor; tocar una vuelve a su paso (R5.9); confirmar → progreso.
- **T7 — Avance + progreso** (en carga.tsx): confirmar resumen → setSessionCounts (animales++) →
  volver a `identificar.tsx` con el sessionId (R5.10).
- **T8 — Pasos de maniobra cableados** (`_components/`): TactoStep (binario PREÑADA/VACÍA + tamaño si
  preñada, R6.2 §6.bis.2 paso 1; paso 2 tamaño es M3 → placeholder/solo paso 1) + PesajeStep (keypad,
  R6.9) + PlaceholderStep ("pendiente M3").
- **T9 — e2e** (`app/e2e/maniobra-carga.spec.ts`): identify→carga→tacto→pesaje→resumen→siguiente con
  persistencia verificable (re-fetch timeline muestra los eventos con session_id) + OFFLINE. Ajustar
  `maniobra-identify.spec.ts` (ya no aterriza en "PREÑADA" del spike). Capturas 412×915.

## Baseline para Gate 2
- `baseline_commit: f518ea56b8dec3db34ec5e8427a6f1b95b0a858b` (SHA previo a la 1ra task de M2.2; ver tope del archivo).

## DONE — as-built

### Archivos tocados
**Nuevos:**
- `app/src/utils/maneuver-step-kind.ts` (+`.test.ts`) — DISPATCHER puro: `stepKindFor` (ManeuverKind→StepKind) + `stepPersists`. El SEAM de M3.
- `app/src/utils/maneuver-sequence.ts` (+`.test.ts`) — secuencia (`buildSequence`=orden config ∩ aplicables, R5.14/R5.5), completitud (`isSequenceComplete`/`firstUncapturedIndex`), resumen (`summaryRows`/`describeStepValue`, R5.9), tipos `StepValue`/`CaptureMap`/`PregnancyStatus`.
- `app/src/utils/maneuver-event-query.ts` (+`.test.ts`) — `buildManeuverEventQuery` PURO: binding maniobra→INSERT/UPDATE con session_id (R5.11). 1ra captura INSERTA, corrección UPDATEA (mismo id).
- `app/src/services/maneuver-events.ts` — ESQUELETO del orquestador: `persistManeuverEvent` (I/O: arma el query puro + `runLocalWrite`). M3.1 lo generaliza.
- `app/app/maniobra/_components/{TactoStep,PesajeStep,PlaceholderStep,AnimalSummary}.tsx` — pasos cableados (reusan el lenguaje visual del spike M2.0) + resumen.
- `app/e2e/maniobra-carga.spec.ts` — 3 escenarios e2e (flujo completo / corrección / offline).

**Modificados:**
- `app/app/maniobra/carga.tsx` — de spike mock a FRAME REAL (secuencia + dispatcher + persistencia + resumen-modo + progreso).
- `app/src/utils/maneuver-config.ts` (+`.test.ts`) — `parseManeuverConfig` tolera string/objeto/**doble-encoding** (fix raíz, ver abajo).
- `app/src/services/powersync/local-reads.ts` (+`.test.ts`) — `session_id` en `buildAddWeightInsert`/`buildAddTactoInsert` (default null) + `buildUpdateManeuverWeight`/`buildUpdateManeuverTacto` (corrección).
- `app/src/services/{sessions,maneuver-presets}.ts` — `config: unknown` (el jsonb llega string u objeto).
- `app/app/_layout.tsx` — `maniobra/carga` SALE de `DEV_WEB_ROUTES` (ya es autenticada real; solo `maniobra/paso` queda spike).
- `app/e2e/{maniobra-identify,maniobra-spike}.spec.ts` — reconciliados al frame real (ya no aterrizan en "PREÑADA" del spike; el spike de tacto migró a `maniobra-carga.spec.ts`).
- `app/e2e/helpers/admin.ts` — oráculos `waitForServerWeightEventWithSession`/`waitForServerTactoWithSession` (verifican el evento subió CON session_id).
- `scripts/run-tests.mjs` — engancha los 3 unit nuevos.

### Mapa R → test
| R | Qué | Test |
|---|---|---|
| R5.1 (carga rápida: identidad+rodeo+categoría) | header real siempre visible | e2e `maniobra-carga` (header "Rodeo general · Vaquillona" + caravana legible) |
| R5.8 (guardar a medida) | persiste al confirmar cada paso | e2e (oráculos de server tras cada maniobra) |
| R5.9 (resumen corregible) | tocar maniobra → vuelve al paso, UPDATE no duplica | e2e `resumen corregible` (300→350) + unit `maneuver-event-query` (INSERT 1ra / UPDATE corrección) + `maneuver-sequence` (`summaryRows`) |
| R5.10 (avance + progreso) | confirmar → contador++ → siguiente | e2e `flujo completo` (vuelve a identificar, "Animal 2") |
| R5.11 (session_id en cada evento) | INSERT/UPDATE con session_id | e2e (oráculos `*WithSession`) + unit `maneuver-event-query` (session_id al final) + `local-reads` (builders) |
| R5.12 (created_by por trigger) | no se manda | unit `local-reads` (`doesNotMatch /created_by/`) + server-side (trigger 0043) |
| R5.14 (orden de config.maniobras) | secuencia en orden, omite no-aplican | unit `maneuver-sequence` (`buildSequence` respeta orden, omite, contador) + e2e (Tacto · 1 de 2 → Pesaje · 2 de 2) |
| R6.2 (tacto: empty/small/medium/large) | binario + tamaño, un único evento | e2e `flujo completo` (PREÑADA→CABEZA→large) + unit `maneuver-sequence`/`maneuver-event-query` (mapeo + INSERT tacto) + oráculo `waitForServerTactoWithSession('large')` |
| R6.9 (pesaje manual) | keypad → weight_events | e2e (teclear 412 → Confirmar) + oráculo `waitForServerWeightEventWithSession(412)` |
| R10.1 (offline) | secuencia + escrituras sin red → drenado | e2e `offline` (setOffline → carga → reconexión → eventos en Supabase con session_id) |
| R12.4 (identidad siempre visible) | header en paso y resumen | e2e + capturas |
| dispatcher genérico (SEAM M3) | tacto/pesaje cableados, resto placeholder | unit `maneuver-step-kind` (todas las maniobras resuelven a StepKind; M3 → placeholder) |

### Rutas de capturas (412×915)
- `design/maniobra-carga/carga-tacto.png` — carga rápida con IDENTIDAD REAL + paso tacto (PREÑADA/VACÍA).
- `design/maniobra-carga/carga-tacto-tamano.png` — paso 2 condicional (CABEZA/CUERPO/COLA).
- `design/maniobra-carga/carga-pesaje.png` — paso pesaje (keypad + display 412 kg).
- `design/maniobra-carga/resumen.png` — **resumen del animal** (Tacto: Preñada·Cabeza / Pesaje: 412 kg, corregibles).

### Dispatcher genérico + seam para M3
- `stepKindFor(maneuver)` clasifica a un `StepKind` (`tacto`/`pesaje`/`placeholder`). El frame (`ManeuverStep` en carga.tsx) hace un `switch(kind)`. **M3 enchufa una maniobra nueva agregando**: (1) su entrada en `STEP_KIND_BY_MANEUVER` (o un `StepKind` nuevo), (2) su `case` en el switch del renderer, (3) su rama en `buildManeuverEventQuery`. **El frame NO cambia.** Las 8 maniobras restantes + antiparasitario/antibiótico hoy caen en `placeholder` ("pendiente M3", se saltean sin persistir, no rompen la secuencia).
- El orquestador `maneuver-events.ts` es el esqueleto; su parte pura (`buildManeuverEventQuery`) ya distingue tacto/pesaje y deja `null` (no persiste) para el resto → M3.1 agrega las ramas.

### Bugs cazados y cerrados durante la implementación (camino al verde)
1. **`eventId` no-UUID** (`<profile>:<maniobra>`) → `22P02` al subir (el `id` es uuid). Fix: UUID estable por animal+maniobra en un ref.
2. **config jsonb DOBLE-ENCODING** (raíz del "sin maniobras tras sync"): la fila sincronizada baja con `config` = string JSON que CONTIENE otro string JSON escapado → el 1er `JSON.parse` daba un string, no un objeto → `{}`. Fix: `parseManeuverConfig` parsea una 2da vez si el 1er resultado es string (+ test).
3. **Corrección con upsert `ON CONFLICT`** → PowerSync no captura bien el upsert SQLite (el evento no subía). Fix: INSERT (1ra) vs UPDATE explícito (corrección), rastreados como PUT/PATCH.
4. **Remount del keypad al corregir**: la instancia de `PesajeStep` se reusaba con estado stale. Fix: `key` con nonce de entrada al paso.

## Autorrevisión adversarial (paso 8)
Pasada hostil sobre el propio código, buscando desviaciones del spec, bugs/edge cases, gaps de seguridad/offline/multi-tenant, tests que pasan por la razón equivocada:
- **Probé el flujo de verdad** (e2e): corrección desde el resumen (300→350, persiste el corregido sin duplicar — oráculo `waitForServerWeightEventWithSession(350)`); offline completo (red cortada toda la secuencia → reconexión → eventos en Supabase con session_id); el flujo feliz con persistencia verificada server-side (no solo UI).
- **Gap cazado y cerrado: sesión/animal no encontrados → spinner infinito.** Si `getSessionById` devolvía `value=null` (jornada borrada) o faltaba `sessionId`/`profileId` (llegada inválida a la ruta), el frame quedaba en "Abriendo el animal…" para siempre. Fix: error accionable ("La jornada ya no está disponible…" / "No se encontró el animal…"), no spinner colgado.
- **Tests que ejercen el path real, no por la razón equivocada**: los e2e verifican el SERVER (oráculos service_role `*WithSession` que exigen `session_id NOT NULL`), no solo el overlay/UI — el bug del doble-encoding y el del 22P02 los cazó el oráculo de server (la UI mostraba el dato local "bien" mientras el evento NO subía). El test de corrección verifica que el valor CORREGIDO (350) llega al server, no el original (300).
- **Multi-tenant**: el frame nunca hardcodea establishment_id; el gating es del `animal.rodeoId` (rodeo real del animal), el session_id de la jornada; el tenant-check (0056) + `created_by` (0043) los fuerza el server. Un animal de otro campo no llega al frame (identify lo saltea, R4.5).
- **Offline-first**: toda la secuencia + escrituras son CRUD-plano local (R10.1); el rechazo real de sync lo maneja uploadData (no el return del orquestador). El config de sesión se lee local (offline).
- **Edge "animal sin algún dato"**: `displayIdentity` cae tag→idv→visual→"—"; un rodeo que no habilita ninguna maniobra de la sesión → `EmptySequence` ("Sin maniobras para este animal" + "Siguiente animal", no frena la fila); `isSequenceComplete([], {})===true` (unit).
- **Doble-confirmación**: `confirmingRef` evita que el `setSessionCounts` + navegación corran dos veces.

## Reconciliación de specs (paso 9)
`design.md` actualizado al as-built M2.2:
- §6.bis.1: 4 notas AS-BUILT M2.2 nuevas (el FRAME en carga.tsx sin resumen.tsx separado / round-trip + fix doble-encoding del config / session_id + corrección INSERT vs UPDATE / eventId UUID).
- §6.bis.2: **RECONCILIACIÓN del mapeo de tamaño** — el design tenía CABEZA→small/COLA→large (invertido); el as-built (Facundo §4, `event-timeline.PREGNANCY_LABELS`) es **CABEZA→large, CUERPO→medium, COLA→small**. Corregido al as-built (fuente de verdad de campo). + decisión documentada: el paso 2 (tamaño) se hizo EN M2.2 (no diferido) para no persistir un tacto incompleto.
- §1.1 (árbol): `carga.tsx` = frame ✅; `resumen.tsx` NO se creó (resumen = componente `AnimalSummary` + modo del frame); `maneuver-events.ts` = esqueleto M2.2; lógica pura en utils nuevos.
- `tasks.md`: M2.2 marcada `[x]` con as-built + lo diferido a M3 explícito.
NO se reescribieron los EARS (el *qué* de R5.x/R6.2 no cambió; el mapeo de tamaño es una corrección de una nota de implementación, no del requirement — R6.2 ya listaba el enum sin atar el glifo es-AR).

## check.mjs
- **RC=0 (verde)** end-to-end: typecheck client + client unit (incl. los 4 archivos nuevos de M2.2) + anti-hardcode + suites backend (RLS/Edge/Animal/Maneuvers/user_private/operaciones_rodeo).
- e2e: `maniobra-carga` 3/3 + `maniobra-identify` 5/5 + `maniobra-spike` 1/1 + `maniobra-wizard` 1/1 (sin regresión).
- **NOTA del rojo ajeno de spec 12**: la tarea avisaba de un posible rojo de spec 12 (`import_rodeo_bulk`, desalineamiento test↔migración) — en este entorno NO se reprodujo (la suite de spec 12 no está en el RC actual o ya fue reconciliada por la terminal dueña); el check cerró verde sin él. NO es mío, no lo toqué.

## FIX de JERARQUÍA del header de identidad (veto design-review del leader, 2026-06-14)

> Fix PUNTUAL de jerarquía/consistencia en el `SpikeIdentityHeader` de la carga rápida (las 4 pantallas
> M2.2). NO toca la lógica de secuencia/persistencia/orquestador/resumen ni los tests funcionales — solo
> el WIRING de identidad + las capturas. El leader lo veteó con design-review.

### El bug (jerarquía + consistencia, R12.4 / Jakob)
Las 4 capturas lideraban con el **tag electrónico** (RFID 15 díg, truncado) como identidad DOMINANTE,
con idv/rodeo/categoría chicos. Mal por: (1) **operabilidad** — el operario verifica el animal por la
caravana VISUAL que lee en la oreja, NO por el RFID; el propio doc del header dice "el grande es la
verificación #1"; (2) **consistencia (Jakob)** — `identify-found.png` lidera con la caravana visual grande
("Caravana 0385") y el tag va muted abajo; la carga rápida lo invertía → inconsistente en el mismo flujo.

### Qué cambié (wiring de identidad)
- **`app/app/maniobra/carga.tsx`**:
  - `displayIdentity(a)` (líneas ~57-72): **invertí la prioridad** a `visual_id_alt → idv → (fallback)
    tag electrónico formateado → "—"`. Antes era `tag → idv → visual`. Ahora el GRANDE es la caravana
    VISUAL HUMANA (la que el operario lee), y el tag electrónico solo sube a dominante si el animal NO
    tiene ninguna caravana visual (fallback `formatEidReadable`).
  - **`mutedTag(a)` (nueva, líneas ~74-86)**: deriva el tag electrónico formateado para el slot MUTED, y
    devuelve `null` cuando el tag YA es la identidad dominante (sin visual ni idv) → no se repite abajo.
  - Call-site del `SpikeIdentityHeader` (líneas ~290-305): pasa `tagElectronic={electronicMuted}` además
    de `idv={identity}`.
- **`app/app/maniobra/_components/SpikeIdentityHeader.tsx`** (SÍ lo toqué, de forma mínima):
  - Nueva prop OPCIONAL `tagElectronic?: string | null` (slot muted, secundario). `paso.tsx` (spike mock,
    comparte el componente) NO la pasa → backward-compatible (la línea no se renderiza si no hay tag).
  - Render del tag MUTED debajo de la caravana ($3, lineHeight matching $3, letterSpacing 0,5 como
    identify-found), **color `$textMuted`** (NO `$textFaint`): el tag es CHICO ($3 ≈ texto normal), y
    `$textFaint` sobre `$surface` da **3,92:1** (< AA 4,5 para texto normal); `$textMuted` da **5,58:1**
    (AA pleno). La jerarquía la da el TAMAÑO/PESO (caravana $9 negro bold domina), no el lavado del color.
  - Doc/tipos actualizados (la prop `idv` ahora documenta "caravana VISUAL humana").

### Capturas (las 4, 412×915, identidad LIMPIA para el demo)
La data mock vieja confundía (idv `e2e_…`, rodeo con prefijo e2e, tag truncado como hero). Sembré identidad
limpia consistente con `identify-found.png`:
- **`app/e2e/helpers/admin.ts`**: `seedRodeo` acepta `rawName?: boolean` → nombre de rodeo SIN el prefijo
  RUN_TAG (SEGURO: el rodeo se borra por CASCADE del establishment trackeado por id; el barrido por nombre
  es solo de `establishments`, que conserva su RUN_TAG → la red de seguridad del cleanup NO se debilita).
  `seedEstablishmentWithRodeo` acepta `rodeoName`/`rodeoRawName`.
- **`app/e2e/maniobra-carga.spec.ts`** (test `flujo completo`): siembra rodeo **"Cría hembras"** (rawName) +
  animal con **`visualAlt: '0385'`** + **`categoryCode: 'vaquillona'`**. Aserciones de jerarquía nuevas:
  caravana **"0385"** dominante visible, **"Cría hembras · Vaquillona"** en la línea muted, y el tag
  electrónico **muted formateado** (`eidReadable(eid)`, helper inline — los e2e no importan de `src/`).
- Las 4 recapturadas → `design/maniobra-carga/{carga-tacto,carga-tacto-tamano,carga-pesaje,resumen}.png`:
  caravana visual "0385" GRANDE, tag electrónico "982 …" MUTED, "Cría hembras · Vaquillona" sin truncar.

### Flake del test de corrección cerrado (preexistente, NO de este fix)
El test `resumen corregible` (que NO toqué en lógica) falló determinísticamente: el bucle de borrado del
display (300→vacío) perdía taps por timing → no reescribía a 350 → resumen quedaba en "300 kg". Lo hice
DETERMINISTA (re-chequeo del display + `waitForTimeout(80)` entre taps + assert intermedio de "0"). Es un
flake de timing del keypad e2e, ortogonal al fix de identidad (el header no afecta el keypad). Cerrado para
dejar la suite verde.

### Autorrevisión del fix (ojo de diseñador, paso 8)
- **Las 4 capturas nuevas**: la caravana visual "0385" es CLARAMENTE el elemento dominante ($9/30px bold,
  negro) en las 4 pantallas; el tag electrónico es secundario (chico, muted, agrupado); rodeo·categoría sin
  truncar. CONSISTENTE con identify-found.png (mismo patrón caravana grande + tag muted) → Jakob OK.
- **Contraste medido (Pillow/WCAG)**: descarté `$textFaint` (3,92:1) por sub-AA en texto chico; usé
  `$textMuted` (5,58:1, AA). La jerarquía se sostiene por tamaño/peso, no por lavar el color.
- **Descendentes**: "Cría hembras · Vaquillona" (q, j) se ven completos (lineHeight matching $4); el tag
  muted lleva su lineHeight $3; la caravana $9. OK.
- **Fallback probado mentalmente**: animal sin visual ni idv → `displayIdentity` cae al tag formateado como
  GRANDE y `mutedTag` devuelve null (no repite el tag abajo). La prioridad visual > electrónico se respeta.
- **Backward-compat**: `paso.tsx` (spike mock) no pasa `tagElectronic` → la línea no se renderiza, el spike
  sigue idéntico. Typecheck verde lo confirma.
- **NO toqué** lógica de secuencia/persistencia/orquestador/resumen ni `maneuver-events.ts`/`PesajeStep`/
  `TactoStep`/`AnimalSummary` (salvo el bucle de borrado del e2e, que es del test).

### Reconciliación de specs (paso 9)
El fix cambió SOLO una decisión de presentación (orden visual del header) + agregó un slot opcional al
componente — el *qué* de R5.1/R12.4 no cambió (R12.4 ya pedía "la identidad que el operario verifica" como
dominante; el as-built previo la había mal-mapeado al RFID). `design.md` §6.bis.1 (notas as-built M2.2): se
agrega la nota de la **jerarquía de identidad del header** (caravana visual `visual_id_alt || idv` dominante
+ tag electrónico muted, espejando identify-found; fallback al tag formateado si no hay visual). NO se
reescriben los EARS (corrección de una nota de implementación, no del requirement). `tasks.md` M2.2 sigue
`[x]` (este fix es un ajuste de la misma task, no una task nueva).

## check.mjs
- **RC=0 (verde)** end-to-end: typecheck client + client unit (incl. los 4 archivos nuevos de M2.2) + anti-hardcode + suites backend (RLS/Edge/Animal/Maneuvers/user_private/operaciones_rodeo).
- e2e: `maniobra-carga` **3/3** (con la identidad limpia del fix + el bucle de borrado determinista) + `maniobra-identify` 5/5 + `maniobra-spike` 1/1 + `maniobra-wizard` 1/1 (sin regresión).
- **NOTA del rojo ajeno de spec 12**: la tarea avisaba de un posible rojo de spec 12 (`import_rodeo_bulk`, desalineamiento test↔migración) — en este entorno NO se reprodujo (la suite de spec 12 no está en el RC actual o ya fue reconciliada por la terminal dueña); el check cerró verde sin él. NO es mío, no lo toqué.
- **NOTA del EXIT 127 de Playwright en Windows**: `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` es un crash COSMÉTICO de libuv al CERRAR el proceso Node DESPUÉS de que los tests pasaron (`N passed`). NO es una falla de test.

## Pendiente
- reviewer + Gate 2 (security code, modo `code`, desde el baseline). Frontend puro → Gate 1 N/A.
- NO marco `done` en feature_list.json (espera al reviewer + Puerta final de Raf).
