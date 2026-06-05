# Spec 13 — Hardening de seguridad (baseline) — Design

**Status**: spec_ready. **Fuente de verdad**: `context.md`. **Insumo**: `progress/security_baseline_shipped.md`.

> **SCHEMA/RLS-SENSITIVE → Gate 1 (`security_analyzer` modo `spec`) OBLIGATORIO** antes de la Puerta 1 humana (ADR-019). La feature agrega `CHECK`s a tablas con `establishment_id`, **recrea la policy RLS `animals_update`**, y modifica el manejo de errores y la invalidación de sesión en Edge Functions con service-role. Todo esto cae en los dominios A (authz), B (exposición), F (inyección), H (sesión) del catálogo.

> **Multi-tenancy / RLS**: A1-1 (R5) recrea una policy RLS sobre `animals` (tabla global, ADR-004) cuyo aislamiento entre tenants es el punto del fix. INPUT-1 (R1) agrega CHECKs a 15 tablas, la mayoría con `establishment_id` o `animal_profile_id` (scopeadas por RLS `has_role_in`): `animal_profiles`, `animal_events`, `establishments`, `rodeos`, `rodeo_data_config`, `management_groups`, `semen_registry`, `weight_events`, `reproductive_events`, `sanitary_events`, `condition_score_events`, `lab_samples`, `sessions`, `maneuver_presets`, más `users`/`invitations`/`push_tokens` (identidad/membresía, scopeadas por self/owner). Los CHECKs son ortogonales a la RLS (se evalúan en cualquier path de escritura, también service-role), pero se menciona RLS explícitamente porque la feature **es** sobre la frontera entre tenants y el cliente attacker-controlled escribe a esas mismas tablas vía PostgREST.

> **Offline-first**: la feature no agrega carga de datos en campo; H1-1 (R9) es relevante al modelo offline futuro (PowerSync, C4) — una sesión revocada no debe re-autorizar mutaciones encoladas. Se documenta el modelo de invalidación pensando en ese futuro, pero no se wirea PowerSync acá.

---

## Numeración de migrations (COORDINACIÓN — leer antes de implementar)

El as-built llega a **0058** (`0058_delete_account_rpc.sql`). Esta spec agrega **2 migrations nuevas** (INPUT-1 y A1-1). **NO** se hardcodea el número (`0059`/`0060`) en la spec: la spec 02 Tier 2 **ya reclama 0059+** y otras specs activas avanzan el as-built en paralelo. El número concreto se asigna **al implementar**, tomando el siguiente libre en ese momento.

- **Dependencia de coordinación**: si en el momento de implementar otra spec ya tomó `0059`/`0060`, esta spec usa los siguientes libres. El implementer debe `Glob supabase/migrations/*.sql`, tomar el máximo y continuar. Anotar el número real en `progress/impl_13-*.md`.
- Convención de nombres as-built: `00NN_check_text_length_caps.sql` (INPUT-1) y `00MM_animals_update_with_check.sql` (A1-1). `NN < MM` para que el orden lexicográfico respete el orden lógico, pero **son independientes** (no hay dependencia de datos entre ellas).
- **NO se reabren** las migrations viejas (0001/0002/0019/0020/0022/0034). Todo es `ALTER`/`create or replace policy` en migrations nuevas.

---

## INPUT-1 (R1, R2) — CHECKs de largo

### Archivo nuevo: `supabase/migrations/00NN_check_text_length_caps.sql`

Agrega un CHECK por **cada** columna de texto-libre/`jsonb` de usuario escribible por un miembro de la tabla R1.1–R1.45. La superficie es completa: barre **todas** las tablas con `grant insert/update to authenticated` + write-policy positiva (verificado vía grep — ver §Reconciliación en requirements). Dos patrones según tipo:

- **`text`** → `CHECK (char_length(col) <= N)`.
- **`jsonb`** → `CHECK (octet_length(col::text) <= N)` (tope de **bytes** del jsonb serializado; mismo patrón que `sessions.config`/`maneuver_presets.config` en 0050/0051). Aplica a `establishments.plan_limits` (16384), `rodeo_data_config.custom_config` (16384), `animal_events.structured_payload` (32768).

Tablas tocadas (15): `users`, `establishments`, `invitations`, `push_tokens`, `rodeos`, `rodeo_data_config`, `animals`, `animal_profiles`, `weight_events`, `semen_registry`, `reproductive_events`, `sanitary_events`, `condition_score_events`, `lab_samples`, `animal_events`, `management_groups`, `sessions`, `maneuver_presets`.

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

- `not valid` + `validate constraint` separa la creación (rápida, no bloquea) de la validación (que escanea filas existentes). Si hubiera datos legados fuera de rango, el `validate` falla **visiblemente** (no corrompe silenciosamente). **Esperado**: no hay datos fuera de rango en el beta actual (single-beta, sin import masivo todavía — spec 12 sin código). El implementer puede correr un `select count(*) ... where char_length(col) > N` (o `octet_length(col::text) > N` para jsonb) de pre-check antes de migrar y abortar con mensaje claro si encuentra algo (decisión menor, documentar en el archivo).
- Para columnas que admiten `NULL` (la mayoría de las de texto-libre y todos los `jsonb` nullable), `char_length(NULL) <= N` / `octet_length(NULL) <= N` es `NULL` → el CHECK **pasa** (no rechaza NULL). Correcto (R1.47): no se vuelve la columna NOT NULL. Para `establishments.plan_limits` (`not null default '{}'`), nunca es NULL → el CHECK siempre evalúa, sin cambio de comportamiento para `{}`.
- Naming: `<tabla>_<col>_len_chk` (text) / `<tabla>_<col>_size_chk` (jsonb bytes). Todos en un solo archivo, con un comentario de cabecera mapeando a R1.x y citando la spec.
- Cerrar con `notify pgrst, 'reload schema';`.

### Techos (de la tabla R1, reconciliada — por clase)

- **Identificadores/códigos cortos (32–64)**: `animals.tag_electronic` 32, `reproductive_events.calf_tag_electronic` 32, `animal_profiles.{idv,visual_id_alt,breed,coat_color}` 64, `lab_samples.tube_number` 64, `semen_registry.breed` 64, `establishments.plan_type` 64.
- **Nombres (120)**: `users.name`, `rodeos.name`, `management_groups.name`, `maneuver_presets.name`, `semen_registry.{pajuela_name,bull_name}`, `animal_profiles.entry_origin`, `sessions.work_lot_label`.
- **Teléfono (32)**: `users.phone`.
- **Nombre de campo / producto / proveedor / destino / ingrediente (160)**: `establishments.name`, `semen_registry.supplier`, `sanitary_events.{product_name,active_ingredient}`, `lab_samples.lab_destination`, `push_tokens.device_id`.
- **Provincia/ciudad (96)**: `establishments.{province,city}`.
- **Email (320)**: `users.email`, `invitations.email`.
- **Token (512)**: `invitations.token`, `push_tokens.token`.
- **Notas/resultados/interpretaciones (4000)**: `animal_profiles.notes`, `animal_events.text`, `weight_events.notes`, `condition_score_events.notes`, `sessions.notes`, `semen_registry.notes`, `reproductive_events.notes`, `sanitary_events.{result,notes}`, `lab_samples.{result,result_interpretation,notes}`.
- **`jsonb` (bytes)**: `establishments.plan_limits` 16384, `rodeo_data_config.custom_config` 16384, `animal_events.structured_payload` 32768.

**Excluidas** (R1.48, con justificación): `animal_profiles.exit_reason` (enum, 0044); numéricas (`numeric(7,2)`/`numeric(3,2)` etc.), `date`/`time`/`boolean`; enums (`animal_status`, `score`, `pregnancy_status`/`service_type`, `sanitary_event_type`/`route`, `lab_sample_type`, `session_status`, `event_source`, `user_role`, `invitation_status`); `push_tokens.platform` (ya CHECK de enum); `sessions.config` y `maneuver_presets.config` (`jsonb` **ya** topado `< 16384` en 0050/0051 → no se duplica el CHECK); catálogos globales read-only sin grant de escritura a `authenticated` (`species`, `systems_by_species`, `categories_by_system`, `field_definitions`, `system_default_fields`).

### Decisión `tag_electronic` / `calf_tag_electronic` (R1.49)

**Solo techo de largo (R1.15 = 32 para `animals.tag_electronic`; R1.29 = 32 para `reproductive_events.calf_tag_electronic`)**, NO un CHECK de formato 15 díg en esta spec. Justificación: el cliente ya valida el formato FDX-B (15 díg) como UX; agregar un CHECK rígido `~ '^[0-9]{15}$'` a nivel DB acoplaría el schema a un formato que puede variar (otros estándares de caravana, importaciones legadas, casos de migración) y arriesga rechazar datos legítimos en el import masivo futuro (spec 12). El techo de 32 corta el abuso (storage exhaustion) sin acoplar formato. La **inmutabilidad** del `tag_electronic` (que un atacante no lo reescriba) ya la cubre el trigger de A1-1/0036 (ver R5.5) — ese es el control de integridad relevante, no el formato. (`calf_tag_electronic` no tiene trigger de inmutabilidad propio: es un campo de evento que se completa al cargar el parto; solo necesita el techo de largo.)

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

### Archivo nuevo: `supabase/migrations/00MM_animals_update_with_check.sql`

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

## H1-1 (R9, R10) — invalidar sesión del target

### Archivos a modificar: `supabase/functions/remove_member/index.ts`, `supabase/functions/change_member_role/index.ts`

Tras el write de `user_roles` (después del `update active:false` en `remove_member`; después del split en `change_member_role`), invalidar la sesión del **target**:

```ts
// Hardening del cascarón (H1-1): RLS ya niega acceso con el rol inactivo; esto
// revoca la sesión activa del target para no esperar al jwt_expiry (1h) y blindar
// el caso offline futuro (C4). Fail-soft: si falla, se loguea y NO se revierte el
// cambio de rol (la barrera primaria es user_roles.active).
try {
  const { error: signOutErr } = await adminClient.auth.admin.signOut(targetUserId, 'global');
  if (signOutErr) console.error('[remove_member signOut]', signOutErr);
} catch (e) {
  console.error('[remove_member signOut threw]', e);
}
```

### Modelo de invalidación (R9.3 — punto crítico, distinto de `delete_account`)

`delete_account` usa el **access token del request** para `signOut(accessToken, 'global')` porque el target **es** el caller (ver su NOTA DE IMPLEMENTACIÓN: la Auth Admin API `signOut(jwt, scope)` espera el access token, no un UUID). En `remove_member`/`change_member_role` el target es **otro** usuario y el caller (owner) **no tiene** el access token del target.

El implementer debe usar la API que invalida por **user id**, no por access token. Opciones a verificar contra la versión de `@supabase/supabase-js` / GoTrue del proyecto, en orden de preferencia:
1. `auth.admin.signOut(userId, scope)` **si** la versión acepta user id (algunas versiones aceptan el id; otras solo el JWT — **verificar en implementación**, es la incógnita técnica de esta tarea).
2. Si `signOut` solo acepta JWT: revocar los refresh tokens del target por user id (endpoint admin de GoTrue / `auth.admin.updateUserById` no revoca sesiones; la vía correcta suele ser el endpoint admin `logout` por user o invalidar sesiones — confirmar API disponible).
3. Fallback documentado si ninguna API por-user-id está disponible en la versión actual: registrar la limitación y dejar el `active:false` como única barrera (RLS), anotando la deuda — pero esto sería **no cumplir R9**, así que solo si se confirma que la API no existe (escalar al leader antes de aceptar el fallback).

El design **no** cierra cuál de las 3 porque depende de la versión exacta de la lib (a verificar al implementar, igual que el número de migration). Lo que sí fija: (a) apunta a `targetUserId`, NO al token del caller (R9.3); (b) fail-soft con `console.error`, sin revertir el rol (R9.4); (c) no expone el error al cliente (R9.5).

### Alternativa descartada (H1-1)

**Bajar `jwt_expiry` global** (config.toml) para acortar la ventana. Descartada: degrada la UX de **todos** los usuarios (refresh más frecuente, peor offline) para mitigar un caso puntual, y es un cambio de config (fuera de SDD, como H2-1/CORS). La invalidación dirigida al target es quirúrgica.

---

## Resumen de archivos

| Acción | Archivo | Finding | R<n> |
|--------|---------|---------|------|
| Crear | `supabase/migrations/00NN_check_text_length_caps.sql` (45 CHECKs sobre 15 tablas; `char_length` para text, `octet_length(::text)` para jsonb) | INPUT-1 | R1 |
| Crear | `supabase/migrations/00MM_animals_update_with_check.sql` | A1-1 | R5 |
| Modificar | `supabase/functions/_shared/errors.ts` (helper `serverError`) | B1-1 | R3 |
| Modificar | `supabase/functions/_shared/auth.ts` (`requireOwnerOf` 500 genérico) | B1-1 | R3.3 |
| Modificar | 8× `supabase/functions/*/index.ts` (reemplazar 5xx crudos) | B1-1 | R3.2 |
| Modificar | `supabase/functions/remove_member/index.ts` (signOut target) | H1-1 | R9.1 |
| Modificar | `supabase/functions/change_member_role/index.ts` (signOut target) | H1-1 | R9.2 |
| Modificar | `app/src/services/animals.ts` (rama `.or()` parametrizada + tope término) | F1-1 | R7 |
| Modificar | `app/app/(tabs)/animales.tsx` (`maxLength` del TextInput) | F1-1 | R7.4 |
| Crear | constante `SEARCH_TERM_MAX_LENGTH` (utils compartido) | F1-1 | R7.3 |
| Crear/extender | tests en `supabase/tests/*` (INPUT-1, A1-1, F1-1, H1-1 vía SQL/PostgREST/EF directo) + util pura F1-1 | todos | R2/R4/R6/R8/R10 |

---

## Notas para Gate 1 (`security_analyzer` modo `spec`)

1. **A1-1 alcance**: el `with check == using` cierra `with check (true)` y alinea el patrón, pero el caso "co-tenant muta un animal compartido donde **sí** tiene rol" no lo bloquea ninguna policy (es acceso legítimo por diseño); la integridad del identificador la sostiene el trigger 0036 (R5.5). Confirmar que esto es suficiente o si el finding exige column-level write authz (sería scope nuevo → escalar).
2. **INPUT-1 datos legados + cobertura completa**: el `not valid` + `validate` falla visible ante datos fuera de rango; confirmar que no rompe migraciones en entornos con datos (beta actual: sin import masivo). La cobertura es **completa** (45 columnas / 15 tablas, barrido de todas las tablas con `insert/update` a `authenticated` — resuelve SPEC-HIGH-1, Path A). Los `jsonb` (`plan_limits`, `custom_config`, `structured_payload`) usan tope de **bytes** (`octet_length(::text)`); `sessions.config`/`maneuver_presets.config` quedan fuera por estar **ya** topadas (0050/0051).
3. **H1-1 API por-user-id**: la invalidación de sesión de un usuario que no es el caller depende de la API de GoTrue/supabase-js disponible — incógnita a verificar al implementar; si no existe API por user id, escalar antes de aceptar fallback.
4. **B1-1 completitud**: verificar las ~32 ocurrencias (grep `jsonError(5\d\d, ...message)` + `_shared/auth.ts:44`) — ninguna debe quedar propagando `.message`.
