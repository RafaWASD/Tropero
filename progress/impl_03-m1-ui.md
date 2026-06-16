# Impl — Spec 03 Modo Maniobras — Chunk M1-UI (wizard de config de jornada)

baseline_commit: 6308ff5c1e806a007144d9b244a667767d0f735f

> Alcance de esta corrida: **task M1.4** del spec 03 — el **cliente del wizard** de MODO MANIOBRAS
> (inicio + 3 etapas), consumiendo los servicios de M1-SERVICIOS (done: sessions/maneuver-presets/
> maneuver-gating/maneuver-config). Backend done (0050-0057) — **NO se toca**. Frontend puro →
> **Gate 1 N/A**; reviewer + Gate 2 (code) después.
>
> `baseline_commit` = HEAD previo a la primera task de este chunk (6308ff5, commit del dedup A/B de
> BUSCAR ANIMAL). NO se reusa el baseline del archivo de feature (`impl_03-modo-maniobras.md`, fase
> backend) — ese diff ya está mergeado. Este chunk arranca limpio sobre `main`.

## Servicios consumidos (M1-SERVICIOS, sin tocarlos)

- `app/src/services/sessions.ts` — `createSession({ establishmentId, rodeoId, config })` (R1.9/R1.10/R1.11).
- `app/src/services/maneuver-presets.ts` — `fetchPresets(establishmentId)` (R2.2), `loadPreset(presetId, rodeoId)` → `{ maniobras, omitted }` (R2.3), `createPreset` (R2.1).
- `app/src/hooks/useManeuverGating.ts` + `app/src/utils/maneuver-gating.ts` — `filter(maniobras)` → `{ applicable, omitted }` (R1.4/R1.5), `ALL_MANEUVERS`, `ManeuverKind`.
- `app/src/utils/maneuver-config.ts` — shape `{ maniobras:[orden], preconfig:{} }` (R1.13, §2.1.1); `parseManeuverConfig`/`extractManeuvers` lo parsean de vuelta sin perder maniobras.
- `app/src/contexts/{EstablishmentContext,RodeoContext}` — establishment activo (NUNCA hardcodeado) + rodeos activos del campo (`fetchRodeos`, `active=true` + `deleted_at IS NULL`).

## Plan (tasks)

- **T1** — Inicio (`app/app/maniobra.tsx`): presets al tope (R2.2, tap arranca jornada desde preset + aviso de omitidas por gating R2.3) + CTA grande "Nueva jornada".
- **T2** — Etapa 1 Rodeo (R1.3): filas grandes de rodeos activos del establecimiento. Una decisión por pantalla.
- **T3** — Etapa 2 Maniobras (R1.4/R1.5/R1.7/R1.8/R1.12/R1.13): lista gateada por el rodeo (toggle on/off); las elegidas forman lista REORDENABLE por drag con handles visibles; preconfig texto libre + autocompletar.
- **T4** — Etapa 3 Resumen (R1.9): maniobras en el orden elegido + CTA "Arrancar jornada" → `createSession` con `config`.
- **T5** — e2e capture (patrón `baston.spec.ts` con login): navegar el wizard, capturar PNG 412×915 (inicio/etapa1/etapa2/etapa3) → `design/maniobra-wizard/*.png`.

## Archivos tocados (chunk M1-UI)

- `app/src/utils/maneuver-wizard.ts` (NUEVO) — lógica PURA: labels es-AR de las 10 maniobras + `moveManeuver` (drag) + `toggleManeuver` (orden de selección) + `buildJornadaConfig` (shape R1.13 §2.1.1) + `filterAutocomplete` (R1.8).
- `app/src/utils/maneuver-wizard.test.ts` (NUEVO) — 16 casos node:test (labels, reorder inmutable, toggle, config + round-trip serialize→extractManeuvers, autocomplete).
- `app/app/maniobra.tsx` (REESCRITO) — INICIO: presets al tope (R2.2) + CTA "Nueva jornada".
- `app/app/maniobra/jornada.tsx` (NUEVO) — WIZARD 3 etapas (rodeo / maniobras+reorder+preconfig / resumen) → createSession.
- `app/app/maniobra/_components/ManeuverReorderList.tsx` (NUEVO) — lista drag-reorder (gesture-handler + reanimated; handles `GripVertical` visibles).
- `app/app/_layout.tsx` — registro de la ruta `maniobra/jornada` (pantalla completa, autenticada).
- `app/e2e/maniobra-wizard.spec.ts` (NUEVO) — captura 412×915 + smoke del flujo (login + seed real).
- `scripts/run-tests.mjs` — enganchado `maneuver-wizard.test.ts` a la suite client unit.
- `specs/active/03-modo-maniobras/{tasks,design}.md` — M1.4 marcada done + reconciliación DM1-UI-1.

## Drag-reorder — cómo se implementó

NO hay lib de lista draggable en `package.json` (verificado: solo `react-native-gesture-handler ~2.31.1` + `react-native-reanimated 4.3.1` + `react-native-worklets`, ADR-013). Se construyó a mano:
- `Gesture.Pan()` (gesture-handler) montado SOLO en el handle (`GripVertical`) — un handle por fila, VISIBLE (R1.12; el resto de la fila no arrastra para no pelear con otras acciones).
- `useSharedValue`/`useAnimatedStyle` (reanimated) para el offset Y en vivo + elevación (zIndex/opacity) mientras se arrastra.
- Filas de ALTO FIJO (`ROW_HEIGHT=64`) → el índice destino se computa en `onEnd` como `index + round(translationY / ROW_HEIGHT)`, clamp `[0, n-1]` → `runOnJS(commit)` → `onReorder(from, to)` → el padre re-setea `chosen = moveManeuver(...)`.
- `GestureHandlerRootView` ya está en la raíz (`_layout.tsx`) → cross-platform (native + react-native-web). El cómputo del orden (`moveManeuver`) es PURO y testeado; el drag es la affordance.

## Orden persistido en config (R1.13) — confirmación

`onArrancar` arma `buildJornadaConfig(chosen, cleanPre)` con `chosen` = el array YA reordenado por el drag → `{ maniobras: [<orden>], preconfig }`. `createSession` lo serializa (JSON.stringify) tal cual (pass-through). El test `R1.13 round-trip` confirma que `extractManeuvers(JSON.parse(serialize(config)))` recupera el MISMO orden → la carga rápida (R5.14, M2) lo lee sin perder maniobras. Los tokens del array son `ManeuverKind` as-built (`tacto`/`raspado`/`pesaje`/`vacunacion`/`sangrado`/`inseminacion`/`condicion_corporal`/`dientes`/`tacto_vaquillona`/`pesaje_ternero`), NO data_keys.

## Mapa R<n> → test / evidencia

| R<n> | Cobertura |
|---|---|
| R1.2 (wizard 3 etapas, una decisión por pantalla) | e2e `maniobra-wizard.spec.ts` (inicio→etapa1→etapa2→etapa3, "Paso N de 3") + capturas |
| R1.3 (etapa 1: rodeos activos) | e2e (fila "Elegir rodeo …" del rodeo sembrado, `fetchRodeos` ya filtra active+deleted_at) + captura `etapa1.png` |
| R1.4/R1.5 (etapa 2: maniobras gateadas capa 1) | e2e (ofrece Tacto/Vacunación; **Inseminación NO** ofrecida → gating OFF por default cría) + captura `etapa2.png`; lógica `useManeuverGating.filter` (M1-SERVICIOS, ya testeada en `maneuver-gating.test.ts`) |
| R1.7 (preconfig de tanda) | UI `PreconfigField` (vacuna/pajuela texto libre); `buildJornadaConfig` incluye preconfig solo si tiene claves → test `incluye preconfig solo si tiene claves` |
| R1.8 (autocompletar usados antes) | `filterAutocomplete` tests (prefijo, dedup, excluir match exacto, límite); sembrado de presets del campo (DM1-UI-1) |
| R1.9 (etapa 3: persiste sesión + entra a carga) | e2e (Arrancar jornada → ya no en "Revisá la jornada"); `createSession` (M1-SERVICIOS) |
| R1.12 (drag-reorder con handles; orden = selección/preset) | e2e (handles `drag-handle-0/2` visibles, lista `maneuver-reorder-list`) + captura `etapa2.png`; `moveManeuver`/`toggleManeuver` tests (inmutable, orden de selección, fuera de rango) |
| R1.13 (orden persistido en config.maniobras) | `buildJornadaConfig` tests + **round-trip** (serialize→extractManeuvers preserva orden) |
| R2.2 (presets al tope del inicio) | e2e ("Tus rutinas" + inicio); `fetchPresets` (M1-SERVICIOS) + captura `inicio.png` |
| R2.3 (preset: maniobras omitidas avisadas) | UI `presetOmitted` InfoNote ("Se omitieron por la configuración del rodeo: …"); `loadPreset` (M1-SERVICIOS, ya testeado en `maneuver-config.test.ts`/`maneuver-reads.test.ts`) |

> Nota de cobertura: los **servicios** que consumo (gating/presets/sessions) ya tienen su unit suite (chunk M1-SERVICIOS); este chunk agrega la lógica PURA de UI (`maneuver-wizard.test.ts`, 16 casos) + el smoke/captura e2e del flujo. El drag físico no se simula en Playwright web (gesture-handler), pero el **resultado** (orden en config) está cubierto por el round-trip.

## Autorrevisión adversarial (paso 8)

Busqué, como revisor hostil:
- **Desviaciones del spec**: cada R de M1.4 mapeado arriba. ✓ Las maniobras del array usan `ManeuverKind` (no data_keys) y `extractManeuvers` las recupera sin pérdida (verificado por round-trip).
- **Gating**: confirmé en el e2e que **Inseminación NO se ofrece** en un rodeo de cría (su data_key `inseminacion` está OFF por default, 0018) → el filtro capa 1 funciona (R1.4/R1.5). El orden NO toca el gating (es presentación pura): `offered` se computa de `gating.config`, independiente de `chosen`/su orden.
- **Edge cases**: maniobras vacías → CTA "Continuar" deshabilitado + error en "Arrancar"; rodeo sin maniobras habilitadas → InfoNote; gating cargando/erroreado → InfoNote; config corrupto → `buildJornadaConfig`/`extractManeuvers` filtran/dedup sin romper (test); índices de drag fuera de rango → copia sin cambios (test). Cambiar de rodeo tras cargar preset re-resuelve el preset contra el rodeo nuevo (comportamiento correcto).
- **Recorte de descendentes**: medido en las 4 capturas — "Modo maniobras", "Revisá la jornada" (j), "Vacunación"/"Sangrado"/"Raspado de toros" (g/p), nombres de rodeo: todo con `lineHeight="$N"` matching, sin clip. Los datos de prueba traen descendentes a propósito.
- **Multi-tenant**: `establishmentId` SIEMPRE del `EstablishmentContext` (nunca hardcodeado); `rodeoId` del wizard; `createSession` fuerza `created_by`/`establishment_id` server-side (M1-SERVICIOS). ✓
- **Tests que pasan por la razón equivocada**: el e2e ejerce el path REAL (login + seed + servicios reales + gating real del rodeo sembrado), no un mock; verifica el REJECT del gating (inseminación ausente), no solo el happy path.
- **Lo que encontré y cerré**: (1) resumen de etapa 3 recortaba el rótulo "Rodeo" con nombres largos → reestructuré a label-arriba/valor-abajo. (2) `Platform` importado sin usar en jornada.tsx → removido. (3) `useMemo` de `offered` dependía del objeto `gating` entero (churn) → lo até a `gating.config`. (4) placeholders sucios `getTokenValue(...)?28:28` → limpiados. (5) lint anti-hardcode: padding crudo en `contentContainerStyle` de los ScrollView → `getTokenValue('$N','space')`. Re-verifiqué typecheck + lint verdes tras cada fix.

## Reconciliación de specs (paso 9)

- **DM1-UI-1 (decisión menor, reconciliada en `design.md` §6.bis.1 + `tasks.md` M1.4 as-built)**: el autocompletar de preconfig (R1.8) se siembra de los valores de preconfig YA usados en los **presets** del campo, en vez de una nueva query distinct sobre los eventos tipados (`sanitary_events.product_name` / pajuela de `reproductive_events`). Razón: (a) ese distinct-query cruzaría a la capa de servicios que M1-SERVICIOS cerró (nuevo SQL builder + service), fuera del scope frontend de M1-UI; (b) la pajuela no tiene columna tipada limpia en `reproductive_events`. El helper `filterAutocomplete` es source-agnóstico → M2/M3 enchufan una fuente más rica (valores cargados en la manga) sin reabrir esto. NO cambia el *qué* de R1.8 ("autocompletar a partir de los valores previamente cargados por el establecimiento") — los presets SON valores previamente cargados por el campo.
- `tasks.md` M1.4 marcada `[x]` con el as-built (archivos reales + la decisión DM1-UI-1).
- `design.md` §6.bis.1: la mención "react-native-draggable-flatlist o equivalente ya disponible" se reconcilia al as-built (NO había lib de lista draggable → construido con gesture-handler + reanimated, que SÍ están). Sin contradicción de comportamiento.

## Capturas (paths absolutos)

- `C:\DEV\RAFAQ\app-ganado\design\maniobra-wizard\inicio.png`
- `C:\DEV\RAFAQ\app-ganado\design\maniobra-wizard\etapa1.png`
- `C:\DEV\RAFAQ\app-ganado\design\maniobra-wizard\etapa2.png`
- `C:\DEV\RAFAQ\app-ganado\design\maniobra-wizard\etapa3.png`

## Estado

**DONE.** `node scripts/check.mjs` → **verde** ("Entorno listo", typecheck + anti-hardcode 0 viol. + tests verdes; el flake de rate-limit de la animal suite NO recurrió). e2e `maniobra-wizard.spec.ts` → **1 passed**, las 4 capturas 412×915 regeneradas (incl. etapa3 con el rótulo "Rodeo" arreglado). 16/16 unit tests de `maneuver-wizard.test.ts`. NO se tocó backend ni los servicios de M1-SERVICIOS. Pendiente: reviewer + Gate 2 (frontend puro → Gate 1 N/A).

---

## ITERACIÓN DE DISEÑO M1-UI (feedback de Raf, 2026-06-13) — 4 cambios de la etapa 2/1/3

Iteración VISUAL del wizard (no toca servicios de M1 ni backend). Consume los mismos servicios. Los 4 cambios:

### 1. Etapa 1/resumen — ícono de rodeo
`Layers` (ícono de LOTE → inconsistencia) → **`Group`** de lucide (glifo de "agrupación", distinto y propio). `Layers` queda reservado para LOTE (consistente con `rodeos.tsx`, donde `Layers` rotula la fila "Lotes"). Aplicado en etapa 1 (`StageRodeo`) y resumen (`StageSummary`).

### 2. Etapa 2 — LISTA UNIFICADA con drag "burbuja" (lo central)
`ManeuverReorderList.tsx` **reescrito**: UNA sola lista (Weverse "Change order"). Seleccionadas-arriba (número de orden + ✓ + grip, reordenables por drag) + pool-abajo (tap para sumar, con `+`). **Tap en una fila = toggle** (verde + ✓ cuando seleccionada). Reemplaza la v1 (dos bloques: toggles "Maniobras disponibles" + lista "Orden de la jornada" debajo) que empujaba las elegidas bajo el fold → el CTA las tapaba (BUG de Raf).
- **Drag burbuja**: por el grip (gesto inmediato) la fila se levanta — **escala 1.04 + sombra/elevación fuerte (`shadowOpacity 0.06→0.22`, `shadowRadius 12→18`, `elevation 2→12`) + esquinas más redondas (`$card`→`$pill` en frozen) + sigue el dedo 1:1**; hermanos reflow por springs; spring al soltar; **háptica** al agarrar y soltar.
- **Decisión: drag a mano (reanimated + gesture-handler), NO `react-native-draggable-flatlist`.** Razones: (a) la lib tiene soporte web POBRE y el e2e del wizard corre en react-native-web (Playwright) → rompería las capturas; (b) reanimated 4.3.1 / RN 0.85 / worklets 0.8.3 NO son targets soportados por la lib (peer-deps) y sumaría superficie de postinstall (onlyBuiltDependencies, ADR-011) por beneficio marginal; (c) lista chica y acotada (≤10 filas de alto fijo) → layout **absoluto** con un mapa `positions` worklet da control TOTAL del lift/sombra/reflow a 60fps **en el UI thread** y permite el **test hook** que congela el bubble para la captura. El cómputo del orden (`moveManeuver`) sigue PURO y testeado.
- **Háptica**: `app/src/utils/haptics.ts` (`hapticPickUp`/`hapticDrop`) vía `Vibration` de RN (import perezoso, web-safe, degrada en silencio) — el proyecto NO tiene `expo-haptics`; mismo idioma que `services/ble/feedback.ts`. (Raf pidió expo-haptics; reconciliado al patrón in-repo para no sumar dependencia/postinstall — el efecto háptico es el mismo.)
- **FIX del CTA**: las seleccionadas-arriba están SIEMPRE a la vista; el CTA "Continuar (N)" es sibling pinneado en el flex (NO absolute → reserva su propio alto, no solapa). Verificado en `etapa2.png` (las 3 seleccionadas visibles + CTA debajo).
- Orden persiste igual que antes (`onReorder`→`moveManeuver`→`buildJornadaConfig`→`config.maniobras`); round-trip ya testeado.

### 3. Etapa 3 — strings de preconfig + CTA
- Cada maniobra del resumen muestra su **detalle de preconfig** (`maneuverDetail` PURO + 6 tests: string/objeto products[]/escalar conocido/vacío/no-entendido → null). Ej. "Brucelosis" bajo "Vacunación" (verificado en `etapa3.png`).
- CTA "Arrancar jornada": **emphasis confiado pero no gigante** — `ArrancarCTA` propio (64px vs $touchMin=56) + ícono ▶ (`Play`) leading + verde botella. NO botones gigantes (esta pantalla es de VERIFICACIÓN, no carga rápida).

### Captura del bubble (test hook)
`?dragFreeze=<i>` (param de ruta) congela la fila `i` en estado burbuja → `etapa2-drag.png` (la fila #2 "Tacto" levantada con lift/sombra). La fluidez real se siente en vivo (anotado): gesto + reflow en el UI thread; el frame estático muestra el lift/sombra/escala.

### Autorrevisión (paso 8) — esta iteración
Adversarial, busqué:
- **Orden persiste (round-trip)**: `onReorder(index, myPos)` → `moveManeuver` → `config.maniobras`; round-trip test sigue verde. El commit del drag usa `index` (React, pre-commit) como `from` y la posición visual final como `to`. ✓
- **Coordenadas del drag**: todas las filas son `position:absolute` en top:0; la Y sale 100% del `translateY` = visualIndex*ROW_HEIGHT. Activa = `index*ROW_HEIGHT + dragY` (1:1); reposo = `withSpring(pos*ROW_HEIGHT)`. Sistema consistente (no doble-offset). ✓
- **Re-seed sin clobber**: el `positions` se re-siembra por `useEffect` keyed en `chosen.join(',')` (no en el render body) → NUNCA dispara mid-drag (el padre no re-renderiza mientras se arrastra). ✓
- **Gesto grip vs tap de fila**: tap en el grip NO debe deseleccionar → el grip usa `Gesture.Race(pan, tapSwallow)` (traga el tap). El pan y el tap son mutuamente excluyentes por naturaleza (mover descalifica el tap). ✓
- **CTA no tapa la lista**: seleccionadas-arriba + CTA en flex flow (no absolute). ✓ (`etapa2.png`).
- **Descendentes**: "Sangrado (brucelosis)", "Condición corporal", "Vacunación", "Raspado de toros", "Arrancar jornada" (j) → todo `lineHeight` matching, sin clip (medido en las capturas). ✓
- **Targets ≥56px**: selected rows = ROW_HEIGHT-8 = 56; pool rows = $touchMin (56); CTA = 64. ✓
- **Lint anti-hardcode**: VERDE (0 viol.). Único disable justificado: `left:0/right:0` del absolute-fill (geometría estructural, no spacing themeable).
- **Tests por la razón correcta**: el e2e ejerce el path real (gating real → inseminación ausente = reject; pool→selected real; detalle de preconfig real "Brucelosis"); el drag físico no se simula en web pero el RESULTADO (orden) está cubierto por `moveManeuver` + round-trip.
- **Lo que encontré y cerré**: (1) escritura del shared value `positions` en el render body → movido a `useEffect`. (2) tap en el grip deseleccionaba → `Gesture.Race` que traga el tap. (3) `Platform` no importado en jornada.tsx (lo usa `ArrancarCTA`) → importado. (4) `left:0/right:0` flagueado por el lint → disable justificado (absolute fill).

### Reconciliación de specs (paso 9) — esta iteración
- `design.md` §6.bis.1 **reescrito** al as-built v2 (lista unificada + drag burbuja + decisión NO-draggable-flatlist + test hook `dragFreeze` + ícono `Group` + detalle de preconfig + CTA con ▶). El *qué* (R1.4/R1.5 selección, R1.12 drag-reorder con handles, R1.9 resumen) NO cambia → sin reescritura de EARS; R1.12 sigue siendo "drag-reorder con handles" (el grip ES el handle). La v1 (dos listas separadas) se marca explícitamente como reemplazada (el bug del CTA que la motivó queda documentado).
- `tasks.md` M1.4 → nota **as-built v2** con los 4 cambios + archivos nuevos (`haptics.ts`, `maneuverDetail`).
- Sin cambios de comportamiento de datos/contrato (config jsonb pass-through intacto). Háptica reconciliada a `Vibration` (no expo-haptics) — documentado arriba.

### Verificación — esta iteración
`node scripts/check.mjs` → **verde** (typecheck + anti-hardcode 0 viol. + 1121 tests pass, incl. los 6 nuevos `maneuverDetail`). e2e `maniobra-wizard.spec.ts` → **1 passed** (el exit code 3221226505 es ruido de teardown de libuv en Windows, NO un fallo del test — "1 passed" explícito). **5 capturas** 412×915 regeneradas: `inicio/etapa1/etapa2/etapa2-drag/etapa3.png`. NO se tocó backend ni servicios de M1. Pendiente: veto del leader (design-review) + reviewer + Gate 2.

### Capturas (paths absolutos) — esta iteración
- `C:\DEV\RAFAQ\app-ganado\design\maniobra-wizard\inicio.png`
- `C:\DEV\RAFAQ\app-ganado\design\maniobra-wizard\etapa1.png`
- `C:\DEV\RAFAQ\app-ganado\design\maniobra-wizard\etapa2.png`
- `C:\DEV\RAFAQ\app-ganado\design\maniobra-wizard\etapa2-drag.png` (estado burbuja)
- `C:\DEV\RAFAQ\app-ganado\design\maniobra-wizard\etapa3.png`

---

## ITERACIÓN UX 2 — FIX (feedback de Raf, 2026-06-14) — 4 arreglos del wizard

> Fix de UX sobre M1-UI. **NO toca servicios de M1 ni backend.** Solo el wizard + un registro de iconos
> + swap de iconos en pantallas que hoy usan rodeo/lote inline.

### Plan (tasks)
- **T1 — Registro de iconos** (single source of truth, pedido de Raf): nuevo `app/src/theme/icons.ts`
  que re-exporta lucide con nombres semánticos de entidad (`RodeoIcon=Boxes`, `LoteIcon=Layers`,
  `CampoIcon=Building2`, `AnimalIcon=PawPrint`, `MiembroIcon=Users`, …). Migrar consumidores:
  `jornada.tsx` + `index.tsx` + `mas.tsx` + `lotes.tsx` (SOLO swap de iconos, visualmente idéntico).
  Verificado: index/mas/lotes están limpios en el working tree (sin cambios de otra terminal) → safe.
- **T2 — Ícono de rodeo en jornada**: etapa 1 + resumen `Group`→`RodeoIcon`(=Boxes). (Folded en T1.)
- **T3 — Etapa 2 scroll + bounds + auto-scroll**: la lista absoluta rompía el scroll del padre → la 9na
  maniobra + pool + preconfig + CTA quedaban inalcanzables. Arreglo: scroll del padre funciona (swipe
  normal scrollea), drag grip-gated (`activeOffsetY`) para no robar el swipe, auto-scroll cerca del
  borde, drag clampeado a la región de seleccionadas.
- **T4 — Etapa 3 scroll**: resumen scrollable con CTA pinneado.
- **T5 — Capturas**: re-capturar las 5 + agregar `etapa2-scroll.png` (8 maniobras, scrolleado al pool+CTA).

### As-built (UX 2)

**T1/T2 — Registro de iconos + ícono de rodeo.** Nuevo `app/src/theme/icons.ts`: re-exporta lucide con
nombres de ENTIDAD — `RodeoIcon=Boxes`, `LoteIcon=Layers`, `CampoIcon=Building2`, `AnimalIcon=PawPrint`,
`MiembroIcon=Users` (+ doc del porqué: antes cada pantalla importaba el glifo suelto y se desincronizaban;
ahora cambiar el ícono de una entidad = 1 línea). Migrados (solo swap de iconos, byte-idéntico al glifo
previo): `jornada.tsx` (`Group`→`RodeoIcon` en etapa 1 + resumen = fix del bug de Raf), `app/(tabs)/index.tsx`
(`Boxes`/`Layers`/`Building2`→registro), `app/(tabs)/mas.tsx` (`Boxes`/`Layers`/`Building2`/`Users`→registro),
`lotes.tsx` (`Layers`→`LoteIcon`). Verificado: los 3 archivos de pantalla estaban LIMPIOS en el working
tree (sin cambios de otra terminal) → safe para migrar. No quedan referencias a los glifos crudos en ellos
(grep limpio). `rodeo/[id].tsx` y `lote/[id].tsx` también usan `Boxes`/`Layers` inline pero NO estaban en
el scope de los 4 (los dejé como están — candidatos de follow-up para completar el registro; no rotos).

**T3 — Etapa 2 scroll + bounds + auto-scroll** (`jornada.tsx` + `ManeuverReorderList.tsx`).
- **Scroll (bug crítico)**: la etapa 2 (y todas) pasó de la `ScrollView` de tamagui a un `Animated.ScrollView`
  (reanimated, `useAnimatedRef` + `useScrollOffset` — ambos con impl web) dentro de un host `RNView flex:1`
  que mide el viewport con `measureInWindow` (`onLayout`). Un **swipe vertical normal SCROLLEA** → la 9na
  maniobra + el pool + el "Detalle de la tanda" + el CTA "Continuar" son alcanzables (eran inalcanzables).
- **Drag grip-gated**: el `Gesture.Pan` del grip ahora `.activeOffsetY([-8,8])` + `.failOffsetX([-8,8])` →
  un swipe normal va al ScrollView (scroll), solo agarrar el grip y cruzar el umbral vertical inicia el reorder.
- **Auto-scroll**: `useFrameCallback` (UI thread) desplaza el ScrollView con `scrollTo` mientras el dedo está
  en la zona de borde (`EDGE_ZONE=72`); la dirección la setea el `onUpdate` del Pan comparando `e.absoluteY`
  contra el viewport medido. El cómputo del destino del reorder **compensa el scroll** (offset al iniciar vs
  actual) para que el ítem siga al dedo aunque el contenido se mueva. Guardado contra viewport sin medir
  (height<=0 → no auto-scroll, evita scroll-abajo espurio).
- **Bounds (clamp)**: `dragY` se clampea a `[-index*ROW_HEIGHT, (total-1-index)*ROW_HEIGHT]` → el top del ítem
  ∈ `[0, (total-1)*ROW_HEIGHT]` → nunca sube arriba del título "En la jornada" ni baja al pool. El bubble
  (lift/sombra/spring/háptica) de la v2 se mantiene, ahora dentro de los bounds.

**T4 — Etapa 3 scroll**: el resumen vive en el mismo `Animated.ScrollView`; con muchas maniobras scrollea y
el CTA "Arrancar jornada" queda **pinneado** (sibling fuera del scroll).

### Mapa R<n> → evidencia (UX 2)

| R<n> | Cobertura (UX 2) |
|---|---|
| R1.2 (wizard 3 etapas, una decisión por pantalla) | sin cambio de comportamiento; e2e re-pasa el flujo inicio→1→2→3 + las 6 capturas |
| R1.4/R1.5 (etapa 2: selección gateada) | sin cambio (gating intacto); e2e: inseminación ausente del pool; con 8 elegidas la 9na queda en pool |
| R1.9 (etapa 3: resumen + persiste) | sin cambio de datos; ahora scrolleable con CTA pinneado; e2e "Brucelosis" bajo "Vacunación" + arranca crea sesión |
| R1.12 (drag-reorder con handles; orden) | grip-gated Pan + bounds clamp + auto-scroll; orden = `moveManeuver` (PURO, ya testeado); captura `etapa2-drag.png` (bubble) |
| R1.13 (orden persistido en config) | sin cambio: round-trip `serialize→extractManeuvers` sigue verde; `buildJornadaConfig` intacto |
| Íconos de entidad (single source) | `app/src/theme/icons.ts` consumido por jornada/index/mas/lotes; captura `etapa1.png`/`etapa3.png` muestran `Boxes` (rodeo) |
| Scroll etapa 2 (fix UX) | e2e: 8 maniobras → `scrollIntoViewIfNeeded` al pool → "Sumá más maniobras" + "Continuar (8)" visibles; captura `etapa2-scroll.png` |

### Autorrevisión adversarial (paso 8) — UX 2

Busqué, como revisor hostil:
- **Swap de iconos rompe algo**: grep confirmó CERO referencias residuales a `Boxes/Layers/Building2/Users/Group`
  en index/mas/lotes (todo via registro); typecheck verde (un import huérfano lo flaggearía). Visualmente
  idéntico (el registro re-exporta el MISMO glifo lucide que ya usaban).
- **`single source` sobre-vendido**: NO. `rodeo/[id].tsx` y `lote/[id].tsx` siguen con lucide crudo (fuera del
  scope de los 4) → lo documento explícito como follow-up, no afirmo cobertura total.
- **Auto-scroll espurio**: ENCONTRÉ y CERRÉ un bug latente — si `measureInWindow` no corrió (viewportHeight=0),
  `bottom-EDGE_ZONE` sería negativo y `e.absoluteY > -72` siempre true → scroll-abajo perpetuo. Agregué guard
  `height<=0 → autoScrollDir=0`. Re-verifiqué check + e2e.
- **Bounds visual vs lógico consistente**: `dragY` clampeado a la región; `newPos` clampea a `[0,total-1]`. Si
  el dedo se va muy abajo, el ítem se queda en la última fila (visual) y newPos=total-1 (lógico). Coherente.
- **Grip-gate no rompe el reorder**: el umbral de 8px (<ROW_HEIGHT/2=32) no causa reorder espurio inicial;
  `e.translationY` mide desde el touch start → el umbral está incluido en el desplazamiento.
- **`useFrameCallback` siempre activo**: corre 60x/s pero el early-return (`autoScrollDir===0`) es ~gratis
  (una lectura de shared value). Aceptable; no justifica complejidad de setActive.
- **Drag físico + auto-scroll NO se ejercen en web e2e**: igual que la v2 (gesture-handler no se simula en
  web). Lo PROBADO por el e2e: (a) el ScrollView scrollea (el bug core), (b) la lista no rompe con 8 elegidas,
  (c) el bubble renderiza (`dragFreeze`). El feel de auto-scroll/grip-gate se valida por review + nativo. Honesto.
- **Descendentes**: "Sangrado (brucelosis)", "Condición corporal", "Vacunación", "Raspado de toros", "Tacto
  vaquillona", "Arrancar jornada" (j) → todo `lineHeight` matching, sin clip (medido en `etapa2-scroll.png`).
- **CTA pinneado real**: en etapa 2 y 3 el CTA es sibling fuera del `Animated.ScrollView` → no solapa, reserva
  su alto. Confirmado en `etapa2-scroll.png` (Continuar 8) y `etapa3.png` (Arrancar jornada).
- **No toqué servicios M1 ni backend**: solo `jornada.tsx` + `ManeuverReorderList.tsx` + nuevo `theme/icons.ts`
  + swap de iconos en index/mas/lotes + e2e. createSession/loadPreset/gating intactos.

### Reconciliación de specs (paso 9) — UX 2

- `design.md` §6.bis.1: actualizada — ícono de rodeo `Group`→`RodeoIcon`(=`Boxes`) vía registro `@/theme/icons`;
  agregado **as-built v3** (scroll + bounds + auto-scroll de la etapa 2 + scroll de la etapa 3 + registro de
  iconos). El *qué* (R1.4/R1.5/R1.9/R1.12/R1.13) NO cambia → sin reescritura de EARS en `requirements.md`
  (cambio puramente de diseño/presentación, como la v2).
- `tasks.md` M1.4: nota **as-built v3** + Archivos actualizados (registro de iconos + pantallas migradas +
  `etapa2-scroll.png`). M1.4 sigue `[x]`.
- Sin cambios de comportamiento de datos/contrato (config jsonb pass-through, gating, createSession intactos).

### Verificación — UX 2

`node scripts/check.mjs` → **verde** (typecheck + anti-hardcode 0 viol. + tests verdes — TODAS las suites
incl. operaciones-rodeo 22/22; el flake de rate-limit NO recurrió). e2e `maniobra-wizard.spec.ts` → **1 passed**
(el `Assertion failed ... uv_handle` final es el ruido conocido de teardown de libuv en Windows, NO un fallo).
**6 capturas** 412×915 regeneradas: `inicio/etapa1/etapa2/etapa2-scroll/etapa2-drag/etapa3.png`. NO se tocó
backend ni servicios de M1. Pendiente: veto del leader (design-review) + reviewer + Gate 2.

### Capturas (paths absolutos) — UX 2
- `C:\DEV\RAFAQ\app-ganado\design\maniobra-wizard\inicio.png`
- `C:\DEV\RAFAQ\app-ganado\design\maniobra-wizard\etapa1.png`
- `C:\DEV\RAFAQ\app-ganado\design\maniobra-wizard\etapa2.png`
- `C:\DEV\RAFAQ\app-ganado\design\maniobra-wizard\etapa2-scroll.png` (8 maniobras, scrolleado al pool + CTA)
- `C:\DEV\RAFAQ\app-ganado\design\maniobra-wizard\etapa2-drag.png` (estado burbuja)
- `C:\DEV\RAFAQ\app-ganado\design\maniobra-wizard\etapa3.png`

---

## ITERACIÓN UX 3 (feedback de Raf, 2026-06-14) — preconfig de tanda INLINE + BOTTOM SHEET

> Mueve el preconfig de la tanda de la sección huérfana del fondo de la etapa 2 a **inline en cada
> maniobra configurable + un bottom sheet enfocado**. **NO toca servicios de M1 ni backend.** Solo
> `jornada.tsx` + `ManeuverReorderList.tsx` + un sheet nuevo + lógica pura + e2e.

### Qué cambió
1. **Eliminada la sección "Detalle de la tanda" del fondo** de la etapa 2 (el `FormField` suelto + chips
   de autocompletar + el componente `PreconfigField`, ya removidos).
2. **Preconfig INLINE en la fila** de la maniobra seleccionada (en "En la jornada"). Para las
   configurables — **Vacunación** (multi) e **Inseminación** (single) — la fila muestra una **2da línea**:
   sin cargar → hint *"Tocá para elegir vacuna"* / *"Tocá para elegir pajuela"* (`$textFaint`, muted) +
   chevron; cargado → el valor (énfasis `$primary`; vacunación = vacunas separadas por coma). Las SIN
   preconfig (pesaje, tacto, dientes, …) **no muestran 2da línea**.
3. **Bottom sheet enfocado** (`app/app/maniobra/_components/ManeuverConfigSheet.tsx`, NUEVO) al tocar el
   cuerpo de una maniobra configurable: input GRANDE (`$searchBarLg`=56, manga-friendly) + autocompletar
   "Usadas antes" (`filterAutocomplete`). **Vacunación = multi** (chips con × + botón "+"/submit/tocar
   sugerencia; persiste coma-separado) / **Inseminación = single** (pajuela). Guardar → persiste en
   `config.preconfig[<maniobra>]` → inline en la fila + en el resumen (round-trip). Safe-area inferior
   respetada (`max(insets.bottom, $4)`); patrón as-built de `BulkConfirmSheet` (backdrop `$scrim` + grip).
4. **Zonas de toque** de la fila seleccionada (tres `GestureDetector` espacialmente disjuntos): **badge
   ✓/número (izq) = QUITAR** (`onToggle`); **cuerpo (label + 2da línea) = abrir el sheet** si es
   configurable (si no, **inerte** — el badge sigue siendo el quitar); **grip (der) = drag** (R1.12, sin
   cambios; traga su tap). `ROW_HEIGHT` 64→80 (cabe la 2da línea sin romper la matemática del drag, que
   exige filas de alto uniforme). Bubble/scroll/bounds/auto-scroll/reorder de v2/v3 **intactos**.

### Archivos tocados (UX 3)
- `app/app/maniobra/jornada.tsx` — quita la sección del fondo + `PreconfigField`; agrega estado/handlers
  del sheet (`configManeuver`, `onOpenConfig`, `onConfigSave`); `FREE_TEXT_PRECONFIG` ahora trae
  `{title, placeholder, hint, kind}`; renderiza `<ManeuverConfigSheet>`; pasa `inlineConfig`/`onOpenConfig`
  a la lista. (Import de `FormField`/`filterAutocomplete` removido — typecheck lo confirma.)
- `app/app/maniobra/_components/ManeuverReorderList.tsx` — `SelectedRow` reestructurado en 3 zonas de
  toque + 2da línea inline; nueva prop `inlineConfig`/`onOpenConfig`; `ROW_HEIGHT` 80; `ChevronRight`.
- `app/app/maniobra/_components/ManeuverConfigSheet.tsx` (NUEVO) — el bottom sheet.
- `app/src/utils/maneuver-wizard.ts`(+`.test.ts`) — helpers puros `splitMultiPreconfig`/`joinMultiPreconfig`
  (modelo multi-valor de vacunación, round-trip coma-separado) + 6 tests (26 total en el archivo).
- `app/e2e/maniobra-wizard.spec.ts` — flujo del sheet (abrir desde el cuerpo, autocompletar, guardar,
  inline) + smoke de deselect-por-badge + captura nueva `etapa2-sheet.png`; `etapa2.png` re-capturada con
  el valor inline ("Vacunación · Brucelosis").
- `app/e2e/helpers/admin.ts` — helper `seedManeuverPreset` (siembra historial para el autocompletar).
- `specs/active/03-modo-maniobras/{design,tasks}.md` — reconciliación as-built v4 (§6.bis.1 + M1.4).

### Mapa R<n> → evidencia (UX 3)
| R<n> | Cobertura (UX 3) |
|---|---|
| R1.7 (preconfig de tanda) | inline 2da línea (hint/valor) + `ManeuverConfigSheet` → `config.preconfig[m]`; e2e: abrir sheet desde el cuerpo de Vacunación, guardar, ver inline + en resumen (round-trip) |
| R1.8 (autocompletar usados antes; vacunación multi/texto libre, inseminación 1 pajuela) | `ManeuverConfigSheet` chips "Usadas antes" (`filterAutocomplete`); e2e: preset sembrado → sugerencia "Brucelosis" visible + tocada → chip; `split/joinMultiPreconfig` (+6 tests) modelan el multi |
| R1.9 (resumen muestra el detalle) | sin cambio de datos: `maneuverDetail` lee el string coma-separado; e2e: "Brucelosis" bajo "Vacunación" en etapa 3 (`etapa3.png`) |
| R1.12 (drag-reorder con grip; zonas de toque) | grip = drag intacto; badge = quitar (e2e deselect smoke); cuerpo = abrir sheet (e2e); `selected-remove-N`/`selected-body-N` testIDs |
| Persistencia config (R1.13) | sin cambio: `buildJornadaConfig` + round-trip verdes; el valor multi es un string en `config.preconfig.vacunacion` |

### Autorrevisión adversarial (paso 8) — UX 3
Busqué, como revisor hostil:
- **Round-trip del preconfig (sheet → config → inline → resumen)**: VERIFICADO end-to-end por el e2e
  (guardar "Brucelosis" en el sheet → `selected-config-2` muestra "Brucelosis" → resumen lo muestra) +
  `multi preconfig round-trip` unit test (`split(join(x)) === dedup/trim`). El valor multi persiste como
  string coma-separado → `maneuverDetail` lo muestra tal cual inline y en el resumen (compatible con el
  shape jsonb existente, sin migrar nada).
- **Zonas de toque consistentes + no se pisan**: tres `GestureDetector` espacialmente disjuntos (badge 36px
  / cuerpo flex / grip). El e2e prueba que **badge deselecciona** (Vacunación baja al pool) y **cuerpo abre
  el sheet** (no deselecciona) — zonas distintas, sin solapamiento. El grip sigue grip-gated (drag) y traga
  su tap. **Decisión documentada**: cuerpo de una NO configurable = inerte (no quita), el badge es el único
  quitar → consistente (mismo gesto-de-quitar en toda fila, el cuerpo solo "hace más" si hay más que hacer).
- **`ROW_HEIGHT` 64→80 no rompe el drag**: el cómputo del índice destino usa `ROW_HEIGHT` (constante) y
  TODAS las filas (config y no) miden lo mismo → la matemática sigue exacta. Verificado: el bubble
  (`etapa2-drag.png`) y el scroll con 8 filas (`etapa2-scroll.png`) siguen andando; e2e drag/scroll verde.
- **Edge: guardar vacío** → en single, `onSave('')` → el caller borra la clave (limpia el preconfig); en
  multi, `canSave=false` si no hay chips ni texto (Guardar muted). Sin basura en el jsonb (`buildJornadaConfig`
  ya filtra preconfig vacío). [**SUPERSEDED por el FIX de canSave, 2026-06-14 — ver abajo: en multi Guardar
  también está SIEMPRE habilitado; guardar vacío = limpiar. La aserción de "Guardar muted en multi vacío"
  ya NO aplica.**] **Edge: duplicado** → `joinMultiPreconfig`/`addItem` dedup case-insensitive.
  **Edge: texto tipeado sin "+"** → `handleSave` lo incluye (no se pierde). **Edge: maniobra no en el
  catálogo** → `FREE_TEXT_PRECONFIG[m]` undefined → `onOpenConfig` no abre nada (guard) + sin 2da línea.
- **Autocompletar ejercido por la razón correcta**: sembré un preset real (`seedManeuverPreset`) → el wizard
  lo lee (`fetchPresets`) → el sheet muestra la sugerencia "Brucelosis" y al tocarla la agrega como chip.
  NO es un mock; el path de `history` → `filterAutocomplete` → chip → persistencia se ejerce de verdad.
- **Recorte de descendentes**: medido en las capturas — título del sheet "Vacunación" (g), "Inseminación"
  (j), hints "Tocá para elegir vacuna/pajuela", valores inline, "Brucelosis", "Guardar"/"Cancelar" → todo
  `lineHeight="$N"` matching, sin clip.
- **Targets ≥56px**: input del sheet `$searchBarLg`=56; botón "+" 56×56; badge/cuerpo/grip = alto de la
  fila (ROW_HEIGHT-8=72); Guardar/Cancelar = Button canónico ($touchMin=56). Sheet respeta safe-area.
- **Multi-tenant**: `seedManeuverPreset` usa el establishment del seed (e2e); `establishmentId` SIEMPRE del
  contexto en runtime (sin tocar). El sheet no toca servicios/red — solo `onSave` que el padre persiste.
- **Lint anti-hardcode**: VERDE (0 viol.). El sheet usa tokens + `getTokenValue` para lo que cruza a lucide.
- **Lo que encontré y cerré**: (1) usé `$touchTarget` (token inexistente) para el alto del input → lo cambié
  a `$searchBarLg` (existe, manga-friendly). (2) la primera versión del smoke de deselect re-agregaba Tacto
  (que vuelve al final) y corría los índices → rompía el `selected-body-2` siguiente; lo cambié a
  deseleccionar+re-sumar **Vacunación** (la última) para RESTAURAR el orden exacto. (3) comentario stale en
  `jornada.tsx` que decía "filterAutocomplete vive en la UI del campo de texto" → actualizado al sheet.
  Re-verifiqué typecheck + lint + e2e tras cada fix.

### Reconciliación de specs (paso 9) — UX 3
- `design.md` §6.bis.1: agregado **as-built v4** (preconfig inline + bottom sheet + zonas de toque +
  ROW_HEIGHT 80 + multi/single + helpers); DM1-UI-1 anotado (el autocompletar se movió del `PreconfigField`
  del fondo al sheet — la **fuente** [presets] no cambió). El *qué* de R1.7/R1.8/R1.9/R1.12/R1.13 **NO
  cambia** → sin reescritura de EARS en `requirements.md` (R1.7 "permitir pre-configurar" y R1.8 "ofrecer
  autocompletar … multi/1 pajuela" son location-agnósticos; la implementación los satisface). Cambio
  puramente de presentación/UX, como v2/v3.
- `tasks.md` M1.4: nota **as-built v4** + Archivos actualizados (sheet nuevo + helpers + `seedManeuverPreset`
  + `etapa2-sheet.png`). M1.4 sigue `[x]`.
- Sin cambios de comportamiento de datos/contrato: `config.preconfig` jsonb pass-through intacto;
  `createSession`/`loadPreset`/gating sin tocar.

### Verificación — UX 3
`node scripts/check.mjs` → typecheck + anti-hardcode 0 viol. + **client unit 1125/1125** verdes (incl. los 6
nuevos `split/joinMultiPreconfig`); `maneuver-wizard.test.ts` 26/26 en aislado. **ROJO AJENO confirmado**:
las suites **Edge Functions** (`delete_account`, `remove_member`, `T2.2 ADR-014 bearer`) fallan por
`signIn(...): Request rate limit reached` = el flake documentado de auth de Supabase por 2 terminales contra
el remoto compartido (`reference_check_red_rate_limit.md`), **NO** una regresión — esta iteración es
frontend puro (cero auth/edge/backend tocado). e2e `maniobra-wizard.spec.ts` → **1 passed** (el
`Assertion failed … uv_handle` es ruido de teardown de libuv en Windows). **7 capturas** 412×915
regeneradas: `inicio/etapa1/etapa2/etapa2-sheet/etapa2-scroll/etapa2-drag/etapa3.png`. Pendiente: veto del
leader (design-review) + reviewer + Gate 2.

### Capturas (paths absolutos) — UX 3
- `C:\DEV\RAFAQ\app-ganado\design\maniobra-wizard\etapa2.png` (Vacunación · Brucelosis inline + sin sección del fondo)
- `C:\DEV\RAFAQ\app-ganado\design\maniobra-wizard\etapa2-sheet.png` (bottom sheet abierto: input grande + autocompletar "Usadas antes")
- `C:\DEV\RAFAQ\app-ganado\design\maniobra-wizard\etapa2-scroll.png` (8 maniobras, scroll al pool + CTA, sin regresión)
- `C:\DEV\RAFAQ\app-ganado\design\maniobra-wizard\etapa2-drag.png` (estado burbuja, sin regresión)
- `C:\DEV\RAFAQ\app-ganado\design\maniobra-wizard\etapa3.png` (resumen: Vacunación · Brucelosis)
- `C:\DEV\RAFAQ\app-ganado\design\maniobra-wizard\inicio.png` / `etapa1.png`

---

## FIX puntual — `canSave` del bottom sheet (veto del leader, 2026-06-14) — etapa 2, M1-UI

> Fix de UN bug funcional cazado por el design-review del leader sobre la iteración UX 3. **Frontend
> puro** — NO toca servicios de M1 ni backend. Solo `ManeuverConfigSheet.tsx` + cobertura e2e + re-captura
> del hero del sheet.

### El bug
En `ManeuverConfigSheet.tsx`, `canSave` deshabilitaba "Guardar" en **multi (vacunación)** cuando no había
chips ni texto:
```js
const canSave = kind === 'multi' ? items.length > 0 || trimmed.length > 0 : true;
```
Esto contradecía el comentario de `handleSave` ("Guardar vacío = limpiar el preconfig"). Repro: abrir el
sheet de Vacunación con "Brucelosis" cargada (1 chip) → tocar la × del chip → `items=[]`, input vacío →
`canSave=false` → **Guardar deshabilitado** → **NO había forma de BORRAR una vacuna ya configurada en
multi**. En single (inseminación) sí se podía (canSave=true siempre) → inconsistente y rompía el "limpiar".

### El fix (qué cambié exactamente)
`app/app/maniobra/_components/ManeuverConfigSheet.tsx` — 3 ediciones:
1. **Borrada la línea `const canSave = …`** (era la ~130, entre `bottomPad` y el `return`). Queda
   eliminada del todo.
2. **Botón "Guardar": removido `disabled={!canSave}`** (~293) → ahora `<Button variant="primary" fullWidth
   onPress={handleSave}>` → **SIEMPRE habilitado** en ambos modos (multi y single).
3. **Comentario de `handleSave` (~103) ampliado**: aclara que Guardar SIN nada persiste `''` = limpiar el
   preconfig (el caller borra la clave) y POR QUÉ Guardar está siempre habilitado (sin él no habría forma
   de borrar la última vacuna en multi).

Round-trip del "limpiar" en multi (verificado): quitar el último chip → `items=[]`, `typed=''` →
`handleSave` → `joinMultiPreconfig([]) === ''` (unit test `joinMultiPreconfig: …` ya lo cubre, línea 201
de `maneuver-wizard.test.ts`) → `onSave('')` → el caller `onConfigSave` (jornada.tsx ~215) hace
`delete next[m]` cuando `value.trim().length===0` → `config.preconfig.vacunacion` desaparece → la 2da línea
de la fila vuelve al hint "Tocá para elegir vacuna". El round-trip CIERRA.

### Cobertura agregada
- **e2e `maniobra-wizard.spec.ts`**: tras cargar "Brucelosis" inline, el flujo ahora REABRE el sheet →
  quita el chip con su × ("Quitar Brucelosis") → asegura el chip ido → **Guardar (ahora habilitado)** →
  sheet cerrado → la fila muestra el HINT ("Tocá para elegir vacuna", no el valor viejo) vía
  `selected-config-2` → luego RESTAURA "Brucelosis" para no alterar la etapa 3. Esto ejerce el path REAL
  del bug: la PRIMERA corrida (contra el bundle viejo) falló justo en el `.click()` de Guardar con
  `aria-disabled="true"` → prueba que el test caza el bug; tras rebuild + fix, **1 passed**.
- **Unit**: `joinMultiPreconfig([]) === ''` ya estaba cubierto (no se duplica). Suficiente per el pedido.
- Segundo preset sembrado (`Sanitario primavera` con `vacunacion: 'Aftosa'`) → el `history` del
  autocompletar tiene 2 valores → tras agregar "Brucelosis" como chip, "Aftosa" sigue en "Usadas antes"
  (la captura hero muestra chip + sugerencia distinta + Guardar verde a la vez).

### Re-captura del hero del sheet
`design/maniobra-wizard/etapa2-sheet.png` re-capturada (412×915, misma tubería Playwright). Antes: input
VACÍO + Guardar deshabilitado (verde lavado). **Ahora**: chip "Brucelosis" con × + input grande + "Usadas
antes" (Aftosa) + **Guardar en botella verde a full (habilitado)** arriba de Cancelar. Verifica el render
de chips multi y sirve de hero fuerte. `etapa2.png` NO se tocó (sigue: Vacunación · Brucelosis inline).

### Autorrevisión adversarial (paso 8) — este fix
Busqué, como revisor hostil:
- **¿El fix arregla o esconde?** Arregla: la 1ra corrida e2e (bundle viejo) falló en el click de Guardar
  con `aria-disabled="true"` → el bug existía y el test lo caza; tras el fix + rebuild, el clear-multi pasa
  y la fila revierte al hint. No es un "hide".
- **Single intacto** (ya era `canSave=true`); el `+`/Agregar conserva su propio `disabled={trimmed===0}`
  (independiente, no tocado); bubble/scroll/bounds/auto-scroll/reorder de `ManeuverReorderList.tsx` NO
  tocados. Color del valor inline ($primary) NO tocado.
- **Texto tipeado sin "+" no se pierde** al guardar (`handleSave` lo incluye via `pending`). **Dup**
  case-insensitive intacto. **jsonb sin basura** (`buildJornadaConfig`/`onConfigSave` filtran/borran vacío).
- **Aserción `selected-config-2`**: la corregí de `toHaveCount(0)` (ERROR mío — la 2da línea queda montada
  para filas configurables, mostrando el hint) a `toHaveText('Tocá para elegir vacuna')`, verificado contra
  el source (la fila configurable SIEMPRE renderiza la 2da línea: valor o hint).
- **Test por la razón correcta**: el clear-multi ejerce el reject→accept real (chip presente → quitar →
  Guardar vacío → key borrada → hint); no happy-path-only. La sugerencia "Aftosa" persiste por la lógica
  real de exclusión (solo se excluye lo AGREGADO), no por mock.
- **Multi-tenant / cleanup**: 2do preset namespaced (`RUN_TAG`) + scope al establishment sembrado → lo
  borra `cleanupAll` (cascade). Sin `establishment_id` hardcodeado.
- **Descendentes**: título "Vacunación" (g), "Guardar"/"Cancelar", "Tocá para elegir vacuna", chip
  "Brucelosis" → `lineHeight` matching, sin clip (medido en `etapa2-sheet.png`).
- **Lint anti-hardcode**: VERDE (check.mjs 0 viol.) — el fix solo borra props, no agrega valores crudos.
- **Lo que encontré y cerré**: (1) corrí el e2e sin rebuild → falló contra el bundle viejo (canSave aún
  deshabilitaba) → rebuild (`pnpm e2e:build`) y re-corrida = passed. (2) `selected-config-2`
  `toHaveCount(0)` errónea → `toHaveText(hint)`. (3) sin 2do valor en history, "Usadas antes" quedaba
  vacío tras agregar Brucelosis → sembré `Sanitario primavera` (Aftosa) para el hero fuerte.

### Reconciliación de specs (paso 9) — este fix
- **`requirements.md` / `design.md` / `tasks.md`**: `canSave` NO aparece en NINGUNO (grep confirmado: el
  único hit estaba en este `impl_03-m1-ui.md`). No hay EARS ni contrato que contradiga el código → NADA que
  reconciliar en las specs propiamente dichas (no invento). El *qué* de R1.7 ("pre-configurar el valor de la
  tanda", incluye poder DEJARLO VACÍO/limpiarlo) lo satisface mejor ahora. R1.8 sin cambios.
- **Este progress (`impl_03-m1-ui.md`)**: la nota de autorrevisión UX 3 ("Edge: guardar vacío → en multi
  canSave=false … Guardar muted") quedaba como comportamiento correcto → la marqué **SUPERSEDED** in-place
  (apunta a esta sección) para no dejar el progress contradiciendo el as-built.
- `tasks.md` M1.4 sigue `[x]` (el chunk no cambia de alcance; es un fix de detalle dentro de M1.4).

### Verificación — este fix
- `node scripts/check.mjs` → **VERDE** (typecheck OK + anti-hardcode 0 viol. + TODAS las suites unit/backend
  verdes, incl. operaciones-rodeo 22/22; el flake de rate-limit NO recurrió esta corrida).
- typecheck aislado (`tsc --noEmit`) tras los cambios del e2e → exit 0.
- e2e `maniobra-wizard.spec.ts` (contra build fresco vía `pnpm e2e:build`) → **1 passed** (el `Assertion
  failed … uv_handle` es el ruido conocido de teardown de libuv en Windows, NO un fallo).
- Re-captura: `C:\DEV\RAFAQ\app-ganado\design\maniobra-wizard\etapa2-sheet.png` (hero: chip + Aftosa +
  Guardar habilitado, 412×915). Pendiente: reviewer + Gate 2 (frontend puro → Gate 1 N/A). NO marco done.
