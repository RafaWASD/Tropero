# Requirements (delta spec 02) — Agregar caravana desde la ficha (parte manual: electrónica + visual)

**Status**: `spec_ready` (delta de spec 02 — frontend puro). Gate 0 auto-aprobado en
`context-caravana-ficha.md` (trabajo autónomo de Raf, 2026-06-29; defaults del leader, a confirmar en Puerta 2).
**Fecha**: 2026-06-29
**Autor**: spec_author

> **Delta, no refundición.** Estas requirements EXTIENDEN spec 02 (modelo-animal) sin tocar `requirements.md`
> base. Numeradas `RCF.n` (Caravana-Ficha) para no colisionar con los IDs estables de spec 02
> (`R`/`RT2`/`RC6`/`RCUT`/`RPS`/`RAR`/`RAF2`). Fuente de verdad: el contexto refinado y aprobado
> `specs/active/02-modelo-animal/context-caravana-ficha.md`. Cubre la **parte manual** de la corrección #6 del
> testeo en vivo ("agregar caravana desde la ficha, visual y electrónica").
>
> **Reconciliación as-built (delta bastoneo, 2026-07-06 — el bastoneo DEJA de estar DEFERIDO).** El Gate 0
> original difirió el "botón de bastoneo" (leer el EID del bastón desde la ficha) por el supuesto "hardware
> spp-android no probado". Ese supuesto NO aplica al MVP de campo: la infraestructura BLE del bastón YA existe
> y funciona en WEB (web-serial) y en el mock de E2E — es el MISMO contrato de ingesta (ADR-024) que consumen
> MODO MANIOBRAS y el FindOrCreateOverlay global. El bastoneo desde la ficha se construyó reusando esa
> infraestructura, con degradación NEUTRA en dispositivos sin transporte (native Expo Go hoy). **Se agregan
> las requirements `RCF.6`** (bastoneo desde la ficha) — frontend puro, **Gate 1 sigue N/A**.
>
> El plumbing ya existe: la asignación de TAG por RPC (`assignTagToAnimal` / `assign_tag_to_animal`, 0089,
> `app/src/services/animals.ts:1176`), el pre-check de dup-TAG (`lookupByTag`, `animals.ts:747`) y el patrón de
> UPDATE local sobre `animal_profiles` (`buildSetCutUpdate`, `app/src/services/powersync/local-reads.ts:1746`).
> Esto es una **afordancia nueva en la sección "Identificación" de la ficha** (hoy solo-lectura,
> `app/app/animal/[id].tsx:749-754`) + un builder de UPDATE local nuevo para `idv`.

## Alcance

Afordancia manual en la ficha para **completar lo que está VACÍO** (NULL→valor), respetando la inmutabilidad
post-completitud R4.13 (lo ya seteado queda solo-lectura):

1. **Caravana electrónica** (`animals.tag_electronic`, NO sincronizada — ADR-026) → asignación por el **RPC
   existente** `assignTagToAnimal` (online vía outbox). Input 15 dígitos (`^\d{15}$`).
2. **Caravana visual** (`animal_profiles.idv`, sincronizada) → asignación por **UPDATE local** (offline-safe,
   mismo patrón que CUT). Input numérico ≤20 dígitos.

3. **Bastoneo de la caravana electrónica** (delta posterior, RCF.6) → un sheet de scan ACOTADO a ESTE animal
   que lee el EID del bastón (reuso de la infraestructura BLE existente, ADR-024) y lo asigna al perfil, con
   confirmación pre-commit (integridad SENASA). La carga manual (RCF.2) queda como **piso siempre presente**.

**Fuera de alcance**: `visual_id_alt` / "Nombre/apodo" (es el delta de #2); edición de un identificador YA
seteado (inmutabilidad R4.13 — no es caso de uso).

Cada "Caso y decisión" de `context-caravana-ficha.md` queda cubierto por ≥1 requirement (ver trazabilidad al
final).

---

## RCF.1 — Afordancia en la sección "Identificación" (gating por NULL + animal activo)

- **RCF.1.1** — Mientras la ficha de un animal **activo** (`status === 'active'`) tiene `tagElectronic == null`,
  el sistema deberá ofrecer en la sección "Identificación" la acción **"Agregar caravana electrónica"**.
- **RCF.1.2** — Mientras `tagElectronic != null` (ya seteada), el sistema no deberá ofrecer asignarla ni
  editarla; deberá seguir mostrando su valor en **solo lectura** (inmutabilidad post-completitud, R4.13).
- **RCF.1.3** — Mientras la ficha de un animal **activo** tiene `idv == null`, el sistema deberá ofrecer en la
  sección "Identificación" la acción **"Agregar caravana visual"**.
- **RCF.1.4** — Mientras `idv != null` (ya seteado), el sistema no deberá ofrecer asignarlo ni editarlo; deberá
  seguir mostrando su valor en **solo lectura** (R4.13).
- **RCF.1.5** — Si el animal no está activo (`status !== 'active'`), entonces el sistema no deberá ofrecer
  ninguna afordancia de asignación de identificadores (consistente con el resto de acciones de la ficha, que
  solo se ofrecen en animales activos).
- **RCF.1.6** — El sistema no deberá renderizar en la sección "Identificación" ninguna afordancia para
  `visual_id_alt` (fuera de alcance de este delta).
  > **SUPERADA por `identificadores-unificados` (2026-07-09)**: `visual_id_alt` fue **eliminado** del modelo (columna dropeada en `0122`, datos descartados — beta sin data real) → no hay afordancia posible ni dato que mostrar. La "Identificación" queda con electrónica + visual (idv). Ver IDU.1.4.
  > **Reconciliación as-built (delta bastoneo, 2026-07-06)**: la parte "ni un botón 'Detectar bastoneo'" de
  > esta requirement queda SUPERADA por RCF.6 — el bastoneo de la caravana ELECTRÓNICA sí se ofrece ahora
  > (afordancia "Bastonear la caravana" + sheet de scan acotado). `visual_id_alt` sigue sin afordancia (no es
  > una caravana). El bastoneo NO es un "botón muerto": abre un sheet que degrada con tono neutro donde no hay
  > transporte (RCF.6.2/RCF.6.6).
- **RCF.1.7** — El predicado de elegibilidad de cada afordancia (`status === 'active'` AND el identificador es
  `null`) deberá ser una función PURA y testeable (sin RN/red/SDK), con `status` y el valor del identificador
  como entradas.

## RCF.2 — Asignar caravana electrónica (`tag_electronic`) por el RPC existente

> **Reconciliación as-built (UX Raf, 2026-07-06)**: la carga MANUAL por teclado de la caravana ELECTRÓNICA ya
> **NO vive como un row inline en la ficha** — se movió **DENTRO del sheet de bastoneo** (RCF.6), detrás de "¿Sin
> bastón? Cargá la caravana a mano" / el CTA del estado manual-promovido. Toda la lógica RCF.2.1–RCF.2.7 sigue
> vigente **igual** (sanitize ≤15, validación `^\d{15}$` con la misma copy, pre-check de dup, encolar el RPC,
> optimismo en sitio) — solo cambió el CONTENEDOR (una vista `ManualTagEntry` del sheet, no un `IdentifierAssignRow`
> en la ficha). La ficha ofrece SOLO "Bastonear la caravana" para la electrónica vacía. (El `idv`/RCF.3 mantiene su
> `IdentifierAssignRow` inline en la ficha, sin cambios.)

- **RCF.2.1** — Cuando el usuario tipea en el campo de caravana electrónica, el sistema deberá sanitizar la
  entrada a **solo dígitos, máximo 15** (reuso de `sanitizeTagInput` / `TAG_ELECTRONIC_LENGTH`,
  `app/src/utils/animal-input.ts:16,32`).
- **RCF.2.2** — Cuando el usuario confirma la asignación, si el valor no satisface `^\d{15}$` (reuso de
  `isValidTagElectronic`, `animal-input.ts:120`), entonces el sistema deberá mostrar el error inline es-AR
  **"La caravana electrónica tiene que tener 15 dígitos."** con borde rojo en el campo y **no** invocar el RPC.
- **RCF.2.3** — Antes de encolar la asignación, el sistema deberá ejecutar el pre-check local
  `lookupByTag(tag, establishmentId)` (`animals.ts:747`, lectura local offline-safe); si el TAG ya resuelve a
  un animal de los campos del usuario, entonces el sistema deberá mostrar un error accionable es-AR
  (**"Esa caravana ya está asignada a otro animal de tus campos."**, reuso de la señal R5.6 del alta /
  `asignar-caravanas.tsx:321-324`) y **no** encolar la asignación.
- **RCF.2.4** — Cuando el valor es válido (15 díg) y el pre-check no detecta dup, el sistema deberá invocar
  `assignTagToAnimal(profileId, tag)` (RPC existente `assign_tag_to_animal`, 0089, vía outbox), sin escribir la
  tabla `animals` localmente (no existe en el SQLite local — ADR-026).
- **RCF.2.5** — El `establishmentId` que se pasa a `lookupByTag` deberá derivarse de `detail.establishmentId`
  (el establecimiento del **perfil**), nunca hardcodeado ni tomado del contexto activo del usuario.
- **RCF.2.6** — Si `assignTagToAnimal` devuelve error en el encolado, entonces el sistema deberá mostrar el
  error accionable inline y dejar la afordancia abierta para reintentar, sin cambiar el estado mostrado.
- **RCF.2.7** — Cuando el encolado tiene éxito, el sistema deberá reflejar el valor recién asignado con
  optimismo en sitio (sin blanquear la ficha); el valor canónico baja a
  `animal_profiles.animal_tag_electronic` al sincronizar (propagación del trigger 0079). El rechazo real
  (TAG ya existente 23505 / race 23514 / sin-rol 42501) lo resuelve `uploadData` al SUBIR (la barrera real es
  server-side, no el cliente).
  > **Reconciliación as-built (impl, 2026-06-29)**: el "+ refresh silencioso" que esta requirement preveía se
  > **OMITE para el TAG** — `assignTagToAnimal` encola el RPC SIN overlay local (`animals` fuera del sync set,
  > ADR-026), así que el denorm `animal_profiles.animal_tag_electronic` sigue NULL localmente hasta sincronizar;
  > un refresh inmediato re-leería ese NULL y blanquearía el optimismo (rompiendo el propio "sin blanquear la
  > ficha"). El optimismo en sitio ALCANZA el intento de la requirement; el valor canónico entra en el próximo
  > re-focus tras la sync. (El `idv`, UPDATE local, SÍ conserva optimismo + refresh silencioso — RCF.3.5 — porque
  > la lectura local lo refleja al instante sin blanquear.) Ver design §4.6.

## RCF.3 — Asignar caravana visual (`idv`) por UPDATE local (offline-safe)

- **RCF.3.1** — Cuando el usuario tipea en el campo de caravana visual, el sistema deberá sanitizar la entrada a
  **solo dígitos, máximo 20** (reuso de `sanitizeIdvInput` / `IDV_MAX_LENGTH`, `animal-input.ts:18,40`).
- **RCF.3.2** — Cuando el usuario confirma la asignación, si el valor (trim) está vacío, entonces el sistema
  deberá mostrar un error inline es-AR con borde rojo en el campo y **no** escribir nada.
- **RCF.3.3** — Cuando el valor es válido (no vacío), el sistema deberá ejecutar un **UPDATE local plano** sobre
  `animal_profiles.idv` vía el builder nuevo `buildSetIdvUpdate(profileId, idv)`
  (`UPDATE animal_profiles SET idv = ? WHERE id = ? AND deleted_at IS NULL`) — una sola CrudEntry PATCH, éxito
  local inmediato, **offline-first** (mismo patrón que `buildSetCutUpdate`, `local-reads.ts:1746`).
- **RCF.3.4** — El builder `buildSetIdvUpdate` deberá escribir **solo** la columna `idv` (NULL→valor) y no tocar
  ninguna otra columna; la inmutabilidad R4.13 (`tg_animal_profiles_block_idv_change`,
  `supabase/migrations/0036_immutability_identifiers.sql:27-42`) permite el caso `NULL → valor` al subir, y la
  unicidad parcial `(establishment_id, idv)` (`animal_profiles_idv_unique`,
  `supabase/migrations/0020_animal_profiles.sql:50-53`) la enforza al sincronizar — **sin policy, RPC ni
  migración nuevos**.
- **RCF.3.5** — Cuando el UPDATE local tiene éxito, el sistema deberá reflejar el `idv` recién asignado con
  optimismo en sitio + refresh silencioso (visible al instante, offline). Si el `idv` ya existe en el campo, el
  índice único parcial lo rechaza al SUBIR (mismo manejo que el alta — `uploadData` lo superficia,
  `duplicate_idv`); el sistema **no** deberá inventar una validación de unicidad nueva en el cliente.
- **RCF.3.6** — Si el UPDATE local falla, entonces el sistema deberá mostrar el error accionable inline y dejar
  la afordancia abierta para reintentar, sin cambiar el estado mostrado.

## RCF.4 — UX de campo (MUSTs de forms en manga)

- **RCF.4.1** — Todos los textos visibles de la afordancia deberán estar en español argentino (voseo); cero
  hardcode de colores/espaciados (tokens + `getTokenValue` para íconos lucide); a11y por los helpers de
  `utils/a11y` (ADR-023 §4).
- **RCF.4.2** — Cada afordancia de asignación deberá presentar **una sola decisión** (un identificador por
  afordancia) con un target táctil grande (≥ el tap mínimo del DS), apto para operar con una mano en la manga.
- **RCF.4.3** — La validación deberá ser **inline**: borde rojo + mensaje de error en el propio campo (patrón
  `FormField error`), sin un banner global que tape el título; el campo de entrada deberá quedar visible al
  validar (si la afordancia se resuelve en un sheet, deberá hacer scroll-al-campo con error; si es inline, el
  campo ya está en vista al expandirse).
- **RCF.4.4** — Cualquier heading o título con descendentes (g/q/p/j/y) de la afordancia deberá usar
  `lineHeight` matching para no recortar (regla recurrente del DS).
- **RCF.4.5** — Los campos de caravana son identificadores de máquina (solo dígitos, sin separadores): el
  sistema deberá teclado numérico y sanitización a dígitos, y **no** deberá aplicar el formato es-AR de
  coma/punto (consistente con `animal-input.ts`; el formato es-AR aplica a magnitudes, no a identificadores).

## RCF.5 — Offline & multi-tenant

- **RCF.5.1** — La asignación de `idv` deberá funcionar OFFLINE (UPDATE local plano, sin red). La asignación de
  `tag_electronic` deberá tener éxito de **encolado** offline (la intención queda en la outbox); el efecto real
  se completa al SUBIR cuando hay red — la afordancia no deberá bloquearse por falta de conectividad, pero la
  confirmación del TAG es eventual (online).
- **RCF.5.2** — El sistema no deberá hardcodear `establishment_id`: el aislamiento multi-tenant lo enforza al
  SUBIR la RLS `animal_profiles_update` (para `idv`) y la authz server-side del RPC `assign_tag_to_animal` (para
  `tag`, que deriva el tenant de la fila real del perfil — anti-IDOR); el cliente no replica esa autorización.

## RCF.6 — Bastoneo de la caravana electrónica desde la ficha (delta posterior, 2026-07-06)

Reuso de la infraestructura BLE del bastón (ADR-024) para leer el EID y asignarlo a ESTE animal (el de la
ficha) — NO es find-or-create, NO hay picker (el animal es conocido). Frontend puro (Gate 1 N/A).

- **RCF.6.1** — Mientras la ficha de un animal **activo** tiene `tagElectronic == null`, el sistema deberá
  ofrecer en la sección "Identificación" **una única** afordancia de la caravana electrónica: **"Bastonear la
  caravana"**, que abre un sheet de scan acotado a ESTE animal. No deberá ofrecer una carga manual DIRECTA de la
  electrónica en la ficha (la carga manual por teclado vive DENTRO del sheet, RCF.6.6). Con `tagElectronic !=
  null`, no se ofrece (read-only, RCF.1.2). (UX Raf, 2026-07-06.)
- **RCF.6.2** — El sheet de scan deberá presentar el **mismo lenguaje adaptativo** que la identificación de la
  maniobra (`maniobra/identificar.tsx`), reusando `resolveListenConnState`: transporte **conectado** → hero
  de escaneo; transporte **conectable** (web-serial antes de elegir puerto / bastón caído) → hero "conectá el
  bastón" (tap = gesto de conexión); **sin transporte** (native Expo Go hoy) → prompt **manual-promovido** con
  tono **neutro** ("El bastón no está disponible en este dispositivo"), sin botón muerto.
- **RCF.6.3** — Al leer un EID (que llega YA validado + des-duplicado del contrato de ingesta), el sistema
  deberá mostrar la **confirmación visual pre-commit** (integridad SENASA, ADR-024): los **15 dígitos
  legibles** (`formatEidReadable`) + el texto **"Asignar … a este animal"**, ANTES de asignar. "Volver a
  escanear" descarta la lectura y vuelve a escuchar (por si leyó la caravana equivocada).
- **RCF.6.4** — Al confirmar, el sistema deberá asignar el EID **SOLO a ESTE animal**
  (`assignTagToAnimal(thisProfileId, eid)`, el MISMO camino offline-safe que RCF.2 — pre-check de dup +
  encolar el RPC + optimismo en sitio). Éxito → cerrar el sheet (el optimismo deja la fila read-only). Error
  (dup / encolado) → surfacear inline **sin cerrar** (fail-closed), para reintentar o re-escanear.
- **RCF.6.5** — **Propiedad EXCLUSIVA del listener** (el punto crítico): la ficha suspende el listener global
  con `useBusyWhileMounted` (busyMode) para que un bastonazo no dispare el FindOrCreateOverlay encima.
  Mientras el sheet de scan esté abierto: (a) el listener deberá estar **activo para el sheet** (des-suspender
  la escucha SOLO para él, aunque busyMode siga prendido), y (b) el FindOrCreateOverlay **NO deberá procesar**
  esas lecturas (un flag de "scanner acotado activo", paralelo a `BLE_OWNED_ROUTES`, que el overlay chequea y
  retorna temprano). Al cerrar/desmontar el sheet (incl. back-gesture) el listener deberá **volver a
  suspenderse** (busyMode manda de nuevo: un bastonazo posterior en la ficha no hace nada) sin dejar transporte
  escuchando de más ni busyMode inconsistente.
- **RCF.6.6** — **Manual-first (dentro del sheet)**: la carga manual de 15 dígitos (RCF.2) deberá estar
  **siempre alcanzable DESDE el sheet**: en cualquier estado de scan por el link "¿Sin bastón? Cargá la caravana
  a mano", y en el estado manual-promovido (sin transporte) por su CTA. Al elegirla se muestra un campo de texto
  numérico (sanitiza ≤15, valida `^\d{15}$` con la misma copy, asigna por el MISMO `onAssignTag`), con "Volver"
  al estado de scan. Mientras la carga manual está activa, el sistema deberá **ignorar** las lecturas del bastón
  (el usuario eligió tipear — un bastonazo no debe pisar lo que escribe), sin soltar la propiedad exclusiva del
  listener (el sheet sigue siendo dueño; solo no actúa sobre las lecturas).
- **RCF.6.7** — La decisión de si el listener escucha (`scopedScannerActive || (enabled && !busy)`) deberá ser
  una función **PURA y testeable** (`resolveListening`, `app/src/services/ble/listener-gate.ts`), con el flag
  del scanner acotado, `enabled` y `busy` como entradas.

---

## ¿Toca DB? — NO (Gate 1 N/A)

Este delta es **frontend puro**. No crea ni modifica: tablas, columnas, índices, triggers, RLS policies, RPCs
ni Edge Functions.

- **`tag_electronic`** → RPC **existente** `assign_tag_to_animal` (0089). Sin cambios server-side.
- **`idv`** → **UPDATE local** sobre `animal_profiles` (tabla y columna ya existentes). El trigger de
  inmutabilidad (`tg_animal_profiles_block_idv_change`, 0036) **ya permite** `NULL → valor`, y el índice único
  parcial `(establishment_id, idv)` (0020) **ya está vigente**. No requiere RPC nuevo ni policy nueva.

→ **Gate 1 N/A.** (Si la implementación descubriera que el path de `idv` necesita un RPC/policy/migración, se
detiene y se eleva a Gate 1 — pero el as-built verificado dice que no.)

## Trazabilidad context → requirement

| Caso / decisión de `context-caravana-ficha.md` | Requirement(s) |
|---|---|
| #1 — Solo asignar lo VACÍO (NULL→valor); lo seteado queda solo-lectura (R4.13) | RCF.1.1–RCF.1.4 |
| #2 — Electrónica = RPC existente (online); visual/idv = UPDATE local (offline-safe) | RCF.2.4, RCF.3.3 |
| #2 — spec_author confirma el builder de idv contra el trigger R4.13 | RCF.3.4 (verificado: 0036 permite NULL→valor) |
| #3 — Dup TAG → error accionable (reuso R5.6); idv dup → unique parcial al subir | RCF.2.3, RCF.3.5 |
| #4 — Bastoneo (reconciliado: ya NO deferido → sheet de scan acotado desde la ficha) | RCF.6 (supera "no botón muerto" de RCF.1.6) |
| #5 — UX de campo (target grande, una decisión, es-AR, validación inline, tokens, lineHeight) | RCF.4, RCF.6.2 |
| Inmutabilidad post-completitud R4.13 (NULL→valor sí, valor→otro/NULL no) | RCF.1.2, RCF.1.4, RCF.3.4 |
| Multi-tenant (CLAUDE.md ppio 6) + offline-first (ppio 3) | RCF.5, RCF.6.4 |
| Confirmación pre-commit SENASA (ADR-024) + propiedad exclusiva del listener | RCF.6.3, RCF.6.5, RCF.6.7 |

## Cobertura de tests (cada RCF verificable)

- **Unit (node:test, puro)** — predicado de elegibilidad `canAssignTag`/`canAssignIdv` (activo + null→ofrece;
  no-activo NO; valor seteado NO) (RCF.1.1–RCF.1.5, RCF.1.7); `sanitizeTagInput`/`isValidTagElectronic`
  (≤15 díg, `^\d{15}$`) ya testeados (RCF.2.1/RCF.2.2); `sanitizeIdvInput` (≤20 díg) ya testeado (RCF.3.1);
  shape SQL de `buildSetIdvUpdate` (`SET idv = ?` solo, `WHERE id = ? AND deleted_at IS NULL`) (RCF.3.3/RCF.3.4).
- **Unit del bastoneo (node:test, puro)** — `resolveListening` (RCF.6.7): un scanner acotado fuerza la escucha
  aunque busy esté prendido; al liberarse, la escucha vuelve exactamente a `enabled && !busy`
  (`listener-gate.test.ts`); `resolveListenConnState` (RCF.6.2) ya testeado en `maniobra-listen-state.test.ts`.
- **E2E (Playwright)** — desde la ficha de un animal activo sin caravana: (a) "Agregar caravana visual" → tipear
  idv → confirmar → la fila pasa a mostrar el idv en solo-lectura (RCF.1.3/RCF.3.3/RCF.3.5); (b) "Agregar
  caravana electrónica" → tipear 15 díg → confirmar → optimismo en sitio (RCF.2.4/RCF.2.7); (c) validación: 14
  díg → error inline + sin invocar (RCF.2.2); (d) un identificador ya seteado no ofrece afordancia (RCF.1.2/
  RCF.1.4).
- **E2E del bastoneo** (`app/e2e/baston-ficha.spec.ts`, adaptador mock): (a) "Bastonear" → sheet acotado → una
  lectura se asigna a ESTE animal (oráculo server-side `waitForServerTagAssigned`) Y el FindOrCreateOverlay NO
  se abre (ausencia del testID exclusivo `find-or-create-overlay`) (RCF.6.1/RCF.6.3/RCF.6.4/RCF.6.5); (b) al
  cerrar el sheet, un bastonazo posterior en la ficha no dispara nada (listener re-suspendido, RCF.6.5); (c) la
  ficha NO ofrece carga manual directa de la electrónica; sin transporte → sheet manual-promovido → la carga
  MANUAL vive DENTRO del sheet: 14 díg = error inline "…15 dígitos.", 15 díg → asigna (oráculo server) + el
  sheet cierra (RCF.6.1/RCF.6.2/RCF.6.6 + RCF.2).

## Historial de refinamiento

- 2026-06-29 — Redacción inicial del delta caravana-ficha desde `context-caravana-ficha.md` (Gate 0
  auto-aprobado bajo trabajo autónomo, defaults del leader). IDs nuevos `RCF.n` (no tocan los IDs estables de
  spec 02). Sin re-decidir los casos del context. **Verificado el as-built**: el trigger de inmutabilidad de
  `idv` (0036:30-32) permite `NULL→valor` y el unique parcial `(establishment_id, idv)` (0020:50-53) está
  vigente → el path de `idv` es **UPDATE-local frontend (Gate 1 N/A)**, no requiere DB.
- 2026-07-06 — **Delta bastoneo (reconciliación al as-built)**: se REVIRTIÓ el deferral del bastoneo. Se
  agregó `RCF.6` (bastonear la caravana electrónica desde la ficha, reusando la infraestructura BLE de
  ADR-024) + la reconciliación de RCF.1.6. Frontend puro → **Gate 1 sigue N/A** (`git diff supabase/` vacío).
  El punto crítico (propiedad exclusiva del listener) se resolvió con un "scanner acotado" en el provider
  (`scopedScannerActive`) que fuerza la escucha y hace que el FindOrCreateOverlay ignore la lectura — ver
  `design-caravana-ficha.md §BASTONEO`.
