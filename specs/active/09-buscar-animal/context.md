# Spec 09 — BUSCAR ANIMAL — Auditoría de edge cases (Gate 0 retroactivo)

**Status**: Pendiente de aprobación de Raf.
**Fecha**: 2026-05-29 (sesión 18)
**Conducido por**: leader + Raf (1 agente Explore para pre-armar la lista de gaps + verificación contra specs reales + 1 ronda de AskUserQuestion, 3 decisiones).
**Naturaleza**: 09 está **grandfathered** (spec aprobada 2026-05-26, pre-Gate-0). Nunca tuvo la auditoría de edge cases que sí tuvieron 01 y 02 (sesión 17). Raf la pidió al cierre de la tanda de refinamiento de la sesión 18. Este doc registra las decisiones; el **fold a requirements/design lo hace el spec_author** (no se reescribe la spec acá).
**Related**: spec 02 (R4.11 transferencia, R4.13 inmutabilidad, R4.14 baja, R5.1 transferir/alta), spec 04 (`context.md`, listener BLE + `useBusyMode`), spec 01 (switch de establecimiento R6.8.1).

> Contrato humano del Gate 0 (ADR-022): contexto validado + edge cases resueltos. Acá se cierran los 3 huecos que la spec 09 dejó explícitamente "a definir en design", más las notas de gaps ya cubiertos.

## Resultado de la auditoría

El Explore relevó ~15 gaps; la verificación contra las specs reales descartó la mayoría como **ya cubiertos** (ver §"Gaps ya cubiertos"). Quedaron **3 decisiones reales**, todas sobre huecos que la propia spec 09 difería a "design".

## Casos y decisiones (los 3 que requerían decisión)

### D1 — Cambio de establecimiento a mitad de un flujo abierto (cubre R10.3)
- **Decisión: BLOQUEAR el cambio de campo mientras hay un flujo abierto.**
- Mientras una pantalla CREATE / EDIT / `BulkTagAssignmentScreen` esté abierta, el **switch de establecimiento se deshabilita** (o pide cerrar el form primero). Protege el trabajo en curso y evita estado cross-tenant colgando.
- **Implementación sugerida**: un flag global "flujo abierto" (hermano de `useBusyMode` de spec 04/09) que el switch consulta. Resuelve R10.3 (que decía "cancelar o reescopar — decisión de detalle en design").
- **Delta sobre spec 01**: el switch del header (R6.8.1) + "Mis campos" deben respetar el guard "flujo abierto". Nota para el spec_author al foldar.

### D2 — Bastonear un TAG activo en OTRO de tus campos (R3.4 vs R4.11 de spec 02)
- **Decisión (refinada sesión 18): IMPLEMENTAR transferencia que PRESERVA la historia en MVP.**
- Hoy: R3.4 ofrece "dar de alta en este campo" cuando un TAG global no tiene perfil activo en el campo activo; pero si el animal está **activo en otro establecimiento**, R4.11 de spec 02 rechaza el alta (un animal = un campo; la transferencia estaba marcada "futura").
- Flujo MVP: cuando el animal tiene perfil activo en otro campo **donde el usuario tiene rol**, ofrecer **"transferir a este campo"** = crear el nuevo `animal_profile` en el campo activo (reusando el `animal_id` global) **+ re-apuntar la historia del perfil viejo al nuevo** + archivar el perfil viejo. El TAG (identidad global) se preserva. Se descartó la versión "mínima" (perfil nuevo limpio + viejo huérfano) porque dejaba al animal **sin historial visible** en el campo destino — inaceptable con analytics como pilar.
- **Re-parenting de la historia** (lo que hace "preservar"): los eventos tipados (`weight/reproductive/sanitary/condition_score/lab`), las observaciones (`animal_events`), el `animal_category_history` y los vínculos reproductivos (`reproductive_events.calf_id`/`bull_id`) del perfil viejo se **re-apuntan** al `animal_profile` nuevo. Tras el re-parenting, el perfil viejo queda sin eventos y se archiva/soft-deletea.
- **Invariante preservado**: R4.11 sigue valiendo (nunca dos perfiles activos simultáneos). La operación debe ser **atómica** (RPC / Edge Function) para no dejar el animal con cero o dos perfiles activos ni eventos a medio re-apuntar.
- **⚠️ Complejidades nuevas que el design/Gate 1 debe resolver** (por elegir preservar historia):
  - **`session_id` cross-tenant**: los eventos re-apuntados llevan `session_id` de sesiones de MODO MANIOBRAS del campo **viejo** (otro establishment). Re-apuntar el evento sin re-apuntar/anular su `session_id` deja un puntero cross-tenant. Decisión de design: nullear `session_id` en la transferencia, o conservarlo como referencia histórica read-only.
  - **Colisión de `idv`**: el `idv` del perfil viejo (único por establishment) puede colisionar con un `idv` existente en el campo destino. La transferencia debe detectarlo y resolver (pedir nuevo idv / dejar NULL).
  - **Linaje cruzado**: si el animal era madre/toro de terneros que **siguen** en el campo viejo, sus `calf_id`/`bull_id` apuntan al perfil viejo. Re-apuntarlos al nuevo cruzaría el vínculo entre campos. Decisión de design: qué pasa con la descendencia que no se transfiere.
- **⚠️ Seguridad (write cross-tenant)**: la transferencia escribe sobre datos del **establecimiento de origen** (archiva el perfil viejo, re-apunta sus eventos). Solo se ofrece si el usuario tiene **rol activo en ambos** campos (origen y destino). Si NO tiene rol en el de origen, el animal no es visible vía RLS → cae en el camino de unique-violation global (ver D-cubierto sobre R4.8). **Esta operación dispara Gate 1 de seguridad** cuando se redacte la spec (cross-tenant write + re-parenting masivo).
- **Interacción con SIGSA (08)**: el marcador de declaración SIGSA vive por (establecimiento, animal); el perfil nuevo arranca **no declarado** en el campo destino (declara bajo su propio RENSPA). El re-parenting NO trae el estado de declaración del campo viejo.
- **Delta sobre spec 02**: R4.11 pasa de "transferencia futura" → **flujo de MVP**, ahora con **re-parenting de historia** (más que el "soft-delete viejo + alta nuevo" que R4.11 describía). Define el RPC/Edge Function atómico de transferencia + las 3 complejidades de arriba.
- **Scope**: es **la decisión más pesada del audit** — mini-feature con re-parenting cross-tenant + Gate 1. Candidata a su propia sub-spec. Anotada como tal.

### D3 — Campos editables en EDIT (cubre R5.2 "resto de columnas mutables")
- **Decisión: set acotado editable inline + baja en sub-flujo aparte.**
- **Editables inline**: `visual_id_alt`, `category` (vía `category_override`), `breed`, `coat_color`, `notes`, `management_group_id` (lote).
- **Read-only**: `tag_electronic`, `idv` (R4.13 inmutabilidad), `animal_id`, `establishment_id`, `rodeo_id` (cambio de rodeo bloqueado en MVP, R4.5.1), `created_at`/`updated_at`/`deleted_at`.
- **Históricos — editables CON confirmación**: `birth_date`, `entry_date`, `entry_weight`, `entry_origin`, `birth_weight`, `teeth_state`, `is_cut`. (`teeth_state`/`is_cut` también los toca el workflow dientes/CUT de spec 03.)
- **Egreso/baja** (`status`, `exit_date`, `exit_reason`, `exit_weight`, `exit_price`): **NO inline** → **sub-flujo dedicado "Dar de baja"** (R4.14 de spec 02, "desde la ficha"). Evita bajas accidentales por edición casual.
- **Reversibilidad de baja (default)**: corregir una baja errónea = el owner re-edita `status` a `active` (tratado como corrección), no es un flujo destacado. Objetable si Raf quiere baja irreversible.
- **Delta**: el fold de R5.2 enumera explícitamente este set. Sin cambio de modelo (las columnas ya existen en `animal_profiles`, R4.1 de spec 02).

## Gaps ya cubiertos (sin decisión — solo notas para el spec_author al foldar)
- **Unique-violation de TAG cross-tenant**: si se bastonea un TAG de un animal en un campo que el usuario NO ve (sin rol), R3.1 no matchea → CREATE → el unique GLOBAL de `animals.tag_electronic` (migration 0019) rechaza en commit (R4.8). **Mejorar el copy** de R4.8 para este caso (hoy sería críptico). Caso extremo (los RFID son únicos globalmente por SENASA; dos animales reales no comparten TAG).
- **`useBusyMode` ante lectura BLE durante form abierto**: el listener se desactiva y las lecturas **se descartan** (no se encolan). Default seguro (spec 04 `context.md` + spec 09 T4.5).
- **Fechas de evento retroactivas**: los eventos tipados tienen `event_date` (default `now()`, editable a pasado con validación `event_date <= now()`). Detalle del schema de eventos de spec 02; el form de R5.4 lo respeta.
- **Mellizos en `AddEventSheet`**: un evento `birth` con N terneros (tabla puente `birth_calves`, spec 02 sesión 17). El form de R5.4 para `birth` debe permitir 1+ terneros; R5.8 renderiza múltiples links madre→ternero. Ya cubierto por spec 02.
- **Dientes/CUT**: `teeth_state` es atributo editable (D3); la transición a CUT es manual con prompt (spec 02 sesión 17). No es evento tipado nuevo.
- **R7.2 candidatos**: ya filtra `status='active'` + `deleted_at IS NULL` + `tag_electronic IS NULL` correctamente. Un animal archivado no aparece. OK.
- **R6.4 desempate**: `order by created_at asc, id asc limit 1` (UUID rompe empate). Trivial.
- **`assignTagToAnimal`**: vive en `services/animals.ts` de spec 02 (ya en T3.2). OK.
- **Carrera offline (mismo TAG en 2 devices)**: cubierta por R11.5 + trigger single-writer del server + unique global. OK.

## Deltas que genera este audit (para coordinar al implementar 09)
1. **spec 09 requirements/design** (spec_author): foldar D1 (R10.3 → bloquear), D2 (R3.4 → transferencia MVP, nueva sub-sección), D3 (R5.2 → set explícito + sub-flujo baja). Mejorar copy de R4.8 (nota).
2. **spec 02** (delta backend, se suma al delta ya pendiente de sesión 17): R4.11 "transferencia futura" → flujo MVP con **re-parenting de historia** + RPC/Edge Function atómico (crear perfil nuevo + re-apuntar eventos/vínculos/category_history + archivar viejo, resolviendo `session_id` cross-tenant, colisión de `idv` y linaje cruzado). **Gate 1 obligatorio** (cross-tenant write + re-parenting masivo). **Candidata a sub-spec propia** por su peso.
3. **spec 01** (delta): el switch del header (R6.8.1) respeta el guard "flujo abierto" (D1).

## Insumos para spec_author
- `specs/active/09-buscar-animal/{requirements,design,tasks}.md` — spec base aprobada; foldar D1/D2/D3 sin reescribir lo demás.
- spec 02 R4.11 (transferencia), R4.13 (inmutabilidad), R4.14 (baja/egreso), R5.1 (transferir/alta).
- spec 04 `context.md` (`useBusyMode`, listener), spec 01 R6.8.1 (switch).

## Aprobación
- **Pendiente de aprobación de Raf.** Es un audit sobre una spec ya aprobada — al aprobar, las 3 decisiones quedan lockeadas y se foldan en el fold de implementación de 09 (Ola 2/B.4). 09 sigue `deferred` (no cambia de estado por el audit). El delta de transferencia de spec 02 (D2) se suma al delta backend pendiente de spec 02 y requiere Gate 1.
