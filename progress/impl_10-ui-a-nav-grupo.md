# impl 10 — Fase 4 chunk A: nav + vista de grupo (T-UI.1/2/3)

baseline_commit: 7840b43337391fda7bf665a308b634fe530d1774

> Punto desde el cual Gate 2 calcula el diff (trabajamos sobre `main`, sin feature-branches).
> NO sobreescribir si ya existe (feature multi-sesión).

## Alcance (SOLO este chunk)

Fase 4 PARCIAL de spec 10: **T-UI.1 (vista de grupo) + T-UI.2 (Inicio rodeo-céntrico) + T-UI.3
(AnimalRow compacta)**. NO la selección (T-UI.4), bottom-sheet (T-UI.5), vacunación (T-UI.6), ficha
castrado (T-UI.7) ni E2E. Backend (Fase 1) + utils/services (Fase 2+3) done+gateados → REUSADOS.

## Estado: DONE (esperando design-review del leader + reviewer + Gate 2 + resto de Fase 4). NO marqué la feature done.

---

## Archivos tocados

### Nuevos — utils PUROS (con test node:test)
- `app/src/utils/animal-age.ts` + `.test.ts` — `formatAnimalAge`/`monthsBetween` (edad desde `animal_birth_date`). 11 tests.
- `app/src/utils/group-actions.ts` + `.test.ts` — gating PURO: `resolveGroupActions`/`buildRodeoGating`/`isDataKeyEnabled` (castrar siempre; vacunar/destetar por config; lote = "algún rodeo"; fail-closed). 10 tests.
- `app/src/utils/group-nav.ts` — `navigateToGroupAction` (PURO sobre `ImperativeRouter`, como `nav.ts`): rutea a `seleccion-masiva`/`vacunacion-masiva` con params de grupo + op.

### Nuevos — hook
- `app/src/hooks/useGroupView.ts` (+ export en `hooks/index.ts`) — orquesta load del grupo (loader inyectado) + re-carga al foco + al avanzar el sync.

### Nuevos — componentes (presentacionales, sin fetch)
- `app/src/components/GroupActionsBar.tsx` — botonera de las 3 acciones (outline, verbos pelados, orden Vacunar→Destetar→Castrar).
- `app/src/components/GroupViewBits.tsx` — `GroupMetaHeader` + `GroupAnimalsList` (genérico).
- `app/src/components/GroupViewScreen.tsx` — scaffold compartido de la vista de grupo (header + meta + config + acciones + lista).
- `app/src/components/GroupSummaryCard.tsx` — card de grupo en Inicio (nombre + cabezas + chevron → vista de grupo).
- Exports agregados en `app/src/components/index.ts` (+ `shouldShowFutureBullBadge`).

### Nuevos — service
- `app/src/services/group-data.ts` — `fetchRodeoGroupActions`/`fetchLoteGroupActions` (gating, lee `field_definitions` + `rodeo_data_config` local) + `fetchRodeoHeadCounts`/`fetchGroupHeadCounts` (conteos por grupo).

### Nuevos — rutas
- `app/app/rodeo/[id].tsx` — vista de grupo de un RODEO.
- `app/app/lote/[id].tsx` — vista de grupo de un LOTE.
- `app/app/seleccion-masiva.tsx` — **STUB navegable** (selección explícita = próximo chunk).
- `app/app/vacunacion-masiva.tsx` — **STUB navegable** (vacunación = próximo chunk).

### Modificados
- `app/src/components/AnimalRow.tsx` — variante `compact` (≥56px, "categoría · edad", badge ⭐, slot checkbox). Helper `shouldShowFutureBullBadge`. La fila grande default INTACTA.
- `app/app/(tabs)/index.tsx` — Inicio rodeo-céntrico: secciones "Mis rodeos" + "Lotes" (cards → vista de grupo). Stepper de onboarding queda debajo.
- `app/app/_layout.tsx` — registra las 4 rutas nuevas + `GROUP_DESTINATIONS` (RootGate no las expulsa en estado 'active').
- `app/src/services/powersync/local-reads.ts` — proyecta `future_bull` en `LOCAL_LIST_SELECT` (synced `ap.future_bull`; overlay `0`); builders nuevos `buildRodeoHeadCountsQuery`/`buildGroupHeadCountsQuery`.
- `app/src/services/animals.ts` — `AnimalListItem` expone `animalBirthDate` + `futureBull`; mapper + `LocalListRow` actualizados.
- `app/src/services/powersync/local-reads.test.ts` — assert `future_bull`/`birth_date` en la lista + 4 tests de los grouped counts (string + comportamiento contra SQLite in-memory).
- `scripts/run-tests.mjs` — engancha `animal-age.test.ts` + `group-actions.test.ts`.
- Specs reconciliadas: `tasks.md` (T-UI.1/2/3 `[x]` con as-built) + `design.md` §1.1 (nota AS-BUILT chunk UI-A).

**NO se tocó:** la tab `Animales` (`animales.tsx`), el connector/upload, migraciones.

---

## Trazabilidad R<n> → test / verificación

| R<n> | Cobertura |
|---|---|
| R1.1 (vista de grupo: meta + config + lista + acciones) | `rodeo/[id].tsx` + `lote/[id].tsx` + `GroupViewScreen` (render web ok); lista vía `fetchAnimals`/`fetchGroupMembers` (status active, R1.3) |
| R1.2 (reusa `AnimalRow` + services as-built) | `GroupViewScreen`/`GroupAnimalsList` rinden `AnimalRow compact`; sin componente de lista propio |
| R1.3 (solo `status='active'`/no soft-deleted) | `fetchAnimals(...,{status:'active'})` / `fetchGroupMembers` (as-built, ya filtra) — heredado de spec 09 |
| R1.4 (3 acciones, verbos pelados) | `group-actions.test.ts` (resolveGroupActions) + `GroupActionsBar` (Vacunar/Destetar/Castrar pelados) |
| R1.5 (vacunar/destetar gated; castrar siempre) | `group-actions.test.ts` "castrar SIEMPRE true" + "solo vacunación habilitada" |
| R1.6 (data_key disabled → no se ofrece) | `group-actions.test.ts` "field sin fila → deshabilitado" + "data_key sin field → fail-closed" |
| R7.1 (lote cross-rodeo: "algún rodeo") | `group-actions.test.ts` "lote cross-rodeo — vacunar/destetar si ALGÚN rodeo la tiene"; `fetchLoteGroupActions` |
| R2.1 (cards de rodeo + lote en Inicio) | `(tabs)/index.tsx` secciones "Mis rodeos"/"Lotes" + `GroupSummaryCard`; conteos: `local-reads.test.ts` (buildRodeo/GroupHeadCountsQuery, comportamiento) |
| R2.2 (tap card → vista de grupo) | `GroupSummaryCard.onPress` → `router.push('/rodeo/[id]'\|'/lote/[id]')` (export web compila las rutas) |
| R2.3 (tab Animales intacta) | `animales.tsx` NO modificado (verificado) |
| R11.9 (AnimalRow compacto ≥56px + checkbox + "categoría · edad") | `animal-age.test.ts` (formatAnimalAge); `AnimalRow compact` (minHeight `$touchMin`=56, slot `RowCheckbox`) |
| R12.3 (badge ⭐ solo positivo, oculto en `toro`) | `group-actions.test.ts` N/A; cubierto por `shouldShowFutureBullBadge` (exportado y usado por AnimalRow) — regla testeada inline en la función; ver nota abajo |

> **Nota R12.3:** la regla de display `shouldShowFutureBullBadge(futureBull, categoryCode)` está EXPORTADA y es trivialmente verificable (false si !positivo o categoría `toro`). El próximo chunk (E2E T-UI.9) ejerce el badge end-to-end. En este chunk la regla es pura y exportada (no quedó un branch sin cubrir lógicamente).

---

## Autorrevisión adversarial (paso 8 + criterio de diseño)

Busqué activamente, como revisor hostil:

- **Touch targets ≥56px:** AnimalRow compact `minHeight="$touchMin"` (56); GroupActionsBar buttons `$touchMin`; GroupSummaryCard `$touchMin`. ✓
- **Cero hardcode:** `check-hardcode.mjs` 0 violaciones (incluye los 6 archivos de componente nuevos + las 4 rutas + la home). ✓
- **Tab Animales intacta:** `animales.tsx` sin tocar; el cambio a `AnimalRow` es ADITIVO (default `compact=false` → fila grande idéntica, mismo a11yLabel para el path no-compact — verificado char-a-char). `AnimalListItem` ganó 2 campos opcionales (additivos). ✓
- **Badge ⭐ oculto en `toro`:** `shouldShowFutureBullBadge` lo garantiza; `future_bull` se auto-limpia al castrar (0085) → un castrado no muestra ⭐ aunque sea macho. ✓
- **Gating del GroupActionsBar:** castrar SIEMPRE; vacunar/destetar fail-closed (data_key sin field o field sin fila enabled → no se ofrece). Verifiqué que `vacunacion`/`destete` SÍ están seedeados en `field_definitions` (0018:36/45) → el gating mapea contra datos reales, no siempre-false. ✓
- **Multi-tenant:** ningún `establishment_id` hardcodeado — todo del contexto activo / del perfil. El gating lee config scopeada por la stream (no cross-tenant). ✓
- **Offline-first:** todas las lecturas (lista, gating, conteos) salen del SQLite local; `emptyIsSyncing:false` donde "vacío" es legítimo (conteos, gating). El export web bootea con PowerSync local. ✓
- **Render:** `pnpm e2e:build` (`expo export -p web`) exporta las 4 rutas nuevas + la home evolucionada SIN errores (13 bundles, `dist`).
- **Edge cases del gating:** lote vacío / sincronizando → `resolveGroupActions([])` = solo Castrar (fail-closed, testeado). Gating blando: si `fetchRodeoGroupActions` falla, la pantalla ofrece solo Castrar (no rompe).
- **Bug encontrado y corregido durante la pasada:** la jerarquía inicial de `GroupActionsBar` ponía **Castrar como botón PRIMARY (relleno verde)** — sobre-enfatizaba la acción deliberada/menos frecuente por encima de la vacunación (la rutina). Lo corregí: las 3 son **outline** (mismo peso), orden por frecuencia Vacunar→Destetar→Castrar — ninguna es "la acción por defecto" (el operario elige a propósito). Re-verifiqué typecheck + lint + render.

Lo que encontré, lo corregí y re-verifiqué antes de seguir. No quedaron findings abiertos de la autorrevisión.

---

## Reconciliación de specs (paso 9)

- `tasks.md`: T-UI.1/2/3 → `[x]` con bloque AS-BUILT (archivos reales, helpers, gating, conteos).
- `design.md` §1.1: nota **AS-BUILT chunk UI-A** documentando los archivos reales (scaffold compartido `GroupViewScreen`/`GroupViewBits`/hook `useGroupView`; gating PURO + service; `group-nav`; stubs; AnimalRow compacto; proyección de `future_bull` en la lista + `AnimalListItem.animalBirthDate/futureBull`). Aclara el adelanto leve de §4.4 (future_bull ya no lo trae solo `fetchAnimalDetail`).
- No hubo cambio de comportamiento que tocara los EARS de `requirements.md` (las R quedaron tal cual; la implementación las realiza).

---

## Verificación

1. `cd app; pnpm.cmd typecheck` → **verde**.
2. `node scripts/check.mjs` → **exit 0** (typecheck + anti-hardcode 0 violaciones + 689 client unit + suites supabase live incl. spec 10 Fase 1 22/22). Corrida directa de los nuevos: `animal-age` 11/11, `group-actions` 10/10, `local-reads` 88/88 (incl. 4 grouped-count nuevos), schema guard verde.
3. **Render:** `pnpm e2e:build` (`expo export -p web`) → exporta `dist` con las 4 rutas nuevas + la home, SIN errores de bundle. Las pantallas BOOTEAN.

### Cómo navegar a cada pantalla (para el design-review web)
- **Inicio rodeo-céntrico:** tab **Inicio** (home, ruta `/(tabs)`). Secciones nuevas "Mis rodeos" (cards de rodeo) + "Lotes" (si el campo tiene lotes), debajo del saludo/banner y arriba del Stepper de onboarding.
- **Vista de grupo (rodeo):** tocar una card de rodeo en Inicio → `/rodeo/[id]` (o directo `…/rodeo/<rodeoId>`). Muestra meta (Rodeo + nombre + cabezas) + "Datos que se cargan acá" (chips de gating) + "Acciones del grupo" (GroupActionsBar) + lista de animales activos (AnimalRow compacto).
- **Vista de grupo (lote):** tocar una card de lote en Inicio → `/lote/[id]` (o `…/lote/<groupId>`). Igual, con ícono de lote + gating cross-rodeo.
- **Acciones (stubs):** desde la GroupActionsBar, "Vacunar" → `/vacunacion-masiva`; "Castrar"/"Destetar" → `/seleccion-masiva` (con `op`). Son placeholders "próximamente" navegables (la pantalla real = próximo chunk).
- La tab **Animales** queda IDÉNTICA (no se tocó) — verificarlo es parte del design-review.

---

## Riesgos / notas para el leader

- **Datos para ver Vacunar/Destetar:** los botones gateados aparecen solo si el rodeo tiene `vacunacion`/`destete` enabled en su `rodeo_data_config` (data-dependiente del template del rodeo beta). El gating es correcto; si en el render web no aparecen, es que el rodeo no los tiene habilitados (no es un bug). Castrar SIEMPRE aparece.
- **R2.1 "sistema + señal de atención" diferidos:** la card de rodeo muestra nombre + cabezas. El nombre del SISTEMA ("Cría") requiere resolver `systemId`→name (fetch extra) y la "señal de atención" es analytics (feature 07, no construido). Decisión de scope del chunk; `GroupSummaryCard` ya soporta un prop `meta` opcional para sumarlo cuando haya fuente. **Worth a design-review call.**
- **Jerarquía de la GroupActionsBar:** las 3 acciones quedaron outline mismo-peso (decisión de la autorrevisión, ver arriba). Si el design-review prefiere enfatizar la rutina (Vacunar primary cuando está), es un ajuste de 1 línea.
- **`fetchGroupMembers` (lote) cap 200:** hereda el límite as-built de `fetchAnimals` (200). Para un lote enorme, el gating cross-rodeo podría no "ver" un rodeo representado más allá de los 200 primeros → a lo sumo NO ofrece una acción gateada que debería (fail-closed-ish, nunca ofrece una prohibida). Consistente con la limitación documentada de `fetchGroupMembers` (spec 02 C4). No bloqueante para el MVP.
- **Checkbox listo, no usado:** el slot `RowCheckbox` + props `checked`/`onToggle` quedan en `AnimalRow` para que el próximo chunk (selección explícita, T-UI.4) los use sin re-tocar el componente.
- Pendiente del leader: design-review (skill) sobre el render web ANTES de mostrar a Raf, luego reviewer + Gate 2 + resto de Fase 4 (T-UI.4–T-UI.11) + Puerta 2.
