# Barrido de edge cases del Bluetooth — hallazgos y plan de corrección

**Fecha**: 2026-08-06 · **Pedido de Raf**: *"agregá el pensamiento de edge cases sobre todo lo relacionado al
Bluetooth y andá ejecutándolos para encontrar potenciales bugs durante el flujo de maniobra o búsqueda de
animal… ponete la cabeza en modo productor o peón que no sabe nada de IT."*

**Método**: dos lentes independientes.
- **Barrido de código** (read-only, adversarial): 28 módulos de `services/ble/**`, `features/ble-stick/**`,
  los 7 consumidores, y cruce contra backlog + reviews previos.
- **Ejecución en device**: A07 (SM-A075M) + ESP32 emulando el RS420 por SPP (COM7), APK `d738dbe`.

**Cómo leer las etiquetas**: **[MEDIDO]** = lo ejecuté en el A07 y lo vi. **[LEÍDO]** = verificado en el
código, línea por línea. **[HIPÓTESIS]** = razonamiento sin ejecutar, con el oráculo que lo dirimiría.

---

## 0. Lo que está BIEN — no gastar esfuerzo acá

Verificado por lectura, todo sólido: techo en todo await del puente (`bridge-timeout.ts` + su guard) ·
segunda fuente de verdad del link (`verifyLiveness`, foreground + poll 15 s) · generación de intento +
contador de sesión · dedup por-TAG medida desde la última emisión confirmada · permisos fail-closed con la
distinción `ensure`(gesto) vs `check`(automático) · cortes honestos cuando el UUID o el terminador no son
alcanzables · el presupuesto de la cadena `autoconnect` muere cuando el bastón contesta ·
`forgetRememberedDevice` cableado en los 4 caminos · la fila "Bastón" de "Más" con estado en vivo ·
`backOr` en el chevron de `/baston`.

**Probado en device y está BIEN — no tocar** (tan útil como un hallazgo):
- **El teléfono en el bolsillo NO pierde lecturas.** **[MEDIDO]** Dos escenarios sobre `/baston` con el link
  vivo, contando con la lista de Lecturas de la propia pantalla:
  - **App en background, pantalla prendida**: el bastón emitió 4 → entraron **4/4**, link intacto.
  - **Pantalla APAGADA y teléfono BLOQUEADO** (`mWakefulness=Dozing`): emitió 4 → entraron **4/4**
    (contador 4 → 8 al desbloquear). Android no congeló el hilo JS en esa ventana ni cortó el RFCOMM.
  Cubre el gesto más común de la manga (guardar el teléfono entre animal y animal). **Ojo con el alcance**:
  probé ventanas de ~10 s; el Doze *profundo* (tras ~30 min de inactividad real) no está probado y podría
  comportarse distinto.
- **Ráfaga.** `burst 6` con EIDs distintos sobre `maniobra/identificar`: la primera lectura abre la tarjeta
  de confirmación y las otras 5 **se ignoran sin vibrar** — el gate de escucha (`handleReading` corta en
  `!listeningRef.current` **antes** del feedback). Es el comportamiento correcto para la manga, donde se
  trabaja un animal por vez, y es honesto: no hay confirmación falsa.
- **La tarjeta de confirmación es estable.** Con "Animal nuevo" en pantalla mostrando `982 0003 6469 6062`,
  emití otra lectura: el EID debajo de "Dar de alta" **no cambió**. El peón no puede terminar dando de alta
  un animal distinto del que está mirando. (Era mi sospecha; quedó falsificada.)

**Una nota del backlog quedó FALSA y hay que corregirla**: la ⚪-4 del 2026-07-30 (*"dos escrituras del
device recordado… tocar unos auriculares por error los deja recordados como bastón"*). Ya no aplica:
`onChoosePaired` (`StickConnectionScreen.tsx:280-285`) no persiste nada; quedó una sola escritura, en el
adapter, **después** de que el bastón contestó (fix MEDIUM-2 del Gate 2). El riesgo residual es más chico y
distinto: si el peón toca un device que **sí** acepta RFCOMM (central de auto, OBD, impresora), ese sí queda
recordado y la app le abre un socket en cada apertura.

---

## 1. 🔴 Bloqueantes

### 🔴-1 · El pill tocable se come el CTA primario de la manga — **regresión de hoy, sin commitear**

**[MEDIDO en el A07.]** En el paso 3 del asistente de jornada:

```
'Arrancar jornada' (CTA primario)   [ 34,1242]-[686,1362]
pill 'Bastón conectado'             [220,1244]-[500,1306]   ← CONTENIDO dentro del botón
```

El pill no roza el CTA: está **adentro**. Verifiqué con el build actual (`d738dbe`, pill con
`pointerEvents="none"`) que un tap en el centro exacto del pill (360, 1275) **atraviesa y arranca la
jornada** — que es lo correcto. Con el cambio "pill tocable" que tengo sin commitear, ese mismo tap se lo
lleva `/baston` y la jornada no arranca.

El barrido lo había predicho por aritmética también para el `TagScanSheet` (el CTA "Asignar caravana" cae en
`[safeBottom+106, safeBottom+162]` contra la banda del pill `[safeBottom+104, safeBottom+144]`), y el pill
pinta encima de todo: `BleHost` → `RootGate` → `FindOrCreateOverlay` → `StickStatusIndicator`, último
hermano.

**Segunda superficie 🔴 de manga, [MEDIDA] después**: en la tarjeta "Animal nuevo" de
`maniobra/identificar` (la que sale al bastonear un animal que no existe), el pill queda **adentro** del CTA
`'Dar de alta'` `[34,1246]-[686,1351]` — el botón con el que el peón registra un animal en plena manga.

El reviewer, con una sonda propia en web, midió **tres pantallas más**: `"Ir a Animales"` en Inicio,
`"Eliminar campo (acción destructiva)"` en Más, y tres maniobras tocables en `/maniobra/jornada` etapa 2. En
todas el pill es el elemento *topmost* en su centro.

**Es la misma clase que el bug del `hitSlop` del FAB que arreglamos hoy, en la dirección opuesta**: un
elemento flotante que reclama toques de territorio ajeno. El guard nuevo (`nav-target-bands.test.ts`) fija
**solo** el par pill↔FAB; los footers pegajosos no están en la población. Y el reviewer encontró que ese
guard además **se burla en una línea** (`hitSlop={{...HIT_SLOP, top: FAB_RAISE}}` en el call site deja
30/30 en verde): estaba escrito sobre la forma en que hoy se escribe el bug, no sobre el invariante.

**Resuelto**: el pill vuelve a `pointerEvents="none"` y RMV3.6 queda como estaba. El acceso a `/baston` ya
está cubierto por la fila de "Más" (`1f1c002`) y por el `ConnectHero` que cada pantalla relevante tiene. La
decisión de Raf de hacerlo tocable se tomó sin esta medición; queda anotada en la spec junto con los números,
para que el próximo que lo proponga se encuentre con la evidencia y no con el silencio.

**Conclusión**: la banda de abajo está estructuralmente disputada — cualquier CTA a ancho completo la cruza.
Un pill flotante y tocable ahí no es seguro en ninguna posición del eje x. **No se puede commitear así.**
Ver §3 para lo que hago.

### 🔴-2 · En `maniobra/carga` la lectura **vibra** y no la recibe nadie

**[LEÍDO], los tres extremos verificados sin huecos:**

1. `BleStickListenerProvider.tsx:182-191`: `playFeedback` dispara apenas el candidato es válido — **antes**
   del bucle de despacho y sin mirar si hay suscriptores.
2. El único `useBleStickListener` de `app/maniobra/**` está en `identificar.tsx:197`. `carga.tsx` no tiene.
3. `BLE_OWNED_ROUTES` (`FindOrCreateOverlay.tsx:97`) incluye `'maniobra'` — **el árbol entero**, así que el
   overlay global tampoco la levanta.

Y `dedup.shouldEmit` ya registró el EID, así que ese animal queda quemado 3 s.

**Qué vive el peón**: está cargando el peso del animal en el cepo, el siguiente ya entra, lo bastonea —el
ritmo real de la manga— **y el teléfono le vibra**. La vibración es *la* señal que este producto le enseñó a
interpretar como "entró". No entró: se perdió. Si re-bastonea enseguida, tampoco (dedup).

Un silencio total sería honesto. La vibración es una confirmación falsa sobre un dato perdido — el peor
modo de falla del informe.

### 🔴-3 · `asignar-caravanas` con el bastón desconectado es un pozo mudo sin salida

**[LEÍDO].** Es la única pantalla **BLE-only sin entrada manual** (lo dice su propio comentario, `:139-145`).
El estado vacío se decide solo con `hasTransport` (`bulk-assign-empty.ts:50-68`), que en Android es `true`
siempre — aunque el bastón esté apagado o nunca se haya conectado. Entonces dice *"Bastoneá para empezar"*.
El header no tiene chip (`BleConnectionChip` solo está en `animales` y `maniobra/identificar`) y el pill
global **se auto-oculta en `'off'`**.

El peón bastonea 20 animales y no pasa nada. Cero indicadores, cero mensajes, cero botones, sin carga
manual. La app le pide lo único que no puede hacer, sin decirle por qué.

Es el bug que `bulk-assign-empty.ts` vino a cerrar, pero cerrado contra la dimensión equivocada: preguntó
*"¿hay transporte?"* cuando la pregunta del peón es *"¿está conectado?"*.

### 🔴-4 · Permiso denegado con "no volver a preguntar": el CTA "Reintentar" es un loop perfecto

**[LEÍDO].** `requestMultiple` sobre un permiso con "no volver a preguntar" resuelve al instante con
`never_ask_again`; `classifyPermissionResults` lo colapsa a `denied` → estado `permission_denied` → copy
*"Falta el permiso de Bluetooth (o este equipo no soporta el bastón). Revisalo y reintentá."* → **[Reintentar]**
→ vuelve a resolver al instante → mismo estado. Sin diálogo, sin cambio, para siempre.

Y **no existe ningún camino a los ajustes en toda la app** (grep: sin `Linking.openSettings`, sin
`IntentLauncher`; `expo-linking` solo se usa para deep-links de invitación). "Revisalo" no dice dónde. Un
peón no sabe que Android tiene una pantalla de permisos por app.

Bonus: el copy mete dos hipótesis con acciones opuestas en la misma frase.

---

## 2. La sesión de mañana — **[MEDIDO]**, que es lo que Raf pidió

Tres corridas en el A07 con el ESP32.

**Tope real de la cadena de reconexión**: no son 120 s. El presupuesto acota cuándo se *agenda* un
reintento, no cuánto dura el que está en vuelo (el `connect` tiene techo de 30 s). Medido: el pill
desaparece a **~132 s**. En una corrida el bastón volvió al aire a los 130 s y la app lo agarró a los 133,8 s
— funcionó **por casualidad de timing**.

**Cuando la cadena sí se agota** (bastón vuelve a los 240 s): el pill desaparece, el emulador queda
`link=libre`, y estas son las salidas que tiene el peón:

| lo que intentaría | ¿revive? |
|---|---|
| bastonear (el gesto natural) | **no** — 0 lecturas, cero feedback |
| guardar el teléfono en el bolsillo y sacarlo (background→foreground) | **no** |
| cambiar de tab | **no** |
| cerrar la app y reabrirla | **sí, en 6 s** |

**La app se rinde en silencio y solo revive si la cerrás y la abrís**, y nada se lo dice. El gesto más
natural del campo —el bolsillo— es justo el que no la rescata: `autoConnect()` se llama **una sola vez** al
montar el transporte (`BleStickListenerProvider.tsx:235`), y tras agotarse `cancelReconnect()` mata el
listener de foreground.

**Matiz importante que el barrido aportó y que corrige mi lectura inicial**: el auto-oculto en `'off'` **se
sostiene en 5 de 6 superficies**, porque las pantallas donde el bastón importa tienen su propio hero
adaptativo (`maniobra/identificar` muestra el disco "Conectá el bastón / Tocá para conectar"; el
`TagScanSheet` igual; `animales` tiene chip; "Más" dice "No encontrado"). La excepción es
`asignar-caravanas` → 🔴-3. **No hay que revertir el auto-oculto**; hay que arreglar esa pantalla y agregar
el reintento al volver a foreground.

---

## 3. 🟠 Fricción real

- **🟠-5 · Tocar "Conectá el bastón" sin device recordado no hace NADA** (`adapter-spp-android.ts:778-788`):
  emite `disconnected` sin `connecting` previo y **sin loguear** — el único camino de `doConnect` sin log, así
  que un *"toco y no pasa nada"* del campo no es diagnosticable. Afecta los 3 call sites que llaman
  `connect()` sin argumento: el disco de la manga, el del `TagScanSheet` y el chip de Animales. **Es el
  momento del primer encuentro.** Fix: loguear + que el tap navegue a `/baston` cuando no hay nada recordado.
- **🟠-6 · "Andá a los ajustes de Bluetooth (PIN 1234)" y te suelta**: sin botón que los abra, y **el PIN
  puede ser información falsa** — el propio banco lo midió (`bench_baston-spp-emulador.md:21`: *"No pidió
  PIN: Android 15 lo resolvió con un «¿Vincular?» simple"*). Cinco pasos sin una sola afordancia.
- **🟠-7 · Con 15 emparejados nada distingue al bastón**, y **el guardado no se marca**: `hasRemembered` se
  lee pero se degrada a booleano y solo decide si aparece "Olvidar". Todas las filas salen iguales, con
  triángulo de advertencia. Marcar *"el que usaste la última vez"* es el mejor rendimiento por línea del
  informe.
- **🟠-8 · El "scanner acotado" NO es exclusivo por construcción**: `handleReading:191` despacha a **todos**
  los suscriptores; la exclusividad la sostiene el overlay auto-censurándose. Misma clase que BENCH-3,
  cerrada contra la instancia y no contra el invariante.
  **[MEDIDO] — el camino (a) NO se reproduce.** Con una jornada activa en `maniobra/identificar`, entré a
  `/baston` por deep-link (`rafq://baston`, la jornada queda montada detrás) y bastoneé. La lectura **llegó**
  (`Lecturas (1)`, EID `982000364696063`) y la app **se quedó en `/baston`**: la maniobra no la consumió ni
  saltó a `carga`. Descarté la explicación aburrida (que la lectura no llegara) verificándola en la lista.
  Queda sin probar el camino (b) (`asignar-caravanas` → `crear-animal` → `TagScanSheet`).
  El riesgo estructural sigue existiendo —la exclusividad es una convención, no un invariante— pero **baja
  de prioridad**: hoy no hay un camino demostrado que lo dispare.
- **🟠-8b · El vacío de lecturas de `/baston` contradice a la tarjeta de arriba.** **[MEDIDO]** Con el bastón
  conectado y sin lecturas todavía, la pantalla dice a la vez *"Bastón conectado"* (tarjeta) y *"Todavía no
  leíste ninguna caravana. **Conectá el bastón** y bastoneá un animal"* (vacío). `readsEmptyHint()`
  (`connection-view.ts:302-306`) mira solo `hasTransport`, no el estado de conexión — el mismo error de
  dimensión que 🔴-3. Fix de una línea: que reciba el `status`.
- **🟠-9 · Tocaste el device equivocado**: cadena `operator` **sin tope** martillando esa MAC cada 8 s,
  `scanning` sin CTA, y "Olvidar" no aparece porque nunca se persistió nada. Cero botones en pantalla. El
  fundamento con el que se decidió dejar `scanning` sin CTA (*"el operario está tratando de conectar"*) **no
  cubre este caso**. Fix barato: que el copy nombre el target — *"Reintentando con JBL Tune 510. Si no es el
  bastón, elegí otro de la lista."*
- **🟠-10 · Primer arranque**: la app dice *"Se apagó, quedó fuera de rango o cancelaste"* sobre un bastón
  que nunca se eligió. Las tres explicaciones son falsas. Es el gemelo del bug que `autoConnectExhausted`
  resolvió para `'off'`: `'disconnected'` también necesita dos copys según la historia.

---

## 4. 🟡 Mejoras

- **🟡-11 · En device el feedback es SOLO una vibración de 50 ms.** El beep es un no-op declarado en native
  (`feedback.ts:92-93`), `writeBeepEnabled` **no tiene un solo call site**, y `readBeepEnabled()` se llama en
  **cada lectura** (un cruce de `SecureStore` por bastonazo) para alimentar un flag que no hace nada. R4.2 y
  R4.3 no están cumplidos en device. Con guante, bolsillo y ruido de manga, 50 ms se pierden.
- **🟡-12 · "No entró" no tiene señal**: trama corrupta, re-lectura dentro de los 3 s, bastón mudo y "no
  apretaste bien el gatillo" producen exactamente el mismo silencio. El peón no puede aprender del producto.
- **🟡-13 · La ventana de dedup es global al provider y nunca se resetea** (`engine.reset()` sin call site):
  cruza pantallas y flujos. Un cambio de pantalla es, para el peón, "empezar de nuevo".
- **🟡-14 · `enabled` del listener es un booleano global last-writer-wins** entre 3 consumidores, sin
  contador — a diferencia de `scopedCount`, que sí lo tiene y documenta por qué.
- **🟡-15/16**: rama de copy inalcanzable en `ScanHero`; `onChooseDevice` persiste un `vendorId` en vez de una
  MAC (hoy inalcanzable en Android).

---

## 5. Plan de corrección — orden de ataque

| # | qué | por qué primero |
|---|---|---|
| 1 | **🔴-1** — resolver el pill antes de commitear | es una regresión **sin commitear** que rompería el camino feliz de la manga |
| 2 | **🔴-2** — no disparar feedback sin consumidor | dato perdido con confirmación positiva |
| 3 | **🔴-3** — `bulkAssignEmptyView(hasTransport, status)` | una función pura + un CTA; reusa `resolveListenConnState` |
| 4 | **🔴-4 + 🟠-6** — `Linking.openSettings()` + intent de ajustes BT | el mismo fix técnico cierra los dos pozos del primer encuentro |
| 5 | **§2** — reintento capado al volver a foreground con `autoConnectExhausted` | cubre "prendí el bastón después de guardar el teléfono" |
| 6 | **🟠-5 + 🟠-10** — connect sin target: loguear, navegar, y copy propio | destraban el primer día |
| 7 | **🟠-7** — marcar el bastón guardado en la lista | mejor rendimiento por línea |
| 8 | **🟠-8** — exclusividad real en el dispatch | es un invariante; hacerlo antes del cuarto consumidor |

**Decisión de producto pendiente de Raf (no la tomo yo)**: 🟡-11 — ¿el producto se queda sin sonido de
confirmación en la manga? Hoy no hay beep en device y no hay UI para configurarlo.

---

## 6. Lo que NO pude verificar

| qué | oráculo |
|---|---|
| 🔴-1 sobre el `TagScanSheet` (medí el asistente de jornada, no el sheet) | abrir la ficha → "Bastonear la caravana" → leer → tocar "Asignar caravana" |
| 🟠-8 (a) doble consumo `/baston` + `identificar` | jornada activa → tocar el pill → bastonear en `/baston`; si salta a `carga`, confirmado |
| 🟠-8 (b) doble consumo `asignar-caravanas` + `TagScanSheet` | bastonear dentro de `crear-animal` y ver si el EID quedó en la cola masiva |
| ~~Lecturas con la pantalla apagada~~ | **CERRADO — anda. Ver abajo.** |
| Todo lo de iOS | no hay adapter todavía (placeholder gateado) |

---

## 7. Cómo verificar el feedback sensorial EN DEVICE sin oír ni sentir nada

Descubierto el 2026-08-06 preparando la verificación de la unidad de sonido. Tres de las cuatro preguntas
que parecían "solo las contesta un humano" son **medibles por adb**, porque Android registra lo que
efectivamente reprodujo:

**Vibración** — `adb shell dumpsys vibrator_manager` guarda historial **por app** con el patrón real:

```
07-30 06:10:11.924 | effect | finished | duration: 57ms | usage: TOUCH
  | ar.rafq.app (uid=10276) | played: Step=50ms(amplitude=-1.00)
```

Ese `played:` es el oráculo. Baseline registrado del APK previo al sonido: `Step=50ms`, que es el
`Vibration.vibrate(50)` de siempre.

**Audio** — `adb shell dumpsys audio` tiene `Events log: playback activity as reported through PlayerBase`
con entradas `player piid:N event:started`, más las listas `ducked players` y `faded out players`.

| pregunta | oráculo |
|---|---|
| ¿el beep suena en **cada** bastonazo? (el bug del 2.º en adelante) | contar `event:started` de nuestro piid contra N lecturas emitidas por el ESP32 |
| ¿los dos patrones hápticos **difieren**? (R4.8 / 🟡-12) | comparar el campo `played:` de la lectura aceptada vs. la rechazada |
| ¿el audio **interrumpe** otras apps? (la radio del peón) | `ducked players` + estado de otros players mientras suena |
| ¿se **oye** con ruido real y se **distingue** con guante? | **irreducible: humano.** Es de Raf o del peón. |

Vale la pena porque convierte "el reviewer encontró que los dos patrones podrían colapsar" en un hecho
verificable: si en el log salen idénticos, el defecto está vivo en hardware y no hay nada que discutir
sobre guantes.
