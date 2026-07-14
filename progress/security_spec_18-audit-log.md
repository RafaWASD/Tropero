# Security review (Gate 1, modo `spec`) — 18-audit-log

- **Feature**: 18-audit-log · **Analista**: security_analyzer (modo `spec`)
- **Input**: `specs/active/18-audit-log/{context,requirements,design,tasks}.md` + diff conceptual de
  `_shared/supabase.ts` + 4 Edge Functions (`accept_invitation`, `change_member_role`, `remove_member`,
  `delete_account`).
- **Historial**: 2026-07-13 primer pase → **NEEDS_CLARIFICATION** (H1 + M1/M2/M3). Raf eligió **Opción A**.
  `spec_author` reconcilió. **Este documento = re-run sobre la spec reconciliada.**

## Veredicto (re-run): **PASS**

La reconciliación cierra H1 con un mecanismo **spoof-safe y de misma-transacción** correctamente razonado,
cierra M1 (muro de lectura con abort in-migration) y M3/L1/L2 (documentados), y aborda M2 (best-effort en el
hot path). Queda **una** observación MEDIUM de robustez sobre el best-effort (no explotable, fix trivial) y
tres notas menores, todas verificables en **Gate 2 (código)** — no bloquean Puerta 1.

**→ Apto para Puerta 1.** Las watch-items de abajo son hardening que Gate 2 debe confirmar sobre el código
real, no huecos de la spec.

---

## H1 — Actor propagation (Opción A / header `X-Rafaq-Actor`): **CERRADO**

Escrutinio a fondo del mecanismo divergente (header en vez del `set_config` que sugería el reporte):

### ¿Realmente spoof-safe? — **SÍ, confirmado.**

`audit.resolve_actor()` (design.md L161-181) solo confía en el header cuando
`current_setting('request.jwt.claims') ->> 'role' = 'service_role'` (L168-169); si no, cae a `auth.uid()`
(L180). Verificado que esto es sólido:

- Un cliente `authenticated` **no puede** hacer que `request.jwt.claims ->> 'role'` valga `service_role`:
  esa claim viene del **JWT firmado** con el secreto del proyecto; el anon/authenticated key es otro JWT
  firmado con `role: authenticated`. Sin el secreto no puede forjar `role: service_role`. → un
  `X-Rafaq-Actor` forjado por un `authenticated` es **ignorado** (R2.8), su write se atribuye a su
  `auth.uid()` real. Cubierto por **TA.13** (spoof-safety, camino real).
- **Punto clave de correctitud** (bien resuelto por el diseño): el chequeo usa el **GUC de sesión**
  `request.jwt.claims`, no `current_user`/`session_user`. Dentro de un `SECURITY DEFINER`, `current_user`
  es el **definer** (owner), no el rol del caller → un chequeo por `current_user` estaría **roto**. El GUC
  de sesión no lo altera el definer (R2.3). El diseño eligió la señal correcta. Mismo patrón que usa la
  propia `auth.uid()`/`auth.jwt()` de Supabase (`current_setting('request.jwt.claims', true)::jsonb`).
- Conexiones directas (SQL editor, Management API, cron): sin `request.jwt.claims` → `v_role` NULL → header
  ignorado → `auth.uid()` NULL → actor NULL honesto (R2.2). Correcto.

**Aprobado el header explícitamente** (la pregunta del coordinador): es seguro. El guard de rol
`service_role` es el control anti-spoof y es efectivo. No veo hueco.

### ¿Misma transacción que el DML para las 4 EFs (incl. `delete_account` vía RPC)? — **SÍ, confirmado.**

PostgREST setea `request.headers` como GUC **transaction-local** al inicio de la transacción de **cada
request**; el trigger dispara durante el DML de esa misma request → ve el header. Por eso el header funciona
donde `set_config(...,true)` desde una llamada supabase-js separada **no** (cada `.from()/.rpc()` es una
transacción distinta bajo el pooler — Alternativa D, bien descartada). Verificado contra el repo:

- `accept_invitation` (`.from('user_roles').insert`, L94-101), `change_member_role`
  (`.update` L100 + `.insert` L108 + `.update` L120), `remove_member` (`.update` L86): cada write es una
  request única del admin client con el header global → trigger en-transacción. ✓
- **`delete_account`**: el write de `user_roles` NO es directo — va dentro de `delete_account_tx`
  (`adminClient.rpc('delete_account_tx', { p_user_id: user.id })`, `delete_account/index.ts` L132-134), una
  RPC `SECURITY DEFINER`. Es **una sola** request `.rpc()` que lleva el header → el DML de `user_roles`
  adentro dispara el trigger en **la transacción de la RPC** → header visible. `delete_account_tx` **no**
  necesita tocarse. Confirmada la afirmación de `design.md` L358. ✓
  - Nota inocua verificada: con `createAdminClient(user.id)`, el header viaja también en los ~5 SELECT
    admin previos de `delete_account` (idempotencia/pre-check) — no disparan trigger (es AFTER I/U/D, no
    SELECT) → sin filas de audit espurias (design L362-364, correcto). El soft-delete de `users` dentro de
    `delete_account_tx` tampoco audita (`users` no está trackeada en el incremento 1).

### ¿Header vs RPC-wrapper (Alt D)? — **Header aprobado.**

El header logra actor-real + misma-transacción + spoof-safe con 1 línea por EF y sin refactor de la lógica
de escritura de TS a SQL (menor blast radius sobre EFs `done`, menos superficie de Gate 2). El RPC-wrapper
queda documentado como fallback (design L444-454). Coincido: el header es la opción correcta y es segura.

### Scope corregido (4 EFs, no `invite_user`) — **CORRECTO y COMPLETO. Verificado contra el repo.**

Grep de writes (`insert/update/delete/upsert`) sobre `user_roles` en `supabase/functions/*`:
- Escriben `user_roles`: `change_member_role`, `remove_member`, `accept_invitation` (directo) +
  `delete_account` (vía `delete_account_tx`). = **4**. Coincide con R2.9. ✓
- `invite_user` referencia `user_roles` en L92-98 pero es `.select('id')` (**read-only**, chequeo de
  duplicado) → escribe `invitations` (no trackeada). Correctamente **excluido**. ✓
- `cancel_invitation`, `register_push_token`, `resend_invitation`: **cero** referencias de escritura a
  `user_roles`. → no hay una 5ª EF olvidada. El scope es completo, no solo correcto. ✓

---

## M1 — Smoke-check del muro de LECTURA: **CERRADO**

El `DO` block ahora tiene **doble** tripwire (design.md L266-291, R3.7):
- (a) EXECUTE de funciones sensibles (incl. la nueva `resolve_actor`) revocado a `anon/authenticated/public`.
- (b) **Muro de lectura**: aborta si `has_schema_privilege('anon'|'authenticated','audit','USAGE')` o
  `has_table_privilege('anon'|'authenticated','audit.record_version','SELECT')`. Los dos chequeos son
  independientes del schema-USAGE (son catálogo) → cierran USAGE **y** SELECT por separado. Paridad de
  tripwire in-migration con R3.6, exactamente lo que pedía M1. La nota sobre PostgREST (L251-254) deja claro
  que el backstop durable es el REVOKE de USAGE (aunque alguien exponga `audit` en el dashboard → 42501), y
  que PGRST106 es un check puntual. Cerrado.

---

## M2 — Modo de falla del hot path: **abordado, con UNA watch-item (M2-a)**

El ruteo por `tg_argv[0]` funciona: `enable_tracking('public.animals', best_effort => true)` crea el
trigger con arg `'best_effort'` → el insert va envuelto en `begin … exception when others then null; end`
(design L192-204) → una falla del insert de audit **no** propaga → el write del operario procede. Para
`user_roles` (default `strict`) los errores propagan (sin huecos). El gate de volumen (R5.4/T10, con la
línea de `animals` **contingente**, design L296-299) es duro. En lo estructural, además, `record_version`
sin FK/CHECK (R1.10) evita el punto de falla más obvio (un `auth_uid` de usuario borrado no rompe nada).

### M2-a (MEDIUM, no explotable, fix trivial) — el best-effort NO es airtight: `resolve_actor()` corre FUERA del bloque `exception`.

**Evidencia**: en `insert_update_delete_trigger()` (design.md L187-190), la resolución del actor se hace en
la **sección DECLARE**:
```
declare
  pkey_cols     text[] := audit.primary_key_columns(tg_relid);
  v_actor       uuid   := audit.resolve_actor();     -- ← fuera del try/catch
  v_best_effort boolean := (tg_nargs > 0 and tg_argv[0] = 'best_effort');
begin
  if v_best_effort then
    begin
      insert ... ;
    exception when others then null;   -- solo cubre el INSERT
```
La cláusula `exception when others then null` solo envuelve el **INSERT**. `resolve_actor()` (y
`primary_key_columns()`) se evalúan **antes**, fuera del guard. Si `resolve_actor()` lanzara, el write de
`animals` **abortaría igual, aun en best-effort** → se rompe el invariante "la manga nunca se traba" que el
propio diseño promete (design L76-79, R1.11).

`resolve_actor()` tiene un `begin…exception` interno **solo** para el parse del header (L171-178), **no**
para el parse de la claim de rol en L168: `nullif(current_setting('request.jwt.claims', true), '')::jsonb
->> 'role'`. Si `request.jwt.claims` fuera un string no-JSON, el `::jsonb` lanzaría y `resolve_actor()`
propagaría.

**Por qué es MEDIUM y NO HIGH (no explotable hoy)**: `request.jwt.claims` lo setea PostgREST desde el JWT
verificado y es **siempre JSON válido** (es el mismo cast que usa `auth.uid()`/`auth.jwt()` de Supabase; si
pudiera romperse, se rompería el auth de todo Supabase). Un cliente no puede inyectar texto arbitrario ahí.
→ el throw es en la práctica inalcanzable. Es un gap de robustez del invariante best-effort, no un hueco
explotable.

**Fix recomendado (Gate 2 debe verificarlo en el código)**: hacer `resolve_actor()` **total** — envolver
todo su cuerpo en `begin … exception when others then return auth.uid(); end` (o `return null`), de modo que
NUNCA pueda lanzar; y/o mover `v_actor := resolve_actor()` **dentro** del bloque best-effort. Con eso el
"nunca se traba" queda airtight. Cheap; se resuelve en el `.sql`. Reconciliar en `design.md` bajo R1.11.

---

## M3 / L1 / L2: **CERRADOS**

- **M3** (PII): R5.7 + design § "PII en el audit" documentan que `user_roles.member_name` (nombre, no la
  PII fuerte email/phone que queda en `user_private` no-trackeado) entra a `audit.record`; **no es fuga**
  (audit cerrado a todo cliente, foco #5 limpio); la retención 90d es la mitigación del derecho de supresión
  (Ley 25.326). Postura escrita y aceptada. Cerrado.
- **L1** (TRUNCATE): design L324-327 — trigger row-level no captura TRUNCATE; no explotable (clientes no
  tienen privilegio de TRUNCATE sobre `user_roles`/`animals`). Nota de completitud. OK.
- **L2** (sin `notify pgrst`): design L328-329 — correcto, `audit` no se expone por PostgREST, no hay
  schema-cache que refrescar. No-issue. OK.

---

## Watch-items para Gate 2 (código) — NO bloquean Puerta 1

1. **M2-a (MEDIUM)**: verificar que `resolve_actor()` es total (no puede lanzar) y/o que la resolución de
   actor/pk corre dentro del guard best-effort, para que el hot path de `animals` sea realmente
   imposible de wedgear. (Ver arriba.)
2. **TA.13 — tabla del test de spoof (menor)**: el design describe el spoof-test como un write de
   `authenticated` **a `animals`**. Pero `animals` no es escribible directo por `authenticated` (se escribe
   por RPCs `SECURITY DEFINER`; no está en el sync). La propiedad de spoof-safety vale igual, pero el test
   debe ejercitar una tabla trackeada que el `authenticated` SÍ pueda escribir directo — p. ej.
   `user_roles` vía la policy `user_roles_update_owner` (0008) con `X-Rafaq-Actor` forjado → assert
   `auth_uid = su uid real`. Ajuste de construcción del test, no cambia el requirement.
3. **Perf del best-effort en bulk (menor)**: el `begin…exception…end` por fila crea **una subtransacción
   por row**. `import_rodeo_bulk` inserta miles de `animals` en una transacción → miles de subtransacciones
   → conocido cliff de performance de Postgres (SLRU de subxids > 64/txn). El gate de volumen T10/R5.4
   debería medir **latencia del import** con el trigger activo, no solo el storage. Consideración de
   disponibilidad/costo, no de seguridad; folded en la medición que R5.4 ya exige.

---

## Tabla de inputs (campos que el usuario tipea)

| campo | límite | validación | OK? |
|---|---|---|---|
| — | — | — | — |

**N/A** — feature backend-only, sin UI ni input de usuario directo (R8.2). El único "input" nuevo es el
header `X-Rafaq-Actor`, que **no** lo tipea el usuario: lo setea la EF desde `user.id` del **JWT validado**
(`requireUser`), nunca del body (R2.7), y el trigger lo ignora salvo en contexto `service_role` (R2.8). No
es superficie de input de usuario. El `regclass` de `enable/disable_tracking` tiene EXECUTE revocado a
clientes y solo se invoca con literales en la migración.

## Tabla de rate limits (acciones abusables tocadas)

| acción | rate limit | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| write a tabla trackeada → fila de audit | no (por diseño) | n/a | n/a | 1 fila/write. Control de volumen = retención 90d + alcance incremental **medido** (T10 gate duro). `record_version` es cross-tenant compartida (cap 500 MB) → M2/R5.4 lo acotan; el best-effort de `animals` evita que el spam de un tenant traba writes de otros (una vez cerrado M2-a). |
| header `X-Rafaq-Actor` en EF | n/a | per-JWT (server) | sí | actor del JWT validado, no del body; ignorado si el rol ≠ service_role. No abusable por cliente. |
| `enable/disable_tracking`, `purge_old_record_versions`, `resolve_actor` | n/a | n/a | sí | EXECUTE revocado a `public/anon/authenticated` + smoke-check aborta si quedó colgado (R3.6). |

Las 4 EFs tocadas **no** cambian su superficie de rate-limit (R8.3, mismo contrato HTTP); el único cambio es
propagar el actor. No se crean endpoints nuevos ni se afloja `[auth.rate_limit]`.

---

## Focos de Gate 1 (context.md §"Gate de seguridad") — resultado del re-run

| Foco | Resultado |
|---|---|
| #1 — `record_version` no legible por anon/authenticated + no expuesto por PostgREST (smoke-check, no asumido) | **OK** — REVOKE correcto (backstop durable) + **abort in-migration del muro de lectura** (R3.7, M1 cerrado) + tests TA.7-TA.9. |
| #2 — `SECURITY DEFINER` no abre escalación (search_path fijo, no RPC arbitraria, EXECUTE revocado) | **OK** — `set search_path=''` + nombres calificados; funciones sensibles (incl. `resolve_actor`) con EXECUTE revocado + smoke-check; `format('%s', regclass)` no inyectable. |
| #3 — `auth.uid()`/actor del JWT real, no spoofeable; NULL no rompe DML ni falsea autor | **OK** — actor = `auth.uid()` o header confiado **solo** en contexto `service_role` (anti-spoof por GUC de sesión, correcto bajo SECURITY DEFINER); NULL honesto (R2.2). H1 cerrado. |
| #4 — frontera WAL PowerSync (`FOR TABLE`, no `ALL TABLES`) | **OK** — R4.1 pre-req STOP + R4.2 no agrega a publication + R4.3/TA.11. |
| #5 — captura JSONB no crea camino de lectura indirecto de `user_private`/PII | **OK** — `user_private` no trackeado (R5.5); audit cerrado a todo cliente ⇒ sin lectura indirecta; residual de nombre en M3 (no disclosure). |
| #6 — retención no borra de más; no interfiere con RLS/triggers as-built | **OK** — purga acota `ts<now()-90d` sobre `record_version` solo; idempotente; único acoplamiento (errores del trigger) resuelto por best-effort (pend. M2-a para ser airtight). |

## Dominios excluidos (con justificación)

- Validación de inputs de usuario / buscadores / prompts — N/A (backend-only, sin UI; el header no es input
  de usuario).
- Rate limiting de Auth nativo / EF nuevas / bulk-import — no aplica (no crea EFs ni afloja config); vector
  de amplificación de recurso compartido documentado en M2/tabla de rate limits.
- BLE (G), SSRF/ingesta/CSV (F), mass assignment/IDOR (A2/A3), XSS email (F4), mobile hardening (I3) — no
  aplican al diff (sin BLE, sin `fetch` externo, sin parseo de archivos, sin spread de body en inserts —
  el trigger inserta `to_jsonb(new/old)` de filas ya validadas por sus vías; las 4 EFs no cambian su
  lógica de escritura, R8.3).

---

## Resumen para el leader

- **PASS.** H1 (Opción A / header `X-Rafaq-Actor`) es un mecanismo **correcto, spoof-safe y de
  misma-transacción** — aprobado explícitamente, incluido `delete_account` vía `delete_account_tx`. Scope de
  **4 EFs verificado correcto y completo** contra el repo (`invite_user` correctamente excluido: read-only
  sobre `user_roles`). M1 (muro de lectura) y M3/L1/L2 cerrados.
- **Apto para Puerta 1.**
- **Gate 2 (código) debe verificar** la watch-item **M2-a** (hacer `resolve_actor()` total / mover la
  resolución de actor dentro del guard best-effort, para que el hot path de `animals` sea imposible de
  wedgear — no explotable hoy, fix de pocas líneas en el `.sql`), + los dos ajustes menores (tabla del test
  TA.13; medir latencia de import en T10). Ninguno bloquea la aprobación de la spec.
