# Review U3 — preñez duplicada al dar de alta durante una maniobra de tacto

**Veredicto: APPROVED**

Bugfix de tanda (`docs/plan-mejoras-2026-07-20.md`, Tier 1), no feature SDD. Frontend puro. Árbol sin commitear (leader coordina).
baseline_commit: 080100b399dd75467130295b5ef6abb5f7130cc1

## 1. Causa raíz — CORRECTA (los 3 puntos confirmados)
- `crear-animal.tsx:294` (antes :269) — `showPregnancy` se derivaba SOLO de la categoría
  (`categoryFields.includes('pregnancy')`), ignorando la maniobra activa. ✔
- `crear-animal.tsx:578` `pregnantCaptured = showPregnancy && isPregnantStatus(...)` → `:634-635`
  `addTacto({profileId, pregnancyStatus, eventDate})` post-create. ✔ (el alta creaba el `tacto`).
- Navegación alta→carga: `identificar.tsx` pasa el `sessionId`; al confirmar, `crear-animal` navega a
  `/maniobra/carga` y el `TactoStep` de la maniobra RE-pide preñez sobre el MISMO animal → 2º `tacto`. ✔
- La duplicación era sistemática: las 3 categorías que muestran preñez en el alta (`multipara`,
  `vaca_segundo_servicio`, `vaquillona_prenada`) ∈ `PROVEN_FEMALE_CATEGORY_CODES` → `appliesToAnimal('tacto')`
  siempre true (`maneuver-applicability.ts:175-179`). ✔

## 2. El fix NO sobre-suprime ni rompe el alta normal — OK
- `crear-animal.tsx:294` `showPregnancy = categoryFields.includes('pregnancy') && !sessionMeasuresPreg`.
- FUERA de maniobra: `maneuverSessionId===''` → el `useEffect` (`:150-158`) early-returns →
  `sessionMeasuresPreg` queda `false` → `showPregnancy` sin cambios. Cubierto por el control (B), verde.
- Fail-open: `sessionMeasuresPreg` arranca `false` y solo pasa a `true` con `r.ok && r.value` + jornada que
  mide preñez. `getSessionById` (`sessions.ts:281-287`) devuelve `ServiceResult` (no rechaza:
  `runLocalQuerySingle` captura internamente) → si la lectura falla, preñez VISIBLE = comportamiento actual,
  SIN pérdida de dato. Peor caso = el de hoy, no una regresión.
- `addTacto` post-create se suprime SOLO cuando corresponde: `pregnantCaptured = showPregnancy && ...`
  (`:578`); si `showPregnancy` sigue `true` (alta normal), el `addTacto` queda intacto → no se pierde el
  tacto del alta normal.
- Observación menor (NO bloqueante): `void getSessionById(...).then(...)` no tiene `.catch`; como
  `getSessionById` está diseñado para no rechazar, no hay unhandled-rejection en la práctica y el fail-open
  se sostiene igual. Anotado, no requiere cambio.

## 3. Oráculo del E2E — REAL (server-side)
- `countServerTactoEvents` (`admin.ts:1289+`) = `count exact head` sobre `reproductive_events`
  (`event_type='tacto'`, `deleted_at IS NULL`) — server-side, NO presencia de UI. ✔
- (A) asevera además condición + cría PRESENTES y `waitForServerTactoWithSession('large')` → no es
  "preñez desapareció de todos lados". El control (B) previene falso verde por sobre-supresión. ✔

## 4. `sessionMeasuresPregnancy` — CORRECTO
- `maneuver-config.ts:93-95`: `extractManeuvers(config).includes('tacto')`; `PREGNANCY_MANEUVER='tacto'`
  solamente. `tacto_vaquillona` (aptitud) NO cuenta → unit test explícito.
- Matchea EXACTAMENTE: las únicas categorías que muestran preñez en el alta (`animal-category-fields.ts:47,66`:
  `multipara`/`vaca_segundo_servicio`/`vaquillona_prenada`) ∈ `PROVEN_FEMALE_CATEGORY_CODES`
  (`repro-status.ts:31-36`) → la maniobra `tacto` SIEMPRE re-pide. `vaca_cabana` (PROVEN) NO muestra preñez
  en el alta → sin sobre-supresión. Ni de más ni de menos. ✔

## 5. Gate 2.5 (visual) — PASS
Corrí `prenez-alta-maniobra.capture.ts` (2/2) e inspeccioné los PNGs:
- 01 (jornada de tacto): Dientes → Condición corporal → Cría al pie, SIN campo "Estado de preñez" y SIN
  hueco de layout (transición continua). Fix quirúrgico.
- 02 (control, jornada sin tacto): "Estado de preñez" (Vacía/Cola/Cuerpo/Cabeza) presente entre condición y
  cría. Render limpio, título "Datos del animal" sin recorte.

## 6. Firmas públicas / fencing / specs
- 0 BLE, 0 reportes/vacunas, 0 RLS/migración (lectura LOCAL `getSessionById`, offline). ✔
- Sin cambios en firmas públicas EXISTENTES: `sessionMeasuresPregnancy` y `countServerTactoEvents` son
  ADICIONES nuevas. ✔
- Specs reconciliadas coherentes con el as-built: `03/requirements.md` R4.1 (nota U3), `03/design.md`
  §6.bis.9-bis, `02/design.md` cross-ref. El design NO quedó mintiendo (código ↔ spec ok). ✔

## Trazabilidad (comportamiento ↔ test)
| Comportamiento | Test | Estado |
|---|---|---|
| Helper: jornada CON tacto → mide preñez | `maneuver-config.test.ts` › "jornada CON tacto → true" | verde |
| Helper: jornada SIN tacto → no mide (control) | `maneuver-config.test.ts` › "jornada SIN tacto → false" | verde |
| Helper: `tacto_vaquillona` no cuenta | `maneuver-config.test.ts` › "tacto_vaquillona NO cuenta" | verde |
| Helper: doble-encoding / jsonb hostil no tira | `maneuver-config.test.ts` › (2 tests) | verde |
| R4.1 (U3): alta desde jornada de tacto → NO preñez → 1 solo tacto server-side | `maniobra-alta-prenez-dup.spec.ts` (A) | verde |
| R4.1 (U3): fuera de jornada de tacto sigue preguntando preñez | `maniobra-alta-prenez-dup.spec.ts` (B) | verde |
| Veto visual Gate 2.5 (ADR-029) | `captures/prenez-alta-maniobra.capture.ts` (01/02) | verde + inspeccionado |

## Verificación corrida
- Unit `maneuver-config.test.ts` → **41/41** (5 nuevos). ✔
- `pnpm typecheck` (app) → **OK**. ✔
- E2E `maniobra-alta-prenez-dup.spec.ts` → **2/2** (contra dist 09:03, más nuevo que los fuentes 08:58/08:59
  → refleja el fix; sin rebuild → 0 churn de `design/*.png`). ✔
- Capture Gate 2.5 → **2/2**, PNGs a `__shots__/` (gitignored). ✔
- NO corrí `check.mjs` full ni suites remotas (por consigna).

## Checklist RAFAQ-específico (secciones aplicables)
- **B (offline-first)**: `getSessionById` es lectura LOCAL de SQLite (offline), sin request síncrono a
  Supabase desde la pantalla. Sin conflictos nuevos (no escribe; solo lee la sesión ya sembrada). [x]
- **D (UI de campo)**: fix quirúrgico; NO agrega hueco de layout (captura 01). Botones/steppers y una decisión
  por pantalla preservados. Sin regresión de tamaños. [x]
- **A (RLS)** N/A — no toca tablas/policies (frontend puro, lectura local).
- **C (BLE)** N/A — no toca BLE.
- **E (Edge Functions)** N/A — no toca Edge Functions.

## Tasks completas: sí (T1–T4 en `[x]`, ver `progress/impl_U3-prenez-duplicada.md`).

## Cambios requeridos: ninguno.
