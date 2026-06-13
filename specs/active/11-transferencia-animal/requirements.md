# Spec 11 — Transferencia de animal entre campos (re-parenting de historia) — Requirements (EARS)

**Status**: `spec_ready` (redactada 2026-06-12, sesión 23). Pendiente Gate 1 (security_analyzer modo `spec`) + Puerta 1 humana (Raf).
**Fuente de verdad**: `specs/active/11-transferencia-animal/context.md` (Gate 0, aprobado por Raf 2026-05-29). Las decisiones lockeadas no se re-deciden acá; se traducen a EARS.
**⚠️ Gate 1 OBLIGATORIO**: write cross-tenant + re-parenting masivo. Toca RLS, RPC `SECURITY DEFINER`, aislamiento de tenant del wire de sync.
**Related**: spec 02 (R4.11/R4.13/R4.14/R4.15, las 5 tablas de evento + `animal_events` + `animal_category_history` + `birth_calves` + RLS), spec 09 (D2 find-or-create, punto de entrada), spec 01 (roles multi-campo, R9.2 online), spec 03 (`sessions`), spec 08 (marcador SIGSA), spec 10 (`future_bull` 0085, denorm `is_castrated` 0084), spec 15/ADR-026 (denormalización `establishment_id` PowerSync).

> Convención de IDs: `R<n>` estable, no reordenar tras aprobar (`docs/specs.md`). Cada `R<n>` es verificable por ≥1 test. Trazabilidad `R<n> → test` se documenta en `progress/impl_11-transferencia-animal.md` al implementar.

---

## Reconciliación con as-built post-Gate-0 (divergencia context.md vs as-built — RECONCILIADA)

El `context.md` se escribió el **2026-05-29**, **antes** del trabajo de PowerSync (ADR-026, migraciones `0077`/`0078`/`0079`, junio 2026) y de la spec 10 (`0084` denorm `is_castrated` / `0085` `future_bull`). Tres divergencias entre lo que dice el context.md y el as-built, resueltas en el design y reflejadas acá. **No re-decido el Gate 0; agrego lo que el as-built obliga.**

**RECON-1 — `establishment_id` denormalizado en TODAS las tablas hijas (no solo `animal_events`).**
El context.md (§"Qué se re-apunta") solo menciona actualizar el `establishment_id` denormalizado de `animal_events`. Pero `0077`/`0078` agregaron `establishment_id` denormalizado, forzado por trigger desde el perfil y **load-bearing para el aislamiento de tenant del wire de sync de PowerSync** (las streams filtran `establishment_id IN org_scope`, sin JOINs — ADR-026), a: las **5 tablas de evento tipadas** (`weight_events`, `reproductive_events`, `sanitary_events`, `condition_score_events`, `lab_samples`), **`animal_category_history`** y **`birth_calves`**. Si el re-parenting re-apunta el `animal_profile_id` pero deja el `establishment_id` denormalizado viejo (el de X), esas filas **quedan visibles en el sync set de X = fuga de aislamiento cross-tenant** (Gate 1 lo marcaría). → El re-parenting **debe** actualizar `establishment_id → el de Y` en TODAS las filas hijas re-apuntadas. Capturado en **R3.6**.

**RECON-2 — Identidad denormalizada en `animal_profiles` (0079) se hereda sola.**
`0079` denormalizó `animal_tag_electronic`/`animal_sex`/`animal_birth_date` sobre `animal_profiles`, forzadas por `tg_force_animal_identity_on_profile` (BEFORE INSERT OR UPDATE) desde `animals WHERE id = animal_id`, ignorando el payload (anti-spoof). Como el perfil nuevo en Y se crea por INSERT reusando el **mismo `animal_id` global**, el trigger fuerza la identidad correcta automáticamente. → El RPC **no debe** setear estas columnas (las pisaría el trigger igual); quedan consistentes con la identidad global por construcción. Capturado en **R2.6**.

**RECON-3 — `is_castrated` (global) se preserva solo; `future_bull` (profile-level) arranca en `false`.**
`is_castrated` vive en `animals` (global, `0060`) y está denormalizado sobre `animal_profiles` (`0084`); el `tg_force_is_castrated_on_profile_insert` lo copia desde `animals` al INSERT del perfil nuevo → se **preserva solo** (es estado global del animal). `future_bull` vive en `animal_profiles` (`0085`, profile-level) y su comentario de migración dice explícito *"No viaja entre campos (un perfil nuevo en otro campo arranca false por default)"* → el perfil nuevo en Y arranca `future_bull = false`. **Decisión menor del leader para Raf (TODO-D1)**: confirmar que `future_bull` NO se hereda (default propuesto: no se hereda, alineado a `0085`). Capturado en **R2.7** / **R2.8**.

---

## User stories

- **US1** — Como usuario parado en mi campo Y, cuando bastoneo/busco un TAG de un animal activo en otro campo X donde también tengo rol, quiero traerlo a Y **con su historia**, para no perder el historial (analytics) y respetar "un animal = un campo".
- **US2** — Como sistema, quiero que la transferencia sea **atómica** y deje el aislamiento de tenant intacto, para no corromper datos ni filtrar información cross-campo.
- **US3** — Como dueño de los datos del campo X, quiero que **nadie sin rol activo en X** pueda mover/archivar mis animales ni leer/escribir su historia.

---

## R1 — Punto de entrada y elegibilidad (TENTATIVAS-UI — dependen del find-or-create de spec 09, deferred)

> **Disclaimer de madurez (estilo R14 de spec 02 / R1-R8 de spec 09)**: R1.x describen el punto de entrada **en la UI del find-or-create de spec 09 (D2)**, que está `deferred` (su frontend no está construido). Quedan **TENTATIVAS** hasta que se implemente esa pantalla. Lo **definitivo** (firme, testeable hoy a nivel backend) es R2–R7 (el RPC y sus invariantes). Al implementar el frontend de spec 09 se reconcilian R1.x con el estado real de esas pantallas.

- **R1.1** — Cuando el find-or-create (spec 09 D2) resuelve un TAG/ID que corresponde a un animal **con perfil activo en otro establecimiento X donde el usuario tiene rol activo**, el sistema deberá ofrecer la acción **"Transferir a este campo"** en vez del error de "ya existe en otro campo".
- **R1.2** — Cuando el animal tiene perfil activo en otro establecimiento X donde el usuario **NO** tiene rol activo, el sistema **no deberá** ofrecer la transferencia y deberá caer en el camino de "informar / unique-violation global" (spec 09 R4.8 / R5.6).
- **R1.3** — Cuando el usuario elige "Transferir a este campo", el sistema deberá mostrar una **confirmación con preview** que indique el campo de origen X y que se traerá el animal **con su historia** (copy: *"Vas a traer este animal con su historia desde el campo «X». El animal dejará de estar activo en «X»."*).
- **R1.4** — Mientras no haya conexión a internet, el sistema **no deberá** permitir iniciar la transferencia y deberá informar que requiere conexión (consistente con R7.1 / spec 01 R9.2). La transferencia **no se encola offline**.
- **R1.5** — Cuando el rodeo destino en Y no esté determinado (Y tiene ≥2 rodeos activos del mismo sistema que el de origen), el sistema deberá pedir al usuario que elija el rodeo destino con default `lastRodeoSelected` (misma lógica que CREATE de spec 09 R4.4); si Y tiene exactamente 1 rodeo activo del mismo sistema, deberá fijarlo sin preguntar.
- **R1.6** — Si Y **no tiene ningún rodeo activo del mismo sistema** que el rodeo de origen en X, entonces el sistema **no deberá** permitir la transferencia y deberá informar el motivo (evita el dead-end de categoría cross-sistema, consistente con R4.5.1 de spec 02).

---

## R2 — Creación del perfil nuevo en el campo destino Y (DEFINITIVAS)

- **R2.1** — Cuando se ejecuta la transferencia, el sistema deberá crear **un** `animal_profile` nuevo en el establecimiento Y que **reusa el mismo `animal_id` global** del animal transferido.
- **R2.2** — El sistema deberá asignar al perfil nuevo el `rodeo_id` destino elegido (R1.5), que **no deberá** ser de un sistema productivo distinto al del rodeo de origen.
- **R2.3** — El sistema deberá asignar al perfil nuevo `management_group_id = NULL` (el animal llega a Y **sin lote**; el productor de Y lo asigna después si quiere). [Decisión Raf, Gate 0.]
- **R2.4** — El sistema deberá **intentar conservar el `idv`** del perfil viejo en el perfil nuevo. Si ese `idv` **colisiona** con un `idv` existente en Y (unique `(establishment_id, idv)` de spec 02 R4.3), entonces el sistema deberá crear el perfil nuevo con `idv = NULL` y la transferencia **deberá** completarse igual (no aborta). [Decisión Raf, Gate 0.]
- **R2.5** — Cuando el `idv` se dejó en `NULL` por colisión (R2.4), el sistema deberá señalarlo en el resultado de la transferencia para que el cliente avise al operario que complete el `idv` (R4.13.a de spec 02 permite `NULL → valor` después).
- **R2.6** — El sistema deberá garantizar que la identidad del perfil nuevo (`animal_tag_electronic`/`animal_sex`/`animal_birth_date`, denormalizadas por `0079`) sea **consistente con la identidad global de `animals`** (el TAG electrónico se preserva siempre). [RECON-2: lo fuerza el trigger `0079`; el RPC no las setea.]
- **R2.7** — El sistema deberá preservar el estado `is_castrated` del animal en el perfil nuevo (es estado **global** del animal, vive en `animals`; el trigger `0084` lo copia al INSERT del perfil). [RECON-3.]
- **R2.8** — El sistema deberá crear el perfil nuevo con `future_bull = false` (el flag "futuro torito" es **profile-level** y **no viaja entre campos**, `0085`). [RECON-3; TODO-D1 para Raf.]
- **R2.9** — El sistema deberá fijar el `category_id` del perfil nuevo recomputando la categoría con el **system del rodeo destino** (mismo criterio que el alta CREATE de spec 09: la categoría se resuelve para el sistema destino), preservando los hechos biológicos del animal (partos, servicios, castración) que viven en su historia re-apuntada. **Decisión menor para Raf (TODO-D2)**: si el recompute no es trivial al momento de crear el perfil, arrancar con la **misma `category_id`** que tenía en X (válida porque el sistema es el mismo, R1.6/R2.2) y dejar que el recompute on-event/cron la ajuste; `category_override` arranca en `false`.
- **R2.10** — El sistema deberá setear `created_by` del perfil nuevo al usuario que ejecuta la transferencia (forzado server-side por el trigger `0043`, no spoofeable).
- **R2.11** — El perfil nuevo deberá quedar con `status = 'active'` y `deleted_at = NULL`.
- **R2.12** — El sistema deberá tratar los campos descriptivos del perfil viejo en **dos clases** al crear el perfil nuevo en Y:
  - **(a) campos del animal** (`visual_id_alt`, `breed`, `coat_color`) **deberán viajar** al perfil nuevo — describen al animal, no la relación con el campo. (`visual_id_alt` está sujeto a la misma resolución de colisión que `idv` en R2.4 si el dominio tuviera unicidad por establecimiento; hoy no la tiene → viaja tal cual.)
  - **(b) campos de la relación con el establecimiento** (`entry_origin`, `entry_date`, `entry_weight`, `notes`) **no deberán** copiarse de X: la "entrada" del animal a Y es la transferencia misma → `entry_date` = fecha de la transferencia, `entry_origin` = marcador de transferencia si el dominio lo soporta (o `NULL`), `entry_weight` = `NULL`, `notes` = `NULL`.

  [**Gap del `context.md` detectado por el leader en el review pre-Gate-1**: el Gate 0 solo trató `idv`/`lote`; estos 7 campos quedaban silenciosamente dropeados. Defaults propuestos arriba — decisión final de Raf en **TODO-D6**.]

---

## R3 — Re-parenting de la historia (DEFINITIVAS)

- **R3.1** — Cuando se ejecuta la transferencia, el sistema deberá re-apuntar **todas** las filas de las **5 tablas de evento tipadas** (`weight_events`, `reproductive_events`, `sanitary_events`, `condition_score_events`, `lab_samples`) del perfil viejo (X) al perfil nuevo (Y), seteando su `animal_profile_id` al del perfil nuevo.
- **R3.2** — El sistema deberá re-apuntar **todas** las filas de `animal_events` (observaciones / `'observacion' | 'otro'`) del perfil viejo al perfil nuevo (`animal_profile_id` al del nuevo).
- **R3.3** — El sistema deberá re-apuntar **todas** las filas de `animal_category_history` del perfil viejo al perfil nuevo.
- **R3.4** — El sistema deberá re-apuntar los **vínculos reproductivos**: toda fila de `reproductive_events` cuyo `calf_id` o `bull_id` apunte al **perfil viejo** deberá pasar a apuntar al **perfil nuevo** (el animal sigue siendo madre/toro de su descendencia). Esto incluye eventos que **no** son del perfil viejo (eventos de OTROS animales que lo referencian como madre/toro).
- **R3.5** — El sistema deberá re-apuntar las filas de `birth_calves` cuyo `calf_profile_id` apunte al perfil viejo, al perfil nuevo (el animal transferido sigue siendo el ternero registrado de su parto de origen).
- **R3.6** — Cuando re-apunta cualquier fila hija que tiene `establishment_id` denormalizado (las 5 tablas de evento, `animal_category_history`, `birth_calves`), el sistema deberá actualizar ese `establishment_id → el de Y`, de modo que la fila **deje de estar visible en el sync set del campo X** y pase al de Y. [RECON-1: sin esto, fuga de aislamiento cross-tenant por el WAL/PowerSync — Gate 1.]
- **R3.7** — Cuando re-apunta filas de `animal_events` (que tienen `establishment_id` **propio**, no denormalizado-por-perfil, `0034`), el sistema deberá actualizar su `establishment_id → el de Y` de forma que el trigger `tg_animal_events_enforce_edit_window` (que declara `animal_profile_id`/`establishment_id` inmutables en UPDATE de cliente) **no rechace** el re-apuntado (ver design: el RPC `SECURITY DEFINER` debe poder re-apuntar sin disparar ese rechazo).
- **R3.8** — Cuando re-apunta cualquier evento que lleve `session_id` (las 5 tablas tipadas), el sistema deberá **setear `session_id = NULL`** en las filas re-apuntadas. Esos `session_id` referencian sesiones de MODO MANIOBRAS del campo X (cross-tenant); conservarlos dejaría un puntero inaccesible por RLS. El evento conserva su `event_date`/`created_by`. [Decisión Raf, Gate 0.]
- **R3.9** — Tras el re-parenting, el perfil viejo (X) deberá quedar **sin eventos propios** (todos re-apuntados al nuevo).

---

## R4 — Archivado del perfil viejo + invariante de unicidad (DEFINITIVAS)

- **R4.1** — Tras re-apuntar la historia, el sistema deberá **archivar** el perfil viejo (X) dejándolo `status = 'transferred'` con `exit_reason = 'transfer'` y `exit_date = <fecha de la transferencia>`. **No deberá** ser soft-delete (`deleted_at` queda `NULL`): el perfil archivado queda visible en el historial de X como rastro de que el animal estuvo y se fue. [Resuelve el "definir cuál preserva mejor el rastro en X" del context.md → se elige `status='transferred'`, no soft-delete.]
- **R4.2** — En **ningún momento** de la operación el animal deberá quedar con **cero** perfiles activos ni con **dos** perfiles activos simultáneos (el unique parcial `animal_profiles_active_animal_unique` de spec 02 R4.11 sigue valiendo). El orden de operaciones del RPC deberá garantizar esta invariante (ver design: archivar viejo antes de — o en la misma transacción que — activar nuevo).
- **R4.3** — La operación completa (crear perfil nuevo + re-apuntar toda la historia + archivar viejo) deberá ser **atómica**: o se aplica entera, o no se aplica nada. Si cualquier paso falla, el sistema **deberá** revertir todo (rollback total) y dejar el animal exactamente como estaba antes (activo en X, con su historia intacta en X).

---

## R5 — Seguridad: write cross-tenant (DEFINITIVAS — superficie de Gate 1)

- **R5.1** — El sistema **solo deberá** ejecutar la transferencia si el usuario tiene **rol activo en X Y es owner o creador del animal en X** (`has_role_in(X) AND (is_owner_of(X) OR animal_profiles.created_by = auth.uid())` — **paridad EXACTA con el gate de baja `exit_animal_profile`, 0044/SEC-SPEC-01**) **y** tiene **rol activo en el establecimiento destino Y** (`has_role_in(Y)`). [**FIX Gate-1 HIGH-1**: la transferencia archiva el perfil de X = es una **baja**. El `has_role_in(X)` es OBLIGATORIO además del owner-or-creator: el path `created_by=auth.uid()` NO chequea rol activo, así que sin él un **ex-creador revocado de X** que conserva rol en Y podría sacar el animal de X (reabre SEC-SPEC-01). El lado destino Y exige solo rol activo porque es un CREATE.] Todo se re-valida **dentro** del RPC `SECURITY DEFINER`, derivado de la **fila real** del perfil de origen (incl. `created_by`) — **nunca** del payload. **TODO-D7**: Raf confirma la política (default seguro = owner-or-creator con rol activo en X).
- **R5.2** — Si el usuario **no** tiene rol activo en X, o **no** es owner ni creador del animal en X, entonces el sistema **deberá** rechazar la transferencia con `42501` (no autorizado) **sin** crear, re-apuntar ni archivar nada.
- **R5.3** — Si el usuario **no** tiene rol activo en Y, entonces el sistema **deberá** rechazar la transferencia con `42501` sin efectos.
- **R5.4** — El RPC de transferencia deberá derivar el `establishment_id` de origen X de la **fila real del perfil de origen** (`SELECT establishment_id FROM animal_profiles WHERE id = p_source_profile_id`), no de un parámetro del cliente.
- **R5.5** — El RPC de transferencia deberá tener `EXECUTE` **revocado** de `public`/`anon` y **concedido** solo a `authenticated`, con la firma tipada completa (patrón as-built `0041`/`0074`/`0083`).
- **R5.6** — Si el perfil de origen referenciado por el cliente **no está activo** (ya fue transferido/dado de baja/soft-deleted) o **no existe**, entonces el sistema deberá rechazar la transferencia (no se transfiere un animal ya inactivo) **sin** efectos parciales.

---

## R6 — Idempotencia y carrera (DEFINITIVAS)

- **R6.1** — La transferencia deberá ser **idempotente** respecto de un reintento del mismo intent de cliente: si el cliente reintenta una transferencia que ya se aplicó (porque el ACK se perdió), el sistema **no deberá** crear un segundo perfil ni re-apuntar dos veces; deberá devolver el resultado de la operación ya aplicada (dedup por un identificador de cliente estable, ver R6.2).
- **R6.2** — El cliente deberá proveer al RPC un **`p_target_profile_id` generado por el cliente** (UUID estable entre reintentos) como id del perfil nuevo; el RPC deberá usar ese id para detectar el replay (si el perfil con ese id ya existe y corresponde a este animal en Y, la operación ya corrió → no-op + devuelve el id). [Molde `create_animal` 0083 §a-bis.]
- **R6.3** — Si dos transferencias del mismo animal compiten (carrera), el sistema **deberá** dejar a lo sumo **una** ganadora: la segunda deberá fallar limpiamente (por el unique parcial de perfil activo o por encontrar el perfil de origen ya inactivo, R5.6) sin dejar estado corrupto.

---

## R7 — Online + alcance (DEFINITIVAS)

- **R7.1** — La transferencia **deberá requerir conexión** (es write cross-tenant sobre datos de X que deben estar firmes; análogo a crear-campo, spec 01 R9.2). El sistema **no deberá** encolar la transferencia para sync offline.
- **R7.2** — El sistema **no deberá** transferir más de un animal por invocación (transferencia masiva queda fuera del MVP).
- **R7.3** — El sistema **no deberá** traer al perfil nuevo en Y el estado de declaración SIGSA del campo X: el marcador de declaración vive por `(establecimiento, animal)` (spec 08), así que el animal arranca **no declarado** en Y (declara bajo el RENSPA de Y). El registro de declaración de X queda como histórico de X. [Decisión Raf, Gate 0 — "nada que resetear, la cardinalidad lo resuelve".]

---

## R8 — Linaje cruzado: descendencia que queda en X (TENTATIVA-UI + DEFINITIVA de datos)

> El context.md (§"Linaje cruzado") lockeó la **semántica de datos** (no se rompe el vínculo, se tolera por RLS) y dejó el **copy/UX a design**. La parte de datos (R8.1) es **definitiva**; la parte de UX (R8.2) es **tentativa** (depende de la ficha de spec 09/02, parcialmente construida).

- **R8.1** — Cuando el animal transferido es madre/toro y su descendencia **queda** en X (no se transfiere), el sistema **no deberá** romper el vínculo: tras la transferencia, los `calf_id`/`bull_id` de los eventos re-apuntados (que ahora viven en Y) referencian terneros que siguen en X. La navegación "ternero (X) → su madre" deberá resolverse vía el `animal_id` global a la madre, ahora en Y. [Consistente con R4.15 de spec 02: las fichas toleran madre/toro inaccesible/archivado.]
- **R8.2** — Cuando el viewer de la ficha del ternero (en X) **no** tiene rol activo en Y, el sistema deberá mostrar "madre/padre en otro campo" (mismo patrón que el caso cross-establishment de spec 09) en vez de un link roto o un crash.

---

## Mapa criterio del `acceptance` (feature_list.json) → R<n>

| Criterio `acceptance` | Cubierto por |
|---|---|
| Bastonear/buscar un TAG activo en otro campo del usuario ofrece "transferir a este campo" | R1.1, R1.2, R1.3 |
| La transferencia crea el perfil nuevo y re-apunta eventos/vínculos del perfil viejo (preserva historia) | R2.1, R3.1–R3.9 |
| Operación atómica: nunca deja el animal con cero o dos perfiles activos | R4.2, R4.3 |
| Solo disponible si el usuario tiene rol activo en ambos campos (origen y destino) | R5.1, R5.2, R5.3 |

## Mapa "Caso y decisión" del context.md → R<n> (cada decisión del Gate 0 cubierta por ≥1 R)

| Caso/decisión del context.md | Cubierto por |
|---|---|
| Re-apunta 5 eventos tipados | R3.1 |
| Re-apunta observaciones (`animal_events`) + su `establishment_id` | R3.2, R3.7 |
| Re-apunta `animal_category_history` | R3.3 |
| Re-apunta vínculos reproductivos (`calf_id`/`bull_id`) | R3.4 |
| Perfil viejo sin eventos + archivado (status vs soft-delete → resuelto) | R3.9, R4.1 |
| `management_group_id` → NULL | R2.3 |
| `idv` conservar-o-NULL ante colisión | R2.4, R2.5 |
| `session_id` → nullear | R3.8 |
| Rodeo destino como CREATE + mismo-sistema | R1.5, R1.6, R2.2 |
| Marcador SIGSA no carga (cardinalidad) | R7.3 |
| Linaje cruzado tolerado por RLS + copy a design | R8.1, R8.2 |
| Atómica | R4.3 |
| Roles en ambos campos | R5.1–R5.4 |
| Online (no offline) | R1.4, R7.1 |
| Punto de entrada find-or-create (D2) | R1.1, R1.3 |
| **RECON-1** establishment_id denorm en todas las hijas | R3.6 |
| **RECON-2** identidad denorm consistente | R2.6 |
| **RECON-3** is_castrated preserva / future_bull false | R2.7, R2.8 |

---

## TODOs / decisiones menores para Raf (Puerta 1)

- **TODO-D1** (`future_bull`): el perfil nuevo en Y arranca `future_bull = false` (alineado al comentario de `0085`: "no viaja entre campos"). **Default propuesto: NO se hereda.** Confirmar.
- **TODO-D2** (`category_id` del perfil nuevo): default propuesto = arrancar con la **misma `category_id`** que en X (válida porque mismo sistema, R2.2) + `category_override = false`, dejando que el recompute on-event/cron la ajuste según los hechos biológicos re-apuntados; alternativa = forzar un recompute explícito al crear el perfil. Confirmar cuál.
- **TODO-D3** (archivado): se eligió `status = 'transferred'` + `exit_reason = 'transfer'` (NO soft-delete) para preservar el rastro en X (R4.1). Confirmar que es el comportamiento deseado (vs soft-delete del perfil viejo).
- **TODO-D4** (reversibilidad): el MVP **no** modela "deshacer una transferencia" (no hay entidad `movements`/historial de transferencias — fuera de scope por Gate 0). Una transferencia equivocada se corrige transfiriendo de vuelta (X→Y→X), lo que crea un tercer perfil archivado en X. Confirmar que es aceptable para MVP.
- **TODO-D5** (copy linaje cruzado, R8.2): el texto exacto de "madre/padre en otro campo" se define junto con el frontend de la ficha (spec 09/02). Marcar como tentativo.
- **TODO-D6** (campos descriptivos del perfil, R2.12 — gap del Gate 0 que el leader cazó pre-Gate-1): el `context.md` solo decidió `idv` y `lote`; el perfil tiene además `visual_id_alt`, `breed`, `coat_color`, `notes`, `entry_origin`, `entry_date`, `entry_weight`. **Default propuesto**: viajan los del **animal** (`visual_id_alt`/`breed`/`coat_color`); se resetean los de la **relación con el campo** (`entry_*` → la entrada a Y es la transferencia; `notes` → NULL). Confirmar la partición (¿`notes` debería viajar? ¿`entry_weight` debería tomar el último peso conocido en vez de NULL?).
- **TODO-D7** (authz del lado origen, R5.1 — **FIX Gate-1 HIGH-1**): la transferencia archiva el perfil de X = es una **baja**. **Default seguro aplicado**: exige **owner-or-creator en X** (alineado a `exit_animal_profile`/SEC-SPEC-01), no solo "rol activo en X" como decía el Gate 0. Esto es **más restrictivo** que el `context.md`. **Confirmar**: ¿querés que solo el owner o el creador del animal puedan transferirlo fuera de X (seguro), o cualquier rol activo en X (lo que pedía el Gate 0, pero deja que un operario ajeno saque animales de otro owner)?

---

## Resumen de cobertura

- **Total**: 8 grupos (R1–R8), **39 requirements**.
- **Definitivas (firmes, testeables a nivel backend hoy)**: R2.1–R2.12, R3.1–R3.9, R4.1–R4.3, R5.1–R5.6, R6.1–R6.3, R7.1–R7.3, R8.1 = **32**.
- **Tentativas-UI (dependen del find-or-create de spec 09 / ficha, deferred)**: R1.1–R1.6, R8.2 = **7**.

## Historial de refinamiento

- **2026-06-12 (sesión 23) — redacción inicial** (spec_author). Fold del Gate 0 (`context.md`, aprobado Raf 2026-05-29) a EARS + reconciliación con as-built post-Gate-0 (RECON-1/2/3, ver sección homónima): `establishment_id` denormalizado en las 7 tablas hijas (0077/0078) → R3.6; identidad denormalizada (0079) → R2.6; `is_castrated`/`future_bull` (0084/0085) → R2.7/R2.8. Pendiente Gate 1 + Puerta 1.
- **2026-06-12 (sesión 23) — review pre-Gate-1 del leader**. Verificado contra el remoto: el unique parcial `animal_profiles_active_animal_unique` existe (sostiene R4.2). **Gap cazado**: el RPC dropeaba 7 campos descriptivos del perfil (`visual_id_alt`/`breed`/`coat_color`/`notes`/`entry_*`) que el Gate 0 no trató → agregado **R2.12** (partición animal-viaja / relación-resetea) + **TODO-D6** para Raf. Diseño actualizado (§3.2(a)/(e) + §4.7).
- **2026-06-12 (sesión 23) — Gate 1 (security_analyzer modo spec) FAIL → fix-loop del leader**. 2 HIGH (reporte en `progress/security_spec_11-transferencia-animal.md`): **HIGH-1** (la transferencia archiva X = baja, pero solo exigía `has_role_in(X)` → evade el gate owner-or-creator de la baja as-built) → R5.1/R5.2 reescritas a **owner-or-creator en X** + `has_role_in(Y)` (default seguro), diseño §3.2(a) + §7 actualizados, **TODO-D7** para Raf. **HIGH-2** (la idempotencia no funcionaba: el select active-only del origen tiraba 23503 antes del corte de replay) → corte de replay movido al inicio del RPC (diseño §3.2(0), molde 0083).
- **2026-06-12 (sesión 23) — Gate 1 re-verificación → HIGH-2 cerrado, HIGH-1 fix incompleto → 2º fix-loop**. La re-verificación confirmó HIGH-2 cerrado pero cazó que el fix de HIGH-1 quedó **una condición corto**: `(is_owner_of(X) OR created_by=auth.uid())` NO es subconjunto de `has_role_in(X)` (el path `created_by` no chequea `active`), reabriendo el vector SEC-SPEC-01 (ex-creador revocado de X con rol en Y). **2º fix**: authz a **paridad EXACTA con 0044** = `has_role_in(X) AND (is_owner_of(X) OR created_by=auth.uid())` (design §3.2(a) + R5.1/R5.2 + §5 + §7). D7 confirmado por Raf (owner-or-creator). 
- **2026-06-12 (sesión 23) — Gate 1 3er pase = PASS (0 HIGH)**. Confirmada paridad EXACTA con `exit_animal_profile` (0044), vector del ex-creador revocado cerrado, HIGH-2 intacto, sin regresiones, las 4 superficies (R5.1/R5.2/§5/§7) consistentes. MED-1 (DEC-A3 birth_calves) y MED-2 (sin rate limit) quedan como decisiones de Raf en Puerta 1, no bloquean. **Spec lista para Puerta 1.**
- **2026-06-12 (sesión 23) — PUERTA 1 APROBADA por Raf**. Aprobó la spec con los defaults D1-D6 + MED-1 (birth_calves madre→Y) + MED-2 (sin rate limit, anotado para el implementer) tal cual. D7 = owner-or-creator con rol activo en X (ya foldeado). `feature_list.json` 11 `spec_ready`→`in_progress`. Habilitado el implementer (Fase 1 RPC + Fase 2 tests + Fase 3 service; Fase 4 UI diferida).
