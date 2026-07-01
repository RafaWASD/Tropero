# Security Gate 1 (modo `spec`) — Delta NOMBRE/APODO por rodeo (#2) sobre spec 02

**Feature**: `02-nombre-apodo` · Delta Nivel B (ADR-028) · CON BACKEND (seed `0119`) · Gate 1 condicional.
**Input**: `specs/active/02-modelo-animal/{requirements,design,tasks,context}-nombre-apodo.md`.
**Fecha**: 2026-07-01.
**Metodología**: trace data-flow del seed contra el as-built (`0018`/`0093`/`0101`/`0094`/`0095`/`0096`) + sync rules (`rafaq.yaml`), verify exploitability antes de reportar.

---

## Veredicto: **FAIL**

La **postura de seguridad del seed es limpia** (RLS, gating fail-closed, no-fuga cross-tenant, no-auto-enable, validación de input server-side: todo verificado y correcto). El FAIL es por **un (1) finding HIGH de correctitud de migración que me fue delegado verificar explícitamente (foco 2)**: la cláusula `on conflict` de la migración `0119` está moldeada sobre el índice de `0093` (predicado viejo), pero `0101` **redefinió** ese índice. Con el predicado tal como está escrito, **`0119` aborta al aplicarse** (`ERROR: there is no unique or exclusion constraint matching the ON CONFLICT specification`) → el deploy que el leader aplica por MCP sobre la DB remota compartida falla. No debe deployarse hasta foldear el fix.

---

## Finding HIGH-1 — `on conflict ... where` STALE: matchea `0093`, no el índice vigente de `0101` → la migración aborta

**Severidad**: HIGH-confidence. **Clase**: RAFAQ-SPECIFIC / correctitud de migración dentro del remit de Gate 1 (foco 2 delegado por el leader: *"verificá que es el índice correcto y que no hay una violación de constraint que rompa la migración"*).

**Evidencia — lo que la spec dice:**

- `requirements-nombre-apodo.md` **RNA.1.2** (cita literal):
  > `on conflict (establishment_id, data_key) where establishment_id is not null do nothing`), respetando el índice único parcial `field_definitions_data_key_per_est` **de `0093`**.

- `design-nombre-apodo.md` §SQL del seed, L100-101 (cita literal):
  > ```sql
  > on conflict (establishment_id, data_key) where establishment_id is not null
  > do nothing;
  > ```

- `design-nombre-apodo.md` L109 (cita literal — **afirmación FALSA**):
  > `on conflict ... where establishment_id is not null` incluye el predicado del índice **parcial** `field_definitions_data_key_per_est` (Postgres lo exige para inferir un índice parcial). Todas las filas insertadas tienen `establishment_id` no-NULL → **la inferencia matchea**.

**Evidencia — lo que el as-built VIGENTE dice:**

El índice `field_definitions_data_key_per_est` fue **DROP + RECREATE** por `0101_field_definitions_data_key_partial.sql` (L39-42), posterior a `0093`, con un predicado **distinto**:

```sql
-- 0093 (predicado que la spec cita):
create unique index field_definitions_data_key_per_est
  on public.field_definitions (establishment_id, data_key)
  where establishment_id is not null;

-- 0101 (predicado VIGENTE — el que existe hoy en el remoto):
drop index if exists public.field_definitions_data_key_per_est;
create unique index field_definitions_data_key_per_est
  on public.field_definitions (establishment_id, data_key)
  where establishment_id is not null and deleted_at is null;   -- ← + deleted_at is null
```

Confirmado por `grep`: no hay ninguna migración posterior a `0101` que re-toque ese índice → el predicado vigente es el de `0101`.

**Por qué rompe (exploitability = la migración aborta, verificado por semántica de Postgres):**

La inferencia de índice-árbitro de `ON CONFLICT` con `index_predicate` exige que el **predicado del índice esté implicado por** la cláusula `WHERE` provista (`predicate_implied_by(idxPredicate, on_conflict_where)`):

- índice vigente (`0101`): `establishment_id is not null AND deleted_at is null`
- `WHERE` provisto por `0119`: `establishment_id is not null`
- ¿`establishment_id is not null` implica `establishment_id is not null AND deleted_at is null`? **NO** — una fila soft-deleteada (`deleted_at` no-NULL) satisface el `WHERE` provisto pero NO el predicado del índice. La implicación falla.

→ Postgres **no puede inferir el árbitro**, no encuentra otro índice único sobre `(establishment_id, data_key)` (el otro, `field_definitions_data_key_global`, es sobre `(data_key)` solo, columnas distintas), y aborta:
`ERROR: 42P10: there is no unique or exclusion constraint matching the ON CONFLICT specification`. Como todo corre en `begin; ... commit;`, **la migración entera hace rollback**. La idempotencia de RNA.1.2 tampoco se cumple (una re-corrida también aborta).

Esto es exactamente el gotcha registrado: *"moldear sobre el cuerpo VIGENTE en el remoto (una migración posterior pudo re-definirlo), no sobre la migración que cita la spec"*. La spec citó `0093` y nunca menciona `0101`.

**Fix a foldear (antes del deploy):**

1. En `design-nombre-apodo.md` (SQL del seed, L100) y en `requirements-nombre-apodo.md` **RNA.1.2**, cambiar la cláusula a:
   ```sql
   on conflict (establishment_id, data_key) where establishment_id is not null and deleted_at is null
   do nothing;
   ```
2. Actualizar la cita del índice de **`0093`** a **`0101`** (la definición vigente) en RNA.1.2, en el §As-built del design (que hoy documenta solo el predicado de `0093` en L14-16), y en la nota del design L109.
3. Agregar una nota as-built en el design: *"`0101` redefinió `field_definitions_data_key_per_est` a predicado parcial `establishment_id is not null and deleted_at is null`; el `ON CONFLICT` debe replicar ese predicado completo para que Postgres infiera el índice-árbitro."*

**Nota de trazabilidad**: el `spec_author` no puede usar `on conflict on constraint <nombre>` como atajo — un índice parcial **no** es un constraint, así que la inferencia por predicado es la única vía; el predicado debe ser el de `0101`, exacto.

---

## Findings MEDIUM

**Ninguno.** Los demás vectores del foco de Gate 1 se verificaron y están correctos (ver Dominios revisados). No hay ambigüedad de seguridad sin resolver más allá del HIGH-1.

---

## Verificaciones de seguridad que PASAN (foco delegado 1, 3, 4, 5)

| # foco | Claim de la spec | Verificado contra as-built | Resultado |
|---|---|---|---|
| 3 | El guard `tg_field_definitions_custom_guard` deja pasar el INSERT del seed (`auth.uid()` NULL en migración) | `0093` L87-89: `if auth.uid() is null then return new;` — early-return antes de exigir `is_owner_of`. El seed corre service-role sin `auth.uid()` → pasa el guard. Además el INSERT satisface los CHECKs de `0093`: `data_key='apodo'` (slug `^[a-z0-9_]+$`, ≤64), `label='Nombre / apodo'` (≤80), `category='identificacion'` (≤32), `data_type='propiedad'` ∈ set, `ui_component='text'` ∈ los 7 (con est no-NULL, satisface `field_definitions_custom_ui_component_valid`). | **OK** |
| 1 | El seed per-est no fuga a otros tenants | RLS `field_definitions_select` (`0093` L161-165): fila custom (`establishment_id` no-NULL) visible solo con `has_role_in(establishment_id)`. Sync: `est_field_definitions_custom` (`rafaq.yaml` L238-243) scopea `establishment_id IN org_scope AND deleted_at IS NULL`; `catalog_field_definitions` (L56-59) es **solo** `establishment_id IS NULL` → la fila per-est del apodo **no** sale por el stream global. Ningún device sin rol en el est la recibe. | **OK — sin fuga cross-tenant (RNA.6.1)** |
| 1 | El seed no queda enabled por default | `0119` no toca `system_default_fields`. `tg_rodeos_seed_data_config` (`0018` L133-146) pre-pobla `rodeo_data_config` **solo** desde `system_default_fields` → el apodo (que no está ahí) nunca se auto-habilita en rodeos nuevos. Enable solo por opt-in del owner vía `set_rodeo_config` (`0082`, owner-only). | **OK (RNA.6.2)** |
| 4 | Ninguna carga de `custom_attributes` del apodo escapa el gating | `assert_custom_field_enabled` (`0096` L18-36): **fail-closed** — rodeo no resoluble → `23514`; solo acepta si `rodeo_data_config.enabled=true` para ese `field_definition_id` en el rodeo del animal. Data-driven por `field_definition_id` (el id ES la clave, sin check de tenant necesario porque el fd es per-est y el gating resuelve el rodeo del propio animal). Ningún animal recibe un `custom_attribute` de un fd de otro tenant (el fd per-est solo se habilita en rodeos de su propio est vía owner). | **OK (RNA.6.3)** |
| 4 | El value del apodo valida como string | `assert_custom_value_valid` (`0096` L70-72): `ui_component='text'` → `jsonb_typeof(value)` debe ser `'string'`, si no `23514`. Rama `else` fail-closed. | **OK** |
| 5 | Remover el built-in `visual_id_alt` del alta no regresa RLS server-side | Es una remoción de input de UI (deja de escribir `visual_id_alt` desde el alta); la columna y su RLS siguen. No agrega superficie de input. El display read-only `prefillKind==='visual'` se conserva (RNA.2.3). Sin implicancia server-side. | **OK** |

---

## Tabla de inputs (campos que el usuario tipea, tocados por el delta)

| campo | límite (largo/charset/formato/rango) | validación (server / solo-cliente / ausente) | OK? |
|---|---|---|---|
| **apodo** (nuevo, `custom_attributes.value`, `ui_component='text'`) | Tipo: string JSON. Largo: `octet_length(value::text) < 4096` (cap server-side, `0095` L27 `custom_attributes_value_size`). Charset: texto libre (sin restricción semántica — aceptable para un apodo). | **Server-autoritativa**: (a) tipo string por `assert_custom_value_valid` (`0096`); (b) cap de largo por CHECK de columna (`0095`). Reusa el mecanismo custom ya Gate-1'd en spec 03. El sanitizador del form (RN) es UX adicional, no el control. | **Sí** |
| ~~`visual_id_alt` "Nombre / seña"~~ (**removido** del alta por RNA.2.1) | n.a. — se elimina el input editable; no se escribe más desde el alta. | n.a. (columna + su validación server siguen intactas para datos legacy en la ficha). | **Sí (menos superficie)** |
| identificador precargado read-only (`prefillKind==='visual'`, conservado, RNA.2.3) | No editable en el alta (ya comprometido en el buscador, spec 09). | No es input nuevo del alta. | **Sí** |

Nota: el delta **no crea un input path nuevo** — opta un fd semántico ("apodo") dentro del mecanismo `custom_attributes` existente, que ya tiene tipo + cap de largo autoritativos server-side. Cumple el requisito de Raf (límite claro + validación server por cada campo de entrada).

---

## Tabla de rate limits (acciones abusables tocadas por el delta)

| acción | rate limit | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| Seed `0119` (INSERT backfill) | n.a. | n.a. | n.a. | Corre **una vez** por migración (service-role, lo aplica el leader por MCP). No es un endpoint expuesto ni bulk repetible por atacante. Sin fan-out por request de cliente. |
| Habilitar apodo por rodeo (`set_rodeo_config`, reusado) | n.a. (fuera del delta) | per-owner (RPC owner-only, `0082`) | sí (RLS owner) | El delta no toca este RPC; sin superficie nueva. |
| Carga de `custom_attributes` del apodo (reusado) | n.a. (fuera del delta) | per-animal/rodeo (gating fail-closed `0096`) | sí (`assert_custom_field_enabled`) | El delta no agrega camino nuevo de escritura; reusa el gateado. |

No hay acción nueva que mande email/SMS, pegue a API externa, ni endpoint bulk/import nuevo. Ninguna migración afloja `[auth.rate_limit]` en `config.toml`. Sin findings de rate limiting.

---

## Dominios de seguridad revisados

- **A1 (service-role bypassa RLS)**: el seed corre service-role (bypassa RLS por diseño de migración). Cada fila lleva su `establishment_id` real de `establishments e` (scoping correcto por-tenant). No es una query de admin-client sin filtro de tenant — es un backfill 1-a-1 por establecimiento. **OK.**
- **A2 (mass assignment)**: n.a. — INSERT server con lista de columnas fija (no spread de input de cliente).
- **A3 (IDOR por FK)**: el fd referencia `establishment_id` = `e.id` (del propio est); las cargas de `custom_attributes` resuelven el rodeo desde `animal_profiles` (gating `0096`). Sin FK atacante-controlada. **OK.**
- **RLS de `field_definitions`/`rodeo_data_config`/`custom_attributes`**: no se reabre ni relaja ninguna policy (RNA.5.2); el seed reusa `0093`/`0096`/`rafaq.yaml` sin cambios. **OK.**
- **Idempotencia / conflicto de constraint**: **FALLA** → Finding HIGH-1.
- **Guard `tg_field_definitions_custom_guard` en path service-role**: **OK** (early-return con `auth.uid()` NULL).
- **Multi-tenant isolation / streams (PowerSync/`rafaq.yaml`)**: **OK** (per-est scope, sin fuga).
- **Gating fail-closed de captura custom (`0096`)**: **OK.**
- **Validación de input (apodo, texto libre)**: **OK** (tipo + cap server-side).
- **Onboarding (spec 01)**: backfill-only, **sin trigger** sobre `establishments` (DP2 diferida) → el path de onboarding no se toca (RNA.6.5). **OK.** (La decisión de diferir el trigger por el riesgo de orden-alfabético de disparo vs. el guard es correcta y bien fundamentada.)
- **Colisión de numeración de migración**: highest existente = `0118`; `0119` libre. **OK.**

## Dominios excluidos (con justificación)

- **B (exposición de datos), F (inyección/ingesta/SSRF), G (BLE), E2/E3 (denial-of-wallet/bot), H (auth/sesión), I (compliance)**: el delta no toca Edge Functions, respuestas de error al cliente, `fetch()` externos, BLE, endpoints de costo, flujos de auth/sesión ni borrado/retención. Fuera de alcance de este delta.
- **C (offline/sync)**: el apodo fluye por el patrón soft-fail ya existente (`CustomPropertiesForm` → `custom_attributes`); sin camino de sync nuevo. Los streams relevantes se verificaron (dominio A/multi-tenant). Sin superficie nueva.
- **Column-level over-fetch (B3)**: el fd apodo no expone PII de otros miembros; es un dato del animal. n.a.

---

## Anexo LOW (no bloqueante)

- **LOW-1 — "resurrección" de un apodo soft-deleteado por el backfill.** Con el predicado **corregido** (`... and deleted_at is null`), si un establecimiento tuviera un `apodo` fd **soft-deleteado** (`deleted_at` no-NULL) y ninguno activo, el backfill insertaría un apodo **activo** nuevo (el slot activo está libre en el índice parcial de `0101`). Es el comportamiento intencional de `0101` y no rompe nada, pero conviene tenerlo presente: en beta no hay `apodo` real seedeado (context L20: *"era solo test data"*), así que el escenario es improbable. No requiere cambio; solo documentar el comportamiento esperado en el test backend T2 (RNA.8.3). No es un hueco de seguridad.
- **LOW-2 — DP3 (`category='identificacion'`) sin implicancia de seguridad.** Correcta; agrupa el fd en su sección. Sin impacto en RLS/gating. Nota informativa.

---

## Cobertura de la skill / advertencia

Este es un review **modo `spec`** (metodología de la skill `sentry-skills:security-review` aplicada a nivel de diseño: trace del data-flow del seed contra el as-built + verify exploitability). La skill de Sentry cubre indirectamente Postgres/RLS/PowerSync — la verificación de la semántica de inferencia de `ON CONFLICT` sobre índice parcial y el diff `0093`→`0101` se hizo por **revisión manual del as-built** (no cubierto por la skill genérica). El gate `code` (post-implementer) debe re-verificar el SQL real de `0119` contra el índice vigente antes del deploy por MCP.
