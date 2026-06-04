baseline_commit: 655a200e4884b9b29161d849119acb37390213e8

# Bitácora — C3.2a (frontend spec 02): Tacto + Servicio simples + preñez en "Estado actual"

Frontend PURO. Backend reproductivo (`reproductive_events`, RPC `animal_timeline` 0035, transiciones de
categoría server-side) ya existe. NO se tocó `supabase/` ni se escribieron migraciones.

## Plan (tareas del brief)

- T1 — `services/events.ts`: `addTacto` / `addService` (insert SIN `.select()`) + enriquecimiento de
  `service_type` en `fetchTimeline` (query suplementaria tolerante).
- T2 — `utils/event-timeline.ts`: `humanizeServiceType`, `applyServiceTypes`, `ServiceType` type, campo
  `serviceType` en el item reproductive; extensión de `CurrentState` con `pregnancy` + `PregnancyState`
  + lógica de preñez en `deriveCurrentState` + `humanizePregnancyState`.
- T3 — `utils/event-input.ts`: `PREGNANCY_OPTIONS`, `SERVICE_TYPE_OPTIONS` (listas cerradas).
- T4 — `app/agregar-evento.tsx`: paso 1 agrupado (General / Reproductivo) + TactoForm + ServiceForm +
  selector vertical full-width + ramas de submit.
- T5 — `app/animal/[id].tsx`: fila "Estado reproductivo" en "Estado actual" (solo hembras).
- Tests: unit puros (event-timeline / event-input) + E2E (events.spec.ts).

## Trazabilidad (R → test)

- R6.2 (reproductive_events: tacto/servicio) → `addTacto`/`addService` (services); E2E `events.spec.ts`
  ("Reproductivo → Tacto / Servicio").
- R10 / R14.3 (cronología + componente por evento) → `applyServiceTypes`, `humanizeServiceType`,
  parser `serviceType` (event-timeline.test.ts); E2E (timeline muestra Tacto/Servicio/Monta natural).
- Preñez en Estado actual (extensión de `deriveCurrentState`, brief T2.b/T5) →
  `deriveCurrentState`/`humanizePregnancyState` (event-timeline.test.ts); E2E (Estado reproductivo).

## Cambios por archivo

- **`app/src/utils/event-timeline.ts`** (T2): `ServiceType` type + campo `serviceType` en el item
  `kind:'reproductive'` (parser lo deja `null`); `applyServiceTypes(items, byId)` puro (espejo de
  `resolveCategoryNames`, NO muta, tolerante a ids faltantes y valores no-enum); `PregnancyState` type
  + `pregnancy?` en `CurrentState`; extensión de `deriveCurrentState` (elige el repro determinante más
  reciente entre tacto/birth/abortion vía la MISMA `isNewer`/desempate por eventId; service/weaning/
  drying/rejection se ignoran) + helper `toPregnancyState`; `humanizeServiceType` + `humanizePregnancyState`.
- **`app/src/services/events.ts`** (T1): `addTacto` / `addService` (insert SIN `.select()`, payload
  mínimo, inputs tipados con uniones literales, `created_by` por trigger documentado, repro deriva el
  tenant por RLS → solo `profileId`); `fetchTimeline` reestructurado: resolución de categorías ahora
  tolerante-sin-early-return + (2) query suplementaria a `reproductive_events(id, service_type)` solo si
  hay items reproductive → `applyServiceTypes`. Si la query falla, el timeline NO se pierde.
- **`app/src/utils/event-input.ts`** (T3): `PREGNANCY_OPTIONS` (4) + `SERVICE_TYPE_OPTIONS` (3), listas
  cerradas = fuente de verdad de los selectores (garantizan valor de enum válido).
- **`app/app/agregar-evento.tsx`** (T4): paso 1 agrupado (`SectionLabel` "General" / "Reproductivo",
  Gestalt) + 2 TypeCards nuevas (Tacto = `Stethoscope` "Diagnóstico de preñez", Servicio =
  `HeartHandshake` "Monta natural, IA o TE"); `EventType` += `tacto|service`; `OptionSelector<T>`
  genérico (selector vertical full-width, fila ancha, selected = relleno `$primary` + `Check`, a11y por
  `buttonA11y`); `TactoForm` (selector + fecha prefill hoy) + `ServiceForm` (selector + fecha + notas
  OPCIONALES); `NotesField` extraído de `ObservationForm` (reusable, label/placeholder/a11yLabel
  configurables); ramas de submit tacto/service con sus validaciones; títulos del paso 2.
- **`app/app/animal/[id].tsx`** (T5): `CurrentStateSection` recibe `sex`; fila "Estado reproductivo"
  (texto `humanizePregnancyState` + fecha `formatEventDate(dateOnly)`) SOLO si `sex==='female'`;
  ausente → "Sin registrar".
- **`app/src/components/TimelineEvent.tsx`**: caso `reproductive` → detalle = `preg ?? svc ?? notes`
  (servicio muestra su tipo enriquecido).
- **Tests**: `event-timeline.test.ts` (+ applyServiceTypes ×5, humanizeServiceType, humanizePregnancyState,
  deriveCurrentState preñez ×9, parse serviceType=null); `event-input.test.ts` (+ PREGNANCY_OPTIONS /
  SERVICE_TYPE_OPTIONS ×2); `e2e/events.spec.ts` (+ test repro: tacto preñez media → estado reproductivo
  + transición de categoría real server-side → servicio Monta natural; + fix `.first()` en el test #1
  porque ahora la hembra tiene 2 filas "Sin registrar").

## Autorrevisión adversarial (paso 8)

Busqué activamente, como revisor hostil:
- **Preñez tras birth/abortion**: el último determinante gana, no el último tacto. Cubierto (BIRTH posterior
  a tacto positivo → vacía via birth; abortion → vacía via abortion).
- **service NO determina preñez**: un servicio nuevo NO borra una preñez vigente del tacto. Cubierto
  ("service/weaning/drying/rejection NO determinan preñez").
- **tacto con status null/desconocido**: NO surfaceamos preñez a ciegas → pregnancy ausente. Cubierto.
- **Hembra vs macho en Estado actual**: la fila repro solo para hembras; macho no la renderiza (no crash).
  E2E test #2 (macho) no asserta la fila; E2E test #3 (hembra) la verifica.
- **Service sin notas**: vacío es válido (no se manda `notes`); con texto, backstop de tope. `notesOk`
  no bloquea el caso vacío. E2E (Monta natural sin notas) pasa.
- **Enriquecimiento de service_type tolerante a fallo**: si la query suplementaria falla, el timeline NO
  se pierde (items sin serviceType). `applyServiceTypes` tolera ids faltantes + valores no-enum → null.
- **Fecha futura**: `validateEventDate` reusado tal cual (rechaza futura) en tacto y service.
- **Leak a11y**: `OptionSelector` y `NotesField` usan los helpers / ramas por plataforma; cero
  `accessibilityLabel` crudo. Anti-hardcode 0.
- **Multi-tenant**: tacto/service NO mandan establishment_id (repro deriva el tenant por RLS); solo
  `profileId`. `created_by` por trigger. Inserts SIN `.select()`.
- **Regresión que YO introduje y cacé**: el test #1 de events.spec (hembra) ahora tiene 2 filas
  "Sin registrar" (condición + estado reproductivo) → ajusté a `.first()`. Re-verificado verde.
- **Limpieza de la rama service-notes**: reescrita (había un `return` muerto) → `notesOk` flag, más legible.

## Hallazgo para el leader (NO es regresión de C3.2a)

`e2e/animals.spec.ts` "alta desde empty …" FALLA con "Elegí un rodeo para el animal." — el rodeo único
no se auto-selecciona antes de que el test clickee "Crear animal". **Confirmado pre-existente**: stasheé
TODAS mis fuentes, rebuildié contra el baseline `655a200` y el test SIGUE fallando → es una carrera async
en `crear-animal.tsx` (el efecto que resuelve el rodeo default hace `readLastRodeo` + posible
`queryLastUsedRodeoFromDb` contra el remoto; si tarda, `selectedRodeoId` queda null al submit) + el test
no espera a que el selector de rodeo se popule. NO lo toqué (fuera de mi scope C3.2a; `crear-animal.tsx`
es de C2, ya commiteado `e8ad803`). La sesión previa lo reportó verde (timing/estado del remoto distinto).

## Conteos finales

- **`node scripts/check.mjs` COMPLETO**: VERDE. anti-hardcode **0**, client unit **282/282**, RLS **17/17**,
  Edge **36/36**, Animal **28/28**, Maniobras **13/13**. typecheck cliente OK.
- **`pnpm e2e`**: **26 passed / 1 failed** — el único rojo es el flake pre-existente de `animals.spec.ts`
  (rodeo-default race, reproducido al baseline con mis fuentes stasheadas → NO es de C3.2a). Mis 3 tests
  de `events.spec.ts` (incl. el repro nuevo) pasan; los otros 23 pasan.

---

Fix post-test Raf: etiquetas cabeza/cola invertidas → corregidas (small=cola, large=cabeza).

Detalle del fix (swap puro de etiquetas es-AR; valores del enum DB intactos):
- `event-input.ts` `PREGNANCY_OPTIONS`: small→"Preñez chica (cola)", large→"Preñez grande (cabeza)" (medium=cuerpo, empty=Vacía sin tocar).
- `event-timeline.ts` `PREGNANCY_LABELS` (humanizePregnancyStatus): small→"Preñez chica (cola)", large→"Preñez grande (cabeza)".
- `event-timeline.ts` `humanizePregnancyState`: small→"Preñada — chica (cola)", large→"Preñada — grande (cabeza)".
- Comentarios de dominio actualizados (PregnancyStatus type, doc de humanizePregnancyState) al orden cola/cuerpo/cabeza.
- Tests unit: `event-timeline.test.ts` (humanizePregnancyStatus large + small explícito; humanizePregnancyState small/large); `event-input.test.ts` PREGNANCY_OPTIONS reforzado con aserción explícita del mapeo anatómico (small=cola/medium=cuerpo/large=cabeza) — antídoto contra re-inversión.
- E2E `events.spec.ts`: el selector del tacto C3.2b (línea 252) usaba el label viejo "Preñez grande (cola)" para `large` → actualizado a "Preñez grande (cabeza)" (mismo intent: elegir `large`); comentario L227 alineado. El repro C3.2a (línea 186) usa medium="Preñez media (cuerpo)" → NO cambia.
- Fuente del mapeo: CONTEXT/03 L53 ("cabeza/cuerpo/cola equivale a grande/mediana/chica").

Verificación: `node scripts/check.mjs` COMPLETO **VERDE** — anti-hardcode 0; client unit **289/289**; RLS 17/17; Edge 36/36; Animal 28/28; Maniobras 13/13; typecheck cliente OK.
`pnpm e2e`: **27 passed / 1 failed**. El único rojo es la prueba C3.2b "parto con mellizos" (de otra terminal, NO es de este fix), y es un FLAKE de timing: el punto de fallo se MUEVE entre corridas (una vez en L281 "Vacía ·", otra en L299 card "Madre"), nunca en mi línea modificada. Mi selector de tacto "Preñez grande (cabeza)" (L252) PASA todas las corridas, y los 3 tests C3.2a (incl. "Preñada — media (cuerpo)") pasan. El swap de etiquetas no cambia la lógica de refresh post-parto (solo el término es-AR mostrado).

---

## Cierre C3.2 — B1 (etiquetas de tacto) + fix de desempate (created_at) [run de cierre, leader]

Run acotado de cierre de C3.2 (frontend puro). El flake del parto resultó tener DOS causas reales (no era timing puro): un no-determinismo en `deriveCurrentState` + un bug latente en `fetchMother`.

### B1 — etiquetas de tacto = solo término de campo (decisión Facundo §4)
El selector y el timeline muestran SOLO el término de campo (Cabeza/Cuerpo/Cola), sin "preñez chica/media/grande". La fila de estado lleva "Preñada (...)" con el término entre paréntesis. Mapeo al enum DB intacto: `small=cola`, `medium=cuerpo`, `large=cabeza`, `empty=Vacía`.
- `event-input.ts` `PREGNANCY_OPTIONS`: **Vacía / Cola / Cuerpo / Cabeza** (selector del tacto).
- `event-timeline.ts` `PREGNANCY_LABELS` (`humanizePregnancyStatus`, detalle del nodo "Tacto"): empty→Vacía, small→Cola, medium→Cuerpo, large→Cabeza.
- `event-timeline.ts` `humanizePregnancyState` (fila "Estado reproductivo" de la ficha): empty→Vacía, small→**Preñada (cola)**, medium→**Preñada (cuerpo)**, large→**Preñada (cabeza)**.
- Tests: `event-input.test.ts` (PREGNANCY_OPTIONS = términos + guard anti-tamaño) + `event-timeline.test.ts` (humanizePregnancyStatus / humanizePregnancyState con los nuevos labels + guard `doesNotMatch /chica|media|grande/`).
- E2E `events.spec.ts`: tacto C3.2a `'Preñez media (cuerpo)'`→**'Cuerpo'**, `/Preñada — media \(cuerpo\)/`→`/Preñada \(cuerpo\)/`; parto C3.2b `'Preñez grande (cabeza)'`→**'Cabeza'**. Comentario stale en `agregar-evento.tsx` corregido.

### Fix de desempate (created_at) — raíz del flake del parto (TAREA 2)
**Bug**: `deriveCurrentState` elegía el evento repro determinante (tacto/birth/abortion) más reciente por `eventDate`; al empatar la FECHA (mismo día, columna `date` SIN hora), desempataba por `eventId` (UUID **random**) → un tacto y un parto del mismo día daban resultado **no determinístico** (~50% "Preñada" del tacto en vez de "Vacía" del parto). El parto/aborto SIEMPRE debe ganar al tacto del mismo día.

**Diseño del fix (orden total real por `created_at`)**:
- `event-timeline.ts`: el item `kind:'reproductive'` suma `createdAt: string | null` (el parser lo deja `null`, igual que `serviceType`). `applyServiceTypes` → reemplazada por **`applyReproMeta(items, byId: Record<id, {serviceType?, createdAt?}>)`** que setea AMBOS desde el mapa (puro, no muta, tolerante). En `deriveCurrentState`, los items repro usan un comparador propio `isNewerRepro`: **mayor `eventDate` → si empata, mayor `createdAt` (solo si AMBOS lo tienen y difieren) → si empata/falta en alguno, mayor `eventId`** (fallback = comportamiento previo). weight/condition NO cambian (siguen fecha→eventId).
- `services/events.ts`: la query suplementaria de `fetchTimeline` ahora trae `id, service_type, created_at` → mapa `id → {serviceType, createdAt}` → `applyReproMeta`. Tolerante: si la query falla, el timeline NO se pierde (createdAt queda null → cae al desempate por eventId).
- Tests: `event-timeline.test.ts` — tacto vs birth MISMO día con createdAt del birth posterior → `empty` (gana birth), **determinístico invirtiendo orden de entrada y con el eventId del tacto MAYOR** (prueba que NO decide el eventId); idem tacto vs abortion; ambos createdAt null → cae a eventId (previo); createdAt en uno solo → cae a eventId; createdAt NO afecta cuando los eventDate difieren. TZ-independientes.
- (Se eliminó el wrapper deprecado `applyServiceTypes`: nada del app lo usaba ya; su comportamiento de service_type quedó cubierto por los tests de `applyReproMeta`.)

### Robustecimiento del E2E del parto (TAREA 3) — 2 bugs reales destapados
Con el determinismo, la aserción "Vacía" del parto pasó a ser estable. Al robustecer el resto del test (anclas por ESTADO, no `waitForTimeout`) salieron 2 bugs que el flake enmascaraba:
- **🔴 `fetchMother` (link a la madre NUNCA funcionaba)**: embed ambiguo por las 3 FKs de `reproductive_events`→`animal_profiles` → disambiguado con `animal_profiles!animal_profile_id!inner`. (Detalle en `impl_02-frontend-c3.2b-parto-madre.md`.)
- **🔴 cleanup E2E (residuo en remoto)**: `birth_calves.calf_profile_id` sin CASCADE bloqueaba el teardown → fix en `e2e/helpers/admin.ts` (borrar `reproductive_events` antes de los establishments).
- Anclas nuevas: esperar que `Cargando ficha…` desaparezca + `Historial` reaparezca (refetch completo) antes de asertar estado; filtro `.filter({ visible: true })` para el motherIdv/Parto (Expo Router web deja pantallas previas montadas aria-hidden → duplicados en DOM).

### Verificación de cierre
- `node scripts/check.mjs` COMPLETO **VERDE**: anti-hardcode **0**; typecheck cliente OK; client unit **293/293**; RLS **17/17**; Edge **36/36**; Animal **28/28**; Maniobras **13/13**.
- `pnpm e2e`: **28 passed / 0 failed** (el parto C3.2b ahora es verde estable; era el 1 que fallaba).
- Test de parto **5/5** con `npx playwright test events.spec.ts -g "parto con mellizos" --repeat-each=5`. Cero residuo en el remoto (sin warnings de FK en el cleanup).

Archivos tocados (frontend + tests + e2e, cero backend/migraciones): `app/src/utils/event-input.ts`, `app/src/utils/event-timeline.ts`, `app/src/services/events.ts`, `app/app/agregar-evento.tsx` (solo comentario stale), `app/src/utils/event-input.test.ts`, `app/src/utils/event-timeline.test.ts`, `app/e2e/events.spec.ts`, `app/e2e/helpers/admin.ts`.

---

## Fix de navegación — back ROBUSTO (`backOr`) [run del implementer, baseline `655a200`]

**BUG (Raf, en `pnpm web`)**: quedó trabado — ni "Guardar evento" (`router.back()`) ni la flechita "Volver" lo devolvían a la ficha; tampoco desde el selector de tipo de evento. Consola: `The action 'GO_BACK' was not handled by any navigator. Is there any screen to go back to?`.

**Causa raíz**: `router.back()` "pelado" asume que SIEMPRE hay pantalla previa. En WEB, recargar la página / un hot-reload de Metro RESETEAN el historial de navegación a la ruta actual → el stack queda con 1 sola entrada y `router.back()` no tiene a dónde ir; falla silenciosamente y deja al usuario varado. NO es solo de DEV: el mismo stack-vacío pasa con deep-link / cold-start aterrizando directo en una ruta profunda — las rutas de RAFAQ son un Stack PLANO (`animal/[id]`, `agregar-evento`, `crear-animal` son `Stack.Screen` hermanas en `app/_layout.tsx`), así que sin pantalla previa no hay fallback automático.

**Fix — helper `backOr` + fallback conocido**:
- **`app/src/utils/nav.ts`** (NUEVO): `export function backOr(router: ImperativeRouter, fallback: Href): void` → `router.canGoBack() ? router.back() : router.replace(fallback)`. Tipado SIN `any` (router = `ImperativeRouter` que devuelve `useRouter()`; fallback = `Href`, ambos de `expo-router`). PURO respecto de React/RN. `replace` (no `push`) en el fallback: no apilar el destino sobre la ruta huérfana. Doc del por qué (web-refresh/hot-reload/deep-link/cold-start).
- **`app/app/agregar-evento.tsx`**: `backFallback` (`useMemo` por `profileId`) = ficha del animal `{ pathname: '/animal/[id]', params: { id: profileId } }` si hay `profileId`, si no `/(tabs)/animales` (fallback seguro, no rompe). Aplicado en `finishSubmit` (éxito) y en `goBack` cuando `step===1`. El caso `step===2` (que hace `setStep(1)` — "Cambiar de tipo") NO cambia.
- **`app/app/animal/[id].tsx`**: flechita "Volver" → `backOr(router, '/(tabs)/animales')`.
- **`app/app/crear-animal.tsx`**: flechita "Volver" → `backOr(router, '/(tabs)/animales')`. El `router.replace(...)` post-create de `onSubmit` (R4.7) NO se tocó (ya es robusto).
- **`scripts/run-tests.mjs`**: cableado `app/src/utils/nav.test.ts` en la lista de unit tests del cliente.

**Ruta de fallback de la lista de animales elegida = `/(tabs)/animales`**. Confirmada por triangulación: (a) la home navega ahí (`app/app/(tabs)/index.tsx` L465: `router.navigate('/(tabs)/animales')`); (b) el helper E2E `gotoAnimales` llega por la tab "Animales"; (c) typecheck del routing tipado de expo-router la valida como `Href`. Para la ficha y el alta elegí la lista de animales (no `/(tabs)` home) porque es de DONDE se llega a ambas pantallas (tap en la fila R1.3 / no-match R1.4) — el "volver" más natural cuando el stack está vacío. Para `agregar-evento` el fallback es la FICHA del animal (de donde se abre "Agregar evento"); solo cae a `/(tabs)/animales` si faltan params.

**NO tocado**: `app/_layout.tsx` (el Stack y el gating), el resto de la navegación, el `router.replace` post-create. El barrido de `backOr` en OTRAS pantallas (crear-rodeo, miembros, etc.) → anotado en `docs/backlog.md`, NO tocado en este run.

### Trazabilidad (R → test)
- `backOr` canGoBack()===true ⇒ `back()` y NO `replace` → `app/src/utils/nav.test.ts` ("canGoBack()===true → llama back() y NO replace()").
- `backOr` canGoBack()===false ⇒ `replace(fallback)` y NO `back()` (la rama del BUG) → `app/src/utils/nav.test.ts` ("canGoBack()===false → llama replace(fallback) y NO back()").
- `backOr` pasa el fallback EXACTO (objeto Href con params) → `app/src/utils/nav.test.ts` ("pasa el fallback EXACTO recibido a replace").
- Los flujos normales (con stack) siguen usando `router.back()` → cubierto por E2E `events.spec.ts` / `animals.spec.ts` (Guardar evento + "Volver" con stack real, 28/28). No se simula stack vacío en E2E (difícil en Playwright); el unit de `backOr` cubre la rama de fallback.

### Autorrevisión adversarial (paso 8)
Busqué activamente, como revisor hostil:
- **Regresión del caso normal/E2E**: en E2E el stack SIEMPRE existe (push real ficha→agregar-evento) → `canGoBack()===true` → `router.back()`, IDÉNTICO al comportamiento previo. Verificado: `events.spec.ts` L276 (Guardar) y L303 ("Volver") siguen verdes, 28/28.
- **`finishSubmit` y el refresh del timeline**: en la rama back() el `useFocusEffect` de la ficha refetcha (igual que antes); en la rama replace() la ficha MONTA fresca y `useFocusEffect`→`load()` corre igual → el evento nuevo aparece en ambos caminos. No se pierde el refresh.
- **`profileId` null en agregar-evento**: NO rompe — cae a `/(tabs)/animales` (fallback seguro), no a un `{ pathname: '/animal/[id]', params: { id: null } }` inválido.
- **`push` vs `replace` en el fallback**: usé `replace` a propósito — `push` apilaría el destino sobre la ruta huérfana y volvería a confundir el "volver". Documentado.
- **Tipado sin `any`**: `ImperativeRouter` + `Href` importados de `expo-router`; typecheck verde. El mock del test castea `as unknown as ImperativeRouter` (la unión tiene métodos que backOr no toca) pero las 3 firmas que SÍ usa (canGoBack/back/replace) son fieles.
- **Ruta de fallback inválida**: si `/(tabs)/animales` no fuera un `Href` válido, el typecheck fallaría — pasa, y coincide con el `router.navigate('/(tabs)/animales')` ya existente en la home.
- **Scope**: NO toqué `_layout.tsx`, el `router.replace` post-create, ni el caso `step===2`. El barrido transversal de `backOr` → backlog, no en este run.
- **Loop de render**: `backFallback` es `useMemo([profileId])` (params estables) → no churnea callbacks; y NO está en ningún `useEffect` dep → no re-dispara fetches (lección RodeoContext/miembros).

### Conteos finales (verificados por el implementer)
- **`node scripts/check.mjs` COMPLETO**: VERDE. anti-hardcode **0**; typecheck cliente OK; client unit **296/296** (293 + 3 de `nav.test.ts`); RLS **17/17**; Edge **36/36**; Animal **28/28**; Maniobras **13/13**.
- **`pnpm.cmd e2e`**: **28 passed / 0 failed** (incl. parto C3.2b estable).

Archivos tocados (frontend + test + plumbing, cero backend/migraciones): `app/src/utils/nav.ts` (NUEVO), `app/src/utils/nav.test.ts` (NUEVO), `app/app/agregar-evento.tsx`, `app/app/animal/[id].tsx`, `app/app/crear-animal.tsx`, `scripts/run-tests.mjs`.
