baseline_commit: ac709d2

# Impl — Delta caravana-ficha BASTONEO (spec 02, RCF.6)

**Feature**: bastonear (scan del EID por bastón) para asignar la caravana electrónica desde la FICHA del animal.
Delta Nivel B (ADR-028), extensión de `caravana-ficha`. **Frontend puro → Gate 1 N/A.** Reuso TOTAL de la
infraestructura BLE de ADR-024 (contrato de ingesta + provider global + adaptadores).

> **UX UPDATE (2026-07-06, sobre `20df0d2`).** Raf no quiso DOS afordancias separadas en la ficha (Bastonear +
> manual). **Ahora**: la ficha ofrece SOLO **"Bastonear la caravana"** para la electrónica vacía; la carga MANUAL
> por teclado se movió **DENTRO del sheet** (estado `manualMode`), detrás del link "¿Sin bastón? Cargá la caravana
> a mano" (scan/connect) y del CTA del estado manual-promovido. En `manualMode` el sheet **ignora** las lecturas
> BLE (el usuario está tipeando) SIN soltar la propiedad exclusiva del listener. Se eliminó el
> `IdentifierAssignRow kind="tag"` de la ficha y se **revirtió** el prop `hideLabel` (quedó sin uso). El `idv`
> conserva su `IdentifierAssignRow` inline en la ficha (sin cambios). Verde: typecheck 0, hardcode 0, unit 25/25
> de lo tocado, e2e/capture typecheckean, `supabase/`+`design/` sin cambios. Detalle abajo (§UX update).

## Veredicto: 🟢 VERDE

- `pnpm typecheck` (tsc --noEmit): **VERDE** (exit 0).
- Unit de lo tocado/nuevo: **219/219 VERDE** (incl. 17 del bastoneo: `listener-gate` + `maniobra-listen-state`
  + `identifier-assign` + `eid-format` + BLE suite de regresión).
- Anti-hardcode (ADR-023 §4): **0 violaciones** en app/app + app/src/components.
- `git status --porcelain supabase/`: **vacío** → **Gate 1 N/A** confirmado. `design/*.png` NO tocado.
- e2e + capture: **typecheckean** (verificado con tsconfig temporal, 0 errores en mis 2 archivos). Ejecución →
  Gate 2.5 (leader).

## El punto CRÍTICO — propiedad EXCLUSIVA del listener (el detalle clave)

La ficha suspende el listener global con `useBusyWhileMounted` (busyMode → `listening = enabled && !busy` =
false) para que un bastonazo no abra el `FindOrCreateOverlay` encima. El sheet de scan necesita lo INVERSO pero
EXCLUSIVO. Resuelto con un **"scanner acotado"** en el provider:

- **Provider** (`BleStickListenerProvider`): `scopedCount` (CONTADOR, no booleano → tolera re-montajes/StrictMode)
  → `scopedScannerActive` + `acquireScopedScanner()` (devuelve un `release` **idempotente**). `listening` pasa a
  `resolveListening({ scopedScannerActive, enabled, busy }) = scopedScannerActive || (enabled && !busy)` (módulo
  PURO `listener-gate.ts`).
- **(1) Fuerza la escucha**: un scanner acotado activo hace `listening=true` aunque busyMode esté prendido → la
  lectura entra. **Elegí esto por sobre "el sheet togglea `busy`"**: `busy` tiene un SOLO dueño
  (`useBusyWhileMounted` de la ficha); dos escritores del mismo booleano es frágil. El sheet NUNCA toca `busy`.
- **(2) El overlay IGNORA**: `FindOrCreateOverlay.onTagRead` chequea `scopedScannerActiveRef.current` y retorna
  temprano (paralelo EXACTO a `onBleOwnedRouteRef`/`BLE_OWNED_ROUTES`). La ficha no es una ruta dueña → el flag
  de contexto es la señal correcta, no la ruta. → UN solo consumidor efectivo, sin doble proceso del EID.
- **(3) Cleanup robusto**: el sheet `acquire` en un efecto (mount) / `release` en el cleanup (unmount, incl.
  back-gesture / desmontaje de la ficha). Se monta CONDICIONAL a `scanOpen` → mount/unmount mapea 1:1 al
  acquire/release. `useScopedScannerControls()` devuelve una **referencia estable** (el `acquireScopedScanner` del
  provider es `useCallback([])`; noop estable de módulo sin provider) → el efecto no thrashea.

### Verificación (a/b/c) del brief

- **(a)** con el sheet abierto, una lectura se asigna a ESTE animal y el overlay NO se abre → E2E
  `baston-ficha.spec.ts (a)`: oráculo server `waitForServerTagAssigned(profileId, eid)` + ausencia del testID
  EXCLUSIVO `find-or-create-overlay`.
- **(b)** al cerrar el sheet, la ficha re-suspende el listener → E2E `(b)` (bastonazo posterior no dispara nada)
  + unit `resolveListening` (al liberar el scanner, `listening` vuelve EXACTO a `enabled && !busy` = false con la
  ficha).
- **(c)** no queda transporte escuchando de más ni busyMode mal seteado → `release` idempotente + el `listening`
  effect apaga el transporte (`transport.disable()`) al cerrar; `busy` intacto (un solo dueño).

## Archivos tocados

**Modificados**
- `app/src/services/ble/BleStickListenerProvider.tsx` — `+scopedCount`/`scopedScannerActive`/`acquireScopedScanner`
  en `ProviderApi`; `listening` usa `resolveListening`.
- `app/src/services/ble/stick.ts` — `+useScopedScannerControls()` (ref estable).
- `app/app/_components/FindOrCreateOverlay.tsx` — guard `scopedScannerActive` en `onTagRead` + cierre defensivo +
  `testID="find-or-create-overlay"`.
- `app/src/components/IdentifierAssignRow.tsx` — `+prop hideLabel`.
- `app/app/animal/[id].tsx` — afordancia "Bastonear la caravana" (`TagScanCta`) + carga manual (piso, `hideLabel`)
  bajo un solo label; monta `TagScanSheet` condicional a `scanOpen && canAssignTag`; `+state scanOpen`.
- `app/src/components/index.ts` — export de `TagScanSheet`.
- `scripts/run-tests.mjs` — registra `listener-gate.test.ts` en la suite unit.

**Nuevos**
- `app/src/services/ble/listener-gate.ts` (+`.test.ts`) — `resolveListening` PURO (RCF.6.7) + 3 tests.
- `app/src/components/TagScanSheet.tsx` — bottom-sheet de scan acotado (ownership + hero adaptativo + confirmación
  pre-commit + assign a este animal).
- `app/e2e/baston-ficha.spec.ts` — E2E de regresión (mock), 3 tests.
- `app/e2e/captures/caravana-ficha-bastoneo.capture.ts` — capture del Gate 2.5.

## Mapa de trazabilidad (RCF.6.n → archivo:test)

| Req | Cubierto por |
|---|---|
| RCF.6.1 (afordancia "Bastonear" con tag null+activo) | `[id].tsx` (TagScanCta + canAssignTag) · e2e `baston-ficha (a)` (tag-scan-open) |
| RCF.6.2 (hero adaptativo scan/connect/manual) | `TagScanSheet` (`resolveListenConnState`) · unit `maniobra-listen-state.test.ts` · e2e `(c)` manual-promovido · capture 02/03/06 |
| RCF.6.3 (confirmación pre-commit SENASA) | `TagScanSheet.ReadConfirmation` (`formatEidReadable`) · unit `eid-format.test.ts` · e2e `(a)` (tag-scan-read + eidReadable) · capture 04 |
| RCF.6.4 (assign SOLO a este animal, fail-closed) | `TagScanSheet.onAssign` → `[id].tsx onAssignTag` · e2e `(a)` (oráculo server `waitForServerTagAssigned`) |
| RCF.6.5 (propiedad exclusiva del listener) | `listener-gate.ts` + provider `scopedScanner` + overlay guard · unit `listener-gate.test.ts` · e2e `(a)` (overlay NO abre) + `(b)` (re-suspende) |
| RCF.6.6 (manual-first piso siempre presente) | `[id].tsx` IdentifierAssignRow `hideLabel` + `TagScanSheet` link/CTA a manual · e2e `(c)` (carga manual sigue funcionando) |
| RCF.6.7 (`resolveListening` puro y testeable) | `listener-gate.ts` · `listener-gate.test.ts` |

## Capturas del capture file (`caravana-ficha-bastoneo.capture.ts`)

1. `01-afordancia-ficha-bastonear` — sección Identificación con "Bastonear la caravana" + carga manual.
2. `02-sheet-conectar` — sheet abierto, transporte conectable → hero "Conectá el bastón".
3. `03-sheet-escaneando` — conectado (connectMock) → hero "Acercá el bastón al animal".
4. `04-lectura-confirmacion` — lectura recibida → confirmación pre-commit (EID legible + "Asignar caravana").
5. `05-post-asignacion-readonly` — post-asignación: caravana en la ficha en solo-lectura (afordancia read-only).
6. `06-sheet-manual-promovido` — sin transporte → hero neutro "El bastón no está disponible…" + CTA a manual.

## Autorrevisión adversarial

Busqué (y cerré / verifiqué):
- **Ownership / carrera del overlay**: una lectura sólo llega tras `transport.enable()` (post-render del acquire),
  cuando `scopedScannerActiveRef.current` ya es true → el overlay ignora. Sin ventana de carrera (React batchea
  el acquire + refs se actualizan en el mismo commit; el read viene de un efecto posterior).
- **Fuga del contador**: `release` con guard `released` (idempotente) + clamp `Math.max(0, c-1)`. StrictMode
  (mount→cleanup→mount) queda balanceado. Verificado por diseño + `listener-gate.test.ts`.
- **`busy` compartido**: descartado tocar `busy` desde el sheet (dos escritores frágiles); el scanner acotado no
  lo toca → al soltar, `listening` vuelve EXACTO a `enabled && !busy` (unit lo asevera).
- **Doble-assign / stale-assign**: `assigningRef` bloquea reads nuevos durante el assign; `onAssign` usa el
  `readEid` del closure (dep) → asigna el EID confirmado; Button `disabled={assigning}`.
- **Dup / fail-closed**: reusa el `onAssignTag` del host (pre-check `lookupByTag(detail.establishmentId)` — NUNCA
  el contexto activo, multi-tenant) → dup → error inline, sheet abierto. Un EID que matchea otro animal → dup.
- **Degradación sin transporte**: `transport==null` → `manual` → prompt neutro + deriva a la carga manual (no es
  botón muerto). El piso manual (IdentifierAssignRow) sigue en la ficha (existing e2e intacto).
- **No romper lo existente**: `listening` con `scopedScannerActive=false` ≡ `enabled && !busy` (comportamiento
  idéntico) → baston/find-or-create/maniobra sin regresión (BLE suite 219/219). El testID nuevo del overlay no
  afecta asserts por texto.
- **Oráculo E2E**: "overlay no abrió" por ausencia del testID EXCLUSIVO (no por ausencia de texto — memoria del
  proyecto). "assign persistió" server-side (no la ficha, que es lectura local no-reactiva).

## Reconciliación de specs (in-place, al as-built)

- `context-caravana-ficha.md` — revertido el "bastoneo DEFERIDO" → INCLUIDO (nota de reconciliación + caso #4
  tachado/reconciliado + "Entra: bastoneo").
- `requirements-caravana-ficha.md` — nota de reconciliación en el header + RCF.1.6 (superada por RCF.6) + **bloque
  RCF.6** nuevo (6.1–6.7) + trazabilidad + cobertura de tests + historial.
- `design-caravana-ficha.md` — tabla de archivos ampliada + **§10 Bastoneo** (ownership exclusivo, sheet, ficha,
  degradación, verificación a/b/c) + 2 alternativas descartadas nuevas (togglear `busy` / refactor de heroes).
- `tasks-caravana-ficha.md` — T16–T22 `[x]` (bastoneo).

## UX update (2026-07-06) — carga manual movida DENTRO del sheet

**Qué cambió** (sobre `20df0d2`, árbol limpio):
- **Ficha `[id].tsx`**: eliminado el `<IdentifierAssignRow kind="tag">` (manual de la electrónica). La electrónica
  vacía muestra ahora SOLO el label "Caravana electrónica" + `<TagScanCta>` ("Bastonear la caravana"). Imports
  `sanitizeTagInput`/`TAG_ELECTRONIC_LENGTH`/`isValidTagElectronic` removidos de `[id].tsx` (los usa ahora el
  sheet). `onAssignTag` intacto (lo consume el sheet). El `idv` sin cambios (su `IdentifierAssignRow` inline queda).
- **`TagScanSheet.tsx`**: `+estado manualMode` + `+manualModeRef` + sub-componente `ManualTagEntry` (FormField
  numérico → `sanitizeTagInput` en vivo, `maxLength=TAG_ELECTRONIC_LENGTH`; valida `isValidTagElectronic && len===15`
  con la copy "La caravana electrónica tiene que tener 15 dígitos." ANTES de asignar; `onAssignTag(value)` — MISMO
  path que el BLE; [Asignar caravana] / [Volver]). Links "¿Sin bastón?" agregados a `ScanHero` + `ConnectHero`; el
  CTA de `ManualPromptHero` y los links → `setManualMode(true)` (ya no `onClose`). `onTagRead` ignora las lecturas
  si `manualModeRef.current` (el usuario tipea) — el scoped scanner **sigue activo** (ownership intacto). Importa
  `FormField` + los helpers de `animal-input`.
- **`IdentifierAssignRow.tsx`**: revertido el prop `hideLabel` (quedó sin uso tras sacar el row de la electrónica).
- **e2e `baston-ficha.spec.ts (c)`**: reescrito — la ficha NO ofrece manual directo de la electrónica; sin
  transporte → sheet → tap "Cargar la caravana a mano" → carga manual DENTRO del sheet: 14 díg = error inline, 15
  díg → asigna (oráculo server `waitForServerTagAssigned`) + sheet cierra. Tests (a)/(b) (ownership) SIN cambios.
- **capture**: 01 = ficha solo-bastonear; `+07-sheet-carga-manual` (el FormField dentro del sheet). Total 7 shots.

**Cómo se ve el manual dentro del sheet**: header "Bastonear la caravana" (fijo) → en scan/connect un link discreto
"¿Sin bastón? Cargá la caravana a mano"; al tocarlo (o el CTA "Cargar la caravana a mano" del estado sin-bastón) la
vista del sheet pasa a un `FormField` "Caravana electrónica" (teclado numérico, placeholder "982 0001 2345 6789") +
[Asignar caravana] primario + [Volver] secundario. Error inline en rojo bajo el campo. Éxito → cierra el sheet
(optimismo → fila read-only).

**Números (UX round)**: typecheck 0 · anti-hardcode 0 · unit 25/25 de lo tocado (incl. `animal-input` que cubre la
validación del sheet) · e2e + capture typecheckean (0 errores en mis archivos) · `git status supabase/`+`design/`
vacío (Gate 1 N/A, sin re-render de PNGs).

## Notas para el leader

- **Gate 2.5**: correr `pnpm exec playwright test e2e/captures/caravana-ficha-bastoneo.capture.ts --config
  playwright.capture.config.ts --workers=1` → **7 capturas** (01 ficha solo-bastonear · 02 conectar · 03 escaneando
  · 04 lectura+confirmación · 05 post-asignación read-only · 06 manual-promovido · 07 carga manual dentro del
  sheet). Vetar diseño (anti-recorte de descendentes en "Cargá…" con 'g'; sheet anatomy; manga-friendly; es-AR).
- **As-built de layout (UX Raf 2026-07-06)**: la ficha ofrece SOLO "Bastonear la caravana" para la electrónica; la
  carga manual por teclado vive DENTRO del sheet (detrás de "¿Sin bastón?"). El `idv` conserva su carga manual
  inline en la ficha.
- NO commiteado. NO toqué `feature_list.json` ni `current.md` (per instrucción).
