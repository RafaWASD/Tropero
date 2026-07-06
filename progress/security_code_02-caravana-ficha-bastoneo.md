# Security Gate 2 (code) — delta caravana-ficha bastoneo (spec 02, Nivel B)

**Modo**: `code` (ADR-019). **Baseline**: `ac709d2`. **Fecha**: 2026-07-06.
**Skill**: `sentry-skills:security-review` corrida sobre el diff + checklist RAFAQ-específico + catálogo de dominios.

## Veredicto: **PASS — 0 findings HIGH**

Delta frontend puro (UI + un flag de coordinación client-side del listener BLE global). `git diff` de `supabase/` **vacío** → Gate 1 N/A confirmado. El contrato del RPC `assign_tag_to_animal` NO cambia; la autorización, la inmutabilidad (NULL→valor, R4.13) y la derivación de tenant siguen enforced server-side (fuera de este diff). No hay superficie de servidor nueva, ni endpoint nuevo, ni parseo de input nuevo, ni secreto tocado.

---

## Archivos analizados (diff vs `ac709d2`)

Código (in-scope):
- `app/src/components/TagScanSheet.tsx` (nuevo) — sheet de scan acotado.
- `app/src/services/ble/listener-gate.ts` (nuevo) — decisión pura `resolveListening`.
- `app/src/services/ble/BleStickListenerProvider.tsx` — contador `scopedCount` + `acquireScopedScanner`.
- `app/src/services/ble/stick.ts` — hook `useScopedScannerControls` (noops estables).
- `app/app/_components/FindOrCreateOverlay.tsx` — auto-supresión del overlay global cuando hay scanner acotado.
- `app/app/animal/[id].tsx` — CTA "Bastonear" + montaje del sheet + reuso de `onAssignTag`.
- `app/src/components/IdentifierAssignRow.tsx` — prop `hideLabel` (solo render del label colapsado).

Fuera de scope de findings (tests / capturas, no se flaggean per skill):
- `app/src/services/ble/listener-gate.test.ts`, `app/e2e/baston-ficha.spec.ts`, `app/e2e/captures/caravana-ficha-bastoneo.capture.ts`, `scripts/run-tests.mjs` (solo suma el nuevo test a la lista).

Leídos para trazar el flujo (no modificados por el delta, contexto):
- `app/src/services/animals.ts` (`assignTagToAnimal` → `enqueueAssignTag`), `app/src/services/powersync/outbox.ts` (`enqueueAssignTag`), `app/src/services/ble/stick.ts` (`useBleStickListener`, `useBusyWhileMounted`).

---

## Foco 1 — Integridad del dato regulado (EID → SENASA, ADR-024)

**OK.** El EID nunca llega crudo al assign; hay validación upstream + confirmación visual pre-commit + guard de secuencia.

- **Validación upstream (no bypasseable desde el sheet)**: la lectura entra por `handleReading` (`BleStickListenerProvider.tsx:148-178`). El motor de ingesta valida/dedupea (`engine.processRawLine`/`processEid`); un candidato `rejected` (malformado, R1.4) se **loguea y se descarta** — no se entrega. Solo `candidate.eid` (válido + des-duplicado, 15 díg) se despacha a los suscriptores (`for (const cb of tagSubscribersRef.current) cb(candidate.eid)`, línea 177). El `TagScanSheet.onTagRead` recibe únicamente EIDs ya validados. No se agregó ningún parseo propio en el sheet.
- **Confirmación visual pre-commit**: `readEid` no-null renderiza `ReadConfirmation` (`TagScanSheet.tsx:172-179, 355-408`) mostrando los 15 díg legibles (`formatEidReadable`) + "Asignar esta caravana a este animal". El commit **exige un tap explícito** en "Asignar caravana" (`onAssign`, líneas 96-109). El valor asignado es el `readEid` crudo validado; `formatEidReadable` es solo cosmético (no muta lo que se asigna).
- **Guard de secuencia (race entre lecturas / live-rescan)**: `onTagRead` ignora lecturas nuevas mientras hay un assign en vuelo (`if (assigningRef.current) return`, `TagScanSheet.tsx:78`) → una lectura tardía no pisa el EID que el operario ya confirmó. `onAssign` re-chequea `assigningRef.current` (línea 97) → no hay doble-assign. Fuera de vuelo, un EID nuevo reemplaza al pendiente (live-rescan intencional, "escanear-escanear") pero SIEMPRE con el operario viendo el nuevo valor antes de confirmar. No hay ventana en la que se asigne un EID distinto del confirmado.
- **Fail-closed**: si el encolado falla, `onAssign` surfacea el error inline y deja el sheet **abierto** (no cierra, no asigna); `onAssignTag` en la ficha revierte el optimismo (`[id].tsx:646`).

## Foco 2 — Autorización / tenant / IDOR

**OK.** El cliente no bypassea nada; el servidor es la barrera.

- El sheet llama `onAssignTag(readEid)` → `assignTagToAnimal(detail.profileId, trimmed)` (`[id].tsx:644`). El cliente pasa **solo** `profileId` + el tag; NUNCA `establishment_id` ni `animal_id`. El RPC deriva el tenant de la fila real del perfil (anti-IDOR) y re-chequea `has_role_in` (documentado en `animals.ts:1170-1172`; enforcement server-side, fuera del diff). La inmutabilidad NULL→valor la enforce el RPC/trigger.
- `profileId` está atado a la ficha que se está viendo — el sheet cierra sobre el `detail` de ESA ficha. No hay ruteo cross-animal desde un sheet.
- **Multi-tenant en el pre-check (RCF.2.5)**: el `lookupByTag` usa `detail.establishmentId` (del perfil), NO el contexto activo (`[id].tsx:617-625`) → correcto aunque el usuario mire la ficha del campo A con el campo B activo.
- El gating de cliente (`canAssignTag`, montaje condicional del sheet en `[id].tsx:1034`) es UX; el rechazo real (dup 23505 / race 23514 / sin-rol 42501 / perfil-inexistente 23503) lo resuelve `uploadData` al subir. No se relaja ninguna barrera.

## Foco 3 — El flag "scoped scanner" (integridad de ruteo del EID)

**OK.** No filtra ni cruza lecturas a un consumidor equivocado, y no deja estado colgado.

- **Un solo consumidor efectivo**: cuando el sheet está montado, `scopedScannerActive` (contador `scopedCount > 0`) hace que el `FindOrCreateOverlay` global **retorne temprano** antes de cualquier lookup/setState (`FindOrCreateOverlay.tsx:150` — `if (scopedScannerActiveRef.current) return;`, primera línea junto al guard de ruta dueña) y cierra un overlay stale si lo hubiera (efecto anti-stacking, líneas 204-209). El overlay recibe el string del EID por el fan-out de `subscribeTagRead` pero **no lo procesa** — no es una fuga (mismo proceso, mismo user, mismo device; no cruza tenants ni persiste nada). El sheet, atado al `profileId` de su ficha, es el único que actúa.
- **Sin estado colgado**: `acquireScopedScanner` es un **contador** con release idempotente (`released` flag + `Math.max(0, c-1)`, `BleStickListenerProvider.tsx:130-146`). El sheet hace acquire en un efecto al montar y release en el cleanup (`TagScanSheet.tsx:61-64`) → cubre cierre por X, backdrop, back-gesture y desmontaje de la ficha. La ref del acquire es estable (`useCallback([])` en provider; noop estable de módulo sin provider, `stick.ts:100-115`) → el efecto no se re-dispara por render.
- **Invariante de liberación (verificado por `listener-gate.test.ts`)**: al liberar, `resolveListening` vuelve EXACTAMENTE a `enabled && !busy`. La ficha mantiene `useBusyWhileMounted()` (`[id].tsx:129`) → `busy=true` → tras cerrar el sheet, un bastonazo posterior en la ficha **no dispara nada** (escucha re-suspendida), igual que antes de abrir el sheet. No queda el listener global escuchando a un contexto equivocado.
- Que el scanner acotado fuerce la escucha aun con `enabled=false` (MODO MANIOBRAS) es una decisión de propiedad exclusiva deliberada de un flag client-side; no tiene implicancia de seguridad.

## Foco 4 — Input

**OK.** El único input es el EID (validado 15 díg upstream, ver Foco 1) + el fallback manual, que reusa el path ya existente sin cambios de validación.

- El fallback manual del sheet (`ManualPromptHero`/`ManualFallbackLink`) solo llama `onClose`/`onManual` → cierra el sheet y aterriza en el `IdentifierAssignRow` de la ficha. Ese componente conserva `sanitizeTagInput` + `maxLength={TAG_ELECTRONIC_LENGTH}` + `validate` (`isValidTagElectronic` && 15 díg) — el diff de `IdentifierAssignRow.tsx` **solo** agrega `hideLabel` (render condicional del label colapsado; no toca sanitize/validate/onConfirm). No se agregó parseo sin acotar.

---

## Tabla de inputs (campos que el usuario tipea/genera en este delta)

| campo | límite | validación | OK? |
|---|---|---|---|
| EID por bastoneo (`TagScanSheet`) | 15 díg, formato EID | server-authoritative (RPC `assign_tag_to_animal`) + validación upstream del motor de ingesta (rechaza malformado) + confirmación visual pre-commit | ✅ |
| EID por carga manual (`IdentifierAssignRow`, fallback) | `maxLength=TAG_ELECTRONIC_LENGTH` (15), number-pad | cliente `sanitizeTagInput`+`isValidTagElectronic` (UX) + RPC server-side (autoritativa) — path preexistente sin cambios | ✅ |

## Tabla de rate limits (acciones abusables tocadas por el diff)

| acción | rate limit | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| assign EID (encolar RPC `assign_tag_to_animal`) | n.a. en este delta | server deriva tenant + `has_role_in` | sí (guard `assigningRef` evita doble-submit; error deja sheet abierto sin asignar) | Sin cambio de contrato ni de superficie server. Es un UPDATE NULL→valor idempotente (replay → `{replay:true}`), no un endpoint caro/bulk ni de email/SMS/API externa. No introduce vector de abuso nuevo. Un rate limit propio del RPC sería mejora server-side fuera del scope de este delta frontend. |

---

## Checklist RAFAQ-específico + catálogo (dominios revisados)

- **A1 service-role bypass**: n.a. — no hay `createAdminClient()` en el diff.
- **A2 mass assignment**: n.a. — el encolado arma params explícitos `{ p_profile_id, p_tag_electronic }` (`animals.ts:1178`); no hay spread de `body`.
- **A3/A4 IDOR / BFLA**: cubierto en Foco 2 — cliente pasa solo `profileId`; tenant + rol se derivan/chequean server-side.
- **B1 information disclosure**: sin `err.message` crudo nuevo al cliente. `onAssignTag` devuelve `r.error.message` del clasificador de outbox (mensaje ya sanitizado del path preexistente), no un error crudo de DB.
- **C offline/sync**: encolado por outbox; `animals` fuera del sync set (ADR-026) → sin UPDATE local ni sync rule nueva. El rechazo real se resuelve al subir (stale-auth re-chequeado server-side, C4). Sin data-at-rest nueva.
- **F1 filter injection**: el EID validado va como parámetro de RPC, no concatenado en `.or()/.filter()/ilike`.
- **G BLE trust boundary**: G1 (input no confiable) — la lectura del bastón se valida upstream antes de persistir (Foco 1). G3 (no-autopersistencia) — una lectura NO se vuelve verdad sin el tap de confirmación pre-commit. Modelo de canal Nordic UART (G2) es preexistente (ADR-003/024), no tocado por este delta.

## Dominios excluidos (justificación)

- **D (secretos/supply chain)**: sin imports nuevos, sin secretos, sin `console.log` de datos sensibles en el diff.
- **E (abuso a escala)**: sin queries de lista nuevas sin tope; el assign es puntual (1 animal). Ver tabla de rate limits.
- **F2/F3/F4 (import/SSRF/email-XSS)**, **H (auth/sesión)**, **I (compliance/mobile hardening)**: no tocados por un delta de UI + flag de listener.

## False positives descartados / no-findings notados (trazabilidad)

- **Fan-out de `subscribeTagRead` al overlay global con scanner acotado activo**: el overlay recibe el string del EID pero retorna antes de procesarlo (`FindOrCreateOverlay.tsx:150`). No es fuga: mismo proceso/user/device, sin cruce de tenant ni persistencia. Descartado.
- **Dos `TagScanSheet` montados a la vez (dos fichas en el stack)**: contrivido — el sheet es un overlay absoluto con scrim; para abrir un segundo habría que salir de la ficha (back-gesture cierra el sheet → release). Aun en el caso teórico, el contador maneja el nesting y **cada assign sigue atado al `profileId` de su propia ficha y exige confirmación visual en la pantalla de ESE animal** → no produce asignación a animal equivocado sin confirmación humana en la ficha correcta. No es HIGH.
- **Ventana de carrera acquire-vs-subscribe al montar el sheet**: si un EID llegara entre que el overlay ya se auto-suprime y el sheet aún no suscribió, la lectura se **pierde** (nadie la procesa) — es un read perdido (el operario re-escanea), no una asignación errónea. Integridad intacta. No es finding.

## Cobertura indirecta (advertencia)

La skill `sentry-skills:security-review` no cubre nativamente Deno/Edge, RLS/Postgres, PowerSync sync rules ni BLE. En este delta **no aplica**: no hay Edge Functions, ni migrations, ni policies, ni sync rules nuevas (Gate 1 N/A confirmado por `git diff supabase/` vacío). La revisión BLE/offline se hizo manualmente contra el catálogo RAFAQ (dominios C y G arriba). La autorización real del assign vive en el RPC server-side, **fuera de este diff** — no re-auditada acá porque el contrato no cambió; su corrección se asume del gate previo de la feature que lo introdujo.

---

## UX update (2026-07-06) — carga manual del EID movida DENTRO del sheet

**Modo**: `code` (re-auditoría del ajuste UX). **Base de comparación**: HEAD `20df0d2` (working tree sin commitear).
**Skill**: `sentry-skills:security-review` re-corrida sobre el diff sin commitear + validación manual + catálogo RAFAQ.
`git diff supabase/` **vacío** → Gate 1 N/A confirmado (sin migrations/Edge/policies/sync rules).

### Veredicto: **PASS — 0 findings HIGH**

Reshuffle de UI puro: el `<IdentifierAssignRow kind="tag">` se sacó de la ficha y la carga manual del EID por teclado se movió DENTRO del `TagScanSheet` (nuevo `manualMode` + sub-componente `ManualTagEntry`). Es el **mismo dato regulado**, la **misma validación** y el **mismo `onAssignTag`** — solo cambió la superficie de render. No hay endpoint nuevo, ni parseo nuevo sin acotar, ni relajación de autorización/tenant, ni superficie server tocada.

### Archivos analizados (diff working-tree vs `20df0d2`)

- `app/src/components/TagScanSheet.tsx` — `+manualMode`/`+manualModeRef` + `+ManualTagEntry` (FormField 15 díg) + links "¿Sin bastón?" → `setManualMode(true)`; `onTagRead` ignora lecturas si `manualModeRef.current`.
- `app/app/animal/[id].tsx` — eliminado el `<IdentifierAssignRow kind="tag">` de la electrónica vacía (queda solo `<TagScanCta>`); imports `sanitizeTagInput`/`TAG_ELECTRONIC_LENGTH`/`isValidTagElectronic` removidos (los usa ahora el sheet). `onAssignTag` intacto.
- `app/src/components/IdentifierAssignRow.tsx` — **revertido** el prop `hideLabel` (quedó sin uso al sacar el row). El label colapsado vuelve a renderizarse siempre.
- Fuera de scope de findings: `app/e2e/baston-ficha.spec.ts` (caso `(c)` reescrito), `app/e2e/captures/caravana-ficha-bastoneo.capture.ts` (+shot 07).

Leídos para trazar el flujo: `app/src/utils/animal-input.ts` (`sanitizeTagInput`, `isValidTagElectronic`, `TAG_ELECTRONIC_LENGTH`), `app/src/components/FormField.tsx` (passthrough de `maxLength`/`keyboardType` al `TextInput` nativo), `app/app/animal/[id].tsx:613-653` (`onAssignTag`), `app/src/services/animals.ts:748-787` (`lookupByTag`).

### Foco A — Input del EID manual (nueva superficie, MISMO dato regulado)

**OK. La validación NO se debilitó al reubicarla — es idéntica a la del `IdentifierAssignRow` que se removió.** Tres capas cliente + la autoritativa server-side sin cambios:

1. **Sanitize en vivo**: `ManualTagEntry.handleChange` → `sanitizeTagInput(raw)` = `raw.replace(/\D/g, '').slice(0, 15)` (`animal-input.ts:32-34`) → solo dígitos, tope 15 (cubre paste). `TagScanSheet.tsx:~388`.
2. **Cap nativo real**: `FormField maxLength={TAG_ELECTRONIC_LENGTH}` (=15) se reenvía al `TextInput` de react-native (`FormField.tsx:34-35, 97`) — no es cosmético.
3. **Validación de forma ANTES de asignar**: `handleConfirm` gatea en `isValidTagElectronic(value) && value.trim().length === TAG_ELECTRONIC_LENGTH` (`isValidTagElectronic` = `/^\d{15}$/`, `animal-input.ts:120-124`) y sólo entonces llama `onAssignTag(value)`; si no, `setError('…15 dígitos.')` y **no** invoca nada. Misma copy y misma regla que el row removido (comparado contra el diff de `[id].tsx`: el `validate` viejo era literal-idéntico).
4. **Autoritativa server-side (sin cambios)**: RPC `assign_tag_to_animal` + constraints de DB (23505 unique / 23514 CHECK / 42501 RLS) resueltas por `uploadData` al subir. El move no tocó esta capa.

No se agregó ningún parseo sin acotar. El input manual es el único campo nuevo tipeable y queda constreñido a `^\d{15}$` antes de cualquier assign.

### Foco B — assign (mismo path, sin bypass)

**OK.** `ManualTagEntry` recibe `onAssignTag={onAssignTag}` — la **misma referencia** del host que usa el path BLE (`TagScanSheet.tsx:187`, `[id].tsx:1014`), no está en el diff. Preserva íntegro: pre-check de dup con `lookupByTag(trimmed, detail.establishmentId)` (establishmentId **del perfil**, anti-IDOR RCF.2.5, `[id].tsx:611-631`) → `assignTagToAnimal(detail.profileId, trimmed)` con params escalares (sin spread de body → sin mass assignment). El manual no introduce ninguna ruta de assign alternativa ni relaja el tenant/autorización.

### Foco C — Ownership del listener (manualMode ignora lecturas sin soltar el scanner)

**OK. El cambio es aditivo; no cruza lecturas entre consumidores ni deja el listener colgado.**

- `onTagRead` sólo suma un guard: `if (assigningRef.current || manualModeRef.current) return;` (`TagScanSheet.tsx:~93`). En manual **descarta** la lectura BLE (no toca `readEid`). El **scoped scanner sigue adquirido** — el acquire/release está atado al mount/unmount del sheet (sin cambios), `manualMode` NO libera nada. Comentario y código lo confirman.
- `manualMode`/`manualModeRef` son estado/ref **locales del componente** (`useState`/`useRef`) — sin estado a nivel de módulo ni compartido → cero cruce entre consumidores; se resetean al desmontar el sheet.
- **Sin contaminación de EID entre paths**: el render prioriza `manualMode` > `readEid !== null` > heroes (`TagScanSheet.tsx:187-203`). El link/CTA que setea `manualMode=true` sólo existe en los heroes (que se renderizan con `readEid === null`) → al entrar a manual, `readEid` es null; mientras se tipea, las lecturas se ignoran → `readEid` sigue null. `ManualTagEntry` usa su **propio** `value` local, nunca `readEid`. El assign manual asigna `value` (tipeado); el assign BLE asigna `readEid` (leído). No se mezclan.
- **Sin listener colgado**: salir de manual (`onBack` → `exitManual` → `setManualMode(false)`) reanuda las lecturas; el `release` del scanner sigue ocurriendo en el cleanup del sheet igual que antes. Invariante de liberación intacta (`resolveListening` vuelve a `enabled && !busy`).

### Foco D — supabase/ diff

`git diff supabase/` vacío → **Gate 1 N/A confirmado**. Sin superficie server nueva.

### Tabla de inputs (delta UX)

| campo | límite | validación | OK? |
|---|---|---|---|
| EID por carga manual DENTRO del sheet (`ManualTagEntry`) | `maxLength=15` nativo + `sanitizeTagInput` (solo díg, slice 15) | cliente `isValidTagElectronic` (`/^\d{15}$/`) ANTES de asignar (UX, idéntica al row removido) + RPC `assign_tag_to_animal` server-side (autoritativa, sin cambios) | ✅ |
| EID por bastoneo (`TagScanSheet`, path BLE) | 15 díg, formato EID | motor de ingesta upstream (rechaza malformado) + confirmación pre-commit + RPC server-side | ✅ (sin cambios) |

### Tabla de rate limits (delta UX)

| acción | rate limit | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| assign EID (manual o BLE → encolar RPC `assign_tag_to_animal`) | n.a. en este delta | server deriva tenant + `has_role_in` | sí (`busy` guard en `ManualTagEntry` + `assigningRef` en BLE; error → inline, sheet abierto sin asignar) | Mismo RPC/superficie que la review base; el move de UI no agrega vector de abuso. UPDATE NULL→valor puntual (1 animal), no bulk/email/SMS/API externa. |

### False positives descartados / considerados

- **`ManualTagEntry` devuelve `r.error ?? 'No se pudo guardar el cambio.'` (B1 information disclosure)**: el `r.error` proviene del `onAssignTag` del host, que devuelve mensajes ya curados (errores de verificación de red / dup accionable) o `r.error.message` del clasificador de outbox — path **preexistente, no en este diff**, y es un mensaje de encolado client-side, no un `err.message` crudo de DB/Edge. No es finding.
- **F1 filter injection vía `lookupByTag`**: el EID llega constreñido a `^\d{15}$` antes del pre-check, y `lookupByTag` usa queries locales parametrizadas (`buildSearchByTagQuery`/`buildLookupTagAcrossFieldsQuery`, `animals.ts:748-787`), sin `.or()/.ilike()` con concatenación. Sin riesgo. Además es código preexistente fuera del diff.
- **Reversión de `hideLabel`**: sólo re-habilita el render del label colapsado del `IdentifierAssignRow` (`idv`). Sin implicancia de seguridad.

### Conclusión UX update

Los cuatro focos verificados (no asumidos). El ajuste es un reshuffle de UI que **preserva** la validación del dato regulado (idéntica, sólo reubicada), el path de assign (misma referencia, mismo anti-IDOR/tenant) y la propiedad exclusiva del listener (guard aditivo, scanner no se suelta, estado local sin cruce). **PASS — 0 findings HIGH.**
