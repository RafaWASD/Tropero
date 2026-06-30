baseline_commit: a25e21f40984b5bc7b829e917f78e37038bf931e

# impl — Delta VINCULAR LA CRÍA AL PIE (#15) — FRONTEND (prompt + E2E) — spec 02, Nivel B

**Alcance de ESTE run (implementer):** SOLO el FRONTEND del prompt saltable + E2E. El BACKEND (RPC
`link_calf_to_mother` / `register_birth` 6-arg + outbox/upload/events) ya estaba hecho, aplicado al remoto y
commiteado (70c2efd) por el run de backend (`progress/impl_cria-al-pie-alta.md`). **NO** toqué backend ni
outbox/upload/events (sin bugs encontrados). `baseline_commit` = el de la feature (multi-sesión; SHA previo a
la 1ª task = T1 backend) — NO se reescribe.

Tasks cubiertas acá: **T14, T15, T16, T17, T18, T19 (Fase E)** + **T20-restante, T21 (Fase F)**.

## Iteración post-implementer (pre-gates): salida "← Cambiar caravana"
Feedback de diseño (control & freedom, Nielsen #3): desde `found`/`create` el operario no tenía cómo volver a
re-tipear la caravana — un typo en la manga lo obligaba a crear un ternero bogus o abandonar. **Agregado:**
- `LinkCalfPrompt.tsx`: handler `backToAsk` (`setPhase({kind:'ask'})` + limpia `actionError`/`sexError`/
  `birthYearError`/`dayMonthError`/`info`; **CONSERVA `query`** para corregir sobre lo tipeado; respeta el
  `busyRef` guard; reset completo sigue siendo solo en `open`) + affordance "← Cambiar caravana" en el footer
  ARRIBA de "Ahora no" (solo si `phase.kind !== 'ask'`; mismo patrón visual que "Ahora no": `$textMuted`, `$5`/
  `$5` lineHeight matcheado, `minHeight $touchMin`; a11y `buttonA11y` label "Cambiar caravana"; `testID=link-calf-back`).
- E2E `RCAP.4/RCAP.5`: tras caer en CREATE → "Cambiar caravana" → reaparece "Caravana del ternero" con el valor
  previo (`toHaveValue(calfIdv)`) → re-buscar → vuelve a CREATE.
- Verificación: **typecheck limpio**, **lint anti-hardcode 0 violaciones**, **E2E `RCAP.4/RCAP.5` PASS** (13.6s,
  build + Playwright contra el remoto). `design/` working tree limpio.

## Iteración post-reviewer: cobertura de RCAP.4.2 (sexo requerido, rama de ERROR)
Bloqueante de cobertura del reviewer: el guard de sexo faltante (`onConfirmCreate`) no tenía test de su rama
negativa. **Agregado** al E2E `RCAP.4/RCAP.5` (mismo test, sin duplicar setup): ya en la fase CREATE y ANTES de
elegir sexo → tap `link-calf-create` → `expect` "Elegí el sexo del ternero." visible + `link-calf-create` sigue
visible (= sigue en CREATE, no navegó) → después se elige sexo y se crea normal.
- **Fix de una aserción mal puesta (bug del TEST, no del producto):** mi 1er intento agregó
  `expect(getByText('Identificación')).toHaveCount(0)` como oráculo de "no navegó", pero "Identificación" es
  TAMBIÉN un título de sección del form de alta que queda montado DETRÁS del sheet (`position:absolute`) → ese
  texto siempre matchea ≥1 con el prompt abierto → `toHaveCount(0)` nunca pasa. **Eliminada**: el
  `expect(getByTestId('link-calf-create')).toBeVisible()` ya es el oráculo correcto y suficiente de "no navegó"
  (tras navegar a la ficha, ese testID no existiría).
- Verificación: **E2E `delta #15 (RCAP.4/RCAP.5)` PASS** (18.9s, re-build + Playwright contra el remoto, workers=1).
  `design/` revertido (diffs espurios del `e2e:build`) → working tree limpio.

## Plan (tasks de este run)
- [x] **T14** — Prompt saltable post-create en `crear-animal.tsx`: render solo si `nursing===true` en el happy
  path (`softFails.length===0`); "Ahora no" navega a la ficha sin re-crear; bloqueado si el alta falló o hubo
  soft-fail. RCAP.1.1/1.2/1.3/1.4/1.6.
- [x] **T15** — Captura del identificador + find-or-create (`classifyCalfQuery` → `lookupByTag` EID /
  `searchAnimals` IDV; error inline vacío/corta; lectura LOCAL offline). RCAP.2.1–2.5, 1.5.
- [x] **T16** — Camino ENCONTRADO (`fetchMother` → "ya tiene madre" / "otro campo" / OK → `linkCalfToMother`
  con `eventDate = birth_date ?? hoy`; navegar optimista). RCAP.3.3/3.4/3.5 (+3.1/3.2).
- [x] **T17** — Camino NO ENCONTRADO (mini-form sexo*/fecha es-AR/rodeo → `registerBirth`; caravana tipeada
  fluye: EID→`calves[0].tag`, IDV→`calfIdv`). RCAP.4.1/4.2/4.4/4.5 (+7.6 lado cliente).
- [x] **T18** — Rodeo del ternero: rodeo de la madre preseleccionado + leyenda "(Mismo rodeo que la madre)";
  editable a otro rodeo del MISMO SISTEMA; no auto-mueve terneros existentes (picker solo en CREATE). RCAP.5.1–5.5.
- [x] **T19** — MUSTs de forms: tokens (ADR-023, 0 violaciones), anti-recorte (`lineHeight` matcheado en TODO
  título/Text con descendentes), validación inline (sin banner que tape el título), es-AR (año+DD/MM reusando
  `validateBirthDate`), una sola cría por invocación (cierra tras éxito). RCAP.9.1–9.5.
- [x] **T20-restante** — Orden FIFO + clasificación del rechazo (ver "Offline-first" abajo). RCAP.8.4/8.5.
- [x] **T21** — E2E en `app/e2e/animals.spec.ts` (5 tests nuevos + 1 editado). RCAP.10.7.

## Archivos
- **NUEVO** `app/src/components/LinkCalfPrompt.tsx` — el prompt saltable (bottom-sheet, molde
  `BreedPickerSheet`): backdrop `$scrim` + guard doble-rAF + header fijo / body scroll / footer fijo. Máquina
  de 3 fases (`ask` → `found` → `create`) con I/O propia (lookupByTag/searchAnimals/fetchMother/
  linkCalfToMother/registerBirth). Exportado desde `app/src/components/index.ts`.
- **NUEVO** `app/src/utils/link-calf-query.ts` — helper PURO: `classifyCalfQuery` (empty/too-short/eid/idv),
  `resolveLinkEventDate` (RCAP.3.2), `todayIsoLocal`.
- **NUEVO** `app/src/utils/link-calf-query.test.ts` — 12 unit tests (node:test). Registrado en
  `scripts/run-tests.mjs`.
- **MOD** `app/app/crear-animal.tsx` — wiring: estado `linkPromptMotherId`, refactor de la navegación
  post-create a `navigateAfterCreate(profileId)` (fuente única: happy-path / re-tap soft-fail / cierre del
  prompt), disparo del prompt en el happy path con `nursing===true`, `<LinkCalfPrompt>` montado al root.
- **MOD** `app/src/components/index.ts` — export del barrel.
- **MOD** `app/e2e/animals.spec.ts` — 5 tests nuevos + 1 editado (el de la multípara ahora descarta el prompt).
- **MOD** `scripts/run-tests.mjs` — registro del nuevo `link-calf-query.test.ts`.

## Mapa RCAP.<n> → archivo:test

| RCAP | Archivo (as-built) | Test / evidencia |
|------|--------------------|------------------|
| 1.1 (prompt con nursing) | `crear-animal.tsx` happy-path + `LinkCalfPrompt.tsx` | E2E `animals.spec.ts` `RCAP.1.1/1.3/1.4` + `B: alta de una MULTÍPARA` |
| 1.2 (no prompt sin nursing) | `crear-animal.tsx` (`showNursing && nursing===true`) | E2E `RCAP.1.2` |
| 1.3 ("Ahora no") | `LinkCalfPrompt.tsx` (`onSkip`/footer) | E2E `RCAP.1.1/1.3/1.4` |
| 1.4 (skip preserva la vaca, sin re-crear) | `crear-animal.tsx` (`navigateAfterCreate`, `createdProfileId`) | E2E `RCAP.1.1/1.3/1.4` (`getServerBirthState===0`) |
| 1.5 (offline) | `LinkCalfPrompt.tsx` (lecturas LOCAL + outbox) | servicios offline-first del backend run; (sin E2E offline dedicado — ver nota) |
| 1.6 (alta falló → no prompt) | `crear-animal.tsx` (`if (!created.ok) return` antes de la rama nursing) | lógica (cubierto por el early-return) |
| 2.1–2.5 (captura + find-or-create) | `link-calf-query.ts` (`classifyCalfQuery`) + `LinkCalfPrompt.tsx` (`onSearch`) | unit `link-calf-query.test.ts`; E2E found/create/empty |
| 3.1/3.2/3.5 (vincular existente) | `LinkCalfPrompt.tsx` (`onConfirmLink`) + `resolveLinkEventDate` | unit (`resolveLinkEventDate`); E2E `RCAP.3.1/3.2/3.5` (oráculo `waitForServerBirth`) |
| 3.3 (ya tiene madre) | `LinkCalfPrompt.tsx` (`onSearch`/`fetchMother`) | E2E `RCAP.3.3` |
| 3.4 (otro campo) | `LinkCalfPrompt.tsx` (`onSearch`/`lookupByTag` transfer) | lógica + `tag-lookup` unit (ver nota: sin E2E dedicado) |
| 4.1/4.2/4.4/4.5 (crear+vincular) | `LinkCalfPrompt.tsx` (`onConfirmCreate`) | E2E `RCAP.4/RCAP.5` (oráculo `waitForServerBirth`) |
| 5.1–5.5 (rodeo del ternero) | `LinkCalfPrompt.tsx` (`CreateCalfForm`) | E2E `RCAP.4/RCAP.5` (leyenda visible → editar a otro rodeo → leyenda desaparece) |
| 7.6 (caravana tipeada → ternero, lado cliente) | `LinkCalfPrompt.tsx` (`CreateIdentifier`: EID→tag, IDV→calfIdv) | unit `classifyCalfQuery`; E2E `RCAP.4/RCAP.5` |
| 8.4 (FIFO) / 8.5 (rechazo) | `crear-animal.tsx` + servicios | ver "Offline-first" (8.5 clasificación = backend run) |
| 9.1–9.5 (MUSTs de forms) | `LinkCalfPrompt.tsx` | lint anti-hardcode (0 violaciones) + E2E |
| 10.7 (UI/integración) | `animals.spec.ts` | 5 tests nuevos |

## Offline-first (T20-restante: FIFO + clasificación)
- **FIFO (RCAP.8.4):** el prompt SOLO se abre DESPUÉS de que `createAnimal` (de la vaca) ya encoló su intent
  `create_animal` (happy path, tras los eventos post-create). El `linkCalfToMother`/`registerBirth` del prompt
  encola su intent DESPUÉS → la outbox drena en orden: la madre existe server-side antes de que corra
  `link_calf_to_mother`. No hace falta acoplamiento explícito: el orden lo garantiza el flujo de UI.
- **Clasificación (RCAP.8.5):** el rechazo permanente (`23503`/`23514`/`42501`) lo clasifica `uploadData`
  (`permanent_reject`, hecho en el backend run, `upload.test.ts`); la vaca no se pierde (ya existe). El prompt
  superficia el fallo LOCAL (encolado) en `actionError`, pero offline el encolado siempre tiene éxito.

## Autorrevisión adversarial (paso 8)
Releí mi diff como revisor hostil. Qué busqué y qué encontré/corregí:
1. **Wiring muerto / no disparado** (un agente anterior dejó wiring muerto): verifiqué que `<LinkCalfPrompt>`
   está montado al root de `crear-animal.tsx` Y que `linkPromptMotherId` se setea en el happy path
   (`showNursing && nursing===true`). **Confirmado end-to-end por E2E**: `RCAP.1.1` (aparece), `RCAP.1.2` (NO
   aparece sin nursing), link/create/skip todos ejercen el flujo real.
2. **Token error `$danger` inexistente** → lo encontré: el token de error del DS es `$terracota` (FormField/
   AuthBits). **Corregido** (2 ocurrencias) + re-verificado con typecheck + lint anti-hardcode (0 violaciones).
3. **Imports/props muertos**: `Search` importado sin usar y prop `isMother` sin usar en `RodeoOptionRow` →
   **removidos**.
4. **Recorte de descendentes**: el título "¿Vincular su cría al **p**ie?" tiene descendente → `fontSize $7
   lineHeight $7` matcheado; todo Text con `numberOfLines`/descendentes lleva `lineHeight` matcheado.
5. **Regresión en tests existentes**: mi disparo del prompt rompía el test `B: alta de una MULTÍPARA` (elegía
   "Con cría al pie" → esperaba la ficha directo). **Lo actualicé** para descartar el prompt con "Ahora no"
   antes de la ficha. Confirmé que NINGÚN otro test elige "Con cría al pie" (grep) → sin más regresiones.
6. **Camino maniobra**: refactoricé la navegación post-create a `navigateAfterCreate`. Corrí los 2 tests de
   navegación de maniobra (`(n)`/`(o)` de `maniobra-identify.spec.ts`) → ambos verdes (la rama
   maniobra→carga y la rama alta→ficha quedaron intactas).
7. **Fixture del E2E "ya tiene madre"**: mi 1er intento sembraba `birth_calves` vía `admin` (service_role) →
   **falló**: `permission denied for table birth_calves` (es server-only, sin GRANT de INSERT a NADIE salvo el
   DEFINER — confirma RCAP.6.10 in vivo). **Corregido**: el vínculo se siembra vía la RPC REAL
   `link_calf_to_mother` desde un cliente autenticado (el owner) — el único camino server-side legítimo.
8. **Race de sync en "ya tiene madre"**: `fetchMother` lee LOCAL → agregué un gate determinista (la ficha del
   ternero muestra la card "Madre" antes de seguir) → sin race de first-sync.
9. **Edge cases de la captura**: vacío → error; <3 díg / no-numérico → "muy corta"; >1 resultado (ambiguo) →
   aviso "varios"; `busyRef` blinda doble-submit; el backdrop/"Ahora no" se ignoran mientras hay un encolado
   en curso. Cubiertos por unit (`classifyCalfQuery`) + el código de `onSearch`.

## Reconciliación as-built (para el leader — NO toqué specs en este run, por instrucción del brief)
Documentado acá para que el leader reconcilie `design`/`requirements` antes de cerrar:
- **Clasificación EID vs IDV (RCAP.2.1/2.2):** el design §5 dice "classifyIdentifier", pero ese motor devuelve
  `idv|visual` y NO distingue EID. La rama EID↔IDV se decide con un clasificador dedicado `classifyCalfQuery`
  (15 díg puros → EID/`lookupByTag`; ≥3 díg ≠15 → IDV/`searchAnimals`). Es un refinamiento de implementación
  fiel a la intención (EID = caravana electrónica de 15 díg).
- **RCAP.2.5 ("EID inválido"):** el campo es numérico (number-pad + `sanitizeIdvInput`, tope 20 díg). El
  as-built rechaza inline: vacío ("Ingresá la caravana del ternero") y <3 díg/no-numérico ("Revisá la
  caravana: es muy corta"); 16-20 díg numéricos se tratan como IDV (no se rebotan: un IDV largo es legítimo).
  No hay un rechazo separado ">15 díg = EID inválido".
- **Guard extra (no en el spec):** si el find-or-create devuelve >1 match (ambiguo) → aviso "Encontramos
  varios animales con esa caravana", sin vincular (consistente con RCAP.2.3 "exactamente uno").
- **Fecha del CREATE:** el mini-form usa AÑO (AAAA) + DÍA/MES (DD/MM) reusando `validateBirthDate` del alta
  (RCAP.9.4); `event_date` del parto = la fecha resuelta (exacta/midpoint) o hoy si vacía.

## Verificación (corrida en vivo)
- **typecheck** (`cd app && pnpm typecheck`): **PASA limpio** (0 errores).
- **unit** (`node --import ./scripts/ts-ext-resolver.mjs --test app/src/utils/link-calf-query.test.ts`):
  **12/12 PASS**.
- **lint anti-hardcode** (`node scripts/check.mjs --fast`): **0 violaciones** (ADR-023 §4) + estructura OK.
- **E2E** (`pnpm run e2e:build` + `playwright test`, contra el remoto, workers=1):
  - delta #15 + multípara editado: **6/6 PASS** (41.7s) — `RCAP.1.2`, `RCAP.1.1/1.3/1.4` (+ `getServerBirthState===0`),
    `RCAP.3.1/3.2/3.5` (+ `waitForServerBirth` 1 parto / 1 birth_calf), `RCAP.4/RCAP.5` (rodeo editable + parto
    en el server), `RCAP.3.3` (aviso "ya tiene madre"), `B: alta de una MULTÍPARA` (editado).
  - Regresión navegación maniobra (`maniobra-identify` `(n)`/`(o)`): **2/2 PASS** (18.2s).
  - NOTA: `e2e:build` NO re-renderizó `design/**/*.png` en esta corrida (la corrida regular de `playwright
    test`, sin la config de captura, no toca `design/`) → working tree de `design/` limpio. `dist/` y
    `test-results/` quedan gitignored.

## Cobertura NO verificada por E2E (gaps conocidos, documentados)
- **RCAP.3.4 (ternero en OTRO campo, EID transfer):** la lógica está (`lookupByTag` mode `transfer` → aviso),
  pero no hay E2E dedicado (sembrar un ternero activo en OTRO campo del mismo usuario + bastonearlo por EID es
  caro de montar). Cubierto por la lógica + el unit de `tag-lookup` del baseline.
- **RCAP.1.5 (offline):** el prompt usa lecturas LOCAL + outbox (offline-safe por construcción, mismos
  servicios que el backend run probó offline), pero no hay un E2E del prompt con la red cortada.
