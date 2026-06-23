# Spec 02 — Tier 2/3 backend: modelo de categorías de cría — Requirements (EARS)

**Status**: `spec_ready` (pendiente Gate 1 + Puerta 1). Delta backend sobre la spec 02 base; **no** reabre `requirements.md` base. Cierra el "PENDIENTE Tier 2/3" de la feature 2.
**Fecha**: 2026-06-04 (sesión 22).
**Autor**: spec_author.
**Fuente de verdad**: `specs/active/02-modelo-animal/context-tier2-categorias.md` (Gate 0 aprobado por Raf 2026-06-04). El **dominio** (máquina de estados, castración, cría al pie, aborto) viene **firme** de `docs/adr/ADR-008-automatic-category-transitions.md` (§ Enmienda 2026-06-03) y `specs/active/02-modelo-animal/dominio-categorias-facundo-2026-06-03.md`. Acá **no se re-decide** el dominio; se traduce a EARS/design/tasks.
**Related**: spec 02 base (`requirements.md` R7 transiciones, R8 dientes/CUT, R9 ternero al pie; `compute_category` as-built `0031`/`0045`, recálculo `0046`, seed categorías `0015`), spec 03 (gating capa 2 `0054`, no se toca), spec 10 (castración masiva — su D1 "efecto de categoría" se **cierra acá**; ver C1), ADR-008 (enmendado), ADR-021 (datos por categoría), ADR-019 (seguridad), ADR-012 (triggers > Edge Functions).

> **Notación EARS** (`docs/specs.md`): Ubicuo "El sistema deberá…", Evento "Cuando…, el sistema deberá…", Estado "Mientras…, el sistema deberá…", Opcional "Donde…, el sistema deberá…", No deseado "Si…, entonces el sistema deberá…". **IDs estables, no reordenar tras aprobar. Cada `R<n>` verificable por ≥1 test.**

> **Numeración**: este delta usa el prefijo **`RT2.x`** (Requirements Tier 2) para **no colisionar** con la numeración de la spec 02 base (`R1`..`R14`). Toda referencia `R<n>` sin prefijo apunta a la spec 02 base; `RT2.<n>` a este delta.

> **Madurez por capa**: todo este delta es **backend** (migraciones + `compute_category` + triggers + RLS/grants), firme contra el as-built de spec 02 Tier 1 (`done`, migrations 0043-0049). El **frontend** (picker de categoría con `novillito`/`novillo`, toggle castrado en la ficha, alineación del espejo cliente `computeInitialCategoryCode`) queda **fuera** de este chunk (ver RT2.20 como dependencia anotada, no como requirement de este delta).

---

## Resumen del delta

La spec 02 base modeló transiciones de categoría **parciales** (`0031`/`0045`/`0046`): solo `vaquillona → vaquillona_prenada` (tacto+), `vaquillona_prenada → vaca_segundo_servicio` (1er parto), `vaca_segundo_servicio → multipara` (2º parto), más el conteo de partos en `compute_category`. La enmienda de ADR-008 (2026-06-03, sesión con Facundo) completó la **máquina de estados de cría** con: categorías nuevas `novillito`/`novillo`, la **castración** (`is_castrated`) como eje torito↔novillito / toro↔novillo, el **destete** y el **servicio** como disparadores, los **cortes de edad** (1 y 2 años), el **aborto** que revierte la preñez, y la **cría al pie** como estado derivado de la madre.

Este delta materializa esa máquina completa en backend, manteniendo **consistencia trigger incremental ↔ `compute_category`** (la lección dura del as-built: si una regla vive solo en el trigger, editar/borrar el evento la revierte por edad vía el recálculo `0046`).

---

## RT2.1 — Categorías nuevas `novillito` / `novillo`

> ADR-008 enmendado, § "Categorías de cría — set completo": machos castrados. Firme.

**RT2.1.1** El sistema deberá sembrar en `categories_by_system`, para el sistema `(bovino, cría)`, dos categorías nuevas: `novillito` (macho castrado ≤ 2 años) y `novillo` (macho castrado > 2 años), con `active = true`, sin alterar ni desactivar las categorías ya sembradas por la spec 02 base (`0015`).

**RT2.1.2** El sistema deberá preservar la unicidad `(system_id, code)` de `categories_by_system` (`0015`): el seed de `novillito`/`novillo` deberá ser **idempotente** (no duplicar filas si la migración corre dos veces) y no deberá tocar el `code` ni el `active` de las categorías existentes (`ternero`, `ternera`, `vaquillona`, `vaquillona_prenada`, `vaca_segundo_servicio`, `multipara`, `cut`, `vaca_cabana`, `toro`, `torito`).

**RT2.1.3** El sistema deberá asignar a `novillito`/`novillo` un `sort_order` coherente con el orden de display de las categorías de macho (entre `torito`/`toro`), sin reordenar las existentes.

---

## RT2.2 — Atributo `is_castrated` y su efecto

> ADR-008 enmendado, § "Eje nuevo: castración": `is_castrated` es **atributo del animal**, no un evento. Firme. La **ubicación** (`animals` vs `animal_profiles`) la resuelve el design (DD-2). La **carga** del atributo (masiva = spec 10; individual = frontend posterior) **no** es de este chunk.

**RT2.2.1** El sistema deberá modelar un atributo booleano `is_castrated` sobre el animal, con default `false` y `NOT NULL`, que represente si el animal está castrado. (Ubicación de la columna: ver `design.md` DD-2; este delta solo define el atributo + su efecto en categoría.)

**RT2.2.2** El sistema deberá tratar `is_castrated` como el eje que separa, para machos: `torito` (entero) ↔ `novillito` (castrado) y `toro` (entero) ↔ `novillo` (castrado). `is_castrated` por sí solo **no** cambia la categoría de un `ternero` (la castración del ternero se hace antes del destete; el efecto se aplica recién al destetar — ver RT2.6).

**RT2.2.3** Cuando `is_castrated` cambia de `false` a `true` sobre un animal cuyo perfil activo está en categoría `torito` con `category_override = false`, el sistema deberá transicionar la categoría a `novillito` en la misma transacción.

**RT2.2.4** Cuando `is_castrated` cambia de `false` a `true` sobre un animal cuyo perfil activo está en categoría `toro` con `category_override = false`, el sistema deberá transicionar la categoría a `novillo` en la misma transacción.

**RT2.2.5** Mientras un perfil tenga `category_override = true`, el sistema **no** deberá cambiar su categoría por un cambio de `is_castrated` (el override manda, consistente con R4.9 base).

**RT2.2.6** El sistema **no** deberá revertir automáticamente la categoría si `is_castrated` cambia de `true` a `false` (des-castración no es un caso biológico real; la corrección de un error de carga es manual vía override). El cambio `true → false` se permite a nivel dato (corrección), pero **no** dispara transición automática `novillito → torito` / `novillo → toro`.

> ⚠ **SUPERSEDED por spec 10 v2 (2026-06-11, Gate 0 v2 D10 + R13)**: Raf decidió que el castrado es un
> estado EDITABLE y REVERSIBLE — el revert `true → false` ahora SÍ dispara recompute (transición
> automática de vuelta, p. ej. `novillito → torito`), implementado por el **recompute simétrico** del
> delta backend de spec 10 (reemplazo de `tg_animals_apply_castration`, migraciones ≥0084).
> **✅ EL DELTA YA SE APLICÓ (2026-06-11): migración `0086_castration_recompute_symmetric.sql`** (reviewer
> APPROVED + Gate 2 PASS). RT2.2.6 queda **HISTÓRICA/SUPERSEDED**: el revert `true → false` AHORA dispara
> el recompute simétrico (`novillito → torito`, `novillo → toro`), respetando `category_override` (RT2.2.5
> sigue vigente) y registrando en `animal_category_history` como `auto_transition`. Trazabilidad:
> `specs/active/10-operaciones-rodeo/design.md` §4.3 + `tasks.md` T-DB.3/T-DB.5 + `progress/impl_10-backend-delta.md`.

---

## RT2.3 — `compute_category` reescrita: rama macho completa

> ADR-008 enmendado, § "Máquina de estados — MACHOS": `ternero → torito/novillito` (destete o 1 año) → `toro/novillo` (2 años). Firme. El mecanismo de los cortes de edad lo resuelve el design (DD-1: on-read/on-recompute, sin cron).

**RT2.3.1** El sistema deberá reescribir `compute_category(profile_id)` de modo que, para un macho **sin** evento de destete cargado y **menor a 1 año** (por `birth_date` conocido), devuelva `ternero`.

**RT2.3.2** El sistema deberá hacer que `compute_category`, para un macho que **tiene un evento de destete** (`reproductive_events` con `event_type = 'weaning'`, no borrado) **o** que es **mayor o igual a 1 año** (por `birth_date` conocido), devuelva `torito` si `is_castrated = false` o `novillito` si `is_castrated = true`, **salvo** que aplique RT2.3.3.

**RT2.3.3** El sistema deberá hacer que `compute_category`, para un macho **mayor o igual a 2 años** (por `birth_date` conocido), devuelva `toro` si `is_castrated = false` o `novillo` si `is_castrated = true`.

**RT2.3.4** El sistema deberá hacer que `compute_category`, para un macho **sin `birth_date`** (`birth_date IS NULL`) y **sin** evento de destete, devuelva el default conservador por sexo de la spec 02 base (`torito` si entero, `novillito` si castrado) — consistente con R4.7.1 base ("animal sin fecha → adulto por sexo, override disponible"). El corte de 2 años **no** se aplica sin `birth_date` (no hay edad para evaluarlo).

**RT2.3.5** El sistema deberá hacer que `compute_category` use la edad (`birth_date`) **solo** para resolver el punto de la máquina de estados al momento del recálculo (on-recompute), **no** mediante lógica de reloj embebida en la función. La función misma no "despierta" sola; se la invoca on-event (RT2.8.1, primario) o desde el job de mantenimiento nocturno (RT2.8.4, red de seguridad). El mecanismo concreto por el cual los cortes de edad se materializan lo fija `design.md` (DD-1: dos caminos complementarios).

---

## RT2.4 — `compute_category` reescrita: rama hembra completa

> ADR-008 enmendado, § "Máquina de estados — HEMBRAS": `ternera → vaquillona` (destete o servicio o 1 año) → `vaquillona_prenada` (tacto+) → `vaca_segundo_servicio` (1er parto, desde cualquier categoría) → `multipara` (2º parto). Firme.

**RT2.4.1** El sistema deberá hacer que `compute_category`, para una hembra **con conteo de partos ≥ 2** (eventos `birth` distintos, no borrados), devuelva `multipara` — desde **cualquier** categoría previa. (Conserva el conteo de partos del as-built `0045`: cuenta eventos `birth`, nunca terneros / filas de `birth_calves`.)

**RT2.4.2** El sistema deberá hacer que `compute_category`, para una hembra con **conteo de partos = 1**, devuelva `vaca_segundo_servicio` — desde **cualquier** categoría previa (incluida `ternera`: una hembra que parió no puede seguir siendo ternera; ver ADR-008 enmendado, corrección 2026-06-04).

**RT2.4.3** El sistema deberá hacer que `compute_category`, para una hembra con **0 partos** y un **tacto positivo vigente** (`reproductive_events` con `event_type = 'tacto'`, `pregnancy_status ∉ {NULL, 'empty'}`, no borrado, **y no revertido por un aborto posterior** — ver RT2.7), devuelva `vaquillona_prenada`.

**RT2.4.4** El sistema deberá hacer que `compute_category`, para una hembra con **0 partos**, **sin** tacto positivo vigente, **y** con un disparador de "ya no es ternera" — **destete** (`event_type = 'weaning'`), ~~**o** **servicio** (`event_type = 'service'`)~~, **o** edad **≥ 1 año** (por `birth_date` conocido) — devuelva `vaquillona`. **[Servicio SUPERSEDED por RPS.4.1 — ver RT2.5]**: bajo Stream A (`0104`) el `service` ya **no** es disparador de `vaquillona`; los disparadores vigentes son **destete** y **edad ≥365d**.

**RT2.4.5** El sistema deberá hacer que `compute_category`, para una hembra con **0 partos**, **sin** tacto positivo, **sin** destete, **sin** servicio, y **menor a 1 año** (por `birth_date` conocido), devuelva `ternera`.

**RT2.4.6** El sistema deberá hacer que `compute_category`, para una hembra **sin `birth_date`** y sin ningún evento (alta directa sin eventos), devuelva el default conservador `vaquillona` — consistente con R4.7.1 base.

---

## RT2.5 — Transición por SERVICIO (hembra)

> ADR-008 enmendado: "servicio sobre una ternera → la promueve a vaquillona, sin importar la edad". Disparador nuevo respecto al as-built.

> ⚠ **SUPERSEDED por RPS.4.1 (Stream A, modelo de puesta en servicio, 2026-06-23)**: el evento `service`
> **ya no transiciona categoría**. Stream A reformuló la puesta en servicio a nivel rodeo y desacopló
> *categoría* de *elegibilidad reproductiva* (Gate 0 §2): la migración **`0104`** (aplicada al remoto)
> eliminó el backstop `service → vaquillona` de `compute_category` (sacó `v_has_service`). La promoción
> **ternera → vaquillona** queda **solo** por **destete** (RT2.6.2 / `has_weaning`) o **corte de edad ≥365d**
> (RT2.4.4 + cron nocturno `0066`). Un evento `service` (incl. IA `service+ai`) ya no promueve por su sola
> existencia; los `service` históricos siguen en el timeline pero `compute_category` no los lee. La IA sigue
> contando como *servida* en el **denominador reproductivo** (`rodeo_serviced_females`, `0105`), que es
> independiente de la categoría (RPS.4.8 / RPS.5.x). **Alcance del supersede**: solo **RT2.5.1** (la
> transición por servicio) queda histórica; **RT2.5.2** (servicio no retrocede/avanza una vaquillona+) y
> **RT2.5.3** (override manda) **siguen vigentes** — bajo el modelo nuevo se cumplen trivialmente (el service
> es inerte para la categoría). Trazabilidad: `requirements-puesta-en-servicio.md` RPS.4.1/RPS.4.5,
> `design-puesta-en-servicio.md` §2.1, migración `0104`, suite `supabase/tests/puesta-en-servicio/run.cjs`
> (TPS.8/TPS.9) + reconciliación de la suite animal (T2.23/T2.29) en `progress/impl_02-puesta-en-servicio.md`.

**RT2.5.1** ~~Cuando se inserta un `reproductive_events` con `event_type = 'service'` sobre un perfil activo en categoría `ternera` con `category_override = false`, el sistema deberá transicionar la categoría a `vaquillona` en la misma transacción.~~ **[SUPERSEDED por RPS.4.1 — ver nota arriba]** Bajo el modelo de Stream A, una `ternera` + `service` (sin destete ni edad ≥365d) **sigue `ternera`**; el `service` ya no es disparador de categoría.

**RT2.5.2** El sistema **no** deberá cambiar la categoría por un evento de servicio si el perfil ya está en una categoría posterior a `ternera` (`vaquillona` o superior): un servicio sobre una vaquillona/vaca no la retrocede ni la avanza (la preñez la decide el tacto, RT2.4.3). *(Vigente: bajo RPS.4.1 se cumple trivialmente — el service es inerte para la categoría.)*

**RT2.5.3** Mientras `category_override = true`, el sistema **no** deberá transicionar por servicio (override manda, R4.9 base). *(Vigente: el override siempre gana; con RPS.4.1 el service además ya no transiciona ni con override=false.)*

---

## RT2.6 — Transición por DESTETE (`weaning`)

> ADR-008 enmendado: el destete pasa a ser disparador. Machos: `ternero → torito/novillito` (lee `is_castrated`). Hembras: `ternera → vaquillona`. Disparador nuevo respecto al as-built.

**RT2.6.1** Cuando se inserta un `reproductive_events` con `event_type = 'weaning'` sobre un perfil activo de un **macho** en categoría `ternero` con `category_override = false`, el sistema deberá transicionar la categoría a `torito` si `is_castrated = false`, o a `novillito` si `is_castrated = true`, en la misma transacción.

**RT2.6.2** Cuando se inserta un `reproductive_events` con `event_type = 'weaning'` sobre un perfil activo de una **hembra** en categoría `ternera` con `category_override = false`, el sistema deberá transicionar la categoría a `vaquillona` en la misma transacción.

**RT2.6.3** El sistema **no** deberá retroceder ni alterar la categoría por un evento de destete si el perfil ya está en una categoría posterior al ternero/a (`torito`/`novillito`/`toro`/`novillo`/`vaquillona`/`vaca…`/`multipara`): el destete solo gradúa al ternero/a.

**RT2.6.4** Mientras `category_override = true`, el sistema **no** deberá transicionar por destete (R4.9 base).

> **Nota (cría al pie):** el destete del ternero también afecta el estado **cría al pie de la madre** — ver RT2.9. El destete actúa sobre dos perfiles distintos: el del ternero (categoría, RT2.6.1/6.2) y, derivadamente, el de la madre (cría al pie, RT2.9). En este modelo, el evento `weaning` se registra sobre el perfil del **ternero** (consistente con spec 10 §2, "destete masivo sobre el perfil del ternero").

---

## RT2.7 — Transición por PARTO (desde cualquier categoría) y reversión por ABORTO

> ADR-008 enmendado: parto → vaca/multípara por conteo desde **cualquier** categoría; aborto **revierte la preñez** + el tacto positivo previo a un aborto posterior deja de contar. Firme.

**RT2.7.1** Cuando se inserta un `reproductive_events` con `event_type = 'birth'` (parto) sobre un perfil activo de una hembra con `category_override = false`, el sistema deberá transicionar la categoría según el **conteo de partos** resultante: a `vaca_segundo_servicio` si el conteo pasa a 1, o a `multipara` si el conteo pasa a ≥ 2 — **desde cualquier categoría previa** (incluida `ternera`, `vaquillona`, `vaquillona_prenada`). (Extiende el trigger incremental as-built, que solo cubría `vaquillona_prenada → vaca_segundo_servicio` y `vaca_segundo_servicio → multipara`.)

**RT2.7.2** El conteo de partos de RT2.7.1 deberá contar **eventos `birth` distintos** (no borrados), **nunca** terneros ni filas de `birth_calves` (mellizos = un parto). Consistente con R7.9/R9.5 base y el as-built `0045`.

**RT2.7.3** Cuando se inserta un `reproductive_events` con `event_type = 'abortion'` (aborto) sobre un perfil activo en categoría `vaquillona_prenada` con `category_override = false`, el sistema deberá **revertir la preñez** transicionando la categoría a `vaquillona` en la misma transacción.

**RT2.7.4** Cuando se inserta un aborto sobre un perfil activo de una hembra que **ya tiene partos** (`vaca_segundo_servicio` o `multipara`), el sistema **no** deberá cambiar su categoría: sus partos ya están contados, el aborto no la retrocede.

**RT2.7.5** El sistema deberá hacer que `compute_category` (recálculo completo) **deje de contar como preñez** un `tacto` positivo cuando existe un evento de **aborto posterior** (por fecha) sobre el mismo perfil sin un nuevo tacto positivo intermedio: un tacto positivo seguido de aborto **no** debe dejar al animal en `vaquillona_prenada` tras el recálculo. (Consistencia trigger↔recompute: la reversión de RT2.7.3 debe sobrevivir a un recálculo posterior — ver RT2.10.)

**RT2.7.6** Mientras `category_override = true`, el sistema **no** deberá transicionar por parto ni por aborto (R4.9 base).

> **Flag "tuvo aborto"** (marquita roja en ficha/lista): es **derivado** de la existencia de un evento `abortion` (no es columna de estado). Su cálculo/visualización es de **frontend** (consume la cronología); **no** es requirement de backend de este chunk. Se anota para que el frontend lo derive del timeline.

---

## RT2.8 — Cortes de edad (1 año / 2 años): on-event primario + cron nocturno como red de seguridad

> ADR-008 enmendado usa cortes de edad. El mecanismo lo resuelve `design.md` DD-1: **dos caminos complementarios** — (1) on-event/on-recompute dentro de `compute_category` (PRIMARIO, sin cambios) y (2) un job `pg_cron` nocturno **targeted** que materializa los cruces de edad dentro de 24h sin depender de que alguien toque al animal. Aquí se fija el comportamiento observable; el mecanismo, en design.

**RT2.8.1** El sistema deberá materializar los cortes de edad (`ternero/ternera → siguiente` al año; `torito/novillito → toro/novillo` a los 2 años) **dentro de `compute_category`** (que ya usa `birth_date` y `current_date`), de modo que el corte se refleje **cada vez que se recalcula la categoría del perfil**: al insertar/editar/borrar cualquier evento del perfil (vía los triggers de transición y de recálculo as-built `0046`) o al invocar `compute_category` explícitamente (revert de override R4.10, herramientas de mantenimiento). Este es el camino **primario** (on-event).

**RT2.8.2** El sistema deberá mantener las categorías **frescas respecto de la edad dentro de una ventana de 24h** mediante un job `pg_cron` nocturno (RT2.8.4), de modo que un perfil que cruzó un umbral de edad (p. ej. un `ternero` de 13 meses sin destete cargado) pase a su categoría siguiente **dentro de 24h aunque ningún evento lo toque**. El camino on-event (RT2.8.1) sigue siendo el **primario** y produce la transición de inmediato cuando hay un evento; el cron es la **red de seguridad** que cierra el único caso que el on-event no cubre: el animal que cruza un umbral de edad y al que **nadie** carga/edita un evento. (Trade-off documentado en `design.md` DD-1: el "queda viejo indefinidamente" del diseño anterior pasa a "fresco dentro de 24h".)

**RT2.8.3** El sistema **no** deberá transicionar por edad sobre un perfil con `category_override = true` (ni en el camino on-event ni en el cron): el recálculo de `0046`/transiciones y el job nocturno respetan el override (R4.9 base).

**RT2.8.4** El sistema deberá proveer una función de mantenimiento de sistema (`design.md` DD-1: `refresh_age_categories()`, sin parámetros) que el job `pg_cron` nocturno invoca y que:
- (a) selecciona, mediante un **filtro indexado barato**, **solo** los perfiles cuya categoría guardada quedó **atrás de su edad** (candidatos age-stale), **no** todo el padrón: con `category_override = false`, `deleted_at is null`, y categoría guardada inferior a la que su edad determina (cría macho: `ternero/ternera` con edad ≥ 365 días, o `torito/novillito` con edad ≥ 730 días; las hembras **no** tienen corte de 2 años — `vaquillona → vaca` ocurre solo por parto, no por edad);
- (b) para cada candidato, recalcula vía `compute_category` y aplica la transición vía `apply_auto_transition` **solo si el target difiere** de la categoría actual, registrando el cambio en `animal_category_history` como `auto_transition` (igual que el resto de las transiciones automáticas, R6.14 / R10.3 base);
- (c) **no** recalcula los perfiles que no cruzaron un umbral de edad (en estado estable recalcula 0 o muy pocos perfiles por noche), respeta el override (RT2.8.3) y respeta los soft-deletes.
- (d) **Seguridad (crítica, ver RT2.12.6):** opera **cross-tenant por diseño** (es un job de sistema, no una acción de cliente), por lo que su `EXECUTE` deberá estar **revocado** de `public`/`authenticated`/`anon`; solo la invoca el scheduler (`pg_cron`). No recibe parámetros del cliente, no es RPC pública y no devuelve datos a ningún caller.

**RT2.8.5** El sistema deberá programar la función de mantenimiento como un job `pg_cron` **idempotente** (p. ej. diario a las 03:00), de modo que re-correr la migración del schedule **no** duplique el job (re-schedule reemplaza, no acumula). El job deberá quedar registrado en el catálogo de `cron` con un nombre estable (p. ej. `refresh_age_categories_nightly`).

---

## RT2.9 — Cría al pie (estado derivado de la madre)

> ADR-008 enmendado, § "Cría al pie": estado de la madre `con cría al pie` (post-parto) / `sin cría al pie` (post-destete de su ternero). La forma (columna vs derivado on-read) la resuelve el design (DD-3).

**RT2.9.1** El sistema deberá exponer, para un perfil de hembra, su estado **cría al pie** (`con` / `sin`), derivado de sus eventos: una hembra queda `con cría al pie` tras un parto (`birth`) y pasa a `sin cría al pie` cuando su(s) ternero(s) son destetados (`weaning` sobre el/los ternero(s) ligados a ese parto vía `birth_calves`, o sobre el perfil del ternero asociado). El mecanismo (columna mantenida por trigger en `animal_profiles` vs función/vista derivada on-read) lo fija `design.md` (DD-3).

**RT2.9.2** El sistema deberá garantizar que el estado de cría al pie es **ortogonal a la categoría**: cambiar cría al pie **no** modifica `category_id`, `rodeo_id` ni `management_group_id` (consistente con la ortogonalidad de los tres ejes, R7.7 base). Cría al pie es un atributo de estado de la madre, no una categoría de la máquina de estados.

**RT2.9.3** El sistema deberá derivar/mantener cría al pie de forma **consistente bajo edición/borrado** de los eventos de parto/destete subyacentes (mismo principio de consistencia que RT2.10): si se borra el parto, la madre deja de estar con cría al pie por ese parto; si se borra el destete, vuelve a estar con cría al pie.

---

## RT2.10 — Consistencia trigger incremental ↔ `compute_category` (recálculo)

> Lección dura del as-built (context §Edge cases): toda regla nueva va en **los dos** caminos. Si vive solo en el trigger incremental, editar/borrar el evento hace que `compute_category` (recálculo `0046`) revierta por edad.

**RT2.10.1** El sistema deberá garantizar que, para **toda** transición nueva de este delta (servicio→vaquillona RT2.5; destete→torito/novillito/vaquillona RT2.6; parto→vaca/multípara desde cualquier categoría RT2.7.1; aborto→vaquillona RT2.7.3; castración→novillito/novillo RT2.2.3/2.2.4; cortes de edad RT2.8), el **resultado de la transición incremental** (trigger `AFTER INSERT`/cambio de atributo) coincide con el resultado de **`compute_category` recomputado desde cero** sobre el mismo set de eventos y atributos, para `category_override = false`.

**RT2.10.2** Cuando se **edita o soft-deletea** un evento que disparó una transición nueva de este delta (p. ej. borrar el `service` que promovió a `vaquillona`, o el `birth` que llevó a `multipara`, o el `weaning`), el sistema deberá **recalcular** la categoría vía `compute_category` (reusando el trigger de recálculo as-built `0046`, extendido a los nuevos `event_type` si hace falta — ver `design.md`), de modo que la categoría refleje el set de eventos resultante. Si `category_override = true`, no recalcula (R4.9 base).

**RT2.10.3** El sistema deberá hacer que el trigger de recálculo (`0046`) cubra los `event_type` nuevos que participan de transiciones en este delta (`service`, `weaning`, `abortion`), además de los que ya cubría (`tacto`, `birth`, soft-delete). El recálculo deberá registrar el cambio resultante en `animal_category_history` como `auto_transition` (consistente con R6.14 / R10.3 base).

**RT2.10.4** El sistema deberá hacer que un cambio del atributo `is_castrated` (RT2.2.3/2.2.4) registre su transición resultante en `animal_category_history` como `auto_transition` (vía `apply_auto_transition`, igual que las demás transiciones automáticas), para que el cambio quede en la cronología (R10.3 base).

---

## RT2.11 — Override manual sigue ganando

**RT2.11.1** El sistema deberá respetar `category_override = true` en **todas** las transiciones nuevas de este delta (servicio, destete, parto, aborto, castración, edad): mientras el override esté activo, ninguna de ellas deberá modificar `category_id` (R4.9 base, mandato del context §Edge cases).

**RT2.11.2** El sistema deberá mantener el comportamiento de revert de override de la spec 02 base (R4.10): al pasar `category_override` de `true` a `false`, `compute_category` se reinvoca y, con las reglas nuevas de RT2.3/RT2.4, resuelve la categoría correcta del set completo de eventos + `is_castrated` actuales.

---

## RT2.12 — Seguridad, RLS y grants (ADR-019)

> El context §Edge cases y el Gate exigen: RLS/grants de columnas nuevas; `apply_auto_transition` sigue **revocada** (SEC-HIGH-01); las funciones de transición `SECURITY DEFINER` derivan tenant de la fila real.

**RT2.12.1** El sistema deberá exponer la columna nueva `is_castrated` (en la tabla que el design elija, DD-2) con `SELECT` y `UPDATE` para `authenticated`, gobernada por la **RLS existente** de esa tabla (`has_role_in` derivado del establishment del perfil/animal), **sin** abrir un camino de escritura cross-tenant. No deberá agregarse ninguna policy que permita leer/escribir `is_castrated` de un animal de otro establecimiento.

**RT2.12.2** El sistema deberá mantener `apply_auto_transition(profile_id, target_category_id)` con `EXECUTE` **revocado** de `public`/`authenticated`/`anon` (SEC-HIGH-01, migración `0042` as-built). Este delta **no** deberá reintroducir un grant de ejecución sobre `apply_auto_transition`; las transiciones nuevas la invocan **solo** desde triggers `SECURITY DEFINER` (que corren como owner del schema).

**RT2.12.3** El sistema deberá mantener `compute_category(profile_id)` como `SECURITY DEFINER STABLE` con `EXECUTE` para `authenticated` (as-built `0031`/`0045`); su reescritura **no** deberá agregar lectura ni escritura de datos de otro tenant (deriva todo del `profile_id` recibido vía sus joins a `animal_profiles`/`animals`/`rodeos`, igual que el as-built).

**RT2.12.4** El sistema deberá hacer que el/los trigger(s) nuevo(s) que reaccionan al cambio de `is_castrated` (y cualquier función `SECURITY DEFINER` nueva del delta) deriven el tenant/categoría de la **fila real** del perfil/animal afectado (no de un parámetro del cliente) y, si exponen una superficie invocable que no debe ser RPC pública, **revoquen** su `EXECUTE` de `public`/`authenticated`/`anon` (lección SEC-HIGH-01).

**RT2.12.5** El sistema **no** deberá permitir que un cambio de `is_castrated` ni ninguna transición de este delta toque `category_id` de un perfil de **otro** establecimiento que el del usuario que dispara el evento (las transiciones operan sobre el perfil del propio evento/atributo, scoped por la RLS de `reproductive_events`/`animals`/`animal_profiles` ya existente).

**RT2.12.6** El sistema deberá mantener la función de mantenimiento `refresh_age_categories()` (RT2.8.4) con `EXECUTE` **revocado** de `public`/`authenticated`/`anon`, de modo que **no** sea invocable como RPC de PostgREST por ningún cliente. La función opera **cross-tenant a propósito** (es un job de sistema de mantenimiento de categorías por edad, no una acción de cliente) y cambia `category_id` de perfiles de **cualquier** establecimiento; si fuera invocable por un cliente sería un IDOR catastrófico cross-tenant (clase SEC-HIGH-01, el mismo vector que `apply_auto_transition`). Por eso: (a) `EXECUTE` revocado de las tres roles cliente y sumada al smoke-check fail-closed (paridad con `0055`/M01); (b) **no** recibe parámetros del cliente (sin params); (c) cambia categoría **solo** vía el camino confiable `apply_auto_transition` (que ya está revocada, RT2.12.2) — no hace `UPDATE category_id` directo por fuera de él; (d) **no** devuelve datos a ningún caller (es un job de efecto, no de lectura). Solo la invoca el rol del scheduler `pg_cron`.

---

## RT2.13 — Migración de datos existentes (no tocar histórico)

> Context §Edge cases: "¿se recalculan los animales viejos o aplican solo a futuro? (probable: no tocar histórico)". Decidido en design (DD-4).

**RT2.13.1** La migración de este delta **no** deberá recalcular masivamente la categoría de los `animal_profiles` ya cargados: las reglas nuevas aplican **on-event** (próxima inserción/edición/borrado de evento) y **on-recompute** (revert de override, herramientas). El histórico no se toca en la migración. (Justificación en `design.md` DD-4: evita re-escrituras masivas no auditadas y respeta overrides manuales; un perfil viejo converge a la categoría correcta en su próximo evento o al abrir/recomputar.)

**RT2.13.2** El sistema deberá garantizar que ningún animal queda en un estado inconsistente por el seed de `novillito`/`novillo`: como las categorías nuevas solo se alcanzan vía castración + (destete o edad), ningún perfil existente cambia de categoría por el solo hecho de existir el seed.

---

## Cobertura del context.md (cada "Caso y decisión" → ≥1 `RT2.<n>`)

| context-tier2-categorias.md (Scope / Edge case) | Requirements |
|---|---|
| ENTRA 1 — Categorías nuevas `novillito`/`novillo` (seed) | RT2.1.1, RT2.1.2, RT2.1.3 |
| ENTRA 2 — `is_castrated` atributo + efecto | RT2.2.1–RT2.2.6 |
| ENTRA 3 — `compute_category` rama macho | RT2.3.1–RT2.3.5 |
| ENTRA 3 — `compute_category` rama hembra | RT2.4.1–RT2.4.6 |
| ENTRA 4 — disparador `weaning` (destete) | RT2.6.1–RT2.6.4 |
| ENTRA 4 — disparador `service` (servicio) | RT2.5.1–RT2.5.3 |
| ENTRA 4 — `birth` desde cualquier categoría | RT2.7.1, RT2.7.2 |
| ENTRA 4 — `abortion` revierte + flag derivado | RT2.7.3, RT2.7.4, RT2.7.5 |
| ENTRA 4 — castración (cambio `is_castrated`) | RT2.2.3, RT2.2.4 |
| ENTRA 5 — cría al pie | RT2.9.1, RT2.9.2, RT2.9.3 |
| ENTRA 6 — migraciones desde 0059 + tests + Gate 1 | (todo el delta; ver `tasks.md`) |
| Edge — consistencia trigger ↔ compute_category | RT2.10.1–RT2.10.4 |
| Edge — transiciones por EDAD (on-event primario + cron nocturno targeted) | RT2.8.1, RT2.8.2, RT2.8.3, RT2.8.4, RT2.8.5, RT2.3.5, RT2.12.6 |
| Edge — `is_castrated` ubicación | RT2.2.1 (decisión en `design.md` DD-2) |
| Edge — override manual sigue ganando | RT2.11.1, RT2.11.2, + cláusula override en RT2.2.5/2.5.3/2.6.4/2.7.6/2.8.3 |
| Edge — animal sin eventos (alta directa) | RT2.3.4, RT2.4.6 |
| Edge — migración de datos existentes | RT2.13.1, RT2.13.2 (decisión en `design.md` DD-4) |
| Edge — seed novillito/novillo + espejo cliente | RT2.1.x, RT2.20 (dependencia) |
| Edge — RLS/grants columnas nuevas; `apply_auto_transition` revocada | RT2.12.1–RT2.12.5 |

---

## Dependencias y tensiones para Gate 1 / Raf

> Documentadas acá porque tocan otras specs o cierran decisiones abiertas de otra feature. **No** las cierro por mi cuenta más allá del default propuesto; las marco para que Gate 1 y Raf las miren.

**C1 — Cierra la decisión abierta D1 de spec 10 ("efecto de categoría de la castración").** `specs/active/10-operaciones-rodeo/design.md` lista en su §9 (D1) el "efecto de categoría de la castración" como **NO implementado en MVP** (opciones sin elegir: novillo / solo sanitario / novillo→invernada), delegado a Facundo. El Gate 0 de **este** chunk (context-tier2, aprobado 2026-06-04) lo **cierra**: la castración (`is_castrated`) sí tiene efecto de categoría (`torito→novillito`, `toro→novillo`; ternero sin cambio hasta destete). **Tensión a mirar:** spec 10 modela la castración masiva como un `sanitary_events` (`event_type='treatment'`, `product_name='Castración'`) gateado por el `data_key='castracion'`; este delta modela el **efecto de categoría** sobre el **atributo `is_castrated`**, no sobre el evento sanitario. Eso significa que la **carga masiva de spec 10 debe, además de insertar el `sanitary_events`, setear `is_castrated = true`** en los animales para que la transición de categoría ocurra. Ese acople (spec 10 escribe `is_castrated`) **no** es de este chunk (acá solo va el atributo + su efecto), pero **debe quedar anotado** para que el implementer de spec 10 (o un chunk de reconciliación) lo cierre. **Default propuesto:** este chunk entrega `is_castrated` + su efecto; spec 10 (o frontend) es responsable de **escribir** `is_castrated` en su flujo de castración. Gate 1 / Raf: confirmar que el efecto de categoría va sobre el atributo y que spec 10 se alinea.

**C2 — `weaning` y `abortion` ya existen en el enum `repro_event_type` (`0026`), sin efecto de categoría hasta ahora.** Este delta les **da efecto** (RT2.6 destete, RT2.7.3 aborto). No se modifica el enum (ya los tiene). Solo se cubre que el cliente/spec 10 que ya emiten estos eventos (spec 10 §2: "destete masivo → `weaning`") empiecen a ver la transición. Sin tensión de schema; sí coordinación con quien ya emite esos eventos.

**C3 — Espejo cliente `computeInitialCategoryCode` (frontend) desalineado.** Ver RT2.20 abajo. No es requirement de backend; es dependencia de orden.

**RT2.20 (dependencia, NO requirement de este chunk) — alinear el espejo cliente.** `app/src/utils/animal-category.ts::computeInitialCategoryCode` replica la rama "sin eventos" de `compute_category` y hoy solo arroja `'ternero' | 'torito' | 'ternera' | 'vaquillona'`. Como este delta **no** cambia la rama sin-eventos (un animal recién creado no tiene destete ni partos; `is_castrated` no afecta al ternero ni se castra al alta en MVP), el espejo cliente **sigue siendo correcto** para el alta directa. **Pero** cuando el frontend agregue el picker de categoría con `novillito`/`novillo` o el alta de un macho castrado adulto, el espejo deberá alinearse (agregar `novillito`/`novillo` al type `InitialCategoryCode` y la rama de castración). Eso es **frontend posterior** — se anota acá como dependencia para que no se pierda; **no** se implementa en este chunk de backend.

---

## Historial de refinamiento

- **2026-06-04 (sesión 22) — Redacción inicial** desde `context-tier2-categorias.md` (Gate 0 aprobado por Raf 2026-06-04) + ADR-008 (§ Enmienda 2026-06-03) + dominio Facundo. Traducción a EARS del delta backend del modelo de categorías de cría. Numeración dedicada `RT2.x` para no colisionar con la spec 02 base. Se documentaron 3 dependencias/tensiones (C1: cierra D1 de spec 10 — efecto de categoría de la castración; C2: `weaning`/`abortion` ya existen sin efecto; C3/RT2.20: espejo cliente `computeInitialCategoryCode`). Decisiones de design (transiciones por edad sin cron, ubicación de `is_castrated`, cría al pie columna vs derivado, migración de datos existentes) resueltas en `design.md` (DD-1..DD-4). Pendiente Gate 1 (`security_analyzer` modo `spec`) por ser schema-sensitive (reescritura de `compute_category`/triggers `SECURITY DEFINER` + columna nueva + RLS/grants).

- **2026-06-04 (refinamiento) — DD-1 revisada: cron nocturno `pg_cron` (targeted) reemplaza el "queda viejo indefinidamente".** Raf **rechazó** el trade-off de RT2.8.2 original (cortes de edad solo on-event/on-recompute, aceptando que una categoría quede vieja hasta el próximo evento del animal) y eligió un job `pg_cron` nocturno (Supabase free lo soporta; cómputo trivial para un beta). **Cambios acotados, preservando IDs:** se **reescribió RT2.8.2** (de "no hay cron / queda viejo, aceptado MVP" → "fresco dentro de 24h vía cron nocturno; el on-event sigue siendo primario"); se ajustaron **RT2.8.1** (marcado explícito como camino primario) y **RT2.8.3** (override respetado también en el cron); se ajustó la redacción de **RT2.3.5** (la función no tiene lógica de reloj embebida; la invoca el on-event o el job nocturno). Se **agregaron RT2.8.4** (función de mantenimiento `refresh_age_categories()`: filtro indexado targeted que caza solo los age-stale, recompute vía `compute_category` + `apply_auto_transition`, history `auto_transition`, cross-tenant by-design + revocada) y **RT2.8.5** (schedule `pg_cron` idempotente). Se agregó la cláusula de seguridad **RT2.12.6** (`refresh_age_categories()` revocada de `public`/`authenticated`/`anon` + smoke-check fail-closed, paridad SEC-HIGH-01/M01; cross-tenant a propósito, sin params del cliente, cambia categoría solo vía el camino confiable `apply_auto_transition`, no devuelve datos). **Sin tocar** el resto del delta ya aprobado por Gate 1 (rama macho/hembra de `compute_category`, trigger incremental que delega, consistencia trigger↔recompute RT2.10, aborto-revierte-tacto RT2.7.5, DD-2/DD-3/DD-4, resto de RT2.x). Design: nuevo §0 DD-1 (dos caminos), A5 invertida (cron ELEGIDO), migración nueva `~0066` + SQL de diseño del cron + fila de seguridad en §4. Tasks: nueva tarea de migración del cron + test T8.n. Re-corre Gate 1 sobre el agregado del cron antes de Puerta 1.
