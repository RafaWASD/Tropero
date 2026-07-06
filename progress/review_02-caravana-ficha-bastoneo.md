# Review — delta caravana-ficha BASTONEO (spec 02, RCF.6)

**Reviewer**: reviewer (Opus 4.8) · **Fecha**: 2026-07-06 · **Baseline**: `ac709d2` (sin commitear)
**Alcance**: extensión de `caravana-ficha`, Nivel B (ADR-028), frontend puro, Gate 1 N/A.

## Veredicto: APPROVED

El punto load-bearing (propiedad EXCLUSIVA del listener) cierra en los 3 ejes. Verificación verde, specs
reconciladas al as-built, trazabilidad completa.

---

## FOCO #1 — No double-processing (con el sheet abierto, la lectura va al sheet y el overlay NO abre)

PASS. El provider entrega el EID a TODOS los suscriptores (`handleReading` → loop `tagSubscribersRef`,
`BleStickListenerProvider.tsx:177`); el sheet lo consume (`TagScanSheet.onTagRead`) y el
`FindOrCreateOverlay` se auto-suprime:
- `FindOrCreateOverlay.tsx:150` `if (scopedScannerActiveRef.current) return;` — retorno temprano en PARALELO
  EXACTO a `onBleOwnedRouteRef.current` (`:147`). El flag de contexto es la señal correcta (la ficha no es
  `BLE_OWNED_ROUTE`). Ref actualizada por render (`:120`).
- Anti-stacking defensivo: `FindOrCreateOverlay.tsx:207` cierra el overlay si un scanner acotado se activa con
  el overlay ya abierto.
- Oráculo E2E por AUSENCIA del testID EXCLUSIVO: `baston-ficha.spec.ts:114`
  `expect(getByTestId('find-or-create-overlay')).toHaveCount(0)` (no por ausencia de texto — regla del proyecto).
  El testID solo se renderiza con `state !== null` (`FindOrCreateOverlay.tsx:215`) → si nunca abrió, count 0.

## FOCO #2 — Sin estado colgado (al cerrar vuelve EXACTO a enabled && !busy; sheet nunca escribe busy)

PASS.
- `resolveListening = scopedScannerActive || (enabled && !busy)` — módulo PURO `listener-gate.ts:29`.
- Provider: contador `scopedCount` (`BleStickListenerProvider.tsx:107`), `acquireScopedScanner` devuelve
  release IDEMPOTENTE (guard `released` + clamp `Math.max(0, c-1)`, `:132-144`). `useCallback([])` → ref estable.
- Sheet: acquire en efecto de mount / release en cleanup (`TagScanSheet.tsx:61-64`), montado CONDICIONAL a
  `scanOpen && canAssignTag` (`[id].tsx:1034`) → mount/unmount mapea 1:1 al acquire/release (cubre back-gesture
  y desmontaje abrupto de la ficha). `useScopedScannerControls` estable (noop de módulo sin provider, `stick.ts:112`).
- Efecto `listening` apaga el transporte al soltar: `BleStickListenerProvider.tsx:211` `if (listening) enable()
  else disable()`. Al liberar con la ficha en busy → `resolveListening(false,true,true)=false` → `disable()`.
- El sheet NUNCA escribe `busy`: `TagScanSheet` no llama `useBusyMode`/`setBusy` (grep limpio). Único dueño =
  `useBusyWhileMounted()` de la ficha (`[id].tsx:129`).
- `listener-gate.test.ts` (3/3): eje enabled+busy (sin scoped), eje scoped forzando incl. **scoped+busy** (el
  caso que fuerza la escucha, `:21`), e invariante de release vuelve a `enabled && !busy` (`:28-34`). Cubre los
  3 ejes + la combinación pedida.

## FOCO #3 — No regresión del flujo global

PASS. Cambio ADITIVO: con `scopedScannerActive=false`, `resolveListening ≡ enabled && !busy` (comportamiento
idéntico al previo). Las ramas existentes de `FindOrCreateOverlay.onTagRead` no se alteraron (solo un check
más antes). Suite BLE + módulos tocados: 225/225 verde. El testID nuevo del overlay no afecta asserts por texto.

---

## Trazabilidad R<n> ↔ test

| Req | Test/evidencia |
|---|---|
| RCF.6.1 (afordancia con tag null+activo) | `[id].tsx` TagScanCta+canAssignTag · e2e `baston-ficha (a)` `tag-scan-open` |
| RCF.6.2 (hero adaptativo scan/connect/manual) | `TagScanSheet` `resolveListenConnState` · `maniobra-listen-state.test.ts` (4/4) · e2e `(c)` |
| RCF.6.3 (confirmación pre-commit SENASA) | `TagScanSheet.ReadConfirmation`+`formatEidReadable` · `eid-format.test.ts` · e2e `(a)` `tag-scan-read`+eidReadable |
| RCF.6.4 (assign SOLO a este animal, fail-closed) | `onAssignTag(detail.profileId,…)` `[id].tsx:644` · e2e `(a)` oráculo server `waitForServerTagAssigned` |
| RCF.6.5 (propiedad exclusiva del listener) | `listener-gate.ts`+provider scoped+overlay guard · `listener-gate.test.ts` · e2e `(a)`+`(b)` |
| RCF.6.6 (manual-first piso siempre) | `IdentifierAssignRow hideLabel` `[id].tsx:867` + link/CTA en sheet · e2e `(c)` |
| RCF.6.7 (`resolveListening` puro) | `listener-gate.ts` · `listener-gate.test.ts` (3/3) |

(RCF.1–RCF.5 del delta manual previo ya cubiertos; sin regresión.)

## Tasks completas: SÍ

T1–T22 en `[x]`. T16–T22 (bastoneo) verificadas contra el código. Ninguna `[ ]`.

## Exactitud specs (código → spec): OK

Reconciliación al as-built completa y sin contradicción:
- `context`: caso #4 revertido de "DEFERIDO" a INCLUIDO (bastoneo entra).
- `requirements`: RCF.6 (6.1–6.7) agregado + RCF.1.6 reconciliada (superada por RCF.6, `visual_id_alt` sigue sin afordancia).
- `design`: §10 (ownership exclusivo, sheet, degradación, verificación a/b/c) + 2 alternativas descartadas.
- `tasks`: T16–T22.
El design describe lo que el código hace (scanner acotado, contador, resolveListening puro, degradación neutra).

## CHECKPOINTS

- C1 [x] · C2 [x] · C3 [x] (capas previstas; sin logs debug; sin establishment_id hardcodeado) · C4 [x]
  (listener-gate.test.ts + identifier-assign + eid-format; runner >0 verde)
- C6 [x] (3 archivos de spec + EARS + tasks [x] + cada RCF con test) · C7 [N/A] (no toca DB; tenant derivado
  de `detail.establishmentId`) · C8 [x] (assign encola offline-safe por outbox; no requests síncronos desde
  pantalla; conflicto = unique/RPC server-side)
- C9 [x] (UI): `baston-ficha.spec.ts` (regresión, 3 tests) + `caravana-ficha-bastoneo.capture.ts` (6 capturas
  nombradas); `__shots__` gitignoreado; Gate 2.5 (E2E + veto visual) lo corre el leader.

## Checklist RAFAQ-específico

- **A. RLS/multi-tenancy** — N/A (sin tablas nuevas). Nota: pre-check `lookupByTag(trimmed, detail.establishmentId)`
  usa el establishment del PERFIL, nunca el contexto activo (`[id].tsx:625`, anti-IDOR correcto).
- **B. Offline-first** — [x] assign encola offline (outbox → RPC), no bloquea; [x] no requests síncronos a
  Supabase desde la pantalla (usa `assignTagToAnimal`/`lookupByTag`); [x] conflicto server-side (unique global +
  authz RPC); bucket N/A (`animals` fuera del sync set, ADR-026 — es la asimetría documentada).
- **C. BLE** — [x] desconexión → degradación manual-promovida neutra (hero + CTA); [x] fallback manual ≤1 tap
  (link "Cargá a mano" + IdentifierAssignRow piso); [x] correlación TAG↔peso N/A (no hay peso); [x] logs BLE no
  bloquean (`logTransportEvent`/feedback best-effort).
- **D. UI campo** — [x] targets `$touchMin` (TagScanCta, CTAs, discos); [x] fonts hero ≥ `$7`; [x] una decisión
  por pantalla (sheet = un scan/confirmación); [x] loading visible ("Asignando…"). lineHeight matching en TODO
  heading incl. "Cargá" ('g', `$7/$7`). Anti-hardcode 0.
- **E. Edge Functions** — N/A.

## Verificación

- `tsc --noEmit` (client): **VERDE** (exit 0).
- Unit módulos tocados: **181/181**; suite BLE + tocados: **225/225** (incl. `listener-gate` 3/3). **0 fail**.
- Anti-hardcode (ADR-023 §4): **0 violaciones**.
- e2e/capture typecheck: **0 errores** en `baston-ficha.spec.ts` y `caravana-ficha-bastoneo.capture.ts`. Único
  error de tsc = `e2e/helpers/admin.ts:1742` (cast del cliente Supabase en `waitForServerTagAssigned`),
  **preexistente** (existe en baseline `ac709d2`, admin.ts sin tocar por el delta) y en helper de test, no en
  código de app → no bloquea. Oráculos correctos (ausencia de testID exclusivo; server-side para persistencia).
- Gate 1 N/A: `git status supabase/` vacío. Sin `design/*.png` en el diff. `e2e:build` NO corrido (Gate 2.5 leader).

## Cambios requeridos

Ninguno.

---

# UX update (2026-07-06) — carga manual movida DENTRO del sheet

**Reviewer**: reviewer (Opus 4.8) · **Fecha**: 2026-07-06 · **Baseline**: `20df0d2` (ajuste sin commitear)
**Alcance**: ajuste de UX acotado sobre el delta bastoneo. La ficha ofrece SOLO "Bastonear la caravana"; la
carga manual del EID por teclado se movió DENTRO del sheet (estado `manualMode`).

## Veredicto: APPROVED

Ajuste PURAMENTE ADITIVO en la UI del sheet. La maquinaria de ownership (el punto load-bearing) NO se tocó; el
input manual valida bien (15 díg, fail-closed) por el MISMO `onAssignTag` que el BLE. Verde en todo.

## 1. Ficha (`[id].tsx`, seccion Identificacion) — PASS

- `IdentifierAssignRow kind="tag"` ELIMINADO. Con `tagElectronic == null` + activo, la electronica muestra solo
  el label "Caravana electronica" + `TagScanCta` (`[id].tsx:855-861`). Ternario read-only / "—" intacto.
- `IdentifierAssignRow kind="idv"` INTACTO (`[id].tsx:873-882`, sin `hideLabel`, con su label propio).
- Imports colgados: NO. Linea 65 quedo `import { IDV_MAX_LENGTH, sanitizeIdvInput }` — se removieron
  `TAG_ELECTRONIC_LENGTH`/`isValidTagElectronic`/`sanitizeTagInput` (ahora viven en el sheet). Grep confirma 0
  referencias residuales a esos 3 simbolos en `[id].tsx`.
- `onAssignTag` intacto (`[id].tsx:613`) y pasado al sheet (`[id].tsx:1014`). Sheet montado condicional a
  `scanOpen && canAssignTag(detail)` — sin cambios.
- `hideLabel` REVERTIDO en `IdentifierAssignRow.tsx`: prop removido del type, del destructure y del render. Sin
  uso residual.

## 2. Sheet (`TagScanSheet.tsx`, `ManualTagEntry`) — PASS

- `manualMode` state + `manualModeRef` (`:77,83-84`). Render: `manualMode ? ManualTagEntry : readEid ?
  ReadConfirmation : hero…` (`:187-203`).
- `ManualTagEntry` (`:374-442`): `FormField` numerico (`number-pad`, `maxLength=TAG_ELECTRONIC_LENGTH`,
  `handleChange`→`sanitizeTagInput` en vivo ≤15) + [Asignar caravana] + [Volver].
- Valida 15 dig ANTES de asignar (`:396`): `isValidTagElectronic(value) && value.trim().length ===
  TAG_ELECTRONIC_LENGTH`, misma copy que el alta; recien despues `onAssignTag(value)` — MISMO callback que el BLE
  (dup pre-check + RPC + optimismo, `[id].tsx:613`).
- Fail-closed (`:404-408`): `!r.ok` → `setBusy(false)` + `setError`, sheet ABIERTO, retryable (`handleChange`
  limpia el error). Exito → `onClose()`. `disabled={busy}` en ambos botones + guard `if (busy) return`.
- "Volver" = `onBack` = `exitManual` = `setManualMode(false)` → vuelve al estado de scan (readEid sigue null en
  manual → sin confirmacion fantasma al volver).
- Links "¿Sin baston?" (ScanHero+ConnectHero) y CTA (ManualPromptHero) → `enterManual` (setManualMode(true),
  `:198,200,202`). `ConnectHero.onManual` paso de `onClose` a `enterManual` — correcto.

## 3. Ownership INTACTO (load-bearing) — PASS

- En `manualMode` se IGNORAN las lecturas BLE: `onTagRead` (`:89-93`) `if (assigningRef.current ||
  manualModeRef.current) return;` — el scoped scanner NO se suelta.
- Acquire/release del scoped scanner atado a mount/unmount del sheet SIN cambios (`:66-70`). El diff no lo toca.
- `resolveListening`/`listener-gate.ts`/provider/`stick.ts`/`FindOrCreateOverlay.tsx` FUERA del diff (0 cambios)
  → supresion del overlay por el flag + maquina de escucha identicas. Aditivo puro, como pedia el brief. FOCO
  #1/#2/#3 de la review original siguen validos.

## 4. e2e (`baston-ficha.spec.ts`) — PASS

- (a)/(b) ownership SIN cambios.
- (c) reescrito (`:164-205`): ficha NO ofrece manual directo (`getByRole('button',{name:'Agregar caravana
  electronica'})` → `toHaveCount(0)`, `:177`); abre sheet → manual-promovido → tap `tag-scan-to-manual` →
  `tag-scan-manual` VISIBLE (NO cerro, `:187`); 14 dig → `tag-scan-manual-assign` → error inline + sigue en
  manual (`:192-195`); 15 dig → assign → sheet cierra (`:200-201`) + oraculo server `waitForServerTagAssigned`
  (`:204`). Sin asserts del row manual viejo en la ficha.
- Capture: 01 = ficha solo-bastonear; `+07-sheet-carga-manual`. 7 shots.

## 5. Verificacion (UX round)

- `tsc --noEmit` (client): VERDE (exit 0).
- Unit de lo tocado: 25/25 (`animal-input` [validacion del sheet] + `listener-gate` 3/3 + `maniobra-listen-state`
  4/4 + `eid-format` + `identifier-assign`). 0 fail.
- Anti-hardcode (ADR-023 §4): 0 violaciones.
- e2e/capture typecheck: 0 errores en `baston-ficha.spec.ts` y el capture (unico error de tsc = `admin.ts:19`
  [ws types, artefacto de mi config temporal] + `admin.ts:1742` [cast Supabase], ambos PREEXISTENTES en un helper
  de test SIN tocar por el delta). `seedAnimal` (retorna `profileId`) y `waitForServerTagAssigned` verificados en
  `admin.ts:850/923/1728`.
- `git diff supabase/` vacio → Gate 1 N/A. Sin `design/*.png` en el arbol. `e2e:build` NO corrido (Gate 2.5 leader).

## Trazabilidad reconciliada (as-built del ajuste)

- RCF.6.1 (unica afordancia "Bastonear" en la ficha) ↔ `[id].tsx:855-861` · e2e (c) `toHaveCount(0)` + (a).
- RCF.6.6 (manual-first DENTRO del sheet: link/CTA → `ManualTagEntry`, valida 15 dig, MISMO `onAssignTag`, ignora
  lecturas en manual sin soltar el scanner) ↔ `TagScanSheet.tsx:187-203,374-442` + guard `:90` · e2e (c) · unit
  `animal-input`.
- RCF.2.1–RCF.2.7 (contenedor movido al sheet; logica identica) ↔ `ManualTagEntry` + `onAssignTag` · e2e (c).

## Exactitud specs (codigo → spec): OK

- `context`: §Alcance — electronica = SOLO "Bastonear" en la ficha, manual DENTRO del sheet; idv sin cambios.
- `requirements`: RCF.6.1 (unica afordancia) + RCF.6.6 (manual dentro del sheet + ignora lecturas) reescritos +
  nota en RCF.2 + cobertura (c) actualizada.
- `design`: tabla de archivos sin fila `hideLabel` + §10.2 (ManualTagEntry) + §10.3/§10.4 + alternativa "manual
  en sheet" = default de la electronica.
- `tasks`: T20 + **T20b** (UX Raf) + T21/(c) + T22 (7 capturas), todas `[x]`.
El design NO quedo mintiendo: describe `ManualTagEntry`, el guard `manualModeRef`, la validacion y el reuso de
`onAssignTag`.

## Observacion (NO bloqueante)

El guard "ignorar lecturas BLE mientras se tipea" (`onTagRead` con `manualModeRef`) no tiene test dedicado (el
e2e (c) corre SIN transporte → no puede inyectar un bastonazo en manual). RCF.6.6 en su conjunto SI esta cubierto
(manual reachable + valida + asigna). El guard es un early-return trivial y la maquinaria de ownership esta bien
testeada → no bloquea. Mejora futura: un e2e con transporte (`gotoWithBle`) que entre a manual e inyecte un
bastonazo, asertando `tag-scan-read` ausente y `tag-scan-manual` visible.

## Cambios requeridos (UX update)

Ninguno.
