# Spec 02 — Tier 2/3 backend: modelo de categorías de cría — Tasks

**Status**: `spec_ready` (pendiente Gate 1 + Puerta 1). Backend puro: NO se escribe frontend ni se toca `app/`.
**Fecha**: 2026-06-04 (sesión 22).
**Fuente**: `requirements-tier2-categorias.md` (RT2.x) + `design-tier2-categorias.md` (DD-1..DD-4, §1-6).

> **Reglas de ejecución.**
> - NO modificar migraciones existentes (regla dura). Todo va en migraciones **nuevas ≥ 0059** (as-built llega a `0058`).
> - El implementer **confirma el próximo número libre** contra el as-built **y** contra terminales paralelas antes de crear archivos; ajusta contiguo sin reabrir spec.
> - Cada transición nueva debe quedar en **los dos caminos** (incremental + recompute) — el design lo logra delegando el incremental a `compute_category` (§3.2), pero **el test debe verificar ambos** (insertar evento → check categoría; luego editar/borrar → check recálculo).
> - `apply_auto_transition` **NO** se re-grantea (RT2.12.2). Si el implementer toca grants, es solo re-emisión idempotente del **revoke**.
> - El frontend (`computeInitialCategoryCode`) **NO** se alinea en este chunk — es RT2.20, chunk de frontend posterior. Solo se deja el recordatorio (T9).

---

## Fase 1 — Schema (seed + columnas)

**T1 — `0059` seed `novillito`/`novillo`.** [x] Crear `supabase/migrations/0059_categories_novillo_seed.sql` con el seed idempotente de `novillito`/`novillo` para `(bovino, cría)` (design §2): join por `.code`, `on conflict (system_id, code) do nothing`, `active=true`, `sort_order` 96/97, `notify pgrst`. NO tocar las categorías existentes. — **Cubre RT2.1.1, RT2.1.2, RT2.1.3, RT2.13.2.**

**T2 — `0060` columna `is_castrated` en `animals` (DD-2).** [x] Crear `0060_is_castrated_column.sql` con `alter table public.animals add column if not exists is_castrated boolean not null default false`. No agregar policy ni grant (hereda la RLS/grant de `animals` `0022`/`0019`). `notify pgrst`. — **Cubre RT2.2.1, RT2.12.1, RT2.13.1.**

**T3 — `0061` columna `nursing` + `compute_nursing` (DD-3).** [x] Crear `0061_nursing_column.sql`: `alter table public.animal_profiles add column if not exists nursing boolean not null default false`; función `compute_nursing(profile_id) returns boolean` (`SECURITY DEFINER STABLE`, design §3.4) con `grant execute … to authenticated`; el trigger `tg_reproductive_events_recompute_nursing` (recomputa `nursing` de la madre en `birth`/`weaning` insert/update/delete, resolviendo la madre vía `birth_calves` en el caso `weaning`). El UPDATE de `nursing` NO toca `category_id` (ortogonalidad RT2.9.2) y NO gatilla el override (`0021`/`0040` escuchan `OF category_id`) ni el gating dientes/CUT de spec 03 (`0054` escucha `OF teeth_state,is_cut,category_id`). `notify pgrst`. — **Cubre RT2.9.1, RT2.9.2, RT2.9.3, RT2.13.1.**

---

## Fase 2 — `compute_category` + triggers

**T4 — `0062` reescritura de `compute_category` (DD-1).** [x] Crear `0062_compute_category_rewrite.sql` con la función completa de design §3.1: lee `a.is_castrated`; rama macho (corte 2 años → `toro`/`novillo`; destete o ≥1 año → `torito`/`novillito`; <1 año → `ternero`; `birth_date` NULL → default por sexo); rama hembra (partos≥2 → `multipara`; partos=1 → `vaca_segundo_servicio`; tacto+ vigente NO revertido por aborto → `vaquillona_prenada`; destete/servicio/≥1 año → `vaquillona`; <1 año → `ternera`; default → `vaquillona`). Conserva `SECURITY DEFINER STABLE`, conteo de **partos** (no terneros), `grant execute … to authenticated`. — **Cubre RT2.3.1–RT2.3.5, RT2.4.1–RT2.4.6, RT2.7.2, RT2.7.5, RT2.8.1, RT2.12.3.**

**T5 — `0063` alinear trigger incremental + recálculo (RT2.10).** [x] Crear `0063_category_triggers_align.sql`:
- reescribir `tg_reproductive_events_apply_transition` para que, ante `event_type in ('tacto','service','weaning','birth','abortion')` y `override=false`, **delegue a `compute_category`** y aplique vía `apply_auto_transition` si el target difiere (design §3.2). Conserva el trigger `AFTER INSERT` de `0031`.
- recrear (drop+create, NO editar `0046`) el trigger `reproductive_events_recompute_on_update` ampliando el `OF` a incluir `event_date` (aborto/tacto por fecha, RT2.7.5). Reusar `tg_reproductive_events_recompute_on_change` tal cual.
- `notify pgrst`.
— **Cubre RT2.5.1, RT2.5.2, RT2.5.3, RT2.6.1, RT2.6.2, RT2.6.3, RT2.6.4, RT2.7.1, RT2.7.3, RT2.7.4, RT2.7.6, RT2.10.1, RT2.10.2, RT2.10.3.**

**T6 — `0064` trigger de castración (DD-2).** [x] Crear `0064_castration_transition.sql` con `tg_animals_apply_castration` (`AFTER UPDATE OF is_castrated` sobre `animals`): solo actúa en `false→true`; resuelve el perfil **activo** del animal; respeta `override`; **delega a `compute_category`** (da `novillito`/`novillo` correcto según corte de 2 años) y aplica vía `apply_auto_transition`. NO revierte en `true→false` (RT2.2.6). `notify pgrst`. — **Cubre RT2.2.2, RT2.2.3, RT2.2.4, RT2.2.5, RT2.2.6, RT2.10.4.**

---

## Fase 3 — Seguridad / grants (defensa en profundidad)

**T7 — `0065` re-emisión idempotente de revokes/grants (patrón `0055`).** [x] Crear `0065_check_grants.sql` (RECOMENDADO, igual que `0038`/`0055`): re-emitir `revoke execute on function public.apply_auto_transition (uuid, uuid) from public, authenticated, anon` (RT2.12.2); confirmar `grant execute` correcto de `compute_category` y `compute_nursing` a `authenticated`; verificar que ninguna función nueva quedó con EXECUTE a public por default. **(Gate 1 — SEC-SPEC-M01)** revocar **NOMINALMENTE** las 3 funciones-trigger nuevas — `tg_reproductive_events_apply_transition`, `tg_animals_apply_castration`, `tg_reproductive_events_recompute_nursing` — de `public, authenticated, anon` y **sumarlas al smoke-check fail-closed** (paridad con el `0055`). Es defensa en profundidad (las funciones que retornan `trigger` no se exponen por PostgREST, pero el revoke nominal + smoke-check cierran el patrón y evitan una regresión futura). `notify pgrst`. — **Cubre RT2.12.2, RT2.12.4 + SEC-SPEC-M01.**

> Si el implementer prefiere, los revokes/grants pueden ir al pie de cada migración que crea la función (como hace el as-built); en ese caso T7 se vuelve una verificación en los tests (T8 caso de no-spoof) en vez de una migración propia. Decisión menor del implementer.

**T7bis — `0066` red de seguridad de edad: `refresh_age_categories()` + `pg_cron` (DD-1 camino 2).** [x] Crear `0066_age_categories_cron.sql` (design §3.5):
- `create extension if not exists pg_cron`.
- función `public.refresh_age_categories()` (`SECURITY DEFINER`, `returns void`, **sin params**, `set search_path = public`): **filtro targeted** que selecciona SOLO los perfiles age-stale — `category_override = false`, `deleted_at is null`, `birth_date not null`, y `(c.code in ('ternero','ternera') and edad ≥ 365) OR (c.code in ('torito','novillito') and edad ≥ 730)` (las **hembras no tienen corte de 2 años**: `vaquillona→vaca` es por parto, NO entra al filtro; `toro`/`novillo` ya son terminales por edad, NO entran). Para cada candidato: `compute_category` + `apply_auto_transition` **solo si el target difiere** (history `auto_transition` gratis). NO recalcula el padrón entero.
- **SEGURIDAD (CRÍTICO, SEC-SPEC-M02):** `revoke execute on function public.refresh_age_categories () from public, authenticated, anon` (cross-tenant by-design → IDOR catastrófico si fuera RPC cliente, clase SEC-HIGH-01) **+ sumarla al smoke-check fail-closed** (la migración FALLA si quedó EXECUTE-able por una rol cliente; mismo patrón que el `do $$ … has_function_privilege …$$` de `0055`). A diferencia de las funciones-trigger (retornan `trigger`, no se exponen por PostgREST), esta retorna `void` → SÍ se expondría como RPC sin el revoke.
- `cron.schedule('refresh_age_categories_nightly', '0 3 * * *', $$ select public.refresh_age_categories(); $$)` **idempotente** (upsert por `jobname`; si la versión de `pg_cron` no lo soporta, `cron.unschedule` defensivo antes del `schedule`).
- `notify pgrst`.
— **Cubre RT2.8.2, RT2.8.4, RT2.8.5, RT2.12.6 + SEC-SPEC-M02.**

> **Dependencia de orden:** `0066` debe ir **después** de `0059` (seed `novillito`/`novillo` — el filtro lee `categories_by_system.code`) y `0062` (`compute_category` con cortes de edad). Reusa `apply_auto_transition` as-built (`0031`, revocada `0042`). Es la **última** migración del delta.

---

## Fase 4 — Tests reales (extensión de `supabase/tests/animal/run.cjs`)

> La suite `supabase/tests/animal/run.cjs` ya está enganchada en `scripts/run-tests.mjs` (línea 62, "Animal suite (spec 02)") → **NO hace falta tocar el orquestador**. Solo se agregan sub-tests `t.test('T2.<n> …')`. Reusar los helpers existentes (`createAnimal`, `createRodeo`, `categoryId`, `daysAgo`, `createManagementGroup`). Para `is_castrated` y `nursing`, escribir vía el client del usuario (no service) para ejercitar la RLS real. Cada caso resuelve el `code` de la categoría vía `categories_by_system` como ya hace T2.3/T2.4.

**T8 — Tests del delta.** [x] Agregados a `run.cjs` como sub-tests `T2.20`-`T2.33` (a continuación del último as-built `T2.19`). Animal suite 42/42.

- **T8.a — seed novillito/novillo.** [x] `categories_by_system` para `(bovino,cría)` tiene `novillito` y `novillo` activos; las 10 categorías base siguen presentes y activas (RT2.1.1, RT2.1.2). — **RT2.1.x.**

- **T8.b — `compute_category` rama macho (alta directa, sin eventos).** [ ] macho <1 año → `ternero`; macho ≥1 año (`birthDate` daysAgo(400)), `is_castrated=false` → `torito`; macho ≥2 años (daysAgo(800)), entero → `toro`; macho ≥1<2 años, `is_castrated=true` → `novillito`; macho ≥2 años, castrado → `novillo`; macho `birthDate=null`, entero → `torito` (RT2.3.4). — **RT2.3.1–RT2.3.5.**

- **T8.c — `compute_category` rama hembra (alta directa).** [ ] hembra <1 año sin eventos → `ternera`; hembra ≥1 año sin eventos → `vaquillona`; hembra `birthDate=null` sin eventos → `vaquillona` (RT2.4.6). — **RT2.4.4, RT2.4.5, RT2.4.6.**

- **T8.d — transición SERVICIO (ternera→vaquillona).** [ ] crear ternera (categoryCode `ternera`, <1 año); insertar `reproductive_events` `service`; verificar categoría → `vaquillona`, `override=false` (RT2.5.1). Servicio sobre una vaquillona ya existente → sin cambio (RT2.5.2). Servicio con `override=true` → sin cambio (RT2.5.3). — **RT2.5.x.**

- **T8.e — transición DESTETE.** [ ] ternero macho entero + `weaning` → `torito` (RT2.6.1); ternero macho con `is_castrated=true` (set sobre `animals`) + `weaning` → `novillito` (RT2.6.1); ternera + `weaning` → `vaquillona` (RT2.6.2); destete sobre un `torito` ya graduado → sin retroceso (RT2.6.3); destete con `override=true` → sin cambio (RT2.6.4). — **RT2.6.x.**

- **T8.f — transición PARTO desde cualquier categoría.** [ ] vaquillona (sin pasar por preñada) + `birth` → `vaca_segundo_servicio` (RT2.7.1, desde cualquier categoría); **ternera** + `birth` → `vaca_segundo_servicio` (RT2.7.1, salto desde ternera); + 2º `birth` → `multipara` (RT2.7.1/2.4.1); mellizos: un `register_birth` con 2 terneros = **un** parto → categoría avanza una sola vez (RT2.7.2). — **RT2.7.1, RT2.7.2, RT2.4.1, RT2.4.2.**

- **T8.g — ABORTO revierte.** [ ] vaquillona + tacto+ → `vaquillona_prenada`; + `abortion` → `vaquillona` (RT2.7.3); una `multipara` + `abortion` → sigue `multipara` (RT2.7.4); aborto con `override=true` → sin cambio (RT2.7.6). — **RT2.7.3, RT2.7.4, RT2.7.6.**

- **T8.h — CASTRACIÓN (cambio de `is_castrated`).** [ ] `torito` + set `animals.is_castrated=true` → `novillito` (RT2.2.3); `toro` (≥2 años) + castrar → `novillo` (RT2.2.4); `ternero` + castrar → sigue `ternero` hasta el destete (RT2.2.2); castrar con `override=true` → sin cambio (RT2.2.5); `true→false` no revierte `novillito→torito` (RT2.2.6); el cambio quedó en `animal_category_history` como `auto_transition` (RT2.10.4). — **RT2.2.x, RT2.10.4.**

- **T8.i — CRÍA AL PIE (`nursing`).** [ ] madre + `birth` (con calf) → `nursing=true` (RT2.9.1); destetar al ternero (`weaning` sobre el perfil del ternero) → madre `nursing=false` (RT2.9.1); verificar que cambiar `nursing` NO cambió `category_id`/`rodeo_id`/`management_group_id` (RT2.9.2); borrar el destete → madre vuelve `nursing=true`; borrar el parto → `nursing=false` (RT2.9.3). — **RT2.9.x.**

- **T8.j — CONSISTENCIA trigger↔recompute (la clave, RT2.10).** Por cada transición nueva, verificar que **editar/borrar el evento revierte correctamente** (no se queda pegada ni revierte por edad):
  - [ ] borrar el `service` que promovió `ternera→vaquillona` → recálculo vuelve a `ternera` (si <1 año) (RT2.10.2).
  - [ ] borrar el `weaning` que graduó `ternero→torito` → vuelve a `ternero` (si <1 año) (RT2.10.2).
  - [ ] borrar un `birth` de una `multipara` (que la dejó multípara con 2 partos) → recálculo a `vaca_segundo_servicio` (1 parto) (RT2.10.2).
  - [ ] tacto+ seguido de `abortion`: la categoría es `vaquillona` tras el insert del aborto (incremental, RT2.7.3) **y** sigue `vaquillona` tras forzar un `compute_category` explícito (recompute, RT2.7.5) — verifica que el recálculo NO la deja `vaquillona_prenada` por el tacto+ histórico. Mover la fecha del aborto antes del tacto y verificar que entonces sí cuenta el tacto (RT2.7.5 por fecha).
  - [ ] `compute_category` invocado directamente sobre un perfil tras una secuencia de eventos da el **mismo** code que la categoría materializada por los triggers (RT2.10.1).
  — **RT2.10.1, RT2.10.2, RT2.10.3, RT2.7.5.**

- **T8.k — OVERRIDE manda en todas las transiciones nuevas.** [ ] con `category_override=true`: servicio, destete, parto, aborto y castración NO cambian la categoría (RT2.11.1). Revert (`override=false` + `compute_category`) recalcula correcto con `is_castrated` + eventos (RT2.11.2). — **RT2.11.1, RT2.11.2.**

- **T8.l — SEGURIDAD / no-spoof (Gate 1 lo mira).** [ ]
  - `apply_auto_transition` NO es invocable por `authenticated` (RPC revocada, `0042`): `clientA.rpc('apply_auto_transition', {...})` → error (RT2.12.2).
  - `is_castrated`: userC sin rol en estA NO puede leer ni togglear `is_castrated` de un animal de estA (RLS de `animals`); userB (field_operator de estA) sí puede togglearlo (RT2.12.1, RT2.12.5).
  - togglear `is_castrated` de un animal de **otro** tenant → 0 filas / error (RT2.12.5).
  - `compute_category`/`compute_nursing` sobre un `profile_id` de otro tenant → no expone datos (la función deriva del perfil, pero el caller no ve el resultado si no tiene rol; verificar que no hay fuga) (RT2.12.3, RT2.12.1).
  — **RT2.12.1, RT2.12.2, RT2.12.3, RT2.12.5.**

- **T8.m — migración no toca histórico (DD-4).** [ ] un perfil creado **antes** del seed/columnas (en el setup) conserva su categoría tras correr el delta; ningún animal pasó a `novillito`/`novillo` por el solo seed (todos arrancan `is_castrated=false`) (RT2.13.1, RT2.13.2). *(Este caso es más conceptual; en la práctica la suite corre contra la DB ya migrada — se verifica que un animal con `is_castrated=false` y categoría base no migra por el seed.)* — **RT2.13.x.**

- **T8.n — CRON de edad (`refresh_age_categories`): targeted, no-spoof, override (DD-1 camino 2).** [ ] Como la suite corre con la service key, invocar `refresh_age_categories()` **directamente** (vía el client service) para ejercitar el efecto del job sin esperar al schedule. Casos:
  - **recalcula un age-stale (corte 1 año):** crear un macho `ternero` con `birthDate = daysAgo(400)`, `category_override=false`, **sin** eventos (queda `ternero` por estar materializado así en el alta); invocar `refresh_age_categories()`; verificar que pasó a `torito` (RT2.8.2, RT2.8.4). El cambio quedó en `animal_category_history` como `auto_transition` (RT2.8.4b).
  - **recalcula un age-stale (corte 2 años):** `torito` con `birthDate = daysAgo(800)`, entero → tras el job pasa a `toro` (RT2.8.4); castrado `novillito` daysAgo(800) → `novillo`.
  - **NO toca a los que no cruzaron umbral:** un `ternero` de `daysAgo(100)` sigue `ternero` tras el job; una `vaquillona` de `daysAgo(900)` **sigue `vaquillona`** (hembras NO tienen corte de 2 años — el filtro no la caza) (RT2.8.4a/c).
  - **respeta override:** un `ternero` `daysAgo(400)` con `category_override=true` **no** cambia tras el job (RT2.8.3).
  - **respeta soft-delete:** un perfil age-stale con `deleted_at` seteado no se toca.
  - **SEGURIDAD (Gate 1 — SEC-SPEC-M02):** `clientA.rpc('refresh_age_categories')` (client `authenticated`) → **error** (EXECUTE revocado, RT2.12.6). Verifica que NO es invocable por un cliente (es el control de seguridad principal de esta función, no defensa en profundidad).
  — **RT2.8.2, RT2.8.3, RT2.8.4, RT2.8.5, RT2.12.6, SEC-SPEC-M02.**

**T9 — Recordatorio: espejo cliente (RT2.20, NO en este chunk).** [ ] Dejar anotado en `progress/` (handoff al chunk de frontend) que `app/src/utils/animal-category.ts::computeInitialCategoryCode` y su test `animal-category.test.ts` deben alinearse cuando el frontend agregue el picker `novillito`/`novillo` o el alta de macho castrado adulto. **NO se toca en este chunk** (es backend puro). El espejo sigue correcto para el alta directa actual (la rama sin-eventos no cambió). — **Dependencia RT2.20.**

---

## Fase 5 — Verificación y gates

**T10 — Correr la suite.** [ ] `node scripts/run-tests.mjs` (o `node --test supabase/tests/animal/run.cjs` con las keys en `.env.local`) → toda la suite verde, incluyendo los T8.x nuevos y los T2.x existentes (regresión: las transiciones base `tacto+→prenada`, `birth→vaca`, `2º birth→multipara` siguen pasando, ahora vía el camino delegado). — **regresión + delta.**

**T11 — Gate 1 (`security_analyzer` modo `spec`).** [ ] Esquema-sensitive: reescritura de `compute_category`/triggers `SECURITY DEFINER`, columna `is_castrated`, RLS/grants. El leader corre Gate 1 antes de Puerta 1. Puntos que el Gate 1 debe confirmar (del design §4):
- `apply_auto_transition` sigue revocada (no se reintrodujo grant) — RT2.12.2;
- `compute_category`/`compute_nursing` no leen/escriben otro tenant (derivan del `profile_id`) — RT2.12.3;
- el trigger de castración deriva el perfil de la fila real (`where animal_id = new.id`), no de un parámetro del cliente — RT2.12.4/2.12.5;
- la columna `is_castrated` hereda la RLS de `animals` sin abrir camino cross-tenant — RT2.12.1;
- **`refresh_age_categories()` (cron) está revocada de `public`/`authenticated`/`anon` y en el smoke-check fail-closed** — es `SECURITY DEFINER`, cross-tenant by-design, `returns void` (se expondría como RPC sin el revoke → IDOR catastrófico clase SEC-HIGH-01); confirmar que el filtro es targeted (no full-padrón), sin params del cliente, cambia categoría solo vía `apply_auto_transition` y no devuelve datos — RT2.12.6 / SEC-SPEC-M02;
- ninguna función nueva quedó como RPC pública con EXECUTE a public/authenticated indebido.

**T12 — Puerta 1 (aprobación humana de Raf).** [ ] Tras Gate 1 PASS, Raf aprueba la spec. Mirar especialmente: la **decisión de cortes de edad — on-event primario + `pg_cron` nocturno targeted (DD-1, revisada 2026-06-04)** y la **tensión C1** (este chunk cierra el D1 de spec 10 "efecto de categoría de la castración"; spec 10 debe escribir `is_castrated` en su flujo de castración masiva para que la transición ocurra). — **gate humano.**

---

## Orden de dependencia

```
T1 (seed novillito/novillo) ─┐
T2 (is_castrated en animals) ─┤
T3 (nursing + compute_nursing)┼─> T4 (compute_category rewrite, usa is_castrated)
                              │      ├─> T5 (incremental + recompute delegan a compute_category)
                              │      │     └─> T6 (castración delega a compute_category)
                              │      └─> T7bis (cron: refresh_age_categories usa compute_category + apply_auto_transition)
                              └─> T7 (revokes/grants idempotentes)
T4..T7bis ──> T8 (tests, incl. T8.n cron) ──> T10 (suite verde) ──> T11 (Gate 1) ──> T12 (Puerta 1)
T9 (recordatorio frontend) — independiente, no bloquea.
```

> `compute_category` (T4) debe existir **antes** de T5/T6/**T7bis** porque los tres delegan en ella. El seed (T1) y las columnas (T2/T3) deben existir antes de T4 (la función lee `is_castrated` y resuelve `novillito`/`novillo` por code). **T7bis (`0066` cron) es la última migración del delta** (depende de `0059` seed + `0062` compute_category + `apply_auto_transition` as-built/revocada). T7 (grants idempotentes, `0065`) y T7bis (`0066`) son ambos posteriores a T4-T6; T7bis va al final por número.
