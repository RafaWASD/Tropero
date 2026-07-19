# Tasks — feature 20: reactividad de lecturas sincronizadas

> Orden de ejecución. El implementer marca `[x]`; el reviewer rechaza si queda `[ ]` sin justificación documentada.
> Convenciones obligatorias: código en inglés, UI en español (voseo), sin `any`, comentarios solo para el WHY
> (`docs/conventions.md`). Los specs E2E importan `test`/`expect` de **`./helpers/fixtures`**, NUNCA de
> `@playwright/test` (si no, las pantallas con PowerSync bootean en blanco).
>
> **Alcance: 7 archivos de app** (`design.md` §1.1-§1.2). La decisión de E1 es **evidencia afirmativa**
> (`design.md` §4.3): no hay timers, no hay confirmación por segunda lectura, no hay umbrales temporales.

---

## Fase A — lectura de la evidencia + lógica pura (primero: es lo testeable sin RN)

- [ ] **T1 — `app/src/services/powersync/local-reads.ts`: `buildActiveRoleQuery`.**
  SQL builder puro (sin imports, patrón de spec 15): `buildActiveRoleQuery(userId, establishmentId) → { sql, args }` con
  `SELECT active FROM user_roles WHERE user_id = ? AND establishment_id = ? LIMIT 1`.
  Comentario WHY obligatorio: la stream `self_user_roles` no filtra por `active` ni por `org_scope`, así que esta fila **sobrevive** a la revocación — es la evidencia afirmativa de E1.
  Cubre: R20.31.

- [ ] **T2 — `app/src/services/establishments.ts`: `hasActiveLocalRole`.**
  `hasActiveLocalRole(userId, establishmentId): Promise<'active' | 'absent_or_inactive' | 'unknown'>` vía `runLocalQuerySingle` con **`emptyIsSyncing: false`** (fila ausente = resultado legítimo, no "sincronizando"). ⚠️ Ese ya es el **default** (`local-query.ts:72`): se explicita por legibilidad, **no cambia comportamiento** (Gate 1 L3) — el comentario debe decirlo para que nadie crea que está corrigiendo algo. Mapeo según `design.md` §4.4; `active` es INTEGER → comparar con `1`, no con `true`. Error de lectura → `'unknown'` (fail-safe). **No** cambia la forma de `loadMemberships`.
  Cubre: R20.30, R20.31.

- [ ] **T3 — `app/src/utils/establishment.ts`: `assessDisappearance`.**
  Función pura `assessDisappearance({ hadValue, stillPresent, roleEvidence }) → 'present' | 'confirmed' | 'inconclusive'`, según la tabla de `design.md` §4.3. No se modifica `detectActiveLost` (sigue siendo la detección cruda); `assessDisappearance` decide sobre su resultado.
  **Prohibido**: cualquier constante de tiempo, contador de reintentos o parámetro de "re-verificación" (la confirmación temporal fue descartada — `design.md` §9.2).
  Agregar además el predicado puro del guard de emisión (Gate 1 L2):
  `shouldEmitDeferredRevocation({ pendingId, currentId, roleEvidence }) → boolean` — `true` solo si `pendingId === currentId` **y** `roleEvidence === 'absent_or_inactive'`.
  Cubre: R20.12, R20.13, R20.14, R20.15, R20.18, R20.30, R20.35.

- [ ] **T4 — `app/src/utils/establishment.ts`: `isManeuverRouteSegment`.**
  `isManeuverRouteSegment(segments: readonly string[]): boolean` → `segments[0] === 'maniobra'`. Puro, null-safe (array vacío → `false`).
  Cubre: R20.20, R20.24.

- [ ] **T5 — `app/src/utils/establishment.ts`: `sameResolvedEstablishmentState`.**
  Compara `status`, id del activo, rol, y la lista de ids+nombres de `available` (orden incluido). Sin `JSON.stringify` (no depender del orden de claves).
  Cubre: R20.11.

- [ ] **T6 — Tests unitarios de T1-T5.**
  En `app/src/utils/establishment.test.ts` y `app/src/services/powersync/local-reads.test.ts` (ambas suites **ya registradas** en `scripts/run-tests.mjs` → cero cambios de infraestructura). Casos mínimos:
  - 🎯 **El test central de E1**: `hadValue=true, stillPresent=false, roleEvidence='active'` → `'inconclusive'`. *Un checkpoint que trajo el resto pero no la fila de `establishments`, con el rol local todavía activo, **NO** concluye `active_lost`.* Determinista, sin timers.
  - `roleEvidence='absent_or_inactive'` → `'confirmed'`, **tanto con set vacío como con set poblado** (dos casos separados: la evidencia manda, no la forma del set).
  - `roleEvidence='unknown'` → `'inconclusive'` (fail-safe R20.30).
  - `stillPresent=true` → `'present'` (y el llamador no consulta la evidencia — R20.32).
  - `hadValue=false` → `'present'` aunque el set esté vacío.
  - `buildActiveRoleQuery`: args en orden `[userId, establishmentId]`, filtra por ambas columnas, `LIMIT 1`, y **no** lleva `active` en el `WHERE` (queremos leer el valor, no filtrar por él).
  - `isManeuverRouteSegment`: `['maniobra','carga']` → true; `['maniobra']` → true; `['(tabs)']` → false; `[]` → false.
  - `sameResolvedEstablishmentState`: equivalentes (objetos distintos, mismos datos) → `true`; cambio de nombre / rol / orden / status → `false`.
  - `shouldEmitDeferredRevocation` (L2): pendiente vigente + evidencia `'absent_or_inactive'` → `true`; **cambió el campo activo** (`pendingId !== currentId`) → `false`; **le reactivaron el rol** (`roleEvidence === 'active'`) → `false`; evidencia `'unknown'` → `false` (no se emite sin evidencia — coherente con R20.30).
  Cubre: R20.11–R20.15, R20.18, R20.20, R20.24, R20.30, R20.31, R20.32, R20.35.

---

## Fase B — `EstablishmentContext.tsx`

- [ ] **T7 — Reemplazar el latch por el patrón canónico.**
  Borrar el bloque `registerListener`/`lastHasSynced` (líneas ~323-350) **incluido el comentario falso de 331-332** ("la cubre el `useFocusEffect` / refresh manual existente de las pantallas" — no existe tal fallback). Agregar `useStatus()` de `@powersync/react` + `lastSyncedMs` + efecto con guard `lastSyncedMs === 0` que llama a `refreshEstablishments()`. Deps `[lastSyncedMs, userId, refreshEstablishments]` (primitivas o estables).
  **`refreshEstablishments` NO cambia de firma** y los 5 llamadores existentes (`editar-campo.tsx:134`, `invite.tsx:111`, `mas.tsx:633`, `mas.tsx:888`, `EstablishmentContext.tsx:273`) quedan intactos: con evidencia afirmativa la regla es la misma para todos los disparadores (R20.17).
  Cubre: R20.1, R20.4, R20.6, R20.7, R20.8, R20.17.

- [ ] **T8 — Guarda E1 en `applyMemberships` (evidencia afirmativa).**
  Cuando `detectActiveLost` diga que el activo no está en el set —y **solo** entonces (R20.32)— pedir `hasActiveLocalRole(userId, currentId)` y decidir con `assessDisappearance`:
  - `'confirmed'` → emitir `active_lost` (sujeto al diferimiento de T9).
  - `'inconclusive'` → **no cambiar de estado**; el próximo avance de sync re-evalúa solo (sin timer, sin ref de sospecha).
  Cuidar la carrera: la rama es `async`, así que hay que descartar el resultado si cambió el usuario o el campo activo mientras estaba en vuelo (patrón `loadSeq` ya usado en `RodeoContext`/`ProfileContext`).
  **Observabilidad de `unknown` (R20.37)**: en la transición a evidencia ilegible, `console.warn` con prefijo estable (idioma de `connector.ts:199`) incluyendo `establishmentId` + clase de error, **nunca** datos de campo ni PII. Solo en la transición, no en cada checkpoint — es higiene de log, no un contador, y no participa del veredicto. Comentario WHY apuntando a la limitación aceptada (`design.md` §4.4) y a la feature 17 como destino natural.
  Cubre: R20.12, R20.13, R20.14, R20.15, R20.16, R20.30, R20.32, R20.37.

- [ ] **T9 — Diferimiento D1 (revocación en caliente).**
  `useSegments()` + `isManeuverRouteSegment` → `inManeuverRoute`. Con veredicto `'confirmed'` y `inManeuverRoute`, guardar `pendingRevocationRef` (**`{ id, name }`**, no solo el nombre — el id lo necesita el guard de abajo) y **no** cambiar de estado. Efecto con dep `[inManeuverRoute]`: al salir de la ruta de maniobra con pendiente, emitir `active_lost` y limpiar el pendiente. Solo memoria (sin persistencia): un arranque en frío re-evalúa sin diferimiento.
  **Dos guardas obligatorias, ambas de Gate 1:**
  - **L1 / R20.33 — `available` durante el diferimiento**: mergear el campo revocado en el set (`availableRef.current` **y** el `state.available` que se expone), con el **mismo patrón que `pendingCreatedRef`** dos líneas más arriba. Sin esto, `availableRef` (fresco, sin el campo) y `state.available` (viejo, con el campo) divergen y `switchEstablishment` (`:231`) queda en **no-op silencioso** — el usuario no puede cambiarse de campo durante la ventana. Ver `design.md` §5.3.
  - **L2 / R20.35 — re-verificar al emitir**: antes de emitir `active_lost`, exigir (a) `pendingRevocation.id === currentIdRef.current` y (b) que `hasActiveLocalRole` siga devolviendo `'absent_or_inactive'`. Si alguna falla → descartar el pendiente sin emitir (evita un `active_lost` espurio nombrando un campo que el usuario sí tiene). R20.34: si cambió de campo activo, se descarta.
  Cubre: R20.20, R20.21, R20.22, R20.24, R20.25, R20.33, R20.34, R20.35.

- [ ] **T10 — Guard de equivalencia antes de `setState`.**
  Si `sameResolvedEstablishmentState(estadoVigente, resuelto)` → actualizar refs pero **no** llamar a `setState` (ni a `setRecents` si la lista es equivalente). Comentario WHY: el provider está en la raíz y su `value` se recrea en cada render → sin esto, cada checkpoint re-renderiza la app entera.
  Cubre: R20.11.

---

## Fase C — `RodeoContext.tsx`

- [ ] **T11 — Reemplazar el latch + eliminar `isWaitingRef`.**
  Borrar `isWaitingRef` (líneas ~142-143) y el bloque `registerListener`/`lastHasSynced` (~154-168). Agregar `useStatus()` + `lastSyncedMs` + efecto guardado en `0` que llama a `load(userId, establishmentId)`. Deps primitivas.
  Cubre: R20.2, R20.4, R20.5, R20.6, R20.7, R20.8.

- [ ] **T12 — `load` no tumba un estado resuelto en re-lecturas reactivas.**
  Ante `!result.ok` con un estado ya resuelto (`active`), conservar el estado y setear solo `error` — **nunca** `setState({ status: 'loading' })` (eso manda la app entera al splash vía `RootGate`). El comportamiento del bootstrap (sin estado resuelto) queda idéntico al de hoy.
  Cubre: R20.10.

- [ ] **T13 — Evidencia afirmativa para `no_rodeos` + preservación del rodeo activo.**
  🔴 **Es la task que sostiene D1** (`design.md` §8 riesgo 7): al revocarse el acceso, PowerSync borra también el bucket de rodeos → `fetchRodeos` devuelve `[]` → sin esta guarda el `RootGate` haría `replace('/crear-rodeo')` **sobre la pantalla de maniobra**, pateando al operario aunque `EstablishmentContext` haya diferido bien.
  Con set vacío, consultar `hasActiveLocalRole(userId, establishmentId)` y concluir `no_rodeos` **solo** con `roleEvidence === 'active'`; con `'absent_or_inactive'` o `'unknown'`, conservar el estado.
  Verificar además por test que un set poblado que contiene el rodeo activo **no** cambia la selección.
  Cubre: R20.18, R20.19, R20.30.

---

## Fase D — `lotes.tsx` y copy

- [ ] **T14 — `app/app/lotes.tsx`: efecto reactivo silencioso.**
  Junto al `useEffect` mount-only (~línea 115), agregar `useStatus()` + `lastSyncedMs` + efecto con guard `lastSyncedMs === 0` que llama a **`load({ silent: true })`**. `silent` es obligatorio: la ruta no-silenciosa setea `loading` (desmonta la lista, resetea el scroll) y ante un fallo hace `setGroups([])`.
  Cubre: R20.3, R20.9, R20.7, R20.10.

- [ ] **T15 — `app/app/campo-perdido.tsx`: copy verdadero para ambas causas (E5).**
  Reemplazar el subtítulo de la rama `role_revoked` por uno que no afirme una causa única: *"Ya no tenés acceso a este campo. Puede que te lo hayan quitado o que el campo se haya eliminado. Tu cuenta sigue activa."* El texto no debe afirmar ni sugerir que los datos cargados durante una maniobra se conservaron o se subieron (R20.26 — eso es E2, fuera de alcance). Comentario WHY apuntando a la migración 0076 + `remove_member` (ambos escriben `active=false` + `deactivated_at`, ver `design.md` §6.1) y marcar la rama `establishment_deleted` como hoy no alcanzable.
  Cubre: R20.26, R20.27, R20.28, R20.29.

---

## Fase E — E2E (Playwright)

- [ ] **T16 — Helpers de fixture en `app/e2e/helpers/admin.ts`.**
  🔴 **El fixture DEBE espejar `remove_member` completo** (Gate 1 HIGH-1 / `design.md` §8 riesgo 8). `remove_member` hace **dos** cosas (`index.ts:87-113`) y la versión anterior de esta task solo describía la primera, lo que habría dado un **falso verde** en T21:
  ```
  revokeMemberRole(userId, establishmentId, { revokeSession = true })
    1) update user_roles set active = false, deactivated_at = now()   ← el rol
    2) admin.rpc('revoke_user_sessions', { target_uid: userId })      ← la sesión (0072)
  ```
  El flag existe para que un test pueda aislar a propósito el camino "campo borrado" (donde el trigger `0076` **no** revoca sesión); el **default es `true` = paridad con producción**. Si algún test lo pone en `false`, su header debe decir explícitamente qué parte del camino real NO cubre y por qué.
  Agregar además `waitForServerRoleInactive(userId, establishmentId)` y `assertServerSessionsRevoked(userId)` (lee `auth.sessions` vía service_role; la usa T21 para probar que el fixture hizo lo que dice). Reusar `seedEstablishment`, `seedRodeo`, `seedEstablishmentWithRodeo`, `addMember`, `seedManagementGroup`, `seedActiveSession`. Registrar lo creado para el cleanup por `RUN_TAG`.
  Cubre: infraestructura de T17-T22; R20.36 (honestidad del camino testeado).

- [ ] **T17 — `app/e2e/reactividad-sync.spec.ts` · caso 1: campo en caliente (EL criterio A8).**
  Usuario con 1 campo + rodeo → `signIn` → `waitForHome`. **A mitad del test**, server-side: `seedEstablishment` (campo B) + `seedRodeo` + rol activo. Sin `page.reload()` ni re-login, abrir el switch de campos y assertear que el campo B aparece. Timeout ≥60 s (hay que esperar un checkpoint real). Documentar en el header que **cualquier `reload()` invalida el test**.
  Cubre: R20.1, R20.4, R20.9, R20.11.

- [ ] **T18 — `reactividad-sync.spec.ts` · caso 2: rodeo en caliente.**
  Con la home montada, `seedRodeo` server-side sobre el campo activo → el selector lo muestra sin reiniciar. Segundo tramo: renombrar el rodeo vía service_role → el nombre se actualiza sin reiniciar y el rodeo activo **no** cambia (R20.19).
  Cubre: R20.2, R20.5, R20.19.

- [ ] **T19 — `reactividad-sync.spec.ts` · caso 3: lote en caliente.**
  Navegar a `/lotes` y **quedarse ahí**. `seedManagementGroup` server-side → el lote aparece sin salir ni volver a entrar (hoy es mount-only: sin el fix, este test falla). Assertear que la lista no se blanquea.
  Cubre: R20.3, R20.9.

- [ ] **T20 — `reactividad-sync.spec.ts` · caso 4: revocación fuera de maniobra.**
  Usuario miembro de 2 campos, activo en A, parado en la home. `revokeMemberRole` sobre A → sin reiniciar aparece `/campo-perdido`; el texto **no** afirma una causa única y **no** promete que se conservaron datos. "Entendido" → re-ruteo a los campos restantes.
  Cubre: R20.14, R20.23, R20.24, R20.26, R20.28.

- [ ] **T21 — `reactividad-sync.spec.ts` · caso 5: revocación DURANTE la maniobra (D1 + riesgos 7 y 8).**
  Sembrar sesión activa (`seedActiveSession`) y entrar al flujo `/maniobra/...`. `revokeMemberRole` (con `revokeSession: true`, o sea el camino real) sobre el campo activo. Asserts:
  1. **`assertServerSessionsRevoked(userId)`** — antes de nada, probar que el fixture ejecutó el camino de producción. Sin esto el resto del test no prueba lo que dice (riesgo 8).
  2. Con el oráculo correcto (**presencia de un testID exclusivo de la pantalla de maniobra**, no ausencia de un texto del destino: la pantalla de fondo sigue montada detrás del scrim), que en ≥20 s **no** se navegó ni a `/campo-perdido` **ni a `/crear-rodeo`** — el segundo cubre el riesgo 7 (`RodeoContext` anulando el diferimiento).
  3. Salir del flujo → recién ahí aparece `/campo-perdido`.
  4. **Intentar el switch de campo durante el diferimiento** (usuario con 2 campos): debe cambiar a B de verdad, no quedar en no-op silencioso (R20.33), y al salir de la maniobra **no** debe aparecer `/campo-perdido` porque el pendiente se descartó (R20.34).
  📌 **Header obligatorio del spec**: declarar que lo que se verifica es el diferimiento **dentro de la vida del access token** (`jwt_expiry = 3600`). El bounce a login posterior es real, es D1.2, y **no es testeable acá**: esperar 1 h no es viable y acortar `jwt_expiry` implica tocar config compartida (fuera de alcance). No se puede escribir un assert que sugiera que la maniobra sobrevive indefinidamente a una remoción.
  Cubre: R20.18, R20.20, R20.21, R20.22, R20.33, R20.34.

- [ ] **T22 — `reactividad-sync.spec.ts` · caso 6: offline puro intacto.**
  Con `context.setOffline(true)` desde el arranque (sin ningún sync completado), la app no debe cambiar de estado ni caer a `campo-perdido`/`onboarding`/`crear-rodeo` por el efecto reactivo. Reusar el patrón de `animals-offline.spec.ts` / `maniobra-offline.spec.ts`.
  Cubre: R20.7, R20.8, R20.10, R20.30.

---

## Fase F — cierre

- [ ] **T23 — Autorrevisión adversarial del implementer** (paso 8 de su protocolo) sobre los 7 archivos: (a) deps de efecto no primitivas; (b) algún `setState` que blanquee en re-lectura reactiva; (c) **cualquier constante de tiempo o reintento que se haya colado en el camino de E1** (no debe existir ninguna); (d) que ningún camino pueda emitir `active_lost` o `no_rodeos` sin `roleEvidence === 'absent_or_inactive'` / `'active'` respectivamente; (e) carreras de la rama async de T8 (usuario o campo cambiados en vuelo); (f) que `availableRef.current` y `state.available` **nunca** diverjan durante el diferimiento (L1); (g) que el log de `unknown` no arrastre datos de campo ni PII.
  Cubre: R20.6, R20.9, R20.10, R20.12, R20.13, R20.18, R20.30.

- [ ] **T24 — Reconciliación de specs (regla dura, ANTES de cerrar).**
  (0) `context.md` de esta feature → **ya reconciliado** con **D1.2** (diferimiento acotado a la vigencia de la sesión, Gate 1 HIGH-1 + decisión de Raf); verificar que siga coherente con el as-built al cerrar. Informe de Gate 1: `progress/security_spec_20-reactividad-sync.md`;
  (a) `specs/active/01-identity-multitenancy/` → nota as-built bajo `R6.10` (y, si corresponde, puntero a D1.2 desde el gate `active_lost`); (b) `specs/active/15-powersync/design.md` → acotar el bullet "One-shot `getAll`, NO `db.watch` (reactividad diferida)" a que ya no aplica a estos tres consumidores, y anotar la lectura local nueva de `user_roles`; (c) `docs/backlog.md` → E2 (con evidencia), "rodeo activo borrado por un coworker durante una maniobra" (design §8 riesgo 6), y "distinguir campo borrado de rol revocado requiere señal server-side" (design §6).
  **(d) 🔒 Candado de la dependencia oculta (Gate 1 RE-GATE, hallazgo RG-1).** TODA la regla de evidencia afirmativa cuelga de que la stream `self_user_roles` **no tenga filtro `active`**: hoy es `SELECT * FROM user_roles WHERE user_id = auth.user_id()` (`sync-streams/rafaq.yaml:71-74`), sin `org_scope` y sin `AND active = true`, y por eso la fila propia sobrevive a la revocación con `active = 0`. Una "optimización" que agregue ese filtro **rompe la feature en silencio**: la fila desaparecería y el veredicto pasaría a `absent_or_inactive` siempre que el bucket se demore → vuelven los falsos `active_lost` que esta feature vino a evitar. Falla **cerrada** (no es fuga), pero es exactamente el modo de falla que estamos arreglando.
  Por eso el candado va **donde alguien edita**, no solo donde alguien especifica: **(d.1)** comentario en `sync-streams/rafaq.yaml`, pegado a la stream `self_user_roles`, diciendo que la ausencia del filtro `active` es **load-bearing** para la feature 20 y por qué; **(d.2)** la misma nota en `specs/active/15-powersync/design.md`, que es lo que se lee antes de tocar streams. El (d.1) es el que realmente protege: el YAML no se puede editar sin verlo.
  Cubre: trazabilidad del proceso + RG-1.

- [ ] **T25 — Verificación verde**: `node scripts/check.mjs` + la suite E2E de la feature. Documentar el mapa `R20.<n> → archivo:test` en `progress/impl_20-reactividad-sync.md`.
  Cubre: todos.

---

## Mapa de cobertura (cada `R<n>` tiene ≥1 task)

| Requisito | Tasks |
|---|---|
| R20.1 | T7, T17 |
| R20.2 | T11, T18 |
| R20.3 | T14, T19 |
| R20.4 | T7, T11, T17 |
| R20.5 | T11, T18 |
| R20.6 | T7, T11, T23 |
| R20.7 | T7, T11, T14, T22 |
| R20.8 | T7, T11, T22 |
| R20.9 | T14, T17, T19, T23 |
| R20.10 | T12, T14, T22, T23 |
| R20.11 | T5, T6, T10, T17 |
| R20.12 | T3, T6, T8, T23 |
| R20.13 | T3, T6, T8, T23 |
| R20.14 | T3, T6, T8, T20 |
| R20.15 | T3, T6, T8 |
| R20.16 | T8 |
| R20.17 | T7 |
| R20.18 | T3, T6, T13, T21, T23 |
| R20.19 | T13, T18 |
| R20.20 | T4, T6, T9, T21 |
| R20.21 | T9, T21 |
| R20.22 | T9, T21 |
| R20.23 | T20 |
| R20.24 | T4, T6, T9, T20 |
| R20.25 | T9 |
| R20.26 | T15, T20 |
| R20.27 | T15 |
| R20.28 | T15, T20 |
| R20.29 | T15 |
| R20.30 | T2, T6, T13, T22, T23 |
| R20.31 | T1, T2, T6 |
| R20.32 | T6, T8 |
| R20.33 | T9, T21 |
| R20.34 | T9, T21 |
| R20.35 | T3, T6, T9 |
| R20.36 | T16, T21 (header + límite declarado) |
| R20.37 | T8 |
