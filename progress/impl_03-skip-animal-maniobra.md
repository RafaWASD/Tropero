baseline_commit: f41749ea8ca9555dad711a89db7c9aec383fcadf

# impl — delta `03-skip-animal-maniobra` (ítem C triage demo-facundo-padre)

> Delta-feature chica (ADR-028, Nivel A, frontend puro). Gate 1 N/A.
> Pedido (Facundo/productor): en la carga rápida de MODO MANIOBRA, un botón para **SALTEAR** un animal —
> no cargarle ninguna maniobra y seguir con el próximo. Hoy no existe.

## Feature en curso + plan (T1..Tn)

- **T1** — Util PURO `app/src/utils/maneuver-skip.ts`: `hasPersistedCaptures`/`countPersistedCaptures`
  (¿hay datos parciales cargados? + cuántos), `collectManeuverDiscardTargets` (junta las filas de evento a
  descartar por tabla, a partir del CaptureMap + los ids de cliente del frame; dientes EXCLUIDO — es UPDATE de
  propiedad de animal_profiles, no fila borrable), `buildManeuverEventSoftDeleteQuery` (soft-delete idempotente
  por id). + test node:test `maneuver-skip.test.ts`.
- **T2** — Service `discardManeuverEvents(targets)` en `app/src/services/maneuver-events.ts`: corre los
  soft-delete locales (offline, CRUD-plano) reusando `runLocalWrite`. Sin tocar el contrato de local-reads.
- **T3** — Componente `app/app/maniobra/_components/SkipAnimalSheet.tsx`: bottom-sheet de confirmación
  manga-friendly (tono adaptativo: liviano sin datos / aviso terracota con datos), fail-closed (si el descarte
  falla → no navega, superficia + reintenta). Molde ExitJornadaSheet/ConfirmDeleteSheet.
- **T4** — `SpikeIdentityHeader.tsx`: prop opcional `onSkip` → afordancia "Saltear" en la esquina sup-der del
  header (chip de progreso baja a la línea rodeo·categoría). Otros callers (spikes) intactos (onSkip ausente).
- **T5** — Wiring en `carga.tsx`: abre el sheet desde el header (oculto en EmptySequence); confirma → descarta
  (si hay datos) + vuelve a identify-first SIN incrementar el contador de animales procesados.
- **T6** — Reconciliar spec 03 (requirements R5.15 + design + tasks) + registrar el test en run-tests.mjs.
- **T7** — Capture file `app/e2e/captures/skip-animal-maniobra.capture.ts` (Gate 2.5; NO lo corro yo).

## DECISIÓN DE DISEÑO — confirmación + descarte (justificación)

**Afordancia**: esquina SUP-DER del header de identidad (Fitts: esquina, lejos del CTA de confirmar de cada
paso que está ABAJO → sin tap accidental contra la acción primaria). Pill ghost bordeado, texto alto-contraste
+ icono SkipForward. El chip "Animal N" convive a su lado. Consistencia (Jakob): el flujo YA usa "Saltar/Saltear"
para saltear un animal en el identify-first (OtherFieldHero/OtherRodeoSheet).

**Confirmación SIEMPRE (aun sin datos)**: elegí confirmar siempre — en la manga el operario trabaja con una
mano, guante, a veces barro/sangre; un tap accidental en un botón del header NO debe sacarlo del animal en curso.
El confirm cuesta 1 tap y previene el accidente (Nielsen #5 error prevention), consistente con ExitJornadaSheet
(siempre confirma salir). El TONO se adapta:
  - **Sin datos** (caso dominante del pedido — "no cargarle ninguna maniobra"): liviano, "No cargaste ninguna
    maniobra. Seguís con el próximo." Sin ícono de alarma.
  - **Con datos parciales**: aviso terracota (color de aviso del DS, no rojo de pánico), "Se descarta lo cargado
    (N maniobra/s) y seguís con el próximo."

**Descarte (por qué SÍ borro, y cómo)**: el frame persiste CADA maniobra al confirmarla (R5.8, per-step). Un
"saltear" que dejara esos eventos volvería a mostrar datos huérfanos en la ficha del animal saltado (contradice
"descarté"). Por eso saltear con datos parciales **soft-borra** las filas de evento que ESTE mismo frame escribió
para ESTE animal, por sus ids de cliente estables (eventIdsRef/extraIdsRef/customIdsRef) — mismo espíritu que el
soft-delete de vacunas huérfanas (softDeleteManeuverEvents): solo retira filas que la sesión acaba de escribir,
nunca cross-tenant. Offline-safe + idempotente (`deleted_at IS NULL`). La reversión de la transición de categoría
(tacto+ sobre vaquillona) la maneja el trigger 0046 (AFTER UPDATE OF deleted_at) al subir el soft-delete. **NO
incrementa** el contador de animales procesados (el animal NO se procesó).

**Excepción documentada — dientes**: la maniobra `dientes` NO es una fila de evento; es un UPDATE de propiedad
(`animal_profiles.teeth_state` + CUT). Revertirla fielmente necesita el estado PREVIO de teeth_state, que el
frame no transporta (AnimalDetail no lo trae) — setear NULL a ciegas podría BORRAR una observación real anterior.
Por eso `dientes` queda FUERA del descarte automático (la observación dentaria persiste). Es la única maniobra
de propiedad; el resto (todas las de evento + custom) SÍ se descartan. Edge raro (cargar dientes y después
saltear el mismo animal). Documentado; si se quiere revertir dientes, es follow-up (toca la capa de lectura).

**Fail-closed**: si el soft-delete local falla (excepcional — es un write SQLite offline), el sheet NO navega:
superficia un aviso accionable es-AR y deja reintentar (consistente con ExitJornadaSheet/ManeuverErrorBanner).

## Estado
- [x] T1 · [x] T2 · [x] T3 · [x] T4 · [x] T5 · [x] T6 · [x] T7

## Archivos tocados
- **NUEVO** `app/src/utils/maneuver-skip.ts` — util PURO (detección de datos + armado del descarte + soft-delete builder).
- **NUEVO** `app/src/utils/maneuver-skip.test.ts` — 16 casos node:test (incluye ejecución real con node:sqlite).
- **NUEVO** `app/app/maniobra/_components/SkipAnimalSheet.tsx` — bottom-sheet de confirmación (tono adaptativo, fail-closed).
- `app/src/services/maneuver-events.ts` — + `discardManeuverEvents(targets)` (soft-delete local offline).
- `app/app/maniobra/_components/SpikeIdentityHeader.tsx` — + prop opcional `onSkip` → afordancia "Saltear" (esquina sup-der; chip de progreso baja a rodeo·categoría). Callers sin `onSkip` (spikes) intactos.
- `app/app/maniobra/carga.tsx` — wiring: estado `skipSheetOpen` + `skippingRef`, handlers `onConfirmSkip`/`onSkipDone`, `onSkip` al header (oculto en secuencia vacía), render del sheet.
- `app/e2e/captures/skip-animal-maniobra.capture.ts` — capture Gate 2.5 (NO ejecutado por el implementer).
- `scripts/run-tests.mjs` — registrado `maneuver-skip.test.ts` en la suite unit.
- Specs: `requirements.md` (R5.15 + nota as-built), `design.md` (fila §Deltas posteriores), `tasks.md` (SK.1–SK.6).

## Trazabilidad — R5.15 → test
- **R5.15 (detección de datos parciales)** → `maneuver-skip.test.ts`: "sin capturas → 0/false", "una maniobra skipped NO cuenta", "capturas reales de fábrica + custom → cuenta ambas".
- **R5.15 (descarta lo cargado — armado)** → `maneuver-skip.test.ts`: "pesaje → weight_events", "tacto + inseminacion → reproductive_events (una tabla, dos ids)", "vacunación multi → sanitary_events con extras", "raspado → lab_samples (tricho+campylo)", "CE → scrotal_measurements; CC → condition_score_events", "custom → custom_measurements", "dedupe por tabla".
- **R5.15 (dientes excluido / skipped excluido)** → `maneuver-skip.test.ts`: "DIENTES se EXCLUYE del descarte", "skipped se excluye; un id ausente no agrega nada".
- **R5.15 (soft-delete idempotente)** → `maneuver-skip.test.ts`: "buildManeuverEventSoftDeleteQuery → UPDATE deleted_at guard", "EJECUCIÓN real (node:sqlite): soft-delete setea deleted_at y es idempotente".
- **R5.15 (afordancia + confirmación adaptativa + navegación sin contar)** → `app/e2e/captures/skip-animal-maniobra.capture.ts` (Gate 2.5): 01 header con "Saltear" / 02 sheet sin datos / 03 sheet con datos (terracota) / 04 vuelta a identify-first "0 hoy".

## Verificación
- `pnpm exec tsc --noEmit` → EXIT=0.
- `node --test` maneuver-skip + maneuver-sequence + maneuver-event-query + maneuver-step-kind + maneuver-applicability → **139/139** (16 nuevos). (NO corrí `check.mjs` completo ni e2e:build — fuera de scope por indicación.)

## Autorrevisión adversarial (paso 8)
Busqué activamente, como revisor hostil:
- **Regresión del flujo normal**: `onSkip` es prop OPCIONAL del header → los otros callers (tacto-spike/rueda-ce/paso) NO la pasan → layout ORIGINAL byte-idéntico (ProgressChip arriba, línea rodeo·categoría sin chip). `captureAndAdvance`/`onConfirmAnimal`/`onEdit` INTACTOS. ✔ confirmar cada paso sigue andando.
- **Skip sin datos** → `collectManeuverDiscardTargets` vacío → no descarta → navega directo (test "sin capturas"). ✔
- **Skip con datos parciales** → confirma (tono aviso) y descarta las filas de evento por ids del frame; navega SIN `setSessionCounts` (no cuenta el animal). ✔
- **Seguridad**: soft-delete por id (ids que el propio frame generó al persistir ESTE animal — no input de usuario), tabla de un allowlist de TIPO (sin injection); la RLS UPDATE owner|autor (0026/0027) es la barrera real al subir; idempotente (`deleted_at IS NULL`). No se hardcodea `establishment_id`. Fail-closed (si el write local falla, el sheet NO navega). ✔
- **Offline**: todo local (runLocalWrite + navegación); sin red. ✔
- **Transición de categoría**: soft-deletear el tacto la revierte vía trigger 0046 (AFTER UPDATE OF deleted_at) al subir. ✔
- **Doble-tap**: `skipping` (sheet) + `skippingRef` (frame) guardan contra doble descarte/navegación. Guard anti tap-through del scrim (web táctil). ✔
- **Hueco encontrado y ACEPTADO+DOCUMENTADO (no un bug silencioso)**: `dientes` es un UPDATE de propiedad (`teeth_state` + CUT/categoría), NO una fila de evento; revertirlo fielmente necesita el estado PREVIO que el frame no transporta (AnimalDetail no trae `teeth_state`; setear NULL a ciegas BORRARÍA una observación real anterior). Por eso queda FUERA del descarte → si el operario carga `dientes` (o dientes+CUT) y DESPUÉS saltea el mismo animal, esa propiedad persiste y el copy "se descarta lo cargado" no aplica a ese único ítem. Edge raro (dientes suele ir con el resto de la carga, no aislado-y-saltear). Documentado en R5.15 + reportado al leader; revertir dientes es follow-up (toca la capa de lectura para snapshotear el estado previo). El resto (todas las de evento + custom) SÍ se descarta.

## Reconciliación de specs (paso 9)
As-built = spec: agregué **R5.15** (requisito nuevo del "saltear animal") con su **nota as-built** en `requirements.md`; fila en `design.md §Deltas posteriores`; tasks SK.1–SK.6 en `tasks.md`. La decisión de diseño (descarte por soft-delete de las filas de evento del frame; dientes excluido; confirmación siempre; sin contar el animal) quedó reflejada tal cual se construyó. No hay contradicción entre código y specs.

## Nota para el leader (Gate 2.5 / Puerta 2)
- **Placement**: la afordancia "Saltear" con `minHeight="$touchMin"` hace crecer un poco la línea 1 del header en la carga (target manga grande). Vetalo visualmente con las capturas (01/03) — si preferís un target más chato, es 1 línea en `SkipAffordance`.
- **Semántica de descarte**: elegí DESCARTAR (soft-delete de las filas de evento) para que "se descarta lo cargado" sea VERDAD y no queden eventos huérfanos en la ficha de un animal saltado. La única excepción es `dientes` (arriba). Si preferís que saltear NO borre (solo navegue), es un cambio chico (no llamar `discardManeuverEvents`) + ajustar el copy del sheet.
