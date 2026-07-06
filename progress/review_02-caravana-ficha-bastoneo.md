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
