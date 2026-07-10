# Requirements — LOTES OPERABLES (venta/descarte en tanda) — delta spec 02

> Delta-spec (ADR-028, Nivel B) del ítem **A** del triage `docs/correcciones-demo-facundo-padre-2026-07-10.md`.
> Fuente de verdad: `context-lotes-venta.md` (Gate 0 CERRADO 2026-07-10). EARS estricto (`docs/specs.md`).
> IDs `RLV.n` — estables, no reordenar tras aprobar.
>
> **Reframe (A-1):** el lote (`management_groups`, ADR-020) pasa a ser un **GRUPO OPERABLE**: cualquier lote
> puede registrar la salida (venta/descarte/muerte) de todos o parte de sus animales en tanda. "Lote de venta"
> NO es un tipo rígido nuevo — es un lote sobre el que registrás una salida. Reusa la baja per-animal ya
> existente (`exit_animal_profile`, 0044, vía la outbox `enqueueExitAnimal`) en un **loop client-side**.
>
> **Gate 1:** ver `design-lotes-venta.md` §Gate. La baja en tanda es un **loop client-side que reusa la RPC
> `exit_animal_profile` existente** (sin schema nuevo, sin RPC nueva) → **Gate 1 candidato a N/A** (el leader
> confirma). Los focos de seguridad (anti-IDOR de la baja per-animal, tenant-scoping) ya están cubiertos por
> el diseño existente y se preservan por-llamada.

## Trazabilidad Gate 0 → requirements

Cada "decisión cerrada" del `context-lotes-venta.md` queda cubierta por ≥1 `RLV.n`:

| Decisión Gate 0 | Requirements |
|---|---|
| **A-1** Lotes = grupos operables (sin flag/tipo nuevo) | RLV.1, RLV.2 |
| **A-2** Entrada de vacías (sugerencia saltable → elegir/crear lote) | RLV.10, RLV.11, RLV.12, RLV.13, RLV.14, RLV.15 |
| **A-3** Selección de subconjunto + reuso de la baja + archivados dejan el lote | RLV.2, RLV.3, RLV.4, RLV.7, RLV.8, RLV.9 |
| **A-4** Datos comunes para la tanda, ajustables por animal | RLV.5, RLV.6 |
| **A-5** Alcance: auto-sugerencia SOLO vacías; manual = cualquier animal | RLV.15, RLV.16 |
| **A-6** Nombre: usuario lo nombra; "Descarte" sugerido en el flujo del tacto | RLV.13 |
| Multi-tenant / RLS / anti-IDOR / offline (impacto técnico §4) | RLV.20, RLV.21, RLV.22, RLV.23 |

## 1. Lote operable (A-1)

**RLV.1** — El sistema deberá tratar a cualquier lote (`management_group`) del establecimiento activo como un
grupo sobre el que se puede registrar la salida en tanda de sus animales, sin requerir una marca, flag o tipo
de lote distinto.

**RLV.2** — Mientras se muestra la vista de un lote (`app/app/lote/[id].tsx`) con al menos un animal activo, el
sistema deberá ofrecer una acción para registrar la salida (vender / descartar) de animales del lote.

## 2. Selección del subconjunto (A-3)

**RLV.3** — Cuando el usuario activa la acción de registrar salida en un lote, el sistema deberá permitir
seleccionar un subconjunto de los animales activos del lote (por animal), incluyendo la opción de seleccionar
todos.

**RLV.3.1** — Mientras no haya ningún animal seleccionado, el sistema no deberá permitir avanzar a la carga de
los datos de la salida.

**RLV.3.2** — El sistema deberá mostrar en todo momento la cantidad de animales seleccionados para la salida.

## 3. Motivo y mapeo de la baja en tanda (A-3)

**RLV.4** — Cuando el usuario avanza a registrar la salida de la selección, el sistema deberá permitir elegir
un único motivo para la tanda entre: **Venta**, **Descarte** y **Muerte**.

**RLV.4.1** — El sistema deberá mapear cada motivo a un par `(status, exit_reason)` de la baja per-animal
existente (`exit_animal_profile`, 0044), según:

| Motivo (UI) | `status` | `exit_reason` | Captura datos de venta |
|---|---|---|---|
| Venta | `sold` | `sale` | sí (peso + precio, opcionales) |
| Descarte | `sold` | `culling` | sí (peso + precio, opcionales) |
| Muerte | `dead` | `death` | no |

> **Decisión de criterio propio (Puerta 1) — mapeo de "Descarte".** El enum `exit_reason_enum` (0044) ya tiene
> `culling`; el enum `animal_status` (0020) NO tiene un estado "descartado" — solo `active/sold/dead/transferred`.
> El descarte de una vaca (vieja/vacía/CUT) es un animal que **sale del campo vendido para faena** → se mapea a
> `status='sold'` + `exit_reason='culling'`, capturando peso/precio opcionales como una venta. Esto reabre
> parcialmente la semántica de `culling` que el delta `c3.3-baja` había diferido "hasta validar con Facundo";
> se valida en Puerta 1. Si Raf prefiere no exponer "Descarte" como motivo separado en v1, el fallback es
> ofrecer solo Venta/Muerte y tratar "Descarte" como un nombre de lote (la salida se registra como Venta).

**RLV.4.2** — El sistema no deberá exponer en el flujo de baja en tanda los motivos `transfer`/`theft`/`other`
(la transferencia per-animal sigue disponible desde la ficha, delta `c3.3-baja`; `theft`/`other` quedan
diferidos como en `c3.3-baja`).

## 4. Datos comunes ajustables por animal (A-4)

**RLV.5** — Cuando el usuario carga los datos de la salida en tanda, el sistema deberá capturar datos comunes
para toda la tanda: una fecha de salida (default hoy) y, para los motivos que capturan datos de venta
(RLV.4.1), un precio y un peso comunes opcionales.

**RLV.5.1** — El sistema deberá aplicar la fecha común de la tanda a todos los animales seleccionados.

**RLV.5.2** — Donde el usuario cargó un precio o peso común, el sistema deberá aplicarlo a todos los animales
seleccionados que no tengan un valor propio.

**RLV.6** — Donde el usuario ajusta el precio o el peso de un animal puntual de la tanda, el sistema deberá usar
el valor propio de ese animal (override) en lugar del valor común, y mapearlo a `exit_price` / `exit_weight`
per-animal.

**RLV.6.1** — El sistema deberá validar cada precio y peso (común o de override) con las mismas reglas que la
baja per-animal (`validateExitPrice` / `validateExitWeight`, `exit-animal.ts`): vacío es válido (no se manda),
con texto debe ser un número mayor a 0 dentro del tope; acepta coma decimal es-AR.

## 5. Baja en tanda (reuso de la baja existente) (A-3)

**RLV.7** — Cuando el usuario confirma la salida en tanda, el sistema deberá registrar la baja de cada animal
seleccionado invocando la baja per-animal existente (`exit_animal_profile`, 0044) una vez por animal, con el
`(status, exit_reason)` del motivo de la tanda (RLV.4.1), la fecha común (RLV.5.1) y el precio/peso efectivo
del animal (común u override, RLV.5.2/RLV.6).

**RLV.7.1** — El sistema no deberá crear una tabla nueva, una columna nueva ni una RPC nueva para la baja en
tanda: deberá reusar el intent de outbox `exit_animal_profile` (`enqueueExitAnimal`) por animal.

**RLV.8** — Si al subir alguna de las bajas de la tanda es rechazada server-side (p. ej. un animal ya dado de
baja por otro dispositivo, o sin permiso), entonces el sistema deberá reflejar el rechazo de esas bajas por el
canal de estado de la outbox sin revertir las bajas que sí se registraron (la tanda no es atómica).

## 6. Archivados dejan el lote (A-3)

**RLV.9** — Cuando se registra la salida en tanda de un animal, el sistema deberá dejar de mostrar ese animal
como miembro activo del lote.

**RLV.9.1** — El sistema deberá quitar el vínculo de lote (`management_group_id → NULL`) de cada animal dado de
baja en la tanda, para que la membresía del lote no incluya animales archivados.

## 7. Sugerencia post-tacto de las vacías (A-2)

**RLV.10** — Cuando el usuario termina una jornada de maniobra que incluyó tacto de preñez y esa sesión
diagnosticó al menos una hembra como vacía, el sistema deberá ofrecer agregar esas vacías a un lote.

**RLV.10.1** — El sistema deberá derivar el conjunto "vacías de la sesión" como los perfiles de animal activos
con un evento de tacto de esa `session_id` cuyo `pregnancy_status` vigente (no borrado) es `empty`, sin
duplicados por animal.

**RLV.10.2** — El sistema deberá mostrar la cantidad de vacías encontradas en la sugerencia.

**RLV.11** — El sistema deberá permitir saltar la sugerencia de las vacías sin agregar ningún animal a un lote.

**RLV.12** — Cuando el usuario acepta la sugerencia de las vacías, el sistema deberá permitir elegir un lote
existente del establecimiento activo para agregarlas.

**RLV.13** — Cuando el usuario acepta la sugerencia de las vacías, el sistema deberá permitir crear un lote
nuevo ahí mismo para agregarlas, proponiendo el nombre "Descarte" por default (editable).

**RLV.14** — Cuando el usuario elige o crea el lote para las vacías, el sistema deberá asignar cada vaca vacía
de la sesión a ese lote (`assignAnimalToGroup`), sin tocar su rodeo.

## 8. Alcance (A-5)

**RLV.15** — El sistema deberá ofrecer la auto-sugerencia de agregar a un lote solo para las vacías tras el
tacto (no para viejas/CUT/edad, que quedan v2).

**RLV.16** — El sistema deberá permitir agregar manualmente cualquier animal del establecimiento a un lote
desde la ficha o el lote (mecanismo `assignAnimalToGroup` ya existente), sin restricción de categoría.

## 9. Confirmación e idempotencia

**RLV.17** — Cuando el usuario está por confirmar la baja en tanda, el sistema deberá mostrar la cantidad de
animales que se van a dar de baja y el motivo, y advertir que la acción no se puede deshacer desde la app.

**RLV.18** — Si el usuario toca dos veces el botón de confirmar la baja en tanda, entonces el sistema no deberá
registrar la tanda dos veces.

**RLV.19** — Mientras la baja en tanda está en curso, el sistema deberá deshabilitar el botón de confirmar.

## 10. Multi-tenant, authz, offline (impacto técnico §4)

**RLV.20** — El sistema deberá derivar el establecimiento y los animales operables del contexto del
establecimiento activo (`EstablishmentContext`), sin hardcodear `establishment_id` (CLAUDE.md ppio 6).

**RLV.21** — El sistema deberá apoyarse en la autorización server-side de `exit_animal_profile` (que deriva el
`establishment_id` de la fila real del perfil y exige `has_role_in AND (is_owner_of OR created_by = auth.uid())`)
como barrera real de cada baja de la tanda, sin permitir dar de baja un animal de otro establecimiento
(anti-IDOR: el cliente solo pasa `p_profile_id`, cuyo tenant se deriva server-side).

**RLV.21.1** — El sistema deberá construir la selección de la baja en tanda únicamente a partir de los miembros
activos del lote resueltos por `fetchGroupMembers` (ya scopeados por RLS al establecimiento activo).

**RLV.22** — El sistema deberá permitir registrar la baja en tanda y la asignación de las vacías al lote sin
conexión, encolando el efecto (outbox / escritura local) y sincronizando al reconectar (offline-first, CLAUDE.md
ppio 3).

**RLV.23** — El sistema deberá reflejar de forma optimista, al instante y offline, tanto la salida de los
animales del lote (overlay `pending_status_overrides` 'exited' + `management_group_id → NULL`) como la
incorporación de las vacías al lote elegido/creado.

## Notas de verificación (cada RLV → ≥1 test)

- Puras/unitarias: RLV.4.1 (mapeo motivo→status/reason, extensión de `EXIT_REASON_MAPPINGS`), RLV.5.2/RLV.6
  (resolución valor común vs override, función pura), RLV.6.1 (validaciones reusadas), RLV.10.1 (derivación de
  vacías de la sesión desde filas de reproductive_events, builder puro), RLV.3/RLV.3.1/RLV.3.2 (lógica de
  selección, función pura), RLV.13 (nombre default "Descarte").
- E2E Playwright (extender `app/e2e/lotes.spec.ts` + un spec de la sugerencia post-tacto sobre
  `maniobra-lote.spec.ts`): RLV.2, RLV.3, RLV.7, RLV.9 (archivados salen del lote), RLV.10–RLV.14 (sugerencia →
  elegir/crear → asignar), RLV.11 (saltar), RLV.17 (confirmación).
- Offline (RLV.22/RLV.23): tests de servicio del loop de `enqueueExitAnimal` + `assignAnimalToGroup` (overlay
  optimista) sin red, mismo patrón que los tests de outbox existentes.

## Historial de refinamiento

- 2026-07-10 — Creación del delta (spec_author) a partir de `context-lotes-venta.md` (Gate 0 cerrado). Sin
  cambios sobre los IDs (delta nuevo).
