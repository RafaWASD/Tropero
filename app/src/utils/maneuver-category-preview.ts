// Lógica PURA del PREVIEW de TRANSICIÓN de categoría OFFLINE (spec 03 R8.4). Sin RN, sin red, sin
// supabase-js: testeable con node:test (mismo patrón que maneuver-sequence.ts / animal-category.ts).
//
// ── QUÉ resuelve ──────────────────────────────────────────────────────────────────────────────
// Cuando una maniobra captura un evento reproductivo que el SERVER transicionaría de categoría (caso
// canónico R8.1: tacto POSITIVO sobre una vaquillona → vaquillona_prenada), el operario debe VER el
// cambio esperado en el RESUMEN del animal ANTES de sincronizar. Es DISPLAY-ONLY: el server sigue
// siendo la única verdad (la transición la aplica el trigger tg_reproductive_events_apply_transition,
// spec 02 R7). Acá solo ANTICIPAMOS lo que el server computará, reusando el espejo C6
// `computeCategoryCode` (`@/utils/animal-category`) — CERO re-implementación de la máquina de estados
// de categoría ⇒ CERO drift (si `compute_category` cambia, el round-trip antidrift de los tests rompe).
//
// ── CÓMO ──────────────────────────────────────────────────────────────────────────────────────
// `computeCategoryCode` recibe el HISTORIAL completo de eventos reproductivos del animal y deriva el
// code. Acá NO tenemos el historial real (sería I/O); en cambio RECONSTRUIMOS los eventos sintéticos
// MÍNIMOS que dejan al animal en su `currentCode` (helper `syntheticEventsForFemaleCategory`) y, sobre
// esos, agregamos como "ahora" los eventos CAPTURADOS en la manga que alimentan compute_category
// (tacto / inseminación). El code resultante es lo que el server hará al subir la captura. Si NO cambia
// respecto del actual, no hay nada que mostrar (→ null).
//
// Los eventos sintéticos llevan `eventDate:'1970-01-01'` + `createdAt` SELLADO (pasado) → quedan ANTES
// que los capturados ("ahora", `createdAt:null`, `eventDate:today`), tanto por la tupla (event_date,
// created_at) como por el ÍNDICE del array (orden de inserción = el tie-break de hasPositiveTactoVigente
// en animal-category.ts). El FROM mostrado es SIEMPRE la categoría que el header YA exhibe (consistencia
// con la pantalla); el TO es lo que el server computará — incluso si el birthDate del header estuviera
// "stale", el TO sigue siendo correcto (lo que el server hará), solo el FROM es el display actual.

import {
  type AnimalSex,
  type ReproEventInput,
  computeCategoryCode,
} from './animal-category';
import type { CaptureMap } from './maneuver-sequence';

/** El cambio de categoría que el operario VE en el resumen antes de sincronizar (R8.4). Display-only. */
export type CategoryTransitionPreview = {
  /** code de la categoría ACTUAL (la que el header ya muestra). */
  fromCode: string;
  /** name es-AR de la categoría actual (la que el header ya muestra). */
  fromName: string;
  /** code de la categoría DESTINO que el server computará al subir la captura. */
  toCode: string;
  /** name es-AR de la categoría destino (resuelto del catálogo del sistema; nunca blanco). */
  toName: string;
};

/**
 * Eventos reproductivos SINTÉTICOS mínimos que dejan a una HEMBRA en `code` según `computeCategoryCode`
 * (espejo de compute_category 0062). Reconstruyen el "estado de partida" para poder anticipar la
 * transición sin leer el historial real (display-only, R8.4). Devuelve `null` para un code que NO sabemos
 * reconstruir (desconocido / no-cría / macho) ⇒ la función pública devuelve null (fail-safe: si no podemos
 * razonar el estado de partida, NO mostramos un preview que podría ser falso).
 *
 * Mapeo (precedencia de la rama HEMBRA de 0062 — partos > tacto+ > vaquillona(servicio|destete|≥1año)):
 *   - 'multipara'              → [birth, birth]           (≥2 partos → multipara, gana a cualquier tacto+)
 *   - 'vaca_segundo_servicio'  → [birth]                  (1 parto → vaca de 2do servicio, gana al tacto+)
 *   - 'vaquillona_prenada'     → [tacto+ medium]          (tacto+ vigente, sin partos)
 *   - 'vaquillona'             → [service]                (evento calificante que la mantiene vaquillona
 *                                                          sin importar la edad — un service la promueve)
 *   - 'ternera'                → []                        (sin eventos; el corte de edad <1año la hace ternera)
 *   - cualquier OTRO code      → null                     (no reconstruible → fail-safe)
 *
 * Los sintéticos van SELLADOS en el pasado (`eventDate:'1970-01-01'`, `createdAt` no-null) para quedar
 * antes que los capturados ("ahora").
 */
export function syntheticEventsForFemaleCategory(code: string): ReproEventInput[] | null {
  const SEALED = '1970-01-01T00:00:00Z';
  const birth: ReproEventInput = {
    eventType: 'birth',
    eventDate: '1970-01-01',
    createdAt: SEALED,
    pregnancyStatus: null,
  };
  const service: ReproEventInput = {
    eventType: 'service',
    eventDate: '1970-01-01',
    createdAt: SEALED,
    pregnancyStatus: null,
  };
  const positiveTacto: ReproEventInput = {
    eventType: 'tacto',
    eventDate: '1970-01-01',
    createdAt: SEALED,
    pregnancyStatus: 'medium',
  };
  switch (code) {
    case 'multipara':
      return [birth, birth];
    case 'vaca_segundo_servicio':
      return [birth];
    case 'vaquillona_prenada':
      return [positiveTacto];
    case 'vaquillona':
      return [service];
    case 'ternera':
      return [];
    default:
      return null; // code desconocido / no-cría → no reconstruible → fail-safe (la pública devuelve null)
  }
}

/**
 * Extrae de las CAPTURAS de la manga (`captured`) los eventos reproductivos que ALIMENTAN
 * compute_category, como eventos "ahora" (DESPUÉS de los sintéticos: `createdAt:null`, `eventDate:today`).
 * Escanea los VALUES del mapa (NO asume el nombre de la key) buscando los StepValue discriminados:
 *   - kind:'tacto'        → { eventType:'tacto', pregnancyStatus: value.pregnancy }  (empty = no positivo →
 *                            no transiciona; small/medium/large = positivo → transiciona)
 *   - kind:'inseminacion' → { eventType:'service' }  (un servicio puede promover ternera → vaquillona)
 * NO considera kind:'vaquillona' (el tacto_vaquillona es aptitud, event_type DISTINTO — NO alimenta
 * compute_category). Devuelve [] si no hay ninguno de esos dos capturados (→ la pública devuelve null:
 * no hay evento que dispare transición).
 */
function capturedReproEvents(captured: CaptureMap, todayIso: string): ReproEventInput[] {
  const events: ReproEventInput[] = [];
  for (const value of Object.values(captured)) {
    if (!value) continue;
    if (value.kind === 'tacto') {
      events.push({
        eventType: 'tacto',
        eventDate: todayIso,
        createdAt: null,
        pregnancyStatus: value.pregnancy,
      });
    } else if (value.kind === 'inseminacion') {
      events.push({
        eventType: 'service',
        eventDate: todayIso,
        createdAt: null,
        pregnancyStatus: null,
      });
    }
  }
  return events;
}

/** ISO 'YYYY-MM-DD' de una fecha (wall-clock). */
function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Anticipa la transición de categoría que el server aplicará por las maniobras capturadas (R8.4). PURA,
 * display-only: reusa `computeCategoryCode` (espejo C6) ⇒ cero drift. Devuelve el `{ from, to }` a mostrar,
 * o `null` cuando no hay nada que anticipar.
 *
 * Reglas (en ORDEN — el primer null gana):
 *   1. `categoryOverride === true` → null. El server NO recalcula con override (R8.1 "salvo
 *      category_override") → no hay destino derivable.
 *   2. `sex === 'male'` → null. NINGÚN evento de manga transiciona un macho vía compute_category (la rama
 *      macho del espejo solo reacciona a destete/edad, no a tacto/servicio; la castración es spec 10/ficha,
 *      no entra acá).
 *   3. Reconstruir el estado de partida desde `currentCode` (syntheticEventsForFemaleCategory). Si el code
 *      no es reconstruible (desconocido / no-cría) → null (fail-safe).
 *   4. Si no hay tacto ni inseminación capturados → null (no hay evento que dispare transición).
 *   5. `toCode = computeCategoryCode(female, [...sinteticos, ...capturados])`. Si `toCode === currentCode`
 *      → null (no hubo cambio que mostrar).
 *   6. Resolver `toName` en el catálogo. Si el code destino no está en el catálogo → null (fail-safe, nunca
 *      blanco).
 *
 * El FROM es SIEMPRE `{ currentCode, currentName }` (lo que el header ya muestra) — consistencia con la
 * pantalla. El TO es lo que el server computará: en el caso raro de un `birthDate` "stale" en el header,
 * el TO sigue siendo correcto (lo que el server hará); solo el FROM es el display actual.
 */
export function previewManeuverCategoryTransition(args: {
  sex: AnimalSex;
  birthDate: string | null;
  currentCode: string;
  currentName: string;
  categoryOverride: boolean;
  captured: CaptureMap;
  catalog: readonly { code: string; name: string }[];
  today?: Date;
}): CategoryTransitionPreview | null {
  // 1) override → el server no recalcula (R8.1) → nada que anticipar.
  if (args.categoryOverride) return null;
  // 2) macho → ningún evento de manga lo transiciona vía compute_category.
  if (args.sex === 'male') return null;

  // 3) estado de partida sintético desde el code actual. Code no reconstruible → fail-safe (null).
  const synthetic = syntheticEventsForFemaleCategory(args.currentCode);
  if (synthetic === null) return null;

  // 4) eventos capturados que alimentan compute_category ("ahora"). Ninguno → no hay disparador.
  const today = args.today ?? new Date();
  const captured = capturedReproEvents(args.captured, isoDay(today));
  if (captured.length === 0) return null;

  // 5) lo que el server computará con [partida + capturas]. Sin cambio → nada que mostrar.
  const toCode = computeCategoryCode({
    sex: 'female',
    birthDate: args.birthDate,
    isCastrated: false,
    events: [...synthetic, ...captured],
    today,
  });
  if (toCode === args.currentCode) return null;

  // 6) resolver el name destino en el catálogo del sistema. Sin fila → fail-safe (nunca blanco).
  const match = args.catalog.find((c) => c.code === toCode);
  if (!match) return null;

  return {
    fromCode: args.currentCode,
    fromName: args.currentName,
    toCode: match.code,
    toName: match.name,
  };
}
