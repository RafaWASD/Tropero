baseline_commit: b1bd0a09645fc5a02d5fdae2b41a147e41263869

# impl — spec 10 chunk UI-B2: pantalla de VACUNACIÓN MASIVA + fix de comentario

> Chunk UI-B2 de Fase 4 (spec 10). Hace funcional **Vacunar** (hoy es stub) — T-UI.6.
> SOLO T-UI.6 (`app/app/vacunacion-masiva.tsx`) + el fix de comentario del Gate 2 de UI-B.
> NO la ficha castrado (T-UI.7 = próximo chunk), NO E2E.
> Toda la lógica/services ya existen (Fase 2+3) — se REUSAN (cero re-implementación de mutaciones).

## Feature en curso
- spec 10 — Operaciones masivas por rodeo + vista de grupo.
- Estado real: EN IMPLEMENTACIÓN (multi-chunk; Puerta 1 aprobada, backend delta + Fase 2/3 + UI-A + UI-B
  committeados). El `status: "spec_ready"` de feature_list.json es la etiqueta stale conocida (el `notes`
  dice "EN IMPLEMENTACIÓN"). Tasks T-DB.*, T-CL.*, T-UI.1/2/3/4/5 = `[x]`. Falta T-UI.6/7/8 + E2E.

## Plan (tasks de este chunk)
- T1 (T-UI.6) — Pantalla `app/app/vacunacion-masiva.tsx` (REEMPLAZA el stub): recibe el grupo
  (groupType + groupId). Flujo (modelo Gate 0 ORIGINAL — filtro+preview, NO selección por checkbox):
  - Pre-config (product_name obligatorio + vía opcional) + filtro OPCIONAL por categoría y/o sexo (R4.1,
    default = todos sin filtro).
  - Preview obligatorio (R4.2): "N eventos sobre M animales" + "K saltados (motivos)" — saltados =
    ya-vacunados en esta fecha/campaña (skip already_applied) y/o (lote cross-rodeo) rodeo sin
    `vacunacion` habilitado (R4.3/R7.2/R10.4). Skip-and-report.
  - Confirmación explícita → `applyBulkVaccination` (Fase 3 REUSADO) → BulkProgressPanel (progreso del
    encolado + rechazos por animal — reuso UI-B).
  - Re-ejecutable: los ya-vacunados se saltan (idempotencia UUIDv5 + skip already_applied) → el preview
    refleja solo los nuevos (R6.3/R4.4).
  - Empty state si no hay candidatos.
- T2 — Util PURO nuevo `app/src/utils/vaccination-preview.ts`: computa el skip-and-report (toApply +
  skipped.alreadyApplied + skipped.rodeoDisabled) sobre candidatos + ids existentes + predicado de gating
  por rodeo. Testeado (R4.3/R4.4/R6.3/R7.2 lado preview). El service de apply FILTRA los rodeoDisabled
  antes de encolar (R4.4: no se crea mutación sobre un saltado).
- T3 (fix de comentario, MED del Gate 2 de UI-B) — `app/app/seleccion-masiva.tsx` ~líneas 143/148: el
  comentario del fail-open del gating de destete decía que lo respalda "la barrera server-side" — FALSO
  para el GATING (el destete NO se enforce-a server-side: 0054 lo excluye, decisión spec US-8). Corregir
  el comentario a la verdad: el gating de destete es DISPLAY-ONLY; el server NO lo enforce-a — lo
  server-side es solo la RLS de autorización (que NO mira el data_key). Solo el comentario; lógica intacta.

## Invariantes de seguridad / reglas a respetar (heredadas)
- Offline-first: las mutaciones van por `bulk-operations` (CRUD plano → CrudEntry → uploadData). NO toco
  el connector.
- `author_id` no aplica a vacunación (sanitary_events). No mandar columnas que el server fuerza.
- Multi-tenant: establishment_id SIEMPRE del contexto activo (nunca hardcodeado).
- Cero hardcode (ADR-023 §4). Touch targets ≥56px (manga-crítico, pleno sol, pulgar/guante).
- La autorización de la masiva es server-side (RLS + gating capa 2 fail-closed de 0054 para vacunación);
  el gating de DISPLAY NO es el control.

## Decisiones técnicas (defaults documentados)
- **Filtro de categoría/sexo desde el conjunto de candidatos, no del catálogo del sistema**: las opciones
  del filtro se derivan de las categorías/sexos REALMENTE presentes en el grupo (offline-correct, sin
  resolver systemId). Más útil para el operario (solo categorías que existen) y sin I/O extra.
- **Preview = N eventos sobre M animales**: en vacunación N == M (1 evento por animal — R3.1/R4.2). Se
  muestran ambos números por fidelidad al copy del spec.
- **rodeoDisabled se FILTRA antes de encolar** (R4.4): `applyBulkVaccination` solo skip-ea already_applied
  por idempotencia; los de rodeo sin vacunación los excluye la pantalla del conjunto a aplicar (el gating
  capa 2 igual los rechazaría server-side fail-closed, pero R4.4 pide no crear la mutación).

## Progreso — DONE (esperando design-review del leader + reviewer + Gate 2)

### T1 (T-UI.6) — Pantalla `vacunacion-masiva.tsx` ✅
- REEMPLAZA el stub. Recibe el grupo (`groupType`+`groupId`). Modelo Gate 0 ORIGINAL (filtro+preview).
- Datos: `fetchGroupSelectionProfiles` (REUSADO de UI-B — todos los activos del grupo, SQLite local).
- Pre-config: `FormField` producto (obligatorio) + vía (opcional → null si vacío).
- Filtro OPCIONAL (R4.1): chips de categoría (solo si >1) + sexo (solo si ambos). Default = todos.
- Conjunto candidato = `buildBulkCandidates('vaccinate', …, { filter })` (Fase 2 REUSADO).
- Preview EN VIVO (recalcula al cambiar el filtro, no al tipear producto → sin thrashing).
- CTA explícito "Vacunar M animales" (disabled sin producto o sin animales) → `applyBulkVaccination`
  (Fase 3 REUSADO) sobre `preview.toApply` → `BulkProgressPanel` (REUSADO de UI-B, verbo "Vacunando").
- Empty-state si el grupo no tiene activos.

### T2 — Util PURO `vaccination-preview.ts` + service `previewVaccination` ✅
- `app/src/utils/vaccination-preview.ts` (`buildVaccinationPreview` + `deriveCategoryFilterOptions`):
  toApply + skip.alreadyApplied (idempotencia UUIDv5, R6.3) + skip.rodeoDisabled (lote cross-rodeo, R7.2);
  precedencia rodeoDisabled>alreadyApplied sin doble-conteo; opciones de filtro derivadas de los activos.
- Test `vaccination-preview.test.ts` (10 casos, registrado en `scripts/run-tests.mjs`).
- Service `previewVaccination` (`bulk-operations.ts`): I/O — resuelve ids ya-aplicados localmente
  (`buildExistingVaccinationIdsQuery` REUSADO) + delega en el util puro. Gating por rodeo lo resuelve la
  pantalla (`fetchRodeoGroupActions.vaccinate`); fail-OPEN de DISPLAY si no resuelve.

### T3 — Fix de comentario (MED del Gate 2 de UI-B) ✅
- `seleccion-masiva.tsx` (~líneas 140-150): corregido el comentario del fail-open del gating de destete.
  Decía que lo respalda "la barrera server-side" — FALSO: 0054 NO gatea `weaning` (excluido por spec US-8).
  Ahora dice la verdad: el gating de destete es DISPLAY-ONLY; el server NO lo enforce-a; lo único
  server-side es la RLS de autorización (que NO mira el data_key). Solo el comentario; lógica intacta.

## Archivos tocados
NUEVOS:
- `app/app/vacunacion-masiva.tsx` (REEMPLAZA el stub)
- `app/src/utils/vaccination-preview.ts` (+ `.test.ts`)
- `app/e2e/captures/spec10-uib2-screenshots.capture.ts`
- `design/spec10-ui-b2/{vacunacion-preview,vacunacion-skip}.png`
MODIFICADOS:
- `app/src/services/bulk-operations.ts` (`previewVaccination` + import del util)
- `app/app/seleccion-masiva.tsx` (SOLO el comentario del fail-open de destete — lógica intacta)
- `scripts/run-tests.mjs` (registra vaccination-preview.test.ts)
- `specs/active/10-operaciones-rodeo/{design.md,tasks.md}` (reconciliación as-built)

## Cómo navegar a cada pantalla
- **Vacunación:** Inicio → card de rodeo/lote → vista de grupo → botón "Vacunar" de la GroupActionsBar
  (solo si `vacunacion` está habilitado en el rodeo) → ruta `/vacunacion-masiva?groupType=rodeo|lote&groupId=<id>`.
- **Pre-config + filtro + preview:** todo en la misma pantalla. Tipeá el producto, tocá chips de categoría/
  sexo (opcional), mirá el preview "N eventos sobre M animales" + el skip-and-report.
- **Aplicar:** tocá el CTA "Vacunar M animales" abajo → progreso in-screen (BulkProgressPanel).

## Screenshots (viewport 412)
Comando: `cd app; pnpm exec playwright test e2e/captures/spec10-uib2-screenshots.capture.ts --config playwright.capture.config.ts`
(requiere `pnpm run e2e:build` antes — hecho). Confirmadas en disco:
- `C:\DEV\RAFAQ\app-ganado\design\spec10-ui-b2\vacunacion-preview.png` — producto + filtro + "5 eventos
  sobre 5 animales · Una vacunación por animal" + skip "1 animal ya tiene esta vacunación cargada hoy" + CTA.
- `C:\DEV\RAFAQ\app-ganado\design\spec10-ui-b2\vacunacion-skip.png` — chip "Ternero (3)" aplicado → "2
  eventos sobre 2 animales" + el skip (el ternero ya-vacunado cae en la categoría filtrada).

## Trazabilidad R<n> → test
| R<n> | Cobertura |
|---|---|
| R4.1 (default todos + filtro categoría/sexo) | `vaccination-preview.test.ts` (`deriveCategoryFilterOptions`) + `bulk-candidates.test.ts` as-built (filtro vaccinate, R4.1: 5 casos) + screenshot (chips + preview) |
| R4.2 (preview obligatorio "N eventos sobre M animales") | `vaccination-preview.test.ts` ("R4.2: sin skips → N=M=total"; "empty → cero") + screenshot `vacunacion-preview.png` ("5 eventos sobre 5 animales") |
| R4.3 (skip-and-report agrupado por motivo) | `vaccination-preview.test.ts` (already_applied R6.3; rodeoDisabled R7.2; precedencia sin doble-conteo) + screenshot (card "1 animal se saltea · ya tiene esta vacunación cargada hoy") |
| R4.4 (no crear mutación sobre un saltado) | `vaccination-preview.test.ts` ("R4.4: toApply NO incluye ningún saltado") + la pantalla pasa `preview.toApply` a `applyBulkVaccination` (los saltados nunca se encolan) |
| R6.3 (re-ejecutar → 0 nuevos) | `vaccination-preview.test.ts` ("re-ejecutar con TODOS ya aplicados → 0 nuevos") + `bulk-operations-plan.test.ts` as-built (UUIDv5 dedup) + screenshot (el ya-vacunado se saltea) |
| R7.2 (lote cross-rodeo: rodeo sin vacunación se saltea) | `vaccination-preview.test.ts` ("en lote cross-rodeo, rodeo SIN vacunación → rodeoDisabled"; "sin predicado no excluye") |
| R10.4 (rechazos por animal en el progreso) | `BulkProgressPanel` REUSADO de UI-B (rechazos locales por animal) + `bulk-operations-plan.test.ts` as-built (DrainRejection por profileId) |
| R3.1 (1 evento por animal, campaign_id NULL) | `local-reads.test.ts` as-built (`buildAddVaccinationInsert` — campaign_id NO se setea → NULL) + `bulk-operations-plan.test.ts` (planVaccination) — REUSADOS |
> La UI se cubre con E2E en T-UI.11 (chunk siguiente). Este chunk dejó la pantalla testeable (util puro
> testeado + reuso de services ya testeados) + las screenshots como oráculo del design-review.

## Autorrevisión adversarial (qué busqué / qué encontré / cómo cerré)
1. **Preview y apply en DESACUERDO sobre qué es "already_applied"** (verificado): ambos usan la MISMA
   barrera — `buildExistingVaccinationIdsQuery` (ids locales) vs el UUIDv5 determinístico. Un evento con id
   random (flujo individual / seed crudo) NO se detecta — comportamiento DELIBERADO y documentado
   (bulk-idempotency.ts: "dos dosis el mismo día → flujo individual"). El screenshot lo confirmó: hubo que
   sembrar el evento con el UUIDv5 real para que el skip apareciera → preview y apply son consistentes.
2. **R4.4 — un saltado se encola igual** (cerrado por construcción): la pantalla pasa `preview.toApply`
   (que excluye already_applied + rodeoDisabled) a `applyBulkVaccination`; los rodeoDisabled NUNCA se
   encolan (no esperamos al rechazo server-side fail-closed). Test "R4.4: toApply NO incluye saltados".
3. **Doble-conteo en el skip-report** (encontrado + cerrado): un animal de rodeo OFF que además ya estaba
   vacunado se contaría dos veces. Fijé precedencia: rodeoDisabled GANA (continue), no llega a alreadyApplied.
   Test "precedencia sin doble-conteo".
4. **Thrashing de queries al tipear el producto** (verificado): el preview depende de `candidates` (=
   profiles+filtro), NO de `productName`/`route` → tipear NO re-dispara la query. Solo el filtro la recalcula.
5. **rodeoDisabled fail-OPEN no es un agujero de authz** (verificado): si el gating de display no resuelve
   (offline parcial), mostramos todos — pero el gating capa 2 de 0054 (`tg_sanitary_events_gating` →
   `assert_data_keys_enabled(['vacunacion'])`, fail-closed) RECHAZA server-side cada INSERT a un rodeo sin
   vacunación. El display NO es el control. (A diferencia del destete, que NO tiene barrera server-side —
   por eso el fix de comentario de T3.)
6. **Multi-tenant** (verificado): `establishmentId` SIEMPRE del contexto activo (nunca hardcodeado); los
   perfiles salen de `fetchGroupSelectionProfiles` (scopeados por la stream); la query de ids-existentes
   filtra por los profileIds del grupo.
7. **`author_id` / columnas forzadas** (verificado): vacunación = `sanitary_events`, NO lleva author_id;
   `buildAddVaccinationInsert` (as-built) NO manda establishment_id/created_by (el trigger los fuerza).
8. **Cero hardcode** (verificado): `check-hardcode.mjs` = 0 violaciones; íconos lucide con getTokenValue;
   `$navIcon` (no `$icon`=48) para el ícono inline del preview; chips ≥`$chipMin`; CTA fullWidth ≥touchMin.
9. **Empty / lista vacía por filtro** (verificado): grupo sin activos → empty-state. Filtro que excluye a
   todos → `previewVaccination([], …)` devuelve `animalsToApply=0` → "Ningún animal nuevo para vacunar" +
   CTA disabled (no crashea, no null).
10. **Import muerto** (encontrado + cerrado): quité `TextInput` de los imports (no se usa — no hay buscador
    en esta pantalla, a diferencia de la de selección).

## Reconciliación de specs
- `tasks.md` T-UI.6 → `[x]` con nota AS-BUILT (archivos reales + util de preview + reuso de services + fix
  de comentario + capturas). El mapa R→tasks ya listaba T-UI.6 para R4.x/R10.4 — sin cambios de *qué*.
- `design.md` §1.1 → bloque AS-BUILT chunk UI-B2 (pantalla, preview puro, previewVaccination, apply+progreso,
  capturas, fix de comentario). NO se reabrió el modelo de interacción (Gate 0 ORIGINAL, lockeado). NO cambió
  el *qué* de ningún R<n> — solo se materializó. El fix de comentario corrige una afirmación FALSA del código
  de UI-B (no cambia comportamiento) → reconciliado en el design como nota.

## Verificación
- `cd app; pnpm typecheck` → verde.
- `node scripts/check.mjs` → exit 0 ("Entorno listo"; anti-hardcode 0 violaciones; typecheck client OK;
  client unit incl. vaccination-preview 10/10). NOTA: una corrida intermedia dio un FAIL TRANSITORIO en la
  suite de import de spec 12 (`T2.5 ... batch de exactamente 5000 filas` → "canceling statement due to
  statement timeout" — statement-timeout de Postgres en un insert de 5000 filas bajo carga, NO en mi código:
  cero SQL/RPC/import tocado). Confirmado FLAKE: la corrida siguiente con TODOS mis cambios dio exit 0 verde,
  y la suite de import pasa en baseline limpio.
- Screenshots generadas y confirmadas en disco (2).

## NO marqué la feature done
Queda: design-review visual del leader → reviewer → Gate 2 → T-UI.7 (ficha castrado/futuro-torito) /
T-UI.8 (corrección individual) / T-UI.9-11 (E2E) → Puerta 2.
