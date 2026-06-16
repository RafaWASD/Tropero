# impl — spec 03 M2.1-edge: edge cases diferidos del identify (R4.2 / R4.4-UI / R4.7)

baseline_commit: f518ea56b8dec3db34ec5e8427a6f1b95b0a858b

> Frontend puro sobre backend done (M2.1-core ya lockeado). Gate 1 N/A; reviewer + Gate 2 después.
> NO toca el flujo de carga rápida (M2.2, en review) ni el backend.

## Plan (tasks) — TODAS hechas
- [x] T1 — módulo PURO `app/src/utils/maniobra-edge.ts` + test (16 casos): R4.4 (isOtherRodeo/canChange),
      R4.7 (tracker de racha + umbral configurable), R4.2 (dominante/distinguidor con desempate por idv).
- [x] T2 — `setSessionRodeo` en `sessions.ts` + `buildSetSessionRodeoUpdate` en `local-reads.ts` (CRUD-plano).
- [x] T3 — `CandidatePicker.tsx` (R4.2): sheet manga-friendly, filas grandes, N° interno desempata.
- [x] T4 — `OtherRodeoSheet.tsx` (R4.4): cambiar jornada / saltar, rodeo de origen visible.
- [x] T5 — `RodeoMismatchBanner.tsx` (R4.7): banner no-bloqueante, dismissable.
- [x] T6 — cableado en `identificar.tsx`: ambiguous→picker; found→resolución de rodeo (R4.4)+tracker (R4.7).
- [x] T7 — e2e (f/g/h) + capturas 412×915 (picker + sheet R4.4 + banner R4.7).

## Archivos tocados
**Nuevos:**
- `app/src/utils/maniobra-edge.ts` (+`.test.ts`) — lógica PURA de los 3 edge cases.
- `app/app/maniobra/_components/CandidatePicker.tsx` — picker de desambiguación (R4.2), 🔴 manga.
- `app/app/maniobra/_components/OtherRodeoSheet.tsx` — aviso otro-rodeo + cambiar jornada/saltar (R4.4).
- `app/app/maniobra/_components/RodeoMismatchBanner.tsx` — aviso no-bloqueante rodeo mal elegido (R4.7).

**Modificados:**
- `app/app/maniobra/identificar.tsx` — cableado R4.2/R4.4/R4.7 (resolución de rodeo del found, tracker,
  picker, sheets); `backToListening` colapsa el manual (vuelta a escucha limpia); `AmbiguousHero` eliminado
  (reemplazado por el picker).
- `app/src/utils/maniobra-identify.ts` (+`.test.ts`) — outcome `ambiguous` enriquecido con `candidates`
  (DisambiguationCandidate[]); `ManualCandidate` con campos de display opcionales (compat M2.1-core).
- `app/src/services/sessions.ts` — `setSessionRodeo` (cambiar rodeo de jornada, CRUD-plano offline).
- `app/src/services/powersync/local-reads.ts` (+`maneuver-reads.test.ts`) — `buildSetSessionRodeoUpdate`.
- `app/e2e/maniobra-identify.spec.ts` — 3 escenarios (f/g/h) + helper `startManiobraSessionOnRodeo`/
  `manualSearch` + capturas.
- `scripts/run-tests.mjs` — registra `maniobra-edge.test.ts`.

## Mapa R → test
| R | Cobertura |
|---|---|
| R4.2 (desambiguación manual multi-candidato → picker) | unit `maniobra-edge.test.ts` (candidateDominantId visual>idv; candidateDistinguisher con N° desempate cuando el visual está duplicado; sin idv suelto si ya es dominante) + `maniobra-identify.test.ts` (ambiguous con `candidates` enriquecidos; compat sin display) + e2e (f) `CandidatePicker` con 2 candidatos que comparten visual → "N° 5001"/"N° 5002" desempatan → elegir → carga. |
| R4.4 (otro rodeo mismo establecimiento → **pasar el animal** / saltar) | unit `maniobra-edge.test.ts` (isOtherRodeo true mismo-est/otro-rodeo; canChangeSessionRodeo true mismo-sistema, false otro-sistema → gatea si OFRECER el move) + `maneuver-reads.test.ts` (`buildMoveAnimalToRodeoUpdate` mueve el perfil activo, NO toca soft-deleted; `buildSetSessionRodeoUpdate` solo activas) + e2e (g) animal en rodeo B, jornada en A → `OtherRodeoSheet` (**NO carga directo**: `weight-display` count=0) → "Pasar el animal a este rodeo" → carga + **oráculo `waitForServerProfileRodeo` confirma el UPDATE de `animal_profiles.rodeo_id`**. |
| R4.7 (heurística rodeo mal elegido → aviso no-bloqueante) | unit `maniobra-edge.test.ts` (3 consecutivos del mismo otro-rodeo disparan; el rodeo correcto rompe la racha; cambiar de otro-rodeo a un 3ro reinicia; dismiss silencia la racha; racha nueva reabre; umbral configurable) + e2e (h) 3 animales del rodeo B → saltar c/u → al 3ro `RodeoMismatchBanner` (no-bloqueante: hero detrás) → confirmar → banner se cierra. |

## Capturas (412×915, veto del leader)
- Picker R4.2: `design/maniobra-identify/candidate-picker.png`
- Sheet R4.4: `design/maniobra-identify/other-rodeo-sheet.png`
- Banner R4.7: `design/maniobra-identify/rodeo-mismatch-warning.png`

## Qué REUSÉ de spec 09 vs qué CREÉ
- **Reusé (idiom/patrón, NO código)**: el patrón de **bottom-sheet** (`ManeuverConfigSheet`/`BulkConfirmSheet`:
  scrim tappable + sheet anclado + grip + safe-area) para `CandidatePicker` y `OtherRodeoSheet`; el patrón de
  **lista scrollable con CTA pinned** + `$candidateListMax` del `AssignOrCreateBody`; `formatEidReadable`,
  `CategoryBadge`, `Button`, los tokens (`$searchBarLg`, `$heroIcon`, etc.); el camino del `found` y el
  find-or-create (`resolvePrefilledCreateParams` → `/crear-animal`) de M2.1-core; `setSessionRodeo` modelado
  sobre los otros setters CRUD-plano de `sessions.ts`.
- **NO reusé `CandidateRow`/`CandidateSummary` del `FindOrCreateOverlay`**: son funciones LOCALES (no
  exportadas) para un caso DISTINTO (asignar caravana a un animal SIN tag; muestran idv-dominante + sexo).
  El picker de desambiguación necesita la jerarquía del header de identidad (visual dominante + N° interno
  como DESEMPATE cuando el visual está duplicado, que es el caso de R4.2). Construí un componente nuevo.
- **Creé**: `maniobra-edge.ts` (la lógica pura de los 3 edge cases), los 3 componentes, `setSessionRodeo` +
  su builder, el enriquecimiento del outcome `ambiguous`.

## Autorrevisión adversarial (paso 8) — qué busqué, qué encontré, cómo lo cerré
Probé los 3 caminos como revisor hostil:
- **[ENCONTRADO Y CORREGIDO — bug de DISEÑO del picker] dos candidatos con el mismo visual + mismo rodeo +
  misma categoría no se distinguían.** El primer diseño tenía dominante=visual y distinguidor="rodeo·categoría";
  en el caso EXACTO de R4.2 (visual duplicado) ambas filas eran idénticas a la vista → el operario no podía
  elegir bien (el e2e (f) lo cazó: ambos botones decían "Elegir <visual>"). **Fix**: el **N° interno (idv)**
  —único por establecimiento— es el DESEMPATE: se muestra destacado a la derecha de la fila y entra en el
  distinguidor (`candidateDistinguisher`) cuando existe y no es ya el dominante. Sin él, R4.2 no cumple su
  función ("elegir el correcto sin crear duplicado"). +2 tests puros del desempate.
- **[ENCONTRADO Y CORREGIDO — UX/test] el manual quedaba expandido tras resolver un caso.** Tras saltar un
  animal, `outcome=null` pero `manual` seguía 'expanded' → el hero quedaba atenuado ("O acercá el bastón…")
  en vez de volver a "Acercá el bastón al animal" dominante (el e2e (h) lo cazó). **Fix**: `backToListening`
  colapsa el manual → vuelta a la escucha LIMPIA (el bastón es el 95%). Mejor UX + arregla la cadena de saltos.
- **[VERIFICADO + DOCUMENTADO — desviación de spec] R4.4 = cambiar la JORNADA, no mover el animal.** El EARS
  R4.4 dice "pasar el animal a este rodeo" (UPDATE de `animal_profiles.rodeo_id`); la dirección del leader
  (ALCANCE + Gate 0 del cliente) y R4.7 apuntan a "cambiar el rodeo de la SESIÓN". Implementé la del leader
  (no destructiva, coherente con R4.7). **Reconciliado** en requirements.md (nota bajo R4.4) + design §2.3.
- **[VERIFICADO OK — multi-tenant] el cambio de rodeo solo a rodeos del mismo campo.** `setSessionRodeo`
  recibe el `rodeoId` de `rodeo.available` (RodeoContext, solo el campo activo) — NUNCA un rodeo ajeno; el
  rodeo-check server-side (`tg_sessions_rodeo_check`, 0050) + RLS re-validan al subir. Cero hardcode de
  establishment/rodeo (verificado por el lint anti-hardcode: 0 violaciones).
- **[VERIFICADO OK — fail-safe] available vacío o fetchAnimalDetail falla.** Si `rodeo.available` está vacío
  (raro: el RootGate exige rodeo activo + el wizard eligió uno), el efecto ESPERA (no decide con info
  incompleta). Si `fetchAnimalDetail` falla, camino conservador → auto-avanza (el frame de carga re-resuelve
  el rodeo real; un mismatch real lo rechaza el DB al confirmar → R10.8).
- **[VERIFICADO OK — riesgo residual R4.4/R4.7 ↔ R10.8] eventos en cola de rodeo viejo tras cambiar la
  jornada.** Un evento offline de un animal de un rodeo VIEJO que suba DESPUÉS del cambio sería rechazado por
  el tenant-check (`v_event_rod ≠ v_session_rod` con el `sessions.rodeo_id` ACTUAL). Lo superficia R10.8
  (M4.2). R4.7 (avisar al 3er animal) MITIGA el patrón. Decisión consciente, documentada (design §2.3, tasks).
- **[VERIFICADO OK — no apilar avisos] el banner R4.7 no se muestra bajo un sheet R4.2/R4.4.** Condición
  `otherRodeo === null && outcome?.kind !== 'ambiguous'` → el banner aparece solo en estado de escucha limpio.
- **[VERIFICADO OK — offline] todo offline.** `setSessionRodeo` (CRUD-plano local), `fetchAnimalDetail`/
  `searchAnimals` (lecturas locales SQLite). Sin red. e2e (h) ejercita 3 búsquedas locales consecutivas.
- **[VERIFICADO OK — descendentes / es-AR / cero hardcode] regla dura.** Todos los headings y Text con
  numberOfLines llevan lineHeight matching; copy es-AR (voseo); tokens (lint anti-hardcode 0 violaciones).
- **[VERIFICADO OK — tests por la razón correcta] e2e ejercita el reject + el path real.** (f) verifica que
  NO se auto-elige (picker aparece) + que el N° desempata + que al elegir carga; (g) que NO carga directo
  (sheet intercepta) + que tras cambiar la jornada SÍ carga; (h) que el banner es no-bloqueante (hero detrás).
  Regresión M2.1-core (a-e, 5/5) + M2.2 (3/3) verdes → no rompí el camino feliz.

## Reconciliación de specs (paso 9)
- **requirements.md** — nota de reconciliación bajo **R4.4** (la acción primaria as-built es "cambiar el
  rodeo de la JORNADA" vía `setSessionRodeo`, no "mover el animal" — dirección del leader + coherencia con
  R4.7; "mover el animal" queda disponible desde la ficha). NO se reescribió el EARS.
- **design.md** — §2.3: bloque "As-built M2.1-edge" (R4.2 picker, R4.4 cambiar-jornada, R4.7 banner,
  riesgo residual R10.8) reconciliado al as-built.
- **tasks.md** — M2.1-edge marcada `[x]` con el as-built completo (componentes, service nuevo, tests,
  capturas, nota del riesgo residual).
- NO se tocó backend ni otras specs. NO se marca `done` en feature_list.json (espera al reviewer).

## Estado de check.mjs
**RC=0 (verde).** typecheck + anti-hardcode + unit (todas las suites) + backend (RLS/sync/spec10) verdes.
Esta corrida NO mostró rojos ajenos (ni el desalineamiento de spec 12 `import_rodeo_bulk` ni el flake de
rate-limit aparecieron). Mis gates de frontend: typecheck ✅, anti-hardcode ✅ (0 violaciones), unit
`maniobra-edge` 16 ✅ + `maniobra-identify` 10 ✅ + `maneuver-reads` 17 ✅, e2e `maniobra-identify` 8/8 ✅
(5 core + 3 edge) + `maniobra-carga` 3/3 ✅ (regresión M2.2). (El EXIT 127 de Playwright en Windows es un
crash de teardown de libuv `UV_HANDLE_CLOSING` AJENO — todos los tests reportan `ok`/`passed`.)

## ═══ FIX-LOOP (2026-06-14) — R4.4 HONRA el EARS + robustez de nombres largos + mocks limpios ═══

Raf decidió: **R4.4 debe HONRAR el EARS aprobado** (mover el animal), no la divergencia "cambiar la jornada"
que había implementado M2.1-edge. Frontend puro; NO se tocó backend ni el flujo de carga (M2.2).

### CAMBIO 1 — R4.4: revertir a "Pasar el animal a este rodeo" (UPDATE de animal_profiles.rodeo_id)
**Qué reusé para mover el animal**: NO había un `moveAnimalToRodeo` reusable; el camino canónico para un
UPDATE simple de `animal_profiles` (CRUD-plano offline) es el de `buildAssignAnimalToGroupUpdate`
(`management_group_id`). Lo espejé:
- **`app/src/services/powersync/local-reads.ts`** — nuevo `buildMoveAnimalToRodeoUpdate(profileId, rodeoId)`:
  `UPDATE animal_profiles SET rodeo_id = ? WHERE id = ? AND deleted_at IS NULL` (igual idiom que
  `buildAssignAnimalToGroupUpdate`). La validación es 100% server-side: el trigger
  `tg_animal_profiles_rodeo_same_system_check` (**0047**, before update of rodeo_id) rechaza el cruce de
  sistemas (R4.5.1, 23514) y `tg_animal_profiles_rodeo_check` (0021) re-valida establishment + rodeo activo;
  RLS `animal_profiles_update` re-valida tenant. **NO inventé validación en el cliente** (verificado que 0047
  existe y gatea el UPDATE de rodeo_id).
- **`app/src/services/animals.ts`** — nuevo service `moveAnimalToRodeo(profileId, rodeoId)` (espeja
  `setFutureBull`/`assignAnimalToGroup`: 1 `runLocalWrite` → 1 CrudEntry → upload queue; contrato T5).
- **`app/app/maniobra/_components/OtherRodeoSheet.tsx`** (reescrito) — acción primaria **[Pasar el animal a
  este rodeo]** (no lleva el nombre del rodeo en el label → no desborda; el nombre va en el cuerpo) +
  secundaria **[Saltar este animal]**. El cuerpo muestra el **rodeo de ORIGEN** del animal y el destino
  ("0386 está en Vaquillonas. Para cargarlo hay que pasarlo a Cría hembras (lo sacás de Vaquillonas)").
  `canChange=false` (otro sistema) → solo [Saltar] + copy explicativo.
- **`app/app/maniobra/identificar.tsx`** (líneas ~322-342, ~447-457) — `onChangeSessionRodeo` → renombrado
  `onMoveAnimalToRodeo(profileId)`: llama `moveAnimalToRodeo(profileId, sessionRodeoId)` → tras el move el
  animal YA está en el rodeo de la jornada → `setReadyToAdvance(profileId)` (carga). Alimenta el tracker R4.7
  con `pushSeenRodeo(prev, sessionRodeoId, '', sessionRodeoId)` → como `animalRodeoId == sessionRodeoId` la
  racha se corta (devuelve emptyStreak; el name es irrelevante en esa rama → evité un TDZ con `rodeoName`,
  que se declara DESPUÉS del callback). El sheet ahora se cablea con `onMoveAnimal`.
- **R4.7 SE QUEDA con `setSessionRodeo`** (cambiar la jornada): `onConfirmStreakRodeo` (banner) intacto.
  `setSessionRodeo` ahora lo usa **SOLO R4.7**; `moveAnimalToRodeo` lo usa **SOLO R4.4**. Separación verificada
  (grep: `onMoveAnimal`→R4.4, `onChangeRodeo`→R4.7).

### CAMBIO 2 — robustez de nombres de rodeo largos (`RodeoMismatchBanner.tsx`, R4.7)
Antes los 2 botones iban lado a lado (`<View flex={1}>` c/u) y "Cambiar a {rodeo}" CLIPEABA con un nombre
largo. Fix: (a) los 2 botones **apilados vertical full-width** (`YStack gap`); (b) el botón "Cambiar a
{rodeo}" se arma INLINE (el componente `Button` no expone `numberOfLines` en su label) con un `Text
numberOfLines={1} ellipsizeMode="tail"` → trunca con "…". a11y label lleva el nombre COMPLETO (el e2e lo
ubica por aria-label aunque el texto visible trunque). La captura (h) usa "Rodeo de cría de reposición 2024"
(nombre largo real) → PRUEBA el fix. Misma robustez al sheet R4.4: su botón primario ya no necesita el
nombre (va en el cuerpo).

### CAMBIO 3 — mocks limpios en las 3 capturas
e2e (f/g/h) re-sembrados con identidad/rodeos limpios (`rawName:true`/`rodeoRawName:true` — seguro: cleanup
por CASCADE del establishment, que conserva su RUN_TAG):
- `candidate-picker.png` — visual "0385" DUPLICADO (2 candidatos), rodeo "Cría hembras", categoría
  Vaquillona; el N° interno (5001/5002) desempata.
- `other-rodeo-sheet.png` — sheet R4.4 NUEVO: "Pasar el animal a este rodeo" + origen "Vaquillonas".
- `rodeo-mismatch-warning.png` — banner R4.7 con nombre LARGO truncado + botones apilados (no clipean).

### Tests actualizados al nuevo comportamiento
- **unit** `maneuver-reads.test.ts` (+2): `buildMoveAnimalToRodeoUpdate` mueve el perfil activo / NO toca un
  soft-deleted. (16 maniobra-edge intactos: `isOtherRodeo`/`canChangeSessionRodeo` siguen gateando si OFRECER
  el move — su semántica no cambió.)
- **e2e (g)** reescrito: animal en otro rodeo (B) → sheet R4.4 → **NO carga directo** (`weight-display` count=0
  antes de resolver) → "Pasar el animal a este rodeo" → carga + **oráculo server-side
  `waitForServerProfileRodeo(profileId, rodeoA)`** confirma que el UPDATE de `animal_profiles.rodeo_id` SÍ
  sincronizó (verifica el camino reusado, no solo la UI). Nuevo helper en `app/e2e/helpers/admin.ts`.
- **e2e (f/h)** con mocks limpios; (h) con nombre largo + ubica el botón por aria-label completo.

### Autorrevisión adversarial (paso 8) del fix-loop
- **[VERIFICADO — el move precede al evento en la cola FIFO]** `moveAnimalToRodeo` (UPDATE) se encola ANTES
  del INSERT del evento (el operario mueve, luego carga) → al subir, el perfil ya está en el rodeo de la
  sesión → el tenant-check `tg_event_session_tenant_check` pasa (`v_event_rod = v_session_rod`). Esto es
  EXACTAMENTE lo que el comentario del trigger (design §2.3) espera del flujo "pasar a este rodeo" — la
  versión previa ("cambiar la jornada") NO lo cumplía. El fix es MÁS consistente con el backend.
- **[VERIFICADO — fail-closed cross-system]** la UI solo ofrece [Pasar] si `canChangeSessionRodeo` (mismo
  sistema); cross-system → solo [Saltar] → no se intenta el move. Y si por algún borde se intentara, el
  trigger 0047 lo rechaza server-side (23514) → R10.8 lo superficia. Doble defensa.
- **[VERIFICADO — TDZ]** `onMoveAnimalToRodeo` referenciaba `rodeoName` (declarado DESPUÉS con `const`) en su
  dep array → habría sido ReferenceError en render. Lo saqué (paso '' al `pushSeenRodeo`, que no usa el name
  cuando el rodeo es el de la sesión). Typecheck verde.
- **[VERIFICADO — capturas con ojo de diseñador]** las 3 limpias y legibles: picker (N° desempata, sin
  caravana repetida confusa), sheet R4.4 (origen→destino claro, CTA sin overflow), banner R4.7 (nombre largo
  truncado con …, 2 botones apilados full-width, no clipean, hero detrás = no-bloqueante). Descendentes OK
  (lineHeight matching en todo título/Text con numberOfLines). es-AR (voseo). Cero hardcode (lint 0 viol).

### Reconciliación de specs (fix-loop)
- **requirements.md** R4.4 — la nota de reconciliación se **reformuló**: ya NO justifica la divergencia
  (ahora el as-built HONRA el EARS); documenta el as-built fiel (mover el animal vía `moveAnimalToRodeo`,
  validación server-side 0047/0021, `setSessionRodeo` queda solo para R4.7) + nota de que el fix-loop
  revirtió la desviación. El EARS NO se reescribió (ya pedía mover el animal).
- **design.md** §2.3 — bloque "As-built M2.1-edge" reescrito (R4.4 = mover el animal; R4.7 = cambiar jornada;
  riesgo residual ahora solo R4.7↔R10.8, porque R4.4 ya no toca `sessions.rodeo_id`).
- **tasks.md** M2.1-edge — R4.4 al nuevo comportamiento; 2 servicios nuevos documentados; aceptación/tests/
  archivos actualizados; nota R10.8 acotada a R4.7.

### Estado de check.mjs / e2e (fix-loop)
- **check.mjs RC=0 (verde)** en el run final: typecheck + anti-hardcode (0 viol) + client unit (incl.
  maniobra-edge 16 + maneuver-reads con los 2 nuevos) + backend (Animal spec02 109, Maneuvers spec03 13, RLS,
  Edge, user_private, Import spec12 25, Sync-streams, Operaciones-rodeo) — **todos pass, 0 fail**. (Un run
  intermedio había dado rojo por `Request rate limit reached` en la suite animal = flake de auth de Supabase
  por terminales paralelas, AJENO; el re-run limpio lo confirma. Spec-12 `import_rodeo_bulk` 25 pass → ya no
  está el desalineamiento previo.)
- **e2e `maniobra-identify` 8/8** (a-e core + f/g/h edge) con el comportamiento nuevo de R4.4. (El
  `UV_HANDLE_CLOSING` de Windows es el crash de teardown de libuv AJENO; todos reportan `passed`.)

## Nota de decisiones visuales para el veto del leader
- **Picker R4.2** (`candidate-picker.png`): filas grandes (≥56) con caravana visual dominante (heading $7) +
  **N° interno en verde a la derecha** como desempate (la decisión clave: sin él, dos animales con el mismo
  visual+rodeo+categoría son indistinguibles) + badge categoría + rodeo + tag muted. CTA "Ninguno · dar de
  alta" pinned. El ruido del RUN_TAG en el visual es de e2e (en prod sería "0385").
- **Sheet R4.4** (`other-rodeo-sheet.png`): ícono Boxes (rodeo) + "Está en otro rodeo" + copy con rodeo de
  origen y de jornada + "Cambiar la jornada a <rodeo>" (primary) / "Saltar este animal". El FoundHero (check
  verde) de fondo confirma la lectura. **Opinable**: con nombres de rodeo cortos (prod) el botón primary
  entra sin recorte; en la captura el RUN_TAG largo lo estira (ruido de e2e).
- **Banner R4.7** (`rodeo-mismatch-warning.png`): borde terracota, ícono alerta, "Los últimos 3 animales son
  de <rodeo>", botones "Cambiar a <rodeo>" / "Ahora no" + ×. NO-bloqueante: el hero de escaneo sigue detrás.
  **Opinable**: el botón "Cambiar a <rodeo>" a media-ancha recorta el nombre largo del rodeo (ruido de e2e);
  en prod entra. Si el leader prefiere, el banner podría apilar los 2 botones en vez de ponerlos lado a lado.
