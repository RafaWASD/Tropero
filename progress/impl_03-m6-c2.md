baseline_commit: a03e593406da77096a239f7d54eb262ec1f9098f

# impl 03 — M6-C.2 — Tarjeta de tendencia de CE en la ficha + CE en el timeline (R14.14)

Feature `03-modo-maniobras` (in_progress). Chunk **M6-CLIENTE / M6-C.2** (ÚLTIMO de M6). **Frontend PURO** (display read-only desde la lectura local `fetchScrotalHistory` ya hecha en C.1; backend M6 live 0098/0099/0100; suite scrotal 12/12 verde). NO toca data-path, ni inputs, ni auth, ni schema, ni la vista server `animal_timeline` (DM6 design §12.6 default = composición en cliente). Gate 1 N/A; **Gate 2 probablemente N/A** (sin cambio de data-path; lectura local de una tabla ya gateada/sincronizada) — confirmar en el cierre.

## Verificación de partida
- `fetchScrotalHistory(profileId)` (scrotal.ts) + `buildScrotalHistoryQuery` (local-reads.ts) ya existen (C.1) — REUSO, no dupliqué.
- `node scripts/check.mjs` de partida: rojo SÓLO por el flake conocido `animals_tag_unique` (23505, suite backend, terminales paralelas — `reference_check_red_rate_limit`). NO es regresión de M6-C.2 (frontend puro).

## Plan (T1..Tn)
- **T1** `event-timeline.ts`: kind `'scrotal'` en `TimelineKind` + variante en `TimelineItem` (`circumferenceCm`/`ageMonths`/`measuredAt`) + `isDateOnlyKind('scrotal')=true` (measured_at es columna `date`) + helper PURO `scrotalRowsToTimelineItems` (mapea las filas de la lectura local a TimelineItem) + `describeScrotalTimeline` (label es-AR "Circunferencia escrotal" + detalle "36,5 cm · 24 meses"). PURO, testeable con node:test. + test.
- **T2** `TimelineEvent.tsx`: `case 'scrotal'` en `present()` → ícono `Ruler` (acento $primary), título "Circunferencia escrotal", detalle = "36,5 cm · 24 meses" (es-AR, reusa `formatCmAR`). + cubierto por el test de event-timeline (describe) + e2e.
- **T3** predicado PURO de macho entero en `maneuver-applicability.ts` (export `isBullEntire(categoryCode, isCastrated)`) para que la ficha decida si muestra la tarjeta — paridad con la regla de aplicabilidad de la CE (R14.2/R14.3), sin duplicar el set. + test.
- **T4** `animal/[id].tsx`:
  - cargar el histórico de CE en `load` (blando, paralelo) SOLO si el animal es macho entero → `ScrotalTrendSection` con la serie (cm + edad + fecha es-AR) + mini-tendencia (sparkline de barras con tokens) + affordance de scroll si la serie es larga.
  - merge de la CE en el `timeline` (composición en CLIENTE, no toca la vista server): mapeo `scrotalRowsToTimelineItems` + re-orden con `parseTimeline` → la CE aparece en el riel.
  - la tarjeta se muestra SOLO a machos enteros (paridad con la fila repro solo-hembras de `CurrentStateSection`).
- **T5** e2e `ficha-circunferencia-escrotal.spec.ts`: toro con ≥1 CE seedeada (helper admin) → ficha muestra la tarjeta (serie + tendencia + edad + fecha es-AR) + CE en el timeline; hembra/castrado → NO muestra la tarjeta. Capturas web táctil 360/412 de la ficha con la tarjeta.
- **T6** check + autorrevisión adversarial (mirar las capturas: título sin recorte, serie legible, es-AR, ausencia en hembra) + reconciliación design §12.6 (AS-BUILT) + tasks M6-C.2 ([x]).

## Decisiones de criterio propio (menores)
- **Ícono de la tarjeta**: `Ruler` (lucide) — la CE es una MEDIDA (circunferencia en cm). Coherente con DetailSection (ícono $primary sobre halo $greenLight). [pendiente: confirmar visual contra capturas]
- **Mini-tendencia**: sparkline de BARRAS con tokens (`$greenLight`/`$primary`), NO una lib de charts (el brief lo permite explícito). La barra más alta = la CE máxima de la serie; cada barra escala su altura proporcional a su cm relativo al rango [min,max] de la serie. Una sola medición → una barra (sin "tendencia" pero la card sigue siendo legible).
- **Orden de la serie**: más reciente primero (igual que `buildScrotalHistoryQuery ORDER BY measured_at DESC`), coherente con el resto de la ficha; la mini-tendencia se dibuja en orden CRONOLÓGICO (viejo→nuevo, izq→der) para que "subir" se lea natural.

## Qué se construyó (T1–T6)
- **T1 `event-timeline.ts`**: kind `'scrotal'` en `TimelineKind` + variante `TimelineItem` (`circumferenceCm`/`ageMonths`); `isDateOnlyKind('scrotal')=true`; helpers PUROS `scrotalRowsToTimelineItems` (filas de lectura local → TimelineItem; `eventId`=id real, `eventDate`=measured_at), `describeScrotalTimeline` ("36,5 cm · 24 meses", reusa `formatCmAR`), `formatAgeMonthsAR` (es-AR, NO snapea — snapshot R14.8). **`sortTimelineItems` EXTRAÍDO de `parseTimeline`** (mismo criterio, no muta) para mergear la CE compuesta con el riel del server.
- **T2 `TimelineEvent.tsx`**: `case 'scrotal'` → ícono `Ruler` ($primary), título "Circunferencia escrotal", detalle `describeScrotalTimeline`.
- **T3 `maneuver-applicability.ts`**: predicado PURO `isBullEntire(categoryCode, isCastrated)` (única fuente del set {torito,toro}); `appliesToAnimal('circunferencia_escrotal')` REFACTORIZADO a reusarlo (DRY — antes duplicaba el literal del set).
- **T4 `animal/[id].tsx`**: estado `scrotalHistory` (load blando, paralelo, SOLO si `isBullEntire`); `composedTimeline` (memo, merge + `sortTimelineItems`); `ScrotalTrendSection` (mini-tendencia de barras con tokens + serie es-AR + lista capeada/peek/fade `scrollFades` + empty cálido). Tarjeta entre "Estado actual" y "Datos personalizados". El riel usa `composedTimeline` → la CE aparece en el timeline.
- **T5 e2e** `ficha-circunferencia-escrotal.spec.ts` (4 tests) + helper `seedScrotalMeasurement` (admin.ts).
- **T6** check + autorrevisión + reconciliación.

## Trazabilidad R<n> → test
- **R14.14 (tarjeta de tendencia: serie cm+edad+fecha es-AR + mini-tendencia)** →
  - `event-timeline.test.ts`: `describeScrotalTimeline` ("36,5 cm · 24 meses"; edad null → solo cm), `formatAgeMonthsAR` (es-AR singular/plural, no snapea), `scrotalRowsToTimelineItems` (mapeo + descarta sin measuredAt), `isDateOnlyKind('scrotal')`.
  - `maneuver-applicability.test.ts`: `isBullEntire` (torito/toro → true; hembra/ternero/novillo/castrado/sin-cat → false; null castración → true R14.3; **paridad EXACTA con `appliesToAnimal('circunferencia_escrotal')`**).
  - e2e `ficha-circunferencia-escrotal.spec.ts`: (1) toro con 3 CE → tarjeta visible + serie "38 cm"/"35,5 cm"/"32 cm" (coma decimal es-AR) + "30 meses" + mini-tendencia (captura) + **CE en el timeline** ("38 cm · 30 meses" en el riel); (2) toro con 7 CE → lista capeada scrollea (la más vieja "30 cm" reachable por scroll del contenedor); (3) **hembra → NO tarjeta**; (4) **castrado con CE histórica → NO tarjeta**.
- **R14.14 (CE en el timeline, label es-AR)** → `TimelineEvent.tsx` `case 'scrotal'` (título "Circunferencia escrotal" + detalle) + e2e (riel muestra el nodo CE con su valor; captura `ficha-ce-timeline-412.png`).

## Autorrevisión adversarial (paso 8)
Pasada hostil sobre el propio código + las CAPTURAS antes del reviewer:
- **Capturas miradas**: `ficha-ce-tarjeta-{360,412}` (título "Circunferencia escrotal" SIN recorte — `lineHeight $6` matcheado; serie legible es-AR coma decimal; mini-tendencia ascendente con la más reciente en $primary), `ficha-ce-timeline-412` (3 nodos CE en el riel, orden por fecha desc, Ruler $primary, es-AR), `ficha-ce-serie-larga-412` (7 barras + lista capeada 4,5 filas con **peek** de "33 cm" asomando = affordance de "hay más"). Tarjeta AUSENTE en hembra/castrado verificado por e2e (`toHaveCount(0)`).
- **Buscado: desviación del spec.** R14.14 cubierto entero (serie cm+edad+fecha es-AR + mini-tendencia + CE en timeline + solo machos enteros). El timeline se compone en el CLIENTE (opción (a) del default DM6, design §12.6) — NO se tocó la vista server `animal_timeline` (eso sería migración + Gate 1, fuera de scope).
- **CAZADO — fixture e2e: `vaca_multipara` no es code válido** en `categories_by_system` (el code real es `multipara`) → la 1ra corrida del test hembra falló en `seedAnimal`. CERRADO (usado `multipara`). NO es bug del código de M6-C.2 (suposición errónea de la prueba). 4/4 verde.
- **Edge: castrado con CE histórica.** Si un toro se midió y DESPUÉS se castró, el dato existe pero la tarjeta NO se muestra (R14.2 — solo machos enteros). Verificado por e2e (castrado con 1 CE seedeada → `toHaveCount(0)`). Doble protección: `isBullEntire` chequea categoría (novillo ∉ set) Y `is_castrated !== true`.
- **Edge: macho entero sin mediciones ([]).** `scrotalHistory=[]` (no null) → la tarjeta renderiza un empty cálido ("Todavía no hay mediciones"), no un error ni un crash (la 1ra medición es caso de negocio legítimo, no falta de sync — `fetchScrotalHistory` usa `emptyIsSyncing:false`). Paridad con el empty del Historial.
- **Edge: lectura de CE falla.** `fetchScrotalHistory` error → `setScrotalHistory([])` (blando) → empty cálido, la ficha no se rompe (la cabecera/timeline siguen).
- **Edge: serie con todas las CE iguales / una sola.** `span=0` → todas las barras al tope (no hay tendencia que mostrar pero la card es legible). Una sola medición → una barra (resaltada). Sin división por cero (guard `span > 0`).
- **Orden del riel.** `sortTimelineItems` re-ordena el merge (CE + server) por día→createdAt→seq→eventId — verificado por unit (`sortTimelineItems: mergea... re-ordena`) + e2e (riel: Alta hoy arriba, luego CE por fecha desc) + `sortTimelineItems` NO muta la entrada (unit).
- **`deriveCurrentState` no confunde la CE con un peso.** La CE no aporta weight/conditionScore/pregnancy → unit (`deriveCurrentState: ignora la CE`) + el `CurrentStateSection` recibe `timeline` (no el compuesto) igual → inerte.
- **`canDeleteEvent` con una fila scrotal.** Retorna false (no es vaccination/weaning) → el nodo CE del riel es display-only (sin botón borrar) — la corrección de CE es R14.17 (manga, M6-C.1), no desde el riel en este chunk.
- **Seguridad / multi-tenant.** Display read-only: la lectura local (`fetchScrotalHistory` → `buildScrotalHistoryQuery`, parametrizado por profileId) lee de la tabla `scrotal_measurements` ya gateada por RLS server-side + frontera WAL del sync (`ev_scrotal_measurements`, scope establishment) → un device solo tiene local las CE de campos donde el usuario tiene rol. El gate de DISPLAY (`isBullEntire`) es UX/aplicabilidad, NO seguridad (la barrera real es la RLS de la lectura). Sin hardcode de `establishment_id`, sin RPC nueva, sin escritura, sin nuevo input. Anti-hardcode 0.
- **Tests que pasan por la razón correcta.** El e2e verifica la TARJETA real con valores es-AR concretos (no solo "existe el título"), el SKIP real en hembra/castrado (`toHaveCount(0)`), la CE en el RIEL real (detalle "38 cm · 30 meses"), y el scroll del contenedor capeado (la más vieja `scrollIntoViewIfNeeded` + visible). El test de paridad `isBullEntire`↔`appliesToAnimal` barre la matriz (categoría × castración) → el gate de display NO puede divergir de la aplicabilidad.

## Reconciliación de specs
- **`design.md §12.6`** — nota AS-BUILT M6-C.2: se eligió la opción (a) (composición en el cliente, sin tocar `animal_timeline`); detallado lo construido (kind scrotal, `sortTimelineItems` extraído, `isBullEntire` reusado, `ScrotalTrendSection` con sparkline de barras/peek/fade), la decisión menor del ícono `Ruler`, y Gate 2 = N/A.
- **`tasks.md M6-C.2`** — `[x]` + bloque AS-BUILT (qué se cableó, los helpers nuevos, la verificación, las capturas).
- **`requirements.md`** — NO se tocó: R14.14 se cumple TAL CUAL está escrito (serie cm+edad+fecha es-AR + mini-tendencia + CE en el timeline). Sin reconciliación del *qué*.
- **Refactor menor reconciliado**: `appliesToAnimal('circunferencia_escrotal')` ahora reusa `isBullEntire` (antes duplicaba el set {torito,toro} inline) — comportamiento IDÉNTICO (test de paridad exacta), solo DRY. Documentado en el AS-BUILT de design §12.6.

## Cabos para el leader (Gate 2)
- **Gate 2 (security code) = N/A (a confirmar por el leader).** M6-C.2 es **display read-only**: lee el histórico LOCAL (`fetchScrotalHistory`, query parametrizada por profileId) de una tabla `scrotal_measurements` YA gateada (RLS server-side + frontera WAL `ev_scrotal_measurements` scope establishment, Gate 1 PASS + backend suite 12/12 + M6-C.1 Gate 2 del write-path). NO hay: cambio de data-path, write nuevo, input nuevo, RPC nueva, cambio de auth, ni schema. El gate de display `isBullEntire` es UX (la RLS de la lectura es la barrera). Sin hardcode de tenant. → el diff `a03e593..HEAD` no introduce superficie de seguridad nueva.
- **NO marqué la feature done.** Pendiente reviewer + (confirmación de) Gate 2 + Puerta 2 humana. M6-C.2 era el ÚLTIMO chunk de M6.
- **NO hice `git add -A`.** NO toqué spec-08 ni `feature_list.json`. Las migraciones 0098-0100 + suite scrotal + componentes de chunks previos siguen como estaban (deploy-gate del leader; ya live en remoto).

## Estado de `node scripts/check.mjs` (honesto)
- **typecheck client: OK.** **Anti-hardcode (ADR-023 §4): 0 violaciones.** **client unit: 1559 pass / 0 fail** (incluye +9 scrotal en `event-timeline.test.ts` + +3 `isBullEntire`). RLS 22/22, Edge 42/42 verdes.
- **e2e `ficha-circunferencia-escrotal.spec.ts`: 4/4** (web táctil 360/412).
- **Único rojo = el flake conocido `animals_tag_unique` (23505)** en la suite backend `supabase/tests/animal/run.cjs:1881` (spec-02): dos terminales paralelas (la otra en spec-08) chocan en el `tag_electronic` global-unique contra la DB compartida (`reference_check_red_rate_limit`). NO es regresión de M6-C.2 (frontend display, no toca el alta de animales).
