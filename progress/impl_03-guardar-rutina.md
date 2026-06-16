# impl_03-guardar-rutina — Cablear R2.1 "Guardar como rutina" (preset desde el wizard)

baseline_commit: edac67034a027d9baf7c7adc593a555e8b3137e4

## Feature en curso

`specs/active/03-modo-maniobras/` (in_progress). Tarea acotada de FRONTEND PURO (sin backend/schema —
`maneuver_presets` 0051 + `createPreset` ya existen). Cierra el GAP de R2.1: el servicio `createPreset`
existe y el landing `maniobra.tsx` ya LISTA presets (`fetchPresets`) + arranca desde uno (`loadPreset`),
pero NO había forma de CREAR un preset desde la UI → "Tus rutinas" siempre vacío + el empty-state del
landing PROMETE "guardala como rutina" (acción inexistente). Se cablea en la etapa 3 del wizard.

## Plan (T1..Tn)

- **T1** — Nuevo `SavePresetSheet.tsx` (sheet de nombre): idiom lockeado de `ExitJornadaSheet`/
  `ManeuverConfigSheet` (scrim $scrim + anclado abajo + grip + safe-area + GUARD anti tap-through
  `readyToDismissRef` doble-rAF). Input "Nombre de la rutina" + "Guardar" (deshabilitado vacío/whitespace) +
  cancelar/scrim. maxLength sano (60, documentado). Error accionable es-AR sin perder lo tipeado (fail-closed).
- **T2** — Acción secundaria "Guardar como rutina" en la etapa 3 del wizard (`jornada.tsx`), cerca del CTA
  "Arrancar jornada" SIN competir con el primario (outline/link). Independiente de Arrancar (no acoplada).
- **T3** — Al Guardar: `createPreset({ establishmentId, name, config })` con la config ACTUAL de la jornada
  (mismo `buildJornadaConfig(chosen, cleanPre)` que arma `createSession` — NO re-derivar shape). OK → feedback
  "Rutina guardada" + cerrar; quedás en etapa 3. Fail → error en el sheet sin perder input.
- **T4** — Tests: e2e del wizard (etapa 3 → Guardar como rutina → nombre → Guardar → oráculo server preset
  existe) + nombre vacío → "Guardar" deshabilitado + regresión tap-through del scrim (hasTouch + touchscreen.tap).
- **T5** — Capturas web táctil 360/412 para el veto del leader.
- **T6** — Autorrevisión adversarial + reconciliación de specs (design as-built + requirements R2.1 + tasks).

## Estado: DONE (pendiente veto del leader + reviewer + Gate 2)

Frontend puro (no toca backend/schema: `maneuver_presets` 0051 + `createPreset` ya existían). Gate 1 N/A.

### Archivos tocados
- **NUEVO** `app/app/maniobra/_components/SavePresetSheet.tsx` — sheet de nombre (idiom lockeado + guard anti tap-through doble-rAF + input ≥56 + Guardar deshabilitado vacío/whitespace + `MAX_PRESET_NAME_LEN`=60 + error es-AR fail-closed).
- `app/app/maniobra/jornada.tsx` — etapa 3: acción secundaria "Guardar como rutina" (outline, debajo del primario, independiente de arrancar) + toast "Rutina guardada" + `buildCurrentConfig()` extraído (reusado por arrancar y guardar) + `onSavePreset` (createPreset) + mount del sheet + `labelA11y` import.
- `app/e2e/helpers/admin.ts` — oráculo `waitForServerPreset` (+ helper `normalizeManeuverConfig` que tolera el doble-encoding del jsonb, igual que `parseManeuverConfig` del cliente).
- `app/e2e/maniobra-wizard.spec.ts` — cobertura del flujo guardar (nombre vacío/whitespace → deshabilitado; nombre válido → Guardar → toast + oráculo server) + capturas etapa3-guardar-rutina/etapa3-sheet-rutina.
- `app/e2e/maniobra-config-sheet-race.spec.ts` — 2do test: regresión tap-through del scrim del SavePresetSheet (hasTouch + touchscreen.tap).
- **NUEVO** `app/e2e/captures/guardar-rutina.capture.ts` — capturas 360/412 para el veto del leader.

### Verificación
- `tsc --noEmit` (app + e2e): **0 errores** (corrido 2 veces).
- Anti-hardcode (`check-hardcode.mjs`): **0 violaciones**.
- Unit maneuver (`maneuver-wizard.test.ts` + `maneuver-config.test.ts`): **54/54** (loader ts-ext).
- e2e: `maniobra-wizard` **1/1** + `maniobra-config-sheet-race` **2/2** (incl. el nuevo tap-through del SavePresetSheet) — corridos contra el dist exportado.
- Capturas 360/412 generadas (4) + revisadas visualmente (etapa 3: primario dominante + secundario outline; sheet: input + Guardar habilitado).
- `node scripts/check.mjs` rojo = SOLO flake `animals_tag_unique` de `supabase/tests/animal/run.cjs` (colisión de seed de terminales paralelas en la DB remota compartida; documentado en current.md / memoria). Cero hits maneuver/preset/sessions → NO regresión (este chunk es frontend puro, no toca backend).

## Trazabilidad R→test

| R | Qué cubre | Test concreto |
|---|---|---|
| R2.1 (crear preset) | Guardar la combinación de maniobras + preconfig como preset con nombre, desde la etapa 3 | `app/e2e/maniobra-wizard.spec.ts` — "Guardar como rutina" → nombre válido → Guardar → **oráculo server `waitForServerPreset`** confirma la fila REAL con `config.maniobras === ['pesaje','tacto','vacunacion']` (en el orden de la jornada) |
| R2.1 (nombre no-vacío) | "Guardar" deshabilitado si el nombre es vacío/whitespace (CHECK `maneuver_presets_name_not_empty`) | `maniobra-wizard.spec.ts` — `saveBtn` `toBeDisabled` con input vacío y con "   " (solo espacios) |
| R2.1 (config = la de la jornada) | mismo shape/orden que `createSession` (no se re-deriva) | el oráculo asierta `maniobras` en orden; `buildCurrentConfig` es la única fuente (verificado en código) |
| R2.4 (establishment del contexto) | `establishmentId` del contexto activo, NUNCA hardcodeado | `onSavePreset` toma `establishmentId` de `useEstablishment`; e2e crea el preset bajo el establishment sembrado y el oráculo lo busca por ese id |
| R2.1 (independiente de arrancar) | guardar no arranca; quedás en etapa 3 | `maniobra-wizard.spec.ts` — tras Guardar, `'Revisá la jornada'` sigue visible (no navegó); el "Arrancar" smoke corre DESPUÉS |
| R2.1 (fail-closed, no perder input) | guard web táctil: el sheet no se auto-cierra al abrirlo; el input se conserva | `maniobra-config-sheet-race.spec.ts` (2do test) — tap táctil abre el sheet, sigue vivo +500ms, se puede escribir; backdrop deliberado SÍ cierra |
| R2.1 (tap-through web) | el scrim no se auto-cierra por el click huérfano (regla `reference_rn_web_pitfalls`) | `maniobra-config-sheet-race.spec.ts` (2do test, hasTouch + `touchscreen.tap`) |

## Autorrevisión adversarial

Busqué activamente (revisor hostil):
- **Desviación del spec**: ¿la config guardada es la misma que arranca la sesión? → SÍ: extraje `buildCurrentConfig()` y la reusan AMBOS (`onArrancar`/`onSavePreset`). El e2e oráculo verifica el orden real en el server. No se re-deriva un shape.
- **Preset vacío degenerado**: ¿se puede guardar con 0 maniobras? → NO: la acción vive solo en etapa 3, inalcanzable con `chosen.length === 0` (el gate de etapa 2 "Continuar" está deshabilitado a 0).
- **Nombre vacío/whitespace**: triple defensa (canSave de cliente + `createPreset` re-trim + CHECK DB). e2e cubre vacío y "   ".
- **Doble-submit**: `saving` deshabilita "Guardar" en vuelo; `onSavePreset` corre una vez.
- **Tap-through web táctil** (el bug que Raf cazó en otros sheets): el guard `readyToDismissRef` doble-rAF está presente; **lo cacé corriendo el test táctil real** (hasTouch + touchscreen.tap) — pasa.
- **Toast stale**: reabrir "Guardar como rutina" limpia el toast (`setPresetSaved(false)`); el sheet remonta limpio (gated por `savePresetOpen`) → input vacío.
- **Test que pasa por la razón equivocada**: el oráculo NO mira la UI/overlay — pollea `maneuver_presets` en el SERVER vía service_role (espeja `waitForServerActiveSessionId`) → prueba persistencia end-to-end real, no el optimismo local.
- **Bug cazado y cerrado durante la autorrevisión**: el oráculo `waitForServerPreset` inicial asertaba `Array.isArray(config.maniobras)` sobre el jsonb CRUDO → FALLÓ (e2e rojo) porque el `config` materializa **doble-encoded** en el server (el cliente persiste `JSON.stringify(config)` por CRUD-plano → string JSON dentro del jsonb). NO es bug del feature (es el mismo round-trip que `createSession`, ya tolerado por `parseManeuverConfig`). Fix: el oráculo NORMALIZA el config como lo hace el cliente (`normalizeManeuverConfig`, re-parse hasta 2 niveles) → asierta el shape que la app GENUINAMENTE recupera. Re-corrido: verde.
- **Descenders**: "Guardar como rutina" (g/p), "Revisá la jornada" (j), "preñez"/"Vacunación" — todo con lineHeight matching; verificado en las capturas (render completo).
- **Multi-tenant**: `establishmentId` del contexto, nunca hardcodeado. RLS `has_role_in` es la barrera; el preset es scope-establishment (R2.4).

### Gap de seguridad detectado (NO bloqueante, surfaced para el leader/Gate 2)
`maneuver_presets.name` NO tiene cap de longitud server-side (CHECK) — `0051` solo exige no-vacío. El **backlog 2026-06-14** (`docs/backlog.md`, origen Gate 2 de M1) anticipó EXACTAMENTE este momento: *"El día que se cableen — M5 ('guardar como rutina' = crear preset)... un write directo por PostgREST/PowerSync (que saltea cualquier `maxLength` del cliente) podría meter un texto gigante sin tope autoritativo (storage abuse)"* y recomendó un **Gate 1 puntual** con `CHECK char_length(name) <= N` **ANTES** de exponer el input. **Este es ese call-site.** No lo aplico yo (es DDL → Gate 1 + deploy gated por Raf, y mi tarea es frontend-pura). El `maxLength`=60 del cliente es UX, no autoritativo. Clase: **storage-abuse intra-tenant** (RLS sigue exigiendo `has_role_in` — no es IDOR ni cross-tenant). Marcado prominente en `design.md` §6.bis.10 + §7-adyacente, `requirements.md` R2.1 y `tasks.md` M1.4 as-built v3. **Recomendación al leader**: correr el Gate 1 puntual del cap de `name` (migración `CHECK char_length(name) <= N`, ej. 120) y autorizar el deploy, o aceptar el riesgo residual documentado.

## Reconciliación de specs

- **`design.md`** §6.bis.10 (NUEVO, as-built): R2.1 "Guardar como rutina" cableado en etapa 3 del wizard → `createPreset` + `SavePresetSheet` (sheet de nombre, idiom lockeado + guard tap-through). Incluye la nota de hardening pendiente (cap server-side de `name`).
- **`requirements.md`** R2.1: nota de reconciliación as-built (de "servicio sin call-site" a "cableado"). EARS sin cambio (ya describía el guardar).
- **`tasks.md`** M1.4: as-built v3 (la acción de UI que M1.4 prometía y nunca se construyó, ahora cableada). M1.3/M1.4 ya estaban `[x]`.
- No quedó nada que contradiga el código.
