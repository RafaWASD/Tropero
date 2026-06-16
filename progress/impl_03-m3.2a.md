baseline_commit: 638679fa61672e884fc75b3ae94a855bf9853642

# impl — spec 03 (MODO MANIOBRAS) — chunk M3.2a (pantallas de "elegir un valor")

> Frontend puro sobre M3.1 (orquestador done) + backend done (0091 aplicada). Gate 1 N/A.
> Las 3 pantallas de paso de las maniobras de "elegir un valor": tacto vaquillona, condición corporal, dientes (+ prompt CUT).
> **NO marco done** — espera reviewer + Gate 2.

## Estado: DONE (técnico) — check.mjs RC=0. NO marco done (espera reviewer + Gate 2).

Feature 03 `in_progress`, spec aprobado (Puerta 1). Construí SOLO los 3 renderers + su cableado al `switch` del dispatcher de `carga.tsx` (el SEAM de M3.1). NO reimplemento el write-path (M3.1 ya lo tiene: `persistManeuverEvent` con StepValue `vaquillona`/`score`/`dientes`).

## baseline Gate 2
`638679fa61672e884fc75b3ae94a855bf9853642` (= baseline de M3.1, SHA previo a la 1ra task de la feature 03 cliente reciente; NO se sobreescribe — multi-sesión).

## Plan (T1..T7) — todas cerradas

- [x] T1 — Lógica pura: `condition-stepper.ts` (clamp/snap a grilla 0,25 sin drift, ±, default 3,00, formato es-AR 2 decimales) + `teeth-options.ts` (8 opciones del enum 0020 en orden de boca + cutTrigger DERIVADO de `CUT_PROMPT_TEETH` + labels). Exporté `CUT_PROMPT_TEETH` de `maneuver-applicability.ts` (única fuente del umbral). Tokens `$amber`/`$amberPress` + `$stepperBtn`=88.
- [x] T2 — `TactoVaquillonaStep.tsx` — 3 bloques gigantes APTA (verde ✓) / NO APTA (terracota ✗) / DIFERIDA (ámbar ⏲). Un toque = `onConfirm(fitness)`.
- [x] T3 — `CondicionCorporalStep.tsx` — stepper gigante (valor hero `$11` + −/+ `$stepperBtn`=88, step 0,25, 1,00–5,00, default 3,00, límites deshabilitados) + pista de escala visual (5 marcas + activa resaltada) en card de superficie (densidad R12.5) + CTA Confirmar.
- [x] T4 — `DientesStep.tsx` — bloques gigantes del enum + prompt CUT (sheet patrón ManeuverConfigSheet) si 1/2·1/4·sin_dientes y NO ternero (`shouldOfferCutPrompt`) + service `resolveCutCategory` (code='cut' → category_id; `resolveRevertCategory` para la derivada).
- [x] T5 — Enchufado al `switch` de `carga.tsx` (cases `vaquillona`/`score`/`dientes`); paso del `animal` real al dispatcher; resolución de `cutCategoryId` en `captureAndAdvance` (CUT al marcar / derivada al desmarcar).
- [x] T6 — Tests: unit `condition-stepper.test.ts` (18) + `teeth-options.test.ts` (9) + e2e `maniobra-elegir.spec.ts` (2/2) + 4 capturas 412×915.
- [x] T7 — check.mjs RC=0; autorrevisión (abajo); reconciliación design §6.bis.3/tasks M3.2a/M3.2b; mapas.

## Archivos tocados
**Nuevos:**
- `app/src/utils/condition-stepper.ts` — lógica pura del stepper (clamp/snap/±/format es-AR). + `condition-stepper.test.ts`.
- `app/src/utils/teeth-options.ts` — catálogo puro del enum dientes + cutTrigger derivado. + `teeth-options.test.ts`.
- `app/app/maniobra/_components/TactoVaquillonaStep.tsx` — 3 bloques apta/no_apta/diferida.
- `app/app/maniobra/_components/CondicionCorporalStep.tsx` — stepper gigante.
- `app/app/maniobra/_components/DientesStep.tsx` — bloques enum + prompt CUT sheet.
- `app/e2e/maniobra-elegir.spec.ts` — e2e de las 3 (+ ternero no-CUT).

**Modificados:**
- `app/app/maniobra/carga.tsx` — dispatcher: 3 `case` nuevos + `animal` al ManeuverStep + resolución de `cutCategoryId`.
- `app/src/services/animals.ts` — `resolveCutCategory(profileId)` (NUEVO, público; reusa `resolveRevertCategory` + `buildCategoryIdByCodeQuery`).
- `app/src/utils/maneuver-applicability.ts` — exporté `CUT_PROMPT_TEETH` (era privado).
- `app/tamagui.config.ts` — tokens `$amber`/`$amberPress` (DIFERIDA) + `$stepperBtn`=88 (botón − / +). JIT provisionales.
- `app/e2e/helpers/admin.ts` — oráculos server `waitForServerVaquillonaWithSession` / `waitForServerConditionScoreWithSession` / `waitForServerTeethState` + `getCategoryCodeById`.
- `scripts/run-tests.mjs` — engancha los 2 unit nuevos.
- Specs reconciliadas: `tasks.md` (M3.2a `[x]` as-built + split M3.2b), `design.md` (§6.bis.3 as-built).

## Mapa StepValue → write-path (M3.1, ya existente — M3.2a solo CAPTURA el valor)
| Pantalla (M3.2a) | StepValue | Persiste (M3.1) |
|---|---|---|
| TactoVaquillonaStep | `{ kind:'vaquillona', fitness }` | `reproductive_events` tacto_vaquillona + heifer_fitness (0053) |
| CondicionCorporalStep | `{ kind:'score', score }` | `condition_score_events` |
| DientesStep | `{ kind:'dientes', teethState, cut }` + `cutCategoryId` | UPDATE `animal_profiles.teeth_state` (+ is_cut/category/override si CUT) |

## Mapeo de valores de dientes → CUT-trigger (R6.8) — el que usé
Enum real `teeth_state_enum` (0020): `'2d','4d','6d','boca_llena','3/4','1/2','1/4','sin_dientes'`.
**CUT-trigger (dispara el prompt): `1/2`, `1/4`, `sin_dientes`.** NO `3/4` (R6.8 explícito), NO `2d/4d/6d/boca_llena`.
Fuente: `CUT_PROMPT_TEETH` de `maneuver-applicability.ts` (M3.1) — `teeth-options.ts` DERIVA su `cutTrigger` de ese set (no lo re-define) → si Facundo cambia el umbral, se toca UN set. El prompt además NO aparece para terneros (`shouldOfferCutPrompt`: categoría ∈ {ternero, ternera} → false).

## Mapa test → R
| R | Test(s) |
|---|---|
| R6.3 / R5.13 (tacto vaquillona apta/no_apta/diferida + heifer_fitness) | maniobra-elegir e2e: APTA → `waitForServerVaquillonaWithSession('apta')`; los 3 bloques visibles |
| R6.6 (condición corporal 1,00–5,00 step 0,25 default 3,00) | condition-stepper.test (clamp/snap/±/límites/format es-AR, 18 casos); maniobra-elegir e2e: 3,00→+→3,25 → `waitForServerConditionScoreWithSession(3.25)` |
| R6.7 (dientes propiedad teeth_state, NO evento) | teeth-options.test (cobertura enum + orden + labels); maniobra-elegir e2e: `waitForServerTeethState('1/2')` (UPDATE de animal_profiles) |
| R6.8 (prompt CUT 1/2·1/4·sin_dientes + NO terneros + transición) | teeth-options.test (valor→cutTrigger derivado de CUT_PROMPT_TEETH); maniobra-elegir e2e: 1/2 → sheet → Marcar CUT → `waitForServerTeethState('1/2', {expectCut:true})` is_cut+override+category='cut'; **+ test ternero: sin_dientes en ternera → NO sheet → teeth sin CUT** |
| R5.2 / R12.5 (botones gigantes / densidad) | capturas 412×915 (bloques full-width que se reparten el alto; stepper en card; dientes llena la pantalla) |

## Rutas de las 4 capturas (412×915)
- `design/maniobra-elegir/tacto-vaquillona.png` — 3 bloques (verde APTA / terracota NO APTA / ámbar DIFERIDA).
- `design/maniobra-elegir/condicion-corporal.png` — stepper (−/+ gigantes, "3,25" hero, escala con marca 3 resaltada, en card).
- `design/maniobra-elegir/dientes.png` — 8 bloques del enum (llenan la pantalla).
- `design/maniobra-elegir/dientes-cut-prompt.png` — sheet CUT (alerta + Marcar CUT terracota / No, solo registrar dientes).

## Autorrevisión adversarial (paso 8) — qué busqué, qué encontré, cómo lo cerré
- **(a) R cubierto / a medias**: R6.3/R6.6/R6.7/R6.8 revisados contra el código + tests. R5.13 (heifer_fitness enum) lo cubre el write-path M3.1 (verificado server-side por el oráculo). R5.7 (required faltante bloquea) NO aplica a estas 3: ninguna tiene "campo opcional faltante" — son selecciones cerradas siempre completas (tacto vaquillona/dientes = 1 toque; score = default 3,00 siempre válido). El gating capa 2 server-side (data_key enabled) lo dispara el wizard al ofrecer la maniobra (R5.5/5.6), no estas pantallas. Anotado en tasks (M3.2a satisface R5.7 "parcial: sin campo opcional").
- **(b) edge cases / NULL / vacío / límites / orden**:
  - **Stepper drift de coma flotante** (3+0.25 ≠ 3.2499…): cerrado trabajando en "cuartos" (×4, Math.round, ÷4) — test dedicado verifica `incrementScore(3) === 3.25` EXACTO + ida-y-vuelta inversa en todo el rango.
  - **Stepper límites**: − deshabilitado en 1,00, + en 5,00 (no se pasa del rango) — test + UI (opacity + onPress undefined).
  - **Stepper no-finito** (NaN/Infinity, dato heredado): cae al default 3,00 — test.
  - **HALLAZGO cerrado — truncado del valor hero**: la 1ra captura del stepper mostraba "3,..." (el número de 64px se recortaba con ellipsis entre los 2 botones de 88px + gap $5). Cerrado: gap $5→$3 + `adjustsFontSizeToFit`/`minimumFontScale=0.6` → "3,25" completo (re-capturado, e2e verifica "3,25" exacto en el DOM). Era un bug de lectura real en manga.
  - **HALLAZGO cerrado — densidad R12.5 del stepper**: la 1ra versión dejaba ~30% de vacío arriba y ~25% abajo (stepper flotando). Cerrado: pista de escala visual (info útil, no vacío) + card de superficie que delimita la zona de acción (figura-fondo) → el control tiene peso, sin región muerta grande.
  - **Dientes corrección de CUT**: corregir un dientes con CUT eligiendo 2d → cut=false → `cutCategoryId=derivedCategoryId` → `buildUnsetCutUpdate` revierte is_cut + categoría derivada (consistencia, R6.8). El UPDATE de teeth_state ignora isCorrection (es propiedad, no split INSERT/UPDATE) — correcto.
- **(c) seguridad / gaps**:
  - **dientes/CUT sin IDOR**: el UPDATE de animal_profiles lo gatea la RLS (`has_role_in` del perfil) + el trigger `tg_animal_profiles_teeth_gating` (0054, gating capa 2 del cambio aditivo `dientes` enabled) + 0021 (categoría del sistema correcto). El cliente NO fuerza nada: pasa profileId del contexto.
  - **categoría CUT no spoofeable**: `resolveCutCategory` resuelve el `category_id` del catálogo LOCAL por (system_id REAL del perfil, code='cut') — no se recibe del usuario. Fail-safe: sin id → solo teeth_state (no fija categoría inválida que 0021 rechazaría con 23514).
  - **prompt CUT no-terneros**: gate de cliente (`shouldOfferCutPrompt`); la barrera real de "no marcar CUT a un ternero" es de producto (la transición CUT a un ternero la permitiría el server, pero la UI no la ofrece) — coherente con R6.8 (es un gate de UI, el server gatea rodeo no categoría).
  - **created_by/establishment_id NUNCA en el payload** (los fuerza el trigger); session_id del caller (no hardcodeado).
- **(d) multi-tenant / offline**: todo CRUD-plano local (UPDATE teeth_state / INSERT score/vaquillona) → CrudEntry → upload; `resolveCutCategory` es 100% SELECT del SQLite local (offline-safe); NUNCA establishment_id hardcodeado (anti-hardcode lint verde). El e2e NO tiene un caso offline dedicado para estas 3 (M2.2 ya probó el camino CRUD-plano offline con session_id; estas reusan el MISMO `persistManeuverEvent`) — anotado para el reviewer.
- **(e) tests que pasan por la razón equivocada**: el e2e verifica SERVER-side (no solo UI): heifer_fitness='apta' + condition_score=3.25 + teeth_state='1/2' con is_cut=true + category_override=true + **category_id resuelto a code='cut'** (oráculo `getCategoryCodeById`) — prueba el camino REAL de CUT, no un string-match. El test del ternero prueba el REJECT del prompt (llega al resumen sin sheet + teeth sin CUT server-side), no solo "no se ve". El stepper test verifica el snap EXACTO (no aproximado).
- **HALLAZGO cerrado — seed del ternero**: la 1ra versión seedeaba la ternera SIN birth_date → el espejo C6 derivaba 'vaquillona' (default conservador RT2.4.6) → el prompt CUT aparecía (el gate la veía como adulta). Cerrado: seed con birth_date < 1 año (ternera REAL) → el espejo deriva 'ternera' → el gate la reconoce. Es el caso fiel de campo (una ternera tiene fecha de nacimiento). Documentado en design §6.bis.3 + el comentario del seed.

## Reconciliación de specs (paso 9)
- `tasks.md`: la task M3.2 (monolítica) se SPLITEÓ en **M3.2a** (`[x]` as-built completo — las 3 pantallas de "elegir" + piezas) + **M3.2b** (`[ ]` el resto: sanitarias/tubos/inseminación/pesaje ternero + frame preview/lote). El detalle de M3.2b conserva el plan original.
- `design.md`: nuevo **§6.bis.3** (as-built M3.2a) describiendo las 3 pantallas, los tokens nuevos, el path de `resolveCutCategory`, el gate del prompt CUT y la nota del espejo de categoría para el ternero. El §6.bis.2 (tacto 2-pasos) y §4 (gating dientes/CUT) ya describían el backend — no contradicen.
- `requirements.md`: SIN cambios de *qué* (no se reconcilió ningún EARS — la implementación honra R6.3/R6.6/R6.7/R6.8 tal como están; el umbral CUT = 1/2·1/4·sin_dientes ya estaba en R6.8).

## Nota de decisiones visuales (para el veto del leader)
- **DIFERIDA = ámbar, NO neutro/gris**: sobre 2 bloques vivos (verde/terracota), un gris se leería como "deshabilitado" — ambigüedad fatal en manga. El ámbar (`$amber` #9A6206, texto blanco ≈5,0:1 AA) tiene semántica universal de espera/pausa = diferir. Ícono reloj (Clock). Token provisional a canonizar.
- **Condición corporal en card + pista de escala visual**: la decisión simple (un stepper) flotando en el centro dejaba vacío muerto (>20%, viola R12.5). La card de superficie le da peso (figura-fondo) y la pista de 5 marcas con la activa resaltada llena el espacio con INFO útil (dónde cae el animal) en vez de vacío. Stepper −/+ 88px (≥80 del leader), valor hero 64px sin truncar.
- **Dientes 8 bloques scrolleables**: los 8 valores del enum llenan el alto (densidad alta). El prompt CUT es un sheet (no una pantalla nueva) → no rompe el flujo de un toque; scrim atenúa el selector detrás.
- **Opinables dejados como están**: copy del prompt CUT ("Esta boca indica vaca CUT (de descarte)…"); ícono reloj para DIFERIDA; "1=flaca·5=gorda".

## check.mjs
RC=0 (run limpio): typecheck client + anti-hardcode (0 violaciones en los 3 componentes + tokens) + client unit (incl. condition-stepper 18 + teeth-options 9) + RLS/Edge/Animal/Maneuvers/Operaciones-rodeo backend verdes. e2e `maniobra-elegir.spec.ts` 2/2. Sin flake de rate-limit ni spec-12 en este run.

## NO done
Espera reviewer + Gate 2 (security code) + veto de diseño del leader + OK de Raf. M3.2b (sanitarias/tubos/inseminación/pesaje ternero + frame) es el siguiente chunk.
