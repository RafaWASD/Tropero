# Sesión actual

> Este archivo se vacía al cerrar cada sesión y su resumen se mueve a `history.md`.
> Mientras trabajás, **mantenelo actualizado en tiempo real**, no al final.

## Sesión 24 — 2026-06-13 — Spec 09 resto · chunk "BLE global"

**Estado de arranque**: spec 11 cerrada y commiteada (Puerta 2 OK), working tree limpio, `check.mjs` verde end-to-end. Raf eligió (AskUserQuestion) arrancar **"09 resto — chunk BLE global"** (el próximo en el orden de implementación del plan).

**Qué es el chunk** (BUSCAR ANIMAL, puerta BLE): montar el `BleStickListenerProvider` (spec 04, hoy solo en `/baston-test`) en la raíz + crear el `FindOrCreateOverlay` global → bastonear desde cualquier pantalla → confirmar EID → editar (match) / alta (nuevo) / transferir (en otro campo, spec 11). Contra mock/web-serial (el `spp-android` real sigue gated por el dev build Android de Raf). **Se difiere**: dedup opción A/B (R7/R8) al chunk siguiente; pairing pulido (R9) al hardware.

**Hecho hasta ahora (leader)**:
- Mapeo del as-built (Explore): la capa BLE de spec 04 está LISTA para cablear (firma exacta de spec 09); el provider NO está montado en la raíz; el alta/ficha/manual ya están (spec 02 C2/C3).
- **Gate 0 escrito**: `specs/active/09-buscar-animal/context-09resto-ble-global.md` (scope + reconciliación + UX del overlay + 5 decisiones DEC-1..5 + gates).

**⏸ Esperando**: **Puerta 1** de Raf (aprobar el Gate 0 + las 5 decisiones, o redlinear).

**Gates del chunk**: Gate 1 N/A (frontend puro, no toca schema/RLS/Edge; reusa queries existentes + RPC transfer de spec 11 ya gateado). Gate 2 (code) sí. Veto de diseño del leader sobre el overlay (pantalla de alto impacto). Puerta 2 humana.

**Próximo al aprobar**: `spec_author` foldea DEC-1..5 a requirements/design de spec 09 (R2 + R3.3/R3.4) + redacta tasks del chunk → `implementer` (Opus) → reviewer (Opus) + Gate 2 → veto de diseño → Puerta 2.

---

**[Run 1 DONE]** backbone (`impl_09resto-ble-global-run1.md`): `lookupByTag` + `resolveTagLookup` + `buildLookupTagAcrossFieldsQuery` + param `tag` en crear-animal + `useBusyWhileMounted` en los 3 forms. check verde.

**[Run 2 DONE — implementer]** overlay + integración (`impl_09resto-ble-global-run2.md`): provider montado en la raíz + `FindOrCreateOverlay` (3 modos edit/create/transfer, live-rescan, EID legible, sheet patrón BulkConfirmSheet) + `BleConnectionChip` en el header de Animales + wiring E2E (flag `__RAFAQ_BLE_E2E__` + `BleE2EBridge`, fuera de prod) + `baston.spec.ts` 4/4 verdes. `targetCategoryId` del transfer resuelto por código sobre el sistema destino. `check.mjs` verde end-to-end.

**[VETO DE DISEÑO — leader, skill design-review]** PASS tras 2 fixes. Clasificada 🔴 manga-crítica. Capturé los 3 modos a viewport mobile fiel (412×915, DPR2) vía el harness E2E. Findings corregidos por el implementer: **A (must)** safe-area inferior del sheet (`paddingBottom = insets.bottom + $6`, idiom reusado de crear-animal/agregar-evento/seleccion-masiva) + **B (should)** CTA de transfer corto fijo "Transferir a este campo" (antes interpolaba el nombre del campo → desbordaba a 2 líneas). OJO: la 1ª captura salió STALE (el implementer corrió Playwright sin rebuildear el `dist`; el webServer sirve `serve dist`) — la cacé, rebuildié el dist y re-capturé contra el bundle correcto. Renders finales en `design/veto-ble-overlay/`.

**[REVIEWER — Opus] APPROVED** (`review_09resto-ble-global.md`): 3 ramas del lookup OK, live-rescan sin race, busyMode suspende, transfer bien cableado, E2E cubre 4 caminos, check verde. 2 OBS menores no bloqueantes (comentario de header crear-animal; CTA transfer sin nombre = decisión de diseño intencional).

**[GATE 2 — security code] PASS 0 HIGH** (`security_code_09resto-ble-global.md`): flag/bridge E2E aislado de prod (triple guard), query cross-campo no debilita multi-tenancy, transfer sin IDOR, sin leaks de log. 1 MED pre-existente (spec 15 err crudo de SQLite) + 2 LOW → backlog (2026-06-13).

**[PUERTA 2 — Raf] APROBADA (2026-06-13).** Chunk "BLE global" CERRADO + COMMITEADO + PUSHEADO: commit `d0abf5b` (`b0700ff..d0abf5b`, 34 archivos, commit SELECTIVO — NO incluye los `08-export-sigsa`/handoff de la terminal paralela ni `RAFAQ-resumen`/PNG scratch del veto). Fold a la spec base 09 R2 (AS-BUILT 2026-06-13) hecho. feature_list: 09 → `deferred` (chunk done; quedan dedup A/B + pairing + spp-android). Guía de testeo web con bastón: `docs/test-baston-web.md` (pedido de Raf).

**Observación menor sin cerrar (no bloquea)**: OBS-1 del reviewer (el comentario de header de `crear-animal.tsx` no menciona la rama BLE del param tag) — cosmético, app-code; no lo toqué (el leader no edita código de app; no amerita run de implementer). Anotado.

**Próximo (cuando Raf retome 09)**: chunk **dedup** (opción A `AssignTag` single + opción B `BulkTagAssignment` masiva, R7/R8) — el siguiente del frontend de 09. Necesita su propio Gate 0 (scope contra as-built). O lo que Raf priorice (spec 08 SIGSA la lleva otra terminal; 05/03/07 siguen gated por hardware/uso).
