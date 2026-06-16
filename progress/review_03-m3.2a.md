# Review - spec 03 (MODO MANIOBRAS) - chunk M3.2a
## Veredicto: APPROVED

> Reviewer (Opus 4.8). Frontend puro sobre M3.1 (orquestador lockeado) + backend done (0091 escrita). Gate 1 N/A. Review previo a Gate 2.
> Las 3 pantallas de paso de elegir: tacto vaquillona (R6.3/R5.13), condicion corporal (R6.6), dientes + prompt CUT (R6.7/R6.8).

Las 3 pantallas honran R6.3/R5.13/R6.6/R6.7/R6.8/R5.2/R12.5; escriben EXCLUSIVAMENTE por el orquestador M3.1 (no reimplementan write-path); el prompt CUT deriva del unico CUT_PROMPT_TEETH y excluye terneros; el stepper es puro/testeado sin drift; dientes es UPDATE de propiedad SIN session_id; cero hardcode; tests REALES con oraculos server-side. check.mjs RC=0 (verde). Specs (design 6.bis.3, tasks M3.2a) reconciliadas; requirements sin contradiccion.

## Trazabilidad R <-> test (completa para M3.2a)

- R6.3 / R5.13 (tacto vaquillona apta/no_apta/diferida -> reproductive_events tacto_vaquillona + heifer_fitness 0053): e2e maniobra-elegir.spec.ts: APTA -> oraculo waitForServerVaquillonaWithSession(profileId, apta) server-side, session_id NO nulo. 3 bloques visibles. OK
- R6.6 (condicion corporal 1,00-5,00 step 0,25 default 3,00 -> condition_score_events): unit condition-stepper.test.ts (clamp/snap/mas-menos/limites/no-finito/format es-AR, 18 casos, incl. snap EXACTO sin drift incrementScore(3)===3.25). e2e: 3,00 -> mas -> 3,25 -> waitForServerConditionScoreWithSession(profileId, 3.25). OK
- R6.7 (dientes = PROPIEDAD animal_profiles.teeth_state, NO evento, SIN session_id): unit teeth-options.test.ts (cobertura EXACTA del enum 0020 + orden de boca + labels, 9 casos). e2e: 1/2 -> waitForServerTeethState(profileId, 1/2) UPDATE de animal_profiles. buildSetTeethStateUpdate verificado SIN session_id. OK
- R6.8 (prompt CUT 1/2,1/4,sin_dientes; NO 3/4; NO terneros; UPDATE is_cut+category_id(CUT)+override; revert consistente): unit teeth-options.test.ts (cutTrigger DERIVADO de CUT_PROMPT_TEETH; 3/4 y dientes de leche NO). e2e A: 1/2 sobre vaquillona -> sheet -> Marcar CUT -> waitForServerTeethState(expectCut:true) is_cut=true + override=true + getCategoryCodeById==cut. e2e B: sin_dientes sobre TERNERA (birth_date<1ano) -> NO sheet -> resumen sin CUT -> server is_cut=false. shouldOfferCutPrompt unit-cubierto en maneuver-applicability.test.ts. OK
- R5.2 / R12.5 (bloques gigantes que reparten el alto, densidad): 4 capturas 412x915 en design/maniobra-elegir/. Tacto vaquillona = 3 bloques flex:1. Stepper = card + botones stepperBtn=88 (mayor-igual 80). Dientes = 8 bloques flexGrow:1 flexBasis:0 (llenan viewport, floor searchBarLg=56). OK
- R5.7 (required faltante bloquea): N/A parcial declarado: las 3 son selecciones cerradas siempre completas -> no hay campo opcional faltante. El caso real cae en M3.2b. Documentado en tasks. OK (acotado)

Escritura via orquestador M3.1 (NO reimplementada): las 3 pantallas solo capturan el StepValue y lo entregan a captureAndAdvance -> persistManeuverEvent (M3.1) -> buildManeuverEventQueries ramifica por kind. tacto_vaquillona->buildAddManeuverTactoVaquillonaInsert (heifer_fitness + session_id); score->buildAddManeuverConditionScoreInsert (session_id); dientes->buildSetTeethStateUpdate (propiedad, SIN session_id) + opcional buildSetCutUpdate/buildUnsetCutUpdate. Ningun SQL nuevo en los componentes.

resolveCutCategory (camino as-built, no spoofeable): resuelve category_id de CUT por (system_id REAL del perfil, code=cut) del catalogo LOCAL (buildCategoryIdByCodeQuery) + reusa resolveRevertCategory para la derivada. Fail-safe: sin id -> cutCategoryId:null -> el orquestador OMITE el write de CUT (solo teeth_state) - no fija categoria invalida que 0021 rechazaria. Offline-safe.

## Tasks completas: SI (para M3.2a)
T1..T7 de impl_03-m3.2a.md todas [x]; en tasks.md M3.2a [x] as-built completo. M3.2b queda [ ] con justificacion documentada (chunk siguiente). Ningun [ ] sin justificacion dentro del alcance de M3.2a.

## CHECKPOINTS
- C2 [x] exactamente una feature in_progress (3/03-modo-maniobras); current.md describe la sesion activa.
- C3 [x] solo capas previstas (componentes en _components, logica pura en utils, I/O en services); sin dep externa nueva; sin debug logs/TODOs sueltos; CERO hardcode de establishment_id ni color/px (grep limpio; anti-hardcode lint verde).
- C4 [x] al menos 1 test por modulo con logica (condition-stepper 18, teeth-options 9, applicability cubierto); fixtures reales; runner 1274/1274 unit verdes; e2e con oraculos server-side service_role (no mock de I/O critico).
- C6 [x] cada R-n del alcance con al menos 1 test concreto; requirements EARS; design reconciliado.
- C8 [x] todo CRUD-plano local (UPDATE teeth_state / INSERT score/vaquillona) -> CrudEntry -> upload; resolveCutCategory 100% SELECT local. (Sin caso e2e offline DEDICADO para estas 3; reusan el MISMO persistManeuverEvent que M2.2 ya probo offline - aceptable; anotado.)
- C1/C5/C7 [ ] N/A a este chunk (harness ya existe; cierre de sesion lo hace el leader; M3.2a no crea tabla con establishment_id - el gating server-side es backend done de M3.0/0054/0091).

## Checklist RAFAQ-especifico
- A (RLS/multi-tenancy): N/A - M3.2a no crea ni altera tablas/policies. El gating capa 2 de teeth/CUT (0054) y de eventos ya es backend done; la RLS animal_profiles_update/eventos es la barrera real al subir. El cliente nunca fuerza establishment_id (lo deriva el trigger del perfil).
- B (offline-first):
  - [x] Funciona offline (CRUD-plano local; exito local inmediato; sync al reconectar).
  - [x] Scoped por establishment del perfil/sesion (no se pasa establishment_id; el trigger lo fuerza).
  - [x] Conflictos: LWW de PowerSync por PK (id de cliente estable por animal+maniobra -> correccion re-pisa, no duplica). Dientes/CUT = UPDATE idempotente sobre el perfil.
  - [x] No hace requests sincronos a Supabase desde la pantalla - delega a services/utils sobre SQLite local.
- C (BLE): N/A - M3.2a no toca BLE (el baston lo maneja M2.1; el e2e usa el bridge mock solo para llegar a la carga).
- D (UI de campo):
  - [x] Targets: tacto vaquillona = bloques flex:1; stepper stepperBtn=88 (mayor-igual 80); dientes flexGrow:1 (llenan viewport, floor 56). Nota menor abajo.
  - [x] Fuente mayor-igual 18pt en texto que el operario lee: labels 10/9, valor hero 11/64px, CTAs 6. La pista de escala (4) es info secundaria.
  - [x] Una decision por pantalla (tacto = 1 toque; score = stepper + Confirmar; dientes = 1 toque + sheet binario).
  - [x] Estado de loading visible: el frame muestra Spinner hasta tener sesion+animal+gating; las pantallas son sincronas.
  - [x] Recorte de descendentes: lineHeight matching en todo heading/Text con numberOfLines (verificado en los 3 componentes - registrar/gorda/Sin dientes con g/j/p).
- E (Edge Functions): N/A - sin Edge Function nueva (frontend puro).

## check.mjs - RC reportado
RC=0 (VERDE). Run consolidado limpio: typecheck cliente + anti-hardcode (0 violaciones) + client unit 1274/1274 (incl. condition-stepper 18 + teeth-options 9 + maneuver-applicability) + suites backend (maneuvers 14/14, edge 42/42, import 25/25, operaciones-rodeo 22/22, RLS/animal/etc.) todas verdes.

Distincion flake vs regresion (memoria check rojo = rate-limit): un primer run mostro 12 fallos en supabase/tests/import/run.cjs (import_rodeo_bulk signature mismatch + cascada undefined.rpc) y 3 en maneuvers (T2.8/T2.9). TODOS desaparecieron en re-runs aislados (import 25/25, maneuvers 14/14, edge 42/42). Patron confirmado de flake de auth de Supabase por terminales concurrentes (trabajo paralelo de spec 08 en el working tree), NO regresion de M3.2a. El suite import ni siquiera esta en los archivos tocados por M3.2a (es spec 08). El run final de check.mjs cerro RC=0.

## Exactitud de specs (codigo -> spec)
- design.md 6.bis.3 describe el as-built EXACTO (3 componentes, tokens amber/amberPress/stepperBtn, resolveCutCategory, gate del prompt CUT, nuance ternera/birth_date del espejo C6). Sin contradiccion con el codigo.
- requirements.md R6.3/R6.6/R6.7/R6.8/R5.13 sin cambios - la implementacion los honra tal cual (umbral CUT 1/2,1/4,sin_dientes ya estaba en R6.8). NO quedaron viejas.
- tasks.md M3.2a [x] as-built; M3.2b [ ] justificado. Reconciliacion correcta.

## Cambios requeridos
Ninguno bloqueante.

### Notas menores (no bloquean - para M3.2b o canonizacion)
1. Floor de target de los bloques de dientes = searchBarLg=56 (DientesStep.tsx:74), por debajo del 60 nominal del FOCO. En la practica los bloques son ~100px (flexGrow llena el viewport); el 56 solo aplica como piso de scroll. Si Raf/Facundo quieren el piso exacto mayor-igual 60, subir el minHeight a un token mayor-igual 60. No viola R5.2 (60 es piso, no objetivo; el objetivo fraccion grande del alto SI se cumple).
2. Tokens amber/amberPress/stepperBtn JIT provisionales (tamagui.config.ts:52-53,104-105,240) - a canonizar cuando Raf apruebe la direccion visual (mismo patron que heroScan/StickIcon de M2.1). Declarados en config, no hardcodeados en pantalla. Solo pendiente de canonizacion formal.
3. Sin caso e2e offline DEDICADO para estas 3 maniobras (reusan el persistManeuverEvent que M2.2 ya probo offline con session_id). Aceptable; si se quiere blindar, agregar un escenario offline en M3.2b/M4.2.

-- Reviewer no marca done. Espera Gate 2 (security code) + veto visual del leader + OK de Raf.
