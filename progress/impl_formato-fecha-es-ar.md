baseline_commit: 0ad1dbe01ecef2ba7cda387c843dc9ae2da22696

# impl — formato-fecha-es-ar (corrección cross-cutting)

Corrección APROBADA por Raf: todas las fechas mostradas al usuario en formato argentino dd/mm/aaaa
(contextual dd/mm cuando el año es obvio). Util único + migración. Formatos de MÁQUINA intactos.
Diseño provisto = spec (convención delta-spec, ADR-028). N/A specs/active/<name> (corrección directa).

## Tasks (todas completadas)

- [x] T1 — util `app/src/utils/format-date-es-ar.ts` (formatDateEsAr / formatDateCompactEsAr /
      formatDateTimeEsAr), tz-safe (string-puro date-only, getters locales para instantes).
- [x] T1-test — `format-date-es-ar.test.ts` (16 tests: dd/mm/aaaa, null→'—', tz-safety string-pura,
      bisiesto, compact mismo/otro año, instante local, fecha+hora) + agregado al runner.
- [x] T2 — fix `formatEventDate` (event-timeline.ts): rama mismo-año "DD MMM" → "dd/mm" (dateOnly +
      no-dateOnly). Hoy/Ayer/otro-año intactos. Removido MESES_ES (huérfano tras el fix).
- [x] T3 — animal/[id].tsx:903 birthDate → formatDateEsAr.
- [x] T4 — exit-animal.ts archivedBadgeLabel → formatDateEsAr.
- [x] T5 — reports-format.ts sessionDateLabel/sessionRangeLabel → formatDateEsAr.
- [x] T6 — sigsa-display.ts exportLogDateLabel → formatDateTimeEsAr.
- [x] T7 — maniobra-resume.ts resumeStartedDateLabel → formatDateCompactEsAr.
- [x] T8 — miembros.tsx formatDate (invitaciones) → formatDateCompactEsAr (display extra hallado en el
      barrido; entra en el mandato "todas las fechas mostradas al usuario").
- [x] T9 — tests afectados actualizados (event-timeline / reports-format / sigsa-display / exit-animal)
      + aserciones nuevas que fijan el formato dd/mm/aaaa + el fix de drift date-only.
- [x] T10 — e2e: verificado que ninguna aserción de formato viejo rompe; capture Gate 2.5 generada.
- [x] T11 — convención reconciliada en docs/conventions.md + spec 03/design.md.

## Archivos + líneas cambiados

Fuente (código):
- `app/src/utils/format-date-es-ar.ts` — NUEVO (util único).
- `app/src/utils/event-timeline.ts` — formatEventDate mismo-año → dd/mm (líneas ~808, ~824); MESES_ES
  removido; docstring actualizado.
- `app/app/animal/[id].tsx` — import formatDateEsAr; línea 904 (ex-903) birthDate → formatDateEsAr.
- `app/src/services/exit-animal.ts` — import formatDateEsAr; archivedBadgeLabel (~149) → formatDateEsAr.
- `app/src/utils/reports-format.ts` — import formatDateEsAr; sessionDateLabel (~520) → formatDateEsAr.
- `app/src/utils/sigsa-display.ts` — import formatDateTimeEsAr; exportLogDateLabel (~73) → formatDateTimeEsAr.
- `app/src/utils/maniobra-resume.ts` — import formatDateCompactEsAr; resumeStartedDateLabel (~40) → util.
- `app/app/miembros.tsx` — import formatDateCompactEsAr; formatDate local removido; call-site (~604).

Tests:
- `app/src/utils/format-date-es-ar.test.ts` — NUEVO.
- `app/src/utils/event-timeline.test.ts` — 2 asserts mismo-año → '08/01'; comentario '"dd/mm"'.
- `app/src/utils/reports-format.test.ts` — sessionDateLabel dd/mm/aaaa + test drift date-only.
- `app/src/utils/sigsa-display.test.ts` — exportLogDateLabel dd/mm/aaaa · HH:MM + exacto determinístico.
- `app/src/services/exit-animal.test.ts` — badge dd/mm/aaaa.
- `scripts/run-tests.mjs` — agregado format-date-es-ar.test.ts a la suite de unit tests.

Capture (Gate 2.5, ADR-029):
- `app/e2e/captures/fechas-es-ar.capture.ts` — NUEVO (ficha Nacimiento dd/mm/aaaa). Shot generado:
  `__shots__/fechas-es-ar/01-ficha-nacimiento-dd-mm-aaaa.png` (gitignored). Corrida OK (1 passed).

Docs / specs reconciliados:
- `docs/conventions.md` — nueva sección "Formato de datos para el usuario (es-AR)" (números + fechas
  dd/mm/aaaa contextual dd/mm; regla tz-safe string-pura). Espeja el precedente del formato numérico.
- `specs/active/03-modo-maniobras/design.md` — nota de reconciliación en la línea de
  `resumeStartedDateLabel` (ahora delega en formatDateCompactEsAr).

## Inventario de displays migrados (antes → después)

| # | Display | Antes | Después |
|---|---|---|---|
| 🔴 | Ficha "Nacimiento" (animal/[id].tsx) | `2026-06-07` (ISO crudo) | `07/06/2026` |
| 🔴 | Badge archivada (exit-animal) | `Vendido el 2026-06-07` | `Vendido el 07/06/2026` |
| 🟡 | Fecha de sesión (reports-format) | `24 jun 2026` | `24/06/2026` |
| 🟡 | Alerta dosis vencidas (reportes, next_dose_date date-only) | `venció el 6 jun 2026` (drift −1 posible) | `venció el 07/06/2026` (sin drift) |
| 🟡 | Historial SIGSA (sigsa-display) | `15 mar 2026 · 14:32` | `15/03/2026 · 14:32` |
| 🟢 | Timeline mismo-año (formatEventDate) | `15 abr` | `15/04` (Hoy/Ayer/otro-año intactos) |
| 🟢 | Estados vigentes ficha (peso/condición/preñez/CE) | `15 abr` | `15/04` (vía formatEventDate) |
| 🟢 | Retomar jornada (maniobra-resume) | `12/06` | `12/06` (igual mismo-año; +año si otro año) |
| + | Invitaciones miembros (miembros.tsx) | `Creada 15 jun · vence 22 jun` | `Creada 15/06 · vence 22/06` (+año si otro año) |

## Trazabilidad (punto de diseño → test)

- Util dd/mm/aaaa + null→'—' → `format-date-es-ar.test.ts` ('formatDateEsAr: date-only…', '…→ "—"').
- Util TZ-safe string-pura → `format-date-es-ar.test.ts` ('TZ-SAFE — date-only NO driftea').
- Util bisiesto → `format-date-es-ar.test.ts` ('año bisiesto (29 feb)').
- Util compact mismo/otro año → `format-date-es-ar.test.ts` ('mismo año → dd/mm', 'otro año → dd/mm/aaaa').
- Util con hora → `format-date-es-ar.test.ts` ('formatDateTimeEsAr: instante real → dd/mm/aaaa · HH:MM',
  '…dd/mm/aaaa EXACTO (instante local)').
- formatEventDate mismo-año dd/mm → `event-timeline.test.ts` ('mismo año → "dd/mm"' + dateOnly).
- Badge archivada dd/mm/aaaa → `exit-animal.test.ts` ('badge: sold con fecha → dd/mm/aaaa', 'dead/transferred').
- sessionDateLabel dd/mm/aaaa + fix drift date-only → `reports-format.test.ts` ('sessionDateLabel: dd/mm/aaaa',
  'date-only (next_dose_date) → dd/mm/aaaa SIN drift').
- exportLogDateLabel dd/mm/aaaa·HH:MM → `sigsa-display.test.ts` ('exportLogDateLabel: … dd/mm/aaaa · HH:MM',
  'formato numérico dd/mm/aaaa EXACTO').
- resumeStartedDateLabel dd/mm → `maniobra-resume.test.ts` ('jornada de OTRO día → dd/mm').
- Ficha birthDate render real dd/mm/aaaa → capture `fechas-es-ar.capture.ts` (01-ficha-nacimiento) + veto visual.

## Autorrevisión adversarial (paso 8)

Busqué activamente, como revisor hostil:
1. **¿Algún display de fecha UI sin migrar?** Barrido de `toLocaleDateString`/`toLocaleTimeString` y de
   arrays de meses / `month: 'short'` en `src/`+`app/` (excl. tests) → **0 restantes** tras la migración.
   Hallé un display NO listado en el diseño (miembros.tsx invitaciones, "DD MMM") y lo migré (T8).
2. **¿Rompí un formato de máquina?** Los `value={date}` restantes son `FormField` de ENTRADA en vivo
   ("Fecha (AAAA-MM-DD)", `onChangeText`) en agregar-evento.tsx / baja.tsx → NO TOCAR (correcto, intactos).
   No toqué generadores SIGSA, parse CSV/xlsx/txt, payloads RPC, ni comparaciones lexicográficas
   (isoYear/birthYearToDate/todayIso/animal-category) ni la rueda (animal-input). El sort del timeline
   (dayKey/sortTimelineItems/deriveCurrentState) quedó intacto — solo cambié el DISPLAY de formatEventDate.
3. **¿tz-safety real?** date-only por STRING (regex prefijo, sin `new Date`) → sin drift; instante por
   getters LOCALES. Tests explícitos '2022-07-01'→'01/07/2022', '2026-01-01'→'01/01/2026'. El caso
   `next_dose_date` (columna `date`) pasaba por `new Date().toLocaleDateString` → drift −1 en AR; migrar a
   formatDateEsAr (string) lo ARREGLA (test dedicado). Los date-only UTC-midnight del timeline NO pasan por
   este util (los maneja formatEventDate con dateOnly) — documentado en la cabecera del util.
4. **Edge cases:** null/undefined/vacío/whitespace/basura → '—' (o 'Sin fecha'/null en los wrappers que
   ya tenían ese copy: sessionDateLabel, exportLogDateLabel, resumeStartedDateLabel). Cubiertos.
5. **Tests que pasan por la razón correcta:** las aserciones nuevas fijan el string EXACTO del formato
   nuevo (no un `includes` laxo); los instantes se construyen con componentes LOCALES → deterministas en
   cualquier huso del runner.

Nada quedó abierto: no encontré desviaciones no resueltas.

## Reconciliación de specs (paso 9)

- `docs/conventions.md`: convención de formato es-AR (números + fechas) documentada, espejando el
  precedente del formato numérico (memoria reference_es_ar_number_format) + la regla dura tz-safe.
- `specs/active/03-modo-maniobras/design.md`: nota de reconciliación en `resumeStartedDateLabel`
  (delega en el util; el zero-padding lo garantiza el util, no la lógica manual). El resto de menciones
  "DD/MM" en specs (alta form 02, import 12) son de ENTRADA (máscara/parse), NO display → NO se tocan.

## Verificación

- `node scripts/check.mjs` → **VERDE** (typecheck cliente + client unit tests incl. format-date-es-ar +
  RLS + Edge + Animal + Maneuvers + puesta-en-servicio + reports + SIGSA suites).
- Unit del util + suites afectadas: 204 pass, 0 fail (corrida targeted).
- Capture Gate 2.5: `pnpm exec playwright test e2e/captures/fechas-es-ar.capture.ts --config
  playwright.capture.config.ts` → 1 passed; PNG generado; veto visual OK (ficha muestra "Nacimiento
  15/04/2023"). El `UV_HANDLE_CLOSING` post-pass = teardown de Windows OK (no fallo).
- e2e regresión: la única aserción de display de fecha (`/Vendido el /`, animals.spec.ts:671) es laxa
  (prefijo) → sobrevive al nuevo formato "Vendido el 07/06/2026". No toqué ningún .spec.ts. NO toqué las
  líneas ~614/~777 de animals.spec.ts (otros deltas).

## Notas para el leader

- Correr el build/capture re-renderizó `design/**/*.png` (byte diffs espurios, memoria conocida) — dejé
  todo SIN `git add`; revertí nada (el leader revierte design/ antes de commitear). Los `__shots__/*.png`
  quedan gitignored.
- No hice `git add` ni commits (stagea el leader).
