# Requirements (delta spec 02) — Fijar la categoría a mano + tacto reproductivo, desde la ficha

**Status**: `spec_ready` (delta de spec 02 — frontend). Gate 0 cerrado por Raf en conversación con el leader
(2026-08-06); las decisiones cerradas están transcriptas abajo en "Contexto cerrado (Gate 0)".
**Fecha**: 2026-08-06
**Autor**: spec_author

> **Delta, no refundición.** Estas requirements EXTIENDEN spec 02 (modelo-animal) sin tocar `requirements.md`
> base ni el `tasks.md` original. Dos familias de IDs nuevas para no colisionar con los IDs estables ya
> aprobados: **`RCM.n`** (Categoría Manual) y **`RTF.n`** (Tacto desde la Ficha). Ninguna colisiona con
> `RCUT` / `RCF` / `RC6` / `RAR` / `RT2` / `RTR` / `RPS` / `RPSC` / `RCAP` / `RPRC` / `PCV` / `IDU`.
>
> **Por qué UN delta y no dos** (ADR-028 Nivel B, criterio de agrupación): las dos capacidades viven en la
> MISMA superficie (`app/app/animal/[id].tsx`), comparten el mismo modelo de acción de la ficha (afordancia →
> confirmación → write local plano → optimismo en sitio → refresh silencioso), el mismo contrato offline y el
> mismo perímetro multi-tenant (todo derivado de `detail.*`, nunca del contexto activo). Separarlas duplicaría
> el 60% del `design.md`. Precedente directo: `alta-form-refinamiento` (3 cambios no relacionados, una sola
> tanda, un solo delta). **Por qué en spec 02 y no en 03**: el dueño de la ficha es spec 02; de spec 03 se
> CONSUMEN utilidades puras y dos componentes de paso **sin modificar su comportamiento** (`TactoStep` /
> `TactoVaquillonaStep` / `maneuver-applicability` / `maneuver-gating` / `pregnancy-buckets`) — precedente ya
> establecido: la ficha importa `CustomPropertiesFicha` de `app/maniobra/_components/` y el
> `ConditionScoreStepper` se compartió en un delta de spec 02 sin abrir un delta de spec 03.

---

## Contexto cerrado (Gate 0) — no se re-decide

**Funcionalidad 1 — forzar la categoría a mano desde la ficha.**
- C1.1 — Se ofrece **cualquier categoría del MISMO SEXO** del animal.
- C1.2 — Si la categoría elegida es **incoherente con la edad**, NO se bloquea: se **avisa qué va a quedar
  raro** y se pide confirmación.
- C1.3 — **Cambiar el sexo queda FUERA de alcance** (analizado y anotado en `docs/backlog.md`, entrada
  "2026-08-06 — El sexo es el único dato del alta que no se puede corregir nunca"). No se asume disponible.

**Funcionalidad 2 — tacto reproductivo desde la ficha, animal por animal.**
- C2.1 — **Los dos tipos**: tacto de **preñez** y tacto de **aptitud reproductiva**.
- C2.2 — La ficha ofrece **el que corresponda** según el estado reproductivo del animal, con **el mismo
  criterio de gating que ya usa la maniobra** — no uno nuevo.
- C2.3 — El evento se registra **suelto, sin jornada**, pero **tiene que ser visible en los reportes**.

Lo que quedó a resolver por el `spec_author` (y se resuelve acá + en `design.md`): de dónde sale la lista de
categorías (RCM.2), qué significa "incoherente con la edad" (RCM.4), cómo convive con la derivación
automática y con "Quitar fijación" (RCM.5/RCM.7), qué pasa con el estado derivado al fijar (RCM.8), y la
imputación a período / compatibilidad "sin jornada ↔ reportes" (RTF.8, **verificada contra `0105`/`0106`**).

---

# Familia RCM — Fijar la categoría a mano desde la ficha

## RCM.1 — Fila "Categoría" en la ficha

- **RCM.1.1** — La ficha DEBE mostrar una fila **"Categoría"** en la sección "Datos del animal",
  inmediatamente debajo de "Nacimiento", con el `categoryName` VIGENTE que ya resuelve el espejo C6
  (`detail.categoryName`) — la misma categoría que muestra el `CategoryBadge` del hero (una sola fuente, sin
  recomputar).
- **RCM.1.2** — WHEN el animal es elegible para fijar (RCM.7.1), la fila DEBE ofrecer la afordancia
  **"Cambiar"** (link discreto `$primary` a la derecha del label), con el MISMO patrón visual y de a11y que la
  fila "Raza" (`BreedRow`).
- **RCM.1.3** — WHEN el animal NO es elegible, la fila DEBE renderizarse **solo lectura** (label + valor, sin
  "Cambiar"), sin ocultar la categoría.
- **RCM.1.4** — La fila NO DEBE reemplazar ni duplicar el `CategoryBadge` del hero ni la
  `CategoryOverrideCard` (RC6.4): las tres siguen existiendo, con sus reglas actuales intactas.

## RCM.2 — Qué categorías se ofrecen

- **RCM.2.1** — El sistema DEBE ofrecer las categorías del catálogo **`categories_by_system` del sistema del
  rodeo REAL del animal** (`detail.rodeoId` → `fetchRodeoCategoryCatalog`), leído del SQLite local
  (offline), preservando el `sort_order` del catálogo.
- **RCM.2.2** — El sistema DEBE filtrar ese catálogo al **sexo del animal**, reusando las constantes YA
  existentes `MALE_CATEGORY_CODES` / `FEMALE_CATEGORY_CODES` de `animal-category-picker.ts` (fuente única del
  mapeo sexo↔code; el catálogo no tiene columna de sexo). En consecuencia quedan FUERA `cut` y `vaca_cabana`,
  igual que en el alta (RCM.2.4/RCM.2.5).
- **RCM.2.3** — Para un MACHO, el sistema DEBE ofrecer además solo las categorías **coherentes con su
  `is_castrated` REAL**: `is_castrated = false` → `ternero` / `torito` / `toro`; `is_castrated = true` →
  `ternero` / `novillito` / `novillo`. Para una HEMBRA se ofrecen las 5 de `FEMALE_CATEGORY_CODES` (el eje
  castración no aplica).
- **RCM.2.4** — El sistema NO DEBE ofrecer `cut` en este selector: `cut` tiene su propia afordancia
  (`RCUT.5`), acopla `is_cut = true` y está gateada por el data_key `dientes` (`0054`); ofrecerla acá
  produciría `category_id = cut` con `is_cut = false` — exactamente el estado inconsistente que RCUT.2.3
  prohíbe.
- **RCM.2.5** — El sistema NO DEBE ofrecer `vaca_cabana` (fuera del MVP de cría, misma exclusión que el alta).
- **RCM.2.6** — El filtro DEBE ser una función PURA y testeable (sin RN/red/SDK) con `(catálogo, sexo,
  isCastrated)` como entradas. IF el filtro devuelve **cero** categorías (catálogo aún no sincronizado, o
  sistema productivo sin ninguno de esos codes) THEN el sistema NO DEBE ofrecer "Cambiar" (fail-safe: la fila
  queda solo lectura, RCM.1.3) y NO DEBE romper la ficha.
- **RCM.2.7** — La opción correspondiente a la categoría VIGENTE del animal DEBE mostrarse marcada como
  seleccionada (check + borde `$primary`), igual que en `BreedPickerSheet`.

## RCM.3 — Sheet de selección

- **RCM.3.1** — WHEN el usuario toca "Cambiar", el sistema DEBE abrir un **bottom sheet** construido sobre el
  primitivo `BottomSheetShell` (regla dura de `docs/design-system.md` §6: todo bottom sheet nuevo usa el
  shell), montado/desmontado con el estado de apertura (precondición 1 del shell).
- **RCM.3.2** — El sheet DEBE listar una fila tappable por categoría ofrecida, con alto ≥ `$touchMin` (Fitts)
  y el nombre es-AR del catálogo, sin campo de búsqueda (son ≤ 5 opciones).
- **RCM.3.3** — WHEN el usuario toca una opción, el sheet DEBE pasar a una **fase de confirmación** dentro del
  mismo sheet (no navega, no abre un segundo overlay), con los botones `Cancelar` / `Confirmar` en el footer
  fijo.
- **RCM.3.4** — WHEN el usuario toca la categoría que YA está vigente y NO hay cambio de `category_override`
  que aplicar, el sistema DEBE cerrar el sheet sin escribir nada (no-op).
- **RCM.3.5** — Cerrar el sheet por cualquiera de sus vías (X, scrim, arrastre, back de Android) desde la fase
  de confirmación DEBE cancelar sin escribir. El sheet NO tiene texto tipeado que perder → no requiere
  confirmación de cierre (precondición 2 del shell, evaluada y descartada explícitamente).

## RCM.4 — Confirmación: consecuencia + aviso de incoherencia con la edad

- **RCM.4.1** — La fase de confirmación DEBE mostrar la pregunta en es-AR nombrando la categoría elegida (ej.
  *"¿Fijar la categoría en Vaca multípara?"*).
- **RCM.4.2** — La fase de confirmación DEBE mostrar SIEMPRE la **consecuencia** de fijar, en es-AR: que la
  categoría **queda fijada a mano y deja de actualizarse sola** (ni por edad ni por eventos: parto, tacto,
  destete, castración), y que la fijación se puede quitar después.
- **RCM.4.3** — El sistema DEBE definir "**incoherente con la edad**" como: el animal tiene `birth_date`
  conocida Y su edad en días cae **fuera de la ventana etaria** del `code` elegido, con las ventanas derivadas
  de los MISMOS cortes que usa el espejo de `compute_category` (`ONE_YEAR_DAYS` = 365, `TWO_YEAR_DAYS` = 730):
  | code | ventana (días) |
  |---|---|
  | `ternero` / `ternera` | `[0, 365)` |
  | `torito` / `novillito` | `[365, 730)` |
  | `toro` / `novillo` | `[730, ∞)` |
  | `vaquillona` | `[365, ∞)` |
  | `vaquillona_prenada` / `vaca_segundo_servicio` / `multipara` | `[365, ∞)` |
  Las tres últimas son estados **post-vaquillona**: su único piso etario asertable por el modelo es el corte
  ternera→vaquillona (365 d). No se inventa ningún umbral biológico nuevo (ningún mínimo de "3 años" para
  multípara, etc.): eso queda fuera del alcance de este delta.
- **RCM.4.4** — IF la categoría elegida es incoherente con la edad (RCM.4.3) THEN la confirmación DEBE mostrar
  ADEMÁS un aviso en es-AR que nombre **la edad real del animal** y **la categoría que le correspondería por
  edad** (ej. *"El animal tiene 8 meses. Por edad le corresponde Ternera."*). El aviso NO DEBE bloquear:
  `Confirmar` sigue habilitado (C1.2).
- **RCM.4.5** — IF el animal NO tiene `birth_date` conocida THEN el sistema NO DEBE mostrar aviso de edad (no
  se juzga lo que no se sabe); la consecuencia de RCM.4.2 se muestra igual.
- **RCM.4.6** — La categoría "que le correspondería por edad" DEBE resolverse con el espejo existente
  (`computeCategoryCode` con `events: []` y el `is_castrated` real → nombre resuelto del catálogo local). IF
  ese nombre no se resuelve localmente THEN el aviso DEBE degradar a nombrar solo la edad, sin inventar una
  categoría.
- **RCM.4.7** — El cálculo de la incoherencia DEBE ser una función PURA y testeable, con `(code elegido,
  sexo, birth_date, is_castrated, today)` como entradas y `today` inyectable.

## RCM.5 — Semántica del write: fijar vs volver a automático

- **RCM.5.1** — WHEN la categoría elegida **DIFIERE** de la categoría DERIVADA por el espejo completo
  (`computeCategoryCode` con los eventos reales del animal), el sistema DEBE escribir
  `category_id = <elegida>` **Y** `category_override = true` en UN ÚNICO UPDATE local sobre `animal_profiles`.
- **RCM.5.2** — WHEN la categoría elegida **COINCIDE** con la derivada, el sistema DEBE escribir
  `category_id = <derivada>` **Y** `category_override = false` en un único UPDATE (es decir: elegir la
  automática **equivale a quitar la fijación**), reusando el builder del revert (`RC6.4`). Esto preserva el
  invariante ya establecido por el alta (`categoryOverrideFor`): *override = true ⟺ la categoría guardada
  difiere de la derivada*.
- **RCM.5.3** — La confirmación DEBE reflejar cuál de los dos casos aplica: en el caso RCM.5.2 el texto de
  consecuencia DEBE decir que la categoría **vuelve a actualizarse sola** (en vez del texto de RCM.4.2).
- **RCM.5.4** — El sistema NO DEBE escribir `is_castrated`, `is_cut`, `teeth_state` ni ninguna otra columna en
  esta operación: el write es exactamente `(category_id, category_override)`.

## RCM.6 — Servicio `setCategoryManual` (offline-first, fail-safe)

- **RCM.6.1** — WHEN se invoca `setCategoryManual(profileId, chosenCode)`, el sistema DEBE resolver
  localmente: (a) el `system_id` del rodeo del perfil, (b) el `category_id` de `chosenCode` en ese sistema
  (activo), y (c) el `code`/`category_id` DERIVADO por el espejo (reusando `resolveRevertCategory`, la misma
  resolución que ya usa "Quitar fijación" ⇒ no divergen).
- **RCM.6.2** — IF `chosenCode` no tiene fila ACTIVA en el catálogo local del sistema THEN el servicio DEBE
  devolver `{ ok:false }` con un error accionable en es-AR (voseo) y **NO escribir nada** (nunca fija una
  categoría que el trigger `animal_profiles_category_check` (`0021`) rechazaría con 23514). Mismo fail-safe
  que `setCut` (RCUT.1.2).
- **RCM.6.3** — IF la categoría DERIVADA no es resoluble localmente THEN el servicio DEBE, igualmente, poder
  ejecutar el caso RCM.5.1 (fijar) tratando la elección como distinta de la derivada; solo el caso RCM.5.2
  (volver a automático) requiere la derivada resuelta, y sin ella DEBE devolver el mismo error accionable de
  RC6.4.5 sin escribir.
- **RCM.6.4** — El write DEBE ser offline-first: **una sola** escritura local plana sobre `animal_profiles`
  (una CrudEntry PATCH), con éxito local inmediato. La RLS `animal_profiles_update` es la barrera REAL al
  SUBIR; el cliente NO replica autorización.
- **RCM.6.5** — El servicio DEBE exponer la firma `ServiceResult<{ override: boolean; categoryCode: string }>`
  para que el caller aplique el optimismo en sitio sin re-derivar nada.
- **RCM.6.6** — La DECISIÓN del servicio (qué builder usar y con qué id, o error sin escribir) DEBE vivir en
  un núcleo PURO testeable con fakes, separado del I/O (precedente `cut-service-core.ts` / TCUT.7: los
  services value-importan el SDK y no son importables bajo `node:test`).

## RCM.7 — Convivencia con "Quitar fijación" (RC6.4) y con CUT (RCUT)

- **RCM.7.1** — El sistema DEBE ofrecer "Cambiar" SSI: `detail.status === 'active'` **AND**
  `detail.isCut === false` **AND** hay ≥1 categoría ofrecible (RCM.2.6).
- **RCM.7.2** — El sistema NO DEBE ofrecer "Cambiar" sobre un animal CUT (`detail.isCut === true`): cambiar
  `category_id` dejaría `is_cut = 1` con una categoría no-CUT (el estado inconsistente de RCUT.2.3). En su
  lugar la fila DEBE mostrar la categoría CUT solo lectura con un hint es-AR que apunte a la acción correcta
  (*"Quitá la marca CUT para cambiar la categoría."*).
- **RCM.7.3** — El sistema NO DEBE modificar la `CategoryOverrideCard` (RC6.4) ni su gating actual
  (`categoryOverride && !isCut`): sigue siendo el atajo de "volver a automático" y sigue apareciendo bajo el
  hero cuando corresponde. El selector es el camino GENERAL; la card es el atajo.
- **RCM.7.4** — WHEN el usuario fija una categoría desde el selector, la `CategoryOverrideCard` DEBE aparecer
  en el mismo render (sin recargar la pantalla) por efecto del optimismo en sitio sobre `categoryOverride`.
- **RCM.7.5** — El sistema NO DEBE ofrecer esta afordancia como vía para cambiar la CASTRACIÓN: el eje
  entero↔castrado conserva su control propio ("Manejo → Castrado", R13.1), que ya recalcula la categoría
  server-side y client-side sin fijarla.

## RCM.8 — Estado derivado al fijar (qué se congela y qué no)

- **RCM.8.1** — WHEN `category_override = true`, el sistema NO DEBE recalcular la categoría del animal por
  transición automática: los triggers server-side ya lo respetan (`0062`/`0063` compute, `0046` recompute por
  evento, `0064`/`0086` castración, cron nocturno `0066`) y el espejo client-side C6
  (`deriveDisplayCategory`) muestra la GUARDADA. La ficha DEBE reflejar esa categoría **al instante y
  offline** (sin esperar sync).
- **RCM.8.2** — El sistema DEBE seguir registrando y mostrando TODOS los eventos del animal con la categoría
  fijada: el pin congela la CATEGORÍA, no el historial ni el estado reproductivo derivado
  (`deriveReproStatus`, que ya lee `categoryCode` + eventos).
- **RCM.8.3** — El sistema DEBE dejar registrado el cambio: el trigger `0030`
  (`animal_profiles_record_category_change_upd`) escribe una fila en `animal_category_history` con
  `reason = 'manual_override'` (o `'revert_to_auto'` en el caso RCM.5.2) y `changed_by = auth.uid()` **al
  subir**. El nodo `category_change` correspondiente aparece en el timeline recién después de sincronizar
  (`animal_category_history` no se escribe local) — comportamiento idéntico al de CUT/castración de hoy, no
  se agrega nada.
- **RCM.8.4** — El sistema NO DEBE prometer en la UI que el cambio aparece en el historial de forma inmediata
  (ver RCM.8.3): la confirmación habla de la consecuencia sobre la categoría, no del timeline.

## RCM.9 — Idioma, offline, multi-tenant y a11y

- **RCM.9.1** — Todos los textos visibles DEBEN estar en español argentino (voseo); cero hardcode de colores/
  íconos (tokens + `getTokenValue` para lucide); a11y por los helpers de `utils/a11y`; `lineHeight` matcheado
  en todo `Text` con `numberOfLines` o `fontSize` ≥ `$6` (regla de recorte de descendentes: "Categoría",
  "Vaquillona preñada" traen descendentes).
- **RCM.9.2** — Fijar / volver a automático DEBEN funcionar **OFFLINE** (escritura local plana, sin red), con
  optimismo EN SITIO (sin blanquear la ficha ni resetear el scroll) + refresh silencioso, y REVERT del
  optimismo si la escritura local falla.
- **RCM.9.3** — Todo dato de tenant DEBE derivarse del PERFIL (`detail.establishmentId` / `detail.rodeoId`),
  NUNCA del establishment activo del contexto (el usuario puede estar viendo la ficha del campo A con el
  campo B activo). La RLS es la barrera real al subir.

---

# Familia RTF — Tacto reproductivo desde la ficha, animal por animal

## RTF.1 — Qué tacto ofrece la ficha (mismo criterio de gating que la maniobra)

- **RTF.1.1** — El sistema DEBE decidir qué tacto ofrecer con las **dos capas de gating que ya usa la
  maniobra**, en AND, sin criterio nuevo:
  1. **Capa rodeo** (`resolveManeuverGating` sobre el `rodeo_data_config` del `detail.rodeoId`, leído local con
     `fetchRodeoGating`): `tacto` requiere `prenez` **y** `tamano_prenez` enabled; `tacto_vaquillona` requiere
     `tacto_vaquillona` enabled.
  2. **Capa animal** (`appliesToAnimal` de `maneuver-applicability.ts`) con
     `{ sex, categoryCode, isCastrated, reproStatus }` tomados de `AnimalDetail`.
- **RTF.1.2** — El sistema DEBE ofrecer el tacto SOLO si además `detail.status === 'active'` (un animal
  archivado no recibe eventos nuevos, consistente con el resto de la ficha).
- **RTF.1.3** — El sistema NO DEBE reimplementar ni duplicar los predicados de aplicabilidad: los consume tal
  cual de `maneuver-applicability.ts` / `maneuver-gating.ts` (fuente única; si el criterio de la manga cambia,
  la ficha cambia con él).
- **RTF.1.4** — IF la capa rodeo no habilita el data_key correspondiente THEN el sistema NO DEBE ofrecer ese
  tacto (no se ofrece lo que el trigger `0054` rechazaría con 23514 al subir). Fail-safe conservador: si el
  `rodeo_data_config` no se resuelve localmente (sin config, sin rodeo, lectura fallida) → **no se ofrece**
  (mismo criterio que RCUT.7.3).

## RTF.2 — Exclusividad y fail-safe del ofrecimiento

- **RTF.2.1** — El sistema DEBE ofrecer **como mucho un** tacto por animal: los predicados de `tacto` (hembra
  servida: categoría PROBADA ∨ `reproStatus ∈ {served_untested, pregnant, empty}`) y `tacto_vaquillona`
  (hembra `vaquillona` con `reproStatus ∈ {unknown} ∨ fitness ≠ 'apta'`) son disjuntos por construcción.
- **RTF.2.2** — IF ambos predicados dieran verdadero (estado imposible por RTF.2.1; defensa en profundidad)
  THEN el sistema DEBE ofrecer el de **PREÑEZ** (precedencia determinística, nunca dos CTAs).
- **RTF.2.3** — WHEN ninguno aplica (macho, ternera, vaquillona ya apta sin servicio, CUT, animal archivado,
  rodeo sin el data_key) el sistema NO DEBE mostrar ninguna afordancia de tacto, y NO DEBE mostrar un mensaje
  de error ni un estado deshabilitado (simplemente no está).
- **RTF.2.4** — La resolución del ofrecimiento DEBE ser una función PURA y testeable que reciba
  `{ status, sex, categoryCode, isCastrated, reproStatus, rodeoConfig }` y devuelva `'prenez' | 'aptitud' |
  null`.

## RTF.3 — Afordancia en la ficha

- **RTF.3.1** — WHEN corresponde un tacto (RTF.1/RTF.2), la ficha DEBE mostrar un CTA en la sección **"Estado
  actual"**, debajo de las filas reproductivas (proximidad: la acción al lado del estado que modifica), con
  ícono `Stethoscope` y alto ≥ `$touchMin`.
- **RTF.3.2** — El copy del CTA DEBE ser **"Tacto de preñez"** para `prenez` y **"Tacto de aptitud"** para
  `aptitud` — nombrando el tacto que se va a hacer, no un genérico.
- **RTF.3.3** — WHEN el usuario toca el CTA, el sistema DEBE navegar a la pantalla de captura de tacto
  (RTF.4), pasando `profileId` y el tipo resuelto.

## RTF.4 — Pantalla de captura (reuso literal de los pasos de la manga)

- **RTF.4.1** — El sistema DEBE capturar el resultado con los MISMOS componentes que la manga:
  `TactoStep` (PREÑADA/VACÍA + sub-paso de tamaño) para `prenez` y `TactoVaquillonaStep`
  (APTA / NO APTA / DIFERIDA) para `aptitud`, sin rediseñarlos y sin cambiar su comportamiento para la manga.
- **RTF.4.2** — La pantalla DEBE mostrar la identidad del animal (identificador hero + categoría) para que el
  operario no dude sobre quién está tactando.
- **RTF.4.3** — Los buckets de tamaño del tacto de preñez DEBEN derivarse del rodeo del animal con la fuente
  única existente: `effectiveSizeBuckets(nMonths, undefined)` sobre
  `fetchRodeoServiceMonths(detail.rodeoId)`. `undefined` porque **sin jornada no hay override de "¿medir
  tamaño?"** → vale el default del rodeo. IF el rodeo no tiene `service_months` THEN los buckets son `[]` y
  PREÑADA persiste `'large'` directo (convención DD-PSC-2 ya vigente), sin sub-paso de tamaño.
- **RTF.4.4** — La pantalla DEBE re-validar el ofrecimiento al montar (mismos predicados, RTF.2.4). IF ya no
  aplica (dato cambiado entre el tap y el montaje, deep-link, cold-start) THEN DEBE mostrar un estado
  explicativo en es-AR y una salida, sin escribir nada.
- **RTF.4.5** — La pantalla DEBE tener un "Volver" robusto (`backOr` a la ficha del animal) que no deje al
  operario trabado si el stack está vacío (web-refresh / deep-link / cold-start).
- **RTF.4.6** — La pantalla DEBE suspender el listener global del bastón mientras está montada
  (`useBusyWhileMounted`, anti-stacking RB2.2): un bastonazo durante el tacto NO DEBE abrir el overlay
  find-or-create encima.
- **RTF.4.7** — El sistema DEBE evitar la doble escritura por doble-tap: un guard de re-entrancy tomado
  **antes** de cualquier `await`.

## RTF.5 — Escritura del evento (suelto, sin jornada, offline-first)

- **RTF.5.1** — WHEN el operario elige el resultado del tacto de preñez, el sistema DEBE persistirlo con el
  servicio YA existente `addTacto({ profileId, pregnancyStatus, eventDate })` — un INSERT local plano en
  `reproductive_events` (`event_type = 'tacto'`), **sin `session_id`**.
- **RTF.5.2** — WHEN el operario elige la aptitud, el sistema DEBE persistirla con el servicio YA existente
  `addTactoVaquillona({ profileId, fitness, eventDate })` — un INSERT local plano en `reproductive_events`
  (`event_type = 'tacto_vaquillona'`, `heifer_fitness`), **sin `session_id`**.
- **RTF.5.3** — El sistema NO DEBE crear, abrir ni cerrar ninguna `sessions` para un tacto desde la ficha
  (C2.3: suelto, sin jornada). `session_id` queda NULL, que es la columna nullable que estos dos servicios ya
  escriben hoy (el alta usa `addTactoVaquillona` desde 2026-06-29).
- **RTF.5.4** — El evento DEBE entrar por **el mismo camino server-side que el de la manga**: misma tabla,
  misma policy de INSERT (`with check has_role_in(establishment_of_profile(...))`), el mismo trigger de gating
  capa 2 `tg_reproductive_events_gating` (`0054`), y los mismos triggers de `created_by`/`establishment_id`
  (`0077`). El sistema NO DEBE agregar RPC, Edge Function, migración ni policy nueva.
- **RTF.5.5** — El write DEBE tener éxito **OFFLINE** al instante (fila en SQLite local → CrudEntry →
  `uploadData` al reconectar). El rechazo REAL al subir (RLS 42501, gating 23514) lo maneja `uploadData` y se
  superficia por el canal de status (R10.8) — NO por el return de la captura.
- **RTF.5.6** — IF el write local falla THEN el sistema NO DEBE navegar de vuelta: DEBE mostrar el error
  accionable es-AR en la misma pantalla y permitir reintentar.

## RTF.6 — Fecha del evento

- **RTF.6.1** — El sistema DEBE fechar el tacto **HOY** (fecha local del dispositivo) **por default**, sin
  campo de fecha a la vista: espeja la manga (el evento se carga en el momento en que se tacta) y el alta
  (`RAR.1.3` — el `tacto_vaquillona` del alta se fecha hoy), y mantiene la pantalla en "una decisión por
  pantalla, cero teclado" (manga: una mano, guante). El "hoy" sale de la FUENTE ÚNICA `todayIsoLocal()`
  (día calendario LOCAL): derivarlo en UTC fecharía MAÑANA toda la carga posterior a las 21:00.
- **RTF.6.2** — ~~El sistema NO DEBE permitir fechar un tacto en el pasado desde la ficha en este delta.~~
  **RECONCILIADO (Puerta 1, decisión de Raf sobre P3+P4, 2026-08-07)**: el sistema **DEBE ofrecer un link
  secundario "Fue otro día"** que despliegue un campo de fecha para cargar un tacto ATRASADO. Se resolvió
  junto con P4 y las dos van atadas: retirar la card "Tacto" de "Agregar evento" (RTF.9) SIN este link
  eliminaría una capacidad que hoy existe (fechar un tacto en el pasado). El campo:
  - está OCULTO por default (el 99% de los tactos se cargan en el momento; la manga no quiere teclado);
  - usa la MISMA validación que el resto de los eventos (`validateEventDate`: formato `AAAA-MM-DD` +
    **no futura**), con el error inline del `FormField`;
  - si el operario no lo despliega, el evento se fecha HOY (RTF.6.1) sin que tenga que tocar nada.

## RTF.7 — Efecto en la ficha al volver

- **RTF.7.1** — WHEN la captura termina con éxito, el sistema DEBE volver a la ficha, que DEBE reflejar el
  cambio **sin blanquear la pantalla ni resetear el scroll** (refresh silencioso — el `useFocusEffect` de la
  ficha ya lo hace en los re-focus).
- **RTF.7.2** — La ficha DEBE mostrar, al volver: el evento nuevo en el "Historial de eventos", y el estado
  reproductivo actualizado en "Estado actual" (fila "Estado reproductivo" para el tacto de preñez; fila
  "Aptitud reproductiva" para el de aptitud) — todo derivado de los espejos client-side ya existentes
  (`deriveCurrentState` / `deriveReproStatus` / `deriveReproAptitude`), **offline**.
- **RTF.7.3** — WHEN un tacto POSITIVO se registra sobre una hembra con `category_override = false`, el
  espejo C6 DEBE mostrar la transición de categoría al instante (`hasPositiveTactoVigente` →
  `vaquillona_prenada`), igual que hoy hace el tacto de la manga; el server la confirma al subir.
- **RTF.7.4** — WHEN el animal tiene `category_override = true` (categoría fijada, RCM), la categoría NO DEBE
  moverse por el tacto (ni en el espejo ni en el server): es la consecuencia declarada en RCM.4.2, y las dos
  funcionalidades de este delta DEBEN ser consistentes en eso.
- **RTF.7.5** — WHEN el CTA deja de aplicar por efecto del tacto recién cargado (p. ej. una vaquillona
  evaluada `apta` deja de necesitar aptitud), el CTA DEBE desaparecer solo en el refresh silencioso, sin
  intervención del usuario.

## RTF.8 — Visibilidad en reportes (contrato verificado, no supuesto)

- **RTF.8.1** — Un tacto de preñez cargado **sin `session_id`** DEBE ser computado por los reportes
  reproductivos exactamente igual que uno cargado en una jornada. **Hecho verificado** leyendo
  `0106_reports_rpcs.sql`: `rodeo_pregnancy_kpi`, `rodeo_calving_kpi`, `rodeo_ccl_distribution` y
  `rodeo_calving_by_stage` resuelven el tacto con
  `distinct on (t.animal_profile_id) … order by t.event_date desc, t.created_at desc` **sin ninguna
  referencia a `session_id`**.
- **RTF.8.2** — Un `tacto_vaquillona` cargado sin `session_id` DEBE ser computado por el **denominador**
  reproductivo igual que uno de jornada. **Hecho verificado** leyendo `0105_repro_denominator.sql`:
  `rodeo_serviced_females` toma el último `heifer_fitness` del animal (`order by rv.event_date desc,
  rv.created_at desc limit 1`) **sin referencia a `session_id`**; `'apta'` incluye a la vaquillona en
  servidas, `'no_apta'`/`'diferida'` la excluyen y además bloquean el fallback por edad.
- **RTF.8.3** — El sistema NO DEBE imputar el tacto a un período: **no hay imputación por período que
  definir**. El período (`p_year`) de un reporte selecciona el **denominador** (las servidas de esa campaña,
  por membresía ACTUAL del rodeo ∩ ventana `service_months`); el tacto entra por la regla "**último tacto
  vigente** del animal", que no tiene ventana temporal. Es decir: un tacto se imputa **por el animal** (su
  rodeo actual), no por su fecha ni por su jornada — y eso ya vale hoy para los tactos de la manga.
- **RTF.8.4** — El sistema NO DEBE mostrar un tacto sin jornada en el reporte "**Resumen de jornada**"
  (`session_event_summary` / `rodeo_sessions_list`, R7.3): por definición no pertenece a ninguna jornada. Este
  es el ÚNICO reporte donde no aparece, y es correcto — no es una pérdida a compensar.
- **RTF.8.5** — La compatibilidad de RTF.8.1/RTF.8.2 DEBE quedar **verificada por un test ejecutable** de la
  suite de reportes (`supabase/tests/reports/run.cjs`), no solo por lectura del SQL: sembrar un tacto y un
  `tacto_vaquillona` **sin `session_id`** y asertar que `rodeo_pregnancy_kpi` / `rodeo_serviced_females` los
  cuentan.

## RTF.9 — Retiro de la carga de tacto sin gatear de "Agregar evento"

- **RTF.9.1** — El sistema DEBE quitar la card **"Tacto"** del paso 1 de `agregar-evento.tsx` (con su
  `TactoForm`, su estado y su rama de submit): hoy ofrece el tacto de PREÑEZ a **cualquier** hembra
  (`isFemale`), sin capa rodeo y sin capa animal → contradice C2.2 y reintroduce por la ficha el mismo bug que
  la manga ya corrigió (tactar una ternera o una vaquillona nunca servida).
- **RTF.9.2** — El sistema NO DEBE tocar las otras cards reproductivas de `agregar-evento` (Servicio, Parto,
  Aborto) ni sus flujos.
- **RTF.9.3** — Tras RTF.9.1, la ÚNICA entrada a la carga de un tacto desde la ficha DEBE ser el CTA de RTF.3
  (una sola implementación, un solo criterio de gating).

## RTF.10 — Idioma, offline, multi-tenant y a11y

- **RTF.10.1** — Todos los textos visibles DEBEN estar en español argentino (voseo); cero hardcode de colores/
  íconos (tokens + `getTokenValue`); a11y por los helpers de `utils/a11y`; `lineHeight` matcheado (el bloque
  gigante "PREÑADA" trae `ñ`; "DIFERIDA" y "Tacto de aptitud" pasan por la misma regla).
- **RTF.10.2** — El flujo completo (ofrecer → capturar → persistir → volver → ver el estado nuevo) DEBE
  funcionar **OFFLINE**, sin excepción y sin degradar a un mensaje de "necesitás conexión".
- **RTF.10.3** — Todo dato de tenant DEBE derivarse del PERFIL (`detail.establishmentId` / `detail.rodeoId`),
  nunca del contexto activo. La RLS es la barrera real al subir.

---

## Preguntas abiertas para Raf — **CERRADAS en la Puerta 1 (2026-08-07)**

| | resolución | quién |
|---|---|---|
| **P1** | **Se filtra por `is_castrated`** (3 opciones, no 5). Como estaba escrito en RCM.2.3. | leader |
| **P2** | **Elegir la automática QUITA la fijación** (`override = false`). Como estaba escrito en RCM.5.2. | leader |
| **P3 + P4** | **Las dos juntas**: se retira la card "Tacto" de "Agregar evento" (RTF.9) **Y** el flujo nuevo suma el link secundario **"Fue otro día"** (RTF.6.2 reconciliado arriba). Retirar la card sin el link dejaría sin forma de cargar un tacto atrasado. | **Raf** |
| **P5** | **Sin mínimos etarios inventados**: el único piso es el corte de 365 d que el modelo ya asserta. Como estaba escrito en RCM.4.3. | leader |

El texto original de las cinco preguntas se conserva abajo como registro de la deliberación.

---

Estas cinco son decisiones que el `spec_author` tomó por default para poder cerrar la spec. Cada una tiene
una alternativa barata; ninguna bloquea la implementación, pero conviene confirmarlas en la Puerta 1.

- **P1 — Machos: 3 opciones, no 5.** El selector de categoría le ofrece a un macho solo las coherentes con su
  `is_castrated` (entero → ternero/torito/toro; castrado → ternero/novillito/novillo), en vez de las 5
  (RCM.2.3). Es el único lugar donde se recorta el "cualquier categoría del mismo sexo" de C1.1. *Motivo*:
  ofrecer "Novillo" a un animal marcado "Castrado: No" produce un estado que se contradice a sí mismo, y el
  eje castración ya tiene su propio control en la misma ficha (Manejo → Castrado), que además recalcula la
  categoría solo. *Alternativa*: ofrecer las 5 y acoplar el flip de `is_castrated` en el mismo UPDATE (1 línea
  en la función pura + 1 línea de copy en la confirmación).
- **P2 — Elegir la categoría automática = quitar la fijación.** Si el usuario elige justo la categoría que el
  sistema derivaría, se escribe `override = false` (RCM.5.2) en vez de fijarla igual. *Motivo*: preserva el
  invariante del alta (`categoryOverrideFor`) y evita congelar sin querer. *Alternativa*: fijar siempre
  (`override = true`), lo que habilitaría un "congelar la categoría actual" explícito.
- **P3 — El tacto desde la ficha se fecha HOY, sin campo de fecha (RTF.6).** Es una **pérdida de capacidad**
  respecto de hoy: el `TactoForm` de "Agregar evento" (que RTF.9 retira) permite fechar en el pasado.
  *Motivo*: manga sin teclado + evita que un tacto retro-fechado altere el KPI de una campaña ya cerrada (la
  regla "último tacto" no tiene ventana temporal, RTF.8.3). *Alternativa*: un link secundario "Fue otro día"
  que despliegue el campo de fecha.
- **P4 — Se retira la card "Tacto" de "Agregar evento" (RTF.9).** Entrada única = el CTA de la ficha.
  *Motivo*: una sola implementación con un solo criterio de gating. *Alternativa*: conservar la card haciendo
  que la ficha le pase el tipo ya resuelto por params y que la card navegue a la misma pantalla (dos entradas,
  un solo flujo).
- **P5 — Sin mínimos etarios inventados para multípara / 2º servicio / preñada (RCM.4.3).** El aviso de
  incoherencia usa como único piso el corte que el modelo ya asserta (365 d). Fijar "Multípara" en una hembra
  de 14 meses NO dispara aviso de edad. *Motivo*: no inventar biología; los mínimos reales son dominio de
  Facundo. *Alternativa*: pedirle a Facundo los pisos y sumarlos a la tabla de RCM.4.3.

---

## Trazabilidad — decisión del Gate 0 → requirement

| Decisión cerrada | Requirement(s) |
|---|---|
| C1.1 — cualquier categoría del mismo sexo | RCM.2.1, RCM.2.2, RCM.2.3 (con la salvedad P1) |
| C1.2 — incoherente con la edad: avisar, no bloquear | RCM.4.3, RCM.4.4, RCM.4.5, RCM.4.6 |
| C1.3 — cambiar el sexo fuera de alcance | (ninguna afordancia de sexo en este delta; RCM.9 no lo toca) |
| "de dónde sale la lista de categorías" | RCM.2.1, RCM.2.2, RCM.2.6 |
| "cómo convive con la derivación automática y con Quitar fijación" | RCM.5.1, RCM.5.2, RCM.7.3, RCM.7.4 |
| "qué pasa con el estado derivado al fijar" | RCM.8.1, RCM.8.2, RCM.8.3, RTF.7.4 |
| C2.1 — los dos tipos de tacto | RTF.1.1, RTF.4.1, RTF.5.1, RTF.5.2 |
| C2.2 — la ficha ofrece el que corresponda, mismo gating que la maniobra | RTF.1.1, RTF.1.3, RTF.2.1, RTF.2.4 |
| C2.3 — suelto, sin jornada | RTF.5.3, RTF.5.4 |
| C2.3 — pero visible en reportes | RTF.8.1, RTF.8.2, RTF.8.3, RTF.8.4, RTF.8.5 |
| "un tacto de la ficha, ¿entra por el mismo camino server-side?" | RTF.5.4 (**sí**, mismo trigger `0054`) → Gate 1 N/A |
| Offline-first (principio 3 de CLAUDE.md) | RCM.9.2, RTF.10.2 |

## Cobertura de tests (cada requirement cerrable)

**Unit (`node:test`, módulos puros)**
- `pickableCategories` — hembra 5 codes; macho entero 3; macho castrado 3; `cut`/`vaca_cabana` nunca; orden de
  catálogo preservado; catálogo vacío → `[]`. → RCM.2.2, RCM.2.3, RCM.2.4, RCM.2.5, RCM.2.6.
- `categoryAgeMismatch` — cada code dentro/fuera de su ventana; `birth_date` null → sin aviso; frontera exacta
  365/730 d; `today` inyectado. → RCM.4.3, RCM.4.4, RCM.4.5, RCM.4.7.
- `canPinCategory` — activo + no-CUT + con opciones → true; archivado / CUT / sin opciones → false. → RCM.7.1,
  RCM.7.2, RCM.1.3.
- `decideCategoryPin` (núcleo puro con fakes, patrón `cut-service-core.ts`) — elegida ≠ derivada → builder de
  fijación con el id de la elegida; elegida == derivada → builder de revert con el id de la derivada; code sin
  fila en el catálogo → error sin escribir; derivada irresoluble en el caso revert → error sin escribir. →
  RCM.5.1, RCM.5.2, RCM.6.1, RCM.6.2, RCM.6.3, RCM.6.6.
- `resolveFichaTactoOffer` — barrido de los 7 `ReproStatus` × categorías × sexo × `status` × config de rodeo:
  exactamente uno o ninguno; rodeo sin data_key → null; config irresoluble → null; archivado → null; macho →
  null; ternera → null; vaquillona apta sin servicio → null. → RTF.1.1, RTF.1.2, RTF.1.4, RTF.2.1, RTF.2.3,
  RTF.2.4.
- Test de **disyunción** de `appliesToAnimal('tacto')` vs `appliesToAnimal('tacto_vaquillona')` sobre el
  producto cartesiano de estados → nunca ambos true. → RTF.2.1, RTF.2.2.
- Builder `buildSetCategoryOverrideUpdate` — SQL exacto (`category_id`, `category_override = 1`, `WHERE id`),
  sin tocar otras columnas. → RCM.5.4.

**Backend (`supabase/tests/reports/run.cjs`, contra el remoto)**
- Sembrar `tacto` (pregnancy_status ≠ empty) **sin `session_id`** sobre una hembra del conjunto servidas →
  `rodeo_pregnancy_kpi(rodeo, año).pregnant` la cuenta. → RTF.8.1, RTF.8.5.
- Sembrar `tacto_vaquillona` `'apta'` **sin `session_id`** sobre una vaquillona sin veredicto →
  `rodeo_serviced_females` la incluye; con `'no_apta'` → la excluye. → RTF.8.2, RTF.8.5.
- El mismo tacto **no** aparece en `session_event_summary` de ninguna sesión del rodeo. → RTF.8.4.

**E2E (Playwright, web táctil real — `hasTouch: true` + `touchscreen.tap()`)**
- Categoría: ficha de una vaquillona → "Cambiar" → "Vaca multípara" → confirmación con la consecuencia →
  Confirmar → badge del hero = "Vaca multípara" + aparece la card "Categoría fijada manualmente"; después
  "Cambiar" → la categoría automática → la card desaparece. → RCM.1.2, RCM.3, RCM.4.1, RCM.4.2, RCM.5,
  RCM.7.4.
- Categoría incoherente: ternera de < 1 año → elegir "Vaca multípara" → aparece el aviso de edad → Confirmar
  igual (no bloquea). → RCM.4.4.
- CUT: ficha de una hembra CUT → la fila "Categoría" NO ofrece "Cambiar" y muestra el hint. → RCM.7.2.
- Tacto de aptitud: vaquillona sin veredicto (rodeo con `tacto_vaquillona` ON) → CTA "Tacto de aptitud" →
  APTA → vuelve a la ficha → "Aptitud reproductiva: Apta" + el evento en el historial + el CTA ya no está. →
  RTF.3, RTF.4.1, RTF.5.2, RTF.7.2, RTF.7.5.
- Tacto de preñez: hembra servida (rodeo con `prenez`+`tamano_prenez` ON) → CTA "Tacto de preñez" → PREÑADA →
  tamaño → "Estado reproductivo: Preñada (…)". → RTF.3, RTF.4.1, RTF.4.3, RTF.5.1, RTF.7.2.
- Sin CTA: ficha de un macho y de una ternera → no hay CTA de tacto. → RTF.2.3.
- No regresión: "Agregar evento" ya no ofrece "Tacto" y sigue ofreciendo Servicio / Parto / Aborto. → RTF.9.
- No regresión de la manga: la jornada con tacto y con aptitud sigue verde
  (`maniobra-carga.spec.ts`). → RTF.4.1.

**Gate 2.5 (capturas + veto visual, ADR-029)** — hay UI nueva, así que aplica: fila "Categoría" con
"Cambiar", sheet con las opciones, confirmación normal, confirmación con aviso de edad, fila CUT sin
"Cambiar", CTA "Tacto de preñez", CTA "Tacto de aptitud", `TactoStep` desde la ficha, `TactoVaquillonaStep`
desde la ficha, ficha post-tacto.

## Historial de refinamiento

- **2026-08-06** — Redacción inicial del delta desde el Gate 0 cerrado por Raf (C1.1–C1.3 / C2.1–C2.3, ver
  arriba). IDs nuevos `RCM.n` / `RTF.n`; no se tocan los IDs estables de spec 02 ni el `tasks.md` base. Se
  agregan 5 decisiones derivadas (P1–P5) marcadas explícitamente como "para confirmar en Puerta 1" en vez de
  presentarlas como cerradas.
- **2026-08-07** — **Puerta 1 aprobada**: P1/P2/P5 confirmadas tal cual; **P3+P4 resueltas por Raf** en
  conjunto → **RTF.6.2 cambia de sentido** (nota de reconciliación in-place, arriba: el link "Fue otro día"
  pasa a ser REQUERIDO).
- **2026-08-07 (implementación)** — Dos reconciliaciones al as-built, ninguna cambia el *qué* declarado:
  1. **RCM.2.4 gana una SEGUNDA cerradura, en el servicio.** El requirement prohibía OFRECER `cut` en el
     selector; el as-built además lo rechaza en `setCategoryManual` (`isPinnableCategoryCode`, puro y
     testeado) **sin escribir**. Motivo: `cut` acopla la columna `is_cut`, y un caller futuro del servicio
     que se salteara `pickableCategories` produciría `category_id = cut` con `is_cut = 0` — el estado
     inconsistente que RCUT.2.3 prohíbe. El guard se escribe sobre la AUSENCIA para que lo nuevo nazca
     protegido.
  2. **RCM.6.1 — la derivada se resuelve con el `is_castrated` REAL.** `resolveRevertCategory` (la
     resolución COMPARTIDA con "Quitar fijación") pasaba `isCastrated: false` hardcodeado, con la
     justificación —hoy falsa— de que ningún write-path lo seteaba (spec 10 R13.1 sí lo hace). Para el
     revert el daño era transitorio; para RCM.5.2 sería PERSISTENTE (elegir `Novillito` en un castrado no
     coincidiría con la derivada `torito` ⇒ se fijaría con `override = true`, justo lo que P2 evita). Se
     corrigió en la fuente compartida, así los dos caminos siguen sin divergir (RCM.6.1) y ahora los dos
     son correctos.
</content>
</invoke>
