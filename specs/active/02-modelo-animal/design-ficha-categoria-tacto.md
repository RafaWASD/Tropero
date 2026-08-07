# Design (delta spec 02) — Fijar la categoría a mano + tacto reproductivo, desde la ficha

**Status**: `spec_ready` (delta de spec 02 — **frontend puro**). Implementa
`requirements-ficha-categoria-tacto.md` (`RCM.n` + `RTF.n`).
**Fecha**: 2026-08-06 · **Autor**: spec_author

> **Gate 1 (security_analyzer modo `spec`): N/A.** Evidencia, no supuesto — ver §9. Cero migraciones, cero
> RPC nuevas, cero Edge Functions, cero policies. Los dos writes viajan por caminos server-side que **ya
> existen y ya se ejercitan hoy** desde la propia ficha y desde la manga.

---

## §0 — Resumen de la decisión técnica

Dos afordancias nuevas en `app/app/animal/[id].tsx` sobre plumbing **ya construido**:

| | Funcionalidad 1 — categoría a mano | Funcionalidad 2 — tacto desde la ficha |
|---|---|---|
| Write | `UPDATE animal_profiles SET category_id, category_override` (1 CrudEntry) | `INSERT reproductive_events` sin `session_id` (1 CrudEntry) |
| Servicio | **nuevo** `setCategoryManual` (thin, reusa `resolveRevertCategory`) | **existentes** `addTacto` / `addTactoVaquillona` — cero código de datos nuevo |
| Builder SQL | **nuevo** `buildSetCategoryOverrideUpdate` (+ reusa `buildRevertCategoryOverrideUpdate`) | ninguno nuevo |
| Gating server | triggers `0021`/`0040`/`0030` (ya vigentes) | trigger `0054` `tg_reproductive_events_gating` (el MISMO que la manga) |
| UI nueva | fila "Categoría" + `CategoryPickerSheet` (`BottomSheetShell`) | CTA en "Estado actual" + ruta `animal/tacto` que monta `TactoStep`/`TactoVaquillonaStep` |
| Offline | sí (write local plano + optimismo en sitio) | sí (write local plano, patrón `addTacto` vigente) |

El grueso del trabajo es **lógica pura + composición**, no plumbing.

---

## §1 — Archivos

### Crear

| Archivo | Qué |
|---|---|
| `app/src/utils/category-pin.ts` | PURO. `categoryAgeMismatch(...)`, `canPinCategory(...)`, ventanas etarias de coherencia. |
| `app/src/utils/category-pin.test.ts` | `node:test` del módulo anterior. |
| `app/src/services/category-pin-core.ts` | PURO. `decideCategoryPin(...)` con deps inyectadas (patrón `cut-service-core.ts`). |
| `app/src/services/category-pin-core.test.ts` | `node:test` con fakes del resolve y del write. |
| `app/src/components/CategoryPickerSheet.tsx` | Bottom sheet de selección + confirmación (sobre `BottomSheetShell`). |
| `app/src/utils/ficha-tacto-offer.ts` | PURO. `resolveFichaTactoOffer(...)` → `'prenez' \| 'aptitud' \| null`. |
| `app/src/utils/ficha-tacto-offer.test.ts` | `node:test`, incluye el barrido de disyunción (RTF.2.1). |
| `app/app/animal/tacto.tsx` | Ruta de captura del tacto individual (monta los pasos de la manga). |
| `app/e2e/ficha-categoria.spec.ts` | E2E de la funcionalidad 1. |
| `app/e2e/ficha-tacto.spec.ts` | E2E de la funcionalidad 2. |

### Modificar

| Archivo | Cambio | Riesgo |
|---|---|---|
| `app/src/utils/animal-category.ts` | **Exportar** `ONE_YEAR_DAYS` / `TWO_YEAR_DAYS` (hoy privados). Aditivo, sin tocar lógica. | nulo |
| `app/src/utils/animal-category-picker.ts` | `+ pickableCategories(catalog, sex, isCastrated)` reusando `MALE_/FEMALE_CATEGORY_CODES`. Aditivo. | nulo |
| `app/src/services/powersync/local-reads.ts` | `+ buildSetCategoryOverrideUpdate(profileId, categoryId)`. Aditivo. | bajo |
| `app/src/services/animals.ts` | `+ setCategoryManual(profileId, chosenCode)`. Aditivo. | bajo |
| `app/app/animal/[id].tsx` | Fila "Categoría" + montaje del sheet + CTA de tacto + `rodeoGating` completo (hoy solo se guarda el booleano de `dientes`). | medio (archivo grande) |
| `app/app/agregar-evento.tsx` | **Quitar** la card "Tacto" + `TactoForm` + su estado + su rama de submit (RTF.9). | medio |
| `app/app/_layout.tsx` | `+ <Stack.Screen name="animal/tacto" />`. | nulo |
| `scripts/run-tests.mjs` | Enganchar los 3 unit nuevos (la lista es de paths explícitos, no glob). | nulo |
| `supabase/tests/reports/run.cjs` | `+` los 3 casos de RTF.8.5 (tacto/aptitud sin `session_id`). | bajo |

### NO se toca

- `app/app/maniobra/**` — `TactoStep` / `TactoVaquillonaStep` se **consumen tal cual**, sin props nuevas y sin
  cambios de comportamiento. `maneuver-applicability.ts`, `maneuver-gating.ts`, `pregnancy-buckets.ts` se
  consumen read-only. Por eso el delta NO abre una spec de 03 (ADR-028: cruza features solo si la CAMBIA).
- `requirements.md` / `design.md` / `tasks.md` base de spec 02 (el fold del puntero al baseline lo hace el
  leader al cerrar la Puerta 2).
- `progress/qa_maniobras-device.md`, `StickStatusIndicator.tsx`, `nav-target-bands*` — unidades ajenas en
  curso.

---

## §2 — Funcionalidad 1: modelo de la fijación de categoría

### 2.1 La regla, en una línea

`override = (categoría elegida ≠ categoría derivada por el espejo completo)`.

Es **exactamente** el invariante que ya establece el alta (`categoryOverrideFor`), extendido del espejo
reducido del alta (sexo + fecha) al espejo COMPLETO (sexo + fecha + `is_castrated` + eventos). Consecuencias:

- Elegir una categoría que el sistema NO derivaría → se fija (`override = true`, RCM.5.1).
- Elegir la que el sistema SÍ derivaría → se vuelve a automático (`override = false`, RCM.5.2) → el selector
  es un **superconjunto** de "Quitar fijación", que sigue existiendo como atajo (RCM.7.3).

### 2.2 De dónde sale la lista (RCM.2)

```
fetchRodeoCategoryCatalog(detail.rodeoId)      → SystemCategory[] {code,name}, sort_order, SQLite local
  → pickableCategories(catalog, detail.sex, detail.isCastrated)
```

`pickableCategories` vive en `animal-category-picker.ts` porque ahí ya está la **fuente única** del mapeo
sexo↔code (`MALE_CATEGORY_CODES` / `FEMALE_CATEGORY_CODES`, que ya excluyen `cut` y `vaca_cabana`). Sobre esa
base agrega el filtro de castración para machos:

```ts
male,  isCastrated=false → ['ternero','torito','toro']
male,  isCastrated=true  → ['ternero','novillito','novillo']
female                   → FEMALE_CATEGORY_CODES  // 5 codes
```

`ternero` está en las dos ramas de macho a propósito: `computeCategoryCode` devuelve `ternero` para un macho
< 1 año **independientemente** de `is_castrated` (`0062`, rama macho). El filtro es **derivado** del espejo,
no una lista paralela.

### 2.3 "Incoherente con la edad" (RCM.4.3) — y por qué NO se reusa `AGE_WINDOWS`

`animal-category.ts` ya tiene una tabla `AGE_WINDOWS`, pero **no se toca ni se extiende**: su único consumidor
es `imputeBirthDateForCategory` y su semántica es *"¿esta categoría es age-**derivable** en el alta?"*. Un
code sin ventana ahí (`multipara`, `novillo`…) hace caer la imputación al midpoint ciego a propósito —
agregarle ventanas cambiaría la fecha imputada del alta year-only y **rompería el delta
`override-imputacion-categoria`** (regresión silenciosa).

Por eso la coherencia vive en un módulo nuevo (`category-pin.ts`) con su propia tabla, construida sobre las
MISMAS constantes (`ONE_YEAR_DAYS`, `TWO_YEAR_DAYS`, ahora exportadas) para que no haya números mágicos ni
drift numérico:

```ts
// category-pin.ts — ventanas de COHERENCIA (distinto de AGE_WINDOWS = derivabilidad en el alta).
const COHERENCE_WINDOWS = {
  ternero:  [0, ONE_YEAR_DAYS),   ternera:              [0, ONE_YEAR_DAYS),
  torito:   [ONE_YEAR_DAYS, TWO_YEAR_DAYS),  novillito: [ONE_YEAR_DAYS, TWO_YEAR_DAYS),
  toro:     [TWO_YEAR_DAYS, ∞),   novillo:              [TWO_YEAR_DAYS, ∞),
  vaquillona: [ONE_YEAR_DAYS, ∞),
  vaquillona_prenada / vaca_segundo_servicio / multipara: [ONE_YEAR_DAYS, ∞),
};

categoryAgeMismatch({chosen, sex, birthDate, isCastrated, today})
  → null  // sin birth_date, o code sin ventana, o edad dentro de la ventana
  → { ageDays, expectedCode }   // expectedCode = computeCategoryCode({sex, birthDate, isCastrated, events: []})
```

`expectedCode` es el **corte de edad puro** (sin eventos): responde "por edad le corresponde X" sin arrastrar
partos/tactos, que es lo que el aviso quiere decir. Su `name` se resuelve en el catálogo ya cargado; si no
resuelve, el aviso degrada a nombrar solo la edad (RCM.4.6). La edad legible sale de `formatAnimalAge`
(`utils/animal-age.ts`, es-AR: "8 meses" / "2 años 3 meses").

⚠️ **Anti-drift**: `category-pin.ts` lleva un banner igual al de `animal-category.ts` (RC6.5.1): si una
migración mueve los cortes de `compute_category`, se actualizan las tres cosas en el mismo commit (espejo,
`AGE_WINDOWS`, `COHERENCE_WINDOWS`).

### 2.4 El write

```sql
-- NUEVO builder (local-reads.ts) — caso FIJAR (RCM.5.1)
UPDATE animal_profiles SET category_id = ?, category_override = 1 WHERE id = ?

-- EXISTENTE (buildRevertCategoryOverrideUpdate) — caso VOLVER A AUTOMÁTICO (RCM.5.2)
UPDATE animal_profiles SET category_override = 0, category_id = ? WHERE id = ?
```

Un solo statement en los dos casos ⇒ **una sola CrudEntry** ⇒ un solo `PATCH` al subir. Eso importa: el
trigger `0040` distingue el revert del override manual **mirando el mismo UPDATE** (`old.category_override =
true AND new.category_override = false` → respeta el `false`), y `0030` escribe el `reason` correcto
(`manual_override` vs `revert_to_auto`) por la misma vía. Partirlo en dos UPDATEs rompería esa distinción.

El cliente escribe `category_override = 1` **explícitamente** aunque el trigger `0021`
(`tg_animal_profiles_set_override_on_manual`) lo pondría igual server-side: sin escribirlo, el espejo C6
LOCAL seguiría con `override = false` y recalcularía la categoría derivada por encima de la elegida →
la categoría "volvería sola" en pantalla hasta el próximo sync. El valor explícito es lo que hace que el pin
se vea **al instante y offline**.

### 2.5 Servicio y núcleo puro

```
setCategoryManual(profileId, chosenCode)                       // animals.ts (I/O)
  ├─ buildAnimalDetailQuery      → system_id
  ├─ buildCategoryByCodeQuery(system_id, chosenCode) → {id,name}   // null ⇒ error sin escribir (RCM.6.2)
  ├─ resolveRevertCategory(profileId) → {derivedCode, categoryId}  // MISMA resolución que "Quitar fijación"
  └─ decideCategoryPin({chosen, derived})                      // category-pin-core.ts (PURO)
         chosen.code === derived.code → write(buildRevertCategoryOverrideUpdate(profileId, derived.id))
         chosen.code !== derived.code → write(buildSetCategoryOverrideUpdate(profileId, chosen.id))
```

El núcleo puro existe por la misma razón que `cut-service-core.ts` (TCUT.7): los servicios value-importan el
SDK de Supabase/PowerSync y **no son importables bajo `node:test`**; la decisión se testea con fakes del
resolve y del write.

### 2.6 UI

- **Fila "Categoría"** en `DetailSection "Datos del animal"`, después de "Nacimiento". Molde exacto de
  `BreedRow`: `label muted / valor $5 600 / link "Cambiar" $primary` cuando es editable; solo lectura si no.
  Sobre un CUT, además del solo-lectura, un hint `$3 muted`: *"Quitá la marca CUT para cambiar la
  categoría."* (RCM.7.2).
- **`CategoryPickerSheet`** sobre `BottomSheetShell` (`title="Elegir categoría"`), molde `BreedPickerSheet`
  **sin buscador** (≤ 5 opciones). Dos fases internas:
  - `list` — filas tappables (alto ≥ `$touchMin`, check + borde `$primary` en la vigente).
  - `confirm` — pregunta + [aviso de edad, si hay] + consecuencia + footer fijo `Cancelar` / `Confirmar`.
  El shell aporta scrim con guard anti tap-through de web, arrastre, back de Android y la X. No hay texto
  tipeado → cerrar por cualquier vía cancela sin más (precondición 2 del shell evaluada: no aplica).
- **Optimismo en sitio** (convención dura de `docs/conventions.md`): al confirmar se hace
  `setDetail(d => ({...d, categoryCode, categoryName, categoryOverride}))` **antes** de esperar el write, sin
  tocar `loading`; si el write falla se revierte al snapshot y se muestra el error inline. Después, refresh
  silencioso (`load({ silent: true })`). Es el mismo patrón de `onSetCastrated` / `onSetCut`.

---

## §3 — Funcionalidad 2: tacto desde la ficha

### 3.1 El gating es el de la manga, literalmente

```ts
resolveFichaTactoOffer({ status, sex, categoryCode, isCastrated, reproStatus, rodeoConfig }):
  if (status !== 'active') return null;
  const animal = { sex, categoryCode, isCastrated, reproStatus };
  const prenez  = resolveManeuverGating('tacto', rodeoConfig).applies
               && appliesToAnimal('tacto', animal);
  const aptitud = resolveManeuverGating('tacto_vaquillona', rodeoConfig).applies
               && appliesToAnimal('tacto_vaquillona', animal);
  if (prenez) return 'prenez';       // precedencia defensiva (RTF.2.2); son disjuntos (RTF.2.1)
  if (aptitud) return 'aptitud';
  return null;
```

No hay lógica de dominio nueva: la capa animal es `maneuver-applicability.ts` (que ya encapsula el bug-B
resuelto en la manga: preñez solo a servidas, aptitud solo a vaquillonas no-aptas) y la capa rodeo es
`maneuver-gating.ts` sobre `fetchRodeoGating(detail.rodeoId)`. Si mañana cambia el criterio de la manga,
cambia el de la ficha **sin tocar este delta**.

**Sobre el mapeo `AnimalDetail → AnimalApplicabilityInfo`**: `carga.tsx` ya tiene
`toApplicabilityInfo(animal: AnimalDetail)` (línea ~1239) con exactamente estos campos. Se evaluó **levantarlo
a un util compartido** para no duplicarlo; se descartó para este delta porque tocaría el frame de la manga
(spec 03) por una ganancia chica: `resolveFichaTactoOffer` solo necesita 4 de los 6 campos (`aptitude` y
`ageDays` los consume únicamente `inseminacion`, que la ficha no ofrece) y los recibe **planos** en su firma,
así que no hay objeto duplicado sino una firma más angosta. Si aparece un **tercer** consumidor, ahí sí
corresponde extraer `animalApplicabilityFromDetail` a `maneuver-applicability.ts` y que los tres lo usen.

**Cambio en la ficha**: hoy `fetchRodeoGating` se llama solo para hembras y se guarda únicamente
`dientesEnabled: boolean`. Pasa a guardarse el `RodeoDataKeyMap` completo (`rodeoGating`), del que
`dientesEnabled` se deriva (`rodeoGating['dientes']?.enabled === true`) — un solo read, dos consumidores, cero
cambio de comportamiento del gate de CUT. Sigue resolviéndose solo para hembras (los dos tactos y el CUT son
female-only) con el mismo fail-safe conservador: sin resolver ⇒ mapa vacío ⇒ nada se ofrece.

### 3.2 Pantalla de captura: ruta, no sheet

`app/app/animal/tacto.tsx`, params `{ profileId, kind: 'prenez' | 'aptitud' }`, registrada en `_layout.tsx`.

Es una **ruta full-screen** y no un bottom sheet porque `TactoStep` / `TactoVaquillonaStep` son bloques
`flex: 1` que se reparten el alto del viewport (densidad ≥ 60%, lenguaje de manga aprobado en el spike M2.0):
meterlos en un sheet con `maxHeight: 85%` los degradaría a botones chicos, que es exactamente lo que la manga
no tolera. Precedente en la misma ficha: `app/animal/baja.tsx`.

Estructura:

```
[ back robusto (backOr → /animal/[id]) ]
[ identidad: hero (pickHeroIdentifier) + CategoryBadge ]      ← "a quién estoy tactando"
[ título: "Tacto de preñez" | "Tacto de aptitud" ]
[ TactoStep(buckets) | TactoVaquillonaStep ]                   ← flex:1, sin rediseño
[ error inline accionable si el write falla ]
```

- `useBusyWhileMounted()` (RTF.4.6) — anti-stacking del bastón, igual que la ficha y `agregar-evento`.
- Re-validación al montar con `resolveFichaTactoOffer` sobre un `fetchAnimalDetail` propio (RTF.4.4): la
  pantalla no confía en el param. Si ya no aplica → estado explicativo + salida, sin escribir.
- `busyRef` tomado **antes** de cualquier `await` (RTF.4.7), patrón `agregar-evento`.

**Buckets de tamaño** (RTF.4.3): `effectiveSizeBuckets(nMonths, undefined)`, con `nMonths` derivado de
`fetchRodeoServiceMonths(detail.rodeoId)` — que devuelve `ServiceResult<number[] | null>` (`null` = "sin
configurar") → `const nMonths = r.ok && r.value ? r.value.length : null`. El `undefined` es la decisión:
**sin jornada no hay override de "¿medir tamaño?"** (ese override vive en `sessions.config`), así que rige el
default del rodeo. Rodeo sin `service_months` → `[]` → PREÑADA persiste `'large'` directo (DD-PSC-2, ya
vigente), sin sub-paso.

### 3.3 El write ya existe

| kind | servicio | fila |
|---|---|---|
| `prenez` | `addTacto({ profileId, pregnancyStatus, eventDate: hoy })` | `reproductive_events` `event_type='tacto'`, `pregnancy_status`, **`session_id` NULL** |
| `aptitud` | `addTactoVaquillona({ profileId, fitness, eventDate: hoy })` | `reproductive_events` `event_type='tacto_vaquillona'`, `heifer_fitness`, **`session_id` NULL** |

Los dos son INSERT locales planos que ya están en producción (`addTacto` lo usa hoy "Agregar evento";
`addTactoVaquillona` lo usa el alta desde el delta `aptitud-reproductiva`). `created_by` /
`establishment_id` los fuerza el trigger `0077` al subir; `created_at` es de cliente (desempate
determinístico del estado repro del mismo día). **Cero código de datos nuevo para esta funcionalidad.**

### 3.4 Al volver a la ficha

`router.back()` → el `useFocusEffect` de la ficha corre `load({ silent: true })` (no es la primera carga) →
sin blanqueo, sin salto al tope. Lo que cambia, todo derivado offline de los espejos que ya existen:

- el evento aparece en "Historial de eventos" (`fetchTimeline`, lectura local);
- "Estado reproductivo" / "Aptitud reproductiva" se actualizan (`deriveReproStatus` / `deriveReproAptitude`);
- si el tacto fue positivo y `category_override = false`, el badge del hero salta a `vaquillona_prenada`
  (`hasPositiveTactoVigente` del espejo C6) — el server lo confirma al subir;
- si `category_override = true` (categoría fijada por la funcionalidad 1), **la categoría no se mueve**
  (RTF.7.4): el server lo respeta y el espejo también. Es la consecuencia que la confirmación de RCM.4.2
  anticipa;
- el CTA puede desaparecer solo (RTF.7.5): una vaquillona evaluada `apta` deja de cumplir
  `needsFitnessEvaluation`.

### 3.5 "Suelto pero visible en reportes" — verificación, no promesa

La pregunta del leader era si "sin jornada" y "visible en reportes" son compatibles sin una decisión de
producto adicional. **Lo son.** Lo verifiqué leyendo el SQL desplegado, no infiriéndolo:

| Reporte | ¿Filtra `session_id`? | Cómo entra el tacto |
|---|---|---|
| `rodeo_pregnancy_kpi` (`0106`) | **No** | `distinct on (animal_profile_id) … order by event_date desc, created_at desc` sobre `reproductive_events` `event_type='tacto'` |
| `rodeo_ccl_distribution` (`0106`) | **No** | ídem (mismo `last_tacto`) |
| `rodeo_calving_kpi` (`0106`) | **No** | ídem para `pregnant`; `calved` mira `birth` |
| `rodeo_calving_by_stage` (`0106`) | **No** | mira `birth` |
| `rodeo_serviced_females` (`0105`) — denominador | **No** | último `heifer_fitness` del animal (`order by event_date desc, created_at desc limit 1`) |
| `session_event_summary` / `rodeo_sessions_list` (`0106`) | **Sí** (es su razón de ser) | **no aparece**, correctamente |

**A qué período se imputa el tacto: a ninguno — y no hay que definirlo.** El `p_year` de un reporte selecciona
el **denominador** (las hembras servidas de esa campaña: membresía ACTUAL del rodeo ∩ `service_months` ∩
elegibilidad), no el evento. El tacto entra por la regla "**último tacto vigente del animal**", que no tiene
ventana temporal. Es decir: el tacto se imputa **por el animal y su rodeo actual**, exactamente igual que un
tacto de la manga — el `session_id` nunca participó del cómputo. Por eso RTF.8 se cierra con **tests** en la
suite de reportes (RTF.8.5) y no con una decisión de Raf.

Lo único que un tacto suelto no toca es el "Resumen de jornada" (R7.3), que por definición lista lo que pasó
en una jornada. No es una pérdida a compensar: es la semántica correcta.

**Riesgo pre-existente que este delta NO introduce ni resuelve** (candidato a `docs/backlog.md`): como la
regla "último tacto" no está acotada a la campaña consultada, el tacto más reciente de una hembra influye
también sobre el KPI de campañas **pasadas** que se consulten. Ya pasa hoy con los tactos de la manga. Este
delta lo mitiga en el margen fechando siempre HOY (RTF.6.1): el sesgo queda siempre "hacia adelante" (el dato
más nuevo), que es lo que un productor espera; habilitar back-dating lo empeoraría (de ahí P3).

---

## §4 — Schema SQL

**Ninguno.** Este delta no crea, altera ni borra tablas, columnas, tipos, índices, funciones ni triggers.
`git diff supabase/migrations/` debe quedar **vacío** (lo verifica una task de cierre). El único archivo que
se toca bajo `supabase/` es la **suite de tests** `supabase/tests/reports/run.cjs` (RTF.8.5), que no modifica
el schema.

Las columnas que se escriben ya existen y ya son escritas por otros flujos:

- `animal_profiles.category_id` / `.category_override` — las escriben hoy el alta, el revert (RC6.4), CUT
  (RCUT) y las transiciones automáticas.
- `reproductive_events` (`event_type`, `pregnancy_status`, `heifer_fitness`, `event_date`, `created_at`,
  `session_id` NULL) — las escriben hoy `addTacto` (desde "Agregar evento") y `addTactoVaquillona` (desde el
  alta).

---

## §5 — RLS y multi-tenancy (toca `establishment_id` → obligatorio explicitarlo)

Las dos tablas involucradas llevan `establishment_id` y están bajo RLS. **El cliente no replica autorización;
la RLS es la barrera real, al subir.**

- `animal_profiles` — el UPDATE de categoría pasa por la policy `animal_profiles_update`
  (`has_role_in(establishment_id)`). Un rechazo (42501) lo maneja `uploadData` (rollback del overlay +
  superficia por el canal de status, R10.8), **no** el return del servicio, que ya devolvió ok con la fila
  local. Idéntico a `setCut` / `setCastrated` / `setIdv`.
- `reproductive_events` — el INSERT pasa por `with check has_role_in(establishment_of_profile(...))`; el
  trigger `0077` **fuerza** `establishment_id` desde el perfil (por eso el cliente no lo manda) y
  `created_by` desde `auth.uid()`.
- **Regla de derivación del tenant en el cliente** (RCM.9.3 / RTF.10.3): todo lo que necesita contexto sale de
  `detail.establishmentId` / `detail.rodeoId` — del **perfil**, nunca de `EstablishmentContext`. Un usuario
  con rol en varios campos puede estar mirando la ficha del campo A con el campo B activo; el bug de IDOR
  clásico de esta pantalla es leer el contexto activo. Esta regla ya está establecida en la ficha
  (`onAssignTag` RCF.2.5, `canExit`, `fetchRodeoGating(detail.rodeoId)`); el delta la respeta sin excepción.
- **Gating capa 2 (`0054`)** — el trigger `tg_reproductive_events_gating` corre en el INSERT y exige, por
  rodeo, `prenez`+`tamano_prenez` (tacto) o `tacto_vaquillona` (aptitud). El gate de cliente (RTF.1.4) es
  **prevención de UX**, no autorización: no se ofrece lo que el server rechazaría con 23514.
- **Gating por ATRIBUTOS del animal**: sigue siendo **solo de cliente**, igual que en la manga. El trigger
  `0054` gatea por rodeo/`data_key`, no por sexo/categoría/estado reproductivo — hueco pre-existente, ya
  registrado en `docs/backlog.md` (entrada 2026-07-10, riesgo BAJO: requiere auth + rol en el propio tenant,
  el daño es calidad de dato auto-infligida). **Este delta no lo agrava ni lo cierra**: usa exactamente el
  mismo perímetro que la manga.

---

## §6 — Offline-first y PowerSync

Principio 3 de `CLAUDE.md`: los dos flujos son de carga en campo, así que andan sin señal, sin excepción.

- **Sin buckets nuevos, sin schema de PowerSync nuevo**: `animal_profiles` y `reproductive_events` ya
  sincronizan; el catálogo `categories_by_system` y `rodeo_data_config` ya bajan por sus streams; los reads
  (`fetchRodeoCategoryCatalog`, `fetchRodeoGating`, `fetchRodeoServiceMonths`, `resolveRevertCategory`,
  `fetchTimeline`) son **todos** SQLite local.
- **Escrituras**: CRUD plano → una CrudEntry por acción → `uploadData` al reconectar. Éxito local inmediato.
- **Conflictos**: last-write-wins, el default del repo. Para la categoría es el comportamiento correcto (el
  último que decidió manda) y el server no la va a pisar mientras `override = true`. Para el tacto no hay
  conflicto posible: es un INSERT con `id` de cliente (UUID v4); un reintento at-least-once pisa la misma PK.
- **Lo que NO está disponible offline** (y por eso no se promete en la UI): el nodo `category_change` del
  timeline (lo escribe el trigger `0030` server-side, RCM.8.3) y la propagación de `is_castrated` a
  `animals`. Mismo comportamiento que CUT/castración hoy.
- **Reportes**: siguen siendo online-only por diseño (`reports.ts`, R7.2.1). Que el tacto sea visible en
  reportes significa "cuando el reporte se consulta con conexión y el evento ya sincronizó" — no cambia nada
  respecto de un tacto de la manga.

---

## §7 — Interacción entre las dos funcionalidades (y con lo que ya existe)

| Situación | Comportamiento |
|---|---|
| Categoría fijada + tacto positivo | El tacto se registra; la categoría **no** transiciona (override manda, server y espejo). Anticipado en la confirmación (RCM.4.2). |
| Categoría fijada a `multipara` | El animal entra al conjunto "probadas servidas" del denominador `0105` (que lee `c.code`) ⇒ **cambia los reportes reproductivos**. Es la semántica correcta de "esta vaca es multípara"; queda documentado acá, no en el copy (no se le explica el denominador al peón). |
| Categoría fijada a `ternera` | La saca del denominador y del ofrecimiento de tacto (`appliesToAnimal` mira `categoryCode`) ⇒ el CTA desaparece. Coherente. |
| Animal CUT | No se ofrece "Cambiar" (RCM.7.2) ni tacto (`reproStatus.kind === 'cut'` no cumple ninguno de los dos predicados). |
| Animal archivado | Ni categoría ni tacto (`status !== 'active'`), igual que el resto de las acciones de la ficha. |
| Macho | Sin CTA de tacto (los dos predicados exigen `sex === 'female'`); la fila "Categoría" sí se ofrece, con las opciones de macho. |
| "Quitar fijación" (RC6.4) | Intacta. Es el atajo; el selector es el camino general y RCM.5.2 hace que elegir la automática produzca el MISMO write. |
| Castración (R13.1) | Intacta y sigue siendo el único control del eje entero↔castrado (RCM.7.5). Cambiar "Castrado" recalcula la categoría **sin** fijarla; el selector filtra sus opciones por el `is_castrated` resultante. |

---

## §8 — Alternativas descartadas

1. **Ofrecer las 5 categorías de macho y acoplar el flip de `is_castrated` en el mismo UPDATE.** Descartada:
   un efecto colateral oculto sobre un dato que tiene su propio control visible dos secciones más arriba
   (Nielsen #1). Si se muestra el efecto, la confirmación pasa a tener tres líneas de texto en una pantalla
   que se lee al sol con guantes. La opción elegida (filtrar por castración) deja el mismo resultado alcanzable
   en dos taps obvios y **sin ningún estado auto-contradictorio posible**. → es P1: si Raf prefiere las 5, es
   una línea en `pickableCategories` + una en el copy.
2. **Bottom sheet para el tacto en vez de una ruta.** Descartada: `TactoStep`/`TactoVaquillonaStep` son
   bloques `flex: 1` calibrados para ocupar el viewport (lenguaje de manga aprobado en M2.0); dentro de un
   sheet al 85% con header y footer fijos quedan botones chicos. Rediseñarlos en versión "chica" crearía una
   segunda variante del mismo control → drift visual y de comportamiento entre la manga y la ficha.
3. **Reusar el `TactoForm` de `agregar-evento` (selector de `PREGNANCY_OPTIONS` + fecha).** Descartada: es un
   form de escritorio (radio + fecha tipeada), no de manga; y es justamente el que está sin gatear (RTF.9). Se
   retira en vez de extenderse.
4. **Extender `AGE_WINDOWS` de `animal-category.ts` con los codes faltantes** en vez de crear
   `COHERENCE_WINDOWS`. Descartada: cambiaría el comportamiento de `imputeBirthDateForCategory` (alta
   year-only) → regresión silenciosa del delta `override-imputacion-categoria`. Dos semánticas distintas
   ("derivable" vs "coherente") con dos tablas, ambas sobre las mismas constantes.
5. **Inventar mínimos etarios para `multipara` / `vaca_segundo_servicio` / `vaquillona_prenada`** (ej. "una
   multípara tiene ≥ 3 años"). Descartada: es dominio de Facundo y no está validado. Se usa el único piso que
   el modelo ya asserta (365 d) y se deja P5 explícito.
6. **Crear una `sessions` "de a uno" para que el tacto de la ficha caiga en el Resumen de jornada.**
   Descartada: contradice C2.3 (Raf pidió suelto), ensucia la lista de jornadas del rodeo con una sesión por
   animal, y **no hace falta** — los KPI reproductivos nunca miraron `session_id` (§3.5).
7. **Modelar la imputación del tacto a una campaña** (columna/derivación de "a qué campaña pertenece este
   tacto"). Descartada para este delta: sería un cambio de modelo de datos y de los 4 reportes, que aplica
   igual a los tactos de la manga — no es un problema del tacto suelto. Queda como candidato de backlog
   (acotar `last_tacto` a la ventana de la campaña consultada).
8. **Poner la fila "Categoría" en la sección "Manejo".** Descartada: "Manejo" hoy es solo-machos (castrado /
   futuro torito) + la rama CUT de hembras; la categoría es un dato de identidad del animal y su vecino
   natural es "Nacimiento" (del que se deriva). Además "Datos del animal" ya tiene el precedente exacto de
   una fila editable con "Cambiar" (Raza).

---

## §9 — Gates

- **Gate 0** — cerrado por Raf en conversación (2026-08-06); transcripto en el §"Contexto cerrado" de
  `requirements-ficha-categoria-tacto.md`. Deja 5 decisiones derivadas (P1–P5) explícitas para la Puerta 1.
- **Gate 1 (spec security) — N/A.** Criterios de ADR-019: ¿RLS? no se crea ni modifica ninguna policy.
  ¿Schema sensible? cero migraciones (§4). ¿Edge Functions? no. ¿Auth/tokens/secrets? no. ¿Datos regulados
  (SENASA/PII)? no — ni caravanas ni PII; la categoría no viaja a SIGSA (viaja la raza). Los dos writes usan
  caminos server-side ya vigentes y **ya ejercitados desde esta misma pantalla**. Verificación objetiva para
  el leader: `git diff supabase/migrations/ supabase/functions/` vacío al cerrar. El leader documenta el salto
  en `progress/current.md` (ADR-019).
- **Gate 2 (code security) — sí**, como siempre. Focos sugeridos: (a) que el tenant salga del perfil y no del
  contexto activo en las dos afordancias; (b) que `setCategoryManual` no escriba nada cuando el `category_id`
  no resuelve (evitar un 23514 al subir); (c) que la ruta `animal/tacto` re-valide el ofrecimiento y no
  confíe en el param `kind`.
- **Gate 2.5 (E2E + capturas + veto visual, ADR-029) — sí**: hay UI nueva. Lista de capturas en
  `requirements-ficha-categoria-tacto.md` § "Cobertura de tests".

---

## §10 — Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| `animal/[id].tsx` tiene ~2900 líneas y hay otras unidades tocando la app | Los cambios son locales y aditivos (una fila, un CTA, dos montajes de overlay/nav) + `rodeoGating` que reemplaza un booleano. No se toca `StickStatusIndicator` ni `nav-target-bands*`. |
| Quitar el `TactoForm` de `agregar-evento` puede romper un E2E existente | Barrer `app/e2e/**` por "Tacto" antes de borrar; `events.spec.ts` es el candidato. Task explícita. |
| Drift entre las ventanas de coherencia y los cortes de `compute_category` | `COHERENCE_WINDOWS` se construye con `ONE_YEAR_DAYS`/`TWO_YEAR_DAYS` exportados + banner anti-drift + unit con las fronteras exactas. |
| Consumir componentes de la manga desde la ficha podría regresionar la manga | Se consumen **sin cambios de props ni de comportamiento**; task de no-regresión corriendo `maniobra-carga.spec.ts`. |
| El pin de categoría mueve reportes sin que el usuario lo note | Documentado en §7; el copy sí anticipa lo que el usuario puede entender ("no se va a actualizar sola"). No se le explica el denominador. |
</content>
</invoke>
