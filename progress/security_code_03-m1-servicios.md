# Security Gate 2 (modo code) — spec 03, chunk M1-SERVICIOS

**Veredicto: PASS**

Frontend puro (lógica + servicios offline). Backend (0050-0057) ya gateado en chunk previo; Gate 1 N/A en este chunk. Auditoría sobre el diff M1-SERVICIOS contra el baseline `56f27438ed19535e86506190ff7606a3d4f3ae6b`, ignorando los cambios de spec-08 / `app/src/services/sigsa/` de la otra terminal (fuera de alcance).

Sin findings HIGH ni MEDIUM. Los 5 focos del brief verificados OK. Detalle abajo.

---

## Focos verificados OK

### 1. Bypass del write-path / multi-tenancy — OK

- **CERO `supabase.from(...).insert/update` directo** en los servicios nuevos. Grep de `supabase\.from|\.rpc\(|from\(['"]` sobre `sessions.ts` → 0 matches; sobre `maneuver-presets.ts` → 1 match y es una **línea de comentario** (`maneuver-presets.ts:122`, doc del flujo de upload), no código.
- Toda escritura va por `runLocalWrite(buildXInsert/Update(...))` → `db.execute(sql, args)` sobre la tabla **SINCRONIZADA** (`sessions`/`maneuver_presets` declaradas como `new Table(...)` regular en `schema.ts:252-277`, NO `localOnly`) → genera CrudEntry → `connector.uploadData` → PostgREST, donde RLS + triggers + CHECK re-validan. Patrón idéntico a `events.ts`/`management-groups.ts`.
- **No se spoofea tenant ni autoría.** Los INSERT builders (`buildCreateSessionInsert` local-reads.ts:1597, `buildCreateManeuverPresetInsert` :1696) **NO escriben `created_by`** → lo fuerza `tg_force_created_by_auth_uid` (0050/0051) al subir (anti-spoof, R11.2). `establishment_id`/`rodeo_id` SÍ van en el payload pero son **load-bearing y re-validados server-side**: la RLS `has_role_in(establishment_id)` (0050/0051) rechaza un establishment donde el caller no tiene rol, y `tg_sessions_rodeo_check` (0050) exige que el rodeo sea del mismo establishment + activo + vivo (23514 si no). El comentario del servicio es explícito: "La AUTORIZACIÓN real la valida la RLS al SUBIR — NO el return del service" (sessions.ts:12-16). Confirmado: el código NO depende de checks client-side para tenancy; la barrera es RLS.
- `establishment_id`/`rodeo_id` **nunca hardcodeados** — llegan por param del caller (contexto activo). `node scripts/check-hardcode` pasó en el check del implementer.

### 2. Op_type nuevo del outbox (`soft_delete_maneuver_preset` → RPC 0057) — OK

- Mapeo correcto: `SOFT_DELETE_OP_BY_ENTITY.maneuver_preset = 'soft_delete_maneuver_preset'` + `TARGET_TABLE_BY_ENTITY.maneuver_preset = 'maneuver_presets'` (outbox.ts:367/375). `softDeletePreset` encola `{ entity:'maneuver_preset', params:{ p_preset_id } }` (maneuver-presets.ts:126-134) → el arg matchea exactamente la firma de la RPC `soft_delete_maneuver_preset(p_preset_id uuid)` (0057).
- `'soft_delete_maneuver_preset'` agregado a `RPC_OP_TYPES` (upload.ts:45) → `mapIntentToRpc` lo mapea a `{ rpcName: opType, args: params }` **SIN** `p_client_op_id` (su firma no lo tiene; dedup natural por la guarda `deleted_at IS NULL`). Tested: `upload.test.ts:41-50` (mapeo, args sin client_op_id).
- **Manejo idempotente P0002 sin leak**: `classifyIntentUploadError` clasifica `code==='P0002' && opType.startsWith('soft_delete_')` como `idempotent_discard` (upload.ts:190) → descarta sin rollback ni superficie de error (un reintento de un preset ya borrado es no-op exitoso). Tested: `upload.test.ts:275`. Un 42501 (sin rol) cae al default `permanent_reject` → rollback del overlay + superficia (correcto). No se filtra detalle del error al usuario por este path.
- **No abre camino cross-tenant**: el RPC 0057 re-valida `has_role_in(v_est)` server-side (SECURITY DEFINER, derivando `v_est` del propio preset, no del cliente) y levanta 42501 si el caller no tiene rol en el establishment del preset. El cliente solo pasa el `p_preset_id`; no asume autorización. Aun si un atacante encola un `p_preset_id` de otro tenant, el RPC lo rechaza.

### 3. Parseo del `config` jsonb (maneuver-config.ts) — OK

- `parseManeuverConfig` (maneuver-config.ts:21) es **tolerante y no ejecuta nada**: `JSON.parse` envuelto en try/catch → null/malformado/no-objeto/array caen a `{}` (nunca tira). Es deserialización de datos pura — no hay `eval`, `Function`, ni reviver. No hay path de inyección ni crash explotable ante config hostil/viejo/sin la key `maniobras`.
- `extractManeuvers` (maneuver-config.ts:36) **no confía en el contenido del jsonb**: filtra todo valor que no sea un `ManeuverKind` conocido (whitelist `MANEUVER_SET` derivada de `ALL_MANEUVERS`), dedup, tolera no-strings/null/`maniobras` ausente o no-array → `[]`. Un config corrupto/hostil produce 0 maniobras, no un crash ni un kind arbitrario. Tested: `maneuver-config.test.ts` (9 casos, incl. payload hostil).
- El config se serializa con `JSON.stringify` al escribir y el **tamaño está topado server-side** (`sessions_config_size`/`maneuver_presets_config_size` `octet_length < 16384`, 0050/0051) → el pass-through no es vector de storage-exhaustion (un payload >16KB lo rechaza el CHECK al subir, el cliente Expo attacker-controlled incluido).

### 4. Queries (local-reads builders) — OK

- **Parametrizadas, sin string-concat de input de usuario.** Los 10 builders nuevos de sessions/presets (local-reads.ts:1597-1751) son strings con placeholders `?` y valores en `args` → `db.getAll(sql, args)` / `db.execute(sql, args)` los bindea (local-query.ts:51/97). Grep de `${` / `' +` / `+ '` sobre el bloque 1573+ → **0 matches**: cero interpolación en los builders nuevos. (Las únicas interpolaciones del archivo viven en helpers previos — `notHiddenByOverride`, los UNION de búsqueda — y solo interpolan **constantes controladas por código** como nombres de tabla/efectos, nunca input de usuario; `escapeLike` neutraliza comodines antes de bindear el patrón.)
- **Scope correcto**: todos los reads filtran `deleted_at IS NULL` (`buildActiveSessionQuery` :1663, `buildSessionByIdQuery` :1678, `buildManeuverPresetsQuery` :1733, `buildManeuverPresetByIdQuery` :1745) y por `establishment_id = ?` donde aplica (lista de presets, sesión activa). El scoping de tenant fuerte ya lo aplicó la sync stream (`has_role_in`) al sincronizar; el filtro local es defensivo-explícito. No se re-filtra tenancy (sería redundante y arriesgaría divergir del set autorizado) — patrón consistente con el resto de local-reads.
- **`buildActiveProfileRodeoQuery` (rodeo del perfil) no cruza tenants**: lee `animal_profiles.rodeo_id WHERE id = ? AND deleted_at IS NULL` (local-reads.ts:392). No tiene `establishment_id` en el filtro, pero opera sobre el SQLite local que YA está scopeado por la stream `est_animal_profiles` (has_role_in) → solo contiene perfiles de campos del usuario. Es fail-safe: un perfil soft-deleted/inexistente → null → la UI no ofrece maniobras gateadas (paralelo al fail-closed de la capa 2 DB, 0054). No es un bypass: es lectura sobre datos ya autorizados, y la capa 2 (trigger `assert_data_keys_enabled`) re-valida al subir cualquier evento.

### 5. Límites de input — OK (server-side autoritativo confirmado)

- **`maneuver_presets.name`**: el cliente hace `name.trim()` + rechazo de vacío (maneuver-presets.ts:79, 104) — eso es UX. La barrera autoritativa es DB: `maneuver_presets_name_not_empty` (`length(trim(name)) > 0`, 0051) **+ tope de largo `char_length(name) <= 120`** (`maneuver_presets_name_len_chk`, 0070, VALIDATED). Un atacante que pegue un name de 10MB directo a PostgREST lo rechaza el CHECK.
- **`sessions.work_lot_label`**: texto libre informativo. Topado server-side: `char_length(work_lot_label) <= 120` (`sessions_work_lot_label_len_chk`, 0070, VALIDATED). El cliente `cleanStr` (trim + null si vacío) es UX.
- **`config` jsonb (sessions + presets)**: `octet_length < 16384` (0050/0051). No se rompe esa expectativa: el cliente serializa libre pero el CHECK acota al subir.
- `setSessionCounts` coerce los contadores con `Math.max(0, Math.trunc(...))` (sessions.ts:186) — no es input de texto libre, son enteros app-maintained no-autoritativos (el conteo real se recomputa con `count(*)`). Sin riesgo.

**Conclusión de límites**: cada campo de entrada de usuario de este chunk tiene límite claro + validación AUTORITATIVA server-side. Cumple el requisito de Raf.

---

## Tabla de inputs (campos que el usuario tipea, nuevos/modificados en el chunk)

| campo | límite | validación | OK? |
|---|---|---|---|
| `maneuver_presets.name` | largo ≤120 char + no-vacío | server (CHECK 0051 not-empty + 0070 len, VALIDATED) + cliente trim (UX) | ✅ |
| `sessions.work_lot_label` | largo ≤120 char | server (CHECK 0070, VALIDATED) + cliente cleanStr (UX) | ✅ |
| `sessions.config` (jsonb pass-through) | ≤16 KiB (octet_length) | server (CHECK 0050) + cliente extractManeuvers whitelist (UX) | ✅ |
| `maneuver_presets.config` (jsonb pass-through) | ≤16 KiB (octet_length) | server (CHECK 0051) + cliente whitelist (UX) | ✅ |
| `animal_count`/`event_count` (no es texto: enteros app-maintained) | ≥0, trunc | cliente `Math.max(0,trunc)`; no-autoritativo (recompute server con count(*)) | ✅ |

## Tabla de rate limits (acciones abusables tocadas por el diff)

| acción | rate limit | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| createSession / closeSession / setWorkLotLabel / setSessionCounts | n.a. | — | — | CRUD plano local→sync; sin email/SMS/API externa/bulk; offline-first por diseño. RLS `has_role_in` acota cada write al subir. Tope de tamaño/largo por CHECK. No es vector de amplificación. |
| createPreset / updatePreset | n.a. | — | — | idem: CRUD plano, RLS + CHECK al subir. |
| softDeletePreset → RPC `soft_delete_maneuver_preset` (0057) | n.a. | per-establishment (has_role_in en el RPC) | sí (42501 si sin rol) | RPC barata SECURITY DEFINER con re-validación de rol; sin fan-out; sin llamada externa. P0002 idempotente. No requiere cuota propia. |

Ninguna acción del chunk manda email/SMS, pega a API externa, ni es bulk/import → ninguna necesita un rate limit propio. No se tocó `[auth.rate_limit]` de `config.toml`. El lockout cliente no aplica acá.

---

## False positives descartados (skill + checklist) — para trazabilidad

- **B1 (information disclosure por `err.message` crudo)**: los servicios propagan `r.error.message` de `runLocalWrite`/`runLocalQuery`, pero ese mensaje proviene de un fallo del **SQLite LOCAL** (`db.execute`/`getAll` que tira por DB no booteada / SQL malformado — path defensivo), NO de una respuesta del servidor. Los errores reales de upload (RLS/CHECK reject) los maneja `uploadData` aparte vía el canal de status, NO el return de estos servicios (el write local siempre devuelve ok offline, contrato T5). No hay internals del server filtrados al usuario por este path → no aplica.
- **F1 (PostgREST filter injection en `.or()/.filter()`)**: este chunk NO usa PostgREST para los reads (lee SQLite local con builders parametrizados); no hay `.or()/.filter()` con input de usuario. El único LIKE del archivo (`buildSearchLikeQuery`, fuera de scope de este chunk) ya escapa comodines. No aplica.
- **A1 (service-role bypassa RLS)**: ningún archivo del chunk usa `createAdminClient()`/service-role — todo corre con la sesión del usuario (anon/authenticated). El único service-role del chunk vive server-side en el RPC 0057 (SECURITY DEFINER con re-check de rol). No aplica al cliente.
- **A2 (mass assignment)**: no hay `.insert(body)`/`.update(body)` con spread del input. Los builders arman el INSERT/UPDATE campo por campo con un set fijo de columnas. `created_by`/`establishment_id` audit no se mandan (trigger force). No aplica.
- **Prototype pollution en parseManeuverConfig**: `JSON.parse` + chequeo `typeof === 'object' && !Array.isArray` devuelve el objeto tal cual, pero `extractManeuvers` solo lee `config.maniobras` y filtra por whitelist; ningún path hace merge recursivo del config en otro objeto ni accede a keys atacante-controladas como índice. El config se re-serializa con `JSON.stringify` (no preserva `__proto__` como prototipo). Sin sink explotable. No aplica.

---

## Cobertura indirecta (lo que la skill Sentry NO cubre — revisado manualmente)

- **PowerSync / CRUD-plano / RLS / Deno**: fuera del alcance de patrones de la skill (orientada a web/Django/JS clásico). Revisado a mano contra el patrón canónico del repo (events.ts / management-groups.ts) + las migraciones 0050/0051/0057/0070. Conclusión: el write-path es el correcto (tabla synced → CrudEntry → RLS+trigger+CHECK al subir), sin bypass.
- **PowerSync sync rules de `sessions`/`maneuver_presets` (DOWNLOAD)**: son de M4 (no este chunk). El UPLOAD (CrudEntry→uploadData) funciona sin la regla de download. ⚠️ **Ítem para Gate de M4 / dominio C1**: cuando se escriban las sync rules de estas tablas, verificar que estén scopeadas por establishment del usuario (una regla laxa replicaría presets/sesiones cross-tenant a la SQLite local pese a RLS perfecta). Fuera del scope de M1-SERVICIOS; se deja anotado para trazabilidad.

---

## Archivos analizados (in-scope)

Nuevos: `app/src/utils/maneuver-gating.ts`, `app/src/utils/maneuver-config.ts`, `app/src/hooks/useManeuverGating.ts`, `app/src/services/sessions.ts`, `app/src/services/maneuver-presets.ts`.
Modificados: `app/src/services/powersync/local-reads.ts` (builders sessions/presets 1573-1751 + helpers), `app/src/services/powersync/outbox.ts`, `app/src/services/powersync/upload.ts`, `app/src/services/rodeo-config.ts`, `app/src/hooks/index.ts`, `scripts/run-tests.mjs` (engancha suites; sin superficie de seguridad).
Referencia server (no modificada en este chunk, leída para confirmar enforcement): migraciones `0050`, `0051`, `0057`, `0070`; `schema.ts:252-277`; `local-query.ts`; `upload.test.ts`.
Excluidos por scope (otra terminal): `app/src/services/sigsa/`, `specs/active/08-export-sigsa/*`, `app/app/maniobra/` (chunk M2 spike, no M1-SERVICIOS).
