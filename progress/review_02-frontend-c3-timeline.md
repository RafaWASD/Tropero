# Review -- C3.1 (ficha de animal: la cronologia cobra vida) - spec 02 R10/R14

**Feature**: spec 02 frontend, chunk C3.1 (timeline read + 3 eventos simples: peso / condicion / observacion).
**Reviewer**: reviewer (agente)
**Fecha**: 2026-06-02
**Baseline**: working tree (no commiteado; los 8 archivos nuevos estan untracked, verificados por path).
**Alcance declarado**: frontend-only (sin migraciones, sin Edge, sin RLS nueva). Confirmado: git status no muestra ningun .sql modificado ni untracked en supabase/.

## Veredicto: APPROVED

C3.1 cumple su scope acotado (timeline de los 7 kinds + carga de los 3 eventos simples), todos los puntos de atencion del brief verifican OK, y el check completo esta verde. Lo que falta (editar/borrar evento, reproductivo/sanitario, CUT, lote, baja, link a madre) es explicitamente C3.2/C3.3/C4 y no se marca como faltante.

---

## Trazabilidad R <-> test (solo R en scope de C3.1)

- R6.1 (weight_events): event-input.test.ts (validateWeight: valido / vacio / <=0 / >max / basura); events.spec.ts (agrega peso 320 -> Pesaje + 320 kg); events.ts addWeight inserta sin .select().
- R6.4 (condition_score, 17 valores): event-input.test.ts (CONDITION_SCORES == 17 exactos; isValidConditionScore acepta validos / rechaza 3.1, 0.75, 5.25). Coincide con el CHECK de 0028 (verificado en la migracion).
- R6.10/R6.13 (animal_events, author_id por trigger, establishment denormalizado): events.ts addObservation (event_type fijo observacion, deriva establishment del PERFIL, NO manda author_id); events.spec.ts (agrega observacion -> aparece); parseo en event-timeline.test.ts (observacion con/sin payload).
- R10.1 (cronologia 7 origenes, payload por kind, orden desc): event-timeline.test.ts (parseo de los 7 kinds incl. payload incompleto/null/string-vacio/kind-desconocido; parseTimeline orden desc + tiebreaker estable); payload keys verificados 1:1 contra 0035_animal_timeline_v2.sql (incl. lab_sample.received <-> result_received_date).
- R10.2 (RLS scopea el timeline): la RPC animal_timeline es security definer + has_role_in(...) por cada union-branch (verificado en 0035). events.ts NO reimplementa filtro de permiso; events.spec.ts corre con usuario real con rol.
- R10.3 (category_change con from/to/reason): event-timeline.test.ts (parseo category_change; collectCategoryIds/resolveCategoryNames sin N+1; describeCategoryChange initial vs auto/manual/revert).
- R13.3 (validacion local antes de enviar): event-input.test.ts (validaciones de submit peso/fecha/observacion); events.spec.ts (peso abc -> queda vacio en vivo; submit vacio -> mensaje Ingresa el peso en kilos y NO navega).
- R14.2 (cabecera + cronologia debajo): C2 ya cubre la cabecera; C3.1 agrega HistorySection debajo. events.spec.ts (Historial visible); animals.spec.ts (assert actualizado teaser->Historial).
- R14.3 (componente por tipo + timestamp legible): TimelineEvent.tsx (icono/titulo/detalle por los 7 kinds); event-timeline.test.ts (humanizadores repro/sanitary/pregnancy/sample/route; formatEventDate los 4 casos + dateOnly + caso AR); events.spec.ts (Pesaje + 320 kg).

Todos los R en scope tienen >=1 test concreto. No queda ningun R de C3.1 sin cobertura.

Fuera de scope (NO se exige test aca, son C3.2/C3.3/C4): R14.4 (editar/borrar evento), R6.8.1/R6.12 (ventana 15 min), R6.14 (recalculo de categoria), R14.5 (override), R14.6/R8.4/R8.5 (CUT), R14.7 (link madre), R14.8/R14.9 (lote/baja). El edit_window_until/author_id se PARSEAN (para C3.3) pero no se exponen acciones, correcto.

---

## Puntos de atencion del brief (chequeados explicitamente)

1. Multi-tenant / establishment de la observacion derivado del PERFIL (CRITICO) -> OK. AnimalDetail.establishmentId se agrego a animals.ts derivandolo de animal_profiles.establishment_id. La ficha lo pasa por param a agregar-evento, y addObservation lo manda como establishment_id de animal_events. El trigger tg_animal_events_validate_est (0034, verificado) tira 23514 si no coincide con establishment_of_profile. Si se hubiera usado el contexto activo, la RLS de insert pasaria pero el trigger rebotaria; derivar del perfil es necesario, no opcional. Sin ningun establishment_id/species/category hardcodeado.

2. RLS-on-RETURNING -> OK. Los 3 inserts (addWeight/addConditionScore/addObservation) usan .insert(payload) SIN .select(). El caller re-fetchea via fetchTimeline al re-enfocar (useFocusEffect). Leccion B.1.2/C1 respetada.

3. R10.2 (RLS del timeline) -> OK. El cliente NO fuerza permisos. La RPC animal_timeline (security definer + has_role_in por branch) es la unica barrera. fetchTimeline solo parsea/ordena/resuelve nombres; no hay filtro de seguridad reimplementado en cliente.

4. Validacion en el campo (R13.3 + input pro) -> OK. Peso: sanitizeWeightInput en vivo (solo decimal) + validateWeight al submit (mayor a 0, hasta 99999.99 = numeric 7,2). Fecha: maskDateInput en vivo + validateEventDate (formato AAAA-MM-DD, no futura), precargada con hoy. Score: selector CERRADO (ScoreSelector renderiza chips de CONDITION_SCORES; estado number o null; no hay TextInput de score) -> nunca puede violar el CHECK 0028. Texto: maxLength=OBSERVATION_MAX_LENGTH (1000) + contador N/1000 + validateObservation (no vacio). Previene, no errorea.

5. Anti-hardcode (ADR-023 seccion 4) -> OK. 0 violaciones en app/app + app/src/components (corrido). Colores/spacing/radios via token o getTokenValue; iconos lucide cruzan a API no-Tamagui con getTokenValue. Tokens referenciados existen en tamagui.config.ts (typecheck verde lo confirma).

6. a11y -> OK. Sin leak de accessibilityLabel crudo a Pressables RN-web: todos los Pressables nuevos usan buttonA11y(Platform.OS, ...); el textarea usa observationA11y() ramificado (web=aria-label, native=accessibilityLabel). El unico accessibilityLabel crudo del changeset esta en la rama NATIVE del helper y en un XStack no accionable del hero (heredado de C2, no es Pressable).

7. Scope discipline -> OK. No se colo nada de C3.2/C3.3/C4: sin reproductivo/sanitario/lab create, sin editar/borrar evento, sin CUT, sin lote, sin baja, sin link a madre (esos kinds solo se RENDERIZAN si vienen de la RPC). No se toco schema ni RLS (cero .sql en el diff/untracked de supabase/).

8. check.mjs verde + tests cubren lo que dicen -> OK (corrido, no asumido):
   - client unit: 252 / 0
   - anti-hardcode: 0 violaciones
   - RLS suite: 17 / 0
   - Edge suite: 36 / 0
   - animal suite (spec 02): 28 / 0 (incl. T2.19 no-bypass Tier 1)
   - maneuvers suite (spec 03): 13 / 0
   - typecheck client: OK; check.mjs exit 0 (Entorno listo).
   - Cobertura verificada: parseo de los 7 kinds (incl. payload incompleto/null/vacio/desconocido), formatEventDate con dateOnly incl. caso AR (2026-06-02T00:00:00+00:00 -> Hoy) + TZ-independiente, 17 scores exactos contra el CHECK 0028.
   - e2e (events.spec.ts + animals.spec.ts actualizado) en el testDir de Playwright; el implementer reporta 27 passed. (La suite e2e no la corre check.mjs; se corre con pnpm e2e aparte.)

---

## Tasks completas: si (para el scope C3.1)

C3.1 es un slice parcial de T3.3 / T3.5 / T4.2 (que abarcan tambien reproductivo/sanitario/lab, editar/borrar observacion, override de categoria, CUT, selector de lote, link a madre, todo C3.2/C3.3/C4). El implementer correctamente NO marco esos T-numbers como [x] para no sobre-declarar (lo deja al leader). No quedan tasks [ ] de C3.1 sin justificacion: lo no hecho es scope futuro explicitamente documentado en context-frontend.md (C3 = C3.1 read+3 simples; resto = C3.2/C3.3) y en la bitacora del implementer. Justificacion documentada -> no es rechazo.

## CHECKPOINTS (aplicables a un chunk frontend-only)

- C1 harness completo: [x] (check.mjs exit 0; archivos base presentes).
- C2 estado coherente: [x] (1 feature in_progress; no se marco done).
- C3 codigo respeta arquitectura: [x] (solo capas previstas: services/utils/components/screens; sin deps nuevas; sin logs de debug; sin establishment_id hardcodeado).
- C4 verificacion real: [x] (test por modulo con logica: event-timeline + event-input + 2 e2e; runner mayor a 0 verde; fixtures reales en e2e).
- C6 SDD: [x] (los 3 docs de spec existen; cada R en scope cubierto por >=1 test).
- C7 multi-tenant: [x] (parcial-aplicable) - no hay tabla nueva; el aislamiento lo da la RLS/RPC existente (no tocada). El cross-tenant ya esta cubierto por la suite RLS (17/0) y T2.19. El flujo de observacion respeta el establishment del perfil (atencion 1).
- C8 offline-first: N/A en C3.1 - el offline real es C5 (PowerSync). C3.1 carga ONLINE detras de services swappables (mitigacion de retrofit de context-frontend.md); sin red muestra error blando con reintentar. No es regresion: ninguna capa previa era offline tampoco.
- C5 cierre de sesion: lo evalua el leader al cerrar (commit/history), no aplica a este review de codigo.

---

## Checklist RAFAQ-especifico

### A. Tablas con establishment_id / RLS - N/A (parcial)
No se crean tablas ni policies (frontend-only). Lo relevante: el flujo de observacion respeta la RLS + el trigger de consistencia de establishment existentes.
- [x] (heredado) animal_events tiene RLS + el trigger tg_animal_events_validate_est (0034); el cliente lo respeta derivando establishment_id del perfil.
- [x] No SQL duplicado inline en cliente; la barrera de permisos es la RPC animal_timeline (security definer + has_role_in), no reimplementada en cliente.
- [x] deleted_at IS NULL lo filtra la RPC server-side (verificado en 0035); el cliente no lo reimplementa.

### B. Datos en campo (offline-first) - N/A en C3.1
- [ ] Offline real -> diferido a C5 (PowerSync), documentado en context-frontend.md y en la bitacora. C3.1 es online-primero detras de services swappables (events.ts espeja animals.ts), justamente para localizar el swap. Justificado, no es rechazo.
- last-write-wins ya esta fijado a nivel modelo (R13.4) para cuando entre C5.

### C. BLE - N/A (C3.1 no toca BLE).

### D. UI de campo - aplica (criticidad amarilla mixta, no roja manga)
- [x] Botones primarios (Agregar evento, Guardar evento, TypeCards) = touchMin = 56dp. El brief sugiere 60dp; el proyecto fija deliberadamente touchMin=56 como estandar canonico manga-friendly (CLAUDE.md ppio 4, documentado en tamagui.config.ts). Los chips de score = chipMin = 40dp (estandar del proyecto para chips de seleccion secundaria; el tap-target real es comodo). Conforme al estandar del proyecto; esta pantalla es amarilla (se toca desde la tab Animales), el alta en manga (roja) es spec 03.
- [x] Fuente legible: titulos size 8/6, valores size 5 (16pt), labels size 3. Los textos que el operario lee (peso, score, observacion, timestamp) son legibles.
- [x] Una decision por pantalla: wizard de 2 pasos (elegi tipo -> form del tipo); paso 1 = 3 cards grandes; paso 2 = un solo form corto.
- [x] Loading visible: submitting -> CTA Guardando disabled; ficha Cargando ficha/Cargando el historial; error blando con Reintentar.

### E. Edge Functions - N/A (C3.1 no toca Edge).

---

## Notas (no bloqueantes, documentadas, no son fallas)
- Orden intra-dia date-only vs timestamp: los 5 kinds tipados tienen event_date columna date -> la RPC los ubica a UTC-medianoche; un peso de HOY puede quedar bajo el alta/observacion de hoy (timestamps reales). El cliente refleja fielmente el event_date desc de la RPC (no inventa un orden distinto -> no genera divergencia cliente/server). El secondary-sort por created_at que menciona R10.1 seria un cambio de RPC (backend, fuera de C3.1). El FIX 1 del fix-loop resolvio el bug de presentacion (Hoy date-only sin huso) sin tocar el orden. Aceptable y bien documentado.
- Sin paginacion del timeline: la RPC trae todo; aceptable en MVP. Refinamiento posterior.

## Conclusion
Sin tests rojos, sin check.mjs rojo, sin R de C3.1 sin test, sin tasks de C3.1 [ ] injustificadas, sin seccion RAFAQ aplicable con box vacio injustificado. APPROVED.
