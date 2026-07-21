baseline_commit: 080100b399dd75467130295b5ef6abb5f7130cc1

# impl U3 — preñez duplicada al dar de alta durante una maniobra de tacto

Bugfix U3 de la tanda `docs/plan-mejoras-2026-07-20.md` (Tier 1). Atómico.

## Reporte (Raf)
Al dar de alta una hembra DURANTE una maniobra que mide tacto/preñez, el ALTA pregunta la preñez;
pero la maniobra la va a pedir igual sobre ese mismo animal → se registran DOS eventos de tacto+
(dato duplicado/basura en el momento de carga).

## Causa raíz (archivo:línea)
- `app/app/crear-animal.tsx:269` — `showPregnancy = categoryFields.includes('pregnancy')` se deriva
  SOLO de la categoría; ignora por completo el contexto de la maniobra activa.
- `app/app/crear-animal.tsx:609-612` — si la preñez capturada es positiva, el alta crea un evento
  reproductivo `tacto` post-create (`addTacto`).
- `app/app/maniobra/identificar.tsx:433-436` (y `466-469`) — el alta lanzada desde la manga navega a
  `/maniobra/carga` con el `sessionId`. Si la jornada incluye la maniobra `tacto`, el `TactoStep`
  vuelve a pedir la preñez sobre el MISMO animal y crea un segundo evento `tacto` (`onConfirm`).
- El punto exacto: el alta captura/registra preñez (evento `tacto`) **sin saber** que la jornada activa
  va a tactar a ese mismo animal. Todas las categorías que muestran preñez en el alta
  (`multipara`, `vaca_segundo_servicio`, `vaquillona_prenada` — ver `animal-category-fields.ts`) están
  en `PROVEN_FEMALE_CATEGORY_CODES` → la maniobra `tacto` SIEMPRE aplica a ellas
  (`maneuver-applicability.ts` `appliesToAnimal('tacto', …)`), así que la duplicación es sistemática.

## Fix (forma elegida)
Cuando el alta se lanza DESDE una jornada que MIDE PREÑEZ (incluye la maniobra `tacto`), se SUPRIME el
campo de preñez del alta: la maniobra es la dueña de ese dato. Fuera de una jornada de tacto (alta normal
o jornada sin tacto), el alta sigue preguntando preñez como hoy.

Cohesión: `crear-animal.tsx` ya recibe el `sessionId` de la jornada (contexto MODO MANIOBRAS) y lo usa
para la navegación post-create. Deriva de ese mismo `sessionId` si la jornada mide preñez leyendo la
sesión del SQLite local (offline). Ningún caller nuevo tiene que "acordarse" de pasar un flag extra: basta
el `sessionId` que ya pasa. Al gatear `showPregnancy` se suprime tanto el render del campo como el
`addTacto` post-create (porque `pregnantCaptured = showPregnancy && …`).

Default seguro: mientras la sesión no resolvió (o si la lectura falla), NO se suprime (preñez visible =
comportamiento actual, sin regresión, sin pérdida de dato). La carrera es invisible: la lectura arranca
en el montaje (paso 1) y el campo de preñez vive en el paso 4 del wizard.

## Plan
- [x] T1: helper puro `sessionMeasuresPregnancy(config)` en `maneuver-config.ts` + unit test.
- [x] T2: wiring en `crear-animal.tsx` (leer la sesión del `sessionId`, gatear `showPregnancy`).
- [x] T3: E2E — suppression end-to-end (sin duplicado) + control (jornada sin tacto → preñez intacta).
- [x] T4: autorrevisión adversarial + reconciliación de specs + capture Gate 2.5.

## Archivos tocados (código de la app + tests)
- `app/src/utils/maneuver-config.ts` — helper puro `sessionMeasuresPregnancy` + const `PREGNANCY_MANEUVER`.
- `app/src/utils/maneuver-config.test.ts` — 5 unit tests del helper.
- `app/app/crear-animal.tsx` — lee la sesión (`getSessionById`) + gatea `showPregnancy` con `!sessionMeasuresPreg`.
- `app/e2e/helpers/admin.ts` — oráculo `countServerTactoEvents(profileId)`.
- `app/e2e/maniobra-alta-prenez-dup.spec.ts` — E2E (A suppression + no-dup / B control) [nuevo].
- `app/e2e/captures/prenez-alta-maniobra.capture.ts` — capture Gate 2.5 (ADR-029) [nuevo].
- Reconciliación de specs: `specs/active/03-modo-maniobras/{requirements,design}.md` (R4.1 / §6.bis.9-bis),
  `specs/active/02-modelo-animal/design.md` (cross-ref bajo R4 alta).

## Verificación (verde)
- Unit: `node --import ./scripts/ts-ext-resolver.mjs --test app/src/utils/maneuver-config.test.ts` → 41/41
  (5 nuevos: con tacto / sin tacto / tacto_vaquillona-no-cuenta / doble-encoding sincronizado / jsonb hostil).
- Typecheck app: `cd app && pnpm typecheck` → OK (e2e excluido del scope de tsc por diseño).
- E2E: `pnpm exec playwright test e2e/maniobra-alta-prenez-dup.spec.ts` → 2/2:
  - (A) jornada de tacto → alta de Multípara: campo de preñez AUSENTE (condición/cría presentes) → tras
    completar el tacto de la maniobra (PREÑADA→CABEZA), el server queda con **exactamente 1** evento `tacto`
    (con el bug eran 2). Oráculos: `waitForServerAnimalProfile` + `waitForServerTactoWithSession('large')` +
    `countServerTactoEvents === 1`.
  - (B) control jornada SIN tacto (solo Pesaje) → el campo de preñez SÍ aparece.
- Capture Gate 2.5: `pnpm exec playwright test e2e/captures/prenez-alta-maniobra.capture.ts --config
  playwright.capture.config.ts` → 2/2 shots a `__shots__/prenez-alta-maniobra/` (01 tacto sin-preñez /
  02 control con-preñez). PNGs gitignored (NO se `git add`). El e2e:build NO churneó `design/*.png`.

## Trazabilidad (R → archivo:test)
| Requisito / comportamiento | Test |
|---|---|
| Helper: jornada CON tacto → mide preñez | `maneuver-config.test.ts` › "sessionMeasuresPregnancy: jornada CON tacto → true" |
| Helper: jornada SIN tacto → no mide (control) | `maneuver-config.test.ts` › "sessionMeasuresPregnancy: jornada SIN tacto → false" |
| Helper: tacto_vaquillona no cuenta (mide aptitud) | `maneuver-config.test.ts` › "tacto_vaquillona NO cuenta" |
| Helper: config sincronizado / jsonb hostil no tira | `maneuver-config.test.ts` › "doble-encoding" + "jsonb pass-through hostil" |
| R4.1 (recon. U3): alta desde jornada de tacto NO captura preñez → 1 solo tacto | `maniobra-alta-prenez-dup.spec.ts` › (A) |
| R4.1 (recon. U3): fuera de jornada de tacto el alta SIGUE preguntando preñez | `maniobra-alta-prenez-dup.spec.ts` › (B) |
| Veto visual (Gate 2.5, ADR-029): estados con/sin campo de preñez | `captures/prenez-alta-maniobra.capture.ts` (01/02) |

## Autorrevisión adversarial (qué busqué / qué encontré / cómo lo cerré)
1. **¿Rompe el alta NORMAL (sin sessionId)?** No: el efecto early-returns si `maneuverSessionId===''` →
   `sessionMeasuresPreg` queda `false` → `showPregnancy` sin cambios. Cubierto por (B) + los tests de
   alta de spec 02 (vaquillona preñada) que siguen verdes conceptualmente (misma rama).
2. **¿Rompe otras maniobras (jornada sin tacto)?** No: `sessionMeasuresPregnancy` es `false` sin `tacto`.
   Cubierto explícitamente por el control (B) — jornada de Pesaje → preñez visible.
3. **Carrera de carga async:** la lectura de sesión arranca en el montaje (paso 1); el campo de preñez vive
   en el paso 4 → invisible en la práctica. Si NO resolvió / si falla → default `false` = preñez visible
   (sin pérdida de dato; el peor caso es el comportamiento de hoy, no una regresión). Guard `active` evita
   set-after-unmount. La E2E (A) prueba que para el paso 4 la supresión ya aplicó.
4. **Falla de `getSessionById` (null / error):** solo se setea `true` con `r.ok && r.value` y jornada que
   mide preñez → fail-open a "preñez visible" (elegí data-loss-safe: mejor poder registrar preñez que
   ocultarla sin certeza).
5. **Efecto colateral en `categoryOverride`:** para `vaquillona_prenada`, no capturar preñez hace que
   `pregnantCaptured=false` → override pasa de `false` a `true` (categoría PINEADA a la elegida — patrón
   "vaca comprada" A5, benigno; la categoría elegida se preserva y la maniobra registra el tacto+). Para
   `multipara`/`vaca_segundo_servicio` el override YA era `true` (no age-derivable) → sin cambio. No hay
   categoría que muestre preñez en el alta y NO esté en `PROVEN_FEMALE_CATEGORY_CODES` → cero supresión
   falsa (siempre que suprimo, la maniobra efectivamente tacta ese animal).
6. **Test que pasa por la razón equivocada:** (A) no se limita a "preñez ausente" (podría pasar si el paso
   entero no renderizó): asevero que condición + cría SÍ están (fix quirúrgico) y que el tacto de la
   MANIOBRA sí llega al server (`waitForServerTactoWithSession('large')`) → no es "preñez desapareció de
   todos lados". El `countServerTactoEvents === 1` prueba el estado final "no duplicado".
7. **Multi-tenant:** sin `establishment_id` hardcodeado; `getSessionById(id)` scopea por id + RLS; el
   animal se crea en el rodeo del contexto. **Offline-first:** `getSessionById` es lectura LOCAL (offline);
   no se agregó dependencia de red.
8. **Fuera de scope (anotado, NO tocado):** existe una duplicación análoga de `tacto_vaquillona` (aptitud)
   — el alta captura `heiferFitness` para vaquillona y la maniobra `tacto_vaquillona` también podría. NO es
   el bug reportado (U3 = preñez, atómico) y su condición es más matizada (depende del `reproStatus`
   derivado); el fix acá NO lo empeora (solo chequea `tacto`, no `tacto_vaquillona`). Candidato de backlog,
   fuera del alcance de U3.

## Reconciliación de specs (código ↔ spec)
El as-built quedó IGUAL a lo diseñado (no hubo desvío durante la implementación). Se agregaron notas de
reconciliación porque el fix REFINA el contrato del alta-en-contexto-maniobra:
- `specs/active/03-modo-maniobras/requirements.md` — nota de reconciliación U3 bajo **R4.1** (dueño del
  contrato find-or-create / alta desde la manga).
- `specs/active/03-modo-maniobras/design.md` — nueva subsección **§6.bis.9-bis** (as-built del fix).
- `specs/active/02-modelo-animal/design.md` — cross-ref bajo la reconciliación del alta (R4) que documenta
  la supresión del campo de preñez del paso 4.
No hay `tasks.md` de spec afectado (U3 es un bugfix de `docs/plan-mejoras-2026-07-20.md`, no una task SDD).

## Restricciones respetadas
- NO se tocó BLE (`app/src/services/ble/**`, `baston.tsx`, `*-multivendor*`), ni reportes, ni la pantalla
  de vacunas.
- NO se commiteó (el leader coordina). NO se corrió `check.mjs` full ni suites backend remotas (solo el
  unit del helper + la E2E de este flujo).
- `design/*.png` NO churneó por mi corrida (verificado con `git status design/`). Los `__shots__/*.png` van
  gitignored (no `git add`).
- Otros archivos que figuran modificados en el working tree (`scripts/run-tests.mjs`,
  `CONTEXT/07-pendientes.md`, `progress/impl_U5*`, `impl_U6a*`, `.claude/agents.zip`) son de OTRAS terminales
  paralelas — NO los toqué.
