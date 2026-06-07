# Review — Spec 02 C3.3: Baja / egreso de animal desde la ficha

**Reviewer**: reviewer agent · **Fecha**: 2026-06-07
**Changeset**: NO commiteado (working tree). Nuevos: app/app/animal/baja.tsx, app/src/services/exit-animal.ts, app/src/services/exit-animal.test.ts. Modificados: app/app/animal/[id].tsx, app/src/services/animals.ts, app/app/_layout.tsx, scripts/run-tests.mjs, app/e2e/animals.spec.ts, specs (design.md, requirements.md, tasks.md).

## Veredicto: APPROVED

Con 2 nits cosmeticos (no bloquean; documentacion, no codigo de la app).

---

## Trazabilidad R<n> <-> test

| Requisito | Implementacion | Test que lo verifica | Estado |
|---|---|---|---|
| R4.14 baja via RPC, authz owner/autor con rol activo | exitAnimalProfile (animals.ts) -> RPC exit_animal_profile (0044); gating canExit ([id].tsx) | exit-animal.test.ts "42501 -> copy accionable"; e2e animals.spec.ts:496 (owner da de baja, boton gated visible) | OK |
| R4.14 copy authz (42501), NUNCA sqlerrm crudo | classifyExitError -> COPY.unauthorized | exit-animal.test.ts "42501 -> unknown con copy accionable, NO el message crudo" (assert !/not authorized/) | OK |
| R4.14 animal no disponible (23503) | classifyExitError -> COPY.gone | exit-animal.test.ts "23503 -> ya no esta disponible" | OK |
| R14.9 3 motivos -> (status, exit_reason) | exitReasonToStatus / EXIT_REASON_MAPPINGS | exit-animal.test.ts "Venta/Muerte/Transferencia" + "MVP expone EXACTAMENTE 3 motivos" | OK |
| R14.9 datos de venta opcionales SOLO en Venta | capturesSaleData + showSaleData (baja.tsx) + validateExitWeight/Price | exit-animal.test.ts "SOLO Venta captura peso+precio" + validadores opcionales (vacio->null) | OK |
| R14.9 no reversible (copy) | Step2Confirm aviso "Esta accion no se puede deshacer" | e2e (la baja no se revierte; ficha queda archivada in-situ) | OK |
| R14.9 online-only (sin red -> error, no marca) | classifyExitError network + OFFLINE_COPY; el RPC no corre | exit-animal.test.ts "error de red -> kind network" + "red tiene PRECEDENCIA sobre code" | OK |
| R14.9 modo archivada (badge + ocultar acciones) | ArchivedBadge + archivedBadgeLabel; ocultar Agregar/Dar de baja | exit-animal.test.ts "badge sold/dead/transferred + null"; e2e (badge "Vendido", ambos botones toHaveCount(0)) | OK |
| R14.9 badge tolera exitDate null (no "null" literal) | archivedBadgeLabel(status, null) -> solo verbo | exit-animal.test.ts "archivado SIN fecha -> solo el verbo, NUNCA null" | OK |
| R4.12/R4.15 sale del activo, sigue archivado/visible | lista filtra status=active; RPC deja deleted_at NULL | e2e (desaparece de Animales; reaparece bajo filtro Vendidos) | OK |
| Gating del boton (best-effort, espejo del authz) | canExit (active + owner-del-campo-del-animal / createdBy===userId) | e2e (owner ve el boton por rama owner); review de branches | OK |

Cada R cubierto por >=1 test concreto. Sin huecos.

## Tasks completas: SI

Las tasks del chunk C3.3 estan todas en [x]: T3.9 (servicio + logica pura) y T4.6 (ficha + pantalla de baja + modo archivada). No quedan [ ] del chunk. Las T3.x/T4.x ajenas a C3.3 siguen sin marcar (correcto, son del frontend diferido fuera de este chunk).

## CHECKPOINTS

- C1 N/A (harness ya existe).
- C2 [x] estado coherente (feature deferred, chunk de frontend bajo convencion documentada de spec 02; bitacora lo justifica).
- C3 (arquitectura) [x] solo capas previstas (screen baja.tsx, services exit-animal.ts + animals.ts); [x] sin deps nuevas; [x] sin logs de debug ni TODOs (verificado por grep); [x] no se hardcodea establishment_id.
- C4 (verificacion) [x] >=1 test por modulo con logica (25 unit + e2e); [x] e2e con backend real; [x] runner >0 tests verdes (608 client unit + 14 e2e animals).
- C5 [x] sin artefactos temporales nuevos sin trackear.
- C6 (SDD) [x] specs reconciliadas (R14.9 + design.md C3.3 + tasks.md as-built); [x] cada R con >=1 test.
- C7 (multi-tenant) N/A schema (no toca tablas/RLS); gating cliente conservador + RPC re-valida server-side. Aislamiento cross-tenant ya cubierto por T2.19 caso 1 (SEC-SPEC-01, backend, fuera de este changeset).
- C8 (offline-first) N/A: C3.3 es online-only por Gate 0 (offline real = PowerSync/C5). Guard de red explicito.

## Checklist RAFAQ-especifico

- A (multi-tenancy/RLS): N/A no crea/altera tablas ni policies. Reusa RPC exit_animal_profile (0044) ya gateado (Gate 1 PASS, SEC-SPEC-01).
- B (offline-first): N/A online-only por diseno (Gate 0). Guard de red presente.
- C (BLE): N/A.
- D (UI de campo): [x] targets >= $touchMin; [x] fuentes legibles ($5/$6/$7); [x] una decision por pantalla (paso 1 motivo, paso 2 confirmar); [x] loading visible (boton "Dando de baja..." + disabled).
- E (Edge Functions): N/A usa RPC Postgres.

### Foco del brief (1-9)

1. Cero hardcode (ADR-023 4): [x] 0 violaciones en app/app + app/src/components. Tokens + getTokenValue para iconos lucide. Unico literal numerico: paddingBottom={insets.bottom + 12} (baja.tsx:248), aritmetica runtime sobre safe-area inset, tolerada por el lint y consistente con el repo. No blocker.
2. a11y por helper: [x] buttonA11y/labelA11y en todos los Pressable/View; NUNCA accessibilityLabel crudo. ArchivedBadge usa labelA11y; ExitButton/DestructiveButton/ReasonCard usan buttonA11y.
3. Voseo es-AR: [x] "Conectate y volve", "No tenes permiso", "Vas a dar de baja", "no vas a poder reactivarlo".
4. Gating canExit: [x] CORRECTO y conservador. active + (autor exacto con createdBy!=null && ===userId, o owner del campo ACTIVO cuando el animal pertenece a ese campo). Animal de otro campo -> solo createdBy. Espeja authz del RPC. Shapes de estState/authState verificados contra los tipos reales.
5. Servicio exitAnimalProfile: [x] params EXACTOS contra 0044; opcionales -> null (RPC coalesce). classifyExitError NUNCA expone sqlerrm crudo (tests lo asertan). Online-guard por mensaje con precedencia sobre code.
6. Modo archivada: [x] archivedBadgeLabel tolera exitDate null (solo verbo, nunca "null"); active -> null; oculta Agregar evento (flag archived) y Dar de baja (canExit exige active). Resto read-only.
7. Tests: [x] cobertura real, no humo: mapeo, classifyExitError (todos los codes + precedencia red), validadores opcionales, sanitizePriceInput (regresion del truncado a 4 dig), archivedBadgeLabel. e2e ejerce el path REAL (RPC server-side).
8. Coherencia con specs: [x] R14.9/R4.14/R4.15 + context-c3.3-baja.md reconciliados con el codigo. Sin contradicciones.
9. Regresiones: [x] animals.spec.ts 14/14 verde (incl. C3.1/C3.2: timeline, madre, estado actual). Sin regresion.

## Verificacion ejecutada por el reviewer

- node scripts/check.mjs -> VERDE (typecheck + anti-hardcode 0 violaciones + 608 client unit incl. exit-animal.test.ts + backend RLS/Edge/Animal 47/Maneuvers/user_private 13/Import 25).
- playwright test animals.spec.ts -> 14/14 PASS (1.2m, backend real), incl. C3.3 baja (animals.spec.ts:496).

## Nits (no bloquean)

1. Conteo de tests inconsistente en la doc: design.md, tasks.md T3.9/T4.6 y la linea "Archivos tocados" de la bitacora dicen 29 unit, pero exit-animal.test.ts tiene 25 test() y check.mjs confirma 25 nuevos (la seccion "Resultado del check" de la bitacora si dice 25). Cosmetico: corregir 29 -> 25 antes de cerrar el done.
2. paddingBottom={insets.bottom + 12} (baja.tsx:248): literal 12 en aritmetica con el inset. Consistente con el patron pre-existente y tolerado por el lint; pureza total seria getTokenValue. No es violacion.

## Hallazgo fuera de alcance (heredado, NO de este chunk)

La bitacora reporta 2 tests rojos PRE-EXISTENTES en rodeos.spec.ts por el OnboardingImportOffer de feature 12 (commit 4e1b6d5, baseline). Verificado: rodeos.spec.ts y crear-rodeo.tsx NO estan en este changeset. Ajeno a C3.3.
