baseline_commit: a80ea30a272c19bb9a7adec3c359ef7cd7ada663

# impl — Stream B / B2 DESIGN-SPIKE (spec 03, RPSC.4 / RPSC.5)

> **Naturaleza**: DESIGN-SPIKE (visual + lógica pura), NO cableado a la jornada real (post-veto).
> "Visual antes de plomería" (ADR-023). El leader vetará con `design-review` antes de mostrar a Raf.
> Frontend puro → **Gate 1 N/A**. `check.mjs` verde para el util + su test.
>
> **Pre-condición**: feature `03-modo-maniobras` = `done` (Stream B = deltas additivos del modelo
> reproductivo, trackeados bajo notas — patrón establecido en B4/B1, ver `current.md`). Dispatch
> explícito del leader para este design-spike de B2. NO se flipa estado de `feature_list.json`.

## Alcance (lo que el leader pidió)

1. `app/src/utils/pregnancy-buckets.ts` (+ `.test.ts`, node:test) — la regla CCL del Gate 0 §4 como
   FUNCIÓN PURA única (DD-PSC-3): `sizeBucketsForServiceMonths(nMonths)` + `defaultMeasureSize(nMonths)`.
2. `TactoStep` adaptativo (variante para el spike): recibe `buckets: SizeBucket[]` → 0/2/3 bloques.
   Preserva el lenguaje visual aprobado. NO rediseña el binario PREÑADA/VACÍA.
3. Config "¿medir tamaño? sí/no" (patrón `ManeuverConfigSheet`), default derivado del rodeo, visible,
   override de un toque.
4. Harness de captura Playwright (gitignored, `tests/stream-b/`), web táctil 360/412, variantes (a)-(d).

## Restricciones (del leader)

- NO cablear a la jornada/carga real (post-veto). Spike visual + lógica pura. Importar el `TactoStep`
  adaptativo en una route mock para capturar (como el spike de B1).
- Tokens, cero hardcode. NO tocar `feature_list.json` ni otros `progress/` salvo este archivo.
- NO tocar el código de B1 ya commiteado.

## Plan (Tn)

- [x] T1 — `app/src/utils/pregnancy-buckets.ts` + `.test.ts` (regla CCL DD-PSC-3). Cubre RPSC.4.5, RPSC.5.8, RPSC.5.6, RPSC.4.2. **19/19 verde.** + registrado en `scripts/run-tests.mjs` (lista explícita del client unit).
- [x] T2 — `TactoStep` adaptativo (prop OPCIONAL `buckets`): 0/2/3 bloques + persistencia DD-PSC-2. Cubre RPSC.5.1-5.4, RPSC.5.9. Real `carga.tsx` sin cambio de comportamiento (default = 3 bloques as-built).
- [x] T3 — `TactoConfigSheet` NUEVO (config "¿medir tamaño?" — estructura de ManeuverConfigSheet, segmentado SÍ/NO, default visible derivado, override). Cubre RPSC.4.1, RPSC.4.2, RPSC.4.3, RPSC.4.4.
- [x] T4 — Route mock `app/app/maniobra/tacto-spike.tsx` (DEV_WEB_ROUTES + Stack.Screen) — 5 variantes (two/three/none/config-yes/config-no) + surface del status confirmado.
- [x] T5 — Harness de captura `app/e2e/captures/tacto-spike.capture.ts` (web táctil 360/412, 6 estados × 2 anchos = 12 PNG, anti-recorte). **2/2 verde.**
- [x] T6 — `check.mjs` verde end-to-end + autorrevisión adversarial + reconciliación de specs.

## Trazabilidad (R<n> → archivo:test)

> El repo NO tiene suite de COMPONENTES de cliente seteada (`conventions.md`: tests de cliente = Fase 3+).
> Los `R<n>` de UI los cubre la captura e2e (web táctil, `tacto-spike.capture.ts`, que ASSERTea, no solo
> screenshot); la regla CCL pura la cubre `pregnancy-buckets.test.ts` (node:test, en `check.mjs`).

| R<n> | Verificación |
|---|---|
| RPSC.4.2 (default derivado del rodeo) | `pregnancy-buckets.test.ts`: "defaultMeasureSize: 2/3/4–11 → SÍ", "1/12/0/NULL → NO" + capture (d)(e) sugerido visible + pre-selección |
| RPSC.4.3 (default no bloquea, override) | `pregnancy-buckets.test.ts`: "effectiveSizeBuckets: override NO/SÍ/undefined" + capture (d): tap NO invierte aria-pressed |
| RPSC.4.4 (sin configurar → NO, no frena) | `pregnancy-buckets.test.ts`: "effectiveSizeBuckets: SÍ sobre 1/12/NULL → []" + capture (e) config-no |
| RPSC.4.5 / RPSC.5.8 (regla en UNA fn pura) | `pregnancy-buckets.ts` = fuente única; `TactoStep` recibe `buckets` (no re-implementa) — verificado por grep de call-sites |
| RPSC.5.1 (binario siempre, no rediseñado) | capture (a)(c): PREÑADA/VACÍA visibles; el binario no se tocó (diff de `TactoStep`) |
| RPSC.5.2 (PREÑADA + 1/12/no-medir → sin tamaño, persiste) | capture (c) `none`: PREÑADA → sin CABEZA/CUERPO + `confirmado: large` (DD-PSC-2) |
| RPSC.5.3 (2 meses → CABEZA/COLA) | `pregnancy-buckets.test.ts`: "2 meses → [Cabeza, Cola]" + capture (a): CUERPO count 0 |
| RPSC.5.4 (3 meses → CABEZA/CUERPO/COLA) | `pregnancy-buckets.test.ts`: "3 meses → [Cabeza, Cuerpo, Cola]" + capture (b) |
| RPSC.5.5 (4–11 → 3 buckets tercios) | `pregnancy-buckets.test.ts`: "4..11 meses → 3 buckets" (loop) |
| RPSC.5.6 (mapeo 1:1) | `pregnancy-buckets.test.ts`: "mapeo 1:1 Cabeza→large/Cuerpo→medium/Cola→small" + capture (a): COLA → `small` |
| RPSC.5.9 (lenguaje visual aprobado) | capturas (a)(b)(c): bloques full-width que reparten el alto, `$primary`, label gigante, "PREÑADA" sin recorte (assertTextNotClipped) |

## Autorrevisión adversarial (qué busqué, qué encontré, cómo lo cerré)

Pasada hostil sobre el propio trabajo ANTES del veto/reviewer:

1. **Tests que pasan por la razón equivocada (DD-PSC-2).** El capture del caso `none` originalmente solo verificaba la AUSENCIA del sub-paso de tamaño (no aparecen CABEZA/CUERPO). Un revisor hostil diría: "¿y si no persiste nada / persiste `empty` en vez de `large`?". **Cerrado:** surfaceé el `pregnancy_status` confirmado en el DOM (`testID="tacto-confirmed-status"`) y el capture ahora ASSERTea `confirmado: large` (DD-PSC-2 real) + `confirmado: small` al tocar COLA (mapeo 1:1 RPSC.5.6 end-to-end). Ahora el test ejercita el path real, no solo la ausencia.
2. **Romper el flujo real de la jornada (la restricción "NO cablees").** El prop `buckets` podría haber roto el `carga.tsx` real. **Cerrado:** lo hice OPCIONAL con `DEFAULT_BUCKETS` = los 3 bloques literales as-built → typecheck limpio + e2e `maniobra-tacto-bugfix` 3/3 verde (la real). El write-path (`maneuver-events.ts`) NO se tocó. Comportamiento del flujo real IDÉNTICO.
3. **`effectiveSizeBuckets` exportado pero no consumido por el spike (dead code?).** **Resuelto con criterio, no borrado:** es el bridge override↔rodeo que la jornada consume al CABLEAR (RPSC.4.3); tenerlo testeado ahora evita que el wiring re-derive la regla ad-hoc (drift, lo que DD-PSC-3 prohíbe). Documentado en design §3.2 como decisión del implementer. Es chico, puro y tiene tests propios.
4. **Conflar el config binario con el sheet de texto libre.** El design decía "sobre el patrón ManeuverConfigSheet". Extender el `ManeuverConfigSheet` (input de texto) para un sí/no habría sido shape equivocado. **Cerrado:** sheet NUEVO `TactoConfigSheet` que REUSA la ESTRUCTURA (scrim-guard doble-rAF, header-fijo/cuerpo/footer-fijo) con un segmentado SÍ/NO. Decisión documentada.
5. **Edge cases de la regla pura.** Busqué: null, 0, 1, 2, 3, 4–11, 12, 13, negativo, NaN, no-entero, mutación del array devuelto, consistencia `defaultMeasureSize`↔`sizeBuckets`, orden estable de buckets. Todos cubiertos (19 tests).
6. **Recorte de descendentes (memoria recurrente).** "PREÑADA" (ñ) y "¿Medir tamaño de preñez?" ('¿','g','ñ'). **Verificado** por `assertTextNotClipped` (bounding-box) en el capture + inspección visual de los 4 PNG clave (2bloques/config-si/binario-1mes/3bloques) — sin recorte.
7. **Hardcode.** Cero literales de color/tamaño; tokens + `getTokenValue` para lucide. `check.mjs` (anti-hardcode lint) verde.
8. **Gaps de seguridad / multi-tenant / offline.** N/A real: spike VISUAL 100% MOCK, sin I/O, sin auth, sin schema, sin establishment_id, sin red. Frontend puro → Gate 1 N/A (design §0).

**Hallazgos = 7 (1+2 fueron fixes reales antes de reportar; 3+4 decisiones documentadas; 5–8 verificaciones).** 0 quedó abierto.

## Reconciliación de specs

- **`design.md §3.2`** — agregada la nota **AS-BUILT del design-spike B2** (cómo quedó construido: `pregnancy-buckets.ts` con las 3 fns, `TactoStep` con `buckets` opcional, `TactoConfigSheet` nuevo, route mock + capturas, decisiones del implementer). Mismo patrón que la nota AS-BUILT de B1 en §3.1.
- **`requirements.md`** — **sin reconciliación necesaria**: el *qué* no cambió. RPSC.4/5 se implementaron tal cual; `effectiveSizeBuckets` y "sheet nuevo vs extender" son decisiones de DISEÑO (van en design.md), no cambios de requirement. Los EARS `RPSC.x` quedan intactos (IDs estables).
- **`tasks.md`** — Stream B no tiene tasks `[ ]` por chunk en `tasks.md` base (las deltas de Stream B se trackean en este impl + el ledger de `current.md`/Gate 0 doc, patrón de B4/B1). Las tasks de ESTE spike (T1–T6) quedan `[x]` arriba.
- **`feature_list.json`** — NO tocado (03 sigue `done`; Stream B = deltas additivos trackeados bajo notas, patrón establecido). Dispatch explícito del leader para el spike.

## Estado final

- `check.mjs` **VERDE end-to-end** (typecheck + anti-hardcode + client unit incl. `pregnancy-buckets` 19/19 + backend suites). Baseline `a80ea30`.
- Captura `tacto-spike.capture.ts` **2/2 verde** → 12 PNG en `tests/stream-b/` (gitignored).
- e2e real `maniobra-tacto-bugfix` **3/3 verde** (flujo real del TactoStep sin regresión).
- **Gate 1 N/A** (frontend puro, sin schema/RLS/Edge — design §0). **Gate 2** lo corre el leader tras el veto si corresponde (spike visual sin superficie de seguridad — sin I/O/auth/inputs/schema; mismo criterio que B4/M6-C.0).
- **NO cableado** a la jornada real (post-veto, como pidió el leader). **NO marqué nada `done`** — espera el veto del leader (design-review) + Raf.

### Capturas para el veto (rutas, gitignored)
- **`tests/stream-b/tacto-2bloques-{360,412}.png`** ← la de 2 botones CABEZA/COLA (rodeo 2 meses) que Raf quiere ver.
- `tests/stream-b/tacto-3bloques-{360,412}.png` — control 3 botones.
- `tests/stream-b/tacto-binario-1mes-{360,412}.png` — binario; PREÑADA va directo (DD-PSC-2).
- `tests/stream-b/config-si-{360,412}.png` + `config-no-{360,412}.png` — config "¿medir tamaño?" con el default sugerido derivado del rodeo.
