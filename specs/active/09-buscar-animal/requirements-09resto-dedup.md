# Spec 09 — chunk "09 resto · dedup A/B (asignación de caravana)" — Requirements (EARS)

**Status**: spec aprobada (Puerta de spec por Raf, 2026-06-13) + Gate 1 PASS (0 HIGH, `security_spec_09resto-dedup.md`) + RPC 0089 deployado al remoto; implementación done (Runs 1-4: backend + UI A + UI B + E2E formal). Reviewer + Gate 2 (code) + Puerta 2 = del leader.
**Fecha**: 2026-06-13 (sesión 25).
**Autor**: spec_author.
**Insumo primario**: `specs/active/09-buscar-animal/context-09resto-dedup.md` (Gate 0 aprobado: scope §3, decisiones DEC-1..DEC-3 + defaults D-a..D-d §4, arquitectura/sketch del RPC §5, edge cases §6, gates §7, plan de verificación §8). Aterriza el contrato R7 (opción A) + R8 (opción B) + R12 (compatibilidad R4.13.a, ya RESUELTA) de la spec base de 2026-05-26 (`requirements.md`) **sin reescribirla** — la reconciliación con la base se hace al cerrar el chunk (notas AS-BUILT agregadas en R7/R8/R12).

## Naturaleza y alcance

Chunk que cierra los **duplicados lógicos** de BUSCAR ANIMAL: el animal que ya está cargado con solo visual/IDV (sin caravana electrónica) y al que recién ahora, en la manga, se le pone la caravana. Cubre las **dos** formas de asignación que la spec base define:

- **Opción A** (R7 base) — intermedia previa al alta: cuando el bastón lee un EID **sin match**, en vez de ir directo a CREATE (como dejó el chunk BLE global por DEC-2), el overlay ofrece una lista de candidatos sin caravana para asignarle el EID a uno; si el operario dice "es nuevo", sigue a CREATE.
- **Opción B** (R8 base) — pantalla de asignación masiva: el operario bastonea el rodeo en serie y para cada EID elige el candidato; contador de sesión, una decisión por pantalla.

A diferencia del chunk BLE global (frontend puro), **este chunk toca backend**: asignar caravana NO es un UPDATE local plano (`animals` está FUERA del sync set, ADR-026 b1 — la tabla ni existe en el SQLite local). La única vía limpia (online y offline) es un **RPC `assign_tag_to_animal` SECURITY DEFINER** (migración ≥0089) invocado vía el patrón outbox + RPC-mapping de spec 15. El trigger de identidad (0079) propaga `animals.tag_electronic` → `animal_profiles.animal_tag_electronic` server-side; el cliente NO escribe `animals`.

## Gate 1 (security spec): SÍ APLICA

Este chunk crea un RPC SECURITY DEFINER que escribe `animals.tag_electronic` + autoriza cross-tenant + depende de la unicidad global del TAG. Superficie de seguridad (detallada en `design-09resto-dedup.md` §1): anti-IDOR del `p_profile_id` (derivar `animal_id` + `establishment_id` de la fila real), re-chequeo `has_role_in` (cualquier rol activo, D-d), guard `WHERE tag_electronic IS NULL` (R12.2 / NULL→valor), idempotencia por `client_op_id`, validación de formato del EID server-side (15 díg), revoke/grants estándar con firma tipada + smoke-check, `search_path` fijo. **Deploy gated**: la migración a la DB compartida = autorización de Raf en sesión (clasificador / [[project_supabase_mcp_write]]). **Gate 2 (security code)**: SÍ, por run del implementer.

## Decisiones del Gate 0 que este chunk aterriza (DEC-1..3 + D-a..D-d)

| # | Decisión (lockeada por Raf, 2026-06-13) | Dónde se aterriza |
|---|---|---|
| **DEC-1** | A + B juntas en este chunk (un solo RPC + service compartido, una pasada de Gate 1 + deploy + review). | Todo el chunk: el RPC y el service sirven a A y a B. |
| **DEC-2** | Asignar caravana **offline** (outbox + RPC-mapping, patrón spec 15). Dup-TAG se detecta en sync. | RD2 (service offline), RD9 (offline-first). |
| **DEC-3** | La intermedia (opción A) vive en el **mismo bottom-sheet** (nuevo modo `assign_or_create`): lista scrollable + buscador + CTA "es nuevo". | RD3, RD4. |
| **D-a** | Buscador dentro de las listas de candidatos (A y B), reusando `searchAnimals` scopeado a `noTag`. | RD3.4, RD5.4. |
| **D-b** | Guard `WHERE tag_electronic IS NULL` en el UPDATE + copy accionable ante race/dup, sin perder progreso de sesión. | RD1.5, RD6, RD8. |
| **D-c** | Entry points de la opción B: tab Animales (filtro "sin caravana", CTA "Asignar caravanas en masa") + tab "Más". | RD5.1. |
| **D-d** | Autorización para asignar caravana: **cualquier rol activo** en el campo (trabajo de manga, no owner-only). | RD1.3. **A confirmar en Gate 1.** |

## Divergencias / refinamientos sobre la spec base (2026-05-26)

| Spec base | Este chunk | Razón |
|---|---|---|
| **R7.1** habla de una pantalla `AssignTagSearchScreen` (modal o full-screen) separada. | La intermedia es un **modo del bottom-sheet existente** (`assign_or_create`), no una pantalla aparte. | DEC-3 (Gate 0): mantiene el ritmo de manga y reusa el host `FindOrCreateOverlay` ya construido (chunk BLE global). |
| **R3.3 BLE** dice "interponer la opción A **antes** de invocar CREATE" siempre. | Si hay **0 candidatos** sin caravana, se salta la intermedia y va directo a CREATE (la intermedia vacía no aporta). | Rec del leader §5 / §6 del Gate 0: una intermedia sin candidatos es fricción pura. |
| **R7.4 / R8.3** describen el UPDATE como `UPDATE animals SET tag_electronic = ... WHERE id = $candidate AND tag_electronic IS NULL` desde el cliente. | El UPDATE lo hace un **RPC `assign_tag_to_animal` SECURITY DEFINER** (offline vía outbox), no el cliente directo. | Hallazgo del Explore: `animals` está fuera del sync set → no hay UPDATE local posible; el RPC es la única vía. El guard `IS NULL` se mantiene **dentro** del RPC. |
| **R7/R8** no especifican autorización. | El RPC re-chequea **cualquier rol activo** (`has_role_in`) server-side (no owner-only). | D-d (Gate 0): es trabajo de manga; espeja que lote/eventos los carga cualquier rol operativo. |

## Fuera de este chunk (diferido)

- **Opción C** (detección automática + merge guiado entre dos `animals`): post-MVP (R9 base, `CONTEXT/07-pendientes.md`). NO entra.
- **`spp-android` real** (bastón físico para la masiva): gated por el dev build Android (ADR-024 §4). Se valida con mock / web-serial.
- **Audit granular de la asignación** ("cuándo/quién puso esta caravana"): el `updated_at` de la fila cubre el MVP (R12.4 base). Si más adelante hace falta, es un upgrade backwards-compatible sobre el mismo RPC.

---

## Requirements (EARS)

> Nomenclatura: requirements de este chunk con prefijo **RD** (R-Dedup) para no colisionar con la numeración de la spec base; cada uno indica a qué R de la base aterriza. El criterio "candidato sin caravana" es, en TODAS las RD: `animal_profiles` con `status='active'` + `deleted_at IS NULL` + `animal_tag_electronic IS NULL` (denorm 0079, b1) del **establishment activo** — exactamente el filtro `noTag` de `buildAnimalsListQuery` (R1.5 base / R7.2 base).

### RD1. RPC `assign_tag_to_animal` — contrato e invariantes de seguridad (aterriza R7.4 / R8.3 / R12.1 / R12.2)

**RD1.1** El sistema deberá exponer un RPC `assign_tag_to_animal(p_profile_id uuid, p_tag_electronic text, p_client_op_id uuid)` (migración ≥0089, `SECURITY DEFINER`, `set search_path = public`) que asigne la caravana electrónica `p_tag_electronic` al animal global del perfil `p_profile_id`, ejecutando `UPDATE animals SET tag_electronic = p_tag_electronic WHERE id = <animal_id derivado> AND tag_electronic IS NULL`.

**RD1.2 (anti-IDOR)** El RPC deberá derivar `animal_id` + `establishment_id` **de la fila real** de `animal_profiles WHERE id = p_profile_id AND status='active' AND deleted_at IS NULL` — NUNCA confiar en parámetros del cliente para el `animal_id` ni el tenant (mismo patrón que `transfer_animal` 0087 y `register_birth` 0075). Si el perfil no existe / no está activo / está soft-deleted, el RPC deberá rechazar con error claro (`23503`).

**RD1.3 (autorización, D-d)** El RPC deberá rechazar (`42501`) si `has_role_in(<establishment_id derivado>)` es `false` para `auth.uid()`. **Cualquier rol activo** en el establishment del perfil está autorizado a asignar caravana (no owner-only) — es trabajo de manga. *(Esta política se confirma en Gate 1; si Gate 1 la endurece, se actualiza acá.)*

**RD1.4 (validación de formato, defensa server-side)** El RPC deberá rechazar (`23514` o `22023`) un `p_tag_electronic` que no sea exactamente 15 dígitos (`^\d{15}$`, espeja `isValidTag` de spec 04). El cliente ya valida el EID en el contrato de ingesta del bastón; el RPC lo re-valida como defensa en profundidad.

**RD1.5 (guard NULL→valor, R12.2 / R4.13.a)** El UPDATE del RPC deberá llevar la cláusula `AND tag_electronic IS NULL` en el WHERE (además del trigger `tg_animals_block_tag_change` de 0036, que ya permite NULL→valor y bloquea valor→valor). Cuando el UPDATE afecte **0 filas** (el animal ya tenía caravana — race con otro device), el RPC deberá rechazar con un error accionable distinguible (`23514` "el animal ya tiene caravana asignada") para que el cliente surfacee "ese animal ya tiene caravana — refrescá la lista".

**RD1.6 (idempotencia — state-based, DA-1 RATIFICADA por Gate 1)** El RPC deberá ser idempotente reconociendo el **estado ya aplicado**: si el animal derivado ya tiene exactamente `p_tag_electronic` (cláusula (d) del design §1.2), un reintento del outbox (por ACK perdido) **no** deberá re-aplicar ni rebotar erróneamente — devuelve `replay:true`. La dedup corre **después** de derivar+authz (anclada a `v_animal_id` del tenant ya autorizado) → sin lookup global ni oráculo cross-tenant (patrón anti-HIGH-D1 de 0075). El `p_client_op_id` se conserva en la firma del RPC **solo como passthrough del contrato del intent/mapeo** (compat con `op_intents`); **NO** ancla la dedup (no se cuelga de ninguna columna/índice nuevo — el implementer NO debe agregar `animals.last_assign_op_id` ni tabla de audit). Invariante: reintento = no-op exitoso (`replay:true`), sin doble-error ni dato ajeno.

**RD1.7 (unicidad global)** Cuando `p_tag_electronic` ya esté asignado a OTRO animal global (índice parcial `animals_tag_unique` de 0019), el RPC deberá rebotar con `23505`. Offline, este rechazo se resuelve **en el sync** (RD2.4): el cliente lo clasifica `permanent_reject` y lo surfacea ("ese TAG ya está asignado a otro animal"), sin perder el progreso de la sesión.

**RD1.8 (cierre de superficie)** El RPC deberá hacer `revoke execute ... from public, anon` + `grant execute ... to authenticated` con la firma tipada completa `(uuid, text, uuid)` + smoke-check fail-closed (estilo 0074/0087) + `notify pgrst, 'reload schema'`. No deberá ser invocable por `anon`/`public`.

**RD1.9 (sin tablas nuevas al sync)** El chunk NO deberá agregar tablas nuevas al sync set: `animals` sigue fuera; el efecto de la asignación baja por la stream existente vía `animal_profiles.animal_tag_electronic` (propagación del trigger 0079). No se crea ninguna stream ni policy RLS nueva (consume la de spec 02).

### RD2. Service offline `assignTagToAnimal` — outbox + RPC-mapping (aterriza R7.4 / R8.3 / R11.2 / R11.5)

**RD2.1** El sistema deberá exponer un service público `assignTagToAnimal(profileId: string, tag: string): Promise<...>` (en `app/src/services/animals.ts`) que encole la asignación vía la outbox de spec 15, **sin requerir red** (offline-first, DEC-2).

**RD2.2** El sistema deberá exponer `enqueueAssignTag({ params: { p_profile_id, p_tag_electronic } })` (en `app/src/services/powersync/outbox.ts`) que inserte un `op_intent` con `op_type='assign_tag_to_animal'` (= **nombre exacto del RPC**, fold MEDIUM-1 de Gate 1: evita un case especial frágil y un mismatch con la firma tipada del grant) y `params_json = { p_profile_id, p_tag_electronic }`, generando el `client_op_id` (= `op_intents.id`; passthrough, no ancla la dedup — ver RD1.6). **No** deberá escribir overlay optimista sobre `animals` (la tabla no está local); la salida del candidato de las listas de sesión es client-side (RD4.5 / RD5.5).

**RD2.3** El sistema deberá agregar `assign_tag_to_animal` al set `RPC_OP_TYPES` (para que el intent no caiga en `PermanentIntentError`) y extender la rama de `p_client_op_id` de `mapIntentToRpc` (en `app/src/services/powersync/upload.ts`) — `opType === 'register_birth' || opType === 'assign_tag_to_animal'` → `{ kind:'rpc', rpcName: opType, args: { p_profile_id, p_tag_electronic, p_client_op_id: op.id } }`. Como `op_type === rpcName === 'assign_tag_to_animal'`, el mapeo genérico (`rpcName: opType`) lo cubre sin un case especial (fold MEDIUM-1).

**RD2.4 (clasificación de errores)** El sistema deberá clasificar los errores de aplicar el intent `assign_tag_to_animal` vía `classifyIntentUploadError`:
- `23505` (TAG ya asignado a otro animal global) → `permanent_reject` (rollback + descarte + surface "ese TAG ya está asignado a otro animal", RD1.7).
- `23514` "el animal ya tiene caravana" (race, guard `IS NULL` → 0 filas, RD1.5) → `permanent_reject` con surface "ese animal ya tiene caravana — refrescá".
- `42501` (sin rol activo) / `23503` (perfil inexistente) → `permanent_reject`.
- el **replay idempotente** (estado ya aplicado, RD1.6) **NO es un error**: el RPC devuelve `{replay:true}` como **2xx** → `uploadData` limpia el intent normalmente (no entra a `classifyIntentUploadError`). Por lo tanto **NO se agrega un case `idempotent_discard`** para `assign_tag_to_animal`; `classifyIntentUploadError` queda **sin cambios** para esta op (el default `permanent_reject` cubre los rechazos reales). (Ratificado por Gate 1, design §2.3.)
- transitorios (red/5xx/timeout) → `transient` (reintenta, no toca estado).

**RD2.5** Mientras el cliente esté offline, el encolado de `assign_tag_to_animal` deberá tener éxito al instante (devuelve la intención); el efecto real (la caravana en `animal_profiles.animal_tag_electronic`) baja por la stream al sincronizar. La UI de sesión refleja el progreso quitando el candidato de la lista en el momento (client-side), enmascarando la staleness del denorm local hasta el sync.

### RD3. Opción A — modo `assign_or_create` del bottom-sheet (aterriza R3.3 BLE / R7.1 / R7.2 / R7.3 / R7.5)

**RD3.1** Cuando `lookupByTag` retorna `mode:'create'` (EID bastoneado sin match en ningún campo del usuario), el host `FindOrCreateOverlay` deberá computar **además** la existencia de candidatos sin caravana del establishment activo (filtro `noTag`). El resultado del overlay deberá ser un **nuevo modo** `assign_or_create` cuando hay ≥1 candidato, en vez del `create` directo del chunk BLE global.

**RD3.2 (skip a CREATE si 0 candidatos)** Cuando NO haya ningún candidato sin caravana (0 filas), el sistema deberá conservar el comportamiento del chunk BLE global: ir **directo a CREATE** con el EID precargado (la intermedia vacía no aporta). El modo `create` del overlay queda intacto para ese caso.

**RD3.3** En modo `assign_or_create`, el overlay deberá mostrar, además del EID legible (encabezado SENASA, ya existente): un título accionable ("¿Es uno de tus animales sin caravana?"), una **lista scrollable de candidatos** (`status='active'`, `deleted_at IS NULL`, `animal_tag_electronic IS NULL`, ordenados por `updated_at DESC` — recientes primero, R7.2) y un **CTA grande siempre visible "Es un animal nuevo → dar de alta"** (R7.5).

**RD3.4 (buscador, D-a)** El modo `assign_or_create` deberá ofrecer un buscador dentro de la lista de candidatos, reusando `searchAnimals` scopeado a `noTag` (match por IDV / visual). Un rodeo de 200 animales sin caravana no se scrollea a ciegas.

**RD3.5** Cada candidato deberá mostrar la información mínima para identificarlo de un vistazo (R7.3): `idv` (si existe), `visual_id_alt` (si existe), `category`, `sex`, `rodeo`. (`birth_date` y "último evento" quedan opcionales — los define el design-review del leader sobre la UI.)

**RD3.6 (asignar al candidato)** Cuando el operario toca un candidato, el sistema deberá pedir confirmación ("Asignar caravana `<EID>` a este animal") y, al confirmar, invocar `assignTagToAnimal(profileId, eid)` (RD2.1). Al éxito del encolado, el sistema deberá cerrar el overlay y navegar a la ficha del animal (`/animal/[id]` con el `profileId` del candidato). El UPDATE real lo aplica el RPC al sincronizar (offline-first).

**RD3.7 ("es nuevo" → CREATE, R7.5)** Cuando el operario toca el CTA "Es un animal nuevo → dar de alta", el sistema deberá cerrar el modo `assign_or_create` y navegar a `/crear-animal` con el EID bastoneado precargado read-only (idéntico al modo `create` del chunk BLE global, RB6).

**RD3.8 (puerta manual sin cambio)** El modo `assign_or_create` aplica **solo** a la puerta BLE (EID bastoneado). La puerta manual (R1.4: tipear idv/visual sin match) sigue yendo directo a CREATE (R3.3 base) — la intermedia es exclusiva del bastón.

### RD4. Opción A — comportamiento de sesión del overlay (aterriza R7.4 / R10.1 / R11.1)

**RD4.1** El cómputo de candidatos (RD3.1) deberá correr 100% sobre PowerSync local (SQLite), sin red, scopeado al `establishment_id` activo del `EstablishmentContext`.

**RD4.2** Mientras el overlay esté en modo `assign_or_create`, un nuevo bastoneo (live-rescan, RB3.5 del chunk BLE global) con un EID **distinto** deberá re-disparar el flujo (nuevo lookup + nuevo cómputo de candidatos) sin cerrar el sheet, consistente con el ritmo de manga ya implementado.

**RD4.3** Cuando el `establishment_id` activo cambie mientras el overlay está abierto, el sistema deberá descartar el overlay (consistente con RB2.4 del chunk BLE global) — la lista de candidatos se scopeó al campo del disparo.

**RD4.4** El cierre del overlay (tap afuera / "Cerrar") sin elegir candidato ni "es nuevo" deberá descartar el flujo sin asignar nada y reanudar el listener para el próximo bastoneo (consistente con RB3.4).

**RD4.5** Tras una asignación exitosa (RD3.6), la navegación a la ficha cierra el overlay; en el contexto de la opción A (un bastoneo = una decisión) no hay "lista de sesión" persistente — el candidato asignado sale naturalmente de cualquier lista `noTag` al sincronizar (su `animal_tag_electronic` deja de ser NULL).

### RD5. Opción B — pantalla de asignación masiva (aterriza R8.1 / R8.2 / R8.3 / R8.5 / R8.6)

**RD5.1 (entry points, D-c)** El sistema deberá exponer una pantalla `BulkTagAssignmentScreen` accesible desde: (a) la tab `Animales` con el filtro "sin caravana electrónica" (R1.5) vía un CTA explícito "Asignar caravanas en masa"; y (b) la tab `Más` de la navegación principal.

**RD5.2** La `BulkTagAssignmentScreen` deberá consumir el listener BLE global en modo asignación mientras esté en foreground: cada EID bastoneado se acumula en una **cola de la sesión** (estado local), y para el EID actual el sistema deberá mostrar la lista de candidatos sin caravana (mismo criterio `noTag` que RD3.3, `updated_at DESC`) para asignar.

**RD5.3 (asignar 1×1)** Para el EID actual, el operario deberá poder seleccionar un candidato de la lista y confirmar; el sistema deberá invocar `assignTagToAnimal(profileId, eid)` (RD2.1) — cada asignación es una operación independiente que se encola al instante (offline-first; cerrar la pantalla no rollbackea nada, R8.5). Tras confirmar, el sistema deberá quitar el candidato de la lista de la sesión (client-side, RD2.5) y dejar al operario listo para el siguiente EID de la cola.

**RD5.4 (buscador, D-a)** La `BulkTagAssignmentScreen` deberá ofrecer el mismo buscador `searchAnimals` scopeado a `noTag` dentro de la lista de candidatos.

**RD5.5 (contador, R8.5)** El sistema deberá mostrar un **contador visible de la sesión** ("X caravanas asignadas") y deberá permitir cerrar la pantalla sin perder las asignaciones ya encoladas (cada una es independiente y ya quedó en la outbox).

**RD5.6 ("es nuevo" → CREATE, R8.6)** La pantalla deberá ofrecer un CTA "Bastoneé un animal nuevo, no está en la lista" que invoque el flujo CREATE (`/crear-animal`) con el EID bastoneado precargado read-only, permitiendo el alta sin salir del modo masivo (al volver, la sesión sigue su curso).

**RD5.7** La `BulkTagAssignmentScreen` deberá operar 100% offline (la cola de sesión, las listas de candidatos y el encolado de asignaciones son todos locales; el RPC se resuelve al sincronizar). La pantalla NO deberá requerir red para asignar (DEC-2 — el caso de la manga es caravanear todo el rodeo sin señal).

### RD6. Manejo de dup/race — prevención client-side al bastonear (aterriza R8.4 / R11.5 / R12.2)

> **RECONCILIADO 2026-06-13 (decisión de leader, post-Run-3).** El as-built del canal de rechazos de sync (`connector.ts::surfaceUploadRejection`) es **solo `console.warn`** ("registro observable", R10.2) — NO hay copy al usuario, y `assign_tag_to_animal` no tiene overlay optimista (RD2.2, `animals` no es local) que al hacer rollback dé feedback visible (como sí pasa con el alta). Surfacear el rechazo *al sincronizar* exigiría un canal user-facing nuevo (PROHIBIDO por RD6.3, toca el core de sync). La defensa correcta es **prevenir el dup en el momento del bastoneo (client-side)**, no esperar el rechazo del sync.

**RD6.1 (prevención client-side del dup — defensa primaria)** Cuando se bastonea un EID en la masiva (opción B) o cuando el host BLE lo resuelve (opción A), el sistema deberá correr `lookupByTag` (lectura local, ya existente) **antes** de ofrecer la asignación. Si el EID ya resuelve a un animal existente en algún campo del usuario (`mode: 'edit'` o `'transfer'`) — es decir, ya tiene caravana — el sistema deberá mostrar un aviso accionable in-sesión ("ese TAG ya está asignado a otro animal — no se puede reasignar") **sin encolar nada** y dejar al operario listo para el siguiente bastoneo (sin perder progreso). En la opción A esto ya está cubierto por el motor (un EID con match no entra al modo `assign_or_create`, va a `edit`/`transfer`); la opción B debe replicar el chequeo por EID bastoneado.

> **AS-BUILT (Run 4, 2026-06-13)**: implementado en `app/app/asignar-caravanas.tsx::onTagRead` (ahora `async`): corre `lookupByTag` ANTES de `dispatch enqueue`; solo `mode:'create'` encola, `edit`/`transfer` muestran el `DupNoticeBanner` (reusa `Card`+`Button` de `FieldChangedNotice`, acento `$terracota`) sin encolar. Edge extra (no pedido por el EARS, agregado por robustez): un fallo de la lectura local → fail-CLOSED (banner "no pudimos verificar" + no encola). Test E2E de comportamiento en `dedup-screenshot.spec.ts`. Sin desviación del *qué* del EARS.

**RD6.2 (residual al sync = limitación documentada, NO un toast nuevo)** Un assign encolado que igualmente rebote al sincronizar (race: otro device caravaneó el MISMO animal entre la lectura local y el sync, `23514`; o dup cross-tenant no visible local, `23505`) es manejado por la maquinaria existente: `classifyIntentUploadError → permanent_reject → surfaceUploadRejection` (descarte + log observable), **sin un toast per-op al usuario** — igual que toda mutación encolada del app. La sesión NO se pierde (cada intent es independiente). El **race es auto-sanante** (el animal igual queda caravaneado por el device ganador → estado final correcto); el **dup cross-tenant de un RFID físico único es casi imposible** (la caravana es un objeto físico con ID único SENASA). Por eso el residual es negligible.

**RD6.3 (NO se inventa canal de sync nuevo)** El chunk NO agrega un canal user-facing de rechazos de sync (toca el core de sync, RD6.3 original). Un surfacing per-op de rechazos de sync encolados es **CROSS-CUTTING** (aplica a todas las mutaciones: alta, parto, baja, lote, asignación) → **diferido** a un item de backlog dedicado / spec 15 ("bandeja de rechazos de sync"). El copy nunca expone `sqlerrm` crudo. **LIM (limitación explícita del chunk)**: el operario no recibe un aviso per-op si un assign encolado rebota al sincronizar (caso negligible por RD6.2); lo cubre el log observable + el estado final auto-sanante.

### RD7. Multi-tenancy (aterriza R10.1 / R10.2 / R10.3)

**RD7.1** Todas las listas de candidatos (opción A y B) y el cómputo de "hay candidatos?" deberán scopearse exclusivamente al `establishment_id` activo del `EstablishmentContext` (filtro `noTag` ya scopeado por establishment en `buildAnimalsListQuery`).

**RD7.2** El RPC `assign_tag_to_animal` deberá ser la red de seguridad final del server: deriva el tenant de la fila real del perfil (RD1.2) y re-chequea `has_role_in` (RD1.3). El cliente nunca pasa el `establishment_id` ni el `animal_id` al RPC — solo el `p_profile_id` (cuyo tenant se deriva server-side). Esto cierra cualquier escape del scoping de cliente (consistente con la RLS de spec 02 R11, que el chunk consume sin agregar policies nuevas).

**RD7.3** Si el usuario cambia de establishment mientras la `BulkTagAssignmentScreen` está abierta, el sistema deberá re-escopear (o reiniciar) la sesión al nuevo establishment activo — no debe arrastrar candidatos del campo anterior. (Detalle de UX: lo resuelve el design; la invariante es: nunca mostrar candidatos de un campo que no es el activo.)

### RD8. Decisión "¿hay candidatos? → intermedia vs CREATE directo" (aterriza R3.3 BLE / R7.1)

**RD8.1** El sistema deberá tener una pieza de lógica de decisión testeable (unit) que, dado el resultado de `lookupByTag` = `mode:'create'` y el conteo de candidatos `noTag` del campo activo, decida: `≥1 candidato → modo assign_or_create` / `0 candidatos → modo create directo`. Esta lógica deberá ser pura (sin I/O) para unit-testearla sin DOM ni SDK (mismo patrón que `resolveTagLookup` del chunk BLE global).

**RD8.2** La decisión deberá ejecutarse íntegramente sobre datos locales (el conteo de candidatos es una lectura local más); NO deberá requerir red.

### RD9. Offline-first (aterriza R11.1 / R11.2 / R11.3 / R11.4)

**RD9.1** Todo el flujo de asignación (opción A intermedia, opción B masiva, cómputo de candidatos, buscador, encolado del `assign_tag_to_animal`) deberá funcionar sin red, leyendo/escribiendo contra PowerSync local (SQLite) + la outbox. La única dependencia externa es el bastón conectado por BLE (relación local, no internet — R11.3).

**RD9.2** El RPC `assign_tag_to_animal` se aplica al sincronizar; mientras tanto la asignación vive como `op_intent` en la outbox. La staleness del denorm local (`animal_tag_electronic` sigue NULL hasta el sync) se enmascara con la salida client-side del candidato de las listas de sesión (RD2.5).

**RD9.3** Si una asignación encolada falla al sincronizar (dup/race), el sistema deberá capturar el error de sync y surfacearlo accionablemente (RD6), consistente con R11.5 y con la "Cola de sync local" de spec 02 design.md.

---

## Tabla de mapeo RD → spec base (R7 / R8 / R12)

| RD del chunk | R de la spec base (09) | Qué aterriza |
|---|---|---|
| RD1 (RPC contrato + seguridad) | R7.4, R8.3, R12.1, R12.2 | El UPDATE `NULL→valor` server-side (antes "cliente directo"), con guard `IS NULL`, authz, idempotencia, formato. |
| RD2 (service offline) | R7.4, R8.3, R11.2, R11.5 | El encolado offline (outbox + RPC-mapping) + clasificación de errores de sync. |
| RD3 (modo `assign_or_create`) | R3.3 (BLE), R7.1, R7.2, R7.3, R7.5 | La intermedia opción A, ahora como modo del bottom-sheet; skip a CREATE si 0 candidatos. |
| RD4 (sesión del overlay) | R7.4, R10.1, R11.1 | Live-rescan, cambio de campo, cierre, navegación a ficha. |
| RD5 (`BulkTagAssignmentScreen`) | R8.1, R8.2, R8.3, R8.5, R8.6 | La pantalla masiva: cola, contador, 1×1, entry points, "es nuevo". |
| RD6 (race + dup) | R8.4, R11.5, R12.2 | Surfacing accionable sin perder sesión. |
| RD7 (multi-tenant) | R10.1, R10.2, R10.3 | Scoping client-side + red de seguridad del RPC. |
| RD8 (decisión candidatos) | R3.3 (BLE), R7.1 | La lógica pura "intermedia vs CREATE directo". |
| RD9 (offline-first) | R11.1, R11.2, R11.3, R11.4 | Todo el flujo offline; el RPC se aplica al sync. |
| — | R9 (opción C) | **Diferido** (post-MVP). NO se toca. |

---

## Criterios de aceptación del chunk

El chunk se considera implementado cuando:

- El RPC `assign_tag_to_animal` (migración ≥0089) está deployado (gated por Raf) y la suite backend node:test pasa: `NULL→valor` OK; `valor→valor` rebota (`23514`, trigger 0036); anti-IDOR (perfil de otro campo → `42501`/`23503`); rol sin acceso rechazado (`42501`); idempotencia por `client_op_id` (reintento = no-op); dup global (`23505`).
- Un bastoneo de EID **sin match** con ≥1 candidato sin caravana abre el modo `assign_or_create`: lista + buscador + "es nuevo" (RD3).
- Elegir un candidato → confirmar → `assignTagToAnimal` (offline) → ficha del animal con la caravana puesta al sincronizar (RD3.6).
- "Es un animal nuevo" → CREATE con el EID precargado read-only (RD3.7).
- Un bastoneo sin match con **0 candidatos** va directo a CREATE (RD3.2).
- La `BulkTagAssignmentScreen` (desde tab Animales filtro `noTag` + tab Más) permite bastonear N en serie, asignar 1×1, ver el contador, y cada candidato sale de la lista al asignar (RD5).
- Bastonear en la masiva un EID que YA tiene caravana (existe en algún campo del usuario) avisa in-sesión ("ese TAG ya está asignado") **sin encolar** y deja seguir (prevención client-side, RD6.1). El residual de rechazo al sync es negligible/auto-sanante + log observable (RD6.2, LIM).
- Todo el flujo funciona offline; el RPC se resuelve al sincronizar (RD9).
- E2E Playwright (bastón mock) cubre los 4 escenarios de §3.5 del Gate 0; `node scripts/check.mjs` verde end-to-end.

## Historial de refinamiento

- **2026-06-13 — Gate 1 PASS (0 HIGH) + fold de 2 MEDIUM (leader).** `security_spec_09resto-dedup.md` (Opus): el contrato del RPC es paridad fiel de `transfer_animal` 0087 / `register_birth` 0075 en los 7 controles; 0 HIGH. **DA-1 (idempotencia state-based) y DA-2 (authz cualquier rol activo) RATIFICADAS** (con condición de test en DA-1). 2 MEDIUM foldeados por el leader: **MED-1** (op_type del intent fijado a `assign_tag_to_animal` = nombre exacto del RPC, sin case especial frágil — RD2.2/RD2.3/design §2.1-§2.2 reconciliados con los tasks que ya lo usaban); **MED-2** (cita del índice `animals_tag_unique` unificada a 0019; `p_client_op_id` aclarado como passthrough que NO ancla la dedup — RD1.6/RD2.4 + replay = 2xx, sin case `idempotent_discard`). 2 LOW al backlog: rate-limit per-establishment a futuro (no exploitable hoy), audit granular del "quién asignó" (post-MVP, R12.4 cubre el "cuándo"). check.mjs verde.
- **2026-06-13 — Creación.** Folded de `context-09resto-dedup.md` (Gate 0 aprobado por Raf, Puerta 1) tras mapear el as-built real (chunk BLE global DONE: `FindOrCreateOverlay`, `lookupByTag`/`tag-lookup.ts`, `buildAnimalsListQuery({noTag})`; outbox+RPC-mapping de spec 15; RPC molde `transfer_animal` 0087 + `register_birth` 0075; trigger inmutabilidad 0036 (NULL→valor permitido) + denorm identidad 0079). Decisiones DEC-1..3 + defaults D-a..D-d tomadas como decididas. Divergencias con la spec base (intermedia = modo del sheet, UPDATE = RPC SECURITY DEFINER, skip-a-CREATE si 0 candidatos, authz cualquier rol activo) documentadas arriba. **Gate 1 SÍ aplica** (RPC nuevo); deploy gated. Numeración RD para no colisionar con la base; la reconciliación con `requirements.md` (notas AS-BUILT en R7/R8/R12) se agrega al foldear.

## DECISIONES ABIERTAS para el leader / Raf

> Huecos NO cubiertos explícitamente por el Gate 0 que el spec_author NO resuelve inventando (regla del proyecto). Ninguno es bloqueante para arrancar Gate 1 sobre el RPC; son detalles de UX/contrato a confirmar antes de cerrar el chunk.

- **DA-1 (mecanismo de idempotencia del RPC).** El Gate 0 §5 lockea "idempotencia por `p_client_op_id` (patrón register_birth 0075)", pero `register_birth` la implementa con una columna `client_op_id` + índice UNIQUE parcial sobre `reproductive_events`. Para `assign_tag_to_animal` no hay una fila propia donde colgar el `client_op_id` (el efecto es un UPDATE sobre `animals`, no un INSERT). El design §1 propone reconocer el replay por el **estado ya aplicado** (`animals.tag_electronic` ya = `p_tag_electronic` para ese animal → no-op idempotente, return OK) en vez de una columna nueva. ✅ **RESUELTA — state-based adoptado (leader + RATIFICADO por Gate 1, 2026-06-13)**: re-derivación del estado, sin columna `assignment_log` ni tabla de audit. Alinea con R12.4 base (el `updated_at` cubre el audit MVP; el audit granular es upgrade post-MVP). El `p_client_op_id` queda como passthrough (RD1.6). **Condición de Gate 1**: la suite backend distingue replay legítimo (TAG ya = el propio → `replay:true`) de dup global de otro animal (`23505`).

- **DA-2 (autorización D-d, "cualquier rol activo").** ✅ **RATIFICADA "cualquier rol activo" por Gate 1 (2026-06-13)**: el caller ya tiene rol activo en el campo (anti-IDOR + `has_role_in`); asignar caravana es CREATE-like, no una baja. Aterrizado en RD1.3. La consecuencia regulatoria (declaración SENASA) es del establishment, no diferencial por rol. Contexto histórico del por qué: asignar caravana es un acto con consecuencia regulatoria (declaración SENASA en 10 días hábiles). Si Gate 1 considera que debería ser owner-or-creator (como la baja en `transfer_animal`/`exit_animal_profile`), se endurece RD1.3 sin reabrir el resto del chunk. La asimetría con `transfer_animal` (que para la BAJA exige owner-or-creator) es intencional acá porque asignar caravana es CREATE-like (agregar dato), no una baja — pero conviene que Gate 1 lo valide explícitamente.

- **DA-3 (re-escopeo de sesión en la masiva ante cambio de campo).** RD7.3 fija la invariante (nunca mostrar candidatos del campo no-activo) pero deja el detalle de UX al design (¿reiniciar la cola? ¿avisar al operario? ¿bloquear el switch mientras hay sesión activa?). El Gate 0 no lo cubre — es un edge raro (cambiar de campo en medio de una sesión de caravaneo). ✅ **RESUELTA (leader, 2026-06-13)**: se acepta el default — reiniciar la sesión de la masiva al nuevo campo + aviso al operario. Invariante dura (RD7.3): nunca candidatos del campo no-activo. El detalle visual lo veta el design-review al implementar. No bloquea el camino feliz.
