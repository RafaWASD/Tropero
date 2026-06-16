# Review — spec 03 MODO MANIOBRAS — chunk M2.2 (Frame de carga rapida + resumen + progreso)

**Reviewer**: reviewer (Opus) - **Fecha**: 2026-06-14 - **Baseline**: f518ea56b8dec3db34ec5e8427a6f1b95b0a858b
**Alcance**: frontend puro sobre backend done (0050-0057). Gate 1 N/A. Review previo a Gate 2 (code). Incluye el fix-loop de jerarquia de identidad del header recien aplicado.

## Veredicto

**APPROVED**

Frame de carga rapida demoable end-to-end (identify -> carga -> tacto -> pesaje -> resumen -> siguiente) con persistencia real (session_id), correccion sin duplicar, offline, dispatcher generico con seam M3 limpio, e identidad consistente con identify-found. Trazabilidad completa, check.mjs verde, specs reconciliadas al as-built. Sin findings bloqueantes.

---

## Trazabilidad R-test (completa)

| R | Que exige | Test concreto |
|---|---|---|
| R5.1 identidad+rodeo+categoria+defaults | header real siempre visible | e2e flujo completo (0385 + Cria hembras . Vaquillona + tag muted); SpikeIdentityHeader |
| R5.8 guardar a medida | persiste al confirmar cada paso | e2e (oraculos server tras tacto y pesaje); maneuver-event-query.test.ts |
| R5.9 resumen corregible, UPDATE no duplica | tocar maniobra vuelve al paso; correccion UPDATEA mismo id | unit maneuver-event-query.test.ts (CORRECCION->UPDATE mismo id; 300->350) + maneuver-sequence.test.ts (summaryRows) + e2e resumen corregible (waitForServerWeightEventWithSession(350); 300 kg count 0) |
| R5.10 avance + contador | confirmar -> animal_count++ -> siguiente | e2e flujo completo (Animal 2); carga.tsx::onConfirmAnimal (setSessionCounts) |
| R5.11 session_id en cada evento | INSERT/UPDATE con session_id | unit maneuver-event-query.test.ts + local-reads.test.ts (builders) + e2e oraculos *WithSession (session_id NOT NULL server-side) |
| R5.12 created_by por trigger | INSERT local sin created_by/establishment_id | unit local-reads.test.ts (doesNotMatch created_by/establishment_id) + trigger 0043 |
| R5.14 orden de config.maniobras | orden, omite no-aplican, contador filtrado | unit maneuver-sequence.test.ts (respeta ORDEN; OMITE sin reordenar; position/total) + e2e (Tacto 1 de 2 -> Pesaje 2 de 2) |
| R6.2 tacto 2 pasos, un evento, mapeo | binario + tamano condicional, CABEZA->large | unit maneuver-event-query.test.ts + maneuver-sequence.test.ts (small=Cola/medium=Cuerpo/large=Cabeza) + e2e (PRENADA->CABEZA->tacto large); TactoStep.tsx |
| R6.9 pesaje manual | keypad es-AR -> weight_events | unit maneuver-event-query.test.ts (INSERT/UPDATE) + e2e (412->Confirmar->weight 412); PesajeStep.tsx |
| R10.1 offline | secuencia + escrituras sin red -> drenado | e2e offline (setOffline true -> reconexion -> eventos con session_id) |
| R12.1 1-3 taps | una decision por pantalla | e2e flujo completo; estructura de los pasos |
| R12.4 identidad siempre visible, jerarquia | caravana visual dominante, tag muted | e2e (0385 dominante + eidReadable muted + rodeo.categoria) + SpikeIdentityHeader + capturas |
| dispatcher / seam M3 | tacto/pesaje cableados, resto placeholder | unit maneuver-step-kind.test.ts (toda maniobra -> StepKind conocido; no cableadas -> placeholder; stepPersists) |

Cada R reclamado por M2.2 tiene >=1 test concreto. No falta cobertura.

> Nota: buildUpdateManeuverWeight/buildUpdateManeuverTacto no tienen test directo en local-reads.test.ts, pero su SQL/args exactos se aseveran via buildManeuverEventQuery(isCorrection:true) en maneuver-event-query.test.ts + el e2e de correccion server-side. Cobertura suficiente, no es un gap.

## Tasks completas

**Si** (para el chunk M2.2). M2.2 esta [x] con as-built detallado. Las tasks [ ] restantes estan justificadas y documentadas como chunks/condiciones futuras, fuera del alcance de M2.2:
- T2.12 [ ] -> verificacion cross-spec del find-or-create; se re-checa en Gate 2 de M2.1-core. Justificada.
- M2.1-edge [ ] -> desambiguacion manual + heuristica de rodeo; diferido con justificacion explicita.
- M3.0-BACKEND / M3.1 / M3.2 [ ] -> 10 maniobras + antiparasitario/antibiotico; chunk M3.
- M4.x [ ] -> offline/reanudacion/surfacing; chunk M4.
- M5.x [ ] -> custom; chunk M5.

Ninguna task de M2.2 quedo [ ] sin justificacion.

## Focos criticos (escrutados)

1. Doble-encoding del config jsonb - parseManeuverConfig tolera 3 formas: objeto materializado, string JSON simple (INSERT local), string DOBLEMENTE serializado (fila sincronizada: 2do JSON.parse si el 1ro da string). sessions.ts serializa UNA vez (JSON.stringify); maneuver-presets.ts igual. NO re-encodean. Round-trip consistente con M1. Datos viejos: cliente no esta en prod, y el parser absorbe cualquiera de las 3 formas. Cerrado.
2. session_id (R5.11) + created_by server-side (R5.12) - tacto->reproductive_events, pesaje->weight_events, CRUD-plano offline reusando builders de spec 02 (sessionId opcional default null para la ficha). created_by/establishment_id NO se mandan (trigger 0043/0077). Camino de spec 02 reusado, no uno nuevo. Oraculos exigen session_id NOT NULL. Cerrado.
3. Correccion (R5.9) - split INSERT (1ra) / UPDATE explicito (mismo id estable), NO upsert ON CONFLICT (PowerSync no lo captura). El UPDATE no toca session_id/animal/created_at. eventId crypto.randomUUID (no literal que rompia con 22P02). El frame distingue 1ra vs correccion por presencia previa en CaptureMap (excluye skipped). Cerrado.
4. Dispatcher + seam M3 - stepKindFor -> switch(kind); tacto/pesaje cableados, resto -> placeholder (se saltea sin persistir, no rompe secuencia). M3 agrega case + rama orquestador + mapeo sin tocar el frame. stepPersists evita dato inventado. Seam limpio. Cerrado.
5. Offline (R10.1) - toda la secuencia + escrituras CRUD-plano local; rechazo real lo maneja uploadData. e2e offline verifica server-side tras reconexion. Cerrado.
6. Identidad (R12.4 + fix-loop) - displayIdentity: visual_id_alt -> idv -> tag formateado -> guion (caravana visual dominante); mutedTag: tag muted, null si ya es dominante. Espeja identify-found.png. SpikeIdentityHeader prop opcional tagElectronic (backward-compat paso.tsx). Cerrado.
7. Manga/visual - bloques de decision full-width flex:1 (PRENADA/VACIA, CABEZA/CUERPO/COLA, keypad) reparten el alto (R12.5). lineHeight matching en headings. es-AR (coma decimal keypad, punto miles resumen). Sin hardcode (anti-hardcode verde). Cerrado.

## Exactitud de specs (codigo -> spec, punto 6)

design.md describe el as-built fielmente, incluido el fix-loop reciente:
- 1.1: carga.tsx=frame; resumen.tsx NO se creo (verificado: no existe en el arbol) -> resumen es MODO + AnimalSummary.
- 6.bis.1 (notas AS-BUILT M2.2): FRAME sin resumen.tsx / round-trip + fix doble-encoding / session_id + INSERT vs UPDATE / eventId UUID / jerarquia de identidad del header -> refleja el fix-loop.
- 6.bis.2: mapeo tamano reconciliado CABEZA->large/CUERPO->medium/COLA->small, consistente con event-timeline.ts PREGNANCY_LABELS (fuente Facundo), maneuver-sequence.ts y TactoStep. Documenta la correccion del mapeo invertido previo.
- requirements.md: los EARS no se reescribieron (correcto; mapeo y jerarquia son notas de implementacion). Notas AS-BUILT en R4.1/R6.2.

El design no quedo mintiendo. No hay reconciliacion pendiente.

## check.mjs

**RC=0 (verde)** en run limpio: All tests passed / Entorno listo.
- client unit: 1174 pass / 0 fail (incl. los 4 nuevos de M2.2 + maneuver-config/local-reads ampliados) + typecheck OK + anti-hardcode 0 violaciones.
- backend: RLS, Edge, animal 109/109, Maneuvers (spec 03) 13/13, operaciones-rodeo 22/22 - verdes.

**Rojo del 1er run = FLAKE de rate-limit AJENO, NO regresion.** El 1er run cayo en supabase/tests/animal/run.cjs con Cannot read properties of undefined (reading id/rpc) en seedNoTagAnimal -> firma del flake de auth de Supabase (createUser undefined por rate-limit con 2 terminales; memoria check rojo = rate-limit). El 2do run lo autorresolvio (animal 109/109). El posible rojo de spec 12 (import_rodeo_bulk) NO se reprodujo. No es de M2.2, no se toco.

## CHECKPOINTS

Aplicables al chunk (frontend puro, no toca schema/RLS):
- C2 (estado coherente): [x] una feature in_progress (03); current describe la sesion.
- C3 (codigo respeta arquitectura): [x] solo capas previstas; los _components/ de paso NO importan services ni tocan Supabase (regla de capas); sin deps nuevas; sin logs/TODOs; sin hardcode de establishment_id.
- C4 (verificacion real): [x] test por modulo con logica; e2e con fixtures reales + oraculos server-side; runner >0, verdes.
- C8 (offline-first): [x] carga de campo sin red (e2e offline); CRUD-plano sobre tabla sincronizada (bucket de spec 02/15); LWW por PK.

No aplican a M2.2: C1 (harness), C5 (cierre de sesion, lo evalua el leader), C6 (SDD: spec aprobada; tasks M2.2 [x]), C7 (multi-tenant: no crea tablas; gating/tenant-check/created_by server-side de 0050-0057 ya gateados). N/A documentado.

## Checklist RAFAQ-especifico

- A. Multi-tenancy/RLS - N/A a M2.2 (frontend puro, no crea tablas). tenant-check del session_id (0056), gating capa 2 (0054), created_by (0043) son server-side ya aplicados y gateados (Puerta 2 s18). El cliente nunca hardcodea establishment_id (lo deriva el trigger del perfil).
- B. Offline-first - APLICA:
  - [x] Funciona offline (e2e offline).
  - [x] Bucket correcto (CRUD-plano sobre tablas sincronizadas de spec 02, scope establishment por la stream).
  - [x] Conflictos: LWW explicito (correccion por mismo id -> LWW por PK; documentado).
  - [x] Sin requests sincronos a Supabase desde la pantalla (lee local, escribe CRUD-plano local).
- C. BLE - N/A a M2.2 (la identificacion/BLE es M2.1-core; M2.2 recibe el animal por params de ruta).
- D. UI de campo - APLICA:
  - [x] Targets: bloques de decision flex:1 (mucho mayores a 60px); CTAs full-width minHeight=touchMin (56). Ver OBS-1.
  - [x] Fuente legible: headings 9/10/11; peso hero 11=64px; labels 10.
  - [x] Una decision por pantalla (binario / tamano / keypad / resumen).
  - [x] Loading visible (Abriendo el animal + spinner; errores accionables, no spinner colgado).
- E. Edge Functions - N/A (no toca Edge Functions).

## Observaciones (no bloqueantes)

- OBS-1 (LOW, tension spec-token canonico, preexistente): R5.2/R12.2 declaran tap minimo >=60px (piso). Los CTAs full-width usan minHeight=touchMin = 56px (tamagui.config.ts:110), 4px bajo el piso. Atenuantes: (1) full-width -> trivialmente tappables por ancho; (2) los bloques de decision dominantes (PRENADA/VACIA, tamano, keypad) usan flex:1 y exceden 60px, cumpliendo R12.5; (3) touchMin=56 es el target canonico del DS, usado en toda la app ya aprobada por Gate 2 + puertas humanas, no introducido por M2.2. Es tension EARS(>=60) vs token canonico(56), no defecto de este chunk. Si Raf quiere el piso literal de 60, es afinado del token global (afecta toda la app) -> backlog/decision de DS, no bloquea.
- OBS-2 (INFO): PesajeStep::pressKey cap-ea 5 digitos enteros pero no la longitud decimal tras la coma. No es riesgo (peso validado >0, kg con a lo sumo un decimal); cosmetico.

## Conclusion

**APPROVED -> sigue Gate 2 (security code).** El chunk M2.2 esta completo, trazable, verde y reconciliado. El frame es un seam limpio para M3. No se marca done en feature_list.json (la feature sigue in_progress; quedan M2.1-edge / M3 / M4 / M5).
