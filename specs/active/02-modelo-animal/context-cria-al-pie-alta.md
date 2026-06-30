# Contexto (Gate 0) — Vincular la cría al pie al dar de alta una vaca (#15)

> Delta Nivel B (ADR-028) sobre spec 02 — **con backend** (toca DB: mecanismo nuevo para vincular un ternero
> EXISTENTE a una madre). Gate 1 aplica. **Deploy AUTORIZADO por Raf (2026-06-30)**: primero el backend, después
> el frontend. Origen: corrección #15 del testeo en vivo (`docs/correcciones-prueba-en-vivo-2026-06-27.md`).
> Es la primera pieza del segmento A (cluster ternero); el resto de A (#1a parto, #4 rodeo al parto, #7 madre→
> crías + peso destete) queda aparte.

## Contexto validado (as-built)

- En el alta (`crear-animal.tsx`), para vacas de 2º servicio/multípara hay un campo **"con cría al pie / sin
  cría al pie"** que solo setea `animal_profiles.nursing` (boolean). **No hay acción post-create**: no pide la
  caravana del ternero, no lo vincula, no ofrece crearlo (R15 hoy es un boolean muerto).
- **`register_birth(p_mother_profile_id, p_event_date, p_calves jsonb)`** (`0045_birth_calves.sql:188`,
  idempotente `0075`): **solo CREA terneros nuevos** (perfil provisional + animal + fila `birth_calves` que
  linkea el evento de parto con el calf). `p_calves` = `[{calf_sex, calf_weight?, calf_tag_electronic?}]`.
  **NO acepta un `calf_profile_id` existente** → no hay forma hoy de vincular un ternero YA cargado.
- `birth_calves` (`0045`): PK `(birth_event_id, calf_profile_id)`, linkea un evento `reproductive_events`
  (event_type='birth') con N perfiles de ternero. `fetchMother` (events.ts) resuelve ternero→madre por acá.
- Find-or-create / lookup de caravana: existe (`lookupByTag`, `assignTagToAnimal`, el motor del alta de spec 09)
  — reusable para buscar el ternero por su caravana.

## Alcance

**Entra:**
1. **Backend (DB, Gate 1, deploy autorizado)**: mecanismo para **vincular un ternero EXISTENTE** a una madre —
   un RPC nuevo (ej. `link_calf_to_mother(p_mother_profile_id, p_calf_profile_id, p_event_date)`) que inserta el
   `reproductive_events` (birth) + la fila `birth_calves` con el `calf_profile_id` existente, idempotente y con
   guards (mismo establecimiento, anti-IDOR, ambos perfiles del tenant del usuario, el calf no ya-linkeado a
   otra madre). El spec_author decide RPC nuevo vs extender `register_birth` (preferido: RPC nuevo, no romper la
   firma probada de register_birth).
2. **Frontend**: tras crear la vaca con **cría al pie** (nursing=true), prompt **saltable** "¿Vincular su cría
   al pie?" → pedir la **caravana del ternero** (IDV o electrónica) → **find-or-create**:
   - **Encontrado** (ternero ya en el sistema) → vincular vía el RPC nuevo.
   - **No encontrado** → ofrecer **crear** el ternero (sexo requerido + fecha de nac. opcional + rodeo) → vía
     `register_birth` (crea + linkea).
3. **Rodeo del ternero (para el CREATE)**: un **picker** con el rodeo de la madre **preseleccionado** + leyenda
   **"(Mismo rodeo que la madre)"**. Editable a otro rodeo del campo.

**No entra:**
- El resto del cluster ternero A (#1a caravana visual del ternero en el parto, #4 rodeo al parto, #7 madre→crías
  al pie + destete + peso de destete). Quedan para sus deltas (peso destete necesita a Facundo).
- Mover de rodeo a un ternero **existente** al vincularlo: NO se auto-mueve (el ternero existente conserva su
  rodeo; el picker de rodeo aplica solo al CREATE de un ternero nuevo). (Decisión menor del leader — confirmable.)

## Casos y decisiones (cerradas con Raf, 2026-06-30)

1. **Rodeo del ternero (create)**: picker con el de la madre **preseleccionado** + leyenda "(Mismo rodeo que la
   madre)"; editable. (Raf)
2. **Alcance**: se hacen **ambos** caminos (crear-nuevo + vincular-existente). El backend (vincular-existente)
   PRIMERO, después el frontend. Deploy autorizado. (Raf)
3. **Datos del prompt**: caravana (IDV o electrónica) + **sexo** (requerido para crear) + **fecha de nacimiento
   opcional**. (Raf)
4. **Saltable**: el prompt aparece pero se puede decir "ahora no" → la vaca queda con cría al pie (nursing=true)
   y se vincula después (la vaca ya existe, no se re-crea). (Raf)
5. **Find-or-create del ternero**: reusa el lookup de caravana existente (`lookupByTag` / motor de spec 09). Si
   la caravana del ternero ya existe → es el ternero a vincular; si no → crear.

**Edge cases a resolver en la spec:**
- Ternero encontrado que **ya tiene madre** (otra) → ¿bloquear / avisar? (default: avisar, no re-vincular —
  un ternero tiene una sola madre biológica).
- Ternero encontrado que **es macho/hembra** — ambos válidos como cría al pie.
- Vaca creada **offline** → el prompt + el find-or-create + el link deben ser offline-safe (overlay + RPC al
  subir, mismo patrón que el alta y register_birth).
- "Mellizos al pie" (poco común) → MVP: 1 cría al pie por prompt; el resto se agrega después (no bloquear).

## Pendientes (CONTEXT/07)
- Ninguno nuevo bloqueante (peso de destete es de #7, otro delta).

## Insumos para spec_author
- `supabase/migrations/0045_birth_calves.sql` (register_birth + birth_calves + RLS), `0075` (idempotencia),
  `0067` (trigger nursing/birth_calves), `0087_transfer_animal_rpc.sql` (patrón de RPC con guards anti-IDOR
  reusable), `0083_create_animal_rpc.sql` (patrón de create atómico). `app/src/services/powersync/outbox.ts`
  (`enqueueRegisterBirth` ~309), `app/app/crear-animal.tsx` (cría al pie ~1240, post-create soft-fail ~517),
  `app/src/services/animals.ts` (`lookupByTag`/find-or-create), `events.ts` (`fetchMother`).
- ADR-028 (delta-spec), ADR-004/005 (identidad), ADR-026 (sync), ADR-017 (eventos).
- **Gate 1 OBLIGATORIO** (RPC nuevo + RLS + birth_calves). El RPC nuevo debe: SECURITY DEFINER, derivar tenant
  de las filas reales (anti-IDOR, patrón 0087/0041), `has_role_in` del establecimiento, validar que ambos
  perfiles son del mismo tenant, idempotencia por client_op_id (patrón outbox), y rechazar re-vincular un calf
  que ya tiene madre. Migración ≥0114 (as-built llega a 0113).

## Aprobación
- **Puerta 0 — APROBADA por Raf (2026-06-30)** vía sus 3 decisiones + "ok". Deploy de la migración autorizado
  (primero backend, después frontend).
