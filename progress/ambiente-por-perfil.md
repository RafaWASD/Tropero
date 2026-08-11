# Ambiente por perfil de EAS — cierre del defecto del chip «crash» en TestFlight

**Fecha**: 2026-08-11 · **Origen**: build 5 de iOS abierto por Raf en su iPhone (chip «crash» visible en la
pantalla principal) · **baseline_commit**: `775662eff3b5ed2cbbcc0a8d613c3df85f8e4aeb`

## Qué estaba roto (la cadena completa, no el síntoma)

1. `app/eas.json` no declaraba `EXPO_PUBLIC_ENV` en **ningún** perfil (`grep -c` → 0).
2. `getAppEnv()` (`app/src/utils/app-env.ts`, spec 16 R3.4) cae al default `development` cuando la
   variable falta → **todo** build, incluido `production`, se creía en desarrollo.
3. El gate del chip era `development || preview`, y `preview` es justamente el ambiente de lo que se
   reparte: el APK interno y TestFlight. O sea que arreglar (1) sin arreglar (3) dejaba el chip igual en
   manos de los testers y de un revisor de Apple.

Radio de daño real más allá del chip: `sentry.native.ts:33` (`environment`) y
`EstablishmentContext.tsx:582` (grupo de tenant de PostHog). Hoy no duelen porque ningún perfil trae DSN
ni key, pero con la observabilidad prendida **todo** hubiera llegado etiquetado `development`.

## Cambios

| Archivo | Qué |
|---|---|
| `app/eas.json` | `EXPO_PUBLIC_ENV` en los 5 perfiles (5 líneas, nada más — diff verificado) |
| `app/src/utils/dev-crash-gate.ts` (nuevo) | `isDevCrashEnabled()` = `getAppEnv() === 'development'` |
| `app/app/_components/RootErrorBoundary.tsx` | importa el gate en vez de decidir; comentarios ~72-74 y ~85 actualizados; se borró el `isDevCrashEnabled` local |
| `app/src/utils/app-env.ts` | `APP_ENVS` pasa a estar **exportada** (el guard deriva el dominio de ahí, no lo re-tipea) |
| `app/eas-profiles-guard.test.ts` (nuevo) | guard sobre la ausencia + 8 mutantes |
| `app/src/utils/dev-crash-gate.test.ts` (nuevo) | gate por comportamiento + barrido de la UI |
| `scripts/run-tests.mjs` | los dos tests nuevos registrados en la lista explícita (+ el porqué) |

Mapeo aplicado, tal como se pidió:

```
preview          preview     | backend: PROD
preview-dev      preview     | backend: DEV
testflight-dev   preview     | backend: DEV
development      development | backend: DEV
production       production  | backend: PROD
```

### Decisiones que tomé y no estaban en el pedido (vetables)

1. **El gate del chip vive en un `.ts` propio, no adentro del `.tsx`.** La suite corre con
   type-stripping y **no puede importar JSX**: con la decisión adentro de `RootErrorBoundary.tsx` el
   único oráculo posible era un regex sobre el fuente — un test que pasa por parecido, no por
   comportamiento. Es una decisión de una línea y es exactamente la línea que se equivocó. El componente
   ahora delega, y un test estático verifica que siga delegando (falsificado: reimplementar el gate
   inline pone el guard en rojo).
2. **`e2e` NO se admite como valor de un perfil de build**, aunque el pedido lo incluía en el dominio.
   `e2e` lo inyecta el shim de Playwright sobre el export web; un binario que lo declarara arrancaría con
   `isE2E() === true` → `Sentry.enabled=false` y `posthog.disabled=true` **en silencio**. El dominio
   admitido en `eas.json` es `APP_ENVS` menos `e2e`, con el motivo escrito en el guard. Si no lo querés
   así, es una línea (`ALLOWED_IN_BUILD_PROFILE`).
3. **El guard resuelve la cadena de `extends`** (EAS mergea el `env` del padre). Sin eso, un perfil
   legítimo que hereda su ambiente daría un rojo FALSO — y un rojo falso es la excusa perfecta para
   aflojar el guard. Hay mutante para las dos direcciones (hereda bien → verde; hereda de uno que
   tampoco la declara → rojo los dos).
4. **El barrido de UI cubre `app/app` + `src/components`** (la misma superficie que define
   `check-hardcode.mjs` como UI), no solo `app/app`. Hoy: 0 offenders.
5. **`APP_ENVS` exportada.** El dominio del guard sale de la MISMA constante que usa `getAppEnv()` para
   aceptar o descartar el valor. Un espejo escrito a mano se desincroniza en silencio (modo de falla ya
   catalogado en este repo).

## Trazabilidad

| Qué debe quedar verdadero | Test |
|---|---|
| Cada perfil de build declara `EXPO_PUBLIC_ENV` | `app/eas-profiles-guard.test.ts` :: «TODO perfil de build de eas.json declara EXPO_PUBLIC_ENV…» |
| Un perfil NUEVO nace en rojo | idem :: «MUTANTE: un perfil NUEVO sin la variable nace en rojo» |
| Valor fuera de dominio → rojo nombrando perfil y valor | idem :: «MUTANTE: valor fuera de dominio ("staging")» |
| `e2e` prohibido en un build | idem :: «`e2e` NO es un ambiente válido para un perfil de build» |
| El mapeo vigente no cambia por accidente | idem :: «el mapeo vigente perfil → ambiente está pineado» |
| El valor declarado es el que la app lee de verdad | idem :: «cada valor declarado en eas.json es reconocido por getAppEnv()» |
| El chip NO se monta en `preview` | `app/src/utils/dev-crash-gate.test.ts` :: «preview NO habilita el chip…» |
| Ni en `production`/`e2e`; todo el dominio cubierto | idem :: «production y e2e tampoco…» / «el dominio COMPLETO está cubierto» |
| El componente no re-implementa el gate | idem :: «RootErrorBoundary.tsx delega el gate…» |
| Ninguna pantalla decide por ambiente inline | idem :: «ninguna pantalla ni componente decide por ambiente inline» |

## Falsificación (mutando los archivos REALES, salida literal)

**F1 — sacar `EXPO_PUBLIC_ENV` de UN perfil (`testflight-dev`):**

```
✖ TODO perfil de build de eas.json declara EXPO_PUBLIC_ENV, y con un valor del dominio (4.2033ms)
  AssertionError [ERR_ASSERTION]:
    perfil "testflight-dev": no declara `EXPO_PUBLIC_ENV` → ese build se creería en `development`
    (default de getAppEnv()): chip de crash visible y observabilidad mal etiquetada
```

**F2 — `EXPO_PUBLIC_ENV: "staging"` en `production`:**

```
  AssertionError [ERR_ASSERTION]:
    perfil "production": `EXPO_PUBLIC_ENV` = "staging", fuera del dominio admitido {development, preview, production}
  AssertionError [ERR_ASSERTION]: el perfil "production" cambió de ambiente
  + 'staging'  - 'production'
```

**F3 — perfil nuevo (`testflight-prod`) sin la variable:**

```
  AssertionError [ERR_ASSERTION]:
    perfil "testflight-prod": no declara `EXPO_PUBLIC_ENV` → ese build se creería en `development`
    (default de getAppEnv()): chip de crash visible y observabilidad mal etiquetada
```

**F4 — volver al gate viejo (`development || preview`) en `dev-crash-gate.ts`:**

```
✔ el chip SOLO se habilita en development (1.192ms)
✖ preview NO habilita el chip (el APK interno y TestFlight son preview — es el defecto del build 5)
✖ el dominio COMPLETO está cubierto: solo development da true
ℹ pass 5 · fail 2
```

O sea: **el test del gate NO pasa con el gate viejo.** Es la falsificación que pediste.

**F5 — reimplementar el gate adentro del `.tsx` (`getAppEnv() !== 'production'`):**

```
✖ RootErrorBoundary.tsx delega el gate en isDevCrashEnabled() y NO lo re-implementa
  AssertionError: RootErrorBoundary.tsx dejó de importar el gate desde @/utils/dev-crash-gate
✖ ninguna pantalla ni componente decide por ambiente inline (guard sobre la AUSENCIA)
```

Las 5 mutaciones (sobre 3 archivos: `eas.json`, `dev-crash-gate.ts`, `RootErrorBoundary.tsx`) fueron
revertidas y verificadas; `git diff -- app/eas.json` = 5 inserciones, sin churn de CRLF.

## Verificación (salida literal)

```
> rafaq-app@0.1.0 typecheck C:\DEV\RAFAQ\app-ganado\app
> tsc --noEmit
typecheck OK
```

```
ℹ tests 3108
ℹ suites 0
ℹ pass 3108
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 16565.7515
```

```
[OK]    Anti-hardcode (ADR-023 §4): 0 violaciones en app/app + app/src/components
```

(La lista de tests se extrajo del propio `run-tests.mjs`, así que es exactamente la que corre `check.mjs`:
169 archivos, sin duplicados, sin inexistentes, con los dos nuevos adentro. **No corrí E2E** ni las suites
de DB contra el remoto.)

## Autorrevisión adversarial

- **¿Se rompe la E2E?** No. El shim inyecta `EXPO_PUBLIC_ENV='e2e'` → el chip ya no se montaba antes y
  sigue sin montarse. Cero cambio de comportamiento en las ~70 specs.
- **¿Se rompe `pnpm start` local?** No: `eas.json` no aplica al dev server; sin la variable sigue cayendo
  al default `development` (chip visible, que es lo correcto en la máquina de Raf). Hay un test que
  documenta ese acoplamiento a propósito.
- **¿Hay código dormido que se despierte ahora que los builds dicen su ambiente real?** Barrí el árbol:
  los únicos consumidores de `getAppEnv()` son el gate, `sentry.native.ts` (`environment`) y
  `EstablishmentContext` (grupo de PostHog). Los `'preview'`/`'production'` que aparecen en `src/` son
  del wizard de importación (paso `preview`) y `NODE_ENV` en `AuthContext` — otra variable, no la toca
  este cambio. **Ninguna rama nueva se enciende.**
- **¿El guard puede pasar en verde por vacío?** No: `eas.json` faltante → `readFileSync` tira; `build`
  renombrado/vacío → violación (hay mutante).
- **¿`stripSourceComments` corrompe el JSON?** Verificado ejecutando:
  `JSON.stringify(parse(raw)) === JSON.stringify(parse(stripped))` → `true`, y las URLs con `//`
  sobreviven. Además tolera un `//` real en `eas.json` (EAS los permite).
- **¿Los mutantes tienen sentido?** Los que parten del archivo real (`realWith`) solo pasan si la base
  está limpia — se ponen rojos junto con el test principal. Es ruido en una corrida ya roja, no una
  falla de diseño.
- **Salida del rojo legible**: cambié `assert.match` por `assert.ok(regex.test(...))` en el guard
  estático porque el primero **volcaba el archivo entero** en el mensaje. Un guard cuyo rojo hay que
  excavar es un guard que se termina ignorando.

## Lo que me preguntaste

### 1. El default `development` de R3.4: ¿sigue siendo el correcto o debería ser fail-closed?

**Sigue siendo el correcto, pero por un motivo distinto al que da la spec, y con una condición.**

Con los perfiles declarando su ambiente, el default dejó de gobernar «todo build» y pasa a gobernar
**solo el dev server local** (y el export web de E2E, que igual lo setea explícito). En ese universo
`development` no es una convención: es literalmente verdad.

Las dos alternativas fail-closed son peores, cada una por su lado:

- **Tirar excepción si falta.** Convierte un problema de *etiquetado* en un problema de *boot*.
  `getAppEnv()` se llama en el render del boundary y en el init de Sentry: la app dejaría de arrancar en
  cualquier máquina que no tenga la var en `app/.env.local`. Hoy `resolveEnv` ya falla cerrado por las
  3 variables que la app **necesita para funcionar**; `EXPO_PUBLIC_ENV` no es una de ésas.
- **Default `production`.** Es fail-safe para las *afordances* de dev y fail-open para lo que más
  importa: los errores locales de Raf (que sí tienen DSN en `app/.env.local`, ver `.env.example`)
  llegarían etiquetados `production`. Eso es *exactamente* la confusión que estamos cerrando —
  «no distinguir el error de un productor real de una prueba de Raf»— pero movida al lado donde cuesta
  caro, porque de una alerta `production` se actúa.

**La condición / el agujero que sí queda, y no lo tapa ningún default**: el build **nativo local**
(`./gradlew assembleRelease`, que este repo usa para no gastar builds de EAS) **no lee `eas.json`**. Un
APK así sale con ambiente `development` y con el chip puesto. El default no es el lugar para arreglarlo:
un build local de debug *debe* ser `development`. El lugar correcto es el gate del chip, agregándole
`__DEV__` (la marca del bundler, que es `false` en cualquier bundle release **sin depender de que
alguien se acuerde de una variable**): `__DEV__ && getAppEnv() === 'development'`.
**No lo implementé** porque tiene matices propios (el perfil `development` de EAS es debug, así que
`__DEV__` es true ahí; y meter un global del bundler en una función pura pide un seam para testearla) y
merece una decisión, no un agregado silencioso. Lo dejo recomendado.

Nota de reconciliación pendiente (no toqué `specs/**`, está prohibido en esta vuelta): R3.4 sigue siendo
correcta como está escrita, pero su **alcance** cambió — conviene una nota de que el default aplica solo
al dev server. Y de paso, R4.3/R4.4 ya estaban divergentes del as-built desde antes: piden `channel` y
variables por **EAS Environment Variables** (`environment:`), y `eas.json` usa el bloque `env` inline y
no declara `channel`.

### 2. ¿Hay algún caso donde alguien necesite el chip en `preview`?

**No, y hoy es todavía más claro que en abstracto: en `preview` el chip no validaba nada.**

El propósito del chip (R2.6) es probar el pipeline `ErrorBoundary → Sentry`. Pero
`enabled: !!sentryDsn && !isE2E()` y **ningún perfil de `eas.json` trae `EXPO_PUBLIC_SENTRY_DSN`**. O sea
que en el build 5 el chip cerraba la app y **no reportaba nada**: puro costo, cero señal. Sacarlo de
`preview` no pierde ninguna capacidad existente.

El caso legítimo que sí existe —a futuro— es verificar Sentry sobre un **binario release** (DSN horneado
por EAS, source maps subidos), que por definición no es `development`. Pero eso no pide un botón visible
de autodestrucción en la home del build que usa Facundo. Cuando haga falta, la forma correcta es:

1. **Un evento manejado, no un crash**: una acción «mandar evento de prueba» (`captureMessage`) prueba
   DSN + transporte + source maps sin cerrarle la app a nadie.
2. **Detrás de un gesto oculto** (los 7 taps sobre la versión en Ajustes, patrón «developer mode»): no
   descubrible por un tester ni por un revisor de Apple.
3. **Nunca gateado por `preview` a secas**: si alguna vez se necesita en un build repartido, que sea por
   una variable propia (`EXPO_PUBLIC_DEV_TOOLS`) puesta **solo** en `preview-dev` — nunca en `preview`
   ni en `testflight-dev`.

Asimetría que cierra la discusión: re-agregarlo acotado cuesta una tarde; dejarlo puesto cuesta que un
tester (o Apple) toque un botón que cierra la app.

### 3. El bug de `APP_VARIANT` del backlog: ¿sigue vivo?

**Sí, sigue vivo, verificado ahora:** `grep -c APP_VARIANT app/eas.json` → **0**, y `app.config.ts:36`
deriva `const isDev = process.env.APP_VARIANT === 'development'`. Un `eas build --profile development`
sigue produciendo el id y el nombre de **producción** (`ar.rafq.app` / «miTropero»), no la variante
`.dev` coinstalable. **No lo toqué**, como pediste.

Consecuencia nueva que introdujo este cambio, para que quede dicha: hasta hoy todos los builds eran
`development` (chip en todos). Ahora el perfil `development` de EAS es **el único** que lleva el chip
—y es justo el que se instala bajo la identidad de **producción**. En la práctica no cambia la
prioridad (nadie usa ese perfil por EAS; el dev client se buildea local), pero si alguien lo usa, se
instala una app con el chip pisando el id de prod. Cuando se destrabe la fase 2 del rebrand y se toque
esa entrada del backlog, las dos cosas se arreglan juntas: `APP_VARIANT` + el id.

## Estado

- No marqué nada como `done`: queda para el reviewer.
- No toqué `app/app.config.ts` ni `app/ios-purpose-strings-guard.test.ts` (del otro implementer); en
  `scripts/run-tests.mjs` mi cambio es **aditivo** y su registro del guard de purpose strings quedó
  intacto (verificado en el diff).
- No lancé builds de EAS. No corrí E2E. No toqué `docs/**` ni `specs/**`.

---

# Vuelta 2 (2026-08-11) — la segunda llave: `__DEV__`

Se cierra el hueco que la vuelta 1 dejó recomendado y sin implementar. **Un solo cambio de
comportamiento**, una línea:

```ts
// app/src/utils/dev-crash-gate.ts
export function isDevCrashEnabled(): boolean {
  return isDevBundle() && getAppEnv() === 'development';   // antes: getAppEnv() === 'development'
}
function isDevBundle(): boolean {
  return typeof __DEV__ !== 'undefined' && __DEV__ === true;   // patrón de `ble/demo-gate.ts`
}
```

| Archivo | Qué |
|---|---|
| `app/src/utils/dev-crash-gate.ts` | el AND + `isDevBundle()` + el bloque «VUELTA 2» del header con la evidencia |
| `app/src/utils/dev-crash-gate.test.ts` | matriz `__DEV__` × ambiente (7 tests de comportamiento, antes 5) + el guard estático ampliado |
| `app/app/_components/RootErrorBoundary.tsx` | **solo comentarios** (el docblock decía "visible SOLO en `development`") |

Sin try/catch alrededor de `typeof`: no puede tirar `ReferenceError`, y un `catch` que ningún test puede
poner en rojo es una rama muerta. (`demo-gate.ts` lo tiene; no lo copié por copiar.)

## Lo primero: **te equivocaste en cuál build tapa esto** — y aun así el cambio va

El pedido dice que el agujero es `./gradlew assembleDebug`. **No lo es.** `assembleDebug` es un build de
**debug**: no embebe bundle, carga JS de Metro, y Metro le sirve `dev=true` → `__DEV__ === true`, ambiente
`development` → **el chip sigue apareciendo ahí, con el AND puesto**. Verificado abajo, no deducido.

Y está bien que así sea: eso es literalmente una máquina de desarrollo con Metro atado. Lo que el AND
cierra es el bundle **RELEASE** que no pasó por `eas.json`: `./gradlew assembleRelease`,
`expo run:android --variant release`, un export embebido, o un perfil futuro que naciera fuera del guard.
Ahí `EXPO_PUBLIC_ENV` no existe, `getAppEnv()` cae a `development` (R3.4) y el chip volvía.

O sea: **la decisión es correcta, la justificación estaba corrida un escalón**. Tu principio ("un binario
release nunca debería mostrarlo, venga de donde venga") es exactamente lo que implementa el AND; el
ejemplo con el que lo apoyaste no es un caso de release. Lo dejo escrito en el header del módulo para que
nadie lea el commit y crea que el debug local quedó tapado.

## Lo que pediste verificar: **el dev client de EAS sigue mostrando el chip**

No lo asumí. Lo ejecuté, en dos tramos que se encadenan.

**Tramo 1 — qué le pide el dev client al bundler.** Android arma la URL en
`react-native/ReactAndroid/.../DevServerHelper.kt:292` con `…&dev=%s&…`, donde el `%s` es
`settings.isJSDevModeEnabled`, cuyo **default es `true`** (`DevInternalSettings.kt:49`:
`get() = preferences.getBoolean(PREFS_JS_DEV_MODE_DEBUG_KEY, true)`). iOS ni siquiera lo consulta, lo
hardcodea (`expo-dev-launcher/ios/EXDevLauncherController.m:427`:
`index.bundle?platform=%@&dev=true&minify=false`).

**Tramo 2 — qué devuelve el bundler con ese `dev`.** Levanté el **Metro real del proyecto**
(`Metro.runServer` con `app/metro.config.js`, o sea con el plugin de Tamagui y el `resolveRequest` de
supabase adentro) y pedí el bundle con la misma forma de URL. Salida literal:

```
### dev=true — PRIMEROS 160 CHARS DEL BUNDLE (prelude):
"var __BUNDLE_START_TIME__=globalThis.nativePerformanceNow?nativePerformanceNow():Date.now(),__DEV__=true,process=globalThis.process||{},__METRO_GLOBAL_PREFIX__="
    asignaciones literales de __DEV__: ["__DEV__=true"]

### dev=false — PRIMEROS 160 CHARS DEL BUNDLE (prelude):
"var __BUNDLE_START_TIME__=globalThis.nativePerformanceNow?nativePerformanceNow():Date.now(),__DEV__=false,process=globalThis.process||{},__METRO_GLOBAL_PREFIX__"
    asignaciones literales de __DEV__: ["__DEV__=false"]
```

Y con un módulo sonda (`globalThis.__PROBE_DEV__ = __DEV__; if (__DEV__) …DEV_BRANCH… else …PROD_BRANCH…`):

```
### GET /.dev-probe-entry.bundle?platform=android&dev=true   [HTTP 200, 45719 bytes]
    entry     : __PROBE_DEV__ = __DEV__;      ← identificador, resuelto por el prelude
    rama DEV presente: true   rama PROD presente: true

### GET /.dev-probe-entry.bundle?platform=android&dev=false  [HTTP 200, 27909 bytes]
    entry     : __PROBE_DEV__ = false;        ← inlineado en tiempo de build
    rama DEV presente: false  rama PROD presente: true      ← la rama de dev DESAPARECE del bundle
```

Mismo resultado con `platform=web`. El entry de la sonda vivió en `app/.dev-probe-entry.js` durante la
corrida y se borró (árbol limpio, verificado con `git status`).

**Conclusión: el perfil `development` de EAS (`developmentClient: true`, y su `env` ya declara
`EXPO_PUBLIC_ENV: development`) sigue con las dos llaves en `true` → el chip sigue ahí.** No es una
regresión disfrazada. Hay un test con ese nombre exacto para que quede clavado.

**Excepción conocida, la digo yo antes que la encuentres**: si alguien apaga "JS Dev Mode" en el menú de
RN, el dev client pide `dev=false` y el chip desaparece hasta que lo vuelva a prender. Es una acción
explícita de quien desarrolla, no un accidente; no la tapo.

**Corroboración cruzada dentro del repo** (dos registros previos, coherentes con esto): el veto del leader
en `specs/active/22-.../design.md:213` («el build de device de Raf es `preview-dev`, que puede compilar en
release-mode → `__DEV__ === false`») y `progress/gate2_04-multivendor.md:30` («`__DEV__`: false en
release/preview de Expo por construcción»). Ninguna de las dos decisiones choca con ésta: la traza de sync
sigue SIN gatear por `__DEV__` (se quiere en el device de preview), el chip sí se gatea (no se quiere ahí).

## Cobertura: la matriz completa

`app/src/utils/dev-crash-gate.test.ts`, 10 tests (antes 7). El corazón es la tabla de verdad explícita:

| `__DEV__` | ambiente | chip | escenario real |
|---|---|---|---|
| `true` | `development` | **SÍ** | `pnpm start` · dev client de EAS · `gradlew assembleDebug` + Metro |
| `true` | `preview` | no | dev client apuntado a un backend de preview |
| `false` | `development` | no | **el caso de la vuelta 2**: bundle release sin `EXPO_PUBLIC_ENV` |
| `false` | `preview` | no | el APK interno / TestFlight (el defecto del build 5) |

Más: `__DEV__` **ausente** (fail-closed, sobre TODO `APP_ENVS` + sin variable), el release sin variable
aislado, el `pnpm start` sin variable, el dev client de EAS, `preview`/`production`/`e2e` ejercidos **con
`__DEV__ = true`** a propósito (si los ejerciera con `false` pasarían por la razón equivocada, tapados por
la otra llave), y el barrido de `APP_ENVS` en las dos filas (`dev` → solo `development`; `release` → nadie,
ni un ambiente futuro).

`__DEV__` se simula seteando `globalThis.__DEV__` (patrón de `ble/demo-gate.test.ts`) y se limpia en
`beforeEach` **y** `afterEach`: el estado "ausente" es un caso de la matriz, no el default accidental de la
corrida.

## Falsificación (mutando los archivos REALES, restaurados y verificados byte a byte)

**M1 — el gate de la vuelta 1 (`getAppEnv() === 'development'` a secas). Es la falsificación que pediste:**

```
✖ LAS 4 COMBINACIONES: el chip pide bundle de dev Y ambiente development (AND, no OR)
✖ bundle RELEASE sin EXPO_PUBLIC_ENV → NO hay chip (el build nativo fuera de EAS)
✖ `__DEV__` AUSENTE (runtime sin la marca del bundler) → NO hay chip (fail-closed)
✖ el dominio COMPLETO está cubierto: en bundle de dev, solo development da true
ℹ tests 10 · pass 6 · fail 4
  AssertionError: __DEV__=false × ambiente=development debía dar false
    (bundle RELEASE que cayó al default `development` por falta de EXPO_PUBLIC_ENV)
```

**El test NO pasa con el gate anterior.** Mide el cambio, no el parecido.

| Mutante | Resultado |
|---|---|
| **M2** — `\|\|` en vez de `&&` | rojo, 6/10 (`__DEV__=true × preview debía dar false`) |
| **M3** — solo `__DEV__` (se cae el ambiente) | rojo, 4/10 (`el chip quedó habilitado en production`) |
| **M4** — `typeof __DEV__ !== 'undefined'` sin `=== true` (presente ≠ dev) | rojo, 3/10 (`__DEV__=false × development debía dar false`) |
| **M5** — el `.tsx` re-implementa media llave (`{__DEV__ && isDevCrashEnabled() ? …}`) | rojo, 1/10: `RootErrorBoundary.tsx lee __DEV__ directo: el gate del chip son DOS llaves y las dos viven en dev-crash-gate.ts` |

M5 es guard nuevo de esta vuelta: al de la vuelta 1 (`no re-implementa el gate`) le sumé la prohibición de
`__DEV__` **en ese archivo** (no un ban global: media docena de componentes usan `if (__DEV__) throw` en
worklets, y ese es un uso legítimo). Los 5 mutantes se revirtieron y se verificó igualdad exacta del
archivo (`identico: true`).

## Verificación (salida literal)

```
> rafaq-app@0.1.0 typecheck C:\DEV\RAFAQ\app-ganado\app
> tsc --noEmit
```

```
ℹ tests 3111
ℹ suites 0
ℹ pass 3111
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 24954.968
```

```
[OK]    Anti-hardcode (ADR-023 §4): 0 violaciones en app/app + app/src/components
```

(3108 → 3111: neto +3, mi archivo pasó de 7 a 10 tests. La lista es la misma que corre `check.mjs`, extraída
del propio `run-tests.mjs` — 169 archivos; **no hice falta tocarlo**, no agregué archivos nuevos. No corrí
E2E ni las suites de DB.)

## Autorrevisión adversarial

- **¿Rompe la E2E?** No, y lo verifiqué sobre el artefacto real: el export web que sirve Playwright
  (`app/dist/_expo/static/js/web/*.js`) tiene `__DEV__=false` en 3 chunks y `__DEV__=true` en **0**. El chip
  ya estaba apagado por `EXPO_PUBLIC_ENV='e2e'`; ahora está apagado por las dos llaves. Cero cambio de
  comportamiento en las ~70 specs. Ninguna spec E2E referencia el chip (grep sobre `app/e2e`).
- **¿Rompe `pnpm start` / `pnpm web`?** No: dev server = `dev=true` (verificado también con `platform=web`)
  + default `development` → chip visible, con test propio.
- **¿Y el device de QA (`gradlew assembleDebug` + dev client)?** Sigue mostrando el chip. Es el punto que
  corregí arriba: no es el agujero, y no había que taparlo.
- **¿Algún consumidor más de `isDevCrashEnabled()`?** No: `RootErrorBoundary.tsx` y nada más (grep de
  `DevCrash|isDevCrashEnabled` sobre `app/app`, `app/src`, `app/e2e`).
- **¿El test puede pasar por la razón equivocada?** Era el riesgo real: con `__DEV__ = false` **todos** los
  casos de ambiente dan `false` y los tests de `preview`/`production`/`e2e` pasarían sin ejercer nada. Por
  eso esos casos se corren con `__DEV__ = true` explícito — y M3 (borrar la llave del ambiente) los pone
  rojos, que es la prueba de que sí la ejercen.
- **¿Leak de `globalThis.__DEV__` a otros archivos?** `afterEach` lo borra siempre; además `node --test`
  corre cada archivo en su proceso. `demo-gate.test.ts` (el otro que lo usa) restaura el valor previo.
- **¿`__DEV__` con un valor truthy no booleano (`1`)?** `=== true` → `false`. Fail-closed a propósito.
- **¿Qué pasa si Metro deja de inlinear `__DEV__` dentro de un `typeof`?** Nada: el prelude define
  `__DEV__=false` igual, así que las dos formas de resolución dan `false` en release. No depende del inline.
- **Sin churn de CRLF**: los 3 archivos siguen LF (`file` no reporta CRLF) y el diff del `.tsx` es 13/13
  idéntico con y sin `-w` (o sea, no hay líneas que cambien solo por espacios).

## Reconciliación de specs — PENDIENTE, y ahora es más grande

Sigue prohibido tocar `specs/**` en esta vuelta, así que lo dejo anotado (crece lo de la vuelta 1):

1. **R2.6 (feature 17)** dice que el chip es visible en `development`/`preview`. El as-built es
   `__DEV__ && development`. Hay que reescribir el EARS, no basta una nota.
2. **R3.4 (spec 16)**: el default `development` ya no gobierna «todo build» sino el dev server; y ahora
   además hay una segunda llave que lo hace inofensivo en release. Nota de alcance.
3. **R4.3/R4.4 (spec 16)**: ya estaban divergentes del as-built desde antes (piden `channel` + EAS
   Environment Variables; `eas.json` usa `env` inline y no declara `channel`).

## Estado (vuelta 2)

- No marqué nada como `done`: queda para el reviewer.
- Nada commiteado, como pediste. El cambio de la vuelta 1 sigue intacto.
- No toqué `eas.json`, `app.config.ts`, `ios-purpose-strings-guard.test.ts`, `APP_ID`/`scheme`/`slug`/
  `owner`/`projectId`, `docs/**`, `specs/**` ni `progress/**` fuera de este archivo.
- No lancé builds (ni de EAS ni de Gradle: la verificación de `__DEV__` se hizo con Metro, sin compilar
  nada nativo). No corrí E2E.
