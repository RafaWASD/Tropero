baseline_commit: 575fa305eedcabca66a2e353dc394cd2da367913

# impl — Stream B / B3 (RPSC.6 / DD-PSC-6): baja de la carga manual per-vaca de "servicio natural"

Feature `03-modo-maniobras`, delta **Stream B**, chunk **B3** (último de Stream B). Frontend puro → **Gate 1 N/A**
(no toca schema/RLS/Edge; NO se borra el enum `service_type`). Pendiente: veto liviano del leader + reviewer + Gate 2.

## Precondición (igual que B4/B1/B2)
`feature_list.json` tiene 03 = `done`; Stream B se implementa como **deltas additivos del modelo reproductivo**
bajo notas (patrón establecido por B4 → B1 → B2, ver `progress/current.md` y los ledgers `impl_03-streamB-b{4,1,2}*.md`).
Specs Stream B (`requirements/design-puesta-en-servicio-cliente.md`) = `spec_ready` + veto del leader PASS. Procedo por
**dispatch explícito del leader**; observación anotada para que el leader confirme el tracking de estado.

## Qué pide el spec (acotado)
- **RPSC.6.1**: "Agregar evento" de la ficha (`agregar-evento.tsx`) NO debe ofrecer la carga manual de un
  servicio de **monta natural** (`service_type='natural'`).
- **RPSC.6.2 / DD-PSC-6**: **IA (`ai`)** y **TE (`te`)** se conservan (carga reproductiva real per-vaca). La IA de manga
  (`InseminacionStep`) NO se toca.
- **RPSC.6.3**: los eventos `service` **históricos** (incl. `natural`) NO se borran ni alteran — siguen en el timeline
  con su `service_type` enriquecido (`humanizeServiceType`/`SERVICE_TYPE_LABELS` mantienen `natural: 'Monta natural'`).
- **RPSC.6.6 / DD-PSC-6**: backend intacto. NO se toca el enum `service_type`, `reproductive_events`, ni
  `addService`/`buildAddServiceInsert` (la IA de manga ni los usa; la ficha los sigue usando para IA/TE).

## Plan (tasks)
- [x] **T1** — `event-input.ts`: nueva const `SERVICE_TYPE_INPUT_OPTIONS` = subset offerable para alta manual NUEVA
      (IA + TE, derivada de `SERVICE_TYPE_OPTIONS` → labels single-source). `SERVICE_TYPE_OPTIONS` queda intacto
      (catálogo completo del enum, doc + backward-compat) con nota de que `natural` ya no se ofrece para alta nueva.
- [x] **T2** — `agregar-evento.tsx`: el `ServiceForm` apunta a `SERVICE_TYPE_INPUT_OPTIONS` (no a `SERVICE_TYPE_OPTIONS`);
      subtítulo de la card "Servicio" pasa de "Monta natural, IA o TE" → "Inseminación o TE" (DD-PSC-6, default).
- [x] **T3** — Tests unit: `event-input.test.ts` — nuevo test de `SERVICE_TYPE_INPUT_OPTIONS` (NO contiene `natural`,
      SÍ `ai`+`te`, labels no vacíos, subset del catálogo completo). `SERVICE_TYPE_OPTIONS` (3 valores) se conserva.
      `event-timeline.test.ts` `humanizeServiceType` (los 3, incl. `natural`) NO se toca (backward-compat).
- [x] **T4** — e2e: actualizar `events.spec.ts` (4 tests usaban "Monta natural") → ahora el alta manual ofrece
      IA/TE y NO "Monta natural". Reescritos a "Inseminación (IA)". + un test nuevo que afirma que "Monta natural"
      ya no aparece y que el timeline de un `natural` HISTÓRICO (sembrado por admin) sigue renderizando.
- [x] **T5** — Captura del selector resultante (web táctil 360/412 → `tests/stream-b/`) para el veto liviano del leader.
- [x] **T6** — `node scripts/check.mjs` + autorrevisión adversarial + reconciliación de specs.

## R<n> → archivo:test (trazabilidad)
- **RPSC.6.1** (no ofrecer `natural`) →
  - unit `app/src/utils/event-input.test.ts` :: "SERVICE_TYPE_INPUT_OPTIONS: alta manual NO ofrece monta natural…"
  - e2e `app/e2e/events.spec.ts` :: "reproductivo: … → servicio (IA)" (selecciona "Inseminación (IA)"; "Monta natural" count 0)
  - e2e `app/e2e/events.spec.ts` :: "servicio: el alta manual ya NO ofrece monta natural; sí IA + TE; histórico natural sigue en el timeline"
- **RPSC.6.2** (IA + TE quedan) →
  - unit `event-input.test.ts` :: el mismo test (contiene `ai` y `te`)
  - e2e `events.spec.ts` :: el test de B3 verifica "Inseminación (IA)" + "Transferencia embrionaria (TE)" presentes
- **RPSC.6.3** (históricos `natural` no se rompen) →
  - unit `event-timeline.test.ts` :: "humanizeServiceType: los 3 valores + null/desconocido" (incl. `natural`, intacto)
  - e2e `events.spec.ts` :: el test de B3 siembra un evento `service`+`natural` por admin y verifica "Monta natural" en el timeline
- **RPSC.6.6 / backward-compat del tipo** →
  - `ServiceType = 'natural' | 'ai' | 'te'` SIN tocar (event-timeline.ts:78); enum DB SIN tocar; `addService` SIN tocar.

## Verificación
- `node scripts/check.mjs` **VERDE end-to-end** (typecheck client OK, anti-hardcode 0 violaciones, client unit
  incl. `SERVICE_TYPE_OPTIONS` [catálogo, 3 valores] + `SERVICE_TYPE_INPUT_OPTIONS` [B3, sin natural] +
  `humanizeServiceType` [3, intacto] + `buildAddServiceInsert`/IA-write [boundary], backend suites). **El rojo
  PREEXISTENTE de `operaciones_rodeo` YA NO ESTÁ** — la suite spec-10 pasó 22/22 (el PAT `SUPABASE_ACCESS_TOKEN`
  fue rotado entre la redacción de la tarea y ahora). No hay ningún rojo.
- e2e `app/e2e/events.spec.ts` **14/14** (build `pnpm e2e:build` OK): 4 tests reescritos a "Inseminación (IA)"
  (#4 reproductivo→servicio, #9 servicio-preñada, #11 orden-timeline, #12 servicio-no-preñada) + 1 NUEVO
  (#10 `B3 baja monta natural…`) + el resto sin regresión.
- Captura `tests/stream-b/b3-servicio-selector-{360,412}.png` (web táctil, 2 filas balanceadas IA/TE, título
  "Servicio" + label "Transferencia embrionaria (TE)" sin recorte) → inspeccionada, lista para veto liviano del leader.

## Autorrevisión adversarial
Pasada hostil buscando activamente problemas; **0 hallazgos que corregir**:
- **(a) Desviación del spec / RPSC.6 a medias:** RPSC.6.1 (no natural) cubierto por unit (`SERVICE_TYPE_INPUT_OPTIONS`
  sin natural) + e2e (`toHaveCount(0)` del botón "Monta natural" en 2 tests). RPSC.6.2 (IA/TE) cubierto (selector
  ofrece ambos; el write-path de IA/TE y `addService` intactos). RPSC.6.3 (históricos) cubierto por un test que
  **siembra un `service`+`natural` REAL server-side** y verifica que renderiza — no un fake. RPSC.6.6 (backend)
  verificado: `git diff -- supabase/` vacío; enum/`reproductive_events`/`addService`/`buildAddServiceInsert` sin tocar.
- **(b) Bugs / edge cases:** el único edge real es el render del `natural` histórico — testeado explícitamente.
  Quitar un valor de una lista cerrada no puede dejar un estado inválido (no hay NULL/vacío nuevo). El narrowing del
  estado a `ManualServiceType='ai'|'te'` es seguro: `AddServiceInput.serviceType` sigue siendo el enum completo
  `ServiceType` → el subset es asignable (typecheck verde lo prueba).
- **(c) Seguridad:** N/A real (frontend puro, sin schema/RLS/write-path nuevo). `addService` sigue por el mismo
  camino con selector CERRADO → enum-válido; `establishment_id` lo deriva el trigger (no hardcodeado). El helper de
  seed nuevo (`seedReproductiveServiceEvent`) usa service_role SOLO en la fixture e2e (nunca en el browser).
- **(d) Offline-first / multi-tenant:** B3 no cambia el modelo offline ni la tenancy; la vía IA/TE conservada ya
  era offline-capable.
- **(e) Tests que pasan por la razón equivocada:** el e2e de B3 ejerce el path real (abre el selector real de la
  ficha) y verifica el reject (botón "Monta natural" ausente) + el render del histórico (fila sembrada). El test
  unit verifica la sincronía de labels (subset == catálogo) — no solo "longitud 2".

## Reconciliación de specs
As-built == lo diseñado en comportamiento; el único matiz de *cómo* (variante elegida) quedó reconciliado:
- **design `DD-PSC-6`** — agregado un bloque **AS-BUILT de B3** documentando la variante elegida
  (`SERVICE_TYPE_INPUT_OPTIONS` subset + `SERVICE_TYPE_OPTIONS` catálogo completo + narrowing a `ManualServiceType`
  + subtítulo "Inseminación o TE") y el conjunto NO-tocado. La decisión cae dentro de las dos opciones que el diseño
  ya ofrecía ("se quita de `SERVICE_TYPE_OPTIONS` **o** se filtra en el render") → no es un cambio de *qué*.
- **design `§6`** — actualizado el "Se quita / Se conserva / No se toca / Tests" al as-built (incl. el helper
  `seedReproductiveServiceEvent` y los 4 tests reescritos + el nuevo).
- **requirements `RPSC.6.x`** — SIN cambios (el *qué* es idéntico al diseñado; la elección de la const es *cómo*).
- **tasks `Chunk B3`** — T-B3.1..T-B3.6 marcadas `[x]` con notas as-built + nota de tracking del ledger real
  (`impl_03-streamB-b3.md`).

## Estado de gates
- **Gate 1 — N/A** (frontend puro; `git diff -- supabase/` vacío; sin schema/RLS/Edge). No se disparó el trigger
  de reapertura (RPSC.8.4).
- **Gate 2 (code) — PENDIENTE** (lo corre el leader tras el reviewer). Baseline para el diff: `baseline_commit` (arriba).
- **Veto liviano del leader (design-review)** sobre la captura — PENDIENTE.
- **reviewer** — PENDIENTE.
- NO marqué la feature `done` (sigue el patrón: 03 `done`, Stream B trackeado bajo notas; el leader confirma).

## Nota de entorno (no es mío)
`progress/current.md` (-6) y `progress/history.md` (+12) aparecen en `git diff` vs el baseline: es un movimiento de
resumen de sesión que YO NO HICE (estado del working-tree de la orquestación del leader al arrancar la sesión).
Mis archivos tocados son exactamente: `agregar-evento.tsx`, `event-input.ts`, `event-input.test.ts`, `events.ts`,
`e2e/events.spec.ts`, `e2e/helpers/admin.ts` + nuevos `e2e/captures/b3-servicio-selector.capture.ts` y este ledger,
+ la reconciliación de `design-/tasks-puesta-en-servicio-cliente.md`.
