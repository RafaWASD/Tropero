# impl — «acceso in-app a la pantalla de conexión del bastón» (delta de spec 04)

baseline_commit: c7f62599dec2ba762e97f173e533aff38b93f236

> Bugfix/delta chico sobre la feature 04 (bluetooth-bastón). **Todo el diff está sin commitear** sobre ese
> SHA (otra terminal está commiteando docs de marketing en paralelo; nada de eso es mío).

## 1. El reporte que lo originó

Raf, en device: abrió la app, el chip global quedó ciclando *"Conectando…"* (la reconexión automática de
R6.4 con el ESP32 apagado) y **no tuvo ninguna manera de llegar a la pantalla del bastón** para cortarlo ni
para revisar. `/baston` existía desde el 2026-07-20, estaba registrada en `_layout.tsx`, y su **única**
entrada era el deep-link: la fila de "Más" nunca se cableó (quedó como coordinación pendiente entre
terminales). O sea: RMV3.1 —*"accesible desde la sección «Más»"*— **afirmaba un punto de entrada que no
existía**.

## 2. Qué toqué

| Archivo | Qué |
|---|---|
| `app/src/features/ble-stick/connection-view.ts` | **+`connectionRowStatus(status, env): { text, tone }`** (pura) y **+`toneColorToken(tone)`** (pura, exportada). |
| `app/src/features/ble-stick/connection-view.test.ts` | **29 → 37** casos (8 nuevos). |
| `app/app/(tabs)/mas.tsx` | Sección **"Bastón"** + `Card` + componente local `StickRow` (`ActionRow` → `/baston`, trailing con el estado en vivo). |
| `app/src/features/ble-stick/screens/StickConnectionScreen.tsx` | `router.back()` → `backOr(router, '/(tabs)/mas')`. |
| `app/e2e/baston-multivendor.spec.ts` | +2 casos: **(e)** navegación Más→`/baston`→vuelta, **(f)** contrafáctico sin transporte. |
| `app/e2e/captures/baston-multivendor.capture.ts` | **`07-indicador-global-chrome` restaurada** + `08`, `09`, `10` nuevas; cabecera actualizada. |
| `specs/active/04-bluetooth-baston/{requirements,design,tasks}-multivendor.md` | Reconciliación al as-built (RMV3.1, design §7, T-MV.4.5 + T-MV.4.7 nueva + trazabilidad). |
| `docs/backlog.md` | Ítem 3 del 2026-07-30 → **RESUELTO**; entrada del 2026-07-29 (`router.back()`) → **RESUELTO**. |

## 3. Decisiones (y por qué)

### 3.1 Ubicación: entre la card de Perfil y el bloque "Campo activo"

Venía decidida en el encargo y la verifiqué contra el código antes de aplicarla: el bloque "Campo activo"
está envuelto en `{activeField ? (…) : null}` (`mas.tsx:1035`), así que meter la fila ahí la haría
**desaparecer justo cuando el usuario no tiene campo resuelto**. Y sería semánticamente falso: el bastón se
empareja con el **teléfono**. Sin gate de rol tampoco: conectar el bastón es trabajo de manga.

### 3.2 Ícono: `StickIcon` (registro central) y no `Bluetooth` ni `Radio`

`@/theme/icons` es el "single source of truth" declarado de los íconos, y ya tiene `StickIcon` (= `ScanLine`)
documentado como *"bastón / lector RFID de caravana electrónica (CONTEXT/05, spec 04)"*. Es el glifo con el
que la app **ya** representa el bastón en `TagScanCta`, `TagScanSheet`, `maniobra/identificar` y la propia
`StickDeviceRow` de `/baston` — la fila lleva al mismo objeto, así que usar otro glifo lo desincronizaría,
que es literalmente el problema que ese registro existe para evitar.

Descartados: **`Bluetooth`/`BluetoothConnected`** (los del chip) porque nombran el **transporte**, no el
dispositivo — y además el bastón de iOS a futuro no va por Bluetooth Classic sino por MFi/HID, con lo cual
el glifo envejecería mal; y **`Radio`**, porque en esta misma pantalla ya rotula "Asignar caravanas en masa"
(dos filas con el mismo ícono a dos destinos distintos).

### 3.3 El texto de estado NO se deriva en `mas.tsx`

Regla dura del encargo, y coincido con el fundamento: `connection-view.ts` documenta en su encabezado el bug
que cerró el 2026-07-29 (*"una decisión de presentación viviendo fuera del archivo donde se decide y se
testea"*). La función nueva es `connectionRowStatus(status, env)`, con la **misma firma de entorno**
(`ConnectionEnv`) que `connectionStatusView` — incluido el corte por `hasTransport` **antes** del switch y el
`autoConnectExhausted` de R6.4.

Copy (corto, es-AR):

| entrada | text | tone |
|---|---|---|
| `hasTransport: false` (cualquier status) | `No disponible` | idle |
| `connected` | `Conectado` | success |
| `connecting` | `Conectando…` | progress |
| `scanning` | `Reintentando…` | warning |
| `disconnected` | `Desconectado` | warning |
| `permission_denied` | `Sin permiso` | warning |
| `off` | `Sin conectar` | idle |
| `off` + `autoConnectExhausted` | `No encontrado` | idle |

Incluí `autoConnectExhausted` aunque el encargo no lo pedía: sin él, la fila diría *"Sin conectar"* justo
después de que la app pasó dos minutos buscando el bastón, que es exactamente el copy deshonesto que R6.4
vino a arreglar en la pantalla. Se lee del transporte (`transport?.autoConnectExhausted`) igual que en
`StickConnectionScreen`, y por el mismo motivo: el adapter lo setea **antes** de emitir el cambio de estado
que dispara el re-render.

### 3.4 `toneColorToken` se exporta desde el módulo puro

> ⚠ **Corregido en el fix-loop (🟠-1).** La redacción original de esta sección decía *"tres copias privadas
> e **idénticas**"* y eso **es falso**: `StickDeviceRow:21` **diverge**. Ver §12.1. Lo que sigue es la
> versión corregida.

Necesitaba traducir `ViewTone` → token de color en `mas.tsx`. Ya hay **tres copias privadas** de esa
traducción (`StickConnectionScreen:88`, `StickDeviceRow:21`, `StickStatusIndicator:63`). Escribir una cuarta
en `mas.tsx` habría sido otra decisión de presentación fuera del archivo donde se testea. La subí a
`connection-view.ts` (es pura: devuelve el **nombre** del token, no importa Tamagui → node:test la carga) y
la usa el call site nuevo.

**No refactoricé las tres viejas**: es un barrido cross-file que excede esta unidad, y una de ellas vive en
el chip, congelado por otra unidad en curso. Pero **no son intercambiables entre sí**: `StickDeviceRow` manda
`'progress'` a la rama del `default` junto con `'idle'` → `$textMuted`, donde las otras tres dan `$primary`.
Hoy es inalcanzable (`deviceRowView` nunca emite `tone:'progress'`), así que no hay bug vivo — pero significa
que **el barrido futuro NO es un no-op**: quien unifique va a cambiar un color. Queda escrito en el doc
comment de la función (código de producción) y en `design-multivendor.md`, no solo acá.

### 3.5 La fila **no** se oculta sin transporte

Decisión deliberada, opuesta a la del chip. El chip es un indicador de estado que sin transporte no informa
nada → se auto-oculta. La fila es el **único camino in-app** a la pantalla, y esa pantalla es la que explica
la salida manual: ocultarla la volvería indescubrible justo en el device donde más hace falta entender qué
pasa. Es el mismo argumento (y el mismo precedente) que la fila de "Asignar caravanas en masa" del bugfix
2026-07-29. Lo que cambia es que el trailing dice `No disponible` en vez de mentir. Tiene captura propia
(shot 10) para que el leader pueda vetar la decisión mirándola.

### 3.6 Componente `StickRow` propio en vez de hooks en `MasScreen`

Los hooks de conexión en `MasScreen` harían que **toda** la pantalla de ajustes se repinte en cada
`connection_changed`. Acotado al subcomponente, se repinta una fila.

### 3.7 Defaults menores que tomé sin preguntar

- **`accessibilityLabel`**: `` `Bastón: ${estado}. Abrí la pantalla de conexión del bastón` `` — el estado va
  DENTRO del nombre accesible (un lector de pantalla no "ve" el trailing como parte de la fila si no está).
  Consecuencia: los locators E2E lo matchean con regex, no con string exacto.
- ~~**`fontSize="$3"`** + `fontWeight="600"` para el trailing~~ → **corregido a `$4` en el fix-loop (🟡-5),
  ver §12.3.** El razonamiento original ("mismo tamaño que los subtítulos secundarios de la pantalla") era
  el equivocado: este texto no es un subtítulo, es el dato que justifica que la fila exista.
- **Techo de largo del texto: 16 caracteres**, fijado por test. Hoy el máximo real es `Reintentando…` (13).

## 4. Verificación — qué EJECUTÉ vs. qué LEÍ

### Ejecutado (lo corrí y lo vi)

| Qué | Resultado |
|---|---|
| `pnpm typecheck` (app) | verde |
| `node --test connection-view.test.ts` | **37/37** (antes 29) |
| **Falsificación** del test nuevo: mutar la rama sin transporte a copy largo + `tone: 'success'` | **5 rojos**, restaurado y re-verde |
| `pnpm run e2e:build` | ok |
| `playwright test e2e/baston-multivendor.spec.ts` | **6/6** (los 4 viejos + (e) + (f)) |
| Regresión de superficies que tocan "Más": `asignar-caravanas-sin-transporte` + `auth` + `account` | **9/9** |
| `playwright test e2e/captures/baston-multivendor.capture.ts --config playwright.capture.config.ts` | **2/2**, **10 shots** generados |
| `node scripts/check.mjs` | **verde end-to-end** ("Entorno listo") |
| Inspección visual de los shots 08 / 09 / 07 / 10 (los abrí, y 08 y 10 los amplié ×3 y ×5) | ver §5 |
| `grep router.back()` en `app/app` + `app/src` | solo quedan **comentarios**; **cero call sites** |
| `git status` post-E2E | **sin churn** de `design/**/*.png`; `__shots__` está gitignored |

### Leído / razonado (NO ejecutado)

- **El árbol de `(tabs)` está dentro del `BleStickListenerProvider`**: lo verifiqué **leyendo**
  `app/app/_layout.tsx:697-699` (`<BleStickListenerProvider …><BleHost/></BleStickListenerProvider>`, y
  `BleHost` renderiza el `<RootGate/>` que monta el Stack con `(tabs)`). Que el E2E pase con estados de
  conexión reales en la fila es evidencia indirecta fuerte de lo mismo.
- **La degradación sin provider** (`useBleProviderApi()` → `null`, `useBleConnectionStatus()` → `'off'`) la
  verifiqué **leyendo** los defaults de los contextos (`ConnectionStatusContext = createContext('off')`,
  `ProviderContext = createContext<ProviderApi|null>(null)`). No la ejecuté: no hay forma de montarla en la
  app (ver punto anterior) y node:test no renderiza RN.
- **`autoConnectExhausted` se setea antes del emit**: leído en `adapter-spp-android.ts:1214` (el comentario
  lo declara explícitamente). El estado `No encontrado` **no está probado en device ni en E2E** — solo por
  unit sobre la función pura. Es el mismo nivel de evidencia que tiene hoy la pantalla.
- **Comportamiento en NATIVO**: todo lo E2E es **web**. La fila en Android/iOS no se probó en device.

## 5. Autorrevisión adversarial (qué busqué, qué encontré, cómo lo cerré)

1. **¿Colisión de textos con las ~70 specs E2E?** La fila agrega los strings `Bastón`, `Sin conectar`,
   `Conectado`, etc. a **todas** las corridas que pasen por "Más". Grepeé el árbol `e2e/` por
   `'Bastón'`/`'Conectado'`/`'Desconectado'`/`'Sin conectar'`/`'No disponible'`/… en aserciones exactas →
   **cero**. Y corrí las 3 suites que más usan "Más" (9/9).
2. **Strict-mode al navegar a `/baston`.** El tab "Más" queda **montado detrás** del Stack, así que
   `getByText('Bastón', { exact: true })` en `/baston` matchea el título del header **y** el label de la
   fila. Lo encontré antes de escribir el test y por eso el oráculo del destino es `stick-device-row` +
   `Dispositivos` + la URL, nunca el título.
3. **Test que pasa por la razón equivocada.** (e) sola pasaría con un trailing hardcodeado en "Sin
   conectar". Agregué **(f)** como contrafáctico (modo `manual` → sin transporte → `No disponible`, y la
   ausencia del otro string en cada caso). Mismo patrón de dos oráculos que
   `asignar-caravanas-sin-transporte.spec.ts`.
4. **El unit podía no cazar nada.** Lo falsifiqué con un mutante (§4): 5 rojos. Además metí un
   **invariante duro** que no existía: `connectionRowStatus(s, env).tone === connectionStatusView(s, env).tone`
   para **toda** combinación — la fila no puede pintarse de verde "conectado" mientras la card dice "no
   disponible".
5. **Descendentes (bug de clase del repo).** Puse `lineHeight="$3"` matcheando el `fontSize`, pero me di
   cuenta de que **las capturas no lo probaban**: los estados fotografiados eran `Sin conectar` y
   `Conectado`, **ninguno con descendente**. Agregué el shot **10** (`No disponible`, con la `p`) y lo
   **amplié ×5**: la `p` renderiza completa, sin recorte. Sin ese agregado, el veto visual habría sido vacío.
6. **`router.back()` residual.** Verifiqué por grep que no queda ningún call site pelado en la app (solo
   menciones en comentarios) — la afirmación del backlog ahora es medida, no heredada.
7. **Overflow de la fila.** El label es `flex:1 numberOfLines:1` y el trailing `flexShrink:0`: un texto de
   estado largo empujaría. Lo cerré con un test de techo (≤16 chars) y con la prohibición de repetir la
   palabra "Bastón" en el trailing (ya es el label).
8. **Regresión del tap (bug `Pressable`+Tamagui).** `ActionRow` es un `XStack` de Tamagui con `onPress` +
   `pressStyle` en la misma pieza — el patrón correcto; no introduje ningún `<Pressable>` de RN envolviendo.

## 6. Lo que dejé AFUERA (a propósito)

- **El chip global sigue no-tocable.** No lo miré siquiera de reojo: hacerlo tappable es una decisión de UX
  sobre una requirement que ya pasó Gate 2.5.
- **`scanning` sigue sin CTA.** Vale ser explícito porque roza el reporte original: llegar a `/baston` con el
  estado `Reintentando…` **no** ofrece un botón para frenar (`connectionStatusView` devuelve `cta:'none'`).
  Lo que sí ofrece la pantalla es **"Olvidar el bastón guardado"** (R6.6), que desconecta y borra la MAC —
  ese es el corte real disponible hoy. Y la cadena que arranca **sin gesto** ya tiene tope de 120 s (T-MV.5.20)
  → termina en `'off'`, que sí tiene CTA. El "Cancelar" en `scanning` es una decisión de UX pendiente de Raf,
  documentada en `docs/backlog.md` (2026-07-30, ítem 2, "RESUELTO A MEDIAS"). **Esta unidad da el acceso, no
  cambia los CTA de la pantalla.**
- **Las 3 copias privadas de `toneColorToken`** (ver §3.4). Confirmado en el fix-loop que **una de ellas
  diverge** y que por eso el barrido no es mecánico — sigue afuera de esta unidad, pero ahora está
  documentado como lo que es.
- **Device test.** Nada de esto se corrió en el Android de Raf.

## 7. Observación para el veto de diseño (Gate 2.5)

Mirando el shot 08 ampliado: la palabra **"Bastón" aparece dos veces seguidas** —como `SectionTitle` y como
label de la fila— porque la sección tiene una sola fila. Es la ubicación y el copy que venían decididos en el
encargo, así que los implementé tal cual y no me desvié; lo dejo señalado por si al verlo se prefiere otra
cosa. Alternativas, si se quisiera: (a) sección **"Dispositivos"** + fila "Bastón" (pero "Dispositivos" ya es
el título de una sección **dentro** de `/baston`, así que confundiría); (b) sacar el `SectionTitle` y dejar la
card suelta (rompe el ritmo de la pantalla, que titula todo); (c) dejarlo como está — es el patrón de
Settings de iOS y no molesta. **Mi recomendación: (c)**, la redundancia cuesta menos que cualquiera de las
otras dos.

Segunda observación menor, visible en el shot 07: con el bastón conectado, en "Más" el estado se dice **dos
veces** (el trailing "Conectado" + el pill global "Bastón conectado" abajo). No es un defecto —el pill es
global y se auto-oculta en `'off'`, o sea en el 99 % del tiempo— pero es la única pantalla donde conviven.

## 8. Trazabilidad

| Requirement | Cubierto por |
|---|---|
| **RMV3.1** (pantalla accesible desde "Más") | `app/e2e/baston-multivendor.spec.ts` → `(e) RMV3.1: la fila "Bastón" del tab "Más" navega a /baston, y el chevron vuelve a "Más"` |
| **RMV3.1** (la fila no se oculta sin transporte) | `app/e2e/baston-multivendor.spec.ts` → `(f) RMV3.1: sin transporte la fila sigue en "Más", dice "No disponible" y navega igual` |
| **RMV3.4** (copy de estado, versión corta) | `app/src/features/ble-stick/connection-view.test.ts` → `RMV3.1 fila: …` ×5 + `RMV3.1 fila: el TONO nunca contradice a la card…` |
| **R6.4** (copy honesto con el auto-connect agotado, en la fila) | `connection-view.test.ts` → `R6.4 fila: el auto-connect agotado no dice "Sin conectar"…` |
| **ADR-023 §4** (tokens-only en el color del trailing) | `connection-view.test.ts` → `toneColorToken: los 4 tonos mapean a un token del DS…` |
| **`backOr`** (rama `back()` con stack real) | E2E `(e)`, tramo final; la rama del fallback ya la cubre `app/src/utils/nav.test.ts` |
| **RMV3.5** (evidencia visual del chip global) | captura `07-indicador-global-chrome` (restaurada) |

## 9. Capturas (Gate 2.5, ADR-029)

`pnpm exec playwright test e2e/captures/baston-multivendor.capture.ts --config playwright.capture.config.ts`
→ **2/2**, 10 shots en `app/e2e/captures/__shots__/baston-multivendor/`:

- `07-indicador-global-chrome.png` — **restaurada**. Chip "Bastón conectado" sobre el tab "Más", anclado
  arriba del nav y del pico del FAB, sin pisar el título.
- `08-mas-fila-baston.png` — pantalla completa de "Más": **ubicación** de la sección (después de Perfil,
  antes de "Campo activo") + la fila en reposo.
- `09-fila-mas-baston-conectado.png` — banda de la fila con el estado en vivo "Conectado".
- `10-fila-mas-baston-sin-transporte.png` — banda de la fila con "No disponible" (decisión de no ocultarla +
  el único estado con descendente montable a voluntad).
- `01`…`06` — sin cambios de intención; `01`-`06` ahora se alcanzan entrando por la fila (navegación
  client-side) en vez de por deep-link.

El `.capture.ts` se commitea; los `__shots__/*.png` están gitignored (`app/.gitignore:29`) y **no** los
agregué al índice.

## 10. Reconciliación de specs

- **`requirements-multivendor.md` / RMV3.1** — nota de reconciliación 2026-08-05: el EARS decía "accesible
  desde «Más»" y eso era **falso** hasta hoy; queda documentado el as-built (ubicación, no-gate por
  campo/rol, trailing en vivo, no-ocultamiento sin transporte) y el efecto colateral cerrado (`backOr` +
  captura 07). El EARS **no se reescribió**: ahora es cierto.
- **`design-multivendor.md` §7** — el bullet "Ruta en «Más»" quedó marcado `[CERRADO el 2026-08-05]` y se
  agregó un bloque de reconciliación as-built completo (incluida la justificación del ícono y la nota de las
  3 copias de `toneColorToken`).
- **`tasks-multivendor.md`** — T-MV.4.5 marcada como cerrada por la nueva **T-MV.4.7** (`[x]`, con el
  as-built y los números de verificación); fila de trazabilidad RMV3.1 actualizada.
- **`docs/backlog.md`** — ítem 3 de "Tres deudas que dejó el fix de los bloqueantes del SPP" (2026-07-30) →
  **RESUELTO 2026-08-05**; entrada "`StickConnectionScreen`: el único `router.back()` pelado" (2026-07-29) →
  **RESUELTO 2026-08-05**, con el título anotado. Ninguna entrada borrada.

## 11. Estado

~~**Listo para reviewer.**~~ → El reviewer dio **CHANGES_REQUESTED** (`progress/review_baston-acceso-mas.md`).
Ver el fix-loop en §12. No commiteado (lo hace el leader). No marqué nada como `done`.

---

# 12. FIX-LOOP del review (2026-08-06)

Cerré los **dos bloqueantes** (🟠-1, 🟠-2) y los **dos menores** que el leader me asignó (🟡-3, 🟡-5).
🟡-4 quedó **fuera por decisión**, anotado en el backlog (§12.5). Ninguno de los cuatro cambia una línea de
lógica; el único con efecto visible es 🟡-5 (un token de `fontSize`).

## 12.1 🟠-1 — "tres copias privadas e IDÉNTICAS" era falso: `StickDeviceRow` diverge

El reviewer tenía razón y lo verifiqué yo mismo leyendo el archivo
(`app/src/features/ble-stick/components/StickDeviceRow.tsx:21-32`): mete `'progress'` en la rama del
`default` junto con `'idle'`.

| archivo | `success` | `progress` | `warning` | `idle` |
|---|---|---|---|---|
| `connection-view.ts` (canónica, la que subí) | `$primary` | **`$primary`** | `$terracota` | `$textMuted` |
| `screens/StickConnectionScreen.tsx:89` | `$primary` | `$primary` | `$terracota` | `$textMuted` |
| `components/StickStatusIndicator.tsx:63` | `$primary` | `$primary` | `$terracota` | `$textMuted` |
| `components/StickDeviceRow.tsx:21` | `$primary` | **`$textMuted`** ← diverge | `$terracota` | `$textMuted` |

Confirmé también que hoy es inalcanzable: los cinco returns de `deviceRowView` usan `success` / `idle` /
`idle` / `idle` / `warning` — **nunca** `progress`.

Lo grave no era el color (no hay bug vivo) sino **dónde** estaba escrita la mentira: en un doc comment de
código de producción, prometiéndole al próximo que unificar es gratis. Corregí los tres lugares para que
digan lo contrario — que hay divergencia real, por qué hoy no se ve, y que **el barrido futuro NO es un
no-op**:

- `app/src/features/ble-stick/connection-view.ts` (doc comment de `toneColorToken`).
- `specs/active/04-bluetooth-baston/design-multivendor.md` (bloque de reconciliación 2026-08-05).
- este informe, §3.4 y §6.

**No unifiqué** (el leader lo prohibió explícitamente, y coincido: una de las copias vive en el chip, que
está congelado por otra unidad, y elegir cuál de los dos colores es el correcto es una decisión de diseño,
no un refactor).

## 12.2 🟠-2 — Reconciliación incompleta sobre el shot 07

**(a) `design-multivendor.md`**, cierre del sub-bullet 2 del bloque "Reconciliación as-built (MV.4,
2026-07-20)". Decía dos cosas que esta unidad volvió falsas: que el shot 07 es *"el indicador anclado al
fondo en `/crear-animal`"*, y que *"el único `router.push` client-side desde `/baston` que preserva la
conexión es «Dar de alta»"*. Le puse la misma anotación `[CERRADO el 2026-08-05 — ver la reconciliación de
abajo]` que ya tenía su bullet hermano, enumerando las dos cláusulas viejas y agregando el tramo intermedio
(entre BENCH-3 y hoy el shot estuvo caído, y por qué). No reescribí el texto original: la convención del
repo es anotar, no borrar.

**(b) `tasks-multivendor.md` / T-MV.7.2** — es la task dueña de los dos artefactos que toqué y sus números
eran de otra época ("4 casos, 4/4", "6 shots", *"el shot 07 se CAYÓ … vuelve cuando «Más» tenga la fila"*).
Agregué un bloque `[RECONCILIACIÓN 2026-08-05]` con los números reales (6 casos / 6 verde, 10 shots en 2
tests, el 07 restaurado sobre el tab "Más" y no `/crear-animal`) y qué aporta cada shot nuevo. Tenía razón
el reviewer en que agregar T-MV.4.7 no alcanzaba: T-MV.7.2 seguía describiendo los mismos archivos de otra
manera.

## 12.3 🟡-5 — El trailing pasó de `$3` (13px) a `$4` (14px), **medido** a 360px

Acepto el argumento sin reservas: el trailing **es** el argumento de existencia de la fila (§3.3), y lo dejé
como el texto más chico de su propia fila. Ahora va `fontSize="$4" lineHeight="$4"` (sigue por debajo del
label `$5`, que es el nombre del destino).

El leader pidió medir el ancho a 360px en vez de estimarlo. Lo hice con un probe temporal de Playwright
(`__tmp-360-probe.capture.ts`, **ya borrado**) contra el build real, en viewport 360×800 y modo `manual`
(que es el que muestra el estado más largo):

- Fila: `x=18 w=324`. Label "Bastón": `x=97 w=96`. Trailing "No disponible": `x=206 w=91`.
- `scrollWidth === clientWidth` (91 === 91) → **el navegador no lo trunca**.
- Ancho REAL de los 8 estados posibles, medidos con la fuente y el estilo del nodo ya renderizado:
  `Conectado` 73 · `Sin permiso` 78 · `Sin conectar` 83 · `No disponible` 91 · `Conectando…` 93 ·
  `Desconectado` 96 · **`Reintentando…` 99** · **`No encontrado` 99**.
- Peor caso = **99px**. Con el chevron (20) y el gap `$2` (8), el trailing ocupa 127px → el label queda con
  **89px** para "Bastón", que a `$5` necesita ~52px. **37px de aire.** No desborda ni trunca.

También re-verifiqué ópticamente el descendente al tamaño nuevo: zoom ×5 del shot 10 → la **`p` de
"disponible" renderiza completa**, sin recorte (el `lineHeight` matcheado hace su trabajo a `$4` igual que a
`$3`).

## 12.4 🟡-3 — Comentarios "deep-link-only" que quedaron falsos

- `app/e2e/captures/baston-spp-bloqueantes.capture.ts:126` — el `page.goto('/baston')` **se queda** (esa
  captura documenta el arreglo de la doble ingesta, no el punto de entrada, y el `goto` la deja
  independiente de la nav); lo que cambié es el comentario, que ahora dice que la fila existe y que el
  deep-link es una elección, no la única opción.
- `app/e2e/asignar-caravanas-sin-transporte.spec.ts:9` — reescrito para fechar la afirmación: cuando se
  escribió, `/baston` era deep-link-only y esta pantalla era la más accesible de las dos; hoy están a la
  par, y lo que no cambió es el punto del test (ese vacío mentía).

**NO toqué** `specs/active/09-buscar-animal/tasks-09resto-dedup.md:73`, que el reviewer marcó como
prioridad menor: está dentro del as-built **fechado** de otra unidad, y la convención del repo es no
reescribir registro histórico. Si el leader prefiere anotarlo (no reescribirlo), es una línea.

## 12.5 🟡-4 — Queda AFUERA, como decisión anotada

El leader no me lo asignó y no lo hice. Pero el reviewer pidió explícitamente que, si no se hacía, quedara
*"en `docs/backlog.md` como decisión, no como olvido"* — así que le abrí una entrada propia
(**"2026-08-05 — Se cerró el último `router.back()` pelado y NO se dejó el guard que lo mantenga
cerrado"**) con las dos mitades que faltan: el test de la rama del fallback (3 líneas dentro de una spec
E2E que ya existe: los casos (a)-(d) ya entran con el stack vacío) y el guard estático sobre la ausencia.
Si el leader prefiere no tenerla en el backlog, se borra en una línea.

## 12.6 ⚪-6 / ⚪-7 — Reconocidos, no cerrados

- **⚪-6**: es cierto que ningún test protege la UBICACIÓN de la fila fuera del bloque "Campo activo" (los
  dos E2E siembran establecimiento). Y **no verifiqué** si el estado "logueado, dentro de `(tabs)`, sin
  campo activo" es siquiera alcanzable (el `RootGate` podría rutear a onboarding antes). O sea: el
  fundamento que repito en §3.1 y en las specs **puede ser más débil de lo que suena**. Lo dejo dicho en
  vez de darlo por bueno. El otro medio del argumento —que el bastón es del teléfono y no del campo— no
  depende de eso y se sostiene solo.
- **⚪-7**: el `accessibilityLabel` muta con el estado. Documentado desde el informe original (§3.7); el
  efecto para un lector de pantalla real **no está evaluado**.

## 12.7 Verificación del fix-loop (lo corrí y lo vi)

| Qué | Resultado |
|---|---|
| `pnpm typecheck` | **verde** |
| `node --test … connection-view.test.ts` | **37/37** — el techo de largo (≤16 chars) no se movió: es sobre el string, no sobre el tamaño de fuente |
| `pnpm run e2e:build` (rebuild con `$4`) | ok |
| Probe de ancho a **360×800** con los 8 estados (temporal, ya borrado) | peor caso 99px, **sin truncar**, 37px de aire — §12.3 |
| `playwright test e2e/baston-multivendor.spec.ts` | **6/6** contra el build nuevo |
| `playwright test … baston-multivendor.capture.ts --config playwright.capture.config.ts` | **2/2, 10 shots regenerados** |
| Inspección de los shots 09 y 10 + zoom ×5 del descendente a `$4` | sin recorte, sin desborde |
| `git status` | **sin churn** de `design/**/*.png`; probe y scripts temporales borrados |

**Lo que NO volví a correr, y por qué**: `node scripts/check.mjs` completo. Ya dio verde sobre este diff
(y el reviewer lo re-corrió, RC=0). Lo único que cambió desde entonces es **un token de `fontSize`** en un
`.tsx` (que `tsc` sí ve, y `pnpm typecheck` está verde) más texto de comentarios y specs. Correrlo de nuevo
son ~10 min contra la DB remota **compartida con otra terminal activa**, con el riesgo conocido de rojo por
rate-limit de auth y sin información nueva a cambio. Si el leader lo quiere igual, es una corrida.

**Aviso sobre las capturas (el leader pidió que lo dijera)**: 🟡-5 **sí** movió shots. Los **regeneré yo**
(2/2 verde) porque ya tenía el `dist` rebuildeado, así que los 10 PNG de
`app/e2e/captures/__shots__/baston-multivendor/` ya reflejan el trailing en `$4`. **No hace falta que
re-corras nada** para el veto visual.

## 12.8 Archivos tocados en el fix-loop

| Archivo | Ítem |
|---|---|
| `app/src/features/ble-stick/connection-view.ts` | 🟠-1 (doc comment) |
| `specs/active/04-bluetooth-baston/design-multivendor.md` | 🟠-1 + 🟠-2(a) |
| `specs/active/04-bluetooth-baston/tasks-multivendor.md` | 🟠-2(b) |
| `app/app/(tabs)/mas.tsx` | 🟡-5 (`$3` → `$4` + `lineHeight`) |
| `app/e2e/captures/baston-spp-bloqueantes.capture.ts` | 🟡-3 |
| `app/e2e/asignar-caravanas-sin-transporte.spec.ts` | 🟡-3 |
| `docs/backlog.md` | 🟡-4 (entrada nueva, como decisión) |
| `progress/impl_baston-acceso-mas.md` | §3.4, §3.7, §6, §11 corregidos + §12 |

Cero cambios de lógica. El único cambio de comportamiento observable es el tamaño del texto del trailing.
