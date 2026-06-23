# Spec 03 — Stream B: puesta en servicio (cliente / manga) — Design

**Status**: `spec_ready` (frontend; **Gate 1 N/A** salvo reapertura de schema/RLS/Edge — ver §0; **Gate 2 por chunk**).
**Fecha**: 2026-06-23.
**Fuente de verdad**: `docs/modelo-reproductivo-puesta-en-servicio.md` (Gate 0, §3/§4/§6/§8) + `requirements-puesta-en-servicio-cliente.md` (`RPSC.x`).
**Stream A consumido (as-built/deployado, NO se toca)**: `specs/active/02-modelo-animal/{requirements,design}-puesta-en-servicio.md` + migraciones `0102`–`0105`.
**Sustrato frontend as-built**: `app/app/maniobra/**`, `app/app/{crear-rodeo,editar-plantilla,rodeos,agregar-evento}.tsx`, `app/src/utils/{animal-category,maneuver-*,event-input,event-timeline}.ts`, `app/src/services/{rodeos.ts,powersync/*}`. Citas inline al archivo/línea real de cada cosa que se toca.

> **Convención de marcado.** **[FIRME]** = viene cerrado del Gate 0 (no se re-decide). **[DECISIÓN]** = decisión técnica que toma este design (las que el Gate 0 delegó), marcadas `DD-PSC-n`. **[VERIFICADO]** = hallazgo del as-built. **[TENTATIVO]** = default provisional del Gate 0 §9 (espera input de Facundo).
>
> Los bloques de pseudo-código son **especificación de diseño**: el implementer escribe el TS/TSX final + tests, respetando su forma e invariantes. **NO se aplica ninguna migración** (Stream B es frontend; el backend lo hizo Stream A).

---

## 0. Gate 1 — ¿aplica? (confirmación pedida por el leader)

**Veredicto: Gate 1 N/A para Stream B (frontend puro).** [DECISIÓN — confirmada contra el as-built]

Por ADR-019, Gate 1 (`security_analyzer` modo `spec`) se invoca si la spec toca **RLS, schema sensible, Edge Functions, auth/tokens, secrets, o datos regulados**. Stream B **no toca nada de eso**:

| Pieza | Qué toca | ¿Schema/RLS/Edge? |
|---|---|---|
| **B1 — selector de meses** | UI del wizard de rodeo + un parámetro `p_service_months` más en RPC ya existentes (`create_rodeo` `0103`, `set_rodeo_service_months` `0103`) + un `enqueue*` de outbox + un op_type en `RPC_OP_TYPES` | **No.** Las RPC, el CHECK de columna, el owner-only y el anti-IDOR son **as-built de Stream A** (ya pasaron Gate 1 — `progress/security_spec_02-puesta-en-servicio.md` PASS). El cliente solo **invoca** lo que ya existe y ya está autorizado server-side. |
| **B2 — tacto config + buckets** | UI de manga (`ManeuverConfigSheet`, `TactoStep`) + lógica pura de buckets + un valor más en el `config` jsonb pass-through de la jornada | **No.** El `config` de `sessions`/`maneuver_presets` ya es `jsonb` pass-through (spec 03 R1.13, `0050`); `pregnancy_status` no cambia. |
| **B3 — baja del servicio manual** | Quitar una opción de un selector de UI (`agregar-evento.tsx`) | **No.** No toca el enum `service_type`, ni `reproductive_events`, ni RLS. Solo deja de **ofrecer** `natural` en la UI. |
| **B4 — espejo client-side** | Lógica pura `computeCategoryCode` (TS) + tests | **No.** Es el espejo display-only (C6); el server (`compute_category` `0104`) ya hizo el cambio real y ya pasó su Gate 1. B4 solo alinea el cliente para cerrar el drift. |

**Disparador de reapertura (RPSC.8.4):** si durante la implementación el implementer descubre que necesita una columna nueva, una RPC nueva, un cambio de RLS, o tocar una Edge Function (p. ej. si decidiera materializar algo server-side en vez de derivarlo en el cliente), **debe parar y marcar Gate 1 OBLIGATORIO** antes de seguir. Con el diseño de abajo eso **no** debería ocurrir: todo el backend necesario ya está as-built.

**Gate 2 (code security) — SIEMPRE, por chunk.** Aunque sea frontend, el listón de Gate 2 (RAFAQ checklist) revisa que el cliente no hardcodee `establishment_id`, no abra un camino de escritura que saltee la RPC owner-only, y que el parseo del array desde TEXT no sea injtable. Cada chunk (B1/B2/B3/B4) pasa Gate 2 tras el reviewer.

---

## 1. Reconciliación con el as-built (qué se toca y qué NO)

| Objeto as-built | Archivo / línea | Qué hace hoy | Qué hace este delta (pieza) |
|---|---|---|---|
| `computeCategoryCode` | `app/src/utils/animal-category.ts:261,269` | espejo de `compute_category`; rama `vaquillona` usa `hasService` | **B4**: quita `hasService` de la rama `vaquillona` (RPSC.1.1) |
| `animal-category.test.ts` | `:261,264,267` (T2.23) | afirma `service → vaquillona` | **B4**: invierte los casos (service ya no promueve) (RPSC.1.4) |
| `maneuver-category-preview.ts` | `:74-79,93-94,124-130` | preview R8.4 reusa el espejo; `inseminacion→service→vaquillona` | **B4**: alinea (IA ya no anticipa vaquillona) (RPSC.1.5) |
| `MIRROR_EVENT_TYPES` | `local-reads.ts:936` | incluye `'service'` | **B4**: NO se toca (RPSC.1.6) — el evento se sigue leyendo, solo no influye |
| `crear-rodeo.tsx` | wizard 3 pasos (sistema→nombre→plantilla) | crea rodeo vía `createRodeo` | **B1**: +paso/sección de selector de 12 meses (RPSC.2) |
| `createRodeo` / `enqueueCreateRodeo` | `rodeos.ts:176`, `outbox.ts:148` | alta offline (outbox → RPC `create_rodeo`) | **B1**: pasa `p_service_months` por el mismo camino (RPSC.2.4) |
| `editar-plantilla.tsx` / `rodeos.tsx` | edición de plantilla offline | edita `rodeo_data_config` vía `set_rodeo_config` | **B1**: +superficie de ver/editar meses (selector) → `set_rodeo_service_months` (RPSC.3) |
| `outbox.ts` / `upload.ts` (`RPC_OP_TYPES`) | `upload.ts:35-51` | mapea op_type→RPC | **B1**: +`enqueueSetRodeoServiceMonths` + `'set_rodeo_service_months'` en `RPC_OP_TYPES` (RPSC.3.3) |
| schema PowerSync `rodeos` | `schema.ts:148-157` | sin `service_months` | **B1**: +`service_months: column.text` (RPSC.3.7, dependencia) |
| `ManeuverConfigSheet.tsx` | `:40` (`'multi'|'single'`) | preconfig de tanda (vacuna/pajuela) | **B2**: +un modo/uso para "¿medir tamaño? sí/no" del tacto (RPSC.4.1) |
| `TactoStep.tsx` | `:108-113` (3 bloques fijos) | binario + tamaño cabeza/cuerpo/cola SIEMPRE | **B2**: nº de bloques de tamaño = f(meses del rodeo) (RPSC.5) |
| `maneuver-config.ts` / nuevo util | — | preconfig pass-through | **B2**: +función pura de la regla de buckets CCL (RPSC.4.5/RPSC.5.8) |
| `agregar-evento.tsx` | `:84-91,353,489,577,720-723` | "Agregar evento" con `service` (natural/ai/te) | **B3**: quita la opción de **monta natural** (RPSC.6.1) |
| `events.spec.ts` | `:190` (Servicio Monta natural) | e2e del servicio manual | **B3**: actualiza el flujo (RPSC.6.5) |
| `TactoVaquillonaStep.tsx` / `HeiferFitness` | `maneuver-sequence.ts:40` | aptitud 3 estados (apta/no_apta/diferida) | **NO se toca** (RPSC.7 = verificación) **[VERIFICADO]** |
| `InseminacionStep.tsx` | toda | IA per-vaca (`service`+`ai`) | **NO se toca** (RPSC.6.2) **[VERIFICADO]** |

**Lo que NO se toca** (explícito): el enum `service_type` (`natural`/`ai`/`te`), `reproductive_events`, `addService`/`buildAddServiceInsert` (B3 solo deja de ofrecer `natural` en la UI; la función puede quedar — la IA de manga NO la usa, usa `buildAddManeuverInseminationInsert`); el gating capa 1/2 de maniobras; el orden/drag de jornada; la aptitud (`tacto_vaquillona`); el contrato de derivación de `0105` (lo consume Stream C).

---

## 2. Decisiones de design (las que el Gate 0 delegó)

### DD-PSC-1 — B4 primero (orden de chunks): cierra el drift display-only vivo

**[DECISIÓN]** Implementar **B4 (RPSC.1) antes que B1/B2/B3.** Es el chunk más chico (lógica pura + tests, sin UI nueva, sin design-spike) y es **urgente**: `compute_category` server (`0104`) **ya está aplicado/deployado** (Stream A done) y `compute_category` ya no usa `service`, mientras el espejo cliente todavía sí → **hoy** un usuario que tenga una ternera con un `service`/IA cargado ve `vaquillona` en el badge del cliente y `ternera` en el server (drift hasta el próximo sync que igual no lo corrige porque el espejo no converge). B4 cierra eso. B1/B2/B3 son independientes entre sí y pueden ir después en cualquier orden (B1 y B2 esperan su design-spike).

### DD-PSC-2 — B2: ¿qué valor lleva una preñez SIN tamaño? → `pregnancy_status` mapeado por convención, sin tocar el enum

**[DECISIÓN]** Cuando el rodeo es de **1 mes / 12 meses** de servicio o la jornada tiene **"medir tamaño = NO"**, el tacto positivo persiste con **`pregnancy_status = 'large'`** (= "Cabeza"), y la UI NO muestra el sub-paso de tamaño ni la etiqueta de tamaño en el resumen de ese animal.

**Por qué `'large'` y no inventar un valor / no dejar null:**
- El enum `pregnancy_status` es **cerrado** (`'empty' | 'small' | 'medium' | 'large'`, `0026`/as-built) y Stream A **no lo tocó** (RPS no toca `pregnancy_status`). Un "preñada sin tamaño" no existe en el enum, y agregar un valor sería **schema → reabriría Gate 1** (lo que B2 explícitamente evita).
- `null` no sirve: el espejo (`computeCategoryCode`) y `compute_category` server tratan un tacto **positivo** como `pregnancy_status IS NOT NULL AND <> 'empty'` (as-built `0062`/`0104` + `hasPositiveTactoVigente`). Un tacto con `pregnancy_status = null` se leería como **NO positivo** → no transicionaría a `vaquillona_prenada` → **bug** (una preñada sin tamaño no contaría como preñada para la categoría). Por eso debe ser un valor positivo del enum.
- Entre los tres positivos, **`'large'`** es el menos engañoso para "preñada, etapa no diferenciada": en CCL la "cabeza" (`large`) es la preñez más avanzada/temprana, y en un rodeo de **1 mes** todas son de la misma edad (de hecho "cabeza"); en **12 meses / continuo** no hay etapas que distinguir. Lo importante para la categoría es que sea **positivo** (cuenta como preñada); para los reportes CCL, un rodeo de 1/12 meses **no** se reporta por CCL (Gate 0 §4) → el valor concreto no contamina ningún reporte CCL.

> **Alternativa considerada y descartada:** persistir `'medium'` ("cuerpo", el "medio") para "sin distinción". Descartada: "medio" sugiere falsamente una etapa intermedia diagnosticada; y en un rodeo de 1 mes la realidad es "cabeza" (todas concebidas en la misma ventana temprana). `'large'` es más fiel y consistente. **El implementer documenta esta convención en el comentario de `TactoStep` y la cubre con un test (RPSC.5.7).** [Marcado para revisión de Facundo si Stream C necesita distinguir "preñada sin tamaño" de "cabeza real" — hoy no lo necesita; sería una columna/flag nuevo = otro delta.]

### DD-PSC-3 — B2: la regla de buckets CCL vive en UNA función pura compartida

**[DECISIÓN]** La regla del Gate 0 §4 (nº de meses de servicio → nº y nombres de buckets de tamaño + si admite distinción) vive en **una función pura nueva** (`app/src/utils/pregnancy-buckets.ts` o dentro de `maneuver-config.ts`), testeable con node:test, consumida por:
1. el **default de "¿medir tamaño?"** del config (RPSC.4.2), y
2. el **nº de botones de tamaño** de `TactoStep` (RPSC.5.8).

**Por qué una sola fuente:** la regla es la misma decisión ("¿este nº de meses admite distinción de etapas?") en dos lugares; duplicarla garantiza drift cuando Facundo afine el bucketing ([TENTATIVO] Gate 0 §9). Una función pura es testeable sin UI (mismo patrón que `maneuver-gating.ts`/`maneuver-config.ts`) y el cambio de Facundo se hace en un solo lugar.

**Contrato propuesto (el implementer ajusta nombres):**
```ts
// app/src/utils/pregnancy-buckets.ts — regla de buckets CCL del Gate 0 §4 (FUENTE ÚNICA).
// Decide, a partir del nº de meses de servicio del rodeo, qué botones de TAMAÑO de preñez mostrar
// (cabeza/cuerpo/cola → large/medium/small) y si por default conviene medir tamaño.
// [TENTATIVO] el bucketing de 4–11 meses (tercios) y el default "sin distinción" esperan a Facundo (Gate 0 §9).

/** Un bucket de tamaño = un botón de TactoStep. label es-AR + el pregnancy_status que persiste (1:1, §4). */
export type SizeBucket = { label: 'Cabeza' | 'Cuerpo' | 'Cola'; status: 'large' | 'medium' | 'small' };

const HEAD: SizeBucket = { label: 'Cabeza', status: 'large' };
const BODY: SizeBucket = { label: 'Cuerpo', status: 'medium' };
const TAIL: SizeBucket = { label: 'Cola', status: 'small' };

/**
 * Buckets de tamaño para un rodeo con `nMonths` meses de servicio (Gate 0 §4):
 *   - 0 (sin configurar / vacío) → []  (sin tamaño; ventana desconocida)
 *   - 1  → []                          (todas la misma edad → preñada/vacía, sin tamaño)
 *   - 2  → [Cabeza, Cola]              (sin cuerpo)
 *   - 3  → [Cabeza, Cuerpo, Cola]      (tercios exactos)
 *   - 4..11 → [Cabeza, Cuerpo, Cola]   (tercios) [TENTATIVO]
 *   - 12 → []                          (servicio continuo → preñada/vacía, sin CCL) [TENTATIVO política 12m]
 * `nMonths` se deriva de array_length(service_months); NULL/sin configurar → 0 → [].
 */
export function sizeBucketsForServiceMonths(nMonths: number | null): SizeBucket[] {
  const n = nMonths ?? 0;
  if (n <= 1 || n >= 12) return [];        // 0/1 y 12+ → sin tamaño
  if (n === 2) return [HEAD, TAIL];
  return [HEAD, BODY, TAIL];               // 3..11 → tercios (3 exacto; 4–11 [TENTATIVO])
}

/** Default de "¿medir tamaño?" derivado del rodeo (RPSC.4.2): hay distinción posible ⟺ ≥1 bucket. */
export function defaultMeasureSize(nMonths: number | null): boolean {
  return sizeBucketsForServiceMonths(nMonths).length > 0;
}
```
> Nota: la regla "1 mes → sin tamaño" y "12 → sin tamaño" colapsan a `[]` (cero botones). `TactoStep` con `[]` buckets persiste directo la preñez con la convención de DD-PSC-2 (sin sub-paso 2).

### DD-PSC-4 — B1: edición de `service_months` por RPC dedicada en la outbox (gemela de `set_rodeo_config`)

**[DECISIÓN]** La edición de meses de un rodeo existente se encola como un intent nuevo `op_type='set_rodeo_service_months'` (gemelo de `set_rodeo_config`), no se mezcla con la edición de plantilla.

**Por qué un intent dedicado:**
- Stream A ya entregó la RPC dedicada `set_rodeo_service_months(p_rodeo_id, p_service_months)` (`0103`, DD-PS-2 de Stream A) **separada** de `set_rodeo_config` (que solo maneja toggles de `rodeo_data_config`). El cliente debe espejar esa separación: un `enqueueSetRodeoServiceMonths` que mapea a `supabase.rpc('set_rodeo_service_months', { p_rodeo_id, p_service_months })`.
- El camino es **idéntico al de `set_rodeo_config`** (`outbox.ts:208` `enqueueSetRodeoConfig`, `upload.ts:51` op_type en `RPC_OP_TYPES`, `upload.ts:200` `P0002 → permanent_reject`): el implementer copia ese patrón. La idempotencia la da el UPDATE de la RPC (sin `client_op_id`). El overlay optimista pisa `service_months` del rodeo en `pending_rodeos` (o un overlay equivalente) para que la pantalla muestre el cambio offline (RPSC.3.4).

**Por qué NO un UPDATE plano de `rodeos.service_months` (CRUD-plano):** la escritura de rodeos **ya va por RPC** en el repo (decisión as-built de spec 15: `create_rodeo`/`set_rodeo_config`) para centralizar el authz owner-only + la re-validación server-side; `service_months` es escalar y *técnicamente* sería CRUD-plano (gobernado por la RLS `rodeos_update` owner-only + el CHECK de columna, Stream A design DD-PS-2 lo contempla), pero meterlo por RPC es **consistente con el as-built** y evita un segundo camino de escritura de rodeos. **Default de diseño: RPC dedicada por outbox** (alineado con DD-PS-2 de Stream A).

### DD-PSC-5 — B1: el selector de meses como PASO/SECCIÓN del wizard, derivable a un componente reutilizable

**[DECISIÓN]** El selector de 12 meses es **un componente reutilizable** (`app/app/_components/ServiceMonthsSelector.tsx` o equivalente) consumido por **dos** superficies: el wizard de alta (`crear-rodeo.tsx`, B1 alta) y la edición (`editar-plantilla.tsx` o una pantalla/sheet dedicada, B1 edición). La lógica pura de mapeo checkboxes↔array + parseo desde TEXT vive en un util puro (`app/src/utils/service-months.ts`), testeable sin UI.

**Por qué reutilizable + lógica pura aparte:** el alta y la edición muestran el MISMO selector con distinto default (alta = primavera pre-tildada RPSC.2.2; edición = lo persistido o "sin configurar" RPSC.3.2). Un componente compartido evita duplicar el grid de 12 meses; la lógica pura (parseo tolerante del TEXT de PowerSync, dedup/rango, "¿está el mes M?", default primavera) es testeable con node:test (mismo patrón que `rodeo-template.ts`).

**Dónde mostrarlo en el alta (lo cierra el design-spike, §3):** el wizard de alta tiene hoy 3 pasos (sistema → nombre → plantilla, `crear-rodeo.tsx:69`). El selector entra como **un paso nuevo** (4º) o como **una sección del paso de plantilla** — el design-spike decide cuál no fricciona (una decisión por pantalla, CLAUDE.md ppio 4). Con primavera pre-tildada, un alta que ignore el paso queda correcta (RPSC.2.5).

```ts
// app/src/utils/service-months.ts — lógica PURA del selector (sin RN/red). Testeable con node:test.
export const SPRING_DEFAULT: readonly number[] = [10, 11, 12]; // Oct/Nov/Dic (Gate 0 §6).

/** Parsea el service_months que PowerSync materializa como TEXT/JSON → number[] | null (RPSC.3.7).
 *  TOLERANTE: null/''/no-array/valores fuera de 1–12 → null ("sin configurar") o se filtran; NUNCA tira. */
export function parseServiceMonths(raw: unknown): number[] | null { /* ... */ }

/** Mapea los meses tildados (set 1–12) → array ordenado, único, dentro de rango (lo que la RPC espera). */
export function toServiceMonthsArray(checked: ReadonlySet<number>): number[] { /* ... */ }

/** ¿El mes M (1–12) está en el conjunto? (para pintar el checkbox). */
export function isMonthChecked(months: number[] | null, m: number): boolean { /* ... */ }
```

### DD-PSC-6 — B3: deprecar SOLO la monta natural; IA y TE quedan como carga reproductiva real per-vaca

**[DECISIÓN]** En `agregar-evento.tsx`, se quita la opción **`natural`** del selector de servicio (`SERVICE_TYPE_OPTIONS`), pero **IA (`ai`)** y **TE (`te`)** se conservan como carga reproductiva real per-vaca.

**Por qué solo `natural`:** el Gate 0 §1 dice explícitamente "el servicio **natural** (toro con el rodeo) ya es a nivel grupo → registrarlo per-vaca siempre fue ficticio" y "**la maniobra de IA/IATF NO se toca** (es una acción real con dato real)". La **TE (transferencia embrionaria)** es, como la IA, una **intervención reproductiva real y puntual sobre un animal individual** (no una monta de toro grupal) → mismo criterio que la IA: es un dato real per-vaca, se conserva. Deprecar solo `natural` es exactamente lo que el Gate 0 pidió.

**Cómo (mínimo y reversible):** la opción `natural` se quita de `SERVICE_TYPE_OPTIONS` (`event-input.ts:170`) **o** se filtra en el render del `ServiceForm` de `agregar-evento.tsx`. El `service_type` enum DB sigue con `natural` (los históricos lo usan, RPSC.6.3) — no se toca el enum (eso sería Gate 1). Si tras quitar `natural` la pantalla "Servicio" queda solo con IA/TE, el implementer evalúa si la card "Servicio" del paso 1 (`agregar-evento.tsx:720`, subtítulo "Monta natural, IA o TE") se renombra a "Inseminación / TE" — decisión menor de copy que el implementer propone (default: renombrar el subtítulo, quitar "Monta natural").

> **Constatación que cierra el alcance de B3 (RPSC.6.4):** el servicio natural manual **nunca fue una `ManeuverKind`** del wizard de MODO MANIOBRAS (verificado: el catálogo `ManeuverKind` de `maneuver-gating.ts:21-36` NO tiene `servicio`; la manga solo tiene `inseminacion`=IA). Por lo tanto **no existe** ningún preset, secuencia de jornada, ni gating que cargue servicio natural → ningún preset/rutina existente queda roto por B3. La carga manual de monta natural vivía **únicamente** en "Agregar evento" de la ficha. **No hay nada más que deprecar.**

---

## 3. Diseño 🔴 manga + design-spikes (veto del leader, skill `design-review`)

> **Visual antes de plomería (paridad con M2.0/M6-C.0).** B1 (selector de 12 meses) y B2 (config "¿tamaño?" + N botones de tamaño en `TactoStep`) son **UI nueva de wizard/manga** → cada uno arranca con un **design-spike** que el leader **veta con la skill `design-review`** (análisis pro fundamentado: Fitts, jerarquía, contraste, densidad R12.5, recorte de descendentes, **vetar en web táctil real** per `reference_rn_web_pitfalls`) **antes** de mostrárselo a Raf. Solo se le muestra a Raf lo aceptable (memoria `feedback_design_vet_before_showing`). **B3 y B4 NO necesitan design-spike** (B3 = quitar una opción; B4 = lógica pura).

### 3.1 Design-spike B1 — selector de 12 meses (paso M-PSC-B1.0)

- **Grid de 12 meses** (Ene…Dic) como chips/toggles tildables, manga-friendly (targets ≥ `$touchMin`). Atajos útiles (no obligatorios, el spike decide): "Primavera" / "Otoño" / "Todo el año" / "Ninguno" como presets de un toque (reducen fricción sin esconder el control fino).
- **Default primavera pre-tildado** en el alta (RPSC.2.2); en la edición, lo persistido o el estado "sin configurar" claramente señalado (RPSC.3.2).
- **Recorte de descendentes** (memoria): cualquier título ("¿En qué meses hace servicio?") con descendente (g/j/p/q/y) lleva `lineHeight` matching.
- **Dónde** (alta): paso 4 del wizard **o** sección del paso de plantilla — el spike elige el que no fricciona (DD-PSC-5).
- **Densidad / una decisión por pantalla** (CLAUDE.md ppio 4): el grid es la decisión de la pantalla; copy corto que explique para qué sirve (alimenta los reportes reproductivos).

### 3.2 Design-spike B2 — config "¿medir tamaño?" + N botones en `TactoStep` (paso M-PSC-B2.0)

- **Config "¿medir tamaño? sí/no"** sobre el patrón `ManeuverConfigSheet` (header fijo + cuerpo + footer fijo, ya as-built tras el fix M5-CUSTOMFIELDSHEET): una decisión por pantalla, default derivado del rodeo (RPSC.4.2) visible (p. ej. "Sugerido: SÍ — este rodeo tiene 3 meses de servicio"), override de un toque.
- **`TactoStep` con N bloques de tamaño**: preserva el lenguaje visual aprobado (bloques full-width que se reparten el alto, `$primary`, label gigante, "PREÑADA" sin recorte — `TactoStep.tsx:68`). El spike valida que **2 bloques** (cabeza/cola) y **3 bloques** (cabeza/cuerpo/cola) se repartan bien el alto (R12.5 densidad) y que el caso **0 bloques** (1/12 meses / "no medir") salte directo sin pantalla muerta.
- **Vetar en web táctil real** (`hasTouch:true` + `touchscreen.tap()`): el tap-through al backdrop y el truncado de texto solo se ven ahí (memoria `reference_rn_web_pitfalls`).
- **NO rediseñar el binario PREÑADA/VACÍA** (RPSC.5.1): el spike toca solo el sub-paso de tamaño.

---

## 4. B2/B4 — espejo de categoría + persistencia del tacto (detalle técnico)

### 4.1 B4 — `computeCategoryCode` (RPSC.1.1–RPSC.1.3)

Cambio **quirúrgico** en `app/src/utils/animal-category.ts` (espejo de `0104`): se elimina **solo** el término `hasService` de la rama `vaquillona`. Todo lo demás idéntico (precedencia, rama macho, cortes de edad, tacto+ vigente, conteo de partos).

```ts
// app/src/utils/animal-category.ts — DIFF vs as-built (líneas 259-273):
const births = inputs.events.reduce((n, e) => (e.eventType === 'birth' ? n + 1 : n), 0);
const hasWeaning = inputs.events.some((e) => e.eventType === 'weaning');
// const hasService = ...                          ← ELIMINAR (RPSC.1.1)  [línea 261]
const hasPosTacto = hasPositiveTactoVigente(inputs.events);

if (births >= 2) return 'multipara';
if (births === 1) return 'vaca_segundo_servicio';
if (hasPosTacto) return 'vaquillona_prenada';
if (hasWeaning /* || hasService  ← ELIMINAR */ || (knownAge !== null && knownAge >= ONE_YEAR_DAYS)) {
  return 'vaquillona';                            // [línea 269: quitar `hasService`]
}
if (knownAge !== null && knownAge < ONE_YEAR_DAYS) return 'ternera';
return 'vaquillona';
```
- **`hasService` se elimina por completo** (la declaración de la línea 261 y su uso en la 269): ya no se usa en ningún lado de la función. El `eventType === 'service'` deja de leerse en `computeCategoryCode` (pero el `service` se sigue trayendo en `MIRROR_EVENT_TYPES` para el timeline — RPSC.1.6, no se toca).
- **El comentario de precedencia** (líneas 264-265: "vaquillona(destete|servicio|≥1año)") se actualiza para quitar "servicio" (RPSC.1.7).
- **El header anti-drift** (RC6.5.1, líneas ~226 "has_weaning / has_service") se actualiza: la rama `vaquillona` ya no espeja el `service` de `0062`; espeja `0104`.

### 4.2 B4 — preview de transición offline (RPSC.1.5)

`app/src/utils/maneuver-category-preview.ts` reusa `computeCategoryCode` → al quitar `hasService`, el preview converge solo. **Pero** hay dos lugares que **fabrican** eventos `service` y deben alinearse para que el preview no mienta:
- `syntheticEventsForFemaleCategory('vaquillona')` (línea 93-94) reconstruye el "estado de partida" de una vaquillona con `[service]`. Tras B4, `[service]` ya NO produce `vaquillona` en el espejo → el sintético dejaría de reconstruir el estado. **Fix:** reconstruir `vaquillona` con un evento que SÍ la produzca post-`0104` — un **destete** (`[weaning]`) o un sintético de edad. [DECISIÓN DD-PSC-7: usar `[weaning]` para reconstruir `vaquillona` — es la vía canónica ternera→vaquillona del Gate 0 §2.1, y no depende de inyectar un `birthDate` ≥1 año.]
- `capturedReproEvents` (línea 124-130) mapea `kind:'inseminacion'` → evento `service`. Tras B4, una IA capturada ya NO anticipa `ternera → vaquillona`. **Esto es correcto** (RPS.4.8: la IA registra la servida en Stream C, no cambia la categoría). **Fix:** dejar de inyectar el evento `service` por una IA en el preview (la IA ya no transiciona categoría) — el preview de inseminación deja de mostrar una transición. El test "ternera + inseminación → vaquillona" (`maneuver-category-preview.test.ts:147`) se invierte a "→ null" (sin transición).

> **Consistencia clave:** B4 NO es solo "una línea". Toca `computeCategoryCode` (la línea) + `syntheticEventsForFemaleCategory` (reconstruir vaquillona sin service) + `capturedReproEvents` (IA ya no transiciona) + sus dos suites de tests. El reviewer verifica que el preview offline (R8.4) quede consistente con el server (cero drift, que es el punto de C6).

### 4.3 B2 — persistencia del tacto (RPSC.5.7 + DD-PSC-2)

`TactoStep` (`app/app/maniobra/_components/TactoStep.tsx`) recibe los `buckets: SizeBucket[]` (de `sizeBucketsForServiceMonths`, vía el frame `carga.tsx`/`paso.tsx` que conoce el rodeo de la jornada + el config "¿medir tamaño?"):
- `buckets.length === 0` (1/12 meses, o "medir tamaño = NO"): al marcar **PREÑADA**, `onConfirm('large')` directo (DD-PSC-2) — sin sub-paso 2. (VACÍA → `onConfirm('empty')` como hoy.)
- `buckets.length === 2` (2 meses): sub-paso 2 con **2 bloques** (CABEZA `large` / COLA `small`).
- `buckets.length === 3` (3–11 meses): sub-paso 2 con **3 bloques** (CABEZA/CUERPO/COLA), como el as-built actual.
- El `onConfirm(status)` sigue persistiendo **un único** `reproductive_events` (`event_type='tacto'`, M2.2) — sin cambio en el write-path (`maneuver-events.ts`).

El **resumen** del animal (`describeStepValue`, `maneuver-sequence.ts:264`) ya muestra "Preñada · Cabeza/Cuerpo/Cola" para `large/medium/small`. Para una preñez sin tamaño (DD-PSC-2 → `large`), el resumen mostraría "Preñada · Cabeza"; [DECISIÓN DD-PSC-8: cuando la jornada NO mide tamaño, el resumen muestra solo **"Preñada"** (sin "· Cabeza"), para no exhibir un tamaño que el operario no diagnosticó]. El implementer pasa el flag "midió tamaño" al describe (o deriva del config) — decisión de presentación, cubierta por un test.

---

## 5. Multi-tenant, offline-first, PowerSync (transversal)

- **Multi-tenant (RPSC.8.1):** B1 nunca hardcodea `establishment_id`; el alta usa el del contexto activo (como `createRodeo` hoy), la edición deriva el establishment del rodeo **server-side** (la RPC `set_rodeo_service_months` lo hace, anti-IDOR — RPS.3.4). La UI de gestión de rodeos solo la ve el owner (spec 02 C1, `rodeos.tsx:45`). B2/B3/B4 no escriben datos cross-tenant nuevos.
- **Offline-first (RPSC.8.2):** B1 alta y edición van por outbox (overlay optimista + clasificación de rechazos), espejando `createRodeo`/`enqueueSetRodeoConfig`. B2 escribe el config jsonb local (CRUD-plano de `sessions`, ya offline). B3/B4 no cambian el modelo offline.
- **PowerSync `rodeos.service_months` (RPSC.3.7, dependencia):** el implementer agrega `service_months: column.text` a la tabla `rodeos` del `AppSchema` (`schema.ts:148`). PowerSync materializa el `smallint[]` de Postgres como TEXT/JSON; `parseServiceMonths` (DD-PSC-5) lo convierte a `number[] | null` de forma tolerante. **Verificar** que la sync rule (`sync-streams/rafaq.yaml`, stream `est_rodeos`) incluye la columna (Stream A la agregó en la migración; el cliente debe declararla en el schema local o la lectura del rodeo no la trae). Si la stream NO la emite, es un gap de Stream A a anotar (no debería: `service_months` es columna de `rodeos`, que ya se sincroniza enteramente).

---

## 6. B3 — qué se quita y qué se conserva (detalle)

- **Se quita:** la opción **"Monta natural"** (`service_type='natural'`) del flujo "Agregar evento" de la ficha (`agregar-evento.tsx`), vía filtrado de `SERVICE_TYPE_OPTIONS` o del render del `ServiceForm` (DD-PSC-6).
- **Se conserva:** IA (`ai`) y TE (`te`) en "Agregar evento" (carga reproductiva real per-vaca); la inseminación de manga (`InseminacionStep`, `service`+`ai`) **intacta** (RPSC.6.2); todos los eventos `service` históricos en el timeline (RPSC.6.3).
- **No se toca:** el enum `service_type` DB, `reproductive_events`, `addService`/`buildAddServiceInsert`, el aviso suave `reproductiveWarning('service', …)` (`event-input.ts:310` — sigue válido para IA/TE: "figura preñada, ¿registrar el servicio igual?").
- **Constatación (RPSC.6.4):** no hay preset/secuencia/maniobra de servicio natural que romper (el servicio natural nunca fue `ManeuverKind`). Cerrado.
- **Tests (RPSC.6.5):** `app/e2e/events.spec.ts:190` ("reproductivo: … → servicio" con "Monta natural") se actualiza — el flujo de monta natural manual ya no existe; el test cubre IA/TE y/o el resto de los reproductivos. El gate-por-sexo (`events.spec.ts:147`, machos no ven Tacto/Servicio/Parto) **no cambia** (la card "Servicio" sigue, ahora IA/TE).

---

## 7. Archivos a crear / modificar (resumen)

**B4 (RPSC.1) — primero, lógica pura, sin design-spike:**
- MOD `app/src/utils/animal-category.ts` — quitar `hasService` de `computeCategoryCode` + actualizar comentarios/header anti-drift.
- MOD `app/src/utils/animal-category.test.ts` — invertir T2.23 (`service` ya no promueve).
- MOD `app/src/utils/maneuver-category-preview.ts` — reconstruir `vaquillona` sin `service` (DD-PSC-7) + IA ya no anticipa transición.
- MOD `app/src/utils/maneuver-category-preview.test.ts` — invertir "ternera + inseminación → vaquillona".

**B1 (RPSC.2/RPSC.3) — design-spike + veto:**
- NEW `app/src/utils/service-months.ts` (+ `.test.ts`) — parseo/mapeo puro (DD-PSC-5).
- NEW `app/app/_components/ServiceMonthsSelector.tsx` — selector de 12 meses reutilizable.
- MOD `app/app/crear-rodeo.tsx` — paso/sección de meses (alta).
- MOD `app/app/editar-plantilla.tsx` y/o `app/app/rodeos.tsx` — superficie de ver/editar meses (edición).
- MOD `app/src/services/rodeos.ts` — `createRodeo` pasa `p_service_months`; +`setRodeoServiceMonths`.
- MOD `app/src/services/powersync/outbox.ts` — +`enqueueSetRodeoServiceMonths`; `enqueueCreateRodeo` pasa `p_service_months`.
- MOD `app/src/services/powersync/upload.ts` — +`'set_rodeo_service_months'` en `RPC_OP_TYPES` + `P0002 → permanent_reject`.
- MOD `app/src/services/powersync/schema.ts` — +`service_months: column.text` en `rodeos`.
- MOD lecturas de rodeo (`local-reads.ts` `buildRodeosQuery`/overlay) — proyectar `service_months`.

**B2 (RPSC.4/RPSC.5) — design-spike + veto:**
- NEW `app/src/utils/pregnancy-buckets.ts` (+ `.test.ts`) — regla de buckets CCL (DD-PSC-3).
- MOD `app/app/maniobra/_components/TactoStep.tsx` — N botones de tamaño (RPSC.5).
- MOD `app/app/maniobra/_components/ManeuverConfigSheet.tsx` (o un sheet/uso nuevo) — config "¿medir tamaño?".
- MOD `app/app/maniobra/jornada.tsx` + `carga.tsx`/`paso.tsx` — derivar default + pasar buckets/flag al `TactoStep`.
- MOD `app/src/utils/maneuver-sequence.ts` — `describeStepValue` para "preñada sin tamaño" (DD-PSC-8).

**B3 (RPSC.6) — sin design-spike:**
- MOD `app/app/agregar-evento.tsx` (y/o `app/src/utils/event-input.ts`) — quitar `natural` del selector de servicio.
- MOD `app/e2e/events.spec.ts` — actualizar el flujo de servicio.

---

## 8. Alternativas descartadas

- **B2 — agregar un valor "preñada sin tamaño" al enum `pregnancy_status`** (DD-PSC-2). Descartada: tocar el enum es **schema → reabriría Gate 1** (lo que B2 evita) y rompería el espejo/`compute_category` que tratan "positivo" como `<> 'empty'`. Mapear "sin tamaño" a `'large'` (positivo, no engañoso para 1/12 meses) cumple sin tocar nada.
- **B2 — duplicar la regla de buckets en `TactoStep` y en el config** (DD-PSC-3). Descartada: garantiza drift cuando Facundo afine el bucketing ([TENTATIVO]). Una función pura compartida es testeable y de una sola fuente.
- **B1 — `service_months` como UPDATE plano (CRUD-plano de PowerSync)** en vez de RPC (DD-PSC-4). Descartada como default: la escritura de rodeos ya va por RPC en el repo (centraliza authz owner-only + re-validación); un segundo camino de escritura de rodeos es inconsistente. (Técnicamente viable —la RLS owner-only + el CHECK lo cubrirían, Stream A DD-PS-2 lo contempla— pero no es el patrón as-built.)
- **B1 — backfillear primavera en la edición de rodeos existentes** (RPSC.3.2). Descartada: espejo de DD-PS-3 de Stream A — inventar una campaña que el productor no declaró da KPIs falsos. La edición arranca "sin configurar" e invita a elegir.
- **B3 — deprecar también la IA y/o la TE de la ficha** (DD-PSC-6). Descartada: el Gate 0 §1 dice explícito "la IA/IATF NO se toca"; la TE es, como la IA, una intervención real per-vaca (no una monta grupal). Solo `natural` es el dato ficticio que el rodeo-level reemplaza.
- **B4 — quitar `'service'` de `MIRROR_EVENT_TYPES`** (la query del espejo) además de la lógica (RPSC.1.6). Descartada: el `service`/IA es un evento del timeline; quitarlo de la query lo escondería del timeline. El cambio es **solo** en `computeCategoryCode` (que deja de usarlo); la query lo sigue trayendo.

---

## 9. Qué necesita verificar el leader / gates

- **Gate 1 — N/A confirmado** (§0): frontend puro; el backend (schema/RLS/RPC/`compute_category`/derivación) lo hizo Stream A y ya pasó Gate 1. **Disparador de reapertura:** si un chunk termina necesitando schema/RLS/Edge nuevo → Gate 1 OBLIGATORIO + parar (RPSC.8.4). No debería ocurrir con este diseño.
- **Gate 2 — por chunk** (siempre): RLS no-bypass (B1 no abre un camino de escritura que saltee la RPC owner-only), sin hardcode de `establishment_id`, parseo del array desde TEXT no-injectable.
- **Design-spike + veto del leader** (skill `design-review`, memoria `feedback_design_vet_before_showing`): **B1** (selector de 12 meses) y **B2** (config "¿tamaño?" + N botones de `TactoStep`) **antes** de mostrar a Raf. Vetar en **web táctil real** (`reference_rn_web_pitfalls`); recorte de descendentes; densidad R12.5; botones gigantes manga (ADR-023). **B3 y B4 no necesitan spike.**
- **Confirmar [TENTATIVO] con Facundo (Gate 0 §9)** cuando vuelva de la universidad: bucketing CCL de 4–11 meses (¿tercios exactos?), default "sin distinción", política de tacto de rodeos de 12 meses. Entra como reconciliación de esta spec (preservando los IDs `RPSC.x`), no reabre el modelo. La función pura `sizeBucketsForServiceMonths` (DD-PSC-3) es el único lugar a tocar.
- **Encadenar B4 con el deploy de Stream A:** Stream A (`0104`) **ya está aplicado** (done) → el drift display-only está **vivo ahora** → B4 es prioridad (DD-PSC-1). El leader lo verifica al planificar el orden.
