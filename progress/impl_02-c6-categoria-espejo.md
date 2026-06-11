# impl 02 — C6: espejo client-side de categoría (offline) + visibilidad del override

baseline_commit: b23c4cda616af4fbcf8ebb12c0eede354879f4b0

> Implementer. Feature `in_progress`, Puerta 1 APROBADA por Raf (2026-06-11). Gate 1 N/A (frontend puro).
> Spec: `specs/active/02-modelo-animal/{requirements,design,tasks}-c6-categoria-espejo.md` (RC6.1–RC6.5).

## Plan (fases de tasks-c6-categoria-espejo.md)

- F1 — Módulo puro + fixtures espejo (T1.1–T1.5): RC6.1, RC6.2, RC6.3.3/4, RC6.5.1.
- F2 — Lecturas locales + inyección en service (T2.1–T2.4): RC6.3.1–RC6.3.6.
- F3 — Badge override + quitar fijación (T3.1–T3.4): RC6.4.1–RC6.4.5.
- F4 — E2E + cierre (T4.1–T4.5): RC6.3.1, RC6.4.x, RC6.5.2 + re-verificación de los 3 e2e rojos.

## Estado

(en curso — sesión 2: cierre del chunk dejado a mitad por session limit)

## Assessment del trabajo heredado (sesión 2, 2026-06-11)

> El implementer anterior murió por session limit tras ~170 tool-uses SIN cierre. Marcó TODOS los
> checkboxes de tasks-c6 `[x]` pero NO corrió la verificación final (typecheck/unit/e2e/check), NO hizo
> la autorrevisión (paso 8) ni cerró la bitácora. Mi 1ra tarea: assesslar el diff real contra la spec,
> NO re-implementar. Conclusión del assessment: **F1–F4 están implementadas y completas en el working
> tree** — lo que falta es la VERIFICACIÓN, la autorrevisión adversarial y el cierre.

Mapeo task → estado real (git diff contra baseline `b23c4cd`):

| Task | Archivo(s) | Estado real |
|---|---|---|
| T1.1–T1.5 | `animal-category.ts` | ✅ COMPLETO. `computeCategoryCode` espeja 0062 verbatim (ramas macho/hembra, cortes 1/2 años, conteo de partos por evento, has_weaning/has_service, tacto+ vigente por tupla `(event_date, created_at)`, precedencia load-bearing). `computeInitialCategoryCode`/`categoryOverrideFor` DELEGAN (sin 3ra copia). `inferIsCastrated`/`deriveDisplayCategory`/`computeDisplayOverrides` puros. Header con banner ANTI-DRIFT (RC6.5.1) + limitación de la inferencia (RC6.2.2). |
| T1.4 | `animal-category.test.ts` | ✅ COMPLETO. +482 líneas: matriz RT2.x (T2.21–T2.30), precedencia load-bearing (RC6.1.2), tie-break `createdAt null` incl. caso realista doble-null (RC6.1.4), inferencia (RC6.2.1), `deriveDisplayCategory`/`computeDisplayOverrides` (RC6.3.x). |
| T2.1–T2.2 | `local-reads.ts` | ✅ COMPLETO. `buildCategoryMirrorEventsQuery` (synced+overlay, filtro tipos, ORDER BY). Proyecciones `category_override`/`birth_date`/`system_id` en AMBAS ramas de lista y detalle. |
| T2.3 | `animals.ts` | ✅ COMPLETO. `computeMirrorOverrides` (I/O) + delega a `computeDisplayOverrides` (puro), cableado en `fetchAnimals`/`searchAnimals` (refactor a filas crudas dedup)/`fetchAnimalDetail`. |
| T2.4 | `local-reads.test.ts` | ✅ COMPLETO. Test "display-only": builders del path de display son SELECT puros (cero INSERT/UPDATE/DELETE); núcleo `computeDisplayOverrides` puro por construcción. |
| T3.1–T3.4 | `[id].tsx` + `local-reads.ts` + `animals.ts` | ✅ COMPLETO. `CategoryOverrideCard` ($surface+$primary, ícono Pin, copy es-AR), gating activo+rol, confirmación inline, reload post-revert. `buildRevertCategoryOverrideUpdate` (1 statement, deleted_at IS NULL). `revertCategoryOverride` (deriva con isCastrated=false documentado, resuelve id, irresoluble→error es-AR sin write). |
| T4.1–T4.5 | `events.spec.ts` + `helpers/admin.ts` + `design-tier2` + `backlog.md` | ✅ COMPLETO (código). 2 tests C6 nuevos (espejo tacto→preñada; override+quitar fijación). `seedAnimal` extendido (categoryCode/categoryOverride/birthDate). Nota anti-drift en design-tier2 §3.1 (RC6.5.2). Backlog: bug `deriveCurrentState` (out of scope) anotado. **PENDIENTE DE MÍ: correr la verificación que el anterior nunca ejecutó.** |

Lo que QUEDA por hacer (sesión 2): (1) verificación completa typecheck+unit+e2e+check.mjs; (2) autorrevisión
adversarial paso 8 del TODO; (3) reconciliación specs↔as-built si la verificación destapa algo; (4) cierre.

## Bitácora

- 2026-06-11 (sesión 1) — Arranque. Baseline check verde (exit 0). Leídos: 0062 (fuente del espejo),
  run.cjs T2.21–T2.30 (matriz server), animal-category.ts + test (espejo parcial existente),
  local-reads.ts (builders), animals.ts (service), [id].tsx (ficha), CategoryBadge.tsx, events.spec.ts.
  → Implementó F1–F4 completo pero murió por session limit ANTES de verificar/autorrevisar/cerrar.
- 2026-06-11 (sesión 2) — Reanudo. Assessment del diff (arriba): F1–F4 completas en el working tree.
  Procedo a verificar.
- 2026-06-11 (sesión 2) — VERIFICACIÓN COMPLETA corrida (lo que el anterior nunca ejecutó):
  - `pnpm typecheck` → limpio (sin errores).
  - Unit: `animal-category.test.ts` + `local-reads.test.ts` → **139/139 pass, 0 fail** (los fixtures
    espejo RC6.1.6 de la matriz T2.21–T2.30, precedencia load-bearing RC6.1.2, tie-break null RC6.1.4
    incl. doble-null offline, inferencia RC6.2.1, núcleo puro RC6.3.x).
  - `node scripts/check.mjs` → **exit 0**: typecheck + TODAS las suites unit + anti-hardcode **0
    violaciones** (ADR-023) + backend (RLS/Animal/Maneuvers/user_private/Import/Sync-streams) verdes.
  - `pnpm e2e:build` → `Exported: dist` OK.
  - E2E `animals-offline.spec.ts` → **8/8 pass** (sin regresión: overlay, parto mono/mellizos, baja,
    rollback madre soft-deleted, etc.).
  - E2E `events.spec.ts` → **11/13 pass**. Los 2 C6 nuevos (744 espejo tacto→preñada, 788 override+quitar
    fijación) VERDES. Los 2 de transición que C6 debía cerrar (190 tacto→transición, 279 parto
    mellizos→transición) VERDES. Los 2 rojos restantes son PRE-EXISTENTES y OUT OF SCOPE (detalle abajo).

## Estado de los 3 e2e dependientes del gap (re-verificación, T4.2)

El brief mencionaba "3 e2e rojos que este chunk debería poner verdes". La realidad as-built (verificada):
- **190 `reproductivo: tacto → transición de categoría`** → **VERDE** con C6 (el badge "vaquillona preñada"
  se deriva localmente del tacto, ya no depende del sync-down server-side flaky).
- **279 `parto mellizos → transición + link madre`** → **VERDE** con C6 (el badge transiciona a "vaca…"
  derivado localmente; el conteo de partos del espejo lo computa del overlay).
- **509 `aborto → nodo Aborto + estado "Vacía"`** → **ROJO, OUT OF SCOPE.** Falla en la línea 564
  (`getByText(/^Vacía · /)`), la fila **"Estado reproductivo"**, NO el badge de categoría. Es el bug de
  `deriveCurrentState` (`event-timeline.ts`): tacto+aborto el mismo `event_date`, ambos `created_at` null
  offline → desempate por UUID v4 RANDOM (~50/50) → muestra "Preñada" en vez de "Vacía". MÓDULO VECINO,
  no el espejo de CATEGORÍA. C6 NO toca `event-timeline.ts` (git status lo confirma) ⇒ no es regresión.
  Documentado en `docs/backlog.md` (entrada 2026-06-11) con el fix sugerido (espejo del fix de índice
  RC6.1.4 en `isNewerRepro`). El BADGE de categoría de este test SÍ deriva bien con C6.
- **639 `orden del timeline (bug 0069)`** → **ROJO, OUT OF SCOPE.** Falla en la línea 685 (coordenada Y
  del nodo "Servicio" vs "Alta" del mismo día): es el bug de ORDENAMIENTO del timeline (0069/parseTimeline),
  no el badge ni el espejo. C6 no toca el timeline render ⇒ no es regresión.

> Prueba de no-regresión: el diff C6 toca SOLO `animal-category.ts(+test)`, `local-reads.ts(+test)`,
> `animals.ts`, `[id].tsx`, `events.spec.ts`, `e2e/helpers/admin.ts`, `design-tier2`, `backlog.md`. NO toca
> `event-timeline.ts` ni el render del timeline ⇒ 509 y 639 no pueden ser causados por C6. Ambos están en el
> set de **8 e2e rojos PRE-EXISTENTES en HEAD** que el reviewer confirmó sobre worktree limpio (backlog
> 2026-06-10, `review_15-powersync.md` §"Run T7.9"). C6 cerró los 2 que eran SU gap (190, 279).

## Paso 8 — Autorrevisión adversarial (del TODO: heredado + verificado)

Pasada hostil sobre las 4 probes del brief + ejes propios. NO encontré defectos a corregir (la
implementación heredada resiste la revisión adversarial); registro qué busqué y por qué pasa:

1. **¿Los fixtures fallarían si la precedencia difiriera de 0062?** SÍ. Hay tests `RC6.1.2 precedencia`
   load-bearing que aislan el ORDEN de las ramas: `1 birth GANA a tacto+` (→vaca_segundo_servicio, no
   preñada), `2 births GANAN a tacto+` (→multipara), `tacto+ GANA a destete/servicio/edad` (→preñada, no
   vaquillona), `corte 2 años GANA al destete` (→toro/novillo, no torito/novillito). Si 0062 reordenara los
   `if/elsif`, estos flippean. Es la defensa anti-drift más fuerte (no solo cada rama, su precedencia).
   Comparé `computeCategoryCode` línea a línea contra `0062` (ramas, cortes 730/365, conteo de partos por
   EVENTO no por ternero, `pregnancy_status ∉ {null,'empty'}`, tupla `(event_date, created_at)`): espejo fiel.
2. **¿El display NUNCA escribe?** SÍ es display-only, y por construcción ESTRUCTURAL (no solo testeada):
   `computeDisplayOverrides` es puro (sin I/O). `computeMirrorOverrides` usa SOLO `runLocalQuery` (SELECT) —
   grep confirma que el ÚNICO `runLocalWrite` de animals.ts (línea 927) está en `revertCategoryOverride`, la
   acción explícita "Quitar fijación" (RC6.4.3), FUERA del path de display. Test dedicado asserta que los
   builders del path de display son SELECT puros (cero INSERT/UPDATE/DELETE). RC6.3.5 cubierto a fondo.
3. **¿El revert offline con derivada irresoluble aborta con error es-AR SIN write?** SÍ. `revertCategoryOverride`
   corta ANTES del write en dos puntos: (a) sin `system_id` → error es-AR ("No pudimos determinar la categoría
   automática…"); (b) `buildCategoryIdByCodeQuery` no resuelve el code derivado → error es-AR ("No pudimos
   calcular la categoría automática… Quitá la fijación cuando se sincronice el campo"). El `runLocalWrite` solo
   corre tras resolver `catRes.value.id` ⇒ nunca escribe un `category_id` inválido (que 0021 rechazaría 23514).
   RC6.4.5 cubierto.
4. **¿La inferencia `is_castrated` está documentada en el header?** SÍ. Banner ANTI-DRIFT del módulo
   (`animal-category.ts`, líneas 20–28): explica que `is_castrated` NO está en el SQLite local (animals fuera
   del sync set), la regla `inferIsCastrated` (novillito/novillo→true), por qué espeja al server HOY (ningún
   write-path setea is_castrated=true), el único caso divergente (display-only, converge al sync) y el finding
   backend para el leader (denormalizar is_castrated, design §7). RC6.2.2 cubierto.

Ejes propios adicionales:
5. **`searchAnimals` refactor (el cambio más invasivo).** Antes mapeaba a `AnimalListItem` por sub-query;
   ahora acumula filas crudas dedup (`pushLocalRows` con `seen`) y mapea+espeja UNA vez al final. Verifiqué:
   el dedup por profileId y el ORDEN de prioridad (tag exacto → idv exacto → substring → visual) se preservan
   (es el mismo `seen`/orden de inserción); solo cambió el TIMING del mapeo. Shape público sin cambios.
6. **¿Las sub-queries de búsqueda proyectan las columnas C6?** SÍ — todas (`buildSearchByTagQuery/ByIdvQuery/
   LikeQuery`) pasan por `buildSearchUnion` → `LOCAL_LIST_SELECT(_OVERLAY)`, que ya proyectan
   `category_override`/`birth_date`/`system_id`. El espejo aplica uniforme en lista Y búsqueda (no quedó una
   superficie sin inputs que silenciosamente cayera a la guardada).
7. **Multi-tenant / offline-first.** Cero `establishment_id` hardcodeado (lint anti-hardcode 0 violaciones; el
   scoping de tenant lo aplican las sync streams al sincronizar, no se re-filtra — patrón swap spec 15,
   verificado por la suite sync_streams verde). Display 100% de SQLite local + revert CRUD plano offline-safe
   (RC6.3.6/RC6.4.4) — sin red no cambia el comportamiento, probado por los e2e C6 (el tacto offline deriva la
   preñada sin sync-down) y animals-offline 8/8.
8. **Tests que pasen por la razón equivocada.** Revisé los e2e C6: anclan por el `aria-label` del CategoryBadge
   (estable, el span con `numberOfLines` puede evaluar "hidden" en Playwright) y asertan tanto la PRESENCIA de
   la derivada como la AUSENCIA del indicador override cuando corresponde (`toHaveCount(0)`). El test de override
   verifica el reject del estado previo (badge "Multípara, fijada manualmente") ANTES del revert y la derivada
   ("Vaquillona") DESPUÉS — ejerce el path real, no un atajo.

Conclusión paso 8: sin defectos. No hubo fixes ⇒ no hay re-verificación pendiente (el check ya está verde).

## Reconciliación de specs (paso 9)

Sin reconciliación nueva: el as-built NO difiere de lo que ya dicen las specs. El implementer anterior YA
había reconciliado las notas as-built (design §2/§4/§5/§6 con los nombres reales `computeMirrorOverrides`/
`computeDisplayOverrides`/`CategoryOverrideCard`/desempate por índice; requirements RC6.1.4 nota de
reconciliación del desempate doble-null; design-tier2 §3.1 nota anti-drift). Verifiqué que esas notas
describen el código tal cual quedó. `tasks-c6` con F1–F4 en `[x]`. Nada que actualizar.

## Mapeo de trazabilidad RC6.x → test → ubicación

| RC6.x | Cubierto por | Ubicación |
|---|---|---|
| RC6.1.1/.2/.3 (espejo 0062) | fixtures T2.21–T2.30 + precedencia load-bearing | `animal-category.test.ts` ("FIXTURES ESPEJO" + "RC6.1.2 precedencia") |
| RC6.1.4 (tie-break createdAt null) | 4 tests tie-break (created_at presente/null, doble-null offline ambas direcciones) | `animal-category.test.ts` ("RC6.1.4: …") |
| RC6.1.5 (delegación sin 3ra copia) | tests B existentes de `computeInitialCategoryCode`/`categoryOverrideFor` verdes sin tocarse | `animal-category.test.ts` (suite previa) |
| RC6.1.6 (fixtures espejo matriz) | T2.21–T2.26/T2.29/T2.30 1:1 con run.cjs | `animal-category.test.ts` |
| RC6.2.1 (inferencia is_castrated) | `inferIsCastrated` true solo novillito/novillo | `animal-category.test.ts` ("RC6.2.1") |
| RC6.2.2 (limitación documentada) | banner ANTI-DRIFT del header | `animal-category.ts` líneas 20–28 |
| RC6.3.1 (ficha derivada local) | unit `computeDisplayOverrides` + e2e espejo | `animal-category.test.ts` ("RC6.3.1") + `events.spec.ts:744` |
| RC6.3.2 (lista/búsqueda derivada) | unit batch + cableado fetchAnimals/searchAnimals | `animal-category.test.ts` ("RC6.3.2") + `animals.ts` |
| RC6.3.3 (override=true → guardada) | unit deriveDisplayCategory + computeDisplayOverrides override | `animal-category.test.ts` ("RC6.3.3") |
| RC6.3.4 (irresoluble → fail-safe) | unit code sin fila/catálogo vacío/sin system_id | `animal-category.test.ts` ("RC6.3.4") |
| RC6.3.5 (display NO escribe) | test SELECT-puro de builders + pureza estructural | `local-reads.test.ts` ("RC6.3.5 display-only") |
| RC6.3.6 (sin red, SQLite local) | builder eventos + e2e tacto offline | `local-reads.test.ts` (buildCategoryMirrorEventsQuery) + `events.spec.ts:744` |
| RC6.4.1 (indicador fijada manual) | e2e override (texto + a11y sufijo) | `events.spec.ts:788` + `[id].tsx` CategoryOverrideCard |
| RC6.4.2 (acción gating activo+rol) | e2e quita fijación (animal activo) + gating canRevertOverride | `events.spec.ts:788` + `[id].tsx` |
| RC6.4.3 (UPDATE único override+id) | builder revert + e2e revert→derivada | `local-reads.test.ts` (buildRevertCategoryOverrideUpdate) + `events.spec.ts:788` |
| RC6.4.4 (revert offline) | UPDATE local CRUD plano (mismo path assignAnimalToGroup) + e2e | `animals.ts revertCategoryOverride` + `events.spec.ts:788` |
| RC6.4.5 (irresoluble → no write + error es-AR) | guardas pre-write en revertCategoryOverride | `animals.ts` (2 returns es-AR antes del write) |
| RC6.5.1 (nota anti-drift header TS) | banner del módulo | `animal-category.ts` líneas 4–18 |
| RC6.5.2 (nota anti-drift design) | nota aditiva §3.1 | `design-tier2-categorias.md` |

## Heredado vs agregado (esta sesión)

- **HEREDADO (sesión 1, completo):** todo el código de F1–F4 (animal-category.ts+test, local-reads.ts+test,
  animals.ts, [id].tsx, events.spec.ts, helpers/admin.ts), las notas as-built en specs, el ítem de backlog.
- **AGREGADO (sesión 2, este run):** la VERIFICACIÓN completa (typecheck + 139 unit + check.mjs exit 0 +
  e2e build + animals-offline 8/8 + events 11/13 con triage de los 2 rojos), el assessment del diff, el paso 8
  (autorrevisión adversarial), el mapeo de trazabilidad, y este cierre de bitácora. Cero líneas de código
  cambiadas en esta sesión (la implementación heredada pasó la verificación sin fixes).

## Cierre

F1–F4 COMPLETAS y VERIFICADAS. `check.mjs` exit 0. E2E: animals-offline 8/8, events 11/13 (los 2 C6 +
los 2 de transición VERDES; los 2 rojos restantes pre-existentes y out-of-scope, documentados en backlog).
Sin desviaciones del spec, sin reconciliación pendiente, sin defectos en la autorrevisión. NO marco `done`
(espera al reviewer + Gate 2). Listo para revisión.

**Diferidos (out of scope, ya en backlog):** (1) `deriveCurrentState` desempate UUID random offline
(`event-timeline.ts`, el e2e 509); (2) orden del timeline bug 0069 (el e2e 639). Ambos en el set de 8 e2e
rojos pre-existentes; no son del gap del badge que C6 cerró.

**Bloqueantes:** ninguno.

## Fix-loop (2026-06-11) — veto de diseño del leader sobre C6 (RC6.4.6)

> PUNTUAL. El reviewer ya APROBÓ y el Gate 2 ya PASÓ sobre el working tree; este fix-loop NO toca nada de
> eso fuera del finding único.

**Finding (Nielsen #1 visibilidad + #5 prevención de error):** la confirmación inline de "Quitar fijación"
(`CategoryOverrideCard`) no comunicaba la CONSECUENCIA — a qué categoría AUTOMÁTICA volvería el animal. La
derivada ya se computaba para el revert; faltaba mostrarla ANTES de confirmar.

**Cambios (archivo:línea aproximada):**
- `app/src/services/powersync/local-reads.ts` (~349) — nuevo builder `buildCategoryByCodeQuery(systemId, code)`:
  hermano de `buildCategoryIdByCodeQuery` que ADEMÁS proyecta `name` (`SELECT id, name … active = 1 LIMIT 1`).
  `buildCategoryIdByCodeQuery` se deja INTACTO (lo usan alta/eventos + su test).
- `app/src/services/powersync/local-reads.test.ts` (~836) — unit del builder nuevo (SQL + args + active=1).
- `app/src/services/animals.ts` (~840-960) — **refactor sin cambio de comportamiento del revert:** extraje
  `resolveRevertCategory(profileId)` (resolución compartida: detalle+eventos → `computeCategoryCode` →
  resuelve `id`+`name` del catálogo; errores es-AR RC6.4.5 igual que antes). `revertCategoryOverride` ahora
  delega en ella (mismo UPDATE, misma firma `{ derivedCode }`). NUEVA función `previewRevertCategory(profileId)`
  (solo lectura, reusa `resolveRevertCategory`) → `{ derivedCode, derivedName } | null`. Por construir sobre la
  MISMA resolución, lo anticipado == lo que el revert escribe (no divergen). Irresoluble → `value: null`.
- `app/app/animal/[id].tsx` — `CategoryOverrideCard` recibe `onPreviewRevert`; al expandir la confirmación
  (`startConfirm`) dispara el preview (blando, `void …then(setDerivedName)`); renderiza la línea
  **"La categoría pasará a {name}."** ($3/$textMuted, tipografía secundaria — no compite con los botones;
  a11y replica el copy) SOLO si `derivedName` resolvió. La pantalla expone `onPreviewRevert` (llama a
  `previewRevertCategory(detail.profileId)`, devuelve el name o null).
- `app/e2e/events.spec.ts` (test C6 override, ~824) — assert nuevo: tras "Quitar fijación", la confirmación
  muestra `La categoría pasará a Vaquillona.` (multípara-sin-partos → derivada "Vaquillona") ANTES de confirmar.

**Autorrevisión adversarial (del fix):**
1. ¿El name anticipado == el que el revert escribe? SÍ, ESTRUCTURAL: ambos pasan por `resolveRevertCategory`
   y `buildCategoryByCodeQuery` devuelve `id` y `name` de la MISMA fila del catálogo. No pueden divergir.
2. ¿Derivada irresoluble (RC6.3.4/RC6.4.5) → sin basura? SÍ: `previewRevertCategory` → `value:null`; la card
   sólo renderiza `if (derivedName)`. Cero "La categoría pasará a ." / "null". El error del revert manda si el
   usuario confirma igual (RC6.4.5 intacto).
3. ¿El preview escribe algo? NO: `resolveRevertCategory` usa solo `runLocalQuerySingle`/`runLocalQuery`
   (SELECT). El único `runLocalWrite` sigue en `revertCategoryOverride`. RC6.3.5 preservado.
4. Offline: el preview lee solo SQLite local (mismos builders que el revert) → funciona sin red (RC6.4.4).
5. Race: si el usuario cancela antes de que resuelva el preview, `setDerivedName` corre con `confirming=false`
   → la línea no se renderiza (vive dentro de la rama `confirming`). Re-abrir resetea `derivedName=null` y
   re-dispara. Mismo profileId ⇒ mismo name ⇒ sin valor incorrecto.

**Reconciliación de specs:** `requirements-c6` nuevo **RC6.4.6** (anticipar consecuencia, solo lectura, fail-safe
a omisión, offline). `design-c6` §5 (UI + Write) actualizado al as-built (`previewRevertCategory`/`resolveRevertCategory`/
`buildCategoryByCodeQuery`, copy, tipografía secundaria, a11y). `tasks-c6` sin nuevas tasks (fix-loop sobre F3/F4
ya `[x]`).

**Verificación del fix:**
- `pnpm typecheck` → limpio.
- Unit afectados (`local-reads.test.ts` + `animal-category.test.ts`) → **140/140 pass** (139 previos + el builder nuevo).
- `pnpm e2e:build` → `Exported: dist` OK.
- E2E C6 (`events.spec.ts -g "C6"`) → **2/2 VERDES** (espejo tacto→preñada; override+quitar fijación CON el assert
  de la consecuencia "La categoría pasará a Vaquillona.").
- `node scripts/check.mjs` → **exit 0** (typecheck + todas las suites unit + anti-hardcode 0 violaciones + backend verde).

NO marco `done` (espera al reviewer + Gate 2 del fix).
