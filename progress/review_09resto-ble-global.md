# Review — spec 09 chunk BLE global (reviewer)

**Veredicto: APPROVED**

- Fecha: 2026-06-13 (sesion 24).
- Baseline: b0700ff (HEAD). Chunk en el working tree, sin commitear (se trabaja sobre main).
- Naturaleza: frontend puro RN/Expo + un builder SQL puro. Sin migraciones/RLS/Edge nuevas. Gate 1 N/A (criterio C4/C6 spec 02). Gate 2 (security_code_09resto-ble-global.md) = PASS.
- Scope: SOLO los archivos del chunk. Ignorados specs/active/08-export-sigsa y security_spec_08 (otra terminal).

## Trazabilidad RB ↔ test concreto

- RB1.1/1.2/1.3 (montaje provider + host raiz): _layout.tsx:432-440 (BleHost = RootGate + Overlay + bridge bajo flag), :500-502 (provider entre RodeoProvider y BleHost). E2E baston.spec.ts a/b/c/d. baston-test intacto.
- RB2.1 (enabled = est.active y rodeo.active): FindOrCreateOverlay.tsx:83. E2E a/b/d.
- RB2.2 (busyMode anti-stacking): useBusyWhileMounted en crear-animal.tsx:120, animal[id].tsx:93, agregar-evento.tsx:128. Gate de escucha BleStickListenerProvider.tsx:115 corta en seco. E2E c: bastonazo con form abierto NO abre overlay.
- RB2.4 (close on establishment change): FindOrCreateOverlay.tsx:121-126 (useEffect + lookupEstablishmentRef) + close() invalida via seqRef. Inspeccion + typecheck.
- RB3.1/3.2/3.3 (disparo + EID legible + 1 CTA): E2E a/b/d "Caravana leida" + eidReadable visible arriba. Unit eid-format.test.ts (3 tests) cubre RB3.2.
- RB3.4/3.5 (cierre + live-rescan): seqRef ticket guard (onTagRead:102-113, close:93-96). Un lookup viejo en vuelo se descarta. Inspeccion + autorrevision.
- RB4.1-4.5 (lookupByTag 3 ramas): animals.ts:598-638 (I/O + corto-circuito) delega a resolveTagLookup (tag-lookup.ts). Unit tag-lookup.test.ts (9 tests): edit, edit-gana-sobre-transfer, primer match, transfer, ignora fila del campo activo, name NULL fallback, unica fila del campo activo cae a create, create.
- RB4.6 (query cross-campo): local-reads.ts:683-694 (animal_tag_electronic, status active, deleted_at IS NULL, SIN filtro de establishment, LIMIT 2, JOIN establishments por name). Unit local-reads.test.ts (2 tests): SQL/args + integracion SQLite real (matchea otro campo, ignora deleted/no-activo/otro-tag, trae name).
- RB5.1/5.2 (modo edit): E2E a card (fetchAnimalDetail) + Ver ficha hacia /animal/[id].
- RB6.1/6.2/6.3 (modo create + param tag): E2E b Animal nuevo, Dar de alta, crear-animal con "Creando: TAG". crear-animal.tsx:125-141,975-1001 precarga read-only, prioridad tag>idv>visual, camino manual intacto.
- RB7.1-7.4 (transfer online-only): E2E d Esta en otro campo, Transferir (enabled online), ficha nueva. TransferBody:399-477 rodeo default + categoria por codigo (sistema destino) + targetProfileId estable (ref) + guard online + classifyTransferError + idvDropped + waitForProfileLocally.
- RB8.1/8.2/8.3 (chip): BleConnectionChip.tsx + ble-connection-view.ts (6 estados es-AR, nunca bloquea manual). Montado en animales.tsx:268. connect web-serial por gesto.
- RB9.1/9.2 (offline + multi-tenant): lookupByTag 100% local (emptyIsSyncing false en ambas lecturas). establishmentId por param (nunca hardcode). Gate 2 foco 2 confirma que la query cross-campo no debilita RLS.

Cada RB tiene >=1 test concreto (unit o E2E) o cobertura por inspeccion documentada. Sin huecos.

## Tasks completas: SI (con justificacion de los pendientes)

tasks-09resto-ble-global.md: T1.1-T1.3, T2.1-T2.2, T3.1-T3.4, T4.1, T5.1, T6.1-T6.3, T7.1-T7.2, T8.1-T8.2 todas marcadas.

Boxes sin marcar con justificacion documentada (NO bloquean):
- T3.3 (veto de diseno del leader): explicitamente PENDIENTE, es del leader, no del implementer.
- T9.1 (autorrevision adversarial): ejecutada (documentada en impl run2; Gate 2 PASS existe).
- T9.2 (check.mjs verde): verificado verde por el reviewer.
- T9.3 (fold a la spec BASE 2026-05-26): trabajo de cierre del leader, cross-chunk, patron identico a C4/C6 de spec 02. La spec del CHUNK (requirements/design-09resto-ble-global) SI esta al dia con el as-built.

## check.mjs: VERDE end-to-end

Sin rate-limit de Supabase Auth. typecheck cliente, lint anti-hardcode (0 violaciones en app/app + app/src/components), client unit tests (incl. tag-lookup.test.ts, eid-format.test.ts, local-reads.test.ts enganchados en run-tests.mjs:53), y todas las suites backend. All tests passed.

## CHECKPOINTS / focos del brief

- [x] 3 ramas lookupByTag: orden correcto (edit campo activo, transfer otro campo, create). Corto-circuito real (animals.ts:611). Edge cases cubiertos.
- [x] Query cross-campo: sin filtro de establishment (intencional), LIMIT 2, JOIN por name. Test SQLite real.
- [x] FindOrCreateOverlay: live-rescan (seqRef) sin race; cierre invalida lookups en vuelo; cambio de est cierra; enabled correcto; 3 modos; navegacion cierra antes de push; safe-area; CTA transfer corto.
- [x] Wiring transfer: targetRodeoId, targetCategoryId (categoria origen por codigo en sistema destino), targetProfileId estable (ref), guard online, classifyTransferError, idvDropped, waitForProfileLocally.
- [x] busyMode: 3 forms con useBusyWhileMounted; gate de escucha suspende efectivamente; param tag read-only sin romper el manual.
- [x] Provider en _layout.tsx: entre RodeoProvider y BleHost; host hermano del Stack; NO rompe el gating de RootGate.
- [x] E2E baston.spec.ts: 4 escenarios cubren de verdad los 4 caminos.
- [x] Consistencia as-built: patrones de animals.ts/local-reads; sheet reusa BulkConfirmSheet; tokens (cero hardcode); a11y; reusos correctos (bleConnectionView extraido sin duplicar; harness intacto).

## Checklist RAFAQ-especifico

- A (multi-tenancy/RLS): N/A. No crea tablas ni policies. La query cross-campo se apoya en el scoping ya existente de la stream (Gate 2 foco 2).
- B (offline-first): APLICA. lookupByTag 100% local, sin requests sincronos a Supabase desde la pantalla. Transfer online-only por diseno de spec 11 (conflicto = no se encola). Sync bucket scopeado por la stream.
- C (BLE): APLICA. Desconexion: chip lo refleja, nunca bloquea la puerta manual (blocksManualEntry invariante false). Modo manual de fallback siempre activo. Dedup/ventana 3s en el provider. Logs BLE no bloquean el flujo.
- D (UI de campo): APLICA. CTA >=56px; EID legible agrupado para lectura a una mano; una decision por pantalla; loading visible (OverlayLoading). Veto de diseno fino queda al leader (T3.3).
- E (Edge Functions): N/A. No toca Edge Functions. transfer_animal es de spec 11 (ya gateado).

## Observaciones menores (NO bloquean)

- OBS-1 (LOW, cosmetico): crear-animal.tsx:4-6 el header-comment describe el find-or-create como idv-si-numerico/visual-si-texto sin mencionar la rama BLE del tag precargado. El comentario interno (:122-140) y la UI (:975-1001) SI la documentan; la frase stale "la puerta manual nunca trae tag" ya fue removida. Imprecision del header-comment, no contradiccion con el as-built. Actualizar al cerrar (parte de T9.3).
- OBS-2 (LOW): el CTA de transfer dice "Transferir a este campo" (FindOrCreateOverlay.tsx:530) en vez de incluir el nombre. El nombre del campo activo SI aparece en el cuerpo (:509). Copy corto manga-friendly. No bloquea.
- MED-1 / LOW-1 / LOW-2 del Gate 2 ya en backlog; ninguno bloquea.

## Por que APPROVED

- Las 3 ramas del lookup en orden correcto con corto-circuito real; 9 unit + 2 builder tests cubren ramas y edge cases.
- El live-rescan no tiene race (seqRef ticket verificado en codigo + autorrevision).
- El busyMode suspende efectivamente (gate de escucha corta en seco).
- El param tag no rompe el camino manual.
- Todos los caminos criticos cubiertos por E2E (4/4 verdes).
- check.mjs verde, Gate 2 PASS, sin findings HIGH.
- La spec del chunk no contradice el codigo; el fold a la spec base es trabajo de cierre del leader, documentado.
