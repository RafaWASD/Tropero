# Review — ITMS-90683 / purpose strings de iOS

**Fecha**: 2026-08-11 · **Revisor**: reviewer · **Base**: `895f7fc` + working tree sin commitear
**Reporte del implementer**: `progress/ios-purpose-strings.md`

## Veredicto

**APPROVED**

El fix hace lo que tenía que hacer, el texto sirve de cara a Apple, y el guard **no es decorativo**: lo
falsifiqué con 8 mutantes propios (incluidos los tres que el pedido marcó como críticos) y los 8 dieron
rojo con el mensaje correcto. El árbol quedó restaurado byte a byte (md5 verificado) y **no se corrió
`pnpm install`** en ningún momento.

Hay tres observaciones que NO bloquean pero que quiero dejar escritas — la más importante es que el
diagnóstico adyacente del MFi es **correcto y peor de lo que dice el reporte** (sección 6).

---

## 1. Trazabilidad — no es una feature SDD

No hay `specs/active/<name>/` para esto (defecto reportado por Apple, no feature). La trazabilidad se
arma contra los tres ítems del pedido y contra el R de spec 16 que cubre `app.config.ts`.

| Ítem pedido / requisito | Test concreto que lo verifica | Estado |
|---|---|---|
| Las dos claves existen en `ios.infoPlist` | `app/app.config.test.ts` — «ITMS-90683: las dos purpose strings de Bluetooth están declaradas y NO vacías, en TODA variante» (recorre undefined / development / preview / production) | OK |
| … y **no están vacías** | mismo test: `assert.ok(value.trim().length > 0)`. Falsificado (M1: string vacío, rojo; M2: clave borrada, rojo) | OK |
| … y el texto **sirve** (no genérico) | `app/ios-purpose-strings-guard.test.ts` — `purposeStringProblem()` (>=30 chars + cláusula «… para …»), ejercida por «FALSIFICACIÓN: la regla del TEXTO caza la clave vacía, la ausente y el genérico». Falsificado (M3) | OK |
| Guard sobre la **ausencia**: módulo instalado que toca recurso protegido sin su purpose string | «GUARD: todo módulo instalado que toca un recurso protegido de iOS tiene VEREDICTO escrito» + «GUARD: las purpose strings EXIGIDAS están declaradas…». Falsificado (M5, M7a) | OK |
| Guard sobre la ausencia: **módulo nuevo en `package.json` que no figura en la lista** | «GUARD por NOMBRE» (no depende de `node_modules`) + el assert `noInstaladas` del CENSO + «CENSO: las dependencias DIRECTAS con código nativo Apple son exactamente estas». Falsificado (M4a enumerado, M4b **no** enumerado, M6 recurso no enumerado) | OK |
| Exclusiones sostenidas por algo ejecutable | «GUARD: las EXCLUSIONES se sostienen» (`stillHolds()` se ejecuta). Falsificado (M8) | OK |
| Guard registrado en el runner | `scripts/run-tests.mjs` — `app/ios-purpose-strings-guard.test.ts` agregado a la lista explícita (verificado en el diff, y corre: 12 tests del archivo en la corrida real) | OK |
| spec 16 R2.1 (`app.config.ts` preserva la config de Expo) | `app/app.config.test.ts` completo (R2.1–R2.5 intactos, 0 regresiones) | OK |

**Tasks completas**: N/A — no hay `tasks.md` (no es feature SDD). No quedó nada del pedido sin hacer.

---

## 2. Falsificación del guard (mutantes PROPIOS, no los del reporte)

Cada mutante se aplicó al árbol real con un helper byte-preciso (lee/escribe Buffer, no toca line
endings), se corrió la suite y se restauró desde una copia previa. md5 verificado antes y después.

| # | Mutante | Resultado | Quién lo cazó |
|---|---|---|---|
| M1 | `NSBluetoothAlwaysUsageDescription` con string vacío | ROJO (2 tests) | `app.config.test.ts` + «purpose strings EXIGIDAS» |
| M2 | clave `NSBluetoothAlwaysUsageDescription` borrada entera | ROJO (2 tests) | idem |
| M3 | texto genérico **largo** («La aplicación necesita acceso al Bluetooth del dispositivo.», 59 chars, sin «para») | ROJO (2 tests) | **solo el guard** — `app.config.test.ts` lo deja pasar (solo mira no-vacío). Es exactamente el peor de los dos mundos que el pedido quería cerrar, y está cerrado |
| M4a | `expo-location` en `app/package.json`, **sin instalar** (módulo enumerado en `MODULES_BY_NAME`) | ROJO (3 tests) | «GUARD por NOMBRE» + «purpose strings EXIGIDAS» + CENSO |
| M4b | `@react-native-camera-roll/camera-roll` en `package.json`, **sin instalar** y **NO enumerado** en `MODULES_BY_NAME` | ROJO (1 test) | CENSO / `noInstaladas`: «Hay dependencias en package.json que no están en node_modules … el guard no certifica nada». **Se planta en vez de pasar en verde sobre algo que no miró** — que es la respuesta correcta |
| M5 | el mismo camera-roll **instalado** (fake con `.podspec` + `ios/CameraRoll.swift` con `PHPhotoLibrary`) + en `package.json` | ROJO (2 tests) | «módulo … SIN veredicto», con archivo y recurso (`→ photos (NSPhotoLibraryUsageDescription) en ios/CameraRoll.swift`) + CENSO |
| M6 | dep **directa** instalada que toca un recurso **NO enumerado** (`NISession` / NearbyInteraction) | ROJO (1 test) | CENSO (cambió el conjunto de directas nativas) — la mitigación declarada del hueco 1, y funciona |
| M7a | paquete **transitivo** (no en `package.json`) con `CBCentralManager` | ROJO (1 test) | «módulo … SIN veredicto» → las transitivas SÍ entran al escaneo |
| M7b | transitivo con `NISession` (no enumerado) **+** `HKHealthStore` (enumerado), mismo archivo | ROJO (1 test), **por el `HKHealthStore`** | confirma el hueco 1: el `NISession` solo no lo habría cazado nadie |
| M8 | `allowsRecording: true` en `feedback-logic.ts` | ROJO (1 test) | «las EXCLUSIONES se sostienen»: «expo-audio → microphone: la exclusión YA NO VALE … Ahora hace falta NSMicrophoneUsageDescription» |

Restauración verificada:

```
f6479d2a12681c680a779920bda28df0 *app/app.config.ts        (idéntico al baseline)
a66275aeab5f408a3cb625852ae18a95 *app/package.json         (idéntico al baseline y al md5 del reporte)
f56694f56520a2aeb826dc9dc9a7963c *app/src/services/ble/feedback-logic.ts
```

`git status` sin cambios espurios; el conteo de restos en `node_modules` (camera-roll / nearby /
some-transitive) dio **0**.

**Conclusión sobre el guard**: es real. La regla más difícil (cazar lo que NO está enumerado) está
resuelta con **dos capas independientes** — `MODULES_BY_NAME` para los que sí conoce, y el par
`noInstaladas` + `CENSUS` para los que no. La segunda es la que importa: cualquier dependencia directa
nueva rompe el censo, esté enumerada o no, esté instalada o no.

**Lo que queda descubierto, y está DECLARADO (no fingido)** — header del archivo, huecos 1 a 5: un
paquete **transitivo** que toque un recurso protegido que `IOS_PROTECTED_RESOURCES` todavía no enumera es
invisible (verificado empíricamente con M7b). El archivo lo dice en las líneas 19-22 y no pretende
cobertura que no tiene. Aceptado.

---

## 3. El texto, con ojo de revisor de Apple

> «miTropero se conecta por Bluetooth con el bastón lector para leer las caravanas electrónicas de los
> animales.»

Nombra el **mecanismo** (Bluetooth), el **con qué** (el bastón lector) y el **para qué concreto** (leer
las caravanas electrónicas). No es un «esta app usa Bluetooth». Español rioplatense, y el idioma coincide
con el de la UI de la app, que es lo que Apple espera. **Pasa.**

Una sola constante (`BLUETOOTH_PURPOSE`, `app.config.ts:32`) para las dos claves: correcto — que puedan
divergir es la forma en que una de las dos queda genérica sin que nadie lo note.

Riesgo menor del oráculo, no del texto: `purposeStringProblem()` (guard, línea 554) exige la subcadena
literal « para ». Un purpose legítimo escrito sin ese conectivo («…, así el operario lee las caravanas»)
saldría marcado como genérico. Falso positivo barato y autoexplicado por el mensaje. No lo pido cambiar.

---

## 4. Exclusiones — ¿escritas y enlazadas, o hueco silencioso?

Las 7 están **enlazadas y ejecutables** (`stillHolds()` corre de verdad, M8 lo prueba). La del micrófono,
que es la que el pedido señala:

- `MODULE_VERDICTS[expo-audio].microphone.stillHolds()` (guard, líneas 415-429) chequea tres cosas:
  que `FEEDBACK_AUDIO_MODE.allowsRecording` siga en `false`, que no se haya enganchado el config plugin
  de `expo-audio`, y que no aparezca la API de grabación en `app/` + `src/` + `plugins/`.
- El valor está anclado en `app/src/services/ble/feedback-logic.ts:156` (`allowsRecording: false`) y lo
  sostiene además `app/src/services/ble/feedback-guard.test.ts:336` («el aviso NO graba: eso arrastraría
  el micrófono») y el test «expo-audio NO se engancha como config plugin» de `app.config.test.ts`.

No es un hueco silencioso.

**Matiz (no defecto)**: la exclusión `expo-file-system → photos` (líneas 440-450) mira solo los dueños de
`MODULES_BY_NAME` para decidir si entró un módulo de fototeca. En M5 instalé un módulo de fototeca real
que **no** está en esa lista y esa exclusión NO se rompió — pero el mismo mutante quedó en rojo por otros
dos tests, así que no hay pase silencioso.

---

## 5. Lista dura — intacta

Verificado sobre el diff (`git diff app/app.config.ts` es +1 constante, +2 claves, +comentarios; nada más):

- [x] `APP_ID` (línea 26) sigue siendo `ar.rafq.app`; `bundleIdentifier` y `package` derivan de él igual que antes.
- [x] `scheme` (línea 43) sigue siendo `rafq`.
- [x] `slug` (`rafaq-app`), `owner` (`rafaqsorg`) y `extra.eas.projectId` sin tocar.
- [x] `eas.json` no aparece en `git status`.
- [x] assets sin tocar.
- [x] `docs/**` sin tocar por este cambio.
- [x] `specs/**`: el implementer no las tocó (lo declara y el reporte coincide). Ver sección 7.
- [x] Ningún build de EAS lanzado. Ningún `pnpm install` corrido (ni por el implementer ni por mí).

ATENCIÓN para quien commitee: el working tree arrastra dos cosas **ajenas** a este fix —
`specs/active/10-operaciones-rodeo/requirements.md` (modificado desde antes de esta sesión) y
`docs/marketing/kit-capturas.zip` (untracked). Un `git add -A` se los lleva puestos. Stagear selectivo.

---

## 6. Hallazgo adyacente MFi — el diagnóstico es CORRECTO, y **peor** de lo que dice el reporte

Verificado en el fuente instalado, no de memoria:
`app/node_modules/react-native-bluetooth-classic/ios/RNBluetoothClassic.swift`

```swift
override init() {                                          // línea 65
    self.eaManager = EAAccessoryManager.shared()           // línea 66
    self.notificationCenter = NotificationCenter.default
    self.supportedProtocols = Bundle.main
        .object(forInfoDictionaryKey: "UISupportedExternalAccessoryProtocols") as! [String]   // 68-69
```

`object(forInfoDictionaryKey:)` devuelve un opcional. **Sin la clave devuelve nil, y el force-cast a
`[String]` trapea.** O sea: no es «el bastón MFi no aparecería en la lista» — es que **el módulo nativo
revienta al instanciarse**, dentro de su `init()`, antes de llegar a `EAAccessoryManager` o a
CoreBluetooth. El reporte subestima la severidad.

**Por qué hoy no explota igual**: en iOS la app **nunca instancia ese módulo**.

- `app/src/services/ble/adapter-selection.ts:56-59` — todo lo que no sea web ni android devuelve el kind
  `manual`.
- `app/src/services/ble/adapter-spp-android.ts:204-211` (`isSppNativeAvailable`) devuelve `false` por
  `Platform.OS !== android` **antes** de tocar `NativeModules.RNBluetoothClassic`.
- Grep: `NativeModules` aparece solo en `adapter-spp-android.ts:184` y `:190`, y `loadRNBC` solo es
  alcanzable vía `isSppNativeAvailable()` o vía el adapter que se construye **después** de ese chequeo
  (`BleStickListenerProvider.tsx:120`).

**Respuesta a la pregunta del pedido**: sí — **el bastón en iOS es algo que hoy no puede funcionar**,
purpose string o no. Pero por dos razones, y ninguna es la del reporte:

1. **No hay adapter de transporte para iOS**: `selectTransportAdapter` devuelve `manual`. La pantalla del
   bastón en iPhone es manual-first por diseño (spec 04 R8/R12, camino MFi GATED).
2. Si alguien destraba el camino iOS, **`UISupportedExternalAccessoryProtocols` no es opcional**: sin la
   clave el módulo trapea al inicializarse. Hay que declararla junto con el protocol string del
   fabricante — y ese sigue siendo el ítem gateado de Facundo.

**Límite de lo que verifiqué**: leí el fuente, **no lo ejecuté en un iPhone**. Queda una incógnita real:
RN históricamente fuerza main-queue setup (instanciación temprana) para los módulos que sobreescriben
`init()`, y este lo sobreescribe. Si en este build el módulo se instancia en el arranque del bridge en
vez de en el primer acceso desde JS, la app **crashea al abrir en iOS hoy mismo**, con o sin purpose
string. No lo puedo afirmar ni descartar desde acá. **Es lo primero que hay que mirar cuando haya un
build de iOS instalable** — y si pasa, el arreglo es declarar la clave (aunque sea con un array vacío),
no tocar el purpose string.

**Corolario sobre los comentarios del código** (no bloqueante, pero que no confunda a nadie):
`app/app.config.ts:58-60` y el header del guard (líneas 13-14) dicen que sin la clave «la app SE CIERRA
apenas el tester abre la pantalla del bastón». Para **este** binario eso no es exacto: en iOS la pantalla
del bastón no llega a CoreBluetooth porque no se monta transporte. La afirmación vale para un binario que
sí instancie `CBCentralManager`; no describe el camino iOS actual. El fix sigue siendo **obligatorio** de
todas formas — el rechazo ITMS-90683 del validador es incondicional, porque el binario linkea
CoreBluetooth. Sugerencia: bajar el tono de esos dos comentarios a «cuando el camino iOS se destrabe» en
el próximo toque del archivo. No lo pido como cambio ahora.

---

## 7. Exactitud de specs (código → spec)

- `specs/active/16-ambientes-y-release/design.md:214-219` **está reconciliado**: documenta las dos claves,
  la fecha, el ITMS-90683, el motivo (no es cosmética) y **nombra el archivo del guard**. Coincide con el
  as-built. (Nota de proceso: el archivo estaba limpio al empezar mi pasada y apareció modificado a mitad
  de la revisión; el implementer declara no haberlo tocado. Reconciliado igual, que es lo que importa.)
- `specs/active/16-ambientes-y-release/requirements.md` R2.1 enumera qué preserva `app.config.ts` sin
  listar claves de `infoPlist` → **no contradice** el as-built.
- `specs/active/04-bluetooth-baston/requirements.md` R12 enumera permisos **por transporte**
  (spp-android / hid-wedge / web-serial). iOS no tiene transporte hoy, así que la ausencia del purpose
  string ahí es **omisión, no contradicción**. Opcional (una línea): anotar en R12 que el binario declara
  `NSBluetoothAlwaysUsageDescription` aunque el transporte iOS esté gateado, y que el camino MFi además
  va a exigir `UISupportedExternalAccessoryProtocols` (sección 6). **No bloquea.**

No hay specs mintiendo sobre el código.

---

## 8. Verificación independiente (salida literal)

`node scripts/check.mjs` — **exit code 0**:

```
All tests passed.
[OK]    Tests verdes

-- 4. Resumen ----------------------------------------
[OK]    Entorno listo. Podés trabajar.
```

`pnpm typecheck` (en `app/`):

```
> rafaq-app@0.1.0 typecheck C:\DEV\RAFAQ\app-ganado\app
> tsc --noEmit

TYPECHECK_RC=0
```

`node scripts/run-tests.mjs` (suite completa; esta vez había keys de Supabase, así que las suites de base
**sí** corrieron):

```
>>> typecheck client
<<< typecheck client OK
>>> scripts unit tests (spec 16 Run B)
ℹ tests 33     ℹ pass 33     ℹ fail 0
>>> client unit tests
ℹ tests 3086   ℹ pass 3086   ℹ fail 0
>>> RLS suite             ℹ tests 22    ℹ fail 0
>>> Edge Functions suite  ℹ tests 47    ℹ fail 0
>>> Animal suite          ℹ tests 139   ℹ fail 0
>>> Maneuvers suite       ℹ tests 14    ℹ fail 0
>>> Reports suite         ℹ tests 36    ℹ fail 0
>>> Custom / Scrotal / user_private / Import / SIGSA / Treatments / Audit / Health — todas OK
All tests passed.
```

`node scripts/check-hardcode.mjs`:

```
[OK]    Anti-hardcode (ADR-023 §4): 0 violaciones en app/app + app/src/components
RC=0
```

Los dos archivos del cambio, aislados: **23 tests, 23 pass, 0 fail** (11 de `app.config.test.ts` + 12 del
guard).

**E2E: NO se corrió**, como se pidió.

---

## 9. CHECKPOINTS

| # | Checkpoint | Estado |
|---|---|---|
| C1 | Harness completo · `check.mjs` exit 0 | [x] |
| C2 | Estado coherente (no es feature de `feature_list.json`; nada quedó `in_progress` por esto) | [x] |
| C3 | Respeta arquitectura · sin deps nuevas · sin logs de debug ni TODOs sueltos · sin `establishment_id` hardcodeado | [x] |
| C4 | Verificación real: el módulo con lógica (el guard) tiene tests, con fixtures reales (`node_modules` de verdad, no mocks), runner con más de 0 tests y verde | [x] |
| C5 | Sin artefactos temporales sin trackear atribuibles a este cambio (los dos ajenos, señalados en la sección 5) | [x] |
| C6 | SDD — **N/A**: defecto de Apple, no feature con `"sdd": true`, no hay `specs/active/<name>/` | N/A |
| C7 | Multi-tenant — **N/A**: no toca tablas ni RLS | N/A |
| C8 | Offline-first — **N/A**: no toca carga de datos ni sync | N/A |
| C9 | E2E + visual (ADR-029) — **N/A**: no hay UI nueva. Es config de build + un test estático; una E2E web no puede ver un Info.plist de iOS (declarado en el header del guard, hueco 5) | N/A |

---

## 10. Checklist RAFAQ-específico

**A — tablas con `establishment_id` / RLS**: **N/A**. El cambio no toca SQL, migraciones ni policies.

**B — carga/edición de datos en campo (offline-first)**: **N/A**. No toca repositorios, PowerSync ni
sync buckets.

**C — BLE (Vesta, Allflex)**: **aplicable parcialmente** — toca la *configuración de permisos* del
bastón, no su comportamiento.

- [x] Manejo de desconexión repentina — **sin cambios**: el camino SPP/Android y sus timeouts quedan
      intactos (`app/src/services/ble/**` no se modificó; el guard solo lo lee).
- [x] Modo manual de fallback en 1 tap o menos — **sin cambios**, y en iOS es literalmente el único
      camino (`selectTransportAdapter` devuelve `manual`; spec 04 R7.2/R7.3).
- [x] Correlación TAG-peso por ventana temporal — **sin cambios** (este fix no la toca).
- [x] Logs de eventos BLE no bloquean el flujo del operario — **sin cambios**.
- [x] Extra, específico de esto: el guard **no** rompe el contrato de adapters ni agrega dependencias al
      camino de runtime (es un test; `app.config.ts` sigue siendo puro de expo en runtime).

**D — UI de campo (manga, wizard)**: **N/A**. No hay componente ni pantalla nueva; el único texto nuevo
lo renderiza **iOS**, no la app (diálogo del SO, sin control de tipografía ni de tap target).

**E — Edge Functions**: **N/A**. No toca `supabase/functions/**`.

---

## 11. Cambios requeridos

**Ninguno bloqueante.** Lo que dejo anotado para el backlog o el próximo toque, sin retener la aprobación:

1. `app/app.config.ts:58-60` y `app/ios-purpose-strings-guard.test.ts:13-14` — el comentario «la app SE
   CIERRA apenas el tester abre la pantalla del bastón» no describe el camino iOS actual (en iOS no se
   monta transporte). Reformular a «cuando el camino iOS se destrabe». Cosmético: el fix es correcto y
   obligatorio igual.
2. `UISupportedExternalAccessoryProtocols` — antes de que alguien pruebe el bastón en iPhone, mirar si el
   módulo se instancia en el arranque (sección 6). Si crashea al abrir, la causa es el force-cast de
   `RNBluetoothClassic.swift:68-69`, no el purpose string.
3. `specs/active/04-bluetooth-baston/requirements.md` R12 — una línea opcional sobre el purpose string de
   iOS y el pendiente MFi.
4. Estructural, preexistente y fuera de alcance: nada obliga a que un archivo `*.test.ts` esté en la
   lista de `scripts/run-tests.mjs` (línea 69: «LISTA EXPLÍCITA (no hay glob): un test que no figure acá
   NUNCA corre»). Borrar esa línea desactiva el guard en silencio. Es una propiedad de todo el repo, no
   de este cambio.
