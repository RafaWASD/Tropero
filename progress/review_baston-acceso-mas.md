# review — «acceso in-app a la pantalla de conexión del bastón» (delta de spec 04)

baseline_commit: c7f62599dec2ba762e97f173e533aff38b93f236 (diff **sin commitear**)
reviewer: read-only. No se editó código ni se hizo `git add`.

## Veredicto

**CHANGES_REQUESTED**

El trabajo funcional está bien y lo verifiqué de punta a punta: la función pura es exhaustiva y
falsificable (7 mutantes, 7 cazados), los E2E prueban lo que dicen, `check.mjs` da RC=0 y no queda
ningún `router.back()` pelado. Lo que bloquea son **dos afirmaciones falsas sobre el as-built**: una
escrita adentro del código de producción (`toneColorToken`) y otra que quedó vieja en las specs sobre
el artefacto que esta misma unidad cambió (el shot 07). Las dos se arreglan con texto — ni una línea
de comportamiento cambia, así que **no hay que re-correr E2E** para cerrarlas.

---

## Cambios requeridos (priorizados)

### 🟠-1 — «tres copias privadas e IDÉNTICAS» de `toneColorToken` es FALSO (y ya divergen)

Afirmado en tres lugares:

- `app/src/features/ble-stick/connection-view.ts:190-192` (doc comment del módulo de producción):
  *"Hoy `StickConnectionScreen`, `StickDeviceRow` y `StickStatusIndicator` tienen cada uno su copia
  privada e **idéntica** de esta traducción."*
- `specs/active/04-bluetooth-baston/design-multivendor.md` (bloque de reconciliación 2026-08-05):
  *"Las tres copias privadas e idénticas … **no se tocaron**"*.
- `progress/impl_baston-acceso-mas.md` §3.4 y §6.

Medido:

| archivo | `success` | `progress` | `warning` | `idle` |
|---|---|---|---|---|
| `connection-view.ts:194` (canónica, nueva) | `$primary` | **`$primary`** | `$terracota` | `$textMuted` |
| `screens/StickConnectionScreen.tsx:89` | `$primary` | `$primary` | `$terracota` | `$textMuted` |
| `components/StickStatusIndicator.tsx:63` | `$primary` | `$primary` | `$terracota` | `$textMuted` |
| `components/StickDeviceRow.tsx:21` | `$primary` | **`$textMuted`** (diverge) | `$terracota` | `$textMuted` |

`StickDeviceRow` mete `'progress'` en la rama del `default` junto con `'idle'`. Hoy es **inalcanzable**
(`deviceRowView` nunca devuelve `tone:'progress'`), así que no hay bug vivo — pero el comentario le
dice al próximo que haga el barrido cross-file que las cuatro son equivalentes, y no lo son:
reemplazar la copia de `StickDeviceRow` por la canónica **cambia el color en silencio** si alguna vez
`deviceRowView` emite `'progress'`. Es exactamente la trampa que el resto de ese archivo existe para
cerrar, documentada como segura.

**Pedido**: corregir la redacción en los tres lugares (decir que una de las tres diverge en
`'progress'` y por qué hoy es inalcanzable), **o** unificar y ajustar. Cualquiera de las dos sirve; lo
que no puede quedar es el comentario mintiendo.

### 🟠-2 — Reconciliación de specs incompleta: dos afirmaciones vivas describen el mundo pre-fix

Las dos son sobre el **shot 07**, que es justamente el artefacto que esta unidad restauró.

**(a) `specs/active/04-bluetooth-baston/design-multivendor.md`** — cierre del sub-bullet 2 del bloque
*"Reconciliación as-built (MV.4, 2026-07-20)"*:

> *"Verificado en captura (Gate 2.5): shots 05/06 = card de `/baston` limpia sin pill encima; **shot 07
> = indicador anclado al fondo en `/crear-animal`** (pantalla con header + CTA) … La demostración de
> RMV3.5 en `/crear-animal` en vez de la home es una limitación del E2E (… **el único `router.push`
> client-side desde `/baston` que preserva la conexión es "Dar de alta" → alta**)"*

As-built después de esta unidad: el shot 07 es **el tab "Más"** (`baston-multivendor.capture.ts:186-193`),
y la cláusula del "único `router.push` client-side" es falsa — la vuelta a "Más" por el chevron
(`backOr`) preserva la conexión y **es literalmente lo que usa el shot restaurado**. El implementer
anotó el bullet hermano, 3 líneas más abajo, con `[CERRADO el 2026-08-05 — ver la reconciliación de
abajo.]`: la convención estaba clara y se aplicó a uno solo de los dos.

**(b) `specs/active/04-bluetooth-baston/tasks-multivendor.md:112-113` (T-MV.7.2)** — es la task dueña de
los **dos** artefactos que esta unidad modificó, y su as-built quedó viejo en tres números:

- *"Suite de regresión `app/e2e/baston-multivendor.spec.ts` (**4 casos, 4/4 verde**)"* → hoy 6 casos, 6/6.
- *"Capture … (**6 shots**: 01 … 06)"* → hoy 10 shots.
- Bloque `[RECONCILIACIÓN 2026-07-30 (BENCH-3)]`: *"el shot `07-indicador-global-chrome` **se CAYÓ** …
  su evidencia VISUAL **vuelve cuando** «Más» tenga la fila a `/baston`"* → ya volvió.

**Pedido**: anotar (a) igual que se anotó su bullet hermano, y cerrar el as-built de T-MV.7.2 con los
números reales. Agregar T-MV.4.7 no alcanza: T-MV.7.2 sigue diciendo otra cosa sobre los mismos archivos.

### 🟡-3 — Comentarios vivos que quedaron falsos («deep-link-only»)

- `app/e2e/captures/baston-spp-bloqueantes.capture.ts:126` — *"Deep-link a la pantalla de conexión (la
  fila de «Más» no está cableada todavía)."*
- `app/e2e/asignar-caravanas-sin-transporte.spec.ts:9` — *"más accesible que `/baston`, que es
  deep-link-only"*.
- `specs/active/09-buscar-animal/tasks-09resto-dedup.md:73` — misma frase, dentro del as-built de otra
  unidad (prioridad menor: es registro histórico fechado, pero es un archivo de spec).

Los de `progress/**` y los del bloque histórico de `docs/backlog.md` **no** cuentan: son registro de
sesión y la convención del repo es no reescribirlos (y el backlog ya marcó RESUELTO arriba del texto viejo).

### 🟡-4 — El cambio de `backOr` no tiene ningún test que falle si se revierte

El E2E (e) llega a `/baston` **por push**, así que ejercita la rama `router.back()` — que con un
`router.back()` pelado se comporta **idéntico**. `nav.test.ts` prueba `backOr` aislado, no su uso en
`StickConnectionScreen`. La rama que el fix realmente arregla (stack vacío → `replace('/(tabs)/mas')`)
está a dos líneas de distancia: los casos (a)-(d) **ya** entran con `page.goto('/baston')`, o sea con
el stack vacío; alcanza con tocar "Volver" en uno de ellos y asertar que aterriza en "Más".

Y como esta unidad cierra **el último** `router.back()` pelado de la app, era el momento de dejar el
guard estático (la regla del repo es *"barrer la ausencia: el guard se escribe sobre la ausencia para
que lo nuevo nazca en rojo"*). Sin él, el próximo `back()` pelado nace en verde. Si se decide no
hacerlo ahora, que quede en `docs/backlog.md` como decisión, no como olvido.

### 🟡-5 — El dato que justifica la fila se renderiza en el texto más chico de la fila

El trailing va en `fontSize="$3"` = **13 px**; el label "Bastón" en `$5` = 16 px. El argumento entero
de la fila (§3.3 del informe) es *"enterarse sin entrar"* — y eso es lo que quedó más chico. "Más" no
es UI de manga, así que no viola literalmente la regla de ≥18 pt, pero es una decisión que el
implementer tomó como *default menor* (§3.7) y que trabaja contra el propósito declarado. **Para el
veto visual del leader**, con los shots 09 y 10 a la vista. No lo bloqueo: es criterio de diseño, no
un defecto.

### ⚪-6 — La ubicación (fuera del bloque "Campo activo") no está protegida por ningún test

Es el fundamento más repetido de la unidad (informe §3.1, design, requirements, tasks), y sin embargo
nada falla si alguien mueve la fila adentro del `{activeField ? … }`: los dos E2E siembran
establecimiento. No verifiqué si el estado "logueado sin campo activo" es siquiera alcanzable dentro de
`(tabs)` (el `RootGate` puede rutear a onboarding antes) — si no lo es, el fundamento es más débil de
lo que dicen las specs y conviene decirlo así.

### ⚪-7 — El `accessibilityLabel` muta con el estado

`Bastón: ${row.text}. Abrí la pantalla…` cambia el **nombre accesible** de la fila en cada
`connection_changed`. Está documentado y los locators E2E usan regex. Consecuencia para lector de
pantalla no evaluada.

---

## Los 8 focos del encargo — qué encontré

**1. `connectionRowStatus` vs `connectionStatusView`: ¿el invariante cubre TODA la combinación?**
**Sí, y lo medí.** `ROW_ENVS` tiene 4 entornos (`{T}`, `{F}`, `{T,exh}`, `{F,exh}`) × los 6 estados de
`ALL_STATES` = 24 casos. Le falta `autoConnectExhausted: false` explícito, pero **las dos funciones
ramifican por truthiness** (`if (env.autoConnectExhausted)` / `env.autoConnectExhausted ? …`), así que
`false` es equivalente a `undefined`: la cobertura es completa sobre el espacio de comportamiento
alcanzable. Lo verifiqué enumerando **6 × 3 × 2 = 36** combinaciones contra el módulo real:
`row.tone === card.tone` en las 36, y ningún texto pasa de 16 caracteres. Tampoco hay contradicción de
**texto** (`No encontrado`/`No encontramos el bastón`, `No disponible`/`Bastón no disponible`, etc.).

**Intenté romperlo** con 7 mutantes sobre una copia del árbol, corriendo el archivo de test real.
Los 7 quedaron rojos:

| mutante | tests en rojo |
|---|---|
| M1 `scanning` tone `warning` a `progress` | 1 (el invariante de tono) |
| M2 sin transporte tone `idle` a `success` | 2 |
| M3 `off`+agotado vuelve a decir "Sin conectar" | 2 |
| M4 `toneColorToken('progress')` a `'#ffffff'` | 2 |
| M5 se borra el corte por `hasTransport` | 3 |
| M6 `disconnected` copia el copy de `connected` | 2 |
| M7 trailing largo que repite "Bastón" | 4 |

El invariante caza cualquier divergencia de tono de una sola rama, y los 8 textos están pinneados
individualmente. El test es real, no decorativo.

**2. La fila no se oculta sin transporte — ¿coherente? ¿afordancia muerta?**
**Coherente, y no deja afordancia muerta.** El precedente es literal: el header de
`asignar-caravanas-sin-transporte.spec.ts:11-13` ya dice *"La fila de «Más» NO se oculta (a diferencia
del chip): el chip es un indicador de estado que sin transporte no informa nada; esto es una
funcionalidad REAL"*. Y el destino cumple: sin transporte `connectionStatusView` devuelve `cta:'none'`
+ *"Todavía no se conecta en este dispositivo. Cargá las caravanas a mano"*, y `deviceRowView` cae a
`recognized-unavailable` con `actionable:false` (`StickConnectionScreen.tsx:111,131,146`). La pantalla
explica, no promete. RMV3.6 intacto: la fila no gatea nada.

**3. `autoConnectExhausted` leído del transporte sin suscripción — ¿camino con copy viejo?**
**No hay uno realista.** Tracé los dos setters:

- `true`: solo en `exhaustUnpromptedChain()` (`adapter-spp-android.ts:1214-1216`), inmediatamente
  antes de `emitStatus('off')`, y siempre viniendo de un estado que **no** era `'off'`
  (`disconnected`/`connecting`/`scanning`) → el `setStatus` del provider cambia de valor → re-render.
- `false`: solo en `applyChainPolicy()` (`:684`). Camino sin intento en vuelo (`:647`) → sigue
  `doConnect` → `emitStatus('connecting')` (`:796`) → re-render. Camino con intento en vuelo (`:643`,
  `connect_reasserted`) → **vuelve sin emitir**, pero requiere un intento en curso, o sea que el status
  no es `'off'` — y el flag **solo cambia el copy cuando el status ES `'off'`**.

Además el `api` del provider está memoizado con `status` en las deps
(`BleStickListenerProvider.tsx:261-277`), así que `StickRow` re-renderiza por las dos vías.
Estructuralmente frágil (leer en render lo que no se suscribe), pero es **exactamente** el precedente
ya documentado de `StickConnectionScreen.tsx:147`. No lo cuento como defecto. **No verificado en device.**

**4. `toneColorToken` con 3 copias privadas vivas** → ver 🟠-1. **No es ruido: ya divergen.**

**5. ¿Los E2E prueban lo que dicen?** **Sí.** Los dos importan `test`/`expect` de `./helpers/fixtures`
(`baston-multivendor.spec.ts:43`, y el capture igual). Ninguno pasaría con el fix revertido: el locator
de la fila **es el ancla de `gotoTab`**, así que sin fila el test muere en la navegación. (f) es un
contrafáctico de verdad — trailing opuesto **más** ausencia del string del otro caso en cada lado, el
mismo patrón de dos oráculos del precedente. El oráculo del destino evita el strict-mode del título
"Bastón" duplicado usando `stick-device-row` + `Dispositivos` + URL. Los corrí yo: **6/6**.

**6. ¿Queda algún `router.back()` pelado?** **No.** Grep sobre `app/app` + `app/src`: 8 menciones en
comentarios, `nav.ts:34` (la implementación canónica de `backOr`) y nada más. La afirmación del
implementer es correcta. Lo que falta es el test que lo mantenga así → 🟡-4.

**7. Reconciliación de specs.** `requirements-multivendor.md` RMV3.1 quedó **bien**: el EARS decía
"accesible desde la sección «Más»", era falso, y ahora es cierto (verificado por E2E (e), corrido por
mí). El bloque de reconciliación es honesto sobre que la cláusula mentía. `docs/backlog.md` bien (los
dos ítems marcados RESUELTO sin borrar el texto viejo, que es la convención). Lo que **no** cerró son
las dos afirmaciones de 🟠-2 y los comentarios de 🟡-3.

**8. Regresión de textos.** **Alcanza, y lo re-verifiqué.** Grep sobre todo `e2e/` por los 8 strings
nuevos: los únicos asserts exactos parecidos son `maniobra-identify.spec.ts:308,310`
(`'Bastón conectado'` / `'Bastón desconectado'`) — el chip, en la pantalla de maniobra, y con
`exact:true`, así que `'Conectado'`/`'Desconectado'` no los matchean. Revisé además el ancla que usa
cada una de las 20 specs que pasan por "Más": todas usan `getByRole('button', …)` con labels propios o
`getByText('Perfil')` — ninguna se vuelve ambigua. Corrí 6 de ellas (abajo).

---

## Verificación ejecutada (lo corrí y lo vi)

| Qué | Resultado |
|---|---|
| `pnpm typecheck` (app) | **verde** |
| `node --test … connection-view.test.ts` (con el resolver del repo) | **37/37** |
| Enumeración exhaustiva 6 × 3 × 2 = 36 combos (script propio, módulo real) | invariante de tono **36/36**, todos los textos ≤ 16 |
| Batería de **7 mutantes** contra el archivo de test real (copia en scratch) | **7/7 cazados** (2-4 tests rojos c/u) |
| `node scripts/check.mjs` | **RC=0** — "Entorno listo", 19 suites OK |
| Playwright `baston-multivendor.spec.ts` | **6/6** (incl. (e) y (f)) |
| Playwright `asignar-caravanas-sin-transporte` + `profile` + `sigsa-export` + `lotes` | **15 passed / 1 failed** (ver abajo) |
| Playwright `account` + `telefono` | **8/8** |
| Muestreo de color del ícono en el shot 10 (PIL) | trazo = (30,90,62) = **#1E5A3E = `$primary`** |
| Zoom x6 del trailing "No disponible" (shot 10) | la **p renderiza completa**, sin recorte |
| Zoom x4 de "Asignar caravanas en masa" (shot 08) | la g tampoco se recorta (sin regresión de clase en `ActionRow`) |
| Grep `router.back()` en `app/app` + `app/src` | solo comentarios + `nav.ts` |
| Grep de los 8 strings nuevos en todo `e2e/` | cero colisiones exactas |

**El rojo**: `lotes.spec.ts:61 "crear lote → asignar desde la ficha → ver miembros"`, **reproducible**
(falla igual en la re-corrida aislada). Muere en `:103` con
`getByText(loteName,{exact:true}).first()` → *"locator resolved to span … unexpected value hidden"*.
Es la clase de rojo pre-existente que `progress/current.md:490-491` ya documenta (*"22 failed, todos
pre-existentes (verificado contra un worktree en el baseline); **6 comparten un bug de oráculo
`.first()`**"*), y el tramo de "Más" de ese mismo spec (`gotoTab` → fila "Lotes" → `/lotes`) **pasó**.
Nada del diff toca la ficha del animal ni el picker de lote.
**No verificado contra un worktree del baseline**: lo atribuyo por coincidencia de modo de falla, no
por medición. Si al leader le importa cerrarlo, hace falta el worktree.

**Churn**: corrí Playwright contra el `dist` **ya existente** (22:45, más nuevo que todos los fuentes
tocados: 22:39-22:41), sin `e2e:build`. Por eso **no hay churn de PNGs en `design/`** — `git status` de
`design/` vacío después de mis corridas. Los `__shots__` siguen gitignored (`app/.gitignore:29`) y sin
stagear.

**Ajeno a esta unidad**: durante la sesión apareció `?? app/e2e/captures/fab-hitslop-probe.capture.ts`
sin trackear. No es del diff ni lo toqué (otra terminal).

---

## Reglas de la casa

| Regla | Resultado |
|---|---|
| Tokens-only (ADR-023 §4) | OK — `$2/$3/$0`, `toneColorToken` a `$primary`/`$terracota`/`$textMuted`; color del ícono muestreado = `$primary`. Cero hex. (`size={20}` numérico = patrón vigente del archivo.) |
| `lineHeight` matching | OK — `lineHeight="$3"` con `fontSize="$3"` en el Text con `numberOfLines={1}`; verificado ópticamente con un descendente real. |
| Pressable de RN sobre Tamagui con `pressStyle` | OK — no hay. `ActionRow` es un `XStack` de Tamagui con `onPress` + `pressStyle` en la misma pieza. |
| es-AR, voseo | OK — "Abrí la pantalla de conexión del bastón", copys cortos correctos. |
| Touch target ≥ `$touchMin` | OK — `ActionRow` con `minHeight="$touchMin"` (56). |
| Multi-tenant / RLS | **N/A, confirmado**: el diff no tiene `.sql`, no crea tablas ni policies, no toca `establishment_id`. La fila es UI + estado en memoria. |

## Checklist RAFAQ-específico

- **A. Multi-tenancy / RLS** — **N/A**. Sin tablas ni policies (confirmado, no asumido: cero `.sql` en el diff).
- **B. Offline-first** — **N/A / trivialmente cumplido**: no carga ni edita datos. Cero requests; los
  dos hooks leen contexto en memoria y la navegación es local. Sin conflictos que resolver.
- **C. BLE** — aplica parcialmente:
  - [x] Desconexión repentina con UI clara: la fila dice `Desconectado` / `Reintentando…` y lleva a la
        pantalla con el CTA. (Nota informativa, ya declarada por el implementer §6: en `scanning` la
        pantalla sigue sin "Cancelar" — decisión de UX pendiente de Raf, backlog 2026-07-30 ítem 2.
        Esta unidad da el acceso, no cambia los CTA. No lo cuento en contra.)
  - [x] Fallback manual accesible: la fila no bloquea nada y sin transporte el destino apunta a la
        carga manual (RMV3.6).
  - [x] Logs BLE no bloquean el flujo: la fila no loguea.
  - N/A: correlación TAG-peso.
- **D. UI de campo** — "Más" es pantalla de ajustes, no manga:
  - [x] Target grande: `$touchMin` = 56 + padding (patrón vigente de todas las filas del archivo).
  - [~] Fuente ≥ 18pt: el label va en `$5` (16 px) y el trailing en `$3` (13 px) — **coherente con el
        resto de la pantalla** (los subtítulos secundarios ya usan `$3`), pero ver 🟡-5.
  - [x] Una decisión por pantalla: es una fila de navegación.
  - [x] Loading visible: no hay estado async propio; el trailing refleja el estado real desde el
        primer paint (`transport` es un `useMemo` síncrono, no hay flash de "No disponible").
- **E. Edge Functions** — **N/A**. No se tocó ninguna.

## CHECKPOINTS

- **C1** — [x] archivos base y docs presentes; [x] `check.mjs` **RC=0**.
- **C2** — [x] ninguna feature en `in_progress` (04 está `deferred`, delta de bugfix — es coordinación
  del leader, no defecto de esta unidad); [x] tests verdes.
- **C3** — [x] respeta capas (`app/(tabs)` a `features/ble-stick` puro a `services/ble`); [x] cero deps
  nuevas; [x] sin logs de debug ni TODOs sueltos; [x] no hardcodea `establishment_id`.
- **C4** — [x] test por módulo con lógica (la función pura nueva tiene 8 casos y son falsificables);
  [x] fixtures reales (E2E contra Supabase remoto + export estático); [x] runner >0 y verde;
  [x] RLS N/A.
- **C5** — [x] sin artefactos temporales sin trackear de esta unidad (`__shots__` gitignored);
  [ ] `progress/history.md` — lo cierra el leader al commitear; [x] estado de la feature sin tocar.
- **C6** — [x] los 3 archivos de spec existen; [x] EARS en RMV3.1; [x] tasks — las 6 sin marcar que
  quedan son **pre-existentes y gateadas con justificación en el propio texto** (T-MV.5.6 y T-MV.7.3
  por hardware RS420, T-MV.5.18 por device, T-MV.6.2 por MFi/negocio, T-MV.6.3 futuro, T-MV.7.4 cierre
  documental); ninguna es de esta unidad. [x] cada requirement con test (tabla abajo).
- **C9** — [x] suite E2E verde (**6/6, corrida por mí**); [x] capture file con 10 shots nombrados,
  incluidos los 3 estados clave de la fila; [ ] **veto visual del leader pendiente** (Gate 2.5 — con
  🟡-5 y la redundancia "Bastón/Bastón" del shot 08 a la vista); [x] los PNG de `__shots__` no
  commiteados.

## Trazabilidad requirement-test

| Requirement | Test que lo verifica | Estado |
|---|---|---|
| **RMV3.1** (pantalla accesible desde "Más") | `app/e2e/baston-multivendor.spec.ts:273` — (e) Más a fila a `/baston` a chevron a "Más" | OK, corrido por mí |
| **RMV3.1** (la fila NO se oculta sin transporte) | `app/e2e/baston-multivendor.spec.ts:316` — (f) contrafáctico `__RAFAQ_BLE_E2E_MANUAL__` | OK, corrido por mí |
| **RMV3.4** (copy de estado, versión corta) | `connection-view.test.ts` — 5 casos `RMV3.1 fila:` (largo/no-repite/tono/sin-transporte/distintos) | OK, 37/37 + 7 mutantes cazados |
| **RMV3.4** (el tono de la fila no contradice la card) | `connection-view.test.ts` — `RMV3.1 fila: el TONO nunca contradice a la card…` | OK, exhaustivo (36/36 combos) |
| **R6.4** (copy honesto con el auto-connect agotado, en la fila) | `connection-view.test.ts` — `R6.4 fila: el auto-connect agotado no dice "Sin conectar"…` | OK (unit; **no** en device ni E2E) |
| **ADR-023 §4** (tokens-only en el color del trailing) | `connection-view.test.ts` — `toneColorToken: los 4 tonos mapean a un token del DS…` | OK + muestreo de píxel en el shot 10 |
| **RMV3.5** (evidencia visual del chip global) | captura `07-indicador-global-chrome` **restaurada** | OK, generada (10 shots presentes) |
| **backOr** (rama back) | E2E (e), tramo final | Pasa — pero **pasaría igual con `router.back()` pelado** → 🟡-4 |
| **backOr** (rama fallback, stack vacío) | `app/src/utils/nav.test.ts` (la función aislada) | **Sin test de integración en `StickConnectionScreen`** → 🟡-4 |

## Lo que NO pude verificar (lo digo, no lo doy por bueno)

- **Nativo / device.** Todo lo E2E es web. La fila en Android/iOS no se probó. El estado
  `No encontrado` (R6.4) no existe en web: solo está cubierto por unit sobre la función pura.
- **El rojo de `lotes.spec.ts`** no lo medí contra un worktree del baseline (ver arriba).
- **La suite E2E completa** (~38 min) no la corrí: corrí las 6 specs que tocan "Más" + la de la unidad.
