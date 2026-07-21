# Review — feature 20: reactividad de lecturas sincronizadas (PASADA DE REMEDIACION)

> Reviewer, 2026-07-20. Baseline sin commitear 3e7d35e. Verifica si la remediacion cierra el rechazo
> de 6 prongs. Verificacion confiable: unitarios de la feature + typecheck del cliente (la E2E queda
> como andamio reportado por el implementer; maquina cargada, infra flakea; no se bloquea el veredicto
> en ella, per el encargo).

## Veredicto: APPROVED

Los 6 prongs del rechazo estan cerrados. El punto critico (el forzador de blip NO es un falso verde)
se confirmo por analisis del oraculo. Unitarios 238/0, typecheck 0 errores, instrumentacion temporal
removida (grep limpio), specs reconciliadas con el as-built, sin imports muertos en el spec E2E (el
implementer crasheo 2x; wiring verificado a mano, no solo por typecheck).

---

## Verificacion por prong (el rechazo original)

### A/B — diagnostico determinista [OK]
- La evidencia cruda de las 2 corridas (progress/impl_20 PRONG A/B, 193-211) respalda "SIGNAL problem
  intermitente, no delivery, no latch permanente": la fila llega al SQLite en ~1,5 s en 6/6 cambios;
  lastSyncedAt avanza NO-determinista por cambio (corrida 1 todos ticaron; corrida 2 el 1o se estanco
  ~90 s hasta que el 2o forzo el checkpoint). Sondeo directo sobre SQLite SIN reload -> responde la
  objecion del reviewer (un reload re-sincroniza).
- El claim viejo "lastSyncedAt deja de avanzar tras el 1er cambio" corregido en TODOS lados fuera del
  bloque historico: spec.ts:71 ("MAL DIAGNOSTICADO"), design 10-bis(g):500-523 (declara FALSO),
  backlog:20-26 (item reescrito, header "NO determinista"), tasks T18:145. Las ocurrencias en
  progress/impl_20 (58,62,168) estan dentro de secciones marcadas "SUPERADAS (historico)" / "REJECTED".
  Ninguna narrativa vieja mentirosa sobrevive fuera de bloque marcado.

### C — instrumentacion + comentarios [OK]
- grep __RAFAQ_PS__ en app/src -> 0 (unica aparicion: comentario del spec:47 que cita el metodo A/B).
  database.ts limpio.
- [MED]/[MED2] -> 0. test.describe.configure -> 0. retries en el spec -> solo 4 comentarios que explican
  POR QUE no hay retries. console.log/warn/error en el spec -> 0.
- Header del spec (43-72) HONESTO: latencia de sync REAL, NO implica latencia acotada en produccion,
  flaggea db.watch como fix de fondo, declara SIN retries.

### D — cobertura [OK]
- R20.7/R20.8 guard ===0: bajado honestamente a inspeccion (spec.ts:458-463 + requirements 6:193; login
  online -> lastSyncedMs>0 -> no ejercitable por E2E). T22 prueba la otra mitad (senal congelada).
- T18 rename REAL (UPDATE): spec.ts:219 update sobre un rodeo pre-existente distinto del activo. R20.19
  sigue asertando el rodeo activo persistido inmutable (236-238; el rename toca OTRO rodeo).

### E — bookkeeping [OK]
- tasks T25 [x] con verde honesto (238/0 + typecheck 0 + E2E sin retries/sondas).
- requirements 6:190 — R20.33/R20.34 ya NO en la linea E2E ("Unit + inspeccion (NO alcanzables por E2E)").
- tasks T21 pt4 reconciliado (162, tachado + explicacion estructural).

### F — 3 decisiones de codigo [OK]
1. RodeoContext via assessDisappearance — behavior-identico por tabla de verdad: active->present->concluye;
   absent->confirmed->conserva; unknown->inconclusive->conserva (coincide con el inline previo). 3 unit
   tests (rodeoConcludesNoRodeos, establishment.test.ts:395-405). NO rompe bootstrap: protectingResolved
   (RodeoContext:230-233) exige statusRef==='active' && resolvedForEstRef===estId -> arranque/post-switch
   concluyen no_rodeos directo (R20.18 acotada). R20.30 fail-safe conservado.
2. lotes.tsx guard sameManagementGroups (59-67) — ManagementGroup es {id,name} -> id+name+orden es la
   comparacion completa. prev===null -> false -> emite. Carga inicial y cambio real emiten.
3. 6o llamador de refreshEstablishments — 5 pre-existentes intactos (editar-campo, invite, mas x2,
   applyCreatedEstablishment:437) + 2 internas nuevas (efecto reactivo:519, post-switch:405). Comentario
   513-515 explicito. Sin cambio de firma.

---

## Escrutinio extra

### El forzador de blip (forceSyncTick/syncUntil) — NO es un falso verde [OK] (el punto mas importante)
- forceSyncTick (spec.ts:104-108): blip offline->online -> PowerSync reconecta + checkpoint FRESCO ->
  avanza lastSyncedAt. La data del seed YA esta commiteada server-side ANTES del blip. El blip fuerza
  SOLO la senal (+ baja la fila ya presente en el servidor); NO toca el dato ni el resultado del assert.
  No es reload (la app sigue montada; refs/estado sobreviven).
- syncUntil (118-131): bombea blips hasta que check() (visibilidad) pase o se agote el presupuesto.
  DESPUES corre el oraculo estricto expect(...).toBeVisible({timeout}).
- Un bug real seguiria fallando? SI. Si se restaurara el latch (el bug), el efecto lastSyncedMs no
  re-dispararia -> el contexto no re-lee -> el elemento nunca aparece -> syncUntil agota -> el expect
  estricto FALLA. El blip avanza la senal pero el codigo bugueado ignora los avances de senal. El blip
  NO puede enmascarar una regresion de latch.

### T20 revokeSession:false — sin gap de cobertura que importe [OK]
- El camino real de remocion-de-miembro con sesion revocada lo cubre T21 (revokeSession:true +
  assertServerSessionsRevoked como control anti-falso-verde, spec.ts:416-421). El fixture revokeMemberRole
  (admin.ts:1931-1953) espeja remove_member completo (rol + revoke_user_sessions), default true = paridad
  produccion, y TIRA si no puede revocar la sesion.
- T20 usa revokeSession:false DELIBERADO y documentado (319-329): ejercita el camino "campo-borrado"
  (trigger 0076, firma local indistinguible — E5). NINGUNO de los requisitos de T20 (R20.14/23/24/26/28)
  depende de la revocacion de sesion. Los que si (R20.36/D1.2) -> T21 + inspeccion (jwt_expiry=3600, no
  testeable). Sin gap material.

### Reconciliacion specs<->codigo [OK]
- spec 15 design.md:713-715 — bullet db.watch acotado a la feature 20 + lectura local nueva + invariante RG-1.
- spec 01 requirements.md:214-231 — nota as-built bajo R6.10 (diferimiento + D1.2 + evidencia afirmativa).
- sync-streams/rafaq.yaml:74-85 — CANDADO RG-1 pegado a self_user_roles (no agregar active=true),
  load-bearing, donde alguien edita (T24d — el que realmente protege).
- backlog.md:20-56 — 3 items (senal/db.watch reescrito y correcto, rodeo-activo-borrado, borrado-vs-revocado).

---

## Trazabilidad R20.<n> <-> test (completa)

Mapa integro en progress/impl_20 (106-149). Spot-check de los criticos:
- R20.12-15/30/32 <-> assessDisappearance unit (establishment.test.ts:328-382). CENTRAL de E1 (activo
  ausente PERO rol active=1 -> inconclusive): linea 328.
- R20.13 (ningun confirmed sin evidencia afirmativa) <-> barrido del espacio (373-382).
- R20.18 (RodeoContext) <-> rodeoConcludesNoRodeos x3 (395-405) + E2E T21.
- R20.31 <-> buildActiveRoleQuery LOCAL/parametrizada/LEE-no-filtra (local-reads.test.ts:391-411).
- R20.35/R20.34 <-> shouldEmitDeferredRevocation x5 (409-446).
- R20.11 <-> sameResolvedEstablishmentState/sameEstablishmentList x9 (476-585).
- R20.1/2/3/9/19/20-24/28 <-> E2E (T17-T21). R20.4/5/6/7(===0)/8/16/17/25/29/33/36/37 <-> inspeccion
  de invariantes estructurales (requirements 6 los categoriza honestamente).
- Ningun R20.<n> queda sin >=1 test/inspeccion asignada y documentada.

## Tasks completas: SI (T1-T25 en [x]; T25 con verde honesto, sin retries/sondas).

## CHECKPOINTS
- C1 [x] harness completo (no full check.mjs por fencing WIP=1 + carga; unitarios+typecheck verdes).
- C2 [x] (el 2o in_progress 16+20 es coordinacion del leader, no regresion — fenced).
- C3 [x] solo capas previstas (contexts/services/utils/screens); sin deps nuevas; sin logs de debug
  sueltos (el unico console.warn es R20.37, intencional, sin PII); no se hardcodea establishment_id.
- C4 [x] 238 tests verdes; fixtures reales (admin.ts service_role, sin mocks de I/O).
- C5 [x] (arbol sin commitear — lo coordina el leader; sin artefactos temporales nuevos).
- C6 [x] 3 archivos de spec, EARS estricto, tasks [x], cada R con test/inspeccion.
- C7 [x] no crea tablas/policies (design 10); no hardcodea establishment_id; evidencia afirmativa es
  senal de UX no authz (design 4.3), enforcement server-side has_role_in intacto; aislamiento cross-tenant
  en T17/T20/T21 (owner != member); candado RG-1 protege el invariante de E1.
- C8 [x] cero red agregada, lecturas del SQLite local, bucket sin cambios, test offline T22. Conflict
  resolution N/A (feature de LECTURA; re-lectura idempotente).
- C9 E2E [x] (6 casos; reportado 6/6 runs 5 y 6 por el implementer — no re-corrido por carga/infra, per
  fencing). Captures N/A justificado: el unico cambio visible es una cadena de texto (subtitulo de
  /campo-perdido), cubierta por asserts de texto (T20/T21); no hay pantalla nueva.

## Checklist RAFAQ-especifico
- A (RLS/multi-tenancy): N/A a tablas nuevas — no crea tablas ni modifica policies/streams (design 10).
  Unico SQL nuevo = SELECT LOCAL. Disciplina multi-tenant respetada (sin hardcode; enforcement server-side
  intacto; candado RG-1). Aislamiento cross-tenant en E2E T17/T20/T21.
- B (offline-first): [x] funciona offline (T22); [x] bucket correcto (sin cambios, scoped por
  establishment_id); [x] conflict resolution N/A (solo lectura, idempotente); [x] sin requests sincronos
  a Supabase desde pantalla (lecturas locales SQLite via repositorio).
- C (BLE): N/A — la feature no toca BLE (el __RAFAQ_BLE_E2E__ de T21 es andamio para llegar a la pantalla
  de identificacion, no codigo de feature).
- D (UI de campo): parcial. [x] una decision por pantalla (campo-perdido: un CTA "Entendido"); [x] estado
  de loading visible sin dejar al operario esperando (R20.9/R20.10: re-lectura silenciosa, sin
  splash/blanco/reset de scroll). Botones >=60dp / fuente >=18pt: N/A (no agrega controles nuevos; reusa
  AuthScreenShell/Button/InfoNote). El diferimiento D1 (no patear al operario en la manga) es el corazon
  manga-friendly de la feature.
- E (Edge Functions): N/A — no se toca ni crea Edge Functions (remove_member/revoke_user_sessions se
  ESPEJAN en fixtures de test, no se modifican).

---

## Defectos reales encontrados: ninguno bloqueante

Nota (no bloqueante, ya cubierto por diseno): en EstablishmentContext.confirmDisappearance la eliminacion
del contador de secuencia deja una ventana teorica ultra-rara (revocar + re-otorgar el rol dentro de la
duracion de UNA query local del SQLite) donde podria emitirse un active_lost espurio. Es (i)
astronomicamente improbable, (ii) auto-curable en el proximo checkpoint (design 4.3, blast radius =
pantalla de aviso espuria, sin purge local), y (iii) NO es regresion de la remediacion (el contador
tampoco lo cubriria, y su remocion resuelve la starvation real que el E2E cazo). Dentro del sobre de
diseno declarado. No amerita cambio.

## Verificacion ejecutada
- Unitarios de la feature: establishment.test.ts + local-reads.test.ts -> 238 passed / 0 failed.
- Typecheck del cliente (tsc --noEmit) -> 0 errores.
- grep instrumentacion (__RAFAQ_PS__ / [MED] / test.describe.configure / console.* en spec) -> limpio.
- Imports del spec E2E -> todos resuelven (sin dead imports; el implementer crasheo 2x).
- E2E de la feature: NO re-corrida (maquina cargada; per fencing, unitarios+typecheck son la senal
  confiable; el implementer reporto 6/6 en runs 5 y 6 reproducibles).
