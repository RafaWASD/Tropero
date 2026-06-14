# Security — Gate 2 (code) — Spec 10 delta VÍA-INTRANASAL

**Modo**: `code` (ADR-019). **Veredicto**: **PASS**.
**Baseline**: `6308ff5` (registrado en `progress/impl_10-via-intranasal.md`).
**Una línea**: el delta agrega un valor a un enum y curan 3 opciones de un selector; el campo `route` sigue normalizado por la barrera dura `toRouteValue` (código del enum o `null`, nunca texto libre), el INSERT está parametrizado, y la migración NO toca RLS/grants/policies. Cero findings HIGH.

---

## Alcance auditado (SOLO el delta de spec 10)

El working tree tiene cambios de terminales paralelas (spec 03, 08, PowerSync, etc.) **ajenos a este delta** — NO los audité. Foco exclusivo en los 6 archivos del delta, diffeados contra el baseline `6308ff5`:

- `supabase/migrations/0090_sanitary_route_intranasal.sql` (NUEVO, untracked)
- `app/src/utils/sanitary-route.ts`
- `app/src/utils/sanitary-route.test.ts`
- `app/app/vacunacion-masiva.tsx` (solo el selector de vía)
- `app/src/utils/event-timeline.ts` (label de display)
- `app/e2e/captures/spec10-uib2-screenshots.capture.ts`

---

## Findings HIGH

**Ninguno.**

## Findings RAFAQ-SPECIFIC

**Ninguno.**

## False positives descartados

La skill `sentry-skills:security-review` no levantó findings HIGH sobre el delta. Patrones que candidatean a flag pero NO aplican, con su trazabilidad:

- **Input de usuario → columna con constraint (route)**: el `route` es input del operario. Verificado que tiene **límite claro (enum cerrado) + validación autoritativa server-side (el tipo Postgres `public.sanitary_route` rechaza fuera-de-enum con `22P02`)**, y además el cliente lo normaliza con `toRouteValue` antes de encolar. NO es vulnerabilidad.
- **Concatenación de `route` en SQL → SQL injection**: descartado. El INSERT (`buildAddVaccinationInsert`, `local-reads.ts:1335-1341`) usa placeholders `?` con `args:[…, route, …]` — `route` viaja como **bind arg parametrizado**, nunca interpolado. Aunque un string crudo llegara (no puede, por `toRouteValue`), no habría inyección; sería un `22P02` benigno en el sync.
- **`ADD VALUE` de enum → cambio de privilegios/RLS**: descartado (ver análisis abajo).

---

## Análisis por foco del encargo

### 1. Migración de enum (`0090`) — ¿toca privilegios/RLS/grants?
**NO.** La migración es exactamente:
```sql
alter type public.sanitary_route add value if not exists 'intranasal';
notify pgrst, 'reload schema';
```
- Es **solo un valor de enum**. No crea/altera tablas, policies, grants ni funciones.
- **No reabre RLS**: las 3 policies de `sanitary_events` (`0027_sanitary_events.sql:36-44`) autorizan EXCLUSIVAMENTE sobre `establishment_of_profile(animal_profile_id)` + `has_role_in`/`is_owner_of`/`created_by = auth.uid()` + `deleted_at is null`. **Ninguna** referencia la columna `route` (verificado: ningún policy USING/WITH CHECK, ningún CHECK constraint, ningún índice en migrations referencia `route`). Agregar un valor al enum no puede alterar la autorización.
- El grant del tipo ya existe y cubre el valor nuevo automáticamente: `grant usage on type public.sanitary_route to anon, authenticated, service_role` (`0038_check_grants.sql:58`). Los valores nuevos heredan el grant del tipo — no hace falta re-grant.
- Idempotente (`if not exists`). PG15 permite `ADD VALUE` sin usar el valor en la misma transacción (no se usa en el archivo). `notify pgrst` solo refresca el schema cache de PostgREST.
- ⚠️ No aplicada a remoto todavía (el deploy lo autoriza Raf aparte) — no es un hueco de seguridad, es proceso de despliegue.

### 2. Validación de input de usuario (regla dura del rol)
**Cumple.** Data flow trazado de punta a punta:
1. UI (`vacunacion-masiva.tsx:88`): estado `route` tipado `SanitaryRoute | null`. El `useState` arranca en `null`.
2. Selector (`:201-203`, `:344`): `toggleRoute(code: SanitaryRoute)` solo puede emitir un código del enum (los 3 chips de `vaccineRouteOptions()`), nunca texto libre. El tipo del callback impide cualquier otra cosa.
3. Barrera dura (`:228`): al encolar se pasa `route: toRouteValue(route)` → `toRouteValue` (`sanitary-route.ts:84-86`) devuelve **un código del enum o `null`** (vía `isValidRoute`), nunca el string crudo. Es la única fuente de verdad y opera sobre el enum completo (6 valores), independiente del subconjunto curado del selector.
4. INSERT (`local-reads.ts:1335-1341`): `route` como bind arg `?` (parametrizado).
5. Server-side autoritativo: la columna es el enum `public.sanitary_route` → Postgres rechaza fuera-de-enum con `22P02`. El cliente (attacker-controlled) NO es el control; la DB lo es. El fix **VIA-ENUM-MISMATCH** está intacto — el delta NO lo reabre (solo cambia qué OFRECE el selector, no la barrera).

No queda **ningún path** donde texto libre del usuario llegue crudo a una columna constrained.

### 3. `product_name`
**Intacto.** El delta NO lo toca. Sigue con su cap (`PRODUCT_NAME_MAX = 80`, `vacunacion-masiva.tsx:62`, aplicado vía `maxLength={PRODUCT_NAME_MAX}` en `:330`) + validación de no-vacío (`productError`, `:207`) y `.trim()` antes de encolar (`:228`). Es `text` en DB (sin enum), por eso el cap del cliente es defensa-en-profundidad; la autoridad de tamaño no es crítica para seguridad (no rompe el INSERT) y no cambió.

### 4. Inyección / fuga / authz introducida por el delta
**Ninguna.** La authz del INSERT a `sanitary_events` es RLS server-side y no cambió. No hay nuevas queries, fetch externos, secretos, logs de PII, ni `.insert(body)`/`.update(body)` con spread del input. `event-timeline.ts` solo agrega una entrada de label es-AR (`intranasal: 'Intranasal'`) a un mapa de display — no es input ni sale a ningún sink peligroso.

---

## Tabla de inputs

| campo | límite | validación | OK? |
|---|---|---|---|
| `route` (selector de vía) | enum cerrado `public.sanitary_route` (selector ofrece 3 curadas: SC/IM/Intranasal) | **server-side autoritativa** (tipo enum Postgres → `22P02` fuera-de-enum) + cliente normaliza con `toRouteValue` (código del enum o `null`) + INSERT parametrizado | ✅ |
| `product_name` (no tocado por el delta) | `PRODUCT_NAME_MAX=80` (cap cliente, columna `text` en DB) | cliente: `maxLength` + no-vacío + `.trim()`; DB: `text` sin cap (defensa-en-profundidad) | ✅ (sin cambios) |

## Tabla de rate limits

| acción | rate limit | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| INSERT masivo `sanitary_events` (vacunación) | n.a. para este delta | per-establishment vía RLS + gating capa 2 (`tg_sanitary_events_gating`, fail-closed) | n.a. | El delta NO toca el fan-out ni la cardinalidad del bulk (sigue 1 INSERT/animal sobre `preview.toApply`). El rate/cap del bulk es preexistente de spec 10, fuera del alcance de este delta. No se afloja nada. |
| Migración / `config.toml` | n.a. | — | — | El delta NO toca `supabase/config.toml` ni `[auth.rate_limit]`. |

---

## Archivos analizados

- `supabase/migrations/0090_sanitary_route_intranasal.sql`
- `app/src/utils/sanitary-route.ts`
- `app/src/utils/sanitary-route.test.ts`
- `app/app/vacunacion-masiva.tsx` (selector de vía + path de `onConfirm`/INSERT)
- `app/src/utils/event-timeline.ts`
- `app/e2e/captures/spec10-uib2-screenshots.capture.ts`
- (contexto, no del delta, para trazar el flow) `supabase/migrations/0027_sanitary_events.sql`, `0038_check_grants.sql`, `app/src/services/bulk-operations.ts`, `app/src/services/powersync/local-reads.ts:1328-1342`.

## Cobertura indirecta de Deno / RLS / PowerSync

- **RLS**: cubierta por revisión manual (la skill de Sentry no razona sobre policies Postgres). Confirmado que `route` no participa de ninguna policy → el `ADD VALUE` no afecta autorización. No hay migración de policy nueva en el delta, así que no aplica test de aislamiento cross-tenant adicional.
- **Deno / Edge Functions**: el delta NO toca Edge Functions. N.a.
- **PowerSync**: el INSERT local lo construye `buildAddVaccinationInsert` (parametrizado). El delta no cambia sync rules ni la forma del INSERT — solo qué valor de `route` puede seleccionar el usuario. N.a. para sync-rule review.
- **BLE / RN nativo**: n.a.

---

## Veredicto final

**PASS** — el delta no introduce ningún hueco HIGH-confidence. La migración de enum es inocua respecto a RLS/grants, el input `route` mantiene su barrera autoritativa server-side + normalización cliente, el INSERT está parametrizado, y `product_name` sigue acotado. Único pendiente NO-de-seguridad: aplicar `0090` al remoto (proceso de deploy, decisión de Raf).
