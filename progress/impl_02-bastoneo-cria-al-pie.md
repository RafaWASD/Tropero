baseline_commit: 9a1d193

# impl 02 — Bastoneo de la CRÍA AL PIE (Run 2 de la replicación del bastoneo)

Delta Nivel B, **frontend puro**, Gate 1 **N/A** (`git diff supabase/` vacío). Español UI/docs, inglés código, voseo es-AR.

## Contexto
Run 2 de "replicar el bastoneo en toda superficie que asigna caravana electrónica". Runs previos generalizaron
`TagScanSheet` a modo captura + `TagScanCta` compartido y lo cablearon en ficha/alta/parto (Run 1, commit
`9a1d193`). Faltaba **cría al pie** (`LinkCalfPrompt`), la superficie DISTINTA: no es una captura pura sino un
**buscador find-or-create** que acepta EID **o** IDV. Enfoque aprobado por Raf: **"scan-para-llenar"** — el
bastón LLENA el campo de búsqueda con el EID leído y AVANZA el flujo find-or-create existente.

## Qué se construyó (as-built)

### T1 (T23) — `TagScanSheet.hideManualEntry?` (default false)
`app/src/components/TagScanSheet.tsx`. Con `hideManualEntry=true`:
- `onManualAction = hideManualEntry ? onClose : enterManual` → los controles de "¿Sin bastón?" (link
  `ManualFallbackLink` en heroes conectado/conectable **y** CTA del `ManualPromptHero` sin-transporte) hacen
  `onClose` en vez de `setManualMode(true)`.
- `ManualTagEntry` (campo 15 díg anidado) NUNCA se muestra — el render lo blinda con `manualMode && !hideManualEntry`.
- Copy alternativa: link "¿Sin bastón? Cerrá y escribí la caravana"; CTA sin-transporte "Cerrá y escribí la caravana".
- **Default false NO cambia ficha/alta/parto** (verificado: `onManualAction`=`enterManual`, guard=`manualMode`,
  heroes reciben `hideManualEntry={false}` → copy original). Contrato `onSubmit`/path BLE/confirmación pre-commit
  intactos.

### T2 (T24) — Cablear el bastoneo en `LinkCalfPrompt` (scan-para-llenar)
`app/src/components/LinkCalfPrompt.tsx`:
- Fase **ask**: `TagScanCta` "Bastonear la caravana del ternero" (testID `link-calf-scan-open`) ARRIBA del campo
  de texto. El campo (EID o IDV) QUEDA como fallback + camino IDV.
- El CTA (`openScan`) abre el `TagScanSheet` montado como ÚLTIMO hijo del root del prompt (scrim encima) con
  `hideManualEntry` + `title="Bastonear la caravana"` + `confirmLabel="Usar caravana"` +
  `confirmSublabel="Usar esta caravana para buscar el ternero al pie."`.
- `onScanSubmit(eid)`: `setQuery(eid)` + `await runSearch(eid)` + `return {ok:true}` (el sheet se cierra). El EID
  llena el buscador y avanza el MISMO find-or-create.
- **Refactor mínimo**: `onSearch()` (leía `query` del closure) → parametrizado en **`runSearch(rawQuery)`** para
  que el scan lo dispare con el EID recién leído sin esperar el re-render del `setState`. `onSearch = () =>
  runSearch(query)`. Clasificación EID/IDV + todas las ramas (found/create/transfer/ya-tiene-madre/varios) y el
  camino tipeado (incl. IDV) **INTACTOS**. Contratos `registerBirth`/`lookupByTag`/`link_calf_to_mother` sin tocar.
- `scanOpen` state reseteado a false en el effect de `open` (reapertura limpia).

### Ownership (el punto crítico, RCF.6)
El prompt vive SOBRE `crear-animal`, que suspende el listener global con `useBusyWhileMounted`. El `TagScanSheet`
toma el **scoped scanner exclusivo** (acquire al montar / release al desmontar, incl. cierre del prompt) → la
lectura entra al sheet, el `FindOrCreateOverlay` global la ignora por `scopedScannerActive`; al cerrarse, la
escucha se re-suspende. NO se usa el listener global crudo. El TagScanSheet se auto-gestiona (su propio effect de
scoped scanner) → LinkCalfPrompt no toca hooks BLE. Nesting simple (idéntico al patrón de crear-animal que ya
monta LinkCalfPrompt + TagScanSheet + BreedPickerSheet como overlays absolutos full-screen).

### T3 (T25) — Tests
- **e2e** `app/e2e/cria-al-pie-bastoneo.spec.ts` (mock BLE, `import {test,expect} from './helpers/fixtures'`):
  - (a) **CREATE**: prompt → "Bastonear la caravana del ternero" → sheet → bastonazo EID nuevo → confirmación
    "Usar caravana" → **overlay global ausente** (ownership) → confirmar → el query se llena con el EID + fase
    CREATE; "Cambiar caravana" prueba `field.value === eid` (scan-para-llenar) → crear+vincular → oráculo server
    `waitForServerCalfTags(motherId,[eid])` (el EID escaneado viajó a `register_birth` → `animals.tag_electronic`).
  - (b) **FOUND**: ternero sembrado con `tag=EID` → bastonazo → find-or-create lo encuentra (fase found) →
    vincular → `waitForServerBirth` (1 parto, 1 birth_calf).
  - (c) **OWNERSHIP/cleanup**: cerrar el sheet con la X → bastonazo posterior no dispara nada (ni sheet ni
    overlay) → el prompt sigue en ask (listener re-suspendido).
- **capture** `app/e2e/captures/cria-al-pie-bastoneo.capture.ts` (Gate 2.5, 412×915): 01 prompt-ask-con-cta /
  02 sheet-conectar (link "Cerrá y escribí la caravana") / 03 sheet-escaneando / 04 lectura-usar-caravana /
  05 resultado-create-llenado-por-scan / 06 sheet-sin-transporte-cerra-y-escribi (`__RAFAQ_BLE_E2E_MANUAL__`).
- **NO ejecuté** el e2e ni el capture (requieren `e2e:build` que re-renderiza `design/*.png` — lo corre el leader
  en Gate 2.5). Los `.spec.ts`/`.capture.ts` se commitean; los `__shots__/*.png` van gitignored.

## Trazabilidad (R → archivo:test)
Delta sin R nuevos; reconcilia **RCAP.2.1** (buscador del ternero: se agrega el camino scan-para-llenar).

| Requisito / comportamiento | Test |
|---|---|
| RCAP.2.1 scan-para-llenar CREATE (EID nuevo llena el buscador → fase create → EID al ternero creado) | `e2e/cria-al-pie-bastoneo.spec.ts` (a) |
| RCAP.2.1 scan-para-llenar FOUND (EID de ternero existente → find-or-create lo encuentra → vincular) | `e2e/cria-al-pie-bastoneo.spec.ts` (b) |
| Ownership: overlay global ignora la lectura con el sheet abierto | `e2e/cria-al-pie-bastoneo.spec.ts` (a)/(b) (`find-or-create-overlay` count 0) |
| Ownership: release del scoped scanner al cerrar → re-suspensión | `e2e/cria-al-pie-bastoneo.spec.ts` (c) |
| `classifyCalfQuery(15 díg) → eid` (base del scan-para-llenar) | `app/src/utils/link-calf-query.test.ts` (existente, verde) |
| `TagScanSheet.hideManualEntry` + copy "Cerrá y escribí" | capture 02/06 (Gate 2.5, veto visual del leader) |

Sin código PURO nuevo extraíble (el bastoneo reusa `classifyCalfQuery` + `runSearch` existentes) → sin unit nuevo.

## Autorrevisión adversarial
Busqué activamente:
- **(a) Desviación del spec / contratos**: NO toqué `registerBirth`/`lookupByTag`/`link_calf_to_mother` ni
  `classifyCalfQuery`. El camino IDV (tipear) y todas las ramas del motor quedan idénticas. ✔
- **(b) Edge cases**:
  - `query` stale al disparar por scan → resuelto parametrizando `runSearch(rawQuery)` (no lee el closure). ✔
  - EID de 15 díg truncado por `sanitizeIdvInput` (tope 20) → NO trunca (15<20); además `setQuery(eid)` directo. ✔
  - scan → lookup `transfer` / "ya tiene madre" / `>1` → reusa `runSearch` → los avisos aparecen en la fase ask
    tras cerrar el sheet (el EID quedó en el campo). ✔
  - offline lookup falla durante el scan → `fieldError` en ask + campo lleno para reintentar; `onScanSubmit`
    devuelve ok:true (el EID se capturó; el fallo del lookup NO es del sheet). ✔
  - re-entrada / doble scan → TagScanSheet ya maneja live-rescan + `assigningRef`; `onScanSubmit` corre una vez. ✔
  - default `hideManualEntry=false` regresiona ficha/alta/parto → verificado byte-a-byte (mismo `enterManual`,
    mismo guard, misma copy). ✔
- **(c) Seguridad**: frontend puro, sin RPC/RLS nuevo. `establishmentId` desde contexto (prop), nunca hardcodeado.
  `lookupByTag` scopeado al campo. El scoped scanner cierra la superficie de doble-proceso (un solo consumidor). ✔
- **(d) Offline / multi-tenant**: todo el flujo es local (lookup PowerSync SQLite + BLE local); sin red nueva.
  Tenant scopeado. ✔
- **(e) Tests que pasan por la razón equivocada**: el oráculo (a) es **server-side** (`waitForServerCalfTags`
  sigue la cadena birth→birth_calves→animals.tag_electronic → prueba que el EID ESCANEADO llegó al ternero,
  no solo que la UI navegó). La aserción `field.value === eid` prueba el llenado real del buscador. El oráculo de
  ownership es AUSENCIA del testID exclusivo `find-or-create-overlay` (no ausencia de un texto ambiguo). ✔

Nada pendiente de corregir tras la autorrevisión.

## Reconciliación de specs (as-built)
- `design-cria-al-pie-alta.md` → **§11 nuevo** (as-built del bastoneo scan-para-llenar + ownership).
- `design-caravana-ficha.md` → **§10.7 nuevo** (`TagScanSheet.hideManualEntry` + copy alternativa).
- `requirements-cria-al-pie-alta.md` → nota de reconciliación bajo **RCAP.2.1** (camino scan-para-llenar; no
  reescribe el EARS).
- `tasks-cria-al-pie-alta.md` → **Fase H (T23/T24/T25)** `[x]`.

## Verificación
- `pnpm.cmd typecheck` (app) → **VERDE** (tsc --noEmit, 0 errores).
- Client unit (offline) → **VERDE** (84/84 en las suites BLE + link-calf + input + listen-state; incl.
  `classifyCalfQuery: 15 díg → eid`).
- Anti-hardcode (ADR-023 §4) → **0 violaciones**.
- `git diff supabase/` → **vacío** (Gate 1 N/A).
- `design/*.png` → **no tocados** por este delta (los `M design/maniobra-elegir/*.png` son pre-existentes de
  antes de la sesión, ajenos a este delta — no los toqué ni los conté).
- Workstream Android paralelo (`app.json`/`eas.json`/`docs/build-android.md`) → **no tocado**.
- NO commiteado; NO toqué `feature_list.json` ni `progress/current.md`.

## Archivos
- `app/src/components/TagScanSheet.tsx` (M) — `hideManualEntry`.
- `app/src/components/LinkCalfPrompt.tsx` (M) — CTA + `runSearch`/`onScanSubmit` + mount del sheet.
- `app/e2e/cria-al-pie-bastoneo.spec.ts` (NUEVO) — regresión (a/b/c).
- `app/e2e/captures/cria-al-pie-bastoneo.capture.ts` (NUEVO) — Gate 2.5 (6 capturas).
- Specs reconciliadas: `design-cria-al-pie-alta.md §11`, `design-caravana-ficha.md §10.7`,
  `requirements-cria-al-pie-alta.md` RCAP.2.1, `tasks-cria-al-pie-alta.md` Fase H.

## Veredicto
**done** — scan-para-llenar del bastoneo de cría al pie construido, verificado (typecheck + 84 unit + anti-hardcode
0 + supabase vacío), autorrevisado y reconciliado. Nesting/ownership limpios (no requirió PARAR). Pendiente:
reviewer + Gate 2 (security_analyzer modo code, diff desde `9a1d193`) + Gate 2.5 (el leader corre el capture).
