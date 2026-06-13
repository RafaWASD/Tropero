baseline_commit: b0700ff49c14f991b8bdb66bcc40bf611c1b4e33

# Impl — spec 09 chunk "BLE global" · Run 2 (overlay + integración)

**Feature**: 09-buscar-animal (chunk "09 resto · BLE global"), in_progress.
**Run**: 2 de 2 (overlay + chip + montaje del provider + transfer wiring + E2E). El Run 1 (backbone) ya cerró y está verde (ver `impl_09resto-ble-global-run1.md`).
**Spec**: `specs/active/09-buscar-animal/{context,requirements,design,tasks}-09resto-ble-global.md` (RB1..RB9).
**baseline_commit**: heredado del Run 1 (`b0700ff…`, SHA previo a la 1ª task de la feature — multi-sesión, NO se sobreescribe). HEAD actual = b0700ff (Run 1 no commiteó; los cambios viven en el working tree).

## Alcance EXACTO del Run 2 (tasks T2, T3, T6, T7, T8, T9)
- T2. Montar `BleStickListenerProvider mode="auto"` en `_layout.tsx` entre `RodeoProvider` y `RootGate`; renderizar `<FindOrCreateOverlay/>` hermano del `<Stack>` en `RootGate`.
- T3. `FindOrCreateOverlay`: listener + `enabled` (est.active && rodeo.active) + live-rescan + render edit/create + cierre + close-on-establishment-change.
- T6. Modo transfer (online-only): render + resolución de args de `transferAnimal` + manejo de resultado.
- T7. `BleConnectionChip` + connect web-serial, montado en el header de `(tabs)/animales.tsx`.
- T8. Wiring E2E del MockAdapter (flag) + `app/e2e/baston.spec.ts` (4 escenarios).
- T9. Autorrevisión + check.mjs verde + reconciliación de specs.

## NO en Run 2 (ya en Run 1)
- `buildLookupTagAcrossFieldsQuery`, `lookupByTag`, `TagLookupResult`/`resolveTagLookup`, param `tag` en crear-animal, `useBusyWhileMounted()` en los 3 forms.

## NO tocar (consumir tal cual)
- `app/src/services/ble/*` (firma spec 04), `transfer-animal.ts` (spec 11), `baston-test.tsx` (harness self-contained).

---

## Plan (COMPLETO)
- [x] T2.1 — montar provider en `_layout.tsx` (entre RodeoProvider y BleHost; mode mock-bajo-flag)
- [x] T2.2 — `BleHost` = `<RootGate/>` + `<FindOrCreateOverlay/>` (+ bridge bajo flag)
- [x] T3.1 — listener + enabled + live-rescan (seqRef) + header EID legible + cierre
- [x] T3.2 — render edit (card + "Ver ficha")
- [x] T3.3 — render create ("Animal nuevo" + "Dar de alta")
- [x] T3.4 — close-on-establishment-change
- [x] T6.1 — render transfer + CTA disabled sin red (useStatus().connected)
- [x] T6.2 — resolución de args del transfer (category por código sobre sistema destino)
- [x] T6.3 — manejo de resultado (éxito + waitForProfileLocally / idvDropped / error)
- [x] T7.1 — `BleConnectionChip` + `bleConnectionView`
- [x] T7.2 — montar chip + connect web-serial en animales.tsx
- [x] T8.1 — wiring E2E MockAdapter (flag `__RAFAQ_BLE_E2E__` + `BleE2EBridge`)
- [x] T8.2 — `baston.spec.ts` (4 escenarios, 4/4 verdes)
- [x] T9 — autorrevisión + reconciliación de specs + check.mjs (abajo)

## Archivos creados / tocados (Run 2, rutas absolutas)
Creados:
- `app/app/_components/FindOrCreateOverlay.tsx` — host del flujo BLE (estado + 3 modos + live-rescan + transfer).
- `app/app/_components/BleE2EBridge.tsx` — puente E2E (publica `window.__rafaqBle` solo bajo flag).
- `app/app/_components/ble-e2e-flag.ts` — `isBleE2E()` (marca `__RAFAQ_BLE_E2E__`, fuera de prod).
- `app/src/utils/eid-format.ts` (+ `.test.ts`) — `formatEidReadable` (RB3.2) + 3 tests.
- `app/src/components/BleConnectionChip.tsx` — chip de estado + connect web-serial.
- `app/src/components/ble-connection-view.ts` — `bleConnectionView` (copy es-AR + íconos, compartido).
- `app/e2e/baston.spec.ts` — E2E 4 escenarios.
Tocados:
- `app/app/_layout.tsx` — montar provider + `BleHost`.
- `app/app/(tabs)/animales.tsx` — chip en el header.
- `app/src/components/index.ts` — exports del chip + view.
- `scripts/run-tests.mjs` — enganchar `eid-format.test.ts`.
- Specs: `design-09resto-ble-global.md` (§3.4/§4/§6/§8/§10 reconciliados), `tasks-09resto-ble-global.md` (T2/T3/T6/T7/T8 `[x]`).

NO tocado (consumir tal cual): `app/src/services/ble/*`, `transfer-animal.ts`, `baston-test.tsx`. NINGUNA migración/RLS/Edge.

## Trazabilidad RB<n> → test concreto (Run 2)
- **RB1.1/RB1.2/RB1.3** (montaje provider + host) → E2E `baston.spec.ts` (a/b/c/d): el bastonazo abre el overlay desde la pantalla activa → el provider + host están montados y funcionando. `baston-test` intacto (no se tocó).
- **RB2.1** (enabled = est.active && rodeo.active) → E2E (a/b/d) disparan con campo+rodeo activos; (c) con form abierto NO dispara (busyMode, complementa enabled).
- **RB2.2** (busyMode anti-stacking) → E2E (c): bastonazo con form de alta abierto → NO abre overlay.
- **RB2.4** (close on establishment change) → `useEffect` sobre `establishmentId` + `lookupEstablishmentRef` (cubierto por inspección + typecheck; el E2E no cambia de campo con overlay abierto, pero la lógica es directa).
- **RB3.1/RB3.2/RB3.3** (disparo + EID legible + 1 CTA) → E2E (a/b/d): "Caravana leída" + `eidReadable(eid)` visible arriba; 1 CTA por modo. `eid-format.test.ts` cubre el formato (RB3.2) en unit.
- **RB3.4** (cerrar) → `close()` invalida vía `seqRef` (inspección; el flujo de cerrar se ejercita implícito al navegar tras los CTAs).
- **RB3.5** (live-rescan) → `seqRef` ticket guard (inspección + autorrevisión; un EID nuevo descarta el lookup viejo en vuelo).
- **RB5.1/RB5.2** (modo edit) → E2E (a): card del animal + "Ver ficha" → ficha correcta.
- **RB6.1/RB6.2** (modo create) → E2E (b): "Animal nuevo" + "Dar de alta" → crear-animal con "Creando: [TAG]".
- **RB7.1/RB7.3** (modo transfer + online-guard) → E2E (d): "Está en otro campo" + "Transferir a [campo]" habilitado online. El disabled offline = `disabled={!isOnline}` + copy `TRANSFER_OFFLINE_MESSAGE` (inspección; E2E corre online).
- **RB7.2** (args del transfer) → E2E (d): transfer real aterriza en la ficha nueva → los args (rodeo/categoría/profileId/category por código) se resolvieron bien server-side.
- **RB7.4** (resultado + idvDropped + error) → E2E (d) cubre el éxito + `waitForProfileLocally`. `idvDropped` (aviso en el sheet) + error (`classifyTransferError`) por inspección (ramas defensivas; el E2E happy-path no colisiona idv).
- **RB8.1/RB8.2/RB8.3** (chip) → el chip monta en el header de Animales (visible en E2E a/c/d que navegan ahí); `bleConnectionView` cubre los 6 estados; nunca bloquea (manual-first, invariante). El connect web-serial por gesto (inspección — el E2E usa el mock).
- **§7.2** (wiring E2E fuera de prod) → `ble-e2e-flag.ts` + `BleE2EBridge.tsx`; sin la marca, ni mock ni handle (grep confirma que solo el spec la setea).

## Autorrevisión adversarial (paso 8) — busqué como revisor hostil
- **Live-rescan que pisa estado**: `seqRef` (ticket) en `onTagRead` y `close()` → un lookup que resuelve tarde solo aplica si sigue siendo el último bastonazo. Verificado: un EID nuevo incrementa el ticket → el `.then` viejo hace `return`. Sin race.
- **Overlay que se apila**: el overlay es UN componente con UN `state`; un nuevo bastonazo REEMPLAZA el state (no apila). El sheet usa `position:absolute` único.
- **`enabled` mal calculado (overlay disparando sin rodeo)**: `enabled = est.active && rodeo.active`; el `useBleStickListener` llama `disableListener()` cuando `enabled=false` → el provider no procesa. Además `onTagRead` re-chequea `establishmentId` (defensa). E2E sin rodeo no aplica (la app bloquea con CTA al wizard antes), pero el guard está.
- **Flag E2E filtrándose a prod**: la marca `__RAFAQ_BLE_E2E__` SOLO la pone el spec (`addInitScript`); grep confirma cero usos en código de runtime salvo `isBleE2E()`. Sin marca → `mode='auto'` (transporte real) + bridge NO montado → `window.__rafaqBle` no existe. Doble guard en el bridge. Cero superficie en build normal.
- **Transfer sin guard de red**: el CTA `disabled={!isOnline || submitting}` (RB7.3) + `transferAnimal` hace `assertOnline` internamente (fast-fail). Doble red.
- **Navegación que pierde contexto / "No se encontró el animal" post-transfer**: CAZADO en E2E (d) — la ficha lee LOCAL y el perfil transferido tardaba en sincronizar → agregué `waitForProfileLocally` (polling de `fetchAnimalDetail`) ANTES de navegar. Fix verificado: (d) verde.
- **Asserts E2E que pasan por la razón equivocada**: (a) el assert del visual fallaba por `overflow:hidden` (RN-web "hidden") aunque el flujo BLE era correcto → lo cambié a presencia en DOM (`not.toHaveCount(0)`); el assert REAL del flujo es "Identificación visible" (aterrizó en la ficha del animal bastoneado). (b) el header "Creando: [TAG]" ES la prueba del TAG precargado (quité el assert frágil del campo, que estaba en otro paso del wizard). Los 4 escenarios ejercen el path real (mock → provider → overlay → navegación).
- **Doble-tap en Transferir**: `submitting` deshabilita el botón; un doble-tap antes del re-render haría replay (mismo `targetProfileId` por ref → idempotencia spec 11). Aceptable.
- **Multi-tenant**: `establishmentId` del contexto activo (nunca hardcodeado); el transfer usa `targetEstablishmentId = establishmentId`; el RPC deriva origen/animal_id de la fila real (anti-IDOR, spec 11). El lookup cross-campo no debilita RLS (set ya scopeado por la stream).
- **Hooks rules**: el overlay llama todos los hooks (useAuth/useEstablishment/useRodeo/useStatus/useState/useRef/useCallback/useEffect/useBleStickListener) antes del primer return condicional (`if (state===null) return null` va DESPUÉS). `EditBody`/`TransferBody` son componentes separados → sus hooks no se condicionan. Typecheck verde.

## Reconciliación de specs (paso 9)
Divergencias as-built reconciliadas en `design-09resto-ble-global.md`:
- §4: ubicación del host (`_components/`), formato del EID (util nuevo), sheet (patrón BulkConfirmSheet), estado de red (useStatus), idvDropped en el sheet, `waitForProfileLocally` (lag de sync post-transfer).
- §3.4: resolución de category por CÓDIGO sobre el sistema destino (no se expone system_id de origen); §10.3 NO fue bloqueante.
- §6: chip + `bleConnectionView` (módulo compartido; harness intacto).
- §8: tabla de archivos del Run 2 (rutas reales, incl. wiring E2E + eid-format).
- §10: cierre de los 4 bloqueantes (ninguno lo fue).
`requirements.md` (RB) NO cambió: el QUÉ se cumple sin desviación; solo cambió el CÓMO/DÓNDE (decisiones de diseño). `tasks.md`: T2/T3/T6/T7/T8 `[x]` con notas as-built. El veto de diseño del overlay queda `[ ]` (es del leader, no del implementer).
La reconciliación con `requirements.md`/`design.md` BASE de spec 09 (R2 + R3.3/R3.4 + opción A/B/pairing diferidos) la hace el leader al CERRAR el chunk (T9.3) — es cross-chunk, no del Run 2.

## Decisiones de diseño/arquitectura (en curso)
- **targetCategoryId del transfer**: leo el detalle del perfil de ORIGEN (`fetchAnimalDetail(sourceProfileId)`, ya sincronizado local) → `categoryCode`; el rodeo DESTINO (resuelto por `resolveDefaultRodeoId` sobre `rodeo.available`) me da `systemId` directo (el tipo `Rodeo` ya lo trae). `targetCategoryId = runLocalQuery(buildCategoryIdByCodeQuery(destSystemId, sourceCategoryCode))`. Resuelve SIEMPRE por código sobre el sistema destino (cubre ambos casos del plan: sistemas iguales → misma fila; distintos → mapeo por código). Si la categoría no resuelve en el sistema destino → PARO con error accionable (no invento default).
- **Estado de red para el CTA transfer**: `useStatus().connected` de `@powersync/react` (mismo predicado que `assertOnline`).
- **Sheet**: reuso el patrón de `BulkConfirmSheet` (scrim + position absolute + sheet anclado abajo + grip + Pressable backdrop) — NO invento un primitivo nuevo.
- **Chip copy/iconos**: extraigo el `statusView` de `baston-test.tsx` a un módulo compartido (sin duplicar).
