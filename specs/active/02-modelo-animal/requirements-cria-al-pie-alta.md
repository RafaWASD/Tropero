# Spec 02 — Delta VINCULAR LA CRÍA AL PIE AL DAR DE ALTA UNA VACA (#15) — Requirements (EARS)

**Status**: `spec_ready` — delta **Nivel B (ADR-028)** sobre spec 02, **CON BACKEND** (RPC nuevo + extensión backward-compatible de `register_birth`). El baseline NO se reescribe; este delta trae su propio set `{context,requirements,design,tasks}-cria-al-pie-alta.md`.
**Fecha**: 2026-06-30.
**Autor**: spec_author.
**Fuente de verdad**: `specs/active/02-modelo-animal/context-cria-al-pie-alta.md` (**Gate 0 APROBADO por Raf, 2026-06-30**, vía sus 3 decisiones + "ok" + deploy autorizado). Las decisiones vienen lockeadas en ese contexto; acá NO se re-deciden, se traducen a EARS.
**Origen**: corrección #15 del testeo en vivo (`docs/correcciones-prueba-en-vivo-2026-06-27.md`). Primera pieza del segmento A (cluster ternero); el resto de A (#1a parto, #4 rodeo al parto, #7 madre→crías + peso destete) queda en sus propios deltas.
**Gate 1**: **OBLIGATORIO** (RPC SECURITY DEFINER + RLS de `birth_calves` + migración ≥0114). Output esperado: `progress/security_spec_cria-al-pie-alta.md`.

> **Notación EARS** (`docs/specs.md`). **Numeración `RCAP.<n>`** ("Cría Al Pie") para no colisionar con `R<n>` (baseline), `RT2.<n>`, `RC6.<n>`, `RCUT.<n>`, `RPS.<n>`, `RAR.<n>`, `RAF2.<n>`, `RCF.<n>`. IDs estables; cada `RCAP.<n>` verificable por ≥1 test.

---

## Resumen

Hoy el alta (`crear-animal.tsx`) ofrece para vacas de 2º servicio/multípara un toggle **"con cría al pie"** que solo setea `animal_profiles.nursing` (boolean) — sin ninguna acción post-create (es un boolean muerto). Este delta convierte esa señal en una acción real: tras crear una vaca con `nursing=true`, un **prompt saltable** pide la caravana de su ternero y, vía **find-or-create**, lo **vincula** (ternero existente) o lo **crea+vincula** (ternero nuevo).

Backend (Gate 1, migración ≥0114):
1. **RPC nuevo `link_calf_to_mother`** — vincula un ternero **EXISTENTE** a una madre. Hoy NO hay forma: `register_birth` (`0045:188`, idempotente `0075:64`) **solo CREA terneros nuevos** y no acepta un `calf_profile_id` existente.
2. **`register_birth` extendido** con un parámetro opcional `p_calf_rodeo_id` (backward-compatible, default `NULL` → rodeo de la madre = comportamiento actual), para que el **camino CREATE** del prompt pueda colocar al ternero nuevo en un rodeo **editable** (decisión cerrada #1 del contexto) sin romper la firma probada del parto normal. *(Esto es DB adicional al RPC único previsto — ver `design` §Decisiones de criterio propio para Puerta 1.)*

Frontend: prompt saltable, offline-safe, con los MUSTs de forms (validación inline, es-AR, tokens, anti-recorte).

---

## RCAP.1 — Disparo del prompt de vinculación post-create

**RCAP.1.1** Cuando el usuario complete el alta de un animal con **cría al pie** (`nursing = true`), el sistema deberá presentar, antes de navegar fuera del formulario, un **prompt de vinculación** titulado "¿Vincular su cría al pie?".

**RCAP.1.2** Mientras el alta NO tenga cría al pie (`nursing` distinto de `true`), el sistema **no deberá** presentar el prompt de vinculación.

**RCAP.1.3** El prompt deberá ser **saltable**: el sistema deberá ofrecer una acción "Ahora no" que cierra el prompt sin vincular y navega a la ficha de la vaca recién creada.

**RCAP.1.4** Cuando el usuario salte el prompt, el sistema deberá conservar la vaca creada con `nursing = true` intacta (no se re-crea ni se modifica), de modo que la vinculación pueda hacerse después desde su ficha.

**RCAP.1.5** El sistema deberá presentar el prompt y resolver la vinculación **sin requerir conexión** (offline-first): la captura, el find-or-create y el encolado del vínculo deberán funcionar sin red y sincronizar después.

**RCAP.1.6** Si el alta de la vaca falló (no se creó el perfil), entonces el sistema **no deberá** presentar el prompt (no hay madre a la cual vincular).

## RCAP.2 — Captura del identificador del ternero + find-or-create

**RCAP.2.1** El sistema deberá pedir en el prompt la **caravana del ternero**, aceptando tanto una **caravana electrónica (EID)** como una **caravana visual/IDV**, clasificando el identificador con el motor existente (`classifyIdentifier`).

**RCAP.2.2** El sistema deberá resolver el identificador ingresado mediante el motor **find-or-create** existente de spec 09 (`lookupByTag` para EID; `searchAnimals`/`findOrCreateLookup` para IDV/visual), scopeado al establecimiento activo, **sin red** (lectura local PowerSync).

**RCAP.2.3** Cuando el find-or-create devuelva **exactamente un ternero existente activo en el campo activo**, el sistema deberá tratarlo como el ternero a **vincular** (camino ENCONTRADO, RCAP.3).

**RCAP.2.4** Cuando el find-or-create **no encuentre** ningún animal con ese identificador, el sistema deberá ofrecer **crear** el ternero (camino NO ENCONTRADO, RCAP.4), precargando el identificador ingresado.

**RCAP.2.5** Si el identificador ingresado está vacío o es inválido para su tipo (EID que no cumple el largo/dígitos), entonces el sistema deberá mostrar un **error inline** en el campo y **no deberá** disparar el find-or-create.

## RCAP.3 — Camino ENCONTRADO: vincular un ternero existente

**RCAP.3.1** Cuando el operario confirme la vinculación de un ternero existente, el sistema deberá vincularlo a la madre vía la RPC nueva **`link_calf_to_mother`** (encolada en la outbox), pasando el `profileId` de la madre, el `profileId` del ternero y la fecha del evento.

**RCAP.3.2** El sistema deberá fijar la **fecha del evento de parto** del vínculo = la **fecha de nacimiento del ternero** si la conoce (de su fila local), y en su defecto la **fecha de hoy**.

**RCAP.3.3** Si el ternero encontrado **ya tiene una madre registrada** (resuelto por `fetchMother`/`birth_calves`), entonces el sistema deberá **avisar** ("Ese ternero ya tiene una madre registrada") y **no deberá** re-vincularlo (un ternero tiene una sola madre biológica).

**RCAP.3.4** Si el ternero existe pero está **activo en otro campo** del usuario (resultado `transfer` del motor), entonces el sistema deberá avisar que ese ternero está en otro campo y **no deberá** vincularlo (la madre y el ternero deben ser del mismo establecimiento).

**RCAP.3.5** Cuando la vinculación de un ternero existente se complete con éxito, el sistema deberá cerrar el prompt y navegar a la ficha de la vaca, dejando el vínculo reflejado de forma optimista (el ternero aparece como cría al pie de la madre antes de sincronizar).

## RCAP.4 — Camino NO ENCONTRADO: crear el ternero y vincularlo

**RCAP.4.1** Cuando el ternero no exista, el sistema deberá presentar un mini-formulario de creación con: **sexo (requerido)**, **fecha de nacimiento (opcional)** y **rodeo** (RCAP.5).

**RCAP.4.2** Si el usuario intenta crear el ternero **sin elegir sexo**, entonces el sistema deberá mostrar un error inline y **no deberá** crear ni vincular el ternero (sexo es requerido).

**RCAP.4.3** Cuando el usuario confirme la creación del ternero, el sistema deberá crearlo y vincularlo a la madre **atómicamente** vía `register_birth` (encolada en la outbox), con un único ternero en el payload (`p_calves` de un elemento) y el `p_calf_rodeo_id` resuelto en RCAP.5.

**RCAP.4.4** El sistema deberá derivar la **categoría inicial** del ternero creado (`ternero`/`ternera`) por su **sexo** y el sistema productivo del rodeo elegido, sin hardcodear UUIDs (resolución por `code`, igual que el parto normal).

**RCAP.4.5** Cuando la creación+vinculación del ternero se complete con éxito, el sistema deberá cerrar el prompt y navegar a la ficha de la vaca, con el ternero reflejado de forma optimista como su cría al pie.

## RCAP.5 — Rodeo del ternero (camino CREATE): preseleccionado + editable

**RCAP.5.1** El sistema deberá presentar, en el formulario de creación del ternero, un **picker de rodeo** con el **rodeo de la madre preseleccionado**.

**RCAP.5.2** El sistema deberá mostrar junto al rodeo preseleccionado la leyenda **"(Mismo rodeo que la madre)"** mientras la selección coincida con el rodeo de la madre.

**RCAP.5.3** El sistema deberá permitir **editar** la selección a **otro rodeo del mismo campo** (lista de rodeos activos del establecimiento de la madre).

**RCAP.5.4** El sistema deberá ofrecer en el picker únicamente rodeos **del mismo sistema productivo** que el rodeo de la madre (la categoría `ternero`/`ternera` se resuelve por el sistema del rodeo; un rodeo de otro sistema rompería la resolución).

**RCAP.5.5** El sistema **no deberá** mover de rodeo a un ternero **existente** al vincularlo (el picker de rodeo aplica solo al CREATE; el ternero existente conserva su rodeo). *(Decisión "No entra" del contexto.)*

## RCAP.6 — Backend: RPC `link_calf_to_mother` (vincular existente, Gate 1)

**RCAP.6.1** El sistema deberá proveer una RPC nueva `link_calf_to_mother(p_mother_profile_id uuid, p_calf_profile_id uuid, p_event_date date, p_client_op_id uuid default null)`, **SECURITY DEFINER** con `search_path = public`, que en una sola transacción inserte un `reproductive_events` (`event_type='birth'`) de la madre + una fila `birth_calves` que linkee ese evento con el `calf_profile_id` **existente**.

**RCAP.6.2** La RPC deberá **derivar el tenant (`establishment_id`) de la fila REAL de la madre** (`animal_profiles`, perfil activo, `deleted_at is null`), nunca de un parámetro del cliente; si la madre no existe/no está activa, deberá rechazar con `23503`.

**RCAP.6.3** La RPC deberá exigir `has_role_in(<tenant derivado de la madre>)` (cualquier rol activo); un caller sin rol en ese establecimiento deberá ser rechazado con `42501` (anti-IDOR).

**RCAP.6.4** La RPC deberá derivar el ternero de su fila REAL **scopeada al mismo tenant de la madre** (`animal_profiles` con `establishment_id = <tenant madre>`, activo, no borrado); si no existe en ese establecimiento (no existe **o** es de otro tenant), deberá rechazar con `23503` **genérico**, sin revelar si el ternero existe en otro tenant (sin oráculo cross-tenant).

**RCAP.6.5** Si `p_calf_profile_id` es igual a `p_mother_profile_id`, entonces la RPC deberá rechazar con `23514` (un animal no puede ser su propia cría).

**RCAP.6.6** Si el ternero **ya está vinculado a una madre** (ya figura en `birth_calves` con un evento de parto no borrado), entonces la RPC deberá rechazar con `23514` (re-link prohibido), evaluado **después** del guard de idempotencia (RCAP.6.7) para no falsear un replay legítimo.

**RCAP.6.7** Cuando `p_client_op_id` no sea nulo y ya exista un evento de parto con ese `client_op_id` **para la misma madre y tenant ya autorizados** (no borrado), la RPC deberá devolver ese `reproductive_events.id` como **no-op idempotente** (replay por ACK perdido), sin crear un segundo evento ni una segunda fila `birth_calves`, y sin lookup global por `client_op_id` (anti-oráculo cross-tenant, patrón `0075:106`).

**RCAP.6.8** La RPC deberá persistir el `client_op_id` en el `reproductive_events` insertado, apoyándose en el índice único compuesto existente `reproductive_events_client_op_id_uq (animal_profile_id, client_op_id)` (`0075:52`) como defensa-en-profundidad contra el doble-insert concurrente (un choque → `23505`, sin oráculo por estar anclado en `animal_profile_id`).

**RCAP.6.9** La RPC deberá tener `EXECUTE` **revocado** de `public` y `anon` y **otorgado** solo a `authenticated`, con un smoke-check fail-closed que falle la migración si `public`/`anon` quedaran con `EXECUTE` (patrón `0087:279`), y emitir `notify pgrst, 'reload schema'`.

**RCAP.6.10** El sistema **no deberá** agregar una policy `INSERT` sobre `birth_calves` para `authenticated`: la tabla se sigue poblando **solo server-side** desde flujos SECURITY DEFINER (la nueva RPC se suma a `register_birth` y al trigger mono-ternero), conservando el invariante de `0045:35` (sin `GRANT INSERT` al cliente, no se pueden fabricar parentescos).

## RCAP.7 — Backend: `register_birth` extendido con rodeo del ternero (Gate 1)

**RCAP.7.1** El sistema deberá extender `register_birth` con **dos** parámetros opcionales **`p_calf_rodeo_id uuid default null`** (rodeo del ternero) y **`p_calf_idv text default null`** (IDV tipado, RCAP.7.6 / fold Gate 1 LOW-1), llevando la firma a **`(uuid, date, jsonb, uuid, uuid, text)`** (6 args). *(Reconciliación as-built: `0115` lo hizo por `DROP` de la firma vieja `(uuid,date,jsonb,uuid)` + `CREATE` de la 6-arg; `0116` la re-definió por `CREATE OR REPLACE` para **restaurar la herencia de `breed_id`** que `0115` había regresado — ver RCAP.7.7.)*

**RCAP.7.2** Cuando `p_calf_rodeo_id` sea `NULL`, `register_birth` deberá crear los terneros en el **rodeo de la madre** (comportamiento idéntico al as-built `0075`), de modo que **todos los callers existentes** (parto normal/mellizos) queden **inalterados**.

**RCAP.7.3** Cuando `p_calf_rodeo_id` no sea nulo, `register_birth` deberá **validar** que el rodeo exista, esté activo, **pertenezca al tenant derivado de la madre** y sea del **mismo sistema productivo** que el rodeo de la madre; si no cumple, deberá rechazar con `23514` (anti-IDOR / consistencia de categoría, patrón `0087:115`).

**RCAP.7.4** Cuando `p_calf_rodeo_id` válido sea provisto, `register_birth` deberá crear el ternero en **ese rodeo** (en lugar del de la madre), conservando el resto del flujo (herencia de tenant de la fila real de la madre, categoría por sistema, atomicidad, idempotencia por `p_client_op_id`).

**RCAP.7.5** La RPC extendida deberá re-emitir `revoke … from public, anon` + `grant … to authenticated` sobre la **firma nueva 6-arg** (`uuid, date, jsonb, uuid, uuid, text`), sin dejar grants colgando de la firma vieja, y `notify pgrst`.

**RCAP.7.6** (fold Gate 1 LOW-1) Cuando se provea `p_calf_idv` no vacío, `register_birth` deberá setear `animal_profiles.idv` del ternero creado con ese valor (trim/nullif; `NULL` → comportamiento as-built sin idv), respetando la unicidad parcial `(establishment_id, idv)` (`0020`) y la inmutabilidad (`0036`, no aplica en INSERT). Así la caravana visual que el operario tipeó (y no se encontró) fluye al ternero creado, sin un segundo paso de asignación.

**RCAP.7.7** (fix Gate 2 HIGH — `0116`) `register_birth` deberá **preservar la herencia de `animal_profiles.breed_id` de la madre al ternero** (spec 08 SIGSA R1.7, introducida en `0109`). La extensión 6-arg de `0115` se moldeó por error sobre `0075` (pre-`0109`) y **borró esa herencia** → terneros con `breed_id` NULL (regresión de dato regulado, cazada por el Gate 2; la suite animal no cubre raza). `0116` (`CREATE OR REPLACE`) re-define la 6-arg combinando el cuerpo de `0109` (lee `p.breed_id` de la madre + lo escribe en el `animal_profiles` del ternero) con las extensiones de `0115` (rodeo/idv/caps). Verificado: suite SIGSA `T3 R1.7` + animal `#15` verdes (200/200) tras `0116`.

## RCAP.8 — Offline-first: outbox, overlay e idempotencia del cliente

**RCAP.8.1** El sistema deberá encolar la vinculación de un ternero existente como una **intención** `link_calf_to_mother` en la outbox (`op_intents`), con un overlay optimista mínimo: el evento de parto de la madre (`pending_reproductive_events`) + la fila puente (`pending_birth_calves`) que linkea el `calf_profile_id` **existente** — sin `pending_animals`/`pending_animal_profiles` (el ternero ya existe local).

**RCAP.8.2** El sistema deberá mapear la intención `link_calf_to_mother` a la RPC del mismo nombre, **inyectando `p_client_op_id = op_intents.id`** desde el mapeo de upload (igual que `register_birth`/`assign_tag_to_animal`), para dedup explícita at-least-once.

**RCAP.8.3** El sistema deberá garantizar que un **reintento at-least-once** de la intención `link_calf_to_mother` (ACK perdido) **no** cree un segundo vínculo: el guard de idempotencia de RCAP.6.7 devuelve el evento existente (replay `2xx`, sin error que rompa el ACK).

**RCAP.8.4** Cuando la vaca y el ternero se hayan creado **offline** en la misma sesión, el sistema deberá encolar el vínculo **después** del alta de la vaca, de modo que al drenar la outbox en orden (FIFO) la madre ya exista server-side antes de que corra `link_calf_to_mother`.

**RCAP.8.5** Si la RPC de vinculación es rechazada al subir (madre/ternero inexistente, ternero ya con madre, sin rol), entonces el sistema deberá clasificar el rechazo como **permanente** (no loop de reintento) y superficiarlo de forma accionable, sin perder la vaca (que ya existe).

## RCAP.9 — MUSTs de formulario (saltable, validación, es-AR, tokens)

**RCAP.9.1** El prompt y el mini-form de creación del ternero deberán usar **tokens del design system** (sin colores/medidas hardcodeadas, ADR-023).

**RCAP.9.2** Todo título o valor con descendentes del prompt deberá renderizarse **sin recortarse** (`lineHeight` matcheado al `fontSize`, regla anti-recorte).

**RCAP.9.3** La validación de los campos del mini-form (sexo requerido, identificador, fecha) deberá ser **inline** (borde rojo + error junto al campo + scroll-al-campo), sin banner global que tape el título.

**RCAP.9.4** Toda fecha capturada en el mini-form deberá mostrarse y parsearse en formato **es-AR** (DD/MM, sin clamp silencioso de bordes inválidos), reusando las utils de fecha del alta.

**RCAP.9.5** El prompt deberá manejar **una sola cría por invocación** (MVP); tras una vinculación exitosa deberá cerrarse, dejando que el resto de las crías ("mellizos al pie") se agreguen después desde la ficha de la madre (no bloquear).

## RCAP.10 — Anti-bypass y trazabilidad (tests no-bypass de Gate 1)

**RCAP.10.1** El sistema deberá tener un test **happy** que verifique que `link_calf_to_mother` con un ternero existente crea exactamente un `reproductive_events` (`birth`) de la madre + una fila `birth_calves`, deja la madre con `nursing = true` (trigger `0067`) y recomputa su categoría (trigger de parto `0046`).

**RCAP.10.2** El sistema deberá tener un test que verifique que **re-vincular** un ternero que ya tiene madre es **rechazado** (`23514`) y no crea filas nuevas (RCAP.6.6).

**RCAP.10.3** El sistema deberá tener un test **cross-tenant** que verifique que un caller sin rol en el tenant de la madre, o con un ternero de otro tenant, es rechazado (`42501`/`23503`) sin tocar ni revelar filas ajenas (RCAP.6.3/RCAP.6.4).

**RCAP.10.4** El sistema deberá tener un test **anti-IDOR** que verifique que la RPC deriva el tenant de las filas reales de madre y ternero (el cliente no pasa `establishment_id`) y que un `p_mother_profile_id`/`p_calf_profile_id` ajeno rebota por authz, sin parentesco fabricado.

**RCAP.10.5** El sistema deberá tener un test de **idempotencia** que verifique que dos invocaciones con el mismo `p_client_op_id` (misma madre) producen **un solo** vínculo (la segunda devuelve el id existente, RCAP.6.7).

**RCAP.10.6** El sistema deberá tener un test de `register_birth` extendido que verifique: (a) `p_calf_rodeo_id = NULL` → ternero en el rodeo de la madre (regresión inalterada, RCAP.7.2); (b) `p_calf_rodeo_id` válido del campo → ternero en ese rodeo (RCAP.7.4); (c) `p_calf_rodeo_id` de otro tenant o de otro sistema → `23514` (RCAP.7.3).

**RCAP.10.7** El sistema deberá tener tests de UI/integración que cubran: el disparo del prompt solo con `nursing=true` (RCAP.1.1/RCAP.1.2), el skip que preserva la vaca (RCAP.1.3/RCAP.1.4), el aviso de "ternero ya tiene madre" (RCAP.3.3) y el rodeo preseleccionado editable con leyenda (RCAP.5.1–RCAP.5.3).

---

## Trazabilidad

Cada `RCAP.<n>` se mapea a ≥1 test en `tasks-cria-al-pie-alta.md`. El implementer documenta el mapa `RCAP.<n> → archivo:test` en `progress/impl_cria-al-pie-alta.md`. El reviewer rechaza si queda alguno sin cubrir.

## Historial de refinamiento

- 2026-06-30 — Creación del delta (Gate 0 aprobado). Decisión de criterio propio del spec_author: el camino CREATE se resuelve **extendiendo `register_birth`** con `p_calf_rodeo_id` (backward-compatible) en vez de un RPC nuevo, para honrar simultáneamente las dos decisiones cerradas del contexto ("crear vía `register_birth`" + "rodeo editable"). Esto agrega DB más allá del RPC único previsto; se marca para confirmación en Puerta 1 (ver `design-cria-al-pie-alta.md` §Decisiones de criterio propio).
