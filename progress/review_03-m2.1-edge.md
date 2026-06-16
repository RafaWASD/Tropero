# review -- spec 03 M2.1-edge: edge cases del identify (R4.2 / R4.4 / R4.7) + fix-loop R4.4

Reviewer: reviewer (Opus). Fecha: 2026-06-14. Baseline impl: f518ea56b8 (+ fix-loop 2026-06-14).
Tipo: frontend puro sobre backend done (M2.1-core lockeado). Gate 1 N/A. Review previo a Gate 2.

## VEREDICTO: APPROVED

El chunk honra el EARS R4.4 (el fix-loop revierte la desviacion de cambiar la jornada), R4.2 y R4.7
cumplen, las specs quedaron reconciliadas al as-built (no hay spec mintiendo), tests reales verdes,
check.mjs en verde una vez descontado el flake de rate-limit ajeno (backend). Sin cambios bloqueantes.
2 findings LOW cosmeticos.

## Trazabilidad R <-> test (completa)

- R4.2 (manual >1 candidato -> desambiguar, sin duplicar): unit maniobra-edge.test.ts (candidateDominantId
  visual>idv; candidateDistinguisher con N idv DESEMPATE cuando el visual esta duplicado; sin idv suelto si
  ya es dominante) + maniobra-identify.test.ts (outcome ambiguous con candidates enriquecidos +
  candidateProfileIds compat; shouldAutoAdvance NO auto-avanza en ambiguous) + e2e (f)
  maniobra-identify.spec.ts:282 (2 candidatos visual 0385 -> picker visible, NO auto-elige -> N 5001 /
  N 5002 desempatan -> elegir 5002 -> carga).

- R4.4 (otro rodeo mismo campo+sistema -> PASAR EL ANIMAL / saltar): unit maniobra-edge.test.ts (isOtherRodeo
  true; canChangeSessionRodeo true mismo-sistema / false otro-sistema) + maneuver-reads.test.ts:194-208
  (buildMoveAnimalToRodeoUpdate mueve el perfil ACTIVO; NO toca soft-deleted) + e2e (g)
  maniobra-identify.spec.ts:326 (animal en rodeo B, jornada en A -> other-rodeo-sheet -> weight-display
  count=0 NO carga directo -> Pasar el animal a este rodeo -> carga + ORACULO server-side
  waitForServerProfileRodeo confirma el UPDATE de animal_profiles.rodeo_id).

- R4.7 (heuristica rodeo mal elegido -> aviso no-bloqueante): unit maniobra-edge.test.ts (3 consecutivos
  disparan; rodeo correcto rompe la racha; tercer rodeo distinto reinicia; dismiss silencia; racha nueva
  reabre; umbral configurable threshold=2) + e2e (h) maniobra-identify.spec.ts:372 (3 animales rodeo B ->
  saltar c/u -> al 3ro rodeo-mismatch-banner; hero detras = no-bloqueante; nombre largo -> confirmar por
  aria-label -> el banner se cierra).

Cada R<n> del alcance tiene >=1 test concreto. OK.

## Foco critico (escrutado, no pasamanos)

1. R4.4 HONRA el EARS - VERIFICADO. moveAnimalToRodeo (animals.ts:1304) -> buildMoveAnimalToRodeoUpdate
   (local-reads.ts:1620) = UPDATE animal_profiles SET rodeo_id WHERE id AND deleted_at IS NULL (mismo idiom
   que buildAssignAnimalToGroupUpdate, parametrizado), mueve al rodeo de la SESION (sessionRodeoId,
   identificar.tsx:332). NO cambia la jornada. Muestra el rodeo de ORIGEN (animalRodeoName). NO carga
   eventos hasta mover: el efecto de resolucion de rodeo hace return (identificar.tsx:262) sin
   setReadyToAdvance cuando hay mismatch, y el OtherRodeoSheet intercepta el auto-avance (e2e g:
   weight-display count=0). Validacion 100% server-side (trigger 0047 same-system + 0021 + RLS); el cliente
   NO replica validacion. El e2e (g) lo verifica por ORACULO server-side, no solo UI.
2. setSessionRodeo SOLO en R4.7 - VERIFICADO. Unico call-site: onConfirmStreakRodeo (identificar.tsx:347).
   R4.4 ya no lo usa (usa moveAnimalToRodeo). Separacion limpia.
3. R4.2 desambiguacion SEGURA - VERIFICADO. CandidatePicker NO auto-elige (el operario toca una fila ->
   onPick); el N interno (idv) desempata cuando el visual esta duplicado; Ninguno . dar de alta como salida
   find-or-create; multi-candidato no rompe (e2e f).
4. R4.7 heuristica - VERIFICADO. Tracker PURO pushSeenRodeo/shouldWarnMisconfiguredRodeo (umbral
   MISCONFIGURED_RODEO_THRESHOLD=3 configurable); aviso NO-bloqueante (banner anclado, no sheet modal; no se
   apila bajo R4.2/R4.4: guard otherRodeo null && outcome no ambiguous, identificar.tsx:376); al confirmar
   reusa setSessionRodeo.
5. Offline - VERIFICADO. Lookup local (lookupByTag/searchAnimals/fetchAnimalDetail); move-animal y
   change-session por CRUD-plano local (runLocalWrite -> 1 CrudEntry -> upload queue). Sin red.
6. Robustez de nombres largos - VERIFICADO. RodeoMismatchBanner: 2 botones APILADOS full-width; el boton
   Cambiar a rodeo trunca con numberOfLines=1 + ellipsizeMode=tail; a11y label con el nombre COMPLETO (e2e
   h lo ubica por aria-label). OtherRodeoSheet: el boton primario NO lleva el nombre del rodeo en el label.
7. Reconciliacion de specs (codigo -> spec) - VERIFICADO. requirements.md R4.4 (nota as-built fix-loop) ya
   NO justifica una divergencia: documenta el as-built que HONRA el EARS (mover el animal; setSessionRodeo
   solo R4.7). design.md 2.3 (As-built M2.1-edge ... HONRA el EARS) + riesgo residual acotado a R4.7<->R10.8.
   tasks.md M2.1-edge al nuevo comportamiento. No quedo spec mintiendo.

## Arquitectura / convenciones

- maniobra-edge.ts(+test) - utils PURO, sin I/O; 16 tests con fixtures inline. OK capa utils.
- CandidatePicker/OtherRodeoSheet/RodeoMismatchBanner.tsx - components de presentacion; reciben callbacks,
  no tocan services directamente (la I/O la hace identificar.tsx). OK regla de dependencias.
- identificar.tsx - screen; orquesta services. Multi-tenant: el rodeoId destino sale de rodeo.available
  (RodeoContext, solo el campo activo) - nunca un rodeo ajeno; cero hardcode de establishment/rodeo. OK
- animals.ts/sessions.ts/local-reads.ts - services + builders CRUD-plano; SQL parametrizado, deleted_at IS
  NULL (y status active para sessions). OK
- Descendentes: headings >= 6 y Text con numberOfLines llevan lineHeight matching (regla dura). OK es-AR.

## Tasks completas: si
tasks.md M2.1-edge marcada [x] con as-built completo. No quedan [ ] del chunk sin justificacion. (M3.0-BACKEND
/ M3.1 / M3.2 [ ] son chunks FUTUROS, fuera del alcance de M2.1-edge.)

## CHECKPOINTS
- C2 (estado coherente): [x] - una sola feature in_progress (03); current.md describe la sesion activa.
- C3 (arquitectura): [x] - capas previstas; sin deps nuevas; sin TODOs sueltos; sin hardcode de establishment.
- C4 (verificacion real): [x] - >=1 test por modulo; e2e con fixtures reales + oraculo server-side; verdes.
- C6 (SDD): [x] - los 3 docs presentes; requirements EARS; tasks del chunk [x]; cada R<n> con >=1 test.
- C7 (multi-tenant): [x] - destino del move/change limitado a rodeo.available; re-validado server-side
  (0047/0021/0050 + RLS). Cross-tenant lo cubre el backend done (0056); e2e (g) lo ejercita con oraculo server.
- C8 (offline-first): [x] - CRUD-plano local; LWW por default (UPDATE simple de rodeo_id); e2e offline.
- C1/C5: N/A a este chunk (harness ya completo; cierre de sesion lo maneja el leader).

## Checklist RAFAQ-especifico
- A (RLS / multi-tenancy): N/A - frontend puro, no crea ni altera tablas/policies. Authz server-side. N/A.
- B (offline-first carga/edicion en campo): APLICA, PASA.
  - [x] Funciona offline (CRUD-plano local; e2e con lecturas locales).
  - [x] Bucket scoped por establishment activo (reusa el sync set de spec 02/15; no agrega tablas).
  - [x] Conflict resolution: LWW explicito (UPDATE simple de rodeo_id / sessions.rodeo_id), en design 2.3.
  - [x] No hace requests sincronos a Supabase desde la pantalla - usa services que tocan SQLite local.
- C (BLE): N/A - el listener BLE es de M2.1-core; este chunk solo agrega edge cases de identidad/rodeo. N/A.
- D (UI de campo): APLICA, PASA.
  - [x] Targets manga: filas del picker >= searchBarLg (56); botones del sheet/banner minHeight touchMin
        (tension token-canonico vs piso EARS >=60 ya anotada al backlog; los bloques GIGANTES >=60 son M2.2/M3,
        no esta pantalla de identidad/desambiguacion).
  - [x] Fuente legible (heading 7/8 en dominantes; copy >= 4).
  - [x] Una decision por pantalla (picker = elegir uno; sheet = pasar/saltar; banner = cambiar/ahora-no).
  - [x] Estado de loading visible (manual Buscando; el found tiene flash de confirmacion).
- E (Edge Functions): N/A - no toca Edge Functions. N/A.

## Cambios requeridos
Ninguno bloqueante.

## Findings no bloqueantes (LOW)
- LOW-1 (comentario stale de test) - maneuver-reads.test.ts:166,168: los comentarios atribuyen
  buildSetSessionRodeoUpdate a R4.4 (cambiar el rodeo de la jornada). Tras el fix-loop quedo SOLO para R4.7
  (R4.4 mueve el animal via moveAnimalToRodeo). El codigo y la asercion son correctos; solo el label del test
  quedo del estado pre-fix-loop. Cosmetico. Sugerencia: renombrar a R4.7 en housekeeping.
- LOW-2 (comentario stale de doc) - maniobra-edge.ts:18: el docblock menciona evaluateMisconfiguredRodeo
  (la funcion real es shouldWarnMisconfiguredRodeo). Solo doc, no rompe nada.

## check.mjs - RC y diagnostico
- 1a corrida full: RC=1, pero el UNICO fallo fue la suite Animal (spec 02) backend con signIn Request rate
  limit reached -> cascada Cannot read properties of undefined (reading rpc). Es el flake de rate-limit de
  auth de Supabase por terminales paralelas (memoria reference_check_red_rate_limit.md), NO una regresion.
- typecheck client OK; client unit OK (incluye maniobra-edge 16 + maniobra-identify + maneuver-reads con los
  2 nuevos buildMoveAnimalToRodeoUpdate).
- Re-corrida AISLADA de la suite Animal tras cooldown de 90s: RC=0 (verde). Confirma flake, no regresion.
- spec-12 import_rodeo_bulk NO reaparecio. M2.1-edge es frontend puro y no toca la suite Animal.

Conclusion: con el flake de rate-limit descontado (re-run verde del backend) y el frontend verde, check.mjs
esta en verde efectivo. APPROVED. No marco done en feature_list.json (lo hace el leader tras Gate 2 + puerta).
