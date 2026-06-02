# Security Gate 2 (code) — C2: ALTA find-or-create MANUAL + LISTA DE ANIMALES + ficha básica

**Feature**: frontend de spec 02 (alta + lista + ficha), folda puerta MANUAL de find-or-create de spec 09.
**Modo**: `code`. **Baseline**: `db9d5866b39448061efc378219a618a21da1f1d2` (cambios sin commitear sobre `main`).
**Foco del brief**: multi-tenant / authz client-side, IDOR, inyección en búsqueda, PII en logs.

## Veredicto: PASS

No se identificaron findings HIGH-confidence. El cliente NO elude ni asume permisos: cada query lleva
scope explícito por `establishment_id` (defensa en profundidad) y la RLS server-side (migrations 0022 /
0017 / 0021, ya gateadas) es la barrera real e inescapable. El alta es fail-closed ante recursos
cross-tenant. Hay una observación LOW (no bloqueante) en el anexo.

---

## Archivos analizados (diff vs baseline)

Nuevos:
- `app/src/services/animals.ts` — createAnimal / fetchAnimals / searchAnimals / findOrCreateLookup / fetchAnimalDetail.
- `app/src/services/last-rodeo.ts` — readLastRodeo / writeLastRodeo / queryLastUsedRodeoFromDb.
- `app/src/services/management-groups.ts` — fetchManagementGroups (solo lectura).
- `app/app/crear-animal.tsx` — AnimalCreateScreen (R4).
- `app/app/animal/[id].tsx` — ficha básica (R5/C2).
- `app/src/utils/animal-identifier.ts`, `animal-category.ts`, `animal-form.ts`, `last-rodeo.ts` (+ tests).

Modificados:
- `app/app/(tabs)/animales.tsx` — mock → datos reales.
- `app/app/_layout.tsx` — gating de rutas crear-animal + animal/[id].
- `app/e2e/helpers/{admin,ui}.ts`, `scripts/run-tests.mjs` (test harness — fuera de foco de security).

---

## Verificación de exploitabilidad por foco del brief (todos PASS)

### 1. Multi-tenant / IDOR en `createAnimal` — SIN VULNERABILIDAD

- **`establishment_id` del contexto activo, no manipulable/hardcodeado**: `createAnimal` recibe
  `input.establishmentId` que el screen (`crear-animal.tsx:57`) saca de `useEstablishment()`
  (`estState.current.id`). Se inserta tal cual en `animal_profiles` (`animals.ts:409`). No hay UUID de
  tenant hardcodeado en ningún punto del diff (verificado; el header del archivo lo documenta como invariante).
- **`rodeoId` cross-tenant → fail-closed**: `createAnimal` lee `species_id` del rodeo con
  `.eq('id', input.rodeoId).maybeSingle()` (`animals.ts:379-383`). La RLS `rodeos_select` exige
  `has_role_in(establishment_id)` (migration `0017_rodeos.sql:50-51`), así que un `rodeoId` de otro
  tenant devuelve `null` → la función aborta con "El rodeo seleccionado ya no está disponible" ANTES de
  cualquier insert (`animals.ts:385-387`). Confirmado fail-closed.
- **Insert de `animal_profiles` con `establishment_id` ajeno → rechazado**: la policy
  `animal_profiles_insert` exige `has_role_in(establishment_id)` (migration `0022:9-11`). Aunque el
  cliente forzara un `establishmentId` ajeno, el insert lo rechaza server-side (`with check`).
- **UUIDs en cliente**: `randomUuid()` usa `globalThis.crypto.randomUUID()` (`animals.ts:516-517`) —
  CSPRNG (UUID v4). No abre vector de predicción/colisión de ids de otro tenant: aunque un atacante
  predijera un id, la RLS no expone filas de otros establishments (`animals_select` deriva de la
  existencia de un perfil con `has_role_in`, migration `0022:21-29`).
- **Insert a `animals` (tabla global) por cualquier authenticated = correcto por diseño**: la policy
  `animals_insert` solo exige `auth.uid() is not null` (migration `0022:31-32`). Es el binding tenant
  el que vive en `animal_profiles` (RLS por establishment). Un `animals` sin perfil es invisible vía
  RLS (`animals_select` requiere un perfil con `has_role_in`). Correcto: no hay fuga.
- **`systemId` provisto por el cliente → no elude el trigger de categoría**: `createAnimal` usa
  `input.systemId` solo para resolver `category_id` por `code` contra `categories_by_system`
  (catálogo de lectura abierta a autenticados, `using (true)`, migration `0015:46-47` — sin scope
  tenant, no PII). El insert real re-valida server-side: el trigger de `0021` (regla c, líneas 45/53)
  enforce `category_id.system_id = system del rodeo`. Inyectar un `category_id` de otro system se
  rechaza en el server. El cliente no puede eludirlo.

### 2. IDOR en ficha / búsqueda — SIN VULNERABILIDAD

- **`fetchAnimalDetail(profileId)` con id de otro tenant**: filtra `.eq('id', profileId)` + `.is('deleted_at', null)`
  (`animals.ts:471-472`) y delega el scope tenant a la RLS `animal_profiles_select` (`has_role_in` +
  `deleted_at is null`, migration `0022:6-7`). Un `profileId` ajeno → `data` null → devuelve error
  genérico "No se encontró el animal. Puede que ya no tengas acceso." (`animals.ts:476-478`). NO expone
  datos del animal ajeno. El route param `/animal/[id]` (`[id].tsx:27-28`) no permite leer perfiles
  ajenos por la misma razón.
- **`searchAnimals` / `fetchAnimals` scopeados**: las 3 sub-queries de búsqueda (`tryTag`, `tryIdv`,
  `tryVisual`) y la lista llevan `.eq('establishment_id', establishmentId)` + `.is('deleted_at', null)`
  (+ `status='active'` en búsqueda) — `animals.ts:154-155, 207-210, 218-225, 235-241`. Sin fuga
  cross-tenant; RLS como segunda barrera.

### 3. Inyección en búsqueda (`.or()` / `.ilike`) — SIN VULNERABILIDAD EXPLOTABLE

- Único `.or()` del diff: `.or(\`visual_id_alt.ilike.%${escapeIlike(term)}%\`)` (`animals.ts:241`).
  `term` es atacante-controlado (texto que tipea el operario → `debouncedQuery`).
- `escapeIlike` reemplaza `% _ ,` por espacio (`animals.ts:264-266`). En la gramática PostgREST de
  `.or()` (`col.op.val,col2.op2.val2`), la **coma** es el separador que iniciaría una condición OR
  nueva (el único vector real para apuntar a otra columna/función); está neutralizada. `%`/`_`
  (comodines ilike) también. Peor caso residual con paréntesis/punto: romper sintácticamente el
  patrón → error 400 de la *propia* query (auto-DoS irrelevante), NO un leak: los `.eq('establishment_id', …)`
  van como filtros AND independientes del `.or()` y, por encima, la RLS `has_role_in` filtra a nivel
  Postgres de forma inescapable. No hay vector de lectura cross-tenant ni de exfiltración. Confianza alta.

### 4. Fuga de datos / PII en logs — SIN VULNERABILIDAD

- Cero `console.*` en `app/src/services/*` y en las screens en foco (`crear-animal.tsx`, `animal/[id].tsx`,
  `animales.tsx`) — verificado con grep.
- Mensajes de error al usuario: genéricos y accionables (network / duplicate_tag / duplicate_idv /
  "ya no tenés acceso"). No exponen stack traces, queries ni hostnames. (Ver anexo LOW por el passthrough
  de `error.message` en la rama `unknown`.)

### 5. Otros HIGH client-side — ninguno

- `_layout.tsx`: el gating de `crear-animal` / `animal/[id]` es solo navegación/UX (no es authz; la
  barrera es la RLS). No de-strand de los destinos de animales (`_layout.tsx:264, 298`). Correcto.
- `last-rodeo.ts`: persiste solo un `rodeo_id` (no PII) en SecureStore (native) / localStorage (web),
  con key namespaced por `(userId, establishmentId)` y sanitizada (`safe()`). `queryLastUsedRodeoFromDb`
  scopeado por `establishment_id` + RLS. Sin issue.
- `management-groups.ts`: lectura scopeada por `establishment_id` + `active` + `deleted_at is null` + RLS. Sin issue.

---

## False positives descartados (trazabilidad)

- **`.or()` con interpolación de input** (patrón que dispara el detector de injection): descartado como
  HIGH tras verificar (a) el escape de la coma —separador de condición OR— y comodines, (b) que el scope
  `establishment_id` viaja como filtro AND fuera del `.or()`, y (c) que la RLS server-side es la barrera
  real. El peor caso es un error 400 de la propia query, no un leak. Queda como observación LOW.
- **Insert a `animals` con policy `auth.uid() is not null`** (parece authz laxa): NO es vulnerabilidad —
  es el diseño multi-tenant correcto (binding tenant en `animal_profiles`; `animals` huérfano es
  invisible por RLS).
- **`fetchAnimalDetail` sin filtro explícito de `establishment_id`** (parece IDOR): NO lo es — la RLS
  `animal_profiles_select` (`has_role_in`) hace el scope; el cliente filtra por `id` y la barrera la
  pone el server. Patrón correcto para esta arquitectura.
- **UUIDs generados en cliente** (parece superficie de spoofing de ids): NO explotable — `crypto.randomUUID`
  es CSPRNG y la RLS no expone filas ajenas aunque se adivine un id.

---

## Cobertura indirecta (advertencias de método)

La skill `sentry-skills:security-review` está calibrada para web/Django/Express; NO cubre nativamente:
- **RLS de Supabase / Postgres** (la barrera real de este código): auditada manualmente contra las
  migrations ya gateadas (`0022`, `0017`, `0015`, `0021`). El gate de este código se apoya en que esas
  policies están vigentes — verificado que existen y exigen `has_role_in` / `is_owner_of`.
- **Sintaxis de filtros PostgREST** (`.or()`, `.ilike`): el riesgo de inyección se analizó manualmente
  contra la gramática de PostgREST, no por la guía SQL genérica de la skill (que asume SQL crudo).
- **PowerSync / offline**: NO aplica en C2 (los services pegan a Supabase directo; PowerSync es C5).
  Cuando entre C5, el modelo de sync rules de PowerSync deberá re-auditarse (no es parte de este gate).
- **BLE / React Native nativo**: no tocado por este diff.

---

## Anexo LOW (no bloqueante — registro para refinamiento)

- **[LOW] Passthrough de `error.message` de Postgres al usuario en la rama `unknown`**
  (`animals.ts:44`, `classifyError`; consumido en `crear-animal.tsx:193` y `animal/[id].tsx:45`).
  Cuando el error no matchea network/duplicate, se muestra `error.message` crudo de PostgREST/Postgres
  al operario. No es exploitable (no hay SQL crudo del que filtre estructura sensible; los nombres de
  tabla/columna ya son conocidos del dominio y la RLS no se revela), pero es information disclosure de
  bajo impacto y UX pobre (mensaje técnico en es-AR mezclado con inglés). Sugerencia (post-MVP): mapear
  a un copy genérico "No pudimos guardar el animal. Probá de nuevo." y loggear el detalle solo en telemetría.
- **[LOW] `escapeIlike` reemplaza por espacio en vez de escapar** (`animals.ts:264-266`). Funcionalmente
  seguro para el objetivo (neutraliza comodines y la coma), pero altera el término de búsqueda en lugar
  de buscarlo literal (un visual_id con `%` no se podría encontrar exacto). Es trade-off de UX, no de
  seguridad. Aceptable; documentado.
