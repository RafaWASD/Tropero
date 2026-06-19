baseline_commit: a03e593406da77096a239f7d54eb262ec1f9098f

# impl — Marcar CUT (descarte) desde la ficha + indicador amarillo (delta spec 02)

Feature: `02-modelo-animal` delta CUT-ficha. Frontend puro (sin migraciones/RLS/Edge). Gate 1 N/A.
Spec: `specs/active/02-modelo-animal/{context,requirements,design,tasks}-cut-ficha.md` (RCUT.1–RCUT.8, TCUT.1–TCUT.15).

## Plan (TCUT.1–TCUT.15; TCUT.16/17 son del leader)

- T1/T2 — módulo puro `cut-eligibility.ts` + test (canMarkCut/canUnmarkCut/isCutCategory).
- T3 — `local-reads.ts` proyecta `is_cut` en buildAnimalDetailQuery (synced: ap.is_cut; overlay: 0).
- T4 — `animals.ts`: LocalDetailRow.is_cut + AnimalDetail.isCut + mapeo en fetchAnimalDetail.
- T5/T6 — `animals.ts`: setCut/unsetCut reusando resolveCutCategory + builders.
- T7 — unit del servicio (cut-service.test.ts) con fakes.
- T8 — tokens amber `cutText`/`cutBg` en tamagui.config.ts.
- T9 — CategoryBadge: prop code? + variante amarilla via isCutCategory.
- T10 — AnimalRow: pasar code={categoryCode} al badge.
- T11/T12/T13 — ficha: CutRow + render rama hembras + gate dientes + suprimir CategoryOverrideCard si isCut + code al hero badge.
- T14 — e2e cut-ficha.spec.ts (lo corre el leader).
- T15 — enganchar tests nuevos en run-tests.mjs.

## Bitácora

- TCUT.1/TCUT.2 — `cut-eligibility.ts` + test. 16 tests verdes. GOTCHA: varios Write dejaron un artefacto
  `</content>` al final del archivo → "ERR_INVALID_TYPESCRIPT_SYNTAX". Cazado por bisección; limpiado en
  TODOS los archivos escritos (cut-eligibility.ts/.test.ts, cut-service-core.ts/.test.ts, cut-ficha.spec.ts,
  el progress).
- TCUT.3 — `local-reads.ts buildAnimalDetailQuery`: `ap.is_cut AS is_cut` (synced) + `0 AS is_cut` (overlay).
  Aserto sumado en `local-reads.test.ts`. 116 verdes.
- TCUT.4 — `animals.ts`: `LocalDetailRow.is_cut?` + `AnimalDetail.isCut` + `fetchAnimalDetail` mapea
  `isCut: toBool(row.is_cut ?? 0)`.
- TCUT.5/6/7 — `setCut`/`unsetCut` en `animals.ts` delegan en el núcleo PURO `cut-service-core.ts`
  (`decideSetCut`/`decideUnsetCut`), testeado con fakes en `cut-service-core.test.ts` (9 verdes). Ver
  RECONCILIACIÓN abajo.
- TCUT.8 — tokens `cutText`/`cutBg` en `tamagui.config.ts` (palette + grupo color). Contraste VERIFICADO
  con node (WCAG relative-luminance): cutText/cutBg = 5.27:1, cutText/white = 6.49:1 (ref verde 4.55:1).
- TCUT.9 — `CategoryBadge`: prop `code?` + variante amarilla ($cutBg/$cutText) por `isCutCategory`; el punto
  de override también toma el color de la variante. a11y intacta.
- TCUT.10 — `AnimalRow`: `code={categoryCode}` al badge.
- TCUT.11/12/13 — ficha: `CutRow` (mark/unmark, confirmación inline, consecuencia literal, error inline,
  busy) + handlers `onSetCut`/`onUnsetCut` (optimismo en sitio + refresh silencioso) + `dientesEnabled`
  best-effort (fail-safe false, solo hembras) + render rama hembras + `code` al badge del hero + supresión
  de `CategoryOverrideCard` cuando isCut (RCUT.5.7).
- TCUT.14 — `app/e2e/cut-ficha.spec.ts` (web táctil, hasTouch + tap()): marcar→amarillo→quitar→verde +
  RCUT.5.7. ESCRITO; lo corre el leader.
- TCUT.15 — enganchados `cut-eligibility.test.ts` + `cut-service-core.test.ts` en `run-tests.mjs` (tras
  castration-copy.test.ts, sin tocar regiones de spec 03/08).

## Resultado de tests corridos (yo)

- `node --test cut-eligibility.test.ts cut-service-core.test.ts local-reads.test.ts` → **141 verdes**.
- + adjacentes (animal-category, bulk-candidates, bulk-selection, exit-animal) → **282 verdes, 0 fallos**.
- `pnpm typecheck` (app/) → **0 errores** (limpio; el error transitorio en `CustomManeuverStep.tsx` era de
  la terminal paralela de spec 03 y ya lo arreglaron).
- `node scripts/check-hardcode.mjs` → **0 violaciones** (mis archivos limpios; tokens por token).
- NO corrí `scripts/check.mjs` completo ni `pnpm e2e` (riesgo de rate-limit con la terminal paralela +
  siembra Supabase). El E2E `cut-ficha.spec.ts` lo corre el leader.

## Mapa R<n> → test

| RCUT | Test |
|---|---|
| RCUT.1.1/1.2/1.3/1.4 | `cut-service-core.test.ts` (decideSetCut: resuelve+escribe cutCategoryId / null→error sin escribir / resolve falla / write falla) |
| RCUT.2.1/2.2/2.3 | `cut-service-core.test.ts` (decideUnsetCut: escribe derivedCategoryId / null→error sin escribir / propaga) + el SET-vs-UNSET usa ids distintos |
| RCUT.3.1/3.2/3.3 | `cut-eligibility.test.ts` (canMarkCut: hembra≠ternera→true / macho→false / ternera→false / null→conservador) |
| RCUT.4.1 | `local-reads.test.ts` (proyección ap.is_cut + 0 overlay) + `animals.ts` mapeo (typecheck) |
| RCUT.5.4 (canUnmark) | `cut-eligibility.test.ts` (canUnmarkCut) + e2e (afordancia "Quitar CUT") |
| RCUT.5.1/5.2/5.3/5.6 | e2e `cut-ficha.spec.ts` (confirmación inline + consecuencia literal) |
| RCUT.5.7 | e2e (CUT NO muestra "Quitar fijación"; override no-CUT SÍ) |
| RCUT.6.1/6.2/6.5 | `cut-eligibility.test.ts` (isCutCategory por code / fallback label) + e2e (color amber vs verde) |
| RCUT.6.3 | contraste medido (node, doc en design §2 + comentario del token) |
| RCUT.6.4 | a11y intacta en `CategoryBadge` (label sigue comunicando la categoría) — revisión de código |
| RCUT.7.1/7.2/7.3 | gate `dientesEnabled` en `[id].tsx` (canMark ANDea dientes; canUnmark no; fail-safe false) — revisión + e2e (dientes ON por default en cría) |
| RCUT.8.1/8.2 | tokens + voseo + a11y helpers (revisión + check-hardcode); offline = write local plano (revisión) |

## Autorrevisión adversarial (busqué el caso que rompe)

- **CUT en macho** → `canMarkCut`/`canUnmarkCut` exigen `sex==='female'` + la sección solo renderiza en
  `detail.sex==='female'`. Cubierto en unit + render.
- **Ternera** → `canMarkCut` excluye `'ternera'`. Unit.
- **Override no-CUT** (vaca comprada) → `CategoryOverrideCard` se sigue mostrando (`categoryOverride &&
  !isCut`); solo se suprime para un CUT. E2E lo verifica explícito.
- **Dientes deshabilitado** → `canMark` ANDea `dientesEnabled` (fail-safe `false`); "Quitar CUT" NO depende
  de dientes (sustractivo, RCUT.7.2). Estado inicial false (no ofrecer a ciegas). Revisión + el gate solo
  resuelve para hembras (no I/O inútil en machos).
- **categoryCode null/''** → `canMarkCut` conservador → false. Unit.
- **Contraste** → medido con node, no a ojo (5.27 / 6.49 / ref 4.55).
- **Descendentes recortadas** ("Marcar como CUT (descarte)" tiene g/j) → `lineHeight` matcheado al fontSize
  en TODOS los Text de `CutRow` (incl. el botón con numberOfLines).
- **a11y** → botones por `buttonA11y`, consecuencia por `labelA11y`; badge mantiene su a11yLabel.
- **Test que pasa por la razón equivocada** → el test del núcleo verifica que NO se escribe cuando el id es
  null (con un flag `wrote`), que SET usa el cutCategoryId y UNSET el derivedCategoryId (ids distintos), y
  que el error del write se PROPAGA (no se inventa ok). El test de eligibilidad incluye una prueba de
  EXCLUSIÓN MUTUA exhaustiva (canMark && canUnmark nunca ambos true).
- **Offline-first** → setCut/unsetCut son UN write local plano cada uno (runLocalWrite, sin red); la RLS +
  gating 0054 re-validan AL SUBIR (no en el cliente). El gate de cliente es prevención, no autorización.
- **Optimismo** → al marcar, `setDetail` setea isCut/override/code/name = CUT → badge amarillo al toque;
  al quitar, isCut=false + override=false y la categoría derivada la trae el refresh (no se adivina mal).
  REVERT del optimismo si el write falla (snapshot).

## Reconciliación de specs (as-built ≠ spec → reconciliado ANTES del reviewer)

- **Núcleo puro `cut-service-core.ts`** (NO estaba en el design): `setCut`/`unsetCut` delegan la DECISIÓN en
  `decideSetCut`/`decideUnsetCut` (puro, inyectable). Motivo: los servicios value-importan el SDK
  (Supabase/PowerSync) → no son importables bajo `node:test`; `mock.module` exige
  `--experimental-test-module-mocks` que el runner del repo NO pasa. El núcleo puro hace el contrato
  testeable con fakes SIN tocar el SDK (mismo patrón que `resolveTagLookup`/`maniobra-identify.ts`). El
  **contrato público NO cambia** (`setCut`/`unsetCut`: `Promise<ServiceResult<true>>`). Reconciliado en
  `design.md` (§1 tabla de archivos + §3 nota as-built) y `tasks.md` (TCUT.7). `requirements.md` NO se tocó:
  el *qué* (comportamiento, contrato, mensajes es-AR) es idéntico — solo cambió el *cómo* (factoring), que
  es nivel design.
- **Test del servicio**: `cut-service-core.test.ts` (núcleo) en vez de `cut-service.test.ts` sobre
  `animals.ts` directo. Misma cobertura de RCUT.1/RCUT.2 con fakes. Reconciliado en `tasks.md` (TCUT.7).

## Para el leader

- **TCUT.16 — veto de diseño** (`design-review`): capturar el badge CUT amarillo en la ficha (hero) y en la
  lista (AnimalRow); verificar legibilidad a pleno + el contraste medido (5.27:1). Re-iterar conmigo si no
  cierra antes de mostrarle a Raf.
- **TCUT.17 — cierre**: correr `app/e2e/cut-ficha.spec.ts` (con cuidado por la terminal paralela +
  siembra/rate-limit) + `node scripts/check.mjs` verde + reviewer + Gate 2 (security code). El baseline para
  el Gate 2 está arriba (`baseline_commit`). NO marqué la feature `done` (espera al reviewer).
- **Colisión paralela**: toqué `tamagui.config.ts` (solo el grupo `color`/`palette`, no `size`),
  `animals.ts`, `local-reads.ts`, `run-tests.mjs` SOLO en mis regiones. NO corrí git add/commit/stash.
