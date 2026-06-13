# Spec 09 — chunk "09 resto · dedup A/B (asignación de caravana)" — Gate 0

**Status**: Pendiente de aprobación de Raf (Puerta 1).
**Fecha**: 2026-06-13 (sesión 25).
**Conducido por**: leader (+ 1 Explore para mapear el write-path de PowerSync). Decisiones de Raf cerradas en §4.
**Naturaleza**: chunk de implementación del frontend de spec 09 **+ delta de backend** (RPC nuevo). NO reabre la spec entera — spec 09 está aprobada (2026-05-26) + Gate 0 retroactivo (s18) + chunk BLE global (s24). Este doc scopea el chunk dedup contra el as-built y lockea las decisiones. El fold a requirements/design/tasks lo hace el `spec_author` tras la Puerta 1; la implementación, el `implementer` (Opus).
**Related**: chunk "BLE global" (`context-09resto-ble-global.md`, DONE — dejó el dedup A/B explícitamente diferido a "el chunk siguiente"), spec 02 R5.5/R5.6 (detección blanda), spec 15 (PowerSync outbox + RPC-mapping), R4.13.a de spec 02 (NULL→valor permitido), R7/R8/R12 de spec 09 (contrato de las opciones A/B).

> Contrato humano del Gate 0 (ADR-022): contexto validado + edge cases resueltos + scope del chunk acordado, antes de redactar tasks e implementar.

---

## 1. Por qué este chunk (orden del plan)

`plan.md` (orden de implementación): `… → 02 fe ✅ → PowerSync ✅(web) → [04 bastón ✅ · import ✅] → **09 resto** → 05 → 03 → 08 …`.

El chunk "BLE global" (s24) cerró el corazón de BUSCAR ANIMAL pero **difirió a propósito** (DEC-2) el dedup lógico: cuando el bastón lee un TAG sin match, hoy va **directo a CREATE**. Falta lo que la spec 09 llama **duplicados lógicos opción A + opción B** (R7/R8): el caso "animal ya cargado con solo visual/IDV, al que recién ahora se le pone caravana electrónica". Este chunk lo cierra.

---

## 2. Reconciliación contra el as-built

### Ya construido (NO se re-hace)
- **Overlay BLE** (`app/app/_components/FindOrCreateOverlay.tsx`): bottom-sheet con modos `edit`/`create`/`transfer`. El modo `create` hoy navega **directo** a `/crear-animal?tag=` (RB6). La opción A se enchufa **ahí** (antes de "Dar de alta").
- **Lookup por TAG** (`app/src/services/tag-lookup.ts::resolveTagLookup` + `animals.ts::lookupByTag`): 3 ramas puras edit/transfer/create. La opción A es un refinamiento de la rama `create` (en la puerta BLE), no toca edit/transfer.
- **Filtro "sin caravana"** (`local-reads.ts::buildAnimalsListQuery(..., { noTag: true })`): lista perfiles activos con `animal_tag_electronic IS NULL` (denorm sincronizada, 0079). Es EXACTAMENTE el criterio de candidatos de R7.2/R8.2. La tab Animales ya expone ese filtro (R1.5). *(Detalle para el spec_author: el orden actual es `created_at DESC`; R7.2 pide `updated_at DESC` — variante chica del builder.)*
- **Buscador** (`animals.ts::searchAnimals`): match TAG/IDV/visual; reutilizable scopeado a `noTag` para el buscador dentro de las listas de candidatos.
- **Surfacing de rechazos de sync** (`upload.ts::classifyIntentUploadError`): `23505` (UNIQUE violation) → `permanent_reject` → rollback del overlay + canal de status (R11.5 / R8.4).

### NO existe (= el delta de este chunk)
- **`assignTagToAnimal`**: no hay service, builder ni RPC. Búsqueda exhaustiva del Explore: cero coincidencias.
- **La intermedia opción A** (lista "¿es uno de tus animales sin caravana?") y la **pantalla masiva opción B** (`BulkTagAssignmentScreen`).

### Hallazgo clave del Explore (cambia la naturaleza del chunk)
**`animals` está FUERA del sync set** (ADR-026 b1) — la tabla **ni existe en el SQLite local**. Por lo tanto asignar caravana **NO es un UPDATE local plano** (a diferencia de `setCastrated`/`setFutureBull`, que escriben `animal_profiles`, sí sincronizada). La única vía limpia (online u offline) es un **RPC `assign_tag_to_animal` SECURITY DEFINER**:
- El trigger de identidad (0079) propaga `animals.tag_electronic` → `animal_profiles.animal_tag_electronic` server-side (todos los perfiles del animal). El cliente NO lo escribe.
- Offline: el RPC se invoca vía el patrón **outbox + RPC-mapping de spec 15** (`op_intent` → `mapIntentToRpc`), igual que `create_animal`/`register_birth`/`exit_animal_profile`. El candidato se saca de la lista de la sesión client-side (R8.3), así la staleness del denorm local hasta el sync queda enmascarada.

→ **Este chunk toca backend** (migración + RPC) → **Gate 1 APLICA** + **deploy gated** (autorización de Raf en sesión).

---

## 3. Scope de ESTE chunk (qué entra / qué se difiere)

### Entra
1. **RPC `assign_tag_to_animal`** (SECURITY DEFINER, migración ≥0089): UPDATE `animals SET tag_electronic = $tag WHERE id = $animal_id AND tag_electronic IS NULL`, con autorización + idempotencia (ver §5). Aplicada al remoto vía MCP/Management API, **gateada por el leader + Raf**.
2. **Service `assignTagToAnimal` offline** (outbox + RPC-mapping): `enqueueAssignTag` → `op_intent` → `mapIntentToRpc('assign_tag')` → `assign_tag_to_animal`. Surfacing de dup (23505) por el canal de status existente.
3. **Opción A — intermedia en el overlay** (R7): nuevo modo del bottom-sheet `assign_or_create`. Cuando el BLE lee un TAG sin match, en vez de ir directo a CREATE, el sheet muestra **lista scrollable de candidatos** (perfiles activos sin caravana, buscador + `updated_at DESC`) + **CTA grande "Es un animal nuevo → dar de alta"**. Elegir un candidato → confirmar "Asignar caravana `<TAG>` a este animal" → `assignTagToAnimal` → al éxito, ficha del animal (`/animal/[id]`).
4. **Opción B — pantalla de asignación masiva** (`BulkTagAssignmentScreen`, R8): el operario bastonea en serie; cada TAG se acumula en la cola de la sesión; para cada uno elige un candidato de la lista (mismo criterio noTag) y asigna. Contador de sesión visible. CTA "Bastoneé uno nuevo, no está en la lista" → CREATE con TAG precargado (R8.6). Entry points: tab Animales (filtro "sin caravana") + tab "Más".
5. **E2E con bastón mockeado**: (a) BLE sin-match → intermedia → elegir candidato → asignar → ficha con la caravana puesta; (b) intermedia → "es nuevo" → CREATE con TAG precargado; (c) masiva: bastonear 2 → asignar a 2 candidatos → contador en 2 → ambos salen de la lista; (d) dup-TAG → copy accionable, sesión no se pierde.

### Se difiere (post-MVP / chunks posteriores)
- **Opción C** (detección automática + merge guiado): post-MVP (R9, `CONTEXT/07-pendientes.md`). NO entra.
- **`spp-android` real** (bastón físico para la masiva): gated por el dev build Android (ADR-024 §4). Se valida con mock/web-serial.
- **Pairing pulido** (R9 del chunk BLE): sigue diferido al hardware.

---

## 4. Decisiones lockeadas (Raf, 2026-06-13)

| # | Decisión | Resolución de Raf |
|---|---|---|
| **DEC-1** | ¿A+B en este chunk o partir? | **A + B juntas.** El RPC + service compartido es el laburo duro; se hace una vez con los dos consumidores. Una sola pasada de Gate 1 + deploy + review. |
| **DEC-2** | ¿Asignar caravana offline u online-only? | **Offline** (outbox + RPC-mapping, patrón spec 15). Es el caso de la manga: caravanear todo el rodeo sin señal. Dup-TAG se detecta en sync (surfacing existente). |
| **DEC-3** | Forma de la intermedia (opción A) | **En el mismo bottom-sheet** (nuevo modo `assign_or_create`): lista scrollable + buscador + CTA "Es un animal nuevo". Mantiene el ritmo de manga. |

**Defaults del leader (aprobados implícitamente salvo redline en Puerta 1):**
- **D-a** Buscador dentro de las listas de candidatos (A y B), reusando `searchAnimals` scopeado a `noTag`. Un rodeo de 200 sin caravana no se scrollea a ciegas.
- **D-b** Guard `WHERE tag_electronic IS NULL` en el UPDATE del RPC (R12.2) + copy accionable ante race/dup ("ese animal ya tiene caravana — refrescá" / "ese TAG ya está asignado a otro animal"). Sin perder progreso de sesión.
- **D-c** Entry points de la opción B: tab Animales con filtro "sin caravana" (CTA "Asignar caravanas en masa") + tab "Más".
- **D-d** Autorización para asignar caravana: **cualquier rol activo** en el campo (es trabajo de manga, no owner-only) — espeja que lote/eventos los carga cualquier rol operativo. A confirmar en Gate 1.

---

## 5. Arquitectura del chunk (sketch para el implementer / Gate 1)

### RPC `assign_tag_to_animal` (migración ≥0089, SECURITY DEFINER)
- **Firma**: `assign_tag_to_animal(p_profile_id uuid, p_tag_electronic text, p_client_op_id uuid)`.
- **Anti-IDOR**: deriva `animal_id` + `establishment_id` **de la fila real** del `animal_profile` (NO confía en params del cliente), igual que `transfer_animal` (spec 11). Re-chequea `has_role_in(establishment_id)` server-side (D-d: cualquier rol activo).
- **Guard NULL→valor**: `UPDATE animals SET tag_electronic = p_tag WHERE id = <derivado> AND tag_electronic IS NULL`. Si 0 filas → el animal ya tenía caravana (race) → error accionable. El trigger de inmutabilidad de spec 02 (R4.13.a) ya permite NULL→valor y bloquea valor→valor.
- **Validación de formato** server-side (defensa): TAG = 15 díg FDX-B (espeja `isValidTag`); el cliente ya lo validó en el contrato de ingesta del bastón.
- **Idempotencia**: `p_client_op_id` (patrón register_birth 0075) — reintento del outbox no re-aplica.
- **Unicidad global** `animals.tag_electronic` (índice `animals_tag_unique`, **0019**, parcial deleted_at IS NULL): un dup rebota 23505 → `permanent_reject` (offline: en el sync).

### Cliente (offline, patrón spec 15)
- `enqueueAssignTag(profileId, tag, clientOpId)` → INSERT `op_intent` (op_type `assign_tag`, params). **Sin overlay** de `animals` (no está local); el `animal_profiles.animal_tag_electronic` baja por la stream al sincronizar. La salida del candidato de la lista de sesión es client-side (R8.3).
- `mapIntentToRpc`: case `assign_tag` → `{ rpcName: 'assign_tag_to_animal', args: { p_profile_id, p_tag_electronic, p_client_op_id: op.id } }`.
- `assignTagToAnimal(profileId, tag)` (service público en `animals.ts`) → `enqueueAssignTag`.

### UI
- **Opción A**: nuevo modo del `OverlayBody` (`assign_or_create`). El `lookupByTag` rama `create` (BLE) deja de ir directo a CREATE: el host computa además la **existencia de candidatos** (perfiles noTag) — si hay, muestra `assign_or_create`; si no hay candidatos, va directo a CREATE (no tiene sentido la intermedia vacía). *(Detalle de spec_author: o el modo siempre se muestra con la lista posiblemente vacía + "es nuevo" — definir el "vacío" en el fold; rec: si 0 candidatos, skip directo a CREATE.)*
- **Opción B**: `BulkTagAssignmentScreen` nueva, consume `useBleStickListener` en modo asignación + la lista de candidatos + el contador de sesión.

---

## 6. Edge cases y mapeo

| Caso | Acción | Notas |
|---|---|---|
| BLE sin-match, **hay** candidatos sin caravana | intermedia `assign_or_create` (lista + "es nuevo") | R7 / DEC-3 |
| BLE sin-match, **0** candidatos sin caravana | directo a CREATE (intermedia vacía no aporta) | rec del leader §5 |
| Elegir candidato → asignar | `assignTagToAnimal` (offline) → ficha | R7.4 |
| Race: el candidato ya tiene caravana (otro device) | guard `IS NULL` → 0 filas → "ese animal ya tiene caravana, refrescá" | R12.2 |
| TAG ya asignado a otro animal (dup global) | 23505 en sync → `permanent_reject` + surface, sesión intacta | R8.4 / R11.5 |
| Masiva: bastonear N en serie | cola de sesión, asignar 1×1, contador visible, cada commit independiente | R8.2/R8.3/R8.5 |
| Masiva: bastoneé uno nuevo (no en lista) | CTA → CREATE con TAG precargado, sin salir del modo | R8.6 |
| Offline durante toda la masiva | todo encolado (outbox); el sync resuelve dups al volver la red | DEC-2 |
| Puerta MANUAL (idv/visual) sin match | sigue directo a CREATE (la intermedia es **solo** BLE) | R3.3 — sin cambio |

---

## 7. Gates que aplican

- **Gate 1 (security spec)**: **SÍ** — toca backend (RPC SECURITY DEFINER que escribe `animals.tag_electronic` + autorización cross-tenant + unicidad global). Superficie: anti-IDOR del `p_profile_id`, re-chequeo de rol, guard NULL→valor, idempotencia, validación de formato del TAG, sync scope (no se agregan tablas nuevas — `animals` ya está fuera del sync; el efecto baja por `animal_profiles`).
- **Deploy gated**: la migración del RPC a la DB compartida = autorización de Raf en sesión (clasificador / [[project_supabase_mcp_write]]).
- **Gate 2 (security code)**: **SÍ**, por run del implementer.
- **Veto de diseño del leader** (skill `design-review`): **SÍ**, sobre la intermedia (modo del overlay) y la pantalla masiva (alto impacto, manga).
- **Puerta 2 (código, humana)**: Raf prueba en `pnpm web` (mock/web-serial) + aprueba para `done` del chunk.

---

## 8. Plan de verificación

- **Unit**: lógica de decisión "hay candidatos? → intermedia vs CREATE directo"; `mapIntentToRpc` case `assign_tag`; clasificación de error de asignación (race vs dup vs otro).
- **Backend (node:test contra el RPC deployado)**: NULL→valor OK; valor→valor rebota; anti-IDOR (profile de otro campo); rol sin acceso rechazado; idempotencia por `client_op_id`; dup global 23505.
- **E2E Playwright (bastón mock)**: los 4 escenarios de §3.5.
- `node scripts/check.mjs` verde end-to-end.

---

## 9. Aprobación

- **Pendiente de Raf (Puerta 1)**: aprobar el scope del chunk + DEC-1..3 + los defaults D-a..d (o redlinear). Al aprobar, el `spec_author` foldea a `requirements-09resto-dedup.md` / `design-09resto-dedup.md` / `tasks-09resto-dedup.md` (marcando R7/R8/R12 como AS-BUILT de este chunk) y redacta las tasks; luego corre **Gate 1** (security_analyzer modo spec) sobre el RPC, y recién con Gate 1 PASS + tu OK de spec arranca el `implementer` (Opus). El **deploy de la migración** lo gateás aparte en sesión. 09 sigue `deferred` hasta cerrar este chunk (y la opción C diferida).
