# Review conjunta — purpose strings iOS (vuelta 2) + ambiente por perfil + gate del chip de crash

**Fecha**: 2026-08-11 · **Revisor**: reviewer · **Base**: `775662e` + working tree sin commitear
**Reportes revisados**: `progress/ios-purpose-strings.md` (v1 + v2), `progress/ambiente-por-perfil.md` (v1 + v2)
**Review previa (v1 de A)**: `progress/review_ios-purpose-strings.md` — no se repite lo ya aprobado.

## Veredicto

**APPROVED**

Los tres cambios pasan. Reproduje por mi cuenta la premisa que sostenía el más frágil (el `<array/>`), y
falsifiqué los tres guards con **21 mutantes propios**: 19 rojos esperados, 1 verde esperado, 1 verde
esperado que salió rojo por una razón que **no** es un defecto del guard (§4, P6). El único hueco que
encontré es cosmético y lo dejo anotado sin retener la aprobación (§9, G6).

El riesgo que el implementer declaró y no pudo cerrar —la regla del validador de Apple sobre un
`UISupportedExternalAccessoryProtocols` vacío— **sigue abierto**. Lo acoté parcialmente con una
constatación local (§3), pero no lo verifiqué y no lo maquillo.

---

## 1. Alcance: qué es cada cambio y qué NO revisé de nuevo

| | Cambio | Estado |
|---|---|---|
| **A-v1** | Las dos purpose strings de Bluetooth + el guard de 12 tests | **YA APROBADO** (`review_ios-purpose-strings.md`). El diff nuevo no las tocó salvo comentarios → no re-falsificado |
| **A-v2** | `UISupportedExternalAccessoryProtocols: []` + 3 tests nuevos + los 4 comentarios exagerados reescritos | **revisado acá** |
| **B** | `EXPO_PUBLIC_ENV` en los 5 perfiles de `eas.json` + `app/eas-profiles-guard.test.ts` | **revisado acá** |
| **C** | `__DEV__ && getAppEnv() === 'development'` en `app/src/utils/dev-crash-gate.ts` + su test | **revisado acá** |

---

## 2. El `<array/>` — REPRODUCIDO, no aceptado de palabra

Era la premisa que sostenía todo A-v2: si Expo podara los valores vacíos, la clave no llegaría al plist,
`object(forInfoDictionaryKey:)` seguiría devolviendo `nil` y el arreglo sería decorativo.

Lo reproduje en **dos tramos encadenados**, con las mismas piezas que usa el prebuild:

**(a) La clave sobrevive a TODA la cadena de mods**, no solo al objeto de `app.config.ts`. Corrí
`npx expo config --type introspect --json` (modo introspección: ejecuta los mods sin escribir), y en el
`ios.infoPlist` **resuelto** quedó:

```
  present: true
  value  : []
  NSBluetoothAlwaysUsageDescription    : "miTropero se conecta por Bluetooth con el bastón lector…"
  NSBluetoothPeripheralUsageDescription: "miTropero se conecta por Bluetooth con el bastón lector…"
```

Coherente con el fuente: el merge de `withIosBaseMods.js` es un spread sin poda
(`{...modResults, ...config.ios.infoPlist}`) y nuestro objeto va último, así que gana.

**(b) La escritura.** Tomé ese infoPlist introspectado y le apliqué **la misma llamada** del `write()`
(`plist.build(sortObject(modResults))`, `withIosBaseMods.js`):

```
    <key>UISupportedExternalAccessoryProtocols</key>
    <array/>

round-trip plist.parse → present: true · value: [] · isArray: true
CONTROL NEGATIVO (sin la clave) → undefined
```

**Verificado.** La clave existe en el plist como `<array/>`, y el round-trip devuelve un array de verdad
(no `null`, no `undefined`). El force-cast recibe un `NSArray` vacío, no `nil`.

Único eslabón que **no** ejecuté y digo que no ejecuté: que Swift bridge un `NSArray` vacío a `[String]`
sin trapear. No tengo iPhone ni toolchain de Apple acá. Es el comportamiento estándar del bridge
(`as!` sobre colecciones hace bridge elemento por elemento; con cero elementos es trivialmente exitoso),
pero es razonamiento, no medición.

También verifiqué el motivo, en el fuente instalado
(`node_modules/react-native-bluetooth-classic/ios/RNBluetoothClassic.swift:65-69`):

```swift
override init() {
    self.eaManager = EAAccessoryManager.shared()
    self.notificationCenter = NotificationCenter.default
    self.supportedProtocols = Bundle.main
        .object(forInfoDictionaryKey: "UISupportedExternalAccessoryProtocols") as! [String]
```

Y la cadena que lo hace alcanzable: `adapter-spp-android.ts:190` lee `NativeModules.RNBluetoothClassic`,
y lo único que hoy lo frena en iOS es el `Platform.OS !== 'android'` de `isSppNativeAvailable()`
(`:204-212`), más `adapter-selection.ts` devolviendo `'manual'` para iOS. El design.md describe
exactamente eso.

---

## 3. El riesgo de Apple — acotado en parte, NO cerrado

El implementer declaró: «no conozco ninguna regla del validador de Apple que rechace un
`UISupportedExternalAccessoryProtocols` vacío, pero eso es "no conozco", no "verifiqué"». Correcto en
mantenerlo separado.

**Lo que sí pude acotar, localmente**: la regla conocida que exige protocolos **no vacíos** está atada al
background mode `external-accessory`. `app/app.config.ts:53` declara
`UIBackgroundModes: ['remote-notification']` y **nada más** — no hay `external-accessory`. Así que el
disparador conocido más estricto no aplica a este binario.

**Lo que NO puedo hacer desde acá**: no tengo acceso web ni a la documentación de Apple, así que no puedo
confirmar la ausencia de otra regla. **Queda como riesgo abierto**, con el remedio que el implementer ya
dejó escrito (sacar la clave y mantener iOS fuera del camino de RNBC, no inventar un protocolo). El
veredicto real llega con la próxima entrega y cuesta un build de EAS.

---

## 4. Falsificación — 21 mutantes PROPIOS sobre los archivos REALES

Harness byte-exacto (lee/escribe `Buffer`, restaura desde el original, verifica md5). Tras la corrida
completa: `git status` idéntico al inicio, diffstat idéntico (199+/18-), y `git diff` vs `git diff -w` da
el mismo numstat en los 4 archivos → **sin churn de CRLF**.

### C — el gate del chip (`dev-crash-gate.ts` / `RootErrorBoundary.tsx`), suite de 10 tests

| # | Mutante | Resultado | Tests que lo cazan |
|---|---|---|---|
| **G1** | **el gate ANTERIOR (v1): `getAppEnv() === 'development'` a secas** | **ROJO — pass 6 / fail 4** | las 4 combinaciones · release sin var · `__DEV__` ausente · dominio completo |
| **G0** | el gate del **build 5**: `development` OR `preview` | ROJO — 5/10 | los 4 de arriba **+** «preview NO habilita el chip» |
| G2 | OR en vez de AND | ROJO — 6/10 | + production/e2e |
| G3 | solo `__DEV__` (se cae el ambiente) | ROJO — 4/10 | preview · production/e2e · matriz · dominio |
| G4 | `typeof !== 'undefined'` sin `=== true` | ROJO — 3/10 | matriz · release sin var · dominio |
| **G5 (mío)** | re-agregan `preview` manteniendo el AND | ROJO — 3/10 | matriz · «preview NO habilita» · dominio |
| **G6 (mío)** | `Boolean(__DEV__)` en vez de `=== true` | **VERDE** | ninguno — ver §9 |
| G7 | el `.tsx` re-implementa media llave (`__DEV__ && isDevCrashEnabled()`) | ROJO — 1/10 | guard estático |
| **G8 (mío)** | el `.tsx` vuelve a decidir inline con `getAppEnv()` | ROJO — 2/10 | guard estático **+** barrido de UI sobre la ausencia |

**G1 confirma la afirmación del implementer al número exacto: 4/10 en rojo con el gate anterior.** El test
mide el cambio, no el parecido. G0 confirma además que el gate original del defecto tampoco pasa.

La matriz `__DEV__` × ambiente está cubierta **con las 4 celdas explícitas**
(`dev-crash-gate.test.ts:73-78`), y G3 prueba que las filas de `preview`/`production`/`e2e` se ejercen de
verdad: se corren con `__DEV__ = true` a propósito, así que un rojo acusa a la llave del ambiente y no
queda tapado por la otra. Ese era el modo de falla obvio de esta suite ("pasar por la razón equivocada") y
está cerrado.

### B — el guard de perfiles (`eas.json`), suite de 12 tests

| # | Mutante sobre el `eas.json` REAL | Resultado | Mensaje |
|---|---|---|---|
| **P1** | sacar `EXPO_PUBLIC_ENV` de **un** perfil (`preview-dev`) | ROJO — 8/12 | `perfil "preview-dev": no declara EXPO_PUBLIC_ENV → ese build se creería en development…` |
| **P2** | valor fuera de dominio (`production` → `"staging"`) | ROJO — 7/12 | `perfil "production": EXPO_PUBLIC_ENV = "staging", fuera del dominio admitido {development, preview, production}` |
| **P3** | **perfil NUEVO (`testflight-prod`) sin la variable** | **ROJO — 6/12** | `perfil "testflight-prod": no declara EXPO_PUBLIC_ENV…` |
| **P4 (mío)** | **perfil NUEVO sin bloque `env` en absoluto** | ROJO — 7/12 | `perfil "adhoc": no declara EXPO_PUBLIC_ENV…` |
| **P5 (mío)** | perfil nuevo declarando `e2e` (en el archivo real, no en memoria) | ROJO — 6/12 | `perfil "smoke": EXPO_PUBLIC_ENV = "e2e", fuera del dominio admitido` |
| **P6 (mío)** | perfil nuevo que **hereda** por `extends: preview` | el test principal **VERDE** (ver abajo) | sin rojo falso |
| **P7 (mío)** | dedazo: `testflight-dev` declara `"production"` (valor **válido**, perfil equivocado) | ROJO — 1/12 | `el perfil "testflight-dev" cambió de ambiente: + 'production' - 'preview'` |

**P3 y P4 son las que el pedido marcaba como más fáciles de escribir mal, y las dos funcionan sobre el
archivo real** — no solo contra el mutante en memoria que el propio guard construye. El oráculo enumera
con `Object.keys(profiles)` (`eas-profiles-guard.test.ts:109`), así que la enumeración sale del archivo:
un perfil futuro nace en rojo, tenga `env` incompleto o no tenga `env`.

**Sobre P6** (el único "inesperado" de la corrida): el test principal —«TODO perfil de build de eas.json
declara EXPO_PUBLIC_ENV»— quedó **verde**, que es la respuesta correcta: heredar por `extends` no produce
un rojo falso. El único rojo fue el test *interno* «MUTANTE: valor fuera de dominio ("staging")», que
asserta `violations.length === 1` y contó 2 porque mi perfil heredaba de un `preview` que ese mismo test
muta. Es el acoplamiento que el implementer ya declaró («los mutantes que parten de `realWith` solo pasan
si la base está limpia»): ruido dentro de un árbol ya mutado, no un defecto del guard. **No bloquea.**

### A-v2 — la clave MFi (`app.config.ts`), suite de 26 tests

| # | Mutante | Resultado |
|---|---|---|
| A1 | borrar la clave entera | ROJO — «NO está declarada… el `as! [String]` … TRAPEA al instanciarse» |
| A2 | string suelto (`'com.fabricante.rs420'`) | ROJO — «el cast del módulo es a [String], tiene que ser un ARRAY» |
| A3 | `['']` | ROJO — «tiene entradas que no son protocol strings» |
| A4 | declarada **solo** en la variante no-dev | ROJO — `variant=development` (el build que se instala en el teléfono) |
| **A5 (mío)** | `null` | ROJO |
| **A6 (mío)** | **clave mal escrita** (`UISupportedExternalAccesoryProtocols`, una `s` de menos) | ROJO — un typo no pasa por presencia |
| **A7 (mío)** | sacar `react-native-bluetooth-classic` de `package.json` dejándolo instalado (¿se apaga el guard barato?) | ROJO — el **CENSO** lo caza; y `EA_MODULE_PRESENT` sigue en true por el `existsSync` de `node_modules` → el guard MFi **no** se apaga |

Control positivo: el estado real (`[]`) queda **verde**. El oráculo no confunde «vacía» con «ausente»,
que es exactamente lo que había que lograr.

---

## 5. ¿El chip sigue vivo en el dev client de EAS? — evidencia evaluada y **corroborada**

Es la pregunta que decide si esto es un arreglo o una regresión disfrazada. La evidencia del implementer
son dos tramos; verifiqué **los dos** por mi cuenta, en el árbol instalado.

**Tramo 1 — el dev client pide `dev=true`.** Confirmado:

- iOS lo **hardcodea**: `node_modules/expo-dev-launcher/ios/EXDevLauncherController.m:427` →
  `index.bundle?platform=%@&dev=true&minify=false`.
- Android lo arma con `dev=%s` (`DevServerHelper.kt:292`) donde el argumento es
  `settings.isJSDevModeEnabled` (`:139`), y el **default es `true`**
  (`DevInternalSettings.kt:49`: `preferences.getBoolean(PREFS_JS_DEV_MODE_DEBUG_KEY, true)`).

**Tramo 2 — con `dev=true` el bundle trae `__DEV__=true`.** No levanté Metro entero (el implementer sí);
fui a la función que **produce** el prelude, `metro/src/lib/getPreludeCode.js:16`, y la ejecuté:

```
  isDev=true  -> prelude: __DEV__=true
  isDev=false -> prelude: __DEV__=false
```

**Tramo 3 — el perfil.** `eas.json` → `development` tiene `developmentClient: true` y ahora declara
`EXPO_PUBLIC_ENV: "development"`. Las dos llaves en true → el chip sigue.

**Conclusión: la afirmación se sostiene y la evidencia la sostiene.** No es una regresión: el chip
sobrevive en el único lugar donde sirve. Hay un test con ese nombre exacto clavándolo
(`dev-crash-gate.test.ts:101`), así que si alguien lo rompe, se entera acá y no en el teléfono.

La excepción que el implementer declaró (apagar "JS Dev Mode" en el menú de RN → `dev=false` → sin chip)
es real y es una acción explícita de quien desarrolla. Aceptada.

Nota lateral, para que nadie se sorprenda: el device de QA de Raf se buildea con `preview-dev`
(spec 22 design:213), que ahora es ambiente `preview` → **ahí el chip desaparece**. Es el efecto buscado,
no un daño colateral.

---

## 6. Trazabilidad `R<n>` ↔ test

No hay `specs/active/<name>/` propio: son tres fixes de defecto sobre features existentes
(17 `in_progress`, 16 `blocked`). La trazabilidad se arma contra los `R` afectados y contra los ítems del
pedido.

| Requisito / ítem | Test concreto | Estado |
|---|---|---|
| **spec 17 R2.6** (reescrito): chip solo con `__DEV__` **y** ambiente `development`; en cualquier otro caso no se monta | `app/src/utils/dev-crash-gate.test.ts` :: «LAS 4 COMBINACIONES…» (matriz explícita) + «el dominio COMPLETO está cubierto» (derivado de `APP_ENVS`) | OK — falsificado G1/G0/G2/G3/G5 |
| … el chip NO en `preview` | idem :: «preview NO habilita el chip…» (con `__DEV__=true` para que la llave bajo prueba sea el ambiente) | OK — G5 |
| … ni en `production`/`e2e` | idem :: «production y e2e tampoco habilitan el chip» | OK — G2 |
| … ni en un release fuera de EAS | idem :: «bundle RELEASE sin EXPO_PUBLIC_ENV → NO hay chip» | OK — G1 |
| … y **sí** en el dev client de EAS | idem :: «el dev client de EAS (perfil `development`) SIGUE mostrando el chip» | OK — §5 |
| … la decisión no vuelve a un `.tsx` | idem :: «RootErrorBoundary.tsx delega…» + «ninguna pantalla ni componente decide por ambiente inline» | OK — G7, G8 |
| **spec 16 R3.4** (nota de alcance): el default gobierna solo dev server / builds nativos locales | `dev-crash-gate.test.ts` :: «sin EXPO_PUBLIC_ENV pero en bundle de DEV → habilitado» + `eas-profiles-guard.test.ts` :: «TODO perfil… declara EXPO_PUBLIC_ENV» (o sea: ningún build de EAS cae al default) | OK — P1/P3/P4 |
| **spec 16 R4.1/R4.2** (backend por perfil, preexistentes) | `eas-profiles-guard.test.ts` :: «el mapeo vigente perfil → ambiente está pineado» (no cruza backend a propósito, declarado en el header §4) | OK — P7 |
| **spec 16 R4.3/R4.4**: marcados **NO implementados** | N/A por diseño — no hay test de algo que no existe; el guard es la mitigación declarada | OK (§7) |
| Cada perfil declara su ambiente; uno nuevo nace en rojo | `eas-profiles-guard.test.ts` :: test 1 + «MUTANTE: un perfil NUEVO sin la variable nace en rojo» | OK — P1, **P3**, **P4** |
| Valor fuera de dominio → rojo nombrando perfil y valor | idem :: «MUTANTE: valor fuera de dominio ("staging")» | OK — P2 |
| `e2e` prohibido en un binario | idem :: «`e2e` NO es un ambiente válido para un perfil de build» | OK — **P5** (en el archivo real) |
| El valor declarado es el que la app lee de verdad | idem :: «cada valor declarado en eas.json es reconocido por getAppEnv()» (ejecuta el consumidor real) | OK |
| **A-v2**: la clave MFi declarada, vacía vale, ausencia cazada | `app/ios-purpose-strings-guard.test.ts` :: «GUARD: `UISupportedExternalAccessoryProtocols` está DECLARADA…» (4 variantes) | OK — A1–A6 |
| … el motivo escrito sigue siendo cierto | idem :: «AUTO-VERIFICACIÓN: el force-cast … SIGUE en el fuente instalado» | OK — verificado a mano en `RNBluetoothClassic.swift:68-69` |
| … el oráculo no es un patrón muerto | idem :: «FALSIFICACIÓN: el oráculo … ACEPTA el array vacío y caza la ausencia» (incluye que el regex vea la forma real y NO la arreglada `as? … ?? []`) | OK |
| … el guard no se apaga barato | `EA_MODULE_PRESENT` = `package.json` **OR** `node_modules` + el CENSO | OK — **A7** |
| Los tres guards **corren** | `scripts/run-tests.mjs`: lista explícita de **169** archivos, sin duplicados, sin inexistentes, con los tres adentro (verificado programáticamente) | OK |

**Tasks completas**: N/A para estos tres cambios (no tienen `tasks.md` propio). Feature 17 sigue
`in_progress` con **6 tasks `[ ]`** preexistentes y justificadas: T11/T21/T29 son `[GATED-FASE0]` y
T23/T24/T25 son runbook/ops. **Ninguna de las seis es de este cambio** y ninguna se cierra acá — este
review **no** cierra la feature 17.

---

## 7. Exactitud de specs (código → spec) — reconciliadas, sin mentiras

Recorrí las cuatro reconciliaciones contra el as-built:

- **`specs/active/17-observabilidad/requirements.md` R2.6** — reescrito el EARS entero:
  «Donde el bundle corra en modo desarrollo (`__DEV__`) **y** el ambiente resuelto sea `development` … En
  cualquier otro caso **no deberá montarse**.» Coincide **literal** con `dev-crash-gate.ts:75`
  (`isDevBundle() && getAppEnv() === 'development'`). La nota explica los dos motivos y aclara que
  `assembleDebug` **sí** lo sigue mostrando — que es lo que verifiqué en §5. **Correcto.**
- **`specs/active/16-ambientes-y-release/requirements.md` R3.4** — nota de alcance añadida sin tocar el
  EARS (el default sigue siendo `development`, cierto). Dice que ya no gobierna a ningún build de EAS: es
  verdad, los 5 perfiles la declaran (`grep -c` → 5). **Correcto.**
- **R4.3/R4.4** — marcados **NO implementados** con la constatación (`grep -c channel` → 0; variables
  inline). Verificado: 0 `channel` en `eas.json`, las `EXPO_PUBLIC_*` repetidas cinco veces. Esto es
  exactamente la dirección inversa que pide el protocolo: la spec dejó de afirmar algo que no existe.
  **Correcto**, y bien que se haya escrito en vez de taparse.
- **`specs/active/16-ambientes-y-release/design.md`** — el bloque de `infoPlist` documenta las **tres**
  claves. Verifiqué sus afirmaciones una por una contra el fuente: el force-cast en
  `RNBluetoothClassic.swift:68` (sí), el disparador en `adapter-spp-android.ts:190` (sí, lee
  `NativeModules.RNBluetoothClassic`), el corte por `Platform.OS` (sí, `:204-212`), `adapter-selection`
  devolviendo `manual` en iOS (sí). Nombra el guard. **Correcto.**
- **La frase exagerada** («la app se cierra apenas el tester abre la pantalla del bastón») que la review
  anterior pidió bajar de tono: grep sobre `app/`, `specs/`, `docs/` → **cero copias sobrevivientes**. Las
  cuatro (código, guard, `app.config.test.ts` y la de `design.md:217` que el implementer no podía tocar)
  quedaron reconciliadas. **Cerrado.**

No hay specs contradiciendo el as-built.

Queda **una omisión** (no contradicción), la misma que la review anterior marcó como opcional:
`specs/active/04-bluetooth-baston/requirements.md` R12 enumera permisos por transporte y no menciona ni el
purpose string de iOS ni el pendiente MFi. Sigue sin bloquear.

---

## 8. Lista dura — INTACTA

Verificado sobre el diff, no de palabra:

- [x] `APP_ID = 'ar.rafq.app'` (`app.config.ts:26`), `bundleIdentifier` (`:50`) y `package` (`:100`) derivados — **ninguna de esas líneas aparece en el diff**.
- [x] `scheme: 'rafq'` (`:43`) — sin tocar.
- [x] `slug: 'rafaq-app'` (`:42`), `owner: 'rafaqsorg'` (`:163`), `projectId: d8cf3a19-…` (`:160`) — sin tocar.
- [x] `eas.json`: el diff es **5 inserciones / 0 borrados**, y las 5 son `"EXPO_PUBLIC_ENV"`. Conteos intactos: `EXPO_PUBLIC_SUPABASE_URL` ×5, `EXPO_PUBLIC_SUPABASE_ANON_KEY` ×5, `EXPO_PUBLIC_POWERSYNC_URL` ×5, `EXPO_PUBLIC_GOOGLE_*` ×10.
- [x] `noreply@rafq.ar`, prefijos `rafq.*`, `X-Rafaq-Actor`, GUCs (`set_config`/`current_setting`) — **ninguno aparece en el diff completo**.
- [x] Assets sin tocar. Ningún build de EAS lanzado. Ningún `pnpm install`. **E2E no se corrió** (y por eso no hay churn de `design/**/*.png`).
- [x] Sin churn de CRLF: `git diff --numstat` == `git diff -w --numstat` en los 4 archivos modificados.

**ATENCIÓN para quien commitee** (persiste desde la review anterior): el working tree arrastra cosas
**ajenas** — `specs/active/10-operaciones-rodeo/requirements.md` (modificado desde antes),
`docs/marketing/kit-capturas.zip` y el resto de `docs/marketing/` untracked. Un `git add -A` se los lleva
puestos. **Stagear selectivo.**

---

## 9. Observaciones que NO bloquean

1. **`app/src/utils/dev-crash-gate.ts:60` — `__DEV__` truthy no booleano no tiene test (mutante G6).**
   El header y la autorrevisión afirman que `=== true` es fail-closed frente a un `__DEV__ = 1`. La
   afirmación es **cierta** (`1 === true` es `false`), pero **ningún test la ejerce**: cambiar
   `__DEV__ === true` por `Boolean(__DEV__)` deja la suite en **10/10 verde**. Es el único mutante que
   sobrevivió. Peso real: bajísimo — Metro escribe el literal booleano en el prelude
   (`getPreludeCode.js:16`), así que no hay camino realista al `1`. Si se quiere cerrar, es una fila más
   en la matriz.

2. **`testflight-dev` declara ambiente `preview` apuntando al backend DEV.** Está declarado a propósito
   en el header del guard (§4: «`EXPO_PUBLIC_ENV` describe la MADUREZ del release, no la base de datos») y
   no contradice R4.1/R4.2, que solo nombran `development`, `preview` y `production`. Consecuencia futura,
   para que esté dicha: cuando se prenda Sentry, los eventos de `testflight-dev` (datos DEV) y los de
   `preview` (datos PROD) van a caer bajo el **mismo** `environment: preview` y no se van a poder
   distinguir. Si eso molesta, el lugar es un tag aparte, no `EXPO_PUBLIC_ENV`.

3. **Riesgo Apple abierto** (§3): acotado por la ausencia del background mode `external-accessory`, **no**
   verificado contra el validador. Se sabrá en la próxima entrega.

4. **Estructural preexistente**, ya señalado en la review anterior y sigue vigente: nada obliga a que un
   `*.test.ts` esté en la lista explícita de `scripts/run-tests.mjs`. Borrar una entrada desactiva un
   guard en silencio. Propiedad de todo el repo, no de este cambio.

---

## 10. Verificación independiente (salida literal)

`node scripts/check.mjs` — **exit code 0**:

```
>>> typecheck client                                   <<< OK
>>> scripts unit tests (spec 16 Run B)                 <<< OK
>>> client unit tests        ℹ tests 3111  ℹ pass 3111  ℹ fail 0
>>> RLS suite                                          <<< OK
>>> Edge Functions suite                               <<< OK
>>> Animal suite (spec 02)                             <<< OK
>>> Maneuvers suite (spec 03)                          <<< OK
>>> Puesta-en-servicio suite (spec 02 Stream A)        <<< OK
>>> Reports suite (spec 07 Stream C)                   <<< OK
>>> Custom suite (spec 03 M5)                          <<< OK
>>> Scrotal/CE suite (spec 03 M6)                      <<< OK
>>> User_private suite (spec 14 + delta TELÉFONO)      <<< OK
>>> Import suite (spec 12)                             <<< OK
>>> Sync streams no-bypass suite (spec 15)             <<< OK
>>> Operaciones-rodeo suite (spec 10 Fase 1)           <<< OK
>>> SIGSA suite (spec 08 capa DB)                      <<< OK
>>> Treatments suite (spec 02 delta tratamientos)      <<< OK
>>> Audit suite (spec 18)                              <<< OK
>>> Health EF suite (spec 16 Run C)                    <<< OK
All tests passed.
[OK]    Tests verdes

-- 4. Resumen ----------------------------------------
[OK]    Entorno listo. Podés trabajar.
CHECK_RC=0
```

(Esta vez había keys de Supabase, así que **las 15 suites de base corrieron de verdad**, no se saltearon.)

`pnpm typecheck` (en `app/`):

```
> rafaq-app@0.1.0 typecheck C:\DEV\RAFAQ\app-ganado\app
> tsc --noEmit

TYPECHECK_RC=0
```

`node scripts/check-hardcode.mjs`:

```
[OK]    Anti-hardcode (ADR-023 §4): 0 violaciones en app/app + app/src/components
RC=0
```

Los cuatro archivos del cambio, aislados: **48 tests, 48 pass, 0 fail**
(11 `app.config.test.ts` + 15 guard de purpose strings + 12 guard de perfiles + 10 gate del chip).

**E2E: NO se corrió**, como se pidió. `check.mjs` verde **no** incluye Playwright.

---

## 11. CHECKPOINTS

| # | Checkpoint | Estado |
|---|---|---|
| C1 | Harness completo · `check.mjs` exit 0 | [x] |
| C2 | Estado coherente — una sola feature `in_progress` (17); ninguna se marca `done` acá | [x] |
| C3 | Arquitectura: `dev-crash-gate.ts` es un helper puro en `utils/` (misma capa que `app-env.ts`); el `.tsx` importa de `utils` (permitido). Sin deps nuevas, sin logs de debug, sin TODOs sueltos, sin `establishment_id` hardcodeado | [x] |
| C4 | Verificación real: los 3 módulos con lógica tienen test; fixtures reales (`eas.json` real, `node_modules` real, `app.config.ts` real — cero mocks de I/O); runner con 3111 tests verdes | [x] |
| C5 | Sin artefactos temporales atribuibles a este cambio (los ajenos, señalados en §8) | [x] |
| C6 | SDD — **N/A**: son fixes de defecto sobre features existentes, no hay `specs/active/<name>/` propio ni `tasks.md`. Las specs afectadas **sí** quedaron reconciliadas (§7) | N/A |
| C7 | Multi-tenant — **N/A**: no toca SQL, tablas, RLS ni `establishment_id` | N/A |
| C8 | Offline-first — **N/A**: no toca repositorios, PowerSync ni sync buckets | N/A |
| C9 | E2E + visual (ADR-029) — **N/A**: no hay UI nueva. El único cambio visible es que un chip **deja** de montarse en preview/producción; ninguna spec E2E lo referencia (corren en env `e2e`, donde ya estaba apagado). Un plist de iOS no lo puede ver una E2E web | N/A |

---

## 12. Checklist RAFAQ-específico

**A — tablas con `establishment_id` / RLS**: **N/A**. Cero SQL, cero migraciones, cero policies.

**B — carga/edición de datos en campo (offline-first)**: **N/A**. No toca repositorios, PowerSync ni sync
buckets. (Nota: `EXPO_PUBLIC_POWERSYNC_URL` por perfil quedó **sin cambios** — verificado, 5 ocurrencias
idénticas.)

**C — BLE (Vesta, Allflex)**: **aplicable parcialmente** — toca la *configuración* del bastón en iOS, no
su comportamiento.

- [x] Desconexión repentina + timeout — **sin cambios**: `app/src/services/ble/**` no se modificó (los guards solo lo **leen**).
- [x] Modo manual de fallback en ≤1 tap — **sin cambios**, y en iOS sigue siendo el único camino (`adapter-selection.ts` devuelve `'manual'`, verificado).
- [x] Correlación TAG↔peso por ventana temporal — **sin cambios**.
- [x] Logs BLE no bloquean el flujo del operario — **sin cambios**.
- [x] Específico de esto: la clave nueva **no habilita** ningún accesorio (array vacío) y no agrega dependencias al camino de runtime — `app.config.ts` sigue siendo puro de Expo en build time.

**D — UI de campo (manga, wizard)**: **aplicable en un solo punto** — el chip de crash es el único
elemento de UI afectado, y el cambio es que **se deja de montar** en preview/producción.

- [x] Botones ≥60dp — **N/A / sin regresión**: no se agrega UI, se **quita** un overlay absoluto de la esquina superior izquierda en los builds repartidos.
- [x] Fuente ≥18pt — idem, no hay texto nuevo en la app (el único texto nuevo lo renderiza **iOS** en su diálogo de permiso, fuera de nuestro control tipográfico).
- [x] Una decisión por pantalla — sin cambios.
- [x] Estado de loading visible — sin cambios.
- [x] Beneficio de campo, explícito: el operario/tester ya no tiene un botón que **cierra la app** al alcance del pulgar en la pantalla principal.

**E — Edge Functions**: **N/A**. No toca `supabase/functions/**`. (La Health EF suite corrió igual y quedó
verde.)

---

## 13. Cambios requeridos

**Ninguno bloqueante.** Para el backlog o el próximo toque, sin retener la aprobación:

1. `app/src/utils/dev-crash-gate.test.ts` — sumar la fila `__DEV__` truthy-no-booleano a la matriz; hoy es
   el único mutante que sobrevive (§9.1). Una línea.
2. `specs/active/04-bluetooth-baston/requirements.md` R12 — la línea que ya pedía la review anterior
   (purpose string de iOS + el pendiente MFi). Sigue siendo opcional.
3. Antes de la próxima entrega a App Store Connect: mirar si el validador dice algo del
   `UISupportedExternalAccessoryProtocols` vacío (§3). Si objeta, el remedio ya está escrito y **no** es
   inventar un protocol string.
4. Al commitear: **stagear selectivo** (§8).
