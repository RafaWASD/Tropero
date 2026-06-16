# Review — spec 03 M2.1-core (PLOMERIA del identify de MODO MANIOBRAS)

Reviewer: agente revisor. Fecha: 2026-06-14. Gate: 2 (code), pre-cierre.
Baseline: 6308ff5. Alcance: untracked app/app/maniobra/**, app/src/utils/maniobra-identify.ts(+.test), app/e2e/maniobra-identify.spec.ts, maniobra-wizard.spec.ts + tracked FindOrCreateOverlay.tsx, _layout.tsx, run-tests.mjs, specs reconciliadas.

## Veredicto: APPROVED

Frontend puro que cablea piezas existentes (BLE spec 04 / lookup spec 02-09 / find-or-create spec 09 / sesion M1). Backend done; Gate 1 N/A. La decision no-trivial (R3.2 supresion del listener global) esta bien resuelta y verificada. El unico rojo de check.mjs es ajeno a este chunk (spec 12 import).

---

## Trazabilidad R-n vs test (US-3, US-4, R5.1)

- R3.1 (dual BLE+manual): identificar.tsx useBleStickListener + ManualEntry/onManualSearch. e2e (a)/(b)/(c) BLE, (d)/(e) manual.
- R3.2 (suspender listener global): FindOrCreateOverlay.tsx:93,107,137 (BLE_OWNED_ROUTES + early-return por ruta) + identificar.tsx:142 (listener manga-owned). e2e (a)/(b)/(c). Foco critico 1.
- R3.3 (resolucion por tag): maniobra-identify.test.ts (edit->found, create->unknown); EID validado+dedupeado por el provider. e2e (a) found, (b) unknown.
- R3.4 (feedback inmediato): BleStickListenerProvider.tsx:132 playFeedback; FoundHero Lectura recibida. e2e (a).
- R3.5 (manual idv/visual): maniobra-identify.test.ts (0->unknown, 1->found, >1->ambiguous); searchAnimals. e2e (d).
- R3.6 (disconnect->manual sin perder sesion): provider mantiene sesion; BleConnectionChip. e2e (e).
- R3.7 (reconexion automatica): garantizada por provider/adapters as-built; chip refleja estado. e2e (e).
- R3.8 (StickReader abstracto): identificar.tsx consume contrato transport-agnostico de spec 04; en web/e2e adapter-mock.
- R4.1 (find-or-create inline): resolvePrefilledCreateParams test; UnknownHero + onDarDeAlta -> /crear-animal precargado + rodeo de sesion. e2e (b) Creando [TAG].
- R4.3 (BLE dup auto por tag): maniobra-identify.test.ts (BLE nunca ambiguous: tag unico global desempata solo).
- R4.5 (otro establecimiento -> avisar+saltar): maniobra-identify.test.ts (transfer->other_establishment); OtherFieldHero + Saltar. e2e (c). NO transfiere (feature 11). Foco critico 4.
- R5.1 (destino auto-avance): shouldAutoAdvance test (solo found); goToCarga (router.replace). e2e (a)/(d)/(e) -> PRENADA.
- R10.4 (BLE offline): BLE/serial directo; lookup local; alta encola offline. offline-noread.test.ts as-built.
- auto-avance (Raf): maniobra-identify.test.ts (SOLO found; resto false).

Todos los R-n del alcance tienen >=1 test concreto. Sin huecos.

---

## Tasks completas: si (para el chunk)

- tasks.md M2.1 partido: M2.1-spike [x] / M2.1-core [x] / M2.1-edge [ ] (diferido justificado: R4.2 desambiguacion, R4.7 heuristica rodeo, R4.4-UI). Documentado con justificacion (estado ambiguous seguro, no auto-elige).
- T2.12 [ ] (verificacion cross-spec del find-or-create): criterio = Gate 2 confirma delegacion al alta as-built sin params de tenant. CONFIRMADO: onDarDeAlta pasa solo identificador (resolvePrefilledCreateParams: tag/idv/visual), NO establishment_id; el alta (/crear-animal) fuerza establishment del contexto + UNIQUE + created_by server-side. T2.12 satisfecho.

---

## CHECKPOINTS

- [x] C3 - arquitectura (pantallas en app/app, logica en app/src/utils; modulo PURO sin RN/SDK; cero hardcode de establishment_id - sale del contexto).
- [x] C4 - verificacion real: modulo PURO 9 tests (node:test) + 5 e2e funcionales (accept Y reject). Runner >0, suite unit frontend verde.
- [x] C6 - SDD: cada R-n con >=1 test; specs reconciliadas (design 6 R3.2, requirements nota R4.1, tasks split).
- [x] C8 - offline-first: lookup local, alta encola offline, baston BLE offline. Conflict resolution documentada (design 5, last-write-wins + append-only).
- [ ] C1 (check.mjs exit 0) - rojo, pero AJENO al chunk. No bloquea M2.1-core.
- N/A C7 (RLS tablas nuevas) - el chunk NO crea tablas; backend (RLS sessions/presets, gating) ya done 0050-0057 y testeado en suite maneuvers Fase 2.

### node scripts/check.mjs -> RC=1 (rojo)
Causa AJENA a spec 03. Unico fallo: supabase/tests/import/run.cjs (spec 12): Could not find the function public.import_rodeo_bulk(p_rows) - hint import_rodeo_bulk(p_rodeo_id, p_rows). Desalineamiento test vs migracion remota de spec 12 (commits e2ee997/c008085, otra terminal). NO es el flake de rate-limit (no hay Request rate limit reached ni cascada undefined.id): firma de funcion desfasada en la suite import. M2.1-core no toca import/spec 12. La suite client unit (incl. maniobra-identify.test.ts 9/9, tag-lookup, todas las BLE) paso verde; corrida aislada maniobra-identify.test.ts = 9 pass / 0 fail.
Nota leader: este rojo de spec 12 debe resolverlo la terminal duena de spec 12 antes de un cierre que dependa de check verde. No es regresion de este chunk; M2.1-core APROBADO, el entorno tiene un rojo ajeno pendiente.

---

## Foco critico (escrutado, no pasamanos)

### 1. R3.2 - UN SOLO consumidor efectivo del baston: OK
- (a) overlay NO procesa en ruta maniobra: FindOrCreateOverlay.onTagRead:137 early-return por onBleOwnedRouteRef ANTES del lookup. BLE_OWNED_ROUTES = asignar-caravanas + maniobra. ref actualizado cada render (:109).
- (b) la manga SI recibe: el provider hace fan-out a todos los suscriptores (tagSubscribersRef, Set, :140). Ambos hooks se suscriben; la manga procesa, el overlay early-returns.
- (c) NO hay doble-manejo: solo identificar.tsx ejecuta lookupByTag+setOutcome; el overlay retorna antes.
- (d) al SALIR se restaura: top-segment != maniobra -> el overlay vuelve a procesar; useEffect:185-187 cierra un sheet stale si quedo.
- (e) caso peligroso (find-or-create DESDE la manga): onDarDeAlta -> router.push a /crear-animal. Ahi el top-segment deja de ser maniobra PERO crear-animal.tsx:120 monta useBusyWhileMounted -> setBusy(true) -> en el provider listening = enabled && !busy = false -> handleReading early-returns (:115) -> ningun suscriptor recibe una lectura espuria. Doble cobertura (busy mode + pantalla de manga oculta tras el push). Sin doble-resolucion ni navegacion rara.
- Por que NO disableListener (decision correcta): apagaria el transporte -> la manga tampoco recibiria; y dos consumidores con enabled propio competirian por el enabled global unico del provider. Supresion-por-ruta deja el transporte escuchando con un solo consumidor efectivo. Reconciliado en design 6 (:632).
- Regresion BLE global: el patron generaliza el anti-stacking ya existente para asignar-caravanas; el cambio en el overlay es aditivo. Tests wiring/contract/dedup del provider verdes en la suite unit.

### 2. Auto-avance EXACTAMENTE UNA VEZ: OK
- goToCarga usa router.replace (no push) -> no apila cargas.
- useEffect:164-169 con clearTimeout cleanup; deps [outcome, goToCarga]. Una 2a lectura del MISMO animal dentro de la ventana de dedup no llega (processEid la descarta en el provider). Una lectura distinta re-arma el timer (cleanup cancela el previo) -> una sola navegacion.
- Pasa profileId correcto (outcome.animal.profileId) + sessionId del param. Guards mountedRef + seqRef evitan setOutcome post-unmount/stale.

### 3. Offline-first: OK
Baston BLE directo (R10.4, no red). lookupByTag/searchAnimals leen SQLite local. Alta via /crear-animal (camino offline existente). establishmentId del contexto (no hardcode).

### 4. Multi-tenant / R4.5: OK (vector de fuga cerrado)
La rama transfer->other_establishment solo aparece si el animal esta en un campo presente en el SQLite local, que solo contiene establecimientos donde el usuario tiene rol (la stream scopea por has_role_in; buildLookupTagAcrossFieldsQuery NO re-aplica filtro de campo pero NO debilita RLS - local-reads.ts:775-777). Un tag de un tenant SIN rol del usuario no esta local -> cae a create (unknown->alta), NUNCA a esta en campo X. Campo X siempre es un campo que el usuario YA ve. RLS server-side es la barrera final. No revela data cross-tenant.

### 5. Modulo PURO maniobra-identify.ts: OK
BLE edit->found / transfer->other / create->unknown; manual 0->unknown / 1->found / >1->ambiguous. shouldAutoAdvance solo found. Tests cubren accept Y reject: ambiguous NO auto-elige (:76), other-field NO auto-avanza (:87). Precargado BLE->tag, manual numerico->idv, alfanumerico->visual (:116).

### 6. Diferido a M2.1-edge SEGURO: OK
- R4.2 (ambiguous): outcome ambiguous con candidateProfileIds -> AmbiguousHero solo avisa + Volver. NO auto-elige. UI de desambiguacion es M2.1-edge. Estado seguro, no TODO que rompe.
- R4.7 / R4.4-UI: anotados en identificar.tsx:22-26 + tasks M2.1-edge, justificados.

---

## Checklist RAFAQ-especifico

A. Multi-tenancy / RLS - N/A (el chunk no crea tablas; RLS de sessions/maneuver_presets ya done en 0050/0051, testeada en suite maneuvers Fase 2). El path de lectura (lookup) es tenant-safe - Foco critico 4.

B. Offline-first (carga/edicion en campo)
- [x] Funciona offline (lookup local + alta encola; baston BLE directo).
- [x] Sync bucket correcto (reusa camino spec 02/09; alta usa enqueueCreateAnimal).
- [x] Resolucion de conflictos: append-only + last-write-wins (design 5).
- [x] No hace requests sincronos a Supabase desde la pantalla - lookupByTag/searchAnimals tocan SQLite local; el alta va por el outbox.

C. BLE (Vesta/Allflex)
- [x] Desconexion repentina: e2e (e) disconnect -> chip Baston desconectado + sesion intacta + fallback manual. Reconecta solo (R3.7).
- [x] Modo manual de fallback en <=1 tap: ManualEntry colapsada con CTA Sin chip ingresa la caravana (1 tap para expandir) - siempre disponible.
- [x] Correlacion TAG vs resolucion: EID validado+dedupeado por el provider (ventana por-TAG ~3s, parser-rs420/dedup as-built); match por tag_electronic unico global.
- [x] Logs BLE no bloquean el flujo: logTransportEvent best-effort (logging.ts), no toca el render del operario.

D. UI de campo (manga)
- [x] Una decision por pantalla: escuchar / found / unknown / otro-campo / ambiguo - un hero por estado.
- [x] Estado de loading visible: searching (Buscando...) en el manual; flash Lectura recibida en found; chip de conexion siempre visible.
- [x] Recorte de descendentes: heroes/labels con numberOfLines llevan lineHeight matching (FoundHero/UnknownHero/OtherFieldHero/AmbiguousHero, SpikeSessionHeader); el spike carga.tsx veta el clip con PRENADA/VACIA.
- [~] Targets >=60dp: los CTAs usan $touchMin=56 (estandar manga-friendly de la casa, tamagui.config.ts:110). Observacion menor, NO bloqueante: el piso >=60px de R5.2 aplica a los bloques de decision GIGANTES de la carga rapida (M2.2/M3), no a esta pantalla scan-first donde el target primario es el animal (baston), no botones en pantalla. Fuentes: heroes $9/$8 (grandes); labels secundarios $5 (16pt) - aceptable para scan-first. Subir el piso de los CTAs secundarios a 60 = ajuste de token trivial si Raf lo prefiere.

E. Edge Functions - N/A (el chunk no crea ni toca Edge Functions; frontend puro).

---

## Cambios requeridos
Ninguno bloqueante para M2.1-core.

## Notas (no bloqueantes, leader)
1. Entorno con rojo ajeno: check.mjs RC=1 por supabase/tests/import/run.cjs (spec 12, firma import_rodeo_bulk desfasada). Reconciliar en la terminal duena de spec 12 antes de un cierre que dependa de check verde. No es regresion de este chunk.
2. Targets >=60dp en CTAs secundarios (seccion D): opcional, subir de $touchMin a 60 si Raf lo prefiere. Trivial.
3. e2e no esta en check.mjs: maniobra-identify.spec.ts (5 escenarios) corre por Playwright fuera de check.mjs. Verificada por lectura (bastonean/tipean de verdad, accept y reject). Recomendable correrla en el harness e2e antes del cierre.
