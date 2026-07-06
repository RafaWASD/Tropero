# Tasks (delta spec 02) — Agregar caravana desde la ficha (electrónica + visual)

**Status**: `spec_ready` (delta de spec 02 — frontend puro). Implementa `requirements-caravana-ficha.md` +
`design-caravana-ficha.md`.
**Fecha**: 2026-06-29

> Delta propio (ADR-028 Nivel B): este `tasks` es el ledger del incremento; el `tasks.md` baseline de spec 02
> NO se toca. Cada tarea lista los `RCF.n` que cubre. El implementer marca `[x]` y documenta el mapa
> `RCF.n → archivo:test` en `progress/impl_caravana-ficha.md`.

## Plumbing / lógica pura

- [x] **T1** — Crear módulo puro `app/src/utils/identifier-assign.ts` con `canAssignTag({ status, tagElectronic })`
  y `canAssignIdv({ status, idv })` (`status==='active' && <id>==null`). Cubre: RCF.1.1, RCF.1.2, RCF.1.3,
  RCF.1.4, RCF.1.5, RCF.1.7.
- [x] **T2** — Test (`node:test`) `app/src/utils/identifier-assign.test.ts`: activo+null→true; no-activo→false;
  valor seteado→false; ambos predicados. Cubre: RCF.1.1–RCF.1.5, RCF.1.7.
- [x] **T3** — Agregar `buildSetIdvUpdate(profileId, idv)` en `app/src/services/powersync/local-reads.ts`
  (`UPDATE animal_profiles SET idv = ? WHERE id = ? AND deleted_at IS NULL`, espejo de `buildSetCutUpdate`).
  Cubre: RCF.3.3, RCF.3.4.
- [x] **T4** — Test del shape SQL de `buildSetIdvUpdate` (SET solo `idv`; WHERE `id = ? AND deleted_at IS NULL`;
  args en orden). Cubre: RCF.3.3, RCF.3.4.
- [x] **T5** — Agregar `setIdv(profileId, idv): Promise<ServiceResult<true>>` en `app/src/services/animals.ts`
  (wrapper de `runLocalWrite(buildSetIdvUpdate(...))`, mismo patrón que `setCastrated`). Cubre: RCF.3.3, RCF.3.6.

## Componente de afordancia

- [x] **T6** — Crear `app/src/components/IdentifierAssignRow.tsx`: CTA "Agregar caravana …" → expande
  `FormField` (numérico, `sanitize`) + Confirmar/Cancelar (espejo inline de `CastrationRow`), validación inline
  (`error`), estado `busy`. Props: `kind`, `label`, `placeholder`, `keyboardType`, `sanitize`, `validate`,
  `onConfirm(value)`. Tokens + a11y + lineHeight matching; sin hardcode. Cubre: RCF.4.1, RCF.4.2, RCF.4.3,
  RCF.4.4, RCF.4.5.
- [x] **T7** — Exportar `IdentifierAssignRow` en `app/src/components/index.ts` (append-only). Cubre: (soporte T6).

## Cableado en la ficha

- [x] **T8** — En `app/app/animal/[id].tsx`, sección "Identificación" (`:749-754`): por cada identificador,
  render condicional `AttributeRow` (valor solo-lectura si `!= null`) **o** `IdentifierAssignRow` (si
  `canAssignTag`/`canAssignIdv`). `visual_id_alt` queda como `AttributeRow` sin cambios; NO agregar "Detectar
  bastoneo". Cubre: RCF.1.1, RCF.1.2, RCF.1.3, RCF.1.4, RCF.1.5, RCF.1.6.
- [x] **T9** — Handler `onAssignIdv`: validar no-vacío (RCF.3.2) → `setIdv(detail.profileId, value)` → optimismo
  en sitio + refresh silencioso; error inline si falla. Cubre: RCF.3.1, RCF.3.2, RCF.3.5, RCF.3.6.
- [x] **T10** — Handler `onAssignTag`: validar `^\d{15}$` (RCF.2.2) → pre-check
  `lookupByTag(value, detail.establishmentId)` (RCF.2.3/RCF.2.5) → si dup, error accionable y cortar →
  `assignTagToAnimal(detail.profileId, value)` (RCF.2.4) → optimismo en sitio + refresh; error de encolado
  inline. Cubre: RCF.2.1, RCF.2.2, RCF.2.3, RCF.2.4, RCF.2.5, RCF.2.6, RCF.2.7.

## Offline / multi-tenant (verificación)

- [x] **T11** — Confirmar que `idv` se asigna OFFLINE (UPDATE local, sin red) y que `establishmentId` siempre
  sale de `detail.establishmentId` (perfil), nunca hardcodeado ni del contexto activo. Cubre: RCF.5.1, RCF.5.2.

## Tests E2E (Playwright) + check

- [x] **T12** — E2E en `app/e2e/animals.spec.ts`, ficha de un animal activo sin caravana: "Agregar caravana
  visual" → tipear idv → confirmar → la fila pasa a mostrar el idv en solo-lectura. Cubre: RCF.1.3, RCF.3.3,
  RCF.3.5.
- [x] **T13** — E2E: "Agregar caravana electrónica" → 14 díg → error inline "…15 dígitos." sin invocar; luego 15
  díg → confirmar → optimismo en sitio. Cubre: RCF.2.1, RCF.2.2, RCF.2.4, RCF.2.7.
- [x] **T14** — E2E: un animal con `idv`/`tag` ya seteados NO ofrece afordancia (solo-lectura). Cubre: RCF.1.2,
  RCF.1.4.
- [x] **T15** — Autorrevisión adversarial del implementer + `node scripts/check.mjs` verde + mapa
  `RCF.n → archivo:test` en `progress/impl_caravana-ficha.md`. Reconciliar specs al as-built si algo cambió.
  Cubre: (trazabilidad / cierre).

## Delta bastoneo (2026-07-06) — RCF.6 (el bastoneo deja de estar DEFERIDO)

- [x] **T16** — Módulo puro `app/src/services/ble/listener-gate.ts` con
  `resolveListening({ scopedScannerActive, enabled, busy })` (= `scopedScannerActive || (enabled && !busy)`) +
  test `listener-gate.test.ts` (scanner acotado fuerza la escucha aunque busy; al liberar vuelve a
  `enabled && !busy`). Registrado en `scripts/run-tests.mjs`. Cubre: RCF.6.7, RCF.6.5.
- [x] **T17** — `BleStickListenerProvider`: `+scopedCount` (contador) → `scopedScannerActive` +
  `acquireScopedScanner()` (release idempotente) en el `ProviderApi`; `listening` pasa a `resolveListening`.
  `stick.ts`: `+useScopedScannerControls()` (ref estable). Cubre: RCF.6.5.
- [x] **T18** — `FindOrCreateOverlay`: guard `scopedScannerActive` en `onTagRead` (retorno temprano, paralelo a
  `BLE_OWNED_ROUTES`) + cierre defensivo del overlay si un scanner acotado se activa con él abierto +
  `testID="find-or-create-overlay"` (oráculo E2E). Cubre: RCF.6.5.
- [x] **T19** — `TagScanSheet.tsx` (nuevo): adquiere el scanner acotado (mount/unmount), hero adaptativo
  (`resolveListenConnState`: scan/connect/manual-promovido), confirmación pre-commit (`formatEidReadable` +
  "Asignar … a este animal") + assign a ESTE animal (`onAssignTag`), error inline fail-closed. Export en el
  barrel. Cubre: RCF.6.1, RCF.6.2, RCF.6.3, RCF.6.4, RCF.6.6.
- [x] **T20** — `IdentifierAssignRow`: `+prop hideLabel`. Ficha `[id].tsx`: afordancia "Bastonear la caravana"
  (`TagScanCta`) + la carga manual (piso, `hideLabel`) bajo un solo label; monta `TagScanSheet` condicional a
  `scanOpen && canAssignTag`. Cubre: RCF.6.1, RCF.6.6.
- [x] **T21** — E2E `app/e2e/baston-ficha.spec.ts` (adaptador mock): (a) bastoneo desde la ficha → asigna a ESTE
  animal (oráculo server) + overlay NO se abre (ausencia del testID exclusivo); (b) al cerrar, un bastonazo
  posterior no dispara nada; (c) sin transporte → manual-promovido + carga manual sigue funcionando. Cubre:
  RCF.6.1–RCF.6.6.
- [x] **T22** — Capture file `app/e2e/captures/caravana-ficha-bastoneo.capture.ts` (Gate 2.5, ADR-029): 6
  capturas nombradas (afordancia / connect / scan / lectura+confirmación / post-asignación / manual-promovido).
  Reconciliación de specs (context/requirements/design/tasks) al as-built. Cubre: (Gate 2.5 / cierre).

## Notas

- **¿Toca DB?** NO. `idv` por UPDATE local (trigger 0036 permite NULL→valor; unique parcial 0020 vigente); `tag`
  por RPC existente 0089. **Gate 1 N/A.** Si la implementación descubre que `idv` necesita RPC/policy/migración →
  detener y elevar a Gate 1.
- **No tocar** el `tasks.md` baseline de spec 02 (ledger histórico). Este delta trae el suyo.
- **Folding al cerrar (Puerta 2)**: agregar puntero "caravana-ficha" al índice "Deltas posteriores" del
  `design.md` baseline + nota as-built bajo R4.13 / la sección Identificación (afordancia de asignación NULL→valor
  desde la ficha).
