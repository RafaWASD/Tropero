# Review — M4.2 — R10.8: surfacing de rechazos de sync (spec 03 MODO MANIOBRAS)

**Reviewer**: reviewer (Opus). **Fecha**: 2026-06-17. **Baseline**: 279a10fdc1295c93ba8bb51e44747375ac8acee6.
**Scope**: frontend + un toque al connector de PowerSync (sin schema). Gate 1 N/A (no toca DB).

## Veredicto: APPROVED

R10.8 implementado, testeado y reconciliado en specs. El path de upload (lo mas critico) NO se toco
salvo una llamada best-effort blindada. La privacidad (no-leak de opData) se respeta y se asierta. El
check rojo es el flake conocido animals_tag_unique (spec 02 backend, terminales paralelas), NO una
regresion de este chunk.

---

## 1. El upload path es SAGRADO — OK
git diff de connector.ts contra baseline = QUIRURGICO. Solo: import de recordUploadRejection; docstring
extendida; un SEGUNDO try/catch dentro de surfaceUploadRejection que llama recordUploadRejection(op,
error), separado del console.warn (si uno tira, el otro corre). CERO cambio a uploadData,
applyIntentTransaction, isTransientUploadError, classifyIntentUploadError, al orden FIFO, a
transaction.complete()/rollbackOverlay/clearOverlay, ni a la clasificacion transient/permanent/
idempotent. Doble blindaje (try/catch en connector + try/catch interno en recordUploadRejection,
verificado con test de getters venenosos).

## 2. Privacidad / no-leak — OK
UploadRejection = { id, table, op, code, at }. NUNCA opData. El test siembra weight_kg:380 + secret en
opData y asierta que el JSON del registro NO contiene opData, ni 380, ni secret.

## 3. Correctitud del store — OK
Cap 50 descarta los mas viejos; dedup por id (el mas reciente gana); acknowledge(ids)/()/clear;
useSyncExternalStore con snapshot estable (referencia nueva SOLO al mutar, re-render correcto,
Object.freeze); op sin id no registra. Todos con tests directos.

## 4. Helper de motivo es-AR — OK
rejectionReason: 23514 / 42501 / otro, prefijado con el TIPO de maniobra por tabla (R5.4). Gramatica N=1
vs N>1 en rejectionBannerTitle (1 maniobra no se sincronizo / N maniobras no se sincronizaron) corregida
y testeada con bordes. rejectionWhenLabel recien/hace N min/hace N h/dd-mm, tolerante a futuro/NaN.

## 5. UI — OK
Banner SOLO con tablas de maniobra (filter isManeuverRejection); e2e (c) prueba el REJECT del filtro con
animal_profiles. "Entendido" marca SOLO los ids mostrados (no clear global) -> un rechazo nuevo con el
sheet abierto no se traga. Guard tap-through doble-rAF idiom lockeado. $terracota (aviso, no rojo),
anti-hardcode 0 violaciones, lineHeight matching en titulos y Text con numberOfLines, targets full-width.
Iconos lucide size=24 exentos del linter (API no-Tamagui) y coinciden con el patron pre-existente.

## 6. Tests — OK (con la salvedad del flake conocido)
node scripts/check.mjs RC=1 PERO: client unit 1347/0 (incluye upload-rejections.test.ts, 17 casos);
RLS 22/22; Edge 42/42; Maneuvers suite (spec 03) AISLADA 14/14. Unico rojo: Animal suite (spec 02) 2/109
fail = flake animals_tag_unique (23505, animal/run.cjs:1924) por terminales paralelas (memoria
reference_check_red_rate_limit) — backend de spec 02, NO toca este chunk. e2e maniobra-rechazo-sync 3/3.
Regresion e2e (reanudar + wizard + config-sheet-race) 8/8. Hook SOLO-E2E gated fuera de prod (consume-y-
desarma, mismo patron que maneuver-e2e-fault); en dev/prod null -> no-op, no contamina prod.

## 7. Reconciliacion de specs — OK
requirements.md R10.8: nota as-built (store best-effort no-throw, sin opData, banner terracota, sheet,
Entendido, re-resolver = re-hacer MANUAL); EARS estable no se reescribe. design.md seccion 5: bloque
AS-BUILT que reconcilia la premisa vieja ("el canal ya existe") con la realidad (era solo console.warn),
coincide con el codigo. tasks.md: M4.2 (R10.8) [x] DONE; M4.3 (offline verificacion) [ ] PENDIENTE
JUSTIFICADO (chunk separado, no task abandonada de M4.2).

---

## Trazabilidad R<n> <-> test (completa)
- R10.8 <-> unit upload-rejections.test.ts (17 casos: rejectionReason 23514/42501/otro;
  maneuverRejectionTypeLabel 5 tablas + no-maniobra; rejectionBannerTitle 1/N + bordes; rejectionWhenLabel;
  isManeuverRejection 5 true / resto false; record SIN opData; code no-string->undefined; op sin id->no
  registra; NUNCA tira; DEDUP; cap 50; acknowledge/clear; snapshot estable) + e2e maniobra-rechazo-sync
  (a banner->sheet motivo es-AR->Entendido limpia; b sin banner; c filtro no-maniobra). Canal REAL:
  connector surfaceUploadRejection->recordUploadRejection (diff verificado) + upload-classify.test.ts
  pre-existente (23514/42501 -> PERMANENTE -> llegan a surfaceUploadRejection).

## Tasks completas: si
M4.2 [x] DONE; ninguna task de M4.2 en [ ]. M4.3 [ ] es chunk separado con justificacion documentada.

## CHECKPOINTS
- C1 [x] check corre todas las suites; unico rojo = flake spec 02.
- C2 [x] una feature in_progress (03); no se marca done.
- C3 [x] store en services/powersync/, sheet/hook en app/maniobra/_components/, pantalla en app/app/;
  componente sin fetch directo; sin logs debug nuevos; store tenant-agnostico (sin establishment_id).
- C4 [x] 17 unit + 3 e2e del flujo real; e2e (c) ejercita el REJECT del filtro; no-throw ejercita el catch.
- C6 [x] R10.8 cubierto; specs reconciliadas al as-built.
- C7 N/A — no toca tablas con establishment_id (frontend + connector, sin schema).
- C8 [x] el chunk ES el surfacing offline-first del rechazo (no dead-letter silencioso); conflict
  resolution del store = dedup id + LWW, documentado en design seccion 5.

## Checklist RAFAQ-especifico
- A (RLS / multi-tenancy): N/A — sin schema, sin tablas nuevas.
- B (offline-first): parcial — [x] banner = feedback de un rechazo de carga offline; [x] sin requests
  sincronos a Supabase (store in-memory + servicios locales); [x] conflict resolution documentada
  (dedup id + LWW). Buckets de sync son de M4.3, N/A aca.
- C (BLE): N/A.
- D (UI de campo): [x] targets full-width (banner + Entendido); [x] fuente legible (heading $6/$7);
  [x] una decision por pantalla (sheet con un solo CTA); [x] aviso visible arriba de todo;
  [x] descenders con lineHeight; [x] $terracota (aviso, no rojo).
- E (Edge Functions): N/A.

## Cambios requeridos
Ninguno.

## Nota de seguimiento (no bloqueante)
Las capturas web tactil 360/412 (tests/modo-maniobra/sync-rechazo-*.png) que el impl menciona no estan en
esa ruta en este arbol (el capture helper app/e2e/captures/sync-rechazo-banner.capture.ts SI existe). No
bloquea — los e2e funcionales (3/3) son la verificacion real y pasaron. Si Raf las quiere para el registro
de Gate 2, correr el capture spec.
