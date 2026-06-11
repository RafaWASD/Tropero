# Security Gate 2 (modo `code`) — backlog: flake del estado reproductivo (deriveCurrentState)

- **Fecha**: 2026-06-11
- **Auditor**: security_analyzer (Gate 2)
- **Input**: diff del working tree sin commitear sobre `main` (`git status --porcelain` + `git diff`). Frontend puro: NO toca schema, RLS, Edge Functions ni migraciones.
- **Metodología**: skill `sentry-skills:security-review` (trace data flow + verify exploitability) + checklist RAFAQ.

## Veredicto: **PASS**

Cero findings HIGH. El foco prioritario del leader (created_at de cliente) se evaluó a fondo y resulta **LOW — data-quality/precisión de auditoría dentro del propio tenant, sin cruce de frontera de confianza ni escalación** (justificación completa abajo). Un hallazgo MEDIUM **preexistente y fuera del diff** (spoofing de `created_by`) va al backlog, no bloquea.

---

## Foco 1 — Corrimiento de autoridad de `created_at` (el análisis pedido)

### Hechos verificados server-side (no asumidos)

1. **No hay trigger de force sobre `created_at`.** `reproductive_events` tiene exactamente 2 triggers BEFORE INSERT:
   - `reproductive_events_set_created_by` → `tg_set_created_by_auth_uid()` (`0026_reproductive_events.sql:58-60`), que SOLO toca `created_by` y solo si vino NULL (`0024_event_created_by_helper.sql:8-10`).
   - `reproductive_events_force_establishment_id` → `tg_force_establishment_id_from_profile()` (`0077_denormalize_establishment_id_event_children.sql:112-115`), que SOLO toca `establishment_id`.
   La columna es `created_at timestamptz not null default now()` (`0026:50`) → **el valor de cliente persiste**, tal como el diff documenta.

2. **El INSERT del diff NO manda columnas forzadas.** `buildAddTactoInsert`/`buildAddServiceInsert`/`buildAddAbortionInsert` (local-reads.ts) mandan: `id, animal_profile_id, event_type` (literal cerrado en el SQL: `'tacto'`/`'service'`/`'abortion'`), `event_date, pregnancy_status|service_type, notes, created_at`. **NO mandan `created_by` ni `establishment_id`** — ambos siguen bajo trigger. `establishment_id` se fuerza INCONDICIONALMENTE desde el perfil (`0077:68`: "FUERZA desde el padre: ignora cualquier valor del payload (anti-spoof)", SECURITY DEFINER, `search_path = public`, raise si el perfil no existe). Sin mass assignment: el upsert del connector (`connector.ts:78`, `table.upsert({ ...op.opData, id: op.id })`) sube solo las columnas que el propio builder escribió localmente, y PostgREST re-valida con el JWT del usuario (RLS + triggers + CHECKs, `connector.ts:74`).

### ¿Escalación de privilegio / cross-tenant? **NO.**

- La policy INSERT (`0026:65-66`) es `has_role_in(establishment_of_profile(animal_profile_id))`: el cliente solo puede insertar eventos sobre animales de establecimientos donde YA tiene rol. Un `created_at` arbitrario viaja siempre pegado a un `animal_profile_id` propio.
- `compute_category` ordena `(event_date, created_at)` **scopeado por animal** (`0062_compute_category_rewrite.sql:81`: el join aborto-vs-tacto es sobre el mismo `animal_profile_id`). Un `created_at` manipulado solo reordena la precedencia tacto/aborto **del propio animal del propio establecimiento**. Ningún dato, categoría ni estado de OTRO tenant es alcanzable por esta vía.

### ¿Falsificación de historia/auditoría cruzando frontera de confianza? **NO — solo data-quality del propio tenant.**

- **La capacidad NO la introduce este diff.** Desde 0026 existe `grant insert on reproductive_events to authenticated` sin column-list y sin force de `created_at`: cualquier miembro con rol podía YA setear `created_at` arbitrario pegándole directo a PostgREST con curl. El diff solo hace que el cliente legítimo use esa capacidad con un valor honesto (`new Date().toISOString()`). La superficie server-side es idéntica antes y después.
- **El usuario ya controlaba el dato dominante.** `event_date` es input de usuario desde siempre, y la policy UPDATE (`0026:67-70`) le permite al creador editar sus eventos. `created_at` manipulado no otorga ningún poder que el usuario no tuviera sobre sus propios datos.
- **El trail tamper-evident relevante no se toca.** La auditoría con peso regulatorio (ADR-017) es `animal_category_history` (append-only, `changed_at` sellado server-side por los triggers de categoría) — este diff no la roza. `reproductive_events.created_at` pasa de "instante server-attested de inserción" a "instante de creación declarado por el dispositivo" para tacto/service/abortion; es una pérdida de precisión forense menor, deliberada y documentada (y semánticamente MEJOR para eventos cargados offline).
- **Clasificación: LOW** (anexo abajo). No bloquea. No se infla: no hay frontera cruzada, no hay escalación, no hay impacto en otro tenant ni en el trail regulatorio.

## Foco 2 — SQL nuevo (`buildTimelineQuery`: SELECT externo + ORDER BY)

**Sin inyección.** Verificado en el diff de `local-reads.ts`:
- El `union` es 100% literales estáticos concatenados en compile-time; el único dato dinámico entra por **placeholders `?`** (7 del UNION + 1 del overlay = 8, todos `args: [profileId × 8]` — parametrización intacta).
- El SELECT externo (`SELECT event_kind, event_id, event_date, created_at, payload FROM (${union}) ORDER BY event_date ASC, created_at IS NULL ASC, created_at ASC`) interpola **solo el string estático `union`**, jamás input.
- `seq` NO entra al SQL: es el índice de array que `fetchTimeline` asigna en JS post-query (`events.ts`, `tl.value.map((r, i) => ...)`). El ORDER BY es constante. Ningún vector.

## Foco 3 — Validación de inputs

El diff **no agrega ningún campo tipeado por el usuario**. `createdAt` lo genera el código (`nowIso()` en `events.ts`), no un form. Server-side, `created_at timestamptz NOT NULL` type-constraina (basura no-timestamp → error de PG, fail-closed). Los inputs preexistentes del flujo no cambian y conservan su control autoritativo: `notes` ≤ 4000 por CHECK (`0070:218-219`), `event_type`/`pregnancy_status`/`service_type` enums de PG cerrados (`0026:5-9`), `event_date` tipo `date`.

### Tabla de inputs

| Campo | Límite | Validación | OK? |
|---|---|---|---|
| `created_at` (nuevo en el INSERT — generado por código, NO tipeado) | formato timestamptz | server: tipo de columna `timestamptz NOT NULL` (PG rechaza no-parseable) | Sí |
| `notes` (sin cambios) | ≤ 4000 chars | server: CHECK `reproductive_events_notes_len_chk` (0070) | Sí |
| `event_date` (sin cambios) | formato date | server: tipo `date` | Sí |
| `pregnancy_status` / `service_type` (sin cambios) | set cerrado | server: enums PG (0026) | Sí |

### Tabla de rate limits

| Acción | Rate limit | Keyeo | Fail-closed? | Nota |
|---|---|---|---|---|
| INSERT reproductive_events vía PowerSync→PostgREST | n.a. (sin cambio) | — | — | El diff no toca ninguna acción abusable nueva (no hay email/SMS/API externa/bulk). Estado preexistente sin cambios. |

## Findings

### HIGH (de la skill, validados): **ninguno**
### RAFAQ-SPECIFIC HIGH: **ninguno**

### MEDIUM — al backlog (preexistente, FUERA del diff, no bloquea)

- **[MED-1] Spoofing de `created_by` en tablas de evento.** `tg_set_created_by_auth_uid()` (`0024_event_created_by_helper.sql:8-10`) solo rellena si `created_by` vino NULL → un cliente directo (curl a PostgREST) puede insertar un evento con `created_by` de OTRO usuario del mismo establishment: (a) misatribución de auditoría, (b) le otorga al suplantado derechos de UPDATE sobre la fila vía la policy `created_by = auth.uid()` (`0026:69`). Preexistente desde 0024/0026, aplica a las 5 tablas de evento, NO introducido ni tocado por este diff (los builders no mandan `created_by`). **Fix sugerido**: cambiar el trigger a force incondicional `new.created_by := auth.uid()` (patrón de 0077) — los inserts del cliente legítimo nunca lo mandan, así que es no-breaking. Anotar en `docs/backlog.md`.

### Anexo LOW

- **[LOW-1] `created_at` client-attested en reproductive_events (tacto/service/abortion).** El análisis del Foco 1 completo. Impacto: un miembro malicioso puede declarar un instante de creación falso para reordenar la precedencia tacto/aborto **de sus propios animales** (cosa que ya podía hacer editando `event_date` o pegándole directo a PostgREST desde 0026). Sin frontera cruzada. **Recomendación a futuro** (si reproductive_events llega a alimentar auditoría tamper-evident estilo ADR-017): agregar una columna sellada server-side (p. ej. `received_at timestamptz not null default now()` con force), NO re-forzar `created_at` — su semántica de "instante de creación en el dispositivo" ahora es load-bearing para el fix del flake.

## False positives descartados

- **"SQL injection" por concatenación de strings en `buildTimelineQuery`**: la concatenación es de literales estáticos; el dato va por placeholders. Descartado tras trace (skill: framework-parameterized).
- **"Mass assignment" por `upsert({ ...op.opData })` en `connector.ts:78`**: el spread es de la CRUD queue de PowerSync (columnas que el propio builder whitelisteó); server-side los triggers de force (`establishment_id`) y RLS re-validan. Preexistente y mitigado; no es finding del diff.
- **"Timestamp injection" en `created_at`**: el valor es generado por código, no tipeado; y la columna timestamptz rechaza no-timestamps. Descartado.

## Archivos analizados

- `app/src/services/events.ts` (diff)
- `app/src/services/powersync/local-reads.ts` (diff)
- `app/src/utils/event-timeline.ts` (diff)
- `app/src/services/powersync/local-reads.test.ts`, `app/src/utils/event-timeline.test.ts` (diff — escaneados por secretos/PII: limpios)
- `app/src/services/powersync/connector.ts` (lectura — path de subida)
- Verificación server-side: `supabase/migrations/0024`, `0026`, `0062`, `0069`, `0070`, `0077`

## Cobertura indirecta

- La skill de Sentry no cubre semántica de RLS de Postgres ni el modelo de sync de PowerSync → ambos se verificaron **manualmente** contra las migrations y el connector (arriba). SQLite local del cliente: el ORDER BY nuevo corre sobre datos ya replicados al propio dispositivo del usuario — sin frontera nueva.
- Tests del diff: no auditados funcionalmente (rol del reviewer), solo escaneados por secretos/credenciales.
