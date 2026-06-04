# Security review (Gate 2, modo code) — C3.2 frontend reproductivo (spec 02)

**Veredicto: PASS**

Skill usada: `sentry-skills:security-review` (metodología: trace data flow + verify exploitability
antes de reportar). Baseline: `655a200` (el trabajo C3.2 está uncommitted/modified sobre ese HEAD).
Diff acotado a C3.2; spec 04 / ADR-024 / `.claude/agents` (otra terminal) NO auditados por pedido.

## Summary

- **Findings**: 0 HIGH-confidence.
- **Risk level**: Low.
- **Confidence**: High (verificado contra las superficies backend reales: RLS, RPC, enums, helpers).

No high-confidence vulnerabilities identified.

El modelo de amenaza central (aislamiento multi-tenant) está **enforced server-side** y el frontend
PURO de C3.2 no lo debilita: en cada superficie el cliente manda solo identificadores de perfil
(`animal_profile_id` / `motherProfileId` / `calfProfileId`) y la RLS `has_role_in(...)` es la barrera
real. Se trazó el data flow de punta a punta y se verificó exploitability sobre el backend ya
deployado, no por pattern-matching.

---

## Verificación de exploitability (data flow trazado)

### 1. Multi-tenant / IDOR — addTacto / addService (escritura)
`addTacto`/`addService` (events.ts:315-357) arman el payload **campo por campo** (whitelist:
`animal_profile_id`, `event_type`, `event_date`, `pregnancy_status`/`service_type`, opcional `notes`)
— NO spreean el input del cliente (no hay mass assignment). El cliente NO manda `establishment_id`.
- Barrera: `reproductive_events_insert` (0026:65-66) = `with check has_role_in(establishment_of_profile(animal_profile_id))`.
- `establishment_of_profile` (0023:6-9) deriva el tenant de la **fila real** del perfil server-side.
- `has_role_in` (0005:9-23) chequea `user_roles` por `auth.uid()` + `active=true`.
- `created_by` lo setea el trigger `tg_set_created_by_auth_uid` (0026:58-60) desde `auth.uid()` — el
  cliente no puede falsificar autoría.
→ Un caller sin rol en el establishment del perfil es rechazado (42501). **No hay IDOR ni cross-tenant.**

### 2. Multi-tenant / IDOR — registerBirth (RPC register_birth)
El cliente manda SOLO `p_mother_profile_id` + `p_event_date` + `p_calves` (sexo/peso/tag). NADA de
tenancy (events.ts:405-425). Verificado en la RPC 0045:188-293:
- **(a) Autorización derivada de la fila REAL de la madre** (0045:213-225): deriva `establishment_id`
  de `animal_profiles` por `p_mother_profile_id` y exige `has_role_in(v_est)` → sin rol = 42501.
- **Herencia de tenant del server** (0045:269): el `establishment_id` de cada ternero = `v_est` (madre),
  NUNCA del payload → un payload malicioso no puede plantar terneros en otro tenant.
- `calf_sex` validado server-side (`not in ('male','female')` → 23514, 0045:248-251).
- `birth_calves` NO tiene policy/GRANT de INSERT (0045:35-39): se puebla solo desde flujo SECURITY
  DEFINER → el cliente no puede fabricar parentescos ni ligar terneros cruzados desde PostgREST.
- Atomicidad (R9.4): cualquier fallo propaga la excepción y revierte todo el parto.
→ **El cliente no puede inyectar tenant/rodeo/establishment. Confirmado.**

### 3. Multi-tenant / IDOR — fetchMother (lectura calf → madre)
`fetchMother` (events.ts:179-229) lee `birth_calves` filtrando por `.eq('calf_profile_id', X)` y
embebe `reproductive_events → animal_profiles!animal_profile_id`. NO filtra `status` (a propósito,
R14.7 tolera madre archivada).
- Barrera: `birth_calves_select` (0045:26-34) = `has_role_in(establishment_of_profile(re.animal_profile_id))`
  + `re.deleted_at is null`. El caller solo ve filas de `birth_calves` cuyo parto pertenece a un
  establishment donde tiene rol → para un `calfProfileId` de OTRO tenant la query devuelve vacío.
- "Madre archivada (status ≠ active)" es **ortogonal al tenant**: archivada ≠ de otro tenant. No filtrar
  status NO abre cross-tenant (la policy ya filtró por establishment del evento de parto).
→ **Pasar un calfProfileId ajeno no expone la madre de otro establishment. Confirmado.**

### 4. Navegación a la ficha de la madre (animal/[id].tsx → goToMother)
`MotherCard` navega a `/animal/[id]` con `mother.profileId` (animal/[id].tsx:122-125). El destino
re-aplica RLS: `fetchAnimalDetail` (animals.ts:538-551) hace `select ... .eq('id', profileId)` SIN
chequeo de tenant en cliente → la RLS de `animal_profiles` decide. Si el id apunta a un establishment
sin rol, `maybeSingle()` da `null` → "No se encontró el animal. Puede que ya no tengas acceso."
(animals.ts:554-555). **No hay confianza en el id del cliente.** Confirmado.

### 5. Inyección
Todas las queries usan supabase-js parametrizado (`.eq`, `.in`, `.select` con FK hints constantes) y
`supabase.rpc(...)` con parámetros nombrados. NO hay interpolación de strings de usuario en filtros
(`.or()/.filter()/ilike`). El embed de `fetchMother` usa nombres de relación **constantes** (no input).
**Sin inyección.**

### 6. Fuga de datos (minimización)
- `fetchMother` trae de la madre: `id, idv, visual_id_alt, status, tag_electronic, category.name`
  (events.ts:195-202). Es lo mínimo para la card (label + categoría + indicador de archivada) + el
  `id` para navegar. No trae PII de personas, ni columnas sensibles de más.
- `fetchTimeline` query suplementaria a `reproductive_events` selecciona solo `id, service_type,
  created_at` (events.ts:111-114), scopeada por `.eq('animal_profile_id', profileId)` + RLS. Mínimo.
- `categories_by_system` trae `id, name` (catálogo no sensible). OK.
**Sin over-fetching relevante.**

---

## Tabla de inputs (cada campo que el usuario tipea/elige en C3.2)

| campo | límite (largo/charset/formato/rango) | validación | OK? |
|---|---|---|---|
| pregnancy_status (tacto) | selector CERRADO `PREGNANCY_OPTIONS` (4 enum) | server: enum `pregnancy_status_enum` (0026:9) — autoritativo | ✅ |
| service_type (servicio) | selector CERRADO `SERVICE_TYPE_OPTIONS` (3 enum) | server: enum `service_type_enum` (0026:8) — autoritativo | ✅ |
| sexo del ternero (parto) | selector CERRADO `SEX_OPTIONS` (male/female) | server: RPC `not in ('male','female')`→23514 (0045:248-251) + CHECK col (0026:46) | ✅ |
| fecha (tacto/servicio/parto) | máscara `maskDateInput` (AAAA-MM-DD, 10) + `validateEventDate` (formato, no-futura) | server: columna `date NOT NULL` (0026:37) | ✅ |
| peso del ternero (opcional) | `sanitizeWeightInput` (4 cifras enteras en vivo) + `validateWeight` (>0, <10000) | server: `calf_weight numeric(7,2)` (0026:45); `nullif(...)::numeric` en RPC (0045:252) | ✅ |
| caravana del ternero (opcional) | `sanitizeTagInput` (solo dígitos, ≤15) | server: unique parcial de `animals.tag_electronic` (duplicado → 23505→`duplicate_tag`) | ✅ |
| notas (servicio, opcional) | `sanitizeObservationInput` (≤1000) + `maxLength` textarea + `validateObservation` | server: columna `notes text` (texto libre, sin concatenación en filtros) | ✅ |
| cantidad de terneros (parto) | form mínimo 1; **sin tope superior explícito** | server: RPC exige `>=1` (0045:232-234), **sin tope superior** | ⚠ ver VERIFY-001 |

Todos los campos de selección/enum tienen su red autoritativa server-side (enum/CHECK Postgres): el
selector cerrado del cliente es UX y es bypasseable, pero el DB rechaza valores fuera del enum. **No
hay path de texto libre que llegue a un filtro/prompt/SQL.** El único punto de atención es el N de
terneros (abajo).

## Tabla de rate limits (acciones abusables tocadas por el diff)

| acción | rate limit | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| insert tacto/servicio | no (n.a. a nivel C3.2) | — | RLS sí | insert simple autenticado y scopeado por RLS; no manda email/SMS ni API externa; no es bulk. No requiere cuota propia. |
| RPC register_birth | no | — | RLS/`has_role_in` sí | crea N animales por request; ver VERIFY-001 (fan-out sin cap). Costo = filas en DB, no $ externo. |
| queries de lectura (timeline/mother) | no (n.a.) | — | RLS sí | lecturas acotadas por `.eq` + RLS; no enumeran sin tope (un perfil por vez). |

C3.2 no toca Auth nativo (`config.toml`), no agrega Edge Functions, no manda email/SMS, no pega a APIs
externas. No hay regresión de rate limit. El único vector de amplificación posible es el fan-out de
`register_birth` (VERIFY-001).

---

## Needs verification (MEDIUM / no-HIGH — anotado para trazabilidad, no bloqueante)

### [VERIFY-001] register_birth: fan-out de terneros sin tope superior
- **Location**: cliente `app/app/agregar-evento.tsx` (lista `calves`, sin límite de filas) →
  `app/src/services/events.ts:405-425` (`registerBirth`) → RPC `register_birth`
  (`supabase/migrations/0045_birth_calves.sql:231-234`).
- **Confidence**: Medium (no HIGH: requiere caller AUTENTICADO **con rol** en el establishment de la
  madre, y el costo es filas en DB del propio tenant, no fuga ni cross-tenant ni $ externo).
- **Issue**: Ni el form ni `validateCalves` (event-input.ts:221-244) imponen un **máximo** de terneros;
  la RPC solo valida `jsonb_array_length(p_calves) >= 1` (0045:232) y luego **itera el array completo**
  (`for v_calf in select * from jsonb_array_elements(p_calves)`, 0045:246), insertando 2 filas
  (`animals` + `animal_profiles`) + 1 en `birth_calves` por elemento, todo en UNA transacción. Un caller
  con rol que pegue al endpoint con un `p_calves` de, p.ej., 10.000 elementos fuerza ~30.000 inserts
  atómicos en una sola request (parto biológicamente imposible; el techo realista es ~2-3 mellizos).
- **Impact**: Denial-of-availability **autenticado, intra-tenant**: una request infla la transacción y
  puede degradar la DB / contaminar el rodeo del propio establishment con miles de perfiles fantasma.
  No es cross-tenant (todo cae en `v_est` de la madre) ni fuga de datos. El blast radius es el propio
  campo del atacante (o un operador con rol comprometido).
- **Fix recomendado** (defensa en profundidad, NO bloqueante para C3.2 porque es frontend PURO sobre un
  contrato backend ya cerrado): agregar un cap server-side en la RPC, p.ej.
  `if v_count > 20 then raise exception 'too many calves' using errcode = '22023'; end if;` (un parto
  bovino real nunca pasa de 2-3; 20 es holgado). Como el cap autoritativo vive en la RPC y C3.2 no
  toca migraciones, esto es **trabajo de backend** → anotar en `docs/backlog.md` / escalar al owner del
  contrato `register_birth`, no del implementer de C3.2. El form puede además acotar el botón "Agregar
  otro ternero" (UX), pero eso solo no es el control.

---

## False positives descartados (trazabilidad)

- **"Selector cerrado bypasseable desde el endpoint" (pregnancy_status/service_type/sexo)** — NO es
  finding: el enum/CHECK de Postgres (0026:8-9,46) es la red autoritativa; el selector del cliente es
  UX. Un valor falsificado lo rechaza el DB.
- **"fetchMother no filtra status → posible cross-tenant"** — descartado: la policy `birth_calves_select`
  ya scopea por establishment del evento de parto; status es ortogonal al tenant (R14.7 a propósito).
- **"Navegación por profileId del cliente = IDOR"** — descartado: `fetchAnimalDetail` re-aplica RLS, no
  confía en el id (devuelve null si no hay acceso).
- **"Inserts mandan datos sin establishment_id → tenant ambiguo"** — descartado: es el diseño correcto;
  el server deriva el tenant del perfil vía RLS. Mandar `establishment_id` desde el cliente sería el
  antipatrón (falsificable). El comentario del implementer (events.ts:293-295) lo documenta bien.
- **`calfIdSeq` global mutable (agregar-evento.tsx:85)** — NO es seguridad: es un contador de keys de
  React en cliente, no toca tenancy ni datos.

---

## Archivos analizados (diff C3.2)

- `app/src/services/events.ts` (addTacto/addService/registerBirth/fetchMother/fetchTimeline)
- `app/app/agregar-evento.tsx` (forms tacto/servicio/parto + lista dinámica de terneros)
- `app/app/animal/[id].tsx` (MotherCard + navegación goToMother)
- `app/src/utils/event-input.ts` (validateCalves, PREGNANCY/SERVICE/SEX_OPTIONS)

Superficies backend consultadas para verificar exploitability (NO modificadas por C3.2):
`0005_rls_helpers.sql`, `0023_event_helpers.sql`, `0026_reproductive_events.sql`,
`0045_birth_calves.sql`; `app/src/services/animals.ts` (fetchAnimalDetail);
`app/src/utils/animal-input.ts` (sanitizeTagInput/sanitizeWeightInput).

## Cobertura indirecta de Deno / RLS / PowerSync (advertencia)

- **RLS / Postgres RPC**: la skill de Sentry NO cubre nativamente RLS/PL-pgSQL. La verificación del
  aislamiento multi-tenant (policies de `reproductive_events`/`birth_calves`, RPC `register_birth`,
  helpers `has_role_in`/`establishment_of_profile`/`is_owner_of`) se hizo por **revisión manual** de las
  migraciones. Resultado: barrera server-side sólida; C3.2 la consume correctamente.
- **Deno / Edge Functions**: C3.2 NO agrega ni toca Edge Functions → no aplica.
- **PowerSync**: aún no wired (C5 diferido, ADR-002). Cuando se conecte, las **sync rules** serán
  autorización PARALELA a la RLS y deberán scopearse por establishment (catálogo C1) — fuera del scope
  de C3.2, anotar para la feature de sync.
