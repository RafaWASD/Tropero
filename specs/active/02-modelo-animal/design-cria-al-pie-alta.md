# Spec 02 — Delta VINCULAR LA CRÍA AL PIE (#15) — Design

**Status**: `spec_ready` · Delta **Nivel B (ADR-028)**, CON BACKEND · Gate 1 **OBLIGATORIO**.
**Fuente de verdad**: `context-cria-al-pie-alta.md`. **Requirements**: `requirements-cria-al-pie-alta.md` (`RCAP.<n>`).
**Deploy**: la migración la **aplica el leader** por Management API tras Gate 1 PASS + Gate 2 + reviewer. **Raf ya autorizó el deploy** (Gate 0). Hasta entonces las suites nuevas FALLAN (función inexistente, `PGRST202`) — ESPERADO (patrón `0075`–`0089`).

> Multi-tenancy: este delta toca tablas con `establishment_id` (`animal_profiles`, `birth_calves` deriva su tenant de la madre) y crea una RPC SECURITY DEFINER que deriva tenants de filas reales → **RLS / anti-IDOR es central** (ver §2, §6).
> Offline-first: la carga ocurre en el campo, sin señal → **todo el flujo es offline-safe** vía la outbox de PowerSync (ver §4).

---

## 1. Archivos a crear / modificar

### Backend (migraciones nuevas — NO se aplican desde el repo)
- **CREAR** `supabase/migrations/0114_link_calf_to_mother_rpc.sql` — RPC `link_calf_to_mother` (vincular ternero EXISTENTE). Reusa la columna `reproductive_events.client_op_id` + el índice `reproductive_events_client_op_id_uq` (ambos de `0075`), `birth_calves` (`0045`) y sus triggers (`0046` categoría de la madre, `0067` nursing). **No crea tablas, columnas, índices ni policies nuevas.**
- **CREAR** `supabase/migrations/0115_register_birth_calf_rodeo.sql` — `register_birth` extendido a la firma 6-arg `(uuid,date,jsonb,uuid,uuid,text)` con `p_calf_rodeo_id` + `p_calf_idv` (DROP firma vieja 4-arg + CREATE 6-arg, atómico). **No crea tablas/columnas/policies.** ⚠ **SUPERSEDED por `0116`** (ver abajo): `0115` se moldeó sobre `0075` y borró la herencia de `breed_id` de `0109`.
- **CREAR** `supabase/migrations/0116_register_birth_breed_id_fix.sql` *(fix Gate 2 HIGH)* — `CREATE OR REPLACE` de `register_birth` (6-arg) que **restaura la herencia de `breed_id`** de la madre al ternero (cuerpo de `0109` R1.7 + extensiones de `0115`). Aplicada tras `0115`. Verificada con la suite SIGSA + animal (200/200).

### Backend (tests)
- **CREAR/EXTENDER** `supabase/tests/animal/run.cjs` (suite `link_calf_to_mother` + casos de `register_birth` con rodeo) — happy, re-link, cross-tenant, anti-IDOR, idempotencia, rodeo NULL/válido/ajeno (RCAP.10).

### Frontend (servicios)
- **MODIFICAR** `app/src/services/events.ts` — `registerBirth`: agregar `calfRodeoId?: string | null` opcional a `RegisterBirthInput`; pasarlo a `p_calf_rodeo_id` en los params + usarlo como `rodeoId` del overlay del ternero (cuando se provee). Agregar `linkCalfToMother(motherProfileId, calfProfileId, eventDate)` (thin sobre la outbox).
- **MODIFICAR** `app/src/services/powersync/outbox.ts` — `enqueueLinkCalfToMother`: intent `op_type='link_calf_to_mother'` (= nombre EXACTO de la RPC, fold MED-1) + overlay `pending_reproductive_events`(birth de la madre) + `pending_birth_calves`(evento ↔ `calfProfileId` existente). Sin `pending_animals`/`pending_animal_profiles`.
- **MODIFICAR** `app/src/services/powersync/upload.ts` — agregar `'link_calf_to_mother'` al set `RPC_OP_TYPES`, a la lista de op_types que reciben `p_client_op_id` (junto a `register_birth`/`assign_tag_to_animal`), **Y a la rama `idempotent_discard` del `23505` (`upload.ts:212`, fold Gate 1 MED-2)**: hoy esa clasificación es `register_birth`-only → sin agregar `link_calf_to_mother`, un `23505` concurrente del link (índice único compuesto `client_op_id`) caería a `permanent_reject` (rollback + error espurio) pese a haberse aplicado server-side, reabriendo el MED-1 de `0075`. Con el fix, el `23505` del link se descarta como idempotente (el efecto ya está).

### Frontend (UI)
- **CREAR** `app/src/components/LinkCalfPrompt.tsx` *(as-built: componente "smart" en `src/components` + export del barrel `index.ts`, NO en `app/app/crear-animal/_components/` — precedente `BleConnectionChip` que consume servicios; el reviewer lo validó contra `architecture.md`)* — el prompt saltable + el mini-form de creación (sexo/fecha/rodeo). Reusa `lookupByTag`/`searchAnimals` (spec 09), `fetchMother` (events.ts), las utils de fecha del alta (`animal-birth-year.ts`) y el selector de rodeo inline alimentado por `useRodeo()` (no hay un `RodeoPicker` componente standalone). La clasificación EID/IDV usa un helper PURO dedicado **`app/src/utils/link-calf-query.ts`** (`classifyCalfQuery`), NO `classifyIdentifier` — ver §5.
- **MODIFICAR** `app/app/crear-animal.tsx` — tras `createAnimal` ok + eventos post-create (en el happy-path, `softFails===0`), si `showNursing && nursing===true` mostrar el prompt antes de navegar (refactor de la navegación post-create a `navigateAfterCreate(profileId)` como fuente única; el prompt se monta al root y `finishLinkPrompt` navega por la rama normal tras "Ahora no"/éxito).

### Frontend (tests)
- **EXTENDER** `app/e2e/animals.spec.ts` (o suite nueva) — prompt solo con cría al pie, skip, vincular existente, crear+vincular con rodeo editable, aviso "ya tiene madre". + tests unitarios de `enqueueLinkCalfToMother`/`mapIntentToRpc` en los `*.test.ts` correspondientes.

---

## 2. Backend — `link_calf_to_mother` (0114) · firma y guards

**Firma**: `link_calf_to_mother(p_mother_profile_id uuid, p_calf_profile_id uuid, p_event_date date, p_client_op_id uuid default null) returns jsonb` · `language plpgsql security definer set search_path = public`.
*(El `p_client_op_id` se suma a la firma sugerida por el Gate 0 porque la idempotencia at-least-once de la outbox lo requiere — el evento de parto lleva id server-side, igual que `register_birth`/`0075`. El mapeo de upload lo inyecta = `op_intents.id`.)*

**Orden de operaciones (NO conmutable — molde `0089`/`0075`/`0087`):**

1. **(a) Derivar la madre de su fila REAL** (`animal_profiles` join `animals`/`rodeos`): `establishment_id` (`v_est`), `rodeo system_id`, `species_id`. `where id = p_mother_profile_id and deleted_at is null` (perfil activo). `v_est is null` → `raise 23503 'mother not found'` (RCAP.6.2).
2. **(b) AUTHZ sobre el tenant DERIVADO**: `if not has_role_in(v_est) then raise 42501` (RCAP.6.3). El cliente NUNCA pasa `establishment_id`.
3. **(c) Guard ternero ≠ madre**: `if p_calf_profile_id = p_mother_profile_id then raise 23514` (RCAP.6.5).
4. **(d) Derivar el ternero scopeado al tenant de la madre** (anti-oráculo) **+ `FOR UPDATE`** (fold Gate 1 MED-1, anti-TOCTOU): `select establishment_id, animal_id, species_id from animal_profiles p join animals a … where p.id = p_calf_profile_id and p.establishment_id = v_est and p.status='active' and p.deleted_at is null **for update of p**`. El `FOR UPDATE` toma el row-lock de la fila del ternero ANTES del guard de re-vínculo (paso f) → dos `link_calf_to_mother` concurrentes del MISMO ternero (a dos madres del mismo campo) se serializan: el segundo espera, ve el `birth_calves` del primero y aborta con `23514`. Cierra el TOCTOU del check-then-insert (no hay unique sobre `birth_calves.calf_profile_id`). Vacío → `raise 23503 'calf not found in this establishment'` — **mismo error** para "no existe" y "existe en otro tenant" (sin oráculo cross-tenant, RCAP.6.4). *(Defensa adicional: validar `species_id` del ternero = de la madre → `23514`; ver §Decisiones de criterio propio.)*
5. **(e) Guard de idempotencia SCOPEADO (replay)** — copia exacta del patrón `0075:106`. Solo si `p_client_op_id is not null`:
   ```sql
   select re.id into v_existing
   from reproductive_events re
   join animal_profiles p on p.id = re.animal_profile_id
   where re.client_op_id = p_client_op_id
     and re.animal_profile_id = p_mother_profile_id   -- misma madre que el intent
     and p.establishment_id = v_est                   -- y del tenant ya autorizado
     and re.deleted_at is null
   limit 1;
   if v_existing is not null then
     return jsonb_build_object('birth_event_id', v_existing, 'replay', true);  -- no-op idempotente
   end if;
   ```
   *(Corre DESPUÉS de has_role_in; anclado en `animal_profile_id` de la madre → sin lookup global por `client_op_id` → sin oráculo cross-tenant, RCAP.6.7.)*
6. **(f) Guard "ternero ya tiene madre"** — DESPUÉS del replay (para no falsear un replay legítimo):
   ```sql
   if exists (
     select 1 from birth_calves bc
     join reproductive_events re on re.id = bc.birth_event_id
     where bc.calf_profile_id = p_calf_profile_id and re.deleted_at is null
   ) then raise 23514 'calf already linked to a mother'; end if;   -- RCAP.6.6
   ```
7. **(g) Insertar el evento de parto** con `client_op_id` (defensa-en-profundidad por el índice compuesto `reproductive_events_client_op_id_uq`, RCAP.6.8):
   ```sql
   insert into reproductive_events (animal_profile_id, event_type, event_date, client_op_id)
   values (p_mother_profile_id, 'birth', p_event_date, p_client_op_id)
   returning id into v_birth_event_id;
   ```
8. **(h) Insertar la fila puente** con el `calf_profile_id` EXISTENTE:
   ```sql
   insert into birth_calves (birth_event_id, calf_profile_id)
   values (v_birth_event_id, p_calf_profile_id);
   ```
   → dispara `0067` (nursing de la madre → `true`) y `0046` (recompute de categoría de la madre).
9. `return jsonb_build_object('birth_event_id', v_birth_event_id, 'replay', false);`

**Cierre de superficie (RCAP.6.9):** `revoke execute on function … (uuid,uuid,date,uuid) from public, anon; grant … to authenticated;` + smoke-check fail-closed (`do $$ … has_function_privilege … raise if EXECUTE-able by anon/public … $$`, patrón `0087:279`) + `notify pgrst, 'reload schema'`. Función NUEVA → no hay firma vieja que dropear ni grant colgando.

**`birth_calves` (RLS, RCAP.6.10):** se conserva intacta de `0045`. La policy `birth_calves_select` deriva el tenant de la madre (`establishment_of_profile(re.animal_profile_id)`) y filtra `re.deleted_at is null`. **NO** hay `GRANT INSERT` para `authenticated` → la fila la inserta solo el DEFINER (la nueva RPC se suma a `register_birth` y al trigger mono-ternero como poblador autorizado). El cliente no puede fabricar parentescos por PostgREST. Sin policy nueva.

## 3. Backend — `register_birth` extendido (0115) · rodeo del ternero

Molde **`0109`** (no `0075` — ver ⚠ abajo) + DROP/CREATE atómico de `0075:62`. Firma nueva **6-arg**: `register_birth(p_mother_profile_id uuid, p_event_date date, p_calves jsonb, p_client_op_id uuid default null, p_calf_rodeo_id uuid default null, p_calf_idv text default null)`.

> ⚠ **Fix Gate 2 HIGH (`0116`)**: `0115` se moldeó por error sobre `0075` (firma 4-arg, **pre-`0109`**) → su `DROP+CREATE` **borró la herencia de `animal_profiles.breed_id`** de la madre al ternero que `0109` había agregado (SIGSA R1.7) → terneros con `breed_id` NULL. `0116` (`CREATE OR REPLACE` de la 6-arg) lo corrige: combina el cuerpo de `0109` (lee `p.breed_id` en el SELECT de auth + lo escribe en el INSERT de `animal_profiles` de cada ternero) con las extensiones de `0115` (rodeo/idv/caps). El diseño correcto de `register_birth` es el de `0116`. Verificado: SIGSA `T3 R1.7` + animal `#15` = 200/200.

Cambios respecto de `0075`:
- Tras derivar la madre (`v_est`, `v_rodeo_id` = rodeo de la madre, `v_system_id`), resolver el **rodeo efectivo del ternero**:
  ```sql
  if p_calf_rodeo_id is null then
    v_calf_rodeo_id := v_rodeo_id;                    -- comportamiento as-built (RCAP.7.2)
  else
    select r.system_id into v_calf_rodeo_system
    from rodeos r
    where r.id = p_calf_rodeo_id and r.establishment_id = v_est
      and r.active = true and r.deleted_at is null;   -- en el tenant de la MADRE (anti-IDOR)
    if v_calf_rodeo_system is null then raise 23514 'calf rodeo not found / inactive / other tenant'; end if;
    if v_calf_rodeo_system is distinct from v_system_id then raise 23514 'calf rodeo of a different system'; end if;
    v_calf_rodeo_id := p_calf_rodeo_id;               -- RCAP.7.3 / RCAP.7.4
  end if;
  ```
  *(Validación calcada de `transfer_animal` `0087:115` — rodeo activo, del tenant derivado, mismo sistema.)*
- El loop de terneros usa `v_calf_rodeo_id` en lugar de `v_rodeo_id` para el `rodeo_id` del perfil. La categoría se resuelve con `v_system_id` (mismo sistema garantizado por la validación) → `categories_by_system` válida.
- Todo lo demás (herencia de tenant `v_est`, atomicidad, idempotencia `p_client_op_id`) **sin cambios**.

**Cierre (RCAP.7.5):** `revoke … (uuid,date,jsonb,uuid,uuid,text) from public, anon; grant … to authenticated;` + `notify pgrst` (firma 6-arg). La firma vieja 4-arg se dropeó → sin grant colgando. **El parto normal (3 args online / 4 args con client_op_id) sigue resolviendo por los defaults** → callers inalterados. **Además (`0116`, R1.7): hereda `breed_id` de la madre al ternero** — el SELECT de auth lee `p.breed_id` y el INSERT de `animal_profiles` lo escribe (`v_mother_breed_id`).

## 4. Offline-first (PowerSync)

| Camino | Intent (op_intents) | Overlay optimista | RPC al subir |
|---|---|---|---|
| **Vincular existente** (RCAP.3) | `link_calf_to_mother` { p_mother_profile_id, p_calf_profile_id, p_event_date } | `pending_reproductive_events`(birth, madre) + `pending_birth_calves`(evento ↔ calf existente) | `link_calf_to_mother(...,p_client_op_id=op.id)` |
| **Crear + vincular** (RCAP.4) | `register_birth` { p_mother_profile_id, p_event_date, p_calves:[1], p_calf_rodeo_id } | el del parto existente (`enqueueRegisterBirth`): pending evento + pending ternero (animal/profile/birth_calf) en el rodeo elegido | `register_birth(...,p_client_op_id=op.id)` |

- **Idempotencia** (RCAP.8.2/8.3): `mapIntentToRpc` inyecta `p_client_op_id = op.id` para `link_calf_to_mother` (igual que `register_birth`). Reintento at-least-once → guard de replay (§2.e) → `2xx` `{replay:true}`, ACK normal, sin error.
- **Orden FIFO** (RCAP.8.4): si la vaca se creó offline en la misma sesión, su intent `create_animal` se encoló antes → drena antes → la madre existe server-side cuando corre `link_calf_to_mother`. Para el camino CREATE no hay acoplamiento (un solo intent `register_birth` que crea+linkea atómico).
- **Clasificación de rechazos** (RCAP.8.5): el default del clasificador de `uploadData` marca `permanent_reject` los errores de dominio (`23503`/`23514`/`42501`/`23505`) → surface accionable, sin loop; el replay devuelve `2xx` (no es error). La vaca, ya creada, no se pierde.
- **`birth_calves` en el SQLite local**: ya está en el sync set (lo usa `fetchMother` local, events.ts:230). El overlay `pending_birth_calves` ya existe (lo usa `enqueueRegisterBirth`, outbox.ts:330) → reusable tal cual con el `calfProfileId` existente.

## 5. Frontend — flujo del prompt

Disparo en `crear-animal.tsx` tras `createAnimal` ok (profileId de la madre = id de cliente, disponible offline) + eventos post-create. Si `nursing===true` (showNursing) → render del prompt; si no → navegación actual.

```
[Prompt: "¿Vincular su cría al pie?"]   (máquina de 3 fases: ask → found → create)
  ├─ "Ahora no" ──────────────────────────→ navegar a la ficha de la vaca (vaca queda nursing=true)
  └─ caravana del ternero (EID|IDV) → classifyCalfQuery   (as-built: helper PURO dedicado, NO classifyIdentifier)
        ├─ vacío / <3 díg / no-numérico → error inline, NO dispara el find-or-create (RCAP.2.5)
        ├─ EID  (15 díg puros)          → lookupByTag(tag, est)
        └─ IDV  (≥3 díg, ≠15)           → searchAnimals(est, idv)
        ┌─ ENCONTRADO (exactamente 1) en campo activo → fetchMother(calf)
        │     ├─ tiene madre → aviso "ya tiene una madre registrada", no re-vincular (RCAP.3.3)
        │     └─ sin madre   → fase `found` → "Vincular" → linkCalfToMother(madre, calf, eventDate = calfBirthDate ?? hoy)
        ├─ ENCONTRADO en OTRO campo (lookupByTag mode `transfer`) → aviso "está en otro campo" (RCAP.3.4)
        ├─ >1 MATCH (ambiguo, searchAnimals) → aviso "Encontramos varios…", no adivina cuál (guard as-built, honra RCAP.2.3 "exactamente uno")
        └─ NO ENCONTRADO → fase `create` → mini-form [sexo* | fecha opc. | rodeo] (la caravana tipeada YA está, no se re-pide)
              rodeo = selector inline (rodeos de useRodeo() del campo, MISMO sistema), preseleccionado=rodeo madre,
                      leyenda "(Mismo rodeo que la madre)" si coincide
              "Crear y vincular" → registerBirth(madre, [{sex, birthDate?, caravana tipeada}], calfRodeoId)
  └─ "← Cambiar caravana" (as-built, control & freedom Nielsen #3): disponible en fases `found`/`create` →
        vuelve a `ask` CONSERVANDO lo tipeado (un mistype en la manga no debe forzar abandonar ni crear un ternero bogus)

**Fold Gate 1 LOW-1 (la caravana tipeada DEBE fluir al ternero creado):** la caravana que el usuario tipeó para
buscar (y que NO se encontró) es la del ternero al pie → se usa al CREAR. **EID** → `calf_tag_electronic` (ya
soportado por `register_birth`). **IDV** → como `register_birth` hoy no toma `idv` del ternero, se agrega
`p_calf_idv text default null` a la extensión `0115` (junto a `p_calf_rodeo_id`; setea `animal_profiles.idv` del
ternero con la misma validación de unicidad/inmutabilidad ya vigente, NULL → comportamiento as-built). Así el
ternero nuevo nace con la caravana que ingresó el operario, sin un segundo paso de asignación.
```

Reusos: `classifyIdentifier`/`classifySearchQuery` (animal-identifier.ts), `lookupByTag`/`findOrCreateLookup` (animals.ts), `fetchMother` (events.ts), `RodeoPicker` + `buildRodeo*Query`, utils de fecha del alta (`animal-birth-year.ts`, incl. el DD/MM del delta `alta-form-refinamiento`). MUSTs de forms (RCAP.9): tokens, anti-recorte, validación inline, es-AR.

## 6. Seguridad (resumen para Gate 1)

- **Anti-IDOR / cross-tenant**: ambos RPCs derivan el tenant de las filas REALES (madre y ternero), nunca del payload; el ternero se deriva **scopeado al tenant de la madre** → sin oráculo de existencia cross-tenant (mismo `23503` para no-existe y otro-tenant).
- **AuthZ**: `has_role_in(v_est)` (cualquier rol activo, paridad con `register_birth`/`create_animal`) sobre el tenant derivado.
- **Re-link**: un ternero solo puede tener una madre — guard `birth_calves` (`23514`), ordenado tras el replay para no romper la idempotencia.
- **Idempotencia sin oráculo**: replay scopeado a (madre, `client_op_id`, tenant) + índice único compuesto `(animal_profile_id, client_op_id)` (no global) — hereda el fix HIGH-D1 de `0075`.
- **Superficie**: `SECURITY DEFINER` + `search_path` fijo + `revoke public/anon` + `grant authenticated` + smoke-check fail-closed. `birth_calves` sigue sin `INSERT` para clientes.

## 7. Alternativas descartadas

1. **Extender `register_birth` para que acepte un `calf_profile_id` EXISTENTE (un solo RPC para todo).** Descartada: rompería la firma probada y la semántica de `register_birth` ("crea terneros nuevos") mezclando dos contratos (crear vs vincular) → más superficie de regresión en una RPC ya gateada/testeada. Preferimos un **RPC nuevo** (`link_calf_to_mother`) para el camino existente — recomendación explícita del Gate 0.
2. **Camino CREATE vía `createAnimal` (alta normal) + `link_calf_to_mother`** (un solo RPC nuevo, sin tocar `register_birth`). Descartada porque: (a) contradice la decisión del contexto "crear vía `register_birth`"; (b) parte el create+link en **dos** transacciones/intents (ventana en que el ternero existe sin vínculo) vs la atomicidad de `register_birth`; (c) `register_birth` setea `entry_origin='born_here'` (correcto para SIGSA en un ternero nacido en el campo), que el alta normal no garantiza. La extensión backward-compatible de `register_birth` (0115) honra ambas decisiones del contexto sin perder atomicidad.
3. **Rodeo del ternero NO editable (siempre el de la madre, `register_birth` sin tocar).** Descartada: viola la decisión cerrada #1 del contexto (picker editable). Menor backend, pero pierde una decisión explícita de Raf.

## 8. Decisiones de criterio propio (a confirmar en Puerta 1)

1. **`register_birth` se extiende (0115) — DB adicional al RPC único previsto.** El Gate 0 previó "un RPC nuevo"; para honrar a la vez "crear vía `register_birth`" **y** "rodeo editable" (ambas cerradas) sin romper la firma probada, se agrega `p_calf_rodeo_id` opcional (default NULL → comportamiento idéntico), patrón backward-compatible de `0075`. **Es la única pieza de DB más allá del RPC nuevo.** Si Raf prefiere menos backend, la alternativa #2 (createAnimal+link) o #3 (rodeo no editable) están listas para sustituir.
2. **`p_client_op_id` en `link_calf_to_mother`** (no en la firma sugerida por el Gate 0): necesario para la idempotencia at-least-once de la outbox (el evento de parto lleva id server-side). Lo pide el propio contexto ("idempotencia patrón client_op_id").
3. **Fecha del evento de vínculo = fecha de nacimiento del ternero ?? hoy** (RCAP.3.2): el `reproductive_events` de parto representa cuándo parió la madre; usar la fecha de nacimiento conocida del ternero la fecha mejor, cayendo a hoy si no se conoce.
4. **Guard de especie (ternero = especie de la madre) en `link_calf_to_mother`** (`23514`): defensa-en-profundidad no pedida por el contexto (no se puede ligar un potrillo a una vaca). Barata y correcta; confirmable.
5. **Consecuencia diseñada — el vínculo registra un parto en la madre**: `link_calf_to_mother`/`register_birth` crean un `reproductive_events`(birth) → la madre cuenta **un parto** (recompute de categoría por `0046`, respetando `category_override`) y queda `nursing=true` (`0067`). Es el mismo mecanismo que el parto normal y es semánticamente correcto (la vaca con cría al pie **parió**). Documentado para que no sorprenda en Puerta 2.
6. **No auto-mover el rodeo del ternero existente** (RCAP.5.5): confirmado como default del contexto ("No entra").

## 9. Gate 1 — veredicto + hardenings foldeados (2026-06-30)

**Gate 1 (security_analyzer, modo spec): PASS, 0 HIGH** (`progress/security_spec_02-cria-al-pie-alta.md`). Todas las afirmaciones de seguridad verificadas contra el SQL as-built (`0045`/`0075`/`0087`/`0067`). Foldeados antes de implementar:
- **MED-1 (TOCTOU del re-link)** → `FOR UPDATE` sobre la fila del ternero en el paso (d) (ver §2.d). Serializa links concurrentes del mismo ternero; cierra la ventana check-then-insert (no hay unique en `birth_calves.calf_profile_id`).
- **MED-2 (clasificación `23505`)** → `link_calf_to_mother` se agrega a la rama `idempotent_discard` de `upload.ts:212` (ver §1). Evita el `permanent_reject` espurio en el reintento concurrente del link.
- **LOW-1 (caravana al CREATE)** → la caravana tipeada fluye al ternero: EID→`calf_tag_electronic`; IDV→nuevo `p_calf_idv` en `0115` (ver §5).
- **LOW-2 (cap de `calf_tag_electronic`)** → en `0115`, agregar `check char_length` autoritativo al tag del ternero (oportunidad barata pre-existente; el tag es 15 díg FDX-B → cap exacto).
- **LOW-3 (rango de `p_event_date`)** → cota server-side en ambos RPC (`1900 ≤ year ≤ current+1`, no-futura razonable), patrón `0105` `p_year`.

Estos folds NO cambian la superficie aprobada (mismo-tenant, sin schema/policy nuevos más allá de los params opcionales declarados); el implementer los aplica en `0114`/`0115`/`upload.ts`. RCAP afectados: 6.6/6.8 (MED-1), 8.3/8.5 (MED-2), 2.4/4/7 (LOW-1), 7.x (LOW-2/3).
