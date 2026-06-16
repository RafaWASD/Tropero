# Review — spec 03 (MODO MANIOBRAS) — sub-chunk M3.2b (+ fix-loop espacio muerto + inseminacion)

Reviewer: reviewer (Opus 4.8 1M). Fecha: 2026-06-15. Gate 2 (code), pre-Gate 2 final del leader.
Baseline: 638679fa (feature multi-sesion). Frontend puro sobre M3.1 (lockeado) + M3.2a + backend done (0091). Gate 1 N/A.

## Veredicto: APPROVED

Las 6 pantallas de paso (vacunacion silent_multi, antiparasitario/antibiotico silent_single, sangrado, raspado, inseminacion) + pesaje ternero reusado quedan renderizables y persisten por el orquestador M3.1 (NO reimplementan write-path). El fix R6.12 (aplicabilidad per-animal en el frame) esta cerrado y verificado server-side. El fix de espacio muerto (card dominante) y la inseminacion (R6.5, divergencia popup->1-toque) estan reconciliados en specs. Tests reales (server-side oracles via service_role). check.mjs verde en re-run limpio.

## Trazabilidad R <-> test (completa, R de M3.2b + fix-loop)

- R6.1 vacunacion silent multi (N->N sanitary_events): maniobra-sanitaria.spec.ts test1 macho: 2 vacunas -> waitForServerSanitaryWithSession('vaccination', minCount:2) -> productNames=[Aftosa,Mancha]. Server-side, 2 filas.
- R6.4 sangrado blood + tube_number: test1: tubo A-104 -> waitForServerLabSampleWithSession('blood',{tubeNumber:'A-104'}). Server-side, tube exacto.
- R6.5 inseminacion 1 pajuela -> 1 toque (service ai, notes, session): test4: preconfig "Toro 123" -> hero silent-product-hero -> Aplicar -> waitForServerInseminationWithSession({semenName:'Toro 123'}), notes='Toro 123'. Server-side (event_type service / service_type ai / notes).
- R6.5 inseminacion >1 pajuela -> selector: test5: "Toro 123, Toro 456" -> 2 pajuela-block-* + pajuela-other, NO hero -> elige "Toro 456" -> server notes='Toro 456' (prueba que el selector eligio la CORRECTA). Server-side.
- R6.10 pesaje ternero + categoria: test3 ternera: header "· Ternera" + 95 kg -> waitForServerWeightEventWithSession(95) con session. Server-side + header autocompletado.
- R6.11 raspado 2 lab_samples scrape_*: test1: TR-1/CA-2 -> waitForServerLabSampleWithSession('scrape_tricho'/'scrape_campylo'). Server-side, 2 muestras + tubos.
- R6.12 raspado solo machos (hembra salta): test2 hembra {raspado, antiparasitario} -> "· 1 de 1" (raspado fuera de secuencia) + tube-tricho count 0 + countScrapeSamples=0 server. Doble prueba (UI + server).
- R6.13/R6.14 antiparasitario deworming SIN route: test1: waitForServerSanitaryWithSession('deworming',{productName:'Ivermectina'}); write SIN columna route (buildAddManeuverSanitaryInsert, local-reads l.1315-1330). Server-side + write-path.
- R6.15 antibiotico treatment: test1: waitForServerSanitaryWithSession('treatment',{productName:'Oxitetraciclina'}). Server-side.
- R5.7 required faltante bloquea: LabSampleStep/LabDoubleStep canConfirm (CTA deshabilitado con tubo vacio); SilentVaccinationStep canApply 0 vacunas. Logica visible + e2e camino feliz.
- R5.9 correccion no duplica: test1: corrige antiparasitario desde resumen -> hero "Ivermectina" -> re-confirma (UPDATE in-place, no 2do INSERT); soft-delete de huerfanos de vacunacion multi (softDeleteManeuverEvents). Server-side (sigue 1 fila deworming).
- R5.14 orden de secuencia: test1: "· 1..5 de 5" en orden de seleccion. e2e.
- R1.7/R1.8 preconfig + autocompletar: maneuver-config.test.ts: preconfigStringFor + preconfigHistory + pajuelasFor (25+ casos). Unit puro.
- R5.2/R12.1/R12.5 botones gigantes / cero espacio muerto: 5 capturas 412x915 (design/maniobra-sanitaria/): card dominante flex:1 ocupa el alto, CTA disjunto abajo. Captura medida + veto leader.

Backend de R7.7 (deworming/treatment gating fail-closed): supabase/tests/maneuvers/run.cjs T2.4c paso verde (OR antiparasitario_interno/externo, treatment->antibiotico, no-bypass, fail-closed soft-deleted). Es M3.0-BACKEND (0091), barrera server de estas pantallas, verde.

## Tasks completas: si

M3.2b [x] + FIX-LOOP M3.2b [x] (as-built). M3.2c ([ ] preview R8.4 / lote R9.x / label timeline) DIFERIDO a M4 - justificado y documentado en tasks.md l.303-307 y design 6.bis.4/.5. La inseminacion R6.5 salio de M3.2c (se hizo en el fix-loop) - reconciliado. Sin tasks [ ] sin justificacion dentro del alcance del chunk.

## CHECKPOINTS

- C1 [x] harness completo
- C2 [x] estado coherente (1 feature in_progress; no se marca done)
- C3 [x] arquitectura (componentes en app/app/maniobra/_components, logica pura en src/utils, I/O en src/services; sin fetch en JSX; sin establishment_id hardcodeado - anti-hardcode 0 violaciones)
- C4 [x] verificacion real (e2e server-side service_role + unit node:test; >0 tests verdes)
- C5 [x] sesion (no se cierra aca; pendiente Gate 2 final)
- C6 [x] SDD (3 docs, EARS, cada R con >=1 test)
- C7 [x] multi-tenant (N/A schema nuevo; el write fuerza created_by/establishment_id server-side, session_id del caller)
- C8 [x] offline-first (CRUD-plano runLocalWrite; sin requests sincronos a Supabase desde la pantalla)

## Checklist RAFAQ-especifico

- A (RLS/multi-tenancy): N/A - M3.2b NO crea ni altera tablas. El write reusa M3.1 (gating capa 2 0054+0091 + tenant-check 0056 re-validan server-side; created_by/establishment_id forzados por trigger; session_id del caller, no hardcodeado). Sin SQL inline (builders parametrizados con ?).
- B (offline-first): [x] funciona offline (CRUD-plano persistManeuverEvent/softDeleteManeuverEvents -> CrudEntry -> uploadData) / [x] scoped por session_id / [x] conflict LWW por PK (ids de cliente estables eventIdFor/extraIdsFor) / [x] NO hace requests sincronos a Supabase desde la pantalla.
- C (BLE): N/A - M3.2b no toca BLE.
- D (UI de campo): [x] CTA full-width $touchMin >=60dp / [x] hero/labels >=$5/$6 (>=18pt) / [x] una decision por pantalla / [x] required->CTA bloqueado da feedback; el frame tiene spinner. Recorte de descendentes: lineHeight matching en todo heading/Text con numberOfLines.
- E (Edge Functions): N/A - sin Edge Functions nuevas.

## Exactitud de specs (codigo -> spec)

- R6.5 divergencia popup->1-toque: reconciliada con nota bajo R6.5 (requirements.md l.181) + design 6.bis.5. La nota NO contradice el as-built. OK.
- D10 (antiparasitario SIN route): el codigo (buildAddManeuverSanitaryInsert, SIN columna route) honra R6.14 + design 6.bis.4. OK.
- tube_number=texto: design 6.bis.4 lo documenta como decision as-built; no contradice R6.4/R6.11. OK.
- Fix R6.12 en el frame: design 6.bis.4 describe el codigo real (sequence = orden ^ gating rodeo ^ filterByAnimalApplicability). OK.
- Reconciliacion COMPLETA - no hay contradiccion codigo<->spec.

## check.mjs

- 1ra corrida RC=1: 2 fails en maneuvers/run.cjs (T2.2 RLS sessions + cascada) con "Request rate limit reached" en getUserClient. Flake pre-existente documentado (memoria reference_check_red_rate_limit: rate-limit de auth de Supabase por 2 terminales, NO regresion). El test de M3.2b/M3.0-BACKEND T2.4c gating deworming/treatment PASO en esa misma corrida.
- Re-corrida limpia RC=0: "All tests passed" / "Entorno listo". Confirma flake no-determinista, no regresion.
- El flake maniobra-carga test5 (remount keypad de M2.2) es pre-existente de M2.2, fuera de scope.

## Notas (no bloqueantes)

- X size={18} / Plus size={24} en SilentVaccinationStep son literales numericos, PERO espejan exactamente el patron pre-existente de ManeuverConfigSheet.tsx (l.203/l.253, misma familia) y el lint anti-hardcode reporta 0 violaciones. No es finding.
- Token JIT $tubeText=24 - provisional a canonizar al aprobar la direccion visual, mismo patron que $amber/$stepperBtn de M3.2a. Anotado para el sweep de canonizacion.

## NO se marca done

Pendiente Gate 2 final (security code del leader) + veto de diseno del leader sobre las 5 capturas + OK de Raf.
