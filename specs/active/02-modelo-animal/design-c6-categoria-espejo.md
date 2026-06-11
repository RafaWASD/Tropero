# Spec 02 — C6: espejo client-side de categoría + visibilidad del override — Design

**Fuente**: `context-c6-categoria-espejo.md` (Gate 0 ✅) + `requirements-c6-categoria-espejo.md` (RC6.x).
**Alcance**: frontend puro. Cero migraciones, cero RLS nueva, cero triggers. Gate 1 N/A (si algún paso descubre necesidad de backend → finding al leader, no se implementa acá).

---

## 1. Archivos a crear / modificar

| Archivo | Cambio |
|---|---|
| `app/src/utils/animal-category.ts` | **Extender**: `computeCategoryCode` (espejo completo de 0062) + helpers de derivación/inferencia. `computeInitialCategoryCode`/`categoryOverrideFor` pasan a delegar (RC6.1.5). Header con nota anti-drift (RC6.5.1). |
| `app/src/utils/animal-category.test.ts` | **Extender**: fixtures espejo de la matriz RT2.x (RC6.1.6) + casos de inferencia/tie-break (RC6.2.1, RC6.1.4). Tests existentes quedan verdes sin tocar. |
| `app/src/services/powersync/local-reads.ts` | **Extender**: proyectar `category_override`, `animal_birth_date`, `r.system_id` en lista/búsqueda; `r.system_id` en detalle. **Nuevos builders**: `buildCategoryMirrorEventsQuery(profileIds)` y `buildRevertCategoryOverrideUpdate(profileId, categoryId)`. |
| `app/src/services/powersync/local-reads.test.ts` (o suite equivalente) | Tests de los builders nuevos/extendidos (mismo patrón puro node:test del swap T3/T4). |
| `app/src/services/animals.ts` | **Extender**: inyección del espejo en `fetchAnimals` / búsqueda / `fetchAnimalDetail` (capa service → todas las superficies lo heredan); `revertCategoryOverride(profileId)`. |
| `app/app/animal/[id].tsx` | Indicador "Categoría fijada manualmente" + acción "Quitar fijación" (D2). El hero ya recibe `detail.categoryOverride`. |
| `app/e2e/events.spec.ts` | Re-verificación de los tests dependientes del gap + 2 tests C6 nuevos (espejo tacto→badge derivado; override badge + quitar fijación). |
| `app/e2e/helpers/admin.ts` | **As-built:** `seedAnimal` extendido con `categoryCode`/`categoryOverride`/`birthDate` (para sembrar una categoría fijada a mano en el e2e del override). |
| `specs/active/02-modelo-animal/design-tier2-categorias.md` | Nota aditiva de mantenimiento anti-drift (RC6.5.2). |

## 2. Módulo puro (RC6.1)

Firma propuesta (nombres finales a criterio del implementer, la **semántica** es contractual):

```ts
/** Evento reproductivo crudo del SQLite local (synced u overlay). */
export type ReproEventInput = {
  eventType: string;            // 'birth' | 'weaning' | 'service' | 'tacto' | 'abortion' | otros (ignorados)
  eventDate: string;            // 'YYYY-MM-DD'
  createdAt: string | null;     // timestamptz texto; null = fila local recién insertada (RC6.1.4)
  pregnancyStatus: string | null;
};

export type CategoryMirrorInputs = {
  sex: AnimalSex;
  birthDate: string | null;     // ISO o null
  isCastrated: boolean;         // inferido por el caller (RC6.2.1)
  events: readonly ReproEventInput[];  // SOLO no-borrados (el SQL ya filtra deleted_at)
  today?: Date;                 // inyectable para tests
};

export function computeCategoryCode(inputs: CategoryMirrorInputs): MirrorCategoryCode;
```

Decisiones:

- **Toda la decisión vive en TS** (incluido el conteo de partos, has_weaning/has_service y el tacto+ vigente con la tupla `(event_date, created_at)`): el SQL solo trae filas crudas. Una sola implementación espejo, 100% cubierta por fixtures — replicar los `EXISTS`/`COUNT` de 0062 en SQL de SQLite sería un **segundo** espejo (más superficie de drift). *(Alternativa descartada #1.)*
- Tie-break RC6.1.4: `createdAt === null` ⇒ se trata como "ahora" (posterior a cualquier `createdAt` presente) a igualdad de `eventDate`. **Reconciliación as-built (2026-06-11):** entre DOS eventos con el mismo `eventDate` y ambos `createdAt` null (caso REALISTA offline: tacto y aborto el MISMO día, ambos cargados por CRUD plano en este dispositivo → los dos created_at quedan null hasta el sello del trigger al subir), el desempate es por el **ÍNDICE en el array** (la query viene `ORDER BY event_date, created_at` → con ambos null el orden es el de inserción/rowid local) — el de índice MAYOR es posterior. Sin esto, un `isAfter` que devolviera `false` para dos null dejaba al aborto sin revertir el tacto+ → badge "Vaquillona preñada" erróneo tras un aborto offline (lo cazó el e2e de aborto). El sello server-side al subir converge (el aborto insertado después tendrá created_at mayor). Comparación de `createdAt` presentes por `Date.parse` con fallback lexicográfico (PowerSync materializa el texto de PG; formato uniforme). `isAfter(a, ai, b, bi)` toma ambos índices.
- `computeInitialCategoryCode(sex, birthDate, {pregnant})` ≡ `computeCategoryCode({sex, birthDate, isCastrated: false, events: pregnant ? [tactoSintético+] : []})` — delega, no duplica (RC6.1.5).
- Inferencia `is_castrated` (RC6.2.1): helper puro `inferIsCastrated(storedCode)` → `storedCode ∈ {'novillito','novillo'}`. Limitación documentada en el header (RC6.2.2).
- Resolución de display: helper puro `deriveDisplayCategory({ storedCode, storedName, categoryOverride, derivedCode, catalog })` → `{ code, name }`; con `override=true` o `derivedCode` irresoluble en `catalog` → stored (RC6.3.3/RC6.3.4).

## 3. Lecturas locales (de dónde sale cada input)

Todo del SQLite local (RC6.3.6); cero red:

| Input | Fuente local |
|---|---|
| `sex`, `birth_date` | `animal_profiles.animal_sex` / `animal_birth_date` (b1, 0079) — ya proyectados en detalle; **se agregan a la lista** |
| `category_override`, `category_id`/`code`/`name` guardados | `animal_profiles` + JOIN `categories_by_system` (ya proyectados en detalle; `category_override` **se agrega a la lista**) |
| `system_id` (para resolver code→id/name del catálogo) | `rodeos.system_id` vía el JOIN ya existente — **se agrega la proyección** en lista y detalle |
| eventos reproductivos | `reproductive_events` local (incluye tactos/servicios/destetes/abortos cargados offline por CRUD plano) + `pending_reproductive_events` (partos optimistas del overlay) |
| catálogo code→name | `categories_by_system` local (stream global ya sincronizada) — reusa `buildSystemCategoriesQuery(systemId)` |
| `is_castrated` | **NO disponible** (ver §7 finding) → inferencia RC6.2.1 desde el code guardado |

Builder nuevo (batched, sirve para la ficha con 1 id y para la lista con ≤200):

```sql
-- buildCategoryMirrorEventsQuery(profileIds)
SELECT animal_profile_id, event_type, event_date, created_at, pregnancy_status
FROM reproductive_events
WHERE animal_profile_id IN (?, …) AND deleted_at IS NULL
  AND event_type IN ('birth','weaning','service','tacto','abortion')
UNION ALL
SELECT animal_profile_id, event_type, event_date, created_at, NULL
FROM pending_reproductive_events
WHERE animal_profile_id IN (?, …)
ORDER BY event_date ASC, created_at ASC
```

Notas: el overlay no tiene `pregnancy_status` ni `deleted_at` (solo porta partos optimistas de `register_birth`; los tactos offline van por CRUD plano directo a `reproductive_events`) → proyecta `NULL`. El filtro `event_type IN (…)` espeja el gate del trigger 0063 (no acarrear eventos irrelevantes).

## 4. Inyección en la vista (RC6.3)

**En la capa service** (`animals.ts`), no en cada screen. **Reconciliación as-built (2026-06-11):** el helper se llama `computeMirrorOverrides(rows)` (no `applyCategoryMirror`) y delega la DECISIÓN a un núcleo PURO `computeDisplayOverrides(rows, eventsByProfile, catalogBySystem)` exportado de `animal-category.ts` — así la lógica display-only es 100% testeable sin SDK y, por ser pura, **estructuralmente incapaz de escribir** (RC6.3.5 sin depender solo de tests). `computeMirrorOverrides`:

1. junta los `profileId` con `category_override = false` (+ con `system_id`; sin él → fail-safe a la guardada);
2. una query batched de eventos (builder de §3) + el catálogo `code→name` por `system_id` distinto (MVP: uno solo, bovino/cría);
3. delega al núcleo puro: por fila `isCastrated = inferIsCastrated(storedCode)` → `computeCategoryCode(...)` → `deriveDisplayCategory(...)`;
4. devuelve un `Map<profileId, {code,name}>`; el caller (`fetchAnimals`/búsqueda/`fetchAnimalDetail`) pisa `categoryCode`/`categoryName` del item **solo en memoria** (display-only, RC6.3.5). Las dos únicas operaciones de DB son SELECT (`runLocalQuery`); NUNCA un `execute`/write.

Lo consumen `fetchAnimals`, la búsqueda (mismas filas) y `fetchAnimalDetail` → lista, find-or-create y ficha lo heredan sin tocar componentes (`AnimalRow`/`CategoryBadge` no cambian para D1). Shapes públicos (`AnimalListItem`, `AnimalDetail`) **no cambian**.

Perf: lista ≤200 filas ⇒ 1 query extra batched sobre `reproductive_events` local + cómputo O(eventos) en memoria. Aceptable para SQLite local; si pesara, el fallback es computar solo para las filas visibles (no se especifica ahora — YAGNI).

## 5. Badge + quitar fijación (RC6.4)

- **Indicador**: en la ficha, cuando `detail.categoryOverride === true`, una fila/pill bajo el hero con "Categoría fijada manualmente". El punto sutil del `CategoryBadge` se conserva. **As-built (2026-06-11):** componente `CategoryOverrideCard` en `[id].tsx`, debajo del hero (justo después del `ArchivedBadge`): card `$surface` + borde/ícono(`Pin`)/texto `$primary` (firma RAFAQ, NO terracota — no es alerta), copy "Categoría fijada manualmente". El a11y label del `CategoryBadge` con override lleva el sufijo ", fijada manualmente" (ya existente).
- **Acción**: "Quitar fijación" con confirmación inline (la card expande Cancelar / "Sí, quitar"). Gating (RC6.4.2): `status === 'active'` (la card solo ofrece la acción para un animal activo); se ofrece a cualquier rol activo — la RLS `animal_profiles_update` es la barrera real (mismo razonamiento que el control de Lote en la ficha; R4.10 base habilita a cualquier rol activo).
- **Consecuencia visible (As-built 2026-06-11, fix-loop veto de diseño — RC6.4.6):** al expandir la confirmación, la card ANTICIPA a qué categoría AUTOMÁTICA volvería el animal con una línea de tipografía secundaria (`$3`/`$textMuted`, no compite con los botones): **"La categoría pasará a {name}."** usando el NAME legible del catálogo (no el `code`). El name lo aporta `previewRevertCategory(profileId)` (service, solo lectura) que reusa la MISMA resolución que el write (`resolveRevertCategory`) ⇒ lo anticipado == la categoría a la que aterriza el revert (no pueden divergir). Si la derivada NO es resoluble localmente (RC6.4.5), `previewRevertCategory` devuelve `null` → la línea se omite (el flujo de error del revert manda si el usuario confirma igual). Nielsen #1 (visibilidad del estado) + #5 (prevención de error). El a11y label de la línea replica el copy.
- **Write** (`revertCategoryOverride(profileId)` en `animals.ts`): comparte con el preview la **resolución de la derivada** (`resolveRevertCategory`, As-built 2026-06-11 — extraída del cuerpo del revert para que preview y write no diverjan):
  1. lee el detalle local + eventos (mismos builders) → `derivedCode = computeCategoryCode(...)` con `isCastrated = false` (con override=true el code guardado es manual → la inferencia no es confiable; hoy nada setea `is_castrated=true`, así que `false` espeja al server — documentado);
  2. resuelve `categoryId` **+ `name`** con `buildCategoryByCodeQuery(systemId, derivedCode)` (As-built 2026-06-11: hermano de `buildCategoryIdByCodeQuery` que además proyecta el `name` — el id para el UPDATE, el name para la consecuencia; `buildCategoryIdByCodeQuery` se conserva intacto para el alta/eventos); irresoluble → error es-AR, sin write (RC6.4.5);
  3. `buildRevertCategoryOverrideUpdate`: `UPDATE animal_profiles SET category_override = 0, category_id = ? WHERE id = ? AND deleted_at IS NULL` — **un solo statement** ⇒ una CrudEntry con ambas columnas ⇒ un solo UPDATE PostgREST al subir ⇒ `0040` ve `old.override=true ∧ new.override=false` en el mismo statement y respeta el revert; `0030` graba `revert_to_auto`; `0021` re-valida la categoría contra el sistema del rodeo.
  4. la ficha recarga: `category_override=false` ⇒ el espejo toma el display de ahí en más.
- **Offline** (RC6.4.4): CRUD plano sobre tabla sincronizada (mismo camino que `assignAnimalToGroup`, ya probado en spec 15) — éxito local inmediato, RLS al subir. El preview de la consecuencia también es offline-safe (solo lectura del SQLite local, mismos builders).

Corrección de precisión sobre el context.md: **no existe** un trigger server-side que recompute al limpiar el override solo (0040 solo respeta el revert; el cron 0066 es targeted a rezagados de edad). El patrón as-built (T2.5/T2.30) es que **el cliente aporta el `category_id` recalculado** en el mismo UPDATE — antes online vía RPC `compute_category`, ahora vía espejo (offline-capable). Riesgo aceptado: si el espejo driftea, el revert escribe un valor desviado, pero con `override=false` el próximo evento/trigger/cron lo corrige (misma exposición que tenía el flujo online as-built).

## 6. Matriz de fixtures espejo (RC6.1.6)

Suite en `animal-category.test.ts`, casos 1:1 con `supabase/tests/animal/run.cjs`:

| Fixture cliente | Caso server | Qué fija |
|---|---|---|
| macho 180d/400d/800d/null × entero/castrado | T2.21 (RT2.3.x) | cortes 1/2 años + default + eje castración |
| hembra 180d/550d/null sin eventos | T2.22 (RT2.4.x) | cortes + default conservador |
| ternera + service; preñada + service | T2.23 (RT2.5.x) | servicio gradúa; no retrocede preñada |
| ternero/a + weaning (entero/castrado); torito + weaning | T2.24 (RT2.6.x) | destete gradúa; no retrocede |
| vaquillona/ternera + birth; 2º birth; mellizos = 1 evento | T2.25 (RT2.7.1/2) | partos desde cualquier categoría; conteo por evento |
| tacto+ → abortion posterior; abortion anterior a tacto+; multípara aborta | T2.26/T2.29 (RT2.7.3-5) | reversión por aborto + orden (event_date, created_at) |
| revert con castrado 400d → novillito | T2.30 (RT2.11.2) | el cómputo del revert con `isCastrated` explícito |
| `createdAt: null` en el tie-break | — (RC6.1.4) | semántica offline propia del espejo |
| inferencia `novillito`/`novillo` → true; resto → false | — (RC6.2.1) | inferencia |

**As-built (2026-06-11):** la suite agrega además (a) tests de **PRECEDENCIA load-bearing** (RC6.1.2) que fallarían si 0062 reordenara las ramas — births>tacto+, tacto+>vaquillona, corte-2años>destete en macho, y la secuencia T2.29 service+tacto+parto→vaca; (b) el caso REALISTA del tie-break `createdAt null` en AMBOS eventos del mismo día (tacto+aborto offline) resuelto por índice de array (ver §2); (c) tests del núcleo puro `computeDisplayOverrides` (RC6.3.1–RC6.3.4) y de `deriveDisplayCategory`/`inferIsCastrated`.

## 7. Findings para el leader (no se especifican acá — exigen backend)

1. **`is_castrated` no está en el SQLite local**: `animals` está fuera del sync set (b1) y `0079` no lo denormalizó. El context-c6 afirmaba "todos los inputs disponibles localmente" — es falso para este input. Workaround frontend (inferencia RC6.2.1) es correcto **hoy** porque ningún write-path productivo setea `is_castrated=true`. Cuando llegue el toggle de castración (ficha / spec 10), hay que **denormalizar `is_castrated` sobre `animal_profiles`** (migración estilo b1/0079) y pasar el input real al espejo.
2. **Tabla `animals` muerta en AppSchema**: declarada en `schema.ts` con comentario "llega por est_animals", pero esa stream no existe (`rafaq.yaml` la excluye). Siempre vacía localmente; conviene limpiar la declaración o el comentario (housekeeping de spec 15, no de este chunk).

## 8. Alternativas descartadas

1. **Réplica de los agregados en SQL de SQLite** (EXISTS/COUNT espejando 0062 en los builders): crearía un segundo espejo de la máquina de estados (SQL local + TS) → doble superficie de drift y fixtures imposibles de unificar. Se trae crudo y se decide en TS (una sola implementación testeada).
2. **Revert "override-only"** (UPDATE solo de `category_override=false`, dejando que el server recalcule): no hay trigger que recompute al limpiar el override y el cron 0066 es targeted por edad ⇒ la categoría guardada (posiblemente manual y errónea) quedaría server-side indefinidamente sin un evento posterior. Descartada; se mantiene el patrón as-built cliente-aporta-el-recalculado.
3. **Revert online vía RPC `compute_category` + offline vía espejo**: dos caminos para el mismo write — más código, divergencia de comportamiento, y rompe offline-first sin ganancia real (el espejo ya está testeado contra la misma matriz).
4. (Re-confirmadas del Gate 0, no se reabren): escritura optimista/overlay de categoría; cartelito-solo sin espejo.

## 9. Offline-first / multi-tenant

- **Offline-first explícito** (CLAUDE.md ppio 3): el display deriva 100% de SQLite local (RC6.3.6) y el revert es CRUD plano offline-safe (RC6.4.4). Sin red no cambia nada del comportamiento.
- **Multi-tenant**: sin RLS nueva (frontend puro). El revert pasa por la RLS `animal_profiles_update` existente al subir; las lecturas locales ya vienen scopeadas por las sync streams (no se re-filtra tenant, regla del swap spec 15). Nada se hardcodea: `establishment_id`/ids llegan por params.
