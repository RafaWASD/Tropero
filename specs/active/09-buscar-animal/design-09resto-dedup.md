# Spec 09 — chunk "09 resto · dedup A/B (asignación de caravana)" — Design

**Status**: spec aprobada (Puerta de spec por Raf) + Gate 1 PASS sobre el RPC (0 HIGH) + RPC 0089 deployado; implementación done (Runs 1-4: backend + UI A + UI B + E2E formal). Reviewer + Gate 2 + Puerta 2 = del leader. AS-BUILT reconciliado en §3.6/§4.5/§5.
**Fecha**: 2026-06-13 (sesión 25).
**Requirements**: `requirements-09resto-dedup.md` (RD1..RD9). Insumo primario: `context-09resto-dedup.md` (Gate 0 aprobado, §5 sketch del RPC).
**Reconciliación**: este design describe el cableado contra el **as-built real** (chunk BLE global DONE + outbox/RPC-mapping de spec 15 + RPC molde de spec 11). NO contra el `design.md` base de 2026-05-26 (que asume `app/src/features/animals/` — estructura que NO existe; ver §1 del design del chunk BLE global).

> **Nota Gate 1**: §1 (el contrato del RPC) está escrita para ser la superficie de seguridad que el `security_analyzer` (modo spec) audita. Cada control de seguridad está marcado y justificado contra su molde as-built (`transfer_animal` 0087, `register_birth` 0075, trigger 0036, denorm 0079).

---

## 1. Contrato del RPC `assign_tag_to_animal` (migración ≥0089, SECURITY DEFINER) — superficie de Gate 1

### 1.1 Firma y semántica

```
assign_tag_to_animal(
  p_profile_id      uuid,   -- perfil ACTIVO del animal al que se le asigna la caravana (lo conoce el cliente)
  p_tag_electronic  text,   -- EID de 15 díg FDX-B bastoneado
  p_client_op_id    uuid    -- clave de idempotencia del cliente (= op_intents.id; reintento del outbox = no-op)
) returns jsonb              -- { animal_id, profile_id, tag_electronic, replay }
language plpgsql security definer
set search_path = public
```

Efecto único: `UPDATE animals SET tag_electronic = p_tag_electronic WHERE id = <animal_id derivado de la fila real> AND tag_electronic IS NULL`. El trigger `tg_propagate_animal_identity_to_profiles` (0079, AFTER UPDATE OF tag_electronic on animals) propaga el valor a TODOS los `animal_profiles.animal_tag_electronic` del animal server-side → la UI lo lee offline desde el perfil sin sincronizar `animals`. El cliente NUNCA escribe `animals` (no está en su sync set).

### 1.2 Orden de operaciones (molde `transfer_animal` 0087 / `register_birth` 0075)

```
begin
  -- (a) DERIVAR de la FILA REAL del perfil (anti-IDOR, RD1.2). status='active' AND deleted_at IS NULL.
  select establishment_id, animal_id
    into v_est, v_animal_id
  from public.animal_profiles
  where id = p_profile_id and status = 'active' and deleted_at is null;
  if v_est is null then
    raise exception 'profile not found, not active, or deleted' using errcode = '23503';   -- RD1.2
  end if;

  -- (b) AUTHZ (RD1.3 / D-d): cualquier rol activo en el establishment DERIVADO. NUNCA del payload.
  if not public.has_role_in(v_est) then
    raise exception 'not authorized in this establishment (need active role)' using errcode = '42501';  -- RD1.3
  end if;

  -- (c) VALIDACIÓN DE FORMATO server-side (RD1.4): 15 díg (espeja isValidTag de spec 04).
  if p_tag_electronic is null or p_tag_electronic !~ '^\d{15}$' then
    raise exception 'tag_electronic must be exactly 15 digits (FDX-B)' using errcode = '23514';  -- RD1.4
  end if;

  -- (d) IDEMPOTENCIA por estado ya aplicado (RD1.6 / DA-1). Si el animal YA tiene exactamente este TAG,
  --     la op ya corrió (reintento por ACK perdido) → no-op + return replay=true. Scopeado al animal
  --     DERIVADO (no un lookup global por client_op_id → sin oráculo cross-tenant). El p_client_op_id se
  --     conserva en el contrato por compat del intent y para el case del mapeo, aunque la dedup acá se
  --     resuelve por estado (ver DA-1). [Mecanismo a ratificar en Gate 1 — alternativa: columna+índice.]
  if exists (
    select 1 from public.animals
    where id = v_animal_id and tag_electronic = p_tag_electronic
  ) then
    return jsonb_build_object('animal_id', v_animal_id, 'profile_id', p_profile_id,
                              'tag_electronic', p_tag_electronic, 'replay', true);
  end if;

  -- (e) UPDATE con GUARD NULL→valor (RD1.5 / R12.2). El trigger 0036 ya permite NULL→valor y bloquea
  --     valor→valor; el AND tag_electronic IS NULL es defensa-en-profundidad EXPLÍCITA + detector de race.
  update public.animals
     set tag_electronic = p_tag_electronic
   where id = v_animal_id and tag_electronic is null;

  -- (f) RACE (RD1.5): 0 filas = el animal ya tenía caravana (otro device la puso entre (d) y (e)). Error
  --     accionable DISTINGUIBLE del dup global, para que el cliente surfacee "ese animal ya tiene caravana".
  if not found then
    raise exception 'animal already has a tag (race)' using errcode = '23514';  -- RD1.5
  end if;

  return jsonb_build_object('animal_id', v_animal_id, 'profile_id', p_profile_id,
                            'tag_electronic', p_tag_electronic, 'replay', false);
end;
-- Unicidad global (RD1.7): si p_tag_electronic ya está en OTRO animal, el UPDATE de (e) viola el índice
-- parcial animals_tag_unique (0019) → 23505 propagado al cliente (sin capturar) → permanent_reject en sync.
```

### 1.3 Controles de seguridad EXPLÍCITOS (checklist Gate 1)

| Control | Cómo | Molde as-built |
|---|---|---|
| **Anti-IDOR** | `animal_id` + `establishment_id` se derivan de `animal_profiles WHERE id=p_profile_id` (la fila real); el cliente solo pasa `p_profile_id`, nunca el `animal_id`/tenant. | `transfer_animal` 0087 (a), `register_birth` 0075 (a). |
| **Authz** | `has_role_in(v_est)` sobre el tenant DERIVADO (cualquier rol activo, D-d). Rechaza `42501`. | `register_birth` 0075 (a). **DA-2**: Gate 1 ratifica/endurece. |
| **Guard NULL→valor** | `AND tag_electronic IS NULL` en el WHERE + trigger 0036 (NULL→valor OK, valor→valor 23514). 0 filas = race → `23514`. | trigger `tg_animals_block_tag_change` 0036. |
| **Validación formato** | `p_tag_electronic !~ '^\d{15}$'` → `23514`. Defensa server-side; el cliente ya validó (spec 04 `isValidTag`). | `isValidTag` parser-rs420 (espejo del regex). |
| **Idempotencia** | replay reconocido por estado ya aplicado (`animals.tag_electronic` ya = el TAG para ese animal) → no-op + `replay:true`. Scopeado al animal derivado (sin oráculo cross-tenant). | `register_birth` 0075 (a-bis), patrón anti-HIGH-D1 (no lookup global por client_op_id). **DA-1**. |
| **Unicidad global** | el UPDATE choca `animals_tag_unique` (0019) si el TAG ya está en otro animal → `23505`. | índice 0019. |
| **Cierre superficie** | `revoke ... from public, anon` + `grant ... to authenticated` firma `(uuid, text, uuid)` + smoke-check fail-closed + `notify pgrst`. | `transfer_animal` 0087 cierre, `register_birth` 0075 cierre. |
| **search_path fijo** | `set search_path = public` (evita hijack de search_path en SECURITY DEFINER). | todas las RPC 0074+. |
| **Sin tablas nuevas al sync** | no se crea stream ni policy; el efecto baja por `animal_profiles.animal_tag_electronic` (propagación 0079). `animals` sigue fuera del sync. | denorm 0079, ADR-026 b1. |

### 1.4 Por qué un RPC (no un UPDATE local plano)

`animals` está FUERA del sync set (ADR-026 b1) — la tabla NO existe en el SQLite local. A diferencia de `setCastrated`/`setFutureBull` (que escriben `animal_profiles`, sí sincronizada), asignar caravana toca `animals.tag_electronic` (global). La única vía limpia online u offline es el RPC. El denorm 0079 hace que el cambio "vuelva" a la UI por `animal_profiles.animal_tag_electronic` cuando la stream sincroniza la propagación del trigger. Esto también explica por qué NO hay overlay optimista de `animals` (RD2.2): no hay tabla local que pisar; la salida del candidato de las listas de sesión es client-side (RD2.5).

---

## 2. Cliente offline — outbox + RPC-mapping (RD2)

### 2.1 `enqueueAssignTag` (outbox.ts)

Nuevo encolado en `app/src/services/powersync/outbox.ts`, molde de `enqueueExitAnimal`/`enqueueSoftDelete` (ops sin overlay optimista sobre una tabla no-local):

```ts
export type EnqueueAssignTagInput = {
  /** Params del intent = los de la RPC assign_tag_to_animal (p_profile_id, p_tag_electronic). */
  params: { p_profile_id: string; p_tag_electronic: string };
};

export async function enqueueAssignTag(
  input: EnqueueAssignTagInput,
  options: { db?: AbstractPowerSyncDatabase } = {},
): Promise<OutboxResult> {
  const db = options.db ?? getPowerSync();
  const clientOpId = newClientOpId();
  const createdAt = nowIso();
  const intent = buildOpIntentInsert(clientOpId, 'assign_tag_to_animal', JSON.stringify(input.params), createdAt);
  // SIN overlay: animals no está en el SQLite local (ADR-026 b1) → no hay fila optimista que pisar.
  // El efecto (animal_profiles.animal_tag_electronic) baja por la stream al sincronizar; la salida del
  // candidato de las listas de sesión es client-side (RD2.5 / RD5.3).
  return enqueue(intent, [], db);
}
```

> Nota: el `client_op_id` viaja como el `id` del `op_intents` (clave de idempotencia, R6.10). El mapeo (§2.2) lo reinyecta como `p_client_op_id`. Esto sigue el contrato de `op_intents` existente — NO se cambia el shape de la tabla.

### 2.2 `mapIntentToRpc` — `assign_tag_to_animal` (upload.ts)

> **FIJADO (fold MEDIUM-1 de Gate 1)**: el `op_type` del intent = **`'assign_tag_to_animal'`** = el nombre EXACTO del RPC. NO se usa un `op_type='assign_tag'` con un case que lo remapee — eso era un foot-gun (un mismatch entre el `op_type` reconocido y el `rpcName` efectivo dejaría el intent en `PermanentIntentError` = bug de disponibilidad, y arriesgaría invocar un `rpcName` que no matchea la firma tipada del grant `(uuid,text,uuid)`). Con `op_type === rpcName`, el mapeo genérico (`rpcName: opType`) lo cubre sin case especial.

```ts
// En RPC_OP_TYPES, agregar 'assign_tag_to_animal' (así el intent no cae en PermanentIntentError).
// assign_tag_to_animal SÍ recibe p_client_op_id (como register_birth) → su rama en el armado de args.
// Nota: p_client_op_id es passthrough del contrato del intent; NO ancla la dedup (state-based, §1.2 d / RD1.6).
const args =
  opType === 'register_birth' || opType === 'assign_tag_to_animal'
    ? { ...params, p_client_op_id: op.id }
    : params;
return { kind: 'rpc', rpcName: opType, args }; // rpcName === opType === 'assign_tag_to_animal'
```

### 2.3 `classifyIntentUploadError` — errores de `assign_tag_to_animal` (RD2.4 / RD6)

El default `permanent_reject` (rama 3 del clasificador as-built) **ya cubre** el grueso sin cambios: `23505` (dup global), `23514` (race / formato), `42501` (sin rol), `23503` (perfil inexistente) caen todos en `permanent_reject` → rollback (no-op acá, no hay overlay) + descarte + surface. Lo que SÍ requiere un case nuevo es el **replay idempotente**: la RPC, al detectar el estado ya aplicado (§1.2 d), devuelve `{replay:true}` SIN error → no entra al clasificador (es un 2xx). Por lo tanto **no hace falta un case `idempotent_discard` por código** para `assign_tag_to_animal` (el no-op exitoso server-side devuelve 200 → uploadData limpia el intent normalmente). Esto simplifica el delta: `classifyIntentUploadError` queda **sin cambios** para `assign_tag_to_animal` (el default permanente cubre los rechazos reales; el replay no es error).

> Verificación para el implementer: confirmar que un `{replay:true}` de la RPC se trata como éxito en `connector.ts::uploadData` (ACK → clearOverlay del intent), no como error. Si por algún motivo el camino as-built tratara un 2xx con cuerpo `replay` distinto, ajustar — pero el contrato de supabase.rpc devuelve `data` sin error → es éxito. Sin cambio esperado en el clasificador.

### 2.4 Service público `assignTagToAnimal` (animals.ts)

```ts
export async function assignTagToAnimal(profileId: string, tag: string): Promise<OutboxResult> {
  return enqueueAssignTag({ params: { p_profile_id: profileId, p_tag_electronic: tag } });
}
```

Delgado sobre la outbox (mismo patrón que los demás services de mutación sobre `enqueue*`). Offline-first: el encolado tiene éxito al instante.

---

## 3. UI opción A — modo `assign_or_create` del bottom-sheet (RD3 / RD4)

> **Sketch, sin píxeles.** El design-review del leader (skill `design-review`, ADR-023) veta la UI concreta al implementar (alto impacto, manga). Acá se fija el contrato funcional + el cableado al as-built.

### 3.1 Dónde se enchufa

El host `FindOrCreateOverlay` (`app/app/_components/FindOrCreateOverlay.tsx`, chunk BLE global) ya resuelve `edit`/`transfer`/`create`. La opción A **refina la rama `create`**: cuando `lookupByTag` retorna `mode:'create'`, el host computa además los candidatos `noTag`; si hay ≥1, muestra el nuevo cuerpo `assign_or_create` en vez del `CreateBody` actual.

### 3.2 La decisión "¿hay candidatos? → intermedia vs CREATE directo" (RD8) — pura + testeable

Extraer una función pura (módulo nuevo `app/src/services/tag-lookup.ts` ya existe — sumar ahí, o un módulo hermano `assign-candidates.ts`), molde de `resolveTagLookup`:

```ts
/** Decide el cuerpo del overlay para un lookup mode:'create' según el conteo de candidatos noTag (RD8). */
export function resolveCreateOrAssign(noTagCandidateCount: number):
  | { mode: 'assign_or_create' }
  | { mode: 'create' } {
  return noTagCandidateCount > 0 ? { mode: 'assign_or_create' } : { mode: 'create' };
}
```

El host, en `onTagRead` (o tras `lookupByTag` resolver `create`), corre una lectura local del conteo de candidatos (reusar `buildAnimalsListQuery(establishmentId, { noTag: true })` y contar, o un `buildNoTagCandidatesCountQuery` chico si conviene el COUNT — el implementer decide; lo importante es que es **una lectura local más**, RD8.2) → pasa el conteo a `resolveCreateOrAssign` → setea el `OverlayState` con el modo resultante. El `TagLookupResult` del host se extiende con `{ mode: 'assign_or_create' }` (o el host lo maneja como un sub-estado de `create` — decisión de implementación; el contrato es: 0 candidatos = `create` directo, ≥1 = intermedia).

### 3.3 El cuerpo `AssignOrCreateBody`

Nuevo cuerpo del sheet (hermano de `EditBody`/`CreateBody`/`TransferBody` en `FindOrCreateOverlay.tsx`). Estructura funcional:

- **Encabezado**: el EID legible (ya lo pinta el host, `formatEidReadable`) — confirmación SENASA.
- **Título**: "¿Es uno de tus animales sin caravana?" (copy final lo define el design-review).
- **Buscador** (RD3.4): input que filtra la lista vía `searchAnimals(query, establishmentId)` scopeado a `noTag`. Necesita un service/lectura que combine el match TAG/IDV/visual con el filtro `noTag` — ver §3.4.
- **Lista scrollable de candidatos** (RD3.3): `animal_profiles` `noTag` activos, `updated_at DESC`. Cada fila = `idv` / `visual_id_alt` / `category` / `sex` / `rodeo` (RD3.5). Reusar `CategoryBadge` + el patrón de card de `EditBody`. **AS-BUILT (fix post-veto del leader)**: cada fila lleva además un **chevron derecho** (`ChevronRight`, afford de tap explícito, patrón de fila tappable iOS/Android) — en la manga deja inequívoco que tocar el candidato asigna la caravana. Layout: `XStack alignItems="center"` con `[YStack flex={1}` (hero/visual/categoría/sexo/rodeo) `][View flexShrink={0}` (chevron) `]` → contenido left-aligned, el chevron es decoración lateral DERECHA que NO descentra ni recorta el hero (ADR-027) ni roba el área de tap de la fila (toda la `Pressable` sigue tappable). Tamaño `$navIcon` (24, idéntico a `AnimalRow`) + color `$textMuted` (cero hardcode, ADR-023 §4).
- **CTA grande siempre visible "Es un animal nuevo → dar de alta"** (RD3.7): cierra + `router.push('/crear-animal', { tag: eid })` (idéntico a `CreateBody`).

Al tocar un candidato → confirmación ("Asignar caravana `<EID>` a este animal") → `assignTagToAnimal(profileId, eid)` → al éxito del encolado: cerrar + `router.push('/animal/[id]', { id: profileId })` (RD3.6). El UPDATE real lo aplica el RPC al sincronizar; la ficha lee el denorm local (que se actualiza al bajar la propagación 0079) — offline, la ficha puede mostrar la caravana recién al sincronizar, igual que cualquier mutación encolada. *(Detalle para el implementer: si se quiere feedback inmediato de "caravana puesta" offline, evaluar un overlay optimista sobre `pending_animal_profiles.animal_tag_electronic` del perfil — pero OJO: el force de 0079 en UPDATE re-deriva desde `animals`, así que el overlay local de `pending_*` es la vía, no un UPDATE a la fila synced. Esto es opcional; el camino mínimo es navegar a la ficha y dejar que el sync traiga el valor. Si se hace overlay, anotarlo como reconciliación. NO es bloqueante: el caso de la manga tolera ver la caravana al sincronizar.)*

### 3.4 La lista/buscador `noTag` con identificación visual

`buildAnimalsListQuery(establishmentId, { noTag: true })` ya da los candidatos `noTag` pero ordena por `created_at DESC` (R7.2 pide `updated_at DESC`). **Variante chica del builder**: agregar una opción `orderBy: 'updated_at'` a `buildAnimalsListQuery` (o un `buildNoTagCandidatesQuery` dedicado con `ORDER BY updated_at DESC`). El proyectado actual de la lista ya trae idv/visual/category/sex/rodeo (`LOCAL_LIST_SELECT`), así que la card de candidato se arma con lo que ya baja. Para el buscador, `searchAnimals` ya matchea TAG/IDV/visual pero NO filtra `noTag` — agregar un parámetro/variante para scopear la búsqueda a candidatos sin caravana (o filtrar client-side el resultado de `searchAnimals` por `animal_tag_electronic IS NULL`, que es más simple y suficiente para MVP). El implementer elige; la invariante (RD3.3/RD3.4) es: solo candidatos `noTag` activos del campo activo.

### 3.5 Sesión y ciclo (RD4)

Reusa la maquinaria del host BLE global: live-rescan (`seqRef`, RB3.5) re-dispara el flujo con el nuevo EID + re-computa candidatos (RD4.2); cambio de establishment cierra el overlay (`useEffect` sobre `establishmentId`, RB2.4 = RD4.3); cierre limpio reanuda el listener (RD4.4). La opción A es "un bastoneo = una decisión": tras asignar, navega a la ficha y cierra (RD4.5); no hay cola persistente (eso es la opción B).

### 3.6 AS-BUILT (Run 2 — UI opción A, 2026-06-13)

Reconciliación del sketch §3.1-§3.5 con el código realizado (este design es "sin píxeles" → el implementer eligió, dentro de la latitud que el sketch concedió; nada CONTRADICE RD3/RD4/RD8):

- **Decisión pura (§3.2)**: `resolveCreateOrAssign(count)` quedó en `app/src/services/tag-lookup.ts` (junto a `resolveTagLookup`, el molde) — la opción `tag-lookup.ts` del sketch, no un `assign-candidates.ts` nuevo. Regla `count > 0 → assign_or_create`, defensiva a `≤0 → create` (fail-safe: nunca intermedia vacía).
- **Conteo del host (§3.2)**: builder DEDICADO `buildNoTagCandidatesCountQuery(establishmentId)` en `local-reads.ts` (COUNT noTag synced [oculta exits] + overlay → 1 fila, no degrada) — la opción "COUNT chico" que el sketch dejó a criterio del implementer (en vez de contar las filas de `buildAnimalsListQuery`). El host lo corre con `runLocalQuerySingle` tras un lookup `mode:'create'`, re-chequeando el guard `seqRef` DESPUÉS del await (live-rescan/cierre/cambio-de-campo descartan el resultado tardío sin tocar `setState`).
- **Estado del host (§3.1)**: `OverlayState.ready.result` pasó de `TagLookupResult` a `ResolvedBody = TagLookupResult | { mode:'assign_or_create' }` — SUB-ESTADO del host (no se tocó el type puro del service, que sigue con edit/transfer/create). El `assign_or_create` se computa SOLO en la rama `create` (RD3.8: edit/transfer no cambian; intermedia exclusiva de BLE).
- **Lista/buscador (§3.4)**: término vacío → `fetchAnimals({ noTag:true, orderBy:'updated_at' })` (variante `updated_at DESC` del builder); con término → `searchAnimals` + filtro CLIENT-SIDE a `tagElectronic == null` (la opción "más simple y suficiente para MVP" del sketch). `fetchAnimals`/`FetchAnimalsFilter` se extendieron con `orderBy` (passthrough). El builder `buildAnimalsListQuery` ganó `orderBy?: 'created_at' | 'updated_at'` (default `created_at` → cero regresión); la rama overlay (sin `updated_at`) proyecta `pap.created_at AS updated_at` (frescura del alta optimista) vía helper `injectProjection`.
- **Cuerpo (§3.3)**: `AssignOrCreateBody` con buscador (debounce 250ms + guard `searchSeq`), `ScrollView maxHeight $candidateListMax` (token JIT nuevo) → buscador y CTA "es nuevo" (`Button secondary fullWidth` ≥`$touchMin`) SIEMPRE visibles, PINNED fuera del scroll (Fitts). Tocar candidato → paso de CONFIRMACIÓN intermedio ("Le vas a asignar la caravana `<EID legible>` a este animal" + resumen del candidato) → `assignTagToAnimal` → cierra + `/animal/[id]`. "Es nuevo" → `/crear-animal?tag=<eid>`.
- **Live-rescan (§3.5)**: `AssignOrCreateBody` se renderiza con `key={eid}` → un bastoneo con EID DISTINTO REMONTA el cuerpo (resetea búsqueda + candidato a confirmar). Sin el key, React preservaría el sub-estado `confirming` del EID viejo mientras el prop `eid` cambia (bug: asignar el EID nuevo al candidato del flujo viejo). Encontrado y cerrado en la autorrevisión.

---

## 4. UI opción B — `BulkTagAssignmentScreen` (RD5)

> **Sketch, sin píxeles.** Design-review del leader sobre la pantalla (alto impacto, manga) antes de mostrar a Raf.

### 4.1 La pantalla

Pantalla nueva en `app/app/` (ruta Expo Router, p. ej. `app/app/asignar-caravanas.tsx` — el nombre final lo fija el implementer según el patrón de rutas). Entry points (RD5.1 / D-c):
- tab `Animales` (`app/app/(tabs)/animales.tsx`): con el filtro "sin caravana" activo (R1.5), un CTA "Asignar caravanas en masa" navega a la pantalla.
- tab `Más`: un ítem de menú a la misma ruta.

### 4.2 Modo asignación del listener + cola de sesión

La pantalla consume `useBleStickListener({ enabled, onTagRead })` en modo asignación mientras está en foreground (RD5.2). Cada `onTagRead(eid)` empuja el EID a la **cola de sesión** (estado local `useState`/`useReducer`). Para el EID en cabeza de la cola, la pantalla muestra:
- el EID legible (`formatEidReadable`);
- la lista de candidatos `noTag` (mismo builder/orden que §3.4) + buscador (RD5.4);
- al elegir candidato → confirmar → `assignTagToAnimal(profileId, eid)` (RD5.3) → quitar el candidato de la lista de sesión client-side (RD2.5) + avanzar la cola + incrementar el contador (RD5.5);
- CTA "Bastoneé un animal nuevo, no está en la lista" → `/crear-animal?tag=<eid>` (RD5.6), al volver la sesión sigue.

> **Anti-stacking con el overlay global**: mientras la `BulkTagAssignmentScreen` esté montada, el `FindOrCreateOverlay` global NO debe abrirse por el mismo bastoneo (sería doble proceso del EID). Reusar `useBusyWhileMounted()` (spec 04, ya cableado en crear-animal/animal[id]/agregar-evento por el chunk BLE global) en la `BulkTagAssignmentScreen` → suspende el listener global mientras la pantalla maneja los EIDs por su cuenta. El listener de la pantalla masiva usa su propio `useBleStickListener` (o el control `useStickListenerControls` para tomar el listener) — el implementer elige el mecanismo de spec 04 que evita el doble consumo. La invariante: un bastoneo en la masiva NO abre el overlay global encima.

### 4.3 Contador y persistencia de progreso (RD5.5)

El contador ("X caravanas asignadas") es estado local de la sesión. Cada `assignTagToAnimal` ya encoló su `op_intent` (independiente, idempotente) → cerrar la pantalla NO rollbackea nada (las intenciones quedan en la outbox). El contador es informativo; la verdad persistente es la outbox.

### 4.4 Offline (RD5.7)

Toda la pantalla opera local: la cola, las listas, el buscador y el encolado son locales; el RPC se resuelve al sincronizar. Sin red, el caravaneo de todo el rodeo se encola completo; el sync resuelve dups/races al volver la señal (RD6).

### 4.5 AS-BUILT (Run 3 — UI opción B, 2026-06-13)

Reconciliación del sketch §4.1-§4.4 con el código realizado (`app/app/asignar-caravanas.tsx` + ruta en `_layout.tsx` + entry points + supresión por ruta del overlay). El sketch es "sin píxeles"; nada de lo de abajo CONTRADICE RD5/RD7 — solo aterriza decisiones dentro de la latitud concedida, MENOS un punto que CORRIGE el sketch (el mecanismo de anti-stacking):

- **Anti-stacking (§4.2) — CORRECCIÓN del sketch**: el sketch sugería `useBusyWhileMounted()` para suspender el overlay global. **Es inviable**: el `BleStickListenerProvider` (spec 04) gatea `listening = enabled && !busy` en `handleReading` ANTES de entregar a CUALQUIER suscriptor — `busy=true` suspende a TODOS los suscriptores, incluido el propio listener de la `BulkTagAssignmentScreen` (que entonces NO recibiría tags). No hay gating per-suscriptor en el provider, y tocar `ble/*` está gateado. **Mecanismo as-built**: el `FindOrCreateOverlay` global se hizo ROUTE-AWARE — lee `useSegments()`; si el top-segment es `asignar-caravanas`, su `onTagRead` retorna sin abrir nada (+ un `useEffect` cierra cualquier overlay stale al entrar a la ruta). La pantalla masiva consume su PROPIO `useBleStickListener({ enabled, onTagRead })` con `busy=false` → recibe los tags; el overlay los ignora en esa ruta. Net (verificado E2E mock): un bastoneo en la masiva NO apila el overlay y NO se procesa dos veces. *(El BLOQUEANTE §9.4 queda RESUELTO por esta vía, sin tocar `ble/*`.)*
- **Cola de sesión (§4.2)**: `useReducer` con `{ queue: string[], assignedCount: number, assignedProfileIds: ReadonlySet<string> }`. La cabeza `queue[0]` es el EID actual; cada `onTagRead` hace `enqueue` (dedup defensivo: no apila un EID ya en cola). Al asignar: `assigned` (avanza la cola + suma contador + marca el perfil). "Es nuevo" / "saltar": `skipHead` (saca la cabeza sin asignar). Cambio de campo: `reset`.
- **Cuerpo del EID (§4.2)**: `BulkEidBody` con `key={currentEid}` (remonta limpio con cada EID nuevo, resetea búsqueda + `confirming` — mismo patrón que el `AssignOrCreateBody` de opción A). Reusa el MISMO estilo de card de candidato (con chevron de tap), buscador (debounce 250ms + guard `searchSeq`), y paso de confirmación que la opción A, por consistencia visual. Sin término → `fetchAnimals({ noTag:true, orderBy:'updated_at' })`; con término → `searchAnimals` + filtro client-side a `tagElectronic == null`.
- **Contador (§4.3)**: `SessionCounter` en el header del screen (NO en el body) → no se desmonta al avanzar la cola; visible siempre (RD5.5). Cerrar la pantalla unmonta el estado de sesión pero los `op_intent` quedan en la outbox (independientes) → no rollbackea.
- **Entry points (§4.1 / RD5.1)**: (a) tab Animales — `Button primary` "Asignar caravanas en masa" en el header fijo, visible SOLO con el filtro `onlyNoTag` activo; (b) tab Más — `ActionRow` "Asignar caravanas en masa" (ícono `Radio`) en la sección "Campo activo", visible a TODOS los roles (D-d). Ruta `asignar-caravanas` en `ANIMAL_DESTINATIONS` del gate (`_layout.tsx`) → no se expulsa de 'active'.
- **Re-escopeo (§4.x / RD7.3 — F5.5)**: `prevEstablishmentRef` + `useEffect([establishmentId])` → al cambiar el campo: `reset` + banner "Cambiaste de campo". Default acordado en DA-3 (reiniciar + avisar). Invariante DURA: al resetear, `currentEid → null → EmptyQueueState` → nunca candidatos del campo ajeno.
- **Prevención de dup/race (§5 / RD6 — F5.4, Run 4 done)**: **prevención CLIENT-SIDE al bastonear** (RD6 reconciliada por el leader, post-Run-3). `onTagRead` corre `lookupByTag(eid, establishmentId)` (lectura local) ANTES de encolar: solo `mode:'create'` (EID nuevo) entra a la cola; `mode:'edit'`/`'transfer'` (ya tiene caravana) muestran el banner `DupNoticeBanner` ("Esa caravana ya está asignada") SIN encolar, sin perder la sesión/contador. El residual (un assign que igual rebote al sync) lo maneja la maquinaria existente (`permanent_reject` → descarte + log), sin canal nuevo (LIM doc, RD6.3). Ver §5 AS-BUILT.

---

## 5. Manejo de race y dup (RD6) — PREVENCIÓN CLIENT-SIDE al bastonear

> **RECONCILIADO 2026-06-13 (decisión de leader, post-Run-3 — ver RD6 de requirements).** La premisa original de §5 (reusar "el canal de status de sync existente" para mapear código→copy) es **fácticamente falsa contra el as-built** (ver §5.1): `connector.ts::surfaceUploadRejection` es solo `console.warn`, y `assign_tag_to_animal` no tiene overlay optimista (RD2.2) → un rechazo al sync NO es visible. Inventar un canal user-facing de rechazos de sync está PROHIBIDO por RD6.3 (cross-cutting, toca el core de sync). La defensa correcta es **PREVENIR el dup en el momento del bastoneo (client-side)**, no esperar el rechazo del sync.

### 5.0 Prevención client-side (defensa primaria, RD6.1) — AS-BUILT (Run 4)

En la `BulkTagAssignmentScreen` (opción B) `onTagRead` corre `lookupByTag(eid, establishmentId)` (lectura LOCAL, ya existente, las 3 ramas edit/transfer/create) **ANTES** de encolar el EID:
- `mode:'create'` (EID genuinamente nuevo, sin match en ningún campo del usuario) → `dispatch({type:'enqueue', eid})` → entra a la cola y se ofrecen los candidatos `noTag` (flujo normal).
- `mode:'edit'` (ya tiene caravana en ESTE campo) o `mode:'transfer'` (ya activo en OTRO campo del usuario) → **NO se encola**; se muestra el `DupNoticeBanner` ("Esa caravana ya está asignada · ese TAG ya está asignado a otro animal de tus campos, no se puede reasignar") con el EID legible + CTA "Entendido", y el operario queda listo para el próximo bastoneo **sin perder el progreso/contador de la sesión** (la cola y el `assignedCount` no se tocan).
- fallo de la lectura local (raro) → fail-CLOSED: banner "No pudimos verificar la caravana · bastoneala de nuevo" + NO se encola (mejor pedir un re-bastoneo que encolar un EID sin verificar).

En la opción A esto ya está cubierto por el motor: un EID con match nunca entra al modo `assign_or_create` (va a `edit`/`transfer` en el host BLE). La opción B replica el chequeo por EID bastoneado (RD6.1).

El `DupNoticeBanner` reusa el patrón `Card` + `Button` de `FieldChangedNotice` (componentes ya vetados por el leader) con acento de advertencia `$terracota` → es un banner menor, no una pantalla nueva. Se limpia al descartar, al bastonear un EID válido nuevo, o al cambiar de campo.

### 5.1 Residual al sync = LIMITACIÓN DOCUMENTADA (RD6.2, NO un toast nuevo)

Un assign encolado que IGUAL rebote al sincronizar (race: otro device caravaneó el MISMO animal entre la lectura local y el sync → `23514`; o dup cross-tenant no visible local → `23505`) lo maneja la maquinaria existente: `classifyIntentUploadError → permanent_reject → surfaceUploadRejection` (descarte + log observable), **sin un toast per-op al usuario** — igual que toda mutación encolada del app. La sesión NO se pierde (cada intent es independiente). El **race es auto-sanante** (el animal queda caravaneado por el device ganador → estado final correcto); el **dup cross-tenant de un RFID físico único es casi imposible** (la caravana es un objeto físico con ID único SENASA). **LIM (RD6.3)**: el operario no recibe aviso per-op si un assign encolado rebota al sync (caso negligible); lo cubre el log observable + el estado final auto-sanante. Un surfacing per-op de rechazos de sync encolados es CROSS-CUTTING (aplica a alta/parto/baja/lote/asignación) → diferido a un item de backlog dedicado / spec 15 ("bandeja de rechazos de sync"). El copy nunca expone `sqlerrm` crudo.

### 5.2 AS-BUILT histórico (Run 3) — por qué NO se reusó el "canal existente"

Al implementar F5.4 se descubrió que la premisa de §5 / RD6.3 es **fácticamente falsa contra el as-built**: el "canal de status que `permanent_reject` ya usa para el dup de TAG en alta" es `connector.ts::surfaceUploadRejection`, que **solo hace `console.warn`** (tabla + op + code, sin opData). NO existe ninguna superficie user-facing que mapee código→copy:

- El dup de TAG en **alta** "se nota" solo porque su overlay optimista hace `rollbackOverlay` (el animal recién creado DESAPARECE de la lista) — NO hay copy "ese TAG ya existe" mostrada al operario. Es un efecto colateral del rollback del overlay, no un canal de status con copy.
- `assign_tag_to_animal` NO tiene overlay optimista (RD2.2: `enqueue(intent, [], db)`) → al rechazar, NADA es visible (ni un rollback). El `console.warn` es invisible.
- No hay ningún subscribable (`subscribeUploadRejection` / store de rechazos) — confirmado por grep: 0 resultados.

Por lo tanto F5.4 (copy accionable: "ese animal ya tiene caravana — refrescá" / "ese TAG ya está asignado a otro animal") **NO se puede completar** sin (a) **construir un canal nuevo** de rejection-surfacing pub/sub en `connector.ts` (PROHIBIDO por RD6.3 "el chunk NO inventa un canal nuevo" + toca el core de sync, fuera del alcance del run) o (b) **degradar la copy** (no permitido por RD6.1/RD6.2/RD6.3). La **sesión NO se pierde** igual (cada intent es independiente — esa parte de RD6 SÍ se cumple); lo que falta es la COPY.

**Decisión del leader (2026-06-13, RESUELTA — desbloquea F5.4):** NI construir el canal NI degradar. La defensa correcta es **prevenir el dup en el momento del bastoneo (client-side)** — ver §5.0. El rechazo al sync queda como residual negligible/auto-sanante + log observable (§5.1, LIM RD6.3). RD6 de `requirements-09resto-dedup.md` fue reconciliada a esta realidad (prevención primaria + LIM del residual); F5.4 se implementó así en Run 4. La premisa original de §5 (mapear código→copy en el canal de sync) queda como histórico abajo, refutada.

---

## 6. Migración ≥0089 y archivos a crear / modificar

| Archivo | Acción | Cubre |
|---|---|---|
| `supabase/migrations/0089_assign_tag_to_animal_rpc.sql` (o el siguiente número libre ≥0089) | **+** RPC `assign_tag_to_animal` SECURITY DEFINER (§1) + revoke/grant + smoke-check + notify | RD1 |
| `app/src/services/powersync/outbox.ts` | **+** `enqueueAssignTag` + `EnqueueAssignTagInput` | RD2.2 |
| `app/src/services/powersync/upload.ts` | **mod** agregar `assign_tag_to_animal` a `RPC_OP_TYPES` + rama de `p_client_op_id` en `mapIntentToRpc` | RD2.3 |
| `app/src/services/powersync/upload.test.ts` | **mod** unit del mapeo `assign_tag_to_animal` → `{ rpcName, args con p_client_op_id }` | RD2.3 |
| `app/src/services/animals.ts` | **+** service público `assignTagToAnimal(profileId, tag)` | RD2.1, RD2.4 |
| `app/src/services/tag-lookup.ts` | **+** `resolveCreateOrAssign(count)` (decisión pura, RD8) **[Run 2 done]** | RD8 |
| `app/src/services/tag-lookup.test.ts` | **+** unit de `resolveCreateOrAssign` (0 → create / ≥1 → assign_or_create / negativo → create) **[Run 2 done]** | RD8 |
| `app/src/services/powersync/local-reads.ts` | **mod** opción `orderBy: 'updated_at'` en `buildAnimalsListQuery` + helper `injectProjection` + builder dedicado `buildNoTagCandidatesCountQuery` **[Run 2 done]** | RD3.3, RD5.2, RD8 |
| `app/src/services/powersync/local-reads.test.ts` | **mod** tests del builder `updated_at DESC` + `buildNoTagCandidatesCountQuery` (SQL/args + comportamiento node:sqlite) **[Run 2 done]** | RD3.3 |
| `app/src/services/animals.ts` | **mod** `FetchAnimalsFilter`/`fetchAnimals` con `orderBy` (passthrough al builder) **[Run 2 done]** | RD3.3 |
| `app/tamagui.config.ts` | **mod** token JIT `candidateListMax` (tope de alto del scroll de candidatos del sheet) **[Run 2 done]** | RD3.3 |
| `app/app/_components/FindOrCreateOverlay.tsx` | **mod** rama `create` → conteo candidatos + `resolveCreateOrAssign` + `AssignOrCreateBody` (lista + buscador + "es nuevo" + confirmación + `key={eid}`) **[Run 2 done]** | RD3, RD4 |
| `app/e2e/dedup-screenshot.spec.ts` | **+** captura 412×915 del modo `assign_or_create` para el veto del leader (mock del bastón) **[Run 2 done]** | veto de diseño |
| `app/app/asignar-caravanas.tsx` | **+** `BulkTagAssignmentScreen` (cola `useReducer`, contador, 1×1, "es nuevo", re-escopeo). **[Run 3 done]** Anti-stacking por supresión de ruta del overlay (NO `useBusyWhileMounted` — inviable, ver §4.5). **mod (Run 4 / F5.4)**: `onTagRead` async → `lookupByTag` ANTES de encolar (solo `create` encola; `edit`/`transfer` → `DupNoticeBanner` sin encolar, RD6.1) + estado `dupNotice` + `DupNoticeBanner` (reusa Card+Button) | RD5, RD7.3, RD6.1 |
| `app/app/(tabs)/animales.tsx` | **mod** CTA "Asignar caravanas en masa" con el filtro `noTag` activo **[Run 3 done]** | RD5.1 |
| `app/app/(tabs)/mas.tsx` | **mod** `ActionRow` "Asignar caravanas en masa" (ícono Radio, todos los roles) en "Campo activo" **[Run 3 done]** | RD5.1 |
| `app/app/_layout.tsx` | **mod** ruta `asignar-caravanas` en el `<Stack>` + `ANIMAL_DESTINATIONS` (no se expulsa de 'active') **[Run 3 done]** | RD5.1 |
| `app/app/_components/FindOrCreateOverlay.tsx` | **mod (Run 3)** ROUTE-AWARE: `useSegments()` → si la ruta es `asignar-caravanas`, `onTagRead` no abre (+ cierra overlay stale). Anti-stacking sin tocar `ble/*` (§4.5) **[Run 3 done]** | RD5.2 |
| `app/e2e/dedup-screenshot.spec.ts` | **+ (Run 3)** captura 412×915 de la `BulkTagAssignmentScreen` (vacío + con EID en cola). **+ (Run 4 / F5.4)** test de comportamiento "bastonear un EID ya asignado NO encola y avisa" + captura `bulk-dup-warning.png`. **mod (Run 4 / F6.1)**: EIDs hardcodeados (`982000000000007`/`...099`) → `makeEid()` único por corrida (un EID fijo leakea el unique global de `animals` entre runs interrumpidos → choca; el comportamiento RD6.1 ahora vive autoritativo en `baston-dedup.spec.ts`, este test queda como driver de la captura). **[Run 4 done]** | veto de diseño / RD6.1 (E2E) |
| backend tests (suite node:test, p. ej. `app/__tests__/...` o el patrón de las suites RPC) | **+** suite `assign_tag_to_animal` (los 6 escenarios) | RD1 (verificación) |
| `app/e2e/baston-dedup.spec.ts` | **+ (Run 4 / F6.1)** E2E formal — 5 escenarios de comportamiento con aserciones: (a) opción A asignar a candidato → ficha + caravana puesta (oráculo server `waitForServerTagAssigned`), (b) opción A "es nuevo" → CREATE precargado, (a') 0 candidatos → CREATE directo (RD3.2), (c) opción B masiva 2 bastoneos → contador en 2 + ambos candidatos salen de la lista, (d) opción B EID ya asignado NO encola + avisa (RD6.1). Reusa el mock del bastón bajo el flag E2E. **[Run 4 done]** | RD3/RD5/RD6 (E2E) |
| `app/e2e/helpers/admin.ts` | **+ (Run 4 / F6.1)** oráculo `waitForServerTagAssigned(profileId, tag)`: pollea el SERVER (service_role) hasta que `animals.tag_electronic` Y `animal_profiles.animal_tag_electronic` queden = el TAG → prueba la cadena offline→sync→RPC→propagación 0079 sin depender de la ficha (lectura LOCAL no-reactiva). **[Run 4 done]** | RD2 (verificación E2E) |
| `scripts/run-tests.mjs` | **mod** enganchar los nuevos unit tests (`resolveCreateOrAssign`, mapeo, builder) | RD8/RD2/RD3 |

**No se toca**: el contrato `op_intents` (shape estable); `app/src/services/ble/*` (firma de spec 04, se consume); `transfer-animal.ts` (spec 11). El RPC `transfer_animal` y los demás NO cambian.

---

## 7. Alternativa descartada

### UPDATE local optimista sobre `animals` (sin RPC), espejando `setCastrated`/`setFutureBull`

**Pros**: `setCastrated`/`setFutureBull` ya resuelven mutaciones de identidad/atributo offline sin RPC nuevo; reusar ese patrón evitaría un Gate 1 + un deploy gated.

**Contras**: esos services escriben `animal_profiles` (columna `is_castrated`/`future_bull`), que SÍ está en el sync set. `animals.tag_electronic` está FUERA del sync set (ADR-026 b1) — `animals` NI EXISTE en el SQLite local. No hay fila local que pisar ni que sincronizar de vuelta: un "UPDATE local" no tiene a qué tabla apuntar, y aunque se forzara un overlay sobre `pending_animal_profiles.animal_tag_electronic`, el trigger force de 0079 (BEFORE UPDATE) re-derivaría el valor desde `animals` server-side al subir, descartando el cambio. La identidad del animal global SOLO se puede mutar server-side, y para hacerlo offline-first hace falta el patrón outbox→RPC. Además, un UPDATE directo a `animals` por PostgREST desde el cliente carecería del guard de seguridad centralizado (anti-IDOR derivado, authz, formato) que el SECURITY DEFINER concentra.

**Razón**: RPC `assign_tag_to_animal` SECURITY DEFINER (offline vía outbox + RPC-mapping). Es la única vía coherente con ADR-026 b1 y con la superficie de seguridad que el dominio (declaración SENASA) exige. Esta es la dirección elegida, lockeada en el Gate 0 §2 (hallazgo del Explore) + §5.

---

## 8. Tests / verificación (RD criterios + §8 Gate 0)

### 8.1 Backend (node:test contra el RPC deployado) — los 6 escenarios

Suite nueva (molde de las suites RPC de spec 11/02), corre contra el RPC ya aplicado al remoto (gated):
1. **NULL→valor OK**: animal sin caravana → `assign_tag_to_animal` → `animals.tag_electronic` queda seteado; `animal_profiles.animal_tag_electronic` propagado (trigger 0079); `replay:false`.
2. **valor→valor rebota**: animal con caravana A → asignar B → el guard `IS NULL`/trigger 0036 lo bloquea (`23514`).
3. **anti-IDOR**: `p_profile_id` de un perfil de OTRO campo (sin rol) → `42501` (authz sobre el tenant derivado), nunca toca el animal ajeno.
4. **rol sin acceso**: usuario sin rol activo en el campo del perfil → `42501`.
5. **idempotencia**: mismo `p_client_op_id` (y mismo TAG ya aplicado) reintentado → `replay:true`, no doble-aplica ni rebota.
6. **dup global**: TAG ya en otro animal → `23505`.

### 8.2 Unit (node:test, sin SDK)
- `resolveCreateOrAssign(count)`: 0 → `create`, ≥1 → `assign_or_create`.
- `mapIntentToRpc` para `op_type='assign_tag_to_animal'`: arma `{ rpcName:'assign_tag_to_animal', args con p_profile_id/p_tag_electronic/p_client_op_id }`.
- builder de candidatos `noTag` ordenado `updated_at DESC` (SQL/args + integración SQLite, molde `local-reads.test`).
- (clasificación de error: el default `permanent_reject` ya cubre — verificar que no se rompió ningún case existente.)

### 8.3 E2E Playwright (bastón mock) — los 4 escenarios de §3.5 del Gate 0
- (a) BLE sin-match con candidatos → intermedia → elegir candidato → asignar → ficha con la caravana (al sincronizar en el mock).
- (b) intermedia → "es nuevo" → CREATE con el EID precargado.
- (c) masiva: bastonear 2 → asignar a 2 candidatos → contador en 2 → ambos salen de la lista.
- (d) dup-TAG → copy accionable, sesión no se pierde.

### 8.4 `node scripts/check.mjs` verde end-to-end (lint anti-hardcode, unit, builders, suites).

---

## 9. BLOQUEANTES / verificaciones para el implementer

> Cosas a confirmar en el primer paso; ninguna es bloqueo duro, pero el implementer debe verificarlas antes de avanzar (no inventar).

1. **Idempotencia por estado vs columna (DA-1)**: el design propone reconocer el replay por `animals.tag_electronic` ya aplicado (§1.2 d). Si Gate 1 prefiere una columna `client_op_id` + índice (paridad estricta con `register_birth`), hay que decidir DÓNDE colgarla (el efecto es un UPDATE sobre `animals`, no un INSERT — habría que agregar `animals.last_assign_op_id` o una tabla `tag_assignments`, mayor alcance). **Parar y consultar al leader si Gate 1 endurece esto** — no inventar la tabla.
2. **Authz D-d (DA-2)**: RD1.3 deja "cualquier rol activo". Gate 1 lo ratifica o endurece a owner-or-creator. Implementar lo que Gate 1 apruebe; si llega como "cualquier rol activo", `has_role_in` alcanza (§1.2 b).
3. **`{replay:true}` como éxito en `uploadData`**: confirmar que un 2xx con cuerpo `{replay:true}` se trata como ACK (clearOverlay del intent), no como error (§2.3). Esperado: sí (supabase.rpc devuelve `data` sin error). Si no, ajustar el clasificador.
4. **Anti-stacking masiva vs overlay global (§4.2)**: confirmar que `useBusyWhileMounted()` en la `BulkTagAssignmentScreen` suspende el listener global, y que la pantalla consume su propio listener sin doble-procesar el EID. Si el mecanismo de spec 04 no permite "tomar" el listener limpio, parar y reportar (no improvisar sobre `ble/*`).
5. **Re-escopeo de sesión al cambiar de campo en la masiva (DA-3 / RD7.3)**: decidir la UX con el leader/Raf antes de cerrar (default propuesto: reiniciar la sesión al nuevo campo con aviso). No bloquea el camino feliz.
