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
