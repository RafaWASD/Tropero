# Security Gate 1 (spec) — RPC `create_rodeo` (15-powersync, T9.8)

**Veredicto: PASS**

Delta revisado: `supabase/migrations/0081_create_rodeo_rpc.sql` (RPC `public.create_rodeo`, SECURITY DEFINER, schema-sensitive, R11.4, NO aplicada al remoto todavía).
Superficie de autorización: la RPC en su totalidad (el swap cliente outbox/overlay lo ve el reviewer).

As-built de referencia leído:
- `0005_rls_helpers.sql:31-48` — `is_owner_of(est_id)`: chequea `auth.uid()` en `user_roles` con `role='owner'`, `active=true`, establishment no soft-deleted.
- `0017_rodeos.sql:53-54` — `rodeos_insert` = `is_owner_of(establishment_id)` (la RLS que la RPC espeja).
- `0018_field_template_and_rodeo_config.sql:133-146` — trigger `rodeos_seed_data_config` (AFTER INSERT) que seedea `rodeo_data_config`.
- `0078_..._rodeo_config.sql:102-131` — trigger `tg_force_establishment_id_from_rodeo` (BEFORE INSERT OR UPDATE) anti-spoof de `rodeo_data_config.establishment_id`.

---

## Análisis del IDOR cross-tenant (finding del implementer — guard `(c-bis)`)

**El guard es hermético. El vector está cerrado.**

Escenario del atacante: es owner real del campo A → pasa `is_owner_of(A)`. Manda `p_id = X` (id de un rodeo existente del campo B, otro tenant) + `p_establishment_id = A`. Objetivo: escribir/leer el `rodeo_data_config` del rodeo ajeno de B vía el UPSERT (d).

Camino traceado:
- **(a) `0081:53` `is_owner_of(A)`** → true (owner real de A). Pasa. ← authz primero.
- **(c) `0081:78-80` INSERT** `(id=X, establishment_id=A, ...) ON CONFLICT (id) DO NOTHING`. El id X ya existe (es de B) → conflicto en la PK → **no-op**. `rodeos[X]` sigue siendo de B, intacto. El INSERT, además, SIEMPRE usa `establishment_id = p_establishment_id (=A)`: es imposible que cree una fila con tenant ≠ A.
- **(c-bis) `0081:88-93`** `if not exists (rodeos where id=X and establishment_id=A and deleted_at is null) → raise 42501`. La fila X existe pero con `establishment_id = B ≠ A` → `exists` es **false** → `not exists` es **true** → **raise 42501. Aborta antes de (d).** El `rodeo_data_config` de B NUNCA se toca.

Sub-casos validados (todos cerrados):

1. **¿Algún orden donde (d) corra sobre un rodeo ajeno?** No. (d) `0081:102-114` está físicamente después de (c-bis), que hace `raise exception` (aborta función + transacción del statement). No hay path que salte el guard.
2. **¿El INSERT pudo crear el rodeo con otro tenant?** No. Siempre inserta `establishment_id = p_establishment_id (=A, ya validado por is_owner_of)`. El trigger `rodeos_validate_species_system` (BEFORE INSERT) no toca el tenant. Si hay colisión, no crea nada.
3. **Colisión con rodeo PROPIO soft-deleted:** `p_id = Y`, Y de A pero `deleted_at IS NOT NULL`. (c) → conflicto, no-op. (c-bis) exige `deleted_at is null` → `exists` false → **raise 42501**. No se puede revivir ni reescribir la config de un rodeo soft-deleted vía la RPC. (Defensa extra no exigida explícitamente, correcta.)
4. **Defensa en profundidad (0078):** aunque hipotéticamente (d) corriera, el trigger `tg_force_establishment_id_from_rodeo` forzaría `rodeo_data_config.establishment_id = rodeos[X].establishment_id = B`. Eso es anti-spoof de COLUMNA, NO anti-IDOR de WRITE (la fila igual se escribiría con tenant B). Por eso **el guard (c-bis) es el control primario y load-bearing**, correctamente ubicado entre el INSERT y el UPSERT. No hay redundancia que enmascare un hueco.

Conclusión: no se puede leer ni escribir `rodeo_data_config` de otro tenant. **IDOR cerrado.**

---

## Authz owner-only (punto 2) — OK

- (a) `is_owner_of(p_establishment_id)` corre PRIMERO, antes de toda escritura (`0081:53`). Espeja exactamente `rodeos_insert` (`0017:53-54`).
- `is_owner_of` (`0005:31-48`) → `role='owner'` + `active=true` + establishment no soft-deleted. field_operator / vet / usuario sin rol en el campo → false → 42501.
- **Nota definer:** SECURITY DEFINER corre como el owner de la función, pero `is_owner_of` usa `auth.uid()`, que PostgREST resuelve del JWT del request (no del rol de ejecución de Postgres). El caller autenticado sigue siendo el evaluado. Patrón estándar, correcto.

## Idempotencia / at-least-once (punto 3, R6.10) — OK, no-op total

Replay completo (mismo `p_id` + `p_toggles`):
- (c) `ON CONFLICT (id) DO NOTHING` → no 2do rodeo + NO re-dispara `rodeos_seed_data_config` (AFTER INSERT solo en INSERT efectivo) → plantilla no se duplica.
- (c-bis) en replay → rodeo ya existe y es de A → `exists` true → pasa (no 42501 espurio).
- (d) `ON CONFLICT (rodeo_id, field_definition_id) DO UPDATE SET enabled = excluded.enabled` → re-aplica el MISMO end-state. No-op semántico.

Replay = no-op total. No hay caso donde un replay duplique o corrompa. No necesita `p_client_op_id` (dedup natural por el id de cliente del rodeo).

## Aditivo / grants (punto 4, R11.3) — OK

- La migración solo hace `create or replace function public.create_rodeo` + revoke/grant + `notify pgrst`, dentro de `begin/commit`. NO toca tablas, RLS, policies ni triggers as-built. `create_rodeo` es función nueva (grep confirma que solo aparece en 0081 y en el test).
- Grants cierran la superficie con **firma tipada completa** `(uuid, uuid, text, uuid, uuid, jsonb)` en ambas líneas (`0081:127-128`): `revoke execute from public, anon` + `grant execute to authenticated`. anon/public no pueden invocar.

## Inputs (punto 5) — OK (un MEDIUM menor por regla dura de inputs)

- No hay SQL dinámico (`EXECUTE`), no hay concatenación de input en filtros, `search_path = public` fijado → sin vector de inyección.
- `establishment_id` de `rodeo_data_config` NO se setea desde el input: lo fuerza el trigger 0078 (anti-spoof). El INSERT de `rodeos` arma los campos a mano (no spread de body) → sin mass assignment.

### Tabla de inputs

| campo | límite (largo/charset/formato/rango) | validación | OK? |
|---|---|---|---|
| `p_name` | no-vacío (trim); **SIN largo máximo** | server: (b) `0081:59-61` raise 23514 + constraint `rodeos_name_not_empty` `0017:17` | ⚠ sin tope de largo (MEDIUM menor) |
| `p_species_id` | UUID; debe existir + active | server: (b) `0081:62-66` + FK + trigger `0017:40` | ✓ |
| `p_system_id` | UUID; combinación válida + active | server: (b) `0081:67-72` + FK + trigger `0017:40` | ✓ |
| `p_toggles[].field_definition_id` | UUID no-null; FK a field_definitions | server: raise 22023 `0081:107-109` + FK 23503 | ✓ |
| `p_toggles[].enabled` | boolean (default true) | server: cast + coalesce `0081:106` | ✓ |
| `p_toggles` (cardinalidad) | SIN tope de N de entradas | ausente — acotado de facto por el FK al catálogo global | ⚠ LOW |
| `p_id` / `p_establishment_id` | UUID; tenant validado | server: (a) is_owner_of + (c-bis) anti-IDOR | ✓ |

### Tabla de rate limits

| acción | rate limit | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| `create_rodeo` RPC | no | n.a. | n.a. | No-bulk, sin email/SMS, sin fetch externo, sin fan-out cross-tenant. Owner-only. Write infrecuente (una por alta de rodeo, drenada desde outbox). No es vector de DoW ni amplificación → rate limit no aplica a nivel RPC. El abuso se acota por authz + dedup natural. |

---

## Findings

### HIGH
Ninguno. El IDOR cross-tenant que cazó el implementer en autorrevisión está cerrado herméticamente por el guard `(c-bis)` (`0081:88-93`). Verificación traceada arriba.

### MEDIUM
- **M1 · `p_name` sin largo máximo server-side** (`0081:46`, `0081:59-61`). La validación server-side solo rechaza vacío; no hay tope de largo. No es exploitable hoy (`name` es `text`, campo de nombre de rodeo, no se concatena ni se usa en buscador/ilike/prompt), pero la regla dura de inputs exige "límite claro + validación por cada campo de entrada".
  - **Fix mínimo:** agregar a (b) `if char_length(v_name) > 120 then raise exception '...' using errcode = '23514'; end if;` (tope alineado al `NAME_MAX_LENGTH` de UI as-built), o un `CHECK (length(name) <= 120)` en la columna `rodeos.name`. Clasificado MEDIUM por la regla de inputs, no por hueco de seguridad real.

---

## Anexo LOW
- **L1 · `p_toggles` sin tope de cardinalidad** (`0081:102-114`). El loop no acota cuántas entradas procesa. Acotado de facto por el FK a `field_definitions` (cada entrada inexistente → 23503) y por ser owner-only sin fan-out cross-tenant. Riesgo de abuso bajo. Opcional: cap defensivo del N de entradas (p. ej. `jsonb_array_length(p_toggles) <= 64`).

---

## Dominios revisados (trazabilidad)
- **A1** service-role/definer bypassa RLS → guard `is_owner_of` + (c-bis) cierran el tenant manualmente. OK.
- **A2** mass assignment → INSERT arma campos a mano; `establishment_id` = param validado; toggles whitelist `{field_definition_id, enabled}`; el `establishment_id` de config lo fuerza 0078. OK.
- **A3** IDOR por FK → guard (c-bis) + FK de `field_definition_id`. OK.
- **A4** function-level authz → owner-only, espeja `rodeos_insert`. OK.
- **C4** stale-auth / replay at-least-once → idempotencia no-op total; (c-bis) re-autoriza en cada replay. OK.
- **D** grants/superficie → firma tipada completa, revoke public/anon + grant authenticated. OK.
- **F1** injection → sin EXECUTE, sin concatenación, search_path fijo. OK.
- **Inputs** → cada campo validado server-side (1 gap menor: largo de `p_name`).
- **Rate limit** → no aplica a nivel RPC (documentado).

## Dominios excluidos (con justificación)
- **B (information disclosure)** — los `raise` devuelven mensajes genéricos, sin `err.message` crudo ni PII. No aplica.
- **C1/C2/C3 (PowerSync sync rules / Realtime / data-at-rest)** — fuera de esta RPC; el swap cliente outbox/overlay lo ve el reviewer. La columna `establishment_id` del stream de `rodeo_data_config` ya la cierra 0078.
- **E (escala/DoW), F2/F3/F4 (import/SSRF/email), G (BLE), H (sesión), I (compliance)** — no tocados por este delta (RPC no hace fetch, no parsea archivos, no manda email, no toca BLE ni sesión).
