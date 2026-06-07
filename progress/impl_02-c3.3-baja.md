baseline_commit: cd2b6c88ea7fcd8f2bd7b77528e137e11bf40e33

# Implementación — Spec 02 C3.3: Baja / egreso de animal desde la ficha

> Chunk del **frontend de spec 02** (C3.3). Frontend + un servicio cliente. El backend YA existe y
> está gateado (RPC `exit_animal_profile`, migration 0044, Gate 1 PASS). NO se toca DB/migración/RLS.

## Nota de pre-condición (status `deferred`, no `in_progress`)

`feature_list.json` tiene la feature 02 en `deferred`, no `in_progress`. Procedo igual porque es la
**convención deliberada de spec 02** para sus chunks de frontend (las notes del feature lo dicen
explícitamente: C1/C2/C3.1/C3.2 se implementaron y commitearon mientras la feature estaba `deferred`;
sigue `deferred` porque PowerSync/C5 y lotes/C4 están pendientes). El espíritu de la regla dura
("no implementar sin spec aprobada") está satisfecho: spec 02 está **Aprobada** (2026-05-26), los 3
archivos de spec existen, el **Gate 0 del chunk** está cerrado y aprobado por Raf (2026-06-07,
`context-c3.3-baja.md`), R14.9 ya está reconciliado, y el backend está implementado + Gate 1 PASS.
El `deferred` acá NO es señal de "parar" (no es `pending`/`spec_ready`): es el estado multi-chunk
del feature. Lo anoto para trazabilidad; el leader cierra el `done` tras reviewer + Gate 2 + puerta.

## Plan (tasks)

- **T1** — Lógica PURA testeable: módulo `app/src/services/exit-animal.ts` con el mapa
  motivo→(status, exit_reason) + `classifyExitError` (42501/23503/network/unknown). Sin imports de
  `./supabase` (testeable bajo node:test, patrón `establishment-store.ts` / `import-write.ts`).
- **T2** — Servicio I/O `exitAnimalProfile` en `app/src/services/animals.ts` (llama `supabase.rpc`,
  usa la lógica pura de T1). Extender `fetchAnimalDetail` + `AnimalDetail` con `createdBy`,
  `exitDate`, `exitReason`.
- **T3** — UI: botón "Dar de baja" gated al fondo de la ficha (`animal/[id].tsx`) + modo archivada
  (badge bajo el hero + ocultar "Agregar evento") + pantalla corta `app/app/animal/baja.tsx`
  (paso 1 motivo, paso 2 fecha + venta) + registrar la ruta en `_layout.tsx`.
- **T4** — Tests: unit del servicio puro (`exit-animal.test.ts`) + extender e2e (`animals.spec.ts` o
  nuevo `baja.spec.ts`): crear animal → dar de baja (Venta) → desaparece de Animales + badge "Vendido".
- **T5** — Reconciliar specs (design.md sección C3.3 + tasks.md) + autorrevisión adversarial + check.mjs.

## Estado: DONE (implementer) — pendiente reviewer + Gate 2 + puerta humana

Las 5 tasks (T1-T5) completas. NO marco la feature `done` (eso es del leader).

## Archivos tocados

- `app/src/services/exit-animal.ts` — **NUEVO**. Lógica PURA (sin `./supabase`, testeable): `EXIT_REASON_MAPPINGS` + `exitReasonToStatus`; `classifyExitError`; `validateExitWeight`/`validateExitPrice`/`sanitizePriceInput`; `archivedBadgeLabel`.
- `app/src/services/exit-animal.test.ts` — **NUEVO**. 25 unit tests (node:test).
- `app/src/services/animals.ts` — `exitAnimalProfile(input)` I/O sobre `supabase.rpc('exit_animal_profile')` + `fetchAnimalDetail`/`AnimalDetail` extendidos con `createdBy`/`exitDate`/`exitReason`.
- `app/app/animal/baja.tsx` — **NUEVO**. Pantalla de baja (paso 1 motivo / paso 2 fecha + venta + destructivo).
- `app/app/animal/[id].tsx` — botón "Dar de baja" gated + `ArchivedBadge` + ocultar "Agregar evento" en archivada + `ExitButton`.
- `app/app/_layout.tsx` — registro de la ruta `animal/baja`.
- `app/e2e/animals.spec.ts` — e2e nuevo: owner da de baja (Venta) → desaparece de Animales + ficha "Vendido".
- `scripts/run-tests.mjs` — enganchada `exit-animal.test.ts` a client unit tests.
- `specs/active/02-modelo-animal/{design,tasks}.md` — reconciliación al as-built (R14.9 ya estaba reconciliado por el leader).

## Mapa requisito → archivo:test

| Requisito | Implementación | Test que lo cubre |
|---|---|---|
| R4.14 (baja vía RPC, authz owner\|autor con rol activo) | `exitAnimalProfile` (animals.ts) → RPC `exit_animal_profile`; gating `canExit` (ficha) | `exit-animal.test.ts` (classifyExitError 42501); e2e `animals.spec.ts` (owner da de baja) |
| R4.14 — copy de authz (42501) | `classifyExitError` → "No tenés permiso…" | `exit-animal.test.ts` "42501 → unknown con copy accionable, NO el message crudo" |
| R4.14 — animal no disponible (23503) | `classifyExitError` → "ya no está disponible" | `exit-animal.test.ts` "23503 → ya no está disponible" |
| R14.9 — 3 motivos → (status, exit_reason) | `exitReasonToStatus` / `EXIT_REASON_MAPPINGS` | `exit-animal.test.ts` "Venta/Muerte/Transferencia → …" + "MVP expone EXACTAMENTE 3 motivos" |
| R14.9 — datos de venta opcionales SOLO en Venta | `capturesSaleData` + `Step2Confirm` (showSaleData) + `validateExit{Weight,Price}` | `exit-animal.test.ts` "SOLO Venta captura peso+precio" + validadores opcionales |
| R14.9 — no reversible (copy) | `Step2Confirm` aviso "no se puede deshacer" | e2e (la baja no se revierte; ficha queda archivada) |
| R14.9 — online-only (sin red → error, no marca) | `classifyExitError` network + `OFFLINE_COPY`; el RPC no corre | `exit-animal.test.ts` "error de red → kind network" |
| R14.9 — modo archivada (badge + ocultar acciones) | `ArchivedBadge` + `archivedBadgeLabel` + ocultar Agregar/Dar de baja | `exit-animal.test.ts` "badge: sold/dead/transferred + null"; e2e (badge "Vendido", botones ausentes) |
| R4.12/R4.15 — sale del activo, sigue archivado/visible | la lista filtra `status='active'`; el RPC deja `deleted_at` NULL | e2e (desaparece de Animales; aparece bajo filtro "Vendidos") |
| Gating del botón (best-effort, espejo del authz) | `canExit` (status active + owner del campo activo \| createdBy===userId) | e2e (owner ve el botón); review manual de los branches |

## Decisiones

- **D-impl-1 — lógica pura separada** (`exit-animal.ts`): el servicio I/O importa `./supabase` (expo-secure-store) que no carga bajo `node:test`. Separé TODO lo testeable (mapeo, errores, validadores, badge) a un módulo puro, patrón ya usado (`establishment-store.ts`/`import-write.ts`). El servicio I/O queda mínimo (un `supabase.rpc` + classify).
- **D-impl-2 — kind del AppError**: NO inventé un kind nuevo para 42501. El `AppError.kind` es compartido por todos los services; el copy específico viaja en `message` (que es lo que la UI renderiza). 42501/23503/23514 → `unknown` con copy es-AR; network → `network`. NUNCA se expone el `sqlerrm` crudo.
- **D-impl-3 — pantalla corta vs sheet de Tamagui**: elegí pantalla corta `animal/baja.tsx` con `router.push` (no `@tamagui/sheet`). Es el patrón MÁS consistente del repo (igual que `agregar-evento.tsx`); no hay un overlay/sheet reutilizado en las pantallas de campo. Anda igual en web y native sin Modal/Portal específico.
- **D-impl-4 — `sanitizePriceInput` propio** (NO reusar `sanitizeWeightInput`): el sanitizer de peso acota la parte entera a 4 díg (ningún bovino ≥10000 kg). Un PRECIO en AR es de 6-7 cifras → reusarlo truncaría 250000 → 2500 (bug). Creé un sanitizer sin ese cap (tope de largo total defensivo).
- **D-impl-5 — gating conservador multi-tenant**: el owner-flag del `EstablishmentContext` es del campo ACTIVO. Si el animal es de OTRO campo (`establishmentId !== activo`), el flag no aplica → habilito solo por `createdBy === userId`. El RPC re-valida con `has_role_in` del campo del animal igual (barrera real).
- **Lo que dejé afuera** (fuera de alcance del chunk, ver context): los 3 motivos extra (`culling/theft/other` → Facundo); reactivar/deshacer una baja desde la UI; transferencia con re-parenting (feature 11); offline real (PowerSync/C5); baja masiva (feature 10).
- **Pre-condición**: la feature está `deferred` (no `in_progress`) — convención de spec 02 para chunks de frontend; ver nota al inicio de este archivo. Spec aprobada + Gate 0 del chunk cerrado + backend gateado → procedí.

## Autorrevisión adversarial

Pasé como revisor hostil sobre mi propio código. Qué busqué y qué encontré:

1. **Gating que muestre el botón cuando no debe** — revisé `canExit`: requiere `status==='active'` + (autor exacto con ambos no-null, o owner del campo activo del animal). Un seeded animal tiene `createdBy=null` → la rama autor NUNCA matchea con null (chequeo explícito `createdBy != null`). OK. Verificado en e2e (el owner ve el botón por la rama owner). No vi forma de mostrarlo a quien no podría; y aunque se mostrara, el RPC es la barrera real (42501).
2. **Precio truncado (BUG ENCONTRADO Y ARREGLADO)** — al principio el campo precio usaba `sanitizeWeightInput`, que acota la parte entera a 4 díg → un precio de 250000 quedaba 2500. Creé `sanitizePriceInput` (sin ese cap) + 2 tests. Sin esto el dato de venta para analytics habría sido basura.
3. **Sheet que no se cierre tras éxito** — el `onConfirm` hace `backOr(router, backFallback)` tras OK → vuelve a la ficha, que recarga por `useFocusEffect` y pasa a modo archivada. Verificado en e2e (badge "Vendido" aparece in-situ).
4. **Race de doble-tap** — `busyRef.current = true` se setea ANTES del primer `await` (sincrónico tras validar), y el botón se deshabilita con `submitting`. Un 2do tap entra por `if (busyRef.current) return`. OK (mismo patrón que `agregar-evento.tsx`).
5. **Badge con fecha null** — `archivedBadgeLabel(status, null)` → solo el verbo, NUNCA "el null". Test explícito ("archivado SIN fecha → solo el verbo, NUNCA null").
6. **RPC devuelve un error no mapeado** — `classifyExitError` cae a `unknown` con copy genérico; NUNCA filtra el message crudo de Postgres. Test ("error desconocido → unknown, nunca crudo").
7. **Datos de venta stale al cambiar de motivo** — si el operario elige Venta, tipea peso, vuelve a paso 1 y elige Muerte: el `onConfirm` solo valida+envía peso/precio dentro de `if (mapping.capturesSaleData)`; para Muerte manda `null`/`null`. El peso stale NO viaja. Verificado en el código.
8. **Copy no-voseo / hardcode** — revisé todo el copy (es-AR voseo: "Conectate y volvé", "No tenés permiso", "Vas a dar de baja"). `check-hardcode.mjs` = 0 violaciones (la pantalla está bajo `app/app/**`, cubierta por el lint). a11y por helper (`buttonA11y`/`labelA11y`, nunca `accessibilityLabel` crudo en Pressables RN-web).
9. **Modo archivada incompleto** — confirmé que se ocultan AMBOS: "Agregar evento" (flag `archived` en HistorySection) y "Dar de baja" (gating `status==='active'`), y el resto de la ficha sigue read-only. e2e asserta `toHaveCount(0)` para los dos botones.
10. **Test que pasa por la razón equivocada** — el e2e ejerce el path REAL (RPC server-side, no un mock): crea el animal, lo da de baja, y verifica el efecto observable (desaparece de Animales + badge + visible bajo filtro Vendidos). El reject de authz lo cubren los tests del classify + el RPC ya gateado (Gate 1 PASS, suite animal T2.19).

Todo lo encontrado (hallazgo #2) se arregló y re-verificó. check.mjs verde tras el fix.

## Resultado del check

- **`node scripts/check.mjs` VERDE end-to-end**: typecheck cliente OK + anti-hardcode 0 violaciones + **608 client unit tests** (de los cuales **25 nuevos** en `exit-animal.test.ts`) + suites backend (RLS/Edge/Animal 47 / Maneuvers / user_private / import 25) sin regresión.
- **e2e Playwright VERDE en mi alcance**: `animals.spec.ts` (14 tests, incl. el nuevo C3.3 baja) + `events.spec.ts` (11) = **25/25** sobre el export estático de prod. Sin regresión en la ficha/lista.
- typecheck `tsc --noEmit` limpio.

## Hallazgo fuera de alcance (NO lo toqué — feature 12)

`rodeos.spec.ts` tiene **2 tests rojos PRE-EXISTENTES** ajenos a este chunk: "BUG 1 — crear rodeo desde el empty-state aterriza en home…" y "crear rodeo con un toggle destildado…". Ambos fallan porque tras crear el PRIMER rodeo aparece el `OnboardingImportOffer` de **feature 12** ("¡Listo! Tu rodeo ya está creado" + "Importar mi rodeo existente" / "Más tarde, ir al inicio"), y `rodeos.spec.ts` espera aterrizar directo en la home (`¡Hola 👋`) sin descartar esa oferta intermedia.

- Verificado PRE-EXISTENTE: `app/app/crear-rodeo.tsx` (que agrega la oferta, commit `4e1b6d5` de feature 12) y `app/e2e/rodeos.spec.ts` NO están en mi changeset; la oferta ya estaba en el baseline `cd2b6c8`. Mi trabajo de C3.3 no toca rodeos/crear-rodeo.
- **NO lo arreglé**: feature 12 es "otro frente" que el brief me dijo explícitamente que NO tocara. Lo dejo para el leader (actualizar `rodeos.spec.ts` para descartar el `OnboardingImportOffer`, o ajustar el flujo). Lo reporto acá para que no se pierda.
