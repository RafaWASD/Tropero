# Review - spec 03 MODO MANIOBRAS - CHUNK 1 (M2.1-exit-hero) + CHUNK 2 (M2.2-continue-maniobra)

Reviewer: reviewer (Opus 4.8 / 1M). Fecha: 2026-06-16.
Alcance: dos chunks frontend-only que integran la pantalla manga (roja) de identificacion de MODO MANIOBRAS.

## Veredicto: APPROVED

Ambos chunks cumplen trazabilidad, tasks, reconciliacion de specs, estandar manga y verificacion.
El unico rojo de check.mjs es el flake conocido de terminales paralelas (backend animal), NO regresion.

## Trazabilidad R-n a test
- R10.7 (cerrar jornada, surfacing): e2e maniobra-identify (i) -> oraculo server waitForServerSessionClosed (status=closed) + "Procesaste N animales" + waitForHome. OK
- R10.5/R10.6 (salir sin terminar = reanudable): e2e (j) -> readServerSessionStatus===active tras "Salir sin terminar". OK
- sheet no-destructivo / seguir: e2e (k) -> exit-jornada-seguir cierra el sheet sin navegar. OK
- guard tap-through web tactil (reference_rn_web_pitfalls): e2e (l) hasTouch+touchscreen.tap -> abrir con tap NO auto-cierra; backdrop deliberado SI cierra. OK
- R3.6/R3.7 (hero adaptativo): unit maniobra-listen-state.test (4 casos) + e2e (m) conectado<>conectable en vivo (tap connect-stick-disc -> ScanHero; disconnect -> ConnectHero). OK
- sub-estado manual-promovido (transport==null): unit caso manual + captura maniobra-exit-hero.capture (flag __RAFAQ_BLE_E2E_MANUAL__). OK
- R4.1 (alta continua la maniobra, cierra TODO de M2.1-core): e2e (n) -> desconocido -> alta -> wizard -> /maniobra/carga (1 de 1 + weight-display) + NEGATIVAS de ficha; regresion (o) -> alta sin sessionId -> ficha /animal/[id] + waitForServerAnimalProfile. OK

Cada R aplicable tiene al menos 1 test concreto; usan oraculos de servidor (no se conforman con la UI).

## Tasks completas: SI
- M2.1-exit-hero -> [x] (tasks.md:226) con as-built A+B, tests i-m, archivos.
- M2.2-continue-maniobra -> [x] (tasks.md:235) con as-built, tests n-o, archivos.
- No quedan [ ] sin justificacion en el alcance de estos chunks.

## Reconciliacion de specs (codigo a spec): COMPLETA
- design.md 6.bis.8 (exit-hero) y 6.bis.9 (continue-maniobra) describen el as-built REAL.
- requirements.md: notas bajo R10.7, R3.6/R3.7 (M2.1 2026-06-16) y R4.1 (M2.2 2026-06-16). EARS no reescritos (correcto).
- tasks.md: ambos bloques [x] con detalle. Ningun design quedo mintiendo.

## CHECKPOINTS
- C1 harness completo: [x]
- C2 estado coherente: [x] (03 in_progress; current.md describe la sesion)
- C3 arquitectura: [x] (ExitJornadaSheet no importa de services -recibe callbacks-; maniobra-listen-state.ts utils puro; I/O closeSession en la screen; 0 hardcode)
- C4 verificacion real: [x] (unit hero 4/4; e2e fixtures reales + oraculos server)
- C5 cierre: N/A (chunks sin commitear; lo decide leader/Gate 2)
- C6 SDD: [x] (3 archivos spec; EARS estricto; tasks [x]; cada R con test)
- C7 multi-tenant: N/A (frontend puro; sin tablas/RLS nuevas; closeSession re-valida RLS al subir)
- C8 offline-first: [x] (closeSession/setSessionCounts CRUD-plano offline; createAnimal por outbox)

## Checklist RAFAQ-especifico
- A. Multi-tenancy/RLS: N/A. Frontend puro. sessionId SIEMPRE del param (nunca hardcodeado); closeSession/moveAnimalToRodeo re-validan RLS al subir.
- B. Offline-first: [x] funciona offline; [x] CRUD-plano runLocalWrite-CrudEntry-uploadData; [x] LWW (counts absolutos); [x] la screen toca el service (no Supabase sincrono).
- C. BLE: [x] desconexion manejada (hero adaptativo + e2e (m)); [x] manual fallback en <=1 tap; [x] connect() con gesto de usuario; [x] logs BLE no bloquean el flujo.
- D. UI de campo (roja): [x] targets (touchMin=56 / heroScan=200 / Button DS); [x] fuente grande en texto legible (headings 8/9); [x] una decision por estado (3 acciones, NADA rojo); [x] loading visible; [x] safe-area.
- E. Edge Functions: N/A.

## Puntos verificados a fondo
1. Navegacion loop manga: alta -> /maniobra/carga (no ficha); alta normal sin sessionId -> ficha (regresion (o) verde). BLE-unknown tambien pasa sessionId. Las 3 ramas de routing de crear-animal usan la MISMA condicion maneuverSessionId -> consistentes.
2. Exit sheet: closeSession fail-closed (no navega si false; superficia error es-AR + reintenta; guard terminating anti doble-close). Scrim phase-aware en terminated navega fuera. N=session.animalCount. Guard tap-through doble-rAF (verificado por (l) touchscreen real). NADA rojo.
3. Hero adaptativo: resolveListenConnState cubre los 3 casos sin huecos. connect() con gesto. Aplica SOLO a outcome===null (ramas de outcome intactas). Reactivo sin flicker (mismo tamano/posicion de disco).
4. Offline-first: el combo no rompe el offline.
5. Descenders: TODOS los headings 8/9 con lineHeight matching; todos los numberOfLines del sheet con lineHeight.
6. Cero hardcode: 0 violaciones; badge Bluetooth deriva de heroScan*0.28 con tokens existentes. es-AR voseo + pluralizacion N=1.
7. Fix de los 5 e2e (CHUNK 1) LEGITIMO: el hero adaptativo cambio el estado inicial del mock (conectable->ConnectHero). Las 4 suites conectan el mock antes de aseverar ScanHero (camino conectado real); maniobra-wizard asevera ConnectHero (estado genuino). Sub-estado desconectado con test propio (m). 5 specs 15/15 verde.

## Verificacion ejecutada
- tsc --noEmit (client): 0 errores.
- check-hardcode.mjs: 0 violaciones.
- unit maniobra-listen-state.test.ts: 4/4.
- e2e maniobra-identify.spec.ts: 15/15 (i-o de ambos chunks).
- e2e maniobra-{carga,elegir,sanitaria,tacto-bugfix,wizard}.spec.ts: 15/15.
- check.mjs completo: rojo SOLO en supabase/tests/animal/run.cjs -> 23505 animals_tag_unique = flake conocido de terminales paralelas. Frontend puro -> NO regresion. Resto del pipeline verde.

## Cambios requeridos
Ninguno.

## Nota para el leader (no bloqueante)
No marco done (lo decide el leader tras Gate 2). Los chunks viven en el working tree junto al resto de spec 03 sin commitear.
