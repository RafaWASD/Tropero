# Design — LOTES OPERABLES (venta/descarte en tanda) — delta spec 02

> Delta-spec (ADR-028, Nivel B). Cubre `requirements-lotes-venta.md` (RLV.*). Fuente de verdad de contexto:
> `context-lotes-venta.md` (Gate 0 cerrado). El baseline `design.md` NO se reescribe; su tabla "Deltas
> posteriores" NO se toca acá (la folda el leader al cerrar la Puerta 2).

## 0. Resumen de la decisión clave (la que pedía el Gate 0)

**La baja en tanda es un LOOP CLIENT-SIDE de la baja per-animal ya existente (`exit_animal_profile`, 0044) vía
la outbox (`enqueueExitAnimal`), N veces — NO una RPC nueva de baja en tanda.**

Consecuencia de gate: **sin schema nuevo, sin RPC nueva → Gate 1 candidato a N/A** (el leader confirma; ver §7).

## 1. Contexto as-built relevante (lo que ya existe y se reusa)

- **`management_groups`** (0037): lote scopeado por establishment, cruza rodeos. RLS: SELECT a todo rol activo;
  INSERT/UPDATE owner-only; soft-delete vía RPC `soft_delete_management_group` (0041). La **asignación** de un
  animal a un lote = UPDATE de `animal_profiles.management_group_id`, permitida a cualquier rol operativo
  (`animal_profiles_update = has_role_in`); el trigger `tg_animal_profiles_management_group_check` (0037) valida
  server-side que el lote sea del mismo establishment del perfil. Membresía única (FK simple).
- **`exit_animal_profile`** (0044): RPC SECURITY DEFINER de baja per-animal. Firma
  `(p_profile_id, p_status animal_status, p_exit_reason exit_reason_enum, p_exit_date date, p_exit_weight numeric,
  p_exit_price numeric)`. Authz: deriva `establishment_id` + `created_by` de la fila real del perfil y exige
  `has_role_in(est) AND (is_owner_of(est) OR created_by = auth.uid())`. NO es soft-delete (`deleted_at` queda
  NULL): setea `status`/`exit_reason`/`exit_date`/`exit_weight`/`exit_price`; el perfil sale de las listas
  activas por el filtro `status='active'`. Gate 1 PASS (SEC-SPEC-01, s20) + Gate 2 PASS (delta `c3.3-baja`).
- **Camino offline de la baja (as-built, ya reconciliado):** `exitAnimalProfile` (`services/animals.ts`) YA NO
  es online-only — encola vía **`enqueueExitAnimal`** (`services/powersync/outbox.ts`): un intent
  `exit_animal_profile` (params de la RPC) + overlay `pending_status_overrides` (effect `'exited'`, status,
  exit_date). La lista activa oculta el animal y la ficha muestra "Vendido el {fecha}" al instante, offline.
  Al subir, `uploadData` mapea el intent a `supabase.rpc('exit_animal_profile', ...)`; el rechazo permanente
  rollbackea el overlay + superficia (canal de status). Idempotencia natural (transición de status, sin delta).
- **Lógica pura de la baja** (`services/exit-animal.ts`): `EXIT_REASON_MAPPINGS` (Venta/Muerte/Transferencia),
  `exitReasonToStatus`, `classifyExitError`, `validateExitWeight`, `validateExitPrice`, `sanitizePriceInput`.
- **Lotes CRUD** (`services/management-groups.ts`): `fetchManagementGroups`, `createManagementGroup` (INSERT
  local, id de cliente), `renameManagementGroup`, `softDeleteManagementGroup`, `assignAnimalToGroup`
  (UPDATE local de `management_group_id`, o NULL para quitar), `fetchGroupMembers` (activos del lote).
- **Lote UI** (`app/app/lote/[id].tsx`): usa `GroupViewScreen` + `AnimalRow` compacto + `GroupActionsBar`
  (Castrar/Vacunar/Destetar gateadas por rodeo). Es la pantalla donde entra la acción "Vender / Descartar".
- **Cierre de jornada** (`app/app/maniobra/identificar.tsx` + `_components/ExitJornadaSheet.tsx`): al terminar
  la jornada (`closeSession` OK) el sheet pasa a la fase `'terminated'` ("Jornada terminada · Procesaste N
  animales" + "Listo"). Es el punto de inserción de la sugerencia de vacías.
- **Tacto → dato** (`services/maneuver-events.ts` + schema local): un tacto se persiste como fila de
  `reproductive_events` con `session_id`, `event_type='tacto'`, `pregnancy_status` ('empty'|'small'|'medium'|
  'large'), `deleted_at`. El schema local (`services/powersync/schema.ts`) tiene ambas columnas. La derivación
  de "vacía" del badge (`utils/repro-status.ts`) usa `pregnancy_status='empty'`.
- **Sheet de lote reusable** (`app/app/maniobra/_components/LotePickerSheet.tsx`): patrón de elegir/quitar lote
  con "Sin lote" primero; base para el picker de la sugerencia post-tacto.
- **Última migración as-built: `0122`.** Cualquier migración nueva (no se prevé ninguna) sería **≥ `0123`**.

## 2. Decisión de la baja en tanda — loop client-side vs RPC nueva

### 2.1 Opciones

- **(A) Loop client-side de `exit_animal_profile` vía la outbox (ELEGIDA).** Por cada animal seleccionado se
  llama `enqueueExitAnimal({ params, profileId, status, exitDate })` con el `(status, exit_reason)` del motivo
  de la tanda y el precio/peso efectivo del animal. N intents `exit_animal_profile` independientes + N overlays
  `'exited'`. Se reusa TODO lo existente (RPC, authz, idempotencia, clasificación de error, overlay optimista).
- **(B) RPC nueva `exit_animal_profiles_batch(p_profile_ids uuid[], ...)` atómica.** Una sola llamada que da de
  baja las N filas en una transacción server-side. Requiere: nueva migración (≥0123), nuevo op_type de outbox +
  overlay N-fila, nuevo case en `mapIntentToRpc`/`classifyIntentUploadError`, y **Gate 1 obligatorio**.

### 2.2 Recomendación: (A), loop client-side

Fundamento (offline-first pesa — CLAUDE.md ppio 3):

1. **Offline-first sin trabajo nuevo.** El camino de la baja YA es outbox (`enqueueExitAnimal` + overlay
   `'exited'`). El loop hereda offline-first, overlay optimista por animal y reconciliación al subir **gratis**.
   Una RPC batch atómica NO es más offline: igual necesitaría su intent de outbox + overlay N-fila para no ser
   online-only — cero ganancia neta, más superficie.
2. **Superficie de seguridad idéntica y ya aprobada.** Cada llamada reusa la authz de `exit_animal_profile`
   (deriva el tenant de la fila real del perfil, exige `has_role_in AND (owner OR created_by)`), la idempotencia
   (transición de status, sin delta) y la clasificación de error, todo Gate-1-PASS (SEC-SPEC-01) y Gate-2-PASS.
   Una RPC batch nueva reabre la superficie (anti-IDOR sobre un ARRAY de ids: habría que validar CADA id contra
   el tenant en el server, un patrón nuevo y más fácil de equivocar) → Gate 1 obligatorio y más riesgo.
3. **La no-atomicidad es CORRECTA para el campo, no un defecto.** Si 18 de 20 bajas suben OK y 2 se rechazan
   (un animal ya lo bajó otro dispositivo), el operario ve el resultado parcial y solo esos 2 se superfician —
   no un rollback all-or-nothing que lo obligue a re-hacer 18 bajas buenas. Es el mismo criterio ya aceptado en
   `softDeleteManagementGroup` (2 pasos no atómicos, estado consistente y recuperable) y en el multi-write de
   maniobras (CrudEntries independientes).
4. **Menos código, menos deploy gateado.** Sin migración → sin deploy a la DB compartida (que hoy está gateado
   a Raf). Entrega el pedido con lo que ya está probado.

Costo asumido de (A): N CrudEntries en vez de 1 (más tráfico al reconectar) y no-atomicidad. Ambos aceptables
para tandas de decenas de animales; si en el futuro una tanda fuera de miles, se reevaluaría un batch RPC (nota
en backlog, no ahora).

### 2.3 Write amplification por animal

Por cada animal de la tanda se generan **2 escrituras locales**: (i) el intent+overlay de la baja
(`enqueueExitAnimal`) y (ii) el clear de membresía `assignAnimalToGroup(profileId, null)` (UPDATE local de
`management_group_id`, RLV.9.1). Ambas offline, ambas idempotentes, columnas ortogonales (status vs
management_group_id) → sin conflicto de overlay. Se corren en orden por animal; si UNA falla localmente (raro:
error de SQLite, no de authz) se corta y se superficia, dejando reintentar (fail-closed) — las ya encoladas
quedan locales y suben.

> **Decisión de criterio propio (Puerta 1) — clear de membresía.** El Gate 0 dice "los archivados **dejan el
> lote**". Con solo la baja, el animal ya desaparece de la vista del lote (`fetchGroupMembers` filtra
> `status='active'`). Se agrega igual el `management_group_id → NULL` (RLV.9.1) para que "dejan el lote" sea
> **literal** y la membresía histórica del lote no incluya archivados. Alternativa descartada: confiar solo en
> el filtro activo (deja el `management_group_id` viejo apuntando al lote; benigno pero semánticamente sucio si
> a futuro se muestra "cabezas históricas del lote").

## 3. `management_groups` — ¿necesita un flag? NO

**No se agrega ninguna columna a `management_groups`.** Cualquier lote es operable (RLV.1); no hay "tipo de
lote". El default "Descarte" del flujo del tacto (RLV.13) es solo un **string de nombre sugerido** al llamar
`createManagementGroup(establishmentId, 'Descarte')` — sin flag ni marca. Alternativa evaluada y descartada:
una columna `is_suggested`/`kind` para distinguir "lotes de descarte" — innecesaria (agrega migración + Gate 1
sin beneficio; el usuario los nombra libremente, A-6). Confirmado con el Gate 0 (§4: "probablemente NO necesita
columna de tipo").

## 4. Archivos a crear / modificar

### 4.1 Baja en tanda (lote operable)

- **`app/src/services/exit-animal.ts`** (MODIFICAR, lógica pura, sin I/O):
  - Extender `ExitReasonChoice` a `'sale' | 'death' | 'culling'` y `EXIT_REASON_MAPPINGS` con la entrada
    **Descarte** → `{ choice:'culling', status:'sold', exitReason:'culling', label:'Descarte',
    capturesSaleData:true }` (RLV.4.1). Mantener Muerte; **quitar Transferencia del set de la TANDA** (sigue en
    la ficha per-animal, que usa su propio subconjunto). Nota: el set del flujo en tanda y el de la ficha pueden
    divergir — parametrizar o exponer dos constantes (`BATCH_EXIT_MAPPINGS` vs las 3 de la ficha) para no
    romper `app/animal/baja.tsx`.
  - Nueva función pura `resolveEffectiveSaleData({ commonPrice, commonWeight, overridePrice, overrideWeight })`
    → `{ price, weight }` (RLV.5.2/RLV.6): el override gana sobre el común; ambos pueden ser null.
  - Reusar `validateExitWeight`/`validateExitPrice`/`sanitizePriceInput` (RLV.6.1) sin cambios.
- **`app/src/services/management-groups.ts`** (MODIFICAR) o un módulo nuevo `batch-exit.ts` (I/O):
  - Nueva función `exitAnimalsBatch(input)` que recorre los animales seleccionados y, por cada uno, llama
    `enqueueExitAnimal(...)` (con su precio/peso efectivo) y `assignAnimalToGroup(profileId, null)` (RLV.7/RLV.9.1).
    Devuelve un resumen `{ ok, count }` (fail-closed en error de DB local). El rechazo server-side lo maneja la
    outbox (RLV.8), no el return.
- **`app/src/utils/batch-exit-selection.ts`** (CREAR, lógica pura): estado de selección del subconjunto
  (toggle por animal, seleccionar/deseleccionar todos, contador) — RLV.3/RLV.3.1/RLV.3.2. Testeable con node:test.
- **`app/app/lote/[id].tsx`** (MODIFICAR): agregar la acción "Vender / Descartar" (RLV.2). Al activarla → **modo
  selección**: cada `AnimalRow` muestra un checkbox tappable; header con "seleccionar todos" + contador; CTA
  "Registrar salida (N)" habilitado con ≥1 seleccionado (RLV.3.x). El CTA navega a la pantalla/sheet de datos de
  la tanda pasando los `profileId`s seleccionados + el `groupId`.
- **`app/app/lote/venta.tsx`** (CREAR) — pantalla de datos de la tanda (molde de `app/animal/baja.tsx`):
  - Paso 1: motivo (Venta / Descarte / Muerte), 3 cards grandes (RLV.4).
  - Paso 2: fecha común (default hoy) + (motivos con `capturesSaleData`) precio + peso comunes opcionales
    (RLV.5) + lista de los N animales con opción de **ajustar** precio/peso por animal (override, RLV.6) +
    resumen "Vas a dar de baja N animales · Motivo" + aviso de irreversibilidad (RLV.17) + botón destructivo
    "Registrar salida" (deshabilitado en vuelo, guard anti doble-tap — RLV.18/RLV.19).
  - Al confirmar → `exitAnimalsBatch(...)` → `router.back()` al lote (que se re-lee y muestra menos cabezas).
- **`app/app/lote/_components/BatchSaleAnimalRow.tsx`** (CREAR, opcional): fila del animal en la tanda con su
  override de precio/peso (reusa `FormField` + `sanitizePriceInput`/`sanitizeWeightInput`).

### 4.2 Sugerencia post-tacto de las vacías

- **`app/src/services/powersync/local-reads.ts`** (MODIFICAR): nuevo builder puro
  `buildSessionEmptyFemalesQuery(sessionId)` → SELECT sobre `reproductive_events` (unido a `animal_profiles`
  activos) de esa `session_id` con `event_type='tacto'`, `pregnancy_status='empty'`, `deleted_at IS NULL`,
  `DISTINCT` por `animal_profile_id`, filtrando perfiles `status='active'` y no borrados (RLV.10.1). Debe
  considerar el overlay (una vaca vacía cargada offline en esta misma sesión vive en `pending_reproductive_events`
  hasta sincronizar) — mismo patrón UNION overlay/synced que las otras queries de reproductive_events. Testeable
  en `local-reads.test.ts`.
- **`app/src/services/sessions.ts`** (MODIFICAR) o `management-groups.ts`: `fetchSessionEmptyFemales(sessionId)`
  (thin sobre `runLocalQuery(buildSessionEmptyFemalesQuery(...))`) → lista de `{ profileId, hero }` para mostrar
  el conteo y asignar.
- **`app/app/maniobra/_components/ExitJornadaSheet.tsx`** (MODIFICAR): en la fase `'terminated'`, si la sesión
  tenía tacto y hay ≥1 vacía (el caller le pasa `emptyCount`), en vez de solo "Listo" mostrar la sugerencia
  saltable "Encontramos {N} vacías. ¿Agregarlas a un lote?" con acciones **"Elegir lote"** / **"Ahora no"**
  (RLV.10/RLV.11). "Elegir lote" abre el picker.
- **`app/app/maniobra/_components/SugerenciaVaciasSheet.tsx`** (CREAR) o extensión del picker: lista los lotes
  del campo (`fetchManagementGroups`) con "Sin lote" reemplazado por **"Crear lote nuevo"** (default "Descarte",
  RLV.12/RLV.13). Al elegir/crear → `assignAnimalToGroup(profileId, groupId)` por cada vaca (RLV.14) →
  confirmación + salir del flujo. Molde de `LotePickerSheet` (patrón de sheet, header fijo, guard tap-through).
- **`app/app/maniobra/identificar.tsx`** (MODIFICAR): calcular `emptyCount` al abrir el sheet de salida (o al
  pasar a `'terminated'`): `fetchSessionEmptyFemales(sessionId)` solo si la config de la jornada incluía tacto
  (leer de la sesión); pasar el conteo + la lista al `ExitJornadaSheet`. Cero hardcode de `establishment_id`
  (del contexto, RLV.20).

### 4.3 Tests

- Unit (node:test): `exit-animal.test.ts` (mapeo Descarte + `resolveEffectiveSaleData`),
  `batch-exit-selection.test.ts` (selección/deseleccionar-todos/contador), `local-reads.test.ts`
  (`buildSessionEmptyFemalesQuery`), test de servicio del loop `exitAnimalsBatch` (encola N intents + N clears,
  overlay optimista, fail-closed).
- E2E (Playwright): extender `app/e2e/lotes.spec.ts` (Vender/Descartar → selección → registrar salida → el lote
  queda con menos cabezas, RLV.2/3/7/9) + un caso sobre `maniobra-lote.spec.ts` (terminar jornada con vacías →
  sugerencia → crear "Descarte"/elegir → las vacías quedan en el lote, RLV.10–14; y el caso "saltar", RLV.11).
  Regla del repo: importar `test`/`expect` de `./helpers/fixtures`.

## 5. Multi-tenant / RLS / offline (MUSTs de RAFAQ)

- **RLS / anti-IDOR (RLV.21):** no hay tabla ni RPC nueva. La barrera real de cada baja es
  `exit_animal_profile` (deriva el tenant de la fila real del perfil; el cliente solo manda `p_profile_id`). La
  selección de la tanda se construye SOLO de `fetchGroupMembers` (RLS-scopeado al establecimiento activo,
  RLV.21.1) → los candidatos ya son del tenant; el RPC re-valida por-llamada. La asignación de vacías al lote la
  re-valida el trigger 0037 (mismo establishment del perfil) + la RLS `animal_profiles_update` (has_role_in).
- **Offline-first (RLV.22/RLV.23):** todo el flujo es local + outbox. Baja en tanda = N `enqueueExitAnimal`
  (intent + overlay `'exited'`) + N `assignAnimalToGroup(null)` (UPDATE local). Sugerencia de vacías =
  `createManagementGroup` (INSERT local) y/o `assignAnimalToGroup` (UPDATE local), todo offline con efecto
  optimista al instante. Derivación de vacías = query al SQLite local (incluye overlay `pending_reproductive_events`).

## 6. Alternativa descartada (design.md exige ≥1)

Ver §2.1(B) — **RPC nueva `exit_animal_profiles_batch` atómica**. Descartada por: (i) no aporta offline sin
replicar igual el outbox+overlay; (ii) reabre la superficie de seguridad (anti-IDOR sobre array de ids) →
Gate 1 + deploy gateado; (iii) su atomicidad all-or-nothing es peor UX de campo que el resultado parcial;
(iv) más código y migración para cero beneficio en tandas de decenas. También descartada la columna de "tipo"
en `management_groups` (§3).

## 7. Gates

- **Gate 1 (security modo spec): candidato a N/A — el leader confirma.** Justificación: la baja en tanda es un
  **loop client-side que reusa la RPC `exit_animal_profile` (0044) sin cambios**, sin tabla/columna/RPC nueva y
  sin tocar RLS. La superficie de seguridad es idéntica a la baja per-animal (ya Gate-1-PASS SEC-SPEC-01 y
  Gate-2-PASS en `c3.3-baja`), aplicada N veces. La asignación de vacías al lote reusa `assignAnimalToGroup` +
  trigger 0037 (ya cubiertos). **Focos de seguridad a re-verificar en Gate 2 (code, siempre):**
  1. **Anti-IDOR de la tanda:** confirmar que la selección se arma solo de `fetchGroupMembers` (tenant-scopeado)
     y que ningún `profileId` cruza de otro establecimiento; el RPC deriva el tenant por-llamada.
  2. **No fabricar el `establishment_id` en el cliente** (RLV.20): solo `p_profile_id` viaja al RPC.
  3. **Rechazo parcial (RLV.8):** que un rechazo de una baja no revierta las demás ni deje overlay colgado.
  4. **Clear de membresía** de un perfil archivado: `assignAnimalToGroup(null)` sobre un `status!=active` es
     válido (trigger 0037 hace early-return cuando el nuevo `management_group_id` es NULL).
  > Si Raf o el leader deciden ir por la RPC batch (§2.1B) → **Gate 1 pasa a obligatorio** + deploy gateado.
- **Gate 2 (code): siempre.**
- **Gate 2.5 (capturas, ADR-029):** sugerencia post-tacto (con conteo) · lote con acción "Vender/Descartar" ·
  modo selección de subconjunto · form de venta (comunes + override) · post-venta (lote con menos cabezas).

## 8. Decisiones de criterio propio (para Puerta 1)

1. **Mapeo de "Descarte"** → `status='sold'` + `exit_reason='culling'`, con peso/precio opcionales (reabre
   parcialmente la semántica de `culling` diferida en `c3.3-baja`). Ver RLV.4.1. Fallback si Raf prefiere:
   ofrecer solo Venta/Muerte y usar "Descarte" solo como nombre de lote.
2. **Motivos de la tanda = Venta / Descarte / Muerte** (sin Transferencia; sin theft/other). La transferencia
   per-animal sigue en la ficha (RLV.4.2).
3. **Clear de membresía en la baja** (`management_group_id → NULL`, RLV.9.1) para que "dejan el lote" sea
   literal, aun cuando el filtro activo ya los oculta (§2.3).
4. **Punto de inserción de la sugerencia = fase `'terminated'` del `ExitJornadaSheet`** (al cerrar la jornada),
   condicionada a que la config de la jornada incluyera tacto y a que haya ≥1 vacía.
5. **Baja en tanda = loop client-side reusando `exit_animal_profile` (no RPC batch)** — la decisión central
   (§2), con las consecuencias de gate del §7.
