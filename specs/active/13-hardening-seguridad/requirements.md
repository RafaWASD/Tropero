# Spec 13 — Hardening de seguridad (baseline) — Requirements

**Status**: in_progress — **reconciliada con el AS-BUILT** (2026-06-05). Gate 1 PASS + Puerta 1 aprobada + implementación desplegada (migraciones 0070/0071/0072 + EFs); ver §Historial de refinamiento y `progress/impl_13-hardening-seguridad.md`.
**Fecha**: 2026-06-04 (redacción) · 2026-06-05 (reconciliación as-built).
**Fuente de verdad**: `specs/active/13-hardening-seguridad/context.md` (Gate 0 aprobado por Raf, 2026-06-04).
**Insumo técnico**: `progress/security_baseline_shipped.md` (findings INPUT-1, B1-1, A1-1, F1-1, H1-1 con `file:line` + fix).
**Related**: spec 01 (auth, EFs, `remove_member`/`change_member_role`), spec 02 (schema `animals`/`animal_profiles`/`animal_events`, RLS `animals_update`), spec 09 (buscador), ADR-019 (gates de seguridad), ADR-022 (Gate 0), ADR-004 (`animals` global).

> **SCHEMA/RLS-SENSITIVE** — agrega CHECKs, recrea la policy `animals_update`, toca Edge Functions. **Gate 1 (`security_analyzer` modo `spec`) OBLIGATORIO** antes de la Puerta 1 humana (ver `context.md` §Gate 1).

## Premisa

RLS **no** es la única frontera entre tenants y el cliente Expo es **attacker-controlled**: escribe a PostgREST directo, así que todo tope o validación que vive solo en el cliente es UX y se bypassea con un JWT de miembro. Esta spec cierra el cluster code/DB de la auditoría con incrementos acotados sobre el backend ya cerrado de specs 01/02 (**migrations nuevas, NO se reabren las viejas**).

## Alcance (exacto, decidido en Gate 0)

**Dentro**: INPUT-1, B1-1, A1-1, F1-1, H1-1.
**Fuera** (ver `context.md` §Alcance): B3-1 (PII column-level, decisión arquitectónica aparte), E2-1 (rate limit propio de EFs, backlog condicionado a Resend), E3-1 (captcha/email-confirmation), H2-1 / CORS (fixes de config, no por SDD). No-auditables hoy: C (PowerSync), G (BLE), F2/F3 (import/SSRF).
**No foldeado** (decisión `spec_author`, para no inflar): las deudas authz de backlog (L1 `soft_delete_event`, SEC-SPEC-03 `created_by`, VERIFY-001 `register_birth`) **quedan fuera** — son de otra familia (integridad intra-tenant vía RPC/triggers, no parte del cluster cerrado acá) y cada una merece su barrido. Permanecen en `docs/backlog.md`.

---

## Requirements (EARS estricto)

### R1 — INPUT-1: tope de largo server-side en columnas de texto de usuario

Mapea el caso **INPUT-1** de `context.md`. **Cada** columna de texto-libre / `jsonb` de usuario que sea **escribible por un miembro** (tablas con `grant insert/update to authenticated` + policy `with check` positiva → escribibles vía PostgREST directo) y que **no esté ya acotada** por la DB (enum, numérico, `date`, o un CHECK de tamaño preexistente) debe tener un tope autoritativo en la capa de DB:
- columnas `text` → `CHECK (char_length(col) <= N)`;
- columnas `jsonb` → `CHECK (octet_length(col::text) <= N)` (tope de **bytes** del jsonb serializado, consistente con el patrón `octet_length(config::text)` ya usado por `sessions`/`maneuver_presets` en 0050/0051).

Esta es la única capa posible para los inserts que pasan por el cliente directo a PostgREST. El cliente sigue siendo la barrera de UX; el CHECK es la capa autoritativa contra abuso, con **techo holgado** (no espejo exacto del cliente). **La cobertura es completa**: el barrido recorre TODAS las tablas con `insert/update` a `authenticated` (verificado migration por migration vía grep — ver §Reconciliación) y no deja ninguna columna de texto-libre/jsonb de usuario sin tope.

**Tabla de techos reconciliada contra el schema as-built** (verificada migration por migration; ver §Reconciliación abajo). Techos **por clase**: identificadores/códigos cortos 64, teléfono 32, nombres 120, emails 320, tokens 512, nombres de producto/proveedor/destino/ingrediente 160, notas/resultados/interpretaciones 4000, `jsonb` de config 16384 bytes, `jsonb` de payload de evento 32768 bytes.

| ID | Columna | Tabla (migration) | Tipo as-built | Techo server (CHECK) |
|----|---------|-------------------|---------------|----------------------|
| R1.1 | `name` | `users` (0001) | `text` | 120 |
| R1.2 | `phone` | `user_private` (0068) | `text` | 32 |
| R1.3 | `email` | `user_private` (0068) | `text` | 320 |
| R1.4 | `name` | `establishments` (0002) | `text` | 160 |
| R1.5 | `province` | `establishments` (0002) | `text` | 96 |
| R1.6 | `city` | `establishments` (0002) | `text` | 96 |
| R1.7 | `plan_type` | `establishments` (0002) | `text` | 64 |
| R1.8 | `plan_limits` | `establishments` (0002) | `jsonb` | 16384 (bytes) |
| R1.9 | `email` | `invitations` (0004) | `text` | 320 |
| R1.10 | `token` | `invitations` (0004) | `text` | 512 |
| R1.11 | `token` | `push_tokens` (0009) | `text` | 512 |
| R1.12 | `device_id` | `push_tokens` (0009) | `text` | 160 |
| R1.13 | `name` | `rodeos` (0017) | `text` | 120 |
| R1.14 | `custom_config` | `rodeo_data_config` (0018) | `jsonb` | 16384 (bytes) |
| R1.15 | `tag_electronic` | `animals` (0019) | `text` | 64 |
| R1.16 | `idv` | `animal_profiles` (0020) | `text` | 64 |
| R1.17 | `visual_id_alt` | `animal_profiles` (0020) | `text` | 64 |
| R1.18 | `breed` | `animal_profiles` (0020) | `text` | 64 (interino) |
| R1.19 | `coat_color` | `animal_profiles` (0020) | `text` | 64 |
| R1.20 | `entry_origin` | `animal_profiles` (0020) | `text` | 120 |
| R1.21 | `notes` | `animal_profiles` (0020) | `text` | 4000 |
| R1.22 | `notes` | `weight_events` (0025) | `text` | 4000 |
| R1.23 | `pajuela_name` | `semen_registry` (0026) | `text` | 120 |
| R1.24 | `bull_name` | `semen_registry` (0026) | `text` | 120 |
| R1.25 | `breed` | `semen_registry` (0026) | `text` | 64 |
| R1.26 | `supplier` | `semen_registry` (0026) | `text` | 160 |
| R1.27 | `notes` | `semen_registry` (0026) | `text` | 4000 |
| R1.28 | `notes` | `reproductive_events` (0026) | `text` | 4000 |
| R1.29 | `calf_tag_electronic` | `reproductive_events` (0026) | `text` | 64 |
| R1.30 | `product_name` | `sanitary_events` (0027) | `text` | 160 |
| R1.31 | `active_ingredient` | `sanitary_events` (0027) | `text` | 160 |
| R1.32 | `result` | `sanitary_events` (0027) | `text` | 4000 |
| R1.33 | `notes` | `sanitary_events` (0027) | `text` | 4000 |
| R1.34 | `notes` | `condition_score_events` (0028) | `text` | 4000 |
| R1.35 | `tube_number` | `lab_samples` (0029) | `text` | 64 |
| R1.36 | `lab_destination` | `lab_samples` (0029) | `text` | 160 |
| R1.37 | `result` | `lab_samples` (0029) | `text` | 4000 |
| R1.38 | `result_interpretation` | `lab_samples` (0029) | `text` | 4000 |
| R1.39 | `notes` | `lab_samples` (0029) | `text` | 4000 |
| R1.40 | `text` (observación) | `animal_events` (0034) | `text` | 4000 |
| R1.41 | `structured_payload` | `animal_events` (0034) | `jsonb` | 32768 (bytes) |
| R1.42 | `name` | `management_groups` (0037) | `text` | 120 |
| R1.43 | `work_lot_label` | `sessions` (0050) | `text` | 120 |
| R1.44 | `notes` | `sessions` (0050) | `text` | 4000 |
| R1.45 | `name` | `maneuver_presets` (0051) | `text` | 120 |

- **R1.1–R1.45** WHEN un actor escribe (vía PostgREST directo o EF) un valor en la columna cuya longitud (`char_length` para `text`, `octet_length(col::text)` para `jsonb`) excede el techo de la fila correspondiente, THE sistema SHALL rechazar la escritura con error `23514` (check_violation) y no persistir la fila.
- **R1.46** THE sistema SHALL aplicar cada CHECK con `ADD CONSTRAINT ... NOT VALID` (rápido, no escanea filas existentes) de forma que la migration no aborte por datos legados; un CHECK `NOT VALID` **igual enforça todo `INSERT`/`UPDATE` futuro** (Postgres solo saltea la validación de las filas EXISTENTES al crearlo) — ese es el objetivo de seguridad de INPUT-1 (capear input de usuario de acá en más, contra storage-exhaustion). THE `VALIDATE CONSTRAINT` (re-chequeo retroactivo de las filas viejas) es secundario al objetivo de seguridad.
- **R1.46a** (as-built) WHILE una columna está limpia de datos legados fuera de rango, THE migration SHALL aplicar el patrón completo `NOT VALID` + `VALIDATE CONSTRAINT` (43 de las 45 columnas → quedan validadas).
- **R1.46b** (as-built) WHERE una columna tiene datos legados de e2e fuera de rango —`animals.tag_electronic` y `reproductive_events.calf_tag_electronic`, tags sintéticos de test de fixtures `animal_test_<ts>_<rand>_<SUFFIX>` de hasta ~45 chars; los tags reales son 15 díg FDX-B, bien bajo el tope de 64—, THE migration SHALL aplicar **solo** `NOT VALID` (sin `VALIDATE CONSTRAINT`), grandfathereando esas filas sin mutarlas ni borrarlas, mientras el `NOT VALID` capea todo `INSERT`/`UPDATE` futuro de esas columnas (el objetivo de seguridad se cumple igual). THE limpieza de esa data de e2e queda como deuda en `docs/backlog.md`.
- **R1.46c** (as-built) THE pre-check de datos legados (DO-block) SHALL contar las filas fuera de rango por columna y, WHEN existan, emitir `RAISE NOTICE` listando los violadores **sin abortar** la migration (NO `RAISE EXCEPTION`); la barrera de seguridad la da el CHECK `NOT VALID`, no el pre-check, y el NOTICE deja traza visible de qué filas quedaron grandfathereadas para auditoría. THE DO-block SHALL seguir contando TODAS las columnas, de modo que una violación inesperada futura en otra columna quede visible en el log del apply (no silenciada), aunque ya no aborte.
- **R1.47** WHILE un valor está dentro del techo (incluido el `NULL` donde la columna lo admite), THE CHECK SHALL permitir la escritura sin cambios de comportamiento respecto al as-built.
- **R1.48** THE sistema SHALL **excluir** del alcance, con justificación, las columnas que **no** son texto-libre de usuario o que **ya** están acotadas por la DB:
  - **Enum / selector cerrado / numérico / `date`**: `animal_profiles.exit_reason` (enum 0044), `animals.sex`, `reproductive_events.{event_type,service_type,pregnancy_status,calf_sex}`, `sanitary_events.{event_type,route}`, `lab_samples.sample_type`, `condition_score_events.score`, `push_tokens.platform` (CHECK de enum), `weight_events.{weight_kg,source}`, todas las `numeric`/`date`/`time`/`boolean`/`*_status`. No reciben CHECK de largo.
  - **`jsonb` ya acotado**: `sessions.config` y `maneuver_presets.config` ya tienen `octet_length(config::text) < 16384` (0050/0051) → **no** se les agrega un segundo CHECK.
  - **Catálogos globales read-only** (sin `insert/update` a `authenticated`, solo `grant select`): `species`, `systems_by_species`, `categories_by_system`, `field_definitions`, `system_default_fields`. No son escribibles por un miembro → fuera de la superficie de INPUT-1.

> **Reconciliación contra schema as-built** (cumple §Pendientes de `context.md`; barrido completo verificado vía grep de `grant ... insert/update ... to authenticated`):
> - `exit_reason` ya es enum (0044) → **excluida** (no figura en la tabla).
> - `breed` (de `animal_profiles`) sigue `text` (el catálogo SENASA de spec 08 **no** shippeó migration que la cambie — verificado: 0026 es `breed` de `semen_registry`/repro, no `animal_profiles.breed`) → techo **interino** R1.18; se reajusta al adoptar el catálogo. `semen_registry.breed` (R1.25) es independiente.
> - `tag_electronic` vive en `animals` (global, 0019), no en `animal_profiles`; `reproductive_events.calf_tag_electronic` (R1.29) es un identificador análogo en otra tabla → mismo techo de clase (64; ver §Historial 2026-06-05 corrección 4). La decisión "¿CHECK de formato 15 díg además del largo?" se resuelve en design (ver R1.49).
> - `email` (PII de contacto) vive en **`public.user_private` (0068)** — no en `public.users` — y también en `invitations` (0004): Auth valida `auth.users`, pero ni `user_private.email` (R1.3) ni `invitations.email` (R1.9) tienen tope → ambos se acotan.
>   - **Reconciliación post-feature-14 (0068 `user_private_pii`, AS-BUILT, aplicada al remoto ANTES que 0070)**: la feature 14 (`14-pii-user-private`) movió las columnas `email`+`phone` de `public.users` a la tabla nueva `public.user_private (user_id PK FK→users, email NOT NULL, phone, ...)` con RLS self-only (`user_private_select_self`/`user_private_update_self`; grant `select, update` a `authenticated`). El primer apply de 0070 abortó con `column "phone" does not exist` porque se había escrito contra el schema viejo. **Por eso el as-built de 0070** materializa R1.2 (`phone`, techo 32) y R1.3 (`email`, techo 320) sobre `public.user_private.{phone,email}`, no sobre `public.users`; `public.users` conserva solo `name` (R1.1, techo 120). Misma clase de techo, misma justificación (texto de usuario escribible vía PostgREST con grant `update` a `authenticated`, acotado por la RLS self-only). **El conteo total NO cambia: −2 en `users`, +2 en `user_private` = 45 columnas / 15 tablas igual** (`users` no desaparece — sigue siendo tabla con `name`; `user_private` cuenta como la tabla escribible nueva con sus 2 columnas de texto). **Dependencia de coordinación**: 0070 depende de que 0068 (feature 14) ya esté aplicada; el orden de apply es 0068 → 0070.
> - **Columnas `jsonb` de usuario sin tope**: `establishments.plan_limits` (R1.8), `rodeo_data_config.custom_config` (R1.14), `animal_events.structured_payload` (R1.41) → tope de **bytes** vía `octet_length(col::text) <= N`. `sessions.config`/`maneuver_presets.config` ya tope (excluidas, R1.48).
> - **Columnas de eventos/sesiones que el barrido inicial omitió y este refinamiento incorpora**: `weight_events.notes` (R1.22), `condition_score_events.notes` (R1.34), `sessions.{work_lot_label,notes}` (R1.43/R1.44), `maneuver_presets.name` (R1.45), `rodeos.name` (R1.13), `management_groups.name` (R1.42), `push_tokens.{token,device_id}` (R1.11/R1.12), `establishments.{plan_type,plan_limits}` (R1.7/R1.8), `invitations.{email,token}` (R1.9/R1.10), `rodeo_data_config.custom_config` (R1.14).

- **R1.49** (decisión de design, NO un nuevo control por defecto) THE design SHALL pronunciarse sobre si `tag_electronic` (y su análogo `reproductive_events.calf_tag_electronic`) recibe además un CHECK de formato (15 díg FDX-B) o solo el techo de largo R1.15/R1.29; si no se justifica el de formato, el techo de largo es lo único requerido.

### R2 — INPUT-1 (verificación): test PostgREST directo

- **R2.1** THE suite de tests SHALL incluir, por un subconjunto representativo de las columnas de R1.1–R1.45 (al menos un caso por **clase** de techo y por **tipo** — `text` y `jsonb`; justificado en tasks), un caso que **escribe vía PostgREST/SQL directo con un JWT de miembro** (no por la UI) un valor que excede el techo (`techo + 1` chars para `text`; un payload `jsonb` cuyo `octet_length(::text)` excede el tope para `jsonb`) y verifica el rechazo con código `23514`.
- **R2.2** THE muestreo de R2.1 SHALL incluir, además de las columnas de identidad/animal originales, **al menos 2–3 de las tablas incorporadas en este refinamiento** — específicamente `sanitary_events.notes` (clase notas, `text`) y `animal_events.structured_payload` (clase `jsonb`, tope de bytes) — más al menos una de eventos/sesiones (`sessions.notes` o `weight_events.notes`), para evidenciar que la cobertura ampliada es real y no solo declarativa.
- **R2.3** THE mismo test SHALL verificar que un valor de longitud/tamaño `techo` (borde superior aceptado) **persiste** correctamente, para no introducir un falso positivo que rechace input válido.
- **R2.4** THE test SHALL espejar el patrón de los tests de no-bypass cross-tenant existentes (`supabase/tests/rls/run.cjs`): fixtures con service-role, assertion con JWT real de un miembro del tenant.

### R3 — B1-1: copy genérico al cliente en las Edge Functions

Mapea el caso **B1-1** de `context.md`. Ninguna EF debe propagar `err.message` / `(err as Error).message` crudo de Postgres/Deno al cliente (information disclosure de schema).

- **R3.1** THE módulo `_shared/errors.ts` SHALL exponer un helper (ej. `serverError(code)`) que (a) **loguea** el detalle real con `console.error` server-side y (b) devuelve al cliente un **copy genérico estable** (`'Error interno, probá de nuevo.'`) junto con un `code` estable, **sin** incluir el `.message` del driver.
- **R3.2** WHEN cualquiera de las 8 Edge Functions (`accept_invitation`, `cancel_invitation`, `change_member_role`, `delete_account`, `invite_user`, `register_push_token`, `remove_member`, `resend_invitation`) responde un 5xx (rama `db_error` o el catch genérico `unexpected`), THE EF SHALL usar el helper de R3.1 y NO incluir el `.message` crudo en el body de la respuesta.
- **R3.3** WHEN `_shared/auth.ts` `requireOwnerOf` falla por error de query (`HttpError(500, 'db_error', error.message)`), THE helper SHALL dejar de propagar `error.message` al cliente (cierra el leak transversal que alcanza a todas las EFs que llaman `requireOwnerOf`).
- **R3.4** WHILE responde un 4xx de validación/negocio (copy ya redactado a mano: `unauthorized`, `forbidden`, `invalid_input`, `not_found`, `last_owner`, `sole_owner`, `no_change`, etc.), THE EF SHALL conservar ese copy sin cambios (R3 acota **solo** los 5xx con `.message` crudo).
- **R3.5** THE comportamiento de `console.error` server-side existente SHALL preservarse (el detalle sigue yendo a logs; lo que cambia es lo que viaja al cliente).
- **R3.6** (decisión `spec_author`) El lado **cliente** de la entrada de backlog 2026-06-01 (services que muestran `kind:'unknown'` con `message` crudo) **NO** entra en esta spec: es pulido de UX, no un leak server-side, y tocaría `app/src/services/*` fuera del cluster code/DB. Queda anotado en `docs/backlog.md`.

### R4 — B1-1 (verificación)

- **R4.1** THE suite de tests SHALL incluir un caso que fuerza un 5xx en al menos una EF y verifica que el body de respuesta **no** contiene el `message` crudo del driver Postgres/Deno (ni nombres de tabla/columna/constraint/path), solo el copy genérico y el `code` estable de R3.1.

### R5 — A1-1: `animals_update` re-valida `has_role_in` en el `with check`

Mapea el caso **A1-1** de `context.md`. La policy `animals_update` (`0022_rls_animals_and_profiles.sql:34-40`) tiene `with check (true)` → un user con rol solo en el campo A puede mutar la fila de un animal compartido con el campo B (fuga de **integridad**, `animals` es global por ADR-004).

- **R5.1** THE migration nueva SHALL recrear la policy `animals_update` reemplazando `with check (true)` por un `with check` que **re-afirme `has_role_in` sobre algún perfil del animal** (espejo del `using` actual): existe `animal_profiles ap` con `ap.animal_id = animals.id and has_role_in(ap.establishment_id)`.
- **R5.2** WHEN un usuario con rol activo **solo** en el campo A intenta `UPDATE` la fila de `animals` de un animal cuyo perfil activo está en el campo B (no comparte campo con el target), THE policy SHALL rechazar el update (0 filas afectadas / violación de RLS).
- **R5.3** WHILE un usuario tiene rol activo en algún campo donde el animal tiene perfil, THE policy SHALL permitir el `UPDATE` (no romper el caso legítimo del as-built).
- **R5.4** THE migration SHALL preservar el `using` actual sin debilitarlo y emitir `notify pgrst, 'reload schema'`.
- **R5.5** (decisión de design) THE design SHALL verificar que la inmutabilidad de `tag_electronic` desde el cliente directo ya está cubierta por el trigger `animals_block_tag_change` (`0036_immutability_identifiers.sql`) — que dispara en cualquier `UPDATE OF tag_electronic` (RPC o PostgREST directo) — y documentar que NO se requiere control adicional para ese vector; si el design encontrara un hueco, lo escala (no inventa control nuevo acá).

### R6 — A1-1 (verificación): test cross-tenant vía SQL/PostgREST directo

- **R6.1** THE suite de tests SHALL incluir un caso cross-tenant que: crea un animal con perfil en el campo A y perfil en el campo B (animal compartido), y con un JWT de un miembro **solo** del campo A intenta `UPDATE animals SET sex=... / birth_date=...` de esa fila vía PostgREST/SQL directo, verificando que **falla** (0 filas / RLS).
- **R6.2** THE mismo test (o uno hermano) SHALL verificar que un miembro de un campo donde el animal **sí** tiene perfil puede actualizar un campo mutable (control positivo, evita falso bloqueo).
- **R6.3** THE test SHALL escribir/consultar **vía PostgREST/SQL directo** (no por la UI), espejando `supabase/tests/rls/run.cjs`.

### R7 — F1-1: escaping completo / forma parametrizada + tope del término del buscador

Mapea el caso **F1-1** de `context.md`. `escapeIlike` (`animals.ts:341`) solo neutraliza `% _ ,`; la rama `.or(\`visual_id_alt.ilike.%${term}%\`)` (`:318`) construye el filtro como string con input de usuario → PostgREST filter injection (intra-tenant; RLS acota el blast radius al propio campo). Además el término no tiene tope de largo server-side.

- **R7.1** THE servicio de búsqueda (`searchAnimals`) SHALL eliminar el vector de filter injection de la rama `.or()` **o bien** usando la forma parametrizada `.ilike(column, pattern)` (el valor viaja fuera del string de filtro, como ya hacen las sub-queries de idv/tag), **o bien** escapando el set completo de metacaracteres de `.or()` (`% _ , . ( ) : *` y comillas). El design elige y justifica una de las dos (la parametrizada es preferible).
- **R7.2** WHEN el término del buscador contiene metacaracteres de `.or()` (`. ( ) : * % _ ,`), THE servicio SHALL tratarlos como literales del valor a buscar y NO permitir que alteren la estructura del filtro ni introduzcan una condición/columna adicional.
- **R7.3** WHEN el término del buscador excede un tope de largo `N` (definido en design; coherente con INPUT-1, ej. 64), THE servicio SHALL rechazar/recortar el término **server-side en el service antes de la query** (no enviar un término de miles de chars a PostgREST).
- **R7.4** THE `TextInput` del buscador (`app/app/(tabs)/animales.tsx`) SHALL recibir un `maxLength` coherente con R7.3 (capa de UX, no autoritativa).
- **R7.5** THE cambio SHALL preservar el comportamiento funcional de búsqueda del as-built (TAG/IDV exacto, substring numérico, fuzzy visual) para términos legítimos.

### R8 — F1-1 (verificación)

- **R8.1** THE suite de tests SHALL incluir un caso que pasa un término con metacaracteres de `.or()` y verifica que la estructura del filtro **no** se altera (no cruza columnas, no inyecta condición), comparando contra el resultado de un término literal equivalente — ejecutado **vía PostgREST/SQL directo** (no por la UI), reflejando los tests de no-bypass.
- **R8.2** THE suite SHALL incluir un caso de tope de largo: un término por encima de `N` es rechazado/recortado por el service antes de la query (R7.3).
- **R8.3** (donde el escaping/normalización del término sea lógica pura) THE suite PUEDE incluir un test unitario en `app/src/utils`/`app/src/services` que cubra la función de escaping/recorte sin red, complementando R8.1.

### R9 — H1-1: invalidar la sesión del target al remover/degradar miembro

Mapea el caso **H1-1** de `context.md`. `remove_member`/`change_member_role` setean `user_roles.active = false` pero no invalidan la sesión activa del target; su JWT sigue válido hasta `jwt_expiry` (1h). RLS lo corta en cada request (por eso MEDIUM), pero el impacto real aparece con sesiones largas + offline (futuro).

- **R9.1** WHEN `remove_member` desactiva el rol del target (`active = false`), THE EF SHALL además invalidar la sesión del target de forma **persistente** (revocar sus refresh tokens) después del write de `user_roles`, invocando la RPC `revoke_user_sessions(target_uid)`.
- **R9.2** WHEN `change_member_role` degrada/cambia el rol del target (split desactivar viejo + insertar nuevo), THE EF SHALL invalidar la sesión del target de la misma forma (RPC `revoke_user_sessions(target_uid)`), de modo que el siguiente request del target re-autentique con el rol nuevo.
- **R9.3** (as-built) THE mecanismo de invalidación SHALL apuntar a `targetUserId` (un usuario **distinto** del caller) — NO al access token del request (ese patrón de `delete_account` solo sirve para auto-baja, donde el caller ES el target y tiene el access token). Dado que `@supabase/supabase-js@2` NO expone un `signOut(userId)` (la Auth Admin API `signOut(jwt, scope)` solo acepta el ACCESS TOKEN, que el owner no posee), THE mecanismo SHALL ser una RPC `SECURITY DEFINER` `public.revoke_user_sessions(target_uid uuid)` (migración **0072**) que ejecuta `DELETE FROM auth.sessions WHERE user_id = target_uid` — borrar las sesiones del target revoca sus refresh tokens de forma **persistente** (mismo efecto que `signOut(global)`, pero por user id; verificado empíricamente: el refresh con el token original posterior al delete falla con `400 Refresh Token Not Found`). THE access-token vigente del target vive hasta su `exp` (~1h), cubierto por RLS (`user_roles.active=false` ya niega datos en cada request) — lo que R9/R10 aceptan para un riesgo MEDIUM. THE RPC SHALL tener grants blindados: `revoke all ... from public, authenticated, anon` + `grant execute ... to service_role` + un smoke-check fail-closed que aborta la migración si la RPC quedara EXECUTE-able por un rol cliente (es `SECURITY DEFINER` y toma `target_uid` → un grant a cliente sería un logout-de-cualquiera invocable vía PostgREST). Las EFs la invocan vía admin-client (service_role).
- **R9.4** WHILE la invalidación de auth es hardening del cascarón (RLS ya niega acceso), IF la llamada a la RPC falla, THE EF SHALL loguear el error con `console.error` y NO revertir el cambio de rol ya consumado (el write de `user_roles` es la barrera primaria) — mismo criterio fail-soft que `delete_account` para su signOut.
- **R9.5** THE EF SHALL NO exponer el detalle del error de invalidación al cliente (coherente con R3).

### R10 — H1-1 (verificación)

- **R10.1** THE suite de tests SHALL incluir un caso **determinista** (no timing-based) que: con un owner, remueve a un miembro vía `remove_member`, y verifica que la sesión previa del target queda invalidada. THE test SHALL incluir un control explícito PRE-invoke (el refresh con el token previo DEBE producir sesión antes de la remoción → descarta el falso positivo de un token ya inválido) y, tras invocar la EF, assertar que el refresh con ese mismo token POST-invoke FALLA (`refreshErr && !session`), sin `sleep` ni ventana temporal (el `DELETE FROM auth.sessions` es persistente).
- **R10.2** THE suite SHALL incluir el caso análogo determinista para `change_member_role` (degradación).
- **R10.3** THE tests de H1-1 PUEDEN correr en la suite de Edge Functions (`supabase/tests/edge/run.cjs`), que ya ejercita EFs con JWTs reales.

---

## Trazabilidad — cada "Caso y decisión" de `context.md` → ≥1 R<n>

| Caso (`context.md`) | Requirements |
|---------------------|--------------|
| INPUT-1 — tope de largo server-side (techo holgado) | R1 (R1.1–R1.49), R2 |
| B1-1 — no exponer `err.message` crudo | R3 (R3.1–R3.6), R4 |
| A1-1 — `animals_update with check (true)` | R5 (R5.1–R5.5), R6 |
| F1-1 — filter injection `.or()` + término sin tope | R7 (R7.1–R7.5), R8 |
| H1-1 — sesión no invalidada al remover/degradar | R9 (R9.1–R9.5), R10 |

Cada criterio del `acceptance` de `feature_list.json` (5 ítems) queda cubierto: acceptance[0]→R1/R2, acceptance[1]→R3/R4, acceptance[2]→R5/R6, acceptance[3]→R7/R8, acceptance[4]→R9/R10.

---

## Historial de refinamiento

- **2026-06-04** — Redacción inicial (`spec_author`) a partir de `context.md` (Gate 0 aprobado por Raf) + `progress/security_baseline_shipped.md`. Tabla de techos reconciliada contra el schema as-built: `exit_reason` excluida (enum 0044), `breed` con techo interino (catálogo de spec 08 sin shippear), `tag_electronic` ubicada en `animals` (0019). Deudas authz de backlog (L1/SEC-SPEC-03/VERIFY-001) **no foldeadas** (justificado en §Alcance). Lado cliente de B1-1 **no foldeado** (R3.6).
- **2026-06-05** — **Reconciliación AS-BUILT** (post-implementación + deploy; fuente: `progress/impl_13-hardening-seguridad.md` con sus 3 fix-loops + migraciones reales 0070/0071/0072 + EFs `remove_member`/`change_member_role`). Las 3 correcciones reales que la implementación introdujo y la spec no reflejaba (IDs de requirements **preservados**, no se reordenó nada):
  1. **INPUT-1 (R1) — `email`/`phone` en `user_private`, no en `users`**: la feature 14 (`14-pii-user-private`, migración 0068, ya desplegada antes de 0070) movió esas 2 columnas de `public.users` a `public.user_private` (RLS self-only). El as-built de 0070 pone el CHECK de `email` (320) y `phone` (32) sobre `public.user_private`; `users` conserva solo `name` (120). Tabla R1 actualizada (R1.2/R1.3 → `user_private (0068)`) + nota de reconciliación con la dependencia/orden de apply (0068 → 0070). Conteo sin cambios: 45 columnas / 15 tablas.
  2. **INPUT-1 (R1.46) — grandfather de datos legados + pre-check no-abortivo**: el as-built NO aplica `NOT VALID` + `VALIDATE` a las 45 columnas uniformemente. Las 43 columnas limpias → `NOT VALID` + `VALIDATE` (validadas); `animals.tag_electronic` y `reproductive_events.calf_tag_electronic` tienen tags sintéticos de e2e fuera de rango → quedan `NOT VALID` **sin** `VALIDATE` (grandfather; el `NOT VALID` igual capea todo input futuro = el objetivo de seguridad se cumple, porque `NOT VALID` enforça los `INSERT`/`UPDATE` futuros y solo el `VALIDATE` re-chequea filas viejas). El pre-check pasó de `RAISE EXCEPTION` (abortaba) a `RAISE NOTICE` (lista violadores, no aborta). R1.46 reescrito + sub-líneas R1.46a/R1.46b/R1.46c (as-built). La limpieza de la data de e2e queda como deuda (backlog). _(El tope de tag/calf_tag pasó de 32 a 64 en la corrección 4 del 2026-06-05 — ver abajo.)_
  3. **H1-1 (R9/R10) — mecanismo RPC en vez de ban**: la implementación inicial usó `updateUserById(target, {ban_duration:'1s'})`, que se probó **empíricamente inefectivo** (tras el ban de 1s el refresh token vuelve a funcionar — no revoca persistente). El as-built lo reemplazó por la RPC `SECURITY DEFINER` `revoke_user_sessions(target_uid)` (migración **0072**) que hace `DELETE FROM auth.sessions WHERE user_id = target_uid` (revoca refresh tokens persistente, mismo efecto que `signOut(global)` por user id; verificado: refresh → `400 Refresh Token Not Found`), con grants blindados (revoke de public/authenticated/anon + smoke-check fail-closed, solo service_role). `remove_member`/`change_member_role` la llaman vía admin-client. R9.1/R9.2/R9.3 reescritos; R10.1/R10.2 ahora deterministas (no timing). **SPEC-MED-2 (micro-lockout del ban finito) queda RESUELTO** — ya no hay ban, el target re-loguea sin ventana de lock-out.
  - **Numeración de migraciones**: las dos de INPUT-1/A1-1 quedaron **0070** (`check_text_length_caps`) y **0071** (`animals_update_with_check`); la nueva de H1-1 quedó **0072** (`revoke_user_sessions_rpc`). Se reemplazaron los placeholders `00NN`/`00MM`/`TBD`.
  - **Corrección 4 (2026-06-05, decisión de Raf)** — **INPUT-1 (R1) — techo de `tag_electronic`/`calf_tag_electronic` de 32 → 64**: el techo server-side de `animals.tag_electronic` (R1.15) y `reproductive_events.calf_tag_electronic` (R1.29) sube de **32 a 64**. Razón: la convención de fixtures de test (`animal_test_<ts>_<rand>_<SUFFIX>`) produce tags de hasta ~45 chars; el tope de 32 rompía 7 tests de la suite de spec 02; 64 los acomoda y sigue capeando abuso (FDX-B real = 15 díg; 64 no permite payloads multi-KB / storage exhaustion). Solo se tocó este techo de clase: `user_private.phone` sigue **32**, `user_private.email` **320**, el resto sin cambios. R1.15/R1.29 + las notas de clase (design §Techos / §Decisión R1.49) + tasks T2 actualizadas; IDs de requirements **preservados** (solo cambió el valor del techo, no se reordenó ni renumeró nada). No se tocó código, migraciones ni `feature_list.json`.
- **2026-06-04** — Refinamiento Gate 1 (resolución de **SPEC-HIGH-1**, `progress/security_spec_13-hardening-seguridad.md`). **Path A (ampliar INPUT-1 a TODA la superficie de texto-libre/jsonb attacker-controlled)**, decisión del leader: el requisito original de Raf es "límite + validación en CADA campo"; acotar la promesa (Path B) no era aceptable. R1 pasó de **14 a 45 columnas** (`R1.1–R1.45`). Se agregaron las del finding (`reproductive_events.notes`, `semen_registry.*`, `sanitary_events.*`, `lab_samples.*`, `rodeos.name`, `management_groups.name`, `animal_events.structured_payload`) **más** las que un grep propio de TODAS las tablas con `grant insert/update to authenticated` + write-policy positiva reveló y que el finding no listaba: `establishments.{plan_type,plan_limits}`, `invitations.{email,token}`, `push_tokens.{token,device_id}`, `rodeo_data_config.custom_config`, `weight_events.notes`, `condition_score_events.notes`, `reproductive_events.calf_tag_electronic`, `sessions.{work_lot_label,notes}`, `maneuver_presets.name`. Columnas `jsonb` (`plan_limits`, `custom_config`, `structured_payload`) topadas por **bytes** vía `octet_length(col::text) <= N`. Excluidas con justificación explícita (R1.48): enums/numéricos/`date`/`boolean`, los `jsonb` ya acotados (`sessions.config`/`maneuver_presets.config`, 0050/0051), y los catálogos globales read-only (sin grant de escritura a `authenticated`). La redacción categórica de R1 ("**Cada** columna…") ahora es **verdadera**: el barrido es completo y verificado migration por migration. Se ampliaron R2 (test) para muestrear ≥3 de las tablas nuevas (`sanitary_events.notes`, `structured_payload`, una de eventos/sesiones) con `techo+1` vía PostgREST/SQL directo esperando `23514`. Fixes B1-1/A1-1/F1-1/H1-1 **intactos** (VERIFICADOS por Gate 1). IDs de requirements R3–R10 **sin cambios** (solo se renumeraron las sub-líneas internas de R1).
