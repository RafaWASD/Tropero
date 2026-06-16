# Review -- spec 03 (MODO MANIOBRAS) -- chunk M3.1

> Orquestador de escritura generalizado + aplicabilidad per-animal para las 12 maniobras. Frontend puro sobre backend done (0091 aplicada). Gate 1 N/A. Review previo a Gate 2. NO incluye pantallas (M3.2).

## Veredicto: CHANGES_REQUESTED

El CODIGO esta correcto, completo y bien testeado (suites propias verdes, traza completa). Se rechaza por una RECONCILIACION DE SPEC PENDIENTE (regla dura: requirements.md no puede contradecir el as-built tras un fix). Cambio chico de documentacion -- el implementer reconcilia y vuelve.

## Trazabilidad R <-> test (completa)

- R5.4 (mapeo 12) -> maneuver-gating.test cubre las 12 maniobras (l.32). OK
- R5.5 (omitir no-aplica) -> maneuver-gating.test applies all/any + maneuver-sequence buildSequence. OK
- R5.6 (required vs opcional) -> maneuver-gating.test required de enabled + resolveManeuverGating. OK
- R5.8/R5.11 (persiste con session_id) -> maneuver-event-query.test toda 1ra captura lleva session_id (l.269) + cada rama; local-reads.test cada builder. OK
- R5.9 (correccion no duplica) -> maneuver-event-query.test UPDATE mismo id + local-reads.test node:sqlite correccion de score = 1 sola fila (l.1702). OK
- R5.12 (created_by server-side) -> builders NO incluyen created_by/establishment_id (grep verificado). OK
- R6.1 (vacunacion multi) -> maneuver-event-query.test 2 vacunas 2 INSERT (l.144) + filtra vacios (l.157). OK
- R6.2 (tacto) -> maneuver-event-query.test tacto vacia/prenada/correccion. OK (ver H1)
- R6.3/R5.13 (tacto vaquillona + heifer_fitness) -> maneuver-event-query.test + local-reads.test (l.1636). OK
- R6.4 (sangrado blood) -> maneuver-event-query.test sangrado blood (l.187) + local-reads.test. OK
- R6.5 (inseminacion service ai) -> maneuver-event-query.test service ai, pajuela en notes (l.167). OK
- R6.6 (condicion corporal) -> maneuver-event-query.test score + local-reads.test condition_score. OK
- R6.7 (dientes propiedad, NO evento) -> maneuver-event-query.test dientes 1 UPDATE animal_profiles SIN session_id NO INSERT (l.220). OK
- R6.8 (prompt CUT + revert + no terneros) -> maneuver-event-query.test CUT/revert (l.232/251) + maneuver-applicability.test shouldOfferCutPrompt (l.63-83). OK
- R6.9/R6.10 (pesaje) -> maneuver-event-query.test pesaje + session_id batch. OK
- R6.11 (raspado 2 samples) -> maneuver-event-query.test raspado 2 INSERT scrape_* (l.202). OK
- R6.12 (raspado solo machos) -> maneuver-applicability.test appliesToAnimal/filterByAnimalApplicability macho/hembra/sexo-null (l.23-59). OK
- R6.13/R6.14 (antiparasitario deworming, OR, SIN route) -> maneuver-event-query.test SIN route D10 (l.101) + node:sqlite route===null (l.304) + maneuver-gating.test OR 4 combos + contraste AND/OR (l.169-194). OK
- R6.15 (antibiotico treatment) -> maneuver-event-query.test (l.113) + maneuver-gating.test single-key (l.200). OK
- StepKind dispatcher (M3.2) -> maneuver-step-kind.test mapeo 12 + exhaustivo. OK
- describeStepValue es-AR (R5.9) -> maneuver-sequence.test todas las ramas. OK

Backend (0091): maneuvers suite T2.4c gating deworming/treatment VERDE (4 combos OR + treatment accept/reject + fail-closed + no-bypass). T2.5 binding (antiparasitario_interno/externo/antibiotico existen en field_definitions) VERDE. T2.11 dientes/CUT VERDE. 0091 aplicada, la OR server-side espeja la capa 1.

## Tasks completas: SI
M3.1 marcada [x] (tasks.md l.247) con bloque AS-BUILT reconciliado. M3.2 es el chunk siguiente, fuera de scope ([ ] justificado). Ningun [ ] sin justificacion dentro de M3.1.

## CHECKPOINTS
- C2 (estado coherente): [x] una sola feature in_progress (03); current.md describe la sesion.
- C3 (arquitectura): [x] solo utils/services; sin deps nuevas; sin logs de debug; sin establishment_id hardcodeado (grep verificado, solo en comentarios que confirman que lo fuerza el trigger).
- C4 (verificacion real): [x] >=1 test por modulo con logica; fixtures reales; node:sqlite EJECUTA el SQL real (no string-match) en los 2 tests load-bearing (deworming route NULL; correccion = 1 fila); 233 unit verdes.
- C6 (SDD): [x] 3 archivos presentes; cada R<n> de M3.1 con >=1 test concreto.
- C7/C8 (multi-tenant/offline): [x] CRUD-plano sobre tablas sincronizadas; session_id del caller; establishment_id/created_by los fuerza el trigger; LWW por PK; gating capa 2 re-valida al subir.
- C1/C5: N/A a este chunk (no se cierra sesion ni se toca el harness base).

## Checklist RAFAQ-especifico
- A (RLS/multi-tenancy): N/A -- frontend puro; no crea tablas. La capa 2 de 0091 ya esta done y verde en T2.4c.
- B (offline-first): [x] CRUD-plano local CrudEntry uploadData (offline); [x] tablas de evento en sync bucket scoped por establishment; [x] conflictos append-only + LWW (ADR-017, design 5); [x] NO requests sincronos a Supabase desde pantalla (persistManeuverEvent corre runLocalWrite sobre SQLite local).
- C (BLE): N/A -- M3.1 no toca BLE (balanza diferida post-MVP, R6.9).
- D (UI de campo): N/A -- logica pura + builders; las pantallas (botones >=60dp, fuentes, loading) son M3.2. Sin JSX/headings, sin riesgo de recorte de descendentes en este chunk.
- E (Edge Functions): N/A -- no toca Edge Functions.

## check.mjs
RC del runner: rojo (exit 1), pero por FLAKE conocido, NO por M3.1. Los 2 unicos tests rojos estan en la suite Edge de SPEC 13 (R10.1 remove_member / R10.2 change_member_role invalidan sesion) con error explicito 'signIn(...): Request rate limit reached' en signInWithPassword (supabase/tests/edge/run.cjs:90). Es el flake documentado de rate-limit de auth de Supabase por terminales paralelas (memoria reference_check_red_rate_limit), NO una regresion de maniobras.

Evidencia de que M3.1 esta verde:
- Unit de M3.1 en aislamiento: 233/233 PASS, 0 fail (gating/step-kind/sequence/event-query/applicability/local-reads/wizard).
- Backend maneuvers suite en aislamiento: 14/14 PASS, incluido T2.4c deworming/treatment (0091 aplicada).

## Hallazgos

### H1 -- RECONCILIACION PENDIENTE (severidad media; bloqueante por regla dura) -- specs viejas vs as-built
requirements.md quedo con el mapeo de tamano de prenez INVERTIDO respecto del codigo as-built y de design.md. El fix ya se hizo en design.md (6.bis.2 l.729: 'La version previa tenia el mapeo invertido, corregido al as-built de Facundo') y el codigo lo implementa correcto, pero requirements.md no se reconcilio.

- as-built (CORRECTO, no tocar): maneuver-sequence.ts l.143-147 small=Cola, medium=Cuerpo, large=Cabeza; espeja event-timeline.ts l.776-778 (dominio Facundo 4, fuente de verdad de terminos de campo) y design.md 6.bis.2 l.721-729.
- requirements.md (STALE, contradice):
  - requirements.md:173 (R6.2) -- '(empty/small/medium/large = vacia/cabeza/cuerpo/cola)' mapea small=cabeza, large=cola (invertido para small<->large).
  - requirements.md:501 (Refinamiento #2) -- 'empty=vacia, small=cabeza, medium=cuerpo, large=cola' (misma inversion).

Fix requerido (el implementer reconcilia, NO toca codigo): corregir ambas lineas de requirements.md al as-built -> small=cola, medium=cuerpo, large=cabeza, alineadas con design.md 6.bis.2 y event-timeline.ts. Es direccion codigo->spec (paso 6 del protocolo): el design no quedo mintiendo, pero requirements si. El paso 9 (reconciliacion) del implementer cubrio tasks.md y design.md 3 pero omitio este punto de requirements.md.

Nota: describeStepValue de M3.1 y TactoStep de M2.2 ya usan el mapeo correcto; el dato PERSISTIDO es correcto. El riesgo es de DOCUMENTACION (un lector cargaria el enum al reves), no de runtime; por eso media, no alta. La regla dura obliga a reconciliar antes de cerrar.

## Que quedo solido (no requiere cambios)
- OR del antiparasitario (match:any + .some), contrastada contra AND en test dedicado; espeja 0091.
- deworming/treatment SIN route (D10): verificado en builder, en event-query y en ejecucion node:sqlite (route===null).
- Aplicabilidad per-animal pura: raspado solo machos (sexo null -> skip fail-safe), CUT no para terneros, umbral {1/2,1/4,sin_dientes}, accept Y reject testeados.
- Multi-write: raspado = 2 INSERT ids distintos; dientes+CUT = 2 UPDATE; correccion = UPDATE mismo id (no duplica, probado en sqlite).
- dientes = propiedad: UPDATE teeth_state SIN session_id (correcto, no es evento time-series); fail-safe sin cutCategoryId.
- Reuso de spec 02: builders dedicados con session_id (no rompen call-sites de events.ts/spec 10 sin session_id); is_cut=1/category_override=1/0 espejan el encoding SQLite de is_castrated.
- buildActiveProfileRodeoQuery filtra deleted_at IS NULL (fail-safe R5.3/SEC-SPEC-03-02).
- carga.tsx (M2.2): case placeholder retirado; las maniobras de StepKind real sin pantalla caen al default (PlaceholderStep, skip sin persistir) hasta M3.2, coherente con el scope.
