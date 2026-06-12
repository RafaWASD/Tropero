# Review — spec 10 chunk UI-B2 (VACUNACIÓN MASIVA, T-UI.6 + fix de comentario)

**Reviewer**: reviewer agent · **Fecha**: 2026-06-12 · **Baseline**: `b1bd0a0`
**Reporte del implementer**: `progress/impl_10-ui-b2-vacunacion.md`
**Design-review visual del leader**: PASS (`design/spec10-ui-b2/`)

## Veredicto: **APPROVED**

---

## Trazabilidad R<n> ↔ test (chunk UI-B2)

| R<n> | Test concreto | OK |
|---|---|---|
| R4.1 (default todos + filtro categoría/sexo; combina con AND) | `bulk-candidates.test.ts:169` ("filtro combina categoría Y sexo (AND)"), `:165` (solo sexo), `:181` (filtro vacío = todos); `vaccination-preview.test.ts:138` (`deriveCategoryFilterOptions` = categorías presentes + conteo + orden), `:157` (cae al code / lista vacía) | ✅ |
| R4.2 (preview obligatorio "N eventos sobre M animales") | `vaccination-preview.test.ts:36` ("sin skips → N=M=total"), `:49` ("vacío → cero, empty state") + captura `vacunacion-preview.png` ("5 eventos sobre 5 animales") | ✅ |
| R4.3 (skip-and-report agrupado por motivo) | `vaccination-preview.test.ts:59` (already_applied R6.3), `:83` (rodeoDisabled R7.2), `:106` (precedencia sin doble-conteo) + captura del card de skip | ✅ |
| R4.4 (no crear mutación sobre un saltado) | `vaccination-preview.test.ts:123` ("toApply NO incluye ningún saltado") + la pantalla pasa `preview.toApply` a `applyBulkVaccination` (`vacunacion-masiva.tsx:218`) | ✅ |
| R6.3 (re-ejecutar → 0 nuevos, idempotencia UUIDv5) | `vaccination-preview.test.ts:72` ("re-ejecutar con TODOS ya aplicados → 0 nuevos") + `bulk-idempotency`/`bulk-operations-plan` as-built (UUIDv5 dedup) + `buildExistingVaccinationIdsQuery` filtra `deleted_at IS NULL` | ✅ |
| R7.2 (lote cross-rodeo: rodeo sin vacunación se saltea) | `vaccination-preview.test.ts:83` ("rodeo SIN vacunación → rodeoDisabled"), `:97` ("sin predicado no excluye") | ✅ |
| R10.4 (progreso/rechazos por animal) | `BulkProgressPanel` REUSADO de UI-B + `bulk-operations-plan.test.ts` as-built (DrainRejection por profileId) | ✅ |
| R3.1 (1 evento por animal, campaign_id NULL) — reusado | `local-reads.test.ts` as-built (`buildAddVaccinationInsert` NO setea campaign_id → NULL) + `bulk-operations-plan.test.ts` (planVaccination) | ✅ |

Cada R<n> tocado por este chunk tiene ≥1 test concreto. La UI (pantalla) se cubre con E2E en T-UI.11 (chunk siguiente, documentado); este chunk dejó util puro testeado (10 casos) + reuso de services ya testeados + screenshots como oráculo del design-review. Aceptable.

## Tasks completas: **sí** (con justificación de las pendientes)
- **T-UI.6 = `[x]`** con nota AS-BUILT (archivos reales + util de preview + reuso de services + fix de comentario + capturas).
- `[ ]` restantes: **T-UI.7/T-UI.8** (ficha castrado / corrección individual) y **T-UI.9/T-UI.10/T-UI.11** (E2E) — son chunks FUTUROS explícitamente fuera de scope de UI-B2 (declarado en el reporte y en `tasks.md`). **T-G1.2** = re-chequeo de Gate 1 que lanza el leader. Todas justificadas. No bloquean.

## Exactitud de specs (código → spec): **OK**
- `design.md §1.1` tiene bloque AS-BUILT chunk UI-B2 (pantalla, preview puro `buildVaccinationPreview`, `previewVaccination`, apply+progreso, capturas, fix de comentario) — describe lo que el código realmente hace.
- `requirements.md` no contradice el as-built (R4.1–R4.4, R7.2, R7.3 coherentes).
- `tasks.md` T-UI.6 reconciliado AS-BUILT.
- El fix de comentario está reflejado en `design.md:54` como nota de reconciliación. No quedó spec mintiendo.

## CHECKPOINTS
- C3 — Arquitectura: **[x]** capas respetadas (`app/` pantalla → service → utils puros; `bulk-operations.ts` única capa de I/O; util puro sin RN/supabase). Anti-hardcode 0 violaciones.
- C4 — Verificación real: **[x]** `vaccination-preview.test.ts` 10/10 verde; suites backend verdes; runner >0 tests.
- C6 — SDD: **[x]** los 3 archivos de spec presentes; R<n> del chunk con ≥1 test; tasks del chunk `[x]`.
- C7 — Multi-tenant: **[x]** `establishmentId` SIEMPRE del contexto activo (`vacunacion-masiva.tsx:72`), nunca hardcodeado; perfiles scopeados por `fetchGroupSelectionProfiles`. (RLS no se toca en este chunk frontend; backend Fase 1 ya tiene su suite — 22/22 verde.)
- C8 — Offline-first: **[x]** mutaciones por `bulk-operations` (CRUD plano local → CrudEntry → uploadData); NO toca el connector; preview lee del SQLite local.
- C1/C2/C5 — N/A para este chunk (no se cierra sesión ni se marca feature done acá).

## Checklist RAFAQ-específico
- **A. RLS / multi-tenancy**: N/A — frontend puro, no crea ni modifica tablas/policies. (El establishment activo sí se respeta; ver C7.)
- **B. Offline-first**: **[x]** funciona offline (preview + apply leen/escriben SQLite local vía services); bucket correcto (REUSA `fetchGroupSelectionProfiles` scoped); conflict resolution = idempotencia UUIDv5 determinística (re-ejecución no duplica, R6.3); NO hace requests síncronos a Supabase desde la pantalla (todo vía service).
- **C. BLE**: N/A — no toca BLE.
- **D. UI de campo (manga)**: **[x]** CTA `Button` `minHeight: $touchMin` (56px); chips `$chipMin`; una decisión por pantalla (producto → preview → confirmar); loading visible ("Cargando animales…" / "Calculando…"); empty-state explícito. (Fonts: tokens de tamagui; design-review visual del leader PASS.)
- **E. Edge Functions**: N/A — no toca Edge Functions.

## Verificación de los focos del reporter
1. **Producto obligatorio + cap**: CTA disabled si producto vacío (`canApply = productName.trim().length > 0 && animalsToApply>0`, `:202`); `maxLength={PRODUCT_NAME_MAX}` con `PRODUCT_NAME_MAX=80` < CHECK ≤160 server (`0070_check_text_length_caps.sql:110/227`) → nunca dispara el CHECK. Cap defensivo correcto. ✅
2. **Preview counts suman**: toApply + alreadyApplied + rodeoDisabled, precedencia rodeoDisabled>alreadyApplied sin doble-conteo (`vaccination-preview.ts:72-87`, test `:106`). ✅
3. **Filtro acota / combina**: categoría+sexo AND, sin filtro = todo (tests `bulk-candidates.test.ts:165/169/181`). ✅
4. **Idempotencia/re-ejecución**: UUIDv5 + skip already_applied, `deleted_at IS NULL` en la query de existentes; re-entrar refleja solo nuevos. ✅
5. **Al confirmar NO toca connector**: `applyBulkVaccination` → `runLocalWrite` (cola local → CrudEntry → uploadData as-built). `connector`/`uploadData` solo aparecen en comentarios descriptivos. ✅
6. **Fix de comentario VERAZ y SOLO comentario**: `seleccion-masiva.tsx:145-149` ahora dice "gating de destete DISPLAY-ONLY; server NO lo enforce-a; lo server-side es solo la RLS de autorización (que NO mira data_key)". Coherente con R7.3 y `0054` (que NO gatea `weaning`). Lógica del filtro cross-rodeo de destete INTACTA (`:150-159`). ✅
7. **Empty state**: grupo sin activos → InfoNote (`:294-297`); filtro que excluye a todos → preview con `animalsToApply=0` → "Ningún animal nuevo para vacunar" + CTA disabled (no crashea). ✅

## check.mjs
- 1ra corrida: **FAIL** exclusivamente en la suite de import de spec 12 (`run.cjs:660`, `code 57014` — "canceling statement due to statement timeout" en el batch de 5000 filas). FLAKE conocido, ajeno al chunk (cero SQL/RPC de import tocado).
- 2da corrida (re-run pedido por el reporter): **exit 0 — "All tests passed" / "Entorno listo"**. `vaccination-preview` 10/10 + operaciones-rodeo Fase 1 22/22 + resto verdes.

## Cambios requeridos
Ninguno.
