# impl — Delta PARTO: RODEO + CARAVANA VISUAL DEL TERNERO (#4 / #1a) — spec 02

baseline_commit: e178851ba994759edb055aae2bd708a8ab423791

**Feature en curso**: delta `parto-rodeo-caravana` sobre spec 02 (`in_progress`), Nivel B (ADR-028), frontend-only.
**Spec**: `specs/active/02-modelo-animal/{requirements,design,tasks,context}-parto-rodeo-caravana.md` (`RPRC.<n>`).

## Plan (T1–T17)
- T1 — ficha `goToAddEvent`: pasar `rodeoId`/`rodeoName` de la madre (seed/fallback del nombre).
- T2 — helpers puros + tests (`utils/calf-birth.ts` + `.test.ts`).
- T3–T6 — picker de rodeo a nivel parto (estado, render, leyenda, fallback no-editable).
- T7–T9 — caravana visual single-calf + nota mellizos + no-regresión tag por ternero.
- T10–T11 — wiring a `registerBirth` + validación server-side documentada.
- T12–T14 — MUSTs UI + callers + frontend-only.
- T15–T16 — capture file + E2E regresión.
- T17 — reconciliación + mapa RPRC → test.

## Decisión de criterio (veto leader #1): resolución del rodeo de la madre
**Camino elegido: READ LOCAL del perfil de la madre (uniforme para todos los callers, offline) + params de la ficha como seed/fallback del NOMBRE.**
- El único caller real de `agregar-evento` con `eventType='birth'` es la ficha (`animal/[id].tsx goToAddEvent`) — la maniobra (`app/maniobra/*`) NO rutea a `agregar-evento` para parto (grep confirmado: solo eventos sanitarios/tacto en su propio flujo). RPRC.5.3 se cumple porque hay una sola pantalla.
- `rodeoId`/`systemId` de la madre → read local vía `fetchMotherRodeoContext(profileId)` (reusa `buildBirthOverlayContextQuery`, el MISMO que usa `registerBirth`). Funciona para cualquier caller que pase `profileId` (ya es param obligatorio), 100% offline.
- El NOMBRE del rodeo sale de `useRodeo().available` (caso común, campo activo) ?? param `rodeoName` (fallback cross-field / optimista) ?? '—'. Por eso wireo igual el param en la ficha (T1) — seed inmediato sin flash + nombre en el fallback RPRC.1.8.
- `systemId` fallback: `motherCtx?.systemId ?? resolveMotherSystemId(available, motherRodeoId)` — así el helper `resolveMotherSystemId` (design §6) queda usado y testeado.

## Tasks T1–T17 — todas [x] en `tasks-parto-rodeo-caravana.md`
- T1 ficha params (seed/fallback nombre) · T2 helpers puros + 17 tests · T3–T6 picker rodeo (estado+read local, render, leyenda, fallback no-editable) · T7–T9 caravana visual single + nota mellizos + no-regresión tag por ternero · T10 wiring registerBirth · T11 validación server-side documentada · T12–T14 MUSTs UI / callers / frontend-only · T15 capture file · T16 E2E regresión · T17 reconciliación.

## Archivos tocados
- `app/src/utils/calf-birth.ts` (NUEVO) + `calf-birth.test.ts` (NUEVO, 17 casos) — helpers puros.
- `app/src/services/events.ts` — `fetchMotherRodeoContext(profileId)` (read local, reusa `buildBirthOverlayContextQuery`).
- `app/app/agregar-evento.tsx` — estado + read local + derivaciones + `CalfRodeoPicker`/`RodeoOptionRow` + campo idv/nota en `PartoForm` + wiring en `onSubmit` birth.
- `app/app/animal/[id].tsx` — `goToAddEvent` pasa `rodeoId`/`rodeoName` (seed/fallback nombre).
- `app/e2e/events.spec.ts` — test de regresión "delta parto-rodeo-caravana" (+ import `seedRodeo`).
- `app/e2e/captures/parto-rodeo-caravana.capture.ts` (NUEVO) — Gate 2.5, 4 capturas.
- `scripts/run-tests.mjs` — registra `calf-birth.test.ts`.
- Specs reconciliadas: `{requirements,design,tasks}-parto-rodeo-caravana.md`.
- `supabase/` — **INTACTO** (frontend-only, RPRC.5.1).

## Mapa de trazabilidad RPRC.<n> → test/evidencia
| RPRC | Cobertura |
|---|---|
| 1.1 picker aparece en parto | E2E `events.spec.ts` ('Rodeo del parto' visible) + capture `01` |
| 1.2 preselecciona rodeo madre | read local `fetchMotherRodeoContext` + E2E (trigger+leyenda) + capture `01` |
| 1.3 leyenda si coincide | E2E (leyenda visible) + captures `01`/`03` |
| 1.4 leyenda desaparece al cambiar | E2E (`toHaveCount(0)` tras elegir Destete) + capture `04` |
| 1.5 editar a otro rodeo mismo sistema | E2E (elegir Destete) + unit `eligibleCalfRodeos`/`canEditCalfRodeo` + capture `03` |
| 1.6 NO ofrece otro sistema | unit `eligibleCalfRodeos: NO ofrece rodeos de otro sistema` |
| 1.7 aplica a toda la camada | code (calfRodeoId escalar) + unit + E2E (picker sigue con mellizos) |
| 1.8 fallback no-editable | unit `canEditCalfRodeo: madre de OTRO campo → NO editable` / `sin elegibles` + code (trigger estático) |
| 2.1 campo idv con 1 ternero | E2E (idv field visible single) + capture `01` |
| 2.2 sanitizeIdvInput en vivo | code (`onCalfIdv=sanitizeIdvInput`) + E2E (leading `0` conservado, sin clamp) |
| 2.3 oculta idv con ≥2 | E2E (`toHaveCount(0)` mellizos) + capture `02` |
| 2.4 nota mellizos | E2E (nota visible) + capture `02` |
| 2.5 tag electrónico por ternero | no-regresión E2E mellizos + capture `02` (caravana electrónica en card) |
| 3.1 calfRodeoId efectivo → registerBirth | E2E (ternero en "Destete", NO en rodeo madre) + unit `resolveEffectiveCalfRodeoId` |
| 3.2 calfIdv con 1 ternero | E2E (ternero aparece por su idv) + unit `calfIdvForSubmit` |
| 3.3 NO calfIdv con ≥2 | unit `calfIdvForSubmit: ≥2 → null` |
| 3.4 no altera resto payload | code (solo agrega calfRodeoId/calfIdv) + no-regresión E2E partos |
| 4.1/4.2 validación server-side | N/A cliente — RPC `register_birth` 6-arg YA deployado valida rodeo (activo/tenant/sistema→`23514`) + idv (único/inmutable→`23505`); el cliente no re-implementa (T11) |
| 4.3 rechazo permanente offline | as-built `uploadData`/`upload-classify` clasifica `23514`/`23505` como permanente (sin código nuevo, T11) |
| 4.4 offline-first | read local `useRodeo` (SQLite) + `fetchMotherRodeoContext` (SQLite) + escritura por outbox `registerBirth` (sin red nueva) |
| 5.1 frontend-only | `git diff supabase/` vacío (T14) |
| 5.2 no romper resto form | no-regresión E2E (parto no-preñada/preñada verdes; mellizos flaky pre-existente confirmado) |
| 5.3 ficha + maniobra un cambio | grep: único caller `agregar-evento birth` = ficha; maniobra NO rutea a parto; read local uniforme |
| 6.1 reúso patrón #15 | code (`CalfRodeoPicker`/`RodeoOptionRow` espejan `LinkCalfPrompt` `:723-773`/`:824-844`; `sanitizeIdvInput`; `useRodeo`) |
| 6.2 tokens + es-AR | `check.mjs --fast` anti-hardcode **0 violaciones** + copy es-AR en capturas |
| 6.3 anti-recorte | capturas `01`-`04` (leyenda/nota/labels/trigger sin recorte; lineHeight matcheado en Text con numberOfLines) |
| 6.4 validación inline conservada | no-regresión E2E; sin banner global nuevo (el picker/idv no agregan validación client-side) |
| 7.1 capture file | `parto-rodeo-caravana.capture.ts` → 4 capturas nombradas (05 N/A documentado) |
| 7.2 E2E regresión | `events.spec.ts` "delta parto-rodeo-caravana" (verde) |
| 7.3 mapa trazabilidad | esta tabla |

## Verificación (números reales)
- **typecheck** (`cd app && pnpm typecheck`): **limpio** (0 errores), incluye e2e.
- **unit helpers** (`node --test app/src/utils/calf-birth.test.ts`): **17/17 pass**.
- **check.mjs --fast**: anti-hardcode ADR-023 §4 → **0 violaciones** en `app/app` + `app/src/components`.
- **E2E regresión** (`playwright test -g "delta parto-rodeo-caravana"`): **1 passed** (tras fix de 1 aserción: `.filter({visible:true})` en la última — instancia stale del stack web, no producto).
- **E2E no-regresión partos**: "parto en hembra NO preñada" + "PREÑADA" → **2 passed**. "parto con mellizos" → **flaky** (pasó en retry; falla en la ÚLTIMA aserción de re-navegación calf→madre en el stack web = flake pre-existente documentado `events:282`, NO regresión — los mellizos se crean OK).
- **Capture Gate 2.5** (`playwright ... --config playwright.capture.config.ts`): **1 passed**, **4 capturas** generadas (`01`-`04`, 412×915) en `app/e2e/captures/__shots__/parto-rodeo-caravana/` (gitignored). Inspección visual del implementer: picker+leyenda+idv (01), mellizos sin idv + nota terracota (02), picker abierto con "Rodeo general" seleccionado (✓) + "Destete" (03), cambiado a "Destete" sin leyenda (04). Sin recortes. Nota cosmética no-bloqueante: los nombres de rodeo del SEED de test traen el prefijo `RUN_TAG` (largos, truncados con ellipsis) — artefacto de test, no de producto (en prod "Rodeo general"/"Destete" son cortos; mismo caso que la capture de #15).
- **`git diff supabase/`**: **vacío** (T14) — frontend-only confirmado.

## Autorrevisión adversarial (paso 8)
Releí el diff como revisor hostil:
1. **Wiring real end-to-end**: el picker está montado en `PartoForm` y el rodeo llega a `registerBirth` — CONFIRMADO por E2E: el ternero creado aparece en el rodeo **"Destete"** (el elegido en el picker), NO en el "Rodeo general" de la madre → `calfRodeoId` viajó de verdad; y aparece por **su idv** → `calfIdv` viajó. No es un test que pasa por la razón equivocada.
2. **Ambos callers**: verifiqué por grep que el ÚNICO caller de `agregar-evento` con `eventType='birth'` es la ficha; la maniobra (`app/maniobra/*`) NO rutea a parto. El read local (`fetchMotherRodeoContext` sobre `profileId`, ya param obligatorio) resuelve el rodeo **uniforme para todo caller y offline** — no depende de que el caller pase el param (elegí el camino que vetó el leader #1). Params conservados solo como seed/fallback del nombre.
3. **`effectiveCalfRodeoId` degradado**: si el read local y el param fallan (`motherRodeoId=null`), se pasa `calfRodeoId=null` → `events.ts` omite `p_calf_rodeo_id` → el RPC usa el rodeo real de la madre (as-built). Sin regresión, sin romper el form (fallback RPRC.1.8).
4. **`system_id` es catálogo GLOBAL** (mismo UUID de 'cría' entre tenants) → el filtro por sistema solo NO excluiría los rodeos del campo activo para una madre de otro campo. Lo cubre el guard `canEditCalfRodeo` (la madre debe figurar entre los elegibles del campo activo) → fallback no-editable. Testeado explícito (`canEditCalfRodeo: madre de OTRO campo → NO editable`).
5. **idv descartado con mellizos**: si el operario tipea idv (single), agrega un mellizo y guarda → `calfIdvForSubmit(2, idv)=null` → no se envía (RPRC.3.3). Si quita el mellizo, el idv tipeado vuelve (buena UX, no bug). Testeado.
6. **Recorte de descendentes**: capturas con "Rodeo del parto" ('p'), "después"/"opcional" ('p') y "(Mismo rodeo que la madre)" renderizan sin recorte; lineHeight matcheado en todo Text con `numberOfLines`. No agregué ningún heading ≥$6 nuevo.
7. **Hardcode de tokens**: `check.mjs --fast` 0 violaciones; el color del `Check`/`ChevronDown` cruza vía `getTokenValue`/prop `muted`.
8. **No-regresión del form**: los partos existentes (no-preñada/preñada) verdes; el aviso suave, la lista dinámica de terneros, `validateCalves`, agregar/quitar, el tag electrónico por ternero — intactos.
**Fixes de la autorrevisión durante la corrida**: (a) la última aserción del E2E matcheaba una instancia `hidden` de "Destete" en una pantalla stale del stack web → agregué `.filter({visible:true}).first()` (misma lección que el test de mellizos). No hubo otros hallazgos que corregir.

## Reconciliación de specs (paso 9)
El as-built difiere del spec en la **mecánica de resolución del rodeo de la madre** (no en el comportamiento): el spec proponía resolverlo por params (design §4/T1); el as-built lo resuelve por **read local** (`fetchMotherRodeoContext`) como camino autoritativo (veto leader #1), con params como seed/fallback del nombre. Reconciliado:
- `design-parto-rodeo-caravana.md` §1 (nota reconciliación + `fetchMotherRodeoContext`), §4 (reescrito al read-local-primario + `resolveMotherSystemId` como fallback + nota `system_id` global/`canEditCalfRodeo`), §6 (agregado el 5º helper `canEditCalfRodeo` + ubicación `utils/calf-birth.ts`).
- `requirements-parto-rodeo-caravana.md` — nota de reconciliación bajo RPRC.1.2/1.6/1.8 (read local + `canEditCalfRodeo`), sin reescribir los EARS.
- `tasks-parto-rodeo-caravana.md` — T1/T3 con nota as-built; T1–T17 en `[x]`.

## Estado
Implementación completa + autoverificada. Frontend-only, `supabase/` intacto. **NO marco `done` ni toco `feature_list.json`/`current.md`** — espera reviewer + Gate 2 + veto visual del leader (Gate 2.5) + Puerta 2.
