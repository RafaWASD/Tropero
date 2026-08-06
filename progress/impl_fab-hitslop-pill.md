baseline_commit: 1f1c002a85f5b4d6c2033515180d7c70e8d6dde0

# Unidad «el FAB de Maniobra le roba los taps a la banda de arriba del nav»

Bugfix 🔴 reportado por Raf en device. Feature 04 (`04-bluetooth-baston`, delta multivendor). Informe del
implementer.

> **Estado**: **FIX-LOOP CERRADO** (2026-08-06), listo para el segundo pase del reviewer.
> Ver **§0** arriba de todo: el reviewer dio CHANGES_REQUESTED con 2 🔴, y el primero **revierte** el
> delta de UX de esta unidad (el pill tocable) con evidencia que no existía cuando se decidió.
>
> **⏸ Lo que NO se pudo verificar: el fix del `hitSlop` en DEVICE** — exige un build de EAS.

---

## 0. FIX-LOOP del review (2026-08-06) — lo que cambió respecto de la primera entrega

`progress/review_fab-hitslop-pill.md` → **CHANGES_REQUESTED**: 2 🔴, 2 🟠, 2 🟡, 2 ⚪.

### 🔴 A — El pill vuelve a ser INFORMATIVO. Se cae el delta de UX.

**No lo defendí: la evidencia es concluyente y no la tenía cuando implementé.** El reviewer barrió las
pantallas donde el pill es visible (yo lo había cerrado con **una**) y Raf midió en el A07:

| Dónde | Qué se quedaba el pill |
|---|---|
| **A07, build real** | `'Arrancar jornada'` ocupa `[34,1242]-[686,1362]`; el pill `[220,1244]-[500,1306]` → **el pill cae ENTERO adentro del CTA**. Un tap en (360, 1275) hoy arranca la jornada; con el pill tocable se lo lleva `/baston`. |
| tab **Inicio** | `"Ir a Animales"` |
| tab **Más** | `"Eliminar campo (acción destructiva)"` ← la única que yo había reportado |
| **`/maniobra/jornada`** etapa 2 | `"Antibiótico"`, `"Circunferencia escrotal"`, `"Antiparasitario"` (🔴 manga) |

**Y el reviewer nombró bien mi error de método**: escribí en tres archivos que *"cuando se sospecha de la
geometría de un target, se mide contra QUÉ choca"* y **no lo apliqué al target que yo mismo creé** — cerré
la pregunta (§6 ítem 13 de la primera entrega) con una sola pantalla. Es exactamente el error de la
entrada de backlog del 2026-07-18 que esta unidad vino a corregir. Que la conclusión sea la correcta no
salva el método: la cerré con la muestra que tenía a mano.

**La conclusión estructural, que es lo que hay que retener**: la banda de abajo está disputada **por
diseño** — todo CTA a ancho completo la cruza —, así que **no hay ninguna posición en el eje x donde un
pill flotante y tocable sea seguro ahí**. No elegimos mal el lugar: el lugar no existe.

Revertido: `onPress`, `pressStyle`, `role="button"`, `minHeight="$chipMin"`, `connectionIndicatorA11yLabel`
+ `STICK_INDICATOR_ACTION` y sus 6 tests de colisión. Vuelve `pointerEvents="none"` + `labelA11y`.

**Lo que SÍ quedó del intento, y por qué**: el aire de `$2`→`$4` (**20 dp**). Ya no se justifica como
"separación entre dos targets" (el pill no lo es) sino por dos motivos que se sostienen solos: con 9-10 dp
el pill y el círculo se leían como una sola pieza pegada, y —lo que importa— **cualquier slop futuro del
FAB se los vuelve a comer**. Es margen de seguridad además de aire visual.

**Sobre "medir e imprimir" vs. asertar**: el reviewer tiene razón y mi §3-decisión-7 estaba mal encuadrada.
Yo argumenté contra la aserción *"el pill no tapa nada"* —que sí sería falsa por diseño— pero esa no era la
que correspondía. Ahora la aserción es **más fuerte que la que él pedía** (una lista blanca de rutas 🔴):
con el pill no tocable el invariante es universal y estructural — *el pill nunca puede ser el elemento
topmost*—, así que se asierta con `elementFromPoint` en su centro en dos pantallas + el guard estático
`(E)`. El `console.log` ya no existe.

**Reversión también en las specs**: RMV3.6 **queda como estaba**, y en su lugar hay una nota que cuenta
**por qué se intentó y por qué se cayó**, con los números del A07 y las cuatro pantallas. Que el próximo
que lo proponga se encuentre con la medición y no con el silencio.

### 🔴 B — El guard se burlaba en una línea. Reescrito sobre el invariante.

El mutante del reviewer (`hitSlop={{ ...HIT_SLOP, top: FAB_RAISE }}`) daba **30/30 PASS** con el bug
entero de vuelta. Y un overlay anclado con `$navBar + $6` (= el pico exacto del FAB) también pasaba.
**Los dos agujeros son el mismo error, y es el que él nombra: el guard estaba escrito sobre la FORMA en
que hoy se escribe el bug, no sobre el invariante.** Reescrito:

| Antes (forma) | Ahora (invariante) |
|---|---|
| `(A)` escaneaba LÍNEAS buscando `hitSlop={<número>}` y eximía el ARCHIVO registrado | `(A)` extrae la **expresión balanceada** de cada `hitSlop={…}` (aunque cruce líneas) y exige que el VALOR sea legible de **un solo lugar**: literal numérico ≤12, o identificador PELADO declarado en el mismo archivo. Spread, ternario, llamada u objeto inline → rojo. |
| `(A-fix)` miraba el cuerpo del `const HIT_SLOP` | `(A-fix)` resuelve el valor **REAL que usa el JSX**, exige que sea un identificador pelado y que los **lados declarados** sean exactamente `{bottom}` — `top`/`left`/`right` prohibidos **por nombre**, valga lo que valga. |
| `(B)` vigilaba el TOKEN `$fabRaise` | `(B1)` vigila el **DESTINO**: cualquier `bottom={…}` que sume sobre la reserva inferior, **con un nivel de resolución de const local** (lavar la reserva en una variable tampoco alcanza). `(B2)` conserva la firma por token, ampliada a `$navBar`. |
| — | `(A-bis)` nuevo: `hitSlop` solo puede aparecer como PROP; en cualquier otra posición sintáctica el guard se pone rojo aunque no sepa interpretarla. |
| — | `(B1-bis)` nuevo: lo mismo que `(B1)` pero para un `bottom:` de **objeto de estilo** (`<View style={{position:'absolute', bottom: …}}/>`), que es como está escrito el propio `_layout.tsx`. |
| — | `(E)` nuevo: el pill no puede volver a tener `onPress`/`pressStyle`/`buttonA11y`, y su `pointerEvents="none"` no se puede ir. |

**Y escribí los mutantes que el pliego pedía, atacando la forma** (tabla completa en §2): además de los 2
del reviewer, el ternario, la llamada, el anclaje sin ningún token del nav, el anclaje lavado en un const,
el anclaje desde un **objeto de estilo** y el `hitSlop` en **otra posición sintáctica**. Los dos últimos
salieron de preguntarme *"¿y si lo escribo de la otra forma que este repo ya usa?"* — `_layout.tsx` mismo
prueba que acá se escribe estilo crudo cuando conviene, así que "solo la prop JSX" volvía a ser la grafía
del pill. **Los 11 mutantes de ataque ponen el guard en rojo; los 2 controles de falso positivo siguen en
verde.**

**Lo que el guard NO ve, declarado en su propio docblock**: la reserva lavada a través de **dos o más**
niveles de indirección o cruzando el borde de un módulo. Eso pide un AST, no un regex. Prefiero declarar
el límite que fingir que no está.

### 🟠 C — Las specs describían un oráculo descartado

Corregidos los **tres** sitios (`design-multivendor.md` §7, `tasks-multivendor.md` T-MV.4.8 y
`tap-target-collision-guard.test.ts:73`): ya no dicen *"intersección 2D … cubre las celdas vecinas"*. El
as-built es **hit-test muestreado con `elementFromPoint`** sobre la franja del slop, y con `left/right = 0`
esa franja no toca ninguna celda vecina — lo que sostiene el test es la auto-falsificación in-place, y eso
también quedó escrito.

### 🟠 D — La nota de RMV3.6 subdeclaraba el cambio

Ya no aplica como estaba: RMV3.6 no cambia. La nota nueva declara el intento y su reversión **con la lista
completa de víctimas medidas**, que era el reclamo de fondo.

### ⚪ Menores

- §7 decía 15 casos del collision guard; eran 14 (hoy son **17**). Corregido.
- Los **3 capture files migrados** (`baston-multivendor`, `baston-chip-sin-transporte`,
  `baston-spp-bloqueantes`) **los corrió el reviewer: 5/5 verde**. Yo no los había listado como
  ejecutados — era una afirmación de cobertura incompleta, no un defecto. Anotado.
- `feature_list.json` **no se tocó** (lo maneja el leader).
- **No toqué** ninguno de los 9 archivos de la otra unidad en curso (`BleStickListenerProvider.tsx`,
  `logging.ts`, `read-dispatch.ts`, `bulk-assign-empty*`, `asignar-caravanas.tsx`, `identificar.tsx`,
  `TagScanSheet.tsx`, `stick.ts`, `FindOrCreateOverlay.tsx`) — verificado con `git status`. La reversión
  no los necesitó.

---

## 1. Qué se hizo

### T1 — `docs/backlog.md`: la entrada cerrada MAL

`## 2026-07-18 — Zona muerta de tap en el FAB de Maniobra` estaba cerrada como *"✅ CERRADO (no se
reproduce)"*. **Su hipótesis (a) era la correcta** (*"el `hitSlop` del Pressable sí extiende el área
efectiva más de lo que asumimos"*) y quedó archivada sin verificar. Corregida con la evidencia medida,
y con el **error de método** escrito arriba de todo, que es lo que vale:

> La entrada previó **un solo** modo de falla —*"el síntoma sería «toco el FAB y no pasa nada»"*— y
> declaró el diagnóstico refutado al no verlo. Un target y su vecino tienen **dos** modos simétricos: el
> botón no llega, o el botón se pasa. Peor: el experimento que se corrió (*"¿el FAB responde donde
> debería?"*) **da el mismo resultado con y sin el defecto**, porque el defecto hace que responda **de
> más**. Un experimento que no distingue las dos hipótesis no es evidencia.

También quedó marcado que la **premisa geométrica** de la entrada (*"los toques fuera de los límites del
ancestro no se entregan"*) tampoco se sostiene acá, y que el "fix real" que dejaba pendiente (sacar el FAB
del tabBar) sigue sin justificarse — ahora **verificado**, no supuesto.

### T2 — `app/app/(tabs)/_layout.tsx`: fuera el `top` del `hitSlop`

```ts
const HIT_SLOP = {
  bottom: Math.max(0, COLOR.navHeight - COLOR.navItemTop - (FAB_SIZE - FAB_RAISE)),
};
```

El `bottom` se queda (es el que gana área real y crece hacia DENTRO del nav, donde el único vecino es su
propio label). El bloque de comentario de ~55 líneas que argumentaba una conclusión falsa se reemplazó por
uno corto y cierto: las dos mediciones, el corolario de que el ancestro **no** recorta, y a qué guards
mirar. Sin slop horizontal, igual que antes.

### T3 — `connection-view.ts`: el nombre accesible de la fila, centralizado

`STICK_ROW_ACTION` + `connectionRowA11yLabel()` (puros). `mas.tsx` dejó de armar su label inline, que es el
defecto que ese archivo cerró el 2026-07-29. **El pill NO tiene entrada acá**: no es un botón, su nombre
accesible es el label del estado vía `labelA11y`. (La primera entrega tenía también
`connectionIndicatorA11yLabel` + `STICK_INDICATOR_ACTION` + 6 tests de colisión entre las dos familias de
nombres; se fueron con la reversión del §0-A. El docblock deja escrito que, si el pill vuelve a ser un
botón algún día, su nombre se decide ahí y JUNTO al de la fila.)

### T4 — `StickStatusIndicator.tsx`: el pill sigue siendo informativo, con más aire

- El **contenedor** absoluto sigue `pointerEvents="box-none"` y el pill `pointerEvents="none"` (**as-built
  original, restaurado**). El `none` explícito del pill NO es redundante: verificado en el paquete, no
  supuesto — Tamagui emite `pointer-events:none` en el contenedor **y** la regla
  `:root ._pe-boxnone > * { pointer-events:auto; }`
  (`@tamagui/web/dist/cjs/helpers/createDesignSystem.cjs:176`), o sea que sin el `none` el hijo directo
  **volvería a capturar** en web.
- Gap del pill `$2` (7) → **`$4` (18)** ⇒ **20 dp** de separación al pico del FAB (único cambio funcional).
- `testID="stick-status-pill"` para que los guards puedan medirlo.
- Un bloque **⛔** en la cabecera con la evidencia de por qué no puede ser tocable (A07 + las 4 pantallas).

### T5 — `(tabs)/mas.tsx`: "Bastón" → "Dispositivos"

Más el efecto colateral que el rename destapa: `/baston` tiene su propia sección "Dispositivos" y **el tab
queda montado detrás del Stack**, así que `getByText('Dispositivos')` pasa a matchear DOS. Se le puso
`testID="stick-devices-section"` a la de `/baston` y las 4 specs/captures que la anclaban por texto pasaron
a `getByTestId`.

### T6–T9 — Los guards. Ver §2.

### T10 — Colisiones reparadas en la suite existente

| Qué rompía | Dónde | Cómo quedó |
|---|---|---|
| `getByText('Dispositivos')` matchea 2 al navegar client-side | `baston-multivendor.spec.ts` (×2) + 3 captures (×4) | `getByTestId('stick-devices-section')` |
| `getByText('Bastón').first()` como ancla de banda | `baston-multivendor.capture.ts` (×2) | `getByText('Dispositivos')` (único en "Más") |
| El matcher de la fila exigía un punto literal | 3 archivos e2e + el test puro | `/^Bastón: .+ Abrí…$/` (ver §4, cambio as-built) |

### T11 — Capture del Gate 2.5 + sonda borrada

`app/e2e/captures/fab-hitslop-pill.capture.ts` (6 shots). `fab-hitslop-probe.capture.ts` **borrada** (era
una sonda descartable; lo que servía se absorbió en el guard geométrico).

### T12 — Specs reconciliadas. Ver §4.

---

## 2. Los guards (el entregable central)

Escritos sobre el **invariante**, no sobre la instancia — **reescritos en el fix-loop**, porque la primera
versión estaba escrita sobre la FORMA en que hoy se escribe el bug y el reviewer la burló en una línea
(§0-B).

| # | Archivo | Qué vigila |
|---|---|---|
| a | `app/src/utils/nav-target-bands.ts` + `.test.ts` (**16 casos**) | Aritmética pura: las bandas del target del FAB y de la PINTURA del pill, derivadas de los tokens, no se tocan; separación ≥ `MIN_TAP_TARGET_SEPARATION` (16) en las 4 reservas de plataforma; el CONTRAFÁCTICO con los tokens de `1f1c002`. |
| b | `app/src/utils/tap-target-collision-guard.test.ts` (**19 casos**) | Estático de CLASE: **(A)** el VALOR de todo `hitSlop` legible de un solo lugar · **(A-bis)** `hitSlop` solo aparece como PROP · **(A-fix)** el target del FAB no excede su círculo salvo hacia abajo, resolviendo el JSX real · **(B1)** anclajes por DESTINO sobre la reserva inferior · **(B1-bis)** lo mismo desde un objeto de estilo · **(B2)** tokens de geometría del nav · **(C)/(D)** espejos contra los tokens reales · **(E)** el pill no puede volver a ser tocable. Más los inversos de los dos registros. |
| c | `app/e2e/fab-target-geometry.spec.ts` (**2 casos**) | Geométrico: hit-test muestreado de la franja del slop + auto-falsificación in-place; y que el pill **no intercepte** el toque, en dos pantallas. |

Los dos primeros están **registrados en la lista explícita de `scripts/run-tests.mjs`** (con el motivo
escrito: `hitSlop` es no-op en RNW, ninguna E2E web puede ver este bug por comportamiento).

**El oráculo del (c) se corrigió después de un FALSO POSITIVO** (hallazgo de la primera entrega, sigue
válido). El primer intento intersectaba rectángulos: reportó la card *"Completá el RENSPA…"* del tab "Más"
(`x=[18,394] y=[848,934]`), que cruza al FAB pero está **detrás de la barra** en orden de pintura — un rect
no sabe de z-order. El oráculo correcto es el **hit-test**: se muestrea la región que el slop agrega FUERA
de la pintura del FAB (288 puntos, paso de 2 dp) y en cada punto se pregunta `document.elementFromPoint()`.
(Ese falso positivo dejó una observación real → `docs/backlog.md`, entrada 2026-08-06.)

**Mediciones del guard geométrico, ejecutadas** (tras la reversión):

```
[fab-geometry] pill y=[766,799] alto=33 · FAB y=[820,884] · aire=21 dp · puntos de slop muestreados=288
```

21 y no 20 porque el modelo aritmético ignora el borde de 1 px del tabBar, **a propósito y del lado
seguro** (calcula 1 dp menos de separación de la que hay). El pill volvió a 33 dp al salir el `minHeight`.

### Falsificación con mutantes — 13 en el fix-loop (y 15 en la primera pasada)

Los del fix-loop atacan la **FORMA del guard**, que es lo que el pliego pedía. Los dos primeros son los del
reviewer, con los que la versión anterior daba 30/30 en verde:

| Mutante | Fallos | Quién lo caza |
|---|---|---|
| **M16 [reviewer]** override con SPREAD en el sitio de uso | **2** | (A) + (A-fix) |
| **M18 [reviewer]** overlay anclado con `$navBar + $6` (= pico del FAB), sin `$fabRaise` | **2** | (B1) + (B2) |
| M17 override por TERNARIO | **2** | (A) + (A-fix) |
| M19 override por LLAMADA (`Object.assign` / helper) | **2** | (A) + (A-fix) |
| M20 el `top` vuelve DENTRO del const (el camino obvio) | **1** | (A-fix) |
| M21 overlay anclado SIN ningún token del nav (reserva + `$12`) | **1** | (B1) |
| M22 overlay que LAVA la reserva en un const local | **1** | (B1) |
| M23 el pill recupera el `onPress` | **1** | (E) |
| M24 el pill pierde el `pointerEvents="none"` | **1** | (E) |
| M27 anclaje desde un OBJETO DE ESTILO (`bottom:` en vez de `bottom={…}`) | **1** | (B1-bis) |
| M28 `hitSlop` en otra posición sintáctica (objeto de props + spread) | **1** | (A-bis) |
| **M25 [CONTROL]** `hitSlop={8}`, la convención de ~38 sitios | **0** ✅ | *no debe disparar* |
| **M26 [CONTROL]** offset decorativo en un hero (`bottom={heroScan * 0.16}`) | **0** ✅ | *no debe disparar* |

Baseline y verificación final: **0 fallos**, árbol restaurado byte a byte tras cada mutante (aserción de
identidad en el script, después del incidente de la primera pasada — ver §6).

Los 15 de la primera pasada siguen valiendo para lo que no cambió (tokens, espejos, `$fabRaise`); los que
apuntaban a `minHeight`/`pressStyle` caducaron con la reversión.

**M25 y M26 son tan importantes como los 9 de ataque**: un guard que se pone rojo con todo se desactiva. El
escalar uniforme de 8 y el `bottom` decorativo de un hero (el caso REAL de `maniobra/identificar.tsx` y
`TagScanSheet.tsx`, que no toqué) tienen que seguir pasando limpio.

## 3. Decisiones que tomé (estado FINAL, tras el fix-loop)

1. **El pill NO es tocable** — decisión del fix-loop, con la evidencia del §0-A. Se fueron `onPress`,
   `pressStyle`, `role="button"` y `minHeight="$chipMin"`.
2. **El aire de `$4` (20 dp) SE QUEDA, con otra justificación.** Ya no es "separación entre dos targets".
   Se sostiene por dos motivos independientes: con 9-10 dp el pill y el círculo se leían como una sola
   pieza pegada, y —el que importa— **es margen contra un slop futuro del FAB**. Si mañana alguien
   re-agrega un `top` chico, 20 dp de colchón hacen la diferencia entre un guard rojo y un bug en device.
3. **`minHeight="$chipMin"` FUERA.** El leader lo preguntó y coincido: 40 dp es el bar de un *target*
   compacto y el pill no es un target. Usar un token de touch-target en un elemento no tocable es
   semánticamente falso y engorda el chip 7 dp sin comprar nada. El guard `(D)` lo prohíbe explícitamente
   para que no vuelva de arrastre.
4. **El label accesible de la FILA se mantiene centralizado en `connection-view.ts`.** Nació para poder
   testear la colisión con el del pill; el pill ya no tiene label de botón, así que ese motivo caducó —
   pero el otro sigue: `mas.tsx` armaba una decisión de presentación del bastón inline, que es el defecto
   que ese archivo cerró el 2026-07-29. **No lo revertí** (es una mejora que se sostiene sola) y la E2E
   ya lo verificó en verde. Lo digo explícito porque es lo único del delta caído que sobrevivió.
5. **El separador del label no duplica puntuación.** `Conectando…` + `. ` daba `Conectando….`. Ahora es
   `Conectando… Abrí…`, con el texto visible contenido **verbatim** (WCAG 2.5.3 «Label in Name»: quien
   maneja la app por voz dice lo que ve; recortar el `…` rompería el match por voz).
6. **`testID="stick-devices-section"` en `/baston`.** Un cambio de producción mínimo, pero era eso o dejar
   la E2E anclada a un texto que el rename hizo existir dos veces.
7. **La oclusión del pill pasó de `console.log` a ASERCIÓN, y más fuerte que la que pidió el reviewer.**
   Él pedía una lista blanca de rutas 🔴. Con el pill no tocable el invariante es **universal y
   estructural** (el pill nunca puede ser el topmost), así que se asierta eso — vale para toda pantalla,
   incluidas las que la E2E no visita, y lo respalda el guard estático `(E)`.
8. **El guard declara lo que NO ve.** La reserva lavada en dos o más niveles de indirección, o cruzando un
   módulo, se le escapa: eso pide un AST. Está escrito en su docblock. Prefiero el límite declarado a la
   falsa cobertura — es la misma lección de la entrada de backlog que esta unidad vino a corregir.

**Lo que salió con la reversión y por qué lo anoto igual**: el `pressStyle` había sido corregido de `$bg` a
`$divider` porque **la captura del estado de press lo falsificó** (reposo y press en 16.079 y 16.070 bytes,
indistinguibles: `$bg` sobre `$surface` son 2 puntos de luminancia). El código se fue, pero el método vale
y quedó anotado en el capture file: **el estado de press hay que capturarlo, no suponerlo.**

---

## 4. Reconciliación de specs

| Archivo | Qué se reconcilió |
|---|---|
| `requirements-multivendor.md` | **RMV3.6 queda como estaba.** La nota de reconciliación del primer intento (que declaraba el cambio de contrato) se **reemplazó** por una nota que cuenta *"se intentó volverlo tocable y se revirtió"*, con los números del A07 y las cuatro pantallas, la conclusión estructural (la banda está disputada por diseño), y qué sí quedó (el aire de `$4`). Los EARS no se reescribieron. |
| `design-multivendor.md` §7 | Bloque as-built completo, reescrito: la causa (el FAB), las dos mediciones, la justificación falsa que había, por qué `pointerEvents="none"` **no** evitaba el bug, la geometría, el rename, los **tres guards con su formulación nueva**, el oráculo real del E2E (hit-test muestreado, **no** "intersección 2D"), y el pendiente de device. |
| `tasks-multivendor.md` | **T-MV.4.8** `[x]`, reescrita, **con un bloque de REVERSIÓN dentro de la misma unidad**. Trazabilidad: la fila de RMV3.6 dice que **NO cambió** y remite al guard `(E)`. |
| `docs/backlog.md` | La entrada del 2026-07-18 corregida (§1 T1) + dos observaciones nuevas medidas: la card del RENSPA bajo el nav, y el rojo pre-existente de `lotes.spec.ts:61`. |

**Cambio as-built que hay que leer (nadie lo pidió, lo produjo la centralización)**: el nombre accesible de
la fila de "Más" pasó de `Bastón: Conectando…. Abrí…` a `Bastón: Conectando… Abrí…`. Los matchers de la
E2E se relajaron (`/^Bastón: .+ Abrí…$/`, sin el punto literal) en 2 archivos + el test puro. Lo detectó el
test que espeja los matchers de la E2E, **antes** de correr Playwright.

**Corregido en el fix-loop (🟠-C del review)**: las specs describían el oráculo del E2E como *"intersección
2D … cubre también las celdas vecinas"*. Era falso dos veces —el oráculo muestrea puntos, y con
`left/right = 0` ninguna celda vecina se muestrea— y el mismo texto viejo estaba en el `verificadoEn` del
registro del guard. Los **tres** sitios corregidos.

---

## 5. Trazabilidad: requisito → test concreto

| Requisito / invariante | Verificado en |
|---|---|
| **RMV3.5** el indicador global existe y refleja el estado | `e2e/baston-multivendor.spec.ts` (a–f) · `connection-view.test.ts` |
| **RMV3.6** el indicador NO intercepta toques — el contenedor | `tap-target-collision-guard.test.ts` → `(E)` (exige `box-none`; mutante **M24** → rojo) |
| **RMV3.6** el indicador NO intercepta toques — el pill | `(E)` (sin `onPress`/`pressStyle`/`buttonA11y`, con `pointerEvents="none"`; mutantes **M23/M24** → rojo) **+** `e2e/fab-target-geometry.spec.ts` → `el pill NO intercepta el toque` (`pointerEvents` computado + `elementFromPoint` en su centro + tap táctil real, en **2 pantallas**) |
| **BUG 🔴** el target del FAB no invade a nadie | `nav-target-bands.test.ts` → `el target del FAB y el del pill NO se solapan` + `e2e/fab-target-geometry.spec.ts` (1) hit-test + (1-bis) auto-falsificación |
| El `top` no puede volver — **por ninguna grafía** | `(A)` + `(A-fix)`; mutantes **M16/M17/M19/M20** → rojo (los 4 caminos: spread, ternario, llamada, dentro del const) |
| Separación ≥ piso, en las 4 plataformas | `nav-target-bands.test.ts` → `la separación … respeta el piso` + `… es INDEPENDIENTE de la reserva inferior` |
| El fix no crea una zona muerta en el FAB | `nav-target-bands.test.ts` → `el círculo ENTERO del FAB sigue dentro de su propio target…` |
| El `bottom` no invade la reserva del sistema | `nav-target-bands.test.ts` → `el hitSlop.bottom … llega justo al pie de la celda` |
| El invariante se mide contra la banda PINTADA (el pill no es target y **eso no lo exime**) | `nav-target-bands.test.ts` → `el invariante se mide contra la banda PINTADA del pill…` |
| **RMV3.1** el rótulo de la sección | `e2e/captures/fab-hitslop-pill.capture.ts` shots 04/05 (veto visual) |
| Bug de CLASE: un `hitSlop` nuevo sin verificar | mutantes **M16/M17/M19** → rojo; **M25** (la convención) → verde |
| Bug de CLASE: una superficie nueva en la banda | mutantes **M18/M21/M22** → rojo; **M26** (offset decorativo) → verde |
| El nombre accesible de la fila no se rompe | `connection-view.test.ts` (5 casos de a11y) · BLE **10/10**, "Más" **55/55** corridos |

**ADR-018**: el fix **no lo toca**. ADR-018 define el shell de navegación y el FAB central como botón
elevado; ni la elevación (`$fabRaise`), ni el layout, ni la pintura, ni la ruta cambian. Lo único que cambia
es el `hitSlop`, que no está en el ADR (nació en el fix del 2026-07-18). **No lo edité.**

---

## 6. Autorrevisión adversarial

Qué busqué, qué encontré, cómo lo cerré.

| # | Busqué | Encontré | Cerrado |
|---|---|---|---|
| 1 | ¿El guard vigila el invariante o la instancia? | La exención de `CHECKED_SLOPS` era **por archivo**: un `hitSlop` nuevo en `_layout.tsx` entraba gratis. | Campo `declarados: N` + chequeo de conteo. Mutante **M15**. |
| 2 | ¿El guard puede pasar vacío? | — | `assertScanCoverage` + piso de 300 archivos + `el guard recorre el árbol real…` (exige ≥20 `hitSlop` vistos). |
| 3 | ¿El guard es tan estricto que lo van a desactivar? | Riesgo real: 38 `hitSlop` en el árbol. | Cap de escalar uniforme ≤12 + **mutante M14** que prueba que la convención pasa limpio. |
| 4 | ¿Los tests pasan por la razón equivocada? | El E2E geométrico podía pasar **por no mirar** (con `top:0` no hay región que muestrear hacia arriba). | Auto-falsificación **in-place**: el mismo medidor con el slop histórico tiene que ver al pill, sobre ESE build. |
| 5 | Falso positivo del oráculo E2E | La card del RENSPA, detrás de la barra en z-order. | Oráculo cambiado a hit-test real. Observación al backlog. |
| 6 | §6: ¿el `role="button"` nuevo rompe la E2E? | Riesgo confirmado por análisis. | Test puro que espeja los matchers + corrida real (10/10 + 55/55). |
| 7 | Colisión de textos que introduce el rename | `getByText('Dispositivos')` pasaría a matchear 2 (el tab queda montado detrás del Stack). | `testID` + 6 anclas migradas. |
| 8 | ¿El contenedor `box-none` deja pasar el toque al hijo en web? | **No estaba verificado** — Tamagui tiene su propio pipeline de estilos y `usePointerEvents` es un **no-op** en el build web. | Leído en el paquete: `getCSSStylesAtomic.cjs` mapea `box-none` al identificador `_pe-boxnone` y `createDesignSystem.cjs:176` emite `:root ._pe-boxnone>* {pointer-events:auto;}`. Y confirmado ejecutando: el tap del E2E navega. |
| 9 | ¿El pill puede empujar/tapar algo nuevo al crecer 7 dp? | Crece hacia ARRIBA (está anclado por `bottom`), a una zona vacía sobre el nav. | `nav-target-bands.test.ts` cubre el lado de abajo; el veto visual (shots 01/02) cubre el de arriba. |
| 10 | Multi-tenant / offline-first | N/A: cero I/O, cero `establishment_id`, cero red. Solo geometría y navegación local. | — |
| 11 | Seguridad (Gate 2) | `git diff supabase/ sync-streams/` **vacío**. Sin RLS, RPC, EF ni migraciones. | — |
| 12 | ¿Rompo el gesto de manga? | Sí, y no lo vi con la profundidad necesaria. **Este ítem es el que el reviewer convirtió en 🔴-1.** | Resuelto por la reversión (§0-A): el pill ya no navega ni intercepta nada. |
| 13 | ¿A quién le roba los toques el PILL ahora que es tocable? (la pregunta simétrica a la del FAB) | **Me hice la pregunta correcta y la cerré con UNA pantalla** ("Eliminar campo", en Más). El reviewer barrió y encontró tres más, una de ellas 🔴 manga; Raf midió el A07 y encontró la peor. | Reversión + aserción estructural. **Y el error de método queda escrito**: hacerse la pregunta no alcanza si se responde con la muestra que uno tiene a mano — es literalmente el defecto de la entrada de backlog que esta unidad vino a corregir, cometido de nuevo por mí, en la misma unidad. |
| 14 | ¿El estado de press se VE? | **No.** `$bg` sobre `$surface` es indistinguible; la captura lo probó byte a byte. | Se corrigió a `$divider` y después salió con la reversión. El método quedó anotado en el capture file. |

### Fix-loop — lo que busqué esta vez

| # | Busqué | Encontré | Cerrado |
|---|---|---|---|
| 15 | ¿El guard es burlable por OTRAS grafías además de la del reviewer? | Sí: ternario y llamada (`Object.assign`/helper) pasaban por el mismo agujero que el spread. | El invariante no es "no escribas `top:`" sino "el valor tiene que ser legible de un solo lugar". Mutantes **M17/M19**. |
| 16 | ¿`(B1)` es burlable lavando la reserva en una variable? | Sí. `const anchor = safeBottom + X; bottom={anchor}` pasaba. | Resolución de **un nivel** de const local. Mutante **M22**. Y el límite (dos niveles / cruzar módulo) queda **declarado** en el docblock. |
| 17 | ¿La firma nueva de `(B1)` tiene falsos positivos en el árbol real? | Riesgo alto: la versión coarse a nivel de archivo marcaba `maniobra/identificar.tsx` y `TagScanSheet.tsx` (los dos de la otra unidad en curso). | Firma a nivel de EXPRESIÓN, no de archivo: un `bottom={heroScan * 0.16}` no nombra la reserva y no dispara. Mutante de control **M26**. Cero entradas de allowlist nuevas. |
| 18 | ¿El regex de la reserva cubre la grafía más probable? | **No.** `BOTTOM_RESERVE` tenía el `` envolviendo el grupo, y `useSafeBottomInset()` termina en `)`: un `` después de un no-word-char nunca matchea → la **llamada directa** se escapaba en silencio. Lo cazó mi propio test de falsificación, no el árbol. | `` por término. Es exactamente por qué el test de falsificación tiene que probar las grafías, no solo el árbol de hoy. |
| 19 | ¿Queda código muerto de la reversión? | `connectionIndicatorA11yLabel`, `STICK_INDICATOR_ACTION`, `STICK_PILL_NAME` (×2 archivos), `PILL_MIN_HEIGHT`, el `Victim`/`describeVictims` no usado, el shot de press. | Todo borrado; typecheck verde y `grep` de cada símbolo en 0. |
| 20 | ¿El pill NO tocable vuelve inofensivo que el FAB entre en su banda? | **No, y era una trampa fácil de pisar.** El toque atraviesa el pill y cae en lo que hay debajo — y con el bug, lo que hay debajo era el target inflado del FAB. El bug original ocurría **con el pill ya `pointerEvents="none"`**. | Escrito en el docblock de `stickPillBand`, en el componente y en las specs. El modelo se mide contra la banda **PINTADA**, con su test propio. |
| 21 | ¿Toqué algo de la otra unidad en curso? | No. | `git status` verificado contra los 9 archivos listados (que mientras tanto aparecieron modificados **por ellos** en el árbol compartido). Re-corrí los guards contra ese árbol: 35/35. |
| 22 | ¿El guard es esquivable escribiendo el `bottom` en un OBJETO DE ESTILO en vez de en la prop JSX? | **Sí.** `_layout.tsx` prueba que en este repo se escribe estilo crudo cuando conviene, así que la firma "solo prop JSX" era otra vez la grafía del pill. | `(B1-bis)`. Mutante **M27**. |
| 23 | ¿Y escribiendo `hitSlop` en otra posición sintáctica (objeto de props + spread)? | **Sí.** `(A)` solo veía `hitSlop={…}`. | `(A-bis)`: se exige correspondencia 1:1 entre las menciones del identificador y las props extraídas — si aparece en otra posición, el guard se pone rojo **aunque no sepa interpretarla**, que es la respuesta correcta ante algo que no puede verificar. Mutante **M28**. |
| 24 | ¿Quedó código muerto de la reversión? | 8 símbolos candidatos. | `grep` de cada uno → **0 ocurrencias** en `app/`+`src/`+`e2e/`. Typecheck verde. |

### Un daño que me hice y cómo lo recuperé (queda escrito porque el hecho importa)

La **primera versión del script de mutantes restauraba con `s.replace(new, old)`**. Con el mutante M3, cuya
mutación era borrar una línea (`new = ""`), eso inserta la línea original **entre cada carácter del
archivo**: `StickStatusIndicator.tsx` pasó de 7,8 KB a **343 KB** de basura, y los mutantes M4/M5 corrieron
sobre un árbol ya roto (sus conteos de fallos eran ruido).

Recuperado sin perder nada: `git show HEAD:<archivo>` para volver a la versión de `1f1c002` y **re-aplicar
las tres ediciones a mano**; verificado con `git diff` que el resultado es exactamente el cambio buscado, y
con typecheck + los 73 tests unitarios del área. El script se rehízo con **backup de bytes** (v2) y una
aserción de que el archivo vuelve idéntico después de cada mutante. Los 15 mutantes de la tabla son de la
v2, todos con verificación final en 0 fallos. Ningún otro archivo se tocó (comprobado con `git status` y
grep de las firmas mutadas).

---

## 7. Verificación — qué ejecuté vs. qué leí

Todo esto es del **estado final** (post fix-loop). Lo de la primera pasada que ya no aplica no se repite.

**EJECUTADO Y VISTO:**

- `pnpm typecheck` → verde.
- `node scripts/check.mjs` → **RC=0**, con los dos guards dentro de la lista explícita (verificado en el
  log: la línea del runner los nombra). Alcance declarado: **no incluye Playwright**.
- `node scripts/check-hardcode.mjs` → 0 violaciones (ADR-023 §4).
- `nav-target-bands.test.ts` **16/16** · `tap-target-collision-guard.test.ts` **19/19** ·
  `connection-view.test.ts` **42/42** (37 del baseline + 5 de a11y de la fila).
- **13 mutantes del fix-loop** (tabla §2), incluidos los **2 del reviewer** y **2 controles de falso
  positivo**; baseline y cierre en 0, con aserción de restauración byte a byte tras cada uno.
- `pnpm e2e:build` → RC=0.
- `e2e/fab-target-geometry.spec.ts` → **2/2**, con las dos mediciones impresas:
  ```
  [fab-geometry] pill y=[766,799] alto=33 · FAB y=[820,884] · aire=21 dp · puntos de slop muestreados=288
  [fab-geometry] contrafáctico (top=26): le robaría a <div role=button> "Eliminar campo (acción destructiva)"
  ```
  **El contrafáctico cambió de víctima tras la reversión, y el motivo vale**: con el pill
  `pointerEvents="none"` el hit-test lo ATRAVIESA, así que el slop histórico le roba al control que está
  DEBAJO. Eso ES el mecanismo del bug, medido: que el pill no fuera tocable nunca lo evitó. Ajusté la
  aserción a "el contrafáctico tiene que encontrar víctimas" (con `top:0` encuentra 0; con `top:26`
  encuentra 1) — sigue siendo un diferencial real, y ya no depende de qué haya debajo del pill.
- `e2e/baston-multivendor.spec.ts` + `baston-chip.spec.ts` + `asignar-caravanas-sin-transporte.spec.ts` →
  **11/11** (11 y no 10: la otra unidad en curso le sumó un caso a `asignar-caravanas-sin-transporte`).
- Capturas del Gate 2.5 → **5 PNG** en `e2e/captures/__shots__/fab-hitslop-pill/` (gitignored, verificado
  con `git check-ignore`). Regeneradas de cero tras la reversión (borré el directorio primero) y las miré
  una por una. El shot 06 muestra el pill apoyado justo encima de "Ir a Animales": es la evidencia visual
  de §0-A.
- `git diff supabase/ sync-streams/` → vacío.
- ⚠️ **`design/maniobra-identify/{candidate-picker,other-rodeo-sheet}.png` quedaron modificados.** Son
  re-renders de una corrida E2E (el bug de clase conocido del repo), **no** cambios de diseño. **NO los
  revertí**: hay otra unidad trabajando sobre `maniobra/identificar.tsx` en el mismo árbol y tocar
  archivos compartidos sería pisarla. El leader pidió que se le avise — queda avisado.

**De la primera pasada, sigue valiendo** (nada de lo revertido lo invalida):

- Las 10 specs que pisan el tab "Más" → **54 passed / 1 failed**. El rojo es
  **`lotes.spec.ts:61`**, **PRE-EXISTENTE de `1f1c002`**: verificado ejecutando —stasheé los 5 archivos de
  producción, rebuildeé el `dist` desde la base y la spec **falló igual** (misma aserción,
  `lotes.spec.ts:103`)—, después `git stash pop` + MD5 contra el backup. Anotado en `docs/backlog.md`.
- Los **3 capture files migrados** los corrió **el reviewer**: `baston-multivendor` 2/2,
  `baston-chip-sin-transporte` 2/2, `baston-spp-bloqueantes` 1/1. (Yo no los había listado — era una
  afirmación de cobertura incompleta de mi parte, no un defecto.)

**LEÍDO, NO EJECUTADO** (lo distingo a propósito):

- El manejo de `pointerEvents="box-none"` de Tamagui en web (`getCSSStylesAtomic.cjs` +
  `createDesignSystem.cjs:176`). El *efecto* sí está ejecutado — el E2E mide `pointerEvents: 'none'`
  computado en el pill y que `elementFromPoint` en su centro devuelve otra cosa. **Y el reviewer lo
  verificó por comportamiento aparte**: 7 puntos a lo ancho de la banda resuelven a la pantalla de abajo.
- El comportamiento de `hitSlop` en **nativo**. Es la razón de ser de la unidad y no hay forma de correrlo
  desde acá.

**NO VERIFICADO — y es el pendiente que importa:**

> ⏸ **El fix del `hitSlop` no está verificado en device.** `hitSlop` es **no-op** en react-native-web, así
> que la corrección real —que en Android el target del FAB deje de llegar 26 dp más arriba— **solo se puede
> comprobar en un APK**, y eso exige un **build de EAS** (gate de builds de `CLAUDE.md`: OK explícito de
> Raf, por plataforma). Lo que sí está probado desde acá es que el `hitSlop.top` **ya no existe en el
> código**, que ningún guard lo deja volver por ninguna de las cuatro grafías, y que el pill no intercepta.
> La prueba en device es un barrido de `adb shell input tap` sobre la banda del pill: con el fix puesto, un
> tap en `y≈1290` (720×1600, densidad 300) tiene que **atravesar el pill** y llegar a lo que haya debajo,
> y **no** abrir MODO MANIOBRAS.

---

## 8. Archivos tocados

**Producción (5)**
- `app/app/(tabs)/_layout.tsx` — fuera el `hitSlop.top`; comentario reescrito.
- `app/app/(tabs)/mas.tsx` — sección "Dispositivos"; label a11y desde la pura.
- `app/src/features/ble-stick/components/StickStatusIndicator.tsx` — gap `$2`→`$4`, `testID`, y el bloque
  ⛔ con la evidencia de por qué no puede ser tocable. **Funcionalmente: un solo cambio (el gap).**
- `app/src/features/ble-stick/connection-view.ts` — `STICK_ROW_ACTION` + `connectionRowA11yLabel` puros.
- `app/src/features/ble-stick/screens/StickConnectionScreen.tsx` — `testID` en la sección.

**Tests / guards (5)**
- `app/src/utils/nav-target-bands.ts` **(nuevo)** · `app/src/utils/nav-target-bands.test.ts` **(nuevo)**
- `app/src/utils/tap-target-collision-guard.test.ts` **(nuevo)**
- `app/e2e/fab-target-geometry.spec.ts` **(nuevo)**
- `app/src/features/ble-stick/connection-view.test.ts` — +5 casos de a11y de la fila.

**E2E existente (4)** — anclas migradas: `baston-multivendor.spec.ts`,
`captures/baston-multivendor.capture.ts`, `captures/baston-chip-sin-transporte.capture.ts`,
`captures/baston-spp-bloqueantes.capture.ts`.

**Capturas (2)** — `captures/fab-hitslop-pill.capture.ts` **(nuevo, 5 shots)** ·
`captures/fab-hitslop-probe.capture.ts` **(borrado)**.

**Infra / docs (6)** — `scripts/run-tests.mjs` · `docs/backlog.md` (entrada corregida + 2 observaciones
nuevas) · `specs/active/04-bluetooth-baston/{requirements,design,tasks}-multivendor.md` ·
`progress/current.md`.

**NO commiteado.** **No se tocó `feature_list.json`** ni ninguno de los 9 archivos de la otra unidad en
curso.

---

## 9. Para el reviewer / el leader

1. **El veto visual**: `02-banda-pill-vs-fab.png` (el aire de 21 dp, corazón del fix) y
   `06-pill-encima-de-un-cta-en-inicio.png` (**la evidencia de por qué el pill no puede ser tocable** —
   ahí se ve la superposición con "Ir a Animales"; el toque la atraviesa, que es lo correcto).
2. **§0-A ya no necesita decisión de producto**: el pill volvió a informativo y el invariante quedó
   asertado. Lo que sí queda en pie es la pregunta de fondo, por si Raf quiere retomarla algún día: el
   acceso rápido a `/baston` desde el chrome. Hoy se resuelve por la fila de "Más" y el `ConnectHero`.
3. **`docs/backlog.md` 2026-08-06** — dos entradas nuevas, las dos medidas y ninguna arreglada: la card del
   RENSPA bajo el nav (candidata a bug de clase) y el rojo pre-existente de `lotes.spec.ts:61`.
4. **El pendiente de device (§7) no es un detalle**: es la mitad del bugfix que ningún test de este repo
   puede cerrar.
5. **El límite declarado del guard** (§3-8): la reserva lavada en ≥2 niveles de indirección se le escapa.
   Está en su docblock. Si el leader lo quiere cerrado, es un AST y es otra unidad.

---

## Sesión de cierre de evasiones del guard (2026-08-06, terminal aparte)

### DIAGNÓSTICO (escrito ANTES de tocar nada, con los mutantes ya corridos)

Baseline verificado: `nav-target-bands.test.ts` + `tap-target-collision-guard.test.ts` = **35/35 pass**.

Las dos evasiones del brief describen la **primera** versión del guard. La versión que hay en el árbol
(la reescritura de 47,9 KB, sin commitear) ya cierra las dos formas TEXTUALES. Medido, no deducido:

| Mutante | Predicción del brief | Medido en el árbol actual |
|---|---|---|
| (1) `hitSlop={{ ...HIT_SLOP, top: FAB_RAISE }}` en el call site | pasa 35/35 | **ROJO** — 2 tests: (A) y (A-fix) |
| (2a) overlay nuevo con `bottom={safeBottom + $navBar + $6}` | pasa 35/35 | **ROJO** — 2 tests: (B1) y (B2) |

Pero **las dos clases siguen abiertas**, con otra grafía. Los dos agujeros vivos, medidos:

**(1') El extractor de lados es ciego a todo lo que no sea "una clave por línea".**
`objectKeysOfLocalConst()` parte el cuerpo del objeto por `\n` y aplica `^\s*key\s*:` a cada línea: se
queda con la **primera** clave de cada línea. Entonces el bug entero vuelve escribiendo el `const` en
UNA línea:

```ts
const HIT_SLOP = { bottom: Math.max(0, COLOR.navHeight - COLOR.navItemTop - (FAB_SIZE - FAB_RAISE)), top: FAB_RAISE };
```

→ `sides = ['bottom']`, (A-fix) verde, (A) verde (sigue siendo identificador pelado), (D) verde (el
cuerpo sigue nombrando los 4 tokens), E2E verde (mira su espejo escrito a mano). **Medido: 35/35 PASS
con el `hitSlop.top` de 26 dp puesto.** Misma familia: `{ bottom: X, ...EXTRA }` (el spread no matchea
`^key:` → invisible) y `{ bottom: X, ['top']: Y }` (clave computada → invisible).
La causa raíz es la misma que el brief le imputa a la versión vieja: el oráculo mira la **forma** del
texto, no el **valor** del target. Y el E2E, que es el único que podría medir el valor real, mide un
`const FAB_HIT_SLOP = { top: 0, … }` escrito a mano.

**(2') La firma de la banda es el VOCABULARIO, no el destino.**
(B1) exige que la expresión nombre la reserva con uno de 4 términos fijos
(`safeBottom` / `useSafeBottomInset()` / `bottomInset` / `insets.bottom`) y (B2) vigila 2 tokens
(`$navBar`, `$fabRaise`). Un overlay que llega a la MISMA banda con otro vocabulario pasa:

```tsx
const { bottom: pad } = useSafeAreaInsets();   // alias: ninguno de los 4 términos
<View position="absolute" bottom={pad + 86} /> // 86 = navBar(60) + fabRaise(26) = el pico del FAB
```

**Medido: 35/35 PASS.** Y `$fab` / `$navItemTop` tampoco están en la firma de tokens.
Además, ninguna superficie **registrada** tiene verificación numérica: el registro guarda PROSA
("se ancla `$fabRaise + $4` → 20 dp de aire"); nadie comprueba que el anclaje real produzca esa banda.

### Plan de cierre (invariante, no grafía)

1. `nav-target-bands.ts` pasa a exportar el **resolvedor** puro (string→número, fail-closed): evaluación
   con scope whitelisteado, lectura de tokens del `tamagui.config.ts`, y `resolveFabHitSlop(layoutSrc,
   configCode)` que resuelve el `hitSlop={…}` **del JSX** (no del `const`), sigue spreads, claves
   quoteadas y one-liners, y **tira error** ante cualquier cosa que no pueda resolver.
2. `(A-fix)` deja de contar claves: compara el **valor numérico resuelto** contra `{ bottom: <tokens> }`.
3. El **E2E deja de tener espejo**: deriva el `hitSlop` real del fuente de producción con la MISMA
   función, y el contrafáctico sale del token, no de un literal.
4. `(B)` pasa a mirar el **destino**: vocabulario de reserva **dinámico por archivo** (cualquier alias
   que salga de una fuente de safe-area cuenta), familia completa de tokens de geometría del nav, y
   **chequeo numérico de banda** para cada superficie registrada (su anclaje real, resuelto, tiene que
   despejar la banda del target real del FAB por ≥ `MIN_TAP_TARGET_SEPARATION`).

### QUÉ CAMBIÉ

Cuatro archivos (los únicos autorizados). Ninguna línea de código de producción: `_layout.tsx`,
`StickStatusIndicator.tsx` y el resto del árbol quedaron **byte-idénticos** (verificado con `cmp` contra
copias de respaldo, no sólo con `git diff`).

**1. `app/src/utils/nav-target-bands.ts` (133 -> 522 líneas).** Segunda mitad nueva: el **resolvedor**
puro, sin dependencias de RN, que traduce un fuente de producción a números en dp. Es la pieza que
faltaba: hasta ahora la traducción estaba hecha DOS veces y distinta (el guard contaba claves, el E2E
copiaba a mano), y las dos se burlan cambiando la grafía.

- `evaluateDp(expr, env)` — aritmética con scope: literales, `+ - * / ()`, `Math.max/min`,
  `getTokenValue('$x','grupo')`, identificadores resueltos siguiendo `const X = …` y `X.y` (objeto
  literal o `const X = fn()` con `function fn(){ return {…} }`) del mismo archivo, hasta 8 saltos, con
  corte de ciclos. **Whitelist + fail-closed**: ternarios, llamadas, imports de otro módulo -> TIRA.
- `resolveInsetSides(expr, env)` — lados de un objeto de insets partiendo por **comas de primer nivel**
  (no por líneas), siguiendo spreads recursivos y normalizando claves quoteadas. Clave computada -> TIRA.
- `resolveFabHitSlop(layoutSrc, configCode)` — resuelve el `hitSlop={…}` **del JSX**, no del `const`, así
  que un override en el sitio de uso queda incluido. Dos `hitSlop` en el archivo -> TIRA.
- `sizeTokenFromConfig` / `navGeometryFromConfig` — movidos desde el guard (evalúan los tokens derivados
  del config, p. ej. `Math.round(FAB_SIZE * FAB_RAISE_RATIO)`); más `jsxPropExpressions`, `braceBody`,
  `insetsWithDefaults`, `TargetResolutionError`.
- Dos detalles no obvios que costaron un rojo: las comillas de un regex van como `\x27`/`\x22` y las
  llaves como `\x7b`, porque `stripSourceComments` no distingue un literal de regex y una comilla ahí
  adentro abre un string falso que se come la llave de apertura de la línea -> `scan-coverage` lo reporta
  como fuente desbalanceado (con razón). Documentado en el propio archivo.

**2. `app/src/utils/nav-target-bands.test.ts` (225 -> 397 líneas).** 10 tests nuevos del resolvedor: la
forma as-built, el one-liner, el spread (en el uso y adentro del const), la clave quoteada, ocho
gramáticas que deben TIRAR, la aritmética real, la extracción multilínea, los tokens derivados, el
override leído del JSX, y el invariante numérico (cualquier `top` > 0 come el aire; >= 5 dp cae bajo el
piso).

**3. `app/src/utils/tap-target-collision-guard.test.ts` (19 -> 21 tests).**
- `(A-fix)` dejó de contar claves: compara el **valor resuelto** contra `{bottom: <tokens>}` y exige
  `top = left = right = 0`.
- `(A-fix bis)` NUEVO: el resolvedor es fail-closed (lee el override, se niega ante un helper).
- `(B-banda)` NUEVO: el anclaje real de cada superficie registrada, resuelto del fuente con sus tokens y
  su alias de reserva, tiene que despejar el techo del target **real** del FAB por >= 16 dp. Estar en el
  registro dejó de alcanzar. Si una superficie registrada ancla desde un objeto de estilo (forma que el
  extractor no lee), el test se declara incapaz y se pone rojo en vez de saltearla en silencio.
- `(B1)`: el vocabulario de la reserva inferior ahora se **deriva por archivo** (`const X =
  useSafeBottomInset()`, `const { bottom: X } = useSafeAreaInsets()`, `const ins = useSafeAreaInsets()`
  -> `ins.bottom`, …), no es una lista de 4 nombres fijos.
- `(B2)`: la firma de tokens pasó de 2 a 5 (`$fab`, `$fabRaise`, `$navBar`, `$navItemTop`,
  `$navBottomMin`) -> hubo que registrar `src/hooks/useSafeBottomInset.ts` (dueño de la reserva, como el
  FAB_OWNER lo es del nav).
- `(C)` cambió de "el espejo del E2E coincide" a "**el E2E no tiene espejo**": se exige la llamada a
  `resolveFabHitSlop`, se prohíbe por nombre que vuelvan las 4 copias, y la única tabla que le queda
  (3 tokens de `space`) se cruza contra tamagui. Ese cruce encontró un error mío en el acto: yo había
  puesto `$6 = 24` y vale 32 — corregido, junto con la aritmética heredada del comentario de (B1) que
  decía que `$navBar + $6` daba "el pico EXACTO" (da 92; el pico está en 84).
- Se borraron los helpers duplicados (`braceBody`, `tokenGroupBody`, `sizeToken`, `propExpressions`,
  `objectKeysOfLocalConst`): ahora vienen del módulo compartido. Cabecera reescrita con las dos rondas de
  evasión y sus mediciones.

**4. `app/e2e/fab-target-geometry.spec.ts`.** Se le sacó el espejo. Lee `_layout.tsx` y
`tamagui.config.ts` del disco y deriva el `hitSlop` con `resolveFabHitSlop()`; `MIN_TAP_TARGET_SEPARATION`
se importa; la separación esperada y el contrafáctico se calculan de los tokens. Aserción nueva (0):
`FAB_HIT_SLOP.top === 0`. Detalle de plataforma: `__dirname` y **no** `import.meta.url` — Playwright
transpila estos specs a CJS y un `import.meta` fuerza salida ESM, con lo que el archivo revienta al
cargar (`require is not defined in ES module scope`). Lo verifiqué en carne propia.

**Decisión pedida (leer el valor real vs. cerrarlo del lado estático): las dos, con una sola función.**
El E2E no puede leer el `hitSlop` del DOM —RNW 0.21.2 no lo implementa, no llega al DOM— así que "derivar
del componente montado" es imposible; lo que sí se puede es derivarlo del **fuente** del componente. Se
hizo eso, y con la MISMA función que usa el guard estático. Un solo traductor, dos oráculos: no puede
haber divergencia entre lo que el guard cree y lo que el E2E mide.

### LOS MUTANTES (todos aplicados, corridos y restaurados)

Restauración verificada con `cmp` byte a byte contra respaldo + `git status` sin residuos. Tamaños
finales sanos: resolvedor 27,9 KB / 522 líneas · guard ~56 KB / 933 líneas · e2e 20,3 KB / 385 líneas.
Ningún reemplazo sobre cadena vacía; las mutaciones se aplicaron con reemplazo de cadena exacta y, cuando
fue por script, con `assert count == 1`.

| # | Mutante | ANTES | DESPUÉS |
|---|---|---|---|
| 1 | `hitSlop={{ ...HIT_SLOP, top: FAB_RAISE }}` en el call site (el del brief) | **ya era rojo** (2: A, A-fix) — el brief describía la versión previa del guard | **rojo (4)**: A · A-fix · A-fix bis · B-banda. Y el **E2E también**: resuelve `top:26` y falla la aserción (0) + el muestreo. Antes el E2E daba verde contra su espejo. |
| 2a | overlay nuevo con `bottom={safeBottom + $navBar + $6}` (el del brief) | **ya era rojo** (2: B1, B2) | rojo (B1, B2) |
| 2b | overlay con `const { bottom: pad } = useSafeAreaInsets(); bottom={pad + 86}` — misma banda, otro vocabulario | **VERDE 35/35** <- el agujero (2) vivo | **rojo (B1)** |
| 3 | `const HIT_SLOP = { bottom: Math.max(…), top: FAB_RAISE };` **en una línea** | **VERDE 35/35** <- el agujero (1) vivo | **rojo (2)**: A-fix · B-banda |
| 4 | *(mío, contra la forma del guard NUEVO)* el overlay de (2b) **registrado en `BOTTOM_BAND_SURFACES`** — o sea, haciendo lo que el mensaje de error de (B1) te dice que hagas | n/a (la contramedida es nueva) | **rojo (B-banda)**: «se ancla a 86 dp … el techo del target del FAB está a 84 dp: quedan 2 dp, menos que el piso de 16». Registrarse ya no es una salida. |
| 5 | *(mío, bonus)* el gap del pill vuelve de `$4` a `$2` (deriva de una superficie legítima) | (D) sola | **rojo (2)**: D · B-banda (con el número: 9 dp < 16) |

Verde final: `nav-target-bands.test.ts` + `tap-target-collision-guard.test.ts` = **47/47**; `pnpm
typecheck` limpio; E2E `fab-target-geometry.spec.ts` **2/2** con `hitSlop REAL de _layout.tsx =
{"top":0,"right":0,"bottom":20,"left":0}` impreso desde el fuente. Los otros 7 guards estáticos del árbol
(`phone-field`, `worklet-callbacks`, `safe-bottom-inset`, `keyboard-avoiding`, `sheet-keyboard-dismiss`,
`strip-comments`, `tab-bar-insets`) siguen en **64/64** tras agregarle 400 líneas a un archivo escaneado.

### LO QUE **NO** VERIFIQUÉ (y los límites que quedan declarados)

- **No corrí `check.mjs`** (instrucción explícita: ya estaba en RC=0). Corrí en su lugar las 2 suites de
  la unidad + los 7 guards que escanean el árbol + typecheck. **No corrí el resto de la suite E2E** (sólo
  `fab-target-geometry.spec.ts`); `design/**/*.png` y `test-results/` quedaron limpios.
- **No hay eslint local** (`pnpm exec eslint` -> "not found"), así que las dos directivas
  `// eslint-disable-next-line no-new-func` que agregué no las validó nadie.
- **Nada en device.** Todo el sistema sigue siendo geometría: aritmética + DOM. El `hitSlop` real de
  nativo no se probó en esta sesión.
- **Límite declarado (no cerrado): el anclaje con número pelado.** Un `bottom={96}` que no nombre la
  reserva ni ningún token del nav no dispara nada, porque `bottom` es relativo al PADRE y estáticamente
  no se sabe si ese padre es la pantalla o una card. Cerrarlo con una firma numérica llenaría el árbol de
  falsos positivos (todo `bottom={8}` decorativo). Queda anotado en la cabecera del guard, junto con el
  otro límite viejo (dos niveles de indirección / cruce de módulo).
- **La tabla de 3 tokens de `space` del E2E** es la última copia que queda en ese archivo; es
  fail-closed (si el código usa un `$N` que no está, el resolvedor tira) y ahora la cruza (C) contra
  tamagui, pero es una copia.
- `(A-fix bis)` depende de que el call site se escriba literalmente `hitSlop={HIT_SLOP}`: si alguien lo
  reformatea, el test falla con «el fuente del FAB cambió de forma: revisá este test». Es deliberado
  (fail-closed), pero es un test que pide mantenimiento si ese archivo se reformatea.

---

## Fix-loop del re-review (2026-08-06) — 🔴-1 anclaje · 🔴-2 specs · 🟠-3 textos · + el incidente del blanqueo

### 🔴-1 — `(B1)` resolvía el `hitSlop` por VALOR y el ANCLAJE por texto

Diagnóstico aceptado tal cual: la mitad del guard que arreglé en la ronda anterior miraba valores y la otra
mitad seguía preguntando `expr.includes('+')` sobre la prop `bottom`. Dos preguntas distintas para el mismo
invariante. **Lo que cambió: (B1) dejó de buscar palabras y ahora resuelve la coordenada.**

**Antes de escribir la regla, medí el árbol** (para no inventar una lista ni romper 300 archivos). Props
cuyo valor sale de la reserva inferior, en todo `app/app` + `app/src`: **23 de la familia `padding`, 1
`bottom`** (el pill), **2 claves internas** del hook de la reserva, y **2 hand-offs** (`bottomPad={bottomPad}`
en dos spikes de maniobra). Nada más. Con ese dato la regla puede ser estricta sin costo:

- **`(B1)`** — la firma pasó de "suma sobre la reserva" a **mencionar la reserva** (vocabulario derivado por
  archivo). `Math.max(insets.bottom, 86)` ya no se escapa por no tener un `+`.
- **`(B1-bis)` reescrito** — *si el valor de una prop sale de la reserva, la prop tiene que ser una que el
  guard sepa medir*: `bottom` (única que se convierte en coordenada) o la familia `padding` (reserva
  espacio, no coloca). **Todo lo demás nace en rojo.** La lista está **al revés a propósito**: enumerar las
  props peligrosas (`marginBottom`, `translateY`, …) es lo que hizo que este guard se dejara burlar tres
  veces — la lista siguiente siempre tiene un nombre más. Falso positivo que hubo que resolver: una prop
  que CONTIENE un objeto (`contentContainerStyle={{ …, paddingBottom: insets.bottom + X }}`) no coloca nada
  por sí misma; se clasifican sus claves, no el contenedor.
- **`(B-banda)` ahora calcula en las CUATRO reservas**, no en una. Suponer que "el inset se cancela" sólo
  vale si el anclaje es lineal en la reserva, y `Math.max(reserve, 86)` no lo es: se queda quieto mientras
  el FAB sube 52 dp entre web y Android 3 botones.
- **Hand-offs declarados**: `bottomPad={bottomPad}` pasa la reserva a otro módulo, donde el guard ya no la
  reconoce (es el límite de "cruzar el borde de un módulo", declarado). No lo puedo seguir, así que lo hice
  **explícito**: registro con lo que hace el receptor —verificado: `CircunferenciaEscrotalStep` lo usa como
  `paddingBottom`— y un hand-off NUEVO nace en rojo. La diferencia entre "no lo veo" y "no lo veo y nadie
  se enteró".
- El motor nuevo (`resolveByReserve`) vive en el módulo compartido, así que **el E2E podría usar el mismo**.

**Los tres mutantes de anclaje propios (grafías que NO están en el informe del reviewer), más dos:**

| # | Mutante de anclaje | Resultado |
|---|---|---|
| G | `bottom={Math.max(insets.bottom, 86)}` (el del informe, sin registrar) | **rojo (B1)** |
| G' | el mismo, **registrado** en `BOTTOM_BAND_SURFACES` | **rojo (B-banda)**: «con reserva 12 dp el borde queda en 86 y el techo del FAB en 96: **−10 dp**» |
| **H** | **`insetBlockEnd={safeBottom + 86}`** — propiedad lógica de CSS, mismo destino, otro nombre | **rojo (B1-bis)** |
| **I** | **`style={bandStyle(safeBottom)}`** — el estilo lo arma un HELPER, no hay objeto literal que escanear | **rojo (B1-bis)** |
| **J** | **`` transform={`translateY(${-(safeBottom + 86)}px)`} ``** — transform como template string de CSS | **rojo (B1-bis)** |
| K | `footerInset={safeBottom}` — hand-off a otro módulo sin registrar | **rojo (B1-bis)**, con el sufijo «hand-off sin registrar» |

### El incidente del blanqueo (lo que reportó la unidad hermana)

**Ya estaba arreglado cuando llegó el aviso, pero era real.** Su medición fue sobre un snapshot de 29.896
bytes; mi archivo estaba en 30.034 porque el último `\x7b` (el de `allJsxProps`) entró después. Verificado
ahora sobre el árbol entero: **0 archivos desbalanceados** bajo el blanqueo compartido, y **`check.mjs`
completo en verde** («All tests passed» + «Entorno listo»).

La causa, para que quede escrita: `stripSourceComments…` **no distingue un literal de regex** (límite
declarado en su propio header). Una comilla adentro de un regex (`['"]`) abre un string falso que se come el
resto de la línea —incluida la llave de apertura de la arrow function que sigue— y una llave adentro de un
regex (`/return\s*\{/`) suma una apertura que nadie cierra. Arreglo: escapes hexa (`\x27`, `\x22`, `\x7b`).

**Lo que dejé para que no vuelva a pasar** (era el pedido explícito, y es de la misma familia que todo lo
demás de esta unidad): un caso nuevo de auto-verificación que recorre el árbol entero y, si un archivo
desbalancea, reporta **archivo:línea + la línea culpable + el arreglo concreto**. `assertScanCoverage` ya lo
detectaba, pero informa el ARCHIVO; con la causa a cinco guards de distancia del síntoma, esa diferencia es
la que costó la tarde. Falsificado: reintroduje la llave literal en el regex de `objectBodyOf` y el guard
dijo `src/utils/nav-target-bands.ts:371 (cierra en 1) → function objectBodyOf(...) {`. Restaurado.

### 🔴-2 — Specs reconciliadas al as-built

`design-multivendor.md` y `tasks-multivendor.md`: **16+17 → 27+22 casos**, y se documentan las reglas que
faltaban — el RESOLVEDOR compartido y fail-closed, `(A-fix)` por valor y no por claves, `(A-fix bis)`,
`(B1)` por mención, **`(B1-bis)`** (la lista al revés), **`(B-banda)`** en las 4 reservas, `(B2)` con los 5
tokens, `(C)` con el E2E sin espejo, y el balanceo con línea culpable. El total de mutantes pasó de 22 a
**36** a lo largo de las tres rondas.

### 🟠-3 — Los dos textos que decían que el pill es tocable

- `docs/backlog.md`: decía que el pill "pasó a ser tocable → `/baston`". Corregido con la nota de la
  reversión y su evidencia (en el A07 el pill cae entero adentro de 'Arrancar jornada').
- `app/app/(tabs)/mas.tsx`: decía que el pill era "el otro botón que lleva a `/baston`". Corregido: sólo
  comentario, ni una línea de comportamiento. Esta fila es el único acceso in-app.

Los dos ahora nombran el caso `(E)` que congela la decisión, así que el texto apunta al test que lo sostiene.

### Verde final del fix-loop

- `nav-target-bands.test.ts` **27/27** · `tap-target-collision-guard.test.ts` **22/22** (49 en total)
- `pnpm typecheck` limpio · E2E `fab-target-geometry.spec.ts` **2/2**
- **`node scripts/check.mjs` COMPLETO: verde** («All tests passed» / «Entorno listo. Podés trabajar.»)
- `design/**/*.png` y `test-results/` limpios; sin residuos de mutantes (`git status` verificado y los
  archivos de la otra unidad byte-idénticos con `cmp`)

### Lo que sigue sin verificarse

- **Nada en device.** El `hitSlop` real de nativo sigue esperando el build de EAS.
- **Límite declarado (sin cerrar)**: un `bottom={96}` que no mencione la reserva ni ningún token del nav no
  dispara — `bottom` es relativo al PADRE y estáticamente no se sabe si el padre es la pantalla o una card.
  Una firma numérica ahí llenaría el árbol de falsos positivos.
- **El otro lado de un hand-off**: registrado y verificado a mano hoy, pero el guard no cruza el módulo.
- Sigue sin haber eslint local, así que las directivas `eslint-disable-next-line no-new-func` no las validó
  ninguna herramienta.
