# Spec 07 — Delta CAMPAÑAS CONGELADAS: los reportes cerrados son una foto — Requirements (EARS)

**Status**: `approved` — **Puerta 1 APROBADA por Raf (2026-08-07)**, con DP-22 resuelto (campaña cerrada del demo = **2024**, 2025 en curso) · Delta **Nivel B (ADR-028)** sobre spec 07 (`done` — el delta **no** cambia su estado) ·
**CON BACKEND** (3 tablas nuevas + 3 RPC nuevas + 3 set-functions internas + 3 helpers + reescritura de 7 funciones
de lectura) · **Gate 1 OBLIGATORIO** · **Gate 2.5 OBLIGATORIO** (ADR-029).
**Deploy**: **NO autorizado todavía** — toca DB. Lo pide el leader en sesión antes de aplicar.
**Fecha**: 2026-08-07.

**Fuente de verdad**: `specs/active/07-reportes-basicos/context-campanas-congeladas.md` (Gate 0 **aprobado por Raf**,
2026-08-07). D1–D3 (Raf/ADR-032), DL1–DL10 (leader, ratificadas) y los puntos ①/② de la Puerta 0 son **input fijo**:
acá se traducen a EARS, no se re-deciden.
**Evidencia**: `progress/repro_reportes-campanas-congeladas.md` (los números de los probes son los casos de test).
**Decisión**: `docs/adr/ADR-032-campanas-cerradas-foto-inmutable.md`.
**Numeración**: `RCC.<n>` ("Reportes Campañas Congeladas"). El baseline `R7.*` y los deltas `RPF.*`/`RWK.*` **no se tocan**.

---

## Cobertura de las decisiones del Gate 0

| Decisión (context / ADR-032) | Requisito(s) |
|---|---|
| **D1** — el cierre lo dispara el productor; la app lo sugiere | RCC.5.1, RCC.5.7, RCC.5.7.a–d, RCC.5.11, RCC.7.6, RCC.10.2, RCC.10.5 |
| **D2** — el pasado: se re-seedea "La Facundina" | RCC.11.* |
| **D3** — se tapan las cuatro fugas, incluida la historia de membresía | RCC.1.*, RCC.2.*, RCC.3.* |
| **DL1** — el dato es por rodeo; el gesto puede ser masivo | RCC.5.1, RCC.5.10, RCC.10.6 |
| **DL2** — el snapshot lo computa el server al cerrar | RCC.5.4, RCC.5.5 |
| **DL3** — cerrada se LEE del snapshot; abierta se computa en vivo (server-side) | RCC.7.1, RCC.7.2, RCC.7.4 |
| **DL4** — la reapertura existe, con rastro | RCC.6.* |
| **DL5** — ventana del tacto de la campaña N | RCC.3.1, RCC.3.2 |
| **DL6** — el estado histórico se resuelve al CIERRE de la ventana | RCC.2.1, RCC.2.2 |
| **DL7** — backfill de la historia de membresía | RCC.1.8, RCC.1.9 |
| **DL8** — la historia de membresía NO va a PowerSync | RCC.1.10, RCC.4.9 |
| **DL9** — el cierre es online-only | RCC.5.11 |
| **DL10** — si llega un dato de una campaña ya cerrada | RCC.8.* |
| **①** — cierran owner y veterinario; el `field_operator` no; leer no cambia | RCC.5.2, RCC.5.3, RCC.6.1, RCC.7.3 |
| **②** — se congelan los números **y** el detalle por animal | RCC.4.4, RCC.4.5, RCC.4.6 |
| **F1** numerador sin filtro de fecha | RCC.3.3, RCC.3.4 |
| **F2** estado leído del `status` actual | RCC.2.4, RCC.2.5 |
| **F3** categoría leída de la actual | RCC.2.6, RCC.2.7, RCC.2.8 |
| **F4** membresía de rodeo leída de la actual | RCC.1.*, RCC.2.3 |

**Hallazgos del `spec_author` sobre el inventario del context** (correcciones de conteo/alcance, no re-decisiones —
detalle y fundamento en `design-campanas-congeladas.md` §0.3):

| # | Hallazgo | Requisito |
|---|---|---|
| **H1** | Las funciones con `p_year` a reescribir son **7**, no 6 (el context/ADR-032 dice "6" pero enumera 7). | RCC.7.1 |
| **F5** | `service_months` es **mutable** y gobierna `n_months`/`is_configured` **dentro** de los KPI y el nº de barras del CCL en la UI → una campaña cerrada cambiaría de forma si el productor edita la estación. | RCC.4.2, RCC.10.4 |
| **F3-bis** | El *fallback por edad* de `rodeo_serviced_females` (`0105:141`) usa `current_date` → una vaquillona que hoy tiene edad de servicio entra en campañas de hace 5 años. Es la misma familia que F3. | RCC.2.9 |
| **F7** | Con el estado histórico, `retired` de `rodeo_repro_denominator` queda estructuralmente en 0 (el conjunto servidas ya está evaluado a la fecha de corte) → `entoradas == serviced` siempre. | RCC.2.12 |
| **F8** | *(objeción del leader, 2026-08-07)* Un cierre con el servicio terminado pero **el ciclo incompleto** congela `%parición` y `%destete` en 0 **para siempre** — el mismo modo de falla que ADR-032 §2 descarta para el cierre automático por fecha, disponible para cualquier usuario con un toque. El aviso de `cycle_complete` no es un guard. | RCC.5.7.a–d, RCC.4.11, RCC.10.7.a, RCC.10.11 |

---

## RCC.1 — Historia de membresía de rodeo (`rodeo_membership_history`) — F4 / D3 / DL7 / DL8

- **RCC.1.1** — El sistema deberá persistir una tabla `rodeo_membership_history` con `animal_profile_id`, `rodeo_id`,
  `establishment_id`, `from_date`, `to_date`, `reason` y `changed_by`, que registre en qué rodeo estuvo cada perfil y
  entre qué fechas.
- **RCC.1.2** — El sistema deberá interpretar el intervalo de cada fila como **medio-abierto** `[from_date, to_date)`:
  un perfil está en el rodeo en la fecha `D` si y solo si `from_date <= D` y (`to_date is null` o `to_date > D`).
- **RCC.1.3** — El sistema deberá garantizar que un perfil tenga **como máximo una** fila con `to_date is null`
  (membresía vigente) en todo momento.
- **RCC.1.4** — Cuando se inserta un `animal_profiles`, el sistema deberá abrir una fila de membresía con
  `rodeo_id` = el del perfil y `from_date = coalesce(entry_date, created_at::date)`.
- **RCC.1.5** — Cuando el `rodeo_id` de un `animal_profiles` cambia, el sistema deberá cerrar la fila vigente con
  `to_date = current_date` y abrir una fila nueva con `from_date = current_date` y el rodeo destino.
- **RCC.1.6** — Cuando un `animal_profiles` deja el padrón (su `status` pasa a distinto de `active`, o se le setea
  `deleted_at`), el sistema deberá cerrar la fila de membresía vigente con
  `to_date = greatest(coalesce(exit_date, current_date), from_date)`.
- **RCC.1.7** — Cuando un `animal_profiles` vuelve al padrón (`status = 'active'` y `deleted_at is null`) sin tener
  fila vigente, el sistema deberá abrir una fila nueva con `from_date = current_date`.
- **RCC.1.8** — El sistema deberá sembrar, al crear la tabla, exactamente una fila por perfil existente
  (`from_date = coalesce(entry_date, created_at::date)`; `to_date` nulo si el perfil está activo y no borrado, o
  `greatest(coalesce(exit_date, current_date), from_date)` si no lo está), sin duplicar filas si el backfill se
  vuelve a ejecutar.
- **RCC.1.9** — El sistema deberá documentar en el `design.md` y en el comentario SQL de la tabla que el backfill
  **asume que ningún perfil se movió de rodeo antes del deploy** y que, por lo tanto, la historia previa de los
  animales efectivamente movidos es **falsa**; el historial fiel empieza a acumularse desde el deploy.
- **RCC.1.10** — El sistema no deberá agregar `rodeo_membership_history` a `sync-streams/rafaq.yaml` (no sincroniza
  a los devices).
- **RCC.1.11** — El sistema deberá exponer `rodeo_membership_history` con RLS de solo lectura para los roles activos
  del establecimiento y no deberá otorgar `insert`/`update`/`delete` a `authenticated` (las filas las escribe
  únicamente el trigger `SECURITY DEFINER`).
- **RCC.1.12** — El sistema deberá derivar el `establishment_id` denormalizado de la fila del `animal_profiles` padre
  y no deberá tomarlo nunca de un valor provisto por el cliente (ADR-026, patrón anti-spoof).
- **RCC.1.13** — El sistema no deberá re-apuntar las filas de `rodeo_membership_history` en `transfer_animal`
  (`0087`): la historia de membresía del perfil de origen deberá quedarse en el establecimiento de origen.

## RCC.2 — Conjunto SERVIDAS histórico (`rodeo_serviced_females`) — F2 / F3 / F3-bis / F4 / DL6

- **RCC.2.1** — El sistema deberá resolver el estado histórico del animal a la **fecha de corte de la campaña**,
  definida como el último día del mayor mes de servicio del año `p_year` (`rodeo_service_campaign.window_end`).
- **RCC.2.2** — Cuando el rodeo no tiene meses de servicio (`service_months` nulo o vacío), el sistema deberá usar
  como fecha de corte el 31 de diciembre de `p_year`.
- **RCC.2.3** — El sistema deberá determinar la pertenencia de un perfil al rodeo consultando
  `rodeo_membership_history` a la fecha de corte, y no deberá leer `animal_profiles.rodeo_id`.
- **RCC.2.4** — El sistema no deberá excluir del conjunto servidas a un perfil por su `status` actual: la presencia
  en el padrón deberá resolverse por el intervalo de membresía a la fecha de corte.
- **RCC.2.5** — El sistema deberá seguir excluyendo del conjunto servidas a todo perfil con `deleted_at` no nulo
  (borrado lógico = carga errónea, distinto de una baja).
- **RCC.2.6** — El sistema deberá resolver la categoría del perfil a la fecha de corte usando
  `animal_category_history` (el `to_category_id` del último cambio con `changed_at::date <= fecha de corte`), y no
  deberá leer `animal_profiles.category_id`.
- **RCC.2.7** — Si el perfil no tiene ninguna fila de `animal_category_history` anterior o igual a la fecha de corte,
  entonces el sistema deberá usar su categoría actual como degradación documentada.
- **RCC.2.8** — El sistema deberá resolver el veredicto de aptitud de una vaquillona (`heifer_fitness` del último
  `tacto_vaquillona`) considerando únicamente los eventos con `event_date <= fecha de corte`.
- **RCC.2.9** — El sistema deberá evaluar el *fallback por edad* del conjunto servidas contra la fecha de corte
  (`fecha de corte − birth_date >= 365 días`), y no contra `current_date`.
- **RCC.2.10** — El sistema deberá aplicar a la rama de inseminación artificial los mismos predicados históricos de
  membresía y de padrón a la fecha de corte, conservando su filtro de `event_date` por año y mes de campaña.
- **RCC.2.11** — El sistema deberá mantener `rodeo_serviced_females` como el **único** lugar donde se expresa la
  elegibilidad del denominador: las demás funciones de campaña no deberán re-derivarla (§5.7 de `0106` preservado).
- **RCC.2.12** — El sistema deberá devolver `retired = 0` y `entoradas = serviced` en `rodeo_repro_denominator`, y
  deberá documentar en el `design.md` que la columna se conserva solo por compatibilidad de contrato y que la
  redefinición de *entoradas* queda en `docs/backlog.md`.

## RCC.3 — Numerador histórico: el tacto acotado a la ventana de campaña — F1 / DL5

- **RCC.3.1** — El sistema deberá definir la **ventana del tacto** de la campaña `p_year` como
  `[make_date(p_year, min(service_months), 1), make_date(p_year + 1, min(service_months), 1) − 1 día]`.
- **RCC.3.2** — Cuando el rodeo no tiene meses de servicio, el sistema deberá usar como ventana del tacto el año
  calendario completo de `p_year`.
- **RCC.3.3** — El sistema deberá resolver el "último tacto" de cada hembra servida considerando únicamente los
  eventos `tacto` no borrados con `event_date` dentro de la ventana del tacto de la campaña.
- **RCC.3.4** — El sistema deberá considerar únicamente los eventos `abortion` con `event_date` dentro de la ventana
  del tacto de la campaña al evaluar la regla "tacto+ vigente".
- **RCC.3.5** — El sistema deberá expresar la resolución del tacto de campaña (último tacto + `is_pregnant` +
  `is_empty`) en **una sola** función reutilizada por `rodeo_pregnancy_kpi`, `rodeo_calving_kpi` y
  `rodeo_ccl_distribution`, en lugar de repetir la CTE en cada una.
- **RCC.3.6** — El sistema deberá expresar la imputación de partos a la campaña (concepción = `parto − 9 meses`, año
  `p_year`, mes ∈ `service_months`) en **una sola** función reutilizada por `rodeo_calving_kpi`,
  `rodeo_calving_by_stage` y `rodeo_weaning_kpi`.
- **RCC.3.7** — El sistema deberá expresar el vínculo parto→cría→destete de la campaña en **una sola** función
  reutilizada por `rodeo_weaning_kpi` y por el detalle del snapshot.
- **RCC.3.8** — El sistema no deberá cambiar las fórmulas de `calved`, `pending_pregnant`, `weaned`,
  `pending_weaning`, `status` (parición y destete) ni el bucketing de `rodeo_calving_by_stage`: solo cambian el
  conjunto servidas del que parten y la ventana del tacto.

## RCC.4 — El snapshot: qué se congela y cómo se guarda — DL2 / ②

- **RCC.4.1** — El sistema deberá persistir, por cada cierre de `(rodeo_id, campaign_year)`, una fila con **todas**
  las columnas que devuelven las 5 RPC de KPI (preñez, parición, CCL, nacimientos por etapa y destete), más
  `serviced`, `retired` y `entoradas`.
- **RCC.4.2** — El sistema deberá congelar en esa misma fila `service_months`, `n_months` e `is_configured`, y las
  RPC deberán devolver los valores congelados mientras la campaña esté cerrada.
- **RCC.4.3** — El sistema deberá congelar en esa misma fila la fecha de corte usada (RCC.2.1) y los extremos de la
  ventana del tacto (RCC.3.1), como registro auditable de con qué parámetros se computó la foto.
- **RCC.4.4** — El sistema deberá persistir el detalle por animal del cierre como **una fila por
  (snapshot, animal, bucket)**, con `bucket` en `{serviced, pregnant, empty, calved, weaned}`.
- **RCC.4.5** — El sistema deberá permitir que un mismo animal aparezca en varios buckets del mismo snapshot
  (servida **y** preñada **y** parida) sin conflicto de unicidad.
- **RCC.4.6** — El sistema deberá conservar cada fila del detalle aunque el `animal_profiles` referenciado deje de
  existir, guardando el identificador legible (`idv`) vigente al momento del cierre y anulando la referencia en vez
  de borrar la fila.
- **RCC.4.7** — El sistema deberá garantizar que la cantidad de filas de cada bucket coincida con el número
  congelado correspondiente en la cabecera (`serviced`, `pregnant`, `empty`, `calved`, `weaned`).
  > **Reconciliación as-built (2026-08-07, `design` §2.4 y §15-bis R13)**: la garantía **no** es "salen del
  > mismo `select`" —`close_campaign` es `VOLATILE`, así que en `READ COMMITTED` cada sentencia toma un
  > snapshot nuevo y el detalle y la cabecera se materializan en sentencias distintas—, sino que el cierre
  > **cuenta las filas del detalle y las compara con los cinco números antes de terminar**, y **aborta con
  > `40001` sin dejar snapshot** si difieren. Un dato concurrente ya no puede acuñar una foto internamente
  > inconsistente: hace fallar el cierre, que se reintenta.
- **RCC.4.8** — El sistema deberá exponer ambas tablas de snapshot con RLS de solo lectura para los roles activos del
  establecimiento y no deberá otorgar `insert`/`update`/`delete` a `authenticated`.
  > **Reconciliación as-built (2026-08-07, Gate 2 H-C1 · `design` §15-bis R12)**: "no otorgar" **no alcanza**,
  > porque el `pg_default_acl` del schema **ya otorga** `TRUNCATE` (más `REFERENCES`/`TRIGGER`/`MAINTAIN`) a
  > `anon` y `authenticated` en toda tabla nueva de `public`, y la RLS **no puede restringir TRUNCATE** (no
  > existe policy de esa categoría). Las tres tablas del delta emiten `revoke all … from public, anon,
  > authenticated` explícito antes de sus `grant select`, y el oráculo (TR.14e) resuelve el **ACL real** con
  > `has_table_privilege` además del comportamiento por PostgREST — que es estructuralmente ciego a un grant
  > de TRUNCATE. La condición del schema es general (35 tablas) y su barrido está en `docs/backlog.md`.
- **RCC.4.8.a** — El sistema deberá escribir el `establishment_id` de `rodeo_campaign_snapshots` derivándolo de la
  fila del `rodeos` padre (el mismo valor que usó el guard de tenant) y el de `rodeo_campaign_snapshot_animals`
  derivándolo de la fila de snapshot padre; en ningún caso de un valor del cliente ni de la fila del animal
  (ADR-026, anti-spoof).
- **RCC.4.8.b** — El sistema deberá garantizar **estructuralmente** que el `establishment_id` de una fila de detalle
  sea igual al de su snapshot padre, mediante una clave foránea compuesta `(snapshot_id, establishment_id)` contra
  una clave única `(id, establishment_id)` de la cabecera.
- **RCC.4.9** — El sistema no deberá agregar las tablas de snapshot a `sync-streams/rafaq.yaml`.
- **RCC.4.10** — El sistema deberá impedir que exista más de un snapshot **vigente** (no reabierto) por
  `(rodeo_id, campaign_year)`.
- **RCC.4.11** — Cuando una campaña se cierra con el ciclo incompleto, el sistema deberá persistir en el snapshot
  que se cerró a medias y qué faltaba al momento del cierre, de forma legible sin recomputar nada.

## RCC.5 — Cierre de campaña (`close_campaign`) — D1 / DL1 / DL2 / DL9 / ①

- **RCC.5.1** — El sistema deberá proveer una RPC
  `close_campaign(p_rodeo_id uuid, p_year int, p_acknowledge_incomplete boolean default false)` que cierre la
  campaña de **un** rodeo y devuelva el identificador del snapshot vigente.
- **RCC.5.2** — Si el invocador no es `owner` ni `veterinarian` activo del establecimiento del rodeo, entonces el
  sistema deberá rechazar la llamada con `42501` y no deberá escribir ninguna fila.
- **RCC.5.3** — El sistema deberá proveer un helper `is_owner_or_vet_of(est_id uuid)` moldeado sobre `is_owner_of`
  (`0005`), cambiando únicamente `ur.role = 'owner'` por `ur.role in ('owner','veterinarian')`.
- **RCC.5.4** — El sistema deberá computar los valores del snapshot **en el servidor**, invocando las mismas
  funciones de KPI que usa la lectura en vivo, y no deberá aceptar números provistos por el cliente.
- **RCC.5.5** — El sistema deberá materializar todos los conjuntos y agregados **antes** de insertar la fila de
  snapshot, para que el cómputo del cierre nunca lea la foto que él mismo está creando.
- **RCC.5.6** — Cuando la campaña ya está cerrada, el sistema deberá devolver el identificador del snapshot vigente
  sin crear uno nuevo ni modificar el existente.
- **RCC.5.7** — Si la fecha de corte de la campaña es posterior a la fecha actual (el servicio todavía no
  terminó), entonces el sistema deberá rechazar el cierre con `23514` y no deberá permitir sortear ese rechazo
  con `p_acknowledge_incomplete`.
- **RCC.5.7.a** — Si el ciclo de la campaña está incompleto y `p_acknowledge_incomplete` es falso, entonces el
  sistema deberá rechazar el cierre con `23514` y un mensaje que enumere **qué falta**, con las cantidades de
  preñadas sin parir y de crías sin destetar.
- **RCC.5.7.b** — Cuando `p_acknowledge_incomplete` es verdadero, el sistema deberá cerrar la campaña aunque el
  ciclo esté incompleto.
- **RCC.5.7.c** — El sistema deberá evaluar "ciclo incompleto" con **el mismo predicado** que expone
  `rodeo_campaign_status.cycle_complete`, definido en un único lugar y consumido por ambas funciones.
- **RCC.5.7.d** — Cuando el cierre ocurre con el ciclo incompleto, el sistema deberá marcar el snapshot como
  cerrado a medias y guardar el descriptor de lo que faltaba (RCC.4.11).
- **RCC.5.7.e** — Si la campaña no tiene ninguna hembra servida, entonces el sistema deberá rechazar el cierre con
  `23514` y no deberá permitir sortear ese rechazo con `p_acknowledge_incomplete`: un año sin hechos de campaña no
  es una campaña incompleta, es una campaña inexistente, y no hay nada que fotografiar.
- **RCC.5.8** — El sistema deberá rechazar `p_year` fuera de `1900..current+1` con `22023` y un rodeo inexistente o
  borrado con `P0002`.
- **RCC.5.9** — El sistema no deberá modificar ninguna fila de `animals`, `animal_profiles`, eventos, `rodeos` ni
  `sessions` al cerrar una campaña: sus únicas escrituras deberán ser sobre las dos tablas de snapshot.
- **RCC.5.10** — El sistema deberá implementar el cierre masivo "la campaña `<año>` de todo el campo" como **N
  llamadas del cliente** a `close_campaign` (una por rodeo), informando el resultado por rodeo, y no deberá exponer
  una RPC que reciba un `establishment_id` del cliente.
- **RCC.5.10.a** — El sistema deberá ejecutar el cierre masivo en dos pasos: una primera pasada con
  `p_acknowledge_incomplete = false`, y —solo si el usuario confirma explícitamente los rodeos que quedaron
  rechazados por ciclo incompleto— una segunda pasada con `p_acknowledge_incomplete = true` **acotada a esos
  rodeos**.
- **RCC.5.11** — Mientras el dispositivo esté sin conexión, el sistema no deberá ofrecer ni intentar el cierre:
  deberá mostrar que hace falta conexión.
  > **Reconciliación as-built (2026-08-07, `design` §15-bis R20)**: la mitad de "no intentar" tiene oráculo —
  > el guard de cableado `app/src/services/reports-online-guard.test.ts`, que verifica que **cada** helper de
  > invocación chequea la conexión **antes** del fetch y que ningún wrapper exportado llama a la RPC por su
  > cuenta. Hace falta un guard de cableado y no un test de comportamiento porque `services/reports.ts`
  > arrastra React Native y ningún test de `node:test` lo puede importar: sin él, borrar el `assertOnline` no
  > ponía nada en rojo.

## RCC.6 — Reapertura (`reopen_campaign`) — DL4

- **RCC.6.1** — El sistema deberá proveer una RPC `reopen_campaign(p_rodeo_id uuid, p_year int)` sujeta al mismo
  guard `is_owner_or_vet_of` y a las mismas cotas de parámetros que `close_campaign`.
- **RCC.6.2** — Si la campaña siguiente (`p_year + 1`) del mismo rodeo está cerrada, entonces el sistema deberá
  rechazar la reapertura con `23514`.
- **RCC.6.3** — Cuando se reabre una campaña, el sistema deberá conservar la fila de snapshot y su detalle marcando
  `reopened_at` y `reopened_by`, y no deberá borrarlos.
- **RCC.6.4** — Cuando la campaña ya está abierta, el sistema no deberá fallar: deberá devolver un resultado nulo
  sin escribir.
- **RCC.6.5** — Cuando una campaña reabierta se vuelve a cerrar, el sistema deberá crear un snapshot **nuevo**,
  dejando el anterior como registro histórico.

## RCC.7 — Lectura: una campaña cerrada se lee del snapshot — DL3 / H1

- **RCC.7.1** — Mientras exista un snapshot vigente para `(rodeo_id, p_year)`, las **siete** funciones de campaña
  (`rodeo_serviced_females`, `rodeo_repro_denominator`, `rodeo_pregnancy_kpi`, `rodeo_calving_kpi`,
  `rodeo_ccl_distribution`, `rodeo_calving_by_stage`, `rodeo_weaning_kpi`) deberán devolver los valores congelados
  y no deberán computar nada sobre el estado actual.
- **RCC.7.2** — Mientras la campaña esté cerrada, `rodeo_serviced_females` deberá devolver las filas del bucket
  `serviced` del detalle del snapshot (incluidas aquellas cuyo `animal_profile_id` quedó nulo), conservando su
  contrato `(animal_profile_id, source)`.
- **RCC.7.3** — El sistema no deberá endurecer el guard de las funciones de lectura: cualquier rol activo del
  establecimiento deberá poder leer un reporte, esté la campaña abierta o cerrada.
- **RCC.7.4** — Mientras no exista un snapshot vigente, el sistema deberá computar los reportes en vivo con la lógica
  histórica de RCC.2 y RCC.3.
- **RCC.7.5** — El sistema no deberá cambiar el `returns table` de ninguna de las siete funciones (el cliente
  existente sigue funcionando sin cambios de contrato).
- **RCC.7.6** — El sistema deberá proveer una RPC de lectura `rodeo_campaign_status(p_rodeo_id uuid, p_year int)`
  que devuelva si la campaña está cerrada, cuándo y por quién, los `service_months` congelados, si el ciclo de la
  campaña está completo, si hay datos nuevos sin reflejar, y si el invocador puede cerrar y reabrir.
- **RCC.7.6.a** — El sistema deberá derivar `can_close` de **los tres** guards duros del cierre (rol, fecha de
  corte ya ocurrida y campaña con al menos una hembra servida), de modo que la pantalla nunca ofrezca cerrar —ni
  reconocer un cierre incompleto— cuando el cierre va a ser rechazado de todas formas.
- **RCC.7.7** — El sistema deberá exponer en `rodeo_campaign_status`, además, si la campaña se cerró a medias, el
  descriptor de lo que faltaba al cerrar, y las cantidades vigentes de preñadas sin parir y de crías sin destetar,
  para que la UI pueda enumerar qué falta sin llamar a los KPI.

## RCC.8 — Datos que llegan tarde a una campaña cerrada — DL10

- **RCC.8.1** — El sistema no deberá rechazar la carga de un evento cuya campaña esté cerrada (el offline-first no
  se rompe: el dato entra igual).
- **RCC.8.2** — Cuando entra un evento de una campaña cerrada, el sistema no deberá modificar el snapshot.
- **RCC.8.3** — Cuando existe al menos un `reproductive_events` no borrado, sobre un animal del detalle del snapshot,
  con `created_at` posterior a `closed_at` y `event_date` dentro de la ventana congelada del tacto, el sistema deberá
  devolver `has_new_data = true` en `rodeo_campaign_status`.
- **RCC.8.4** — Cuando `has_new_data` es verdadero, la pantalla de reportes deberá avisar que la campaña cerrada
  tiene datos nuevos sin reflejar y ofrecer reabrirla.

## RCC.9 — Contrato de seguridad (Gate 1)

- **RCC.9.1** — El sistema deberá preservar íntegro el contrato §5.1–§5.10 de `0106` en las siete funciones
  modificadas: guard `has_role_in` fail-closed como primera sentencia tras derivar el tenant de la fila del rodeo,
  `SECURITY DEFINER STABLE set search_path = public`, cota de `p_year`, tenant por el JOIN a `animal_profiles`,
  exclusión de perfiles borrados en el JOIN, denominador delegado, y `revoke public/anon` + `grant authenticated` +
  smoke-check fail-closed.
- **RCC.9.2** — El sistema deberá declarar `close_campaign` y `reopen_campaign` como `SECURITY DEFINER`
  **VOLATILE** (no `STABLE`) con `set search_path = public, pg_temp`, y deberá documentar por qué el `STABLE` de
  §5.2 no aplica a ellas y por qué `pg_temp` va **último y explícito** (crean y leen tablas temporales dentro de
  una función `DEFINER`).
- **RCC.9.3** — El sistema no deberá aceptar un `establishment_id` provisto por el cliente en ninguna de las tres
  RPC nuevas: el tenant deberá derivarse siempre de la fila del rodeo.
- **RCC.9.4** — El sistema deberá rechazar con `42501` (nunca con un resultado vacío ni un no-op silencioso) toda
  llamada a `close_campaign`, `reopen_campaign` o `rodeo_campaign_status` sobre un rodeo de otro establecimiento.
- **RCC.9.5** — El sistema deberá revocar `execute` de `public`, `anon` **y `authenticated`** en **toda** función
  interna del delta (las que ningún cliente invoca por PostgREST), sin excepción y sin depender de que alguien
  recuerde agregarla a una lista.
- **RCC.9.6** — El sistema deberá incluir en cada migración un smoke-check fail-closed que **barra por prefijo de
  nombre** las funciones del delta y las contraste contra una **lista blanca explícita** de las que sí son
  públicas (`close_campaign`, `reopen_campaign`, `rodeo_campaign_status` y las siete de lectura ya existentes),
  abortando la migración si alguna función fuera de la lista blanca quedó ejecutable por `public`, `anon` o
  `authenticated`. La enumeración de la lista blanca deberá ser la **única** en la migración: los `revoke` y el
  smoke-check deberán derivarse de ella.
- **RCC.9.6.a** — El sistema deberá verificar, con la **misma** enumeración y en el mismo smoke-check, la otra
  mitad del contrato §5.8: que ninguna de las funciones **públicas** del delta quedó ejecutable por `anon` o
  `public`. Una función nueva a la que se le olvide el `revoke` deberá abortar la migración.
  > **Reconciliación as-built (2026-08-07, `design` §15 R1/R2)**: la lista blanca quedó con **14** entradas,
  > no 11 — el barrido por `rodeo\_%` alcanza también a `rodeo_sessions_list` y `rodeo_weight_by_category`
  > (públicas preexistentes, verificado en el catálogo del remoto), y sin ellas la migración **abortaba**. Se
  > sumó `is_owner_or_vet_of` y los prefijos `close\_%`/`reopen\_%` al barrido. Los `revoke`/`grant` se
  > **derivan** de esa única lista leyendo la firma del catálogo, en vez de escribirse a mano: así el
  > requisito de "una sola enumeración" se cumple literal y la firma no puede quedar vieja.
- **RCC.9.7** — El sistema deberá declarar el trigger de membresía como `SECURITY DEFINER` con
  `set search_path = public`, siguiendo el molde de `tg_animal_profiles_record_category_change` (`0030`).
- **RCC.9.8** — El sistema deberá resolver una carrera entre dos cierres concurrentes de la misma campaña sin crear
  dos snapshots vigentes, devolviendo el existente en lugar de propagar un error de unicidad.
- **RCC.9.9** — El sistema no deberá exponer el detalle por animal de un snapshot a un usuario sin rol activo en el
  establecimiento, ni por RLS ni por RPC.
- **RCC.9.10** — El sistema deberá acotar el costo del cierre a un rodeo y una campaña, sin escaneos sin cota sobre
  el establecimiento ni sobre el histórico completo de eventos, y deberá declarar en el `design.md` el factor de
  amplificación real del cierre (cuántas veces se re-ejecuta el cómputo de elegibilidad por llamada) en vez de
  presentarlo como una sola pasada.
- **RCC.9.11** — El sistema deberá acotar la cantidad de snapshots que un usuario puede materializar iterando
  `p_year`, rechazando el cierre de las campañas sin hembras servidas (RCC.5.7.e).
- **RCC.9.12** — El sistema deberá resolver el nombre del autor de un cierre desde `user_roles.member_name` del
  establecimiento del rodeo (ADR-026 c2) y no deberá leer la tabla global `users` desde una función
  `SECURITY DEFINER`.

## RCC.10 — Frontend: el estado de la campaña en la pantalla de reportes

- **RCC.10.1** — Mientras la campaña seleccionada esté cerrada, la pantalla de reportes deberá mostrar sin
  ambigüedad que es una foto y la fecha del cierre en formato es-AR (`dd/mm/aaaa`).
- **RCC.10.2** — Mientras la campaña seleccionada esté en curso, la pantalla de reportes deberá indicarlo
  explícitamente ("en curso") y no deberá presentar los números como definitivos.
- **RCC.10.2.a** *(agregado por el reviewer, H-1, 2026-08-07)* — Mientras el sistema **todavía no sepa** si la
  campaña está cerrada (el estado en vuelo, o el estado del año/rodeo anterior retenido por el anti-parpadeo),
  la pantalla no deberá afirmar ni "en curso" ni "cerrada", no deberá mostrar fecha de foto y no deberá
  ofrecer acciones: deberá mostrar un estado **desconocido** hasta que llegue el estado de esa campaña.
  Afirmar "en curso" mientras no se sabe es la misma afirmación falsa que ADR-032 existe para impedir, y en
  una conexión de campo dura segundos, no un frame.
- **RCC.10.3** — El sistema deberá derivar la presentación del estado de campaña (etiqueta, detalle, qué acciones se
  ofrecen) de una función pura testeable, sin lógica de presentación en la pantalla.
- **RCC.10.4** — Mientras la campaña esté cerrada, la pantalla deberá dibujar las barras de la distribución CCL con
  los `service_months` **congelados** del snapshot, no con los del rodeo actual.
  > **Reconciliación as-built (2026-08-07, `design` §15-bis R20)**: la regla vive en la función pura
  > `campaignCclMonths` y **no es un `??` encadenado**. Con la campaña cerrada mandan los meses congelados
  > **incluso cuando son `null`** (una campaña que se corrió sin estación configurada): la primera
  > implementación usaba `campaign?.serviceMonths ?? rodeo?.serviceMonths` y ese `null` caía a los meses del
  > rodeo de HOY, o sea F5 reintroducida por un operador. Tiene test con su mutante.
- **RCC.10.5** — Cuando el ciclo de la campaña está completo y la campaña sigue abierta, la pantalla deberá sugerir
  cerrarla.
- **RCC.10.6** — La pantalla deberá ofrecer, además del cierre por rodeo, cerrar la campaña del año seleccionado en
  todos los rodeos del campo, informando cuántos rodeos se cerraron y cuáles fallaron.
- **RCC.10.7** — Antes de ejecutar un cierre, el sistema deberá pedir confirmación explícita indicando qué rodeo y
  qué campaña se van a congelar.
- **RCC.10.7.a** — Cuando el ciclo de la campaña está incompleto, la confirmación deberá enumerar qué falta (las
  preñadas sin parir y las crías sin destetar, con sus cantidades) y deberá exigir una confirmación adicional antes
  de reintentar el cierre reconociendo lo incompleto.
- **RCC.10.7.b** — Cuando el ciclo de la campaña está completo, el sistema no deberá pedir la confirmación
  adicional de RCC.10.7.a.
- **RCC.10.11** — Mientras la campaña esté cerrada a medias, la pantalla deberá decirlo junto a la fecha de la foto
  e indicar qué faltaba al momento del cierre.
- **RCC.10.8** — Si el invocador no puede cerrar ni reabrir (por rol), entonces la pantalla no deberá ofrecer esas
  acciones.
- **RCC.10.9** — El sistema deberá respetar tokens (ADR-023), formato es-AR y anti-recorte de descendentes
  (`lineHeight` matcheado) en todos los textos nuevos.
- **RCC.10.10** — El sistema no deberá romper el render de las secciones existentes de la pantalla de reportes
  (preñez, parición, destete, CCL, cruce con nacimientos, peso por categoría, alertas y sesiones).

## RCC.11 — Re-seed de "La Facundina" — D2

- **RCC.11.1** — El sistema deberá borrar íntegramente los datos del establecimiento
  `fac00000-face-4000-a000-000000000010` (animales, perfiles, eventos, sesiones, lotes, configuraciones y rodeos)
  antes de regenerarlo, y no deberá tocar el establecimiento "Santo Domingo" del mismo usuario.
- **RCC.11.2** — El re-seed deberá escribir `entry_date` explícito en cada perfil, anterior al inicio del servicio
  de la campaña más vieja que se quiera reportar, para que la membresía histórica sembrada por el trigger sea
  correcta.
- **RCC.11.3** — El re-seed deberá retrodatar el `changed_at` de las filas iniciales de `animal_category_history` de
  los perfiles sembrados a su `entry_date`, para que la categoría histórica no dependa de la degradación de RCC.2.7.
- **RCC.11.4** — El re-seed deberá dejar **una campaña con el ciclo completo (servicio → parición → destete) y
  cerrada** y **una campaña posterior en curso** en cada rodeo del campo demo.
- **RCC.11.5** — El cierre del re-seed deberá ejecutarse invocando `close_campaign` con la identidad del owner del
  campo, y no insertando filas de snapshot a mano.
- **RCC.11.6** — El re-seed deberá verificarse leyendo `rodeo_campaign_status` de ambas campañas y comprobando que
  los KPI congelados coinciden con los que devolvía la lectura en vivo inmediatamente antes del cierre.
- **RCC.11.7** — El re-seed deberá impersonar al owner fijando el rol y los claims juntos (`set local role
  authenticated` además de `set local request.jwt.claims`) **únicamente durante el paso de cierre de campañas**,
  y deberá ejecutar el borrado y el sembrado como `service_role`, porque `authenticated` no tiene privilegio de
  `delete` sobre las tablas que el re-seed borra.
- **RCC.11.8** — El re-seed deberá ejecutarse dentro de **una** transacción y deberá abortar antes del primer
  borrado si (a) el conjunto de `establishment_id` alcanzados por los `where` no tiene cardinalidad 1, o (b) los
  conteos de perfiles y eventos se desvían de la magnitud esperada del campo demo.
- **RCC.11.9** — El re-seed deberá verificar, antes del primer borrado, que el archivo de backup existe, pesa más
  de cero y contiene filas del `establishment_id` que se va a borrar.
- **RCC.11.10** — El sistema deberá permitir cerrar más de una campaña dentro de la misma transacción sin fallar
  por objetos temporales ya existentes.

## RCC.12 — Lo que no se puede romper (regresiones)

- **RCC.12.1** — El sistema deberá seguir contando en los KPI reproductivos un `tacto` cargado **sin jornada**
  (`session_id is null`).
- **RCC.12.2** — Ninguna de las siete funciones de campaña deberá referenciar `session_id` en su cuerpo.
- **RCC.12.3** — El sistema no deberá modificar las cinco RPC sin `p_year` (`session_event_summary`,
  `rodeo_sessions_list`, `rodeo_weight_by_category`, `establishment_overdue_doses`, `establishment_unweighed`).
- **RCC.12.4** — El sistema no deberá modificar `rodeo_service_campaign` ni `transfer_animal`.
- **RCC.12.5** — El sistema deberá seguir devolviendo `serviced = 0` sin dividir ni producir `NaN` cuando no hay
  hembras servidas.
- **RCC.12.6** — Cuando se pide una campaña de un año en el que ningún animal del rodeo estaba presente, el sistema
  deberá devolver `serviced = 0` (el año deja de ser decorativo).

## RCC.13 — Tests (oráculos)

- **RCC.13.1** — El sistema deberá incluir un test de **inmutabilidad**: cerrar una campaña que arranca en
  `serviced 3 / pregnant 3 / empty 0`, `calved 1`, `ccl total 3`, `nacimientos total 1`, `pending_weaning 1`;
  aplicarle las cuatro mutaciones del probe (tacto de la campaña siguiente, venta, transferencia de rodeo, y cambio
  de categoría con veredicto `no_apta` posterior); y exigir que los cinco KPI queden idénticos dígito a dígito.
- **RCC.13.2** — El sistema deberá incluir el **contrafactual del snapshot**: la misma campaña **sin cerrar**,
  con un tacto que cae **dentro** de la ventana de la campaña, deberá mover el número; la cerrada, no.
- **RCC.13.3** — El sistema deberá incluir el **contrafactual del cómputo histórico**: sobre una campaña abierta, la
  venta, la transferencia de rodeo y el cambio de categoría posteriores a la fecha de corte no deberán mover ningún
  KPI (que es exactamente la fuga que se tapa), y el test deberá afirmarlo explícitamente para que un falso positivo
  del test de inmutabilidad no pase inadvertido.
- **RCC.13.4** — El sistema deberá incluir tests del cómputo histórico **antes** del cierre: un animal vendido,
  movido o recategorizado después del cierre de la ventana deberá dar el número de entonces; un animal que entró al
  rodeo después de la fecha de corte no deberá contar; un animal que salió antes de la fecha de corte no deberá
  contar.
- **RCC.13.5** — El sistema deberá incluir tests de authz de las tres RPC nuevas: owner de otro campo → `42501`;
  `field_operator` del propio campo → `42501` en `close_campaign`/`reopen_campaign` y éxito en
  `rodeo_campaign_status`; `veterinarian` del propio campo → éxito en las tres.
- **RCC.13.5.a** — El sistema deberá incluir un test de aislamiento cross-tenant **con la campaña CERRADA**: un
  owner de otro establecimiento invocando las funciones de campaña sobre un rodeo ajeno cuya campaña tiene
  snapshot vigente deberá recibir `42501`, y en ningún caso filas del snapshot ni de su detalle.
- **RCC.13.5.b** — El sistema deberá incluir un test de que la cota de `p_year` sigue devolviendo `22023` **aunque
  exista un snapshot vigente** para ese `(rodeo, año)`, sembrando por `service_role` un snapshot en un año que la
  cota de las RPC rechaza pero el `CHECK` de la tabla admite, y deberá ejecutarlo sobre **el mismo conjunto de
  funciones descubierto** que usa RCC.13.5.a, no sobre una función de ejemplo.
- **RCC.13.5.c** — El sistema deberá incluir tests de que `close_campaign` y `reopen_campaign` devuelven `42501`
  (a) para un owner cuyo `user_roles.active` es falso, y (b) para un owner de un establecimiento con `deleted_at`
  no nulo; y de que `rodeo_campaign_status` los rechaza igual.
- **RCC.13.5.c.i** — El sistema deberá documentar, en el propio test, que el caso (b) de RCC.13.5.c **no puede
  fallar hoy** porque el estado que describe es inalcanzable (los roles se desactivan al borrar el
  establecimiento y no se pueden reactivar), y que el caso se conserva porque pasa a ser verificador real cuando
  exista el flujo de restablecimiento de un establecimiento borrado.
- **RCC.13.5.d** — El sistema deberá incluir un guard de catálogo (no textual) que verifique, leyendo `pg_proc`,
  que `is_owner_or_vet_of` es `security definer`, `stable` y tiene `search_path` fijado; y que las funciones del
  delta tienen la volatilidad que les corresponde (las de lectura `stable`, `close_campaign` y `reopen_campaign`
  **no** `stable`), con `search_path` fijado en todas.
  > **Reconciliación as-built (2026-08-07, `design` §15 R5)**: `prosecdef` se exige en las **15 funciones del
  > delta que tocan datos**; `search_path`, en **las 18**. Las tres puras (`campaign_tacto_bounds`,
  > `campaign_cycle_complete`, `campaign_missing_summary`) **no** son `SECURITY DEFINER` por diseño (§3.2 /
  > §4.1-bis) y están revocadas de los tres roles: exigirles `definer` habría contradicho al propio design.
- **RCC.13.5.e** — El sistema deberá **descubrir** en tiempo de test, desde el catálogo, el conjunto de funciones
  de campaña ejecutables por `authenticated` con firma `(uuid, integer)` y aplicarle a **cada una** el test de
  RCC.13.5.a, en vez de enumerarlas a mano; y deberá fallar si el conjunto descubierto es menor que el conjunto
  conocido al escribir la spec. Una función de campaña nueva deberá entrar al test sin que nadie la agregue.
  > **Reconciliación as-built (2026-08-07, `design` §15 R3)**: la firma se resuelve con
  > `oidvectortypes(p.proargtypes)`, **no** con `pg_get_function_identity_arguments`. Medido contra el remoto,
  > la segunda devuelve `"p_rodeo_id uuid, p_year integer"` (con los nombres de los parámetros) → el
  > descubrimiento daba **0** funciones y el oráculo no se ejecutaba nunca.
- **RCC.13.6** — El sistema deberá incluir tests de grants: `anon`/`public` no ejecutan ninguna de las funciones
  nuevas, y `authenticated` no ejecuta las funciones internas.
- **RCC.13.6.a** — El sistema deberá incluir un test de que un cliente `authenticated` con rol activo no puede
  `insert`, `update` ni `delete` en `rodeo_membership_history`, `rodeo_campaign_snapshots` ni
  `rodeo_campaign_snapshot_animals` —ni siquiera sobre filas de su propio establecimiento—, incluyendo un intento
  de `insert` con el `establishment_id` de otro tenant, y de que las policies de las tres tablas son
  exclusivamente de `select`.
- **RCC.13.6.b** — El sistema deberá incluir un assert de invariante sobre **toda** fila de
  `rodeo_campaign_snapshots`: su `establishment_id` deberá ser igual al `establishment_id` del `rodeos` al que
  apunta su `rodeo_id`. Es el eslabón que la clave foránea compuesta no cubre (esa ata detalle↔cabecera; este
  ata cabecera↔rodeo).
- **RCC.13.7** — El sistema deberá incluir tests de la historia de membresía: apertura al insertar, cierre y
  apertura al mover, cierre al dar de baja, invariante de una sola fila vigente, e idempotencia del backfill.
- **RCC.13.8** — El sistema deberá incluir un test de DL10: tras cerrar, insertar un evento de la campaña no deberá
  fallar, no deberá mover los KPI, y deberá encender `has_new_data`.
- **RCC.13.9** — El sistema deberá incluir un test de idempotencia y de reapertura: cerrar dos veces devuelve el
  mismo snapshot; reabrir con la campaña siguiente cerrada falla con `23514`; reabrir y volver a cerrar crea un
  snapshot nuevo y deja el anterior con `reopened_at`.
- **RCC.13.9.a** — El sistema deberá incluir un test del cierre incompleto: con el ciclo incompleto y sin
  reconocimiento, la llamada falla con `23514` y el mensaje nombra lo que falta; con reconocimiento, cierra; el
  snapshot resultante queda marcado como cerrado a medias con su descriptor, y `rodeo_campaign_status` lo expone.
- **RCC.13.9.b** — El sistema deberá incluir un test de que una campaña con el ciclo **completo** cierra sin
  necesidad de reconocimiento y no queda marcada como cerrada a medias.
- **RCC.13.9.c** — El sistema deberá incluir un test de que el predicado de "ciclo completo" que usa
  `close_campaign` y el que devuelve `rodeo_campaign_status` coinciden en el mismo escenario.
- **RCC.13.10** — El sistema deberá incluir un guard **case-insensitive** que falle si `rodeo_membership_history`,
  `rodeo_campaign_snapshots` o `rodeo_campaign_snapshot_animals` aparecen en `sync-streams/rafaq.yaml`.
- **RCC.13.13** — El sistema deberá incluir un test de que apuntar el `rodeo_id` de un perfil a un rodeo de otro
  establecimiento es rechazado por la base con `23514`, de modo que `rodeo_membership_history.rodeo_id` nunca pueda
  contener un par perfil/rodeo cruzado entre establecimientos.
- **RCC.13.11** — El sistema deberá incluir el test de regresión de RCC.12.1 y el guard de RCC.12.2.
- **RCC.13.12** — El sistema deberá incluir un test de que `close_campaign` no muta filas de animales ni de eventos.

## RCC.14 — Gate 2.5 (capture, ADR-029)

- **RCC.14.1** — El sistema deberá incluir `app/e2e/captures/campanas-congeladas.capture.ts` con capturas nombradas
  de, como mínimo: campaña **en curso**, campaña **cerrada** con su fecha, campaña cerrada con **datos nuevos sin
  reflejar**, la confirmación de cierre, y la sugerencia de cierre por ciclo completo.
- **RCC.14.2** — El capture deberá verificar anti-recorte de descendentes en los textos nuevos con descendentes
  ("Campaña cerrada", "Cerrar campaña", "Reabrir campaña", "Hay datos nuevos sin reflejar").

---

## Historial de refinamiento

| Fecha | Qué cambió | Origen |
|---|---|---|
| 2026-08-07 | Redacción inicial del delta desde `context-campanas-congeladas.md` (Gate 0 aprobado). | `spec_author` |
| 2026-08-07 | **F8 / DP-10 reescrito.** El leader objetó que la precondición de cierre original (solo "el servicio terminó") dejaba abierto para el usuario real exactamente el modo de falla que DP-22 identifica para la demo: congelar `%parición`/`%destete` en 0 para siempre. Se agrega `p_acknowledge_incomplete` a `close_campaign` (error imposible por accidente, posible a propósito), el predicado de ciclo completo pasa a tener un único dueño compartido con `rodeo_campaign_status`, y el reconocimiento queda **persistido** en el snapshot. Nuevos: RCC.4.11, RCC.5.7.a–d, RCC.5.10.a, RCC.7.7, RCC.10.7.a/b, RCC.10.11, RCC.13.9.a–c. Modificados: RCC.5.1, RCC.5.7. | Leader (objeción pre-Gate 1) |
| 2026-08-07 | **Gate 1 FAIL (3 HIGH + 6 MEDIUM) — arreglos aplicados.** Los tres HIGH eran de la misma clase: invariantes sostenidos en prosa, sin oráculo. **H-1** (el cortocircuito agrega 7 salidas tempranas y la suite es estructuralmente ciega a ellas porque todos los IDOR existentes corren con campañas abiertas) → RCC.13.5.a/b/e. **H-2** (la procedencia del `establishment_id` de las 2 tablas de snapshot no estaba fijada y la premisa "no hay escritura del cliente" no se testeaba) → RCC.4.8.a/b + RCC.13.6.a. **H-3** (`is_owner_or_vet_of` sin caso de rol revocado ni de campo borrado) → RCC.13.5.c/d. MEDIUM: RCC.9.2 (`pg_temp`), RCC.9.5/9.6 (lista blanca + barrido), RCC.9.10/9.11 (costo real + piso de años), RCC.9.12 (`member_name`), RCC.5.7.e (año sin campaña), RCC.11.7–11.10 (re-seed blindado), RCC.13.10 (case-insensitive), RCC.13.13. | Gate 1 + leader |
| 2026-08-07 | **Gate 1 PASS (2ª pasada).** Los 3 HIGH quedaron cerrados con oráculos que saben fallar; M-1 fue **retirado** por el propio informe (la premisa sobre `rodeo_id` era falsa). La re-auditoría trajo **6 findings introducidos por los arreglos**, todos aplicados: **N-1** (el runbook moría en su primer `delete`: `authenticated` no tiene `DELETE` → la impersonación se acota al paso de cierre, RCC.11.7); **N-2** (el barrido excluía la lista blanca por construcción → `close_campaign` nacía `EXECUTE`-able por `PUBLIC`; dos loops sobre la misma enumeración, RCC.9.6.a); **N-3** (`can_close` no reflejaba el gate `serviced = 0` → la UI entrenaba a clickear el reconocimiento de DP-10, RCC.7.6.a); **N-4** (TR.14f(b) es inalcanzable por `0076`: se rotula en vez de borrarse o contarse como cobertura, RCC.13.5.c.i); **N-5** (el oráculo de la cota corre sobre las 9 descubiertas, RCC.13.5.b); **N-6** (el tenant de la cabecera se cierra por test, no por constraint: asimetría declarada, RCC.13.6.b). | Gate 1 (2ª pasada) + leader |
| 2026-08-07 | **Corrección de una premisa FALSA del informe de Gate 1** (verificada contra el remoto por el leader): M-1 afirmaba que `animal_profiles.rodeo_id` no tiene CHECK ni trigger de mismo-establecimiento. **Sí lo tiene**: `tg_animal_profiles_rodeo_check` (`0021:25-43`) rechaza con `23514` un rodeo de otro establecimiento o inactivo, y `tg_animal_profiles_rodeo_same_system_check` (`0047`) cubre el cruce de sistemas. No se agregó ningún requisito defensivo apoyado en esa premisa; la corrección de §5.6 se escribió con el motivo correcto y citando el trigger. | Leader (verificación en el remoto) |
| 2026-08-07 | **Veto visual del Gate 2.5** (`implementer`). Tres arreglos de jerarquía, ninguno de dominio: (1) tras el rechazo del server la hoja dejaba como **primario** el botón que estaba garantizado que volvía a fallar, al lado del reconocimiento y con el mismo comienzo de label — los controles pasan a salir de la función pura `campaignCloseActions`, que garantiza que con `acknowledgeAvailable` **no queda ningún primario** y el intento fallido desaparece; (2) "Reabrir campaña" era el elemento interactivo más grande de una campaña cerrada (la jerarquía contradecía al texto: una foto se lee, no se deshace) → acción de texto con target ≥40 dp; (3) borde duplicado en el aviso + **contraste medido** (detalle 5,58:1, título 17,86:1, aviso 17,06:1 — todos AA), con el capture midiéndolo de ahora en más. | `implementer` + Gate 2.5 |
| 2026-08-07 | **Segundo fix-loop** (`implementer`), tras **Gate 2 PASS** + reviewer con un 🟡. **RR-1**: el "arreglo" del M-C2 (barrer por `oid`) era un **no-op demostrable** —los `oid` salían de seleccionar por `proname`— y el comentario afirmaba lo contrario; la lista blanca pasa a enumerar **FIRMAS** resueltas con `to_regprocedure`, y el mutante de la sobrecarga lo mide (0 detecciones por nombre vs 3 por firma). **⚪**: §2.4 deja de prometer de más — el `40001` garantiza identidad de **conteo**, no de conjunto ni cabecera↔cabecera. Y **se refutó por medición una premisa que las dos puertas dieron por verificada**: una función nueva **SÍ** nace `EXECUTE`-able por `PUBLIC` (`proacl = NULL`), así que los `revoke` de las 7 internas son load-bearing y el hueco del typo era de **exposición**. Los 3 bloques `DO` del smoke-check validados contra el catálogo real. | `implementer` |
| 2026-08-07 | **Fix-loop de la Puerta 2** (`implementer`), tras **reviewer CHANGES_REQUESTED** + **Gate 2 FAIL**. Bloqueante de seguridad (H-C1): las 3 tablas nacían con `TRUNCATE` para `anon`/`authenticated` por el `pg_default_acl` del schema —condición general de las 35 tablas de `public`, no del delta— y el `comment on column` lo **negaba por escrito** nombrando como guard a un test que no podía verlo → `revoke all` explícito + assert de ACL crudo + comentario corregido. Del reviewer: **H-1** (el oráculo de `campaignStateView(null)` asserteaba la afirmación que su nombre negaba, y con el anti-parpadeo la barra conservaba la etiqueta de otra campaña al cambiar de año → estado `desconocido` + resultado etiquetado por clave + test reescrito, RCC.10.2.a), **H-2** (`entry_date` propagado a la otra suite consumidora + el comentario falso de TPS.15), **H-3** (la rama `ai_females` sin oráculo → TR.13(g) + `source='ai'` en TR.20), **H-4** (RCC.4.7 pasa a verificarse antes del commit con `40001`), **H-5** (tercer loop del smoke-check), **H-6/H-7** (RCC.5.11, RCC.10.4, RCC.4.6/7.2, RCC.9.12, RCC.9.8 y RCC.11.10 cerrados con oráculo; RCC.1.13 y los de UI declarados como límite). MEDIUM del Gate 2: publicación `FOR ALL TABLES` declarada, barrido por `oid`, premisa del `EXECUTE a PUBLIC` corregida. Detalle en `design` §15-bis y §15.2. | `implementer` + reviewer + Gate 2 |
| 2026-08-07 | **Implementación + reconciliación as-built** (`implementer`). Las 4 migraciones, la suite (TR.12–TR.21) y el frontend quedaron escritos; **nada se aplicó al remoto** (lo hace el leader en T73). La implementación encontró **tres defectos de esta spec al ejecutarla**, todos corregidos y documentados en `design` §15: (R1) la lista blanca del smoke-check tenía 11 entradas y el barrido `rodeo\_%` alcanza también a `rodeo_sessions_list`/`rodeo_weight_by_category` → **las migraciones abortaban**; (R3) el descubrimiento de TR.21 usaba `pg_get_function_identity_arguments`, que devuelve los **nombres** de los parámetros → descubría **0** funciones y los dos oráculos de Gate 1 H-1 **no se ejecutaban nunca**; (R6) los fixtures de la suite no escribían `entry_date`, así que TR.4b/TR.11 se ponían rojas post-apply por el calendario. Otras 8 reconciliaciones menores (R2, R4, R5, R7–R11) en la misma tabla. Notas bajo RCC.9.6.a, RCC.13.5.d y RCC.13.5.e. | `implementer` |
| 2026-08-07 | **RCC.10.6 (cierre masivo por campo) confirmado DENTRO del delta** — sale de la tabla de pendientes de `design` §12. Fundamento del leader: DL1 ya lo prometió y es la mitigación directa del riesgo más alto de la feature ("el productor nunca cierra"). DP-11 (N llamadas del cliente, sin RPC de establecimiento) se mantiene. | Leader (decisión) |
</content>
</invoke>
