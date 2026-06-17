baseline_commit: 279a10fdc1295c93ba8bb51e44747375ac8acee6

# impl 03 — M4.2 — R10.8: surfacing de rechazos de sync (que un rechazo no se pierda en silencio)

Feature `03-modo-maniobras` (in_progress). Chunk **M4.2 — R10.8**. Frontend + un toque al connector de
PowerSync (sin schema). Backend de sesiones/gating DONE (0050-0057 + 0091). Gate 1 N/A (no toca DB).
Reviewer + Gate 2 después. NO marco done.

## GAP que cierra (contexto del leader)
Una maniobra cargada offline y RECHAZADA al sincronizar (gating capa 2 `23514`, tenant-check, RLS `42501`)
se DESCARTA en `connector.uploadData` para no bloquear la cola, y `surfaceUploadRejection` HOY solo hace
`console.warn` → no hay store observable que la UI consuma → **dead-letter silencioso** (el dato de campo
se pierde sin que el operario lo sepa). R10.8 = materializar ese canal en un store + darle UI de manga.

## Plan (tasks)
- [x] T1 — Store observable de rechazos + helpers PUROS es-AR
      (`app/src/services/powersync/upload-rejections.ts`): store in-memory (`useSyncExternalStore`),
      `{ id, table, op, code, at }` (NO `opData`), cap 50 + DEDUP por id. API `recordUploadRejection` /
      `useUploadRejections` / `acknowledgeUploadRejections(ids?)` / `clearUploadRejections`. Helpers
      `rejectionReason` / `rejectionWhenLabel` / `rejectionBannerTitle` / `isManeuverRejection` /
      `maneuverRejectionTypeLabel`. Test 17/17. Registrado en `scripts/run-tests.mjs`.
- [x] T2 — `connector.ts`: `surfaceUploadRejection` llama `recordUploadRejection` en su PROPIO try/catch
      (best-effort, NUNCA throw). Cero cambio a la clasificación ni al flujo de `uploadData`.
- [x] T3 — UI: banner `$terracota` en `maniobra.tsx` (arriba de retomar / "Tus rutinas") → tap →
      `SyncRechazoSheet` (idiom lockeado + guard tap-through doble-rAF) lista tipo+motivo+cuándo +
      "Entendido". Pluralización es-AR correcta (sustantivo + verbo). Sin "rehacer".
- [x] T4 — e2e `maniobra-rechazo-sync.spec.ts` 3/3 con hook SOLO-E2E `__RAFAQ_SYNC_REJECT_E2E__`
      (`sync-rechazo-e2e.ts`, gated fuera de prod). + capturas 360/412.
- [x] T5 — check (client unit verde; backend red = flake) + e2e maniobras regresión + reconciliación specs
      (design §5 + §6.bis ya cubre; requirements R10.8 nota; tasks M4.2 done) + autorrevisión.

## Mapa R<n> → test
- **R10.8** (rechazo de sync visible, no dead-letter silencioso; motivo + camino a re-resolver) →
  - `upload-rejections.test.ts`: `rejectionReason` (23514 → rodeo dejó de habilitar / 42501 → sin permiso /
    otro → servidor rechazó, con el TIPO de maniobra de la tabla R5.4); `isManeuverRejection` (filtro a las
    5 tablas de evento); `recordUploadRejection` guarda SIN `opData`; cap 50; DEDUP por id; best-effort
    no-throw; `acknowledge`/`clear`; `rejectionWhenLabel`; `rejectionBannerTitle` (pluralización).
  - e2e `maniobra-rechazo-sync.spec.ts` (a) rechazo de maniobra armado → banner terracota → tap → sheet con
    "Pesaje: …" + motivo es-AR → "Entendido" → banner+sheet desaparecen; (b) sin rechazo → sin banner; (c)
    rechazo de tabla NO de maniobra (animal_profiles) → no dispara el banner de manga (filtro).
  - El cableado al canal REAL (no solo E2E) lo da el connector: `surfaceUploadRejection` →
    `recordUploadRejection`; `upload-classify.test.ts` (pre-existente) ya prueba que `23514`/`42501`
    clasifican PERMANENTE → llegan a `surfaceUploadRejection`.

## Autorrevisión adversarial
Pasada hostil (lectura del código + capturas web táctil 360/412):

**Cazado y CERRADO:**
1. **Gramática es-AR rota en N=1** — el título decía "1 maniobra no se **sincronizaron**" (verbo plural con
   sustantivo singular) y el subtítulo "Estas cargas las rechazó". **Fix**: helper PURO `rejectionBannerTitle`
   que conjuga sustantivo+verbo (1 → "1 maniobra no se sincronizó"; N → "N maniobras no se sincronizaron") +
   subtítulo count-aware ("Esta carga la rechazó… hacerla" vs "Estas cargas las rechazó… hacerlas"). Verificado
   en las 4 capturas + test.

**Buscado y OK (no fue necesario tocar):**
- **El store acota y dedup-ea (no crece infinito)** — cap 50 (descarta los más viejos) + dedup por id (op
  re-rechazada bajo reintento at-least-once NO duplica; el más reciente gana). Tests directos.
- **PRIVACIDAD (NO opData)** — el store guarda SOLO `{ id, table, op, code, at }`; el test asierta que el
  JSON del registro no contiene ni la clave `opData` ni los valores de campo sembrados (380, 'secret').
- **El upload path es sagrado (best-effort, NUNCA throw)** — `recordUploadRejection` envuelto en try/catch
  interno + el connector lo llama en SU PROPIO try/catch (separado del `console.warn`, para que si uno tira
  el otro corra). Test con un `op` de getters venenosos → `doesNotThrow`. Cero cambio a `isTransientUploadError`/
  `classifyIntentUploadError` ni al flujo de `uploadData` (solo se AGREGÓ la llamada dentro de la función ya
  existente). Verificado por lectura del diff del connector.
- **El banner solo aparece con rechazos de MANIOBRA** — `maneuverRejections = allRejections.filter(isManeuverRejection)`;
  e2e (c) prueba que un rechazo de `animal_profiles` NO dispara el banner. Un rechazo de otra feature lo
  maneja el surfacing genérico de ESA feature, no esta UI.
- **"Entendido" limpia** — `acknowledgeUploadRejections(ids de los mostrados)` → banner+sheet desaparecen
  (e2e a). Marca SOLO los ids visibles → si llegara uno nuevo con el sheet abierto, no se pierde.
- **Edge: rechazo nuevo mientras el sheet está abierto** — el render del sheet es
  `showRechazos && maneuverRejections.length > 0`; el ack es por ids mostrados → un nuevo rechazo queda en
  el store y reaparece el banner tras cerrar. No se traga.
- **Web táctil 360/412** — banner + sheet se ven bien (capturas), terracota (no rojo), descenders intactos
  ("sincronizó"/"jornada"/"Pesaje"/"señal" con lineHeight matching), targets full-width (banner tappable,
  "Entendido" full-width). El sheet NO se auto-cierra (guard tap-through doble-rAF, idéntico a los otros
  sheets; el e2e abre el banner con `.click()` y el sheet queda; las capturas esperan 500ms > la ventana del
  click huérfano).
- **Tests que pasan por la razón correcta** — el e2e (a) ejercita el path REAL de UI (store→banner→sheet→ack);
  (c) verifica el REJECT del filtro (no solo el accept). El unit de no-throw usa getters venenosos (ejerce el
  catch real, no un happy-path).
- **Multi-tenant / hardcode** — el store es agnóstico de tenant (solo table/op/code, sin establishment_id);
  el banner usa `$terracota` (token, anti-hardcode 0); el sheet reusa el idiom lockeado. El landing ya tenía
  el `establishmentId` del contexto.
- **Hook SOLO-E2E fuera de prod** — `sync-rechazo-e2e.ts` consume `window.__RAFAQ_SYNC_REJECT_E2E__` (marca
  que solo Playwright pone vía addInitScript; ningún input de usuario la setea) → en prod/dev es null → no-op.
  Mismo patrón gated que `maneuver-e2e-fault.ts`/`ble-e2e-flag.ts` (vetables por Gate 2).

## Reconciliación de specs (al as-built)
- `design.md` §5: AS-BUILT R10.8 (el "canal" era solo un `console.warn`; este chunk construye el store
  observable + connector best-effort + banner/sheet). El §642 viejo quedó con la nota de que se materializó.
- `requirements.md` R10.8: nota de reconciliación as-built (store + UI + "re-resolver = re-hacer manual"; el
  EARS NO se reescribe).
- `tasks.md`: M4.2 dividido — **M4.2 (R10.8 surfacing) = `[x]` DONE**; el resto del viejo M4.2 (offline R10.1/
  R10.2/R10.3 cobertura + R10.7 ya done en exit-hero) se renombró **M4.3 `[ ]` PENDIENTE** (verificación;
  el substrato ya existe). No se inventan EARS ni se contradice el código.

## Verificación
- typecheck client OK; anti-hardcode 0 violaciones (`app/app` + `app/src/components`).
- client unit: `upload-rejections.test.ts` 17/17; suite ampliada de powersync+maniobra 226/226 (corrida
  directa). `scripts/run-tests.mjs` registra el nuevo test.
- check.mjs RC=1 = **flake del backend `Animal suite (spec 02)`** (parallel-terminal `animals_tag_unique`/
  rate-limit, ver memoria `reference_check_red_rate_limit.md`) — corre DESPUÉS de `client unit tests` (que
  pasó) y NO toca nada de este chunk (frontend + un toque al connector, sin DB). El baseline check al
  arrancar la sesión fue verde (exit 0).
- e2e (web export real, hasTouch): `maniobra-rechazo-sync.spec.ts` 3/3; regresión
  `maniobra-reanudar.spec.ts` 4/4 + `maniobra-wizard.spec.ts` 1/1 + `maniobra-config-sheet-race.spec.ts` 3/3
  (landing→wizard→identify + sheets tap-through sin regresión).
- 4 capturas web táctil (hasTouch+mobile) 360/412 en `tests/modo-maniobra/`:
  `sync-rechazo-banner-{360,412}.png`, `sync-rechazo-sheet-{360,412}.png`.

## Archivos
- NUEVO `app/src/services/powersync/upload-rejections.ts` (+`.test.ts`) — store observable + helpers es-AR.
- MOD  `app/src/services/powersync/connector.ts` — `surfaceUploadRejection` llama `recordUploadRejection`
       (best-effort, NUNCA throw; su propio try/catch).
- MOD  `app/app/maniobra.tsx` — banner terracota de rechazos + apertura del sheet + ack + inyección SOLO-E2E.
- NUEVO `app/app/maniobra/_components/SyncRechazoSheet.tsx` — sheet de detalle (idiom lockeado + guard).
- NUEVO `app/app/maniobra/_components/sync-rechazo-e2e.ts` — hook SOLO-E2E de inyección (gated fuera de prod).
- NUEVO `app/e2e/maniobra-rechazo-sync.spec.ts` (3 escenarios) + NUEVO
       `app/e2e/captures/sync-rechazo-banner.capture.ts`.
- MOD  `scripts/run-tests.mjs` (registra `upload-rejections.test.ts`).
- Reconciliación: `specs/active/03-modo-maniobras/{design.md §5, requirements.md R10.8, tasks.md M4.2/M4.3}`.
