# Tasks (delta spec 02) — Marcar CUT (descarte) desde la ficha + indicador amarillo

**Status**: `spec_ready` (delta de spec 02 — frontend). Implementa `requirements-cut-ficha.md` +
`design-cut-ficha.md`. **Gate 1 N/A** (frontend puro, sin schema/RLS/Edge).

> Orden por dependencia. Marcadas las que tocan archivos **con cambios sin commitear de otra terminal**
> (`tamagui.config.ts`, `animals.ts`, `local-reads.ts`, `scripts/run-tests.mjs`) — ver memoria
> `feedback_parallel_terminals`: implementar en worktree aislado o SECUENCIAR tras el commit de esa terminal
> y commitear solo este slice (no pisar su trabajo). Las marcadas **colisión-safe** crean archivos nuevos o
> tocan archivos no compartidos → se pueden hacer en paralelo sin riesgo.

## Fase 1 — Lógica pura (sin red, testeable primero)

- [x] **TCUT.1** — `app/src/utils/cut-eligibility.ts` (NUEVO, **colisión-safe**): `canMarkCut` /
  `canUnmarkCut` (RCUT.3) + `isCutCategory({ code?, label? })` (RCUT.6.2). Sin RN/red/SDK. — *cubre
  RCUT.3.1, RCUT.3.2, RCUT.3.3, RCUT.6.2.*
- [x] **TCUT.2** — `app/src/utils/cut-eligibility.test.ts` (NUEVO, **colisión-safe**): node:test del
  predicado (hembra activa ≠ ternera → true; macho → false; ternera → false; ya-CUT → canMark false /
  canUnmark true; `categoryCode` null/'' → conservador false; archivada → false) + detección del badge (por
  `code==='cut'`; fallback `label` 'CUT'/'cut'/'  CUT  ' → true; 'Vaquillona' → false; sin code ni label →
  false). 16 tests verdes. — *cubre RCUT.3, RCUT.6.2.*

## Fase 2 — Capa de datos: exponer `is_cut`

- [x] **TCUT.3** — `app/src/services/powersync/local-reads.ts` (**⚠️ colisión**): en
  `buildAnimalDetailQuery`, proyectar `ap.is_cut AS is_cut` (rama synced) y `0 AS is_cut` (rama overlay),
  junto a `is_castrated`/`future_bull`. Aserto sumado en `local-reads.test.ts` (116 verdes). — *cubre RCUT.4.1.*
- [x] **TCUT.4** — `app/src/services/animals.ts` (**⚠️ colisión**): `LocalDetailRow += is_cut?`;
  `AnimalDetail += isCut: boolean`; `fetchAnimalDetail` mapea `isCut: toBool(row.is_cut ?? 0)`. — *cubre
  RCUT.4.1, RCUT.4.2.*

## Fase 3 — Servicios `setCut` / `unsetCut`

- [x] **TCUT.5** — `app/src/services/animals.ts` (**⚠️ colisión**): `setCut(profileId)` (resolveCutCategory
  + `decideSetCut` inyectando `runLocalWrite(buildSetCutUpdate)`; error es-AR si `cutCategoryId == null`, sin
  escribir) según el contrato del design §3 (as-built: delega en el núcleo puro `cut-service-core.ts`).
  — *cubre RCUT.1.1, RCUT.1.2, RCUT.1.3, RCUT.1.4.*
- [x] **TCUT.6** — `app/src/services/animals.ts` (**⚠️ colisión**): `unsetCut(profileId)`
  (resolveCutCategory.derivedCategoryId + `decideUnsetCut` inyectando `runLocalWrite(buildUnsetCutUpdate)`;
  error es-AR si derivada null, sin escribir). — *cubre RCUT.2.1, RCUT.2.2, RCUT.2.3.*
- [x] **TCUT.7** — Unit del servicio: `app/src/services/cut-service-core.test.ts` (NUEVO, **colisión-safe**)
  contra el núcleo PURO `decideSetCut`/`decideUnsetCut` (= contrato de setCut/unsetCut) con fakes del resolve
  + del write: resuelve+escribe el id esperado (SET el cutCategoryId, UNSET el derivedCategoryId) / falla sin
  escribir cuando el id es null / propaga el error del write o del resolve. 9 tests verdes. — *cubre
  RCUT.1, RCUT.2. (Reconciliación: archivo `cut-service-core.test.ts` en vez de testear `animals.ts` directo
  — los servicios value-importan el SDK y no son importables bajo node:test; `mock.module` exige un flag que
  el runner no pasa. Ver design §3 nota as-built.)*

## Fase 4 — Badge amarillo (token + componente)

- [x] **TCUT.8** — `app/tamagui.config.ts` (**⚠️ colisión**): agregar `cutText: '#855300'` y
  `cutBg: '#FBE6AE'` en `palette` y en el grupo `color` (con comentario atado a la decisión RCUT.6 +
  contraste medido 5.27:1 / 6.49:1, verificado con node). — *cubre RCUT.6.1, RCUT.6.3.*
- [x] **TCUT.9** — `app/src/components/CategoryBadge.tsx` (**colisión-safe**): `+prop code?`; usar
  `isCutCategory({ code, label })` para elegir `$cutBg`/`$cutText` vs `$greenLight`/`$primary` (incl. el punto
  de override); a11y intacta (label sigue comunicando la categoría). — *cubre RCUT.6.1, RCUT.6.4, RCUT.6.5.*
- [x] **TCUT.10** — `app/src/components/AnimalRow.tsx` (**colisión-safe**): pasar `code={categoryCode}` al
  `CategoryBadge`. — *cubre RCUT.6.2 (ruta preferida en la lista).*

## Fase 5 — Afordancia en la ficha + gate de `dientes`

- [x] **TCUT.11** — `app/app/animal/[id].tsx` (**colisión-safe**): `CutRow` (espejo de `CastrationRow`,
  modos mark/unmark: confirmación inline + consecuencia literal + optimismo en sitio [en el padre] + error
  inline + busy). Tokens amber del badge ($cutText/$cutBg) en la afordancia; lineHeight matcheado en los
  Text con descendentes. — *cubre RCUT.5.1, RCUT.5.2, RCUT.5.3, RCUT.5.4.*
- [x] **TCUT.12** — `app/app/animal/[id].tsx` (**colisión-safe**): render de la afordancia CUT en la rama de
  HEMBRAS de "Manejo" (sin tocar la rama de machos), gated por `canMarkCut` + `dientesEnabled` (mark) /
  `canUnmarkCut` (unmark, sin gate); pasar `code={detail.categoryCode}` al `CategoryBadge` del hero; **suprimir
  la `CategoryOverrideCard` genérica cuando `detail.isCut`** (`categoryOverride ?` → `categoryOverride &&
  !isCut ?`, RCUT.5.7). — *cubre RCUT.5.5, RCUT.5.6, RCUT.5.7, RCUT.6.2 (hero).*
- [x] **TCUT.13** — `app/app/animal/[id].tsx` (**colisión-safe**): resolver `dientesEnabled` best-effort vía
  `fetchRodeoGating(detail.rodeoId)` → `g.value['dientes']?.enabled === true`; fail-safe conservador (`false`)
  si no resuelve / falla / no hay fila; estado inicial `false`; SOLO se resuelve para hembras. — *cubre
  RCUT.7.1, RCUT.7.2, RCUT.7.3.*

## Fase 6 — E2E + cierre

- [x] **TCUT.14** — `app/e2e/cut-ficha.spec.ts` (NUEVO, **colisión-safe**) — Playwright: (a) ficha de una
  hembra activa ≠ ternera (rodeo con `dientes`) → "Marcar como CUT" → confirmar → categoría CUT + **badge
  amarillo** (aserción del background-color computado: $cutBg rgb(251,230,174) vs $greenLight
  rgb(147,207,172)); (b) "Quitar CUT" → vuelve a la derivada + badge verde; + override no-CUT muestra "Quitar
  fijación" pero un CUT NO (RCUT.5.7). Web táctil real (`hasTouch:true` + `tap()`, `reference_rn_web_pitfalls`).
  **ESCRITO; lo corre el leader** (engancha con el working-tree sin commitear de la otra terminal + siembra
  Supabase → riesgo de rate-limit con 2 terminales). — *cubre RCUT.5, RCUT.6.1, RCUT.6.3 (visual).*
- [x] **TCUT.15** — `scripts/run-tests.mjs` (**⚠️ colisión**): enganché los DOS unit nuevos
  (`cut-eligibility.test.ts` + `cut-service-core.test.ts`) en la lista de `client unit tests` (la suite NO
  toma por glob — son paths explícitos). El E2E `cut-ficha.spec.ts` corre por Playwright, no por esta lista.
  Inserción quirúrgica tras `castration-copy.test.ts` (no toqué las regiones de spec 03/08). — *infra de tests.*
- [ ] **TCUT.16** — **Veto de diseño del leader** (skill `design-review`): capturar el badge CUT amarillo en
  la ficha (hero) y en la lista (AnimalRow), verificar contraste medido ≥4.5:1 y legibilidad a pleno (🟡
  mixto, pero el CUT debe leerse claro); re-iterar con el implementer si no quedó bien ANTES de mostrarle a
  Raf. — *cubre RCUT.6.3.*
- [ ] **TCUT.17** — Reconciliar specs (si en implementación cambia algún detalle) + `node scripts/check.mjs`
  verde + reviewer + Gate 2 (security code) antes de la puerta de código humana. — *cierre.*

## Notas de ejecución

- **Secuenciación por colisión**: las 4 tareas ⚠️ (`tamagui.config.ts`, `animals.ts`, `local-reads.ts`,
  `run-tests.mjs`) deben esperar el commit de la terminal de spec 03/08 o hacerse en worktree aislado; el
  resto (utils nuevo, tests nuevos, `CategoryBadge`, `AnimalRow`, `animal/[id].tsx`, e2e nuevo) son
  colisión-safe y se pueden adelantar.
- **Sin migraciones / sin RLS**: este delta no toca el backend (CUT y sus builders ya existen) → Gate 1 N/A.
- **Orden mínimo viable**: TCUT.1→2 (puro) · TCUT.3→4 (`is_cut` en el detalle) · TCUT.5→7 (servicios) ·
  TCUT.8→10 (badge) · TCUT.11→13 (ficha) · TCUT.14→17 (e2e + cierre).
