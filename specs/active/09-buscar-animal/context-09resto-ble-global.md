# Spec 09 — chunk "09 resto · BLE global" — Gate 0 (refinamiento de contexto)

**Status**: Pendiente de aprobación de Raf (Puerta 1).
**Fecha**: 2026-06-13 (sesión 24).
**Conducido por**: leader (+ 1 Explore para mapear el as-built). Decisiones para Raf en §7.
**Naturaleza**: chunk de implementación del frontend de spec 09 (igual patrón que los chunks C4/C6 de spec 02). NO reabre la spec entera — la spec 09 está aprobada (2026-05-26) + Gate 0 retroactivo (s18, `context.md`). Este doc **scopea el chunk contra el as-built** (que evolucionó mucho desde 2026-05-26) y lockea las decisiones nuevas. El fold a requirements/design lo hace el `spec_author` tras la Puerta 1; la implementación, el `implementer` (Opus).
**Related**: spec 04 v2 (capa BLE buildable, DONE), spec 11 (transferencia re-parenting, DONE backend), spec 02 frontend C2/C3 (alta find-or-create manual + ficha, DONE), spec 15 (PowerSync overlay).

> Contrato humano del Gate 0 (ADR-022): contexto validado + edge cases resueltos + scope del chunk acordado, antes de redactar tasks e implementar.

---

## 1. Por qué este chunk (orden del plan)

`plan.md` (orden de implementación): `… → 01 fe ✅ → 02 fe ✅ → PowerSync ✅(web) → [04 bastón ✅ buildable · import ✅] → **09 resto** → 05 → 03 → 08 …`.

"09 resto" = lo que quedó de BUSCAR ANIMAL una vez que el **alta find-or-create manual** se folded en el frontend de spec 02 (chunk C2). Raf eligió (2026-06-13) arrancar por el **chunk BLE global**: bastonear desde cualquier pantalla → confirmar el EID → editar/alta/transferir. Es el corazón de la feature CORE y el pull-left que el plan anticipó con la capa mock-first de ADR-024 (se construye y valida **hoy** contra mock/web-serial, sin el hardware Android que sigue gated).

---

## 2. Reconciliación contra el as-built (qué ya existe)

La spec 09 (2026-05-26) asume un layout (`app/src/features/animals/`) y un estado que ya **no** son los actuales. Estado real:

### Ya construido (NO se re-hace)
- **Tab Animales + find-or-create manual** (`app/app/(tabs)/animales.tsx`): buscador con debounce, filtros (rodeo/estado/sin-caravana), no-match → "Dar de alta este animal" → `/crear-animal`. Cubre R1 + R3 puerta manual.
- **Alta guiada** (`app/app/crear-animal.tsx`): wizard 4 pasos (rodeo → sexo → categoría → datos), identificador precargado read-only. Cubre R4.
- **Ficha + timeline** (`app/app/animal/[id].tsx`, `agregar-evento.tsx`): identidad + atributos + lote + eventos. Cubre R5.
- **Lookup service** (`app/src/services/animals.ts`): `searchAnimals` (rama TAG exacto FDX-B + IDV + LIKE parcial + fuzzy visual), `findOrCreateLookup` (puerta manual). Lecturas sobre **PowerSync local** (`local-reads.ts`: `buildAnimalsListQuery`, `buildSearchByTagQuery`, `buildAnimalDetailQuery`) + overlay `pending_*`.

### Capa BLE de spec 04 — LISTA para cablear (firma exacta de spec 09)
Todo en `app/src/services/ble/`:
- **`BleStickListenerProvider`** (provider global): monta el adapter por plataforma/modo, corre cada lectura por el contrato de ingesta (validate + dedup R1/R3), dispara feedback (R4), entrega el EID validado a los suscriptores. **HOY solo se monta en `/baston-test`** (harness dev web-only); **NO está montado en la raíz**.
- **`useBleStickListener({ enabled, onTagRead })` → `{ isConnected, isListening }`** (`stick.ts`): firma EXACTA de spec 09 R2. `onTagRead(tag)` recibe el EID ya validado+dedupeado; la **confirmación visual pre-commit (R2) y el find-or-create son del consumidor** (este chunk).
- **`useBusyMode()` / `useBusyWhileMounted()`**: suspenden el listener mientras hay un form CREATE/EDIT abierto (R2 anti-stacking).
- **`useStickListenerControls()` → `{ enableListener, disableListener }`**: para MODO MANIOBRAS (spec 03, no construido aún).
- **Adapters**: `mock` ✅ (tests/CI), `web-serial` ✅ (dev, conecta por gesto `requestPort`), `manual` ✅ (piso universal). `spp-android` y `hid-wedge` = **stubs gated** (devuelven `null`; esperan hardware/validación física, ADR-024 §4).
- **Contrato**: `EidIngestEngine` (validate+dedup), `parser-rs420` (`isValidTag`/`normalizeTag`, 15 díg FDX-B), `TagDedup` (ventana 3s).

### Árbol de providers de la raíz (`app/app/_layout.tsx`)
`GestureHandler > SafeArea > Tamagui > Auth > PowerSync > Profile > Establishment > Rodeo > RootGate`. `RootGate` ya tiene el patrón de "destinos navegables" por top-segment (no re-rutea `crear-animal`/`animal`/`rodeo`/etc. en estado `active`). El gating ya cubre `crear-animal` y `animal/[id]`.

### NO existe (= el delta de este chunk + el siguiente)
- El **montaje del provider en la raíz** + el **`FindOrCreateOverlay`** (host del flujo BLE). → **este chunk**.
- `assignTagToAnimal`, `AssignTagSearchScreen` (opción A), `BulkTagAssignmentScreen` (opción B). → **chunk dedup siguiente, diferido**.

---

## 3. Scope de ESTE chunk (qué entra / qué se difiere)

### Entra (buildable hoy contra mock/web-serial)
1. **Montar `BleStickListenerProvider` en la raíz** (`_layout.tsx`), envolviendo `RootGate` dentro de `RodeoProvider` (para que el host tenga Auth/PowerSync/Establishment/Rodeo disponibles). El provider no auto-conecta transporte; el `enabled` lo gobierna el host.
2. **`FindOrCreateOverlay` global** (host del flujo BLE, R2.1/R2.4): un componente montado junto a `<Stack>` en `RootGate` que consume `useBleStickListener` y, al recibir un EID, corre el find-or-create por TAG y muestra el overlay encima de la pantalla activa.
3. **Lookup por TAG (rama BLE de R3)**: extender el service con `lookupByTag(tag, establishmentId)` sobre PowerSync local → uno de:
   - **match local activo** → `mode: 'edit'` (ficha).
   - **TAG activo en OTRO campo del usuario** (perfil activo en otro establishment sincronizado) → `mode: 'transfer'` (spec 11).
   - **sin match en ningún campo** → `mode: 'create'` (alta con TAG precargado).
4. **Gating del listener** (`enabled`): activo solo en estado `active` de establecimiento **con rodeo existente** (hay sobre qué crear); suspendido durante forms vía `useBusyMode` en `crear-animal`/`animal/[id]`/`agregar-evento`; (MODO MANIOBRAS aún no existe → no hay caso que suspender por R2.3 todavía, pero se deja el `useStickListenerControls` listo).
5. **Indicador de conexión mínimo** (R2.5): un chip de estado del bastón visible y consistente (p. ej. en el header de la tab Animales) + reuso del connect de web-serial. Sin pantalla de pairing pulida.
6. **E2E con bastón mockeado** (R2.4 / Fase 6): bastonazo → overlay → editar (match) / alta (no-match) / transferir (otro campo), sobre PowerSync local.

### Se difiere (chunks/condiciones posteriores)
- **Dedup opción A** (`AssignTagSearchScreen` "¿es uno de tus animales sin caravana?", R7) y **opción B** (`BulkTagAssignmentScreen`, asignación masiva, R8) → **chunk dedup siguiente**. Por eso, en este chunk, **BLE sin-match va directo a CREATE** (no se interpone el intermediate de R3.3 — ver DEC-2).
- **`spp-android` real** (bastón físico) → gated por el dev build Android de Raf (ADR-024 §4). Este chunk valida con mock + web-serial.
- **Pantalla de conexión/pairing pulida (R9)** → tentativa, espera el hardware real (la forma del flujo de conexión del RS420 se cierra con el device).

---

## 4. Arquitectura del chunk (sketch para el implementer)

- **Montaje**: `_layout.tsx` envuelve `RootGate` con `<BleStickListenerProvider mode="auto">` (dentro de `RodeoProvider`). `mode='auto'` elige web-serial/mock/manual por plataforma (ya implementado en `adapter-selection`).
- **Host**: `RootGate` renderiza `<><Stack/><FindOrCreateOverlay/></>`. El overlay usa `useBleStickListener({ enabled, onTagRead })` + `useRouter` para navegar al confirmar. Vive **dentro** de los providers de datos (Est/Rodeo/PowerSync) → puede scopear el lookup y leer `lastRodeoSelected`.
- **`enabled`** = `est.status==='active' && rodeo.status==='active'` (hay campo + rodeo). Cuando exista MODO MANIOBRAS, su stack llamará `disableListener()` (contrato R2.3, ya soportado).
- **`onTagRead(eid)`** → `lookupByTag` → set del estado del overlay (`{ eid, result }`) → render del overlay. Confirmar navega; cerrar limpia el estado y vuelve.
- **busyMode**: `crear-animal.tsx`, `animal/[id].tsx`, `agregar-evento.tsx` montan `useBusyWhileMounted()` → un bastonazo no abre overlay encima de un form abierto.

---

## 5. UX del overlay — la "ventana de la manga" (dirección, design-review al vetar)

El overlay es la **pantalla de mayor impacto** del chunk (ADR-023: hand-craft). El operario tiene una mano ocupada con el bastón, a veces con barro/sangre, mira la pantalla <1s. Dirección propuesta (los píxeles los veta el leader con la skill `design-review` cuando vuelva el implementer, antes de mostrárselo a Raf):

- **Disparo**: bastonazo → feedback ya lo da el provider (vibración + beep apagable, R4) → el overlay **sube desde abajo** (bottom Sheet, no full-screen — preserva el contexto de la pantalla activa detrás, R2.4).
- **Encabezado = el EID leído** formateado legible (confirmación visual R2 = integridad de la declaración SENASA). El operario verifica de un vistazo que leyó la caravana correcta.
- **Cuerpo = el resultado del find-or-create**, una decisión por pantalla (principio del proyecto), con **un CTA primario grande** (Fitts, touch ≥56px):
  - **`edit`** (match): card del animal (visual/idv prominente + categoría + sexo + rodeo + último evento) → CTA **"Ver ficha"** (→ `/animal/[id]`).
  - **`create`** (nuevo): "Animal nuevo" → CTA **"Dar de alta"** (→ `/crear-animal` con TAG precargado, rama BLE de R4).
  - **`transfer`** (en otro campo): "Está en **[nombre del otro campo]**" → CTA **"Transferir a [campo activo]"** (spec 11, online-only; si no hay red, CTA deshabilitado con copy "necesita conexión") + secundario "Cancelar".
- **Cerrar**: tap afuera / "Cerrar" → vuelve a la pantalla original, listener reanuda.
- **Ritmo de manga** (DEC-4): un **nuevo** EID distinto mientras el overlay está abierto **actualiza** el overlay (escanear, escanear, escanear sin cerrar); el mismo EID dentro de la ventana de dedup se ignora (lo maneja el provider). Alternativa más simple: uno-por-vez (cerrar antes del próximo). Rec: live-rescan (es el punto del bastón), pero es la decisión de UX a confirmar.

---

## 6. Edge cases y mapeo de modos

| Caso | Modo | Acción del overlay | Notas |
|---|---|---|---|
| TAG con perfil activo en el campo activo | `edit` | "Ver ficha" → `/animal/[id]` | R3.2 |
| TAG sin match en ningún campo del usuario | `create` | "Dar de alta" → `/crear-animal?tag=` | R3.3 BLE, **sin** intermediate en este chunk (DEC-2) |
| TAG activo en OTRO campo del usuario (perfil activo, otro establishment sincronizado) | `transfer` | "Transferir a [campo activo]" (spec 11) | R3.4 refinado por D2 + spec 11; online-only |
| TAG malformado / no FDX-B | — | nada (el provider lo descarta + loguea, R1.4/R15) | no llega al overlay |
| Re-escaneo del mismo TAG <3s | — | ignorado (dedup del provider) | R3.1 |
| Bastonazo con form CREATE/EDIT abierto | — | no abre overlay (`useBusyMode`) | R2 anti-stacking |
| Bastonazo sin rodeo en el campo (estado bloqueado) | — | listener `enabled=false` | no hay sobre qué crear; el gating de rodeo ya bloquea la app |
| Bastón desconectado | — | la app y la puerta manual siguen; chip de estado lo muestra | R2.5 manual-first |
| TAG de un animal en un campo donde el usuario NO tiene rol | `create` (cae acá) | al crear, el unique GLOBAL de `animals.tag_electronic` rechaza en commit | caso extremo (RFID únicos por SENASA); copy accionable, ya cubierto por R4.8 |

**Sobre `transfer` offline**: `lookupByTag` detecta "otro campo" sobre el set sincronizado local (todos los campos del usuario sincronizan, spec 15). El `transferAnimal` de spec 11 es **online-only** → si no hay red, el overlay muestra la situación pero el CTA transferir queda deshabilitado ("necesita conexión"). No se encola (consistente con spec 11).

---

## 7. Decisiones para Raf (Puerta 1)

| # | Decisión | Default recomendado del leader |
|---|---|---|
| **DEC-1** | Forma del overlay | **Bottom Sheet** que muestra EID + resultado + 1 CTA primario (preserva la pantalla de fondo). |
| **DEC-2** | BLE sin-match en este chunk | **Directo a CREATE** con TAG precargado (se difiere el intermediate "¿es uno de tus animales sin caravana?" de R3.3 al chunk dedup). |
| **DEC-3** | TAG activo en otro campo | **Ofrecer transferir** (spec 11, online-only) en el overlay. Alternativa: diferir y solo mostrar read-only "está en otro campo". |
| **DEC-4** | Ritmo de escaneo | **Live-rescan** (un nuevo EID actualiza el overlay abierto). Alternativa: uno-por-vez (cerrar antes del próximo). |
| **DEC-5** | Alcance de conexión | **Chip de estado mínimo** + reuso del connect web-serial; **diferir** la pantalla de pairing pulida (R9) al chunk de hardware. |

---

## 8. Gates que aplican

- **Gate 1 (security spec)**: **N/A** — frontend puro. No toca schema/RLS/Edge nuevos. El lookup usa queries existentes (PowerSync local, RLS ya gateada en spec 02/15); la transferencia usa el RPC `transfer_animal` (spec 11, ya gateado en su Gate 1/2). Igual criterio que los chunks C4/C6 de spec 02 (frontend → Gate 1 N/A).
- **Gate 2 (security code)**: **SÍ**, por run del implementer (superficie: el host BLE global + navegación + el camino de transferencia online).
- **Veto de diseño del leader** (skill `design-review`): **SÍ**, sobre el overlay (pantalla de alto impacto) antes de mostrárselo a Raf.
- **Puerta 2 (código, humana)**: Raf prueba en `pnpm web` (web-serial o el harness mock) + aprueba para `done` del chunk.

---

## 9. Plan de verificación

- **Unit**: `lookupByTag` (las 3 ramas edit/transfer/create) + la lógica de decisión de modo del host.
- **E2E Playwright** con bastón **mockeado** (el patrón de `baston-test` + `MockAdapter.connectMockEid`): (a) bastonazo a un animal existente → overlay → "Ver ficha" → ficha correcta; (b) bastonazo a un EID nuevo → overlay → "Dar de alta" → `/crear-animal` con TAG precargado; (c) bastonazo con form abierto → no abre overlay (busyMode); (d) transferencia desde el overlay (animal en otro campo) online. El caso `spp-android`/device real queda fuera (sin hardware).
- `node scripts/check.mjs` verde end-to-end.

---

## 10. Aprobación

- **Pendiente de Raf (Puerta 1)**: aprobar el scope del chunk + las 5 decisiones de §7 (o redlinear). Al aprobar, el `spec_author` foldea DEC-1..DEC-5 a requirements/design de spec 09 (sección R2 + R3.3/R3.4) marcando la opción A/B como chunk diferido, y redacta las tasks del chunk; luego arranca el `implementer` (Opus). 09 sigue `deferred` hasta cerrar todos sus chunks.
