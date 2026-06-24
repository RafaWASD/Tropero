baseline_commit: e241e19c76e17aa4df3883eacf898704a2bafc0f

# impl — Stream B / B2 CABLEADO (spec 03, RPSC.4 / RPSC.5)

> **Naturaleza**: CABLEADO (plomería) del design-spike B2 YA APROBADO por Raf. Enchufa los componentes
> y la lógica pura existentes (`pregnancy-buckets.ts`, `TactoStep` con prop `buckets`, `TactoConfigSheet`)
> al flujo REAL de jornada de tacto. NO rediseña nada (diseño = veto del leader + Raf, hecho).
> Frontend puro → **Gate 1 N/A** (no toca schema/RLS/Edge; `pregnancy_status` ya existe). Si descubro que
> necesito backend → PARO y marco Gate 1.
>
> **Pre-condición**: feature `03-modo-maniobras` = `done` (Stream B = deltas additivos del modelo
> reproductivo, trackeados bajo notas — patrón establecido en B4/B1/B2-spike, ver `current.md`). Dispatch
> explícito del leader para este cableado. NO se flipa estado de `feature_list.json`.

## Alcance (lo que el leader pidió — RPSC.4/RPSC.5)

1. **TactoStep recibe los buckets reales**: derivar los meses de servicio del RODEO de la jornada/animal →
   `effectiveSizeBuckets(serviceMonths, measureSizeOverride)` → pasarlos al `TactoStep`. 2 meses → cabeza/cola;
   3..11 → cabeza/cuerpo/cola; 1/12/no-medir → `[]`.
2. **Config "¿medir tamaño?"** en la preconfig de la maniobra de tacto: `TactoConfigSheet` con default =
   `defaultMeasureSize(nMonths)` (sugerencia visible derivada del rodeo), override de un toque, persistido en
   la config de la tanda (`preconfig.tacto.measureSize`).
3. **Persistencia "preñada sin tamaño"** (DD-PSC-2): `buckets=[]` + PREÑADA → `'large'` directo, sin sub-paso.
   **Resumen** (DD-PSC-8): mostrar solo "Preñada" (no "Preñada · Cabeza") cuando no hubo distinción de tamaño.
4. **Backward-compat**: rodeo sin `service_months` (NULL) → fallback `defaultMeasureSize(null)` → `[]` (solo
   preñada/vacía), no rompe el flujo de tacto existente.

## Plan (Tn) — TODAS HECHAS

- [x] T1 — Lectura del `service_months` del rodeo (offline). `buildRodeoServiceMonthsQuery` (`local-reads.ts`)
  + `fetchRodeoServiceMonths` (`rodeos.ts`, REUSA `parseServiceMonths` de B1). Unit del builder (`maneuver-reads.test.ts`).
- [x] T2 — Lector puro `tactoMeasureSizeFromConfig(config)` (`maneuver-config.ts`, tolerante). 4 unit (`maneuver-config.test.ts`).
- [x] T3 — `TactoConfigSheet` cableado en el wizard (`jornada.tsx`): tacto = maniobra configurable; default
  derivado del rodeo; persiste `preconfig.tacto = { measureSize }`; inline + resumen de etapa 3.
- [x] T4 — `buckets` reales en la carga (`carga.tsx`): `effectiveSizeBuckets(nMonths, override)` → `TactoStep` (case 'tacto').
- [x] T5 — DD-PSC-8: `summaryRows`/`describeStepValue` con `opts.tactoMeasuredSize` (`maneuver-sequence.ts`) +
  `tactoMeasuredSize` derivado en `carga.tsx`. Unit (`maneuver-sequence.test.ts`).
- [x] T6 — e2e `maniobra-tacto-adaptativo.spec.ts` (4: 2m→cabeza/cola+server large; 1m→directo+"Preñada"+server
  large; override "no medir" sobre 3m→directo; **360 web táctil** anti-recorte). + `seedRodeo`/`seedEstablishmentWithRodeo`
  opción `serviceMonths`. Import `test` de `./helpers/fixtures` (gotcha de B1 respetado).
- [x] T7 — `check.mjs` (typecheck + anti-hardcode + unit VERDES; backend rojo SOLO por el flake de token
  Management-API de `operaciones_rodeo`, ajeno) + autorrevisión + reconciliación.

## Trazabilidad (R<n> → archivo:test)

> No hay suite de COMPONENTES de cliente (`conventions.md`: Fase 3+). Los `R<n>` de lógica pura → node:test;
> los de UI/flujo → e2e Playwright (assertea + server oracle).

| R<n> | Verificación |
|---|---|
| RPSC.4.1 (config "¿medir tamaño?" sí/no, persiste) | `maneuver-config.test.ts` (`tactoMeasureSizeFromConfig` lee true/false) + e2e (3) override persiste y aplica |
| RPSC.4.2 (default derivado del rodeo) | `pregnancy-buckets.test.ts` (`defaultMeasureSize`) + e2e: 2m muestra tamaño / 1m no |
| RPSC.4.3 (override no bloquea, invierte) | `pregnancy-buckets.test.ts` (`effectiveSizeBuckets` override) + e2e (3) "no medir" sobre 3m → directo |
| RPSC.4.4 (sin configurar → NO, no frena) | e2e: `maniobra-tacto-bugfix` (rodeo NULL, VACÍA OK) + `maniobra-carga` reconciliada; `fetchRodeoServiceMonths` null fail-safe |
| RPSC.4.5 / RPSC.5.8 (regla en UNA fn pura) | `pregnancy-buckets.ts` única fuente; `carga.tsx`/`jornada.tsx` la consumen (verificado por grep: cero re-derivación) |
| RPSC.5.1 (binario siempre) | e2e: PREÑADA/VACÍA visibles en todos los casos |
| RPSC.5.2 (1/12/no-medir → sin tamaño, persiste) | e2e (2) 1 mes → PREÑADA directo + server `large` (DD-PSC-2) |
| RPSC.5.3 (2 meses → cabeza/cola) | `pregnancy-buckets.test.ts` + e2e (1)/(1b): CABEZA+COLA, CUERPO count 0 |
| RPSC.5.4 (3..11 → cabeza/cuerpo/cola) | `pregnancy-buckets.test.ts` + e2e `maniobra-carga` (3m → CUERPO presente) |
| RPSC.5.6 (mapeo 1:1) | `pregnancy-buckets.test.ts` + e2e (1): CABEZA → server `large` |
| RPSC.5.7 (un solo evento, valor sin-tamaño cubierto) | e2e (2): server oracle `large`; write-path intacto (`maneuver-events.ts` sin tocar) |
| RPSC.5.9 (lenguaje visual aprobado, sin recorte) | e2e (1b) 360 web táctil: `assertTextNotClipped('PREÑADA'/'CABEZA')` |
| DD-PSC-2 (preñada sin tamaño → 'large') | e2e (2)/(3): server `large` sin sub-paso de tamaño |
| DD-PSC-8 (resumen solo "Preñada") | `maneuver-sequence.test.ts` (`describeStepValue`/`summaryRows` con `tactoMeasuredSize:false`) + e2e (2)/(3) |

## Autorrevisión adversarial (qué busqué, qué encontré, cómo lo cerré)

Pasada hostil sobre el propio trabajo ANTES del reviewer:

1. **Romper el flujo de tacto EXISTENTE (regresión real, ENCONTRADA y CERRADA).** Al cablear `buckets`
   derivados del rodeo, los e2e `maniobra-carga.spec.ts` (×2) y `maniobra-preview-transicion.spec.ts`
   FALLARON: sembraban el rodeo sin `service_months` (NULL → `[]` → PREÑADA directo) pero tapeaban CABEZA/
   CUERPO. **Cerrado:** es el comportamiento CORRECTO per RPSC.4.4 (NULL → sin tamaño); reconcilié esos
   tests sembrando `serviceMonths:[10,11,12]` (3 meses → 3 bloques) → preservan el sub-paso de tamaño donde
   el rodeo está configurado, sin mentir sobre el nuevo comportamiento. Re-verde (9/9).
2. **El wizard asumía "tacto no configurable" (comentario stale, ENCONTRADO y CERRADO).** `maniobra-wizard.spec.ts`
   tenía un comentario "Tacto/Pesaje (no configurables) NO muestran segunda línea" — ahora el tacto SÍ es
   configurable (B2). No había una ASSERTION que rompiera (solo asserta vacunación), pero el comentario
   mentía. **Cerrado:** comentario actualizado al as-built. Verifiqué que ningún spec asserta la AUSENCIA de
   `selected-config` del tacto.
3. **Tests que pasan por la razón equivocada (DD-PSC-8).** El e2e (2)/(3) podría "pasar" si el resumen
   mostrara cualquier cosa sin "· Cabeza". **Cerrado:** asserto AMBOS — `getByText('Preñada', exact)` visible
   Y `getByText('Preñada · Cabeza', exact)` count 0 → ejercita el path real (no solo la ausencia del sufijo)
   + el server oracle `large` confirma la persistencia DD-PSC-2 (no `empty`, no `medium`).
4. **Doble derivación de la regla CCL (drift, lo que DD-PSC-3 prohíbe).** Busqué `length === 2`/`>= 12`/
   `=== 1 ?` en `carga.tsx`/`jornada.tsx`/`TactoStep.tsx` (grep). **Resultado:** solo `serviceMonths.length`
   (computar el nº, no la regla) → `effectiveSizeBuckets`/`defaultMeasureSize`. La regla CCL vive SOLO en
   `pregnancy-buckets.ts`. Cero drift.
5. **Multi-tenant.** `fetchRodeoServiceMonths(rodeoId)` con el rodeoId del ANIMAL real (no del contexto, no
   hardcodeado); lectura local SQLite ya RLS-scopeada por la stream. El config override viene de `session.config`
   (local). Cero hardcode de `establishment_id`/`service_months`. ✓
6. **Offline-first.** Toda lectura es local (`runLocalQuerySingle`), cero red. El override es del jsonb local
   de la sesión. El tacto persiste por el write-path local intacto (`maneuver-events.ts` sin tocar). ✓
7. **Parseo no-injectable / tolerante (`service_months` desde TEXT).** Reuso `parseServiceMonths` (B1, ya
   testeado: TEXT JSON `[10,11]` y literal Postgres `{10,11}`, null/corrupto → null, salida siempre `number[]`
    1–12 o null). `fetchRodeoServiceMonths`: sin fila → null (fail-safe). `tactoMeasureSizeFromConfig`: jsonb
   no confiable → undefined (cae al default). Ningún path tira. ✓
8. **Edge: corrección desde el resumen + cambio de rodeo entre animales.** Corregir el tacto re-entra al
   `TactoStep` con los mismos `buckets` → consistente; el resumen sigue mostrando "Preñada" vía `tactoMeasuredSize`.
   `rodeoServiceMonths` recarga si cambia `animalRodeoId` (effect dep). ✓
9. **`DEFAULT_BUCKETS` del `TactoStep` ahora dead en el flujo real.** El `carga.tsx` SIEMPRE pasa `buckets`.
   **Resuelto con criterio, no borrado:** el default (3 bloques as-built) es defensa para un caller que olvide
   el prop (p. ej. la route mock del spike); es chico, tested y documentado. Borrarlo es scope creep y arriesga
   el spike. Lo dejo (no rediseño componentes aprobados).
10. **Persistencia del config (round-trip jsonb).** `preconfig.tacto = {measureSize}` (objeto) → `buildJornadaConfig`
    lo copia → `createSession` lo `JSON.stringify`-ea → `getSessionById` lo relee → `tactoMeasureSizeFromConfig`
    lo recupera. Cubierto por unit (round-trip por `parseManeuverConfig`) Y por el e2e (3) end-to-end (el override
    persistido aplicó en la carga). ✓

11. **Ventana de carga de `rodeoServiceMonths` (transitorio, EVALUADO → aceptable).** Mientras la lectura
    está en vuelo (`undefined`), `tactoBuckets = effectiveSizeBuckets(null, override) = []` (un nMonths null da
    `[]` aunque el override sea `true`). Teóricamente, un rodeo configurado a "medir Sí" mostraría `[]` hasta
    que resuelva. **Por qué es aceptable (no agrego bloqueo):** (a) la lectura es UNA query LOCAL de SQLite,
    más rápida que la resolución del `gating` (hook multi-query) del que depende el render de la secuencia/paso
    → en la práctica resuelve antes de que el `TactoStep` se monte; (b) si el rodeo NO está sincronizado, la
    respuesta correcta ES `[]` (RPSC.4.4, fail-safe); (c) mismo nivel de robustez que `categoryCatalog`/
    `lastScrotalCm` (también cargados on-`animalRodeoId`, también no-bloqueantes, patrón establecido del frame);
    (d) la e2e con sync real + dwell de 3s pasa fiable. Bloquear el frame entero por esta lectura sería más
    pesado y rompería el idiom offline-first del `carga.tsx`. Lo dejo no-bloqueante y lo anoto para el reviewer.

**Hallazgos = 11 (1+2 fixes/reconciliaciones reales antes de reportar; 3 endurecido; 4–11 verificaciones/evaluaciones).**
0 quedó abierto. Gate 1 N/A reconfirmado (frontend puro; sin schema/RLS/Edge — el `schema.ts` no se tocó porque
`rodeos` ya existe como tabla local; `service_months` ya estaba declarada en el schema de PowerSync por B1).

## Reconciliación de specs

- **`design-puesta-en-servicio-cliente.md §3.2`** — agregada la nota **AS-BUILT del CABLEADO de B2** (cómo
  quedó: la lectura del rodeo, los buckets reales al `TactoStep`, el config en el wizard, DD-PSC-8, la
  backward-compat, los tests + el flake del token). Mismo patrón que la nota AS-BUILT del cableado de B1 en §1.
- **`requirements-puesta-en-servicio-cliente.md`** — **sin reconciliación necesaria**: el *qué* no cambió.
  RPSC.4/5 se cablearon tal cual. `effectiveSizeBuckets` (bridge) y `preconfig.tacto` como objeto son decisiones
  de DISEÑO (van en design.md), no cambios de requirement. IDs `RPSC.x` intactos.
- **`tasks.md`** — Stream B se trackea por chunk en este impl + `current.md` (patrón B4/B1/B2-spike), no hay
  tasks `[ ]` de Stream B en `tasks.md` base. Las tasks de ESTE cableado (T1–T7) quedan `[x]` arriba.
- **`feature_list.json`** — NO tocado (03 sigue `done`; Stream B = deltas additivos bajo notas). Dispatch del leader.
- **e2e reconciliados al nuevo comportamiento** (el código cambió → los tests deben reflejarlo, regla
  `feedback_correcciones_en_specs`): `maniobra-carga.spec.ts` (×2) y `maniobra-preview-transicion.spec.ts`
  siembran `serviceMonths:[10,11,12]` (preservan el sub-paso de tamaño); `maniobra-wizard.spec.ts` comentario
  actualizado (tacto ahora configurable).

## Estado final

- **`check.mjs`**: typecheck **EXIT 0**, anti-hardcode **0 violaciones**, unit **VERDE** (mis suites 212/212,
  incl. `pregnancy-buckets` 19, `service-months` 82, + los nuevos: `tactoMeasureSizeFromConfig` 4, `buildRodeoServiceMonthsQuery` 1,
  DD-PSC-8 en `maneuver-sequence` 2). **ÚNICO rojo**: la suite backend `operaciones_rodeo` (spec 10, AJENA) →
  `adminQuery HTTP 401` del **Management-API** (token `SUPABASE_ACCESS_TOKEN` expirado/inválido) — env/token,
  NO regresión: este delta es **frontend puro** (cero SQL, cero migraciones, no toca spec 10). El baseline `e241e19`
  pasó esa suite al inicio de la sesión; el token degradó después. Mismo class que `reference_check_red_rate_limit`.
  Las operaciones DB reales (service-role) pasan; solo los 4 subtests de introspección de catálogo vía Management-API 401'an.
- **e2e nuevo `maniobra-tacto-adaptativo.spec.ts` 4/4** + regresión VERDE: `maniobra-carga` 3/3, `maniobra-preview-transicion`
  2/2, `maniobra-wizard` 1/1, `maniobra-config-sheet-race` 3/3, `maniobra-tacto-bugfix` 3/3.
- **Gate 1 N/A** (frontend puro; sin schema/RLS/Edge — `pregnancy_status` y la columna `service_months` ya existen;
  el `schema.ts` no se tocó). **Gate 2** lo corre el leader tras el reviewer.
- **NO marqué la feature `done`.** Espera reviewer + Gate 2 + puerta de código de Raf.

### Archivos tocados (todos absolutos en el repo)
- `app/src/services/powersync/local-reads.ts` — `buildRodeoServiceMonthsQuery`.
- `app/src/services/rodeos.ts` — `fetchRodeoServiceMonths` (reusa `parseServiceMonths`).
- `app/src/utils/maneuver-config.ts` — `tactoMeasureSizeFromConfig`.
- `app/src/utils/maneuver-sequence.ts` — `DescribeStepOpts` + `describeStepValue`/`summaryRows` con `tactoMeasuredSize` (DD-PSC-8).
- `app/app/maniobra/jornada.tsx` — `TactoConfigSheet` cableado (tacto configurable, default del rodeo, persiste `preconfig.tacto`).
- `app/app/maniobra/carga.tsx` — `fetchRodeoServiceMonths` + `effectiveSizeBuckets` → `buckets` al `TactoStep`; `tactoMeasuredSize` al resumen.
- Tests: `maneuver-reads.test.ts`, `maneuver-config.test.ts`, `maneuver-sequence.test.ts` (+ schema `rodeos.service_months` en el test).
- e2e: `app/e2e/maniobra-tacto-adaptativo.spec.ts` (nuevo) + `app/e2e/helpers/admin.ts` (`serviceMonths` en seed) +
  reconciliación de `maniobra-carga.spec.ts`/`maniobra-preview-transicion.spec.ts`/`maniobra-wizard.spec.ts`.
- NO tocado: migraciones, `feature_list.json`, el código de B1, los componentes aprobados (`TactoStep`/`TactoConfigSheet`/`pregnancy-buckets.ts`).
