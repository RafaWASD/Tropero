# Review — 03-single-active-session (enforcement <=1 sesion activa por establishment, R10.6)

Reviewer: reviewer (RAFAQ) - Fecha: 2026-06-16
Scope: bugfix frontend + service/builder (SIN schema/DB). Feature 03-modo-maniobras (in_progress).
Baseline: a9eff93e7836edb47bb2216d02b4b08cc23c5947

## Veredicto: CHANGES_REQUESTED

El CODIGO del fix es correcto, tenant-safe, offline-first y bien testeado. Lo que bloquea es RECONCILIACION
DE SPECS: la documentacion previa de M4-reanudacion quedo SIN actualizar y describe el comportamiento VIEJO
de onConfirmStartNew (cerraba con closeSession del open.id) que ESTE fix elimino. Tres lugares de specs
mienten sobre el as-built y contradicen al propio design 6.bis.12 (regla dura de reconciliacion codigo a spec).

---

## Trazabilidad R <-> test (R10.6, enforcement <=1 activa)

- maneuver-reads.test.ts:139 :: buildCloseActiveSessionsUpdate cierra TODAS las activas del establishment
  (no solo la mas reciente) -> cierra el set entero. PASS (21/21).
- maneuver-reads.test.ts:158 :: buildCloseActiveSessionsUpdate NO toca otros establishments, ni cerradas,
  ni soft-deleted -> multi-tenant (est-B intacto) + scoping (status=active) + idempotencia (no pisa el
  ended_at de una cerrada) + deleted_at IS NULL. PASS.
- e2e maniobra-single-active.spec.ts:68 :: siembra 2 activas server-side -> arranca nueva desde el wizard
  -> oraculo SERVER waitForServerActiveSessionCount=1 + readServerActiveSessionIds[0] != las 2 sembradas
  -> Terminar -> count=0 -> la tarjeta Retomar desaparece. Path real offline -> sync -> server.
- e2e maniobra-reanudar.spec.ts:112 (b) :: Empezar una nueva -> wizard -> al ARRANCAR createSession cierra
  la vieja (waitForServerSessionClosed) + queda EXACTAMENTE 1 activa nueva. Cierre via createSession, no
  via un closeSession del sheet.

Cobertura completa. Cada asercion del invariante tiene test concreto.

## Verificacion del invariante

1. Correctitud: OK. createSession (sessions.ts:128-159) llama closeActiveSessions ANTES del INSERT; si
   falla retorna ok:false SIN insertar (fail-closed real, lineas 130-131). El builder scopea por
   establishment_id + status=active + deleted_at IS NULL (local-reads.ts:1977-1984): NO toca otro
   establishment, ni cerradas, ni borradas. Tras createSession queda EXACTAMENTE 1 activa, la nueva.
2. Tenant-safety: OK. establishment_id viene del input (contexto activo), nunca hardcodeado. La stream
   PowerSync ya scopea el SQLite local; la RLS sessions_update=has_role_in re-valida el close-all al subir.
   Sin fuga cross-tenant.
3. Sin regresion: OK. onConfirmStartNew (maniobra.tsx:127-131) navega al wizard sin doble-close; import de
   closeSession quitado del landing. Salir sin terminar deja 1 activa resumible; getActiveSession ve <=1.
   e2e c/d cubren camino directo + retomar. Unico call-site de prod de createSession = jornada.tsx:261.
4. Offline-first: OK. closeActiveSessions + createSession son writes locales. Orden correcto: close-all
   encolado ANTES del INSERT (FIFO -> al subir cierran las viejas, despues aparece la nueva).
5. Tests: node scripts/check.mjs -> typecheck client OK + client unit OK (incl. maneuver-reads 21/21). ROJO
   SOLO en la animal suite (spec 02 backend) por el flake conocido animals_tag_unique (terminales
   paralelas seedeando contra la DB compartida - memoria reference_check_red_rate_limit). NO es regresion:
   este fix es frontend + service/builder, SIN schema, sin tocar la animal suite.

## Tasks completas: si (para el scope de este fix)

- M4.1.1 [x] - target del review. Bien documentada y cubierta.
- M4.1 [~] parcial con justificacion documentada (R8.4 preview de transicion offline fuera de este chunk). OK.
- M4.2 [ ] fuera de scope (R10.8 surfacing de rechazos de sync), documentado como fuera de scope. OK.

## CHECKPOINTS

- [x] C2 - una sola feature in_progress (03).
- [x] C3 - capas previstas; sin hardcode de establishment_id; sin TODOs ni logs sueltos en el diff.
- [x] C4 - >=1 test por modulo con logica; fixtures reales (node:sqlite + oraculo server service_role).
- [x] C6 - R10.6 cubierto por >=1 test. PERO la reconciliacion codigo a spec falla (ver Cambios requeridos)
  -> el sub-checkbox de "specs al dia" NO se cumple.
- [x] C7 - multi-tenant: test cross-tenant (est-B intacto); establishment_id por param; RLS re-valida.
- [x] C8 - offline-first: writes locales, orden close-all antes del insert correcto; LWW por default.
- [ ] C5 - la sesion NO cierra bien mientras las specs queden contradictorias (regla de reconciliacion).

## Checklist RAFAQ-especifico

- A (RLS / multi-tenancy): N/A schema (no hay tabla nueva ni policy nueva). El aspecto multi-tenant del
  UPDATE local se cubre en C7 (test cross-tenant + scoping por establishment_id). RLS server preexistente.
- B (offline-first): aplica.
  - [x] Funciona offline (closeActiveSessions + createSession son writes locales).
  - [x] Bucket correcto: sessions ya sincroniza scoped por establishment (preexistente).
  - [x] Conflict resolution: LWW explicito (default); el close-all es un UPDATE de status idempotente.
  - [x] No hace requests sincronos a Supabase desde la pantalla - usa el service que toca SQLite local.
- C (BLE): N/A - el fix no toca el listener ni el overlay BLE.
- D (UI de campo): aplica parcial (toca el landing/sheet de maniobra).
  - [x] El cambio NO degrada targets ni fuentes existentes (onConfirmStartNew solo simplifica el handler).
  - [x] Una decision por pantalla / loading visible: el guard de carrera preexiste y se conserva.
- E (Edge Functions): N/A - el fix no toca Edge Functions.

---

## Cambios requeridos (reconciliacion de specs - codigo a spec)

El design 6.bis.12 + la nota R10.6 de la linea 283 (requirements) + la task M4.1.1 describen el fix
CORRECTAMENTE. El problema es que la documentacion PREVIA de M4-reanudacion NO se reconcilio y sigue
afirmando el flujo viejo: onConfirmStartNew cerraba la abierta con un closeSession del open.id, que este
fix elimino. Eso contradice el as-built (maniobra.tsx:127-131: onConfirmStartNew solo hace
setShowNuevaConfirm(false) + router.push + return true, SIN closeSession ni setOpenSession null) y se
contradice con design 6.bis.12.

1. specs/active/03-modo-maniobras/requirements.md:284 (nota as-built R10.6, M4-reanudacion). Afirma:
   "Empezar una nueva (primaria) -> closeSession(open.id) (R10.7) -> al OK navega al wizard; fail-closed
   si ok:false (banner terracota es-AR + reintenta, NO navega)". FALSO as-built: el cierre lo hace
   createSession al arrancar, NO el sheet. Reconciliar a: "Empezar una nueva" navega al wizard; el cierre
   de la abierta lo hace createSession al ARRANCAR la nueva (un solo camino de cierre; ver la nota de
   enforcement de R10.6 y design 6.bis.12).

2. specs/active/03-modo-maniobras/design.md:893 (seccion 6.bis.11). Afirma: "onConfirmStartNew (accion
   Empezar una nueva): closeSession(open.id) -> al OK setOpenSession(null) + router.push. Fail-closed: si
   ok:false devuelve false". FALSO as-built. Y la linea 894 repite: "Empezar una nueva (primaria,
   onStartNew->closeSession, fail-closed)". Esto contradice al 6.bis.12 (linea 907) del MISMO archivo, que
   dice que onConfirmStartNew YA NO llama closeSession. Reconciliar 6.bis.11 al as-built (solo navega) o
   anotar explicitamente "(superseded por 6.bis.12)".

3. specs/active/03-modo-maniobras/tasks.md:344-345 (task M4.1, descripcion + aceptacion). Dicen: "Empezar
   una nueva -> closeSession [oraculo server] + wizard". FALSO as-built. Reconciliar a: cierre via
   createSession al arrancar (igual que ya quedo redactado en M4.1.1, linea 352).

Nota (no bloqueante por si sola, pero conviene en la misma pasada): el componente
NuevaJornadaConfirmSheet.tsx (codigo, NO spec) conserva COMENTARIOS obsoletos que describen el flujo viejo
onStartNew->closeSession (lineas 10-13 del header, docstring de onStartNew lineas 47-49, y lineas 100, 102,
179). Esos comentarios ahora mienten sobre el comportamiento (convenciones, seccion Comentarios:
"comportamiento que sorprenderia al lector"). El componente sigue siendo agnostico (solo invoca el callback
onStartNew que le pasa el caller), por eso no rompe nada; pero la doc del componente deberia dejar de
contradecir al caller.

## Re-aprobacion

Una vez reconciliados los 3 puntos de specs (y deseablemente los comentarios del NuevaJornadaConfirmSheet),
el fix queda APPROVED: el codigo, la trazabilidad, el invariante, la tenant-safety, el offline-first y los
tests ya estan correctos y no requieren cambios.
