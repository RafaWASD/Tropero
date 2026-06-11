# review e2e-rojos-fix (2 bugfixes del triage item 3, NO feature SDD)

Reviewer: terminal reviewer (2026-06-11). Veredicto: APPROVED.

baseline_commit del impl: 0b10f52. Working tree compartido con el WIP YA GATEADO del flake-repro
(events.ts/local-reads/event-timeline/spec15 design/current.md): NO revisados (reviewer APPROVED + Gate 2 PASS previos).

## Disjuncion confirmada (foco 7)

git diff --name-only de ESTA tarea = exactamente 4 archivos:
- app/src/contexts/ProfileContext.tsx (FIX 1, app)
- app/app/(tabs)/mas.tsx (FIX 1, wiring)
- app/e2e/rodeos.spec.ts (FIX 2, test-only)
- docs/backlog.md (reconciliacion)

Los 7 del WIP ajeno (events.ts, local-reads, event-timeline, specs/active/15-powersync/design.md, progress/current.md)
estan modificados en el tree PERO no por esta tarea. NINGUN archivo del item 2 fue tocado.

Nota de staging (no bloqueante): el 1er hunk de docs/backlog.md (entrada nueva created_by spoofeable, Origen Gate 2 del
Run backlog-flake-repro) pertenece conceptualmente al WIP ajeno, NO a esta tarea. Los hunks PROPIOS de esta tarea en el
backlog: (a) marca RESUELTO de ProfileContext 2026-06-10, (b) la Nota 2026-06-11 sobre el flake de rodeos:138. Al
commitear, separar selectivamente (el impl ya lo advirtio). No afecta el veredicto.

## FIX 1 ProfileContext: reactividad de la lectura local post-spec-15

### Foco 1 Lifecycle de pendingOptimisticNameRef
Verificado en ProfileContext.tsx:96,104,118-123,140,179-187. El marcador se LIMPIA en 3 puntos: cambio de userId
(useEffect 140), loadFor(null) sin sesion (104), y cuando loadFor ok devuelve name === pending (118-123).
- name nuevo == name viejo (editar solo telefono): el local ya tiene ese name, el 1er loadFor reactivo confirma y limpia.
- dos ediciones rapidas: el 2do applyOwnProfile sobreescribe el marcador y bumpea loadSeq (180), el loadFor en vuelo de
  la 1ra se descarta por seq (112). Reconcilia al 2do.
- pegado para siempre: si el sync-down nunca trae ese name, el saludo queda en el valor OPTIMISTA (= lo guardado
  server-side, CORRECTO). Los loadFor reactivos con name distinto solo se DESCARTAN (119-121, return sin tocar
  namePhone), NUNCA revierten a un valor erroneo. Unico costo: multi-device extremo, auto-sanable. NO es regresion.

### Foco 2 Caso offline-puro
ProfileContext.tsx:165-169: guard if (lastSyncedMs === 0) return antes de loadFor. Sin sync nunca, lastSyncedMs=0, el
efecto reactivo NO dispara. Error espurio queda (offline genuino), fallback de saludo index.tsx:226 sigue. Dep primitiva
estable: sin loop. OK.

### Foco 3 Por que NO refresh en onDone / loadSeq invalida loadFor en vuelo
applyOwnProfile hace loadSeq.current += 1 (180). Un loadFor en vuelo capturo seq = ++loadSeq.current (107); al resolver
seq !== loadSeq.current (112): return antes de tocar estado. El optimista NO se pisa. NO llamar refresh es correcto: un
loadFor inmediato leeria el SQLite local stale (saveProfile es online-direct a public.users, no overlay) y sin el bump
podria pisar el optimista. OK.

### Foco 4 Regresiones por cambio de firma
- onDone ahora recibe saved: unico consumidor de ProfileEditForm es mas.tsx:203, ya migrado. El valor (mas.tsx:367) son
  nextName/nextPhone EXACTOS mandados a saveProfile (361-362), no el state crudo: optimista fiel. OK.
- applyOwnProfile nuevo en ProfileContextValue: los otros consumidores de useProfile (index.tsx:216, onboarding.tsx:34,
  cambiar-email.tsx:30) solo desestructuran profile/loading. Extension PURAMENTE ADITIVA. OK.
- Saludo de home (index.tsx:216,226): consume profile. applyOwnProfile setea namePhone, value memoizado cambia (dep
  namePhone, 195), home re-renderiza con el name nuevo al instante. Mecanismo que cierra profile:38. OK.

### Foco 5 Desviacion del patron del triage
El triage sugeria statusChanged + lastHasSynced (solo 1ra transicion false a true). El impl eligio lastSyncedAt advance
(useStatus, patron canonico de animales.tsx:90,199 / index.tsx:250,421), que cubre ADEMAS los sync-down POST-first-sync,
necesario para profile:62. Patron YA canonizado (3 call-sites identicos), loop-safe. Desviacion SOLIDA. OK.

### FIX 1 sin test unit nuevo
Justificado: wiring de contexto RN, no unit-testeable sin renderer RN + fake del SDK. La logica subyacente ya tiene
cobertura; la pieza nueva es e2e-cubierta. Aceptable para un bugfix (no feature SDD).

## FIX 2 rodeos: expect.poll de persistencia server-side (foco 6)
rodeos.spec.ts:131-157: read-back unico a expect.poll(timeout 20000).toBeGreaterThan(0).
- Espera la senal CORRECTA: la fila REAL del rodeo en el remoto (anon + login del mismo user, RLS-respecting), NO la UI.
  createRodeo es offline-first via outbox (spec 15 T9.8): la RPC corre async, el read-back unico race-eaba.
- NO enmascara bug: el producto SI persiste server-side (el poll confirma la fila real, no solo el overlay). Estabiliza
  timing legitimo offline-first. rodeoId capturado en el callback ganador.
- Correcto NO asertar dentro del poll (error de red transitorio a 0 a reintenta, sin abortar). Evita flake nuevo. OK.

## Verificacion que corri yo
- node scripts/check.mjs: EXIT 0, All tests passed. 1ra corrida verde (incluido el batch 5000 de import que el impl
  reporto como flake LIVE: paso sin re-correr). sync_streams + import LIVE verdes.
- pnpm typecheck (cd app): EXIT 0.
- e2e contra el export estatico de PROD (dist/), rebuildie dist/ con pnpm run e2e:build ANTES (FIX 1 toca app):
  - profile.spec.ts + account.spec.ts --repeat-each=3: 18/18 VERDE deterministico (1.7m). Incluye profile.spec.ts:38
    (saludo post-edicion, antes flake 2/3, ahora 3/3) y los anclas de los 4 rojos originales (Cambiar email + Editar
    perfil ahora rendean).
  - rodeos.spec.ts --repeat-each=3: 9/9 VERDE (46.4s). Incluye :99 (contenia el assert flaky :138).
  - El Assertion failed UV_HANDLE_CLOSING al final es ruido de teardown de libuv en Node 24, NO un fallo.
  - Comandos: pnpm.cmd run e2e:build ; pnpm.cmd exec playwright test profile.spec.ts account.spec.ts --repeat-each=3 ;
    pnpm.cmd exec playwright test rodeos.spec.ts --repeat-each=3
- NINGUN rojo ajeno en mis corridas.

## Reconciliacion de specs (paso 6)
- docs/backlog.md: entrada ProfileContext 2026-06-10 marcada RESUELTO + Nota rodeos:138. Aditivo, consistente con el
  codigo as-built.
- Spec 01 design.md NO prescribe el timing de ProfileContext (pre-spec-15). Spec 15 design.md:712 documenta one-shot
  getAll NO db.watch; el fix usa el patron acotado useStatus/lastSyncedAt (NO migra a db.watch), CONSISTENTE. Ninguna
  EARS contradice el fix. (No edito spec 15 design.md: WIP ajeno.) No hay specs viejas que reconciliar de esta tarea.

## Findings (archivo:linea)
NINGUNO bloqueante. Unico punto de proceso: docs/backlog.md 1er hunk (created_by spoofeable) pertenece al WIP ajeno
(Gate 2 del flake-repro), no a esta tarea. Stagear selectivamente al separar commits. No afecta veredicto.

## Veredicto final: APPROVED
5 e2e rojos del triage cerrados y deterministicos (18/18 + 9/9 con --repeat-each=3). check.mjs exit 0, typecheck exit 0.
Sin regresiones en consumidores de useProfile. Desviaciones del patron mejor justificadas que la sugerencia. Lifecycle
del optimista correcto (no se pega ni revierte). FIX 2 estabiliza timing legitimo sin enmascarar bug. Disjuncion del WIP
ajeno confirmada.
