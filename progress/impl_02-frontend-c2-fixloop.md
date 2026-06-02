baseline_commit: db9d5866b39448061efc378219a618a21da1f1d2

# C2 — FIX LOOP: identidad RAFAQ + límites de input + bugs del filtro (spec 02 frontend + 09 puerta manual)

Fix-loop de C2 tras prueba de Raf en web. El alta FUNCIONA, pero 3 problemas de calidad:
1. **Pantallas GENÉRICAS** — el código usa tokens (anti-hardcode 0) pero todo con tokens neutros
   (`$textPrimary` negro / `$surface` bone / `$textMuted`) → plano, sin la identidad RAFAQ (verde
   botella, badges `$greenLight`+`$primary`, terracota, jerarquía, calidez de card).
2. **El alta NO LIMITA inputs** — acepta 40+ chars, letras en fecha/peso; solo errorea al submit.
3. **Filtro de Estado con bugs** — empty-state genérico aunque el filtro esté activo; el ✓ del
   item seleccionado descentra el texto del dropdown.

Frontend only. Sin migraciones. Baseline = `db9d586` (C2 original, multi-sesión → NO se reescribe).

## Plan (tasks) — TODAS ✅

- [x] T1 — `CategoryBadge` (componente nuevo reusable): pill `$greenLight`+texto `$primary` (firma
      RAFAQ del navbar). Soporta `size` (sm fila / md hero) + punto de override manual. Registrado en
      `components/index.ts`. (La etiqueta viene resuelta del catálogo del server — el badge la presenta.)
- [x] T2 — FIX 2 (raíz del largo): sanitizadores PUROS `utils/animal-input.ts` (+ 7 tests) +
      enganchados en `onChangeText` de `crear-animal.tsx`: caravana electrónica 15 díg numéricos ·
      IDV numérico · visual acotado · fechas con máscara AAAA-MM-DD (los guiones se insertan solos,
      no se puede tipear "asdasd") · peso decimal (un solo separador, descarta letras). Hints en los
      labels. Validación de tag al submit (`isValidTagElectronic`).
- [x] T3 — FIX 1 (ficha `animal/[id].tsx`): `AnimalHero` (IDV grande $9/700 truncado + `CategoryBadge`
      md + sexo con ícono Mars/Venus en $primary + rodeo) + `DetailSection` (card bone, header con
      ícono lucide $primary sobre halo $greenLight) + `AttributeRow` (valor truncado 1 línea) +
      `TimelineTeaser` (card $greenLight + reloj $primary + copy cálido). Reemplaza la lista
      label-valor pelada en negro y el "Próximamente" gris.
- [x] T4 — FIX 1 (`AnimalRow`): subtítulo = `CategoryBadge` (verde) + rodeo muted (antes "cat · rodeo"
      gris plano).
- [x] T5 — FIX 3 (`animales.tsx`): empty-state contextual (`FilteredEmptyState` + `filteredEmptyCopy`:
      filtro activo + 0 → "No hay animales vendidos/…/en «rodeo»" + CTA "Limpiar filtro"; vs 0 total
      sin filtro → "Todavía no cargaste") + dropdown de Estado con slot FIJO para el ✓ en toda fila
      (no descentra el label) + item seleccionado en $primary/600.
- [x] T6 — verificación: check.mjs verde + pnpm e2e 21/21 + autorrevisión adversarial.

## Archivos

Nuevos:
- `app/src/components/CategoryBadge.tsx` — pill de categoría (firma de identidad RAFAQ, reusable C3).
- `app/src/utils/animal-input.ts` (+ `.test.ts`) — sanitizadores puros del alta (FIX 2).

Modificados:
- `app/app/crear-animal.tsx` — sanitizadores en `onChangeText` + hints + validación de tag al submit.
- `app/app/animal/[id].tsx` — REDISEÑO con identidad (hero + secciones + teaser).
- `app/app/(tabs)/animales.tsx` — empty-state contextual + CTA limpiar filtro + dropdown balanceado.
- `app/src/components/AnimalRow.tsx` — CategoryBadge con color en el subtítulo.
- `app/src/components/index.ts` — export de CategoryBadge.
- `app/e2e/animals.spec.ts` — ficha "Historial de eventos" (era "Próximamente") + 2 tests nuevos
  (FIX2 límites/rechazo de submit inválido, FIX3 empty contextual del filtro).
- `scripts/run-tests.mjs` — engancha `animal-input.test.ts`.

## Mapa R → archivo:test

- **R1.5 (empty-state contextual del filtro)** → `animales.tsx:filteredEmptyCopy`/`FilteredEmptyState`/
  `onClearFilters` · E2E `animals.spec.ts` "FIX3: filtro de Estado activo + 0 → empty contextual".
- **R1.5 (dropdown de Estado balanceado)** → `animales.tsx:FilterPopover` (slot fijo del ✓) — verificable
  por inspección; cubierto indirectamente por el E2E del filtro (selecciona "Vendidos").
- **R4.2/R4.3 (límites de input EN VIVO, prevenir-no-errorear)** → `utils/animal-input.ts` (+ `.test.ts`,
  7 tests: tag 15 díg / idv numérico / visual acotado / máscara fecha / peso decimal / isValidTag) ·
  `crear-animal.tsx` (onChangeText) · E2E "FIX2: el alta LIMITA los inputs… y rechaza submit inválido".
- **R4.5 (submit rechaza inválido sin navegar)** → `crear-animal.tsx:onSubmit` (tagOk + result.valid) ·
  E2E "FIX2…" (asierta el error visible + ausencia de "Datos del animal" = no navegó).
- **R5/R14 (ficha con identidad)** → `animal/[id].tsx` (AnimalHero/DetailSection/AttributeRow/
  TimelineTeaser) · `components/CategoryBadge.tsx` · E2E "alta…abre la ficha" (Historial de eventos visible).
- **R1 (lista con identidad)** → `AnimalRow.tsx` (CategoryBadge) · `components/CategoryBadge.tsx`.

## Autorrevisión adversarial (paso 8)

Busqué activamente, como revisor hostil:

1. **¿Se ve con identidad RAFAQ, no genérico?** SÍ. La ficha ahora tiene hero (IDV $9/700) + badge
   verde + sexo con ícono $primary + rodeo; secciones bone con header de ícono $primary sobre halo
   $greenLight; teaser $greenLight cálido. `AnimalRow` y el dropdown usan el verde. La firma `$greenLight`
   +`$primary` es la MISMA pill del navbar (consistencia, Nielsen #4). El CategoryBadge se extrajo
   reusable (base de la capa de identidad para C3).
2. **¿Los campos LIMITAN en vivo (no se puede tipear basura)?** SÍ — sanitizadores puros enganchados en
   `onChangeText`. **BUG-CLASS QUE ATRAPÉ con el E2E**: pasar `maxLength` NATIVO en campos filtrados a
   dígitos es DAÑINO — el TextInput trunca el RAW (incl. letras) ANTES de `onChangeText`, así un paste
   "abc123…" se queda con menos de 15 dígitos (el test recibió 12, no 15). FIX: quité `maxLength` de los
   campos digit/máscara (el sanitizador es la fuente de verdad del límite) y lo dejé SOLO en texto libre
   (visual/raza/pelaje, donde 1 char = 1 char). El E2E re-corrido confirma 15 díg exactos.
3. **¿El submit rechaza basura sin navegar?** SÍ — E2E: tag de 8 díg + sin sexo → 2 errores visibles +
   NO aparece "Datos del animal" (no aterrizó en ficha). La validación de tag (vacío o 15 díg) vive
   aparte de animal-form porque su regla es "0 ó 15 exactos".
4. **¿El empty del filtro dice lo correcto?** SÍ — `showFilteredEmpty` (filtro activo + 0) vs
   `showEmptyEstablishment` (0 total, sin filtro). `isSearching` tiene precedencia (search → no-match).
   E2E: sembré un animal ACTIVO + filtré por Vendidos → "No hay animales vendidos." + "Limpiar filtro";
   "Todavía no cargaste" ausente. Limpiar el filtro re-muestra el activo.
5. **¿El ✓ del dropdown descentra el texto?** NO MÁS — slot de ancho FIJO ($navIcon=24) reservado en
   TODAS las filas; el label `flex={1}` left-align siempre con el mismo ancho de columna.
6. **¿Identificadores largos wrappean?** NO — `numberOfLines={1}` en el hero y en cada `AttributeRow`
   (el root-fix del largo es la limitación de input de FIX 2; esto es el cinturón).
7. **¿Toggles/controles andan en DEV (a11y helper)?** Sí — los Pressables nuevos (`SecondaryCta`,
   FilterPopover) usan `buttonA11y(Platform.OS,…)`, NO accessibilityLabel crudo sobre Pressable de
   RN-web (lección C1/LogBox). CategoryBadge usa `accessibilityLabel` sobre un `View` (no Pressable),
   patrón ya usado por NoTagChip/RoleBadge sin problema.
8. **¿Hardcode?** 0 (check-hardcode verde). width/height literales (badge dot 5/6, slot 24=token) no
   los marca el lint (solo color/spacing). Contraste $primary↔$greenLight = 4.55 (AA normal OK), mismo
   combo del navbar.
9. **¿Multi-tenant?** Sin cambios en services/queries (frontend puro de presentación + sanitización);
   `establishment_id` sigue del contexto, RLS intacta. Sin migraciones.

NO reemplaza al reviewer ni al Gate 2 — los precede.

## Verificación

- `node scripts/check.mjs` VERDE: anti-hardcode 0 · client unit **189/189** (182 previos + 7 nuevos de
  animal-input) · RLS 17 · Edge 36 · Animal 28 · Maniobras 13 · typecheck OK.
- `pnpm.cmd --dir app e2e` VERDE: **21/21** (19 previos + 2 nuevos: FIX2 límites/rechazo, FIX3 empty
  contextual del filtro), estable.

## Notas / diferidos

- C3 reusará `CategoryBadge` + `DetailSection`/`AttributeRow` (capa de identidad) para la ficha completa.
- Quité la card "Editar atributos — Próximamente" de la ficha: el teaser de Historial ya comunica
  "más por venir"; editar atributos es C3 (no se promete un cuadro muerto extra).
- `maxLength` nativo se conserva SOLO en visual/raza/pelaje (texto libre, 1 char = 1 char); en los
  campos filtrados a dígitos el límite lo impone el sanitizador (ver autorrevisión #2).

---

# fix-loop 2: hero clip + search caravana

Segundo fix-loop chico de C2, frontend only (sin migraciones). 2 bugs que Raf encontró en web.
Baseline = el mismo de la línea 1 (multi-sesión, NO se reescribe).

## BUG A — el ID principal de la ficha salía CORTADO (clip vertical)

Causa raíz: el identificador hero (`AnimalHero`, `animal/[id].tsx`) usaba `fontSize="$9"` SIN
`lineHeight` → con un fontSize grande el line-box queda más chico que el glifo y lo clipea
arriba/abajo. Mismo bug que el título "Equipo" de B.1.3 (resuelto con `lineHeight="$8"` para
`fontSize="$8"`).

Fix (cero hardcode, token): seteé `lineHeight="$9"` (= fontSize "$9") en el hero. En
`tamagui.config.ts` el grupo `lineHeight` tiene `9: 38` para `size 9: 30` → margen vertical de
sobra, no clipea.

Sweep de los OTROS títulos grandes $8/$9 que C2 agregó/tocó (NO toqué pantallas de specs ajenas):
- `app/(tabs)/animales.tsx` → título "Animales" `fontSize="$8"` → agregué `lineHeight="$8"`.
- `app/crear-animal.tsx` → título "Dar de alta" `fontSize="$8"` → agregué `lineHeight="$8"`.
- `app/animal/[id].tsx` → hero `$9` → `lineHeight="$9"` (el bug original).
- Los títulos de SECCIÓN de la ficha / pasos son `$6` (18px), por debajo del rango clip-prone y
  fuera del scope del brief ($8/$9) → no se tocaron.
- `miembros.tsx` ($8) ya tenía `lineHeight="$8"` (fix B.1.3). Las demás $8/$9 (home/rodeos/
  mis-campos/crear-rodeo/maniobra/reportes/mas) son de specs ajenas → NO se tocaron.

## BUG B — el buscador no encontraba por caravana electrónica ni por IDV parcial

Causa raíz: el motor hacía IDV **exacto**, caravana electrónica **exacta solo si 15 díg**, y solo
`visual_id_alt` con substring (ilike). Un prefijo/fragmento de caravana o IDV ("03200") no
matcheaba → "No encontramos". Decisión del brief: NO avisar "ingresá ID visual" — hacer que el
search ande por caravana/número.

Fix:
- `utils/animal-identifier.ts` `classifySearchQuery`: nuevo flag `tryNumericSubstring` = true para
  cualquier texto compacto solo-dígitos (≥1). Habilita el match PARCIAL sobre idv + tag. Los flags
  exactos (`tryTag` 15-díg, `tryIdv`) se mantienen para priorizar el exacto arriba.
- `services/animals.ts` `searchAnimals`: agregué el paso 3 (substring numérico) ENTRE los exactos
  (1 TAG, 2 IDV) y el fuzzy visual (4). Son DOS sub-queries `.ilike(pattern)` — una sobre
  `animal_profiles.idv` (tabla base) y otra sobre `animals.tag_electronic` (tabla embebida
  inner-join) — porque PostgREST no combina en un solo `or` una columna base con una embebida.
  El dedup por `profileId` (`pushRows`/`seen`) las une. Pattern = `%${escapeIlike(compact)}%`
  (mantiene el escape de comodines `%`/`_`). Scope sin cambios: establishment + status active +
  deleted_at null + RLS como barrera real. Limit 20 por sub-query.
- El exacto sigue priorizado (se concatena antes; el dedup descarta el duplicado del substring).
- Placeholder "Buscar por caravana o número" queda como está (ahora es verdadero) — NO se cambió.

Perf (documentado, no bloquea MVP): el substring ilike sobre idv/tag NO usa índice exacto → full
scan DENTRO del set ya scopeado (establishment+status+deleted_at) + limit 20. Aceptable para
rodeos de cientos; un índice trigram sobre idv/tag es refinamiento posterior.

## Tests agregados / extendidos

- `utils/animal-identifier.test.ts`: extendí los tests de `classifySearchQuery` para asertar el
  nuevo `tryNumericSubstring`, + 2 tests nuevos del fix-loop:
  - prefijo numérico corto "03200" → `tryNumericSubstring: true` (habilita substring de idv+tag),
    `tryTag: false` (no son 15 díg), `tryIdv: true`.
  - prefijo con separadores " 0 3200 " → se compacta a "03200" para el substring.
  - texto con letras → `tryNumericSubstring: false` (el substring numérico NO aplica).
- `e2e/animals.spec.ts`: test nuevo "fix-loop 2: buscar por un PREFIJO de la caravana electrónica
  encuentra el animal". Siembra (helper `seedAnimal`, acepta `tag`) un animal con caravana FDX-B de
  15 díg + un IDV NO relacionado; busca por los 5 díg de prefijo de la caravana → el resultado
  aparece (y NO "No encontramos"). El match SOLO puede venir del nuevo substring de
  `tag_electronic` (el prefijo no es substring del IDV) → prueba el path real, no una tautología.

## Mapa R → test (fix-loop 2)

- **BUG B (plan de búsqueda habilita substring numérico de idv+tag)** →
  `utils/animal-identifier.ts:classifySearchQuery` (`tryNumericSubstring`) ·
  `animal-identifier.test.ts` (2 tests del prefijo "03200" + el de separadores + el de letras).
- **BUG B (search ejecuta el substring de idv + tag_electronic)** → `services/animals.ts:searchAnimals`
  (paso 3a idv / 3b tag) · E2E `animals.spec.ts` "fix-loop 2: buscar por un PREFIJO de la caravana".
- **BUG A (hero/títulos $8/$9 no clipean)** → `animal/[id].tsx` (hero `lineHeight="$9"`),
  `animales.tsx` / `crear-animal.tsx` (`lineHeight="$8"`) — verificable por inspección visual; el
  token de lineHeight matchea el fontSize (cero hardcode).

## Autorrevisión adversarial (paso 8)

Busqué como revisor hostil:
1. **¿El token de lineHeight realmente matchea el fontSize?** SÍ — `tamagui.config.ts`: `$9` size 30
   / lineHeight 38; `$8` size 23 / lineHeight 31. Margen vertical de sobra → no clipea. Mismo
   patrón canónico de B.1.3.
2. **¿Toqué pantallas de specs ajenas en el sweep?** NO — solo las 3 que C2 agregó/tocó
   ([id]/animales/crear-animal). El grep confirmó que las otras $8/$9 (home/rodeos/mis-campos/
   crear-rodeo/maniobra/reportes/mas) NO se modificaron; `miembros.tsx` ya tenía su lineHeight.
3. **¿El test e2e prueba el path real del fix o pasa por la razón equivocada?** Prueba el path real:
   el prefijo "03200" NO es substring del IDV sembrado (`8822…`), así que el match SOLO puede venir
   del nuevo substring de `tag_electronic` (3b). Si ese path no anduviera, el test fallaría.
4. **¿Multi-tenant / RLS intactos?** Cada sub-query nueva mantiene `establishment_id` (del contexto,
   nunca hardcodeado) + status active + deleted_at null; RLS sigue siendo la barrera real. Sin
   migraciones, sin cambios de permisos.
5. **¿Prioridad del exacto preservada?** SÍ — el substring corre DESPUÉS de TAG/IDV exactos y el
   dedup por profileId descarta el duplicado posterior; el exacto queda arriba.
6. **¿Inyección de comodín en ilike?** Neutralizada con `escapeIlike` (`%`/`_`/`,` → espacio). Para
   numérico es no-op (solo dígitos) pero queda defensivo.
7. **¿Edge cases de classifySearchQuery?** vacío → nada que buscar (guard al tope); letras → solo
   visual; 15-díg → los 4 paths + dedup. Cubiertos por unit tests.
8. **¿Hardcode?** 0 — el fix de A es 100% token de lineHeight; el de B no toca tokens. check-hardcode
   verde.

NO reemplaza al reviewer ni al Gate 2 — los precede.

## Verificación (fix-loop 2)

- `node scripts/check.mjs` VERDE (exit 0, "Entorno listo"): anti-hardcode 0 · client unit **191/191**
  (incluye los tests nuevos de `classifySearchQuery`) · RLS 17 · Edge 36 · Animal 28 · Maniobras 13 ·
  typecheck OK.
- `pnpm.cmd --dir app e2e` VERDE: **22/22** (21 previos + 1 nuevo "fix-loop 2: buscar por un PREFIJO
  de la caravana electrónica encuentra el animal").

## Archivos (fix-loop 2)

Modificados:
- `app/app/animal/[id].tsx` — `lineHeight="$9"` en el hero (BUG A).
- `app/app/(tabs)/animales.tsx` — `lineHeight="$8"` en el título "Animales" (BUG A sweep).
- `app/app/crear-animal.tsx` — `lineHeight="$8"` en el título "Dar de alta" (BUG A sweep).
- `app/src/utils/animal-identifier.ts` — flag `tryNumericSubstring` en `classifySearchQuery` (BUG B).
- `app/src/services/animals.ts` — paso 3 (substring numérico idv + tag_electronic) en `searchAnimals`
  + docstring actualizado (BUG B).
- `app/src/utils/animal-identifier.test.ts` — tests del substring numérico (BUG B).
- `app/e2e/animals.spec.ts` — e2e de búsqueda por prefijo de caravana (BUG B).

---

# fix-loop 3: paso "Cargá tu primer animal" de la home por estado real

Tercer fix-loop chico de C2, frontend only (sin migraciones). Baseline = el mismo de la línea 1
(`db9d586`, multi-sesión → NO se reescribe).

## El problema (Raf en web)

En Inicio, el Stepper de "primeros pasos" seguía mostrando **"Cargá tu primer animal"** aunque el
campo activo YA tuviera un animal. Causa: el paso "rodeo" se drivea desde `useRodeo` (fix de C1) pero
el paso **animal** quedó HARDCODEADO `state:'active'` (cuando se hizo el fix de C1, la capa de
animales C2 todavía no existía). Ahora SÍ existe → el paso debe reflejar si el campo activo tiene
≥1 animal. NINGÚN paso debe MENTIR (consistente con el fix del paso rodeo).

## El fix

1. **`services/animals.ts` → `countAnimals(establishmentId): ServiceResult<number>`** (nuevo,
   tipado). Count liviano `select('id', { count:'exact', head:true })` (HEAD request, sin traer
   filas) scopeado a `establishment_id` + `status='active'` + `deleted_at is null` (mismo scope que
   la tab Animales = el rodeo vivo). RLS (`has_role_in`) es la barrera real; el `.eq('establishment_id')`
   es defensa en profundidad. `count ?? 0` defensivo. NUNCA hardcodea establishment_id (viene del
   contexto).
2. **`app/(tabs)/index.tsx`**: estado `hasAnimals: boolean|null` + `loadAnimalCount(estId)` (count →
   `hasAnimals = value > 0`), recargado con **`useFocusEffect`** (mount + volver de la tab Animales
   tras crear) con **dep PRIMITIVA `activeId`** (string, NO el objeto `activeField` — lección
   RodeoContext/miembros.tsx, sin loops). `loadAnimalCount` es `useCallback([])` estable → el foco es
   evento discreto, no loopea. Guard de **secuencia** (`animalCountSeq`) descarta respuestas tardías;
   guard de **campo** (`countedEstIdRef`) resetea `hasAnimals` a null SOLO al cambiar de campo (no en
   re-foco del mismo) → ni parpadea en re-foco ni hereda el "hecho" del campo viejo al switchear (no
   mentir). En error (red/permisos) NO afirma estado falso (deja el valor previo).
3. **Paso "Cargá tu primer animal" driveado**: `state: hasAnimals ? 'done' : 'active'`. El rodeo
   SIEMPRE está done en la home (el RootGate garantiza ≥1 rodeo antes de renderizarla), así que el
   único eje real del paso es "¿hay animales?" (no se condiciona el `active` a `rodeoDone` —sería
   redundante—). Cuando `done`: título "Cargaste tu primer animal", body cálido, CTA secundario; el
   CTA "Ir a Animales" queda en AMBOS estados (mismo criterio que "Gestionar rodeos" del paso rodeo
   done) → nunca un botón muerto. Se rendea `done` igual que el paso rodeo (Stepper ✓ verde +
   título atenuado), consistencia visual.
4. El paso 3 "Invitá a tu vet/capataz" → sin cambios (sigue `future`, CTA a `/miembros` solo owner).

## Mapa R → archivo:test (fix-loop 3)

- **Paso animal driveado por estado real (count>0 → done; count===0 → active)** →
  `app/(tabs)/index.tsx` (`hasAnimals`/`loadAnimalCount`/`useFocusEffect` + el step) ·
  `services/animals.ts:countAnimals` · **E2E** `animals.spec.ts` "alta desde empty → … abre la ficha"
  EXTENDIDO: arranca con "Cargá tu primer animal" visible + "Cargaste…" ausente (count real 0) →
  crea un animal por la UI → vuelve a Inicio → "Cargaste tu primer animal" visible + "Cargá…" ausente
  (count real 1). Prueba el path real contra el remoto: si el paso siguiera hardcodeado `active`, el
  2º assert fallaría (= el bug original).

Cobertura por E2E (no unit con mock de supabase): `countAnimals` es una query directa a Supabase; el
patrón del repo (aprendizaje s21: flujos cliente↔RLS → test REAL contra el remoto; flujos de UI con
estado → e2e/oráculo Raf) es ejercitarla por el path real, no con un mock que sería tautológico. El
único test unit del repo en `services/` (`establishment-store.test.ts`) de hecho importa la lógica
PURA desde `utils/`, no testea el service. La derivación `count>0 → done` es trivial y se cubre
end-to-end por el e2e.

## Autorrevisión adversarial (paso 8)

Busqué como revisor hostil:

1. **¿El paso miente en algún estado?** NO. `null` (cargando) → muestra PENDIENTE = default honesto
   para alguien de quien aún no sabemos si cargó (el peor error sería afirmar "hecho" en falso, que
   no hacemos). `>0` → done. `===0` → active. El bug original era el inverso (pendiente para SIEMPRE).
2. **¿Loop de render (lección RodeoContext/miembros.tsx)?** NO. Dep PRIMITIVA `activeId` (string).
   `loadAnimalCount` = `useCallback([])` estable. `useFocusEffect` re-suscribe solo cuando `activeId`
   cambia; el `setHasAnimals` interno no está en deps → no se auto-dispara. Foco = evento discreto.
   El e2e (que se colgaría ante un loop de fetch) pasa estable en 2 corridas.
3. **¿Edge case del SWITCH de campo (mentir heredando el "hecho")?** ATRAPADO en autorrevisión:
   sin el guard de campo, al switchear de A (con animales, done) a B (sin animales) el paso mostraría
   "done" heredado de A durante la carga de B = mentira transitoria. FIX: `countedEstIdRef` resetea
   `hasAnimals` a null SOLO al cambiar de campo → B arranca PENDIENTE (honesto) hasta su count. En
   re-foco del MISMO campo NO resetea → sin parpadeo (brief: "asumí el estado previo").
4. **¿Frescura tras crear (el bug que se ve corriendo la app)?** `useFocusEffect` recarga al
   re-enfocar la home volviendo de Animales → el count tras crear es fresco. Un `useEffect([activeId])`
   NO lo lograría (activeId no cambia al navegar entre tabs) → el paso quedaría stale. El e2e lo
   verifica (crea → vuelve a Inicio → done).
5. **¿Multi-tenant / RLS?** `countAnimals` recibe `activeId` del contexto (nunca hardcodeado), filtra
   `establishment_id` + RLS barrera, mismo scope que `fetchAnimals`. Sin migraciones, sin permisos
   nuevos. `head:true` no expone filas, solo el count (que RLS ya filtra).
6. **¿`count` null → falso 0?** Con `count:'exact'` PostgREST devuelve el count exacto; null solo en
   error (capturado aparte). `?? 0` defensivo → pendiente (no miente "hecho").
7. **¿Toqué pantallas de specs ajenas?** NO — solo `index.tsx` (home, ya de C1/C2) + `services/animals.ts`
   (C2) + el e2e de animals. Cero cambio en archivos de terminales paralelas.
8. **¿Hardcode?** 0 (check-hardcode verde). Solo props de Button (variant/fullWidth) + copy.

NO reemplaza al reviewer ni al Gate 2 — los precede.

## Verificación (fix-loop 3)

- `node scripts/check.mjs` VERDE (exit 0, "Entorno listo"): anti-hardcode **0** · client unit
  **191/191** (sin tests unit nuevos — cobertura por e2e del path real, ver §mapa) · RLS 17 · Edge 36
  · Animal 28 · Maniobras 13 · typecheck OK.
- `pnpm.cmd --dir app e2e` VERDE: **22/22**, estable en 2 corridas (el test "alta desde empty" ahora
  cubre además la transición pendiente→done del paso animal por estado real).

## Archivos (fix-loop 3)

Nuevos: (ninguno)

Modificados:
- `app/src/services/animals.ts` — `countAnimals(establishmentId): ServiceResult<number>` (count
  liviano head:true, scope establishment+active+deleted_at null, RLS barrera).
- `app/app/(tabs)/index.tsx` — `hasAnimals` + `loadAnimalCount` + `useFocusEffect` (dep primitiva
  `activeId`, guards de secuencia y de campo) + paso animal driveado (`done` si count>0).
- `app/e2e/animals.spec.ts` — el test "alta desde empty" verifica el paso pendiente→done (import de
  `gotoTab` agregado).

---

# fix-loop 4: paso "Invitá a tu vet o capataz" de la home por estado real

Cuarto fix-loop chico de C2, frontend only (sin migraciones). Baseline = el mismo de la línea 1
(`db9d586`, multi-sesión → NO se reescribe).

## El problema (Raf en web)

En Inicio, el Stepper de "primeros pasos" seguía mostrando **"Invitá a tu operario o vet de confianza"**
aunque Raf YA hubiera sumado a su vet. Causa: los pasos "rodeo" (`useRodeo`, fix C1) y "animal"
(`countAnimals`, fix-loop 3) ya se driveaban por estado real, pero el paso **equipo** quedó HARDCODEADO
`state:'future'` (estático) → MENTÍA cuando ya había equipo. NINGÚN paso debe MENTIR (consistente con
los fixes de rodeo y animal).

## El fix

1. **`services/members.ts` → `countTeam(establishmentId, selfUserId): CountTeamResult`** (nuevo,
   tipado). Dos HEAD counts (sin traer listas): `others` = `user_roles` activos del campo con
   `user_id != selfUserId`; `pending` = `invitations` con `status='pending'`. Reusa el `classifyQueryError`
   ya existente del módulo. NUNCA hardcodea establishment_id ni selfUserId (vienen del contexto). RLS como
   barrera (0008) — documentado en el docstring que es owner-céntrica (ver §RLS abajo).
2. **`app/(tabs)/index.tsx`**: estado `teamCounts: {others,pending}|null` + `loadTeamCount(estId, selfId,
   owner)`, recargado en el MISMO `useFocusEffect` que el conteo de animales, con **deps PRIMITIVAS**
   `[activeId, userId, isOwner, …]` (NO el objeto `activeField` — lección RodeoContext/miembros.tsx, sin
   loops). `loadTeamCount` es `useCallback([])` estable → el foco es evento discreto, no loopea. Guard de
   **secuencia** (`teamCountSeq`) descarta respuestas tardías; guard de **campo** (`teamCountedEstIdRef`)
   resetea `teamCounts` a null SOLO al cambiar de campo (no en re-foco del mismo) — patrón IDÉNTICO al de
   animales (`countedEstIdRef`) → ni parpadea en re-foco ni hereda el "hecho" del campo viejo al switchear
   (no mentir). En error (red/permisos) NO afirma estado falso (deja el valor previo).
3. **Paso "Invitá a tu vet o capataz" driveado**: `teamStarted = !isOwner || (teamCounts!=null &&
   (others>=1 || pending>=1))` → `state: teamStarted ? 'done' : 'active'`. Cuando `done`: título "Tu
   equipo está en marcha", body cálido, CTA "Gestionar equipo" (solo owner); pendiente: "Invitá a tu vet o
   capataz" + CTA "Invitar al equipo" (solo owner). Se rendea `done` igual que los pasos rodeo/animal
   (Stepper ✓ verde + título atenuado), consistencia visual. `isOwner` se elevó a primitivo arriba (junto a
   `activeId`) para que el loader y el step lo compartan sin recrear objetos.

## RLS owner-céntrica — por qué el no-owner se cierra por ROL, no por conteo

La policy `user_roles_select` (0008) es `user_id = auth.uid() OR is_owner_of(establishment_id)`:
- **OWNER**: ve TODAS las filas activas de su campo → `countTeam.others` cuenta a los demás miembros real;
  `invitations` es owner-only → `pending` cuenta sus invitaciones. El conteo decide el paso.
- **NO-OWNER**: solo ve su PROPIA fila → `others` SIEMPRE da 0 (no ve al owner ni a sus pares), y
  `pending` da 0 (invitations owner-only). El conteo NO sirve para él.

El brief asumía que un no-owner "cuenta al owner" — **es FALSO bajo esta RLS** (lo verifiqué en
`0008_rls_membership.sql`). Pero un no-owner que LLEGÓ a la home es en sí mismo evidencia de un equipo de
≥2 personas (alguien lo sumó). Por eso `teamStarted = !isOwner || (conteo)` → el no-owner cierra el paso
por su ROL, sin depender de un conteo que la RLS le oculta. Además, para evitar 2 round-trips inútiles,
`loadTeamCount` SALTEA el conteo si `owner === false` (deja `teamCounts` en null; el rol decide). Así
ningún rol ve el paso mentir y no se malgasta red.

## Mapa R → archivo:test (fix-loop 4)

- **Paso equipo driveado por estado real (owner: others≥1 || pending≥1 → done; 0/0 → pending)** →
  `app/(tabs)/index.tsx` (`teamCounts`/`loadTeamCount`/`teamStarted` + el step) ·
  `services/members.ts:countTeam` · **E2E** `animals.spec.ts`:
  - "fix-loop 4: con un 2do miembro sembrado, el paso de equipo de la home aparece HECHO" — owner + campo
    con un 2do miembro (`addMember`, vet) → home muestra "Tu equipo está en marcha", NO "Invitá a tu vet o
    capataz". Si el paso siguiera hardcodeado `future`, este assert fallaría (= el bug original).
  - "fix-loop 4: sin equipo, el paso de equipo de la home arranca PENDIENTE" — owner solo (0 otros, 0
    pendientes) → home muestra "Invitá a tu vet o capataz", NO "Tu equipo está en marcha".

Cobertura por E2E (no unit con mock de supabase): `countTeam` es query directa a Supabase; mismo criterio
que `countAnimals` (fix-loop 3, aprendizaje s21: flujos cliente↔RLS → test REAL contra el remoto). La
derivación `others≥1||pending≥1 → done` y el short-circuit por rol se cubren end-to-end por los 2 e2e.

## Autorrevisión adversarial (paso 8)

Busqué como revisor hostil:

1. **¿El paso miente en algún estado?** NO. OWNER con `teamCounts===null` (cargando) → PENDIENTE (default
   honesto; el peor error sería "hecho" en falso, que no hacemos). OWNER con others≥1 o pending≥1 → done.
   OWNER 0/0 → active. NO-OWNER → done por rol (correcto: alguien lo sumó; la RLS le oculta el resto). El
   bug original era el inverso (future para SIEMPRE).
2. **¿Loop de render (lección RodeoContext/miembros.tsx)?** NO. Deps PRIMITIVAS `[activeId, userId,
   isOwner, …]` (strings/boolean). `loadTeamCount` = `useCallback([])` estable. `setTeamCounts` no está en
   deps → no se auto-dispara. Foco = evento discreto. El e2e (que se colgaría ante un loop) pasa estable.
3. **¿Edge del SWITCH de campo (mentir heredando el "hecho")?** Cubierto con el MISMO guard que animales:
   `teamCountedEstIdRef` resetea `teamCounts` a null SOLO al cambiar de campo → al switchear de un campo
   con equipo (done) a otro sin equipo, el segundo arranca PENDIENTE (honesto) hasta su conteo. Re-foco del
   mismo campo NO resetea → sin parpadeo.
4. **¿Brief incorrecto sobre la RLS (no-owner cuenta al owner)?** ATRAPADO: la policy `user_roles_select`
   (0008) NO deja a un no-owner ver al owner (solo su propia fila). En vez de seguir el brief al pie (que
   habría dado `others=0` → paso pendiente FALSO para un no-owner), cerré el paso por ROL para el no-owner
   (que es evidencia de equipo) → resultado correcto y honesto para ambos roles.
5. **¿2 round-trips inútiles para no-owner?** Evitados: `loadTeamCount` saltea el conteo si `!owner` (el
   rol decide). Menos red y no dependemos de un valor que ignoraríamos.
6. **¿`count` null → falso 0?** Con `count:'exact'` PostgREST da el count exacto; null solo en error
   (capturado aparte vía `classifyQueryError`). `?? 0` defensivo → pendiente (no miente "hecho").
7. **¿Los 3 pasos salen de estado real y ninguno miente?** SÍ: rodeo (`useRodeo`), animal (`countAnimals`),
   equipo (`countTeam`+rol). Cero hardcode de `state`. (La home "real" es post-MVP; acá solo que el
   Stepper no mienta — no se inventó una home nueva.)
8. **¿Multi-tenant / RLS?** `countTeam` recibe `activeId`+`userId` del contexto (nunca hardcodeados),
   filtra `establishment_id` + RLS barrera. HEAD counts no exponen filas. Sin migraciones, sin permisos
   nuevos.
9. **¿Toqué pantallas de specs/terminales paralelas?** NO — solo `index.tsx` (home, C1/C2) +
   `services/members.ts` (spec 01, helper aditivo) + el e2e de animals. Cero cambio en archivos de otras
   terminales.
10. **¿Hardcode?** 0 (check-hardcode verde). Solo props de Button (variant/fullWidth) + copy.

NO reemplaza al reviewer ni al Gate 2 — los precede.

## Verificación (fix-loop 4)

- `node scripts/check.mjs` VERDE (exit 0, "Entorno listo"): anti-hardcode **0** · client unit
  **191/191** (sin tests unit nuevos — cobertura por e2e del path real, mismo criterio que fix-loop 3) ·
  RLS 17 · Edge 36 · Animal 28 · Maniobras 13 · typecheck OK.
- `pnpm.cmd --dir app e2e` VERDE: **24/24** (22 previos + 2 nuevos fix-loop 4: paso equipo done con 2do
  miembro / pendiente sin equipo), estable en 2 corridas contra el remoto.

## Archivos (fix-loop 4)

Nuevos: (ninguno)

Modificados:
- `app/src/services/members.ts` — `countTeam(establishmentId, selfUserId): CountTeamResult` (2 HEAD
  counts: otros miembros activos + invitaciones pendientes; RLS owner-céntrica documentada).
- `app/app/(tabs)/index.tsx` — `isOwner` elevado a primitivo; `teamCounts` + `loadTeamCount` (dep primitiva
  `activeId/userId/isOwner`, guards de secuencia y de campo, salta conteo si no-owner) en el mismo
  `useFocusEffect` que el conteo de animales; paso equipo driveado por `teamStarted` (done si owner con
  equipo, o no-owner por rol).
- `app/e2e/animals.spec.ts` — 2 tests nuevos del paso equipo (done con 2do miembro / pendiente sin equipo)
  + import de `addMember`.
