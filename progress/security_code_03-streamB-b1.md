# Security Code Review (Gate 2, ADR-019) — spec 03 Stream B / B1 (cableado del selector de meses de servicio)

**Veredicto: PASS**

Auditoría de seguridad del CABLEADO de B1 (Stream B): `ServiceMonthsSelector` enchufado al alta/edición de rodeo por el camino offline (outbox → RPC owner-only de Stream A). Frontend puro que consume RPCs/columna ya deployadas y gateadas en su propio Gate 1/2.

- **baseline_commit**: `1e92e9802c2d4a9b88317d62b1c2ee7e5b4e78d8` (design-spike de B1, registrado en `progress/impl_03-streamB-b1-wiring.md`).
- **Diff**: nada committeado desde el baseline; todos los cambios sin commitear (`git status --porcelain`). El chunk B1-wiring está presente en el working tree.
- **Nota de proceso**: no existe `progress/review_03-streamB-b1*.md` al momento de esta corrida (el reviewer aún no dejó su archivo). Procedí por dispatch explícito del leader (Gate 2 de seguridad). El leader debe confirmar que el reviewer aprobó antes de mostrar al humano.

---

## Hallazgos HIGH

**Ninguno.** Las 5 superficies de foco se trazaron y están sanas.

## Hallazgos RAFAQ-SPECIFIC

**Ninguno.**

## False positives descartados (Sentry skill)

La skill `sentry-skills:security-review` no se corrió como motor primario porque el diff NO contiene primitivas que la skill cubre con valor (sin endpoints HTTP nuevos, sin parsing de input no-confiable de red, sin auth/crypto/SQL crudo con string interpolation de input de usuario). El diff es: (a) builders SQL parametrizados puros, (b) un `enqueue*` de outbox gemelo de uno existente, (c) un op_type en `RPC_OP_TYPES`, (d) declaraciones de schema cliente de PowerSync (TS), (e) wiring de 2 pantallas RN. Hice en su lugar el trazado manual de data-flow + verificación de exploitability que exige la metodología (trace → verify → report), apoyado en el catálogo RAFAQ. No hubo findings de la skill que validar/descartar.

---

## Foco 1 — No hardcode de `establishment_id`

**OK.** El cliente nunca hardcodea `establishment_id`.

- **Alta** (`crear-rodeo.tsx` + `rodeos.ts:createRodeo`): el `establishmentId` viaja en `CreateRodeoInput.establishmentId` (del contexto activo, mismo camino que el alta pre-B1). B1 solo agregó `serviceMonths` al input/overlay/params. `createRodeo` lo pasa como `p_establishment_id` (existente) y arma `p_service_months` aparte (`rodeos.ts:267-285`).
- **Edición** (`editar-servicio.tsx` + `rodeos.ts:setRodeoServiceMonths`): el cliente manda **solo** `p_rodeo_id` + `p_service_months` (`rodeos.ts:328`). NO se envía establishment. La RPC `set_rodeo_service_months` (Stream A, SECURITY DEFINER) deriva el establishment del rodeo server-side (anti-IDOR, RPS.3.4). El screen lee el rodeo de `RodeoContext.available` (ya tenant-scopeado por la stream), nunca construye un establishment.

## Foco 2 — No bypass del owner-only (la escritura va SIEMPRE por la RPC)

**OK — confirmado por trazado completo del write path.** No existe un UPDATE plano de `rodeos.service_months` que saltee la RPC.

- El único mecanismo de escritura de `service_months` es: `op_intents` (insertOnly) → `connector.ts:applyIntentTransaction` → `supabase.rpc(plan.rpcName, plan.args)` (`connector.ts:145-146`), con `plan.rpcName ∈ { create_rodeo, set_rodeo_service_months }` (vía `mapIntentToRpc`, `upload.ts:96-149`).
- **`connector.ts` no contiene NINGUNA referencia a `service_months`** (grep vacío) → el camino CRUD-plano (PUT/PATCH sobre tablas sincronizadas, `connector.ts:77-108`) nunca lo toca.
- Las 2 tablas overlay que tocan `service_months` (`pending_rodeos`, `pending_rodeo_service_months`) son `localOnly: true` (`schema.ts:580-620`) → NO generan CrudEntry → nunca se convierten en un UPDATE plano subido.
- Los únicos `supabase.from('rodeos')` en código de app son **SELECTs** (`import-rodeo.ts:165` lee `system_id`; los `.from('rodeos')` de `e2e/helpers/admin.ts` son helpers de test con service-role, fuera de runtime de app). Ningún `.update()` sobre `rodeos` en producción.
- Defensa en profundidad presente aunque no se ejerce: si un cliente intentara el UPDATE plano, la RLS `rodeos_update` owner-only + el CHECK de Stream A lo rechazarían (42501). El camino real es la RPC, como pide el foco.

## Foco 3 — Parseo no-injectable (`parseServiceMonths`)

**OK.** `service-months.ts:99-128` (sin cambios en el wiring — viene del spike ya gateado; re-verificado por estar en los foci).

- Tolerante: `null`/`undefined`/`''`/`'   '`/JSON corrupto/no-array → `null`; `[]` → `[]`; elementos fuera de 1–12 o no-enteros se filtran (`coerceMonth`, líneas 67-80). NUNCA tira (try/catch sobre el único `JSON.parse`, línea 112-116).
- **Sin `eval`, sin interpolación a query, sin construcción dinámica de SQL.** La salida es siempre `number[] | null` con cada elemento entero en [1,12]. Un valor corrupto/malicioso en el TEXT que PowerSync materializa degrada a `null` ("sin configurar"), no rompe nada aguas abajo.
- El literal Postgres `{10,11,12}` se normaliza a JSON antes de parsear (líneas 109-111) — transformación acotada (`slice`), sin riesgo.

## Foco 4 — Multi-tenant en las lecturas (proyección + overlay)

**OK.** `local-reads.ts:buildRodeosQuery` (163-197).

- Ambas ramas del UNION filtran `establishment_id = ?` (param, no hardcode): rama synced `rd.establishment_id = ?` (línea 181), rama overlay-alta `pr.establishment_id = ?` (línea 189).
- La proyección de `service_months` en la rama synced es `COALESCE((SELECT prsm.service_months FROM pending_rodeo_service_months prsm WHERE prsm.rodeo_id = rd.id), rd.service_months)` (líneas 178-180). La subquery del overlay de edición joinea por `rodeo_id` contra filas `rd` que **ya están tenant-filtradas** por el WHERE exterior → no hay vector cross-tenant: el COALESCE solo se evalúa para rodeos del establishment del param. El overlay (`pending_rodeo_service_months`) es local-only y solo se escribe para rodeos que el owner edita desde `RodeoContext.available` (tenant-scopeado).
- `service_months` hereda la RLS/stream de `rodeos`: la columna baja por `est_rodeos` (SELECT *, sync rule CASO A) que ya scopea `establishment_id IN org_scope AND deleted_at IS NULL`. No se agregó superficie de sincronización nueva.
- `notHiddenByOverride` (líneas 483-490) interpola solo constantes controladas por código (`'rodeos'`, efectos literales) — no input de usuario. Patrón preexistente.

## Foco 5 — Outbox (no persiste datos de más; idempotente; overlay local-only)

**OK.** `outbox.ts:enqueueSetRodeoServiceMonths` (258-276) + builders en `local-reads.ts`.

- El intent `set_rodeo_service_months` se encola SIN `p_client_op_id` (su firma no lo tiene; dedup natural por el UPDATE idempotente, RPSC.3.5). Confirmado también en `mapIntentToRpc` (`upload.ts:145-148`: solo `register_birth`/`assign_tag_to_animal` reciben `p_client_op_id`).
- El overlay `pending_rodeo_service_months` persiste **solo** `client_op_id`, `rodeo_id`, `service_months` (`schema.ts:613-620`, `buildPendingRodeoServiceMonthsInsert`) — nada sensible de más (un id + un array de enteros 1–12). Todas las escrituras son parametrizadas (`?`), sin interpolación.
- DELETE-PRIOR antes del INSERT (`buildDeletePendingRodeoServiceMonths`) garantiza ≤1 fila por rodeo (invariante del COALESCE). Local-only → no genera CrudEntry.
- Registrado en `PENDING_OVERLAY_TABLES` (`local-reads.ts`, 8 tablas) → `clearOverlay`/`rollbackOverlay` (`outbox.ts:472-486`) lo limpian por `client_op_id` al ACK (éxito) o al rechazo permanente.
- **Stale-auth en replay (C4 del catálogo) cubierto**: la RPC se re-autoriza server-side al drenar (owner-only). Si el rol se revocó entre la edición offline y el sync → 42501 → `permanent_reject` → rollback del overlay (`connector.ts:169-174`). Si el rodeo desapareció → P0002 → `permanent_reject` (`upload.ts:203-205`), correcto (la edición es VOID, se revierte la vista optimista).

---

## Tabla de inputs (campos que el usuario tipea/elige)

| campo | límite | validación (server / solo-cliente / ausente) | OK? |
|---|---|---|---|
| Meses de servicio (selector, alta + edición) | enteros 1–12, período contiguo por construcción (no se puede armar disjunto desde la grilla) | **server-autoritativa**: la RPC `create_rodeo`/`set_rodeo_service_months` valida el `smallint[]` (Stream A, ya gateada) + columna tipada `smallint[]`. Cliente: `toServiceMonthsArray` (dedup/sort/range-filter) + `parseServiceMonths` (read) saneo defensivo | ✅ |
| Nombre del rodeo (paso 2, **preexistente, no tocado por B1**) | `NAME_MAX = 60` + `.trim()` no-vacío | server: la RPC `create_rodeo` recibe `p_name`; cliente acota a 60 | ✅ (fuera de scope B1) |

No hay buscadores, texto libre concatenado en `.or()/.filter()`, `ilike`, ni prompts LLM en este chunk. El único input es la selección de meses, acotada a 1–12 por construcción y por la columna `smallint[]` server-side.

## Tabla de rate limits (acciones abusables tocadas por el diff)

| acción | rate limit | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| `set_rodeo_service_months` (editar meses, vía outbox→RPC) | n.a. propio | per-user/per-establishment vía owner-only RLS+RPC | sí (RPC rechaza no-owner 42501) | Operación barata, idempotente, sin email/SMS/API externa/bulk/fan-out. UPDATE de una columna de un rodeo. No es vector de amplificación. No requiere cuota dedicada. |
| `create_rodeo` (alta con `p_service_months`, vía outbox→RPC) | n.a. propio | per-user/per-establishment vía owner-only RLS+RPC | sí | Preexistente; B1 solo agrega un param. Alta puntual de rodeo (operación de oficina, no bulk), sin recurso de costo por request. |

Ninguna acción de B1 manda email/SMS, pega a API externa, ni hace fan-out por request → no aplica rate limit dedicado. No se tocó `[auth.rate_limit]` en `config.toml`.

---

## Dominios del catálogo RAFAQ revisados

- **A1 (service-role bypassa RLS)**: N/A — el cliente no usa `createAdminClient()`; todo va por outbox→RPC SECURITY DEFINER con guard owner-only del lado Stream A (ya gateado).
- **A2 (mass assignment)**: OK — no hay `.insert(body)`/`.update(body)` con spread del input. `createRodeo` arma `params` campo por campo (`rodeos.ts:268-278`); `setRodeoServiceMonths` arma `{ p_rodeo_id, p_service_months }` explícito. `establishment_id`/`role`/`id` no vienen del input para service_months.
- **A3/A4 (IDOR por FK / function-level authz)**: OK — la edición manda solo `p_rodeo_id`; el establishment lo deriva la RPC (anti-IDOR). Owner-only enforced server-side (RPC) + UX gate (`isOwner` en `editar-servicio.tsx:47,120`).
- **B1 (information disclosure)**: OK — `surfaceUploadRejection` (`connector.ts:189-207`) loggea solo `table`/`op`/`code`, NUNCA `opData`. No se devuelve `err.message` crudo al cliente por este camino (el error se mapea a un disposition + copy genérico `SAVE_ERROR_COPY`).
- **C (offline/sync)**: OK — overlay local-only; stale-auth re-autorizado en replay (C4); proyección tenant-scopeada (C1). Data-at-rest (C3) es propiedad global de PowerSync, no introducida por B1.
- **F1 (PostgREST filter injection)**: OK — el array de meses no se concatena en filtros; viaja como arg parametrizado de la RPC. Builders SQL 100% parametrizados.

## Dominios excluidos (con justificación)

- **D (secretos/supply chain)**: sin cambios en imports, env, secrets, ni `.github/workflows`. El diff no toca el bundle ni dependencias.
- **E (abuso a escala / denial-of-wallet / enumeration)**: sin endpoints de costo por request, sin queries sin tope nuevas (la lista de rodeos ya tiene su scoping; B1 solo agrega una columna proyectada).
- **F2/F3/F4 (import/SSRF/XSS-email)**: sin import de archivos, sin `fetch()` a URL influenciada, sin templates de email.
- **G (BLE)**: B1 no toca el camino BLE.
- **H (auth/sesión) / I (compliance/mobile)**: sin cambios en login/sesión/credenciales/retención/borrado/hardening.

---

## Cobertura indirecta de Deno / RLS / PowerSync

- **RLS / RPC owner-only**: la barrera real de B1 (owner-only + anti-IDOR del establishment) vive en las RPC de **Stream A** (`create_rodeo`, `set_rodeo_service_months`), que **NO** son parte de este diff — ya pasaron su propio Gate 1/2 (frontend puro, según el dispatch). Esta revisión asume esa garantía y verifica que **el cliente las usa correctamente** (no inventa un camino que las saltee). Si esa premisa fuera falsa, re-evaluar.
- **Deno / Edge Functions**: N/A — B1 no toca Edge Functions.
- **PowerSync sync rules**: CASO A verificado por el implementer (`est_rodeos` = SELECT * → `service_months` fluye sin editar `rafaq.yaml`). No hay regla de sync nueva/laxa introducida por B1; la columna hereda el scoping existente de `rodeos`. Sin deploy de sync rules en este chunk.
