# impl — `baston-chip-sin-transporte` (bugfix 🔴 device Android)

baseline_commit: d9a3eb012fc72d4544ae8ac010d32fee15da7dd4

> Reporte de Raf (device Android): *"el botón de conectar bastón en android no me está funcionando"*.
> Diagnóstico cerrado por el leader (NO re-investigado): `react-native-ble-plx` no está instalado;
> `selectTransportAdapter` devuelve `'manual'` en native → `instantiateTransport('manual')` devuelve
> `null` → `api?.transport?.connect()` es un no-op. **El botón no está roto: no debería existir.**

## 1. Qué decidí, y por qué

**Coincido con la recomendación del leader: sin transporte, el chip NO se muestra.** No es una preferencia
estética; hay tres razones que se sostienen solas:

1. **El chip no informa nada.** Sin transporte el provider ni siquiera suscribe un `onStatus`, así que el
   único `ConnectionStatus` alcanzable es `'off'` — invariante para toda la vida del proceso. Un indicador
   de estado cuyo estado no puede cambiar no es un indicador: es una etiqueta fija.
2. **Es chrome permanente en el header de una tab.** Ocupa el ángulo superior derecho —espacio de primera,
   zona de mayor peso visual después del título— para anunciar algo inusable en ese dispositivo. La captura
   `01` vs `06` lo muestra: sin el chip, el título "Animales" respira y el subtítulo de conteo es lo único
   que compite.
3. **Ya lo dicen las pantallas donde importa.** El hero de `maniobra/identificar` y el del `TagScanSheet`
   lo dicen **en el momento en que es relevante** ("El bastón no está disponible en este dispositivo"), con
   la entrada manual promovida al lado. El chip no agregaba información: la **contradecía** (decía "Conectar
   bastón" dos elementos por encima del hero que dice que no está disponible).

Precedente propio del repo: `StickStatusIndicator` **ya** se auto-oculta en `'off'` con este mismo criterio
("no ensucia el chrome de las pantallas normales"). La alternativa ("mostrarlo diciendo «no disponible»")
sería gastar el mismo espacio de primera para una frase que el usuario no puede accionar y que ya va a leer
donde corresponde.

**Lo que NO hice**: construir el transporte de Android (Fase 4). Gateado, sin RS420 para probar.

## 1-bis. La segunda superficie de la misma clase (`asignar-caravanas`) — fix-loop, hallazgo del reviewer

El reviewer encontró una superficie que mi barrida no vio: **`app/app/asignar-caravanas.tsx`** (asignación masiva),
entrada en `(tabs)/mas.tsx:992-998`. Su **única** entrada de datos es `useBleStickListener` y **no tiene
ninguna salida manual** → sin transporte no puede llegar jamás un tag, la cola nunca se llena y la pantalla
queda congelada para siempre en `EmptyQueueState`, que decía *"Bastoneá para empezar / Pasá el bastón por la
caravana del animal"*. Está a **2 taps del tab "Más"**, o sea más accesible que `/baston` (deep-link-only),
que yo sí había barrido. **Se me escapó por lo mismo que el hallazgo (b): copy suelto en el JSX**, que ninguna
de mis greps de `connect()` podía ver. Es la peor de la serie y no tengo excusa: sabía que la grep de
`connect()` era insuficiente —lo escribí en (b)— y no extendí la barrida al vocabulario del bastoneo.

**Decisión: el vacío dice la verdad; la fila de "Más" NO se oculta.** Coincido con el criterio del leader y
lo sostengo con razones propias, no por acuerdo:

1. **No es la misma cosa que el chip, y aplicarle la misma decisión sería un reflejo, no un análisis.** El
   chip es un *indicador de estado* cuyo estado no puede cambiar sin transporte: una etiqueta fija en el
   chrome de una tab, ruido puro, ocultarlo no pierde nada. La fila es un *punto de entrada a una
   funcionalidad real* que existe y funciona con el bastón (hoy en web; en Android con la Fase 4).
2. **Precedente propio de esta misma unidad**: `/baston` es exactamente la misma clase —una pantalla que sin
   bastón no sirve— y no la borré: la hice honesta. Ocultar la fila me dejaría dos criterios distintos para
   el mismo caso dentro del mismo bugfix.
3. **Costo de ocultar**: la funcionalidad se vuelve indescubrible y la app se ve distinta según el
   dispositivo ("a mi compañero le aparece y a mí no") — más caro de soportar que un tap gastado. Y
   obligaría a meter una dependencia del provider BLE en `mas.tsx`, que hoy no tiene ninguna; el fix
   as-built **no toca `mas.tsx`**.
4. **Costo de decir la verdad**: un tap, a cambio de que el operario aprenda algo cierto del producto.

Evaluado y descartado también el punto medio (marcar la fila misma como no disponible): `ActionRow` no tiene
afordancia de subtítulo/disabled, agregársela toca las ~15 filas de esa pantalla, y volvería a acoplar
`mas.tsx` al provider BLE. Si se ocultara la fila algún día, la condición tendría que ser "no hay
transporte", no "es Android" — igual que el chip.

**Copy reusado, no inventado**: la línea *"El bastón no está disponible en este dispositivo"* es literalmente
la misma que ya usan el hero de `maniobra/identificar` y el `ManualPromptHero` del `TagScanSheet`. Y lo dejé
**verificable**: `bulk-assign-empty.test.ts` trae un guard estático que lee las dos superficies y falla si
alguien reescribe una y deja las otras con la frase vieja (la regla "reusá la copy" no se sostiene con un
comentario). La salida que ofrece el copy —cargar de a una desde la ficha del animal— **existe de verdad y ya
tiene E2E verde**: `app/e2e/baston-ficha.spec.ts:160-205` arranca en `mode='manual'` (sin transporte), abre la
ficha, entra por `tag-scan-open` → hero manual → `ManualTagEntry` → asigna 15 dígitos y **verifica en el
server** que persistió. No prometo una salida que supongo: la que cité está probada.

Decisión de dónde vive: función pura `app/src/utils/bulk-assign-empty.ts::bulkAssignEmptyView(hasTransport)`
(parámetro obligatorio), no un ternario en el JSX — por la misma razón que (b).

**Un contraste que me corregí a mí mismo mirando la captura.** La primera versión diferenciaba las dos
líneas de apoyo con `$textFaint` (el gris terciario) en la tercera, copiando lo que hace el hero de
`identificar`. Lo revisé antes de cerrar: `$textFaint` es **4.03:1, o sea AA-LARGE**, que pide ≥18px
regular — y acá el texto es `$4` = **14px** regular. Habría quedado **por debajo de AA en una pantalla de
manga**, que por definición se lee a pleno sol y es de las 🔴. Cambiado: las dos líneas van en `$textMuted`
y la jerarquía la da el **peso** (500 vs 400), reusando tratamientos ya vetados (el subtítulo del
`ManualPromptHero` del `TagScanSheet` y el cuerpo original de este mismo vacío). Que el repo ya lo haga mal
en otro lado no es licencia para repetirlo. **Medido**: hay **60 usos** de `$textFaint`, varios en 12/13/14px
regular → misma situación. Es cross-cutting (decisión de DS, 3 tamaños) → **a `docs/backlog.md`**, no lo
arreglé acá.

## 2. La condición exacta

```ts
// app/src/components/ble-connection-view.ts
export function bleConnectionView(status, env: { hasTransport: boolean }): BleConnectionView | null {
  if (!env.hasTransport) return null;   // ← el chip no se renderiza
  switch (status) { /* … idéntico al baseline … */ }
}
```

donde el único call site la alimenta con `useBleProviderApi()?.transport != null`.

Cuatro propiedades deliberadas:

- **Es "no hay transporte", NO "es Android".** No hay un solo `Platform.OS` en el fix. Cuando la Fase 4
  construya el adapter SPP, `instantiateTransport` devolverá un `StickAdapter` y el chip vuelve solo, sin
  tocar este código. Es la misma entrada (`transport != null`) que ya usaban `maniobra/identificar` y
  `TagScanSheet` vía `resolveListenConnState`.
- **El corte va ANTES del `switch`, no como una rama más.** Sin transporte NINGÚN estado puede ofrecer
  conectar — ni el `'connected'`/`'disconnected'` transitorio que queda pegado un render si el transporte se
  desmonta en caliente (cambio de `mode` del provider: el `useMemo` recalcula `transport` a `null` y el
  cleanup llama `disconnect()`, que emite `'disconnected'`). Caso de borde real, cubierto por test.
- **`hasTransport` es parámetro OBLIGATORIO** (no opcional con default `true`). Un call site nuevo tiene que
  decidirlo explícitamente; un default optimista es exactamente cómo se reintroduce un CTA muerto.
- **La decisión está en la función pura, no dispersa en el componente.** El componente solo hace
  `if (view === null) return null` (después de los hooks).

## 3. Superficies barridas

| Superficie | Veredicto | Qué se hizo |
|---|---|---|
| `BleConnectionChip` (header tab Animales + `maniobra/identificar`) | 🔴 **el bug** (el que Raf chocó) | No se renderiza sin transporte. `testID="ble-connection-chip"`. |
| `asignar-caravanas` — `EmptyQueueState` | 🔴 **la pantalla muerta** (fix-loop) | Se me escapó en la primera pasada; lo encontró el reviewer. Sin transporte pedía un bastoneo imposible en la única superficie que **no tiene salida manual**, a 2 taps de "Más". Ver §1-bis. |
| `StickConnectionScreen` — card de estado | 🔴 **copy mentía** | El CTA ya estaba gateado en el componente (`&& hasTransport`), pero el **copy seguía prometiendo** ("Bastón sin conectar / Conectá el bastón para leer caravanas…"). El gate se movió a `connectionStatusView(status, {hasTransport})` → `cta:'none'` + copy honesto. |
| `StickConnectionScreen` — vacío de "Lecturas" | 🔴 | Decía "Conectá el bastón y bastoneá un animal". Ver §4, hallazgo (b). |
| `StickConnectionScreen` — fila del device | 🟡 **endurecimiento preventivo** (NO defecto vivo) | Ver §4, hallazgo (a). `deviceRowView` toma `hasTransport`. **Corregido del informe anterior, donde estaba rotulado 🔴 igual que el chip**: hoy el cambio es **no-op en las 3 plataformas** (Android entra por `available:false`, iOS por `binding === null`, web evalúa `true && true`). Cierra una trampa de Fase 4 real, pero nadie la puede chocar hoy — y si todo es 🔴, nada es 🔴. |
| `StickConnectionScreen` — ícono de la card | 🟡 **inalcanzable, cerrado igual** | Nit del reviewer. Era el único elemento de la card que no salía de la vista pura (`statusIcon(status)` sobre el status crudo) → podía contradecir al label. Inalcanzable hoy (el provider solo suscribe `onStatus` dentro de `if (transport)`). Cerrado: `ConnectionStatusView.icon`. |
| `StickConnectionScreen` — `TransportInstructions` | 🟡 | Daba instrucciones de un pairing imposible. Guard `\|\| !hasTransport`. (También no-op hoy: sin transporte el binding de Android ya es `available:false`.) |
| `StickStatusIndicator` (pill global) | ⚠️ correcto por casualidad | Ya se auto-ocultaba en `'off'`, que hoy es el único estado alcanzable sin transporte. Se hizo explícito (`hasTransport`) para alimentar la vista pura y cubrir el transitorio. |
| Hero de `maniobra/identificar` | ✅ **ya correcto** | `conectable = bleApi?.transport != null` → `ManualPromptHero`. Sin cambios (solo el slot del header, §4 hallazgo c). |
| `TagScanSheet` (hero adaptativo) | ✅ **ya correcto** | Mismo `resolveListenConnState`. Sin cambios. |
| `TagScanCta` | ⚠️ **NO arreglado, a backlog** | Ver §5. |
| `baston-test.tsx` | ✅ **N/A confirmado** | Harness de dev **web-only declarado en su cabecera**, self-contained: monta su propio provider y **construye `new WebSerialAdapter(baud)` directo** → el transporte SIEMPRE existe ahí. No es deliverable de UI ni alcanzable desde producción. |

**Barrida de los call sites de `connect()`** — son **8** en código de producción, no 5 como decía el informe
anterior. La grep vieja (`transport?.connect()\|transport.connect()`) veía solo 5 porque **filtraba por el
receptor `transport`**; la correcta es `\.connect\(` y después clasificar. Los 8, re-medidos ahora (las
líneas del informe anterior también habían quedado corridas por el propio diff):

| call site | ¿alcanzable sin transporte? |
|---|---|
| `maniobra/identificar.tsx:213` · `TagScanSheet.tsx:153` | No — solo cableados al `ConnectHero`, que se renderiza con `listenConn === 'connectable'`. |
| `BleConnectionChip.tsx:54` | No — el chip ya no existe sin transporte. |
| `StickConnectionScreen.tsx:150` · `:161` | No — `if (!transport) return` + CTA oculto (`cta:'none'`) / fila no accionable. |
| `DemoControls.tsx:35` · `:45` | No — `simulator.connect()`, y `simulator` solo existe con `isDemoMode() && api.transport instanceof SimulatorAdapter` (`:30`); además el componente devuelve `null` sin simulador (`:51`) y los callbacks early-returnean. |
| `BleStickListenerProvider.tsx:196` | **Sin defecto, pero no por lo que yo había escrito**: es `manual.connect()`, el adapter MANUAL (el piso de R7), que **siempre existe** y corre FUERA del `if (transport)` (`:199`). No es una afordancia de UI ni toca el transporte — lo cito para que la tabla sea completa, no porque hubiera algo que cerrar. |

(`baston-test.tsx:203` es un noveno, en el harness dev web-only self-contained: N/A confirmado en la tabla.)

**La barrida de copy es la que falló, y por eso ahora es doble.** La primera pasada grepeó solo
`"Conectá el bastón|Conectar bastón"` — vocabulario de *conectar*. Le faltaba el vocabulario de *bastonear*,
que es justo el de `asignar-caravanas` ("Bastoneá para empezar / Pasá el bastón…"). Rehecha sobre
`bastone|pasá el bastón|bastón` en `app/app` + `app/src`: los hits restantes están todos dentro de un
`ConnectHero`/hero gateado, en el harness web-only, o son copy de estados que **solo se alcanzan con
transporte** (el `hint` de `'connected'`, la marca DEMO, el `FindOrCreateOverlay` que solo abre por un tag).

## 4. Hallazgos de la autorrevisión adversarial

Qué busqué: desviaciones del pedido, afordancias muertas que el diagnóstico no listaba, tests que pasan por
la razón equivocada, regresión silenciosa en web, y trampas que exploten en la Fase 4.

**(a) 🟡 La fila del device es una trampa armada para la Fase 4** *(rotulada 🔴 en el informe anterior; el
reviewer tiene razón en que es endurecimiento preventivo, no un defecto vivo: **hoy el cambio es no-op en las
3 plataformas** — Android entra por `available:false`, iOS por `binding === null`, web evalúa `true && true`.
La trampa es real y la cierro igual, pero no es lo mismo que el chip, que Raf chocó de verdad).** `deviceRowView` decidía
`actionable` mirando **solo `binding.available`**, y tocarla llama `transport?.connect()`. Pero son **dos
fuentes distintas**: el `binding` responde *"¿este build sabe hablarle a este lector en esta plataforma?"*
(capacidad de BUILD, `selectReaderBinding` contra `BUILT_ADAPTERS`); el transporte responde *"¿hay un adapter
instanciado ahora?"* (`selectTransportAdapter` + `instantiateTransport`). Hoy en Android coinciden **por
casualidad** (spp-android no está ni en `BUILT_ADAPTERS` ni instanciado). **El día que la Fase 4 agregue
`'spp-android'` a `BUILT_ADAPTERS` sin tocar `selectTransportAdapter`, la fila diría "Tocá para conectar", no
pasaría nada, y toda la suite quedaría en verde.** Es literalmente la clase de bug que quemó a U7 (token mal
escrito → término 0 → fix muerto con la suite verde). Cerrado: `deviceRowView` toma `hasTransport` y sin
transporte cae a `recognized-unavailable` (que es *literalmente cierto*: el build no lo construyó), sin
agregar estado nuevo al union ni tocar `StickDeviceRow`.

**(b) 🟡 Lo encontré MIRANDO LA CAPTURA, no leyendo el código.** El primer render del capture (shot 03) dejó
ver que el vacío de "Lecturas" decía *"Todavía no leíste ninguna caravana. **Conectá el bastón** y bastoneá
un animal."* — mismo defecto, una card más abajo, y ninguna de mis greps de `connect()` lo tocaba porque es
copy suelto en el JSX. Extraído a `readsEmptyHint(hasTransport)` en el módulo puro **a propósito**: que toda
respuesta a "¿esto promete conectar?" se decida y se testee en un solo archivo.

**(c) 🟡 Regresión de layout que el fix se causaba a sí mismo.** El slot `right` de `SpikeSessionHeader`
envuelve al hijo en un `<View>` propio y el `XStack` aplica `gap="$2"` entre **todos** sus items → un
componente que devuelve `null` **no vuelve falsy al elemento**, así que sin el ternario quedaba un **4º flex
item vacío + un gap de más** robándole ancho al nombre del rodeo, que trunca, en la pantalla 🔴 de manga.
(El informe anterior decía "8dp"; **medido**, `$2` de espacio en la escala v4 es **7px** —
`sizeToSpace(size.$2 = 28) = floor(28*0.7 − 12) = 7`, la misma fórmula por la que `$3` da los 13 que ya
estaban verificados en `asignar-caravanas`. Corregido también en el comentario del código y en las specs.) Cerrado con `right={conectable ? <BleConnectionChip /> : undefined}`. **No es una
segunda decisión**: `conectable` es la misma entrada que el chip lee adentro y que ya alimenta el hero
adaptativo dos líneas más abajo. En `(tabs)/animales.tsx` **no hace falta** (el chip es hijo directo →
devolver `null` no crea flex item ni gap) — verificado en la captura 01. Comparar shots 05 y 10: el nombre
del rodeo trunca más tarde sin el chip.

**(d) 🟡 El módulo del chip no era testeable y nadie lo había notado.** `ble-connection-view.ts` importaba
`lucide-react-native` en runtime → **no carga bajo `node:test`** (su barrel ESM solo resuelve dentro de
Metro; falla con `does not provide an export named 'LucideProvider'`). Lo verifiqué ejecutándolo, no
leyéndolo. Por eso el archivo nunca tuvo test y la decisión habría quedado cubierta solo por E2E. Pasado a
**type-only** (el ícono viaja como clave `BleStatusIcon`; `CHIP_ICONS` mapea en el componente) — que es el
patrón que el repo YA usa en `features/ble-stick/connection-view.ts` + `statusIcon()`/`iconFor()`.

**(e) Tests que pasarían por la razón equivocada — falsificados, no asumidos.** El E2E `(a)` ("no hay chip")
pasaría trivialmente si el selector estuviera mal o la pantalla no cargara. **Falsificado en las dos
direcciones**, con rebuild del bundle en cada mutación:

| mutación | (a) sin transporte | (b) con transporte |
|---|---|---|
| guard removido (**el bug vivo**) | ✖ **rojo** | ok |
| `return null` siempre (**sobre-fix, web rota**) | ok | ✖ **rojo** |
| árbol final | ok | ok |

Ídem los unit: neutralizar el corte en los dos módulos puros deja **6 de 22 en rojo** (4 en
`features/ble-stick/connection-view.test.ts` + 2 en `components/ble-connection-view.test.ts`) y los 16 de
regresión en verde. Mutación aplicada y revertida; los conteos son **medidos en esta corrida**, no
estimados (el informe anterior decía 5 de 21 — era correcto entonces, cambió al agregar el test del ícono).

**Falsificación de lo agregado en el fix-loop (`asignar-caravanas`)** — aislada, con los módulos copiados a
un dir temporal (el árbol real nunca quedó mutado):

| mutación | unit `bulk-assign-empty` | E2E |
|---|---|---|
| corte `if (!hasTransport)` neutralizado (**el bug vivo**) | ✖ **4 de 5 en rojo** | — |
| rama "sin bastón" forzada siempre (**sobre-fix**) | ✖ **2 de 5 en rojo** | — |
| `hasTransport = true` literal en la pantalla (**el cableado**) | ok | ✖ **(a) en rojo** (rebuild fresco) |
| árbol final | ok 5/5 | ok 2/2 |

La tercera fila es la que importa y no la cubre ningún unit: prueba que `useBleProviderApi()?.transport` es
**de verdad** `null` en `mode='manual'` y que la pantalla lo consume. Revertida y re-verificada.

**(f) Verificado que NO se rompe nada más**: `useBleProviderApi()` en `StickStatusIndicator` resuelve porque
`BleHost` está dentro de `BleStickListenerProvider` (`_layout.tsx:697` → `:619`) — **leído, no supuesto**. La
firma de `deviceRowView` cambió: único consumidor productivo es `StickConnectionScreen` (typecheck lo
confirma). `BleConnectionView` se exporta del barrel; agregué `BleConnectionEnv` + `BleStatusIcon`.

**(g) 🟡 El ícono de la card era el último elemento fuera de la vista pura** (nit del reviewer, cerrado).
`StickConnectionScreen` derivaba el ícono con un `statusIcon(status)` propio, del **status crudo**, así que
podía contradecir al label (ícono de "conectado" sobre "Bastón no disponible"). **Inalcanzable hoy** —
verificado leyendo el provider: solo suscribe `onStatus` dentro de `if (transport)` (`:199`), así que sin
transporte el único estado posible es `'off'`. Lo cerré igual en vez de anotarlo como límite, porque es
literalmente la misma clase que (a): una decisión de presentación viviendo fuera del archivo donde se decide
y se testea, y el costo de cerrarla es una clave en el view-model. As-built: `ConnectionStatusView.icon`
(`StatusIconKey`) + `STATUS_ICONS` en el componente (solo traduce clave→lucide, que es lo único que no puede
vivir en el módulo puro). El mapeo estado→ícono quedó **fijado en el test de regresión**, así que la mudanza
no pudo cambiar nada en web. La unión se declara en el módulo de spec 04 y NO se importa del chip de spec 09:
son dos view-models independientes, acoplarlos haría que un cambio de vocabulario en uno mueva al otro.

**(h) Multi-tenant / offline-first**: N/A explícito. El diff no toca datos, queries, `establishment_id`, red
ni la outbox. Es presentación pura + una decisión de render. La puerta manual (manual-first, RB8.2/RMV3.6)
queda intacta en todas las superficies tocadas — de hecho **queda más limpia**, porque es la única que se
ofrece. En
`asignar-caravanas` la revisé aparte: el fix **no toca** la cola, el reducer, el `lookupByTag` pre-encolado,
el re-escopeo por cambio de campo ni el encolado offline; el único estado que cambia es el vacío, y el
`establishmentId` sigue viniendo del contexto (nunca hardcodeado). El `hasTransport` no gatea el listener
(sigue siendo `enabled = campo activo && rodeo activo`): si mañana aparece un transporte en caliente, la
pantalla funciona sin remontar.

## 5. Overflow encontrado y NO arreglado (a `docs/backlog.md`)

> **Corrección del informe anterior**: decía que `TagScanCta` era *"el único overflow"*. **Era falso** — se me
> había escapado `asignar-caravanas` (§1-bis), que no era overflow sino una superficie de la misma clase que
> el bug, y encima la más accesible. Ya está cerrada en este fix-loop. Lo que sigue sí queda abierto.

**`TagScanCta`** ("Bastonear la caravana", **4** call sites — no 5, medido: `animal/[id]:984`,
`crear-animal:1318`, `agregar-evento:1579`, `LinkCalfPrompt:517`) renderiza sin mirar el transporte. Lo
evalué y **deliberadamente no lo toqué**: (a) no es una afordancia de *conectar* (no llama `connect()`);
(b) su destino entrega función real sin transporte — el `ManualTagEntry` de adentro del sheet es el **único**
camino para cargar la caravana electrónica en la ficha, así que ocultarlo **quitaría funcionalidad** (es
exactamente lo contrario de `asignar-caravanas`, cuyo destino sin transporte entrega **cero**: por eso ahí la
decisión fue distinta y no contradice a ésta); (c) arreglarlo bien son **dos** decisiones de producto (label
por transporte *y* abrir el sheet directo en manual para no cobrar un tap de más), con blast radius sobre los
4 call sites, el testID `tag-scan-open` y **10 archivos E2E** (6 specs + 4 captures) que asertan ese
texto/testID. Registrado con el análisis completo, no como una nota suelta.

## 6. Deuda heredada registrada (no arreglada, por pedido)

1. **Stash `pressable-sweep-wip`** (67 archivos / 2564 inserciones, en conflicto con HEAD). La entrada
   documenta además que **la premisa del barrido está en disputa y sin dirimir** (el repo dice que el bug
   requiere `pressStyle`; el comentario de la terminal muerta dice que es más general; en el árbol hay 24
   casos en 19 archivos, **ninguno con `pressStyle`** → bajo la primera premisa el barrido entero no arregla
   nada). Recomendación explícita: **no aplicarlo**; en los dos caminos posibles el stash se descarta.
2. **`StickConnectionScreen` = el último `router.back()` pelado de la app.** Entrada nueva + **corregida la
   vieja** (`docs/backlog.md`, barrido `backOr` del 2026-06-04), que lo declaraba excluido "por ser
   territorio de la terminal de BLE" — motivo que ya no existe. Fallback propuesto: `/(tabs)/mas`.
3. `TagScanCta` (§5).
4. **`$textFaint` en texto chico queda bajo WCAG AA** (entrada nueva, fix-loop): 60 usos, varios en 12/13/14px
   regular contra un token declarado como AA-**large** (4.03:1). Encontrado al vetarme el propio copy nuevo.
   Cross-cutting (decisión de DS) → registrado con las dos salidas posibles, no arreglado acá.

## 7. Reconciliación de specs (as-built ≠ lo escrito)

- **`specs/active/09-buscar-animal/requirements-…md` RB8.1** — nota de reconciliación: el chip se muestra
  **solo con transporte instanciado**. (EARS no reescrito.)
- **`…/design-09resto-ble-global.md` §6** — la reconciliación de Run 2 decía literalmente *"En native
  (manual-first) el transporte conectable es `null` → el tap es no-op (el chip queda informativo)"*, o sea
  **describía el defecto como si fuera diseño**. Tachado + bloque nuevo con el as-built (firma, corte antes
  del switch, type-only, slot de `identificar`, testID, falsificación).
- **`…/tasks-…md`** — T7.2 tachado el "En native → no-op"; **T7.3 nueva** `[x]` con el fix y su verificación.
- **`specs/active/04-bluetooth-baston/design-multivendor.md`** — bloque de reconciliación nuevo con las 6
  piezas de esta pantalla (`connectionStatusView`, `deviceRowView`, `TransportInstructions`,
  `readsEmptyHint`, `StickStatusIndicator`, `ConnectionStatusView.icon`) y el razonamiento
  binding-vs-transporte del hallazgo (a).

**Fix-loop (2026-07-29, 2ª pasada)** — reconciliado ANTES de volver al reviewer:

- **`…/design-multivendor.md`** — (1) **corregida la cifra falsa** del bullet de verificación: decía
  *"`connection-view.test.ts` pasó de 10 a 16 casos (los 6 nuevos)"*; **medido**: baseline `d9a3eb0` = **9**,
  hoy = **17** (8 nuevos, contando el del ícono). Las dos cifras del informe anterior estaban mal, no una.
  (2) el bullet de `deviceRowView` ahora declara el **alcance honesto**: hoy es no-op en las 3 plataformas
  (endurecimiento preventivo, no defecto vivo). (3) bullet nuevo de `ConnectionStatusView.icon`.
- **`…/design-09resto-dedup.md` §4.6 (nueva)** — el as-built de `asignar-caravanas`: el caso "sin transporte"
  que el sketch no contemplaba, **la decisión y la alternativa descartada por escrito** (por qué el vacío
  dice la verdad y la fila NO se oculta, y por qué eso no contradice la decisión del chip).
- **`…/requirements-09resto-dedup.md` RD5.2** — nota de reconciliación: RD5.2 se completa con el dispositivo
  sin transporte; **RD5.1 NO se acota** (los dos entry points siguen visibles siempre). EARS no reescrito.
- **`…/tasks-09resto-dedup.md`** — **F5.6 nueva** `[x]` con el fix, la falsificación y los conteos medidos.
- **`…/tasks-09resto-ble-global.md` T7.3** — corregido "10 shots" → **12**, y el "8dp" → la formulación
  medida (flex item vacío + gap `$2` = 7px).
- **`…/design-09resto-ble-global.md`** — mismo fix del "8dp".
- **`docs/backlog.md`** — corregido en la entrada de `TagScanCta`: **4** call sites (no 5) y **10 archivos
  E2E** (no "≥4 specs"), ambos medidos con grep.

## 8. Trazabilidad `R<n> → archivo:test`

| Requisito | Test |
|---|---|
| **RB8.1** (chip existe solo con transporte) | `app/src/components/ble-connection-view.test.ts` :: *"sin transporte: el chip NO se renderiza en NINGUNO de los 6 estados"* · E2E `app/e2e/baston-chip.spec.ts` (a) |
| **RB8.1** (transitorio: transporte desmontado en caliente) | `ble-connection-view.test.ts` :: *"sin transporte gana sobre el status…"* |
| **RB8.2** (refleja el estado, nunca bloquea) | `ble-connection-view.test.ts` :: *"con transporte, los 6 estados devuelven vista…"* + *"solo connected se declara conectado"* · E2E `baston-chip.spec.ts` (b) |
| **RB8.2/RB8.3** (web no se toca) | `ble-connection-view.test.ts` :: *"regresión web: el mapeo estado→(label, ícono, token, connected) no cambió"* · E2E `maniobra-identify.spec.ts` (e) 32/32 |
| **RMV3.4** (estados con CTA, sin transporte no ofrece conectar) | `app/src/features/ble-stick/connection-view.test.ts` :: *"sin transporte: NINGÚN estado ofrece un CTA"* + *"el copy es honesto…"* + *"sin transporte gana sobre el status"* |
| **RMV3.4** (regresión con transporte) | `connection-view.test.ts` :: *"regresión web: CON transporte, los 6 estados quedan EXACTAMENTE como antes"* |
| **RMV3.7** (fila no accionable sin transporte) | `connection-view.test.ts` :: *"sin transporte: un binding available:true NO deja la fila accionable"* + *"NINGÚN estado de fila es accionable sin transporte (4 combinaciones)"* |
| **RMV3.6** (no bloqueante / salida manual siempre) | `connection-view.test.ts` :: asserts `/mano/i` en los subtitles + `readsEmptyHint` |
| **RMV3.4** (el ícono no contradice al label) | `connection-view.test.ts` :: *"sin transporte: el ícono no puede contradecir al label"* + el `icon` fijado en *"regresión web: CON transporte…"* |
| **RD5.2** (vacío honesto sin transporte) | `app/src/utils/bulk-assign-empty.test.ts` :: *"sin transporte: el vacío NO pide bastonear"* + *"…dice la frase canónica y ofrece una salida REAL"* · E2E `app/e2e/asignar-caravanas-sin-transporte.spec.ts` (a) |
| **RD5.2** (regresión: con transporte el vacío no cambia) | `bulk-assign-empty.test.ts` :: *"regresión: CON transporte el vacío queda literalmente igual"* + *"las dos ramas son distintas…"* · E2E `asignar-caravanas-sin-transporte.spec.ts` (b) |
| **RD5.1** (los entry points NO se ocultan) | E2E `asignar-caravanas-sin-transporte.spec.ts` :: `gotoAsignarCaravanasDesdeMas` (`toHaveCount(1)` de la fila + click) en **las dos** condiciones |
| **una sola redacción para "sin bastón"** | `bulk-assign-empty.test.ts` :: *"guard: la frase … es LITERALMENTE la misma en las 3 superficies"* (lee `identificar.tsx` + `TagScanSheet.tsx`) |

## 9. Verificación

### `node scripts/check.mjs` — **RC=0** (output literal, corrida del fix-loop)

```
-- 2. Validando feature_list.json y specs ------------
[OK]    feature_list.json válido (22 features)
[OK]    context.md presente en context_ready; specs presentes en spec_ready+

-- 2b. Higiene de progress/current.md ----------------
[WARN]  current.md parece inflado (0 bloque(s) de sesión, 589 líneas). Al cerrar sesión, mové el resumen a history.md y dejá current.md limpio (AGENTS.md §6).

-- 2c. Lint anti-hardcode (ADR-023 §4) ---------------
[OK]    Anti-hardcode (ADR-023 §4): 0 violaciones en app/app + app/src/components

-- 3. Ejecutando tests -------------------------------
    > node scripts/run-tests.mjs
...
ℹ tests 2532
ℹ pass 2532
ℹ fail 0
<<< client unit tests OK
...
All tests passed.
[OK]    Tests verdes

-- 4. Resumen ----------------------------------------
[OK]    Entorno listo. Podés trabajar.
```

`echo RC` → **`RC=0`**. **2532** unit (eran 2526): +5 de `bulk-assign-empty.test.ts` +1 del ícono. Los dos
archivos nuevos de test están **registrados en la lista explícita de `scripts/run-tests.mjs`** (un test que no
corre da falsa confianza).

**El `[WARN]` de `current.md` es pre-existente** (589 líneas, territorio del leader) y no afecta el RC.
**Alcance declarado: `check.mjs` NO corre E2E** (no tiene una sola referencia a playwright).

**Falso rojo intermedio, registrado por honestidad**: una corrida previa dio RC=1 con 3 fallos de la Edge
Functions suite (`delete_account` T3/T7 + spec 13 R10.2). Los tres devolvían **502 / una página HTML** del
gateway en vez de JSON. Mi diff no toca una línea de backend, la misma suite había dado verde ~40 min antes
en el mismo árbol, y **re-corrida sola dio 42/42 (0 fail, 5 skipped por U9 no deployado)**. Flake de la
plataforma; la corrida final completa es RC=0.

### E2E (`pnpm e2e:build` + playwright) — **NO lo corre el check**

- **Fix-loop, build fresco: 7 specs, 34 tests → 34 passed.** Los 6 BLE de la primera pasada
  (`baston-chip` 2 · `baston-multivendor` 4 · `baston` 4 · `baston-ficha` 3 · `maniobra-identify` 16 ·
  `alta-bastoneo` 3 = **32**) + **`asignar-caravanas-sin-transporte` (nuevo, 2)**. Sin rojos.
- **`animals.spec.ts`: 35 passed / 2 failed.** Los 2 (`delta aptitud (RAR.1.3)`, `delta #15 RCAP.4/RCAP.5`)
  **pasan en aislamiento sobre el mismo build** (re-corridos: 3/3 y 1/1) → flake de la suite completa
  (presión sobre la DB remota compartida / drenaje de outbox), no regresión. Ninguno toca BLE. No me los
  atribuyo, pero tampoco los declaré pre-existentes sin verificar: la evidencia es que verdean solos en mi
  árbol.

### Capture del Gate 2.5 (ADR-029) — **12 shots, 2 passed**

`app/e2e/captures/baston-chip-sin-transporte.capture.ts`
→ `app/e2e/captures/__shots__/baston-chip-sin-transporte/` (gitignored, **no** `git add`).

```
cd app && pnpm exec playwright test e2e/captures/baston-chip-sin-transporte.capture.ts \
  --config playwright.capture.config.ts --workers=1
```

**Las dos pasadas son el punto**: el bug es "hay algo de más", así que una captura sola no dice nada (una
pantalla sin chip se ve igual que una que nunca lo tuvo). Se capturan las **mismas 4 superficies en las 2
condiciones**, para leerlas en pareja:

| # | sin transporte (el Android de Raf) | # | con transporte (web, no se toca) |
|---|---|---|---|
| 01 | header Animales — **sin chip** | 06 | header Animales — **con chip** |
| 02 | pantalla Animales completa | 07 | pantalla Animales completa |
| **11** | **asignar caravanas — vacío honesto** ("Necesitás el bastón / El bastón no está disponible…") | **12** | **asignar caravanas — vacío original** ("Bastoneá para empezar") |
| 03 | `/baston` — "Bastón no disponible", **sin CTA**, fila no accionable | 09 | `/baston` — "Bastón sin conectar" + CTA + fila accionable |
| 04 | header `identificar` — sin chip | — | (ver 10) |
| 05 | `identificar` — hero manual promovido | 10 | `identificar` — con chip + `ConnectHero` |
| — | — | 08 | header con el chip **conectado** (informa de verdad) |

Los shots 11/12 se toman **entrando por la ruta real** (tab "Más" → fila → pantalla), no con un `goto`
directo: la fila es parte de lo que hay que vetar, así que si alguien la escondiera el capture se caería.
(Van antes del `goto('/baston')` en las dos pasadas: esa ruta no tiene tab bar y `gotoTab` no tendría de
dónde agarrarse — lo descubrí porque la primera versión falló ahí, no lo deduje.)

Los `.capture.ts` traen assertions además de screenshots, así que un cambio que rompa el estado esperado los
deja en rojo en vez de sacar una foto equivocada en silencio.

### Higiene

- `design/` **revertido** otra vez (la corrida E2E del fix-loop volvió a re-renderizar los 2 PNGs de
  `maniobra-identify/`: churn de bytes, no cambio visual). `git status design/` limpio.
- **Nada commiteado**, sin `git add -A`. `__shots__/` no stageado (gitignored).
- **CRLF verificado, no asumido**: `git diff --stat` (18 archivos, 513/104) vs `git diff --stat -w`
  (18 archivos, 504/95) difieren en 9 líneas, y las localicé con `git diff --numstat` de los dos: son la
  re-indentación de `ALL_STATES` en `connection-view.test.ts` (un `const` que salió de adentro de un test),
  **no line endings**. Contados en binario, los archivos tocados tienen **0 CRLF**. (Las ediciones por script
  usaron `newline=''` justamente por esto.)
- **Sin mutaciones residuales**: grepeado `if (false)` / `if (true) {` / marcadores de mutación en los 4
  archivos que falsifiqué — limpio. Las mutaciones de la falsificación vivieron en copias del scratchpad
  salvo la del cableado (`hasTransport = true`), que se restauró desde backup y se re-verificó.
- Archivos: **18 modificados** (10 de código/test/script + `docs/backlog.md` + 7 specs) + **6 nuevos**
  (`e2e/asignar-caravanas-sin-transporte.spec.ts`, `e2e/baston-chip.spec.ts`,
  `e2e/captures/baston-chip-sin-transporte.capture.ts`, `src/components/ble-connection-view.test.ts`,
  `src/utils/bulk-assign-empty.ts`, `src/utils/bulk-assign-empty.test.ts`) + este archivo.
  **`(tabs)/mas.tsx` NO se tocó** (es parte de la decisión, §1-bis).

## 10. Lo que me quedó dudoso (para el reviewer / Raf)

1. **⏸ El veredicto real es de DEVICE.** Todo lo verificable en web está verde y el estado "sin transporte"
   se reproduce fielmente con `mode='manual'`, pero **en web el transporte siempre existe**: el
   comportamiento que Raf reportó solo se ve en el Android real. Lo que hay que mirar ahí: (a) que el chip
   **no aparezca** en el header de Animales ni en el de `maniobra/identificar`; (b) que `/baston` diga
   "Bastón no disponible" sin botón; (c) que **"Más" → "Asignar caravanas en masa"** siga apareciendo y la
   pantalla diga *"Necesitás el bastón"* en vez de *"Bastoneá para empezar"*; (d) que la carga manual siga
   intacta en la manga.
2. **`hasTransport` obligatorio evita el olvido, no la mentira.** TS obliga a pasarlo, pero nadie impide
   escribir `{ hasTransport: true }` literal. Consideré un guard estático que lo prohibiera y lo descarté:
   con 4 call sites es más ruido que señal, y hay razones legítimas para pasar `true`. Si el reviewer cree
   que la Fase 4 lo amerita, es un guard de ~20 líneas.
3. **No toqué el patrón `<Pressable>` + Tamagui del chip** (fuera de alcance, prueba de device de Raf
   pendiente). Ojo con la interacción: el chip **conserva** su `<Pressable>` envolvente, así que si el bug de
   taps resulta ser el general, el tap del chip en web/native sigue en la misma situación que antes — el fix
   de hoy no lo mejora ni lo empeora, solo elimina el caso donde ese tap no tenía nada que hacer.
4. **`readsEmptyHint` en el módulo puro** puede leerse como sobre-ingeniería (una función para un string).
   Lo defiendo: es el punto donde la barrida se me escapó una vez, y tenerlo suelto en el JSX es
   exactamente por qué se me escapó. Si el reviewer lo prefiere inline, es un cambio de 2 líneas.
5. **La entrada de "Más" a `/baston` sigue sin cablear** (viene del run multivendor). Hoy solo se llega por
   deep-link. No lo toqué; es lo que hace más filoso el `router.back()` pelado del backlog (§6.2). **Y es lo
   que hizo que se me escapara `asignar-caravanas`**: barrí la pantalla del bastón por ser "la del bastón" y
   no me pregunté qué OTRAS pantallas dependen de él para funcionar. El criterio correcto —el que uso ahora—
   es: *"¿qué superficies quedan sin ninguna entrada de datos si el transporte es `null`?"*. Medido sobre los
   consumidores del listener (`useBleStickListener` + `subscribeTagRead`, 5 archivos fuera de `services/ble`):
   `maniobra/identificar` y `TagScanSheet` tienen entrada manual propia, el `FindOrCreateOverlay` solo se abre
   *por* un tag (sin transporte no existe), y las dos que quedaban —`/baston` y `asignar-caravanas`— están
   cerradas en esta unidad. Si mañana alguien agrega una pantalla que solo se alimenta del listener, el guard
   estático
   de copy **no la va a ver** (solo verifica que la frase no se bifurque). Esa clase sigue sin red: cerrarla
   pediría un guard que enumere los consumidores de `useBleStickListener` sin salida manual — lo evalué y no
   lo hice en este fix-loop porque hay exactamente 1 pantalla en esa categoría y el guard sería más grande
   que el problema. Queda escrito acá para que la decisión sea revisable, no invisible.

6. **Lo que aprendí de este fix-loop, dicho sin adornos.** Dos de las cinco cosas que el reviewer me marcó
   son del mismo tipo: **cifras que escribí sin volver a medirlas** (9→17 y no 10→16; 8 call sites y no 5; 4
   call sites de `TagScanCta` y no 5; `$2` = 7px y no 8). Ninguna cambia una decisión, y justamente por eso
   son peligrosas: son las que nadie chequea. En esta pasada **medí todo lo que afirmo** —conteos con `grep`,
   tests con la corrida, el token con la fórmula del paquete— y donde no pude medir, lo dije. Y la superficie
   que se me escapó no se escapó por falta de tiempo: se escapó porque **elegí el vocabulario equivocado para
   la grep** y no me falsifiqué a mí mismo la barrida. Es lo mismo que le exijo a los tests.
