baseline_commit: e6cfdb0442d369142d24edb10f33fd0df753d80f

# impl — Spec 03 Stream B / Chunk B4 (RPSC.1): alinear el espejo client-side de categoría

**Feature**: `03-modo-maniobras` — delta **Stream B** (puesta en servicio / cliente). Chunk **B4 (RPSC.1)**.
**Tipo**: lógica pura (TS) + tests. **Sin UI nueva, sin design-spike.** **Frontend puro → Gate 1 N/A** (design §0; confirmado: no toca schema/RLS/Edge/migración).
**Dispatcher**: leader-orquestado (background). Veto del leader sobre la spec: **PASS** (requirements "Historial de refinamiento", 2026-06-23).
**Fecha**: 2026-06-23.

## ⚠️ Observación de pre-condición (para el leader)

El protocolo del implementer dice "parar si la feature está `spec_ready`". Estado real:
- Las 3 specs de Stream B existen en `specs/active/03-modo-maniobras/{requirements,design,tasks}-puesta-en-servicio-cliente.md`, marcadas `Status: spec_ready` + **veto del leader PASS**.
- `feature_list.json`: feature 03 = `"done"` (base MODO MANIOBRAS), feature 02 = `"deferred"` (Stream A done). **No** hay un entry separado para "Stream B" y **no** se flipeó ninguno a `in_progress` para este delta — el trabajo de Stream B se trackea bajo las notas de spec 02/03.
- Esto **replica el patrón establecido** en este repo (ver `progress/current.md`: Stream A corrió con 02 `in_progress`→`deferred`; múltiples chunks de spec-03 corrieron como deltas). El leader (dueño de los gates) despachó B4 explícitamente con el detalle de tasks completo y veto PASS.
- **Decisión**: PROCEDO (spec existe + autorizada por el leader vía veto + dispatch explícito). Dejo registrada la observación para que el leader confirme el tracking de estado de Stream B en `feature_list.json` si corresponde.

## Plan (tasks del chunk B4 — `tasks-puesta-en-servicio-cliente.md`)

- T-B4.1 — `animal-category.ts`: quitar `const hasService` + su uso `|| hasService` de la rama `vaquillona` de `computeCategoryCode`. (RPSC.1.1, RPSC.1.3)
- T-B4.2 — `animal-category.ts`: actualizar comentario de precedencia (quitar "servicio") + header anti-drift (RC6.5.1: rama vaquillona espeja `0104`, no `0062`). (RPSC.1.7)
- T-B4.3 — `animal-category.test.ts`: invertir T2.23 — ternera <1año + solo `service` → `ternera`; vaquillona por edad/destete + `service` → sigue `vaquillona`. (RPSC.1.1, RPSC.1.4)
- T-B4.4 — `animal-category.test.ts`: conservar verdes los casos de precedencia con `service` + evento dominante (parto → `vaca_segundo_servicio`; tacto+ → `vaquillona_prenada`). (RPSC.1.3, RPSC.1.4)
- T-B4.5 — `animal-category.test.ts`: destete → `vaquillona`; ≥1año → `vaquillona` por edad. (RPSC.1.2)
- T-B4.6 — `maneuver-category-preview.ts`: `syntheticEventsForFemaleCategory('vaquillona')` reconstruye con `[weaning]` (no `[service]`, DD-PSC-7). (RPSC.1.5)
- T-B4.7 — `maneuver-category-preview.ts`: `capturedReproEvents` deja de inyectar `service` por `kind:'inseminacion'`. (RPSC.1.5)
- T-B4.8 — `maneuver-category-preview.test.ts`: invertir "ternera + inseminación → vaquillona" a "→ null"; verificar tacto+ sigue dando `vaquillona_prenada`. (RPSC.1.5)
- T-B4.9 — Verificar (NO tocar) `MIRROR_EVENT_TYPES` (`local-reads.ts:936`) sigue con `'service'`. (RPSC.1.6)
- T-B4.10 — `node scripts/check.mjs` + suite cliente verde + regresión. Gate 2 (code). (RPSC.8.5)

## Baseline
- `node scripts/check.mjs` VERDE al arrancar (exit 0, "Entorno listo").
- Verificado contra el server: `supabase/migrations/0104_compute_category_drop_service.sql` — la rama hembra NO tiene `v_has_service` en ningún lado; el espejo debe quedar IDÉNTICO salvo quitar `const hasService` + `|| hasService`.

## Progreso — TODAS las tasks del chunk B4 hechas (T-B4.1 → T-B4.10 `[x]`)

### Archivos tocados (4, exactamente los del design §7 "B4")
1. **`app/src/utils/animal-category.ts`** (T-B4.1, T-B4.2):
   - `computeCategoryCode`, rama HEMBRA: eliminado `const hasService = ...` y el término `|| hasService` del `if` de la rama `vaquillona`. Queda `if (hasWeaning || (knownAge !== null && knownAge >= ONE_YEAR_DAYS)) return 'vaquillona'` — IDÉNTICO a `0104` líneas 115-116.
   - Comentario de precedencia actualizado: "vaquillona(destete|servicio|≥1año)" → "vaquillona(destete|≥1año)"; cita ahora `0104` líneas 109-121.
   - Header anti-drift (RC6.5.1): aclara que la base es `0062` pero la rama `vaquillona` refleja la reconciliación de `0104` (`0104_compute_category_drop_service.sql`, RPS.4.1) — ya no usa `service`.
   - Docblock de `computeCategoryCode`: "has_weaning / has_service" → "has_weaning (el `service` ya NO entra)".
   - Comentario de transiciones server-side (línea ~86): quitado "servicio" de la lista de disparadores (agregado "aborto"; nota explícita "el `service`/IA ya NO transiciona categoría").
2. **`app/src/utils/animal-category.test.ts`** (T-B4.3, T-B4.4, T-B4.5): bloque T2.23 INVERTIDO (3 tests → 4):
   - `ternera <1año + SOLO service (sin destete)` → **`ternera`** (antes `vaquillona`). [RPSC.1.1/1.4]
   - `vaquillona por EDAD (≥1año) + service` → `vaquillona` (la EDAD la sostiene, no el service). [RPSC.1.2]
   - NUEVO: `ternera <1año + service + DESTETE` → `vaquillona` (el destete gradúa, vía canónica post-0104). [RPSC.1.2]
   - `preñada (tacto+ vigente) + service` → `vaquillona_prenada` (el tacto+ domina; service no influye). [RPSC.1.3]
   - Comentario del test de precedencia tacto+ (línea ~406) actualizado: cita `0104`, rama `vaquillona(destete|≥1año)`, `service` "presente para probar que NO altera el resultado". El test `service+tacto+parto → vaca_segundo_servicio` queda intacto (parto manda). [RPSC.1.3/1.4]
3. **`app/src/utils/maneuver-category-preview.ts`** (T-B4.6, T-B4.7):
   - `syntheticEventsForFemaleCategory('vaquillona')`: reconstruye con `[weaning]` (no `[service]`) — DD-PSC-7, la vía canónica ternera→vaquillona post-0104. Renombrada la const `service`→`weaning`.
   - `capturedReproEvents`: ELIMINADA la rama `else if (value.kind === 'inseminacion') → service`. Una IA capturada ya NO aporta un evento que dispare transición de categoría (RPS.4.8). Docblocks del módulo + de la función + las reglas de `previewManeuverCategoryTransition` (regla 2 y 4) actualizados.
4. **`app/src/utils/maneuver-category-preview.test.ts`** (T-B4.8):
   - INVERTIDO `ternera + inseminación → vaquillona` → **`→ null`** (la IA ya no promueve). [RPSC.1.5]
   - `vaquillona + inseminación → null` (sin cambio en el resultado; razonamiento ahora "la IA no dispara").
   - NUEVO test defensivo: `ternera + tacto+ Y inseminación (misma jornada)` → `vaquillona_prenada` (el TACTO+ manda; quitar la rama inseminacion NO rompió la extracción del tacto).
   - Header del archivo + comentario de sección actualizados.

### NO tocado (verificaciones)
- **`MIRROR_EVENT_TYPES`** (`local-reads.ts:936`): sigue `('birth','weaning','service','tacto','abortion')`. El `service` se SIGUE LEYENDO para el timeline; solo dejó de influir en `computeCategoryCode` (RPSC.1.6). [T-B4.9 ✔]
- **Write-path de la IA** (`maneuver-event-query.ts:93,159`): INTACTO — `inseminacion → 1× reproductive_events service ai` (R6.5). La IA sigue persistiendo un evento `service`+`ai` real (lo lee Stream C como servida, RPS.4.8); B4 solo cambió el PREVIEW display-only. Boundary correcto y confirmado.
- **Contrato de retorno** `MirrorCategoryCode`: SIN cambio. Firma de `computeCategoryCode`, `syntheticEventsForFemaleCategory`, `previewManeuverCategoryTransition`: SIN cambio (solo comportamiento interno).
- Backend/migraciones, enum `pregnancy_status`, rama macho, B1/B2/B3: NO tocados.

## Trazabilidad RPSC.x → test (cada R cubierto por ≥1 test concreto)

| RPSC | Test concreto (archivo:descripción) |
|---|---|
| RPSC.1.1 | `animal-category.test.ts`: "T2.23 (RPSC.1.1): ternera <1 año + SOLO service (sin destete) → ternera" |
| RPSC.1.2 | `animal-category.test.ts`: "T2.23 (RPSC.1.2): vaquillona por EDAD (≥1 año) + service → sigue vaquillona" + "ternera <1 año + service + DESTETE → vaquillona" + (fixtures RC6.1.6 de edad/destete preexistentes) |
| RPSC.1.3 | `animal-category.test.ts`: "T2.23 (RPSC.1.3): preñada (tacto+ vigente) + service → vaquillona_prenada" + "precedencia: tacto+ vigente GANA a destete/edad" + "precedencia (T2.29): service+tacto+parto → vaca_segundo_servicio" |
| RPSC.1.4 | `animal-category.test.ts`: los 4 tests del bloque T2.23 invertido (service ya no es disparador) |
| RPSC.1.5 | `maneuver-category-preview.test.ts`: "ternera + inseminación (IA) → null (RPSC.1.5)" + "vaquillona + inseminación → null" + "ternera + tacto+ Y inseminación → vaquillona_prenada" + antidrift round-trip de `vaquillona` (reconstruido vía `[weaning]`) |
| RPSC.1.6 | Verificación T-B4.9 (`MIRROR_EVENT_TYPES` sigue con `'service'`); ejercido indirectamente por toda la suite del espejo que sigue leyendo eventos `service` en sus fixtures |
| RPSC.1.7 | Cambio de comentario (header anti-drift + precedencia) — no testeable por unit; verificado por lectura + el round-trip antidrift que ATRAPA cualquier drift real entre comentario↔código↔server |
| RPSC.8.5 | T-B4.10: `node scripts/check.mjs` VERDE (typecheck + anti-hardcode + unit incl. ambas suites invertidas + backend) |

## Autorrevisión adversarial (paso 8 — busqué como revisor hostil)

Qué busqué y qué encontré:
- **¿Algún uso colgado de `hasService`?** Grep `hasService|has_service` en `app/src` → solo mis comentarios nuevos + el código corregido. CERO usos colgados. ✔
- **¿El espejo computa LO MISMO que `compute_category` 0104 para los casos clave?** Verifiqué línea por línea contra `0104_compute_category_drop_service.sql`: rama hembra idéntica (partos≥2→multipara; partos=1→vaca_segundo_servicio; tacto+→vaquillona_prenada; has_weaning|≥365→vaquillona; <365→ternera; default vaquillona). **Sin `v_has_service` en ningún lado.** Casos clave: ternera+service→ternera ✓; destete/edad→vaquillona ✓; parto/tacto+ intactos ✓.
- **¿El preview MIENTE vs el server?** No: tras quitar la rama inseminacion, una IA capturada no produce ningún evento → `capturedReproEvents=[]` → preview null. El server, al subir esa IA, escribe `service`+`ai` pero `compute_category` 0104 ya no lo lee → no transiciona categoría. **Preview == server (cero drift).** El round-trip antidrift de `maneuver-category-preview.test.ts` (reconstruye cada code vía `computeCategoryCode`) PASA → garantiza estructuralmente que el sintético `[weaning]` reproduce `vaquillona` igual que el server.
- **¿`vaquillona` reconstruido por `[weaning]` aguanta TODOS los birthDate?** Sí: `has_weaning=true` gradúa a vaquillona sin importar la edad (incluso <1 año), igual que el server. Si se appendea un tacto+ → vaquillona_prenada (transición correcta). Cubierto por el round-trip + el caso canónico.
- **¿Tests que pasan por la razón equivocada?** El test defensivo nuevo (tacto+ Y IA → vaquillona_prenada) ejercita el path real: prueba que quitar la rama inseminacion NO rompió la extracción del tacto (si hubiera roto el loop, daría null). El caso "ternera+service+destete→vaquillona" prueba que es el DESTETE el disparador, no el service (sin destete daría ternera). No hay asserts vacíos ni mocks que enmascaren el path.
- **¿Edge cases?** Cubiertos: solo-service (sin destete, <1año→ternera; ≥1año→vaquillona por edad); service+destete; service+tacto+; service+tacto+parto; IA sola; IA+tacto+; tacto vacío; catálogo vacío; code no-cría.
- **Multi-tenant / offline-first / seguridad:** B4 es lógica PURA display-only, sin I/O, sin red, sin schema, sin escritura → no aplica RLS/tenant/fail-closed (Gate 1 N/A confirmado, design §0). No hardcodea `establishment_id` (no toca data). El `check.mjs` (incluye anti-hardcode) pasó.

**Resultado de la autorrevisión: 0 hallazgos para corregir.** El cambio es exactamente el del design §4 + DD-PSC-7; el boundary IA-write-path/IA-preview quedó correcto (lo verifiqué explícitamente porque era el riesgo más sutil).

## Reconciliación de specs (paso 9 — regla dura)

- La implementación quedó **idéntica** a lo que dicen `requirements-puesta-en-servicio-cliente.md` (RPSC.1.1–1.7) y `design-puesta-en-servicio-cliente.md` (§4.1, §4.2, DD-PSC-7, §7). **No hubo desviación** → no se reescriben los EARS ni el design (no aplica nota de reconciliación al as-built, porque el as-built == lo diseñado).
- `tasks-puesta-en-servicio-cliente.md`: T-B4.1 → T-B4.10 marcadas `[x]` con la nota de verificación en T-B4.9.
- **Nota C6/RC6.5.1** (`feedback_correcciones_en_specs`): el header anti-drift de `animal-category.ts` se actualizó en el CÓDIGO (RPSC.1.7) — refleja que la rama `vaquillona` espeja `0104`. La spec de C6 base (spec 02) no se toca: este delta es Stream B y la reconciliación de C6 vive en la nota del header del módulo + en esta spec de Stream B (RPSC.1.7 lo prescribe). No hay contradicción spec↔código.
- **Test viejo de spec-02 base** (T2.23 / RT2.5 `servicio→vaquillona`): ya estaba SUPERSEDED por RPS.4.1 a nivel backend (ver notas de Stream A en `feature_list.json`); B4 lo cierra del lado del espejo cliente. El comentario del bloque T2.23 en el test lo documenta ("RT2.5.x SUPERSEDED por RPS.4.1").

## Verificación final

- **`node scripts/check.mjs` → VERDE end-to-end** (exit 0, "Entorno listo. Podés trabajar."): typecheck + anti-hardcode + client unit (incl. `animal-category.test.ts` 83/83 y `maneuver-category-preview.test.ts` 20/20 invertidos) + todas las suites backend. Sin flake (corrida en terminal única).
- Run aislado de las 2 suites tocadas: **103 tests, 0 fail** (83 animal-category + 20 preview), incluido el round-trip antidrift.
- **El espejo computa LO MISMO que `compute_category` 0104** para los casos clave (verificado contra la migración + por el round-trip antidrift).

## Nota sobre e2e (no-bloqueante)
- El e2e existente `app/e2e/maniobra-preview-transicion.spec.ts` (R8.4) ejercita SOLO el path **tacto+** (vaquillona + tacto+ → vaquillona preñada) y el negativo **tacto vacío** — ambos **inalterados** por B4 (el tacto sigue siendo el disparador). El preview de la IA nunca tuvo un e2e dedicado (la UI de la manga no expone un "anticipar por IA" separado; la IA se carga y su preview era el camino interno que B4 desactiva). No hay e2e que rompa. No se agregó e2e nuevo: B4 es una alineación de lógica pura sin nueva superficie de UI; la cobertura unit (round-trip antidrift + casos invertidos) es la apropiada para este chunk. (Playwright corre fuera de `check.mjs`.)

## Estado
- **TODAS las tasks de B4 `[x]`. NO marco la feature `done`** (espera reviewer + Gate 2, paso 10 del protocolo).
- Gate 1 **N/A** (frontend puro, sin schema/RLS/Edge/migración — design §0, confirmado por el grep + el hecho de que el backend lo hizo Stream A). Pendiente: **reviewer + Gate 2 (code)**.
