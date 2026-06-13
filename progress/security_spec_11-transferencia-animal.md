# Gate 1 (security_analyzer, modo `spec`) — Spec 11 transferencia-animal

**Fecha**: 2026-06-12 (sesión 23) · **Modo**: spec (write cross-tenant + re-parenting masivo + RPC `SECURITY DEFINER`)
**Input**: `specs/active/11-transferencia-animal/{context,requirements,design,tasks}.md`
**As-built revisado**: `0005` (has_role_in/is_owner_of), `0021/0030/0031` (patrón GUC `rafaq.is_auto_transition`), `0034` (animal_events + trigger inmutabilidad), `0044` (exit_animal_profile — baja), `0045` (birth_calves), `0077/0078/0079` (denorm establishment_id/identidad), `0083` (create_animal — mold idempotencia), `0084/0085` (is_castrated/future_bull).

## Veredicto: **FAIL**

2 findings HIGH-confidence. El **diseño del write cross-tenant en sí es sólido** (anti-spoof de tenant, aislamiento de sync, atomicidad, grants y bypass-por-GUC están bien resueltos — ver "DECs verificados"), pero hay **1 hueco de autorización explotable (HIGH-1)** y **1 defecto que rompe la idempotencia declarada R6.1/R6.2 (HIGH-2, fail-closed)**. Ambos se cierran con cambios chicos en el design (pre-implementación). Hay que mandarlos al fix-loop antes de la Puerta 1.

---

## Findings HIGH

### HIGH-1 — BFLA: la transferencia evade la autorización owner-or-creator que el as-built exige para SACAR un animal de un campo (paridad rota con `exit_animal_profile`)

**Severidad de seguridad: HIGH (explotable, escalada de privilegio / remoción cross-owner).**

**Evidencia.** El design `§3.2(a)` (design.md:108-111) y R5.1 (requirements.md:93) autorizan la transferencia con **solo**:

```sql
if not (public.has_role_in(v_source_est) and public.has_role_in(p_target_establishment_id)) then
  raise exception '...' using errcode = '42501';
```

es decir, **cualquier rol activo** en X y en Y.

Pero la transferencia **archiva el perfil de origen** (`§3.2(d)`, design.md:160-162): `status='transferred', exit_reason='transfer', exit_date`. Eso es **funcionalmente idéntico a una baja** (`exit_animal_profile`, 0044). Y el as-built de la baja exige autorización **más fuerte** (0044_exit_reason_enum.sql:48-51, endurecido en SEC-SPEC-01 Gate 1 s20):

```sql
-- exit_animal_profile (BAJA):
if not (public.has_role_in(v_est)
        and (public.is_owner_of(v_est) or v_creator = auth.uid())) then
  raise exception 'not authorized to exit this animal' using errcode = '42501';
```

→ Para dar de **baja** un animal de X hace falta ser **owner de X** o el **operario que lo cargó** (`created_by`). Pero para **transferirlo** (= sacarlo de X con `status='transferred'`) el design solo pide `has_role_in(X)`. **`transfer_animal` es un camino de baja que evade el gate owner-or-creator de `exit_animal_profile`.**

**Por qué es explotable (no es teórico).** El modelo multi-tenant permite que un mismo usuario tenga roles en campos de **owners distintos** (ej. un peón/veterinario que trabaja para Owner-A en el campo X y para Owner-B en el campo Y). Con rol de `field_operator` en X (sin ser owner ni `created_by` del animal) hoy **NO** puede dar de baja un animal de X — pero **SÍ** podría transferirlo de X (de Owner-A) a Y (de Owner-B) sin consentimiento de ninguno de los dos owners, sacando el animal del rodeo activo de Owner-A y re-parenteando TODA su historia al campo de Owner-B. La única condición que necesita el atacante es tener *algún* rol en *algún* Y, trivial de satisfacer. El gate owner-or-creator de la baja existe justamente para evitar que un mero operario remueva animales; la transferencia lo abre.

**Qué cambio cierra el vector.** Alinear la autorización del **lado origen** con la baja (`exit_animal_profile`), que es la operación equivalente:

```sql
-- lado ORIGEN X: paridad con exit_animal_profile (remover de X = baja)
if not (public.has_role_in(v_source_est)
        and (public.is_owner_of(v_source_est) or v_source_created_by = auth.uid())) then
  raise exception '...' using errcode = '42501';
end if;
-- lado DESTINO Y: paridad con create_animal (agregar a Y) — has_role_in alcanza
if not public.has_role_in(p_target_establishment_id) then
  raise exception '...' using errcode = '42501';
end if;
```

(leer `created_by` del perfil de origen en el `SELECT` de `§3.2(a)`, junto con `establishment_id`/`animal_id`/`idv`). Actualizar **R5.1/R5.2** para reflejar la paridad owner-or-creator en el origen, y la tabla de `§7` (fila "Write cross-tenant sin rol en origen X"). Si el producto quiere a propósito que cualquier operario transfiera (caso single-owner-dos-campos), eso es una **decisión de Raf que debe documentarse explícitamente** — pero el default seguro y consistente con el as-built es owner-or-creator. **REQUIERE confirmación de Raf en Puerta 1** (es la misma clase de decisión que SEC-SPEC-01 tomó para la baja).

---

### HIGH-2 — La idempotencia (R6.1/R6.2) no funciona: el guard de "perfil de origen activo" dispara ANTES del corte de replay → el reintento devuelve error en vez del resultado ya aplicado

**Severidad de seguridad: benigna (fail-closed: NO hay doble re-parenting, NO hay segundo perfil, NO hay corrupción). Confianza del defecto: HIGH. Rompe un requisito explícito del Gate 1 (R6.1/R6.2).**

**Evidencia.** Orden de operaciones del design `§3.2`:

- `(a)` (design.md:98-106): `SELECT ... FROM animal_profiles WHERE id = p_source_profile_id AND status='active' AND deleted_at is null`; si `v_source_est is null` → `raise ... '23503'`.
- `(a-bis)` (design.md:118-130): corte de idempotencia — si el perfil target ya existe → no-op + return.

El problema: cuando la **primera** transferencia commitea, el perfil de origen queda `status='transferred'` (`§3.2(d)`, R4.1 — NO soft-delete, `deleted_at` NULL). En el **reintento por ACK perdido** (R6.1), el `SELECT` de `(a)` filtra `status='active'` → **no encuentra fila** → `raise '23503'` **antes de llegar a `(a-bis)`**. El corte de replay **nunca se alcanza** tras una transferencia commiteada. Es código muerto para el caso que dice cubrir.

Contraste con el mold `create_animal` (0083), donde el patrón SÍ funciona: su precondición previa al corte `(a-bis)` es solo `has_role_in(p_establishment_id)` (0083:83-101), que **sobrevive al replay** (el usuario sigue teniendo el rol). `transfer_animal` copió el `(a-bis)` pero lo puso **detrás de una precondición que la propia operación invalida** (archivar el origen). Resultado: R6.1 ("deberá devolver el resultado de la operación ya aplicada") **no se cumple**; el cliente que reintenta tras un ACK perdido recibe `23503` y puede mostrarle al operario un error sobre una transferencia que en realidad fue exitosa.

**Por qué la seguridad es benigna.** En el reintento el origen ya está inactivo → el segundo intento falla limpio (`23503`), sin re-parentear de nuevo ni crear un segundo perfil. Es decir: el sistema **falla cerrado** (R6.3 carrera se sostiene por el unique parcial). Lo roto es el **contrato de idempotencia/robustez**, no el aislamiento.

**Qué cambio lo cierra.** Mover el corte de idempotencia **antes** del guard de origen-activo, de modo que el `p_target_profile_id` de cliente (UUID único del intent) sea lo primero que se evalúa:

```sql
-- ANTES de leer/validar el perfil de origen:
if exists (
  select 1 from public.animal_profiles ap
  where ap.id = p_target_profile_id
    and ap.establishment_id = p_target_establishment_id
) then
  -- replay de una transferencia ya commiteada → no-op + return el resultado
  return jsonb_build_object('target_profile_id', p_target_profile_id, 'replay', true, ...);
end if;
```

(para devolver `source_profile_id`/`idv_dropped` en el replay, leerlos de la fila target existente). Esto replica la robustez de `create_animal`. Actualizar `tasks.md` T1.3 y la fila de idempotencia de design `§7`.

> Nota de clasificación: por mi rúbrica estricta de seguridad esto no es un "hueco explotable" (falla cerrado). Lo reporto como HIGH-confidence porque la Puerta 1 me pidió verificar explícitamente el replay/idempotencia (punto 6) y el mecanismo declarado es código muerto; el fix es barato y pre-implementación. El leader decide si lo trata como bloqueante de gate o como must-fix de corrección en el mismo loop.

---

## Findings MEDIUM

### MED-1 — DEC-A3: mover `birth_calves` del parto-de-la-madre a Y le quita a X el registro de nacimiento de terneros que SIGUEN en X (pérdida de disponibilidad, no fuga)

**Evidencia.** design `§4.4` (design.md:288-298) agrega:

```sql
update public.birth_calves bc set establishment_id = p_target_establishment_id
 where bc.birth_event_id in (
   select id from public.reproductive_events
   where animal_profile_id = p_target_profile_id and event_type = 'birth');
```

Cuando A es **madre**, su evento de parto se mueve a Y (`§3.2(f)`), y este UPDATE arrastra las filas `birth_calves` de ese parto a Y. Pero **los terneros (calf_profile_id) quedan en X** (linaje cruzado, R8.1). Consecuencia: el `birth_calves` sale del sync set de X → un viewer en X, parado en la ficha de su ternero residente, **ya no ve el registro de nacimiento de su propio animal** (la fila vive ahora en el sync set de Y).

**Seguridad: aceptable, sin fuga.** Verifiqué el schema de `birth_calves` (0045:12-17 + 0078): columnas = `birth_event_id`, `calf_profile_id`, `created_at`, `establishment_id`. **No tiene atributos denormalizados del ternero** (sexo/peso/tag viven en el perfil del ternero, que queda en X y protegido por RLS/sync de X). Mover la fila a Y expone a Y **solo punteros UUID**, no datos del ternero → no hay breach de aislamiento. El problema es de **modelo de datos / disponibilidad** (a qué campo "pertenece" el registro de parto cuando madre y cría se separan), no de seguridad.

**Recomendación.** Es exactamente la decisión que DEC-A3 marcó para el gate. Desde seguridad: **no bloquea** (no hay leak). Pero Raf debería confirmar conscientemente la consecuencia: X pierde de su sync set el registro de nacimiento de un animal que todavía reside en X. Alternativa a evaluar: dejar `birth_calves` del parto en X (sigue al ternero/registro físico) en vez de seguir a la madre — simétrico con DEC-A2. Decisión de producto, no de seguridad; documentarla.

### MED-2 — Sin rate limit en una RPC que re-parentea N filas por llamada (DoW / contención sobre la DB compartida)

**Evidencia.** El RPC es online, `authenticated`, y re-parentea toda la historia de un animal por invocación (`§3.2(f)(g)`); Supabase **no** rate-limitea RPCs por defecto. design `§8` (design.md:376-381) trata performance pero **no** propone límite. R7.2 acota a 1 animal por llamada, pero no la **frecuencia**: un caller con rol en X y Y puede loopear transferencias (X→Y→X→…) generando perfiles archivados + re-parenting de N filas en cada pasada.

**Blast radius acotado.** El abuso requiere rol en **ambos** campos → el atacante golpea **sus propios tenants** (no es amplificación cross-tenant), y el costo es trabajo de DB acotado (un animal por llamada, no fan-out masivo tipo import). El riesgo real es **contención de recursos sobre el Postgres compartido** (afecta a otros tenants indirectamente) y crecimiento de perfiles archivados basura.

**Recomendación.** No bloqueante. Anotar como riesgo aceptado en el design, o agregar un throttle keyeado **per-user / per-`establishment_id`** (fail-closed) si se quiere defensa. Como mínimo, documentar la decisión en `§8`. (Tabla de rate limits abajo.)

---

## Anexo LOW

- **LOW-1 — Oráculo de existencia por código de error.** En `§3.2(a)` el `SELECT` del origen dispara `23503` ("not found/active") **antes** del chequeo de rol; un caller sin rol en X puede distinguir "este `p_source_profile_id` es un perfil activo" (→ luego `42501`) de "no existe" (→ `23503`). Fuga marginal (UUIDs `gen_random_uuid` no enumerables). Mejora: error **uniforme** (un solo `42501` genérico "no autorizado o inexistente") como hace `create_animal` en sus guards anti-IDOR (0083:128/167), sin oráculo. No bloqueante.
- **LOW-2 — Performance/lock (ya flagged en `§8`).** Los UPDATE de `bull_id`/`calf_id` recorren `reproductive_events` por columnas **sin índice dedicado** → posible seq-scan + locks largos en una `reproductive_events` grande. El design ya lo manda al implementer (EXPLAIN ANALYZE + índice parcial). Lo confirmo como LOW; en el beta (un campo) es acotado.
- **LOW-3 — Chequeo de colisión de `idv` (`§3.2(c)`) no filtra `status`.** Matchea `establishment_id = Y AND idv = v AND deleted_at is null` (incluye perfiles `transferred`). Si difiere del predicado del unique `(establishment_id, idv)` de spec 02 R4.3, el INSERT igual revienta con 23505 y revierte (fail-closed). Verificar que el predicado del check espeje el del índice. No es de seguridad.

---

## DECs verificados (trazabilidad — el gate los revisó y los considera SEGUROS salvo lo marcado arriba)

- **DEC-A1 (bypass del trigger de inmutabilidad de `animal_events` por GUC `rafaq.is_transfer`) — VERIFICADO SEGURO.** (a) Solo el RPC `SECURITY DEFINER` setea la GUC; (b) un cliente PostgREST **no puede** setear GUCs custom `rafaq.*` (PostgREST solo expone `request.*` desde JWT/headers; no hay `SET` arbitrario por la REST API) → el UPDATE de cliente directo sigue rechazado por `tg_animal_events_enforce_edit_window` (0034:66-90); (c) replica fielmente el patrón as-built aceptado `rafaq.is_auto_transition` (0031:72-76, `set_config(..., true)` transaction-local). **Guard-rail para el implementer**: el early-return debe leer `coalesce(current_setting('rafaq.is_transfer', true), 'off') = 'on'` (con el `true` de `missing_ok` + default `'off'`), o un UPDATE legítimo de `animal_events` fuera de transferencia tiraría error por GUC inexistente. El early-return solo debe dispararse con la GUC en `'on'`; la inmutabilidad para clientes queda intacta. Reconciliar el delta en `design.md` de spec 02 (T1.12/T5.1).
- **DEC-A2 (`birth_calves` del animal-como-ternero con madre en X: dejar `establishment_id` en X) — VERIFICADO SEGURO.** El force de `birth_calves` es solo-INSERT (0078:83-86) → el UPDATE de `calf_profile_id` no re-deriva el establishment → queda en X (el de la madre). Sin fuga (la fila solo lleva punteros; sin atributos del ternero). OK.
- **DEC-A4 (campos descriptivos del perfil, `§4.7`/R2.12) — VERIFICADO SEGURO.** Ningún campo de tenant/authz entre ellos. `notes` se **resetea a NULL** (bien: evita arrastrar notas operativas internas de X al campo Y — sería una fuga menor de PII/operativa si viajaran). `entry_*` reset; `visual_id_alt`/`breed`/`coat_color` (del animal) viajan — legítimo. La partición es decisión de producto (TODO-D6), no de seguridad.
- **Anti-spoof de tenant — VERIFICADO.** El RPC **no acepta** `establishment_id` de origen ni `animal_id` por parámetro; ambos derivan de la fila real del perfil de origen (`§3.2(a)`). `p_target_establishment_id` está gateado por `has_role_in`, y el rodeo destino se valida `r.establishment_id = p_target_establishment_id` (`§3.2(b)`, design.md:135-140). Ningún parámetro redirige el tenant.
- **Aislamiento del wire de sync (RECON-1, R3.6) — VERIFICADO.** Las 8 tablas que referencian `animal_profiles(id)` (5 tipadas + `animal_category_history` + `animal_events` + `birth_calves`) están todas cubiertas: cada UPDATE setea `establishment_id = Y` explícito **y** el force-trigger `tg_force_establishment_id_from_profile` (0077, BEFORE INSERT OR UPDATE) re-deriva al mismo Y porque el `animal_profile_id` del mismo UPDATE ya está en Y → convergen. Depende del orden (perfil nuevo creado en `(e)` ANTES de re-apuntar hijas en `(f)`) — **presente** en el design. `birth_calves` (force solo-INSERT) se maneja por UPDATE explícito en ambos sentidos (`§4.4`). No queda fila con X huérfano ni con Y indebido (salvo la consideración de modelo de MED-1).
- **Vínculos cross-tenant (R3.4/R8.1) — VERIFICADO sin leak de columnas.** Tras re-apuntar `bull_id`/`calf_id` de eventos de la descendencia que queda en X, esos eventos (en X) guardan solo el **UUID** del perfil nuevo (en Y). La RLS de `animal_profiles` resuelve a "otro campo" para un viewer sin rol en Y. El force-trigger mantiene esos eventos en X (su `animal_profile_id` = descendiente en X). Sin fuga de columnas de Y.
- **Atomicidad / unicidad (R4.2/R4.3) — VERIFICADO.** Archivar viejo (`§3.2(d)`) ANTES de crear nuevo (`§3.2(e)`), todo en una transacción plpgsql → nunca dos activos observables; rollback total ante fallo. El estado intermedio de cero-activos es intra-transacción (invisible por MVCC). El unique parcial `animal_profiles_active_animal_unique` se sostiene.
- **Superficie del grant (R5.5) — VERIFICADO.** `revoke ... from public, anon` + `grant ... to authenticated` con firma tipada completa (5 uuid) + smoke-check fail-closed + `notify pgrst` (`§3.3`, design.md:230-249). Espeja 0074/0083.
- **`has_role_in` exige `active = true`** (0005:22) y **`is_owner_of` exige `role='owner' AND active=true`** (0005:44-45) — confirmado. **Guard origen==destino** presente (design.md:114-116).

---

## Tabla de inputs (parámetros del RPC — todos UUID/typed, validación server-side autoritativa)

| Parámetro | Límite/tipo | Validación (server) | OK? |
|---|---|---|---|
| `p_source_profile_id` | uuid | SELECT activo + (tras fix HIGH-1) owner-or-creator en X | OK con fix HIGH-1 |
| `p_target_establishment_id` | uuid | `has_role_in(Y)` obligatorio | OK |
| `p_target_rodeo_id` | uuid | existe + activo + `establishment_id=Y` + mismo `system_id` que origen (`§3.2(b)`) | OK |
| `p_target_profile_id` | uuid (cliente, idempotencia) | PK del perfil nuevo; colisión con perfil ajeno → 23505 rollback (fail-closed); corte replay (tras fix HIGH-2) | OK con fix HIGH-2 |
| `p_target_category_id` | uuid | re-validada por `tg_animal_profiles_category_check` (0021) contra el system del rodeo destino → 23514 + rollback | OK |

Sin inyección (parametrizado; sin concatenación de texto libre, sin `.or()/.filter()`, sin prompt LLM). No hay formularios/buscadores de texto libre en esta superficie (el frontend del find-or-create es spec 09, deferred — se gatea ahí).

## Tabla de rate limits

| Acción | Rate limit | Keyeo | Fail-closed? | Nota |
|---|---|---|---|---|
| `transfer_animal` (re-parentea N filas, online) | **NO** | — | n/a | MED-2: sin throttle; abuso self-scoped (rol en X y Y), riesgo = contención DB compartida + perfiles archivados basura. Recomendado throttle per-user/per-establishment o riesgo aceptado documentado. |

---

## Dominios de seguridad revisados (catálogo RAFAQ)

- **A1 service-role/definer bypassa RLS** → revisado: el RPC es `SECURITY DEFINER`; la barrera es `has_role_in`/owner-or-creator derivado de la fila real, no la RLS. HIGH-1 = gap en esa barrera.
- **A2 mass assignment** → revisado: el INSERT del perfil nuevo arma campos uno por uno (no spread de payload); `created_by`/identidad/`is_castrated` los fuerzan triggers, no el cliente. OK.
- **A3/A4 IDOR / BFLA** → HIGH-1 (BFLA en el lado origen).
- **B1 information disclosure** → LOW-1 (oráculo por errcode). El service-layer (T3.1) debe mapear errores sin filtrar `sqlerrm` — anotado en tasks, verificar en modo `code`.
- **C1/C2 sync rules / Realtime** → revisado: aislamiento del wire por `establishment_id` denorm (RECON-1) VERIFICADO; la stream nueva la arma el leader (ADR-026) — verificar en `code` que la fila re-parenteada salga de X y entre a Y.
- **E1/E2 abuso a escala / DoW** → MED-2.
- **F1 PostgREST filter injection** → n/a (sin texto libre en el RPC).
- **H1 invalidación de sesión** → n/a a esta spec.

## Dominios excluidos (con justificación)

- **C3 data-at-rest local, C4 stale-auth offline replay** → la transferencia es **online-only** (R7.1, no se encola offline) → no aplica el replay offline ni la mutación encolada. La idempotencia (HIGH-2) es por ACK de red perdido, no por sync offline.
- **D (secretos/supply chain), G (BLE), F2/F3/F4 (import/SSRF/email)** → la spec no toca esos dominios (es puro SQL transaccional; sin Edge Function, sin I/O externo, sin email, sin parsers, sin BLE). El punto de entrada BLE/find-or-create es spec 09 (deferred), se gatea ahí.
- **I1 retención/borrado** → la transferencia no borra (archiva con rastro, R4.1); no toca `delete_account`.

---

## Resumen para el fix-loop (antes de Puerta 1)

1. **HIGH-1** — alinear authz del lado **origen** con `exit_animal_profile`: `has_role_in(X) AND (is_owner_of(X) OR created_by(origen)=auth.uid())`; destino queda `has_role_in(Y)`. Actualizar R5.1/R5.2 + design `§3.2(a)` + `§7`. **Confirmar con Raf** si a propósito quiere permitir transferir a cualquier operario (decisión de producto, default seguro = owner-or-creator).
2. **HIGH-2** — mover el corte de idempotencia por `p_target_profile_id` **antes** del guard de origen-activo (mold `create_animal` 0083). Actualizar T1.3 + design `§3.2`/`§7`.
3. **MED-1 (DEC-A3)** y **MED-2 (rate limit)** — decisiones para Raf/leader; no bloquean el gate de seguridad pero deben quedar documentadas.
