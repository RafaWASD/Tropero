baseline_commit: 0b10f52a41b699889e8e381bf20f0b166361347b

# impl — backlog flake `deriveCurrentState` (estado reproductivo determinístico)

Bugfix de backlog ACOTADO (ítem 2026-06-11 de `docs/backlog.md`). Frontend puro (TS + tests). NO toca
schema/RLS/Edge/migraciones → Gate 1 N/A. Una sola tarea. Reviewer + Gate 2 los lanza el leader.

## El bug
`deriveCurrentState`/`isNewerRepro` (`app/src/utils/event-timeline.ts`) desempataba el ESTADO
REPRODUCTIVO vigente (fila "Estado reproductivo: Preñada/Vacía") por `eventId` (UUID v4 RANDOM) cuando dos
eventos determinantes (tacto/birth/abortion) caían el MISMO `event_date` (columna `date`, sin hora) y
`created_at` faltaba/empataba. → ~50/50 → tras un parto/aborto el mismo día que el tacto, la ficha mostraba
"Preñada" en vez de "Vacía" la mitad de las veces. e2e `events.spec.ts` (parto/aborto) crónicamente flaky.

## Decisión de diseño — fuente del orden de inserción (y por qué es fiel al server)

El server sella `reproductive_events.created_at = now()` al insertar (= orden de subida = orden de
inserción local), SIN trigger de force (migración 0026 → `default now()`). El orden total a igualdad de
`event_date` es el `created_at`. El problema: en el momento del read conviven TRES formas de `created_at`:
- **NULL** — fila CRUD-plano (tacto/service/abortion) cargada local que todavía no subió (su created_at lo
  sella el server al SUBIR).
- **now() de CLIENTE** — el parto, que llega por el OVERLAY `pending_reproductive_events` (registerBirth ya
  le ponía un created_at de cliente).
- **now() de SERVER** — eventos ya sincronizados.

**Por qué el approach read-only puro NO alcanzó** (diagnosticado con un `console.log` temporal forwardeado
al stdout del e2e — ver "Diagnóstico" abajo): con el tacto CRUD-plano en NULL y el parto del overlay con
created_at de cliente, NI "null = más reciente" (haría ganar al tacto → "Preñada", el bug) NI "presente
gana" (rompe el caso simétrico: un aborto recién cargado NULL sobre un tacto synced presente) son
universalmente correctos. Un `seq` derivado de `ORDER BY created_at ASC` (NULLs-first) o de
`created_at IS NULL ASC` (NULLs-last) tampoco: la dirección del NULL es ambigua (puede ser el viejo-sin-sync
o el nuevo-sin-sync). **El único predictor fiel es el INSTANTE REAL de creación de cada evento.**

**Fix (dos cambios complementarios):**
1. **created_at de CLIENTE en los INSERT CRUD-plano de `reproductive_events`** (tacto/service/abortion):
   `events.ts` pasa `new Date().toISOString()`; los builders en `local-reads.ts` lo insertan. Así TODOS los
   determinantes repro (CRUD-plano + el parto del overlay) tienen un instante real de creación → el
   desempate por created_at es no-ambiguo y determinístico. **Fiel al server**: created_at es `default
   now()` sin force → el valor de cliente persiste, y es semánticamente MEJOR (instante de CREACIÓN en el
   dispositivo, fiel al orden de creación, vs el now() de SUBIDA para un evento cargado offline). No es un
   hueco de seguridad: created_at no es frontera de autorización (dato del propio tenant), análogo a que
   `event_date` ya lo aporta el cliente; `created_by`/`establishment_id` los SIGUE forzando el trigger.
2. **`seq` = orden de lectura de `buildTimelineQuery`** (`event_date ASC, created_at IS NULL ASC,
   created_at ASC`, en un SELECT externo que envuelve el UNION — un compound SQLite no acepta expresiones en
   el ORDER BY). `fetchTimeline` asigna `seq` = índice de fila; `isNewerRepro`/`parseTimeline` lo usan como
   desempate estable en vez del `eventId` random. Con (1) el caso realista es "ambos created_at presentes" →
   el seq sale del orden por created_at = orden de creación. El `created_at IS NULL ASC` (NULL al final) y el
   fallback por created_at en `isNewerRepro` quedan como defensa para una fila sin sellar / RPC sin seq.

Mismo espíritu que el espejo de categoría ya-probado (`buildCategoryMirrorEventsQuery` + `isAfter`,
RC6.1.4) pero llevado al determinismo total vía el created_at de cliente.

## Archivos tocados
- `app/src/services/events.ts` — `addTacto`/`addService`/`addAbortion` pasan `nowIso()` (created_at de
  cliente); helper `nowIso`; `fetchTimeline` asigna `seq` = índice de fila.
- `app/src/services/powersync/local-reads.ts` — `buildAddTactoInsert`/`buildAddServiceInsert`/
  `buildAddAbortionInsert` insertan `created_at` (nuevo arg + banner explicativo); `buildTimelineQuery`
  envuelve el UNION en un SELECT externo con el nuevo ORDER BY (NULLs-last) que produce el `seq`.
- `app/src/utils/event-timeline.ts` — `TimelineRow`/`TimelineItem` ganan `seq?`; `parseTimelineRow` lo
  propaga; `parseTimeline` desempate final por seq (luego eventId); `isNewerRepro` desempate primario por
  seq, fallback created_at (null=más reciente) → eventId.
- `app/src/utils/event-timeline.test.ts` — tests nuevos de los casos a igualdad de event_date (ambos
  presentes / uno null / ambos null + simétricos + fallback sin seq); helper `reproItemsWithCreatedAt` emula
  el seq del SQL.
- `app/src/services/powersync/local-reads.test.ts` — actualizados los 3 builder tests (arg created_at);
  guard del ORDER BY + wrapping; 2 tests de comportamiento contra node:sqlite (both-NULL insertion order +
  NULLs-last mixed).
- `docs/backlog.md` — entrada marcada ✅ RESUELTO (no borrada, trazabilidad).
- `specs/active/15-powersync/design.md` — nota de reconciliación as-built (los 2 cambios).

## Diagnóstico (cómo se encontró el approach correcto)
Las 2 primeras iteraciones (seq desde NULLs-first; luego "null=más reciente") DEJABAN el e2e rojo de forma
DETERMINÍSTICA en parto-después-de-tacto. Se agregó un `console.log('[DIAG repro]', ...)` temporal en
`deriveCurrentState` + un `page.on('console')` en el test, se rebuildeó y corrió 1 vez → reveló el estado
real: `birth {createdAt: "...16:08:05Z", seq:0}` + `tacto {createdAt: null, seq:1}`. Eso probó que el tacto
CRUD-plano quedaba NULL y el parto del overlay con created_at de cliente, y que ningún desempate read-only
sobre ese mix era universalmente correcto → de ahí el created_at de cliente en los INSERT. El DIAG y el
listener se REMOVIERON (verificado: `git diff` de `events.spec.ts` vacío; sin leftovers).

## Autorrevisión adversarial
- ¿Fiel al server en los 3 casos? Sí: con created_at de cliente, todos los determinantes tienen instante
  real → el posterior gana; el server preservará ese created_at (default now() sin force) en orden de
  creación. Verificado con e2e determinístico.
- ¿Algún consumidor de `parseTimeline` se rompe por cambiar el desempate final? No: `seq` es opcional
  (undefined → fallback eventId, comportamiento previo). `TimelineEvent.tsx`/`animal/[id].tsx`/
  `agregar-evento.tsx` solo LEEN campos del item. `applyReproMeta`/`resolveCategoryNames` preservan seq por
  spread. Tests a/b/c/d de orden de parseTimeline (sin seq, sin created_at) intactos.
- ¿El orden entre días/orígenes sigue intacto? Sí: el `event_date ASC` agrupa por día primero; el ORDER BY
  es solo para el `seq`, NO para la pantalla (parseTimeline re-ordena). Display no cambia (salvo, como
  efecto colateral correcto, que un evento repro cargado hoy ahora tiene created_at y ordena bien intra-día).
- ¿El caso created_at presente-vs-presente sigue ganando el mayor? Sí (seq derivado de created_at ASC; y el
  fallback por created_at también).
- Order-independence de `deriveCurrentState`: `isNewerRepro` es un orden total estricto (seq → created_at
  con null-first-wins → eventId, todos antisimétricos) → el máximo es único e independiente del orden de
  iteración (propiedad "NO confía en el orden" preservada).
- ¿Persistir created_at de cliente rompe el espejo de categoría / tacto+ vigente? No: `isAfter`/RC6.1.4
  ahora reciben un created_at real en vez de NULL → MÁS preciso; los RC6.1.4 unit tests (createdAt
  explícito) y el badge e2e ("Vaca segundo servicio") siguen verdes.
- Seguridad: created_at no cruza frontera de autorización (dato del propio tenant); created_by/
  establishment_id los sigue forzando el trigger; no se expone helper como RPC; sin cambios de RLS.

## Reconciliación de specs
- `specs/active/15-powersync/design.md`: nota as-built de los 2 cambios (created_at de cliente + ORDER BY/
  seq). Es donde vive `buildTimelineQuery` y el camino de escritura offline CRUD-plano (T5/T6).
- `specs/active/02-modelo-animal`: NO requiere cambio. El schema (created_at `default now()`) es el mismo;
  el cliente solo APORTA el valor (como ya aporta event_date). Es detalle de implementación de C3.2a
  (estado reproductivo en la ficha), sin alterar ningún EARS.
- `docs/backlog.md`: entrada ✅ RESUELTO.

## Verificación
- `pnpm typecheck` → 0.
- unit: `event-timeline.test.ts` 88/88, `local-reads.test.ts` 74/74, `animal-category.test.ts` 69/69.
- `node scripts/check.mjs` → exit 0 ("All tests passed").
- e2e `events.spec.ts` (dev build + DB beta remota, web estático en :8099):
  - `parto en hembra PREÑADA` (452) / `aborto` (509) / `parto NO preñada` (397): `--repeat-each=5` → 15/15
    VERDES (el `/^Vacía · /` ahora determinístico).
  - `parto con mellizos` (279): `--repeat-each=5` ×2 corridas → 10/10 VERDES. (En una corrida previa de
    repeat-each=4 cayó 1 vez en una aserción POSTERIOR no relacionada — `getByText('Madre')` en la
    navegación calf→madre del overlay, línea 364; el `/^Vacía · /` de la línea 342 pasó. Flake de overlay
    ajeno al estado repro y fuera de scope.)
  - `tacto (preñez media)` (190): verde.
  - Nota infra: el e2e Playwright corre contra la DB beta remota; cada corrida termina con un crash de
    teardown de libuv en Windows (`UV_HANDLE_CLOSING`, exit 127) DESPUÉS de reportar los resultados — NO es
    un fallo de test (todos los "ok"/"passed" se imprimen antes).

## Riesgo residual
- `events.spec.ts:279` tiene un flake APARTE en la navegación calf→madre (overlay) — ítem para el triage
  e2e (backlog item 3), NO el estado repro.
- El display-order test `bug 0069` (línea 639, fuera de scope) probablemente quede verde como efecto
  colateral (el servicio cargado hoy ahora tiene created_at de cliente → ordena arriba), pero NO lo
  verifiqué ni es mi tarea; lo dejo para el triage e2e.
- created_at de cliente depende del reloj del dispositivo a igualdad de event_date — aceptable (skew menor;
  mismo riesgo que el created_at de cliente que el overlay del parto ya usaba).

## NO marco done — espera reviewer + Gate 2 (lo lanza el leader).
