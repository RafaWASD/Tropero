# Spec 02 — C6: espejo client-side de categoría (offline) + visibilidad del override — Requirements (EARS)

**Status**: `in_progress` — **Puerta 1 APROBADA por Raf (2026-06-11)** con las 6 decisiones de criterio propio validadas (veto del leader PASS previo). Gate 1 N/A — chunk frontend puro, sin cambios de backend/schema/RLS/triggers. Nota de secuencia: RC6.2 (inferencia de `is_castrated`) es transitoria — cuando aterrice el delta backend de spec 10 v2 (denorm a `animal_profiles`), el wiring cambia a la columna real.
**Fecha**: 2026-06-10.
**Autor**: spec_author.
**Fuente de verdad**: `specs/active/02-modelo-animal/context-c6-categoria-espejo.md` (Gate 0 aprobado por Raf 2026-06-10). Decisiones D1 (espejo display-only) y D2 (badge + quitar fijación) vienen lockeadas; acá no se re-deciden.
**Related**: `requirements-tier2-categorias.md` (RT2.x — la máquina de estados que se espeja), migración `0062` (`compute_category`, la función fuente), `0063` (override manda, R4.9), `0040`+`0030` (revert respeta + history `revert_to_auto`), `0021` (category_check), spec 02 base R4.9/R4.10/R14.5, spec 15 (lecturas locales `local-reads.ts`, overlay `pending_*`), ADR-026 (b1: identidad denormalizada; `animals` fuera del sync set).

> **Notación EARS** (`docs/specs.md`). **Numeración `RC6.<n>`** para no colisionar con `R<n>` (spec 02 base) ni `RT2.<n>` (tier 2). IDs estables. Cada `RC6.<n>` verificable por ≥1 test.

---

## Resumen

Las transiciones de categoría corren server-side (triggers 0062/0063/0046): offline la categoría visible queda vieja, y con `category_override = true` la UI no comunica que la categoría está fijada a mano. Este chunk: (1) porta `compute_category` completa a TS puro y la usa **solo para la VISTA** (ficha + lista/búsqueda) cuando `category_override = false`; (2) hace visible el override en la ficha con un indicador + acción "quitar fijación". Cero cambios de backend; el server sigue siendo la única verdad.

---

## RC6.1 — Módulo puro: espejo completo de `compute_category`

**RC6.1.1** El sistema deberá extender el módulo puro `app/src/utils/animal-category.ts` con una función de cómputo de categoría que espeje la máquina de estados **completa** de `compute_category` (migración `0062`), con inputs explícitos y sin I/O (sin RN, sin red, sin SQLite): sexo, `birth_date` (ISO o null), `is_castrated` (boolean), y la lista de eventos reproductivos no borrados del perfil (`event_type`, `event_date`, `created_at`, `pregnancy_status`), más un `today` inyectable para tests deterministas.

**RC6.1.2** La función deberá replicar el orden de precedencia de ramas de `0062` (load-bearing): hembra — partos ≥ 2 → `multipara`; partos = 1 → `vaca_segundo_servicio`; tacto+ vigente → `vaquillona_prenada`; destete o servicio o edad ≥ 365 días → `vaquillona`; edad < 365 conocida → `ternera`; default (sin fecha, sin eventos) → `vaquillona`. Macho — edad ≥ 730 conocida → `toro`/`novillo` (según `is_castrated`); destete o edad ≥ 365 → `torito`/`novillito`; edad < 365 conocida → `ternero`; default sin fecha → `torito`/`novillito`. El conteo de partos cuenta eventos `birth` distintos no borrados, **nunca** terneros/`birth_calves` (RT2.7.2).

**RC6.1.3** La función deberá replicar la regla de **tacto+ vigente** de `0062`/RT2.7.5: existe un evento `tacto` con `pregnancy_status ∉ {null, 'empty'}` no borrado **sin** un evento `abortion` no borrado posterior, comparando por la tupla `(event_date, created_at)` (desempate por `created_at` cuando el `event_date` empata).

**RC6.1.4** Si un evento local carece de `created_at` (los INSERT locales de tacto/servicio/aborto no lo setean — lo pone el trigger al subir), entonces el sistema deberá tratarlo como **más reciente** que cualquier `created_at` presente a igualdad de `event_date` (la fila sin `created_at` se acaba de crear en este dispositivo), preservando el orden de inserción entre dos eventos sin `created_at`.

> **Reconciliación as-built (2026-06-11).** "Preservar el orden de inserción entre dos eventos sin `created_at`" se concretó como un **desempate por el ÍNDICE en el array** ordenado de la query (`ORDER BY event_date, created_at` → con ambos null, el orden es el de inserción/rowid local): el evento de índice MAYOR es el posterior. La redacción original ("preservando el orden") admitía leerse como "ninguno desempata al otro"; el e2e de aborto offline (tacto + aborto el MISMO día, ambos `created_at` null) probó que ESO dejaba un tacto+ sin revertir → badge "Vaquillona preñada" erróneo. El desempate por índice hace que el aborto (insertado después) revierta, convergiendo con lo que el server computará al sellar los `created_at` al subir. Sin cambio de contrato (sigue siendo "el posterior gana"); solo se precisó cómo se ordena el empate doble-null.

**RC6.1.5** El sistema deberá hacer que `computeInitialCategoryCode` y `categoryOverrideFor` (espejo parcial existente, RT2.20 + refinamiento B) **deleguen** en la función nueva (caso "sin eventos" / "tacto+ sintético" para `pregnant`), sin crear una tercera copia de la lógica y **preservando sus firmas públicas y sus tests existentes**.

**RC6.1.6** El sistema deberá cubrir el módulo con una suite de **fixtures espejo** que replique, caso por caso, la matriz RT2.x ya verificada server-side en `supabase/tests/animal/run.cjs` (T2.21 rama macho, T2.22 rama hembra, T2.23 servicio, T2.24 destete incl. castrado, T2.25 partos/mellizos, T2.26 aborto revierte, T2.29 RT2.7.5 aborto/tacto por fecha, T2.30 revert recalcula con `is_castrated`) — misma tabla de casos, dos implementaciones (mitigación de drift #1 del Gate 0). Quedan fuera los casos no aplicables al cliente (T2.20 seed, T2.27 trigger de castración, T2.28 nursing, T2.31–T2.33 seguridad/migración/cron).

## RC6.2 — Input `is_castrated` no disponible localmente (inferencia)

> `animals` está **fuera del sync set** (ADR-026 b1; la tabla declarada en AppSchema no la alimenta ninguna stream) y `0079` no denormalizó `is_castrated` sobre `animal_profiles`. Hoy **ningún** camino de escritura de la app setea `is_castrated = true` (el toggle es de spec 10; el import 0074 no lo setea). Resolución frontend-pura abajo; el fix real (denormalizar `is_castrated`) es backend y queda como finding para el leader (ver design §7).

**RC6.2.1** Donde el cableado deba proveer el input `is_castrated` al espejo, el sistema deberá **inferirlo** de la categoría guardada del perfil: `true` si el `code` guardado ∈ {`novillito`, `novillo`} (solo la castración produce esos codes en un cómputo del server), `false` en cualquier otro caso.

**RC6.2.2** El sistema deberá documentar en el header del módulo TS la limitación de la inferencia: un ternero castrado server-side (caso hoy imposible vía app) cuyo destete se carga offline mostraría `torito` en vez de `novillito` hasta el próximo sync — display-only, converge al sincronizar.

## RC6.3 — Aplicación display-only en ficha y lista/búsqueda

**RC6.3.1** Mientras un perfil tenga `category_override = false`, la ficha del animal deberá mostrar como categoría (CategoryBadge del hero) la **derivada localmente** por el espejo a partir de los datos del SQLite local — incluyendo los eventos cargados offline aún no subidos (filas locales de `reproductive_events` + partos optimistas de `pending_reproductive_events`).

**RC6.3.2** Mientras un perfil tenga `category_override = false`, la lista de animales y los resultados de búsqueda (mismas filas `AnimalRow`) deberán mostrar la categoría derivada localmente por el espejo, con el mismo mecanismo que la ficha.

**RC6.3.3** Mientras un perfil tenga `category_override = true`, el sistema deberá mostrar la categoría **guardada tal cual** (el espejo no aplica — mismo comportamiento que el server, R4.9).

**RC6.3.4** Si el espejo no puede resolver la categoría derivada (input faltante, `code` derivado sin fila activa en el catálogo local `categories_by_system` del sistema del rodeo), entonces el sistema deberá caer a mostrar la categoría guardada (fail-safe: nunca blanco, nunca crash).

**RC6.3.5** El sistema **no deberá** escribir nada por efecto del espejo de display: ni `category_id`, ni overlay `pending_*`, ni reconciliación alguna (D1 — el server es la única verdad; la única escritura del chunk es el revert RC6.4.3).

**RC6.3.6** El sistema deberá derivar la categoría del espejo **sin red**: todos los inputs se leen del SQLite local (identidad denormalizada b1 en `animal_profiles`, `system_id` vía `rodeos`, eventos en las tablas locales sincronizadas + overlay).

## RC6.4 — Visibilidad del override + quitar fijación (D2)

**RC6.4.1** Mientras un perfil tenga `category_override = true`, la ficha deberá mostrar un indicador explícito de que la categoría está **fijada manualmente** (más visible que el punto sutil actual del CategoryBadge; copy es-AR del tipo "Categoría fijada manualmente").

**RC6.4.2** Donde el animal esté activo (`status = 'active'`) y el override esté activo, la ficha deberá ofrecer una acción para **quitar la fijación** (con confirmación), disponible para cualquier usuario con rol activo en el campo del animal (R4.10 base; la RLS `animal_profiles_update` es la barrera real, mismo patrón de gating que el control de Lote). Para un animal archivado la acción no se ofrece.

**RC6.4.3** Cuando el usuario confirme quitar la fijación, el sistema deberá ejecutar **un único UPDATE local** sobre `animal_profiles` que setee `category_override = false` **y** `category_id = <categoría derivada por el espejo>` en el mismo statement (resuelta a id por `(system_id, code)` en el catálogo local). PowerSync lo sube como un solo UPDATE → el trigger `0040` respeta el revert (no re-marca override) y `0030` registra `revert_to_auto` — patrón as-built de T2.5/T2.30, donde el cliente aporta el valor recalculado.

**RC6.4.4** El sistema deberá permitir quitar la fijación **offline**: el UPDATE local tiene éxito al instante (CRUD plano offline-safe, R6.1/R6.3 de spec 15), la ficha refleja `category_override = false` + la categoría derivada de inmediato, y la autorización real se valida al subir (RLS).

**RC6.4.5** Si la categoría derivada no es resoluble localmente (RC6.3.4), entonces el sistema deberá **no ejecutar** el revert y mostrar un error es-AR accionable (no escribir un `category_id` inválido; `0021` lo rechazaría al subir con 23514).

**RC6.4.6** (agregado 2026-06-11, fix-loop del veto de diseño del leader — Nielsen #1 visibilidad / #5 prevención de error). Cuando el usuario abra la confirmación de "quitar fijación", el sistema deberá **anticipar la consecuencia**: mostrar el **nombre legible** (del catálogo local, no el `code`) de la categoría AUTOMÁTICA a la que volvería el animal, con copy es-AR del tipo "La categoría pasará a {name}.". El nombre anticipado deberá resolverse con la **misma** lógica que el revert ejecuta (para que lo mostrado coincida con el resultado real). Si la derivada **no es resoluble** localmente (RC6.3.4/RC6.4.5), el sistema **no deberá** mostrar la línea de consecuencia (omitirla; el flujo de error de RC6.4.5 gobierna si el usuario confirma igual). La anticipación es de **solo lectura** — no escribe nada (consistente con RC6.3.5) y funciona **offline** (RC6.4.4).

## RC6.5 — Anti-drift (mantenimiento)

**RC6.5.1** El sistema deberá incluir en el header de `app/src/utils/animal-category.ts` la nota de mantenimiento: **"cualquier migración que toque `compute_category` actualiza este espejo + sus fixtures"**, referenciando `0062` como fuente espejada.

**RC6.5.2** El sistema deberá agregar la misma regla de mantenimiento en `design-tier2-categorias.md` (donde vive el design de `compute_category`), apuntando al módulo espejo y su suite (mitigación de drift #2 del Gate 0; nota aditiva, no reescribe la spec aprobada).

---

## Historial de refinamiento

- 2026-06-10 — redacción inicial (Gate 0 aprobado 2026-06-10).
