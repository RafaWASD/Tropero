# Security Review (Gate 2, ADR-019) — delta `bastoneo-captura-alta-parto`

- **Modo**: `code`
- **Feature**: spec 02, Nivel B — bastoneo/captura del EID en ALTA (`crear-animal`) y PARTO (`agregar-evento`)
- **Baseline**: `c402a38` (sin commitear; `git status --porcelain`)
- **Skill**: `sentry-skills:security-review` corrida sobre el diff del delta
- **Fecha**: 2026-07-06

## Veredicto: PASS — 0 findings HIGH

Delta 100% frontend. No debilita la validación del EID (dato regulado SENASA), no introduce inyección por las copy props, y no deja el listener BLE colgado ni cruza lecturas entre consumidores/terneros. El servidor (`create_animal` / `register_birth` + índice unique global de `tag_electronic`) sigue siendo la autoridad; no se agregó bypass client-side.

## Alcance del diff

Archivos del delta analizados (excluidos los 3 de la terminal Android — `app/app.json`, `app/eas.json`, `docs/build-android.md`):

- `app/src/components/TagScanSheet.tsx` (M) — generalización del sheet a 2 modos (asignar/capturar)
- `app/src/components/TagScanCta.tsx` (nuevo) — `TagScanCta` + `CapturedTagRow` extraídos de la ficha
- `app/src/components/index.ts` (M) — barrel exports
- `app/app/crear-animal.tsx` (M) — CTA + sheet de captura en el alta
- `app/app/agregar-evento.tsx` (M) — CTA + sheet de captura por ternero en el parto
- `app/app/animal/[id].tsx` (M) — rename `onAssignTag` → `onSubmit`; borra el `TagScanCta` local (ahora importado)
- `app/e2e/helpers/admin.ts` (M) — oráculo e2e `waitForServerCalfTags` (test infra)

`git diff -- supabase/` **vacío** → Gate 1 (spec/DB) N/A, confirmado.

## Foco 1 — Validación del EID (dato regulado) NO se debilitó

La generalización `onAssignTag` → `onSubmit` es un **rename + copy props opcionales**; la lógica de validación es idéntica. El EID llega/se confirma validado por las MISMAS 3 barreras que antes, en ambos modos:

1. **Path BLE**: `onTagRead` recibe el EID **ya validado (15 díg FDX-B) + dedupeado** por el contrato del provider (`app/src/services/ble/stick.ts:8`, `contract.ts` extract→validate→dedup). `TagScanSheet.onTagRead` (`TagScanSheet.tsx:113`) solo hace `setReadEid(eid)` — no relaja nada. Ese bloque **no fue tocado por el diff** (solo doc-comment + rename de prop).
2. **Path MANUAL (dentro del sheet)**: `ManualTagEntry.handleConfirm` (`TagScanSheet.tsx:424`) exige `isValidTagElectronic(value) && value.trim().length === TAG_ELECTRONIC_LENGTH` ANTES de `onSubmit`; input sanitizado en vivo a solo-dígitos ≤15 (`sanitizeTagInput`, `maxLength={TAG_ELECTRONIC_LENGTH}`). Sin cambios respecto del pre-delta.
3. **Confirmación pre-commit (ADR-024)**: `ReadConfirmation` (`TagScanSheet.tsx:478`) muestra los 15 díg legibles y exige tap humano; **no hay auto-persistencia** de una lectura BLE.

Además, en el submit de cada caller:

- **ALTA** (`crear-animal.tsx:534`): `const tagOk = isValidTagElectronic(tag)` sigue gateando antes de `createAnimal({ tagElectronic: tag.trim() || null })` (línea 589). El CTA/`CapturedTagRow` reemplazó el `FormField`, pero el estado `tag` solo se setea a un EID ya validado (contrato BLE o gate manual de 15 díg).
- **PARTO** (`agregar-evento.tsx:478`): `validateCalves` normaliza y `register_birth` re-valida server-side. `calf.tagRaw` **solo** puede setearse ahora vía el sheet (el `FormField` de texto libre con `sanitizeTagInput` se eliminó), así que la única fuente de `tagRaw` es un EID de 15 díg validado. La captura de tag quedó **más estricta**, no más laxa: el campo viejo aceptaba entradas parciales (`validateCalves` no chequea largo — comportamiento **pre-existente**, `event-input.ts:260`, fuera del delta); el nuevo flujo obliga 15 díg exactos antes de tocar `tagRaw`.

Conclusión: sin debilitamiento ni bypass client-side. El unique global de `animals.tag_electronic` sigue siendo el árbitro de duplicados.

## Foco 2 — Copy props (`title` / `confirmLabel` / `confirmSublabel`) sin inyección

Son **literales estáticos del caller**, no user-input:
- `crear-animal.tsx`: `confirmLabel="Usar caravana"`, `confirmSublabel="Usar esta caravana para el animal."`
- `agregar-evento.tsx`: `confirmLabel="Usar caravana"`, `confirmSublabel="Usar esta caravana para este ternero."`
- `animal/[id].tsx`: usa los defaults.

Se renderizan como children de `<Text>` de React Native (sin HTML, sin `dangerouslySetInnerHTML`/`v-html` — no aplica en RN; auto-escape de por sí). El único dato dinámico mostrado es el EID vía `formatEidReadable(eid)`, que agrupa dígitos ya validados. Cero interpolación de datos no confiables. Sin vector de inyección.

## Foco 3 — Ownership del listener y race del ruteo por ternero: sin defecto

- **Scoped scanner**: `acquireScopedScanner()` en `useEffect` al montar, `release` en el cleanup (`TagScanSheet.tsx:91-94`) — cubre back-gesture y desmontaje del host. Este bloque **no fue modificado por el diff**; no hay transporte colgado ni busyMode inconsistente introducido por el delta.
- **Un solo sheet a la vez**: alta usa `tagScanOpen` (boolean); parto usa `scanCalfLocalId` (un solo `string | null`). Los CTAs que cambian ese estado quedan **detrás del scrim** del sheet → con el sheet abierto la lista de terneros no se puede mutar (agregar/quitar) ni abrir un 2º sheet. Un solo `TagScanSheet` montado ⇒ una sola adquisición del scanner.
- **Ruteo al ternero correcto (sin race)**: `onSubmit` en parto hace `updateCalf(scanCalfLocalId, { tagRaw: eid })` (`agregar-evento.tsx:771`). `updateCalf` matchea por `localId` (`agregar-evento.tsx:316`), inmune a reordenamientos; si el `localId` no existe, es **no-op** (nunca asigna al ternero equivocado). El closure se recrea cada render con el `scanCalfLocalId` vigente, que no cambia mientras el sheet está abierto. La lectura BLE requiere confirmación humana (`ReadConfirmation`) antes de escribir — no hay auto-asignación por race.
- **Sin cruce entre consumidores**: cada instancia del sheet tiene su propio estado local (`readEid`, `assigning`, `manualMode`); nada compartido entre alta/parto/ficha.

## False positives descartados / no-hallazgos

- **`validateCalves` no valida largo de tag** (`event-input.ts:260`): comportamiento **pre-existente**, archivo **fuera del diff**, y el nuevo flujo de captura ya garantiza 15 díg antes de setear `tagRaw`. Server re-valida. No es finding del delta.
- **`admin.ts` usa `service_role`**: es test infra e2e (oráculo `waitForServerCalfTags`) con el cliente `admin` ya existente; sin secretos hardcodeados nuevos. No se ejecuta en el bundle de la app. Fuera de superficie de ataque.
- **Estabilidad de `acquireScopedScanner` en deps del `useEffect`**: patrón heredado de la ficha (RCF.6), no modificado por el delta.

## Tabla de inputs (campos que el usuario tipea/captura)

| Campo | Límite | Validación | OK? |
|---|---|---|---|
| EID por bastón (BLE) — alta y parto | 15 díg FDX-B | Contrato provider (validate+dedup) + confirmación humana pre-commit | Sí |
| EID manual dentro del sheet — alta y parto | solo dígitos, `maxLength=15`, sanitize en vivo | `isValidTagElectronic` + `length===15` antes de submit (server autoridad) | Sí |
| `tag` (alta, submit) | 15 díg | `isValidTagElectronic(tag)` en `crear-animal.tsx:534` + unique global server | Sí |
| `tagRaw` por ternero (parto) | 15 díg (solo seteable vía sheet validado) | `validateCalves` (normaliza) + `register_birth` re-valida server-side | Sí |
| `title`/`confirmLabel`/`confirmSublabel` | n/a (literales estáticos del caller, NO user-input) | n/a | Sí |

## Tabla de rate limits

| Acción | Rate limit | Keyeo | Fail-closed? | Nota |
|---|---|---|---|---|
| Captura/asignación de EID | n.a. | — | — | Delta frontend puro; escribe estado local (alta/parto). Sin llamada de red nueva. El submit reusa `createAnimal`/`registerBirth` existentes (sin cambio de superficie ni de rate). |

## Archivos analizados

`TagScanSheet.tsx`, `TagScanCta.tsx`, `components/index.ts`, `crear-animal.tsx`, `agregar-evento.tsx`, `animal/[id].tsx`, `e2e/helpers/admin.ts`. Contexto trazado (no modificado): `services/ble/stick.ts`, `services/ble/contract.ts`, `utils/animal-input.ts`, `utils/event-input.ts`, `utils/animal-form.ts`.

## Cobertura indirecta (Deno / RLS / PowerSync / BLE)

- **Deno / Edge Functions / RLS / migraciones**: N/A — `git diff supabase/` vacío.
- **BLE trust boundary (ADR-003/024, catálogo G)**: la ingesta de lecturas del bastón (validación FDX-B, dedup, no-autopersistencia vía `ReadConfirmation`) es **pre-existente** y **no fue modificada** por el delta; el sheet solo consume el EID ya validado del contrato. Revisión manual: OK, sin regresión introducida.
- La skill de Sentry cubre patrones JS/TS genéricos (inyección/XSS/secrets); el modelo de confianza BLE y la validación de EID se verificaron **manualmente** contra el contrato del provider (cobertura indirecta declarada).
