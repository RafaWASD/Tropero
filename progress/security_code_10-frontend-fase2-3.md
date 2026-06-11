# Security gate (modo `code`) — spec 10, frontend Fase 2 (utils) + Fase 3 (services/hooks)

- **Fecha**: 2026-06-11
- **Baseline**: `95e3177` (registrado en `progress/impl_10-frontend-fase2.md` y `impl_10-frontend-fase3.md`)
- **Alcance**: diff cliente-only (sin migraciones — backend Fase 1 gateado aparte)
- **Herramienta**: skill `sentry-skills:security-review` sobre el diff + checklist RAFAQ-específico

## Veredicto: PASS

Cero findings HIGH. Las 6 invariantes del foco prioritario verificadas con evidencia (abajo). Dos
observaciones MEDIUM van al backlog (no bloquean: ambas son decisiones de diseño ya gateadas en Gate 1
o territorio del reviewer, no huecos explotables).

---

## Confirmación EXPLÍCITA de la invariante clave (foco 1): `author_id` NUNCA en el payload

**CONFIRMADA.** El SQL generado por `buildAddObservationInsert` (`app/src/services/powersync/local-reads.ts:1100-1105`):

```sql
INSERT INTO animal_events (id, animal_profile_id, establishment_id, event_type, text)
VALUES (?, ?, ?, 'observacion', ?)
```

`author_id` NO figura en la lista de columnas ni en los args. Es el **único** builder de la observación
de castración, y lo usan los DOS call-sites:

- Ficha: `animals.ts:1067` → `buildAddObservationInsert(randomUuid(), profileId, establishmentId, castrationObservationText(value))`
- Masiva: `bulk-operations.ts:166-167` → mismo builder, inyectado a `planCastration` (`bulk-operations-plan.ts:191`)

→ el autor lo fuerza el trigger server-side (0034/0024) = usuario autenticado del JWT al subir. Sin
camino de spoofing de autoría (SEC-SPEC-03). Además verifiqué los otros builders nuevos:
`buildAddVaccinationInsert` (local-reads.ts:1124-1130) y `buildAddWeaningInsert` (local-reads.ts:1145-1151)
tampoco mandan `created_by`/`author_id`/`establishment_id`/`source` (columnas explícitas: id,
animal_profile_id, event_type, product_name/route/event_date | event_date/created_at). Hay test que pinea
la invariante (`local-reads.test.ts` "NUNCA manda author_id") + aserción `author_id IS NULL` contra SQLite
real en la masiva de N (`bulk-operations-plan.test.ts`).

## Verificación de los demás focos

**Foco 2 — `establishment_id` de la observación = el del PERFIL.** Confirmado. Ficha:
`setCastrated` lo resuelve con `buildProfileEstablishmentQuery(profileId)` (`SELECT establishment_id FROM
animal_profiles WHERE id = ? LIMIT 1`, local-reads.ts:376-381) y falla cerrado si el perfil no está local
("no castrar a ciegas", animals.ts). Masiva: `buildProfileEstablishmentsQuery` batched
(local-reads.ts:1249-1255); `planCastration` **OMITE** el perfil cuyo establishment no resuelve
(bulk-operations-plan.ts:186 — defensivo, fail-closed). NUNCA del contexto activo ni del input del caller.
La SQLite local solo contiene perfiles del propio tenant (streams self-only, ADR-026), y aunque un
atacante manipule su DB local, el trigger de validación de `animal_events.establishment_id` (0034, 23514)
+ la RLS de INSERT re-validan server-side al subir → no se puede plantar una observación en un
establishment ajeno.

**Foco 3 — castración = 2 CrudEntries independientes.** Confirmado: `planCastration` arma
`[buildSetCastratedUpdate, buildAddObservationInsert]` por animal; `setCastrated` hace 2 `runLocalWrite`
secuenciales. El estado intermedio posible (UPDATE encolado, observación no) es data del PROPIO tenant
sobre el propio animal — no filtra ni escala nada cross-tenant (cada CrudEntry se re-autoriza
individualmente por RLS al subir). El gap es de auditoría, no de autorización → MEDIUM al backlog (abajo).

**Foco 4 — sin nuevo op_type/connector/RPC.** Confirmado por diff vacío:
`git diff 95e3177 --stat -- connector.ts upload.ts local-query.ts` → sin cambios. La castración es un
UPDATE plano de `animal_profiles` (tabla sincronizada) → CrudEntry PATCH genérica → `animals_update`/
policies de `animal_profiles` (0071) re-validan server-side. La observación es PUT genérica sobre
`animal_events`. Cero superficie nueva de sync.

**Foco 5 — multi-tenant.** Confirmado. Los candidatos (`buildBulkCandidates`) son función PURA sobre los
perfiles que el caller lee de la lista local (scopeada por las streams self-only). Las queries nuevas de
lectura (`buildExisting*IdsQuery`, `buildProfileEstablishment*Query`) van contra la SQLite local
tenant-scoped, parameterizadas. Ningún camino del diff arma mutaciones sobre perfiles de otro tenant; y
si el cliente se manipula (es attacker-controlled por definición), la frontera real (RLS + triggers
0034/0084/0085/0086) re-valida cada fila al subir. El scoping no se afloja en ningún punto del diff.

**Foco 6 — inputs.** Confirmado, ver tabla. El copy de la observación es CONSTANTE
(`castration-copy.ts`: `'Castrado'` / `'Corrección: marcado como no castrado'` — exportadas como const,
test que las pinea). La selección son profileIds ya presentes en la lista local + booleanos. Los params
de vacunación (`productName`/`route`) tienen validación autoritativa server-side pre-existente:
`sanitary_events_product_name_len_chk` (`char_length <= 160`, migración 0070) y `route` es el enum
Postgres `sanitary_route` (0027) — un valor fuera del set revienta el INSERT al subir. Fechas
`'YYYY-MM-DD'` contra columnas `date` (Postgres rechaza malformadas).

## Findings HIGH de Sentry (skill `sentry-skills:security-review`)

**Ninguno.** La skill no identificó vulnerabilidades HIGH-confidence en el diff. Trazado realizado:

- **Inyección SQL**: todos los builders nuevos usan placeholders `?` + args (incl. las cláusulas `IN`
  generadas por conteo — valores SIEMPRE en args, nunca interpolados). Lo único interpolado es
  `value ? 1 : 0` (boolean→literal) en `buildSetFutureBullUpdate`. `event_type` hardcodeado en el SQL.
- **Mass assignment**: cero `.insert(body)`/spread — columnas enumeradas a mano en todos los builders
  (patrón whitelist correcto).
- **XSS/eval/deserialización**: n.a. en este diff (sin render de HTML, sin eval, sin parseo de datos
  externos).

## Findings RAFAQ-SPECIFIC

**Ninguno HIGH.** MEDIUM al backlog:

- **MED-1 (audit-trail, dominio I2)** — `animals.ts` `setCastrated` / `bulk-operations-plan.ts`
  `drainBulkPlan`: si el UPDATE de `is_castrated` se encola OK y la observación falla (write local
  revienta, o el sync la rechaza permanentemente mientras el UPDATE pasa), queda una castración SIN
  rastro atribuible en el timeline. Sin atomicidad cross-CrudEntry no hay forma client-side de
  garantizarlo; el design (R10.2, "independientes, sin transacción") lo acepta explícitamente y Gate 1
  lo pasó. No es hueco de autorización (solo data del propio tenant). Remediación posible a futuro:
  detector server-side de flips de `is_castrated` sin observación cercana (job de consistencia).
  → `docs/backlog.md`.
- **MED-2 (UX/reporte, territorio reviewer)** — `drainBulkPlan` (bulk-operations-plan.ts:269-278): si en
  castración la 2da statement falla, el animal se reporta `rejected` PERO su UPDATE ya quedó encolado
  (no hay rollback, R10.2) → el usuario ve "rechazado" un animal que sí se castró. Correctness de
  reporte, no seguridad. → nota al reviewer / backlog.

## False positives descartados (trazabilidad)

1. **SHA-1 a mano** (`bulk-idempotency.ts:149`): uso NO criptográfico — derivación de PK determinística
   UUIDv5, exactamente lo que exige RFC 4122 §4.3. Regla de la skill: weak-crypto solo se flagea en uso
   de seguridad (passwords/tokens). Validado contra vectores FIPS + RFC por el implementer. NO es finding.
2. **IDs de evento predecibles** (UUIDv5 de `(profileId, tipo, fecha)`): teóricamente un atacante podría
   pre-crear una fila con el id que colisionará con el evento de una víctima (DoS puntual del upsert).
   Requiere conocer el `animal_profile_id` ajeno (UUID v4 random, no enumerable cross-tenant — RLS) y aún
   así la RLS de INSERT/UPDATE bloquea referenciar/pisar filas ajenas. No explotable → LOW teórico,
   descartado.
3. **`err.message` propagado en `ServiceResult`** (`bulk-operations.ts`, `animals.ts`): son errores del
   SQLite LOCAL mostrados al mismo usuario en su propio dispositivo — no cruzan boundary de confianza
   (no es el patrón B1 de Edge Functions filtrando internals del server). NO es finding.
4. **`buildProfileEstablishmentQuery` sin filtro `deleted_at`**: documentado y deliberado (la observación
   de una corrección puede caer sobre un perfil archivado); la lectura es local-tenant-scoped y el write
   server-side igual valida. NO es finding.
5. **`toggleProfile` acepta profileIds arbitrarios** (bulk-selection.ts:114 — "defensivo"): la selección
   solo alimenta mutaciones cuya autorización real es la RLS al subir; un id inventado produce un UPDATE
   de 0 filas local y un rechazo server-side. NO es finding.

## Tabla de inputs (campos nuevos/modificados que el usuario controla)

| campo | límite (largo/charset/formato/rango) | validación | OK? |
|---|---|---|---|
| selección de perfiles (checkboxes) | ids de la lista local ya-autorizada (Set de UUIDs) | server: RLS re-valida cada CrudEntry al subir (animal_profiles policies / animal_events INSERT + trigger 0034) | ✅ |
| `value` castrar/revertir, `value` futuro torito | boolean → literal 0/1 | server: trigger normalize 0085 (future_bull=false si no-macho/castrado), write-through 0084, RLS | ✅ |
| `VaccinationParams.productName` | texto de pre-config (UI Fase 4) | server: CHECK `char_length<=160` (0070) — autoritativo | ✅ |
| `VaccinationParams.route` | set cerrado | server: enum Postgres `sanitary_route` (0027) — autoritativo | ✅ |
| `eventDate` / `createdAt` | `'YYYY-MM-DD'` / timestamp | server: tipos `date`/`timestamptz` rechazan malformados; gating trigger re-valida | ✅ |
| texto de la observación | **CONSTANTE** (`castration-copy.ts`) — no es input de usuario | n.a. (no attacker-shaped) + CHECK de largo en animal_events (0070) | ✅ |

Sin texto libre nuevo del usuario en este chunk. La UI que captura estos params es Fase 4 (re-verificar
la capa UX ahí, pero la autoritativa ya existe).

## Tabla de rate limits (acciones abusables tocadas por el diff)

| acción | rate limit | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| encolado local masivo (N CrudEntries) | n.a. | — | — | escritura LOCAL en el dispositivo del propio usuario; sin costo server hasta el sync |
| upload de las CrudEntries | n.a. (sin cambio) | per-user (JWT) | sí (RLS) | camino as-built de spec 15 (`uploadData`), NO tocado en este diff; cada fila re-autorizada por RLS. Sin Edge Function nueva, sin email/SMS/API externa → sin denial-of-wallet nuevo |
| fan-out N por operación | acotado de facto | per-establishment | — | N ≤ tamaño del grupo del PROPIO tenant (candidatos salen de la lista local scopeada); cada fila es un row-op individual bajo RLS — sin amplificación cross-tenant. Cap explícito de N no requerido en cliente (el abuso equivale a N edits individuales que el usuario ya puede hacer) |

## Archivos analizados

Fase 2: `app/src/utils/bulk-candidates.ts`, `bulk-selection.ts`, `bulk-idempotency.ts`,
`animal-category.ts` (+ sus tests, no flageables).
Fase 3: `app/src/services/bulk-operations.ts`, `app/src/utils/bulk-operations-plan.ts`,
`app/src/utils/castration-copy.ts`, `app/src/services/animals.ts` (diff),
`app/src/services/powersync/schema.ts` (diff), `app/src/services/powersync/local-reads.ts` (diff).
Verificados sin cambios (foco 4): `connector.ts`, `upload.ts`, `local-query.ts`.
Referencias server-side consultadas (no parte del diff): migraciones 0027, 0070 (caps de texto).

## Cobertura indirecta / no cubierta por la skill

- **RLS/triggers server-side (0084/0085/0086, 0034, 0071)**: NO son parte de este diff — gateados en la
  Fase 1 backend. Este gate VERIFICA que el cliente no los esquiva (no hay canal nuevo), no los re-audita.
- **PowerSync sync rules**: el diff agrega 2 columnas al schema LOCAL (`is_castrated`, `future_bull`);
  la stream `est_animal_profiles` hace `SELECT *` (as-built ADR-026) → bajan solas, mismo scoping
  self-only. Sin regla nueva. Las sync rules en sí siguen siendo dominio del gate de backend.
- **Dominios excluidos**: Edge Functions (no hay), secretos (no hay), BLE (no toca), auth/sesión (no
  toca), ingesta/SSRF (no hay fetch), CI/CD (no toca). Justificación: el diff es 100 % utils puros +
  services del camino CRUD local as-built.
