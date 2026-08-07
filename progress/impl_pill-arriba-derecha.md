# impl — «el indicador del bastón sale de la banda de los CTA»

baseline_commit: e63c5bf3c9b7d05454440951a655cf734b71e20a

> Unidad del 2026-08-06, feature 04 (delta multivendor), RMV3.5. Pedido de Raf: *"siento que el pill de
> «Conectando…» o «Reconectando…» estorba demasiado en esa parte de la pantalla… ¿se puede mover?"*.
> **Nada commiteado.** Ningún build de EAS. No se tocó el device (campaña de QA en el A07 en exclusiva).

---

## 0. Veredicto en una línea

**Hecho: el indicador salió de la banda de los CTA.** Vive arriba a la derecha, **debajo** de la fila del
header, como un **círculo permanente** que **se estira a pill** cuando el estado cambia y vuelve solo. Más
la mitad que ya estaba: no se dice dos veces lo mismo en una pantalla.

Esta unidad tuvo **dos pases**. En el primero reporté BLOQUEADO el movimiento con la medición que lo
sostenía (§3: la esquina superior derecha es el slot de la acción secundaria y está ocupada en la home, en
`/maniobra`, en mis-campos, en `lote/[id]` en selección y en TODO el flujo de manga). Raf resolvió el
bloqueo con una forma que no estaba en mis cuatro opciones —círculo que se estira— y el leader agregó dos
correcciones que resultaron ser las que hacen que funcione: **anclarlo DEBAJO de la fila** (no adentro) y
**que el estado no viaje solo por color**. §3 queda como está: es la evidencia de por qué el anclaje es el
que es.

## 1. Lo que SÍ se entregó (punto 2 del pedido, completo)

**El estado del bastón se dice una sola vez por pantalla**, y quién se calla NO se decide con una lista de
rutas.

| Archivo | Qué |
|---|---|
| `app/src/services/ble/stick-status-surface.ts` (nuevo) | Store observable de módulo: `claimStickStatusSurface(kind)` → `release()`, snapshot inmutable y estable, `useStickStatusSurfaceClaimed()`. Mismo patrón que `powersync/upload-rejections.ts`. |
| `app/src/hooks/useStickStatusSurface.ts` (nuevo) | El hook de RECLAMO. Vive aparte porque es lo único que necesita `expo-router` — un paquete que `node:test` no puede cargar (`SyntaxError: Unexpected token 'typeof'`, verificado), y el store tiene que quedar testeable. |
| `app/src/components/BleConnectionChip.tsx` | Reclama `'header-chip'` **solo cuando se pinta** (`view !== null`): sin transporte no renderiza, y reclamar sin pintar apagaría el chrome a cambio de nada. Cubre `(tabs)/animales` y `maniobra/identificar`. |
| `app/src/features/ble-stick/screens/StickConnectionScreen.tsx` | Reclama `'screen-card'`. |
| `app/src/features/ble-stick/components/StickStatusIndicator.tsx` | Lee el reclamo. **Se le sacó el literal `pathname === '/baston'`** (y el `usePathname`). |

**Por qué reclamo y no lista de rutas** (lo pidió el brief y además ya nos mordió): una lista de literales es
la clase de `BLE_OWNED_ROUTES` — la propiedad de una pantalla escrita como string en otro archivo. Mover
`app/baston.tsx` o renombrar la ruta la rompe **en silencio**: el indicador vuelve a duplicar sobre la card y
nada se pone rojo. Este mismo delta ya había descartado esa forma para el scanner acotado (reconciliación de
RMV3.1) y sin embargo la tenía puesta acá. Ahora la declara el dueño.

**Por qué FOCO y no montaje** — el bug que el mecanismo obvio habría introducido: las tabs visitadas quedan
montadas el resto de la sesión y las pantallas del stack quedan montadas al navegar encima. Con un
`useEffect`, entrar **una** vez a "Animales" habría dejado el reclamo vivo → **el indicador global apagado en
TODA la app, sin un solo síntoma**. Va con `useFocusEffect`. Costo declarado: `useFocusEffect` corre en la
fase pasiva, así que al navegar A una pantalla que reclama el indicador puede quedar visible **un frame**
(antes, con el literal de ruta, no había ese frame; es el precio de no depender del nombre de la ruta).

**`mas.tsx` NO reclama, y está declarado en el registro con su motivo**: la fila "Dispositivos → Bastón"
muestra el estado en vivo, pero es una fila de lista a media pantalla, no un indicador de pantalla, y el
indicador —anclado abajo— ni la tapa ni la repite en el mismo golpe de vista. **Si el chip se mueve arriba a
la derecha, esa entrada pasa a `reclama: true`** (ahí sí quedarían dos "Conectado" en la misma pantalla). El
guard obliga a que esa decisión esté escrita, no omitida.

### Guards (los dos en la lista explícita de `scripts/run-tests.mjs`)

- `stick-status-surface.test.ts` (**10 casos**): las reglas del store — dos superficies reclamando a la vez
  (pasa de verdad: en un stack la de abajo sigue montada), liberación en cualquier orden, idempotencia,
  y **snapshot estable por identidad** (sin eso `useSyncExternalStore` re-renderiza infinito y tumba la app;
  es un bug de runtime que ningún typecheck ve).
- `stick-status-surface-guard.test.ts` (**13 casos**), escrito **sobre la ausencia**: la población son los
  call sites de `useBleConnectionStatus()` —la única fuente del estado en la app— y cada uno tiene que estar
  en el registro declarando si reclama y por qué. Más: **(C)** el indicador no puede volver a gatear por ruta
  (`usePathname` / `useSegments` / `'/baston'` / `BLE_OWNED_ROUTES`); **(D)** el reclamo tiene que colgar de
  `useFocusEffect` y el store no puede importar `expo-router`; **(E)** nadie llama la primitiva imperativa
  salteándose el hook; inversos de registro (sin entradas muertas) y auto-verificación de cobertura de escaneo.

### Mutantes (lanzados y medidos, no estimados)

| # | Mutante sobre el árbol real | Resultado |
|---|---|---|
| M1 | sacarle el reclamo al `BleConnectionChip` | MUERTO — (B) |
| M2 | devolver `pathname === '/baston'` al indicador | MUERTO — (C) + el caso de falsificación |
| M3 | reclamo por MONTAJE (`useEffect`) en el hook | MUERTO — (D) |
| M4 | superficie nueva (`useBleConnectionStatus()` en `Card.tsx`) sin registrar | MUERTO — (A) |
| M5 | `claimStickStatusSurface()` imperativo desde `mas.tsx` | MUERTO — (E) |
| M6 | reclamo en `reportes.tsx` sin registrar | MUERTO — (E-bis) |
| M7 | el registro miente (mas.tsx reclama y el registro dice que no) | MUERTO — (B) |
| M8 | el store importa `expo-router` (se sale de node:test) | MUERTO — (D-bis) |
| **M9** | **el hook con `useEffect`, contra la E2E** (build web mutado + corrida real) | **MUERTO — la E2E falla EXACTAMENTE en el tramo de la vuelta (línea 109), con todo lo demás en verde** |

M9 es el que importa: prueba que el modo de falla peor (el reclamo pegado que deja el chrome mudo toda la
sesión) **habría entrado con los otros 8 guards y las otras aserciones de la E2E en verde**.

---

## 1-bis. El segundo pase: la forma nueva (círculo ↔ pill, arriba a la derecha)

| Archivo | Qué |
|---|---|
| `app/src/features/ble-stick/indicator-morph.ts` (+ `.test.ts`, **8 casos**) | **CUÁNDO** se estira. Puro, con reloj inyectado. |
| `app/src/features/ble-stick/components/StickStatusIndicator.tsx` | Reescrito: anclaje nuevo, dos formas, ícono como canal de estado, copy corto. |
| `app/src/hooks/useReduceMotion.ts` (nuevo) | La preferencia de accesibilidad, extraída para el segundo consumidor (la app ya la respeta en `Skeleton`). |
| `app/src/components/GroupViewScreen.tsx`, `app/maniobra/_components/SpikeIdentityHeader.tsx`, `app/(tabs)/reportes.tsx` | Reclaman la banda (`'screen-band'`) porque ya la usan. Uno de los tres lo encontró el sondeo E2E, no la lectura. |

**Geometría (derivada, no elegida a ojo).** `top = insets.top + $3*2 + $avatar`, `right = $4`, contenedor a
ancho completo con `alignItems="flex-end"`. El alto de la fila del header sale de sus propios tokens (su
`paddingVertical` `$3` ×2 + el elemento más alto que vive ahí, `$avatar`) → si el avatar cambia de tamaño,
el indicador lo sigue. El círculo mide `$navIcon + $2*2 + borde` = 40, derivado del CONTENIDO: no es un
target, así que su tamaño no puede salir de `$chipMin` (el guard lo exige).

**El morph, y el parpadeo que no ocurre.** Se anuncia por **clase de noticia**, no por `ConnectionStatus`
crudo: `connecting` y `scanning` son la misma clase, así que el ciclo del backoff —que dura minutos— es
**un solo aviso**. Y una misma clase no se repite antes de 8 s (el link que titila; el `flap` del banco).
Medido en el test: 20 vueltas de `connecting`↔`scanning` → **1 anuncio**. La animación es `withTiming` de
220 ms sobre el ancho (reanimated, el idiom del repo), y con **reduce-motion** salta al valor final.

**El estado no viaja solo por color**: lo lleva el ícono (`iconFor`) y el color refuerza. Lo fija
`(D-color)` del guard — si el mapeo `status → ícono` deja de discriminar, rojo.

### Los guards de banda (lo que pidió el leader, con los números)

- **Abajo quedó VACÍA, y declarada**: `BOTTOM_BAND_TENANTS_EXPECTED = 0`. `(B-banda)` compara la población
  real contra ese número **y** ejercita el medidor contra un inquilino SINTÉTICO en cada corrida (uno que
  despeja el FAB y otro anclado a su pico, que tiene que detectar). Así "no hay a quién mirar" y "el
  resolvedor se rompió" dejaron de verse igual. El modelo puro pasó de `stickPillBand` a
  `bottomAnchoredBand` (+ campos `tenant*`): el invariante es de la BANDA, no del inquilino que se fue.
- **Arriba nace vigilada**: `(F1)` registro por mención de la reserva superior · `(F1-bis)` solo `top` y la
  familia `padding` son props que el guard sabe medir, el resto nace en rojo · `(F-banda)` el anclaje
  RESUELTO del fuente tiene que dar `reserva + $3*2 + $avatar` en las **4 reservas superiores reales**
  (web 0 · Android 24 · notch 47 · Dynamic Island 59) **y depender** de la reserva · `(F-inverso)` sin
  entradas muertas. El dropdown del switch de campo (que se ancla con un valor MEDIDO y por lo tanto es
  invisible para cualquier análisis estático) está enumerado a mano en el registro, con su motivo.

### Mutantes del segundo pase: **10 lanzados, 10 muertos** (base 75 ok)

| # | Mutante | Muere en |
|---|---|---|
| Ma | re-anclar el indicador ABAJO, en la banda del FAB | (B2) + (E-bis) |
| Mb | superficie NUEVA anclada en la banda del FAB | (B1) |
| Mb2 | inquilino de la banda inferior sin declarar la cuenta | (B-banda) |
| Mc | superficie NUEVA en la banda de ARRIBA | (F1) |
| Mc2 | el indicador metido DENTRO de la fila del header | (F-banda) |
| Mc3 | anclaje superior con número fijo (ignora el notch) | (F-banda, `dependsOnReserve`) |
| Md | resolvedor de la banda inferior roto | modelo puro (5 casos) |
| Md2 | declarar 1 inquilino donde hay 0 | (B-banda) |
| Me | el ícono deja de llevar el estado (solo color) | (D-color) |
| Mf | el backoff vuelve a parpadear | morph (1) |

**Mc sobrevivió a la primera vuelta** y se cerró: la reserva superior leída EN LÍNEA
(`top={useSafeAreaInsets().top + 70}`), sin pasar por un `const`, esquivaba la firma. Era la misma
alternativa que el guard de abajo ya tenía y a la de arriba le faltaba.

### Dos defectos los encontró la CAPTURA, no un test

Y los dos habrían llegado a Raf:

1. **La pill se estiraba FUERA de la pantalla** ("Conectado" cortado contra el borde): con el contenedor
   anclado `right={$4}`, tomaba el ancho del hijo COLAPSADO (40) y el ancho animado no lo re-dimensionaba
   → la pill crecía hacia la derecha. Arreglado con contenedor a ancho completo + `alignItems="flex-end"`.
2. **El texto se COMPRIMÍA en vez de quedar tapado**: la fila medía 84 px donde el contenido pide 113
   (`onLayout` sobre un hijo que el clipper apretaba) → el destino de la animación quedaba corto y el texto
   salía cortado *dentro* de la pill. Arreglado con `flexShrink={0}` en la fila **y** en el texto; medido
   después en el navegador: 63,5 → 111,9 → **115,2 estable**.

La red que quedó (porque un veto visual no corre en cada commit): la E2E espera a que el estirado TERMINE
y el oráculo es **`scrollWidth <= clientWidth`** (nada recortado) + el borde derecho dentro del margen. La
primera versión asertaba "más ancho que alto", que ya es cierto a los 60 ms de una animación de 220 — y por
eso dejó pasar las dos fotos malas.

### El sondeo de la banda (el guard de runtime que pidió el leader)

`e2e/baston-indicador-unico.spec.ts` lista, en cada pantalla visitada, lo que quede pintado bajo el
círculo: **controles** por su caja, **textos** por sus renglones reales (`Range.getClientRects`) y todo
confirmado con **hit-test** (`elementFromPoint`). Las dos refinaciones no son cosmética — cada una salió de
un falso positivo medido:

- la CAJA de un `<Text>` a ancho completo con las letras a la izquierda (el label "Perfil" de "Más")
  cruzaba el indicador con sus glifos a 300 px de distancia;
- react-navigation deja la tab anterior MONTADA: el buscador de "Animales" se reportaba como víctima
  estando en Inicio (y `checkVisibility` no lo cazaba).

Auto-falsificado in-place: se inyecta un texto dentro de la caja del indicador y se exige que el sondeo lo
encuentre. Resultado medido en 3 pantallas (Inicio · Más · alta): **círculo en `{top:66,left:354,40×40}`,
sin víctimas** en las tres.

**Límite declarado**: el sondeo mira texto y controles. Un elemento puramente GRÁFICO (los puntitos del
"Paso N de 4") no lo reporta — ese caso lo medí aparte con Pillow y con la captura 06: en el alta el
círculo queda **por debajo** de los puntos y no los toca (esa pantalla tiene la fila del header más baja
que la home, que es la que define el anclaje).

## 1-ter. El tercer pase: la banda se verifica contra el RANGO, no contra el fixture

**El leader tenía razón y mi medición era una conclusión falsa.** El sondeo dio la banda "libre" en la home
midiendo un usuario que se llama **"E2E"**: el saludo terminaba en x≈215 y sobraba lugar. El saludo
(`¡Hola {nombre}! 👋`, `$9` = 30 px, bold, **sin `numberOfLines`**) crece con el nombre del usuario, que el
producto acepta hasta `NAME_MAX_LENGTH`. Medí el rango:

| Nombre (primer token) | Renglón 1 llega a | ¿Invade la banda `x=[354,394] y=[66,106]`? |
|---|---|---|
| "E2E" (el fixture viejo) | x≈215 | no — y por eso la medición dio libre |
| **14 caracteres** | **x=355, y=[85,121]** | **SÍ** |
| 80 (el tope del producto) | envuelve: renglones a x=377/384/390, en y≥123 | no (caen por debajo de la banda) |

**El peor caso no es el nombre más largo.** Con 80 el texto envuelve y sus renglones largos quedan por
DEBAJO de la banda; el que choca es el que llega justo antes de envolver (~13-20 caracteres) — o sea un
nombre perfectamente común. Buen recordatorio de que "peor caso" es el peor para la GEOMETRÍA, no el valor
máximo del campo.

**Qué hice y por qué.** De los dos caminos que planteó el leader elegí un tercero, que es el que no pierde
nada:

- **Que la home reclame la banda** — descartado: perdemos el indicador justo en la pantalla donde el
  operario abre la app y ve "Conectando…", que es el escenario que originó todo esto.
- **Truncar/encoger el saludo** — descartado por lo que él mismo marcó: cortar un nombre propio a 30 px
  degrada la bienvenida.
- **RESERVAR** (elegido): el saludo lleva `paddingRight={stickIndicatorBandReserve()}`. El nombre se
  conserva **entero** y, si no entra, el saludo **envuelve** — que es lo que un saludo puede hacer sin
  perder información. Verificado en la captura 04 con "Maximiliano-José": envuelve en dos renglones, la
  pill tiene su carril y no se toca nada. Medido después de la reserva: el renglón de 14 caracteres pasó de
  **x=355 → x=343** (la banda arranca en 354).

El número **no es una copia**: sale de `stickIndicatorBandReserve()` (nuevo
`features/ble-stick/indicator-geometry.ts`), que es el mismo módulo del que el componente saca el diámetro
del círculo. Si el indicador cambia de tamaño, la reserva lo sigue sola.

**Límite declarado**: la reserva cubre el **círculo** (la forma permanente), no la pill estirada — que
vive 4 s y, con un nombre largo, puede rozar el saludo en ese rato. Reservar ~115 px permanentes para un
aviso transitorio le cobraría a la pantalla el ancho del peor momento.

### El barrido del mismo riesgo en las otras dos (lo que pidió el leader en su punto 2)

Cambié los fixtures del sondeo a **peor caso** —usuario `Maximiliano-José` (16, un solo token: es el largo
que choca), campo `Establecimiento La Constancia de los Cerrillos`, rodeo `Rodeo de cría vaquillonas de
reposición`— y volví a correr las tres pantallas: **círculo en `{top:66,left:354,40×40}`, sin víctimas en
Inicio, Más y alta**. En "Más" y en alta lo que vive en la banda es texto FIJO (el label "Perfil"; el
"Paso N de 4" y la pregunta del paso), así que no crece con los datos; los textos variables de esas
pantallas (nombre del campo, del rodeo, del animal) están por debajo de la banda.

### La atadura (punto 3)

Tres detectores, y los tres se ponen rojos con el mismo mutante ("sacarle la reserva a la home"):

1. `e2e/baston-indicador-banda-peor-caso.spec.ts` — mide los **renglones reales** del saludo contra la
   banda derivada de los tokens, con dos nombres, y el tope sale de **`NAME_MAX_LENGTH` importado de
   `validation.ts`**: si el producto acepta nombres más largos, el test mide el rango nuevo sin que nadie
   lo toque.
2. El sondeo de la banda, con el fixture de peor caso (16 caracteres).
3. `(F-reserva)` en el guard estático: la home tiene que **importar** `stickIndicatorBandReserve` y usarla
   en el `paddingRight` — una copia numérica (`paddingRight={47}`) no pasa.

**Lo que NO es expresable estáticamente, y lo digo en vez de fingirlo**: "ningún texto que pueda crecer
comparte la banda" no se puede decidir leyendo el fuente — hace falta layout, y el largo del dato es de
runtime. El mecanismo ejecutable es el fixture de peor caso del sondeo; su límite es que solo cubre las
pantallas que la spec visita (hoy 3). Una pantalla nueva con un texto grande pegado al header **no nace en
rojo**: la caza el sondeo si alguien la agrega a la lista, o el veto visual. Es el hueco real del
mecanismo y prefiero dejarlo escrito acá que descubrirlo en producción.

## 2. Trazabilidad

| Requisito | Cubierto por |
|---|---|
| **RMV3.5** — el indicador global existe y refleja el estado | `e2e/baston-indicador-unico.spec.ts` (tramo a: visible en una pantalla sin superficie propia) · `e2e/baston-multivendor.spec.ts` (a–f) · `connection-view.test.ts` |
| **RMV3.5 (as-built nuevo)** — es el FALLBACK: se calla donde hay superficie propia | `e2e/baston-indicador-unico.spec.ts` (tramo b, `count 1`) · `baston-multivendor.spec.ts` (c) para `/baston` · `stick-status-surface-guard.test.ts` (A)(B)(C) |
| **RMV3.5 (as-built nuevo)** — la supresión no depende del nombre de la ruta | `stick-status-surface-guard.test.ts` (C) + M2 |
| **RMV3.5 (as-built nuevo)** — el reclamo se libera al perder el foco | `e2e/baston-indicador-unico.spec.ts` (tramo c) + M9 · `stick-status-surface-guard.test.ts` (D) + M3 |
| **RMV3.5 (as-built 2.º pase)** — vive arriba a la derecha, DEBAJO de la fila del header | `tap-target-collision-guard.test.ts` (F-banda) en las 4 reservas superiores + (D) tokens · `e2e/fab-target-geometry.spec.ts` (2a/2b: dejó la banda del FAB y aterrizó donde el modelo dice) |
| **RMV3.5 (as-built 2.º pase)** — no le cae encima a nada legible | `e2e/baston-indicador-unico.spec.ts` (sondeo de banda en 3 pantallas + auto-falsificación) · capturas 01-07 |
| **RMV3.5 (as-built 2.º pase)** — dos formas: círculo permanente ↔ pill al cambiar | `indicator-morph.test.ts` (8) · `e2e/baston-indicador-unico.spec.ts` (reposo = círculo; estirada = sin recorte y dentro del margen) · capturas 01/02 y 04/05 |
| **RMV3.5 (as-built 2.º pase)** — el backoff NO parpadea | `indicator-morph.test.ts` (2): 20 vueltas `connecting`↔`scanning` → 1 anuncio + Mf |
| **RMV3.5 (as-built 2.º pase)** — el estado no viaja solo por color | `tap-target-collision-guard.test.ts` (D-color) + Me |
| **RMV3.5 (as-built 3.er pase)** — el contenido que puede CRECER no queda debajo del indicador | `e2e/baston-indicador-banda-peor-caso.spec.ts` (2 nombres, tope importado de `validation.ts`) · sondeo con fixture de peor caso · `tap-target-collision-guard.test.ts` (F-reserva) · los 3 rojos con el mutante "sin reserva" |
| **RMV3.6** — no bloqueante, el indicador no es tocable | intacto: `tap-target-collision-guard.test.ts` (E) + `e2e/fab-target-geometry.spec.ts` (el indicador nunca es *topmost* en su centro; 2/2 verde) |

**Gate 2.5 (ADR-029)**: `app/e2e/captures/baston-indicador-unico.capture.ts` — corrido, **8 shots** a
`deviceScaleFactor: 3` en `__shots__/baston-indicador-unico/` (gitignored), con **las dos formas en 3
pantallas** y **con un nombre de usuario largo real** (`Maximiliano-José`, no el "E2E" benigno):
`01-mas-pill-expandida` · `02-mas-circulo-en-reposo` · `03-banda-header-mas` (el aire contra la fila) ·
`04-inicio-pill-expandida` (la pantalla con la fila del header LLENA: switch · RAFAQ · avatar) ·
`05-inicio-circulo-junto-al-saludo` · `06-alta-circulo-caso-apretado` (contenido pegado arriba) ·
`07-animales-el-chip-manda` (la supresión) · `08-mas-roce-con-la-card-ampliado` (el recorte ampliado que
pidió el leader para vetar el único contacto que queda). La ausencia de un elemento no se ve en una foto
suelta: **07 se lee contra 01/02**. Cada shot asserta su premisa antes de dispararse (forma, no-recorte, no-superposición),
así que una captura no puede documentar algo que dejó de ser cierto.

Se reconcilió además `e2e/captures/fab-hitslop-pill.capture.ts` (de la unidad anterior): su shot 06
asertaba que el pill se superponía a "Ir a Animales" — ahora asserta lo contrario y se llama
`06-el-indicador-ya-no-pisa-el-cta-de-inicio`. La aserción se dio vuelta en vez de borrarse: si el
indicador vuelve a caer sobre un CTA, esa captura se pone roja.

---

## 3. EL BARRIDO DE LA ESQUINA (la medición que decidió el anclaje)

**Método.** Población = los 39 archivos que anclan un header al inset superior (firma estable:
`paddingTop={insets.top}` / `paddingTop: insets.top`), leídos uno por uno. Sobre esa población vale una
propiedad de layout que hace el barrido confiable y no una impresión: **en una fila de flexbox los hijos se
empaquetan a la izquierda; algo llega al borde DERECHO solo si la fila usa `justifyContent` o tiene un hijo
flexible que absorbe el sobrante.** Después medí en renders reales (Pillow sobre capturas @412×915; en web
`insets.top = 0`) para no quedarme en "lo leí".

### 3.1 Los títulos: la premisa se sostiene

Todos los títulos de header van a la izquierda y **truncan** (`flex:1` + `numberOfLines={1}`) o son cortos;
ninguno llega al borde derecho. El veto viejo del Gate 2.5 (2026-07-20) fue contra un pill **centrado y a
ancho completo**, y no aplica a un chip compacto a la derecha. Hasta ahí, Raf tiene razón.

### 3.2 Lo que sí está en la esquina (lo medido)

El chip compacto REAL —el `BleConnectionChip`, que es el mismo componente que se movería— mide, con su copy
más largo y renderizado de verdad: **x=[248,393], y=[13,48]** (146 × 35 px, borde derecho a 19 px = `$4`).
Ese es el rectángulo que hay que comparar contra cada esquina:

| Pantalla | Qué hay en la esquina | Interactivo | Evidencia |
|---|---|---|---|
| **`(tabs)/index` (HOME)** | avatar de usuario (`$avatar` = 40) **y la fila está LLENA**: switch de campo · wordmark RAFAQ · avatar | el avatar no; el wordmark tampoco | **medido**: avatar en x=[353,393], y=[13,52] → el chip lo tapa **entero** y además pisa "RAFAQ" |
| **`maniobra/carga`, `paso`, `rueda-ce`, `tacto-spike`** (`SpikeIdentityHeader`) | pill **"Saltear ‹maniobra›"** + overflow **"⋮"** (saltar animal) | 🔴 **sí, los dos** | **medido**: "⋮" en x=[363,368] y=[31,50]; pill "Saltear aptitud" en x=[150,330] → el chip tapa el ⋮ entero y 82 px del pill. El docblock dice que están ahí **a propósito, por Fitts** ("lejos del CTA de confirmar, que vive abajo") |
| **`maniobra.tsx` (MODO MANIOBRAS)** | **✕ Cerrar** — la salida del modal | 🔴 sí | `maniobra.tsx:270` (`space-between` + `Pressable`/`X`) |
| **`mis-campos`** | **+ Crear campo** | 🔴 sí | `mis-campos.tsx:211` (`space-between` + `CreateFieldButton`) |
| **`lote/[id]` (modo selección)** | **"Todos/Ninguno"** | 🔴 sí | `lote/[id].tsx:176` (trailing tras un `Text flex={1}`) |
| **`asignar-caravanas`** | `SessionCounter` (contador de la sesión) | no | `asignar-caravanas.tsx:285` |
| **`(tabs)/animales`** | su propio `BleConnectionChip` | sí | cae bajo el punto 2 → **confirmado**: reclama, no colisiona |
| **`maniobra/identificar`** | `BleConnectionChip` + contador "N hoy" | sí | cae bajo el punto 2 → **confirmado**: reclama, no colisiona |
| **`(tabs)/mas`, `(tabs)/reportes`, ficha, `crear-animal`, `agregar-evento`, `jornada`, `rodeo/[id]`, `lote/[id]` normal, listas, `reportes/*`, `editar-*`, `export-sigsa`, `import-rodeo`, `animal/baja`, `lote/venta`, `miembros`, masivas | nada: título a la izquierda y fila sin `justifyContent` ni trailing | — | **medido** en "Más": la región x≥260, y<80 no tiene un solo píxel distinto del fondo |

**Confirmación del punto 3 del pedido**: sí, `animales` e `identificar` quedan cubiertas por el punto 2 y no
colisionan (medido en el shot 02: el chip del header queda como única voz). Y sí, **hay otras**: son las seis
de arriba, y cuatro tienen un control interactivo.

### 3.2-bis Qué pasó con esta medición

Es la que descartó el anclaje DENTRO de la fila y llevó al de DEBAJO (§1-bis). De las seis pantallas con la
esquina ocupada, **ninguna** queda tapada por el anclaje final: sus controles viven EN la fila y el
indicador está por debajo. Lo que sí quedó de esta tabla es el criterio para la banda de abajo de la fila,
que se midió aparte (Pillow + el sondeo E2E) y produjo los tres reclamos de `'screen-band'`.

### 3.3 Por qué esto no se arregla con más supresión

Se puede extender el reclamo a "esta esquina es mía" y que esas seis pantallas apaguen el chip. El costo es
que el indicador desaparece **de la home y de todo el flujo de manga** — o sea, de las pantallas donde el
operario vive, y en particular del escenario que originó el reporte (la app arranca en la home con
"Conectando…" ciclando). Queda visible en ~25 pantallas secundarias. Es una opción real (§4-A), pero no es
"mover el chip": es recortar RMV3.5.

Tampoco lo arregla bajarlo una fila: debajo del header hay searchbar (mis-campos, animales), `StepIndicator`
(crear-animal), `ProgressBar` (crear-rodeo, import-rodeo) o directamente el contenido que scrollea por debajo
—y ahí el chip pasa a tapar contenido variable, que es peor que tapar algo fijo. Y no hay una altura de header
uniforme que sirva para todas (de ~50 dp en las simples a ~110 dp en `SpikeIdentityHeader`).

---

## 4. Las opciones que presenté, y qué pasó

En el primer pase propuse cuatro (A: suprimir donde la esquina está ocupada · B: chip transitorio ·
C: el estado en el header propio de la home · D: dejarlo abajo) y recomendé B. **Raf eligió una quinta que
no estaba en la lista y que es mejor que mi recomendación**: círculo permanente que se estira. B resolvía
"que no estorbe" a costa de la presencia (el chrome quedaba mudo entre avisos, que es justo lo que la app
no podía volver a ser); la quinta conserva la presencia con el footprint de B.

Los dos roces que había dejado marcados, con el estado de cada uno:

- **`mis-campos`** (el círculo sobre el banner decorativo de la primera card): aceptado por el leader. Sin
  cambios.
- **"Más"** (el roce con la card de Perfil): **capturado y medido**, shot
  `08-mas-roce-con-la-card-ampliado.png` (recorte a `deviceScaleFactor: 3`). El número corregido: no son
  2 px de roce sino **~3,7 px de SOLAPE** — el círculo va de y=66 a y=106 y el borde superior de la card
  arranca en y=102,3, así que el cuarto inferior del círculo apoya sobre la esquina redondeada de la card.
  No tapa texto ni un control. Queda a la vista para el veto; si molesta, se resuelve subiendo el gap del
  anclaje o bajando el inicio de la card, y las dos cosas son un token.

## 5. Autorrevisión adversarial

Qué busqué, qué encontré, cómo lo cerré:

1. **¿El reclamo sobrevive a la pantalla que lo emitió?** Sí, si se ata al montaje — y era el diseño obvio.
   Encontrado antes de escribirlo (las tabs quedan montadas). Cerrado con `useFocusEffect` + guard (D) + el
   tramo (c) de la E2E + M9 (falsificado con el build mutado).
2. **¿Dos superficies montadas a la vez se pisan?** Con un booleano, sí: la primera liberación devolvería el
   indicador sobre una pantalla que lo sigue mostrando. Cerrado con tokens por reclamo + 3 casos del store.
3. **¿El chip reclama cuando no pinta nada?** Sería apagar el chrome a cambio de nada (pasa en native sin
   transporte). Cerrado con el flag `active = view !== null` y documentado en el registro del guard.
4. **¿`useSyncExternalStore` con snapshot nuevo por lectura?** Re-render infinito, invisible al typecheck.
   Cerrado con snapshot congelado + test de identidad.
5. **¿El guard pasa por no tener a quién mirar?** Caso "el guard escaneó el árbol real y encuentra ≥4
   superficies" + `assertScanCoverage` + los 8 mutantes.
6. **¿La E2E asserta la ausencia por el motivo equivocado?** "No hay indicador" también pasaría si el chip se
   hubiera roto y no hubiera NADA. Por eso el oráculo es `count 1` de "Bastón conectado" **más** el chip
   visible: *hay exactamente una voz*.
7. **¿Rompo la regresión existente?** `fab-target-geometry` aterriza en "Más" y en "Inicio" con el pill vivo;
   ninguna de las dos pantallas reclama, así que sigue midiendo lo mismo — **corrido: 2/2 verde** (dentro de
   los 43). `fab-hitslop-pill.capture.ts` usa la misma navegación y por eso lo doy por sano, pero **no lo
   re-corrí**: es deducción, no medición.
8. **¿El literal de ruta se fue de verdad, o solo de un lado?** Barrí `usePathname`/`useSegments`/`'/baston'`
   en el indicador y lo dejé como aserción del guard, no como inspección de una vez.
9. **(2.º pase) ¿El backoff hace parpadear la pill?** Era el riesgo obvio de "anunciar el cambio". Cerrado
   agrupando por CLASE de noticia (`connecting` y `scanning` son la misma) + piso de 8 s por clase, con el
   test de las 20 vueltas y el mutante Mf.
10. **(2.º pase) ¿El guard de la banda de abajo quedó pasando por no tener a quién mirar?** Es literalmente
   la trampa que el leader marcó. Cerrado con la cuenta DECLARADA (`= 0`) + el inquilino sintético que
   ejercita el medidor en cada corrida, y falsificado con Md (resolvedor roto) y Md2 (cuenta falsa).
11. **(2.º pase) ¿El guard de arriba ve lo que dice ver?** No del todo: el mutante Mc (la reserva superior
   leída EN LÍNEA) **sobrevivió a la primera** y lo cerré. Es el segundo caso de esta unidad en que el
   guard nuevo tenía un agujero que solo apareció al atacarlo.
12. **(2.º pase) ¿La captura documenta lo que dice documentar?** Encontró DOS defectos reales que ningún
   test veía (la pill saliéndose de la pantalla y el texto comprimido), y encontró también que mi primera
   aserción de "pill expandida" era mentirosa (pasaba a mitad de la animación). Las tres cosas cerradas con
   aserciones, no con "ya lo miré".
13. **(2.º pase) ¿El anclaje aguanta un teléfono con notch?** Se verifica en las 4 reservas superiores
   reales y se exige que el anclaje DEPENDA de la reserva (Mc3). En web el inset es 0, así que sin esa
   exigencia un número fijo habría pasado todas las capturas.
15. **(3.er pase) ¿Mi propia medición era confiable?** No: di la banda por libre con un fixture cuyo
   usuario se llama "E2E". Lo levantó el leader. La corrección de fondo no es el `paddingRight` sino el
   CRITERIO — *"¿esto puede crecer?"* en vez de *"¿choca hoy?"*— y quedó atado en los fixtures (tope
   importado de `validation.ts`) y en `(F-reserva)`. Es la tercera vez en esta unidad que el oráculo
   propio tenía un agujero (los otros dos: la aserción de "pill expandida" que pasaba a mitad de la
   animación, y el mutante Mc de la reserva superior leída en línea).
16. **Lo que NO cubrí, declarado**: (a) el frame de más al navegar a una pantalla que reclama
   (`useFocusEffect` es pasivo); (b) el sondeo de banda mira texto y controles, no elementos puramente
   gráficos (los puntos del "Paso N de 4") — ese caso lo medí con Pillow y con la captura 06; (c) el
   registro del guard clasifica **call sites** (`useBleConnectionStatus` y el reclamo), no "pantallas con
   algo en la banda": una pantalla NUEVA que meta un buscador pegado al header no nace en rojo, la caza el
   sondeo E2E solo si la spec la visita — lo dejo escrito porque es el hueco real del mecanismo; (d) nada
   de esto se verificó en device (campaña de QA en el A07), y el morph con reanimated es lo que más ganas
   tengo de ver ahí.

---

## 6. Verificación — lo que EJECUTÉ y vi

**Primer pase** (la supresión): typecheck verde · `check.mjs` **RC=0** (2880 unit, 0 fail) · store 10/10 ·
guard 13/13 · **8 mutantes, 8 muertos** · E2E `baston*` + `fab-target-geometry` + `maniobra-identify`
**43/43** · M9 (el hook mutado a `useEffect`, con build web propio) → **falla exactamente en el tramo de la
vuelta**.

**Segundo pase** (la forma nueva):

- `pnpm typecheck` → verde.
- Unit de la unidad (contados uno por uno, no estimados): `indicator-morph` **8** ·
  `stick-status-surface` **10** · `stick-status-surface-guard` **13** · `nav-target-bands` **27** ·
  `tap-target-collision-guard` **27** → **85 casos, 0 fail**.
- **10 mutantes, 10 muertos** (§1-bis), con **uno que sobrevivió a la primera vuelta y se cerró**.
- E2E: `baston*` + `fab-target-geometry` + `maniobra-identify` → **44/44 passed (5.2 min)**.
- Capture del Gate 2.5: **1/1**, **7 shots**; `fab-hitslop-pill.capture.ts` reconciliado y **1/1**.
- Medición del morph en el navegador (sonda temporal, borrada): ancho del indicador 63,5 → 111,9 →
  **115,2 estable**; la fila mide 113,2 y el texto 62,2. Es lo que confirmó que la animación llega y que lo
  que estaba mal era mi aserción.
- Sondeo de banda: círculo en `{top:66,left:354,40×40}` **sin víctimas** en Inicio, Más y alta.
- `node scripts/check.mjs` → **RC=0** al cierre (ver el número final en el 3.er pase, abajo).
- `design/**/*.png`: la corrida de E2E volvió a renderizar `design/maniobra-identify/{candidate-picker,
  other-rodeo-sheet}.png` (churn de bytes conocido) → **revertidos** las dos veces; `design/` queda limpio.
- **No se corrió nada en el A07** ni se lanzó ningún build de EAS.

**Tercer pase** (el rango):

- Unit: las 5 suites → **86 casos, 0 fail** (sumó `(F-reserva)`).
- **10 mutantes de banda re-lanzados, 10 muertos** (base 76 ok) + el mutante **"sacarle la reserva a la
  home"**, que pone en rojo los **tres** detectores: la spec de peor caso, el sondeo y `(F-reserva)`.
  Restaurado: 4/4 verde.
- Medición del saludo con nombres reales: 14 caracteres **x=355 → x=343** con la reserva puesta (banda en
  354); tope 80 envuelve y no toca la banda.
- Sondeo con fixtures de peor caso (usuario `Maximiliano-José`, campo y rodeo largos): **sin víctimas** en
  Inicio, Más y alta.
- E2E completa: `baston*` + `baston-indicador-banda-peor-caso` + `fab-target-geometry` +
  `maniobra-identify` → **46/46 passed (5.3 min)**.
- Capturas: **8 shots** a 3× con nombre largo, incluido el recorte ampliado del roce de "Más".
- `node scripts/check.mjs` → **RC=0**, **2937 client unit tests / 0 fail**.
- `design/**/*.png`: el churn conocido volvió a aparecer las tres veces que corrí E2E → **revertido las
  tres**; `design/` queda limpio.

Lo que **no** ejecuté y por lo tanto no afirmo: el comportamiento en NATIVO (el reclamo por foco y el morph
de reanimated son los mismos paquetes que en web, pero el device no se tocó), y el frame de transición
(§5.14a), que deduje del orden de efectos.

⚠️ **EL ÁRBOL ESTÁ COMPARTIDO CON OTRA TERMINAL.** A mitad de esta unidad aparecieron en el working tree
archivos que NO son míos: `src/utils/today-iso*.ts`, `specs/active/02-modelo-animal/*-ficha-categoria-tacto.md`
y modificaciones en `agregar-evento.tsx`, `animal/baja.tsx`, `crear-animal.tsx`, `lote/venta.tsx`,
`maniobra/carga.tsx`, `seleccion-masiva.tsx`, `vacunacion-masiva.tsx`, `LinkCalfPrompt.tsx`,
`Treatment*Sheet.tsx`, `animal-birth-year.ts`, `animal-identifier.ts`, `link-calf-query.*`,
`maneuver-category-preview.ts`. Llegué a ver un typecheck rojo suyo (mid-edit) que se corrigió solo un
minuto después. **Mi diff no toca ninguno de esos archivos**; al leer el estado del árbol o un rojo de
`check.mjs`, separar por autor antes de atribuir.

## 7. Reconciliación de specs (hecha, antes de reportar)

- `requirements-multivendor.md` → **RMV3.5**: nota de reconciliación con las DOS mitades — el indicador es el
  fallback del chrome (cómo se decide la supresión, y por qué no es una lista de rutas) **y se mudó** arriba
  a la derecha con la forma círculo↔pill, el anclaje derivado, el ícono como canal de estado y los reclamos
  de banda. El EARS no se reescribió.
- `design-multivendor.md` §7 → bloque as-built con los 8 puntos del as-built real (anclaje, formas, el
  cuándo, el color, los reclamos de banda, la banda inferior vacía y declarada, los dos defectos que
  encontró la captura, el sondeo).
- `tasks-multivendor.md` → **T-MV.4.9** `[x]` con (a)-(e), los 10 mutantes y las 7 capturas; fila de RMV3.5
  de la tabla de trazabilidad actualizada.
- `scripts/run-tests.mjs` → los dos tests nuevos en la lista explícita, con el motivo escrito.
- `e2e/baston-multivendor.spec.ts` → el comentario del caso (c) decía que la supresión en `/baston` era por
  ruta y "para no pisar el título"; ahora dice lo que el código hace.

- `e2e/captures/fab-hitslop-pill.capture.ts` (unidad anterior) → su shot 06 asertaba la superposición con
  "Ir a Animales"; ahora asserta que NO existe, con el nombre cambiado. Dado vuelta, no borrado.
- `scripts/run-tests.mjs` → las tres suites nuevas en la lista explícita, con el motivo escrito.
- `e2e/fab-target-geometry.spec.ts` → su aserción (2) medía la separación indicador↔FAB; hoy daría ~700 dp
  y pasaría por trivial. Reemplazada por "la banda del FAB quedó vacía" + "el indicador aterrizó donde el
  modelo dice", y la cabecera dice por qué el archivo se conserva entero.
- `e2e/baston-multivendor.spec.ts` → el comentario del caso (c) decía que la supresión en `/baston` era por
  ruta y "para no pisar el título"; ahora dice lo que el código hace.

## 8. Estado

**done, a la espera del veto visual** (Gate 2.5) y del reviewer. Las dos mitades entregadas y verdes:
la supresión por reclamo (1.er pase) y la mudanza con forma círculo↔pill (2.º). Nada commiteado, ningún
build de EAS, el device sin tocar.
