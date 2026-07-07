# Review — delta bastoneo-cria-al-pie (scan-para-llenar, RCF.6 Run 2)

**Reviewer** · baseline 9a1d193 (sin commitear) · spec 02, Nivel B, **frontend puro**, Gate 1 **N/A**.
Deliverable: progress/impl_02-bastoneo-cria-al-pie.md.

## Veredicto: APPROVED

---

## 1. hideManualEntry ADITIVO (default false) — SIN regresion

Verificado byte-a-byte contra el diff:

- onManualAction = hideManualEntry ? onClose : enterManual -> con **false** => enterManual (identico al call
  previo que pasaba enterManual directo). TagScanSheet.tsx:151.
- Guard del render: manualMode && !hideManualEntry -> con false => manualMode (identico al previo).
  TagScanSheet.tsx:231.
- Heroes reciben hideManualEntry={false} (:244/:246/:248) -> copy ORIGINAL: ManualFallbackLink = "Sin baston?
  Carga la caravana a mano" (:417), ManualPromptHero cta = "Cargar la caravana a mano" (:382); title/subtitle sin
  cambio; la a11y label del disco quedo en el const subtitle = misma string literal.
- El nuevo prop es required en los sub-componentes, pero los 3 call-sites lo pasan -> sin fuga.
- Con **true** (solo desde LinkCalfPrompt): "Sin baston?"/CTA sin-transporte hacen onClose (no setManualMode),
  ManualTagEntry **nunca** se muestra (guard defensivo && !hideManualEntry), copy "Cerra y escribi la caravana".
  El path BLE (heroes scan/connect + confirmacion pre-commit + onSubmit) sin tocar.

Conclusion: default false NO cambia ficha/alta/parto. Contrato onSubmit/path BLE/confirmacion intactos.

## 2. LinkCalfPrompt scan-para-llenar — refactor onSearch->runSearch(rawQuery) SIN stale

- runSearch(rawQuery) usa el PARAMETRO en todo el cuerpo (classifyCalfQuery(rawQuery), LinkCalfPrompt.tsx:222);
  no lee el estado query del closure -> deps reducidas a [establishmentId, motherProfileId] (:323), correcto.
- onScanSubmit(eid) (:340-347): setQuery(eid) + await runSearch(eid) + return {ok:true}. Dispara el find-or-create
  con el **EID crudo recien leido**, no con el setQuery async -> **no hay stale**. setQuery solo alimenta el campo
  para "Cambiar caravana" (conserva lo escaneado).
- Path TIPEADO intacto: onSearch = () => void runSearch(query) (:326-328); ejercita EID **y** IDV. Ramas
  found/create/transfer/ya-tiene-madre/varios sin cambios. classifyCalfQuery sin tocar.
- CTA link-calf-scan-open (:499-503) ARRIBA del campo; el campo queda como fallback + unico camino IDV. openScan
  guarda busyRef (:331-334).

## 3. Ownership (nested sheet) — sin listener colgado ni doble-consumo

- TagScanSheet montado como ULTIMO hijo del root del prompt (:662-671), scrim encima. Adquiere el scoped scanner
  en un efecto (TagScanSheet.tsx:104-108): acquire al montar / release en cleanup.
- Provider: acquireScopedScanner es un **contador** con release idempotente (BleStickListenerProvider.tsx:138-146);
  tolera re-montajes/StrictMode. scopedScannerActive = scopedCount > 0.
- FindOrCreateOverlay ignora la lectura mientras el scoped scanner esta activo (FindOrCreateOverlay.tsx:152
  early-return + auto-cierre :207-209). Ambos callbacks (sheet + overlay) suscritos, pero el overlay retorna
  temprano -> **un solo consumidor efectivo**, sin doble proceso del EID.
- Al cerrar (scanOpen=false, o open=false que retorna null y desmonta todo) el sheet se desmonta -> release ->
  scopedCount a 0 -> listening = enabled && !busy = false (crear-animal mantiene busyMode) -> escucha
  re-suspendida. scanOpen reseteado a false en el effect de open (LinkCalfPrompt.tsx:172) -> reapertura limpia.
- E2E cubre: overlay global ausente con el sheet abierto (a/b) + re-suspension al cerrar sin confirmar (c).

## 4. Contratos intactos

git diff 9a1d193 no toca services/events (registerBirth/linkCalfToMother), services/animals
(lookupByTag/searchAnimals), link-calf-query (classifyCalfQuery) ni supabase/. Solo 2 componentes + tests +
specs. Sin RPC/RLS nuevo.

## 5. Verificacion

- tsc --noEmit (app): VERDE (exit 0).
- e2e/capture del delta typecheck: VERDE (0 errores en cria-al-pie-bastoneo.spec.ts/.capture.ts; los 3 residuales
  son de helpers/admin.ts pre-existente + ws, ajenos al delta y fuera del pipeline normal).
- Unit del area tocada: **58/58** (link-calf-query [incl. classifyCalfQuery 15dig->eid], animal-input, eid-format,
  maniobra-listen-state, listener-gate, contract, wiring).
- Anti-hardcode (ADR-023 sec4): 0 violaciones (exit 0).
- git diff supabase/: vacio (Gate 1 N/A).
- design/*.png del delta: ninguno (los M design/maniobra-elegir/*.png son ajenos; __shots__ gitignored, no trackeados).
- Debug logs / TODO en los 2 archivos: ninguno.
- e2e:build: NO corrido (lo corre el leader en Gate 2.5).

## Trazabilidad (R <-> test)

Delta sin R nuevos — reconcilia **RCAP.2.1** (agrega el camino scan-para-llenar; no reescribe el EARS).

- RCAP.2.1 scan-para-llenar CREATE -> e2e/cria-al-pie-bastoneo.spec.ts (a) — oraculo server waitForServerCalfTags.
- RCAP.2.1 scan-para-llenar FOUND -> e2e/cria-al-pie-bastoneo.spec.ts (b) — waitForServerBirth.
- Ownership overlay global ignora lectura -> e2e (a)/(b) (find-or-create-overlay count 0).
- Ownership release al cerrar -> e2e (c).
- classifyCalfQuery(15 dig) -> eid (base del scan-para-llenar) -> app/src/utils/link-calf-query.test.ts (VERDE).
- TagScanSheet.hideManualEntry + copy "Cerra y escribi" -> capture 02/06 (Gate 2.5, veto visual del leader).

## Exactitud de specs (codigo -> spec)

Reconciliacion correcta, sin specs viejas:
- design-cria-al-pie-alta.md sec11: as-built (scan-para-llenar + runSearch(rawQuery) + ownership).
- design-caravana-ficha.md sec10.7: hideManualEntry + copy alternativa.
- requirements-cria-al-pie-alta.md RCAP.2.1: nota de reconciliacion (no reescribe el EARS).
- tasks-cria-al-pie-alta.md Fase H (T23/T24/T25) todas [x].

## Tasks completas: SI

T23/T24/T25 en [x]. Ninguna [ ] sin justificar.

## CHECKPOINTS

- C3 (arquitectura): [x] — solo components/; sin deps nuevas; sin logs/TODO; establishment_id desde prop.
- C4 (verificacion): [x] — unit del area verde (58/58); e2e como red de regresion (a/b/c).
- C6 (SDD): [x] — 3 docs presentes; tasks [x]; RCAP.2.1 reconciliado con cobertura e2e + unit.
- C7 (multi-tenant): [x] N/A activo — frontend puro, sin tablas/policies; scopeo por prop.
- C8 (offline-first): [x] — find-or-create local (PowerSync SQLite) + encolado outbox; sin red nueva.
- C9 (E2E + visual): [x] suite .spec.ts (typecheck OK) + [x] capture .capture.ts (6 estados) + [ ] Gate 2.5 del
  leader (pendiente, no es del reviewer) + [x] __shots__ NO commiteados.

## Checklist RAFAQ-especifico

- A. Multi-tenancy / RLS — N/A (frontend puro, sin tablas/policies; sin establishment_id hardcodeado).
- B. Offline-first
  - [x] Funciona offline (lookup local PowerSync + BLE local + encolado outbox; RCAP.1.5).
  - [x] Scopeo por establishmentId activo (prop del contexto).
  - [x] Resolucion de conflictos: reusa registerBirth/linkCalfToMother existentes (sin estrategia nueva).
  - [x] Sin requests sincronos a Supabase desde la pantalla (usa services -> SQLite local).
- C. BLE
  - [x] Desconexion: heroes adaptativos (connected/connectable/manual) + release del scoped scanner al cerrar.
  - [x] Fallback manual en <=1 tap ("Cerra y escribi la caravana" -> cierra al campo externo, siempre presente).
  - [x] Correlacion TAG<->peso: N/A (este flujo no maneja peso).
  - [x] Logs BLE no bloquean (logTransportEvent best-effort en el provider).
- D. UI de campo
  - [x] Targets >= $touchMin (CTA/opciones sexo/back/skip) — token establecido, sin cambio de token.
  - [x] Fuente >= tokens $5/$7 en texto operativo.
  - [x] Una decision por pantalla (fases ask/found/create; sheet con una accion).
  - [x] Loading visible (Buscando/Vinculando/Creando/Guardando).
- E. Edge Functions — N/A (sin Edge Functions).

## Cambios requeridos

Ninguno.
