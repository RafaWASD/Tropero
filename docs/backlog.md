# Backlog

Overflow de scope: ítems que aparecieron durante una sesión pero exceden su objetivo. Se anotan acá para no perderse y se procesan después como feature nueva, ADR, spec o nota informativa.

No es un sustituto de `feature_list.json` ni de los ADRs — es la antesala donde se acumulan cosas pendientes de clasificar.

## Formato

````
## YYYY-MM-DD — <título corto>

**Origen**: sesión X, mientras se trabajaba en Y.
**Qué**: descripción breve.
**Por qué importa**: 1-2 líneas.
**Próximo paso sugerido**: feature nueva en `feature_list.json` / ADR / spec / nada (info).
````

## Ítems pendientes

## 2026-06-11 — 2 LOW del Gate 2 del fix ProfileContext first-sync (no bloqueantes)

**Origen**: Gate 2 (security_analyzer, code mode) del fix de e2e rojos (Run e2e-rojos-fix), `progress/security_code_e2e-rojos-fix.md`.
**Qué**: (1) **Optimista pegado en multi-device** — el gate de reconciliación de `ProfileContext.tsx` (`pendingOptimisticNameRef`, ~líneas 118-122) que evita revertir el saludo recién editado también bloquea, durante esa ventana, un update de `phone` que venga por sync-down de OTRO device; `refresh()` no lo fuerza. Es staleness de data del PROPIO usuario (no leak), ya reconocido por el implementer. (2) **Ventana pre-existente** de `namePhone` in-flight en un switch de usuario sin null intermedio — teórica y ANTERIOR al diff (no la introduce este cambio).
**Por qué importa**: bajo — ninguno cruza frontera de usuario/tenant; es data propia con staleness acotada. El gate los clasificó LOW, no bloqueantes.
**Próximo paso sugerido**: ambos desaparecen con la migración del data layer a `useQuery`/`watch` (entrada 2026-06-09) — el watch reactivo re-renderiza ante cualquier cambio del SQLite local sin la maquinaria de re-eval manual ni el ref optimista. No tocar ahora; foldear en esa migración.

## 2026-06-11 — `created_by` spoofeable en eventos por INSERT directo a PostgREST (MED, pre-existente)

**Origen**: Gate 2 (security_analyzer, code mode) del fix del flake de estado repro (Run backlog-flake-repro).
Finding MEDIUM **fuera del diff** (pre-existente), anotado por recomendación del gate.
**Qué**: `tg_set_created_by_auth_uid()` (`supabase/migrations/0024…:8-10`) rellena `created_by` SOLO si viene
NULL → un cliente que pega directo a PostgREST (saltando la app) puede setear `created_by` a OTRO usuario.
De paso, como la policy UPDATE de `reproductive_events` (`0026:69`) habilita por `created_by = auth.uid()`,
atribuir el evento a otro usuario le daría a ese usuario derechos de UPDATE sobre la fila. Mismo patrón
aplica a las otras tablas de evento que usan ese trigger condicional.
**Por qué importa**: medio — es mismo-tenant (la policy INSERT exige `has_role_in` del establecimiento del
animal, no cruza frontera de tenant ni escala fuera del campo), pero ensucia la auditoría de autoría y
puede regalar permisos de edición. El trail regulatorio (ADR-017, `animal_category_history.changed_at`)
sigue sellado server-side, intacto.
**Próximo paso sugerido**: en una pasada de hardening, forzar `created_by` INCONDICIONAL estilo el
`establishment_id` de `0077:68` (`NEW.created_by := auth.uid()` siempre, SECURITY DEFINER) en el trigger
de las tablas de evento. No-breaking para la app (que nunca manda `created_by`). Nada urgente.

## 2026-06-11 — 2 LOW del Gate 2 de C6 (clase baseline, no bloqueantes)

Del reporte `progress/security_code_02-c6-categoria-espejo.md`: (1) `err.message` crudo de SQLite
local puede llegar a la card del revert vía `kind:'unknown'` — patrón baseline de `local-query.ts`,
no cruza trust boundary; unificar copy cuando se toque esa capa. (2) stale-auth en replay del revert
offline — clase ya aceptada en spec 15 (el server falla cerrado al subir). Sin acción inmediata.

## 2026-06-11 — `deriveCurrentState` desempata por UUID random los eventos repro del mismo día sin `created_at` (flake offline) ✅ RESUELTO

**✅ RESUELTO (2026-06-11, Run backlog-flake-repro)**: DOS cambios complementarios (frontend puro, sin schema/RLS/migraciones). (1) Los INSERT CRUD-plano de `reproductive_events` (tacto/service/abortion) ahora setean `created_at` de CLIENTE (`new Date().toISOString()`) → TODOS los determinantes repro (incluido el parto del overlay, que ya lo traía) tienen un instante REAL de creación. Server-side `created_at` es `default now()` SIN trigger de force (0026) → el valor de cliente persiste, y es semánticamente mejor (instante de CREACIÓN, no de subida) para un evento offline. (2) Se reemplazó el desempate por `eventId` (UUID v4 random) por un `seq` = orden de lectura de `buildTimelineQuery` (que ahora ordena `event_date ASC, created_at IS NULL ASC, created_at ASC` en un SELECT externo que envuelve el UNION; antes `DESC`, cosmético) → `fetchTimeline` asigna `seq`; `isNewerRepro`/`parseTimeline` lo usan como desempate estable. Con (1) el caso realista es "ambos created_at presentes" → el insertado DESPUÉS gana, DETERMINÍSTICO. **Diagnóstico clave (vía DIAG en e2e)**: el approach read-only puro NO alcanzaba — el parto del overlay tenía created_at de cliente mientras el tacto CRUD-plano quedaba NULL hasta sincronizar, y ni "null=más reciente" ni "presente gana" eran universalmente correctos; el created_at de cliente en (1) elimina la ambigüedad. Tests unit nuevos + guard de ORDER BY + 2 tests de comportamiento node:sqlite. e2e `events.spec.ts` (parto/aborto/parto-mellizos): verde y DETERMINÍSTICO con `--repeat-each=5` (10/10 parto-mellizos, 15/15 los otros 3). Detalle en `progress/impl_backlog-flake-repro.md`. Se mantiene la entrada por trazabilidad.

**Origen**: chunk C6 (espejo de categoría), re-verificando los e2e de events. El espejo de CATEGORÍA (badge) ya quedó robusto al caso offline (desempate por índice de array, RC6.1.4); el espejo de ESTADO REPRODUCTIVO (`deriveCurrentState` en `app/src/utils/event-timeline.ts`, la fila "Estado reproductivo: Preñada/Vacía") NO.
**Qué**: cuando dos eventos repro determinantes de preñez (tacto/birth/abortion) caen el MISMO `event_date` y ambos tienen `created_at = null` (caso REALISTA: se cargan offline por CRUD plano y el trigger sella el `created_at` recién al subir), `isNewerRepro` cae al desempate por `eventId` — que es un UUID v4 RANDOM → ~50/50 cuál "gana". Efecto: tras un PARTO o un ABORTO cargado offline el mismo día que el tacto previo, la fila "Estado reproductivo" muestra "Preñada" en vez de "Vacía" la mitad de las veces. El BADGE de categoría YA quedó correcto con C6 (deriva por índice de array); solo la fila de estado reproductivo arrastra el bug.
**Evidencia**: `events.spec.ts` tests "parto en hembra PREÑADA → Vacía" (rojo crónico en HEAD) y "aborto → Vacía" (verde/rojo intermitente según el UUID). Con C6 el badge de esos tests transiciona bien ("Vaca segundo servicio" / la categoría correcta); falla SOLO el `getByText(/^Vacía · /)`.
**Por qué importa**: es la misma clase de bug que C6 resolvió para categorías, en un módulo vecino; deja 1-2 e2e crónicamente flaky (la suite es el oráculo de regresión) y, en campo, muestra "Preñada" a una vaca que acaba de parir/abortar offline hasta el sync.
**Fix sugerido**: en `isNewerRepro` (event-timeline.ts), cuando `event_date` empata y `created_at` falta/empata en ambos, desempatar por la POSICIÓN en el timeline ya ordenado (`parseTimeline` ordena por día desc + createdAt desc) en vez de por `eventId` — espejo del fix de índice de array del espejo de categoría (RC6.1.4). O, de fondo: que las escrituras locales de evento (events.ts) seteen un `created_at` de cliente provisional. Fuera de scope de C6 (otro módulo, otra superficie).
**Próximo paso sugerido**: run chico (otro modelo) sobre `event-timeline.ts` + sus tests unit + re-verificar los 2 e2e. Relacionado con el triage de los 8 e2e rojos de abajo (los de events que NO eran el gap del badge).

## 2026-06-10 — 8 e2e rojos PRE-EXISTENTES en HEAD (account/events×3/profile×3/rodeos) — triage pendiente

**Origen**: run T7.9 de feature 15. El implementer los reportó como pre-existentes; el reviewer lo
CONFIRMÓ con worktree limpio sobre HEAD `55d5700` (8 failed / 12 passed, fallos de ASERCIÓN, no de
red — evidencia en `progress/review_15-powersync.md` § "Review — Run T7.9").
**Qué**: `account.spec.ts` (1), `events.spec.ts` (3), `profile.spec.ts` (3), `rodeos.spec.ts` (1)
fallan en HEAD. Al menos los de events incluyen el badge "vaquillona preñada" = el gap de transición
de categoría server-side (entrada 2026-06-10 arriba, DECIDIDO → chunk C6 de spec 02). El resto sin
diagnóstico individual; sospecha: flakiness sobre la DB beta contaminada y/o timing.
**Por qué importa**: la suite e2e es el oráculo de regresión del repo (regla: testear con Playwright,
no a mano) — con 8 rojos crónicos el verde deja de significar algo y los gates pierden señal.
**Próximo paso sugerido**: triage spec por spec tras cerrar feature 15: (a) los que cierra C6 →
verificar al implementar C6; (b) los de flakiness/data → arreglar asserts o aislar data; (c) si
alguno es bug real de producto → feature/fix con su propio ciclo.

## 2026-06-10 — Transiciones de categoría NO visibles offline (recálculo es server-side) ✅ DECIDIDO (2026-06-10)

**✅ Alcance decidido por Raf (2026-06-10)**: opción A — **espejo client-side display-only** de
`compute_category` (port a TS puro, solo vista, server sigue siendo la verdad) **+ badge de
override en la ficha + acción quitar fijación** (el caso "1212" NO era offline: tenía
`category_override=true` y el server no transiciona ni online, R4.9). Gate 0 escrito y aprobado:
`specs/active/02-modelo-animal/context-c6-categoria-espejo.md` (chunk C6 de spec 02, frontend
puro). Arranca al cerrar la feature 15 (WIP=1). Entrada original abajo para contexto:

**Origen**: testing en vivo de Raf post-fix del alta offline (sesión bugfix 15-powersync). Lo golpeó DOS
veces en el mismo día: (1) tactos+/servicios sobre "1212" (ahí además había override=true), (2) servicio
sobre una ternera año-2025 sin override — la categoría no cambia hasta reconectar.
**Qué**: `compute_category` corre como trigger server-side en el INSERT del evento (Tier 2, 0062/0063/0046);
offline el evento queda guardado local + encolado, pero la categoría visible es la vieja hasta que el ciclo
reconectar→subir evento→recalc→sync-down del perfil completa. Diseño vigente y correcto (LWW, estado
derivado server-side), pero la expectativa de campo es "la puse en servicio → la veo vaquillona AHORA".
**Por qué importa**: UX de manga — el operario carga eventos en el corral sin señal y no ve el efecto; puede
dudar de si "se guardó bien" (misma clase de desconfianza que el bug recién cerrado, aunque acá no se pierde
nada). Pilar "mejor en el primer try".
**Próximo paso sugerido**: evaluar un recálculo ESPEJO client-side (port de compute_category a TS puro,
aplicado solo a la VISTA local/overlay — el server sigue siendo la verdad y pisa al sincronizar; LWW lo hace
seguro) o, mínimo, un hint de UI ("categoría se actualiza al sincronizar") en la ficha cuando hay eventos
pendientes. Decidir alcance con Raf antes de especificar; relacionado con la migración a useQuery/watch
(entrada 2026-06-09).

## 2026-06-10 — 🐛 BUG: animal creado OFFLINE desaparece de la lista al navegar de tab ✅ RESUELTO (2 causas raíz)

**✅ CERRADO (2026-06-10, Run create-animal-rpc)**: la 2da causa (pérdida real en el upload, detalle abajo)
se cerró con la **RPC atómica `create_animal` (migración 0083, APLICADA al remoto)** — una sola transacción
server-side (sin half-state posible), idempotente por ids de cliente (`ON CONFLICT (id) DO NOTHING` solo-PK),
guards anti-IDOR (patrón 0081), y **healing**: un `animals` huérfano del camino viejo deja de bloquear (el
replay completa el perfil). Cliente: `upload.ts` mapea `create_animal` → RPC traduciendo el shape histórico
de los intents ya encolados; `connector.ts` elimina la rama de 2 upserts. Gates: Gate 1 PASS 0 HIGH +
reviewer APPROVED + Gate 2 PASS 0 HIGH. Verificación: suite backend "All tests passed" post-apply (7 tests
nuevos: happy/replay/**healing del half-state = el caso del bug**/cross-tenant/idv-dup/tag-dup/anti-IDOR) +
E2E con **oráculo de persistencia server-side nuevo** (`waitForServerAnimalProfile`) 2/2 verdes — y prueba
A/B en vivo del reviewer: contra el build viejo el oráculo cazó la cadena exacta (403→42501→"upload
rechazado"); con el build nuevo, verde. **Residuo NO auto-sanable**: los animales "12"/"211" de Raf
perdieron su intent (descartado) → irrecuperables; sus filas huérfanas en `animals` (sin perfil, invisibles)
quedan para la limpieza de la DB beta (entrada 2026-06-08). Re-crear los animales a mano.

**(2da causa, cerrada — pérdida real en el upload)** (diagnóstico original, 2026-06-10 — Raf re-reprodujo con IDV "211", multípara, mismo campo): el fix del
buscador stale era REAL pero parcial. La 2da causa raíz, confirmada por el leader con los logs de la API de
Supabase + estado de la DB remota: **el upsert de `create_animal` en `uploadData` NO es idempotente bajo RLS
y PIERDE el dato en el reintento**. Cadena: (1) `applyIntentTransaction` aplica el alta como 2 upserts HTTP
NO atómicos (`animals` → `animal_profiles`); (2) si el drenado se interrumpe ENTRE ambos (toggle de red al
testear, tab cerrada, fetch caído → transient → re-throw y reintento), queda `animals` insertado SIN perfil
(huérfano, invisible por RLS); (3) el REINTENTO del upsert de `animals` pega el **conflicto de PK → rama
`ON CONFLICT DO UPDATE` → la policy UPDATE de `animals` exige `EXISTS animal_profiles visible` → el perfil
no existe → 42501/403**; (4) `classifyIntentUploadError('42501')` = `permanent_reject` → `rollbackOverlay`
borra el overlay + descarta el intent → **el animal desaparece de la UI y NUNCA llega al server**; (5) los
eventos post-create encolados (condición corporal de la multípara) fallan después con FK 23503 → 409 y
también se descartan. Evidencia: logs API de la sesión real de Raf muestran `POST /rest/v1/animals → 403` +
`POST /rest/v1/condition_score_events → 409` SIN ningún POST de `animal_profiles` (la tx aborta antes); el
campo `037ac0a5…` tiene CERO `animal_profiles` server-side (ni "12" ni "211" llegaron jamás); quedan filas
huérfanas en `animals`. Los datos de "12"/"211" son IRRECUPERABLES (idv/categoría vivían en el perfil que
nunca llegó; el overlay fue borrado). **Por qué ningún test lo cazó**: los E2E offline nunca dejan correr el
upload; los E2E online asertan la UI (que muestra el OVERLAY) y no verifican persistencia server-side →
ninguna alta vía app aterriza en el server desde el swap a outbox (72b3239) sin que la suite lo note. El fix
DEBE incluir un oráculo de persistencia server-side post-alta online. Fix candidato: RPC `create_animal`
atómica server-side (patrón 0081 `create_rodeo`) o upserts `ignoreDuplicates` (ON CONFLICT DO NOTHING, sin
rama UPDATE) — decisión con Raf en curso. Lo de abajo documenta la 1ra causa (buscador stale), que SIGUE
arreglada.

**(1ra causa, cerrada — buscador stale)** (2026-06-10, Run bugfix-overlay-list de 15-powersync): causa raíz = **estado de UI stale del BUSCADOR**, NO pérdida de datos. El overlay local está SANO: el repro E2E instrumentado (export prod Y dev server Metro, `context.setOffline(true)` + dump del SQLite local + captura de consola) probó que el animal queda en `pending_animal_profiles`, que `buildAnimalsListQuery` lo devuelve, y que el upload offline clasifica **transient** en 10+ ciclos de retry (`TypeError: Failed to fetch`, `code:''` → cero `[powersync] upload rechazado`, cero rollback) — hipótesis 1/2/3/4 de abajo DESCARTADAS con evidencia. El defecto real: `animales.tsx` re-corría la LISTA al re-enfocar la tab pero NO la BÚSQUEDA activa → con un término en el buscador (el find-or-create de la manga: tipear el número → no-match → "Dar de alta este animal"), cada vuelta a la tab (p.ej. Más → Animales) mostraba el no-match VIEJO "No encontramos «N»" = "el animal ya no está". Fix: `runSearch` extraído a callback + re-corrido en `useFocusEffect` y en el efecto de `lastSyncedAt` (simétrico a `loadList`). E2E nuevos (`app/e2e/animals-offline.spec.ts`, primeros tests offline reales de la suite): repro literal de este backlog (verde ya en baseline — queda de red de regresión del overlay) + alta vía buscador no-match (ROJO en baseline → VERDE con el fix, verificado por stash en el mismo harness). Detalle en `progress/impl_15-powersync.md` (Run bugfix-overlay-list). Se mantiene el registro por trazabilidad.

**Origen**: validación en vivo de Raf (web, dev server `pnpm web`, código de hoy con commits 72b3239/05a7321/8ffbc80). Repro determinístico.
**Repro**: campo "nombre de campo de prueba" (`037ac0a5-aaea-4ede-8894-451540c8f3bd`; 2 rodeos: "Cria hembras" `845df40d`, "adsads" `36f40b6b`; 0 animales server-side). Network→Offline → crear animal con IDV "12" → ir a la tab "Más" → volver a "Animales" → **el animal "12" YA NO ESTÁ en la lista**.
**Naturaleza**: el animal es OFFLINE-ONLY → vive solo en el overlay local (`pending_animals`/`pending_animal_profiles` del SQLite de PowerSync en el browser); NO llega al servidor → NO se ve con `execute_sql`. Es un bug de **LECTURA/CONTEXTO LOCAL**, NO de pérdida de dato server-side. Campo2 (animales sincronizados) muestra OK → el fix de first-sync (05a7321) anda; ESTO es distinto.
**Hipótesis (a investigar, en orden)**:
1. **Filtro de RODEO activo de la tab Animales** (`app/app/(tabs)/animales.tsx` → `fetchAnimals(est, { rodeoId })`): el animal se crea en el rodeo activo al alta; al VOLVER, si el rodeo activo/filtro re-resuelve a OTRO de los 2 rodeos del campo (`RodeoContext`), la lista (scopeada a ese rodeo) no contiene el overlay → "desaparece". Ver `RodeoContext` + el default del filtro de la tab + estabilidad del rodeo activo entre navegaciones (el `useFocusEffect` re-corre `loadList`).
2. **INNER JOIN del overlay** en `buildAnimalsListQuery` (`local-reads.ts`, `LOCAL_LIST_SELECT_OVERLAY`): la rama overlay hace `JOIN rodeos` (tabla SINCRONIZADA) + `JOIN categories_by_system`. Si el rodeo del alta NO está en la tabla synced `rodeos` del local (p.ej. rodeo creado offline → vive en `pending_rodeos`, no en `rodeos`; o lag de sync de ese rodeo), el INNER JOIN descarta el animal → invisible. Verificar si el rodeo usado para el alta está synced en el local.
3. **establishment_id/rodeo_id del overlay** ≠ el contexto activo al volver (contexto de campo/rodeo stale entre crear y volver).
4. El `writeTransaction` de `enqueueCreateAnimal` (`outbox.ts`) no persiste, o un `clearOverlay`/`rollbackOverlay` espurio se dispara offline.
**Verificación preferida (NO testear a mano)**: test E2E (la suite ya es PowerSync-aware) con 1 campo + 2 rodeos: crear animal vía wizard → navegar a otra tab y volver → assertir que SIGUE en la lista. `context.setOffline(true)` para el caso offline puro.
**Archivos**: `app/app/(tabs)/animales.tsx`, `app/src/contexts/RodeoContext.tsx`, `app/src/contexts/EstablishmentContext.tsx`, `app/src/services/powersync/local-reads.ts` (`buildAnimalsListQuery` rama overlay), `app/src/services/powersync/outbox.ts` (`enqueueCreateAnimal`), `app/src/services/animals.ts` (`createAnimal`), `app/app/crear-animal.tsx`.
**Próximo paso**: una sesión nueva (otro modelo) lo diagnostica + arregla. Relacionado con el gap de reactividad del overlay descrito abajo (un write puro del overlay no re-renderiza sin re-foco — pero acá SÍ hay re-foco por la navegación, así que apuntá primero al filtro de rodeo / JOIN del overlay).

## 2026-06-10 — Surfacing en UI de los rechazos PERMANENTES de upload (hoy solo console.warn)

**Origen**: Run create-animal-rpc (15-powersync), al cerrar la cadena del bug de pérdida del alta.
**Qué**: cuando `uploadData` clasifica un rechazo como `permanent_reject` (42501, 23505 de tag/idv duplicado, FK 23503, intent corrupto), hace rollback del overlay + descarta el intent + `console.warn('[powersync] upload rechazado (descartado)')` — y NADA visible para el usuario: el animal/parto/baja simplemente desaparece de la UI sin explicación. R10.2 pide "registro observable" y R8.1 "superficiar el rechazo de forma legible"; el console.warn cumple lo primero pero no lo segundo. Con la RPC 0083 el caso espurio (el bug) ya no existe, pero los rechazos LEGÍTIMOS (caravana/IDV duplicada cargada offline, rol perdido `active_lost`) siguen siendo silenciosos — el operario cree que cargó el animal y lo pierde sin aviso.
**Por qué importa**: pérdida de dato PERCIBIDA como bug (aunque sea un rechazo legítimo). En la manga nadie mira la consola. Rompe "el mejor en el primer try".
**Próximo paso sugerido**: run chico de UX — canal de status ya existente (`status.ts` / `pending ops`): acumular los rechazos en una tablita local (o en memoria + badge en el header de sync) con copy es-AR accionable ("No pudimos guardar el animal 211: caravana duplicada"). Decisión de producto sobre dónde mostrarlo (toast al reconectar vs. bandeja de "pendientes con error"). NO implementado en este run (fuera de alcance).

## 2026-06-10 — ProfileContext queda en "Sin conexión: no pudimos actualizar tu perfil" si la carga corre antes del first-sync (y la tab Más lo muestra) ✅ RESUELTO (2026-06-11, Run e2e-rojos-fix)

**✅ CERRADO (2026-06-11, Run e2e-rojos-fix)**: era un bug FUNCIONAL determinístico (no solo cosmético): bloqueaba "Editar perfil" / "Cambiar email" en el arranque hasta un retry manual (triage `progress/triage_e2e_rojos.md` lo demostró con 4 e2e rojos deterministas: account:151 + profile:54/75/110, todos en `gotoTab('Más')`). Fix en `app/src/contexts/ProfileContext.tsx`: efecto reactivo que re-lee el perfil cuando AVANZA `lastSyncedAt` (vía `useStatus()` de `@powersync/react`, patrón canónico de `animales.tsx:192`/`index.tsx:415`) → al completar el first-sync se limpia el `error` espurio y carga el perfil; "Más" rendea la sección Perfil. Caso offline-puro intacto (sin sync nunca → `lastSyncedMs===0`, el efecto no dispara, fallback de saludo sigue, sin loop). Al destrabar el ancla `:54`, el e2e profile:38 reveló un SEGUNDO síntoma del mismo gap de reactividad: el saludo de la home no se actualizaba tras editar el nombre porque `saveProfile` es ONLINE-direct a `public.users` pero la lectura viene del SQLite local (lag de sync-down) → se cerró con aterrizaje OPTIMISTA (`applyOwnProfile`: el saludo refleja el valor recién guardado al instante; el sync-down reconcilia; un marcador `pendingOptimisticNameRef` evita que un sync-down de otras tablas revierta el saludo con el valor viejo). Verificación: profile.spec.ts + account.spec.ts 18/18 verde con `--repeat-each=3` (era 4 rojos det.). NO se tocaron los tests (sus asserts eran correctos). Detalle en `progress/impl_e2e-rojos-fix.md`. Entrada original abajo por trazabilidad:

**Origen**: Run bugfix-overlay-list (15-powersync), hallazgo lateral del repro E2E offline (el ancla "Editar perfil" de la tab Más no aparecía).
**Qué**: `ProfileContext` carga name/phone UNA vez al resolver `userId` (`useEffect [userId]`) — típicamente ANTES del first-sync de PowerSync → `runLocalQuerySingle` degrada "vacío + !hasSynced" a `kind:'network'` → `error` queda seteado y NO se re-evalúa solo (no escucha `statusChanged` ni re-corre al avanzar `lastSyncedAt`). En la tab "Más", la sección Perfil muestra el alert "Sin conexión: no pudimos actualizar tu perfil." + "Reintentar" y NO renderiza "Editar perfil" hasta que el usuario re-enfoca/reintenta (hay un `useFocusEffect` con `refresh()` que lo suele salvar al entrar a Más, pero la ventana existe y offline-post-sync el copy es engañoso). Misma clase que el fix T11 (consumir la degradación R5.4 re-evaluando en la transición first-sync), no aplicada a este contexto.
**Por qué importa**: cosmético/UX (el saludo cae al fallback y Más muestra un error transitorio falso) — no pierde datos. Rompe el "mejor en el primer try" si Raf lo ve en el arranque.
**Próximo paso sugerido**: run chico — en `ProfileContext`, retry en la transición first-sync false→true (mismo patrón `lastHasSynced` de `EstablishmentContext`) o `waitForUsableSync()` antes de la primera carga. Alternativa de fondo: la migración a `useQuery`/`watch` (entrada 2026-06-09) lo borra gratis.

## 2026-06-09 — Reactividad de lecturas PowerSync: migrar a `useQuery`/`watch` (follow-up del fix showstopper)

**Origen**: fix del showstopper de 15-powersync (la app aterrizaba en onboarding / listas vacías porque el gate y las lecturas resolvían el SQLite local one-shot ANTES del first-sync y no re-evaluaban).
**Qué**: el fix cerró el caso CRÍTICO (first-sync) con re-query reactivo acotado: (a) `EstablishmentContext`/`RodeoContext` se suscriben a `statusChanged` y re-resuelven SOLO en la transición first-sync false→true; (b) `animales.tsx` + el stepper del Inicio re-corren su carga cuando avanza `lastSyncedAt` (`useStatus()`). NO se migró el data layer (`services/*` → `runLocalQuery`) a hooks `useQuery`/`watch` del SDK — sería un refactor grande que tocaría la integración con el overlay/outbox (`pending_*` + UNION en las queries). Queda como follow-up: cuando se estabilice el overlay, evaluar mover las lecturas del camino de campo (lista/ficha/timeline/lotes/conteos) a `useQuery` watchable, que re-renderiza automáticamente ante cualquier cambio del SQLite local (first-sync, downloads incrementales, y escrituras del overlay) sin re-query manual por `lastSyncedAt`/`statusChanged`.
**Por qué importa**: el patrón actual cubre el first-sync y los downloads (avance de `lastSyncedAt`), PERO NO re-renderiza ante cambios PUROS del overlay local-only (un write optimista que no avanza `lastSyncedAt`) ni ante sync incremental de filas nuevas post-first-sync sin un re-foco/refresh manual. `useQuery`/`watch` lo haría gratis y borraría toda la maquinaria de re-query manual.
**Residuales conocidos que esto cerraría — ✅ LOS 3 CERRADOS (2026-06-09, run residuales-offline)**: `animals.spec.ts:52` (stepper post-alta), `animals.spec.ts:500` (badge "Vendido el {fecha}") y `establishments.spec.ts:29` (crear campo) ya pasan. Fixes: #1 `createEstablishment` genera el `id` en el cliente (sin read-back local que dependía del sync) + aterrizaje OPTIMISTA en `EstablishmentContext` (`applyCreatedEstablishment`, merge-until-confirmed); #2 `exit_date` de cliente en el overlay `pending_status_overrides` + `COALESCE` en `buildAnimalDetailQuery`; #3 ya cubierto por el `useFocusEffect`+`lastSyncedMs` del fix T11 (el count UNIONa el overlay y se refresca al re-enfocar — verificado determinístico corrido solo). Detalle en `progress/impl_15-powersync.md` (Run residuales-offline). La migración a `useQuery`/`watch` sigue como follow-up (borraría la maquinaria de re-query manual), pero ya NO es necesaria para estos 3.
**Próximo paso sugerido**: spec/ADR de migración del data layer de campo a `useQuery` watchable (post-estabilización del overlay) — opcional, ya no bloquea ningún residual. El camino CRÍTICO (home con datos, lista poblada, crear campo, baja con fecha, stepper) anda.

## 2026-06-09 — Primitiva de snackbar/toast reusable (confirmación post-acción)

**Origen**: cierre T9.9, decisión UX de "Guardar plantilla" (Raf). Recomendé "volver atrás + confirmación breve"; no existe primitiva de toast/snackbar en el repo, así que se shippeó `router.back()` silencioso (consistente con `editar-campo`).
**Qué**: agregar una primitiva de snackbar/toast reusable al design system (`@/components`) + un context/hook para dispararla desde cualquier flujo. Copy offline-aware ("Guardada — se sincroniza al reconectar").
**Por qué importa**: pulido ("mejor en el primer try" — Nielsen #1 visibilidad). Hoy la confirmación de guardado en flujos que vuelven atrás (editar-plantilla, editar-campo, etc.) depende del indicador global de sync, no de feedback local por-acción. App-wide, no solo plantilla.
**Próximo paso sugerido**: primitiva en el DS + wire en los flujos save-and-leave (editar-plantilla, editar-campo, crear-lote, edición de perfil). No bloqueante; el back silencioso es funcional y consistente.

## 2026-06-09 — Cap defensivo de `p_toggles` en `create_rodeo`/`set_rodeo_config` (LOW, Gate 1 T9.8/T9.9)

**Origen**: Gate 1 (security_analyzer, code mode) de `set_rodeo_config` (0082, Run T9.9). Misma observación aplica a `create_rodeo` (0081, T9.8) — el gemelo ya está en el remoto.
**Qué**: ambas RPC reciben `p_toggles jsonb` (array de `{field_definition_id, enabled}`) sin tope de cardinalidad server-side. Cada `field_definition_id` está FK-bound (23503 si no existe) y la PK compuesta `(rodeo_id, field_definition_id)` colapsa duplicados en UPSERTs sobre la misma fila → un array gigante no crece la tabla, solo cuesta CPU de la tx del **propio owner** (self-DoS acotado, sin amplificación ni cross-tenant).
**Por qué importa**: bajo — el gate lo clasificó **LOW, no bloqueante** y aprobó aplicar 0082 tal cual (consistente con 0081-live, ya gateado LOW). No es hueco de seguridad; es hardening defensivo uniforme.
**Próximo paso sugerido**: en una pasada de hardening, agregar `if jsonb_array_length(p_toggles) > 64 then raise ... using errcode = '22023'` al inicio del loop de toggles **en ambas** (0081 nueva migration que recrea `create_rodeo` + en `set_rodeo_config`), para mantener simetría. 64 es holgado para un catálogo de ~30-50 fields. Nada urgente.

## 2026-06-07 — Polish de C4 lotes (no bloqueantes, post puerta de código)

**Origen**: cierre de C4 lotes (frontend `management_groups`). Veto de diseño del leader + Gate 2 + feedback de Raf.
**Qué** (3 ítems chicos):
- **Error-copy crudo** (MEDIUM-1 de Gate 2): `createManagementGroup`/`renameManagementGroup` en `app/src/services/management-groups.ts` propagan `error.message` de PostgREST en la rama `kind:'unknown'`. Es la MISMA deuda transversal de la entrada 2026-06-01 "Mapear errores crudos del backend a copy genérico" — sumar estos 2 call-sites a esa pasada. No empeora nada (camino frío, errores esperables pre-gateados).
- **Member-count en la card colapsada de `/lotes`**: hoy hay que abrir el acordeón para ver cuántos animales tiene un lote. Un "N animales" en la fila colapsada ayudaría (Nielsen #1 visibilidad). Roza la vista de grupo de spec 10 — evaluar si va acá o se difiere a 10.
- **"Eliminar lote" siempre visible por card** (rojo) en `/lotes`: con muchos lotes repite la acción destructiva en cada card. Ya tiene confirmación destructiva; con pocos lotes (beta) es aceptable. Evaluar mover a overflow/menú si escala.
**Por qué importa**: pulido ("mejor en el primer try"); ninguno es MVP-blocker ni hueco de seguridad.
**Próximo paso sugerido**: foldear el error-copy en la pasada transversal de errores; el member-count decidirlo al implementar spec 10 (comparten la vista de grupo).
**Nota cerrada**: el "Crear lote nuevo" del combo de la ficha quedó como CTA centrada con divisor + "+" a la izq; el centrado no es perfecto pero Raf lo aceptó (no se reabre).

## 2026-06-07 — `exit_weight`/`exit_price` sin `CHECK > 0` a nivel DB (MED-01, Gate 2 C3.3)

**Origen**: sesión actual, Gate 2 (security_analyzer modo code) de C3.3 baja de animal — finding MEDIUM.
**Qué**: las columnas `animal_profiles.exit_weight` / `exit_price` (`0020`/`0044`) tienen como único backstop server el tipo `numeric` — no hay `CHECK (exit_weight > 0)` ni rango de precio a nivel DB. El cliente (`validateExitWeight`/`validateExitPrice`) ya valida `>0` y topes, pero un valor negativo/absurdo pegado directo al RPC `exit_animal_profile` (saltando la UI) se persistiría.
**Por qué importa**: bajo — no cruza frontera de seguridad (es dato de analytics del **propio** tenant, no leak ni escalación). Solo ensucia los reportes de venta del dueño. No se tocó backend en C3.3.
**Próximo paso sugerido**: en una pasada de hardening del modelo de animal, agregar `CHECK (exit_weight > 0)` + rango de `exit_price` en una migration nueva (junto con otras deudas de CHECK de dominio si las hay). Nada urgente.

## 2026-06-07 — `rodeos.spec.ts` e2e roja por el OnboardingImportOffer de feature 12 ✅ RESUELTO

**Resuelto** (2026-06-07, terminal feature 12): el helper `completeCrearRodeo` (`app/e2e/helpers/rodeos.ts`) ahora descarta la oferta de onboarding tocando "Más tarde, ir al inicio" (de forma tolerante para el alta no-bloqueante). Corrida real: 3/3 verdes. No se tocó la app (la oferta es intencional). Se mantiene el registro por trazabilidad.

**Nota (2026-06-11, Run e2e-rojos-fix)**: NO confundir con un flake DISTINTO de `rodeos.spec.ts:138` que apareció después y se cerró en este run. Causa raíz distinta: `createRodeo` pasó a ser OFFLINE-FIRST vía outbox (spec 15, T9.8) → la RPC server-side corre async al drenar la outbox; el test leía el remoto UNA vez tras `waitForHome` y race-eaba con el upload (flake 2/3, `rodeos.length` recibía 0). Fix TEST-only en `app/e2e/rodeos.spec.ts`: `expect.poll` por la persistencia server-side del rodeo (patrón `waitForServerAnimalProfile`). El producto está bien (offline-first es el diseño correcto); el test no debe asumir persistencia síncrona. 3/3 verde con `--repeat-each=3`. La oferta del OnboardingImportOffer NO estuvo involucrada (el helper ya la descarta).

**Origen**: sesión actual, mientras se implementaba C3.3 (baja de animal). El implementer lo detectó como hallazgo fuera de alcance; el leader lo confirmó por `git diff` (C3.3 NO toca `rodeos.spec.ts` ni `crear-rodeo.tsx` → el rojo es ajeno y pre-existente al chunk).
**Qué**: `crear-rodeo.tsx:221` muestra el `OnboardingImportOffer` (CTA "Importar rodeo", feature 12, commit `4e1b6d5`) tras crear el **primer** rodeo, con `router.replace('/import-rodeo')` / `router.replace('/(tabs)')`. La suite `app/e2e/rodeos.spec.ts` (BUG 1) crea un rodeo y espera aterrizar directo en home → la oferta de onboarding intercepta y el assert falla. 2 tests rojos. El `check.mjs` NO corre los Playwright e2e (corre las suites node de backend), por eso quedó verde igual y el rojo no se vio en el pipeline.
**Por qué importa**: feature 12 está `in_progress` esperando la **puerta de código humana de Raf**; este es un test desactualizado de SU frente, no un bug del flujo real (el onboarding nuevo es intencional). Conviene cerrarlo en el mismo paquete que la puerta de feature 12 para que la suite e2e quede 100% verde antes de marcarla `done`.
**Próximo paso sugerido**: actualizar `rodeos.spec.ts` para descartar el `OnboardingImportOffer` (tap en "Saltar/Continuar") antes de assertear la home — o verificar la oferta como parte del flujo esperado. Pertenece a feature 12 (otro frente), NO a C3.3. Nada más en este chunk.

## 2026-06-06 — Rate-limit de frecuencia de importación masiva (control diferido, feature 12)

**Origen**: sesión 23, Gate 1 (security) de feature 12 — finding MEDIUM-4.
**Qué**: los topes de la spec 12 (R3: 5 MB / 5000 filas / largo por campo) acotan **una** corrida de import, pero NO la **frecuencia** (un usuario autenticado podría disparar muchas corridas seguidas = DoW por reintentos). No hay rate-limit de import-por-usuario/establecimiento.
**Por qué importa**: bajo en MVP (es op de oficina, no endpoint público; mismo-tenant; la escala ya es posible vía alta unitaria), pero a escala de "decenas de miles de usuarios" un rate-limit de corridas conviene.
**Próximo paso sugerido**: evaluar si el abuso real lo amerita; si sí, rate-limit por (usuario, establecimiento) sobre `import_log` (ya registra cada corrida con `created_at` + `imported_by`) — contar corridas en ventana y bloquear. Anclado a R3.7 de la spec 12. Nada (info) hasta ver abuso.

## 2026-06-04 — ⏰ Keep-alive ping para evitar la pausa por inactividad de Supabase free (HACER PRONTO)

**Origen**: sesión 22, charla de infra al decidir las transiciones por edad (Raf preguntó cómo evitar la pausa).
**Qué**: un proyecto Supabase **free** se **pausa tras 7 días sin requests externos** (los datos quedan; se despausa con un click, pero la app no anda mientras tanto). El `pg_cron` interno **NO** cuenta como actividad. Solución: un **request externo programado** cada 2-3 días que le pegue a un endpoint del proyecto y resetee el timer.
**Por qué importa**: durante dev + beta temprano, evita que el proyecto se pause de la nada (testing de Raf/Facundo). NO reemplaza los backups (eso es Pro, US$25/mes, cuando haya datos de cliente que no se pueden perder).
**Próximo paso sugerido (concreto, listo para ejecutar)**:
- **GitHub Actions** (recomendado): `.github/workflows/keepalive.yml` con `on: schedule: - cron: '0 6 */2 * *'` (cada 2 días) que hace `curl -s "$SUPABASE_URL/rest/v1/<tabla_chica>?select=id&limit=1" -H "apikey: $SUPABASE_ANON_KEY"`. La **anon key** ya es pública (viaja en la app) → no expone secreto; igual conviene meterla como secret del repo. El request cuenta como actividad aunque RLS devuelva 0 filas.
- Alternativa cero-código: `cron-job.org` / UptimeRobot pegándole a la misma URL.
- El leader puede armar el workflow cuando Raf lo pida (es de ~5 líneas). **Marcado "hacer hoy más tarde" por Raf (2026-06-04).**

## 2026-05-28 — Pesaje de ternero: peso al pie vs peso al destete

**Origen**: sesión 15, refinamiento de contexto (Gate 0) de spec 03 MODO MANIOBRAS.
**Qué**: en MVP, pesaje de ternero = pesaje adulto + autocompleta categoría ternero/ternera (vínculo con la madre ya viene de `reproductive_events.calf_id`). Falta modelar peso al pie (lactancia) vs peso al destete como pesajes tipados distintos.
**Por qué importa**: son métricas productivas distintas para analítica de cría; pero la distinción no está validada con Facundo y modelarla a ciegas arriesga rehacer schema.
**Próximo paso sugerido**: refinar con Facundo post-MVP; si se confirma, agregar tipo/contexto al pesaje (posible data_key o columna de contexto en `weight_events`) vía migration, sin reabrir spec 03.

## 2026-05-29 — Estrategia de testing en device real (dev-build) — gap de Expo Go para SDK 56

**Origen**: sesión 17, intento de correr la app en el teléfono de Raf.
**Qué**: el proyecto está en Expo SDK 56 (salió 21-may-2026). Expo Go para SDK 56 **no está en App Store ni Play Store** (sin fecha) → la Expo Go de tienda (SDK 54) no carga el proyecto. Para device real hay 3 opciones: (a) sideload del APK Expo Go SDK 56 en **Android** (vía Expo CLI / expo.dev/go); (b) **iOS** vía TestFlight beta o `eas go` (necesita cuenta Apple Developer US$99/año); (c) **dev-build propio** (expo-dev-client + EAS build o build local) — el camino "correcto" para una app real, no Expo Go.
**Por qué importa**: el veredicto de "primer try" en hardware real (manga, sol, guante) es clave para RAFAQ, y el peón usa Android probablemente. Pero NO bloquea iterar diseño (eso va por web ahora).
**Próximo paso sugerido**: cuando importe device real, decidir entre dev-build (recomendado para app seria, alineado con ADR-013/EAS) vs sideload Android. Por ahora: **web** (`pnpm.cmd web`) para diseño. Sub-decisión latente: ¿quedarse en SDK 56 bleeding-edge o alinear a un SDK con Expo Go en tiendas? (rework si se baja).

## 2026-05-29 — Rollup de resumen por establecimiento (stats de la card "Mis campos")

**Origen**: sesión 17, diseño de la card `EstablishmentCard` (R6.6.2 de spec 01).
**Qué**: la card de cada campo muestra contadores (animales, rodeos) + métrica hero (% preñez último tacto, etc.). Calcularlos en vivo para N campos en el landing es costoso y poco offline-friendly.
**Por qué importa**: con pocos campos beta se computa en vivo sin problema; cuando un vet tenga 15-20 campos, N agregaciones en el landing = lento + mal offline.
**Próximo paso sugerido**: cuando escale, agregar un agregado cacheado por establecimiento (vista materializada o tabla de resumen), refrescado al cerrar una maniobra. No MVP.

## 2026-05-29 — Vista mapa de "Mis campos" (post-MVP)

**Origen**: sesión 17, diseño de "Mis campos".
**Qué**: los `establishments` ya tienen lat/long en el schema → vista mapa de los campos del usuario como alternativa a la lista.
**Por qué importa**: un vet que cubre una zona geográfica vería sus clientes en el mapa (UX potente para multi-campo). El dato ya existe.
**Próximo paso sugerido**: toggle lista/mapa en "Mis campos", post-MVP.

## 2026-05-29 — Benchmarking en la card de "Mis campos" (prender post-beta)

**Origen**: sesión 17, diseño de `EstablishmentCard`.
**Qué**: el slot de comparación ("% preñez 92% · +5 vs zona ▲") ya queda en el layout de la card (R6.6.2) pero VACÍO en MVP — requiere baseline (suficientes campos / datos de zona) que no existe con 1-3 campos beta.
**Por qué importa**: benchmarking es pilar de producto; para el vet con muchos campos, ver cada cliente vs promedio de zona es killer. Pero prometerlo sin datos sería humo.
**Próximo paso sugerido**: encender la comparación cuando haya baseline (post-beta). Posible vista derivada: "ranking de mis campos por % preñez vs zona" para el vet.

## 2026-05-29 — `entry_origin` como enum (analytics)

**Origen**: sesión 17, refi de edge cases de spec 02.
**Qué**: hoy `animal_profiles.entry_origin` es texto libre (ternero al pie usa `'born_here'` hardcodeado). Para analytics de "origen de ingreso" (compra vs nacido vs otro) conviene un enum consistente.
**Por qué importa**: analytics es pilar del producto; texto libre = estadísticas sucias. No bloquea MVP (cría-only, origen mayormente 'born_here' o compra).
**Próximo paso sugerido**: convertir a enum vía migration cuando se aborde el módulo de analytics/reportes (spec 07). NO tocar ahora. (Nota: `exit_reason` SÍ pasa a enum ya, por la decisión de baja/egreso de la misma refi — eso va en el delta backend de spec 02.)

## 2026-05-29 — Pantalla "Mis campos" + landing por rol (selección de establecimiento) — ✅ RESUELTO (misma sesión 17)

**Resolución (2026-05-29)**: Raf decidió la regla → landing por **cantidad de campos** (no por rol): ≥2 campos activos → pantalla "Mis campos" (selector, landing de vets y multi-campo); ==1 → home directa + "Mis campos" accesible vía switch del header. Folded en **spec 01** como `R6.6`–`R6.9` + flujo en `design.md`. No se creó ADR nuevo (es comportamiento de producto/navegación acoplado a la multi-tenancy de spec 01; realiza la mitigación que ADR-018 ya había anotado sobre el switch en el header). Memoria `project-mis-campos-landing` actualizada a "decidido". Se implementa en B.1 (frontend de spec 01).

**Origen**: sesión 17, design review de la home (Stitch). Al decidir reemplazar el menú hamburguesa por un switch de establecimiento en el header, Raf detectó que **nunca diseñamos ni pensamos la pantalla ANTERIOR a la home**: la que lista los establecimientos del usuario antes de entrar a uno.
**Qué**: definir (1) la pantalla **"Mis campos"** (listado de establecimientos donde el usuario tiene rol activo, multi-tenant de spec 01) y (2) **cuál es el landing por rol**:
- **Owner / dueño**: hipótesis = entrar directo a la home del **último campo abierto** (`last_establishment_opened`), con el switch en el header para ir a "Mis campos" manualmente. (Pocos campos, contexto estable.)
- **Veterinario**: hipótesis = el landing principal podría ser **"Mis campos"** directamente, porque probablemente tenga +10 campos para revisar. Pregunta abierta: ¿o también conviene abrirle el `last_establishment_opened` y que navegue al listado vía el switch?
**Por qué importa**: es un hueco de flujo de navegación de nivel app, no un detalle de UI. Afecta a spec 01 (multi-tenant / contexto activo) y al shell de navegación (ADR-018, que ya contempló "promover el switch de establecimiento al header de Inicio" como mitigación). Decidirlo mal obliga a rehacer el arranque de la app. Toca persistir `last_establishment_opened` por usuario.
**Próximo paso sugerido**: refinar en sesión dedicada (probable Gate 0 de contexto). Candidato a ajuste/extensión de spec 01 o nota en su design.md + posible actualización del shell de ADR-018. NO bloquea el design de la home actual: por ahora solo se implementa el **switch entre campos en el header** (reemplaza el hamburguesa); el switch además sirve de feedback de "en qué campo estás parado".

## 2026-05-30 — Stats reales de `EstablishmentCard` (hoy MOCK) + `last_establishment_opened` — backend

**Origen**: sesión 20, build del componente `EstablishmentCard` + preview "Mis campos" (frontend, spec 01 R6.6.2). La card ya está construida y vetada (ver `progress/impl_mis-campos-card.md`), pero alimentada con **mock data**.
**Qué**: la card consume hoy props con datos inventados. Necesitan venir del backend:
- **contadores**: `animalCount` (animales activos por establecimiento) + `rodeoCount` (rodeos por establecimiento).
- **métrica hero adaptativa**: `% de preñez` del último tacto (con período `mmm'aa`) · o `cabezas` + fecha de la última maniobra · o estado "vacío" (sin animales) → CTA. El cliente decide cuál mostrar según qué datos haya.
- **señal de atención** (ej. "tacto pendiente"): deriva de reglas de negocio del campo (tacto vencido, datos sin sincronizar).
- **`last_establishment_opened`** (R6.9, ya **requerido** en la spec): persistencia por usuario del último campo abierto + rastro de últimos visitados (alimenta orden de "Mis campos" R6.6.1, dropdown del switch R6.8.1, landing R6.7). El frontend del incremento 2 lo necesita.
**Por qué importa**: sin estas queries/rollup la card es una maqueta; con ellas es la pantalla de triage del vet multi-campo (pilar producto). Computar N campos en vivo en el landing no escala (ver entrada 2026-05-29 "Rollup de resumen por establecimiento" — misma raíz; este ítem es el corte concreto que la card destrabó).
**Próximo paso sugerido**: sub-tarea de la **terminal/backend** (otra terminal maneja supabase/). Definir la fuente de cada stat (query directa con pocos campos beta / rollup cacheado al escalar) + el almacenamiento de `last_establishment_opened` (columna por usuario o tabla de visitas). Frontend incremento 2 cablea la card a esos datos reemplazando los mocks de `app/app/mis-campos.tsx`.

## 2026-05-30 — Deuda de seguridad pre-existente: `soft_delete_event` omite `has_role_in` (L1)

**Origen**: sesión 20, Gate 1 (security modo spec) del delta Tier 1 de spec 02 (`progress/security_spec_02-modelo-animal.md`, anexo L1).
**Qué**: el RPC genérico `soft_delete_event` (`supabase/migrations/0041_soft_delete_rpcs.sql` ~l.110, **ya mergeado**) autoriza con `is_owner_of(v_est) or v_created_by = auth.uid()` — **omite** el `has_role_in(v_est)` que su hermano `soft_delete_animal_event` sí exige. Es la misma clase del finding SEC-SPEC-01 (autor cuyo rol fue desactivado sigue pudiendo borrar su evento). Quedó **fuera del alcance Tier 1** (no se reabre código ya cerrado en este fold), por eso se asienta acá.
**Por qué importa**: mismo-tenant authz: un usuario removido del establecimiento conserva la capacidad de soft-deletear los eventos que cargó. Bajo impacto (no cross-tenant, requiere haber tenido rol), pero inconsistente con el patrón canónico endurecido.
**Próximo paso sugerido**: al tocar `0041` o en un barrido de hardening, agregar `has_role_in(v_est) and (...)` a la guarda de `soft_delete_event` + test de no-bypass del autor-sin-rol (espejo de T2.18/T2.19). No urgente; no MVP-blocker.

## 2026-06-01 — Build web de producción no inyecta las env `EXPO_PUBLIC_*` (acceso dinámico) → pantalla en blanco

**Origen**: sesión 21, armado de la suite Playwright E2E (agente en worktree, `app/e2e/`). Al hacer `expo export -p web` para servir el estático, la app arrancaba en blanco.
**Qué**: `app/src/utils/env.ts → readPublicEnv(name)` lee `process.env[name]` de forma **dinámica** (índice por variable). `babel-preset-expo` solo **inlinea accesos ESTÁTICOS** (`process.env.EXPO_PUBLIC_FOO`) en el bundle exportado. Resultado: en el export web, `process.env[name]` queda `undefined` → `getEnv()` tira "Faltan variables EXPO_PUBLIC_*" → el cliente Supabase no se crea → **pantalla en blanco**. En `pnpm web` (dev) NO se nota porque ahí `process.env` está poblado en runtime. El harness E2E lo sortea con un `addInitScript` que define `globalThis.process.env.EXPO_PUBLIC_*` antes del bundle (NO toca código de la app).
**Por qué importa**: es un **bloqueante latente del deploy web real**. Y está ACOPLADO a las invitaciones: el `accept_url` apunta a `https://app.rafq.ar/invite?token=` — cuando ese dominio se hostee (build estático), si el bug sigue, el sitio queda en blanco y **los links de invitación no abren**. O sea: arreglar esto es prerequisito para que el deep-link/universal-link de spec 01 Fase 5 funcione en prod (hoy diferido).
**Próximo paso sugerido**: cuando se aborde el deploy web (o junto con el deep-link nativo de Fase 5), cambiar `env.ts` a accesos ESTÁTICOS (`process.env.EXPO_PUBLIC_SUPABASE_URL` etc., explícitos) o leer de `Constants.expoConfig.extra`. Cambio chico y aislado en `src/utils/env.ts` + verificar con `expo export -p web` + servir el estático. NO urgente para el MVP (se itera por `pnpm web` dev), pero NO olvidarlo antes de cualquier hosting web.

## 2026-06-01 — Type-check propio de la suite E2E (`app/e2e/`)

**Origen**: sesión 22, merge de la suite Playwright a main. Al traer `e2e/*` al árbol principal, el `tsc --noEmit` del app levantaba sus `.ts` (Node: `node:fs`/`__dirname`/`ws`/`node:crypto`) y fallaba.
**Qué**: se excluyó `e2e` + `playwright.config.ts` del `app/tsconfig.json` para que `check.mjs` quede verde sin meter `@types/node` en el árbol del app (al estar `node-linker=hoisted`, `@types/node` contaminaría el type-env del RN app y podría enmascarar usos de APIs de Node inexistentes en RN). Consecuencia: el código de los tests E2E hoy **no tiene type-check** (Playwright lo transpila en runtime sin chequear tipos).
**Por qué importa**: los helpers de e2e operan con `service_role` (admin) — un type bug ahí podría pasar silencioso. Bajo riesgo (suite chica + corre verde), pero RAFAQ apunta a "mejor en el primer try".
**Próximo paso sugerido**: agregar `app/e2e/tsconfig.json` con `types: ["node", "@playwright/test"]` (scopeado, sin filtrar a la app) + `@types/node`/`@types/ws` como devDeps + script `e2e:typecheck` (`tsc -p e2e/tsconfig.json --noEmit`). Opcional cablearlo a `check.mjs` (ojo: no debería pegarle a la red). Cuando se active `invitations.spec.ts` post-B.1.3 es buen momento.

## 2026-06-01 — Loop potencial al abrir `/invite?token=` con sesión iniciada (deep-link, DIFERIDO)

**Origen**: sesión 22, activación de `invitations.spec.ts` (E2E). Al hacer `page.goto('/invite?token=…')` (carga fresca) con un usuario ya logueado, el harness reprodujo un loop confirm→accept→confirm.
**Qué**: en una carga fresca, `AuthContext` arranca en `loading` → `invite.tsx` ve `isAuthed=false` → entra en `auth_required` y **persiste el token** (R5.13). Cuando auth resuelve, pasa a `confirm`; pero tras aceptar, el `RootGate` (re-ruteo centralizado R5.13) parece volver a `/invite` por el token persistido (timing del clear vs el guard) → loop. NO se reproduce por el flujo in-app (pegar link desde el wizard / "Pegar link de invitación") porque la sesión nunca cae a `loading` → va directo a `confirm`, sin persistir token. El E2E usa el flujo in-app (también un camino real) y queda verde.
**Por qué importa**: es un bug LATENTE del camino deep-link/universal-link con sesión activa — hoy DIFERIDO (sin dominio `app.rafq.ar`, device-blocked, scheme no asociado). No es MVP-blocker (el camino usable hoy es pegar el link, que anda). Pero hay que arreglarlo ANTES de habilitar deep-links de Fase 5.
**Próximo paso sugerido**: cuando se aborde el deep-link nativo/universal-link, revisar `invite.tsx` + el re-ruteo R5.13 del `RootGate`: no persistir el token si el estado es `loading` (esperar a que auth resuelva antes de decidir `auth_required`), o limpiar/guardar de forma que el accept no vuelva a disparar el re-ruteo. Reproducir con `goto('/invite?token=')` + sesión activa.

## 2026-06-01 — Cambio/verificación de email depende del envío de mails de Supabase (rate-limited) → SMTP propio para escala

**Origen**: sesión 22, E2E de cambio de email. `auth.updateUser({email})` contra el remoto devolvió `over_email_send_rate_limit` (429).
**Qué**: el cambio de email (R2.2) y la verificación de signup (R1.2) usan el **email built-in de Supabase Auth**, que tiene una cuota de envío baja (sin SMTP custom, ~2/hora por proyecto, compartida entre todos los flujos de auth). En el beta con pocos usuarios alcanza; a escala (o en ráfagas de testing) se satura → los usuarios no reciben el mail de verificación/cambio.
**Por qué importa**: el flujo de cambio de email y la verificación de signup son parte del producto; si el envío se rate-limitea, quedan rotos para el usuario final. Resend ya está configurado (notificación al owner, R5.10) pero NO como SMTP de Auth.
**Próximo paso sugerido**: antes de abrir a más usuarios, configurar **SMTP custom (Resend) en Supabase Auth** (Auth → SMTP settings) para que verificación + cambio de email + reset de password salgan por Resend (sin rate-limit del built-in). Cambio de config, sin código. Relacionado: testear el click del link de verificación en E2E necesita un inbox-tool (Inbucket/Mailosaur) — hoy el E2E solo verifica que el viejo email se mantiene (R2.2), no el click del link.

## 2026-06-01 — Mapear errores crudos del backend a copy genérico (cliente + edge functions)

**Origen**: Gate 2 de Fase 6 backend (edge `db_error` devuelve `err.message` de Postgres) y de C1 rodeos (errores `kind:'unknown'` muestran el `message` crudo de PostgREST en `crear-rodeo`/`rodeos`/`editar-plantilla`). LOW, no bloqueante, no explotable, pero es information disclosure de bajo impacto + UX pobre (el usuario ve jerga SQL).
**Qué**: dos clases del mismo patrón — (a) las 8 edge functions devuelven `err.message` crudo en el caso 500 `db_error`; (b) varios services del cliente clasifican errores no-red como `kind:'unknown'` con el `message` del server y la UI lo muestra tal cual.
**Por qué importa**: RAFAQ apunta a "mejor en el primer try" — un error con jerga de Postgres rompe la percepción de calidad. Riesgo de seguridad bajo (cliente autenticado, sin secretos en el message), pero conviene limpiar antes de beta real.
**Próximo paso sugerido**: en el cliente, mapear `kind:'unknown'` a copy genérico es-AR ("No pudimos completar la acción. Probá de nuevo.") en vez de pasar el `message` crudo; en las edge functions, devolver un code estable + copy genérico para 500 (loguear el detalle server-side, no exponerlo). Pasada transversal cuando se pula la capa de errores; no bloquea features nuevas.

## 2026-06-01 — `accessibilityLabel` crudo filtra al DOM en TODAS las pantallas (warning de React en DEV)

**Origen**: fix-loop de C1 rodeos (BUG 2). La causa REAL del toggle que "no respondía" en `pnpm web` era un warning de React — "does not recognize the `accessibilityLabel` prop on a DOM element" — porque se pasaba `accessibilityLabel` crudo a un `Pressable`/`View` de react-native-web (que NO lo traduce a `aria-label` cuando ya hay props ARIA crudas spreadeadas). En DEV ese warning monta el error-overlay/LogBox de Expo, que puede cubrir la pantalla e interceptar toques. En el export de PRODUCCIÓN el overlay no existe → invisible (por eso la E2E, que corre el export, no lo atrapa).
**Qué**: el patrón correcto (web → `aria-label`; native → `accessibilityLabel`) ahora está centralizado en `app/src/utils/a11y.ts` (`switchA11y`/`buttonA11y`, con tests) y aplicado a la SUPERFICIE DE C1 (FieldTemplateToggleList, crear-rodeo, rodeos, editar-plantilla). PERO el mismo leak crudo persiste en muchas otras pantallas fuera de scope: `mas.tsx`, `miembros.tsx`, `mis-campos.tsx`, `invitar.tsx`, `AnimalRow.tsx`, `EstablishmentCard.tsx`, `ShareLink.tsx`, `AuthBits.tsx`, `(tabs)/animales.tsx`, `(tabs)/_layout.tsx`, `EstablishmentSwitcherDropdown.tsx`, `FormField.tsx`. Raf probó esas pantallas en dev y "funcionaban", así que el overlay ahí no bloquea de forma evidente (posición del badge / elementos que sí traducen), pero el warning igual se emite y es deuda real.
**Por qué importa**: un overlay de error en dev degrada el testing manual (fuente recurrente de "no había acción") y es ruido de consola en cada pantalla. Si en algún caso el badge se posiciona sobre un control, lo bloquea (lo que pasó con el toggle). Limpia la base de a11y multiplataforma de una.
**Próximo paso sugerido**: pasada transversal usando `app/src/utils/a11y.ts` (ya existe) en todas las pantallas/componentes listados — reemplazar el `accessibilityLabel`/`accessibilityRole`/`accessibilityState` crudo por `buttonA11y(Platform.OS, …)` / `switchA11y(…)` o el branch web/native. No bloquea features nuevas; ideal antes de beta real o cuando se retome el frontend de spec 09. Idealmente, un lint que prohíba `accessibilityLabel=` literal en `app/app/**`/`app/src/components/**` (análogo al anti-hardcode) para no reintroducirlo.

## 2026-06-01 — Forzar `created_by` no-spoofeable en las tablas de evento (deuda sistémica SEC-SPEC-03)

**Origen**: sesión 22, Gate 1 (security modo spec) de spec 10 (`progress/security_spec_10-operaciones-rodeo.md`, finding H2 / decisión D7). Resuelto en spec 10 vía Path A (corregir la afirmación), no arreglando el sistémico.
**Qué**: las tablas de evento (`sanitary_events` 0027, `reproductive_events` 0026, `weight_events` 0025, `condition_score_events` 0028, `lab_samples` 0029) usan el trigger `tg_set_created_by_auth_uid` (0024, "setea **solo si NULL**") → un cliente puede mandar `created_by` con el id de **otro usuario del mismo establishment** y queda persistido (spoofing **intra-tenant** de autoría). El trigger no-spoofeable `tg_force_created_by_auth_uid` (0043, sobreescribe siempre) existe y ya lo usan `animal_profiles`/`sessions`/`maneuver_presets`, pero las tablas de evento nunca lo adoptaron. La distinción está documentada literal en 0043 (SEC-SPEC-03).
**Por qué importa**: atribución de autoría en datos regulados SENASA — quién cargó cada evento. **NO es brecha cross-tenant** (la RLS sigue impidiendo escribir sobre otro establecimiento); es integridad de auditoría intra-campo. Bajo impacto, pero inconsistente con el patrón ya endurecido en otras tablas. Afecta transversalmente a specs 02/03/09/10 (todas escriben eventos).
**Próximo paso sugerido**: barrido de hardening — cambiar el trigger `BEFORE INSERT` de las 5 tablas de evento de `tg_set_created_by_auth_uid` a `tg_force_created_by_auth_uid` (vía migration nueva, sin reabrir las viejas) + test de no-spoof por tabla (espejo del de `animal_profiles`/sessions). Decisión arquitectónica de Raf (toca backend done de spec 02). NO urgente, NO MVP-blocker.

## 2026-06-04 — `register_birth` sin tope superior de terneros (DoS intra-tenant) — Gate 2 de C3.2, VERIFY-001

**Origen**: Gate 2 (seguridad, modo code) del frontend C3.2 reproductivo (`progress/security_code_02-frontend-c3.2-reproductivo.md`, finding MEDIUM `VERIFY-001`). El frontend pasó PASS (0 HIGH); este es el único punto a verificar y vive en backend.
**Qué**: la RPC `register_birth` (migration `0045`) valida `jsonb_array_length(p_calves) >= 1` pero **no impone tope superior**, e itera el array completo creando `animals` + `animal_profiles` + `birth_calves` por cada elemento en una sola transacción. Un caller **autenticado y con rol** en el establishment podría mandar un `p_calves` gigante (miles de elementos) y forzar miles de inserts atómicos.
**Por qué importa**: es un **DoS intra-tenant** (no cross-tenant, no fuga de datos, no IDOR — la RLS y la derivación de tenant server-side siguen intactas). Bajo impacto real (requiere un caller ya autorizado actuando de mala fe dentro de su propio campo), pero el contrato de la RPC debería acotar el N. El form de C3.2 no es la barrera autoritativa (un atacante saltea la UI y llama la RPC directo).
**Próximo paso sugerido**: en la RPC `register_birth` (migration nueva, sin reabrir 0045), agregar `if v_count > 20 then raise exception ... using errcode='22023'; end if` (un parto de >20 terneros no existe biológicamente; 20 es holgado) + test. Owner del contrato `register_birth` = backend de spec 02. Opcional defensa-en-profundidad: cap blando en la lista de terneros del form (no autoritativo). NO urgente, NO MVP-blocker.

## 2026-06-04 — Barrido de "back robusto" (backOr) en el resto de las pantallas

**Origen**: fix del bug de navegación (`router.back()` con stack vacío) que Raf vio en `pnpm web`, mientras se blindaban las pantallas del flujo ficha/alta/evento (spec 02 frontend).
**Qué**: el helper `app/src/utils/nav.ts` `backOr(router, fallback)` (canGoBack ? back : replace(fallback)) se aplicó SOLO a las 3 pantallas del flujo (`agregar-evento`, `animal/[id]`, `crear-animal`). Quedan `router.back()` "pelados" en: `cambiar-email`, `editar-plantilla`, `editar-campo`, `invite`, `crear-campo`, `crear-rodeo` (back condicional), `maniobra` (modal), `invitar`, `miembros`, `rodeos`.
**Por qué importa**: el mismo escenario (web-refresh / hot-reload / deep-link / cold-start en una ruta profunda → stack vacío → `router.back()` falla silencioso) deja al usuario trabado en cualquiera de esas pantallas. Menos crítico que ficha/alta/evento (no son el flujo de campo más caliente) pero es la misma clase de bug. Nota: `maniobra` es `presentation:'modal'` → su back tiene semántica distinta (cerrar el modal), evaluar caso por caso.
**Próximo paso sugerido**: run chico de implementer — aplicar `backOr` con el fallback correcto por pantalla (la mayoría → `/(tabs)` home o la pantalla de origen lógica). El helper + sus tests ya existen. NO urgente, NO MVP-blocker.

## 2026-06-04 — Flag "Tuvo aborto" en la LISTA de animales (no solo en la ficha)

**Origen**: gating reproductivo C3.2 (frontend), tarea T3 (flag "marquita roja" A2 — dominio Facundo §1). El flag se implementó en la FICHA del animal (`animal/[id].tsx`, derivado de `hasAbortion(timeline)`), pero NO en la fila de la lista.
**Qué**: la fila de la lista (`AnimalRow`) la alimenta la query de la lista de animales (`services/animals.ts`), que hoy NO trae los eventos reproductivos de cada animal. Mostrar el flag "Tuvo aborto" en la lista requiere que la query del listado sepa, por animal, si tiene ≥1 evento `abortion` — un dato extra (subquery / flag agregado / join a `reproductive_events`).
**Por qué importa**: Facundo pidió la marquita roja "en la ficha/lista". En la ficha ya está (el timeline ya se carga); en la lista falta. Verla de un vistazo en la lista ayuda a identificar vacas problemáticas sin abrir cada ficha. No MVP-blocker (la ficha la cubre).
**Próximo paso sugerido**: extender la query de la lista con un flag `had_abortion` por animal (ej. `exists` sobre `reproductive_events` con `event_type='abortion'`, o un campo agregado en la vista/RPC del listado) + render del chip terracota en `AnimalRow` (reusar el patrón `AbortionFlag` de la ficha). Owner = frontend lista (C2) + posible delta de la query. NO urgente.

## 2026-06-04 — Baseline de seguridad: auditoría retroactiva contra el catálogo A–I (9 findings)

**Origen**: sesión de ampliación del `security_analyzer` (Raf pidió cubrir validación de inputs + rate limits, y luego las 9 clases de defecto del nuevo Catálogo A–I). Auditoría one-off del código YA MERGEADO contra el catálogo → reporte completo en **`progress/security_baseline_shipped.md`** (3 HIGH / 6 MEDIUM / 4 LOW, con tablas de inputs/rate-limits/service-role). Los 3 HIGH fueron re-verificados por el leader contra el source.
**Qué (triage de los 9)**:
- **INPUT-1 (HIGH)** — ninguna columna de texto de usuario tiene tope server-side (`varchar(n)`/`CHECK char_length`); los topes viven solo en el cliente (UX, bypasseable vía PostgREST directo). → **spec 13 hardening**.
- **A1-1 (MEDIUM)** — `animals_update` con `with check (true)` (`0022_rls_animals_and_profiles.sql:34-40`) permite a un user del campo A reescribir `tag_electronic`/`sex`/etc. de un animal compartido con el campo B (integridad cross-tenant). → **spec 13 hardening**.
- **F1-1 (MEDIUM)** — buscador (`animals.ts:341` `escapeIlike`): no neutraliza `.():*` de `.or()` (PostgREST filter injection, intra-tenant) + término sin tope de largo. → **spec 13 hardening**.
- **H1-1 (MEDIUM)** — sesión/JWT no se invalida al remover/degradar miembro (sigue válido hasta `jwt_expiry=1h`; RLS lo corta igual, por eso MEDIUM). → **spec 13 hardening**.
- **B1-1 (MEDIUM)** — `err.message` crudo de Postgres al cliente (32 ocurrencias / 8 EFs + `_shared/auth.ts:44`). **YA ESTABA EN BACKLOG** (entrada 2026-06-01 "Mapear errores crudos del backend a copy genérico") — la auditoría lo cuantificó. → se procesa en **spec 13 hardening** (cierra esa entrada).
- **B3-1 (HIGH)** — PII de coworkers (phone+email) legible por cualquier miembro vía PostgREST directo (`0006_rls_users.sql:16-31`, RLS es row-level no column-level). **RESUELTO por LLM Council (2026-06-04, veredicto unánime)**: patrón **D — separar PII de contacto a tabla `user_private` self-only** (las views/RPC/column-grants no protegen el canal realtime/PowerSync; solo la separación física sí). → **feature 14 `14-pii-user-private`** (registrada, Gate 0 escrito en `specs/active/14-pii-user-private/context.md`, pendiente aprobación de Raf). PRIORIDAD: 2º HIGH explotable-hoy; conviene hacerlo ANTES de wire PowerSync (barato ahora, caro después).
- **H2-1 (HIGH→leader lo ve MEDIUM)** — `minimum_password_length = 6` en `config.toml:177` vs 8 en el cliente. → **fix de config** (propuesto a Raf; aplicar también en Auth del proyecto remoto).
- **E2-1 (MEDIUM, latente)** — Edge Functions custom sin rate limit propio; la cadena `invite→accept` dispara Resend+push (denial-of-wallet). Hoy latente (Resend sin `RESEND_API_KEY`); **sube a HIGH al configurar la key**. → candidato a spec 13 o spec propia (requiere tabla `rate_limits` + lógica).
- **E3-1 (MEDIUM)** — captcha OFF + `enable_confirmations=false` (`config.toml`): registro masivo + `requireUser` acepta email no verificado. → **decisión producto/seguridad** (captcha = setup con provider+key; email-confirmation = trade-off UX de campo).
- **E4-1 / I1-1 / C3-1 / CORS-1 (LOW)** — enumeration de membresía; retención/borrado Ley 25.326 sin flujo; tokens en localStorage solo en web (target de verificación); CORS `*` en EFs (cerrar pre-prod). → backlog, no urgentes.
**No auditable hoy (excluido, re-auditar al implementarse)**: C (PowerSync sync rules/Realtime/SQLite-at-rest, no wired), G (BLE spec 04 sin shippear), F2/F3 (import CSV / SSRF, spec 12 sin código). Cruza con las deudas authz ya en backlog (`soft_delete_event` L1 2026-05-30; `created_by` no-spoofeable SEC-SPEC-03 2026-06-01; `register_birth` sin tope VERIFY-001 2026-06-04) — candidatas a barrer en el mismo hardening.
**Por qué importa**: B3-1 e INPUT-1 son explotables HOY solo con un JWT de miembro (no requieren service-role) y son exactamente lo que muerde a una app multi-tenant con datos privados a escala. El resto es defensa en profundidad / pre-prod.
**Próximo paso sugerido**: **feature 13 `13-hardening-seguridad`** (registrada en `feature_list.json`, status `pending`) agrupa el cluster code/DB (INPUT-1, B1-1, A1-1, F1-1, H1-1) por el flujo SDD. B3-1 y E3-1 = decisiones de Raf antes de specear. H2-1/CORS = fix de config.

## 2026-06-04 — Residuales del Gate 1 de spec 13 (para confirmar en Puerta 1)

**Origen**: Gate 1 (security_analyzer modo spec) de la feature 13 (`progress/security_spec_13-hardening-seguridad.md`). El veredicto fue NEEDS_CLARIFICATION por un solo bloqueante (SPEC-HIGH-1, INPUT-1 incompleto → resuelto por el leader vía Path A: ampliar R1 a las ~14 columnas faltantes en el mismo barrido). Estos dos son residuales MEDIUM que la propia spec ya reconoce/escala — NO bloquean Gate 1, pero la Puerta 1 humana los confirma.
**Qué**:
- **A1-1-resto (SPEC-MED-1)**: el fix de `animals_update` (re-validar `has_role_in` en el `with check`) + el trigger 0036 cierran el caso explotable-hoy (animal mono-perfil) y blindan el EID/IDV. Queda un residual: con un animal COMPARTIDO entre campos (perfil en A y en B), un co-tenant de A puede reescribir `sex`/`birth_date`/`breed`/`coat_color` de la fila global que el campo B también ve (acceso legítimo por rol en A; no lo bloquea ninguna policy). Requeriría **column-level write authz** sobre `animals`/`animal_profiles` — scope nuevo, NO se mete en spec 13.
- **H1-1-API (SPEC-MED-2)**: H1-1 (invalidar sesión del target al remover/degradar miembro) depende de que `auth.admin.signOut(userId, scope)` por user-id exista en la versión de `@supabase/supabase-js@2`/GoTrue del proyecto. La spec lo marca como incógnita a verificar al implementar (T16) con escalado obligatorio si no existe (no aceptar el fallback `active:false`-solo sin decisión de Raf).
**Por qué importa**: A1-1-resto es bajo impacto en MVP single-beta (no hay animales compartidos entre tenants aún); sube si se habilita la transferencia (feature 11). H1-1-API puede convertir H1-1 en un blocker de implementación si la API por-user-id no existe.
**Próximo paso sugerido**: A1-1-resto → barrido futuro de column-level write authz (junto con las otras deudas authz: L1, SEC-SPEC-03) cuando se aborde la transferencia o un hardening profundo. H1-1-API → **RESUELTO (2026-06-05)**: `signOut(userId)` no existe en supabase-js@2 y el ban finito se probó empíricamente inefectivo (no revoca el refresh token persistente); se implementó el RPC `revoke_user_sessions` (migración 0072, `DELETE FROM auth.sessions WHERE user_id=target` = signOut-global por user-id, verificado a mano). Queda solo el residual de que el access-token vive ~1h (stateless) cubierto por RLS — aceptable para MEDIUM.

## 2026-06-05 — Limpiar la data de e2e de producción antes del beta de Chascomús (HACER ANTES DE ONBOARDEAR)

**Origen**: deploy de feature 13 (INPUT-1). Al aplicar el CHECK de `tag_electronic` (tope 32), el pre-check encontró 179 animales con tags > 32 chars; resultaron ser fixtures de e2e (`animal_test_<ts>_<rand>_<SUFFIX>`, ej. `animal_test_1780000540101_s33chk_DUPCALF`, y un `120321...` de 36 díg sintético).
**Qué**: el proyecto Supabase **remoto** (prod) tiene ~**1800 `animals` + 747 `animal_profiles` + cientos de eventos de TEST** (de las corridas e2e/seed acumuladas), con tags basura. No es data real. Cuando se onboardee el beta de Chascomús (Facundo + el campo del padre), el cliente arrancaría con su data mezclada con basura de test.
**Por qué importa**: data sucia en prod = analytics sucio (pilar del producto), confusión, y riesgo de que el cliente vea animales fantasma. RAFAQ apunta a "el mejor en el primer try". Además, por culpa de esos tags largos, 2 columnas (`animals.tag_electronic`, `reproductive_events.calf_tag_electronic`) quedaron con su CHECK en `NOT VALID` sin `VALIDATE` (grandfather) y con tope 64 en vez de 32 — una limpieza permitiría validar el constraint y bajar el tope al valor real (15 díg FDX-B + holgura).
**Próximo paso sugerido**: antes del beta real, purgar la data de e2e del remoto (identificable por el prefijo `animal_test_` / emails `@rafaq-test.local` / `bantest_` etc.) con un script de limpieza cuidadoso (respetando FKs: events → profiles → animals → users). Después, opcionalmente, `VALIDATE CONSTRAINT` de los 2 tags + bajar el tope a 32. Coordinar con la suite e2e (que debe limpiar lo suyo; ver si el cleanup de los helpers está fallando y dejando residuo).
**Nota 2026-06-10 (Gate 2 T7, LOW-2)**: la suite nueva `sync_streams` limpia por ids trackeados, pero ante un kill duro puede dejar huérfanos namespaced (`@rafaq-test.local`) — el sweep de esta entrada los cubre; aplica a todas las suites contra remoto.

## 2026-06-08 — La DB beta contaminada con data de test rompió el sync de PowerSync + falta aislamiento de tests (ADR)

**Origen**: sesión PowerSync (feature 15), al conectar el primer cliente real contra la instancia. El server cerró el stream con `PSYNC_S2305` (too many buckets). La causa de fondo del conteo inflado: la DB beta remota tiene **106 establecimientos (103 vivos), 957 `animal_profiles`, 205 `user_roles`** de runs de test acumulados (misma raíz que la entrada **2026-06-05** "Limpiar la data de e2e de producción" — ~1800 animals; esto la re-confirma y la agrava).
**Qué** (dos ángulos nuevos sobre la misma raíz):
- **Consecuencia activa, no solo higiene**: las parameter queries de las sync streams evaluaban ~100 establecimientos por stream → el redesign con `with:` (bucket por campo del user) **esquiva el corte del sync**, pero cuando sincronice **Raf va a ver data de test mezclada** con su campo real (los pilares analytics/benchmarking se ensucian).
- **El usuario de Raf quedó enredado**: `78d35c28-…` tiene **5 roles activos / 2 establecimientos vivos** (3 roles apuntan a campos soft-deleteados = test). Conviene **limpiar sus roles espurios** además de la data.
- **Problema de proceso (lo nuevo)**: `node scripts/run-tests.mjs` corre las suites RLS/animal/import/etc. **contra la DB beta REMOTA** (necesitan `SUPABASE_SERVICE_ROLE_KEY` y le pegan al remoto) → cada corrida **acumula** data en la base que va a usar el cliente beta de Chascomús. Eso es un anti-patrón de aislamiento de tests.
**Por qué importa**: data sucia en la base de producción/beta = analytics sucio (pilar del producto) + confusión del cliente; y a futuro cada `check` ensucia más. Ya bloqueó (vía el bucket count) el primer sync real.
**Próximo paso sugerido**:
- **Corto**: purgar la data de e2e del remoto (prefijos `animal_test_` / `@rafaq-test.local` / `bantest_` + los establecimientos/roles de test) — coordinar con la entrada 2026-06-05; incluir la limpieza de los **roles espurios de Raf**.
- **Estructural (ADR)**: mover las suites a una **DB aislada** — Supabase **branching** (DB efímera por branch/PR) o un stack **local** (`supabase start`) — para que los tests NUNCA le peguen al proyecto beta. Decisión arquitectónica de Raf; candidato a ADR de "entorno de tests". No bloquea el fix de streams de PowerSync.
- **Nota de proceso**: las sync streams se Gate-1earon por autorización pero nunca se validaron en deploy/runtime contra una DB real hasta ahora → la explosión de buckets (límite operativo) se pasó. Sumar una validación de deploy de streams (bucket count + sin `PSYNC_S2xxx` en logs) al cierre de la feature 15.

## 2026-06-09 — `accept_invitation`: mensaje de error lindo al aceptar invitación a un campo borrado

**Origen**: Gate 1 (security) del modelo de sync JOIN-free de PowerSync (feature 15, V3). Finding HIGH-1 cerrado a nivel DB.
**Qué**: el invariante "`user_roles.active = true` ⇒ campo vivo" (del que dependen las streams JOIN-free) lo cierra ahora un **guard trigger en `user_roles`** (migración 0076): prohíbe activar/insertar un rol para un establecimiento soft-deleteado. Eso cierra el agujero de seguridad (un invitado que acepta el link de un campo recién borrado ya NO crea un rol activo → no se le sincroniza data del campo borrado). PERO: cuando `accept_invitation/index.ts` (~l.93) inserta el rol contra un campo borrado, el guard tira una **excepción cruda de Postgres** → la EF devuelve un error genérico/feo en vez de un mensaje claro ("Esta invitación ya no es válida: el campo fue eliminado").
**Por qué importa**: es UX de un edge-case raro (aceptar justo después de un borrado), no un hueco de seguridad (ese ya está cerrado por el guard). RAFAQ apunta a "mejor en el primer try" → un error con jerga SQL rompe la percepción.
**Próximo paso sugerido**: en `accept_invitation`, antes del insert del rol, chequear `establishments.deleted_at IS NOT NULL` → devolver un code estable + copy es-AR ("La invitación ya no es válida porque el establecimiento fue eliminado."). Defensa-en-profundidad sobre el guard DB (que sigue siendo la barrera autoritativa). Requiere redeploy de la EF. Cuando se toque la capa de EFs / errores (cruza con la entrada 2026-06-01 "Mapear errores crudos del backend a copy genérico").

## 2026-06-09 — Propagar el soft-delete del padre a `birth_calves` / `rodeo_data_config` (equivalencia stream↔RLS, paso 2)

**Origen**: Gate 1 (security) del paso 2 de PowerSync (`progress/security_spec_15-powersync-paso2.md`). Dos findings MEDIUM, **same-tenant correctness, NO cross-tenant** (Gate 1 PASS igual).
**Qué**: las streams JOIN-free `ev_birth_calves` y `est_rodeo_data_config` filtran solo `establishment_id IN org_scope`, pero su RLS as-built filtra además el `deleted_at` del PADRE que ellas no tienen: `birth_calves_select` filtra `reproductive_events.deleted_at IS NULL` (0045); `rodeo_data_config_select` filtra `rodeos.deleted_at IS NULL` (0018). Al soft-deletear un parto / un rodeo, sus filas hijas (links de parentesco / config del template — solo UUIDs/flags, **del propio campo**) siguen sincronizando al device, aunque la RLS las oculta.
**Por qué importa**: bajo — es **same-tenant** (no sale nada cross-tenant, no hay PII) y **invisible** (las filas huérfanas no se renderizan: su padre, el parto/rodeo soft-deleteado, no sincroniza). Es bloat menor del SQLite local + una desviación de la equivalencia stream↔RLS estricta. NO es MVP-blocker; el deploy del paso 2 procede con esto documentado.
**Próximo paso sugerido**: migración nueva que agregue `deleted_at` (o un flag) a `birth_calves` y `rodeo_data_config`, mantenido por un trigger que propague el soft-delete del padre (cuando `reproductive_events.deleted_at`/`rodeos.deleted_at` pasa a NOT NULL → marcar las hijas), + filtrar `deleted_at IS NULL` en las dos streams. Cierra la equivalencia. Patrón = el trigger de propagación de 0079/0080. Gate 1 sobre el delta. Quitar los comentarios ⚠️ de las dos streams en `rafaq.yaml` al cerrarlo.

## 2026-06-09 — Transición de categoría optimista offline (tacto/aborto) — PowerSync T5

**Origen**: T5 (escritura offline simple) de PowerSync. Los `add*` de eventos escriben local + suben al reconectar.
**Qué**: las transiciones de **categoría** del animal por un evento reproductivo (un tacto positivo → "preñada", un aborto → revierte) las hace un **trigger AFTER INSERT server-side** sobre `reproductive_events` (inserta `animal_category_history` + actualiza `animal_profiles.category`). Offline ese trigger NO corre → el **evento se graba y se ve en el timeline al instante**, pero el **badge/categoría** del animal (lista, ficha) NO se actualiza hasta que el evento sincroniza (reconexión → upload → trigger server → re-sync del perfil).
**Por qué importa**: bajo — el dato crítico (el evento) se graba offline sin pérdida; es solo el estado DERIVADO (categoría) el que lagea hasta el sync. En la manga el operador igual ve el tacto registrado. Pero para "mejor en el primer try", ver la categoría actualizada al instante offline sería más pulido.
**Próximo paso sugerido**: transición de categoría **optimista** offline — replicar la lógica del trigger en el cliente (un overlay/UPDATE local de la categoría al cargar el tacto/aborto, reconciliado al sync) o un `pending_status_overrides` de categoría (similar al overlay de T6). Evaluar al cerrar T6 (comparte el patrón de overlay). NO MVP-blocker.

## 2026-06-09 — `createRodeo` offline — ✅ RESUELTA (2026-06-09, Run T9.8) — PowerSync

**✅ RESUELTA (2026-06-09)**: Raf pidió explícito que `createRodeo` funcione OFFLINE (offline-first sin excepciones). Se implementó la **opción (b)** del "próximo paso" de abajo: outbox → RPC nueva `create_rodeo` (migración `0081`, NO aplicada aún — la aplica el leader tras Gate 1) que hace seed+diff atómico server-side (como `register_birth`), + overlay optimista (`pending_rodeos` + `pending_rodeo_data_config`, la plantilla COMPUTADA en el cliente desde `system_default_fields` ya sincronizado + el diff de toggles). El rodeo Y su plantilla aparecen offline al instante (UNION en `buildRodeosQuery`/`buildRodeoConfigQuery`). Idempotencia NATURAL (sin `client_op_id`: INSERT del rodeo `ON CONFLICT DO NOTHING` → el trigger de seed no re-dispara + UPSERT de toggles → replay = no-op total). Owner-only (`is_owner_of`, espeja `rodeos_insert`) + guard anti-IDOR (autorrevisión: p_id colisionado con rodeo ajeno → 42501, no toca su `rodeo_data_config`). Ver `specs/active/15-powersync/tasks.md` T9.8 + `progress/impl_15-powersync.md` (Run T9.8). Specs reconciliadas (design §1.2 un-defer, tasks T3.3/T9.8). El último write que faltaba offline queda cerrado.

**Origen** (histórico): reviewer de T5/T6 (escritura offline). Drift spec↔código: el design prometía `createRodeo` local; quedó ONLINE. Reconciliado documentando el diferimiento (design §1.2 + tasks T3.3).
**Qué**: crear un rodeo (`rodeos.createRodeo`) sigue requiriendo conexión. A diferencia de `createManagementGroup` (CRUD plano single-tabla, ya offline en T5), `createRodeo` NO es trivial offline: su **plantilla de datos** (`rodeo_data_config`) la **seedea un trigger server-side** (`tg_rodeos_seed_data_config`, 0018) con los defaults del sistema, y luego se aplica el diff de toggles del usuario. Offline el trigger no corre → la plantilla no se arma localmente → el rodeo quedaría sin su config hasta sincronizar, y el diff de toggles no tendría filas que actualizar.
**Por qué importa**: contradice el principio offline-first de Raf ("todo offline menos login/invitaciones/perfil"). PERO crear un rodeo es típicamente **setup** (al dar de alta el campo, con conectividad), no una operación de manga. El leader lo **difirió** por la complejidad real del seeding. **Decisión de Raf pendiente**: ¿aceptable online (setup), o se hace el trabajo de offline?
**Próximo paso sugerido (si se hace offline)**: rework del seeding de la plantilla para offline — opciones: (a) el cliente arma la `rodeo_data_config` completa localmente (defaults del catálogo ya sincronizado + toggles del usuario) y el trigger server usa `ON CONFLICT DO NOTHING` al subir (el cliente gana, sin duplicados); o (b) `createRodeo` por outbox→RPC nueva que haga seed+diff atómico server-side (como register_birth). Ambas tocan backend + Gate 1. Estimar cuando Raf confirme que lo quiere offline.

## 2026-06-05 — Sumar `deno check` de las Edge Functions al pipeline (`check.mjs`)

**Origen**: Gate 2 de feature 13. Un `serverError` se llamaba sin importar en 2 EFs (`invite_user`/`accept_invitation`) → `ReferenceError` en runtime en todo path 5xx. El bug llegó hasta el Gate 2 (en vez de fallar local) porque **`check.mjs` type-checkea solo el cliente (RN/TS), nunca las Edge Functions Deno**.
**Qué**: las EFs (`supabase/functions/**/index.ts` + `_shared/*`) son Deno/TS y NO tienen type-check en el pipeline. Un import faltante, un símbolo mal escrito o un type error solo se descubre al deployar o en runtime.
**Por qué importa**: las EFs corren con `service_role` (admin) y son la capa de auth/invitaciones — un type bug ahí es serio. Hoy la única red es el Gate 2 (tarde) o el runtime (peor).
**Próximo paso sugerido**: instalar `deno` localmente y sumar `deno check supabase/functions/**/index.ts` a `scripts/check.mjs` (y quizás al hook Stop si es rápido). Ojo: `deno` no estaba en el PATH de la máquina de Raf al cierre de esta sesión — requiere instalarlo. Cazaría imports/símbolos faltantes antes del deploy.
