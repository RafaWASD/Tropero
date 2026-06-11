# impl — e2e-rojos-fix (2 bugfixes diagnosticados, NO feature SDD)

baseline_commit: 0b10f52a41b699889e8e381bf20f0b166361347b

> Diagnóstico fuente: `progress/triage_e2e_rojos.md` (ítem 3 del triage).
> Cierra los 5 e2e rojos actuales con 2 fixes acotados sobre archivos DISJUNTOS del WIP de la otra tarea
> (fix flake repro: events.ts/local-reads.ts/event-timeline.ts + tests + docs/backlog.md + spec 15 design + current.md).
> NO toco esos archivos.

## Resultado: 5 rojos cerrados (4 det. + 1 flake)

---

## FIX 1 (APP) — ProfileContext: reactividad de la lectura local post-spec-15

**Archivos tocados**:
- `app/src/contexts/ProfileContext.tsx` (núcleo del fix)
- `app/app/(tabs)/mas.tsx` (wiring del aterrizaje optimista: `ProfileEditForm.onDone(saved)` + `applyOwnProfile`)

**Rojos cerrados (4 det.)**: `account.spec.ts:151` (ancla "Cambiar email") + `profile.spec.ts:54/75/110`
(ancla "Editar perfil", todos en `gotoTab('Más')`). Además cerró un 5º síntoma que el destrabe del ancla
DESTAPÓ: `profile.spec.ts:38/:62` (saludo de la home no se actualizaba tras editar el nombre) — estaba
ENMASCARADO por el fallo previo en `:54` (el test nunca llegaba a `:62`).

**Causa raíz (verificada en código + error-context snapshots)**: la lectura del perfil
(`loadProfileNamePhone`, spec 15 T3.2) viene del SQLite local de PowerSync y es ONE-SHOT. El efecto de
carga corre UNA vez al resolver `userId`, típicamente ANTES del first-sync → `runLocalQuerySingle` degrada
"vacío + !hasSynced" a `kind:'network'` → `error="Sin conexión: no pudimos actualizar tu perfil."`,
`profile=null`, y NO se re-evaluaba solo → `mas.tsx` renderizaba el alert "Reintentar" en vez de la sección
Perfil. (Es exactamente la entrada de backlog 2026-06-10, demostrada FUNCIONAL no cosmética.)

**Fix**:
1. **Reactividad por `lastSyncedAt`** (patrón canónico ya usado en `animales.tsx:192` / `index.tsx:415`):
   `useStatus()` de `@powersync/react` + `lastSyncedMs = syncStatus.lastSyncedAt?.getTime() ?? 0`; un
   `useEffect([lastSyncedMs, userId, loadFor])` re-lee el perfil cuando AVANZA el sync (se omite mientras
   `lastSyncedMs===0`). Al completar el first-sync, re-lee → carga el perfil y limpia el error espurio.
   Elegí este patrón (NO el `registerListener({statusChanged})` + `lastHasSynced` de `EstablishmentContext`
   que sugería el triage) porque `lastSyncedAt` cubre ADEMÁS los sync-down POSTERIORES al first-sync —
   necesario para el síntoma (b) de abajo — y es el patrón ya canonizado para "re-leer al avanzar el sync"
   en las pantallas de campo. Mismo efecto para el síntoma (a), más general para (b). Loop-safe (dep
   primitiva ms, estable entre statuses iguales).
2. **Aterrizaje OPTIMISTA del saludo post-edición** (síntoma (b)): `saveProfile` es ONLINE-direct a
   `public.users`/`user_private` (no pasa por overlay/outbox), pero la lectura es del SQLite local → un
   `refresh()` inmediato leía el name VIEJO hasta el round-trip de sync-down (saludo no se actualizaba;
   flaky con solo el fix #1 porque el sync-down podía tardar > la ventana de `gotoTab`). Agregué
   `applyOwnProfile(saved)` al contexto: el `ProfileEditForm` le pasa los valores recién guardados (exactos,
   trimeados) en `onDone` → el saludo refleja el valor nuevo AL INSTANTE. NO se llama `refresh()` tras el
   optimista (un `loadFor` inmediato leería el local aún stale y pisaría el valor; lo documenté en el código).
3. **Reconciliación del optimista** (`pendingOptimisticNameRef`): marca el name esperado; un `loadFor`
   reactivo que devuelva un name DISTINTO (sync-down del row editado todavía no llegó) se descarta como
   stale → NO revierte el saludo. Se confirma/limpia cuando el local trae el name esperado (mismo ciclo de
   vida que `pendingCreatedRef` en `EstablishmentContext`). Se limpia también al cambiar de usuario (login
   distinto) para no bloquear la carga del name del nuevo. Cierra la carrera que dejaba el e2e flaky 2/3.

**Por qué NO toqué los tests de FIX 1**: sus asserts son correctos (el usuario DEBE poder editar perfil /
cambiar email / ver el saludo actualizado). El bug era del producto.

**¿Test unit nuevo?**: NO. El fix es puro wiring de contexto RN (PowerSync `useStatus` + efectos + refs);
no se puede unit-testear sin un renderer RN + un fake del SDK PowerSync. La lógica subyacente
(`loadProfileNamePhone`, `waitForUsableSync`/`isFirstSyncPending`) ya tiene cobertura unit; la pieza nueva
es la misma clase de re-query reactivo que en `EstablishmentContext`/`animales.tsx`, e2e-cubierta (no
unit-cubierta). Confío en los e2e + el typecheck.

### Trazabilidad (síntoma → test que lo ejercita)
- ARRANQUE: error espurio bloqueando "Más" → `account.spec.ts:151`, `profile.spec.ts:54/75/110` (gotoTab Más).
- POST-EDICIÓN: saludo se actualiza al editar el nombre → `profile.spec.ts:38` (assert del saludo nuevo en `:62`).
- No-regresión de la edición/teléfono/descartar → `profile.spec.ts:65`, `profile.spec.ts:102` (siguen verdes).

---

## FIX 2 (TEST) — rodeos: poll de persistencia server-side

**Archivo tocado**: `app/e2e/rodeos.spec.ts` (~líneas 130-157). SOLO test.

**Rojo cerrado (1 flake 2/3)**: `rodeos.spec.ts:138` (`rodeos.length > 0` recibía 0).

**Causa raíz**: `createRodeo` es OFFLINE-FIRST vía outbox (spec 15, T9.8): encola el intent + overlay
optimista y devuelve al instante; la RPC real corre async al drenar la outbox. El test leía el remoto UNA
vez tras `waitForHome` → race con el upload.

**Fix**: reemplacé la consulta única por `expect.poll(... , { timeout: 20_000 }).toBeGreaterThan(0)`
(patrón "oráculo de persistencia server-side", `waitForServerAnimalProfile`). El `rodeoId` se captura en el
callback del poll en la corrida ganadora. NO se asierta dentro del poll (un error transitorio de red
abortaría el poll en vez de reintentar): fallo/vacío → 0 → reintenta. El producto está bien (offline-first
es el diseño correcto, spec 15); el test no debe asumir persistencia síncrona. NO es el rojo del
`OnboardingImportOffer` de feature 12 (ese ya estaba resuelto; el helper descarta la oferta).

---

## Verificación (corrida por mí)

1. **`cd app; pnpm.cmd typecheck`** → VERDE (varias veces durante el desarrollo + final).
2. **`node scripts/check.mjs`** (raíz) → EXIT 0, "All tests passed" / "Entorno listo".
   - 1ª corrida: rojo SOLO en `supabase/tests/import/run.cjs` → `T2.5 SEC-12B-HIGH-01 batch 5000` con
     `canceling statement due to statement timeout` (57014). Es el flake de infra de la DB beta que el
     prompt anticipó. Re-corrí la suite import sola → PASÓ (6.5s, antes timeout) + la corrida final completa
     de check.mjs → exit 0. NO es regresión de mis cambios (archivos disjuntos del import RPC). Typecheck +
     client unit verdes en todas las corridas.
3. **e2e** (contra el **export estático de PROD** en `dist/`, servido en :8099; **rebuildié `dist/` con
   `pnpm.cmd run e2e:build` ANTES de cada corrida** porque FIX 1 toca APP y el `dist/` arrancó stale):
   - `profile.spec.ts` + `account.spec.ts` con `--repeat-each=3` → **18/18 VERDE determinístico**
     (incluye los 4 rojos originales + el saludo `:38` que antes era flake 2/3, ahora 3/3 ~4.3s c/u).
   - `rodeos.spec.ts` con `--repeat-each=3` → **9/9 VERDE** (el config `:99/:138` era flake 2/3, ahora 3/3).
     Re-corrí `:99` ×3 tras refinar el poll (sacar el `expect` interno) → 3/3.
   - Corrida combinada final `profile + account + rodeos` (1×) → 9/9 verde.
   - Comandos exactos:
     `pnpm.cmd exec playwright test profile.spec.ts account.spec.ts --repeat-each=3 --reporter=list`
     `pnpm.cmd exec playwright test rodeos.spec.ts --repeat-each=3 --reporter=list`
     (precedidos de `pnpm.cmd run e2e:build` para reflejar el código de app actual en `dist/`).

## Autorrevisión adversarial (paso 8)

- **¿El re-eval rompe el offline-puro o mete un loop?** NO. Sin first-sync nunca → `lastSyncedMs===0`, el
  efecto reactivo no dispara → el error espurio queda (igual que antes; offline genuino, editar está
  bloqueado) y el fallback de saludo sigue. La dep es un primitivo ms estable → sin loop. `loadFor` setea
  estado pero no cambia `lastSyncedMs`.
- **¿El optimista puede quedar pegado o revertirse?** El marcador `pendingOptimisticNameRef` se limpia
  cuando el local confirma el name nuevo y al cambiar de usuario. Edición doble seguida: el 2º save pisa
  el marcador y el valor; reconcilia al 2º. Riesgo extremo (multi-device edit del propio perfil) se
  auto-sana al sincronizar el row original — aceptable y raro. Sin él, un sync-down de OTRAS tablas
  revertía el saludo al name viejo (era la causa del flake 2/3 que vi en la corrida intermedia).
- **¿`useStatus()` re-renderiza de más?** Re-renderiza el provider en cada statusChanged (igual que
  `animales.tsx`/`index.tsx`, patrón aceptado). El `value` memoizado solo cambia cuando cambian sus deps;
  el efecto reactivo solo re-corre cuando `lastSyncedMs` avanza de verdad. Aceptable.
- **¿El fix de rodeos enmascara un bug real?** NO. El producto persiste el rodeo server-side vía la RPC al
  drenar la outbox (lo confirma el poll: la fila REAL aparece, no solo el overlay). Solo estabiliza el
  timing del read-back. NO asierto dentro del poll para no convertir un error de red transitorio en un
  abort (evita introducir un flake nuevo).
- **¿Toqué algún archivo del WIP de la otra tarea (ítem 2)?** NO. Verificado: mis archivos son
  `ProfileContext.tsx`, `mas.tsx`, `rodeos.spec.ts` + `docs/backlog.md` + este progress. Los del WIP
  (`events.ts`, `local-reads.ts`/`.test`, `event-timeline.ts`/`.test`, `specs/active/15-powersync/design.md`,
  `progress/current.md`) NO los toqué. (Nota: `docs/backlog.md` SÍ está en el WIP de la otra tarea — ver
  riesgos residuales abajo.)

## Reconciliación de specs / backlog (paso 9)

- **`docs/backlog.md` 2026-06-10 "ProfileContext queda en 'Sin conexión'…"** → marcada **✅ RESUELTO
  (2026-06-11, Run e2e-rojos-fix)** con el detalle del fix (sin borrar la entrada original).
- **`docs/backlog.md` 2026-06-07 "rodeos.spec.ts roja por OnboardingImportOffer"** → ya estaba ✅ RESUELTO;
  agregué una **Nota (2026-06-11)** aclarando que el flake de `:138` cerrado en este run tiene causa
  DISTINTA (race del read-back server-side, no la oferta de onboarding). No alteré la resolución original.
- **Specs**: spec 01 `design.md` NO prescribe el timing/reactividad de la carga de ProfileContext (es
  detalle de implementación; el spec se escribió pre-spec-15 con lecturas PostgREST directas). El gap de
  reactividad lo introdujo spec 15 (read-swap) y ya está documentado en el backlog 2026-06-09 (que NO
  modifiqué — describe el patrón acotado como el approach establecido). Spec 15 `design.md` (línea 712)
  documenta "one-shot getAll, NO db.watch, reactividad diferida": mi fix usa el patrón acotado
  `useStatus`/`lastSyncedAt` (NO migra a `db.watch`), consistente con esa nota. **No edito spec 15
  design.md: está en el WIP de la otra tarea.** Ninguna requirement EARS contradice el fix → no hay que
  reescribir EARS; la reconciliación es la del backlog (hecha).

## Riesgos residuales

- **`docs/backlog.md` colisiona con el WIP de la otra tarea**: el backlog ESTABA en el set sin commitear
  de la tarea del flake repro. Lo edité (2 entradas) para reconciliar mis fixes. Al separar en commits,
  el leader/reviewer debe **stagear selectivamente** mis hunks del backlog (las entradas 2026-06-10
  ProfileContext + la Nota 2026-06-07 rodeos) por separado de los del flake repro, o decidir el orden de
  commits. Mis hunks del backlog son aditivos y no tocan las líneas del otro frente. (No pude evitarlo: la
  regla de reconciliar correcciones en docs me obliga a tocar el backlog; está en el WIP ajeno por mala
  suerte de timing.)
- **Reconciliación tardía del optimista en multi-device** (extremo, descrito arriba): aceptable, se
  auto-sana. No bloquea nada.
- **`useStatus()` re-render del provider** en cada tick de status: mismo costo ya aceptado en las pantallas
  de campo; si en el futuro se migra a `useQuery`/`watch` (backlog 2026-06-09) se borra gratis.

## Estado

- NO marqué nada done. Espera reviewer + Gate 2.
- Commits separados sugeridos: (1) FIX 1 app — `ProfileContext.tsx` + `mas.tsx`; (2) FIX 2 test —
  `rodeos.spec.ts`; (3) backlog reconciliación (hunks aditivos, cuidar la colisión con el WIP ajeno).
