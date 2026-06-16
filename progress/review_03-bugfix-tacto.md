# Review — 03-bugfix-tacto (MODO MANIOBRAS, bugfix del tacto)

**Reviewer**: reviewer (Opus 4.8)
**Fecha**: 2026-06-15
**Alcance**: bugfix de 2 bugs de la pantalla de TACTO reportados por Raf en testing en vivo (web). Frontend puro (sin backend — binding capa1↔capa2 verificado idéntico). Gate 1 N/A. Review previo a Gate 2.

## Veredicto: **APPROVED**

---

## Trazabilidad R<n> ↔ test

| R<n> | Qué exige | Test(s) que lo verifica(n) | Estado |
|---|---|---|---|
| **R3.5** (auto-avance manual sólo con EXACTO — nota de reconciliación as-built) | identificación manual; auto-avance solo con match exacto idv/visual/tag | unit `app/src/utils/maniobra-identify.test.ts`: "R3.5: 1 candidato que matchea EXACTO el idv → found", "…el visual (case-insensitive + trim)…", "…el tag electrónico…". e2e `maniobra-tacto-bugfix.spec.ts (1b)`: match exacto idv "385" → auto-avance directo. | ✅ |
| **R4.2** (manual ambiguo → desambiguar; cubre también 1-candidato-no-exacto, nota as-built) | >1 candidato o 1 no-exacto → picker, sin auto-elegir | unit: "FIX otra-caravana: 1 candidato substring (NO exacto) → ambiguous", "…SIN campos de display → ambiguous (seguro)", "R4.2: >1 candidatos → ambiguous + enriquecidos". e2e `(1)`: substring "42" → picker "¿Cuál es?" → confirma X-1428 → carga la correcta; header muestra X-1428 (no "42"). | ✅ |
| **R5.7 / R5.8 / R10.8** (persistencia fail-closed, rechazo observable) | write local falla → NO avanza + banner accionable; reintento procede | e2e `(2)`: persist falla (marca solo-e2e) → `maneuver-capture-error` visible + NO llega a "Revisá la carga"; reintento → avanza al resumen + persiste server-side (`waitForServerTactoWithSession(profileId,'empty')`). | ✅ |
| **No-regresión** camino feliz | exacto + flujo completo intactos | `maniobra-identify.spec.ts` (manual idv exacto → auto-avance), `maniobra-carga.spec.ts` (tacto+pesaje+persist+corrección+offline). | ✅ |

Cada R<n> tocado por el bugfix tiene ≥1 test concreto. El camino BLE (`resolveBleIdentify` siempre `found` en `edit`) NO se tocó — verificado en código y cubierto por "R4.3: el BLE nunca devuelve ambiguous".

## Tasks completas: **sí**
`tasks.md` BUGFIX-TACTO en `[x]` con "Satisface (reconciliación as-built): R3.5/R4.2, R5.7/R5.8/R10.8", detalle de los 2 bugs, tests y archivos. Sin tasks `[ ]` sin justificar en el chunk.

## CHECKPOINTS (aplicables a un bugfix de cliente frontend)
- C2 — Estado coherente: `[x]` 03 única `in_progress`; tests verdes.
- C3 — Arquitectura: `[x]` lógica pura en `utils/maniobra-identify.ts`; I/O en services; el frame `carga.tsx` orquesta vía services/hooks; sin fetch directo; sin hardcode de `establishment_id`; sin TODOs sueltos; `maneuver-e2e-fault.ts` gated fuera de prod.
- C4 — Verificación real: `[x]` unit con fixtures reales (sin mocks de I/O); e2e con Supabase remoto; runner > 0 tests, todos verdes.
- C6 — SDD: `[x]` 3 archivos de spec presentes; reconciliación as-built en design.md (bloque AS-BUILT bugfix tacto) + notas bajo R3.5/R4.2/R5.8; cada R<n> con test.
- C1/C5/C7/C8 — N/A para este chunk (harness ya existente; cierre de sesión lo hace el leader; el bugfix no crea tablas/RLS ni cambia buckets de sync — usa el path offline-first ya existente).

## Checklist RAFAQ-específico
- **A. Multi-tenancy / RLS** — N/A: el bugfix no crea ni modifica tablas con `establishment_id`. (El binding capa2 `tg_reproductive_events_gating` se verificó solo para confirmar que NO hacía falta tocarlo.)
- **B. Offline-first** — Aplica parcial. `[x]` el fix preserva el camino CRUD-plano offline (el write local sigue siendo la verdad; el rechazo de sync server-side es asíncrono y lo maneja R10.8, no este path — documentado correctamente). `[x]` no se introdujeron requests síncronos a Supabase desde la pantalla (sigue vía services/PowerSync local). LWW intacto.
- **C. BLE** — N/A directo: el fix es del path MANUAL. `[x]` verificado que NO rompió el path BLE (resolveBleIdentify intacto; modo manual de fallback sigue ≤1 tap). Fallback manual accesible.
- **D. UI de campo** — `[x]` botones gigantes (VACÍA/PREÑADA) intactos; `[x]` `ManeuverErrorBanner` no roba el área de acción (anclado bajo la línea de maniobra, sobre el paso — se reintenta tapeando de nuevo); `[x]` una decisión por pantalla; `[x]` copy es-AR accionable. Recorte de descendentes: ambos Text del banner + el copy del picker llevan `lineHeight` matching (regla dura).
- **E. Edge Functions** — N/A: el bugfix no toca Edge Functions.

## Foco escrutado (los 5 puntos del encargo)
1. **Exact-match (bug 1)**: ✅ `resolveManualIdentify` auto-avanza SOLO si `isExactMatch` (idv|visual|tag === texto, case-insensitive+trim). Substring/no-exacto → `ambiguous`. BLE intacto (siempre `found` en `edit`). Picker de 1 candidato con copy adaptado y claro ("No hay ninguna caravana X exacta…"). Edge seguro: 1 candidato SIN campos de display → `ambiguous` (no auto-carga a ciegas).
2. **Fail-closed (bug 2)**: ✅ `captureAndAdvance` chequea `res.ok` de `persistManeuverEvent` + del soft-delete de huérfanos + envuelve todo en try/catch; ante fallo NO avanza, NO marca `captured` (movido a post-write), superficia el banner; `capturingRef` se limpia en `finally` (todos los early-return están dentro del try → el finally corre). Camino feliz avanza igual; corrección R5.9 (editingFromSummaryRef) intacta.
3. **e2e-fault gateado**: ✅ `maneuver-e2e-fault.ts` espeja fielmente el patrón vetado `ble-e2e-flag.ts`: gated en `window.__RAFAQ_MANEUVER_FAULT__ === true` (solo seteable por Playwright `addInitScript` pre-bundle; sin camino de UI/usuario). Importado SOLO por carga.tsx. Inerte en prod/dev. Consume-y-desarma (modela fallo transitorio → reintento pasa).
4. **Binding capa1↔capa2**: ✅ verificado en fuente — capa1 `MANEUVER_DATA_KEY_REQS.tacto = ['prenez','tamano_prenez']` (match 'all') == capa2 `tg_reproductive_events_gating` (`0054`) `assert_data_keys_enabled(..., array['prenez','tamano_prenez'])` para `event_type='tacto'`. Coinciden. El comentario del implementer (rechazo server-side asíncrono, no bloquea write local) es correcto. NO se necesita backend.
5. **Regresión + visual**: ✅ `ManeuverErrorBanner` terracota (color de aviso del DS — no hay token de error), no roba el área de acción, descendentes con lineHeight. `check.mjs` verde sin flake; suites de no-regresión verdes (incl. maneuvers backend 14/14, donde T2.4c pasa → 0091 desplegada, fuera de este scope pero sin regresión).

## Reconciliación de specs (código → spec): **OK**
- `design.md` bloque "AS-BUILT bugfix tacto (2026-06-15)" describe ambos fixes fielmente al código.
- `requirements.md` notas de reconciliación bajo R3.5, R4.2, R5.8 (no se reescriben los EARS — patrón correcto de nota).
- `tasks.md` task BUGFIX-TACTO `[x]` con tests y archivos.
- No quedan specs contradiciendo el as-built.

## check.mjs
`node scripts/check.mjs` → **EXIT_RC=0 (VERDE)**. Typecheck client OK; anti-hardcode 0 violaciones; suite unit (incl. los +5 casos nuevos de maniobra-identify) verde; todas las suites backend verdes. **0 failures en toda la corrida, sin flake este run.**

## Nota (no bloqueante)
El edge documentado por el implementer en la rama `vaccination` (`lastWriteCountRef` se setea antes del persist; al reintentar no re-corre la limpieza de huérfanos) NO afecta tacto/pesaje (el bug reportado): para tacto `value.kind==='tacto'` saltea todo el bloque multi-write. Queda anotado para M3.2, fuera del alcance de este bugfix. Correcto descartarlo acá.

## Cambios requeridos
Ninguno.
