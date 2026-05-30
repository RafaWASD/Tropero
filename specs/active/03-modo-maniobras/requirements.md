# Spec 03 — MODO MANIOBRAS — Requirements (EARS)

**Status**: `spec_ready` (pendiente Gate 1 `security_analyzer` modo `spec` + aprobación humana).
**Fecha**: 2026-05-30 (sesión 18).
**Autor**: spec_author.
**Fuente de verdad**: `specs/active/03-modo-maniobras/context.md` (Gate 0 aprobado por Raf 2026-05-28, + refinamiento de edge cases s18). Cada "Caso y decisión" del context queda cubierto por ≥1 `R<n>` (ver mapa de cobertura al final).
**Related**: spec 02 (sustrato: eventos tipados, `rodeo_data_config`, `management_groups`, triggers de transición, `animal_timeline`, RLS), spec 09 (find-or-create + `useBusyMode`), spec 04 (bastón BLE), spec 05 (balanza BLE), ADR-021 (gating doble capa), ADR-020 (lote = `management_groups`), ADR-017 (timeline append-only), ADR-008 (transiciones), ADR-019 (security gates), ADR-016 (rodeo/sistema), ADR-022 (Gate 0).

> **Notación EARS** (`docs/specs.md`): Ubicuo "El sistema deberá…", Evento "Cuando…, el sistema deberá…", Estado "Mientras…, el sistema deberá…", Opcional "Donde…, el sistema deberá…", No deseado "Si…, entonces el sistema deberá…". IDs estables, no reordenar tras aprobar. Cada `R<n>` verificable por ≥1 test.

> **Nomenclatura de modelo (corrige una ambigüedad de la decomposición original).** Siguiendo `context.md` (Gate 0) y la spec 02 as-built, hay **dos conceptos distintos** que NO deben confundirse:
> - **Sesión de maniobra** (`sessions`, entidad NUEVA de este spec): la jornada de manga. Un dispositivo = una sesión a la vez. Agrupa los eventos cargados en esa jornada (`session_id`), habilita resumen/reanudación/auditoría. **NO es un "lote".**
> - **Lote** (`management_groups`, ya existe en spec 02, ADR-020): tercer eje de organización del animal, **per-animal, manual, nunca auto-asignado por la sesión** (decisión de Raf en context §Lote: una jornada puede tocar 2 lotes). Spec 03 NO crea una tabla `batches`; usa `management_groups`. Ver conflictos C1/C2/C3 al final y "Decisiones abiertas" en `design.md`.

> **Madurez por capa**: los requirements de **backend** (US-1/US-2 schema, US-7 gating DB, US-11 seguridad) son firmes (sustrato spec 02 as-built). Los requirements de **cliente** (US-3 BLE, US-4 identidad/find-or-create, US-5 carga rápida UI, US-10 offline UI, US-12 UX) son **provisionales** hasta que aterricen specs 04/05/09 y se reconcilien (Gate 0 §Aprobación).

---

## US-1 — Iniciar una sesión de maniobra (wizard de jornada)

> Como operario (peón, vet o productor), quiero configurar una jornada de manga eligiendo el rodeo, las maniobras y sus parámetros fijos, para arrancar la carga rápida con los defaults ya puestos. (context §Sesión, §Las 10 maniobras, §Presets, D1)

**R1.1** El sistema deberá permitir iniciar una **sesión de maniobra** asociada a **exactamente un rodeo** del establecimiento activo, elegido al iniciar. (context: "Una sesión = un rodeo.")

**R1.2** Cuando el operario inicia una sesión, el sistema deberá ofrecer un wizard de configuración de jornada de **tres etapas**: (1) elegir el rodeo, (2) elegir las maniobras a realizar + sus parámetros fijos de la tanda, (3) revisar el resumen y arrancar la carga rápida. (context D1)

**R1.3** Mientras se elige el rodeo de la sesión (etapa 1), el sistema deberá ofrecer **solo rodeos activos** del establecimiento activo (`active = true` y `deleted_at IS NULL`).

**R1.4** Cuando el operario está en la etapa 2 (elegir maniobras), el sistema deberá ofrecer **solo las maniobras cuyos `data_key(s)` requeridos están `enabled = true`** en el `rodeo_data_config` del rodeo de la sesión, según el mapeo hardcodeado de ADR-021 / spec 02 R2.7 (gating UI, capa 1). (context §Las 10 maniobras "Gating UI")

**R1.5** Si una maniobra tiene alguno de sus `data_key(s)` requeridos `enabled = false` en el rodeo de la sesión, entonces el sistema **no deberá** ofrecer esa maniobra en la etapa 2 (gating UI). (context §Las 10 maniobras "Gating UI")

**R1.6** El sistema deberá soportar las **10 maniobras** del MVP cría: tacto vaca, tacto vaquillona, sangrado, vacunación, inseminación, condición corporal, dientes, pesaje, raspado de toros, pesaje de ternero — con el mapeo maniobra→`data_keys` de spec 02 R2.7 (ver R5.4). (context §Las 10 maniobras)

**R1.7** Cuando el operario selecciona maniobras con parámetros fijos de tanda (p. ej. la(s) vacuna(s) de la jornada, la pajuela por defecto, el destino de muestra), el sistema deberá permitir **pre-configurar esos parámetros una sola vez** y aplicarlos como defaults en cada animal de la sesión. (context D1 etapa 2; D2 "campos pre-cargados con defaults de la config")

**R1.8** Donde la maniobra admite **texto libre con autocompletar de valores usados antes** (vacuna, pajuela), el sistema deberá ofrecer autocompletar a partir de los valores previamente cargados por el establecimiento, sin requerir un catálogo de stock. (context §Vacunación, §Inseminación: "texto libre + autocompletar … sin stock")

**R1.9** Cuando el operario confirma el resumen de configuración (etapa 3), el sistema deberá **persistir la sesión** (`status` activa) y entrar a la pantalla de carga rápida.

**R1.10** El sistema deberá modelar la sesión como **entidad persistida** con, como mínimo: identidad, `establishment_id`, `rodeo_id`, operario/creador, fecha de inicio, maniobras elegidas + su pre-config (snapshot), `status` y timestamps de auditoría. (context §Sesión: "`sessions` es entidad persistida (tabla nueva)")

**R1.11** El sistema deberá generar el identificador de la sesión **del lado del cliente** (UUID) para que la sesión pueda crearse y operar **offline** antes de sincronizar. (context §Offline-first; ADR-012 IDs cliente)

---

## US-2 — Presets de maniobra

> Como operario que repite jornadas parecidas, quiero guardar y reusar combinaciones de maniobras + pre-config, para no reconfigurar la jornada cada vez. (context §Presets)

**R2.1** El sistema deberá permitir guardar una **combinación de maniobras + su pre-config** como **preset** con un nombre. (context §Presets)

**R2.2** Cuando el operario inicia MODO MANIOBRAS, el sistema deberá mostrar los presets disponibles **al tope** de la pantalla de inicio. (context §Presets)

**R2.3** Cuando un preset incluye una maniobra cuyo(s) `data_key(s)` requeridos están `enabled = false` en el rodeo elegido, el sistema deberá **filtrar (no ofrecer) esa maniobra** y **avisar** al operario que se omitió por la configuración del rodeo, sin bloquear el uso del resto del preset. (context §Presets: "esa maniobra se filtra … y se avisa")

**R2.4** El sistema deberá definir el **scope del preset por establishment** (compartido por los usuarios del establecimiento). (context §Presets: "default sugerido por establishment (lo confirma spec_author)" — confirmado por establishment; ver "Decisiones abiertas" D7 para escalar a por-usuario si Raf lo prefiere)

**R2.5** El sistema deberá generar el identificador del preset **del lado del cliente** (UUID) y permitir su uso **offline**. (context §Offline-first)

---

## US-3 — Identificación del animal en la manga (dual: BLE + manual)

> Como operario en el cepo, quiero identificar al animal con el bastón BLE o a mano, para empezar a cargar sin trabarme aunque falle el hardware. (context §Alta en manga, §Postura BLE, D3; CONTEXT/05)

**R3.1** El sistema deberá permitir identificar al animal de la sesión por **dos puertas**: (a) lectura del bastón BLE (caravana electrónica → `tag_electronic`), y (b) búsqueda manual por `idv` o `visual_id_alt`. (context §Postura BLE "manual-first"; D3)

**R3.2** Mientras MODO MANIOBRAS está activo, el sistema deberá **suspender el listener BLE global** de spec 09 (`useBusyMode`) y manejar el escaneo del bastón **dentro del propio modo**. (context §Alta en manga: "MODO MANIOBRAS suspende el listener BLE global")

**R3.3** Cuando el bastón BLE emite una lectura, el sistema deberá parsear la caravana electrónica como `tag_electronic` (ISO 11784/11785, 15 dígitos, prefijo país; ver design) y resolver el `animal` por `tag_electronic` (match exacto global, scope del establecimiento activo — spec 02 R5.1). (context D3; CONTEXT/05)

**R3.4** Cuando entra una lectura BLE válida, el sistema deberá dar **feedback inmediato** al operario (visual + sonido/vibración) confirmando que "la lectura entró". (context: "vibración táctil"; CONTEXT/05 "feedback claro")

**R3.5** El sistema deberá permitir, en cualquier momento de la sesión, **identificar manualmente** al animal por búsqueda de `idv` (match exacto, scope establecimiento — spec 02 R5.2) o `visual_id_alt` (fuzzy ≥ 0.3 — spec 02 R5.3). (context §Postura BLE "manual-first"; D3)

**R3.6** Si el bastón BLE se desconecta o pierde batería durante la sesión, entonces el sistema deberá **caer a identificación manual sin perder la sesión en curso** ni los datos ya cargados. (context §4 edge "pérdida de batería del bastón → fallback a manual sin perder sesión")

**R3.7** Si el bastón BLE vuelve a estar disponible tras una desconexión, entonces el sistema deberá **reconectarse automáticamente** y retomar la lectura, sin requerir reiniciar la sesión. (context §Postura BLE; CONTEXT/05 "reconexión automática")

**R3.8** El sistema deberá exponer el bastón como una **interfaz abstracta** (`StickReader`) agnóstica al modelo de hardware, con implementaciones por modelo, de modo que la sesión funcione aunque el modelo exacto del bastón aún no esté confirmado. (CONTEXT/05 "diseño agnóstico al modelo"; ver "Decisiones abiertas" D6 sobre bastones con balanza integrada)

---

## US-4 — Desambiguación de identidad y alta en manga (find-or-create)

> Como operario, cuando el animal no existe o su caravana visual está duplicada, quiero resolverlo en el momento sin frenar la fila. (context §Alta en manga, §4 edge cases, refinamiento s18)

**R4.1** Cuando el `tag_electronic` (BLE) o el `idv`/`visual_id_alt` (manual) no corresponde a ningún `animal_profile` activo del establecimiento, el sistema deberá disparar el **find-or-create de spec 09 inline**: alta rápida con el identificador **precargado y no editable** + el **rodeo de la sesión** + form dinámico por sistema, y al confirmar deberá continuar el wizard de maniobras para ese animal. (context §Alta en manga "TAG/IDV desconocido → find-or-create inline"; D3)

**R4.2** Si la búsqueda **manual** por `visual_id_alt` devuelve **más de un** `animal_profile` candidato (caravana visual duplicada), entonces el sistema deberá **avisar y ofrecer desambiguar** mostrando los candidatos para que el operario elija el correcto, sin crear un duplicado. (context §4 edge "caravana visual duplicada → manual → avisar y desambiguar")

**R4.3** Cuando la identificación es por **BLE** y la caravana visual estaría duplicada, el sistema deberá **desempatar automáticamente por `tag_electronic`** (el chip es único global, spec 02 R3.2), resolviendo al animal exacto sin pedir desambiguación. (context §4 edge "caravana visual duplicada → BLE desempata por SENASA ID")

**R4.4** Cuando el animal identificado pertenece a **otro rodeo del mismo establecimiento y mismo sistema productivo** que el de la sesión, el sistema deberá **avisar** y ofrecer dos acciones: **[pasar el animal a este rodeo]** (UPDATE de `animal_profiles.rodeo_id`, validado por el trigger de mismo-sistema de spec 02 R4.5.1) o **[saltarlo]**. El sistema **no deberá** cargar eventos sobre ese animal con el gating de la sesión hasta que se lo haya movido al rodeo de la sesión. Al ofrecer [pasar a este rodeo], el sistema deberá mostrar el rodeo de origen del animal en la confirmación (p. ej. "vas a sacar este animal de <rodeo origen>"), para evitar movimientos a ciegas. (context §Sesión "Animal de otro rodeo escaneado"; refinamiento s18 #1; hardening del leader s18)

**R4.5** Si el animal identificado pertenece a **otro establecimiento**, entonces el sistema deberá **avisar** ("este animal está en el campo X"), **saltarlo** (no frenar la manga) y **sugerir** transferirlo después de terminar las maniobras (la transferencia con re-parenting es la feature 11, fuera de esta sesión). (context refinamiento s18 #4)

**R4.6** Cuando el find-or-create da de alta un `animal` nuevo en la manga, el sistema deberá respetar el `establishment_id` activo y los constraints de unicidad de identificador de spec 02 (`tag_electronic` global R3.2; `(establishment_id, idv)` R4.3), y registrar la autoría con `created_by` **forzado server-side** a `auth.uid()` (spec 02 fold Tier 1). (ADR-019; context §Alta en manga)

**R4.7** Si una proporción alta de los primeros animales identificados en la jornada (umbral configurable, default los primeros 3 consecutivos) pertenecen todos a un mismo rodeo distinto al de la sesión, entonces el sistema deberá advertir que el rodeo de la jornada podría estar mal elegido y ofrecer **cambiar el rodeo de la sesión** en vez de mover los animales uno por uno. (Prevención de error — heurística Nielsen #5; hardening del leader sobre R4.4.)

---

## US-5 — Carga rápida animal-por-animal (gating por rodeo real)

> Como operario en el cepo, quiero ver la identidad del animal y solo los campos que aplican, con defaults puestos, y confirmar en 1-3 taps para pasar al siguiente. (context D2, D4, §Las 10 maniobras)

**R5.1** Cuando un animal queda identificado en la sesión, el sistema deberá mostrar una **pantalla de carga rápida** con: identidad del animal (`tag_electronic` / `idv` / `visual_id_alt`), su **rodeo** y su **categoría**, y los campos de las maniobras de la sesión **pre-cargados con los defaults** de la config. (context D2)

**R5.2** El sistema deberá presentar el wizard **una maniobra por pantalla** (una decisión por pantalla), con **botones grandes (60-80 px), alto contraste y vibración táctil**, para operar con guantes/barro a velocidad de manga. (context: "wizard pantalla-por-maniobra (botones 60-80px, una decisión por pantalla, alto contraste, vibración táctil)")

**R5.3** El sistema deberá resolver el gating **por el rodeo REAL del animal** (no por el pre-filtro de la sesión): por cada animal el sistema resuelve el rodeo real del animal vía `animal_profiles.rodeo_id` del **perfil activo** (no por una función `current_animal_rodeo` — esa función NO existe as-built; ver `design.md` §4 SEC-SPEC-03-02) y, por cada maniobra de la sesión, resuelve los `data_keys` requeridos contra el `rodeo_data_config` de ese rodeo real. (ADR-021; context D4 "gating se recalcula por rodeo REAL, no por pre-filtro")

**R5.4** El sistema deberá usar el siguiente **mapeo maniobra → `data_keys` requeridos** (hardcodeado, ADR-021 / spec 02 R2.7):

| Maniobra | `data_keys` requeridos (`enabled = true`) | Destino de escritura (spec 02) |
|---|---|---|
| Tacto vaca | `prenez` Y `tamano_prenez` | `reproductive_events` (`event_type='tacto'`, `pregnancy_status`) |
| Tacto vaquillona | `tacto_vaquillona` | `reproductive_events` (`event_type='tacto_vaquillona'`, `heifer_fitness` — ver R5.13) |
| Sangrado (brucelosis) | `brucelosis` | `lab_samples` (`sample_type='blood'`) |
| Vacunación | `vacunacion` | `sanitary_events` (`event_type='vaccination'`) |
| Inseminación | `inseminacion` | `reproductive_events` (`event_type='service'`, `service_type` IA) |
| Condición corporal | `condicion_corporal` | `condition_score_events` |
| Dientes | `dientes` | **propiedad** `animal_profiles.teeth_state` (no evento) |
| Pesaje | `peso` | `weight_events` |
| Raspado de toros | `raspado_toros` | `lab_samples` ×2 (`scrape_tricho` + `scrape_campylo`) |
| Pesaje de ternero | `peso` | `weight_events` (autocompleta categoría ternero/ternera) |

**R5.5** Cuando para un animal una maniobra de la sesión **no aplica** (su(s) `data_key(s)` no están `enabled` en el rodeo real), el sistema deberá **omitir esa maniobra/campo** para ese animal y seguir con las demás. (context §4 edge "evento no aplica → omitir campo"; D4)

**R5.6** Para cada maniobra que sí aplica, el sistema deberá distinguir **campos requeridos vs opcionales** leyendo el `rodeo_data_config` del rodeo real (no por una función `get_rodeo_data_keys`, que NO existe as-built; ver `design.md` §3 SEC-SPEC-03-02): si el rodeo no tiene filas de config habilitadas para los `data_key(s)` del evento, el sistema deberá mostrar todos los campos como **no obligatorios**; si las tiene, deberá respetar el flag `required` de cada `data_key`. (ADR-021)

**R5.7** Si al confirmar una maniobra falta un campo **requerido** (gating), entonces el sistema deberá **bloquear la confirmación** de esa maniobra y señalar el campo faltante. (ADR-021; context §Las 10 maniobras)

**R5.8** El sistema deberá **guardar los datos a medida que avanza el wizard** (cada maniobra confirmada persiste su evento), de modo que el resumen sea de **verificación, no de commit**, y un crash no pierda lo ya cargado. (context §Sesión "Los datos se guardan a medida que avanza el wizard"; D2)

**R5.9** Cuando el operario termina las maniobras de un animal, el sistema deberá mostrar una **pantalla resumen** del animal donde puede **corregir** tocando una maniobra antes de pasar al siguiente. (context: "pantalla resumen → confirmás → siguiente animal (o corregís tocando una maniobra del resumen)")

**R5.10** Cuando el operario confirma el resumen del animal, el sistema deberá **avanzar al siguiente animal** y mostrar un **contador de progreso** de la sesión (animales procesados en la jornada). (context D2; cobertura mínima "contador de progreso")

**R5.11** El sistema deberá **vincular cada evento cargado a la sesión** mediante `session_id`, para habilitar resumen de sesión (spec 07), reanudación y auditoría. (context §Sesión "Cada evento cargado lleva `session_id`")

**R5.12** El sistema deberá registrar `created_by = auth.uid()` (por trigger, spec 02 R6.7) en cada evento cargado en la sesión, sin pedirlo al operario.

**R5.13** Donde la maniobra **tacto vaquillona** requiera un resultado `apta | no_apta | diferida` que el enum reproductivo de spec 02 aún no contemple, el sistema deberá **extender el modelo de spec 02 por migración nueva** (sin reabrir spec 02): agregar `event_type='tacto_vaquillona'` al enum `repro_event_type` y un campo de resultado. (context §Las 10 maniobras "Tacto vaquillona … Si el enum repro de spec 02 no lo incluye, spec 03 lo extiende por migration")

---

## US-6 — Comportamiento por maniobra (las 10)

> Como operario, quiero que cada maniobra se cargue con el mínimo de fricción y con las reglas del dominio. (context §Las 10 maniobras)

**R6.1 — Vacunación.** El sistema deberá cargar la vacunación de forma **silenciosa** (✓ inline) y permitir **múltiples vacunas simultáneas**, generando un `sanitary_events` por vacuna con `product_name` tomado de la pre-config (texto libre + autocompletar). (context §Vacunación)

**R6.2 — Tacto vaca.** El sistema deberá registrar el tacto de vaca como `reproductive_events` (`event_type='tacto'`) con `pregnancy_status` (`empty`/`small`/`medium`/`large` = vacía/cabeza/cuerpo/cola), y este evento **deberá poder disparar la transición de categoría** de spec 02 (R7). (context §Tacto vaca)

**R6.3 — Tacto vaquillona.** El sistema deberá registrar el resultado `apta | no_apta | diferida` (ver R5.13). (context §Tacto vaquillona)

**R6.4 — Sangrado (brucelosis).** El sistema deberá capturar el **número de tubo** y crear un `lab_samples` (`sample_type='blood'`) con `tube_number`; el resultado llegará luego por import (spec 06), por lo que `result` queda pendiente. (context §Sangrado)

**R6.5 — Inseminación.** Cuando la inseminación usa **1 pajuela**, el sistema deberá mostrar un popup informativo; cuando hay **>1 pajuela** disponible, deberá ofrecer un **selector**; la pajuela se elige por texto libre + autocompletar (sin stock) y se registra como `reproductive_events`. (context §Inseminación)

**R6.6 — Condición corporal.** El sistema deberá ofrecer un selector **1.00–5.00 con step 0.25** y crear un `condition_score_events`. (context §Condición corporal)

**R6.7 — Dientes.** El sistema deberá tratar dientes como **propiedad** que **sobrescribe** `animal_profiles.teeth_state` (reusa el sustrato de spec 02; **no** es evento con historial). (context §Dientes)

**R6.8 — Dientes / prompt CUT.** Cuando el estado dentario cargado es `1/2`, `1/4` o `sin_dientes`, el sistema deberá **mostrar el prompt CUT**; si el operario confirma, deberá aplicar la transición a CUT de spec 02 (UPDATE explícito `is_cut = true`, `category_id = (CUT del sistema)`, `category_override = true`). El sistema **no deberá** mostrar el prompt CUT para terneros. (El prompt CUT dispara para `1/2`, `1/4`, `sin_dientes` y NO para `3/4`; umbral a validar con Facundo.) Si se **desmarca** `is_cut` (corrección), el sistema deberá **revertir** `category_id` y `category_override` de forma consistente (invariante de app; el gate capa 2 permite el cambio sustractivo, ver R7.5/D8). (context §Dientes "Prompt CUT … vive ACÁ … No para terneros")

**R6.9 — Pesaje.** El sistema deberá permitir cargar el peso **manual o por balanza BLE** (spec 05) y crear un `weight_events`; como el animal ya está identificado, el peso se **adjunta al animal actual** sin la ventana de correlación de spec 05. El peso por balanza BLE deberá capturarse mediante una **acción explícita de "pesar"** sobre el animal que está en el cepo (no de forma pasiva de un stream de la balanza), para no adjudicar una lectura con lag al animal equivocado. (context §Pesaje)

**R6.10 — Pesaje de ternero.** El sistema deberá comportarse igual que pesaje adulto y **autocompletar la categoría ternero/ternera**; el vínculo con la madre proviene del `reproductive_events.calf_id` del nacimiento (no se re-captura acá). (context §Pesaje de ternero; Pendientes: peso al pie vs destete tipados = post-MVP)

**R6.11 — Raspado de toros.** El sistema deberá capturar **dos números de tubo** (tricomoniasis + campylobacteriosis) y crear **dos** `lab_samples` (`scrape_tricho` + `scrape_campylo`). (context §Raspado de toros)

**R6.12 — Raspado de toros / solo machos.** Si en una sesión con raspado se identifica una **hembra**, entonces el sistema deberá **saltar la maniobra de raspado** para ese animal (el resto de las maniobras de la sesión sí corren). (context §Raspado de toros "Solo para machos")

---

## US-7 — Gating en la capa de escritura (capa 2, DB)

> Como sistema multi-tenant orientado a analytics, quiero rechazar a nivel DB cualquier evento gateado cuyo `data_key` no esté habilitado en el rodeo del animal, como defensa en profundidad sobre la UI. (ADR-021; context §Las 10 maniobras "Gating DB")

**R7.1** El sistema deberá implementar, en **cada tabla de evento gateada**, un trigger `BEFORE INSERT` que valide que el `rodeo_data_config` del rodeo **del animal** (resuelto **inline** vía `animal_profiles.rodeo_id` del perfil activo — NO vía `current_animal_rodeo`, que no existe as-built; ver `design.md` §4 SEC-SPEC-03-02) tiene **`enabled = true`** el/los `data_key(s)` requeridos por el tipo de evento, y **rechace el insert** si no. (context §Las 10 maniobras "Gating DB"; ADR-021 capa 2)

**R7.2** Si un `data_key` requerido por una maniobra **no matchea** una columna/clave real esperada (riesgo de binding documentado en ADR-021), entonces el sistema deberá **fallar de forma explícita y verificable** en la capa de escritura (no silenciosa), de modo que un test detecte el desalineamiento `data_key`↔destino. (ADR-021 riesgo documentado; cobertura mínima "binding data_key↔columna")

**R7.3** El sistema deberá garantizar que el gating de capa 2 (DB) opera **independientemente** de la capa 1 (UI): un INSERT directo (p. ej. PostgREST, sync) de un evento gateado sobre un rodeo sin el `data_key` habilitado deberá ser **rechazado** aunque la UI nunca lo hubiera ofrecido. (ADR-021 defensa en profundidad)

**R7.4** El sistema deberá hacer el gating de capa 2 **tenant-safe**: la validación deberá leer el `rodeo_data_config` derivado del `animal_profile` del evento, sin exponer ni cruzar configuración de otro establecimiento. (ADR-019)

**R7.5** El sistema deberá aplicar el gating de capa 2 también al **destino UPDATE** de la maniobra **dientes/CUT** (que NO es un INSERT a tabla de evento sino un `UPDATE` de `animal_profiles.teeth_state` / `is_cut` / `category_id`, R6.7/R6.8), pero **solo para los cambios aditivos** (los que escriben dato): un trigger `BEFORE UPDATE` deberá validar, cuando `teeth_state` cambia a un valor **no-NULL** o `is_cut` cambia **de false a true** (`IS DISTINCT FROM`), que el rodeo del propio perfil tiene `data_key='dientes'` con `enabled = true`, y **rechazar (fail-closed) el UPDATE** si no — aunque la UI nunca lo hubiera ofrecido (defensa en profundidad, paralela a R7.3). El sistema **deberá permitir explícitamente los cambios sustractivos** (limpiar `teeth_state` a NULL, desmarcar `is_cut` a false) sin gatearlos, porque estos no pueden introducir dato prohibido en un rodeo sin `dientes` (solo lo quitan) y por lo tanto no pueden ensuciar analytics. El gating NO deberá dispararse en UPDATE de lote (R9.2) ni de rodeo (R4.4). (ADR-021; `design.md` §4 SEC-SPEC-03-01; **RESUELTO D8 = enforce afinado**)

**R7.6** El sistema deberá hacer el gating de capa 2 **fail-closed**: si el rodeo del animal no se puede resolver (perfil inexistente o `deleted_at IS NOT NULL`), o si falta cualquiera de los `data_key(s)` requeridos `enabled = true`, la validación deberá **levantar excepción (`errcode '23514'`) y rechazar la escritura**. El sistema **no deberá** permitir un early-return que deje pasar la escritura ante un rodeo no resoluble (eso sería fail-open / bypass total del gating). (ADR-021; ADR-019; `design.md` §4 SEC-SPEC-03-03)

---

## US-8 — Transiciones de categoría dentro de la maniobra (ADR-008)

> Como sistema, quiero que un evento de maniobra que implica un cambio de estado biológico actualice la categoría automáticamente y quede en la cronología. (ADR-008; context §Tacto vaca, §Dientes, §4 edge)

**R8.1** Cuando una maniobra registra un evento reproductivo que dispara una transición de categoría (p. ej. tacto positivo sobre vaquillona), el sistema deberá **aplicar la transición automática de spec 02** (trigger `tg_reproductive_events_apply_transition`, R7 de spec 02) salvo `category_override = true`. (ADR-008; spec 02 R7)

**R8.2** El sistema deberá garantizar que la transición de categoría disparada en la maniobra **quede registrada en `animal_category_history`** y, por lo tanto, visible en la cronología del animal (spec 02 R10/R10.3, ADR-017). (ADR-008; spec 02 R6.14/R10.3)

**R8.3** El sistema deberá garantizar que la transición de categoría **no toque** `rodeo_id` ni `management_group_id` del animal (ortogonalidad de los tres ejes, spec 02 R7.7). (ADR-020; spec 02 R7.7)

**R8.4** El sistema deberá ofrecer una **preview de la transición de categoría offline** (reusa `transitions.ts` de spec 02) para que el operario vea el cambio esperado antes de sincronizar. (context §Offline-first "Preview de transición de categoría offline")

> **Nota de alcance (context refinamiento s18 #2/#3):** parto, aborto y destete **NO son maniobras de manga** en este spec — se cargan desde la ficha del animal (spec 09). Solo **tacto** e **inseminación** son maniobras reproductivas del wizard. La **castración no** es maniobra de manga en MVP (queda para feature 10 / "quizás a futuro"). Por eso US-8 acota: el wizard solo dispara transiciones por **tacto**; las demás transiciones llegan por la ficha o por operaciones masivas (feature 10). No se requieren `R<n>` para parto/aborto/destete/castración en este spec.

---

## US-9 — Asignación de lote (opcional, manual)

> Como operario, quiero poder asignar un animal a un lote desde la maniobra si me sirve, sin que la sesión asuma el lote por mí. (context §Lote; ADR-020)

**R9.1** El sistema **no deberá** auto-asignar lote (`management_group_id`) a partir de la sesión bajo ninguna circunstancia (una jornada puede tocar 2 lotes). (context §Lote "NO se auto-asigna desde la sesión"; ADR-020/spec 02 R2.18)

**R9.2** Donde el operario lo decida, el sistema deberá permitir **asignar/cambiar el lote de un animal de forma manual** (`UPDATE animal_profiles.management_group_id`, spec 02 R2.17) desde el wizard de la maniobra o desde la ficha. (context §Lote "per-animal, manual … disponible opcionalmente en el wizard o desde la ficha")

**R9.3** El sistema deberá tratar el lote como **opcional**: si el operario no asigna lote, los eventos quedan vinculados a la sesión (`session_id`) pero el animal conserva su `management_group_id` actual (posiblemente `NULL`). (context §Lote)

**R9.4** Donde la sesión registre un "lote de trabajo", el sistema deberá tratarlo como **metadata informativa no-autoritativa** de la sesión (NO como FK asignadora hacia `management_groups`); la asignación real de lote sigue siendo el UPDATE per-animal de R9.2. (context §Lote: "La sesión puede registrar un lote 'de trabajo' como metadata informativa no-autoritativa, o se omite"; ver "Decisiones abiertas" D3)

---

## US-10 — Offline-first y reanudación

> Como peón sin señal en la manga, quiero que toda la sesión funcione offline y que un cierre accidental no me haga perder la jornada. (context §Offline-first, §Sesión "Reanudación", §4 edge "cierre accidental")

**R10.1** El sistema deberá permitir ejecutar **toda la sesión** (config, identificación manual, carga de las 10 maniobras, asignación de lote) **sin conexión**, encolando la sesión + sus eventos localmente. (context §Offline-first)

**R10.2** El sistema deberá **sincronizar** la sesión y sus eventos vía PowerSync cuando vuelva la conexión, usando los IDs cliente (UUID) generados offline. (context §Offline-first; ADR-012)

**R10.3** El sistema deberá **cachear `rodeo_data_config`** (y `field_definitions`) localmente para resolver el gating capa 1 offline. (context §Offline-first "`rodeo_data_config` cacheado para el gating offline")

**R10.4** El sistema deberá garantizar que **el bastón BLE funciona offline** (Bluetooth directo, no requiere red). (context §Offline-first; D6 del context)

**R10.5** Si la app se cierra de forma accidental con una sesión en curso, entonces el sistema deberá **persistir la sesión en curso** y, al reabrir, **ofrecer retomarla** con los datos ya cargados (resume desde el último animal/maniobra confirmado). (context §Sesión "Reanudación"; §4 edge "cierre accidental → maniobra en curso persiste, al reabrir se ofrece retomar")

**R10.6** El sistema deberá permitir **una sola sesión activa por dispositivo a la vez** (un dispositivo = una maniobra); al intentar iniciar otra con una activa, deberá ofrecer **retomar la activa o cerrarla** primero. (context §Alcance NO "multi-operario simultáneo sobre la misma maniobra (un dispositivo = una maniobra)") (Exclusión de scope consciente; confirmar con el beta de Chascomús que la operación es single-operario.)

**R10.7** El sistema deberá permitir **cerrar la sesión** explícitamente (`status` cerrada), registrando el cierre y dejándola disponible para resumen/auditoría (spec 07). (context §Sesión)

**R10.8** Si un evento cargado offline es **rechazado al sincronizar** (por el gating capa 2 o el tenant-check de `session_id`), entonces el sistema deberá **hacerlo visible al operario** (no descartarlo en silencio), indicando el motivo y ofreciendo un camino para re-resolver, de modo que no se pierda el dato de campo. (Principio offline-first; hardening del leader.)

---

## US-11 — Multi-tenant y seguridad (ADR-019)

> Como producto multi-tenant con datos regulados (SENASA), quiero que ningún camino exponga ni escriba datos cross-tenant. (ADR-019; principio "Multi-tenant desde día 1")

**R11.1** El sistema deberá habilitar **RLS** en toda tabla nueva de este spec (`sessions`, `maneuver_presets`, y cualquier tabla auxiliar) con política de **aislamiento por tenant** patrón canónico: `USING (has_role_in(establishment_id))` y `WITH CHECK (has_role_in(establishment_id))` (helpers de spec 01). (ADR-019)

**R11.2** El sistema deberá registrar en `sessions` el `establishment_id`, el `created_by`/operario y los timestamps de auditoría; `created_by` deberá **forzarse server-side** a `auth.uid()` (no spoofeable desde el payload del cliente), siguiendo el patrón `tg_force_created_by_auth_uid` de spec 02. (ADR-019; spec 02 fold Tier 1)

**R11.3** El sistema **no deberá** permitir que un usuario lea, cree ni modifique una `session` o un `maneuver_preset` de un establecimiento donde no tiene rol activo. (ADR-019)

**R11.4** Donde se proponga una función `SECURITY DEFINER` (p. ej. para resolver el gating de capa 2 o validar tenant de `session_id`), el sistema deberá **validar el `establishment_id` del usuario** dentro de la función y **revocar su EXECUTE de `public`/`authenticated`/`anon`** para que no quede expuesta como RPC público (lección SEC-HIGH-01 de spec 02). (ADR-019)

**R11.5** El sistema deberá tratar los eventos de maniobra como **append-only / corrección por compensación** (ADR-017): la corrección de un evento ya cargado se hace por edición/soft-delete de spec 02 (owner o `created_by`, sin ventana de tiempo para los 5 tipados — spec 02 R6.8.1), **nunca** por escritura cross-tenant. (ADR-017; spec 02 R6.8.1)

**R11.6** El sistema deberá permitir cargar maniobras a **cualquier rol operativo activo** del establecimiento (owner, field_operator, veterinarian) — sin gating por rol dentro de las maniobras. (context §Roles "cualquier rol … Sin gating por rol")

---

## US-12 — UX de campo (no funcionales testeables)

> Como operario que trabaja con una mano, con barro o sangre, quiero velocidad y ergonomía. (context D2; principio "Velocidad operativa por encima de elegancia visual")

**R12.1** El sistema deberá completar la carga de un animal en el **camino feliz** (todas las maniobras con defaults) en **1–3 taps por maniobra** (una decisión por pantalla). (context D2 "mínimos taps (1-3)")

**R12.2** El sistema deberá usar **botones de 60–80 px de lado mínimo** y **alto contraste** en la pantalla de carga rápida. (context: "botones 60-80px … alto contraste")

**R12.3** El sistema deberá dar **feedback táctil (vibración)** en cada confirmación de maniobra y en cada lectura BLE entrante. (context: "vibración táctil")

**R12.4** El sistema deberá mostrar **siempre** la identidad, el rodeo y la categoría del animal actual en la pantalla de carga rápida, para que el operario verifique de un vistazo que está cargando sobre el animal correcto. (context D2)

---

## Conflictos detectados (para Raf / Gate 1)

> Documentados acá porque tocan modelos de otras specs o contradicen la decomposición original. NO los resolví por mi cuenta — propongo un default y marco que requiere confirmación. Detalle + SQL propuesto en `design.md` § "Decisiones abiertas / coordinación".

**C1 — `sessions` + `management_groups` vs el modelo `batches` de la decomposición original.** La decomposición que recibió el spec_author describía una tabla `batches` (`status active/closed/reverted`, `animal_count`, `event_count`, `config` snapshot) + `animal_events.batch_id`, con reversión por eventos compensatorios. Pero el **context.md aprobado (Gate 0)** y la **spec 02 as-built** modelan ADR-020 distinto: el "lote" es `management_groups` (per-animal, manual, **nunca** auto-asignado por la sesión), y la jornada es una entidad **`sessions`** separada (no `batches`). Por jerarquía (context.md = fuente de verdad primaria; ADR-020 ya as-built en spec 02), **se siguió `sessions` + `management_groups`**. Consecuencia: **no hay reversión de lote en este spec** (el lote no nace de la sesión). La corrección de eventos se hace por edición/soft-delete per-evento de spec 02 (R11.5). **Requiere confirmación de Raf**: ¿el "alcance de reversión del MVP" que ADR-020 delegaba a spec 03 se da por **resuelto como "no aplica"**, o Raf quiere igualmente una **reversión a nivel sesión** (deshacer toda una jornada cargada por error)? Default propuesto: **no reversión a nivel sesión en MVP**. Ver D2 en design.

**C2 — `session_id` existe como columna pero SIN FK (la tabla `sessions` no existía).** Verificado contra el as-built: las 5 tablas de evento (`weight_events` `0025`, `reproductive_events` `0026`, `sanitary_events` `0027`, `condition_score_events` `0028`, `lab_samples` `0029`) **ya tienen** la columna `session_id uuid` — pero **sin FK**, con el comentario explícito "session_id se vincula al MODO MANIOBRAS (feature 03), sin FK por ahora (la tabla sessions no existe aún)". O sea: spec 02 dejó el hueco preparado para spec 03. Para R5.11, spec 03 NO crea la columna (ya está): **agrega la FK `session_id → sessions(id)` (`ON DELETE SET NULL`) a las 5 tablas + el trigger tenant-check** vía migración nueva. Es una modificación a tablas "de otra spec", pero spec 02 la dejó anticipada → coordinación liviana con backend. Ver C2/D1 en design.

**C3 — Extensión de `animal_events` (corrects_event_id, correction_reason) — ADR-017 vs spec 02.** ADR-017 contempla correcciones; spec 02 modeló `animal_events` con edit-window + soft-delete, sin `corrects_event_id`/`correction_reason`. Dado C1 (no hay reversión de lote en este spec) y que la corrección de los 5 tipados es por edición/soft-delete sin ventana (spec 02 R6.8.1), **este spec NO necesita esas columnas**. Se deja como decisión abierta D4 por si Raf quiere el modelo de compensación explícito; default propuesto: **no agregarlas en spec 03**. Ver D4 en design.

---

## Cobertura del context.md (cada "Caso y decisión" → ≥1 `R<n>`)

| context.md (Caso/Decisión) | Requirements |
|---|---|
| §Sesión — `sessions` entidad persistida | R1.1, R1.9, R1.10, R1.11, R10.7 |
| §Sesión — una sesión = un rodeo | R1.1, R1.3 |
| §Sesión — animal de otro rodeo (mismo sistema) | R4.4, R4.7 |
| §Sesión — reanudación | R10.5 |
| §Alta en manga — find-or-create inline (spec 09) | R4.1, R4.6 |
| §Alta en manga — suspende listener BLE global (`useBusyMode`) | R3.2 |
| §Las 10 maniobras — gating UI | R1.4, R1.5, R5.4 |
| §Las 10 maniobras — gating DB (trigger BEFORE INSERT + UPDATE dientes/CUT + fail-closed) | R7.1, R7.2, R7.3, R7.4, R7.5, R7.6 |
| §Sangrado | R6.4 |
| §Tacto vaca (+ transición) | R6.2, R8.1, R8.2 |
| §Tacto vaquillona (extensión enum) | R6.3, R5.13 |
| §Vacunación (silenciosa, multi, texto libre+autocompletar) | R6.1, R1.8 |
| §Inseminación (1 vs >1 pajuela) | R6.5, R1.8 |
| §Condición corporal (1.00–5.00 step 0.25) | R6.6 |
| §Dientes (propiedad + prompt CUT, no terneros) | R6.7, R6.8, R7.5 (gating capa 2 del UPDATE) |
| §Pesaje (manual/balanza, sin ventana correlación) | R6.9 |
| §Raspado de toros (2 tubos, solo machos) | R6.11, R6.12 |
| §Pesaje de ternero (autocompleta categoría) | R6.10 |
| §Presets | R2.1, R2.2, R2.3, R2.4, R2.5 |
| §Lote — no auto-asigna; per-animal manual; metadata no-autoritativa | R9.1, R9.2, R9.3, R9.4 |
| §Roles — cualquier rol, sin gating por rol | R11.6 |
| §Offline-first — todo offline, sync, cache config, preview transición | R10.1, R10.2, R10.3, R8.4 |
| §Offline-first — rechazos de sync visibles (no dead-letter silencioso) — hardening leader s18 | R10.8 |
| §Sesión — rodeo de jornada mal elegido (corrupción de rodeo) — hardening leader s18 | R4.7, R4.4 |
| §Postura BLE — manual-first, fallback, reconexión, agnóstico | R3.1, R3.5, R3.6, R3.7, R3.8 |
| §Migrations — `sessions`, presets, triggers gating, extensión enum | R1.10, R2.x, R7.1, R5.13 |
| §4 edge — animal no existe → find-or-create | R4.1 |
| §4 edge — caravana visual duplicada (BLE desempata / manual desambigua) | R4.3, R4.2 |
| §4 edge — evento no aplica → omitir | R5.5 |
| §4 edge — animal de otro rodeo → recalcula por rodeo real | R5.3, R4.4 |
| §4 edge — transición de categoría por evento (ADR-008) | R8.1, R8.2, R8.3 |
| §4 edge — pérdida de batería del bastón → fallback manual sin perder sesión | R3.6 |
| §4 edge — cierre accidental → persiste y se ofrece retomar | R10.5 |
| refinamiento s18 #1 — cambio de rodeo permitido mismo sistema | R4.4 |
| refinamiento s18 #2 — parto/aborto/destete NO maniobra de manga | US-8 nota de alcance |
| refinamiento s18 #3 — castración NO maniobra de manga | US-8 nota de alcance |
| refinamiento s18 #4 — animal de otro establecimiento → avisar+saltar+sugerir | R4.5 |
| §UX de campo (botones 60-80px, 1-3 taps, contraste, vibración) | R5.2, R12.1, R12.2, R12.3, R12.4 |

## Historial de refinamiento

- **2026-05-30 (sesión 18) — Redacción inicial** desde `context.md` (Gate 0 aprobado 2026-05-28 + refinamiento de edge cases s18). Traducción a EARS de las decisiones lockeadas; sin re-decidir. Se detectaron y documentaron 3 conflictos (C1: `batches` de la decomposición vs `sessions`+`management_groups` del Gate 0; C2: `session_id` ausente en migraciones; C3: columnas de corrección de ADR-017) y 7 decisiones abiertas (design §9), todas con default propuesto y marca de "requiere confirmación de Raf". Pendiente Gate 1 (`security_analyzer` modo `spec`) por ser schema-sensitive (ADR-019).

- **2026-05-30 (sesión 18) — Cierre de Gate 1 FAIL** (`security_analyzer` modo `spec`, reporte `progress/security_spec_03-modo-maniobras.md`). Endurecimiento de seguridad sin renumerar requirements existentes. IDs estables preservados (R1.1..R12.4); solo se agregaron sub-IDs nuevos al final de US-7 (R7.5, R7.6). Cambios:
  - **SEC-SPEC-03-02 (HIGH)** — Las funciones `current_animal_rodeo` / `get_rodeo_data_keys` NO existen as-built (verificado, 0 hits 0001-0049). Se eliminó toda dependencia de ellas: el rodeo del animal se resuelve **inline** vía `animal_profiles.rodeo_id` del perfil activo. Editados R5.3, R5.6, R7.1 (redacción) + `design.md` §4 (`assert_data_keys_enabled` reescrita con resolución inline, firma `p_animal_profile_id`), §3 (gating capa 1), §1.2, §7, header.
  - **SEC-SPEC-03-03 (HIGH)** — Gating capa 2 declarado **fail-closed** explícito (rodeo NULL o data_key faltante → excepción `23514`; prohibido early-return fail-open). Nuevo **R7.6** + `design.md` §4 (comentario + prosa) + tasks T2.4b.
  - **SEC-SPEC-03-01 (HIGH)** — El path dientes/CUT (`UPDATE animal_profiles`) quedaba sin enforcement capa 2 (la policy `animal_profiles_update` solo exige `has_role_in`). Default firme = ENFORCE vía trigger `BEFORE UPDATE`. Nuevo **R7.5** + `design.md` §4 (trigger `tg_animal_profiles_teeth_gating`) + **D8** (decisión de producto: enforce vs excluir, requiere confirmación de Raf) + tasks T2.11.
  - **SEC-SPEC-03-04 (MEDIUM)** — `tg_event_session_tenant_check` ahora valida también intra-tenant: sesión `status='active'` y rodeo del animal == `sessions.rodeo_id`. `design.md` §2.3 + tasks T1.3/T2.6.
  - **SEC-SPEC-03-05 (MEDIUM)** — Contrato de seguridad del find-or-create inline (R4.6) delegado a spec 09; re-verificación documentada para Gate 2 (code). **D9** + `design.md` §7 + tasks T2.12.
  - **SEC-SPEC-03-06 (LOW)** — CHECK de tamaño (`octet_length(config::text) < 16384`) en `sessions.config` y `maneuver_presets.config`. `design.md` §2.1/§2.2 + tasks T1.1/T1.2.
  - Trazabilidad reflejada en `tasks.md` (pre-flight corregido + tasks de no-bypass para los 3 HIGH + cross-spec). Status se mantiene en `spec_ready` (re-correr Gate 1 sobre el delta).

- **2026-05-30 (sesión 18) — Hardening del leader** (cuestionamiento pre-Gate 1, aprobado por Raf): +R4.7 (detección de rodeo de jornada equivocado), +R10.8 (surfacing de rechazos de sync offline), mejora de R4.4 (confirmación con rodeo de origen), R6.9 (captura explícita de peso), notas de coordinación de migraciones y de provisionalidad de cliente. Sin renumerar IDs existentes.
