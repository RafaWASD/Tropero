# Review — Fix showstopper firstSync-gate (15-powersync, Run T11)

**Fecha**: 2026-06-09
**Reviewer**: reviewer (subagente)
**Scope**: fix client-side puro del bug "la app aterriza en ONBOARDING / listas vacías" (gate + lecturas resolvían el SQLite local one-shot ANTES del first-sync, sin re-evaluar).
**Gate de seguridad**: N/A (NO toca streams/migraciones/connector/outbox/overlay/schema/RLS/EF — 100% cliente, confirmado por inspección de los 9 archivos).

## Veredicto: APPROVED

---

## Trazabilidad R ↔ test

El fix NO crea R nuevas: reconcilia el comportamiento correcto de R5.4 (consumo de la degradación "sincronizando") + R11.2 (no romper flujos gateados). Cobertura:

- **R5.4 (degradación "aún no sincronizó")** ↔ `first-sync.test.ts` 8/8 (cached/synced/timeout/pending con db fake) + `local-query` ya degradaba vacío+!hasSynced a `network` (T3). VERDE local confirmado (8/8).
- **R5.4 consumo correcto (el fix)** ↔ E2E `animals.spec.ts:386` "animal EXISTENTE → aparece en la lista" = ORÁCULO del bug: ROJO en baseline → VERDE con el fix (per current.md + reconciliación design §5.1) + assert anti-flash `animals.spec.ts:400` (`'Crear mi primer campo'` toHaveCount(0) tras home).
- **R11.2 (onboarding legítimo intacto)** ↔ E2E `auth.spec.ts:19` "usuario pre-confirmado y SIN campos aterriza en onboarding" (4/4 verde). Cadena verificada en código: post-first-sync `loadMemberships` → `runLocalQuery` con `hasSynced:true` + vacío → `{ok:true, value:[]}` → `applyMemberships([])` → `resolveState({available:[]})` → `no_establishments` → onboarding. CORRECTO.
- **R11.2 (≥2 campos → Mis campos → home)** ↔ `establishments.spec.ts:68` verde (per reconciliación).

## Tasks completas: SÍ

T11 marcada `[x]` en `tasks.md:132` con alcance completo (first-sync.ts + EstablishmentContext + RodeoContext + _layout + animales/index). Sin tasks `[ ]` introducidas por este fix.

## CHECKPOINTS aplicables

- [x] C2 — coherente (15-powersync sigue in_progress; feature multi-run, no se marca done — correcto).
- [x] C3 — arquitectura: solo capas previstas (services/powersync, contexts, screens). Sin deps nuevas. Sin hardcode de establishment_id. Archivos del fix SIN console.log (verificado).
- [x] C4 — verificación real: first-sync.test.ts 8/8 + check.mjs verde (25 import + suites) + E2E oráculo verde.
- [x] C8 — offline-first: `waitForUsableSync` devuelve 'cached' AL INSTANTE si hasSynced (offline/reload, NO cuelga). LWW vigente.
- [ ] C5 — sesión sin cerrar (feature en curso, sin commit aún — esperado; lo maneja el leader).

## Checklist RAFAQ-específico

- **A (multi-tenancy/RLS)**: N/A — no toca tablas/RLS/policies.
- **B (offline-first)**: APLICA.
  - [x] Funciona offline: `waitForUsableSync` → 'cached' instantáneo con hasSynced restaurado de IndexedDB (NO entra a waitForFirstSync sin red → NO cuelga). Verificado en `first-sync.ts:83-84` + test `:52`.
  - [x] Sync bucket scoping: intacto (no se toca el sync set).
  - [x] Conflict resolution: LWW vigente, no alterado.
  - [x] No requests síncronos a Supabase desde pantalla: los reads van a SQLite local (services). animales/index usan `useStatus()` (local).
- **C (BLE)**: N/A.
- **D (UI de campo)**: APLICA parcial (animales.tsx + index.tsx).
  - [x] Estado de loading visible: el RootGate mantiene el splash hasta resolver (no se queda esperando sin feedback); animales muestra "Cargando…".
  - [x] Resto (botones/fuente/una-decisión): sin cambios — pantallas pre-existentes ya gateadas en C2/C1.
- **E (Edge Functions)**: N/A.

## Verificaciones puntuales (foco del brief)

1. **Offline-launch NO cuelga**: CONFIRMADO. `waitForUsableSync` (`first-sync.ts:83-84`) → 'cached' antes de tocar `waitForFirstSync` cuando hasSynced. No hay camino donde offline espere un sync que no llega.
2. **Onboarding LEGÍTIMO post-first-sync**: CONFIRMADO. Cadena loadMemberships→runLocalQuery(hasSynced:true,vacío)→ok:[]→resolveState→no_establishments. `applyMembershipsResult:158-160` deja pasar ok:true directo a applyMemberships.
3. **Listener sin loop / sin falso active_lost**: CONFIRMADO. `EstablishmentContext:284-293` trackea `lastHasSynced` (var local) y solo refresca en la transición false→true UNA vez; no se resetea a false. Semilla con el estado actual (`:284`) evita refresh redundante en 'cached'. RodeoContext (`:157-164`) idéntico, acotado a `isWaitingRef`. El refresh del listener NO pasa preferredId → no fuerza active_lost (detectActiveLost solo dispara si el currentId desaparece del set, que el refresh-que-solo-agrega no provoca).
4. **refreshEstablishments no regresa a onboarding en carrera**: CONFIRMADO. La regla `network && isFirstSyncPending()` vive en `applyMembershipsResult` (`:162-168`), compartida por bootstrap + refreshEstablishments (`:188`) + listener (`:290` → refreshEstablishments). Si ya había estado válido (active/choosing), un network post-sync lo PRESERVA (`:172` solo cae a no_establishments desde loading).
5. **Logout / switchEstablishment intactos**: CONFIRMADO. Bootstrap resetea todo al perder userId (`:228-240`). El efecto del listener hace early-return `if(!userId) return` y su cleanup (`dispose`) corre al cambiar userId → no queda listener de otro usuario. switchEstablishment (`:191-210`) NO toca el listener ni dispara refresh (resuelve sobre availableRef sincrónico).
6. **RodeoContext no queda colgado**: CONFIRMADO. Listener `:154-168` re-corre `load` en la transición false→true si `isWaitingRef` (loading). Cierra el gap "est resuelve pero rodeo colgado".
7. **animales.tsx no loopea**: CONFIRMADO. Re-query por `lastSyncedMs` (primitivo ms, estable entre syncs, `:90`); guard `if(lastSyncedMs===0) return` (`:166`); `listSeq` ref descarta cargas pisadas (`:139`); useFocusEffect coexiste como red de seguridad. Mismo patrón en index.tsx (`:420-424`).
8. **first-sync.ts SDK lazy**: CONFIRMADO. `require('./database')` dentro de `resolveDb` (`:27-28`), nunca se evalúa bajo test (todos inyectan db). 8/8 unit verdes corriendo el archivo directo.
9. **Reconciliación de specs**: CONFIRMADO. design §5.1 (bloque as-built `design.md:715-722`), requirements R5.4 (`requirements.md:125`), tasks T11 (`tasks.md:132-137`). El as-built coincide con la reconciliación — sin divergencia.

## Regresiones a flujos críticos

NINGUNA detectada en logout / switch / onboarding-legítimo / offline-launch. Los 4 son los focos de riesgo del gate y todos quedan intactos (ver puntos 1/2/5 arriba).

## Residuales pre-existentes (NO de este fix — fuera de scope, correctamente backlogueados)

`docs/backlog.md:26-29` (entrada 2026-06-09):
- `animals.spec.ts:52` (stepper post-alta-offline, race overlay-clear) — write-side T6.
- `animals.spec.ts:500` (overlay de exit sin exit_date) — gap del overlay T6.
- `establishments.spec.ts:29` (crear-campo lee local antes del sync-down) — swap T3 incremental, DEFERIDO explícitamente.
Causa raíz correctamente atribuida al write-side/overlay (T6) y al swap T3 incremental, NO al fix de gate/lectura. Confirmado NO bloqueantes.

## Nota menor (deuda ajena, NO de este fix)

`provider.tsx:41-94` tiene `console.log` de diagnóstico temporal (T3, conteos COUNT(*) + trazas de connect). NO es parte de este fix (provider.tsx no se tocó). Recomendación: limpiar antes del commit final de la feature. NO bloquea este fix.

## Listo para commit: SÍ

El fix está listo. check.mjs verde, first-sync 8/8, oráculo verde, reconciliación completa, sin regresiones a los flujos críticos del gate. El commit lo dispara el leader/Raf (feature multi-run, no se cierra acá).
