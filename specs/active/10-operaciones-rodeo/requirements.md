# Spec 10 — Operaciones masivas por rodeo + vista de grupo — Requirements (EARS)

**Status**: `spec_ready` (status flip pendiente de coordinación — esta spec se redactó desde una terminal secundaria; el cambio en `feature_list.json` lo hace la terminal de coordinación).
**Gate 1 (security spec)**: PASS (`progress/security_spec_10-operaciones-rodeo.md`) tras fix loop (2 HIGH + 2 MEDIUM + 1 LOW cerrados).
**Puerta 1 (aprobación humana)**: ✅ **APROBADA por Raf** (2026-06-01, sesión 22). Lista para implementación cuando el pipeline le dé turno (backend ejecutable ya; UI espera frontend de spec 02 + design system).
**Fecha**: 2026-06-01 (sesión 21).
**Autor**: spec_author.
**Fuente de verdad**: `specs/active/10-operaciones-rodeo/context.md` (Gate 0 aprobado por Raf, sesión 18, 2026-05-29). Cada "Caso y decisión" del context queda cubierto por ≥1 `R<n>` (ver mapa de cobertura al final). No se re-decidió contexto ni edge cases: se tradujeron a EARS.
**Related**: spec 02 (rodeos, `rodeo_data_config`, tablas de evento, `management_groups`, `sanitary_campaigns`, transiciones R7/R7.8, corrección de eventos R6.8.1, RLS R11), spec 03 (gating doble capa: trigger `BEFORE INSERT` + `assert_data_keys_enabled`, migration 0054; comparten tablas de evento + gating), spec 09 (`AnimalListItem`, find-or-create, path de error de sync R11.5), ADR-018 (Inicio = resumen de rodeos), ADR-020 (lote = `management_groups`), ADR-021 (gating/plantilla), ADR-019 (security gates), ADR-022 (Gate 0).

> **Notación EARS** (`docs/specs.md`): Ubicuo "El sistema deberá…", Evento "Cuando…, el sistema deberá…", Estado "Mientras…, el sistema deberá…", Opcional "Donde…, el sistema deberá…", No deseado "Si…, entonces el sistema deberá…". IDs estables, no reordenar tras aprobar. Cada `R<n>` verificable por ≥1 test.

> **Madurez por capa.** Los requirements de **lógica de aplicación / autorización / offline / idempotencia** (R3, R4, R5, R6, R7, R9, R10) son firmes — operan sobre el sustrato de spec 02/03 as-built. Los requirements de **UI** (R1 vista de grupo, R2 Inicio rodeo-céntrico, R8 preview/skip-report) son **TENTATIVOS** hasta cerrar el design system (mismo patrón que R14 de spec 02 y la UI tentativa de spec 09): describen QUÉ hace la pantalla a nivel funcional, no el layout. Hay además requirements **TENTATIVOS por dependencia de dominio** (R5.7 efecto de categoría de castración; R5.5 transición de destete) marcados con disclaimer porque dependen de decisiones de Facundo (CONTEXT/07).

> **No introduce superficie de autorización nueva.** Las operaciones masivas disparan **exactamente los mismos eventos individuales** que ya se pueden insertar uno por uno (spec 02 R6 + gating de spec 03). Los roles que pueden disparar una operación masiva de un tipo son **los mismos** que pueden insertar ese evento individualmente; la capa DB (RLS + trigger `BEFORE INSERT` + `assert_data_keys_enabled` de migration 0054/0056) valida **por animal**. Ver `design.md` §RLS/seguridad.

---

## US-1 — Inicio rodeo-céntrico y vista de grupo

> Como productor/operario, quiero un Inicio que muestre mis rodeos y lotes y, al tocarlos, su configuración + sus animales + las acciones masivas, para gestionar el grupo entero sin escanear animal por animal. (context §Navegación; ADR-018)

> **TENTATIVA UI** — R1.x y R2.x describen el comportamiento funcional; layout, copy y microinteractions se refinan al cerrar el design system. Esta sección **realiza** el rol que ADR-018 ya le da a Inicio ("resumen de rodeos del establecimiento activo"); **no** reabre ADR-018 ni cambia la estructura de tabs.

**R1.1** El sistema deberá exponer una **vista de grupo** que muestre, para un grupo dado (un `rodeo` o un `management_group` del establecimiento activo): el nombre y metadatos del grupo, su configuración de datos (`rodeo_data_config`) cuando aplique, la lista de sus animales **activos**, y las **acciones masivas** disponibles. (context §Navegación: "vista de rodeo / vista de lote → su config + sus animales + acciones masivas")

**R1.2** La vista de grupo deberá listar los animales reusando el componente `AnimalListItem` de spec 09 y el contexto de rodeo (`RodeoContext` / `rodeo-config`) que provee el frontend de spec 02 (chunk C1/C2); **no** deberá redefinir un componente de lista ni un servicio de rodeo propios. (context §Insumos "reusa `AnimalCard`/list de spec 09")

**R1.3** Mientras se renderiza la lista de animales de un grupo, el sistema deberá incluir **solo** animales con `status = 'active'` y `deleted_at IS NULL` (consistente con spec 09 R1.5 y spec 02 R4.12). Los archivados/baja/soft-deleted no deberán aparecer en la lista candidata de operaciones masivas.

**R1.4** El sistema deberá ofrecer en la vista de grupo, como mucho, las **tres operaciones masivas del MVP**: vacunación masiva, destete masivo y castración masiva. No deberá ofrecer otras operaciones masivas (sangrado masivo, raspado masivo, pesaje masivo, condición corporal masiva quedan fuera de MVP — context §Alcance "Fuera").

**R1.5** Cuando el grupo es un `rodeo`, el sistema deberá ofrecer una operación masiva **solo si** su(s) `data_key(s)` requeridos están `enabled = true` en el `rodeo_data_config` de ese rodeo (gating UI capa 1, mismo mapeo que spec 03 R5.4: vacunación→`vacunacion`, destete→`destete`, castración→`castracion`).

**R1.6** Si una operación masiva tiene su `data_key` requerido `enabled = false` en el `rodeo_data_config` del rodeo, entonces el sistema **no deberá** ofrecer esa operación para ese rodeo (gating UI). (context §Gating)

**R2.1** El sistema deberá mostrar en **Inicio** las **cards de rodeo** del establecimiento activo (nombre, sistema, cabezas y al menos una métrica clave o señal de atención) y, como grupos secundarios, las **cards de lote** (`management_groups`) activos del establecimiento. (context §Navegación "Inicio rodeo-céntrico"; ADR-018)

**R2.2** Cuando el usuario toca una card de rodeo o de lote en Inicio, el sistema deberá navegar a la **vista de grupo** (R1.1) del grupo correspondiente. (context §Navegación)

**R2.3** El sistema **no deberá** modificar la tab `Animales` (lupa + lista + filtros + asignación masiva de caravanas de spec 09): la gestión de grupos vive en Inicio, la búsqueda de un animal vive en `Animales`. (context §Navegación "Animales (tab) queda intacta")

---

## US-2 — Las tres operaciones masivas (MVP)

> Como operario de campo, quiero aplicar un evento a todo el grupo (o a un subconjunto filtrado) de una, generando un evento individual por animal. (context §Las 3 operaciones masivas)

**R3.1** El sistema deberá soportar **vacunación masiva**: generar **un** `sanitary_events` (`event_type = 'vaccination'`) **por animal** del conjunto seleccionado, con `product_name` (y demás parámetros de vacuna) tomados de la pre-config de la operación, reusando `sanitary_events` de spec 02 (la tabla `sanitary_campaigns` **no existe as-built** — `campaign_id` queda `NULL`; ver design §2.1). Requiere `vacunacion` enabled en el rodeo del animal. (context §Vacunación masiva)

**R3.2** El sistema deberá soportar **destete masivo**: generar **un** `reproductive_events` (`event_type = 'weaning'`) **por animal** del conjunto seleccionado. Requiere `destete` enabled en el rodeo del animal. (context §Destete masivo)

**R3.3** El sistema deberá soportar **castración masiva**: generar **un** evento de castración **por animal** del conjunto seleccionado, persistido como `sanitary_events` (`event_type='treatment'`) con un **marcador canónico constante** `product_name='Castración'` (seteado **programáticamente** por la op masiva, no tipeado por el operario). El gating por animal (R7.3) reconoce ese marcador de forma **robusta a acento y caso** (`'Castracion'` sin tilde, mayúsculas, etc. también gatean). Requiere `castracion` enabled en el rodeo del animal. El marcador es **defensa en profundidad / clasificación del gating, no una frontera de autorización** (un no-marcador deliberado escribe un evento no-gateado pero no cruza tenants ni escala privilegios). El mecanismo de persistencia + el delta de catálogo del `data_key castracion` + la normalización del marcador se detallan en `design.md` §2.1/§4. (context §Castración masiva)

**R3.4** El sistema deberá modelar cada operación masiva como **N eventos individuales** (uno por animal), **no** como un único evento colectivo. (context §Selección "Un evento por animal")

**R3.5** Cuando un animal es **mellizo** o comparte parto con otro, el destete masivo deberá generar **un evento de destete por cada ternero** (se desteta el ternero, no el parto), consistente con R3.4. (context §Selección "Mellizos: cada ternero recibe su propio evento de destete")

**R5.5** (**TENTATIVA — dependencia de dominio**) Donde el destete masivo deba transicionar la categoría del ternero (R7.8 de spec 02: `ternera → vaquillona`, `ternero → torito`), el sistema deberá aplicar esa transición **por cada ternero** salvo que tenga `category_override = true` (R5.6). **El mapeo de categoría destino del destete es Tier 2 DEFERIDO pendiente de Facundo** (spec 02 design, "DEFERIDO Tier 2"): la operación masiva **igual crea el evento `weaning`** (R3.2); la rama de transición de categoría se activa cuando Facundo confirme los targets, sin reabrir esta spec. Hasta entonces el evento se persiste y la categoría no transiciona. (context §Destete masivo; override Raf del leader: "el evento se crea; el efecto de categoría queda como requirement TENTATIVO")

**R5.7** (**TENTATIVA — dependencia de dominio**) El **efecto de categoría de la castración** está **pendiente de Facundo** (cría no tiene categoría "novillo"; CONTEXT/07). El sistema **igual deberá crear** el evento de castración masiva (R3.3). El cambio de categoría asociado a la castración **no** se implementa en MVP. Las opciones abiertas — (a) agregar la categoría `novillo` a cría, (b) tratar la castración solo como evento sanitario sin efecto de categoría, (c) el novillo se va a invernada — se listan pero **no** se eligen en esta spec. (context §Pendientes; CONTEXT/07; override Raf del leader)

> **DIFERIDO explícito (fuera de MVP).** El destete masivo opera sobre el **ternero** (R3.2/R5.5). Cualquier **marca en la madre** al destetar (ej. "vaca con ternero destetado") queda **diferida a Facundo / fuera del MVP** y **no** se implementa en esta spec. (context §Pendientes; override Raf del leader: "Destete: ¿marca algo en la madre? → diferido a Facundo / fuera de MVP")

---

## US-3 — Selección de alcance, preview y skip-and-report

> Como operario, quiero elegir todo el grupo (o un subconjunto filtrado), ver un preview de lo que va a pasar y confirmar, sabiendo qué animales se van a saltar y por qué. (context §Selección de alcance + seguridad)

**R4.1** El sistema deberá usar como conjunto candidato por **default = todos los animales activos del grupo** (R1.3), y deberá permitir aplicar un **filtro opcional** por **categoría** y/o **sexo** (p. ej. castrar solo machos, destetar solo terneros/as). (context §Selección "Default = todo el grupo, con filtro opcional por categoría/sexo")

**R4.2** Antes de aplicar cualquier operación masiva, el sistema deberá mostrar un **preview obligatorio** que indique cuántos eventos se van a crear y sobre cuántos animales (p. ej. "vas a crear N eventos sobre N animales, uno por animal") y deberá requerir una **confirmación explícita** del operario. (context §Selección "Preview obligatorio … es acción de alta consecuencia")

**R4.3** El sistema deberá excluir del conjunto a aplicar (**skip-and-report**) y reportarlos al operario, los animales que **no aplican**:
- animales que **ya tienen** el evento aplicado para esa operación según el criterio de idempotencia (R6.1) — ej. ternero ya destetado, macho ya castrado;
- animales cuyo **sexo/categoría** no corresponde a la operación (ej. una hembra en castración masiva);
- animales cuyo **rodeo no tiene** habilitado el `data_key` de la operación (R7.2, caso lote cross-rodeo).
El reporte deberá indicar **cuántos** se saltaron y **por qué** (motivo agrupado). (context §Selección "Skip-and-report: los que no aplican se saltan y se reportan; no se duplica el evento")

**R4.4** El sistema **no deberá** crear un evento sobre un animal saltado por R4.3. La operación masiva sobre el resto del conjunto deberá proceder normalmente (un animal saltado no bloquea a los demás). (context §Selección skip-and-report)

**R4.5** El sistema deberá garantizar que cada evento creado por una operación masiva queda **individualmente corregible** por el `owner` o el `created_by` del evento, sin ventana de tiempo, reusando la corrección de eventos tipados de spec 02 (R6.8.1): editar o soft-deletear un evento recalcula la categoría del animal si correspondía una transición y no hay override (spec 02 R6.14). (context §Selección "Cada evento queda individualmente corregible")

**R5.6** Cuando una operación que debería transicionar la categoría (destete, R5.5) incluiría un animal con `category_override = true`, el sistema **no deberá** pisar su categoría (el override manda, spec 02 R4.9). El **preview** deberá **avisar** ("N animales tienen categoría manual y no van a transicionar") y deberá **ofrecer revertir el override** (set `category_override = false`, spec 02 R4.10) para incluirlos en la transición. (context §Selección "Animales con `category_override = true`": preview avisa + ofrece revertir)

---

## US-4 — Gating sobre lotes cross-rodeo

> Como sistema, quiero ofrecer una operación masiva sobre un lote que junta animales de rodeos con configuraciones distintas, aplicándola solo donde corresponde. (context §Gating "lote cross-rodeo")

**R7.1** Cuando el grupo es un `management_group` (lote, cross-rodeo posible), el sistema deberá ofrecer una operación masiva si **algún** rodeo representado en el lote tiene el `data_key` de esa operación `enabled = true` (gating UI a nivel lote). (context §Gating: "ofrecer la op si algún rodeo del lote la tiene")

**R7.2** Cuando se aplica una operación masiva sobre un lote cross-rodeo, el sistema deberá **saltar (skip-and-report, R4.3)** los animales cuyo **rodeo real** (`animal_profiles.rodeo_id` del perfil activo) **no** tenga el `data_key` de la operación `enabled = true`, y aplicarla solo a los animales cuyo rodeo sí lo tiene. (context §Gating "saltar los animales cuyos rodeos no la tienen")

**R7.3** El sistema deberá hacer cumplir el gating **también a nivel DB, por animal**: cada uno de los N eventos individuales pasa por el trigger `BEFORE INSERT` + `assert_data_keys_enabled` de spec 03 (migration 0054), que resuelve el rodeo real del animal inline y **rechaza (fail-closed)** el evento si su rodeo no tiene el `data_key` habilitado. La operación masiva **no** introduce un camino que evite ese check. (context §Gating "la capa DB igual valida por animal"; spec 03 R7.1/R7.6; override Raf del leader)

---

## US-5 — Idempotencia y no-duplicación

> Como sistema offline-first donde un re-intento de sync puede reejecutar mutaciones, quiero que una operación masiva no genere eventos duplicados. (context §Selección "no se duplica el evento"; §Offline-first "no se generan duplicados … cada evento es idempotente si el design lo asegura")

**R6.1** El sistema deberá tratar cada evento generado por una operación masiva como **idempotente por animal+tipo de operación+fecha de la operación**, garantizado por **dos barreras** (ambas firmes, design §7): (1) skip-and-report local de animales ya procesados (R6.2); y (2) un **`id` (PK) determinístico OBLIGATORIO** derivado de `(animal_profile_id, tipo de operación, fecha de la operación)` — UUIDv5 sobre un namespace fijo — de modo que dos syncs concurrentes del mismo evento lógico **colisionen en la PK existente** y no inserten un duplicado (dedup a nivel DB sin unique constraint nuevo). Un re-intento de la **misma** operación masiva sobre el **mismo** animal en la **misma** fecha **no deberá** crear un segundo evento. (context §Offline-first "cada evento es idempotente por animal+tipo+fecha si el design lo asegura"; override Raf del leader; M2 Gate 1 s21)

**R6.2** El skip-and-report (R4.3) deberá **excluir de entrada** del conjunto a aplicar a los animales que **ya tienen** el evento aplicado para esa operación (según R6.1), de modo que el preview (R4.2) refleje el conteo real de eventos nuevos a crear (no recuente animales ya procesados). (context §Selección skip-and-report; override Raf del leader)

**R6.3** Si una operación masiva se ejecuta dos veces (p. ej. el operario la repite, o un re-intento de sync la reejecuta), entonces el sistema **no deberá** producir eventos duplicados: la segunda ejecución deberá saltar (R4.3) los animales ya procesados por la primera. (context §Offline-first "no se generan duplicados")

---

## US-6 — Offline-first y sincronización por-animal

> Como peón sin señal, quiero crear la operación masiva offline y que sincronice después, viendo qué se sincronizó y qué falló por animal. (context §Offline-first)

**R10.1** El sistema deberá permitir armar el conjunto (R4.1), ver el preview (R4.2) y **aplicar** la operación masiva **sin conexión**: los N eventos se generan localmente (PowerSync / SQLite) y se encolan para sincronizar después, reusando el camino de carga individual de spec 02 (R13.2). (context §Offline-first "El preview + la creación funcionan offline")

**R10.2** El sistema deberá tratar los N eventos como **mutaciones independientes, no como una transacción atómica todo-o-nada**: si la sincronización falla a mitad, los eventos que entraron quedan persistidos y los que fallan se reportan; no deberá hacer rollback de los exitosos. (context §Offline-first "Mutaciones independientes, no transacción atómica")

**R10.3** Si un evento de una operación masiva es **rechazado al sincronizar** (gating capa 2, tenant-check, race), entonces el sistema deberá **hacerlo visible al operario por animal** (no descartarlo en silencio), reusando el path de error de sync de spec 09 R11.5, e indicando el motivo. (context §Offline-first "se reportan por animal vía el path de error de sync de spec 09 R11.5")

**R10.4** El sistema deberá mostrar un **contador "X de N sincronizados"** para una operación masiva, reflejando cuántos de los N eventos llegaron al server y cuántos quedan pendientes o fallaron. (context §Offline-first "con un contador X de N sincronizados")

**R10.5** El sistema deberá manejar el **volumen** de un rodeo grande (cientos a miles de animales): la generación y el encolado de las N mutaciones offline deberán resolverse por **batching/encolado** sin bloquear la UI, según la estrategia de `design.md`. (context §Offline-first "Ojo con el volumen … nota de performance para design"; override Raf del leader)

---

## US-7 — Roles, multi-tenant y seguridad

> Como producto multi-tenant con datos regulados (SENASA), quiero que la operación masiva no abra ninguna superficie de autorización nueva ni exponga datos cross-tenant. (ADR-019; context §Roles)

**R9.1** El sistema deberá permitir disparar una operación masiva de un tipo a **exactamente los mismos roles** que pueden insertar ese tipo de evento individualmente (spec 02 R11.5: `owner`, `field_operator`, `veterinarian` con rol activo pueden insertar eventos del R6). La operación masiva **no** deberá introducir una restricción ni una superficie de autorización distinta de la del evento individual. (context §Roles; override Raf del leader: "los mismos roles que pueden insertar ese tipo de evento individualmente")

**R9.2** El sistema deberá hacer cumplir el aislamiento multi-tenant **por animal** en cada uno de los N eventos: cada insert pasa por la RLS canónica de su tabla de evento (spec 02 R11.1/R11.2, `has_role_in(establishment_id)` derivado del `animal_profile`). La operación masiva **no** deberá poder crear eventos sobre animales de un establecimiento donde el usuario no tiene rol activo. (ADR-019; spec 02 R11)

**R9.3** El sistema deberá registrar `created_by = auth.uid()` en cada uno de los N eventos mediante el trigger BEFORE INSERT de las tablas de evento (`tg_set_created_by_auth_uid`, "solo si NULL", spec 02 R6.7 / migration 0024): `created_by` **defaultea a `auth.uid()` cuando el cliente lo omite** (la op masiva no lo envía). **No** se fuerza server-side: un payload que envíe `created_by` no-NULL es respetado, por lo que la autoría **es spoofeable intra-tenant** (un cliente con rol activo puede atribuir un evento a otro usuario del **mismo** establishment). Esta es una **condición sistémica pre-existente documentada como SEC-SPEC-03 (migration 0043)** que afecta a todas las tablas de evento de specs 02/03/09; la feature 10 la **hereda**, no la introduce. **No es brecha cross-tenant**: la RLS sigue impidiendo escribir sobre otro establishment (R9.2). Forzar `created_by` no-spoofeable es una decisión transversal **backlogged** (design §9 D7), fuera de spec 10. (ADR-019; spec 02 R6.7; 0024/0043 SEC-SPEC-03)

**R9.4** El sistema **no deberá** introducir ninguna función `SECURITY DEFINER` nueva, Edge Function nueva, ni política RLS nueva para las operaciones masivas: reusa el gating de migration 0054 (`assert_data_keys_enabled`), la RLS de las tablas de evento de spec 02 y el trigger de `created_by`. El **único delta de backend** es el catálogo del `data_key castracion` (R3.3, ver `design.md`). (override Raf del leader; ver design.md §Delta de backend + Gate 1)

---

## Criterios de aceptación globales

Esta spec se considera implementada cuando:

- Inicio muestra cards de rodeo + cards de lote del establecimiento activo; tocar una abre la vista de grupo con su config, su lista de animales activos (vía `AnimalListItem`) y las acciones masivas habilitadas por gating. La tab `Animales` queda intacta.
- Una operación masiva (vacunación/destete/castración) genera **N eventos individuales** (uno por animal), no un evento colectivo, sobre los animales activos del conjunto seleccionado (todo el grupo o el subconjunto filtrado por categoría/sexo).
- El preview muestra "N eventos sobre N animales" y exige confirmación; los animales que no aplican (ya procesados, sexo/categoría incompatible, rodeo sin el data_key) se saltan y se reportan con su motivo.
- Re-ejecutar la misma operación masiva sobre el mismo conjunto en la misma fecha (o un re-intento de sync) **no** crea eventos duplicados: los ya procesados se saltan (idempotencia por animal+tipo+fecha).
- En un lote cross-rodeo, la operación se ofrece si algún rodeo del lote tiene el data_key, y al aplicar salta los animales cuyo rodeo no lo tiene; la capa DB (trigger 0054) rechaza por animal igual, fail-closed.
- Un animal con `category_override = true` no transiciona por destete masivo; el preview lo avisa y ofrece revertir el override para incluirlo.
- Toda la operación (armado + preview + aplicar) funciona offline; los N eventos se encolan; al sincronizar se ven los rechazos por animal (path de spec 09 R11.5) y un contador "X de N sincronizados"; los exitosos no se revierten si alguno falla.
- Los roles que pueden disparar cada operación masiva son exactamente los que pueden insertar ese evento individualmente; RLS impide crear eventos cross-tenant; `created_by` **defaultea a `auth.uid()` cuando el cliente lo omite** (audit best-effort, spoofeable intra-tenant heredado de SEC-SPEC-03 — R9.3, no cross-tenant); no hay función SECURITY DEFINER ni RLS nueva (salvo el delta de catálogo del data_key `castracion` + la rama de gating en `tg_sanitary_events_gating`).
- El efecto de categoría de la castración (R5.7) y la transición de destete (R5.5) quedan TENTATIVOS/diferidos a Facundo; el evento igual se crea en ambos casos.

---

## Cobertura del context.md (cada "Caso y decisión" → ≥1 `R<n>`)

| context.md (Caso/Decisión) | Requirements |
|---|---|
| §Navegación — Inicio rodeo-céntrico (cards de rodeo) | R2.1, R2.2 |
| §Navegación — tap card → vista de rodeo (config + animales + acciones) | R1.1, R2.2 |
| §Navegación — lotes como grupos secundarios → vista de lote | R2.1, R1.1, R7.1 |
| §Navegación — tab `Animales` queda intacta | R2.3 |
| §Las 3 ops — vacunación masiva (`sanitary_events`, gating `vacunacion`) | R3.1, R1.5 |
| §Las 3 ops — destete masivo (`weaning`, transición ternero) | R3.2, R5.5 |
| §Las 3 ops — castración masiva (`castracion`, efecto categoría pendiente) | R3.3, R5.7 |
| §Selección — default todo + filtro categoría/sexo | R4.1 |
| §Selección — preview obligatorio + confirmación | R4.2 |
| §Selección — skip-and-report (ya aplicado / archivado / no corresponde) | R4.3, R4.4 |
| §Selección — cada evento individualmente corregible (R6.8.1 spec 02) | R4.5 |
| §Selección — un evento por animal (mellizos: por ternero) | R3.4, R3.5 |
| §Selección — filtro candidatos `status = 'active'` | R1.3 |
| §Selección — `category_override = true`: preview avisa + ofrece revertir | R5.6 |
| §Gating — mismo gating que maniobras (data_key enabled) | R1.5, R1.6 |
| §Gating — lote cross-rodeo (ofrecer si algún rodeo; saltar los que no) | R7.1, R7.2 |
| §Gating — capa DB valida por animal | R7.3, R9.2 |
| §Offline — N mutaciones encoladas, preview+creación offline | R10.1, R10.5 |
| §Offline — mutaciones independientes, no atómicas | R10.2 |
| §Offline — rechazos por animal (spec 09 R11.5) + contador X de N | R10.3, R10.4 |
| §Offline — no duplicar (idempotente por animal+tipo+fecha) | R6.1, R6.2, R6.3 |
| §Roles — mismos roles que el evento individual | R9.1 |
| §Pendientes — efecto categoría castración → Facundo | R5.7 |
| §Pendientes — destete: marca en la madre → diferido Facundo | nota DIFERIDO en US-2 |
| §Pendientes — gating lote cross-rodeo → resuelto en design | R7.1, R7.2, design §Gating cross-rodeo |
| §Pendientes — performance N mutaciones offline → nota design | R10.5, design §Offline/performance |

## Historial de refinamiento

- **2026-06-01 (sesión 21) — Redacción inicial** desde `context.md` (Gate 0 aprobado por Raf, sesión 18). Traducción a EARS de las decisiones lockeadas; sin re-decidir contexto ni edge cases. Se aplicaron los overrides del leader de esta corrida: roles = los mismos del evento individual (R9.1); efecto de categoría de castración TENTATIVO pendiente de Facundo (R5.7); transición de destete TENTATIVA Tier 2 pendiente de Facundo (R5.5); marca en la madre del destete diferida/fuera de MVP (nota DIFERIDO). Resueltos en design los puntos delegados: gating cross-rodeo (R7.x), idempotencia/no-duplicación (R6.x), performance offline de N mutaciones (R10.5), filtro `status='active'` (R1.3), override en destete (R5.6). Declarado el delta de backend (`data_key castracion`) y la condición SCHEMA-SENSITIVE → Gate 1 antes de Puerta 1 (ver `design.md`). NO se tocó `feature_list.json` (status flip pendiente de la terminal de coordinación).

- **2026-06-01 (sesión 21) — Refinamiento por Gate 1 (FAIL: 2 HIGH + 2 MEDIUM + 1 LOW)** (`progress/security_spec_10-operaciones-rodeo.md`). Aplicados los 5 fixes a los 3 docs in-place, IDs de R preservados (re-verificado cada hecho con grep contra las migrations citadas):
  - **H1 (HIGH) — nombre de función de trigger inexistente → castración fail-OPEN.** El design §4 reescribía `tg_sanitary_gating`, que NO existe. La función real es **`tg_sanitary_events_gating`** (0054 L97/L108, re-revocada en 0055). Corregido en design §4 (bloque SQL + prosa §5/§6) y tasks T-DB.3: `create or replace` sobre el nombre real, reemplazando SOLO el cuerpo (el trigger `sanitary_events_gating` de 0054 no se re-crea), preservando la rama de vacunación + fail-closed + `revoke execute`.
  - **H2 (HIGH) — `created_by` afirmado "no spoofeable" siendo falso (Path A: corregir, no arreglar el sistémico).** Las tablas de evento usan `tg_set_created_by_auth_uid` (0024, "solo si NULL", spoofeable intra-tenant), no el `tg_force_created_by_auth_uid` (0043) no-spoofeable. Corregido R9.3, design §5, acceptance global y T-DB.8 para decir la verdad: `created_by` **defaultea** a `auth.uid()` si el cliente lo omite, pero **no se fuerza**; spoofeo intra-tenant es condición sistémica pre-existente (SEC-SPEC-03), heredada de specs 02/03/09, **no** brecha cross-tenant. Agregada fila D7 a design §9 (backlog del fix transversal — confirma Raf).
  - **M1 (MEDIUM) — D4 cerrado: marcador de castración robusto.** Cerrado D4 (ya no a elección del implementer): marcador canónico constante `product_name='Castración'` seteado programáticamente; comparación del trigger robusta a acento/caso vía `translate()` portable (`unaccent` NO disponible en el proyecto — verificado: solo `pg_trgm`). Documentado como defensa en profundidad, no frontera de authz. Actualizados design §2.1/§4/§9-D4, R3.3, tasks T-DB.3/T-DB.5.
  - **M2 (MEDIUM) — id determinístico obligatorio.** Hecho firme (no opcional): `id` (PK) determinístico UUIDv5 sobre `(animal, tipo, fecha)` → dedup por la PK existente, sin unique constraint nuevo. Actualizados R6.1, design §7/§9-D5, tasks T-CL.5/T-CL.6.
  - **L1 (LOW) — seed del `system_default_fields` por `.code`, no `.name`.** El `WHERE sp.name='bovino' and s.name='cría'` no matchearía (los valores reales son `'Bovino'`/`'Cría'`); el seed canónico de 0018/0014 usa `.code`. Corregido design §4 (`sp.code='bovino' and s.code='cria'`) y tasks T-DB.2. También corregida la numeración tentativa de migration (0056 está TOMADO; última as-built 0058 → usar ≥0059) en design §9-D6 y T-DB.1.
  - Cobertura context→R intacta; ningún ID de R cambió. NO se tocó `feature_list.json` ni `progress/` (coordinación aparte). Status permanece `spec_ready`.
