# Security spec review (Gate 1) — chunk "09 resto · dedup A/B" — RPC `assign_tag_to_animal`

**Modo**: `spec` (Gate 1, ADR-019). **Fecha**: 2026-06-13 (sesión 25). **Analista**: security_analyzer.
**Superficie auditada**: `design-09resto-dedup.md` §1 (contrato del RPC) + §2 (cliente offline) + §3..5 (UI); `requirements-09resto-dedup.md` RD1/RD2/RD6/RD7 + DECISIONES ABIERTAS; `context-09resto-dedup.md` §5/§7.
**Moldes as-built verificados** (file:line): `transfer_animal` (0087), `register_birth` (0075), trigger `tg_animals_block_tag_change` (0036), índice `animals_tag_unique` (0019:22-24), denorm/propagación identidad (0079), `has_role_in`/`is_owner_of` (0005), CHECK de largo de tag (0070:185), `create_animal` (0083).

---

## VEREDICTO: **PASS** (0 findings HIGH abiertos)

El contrato del RPC `assign_tag_to_animal` en `design-09resto-dedup.md` §1 es **paridad fiel** del molde `transfer_animal` 0087 / `register_birth` 0075 en los siete controles que importan (anti-IDOR derivado, authz sobre el tenant derivado, guard NULL→valor, idempotencia scopeada al caller, validación de formato server-side, cierre de superficie tipado, search_path fijo). El orden de operaciones cierra los race y no abre oráculos cross-tenant. **No hay ningún hueco explotable según el diseño actual.**

Hay **2 findings MEDIUM** (no bloquean el PASS; son endurecimientos/aclaraciones foldeable a la spec sin reabrir el chunk) y un anexo LOW. Las dos DECISIONES ABIERTAS marcadas para mi dictamen (DA-1 idempotencia, DA-2 authz) se **ratifican** abajo con condiciones menores.

---

## Foco de auditoría — los 9 puntos, con evidencia

### 1. Anti-IDOR — **CIERRA**
`design §1.2(a)` deriva `v_est, v_animal_id` SOLO de `animal_profiles WHERE id=p_profile_id AND status='active' AND deleted_at IS NULL`; el cliente nunca pasa `animal_id` ni tenant. Paridad exacta con `transfer_animal` (0087:82-92) y `register_birth` (0075:93-101). Un `p_profile_id` de OTRO campo: la fila SÍ se encuentra (la query no filtra por tenant del caller, igual que el molde), pero el `has_role_in(v_est)` de (b) rebota `42501` porque el caller no tiene rol en el tenant derivado → no toca el animal ajeno. **El UPDATE de (e) usa `v_animal_id` derivado, nunca un id del payload** → no hay IDOR. El escenario 3 de la suite backend (§8.1) lo cubre.

### 2. Authz (DA-2) — **RATIFICADO "cualquier rol activo"**, con nota
Ver dictamen DA-2 abajo. `has_role_in(v_est)` (0005:9-25) = cualquier `user_roles` activo en el tenant + establishment no soft-deleted. Es correcto para esta operación: asignar caravana es **CREATE-like** (completar un dato faltante NULL→valor), no una baja. La asimetría con `transfer_animal` (que para la BAJA exige `has_role_in AND (is_owner_of OR creador)`, 0087:104-108) es **intencional y correcta**: ahí se ARCHIVA un perfil (destructivo); acá se agrega identidad a un animal del propio campo. Espeja el alta (`create_animal` 0083 = rol activo) y la carga de eventos. **Ratifico** — ver condición en DA-2.

### 3. Guard NULL→valor + race — **CIERRA**
Doble defensa, ambas verificadas:
- Trigger 0036:13-20 — `if old.tag_electronic is null then return new` (NULL→valor OK); `if new is distinct from old → 23514` cubre valor→valor **y** valor→NULL (el `is distinct from` trata NULL correctamente). Confirmado: el trigger permite SOLO NULL→valor.
- `design §1.2(e)` — `UPDATE ... WHERE id=v_animal_id AND tag_electronic IS NULL` + `§1.2(f)` `if not found → 23514`. El `AND tag_electronic IS NULL` es defensa-en-profundidad explícita y detector de race: si otro device puso la caravana entre (d) y (e), el UPDATE afecta 0 filas → 23514 accionable, distinguible del dup global (23505). No hay forma de que valor→valor o valor→NULL pase: lo bloquean el WHERE y el trigger redundantemente.

### 4. Idempotencia state-based (DA-1) — **RATIFICADO**, sin oráculo cross-tenant
Ver dictamen DA-1 abajo. El orden es load-bearing y está **correcto**: (a) derivar → (b) authz `42501` → (c) formato → (d) dedup por estado. La dedup `§1.2(d)` (`EXISTS animals WHERE id=v_animal_id AND tag_electronic=p_tag_electronic`) corre **DESPUÉS** de derivar+authz y está scopeada a `v_animal_id` (el animal ya derivado del perfil cuyo tenant ya pasó `has_role_in`). Un caller de otro campo nunca llega a (d): rebota en (b) con `42501`. Por lo tanto **no puede confirmar la existencia de un TAG en un animal ajeno** → no hay oráculo cross-tenant. Esto replica el patrón anti-HIGH-D1 de 0075 (la dedup NO es un lookup global por `client_op_id`; es un check de estado anclado al tenant ya autorizado). **Confirmo el orden y descarto el oráculo.**

### 5. Validación de input server-side — **SUFICIENTE** (triple capa)
- `p_tag_electronic`: `!~ '^\d{15}$'` → `23514` (`design §1.2(c)`). Espeja `isValidTag` de spec 04. **Además** la DB ya tiene `animals_tag_electronic_len_chk char_length<=64` (0070:185) — el regex de 15 díg es estrictamente más restrictivo, así que el input queda acotado por DOS controles autoritativos server-side (regex en el RPC + CHECK en la tabla). El sanitizador del cliente (spec 04) es UX/attacker-controlled y NO se cuenta — pero acá la autoridad server-side existe y es fuerte.
- `p_profile_id` (uuid): tipado uuid + derivación de la fila real (rebota `23503` si no existe/inactivo/soft-deleted). Suficiente.
- `p_client_op_id` (uuid): tipado uuid; solo se usa como passthrough del intent (no participa de la dedup state-based, ver DA-1). No requiere validación adicional — no es un vector. (Ver MEDIUM-2 sobre su rol declarado.)

No hay ningún campo de usuario sin límite + validación autoritativa server-side. **Tabla de inputs abajo.**

### 6. Cierre de superficie — **COMPLETO** (paridad 0087)
`design §1.3` + `RD1.8` declaran: `revoke execute ... from public, anon` + `grant ... to authenticated` con firma tipada **`(uuid, text, uuid)`** + smoke-check fail-closed (estilo 0087:279-291, que itera `anon`/`public` y `raise exception` si alguno tiene EXECUTE) + `notify pgrst, 'reload schema'` + `set search_path = public` en la definición. **No falta nada del molde.** Una nota para el implementer: a diferencia de `register_birth` (que dropea la firma vieja por overload), `assign_tag_to_animal` es una función NUEVA → no hay firma previa que dropear ni grant colgando; el revoke/grant sobre `(uuid,text,uuid)` es la única firma. (Ver MEDIUM-1 sobre el naming op_type↔RPC, que toca esto de refilón.)

### 7. Rate limiting / abuso — **no requiere control nuevo server-side**, con caveat documentado
Asignar caravana 1×1 (opción A) o en masa (opción B) es un `UPDATE` barato sobre `animals`, sin fan-out caro, sin email/SMS, sin API externa, sin storage → **no es Denial-of-Wallet**. El N de la masiva (opción B) es N requests independientes encoladas en la outbox (cada `assign_tag` = un `op_intent`, no un fan-out dentro de una sola request), así que NO hay vector de amplificación intra-request (a diferencia del import masivo de spec 12). Un caller autorizado abusando del RPC solo puede escribir caravanas en animales SIN caravana de SU PROPIO campo (el guard NULL→valor + unicidad global limitan el daño a datos propios). **Veredicto: no hace falta un rate limit server-side dedicado para este chunk.** Caveat (LOW-1): no hay rate limit en Edge Functions/RPC custom en Supabase por defecto — si a futuro se observa abuso de escritura masiva sobre `animals`, el control natural sería un límite per-`establishment_id`; hoy no es exploitable y no bloquea.

### 8. Unicidad global / fuga — **NO filtra cross-tenant**
`animals_tag_unique` (0019:22-24) es parcial sobre `tag_electronic IS NOT NULL AND deleted_at IS NULL` (confirmado — **el índice está en 0019, no 0020**; ver MEDIUM-2 sobre la cita). Cuando `p_tag_electronic` ya está en OTRO animal (de cualquier tenant), el UPDATE de (e) viola el índice → `23505` crudo de Postgres, propagado sin capturar → `permanent_reject` en sync (`design §2.3`, `RD1.7`). El `23505` NO revela QUÉ animal ni de QUÉ campo tiene el TAG (es un error de constraint genérico, no devuelve la fila). **`RD6.2`/`design §5` mandan copy accionable "ese TAG ya está asignado a otro animal" y NUNCA `sqlerrm` crudo (`RD6.3`)** — correcto. El único bit que se filtra es "este TAG-de-15-díg existe en algún animal del sistema", lo cual es inherente a una unicidad global de identificador SENASA (es el comportamiento deseado: el TAG es un identificador físico único que existe o no). No es un leak de tenant. **Cierra.**

### 9. Sync set — **NO se debilita el aislamiento de spec 15**
`RD1.9` + `design §1.4`/§7: no se crea stream ni policy RLS; `animals` sigue FUERA del sync set (ADR-026 b1). El efecto baja por `animal_profiles.animal_tag_electronic` vía la propagación del trigger 0079 (`AFTER UPDATE OF tag_electronic on animals` → UPDATE a todos los perfiles del animal, 0079:125-152), que viaja dentro de la stream `est_animal_profiles` ya existente (scopeada por `establishment_id`, RLS de spec 02 R11). El `enqueueAssignTag` NO escribe overlay sobre `animals` (la tabla no existe local). **No se agrega superficie de sync; el aislamiento per-tenant de la stream existente se conserva.** Cierra.

---

## Dictámenes sobre las DECISIONES ABIERTAS (marcadas para Gate 1)

### DA-1 (mecanismo de idempotencia) — **RATIFICADO** (state-based, sin columna nueva)
El design propone reconocer el replay por estado ya aplicado (`animals.tag_electronic` ya = `p_tag_electronic` para `v_animal_id`) en vez de una columna `client_op_id` + índice (como 0075). **Lo acepto para el MVP** por tres razones:
1. **No abre oráculo cross-tenant** (verificado en punto 4): la dedup corre después de authz y está anclada a `v_animal_id` del tenant autorizado.
2. **Es naturalmente idempotente y robusto al ACK perdido**: un reintento del outbox con el mismo intent ve el TAG ya aplicado → `replay:true` sin re-aplicar ni rebotar. Mismo espíritu que el corte temprano de `create_animal` (0083:39-40, "replay completo → 2xx sin segundo efecto, no necesita p_client_op_id"). `assign_tag` califica para ese patrón porque el efecto es un UPDATE sobre una fila estable (no un INSERT con ids server-side como `register_birth`, que SÍ necesitaba la columna).
3. Alinea con R12.4 base (el `updated_at` cubre el audit del MVP; el audit granular es upgrade backwards-compatible).
**Condición**: la suite backend (§8.1 escenario 5) DEBE probar el replay distinguiendo dos sub-casos: (i) replay legítimo del mismo caller (TAG ya = el suyo → `replay:true`), y (ii) que un reintento NO se confunda con un dup global de otro animal. El diseño ya los separa (estado del MISMO `v_animal_id` vs unicidad global de OTRO animal) — solo que el test lo blinde.

### DA-2 (authz "cualquier rol activo" vs owner-or-creator) — **RATIFICADO "cualquier rol activo"**
Pese a que asignar caravana dispara la obligación de declaración SENASA (10 días hábiles), **NO endurezco a owner-or-creator**. Justificación:
- Es trabajo de manga ejecutado por el peón/operario (rol operativo), igual que cargar eventos/pesos/lotes — que hoy NO son owner-only. Exigir owner-or-creator rompería el caso de uso real (el peón caravanea, el owner no está en el corral) y degradaría la experiencia operativa sin cerrar un hueco real: el caller YA tiene rol activo en el campo (lo verifica `has_role_in`), así que es un actor legítimo del tenant, no un atacante externo.
- La consecuencia regulatoria (declaración SENASA) es del **establishment**, no diferencial por rol dentro del establishment — cualquier miembro activo actuando en nombre del campo es válido para asignar identidad. El control de tenant (anti-IDOR + `has_role_in`) ya garantiza que solo se toca el propio campo.
- La asimetría con la BAJA de `transfer_animal`/`exit_animal_profile` (owner-or-creator) es correcta: la baja es destructiva e irreversible para el campo; asignar caravana es aditivo (NULL→valor, inmutable después por 0036, pero corregible vía soft-delete+nuevo insert). El riesgo de un rol operativo asignando una caravana equivocada es el mismo que el de cargar un peso equivocado — se corrige, no se previene con authz.
**Condición (auditabilidad, ver MEDIUM-... no, es LOW-2)**: dado que la asignación es regulatoriamente sensible y, una vez puesta, **inmutable** (0036), conviene que el `updated_at` de la fila (R12.4) sea suficiente para responder "cuándo se asignó", y dejar anotado que el "quién" (audit granular: qué `auth.uid()` la puso) es un upgrade post-MVP ya contemplado. No bloquea; lo anoto en LOW.

---

## Findings MEDIUM (no bloquean PASS; foldeable a la spec)

### MEDIUM-1 — Naming `op_type` ↔ nombre real del RPC: fijar (a) para evitar un case especial frágil
`design §2.2` deja DOS opciones para el mapeo (`op_type='assign_tag'` + case explícito, vs `op_type='assign_tag_to_animal'` + mapeo genérico) y recomienda (a). **Desde seguridad, (a) es la correcta** y conviene fijarla en la spec, no dejarla "el implementer elige": un mismatch entre el `op_type` reconocido en `RPC_OP_TYPES` y el `rpcName` efectivo es un foot-gun — si quedara `op_type='assign_tag'` sin el case que lo remapea a `assign_tag_to_animal`, el intent caería en `PermanentIntentError` (falla cerrada, no es un hueco de seguridad, pero sí un bug de disponibilidad de la operación). **Fix**: en `RD2.3` y `design §2.2`, reemplazar la ambigüedad por la decisión firme: `op_type = 'assign_tag_to_animal'` (= nombre exacto del RPC) + agregarlo a `RPC_OP_TYPES` + la rama de `p_client_op_id`. Reconciliar `RD2.2` (que dice `op_type='assign_tag'`) al mismo nombre. Esto también cierra el riesgo de invocar un `rpcName` que no matchea la firma tipada del grant `(uuid,text,uuid)`.

### MEDIUM-2 — Citas de migración imprecisas + rol declarado de `p_client_op_id` (claridad de contrato)
Dos imprecisiones que conviene corregir antes de cerrar (no son huecos, son ambigüedades que pueden llevar a un mal as-built):
- **Cita del índice**: `design §1.2` (línea 79) y `§1.3` citan el índice de unicidad como "0019" en un lado y `RD1.7`/`context §5` lo citan como "0020"/"0019" mezclado. El índice `animals_tag_unique` está **en 0019** (verificado, 0019:22-24); `animal_profiles` (perfiles) es 0020. Unificar la cita a **0019** para `animals_tag_unique`.
- **`p_client_op_id` declarado pero no usado en la dedup**: `RD1.6`/`RD2.3` describen la idempotencia "por `p_client_op_id`", pero el design (DA-1, que ratifico) la resuelve por estado y el `p_client_op_id` queda como passthrough del contrato del intent (no participa de ninguna columna/índice). Esto es correcto, pero el contrato debe decirlo explícito para que el implementer NO intente colgar una columna `animals.last_assign_op_id` "para cumplir RD1.6". **Fix**: en `RD1.6` aclarar "idempotencia state-based (DA-1 ratificada); `p_client_op_id` se conserva en la firma por compat del intent/mapeo pero NO ancla la dedup". El design §1.2(d) ya lo dice; reconciliar el requirements para que no contradiga.

---

## Anexo LOW

- **LOW-1 (rate limit a futuro)**: no hay rate limit server-side en RPCs custom de Supabase por defecto. Para `assign_tag_to_animal` hoy NO es exploitable (escritura barata, scopeada al propio campo, sin DoW). Si a futuro se observara abuso de escritura masiva, el control natural sería un límite per-`establishment_id`. No bloquea; queda anotado para el backlog de hardening.
- **LOW-2 (audit granular del "quién")**: la asignación es regulatoriamente sensible (SENASA) e inmutable (0036). El `updated_at` (R12.4) cubre el "cuándo" del MVP; el "quién asignó esta caravana" (`auth.uid()` registrado) es un upgrade backwards-compatible post-MVP, ya contemplado en `requirements §"Fuera de este chunk"`. Para un identificador con peso legal, conviene priorizarlo en el roadmap de auditoría — no es bloqueante hoy.

---

## Tabla de inputs (cada campo que el usuario/cliente aporta al RPC)

| campo | límite (largo/charset/formato/rango) | validación (server/cliente/ausente) | OK? |
|---|---|---|---|
| `p_tag_electronic` | exactamente 15 dígitos (`^\d{15}$`); además CHECK DB `char_length<=64` (0070:185) | **server autoritativa** (regex en RPC §1.2c → 23514 + CHECK DB) — el sanitizador de spec 04 es UX adicional, no contado | ✅ |
| `p_profile_id` (uuid) | tipo uuid; debe ser perfil activo no-deleted del que se deriva tenant/animal | **server autoritativa** (tipo uuid + derivación de fila real → 23503 si inválido) | ✅ |
| `p_client_op_id` (uuid) | tipo uuid; passthrough del intent (no ancla dedup, DA-1) | tipo uuid; no es vector (no se concatena, no se loggea crudo) | ✅ |
| query del buscador de candidatos (UI A/B, `searchAnimals` scopeado noTag) | reusa `searchAnimals` as-built (match IDV/visual) — lectura LOCAL sobre SQLite, scopeada por `establishment_id` activo | **no toca el server** (lectura PowerSync local); paginación/scope ya en `buildAnimalsListQuery` | ✅ (lectura local, sin superficie server nueva) |

Ningún campo de entrada queda sin límite + validación autoritativa server-side. El buscador es una lectura local sobre la stream ya scopeada por tenant (no es una query server-side parametrizable por el atacante) → no abre PostgREST filter injection en este chunk.

## Tabla de rate limits (acciones abusables tocadas por el chunk)

| acción | rate limit | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| `assign_tag_to_animal` (RPC, 1×1 opción A) | n.a. (no requerido) | — | sí (rebota 42501/23514/23505/23503) | escritura barata, scopeada al propio campo (anti-IDOR+has_role_in), sin DoW; guard NULL→valor + unicidad global limitan el daño a datos propios |
| asignación masiva (opción B) | n.a. (no requerido) | per-`establishment_id` (a futuro, LOW-1) | sí (cada intent falla cerrado independiente) | N requests independientes en la outbox, sin fan-out intra-request → no es vector de amplificación (a diferencia de import masivo spec 12) |

---

## Dominios de seguridad revisados (trazabilidad)
- **A. Authz a nivel de objeto/función**: A1 (la RPC es SECURITY DEFINER = RLS-bypass por diseño; cierra con derivación de tenant de la fila real + `has_role_in` ✓), A2 (mass assignment: el RPC NO spreea payload — solo `p_tag_electronic` validado va a una columna ✓), A3 (IDOR por FK: `v_animal_id` derivado, nunca del cliente ✓), A4 (BFLA / authz por función: DA-2 ratificada ✓).
- **B. Exposición de datos**: B1 (`23505`/`23514`/`sqlerrm` crudo: `RD6.3` prohíbe `sqlerrm` crudo al cliente, copy genérico ✓), B3 (over-fetching: el RPC devuelve solo `{animal_id, profile_id, tag_electronic, replay}` del propio animal ✓).
- **C. Offline/sync**: C1 (sync rules: no se agrega stream/policy; el efecto baja por `animal_profiles` ya scopeado ✓), C4 (stale-auth en replay: el RPC re-autoriza con `has_role_in` en CADA aplicación al sincronizar, no confía en la autorización que tenía el cliente al encolar ✓).
- **D. Secretos/supply chain**: D1/D3 (sin secrets; el RPC corre server-side, no hay key en el bundle ✓). search_path fijo (`set search_path = public`) ✓.
- **E. Abuso a escala**: E1 (queries acotadas: las listas de candidatos reusan `buildAnimalsListQuery` ya scopeado/local ✓), E2 (DoW: n.a., escritura barata — punto 7).
- **F. Inyección**: F1 (PostgREST filter injection: el buscador es lectura local, no concatena input en `.or()/.filter()` server-side ✓; el RPC parametriza todo vía args tipados de plpgsql ✓).
- **G. BLE**: G1 (input no confiable del bastón re-validado server-side por el `^\d{15}$` del RPC, no se confía en la validación del cliente ✓). El modelo de confianza del canal BLE en sí es de spec 04 (fuera de este chunk).

## Dominios excluidos (con justificación)
- **F2 (import de archivos)**: este chunk no ingiere archivos (eso es spec 12). N/A.
- **F3 (SSRF)**: el RPC no hace `fetch()` a URLs del usuario. N/A.
- **F4 (XSS en email)**: no manda emails. N/A.
- **H (auth/sesión)**: no toca login/tokens/invalidación de sesión. N/A.
- **I1 (retención/borrado)**: no toca `delete_account`. La inmutabilidad del tag (0036) se nota en LOW-2 para audit, no es un dominio de borrado. N/A.

---

## Verificación de salud
- `node scripts/check.mjs` → **verde** (exit 0; las suites RPC molde `transfer_animal`/`create_animal`/`register_birth`/`create_rodeo`/`set_rodeo_config` pasan). No toqué código — solo escribí este reporte. ✓
