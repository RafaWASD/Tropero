# review — baston-chip-sin-transporte (bugfix device Android)

baseline_commit (código): d9a3eb0 · reviewer sobre el working tree, sin commitear.
Durante la review el leader commiteó 42a5e70 (docs-only sobre progress/current.md): el diff de
código sigue siendo idéntico contra d9a3eb0.

## Veredicto

**CHANGES_REQUESTED**

El fix central es correcto, está falsificado en las dos direcciones (lo re-hice yo, aislado) y es un
**no-op verificado en web**. Lo frenan dos cosas concretas y baratas de cerrar:

1. **La barrida se dejó afuera la superficie más discoverable de su propia clase**: `Más → "Asignar
   caravanas en masa"` → `app/app/asignar-caravanas.tsx`, una pantalla 100% dependiente del bastón, sin
   ninguna salida manual, a 2 taps del tab "Más" en el Android de Raf. El informe declara la barrida
   **exhaustiva** (§3) y a `TagScanCta` como **el único** overflow (§5). Las dos afirmaciones son falsas.
2. **Una contradicción numérica specs↔as-built** en `design-multivendor.md` (regla dura del proyecto).

---

## 1. Verificado EJECUTANDO (no leyendo)

| Qué | Resultado |
|---|---|
| `node scripts/check.mjs` | **RC=0**. `client unit tests` **2526/2526**, `fail 0`. Anti-hardcode ADR-023 §4: **0 violaciones**. Único `[WARN]`: `current.md` inflado (562 líneas) — pre-existente, territorio del leader, no afecta el RC. |
| Suites Edge/backend | Verdes en esta corrida. **No reproduje el 502/HTML del gateway** que el implementer reportó como falso rojo intermedio: su atribución a flake de plataforma queda confirmada. |
| E2E BLE (6 specs) sobre `pnpm e2e:build` fresco de este árbol | **32 passed** (3.2m). `baston-chip` (2) · `baston-multivendor` (4) · `baston` (4) · `baston-ficha` (3) · `maniobra-identify` (16) · `alta-bastoneo` (3). Coincide con lo reportado. |
| **Falsificación re-hecha, aislada** (copia de los módulos en un dir temporal, sin tocar el working tree) | Baseline copia: **21/21**. M1 guard del chip removido (**el bug vivo**) → **2 rojos**. M2 `return null` siempre (**sobre-fix**) → **3 rojos**. M3 corte de `connectionStatusView` neutralizado → **3 rojos**. M4 `deviceRowView` sin `&& hasTransport` → **2 rojos**. M5 `readsEmptyHint` ignorando el flag → **1 rojo**. Restaurado → **21/21**. La red muerde en los dos sentidos, y en cada una de las 4 decisiones por separado. |
| `design/**/*.png` | Mi corrida E2E re-renderizó 2 (`maniobra-identify/{candidate-picker,other-rodeo-sheet}.png`) → **revertidos**. El árbol quedó como lo encontré. |

## 2. PRIORIDAD 1 — lo que nadie puede probar en device

### (A) La "trampa de la Fase 4" — el hallazgo es REAL, no una hipótesis vestida

- **La descripción del defecto es correcta contra el baseline.** `git show d9a3eb0:.../connection-view.ts`:
  `if (binding.available) → { state:'recognized-available', actionable:true }`, y el tap de la fila ejecuta
  `transport?.connect()` (`StickConnectionScreen.tsx:158`). Son dos fuentes con **cero acoplamiento**:
  `binding.available` sale de `selectReaderBinding(...)` contra `BUILT_ADAPTERS`, un array **literal
  hardcodeado en la pantalla** (`StickConnectionScreen.tsx:42`); el transporte sale de
  `selectTransportAdapter()` + `instantiateTransport()` (`BleStickListenerProvider.tsx:81` y `:131`), otro
  archivo. Nada obliga a moverlos juntos.
- **El escenario de la Fase 4 es real.** Para que Android tenga bastón hacen falta **dos** ediciones
  independientes: (1) agregar `'spp-android'` a `BUILT_ADAPTERS`; (2) cambiar la última línea de
  `selectTransportAdapter` (`adapter-selection.ts`, hoy `return 'manual'`). Hacer solo (1) deja la fila
  diciendo "Tocá para conectar" con `transport === null` → tap muerto, **y la suite del baseline seguiría
  verde** porque `deviceRowView` no tomaba el transporte como entrada. Confirmado por mutación: M4 deja 2
  rojos **hoy** con la firma nueva; con la firma vieja no había test que pudiera fallar.
- **La condición nueva no rompe web.** El corte está **dentro** de la rama `binding !== null`
  (`connection-view.ts:181-182`) → no toca `recognized-unreachable` (iOS, `binding === null`) ni
  `unrecognized`. En web: `binding.available === true` **y** `hasTransport === true` → `recognized-available`,
  idéntico al baseline.
- **Matiz que el informe no dice**: hoy el cambio de `deviceRowView` es un **no-op en las 3 plataformas de
  producción** (Android `available:false`; iOS `binding === null`; web `true && true`). Es **endurecimiento
  preventivo**, no la corrección de un defecto vivo — está bien y lo apoyo, pero la tabla §3 lo rotula 🔴
  igual que el chip, que sí era el bug de Raf. Imprecisión de encuadre, no error de código.

### (B) Web es un no-op total — verificado call site por call site

`mode` de producción en web = `'auto'` (`_layout.tsx:697`) → `selectTransportAdapter` → `'web-serial'` →
`instantiateTransport` → `new WebSerialAdapter()` **incondicional** (`BleStickListenerProvider.tsx:83`; el
constructor solo guarda `baudRate`, no mira `navigator.serial` ni tira). O sea `transport != null` **siempre**:

| call site | web |
|---|---|
| `BleConnectionChip.tsx:44` | `hasTransport:true` → misma vista de antes (fijada por el test de regresión de mapeo). |
| `identificar.tsx:598` `right={conectable ? ... }` | `conectable === true` → mismo `right` de antes. |
| `StickConnectionScreen.tsx:115` `connectionStatusView` | salta el corte; test "los 6 estados quedan EXACTAMENTE como antes". |
| `StickConnectionScreen.tsx:107` `deviceRowView` | `available && true` → idéntico. |
| `StickConnectionScreen.tsx:231` `TransportInstructions` | `!binding.available \|\| !hasTransport` → 2ª cláusula false → idéntico. |
| `StickConnectionScreen.tsx:250` `readsEmptyHint(true)` | string original textual. |
| `StickStatusIndicator.tsx:79` | el `return null` nuevo no dispara; sigue mandando el auto-oculto en `'off'`. |

Los 32 E2E verdes (que corren en web) lo confirman empíricamente.

**Único borde no cubierto (pre-existente, NO regresión, NO bloqueante)**: en un navegador **sin** Web Serial
(Firefox / Safari / Chrome Android) el adapter igual se instancia → `hasTransport` da `true` y el chip sigue
ofreciendo un connect que va a fallar. El fix se ancla en `transport != null`, no en
`WebSerialAdapter.isSupported()` (que existe, `adapter-web-serial.ts:59`). Mismo comportamiento que el
baseline. Nota de backlog, no cambio pedido.

### iOS

Sin device (cuota EAS hasta el 1/8), pero por lectura **no se mueve más allá de "sin transporte no hay
chip"**: `selectTransportAdapter` cae en el mismo `return 'manual'` que Android; `binding === null` en iOS
(el RS420 declara `spp`+`serial`, la prioridad iOS es `ble-hid`/`ble-gatt`/`mfi`) → la fila y
`TransportInstructions` toman ramas que el diff **no toca**. Lo que cambia es lo mismo que en Android: chip
ausente + copy honesto. **No bloqueante.**

## 3. PRIORIDAD 2 — propagación de `null`

Los busqué con grep, no por el informe.

- **`bleConnectionView` (ahora `... | null`)** — consumidores en todo `app/`: **uno solo**,
  `BleConnectionChip.tsx:44`. (`components/index.ts:113` lo re-exporta pero nadie más lo importa.) El
  componente es correcto: `const connected = view?.connected ?? false` (`:45`), `if (view === null) return
  null` (`:57`) **después** de los tres hooks (`useBleConnectionStatus`, `useBleProviderApi`, `useCallback`)
  → no viola reglas de hooks; y **todos** los derefs (`view.colorToken`, `view.icon`, `view.label`,
  `view.connected`) están después del guard. **Cero `view.algo` sin chequear.** El tipo `| null` obliga a
  cualquier call site futuro (typecheck verde dentro de `check.mjs`).
- **`connectionStatusView` (el hermano)** — **no** devuelve `null`: devuelve una `ConnectionStatusView`
  completa con `cta:'none'` / `ctaLabel:null` / `tone:'idle'`. No hay propagación de null que auditar. Sus 2
  consumidores (`StickStatusIndicator.tsx:109`, `StickConnectionScreen.tsx:115`) pasan el env; `deviceRowView`
  y `readsEmptyHint` idem (`:107`, `:250`). Ningún consumidor huérfano.

## 4. PRIORIDAD 3

### 4.1 Las 9 superficies — FALTA UNA, y es la peor

BLOQUEANTE — `app/app/asignar-caravanas.tsx` + su fila en `app/app/(tabs)/mas.tsx:994`.

- La pantalla es **100% bastón**: su única entrada de datos es `useBleStickListener({ enabled, onTagRead })`
  (`asignar-caravanas.tsx:184`). No importa `useBleProviderApi`, no tiene `ManualTagEntry`, no tiene ninguna
  entrada manual (grep de transport/manual/hasTransport en el archivo devuelve **solo dos comentarios**,
  `:262` y `:364`). Sin transporte **no llega jamás un tag** → la pantalla queda congelada en su estado vacío.
- El estado vacío (`EmptyQueueState`, `:365-379`) dice literalmente **"Bastoneá para empezar / Pasá el bastón
  por la caravana del animal"**. Es **exactamente** la clase del hallazgo (b) del informe: copy suelto en JSX,
  invisible a una grep de connect(). La misma clase que sí se arregló en `readsEmptyHint`.
- La entrada **no está gateada**: `mas.tsx:992-998`, label "Asignar caravanas en masa", a11y "Asignar
  caravanas electrónicas en masa con el bastón", visible para todos los roles activos.
- **Es más grave que varias de las que sí se arreglaron**: `/baston` es deep-link-only (lo dice el propio
  informe en §10.5) y esta pantalla está a **2 taps del tab "Más"**. Y el argumento con el que se difirió
  `TagScanCta` — "su destino entrega función real sin transporte" — **se invierte acá**: este destino entrega
  **cero**.
- Consecuencia directa: apenas Raf toque "Asignar caravanas en masa" en su Android, reporta el mismo bug otra
  vez con otra ropa.

**Cambio requerido** (elegí UNO, no los dos):
- **(i) preferido, del mismo tamaño que lo ya hecho**: copy honesto en `EmptyQueueState`
  (`asignar-caravanas.tsx:365-379`) cuando el transporte es null — misma decisión, mismo patrón, y si querés
  que viva en el módulo puro, al lado de `readsEmptyHint`. La fila de `mas.tsx:992-998` es **opcional y es
  decisión de producto** (ocultarla esconde una función que vuelve sola en la Fase 4): si no está decidida,
  dejala visible y arreglá solo el copy de adentro.
- **(ii) mínimo aceptable**: entrada en `docs/backlog.md` con **el mismo rigor** que la de `TagScanCta`
  (qué / por qué importa / por qué no se arregló / próximo paso).

En **los dos** casos: corregir **§3** ("barrida exhaustiva") y **§5** ("el único overflow es TagScanCta") de
`progress/impl_baston-chip-sin-transporte.md`, que hoy afirman algo falso.

Fuera de eso, la barrida de copy la re-corrí yo (grep de todo string con "bast" en `app/app` + `app/src`) y
**no hay más**: los hits que quedan son (a) `identificar.tsx:881-889` y `TagScanSheet.tsx:350-383`, ambos
adentro del ConnectHero que solo se monta con `listenConn === 'connectable'` (`maniobra-listen-state.ts`
exige conectable true); (b) `TagScanCta`/`TagScanSheet` (el diferido); (c) `baston-test.tsx` (harness);
(d) `animal/[id].tsx:634,662` ("Conectate y volvé a intentar"), que es **conectividad de red**, no bastón.

### 4.2 `TagScanCta` diferido — COINCIDO

Verifiqué la premisa que sostiene el argumento, que es la parte falsable: la ficha efectivamente **ya no**
ofrece carga manual directa de la electrónica — `animals.spec.ts:1144` asserta el botón "Agregar caravana
electrónica" con `toHaveCount(0)` y después entra por `tag-scan-open` → `tag-scan-to-manual`. `TagScanCta`
**es** el único camino, y ocultarlo quitaría funcionalidad. Diferirlo con entrada de backlog es correcto.
(Y es justamente por eso que `asignar-caravanas` **no** califica para el mismo trato: ahí no hay
funcionalidad que preservar.)

### 4.3 La regresión de layout de `SpikeSessionHeader` — CERRADA de verdad

`app/app/maniobra/_components/SpikeSessionHeader.tsx:85` renderiza el slot como
`{right ? <View flexShrink={0}>{right}</View> : null}`, dentro de un `XStack` con `gap="$2"` (`:58`). Que un
componente renderice null **no** hace falsy al elemento React, así que `right={<BleConnectionChip/>}` habría
montado el `<View>` igual → 4º flex item vacío → **un gap de más** ($2). Con
`right={conectable ? <BleConnectionChip/> : undefined}` (`identificar.tsx:598`) el ternario de `:85` cae en
null → 3 items, 2 gaps: **el ancho vuelve entero al `YStack flex={1} minWidth={0}`** del nombre del rodeo
(`:75-78`, `numberOfLines={1}`). Correcto.
Y `conectable` (`identificar.tsx:204`) es **literalmente** la misma expresión que el chip evalúa adentro
(`BleConnectionChip.tsx:43-44`) sobre el **mismo** contexto → imposible que diverjan (header sin chip
mientras el chip quería pintarse).
En `(tabs)/animales.tsx:325` el guard **no** hace falta: el chip es hijo directo del `XStack` (`:319`,
space-between + `gap="$2"`) → devolver null no crea flex item. Correcto.

### 4.4 El ícono type-only — resuelve en las 3 plataformas

El import de `lucide-react-native` **no desapareció**: se movió del módulo puro (`ble-connection-view.ts`,
ahora solo `import type`) al **componente** (`BleConnectionChip.tsx:24`), que ya importaba tamagui /
react-native y **solo** corre bajo Metro. `CHIP_ICONS` (`:34-39`) mapea las 4 claves a los 4 componentes, y
`BleStatusIcon` es un union cerrado → el Record es exhaustivo por tipo (no hay undefined posible en
`CHIP_ICONS[view.icon]`). Es el patrón que el repo **ya usa dos veces** en producción nativa
(`StickConnectionScreen::statusIcon`, `StickStatusIndicator::iconFor`). Web: los 32 E2E lo ejercitan con el
chip visible. Native: sin device, pero el mecanismo es idéntico a los dos precedentes ya corriendo. **Sin
objeción.**

### 4.5 Falsificación — re-hecha, ver §1. Muerde en las 4 decisiones por separado.

### 4.6 E2E `animals.spec.ts` 35/2 — atribución CORRECTA

No re-corrí la suite completa (cara + DB compartida), pero la atribución se cierra por análisis de alcance:
los 2 rojos (delta aptitud RAR.1.3 en `:180` y delta #15 RCAP.4/RCAP.5 en `:1311`) corren **sin** flags BLE →
mode auto en web → transporte presente → **todas** las decisiones del diff toman la rama idéntica al
baseline. Ninguno toca `identificar`, `/baston` ni el chip. El diff **no puede** causarlos. (El único test de
`animals.spec.ts` que sí corre en modo manual — caravana-ficha, `:1116` — pasó, y su superficie
TagScanCta/TagScanSheet no se tocó.)

## 5. Contradicciones specs ↔ as-built

BLOQUEANTE (regla dura del proyecto) — `specs/active/04-bluetooth-baston/design-multivendor.md`, bloque de
reconciliación nuevo, último bullet: dice que `connection-view.test.ts` **"pasó de 10 a 16 casos (los 6
nuevos ...)"**. Medido: baseline `git show d9a3eb0` del archivo → **9** tests; árbol actual → **16**. Son
**7** nuevos, desde **9**. Dos números mal en la misma frase de verificación.
(En cambio "neutralizar el corte deja 5 casos en rojo" **es exacto**: mis mutaciones M1+M3 dan 2+3 = 5
sobre 21.)

Todo lo demás de la reconciliación lo verifiqué contra el código y **está bien**: `requirements-...md` RB8.1
(nota de acotación, EARS intacto), `design-09resto-...md` §6 (el bloque viejo que describía el defecto como
diseño quedó **tachado**, no borrado — correcto), `tasks-...md` T7.2 tachado + **T7.3 nueva [x]**, y el bloque
de spec 04 con las 5 piezas. La corrección de la entrada vieja de `docs/backlog.md` (el backOr excluido "por
territorio ajeno") también es correcta. El stash `pressable-sweep-wip` que documenta el backlog existe y
coincide exacto: 67 archivos, 2564 inserciones.

## 6. Nits (NO bloquean)

- `impl_...md` §3 dice "los **5** call sites de connect()". Son **8** en código de app: faltan
  `DemoControls.tsx:35` y `:45` y `BleStickListenerProvider.tsx:196` (manual.connect()). **No hay defecto**:
  `DemoControls` se auto-guarda con `if (!simulator) return null` (`:51`, y simulator exige que
  `api?.transport` sea instancia de `SimulatorAdapter`), y el manual es el piso permanente. Solo el conteo
  está mal.
- `StickConnectionScreen.tsx:116` — `const StatusIcon = statusIcon(status)` es el **único** elemento de la
  card que **no** pasa por la vista pura: sin transporte con un status no-off pegado, el ícono podría
  contradecir al label ("Bastón no disponible" con un TriangleAlert). Hoy inalcanzable (el provider solo
  suscribe onStatus dentro de `if (transport)`, `BleStickListenerProvider.tsx:199` — leído, no supuesto),
  pero es la única grieta del principio de "una sola fuente pura" que el propio fix defiende.
- Web sin Web Serial (Firefox/Safari/Chrome Android): hasTransport da true igual. Pre-existente, ver §2(B).

## 7. Trazabilidad R(n) ↔ test (verificada contra los archivos, no contra el informe)

| Requisito | Test que lo verifica | Estado |
|---|---|---|
| **RB8.1** (chip solo con transporte) | `app/src/components/ble-connection-view.test.ts` :: "sin transporte: el chip NO se renderiza en NINGUNO de los 6 estados" + E2E `app/e2e/baston-chip.spec.ts` (a) | OK (unit 21/21, E2E 32/32) |
| **RB8.1** (transitorio, transporte desmontado en caliente) | `ble-connection-view.test.ts` :: "sin transporte gana sobre el status..." | OK |
| **RB8.2** (refleja estado, nunca bloquea) | `ble-connection-view.test.ts` :: "con transporte, los 6 estados devuelven vista..." + "solo connected se declara conectado" · E2E `baston-chip.spec.ts` (b) | OK |
| **RB8.2/RB8.3** (web intacta) | `ble-connection-view.test.ts` :: "regresión web: el mapeo ... no cambió" · E2E `maniobra-identify.spec.ts` (m)/(e) | OK (16/16 en esa spec) |
| **RMV3.4** (sin transporte no se ofrece conectar) | `features/ble-stick/connection-view.test.ts` :: "sin transporte: NINGÚN estado ofrece un CTA" + "el copy es honesto..." + "sin transporte gana sobre el status" | OK |
| **RMV3.4** (regresión con transporte) | `connection-view.test.ts` :: "regresión web: CON transporte, los 6 estados quedan EXACTAMENTE como antes" | OK |
| **RMV3.7** (fila no accionable sin transporte) | `connection-view.test.ts` :: "un binding available:true NO deja la fila accionable" + "NINGÚN estado de fila es accionable sin transporte (4 combinaciones)" | OK |
| **RMV3.6** (salida manual siempre) | `connection-view.test.ts` :: asserts /mano/i en subtitles + `readsEmptyHint` | PARCIAL: cubierto en las superficies tocadas, **NO en `asignar-caravanas`** (§4.1: ahí no hay salida manual y nada lo testea) |
| **RMV3.5** (indicador global) | `baston-multivendor.spec.ts` (d) | OK |

Ningún R(n) del diff queda sin test. El PARCIAL de RMV3.6 no es un test faltante del diff: es la superficie
que no se barrió.

## 8. Tasks

**Sí** para esta unidad: `tasks-09resto-ble-global.md` **T7.3 [x]** (nueva, con verificación) y T7.2
reconciliada. Los `[ ]` que quedan en `specs/active/04-*/tasks*.md` y `09-*/tasks-*.md` son **pre-existentes
al baseline** y están justificados en el propio archivo: Fase 4/5 **gated por hardware** (T4.x, T5.x,
T-MV.5.x, T-MV.7.3 — no hay RS420 ni dev build), gates de negocio (MFi/Facundo, T-MV.6.2) y dos ítems del
**leader** (veto de diseño, T9.x del chunk). Ninguno es de este bugfix.

## 9. CHECKPOINTS.md

- **C1** — [x] harness completo · [x] docs presentes · [x] agentes · [x] `check.mjs` exit 0 (**ejecutado**).
- **C2** — [x] ninguna feature en in_progress (es un bugfix sobre 04/09, ambas deferred) · [x] features done
  con tests verdes · [x] `current.md` describe la sesión activa (el bloque del implementer quedó commiteado
  en 42a5e70).
- **C3** — [x] capas respetadas (`components/` = UI reutilizable sin fetch; `features/ble-stick/` = pantalla;
  módulos puros sin RN — `architecture.md:19-24`) · [x] **sin dependencias nuevas** en `package.json` ·
  [x] sin logs sueltos ni TODOs sin contexto · [x] sin `establishment_id` hardcodeado (el diff no toca datos).
- **C4** — [x] test por módulo con lógica (los 2 módulos puros; `ble-connection-view.ts` **estrena** test) ·
  [x] sin mocks de I/O innecesarios (las funciones son puras) · [x] runner > 0 y verde (2526) · N/A RLS.
- **C5** — [x] sin artefactos sin trackear (`__shots__/` gitignoreado; `design/` limpio al terminar) ·
  [ ] `history.md` — **N/A todavía**: lo cierra el leader al cerrar sesión · [x] estado de features correcto.
- **C6** — [x] specs presentes · [x] EARS intacto (RB8.1 se acota por nota, no se reescribe) · [x] tasks de la
  unidad en [x] · [x] cada R(n) con test · **[ ] exactitud de specs**: `design-multivendor.md` tiene una
  contradicción numérica con el as-built (§5).
- **C7** — N/A (el diff no toca tablas, RLS ni datos; es presentación pura).
- **C8** — N/A (no toca red, PowerSync, outbox ni queries; ningún import nuevo de supabase/fetch).
- **C9** — [x] suite E2E de regresión verde (`baston-chip.spec.ts`, **corrida por mí**, dentro de 32/32) ·
  [x] capture file con las 3 superficies **x 2 condiciones** (`baston-chip-sin-transporte.capture.ts`; el
  diseño de "dos pasadas" es el correcto para un bug de tipo "sobra algo") · [ ] **Gate 2.5 del leader**:
  pendiente, es de él, no del implementer · [x] `__shots__/*.png` no stageados.

## 10. Checklist RAFAQ-específico

**A. Multi-tenancy / RLS — N/A.** El diff no toca tablas, policies, `establishment_id` ni SQL.

**B. Offline-first — N/A.** No hay lecturas/escrituras, red, buckets ni conflictos. Ninguna pantalla del diff
agrega un request. La puerta manual (manual-first) queda intacta **en las superficies tocadas**.

**C. BLE — aplica.**
- [x] **Desconexión repentina**: el camino no se toca; cubierto y verde en `maniobra-identify.spec.ts` (e)
  "desconexión del bastón → fallback a manual sin perder la sesión" (corrido por mí).
- [ ] **Fallback manual en <=1 tap**: se cumple en `identificar` (hero manual promovido, 0 taps),
  `TagScanSheet` (manual detrás de 1 tap) y `/baston` (copy que apunta a la carga a mano) — **pero NO en
  `asignar-caravanas`**, que **no tiene** fallback manual y es alcanzable en 2 taps desde "Más". **Es el
  bloqueante de §4.1.**
- [x] **Correlación TAG-peso** — N/A (no hay balanza en este diff).
- [x] **Logs BLE no bloquean el flujo**: `logTransportEvent` no se tocó.

**D. UI de campo — aplica (parcial).**
- [x] **Targets**: no se agrega ningún target nuevo; se **elimina** uno (el chip era el elemento más chico del
  header). El resto de la pantalla roja no se mueve.
- [x] **Fuente legible en lo que el operario lee**: el copy nuevo de `/baston` va en `$5` (label) y `$3`
  (hint), los mismos tamaños que el copy que reemplaza. Sin degradación.
- [x] **Una decisión por pantalla**: mejora — el header de la manga pierde un elemento que competía.
- [x] **Loading visible**: sin cambios.

**E. Edge Functions — N/A.** El diff no toca `supabase/functions/**`.

## 11. Cambios requeridos (concretos)

1. **BLOQUEANTE** — `app/app/asignar-caravanas.tsx:365-379` (`EmptyQueueState`) + `app/app/(tabs)/mas.tsx:992-998`:
   superficie de la misma clase, no barrida. Cerrala con (i) copy honesto sin transporte (mismo patrón que
   `readsEmptyHint`) **o** (ii) entrada en `docs/backlog.md` con el rigor de la de `TagScanCta`. En los dos
   casos: corregir §3 ("barrida exhaustiva") y §5 ("el único overflow es TagScanCta") de
   `progress/impl_baston-chip-sin-transporte.md`.
2. **BLOQUEANTE** — `specs/active/04-bluetooth-baston/design-multivendor.md`, bloque de reconciliación, bullet
   de verificación: "pasó de 10 a 16 casos (los 6 nuevos)" → **9 → 16, 7 nuevos**.
3. (opcional) `impl_...md` §3: el conteo de call sites de connect() es 8, no 5 (`DemoControls.tsx:35,45` +
   `BleStickListenerProvider.tsx:196`) — sin defecto asociado.

Cerrados 1 y 2, esto es **APPROVED**: el núcleo del fix está bien pensado, bien ubicado (la decisión vive en
la función pura, no dispersa en el componente), bien testeado y **falsificado de verdad**.

## 12. Lo que NO pude verificar

- **Device Android / iOS**: sigue siendo el veredicto real y es de Raf. Web reproduce "sin transporte" con
  mode manual fielmente, pero en web el transporte siempre existe.
- **`animals.spec.ts` contra baseline**: no re-corrí la suite (cara + DB compartida). La atribución a flake la
  sostengo por análisis de alcance (§4.6), no por medición.
- **Píxeles**: no abrí los `__shots__` (gitignoreados; no disparé la corrida de captures). La regresión de
  layout del header la verifiqué **estructuralmente** (§4.3), que para "sobra un gap" es un oráculo más duro
  que una foto.
