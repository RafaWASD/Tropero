baseline_commit: c402a38

# impl — delta `bastoneo-captura-alta-parto` (spec 02, RCF.6 generalizado a modo CAPTURA)

**Qué**: replicar el bastoneo de la caravana electrónica (el `TagScanSheet` de la ficha) en el **ALTA**
(`crear-animal`) y el **PARTO** (`agregar-evento`, por ternero), reusando el mismo sheet en un **modo captura**
(el animal no existe todavía → el EID se setea al estado del form, sin RPC). **Delta Nivel B, frontend puro,
Gate 1 N/A** (0 migraciones; `git diff supabase/` vacío).

## Veredicto: 🟢 VERDE
- `pnpm typecheck` VERDE (app; `e2e` está excluido del tsconfig de la app → se validó aparte, ver Notas).
- Unit VERDE: 109/109 en las suites relevantes (`animal-input`, `eid-format`, `a11y`, `identifier-assign`,
  `event-input`, `animal-form`, `listener-gate`, `adapter-mock`, `contract`, `maniobra-listen-state`).
- Anti-hardcode (ADR-023 §4): **0 violaciones**.
- `node scripts/check.mjs --fast` VERDE (estructura + feature_list + higiene + anti-hardcode).
- `git diff supabase/` vacío; `design/*.png` intactos.

## Archivos (MÍOS)
Modificados:
- `app/src/components/TagScanSheet.tsx` — generalización del contrato (`onAssignTag`→`onSubmit` + copy props).
- `app/src/components/index.ts` — export de `TagScanCta` + `CapturedTagRow`.
- `app/app/animal/[id].tsx` — caller a `onSubmit`; import de `TagScanCta` (borrada la def local + import muerto `StickIcon`).
- `app/app/crear-animal.tsx` — alta: CTA + `CapturedTagRow` + `TagScanSheet` al root (modo captura); borrado el campo tipeable suelto.
- `app/app/agregar-evento.tsx` — parto: CTA + `CapturedTagRow` por ternero + `TagScanSheet` al root (un sheet a la vez).
- `app/e2e/animals.spec.ts` — FIX2 ajustado (el campo suelto ya no existe; límite 15 díg se ejercita en la carga manual del sheet).
- `app/e2e/helpers/admin.ts` — oráculo server `waitForServerCalfTags` (caravanas de terneros vía `birth_calves`).

Nuevos:
- `app/src/components/TagScanCta.tsx` — **NUEVO** compartido: `TagScanCta` (extraído de la ficha) + `CapturedTagRow`.
- `app/e2e/alta-bastoneo.spec.ts` — regresión (mock BLE): captura en alta + mis-scan corregible + cleanup del listener.
- `app/e2e/parto-bastoneo.spec.ts` — regresión (mock BLE): captura por ternero (1 ternero + mellizos).
- `app/e2e/captures/alta-bastoneo.capture.ts` + `app/e2e/captures/parto-bastoneo.capture.ts` — Gate 2.5 (ADR-029).

**NO míos (parallel terminal, workstream Android — NO tocar):** `app/app.json`, `app/eas.json`, `docs/build-android.md`.

## Cómo generalicé el `TagScanSheet` (PASO 1)
- Prop `onAssignTag` → **`onSubmit`**: `(eid) => Promise<{ok; error?}>`. Neutral entre ASIGNAR (ficha: RPC
  `assignTagToAnimal`) y CAPTURAR (alta/parto: setea el estado del form y devuelve `{ok:true}` sincrónico). El
  sheet no distingue el modo; reacciona a `ok`/`error` (fail-closed idéntico). Caller de la ficha → `onSubmit={onAssignTag}`.
- Copy props opcionales con defaults = la copy actual de la ficha (para no cambiarla): `title` ("Bastonear la
  caravana"), `confirmLabel` ("Asignar caravana", aplicado a `ReadConfirmation` **y** `ManualTagEntry`),
  `confirmSublabel` ("Asignar esta caravana a este animal."). Alta/parto pasan `confirmLabel="Usar caravana"` +
  sublabel "…para el animal." / "…para este ternero.". El label de ocupado pasó de "Asignando…" → "Guardando…"
  (neutral; transitorio, casi invisible en captura porque `onSubmit` resuelve sincrónico).
- Todo lo demás IGUAL: scoped scanner acquire/release, heroes scan/connect/manual, `manualModeRef`, validación 15 díg.

## PASO 2 — `TagScanCta` compartido
Movido a `app/src/components/TagScanCta.tsx` sin cambiar el look (StickIcon + label `$primary` sobre
`$greenLight`, ≥`$touchMin`), con `label?` (default "Bastonear la caravana") y `testID?` (default
`tag-scan-open`). En el mismo archivo agregué `CapturedTagRow` (estado read-only tras capturar en un form: EID
legible + link "Cambiar" que limpia el tag). La ficha ahora IMPORTA `TagScanCta` (ya no lo define local).

## PASO 3 — Alta (`crear-animal.tsx`, Step4Data)
Rama `prefillKind !== 'tag'`: `tag ? <CapturedTagRow onClear={setTag('')}/> : <TagScanCta "…(opcional)"
onPress=abrir/>`. Estado `tagScanOpen` en el parent → `<TagScanSheet>` al root (modo captura,
`onSubmit=(eid)=>{setTag(eid); ok:true}`). El montaje mapea 1:1 al acquire/release del scoped scanner. La rama
`prefillKind==='tag'` (bastoneado desde afuera) queda read-only. El `tag` sigue fluyendo a `createAnimal` sin
cambios; sigue opcional; NO se tocó la validación de identidad mínima. Un mis-scan se corrige con "Cambiar"
ANTES de confirmar (en el form el tag NO es inmutable, a diferencia de la ficha).

## PASO 4 — Parto (`agregar-evento.tsx`, CalfBlock) — POR TERNERO
Cada `CalfBlock`: `calf.tagRaw ? <CapturedTagRow testID=tag-captured-<i>/> : <TagScanCta testID=tag-scan-open-<i>/>`.
**Per-ternero resuelto con `scanCalfLocalId: string | null`** (elegí el **localId** en vez de un índice: es
inmune a reordenamientos y mapea 1:1 al `updateCalf(localId, …)` existente; con el sheet abierto la lista no se
puede mutar igual, pero el localId es estrictamente más robusto). El CTA de cada card llama
`onOpenCalfScan(calf.localId)`; UN solo `<TagScanSheet>` al root (condicional a `scanCalfLocalId != null`) con
`onSubmit=(eid)=>{ updateCalf(scanCalfLocalId,{tagRaw:eid}); ok:true }` → escribe en ESE ternero. El scoped
scanner se adquiere/suelta una vez por apertura. El `tagRaw` fluye a `registerBirth` sin cambios (validado por
`validateCalves`, que solo trimea el tag — sin rechazo de forma).

## Ownership (regla transversal) — verificado
El alta y el parto suspenden el listener global con `useBusyWhileMounted` (busyMode). El `TagScanSheet` adquiere
el **scoped scanner** exclusivo en su efecto de montaje → `resolveListening = scopedScannerActive || (enabled &&
!busy)` fuerza la escucha SOLO para el sheet; el `FindOrCreateOverlay` global ignora esas lecturas
(`scopedScannerActive`). Al cerrar/desmontar el sheet, el `release` decrementa el contador → `listening` vuelve a
`enabled && !busy` = false (busy sigue) → el listener se **re-suspende** solo (sin estado colgado). Es EXACTAMENTE
el patrón de la ficha (no se usó el `useBleStickListener` global crudo). E2E verifica: (a/parto-a) el read entra
al sheet y el overlay global NO se abre; (b) tras cerrar, un bastonazo posterior no dispara nada.

## Trazabilidad (comportamiento del delta → test)
- **Captura en el alta (BLE)** → `e2e/alta-bastoneo.spec.ts (a)`: CTA → sheet → bastonazo → `tag-captured` con EID
  legible + `find-or-create-overlay` count 0 → "Crear animal" → oráculo server `waitForServerAnimalProfile` +
  `waitForServerTagAssigned(profileId, eid)` (animals.tag_electronic + denorm 0079).
- **Mis-scan corregible (form, no inmutable)** → `alta-bastoneo.spec.ts (a-bis)`: scan A → "Cambiar" → CTA →
  scan B → el alta usa B (server oracle sobre eidRight, NO eidWrong).
- **Cleanup del scoped scanner en el alta** → `alta-bastoneo.spec.ts (b)`: cerrar el sheet → bastonazo posterior
  no dispara nada (ni read, ni sheet, ni overlay).
- **Límite 15 díg de la carga manual + rechazo (dentro del sheet, en el alta)** → `animals.spec.ts` FIX2
  (letras+40 díg → 15; 8 díg → "…15 dígitos." + sigue en manual, fail-closed).
- **Captura por ternero (parto, 1 ternero, BLE)** → `parto-bastoneo.spec.ts (a)`: CTA `tag-scan-open-0` →
  bastonazo → `tag-captured-0` + overlay count 0 → guardar → `waitForServerBirth(1 calf)` +
  `waitForServerCalfTags([eid])`.
- **Mellizos, cada ternero su caravana distinta** → `parto-bastoneo.spec.ts (b)`: 2 CTAs independientes → 2 EIDs
  distintos capturados (`tag-captured-0`/`-1`) → guardar → `waitForServerBirth(2 calves)` +
  `waitForServerCalfTags([eid0, eid1])`.
- **Ownership exclusivo (no doble-consumo del EID)** → cubierto por el "overlay count 0" + el read llegando al
  sheet en (a) de ambas specs (el read solo llega al sheet si el scoped scanner fuerza `listening` pese a busy).
- **Copy de captura ("Usar caravana")** → asertado en alta (a) y parto (a).
- **Lógica pura reusada** (sin extraer nada nuevo puro): `sanitizeTagInput`/`isValidTagElectronic`/
  `formatEidReadable` ya tenían unit (`animal-input.test.ts`, `eid-format.test.ts`) — re-corridos VERDES.

## Capturas (Gate 2.5, ADR-029) — entregadas, NO ejecutadas (el leader las corre)
- `app/e2e/captures/alta-bastoneo.capture.ts` → `__shots__/alta-bastoneo/`: 01-cta, 02-conectar, 03-escaneando,
  04-lectura-usar-caravana, 05-capturado-readonly-cambiar, 06-manual-promovido, 07-carga-manual, 08-manual-error-largo.
- `app/e2e/captures/parto-bastoneo.capture.ts` → `__shots__/parto-bastoneo/`: 01-cta-por-ternero,
  02-lectura-usar-caravana-ternero, 03-ternero1-capturado, 04-mellizos-cta-ternero2, 05-mellizos-dos-caravanas.
- Molde: `caravana-ficha-bastoneo.capture.ts`. `playwright.capture.config.ts` (412×915). Los `.capture.ts` SE
  COMMITEAN; los `__shots__/*.png` van gitignored (`app/.gitignore:29`). NO ejecuté los captures (per instrucción)
  ni `e2e:build` (re-renderiza `design/*.png`).

## Autorrevisión adversarial (qué busqué → qué encontré → cómo lo cerré)
- **Prop rename completo**: grep `onAssignTag=` en callers → 0; en `TagScanSheet` solo quedaban 2 menciones en
  el COMMENT de cabecera (stale) → **actualizadas** a `onSubmit`. `[id].tsx` def local de `TagScanCta` + import
  `StickIcon` → **borrados** (import muerto, lo confirmé con grep). Typecheck re-verde.
- **Imports muertos por el borrado del campo suelto**: `sanitizeTagInput` (alta+parto) y `TAG_ELECTRONIC_LENGTH`
  (parto) quedaban sin uso → **removidos**. `TAG_ELECTRONIC_LENGTH` sigue usado en el alta (mensaje de error de
  submit) → conservado. Typecheck verde.
- **tagError inalcanzable pero no-dead-end**: con el campo suelto fuera, `tag` solo puede ser vacío o 15 díg
  válidos (BLE valida; la carga manual del sheet valida 15) → `isValidTagElectronic(tag)` siempre true → el
  `setTagError` del submit es defensa muerta (documentado). Igual dejé el display del `tagError` bajo el CTA por
  si un deep-link/borde metiera un tag inválido, y `onClearTag` lo limpia. No es un dead-end silencioso.
- **Per-ternero: escritura al ternero equivocado**: usé `localId` (no índice) → inmune a reorden. Con el sheet
  abierto (scrim full-screen) la lista no se puede mutar → sin race. `onClose` limpia `scanCalfLocalId`.
- **Test que pasa por la razón equivocada**: el read llega al sheet SOLO si el scoped scanner fuerza `listening`
  pese a busy (el provider dropea en `handleReading` si `!listening`) → asertar `tag-scan-read` visible es la
  prueba REAL del ownership, no solo "overlay count 0" (que además el busy ya suprimiría). Ambos asertados.
- **Oráculo del alta correcto para un CREATE**: verifiqué en `0079` que el force BEFORE INSERT del perfil copia
  `animals.tag_electronic` → `animal_profiles.animal_tag_electronic` en el insert del perfil → `waitForServerTagAssigned`
  (que chequea AMBOS) converge para un animal recién creado (no solo para el assign).
- **Rotura de e2e existentes**: grep de `Caravana electrónica (recomendado|opcional` y `onAssignTag` en `e2e/` →
  las únicas refs son mis asserts de AUSENCIA (`toHaveCount(0)`); ningún otro test llena el campo suelto. FIX2
  actualizado. `baston-ficha.spec.ts` / `caravana-ficha-bastoneo.capture.ts` usan testIDs y `getByLabel` de la
  carga manual (inalterados) y NO asertan el texto del botón → la default copy de la ficha ("Asignar caravana")
  se conservó, sin regresión.
- **Multi-tenant / offline**: la captura es estado de cliente puro (sin red); los submits (`createAnimal`/
  `registerBirth`) son offline-first vía outbox, contratos INTACTOS; `establishmentId` sigue del contexto. Sin
  hardcode de tenant. Gate 1 N/A (0 SQL).

## Reconciliación de specs (as-built, in-place)
- `design-caravana-ficha.md` **§10.6 (NUEVO)**: RCF.6 generalizado — `onSubmit` + copy props + `TagScanCta`
  compartido + `CapturedTagRow`, reuso en alta/parto (modo captura). Fiel al código.
- `design.md` (índice de deltas): fila `bastoneo-captura-alta-parto` (frontend puro, Gate 1 N/A, ⏸ Puerta 2).
- `design-parto-rodeo-caravana.md`: nota de reconciliación bajo el tag electrónico del `CalfBlock` (RPRC.2.5):
  el campo tipeable suelto → bastoneo por ternero (modo captura), `tagRaw` fluye a `registerBirth` sin cambios.
No hay `requirements` nuevos (es una generalización as-built de RCF.6, no cambia el *qué* del alta/parto: el tag
sigue opcional y fluye a los mismos contratos). No hay `tasks.md` propio de este delta.

## Notas
- **e2e excluido del tsconfig de la app** (`exclude: ["e2e", …]`) → `pnpm typecheck` no cubre los specs. Los
  validé con un tsconfig temporal: mis specs (`alta-bastoneo`/`parto-bastoneo`) 0 errores propios; los únicos
  flags fueron falsos positivos SISTÉMICOS del config temporal (faltan `@types/node` → `node:path`/`node:crypto`;
  `Page` de fixtures; implicit-any en `page.evaluate`) que afectan por igual a TODOS los e2e existentes
  (`baston-ficha.spec.ts`, etc.). El único cast "may be a mistake" en `admin.ts` es el patrón IDÉNTICO del
  sibling pre-existente `waitForServerTagAssigned` (`animals(tag_electronic)` embed a-uno) — Playwright transpila
  con esbuild (sin typecheck), así que no hay gate afectado.
- NO corrí la suite backend completa de `check.mjs` (RLS/Edge/… contra la DB remota): es ORTOGONAL a un delta
  frontend-only (Gate 1 N/A) y con una terminal paralela activa arriesga rate-limits (flake, no regresión).
