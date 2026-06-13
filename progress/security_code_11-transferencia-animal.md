# Security Code Review (Gate 2) — 11-transferencia-animal

**Modo:** `code` (gate obligatorio post-reviewer, antes de Puerta 2).
**Veredicto:** ✅ **PASS** — 0 findings HIGH-confidence.
**Baseline:** `e52dc894e796d840be8e86474056131acca6c1c9` (registrado en `progress/impl_11-transferencia-animal.md`). Trabajamos sobre `main`; el diff de la feature está SIN commitear (`git status --porcelain`), no en `baseline..HEAD`.
**Skill usada:** `sentry-skills:security-review` (cargada; metodología trace-data-flow + verify-exploitability aplicada). Findings de la skill validados manualmente contra el grafo de migrations as-built.
**Nota de aplicación:** revisión ESTÁTICA del SQL (la migración NO está aplicada al remoto todavía — el deploy va tras este Gate 2 + Puerta 2). La verificación behavioral completa la dará la suite `spec 11 — transfer_animal RPC` (15 subtests) tras aplicar `0088` → `0087`.

---

## Resumen ejecutivo

El RPC `transfer_animal` (0087, SECURITY DEFINER) es un **write cross-tenant** (mueve un animal de campo X a campo Y preservando su historia). Es la clase de operación más sensible de la base. Lo revisé contra los 9 focos del prompt + el catálogo RAFAQ (A authz/IDOR/mass-assignment, B information disclosure, C offline/sync isolation, E abuso). **No encontré ningún hueco explotable.** El código replica literalmente patrones ya gateados (0044 authz, 0031 GUC, 0074/0083 RPC SECURITY DEFINER + smoke-check), deriva toda la autoridad de la fila real (nunca del payload), y aísla el wire de sync re-apuntando `establishment_id` en todas las hijas. Los tests negativos cubren los 3 vectores de authz con aserción a `error.code` exacto + guard anti-falso-verde.

---

## Findings HIGH de Sentry

**Ninguno.** No high-confidence vulnerabilities identified.

---

## Findings RAFAQ-SPECIFIC

**Ninguno.** Los dominios de mayor riesgo (A1 service-role/RLS-bypass, A2 mass assignment, A3 IDOR, B1 information disclosure, C1/C2 isolation del wire de sync) fueron revisados y están cerrados (detalle en "Verificación por foco").

---

## Verificación por foco (los 9 del prompt)

### 1. Authz del lado origen = paridad EXACTA con `exit_animal_profile` (0044) — ✅ literal
`0087:100-108`:
```sql
if not public.has_role_in(p_target_establishment_id) then ... 42501 end if;       -- Y (CREATE)
if not (public.has_role_in(v_source_est)
        and (public.is_owner_of(v_source_est) or v_source_created_by = auth.uid())) then ... 42501 end if;  -- X (baja)
```
Comparado contra `0044:48-49` (`exit_animal_profile`):
```sql
if not (public.has_role_in(v_est)
        and (public.is_owner_of(v_est) or v_creator = auth.uid())) then ... 42501
```
**Paridad exacta.** El `has_role_in(v_source_est)` está presente y es obligatorio (no está detrás de un `OR`). Verifiqué los helpers en `0005_rls_helpers.sql`: `has_role_in` exige `ur.active = true` y `is_owner_of` exige `role='owner' AND active=true`. Por lo tanto un EX-creador con rol revocado en X (`user_roles.active=false`) que aún matchee `v_source_created_by = auth.uid()` queda bloqueado por el `has_role_in(X)` → **SEC-SPEC-01 NO se reabre**. Además, el destino Y exige rol activo (no owner) = semántica de CREATE, correcta. Probado por `T2.4` (solo-Y→42501), `T2.5` (solo-X→42501), `T2.6` (rol en X+Y pero ni owner ni creador→42501).

### 2. Anti-IDOR / anti-spoof — ✅ todo derivado de la fila real
`0087:82-88` deriva `v_source_est`, `v_animal_id`, `v_source_created_by`, idv y descriptivos del **SELECT sobre la fila real** del perfil de origen (`where id = p_source_profile_id and status='active' and deleted_at is null`). Ningún parámetro del payload redirige tenant: el caller solo aporta `p_source_profile_id` (el perfil a sacar, sujeto a la authz de baja sobre X derivada de esa fila) y los datos de DESTINO (que pasan por authz de CREATE sobre Y + validación de rodeo/system). `auth.uid()` dentro del DEFINER resuelve el JWT del caller real (los helpers son `stable` y leen `auth.uid()`, patrón as-built de toda la base). El cliente NO puede pasar `establishment_id` de origen ni `animal_id` (no son parámetros) → no hay mass assignment (A2) ni IDOR por FK (A3). `T2.6` prueba que la authz se evalúa sobre la fila real, no sobre quién la invoca.

### 3. GUC `rafaq.is_transfer` (0088) — ✅ no spoofeable, se limpia
- Early-return SOLO con `coalesce(current_setting('rafaq.is_transfer', true),'off')='on'` (`0088:41`). El resto del cuerpo del trigger es idéntico al as-built `0034:66-86` (inmutabilidad de `author_id/animal_profile_id/establishment_id/created_at/edit_window_until` intacta para clientes).
- La GUC la setea SOLO el RPC definer con `perform set_config('rafaq.is_transfer','on',true)` (`0087:213`) — `is_local=true` ⇒ scope transaccional. Un cliente directo a PostgREST no corre dentro de esa transacción del definer y no tiene vía para `SET LOCAL rafaq.is_transfer` dentro de la transacción del trigger ⇒ el early-return no se activa para él ⇒ la inmutabilidad sigue valiendo (vector anti-spoof del wire de sync intacto).
- **Patrón idéntico a `rafaq.is_auto_transition`** (`0031:72-76`: `set_config(...,'on',true)` + `set_config(...,'off',true)`), ya gateado.
- **Se limpia:** `0087:217` hace `perform set_config('rafaq.is_transfer','off',true)` inmediatamente después del UPDATE de `animal_events`. (Aunque por ser `is_local=true` la GUC moriría con la transacción de todos modos, el apagado explícito acota la ventana a las 3 líneas del re-apuntado de `animal_events`.) Probado por `T2.1` (`animal_events` re-apuntado a Y, la GUC dejó cambiar las inmutables) — sin reabrir el bloqueo para clientes.

### 4. Fuga de aislamiento del wire de sync — ✅ todas las hijas a Y, ternero en X a propósito
Hice el inventario COMPLETO de tablas con FK a `animal_profiles(id)` (grep sobre `migrations/`) y verifiqué que el RPC re-apunta cada una:
| Tabla / columna | Re-apuntado en 0087 | establishment_id resultante |
|---|---|---|
| `weight_events.animal_profile_id` | `:193-195` | Y (explícito + force 0077 re-deriva Y) |
| `reproductive_events.animal_profile_id` | `:196-198` | Y |
| `sanitary_events.animal_profile_id` | `:199-201` | Y |
| `condition_score_events.animal_profile_id` | `:202-204` | Y |
| `lab_samples.animal_profile_id` | `:205-207` | Y |
| `animal_events.animal_profile_id` | `:214-216` (vía GUC) | Y |
| `animal_category_history.animal_profile_id` | `:220-222` | Y |
| `reproductive_events.bull_id` (de OTROS) | `:253` | evento queda en X (linaje cruzado, correcto) |
| `reproductive_events.calf_id` (de OTROS) | `:254` | evento queda en X (linaje cruzado, correcto) |
| `birth_calves.calf_profile_id` (animal-como-ternero) | `:229-231` | NO toca est_id → conserva el de la madre (X) = **DEC-A2 intencional** |
| `birth_calves.establishment_id` (animal-como-madre) | `:238-243` | Y (UPDATE explícito; el force 0078 es solo-INSERT) |
| `reproductive_events.semen_id` | n/a (→ `semen_registry`, no animal_profiles) | — |

Las 5 tipadas + `animal_category_history` tienen el force BEFORE INSERT OR UPDATE de `0077` que re-deriva `establishment_id` desde `animal_profiles[new.animal_profile_id]` (= el nuevo perfil, ya en Y por (e) que corre antes de (f)) → converge con el valor explícito. `birth_calves` tiene force **solo-INSERT** (`0078:84-86`), por eso el UPDATE explícito de la fila-puente de la madre (`:238-243`) es la ÚNICA vía y está presente. **Ninguna hija propia queda con establishment_id=X.** El único que queda en X (perfil del ternero) es intencional (DEC-A2: linaje cruzado, el ternero referencia al animal por su `animal_id` global). `T2.1` asserta `establishment_id===estY` en cada hija + el ternero `===estX`; chequea `nOld===0` por tabla (el viejo sin eventos propios).

### 5. Atomicidad / invariante de unicidad — ✅
`animal_profiles_active_animal_unique` (`0020:56-58`) = `unique (animal_id) where status='active' and deleted_at is null`. El RPC archiva el viejo (`status='transferred'`, `:158-162`) **ANTES** de insertar el nuevo activo (`:174-184`). Al cambiar `status`, el viejo deja de matchear el índice parcial → el insert del nuevo activo no colisiona. Todo dentro de `begin;`…`commit;` (`:34`/`:295`) ⇒ rollback total ante cualquier fallo. `T2.2` (siempre exactamente 1 activo) + `T2.3` (category inválida → rollback total, animal intacto en X, historia colgando del viejo).

### 6. Idempotencia (early-return al inicio) — ✅ benigno
`0087:69-76`: el corte de replay (`exists` por `id = p_target_profile_id and establishment_id = p_target_establishment_id`) corre ANTES de la authz. Analicé si introduce fuga/efecto:
- **Sin efectos de escritura** (solo `exists` + `return`).
- **Sin fuga:** el `p_target_profile_id` lo generó el propio cliente (`newTransferTargetProfileId()`); el `exists` está doblemente scopeado por `establishment_id = p_target_establishment_id` (el campo del propio caller). No revela existencia de perfiles de otros tenants (el WHERE exige que el perfil esté en el establishment que el caller pasó; si el caller no tiene rol ahí, lo único que obtiene es `replay:true` sobre un id que él generó — no es un oráculo útil). El resultado de replay no filtra datos de la fila (solo eco de los ids del input + flags).
- Gate 1 lo dio benigno sobre la spec; **confirmado benigno en el código.** Probado por `T2.10` (replay=true, sin 2do perfil).

### 7. Grants / fail-closed — ✅
`0087:276-291`: `revoke execute … from public, anon` + `grant execute … to authenticated`, ambos con **firma tipada completa de 5 uuids** `(uuid, uuid, uuid, uuid, uuid)`. Smoke-check `do $$…$$` que ABORTA el deploy (`raise exception`) si `transfer_animal` quedara EXECUTE-able por `anon` o `public` (estilo `0074`). `notify pgrst` al final. Probado por `T2.13` (anon no invoca — pasa con/sin migración, fail-closed legítimo).

### 8. Service cliente — ✅ no filtra detalles crudos
`app/src/services/transfer-animal.ts::classifyTransferError` (`:100-120`) mapea por `error.code` a copys es-AR genéricos y accionables (`COPY`, `:84-91`). **Nunca expone `error.message`/`sqlerrm` crudo** (el comentario `:82` lo declara explícito y el código lo cumple — el `msg` solo se usa para detectar red por regex, no se reenvía). Los dos sub-casos de 42501 (sin rol en Y / sin owner-or-creator en X) comparten el MISMO copy → no da oráculo de cuál falló (anti-enumeration, alineado con E4). `animals.ts::transferAnimal` (`:1227-1246`) hace `assertOnline` fast-fail (ONLINE-only R7.1) y pasa el `error` de supabase-js a `classifyTransferError`. Esto cierra B1 (information disclosure) en el lado cliente.

### 9. Inputs / rate limit — ✅ (MED-2 aceptado, no escaló)
Los 5 params son uuids tipados por la firma SQL; cada uno se valida server-side por su uso: `p_source_profile_id` (existencia + active + authz sobre X), `p_target_establishment_id` (authz CREATE), `p_target_rodeo_id` (existe + activo + en Y + mismo system, `:122-135`), `p_target_category_id` (FK / `category_check` 0021, validado por el insert → 23514/rollback, probado por `T2.3`), `p_target_profile_id` (id de cliente, solo usado como clave de idempotencia + PK del insert). No hay texto libre, buscador ni prompt LLM → tabla de inputs n/a salvo los uuids (ver abajo). **Rate limit:** MED-2 (sin rate limit en el RPC) fue aceptado por Raf en Puerta 1 como Denial-of-Wallet **self-scoped**: el caller necesita rol activo en X (owner-or-creator) **y** en Y para que la op corra; no es un endpoint pre-auth ni amplifica (un animal por invocación, R7.2). **Confirmo que NO escaló** a un vector cross-tenant ni de abuso a escala con este código.

---

## Tabla de inputs

(El RPC no expone formularios/buscadores/texto-libre/prompts; los 5 params son uuids tipados.)

| campo | límite | validación | OK? |
|---|---|---|---|
| `p_source_profile_id` (uuid) | tipo uuid (firma SQL) | server: existencia + `status='active'` + `deleted_at is null` + authz baja sobre la fila real (0087:82-108) | ✅ |
| `p_target_establishment_id` (uuid) | tipo uuid | server: `has_role_in(Y)` (CREATE) + guard origen≠destino (0087:100,111) | ✅ |
| `p_target_rodeo_id` (uuid) | tipo uuid | server: existe + activo + en Y + mismo system que X (0087:122-135) | ✅ |
| `p_target_profile_id` (uuid) | tipo uuid | server: clave de idempotencia + PK del insert (colisión → 23505) | ✅ |
| `p_target_category_id` (uuid) | tipo uuid | server: FK + `category_check` (0021) en el insert → 23514/rollback | ✅ |

## Tabla de rate limits

| acción | rate limit | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| `transfer_animal` (RPC) | no | n/a | sí (authz fail-closed: necesita rol en X owner-or-creator + rol en Y) | MED-2 aceptado por Raf (Puerta 1) — DoW self-scoped, no amplifica (1 animal/invocación R7.2), no pre-auth. No escaló. |

---

## False positives descartados (trazabilidad)

- **`UPDATE reproductive_events SET animal_profile_id=Y` vs índice UNIQUE parcial `(animal_profile_id, client_op_id) WHERE client_op_id IS NOT NULL` (0075):** evaluado como posible 23505 espuria al re-apuntar varios eventos de parto. **Descartado:** cada evento del perfil viejo conserva su `client_op_id` distinto (único por intent de `register_birth`), así que la tupla `(p_target_profile_id, client_op_id_i)` es única para cada uno → no colisiona. Benigno.
- **`auth.uid()` dentro de SECURITY DEFINER:** posible confusión definer-owner vs caller. **Descartado:** los helpers (`has_role_in`/`is_owner_of`, 0005) son `stable` y leen `auth.uid()` (JWT del request), patrón as-built de toda la base; el DEFINER cambia el privilegio de tabla, no `auth.uid()`. La authz refleja al caller real (probado por T2.4/T2.5/T2.6).
- **Early-return de idempotencia antes de la authz (0087:69-76):** posible oráculo cross-tenant. **Descartado:** doblemente scopeado por `establishment_id=p_target_establishment_id`, sobre un id que generó el propio cliente, sin filtrar datos de fila. No es oráculo útil.
- **`classifyTransferError` mapea casi todo a `kind:'unknown'`:** no es un finding de seguridad — es clasificación de UX; el copy es genérico y NO reenvía `sqlerrm`. Correcto desde el ángulo de information disclosure.

---

## Archivos analizados (diff de la feature)

- `supabase/migrations/0087_transfer_animal_rpc.sql` (RPC SECURITY DEFINER — corazón del cambio)
- `supabase/migrations/0088_animal_events_transfer_guc.sql` (delta trigger + GUC)
- `app/src/services/transfer-animal.ts` (lógica pura: shapes + clasificación de errores)
- `app/src/services/animals.ts` (`transferAnimal`, `newTransferTargetProfileId` — I/O del RPC)
- `supabase/tests/animal/run.cjs` (suite `spec 11 — transfer_animal RPC`, leída para validar cobertura de los vectores de seguridad)

**Referencias as-built cruzadas:** 0005 (helpers RLS), 0020 (unique parcial activo), 0031 (patrón GUC), 0034 (trigger inmutabilidad as-built), 0044 (paridad authz baja), 0045 (birth_calves), 0075 (índice client_op_id), 0077/0078 (force establishment_id en hijas).

---

## Cobertura indirecta de Deno / RLS / PowerSync (advertencia honesta)

- **PL/pgSQL SECURITY DEFINER + RLS:** la skill `sentry-skills:security-review` está orientada a app-code (Python/JS/Go/Java) y NO modela RLS multi-tenant ni triggers PL/pgSQL de Postgres. **La cobertura de 0087/0088 es manual** (revisión estática contra el grafo de migrations, hecha arriba). El RPC bypassa RLS por ser DEFINER — el scoping manual por la fila real + authz explícita (focos 1-4) es lo que sustituye a la RLS; verificado.
- **PowerSync wire de sync:** PowerSync aún no está wired (ADR-002 comprometido, no implementado). El aislamiento del wire depende de que `establishment_id` quede fiel en todas las hijas tras la transferencia (foco 4, cerrado). Cuando se implementen las sync rules, deberán scoparse por `establishment_id IN org_scope` (patrón ya probado en 0077/0078) — fuera del alcance de esta feature.
- **Verificación behavioral:** NO se ejecutó el RPC contra DB real (migración no aplicada). La correctitud de comportamiento la confirmará la suite (15 subtests) tras aplicar `0088`→`0087`. La correctitud de *seguridad* está verificada por revisión estática + paridad con patrones gateados.

---

## Conclusión

**PASS.** El código implementa la transferencia cross-tenant sin abrir ningún vector explotable: authz a paridad exacta con la baja ya gateada (sin reabrir SEC-SPEC-01), toda la autoridad derivada de la fila real (anti-IDOR/anti-mass-assignment), GUC no spoofeable y limpiada, aislamiento del wire de sync completo (todas las hijas a Y, ternero en X a propósito), atomicidad garantizada, grants fail-closed con smoke-check, y cliente que no filtra detalles crudos. Cero findings HIGH-confidence. Apto para Puerta 2 (aprobación humana) y deploy `0088`→`0087`.
