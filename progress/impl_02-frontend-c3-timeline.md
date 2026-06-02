baseline_commit: e8ad803127f5b109095b830ddd708dcfd0ae6c67

# Implementación C3.1 — Ficha de animal: la cronología cobra vida (spec 02 R10/R14)

Frontend-only (sin migraciones, sin Edge, sin RLS nueva). Baseline = `e8ad803` (C2 commiteado).
Estado: COMPLETO, todo verde. A la espera del reviewer (NO marco `done`).

## Scope entregado (C3.1 — exactamente esto)
1. **Cronología completa renderizada** (los 7 `event_kind`) en `app/app/animal/[id].tsx`, reemplazando el `TimelineTeaser` ("Próximamente").
2. **3 tipos simples cargables** (sin efecto colateral de categoría/ternero): Peso, Condición corporal, Observación libre. Tras cargar, `router.back()` a la ficha → `useFocusEffect` refresca el timeline y el evento nuevo aparece arriba.
3. Los otros 4 kinds (reproductive/sanitary/lab/category_change) se **renderizan** si existen (vienen de la RPC), pero NO se crean acá (son C3.2/C3.3).

## Archivos

### Nuevos
- `app/src/utils/event-timeline.ts` — lógica PURA: parseo de fila de la RPC → `TimelineItem` (unión discriminada por kind, tolerante a payload incompleto/null), `parseTimeline` (orden `event_date desc` + tiebreaker estable por eventId), resolución de nombres de categoría (`collectCategoryIds`/`resolveCategoryNames`, sin N+1), `formatEventDate(iso, now)` (es-AR, hoy/ayer/mismo-año/otro-año, PURA con `now` inyectado), humanizadores de enums (repro/sanitary/pregnancy/sample/route), `describeCategoryChange` (hito `initial` vs resto).
- `app/src/utils/event-input.ts` — lógica PURA: 17 scores de condición corporal (1.00→5.00 paso 0.25, generados sin error de float), `isValidConditionScore`, `formatConditionScore` (coma es-AR), `validateWeight` (>0, ≤ numeric(7,2)=99999.99), `validateEventDate` (formato + no-futura, `today` inyectable), `sanitizeObservationInput`/`validateObservation` (tope 1000, no vacío). NO duplica `sanitizeWeightInput`/`maskDateInput` (los reusa el form de `animal-input.ts`).
- `app/src/utils/event-timeline.test.ts` — 31 tests (parseo de los 7 kinds incl. payload incompleto/null/string-vacío/kind-desconocido; orden + tiebreaker; resolución de categoría; `formatEventDate` con `now` fijo cubriendo los 4 casos + bordes de mes; humanizadores; `describeCategoryChange`).
- `app/src/utils/event-input.test.ts` — 19 tests (17 scores exactos; validación peso/fecha/texto; bordes).
- `app/src/services/events.ts` — service delgado swappable (espeja `animals.ts`): `fetchTimeline` (llama la RPC `animal_timeline`, parsea, resuelve nombres de categoría en UNA query), `addWeight`/`addConditionScore`/`addObservation` (inserts SIN `.select()`).
- `app/src/components/TimelineEvent.tsx` — fila del riel (nodo de color + ícono lucide por tipo en gutter, línea conectora 1px `$divider`, contenido con título/detalle/timestamp truncados). Exportado en `components/index.ts`.
- `app/app/agregar-evento.tsx` — wizard 2 pasos (elegí tipo → form). Registrado en `_layout.tsx` (`AGREGAR_EVENTO_ROUTE` en `ANIMAL_DESTINATIONS` + `Stack.Screen`).
- `app/e2e/events.spec.ts` — 2 tests E2E (ficha → sparse inicial → agregar peso y observación → aparecen; validación en vivo + rechazo de submit inválido).

### Modificados
- `app/app/animal/[id].tsx` — trae el timeline con `fetchTimeline` (junto al detalle, en `Promise.all`, vía `useFocusEffect`); `HistorySection` (header "Historial" + CTA primario "Agregar evento" + riel de `TimelineEvent` + empty/sparse cálido + error blando con reintentar). Reemplaza `TimelineTeaser`.
- `app/src/services/animals.ts` — `AnimalDetail` + `fetchAnimalDetail` ahora exponen `establishmentId` (derivado del PERFIL, `animal_profiles.establishment_id`) — necesario para la observación.
- `app/src/components/index.ts` — export de `TimelineEvent`.
- `app/app/_layout.tsx` — registro de la ruta `agregar-evento`.
- `scripts/run-tests.mjs` — wiring de los 2 nuevos test files puros en la suite de unit del cliente.
- `app/e2e/animals.spec.ts` — el assert del teaser ("Historial de eventos") pasa a la sección real ("Historial").

## Sustrato backend (NO se tocó — verificado)
- RPC `animal_timeline` (migración 0035): payload por kind confirmado contra la migración. Ordena `event_date desc` (el cliente re-ordena defensivamente con el mismo criterio + tiebreaker estable).
- `weight_events` / `condition_score_events` / `animal_events`: inserts plain; `created_by`/`author_id`/`edit_window_until` por trigger; el CHECK de score (17 valores) confirmado en 0028; el trigger `tg_animal_events_validate_est` (0034) valida `establishment_id == establishment_of_profile` con errcode 23514.

## Trazabilidad R → test

| Requirement | Cubierto por |
|---|---|
| R10.1 (cronología, 7 orígenes, payload por kind, orden desc) | `event-timeline.test.ts` (parseo de los 7 kinds + `parseTimeline` orden/tiebreaker); `events.spec.ts` (la RPC se consume end-to-end en la ficha) |
| R10.2 (RLS scopea el timeline) | barrera server-side (RPC security definer + has_role_in); `events.spec.ts` corre con un usuario real con rol (no se fuerza permiso en cliente) |
| R10.3 (category_change con `from`/`to`/`reason`) | `event-timeline.test.ts` (parseo category_change + resolución de nombres + `describeCategoryChange` initial/auto/manual); `events.spec.ts` (el `initial` se ve en la ficha como sparse) |
| R14.2 (cabecera + cronología debajo) | C2 ya cubre la cabecera; C3.1 agrega la cronología debajo — `events.spec.ts` (ficha muestra "Historial") |
| R14.3 (componente por tipo + timestamp legible) | `TimelineEvent.tsx` (ícono+título+detalle por kind) + `event-timeline.test.ts` (humanizadores, `formatEventDate`); `events.spec.ts` ("Pesaje"+"320 kg") |
| R6.1 (weight_events) | `event-input.test.ts` (validateWeight); `events.spec.ts` (agrega peso → aparece) |
| R6.4 (condition_score, 17 valores) | `event-input.test.ts` (17 scores + isValidConditionScore) |
| R6.10/R6.13 (animal_events, author_id por trigger, establishment denormalizado) | `events.ts` `addObservation` (deriva establishment del perfil, no manda author_id); `events.spec.ts` (agrega observación → aparece) |
| R13.3 (validación local antes de enviar) | `event-input.ts` validaciones de submit; `events.spec.ts` (rechazo de peso vacío sin pegarle al server) |

> Nota: la **edición/borrado** de eventos (R14.4 / ventana 15 min / R6.8.1 / R6.14) es **C3.3** — fuera de scope C3.1 (acá solo se MUESTRAN; el `edit_window_until` y `author_id` se parsean pero no se exponen acciones).

## Autorrevisión adversarial (paso 8)

Busqué activamente, como revisor hostil:

**(a) establishment_id de la observación derivado del PERFIL, no del contexto activo.** CONFIRMADO. La ficha pasa `detail.establishmentId` (de `fetchAnimalDetail` → `animal_profiles.establishment_id`) al wizard por param; `addObservation` lo manda. Test mental: usuario con rol en campo A y B, activo=B, abre animal de A → mando A → trigger 0034 valida A==establishment_of_profile==A → OK. Si hubiera usado el contexto activo (B), la RLS de insert PASARÍA (tiene rol en B) pero el trigger tiraría 23514. Por eso derivar del perfil es necesario, no opcional. Verificado contra la migración 0034 (`tg_animal_events_validate_est`).

**(b) NO `.insert().select()`.** CONFIRMADO en los 3 inserts de `events.ts` (plain `.insert(payload)`; el caller re-fetchea con `fetchTimeline`).

**(c) Refresco sin stale ni doble-fetch que parpadee.** CONFIRMADO. `router.back()` desde el wizard → la ficha (que sigue montada) dispara `useFocusEffect` → UN `load()` (detalle + timeline en `Promise.all`). No hay doble fetch.

**(d) Score SOLO por selector cerrado.** CONFIRMADO. `ScoreSelector` renderiza chips de `CONDITION_SCORES`; el estado es `number | null`; no hay TextInput de score. Nunca puede violar el CHECK.

**(e) Peso decimal en vivo, >0, ≤ 99999.99.** CONFIRMADO. `sanitizeWeightInput` en `onChangeText`; `validateWeight` al submit.

**(f) Fecha por máscara, no-futura.** CONFIRMADO. `maskDateInput` en vivo; `validateEventDate` rechaza futura (avisa, simple). Fecha precargada con hoy (caso típico).

**(g) Sin leak de accessibilityLabel a Pressables RN-web.** CONFIRMADO. Todos los Pressables nuevos usan `buttonA11y`; el textarea usa `observationA11y()` ramificado (web=`aria-label`, native=`accessibilityLabel`). Grep confirma que el único `accessibilityLabel` crudo en mis archivos está en la rama NATIVE del helper.

**(h) Empty/sparse no crashea ni se ve muerto.** CONFIRMADO. `isSparse` (0 eventos o solo el `initial`) → empty cálido `$greenLight`. Probado en E2E (animal recién sembrado → "Todavía no hay eventos").

**(i) Voseo + tokens-only + sin hardcode.** CONFIRMADO. `check-hardcode.mjs` = 0 violaciones. Copy en voseo.

**(j) numberOfLines/truncado en textos largos.** CONFIRMADO. `TimelineEvent` título `numberOfLines={1}`, detalle `numberOfLines={3}`. Un producto/IDV largo no rompe el layout.

**(k) agregar-evento no se rompe sin params.** CONFIRMADO. `missingParams` (sin `profileId`) → InfoNote + oculta el CTA. Si falta solo `establishmentId`: peso/condición funcionan; observación muestra error claro y no inventa con el contexto activo.

### Hallazgos corregidos durante la implementación
- **Resolución de módulos en node:test**: `event-input.ts` importaba `parseWeight` de `animal-form` como VALOR → el runner (sin bundler) no resolvía la extensión y reventaba. Los utils puros de la suite son self-contained (solo `import type` entre ellos). Inliné un parser de coma-decimal local de 3 líneas (NO es el sanitizer de input — ese vive una sola vez en `animal-input.ts` y no se duplica). Re-verificado verde.
- **Button con ícono**: el `Button` canónico solo acepta `children: string` (lo envuelve en un `<Text>`). Para el CTA "Agregar evento" con ícono lucide armé un `AddEventButton` a mano replicando la forma del Button con TOKENS (pill, `$touchMin`, `$primary`, `pressStyle`).

### Nuance documentada (no es bug, es fidelidad al server)
- **Orden dentro del mismo día**: `weight_date`/`event_date` de peso/condición son `date` (sin hora) → la RPC los ubica a medianoche (`weight_date + 00:00`). El `initial` (category_change) y las observaciones usan `timestamptz` real. Por eso un peso cargado HOY puede quedar DEBAJO del alta de hoy (cuyo `changed_at` es la hora real de creación), mientras que una observación (created_at = ahora) SIEMPRE queda arriba. El cliente refleja fielmente el `event_date desc` que devuelve la RPC (no invento un orden distinto, eso causaría divergencia cliente/server). La E2E asserta visibilidad, no posición exacta, para no acoplarse a este detalle. Si se quisiera "lo recién cargado siempre arriba" habría que tocar la RPC (backend, fuera de scope C3.1) para el secondary sort por `created_at` que menciona R10.1.

## Verificación (números exactos)

`node scripts/check.mjs` → **TODO VERDE**:
- client unit tests: **241 pass / 0 fail** (incluye los 50 nuevos: 31 event-timeline + 19 event-input).
- Anti-hardcode (ADR-023 §4): **0 violaciones**.
- RLS suite: **17 pass / 0 fail**.
- Edge Functions suite: **36 pass / 0 fail**.
- Animal suite (spec 02): **28 pass / 0 fail**.
- Maneuvers suite (spec 03): **13 pass / 0 fail**.
- typecheck cliente: OK.

`pnpm.cmd e2e` (build web + Playwright) → **26 passed** (incluye los 2 nuevos de `events.spec.ts` y el `animals.spec.ts` actualizado).

## Supuestos / riesgos
- **C3.1 es un slice parcial** de las tasks T3.3/T4.2 (que abarcan también transiciones T3.4, observations.ts T3.5, prompt CUT T4.4, editar/borrar evento C3.3). NO marqué esos T-numbers como `[x]` para no sobre-declarar; lo decide el leader/reviewer.
- El timeline carga ONLINE (igual que C2/C1); el offline-first real es C5 (PowerSync). Sin red → error blando "Sin conexión: no pudimos cargar el historial." con reintentar.
- Límite de filas del timeline: la RPC no pagina; un animal con cientos de eventos trae todo. Aceptable en MVP (un animal de cría no acumula cientos de eventos a corto plazo); virtualización/paginación es refinamiento posterior.

---

# Fix-loop 1 (veto de render del leader, Playwright)

El leader vetó el render de C3.1 con Playwright y encontró 3 cosas: 1 de correctitud (🔴) + 2 de pulido
(🟡/🟢). Frontend-only, sin tocar el resto del scope. Baseline = working tree de C3.1 (sin commitear).

## FIX 1 (🔴 correctitud) — un evento date-only de HOY se mostraba como "Ayer"
**Causa**: los 5 kinds tipados (`weight`/`condition_score`/`sanitary`/`lab_sample`/`reproductive`) tienen
`event_date` en columnas Postgres `date` (sin hora). La RPC `animal_timeline` (0035) las castea a
`timestamptz` → vuelven como UTC-medianoche (`2026-06-02T00:00:00+00:00`). Formateadas en huso AR (UTC-3),
ese instante cae el día anterior → "Ayer". Las observaciones (`created_at`) y `category_change`
(`changed_at`) sí son instantes reales y NO tenían el bug.

**Qué toqué**:
- `app/src/utils/event-timeline.ts`:
  - `formatEventDate(iso, now, opts?: { dateOnly?: boolean })`. Cuando `dateOnly`, trata el valor como
    **fecha calendario**: extrae los componentes **UTC** (`getUTCFullYear/Month/Date` — que SON el día que
    el usuario tipeó, porque el valor es UTC-medianoche) y los compara contra la fecha **local** de `now`.
    Resultado SIN hora: mismo día → "Hoy"; ayer → "Ayer"; mismo año → "DD MMM" (es-AR); otro año →
    "DD/MM/AAAA". Cuando NO `dateOnly` → comportamiento previo intacto (instante en huso local, con hora si
    es hoy: "Hoy HH:MM").
  - `isDateOnlyKind(kind)` + `DATE_ONLY_KINDS` (Set exportable/testeable): true para los 5 kinds con
    columna `date`, false para `observacion`/`category_change` y kinds desconocidos.
- `app/src/components/TimelineEvent.tsx`: el timestamp ahora se formatea con
  `{ dateOnly: isDateOnlyKind(item.kind) }`. Ruteo explícito por kind.

**NO toqué el orden del timeline** (lo fija la RPC `event_date desc`; un date-event a medianoche puede
quedar bajo un timestamp-event del mismo día calendario — correcto y ya documentado). Verificado en el render
(captura 07): Observación/Alta (02:17) arriba, Condición/Pesaje ("Hoy") abajo, igual que antes.

## FIX 2 (🟡 pulido) — el `<textarea>` de Observación mostraba el borde/outline default del browser
**Qué toqué** (`app/app/agregar-evento.tsx`, `ObservationForm`): saqué el wrapper `Card` (bone) y estilé el
`<TextInput multiline>` con el lenguaje de `FormField`: input **blanco** (`$white`) sobre `$bg`, borde 1px
`$divider` (→ `$terracota` si hay error), radio `$card` (16), padding cómodo (`$4`/`$3`), `minHeight` `$10`.
En web sumo `outlineWidth: 0` (fragmento `TextStyle` ramificado por `Platform.OS`, sin cast `as any`) para
matar el focus-ring cuadrado del browser. Saqué el import `Card` (quedó sin usar). Mantuve el contador
"N / 1000" y la a11y (`observationA11y()`, web=`aria-label`/native=`accessibilityLabel`).

**Verificado con un probe Playwright efímero** (computed styles, ya borrado): el `<textarea>` queda con
`outlineWidth: 0px`, `borderTopWidth: 1px`, `borderTopColor: rgb(229,229,227)` (= `$divider`, idéntico a
FormField), `borderRadius: 16px`. (En la captura 05, focuseada, el borde se ve más oscuro por el escalado
del screenshot, pero el computado es el divider claro correcto.)

## FIX 3 (🟢 menor) — ícono propio para el `category_change` con reason `initial`
**Qué toqué** (`TimelineEvent.tsx`): el nodo `category_change` elegía siempre `ArrowRightLeft` (⇄, ida y
vuelta), que no comunica un alta. Ahora: `reason === 'initial'` → `Flag` (🚩, hito de inicio); las
transiciones reales (`auto_transition`/`manual_override`/`revert_to_auto`) siguen con `ArrowRightLeft`.
Distinción por el `reason` del item (ya en el payload). Confirmado en la captura 07 (el "Alta" muestra la
bandera).

## Tests (paso 7)
- `app/src/utils/event-timeline.test.ts`: +11 tests. Para `formatEventDate` con `dateOnly`: hoy (incl. el
  **caso AR** del FIX 1: `2026-06-02T00:00:00+00:00` + `now`=2 jun → "Hoy", a cualquier hora local), ayer,
  mismo año, otro año (todos SIN hora), borde de mes, ISO inválido; un test que demuestra que el MISMO ISO
  sin `dateOnly` se ubica por su día LOCAL ("Ayer") y con `dateOnly` NO ("DD MMM") → el flag cambia el
  resultado; un test de instante con hora (`dateOnly:false` → "Hoy 09:05"). Para `isDateOnlyKind`: los 5
  date-only true, observacion/category_change false, desconocido false.
- **TZ-independientes**: los ISO son literales con `+00:00` y los `now` se construyen con componentes locales
  explícitos (o se compara contra el día local derivado del instante, DST-proof al mediodía). Verificado
  corriendo el archivo bajo TZ=UTC+14 / UTC-10 / UTC-3 (AR) / UTC+5:30 → 44/44 pass en las cuatro.

## Verificación (números exactos)
`node scripts/check.mjs` → **TODO VERDE**:
- client unit tests: **252 pass / 0 fail** (eran 241 en C3.1; +11 de este fix-loop).
- Anti-hardcode (ADR-023 §4): **0 violaciones**.
- RLS suite: **17 pass / 0 fail**.
- Edge Functions suite: **36 pass / 0 fail**.
- Animal suite (spec 02): **28 pass / 0 fail**.
- Maneuvers suite (spec 03): **13 pass / 0 fail**.
- typecheck cliente: OK.

`pnpm.cmd run e2e` → **27 passed** (las 26 specs de la suite real + `_capture-c3.spec.ts` del leader, que
NO toqué). Ningún assert E2E dependía del label "Hoy"/"Ayer" (grep confirmó 0 matches), así que el cambio
de FIX 1 no rompió nada.

## Autorrevisión adversarial (paso 8)
- **(a) FIX 1 no rompe el orden**: solo cambié el LABEL de presentación + agregué un predicado puro
  (`isDateOnlyKind`); el sort de `parseTimeline` (`Date.parse(eventDate) desc`) quedó intacto. Render lo
  confirma (captura 07).
- **(b) Flag `dateOnly` bien ruteado por kind**: `isDateOnlyKind` cubierto por tests; el render muestra
  Pesaje/Condición → "Hoy" (sin hora) y Observación/Alta → "Hoy 02:17" (con hora). Exactamente la distinción
  buscada.
- **(c) Test TZ-independiente**: verificado en 4 husos (UTC+14/-10/-3/+5:30), 44/44 cada uno. No dependo del
  TZ del runner.
- **(d) Textarea sigue accesible**: `observationA11y()` sin cambios (web=`aria-label`, native=
  `accessibilityLabel`); el probe confirmó que es un `<textarea>` alcanzable por `getByLabel('Observación')`;
  events.spec (que usa ese getByLabel) sigue verde. Sin leak de `accessibilityLabel` crudo al DOM web.
- **(e) Ícono `initial` no rompe los otros reasons**: ternario simple sobre `item.reason`; auto/manual/revert
  siguen con `ArrowRightLeft`. `present()` intacto para esos.
- **(f) Tokens-only, sin hardcode**: `check-hardcode.mjs` = 0. Todo color/spacing/radio del textarea vía
  `getTokenValue`; `borderWidth`/`outlineWidth` no son props con escala de token (no las marca el lint, igual
  que FormField).
- **Hallazgo durante la implementación**: `outlineStyle: 'none'` NO compila — el `TextStyle` de RN tipa
  `outlineStyle` como `'solid'|'dotted'|'dashed'|undefined`. Lo cerré con `outlineWidth: 0` (tipado, RN-web lo
  traduce a `outline: none` en el DOM). Re-typecheck verde + probe confirma `outlineWidth: 0px` aplicado.

## Supuestos del fix-loop
- "Date-only → sin hora nunca": para weight/condition/sanitary/lab/repro el label no muestra hora (la fuente
  es una columna `date`, no hay hora real que mostrar). Es lo correcto y lo pedido.
- Dejé el textarea como input blanco sobre `$bg` (saqué la `Card` bone) por ser lo más consistente con
  `FormField` (que es justo el lenguaje al que el leader pidió alinearlo). Si se prefiere mantenerlo DENTRO de
  una card, es un ajuste menor — avisar.
- **No commiteé** (lo hace el leader). Cambios sin commitear, listos para el reviewer.

---

# Fix-loop 2 (Raf probó en web — 3 cosas)

Frontend-only, sin tocar el resto del scope. Baseline = working tree de C3.1 (sin commitear). Raf
marcó: A (🔴 bug a11y), B (🟡 dominio del peso), C (🟢 decisión de modelo — estado actual). NO toqué
archivos de terminales paralelas (specs 04/08/10/12, ads, Profile.pdf, tests/).

## FIX A (🔴) — leak de `accessibilityLabel` al DOM web sobre primitivos de Tamagui

**Causa**: los primitivos de Tamagui (`View`/`XStack`/`YStack`/`Text`/`Stack`) NO mapean
`accessibilityLabel` → `aria-label` en web → lo filtran crudo al `<div>` → React tira "does not
recognize the `accessibilityLabel` prop on a DOM element" (misma clase que el overlay de C1). El
`Pressable`/`TextInput` de RN SÍ lo mapea — esos están bien y NO se tocaron.

**Qué toqué**:
- `app/src/utils/a11y.ts`: nuevo helper `labelA11y(platform, label)` — web `{ 'aria-label': label }`,
  native `{ accessibilityLabel: label }`. Para elementos DISPLAY etiquetados NO interactivos (chips,
  badges). Complementa `buttonA11y`/`switchA11y` (esos son para CONTROLES). +2 tests
  (`a11y.test.ts`): web emite SOLO `aria-label` (cero `accessibility*`), native SOLO
  `accessibilityLabel` (cero `aria-*`/`role`).
- `app/src/components/CategoryBadge.tsx`: el `<View>` raíz (línea 41) pasaba `accessibilityLabel`
  crudo → `{...labelA11y(Platform.OS, a11yLabel)}`. Se usa en el hero Y en CADA fila de la lista →
  warneaba muchas veces.
- `app/app/animal/[id].tsx`: el chip de sexo del hero (`<XStack accessibilityLabel={...}>`, línea
  195) → `{...labelA11y(Platform.OS, …)}`.

**Sweep transversal** de `app/app/**` + `app/src/components/**` (`accessibilityLabel=`): **29 usos
totales**, de los cuales **EXACTAMENTE 2 eran leaks reales** sobre primitivo de Tamagui (los 2 de
arriba: CategoryBadge `<View>`, ficha `<XStack>`). Los otros 27 NO son leaks y se dejaron intactos:
- **22 sobre `<Pressable>`** de RN (mapea bien a `aria-label`): `mas.tsx` 94/273/542/599/635/846,
  `miembros.tsx` 161/184/430/473/692, `mis-campos.tsx` 50/123, `index.tsx` 76/198, `_layout.tsx` 143,
  `invitar.tsx` 187, `AnimalRow.tsx` 162, `AuthBits.tsx` 61, `EstablishmentCard.tsx` 248,
  `EstablishmentSwitcherDropdown.tsx` 151/259, `ShareLink.tsx` 95/123.
- **2 sobre `<TextInput>`** de RN (mapea bien): `mis-campos.tsx` 105, `animales.tsx` 386.
- **3 props de componente** que internamente rutean por `buttonA11y`/un `<Pressable>` (NO tocan un
  primitivo crudo): `animales.tsx` 262/272/281 (`FilterChip` → `buttonA11y`), `mas.tsx` 793/811/834
  (`ActionRow` → su `<Pressable>` línea 94), `EstablishmentSwitcherDropdown.tsx` 295/311 (`SwitcherRow`
  → su `<Pressable>` línea 151).
- Ya estaban resueltos con la rama web=aria/native=accessibilityLabel inline: `crear-rodeo.tsx`
  (ProgressBar/toggle), `agregar-evento.tsx` (textarea), `FieldTemplateToggleList.tsx`. No tocados.

Con esto queda **cerrado el "leak a11y transversal" del backlog**: ya no hay ningún
`accessibilityLabel` crudo sobre un primitivo de Tamagui en las dos carpetas barridas. El helper
`labelA11y` deja la barrera centralizada (el test asegura que web nunca emite `accessibility*`).

## FIX B (🟡) — peso: máximo 4 cifras enteras (≤ 9999 kg)

Dominio: el bovino más pesado registrado pesó 1.740 kg; ninguno llega a 5 cifras (10.000). Cap sobre
la **parte entera** (los decimales, ej. 320,5, siguen permitidos).

**Qué toqué**:
- `app/src/utils/animal-input.ts` (`sanitizeWeightInput`): nueva const `WEIGHT_INTEGER_MAX_DIGITS = 4`;
  el sanitizer cuenta los dígitos ANTES del separador y descarta el 5to+. Compartido por C2
  (entry_weight del alta) y C3 (evento de peso) — el cap aplica bien a ambos (ambos son pesos de
  bovino). +1 test (`animal-input.test.ts`): "12345"→"1234", "99999"→"9999", "1740" OK, "320,5" OK,
  "12345,5"→"1234,5" (cap solo sobre enteros), "99999,99"→"9999,99".
- `app/src/utils/event-input.ts` (`validateWeight`): renombré `WEIGHT_KG_MAX = 99999.99` →
  `WEIGHT_KG_LIMIT = 10000` (tope EXCLUSIVO). Rechaza `n >= 10000` con copy "El peso no puede tener más
  de 4 cifras." +1 test: 9999 OK, 9999,99 OK, 10000 rechazado, límite exclusivo.
- `app/src/utils/animal-form.ts` (`validateAnimalCreate`, backstop de C2 entry_weight): const local
  `WEIGHT_KG_LIMIT = 10000` (no value-import entre siblings por el runner node:test, ver nota de
  event-input); rechaza ≥10000 con el mismo copy. +1 test (`animal-form.test.ts`): 9999 OK, 1740 OK,
  10000 rechazado.
- Comentarios doc actualizados en `event-input.ts` (header) y `services/events.ts` (`AddWeightInput`).

Verifiqué que **ningún test/e2e usaba un peso de 5 cifras**: el único que tocaba el viejo máximo era
`event-input.test.ts` (`validateWeight('99999.99')` OK) — lo ajusté al comportamiento correcto (9999
OK / 10000 rechazado).

## FIX C (🟢) — datos medidos = ESTADO ACTUAL del animal, no solo eventos

Modelo: el animal tiene un **valor vigente** de cada medición tipada = el del **último evento** de ese
tipo, mostrado como atributo en la ficha; el timeline queda como auditoría/historial. Solo las
observaciones libres quedan únicamente en el timeline (no tienen "valor actual"). Para C3.1 los tipos
cargables son peso + condición corporal.

**Qué toqué**:
- `app/src/utils/event-timeline.ts`: helper PURO `deriveCurrentState(timeline)` → `{ weight?: { kg,
  date }, conditionScore?: { score, date } }`. Elige el item de **mayor `eventDate`** de cada kind
  (`weight`/`condition_score`) — NO asume orden (recorre y toma el máximo, robusto ante cualquier
  orden de entrada, NO confía en el sort de `parseTimeline`); empate exacto → desempata por `eventId`
  mayor (mismo criterio que `parseTimeline`). Ignora eventos con valor null (no surfacea un peso sin
  número) y kinds no-medición. Timeline vacío/null → `{}`. Tipo `CurrentState` exportado. **+9 tests**
  (`event-timeline.test.ts`): vacío/null/undefined, máximo desordenado, no-confía-en-parseTimeline,
  peso+condición a la vez, solo-condición, ignora-null, ignora-no-medición, empate por eventId.
- `app/app/animal/[id].tsx`: nueva sección **"Estado actual"** (`CurrentStateSection`) ENTRE "Datos
  del animal" y "Historial". Reusa `DetailSection` (ícono `Gauge` $primary sobre $greenLight) +
  `CurrentStateRow` (espeja `AttributeRow`: label muted + valor 600). Filas "Peso actual" y "Condición
  corporal", cada una con valor + timestamp embebido ("320 kg · Hoy", vía
  `formatEventDate(date, now, { dateOnly: true })` — peso/condición son date-only). Sin evento de ese
  tipo → "Sin registrar" (muted, consistente con los "—" de la ficha). La sección se muestra SIEMPRE.
- El **timeline (Historial) NO cambia**: sigue renderizando TODOS los eventos (incl. pesos/condiciones
  = la auditoría). La observación libre NO va a "Estado actual" (solo timeline).
- **Arquitectura a futuro** (documentada en el código, NO implementada): "Estado actual" escala en
  C3.2 a estado reproductivo (preñez) y última sanidad sumando campos a `CurrentState` + filas;
  `deriveCurrentState` es el punto de extensión.
- E2E (`events.spec.ts`): tras cargar el peso 320, asserta que "Estado actual" muestra "Peso actual" +
  `/320 kg · /` y que "Condición corporal" → "Sin registrar". + assert FIX B: el campo de peso no
  acepta 5 cifras ("12345" → "1234").

## Verificación (números exactos)

`node scripts/check.mjs` → **TODO VERDE**:
- typecheck cliente: OK.
- client unit tests: **264 pass / 0 fail** (eran 252 en fix-loop 1; +12 netos: +2 labelA11y, +1 cap
  sanitizer, +1 cap validateWeight, +1 cap entry_weight, +9 deriveCurrentState, −2 por refactor del
  test viejo de WEIGHT_KG_MAX que se fusionó/ajustó).
- Anti-hardcode (ADR-023 §4): **0 violaciones**.
- RLS suite: **17 pass / 0 fail**.
- Edge Functions suite: **36 pass / 0 fail**.
- Animal suite (spec 02): **28 pass / 0 fail** (FIX B en entry_weight no regresó el alta).
- Maneuvers suite (spec 03): **13 pass / 0 fail**.

`pnpm.cmd run e2e` (build web + Playwright) → **26 passed / 0 failed** (rebuild + suite completa; los
2 de `events.spec.ts` con los asserts nuevos de FIX C y FIX B).

## Autorrevisión adversarial (paso 8)

Busqué activamente, como revisor hostil:
- **(a) El sweep de a11y no rompió ningún a11y existente ni tocó Pressables que andan.** Confirmado:
  los 27 no-leaks (22 Pressable + 2 TextInput + 3 props que rutean por buttonA11y/Pressable) quedaron
  intactos; solo cambié los 2 primitivos crudos. Los e2e que dependen de `getByRole('button', { name
  })` / `getByLabel(...)` (animals, rodeos BUG2 aria-checked, profile, events) siguen verdes → la a11y
  real no se degradó.
- **(b) `labelA11y` emite lo correcto por plataforma.** Test dual: web SOLO `aria-label` (cero
  `accessibility*` → no filtra al DOM), native SOLO `accessibilityLabel` (cero `aria-*`/`role`). Es la
  garantía load-bearing contra el warning.
- **(c) El cap de peso no rompe C2 (entry_weight).** El sanitizer es compartido → el alta también
  capea a 4 enteros (correcto, es peso de bovino); el backstop de `validateAnimalCreate` rechaza
  ≥10000. Animal suite (28) + animal-form.test (FIXB) verdes. No hay test/e2e con 5 cifras (verificado
  por grep; el único que tocaba el viejo máximo se ajustó).
- **(d) `deriveCurrentState` toma el máximo (no asume orden) y maneja timeline vacío.** Test explícito
  pasando items SIN ordenar (no vía parseTimeline) → elige el máximo igual. Vacío/null/undefined → `{}`
  (no crashea). Ignora valor-null (no surfacea peso sin número) y kinds no-medición.
- **(e) "Estado actual" no duplica ni oculta el historial.** Es derivado/read-only; `HistorySection`
  abajo sigue mapeando TODOS los items (incl. los pesos/condiciones que también surfacean arriba). E2E
  confirma: el "320 kg" del timeline (exact) Y el "320 kg · Hoy" del estado actual coexisten.
- **(f) Tokens-only, sin hardcode.** `check-hardcode.mjs` = 0. La sección nueva usa solo tokens
  ($body, $3/$5, $textMuted/$textPrimary, $greenLight, $primary via getTokenValue del DetailSection).
- **(g) Sin leak nuevo de a11y.** La sección "Estado actual" es solo `<Text>`/`<YStack>` sin
  `accessibilityLabel` → cero riesgo. No introduje ningún `accessibilityLabel` crudo nuevo.

### Hallazgos corregidos durante la implementación
- **E2E rota por el assert de FIX B**: agregué `fill('12345')→'1234'` ANTES del submit-con-peso-vacío
  del 2do test → el campo quedaba con "1234" y el submit ya no era inválido → el test fallaba. Lo cerré
  re-vaciando el campo (`fill('')`) tras el assert del cap, antes de la prueba de peso vacío.
  Re-corrido: ambos events.spec verdes.
- **`CurrentStateRow` con prop `icon` sin usar**: lo había tipado con `icon: LucideIcon` pensando en un
  ícono por fila, pero la sección ya lleva el ícono en el header (`DetailSection`). Saqué el prop (y el
  import `Activity` que quedó sin usar) para no dejar ruido / unused.

### Nuance documentada (no es bug)
- Si el fetch del timeline falla (error) pero el del detalle no, "Estado actual" muestra "Sin
  registrar" en ambas filas (porque `deriveCurrentState(null)` → `{}`). Es coherente con el brief ("se
  muestra siempre") y el usuario tiene señal clara: el `HistorySection` justo debajo muestra el error
  + "Reintentar". En la práctica ambos fetches van en el mismo `Promise.all` y un error de red pega a
  los dos. No lo sobre-ingenierié (sería scope creep); lo dejo anotado.

## Supuestos del fix-loop 2
- **`labelA11y` es para elementos DISPLAY etiquetados** (chips/badges/grupos de íconos con
  significado), NO para controles (esos van por `buttonA11y`/`switchA11y`). No cambié ningún control.
- **Cap de peso = 4 cifras ENTERAS** (los decimales no se limitan): 9999,99 es válido; 10000 no. Tope
  exclusivo < 10000.
- **`formatKg` duplicado** (en `animal/[id].tsx` y `TimelineEvent.tsx`): 3 líneas presentacionales; no
  lo extraje a un util compartido para no agregar churn a TimelineEvent en un fix-loop. Si el reviewer
  prefiere centralizarlo, es trivial — avisar.
- **No commiteé** (lo hace el leader). Cambios sin commitear, listos para el reviewer.
