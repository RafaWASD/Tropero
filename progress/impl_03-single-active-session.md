# impl_03-single-active-session — enforzar ≤1 sesión activa por establishment (R10.6)

baseline_commit: a9eff93e7836edb47bb2216d02b4b08cc23c5947

Feature `03-modo-maniobras` (in_progress). Bug funcional reportado por Raf, diagnosticado por el leader.
Frontend + service/builder; SIN schema (Gate 1 N/A). Offline-first (todos los writes locales).

## BUG (confirmado en la DB)
R10.6 dice "una sola sesión activa por dispositivo a la vez", pero **nada lo enforza**. Cada "Arrancar
jornada" hace `createSession` (INSERT local de una `session` `active`) SIN cerrar las anteriores; y "Salir
sin terminar" del `ExitJornadaSheet` deja la sesión `active`. Resultado: se ACUMULAN sesiones `active`
(en la DB de prueba: 4 activas + 2 cerradas). Síntoma de Raf: toca "Terminar jornada" (que SÍ cierra la
actual — `closeSession` funciona), pero `getActiveSession` (landing, `ORDER BY started_at DESC LIMIT 1`)
devuelve la SIGUIENTE activa huérfana → la tarjeta "Retomar la jornada de hoy" sigue apareciendo → parece
"que no terminó". `NuevaJornadaConfirmSheet` "Empezar una nueva" cerraba SOLO UNA (`closeSession(open.id)`,
la más reciente) → no resuelve las huérfanas previas.

## FIX — invariante ≤1 sesión activa por establishment
Cuando se ARRANCA una jornada nueva, cerrar TODAS las activas del establishment ANTES de insertar la nueva.

### PUNTO DE ENFORCEMENT (decisión documentada)
**Elegido: dentro de `createSession`** (cierra todas las activas del establishment ANTES del INSERT).
Razón: es el ÚNICO punto por el que entra cualquier sesión nueva del flujo de maniobra (wizard "Arrancar"
en `jornada.tsx` `onArrancar` — y es el único call-site de prod de `createSession`, verificado por grep en
`app/app` + `app/src`). Poniéndolo acá, el invariante "después de cualquier `createSession` queda a lo sumo
1 activa (la nueva)" vale **sin importar por dónde se llegó** — robusto ante futuros call-sites (M4
"Empezar una nueva", presets, etc.). Ambos writes (close-all + insert) son LOCALES/offline (CRUD plano,
spec 15). Alternativa descartada: hacerlo en el handler "Arrancar" de `jornada.tsx` → frágil (habría que
cubrir cada call-site futuro a mano).

Orden offline: el close-all (UPDATE de las activas) se encola ANTES del INSERT de la nueva (FIFO de la
upload queue) → al subir, primero cierran las viejas, después aparece la nueva. La nueva se inserta
`active`, así que tras `createSession` queda EXACTAMENTE 1 activa.

## Plan (tasks)
- [x] T1 — `local-reads.ts`: builder `buildCloseActiveSessionsUpdate(establishmentId, endedAt)` + 2 tests node:sqlite.
- [x] T2 — `sessions.ts`: service `closeActiveSessions(establishmentId)` + ENFORCEMENT en `createSession`
      (close-all ANTES del INSERT, fail-closed).
- [x] T3 — `maniobra.tsx`: `onConfirmStartNew` simplificado (sin `closeSession` explícito; un solo camino de
      cierre = createSession). Import `closeSession` quitado del landing.
- [x] T4 — e2e `maniobra-single-active.spec.ts` (2 activas sembradas → arrancar nueva → oráculo SERVER count=1
      la nueva → Terminar → 0) + helpers admin `seedActiveSession`/`waitForServerActiveSessionCount`/
      `readServerActiveSessionIds`. + `maniobra-reanudar.spec.ts` (b) actualizado.
- [x] T5 — check + e2e maniobras; reconciliados design.md §6.bis.12 + requirements.md R10.6 + tasks.md M4.1.1.

## Trazabilidad R→test
- **R10.6** (≤1 sesión activa por establishment, enforcement):
  - `app/src/services/powersync/maneuver-reads.test.ts` :: `buildCloseActiveSessionsUpdate: cierra TODAS las
    activas del establishment (no solo la más reciente)` — el close-all cierra el set entero.
  - `app/src/services/powersync/maneuver-reads.test.ts` :: `buildCloseActiveSessionsUpdate: NO toca otros
    establishments, ni sesiones cerradas, ni soft-deleted` — multi-tenant + scoping + idempotencia.
  - `app/e2e/maniobra-single-active.spec.ts` :: oráculo SERVER `waitForServerActiveSessionCount(est,1)` +
    `readServerActiveSessionIds[0] ≠ sembradas` tras arrancar con 2 activas → EXACTAMENTE 1 (la nueva);
    luego "Terminar" → `waitForServerActiveSessionCount(est,0)` → el landing ya NO ofrece retomar.
  - `app/e2e/maniobra-reanudar.spec.ts` (b) :: "Empezar una nueva" → arrancar → `waitForServerSessionClosed`
    (la vieja cerrada por createSession) + `waitForServerActiveSessionCount(est,1)` (la nueva, distinta).

## Autorrevisión adversarial
Pasada hostil sobre el propio trabajo. Busqué:
- **Desviaciones del spec**: R10.6 era documentado pero no enforzado a nivel de datos → el fix lo cierra; el
  *qué* del EARS no cambia (solo se reconcilia el as-built). OK.
- **Punto de enforcement robusto**: verifiqué por grep (`app/app` + `app/src`) que el ÚNICO call-site de prod
  de `createSession` es `jornada.tsx onArrancar` → poner el close-all dentro de `createSession` cubre TODOS
  los caminos (presente y futuro: M4 "Empezar una nueva", presets). No quedó ningún call-site sin cubrir.
- **Fail-closed**: si `closeActiveSessions` falla (solo por error de `db.execute` local), `createSession`
  retorna error y NO inserta → no deja la nueva conviviendo con activas viejas. Verificado en el código.
- **Multi-tenant**: `buildCloseActiveSessionsUpdate` scopea por `establishment_id` (del contexto, NUNCA
  hardcodeado) + `status='active'` + `deleted_at IS NULL`. Test explícito de que est-B queda intacto. La RLS
  `sessions_update`=has_role_in re-valida al subir. Sin fuga cross-tenant.
- **Idempotencia / vacío**: sin activas, el UPDATE no toca filas → no-op → ok. No rompe el primer arranque.
- **Edge "Salir sin terminar"**: deja 1 activa (no llama createSession ni close-all) → resumible; arrancar
  otra la cierra → queda 1. Coherente; cubierto por reanudar (j) [regresión] + single-active.
- **Doble-close / copy**: cacé que el `closeSession(open.id)` explícito del sheet quedaba REDUNDANTE → lo
  saqué (un solo camino de cierre). Verifiqué que el sheet unmonta (`setShowNuevaConfirm(false)` ANTES del
  push) → el loading "Cerrando la abierta…" no llega a renderizarse (no hay flash misleading). El import
  `closeSession` quedó sin uso en el landing → lo quité (typecheck lo habría cazado igual).
- **Test que pasa por la razón correcta**: el e2e single-active siembra las 2 activas server-side (el cliente
  post-fix NO puede acumular) y usa un ORÁCULO SERVER de count (no la UI) → prueba el path real de cierre
  offline→sync→server, no solo el render. Espera el sync local (proxy: tarjeta de retomar) ANTES de arrancar,
  para que el close-all tenga ambas filas locales que cerrar (si no, el test sería verde-falso).
Nada quedó abierto; todo lo encontrado se cerró antes de reportar.

## Reconciliación de specs
El as-built quedó alineado con `requirements/design/tasks`:
- `requirements.md` R10.6 — nota de reconciliación as-built (enforcement ≤1 activa; el *qué* del EARS no cambia).
- `design.md` §6.bis.12 — NUEVA subsección as-built (bug, fix, punto de enforcement documentado, fail-closed,
  orden offline, simplificación del sheet, tests). §6.bis.11 sin cambios (la UI de retomar/confirmar).
- `tasks.md` M4.1.1 — NUEVA task `[x]` (builder + service + enforcement + simplificación + tests/helpers).
Nada en las specs contradice el código.

## Resultado de tests
- typecheck client: **PASS** (tsc --noEmit, 0 errores).
- unit `maneuver-reads.test.ts`: **21/21** (incl. los 2 nuevos de `buildCloseActiveSessionsUpdate`).
- e2e `maniobra-single-active.spec.ts`: **1/1**. `maniobra-reanudar.spec.ts`: **4/4** (incl. (b) actualizado).
- e2e regresión `maniobra-identify.spec.ts` **18/18** + `maniobra-config-sheet-race.spec.ts` **3/3** (incl.
  el race del NuevaJornadaConfirmSheet y los exit-jornada i/j/k/l/m). Sin regresión.
- `node scripts/check.mjs`: typecheck client + client unit (143/143, incl. los nuevos) **VERDES**; ROJO SOLO
  en la **Animal suite (spec 02 backend)** por el flake conocido `duplicate key value violates unique
  constraint "animals_tag_unique"` (terminales paralelas seedeando animales contra la DB compartida — memoria
  `reference_check_red_rate_limit`). NO es regresión: este fix es frontend + service/builder, SIN schema, sin
  tocar la animal suite. Re-corrida aislada de las suites de cliente tocadas: 143/143.
