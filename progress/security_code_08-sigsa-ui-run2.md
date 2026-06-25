# Security Gate 2 (modo `code`) — spec 08 SIGSA · chunk "UI Run 2 + fix del connector"

**Veredicto: PASS**

`baseline_commit`: `559864423de4ee53fb02d33c40dbe090481210d6` (registrado en `progress/impl_08-sigsa-ui-run2.md`).
Trabajo sobre `main` con cambios sin commitear (no hay feature-branch). Foco del brief: **el connector compartido** (superficie de upload), RENSPA write path, markAsDeclared/filtro de fechas, BreedPicker.

Skill `sentry-skills:security-review` invocada y aplicada (trace data-flow + verify exploitability + reference guides injection/api-security). Cada finding potencial validado manualmente contra las migraciones DB (la autoridad server-side), no por pattern-matching.

---

## 1. Fix del connector (FOCO PRINCIPAL) — preserva la auditoría no-spoofeable. SIN finding.

El brief pedía verificar 3 propiedades. Las tres se cumplen:

### (a) ¿Reintroduce UPDATE en las append-only? NO.
- `app/src/services/powersync/upload-classify.ts:109` — `APPEND_ONLY_INSERT_TABLES = new Set(['sigsa_declarations', 'export_log'])`. Set cerrado de 2 tablas.
- `upload-classify.ts:220-222` — `buildCrudUpsert` devuelve `{ payload: {...data, id}, insertOnly: true }` para esas tablas (PK `id` real de cliente, SIN `onConflict`).
- `connector.ts:87-91` — la rama es `plan.insertOnly ? table.insert(plan.payload) : (onConflict ? upsert(...) : upsert())`. Para las append-only se ejecuta **`.insert()`**, que compila `INSERT` plano → solo requiere `GRANT INSERT`. NUNCA `UPDATE`.
- **Verificado contra la DB (autoridad):** `0111_sigsa_declarations.sql:47` y `0112_export_log.sql:49` otorgan `grant select, insert ... to authenticated` (sin UPDATE) y NO crean policy UPDATE/DELETE. El trigger `tg_force_declared_by_auth_uid` (`0111:87-101`) / `tg_force_generated_by_auth_uid` (`0112:78-92`) fuerzan `declared_by`/`generated_by = auth.uid()` en el `BEFORE INSERT`, ignorando el payload del cliente. El INSERT del connector NO manda esos campos (`buildSigsaDeclarationInsert`/`buildExportLogInsert` en `local-reads.ts:2977-3033` no los enumeran; el test `upload-classify.test.ts:115-128` asserta `!('declared_by' in payload)` / `!('generated_by' in payload)`).
- **Conclusión:** la propiedad R11.3 (audit SENASA no-spoofeable, append-only) se PRESERVA client-side. El fix es arquitectónicamente correcto: la alternativa (dar `GRANT UPDATE` para que el upsert funcionara) sí habría roto la auditoría. Acá NO se tocó ningún grant ni policy.

### (b) ¿Cambia el comportamiento de OTRA tabla? NO.
- `buildCrudUpsert` (`upload-classify.ts:206-224`): el orden de ramas es (1) PK compuesta → `onConflict`; (2) `isAppendOnlyInsertTable` → `insertOnly`; (3) default → `upsert` por `id`. Solo las 2 tablas del Set entran a la rama (2). Toda tabla con datos de evento/perfil (`weight_events`, `animal_profiles`, `custom_*`, etc.) mantiene su `upsert` exacto previo.
- Test de regresión presente: `upload-classify.test.ts:85-90` (`weight_events` → `insertOnly` undefined, upsert) y `:94-98` (`isAppendOnlyInsertTable('weight_events') === false`).
- El PATCH (`connector.ts:95-108`) NO se tocó: una append-only nunca genera PATCH (no hay UPDATE local de esas tablas; solo INSERT vía `runLocalWrite`).

### (c) ¿El descarte 23505 en reintento filtra algo sensible? NO.
- `connector.ts:118-128`: un reintento de una append-only ya presente levanta `23505` → `isPermanentServerCode('23505')` true (`upload-classify.ts:254-258`, `/^(22|23|42)/`) → `isTransientUploadError` false → se descarta como permanente vía `surfaceUploadRejection(lastOp, error)`.
- `surfaceUploadRejection` (`connector.ts:195-215`) y `recordUploadRejection` (`upload-rejections.ts:158-181`) guardan **solo** `{ id, table, op, code, at }` — NUNCA `opData`. Confirmado: `recordUploadRejection` lee `op?.id`, `op?.table`, `op?.op` y `error.code`; el `file_content`/RFIDs del `export_log` (lo más sensible) jamás se materializan en el store ni en el `console.warn` (que loguea `{table, op, code}`). El banner de la regla está documentado en `upload-rejections.ts:12-14`.
- Nota menor (no-finding): un rechazo de `sigsa_declarations`/`export_log` NO es maniobra (no está en `MANEUVER_TABLE_LABELS`) → no se muestra en el banner de manga. Correcto: es un caso idempotente esperado, no un dato de campo perdido.

---

## 2. RENSPA write path — owner-gate por RPC SECURITY DEFINER. SIN finding.

Un no-owner NO puede escribir `renspa` por ningún path:
- `app/app/editar-campo.tsx:203` — la pantalla persiste el RENSPA con **`updateRenspa(detail.id, rv.value)`**, NO con el UPDATE directo de `updateEstablishment` (que en `:392-403` NO incluye `renspa` en su `set`).
- `app/src/services/establishments.ts:433-461` — `updateRenspa` llama **exclusivamente** `supabase.rpc('update_renspa', { p_establishment_id, p_renspa })`. No hay `.from('establishments').update(...)` de renspa en ningún lado (grep confirmado).
- **Verificado contra la DB:** `0110_establishments_renspa.sql:44-58` — la RPC es `SECURITY DEFINER` con guard `if not public.is_owner_of(p_establishment_id) then raise ... errcode '42501'`. Un vet/field_operator recibe 42501. Además (`:12-17`) la policy existente `establishments_update` (0007, `is_owner_of` en USING+WITH CHECK) bloquea cualquier UPDATE directo de la tabla a no-owners → el path directo también está cubierto. El `42501` se mapea a copy accionable en `establishments.ts:452`.
- La UI gatea por rol antes (editar-campo `:62 not_owner`; el banner de `mas.tsx` solo a `isOwner`), pero la RPC es la barrera real. Defensa en capas correcta.
- Input: `renspa` ≤20 chars validado en vivo (`renspa-validate.ts`, espejo del CHECK) Y autoritativo server-side (`CHECK chk_establishments_renspa_length`, `0110:34-38`). El `maxLength={RENSPA_MAX_LENGTH}` del FormField es UX; el CHECK de DB es la autoridad. OK.

---

## 3. markAsDeclared + filtro de fechas (dateFrom/dateTo) — parametrizado, sin superficie nueva. SIN finding.

- **SQL injection (SQLite local):** todas las queries usan placeholders `?` + `args[]` (PowerSync `getAll(sql, args)`):
  - `buildPendingSigsaAnimalsQuery` (`local-reads.ts:2952-2959`): `dateFrom`/`dateTo` → `sql += ' AND ap.animal_birth_date >= ?'; args.push(filters.dateFrom)`. Parametrizado. `rodeoId` idem.
  - `buildExportLogInsert` (`:2989-3004`) y `buildSigsaDeclarationInsert` (`:3026-3032`): `VALUES (?, ?, ...)` con `args`. Parametrizado.
  - No hay interpolación de input de usuario en ningún string SQL del diff. La única SQL dinámica (`buildSearchLikeQuery` column-whitelist tipo unión; `notHiddenByOverride` con constantes de effect controladas por código) NO toca este chunk y ya es segura (`escapeLike` neutraliza comodines).
- **markAsDeclared** (`sigsa-export-service.ts:256-266`): INSERT local 1 fila `sigsa_declarations` con `export_log_id = null` (marca manual). Offline-first → cola de sync. RLS owner/vet + IDOR-check (`0111:61-81`, el `EXISTS` exige que `animal_profile_id` pertenezca al `establishment_id` de la fila y esté activo → un owner del campo A no puede declarar un animal del campo B) re-validan server-side; un field_operator es rechazado 42501 por `uploadData`. `declared_by` forzado por trigger. Sin superficie de server nueva (mismo INSERT que el export, ya con Gate 2 en la capa servicio).
- El filtro de fechas además valida coherencia inline (`sigsa-filters.ts` `isValidBirthDateRange`) — UX, no es control de seguridad; el server no expone nada por un rango incoherente (lista vacía).

---

## 4. BreedPicker — read-only del catálogo global, sin write sensible, sin mass-assignment. SIN finding.

- `breed-picker.ts` es PURO (arma/filtra/normaliza la lista; sin React/red/escritura). `buildBreedCatalogQuery` (`local-reads.ts:2876-2883`) es `SELECT ... FROM breed_catalog ORDER BY sort_order ASC`, sin args, catálogo GLOBAL read-only (sin scope de tenant — correcto, no hay dato sensible).
- `BreedPickerSheet.tsx` lee el catálogo y emite `onSelect(breedId, senasaCode)`. El parent `crear-animal.tsx:375-388` (`onSelectBreed`) **descarta `breedId` a propósito** y setea solo `breed` (texto) — documentado en `crear-animal.tsx:184-187` y `animals.ts:804-809` (la RPC `create_animal` 0083 no tiene `p_breed_id` → un breed_id se perdería en silencio; se evita mandarlo). Es un gap FUNCIONAL (lo resuelve el leader en Run 3), **no** de seguridad.
- **Mass-assignment check (api-security.md):** `createAnimal({...})` (`crear-animal.tsx:476-496`) se llama con un objeto de campos NOMBRADOS uno por uno — NO hay spread del input del cliente (`.insert(body)`/`.update(body)`). No hay vector de over-posting de `establishment_id`/`role`/`breed_id`/`*_by`. La identidad de tenant la deriva la RLS/RPC (sin hardcode de establishment_id).

---

## 5. Cobertura adicional del Catálogo RAFAQ (lo que tocó el diff)

- **A1 service-role bypass:** grep `createAdminClient|service_role` sobre el diff de cliente → 0 hits. Este chunk no introduce admin-client. SIN finding.
- **B1 information disclosure:** `surfaceUploadRejection`/`recordUploadRejection` NO devuelven `err.message` crudo al cliente; el rechazo se materializa como `code` + tabla. `saveAndShare` (`sigsa-export-service.ts:180-184`) captura el error del SO y NO lo expone crudo al usuario (la UI lo mapea). OK.
- **C1 PowerSync sync rules (revisado aunque sea artefacto de deploy fuera del chunk UI):** `sync-streams/rafaq.yaml` agrega `sigsa_declarations` y `sigsa_export_log` con el `org_scope` ESTÁNDAR (`establishment_id IN (SELECT establishment_id FROM user_roles WHERE user_id = auth.user_id() AND active = true)`) — idéntico a las demás per-establishment. El `file_content` (TXT con todos los RFIDs, dato más sensible) queda escopeado al tenant; sin vector de fuga cross-tenant. `catalog_breed` es global read-only (sin dato sensible). SIN finding.
- **C3/H token:** no se tocan tokens/SecureStore/sesiones en este chunk.
- **Rate limiting (E2):** el chunk NO agrega Edge Functions ni endpoints de costo. El export/markAsDeclared escriben a tablas via la cola de sync (INSERT acotado: 1 export_log + N declarations, N = inventario real del campo, con CHECK de tamaño server-side `file_content ≤ 5 MB` en `0112:39`). No hay acción abusable nueva sin límite. (El tope de fan-out del export por request es el inventario del propio tenant, no amplificable cross-tenant.)

---

## Tabla de inputs (campos nuevos/modificados que el usuario tipea en este chunk)

| campo | límite | validación | OK? |
|---|---|---|---|
| RENSPA (editar-campo) | ≤20 chars (`RENSPA_MAX_LENGTH`, `maxLength`) | **server** (`CHECK chk_establishments_renspa_length` 0110) + RPC owner-gate; UX en `renspa-validate.ts` | ✅ |
| Filtro fecha desde/hasta (export-sigsa) | ISO `YYYY-MM-DD` (mask + `isCompleteIsoDate`) | parametrizado en la query (`?`/args); coherencia inline (UX) | ✅ |
| Raza (crear-animal) | selección CERRADA del catálogo (no texto libre) | N/A (picker cerrado; `breed` texto ≤ catálogo) | ✅ |
| Pelaje (crear-animal, sin cambio funcional) | `COAT_MAX_LENGTH` 40 | UX slice; columna acotada server | ✅ |

## Tabla de rate limits (acciones abusables tocadas por el diff)

| acción | rate limit | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| markAsDeclared / export (INSERT vía cola sync) | n.a. (no es endpoint custom) | per-tenant por RLS (owner/vet del establishment) | sí (RLS/CHECK rechazan server-side) | fan-out = inventario propio del tenant; `file_content ≤ 5 MB` (CHECK 0112) acota tamaño |
| updateRenspa (RPC) | n.a. | owner del establishment (RPC guard) | sí (42501 no-owner) | 1 fila, idempotente |

---

## False positives descartados (para trazabilidad)

- **"`.insert()` sin `onConflict` rompe idempotencia / permite duplicados":** descartado. El `UNIQUE(establishment_id, animal_profile_id)` de `sigsa_declarations` (`0111:39`) hace que un reintento levante 23505 → descarte permanente idempotente (la fila ya existe). Para `export_log` un reintento del mismo `id` de cliente levanta 23505 por PK. No hay duplicado posible.
- **"breed_id no se persiste = hueco":** descartado como NO-seguridad. Es gap funcional documentado; el picker es entrada controlada y el `breed` texto sí persiste. No expone ni corrompe datos.
- **"date filter podría inyectar SQL en el SQLite local":** descartado. Parametrizado (`args.push`), no interpolado. Además el SQLite es local al device del propio usuario (no es un interpretador multi-tenant compartido).

---

## Archivos analizados (chunk UI Run 2 + connector)

- `app/src/services/powersync/upload-classify.ts` (+ `.test.ts`) — connector fix (FOCO).
- `app/src/services/powersync/connector.ts` — rama insert/upsert (FOCO).
- `app/src/services/powersync/upload-rejections.ts` — descarte 23505 / no-leak (FOCO).
- `app/src/services/establishments.ts` — `updateRenspa` (RPC owner-gate).
- `app/app/editar-campo.tsx` — wiring RENSPA por RPC.
- `app/app/(tabs)/mas.tsx` — RenspaBanner (read-only, owner-gated).
- `app/app/crear-animal.tsx` — BreedPicker integration (no mass-assignment, breed_id dropped).
- `app/src/utils/breed-picker.ts` (+ `.test.ts`), `app/src/components/sigsa/BreedPickerSheet.tsx` — picker puro/read-only.
- `app/src/utils/renspa-validate.ts`, `app/src/utils/sigsa-filters.ts` — validadores puros (UX).
- `app/src/services/powersync/local-reads.ts` — `buildPendingSigsaAnimalsQuery` (date filter param), `buildExportLogInsert`, `buildSigsaDeclarationInsert`, `buildBreedCatalogQuery`, `buildExportLogContentQuery`/`buildExportLogHistoryQuery`.
- `app/src/services/powersync/schema.ts` — `renspa`/`breed_id` cols (cliente; no deploy), append-only tables declaradas sin UPDATE local.
- `app/app/_layout.tsx` — solo registro de `<Stack.Screen export-sigsa>` (sin write).
- `sync-streams/rafaq.yaml` — sync rules org_scope (artefacto deploy; verificado por C1 aunque fuera del chunk UI).
- DB (autoridad, ya con Gate 2 previo, re-verificada para el connector): `0110`/`0111`/`0112`.

## Cobertura indirecta de Deno / RLS / PowerSync

- La skill Sentry NO cubre nativamente Deno/RLS/PowerSync. RLS + triggers + grants verificados **manualmente** contra las migraciones `0110/0111/0112` (autoridad server-side). PowerSync sync-rules verificadas a mano contra el `org_scope` estándar. Connector verificado a mano + unit tests (`upload-classify.test.ts`). El chunk no toca Edge Functions (Deno).
- **No cubierto por automatización (revisión manual hecha, sin finding):** el grant/policy real de las tablas server-side (no hay forma de que el cliente reintroduzca UPDATE — el fix es puramente client-side y las tablas no tienen el grant).
