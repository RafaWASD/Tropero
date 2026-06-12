# impl 10 — UI fixes reportados por Raf (frontend puro)

baseline_commit: 1a1dc83003b8febec297e4ce6e0424ba40f6e86c

> DOS correcciones de UX sobre el frontend de spec 10 (ya committeado, HEAD = baseline). Frontend puro.
> NO toca connector / migraciones / pantallas de masivas (salvo el gating de las acciones del grupo).
> NO marca nada done (queda design-review + reviewer + Gate 2).

## Plan
- **FIX 1** — Las acciones del grupo (`GroupActionsBar`) se ofrecen solo si hay CANDIDATOS, no solo por config:
  - Destetar: config destete habilitado **Y** ≥1 candidato a destete.
  - Castrar: ≥1 candidato a castración (no se gatea por config — sigue R1.5).
  - Vacunar: sin cambio (config de vacunación; todos los activos son candidatos).
- **FIX 2** — La ficha (`animal/[id].tsx`) NO se pone en blanco ni salta al tope al accionar (optimista en sitio):
  - Toggle Castrado / ⭐ Futuro torito / borrar evento → actualización optimista local + refresh silencioso
    (sin togglear el `loading` que desmonta el contenido y resetea el scroll). Revert si la acción falla.

## Estado
- [x] Baseline check.mjs verde (Entorno listo; el 1er intento flakeó por statement timeout spec-12 → re-corrida OK).
- [x] FIX 1 (gating por candidatos en las acciones del grupo)
- [x] FIX 2 (optimista en sitio en la ficha)
- [x] tests lógica pura (applyCandidateGating, 16/16 verde; dentro de check.mjs 984 client unit OK)
- [x] E2E — `operaciones-{castracion,destete,vacunacion}.spec.ts --repeat-each=2` → **8/8 verde** (incl. el FIX 1
  nuevo "rodeo sin terneros NO ofrece Destetar" + el FIX 2 reforzado en castración: no reaparece
  "Cargando ficha…" tras el toggle + scroll preservado). Nota Windows: tras "8 passed" aparece un
  `UV_HANDLE_CLOSING` / exit 3221226505 (crash de teardown de libuv en Win, POST-resultados — NO es fallo de test).
- [x] typecheck verde (`pnpm typecheck` exit 0, ambos fixes).
- [x] check.mjs: typecheck + 984 client unit (incl. applyCandidateGating) + RLS/Edge/Animal/Maneuvers/
  user_private/sync_streams/operaciones_rodeo VERDES. **1ra corrida cayó en la suite IMPORT (spec 12)
  por `fetch failed / ECONNRESET` en el batch de 5000 filas — la flake de DB beta que el mandato anticipa
  (no toca mis cambios: frontend puro, sin import/backend).** Re-corrida una vez (ver abajo).
- [x] autorrevisión adversarial (ver sección)
- [x] reconciliación de specs (requirements R1.6 nota + design §3.3/§3.4 + tasks changelog)

## Autorrevisión adversarial (qué busqué / qué encontré / cómo lo cerré)
- **Scope masivas (FIX 1)**: al cambiar `fetchRodeoGroupActions` para gatear por candidatos, los predicados
  cross-rodeo de `seleccion-masiva`/`vacunacion-masiva` que leían `.wean`/`.vaccinate` quedaban con la
  semántica equivocada (config vs candidatos). → Cerrado con `fetchRodeoConfigGating` (config-only); E2E
  vacunación (incluye re-ejecución/idempotencia cross-rodeo) verde.
- **Card vacía (FIX 1)**: un grupo con todas las acciones OFF mostraba una card "Acciones del grupo" vacía.
  → `GroupViewScreen` la oculta si ninguna acción está disponible.
- **Fallback de los loaders (FIX 1)**: el fallback viejo era `castrate: true` → con el nuevo gating dejaría
  Castrar visible aún sin candidatos. → Config FAIL-SOFT en el service (Castrar se gatea por candidatos
  igual) + fallback del loader fail-closed (todas OFF si la query de flags falla — no abre acción a ciegas).
- **Overlay/animal nuevo (FIX 1)**: un animal optimista (sin fila synced en `animal_profiles`) no trae flag →
  default `false` (no castrado / sin destete) — semántica CORRECTA para un alta fresca (sí candidato).
- **busy trabado (FIX 2)**: `CastrationRow`/`FutureBullRow` dejaban `busy=true` contando con el reload-blank
  que desmontaba la fila; con el optimismo la instancia persiste → quedaban en "Guardando…". → reset de
  busy SIEMPRE tras la acción.
- **Silent reload que blanquea por error transitorio (FIX 2)**: en `silent` un fallo de detalle/timeline NO
  setea el error de pantalla ni blanquea el timeline (conserva lo montado).
- **Stale closure (FIX 2)**: los patches optimistas usan la forma funcional `setX((prev)=>…)` (no la var del
  closure) → sin bug de estado viejo. El snapshot de revert se toma ANTES del patch.
- **Re-fetch pisa el optimismo (FIX 2)**: `setCastrated` AWAITea el UPDATE local antes de devolver → el
  refresh silencioso lee el mirror ya actualizado → confirma el optimismo (sin flicker).
- **Revert/lote no reportados**: blanqueaban igual → mismo principio (silent reload) por consistencia; baja
  navega (no blanquea en sitio) → no se tocó.

## FIX 1 — archivos tocados
- `app/src/utils/group-actions.ts`: `castrate` pasa de literal `true` a `boolean`; nuevo tipo
  `GroupCandidateCounts` + función PURA `applyCandidateGating(config, counts)` (vaccinate=config;
  wean=config.wean && counts.wean>0; castrate=counts.castrate>0).
- `app/src/utils/group-actions.test.ts`: +6 tests de `applyCandidateGating`.
- `app/src/services/group-data.ts`: `fetchRodeoGroupActions(rodeoId, animals)` y
  `fetchLoteGroupActions(animals)` ahora reciben la lista del grupo, traen los flags de candidatura
  (`buildGroupCandidateFlagsQuery` REUSADO) → `GroupProfile[]` → cuentan candidatos con
  `buildBulkCandidates` (Fase 2 REUSADO) → `applyCandidateGating`. CONFIG fail-soft (si no se lee
  config, degrada a config-off pero sigue gateando Castrar por candidatos). Nueva
  `fetchRodeoConfigGating(rodeoId)` (config-only, SIN candidatos) para los predicados cross-rodeo de
  las pantallas de masivas (no deben usar el `.wean` candidate-gated → pregunta equivocada).
- `app/app/rodeo/[id].tsx` + `app/app/lote/[id].tsx`: pasan los animales cargados a las funciones de
  acciones; fallback fail-closed (todas OFF) si la query de flags falla.
- `app/app/seleccion-masiva.tsx` + `app/app/vacunacion-masiva.tsx`: el predicado de exclusión cross-rodeo
  usa `fetchRodeoConfigGating` (config-only) en vez de `fetchRodeoGroupActions` (que ahora gatea por
  candidatos). Mismo comportamiento R7.2, semántica correcta.
- `app/src/components/GroupViewScreen.tsx`: la card "Acciones del grupo" se oculta si NINGUNA acción
  está disponible (un grupo sin candidatos ni config no muestra una card vacía).

## FIX 2 — archivos tocados + cómo resolví el optimismo
- `app/app/animal/[id].tsx`:
  - `load(opts: { silent?: boolean })`: separa CARGA INICIAL (toggle `loading` → desmonta el contenido,
    resetea scroll) de REFRESH SILENCIOSO (`silent: true` → NO toca `loading`; el ScrollView queda
    montado, el scroll se mantiene, solo cambian los datos). En silent, un fallo transitorio del detalle/
    timeline NO blanquea (conserva lo montado).
  - `useFocusEffect`: la 1ra carga (mount / cambio de profileId) puede blanquear; los re-focus
    posteriores (volver de agregar-evento) son SILENCIOSOS (ref `didInitialLoadRef`, reset por profileId).
  - Optimismo EN SITIO + revert en cada acción que antes blanqueaba:
    - **Castrado**: anticipa la categoría destino con `previewCastrationCategory` (espejo C6) ANTES de
      escribir → patch optimista de `detail` (isCastrated=value, futureBull se limpia al castrar R12.4,
      categoryCode/Name = destino si transiciona) → `setCastrated` → refresh SILENCIOSO (trae la
      observación automática al timeline). Revert al snapshot si el write falla.
    - **⭐ Futuro torito**: patch optimista de `detail.futureBull` (sin observación) → `setFutureBull` →
      refresh silencioso. Revert si falla.
    - **Borrar evento**: quita el ítem del array `timeline` optimistamente (por kind+eventId) →
      `deleteTypedEvent` → refresh silencioso (reconcilia el recálculo de categoría del destete borrado).
      Restaura el ítem si el server rechaza.
    - **Revertir override** y **asignar lote**: refresh SILENCIOSO (mismo principio en-sitio; lote además
      con patch optimista del nombre). No blanquean ni saltan al tope.
  - `CastrationRow`/`FutureBullRow`: resetean `busy` SIEMPRE tras la acción (antes lo dejaban true contando
    con que el reload-blank desmontara la fila; con el optimismo la instancia persiste → si no se reseteaba
    quedaba trabada en "Guardando…").
- Decisión del leader documentada: revertir-override y asignar-lote NO los reportó Raf pero blanqueaban
  igual → les apliqué el mismo principio (silent reload) por consistencia; no toqué baja/egreso (navega,
  no blanquea en sitio).
