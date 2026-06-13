# Spec 09 — chunk "09 resto · BLE global" — Tasks

> Fases chicas, en orden de DEPENDENCIA (service puro testeable → montaje → host → integración → E2E). Cada task con su aceptación + los `RB<n>` que cubre. El implementer marca `[x]`.
> Frontend puro (Gate 1 N/A). Si una task descubre necesidad de backend/schema/RLS o un dato faltante (ver BLOQUEANTES del design §10) → **parar y reportar al leader**, no improvisar migraciones ni inventar contratos de spec 04/11.
> Consumir las firmas EXACTAS de spec 04 (`useBleStickListener`/`useBusyWhileMounted`/`useStickListenerControls`/`useBleConnectionStatus`/`BleStickListenerProvider`) y spec 11 (`transferAnimal`/`classifyTransferError`/`TRANSFER_OFFLINE_MESSAGE`) — NO redefinir.

## T1 — Service `lookupByTag` + query cross-campo (puro, testeable primero)

- [x] **T1.1** — `local-reads.ts`: agregar `buildLookupTagAcrossFieldsQuery(tag)` (SELECT sobre `animal_profiles` JOIN `establishments`, `animal_tag_electronic = ?` + `status='active'` + `deleted_at IS NULL`, **sin** filtro de `establishment_id`, proyecta `profile_id`/`establishment_id`/`establishment_name`, `LIMIT 2`). Primer paso del implementer: **verificar que `establishments` está sincronizado localmente con su `name`** (BLOQUEANTE design §10.1) — si no, parar y reportar. Cubre: **RB4.6, RB9.2**.
  - _Aceptación_: builder devuelve el SQL + args esperados; test del builder en `local-reads.test.ts` verde. **[Run 1 ✓]** `establishments(name)` verificado sincronizado (lo usan `buildMembershipsQuery`/`buildEstablishmentDetailQuery`) — no bloqueante. Test SQL/args + integración SQLite verdes.
- [x] **T1.2** — `animals.ts`: agregar el tipo `TagLookupResult` (`edit`/`transfer`/`create`) + `lookupByTag(tag, establishmentId)` con las 3 ramas (1: `buildSearchByTagQuery` campo activo → `edit`; 2: `buildLookupTagAcrossFieldsQuery` con `establishment_id !== activo` → `transfer` con `sourceProfileId`+`otherFieldName`; 3: sin match → `create`). 100% local, sin red. Cubre: **RB4.1, RB4.2, RB4.3, RB4.4, RB4.5, RB9.1**.
  - _Aceptación_: las 3 ramas resuelven correctamente. **[Run 1 ✓]** As-built: el tipo + la decisión PURA viven en `tag-lookup.ts` (`resolveTagLookup`); `lookupByTag` (en `animals.ts`) hace las 2 lecturas locales + delega + re-exporta el tipo (reconciliado en design §3.1/§3.2/§8).
- [x] **T1.3** — Unit de las 3 ramas: match en campo activo → `edit`; match solo en otro campo → `transfer`; sin match → `create`. Cubre: **RB4 (verificación)**.
  - _Aceptación_: `node scripts/check.mjs` (unit app) verde con los nuevos tests. **[Run 1 ✓]** 8 tests sobre `resolveTagLookup` (`tag-lookup.test.ts`) + edge cases (edit-gana, ignorar fila del campo activo, name NULL→fallback). Mockear `runLocalQuery` no aplica (animals.ts no carga bajo node:test) — se testea el puro (reconciliado en design §7.1).

## T2 — Montaje del provider + host en la raíz

- [x] **T2.1** — `_layout.tsx`: montar `<BleStickListenerProvider mode="auto">` entre `RodeoProvider` y `RootGate` (envuelve `RootGate`). NO auto-conecta transporte; `baston-test.tsx` queda intacto (su provider self-contained). Cubre: **RB1.1, RB1.3**.
  - _Aceptación_: el árbol monta sin romper el gating existente (auth/establecimiento/rodeo); `baston-test` sigue funcionando. **[Run 2 ✓]** Provider montado entre `RodeoProvider` y `BleHost`; `mode={isBleE2E() ? 'mock' : 'auto'}` (mock SOLO bajo el flag de E2E, fuera de prod). E2E (a)/(b)/(c)/(d) verdes; baston-test intacto.
- [x] **T2.2** — `RootGate`: renderizar `<><Stack/><FindOrCreateOverlay/></>` (host hermano del Stack, sin desmontar la pantalla activa). Stub inicial de `FindOrCreateOverlay` (sin lógica aún, retorna `null`) para destrabar el montaje. Cubre: **RB1.2**.
  - _Aceptación_: el overlay stub monta dentro de los providers de datos sin warnings de contexto. **[Run 2 ✓]** As-built: `BleHost` = `<><RootGate/><FindOrCreateOverlay/>{isBleE2E()?<BleE2EBridge/>:null}</>` (RootGate ES el `<Stack>`; el overlay es su hermano con `position:absolute` → se renderiza encima sin desmontar). El overlay se implementó completo de una (no stub).

## T3 — `FindOrCreateOverlay` (host del flujo, consume el listener)

- [x] **T3.1** — Implementar `FindOrCreateOverlay`: `useBleStickListener({ enabled, onTagRead })` con `enabled = est.active && rodeo.active` (RB2.1); `onTagRead(eid)` → `OverlayState 'loading'` → `lookupByTag(eid, establishmentId)` → `ready`/`error`; **guard de secuencia** para live-rescan (RB3.5). Encabezado = EID formateado legible (RB3.2). Cierre limpia el estado y reanuda el listener (RB3.4). Cubre: **RB2.1, RB3.1, RB3.2, RB3.3, RB3.4, RB3.5**.
  - _Aceptación_: un EID dispara el overlay (bottom-sheet) con el EID arriba; un EID nuevo lo actualiza sin cerrar; cerrar vuelve a la pantalla original. **[Run 2 ✓]** `seqRef` (ticket) descarta lookups viejos en vuelo (live-rescan + cierre + cambio de campo). EID legible vía `formatEidReadable` (util nuevo + test). Sheet = patrón `BulkConfirmSheet` (scrim + position absolute + grip + Pressable backdrop).
- [x] **T3.2** — Render modo `edit`: card con `fetchAnimalDetail(profileId)` (visual/IDV + categoría + sexo + rodeo) + CTA "Ver ficha" → cerrar + `router.push('/animal/[id]', { id })`. Cubre: **RB5.1, RB5.2**.
  - _Aceptación_: bastonazo a animal del campo → card correcta → "Ver ficha" aterriza en `/animal/[id]`. **[Run 2 ✓]** E2E (a) verde. Card = hero (idv→visual→tag) + `CategoryBadge` + pills sexo/rodeo.
- [x] **T3.3** — Render modo `create`: "Animal nuevo" + EID + CTA "Dar de alta" → cerrar + `router.push('/crear-animal', { tag: eid })`. Cubre: **RB6.1, RB6.2**.
  - _Aceptación_: bastonazo a EID nuevo → "Dar de alta" navega a `/crear-animal` con el tag en params. **[Run 2 ✓]** E2E (b) verde — header "Creando: [TAG]" en crear-animal confirma el TAG precargado.
- [x] **T3.4** — Cierre del overlay al cambiar de establishment activo con overlay abierto (`useEffect` sobre `establishmentId`). Cubre: **RB2.4**.
  - _Aceptación_: cambiar de campo con el overlay abierto lo descarta (no muestra un resultado stale). **[Run 2 ✓]** `useEffect` sobre `establishmentId` + `lookupEstablishmentRef`; `close()` invalida vía `seqRef`.
- [ ] **Veto de diseño del leader** (skill `design-review`) sobre el bottom-sheet (pantalla de alto impacto, ADR-023) ANTES de mostrar a Raf: EID legible a pleno sol, 1 CTA ≥56px, una decisión por pantalla, operable con una mano. **[PENDIENTE — es del leader, no del implementer]**

## T4 — busyMode en los forms (anti-stacking)

- [x] **T4.1** — `useBusyWhileMounted()` en `crear-animal.tsx`, `animal/[id].tsx`, `agregar-evento.tsx` (top del componente). Hoy ninguno lo tiene. Cubre: **RB2.2**.
  - _Aceptación_: con un form abierto, un bastonazo NO abre el overlay; al cerrar el form, el listener reanuda. **[Run 1 ✓]** Hook cableado al top de los 3 componentes (antes de cualquier return; no-op seguro sin provider montado — Run 2). La verificación de comportamiento (bastonazo no abre overlay) es E2E de Run 2 (T8).

## T5 — Param `tag` precargado en crear-animal (rama BLE de R4.2)

- [x] **T5.1** — `crear-animal.tsx`: aceptar param `tag`; cuando viene, precargar `tag_electronic` **read-only** durante el alta (igual tratamiento que `idv`/`visual`); header "Creando: [TAG]". Sin `tag` → comportamiento actual intacto. Actualizar la nota del header del screen (ya no es cierto "la puerta manual nunca trae tag"). Cubre: **RB6.3**.
  - _Aceptación_: `/crear-animal?tag=<EID>` muestra el TAG precargado read-only y lo guarda en el alta; el alta sin tag sigue igual. **[Run 1 ✓]** `PrefillKind` extendido a `'tag'` (prioridad tag > idv > visual); `tag` state arranca del param; el campo TAG read-only se renderiza arriba (con `error={tagError}` para no dejar dead-end si llegara un TAG inválido por deep-link); el campo TAG editable se oculta solo en la rama BLE (idv/visual siguen editables); header "Creando: [TAG]" reusa el `prefilledId`. Comentarios stale ("la puerta manual nunca trae tag") actualizados. El alta manual (idv/visual) intacta.

## T6 — Integración del modo `transfer` (spec 11, online-only)

- [x] **T6.1** — Render modo `transfer`: "Está en **[otherFieldName]**" + EID + CTA "Transferir a [campo activo]" + secundario "Cancelar". CTA **deshabilitado sin red** con copy `TRANSFER_OFFLINE_MESSAGE` (RB7.3; usar el estado de red de PowerSync / `assertOnline`). Cubre: **RB7.1, RB7.3**.
  - _Aceptación_: el overlay muestra la situación read-only; offline el CTA queda disabled con copy accionable. **[Run 2 ✓]** `useStatus().connected` → `isOnline`; CTA `disabled={!isOnline || submitting}` + copy `TRANSFER_OFFLINE_MESSAGE`.
- [x] **T6.2** — Resolver los args de `transferAnimal` (RB7.2 / design §3.4): `sourceProfileId` (de lookup), `targetEstablishmentId` (activo), `targetRodeoId` (default `lastRodeoSelected`/único activo, mismo sistema que origen), `targetProfileId` (`randomUuid`), `targetCategoryId` (catálogo del sistema destino). **Si falta un dato (system_id de origen no legible) → parar y reportar** (BLOQUEANTE design §10.3). Cubre: **RB7.2**.
  - _Aceptación_: con un rodeo del mismo sistema en el campo activo, el transfer arma los args correctos. **[Run 2 ✓]** `targetRodeoId` = `resolveDefaultRodeoId(rodeo.available, readLastRodeo, queryLastUsedRodeoFromDb)`; `targetProfileId` = `newTransferTargetProfileId()` (estable entre reintentos vía ref). **`targetCategoryId`**: `categoryCode` del perfil de ORIGEN (`fetchAnimalDetail(sourceProfileId)`, sincronizado local) → resuelto por CÓDIGO en el sistema DESTINO (`buildCategoryIdByCodeQuery(targetRodeo.systemId, code)`). El `systemId` del rodeo destino viene directo del tipo `Rodeo` (no hizo falta exponer el `system_id` de origen — se resuelve por código sobre el sistema destino, cubre ambos casos del plan). Si NO resuelve → error accionable, NO se inventa default (design §10.3). E2E (d) verde.
- [x] **T6.3** — Manejo del resultado: éxito → cerrar + `router.push('/animal/[id]', { id: targetProfileId })`; `idvDropped` → aviso "completá el IDV"; error → copy de `classifyTransferError` (nunca sqlerrm crudo), overlay abierto para reintentar/cancelar. Cubre: **RB7.4**.
  - _Aceptación_: transfer exitoso aterriza en la ficha nueva; el error muestra copy accionable sin romper el overlay. **[Run 2 ✓]** + reconciliación: tras el RPC OK se espera (`waitForProfileLocally`) a que el perfil nuevo BAJE al SQLite local antes de navegar (la ficha lee LOCAL → sin esto mostraba "No se encontró el animal" — cazado en E2E (d)). `idvDropped` → aviso EN el sheet + CTA "Ver ficha" (la ficha de spec 02/11 no lee un param de aviso, se da acá sin tocar scope ajeno). Error → `res.error.message` (de `classifyTransferError`), sheet abierto.

## T7 — Chip de conexión + connect web-serial

- [x] **T7.1** — `BleConnectionChip` consumiendo `useBleConnectionStatus()`: copy es-AR + ícono por estado (referencia: `statusView` de `baston-test.tsx`, extraer a módulo compartido si conviene — sin duplicar). Nunca bloquea la puerta manual. Cubre: **RB8.1, RB8.2**.
  - _Aceptación_: el chip refleja `connected`/`disconnected`/etc.; desconectar el bastón no bloquea la app. **[Run 2 ✓]** `BleConnectionChip` (`app/src/components/`) + `bleConnectionView` (módulo compartido nuevo, copy es-AR + íconos lucide — versión de producción del `statusView` del harness, que es self-contained y no se toca). `blocksManualEntry` invariante false (manual-first).
- [x] **T7.2** — Montar el chip en el header de `(tabs)/animales.tsx` + control de connect web-serial (gesto de usuario → `transport.connect()`/`requestPort`). Sin pantalla de pairing pulida (diferida, DEC-5). Cubre: **RB8.1, RB8.3**.
  - _Aceptación_: desde la tab Animales se puede conectar el bastón por web-serial; el chip muestra el estado. **[Run 2 ✓]** Chip en la fila del título "Animales" (XStack space-between). Tap (no conectado) → `api.transport.connect()` con gesto de usuario (web-serial requestPort). En native (manual-first) → no-op.

## T8 — E2E Playwright con MockAdapter (4 escenarios §9 Gate 0)

- [x] **T8.1** — Wiring de test: exponer un handle (`window.__rafaqBle.tagRead(eid)` / `connectMock()`) bajo flag de E2E que enchufe al `MockAdapter` montado en el provider de la raíz (mode `mock` en E2E). Mantenerlo FUERA de la superficie de producción (solo bajo flag — Gate 2 lo revisa). Cubre: **§7.2 design**.
  - _Aceptación_: desde Playwright se puede inyectar un EID y una transición de conexión al provider de la raíz. **[Run 2 ✓]** Flag = marca DELIBERADA `window.__RAFAQ_BLE_E2E__` (Playwright la pone vía `addInitScript` ANTES del bundle; en prod NUNCA se setea). `ble-e2e-flag.ts::isBleE2E()` → `mode='mock'` + monta `BleE2EBridge` (lee `api.transport` que en mock ES un `MockAdapter` → publica `window.__rafaqBle.{tagRead,connectMock,disconnectMock}`). Doble guard en el bridge. Sin la marca: ni mock ni handle (Gate 2). Vive en `_components/` (NO en `services/ble/`, que es firma de spec 04).
- [x] **T8.2** — `app/e2e/baston.spec.ts`: los 4 escenarios — (a) EID existente → `edit` → "Ver ficha" → ficha correcta; (b) EID nuevo → `create` → "Dar de alta" → `/crear-animal` con TAG precargado; (c) bastonazo con form abierto → NO abre overlay (busyMode); (d) EID de otro campo → `transfer` → transferir online → ficha nueva (seed con 2º campo del usuario). Cubre: **RB1, RB2.2, RB3, RB4, RB5, RB6, RB7 (E2E)**.
  - _Aceptación_: los 4 escenarios VERDES sobre PowerSync local. **[Run 2 ✓]** 4/4 verdes (27s). El (d) usa seed con 2 campos del mismo owner; espera el sync de ambos antes de bastonear.

## T9 — Cierre y verificación

- [ ] **T9.1** — Autorrevisión adversarial del implementer (paso 8 de su agente) sobre el host BLE + navegación + camino de transfer online (Gate 2 superficie).
- [ ] **T9.2** — `node scripts/check.mjs` exit 0 end-to-end (lint anti-hardcode 0 violaciones, unit app + builders, suites). Cubre: **criterios de aceptación del chunk**.
- [ ] **T9.3** — Reconciliación specs↔as-built al cerrar el chunk: foldear las decisiones a `requirements.md`/`design.md` base (R2 + R3.3/R3.4 con las divergencias DEC-2/DEC-3), actualizar la nota del header de `crear-animal.tsx`, marcar opción A (R7) / opción B (R8) / pairing (R9) como chunk diferido. **Toda corrección de fix-loops/Gate 2 se refleja en estos 3 archivos del chunk ANTES de cerrar** (regla del proyecto: nunca specs contradictorias con el código).

---

## Notas de scope (del Gate 0)

- **DENTRO**: montaje provider + host, `lookupByTag` (3 ramas), gating `enabled`+busyMode, overlay edit/create/transfer, chip de conexión, param `tag` en crear-animal, E2E mock.
- **DIFERIDO** (NO en este chunk): opción A (`AssignTagSearchScreen`, R7 base), opción B (`BulkTagAssignmentScreen`, R8 base), `spp-android` real (gated ADR-024 §4), pantalla de pairing pulida (R9 base).
- **Gates**: Gate 1 N/A (frontend puro). Gate 2 SÍ (host BLE + navegación + transfer online, lo corre el implementer). Veto de diseño del leader sobre el overlay. Puerta 2 (Raf prueba en `pnpm web` con web-serial o el harness mock) para `done` del chunk.
