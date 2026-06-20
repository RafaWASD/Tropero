# Security Gate (modo `code`) — spec-03 MODO MANIOBRAS · chunk M7 (gestión de rutinas + datos custom: editar/borrar)

**Veredicto: PASA**

- **Índice parcial `0101`**: SEGURO para deploy. No abre colisión cross-tenant, no permite apropiarse un `data_key` ajeno, no rompe la inmutabilidad/owner-only de `0093`.
- **Owner-only / role-scoping server-side del borrado y la edición**: CORRECTO. La autorización vive en RLS + guard SECURITY DEFINER, no en la UI. La UI (`isOwner`, kebab ⋯) es puramente cosmética y está documentada como tal.
- **Sin findings HIGH.** Un (1) hallazgo LOW (comentario stale, no explotable) en el anexo.

Baseline: `7285197a23a170895b182a2518bc2df7acc94d67` (registrado en `progress/impl_03-m7.md`). Todos los cambios M7 están en el working tree (sin commitear); `git diff <baseline>..HEAD` de código = vacío, consistente con la consigna.

---

## 1. Veredicto sobre el índice parcial `0101` — ¿seguro para deploy?

**SÍ, seguro.** Archivo: `supabase/migrations/0101_field_definitions_data_key_partial.sql:39-42`.

```sql
drop index if exists public.field_definitions_data_key_per_est;
create unique index field_definitions_data_key_per_est
  on public.field_definitions (establishment_id, data_key)
  where establishment_id is not null and deleted_at is null;
```

Análisis de regresión de aislamiento de tenant:

1. **El scope del UNIQUE NO cambia.** Sigue siendo `(establishment_id, data_key)`. Dos establishments distintos pueden tener el mismo `data_key` desde `0093` (ese era el objetivo de relajar el UNIQUE global a per-est). El predicado nuevo NO toca esa propiedad: angosta el conjunto de filas que el índice vigila (excluye soft-deleteadas), no amplía qué filas colisionan. **No hay vector de colisión cross-tenant nuevo.** Un INSERT/UPDATE de `(est_B, key)` jamás colisiona con `(est_A, key)` — ni antes ni después.
2. **No se puede apropiar un `data_key` de otro establishment.** El `establishment_id` es **inmutable** post-creación (guard `tg_field_definitions_custom_guard`, `0093:110-118`, errcode 42501) y el INSERT/UPDATE owner-only (RLS `field_definitions_insert`/`_update`, `is_owner_of`, `0093:166-175`) fuerza que la fila pertenezca a un establishment del que el caller es owner. El índice no participa de la autorización; solo define unicidad del slot dentro de un tenant ya autorizado.
3. **El otro índice queda INTACTO.** `field_definitions_data_key_global` (UNIQUE de las globales, `establishment_id IS NULL`, `0093:38-39`) no se toca. La invariante "una sola global de fábrica por `data_key`" se conserva. El cliente authenticated nunca puede crear/editar globales (guard `0093:92-95`, 42501).
4. **El predicado nuevo es estrictamente MÁS permisivo** (excluye más filas del índice). No puede introducir una violación del UNIQUE sobre filas que ya cumplían el predicado viejo — todo lo que pasaba sigue pasando; lo único que ahora "pasa de más" es liberar el slot de una fila soft-deleteada, que es justamente el fix de R13.35 (borrar+recrear un dato mal clasificado). No hay filas custom soft-deleteadas en prod todavía (el borrado custom es lo que M7 recién construye) → `CREATE UNIQUE INDEX` no puede abortar por violación preexistente.
5. **Sin RLS/policy/función tocada.** `0101` solo hace `DROP INDEX` + `CREATE UNIQUE INDEX` + `NOTIFY pgrst`. Cero `CREATE FUNCTION`, cero `SECURITY DEFINER`, cero `GRANT EXECUTE` (ver §4). No reabre superficie de authz.

**Caveat operativo (no de seguridad):** queda pending-deploy y el test backend `(o)` en `supabase/tests/custom/run.cjs` solo verdea tras aplicarlo. El gate no bloquea por esto — es decisión de deploy de Raf, ya gateada.

---

## 2. Veredicto sobre owner-only / role-scoping server-side (borrado + edición)

**CORRECTO. La autorización es server-side; la UI no es la frontera.** Verifiqué los dos caminos:

### 2a. Datos custom (editar/borrar) — owner-only autoritativo

- **Borrado** (`softDeleteCustomField`, `custom-fields.ts:250-256`) = `UPDATE field_definitions SET deleted_at = datetime('now') WHERE id = ? AND deleted_at IS NULL` (`local-reads.ts:buildSoftDeleteCustomFieldUpdate`). UPDATE plano CRUD-plano (no RPC).
- **Edición** (`updateCustomField`, `custom-fields.ts:200-229`) = `UPDATE field_definitions SET label = ?, config_schema = ? WHERE id = ? AND deleted_at IS NULL`.
- Ambos pasan por la RLS `field_definitions_update` (**`is_owner_of(establishment_id)`**, `0093:170-175`) **+** el guard `tg_field_definitions_custom_guard` que corre `before insert OR UPDATE` (`0093:155-157`). El guard, en el UPDATE-path:
  - rechaza no-owner (`0093:98-101`, 42501);
  - **bloquea spoofeo de identidad/tenant**: cambiar `establishment_id`/`data_type`/`data_key`/`ui_component` → 42501 (`0093:110-118`). Un payload malicioso que intente re-tipar o mover el dato a otro tenant es RECHAZADO server-side aunque el cliente lo arme a mano contra PostgREST;
  - revalida caps de options (cardinalidad 1..50, ≤60 c/u) en el UPDATE-path (`0093:132-150`, 23514).
- La UI gatea Editar/Eliminar tras `isOwner` y muestra el kebab ⋯ solo en filas custom (`editar-plantilla.tsx:287,355,375,384,394,409` + `FieldTemplateToggleList.tsx` `onCustomAction`/`isCustomField`). **Esto es cosmético** — el comentario `custom-fields.ts:104` lo dice explícito ("la UI ya gateó… el rechazo de no-owner es el backstop") y el server es el backstop real. Un no-owner que escriba directo a PostgREST es rebotado por la RLS+guard, no por la app.
- Caps de input autoritativos server-side: `label` ≤80 (`field_definitions_label_len`, `0093:46`), `config_schema` <4096 bytes (`field_definitions_config_size`, `0093:47`), `data_key` ≤64 + slug `^[a-z0-9_]+$` (`0093:72-73`). Ver tabla de inputs.

### 2b. Rutinas/presets (renombrar/reconfigurar/borrar) — role-scoped por tenant

- **Borrado** (`softDeletePreset`) = RPC SECURITY DEFINER `soft_delete_maneuver_preset` (`0057:17-32`) que re-valida **`has_role_in(v_est)`** (42501 si no) y deriva el `establishment_id` de la fila del preset (no del cliente).
- **Renombrar/Reconfigurar** (`updatePreset`, `local-reads.ts:2512` `UPDATE maneuver_presets SET name=?, config=? WHERE id=? AND deleted_at IS NULL`) pasa por la RLS `maneuver_presets_update` (**`has_role_in(establishment_id)`**, `0051:37-39`).
- **R2.10 "cualquier rol" NO es un hueco**: es by-design. Los presets son workflow compartido del equipo del establishment; `has_role_in` (cualquier rol operativo del tenant) es el control correcto, NO owner-only. Cross-tenant SÍ está cerrado: un user sin rol en ese establishment recibe 42501. El `editPresetId` es solo un route-param que elige qué preset cargar en el wizard; no transporta authority.
- Cap server-side del nombre: `maneuver_presets_name_len_chk char_length(name) <= 120` (validado, `0070:269-270`) + not-empty (`0051:16`). Cliente capea a 60 (UX).

**Conclusión:** un no-owner (custom) o un user sin rol en el tenant (presets), o un payload spoofeado (cambiar `establishment_id`, re-tipar, exceder caps), es RECHAZADO server-side — no solo escondido en UI.

---

## 3. Findings HIGH de Sentry (skill `sentry-skills:security-review`)

**Ninguno.** No se identificaron vulnerabilidades de alta confianza. Razonamiento (traza de data-flow + exploitability, validado manualmente):

- **Sin inyección SQL.** Todos los builders nuevos (`buildSoftDeleteCustomFieldUpdate`, `buildUpdateCustomFieldUpdate`, `buildCustomFieldEnabledRodeoCountQuery`, `buildCustomFieldCaptureCountQuery`, `local-reads.ts`) usan SQL parametrizado con `args: [...]` (placeholders `?`). Cero concatenación de input de usuario en strings SQL. El `label`/`config_schema` van como bind params, no interpolados.
- **Sin mass-assignment / over-posting.** `updateCustomField` arma el UPDATE con columnas fijas (`label`, `config_schema`) — no spreea el body del cliente. `establishment_id`/`data_type`/`data_key`/`ui_component` nunca se mandan (e incluso si se mandaran, el guard `0093` los rechaza por inmutabilidad). El soft-delete solo setea `deleted_at`.
- **Sin IDOR explotable.** El `fieldDefinitionId`/`presetId` que el cliente pasa NO confiere acceso: la RLS (`is_owner_of`/`has_role_in`) y el guard re-derivan el `establishment_id` de la fila y validan el rol del caller contra ese tenant. Un id de otro establishment → 0 filas afectadas / 42501.
- **Sin información-disclosure nueva.** Los errores que se superfician al cliente son mensajes es-AR construidos por la app (`AppError.message`), no `err.message` crudo del DB. Los rechazos server-side los maneja `uploadData` (descarta + R10.8), no devuelven el error de Postgres al usuario.
- **Sin nuevas funciones/RPC públicas.** Ver §4.
- **Frontera WAL intacta.** Ver §5.

---

## 4. Findings RAFAQ-SPECIFIC

**Ninguno HIGH/MEDIUM.** Checklist RAFAQ aplicado:

- **RLS testeada cross-tenant**: el camino reusa policies de `0093`/`0051`/`0057` ya gateadas (no se agregan policies nuevas en M7). El test backend de `0101` (`run.cjs` caso `(o)`) incluye control negativo "dos vivas mismo slug = 23505". Pending-deploy.
- **Edge Functions nuevas**: ninguna en M7. N/A.
- **Triggers nuevos**: ninguno. El guard `0093` (ya existente) cubre el UPDATE-path por `before insert OR update`. `0101` no agrega triggers.
- **Secrets**: ningún secreto hardcodeado ni `console.log` de datos sensibles en el diff. `crypto.randomUUID()` para ids de cliente (no security-token, uso correcto).
- **`createAdminClient()` / service-role**: NO se usa en M7 (todo el camino es cliente authenticated → PostgREST/RPC con RLS). N/A.
- **Sin RPC/EXECUTE público nuevo (lección SEC spec 02)**: CONFIRMADO. `0101` no tiene `CREATE FUNCTION`/`SECURITY DEFINER`/`GRANT EXECUTE` (es solo DROP+CREATE INDEX). El borrado custom es UPDATE plano, no RPC. No quedó ninguna función nueva con EXECUTE para `public`/`authenticated`/`anon`.

---

## 5. Frontera WAL / sync-streams (R13.21)

**INTACTA.** `git diff <baseline>..HEAD` y `git status --porcelain` no muestran cambios en ningún `*.yaml` de `sync-streams/`. M7 no tocó la sync-stream `est_field_definitions_custom` — sigue filtrando `deleted_at IS NULL` + `establishment_id IN org_scope` (Opción B, decidida por Raf). No hay regresión de filtrado de tenant en el WAL. La "desaparición prolija" de R13.30 se logra por el prune de la stream + el filtro `deleted_at IS NULL` en `buildCustomAttributesQuery` (defensa en profundidad), sin replicar datos de otro tenant.

---

## 6. Tabla de inputs (campos nuevos/modificados que el usuario tipea en M7)

| campo | límite | validación | OK? |
|---|---|---|---|
| `label` (editar dato custom, `CustomFieldSheet` modo edit) | ≤80 chars | **server**: CHECK `field_definitions_label_len ≤80` (`0093:46`) + guard re-valida en UPDATE-path. Cliente: `LABEL_MAX=80` (`custom-field.ts:61`, UX) | ✅ |
| opciones de enum (editar, append-only) | 1..50 opciones, ≤60 c/u | **server**: guard `tg_field_definitions_custom_guard` cardinalidad 1..50 + ≤60 en UPDATE-path (`0093:132-150`, 23514). Cliente: `OPTIONS_MAX=50`/`OPTION_LABEL_MAX=60` (UX) | ✅ |
| `config_schema` (JSON serializado) | <4096 bytes | **server**: CHECK `field_definitions_config_size` (`0093:47`) | ✅ |
| nombre de rutina (renombrar, `SavePresetSheet`) | ≤120 (server) / 60 (cliente) + no-vacío | **server**: CHECK `maneuver_presets_name_len_chk ≤120` (validado, `0070:269`) + `maneuver_presets_name_not_empty` (`0051:16`). Cliente: `maxLength=60` (`SavePresetSheet:220`, UX) | ✅ |
| `config` de rutina (reconfigurar, `jornada.tsx` editPresetId) | estructura cerrada (toggles + preconfig derivados del catálogo, no texto libre) | **server**: RLS `has_role_in` en `maneuver_presets_update`; el `config` se compone de ids/flags del catálogo, no input libre del usuario | ✅ |

Sin campos de input nuevos sin cap server-side. Sin buscadores nuevos. Sin texto libre concatenado en `.or()/.filter()`/`ilike`/prompt LLM.

---

## 7. Tabla de rate limits (acciones abusables tocadas por M7)

| acción | rate limit | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| soft-delete / editar dato custom | n.a. | per-tenant vía RLS `is_owner_of` | sí (RLS/guard rechazan) | UPDATE plano local→sync; no manda email/SMS ni pega a API externa; no es bulk; no es endpoint de costo. Acotado por la pertenencia al tenant (owner). Sin fan-out. |
| renombrar / reconfigurar / borrar rutina | n.a. | per-tenant vía RLS/RPC `has_role_in` | sí (42501) | idem: writes locales que sincronizan; sin costo externo ni fan-out. |

No hay acciones nuevas que manden email/SMS, peguen a API externa, sean bulk/import, o sean buscadores. Auth nativo (`config.toml [auth.rate_limit]`) NO tocado por M7. Ningún rate limit aflojado. N/A justificado.

---

## 8. False positives descartados / verificaciones

- **Race LWW en soft-delete (`UNIQUE ps_data__custom_attributes.id`)** — pre-existente, fuera de scope M7 (M5-C.3), ya en backlog. NO se re-reporta.
- **R13.30 Opción B (al borrar, el histórico deja de verse + se advierte)** — decisión de producto de Raf, no bug. NO se reporta.
- **Comentario stale en `custom-field.ts:60`** ("el server no tiene CHECK de label") — INEXACTO: `0093:46` SÍ tiene `field_definitions_label_len ≤80` y es la barrera autoritativa real (el cap server-side existe). No es vulnerabilidad: el control server-side está presente; solo el comentario quedó desactualizado. **LOW / doc-only** — recomendado corregir el comentario al reconciliar specs, pero no bloquea el gate.

---

## 9. Archivos analizados

- `supabase/migrations/0101_field_definitions_data_key_partial.sql` (nuevo)
- `supabase/migrations/0093_field_definitions_custom.sql` (referencia: RLS + guard + índice original)
- `supabase/migrations/0057_soft_delete_maneuver_preset.sql`, `0051_maneuver_presets.sql`, `0070_check_text_length_caps.sql` (referencia: authz/caps de presets)
- `app/src/services/custom-fields.ts`, `app/src/services/powersync/local-reads.ts` (builders nuevos)
- `app/app/editar-plantilla.tsx`, `app/app/maniobra.tsx`, `app/app/maniobra/jornada.tsx`
- `app/src/components/FieldTemplateToggleList.tsx`, `app/src/utils/custom-field.ts`, `app/src/utils/rodeo-template.ts`
- `app/app/maniobra/_components/{ConfirmDeleteSheet,CustomFieldActionsSheet,PresetActionsSheet,CustomFieldSheet,SavePresetSheet}.tsx`
- Verificado AUSENTE de cambios: `supabase/sync-streams/*.yaml`

---

## 10. Cobertura indirecta (advertencias de método)

- La skill `sentry-skills:security-review` no cubre nativamente **RLS de Postgres, triggers SECURITY DEFINER, ni sync-rules de PowerSync** — estos los verifiqué **manualmente** contra `0093`/`0057`/`0051` + el git status del yaml. La conclusión de owner-only/role-scoping y de frontera WAL es revisión manual, no output del skill.
- El **test backend de `0101`** (`run.cjs` caso `(o)`) corre verde solo post-deploy. El veredicto de seguridad sobre el índice es por análisis estático del predicado (más-permisivo, sin regresión), no por ejecución contra la DB viva.
