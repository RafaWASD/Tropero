# Spec 02 — Delta APTITUD REPRODUCTIVA + estado reproductivo visible — Design

**Fuente**: `context-aptitud-reproductiva.md` (Gate 0 ✅) + `requirements-aptitud-reproductiva.md` (RAR.x).
**Alcance**: **frontend puro**. Cero migraciones, cero RLS nueva, cero triggers/RPC, cero cambios de schema. **Gate 1 N/A** (ver §"¿Toca DB?"). Patrón: espejo client-side display-only (C6) + reuso de `deriveCurrentState` + fix de aplicabilidad per-animal (spec 03 M3.1).

> **Nota de delta (ADR-028)**: el baseline (`requirements.md`/`design.md`/`tasks.md` y los deltas previos) NO se reescribe. Al cerrar este delta (Puerta 2) se folda al `design.md` baseline un puntero en "Deltas posteriores" + nota as-built bajo el/los `R<n>` afectados (R10/R14 estado actual de la ficha; R4 alta).

---

## 1. Archivos a crear / modificar

| Archivo | Cambio |
|---|---|
| `app/src/utils/repro-status.ts` *(nuevo)* | Módulo **puro**: `deriveReproAptitude(events)` (último `tacto_vaquillona` → `heifer_fitness`), `deriveReproStatus(input)` (single-slot, RAR.2.4) reusando `deriveCurrentState` para preñez, `isReproApt(input)` (apta/probada → para inseminación), `reproStatusLabel(status)` (es-AR, RAR.3.4). Header anti-drift (RAR.8.3). |
| `app/src/utils/repro-status.test.ts` *(nuevo)* | Matriz de fixtures de la precedencia RAR.2.4 + edge cases RAR.7.4–7.6 + `isReproApt` (RAR.6). `node:test` puro (patrón `animal-category.test.ts`). |
| `app/src/utils/maneuver-applicability.ts` | **Extender** `AnimalApplicabilityInfo` con `aptitude: HeiferFitness | null`; agregar `case 'inseminacion'` a `appliesToAnimal` (RAR.6) — saca el `default: return true` para ese kind. |
| `app/src/utils/maneuver-applicability.test.ts` | Casos de inseminación (RAR.6.2–6.6). |
| `app/src/services/powersync/local-reads.ts` | **Nuevo builder** `buildReproBadgeEventsQuery(profileIds)` (batched; proyecta `heifer_fitness`/`service_type` además de los repro determinantes). **Nuevo builder** `buildAddTactoVaquillonaInsert(...)` (alta, **sin** `session_id`). Proyectar `ap.is_cut` en `LOCAL_LIST_SELECT` (hoy solo en detalle). |
| `app/src/services/powersync/local-reads.test.ts` | Tests de los builders nuevos. |
| `app/src/services/animals.ts` | `computeReproStatuses(rows)` (batched, espeja `computeMirrorOverrides`): por hembra → `deriveReproStatus`; pisa un campo nuevo `reproStatus` en `AnimalListItem` (display-only). Igual en `fetchAnimalDetail` para la ficha. Lee `is_cut` de la fila. |
| `app/src/services/events.ts` | `addTactoVaquillona({ profileId, fitness, eventDate })` — CRUD plano local, espeja `addTacto` (line 343). |
| `app/src/components/AnimalRow.tsx` | `ReproStatusChip` + prop `reproStatus?` → chip en el subtítulo (junto al `CategoryBadge`, vista normal). |
| `app/app/animal/[id].tsx` | Sección "Estado actual": fila "Aptitud reproductiva" (RAR.4.1) + extender "Estado reproductivo" con "Servida sin tacto" (RAR.4.2). |
| `app/app/crear-animal.tsx` | Paso 4: prompt de aptitud gateado a `vaquillona` (RAR.1.1/1.2, reusa `TactoVaquillonaStep`); estado `heiferFitness`; post-create soft-fail → `addTactoVaquillona` (RAR.1.3–1.5). |
| `app/e2e/animals.spec.ts` / `events.spec.ts` | e2e: alta vaquillona "Sí, apta" → chip "Apta"; "Aún no sé" → no servida; inseminación saltada en macho/no_apta (RAR.1/RAR.3/RAR.6). |

## 2. Módulo puro `repro-status.ts` (RAR.2)

Reusa lo que ya existe; **no reinventa** la preñez. Firma propuesta (semántica contractual, nombres a criterio del implementer):

```ts
import { deriveCurrentState, type PregnancyState, type TimelineItem } from './event-timeline';
import type { HeiferFitness } from './maneuver-sequence';

/** Evento reproductivo crudo del SQLite local (mismo shape lean que el espejo C6, + heifer_fitness/serviceType). */
export type ReproEventInput = {
  eventType: string;            // 'tacto'|'birth'|'abortion'|'service'|'tacto_vaquillona'|otros
  eventDate: string;            // 'YYYY-MM-DD'
  createdAt: string | null;     // null = fila local recién insertada (null-as-newest, RC6.1.4)
  pregnancyStatus: string | null;
  heiferFitness: HeiferFitness | null;  // solo en 'tacto_vaquillona'
  serviceType: string | null;           // solo en 'service'
};

/** Último veredicto de aptitud (RAR.2.1): último 'tacto_vaquillona' por (event_date, created_at) null-as-newest. */
export function deriveReproAptitude(events: readonly ReproEventInput[]): HeiferFitness | null;

/** Estado single-slot del badge (RAR.2.4). */
export type ReproStatus =
  | { kind: 'none' }                                            // macho / ternera (RAR.2.4.1)
  | { kind: 'fitness'; fitness: HeiferFitness }                 // Apta / Diferida / No apta (RAR.2.4.5)
  | { kind: 'pregnant'; status: 'small' | 'medium' | 'large' } // Preñada (RAR.2.4.3)
  | { kind: 'empty' }                                           // Vacía (RAR.2.4.3)
  | { kind: 'served_untested' }                                 // Servida sin tacto (RAR.2.4.4)
  | { kind: 'cut' }                                             // No apta por CUT (RAR.2.4.2)
  | { kind: 'unknown' };                                        // Sin evaluar (RAR.2.4.6)

export type ReproStatusInput = {
  sex: 'male' | 'female' | null;
  categoryCode: string | null;
  isCut: boolean;
  events: readonly ReproEventInput[];   // del SQLite local (synced + overlay), no borrados
};

export function deriveReproStatus(input: ReproStatusInput): ReproStatus;
export function reproStatusLabel(s: ReproStatus): string | null;   // es-AR, null si 'none'
```

**Derivación (RAR.2.4, precedencia load-bearing):**

1. `sex !== 'female'` **o** `categoryCode === 'ternera'` → `none` (RAR.2.4.1).
2. `isCut` → `cut` ("No apta", RAR.2.4.2) — leído de `is_cut`, **sin** columna nueva (decisión 4).
3. **Preñez** = `deriveCurrentState(eventsAsTimelineItems).pregnancy` — se **reusa** `deriveCurrentState` (event-timeline.ts:593) mapeando los `ReproEventInput` de eje preñez (`tacto`/`birth`/`abortion`) a `TimelineItem` (kind `reproductive`). Si hay `PregnancyState` → `pregnant`/`empty` (RAR.2.4.3). *Esto preserva el desempate `seq`/`created_at` ya probado de `deriveCurrentState` — no se duplica.*
4. Categoría ∈ {`vaquillona_prenada`,`vaca_segundo_servicio`,`multipara`,`vaca_cabana`} **o** existe un evento `service` no borrado → `served_untested` (RAR.2.4.4). *(El set de "probadas" es el MISMO que la rama natural sin gate de `0105` — fuente única de verdad: se define una constante compartida y se cita `0105` líneas 126-127.)*
5. `categoryCode === 'vaquillona'` y `deriveReproAptitude(events) != null` → `fitness` (RAR.2.4.5).
6. resto → `unknown` ("Sin evaluar", RAR.2.4.6).

**Aclaración de reuso (insumo del prompt):** el badge **no reimplementa** `deriveCurrentState`; lo invoca para el eje preñez y solo **agrega** el eje aptitud (último `tacto_vaquillona`) + CUT + evidencia de servicio. Para el eje preñez se ignoran los `tacto_vaquillona` (no determinan preñez; `deriveCurrentState` ya los descarta porque su `eventType` no es `tacto`/`birth`/`abortion`).

`isReproApt(input)` (para inseminación, RAR.6.2) = `sex==='female'` ∧ (categoría probada ∨ (`vaquillona` ∧ aptitude==='apta') ∨ (`vaquillona` ∧ aptitude==`null` ∧ edad≥365 d)). **Aplica el fallback de edad** (alineado con `0105`) — `isReproApt` recibe la edad además de la aptitud (decisión de Raf en Puerta 1). El badge, en cambio, sigue mostrando "Sin evaluar" para esa vaquillona (el badge comunica el **estado de evaluación**, distinto de la **elegibilidad por edad** de la inseminación/denominador — divergencia intencional).

## 3. Lecturas locales — de dónde sale cada input (RAR.2.3, sin red)

| Input | Fuente local |
|---|---|
| `sex`, `categoryCode`, `is_cut` | `animal_profiles` (b1) + JOIN `categories_by_system`. `is_cut` ya se proyecta en **detalle** (`local-reads.ts:901`); **se agrega a la lista** (`LOCAL_LIST_SELECT`) — el mapper no lo expone, lo lee `computeReproStatuses`. |
| eventos repro (preñez + servicio + aptitud) | `reproductive_events` local + `pending_reproductive_events` (partos optimistas del overlay), vía el **builder nuevo** `buildReproBadgeEventsQuery`. |

**Builder nuevo** (batched, sirve para la ficha con 1 id y para la lista ≤200; espeja `buildCategoryMirrorEventsQuery`, local-reads.ts:971 — pero proyecta `heifer_fitness`/`service_type` y suma `tacto_vaquillona`):

```sql
-- buildReproBadgeEventsQuery(profileIds)
SELECT animal_profile_id, event_type, event_date, created_at, pregnancy_status, heifer_fitness, service_type
FROM reproductive_events
WHERE animal_profile_id IN (?, …) AND deleted_at IS NULL
  AND event_type IN ('tacto','birth','abortion','service','tacto_vaquillona')
UNION ALL
SELECT animal_profile_id, event_type, event_date, created_at, NULL, NULL, NULL
FROM pending_reproductive_events
WHERE animal_profile_id IN (?, …) AND event_type IN ('birth')   -- el overlay solo porta partos optimistas
ORDER BY event_date ASC, created_at ASC
```

*Se mantiene SEPARADO de `buildCategoryMirrorEventsQuery` (no se toca el path C6 probado) — ver §Alternativas descartadas #1.*

## 4. Inyección en la vista (RAR.3, RAR.4) — capa service, display-only

Igual que C6 (`computeMirrorOverrides`, animals.ts:277): la decisión vive en la **capa service**, no en cada screen.

- `computeReproStatuses(rows)`: junta los `profileId` de **hembras** (los machos/terneras no necesitan el badge → `none`), una query batched (builder §3), agrupa eventos por perfil, llama `deriveReproStatus` con `{sex, categoryCode, isCut, events}` → `Map<profileId, ReproStatus>`. Solo SELECT (`runLocalQuery`); **nunca** `execute`/write (RAR.8.1).
- `fetchAnimals` / búsqueda → pisa `reproStatus` en cada `AnimalListItem` **en memoria** (campo nuevo, additivo). `AnimalRow` lo recibe por prop y renderiza `ReproStatusChip` (RAR.3.1) en la vista normal (junto al `CategoryBadge`, AnimalRow.tsx:372). La variante **compacta** (selección masiva spec 10) NO lo lleva (su subtítulo es "categoría · edad"; fuera de scope).
- `fetchAnimalDetail` → expone `reproStatus` + el desglose para la ficha (aptitud vigente + preñez). La ficha (`CurrentStateSection`, [id].tsx:2032) **ya** llama `deriveCurrentState` para la preñez; se agrega la fila "Aptitud reproductiva" (de `deriveReproAptitude`) y se extiende la fila "Estado reproductivo" con "Servida sin tacto".

Perf: lista ≤200 ⇒ 1 query batched extra + cómputo O(eventos) en memoria (mismo presupuesto que C6). Si pesara → computar solo filas visibles (YAGNI).

## 5. Badge — colores por token (RAR.5, cero hardcode)

Tres tiers semánticos (bajo costo cognitivo — Hick; el estado se lee también por **texto**, RAR.5.2):

| Estado | Tier | Fondo | Borde / Texto | Token base |
|---|---|---|---|---|
| Apta / Preñada | verde (bueno) | `$greenLight` | texto `$primary` (relleno, firma RAFAQ) | igual que `CategoryBadge` |
| Diferida / Vacía | ámbar (atención) | `$surface` | borde+texto `$amber` (outline) | `$amber` #9A6206 ≈ 5:1 AA sobre surface |
| Servida sin tacto / No apta / CUT | neutro (sin info / fuera) | `$surface` | borde `$divider`, texto `$textMuted` (outline) | igual que `NoTagChip` |

- `lineHeight` matcheado al `fontSize` (`$2`/`$3`) en el `Text` del chip (anti-recorte, regla dura). Las etiquetas no traen descendentes hoy, pero el matching va por convención.
- a11y por `labelA11y` (RAR.5.3). El chip es `View` no-tappable (RAR.5.4); el target real lo da la fila.
- **No** se reusa el par `$cutBg/$cutText` (es la firma amarilla del badge **de categoría** CUT en el hero/AnimalRow): el badge de estado reproductivo de un CUT es "No apta" en **neutro** (su categoría ya se pinta amarilla aparte). Se evita doble-amarillo en la misma fila.

## 6. Inseminación (RAR.6) — fix de `appliesToAnimal`

Hoy `appliesToAnimal('inseminacion', …)` cae a `default: return true` (maneuver-applicability.ts:125) → deja machos (root cause #1b) y no filtra aptitud.

- `AnimalApplicabilityInfo` gana `aptitude: HeiferFitness | null` **y la edad** (`ageDays`/`birthDate`, RAR.6.1). El caller (`maneuver-events.ts` / el frame de carga) provee `aptitude` desde `deriveReproAptitude` (mismo espejo del badge — fuente única) y la edad desde `birth_date`.
- `case 'inseminacion': return isReproApt({ sex, categoryCode, aptitude, ageDays })` — hembra ∧ (probada ∨ vaquillona-apta ∨ **vaquillona sin veredicto con edad≥365 d**). Excluye macho (RAR.6.3), `ternera` (RAR.6.4), vaquillona `no_apta`/`diferida` (RAR.6.5), vaquillona sin veredicto **<365 d o sin birth_date** (RAR.6.5), `cut` (RAR.6.6). El fallback de edad replica el de `0105` (`v_age_threshold_days=365`) → la aplicabilidad queda **idéntica** a la elegibilidad de servidas para vaquillonas (decisión de Raf en Puerta 1).
- Client-side puro (RAR.6.7); el guard server-side de macho NO entra (backlog).

## 7. Alta — prompt de aptitud (RAR.1)

- Paso 4 (`Step4Data`, crear-animal.tsx:1009): nuevo flag `showFitness = selectedCategoryCode === 'vaquillona'` (RAR.1.1/1.2). Render del prompt **reusando `TactoVaquillonaStep`** (o un `FieldGroup` con las 3 opciones `OptionRows` si el bloque full-screen no encaja en el scroll del wizard — a criterio del implementer, conservando el lenguaje de color apta=verde/diferida=ámbar/no_apta=terracota y los labels es-AR "Sí, apta"/"Aún no sé"/"No es apta"). Estado `const [heiferFitness, setHeiferFitness] = useState<HeiferFitness | null>(null)`. Opcional (RAR.1.4): default `null` → no se manda.
- `onSubmit` (crear-animal.tsx:517-567, bloque post-create soft-fail): tras `createAnimal` OK, si `showFitness && heiferFitness != null` →
  ```ts
  const r = await addTactoVaquillona({ profileId, fitness: heiferFitness, eventDate });
  if (!r.ok) softFails.push('la aptitud reproductiva');
  ```
  (RAR.1.3/1.5 — mismo patrón soft-fail que condición/preñez; el animal ya existe, no se re-crea).
- `addTactoVaquillona` (events.ts) espeja `addTacto` (events.ts:343): `buildAddTactoVaquillonaInsert(randomUuid(), profileId, fitness, eventDate, nowIso())` → `runLocalWrite`. CRUD plano, offline-safe, sin `.select()`; `created_by`/`establishment_id` por trigger server-side al subir (RLS la barrera real).
- `buildAddTactoVaquillonaInsert` = `buildAddManeuverTactoVaquillonaInsert` (local-reads.ts:1446) **sin** la columna `session_id` (el alta no es una jornada de manga; `session_id` queda NULL). Mismo enum/columna `0053` — **sin schema nuevo**.
- Decisión 2 en vivo: "Aún no sé" → `diferida` → el evento existe → `0105` ya lo excluye de servidas aunque tenga edad (RAR.1.6); el badge de esa vaquillona muestra "Diferida".

## 8. ¿Toca DB? — **NO** (Gate 1 N/A)

Verificación explícita pedida por el leader (el delta se estimó sin migración):

- **Sin migración, sin schema nuevo, sin RLS, sin trigger, sin RPC, sin Edge Function.** Se reusan: enum `heifer_fitness` + columna `reproductive_events.heifer_fitness` (`0053`, ya aplicado); funciones del denominador `0105` (solo se **leen**/no se tocan, RAR.7.1).
- **Única escritura**: el alta inserta una fila `reproductive_events` (`event_type='tacto_vaquillona'`) por **CRUD plano local** (cliente), exactamente el mismo camino que el tacto de manga (`buildAddManeuverTactoVaquillonaInsert`) y que `addTacto`/`addAbortion`. La RLS `reproductive_events` existente (`with check has_role_in(...)`) + el trigger `0077` (fuerza `establishment_id`) la validan al subir — **sin cambios**.
- **Todo lo demás** (espejo de estado, badge, fix de inseminación) es **TypeScript puro / lecturas locales** display-only (patrón C6 frontend-puro).

**Banderas para el leader (re-evaluar Gate 1 SI cambia el diseño):** si el alta creara el evento **server-side** (RPC/trigger en vez de CRUD cliente), o si se agregara un **guard server-side** (constraint/trigger que rechace inseminación/servicio sobre macho — está EXCLUIDO/backlog), o cualquier nueva RLS/constraint → eso **sí** sería Gate 1. **Nada de eso está en este diseño.** → **Gate 1 N/A.**

## 9. Offline-first / multi-tenant

- **Offline-first** (CLAUDE.md ppio 3): el estado deriva 100% del SQLite local (RAR.2.3); el alta y su evento de aptitud son CRUD plano offline-safe (RAR.8.2) — sin red no cambia el comportamiento.
- **Multi-tenant**: sin RLS nueva (frontend puro). El evento del alta pasa por la RLS `reproductive_events` existente al subir; las lecturas locales ya vienen scopeadas por las sync streams (no se re-filtra tenant). Cero hardcode de ids (llegan por contexto/params).

## 10. Decisiones de criterio propio (→ validar en Puerta 1)

El `context.md` delega el detalle de display al leader/spec_author ("ojo vet/productor"). Cuatro decisiones tomadas acá, todas reversibles:

1. **Colores del badge en 3 tiers semánticos** (verde=bueno: Apta/Preñada; ámbar=atención: Diferida/Vacía; neutro=sin-info/fuera: Servida-sin-tacto/No-apta/CUT). Razón: colapsa la paleta a 3 señales (Hick) y reusa lenguajes de chip ya aprobados (`CategoryBadge` verde, `NoTagChip` neutro, outline ámbar). Coincide con los hints del context (preñada=verde, vacía=ámbar, apta=verde, no apta=gris, diferida=ámbar). Apta y Preñada comparten verde, Diferida y Vacía comparten ámbar — nunca coexisten (single-slot), así que no hay ambigüedad.
2. **"No apta" en NEUTRO/gris** (no terracota), aunque `TactoVaquillonaStep` use terracota para NO APTA en el bloque full-screen. Razón: en la **lista** la terracota ya está reservada a alertas (`AbortionFlag` "Tuvo aborto", `FutureBullBadge`); pintar "No apta"/CUT de terracota saturaría de rojo la pantalla y diluiría las alertas reales. "No apta"/CUT = "fuera del eje reproductivo", no "alerta" → neutro. El bloque de manga conserva su terracota (otro contexto: una decisión por pantalla, máximo contraste).
3. **Etiqueta "Sin evaluar"** para la hembra/vaquillona sin veredicto de aptitud, sin servicio y sin diagnóstico (RAR.2.4.6). Razón: con el prompt del alta (RAR.1) toda vaquillona nueva nace con veredicto (incluida "Aún no sé"=diferida) → "Sin evaluar" solo aparece en vaquillonas legacy/importadas; darles un chip neutro honesto ("falta tactearla") cumple la sensación de Raf de que "haya marca" sin inventar un estado de servicio que no ocurrió.
4. **Inseminación SÍ aplica el fallback de edad** (RAR.6.5, **resuelto por Raf en Puerta 1, 2026-06-29**): una vaquillona ≥365 d sin veredicto **es** inseminable client-side, igual que `0105` la cuenta como servida. Razón (Raf): si tiene edad de servicio, querés poder inseminarla aunque no la hayas tactado (no bloquear el flujo en campos que no tactean aptitud); la aplicabilidad queda **idéntica** a la elegibilidad de servidas (una sola regla, sin divergencia con el denominador). El **badge** de esa vaquillona igual muestra "Sin evaluar": el badge comunica el *estado de evaluación* (falta tactearla), no la *elegibilidad por edad* — divergencia intencional y coherente (podés inseminarla por edad, y el badge te recuerda que no la evaluaste). *(Versión previa de esta decisión —estricto, sin fallback— descartada en Puerta 1.)*

## 11. Alternativas descartadas

1. **Extender `buildCategoryMirrorEventsQuery` (C6) para alimentar también el badge** en vez de un builder nuevo. Pros: una sola query batched. Contras: acopla el path C6 (probado, proyección distinta) y agregaría `tacto_vaquillona` + `heifer_fitness` a un consumidor (cómputo de categoría) que los ignora → riesgo de regresión sin ganancia clara. Se descarta: builder **separado** `buildReproBadgeEventsQuery`, aislado (la perf de 2 queries batched sobre SQLite local es despreciable).
2. **Columna persistente de aptitud** en `animal_profiles` (flag denormalizado). Descartada en el Gate 0 (decisión 1: derivado, sin migración, fuente única = eventos). La rechazamos también acá: introduciría migración + trigger de denormalización + Gate 1, contra la consigna "sin migración".
3. **Dos badges (aptitud + preñez) en la lista**. Descartada en el Gate 0 (decisión 3): son fases secuenciales del mismo eje → un slot vacío/redundante casi siempre; dos chips suben el costo de escaneo (Hick) en la pantalla 🔴 manga-crítica. Single-slot.
4. **Reusar el bloque full-screen `TactoVaquillonaStep` tal cual dentro del scroll del wizard de alta**. Riesgo: el bloque está diseñado para repartirse el viewport (flex:1) en una pantalla dedicada; embebido en el `ScrollView` del paso 4 podría colapsar. Mitigación (no descarte): el implementer elige entre embeber el componente con alto acotado o un `FieldGroup` con `OptionRows` que conserve el lenguaje de color/labels — la decisión es de layout, no de comportamiento (RAR.1.1 fija labels y colores).

## 12. Anti-drift (RAR.8.3)

- Header de `repro-status.ts`: "Espeja la elegibilidad reproductiva de `0105` (`rodeo_serviced_females`) y el enum `heifer_fitness` (`0053`). Cualquier cambio a esa elegibilidad o al enum actualiza este módulo + `repro-status.test.ts`." (espeja RC6.5.1).
- El set de categorías "probadas" se define **una vez** (constante compartida) citando `0105` líneas 126-127 — no se duplica el literal entre el badge y la lógica de inseminación.
