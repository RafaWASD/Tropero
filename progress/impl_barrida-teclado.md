baseline_commit: fc4d164dd35311855b031b3c887fd3ec9260e5df

# UNIDAD «barrida de teclado» — replicar el keyboard-avoidance al RESTO de las superficies con input

> Continuación directa de la unidad «teclado Android» (`eabfd00`, `progress/impl_teclado-android.md`).
> Aquella creó el primitivo `KeyboardAvoidingShell` y arregló los **4 sitios que montaban un
> `KeyboardAvoidingView` mal configurado**. Raf lo verificó en device (el sheet de Vacunación sube) y
> enseguida encontró el MISMO bug en `app/app/maniobra/identificar.tsx`, que **no monta ningún**
> mecanismo. O sea: había una **segunda población** — superficies con AUSENCIA total de mecanismo — que
> el guard de aquella unidad no podía ver, porque busca el uso *incorrecto* de un componente, no la
> *falta* de él.

**Nada commiteado** (lo hace el leader). `design/**/*.png` verificado intacto (`git status --porcelain design/` = 0 líneas, después de correr build + E2E).

---

## 0. FIX-LOOP (2ª entrega) — qué pidió el reviewer y qué quedó

| # | pedido | qué hice |
|---|---|---|
| **B1** 🔴 | el "1008 líneas en 57 archivos" no reproduce con ninguna métrica | Reimplementé el blanqueo viejo y medí 4 métricas sobre el árbol de `fc4d164`. **Declaro la métrica y el resultado: 556 líneas de CÓDIGO invisibles en 6 archivos** de `app/app`+`app/src` (coincide exacto con la del reviewer, per-file incluido). Corregido en los **3 docblocks de guards**, la spec 03 (tasks + design), `progress/current.md` y este informe. §4. |
| **B1-bis** | "revisá el informe entero con ese criterio" | Encontré **dos números más que no resistían**: el `maxHeight` de los 6 sheets (85/85/85/**90**/**90**/**88**, no "85 en los 6") y —hallazgo propio, nadie lo había marcado— **`$6` vale 32, no 24**, lo que invalidaba TODO el delta de reserva reportado para los sheets de tratamientos. Los 4 valores nuevos quedan **fijados por test**. El único número que sí resistió es el E2E: lo **re-corrí** y da 49/2 sobre 51 (§6). |
| **B2** 🔴 | `BulkConfirmSheet` + reescribir la entrada de backlog por criterio | Arreglado (`useSafeBottomInset({ floor: $6 })`, la variante NO keyboard-aware, con el porqué). Entrada de backlog **retitulada por criterio**, marcada 🔓 **CLASE ABIERTA sin guard**, con la enumeración exhaustiva declarada pendiente. §2-bis y §5. |
| **B3** 🔴 | "la semilla es completa por construcción" es sobreventa | `onChangeText` sumado a la semilla + header corregido a lo que realmente garantiza + **test contra un oráculo independiente** + falsificado con el caso aliaseado (y con la semilla vieja, para mostrar el agujero). §4. |
| **B4** 🔴 | cada guard verifica SU PROPIA cobertura | `app/src/utils/scan-coverage.ts`: piso de archivos + balance de llaves por archivo + retención, en los **4** guards que escanean. Falsificadas las dos (glob roto → rojo; stripper que se come archivos → rojo), una por vez. §4. |
| **M1** | docblock duplicado en `safe-bottom-inset-guard.test.ts:147-156` | Sacado (quedaba el viejo de una línea arriba del nuevo). |
| **M2** | el `BackHandler` en el backlog con su criticidad | Entrada **🔴 propia** (no una línea dentro de otra lista), con el caso `FindOrCreateOverlay` (overlay global sobre la manga), el "no es regresión de esta unidad" y el fix mínimo del interín. §9.5. |

---

## 1. Las 23 superficies — qué se hizo en cada una

Leyenda del "cómo": **W** = se envolvió la columna con `<KeyboardAvoidingShell>`; **K** = la reserva
inferior pasó a `useKeyboardAwareBottomInset(...)`; **P** = es una PARTE (componente de entrada reusable,
no una superficie) → la cobertura la pone quien la monta, y el guard lo exige.

### 🔴 manga (7)

| # | archivo | forma | qué se hizo |
|---|---|---|---|
| 1 | `app/app/maniobra/identificar.tsx` | hero `flex:1` + banda inferior | **W** sobre header+hero+banda (los **4 sheets hermanos quedan AFUERA**) + **K** en `bottomPad`. El hero absorbe el alto del teclado y la banda queda justo encima. |
| 2 | `app/app/_components/FindOrCreateOverlay.tsx` | sheet a mano | **W** dentro del scrim (envuelve backdrop + hoja) + **K** (`extra: $6`). |
| 3 | `app/app/maniobra/_components/SugerenciaVaciasSheet.tsx` | sheet a mano | **W** dentro del scrim + **K**. |
| 4 | `app/src/components/TagScanSheet.tsx` | sheet a mano | **W** dentro del scrim + **K** (`extra: $6`). *(Raf autorizó incluirlo; `git status` confirmó que la terminal BLE no lo tenía tocado.)* |
| 5 | `app/app/(tabs)/animales.tsx` | buscador arriba + lista | **W** sobre header+lista. El input nunca se tapaba: **el fix son los RESULTADOS**. Necesitó además `tabBarHideOnKeyboard` (§3). |
| 6 | `app/app/asignar-caravanas.tsx` | buscador + lista + 2 CTAs | **W** sobre la columna + **K** (`extra: $3`). |
| 7 | `app/app/vacunacion-masiva.tsx` | form + preview + footer fijo | **W** sobre la columna + **K** (`extra: $3`). |

### 🟡 (16)

| # | archivo | forma | qué se hizo |
|---|---|---|---|
| 8 | `app/src/components/TreatmentStartSheet.tsx` | sheet a mano | **W** + **K** con `floor: $6` (ver §2-bis: arrastra un fix de la unidad «aire»). |
| 9 | `app/src/components/TreatmentApplicationSheet.tsx` | sheet a mano | ídem. |
| 10 | `app/src/components/LinkCalfPrompt.tsx` | sheet a mano | **W** + **K**. Se monta desde `crear-animal.tsx` **fuera** de su `</FooterActionShell>` → no heredaba nada. Su `TagScanSheet` queda AFUERA del shell propio. |
| 11 | `app/app/seleccion-masiva.tsx` | buscador + lista + CTA fijo | **W** (el `BulkConfirmSheet` queda AFUERA) + **K** (`extra: $3`). |
| 12 | `app/src/components/GroupSearchBar.tsx` | banda de búsqueda | **P** — la cobertura la pone `GroupViewScreen`. |
| 13 | `app/src/components/GroupViewScreen.tsx` | buscador + FlatList | **W** sobre la columna. Cubre a `lote/[id]` y `rodeo/[id]`, que salen del universo del guard porque su input queda resuelto acá. |
| 14 | `app/app/mis-campos.tsx` | buscador arriba + lista | **W**. |
| 15 | `app/app/lotes.tsx` | form inline en scroll | **W**. |
| 16 | `app/app/crear-rodeo.tsx` | wizard + footer fijo | **W** sobre el wizard + **K**. La 2ª pantalla del archivo (`ImportPrompt`, sin input) **conserva `useSafeBottomInset()`**: no está adentro de ningún shell, encogerla sería mentir. |
| 17 | `app/app/export-sigsa.tsx` | filtros + footer sticky | **W** sobre header+cuerpo+footer (el `overlay` queda AFUERA) + **K** en el footer. |
| 18 | `app/app/animal/baja.tsx` | form + footer fijo | **W** + **K**. |
| 19 | `app/app/lote/venta.tsx` | filas editables + footer fijo | **W** + **K**. |
| 20 | `app/app/lote/_components/BatchSaleAnimalRow.tsx` | fila con precio/peso | **P** — la cubre `lote/venta`. |
| 21 | `app/app/(tabs)/mas.tsx` | form de perfil en scroll | **W** + `tabBarHideOnKeyboard` (§3). |
| 22 | `app/app/animal/[id].tsx` | ficha larga en scroll | **W** sobre barra superior + cuerpo; **los 4 sheets del final quedan AFUERA**. |
| 23 | `app/src/components/IdentifierAssignRow.tsx` | fila de carga manual | **P** — la cubre `animal/[id]`. |
| 23-bis | `app/app/maniobra/_components/CustomFieldInput.tsx` | input de dato custom | **P** — la cubren `maniobra/carga` (ya cubierta) y `animal/[id]` por la ruta de la ficha (vía `CustomPropertiesSection`, también **P**). |

**Total efectivo**: **20 superficies envueltas** + las partes declaradas (`FormField`, `PhoneField`,
`GroupSearchBar`, `IdentifierAssignRow`, `BatchSaleAnimalRow`, `CustomFieldInput`,
`CustomPropertiesSection` y los 6 pasos del wizard de maniobra) + 2 excepciones (`baston-test`,
`rueda-ce`). El inventario del leader listaba 23 entradas contando las partes por separado; el mapeo está
arriba, una a una.

**No tocados, a propósito**: `app/app/baston-test.tsx` (harness de dev) y `app/app/maniobra/rueda-ce.tsx`
(design spike). Los dos quedaron declarados como EXCEPCIÓN en el guard, con motivo escrito **y** con la
exigencia de que el marcador (`HARNESS DE DEV/TEST`, `DESIGN SPIKE`) siga presente en la cabecera del
propio archivo.

---

## 2. El razonamiento de la safe-area (el punto difícil)

**El problema**: con el teclado abierto se apilan dos reservas. El shell sube el contenedor el alto
**entero** del teclado (que en Android, bajo edge-to-edge, ya incluye la franja de la barra de
navegación), así que la safe-area del SO **queda tapada por el teclado**. Si la superficie la sigue
reservando, quedan ~64dp (Android 3 botones) de **hueco muerto** entre el contenido y el borde del
teclado. Los 4 sitios de la unidad anterior no lo tenían porque componían
`resolveFooterPaddingBottom({ keyboardVisible, safeInset, keyboardOpenGap: $2 })` a mano.

**Los dos caminos que planteó el leader, y por qué ninguno solo**:

- **(a) volver `useSafeBottomInset()` keyboard-aware en un solo lugar.** Descartado. Cambiaría de golpe
  las **~40 llamadas** del hook, incluidas las que **NO suben con el teclado**: el bottom-nav de
  `(tabs)/_layout` lo dibuja el Navigator **fuera de todo shell**, así que encogerle la reserva sería
  mentir sobre una barra que sigue estando. Y el cambio es **invisible en web** (`Keyboard` de RNW nunca
  emite → el flag queda en `false` y todo da idéntico), o sea que el blast radius cae entero sobre el
  único eje que Raf no puede verificar barato. Riesgo alto, beneficio nulo para 35 de las 40 llamadas.
- **(b) aplicar `resolveFooterPaddingBottom` en cada superficie nueva.** Correcto pero es la enfermedad
  que la unidad «aire» acababa de curar: la fórmula copiada a mano, ahora en 20 lugares nuevos.

**Lo que hice — (c), la síntesis**: un hook nuevo, `useKeyboardAwareBottomInset(opts)`, que **compone**
los tres pedazos en **un** lugar (`app/src/hooks/useSafeBottomInset.ts`, el mismo archivo donde vive la
reserva canónica y el único que el guard de la reserva exime):

```ts
resolveFooterPaddingBottom({
  keyboardVisible: useKeyboardVisible(),
  safeInset: useSafeBottomInset(own),      // misma API de knobs: { extra, floor }
  keyboardOpenGap: getTokenValue('$2', 'space'),
})
```

Propiedades que compra:

1. **Locality de (b) + fuente única de (a)**: cero copias de la fórmula, cero blast radius sobre las ~40
   llamadas que no suben con el teclado.
2. **La regla de call site queda declarativa y legible**: *si tu borde inferior sube con el teclado (o
   sea, está adentro de un shell), usás `useKeyboardAwareBottomInset`; si no sube, `useSafeBottomInset`.*
   Los dos hooks conviven **a propósito**, y eso está escrito en el docblock del hook y en
   `docs/design-system.md` §4.
3. **Migré los 3 sitios de la unidad anterior al hook** (`FooterActionShell`, `BottomSheetShell`,
   `maniobra/carga`). Es un refactor mecánico de valores **idénticos** (mismos tres términos, mismo token
   `$2`), y sin eso el repo quedaba con **dos** grafías de la misma reserva — exactamente lo que la
   unidad «aire» erradicó. `BottomSheetShell` conserva su `useKeyboardVisible()` propio porque lo usa
   para otras dos cosas (condensación y gesto de arrastre); las dos suscripciones al mismo evento se
   batchean en el mismo commit de React, así que no hay re-render extra.

**Criterio de aceptación, cumplido por construcción**: con el teclado abierto la reserva de toda
superficie envuelta es exactamente `$2`, igual que en los 4 sitios que Raf ya verificó en device. Con el
teclado cerrado **el valor es idéntico al de hoy** en las 20 superficies (mismo `useSafeBottomInset` con
los mismos knobs) — o sea, **cero cambio observable en web y con el teclado bajo**.

### 2-bis. Hallazgo aparte: **3** sheets que la unidad «aire» no había tocado (eran 2 en la 1ª entrega)

`TreatmentStartSheet`, `TreatmentApplicationSheet` y —encontrado por el reviewer en el fix-loop—
**`BulkConfirmSheet`** tenían `paddingBottom="$6"` **fijo**. Nunca pasaron por el hook compartido, y por
eso la unidad «aire» no los tocó: **su guard prohíbe re-implementar la fórmula, no OMITIRLA**. En Android
con barra de 3 botones (inset 48) eso dejaba sus CTAs a **32**dp del borde de pantalla, o sea **debajo de
la barra**. Plegados al hook con `floor: $6`, el knob que existe justo para "esta superficie ya tenía más
aire".

⚠️ **Corrección numérica del fix-loop**: la primera entrega dijo "24" como valor de `$6`. **`$6` de la
escala `space` vale 32** (default de `@tamagui/config/v4`; y lo confirma en runtime la assertion de la
capture, que mide `32px` en el `TagScanSheet` — `max(inset 0 + $6, piso 12)`). El delta REAL, con el
teclado cerrado, es:

| | antes | después | |
|---|---|---|---|
| web | 32 | **32** | idéntico — cero cambio observable |
| iOS | 32 | **34** | manda el inset del home indicator |
| Android gestos (inset 24) | 32 | **48** | |
| Android 3 botones (inset 48) | 32 | **64** | el CTA sale de debajo de la barra |

Los cuatro números están **fijados por test** (`app/src/utils/footer-action.test.ts`, caso "los 3 sheets
que tenían `paddingBottom=\"$6\"` FIJO"), no calculados en prosa. Corregidos también los comentarios de
los dos sheets de tratamientos, `docs/backlog.md`, `docs/design-system.md` §4 y la reconciliación de la
spec 02, que decían 24.

**`BulkConfirmSheet` usa `useSafeBottomInset`, NO la variante keyboard-aware**, y esa diferencia es la
regla de call site: no tiene ningún campo de texto y `seleccion-masiva.tsx:404` lo monta como **HERMANO**
del `KeyboardAvoidingShell` (no adentro), así que su borde inferior **no sube** con el teclado —
encogerle la reserva sería mentir sobre una barra que sigue estando.

**La CLASE, no las instancias**: que sean 3 y no 2 es la evidencia de que esto no se cierra a mano. La
entrada de `docs/backlog.md` se **retituló por criterio** ("todo contenido anclado al borde inferior con
reserva de token fijo en vez del hook"), se declaró **ABIERTA sin guard que vea la omisión**, y se dejó
constancia de que la enumeración exhaustiva está pendiente. La versión anterior de esa misma entrada
—titulada *"quedaban 2 sheets fuera del hook"*— cometía **el error que documentaba seis líneas más
arriba**: registrar las instancias del día en lugar del criterio.

---

## 3. Pantallas de TAB: `tabBarHideOnKeyboard`

`animales` y `mas` son pantallas de tab. El bottom-nav **lo dibuja el Navigator, fuera de la pantalla**,
así que ningún `KeyboardAvoidingShell` de adentro puede subirlo, y el frame de la pantalla termina
`navHeightTotal` (≈120dp en Android 3 botones) **por encima** del borde de la ventana. Con el shell
aplicando `paddingBottom = K` sobre ese frame, el contenido habría quedado `navHeightTotal` **por encima
del teclado**: hueco muerto grande.

Verificado en el código instalado (`expo-router/build/react-navigation/bottom-tabs/views/BottomTabBar.js`):
`tabBarHideOnKeyboard` existe, usa `useIsKeyboardShown` con los MISMOS eventos que nuestro
`useKeyboardVisible` (`keyboardDidShow`/`keyboardDidHide` en Android, `Will*` en iOS) y, al esconderse, la
barra pasa a `position:'absolute'` → **sale del flujo** y la pantalla ocupa la ventana entera, que es la
geometría para la que el shell está calculado. Se puso en `screenOptions` (las 3 tabs sin input nunca lo
disparan) con el porqué escrito al lado. **Cambia iOS también** (la barra se esconde al tipear): es la
conducta estándar de una pantalla de búsqueda y está declarado.

---

## 4. El guard dado vuelta (`app/src/components/keyboard-avoiding-guard.test.ts`)

**La pregunta vieja** ("¿alguien usa mal el `KeyboardAvoidingView`?") no puede ver `identificar.tsx` por
construcción. **La pregunta nueva**: *¿hay algún campo de texto que no esté adentro del primitivo?*

### Diseño (todo COMPUTADO; lo único declarado a mano son las partes y las excepciones)

| concepto | cómo se obtiene |
|---|---|
| **SEMILLA** | dos señales en OR: (a) el JSX de entrada de texto directo `<TextInput>` / `<Input>` / `<TextArea>`; (b) el handler **`onChangeText`**, la prop que solo existe en esa familia. ⚠️ **La primera entrega afirmó que la semilla era "completa por construcción": era FALSO** y el reviewer lo falsificó ejecutando (un `import { TextInput as Campo }` renderiza `<Campo/>`, que el tag no ve). Lo que SÍ es cierto: en RN toda entrada de texto termina en un `TextInput`, así que existe siempre un archivo raíz que lo importa y el CIERRE propaga desde ahí; lo que la semilla puede no ver es el **nombre** con el que ese archivo lo escribe. La señal (b) tapa el alias; el resto (un `React.createElement`, un `styled(TextInput)` de terceros) queda como límite **declarado** en el header del guard. |
| **CIERRE** | si un archivo monta un componente exportado por un archivo con obligación **no resuelta**, la hereda. Así entran los ~25 consumidores de `FormField`, los de `GroupSearchBar`, `CustomFieldInput`, etc. |
| **PROVEEDOR** (= cubierto) | **punto fijo desde el primitivo**: abre-y-cierra `<KeyboardAvoidingShell>`, o abre-y-cierra un componente exportado por otro proveedor. **Nada de listas de "lo cubre X" escritas a mano.** |
| **PARTE** | declarado con motivo: componente de entrada reusable que no es una superficie y no puede cubrirse solo. **Propaga** la obligación a cada consumidor. |
| **EXCEPCIÓN** | declarado con motivo **y** con un `marker` que el guard exige encontrar **en la cabecera del propio archivo**. |
| **VIOLACIÓN** | todo lo demás del cierre. |

Las 4 propiedades pedidas:

1. *Enumerar estáticamente lo que renderiza una entrada de texto* → semilla + cierre. Los wrappers propios
   (`FormField`, `PhoneField`, `CustomFieldInput`, `GroupSearchBar` y los que aparezcan) **no se listan a
   mano**: los descubre el cierre, porque exportan un componente que a su vez monta un `TextInput`.
2. *Cada archivo clasificado* → las 4 categorías de arriba.
3. *Un archivo nuevo con un input, sin clasificar, pone el guard en ROJO* → cae en la semilla, no es
   proveedor, no es parte, no es excepción → violación. **El default de una superficie nueva ya no puede
   ser "rota en silencio".**
4. *Si la entrada dice "lo cubre X", el guard verifica que X siga montando el shell* → es más fuerte que
   eso: la cobertura **no se declara**, se calcula. `sign-in.tsx` está cubierto **porque**
   `AuthScreenShell` monta el primitivo; si dejara de montarlo, deja de ser proveedor y arrastra a las 9
   pantallas que colgaban de él.

**Dos propiedades más, agregadas en el fix-loop** (ninguna estaba pedida en el spec original; salen de que
las dos veces que un guard de este repo falló, falló **en silencio**):

5. *La semilla no se queda corta* → un test la contrasta contra un **ORÁCULO INDEPENDIENTE**, armado con
   otras firmas (`keyboardType=`, `secureTextEntry`, `multiline=`, `autoCapitalize=`): todo archivo que el
   oráculo ve tiene que estar en el cierre del guard. Hoy: **0 invisibles**. Si las dos señales de la
   semilla fueran ciegas al mismo caso, esto lo delata en vez de dar verde.
6. *El guard verifica su PROPIA cobertura antes de declararse verde* → `assertScanCoverage` (abajo).

### Las falsificaciones, una mutación por vez (sobre el árbol REAL) — 3 de la 1ª entrega + 5 del fix-loop

| mutación | resultado | revertido |
|---|---|---|
| **(a)** archivo nuevo `app/pantalla-falsificacion.tsx` con un `<TextInput />` sin clasificar | 🔴 `1 fail`: `'app/pantalla-falsificacion.tsx (input directo)'` | ✅ 10/10 verde |
| **(b)** sacarle el wrap a `maniobra/identificar.tsx` (borrar el par de tags del shell) | 🔴 `2 fail`: la REGLA B lo lista como violación **y** el test de anclaje dice `identificar.tsx tiene que montar el primitivo` | ✅ 10/10 verde (`git diff --stat` confirma el archivo restaurado) |
| **(c)** que `AuthScreenShell` deje de montar el primitivo (`<KeyboardAvoidingShell>` → `<View>`) | 🔴 `2 fail`: **9 pantallas de auth** en rojo (`sign-in`, `sign-up`, `forgot-password`, `update-password`, `cambiar-email`, `crear-campo`, `editar-campo`, `invitar`, `invite`) **+** el test de shells derivados nombrando al culpable | ✅ 10/10 verde |

Además, 8 falsificaciones sintéticas dentro del propio test (árbol de mentira, sin tocar el repo):
self-closing no cubre, un import no cubre, una mención en comentario no cuenta, una parte propaga, un
consumidor cubierto **corta** la propagación hacia su padre, y la cadena de 3 niveles se rompe al romper
el eslabón del medio.

**Falsificaciones del fix-loop** (todas sobre el árbol REAL, una mutación por vez):

| mutación | resultado | revertido |
|---|---|---|
| **(d)** `app/falsificacion3.tsx` con `import { TextInput as Campo } from 'react-native'` + `<Campo onChangeText/>` | 🔴 `1 fail`: `'app/falsificacion3.tsx  (input directo)'` | ✅ 12/12 verde (archivo borrado) |
| **(d-bis)** con ESE archivo presente, volver la semilla a **solo el tag** (la versión que decía ser "completa por construcción") | 🔴 la REGLA B lo deja pasar **VERDE** — el agujero, demostrado — y lo cazan los otros 3 tests, entre ellos el del **oráculo independiente** | ✅ revertido |
| **(e)** romper el glob: `join(APP_ROOT,'src')` → `'srcs'` en el guard del teclado | 🔴 `5 fail`, con `[keyboard-avoiding] escaneó 98 archivos y el piso es 300` | ✅ 12/12 verde |
| **(e-bis)** el MISMO glob roto en los guards de la reserva y de los worklets | 🔴 solo cae la **auto-verificación**: sus 8 tests de firmas pasan **VERDE** escaneando 98 archivos en vez de 364 — justo el modo de falla silencioso que B4 vino a cerrar | ✅ 15/15 verde |
| **(f)** que el stripper se coma archivos (volver al blanqueo VIEJO de dos regexes) | 🔴 los **4** guards en rojo por `LLAVES DESBALANCEADAS`, nombrando `identificar.tsx` (−3), `asignar-caravanas.tsx` (−2), `FindOrCreateOverlay.tsx` (−2); los otros **27** tests siguen verdes | ✅ 31/31 verde |

### Límite declarado del guard

Es de **granularidad de ARCHIVO**: verifica que un archivo monte *un* contenedor con keyboard-avoidance,
no que *cada* input esté adentro de ese contenedor. El caso real que lo motiva está escrito en el header:
`crear-animal.tsx` monta `<FooterActionShell>` **y además** monta `<LinkCalfPrompt>` fuera de su cierre —
para el guard el archivo estaba cubierto y el prompt igual quedaba tapado. Se cerró dándole al prompt su
propio shell. Un parser de JSX que ubique cada input en el árbol sería la versión fuerte; hoy no se paga.

### Hallazgo colateral: los guards tenían líneas ciegas — **556, no 1008** (número corregido)

Al escribir el motor descubrí que el blanqueo de comentarios que usaban los guards (dos regexes: bloques
primero, líneas después) abre un **bloque FALSO** ante un `/*` escrito **dentro de un comentario de
línea** y se come todo hasta el próximo cierre de bloque del archivo. En `FindOrCreateOverlay.tsx` el
comentario de la línea 91 termina con «La vía que NO toca `ble/*`.» → el falso bloque va de la **línea 91
a la 229** (139 líneas de span, **84 de ellas código**: la declaración del componente y su JSX), en una
pantalla 🔴 de la manga. *(Este sub-dato sí reproduce: verificado buscando el `ble/*` y su próximo `*/`.)*

**LA MEDICIÓN, CON LA MÉTRICA DECLARADA** (lo que la primera entrega no hizo):

> **Métrica**: *líneas de CÓDIGO que el escáner viejo dejaba invisibles* — una línea cuenta si, tras el
> blanqueo CORRECTO, tiene algo distinto de espacios, y tras el blanqueo VIEJO queda ENTERA en blanco.
> **Universo**: los `.ts`/`.tsx` de `app/app` + `app/src` **sin** los `.test.*` (exactamente lo que los
> guards escanean, con su mismo `listFiles`). **Árbol**: `fc4d164` (el baseline), exportado con
> `git archive`.
>
> **Resultado: 556 líneas en 6 archivos.** Per-file: **341** `app/maniobra/identificar.tsx` · **113**
> `app/asignar-caravanas.tsx` · **84** `app/_components/FindOrCreateOverlay.tsx` · **10**
> `app/_layout.tsx` · **6** `src/services/sigsa/sigsa-validator.ts` · **2**
> `src/services/sigsa/sigsa-txt-generator.ts`.

Otras lecturas medidas con el mismo script, para que se vea que **ninguna** da 1008/57: repo entero
(mismo criterio, sin `.test.*`) **568 / 7**; "cualquier línea con blanqueo distinto" **560 / 8**; *span*
del rango tragado **908 / 8**. **El 1008/57 de la primera entrega no reproduce con ninguna métrica y los
per-file tampoco** (decía 357/117/102/89 y la medición da 341/113/**10**/84 — el "102 en `_layout.tsx`"
no existe bajo ninguna lectura). Estaba hardcodeado en 3 docblocks de guards commiteables, en la spec 03,
en `progress/current.md` y acá: **corregido en los seis lugares**. Un guard que documenta su propio
historial con un número inventado es exactamente el modo de falla que esta unidad vino a cerrar.

Invertir el orden de los dos regexes no arregla nada (rompe los bloques con una URL adentro).

Fix: `app/src/utils/strip-comments.ts` — escáner **con estado** (código / comentario de línea / bloque /
string), con tests que incluyen el contrafáctico del blanqueo viejo. Los **3 guards existentes**
(`safe-bottom-inset`, `worklet-callbacks`, `phone-field`) migraron a él y siguen **en verde**: en las 556
líneas que no miraban **no había violaciones escondidas** (buena noticia, y ahora sí las miran).

### La auto-verificación de cobertura de cada guard (B4 del fix-loop)

*"Un verificador roto y un verificador que no encuentra nada se ven exactamente igual: verde."* Los dos
fallos de esta unidad tienen esa forma —el guard viejo chequeaba el predicado equivocado; el blanqueo
recortaba la entrada sin avisar—, así que los **4 guards que escanean archivos** ahora auditan su PROPIA
entrada antes de declararse verdes (`app/src/utils/scan-coverage.ts`, un módulo puro sin imports de Node
para que type-checkee bajo el `tsconfig` del cliente):

| chequeo | qué caza | calibración |
|---|---|---|
| **(A) piso de archivos** | el glob dejó de matchear (carpeta movida/renombrada, `listFiles` roto) | hoy 364 archivos (`app/app`+`app/src`) → piso **300**; phone-field 153 → piso **125** |
| **(B1) balance de LLAVES por archivo** | el blanqueo se comió un pedazo del fuente: se lleva llaves de apertura y deja cierres huérfanos (**profundidad negativa**) | hoy los 364 cierran en 0; con el blanqueo viejo dan **−3 / −2 / −2** en los 3 archivos afectados |
| **(B2) retención por archivo** | el caso extremo del enunciado ("1270 líneas que quedan en 200" = 0.157) | solo archivos ≥150 líneas no-blancas; piso **0.25** (mínimo real medido: **0.343**) |

**Honestidad sobre (B2), que es lo que más importa acá**: la RETENCIÓN **sola NO habría cazado el bug
histórico**. Medido: `identificar.tsx` pasa de **0.814** (escáner correcto) a **0.529** con el blanqueo
viejo — muy por encima de cualquier piso sensato. El que lo caza es el **balance**. Por eso están los dos,
y por eso el piso de retención es bajo: no es la red principal, es la red del caso extremo. Se eligen las
llaves y **no** los paréntesis porque en JSX una llave suelta es error de sintaxis (`{` siempre abre un
contenedor de expresión) mientras que los paréntesis aparecen sueltos en el texto de la UI
("Dosis (opcional)") y darían falsos positivos — verificado: con paréntesis, 6 archivos del repo
desbalancean (todos `.test.ts`, que los guards no escanean); con llaves, **cero**.

Lo que esto **no** cubre, declarado en el header del módulo: un blanqueo que blanquee **de menos** (ese
fallo es ruidoso, no silencioso) y que el PREDICADO del guard sea el equivocado (eso se cierra
falsificando, no desde acá).

---

## 5. El backlog mentía — corregido

`docs/backlog.md` decía *"qué queda: `TagScanSheet`"*, en singular. **Eran seis** sheets a mano con input
(`TagScanSheet`, `FindOrCreateOverlay`, `SugerenciaVaciasSheet`, `TreatmentStartSheet`,
`TreatmentApplicationSheet`, `LinkCalfPrompt`) y el universo real eran 23 superficies. La entrada quedó:

- **corregida y cerrada**, con la lección escrita: un pendiente de CLASE se registra con el **criterio**
  ("todo sheet a mano con input"), no con la instancia que se vio ese día, y se cierra con un **guard que
  enumere**, no con una lista a mano. Registrado también el daño concreto: un reviewer y el leader
  aceptaron "es backlog legítimo" mirando **1 caso** cuando había 6.
- **entrada nueva**: migrar los 6 sheets a mano a `BottomSheetShell` (con la lista de lo que hoy se
  pierden: guard anti click-huérfano, arrastre, `BackHandler` de Android, condensación, affordance de
  scroll, X de cierre) + la adopción de `FooterActionShell` en `identificar`. Con el porqué de por qué NO
  se hizo acá.
- **entrada nueva** *(reescrita en el fix-loop)*: el guard de la reserva inferior **no puede ver una
  omisión** (un `paddingBottom` con token fijo en algo anclado al borde) — que fue exactamente cómo los
  sheets de tratamientos se escaparon de la unidad «aire».

  ⚠️ **Y esa entrada nueva repetía el error que la de arriba documenta**: se titulaba *"quedaban **2**
  sheets fuera del hook"*, o sea las instancias vistas ese día, seis líneas debajo de la lección que dice
  que un pendiente de CLASE se registra por criterio. El reviewer lo destapó encontrando una **tercera**
  (`BulkConfirmSheet`). Quedó **retitulada por criterio** — *"todo contenido anclado al borde inferior que
  reserva con un token FIJO en vez del hook"* —, marcada **🔓 CLASE ABIERTA, sin guard que la vea**, con
  las 3 instancias cerradas listadas como *"NO es la enumeración completa"*, con la **enumeración
  exhaustiva declarada PENDIENTE**, y con el próximo paso escrito como cierre de la CLASE (una regla
  análoga a la REGLA B en `safe-bottom-inset-guard`), no de las instancias.
- **entrada nueva 🔴** *(fix-loop, M2)*: el **back de Android con un sheet a mano abierto hace pop de la
  ruta**. Estaba como una línea más dentro de "lo que se pierden por no estar en el primitivo"; pasó a
  entrada propia con su criticidad: el peor caso es `FindOrCreateOverlay`, overlay **global**
  (`_layout.tsx:615`) que puede estar abierto sobre la manga 🔴, invisible desde web, con el fix mínimo
  del interín anotado.

---

## 6. Verificación

### `node scripts/check.mjs` — **RC=0** (output literal, corrida final sobre el árbol final)

```
-- 2c. Lint anti-hardcode (ADR-023 §4) ---------------
[OK]    Anti-hardcode (ADR-023 §4): 0 violaciones en app/app + app/src/components

-- 3. Ejecutando tests -------------------------------
    > node scripts/run-tests.mjs
>>> typecheck client
    cd app && pnpm.cmd typecheck
> rafaq-app@0.1.0 typecheck  (app/)
> tsc --noEmit
<<< typecheck client OK
...
All tests passed.
[OK]    Tests verdes

-- 4. Resumen ----------------------------------------
[OK]    Entorno listo. Podés trabajar.
RC=0
```

*(Se corrió **cuatro** veces en este fix-loop: la 1ª cazó el `TS2591` de `scan-coverage.ts`; las tres
siguientes dieron RC=0. La que se transcribe arriba es la ÚLTIMA, sobre el árbol tal como queda — se
re-corrió entera incluso después de un cambio que era solo de comentario, para que el RC=0 que reporto sea
el de este árbol y no el de uno anterior.)*

⚠️ **Alcance declarado**: `check.mjs` **NO corre E2E** (typecheck + unit/guards + suites backend). No se
reporta como si lo hiciera. La E2E de abajo se corrió **aparte**, a mano.

> **La primera corrida del fix-loop salió ROJA y vale registrarla**, porque la encontró la herramienta y
> no yo: `src/utils/scan-coverage.ts(39,20): error TS2591: Cannot find name 'node:assert/strict'`. El
> módulo nuevo vive en `app/src`, que el `tsconfig` del cliente type-checkea **sin** los tipos de Node
> (los guards pueden usarlos sólo porque `**/*.test.ts` está excluido). Reescrito sin ningún import de
> Node —señaliza con `throw new Error(...)`, que `node:test` reporta igual que un assert— y **las dos
> falsificaciones de B4 se re-corrieron contra esa versión final**, no contra la que ya no existe.

Los tests que esta unidad tocó, corridos aislados (2ª entrega):

| archivo | tests |
|---|---|
| `components/keyboard-avoiding-guard.test.ts` | **12/12** (era 10: +1 oráculo independiente, +1 auto-verificación) |
| `utils/safe-bottom-inset-guard.test.ts` | **11/11** (+1 auto-verificación) |
| `components/worklet-callbacks-guard.test.ts` | **4/4** (+1) |
| `components/phone-field-guard.test.ts` | **4/4** (+1) |
| `utils/strip-comments.test.ts` | **11/11** (era 8: +3 de la variante que blanquea strings) |
| `utils/footer-action.test.ts` | **22/22** (+1: los 4 valores por plataforma del `floor: $6`) |

### E2E — comparado contra BASELINE, no contra la nada

Hay **22 rojos pre-existentes** en `fc4d164`. Se comparó **corriendo el baseline** (stash → build → run →
pop, con el patch verificado idéntico byte a byte antes y después).

| lote | con mis cambios | baseline `fc4d164` | veredicto |
|---|---|---|---|
| `maniobra-identify` + `animals` + `baston-dedup` + `maniobra-vacias-lote` | 52 passed / **9 failed** | 55 passed / **6 failed** | ver abajo |
| `animals` sola | 33 / **4** | 34 / **3** | la identidad de las fallas **varía entre corridas** |
| las 3 "extra" en aislamiento (`MULTÍPARA`, `RCAP.4/5`, `Torito`) | 2 passed, **1 failed** (`Torito`) | `Torito` también falla en el baseline | flakes de orden/estado de DB; `Torito` es pre-existente |
| 17 specs de las superficies tocadas (sheet-teclado, cta-siempre-visible, treatments, alta-bastoneo, baston-ficha, cria-al-pie-bastoneo, lotes, rodeo-grande, rodeos, establishments, profile, sigsa-export, operaciones-vacunacion, operaciones-castracion, baston, ficha-paridad, auth) | **49 passed / 2 failed** (51 tests) | **las 2 mismas fallan igual en el baseline** (verificado en aislamiento, con el mismo mensaje) | **sin regresión** |

> **Sobre el conteo del último lote — RE-CORRIDO en el fix-loop.** El reviewer marcó que el real era
> "65/2" y no "49/2". **Volví a correr las 17 specs sobre un build fresco** (que ya incluye el fix de
> `BulkConfirmSheet`) y la salida literal de Playwright es:
>
> ```
> [51/51] [chromium] › e2e/treatments.spec.ts:115:5 › offline: iniciar tratamiento sin conexión …
>   2 failed
>     [chromium] › e2e/lotes.spec.ts:61:5 › crear lote → asignar desde la ficha → ver miembros
>     [chromium] › e2e/treatments.spec.ts:36:5 › ficha: iniciar → marca en hero → … → marca desaparece
>   49 passed (4.7m)
> ```
>
> O sea **51 tests = 49 passed + 2 failed**, y son **las mismas dos** de la primera corrida. Coincide con
> el conteo ESTÁTICO: `grep -cE '^\s*(test|it)(\.(only|skip))?\('` sobre esos 17 archivos da 51
> declaraciones (`playwright.config.ts` tiene **un** solo project, `chromium`, así que no se multiplican).
> **En este punto el número del reviewer es el que no reproduce**; el 49/2 se sostiene. No adopté su cifra
> ni defendí la mía a priori: la volví a medir.

Las 2 del último lote, con su diagnóstico (los dos **pre-existentes verificados**, no atribuibles):
- `lotes.spec.ts` "crear lote → asignar desde la ficha": `getByText(...).first()` resuelve 42 veces pero
  `Received: hidden` → es el **bug de oráculo `.first()`** que el leader ya había clasificado (el
  `.first()` agarra un duplicado oculto de una pantalla que sigue montada detrás).
- `treatments.spec.ts` "ficha: iniciar → …": `getByRole('tab', {name:'Animales'})` **no está en el DOM**
  estando en la ficha (pantalla pusheada sobre las tabs). Idéntico en el baseline.
- Las 3 de `maniobra-vacias-lote` fallan **3 vs 3** y el error es de **seeding**
  (`seedAnimal category: Cannot coerce the result to a single JSON object`), no de UI.

**Verificación mecánica extra** (script ad-hoc sobre el árbol real, no es un test permanente): **ningún
archivo monta un proveedor de keyboard-avoidance dentro del rango de otro** → cero anidamientos, cero
doble descuento del teclado. 42 proveedores.

### Gate 2.5 — capture file (`app/e2e/captures/barrida-teclado.capture.ts`) — **3/3 passed**

7 capturas en `__shots__/barrida-teclado/` (gitignoreadas; el `.capture.ts` se commitea):

```
01-identificar-hero-banda-colapsada.png     04-animales-lista.png
02-identificar-manual-expandida.png         05-animales-buscador-enfocado.png
03-identificar-input-enfocado.png           06-tag-scan-sheet-abierto.png
                                            07-tag-scan-manual-input-enfocado.png
```

**Límite honesto, declarado en el header del archivo**: este bug es **estructuralmente invisible en web**
— RNW no monta teclado virtual, ninguna captura puede mostrar el lift, y un test web que dijera "lo
cubre" sería un falso verde. Lo que las capturas **sí** prueban es la otra mitad del contrato: cada
estado con foco trae una assertion de runtime que compara la caja del elemento clave contra la del MISMO
estado **sin** foco (CTA "Buscar" de `identificar`, buscador de `animales`, hoja del `TagScanSheet`) más
la reserva computada del sheet (**`32px`**). Si envolver la columna hubiese corrido o colapsado algo en
web, esas comparaciones caen.

⚠️ **La EXPLICACIÓN de ese 32px estaba mal** (corregida en el fix-loop, también en el comentario del
capture): decía "piso de web 12 + su `$6` propio", que además de no sumar es la fórmula equivocada. El
`extra` se suma al **inset del sistema** y recién ahí compite con el piso: `max(0 + $6, 12)`. Con `$6` = 32
(la escala `space` de `@tamagui/config/v4`) da 32. El número medido siempre estuvo bien; lo que estaba mal
era cómo lo justifiqué — y de hecho **este 32px medido en runtime es la prueba de que `$6` vale 32 y no 24**,
que es el error que arrastraba el resto del informe.

*(Nota metodológica: el primer intento del oráculo del sheet comparaba la caja **entre dos contenidos
distintos** (hero de escaneo vs carga manual) y falló por 410→344px. Eso no era una regresión: el sheet
es content-sized. Se corrigió a medir antes/después del **foco**, que es lo que el oráculo promete.)*

### Higiene del árbol

`git status --porcelain design/` → **0 líneas** después de correr `e2e:build` + la suite E2E + el capture.
Nada commiteado. Los únicos `??` son los 4 archivos nuevos de la unidad
(`utils/strip-comments.ts` + `.test.ts`, `utils/scan-coverage.ts`, `e2e/captures/barrida-teclado.capture.ts`)
más este informe.

> **Nota que no es mía**: `.claude/agents.zip`, que aparecía como `??` al arrancar esta sesión, ya no
> está en el árbol. **No lo toqué** (nunca escribí ni borré nada bajo `.claude/`). Lo dejo asentado por si
> fue otra terminal.

### Lo que NO está verificado y es de Raf (ADR-029)

**Veredicto en DEVICE, Android *e* iOS.** Estas 23 superficies estaban rotas en **las dos** plataformas
(el reporte original de Raf del 25 fue en iOS), así que **iOS también cambia y está bien**: es
roto→arreglado, no una regresión. iOS no se puede re-testear hasta el 1/8 por cuota de EAS → el cambio se
mantuvo **mínimo y auditable leyendo** (un wrap + un hook por superficie; ninguna reestructuración).
A mirar en device: (a) que en cada superficie el contenido suba y quede a `$2` del borde del teclado, sin
hueco; (b) que en `animales`/`mas` la tab bar se esconda al tipear y vuelva al cerrar; (c) que los 6
sheets a mano sigan con el scrim cubriendo la pantalla entera; (d) no-regresión del arrastre, del back de
Android y del crash del worklet.

---

## 7. Autorrevisión adversarial (qué busqué, qué encontré, cómo lo cerré)

| qué busqué | resultado |
|---|---|
| **Superficies que se me escaparon** | Re-derivé el universo por cierre transitivo en vez de confiar en la lista: aparecieron `GroupViewScreen` (el inventario nombraba `GroupSearchBar`, que es una PARTE — el wrap va en la pantalla) y las 6 partes del wizard de maniobra, ya cubiertas por `carga`. Hoy el guard dice **0 sin clasificar**. |
| **Doble reserva / hueco muerto** | Barrido mecánico: de los 42 proveedores, el único que usa `useSafeBottomInset()` "crudo" es `crear-rodeo.tsx`, y es su **segunda pantalla** (`ImportPrompt`, sin input, fuera de todo shell) → correcto. Los demás usan el hook keyboard-aware. |
| **Scrims rotos en los sheets** | Verificado archivo por archivo: en los 6, el `View position:absolute + $scrim` sigue siendo el **outermost** y el shell va adentro envolviendo backdrop + hoja. Confirmado además visualmente en `06-tag-scan-sheet-abierto.png` (scrim cubriendo, hoja anclada abajo). |
| **Shells anidados (doble descuento)** | Script sobre el árbol real: **0**. Los sheets-overlay quedaron como hermanos en `identificar` (4), `animal/[id]` (4), `LinkCalfPrompt` (1), `export-sigsa` (1), `seleccion-masiva` (1); `crear-animal` y `agregar-evento` ya los tenían fuera de su `FooterActionShell` y no se tocaron. |
| **Que el guard pase por la razón equivocada** | 3 falsificaciones sobre el árbol real + 8 sintéticas. La (c) es la que más me importaba: prueba que la cobertura **no es una declaración**. En el fix-loop se sumaron 5 más (alias de import, semilla vieja, glob roto ×2, stripper roto). |
| **Tests que miran menos de lo que dicen** | Encontré que el blanqueo de comentarios de los guards dejaba líneas ciegas (**556 en 6 archivos**, métrica declarada). Cerrado con un escáner con estado + tests, los 3 guards existentes migrados **y**, en el fix-loop, la auto-verificación de cobertura en los 4. |
| **Cambios silenciosos de geometría** | Los 3 sheets con `paddingBottom` fijo cambian su reserva con el teclado CERRADO (iOS +2, Android gestos +16, Android 3 botones +32). Declarado con el delta **fijado por test** en 4 lugares (acá, backlog, design-system §4, specs 02 y 10) en vez de pasar de contrabando dentro de la barrida. |
| **E2E: atribuirme rojos ajenos** | No se declaró nada verde ni nada roto sin correr el **baseline** del mismo lote. Las 2 fallas del lote grande se reprodujeron **idénticas** en `fc4d164`. |

### 7-bis. Autorrevisión del FIX-LOOP (lo que busqué en mi propio arreglo)

| qué busqué | resultado |
|---|---|
| **Que los números nuevos tampoco resistan** | Al medir el delta de `BulkConfirmSheet` descubrí que **`$6` no vale 24 sino 32** — o sea que los números de los 2 sheets de tratamientos, que la 1ª entrega dio por buenos, **también estaban mal** (en el código, en el backlog y en la spec 02). Corregidos los tres lugares y **fijados por test** (`footer-action.test.ts`) para que no dependan de mi aritmética. El reviewer no había pedido esto: salió de aplicar su criterio al resto del informe. |
| **Que la corrección del `1008` sea la de verdad** | Reimplementé el blanqueo viejo y medí **4 métricas** sobre el árbol de `fc4d164` exportado con `git archive`. La que declaro (556/6) coincide **exactamente** con la del reviewer, per-file incluido (341/113/84/10). Las otras tres las dejo escritas para que se vea que ninguna da 1008/57. |
| **Que la cifra E2E del reviewer fuera la correcta por default** | No la adopté: **volví a correr** las 17 specs. Da **49/2 sobre 51**, que es lo que yo había reportado; el conteo estático de `test(` en esos archivos también da 51 y el config tiene un solo project. Acá el que no reproduce es su número. |
| **Falsos positivos del chequeo de balance** | Corrí la invariante sobre los **499** archivos `.ts/.tsx` de `app/app`+`app/src`: con llaves, **0** archivos desbalanceados entre los que los guards escanean (los 6 que dan ≠0 son todos `.test.ts`, excluidos por `listFiles`). Con paréntesis habría falsos positivos → descartados, con el motivo escrito. |
| **Que el piso de retención sea teatro** | Lo es en parte, y lo digo: **no habría cazado el bug histórico** (0.529 > cualquier piso sensato). Medí la distribución real (mínimo 0.343 en archivos ≥150 líneas) para calibrarlo y agregué el **balance de llaves**, que sí lo caza (−3/−2/−2). |
| **Que `assertScanCoverage` se saltee archivos en silencio** | El lookup del `allow` usaba `in`, que da `true` para `toString`/`constructor` heredados de `Object.prototype` → un archivo así quedaría exento sin que nadie lo declare. Cambiado a `hasOwnProperty`. Es improbable con paths, pero es la misma clase de omisión que este módulo existe para no repetir. |
| **Que el módulo nuevo rompa el typecheck del cliente** | Sí lo rompía: `scan-coverage.ts` vive en `app/src` (que el `tsconfig` type-checkea **sin** tipos de Node, porque los `*.test.ts` están excluidos) e importaba `node:assert`. Lo encontró `check.mjs`, no yo. Reescrito **sin ningún import de Node**: señaliza con `throw new Error(...)`, que `node:test` reporta igual. |
| **Que las falsificaciones sigan valiendo después de ese cambio** | Las **re-corrí las dos** contra la versión final basada en `throw` (no me quedé con las de la versión basada en `assert`). |
| **Que el fix de `BulkConfirmSheet` mueva algo en web** | No: `max(0 + 0, 12, 32) = 32`, idéntico al `$6` que tenía. Confirmado además por E2E — `operaciones-castracion` y `operaciones-destete` corren sobre un build que ya incluye el cambio. |

---

## 8. Reconciliación de specs y docs

| archivo | qué se reconcilió |
|---|---|
| `docs/design-system.md` §4 | La reserva keyboard-aware (`useKeyboardAwareBottomInset`) con la regla de call site y el porqué de los dos hooks; los **10** call sites con knobs (antes decía 5, después 9) y los **3** que se sumaron con `floor: $6`, con el delta corregido (32, no 24) y la CLASE marcada como abierta. |
| `docs/design-system.md` §6 (`KeyboardAvoidingShell`) | El contrato pasa a incluir **toda superficie con input** (no solo la que tiene footer con CTA): las 4 formas del wrap, `tabBarHideOnKeyboard` para tabs, y las dos reglas del guard (A y B). |
| `docs/backlog.md` | Entrada corregida + cerrada (era 1 sheet, eran 6) con la lección; entrada nueva de migración de los 6 sheets al primitivo; entrada de la ceguera del guard de la reserva **retitulada por CRITERIO** y marcada 🔓 CLASE ABIERTA (con las 3 instancias, la enumeración exhaustiva pendiente y el próximo paso como cierre de clase); entrada nueva 🔴 del **back de Android** con un sheet a mano abierto. |
| `specs/active/03-modo-maniobras/design.md` | **As-built v13**: corrige dos afirmaciones de la v7 (los sheets no migrados y el alcance del contrato) + `identificar` + `SugerenciaVaciasSheet` + el hook + el guard dado vuelta. |
| `specs/active/03-modo-maniobras/tasks.md` | **As-built v14**, con la lista completa de archivos. |
| `specs/active/09-buscar-animal/design-09resto-ble-global.md` | `FindOrCreateOverlay`, `asignar-caravanas`, `(tabs)/animales` (+ el porqué de `tabBarHideOnKeyboard`). |
| `specs/active/02-modelo-animal/design-caravana-ficha.md` | `TagScanSheet`, `animal/[id]`, `LinkCalfPrompt`, los 2 sheets de tratamientos (con el delta de la reserva **corregido a 32**) y `animal/baja`. |
| `specs/active/08-export-sigsa/design.md` | `export-sigsa` (los 2 campos de fecha + el overlay que queda afuera). |
| `specs/active/10-operaciones-rodeo/design.md` | `GroupViewScreen`, `seleccion-masiva`, `vacunacion-masiva`, `lotes`, `lote/venta` **+ `BulkConfirmSheet`** (por qué entra por la reserva y no por el guard del teclado, por qué usa la variante NO keyboard-aware, el delta por plataforma, y el puntero a la clase abierta). |
| `specs/active/01-identity-multitenancy/design.md` | `mis-campos`, `(tabs)/mas`, `crear-rodeo`. |
| `scripts/run-tests.mjs` | Registra `app/src/utils/strip-comments.test.ts` (un test que no está en la lista **nunca corre**). |
| `specs/active/03-modo-maniobras/design.md` §As-built v13 *(fix-loop)* | Nota de reconciliación con los 3 puntos del fix-loop: la semilla NO era completa por construcción, la auto-verificación de cobertura, y la métrica corregida a 556/6. |
| `docs/design-system.md` §6 *(fix-loop)* | Las dos señales de la semilla + por qué el alias las motivó + la auto-verificación de cobertura de los 4 guards. |

---

## 9. Lo que me quedó dudoso (para el reviewer / el leader)

1. **`tabBarHideOnKeyboard` es la pieza con más conducta nueva.** Con el teclado abierto la tab bar
   desaparece en iOS y Android. Lo verifiqué **leyendo el JS instalado** (usa los mismos eventos que
   nuestro hook, y al esconderse pasa a `position:absolute`), no ejecutándolo — en web no dispara nunca.
   Si en device la animación de esconder/mostrar se ve brusca, el ajuste es
   `tabBarVisibilityAnimationConfig`, no revertir el flag (sin él, `animales` y `mas` quedarían con
   ~120dp de hueco muerto sobre el teclado).
2. **`GroupViewScreen` / `animales` / `mis-campos`: el `paddingBottom` del contentContainer de la lista
   NO se hizo keyboard-aware** (sigue `insets.bottom + $6`, el "scroll slack" que el guard de la reserva
   permite explícitamente). Con el teclado abierto eso deja ~72dp de scroll extra al final de la lista.
   No es un hueco que tape nada (es slack scrolleable) y tocarlo era ampliar el diff sin beneficio, pero
   si Raf lo ve raro en device, ese es el lugar.
3. **El `maxHeight` de los 6 sheets a mano** ahora se resuelve contra el alto **ya descontado** del
   teclado. ⚠️ **Corrección del fix-loop**: la primera entrega dijo "`maxHeight: 85%` en los 6". Los
   valores REALES, leídos uno por uno, son **tres distintos**: `TagScanSheet` **85%** ·
   `FindOrCreateOverlay` **85%** · `SugerenciaVaciasSheet` **85%** · `TreatmentStartSheet` **90%** ·
   `TreatmentApplicationSheet` **90%** · `LinkCalfPrompt` **88%**. (Y `BulkConfirmSheet`, el que se sumó
   en el fix-loop, **85%**.) El razonamiento no cambia —el % se resuelve contra el alto interno del padre,
   sea 85 u 88 o 90— pero el dato estaba mal y no resistía un `grep`. Es la misma lectura que
   `BottomSheetShell` documentó y allá está verificada en device; acá es por analogía, no por ejecución.
   Los sheets a mano **no** tienen el `flexShrink:1` de la envoltura del primitivo: si el contenido supera
   el cap, el `maxHeight` lo clampea igual, pero es una diferencia estructural que desaparece cuando se
   migren al primitivo (backlog).
4. **`animals.spec.ts` es ruidoso**: la identidad de sus 3-4 rojos **varía entre corridas** (dependen del
   estado acumulado de la DB dev compartida). Lo resolví aislando los sospechosos, pero conviene que
   alguien limpie ese spec: hoy no sirve como semáforo de regresión sin correr el baseline al lado.
5. **No migré los 6 sheets a `BottomSheetShell`** (decisión explícita del leader, backlogueada). Mientras
   tanto siguen sin `BackHandler` propio: **el back de Android con uno de esos sheets abierto hace pop de
   la ruta**. No es regresión de esta unidad (tampoco lo tenían en `fc4d164`) y el leader decidió NO
   arreglarlo acá, pero es la consecuencia más filosa de la deuda que queda: el peor caso es
   `FindOrCreateOverlay`, que es un overlay **GLOBAL** (`app/app/_layout.tsx:615`) y puede estar abierto
   sobre cualquier pantalla, **incluida la manga 🔴** — un "atrás" reflejo no cancela la búsqueda, desarma
   la pantalla de abajo. Quedó como **entrada 🔴 propia** en `docs/backlog.md` (no como una línea más
   dentro de la lista de lo que se pierde por no estar en el primitivo), con el fix mínimo del interín
   anotado: `useHardwareBack` en `FindOrCreateOverlay` si la migración se difiere otra vez.
