# Review — spec 10 UI fixes Raf (gating por candidatos + optimismo en ficha)

- Reviewer: reviewer (re-run; la corrida previa cayo por error de API antes del veredicto)
- Fecha: 2026-06-12
- Baseline: 1a1dc83 (cambios sin commitear en working tree)
- Reporte del implementer: progress/impl_10-ui-fixes-raf.md
- Alcance: frontend puro. 2 correcciones de UX. Cero backend / migraciones / Edge Functions.

## Veredicto: APPROVED

## 1. FIX 1 — gating por candidatos (no solo config)

Semantica de applyCandidateGating (PURA, group-actions.ts:102-111) — CORRECTA:
- vaccinate = config.vaccinate (sin gating por candidatos)
- wean = config.wean AND counts.wean > 0 (config destete Y >=1 candidato)
- castrate = counts.castrate > 0 (solo candidatos; no se gatea por config, R1.5)
No esconde una accion con candidatos (count>0 equivale a que la pantalla de seleccion mostraria >=1
fila — usa el MISMO buildBulkCandidates). No abre una accion sin candidatos (grupo vacio -> todas las
gateadas por candidatos OFF). No rompe el gating de config (wean=false de config sigue false aunque
haya candidatos; vaccinate respeta solo config). Todos con test dedicado.

fetchRodeoConfigGating preserva R7.2 cross-rodeo — CORRECTO: las masivas pasaron de
fetchRodeoGroupActions(...).wean/.vaccinate (ahora candidate-gated -> pregunta equivocada) a
fetchRodeoConfigGating().weaningEnabled/.vaccinationEnabled (config pura). El predicado responde
"el rodeo TIENE destete/vacunacion habilitado?" independiente de candidatos. Sin el cambio, un rodeo
configurado pero sin candidatos en ese subset habria sido excluido por error. R7.2 intacto.

Fail-soft config / fail-closed loader — CORRECTO: config FAIL-SOFT en group-data.ts (si no se lee
config -> Castrar se gatea igual por candidatos, R1.5); loader fail-closed (rodeo/[id].tsx:62,
lote/[id].tsx:71: si fetchRodeo/LoteGroupActions !ok -> todas OFF, mejor que el baseline castrate:true).
GroupViewScreen.tsx:95 oculta la card si ninguna accion queda ofrecible. Es DISPLAY; authz server-side.

Tests FIX 1: group-actions.test.ts 6 nuevos de applyCandidateGating (29 totales, aislamiento 29/29
verde); E2E operaciones-destete.spec.ts "un rodeo sin terneros NO ofrece Destetar" (8/8 repeat-each=2).

## 2. FIX 2 — optimista en sitio en la ficha (animal/[id].tsx)

Receta docs/conventions.md (UI optimista en el lugar) — CUMPLIDA punto por punto:
- silent NO togglea el loading que desmonta (load:113,131: if (!silent) setLoading). El render usa
  {loading ? "Cargando ficha..." : ...} y loading solo pasa a true en carga inicial / cambio de
  profileId (silent jamas lo toca) -> ScrollView montado, scroll preservado.
- Carga inicial vs refresh: useFocusEffect blanquea solo la 1ra carga (ref didInitialLoadRef),
  re-focus silencioso; lastProfileIdRef resetea el ref al cambiar de animal. Render-phase ref
  idempotente, sin bug.
- Patch funcional setX(prev => ...) en las 5 acciones -> sin stale closure.
- Snapshot ANTES del patch + revert si falla (const snapshot = detail/timeline; en !r.ok ->
  setDetail(snapshot) / setTimeline(snapshot ?? null)). No deja estado mentido.
- busy se resetea SIEMPRE (CastrationRow:1002 / FutureBullRow: setBusy(false) incondicional).
  Feedback de loading visible durante la escritura (RAFAQ D).
- Silent no blanquea ante error transitorio (load:131-160): un fallo de detalle/timeline no setea
  error de pantalla ni blanquea el timeline montado.
- Castrado optimista correcto: previewCastrationCategory (read-only, espejo C6, simetrico value
  true/false) ANTES de escribir -> patch (isCastrated, future_bull limpio al castrar R12.4, categoria
  si transiciona) -> setCastrated -> void load({silent:true}).

Invariantes — OK: optimismo es estado React LOCAL; writes reales sin cambios (setCastrated/
setFutureBull/deleteTypedEvent/assignAnimalToGroup/revertCategoryOverride no aparecen en el diff de
services); author_id server-forzado, soft-delete gated owner|autor intactos; cero write nuevo (la unica
llamada nueva, previewCastrationCategory, es read-only local). No-regresion: carga inicial OK;
baja/egreso navega (no blanquea en sitio) -> no tocado.

Tests FIX 2: E2E operaciones-castracion.spec.ts reforzado: tras el toggle revert -> "Cargando ficha..."
toHaveCount(0) + scroll preservado (readMaxScrollTop > 50 antes y despues) + categoria en sitio.

## 3. Trazabilidad R<n> <-> test (R tocados por el fix)
- R1.5 (castrar no se gatea por config): group-actions.test.ts "castrar SIEMPRE true" + "SIN candidatos
  a castracion -> Castrar OFF (no depende de config)"
- R1.6 + nota candidatos: group-actions.test.ts "SIN candidatos a destete -> Destetar OFF aunque config"
  + "NO rompe el gating de config"; E2E operaciones-destete.spec.ts "rodeo sin terneros NO ofrece Destetar"
- R7.1 (lote cross-rodeo, algun rodeo): group-actions.test.ts "lote cross-rodeo — vacunar/destetar si ALGUN rodeo"
- R7.2 (exclusion por rodeo real): preservado via fetchRodeoConfigGating; bulk-candidates.test.ts + E2E vacunacion
- R13.1 (toggle castrado ficha + confirmacion): E2E castracion ("La categoria se recalcula: Torito")
- R13.5 (recompute simetrico): E2E castracion (vuelve a Torito tras revert)
- R13.7 (observacion automatica): E2E castracion ("Correccion: marcado como no castrado")
- Convencion optimista-en-sitio: E2E castracion (no "Cargando ficha..." + scroll preservado)
Los R que el fix NO cambia (write, RLS, backend) conservan su cobertura as-built de los reviews previos.

## 4. Tasks
N/A formal (fix-loop sobre UI ya commiteada, no abre tasks nuevas). El changelog de tasks.md documenta el
fix (FIX 1 -> T-UI.1; FIX 2 -> T-UI.7/T-UI.8) sin dejar [ ] pendientes nuevos.

## 5. Reconciliacion de specs (codigo -> spec) — OK
- design.md 3.3: optimista-en-sitio as-built (load silent, patch+revert, E2E).
- design.md 3.4: gating-por-candidatos con la formula exacta de applyCandidateGating, fail-soft config,
  fetchRodeoConfigGating, card-hiding.
- requirements.md R1.6: nota de reconciliacion (ortogonal a R1.5, no reescribe EARS).
- tasks.md: entrada de changelog 2026-06-12.
El design describe lo que el codigo hace; no quedo mintiendo. Direccion codigo->spec satisfecha.

## 6. node scripts/check.mjs
- Cliente (la parte que cubre este cambio): VERDE, verificado en aislamiento: tsc --noEmit exit 0;
  738 client unit tests verdes (incl. group-actions/bulk-candidates/animals); group-actions.test.ts +
  bulk-candidates.test.ts 29/29.
- Rojo: SOLO la suite remota Animal suite (spec 02), DOS corridas: (1) fetch failed / ECONNRESET (caida de
  red a la DB beta remota, aborto la suite a mitad); (2) duplicate key animals_tag_unique (leftover-state:
  el abort de la corrida 1 dejo filas huerfanas, la 2 colisiono en el tag-unique seed).
- Caracterizacion: flake ambiental ajeno. El changeset NO toca ningun archivo backend/migracion/supabase
  (0 coincidencias supabase/|migration|.sql). La suite animal es spec 02 backend, intacta. El mandato
  anticipa esta flake (ECONNRESET batch DB beta) y autoriza la caracterizacion. La regla "no apruebo con
  check.mjs en rojo" se aplica al componente que el cambio puede afectar (verde), no a una flake de red de
  una suite no tocada. Verde end-to-end del orquestador requiere limpiar las filas huerfanas del seed
  animal en la DB remota (fuera de scope de este frontend-fix).

## 7. Gate 2 (security code)
progress/security_code_10-ui-fixes-raf.md: PASS, 0 HIGH. Gating display-only; optimismo estado local;
cero writes nuevos; queries parametrizadas; revert sin re-emitir mutaciones.

## 8. CHECKPOINTS
- C1 harness: [x] (check.mjs cliente verde; flake backend ajeno documentada)
- C2 estado coherente: [x]
- C3 arquitectura: [x] (logica pura en utils; I/O en services; componentes sin fetch directo; sin
  hardcode de establishment_id; sin logs/TODOs sueltos)
- C4 verificacion real: [x] (applyCandidateGating + E2E de ambos fixes)
- C5 cierre: [x] (sin artefactos temporales nuevos)
- C6 SDD: [x] (R tocados con >=1 test; specs reconciliadas)
- C7 multi-tenant: N/A operativo (sin tablas/RLS nuevas; queries locales scopeadas por la lista cargada)
- C8 offline-first: [x] (lecturas/patches sobre SQLite local; writes as-built CRUD plano; sin requests
  sincronos a Supabase desde la pantalla)

## 9. Checklist RAFAQ-especifico
- A (multi-tenancy/RLS): N/A — no toca tablas con establishment_id ni RLS (frontend puro; sin migraciones).
- B (offline-first): [x] funciona offline (mirror SQLite, patches locales, writes CRUD plano encolados);
  sync bucket sin cambios; LWW explicito; [x] la pantalla NO hace requests sincronos a Supabase — services
  sobre SQLite local.
- C (BLE): N/A.
- D (UI de campo): [x] estado de loading visible (busy "Guardando..." durante la escritura; carga inicial
  "Cargando ficha..."); [x] una decision por pantalla; targets/fuente sin cambios vs el baseline aprobado.
- E (Edge Functions): N/A — no toca Edge Functions.

## Cambios requeridos
Ninguno.
