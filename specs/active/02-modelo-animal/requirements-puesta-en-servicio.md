# Spec 02 — Stream A: modelo de puesta en servicio (delta backend) — Requirements (EARS)

**Status**: `spec_ready` (pendiente **Gate 1 OBLIGATORIO** + Puerta 1). Delta backend sobre spec 02 base; **no** reabre `requirements.md` base ni las deltas previas (tier2, cut-ficha, c6).
**Fecha**: 2026-06-23 (sesión de cierre del modelo reproductivo).
**Autor**: spec_author.
**Fuente de verdad**: `docs/modelo-reproductivo-puesta-en-servicio.md` (Gate 0 aprobado por Raf/Facundo, Puerta 1 2026-06-23) — secciones §1, §2, §3, §6, §8 (Stream A). El **dominio** (servicio rodeo-level, categoría ≠ elegibilidad, gestación 284 única, aptitud = veredicto del vet) viene **firme** de ese doc; acá **no se re-decide** — se traduce a EARS/design/tasks.
**Insumo de dominio**: `specs/active/07-reportes-basicos/research-kpis-cria.md` (denominador Bavera, distribución CCL).

> **Notación EARS** (`docs/specs.md`): Ubicuo "El sistema deberá…", Evento "Cuando…, el sistema deberá…", Estado "Mientras…, el sistema deberá…", Opcional "Donde…, el sistema deberá…", No deseado "Si…, entonces el sistema deberá…". **IDs estables, no reordenar tras aprobar. Cada `R<n>` verificable por ≥1 test.**

> **Numeración**: este delta usa el prefijo **`RPS.x`** (Requirements Puesta en Servicio) para **no colisionar** con la spec 02 base (`R1`..`R14`), el delta Tier 2 (`RT2.x`), el delta CUT (`RCUT.x`) ni C6 (`RC6.x`). Toda referencia `R<n>`/`RT2.<n>` sin prefijo `RPS` apunta a esas specs.

---

## Resumen del delta

El Gate 0 reformuló cómo se representa la **puesta en servicio**: el servicio natural deja de cargarse vaca-por-vaca y se modela a **nivel rodeo** (qué meses ese rodeo hace servicio). Stream A es el **delta backend fundacional** (A → B → C) y entrega cuatro cosas:

1. **Config `service_months` por rodeo** (schema + validación + default + camino offline) — NO existe en el repo (verificado 2026-06-23: 0 ocurrencias en `supabase/migrations/`, `app/src/`, commits). El **selector de UI** en el wizard de alta es Stream B; acá solo el sustrato de datos.
2. **Reconciliar `compute_category`**: quitar la dependencia del evento `service` (backstop `servicio→vaquillona`). El destete + los cortes de edad ya cubren ternera→vaquillona.
3. **`heifer_fitness` a 3 estados** (APTA / NO_APTA / DIFERIDA): **verificación** — el enum `heifer_fitness_result` del as-built (`0053`) **ya** tiene los 3 valores. Este delta lo **fija como contrato** y documenta la semántica de DIFERIDA; no cambia el schema.
4. **Contrato de derivación `servidas`/`entoradas`**: el denominador reproductivo que consume Stream C (reportes), tenant-scoped, derivado de `service_months` + membresía del rodeo (servicio natural) ∪ hembras con evento de IA (per-vaca, intacto).

**Decisiones del Gate 0 que NO se re-discuten** (cerradas por Raf/Facundo): servicio = nivel rodeo (la maniobra manual de servicio se deprecia en Stream B); categoría ≠ elegibilidad reproductiva; gestación = 284 días única (parametrización por raza = POST-MVP); aptitud = solo veredicto del vet (sin cálculo de 66%); catálogo de razas con datos agronómicos = POST-MVP.

---

## RPS.1 — Columna `service_months` por rodeo (schema)

> Gate 0 §6, §8 Stream A. El **shape** (array vs bitmask) lo resuelve el design (decisión propia del spec_author, justificada). El **selector de UI** del wizard es Stream B.

**RPS.1.1** El sistema deberá modelar, sobre cada rodeo (`public.rodeos`), una configuración `service_months` que represente el conjunto de meses calendario (1 = enero … 12 = diciembre) en los que ese rodeo realiza servicio.

**RPS.1.2** El sistema deberá permitir que `service_months` sea **NULL** (rodeo "sin configurar"), distinto de un conjunto **vacío** (rodeo que explícitamente no hace servicio). NULL y vacío deberán ser semánticamente distinguibles a nivel dato.

**RPS.1.3** El sistema deberá rechazar, a nivel de base de datos (CHECK autoritativo server-side, no solo cliente), cualquier valor de `service_months` que contenga un mes fuera del rango entero 1–12.

**RPS.1.4** El sistema deberá rechazar, a nivel de base de datos, cualquier `service_months` con **meses duplicados** (cada mes aparece a lo sumo una vez): el conjunto es de elementos únicos.

**RPS.1.5** El sistema deberá acotar, a nivel de base de datos, la **cardinalidad** de `service_months` a un máximo de 12 elementos (no se puede declarar más meses que los 12 del año) — capa autoritativa contra input abusivo (regla INPUT-1, espejo de `0070`).

**RPS.1.6** Donde un rodeo de cría se cree sin especificar `service_months`, el sistema deberá aplicar el **default de primavera** = `{10, 11, 12}` (Oct/Nov/Dic) — el caso dominante en cría, para no fricciona el alta (Gate 0 §6).

**RPS.1.7** El sistema deberá permitir editar `service_months` después de creado el rodeo (es editable, Gate 0 §6), respetando RPS.1.3–RPS.1.5 en cada edición.

**RPS.1.8** El sistema **no** deberá imponer ni alterar `service_months` por ningún trigger de transición de categoría ni por ningún evento de animal: `service_months` es config del rodeo, ortogonal a la categoría/lote/rodeo de cada animal (regla maestra de los 3 ejes, spec 02 base).

## RPS.2 — Backfill de rodeos existentes

> Gate 0 §6: "Rodeos existentes sin config → los KPIs reproductivos invitan a configurarla (o asumen el default). A definir en la spec." Decisión del spec_author: ver design §3 (NULL = sin configurar, no se backfillea con default para no inventar campañas que el productor no declaró).

**RPS.2.1** El sistema **no** deberá modificar `service_months` de los rodeos ya existentes al aplicar este delta: los rodeos creados antes del delta quedan con `service_months = NULL` ("sin configurar"), no con el default.

**RPS.2.2** El sistema deberá tratar un rodeo con `service_months = NULL` como "sin ventana de servicio configurada" en el contrato de derivación (RPS.5): un rodeo NULL **no** aporta servidas por servicio natural (no se asume el default en la derivación — se asume solo en el **alta** de un rodeo nuevo, RPS.1.6).

**RPS.2.3** El contrato de derivación (RPS.5) deberá exponer, de forma consultable por Stream C, si un rodeo está "sin configurar" (`service_months IS NULL`), para que la UI de reportes pueda invitar a configurarlo (Gate 0 §6, §7 "degradar con gracia").

## RPS.3 — Camino de escritura de `service_months` (offline-first + RLS)

> El alta/edición de rodeo ya es offline vía RPC (`create_rodeo` 0081 / `set_rodeo_config` 0082). `service_months` debe entrar por ese mismo camino para no romper offline-first ni el modelo de seguridad (owner-only, anti-IDOR por derivación). El **disparo desde la UI** (selector de meses) es Stream B; acá el contrato server-side.

**RPS.3.1** Cuando se crea un rodeo vía la RPC de alta (`create_rodeo`), el sistema deberá aceptar un parámetro opcional de `service_months` y persistirlo en el rodeo creado; si el parámetro se omite, deberá aplicar el default de primavera (RPS.1.6).

**RPS.3.2** El sistema deberá ofrecer un camino de **edición** de `service_months` de un rodeo existente que funcione **offline** (idempotente, drenable desde la outbox de PowerSync, mismo patrón que `set_rodeo_config`), sin requerir conexión al momento de la edición.

**RPS.3.3** El sistema deberá autorizar la escritura de `service_months` (alta y edición) como **owner-only** del establecimiento del rodeo (espeja `rodeos_insert`/`rodeos_update` = `is_owner_of`, `0017`): un `field_operator`/`veterinarian` o un usuario sin rol en el campo **no** deberá poder escribir `service_months`.

**RPS.3.4** Si la escritura de `service_months` llega por una RPC `SECURITY DEFINER`, entonces el sistema deberá derivar el establecimiento del **rodeo objetivo** (no confiarlo de un parámetro) para el chequeo de autorización, de modo que un `rodeo_id`/`establishment_id` de otro tenant resulte en rechazo (anti-IDOR por construcción, patrón `set_rodeo_config` 0082).

**RPS.3.5** El sistema deberá re-aplicar la validación RPS.1.3–RPS.1.5 dentro de la RPC (no solo confiar en el CHECK de columna): un valor inválido deberá ser rechazado con un error accionable antes de persistir.

**RPS.3.6** El sistema deberá garantizar que la escritura de `service_months` por RPC es **idempotente**: re-aplicar el mismo valor (replay at-least-once de la outbox) deja el rodeo en el mismo estado (no-op), sin efectos colaterales.

## RPS.4 — Reconciliación de `compute_category`: quitar la dependencia del evento `service`

> Gate 0 §2.1: el backstop `servicio→vaquillona` se ELIMINA (el destete es la vía canónica ternera→vaquillona; los cortes de edad cubren "se olvidaron de destetar"). **As-built verificado** (`0062`): la rama hembra usa `v_has_weaning OR v_has_service OR (edad ≥ 365)` → `vaquillona`. El corte de edad hembra **ya existe** (`0062` + cron `0066`). Las transiciones grandes (tacto+→preñada, parto→vaca, aborto-revierte, castración) **NO** dependen de `service` → el ripple es chico.

**RPS.4.1** El sistema **no** deberá usar la existencia de un evento reproductivo `service` como disparador para transicionar una hembra a `vaquillona` en `compute_category`: la rama que hoy evalúa `has_service` deberá dejar de hacerlo (eliminar el término `v_has_service` de la condición de `vaquillona`).

**RPS.4.2** El sistema deberá conservar, en `compute_category`, la transición ternera→`vaquillona` por **destete** (`has_weaning`) y por **corte de edad** (edad ≥ 365 días con `birth_date` conocido): tras quitar `service`, una hembra con destete cargado, o de ≥ 1 año con fecha conocida, deberá seguir computando `vaquillona`.

**RPS.4.3** El sistema deberá conservar **sin cambios** las transiciones que NO dependen de `service`: tacto+ vigente → `vaquillona_prenada` (RT2.4.3), 1 parto → `vaca_segundo_servicio` (RT2.4.2), ≥ 2 partos → `multipara` (RT2.4.1), aborto revierte el tacto+ vigente (RT2.7.5), y la rama macho completa (`ternero`/`torito`/`toro`/`novillito`/`novillo`, cortes 1 y 2 años, castración). La **precedencia LOAD-BEARING** de ramas de `0062` no deberá reordenarse.

**RPS.4.4** El sistema deberá conservar el corte de edad hembra ternera→`vaquillona` como **red de seguridad** para el caso "se olvidaron de destetar": deberá existir (a) la rama `edad ≥ 365 → vaquillona` dentro de `compute_category` y (b) el job nocturno targeted (`refresh_age_categories`, `0066`) que materializa ese corte para hembras `ternera` cuya categoría guardada quedó atrás de su edad. **(As-built: ambas ya existen; este requirement las fija como contrato y exige el test que prueba que siguen vigentes tras quitar `service`.)**

**RPS.4.5** Si en la base de datos existen eventos `service` históricos ya cargados (servicio manual de la maniobra que Stream B deprecará), entonces el sistema **no** deberá borrarlos ni alterarlos: quedan como historial visible en el timeline (`animal_timeline` no filtra por tipo), pero **dejan de influir** en la categoría computada. Un recálculo (on-event o on-recompute) de un perfil con un `service` histórico deberá computar la **misma** categoría que computaría sin ese evento.

**RPS.4.6** El sistema deberá preservar las propiedades de seguridad de `compute_category` al reescribirla: `SECURITY DEFINER STABLE`, `set search_path = public`, derivación de todo dato del `profile_id` recibido (sin leer/escribir otro tenant, RT2.12.3), y el grant existente `execute … to authenticated` (sin abrir nuevos grants). Su contrato de retorno (`uuid` del `category_id`) **no** deberá cambiar.

**RPS.4.7** El sistema deberá mantener la **consistencia incremental ↔ recompute** (RT2.10.1): como el trigger incremental (`0063`) delega en `compute_category` y el recálculo on-change (`0046`/`0063`) también, quitar `service` de `compute_category` deberá quedar reflejado en **ambos** caminos por construcción (una sola fuente de verdad). El sistema **no** deberá dejar una regla `service` viva en el trigger incremental que diverja de `compute_category`.

**RPS.4.8** El sistema deberá dejar **documentado** (en el design, reconciliación al as-built) el efecto sobre la **inseminación artificial**: la IA se almacena como `reproductive_events` con `event_type='service'` y `service_type='ai'` (as-built `0054`, `local-reads.ts`). Tras RPS.4.1, una IA cargada sobre una hembra `ternera` **dejará** de promoverla a `vaquillona` por el solo evento (lo hará el destete o el corte de edad, o la elegibilidad reproductiva de RPS.5, que es independiente de la categoría — Gate 0 §2). Este efecto es intencional (categoría ≠ elegibilidad) y **debe** estar cubierto por un test.

## RPS.5 — Contrato de derivación de `servidas` / `entoradas` (denominador reproductivo)

> Gate 0 §1, §2, §8 Stream A + §7 ("Entoradas = entraron a servicio − retiradas"). Define **el denominador** que Stream C (reportes) consumirá. El spec_author propone la forma técnica más limpia y segura (vista/función SQL tenant-scoped) — ver design §5.

**RPS.5.1** El sistema deberá exponer un contrato consultable (vista o función SQL, ver design) que, para un rodeo y una **campaña de servicio**, derive el conjunto de **servidas** = (a) los vientres del rodeo presentes durante la ventana de servicio (servicio natural, derivado de `service_months` + membresía del rodeo) ∪ (b) las hembras con un evento de **inseminación** registrado (IA, `reproductive_events` con `event_type='service'` AND `service_type='ai'`, no borrado), en la misma campaña.

**RPS.5.2** El sistema deberá definir "vientre presente en la ventana de servicio" (rama servicio natural de RPS.5.1) como una hembra **activa** del rodeo **elegible reproductivamente**, distinguiendo dos grupos: **(a) probadamente servidas** — cuya categoría ya prueba que fueron servidas (`vaquillona_prenada`, `vaca_segundo_servicio`, `multipara`, `vaca_cabana`) → elegibles **sin** gate de aptitud; **(b) `vaquillona` sin diagnosticar** → elegible solo si **apta** (último `heifer_fitness='apta'`, RPS.5.3) o, en su defecto, por el **fallback por edad** (RPS.5.4). La elegibilidad **no** deberá depender de la categoría sola sino de la aptitud + la ventana (Gate 0 §2); en particular, **una vaquillona que concibió (`vaquillona_prenada`) NO deberá salir del denominador por el solo hecho de diagnosticarse preñada** (regresión detectada en el veto del leader 2026-06-23: contar solo `vaquillona` excluía a la `vaquillona_prenada` → inflaba %preñez de 1er servicio). [`cut` queda fuera del set incondicional por ahora — TENTATIVO, design §5.2.]

**RPS.5.3** El sistema deberá derivar la **aptitud** de una vaquillona del último veredicto `heifer_fitness` registrado (evento `tacto_vaquillona`, `0053`): una vaquillona con último veredicto **APTA** cuenta como elegible; con **NO_APTA** o **DIFERIDA** vigente **no** cuenta por aptitud (sí podría contar por el fallback por edad de RPS.5.4 si el campo no hace el chequeo — la regla de precedencia se define en design §5).

**RPS.5.4** Donde un rodeo **no** registre el chequeo de aptitud de sus vaquillonas (sin eventos `tacto_vaquillona`), el sistema deberá aplicar el **fallback por edad** (Gate 0 §3): "vaquillona de edad de servicio en rodeo con ventana activa = servida" — para no dejar fuera del denominador a las vaquillonas de un campo que no tactea aptitud.

**RPS.5.5** El sistema deberá computar **entoradas = servidas − retiradas**, donde "retiradas" son las hembras que entraron a servicio pero salieron antes/durante la campaña (baja por venta/muerte/transferencia — `animal_profiles.status` ≠ `active` o baja con `exit_reason`, dentro de la ventana). La definición exacta de la ventana temporal de "retirada" se fija en design §5 (Gate 0 §7, convención Bavera).

**RPS.5.6** El sistema deberá scopear el contrato de derivación por **tenant**: toda lectura deberá estar filtrada por el `establishment_id` del rodeo, respetando la RLS existente (`rodeos_select` = `has_role_in(establishment_id)`; `reproductive_events_select` derivado de `establishment_of_profile`). Si el contrato se implementa como función `SECURITY DEFINER`, entonces deberá autorizar al caller contra el establecimiento del rodeo (sin IDOR cross-tenant) y revocar la superficie RPC de roles que no la necesiten (patrón `0066`/`0042`).

**RPS.5.7** El sistema **no** deberá contar dos veces a una hembra que esté en ambas ramas (vientre presente en la ventana **y** con IA registrada en la campaña): el conjunto `servidas` es una **unión** (distinct por `animal_profile_id`), no una suma.

**RPS.5.8** El sistema deberá derivar la **campaña de servicio** de un rodeo a partir de `service_months` + el año calendario (una campaña = la corrida de meses de servicio de un año dado), de modo que Stream C pueda pedir el denominador "de esta campaña". El mapeo concreto mes→campaña (incluido el caso de servicio que cruza fin de año, ej. Dic→Ene) se fija en design §5.

**RPS.5.9** El contrato de derivación deberá ser **read-only** (no muta `animal_profiles` ni `reproductive_events`): es un cómputo de denominador para reportes, no un write-path. No deberá depender de ninguna columna materializada nueva sobre los animales (se deriva on-read de `service_months` + membresía + eventos).

**RPS.5.10** El sistema deberá validar `p_year` con una **cota autoritativa en el SQL** de las tres funciones de derivación (no solo en la prosa del design), aplicada **después** del guard de tenant: un `p_year` fuera de un rango razonable (`1900 ≤ p_year ≤ año_actual + 1`) deberá ser rechazado con error accionable, de modo que `make_date(p_year, …)` no reciba años absurdos. *(Gate 1 MEDIUM-1, 2026-06-23 — el listón INPUT-1 exige que la cota esté en el contrato, no como decisión suelta del implementer.)*

## RPS.6 — `heifer_fitness` a 3 estados (verificación de contrato)

> Gate 0 §3 + §8 Stream A. **As-built verificado** (`0053`): el enum `heifer_fitness_result` **ya** es `('apta','no_apta','diferida')` y la columna `reproductive_events.heifer_fitness` existe; los tests as-built (`supabase/tests/maneuvers/run.cjs`) ya ejercen APTA y NO_APTA. Este delta **fija el contrato** y la semántica; **no** cambia el schema (es verificación, no ALTER).

**RPS.6.1** El sistema deberá reconocer exactamente tres veredictos de aptitud de vaquillona: **APTA** (`'apta'`), **NO_APTA** (`'no_apta'`) y **DIFERIDA** (`'diferida'`), almacenados en `reproductive_events.heifer_fitness` (enum `heifer_fitness_result`, `0053`) cuando `event_type='tacto_vaquillona'`.

**RPS.6.2** El sistema deberá tratar **DIFERIDA** con la semántica del Gate 0: "no apta **todavía**, no se descarta, se re-evalúa más adelante" — distinta de NO_APTA (rechazada). Una vaquillona DIFERIDA **no** cuenta como apta para el denominador (RPS.5.3) pero **no** se marca como descarte (no se la saca del padrón ni se la transiciona a CUT por el veredicto).

**RPS.6.3** El sistema **no** deberá derivar `category_id` del veredicto `heifer_fitness`: la aptitud es elegibilidad reproductiva (gatea el denominador de RPS.5), **no** categoría (Gate 0 §2). Un veredicto APTA/NO_APTA/DIFERIDA **no** deberá disparar ninguna transición de categoría.

**RPS.6.4** El sistema deberá rechazar (a nivel enum/DB) cualquier valor de `heifer_fitness` distinto de los tres del enum: el contrato es cerrado (verificable insertando un cuarto valor → error de enum).

## RPS.7 — Seguridad, multi-tenant y reconciliación (transversal)

**RPS.7.1** El sistema deberá mantener el aislamiento **multi-tenant** en todo el delta: `service_months` se escribe solo por el owner del establecimiento del rodeo (RPS.3.3); la derivación de RPS.5 se lee solo dentro del tenant (RPS.5.6); `compute_category` reescrita no lee ni escribe otro tenant (RPS.4.6).

**RPS.7.2** El sistema deberá numerar toda migración de este delta en **≥ 0102** (el as-built en disco llega a `0101`), sin pisar ninguna migración existente, y **no** deberá aplicarse al remoto en este chunk (el deploy lo gatea el leader tras Gate 1 + Gate 2).

**RPS.7.3** El sistema deberá dejar **reconciliado** el design con el as-built de spec 02: cada función/tabla/trigger que se toca (`compute_category` `0062`, `rodeos` `0017`, `create_rodeo` `0081`, `set_rodeo_config` `0082`, el trigger incremental `0063`, el recálculo `0046`, el cron `0066`, el enum `0053`) deberá estar **citado** en el design, sin contradecir el comportamiento aplicado.

**RPS.7.4** El sistema deberá registrar como **dependencia** (no como requirement implementado en este chunk) la alineación del **espejo client-side** `computeCategoryCode` (`app/src/utils/animal-category.ts`, C6): tras quitar `service` de `compute_category`, el espejo (que hoy usa `hasService` en su rama `vaquillona`) deberá quitar ese término para preservar la invariante anti-drift (RC6.5). Esa alineación es **frontend** → la ejecuta Stream B o un slice de C6, no este delta backend; acá queda anotada para que el leader no la pierda.

**RPS.7.5** Si Gate 1 (`security_analyzer` modo `spec`) emite findings, entonces el sistema deberá reflejarlos en esta spec (reconciliación, sección "Historial de refinamiento") antes de pasar a la Puerta 1, preservando los IDs `RPS.x` ya asignados.

---

## Trazabilidad Gate 0 (`docs/modelo-reproductivo-puesta-en-servicio.md`) → requirement

| Sección / decisión del Gate 0 | Requirement(s) |
|---|---|
| §1 — servicio a nivel rodeo (deja de cargarse per-vaca) | RPS.1, RPS.5.1 (rama natural) |
| §1 — `servidas` = vientres en ventana ∪ IA per-vaca (IA intacta) | RPS.5.1, RPS.5.7, RPS.4.8 |
| §2 — categoría ≠ elegibilidad reproductiva | RPS.5.2, RPS.6.3, RPS.4.8 |
| §2.1 — eliminar backstop `servicio→vaquillona` | RPS.4.1, RPS.4.5 |
| §2.1 — corte de edad hembra ternera→vaquillona (verificar/agregar) | RPS.4.4 (verificado: ya existe en `0062`+`0066`) |
| §3 — aptitud APTA/NO_APTA/DIFERIDA (3 estados) | RPS.6 (verificado: ya existe en `0053`) |
| §3 — DIFERIDA = no apta todavía, no se descarta | RPS.6.2 |
| §3 — aptitud gatea el denominador, no la categoría | RPS.5.3, RPS.6.3 |
| §3 — fallback por edad si el campo no chequea aptitud | RPS.5.4 |
| §6 — config `service_months` (selector 12 meses), default primavera, editable | RPS.1.1, RPS.1.6, RPS.1.7 |
| §6 — rodeos existentes sin config | RPS.2 |
| §7 — "Entoradas = entraron a servicio − retiradas" | RPS.5.5 |
| §7 — degradar con gracia (sin configurar / primer año) | RPS.2.3, RPS.5.8 |
| §8 Stream A — backend deployado → Gate 1 obligatorio | RPS.7.1, RPS.7.2, RPS.7.3, RPS.7.5 |
| §5 (gestación 284 única) / §7 (razas POST-MVP) — fuera de alcance | (no se modela: ver "Fuera de alcance") |

## Fuera de alcance (Stream A) — explícito

- **Selector de UI de los 12 meses** en el wizard de alta/edición de rodeo → **Stream B** (RPS.1 entrega solo el sustrato de datos + RPC).
- **Deprecación de la maniobra de servicio manual** (sacar el flujo de carga per-vaca de spec 03) → **Stream B**. Acá solo el impacto backend: `compute_category` deja de depender de `service` (RPS.4); dejan de crearse eventos `service` naturales por la UI (lo hace Stream B).
- **Reportes reproductivos** (%preñez, %parición, distribución CCL, cruce tacto↔nacimientos) → **spec 07 / Stream C** (consume el denominador de RPS.5).
- **Bucketing CCL / tacto configurable / captura de peso en aptitud** → **Stream B/C** (provisional, espera input de Facundo §9 del Gate 0).
- **Gestación parametrizada por raza** y **catálogo de razas con datos agronómicos** → **POST-MVP** (Gate 0 §5, §7).
- **Cálculo del 66% del peso adulto** para la aptitud → **POST-MVP** (Gate 0 §3; en MVP el vet pondera el peso al dar el veredicto).
- **Alineación del espejo client-side `computeCategoryCode`** → frontend (RPS.7.4, dependencia anotada).

## Cobertura de tests (cada RPS verificable)

- **DB/RLS (runners Node nativos, `supabase/tests/...`)** — CHECK de `service_months` rechaza mes <1/>12 (RPS.1.3), duplicados (RPS.1.4), >12 elementos (RPS.1.5); NULL vs vacío distinguibles (RPS.1.2); default primavera en alta sin param (RPS.1.6); edición offline-idempotente owner-only + anti-IDOR cross-tenant (RPS.3.2–RPS.3.6); `compute_category` sin `service`: hembra con solo `service` → NO `vaquillona` por ese evento (RPS.4.1/RPS.4.5/RPS.4.8), con destete → `vaquillona` (RPS.4.2), ≥1 año → `vaquillona` por edad (RPS.4.4), tacto+/parto/aborto/castración intactos (RPS.4.3), recompute con `service` histórico = sin él (RPS.4.5); cron `refresh_age_categories` materializa ternera@365→vaquillona (RPS.4.4); derivación `servidas`/`entoradas` por campaña, unión distinct (RPS.5.7), **`vaquillona_prenada` cuenta como servida y no sale al diagnosticarse preñada (RPS.5.2 — fix del veto)**, aptitud APTA cuenta / NO_APTA-DIFERIDA no (RPS.5.3), fallback por edad (RPS.5.4), entoradas = servidas − retiradas (RPS.5.5), tenant-scoped sin IDOR (RPS.5.6), read-only (RPS.5.9); enum `heifer_fitness` 3 valores + rechazo de 4º (RPS.6.1/RPS.6.4), DIFERIDA no descarta ni categoriza (RPS.6.2/RPS.6.3).
- **Gate 1 (security_analyzer modo spec)** — audita: owner-only + anti-IDOR de la escritura de `service_months`; SECURITY DEFINER de la derivación de RPS.5 (revoke/grants, IDOR, input cota server-side); que `compute_category` reescrita no rompa grants/revokes ni search_path; multi-tenant en toda lectura/escritura.

## Historial de refinamiento

- 2026-06-23 — Redacción inicial del delta Stream A desde `docs/modelo-reproductivo-puesta-en-servicio.md` (Gate 0 aprobado Raf/Facundo, Puerta 1 2026-06-23). IDs nuevos `RPS.n` (no tocan los IDs estables de spec 02 base ni de las deltas previas). **Hallazgos del spec_author al leer el as-built** (no re-decisiones de dominio): (1) el corte de edad hembra ternera→vaquillona **ya existe** (`0062` + cron `0066`) → RPS.4.4 lo fija como contrato, no lo agrega; (2) el enum `heifer_fitness_result` **ya** tiene los 3 estados (`0053`) → RPS.6 es verificación, no ALTER; (3) la IA se almacena como `service`+`ai` (`0054`) → RPS.4.8 documenta el efecto de quitar `service` de `compute_category` sobre la IA. Pendiente Gate 1 (OBLIGATORIO, backend deployado) + Puerta 1.
- 2026-06-23 (**veto del leader, pre-Gate-1**) — FIX de correctitud: el denominador `rodeo_serviced_females` (RPS.5.2 / design §5.2) excluía `vaquillona_prenada` → una vaquillona de 1er servicio que concebía **salía** del denominador al diagnosticarse preñada (el mismo animal entra vacía y sale preñada → infla %preñez/%parición de 1er servicio). Reconciliado: las categorías **probadamente servidas** (`vaquillona_prenada`/`vaca_segundo_servicio`/`multipara`/`vaca_cabana`) cuentan **sin gate**; el gate de aptitud/edad queda solo para la `vaquillona` pelada (RPS.5.2, design §5.2 SQL + comentario, nota de cobertura de tests). + Agregada **nota de regresión de datos** al deploy de `0104` (design §4): el recompute no es automático; único caso de reversión = hembra <365d con `service`/IA sin destete → el implementer consulta el remoto y decide recompute targeted vs lazy. + `cut` marcado TENTATIVO (design §5.2). IDs `RPS.x` preservados.
- 2026-06-23 (**Gate 1 — `security_analyzer` modo spec — PASS, 0 HIGH** — `progress/security_spec_02-puesta-en-servicio.md`): el delta no debilita el backend deployado (reusa los patrones ya validados `0081`/`0082` anti-IDOR, `0066`/`0042` revoke+smoke-check, `0054` helper revocado, `0070` INPUT-1, `0062` SECURITY DEFINER); el analyzer verificó contra disco. **1 MEDIUM foldeado** → **RPS.5.10**: la cota de `p_year` estaba solo en la prosa del design → bajada al SQL de las 3 funciones (tras el guard de tenant) + test. **3 LOW anotados** (no son huecos de seguridad): (L1) `rodeo_serviced_females` podría leer la identidad denormalizada (`0079`) en vez de `animals` global → consideración del implementer; (L2) clasificación de `23514` en la outbox de la edición de `service_months` → Stream B; (L3) drift transitorio del espejo client-side → ya cubierto por RPS.7.4. IDs `RPS.x` preservados. **Gate 1 cerrado → listo para Puerta 2 (humana).**
