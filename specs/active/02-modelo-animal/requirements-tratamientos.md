# Spec 02 — Delta `tratamientos` · Requirements (EARS)

> **Delta Nivel B (ADR-028)** sobre la feature `done` **02-modelo-animal**. Fuente de verdad del contexto:
> `specs/active/02-modelo-animal/context-tratamientos.md` (Gate 0 CERRADO 2026-07-10, Raf una-por-una). Este
> documento traduce esas decisiones a EARS; **no re-decide** nada.
>
> **Pedido origen**: ítem **E** del triage `docs/correcciones-demo-facundo-padre-2026-07-10.md` (Facundo + su
> padre, productor real). Vigilar/controlar los tratamientos que aplica el peón: **QUÉ**, **CUÁNTO**, **CADA
> CUÁNTO** y **A QUÉ ANIMAL**.
>
> **SCHEMA-SENSITIVE → Gate 1 obligatorio** (`security_analyzer` modo `spec`) antes de Puerta 1. Toca tabla
> nueva + RLS + FK + denormalización de tenant + sync stream. Focos de seguridad al final (§ "Focos Gate 1").
>
> IDs `RTR.x` — **estables** (no reordenar tras aprobar). Cada `RTR.x` es verificable por ≥1 test.

## Alcance

**Dentro**: tabla `treatments` (header) + `treatment_id` FK en `sanitary_events` + RLS/grants/triggers + sync
stream · iniciar / registrar aplicación / finalizar **desde la ficha** · derivación "en tratamiento" · marca de
color distintiva (ficha + fila de lista) · pin de los en-tratamiento arriba en la **lista general** y la **lista
del rodeo** · sección "Tratamientos" en la ficha con sus aplicaciones · `next_dose_date` opcional mostrado ·
offline-first (PowerSync).

**Fuera (v2 / post-MVP)**: iniciar desde la **maniobra** (D-6, diferido) · recordatorios **push** de próxima
dosis (D-5) · **reporte agregado** "N en tratamiento" (D-7) · migración de datos de `deworming`/`treatment`
puntuales existentes (beta sin data real → N/A) · edición/soft-delete del **header** de un tratamiento desde la
UI (solo iniciar → aplicar → finalizar; ver Decisión de criterio §2).

---

## RTR.1 — Iniciar tratamiento (desde la ficha)

- **RTR.1.1** — El sistema deberá ofrecer, en la ficha del animal, una acción para iniciar un tratamiento.
- **RTR.1.2** — Cuando el usuario inicia un tratamiento, el sistema deberá crear un registro en `treatments` con
  `animal_profile_id` (el del animal de la ficha), `kind`, `product_name`, `notes`, `started_at` y
  `ended_at = NULL`.
- **RTR.1.3** — Mientras el usuario inicia un tratamiento, el sistema deberá exigir un `kind` ∈
  {`antibiotico`, `antiparasitario`, `otro`}. *(D-3; vacuna NO — es campaña, va por maniobra.)*
- **RTR.1.4** — Mientras el usuario inicia un tratamiento, el sistema deberá exigir un `product_name` no vacío.
- **RTR.1.5** — Donde el usuario cargue un comentario al iniciar, el sistema deberá guardarlo en `notes`.
- **RTR.1.6** — Donde el usuario cargue la primera aplicación al iniciar, el sistema deberá crear además un
  `sanitary_event` linkeado al tratamiento (según **RTR.2**).
- **RTR.1.7** — El sistema deberá ofrecer el inicio de un tratamiento **solo desde la ficha del animal** (no desde
  la maniobra en v1). *(D-6.)*
- **RTR.1.8** — Si el animal no está activo (status ≠ `active`), entonces el sistema no deberá ofrecer iniciar un
  tratamiento. *(Paridad con el resto de acciones de la ficha: un archivado no recibe eventos nuevos.)*
- **RTR.1.9** — El sistema deberá rechazar server-side (CHECK) un `product_name` de más de
  `TREATMENT_PRODUCT_MAX_LENGTH` = **120** caracteres. *(SEC-TRT-02: todo input con tope server-side; la misma
  constante nombrada gobierna el sanitizer del cliente.)*
- **RTR.1.10** — El sistema deberá rechazar server-side (CHECK) un `notes` de más de
  `TREATMENT_NOTES_MAX_LENGTH` = **1000** caracteres. *(SEC-TRT-02; misma constante en el sanitizer del
  cliente.)*

## RTR.2 — Registrar aplicación (N por tratamiento)

- **RTR.2.1** — El sistema deberá ofrecer, para un tratamiento **en curso** (`ended_at IS NULL`), registrar una
  aplicación.
- **RTR.2.2** — Cuando el usuario registra una aplicación, el sistema deberá crear un `sanitary_event` con
  `treatment_id` = el tratamiento, `animal_profile_id` = el del tratamiento, `product_name` (por defecto el del
  tratamiento), `event_type` derivado del `kind` del tratamiento y `event_date`.
- **RTR.2.3** — Donde el usuario cargue dosis (`dose_ml`), vía (`route`) o próxima dosis (`next_dose_date`), el
  sistema deberá guardarlas en la aplicación.
- **RTR.2.4** — El sistema deberá permitir múltiples aplicaciones (N) sobre un mismo tratamiento en curso.
- **RTR.2.5** — Si el usuario intenta registrar una aplicación sobre un tratamiento **finalizado**, entonces el
  sistema no deberá permitirlo. *(Ver Decisión de criterio §3.)*
- **RTR.2.6** — El sistema no deberá permitir linkear una aplicación (`sanitary_event.treatment_id`) a un
  tratamiento de **otro animal**. *(Anti-IDOR; ver RTR.7.3.)*
- **RTR.2.7** — El sistema no deberá gatear una aplicación de tratamiento (`sanitary_event` con `treatment_id`
  no nulo y `event_type ≠ 'vaccination'`) por la configuración de `data_keys` del rodeo. *(Un animal enfermo se
  trata sin importar la plantilla del rodeo: el gating de `0091`/`0054` es para la RECOLECCIÓN en maniobras, no
  para una acción reactiva de salud. Decisión del leader — Gate 1. Toca la función gateada
  `tg_sanitary_events_gating`, 0091 → re-Gate-1.)*
- **RTR.2.8** — El sistema deberá seguir gateando por `data_keys` del rodeo un `sanitary_event` con
  `event_type = 'vaccination'` **aunque** traiga `treatment_id` del mismo animal. *(LOW-1, hardening del
  re-Gate-1: una aplicación de tratamiento nunca es legítimamente `vaccination` — la vacuna es campaña por
  maniobra, no un `kind` de tratamiento; acotar el short-circuit cierra la auto-exención same-animal del gating
  de `vacunacion`, defensa-en-profundidad within-tenant.)*

## RTR.3 — Finalizar tratamiento

- **RTR.3.1** — El sistema deberá ofrecer "Finalizar tratamiento" para un tratamiento en curso.
- **RTR.3.2** — Cuando el usuario finaliza un tratamiento, el sistema deberá setear `ended_at` con el instante de
  finalización.
- **RTR.3.3** — Mientras un tratamiento tenga `ended_at` no nulo, el sistema no deberá considerarlo "en
  tratamiento".
- **RTR.3.4** — Si el usuario finaliza un tratamiento ya finalizado, entonces el sistema no deberá alterar su
  `ended_at` original *(operación idempotente, guard `ended_at IS NULL`)*.

## RTR.4 — Derivación "en tratamiento" + marca de color

- **RTR.4.1** — Mientras un animal tenga ≥1 tratamiento con `ended_at IS NULL` y `deleted_at IS NULL`, el sistema
  deberá considerarlo "en tratamiento".
- **RTR.4.2** — El sistema deberá derivar "en tratamiento" **solo** de `treatments` (sin columna de estado
  redundante en `animal_profiles`).
- **RTR.4.3** — Mientras un animal esté "en tratamiento", el sistema deberá mostrar en su **ficha** una marca de
  color que lo señale.
- **RTR.4.4** — Mientras un animal esté "en tratamiento", el sistema deberá mostrar la **misma marca** en su fila
  de lista.
- **RTR.4.5** — El sistema deberá usar para la marca un **color distintivo propio** (sanitario, azul/turquesa),
  que **no deberá** reusar el terracota (alertas / aborto / futuro torito) ni el amarillo del CUT ni el verde de
  identidad. *(D-1; el token exacto lo fija el leader en Gate 2.5.)*
- **RTR.4.6** — Cuando un tratamiento se finaliza y el animal no tiene otro tratamiento en curso, el sistema
  deberá quitar la marca.

## RTR.5 — Pin en las listas (en-tratamiento arriba)

- **RTR.5.1** — Mientras haya animales "en tratamiento" en la **lista general** de animales, el sistema deberá
  ordenarlos antes que el resto.
- **RTR.5.2** — Mientras haya animales "en tratamiento" en la **lista del rodeo**, el sistema deberá ordenarlos
  antes que el resto. *(D-4: ambas listas.)*
- **RTR.5.3** — Dentro de cada grupo (en-tratamiento / resto), el sistema deberá conservar el orden actual
  (`created_at`/`updated_at` DESC) como criterio secundario.
- **RTR.5.4** — Cuando un tratamiento se finaliza y el animal no tiene otro en curso, el sistema deberá quitarlo
  de la prioridad (des-pin).

## RTR.6 — Roles (quién puede)

- **RTR.6.1** — El sistema deberá permitir **iniciar** un tratamiento a cualquier rol **activo** del campo del
  animal, incluido el peón. *(D-2.)*
- **RTR.6.2** — El sistema deberá permitir **registrar una aplicación** a cualquier rol activo del campo del
  animal, incluido el peón. *(D-2.)*
- **RTR.6.3** — El sistema deberá permitir **finalizar** un tratamiento a cualquier rol activo del campo del
  animal, incluido el peón. *(D-2; ver Decisión de criterio §1 — autorización de la UPDATE.)*
- **RTR.6.4** — El sistema no deberá exigir rol de owner para ninguna de las tres acciones. *(D-2.)*

## RTR.7 — RLS / multi-tenant / anti-IDOR (SCHEMA-SENSITIVE)

- **RTR.7.1** — El sistema deberá scopear `treatments` por tenant mediante RLS **fail-closed**: solo un usuario
  con rol activo en el campo del animal (`has_role_in(establishment_of_profile(animal_profile_id))`) deberá poder
  leer/escribir sus tratamientos.
- **RTR.7.2** — El sistema deberá **forzar** `treatments.establishment_id` desde el perfil del animal
  (anti-spoof), ignorando cualquier valor del cliente, en INSERT **y** UPDATE.
- **RTR.7.3** — El sistema no deberá permitir que un `sanitary_event.treatment_id` referencie un tratamiento cuyo
  `animal_profile_id` difiera del de la aplicación *(cross-animal / cross-tenant → rechazo)*. La validación deberá
  correr en **INSERT y en UPDATE incondicional** de la aplicación *(SEC-TRT-03: un UPDATE del `animal_profile_id`
  del evento — cuya policy no tiene `with check` — no deberá poder mover la aplicación a otro animal sin
  re-validar el link)*.
- **RTR.7.4** — El sistema deberá excluir del wire de sincronización los tratamientos de campos donde el usuario
  no tiene rol activo *(la stream es la frontera de autorización; no hay RLS sobre el WAL — ADR-025/026)*.
- **RTR.7.5** — Si no se puede derivar el tenant del perfil al insertar un tratamiento (perfil inexistente),
  entonces el sistema no deberá crear el tratamiento (error `23503`, fail-closed).
- **RTR.7.6** — El sistema deberá filtrar `treatments.deleted_at IS NULL` por defecto en las lecturas, el `EXISTS`
  del derivado y el scope de la stream *(filtro DEFENSIVO de la convención de soft-delete, principio 4 de
  architecture).* **En v1 el header NO se soft-deletea por UPDATE**: el trigger de inmutabilidad (RTR.7.8) pinnea
  `deleted_at`, así que ningún caller lo puede setear; el único borrado de un tratamiento es el **hard-delete por
  CASCADE** al borrar el perfil del animal. *(`deleted_at` queda hoy siempre NULL; el soft-delete del header por
  UPDATE es **diferido a v2** — requeriría relajar su inmutabilidad a owner|autor + una UI de borrado.)*
- **RTR.7.7** — El sistema deberá forzar `treatments.created_by = auth.uid()` server-side (anti-spoof), para que
  el "quién" de la vigilancia sea confiable, y **no deberá** permitir que un UPDATE lo altere *(inmutable, ver
  RTR.7.8)*.
- **RTR.7.8** — El sistema no deberá permitir que un UPDATE de `treatments` altere ninguna columna salvo la
  finalización: `created_by`, `animal_profile_id`, `establishment_id`, `kind`, `product_name`, `notes`,
  `started_at`, `created_at` y `deleted_at` deberán ser **inmutables** en UPDATE, y `ended_at` solo deberá poder
  pasar de NULL a un instante (nunca de un instante a NULL ni a otro instante). *(SEC-TRT-01: cierra el
  audit-tampering — el peón vigilado no puede editar/ocultar/des-finalizar el registro por PostgREST directo, pese
  a la policy UPDATE amplia. `establishment_id`/`animal_profile_id` se pinnean juntos para que un cambio de perfil
  no deje el tenant inconsistente — ver design §2 (3c). Patrón as-built de columnas inmutables tipo `animal_events`
  (0034) + force de `0077`.)*

## RTR.8 — Offline-first (PowerSync)

- **RTR.8.1** — El sistema deberá permitir **iniciar** un tratamiento sin conexión (escritura CRUD-plano local) y
  sincronizarlo al reconectar.
- **RTR.8.2** — El sistema deberá permitir **registrar una aplicación** sin conexión y sincronizarla al
  reconectar. *(Caso dominante: el peón en la manga sin señal.)*
- **RTR.8.3** — El sistema deberá permitir **finalizar** un tratamiento sin conexión y sincronizarlo al
  reconectar.
- **RTR.8.4** — Mientras esté offline, el sistema deberá reflejar la marca y el pin "en tratamiento" con los datos
  locales (la fila local aparece/actualiza al instante).
- **RTR.8.5** — Si el upload de una escritura de tratamiento es rechazado por RLS/CHECK, entonces el sistema
  deberá superficiarlo por el canal de status del sync *(no por el return del write, que ya devolvió ok con la
  fila local — paridad con el contrato de escritura de eventos, spec 15 R6.2/R8.1)*.

## RTR.9 — Ficha: sección "Tratamientos" + timeline

- **RTR.9.1** — El sistema deberá mostrar en la ficha del animal una sección "Tratamientos" con los tratamientos
  del animal *(en curso primero)*.
- **RTR.9.2** — El sistema deberá mostrar, por tratamiento, su `kind`, `product_name`, comentario, estado (en
  curso / finalizado) y sus aplicaciones.
- **RTR.9.3** — El sistema deberá mostrar, por aplicación, su fecha, la dosis y la vía si están, y la próxima
  dosis (`next_dose_date`) si está. *(Vigilancia: QUÉ / CUÁNTO / CADA CUÁNTO.)*
- **RTR.9.4** — El sistema deberá seguir mostrando cada aplicación en el **timeline** del animal *(las
  aplicaciones son `sanitary_events`; el timeline las rinde como hasta ahora)*.
- **RTR.9.5** — El sistema no deberá emitir recordatorios push por `next_dose_date` *(post-MVP, D-5)*.

## RTR.10 — Fuera de alcance (declarativo, no testeable)

- **RTR.10.1** — El sistema no deberá ofrecer iniciar un tratamiento desde la maniobra en v1 *(diferido, D-6)*.
- **RTR.10.2** — El sistema no deberá incluir un reporte agregado "N animales en tratamiento" en v1 *(D-7)*.

---

## Trazabilidad al contexto (cada "Caso y decisión" del Gate 0 cubierto por ≥1 RTR)

| Decisión Gate 0 | Requirement(s) |
|---|---|
| D-1 Marca color distintivo propio (no terracota) | RTR.4.3, RTR.4.4, **RTR.4.5** |
| D-2 Quién: cualquier rol del campo (incl. peón) | RTR.6.1, RTR.6.2, RTR.6.3, RTR.6.4 |
| D-3 Tipos: antibiótico / antiparasitario / otro | **RTR.1.3** |
| D-4 Pin en ambas listas | RTR.5.1, **RTR.5.2** |
| D-5 `next_dose_date` opcional, mostrado, sin push | RTR.2.3, RTR.9.3, **RTR.9.5** |
| D-6 Solo desde la ficha (maniobra = v2) | **RTR.1.7**, RTR.10.1 |
| D-7 Reporte agregado = post-MVP | **RTR.10.2** |
| Ciclo iniciar → aplicar (N) → finalizar | RTR.1, RTR.2, RTR.3 |
| Derivado "en tratamiento" (sin flag en `animal_profiles`) | RTR.4.1, **RTR.4.2** |
| Al finalizar: desmarca + despinnea | RTR.4.6, RTR.5.4 |
| Offline (el registro debe andar sin señal) | RTR.8.1–RTR.8.5 |
| RLS por tenant / multi-tenant | RTR.7.1–RTR.7.8 |
| Aplicaciones = `sanitary_events` linkeados | RTR.2.2, RTR.9.4 |
| Aplicaciones independientes del gating de maniobra (0091) | **RTR.2.7**, RTR.2.8 |
| Topes server-side de texto libre (SEC-TRT-02) | RTR.1.9, RTR.1.10 |
| Inmutabilidad del header en UPDATE (SEC-TRT-01) | RTR.7.7, **RTR.7.8** |

---

## Decisiones de criterio propio (a validar en Puerta 1)

Traducciones del contexto que tomé por criterio y que Raf debería confirmar; ninguna re-abre el Gate 0, pero
tienen consecuencia de seguridad o de UX.

1. **Autorización de la UPDATE de `treatments` (finalizar) — `has_role_in` + inmutabilidad de columnas.** D-2 dice
   "cualquier rol del campo (incl. peón)" para iniciar/aplicar/**finalizar**. Traducción fiel → la policy **UPDATE**
   de `treatments` usa `has_role_in(establishment_of_profile(animal_profile_id))` (cualquier rol activo finaliza), a
   diferencia del patrón de las 5 tablas de evento (`is_owner_of OR created_by = auth.uid()`). **RECONCILIADO tras
   Gate 1 (SEC-TRT-01, HIGH)**: como la RLS es row-level, una UPDATE amplia por sí sola dejaba PATCH-ear cualquier
   columna (`created_by`, `deleted_at`, `product_name`/`kind`/`notes`/`started_at`, o des-finalizar) por PostgREST
   directo — audit-tampering del propio peón vigilado. El "soft-delete solo-UI" ya NO alcanza como mitigación. Se
   agrega un **trigger `BEFORE UPDATE` de inmutabilidad de columnas** (RTR.7.8): la única mutación permitida es
   `ended_at` NULL→instante (finalizar, idempotente). Con eso la UPDATE amplia queda segura: cualquier rol puede
   FINALIZAR, nadie puede editar/ocultar/reabrir. *Alternativa descartada*: `owner|creator` (paridad con eventos) —
   pero un 2º peón no podría finalizar un tratamiento que no inició. **Recomendación: `has_role_in` (fiel a D-2) +
   trigger de inmutabilidad + sin UI de borrado del header en v1.**

2. **`created_by` forzado (variante FORCE, 0043), no "solo si NULL", + inmutable en UPDATE.** Para que el "quién
   aplicó/inició" de la vigilancia sea confiable (el peón no puede atribuírselo a otro), `treatments.created_by` se
   **fuerza** server-side con `tg_force_created_by_auth_uid` (0043) en INSERT, y el trigger de inmutabilidad (§1 /
   RTR.7.8) lo **pinnea a OLD** en UPDATE (cierre de SEC-TRT-01). *(Las aplicaciones = `sanitary_events` conservan
   su `tg_set_created_by_auth_uid` as-built, sin cambio.)*

3. **Aplicaciones solo sobre tratamientos en curso (RTR.2.5).** Un tratamiento finalizado no recibe aplicaciones
   nuevas (el ciclo es iniciar → aplicar → finalizar). Si el productor se equivocó al finalizar, en v1 reabre
   iniciando otro tratamiento *(no hay "reabrir" en v1)*. Recomendación: aceptar; "reabrir" = backlog.

4. **Mapeo `kind` → `sanitary_event_type` de la aplicación.** `antibiotico → treatment`, `antiparasitario →
   deworming`, `otro → other` (enum as-built de `0027`). Mantiene coherente el render del timeline
   existente. Recomendación: aceptar.

5. **Aplicaciones visibles en dos lentes (sección Tratamientos agrupada + timeline cronológico).** Cada
   aplicación aparece agrupada bajo su tratamiento en la sección **y** suelta en el timeline (es un
   `sanitary_event`). Para desambiguar, el nodo del timeline de una aplicación **debería** anotarse ("parte de
   un tratamiento") proyectando `treatment_id` en su payload — marcado **opcional** en el design. Recomendación:
   mantener ambas lentes; anotación opcional.

6. **Marca en la búsqueda.** La marca/pin se aplica en la lista general y la del rodeo (`buildAnimalsListQuery`).
   Los **resultados de búsqueda** (otra superficie) no muestran la marca en v1. Recomendación: aceptar (menor).

7. **`started_at` seteado en el cliente** (wall-clock de inicio) para que la ficha lo muestre offline; el server
   conserva ese valor (default `now()` solo como fallback). Menor.

---

## Historial de refinamiento

- **2026-07-10** — Redacción inicial del delta (spec_author) a partir de `context-tratamientos.md` (Gate 0
  CERRADO). Pendiente: Gate 1 (schema) → Puerta 1.
- **2026-07-10** — Fold de los findings de **Gate 1 FAIL** (5 fixes; re-Gate-1 pendiente):
  - **SEC-TRT-01 [HIGH]** — trigger `BEFORE UPDATE` de inmutabilidad de columnas en `treatments` (solo `ended_at`
    NULL→instante mutable). Nuevos: **RTR.7.7** (created_by inmutable) + **RTR.7.8**; reconciliadas Decisiones §1/§2.
  - **SEC-TRT-02 [MED]** — CHECKs de tope server-side: `product_name` ≤ 120, `notes` ≤ 1000 (constantes
    nombradas). Nuevos: **RTR.1.9**, **RTR.1.10**.
  - **SEC-TRT-03 [MED]** — trigger anti-IDOR del `treatment_id` pasa a `BEFORE INSERT OR UPDATE` incondicional.
    Actualizado: **RTR.7.3**.
  - **SEC-TRT-04 [LOW]** — `revoke execute` en las funciones `security definer` nuevas (design).
  - **Colisión gating 0091** — las aplicaciones de tratamiento (`treatment_id` no nulo) quedan EXENTAS del
    `tg_sanitary_events_gating`. Nuevo: **RTR.2.7** (toca función gateada → re-Gate-1).
- **2026-07-10** — **Re-Gate-1: PASS.** Reconciliación de los 2 findings LOW no bloqueantes:
  - **LOW-1** — short-circuit del gating acotado a `treatment_id IS NOT NULL AND event_type <> 'vaccination'`
    (cierra la auto-exención same-animal del gating de `vacunacion`). Nuevo: **RTR.2.8**; RTR.2.7 precisado;
    design §2 (6) + foco Gate 1 #8 actualizados. Corrección de la imprecisión: el anti-IDOR (SEC-TRT-03) cubre el
    caso **cross-animal**; la auto-exención same-animal de `vaccination` era un residual de defensa-en-profundidad
    (within-tenant), cerrado por el acote.
  - **LOW-2** — reconciliado el soft-delete: en v1 el header NO se soft-deletea por UPDATE (inmutable), solo
    hard-delete por CASCADE; **RTR.7.6** + comentario RLS §2 (5) corregidos; soft-delete por UPDATE diferido a v2.
    Nota (no CHECK) sobre `ended_at >= started_at`: no se agrega constraint duro por riesgo de clock-skew
    offline (design §2, tras la tabla).
