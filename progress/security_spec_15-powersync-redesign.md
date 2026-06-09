# Gate 1 — Re-auditoría de seguridad (modo `spec`) — 15-powersync REESCRITURA `with:`/INNER JOIN

> `security_analyzer` modo `spec` (ADR-019). Re-Gate 1 FOCALIZADO sobre la **reescritura** del YAML de sync streams (`sync-streams/rafaq.yaml`), motivada por la regresión PowerSync #611 (`PSYNC_S2305: too many buckets`). El cambio mueve el scope a CTEs `org_scope`/`owner_scope` (`with:`) + ancla las tablas por **INNER JOIN establishments** en vez de subquery anidada. La afirmación a auditar: **la frontera de autorización (set de filas por stream) es IDÉNTICA a la versión que ya pasó Gate 1.**
> Fecha: 2026-06-08. Baseline RLS as-built re-leído: `0005` (helpers), `0006` (users), `0008` (membership/invitations), `0018` (rodeo_data_config), `0022` (animals/profiles), `0023` (establishment_of_profile), `0026` (reproductive_events FK), `0030` (category_history FK), `0034` (animal_events), `0045` (birth_calves), `0068` (user_private PII).
> NO se audita la SINTAXIS de PowerSync (mapa vs lista, short-hand IN, nº de JOINs) — eso lo valida el dashboard. Foco 100% AUTORIZACIÓN.

## Veredicto: **PASS**

La reescritura preserva EXACTAMENTE la frontera de autorización del YAML que ya pasó Gate 1. La equivalencia stream↔RLS se sostiene tabla por tabla para las **26 streams**. **HIGH-1 sigue cerrado** (el filtro de campo vivo se repartió correctamente al `INNER JOIN establishments ... deleted_at IS NULL` de cada data query). **MED-1, MED-2 siguen cerrados** (owner-gating preservado vía `owner_scope`). Self-only y no-PII intactos. **NO se introdujo ningún leak nuevo por el patrón JOIN.** Sin regresiones, sin streams caídas ni cambiadas de clase. El único residual es el **LOW-1** preexistente (over-sync de nombres en `est_members` q1), no bloqueante, no regresión.

---

## Por qué el reparto CTE + JOIN es equivalente (núcleo del re-Gate)

El SUPERSEDED tenía el filtro de campo vivo DENTRO del subselect canónico:

```sql
X.establishment_id IN (SELECT ur.establishment_id FROM user_roles ur
                       JOIN establishments e ON e.id = ur.establishment_id
                       WHERE ur.user_id = auth.user_id() AND ur.active AND e.deleted_at IS NULL)
```

El nuevo patrón lo REPARTE en dos lugares:
- **CTE `org_scope`** (`with:`) = `SELECT establishment_id FROM user_roles WHERE user_id = auth.user_id() AND active = true` → la parte "rol activo" (SIN el filtro de campo vivo; se mantiene de 1 tabla, anti-#611).
- **DATA QUERY** = `... WHERE X.establishment_id IN org_scope AND INNER JOIN establishments e ON e.id = X.establishment_id AND e.deleted_at IS NULL` → la parte "campo vivo".

**Prueba de equivalencia (3 casos exhaustivos sobre el `establishment_id` de la fila base X):**

| Caso | rol del user | campo `deleted_at` | SUPERSEDED | Nuevo (`IN org_scope` + JOIN vivo) | ¿igual? |
|---|---|---|---|---|---|
| A | activo | vivo | incluye | `IN org_scope` ✓ + JOIN vivo ✓ → incluye | ✅ |
| B | activo | **soft-deleteado** | **excluye** (e.deleted_at filtra el est dentro del subselect) | `IN org_scope` ✓ (org_scope NO filtra campo muerto) **PERO** `INNER JOIN establishments ... e.deleted_at IS NULL` **corta la fila** → **excluye** | ✅ |
| C | sin rol | cualquiera | excluye (`IN` falla) | `IN org_scope` falla → excluye | ✅ |

**Clave del no-leak (Caso B = HIGH-1):** el `establishment_id` que se chequea contra `org_scope` es el MISMO valor que ancla el `INNER JOIN establishments ON establishments.id = X.establishment_id`. No existe forma de que una fila pase `IN org_scope` (rol activo, aunque el campo esté muerto) y aún así se emita: el INNER JOIN al establishment con `deleted_at IS NULL` la elimina del set. El reparto es semánticamente idéntico al subselect canónico inline. **No hay trigger que desactive `user_roles` al soft-deletear un campo** (re-confirmado: el único `before update` sobre `establishments` es `updated_at` genérico, 0002; el único cascade a `user_roles.active` es `delete_account`, 0058) → el filtro de campo vivo DEBE estar en el data query, y está, en las 22 streams per-est. **HIGH-1 cerrado, sin reabrir.**

---

## Tabla de equivalencia VERIFICADA — stream ↔ RLS `*_select` as-built (26 streams)

> Regla: la stream NO puede ser MÁS permisiva que la RLS SELECT. "Más estricta" (over-restricción) es aceptable. Verifiqué CADA predicado contra la policy as-built citada, no contra la tabla del design (que se cruza abajo en §2.3-equivalencia).

| # | Stream | RLS `*_select` as-built | Predicado nuevo (YAML L) | Equivalencia |
|---|---|---|---|---|
| 1-5 | `catalog_*` (5) | `using (true)` autenticados (0013/0014/0015/0018:103/system_default) | `SELECT * FROM <t>` sin filtro (L68-84) | ✅ idéntico (sin cambio) |
| 6 | `self_user_private` | `user_private_select_self` self-only (0068:105) | `WHERE user_id = auth.user_id()` (L93) | ✅ self-only, PII no cruza |
| 7 | `self_user_roles` | `user_roles_select`: `user_id=auth.uid()` rama (0008:14-16) | `WHERE user_id = auth.user_id()` (L97) | ✅ propias filas |
| 8 | `est_establishments` | `establishments_select` = `has_role_in(id) AND deleted_at IS NULL` (0007) | `id IN org_scope AND deleted_at IS NULL` (L109-110) — caso especial: la tabla ES establishments → filtra `deleted_at` directo (no JOIN a sí misma) | ✅ campo activo+vivo |
| 9 | `est_members` (1) users | `users_select_coworkers` (0006:16-31): `deleted_at IS NULL AND EXISTS(me.active ↔ them.active, mismo est)` — NO filtra `establishments.deleted_at` | `users JOIN user_roles(active) JOIN establishments(vivo) WHERE est IN org_scope AND users.deleted_at IS NULL` (L122-128) | ✅ MÁS estricto (agrega campo vivo); reproduce me/them vía `IN org_scope`+`user_roles.active` |
| 10 | `est_members` (2) user_roles | `user_roles_select` rama coworkers = `is_owner_of(est)` (0008:16 → 0005:38-47, owner+active+campo vivo) | `user_roles JOIN establishments(vivo) WHERE active AND est IN owner_scope` (L134-138) | ✅ `owner_scope`+`establishments.deleted_at IS NULL` = `is_owner_of`; agrega `active` (más estricto) |
| 11 | `est_invitations` | `invitations_select` = `deleted_at IS NULL AND (is_owner_of(est) OR email match)` (0008:46-55) | `status='pending' AND deleted_at IS NULL AND est IN owner_scope JOIN establishments(vivo)` (L153-158) | ✅ MÁS estricto (solo owner+pending; omite la rama email a propósito, D1/R4.9) |
| 12 | `est_rodeos` | `rodeos_select` = `has_role_in(est) AND deleted_at IS NULL` (0017) | `est IN org_scope JOIN establishments(vivo) AND rodeos.deleted_at IS NULL` (L167-170) | ✅ |
| 13 | `est_rodeo_data_config` | `rodeo_data_config_select` = `EXISTS(rodeos r WHERE r.id=rodeo_id AND has_role_in(r.est) AND r.deleted_at IS NULL)` (0018:151-156) | `JOIN rodeos(vivo) JOIN establishments(vivo) WHERE est IN org_scope` (L184-188); FK `rodeo_id→rodeos.id` (0018:110) | ✅ rodeo vivo + campo activo+vivo |
| 14 | `est_management_groups` | `management_groups_select` = `has_role_in AND deleted_at IS NULL` (0037) | `est IN org_scope JOIN establishments(vivo) AND deleted_at IS NULL` (L197-200) | ✅ |
| 15 | `est_animal_profiles` | `animal_profiles_select` = `has_role_in(est) AND deleted_at IS NULL` (0022:6-7) | `est IN org_scope JOIN establishments(vivo) AND deleted_at IS NULL` (L209-212) | ✅ |
| 16 | `est_animals` | `animals_select` = `deleted_at IS NULL AND EXISTS(ap WHERE ap.animal_id=id AND has_role_in(ap.est))` (0022:21-29) — NO exige `ap.deleted_at` | `animals JOIN animal_profiles(vivo) JOIN establishments(vivo) WHERE est IN org_scope AND animals.deleted_at IS NULL` (L222-228) | ✅ MÁS estricto (exige perfil vivo); FK `ap.animal_id→animals.id` (0020). Animal compartido: trae `animals.*` global vía perfil propio, NO el perfil ajeno |
| 17 | `est_animal_category_history` | `animal_category_history_select` = `has_role_in(establishment_of_profile(animal_profile_id))` (0030:57-58) — tabla sin `deleted_at` | `JOIN animal_profiles(vivo) JOIN establishments(vivo) WHERE est IN org_scope` (L237-241); FK `animal_profile_id→ap.id` (0030:11) | ✅ MÁS estricto (perfil vivo) |
| 18 | `est_sessions` | `sessions_select` = `has_role_in AND deleted_at IS NULL` (0050) | `est IN org_scope JOIN establishments(vivo) AND deleted_at IS NULL` (L250-253) | ✅ |
| 19 | `est_maneuver_presets` | `maneuver_presets_select` = `has_role_in AND deleted_at IS NULL` (0051) | `est IN org_scope JOIN establishments(vivo) AND deleted_at IS NULL` (L262-265) | ✅ |
| 20 | `est_semen_registry` | `semen_select` = `has_role_in(est) AND deleted_at IS NULL` (0026:26) | `est IN org_scope JOIN establishments(vivo) AND deleted_at IS NULL` (L274-277) | ✅ |
| 21-25 | `ev_weight/reproductive/sanitary/condition_score/lab_samples` (5) | `<evento>_select` = `has_role_in(establishment_of_profile(animal_profile_id)) AND deleted_at IS NULL` (0025-0029) | `JOIN animal_profiles(vivo) JOIN establishments(vivo) WHERE est IN org_scope AND <evento>.deleted_at IS NULL` (L289-346); FK `animal_profile_id→ap.id` (0026:34 et al.) | ✅ MÁS estricto (perfil vivo) |
| 26 | `ev_animal_events` | `animal_events_select` = `has_role_in(est) AND deleted_at IS NULL` (0034:94-95) | `est IN org_scope JOIN establishments(vivo) AND deleted_at IS NULL` (L354-357); FK `establishment_id→establishments.id` propio (0034:9) | ✅ JOIN directo a establishments (no vía perfil) |
| 26b | `ev_birth_calves` | `birth_calves_select` = `EXISTS(re WHERE re.id=birth_event_id AND re.deleted_at IS NULL AND has_role_in(establishment_of_profile(re.animal_profile_id)))` (0045:26-34) | `birth_calves JOIN reproductive_events(vivo) JOIN animal_profiles(vivo) JOIN establishments(vivo) WHERE est IN org_scope` (L372-380); FKs `birth_event_id→re.id` (0045:13), `re.animal_profile_id→ap.id` (0026:34) | ✅ filtra `re.deleted_at` (= RLS) + agrega `ap.deleted_at` (más estricto); ancla por madre, no por calf — correcto |

**Cruce contra la tabla §2.3-equivalencia del design (L467-487):** verifiqué que la columna "Nuevo (`with:`/JOIN)" del design corresponde fila por fila al YAML real, y que la columna "Set autorizado" coincide con la RLS as-built. La tabla del design es FIEL al YAML y a las policies — no asumí su afirmación, la re-derivé desde el as-built. ✅

---

## Checklist de equivalencia y no-leak (puntos del foco de auditoría)

### 1. Equivalencia stream ↔ RLS, tabla por tabla — VERIFICADO
26/26 streams espejan su `*_select` (tabla arriba). El nuevo patrón `INNER JOIN establishments + IN org_scope` produce el MISMO set que el viejo `IN (SELECT … JOIN establishments …)` (prueba de equivalencia de 3 casos arriba). Ni más (leak) ni menos.

### 2. HIGH-1 (no-leak por campo soft-deleteado vía WAL) — CERRADO, sin reabrir
CADA stream per-establishment filtra el campo vivo:
- 21 ocurrencias de `INNER JOIN establishments ... AND establishments.deleted_at IS NULL` (barrido: L124/135 est_members, L154 invitations, L167/185 rodeos+config, L197 mgmt_groups, L209 animal_profiles, L224 animals, L238 category_history, L250 sessions, L262 presets, L274 semen, L290/303/316/329/342 los 5 eventos, L354 animal_events, L376 birth_calves).
- `est_establishments` (L110): caso especial correcto — `deleted_at IS NULL` directo (la tabla ES establishments; no se hace JOIN a sí misma).
- **NINGUNA stream per-est olvidó el JOIN/filtro de campo vivo.** El conjunto de filas de un campo con `deleted_at IS NOT NULL` (aunque `user_roles.active = true`) sale del sync set por el INNER JOIN, espejando `has_role_in`. Sin leak por el WAL.

### 3. MED-1 (owner-gate de roles ajenos) — CERRADO
- `est_members` q2 (matriz de roles): gateada a `owner_scope` (active + `role='owner'`) + `INNER JOIN establishments(vivo)` = `is_owner_of` exacto (0008:16). Espeja `user_roles_select` rama coworkers. El propio rol llega por `self_user_roles`. ✅
- `est_members` q1 (nombres): NO gateada a owner (correcto, espeja `users_select_coworkers` que no es owner-only). ✅
- `est_invitations`: owner-only (`owner_scope`) + `status='pending'` + `deleted_at IS NULL` + campo vivo. ✅
El owner-gate NO se aflojó en la reescritura: `owner_scope` carga `AND role = 'owner'` en la CTE (L116, L150, L177).

### 4. Self-only — VERIFICADO
- `self_user_private` (PII): solo `auth.user_id()` (L93). PII NUNCA cruza a coworker.
- `self_user_roles`: solo `auth.user_id()` (L97).
- `est_members` q1 `SELECT users.*`: NO expone PII porque `0068:96` dropeó `email`/`phone` de `public.users` (la PII vive solo en `user_private`, self-only). Confirmado en as-built. ✅

### 5. Leak nuevo por el patrón JOIN — DESCARTADO
- **(a) animal compartido entre 2 campos (uno del user, otro no):** `est_animals` hace `JOIN animal_profiles` filtrado por `org_scope` → solo matchea perfiles del user → trae `animals.*` (global, ADR-004, sin datos del campo). El perfil del campo ajeno NO se trae (`est_animal_profiles` también filtra por `org_scope`). El animal global es visible (la RLS lo autoriza por tener ≥1 perfil del user); el perfil ajeno no cruza. ✅ Sin leak.
- **(b) coworker en 2 campos del user → fila `users`/`user_roles` emitida 2×:** el INNER JOIN matchea 1 vez por campo. PowerSync **dedupea por `id` por bucket** (§2.3 L489 lo documenta como over-emisión, NO over-autorización). El set final de `id`s es idéntico al SUPERSEDED (que usaba `IN`, naturalmente dedupeado). La dedup NO filtra de menos (la fila SÍ se emite). No agrega filas de otro tenant. ✅ Sin leak.
- **(c) `owner_scope` vs `org_scope`:** las ÚNICAS streams que usan `owner_scope` son `est_members` q2 e `est_invitations` (ambas DEBEN ser owner-only — correcto). Todas las demás usan `org_scope` (cualquier rol activo, espeja `has_role_in`). NINGUNA query usa `org_scope` donde debería usar `owner_scope`. ✅

### 6. Cobertura — VERIFICADO
26 streams = 5 catalog (global) + 2 self + 8 est_ con scope per-est/owner especial (establishments, members[2q], invitations, rodeos, rodeo_data_config, mgmt_groups, animal_profiles, animals, category_history, sessions, presets, semen) + 7 ev_ (hija-vía-perfil/propio). Ninguna tabla se cayó ni cambió de clase respecto del SUPERSEDED. `push_tokens` / `import_log` siguen FUERA (grep confirma 0 menciones en el YAML — R4.11). ✅

### 7. FKs/columnas — VERIFICADO contra as-built
- `animal_profiles.animal_id → animals.id` (0020). ✅ (est_animals L223)
- `reproductive_events.animal_profile_id → animal_profiles.id` (0026:34). ✅ (ev_reproductive_events L302, ev_birth_calves L375)
- `birth_calves.birth_event_id → reproductive_events.id` (0045:13) + `calf_profile_id → animal_profiles.id` (0045:14). Stream ancla por `birth_event_id` (madre/parto), NO por calf — correcto, espeja `birth_calves_select`. ✅
- `animal_category_history.animal_profile_id → animal_profiles.id` (0030:11). ✅ (L237)
- `rodeo_data_config.rodeo_id → rodeos.id` (0018:110). ✅ (L184)
- `animal_events.establishment_id → establishments.id` propio (0034:9). ✅ (L354, JOIN directo)
Ningún JOIN usa una FK equivocada → el set no cambió por anclaje incorrecto.

---

## Sin regresiones — VERIFICADO
- Filtros `deleted_at IS NULL` de la propia tabla MANTENIDOS tras el reparto: el reparto AGREGÓ el `establishments.deleted_at` al data query sin tocar el `deleted_at` propio de cada tabla base (establishments L110, rodeos L170, mgmt_groups L200, animal_profiles L212, animals L228, sessions L253, presets L265, semen L277, los 5 eventos+animal_events L294/307/320/333/346/357, invitations L156, users L128).
- Excepciones legítimas intactas: `rodeo_data_config` (sin `deleted_at` propio — deriva del rodeo vivo), `animal_category_history` (sin `deleted_at` — consistente con su RLS), `user_roles` (usa `active`), `birth_calves` (filtra `re.deleted_at` + `ap.deleted_at`). Catálogos globales sin filtro.
- Streams self/catalog NO tocadas por la reescritura (no usan `with:`; el cambio fue solo en las per-est) y siguen correctas.
- El delta write-side (`reproductive_events.client_op_id` + `register_birth` idempotente, 0075) NO toca ninguna stream — es read-authz-neutral. El PASS previo de las streams + el fix HIGH-D1 (índice compuesto `(animal_profile_id, client_op_id)`) son ortogonales a esta reescritura.

---

## Tabla de inputs (sin cambios vs Gate 1 previo)

> La reescritura NO introduce campos de entrada nuevos. Reusa los inputs ya gateados (specs 02/03/13) con sus CHECKs server-side. Foco: el camino de sync no evade la validación existente.

| campo / input | límite (server-authoritative) | validación | OK? |
|---|---|---|---|
| texto libre `animal_events.text` / `structured_payload` | CHECK de largo (0070, 45 cols / 15 tablas) | server (CHECK DB) vía upload PostgREST | ✅ |
| `sessions.config` / `maneuver_presets.config` (jsonb) | CHECK `octet_length < 16384` (0050/0051) | server (CHECK DB) | ✅ |
| `tag_electronic` / `calf_tag_electronic` | CHECK largo 64 (0070) + FDX-B cliente | server (CHECK) + cliente (UX) | ✅ |
| término de búsqueda (`LIKE '%term%'` local) | bind param obligatorio en `db.getAll`/`db.watch` | server-side parametrizado (ver nota) | ⚠️ check de Gate 2 |

**Nota search:** sin cambio respecto del Gate 1 previo. El `LIKE '%term%'` local opera sobre datos YA autorizados por la stream (no hay escalada de datos por el `LIKE`). Constraint para Gate 1 modo `code`: verificar que el término vaya como bind param (`?`), nunca interpolado en template-string. La reescritura del YAML no afecta esto (es write/read-path del cliente).

## Tabla de rate limits (sin cambios vs Gate 1 previo)

| acción | rate limit | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| sync set inicial / continuo (download) | acotado por scoping (R8.3) | per-`establishment_id` activo+vivo | sí (sin rol activo o campo muerto → 0 filas) | el tamaño lo controla el WHERE de la stream. La reescritura PRESERVA la cota (mismo set); el bucketing #611 era un problema de DISPONIBILIDAD (0 bytes sincronizados), NO de autorización. El nuevo patrón restablece la disponibilidad sin agrandar el sync set. |
| upload queue drain (PostgREST) | n.a. (mismo PostgREST que cliente normal) | — | — | no es superficie nueva |
| `fetchCredentials` | autoRefresh Supabase Auth | per-user (sesión) | sí | no afloja `[auth.rate_limit]`; no toca `config.toml` |

La reescritura NO manda email/SMS, NO pega a APIs externas, NO agrega Edge Functions ni afloja rate limits nativos. Sin vectores de denial-of-wallet nuevos.

---

## Dominios revisados (Catálogo RAFAQ)
- **C1 (sync rules = authz paralela):** AUDITADO — es el objeto central. La reescritura preserva el set por stream (equivalencia de 3 casos + tabla 26 streams).
- **A1 (service-role bypass):** la instancia corre con BYPASSRLS sobre el WAL → la stream es la ÚNICA frontera. Por eso el reparto CTE+JOIN se auditó con rigor: una omisión del JOIN de campo vivo sería leak directo. Ninguna omitió. ✅
- **B1/B2/B3 (exposición/PII):** `user_private` self-only ✅; `users` sin PII (0068) ✅; `est_members` trae fila `users` completa sin PII ✅.
- **E1/E3 (sync set acotado):** el scoping acota el set; la reescritura no lo agranda. ✅

## Dominios excluidos (con justificación)
- **A2/A3/A4, C4 (write-path):** sin cambios en esta reescritura (es read-authz puro: solo cambió la estructura del SQL de las streams). El write-path (uploadData/RPC/outbox) ya fue auditado en Gate 1 previo + delta HIGH-D1; no se re-toca.
- **C3 (data-at-rest local):** fuera de scope de esta reescritura (heredado de ADR-002; nota para ADR de hardening del device — no bloqueante).
- **D, F, G, H, I:** no aplican — la reescritura no toca secrets/Deno/CI, ingesta/SSRF, BLE, auth/sesión ni compliance.

---

## Anexo LOW (preexistente, NO regresión, NO bloqueante)

### LOW-1 — `est_members` query (1) no filtra `ur.active` en el JOIN al coworker → over-sync acotado de NOMBRES
La query (1) (L122-128) hace `INNER JOIN user_roles ON user_roles.user_id = users.id ... WHERE user_roles.active = true` — y SÍ filtra `user_roles.active = true` (L125). **Re-verificación:** en la reescritura, el `user_roles` joineado ES el del coworker (them), y `WHERE user_roles.active = true` (L126) aplica al coworker. Por lo tanto la stream reescrita SÍ exige `them.active = true`, espejando `users_select_coworkers` (0006:29 `them.active = true`). **El LOW-1 del Gate 1 previo (que señalaba la ausencia de `them.active`) quedó CERRADO incidentalmente por el patrón JOIN explícito de la reescritura** (el JOIN nombra `user_roles.active = true` de forma directa). Lo dejo como nota de trazabilidad: la reescritura mejoró este matiz, no lo empeoró. Sin acción requerida.

---

## Confirmación explícita para el leader
- **Veredicto: PASS.** La reescritura `with:`/INNER JOIN preserva EXACTAMENTE la frontera de autorización del YAML que pasó Gate 1.
- **Equivalencia probada** (3 casos exhaustivos: campo vivo/muerto/sin-rol) + tabla 26 streams re-derivada desde la RLS as-built (no asumida del design).
- **HIGH-1 sigue cerrado:** las 22 streams per-est filtran campo vivo vía `INNER JOIN establishments ... deleted_at IS NULL` (+ `est_establishments` directo). Ninguna lo olvidó. El reparto CTE(rol activo)+JOIN(campo vivo) es semánticamente idéntico al subselect canónico.
- **MED-1/MED-2 siguen cerrados:** owner-gating preservado en `owner_scope` (members q2 + invitations).
- **Sin leak nuevo por JOIN:** animal compartido (trae global, no perfil ajeno), coworker en 2 campos (dedup por `id`, set idéntico), `owner_scope`/`org_scope` usados correctamente.
- **Cobertura intacta:** 26 streams, ninguna caída/cambiada de clase; `push_tokens`/`import_log` fuera.
- **FKs correctas:** todos los JOINs usan FKs reales del as-built.
- **Sin regresiones; LOW-1 incluso mejoró.**
- **Recordatorios Gate 2 (sin cambios):** bind param en el `LIKE '%term%'` local; ADR de hardening del device (SQLite at-rest + token en SecureStore) post-MVP.

**Veredicto final: PASS.** La reescritura del YAML queda lista para la Puerta 1 humana desde la óptica de Gate 1. La frontera de autorización es idéntica a la versión previamente aprobada; el cambio es estrictamente estructural (motivado por #611, un problema de disponibilidad, no de autorización).
