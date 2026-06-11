# Triage — e2e Playwright rojos (2026-06-11, tarde)

> Tarea de DIAGNÓSTICO (solo lectura). No se tocó código de app/tests. El leader decide los fixes.
> Estado del working tree al correr: el fix del flake de estado repro (Run backlog-flake-repro)
> SIN COMMITEAR (events.ts, local-reads.ts, event-timeline.ts + tests). Se trabajó sobre el tree TAL CUAL.

## Cómo se corrió

1. **Rebuild obligatorio**: el `dist/` existente estaba STALE (13:12) vs. el fix del tree (events.ts/event-timeline.ts a 14:13).
   La suite corre contra el **export estático de prod** servido en :8099 (no Metro). Sin rebuild, los events
   reflejarían código viejo. Se corrió `pnpm.cmd run e2e:build` (copy-powersync-assets + `expo export -p web`) → OK.
2. Suite por archivo (no la suite completa de un saque) contra Supabase remoto compartido:
   `pnpm.cmd exec playwright test <archivo>.spec.ts --reporter=list`.
3. Para cada rojo, `--repeat-each=3` para distinguir FLAKE de DETERMINÍSTICO.
4. Nota de entorno: al final de cada corrida aparece `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` —
   es ruido de teardown de libuv en Node 24, **no** un fallo de test (todos los exit/conteos son correctos).

## Resumen ejecutivo

| Archivo | Antes (backlog 06-10) | AHORA | Cambio |
|---|---|---|---|
| `events.spec.ts` | 3 rojos | **0 rojos** (13/13 verde, determinístico) | ✅ cerrados por C6 + fix repro |
| `account.spec.ts` | 1 rojo | **1 rojo** (det.) | igual — bug ProfileContext |
| `profile.spec.ts` | 3 rojos | **3 rojos** (det.) | igual — mismo bug ProfileContext |
| `rodeos.spec.ts` | 1 rojo | **1 rojo** (FLAKE 2/3) | distinto al de 06-07 (ese ya verde); nuevo: race de sync server-side |

**Conteo REAL de rojos hoy: 5** (no 8). 4 deterministas (1 account + 3 profile, MISMA causa raíz) + 1 flake (rodeos).
Los 3 de events ya NO están rojos.

---

## YA NO ESTÁN ROJOS (cerrados por chunks previos)

### events.spec.ts — 13/13 VERDE, determinístico
- Corrida full: 13 passed. Repeat-each=3 sobre los 4 tests repro-sensibles
  (`:279` parto-mellizos + link a la madre, `:397` parto no-preñada, `:452` parto preñada, `:509` aborto):
  **12/12 verde**.
- El test que el prompt marcaba como "el único rojo que queda" — navegación calf→madre (`:279`,
  assert "Vaca segundo servicio" / link a la madre del overlay) — **PASA, determinístico**. La pista del
  reviewer quedó stale: ese test ya está verde con el fix del tree.
- Quién los cerró: el badge de transición de categoría lo cerró **C6** (espejo client-side, RC6.3.1) y el
  estado reproductivo "Vacía" tras parto/aborto del mismo día lo cerró el **fix del flake repro**
  (created_at de cliente + desempate por `seq`, ya gateado APPROVED+PASS). No tocar.

---

## ROJOS ACTUALES (por prioridad)

### 🐛 [d] BUG REAL DE PRODUCTO — ProfileContext se queda "Sin conexión" pre-first-sync (4 tests)

Afecta **4 de los 5 rojos** (1 account + 3 profile), TODOS con la MISMA causa raíz.

**Tests / asserts que fallan** (todos en `helpers/ui.ts:94`, el último `gotoTab`):
- `account.spec.ts:151` → `gotoTab(page,'Más', cambiarEmailRow)` — anchor `button "Cambiar email"` nunca aparece.
- `profile.spec.ts:32` (`gotoEditProfile`) → invocado desde `:54`, `:75`, `:110` — anchor `button "Editar perfil"` nunca aparece.

**Flake o determinístico**: **DETERMINÍSTICO**. `--repeat-each=3`: profile 9/9 fallan, account 3/3 fallan. 0 verdes.

**Causa raíz concreta** (verificada en código + snapshots de error-context):
1. `ProfileContext.loadFor` (`src/contexts/ProfileContext.tsx:71-96`) llama `loadProfileNamePhone(uid)`.
2. `loadProfileNamePhone` (`src/services/profile.ts:31-52`) lee `users`/`user_private` del **SQLite local de
   PowerSync** vía `runLocalQuerySingle` con `emptyIsSyncing:true`. ANTES del first-sync, la fila del usuario
   todavía NO bajó al SQLite local → la query degrada vacío+!hasSynced a `kind:'network'`.
3. `ProfileContext` setea `error = "Sin conexión: no pudimos actualizar tu perfil."` y `profile` queda `null`
   (`namePhone` nunca cargó).
4. El efecto de carga del ProfileContext (`useEffect [userId, loadFor]`, línea 99-101) corre **UNA vez** al
   resolver `userId` y **NO se re-evalúa solo**: no escucha `statusChanged` ni la transición first-sync
   false→true. El error queda pegado.
5. La sección Perfil de "Más" (`app/(tabs)/mas.tsx:184-194`) hace `if (!profile)` → renderiza
   `FormError("Sin conexión…") + button "Reintentar"`, y NO renderiza `EmailRow`/"Cambiar email" (líneas
   217-221) ni "Editar perfil" (línea 234). Los anchors no existen → `gotoTab` agota los reintentos y falla.
6. **Por qué el focus-refresh NO lo salva** (el backlog 06-10 decía que "suele salvarlo"): el `useFocusEffect`
   de `ProfileSection` (`mas.tsx:174-178`) SOLO resetea `editing=false`; **no** llama `refresh()`. No hay
   re-fetch al re-enfocar Más en esta sección → una vez seteado el error al montar (pre-sync), nada lo re-evalúa
   salvo tocar "Reintentar" a mano. Contra el export de prod + remoto, el first-sync tarda lo suficiente para
   que la carga única SIEMPRE caiga antes del sync → falla 100%.

**Evidencia (snapshot del error-context, idéntico en account y profile)**:
```
- text: Más Perfil
- alert: "Sin conexión: no pudimos actualizar tu perfil."
- button "Reintentar"
... (resto de "Más": Campo activo, Rodeos, Lotes, Editar campo, etc. SÍ rendean — solo la sección Perfil falla)
```

**Categoría**: (d) **bug REAL de producto** (no es flake ni test desactualizado). Es EXACTAMENTE la entrada de
backlog **"2026-06-10 — ProfileContext queda en 'Sin conexión: no pudimos actualizar tu perfil'…"** (clasificada
ahí como cosmético/UX) — pero acá demuestra ser un bug FUNCIONAL determinístico: bloquea editar perfil y cambiar
email en el arranque hasta tocar "Reintentar". También golpea al usuario real de Raf en el arranque ("mejor en
el primer try").

**Fix sugerido (toca APP, no tests)** — archivo `app/src/contexts/ProfileContext.tsx`:
Re-evaluar la carga en la transición first-sync false→true, **espejando el patrón YA existente de
`EstablishmentContext`** (`src/contexts/EstablishmentContext.tsx:336-346`: `db.registerListener({statusChanged})`
+ var local `lastHasSynced` que solo dispara el refresh en la PRIMERA transición false→true; opcionalmente
`waitForUsableSync()` de `services/powersync/first-sync.ts` antes de la primera carga). Es el mismo template que
cerró los 3 residuales offline de la entrada 06-09. Un solo fix cierra los 4 rojos a la vez.
- Alternativa de fondo (más grande, ya en backlog 06-09): migrar el data layer a `useQuery`/`watch` — lo borra
  gratis, pero es refactor mayor; para este triage el fix acotado del listener alcanza.
- NO tocar los tests: los asserts son correctos (el usuario DEBE poder editar perfil / cambiar email desde "Más");
  el bug es del producto.

---

### ⚠️ [b] FLAKE de timing/sync — rodeos: read-back server-side sin esperar el upload (1 test)

**Test / assert**: `rodeos.spec.ts:138` —
`expect(rodeos && rodeos.length).toBeGreaterThan(0)` recibió `0`. (Test "crear rodeo con un toggle destildado →
la config queda con ese dato deshabilitado", `:99`.)

**Flake o determinístico**: **FLAKE**. `--repeat-each=3` → 2 fallan / 1 pasa.

**Causa raíz concreta**: `createRodeo` (`src/services/rodeos.ts:176+`) es **offline-first vía OUTBOX** desde la
migración de spec 15 (Run T9.8): encola un intent `create_rodeo` (RPC 0081) + overlay optimista
(`pending_rodeos`) y devuelve al instante. La UI aterriza en home con el rodeo OPTIMISTA, pero la RPC real
server-side corre **asíncronamente** cuando PowerSync drena la outbox. El test, justo después de
`completeCrearRodeo` + `waitForHome`, abre un cliente anon, hace login del usuario y consulta el rodeo en el
**remoto** — una sola vez, sin poll. Hay un **race**: si el upload de la outbox no completó todavía, el remoto
devuelve 0 filas → falla. Cuando el upload alcanza a completar (1 de 3 corridas), pasa. Los otros 2 tests de
`rodeos.spec.ts` (BUG 1 / BUG 2) pasan SIEMPRE porque asertan solo la UI (overlay), no el server.

**Categoría**: (b) **flake de datos/timing** — el dato eventualmente aterriza server-side; el test no espera la
persistencia. (NO es el rojo del `OnboardingImportOffer` de 06-07: ese YA está resuelto — el helper
`completeCrearRodeo` descarta la oferta con "Más tarde, ir al inicio", `helpers/rodeos.ts:74-80`, y BUG1/BUG2 pasan.)

**Fix sugerido (toca TEST, no app)** — archivo `app/e2e/rodeos.spec.ts` (~línea 131-138):
Esperar la persistencia server-side antes de asertar, en vez de consultar una sola vez. Opciones:
- `expect.poll(async () => { const {data} = await supa.from('rodeos').select('id')...; return data?.length ?? 0; },
  { timeout: 20_000 }).toBeGreaterThan(0)` y recién después leer la config — patrón "oráculo de persistencia
  server-side" que ya se usó en el fix del alta (`waitForServerAnimalProfile`, backlog 06-10 create-animal-rpc).
- El producto está bien (offline-first es el diseño correcto, ADR/spec 15); es el test el que asume persistencia
  síncrona. No hay bug de app acá.

---

## Tabla final (orden de prioridad)

| # | archivo:línea (assert) | flake/det. | causa raíz | cat. | fix (app/test) |
|---|---|---|---|---|---|
| 1 | `account.spec.ts:151` (ui.ts:94, anchor "Cambiar email") | **det.** (3/3) | ProfileContext queda en error pre-first-sync, no re-evalúa; "Más" oculta la sección Perfil | **d** bug real | APP — listener first-sync en `ProfileContext` (espejo `EstablishmentContext`) |
| 2 | `profile.spec.ts:54` (ui.ts:94, anchor "Editar perfil") | **det.** (3/3) | idem #1 | **d** bug real | APP — mismo fix que #1 (uno cierra los 4) |
| 3 | `profile.spec.ts:75` (ui.ts:94, anchor "Editar perfil") | **det.** (3/3) | idem #1 | **d** bug real | APP — mismo fix |
| 4 | `profile.spec.ts:110` (ui.ts:94, anchor "Editar perfil") | **det.** (3/3) | idem #1 | **d** bug real | APP — mismo fix |
| 5 | `rodeos.spec.ts:138` (`rodeos.length > 0`) | **FLAKE** (2/3) | read-back remoto sin esperar el upload de la outbox (`createRodeo` es offline-first) | **b** flake timing | TEST — `expect.poll` por persistencia server-side |

**Cerrados (ya NO rojos)**: events.spec.ts ×3 (badge transición → C6; estado repro "Vacía" → fix flake repro,
gateado). 13/13 verde determinístico — NO reabrir.

## Recomendación al leader
- **Un fix de app** (ProfileContext, ~patrón existente) cierra 4 rojos (#1-#4). Es bug real, no test stale → su
  propio mini-ciclo (toca contexto compartido). El assert de los tests es correcto, no tocarlos.
- **Un fix de test** (rodeos `expect.poll`) cierra el #5. El producto está bien (offline-first); el test asume
  persistencia síncrona. Reconciliar en spec si corresponde, pero es ajuste de test.
- events ya cerrado por chunks previos — sacarlo del backlog "8 e2e rojos" (queda 1 account + 3 profile + 1 rodeos).
