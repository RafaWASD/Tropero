# Spec 13 — Hardening de seguridad (baseline) — Design

**Status**: in_progress — reconciliado con el AS-BUILT (2026-06-05; migraciones 0070/0071/0072 + EFs desplegadas). **Fuente de verdad**: `context.md`. **Insumo**: `progress/security_baseline_shipped.md` + `progress/impl_13-hardening-seguridad.md` (as-built).

> **SCHEMA/RLS-SENSITIVE → Gate 1 (`security_analyzer` modo `spec`) OBLIGATORIO** antes de la Puerta 1 humana (ADR-019). La feature agrega `CHECK`s a tablas con `establishment_id`, **recrea la policy RLS `animals_update`**, y modifica el manejo de errores y la invalidación de sesión en Edge Functions con service-role. Todo esto cae en los dominios A (authz), B (exposición), F (inyección), H (sesión) del catálogo.

> **Multi-tenancy / RLS**: A1-1 (R5) recrea una policy RLS sobre `animals` (tabla global, ADR-004) cuyo aislamiento entre tenants es el punto del fix. INPUT-1 (R1) agrega CHECKs a 15 tablas, la mayoría con `establishment_id` o `animal_profile_id` (scopeadas por RLS `has_role_in`): `animal_profiles`, `animal_events`, `establishments`, `rodeos`, `rodeo_data_config`, `management_groups`, `semen_registry`, `weight_events`, `reproductive_events`, `sanitary_events`, `condition_score_events`, `lab_samples`, `sessions`, `maneuver_presets`, más `users`/`user_private`/`invitations`/`push_tokens` (identidad/membresía/PII de contacto, scopeadas por self/owner; `user_private` con RLS self-only por feature 14 / 0068). Los CHECKs son ortogonales a la RLS (se evalúan en cualquier path de escritura, también service-role), pero se menciona RLS explícitamente porque la feature **es** sobre la frontera entre tenants y el cliente attacker-controlled escribe a esas mismas tablas vía PostgREST.

> **Offline-first**: la feature no agrega carga de datos en campo; H1-1 (R9) es relevante al modelo offline futuro (PowerSync, C4) — una sesión revocada no debe re-autorizar mutaciones encoladas. Se documenta el modelo de invalidación pensando en ese futuro, pero no se wirea PowerSync acá.

---

## Numeración de migrations (AS-BUILT)

Esta spec agregó **3 migrations nuevas** (números reales asignados al implementar, tomando el siguiente libre):

- **`0070_check_text_length_caps.sql`** (INPUT-1, R1).
- **`0071_animals_update_with_check.sql`** (A1-1, R5).
- **`0072_revoke_user_sessions_rpc.sql`** (H1-1, R9 — agregada en el fix-loop del reviewer al reemplazar el ban por la RPC; ver §H1-1).

`0070 < 0071 < 0072` en orden lexicográfico. **0070 depende de 0068** (feature 14 / `user_private`, ya aplicada): el orden de apply es 0068 → 0070. 0071 y 0072 son independientes entre sí y de 0070 (no hay dependencia de datos). **NO se reabren** las migrations viejas (0001/0002/0019/0020/0022/0034/0036/0068). Todo es `ALTER`/`create or replace policy`/`create function` en migrations nuevas.

---

## INPUT-1 (R1, R2) — CHECKs de largo

### Archivo nuevo: `supabase/migrations/0070_check_text_length_caps.sql`

Agrega un CHECK por **cada** columna de texto-libre/`jsonb` de usuario escribible por un miembro de la tabla R1.1–R1.45. La superficie es completa: barre **todas** las tablas con `grant insert/update to authenticated` + write-policy positiva (verificado vía grep — ver §Reconciliación en requirements). Dos patrones según tipo:

- **`text`** → `CHECK (char_length(col) <= N)`.
- **`jsonb`** → `CHECK (octet_length(col::text) <= N)` (tope de **bytes** del jsonb serializado; mismo patrón que `sessions.config`/`maneuver_presets.config` en 0050/0051). Aplica a `establishments.plan_limits` (16384), `rodeo_data_config.custom_config` (16384), `animal_events.structured_payload` (32768).

Tablas tocadas (15): `users` (solo `name`), `user_private` (`email`/`phone`, ver reconciliación post-feature-14), `establishments`, `invitations`, `push_tokens`, `rodeos`, `rodeo_data_config`, `animals`, `animal_profiles`, `weight_events`, `semen_registry`, `reproductive_events`, `sanitary_events`, `condition_score_events`, `lab_samples`, `animal_events`, `management_groups`, `sessions`, `maneuver_presets`.

> **Reconciliación post-feature-14 (AS-BUILT)**: la feature 14 (migración 0068 `user_private_pii`, aplicada al remoto **antes** que 0070) movió `email` y `phone` de `public.users` a `public.user_private` (RLS self-only, grant `update` a `authenticated`). Por eso el as-built de 0070 pone `user_private_email_len_chk` (320) y `user_private_phone_len_chk` (32) sobre `public.user_private`, y `users` solo conserva `users_name_len_chk` (120). El conteo no cambia (−2 en `users`, +2 en `user_private` = 45/15). **Dependencia de orden de apply: 0068 → 0070** (0070 referencia `user_private`).

Patrón por constraint (mitiga el riesgo de abortar la migration con datos legados, R1.46):

```sql
-- Ejemplo text (no es el archivo final; el implementer expande la tabla R1):
alter table public.animal_profiles
  add constraint animal_profiles_idv_len_chk check (char_length(idv) <= 64) not valid;
alter table public.animal_profiles validate constraint animal_profiles_idv_len_chk;

-- Ejemplo jsonb (tope de bytes del serializado):
alter table public.animal_events
  add constraint animal_events_structured_payload_size_chk
  check (octet_length(structured_payload::text) <= 32768) not valid;
alter table public.animal_events validate constraint animal_events_structured_payload_size_chk;
```

- **Patrón as-built (R1.46/R1.46a/R1.46b/R1.46c)** — clave conceptual: un CHECK `NOT VALID` **igual enforça todos los `INSERT`/`UPDATE` futuros**; Postgres solo saltea la validación de las **filas existentes** al crearlo. O sea, el objetivo de seguridad de INPUT-1 (capear input de usuario de acá en más, contra storage-exhaustion) se cumple con `NOT VALID` solo. El `VALIDATE CONSTRAINT` es únicamente un re-chequeo retroactivo de las filas viejas.
  - **43 columnas limpias** → `add constraint ... not valid` + `validate constraint` (quedan validadas).
  - **2 columnas con basura de e2e** → `add constraint ... not valid` **sin** `validate constraint` (grandfather): `animals.tag_electronic` y `reproductive_events.calf_tag_electronic` (filas legadas de e2e, tags sintéticos de fixtures `animal_test_<ts>_<rand>_<SUFFIX>` de hasta ~45 chars). Los tags reales son 15 díg FDX-B, bien bajo el tope de 64; el `NOT VALID` capea todo input futuro de esas columnas igual. Se grandfatherean (no se mutan ni se borran) las filas legadas. La **limpieza de esa data de e2e** queda como deuda en `docs/backlog.md`.
- **Pre-check de datos legados (DO-block, R1.46c)**: cuenta las filas fuera de rango por columna y, si hay, emite `RAISE NOTICE` listando los violadores **sin abortar** (NO `RAISE EXCEPTION`). Razón: la barrera de seguridad es el CHECK `NOT VALID`, no el pre-check; abortar por basura de e2e ya grandfathereada no aportaba seguridad y bloqueaba el apply. El NOTICE deja traza visible para auditoría. El DO-block sigue contando **todas** las columnas → una violación inesperada futura en otra columna queda visible en el log (no silenciada), aunque ya no aborte. (El primer apply además abortó por la reconciliación con feature 14 — `column "phone" does not exist` —, corregido moviendo los CHECK de `email`/`phone` a `user_private`; ver §reconciliación.)
- Para columnas que admiten `NULL` (la mayoría de las de texto-libre y todos los `jsonb` nullable), `char_length(NULL) <= N` / `octet_length(NULL) <= N` es `NULL` → el CHECK **pasa** (no rechaza NULL). Correcto (R1.47): no se vuelve la columna NOT NULL. Para `establishments.plan_limits` (`not null default '{}'`), nunca es NULL → el CHECK siempre evalúa, sin cambio de comportamiento para `{}`.
- Naming: `<tabla>_<col>_len_chk` (text) / `<tabla>_<col>_size_chk` (jsonb bytes). Todos en un solo archivo, con un comentario de cabecera mapeando a R1.x y citando la spec.
- Cerrar con `notify pgrst, 'reload schema';`.

### Techos (de la tabla R1, reconciliada — por clase)

- **Identificadores/códigos cortos (64)**: `animals.tag_electronic` 64, `reproductive_events.calf_tag_electronic` 64, `animal_profiles.{idv,visual_id_alt,breed,coat_color}` 64, `lab_samples.tube_number` 64, `semen_registry.breed` 64, `establishments.plan_type` 64.
- **Nombres (120)**: `users.name`, `rodeos.name`, `management_groups.name`, `maneuver_presets.name`, `semen_registry.{pajuela_name,bull_name}`, `animal_profiles.entry_origin`, `sessions.work_lot_label`.
- **Teléfono (32)**: `user_private.phone` (movido de `users` por feature 14 / 0068 — ver reconciliación).
- **Nombre de campo / producto / proveedor / destino / ingrediente (160)**: `establishments.name`, `semen_registry.supplier`, `sanitary_events.{product_name,active_ingredient}`, `lab_samples.lab_destination`, `push_tokens.device_id`.
- **Provincia/ciudad (96)**: `establishments.{province,city}`.
- **Email (320)**: `user_private.email` (movido de `users` por feature 14 / 0068 — ver reconciliación), `invitations.email`.
- **Token (512)**: `invitations.token`, `push_tokens.token`.
- **Notas/resultados/interpretaciones (4000)**: `animal_profiles.notes`, `animal_events.text`, `weight_events.notes`, `condition_score_events.notes`, `sessions.notes`, `semen_registry.notes`, `reproductive_events.notes`, `sanitary_events.{result,notes}`, `lab_samples.{result,result_interpretation,notes}`.
- **`jsonb` (bytes)**: `establishments.plan_limits` 16384, `rodeo_data_config.custom_config` 16384, `animal_events.structured_payload` 32768.

**Excluidas** (R1.48, con justificación): `animal_profiles.exit_reason` (enum, 0044); numéricas (`numeric(7,2)`/`numeric(3,2)` etc.), `date`/`time`/`boolean`; enums (`animal_status`, `score`, `pregnancy_status`/`service_type`, `sanitary_event_type`/`route`, `lab_sample_type`, `session_status`, `event_source`, `user_role`, `invitation_status`); `push_tokens.platform` (ya CHECK de enum); `sessions.config` y `maneuver_presets.config` (`jsonb` **ya** topado `< 16384` en 0050/0051 → no se duplica el CHECK); catálogos globales read-only sin grant de escritura a `authenticated` (`species`, `systems_by_species`, `categories_by_system`, `field_definitions`, `system_default_fields`).

### Decisión `tag_electronic` / `calf_tag_electronic` (R1.49)

**Solo techo de largo (R1.15 = 64 para `animals.tag_electronic`; R1.29 = 64 para `reproductive_events.calf_tag_electronic`)**, NO un CHECK de formato 15 díg en esta spec. Justificación: el cliente ya valida el formato FDX-B (15 díg) como UX; agregar un CHECK rígido `~ '^[0-9]{15}$'` a nivel DB acoplaría el schema a un formato que puede variar (otros estándares de caravana, importaciones legadas, casos de migración) y arriesga rechazar datos legítimos en el import masivo futuro (spec 12). El techo de 64 corta el abuso (storage exhaustion; FDX-B real = 15 díg, 64 no permite payloads multi-KB) sin acoplar formato y acomoda los tags sintéticos de fixtures de test (`animal_test_<ts>_<rand>_<SUFFIX>`, hasta ~45 chars) que el tope previo de 32 rechazaba (decisión de Raf, 2026-06-05; ver §Historial de refinamiento, corrección 4). La **inmutabilidad** del `tag_electronic` (que un atacante no lo reescriba) ya la cubre el trigger de A1-1/0036 (ver R5.5) — ese es el control de integridad relevante, no el formato. (`calf_tag_electronic` no tiene trigger de inmutabilidad propio: es un campo de evento que se completa al cargar el parto; solo necesita el techo de largo.)

### Alternativa descartada (INPUT-1)

**`varchar(N)` en vez de `CHECK (char_length <= N)`.** Descartada: cambiar el tipo de columna (`alter column ... type varchar(N)`) reescribe la tabla y toma un lock más fuerte que `add constraint`, y mezcla "tipo" con "límite de negocio". El `CHECK` es ajustable (drop/add) sin reescribir la tabla cuando el techo de `breed` se reajuste al adoptar el catálogo SENASA (spec 08). `CHECK char_length` es además más expresivo para `text` (cuenta caracteres, no bytes — relevante para acentos/UTF-8 en `name`/`notes`), y `varchar(N)` ni siquiera aplica a `jsonb`, donde el tope correcto es de **bytes** (`octet_length(col::text) <= N`): el riesgo de abuso del `jsonb` libre es el peso serializado, no un conteo de caracteres. Por eso INPUT-1 usa dos predicados (`char_length` para `text`, `octet_length(::text)` para `jsonb`) y un solo mecanismo (`CHECK`).

---

## B1-1 (R3, R4) — helper de error genérico en las 8 EFs

### Archivo a modificar: `supabase/functions/_shared/errors.ts`

Agregar un helper que loguea el detalle y devuelve copy genérico:

```ts
// Nuevo. Loguea el detalle real server-side y devuelve copy genérico estable al cliente.
// NUNCA propaga .message del driver (information disclosure de schema, B1-1).
export function serverError(code: string, detail: unknown): Response {
  console.error(`[serverError:${code}]`, detail);
  return jsonError(500, code, 'Error interno, probá de nuevo.');
}
```

- Reusa `jsonError` (mantiene headers/CORS). El `code` estable (`'db_error'` | `'unexpected'`) se conserva para que el cliente diferencie; lo que se elimina es el 3er argumento crudo.
- `jsonError` queda intacto para los 4xx con copy a mano (R3.4).

### Archivos a modificar: las 8 `supabase/functions/*/index.ts` + `_shared/auth.ts`

Reemplazar las ~32 ocurrencias de `jsonError(500, 'db_error', X.message)` y `jsonError(500, 'unexpected', (err as Error).message)` por `serverError('db_error', X)` / `serverError('unexpected', err)`. Lista de EFs (R3.2): `accept_invitation`, `cancel_invitation`, `change_member_role`, `delete_account`, `invite_user`, `register_push_token`, `remove_member`, `resend_invitation`.

En `_shared/auth.ts:44` (`requireOwnerOf`), `throw new HttpError(500, 'db_error', error.message)` propaga al catch de cada EF que lo devuelve con `err.message`. Opciones (design elige; el implementer confirma): (a) cambiar el `HttpError` a un mensaje genérico fijo y loguear `error.message` ahí mismo con `console.error`; (b) dejar que el catch de cada EF lo enrute por `serverError`. **Preferida: (a)** — `HttpError(500, 'db_error', 'Error interno, probá de nuevo.')` + `console.error('[requireOwnerOf]', error)` — así el copy genérico aplica aunque el catch de la EF use el `err.message` del `HttpError` (R3.3).

- `console.error` existente (los `console.error('... unexpected:', err)` de cada catch) se **preserva** (R3.5); el `serverError` agrega su propio log, que es redundante y aceptable (o se consolida — decisión menor del implementer).
- Lado cliente de B1-1 (R3.6): **no se toca** (`app/src/services/*` con `kind:'unknown'`) — queda en backlog.

### Alternativa descartada (B1-1)

**Sanitizar el `.message` con una whitelist de mensajes "seguros" en vez de copy fijo.** Descartada: mantener una lista de qué mensajes de Postgres/Deno son seguros es frágil y propenso a leaks (un mensaje nuevo del driver se filtra por default). El copy fijo + log es fail-closed: nada del driver llega al cliente, nunca.

---

## A1-1 (R5, R6) — recrear `animals_update` con `with check` que re-valida `has_role_in`

### Archivo nuevo: `supabase/migrations/0071_animals_update_with_check.sql`

```sql
-- Recrea animals_update: el with check re-afirma has_role_in sobre algún perfil del animal
-- (espejo del using), cerrando la mutación cross-tenant de un animal compartido (A1-1).
-- animals es global (ADR-004); sin esto, un user del campo A reescribe datos que ve el campo B.
drop policy if exists animals_update on public.animals;
create policy animals_update on public.animals
  for update using (
    exists (
      select 1 from public.animal_profiles ap
      where ap.animal_id = animals.id and has_role_in(ap.establishment_id)
    )
  ) with check (
    exists (
      select 1 from public.animal_profiles ap
      where ap.animal_id = animals.id and has_role_in(ap.establishment_id)
    )
  );
notify pgrst, 'reload schema';
```

- `using` se conserva idéntico al as-built (`0022:35-39`), R5.4. El `with check` pasa de `true` a la misma condición que el `using` (R5.1).
- **Semántica del fix**: con un animal compartido (perfil en A y en B), un user de A pasa el `using` (porque existe un perfil en A donde tiene rol) → puede iniciar el UPDATE; pero el `with check` evalúa la **fila resultante** y vuelve a exigir un perfil donde el user tenga rol. Como `has_role_in` se evalúa contra **todos** los perfiles del animal y el user **sí** tiene rol en A, el check sigue pasando para el animal compartido. **Punto fino a resolver en Gate 1 / implementación**: el caso explotable de A1-1 es un user de A mutando un animal cuyo **único** perfil está en B (no compartido con A) — ese ya lo corta el `using`. El caso "compartido A+B" no lo bloquea ni el using ni el nuevo check (el user tiene rol legítimo en A). El valor real del fix es: (1) cerrar `with check (true)` que hoy **no valida nada** post-update (defensa en profundidad: si el `using` se relajara o hubiera un path que lo saltee, el check ataja); (2) alinear `animals_update` con el patrón del resto de las policies del repo (`animal_profiles_update`, `animal_events_update` ya tienen `using == with check`). La protección **fuerte** de la integridad del identificador la da el trigger de inmutabilidad (R5.5), no la policy. Esto se documenta explícitamente para que Gate 1 evalúe si alcanza o si A1-1 exige además acotar **qué columnas** puede tocar un co-tenant (fuera de alcance hoy — sería un control nuevo, escalar si Gate 1 lo pide).

### R5.5 — inmutabilidad de `tag_electronic` desde el cliente directo

Verificado contra `0036_immutability_identifiers.sql`: el trigger `animals_block_tag_change` es `before update of tag_electronic on public.animals for each row` → dispara en **cualquier** UPDATE de esa columna, incluido el PostgREST directo del cliente (no solo el path RPC). Bloquea `valor → otro valor` y `valor → NULL`, permite `NULL → valor` (asignación inicial). **Conclusión**: el vector "co-tenant reescribe el `tag_electronic` (EID SENASA) que ve el otro campo" ya está cerrado por 0036 a nivel trigger, independientemente de la policy. NO se requiere control adicional (R5.5). Se documenta en la migration de A1-1 como nota.

### Alternativa descartada (A1-1)

**Mover toda la mutación de `animals` a un RPC `SECURITY DEFINER` con authz explícita y revocar el `UPDATE` directo a `authenticated`.** Descartada para esta spec: es un cambio de superficie grande (el cliente hoy hace `UPDATE animals` directo en varios flujos de spec 02/09), tocaría servicios fuera del cluster, y reabre contratos. El `with check` + trigger de inmutabilidad cubre el riesgo concreto de A1-1 con un delta acotado. El patrón RPC queda como candidato si Gate 1 escala el finding a "column-level write authz".

---

## F1-1 (R7, R8) — escaping/parametrización + tope del término

### Archivo a modificar: `app/src/services/animals.ts`

- **R7.1 (preferida)**: reemplazar la rama `.or(\`visual_id_alt.ilike.%${escapeIlike(term)}%\`)` (`:318`) por la forma parametrizada `.ilike('visual_id_alt', \`%${term}%\`)`. Como esa sub-query filtra **una sola** columna (`visual_id_alt`), no necesita `.or()`: `.ilike(column, pattern)` envía el patrón como valor parametrizado (fuera del string de filtro), neutralizando el filter injection de raíz. Los `%`/`_` siguen siendo comodines de `ilike` (parte del patrón intencional); para que un `%` literal del término no actúe de comodín, se conserva un escape **mínimo** de `% _` (no de los metacaracteres de `.or()`, que ya no aplican al no usar `.or()`).
  - Si por alguna razón se mantuviera `.or()` (no preferido), entonces `escapeIlike` debe ampliarse al set completo `% _ , . ( ) : *` + comillas (R7.1 rama b). El design recomienda la **rama parametrizada** y dejar `escapeIlike` solo para comodines de `ilike`.
- **R7.3**: agregar un guard al inicio de `searchAnimals` (o dentro de `classifySearchQuery`) que recorte/rechace el término por encima de `N = 64` chars antes de cualquier query (coherente con el techo de identificadores de INPUT-1; un IDV/visual/TAG legítimo nunca supera eso). Recorte silencioso (truncar a 64) es preferible a rechazo (mejor UX: el operario que pega texto de más igual busca por el prefijo). Documentar la elección.
- **R7.4**: agregar `maxLength={64}` (o la constante compartida) al `TextInput` del buscador en `app/app/(tabs)/animales.tsx:381` (capa de UX).
- **R7.5**: no cambiar las sub-queries que ya usan `.ilike(col, pattern)` / `.eq(col, val)` parametrizados (idv, tag, idv-substring) — ya son seguras; solo la rama `.or()` de visual es el vector.

### Constante de tope

Definir `SEARCH_TERM_MAX_LENGTH = 64` en un módulo de utils compartido (ej. junto a `animal-input.ts`), para que el service (autoritativo) y el `TextInput` (UX) usen la misma fuente. El test puro (R8.3) la importa.

### Alternativa descartada (F1-1)

**Solo agregar `maxLength` al TextInput + ampliar `escapeIlike`, sin tope server-side ni parametrizar.** Descartada: el `maxLength` es client-side (bypasseable, el cliente pega a PostgREST directo) y ampliar el regex de escape es frágil (fácil olvidar un metacaracter). La forma parametrizada elimina la clase de bug; el tope en el service es la capa autoritativa.

---

## H1-1 (R9, R10) — invalidar sesión del target (AS-BUILT: RPC, no ban)

### Archivo nuevo: `supabase/migrations/0072_revoke_user_sessions_rpc.sql`

```sql
create or replace function public.revoke_user_sessions (target_uid uuid)
returns void language plpgsql security definer
set search_path = public as $$
begin
  -- Borra las sesiones del target → revoca sus refresh tokens de forma persistente
  -- (mismo efecto que signOut global, pero por user id). El access-token vigente vive
  -- hasta su exp (~1h), cubierto por RLS. `auth.sessions` con esquema explícito
  -- (auth NO está en search_path); SECURITY DEFINER corre con el dueño (acceso a auth).
  delete from auth.sessions where user_id = target_uid;
end; $$;

-- Blindaje de grants (lección SEC-HIGH-01 / patrón 0042/0055/0058): SECURITY DEFINER +
-- toma target_uid → revocar de los TRES roles cliente; solo service_role la ejecuta.
revoke all on function public.revoke_user_sessions (uuid) from public, authenticated, anon;
grant execute on function public.revoke_user_sessions (uuid) to service_role;
-- + smoke-check fail-closed (estilo 0055/0058): si quedara EXECUTE-able por
--   authenticated/anon/public, la migración FALLA (logout-de-cualquiera).
notify pgrst, 'reload schema';
```

### Archivos a modificar: `supabase/functions/remove_member/index.ts`, `supabase/functions/change_member_role/index.ts`

Tras el write de `user_roles` (después del `update active:false` en `remove_member`; después del split en `change_member_role`), invalidar la sesión del **target** invocando la RPC vía admin-client (service_role):

```ts
// Hardening del cascarón (H1-1): RLS ya niega acceso con el rol inactivo; esto revoca
// la sesión activa del target de forma PERSISTENTE para no esperar al jwt_expiry (~1h) y
// blindar el caso offline futuro (C4). Fail-soft: si falla, se loguea y NO se revierte el
// cambio de rol (la barrera primaria es user_roles.active). No se expone el error al cliente.
try {
  const { error: revokeErr } = await adminClient.rpc('revoke_user_sessions', {
    target_uid: targetUserId,
  });
  if (revokeErr) console.error('[remove_member revoke session]', revokeErr);
} catch (e) {
  console.error('[remove_member revoke session threw]', e);
}
```

### Modelo de invalidación (R9.3 — AS-BUILT, distinto de `delete_account` y del ban inicial)

`delete_account` usa el **access token del request** para `signOut(accessToken, 'global')` porque el target **es** el caller. En `remove_member`/`change_member_role` el target es **otro** usuario y el caller (owner) **no tiene** el access token del target, y `@supabase/supabase-js@2` **NO** expone un `signOut(userId)` (la Auth Admin API `signOut(jwt, scope)` solo acepta el access token).

**Historia del fix (por qué RPC y no ban)**: la implementación inicial usó `updateUserById(targetUserId, {ban_duration:'1s'})` (un ban finito y corto, asumiendo que revocaba los refresh tokens al setearlo). El reviewer + el leader lo probaron **empíricamente inefectivo**: tras el ban de 1s + 2.5s de espera, `refreshSession` con el token original **vuelve a funcionar** — el ban finito solo bloquea el refresh durante la ventana, NO revoca el refresh token de forma persistente. R9.1/R9.2 exigen invalidación **persistente**.

**Mecanismo correcto (as-built)**: replicar lo que hace `signOut(global)` —que internamente borra las sesiones del usuario en `auth.sessions`, dejando los refresh tokens sin poder canjearse— pero **por user id**, vía la RPC `SECURITY DEFINER` `revoke_user_sessions(target_uid)` que ejecuta `DELETE FROM auth.sessions WHERE user_id = target_uid`. **Verificado empíricamente** (no asumido, lección del ban): sobre un user de prueba, tras el `DELETE` + 2s, `refreshSession` con el token original falla persistente con `400 Invalid Refresh Token: Refresh Token Not Found` (control PRE-DELETE: el mismo refresh devolvía sesión válida; `auth.sessions` 2 → 0). El access-token vigente del target vive hasta su `exp` (~1h), cubierto por RLS (`user_roles.active=false` niega datos en cada request) — lo que R9/R10 aceptan para un riesgo MEDIUM. El target puede re-loguear (conserva rol en OTROS campos; no es un ban permanente). Lo que el design fija: (a) apunta a `targetUserId`, NO al token del caller (R9.3); (b) fail-soft con `console.error`, sin revertir el rol (R9.4); (c) no expone el error al cliente (R9.5).

**Blindaje de la RPC (crítico)**: es `SECURITY DEFINER` y toma `target_uid` → si fuera EXECUTE-able por `authenticated`/`anon`/`public`, cualquiera podría `POST /rest/v1/rpc/revoke_user_sessions {target_uid:<otro>}` y desloguear a cualquier usuario (logout-de-cualquiera / DoS de sesión). Por eso: `revoke all ... from public, authenticated, anon` + `grant execute ... to service_role` + un smoke-check fail-closed que aborta la migración si quedara invocable por un rol cliente (patrón 0042/0055/0058, lección SEC-HIGH-01).

> **SPEC-MED-2 RESUELTO**: el residual del ban finito (micro-ventana de lock-out de login del target tras remove/degrade) que la implementación inicial había escalado a la Puerta humana **ya no aplica** — el `DELETE FROM auth.sessions` no banea; el target re-loguea sin ventana. No queda decisión de producto pendiente por este punto.

### Alternativa descartada (H1-1)

**Bajar `jwt_expiry` global** (config.toml) para acortar la ventana. Descartada: degrada la UX de **todos** los usuarios (refresh más frecuente, peor offline) para mitigar un caso puntual, y es un cambio de config (fuera de SDD, como H2-1/CORS). La invalidación dirigida al target es quirúrgica.

**Ban finito (`updateUserById` + `ban_duration:'1s'`)** — descartada tras verificación empírica: el ban finito NO revoca los refresh tokens de forma persistente (el refresh vuelve a funcionar pasada la ventana) → no cumple R9.1/R9.2. Reemplazado por la RPC `DELETE FROM auth.sessions`.

---

## Resumen de archivos

| Acción | Archivo | Finding | R<n> |
|--------|---------|---------|------|
| Crear | `supabase/migrations/0070_check_text_length_caps.sql` (45 CHECKs sobre 15 tablas; `char_length` para text, `octet_length(::text)` para jsonb; `email`/`phone` sobre `user_private` por feature 14; 2 columnas de tag grandfathereadas `NOT VALID` sin `VALIDATE`) | INPUT-1 | R1 |
| Crear | `supabase/migrations/0071_animals_update_with_check.sql` | A1-1 | R5 |
| Crear | `supabase/migrations/0072_revoke_user_sessions_rpc.sql` (RPC `revoke_user_sessions(target_uid)` `SECURITY DEFINER` + grants blindados) | H1-1 | R9 |
| Modificar | `supabase/functions/_shared/errors.ts` (helper `serverError`) | B1-1 | R3 |
| Modificar | `supabase/functions/_shared/auth.ts` (`requireOwnerOf` 500 genérico) | B1-1 | R3.3 |
| Modificar | 8× `supabase/functions/*/index.ts` (reemplazar 5xx crudos) | B1-1 | R3.2 |
| Modificar | `supabase/functions/remove_member/index.ts` (RPC `revoke_user_sessions` del target) | H1-1 | R9.1 |
| Modificar | `supabase/functions/change_member_role/index.ts` (RPC `revoke_user_sessions` del target) | H1-1 | R9.2 |
| Modificar | `app/src/services/animals.ts` (rama `.or()` parametrizada + tope término) | F1-1 | R7 |
| Modificar | `app/app/(tabs)/animales.tsx` (`maxLength` del TextInput) | F1-1 | R7.4 |
| Crear | constante `SEARCH_TERM_MAX_LENGTH` (utils compartido) | F1-1 | R7.3 |
| Crear/extender | tests en `supabase/tests/*` (INPUT-1, A1-1, F1-1, H1-1 vía SQL/PostgREST/EF directo) + util pura F1-1 | todos | R2/R4/R6/R8/R10 |

---

## Notas para Gate 1 (`security_analyzer` modo `spec`)

1. **A1-1 alcance**: el `with check == using` cierra `with check (true)` y alinea el patrón, pero el caso "co-tenant muta un animal compartido donde **sí** tiene rol" no lo bloquea ninguna policy (es acceso legítimo por diseño); la integridad del identificador la sostiene el trigger 0036 (R5.5). Confirmar que esto es suficiente o si el finding exige column-level write authz (sería scope nuevo → escalar).
2. **INPUT-1 datos legados + cobertura completa** (AS-BUILT): el `not valid` enforça todo input futuro; el `validate` (re-chequeo retroactivo) se aplica a las 43 columnas limpias y se **omite** en las 2 columnas de tag con basura de e2e (`animals.tag_electronic` 179 filas, `reproductive_events.calf_tag_electronic` 18 filas → grandfathereadas, `NOT VALID` sin `VALIDATE`; la limpieza de esa data queda en backlog). El pre-check emite `RAISE NOTICE` (no aborta). La cobertura es **completa** (45 columnas / 15 tablas, barrido de todas las tablas con `insert/update` a `authenticated` — resuelve SPEC-HIGH-1, Path A). `email`/`phone` viven en `user_private` (feature 14 / 0068); orden de apply 0068 → 0070. Los `jsonb` (`plan_limits`, `custom_config`, `structured_payload`) usan tope de **bytes** (`octet_length(::text)`); `sessions.config`/`maneuver_presets.config` quedan fuera por estar **ya** topadas (0050/0051).
3. **H1-1 mecanismo de invalidación** (AS-BUILT, incógnita resuelta): `@supabase/supabase-js@2` no expone `signOut(userId)`; el ban finito (`updateUserById` + `ban_duration`) se probó empíricamente inefectivo (no revoca persistente). El as-built usa la RPC `SECURITY DEFINER` `revoke_user_sessions(target_uid)` → `DELETE FROM auth.sessions WHERE user_id = target_uid` (migración 0072, grants blindados, verificada empíricamente). SPEC-MED-2 (micro-lockout del ban) RESUELTO.
4. **B1-1 completitud**: verificar las ~32 ocurrencias (grep `jsonError(5\d\d, ...message)` + `_shared/auth.ts:44`) — ninguna debe quedar propagando `.message`.
