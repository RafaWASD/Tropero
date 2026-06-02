# Spec 10 — Operaciones masivas por rodeo + vista de grupo — Tasks

**Status**: `spec_ready` (status flip pendiente de coordinación).
**Fecha**: 2026-06-01 (sesión 21).
**Fuente**: `requirements.md` + `design.md` de esta spec.

> Reglas (`docs/specs.md`): pasos discretos en orden, cada uno con `[ ]` + los `R<n>` que cubre. El implementer marca `[x]`; el reviewer rechaza `[ ]` sin justificación. Cada `R<n>` mapea a ≥1 test. **Antes de Puerta 1 corre Gate 1** (`security_analyzer` modo `spec`) por ser SCHEMA-SENSITIVE (design §6).
>
> **Fases**: el backend (delta `castracion` + gating + tests RLS) es **ejecutable ya** (no depende del design system). El cliente (vista de grupo, preview, offline) depende del frontend en vuelo de spec 02 (C1/C2) y spec 09 (`AnimalListItem`) + del design system → su UI es **TENTATIVA** y se puede fasear después, igual que el frontend de spec 02/03/09. Coordinar la migration con la terminal de backend (numeración).

---

## Fase 1 — Backend: delta `data_key castracion` + gating (ejecutable ya)

- [ ] T-DB.1 — Migration `00NN_castracion_data_key.sql` (numeración: siguiente libre — `0056_..` está TOMADO, última as-built = 0058, usar ≥ `0059`; coordinar con backend): INSERT `data_key='castracion'` en `field_definitions` (`on conflict do nothing`). Cubre: R3.3.
- [ ] T-DB.2 — En la misma migration: INSERT en `system_default_fields` para `(bovino, cría)` con `default_enabled=false`, `required_for_system=false`. **El join filtra por `.code` (`sp.code='bovino' and s.code='cria'`), NO por `.name`** (L1 Gate 1: `name` es `'Bovino'`/`'Cría'` con mayúscula/tilde → no matchearía; el seed canónico de 0018/0014 usa `.code`). Cubre: R3.3, R5.7.
- [ ] T-DB.3 — En la misma migration: `create or replace function public.tg_sanitary_events_gating()` — la FUNCIÓN REAL del trigger de gating de `sanitary_events` (0054 L97/L108; NO existe ninguna `tg_sanitary_gating`). Reemplazar SOLO el cuerpo, sumando la rama de castración SIN romper la rama de vacunación as-built ni el fail-closed: `event_type='treatment' AND lower(translate(coalesce(product_name,''),'áéíóúÁÉÍÓÚ','aeiouAEIOU'))='castracion' → assert_data_keys_enabled(['castracion'])` (marcador canónico constante `'Castración'`; comparación robusta a acento/caso — `unaccent` no disponible, usar `translate()` portable). NO re-crear el trigger `sanitary_events_gating` (ya existe en 0054). Re-emitir `revoke execute on function public.tg_sanitary_events_gating() from public, authenticated, anon` (idempotente, patrón 0055). Cubre: R7.3.
- [ ] T-DB.4 — Test (runner RLS/gating, ADR-012): insertar castración (`sanitary_events` treatment + marcador) sobre un rodeo **con** `castracion` enabled → **acepta**; sobre un rodeo **sin** `castracion` enabled → **rechaza** (`23514`, fail-closed). Cubre: R7.3.
- [ ] T-DB.5 — Test del binding (M1): (a) un `sanitary_events` `event_type='treatment'` **no-castración** (curativo, ej. `product_name='Ivermectina'`) NO queda gateado por `castracion` (sigue insertándose en rodeo sin `castracion`) — previene el falso-positivo; (b) una variante de **caso/acento** del marcador (`product_name='Castracion'` sin tilde, `'CASTRACIÓN'`) **TAMBIÉN** se gatea (la normalización `translate()` la captura) — el marcador no se esquiva cambiando la grafía. Cubre: R7.3 (binding ADR-021).
- [ ] T-DB.6 — Test: `castracion` existe en `field_definitions` (catálogo) — verifica que el literal del trigger matchea el seed (riesgo de binding spec 03 R7.2). Cubre: R7.3.
- [ ] T-DB.7 — Test RLS: un usuario sin rol activo en el establishment NO puede insertar castración/destete/vacunación sobre animales de ese establishment (tenant isolation por animal). Cubre: R9.2.
- [ ] T-DB.8 — Test de la propiedad REAL de `created_by` (H2, corregido): (a) un insert de evento (sanitary/reproductive) que **omite** `created_by` lo recibe defaulteado a `auth.uid()` vía `tg_set_created_by_auth_uid`; (b) la RLS de INSERT (`has_role_in(...)`) **rechaza** un insert sobre un animal de **otro** establishment (sin rol activo) — tenant isolation. NO testear "spoof sobrescrito": el trigger as-built NO fuerza `created_by` (solo-si-NULL), la autoría es spoofeable intra-tenant por diseño heredado (SEC-SPEC-03, design §9 D7). Cubre: R9.3.
- [ ] T-DB.9 — Test: confirmar que NO se creó ninguna tabla nueva, función `SECURITY DEFINER` nueva ni policy RLS nueva (solo seed + reemplazo de trigger). Cubre: R9.4.

## Gate 1 — Security (spec) — antes de Puerta 1

- [ ] T-G1.1 — Correr `security_analyzer` modo `spec` sobre el delta de gating (design §4/§6): verificar fail-closed preservado, binding `castracion`↔destino sin bypass, `revoke execute` intacto, sin cruce de tenants. Output a `progress/security_spec_10-operaciones-rodeo.md`. Bloquea Puerta 1.

## Fase 2 — Cliente: utils puros (ejecutable ya, sin design system)

- [ ] T-CL.1 — `app/src/utils/bulk-candidates.ts`: filtro de candidatos (status active + scope grupo + filtro categoría/sexo). Cubre: R1.3, R4.1.
- [ ] T-CL.2 — Test `bulk-candidates.test.ts`: solo `status='active'`/`deleted_at IS NULL` entran; archivados/baja/soft-deleted se excluyen. Cubre: R1.3.
- [ ] T-CL.3 — `bulk-candidates.ts`: skip-and-report agrupado por motivo (`already_applied` | `wrong_sex_or_category` | `rodeo_data_key_disabled`), incluyendo resolución de rodeo real por animal (lote cross-rodeo). Cubre: R4.3, R4.4, R7.2.
- [ ] T-CL.4 — Test: en lote cross-rodeo, animales cuyo rodeo no tiene el `data_key` se reportan como `rodeo_data_key_disabled` y no se aplican; los demás sí. Cubre: R7.1, R7.2.
- [ ] T-CL.5 — `app/src/utils/bulk-idempotency.ts`: clave idempotente por (animal, tipo, fecha) + generación del **`id` (PK) determinístico OBLIGATORIO** (UUIDv5 sobre namespace fijo + esa clave). NO un UUID random; NO "opcional/chequeo-local a elección". El id determinístico es la barrera dura que cierra el escenario de sync concurrente (M2). Cubre: R6.1.
- [ ] T-CL.6 — Test: (a) re-ejecutar la misma op sobre el mismo animal/fecha NO produce un segundo evento (skip `already_applied`); (b) **misma clave → mismo `id` UUIDv5** (determinismo verificable) de modo que un re-sync de la misma mutación colisiona en la PK y no duplica, incluso desde dos devices concurrentes. Cubre: R6.1, R6.2, R6.3.
- [ ] T-CL.7 — Test: el preview cuenta solo eventos nuevos (animales ya procesados no se recuentan). Cubre: R6.2, R4.2.

## Fase 3 — Cliente: service + hooks (depende de RodeoContext/PowerSync de spec 02 C1/C2)

- [ ] T-CL.8 — `app/src/services/bulk-operations.ts`: arma conjunto, genera N mutaciones PowerSync (insert evento por animal) en batch, encola offline. Reusa el camino de carga individual de spec 02. Cubre: R3.1, R3.2, R3.3, R3.4, R10.1, R10.5.
- [ ] T-CL.9 — `bulk-operations.ts`: destete genera un `reproductive_events weaning` por **ternero** (mellizos: uno por cada uno). Cubre: R3.2, R3.5.
- [ ] T-CL.10 — `bulk-operations.ts`: vacunación masiva → `sanitary_events vaccination` con `product_name` de pre-config; castración masiva → `sanitary_events treatment` + marcador. Cubre: R3.1, R3.3.
- [ ] T-CL.11 — `bulk-operations.ts`: mutaciones independientes (no transacción atómica); expone progreso de sync "X de N" + rechazos por animal vía path de spec 09 R11.5. Cubre: R10.2, R10.3, R10.4.
- [ ] T-CL.12 — Test: si la sync falla a mitad, los exitosos quedan persistidos (no rollback) y los fallidos se reportan por animal con motivo. Cubre: R10.2, R10.3.
- [ ] T-CL.13 — `app/src/hooks/useGroupAnimals.ts` + `useBulkOperation.ts`: orquestan lista + preview → aplicar → reportar. Cubre: R1.1, R4.2.

## Fase 4 — Cliente: UI (TENTATIVA — tras design system + frontend de spec 02/09)

- [ ] T-UI.1 — `GroupViewScreen.tsx`: vista de grupo (rodeo o lote) con config + lista de animales (reusa `AnimalListItem` de spec 09) + `GroupActionsBar`. NO redefine lista ni service de rodeo. Cubre: R1.1, R1.2.
- [ ] T-UI.2 — `GroupActionsBar.tsx`: ofrece solo las 3 ops MVP, gated por `rodeo_data_config` (rodeo) / "algún rodeo del lote" (lote). Cubre: R1.4, R1.5, R1.6, R7.1.
- [ ] T-UI.3 — Inicio rodeo-céntrico (evolución de la home de spec 01/02): cards de rodeo + cards de lote; tap → `GroupViewScreen`. NO reabre ADR-018. Cubre: R2.1, R2.2.
- [ ] T-UI.4 — Confirmar que la tab `Animales` (spec 09) queda intacta (no se le agrega gestión de grupo). Cubre: R2.3.
- [ ] T-UI.5 — `BulkOperationScreen.tsx`: filtro de alcance (categoría/sexo) + preview "N eventos sobre M animales" + "K saltados (motivos)" + confirmación explícita. Cubre: R4.1, R4.2, R4.3.
- [ ] T-UI.6 — `BulkOperationScreen.tsx`: en destete, animales con `category_override=true` se avisan ("no van a transicionar") + opción de revertir el override (spec 02 R4.10). Cubre: R5.6.
- [ ] T-UI.7 — `BulkOperationScreen.tsx`: pantalla de progreso con contador "X de N sincronizados" + lista de rechazos por animal (spec 09 R11.5). Cubre: R10.3, R10.4.
- [ ] T-UI.8 — Corrección individual: confirmar que cada evento creado es editable/borrable por owner/autor desde la ficha (reuso spec 09 / spec 02 R6.8.1), recalculando categoría si aplica. Cubre: R4.5.
- [ ] T-UI.9 — E2E (Playwright, web — extender `app/e2e/`): flujo vacunación masiva sobre un rodeo (preview → confirmar → N eventos). Cubre: R3.1, R4.2.
- [ ] T-UI.10 — E2E: destete masivo con un animal `category_override=true` (avisado, no transiciona) + un mellizo (un evento por ternero). Cubre: R3.5, R5.5, R5.6.

## Notas de TENTATIVO / DEFERIDO (no implementar en MVP)

- [ ] T-DEF.1 — (DEFERIDO Facundo) Efecto de categoría de la castración (R5.7): el evento se crea (T-CL.10) pero NO se aplica transición de categoría. No implementar hasta confirmación.
- [ ] T-DEF.2 — (DEFERIDO Tier 2 Facundo) Transición de categoría del destete (R5.5): el evento `weaning` se crea (T-CL.9) pero la rama de transición vive en spec 02 (DEFERIDO Tier 2); no se agrega acá hasta que Facundo confirme los targets.
- [ ] T-DEF.3 — (DIFERIDO/fuera de MVP) Marca en la madre al destetar: no implementar.

## Mapa de cobertura R → tasks (el implementer completa `progress/impl_10-operaciones-rodeo.md` con R → archivo:test)

| R<n> | Tasks |
|---|---|
| R1.1 | T-CL.13, T-UI.1 |
| R1.2 | T-UI.1 |
| R1.3 | T-CL.1, T-CL.2 |
| R1.4 / R1.5 / R1.6 | T-UI.2 |
| R2.1 / R2.2 | T-UI.3 |
| R2.3 | T-UI.4 |
| R3.1 / R3.3 | T-CL.10, T-DB.1, T-DB.2 |
| R3.2 / R3.5 | T-CL.9 |
| R3.4 | T-CL.8 |
| R4.1 | T-CL.1, T-UI.5 |
| R4.2 | T-CL.7, T-CL.13, T-UI.5 |
| R4.3 / R4.4 | T-CL.3, T-UI.5 |
| R4.5 | T-UI.8 |
| R5.5 | T-CL.9, T-UI.10, T-DEF.2 |
| R5.6 | T-UI.6 |
| R5.7 | T-DB.2, T-DEF.1 |
| R6.1 / R6.2 / R6.3 | T-CL.5, T-CL.6, T-CL.7 |
| R7.1 | T-CL.4, T-UI.2 |
| R7.2 | T-CL.3, T-CL.4 |
| R7.3 | T-DB.3, T-DB.4, T-DB.5, T-DB.6 |
| R9.1 | T-DB.7 (autorización = la del evento individual; sin grant nuevo) |
| R9.2 | T-DB.7 |
| R9.3 | T-DB.8 |
| R9.4 | T-DB.9 |
| R10.1 / R10.5 | T-CL.8 |
| R10.2 | T-CL.11, T-CL.12 |
| R10.3 / R10.4 | T-CL.11, T-CL.12, T-UI.7 |
