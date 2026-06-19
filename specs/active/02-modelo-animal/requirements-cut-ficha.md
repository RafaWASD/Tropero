# Requirements (delta spec 02) — Marcar CUT (descarte) desde la ficha + indicador amarillo

**Status**: `spec_ready` (delta de spec 02 — frontend). Gate 0 cerrado en `context-cut-ficha.md` (Raf, 2026-06-17).
**Fecha**: 2026-06-18
**Autor**: spec_author

> **Delta, no refundición.** Estas requirements EXTIENDEN spec 02 (modelo-animal) sin tocar `requirements.md`
> base. Numeradas `RCUT.n` para no colisionar con los IDs estables de spec 02. Fuente de verdad: el
> contexto refinado y aprobado `specs/active/02-modelo-animal/context-cut-ficha.md` (D1/D2/D3) + ADR-008
> (CUT = "Criando Último Ternero", marca de descarte ortogonal female-only). El plumbing de datos ya existe
> (`buildSetCutUpdate`/`buildUnsetCutUpdate`/`resolveCutCategory`) — esto es una afordancia nueva en la ficha
> + una variante de color del badge.

## Alcance

Dos capacidades sobre una categoría que YA existe (`code='cut'`, `is_cut`, `category_override=true`):

1. **Marcar / Quitar CUT desde la ficha** del animal (hoy solo se puede vía MODO MANIOBRAS / prompt de
   dientes, spec 03). Afordancia equivalente en la ficha, female-only.
2. **Indicador de categoría CUT en AMARILLO** (no verde como el resto), en la ficha y en toda superficie
   donde aparece el `CategoryBadge`.

Cada "Decisión cerrada" de `context-cut-ficha.md` queda cubierta por ≥1 requirement: D1 → RCUT.5/RCUT.6;
D2 → RCUT.3/RCUT.4; D3 → RCUT.3 (predicado female-only).

---

## RCUT.1 — Servicio `setCut` (marcar como CUT, offline-first)

- **RCUT.1.1** — WHEN se invoca `setCut(profileId)`, el sistema DEBE resolver la categoría CUT del sistema del
  rodeo vía `resolveCutCategory(profileId)` y, con el `cutCategoryId` resuelto, ejecutar el UPDATE local
  `buildSetCutUpdate(profileId, cutCategoryId)` (`is_cut=1, category_id=<cut>, category_override=1`).
- **RCUT.1.2** — IF `resolveCutCategory` no resuelve el `cutCategoryId` (sin `system_id` o sin fila `'cut'`
  en el catálogo local) THEN `setCut` DEBE devolver `{ ok:false }` con un mensaje de error accionable en
  es-AR (voseo) y NO escribir nada (nunca fija una categoría inválida — el server la rechazaría 23514).
- **RCUT.1.3** — El write DEBE ser offline-first: una sola escritura local plana sobre `animal_profiles` (una
  CrudEntry PATCH) con éxito local inmediato; la RLS `animal_profiles_update` + el gating capa 2 (`dientes`,
  0054) son la barrera real **al subir**, no en el cliente.
- **RCUT.1.4** — `setCut` DEBE exponer la firma `ServiceResult<true>` (mismo shape que `setCastrated`/
  `setFutureBull`), para que el caller reaccione a ok/error sin acoplarse al valor.

## RCUT.2 — Servicio `unsetCut` (quitar CUT, offline-first)

- **RCUT.2.1** — WHEN se invoca `unsetCut(profileId)`, el sistema DEBE resolver la categoría DERIVADA vía
  `resolveCutCategory(profileId).derivedCategoryId` y ejecutar el UPDATE local
  `buildUnsetCutUpdate(profileId, derivedCategoryId)` (`is_cut=0, category_id=<derivada>,
  category_override=0`) — el camino que SÍ resetea `is_cut` (cambio sustractivo, NO gateado por `dientes`,
  0054 §D8).
- **RCUT.2.2** — IF la categoría derivada no es resoluble localmente THEN `unsetCut` DEBE devolver
  `{ ok:false }` con error accionable es-AR y NO escribir (no deja un `is_cut` colgado sobre una categoría
  inconsistente).
- **RCUT.2.3** — El sistema NO DEBE ofrecer la card genérica "Quitar fijación" (`revertCategoryOverride`)
  como vía de desmarcado de un CUT: esa ruta NO resetea `is_cut` → dejaría `is_cut=1` con categoría no-CUT
  (estado inconsistente). El desmarcado de un CUT SIEMPRE pasa por `unsetCut`/`buildUnsetCutUpdate`.

## RCUT.3 — Predicado de eligibilidad (a quién se ofrece, D2/D3)

- **RCUT.3.1** — El sistema DEBE ofrecer "Marcar como CUT (descarte)" SSI el animal es **hembra activa que
  NO es ternera ni ya es CUT**: `sex === 'female'` AND `status === 'active'` AND `categoryCode !== 'ternera'`
  AND el animal NO es CUT (ver RCUT.4).
- **RCUT.3.2** — El sistema NO DEBE ofrecer ninguna afordancia CUT para machos (`sex === 'male'`) — CUT es
  female-only por definición (D3).
- **RCUT.3.3** — El predicado DEBE ser una función PURA y testeable (sin RN/red/SDK), con `categoryCode`/`sex`/
  `status`/`isCut` como entradas. IF `categoryCode` es desconocido (`null`/`''`) THEN el criterio conservador
  DEBE aplicar: NO se ofrece marcar CUT (no marcamos descarte sobre una categoría que no se pudo resolver).

## RCUT.4 — `AnimalDetail` expone `is_cut`

- **RCUT.4.1** — `fetchAnimalDetail` DEBE exponer en `AnimalDetail` un campo booleano `isCut` derivado de
  `animal_profiles.is_cut` (0/1 de SQLite → boolean), tanto en la rama synced como en la overlay (alta
  optimista nace `is_cut=0`).
- **RCUT.4.2** — La ficha DEBE usar `detail.isCut` (no inferir CUT del `categoryCode`/`categoryName`) para
  decidir cuál afordancia mostrar: "Marcar como CUT" (no-CUT) vs "Quitar CUT" (CUT).

## RCUT.5 — Afordancia en la ficha (hembras activas ≠ ternera)

- **RCUT.5.1** — WHEN la ficha de una hembra cumple RCUT.3.1 (activa, ≠ ternera, no-CUT) AND el rodeo del
  animal habilita el gate de `dientes` (RCUT.7), el sistema DEBE mostrar en la sección "Manejo" la acción
  **"Marcar como CUT (descarte)"** con confirmación INLINE (mismo patrón que `CastrationRow`: expande
  Confirmar/Cancelar, no navega ni abre modal).
- **RCUT.5.2** — La confirmación DEBE anticipar la CONSECUENCIA en es-AR: **"La categoría pasará a CUT
  (descarte)."** (visibilidad del estado del sistema, prevención de error — paralelo a la línea de
  consecuencia de `CastrationRow`/`CategoryOverrideCard`).
- **RCUT.5.3** — WHEN el usuario confirma "Marcar como CUT", el sistema DEBE invocar `setCut(profileId)` con
  optimismo EN SITIO (la fila refleja el estado nuevo sin blanquear la ficha) + refresh silencioso (mismo
  patrón que `onSetCastrated`). IF `setCut` falla THEN DEBE mostrar el error accionable inline y dejar la
  confirmación abierta para reintentar, sin cambiar el estado mostrado.
- **RCUT.5.4** — WHEN la hembra YA es CUT (`detail.isCut === true`) AND está activa, el sistema DEBE mostrar
  en su lugar la acción **"Quitar CUT"** (con confirmación inline), que al confirmar invoca `unsetCut`
  (RCUT.2) — NUNCA la card genérica "Quitar fijación" (RCUT.2.3).
- **RCUT.5.5** — La afordancia CUT DEBE existir SOLO para hembras: la sección "Manejo" hoy se renderiza solo
  para machos (`detail.sex === 'male'`); el sistema DEBE renderizar la afordancia CUT en la rama de hembras
  sin alterar las filas de machos (castrado / futuro torito).
- **RCUT.5.6** — Si el animal está archivado/inactivo (`status !== 'active'`), el sistema NO DEBE ofrecer ni
  marcar ni quitar CUT (consistente con el resto de acciones de manejo, que solo se ofrecen en activos).
- **RCUT.5.7** — WHEN la hembra es CUT (`detail.isCut === true`), el sistema NO DEBE renderizar la
  `CategoryOverrideCard` genérica ("Categoría fijada manualmente" / "Quitar fijación"): esa card usa
  `revertCategoryOverride`, que NO resetea `is_cut` (RCUT.2.3) → dejaría un estado inconsistente. El ÚNICO
  desmarcado ofrecido para un CUT es "Quitar CUT" (RCUT.5.4). La `CategoryOverrideCard` SE SIGUE mostrando
  para un override NO-CUT (`categoryOverride === true AND isCut === false`, ej. una "vaca comprada" fijada a
  multípara manual): el cambio es estrictamente `categoryOverride ? …` → `categoryOverride && !isCut ? …`.

## RCUT.6 — Variante amarilla del `CategoryBadge`

- **RCUT.6.1** — WHEN el `CategoryBadge` representa la categoría CUT, DEBE renderizar la variante AMARILLA
  (texto amber oscuro `$cutText` sobre fondo amber pálido `$cutBg`), distinta del verde de las demás
  categorías (fondo `$greenLight` / texto `$primary`).
- **RCUT.6.2** — La detección de CUT DEBE ser, en orden de preferencia: (1) `code === 'cut'` cuando el
  call-site tiene el `code` (nueva prop `code?`); (2) fallback por `label`/`name === 'CUT'` (valor FIJO del
  catálogo es-AR) para los call-sites que solo tienen el nombre. La detección DEBE ser una función pura
  testeable.
- **RCUT.6.3** — El contraste DEBE ser ≥ 4.5:1 del texto sobre el fondo del badge **y** del texto sobre
  blanco (medido, ver design). La variante amarilla NO DEBE degradar la legibilidad respecto del badge verde.
- **RCUT.6.4** — La accesibilidad DEBE seguir comunicando la categoría: el `accessibilityLabel`/`aria-label`
  sigue siendo "Categoría CUT" (+ ", fijada manualmente" si `manual`); el color es señal adicional, no la
  única (no se comunica el descarte SOLO por color).
- **RCUT.6.5** — El cambio DEBE preservar el comportamiento actual del badge para toda categoría NO-CUT (los
  6 call-sites siguen renderizando verde sin tocar su markup salvo el paso opcional de `code`).

## RCUT.7 — Gate de cliente por `dientes` (no ofrecer lo que el server rechazaría)

- **RCUT.7.1** — El sistema DEBE ofrecer "Marcar como CUT" SOLO si el rodeo del animal tiene el data_key
  `dientes` **enabled** (best-effort, leyendo el `rodeo_data_config` local del `detail.rodeoId`) — porque
  `buildSetCutUpdate` es un cambio aditivo (`is_cut` false→true) que el trigger `tg_animal_profiles_teeth_
  gating` (0054) rechaza al subir (23514) si `dientes` está deshabilitado.
- **RCUT.7.2** — El gate NO DEBE aplicar a "Quitar CUT": `buildUnsetCutUpdate` es sustractivo (`is_cut`
  true→false), NO gateado por 0054 → la corrección de un CUT siempre se ofrece en una hembra CUT activa,
  aunque el rodeo no habilite `dientes`.
- **RCUT.7.3** — Fail-safe del gate: IF el estado de `dientes` del rodeo no se puede resolver localmente
  (sin config, sin rodeo, lectura local falla) THEN el sistema DEBE aplicar el criterio **conservador = NO
  ofrecer "Marcar como CUT"** (no ofrecemos una acción que el server podría rechazar; el camino canónico
  para marcar CUT en ese caso sigue siendo el prompt de dientes en MODO MANIOBRAS). Este criterio es
  consistente con que CUT vive en rodeos que trackean dientes (cría, `dientes` ON por default — ADR-021).

## RCUT.8 — Idioma, offline y multi-tenant

- **RCUT.8.1** — Todos los textos visibles DEBEN estar en español argentino (voseo); cero hardcode de
  colores/íconos (tokens + `getTokenValue` para lucide); a11y por helpers de `utils/a11y` (ADR-023 §4).
- **RCUT.8.2** — Marcar/quitar CUT DEBE funcionar OFFLINE (escritura local plana, sin red); la consistencia
  multi-tenant (que el animal pertenezca a un establishment al que el usuario tiene rol) la enforza la RLS
  `animal_profiles_update` **al subir** — el cliente NO replica esa autorización.

---

## Trazabilidad context → requirement

| Caso / decisión de `context-cut-ficha.md` | Requirement(s) |
|---|---|
| D1 — Color CUT = amarillo (token nuevo) | RCUT.6.1, RCUT.6.3 |
| D2 — Se ofrece a todas las hembras activas ≠ ternera | RCUT.3.1, RCUT.5.1 |
| D2 — Si ya es CUT → "Quitar CUT" | RCUT.5.4, RCUT.2 |
| D3 — Machos: no aplica (female-only) | RCUT.3.2 |
| Edge 1 — Gating `dientes` (0054) | RCUT.7 |
| Edge 2 — Consistencia `is_cut` ↔ override (no usar "Quitar fijación") | RCUT.2.3, RCUT.4 |
| Edge 3 — Legibilidad del amarillo sobre blanco/badge | RCUT.6.3 |
| Servicios `setCut`/`unsetCut` reusando builders existentes | RCUT.1, RCUT.2 |

## Cobertura de tests (cada RCUT verificable)

- **Unit** — `setCut` resuelve+escribe / falla sin `cutCategoryId` sin escribir (RCUT.1); `unsetCut`
  resetea `is_cut` por la derivada / falla sin derivada (RCUT.2); predicado de eligibilidad (female activa
  ≠ ternera, machos NO, ternera NO, CUT→quitar, categoryCode null→conservador, RCUT.3); detección CUT del
  badge por `code` y por `label` fallback (RCUT.6.2); `AnimalDetail.isCut` mapeado de 0/1 (RCUT.4).
- **E2E (Playwright)** — desde la ficha de una hembra activa ≠ ternera: marcar CUT (confirmación inline →
  categoría CUT + badge amarillo) y quitar CUT (vuelve a la derivada + badge verde); aserción del color del
  badge CUT (RCUT.5/RCUT.6). El gate de `dientes` se cubre en el unit del predicado de gate (RCUT.7).

## Historial de refinamiento

- 2026-06-18 — Redacción inicial del delta CUT-ficha desde `context-cut-ficha.md` (Gate 0 aprobado por Raf
  2026-06-17). IDs nuevos `RCUT.n` (no tocan los IDs estables de spec 02). Sin re-decidir D1/D2/D3.
