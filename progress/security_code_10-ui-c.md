# Security gate (modo code) — spec 10 chunk UI-C: ficha (castrado/futuro-torito + borrado de eventos)

**Veredicto: PASS**

- Baseline: `55e25b56c97492df7b486a0363619584675ebc98` (de `progress/impl_10-ui-c-ficha.md`). Cambios sin commitear en working tree.
- Skill `sentry-skills:security-review` corrida sobre el diff (metodología: trace data flow + exploitability antes de reportar). **0 findings HIGH-confidence.**
- Fecha: 2026-06-12. Analyzer: security_analyzer (Gate 2).

## Findings HIGH de Sentry

Ninguno. No se identificaron vulnerabilidades HIGH-confidence en el diff.

## Findings RAFAQ-SPECIFIC

Ninguno HIGH ni MEDIUM.

## Foco 1 (CLAVE) — Borrado de eventos: confirmación explícita punto por punto

1. **Soft-delete, no hard-delete** ✅ — `buildSoftDeleteEventUpdate` (local-reads.ts:963-968) emite `UPDATE ${table} SET deleted_at = datetime('now') WHERE id = ? AND deleted_at IS NULL`. Es UPDATE de `deleted_at`, idempotente (guard `deleted_at IS NULL`). El timeline filtra `deleted_at IS NULL` → la fila desaparece de la vista, no de la DB.

2. **Whitelist de tabla CERRADO** ✅ — el nombre de tabla interpolado en el template literal NO viene de input del usuario:
   - `DELETABLE_EVENT_TABLE` (local-reads.ts:946-949) es un const map de exactamente 2 entradas (`sanitary` → `sanitary_events`, `reproductive` → `reproductive_events`).
   - El parámetro `table` de `buildSoftDeleteEventUpdate` es del tipo union literal `DeletableEventTable = 'sanitary_events' | 'reproductive_events'`.
   - `deleteTypedEvent` (events.ts:633-643) resuelve la tabla SOLO vía `DELETABLE_EVENT_TABLE[input.kind]` y rebota con error si no mapea. El `kind` viene de `TimelineItem.kind`, que a su vez es un literal del SQL del timeline (`SELECT 'sanitary', ...` / `SELECT 'reproductive', ...`), no texto del usuario.
   - Patrón "allow-list para nombres de tabla" = el patrón correcto OWASP para elementos no parametrizables. **Sin SQL injection por nombre de tabla.**

3. **`id` del evento parametrizado** ✅ — `args: [eventId]` con placeholder `?`. El `eventId` es `TimelineItem.eventId` (uuid leído de la SQLite local), nunca interpolado.

4. **Autorización SERVER-SIDE real (no el gating de UI)** ✅ — trazado completo del path de escritura:
   - El UPDATE local genera una CrudEntry PATCH que `connector.ts:82-85` sube vía `supabase.from(op.table).update(op.opData).eq('id', op.id)` **con el cliente de sesión del usuario (anon key + JWT)** → la RLS aplica server-side. NO hay service-role en este path.
   - RLS UPDATE verificada en migrations: `0026_reproductive_events.sql:67-69` y `0027_sanitary_events.sql:40-42` → `is_owner_of(establishment_of_profile(animal_profile_id)) OR created_by = auth.uid()` (owner|autor, spec 02 R6.8.1). Sin `WITH CHECK` explícito → Postgres reusa el USING para la fila nueva (suficiente: el PATCH solo manda `deleted_at`).
   - **Usuario sin rol (no owner/no autor)**: el botón no se muestra (`canDeleteEvent`, [id].tsx — best-effort de display), y si fabrica el write local igual, el server rechaza con 42501 → `isPermanentServerCode` (upload-classify.ts:76) lo clasifica permanente → la op se DESCARTA (fail-closed; el dato server-side queda intacto y el próximo checkpoint de PowerSync restaura la fila local). El borrado no autorizado **nunca persiste server-side**.
   - El PATCH sube solo las columnas cambiadas (`op.opData` = `{deleted_at}`) → sin mass assignment en este flujo.

5. **Recálculo de categoría** — server-side vía trigger `0046_category_recompute_on_event_change.sql` (AFTER UPDATE OF deleted_at en reproductive_events). El cliente solo refleja (espejo C6). No bypasseable desde el cliente.

## Foco 2 — `created_by` en el timeline

✅ Sin leak cross-tenant. `created_by` ya era columna sincronizada del schema local de PowerSync ANTES de este chunk (schema.ts: declarado en sanitary_events, reproductive_events y demás tablas de evento — el diff NO agrega columnas al sync). El cambio solo lo proyecta en el `json_object` del timeline (local-reads.ts:884-890). Las filas locales solo existen si la RLS SELECT (`has_role_in`) + sync las bajaron → el uuid del autor es data del propio tenant, ya expuesta en el mismo patrón por `AnimalDetail.createdBy` (canExit). El gating de display (`canDeleteEvent`/`isOwnerOfAnimal`) es UX; el control real es la RLS (correctamente documentado en el propio código).

## Foco 3 — Castrado / ⭐ futuro torito

✅ Reuso intacto de Fase 3: el diff de `animals.ts` solo AGREGA `previewCastrationCategory`; `setCastrated`/`setFutureBull` no se tocaron. Verificado en el código vigente:
- `setCastrated` (animals.ts:1123-1152): la observación va por `buildAddObservationInsert` que NO manda `author_id` (INSERT con columnas explícitas `id, animal_profile_id, establishment_id, event_type, text`; el trigger server-side lo fuerza). No se reintrodujo nada.
- `establishment_id` de la observación sale del PERFIL local, no del contexto activo, y el trigger 0034 lo re-valida server-side.
- `setFutureBull`: un solo UPDATE parametrizado de `future_bull`; el trigger normalize 0085 (server) fuerza false en no-macho/castrado → la regla de UI no es la defensa.

## Foco 4 — `resolveCastrationTargetCategory` / `previewCastrationCategory`

✅ Solo lectura. `resolveCastrationTargetCategory` (animal-category.ts) es función pura sin I/O. `previewCastrationCategory` (animals.ts) usa exclusivamente `runLocalQuerySingle`/`runLocalQuery` (SELECTs locales); cero escrituras. Display de anticipación, fail-safe a null.

## Foco 5 / Tabla de inputs

No hay inputs de texto libre nuevos. Superficie de entrada del chunk:

| campo/entrada | límite | validación | OK? |
|---|---|---|---|
| Toggle castrado (Confirmar) | booleano (flip del estado actual) | server: trigger recompute + RLS UPDATE animal_profiles | ✅ |
| Toggle ⭐ futuro torito | booleano | server: trigger 0085 normalize + RLS | ✅ |
| Tap "Sí, borrar" evento | sin payload del usuario (`kind` de literal SQL, `eventId` uuid local parametrizado) | server: RLS UPDATE owner\|autor (0026/0027) | ✅ |

Sin formularios, buscadores, campos libres ni prompts nuevos → el requisito "límite + validación por campo" se satisface por vacuidad.

## Tabla de rate limits

| acción | rate limit | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| Soft-delete evento / toggles (CRUD PowerSync) | n.a. | — | sí (RLS) | Sin Edge Functions, sin email/SMS, sin API externa, sin fan-out bulk (las masivas son el próximo chunk). Es CRUD per-row autenticado bajo RLS; mismo perfil de abuso que el resto del CRUD existente. No introduce vector de amplificación ni denial-of-wallet. |

## False positives descartados / observaciones de la skill

- **Template literal con nombre de tabla (`UPDATE ${table} ...`)**: matchea el patrón "VULNERABLE: Template literal" del checklist genérico, pero el valor es un union literal de 2 valores resuelto por allow-list cerrado, no input del usuario → exactamente el patrón "Allow-list Input Validation" que OWASP prescribe para nombres de tabla. Descartado tras trazar el data flow de `kind` (literal del SQL del timeline).
- **`r.error.message` mostrado en la UI** ([id].tsx handlers): son errores del SQLite LOCAL del propio usuario mostrados al propio usuario en su dispositivo — no es information disclosure (no hay `err.message` de servidor cruzando un trust boundary).

## Anexo LOW (backlog, no bloquea)

- **L1 — Lookup en objeto plano hereda `Object.prototype`** (`local-reads.ts:946`, `events.ts:633`): `DELETABLE_EVENT_TABLE[input.kind]` con un `kind` tipo `'constructor'`/`'toString'` devolvería una función truthy (prototype chain) → pasaría el guard `if (!table)` y generaría SQL basura local. NO explotable: (a) `kind` viene de literales del SQL del timeline, no de input arbitrario; (b) el peor caso es un syntax error en la SQLite del propio atacante (que ya puede correr SQL arbitrario en su dispositivo); (c) el server no se entera. Hardening sugerido: guard `Object.hasOwn(DELETABLE_EVENT_TABLE, input.kind)` o `Object.create(null)`. Anotar en `docs/backlog.md` si se quiere.
- **L2 — RLS UPDATE de eventos sin `WITH CHECK` restrictivo por columna** (pre-existente de spec 02, FUERA del diff): un autor podría en teoría updatear otras columnas de su propio evento (la policy no es column-level). Mitigado por triggers de tenant-check existentes y por diseño (el autor puede corregir su evento, R6.8.1). No introducido por este chunk; sin acción requerida acá.

## Archivos analizados

- `app/app/animal/[id].tsx` (diff completo, +544)
- `app/src/services/events.ts` (`deleteTypedEvent`)
- `app/src/services/powersync/local-reads.ts` (`buildSoftDeleteEventUpdate`, `DELETABLE_EVENT_TABLE`, `buildTimelineQuery`)
- `app/src/services/animals.ts` (`previewCastrationCategory` + verificación de `setCastrated`/`setFutureBull` reusados)
- `app/src/utils/animal-category.ts` (`resolveCastrationTargetCategory`)
- `app/src/utils/event-timeline.ts` (`createdBy`)
- Verificación cruzada (no parte del diff, leídos para validar la barrera server-side): `supabase/migrations/0026_reproductive_events.sql`, `0027_sanitary_events.sql`, `app/src/services/powersync/connector.ts`, `upload.ts`, `upload-classify.ts`, `schema.ts`.

## Cobertura indirecta

- **RLS/Postgres**: la skill de Sentry no ejecuta policies — las verifiqué manualmente contra las migrations (0026/0027/0046). Cubierto a mano.
- **PowerSync sync rules (server)**: fuera del repo/diff; este chunk no agrega columnas ni tablas al sync (`created_by` ya estaba en `schema.ts`), así que no cambia la superficie de replicación. Sin acción.
- **Nota funcional (no security)**: el comentario de `events.ts` dice que un rechazo 42501 hace "rollback del overlay" — en el path CRUD plano no hay overlay; la restauración local viene del próximo checkpoint de PowerSync tras descartar la op. La propiedad de seguridad (el borrado no autorizado nunca persiste server-side) se cumple igual; es solo precisión de comentario, el reviewer ya aprobó.
