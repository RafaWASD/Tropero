# RAFAQ Design System — v4 (canónico)

**Status**: Activo (canonizado 2026-05-30, sesión 20). Cierra el item **A.1** del plan.
**Reemplaza**: el draft exploratorio "Campo Profundo" (archivado en `design/explorations/`, NO canónico).
**Fuente única de verdad**: **`app/tamagui.config.ts`** (ADR-023 §1). Este documento es la **lectura humana** de ese archivo — si hay conflicto, gana el código. Los valores literales (hex/px) viven SOLO en el config; las pantallas los consumen por token, nunca hardcodeados (ADR-023 §4, enforced por lint).

> **Cómo se canonizó**: este sistema se **derivó de construir una pantalla real** (la home + el bottom nav, que Raf firmó), no en abstracto (ADR-023 §5). Lo que está acá es lo que esas pantallas necesitaron. Crece **JIT**: cuando una pantalla nueva necesite un token/componente que no existe, se agrega entonces — no se inventa por adelantado.

---

## 1. Principios

1. **Verdad en código.** `tamagui.config.ts` define los tokens. `docs/design-system.md` (esto) los documenta. `design/tokens.json` paralelo **no existe** a propósito (sería una 2da fuente a mantener; si en el futuro se sincroniza con Figma, se genera desde el config).
2. **Cero hardcode en pantallas.** Todo color/spacing/tamaño referencia un token (`$primary`, `$4`, `borderRadius="$card"`). Valores que cruzan a APIs no-Tamagui (React Navigation, íconos lucide) se leen con `getTokenValue('$token', grupo)` — siguen referenciando el token, no son literales. Un **lint** falla el build ante hex/px literal en pantallas.
3. **Light-only en MVP.** El dark mode se difiere a post-MVP (decisión sesión 19). El sistema está arquitecturado light; cuando se agregue dark, los tokens semánticos absorben el theme sin tocar pantallas.
4. **Manga-criticidad graduada.** Aplicar el sistema NO es uniforme: en flujos **manga-only** (MODO MANIOBRAS, BUSCAR ANIMAL, campo) los targets/fonts grandes y "una decisión por pantalla" son **no negociables**; en pantallas **mixtas** (home, reportes, config) hay más margen. Detalle + criterios pro en la skill **`design-review`**.
5. **Componentes = deliverable** (ADR-023). Una pantalla es composición de componentes ya correctos (`app/src/components/`), no un acto de diseño. Eso mata el drift visual por construcción.

---

## 2. Color (paleta v4)

Base **blanco neutro** (sin tinte frío ni cálido — se mató el `#f8f9ff` de Material You de Stitch). Brand verde botella. Acento terracota reservado para alertas.

| Token | Hex | Rol / uso |
|---|---|---|
| `$white` | `#FFFFFF` | blanco puro (superficies sobre fondo, nav bar) |
| `$bg` | `#faf9f9` | fondo base de la app (neutro) |
| `$primary` | `#1e5a3e` | **verde botella** — brand, FAB, item activo del nav, CTA primario |
| `$primaryPress` | `#184a33` | estado pressed del primary (derivado) |
| `$surface` | `#F8F6F1` | **bone** — superficie de cards (cálido, SOLO cards) |
| `$terracota` | `#C0451F` | **alertas / tertiary** — reservado; no usar en headers/cards/elementos pasivos |
| `$greenLight` | `#93cfac` | verde claro — contenedores de ícono, halo del FAB |
| `$textPrimary` | `#0F0E0C` | texto principal (casi-negro de marca, no `#000` puro) |
| `$textMuted` | `#5C655F` | texto secundario, labels, items inactivos del nav, **placeholders** |
| `$textFaint` | `#807A74` | texto **terciario** — captions/metadata grandes (≥14px) y disabled/decorativo; **NO** para texto esencial chico ni placeholders |
| `$divider` | `#E5E5E3` | líneas/bordes sutiles |

**Contraste (medido, WCAG — sesión 20):** texto principal y marca en **AAA** (`$textPrimary` 18:1, `$primary` 7.7:1, blanco sobre `$primary` 8:1). Los grises y el terracota se **recalibraron a AA holgado** pensando en legibilidad bajo sol de manga (el glare baja el contraste efectivo): `$textMuted` 5.7:1, `$terracota` 4.9:1. `$textFaint` (4:1, AA-large) es **terciario**: solo captions grandes / disabled / decorativo, nunca texto esencial chico ni placeholders (esos usan `$textMuted`). **Regla**: al agregar un token de color, **medir** el contraste contra `$bg`/`$surface`/`$white` (no estimar a ojo) — skill `design-review`.

**Colores de estado (success / warning / error)** → **JIT**: el v4 todavía no los define (la home/nav no los necesitaron). Se agregan cuando se construya la **primera pantalla con chips de estado** (ej. ficha de animal con "preñada"/"vencido"). Insumo para esa decisión: la paleta de estado del draft archivado (`design/explorations/`). Por ahora, alertas puntuales usan `$terracota`.

### 2.1 Botones/chips de realce verde — regla A/B (legibilidad al sol) — canonizado 2026-07-07

`$greenLight` (#93cfac) es, por rol, **fondo de contenedores de ícono y halos** (ver tabla) — un ícono lucide `$primary` encima pasa el **3:1** de objetos gráficos (WCAG 1.4.11) y se lee bien. **NO es, por default, un fondo para TEXTO.** El combo **texto `$primary` (#1e5a3e) sobre `$greenLight` mide 4.55:1** (medido) — al filo de AA y **se vuelve ilegible al sol** (el glare de manga baja el contraste efectivo ~a la mitad). Ese combo se coló en varios botones/chips con texto (drift del rol documentado).

**Regla (para cualquier botón/chip de realce VERDE con TEXTO):**

| | Recipe | Contraste | Cuándo |
|---|---|---|---|
| **A — sólido / alto contraste** | fondo `$primary` + **texto e ícono `$white`** | **8:1** (AAA) | **En modo maniobra** (`app/maniobra/**`) y todo botón verde manga-crítico que deba destacar. Es la misma polaridad del CTA primario (`Guardar evento`). |
| **B — suave** | fondo `$greenLight` + **texto `$textPrimary`** (#0F0E0C casi-negro); el ícono puede quedar `$primary` (gráfico, pasa 3:1) o ir `$textPrimary` | **10.8:1** (texto, AAA) | **Fuera de modo maniobra**. Conserva el look "pill suave / afordancia secundaria" sin sacrificar legibilidad (no compite con el CTA de commit). |

❌ **Prohibido**: texto esencial `$primary` sobre `$greenLight` (4.55:1). ✅ Sigue OK: `$greenLight` como **container de ícono / halo / pulso / pressStyle transitorio** (sin texto encima). Ambas recetas usan **tokens existentes** (sin hex nuevo). Al elegir, guiarse por la **criticidad-manga graduada** (§1.4): maniobra = A, resto = B. Validar lo dudoso con **APCA** (Chrome DevTools) + prueba real al sol, no solo el ratio WCAG.

---

## 3. Tipografía

**Familia única: Inter** (400/500/600/700). Se carga en `app/app/_layout.tsx` (`useFonts`) bajo `Inter`, `Inter-Medium`, `Inter-SemiBold`, `Inter-Bold`. No serifs.

**Escala** (token de tamaño → px / line-height), pensada para legibilidad mobile bajo sol (body más grande que el web típico):

| Token | px | line-height | uso típico |
|---|---|---|---|
| `$1` | 11 | 16 | micro-labels (nav inactivo, captions) |
| `$2` | 12 | 17 | labels, el label "Maniobra" del FAB |
| `$3` | 13 | 18 | metadata, texto secundario |
| `$4` | 14 | 20 | **body base** (`true`) |
| `$5` | 16 | 22 | body grande, inputs |
| `$6` | 18 | 25 | subtítulos, títulos de card |
| `$7` | 20 | 28 | títulos de sección |
| `$8` | 23 | 31 | headings |
| `$9` | 30 | 38 | display |
| `$10` | 38 | 46 | display grande / hero numbers |

**Pesos**: `400` body · `500` labels · `600` subtítulos / títulos de card · `700` display / headlines.

---

## 4. Spacing, radius y tamaños

**Spacing**: se usa la **escala default de `@tamagui/config/v4`** (heredada, no se override). Las pantallas usan `$1`, `$2`, `$3`, `$4`… El mapeo px exacto vive en el config de Tamagui; la convención de uso: padding de cards/pantallas ≈ `$4`, gap entre secciones mayor.

**Radius** (custom RAFAQ sobre la escala v4):

| Token | px | uso |
|---|---|---|
| `$card` | 16 | radio de cards |
| `$pill` | 9999 | botones pill (CTA primarios), avatares |

**Tamaños / touch targets** (manga-friendly — más grandes que el web/MP típico, uso con guante; Fitts):

| Token | px | uso |
|---|---|---|
| `$touchMin` | 56 | alto mínimo de botones primarios |
| `$navBar` | 60 | alto de contenido del bottom-nav (sin insets) |
| `$navBottomMin` | 12 | **piso** del borde inferior: respiro mínimo cuando NO hay inset del sistema (web) |
| `$navBarGap` | 16 | **aire** que se SUMA al inset **solo en Android** (donde el inset ES la barra de navegación) |
| `$fab` | 64 | diámetro del FAB central (ADR-018) |
| `$fabHalo` | 72 | diámetro del halo del FAB (`fab + 8`, referencia del inset -4) |
| `$fabRaise` | 26 | cuánto FLOTA el FAB sobre la barra (`fab × 0.40`) |
| `$avatar` | 40 | avatar de usuario en el header |
| `$icon` | 48 | contenedores de ícono circulares (banner, etc.) |

**Safe areas (borde inferior)**: la reserva **nunca se calcula a mano** — se pide con el hook **`useSafeBottomInset()`** (el bottom-nav también; `computeTabBarInsetLayout` solo le suma el alto de contenido). La fórmula tiene **TRES conceptos**, no dos:

```
paddingBottom = max(insetVigente, insetArranque, $navBottomMin) + (aplicaAire ? $navBarGap : 0)
```

| término | qué es | cuándo gana |
|---|---|---|
| **inset** `max(vigente, arranque)` | lo que el SO obliga a NO tapar | siempre que exista (iOS ≈34, Android 24/48). El `max` con el de arranque es el blindaje frame-0 |
| **piso** `$navBottomMin` = 12 | respiro mínimo cuando NO hay inset | solo con inset 0 → **web** |
| **aire** `$navBarGap` = 16 | separación contra la **barra de navegación** del SO | **solo Android** |

> **Por qué el aire es solo Android.** En Android el inset inferior vale **exactamente** el alto de la barra de navegación (3 botones o gestos), que el SO dibuja como una losa opaca sobre el contenido: reservar el inset deja el contenido **apoyado sobre su borde**. En iOS el inset de 34pt es espacio **pintado con el fondo de la app** con una pildorita fina (el home indicator) adentro: el inset ya *es* el aire, y sumarle más solo come zona de pulgar (la tab bar pasaría de 94 a 110pt, 33% más alta que la nativa de iOS). En web no hay barra del sistema: manda el piso.

Resultados: **web 12 · iOS 34 · Android gestos 24+16=40 · Android 3 botones 48+16=64**.

Una superficie que necesita **más** aire que el canónico se lo pide al hook, sin copiar nada: `useSafeBottomInset({ extra: getTokenValue('$6','space') })` (aire propio, se suma al inset) o `{ floor: … }` (piso propio). Hoy solo lo usan 5 superficies, y todas porque YA tenían más aire antes de la unidad: `TagScanSheet` / `FindOrCreateOverlay` (`extra: $6`), las 3 barras de selección masiva (`extra: $3`) y `CutPromptSheet` / `TactoConfigSheet` (`floor: $4`). El knob se pide con un **token de spacing** (`$3`, `$4`, `$6`) — **nunca con `$navBottomMin`**: ese es el piso de la reserva canónica, y nombrarlo en un call site es escribir la reserva canónica de otra forma, no declarar aire propio (lo bloquea el guard).

> **Los 8 outliers del `+12` (armonizados en la unidad «aire», 2º fix-loop).** 8 call sites en 7 archivos (`animal/baja`, `crear-rodeo` ×2, `editar-plantilla`, `editar-servicio`, `import-rodeo`, `lote/[id]`, `lote/venta`) hardcodeaban `paddingBottom = insets.bottom + 12`. Se evaluó conservar ese respiro como `extra` y se **descartó**: el propio repo ya había clasificado ese `+12` como deuda —"las 14 pantallas con footer fijo hardcodean `+ 12` **en vez de usar `$navBottomMin`**" (`docs/plan-mejoras-ux-2026-07-18.md` §4)— o sea una **grafía accidental de la reserva canónica**, no aire de diseño: nadie vetó nunca "46pt en iOS" como valor. Conservarlo dejaba la app con **dos** reservas de footer conviviendo sin razón escrita (Android 3 botones: 64 canónica vs 76 en esos 8), justo en la unidad cuyo punto es que hay UNA. Al plegarlos: **web 12 (sin cambio) · iOS 46 → 34 · Android gestos 52 → 40 · Android 3 botones 76 → 64**. El iOS 34 es el valor que ya usan los otros 26 footers/sheets y el que se aprobó en device.

> ⚠️ **Las DOS fórmulas muertas** (bug 🔴, device Android, 2026-07-26 — no re-proponerlas):
> 1. `max(insets.bottom, $navBottomMin=12)`, copiada a mano en ~25 archivos. Con una barra real de 48dp, `max(48,12)=48` → la app reservaba **exactamente la barra y nada más**, y el CTA quedaba a **1dp** de ella (medido en device). El mínimo solo podía ganar con inset 0, o sea únicamente en web — por eso no se veía en el preview. No es cosmético: con el CTA soldado a la barra, un toque bajo con guante cae en "atrás"/"home" y saca al operario de la jornada (Nielsen #5, pantallas 🔴 manga).
> 2. `max(insetVigente, insetArranque) + 16` **en todas las plataformas** (primer intento de arreglo, descartado en review): arreglaba Android pero engordaba iOS (tab bar 94 → 110pt, CTAs a 50pt del borde) y borraba el piso de web (12 → 16), sin ninguna razón de diseño en ninguno de los dos casos. El error fue tratar "inset" y "aire" como aditivos **siempre**, cuando la aditividad depende de qué hay dentro del inset.
>
> Lo hace cumplir el guard `app/src/utils/safe-bottom-inset-guard.test.ts`: falla si reaparece el `max` sobre el inset, si un token del borde inferior se combina a mano con un inset, si `$navBarGap` o `$navBottomMin` aparecen **fuera del hook** (ni siquiera como argumento), si la pura se llama desde otro lado, si la decisión de plataforma se bifurca, o si el hook fija `applyGap` en un literal.
>
> Y además chequea que los tokens **RESUELVAN**, no solo que se nombren: que `$navBottomMin` y `$navBarGap` existan en el grupo `size` de `tamagui.config.ts` con un número finito > 0, que el hook los pida de **ese** grupo, y que los números que los tests puros hardcodean (`PISO`/`GAP`) sigan coincidiendo con los del config. Sin eso, un token mal escrito o movido de grupo hace que `getTokenValue` devuelva `undefined` → `nonNegative()` lo pasa a **0** → **el aire de Android desaparece y la suite entera queda verde**, porque los tests puros usan sus propias constantes y la captura E2E solo mide web (donde `applyGap` es `false` y el token ni se lee). Sería el mismo bug 🔴 original, observable únicamente en un device.

**Blindaje frame-0 Android edge-to-edge (U7/U2)**: `useSafeAreaInsets().bottom` puede reportar `0` en los primeros frames. El `SafeAreaProvider` raíz va **sembrado con `initialMetrics={initialWindowMetrics}`** (`app/app/_layout.tsx`) → el valor real está disponible desde el frame 0; además la fórmula toma el `max` entre el inset vigente y el de arranque como defensa en profundidad. Con el **teclado abierto**, la safe-area la tapa el teclado → un footer fijo NO debe reservarla (dejaría un hueco): usa un respiro chico (`resolveFooterPaddingBottom`).

**Qué NO lleva la reserva**: el `paddingBottom` del `contentContainerStyle` de un **scroll** (`insets.bottom + $6`) es *slack* de contenido, no algo apoyado en el borde de la pantalla — se deja como está (ya es aditivo y con más aire que el canónico). La reserva va donde algo queda FIJO contra el borde inferior: footers con CTA, barras de acción, bottom sheets, el bottom-nav y overlays anclados abajo.

**Invariante de centrado robusto (ADR-027)**: contenido que se quiere **centrado** respecto a su contenedor debe centrarse sobre el **ancho REAL** del contenedor — las **decoraciones laterales** (radio/check/ícono/badge/chevron) **NO consumen** el espacio de centrado, o corren el contenido y lo desalinean vs las filas hermanas sin decoración (bug recurrente, ya parchado ad-hoc 2 veces antes de canonizarse). Mecanismo: **slots laterales de ancho IGUAL** a ambos lados (primitiva `CenteredRow`, §6). Corolarios: (a) una decoración **condicional** (un check que aparece solo si seleccionado) reserva su **slot SIEMPRE**, también cuando no se muestra, para que togglear no recorra el layout; (b) un ícono **ligado al label** (leading de un CTA, ej. `+ Dar de alta`) se centra como **grupo** ícono+label — eso NO es este invariante y no se "arregla". Para texto corto de ancho fijo (ej. título de header con back) se acepta `position: absolute` en la decoración si no hay riesgo de overlap.

---

## 5. Elevación

Tamagui v4 no expone tokens de sombra escalares, así que la elevación vive como **objeto de estilo exportado** desde `tamagui.config.ts` (`shadows.card`) — las pantallas lo importan, no lo hardcodean:

- `shadows.card`: sombra suave para cards. Color `$textPrimary` (negro de marca, no `#000`), offset `(0, 2)`, opacity `0.06`, radius `12`, `elevation: 2` (Android).

Cuando haga falta más de un nivel de elevación, se promueve a un sistema (`elevation.1/2/3`) — JIT.

---

## 6. Componentes (librería)

La librería vive en `app/src/components/` y es el deliverable real (ADR-023). Construidos hasta ahora (derivados de la home):

- **`Button`** — CTA. Variantes según necesidad; primario = `$primary`, alto ≥ `$touchMin`, radio `$pill`.
- **`Card`** — superficie `$surface` (bone), radio `$card`, `shadows.card`.
- **`Stepper`** — wizard de pasos (riel + estados).
- **`CenteredRow`** — fila con contenido **centrado robusto** a decoraciones laterales (ADR-027). Slots `left`/`right` de ancho IGUAL (`sideWidth`) → el centro nunca se corre aunque solo un lado tenga decoración, y reserva el slot de decoraciones condicionales. Usar siempre que haya contenido centrado conviviendo (o que pueda convivir) con un ícono/check/radio/badge a un costado.
- **`FooterActionShell`** — primitivo del patrón canónico **header fijo / body scroll / FOOTER FIJO con el CTA** (feature U2). Es el hogar del CTA primario en las pantallas con teclado y/o contenido largo, así el botón **nunca queda bajo el fold ni tapado por el teclado** (en las 🔴 de maniobra es NO NEGOCIABLE — skill `design-review` + la memoria de sheets/forms). Responsabilidades: (1) CTA en un footer FIJO fuera del scroll; (2) el footer **sube por encima del teclado** (`KeyboardAvoidingView` — `padding` en iOS, `adjustResize` en Android) y **encoge su reserva de safe-area con el teclado abierto** (la safe-area la tapa el teclado); (3) **scroll affordance** (fade + chevron + peek) cuando hay contenido bajo el fold; (4) **reserva de safe-area inferior robusta** (`useSafeBottomInset()`, el hook compartido de la app: mismo cálculo que el bottom-nav — inset del sistema con blindaje frame-0 de Android edge-to-edge, piso de web y aire contra la barra de navegación en Android). La lógica pura vive en `app/src/utils/footer-action.ts` (`computeSafeBottomInset` / `resolveFooterPaddingBottom` / `shouldShowScrollPeek`, testeada) y la decisión del peek reusa la MISMA geometría que `scroll-affordance.ts` (una sola fuente de verdad). Aplicado en el alta (`crear-animal`), `agregar-evento` y —a nivel de frame, por-paso— en `maniobra/carga`. Regla: **cualquier pantalla con un CTA primario + teclado o contenido largo usa este shell** (o su mecanismo) en vez de un `YStack` de footer a mano; y si igual necesitás un footer propio, su `paddingBottom` sale de `useSafeBottomInset()` — nunca de una cuenta a mano con `insets.bottom` (ver §4 "Safe areas").
- **`BottomSheetShell`** — primitivo del **BOTTOM SHEET** del repo (hermano de `FooterActionShell`: mismo problema, pero para sheets en vez de pantallas). Nació del bugfix 🔴 MANGA "el teclado tapa TODO el sheet" (Raf, device iOS 2026-07-25): **ningún** sheet tenía keyboard-avoidance — el idiom se copiaba a mano (`View absolute inset0 $scrim` + backdrop `Pressable` + `YStack maxHeight` anclado abajo) y en iOS el teclado se dibujaba encima. Encapsula: (1) **backdrop `$scrim` tappable** con el **guard anti "click huérfano"** de web táctil (doble `requestAnimationFrame` — el `click` emulado del tap que abrió el sheet no debe cerrarlo; ver `reference_rn_web_pitfalls`); (2) **`KeyboardAvoidingView`** (`padding` en iOS, `adjustResize` en Android) → el sheet **sube** por encima del teclado; (3) esqueleto **header fijo / body scroll / footer fijo**, con el body en **`flexShrink:1` + `minHeight:0` — NUNCA `flex:1`** (con `flex:1` el body colapsa a altura 0 en nativo cuando el contenido es corto y el padre es content-sized con `maxHeight`: bug U5, "no se veía el input para cargar vacunas"); la COLUMNA del sheet también va `flexShrink:1` para achicarse con el teclado arriba en vez de desbordarse por el tope; (4) **safe-area** = la reserva canónica del repo con el teclado cerrado (`useSafeBottomInset()`), que **encoge** con el teclado arriba (`resolveFooterPaddingBottom` de `utils/footer-action.ts`); (5) **condensación** con el teclado arriba (decisión pura `utils/sheet-shell.ts`): se sueltan la descripción del header y el **CTA secundario**, quedan título + contenido + input + CTA primario; (6) **X de cierre en el header SIEMPRE** (`$icon`=48 ≥44 + `hitSlop`) — Nielsen #3: con el teclado arriba es la única salida visible; (7) `keyboardShouldPersistTaps="handled"` en el body (un chip/opción se toca al PRIMER toque con el teclado abierto); (8) **ARRASTRE-PARA-CERRAR** — el grabber era un significante sin acción (Norman) y el arrastre lo terminaba atendiendo el modal de abajo, cerrando la PANTALLA en vez del sheet (bugfix 🔴 manga, Raf device iOS 2026-07-25). Ahora el shell es dueño de su gesto: **dos detectores en vistas disjuntas** — header (grabber + título): arrastra SIEMPRE; body: solo con el `ScrollView` **en el tope** (nunca le roba el scroll al operario); **el footer NO arrastra** (ahí van los CTAs). Solo hacia abajo; al soltar cierra por **distancia** (25% del alto del sheet, piso 64px) o por **flick** (≥900px/s), un flick hacia arriba cancela, y si no alcanza vuelve con spring; fail-closed ante medidas rotas. **Con el teclado arriba el arrastre BAJA EL TECLADO y no cierra** (lo tipeado no se pierde por un gesto; la salida sigue siendo la X); (9) **BACK FÍSICO de Android** — mientras el sheet está montado, el back **cierra el sheet** (por el mismo `onClose`, que es donde vive el flush de lo tipeado sin agregar) y **consume** el evento; sin esto el back hace pop de la RUTA y en el wizard se lleva puesta la jornada. Sheets superpuestos: gana el de más arriba (suscripción única al montar + orden inverso de RN); (10) **AFFORDANCE DE SCROLL del body** — `peek` (aire al final del contenido) + **fade + chevron ▾** cuando queda contenido oculto abajo, con la misma decisión pura que `FooterActionShell` y las listas de maniobra (`shouldShowScrollPeek`): sin eso, con el body desbordado el último elemento queda rebanado al ras del CTA y se lee como layout roto en vez de "seguí scrolleando" (veto visual, 2026-07-25). Decisiones puras y testeadas en `app/src/utils/sheet-gestures.ts` (+ `sheet-shell.ts` y `footer-action.ts`). ⚠️ **Regla de worklets que salió de un crash en device**: a `runOnJS`/`scheduleOnRN` **nunca** se le pasa un método (`runOnJS(Keyboard.dismiss)`) — el plugin captura el OBJETO entero en el closure y, si no es un objeto plano, en el runtime de UI queda un proxy que tira al primer acceso → **crash nativo**. Siempre un callback JS propio y estable (`useCallback`). Lo hace cumplir `app/src/components/worklet-callbacks-guard.test.ts`. Y como **cualquier** excepción no atrapada dentro de un worklet mata la app en release (el `callGuard` de worklets solo corre en debug), los callbacks de gesto del shell van con `try/catch` que degrada a "el gesto no hace nada" y re-lanza en DEV: replicá ese patrón en cualquier gesto nuevo de una pantalla 🔴 manga. Regla: **todo bottom sheet nuevo usa este shell**; el que tenga input de texto, obligatoriamente.

  **DOS PRECONDICIONES AL ADOPTARLO** (no son detalle de implementación):
  1. **El shell se MONTA solo mientras el sheet está abierto** (`{open ? <Sheet/> : null}`, que es lo que hacen los 4 consumidores). El handler del back de Android se registra **al montar**, no al "abrir" — el shell no tiene noción de abierto/cerrado. Un consumidor que lo deje montado detrás de un toggle de visibilidad **se come todos los back de Android de la app, en silencio**. (Ojo: el patrón "montado siempre + prop `open`" existe en el repo, p. ej. `LotePickerSheet` en `maniobra/carga.tsx`; ese sheet todavía NO usa este shell — si se migra, el `open` tiene que pasar a montar/desmontar.)
  2. **El shell trae TRES vías de cierre que llaman a `onClose`** (scrim, arrastre y back, además de la X): si un sheet nuevo necesita confirmar antes de cerrar (destructivo, o con cambios sin guardar), esa confirmación va DENTRO de su `onClose` — ponerla solo en el CTA la deja saltable por gesto. Aplicado en `ManeuverConfigSheet`, `CustomFieldSheet`, `SavePresetSheet` y `BreedPickerSheet` (los sheets sin input siguen con el idiom viejo hasta migrarlos). **Regla de layout del patrón "escribir → agregar → chip"** (vacunas de `ManeuverConfigSheet` y opciones de enum de `CustomFieldSheet`): el **input va ARRIBA y los ítems agregados crecen DEBAJO** (con el mensaje de error inline pegado al input). Con el teclado arriba el área visible del sheet cae a ~150-250px y lo único que no se puede mover de ahí es el input (donde están el caret y la atención): con los chips arriba, el 3er/4to ítem lo empujaba fuera de vista. Es además consistencia dura (ley de Jakob): dos sheets con la misma interacción se ven igual.
- **Bottom nav** (`app/app/(tabs)/_layout.tsx`) — 5 items + FAB central elevado (ADR-018). Firmado por Raf.

Crece JIT: cuando una pantalla necesite `FormField`, `ListRow`, `Chip`, etc., se construye el componente (no se compone la pantalla con primitivos sueltos).

---

## 7. Diferido a post-MVP

- **Dark mode** — arquitectura dual-theme. El sistema está listo para absorberlo vía tokens semánticos sin tocar pantallas. Insumo: la paleta dark del draft archivado.
- **Colores de estado** (success/warning/error) — JIT, primera pantalla con chips.
- **`design/tokens.json` para Figma/Tokens-Studio** — no se mantiene (ADR-023 jubiló el handoff con Figma; código = fuente). El workflow viejo en `docs/setup-frontend.md` quedó histórico.

---

## 8. Relación con otros ADRs

- **ADR-023** (workflow de diseño): este doc es el artefacto canónico downstream que ese ADR anticipa.
- **ADR-018** (bottom nav): consume estos tokens (`$fab`, `$fabRaise`, `$navBar`…).
- **ADR-013/ADR-002** (stack): Tamagui v2 + Expo. La config monta la paleta brand + Inter sobre `@tamagui/config/v4`.
- **Skill `design-review`**: criterios pro (Nielsen, Laws of UX, mobile/HIG, composición) + la criticidad-manga graduada + la tubería de preview fiel (CDP) para vetear diseño contra este sistema.
