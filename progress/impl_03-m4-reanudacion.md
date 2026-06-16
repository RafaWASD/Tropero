baseline_commit: 101d898f3f064e86f73cdc19226b0197ba86ba8c

# impl 03 — M4 REANUDACIÓN de jornada (R10.5/R10.6) — landing ofrece retomar la jornada abierta

Feature `03-modo-maniobras` (in_progress). Chunk **M4 — reanudación** (parte de R10.5/R10.6).
Frontend puro (backend de sesiones DONE: 0050-0057; servicios `getActiveSession`/`closeSession` ya
existen, M1). Gate 1 N/A; reviewer + Gate 2 después. NO marco done.

⚠️ FUERA DE SCOPE: R10.8 (surfacing de rechazos de sync) — NO se implementa acá.

## GAP que cierra
El landing `app/app/maniobra.tsx` ofrece "Nueva jornada" + arrancar desde preset, pero NO chequea si
hay una jornada ABIERTA (`getActiveSession`) → no ofrece retomarla. Por eso "Salir sin terminar" del
`ExitJornadaSheet` (M2.1-exit-hero) deja la sesión `active` pero el landing no tiene a dónde volver.

## Plan (tasks)
- [x] T1 — `maniobra.tsx`: en el `useFocusEffect`, además de `fetchPresets`, chequear `getActiveSession`
      (Promise.all). Estado nuevo `openSession: Session | null`. Nombre del rodeo via RodeoContext
      (`rodeoState.available.find(r.id === openSession.rodeoId)?.name`). + helper PURO
      `app/src/utils/maniobra-resume.ts` (resumeManeuversSummary / resumeAnimalCountLabel /
      resumeStartedDateLabel — fecha si no es hoy, formato dd/mm determinístico) + test (6 casos).
- [x] T2 — Tarjeta `ResumeJornadaCard` "Retomar la jornada de hoy" ARRIBA de "Tus rutinas" cuando hay
      sesión abierta: borde+fondo de acento, ícono History, rodeo + maniobras + "N animales · desde el
      dd/mm" (la fecha SOLO si no empezó hoy). Tap → `/maniobra/identificar?sessionId`. Target grande
      (card full-width tappable).
- [x] T3 — `NuevaJornadaConfirmSheet` (NUEVO, idiom ExitJornadaSheet/SavePresetSheet + guard tap-through
      doble-rAF): "Empezar una nueva" → closeSession(open.id) → OK → wizard (fail-closed si ok:false,
      banner terracota + reintenta) · "Retomar la abierta" → identificar · Cancelar/scrim. CTA "Nueva
      jornada" CON abierta → abre el sheet; SIN abierta → wizard directo.
- [x] T4 — Tests e2e (`app/e2e/maniobra-reanudar.spec.ts`, 4/4): (a) abierta → tarjeta Retomar →
      identificar (oráculo: sigue active); (b) "Nueva jornada" con abierta → sheet → "Empezar una nueva"
      → closeSession (oráculo SERVER `waitForServerSessionClosed`) + wizard; (c) sin abierta → directo
      (sin sheet); (d) sheet → "Retomar la abierta" → identificar (oráculo: sigue active). + regresión
      tap-through en `maniobra-config-sheet-race.spec.ts` (3er test, hasTouch+touchscreen.tap sobre el
      scrim del NuevaJornadaConfirmSheet).
- [x] T5 — check.mjs (client unit OK incl. maniobra-resume; el rojo es la flake backend `animals_tag_unique`
      de terminales paralelas, frontend puro no regresa) + e2e maniobras (wizard 1 + identify 15 + reanudar
      4 + race 3, todo verde) + 4 capturas web táctil 360/412 en `tests/modo-maniobra/` + reconciliación
      specs + autorrevisión.

## Mapa R<n> → test
- **R10.5** (persistir + ofrecer retomar la jornada abierta) → `maniobra-resume.test.ts`
  (resumeManeuversSummary / resumeStartedDateLabel) + e2e `maniobra-reanudar.spec.ts` (a) tarjeta
  "Retomar la jornada de hoy" visible → tap → `/maniobra/identificar` con esa sesión.
- **R10.6** (una sola jornada activa por dispositivo; al iniciar otra → retomar o cerrar) → e2e
  `maniobra-reanudar.spec.ts` (b) "Nueva jornada" con abierta → `NuevaJornadaConfirmSheet` →
  "Empezar una nueva" → closeSession (oráculo server `waitForServerSessionClosed`) + wizard;
  "Retomar la abierta" → identificar; (c) sin abierta → "Nueva jornada" va directo al wizard.
- Pluralización/contador → `maniobra-resume.test.ts` (resumeAnimalCountLabel).

## Autorrevisión adversarial
Pasada hostil sobre el propio trabajo (web táctil 360/412 + lectura del código):

**Cazado y CERRADO:**
1. **Race que deja DOS sesiones activas (R10.6 roto)** — `onNuevaJornada` decidía por `openSession`, que
   se carga async en el `useFocusEffect`. Si el operario tapeaba "Nueva jornada" en la ventana
   `getActiveSession` en vuelo (`openSession` aún null), iba DIRECTO al wizard → arrancaba una 2da sesión
   con la 1ra todavía abierta (viola "una sola jornada activa"). La cacé en el e2e (d): el sheet no abría
   sin esperar la tarjeta. **Fix**: guard `if (loading) return` en `onNuevaJornada` + `disabled={loading}`
   en el CTA (defensa en profundidad). La lectura es local sub-segundo → el CTA se habilita enseguida.
2. **Título truncaba "…de hoy"** (la frase clave de la tarjeta) a `$7`/1 línea en 360 y 412 px. **Fix**:
   `$6` + `numberOfLines={2}` → en 412 entra en una línea, en 360 envuelve a 2 — nunca pierde "hoy".
   Verificado en las 4 capturas.
3. **fail-closed de "Empezar una nueva"** — `onConfirmStartNew` chequea `res.ok` de `closeSession`; si
   false devuelve `false` → el sheet superficia banner terracota es-AR + reintenta + NO navega (no deja
   la vieja "a medio cerrar" ni arranca una nueva sobre una abierta). Espejo de ExitJornadaSheet.

**Buscado y OK (no fue necesario tocar):**
- **Multi-tenant**: `establishmentId` del contexto (NUNCA hardcodeado); `getActiveSession`/`closeSession`
  scopean por establishment local + RLS server-side al subir. El `rodeoId` de la sesión se resuelve contra
  `rodeoState.available` del campo activo.
- **Rodeo de la sesión NO resoluble** (soft-deleted post-arranque, o RodeoContext aún loading): `openRodeoName=''`
  → la tarjeta cae a "Jornada en curso" / el sheet omite el nombre del rodeo (copy sin-rodeo). No rompe.
- **Config corrupto** → `resumeManeuversSummary` devuelve '' (extractManeuvers filtra no-ManeuverKind);
  la tarjeta muestra solo el rodeo o "Jornada en curso". No tira (test puro).
- **Fecha "no es hoy"** (R10.5): `resumeStartedDateLabel` compara por DÍA CALENDARIO local (no timestamp);
  formato dd/mm manual con zero-padding (NO toLocaleDateString — el ICU es-AR no zero-padea el mes
  consistente entre runtimes, "15/6" vs "15/06"). startedAt null/inválido → null (omite la fecha).
- **Offline-first**: `getActiveSession`/`closeSession` son LOCALES (CRUD-plano, M1). La tarjeta de retomar
  y el cierre funcionan sin red; la autorización real la valida la RLS al subir (contrato T5).
- **Tap-through web táctil** (regla `reference_rn_web_pitfalls`): el NuevaJornadaConfirmSheet lleva el guard
  `readyToDismissRef` doble-rAF idéntico a ExitJornadaSheet/SavePresetSheet — regresión cubierta en
  `maniobra-config-sheet-race.spec.ts` (abrir con touchscreen.tap → no auto-cierra; backdrop deliberado → cierra).
- **Descenders**: títulos ("jornada"/"abierta") con lineHeight matching ($6/$6, $7/$7); verificado en capturas.
- **NADA rojo** en el sheet (cerrar la abierta no es destructivo: sus eventos ya están persistidos, pasa a
  status='closed' disponible para resumen) — consistente con ExitJornadaSheet.
- **Refresco al enfocar**: el `useFocusEffect` re-lee presets+sesión activa en cada focus → tras "Salir sin
  terminar"/terminar/arrancar, el landing refleja el estado correcto (la tarjeta aparece/desaparece).

**Fuera de scope (NO tocado, como pide el contrato):** R10.8 (surfacing de rechazos de sync).

## Reconciliación de specs (al as-built)
- `design.md` §6.bis.11 NUEVA (reanudación en el landing: tarjeta + sheet + guard de carrera).
- `requirements.md`: nota de reconciliación bajo R10.5 (superficie de RETOMAR en el landing) y R10.6
  (NuevaJornadaConfirmSheet = "retomar o cerrar la activa"). No se reescriben los EARS (el backend ya
  existía: getActiveSession/closeSession, M1) — notas as-built.
- `tasks.md`: bloque M4.1 marcado as-built parcial (reanudación en el landing hecha; R8.4 preview de
  transición sigue pendiente). R10.8 (M4.2) sigue PENDIENTE aparte.

## Verificación
- typecheck client OK; anti-hardcode 0 violaciones.
- client unit: `maniobra-resume.test.ts` 6/6 (+ el resto verde). check.mjs rojo = SOLO flake backend
  `animals_tag_unique` de terminales paralelas (suite animal, spec 02) — frontend puro, NO regresión.
- e2e: `maniobra-reanudar.spec.ts` 4/4; `maniobra-config-sheet-race.spec.ts` 3/3 (incl. M4 tap-through);
  regresión `maniobra-wizard.spec.ts` 1/1 + `maniobra-identify.spec.ts` 15/15 (landing→wizard→identify sin
  regresión).
- 4 capturas web táctil (hasTouch+mobile) 360/412 en `tests/modo-maniobra/`:
  `retomar-jornada-landing-{360,412}.png`, `nueva-jornada-confirm-{360,412}.png`.

## Archivos
- NUEVO `app/src/utils/maniobra-resume.ts` (+ `.test.ts`) — lógica pura del resumen de la tarjeta.
- NUEVO `app/app/maniobra/_components/NuevaJornadaConfirmSheet.tsx` — sheet de confirmación R10.6.
- MOD `app/app/maniobra.tsx` — chequeo de sesión activa + tarjeta Retomar + CTA→sheet/guard.
- NUEVO `app/e2e/maniobra-reanudar.spec.ts` (4 escenarios) + NUEVO `app/e2e/captures/maniobra-reanudar.capture.ts`.
- MOD `app/e2e/maniobra-config-sheet-race.spec.ts` (+1 test tap-through M4).
- MOD `scripts/run-tests.mjs` (registra `maniobra-resume.test.ts`).
