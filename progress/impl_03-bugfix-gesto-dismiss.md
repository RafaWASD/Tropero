baseline_commit: 963a825d09012796580b495ef454ac2df5d69a66

# impl — BUGFIX 🔴 MANGA ×2 (spec 03): quién es dueño del gesto de descarte

> Dos bugfixes de la MISMA clase sobre MODO MANIOBRAS. Trabajo en PARALELO con otro implementer:
> propiedad EXCLUSIVA de `app/app/_layout.tsx` y `app/src/components/BottomSheetShell.tsx` (+ los
> archivos nuevos que agregué). NO toqué `ManeuverConfigSheet.tsx` ni `maniobra/jornada.tsx`.

## Plan (tasks)

- [x] T1 — FIX 1: `maniobra/jornada`, `maniobra/identificar`, `maniobra/carga` dejan de ser descartables
      por gesto (`app/app/_layout.tsx`).
- [x] T2 — FIX 2a: lógica PURA del arrastre-para-cerrar (`app/src/utils/sheet-gestures.ts`) + 21 unit.
- [x] T3 — FIX 2b: pan cableado en `BottomSheetShell` (header + body-at-top), sin romper nada previo.
- [x] T4 — Test nuevo registrado en `scripts/run-tests.mjs` + typecheck + unit + anti-hardcode.
- [x] T5 — E2E de regresión (`app/e2e/sheet-arrastre.spec.ts`) + capture del Gate 2.5 (8 estados).
- [x] T6 — Autorrevisión adversarial + reconciliación de specs.

## Archivos tocados

| Archivo | Qué |
|---|---|
| `app/app/_layout.tsx` | FIX 1: `presentation:'fullScreenModal'` + `gestureEnabled:false` en las 3 rutas del flujo + el bloque de comentario que documenta causa/decisión/alcance |
| `app/src/components/BottomSheetShell.tsx` | FIX 2: arrastre-para-cerrar (2 detectores RNGH + envoltura animada + `onScroll` interno) |
| `app/src/utils/sheet-gestures.ts` (NUEVO) | Decisiones puras: gate por zona, clamp de traslación, umbral de cierre, conducta con teclado, back de Android, gate de plataforma + las constantes |
| `app/src/utils/sheet-gestures.test.ts` (NUEVO) | 23 unit |
| `app/e2e/sheet-arrastre.spec.ts` (NUEVO) | Regresión E2E (3 casos, con control anti-falso-verde + el aserto de `touch-action` falsificado) |
| `app/e2e/captures/sheet-arrastre.capture.ts` (NUEVO) | 9 capturas del Gate 2.5 (ADR-029) |
| `scripts/run-tests.mjs` | Registro del unit nuevo en la lista explícita |
| `docs/design-system.md` | F2: contrato del primitivo (7 → 9 responsabilidades) |
| `specs/active/03-modo-maniobras/{design,requirements,tasks}.md` | Reconciliación (ver abajo) |
| `docs/backlog.md` | Overflow: `/crear-animal` hereda el mismo mecanismo |

## FIX 1 — las pantallas del flujo no se descartan por gesto

**Diagnóstico verificado en el código instalado** (no re-derivado de memoria):

- `expo-router/build/react-navigation/native-stack/utils/getModalRoutesKeys.js`: toda ruta POSTERIOR a un
  modal **sin `presentation` explícita** entra a `modalRouteKeys` (`if ((acc.length && !presentation) || …)`).
- `…/views/NativeStackView.native.js:59`: `presentation = isPresentationModal ? 'modal' : 'card'`.
- `react-native-screens/ios/RNSScreen.mm:247`: `modal` → `UIModalPresentationAutomatic` (= pageSheet en
  iPhone) y `RNSScreen.mm:669` `presentationControllerShouldDismiss` devuelve `_gestureEnabled` **de esa
  pantalla**. O sea: `jornada`/`identificar`/`carga` NO estaban "adentro" del modal del landing — **cada una
  era su propio page-sheet con su propio swipe-to-destroy**. (Matiz sobre el diagnóstico recibido; el efecto
  y el fix son los mismos.)

**Decisión: `presentation: 'fullScreenModal'` + `gestureEnabled: false`** en las tres. Fundamento:

| Punto | Evidencia |
|---|---|
| Mata el gesto | `RNSScreen.mm:269` → `UIModalPresentationFullScreen`; UIKit no instala dismissal interactivo para full-screen |
| Recupera alto (manga) | hoy son page-sheets APILADOS (inset arriba); full-screen devuelve la pantalla entera y coincide con lo que el comentario del código ya afirmaba |
| Saca al competidor del pan del sheet | sin sheet de UIKit no hay `UIPanGestureRecognizer` de dismissal peleando con el pan del `BottomSheetShell` (FIX 2) |
| Android intacto | `ScreenViewManager.kt:124` mapea `"modal"` y `"fullScreenModal"` al MISMO `StackPresentation.MODAL`; y expo-router fuerza `gestureEnabled=false` en Android |
| Web intacto | `NativeStackView.js` (web) solo mira `presentation` para las presentaciones TRANSPARENTES |
| Navegación intacta | `back`/`replace`/`canDismiss`+`dismissAll` son acciones del stack de JS (`POP`/`POP_TO_TOP`, `global-state/router.js`), ajenas a la presentación |
| Status bar intacta | Expo default `UIViewControllerBasedStatusBarAppearance: false` (`@expo/config-plugins/build/plugins/withIosBaseMods.js:136`) → la maneja el `StatusBar` global, no el VC presentado |
| Safe-area intacta | las tres ya paddean con `insets.top` (jornada:449, identificar:528, carga:892) |

`gestureEnabled:false` va **además** (no como plan B): en iOS setea `modalInPresentation`
(`RNSScreen.mm:332`) → `presentationControllerShouldDismiss` devuelve NO. Segundo cerrojo declarativo y
gratis (en Android el router ya lo fuerza a false).

**NO se tocó `maniobra` (el landing)**: una pantalla sin estado que perder; ahí el swipe-down es correcto.

## FIX 2 — el sheet es dueño de su gesto

Reglas implementadas (puras en `sheet-gestures.ts`, cableadas en el shell):

- **Ancla = header** (grabber + título): arrastra siempre, detector propio. Desde el **body**, solo con el
  ScrollView en el tope (`onScroll` interno → `.enabled(bodyAtTop)`): con contenido scrolleado el arrastre
  es del operario. Ambos detectores con `activeOffsetY(+8)` / `failOffsetY(-8)` → un tap no arrastra y un
  movimiento hacia arriba hace fallar el pan (el scroll se va limpio).
- **Solo hacia abajo** (`sheetDragOffset` clampea ≤0 y no-finitos).
- **Al soltar** (`shouldDismissSheet`): distancia ≥ `max(64px, 25% del alto medido)` **o** flick
  ≥900px/s con ≥24px; un flick hacia arriba ≥300px/s **cancela**; si no, spring de vuelta.
  **Fail-closed**: cualquier medida no finita → NO cierra.
- **Teclado arriba → baja el teclado, NO cierra** (`sheetDragIntent`, una sola conducta, documentada en el
  módulo): lo tipeado no se pierde por un gesto, el idiom ya existe (`keyboardDismissMode:'on-drag'`), y no
  se pelea con el re-layout del KAV. La salida sigue a un toque en la X (que nunca se condensa).
- **Al cerrar**: `onClose()` + spring de vuelta a 0. Los 4 consumidores DESMONTAN el shell al cerrar (el
  reset es invisible); si alguno no lo hiciera, el sheet queda en su lugar y no "fantasma" fuera de pantalla.

**Estructura**: envoltura `Animated.View` que **toma las restricciones de caja** (`flexShrink:1` +
`maxHeight`) que tenía el `YStack`. Motivo: un `maxHeight` en % necesita padre de alto DEFINIDO y el padre
del YStack pasó a ser una envoltura de alto auto → dejarlo adentro lo volvía indeterminado (o 85% de 85%).
El YStack conserva `flexShrink:1` y se comporta igual (contenido corto → al contenido; alto/teclado → se
achica cediendo al body; **nunca `flex:1`**, bug U5).

**Web**: detector del cuerpo con `touchAction="pan-y"` (default de RNGH = `none`, que se comería el scroll
táctil del body en react-native-web). **Verificado empíricamente** en el e2e (assert sobre
`getComputedStyle(wrapper).touchAction === 'pan-y'`), no solo afirmado.

**Intactos** (verificados por suites verdes, no por lectura): guard anti click-huérfano del scrim,
condensación con teclado, esqueleto header/body/footer, `maxHeight`, safe-area, todos los `testID` (se suma
`<sheet>-grip`), y la **API `secondaryFooter`** (no la toqué: la usan los otros 3 consumidores).

## Trazabilidad (qué cubre qué)

| Requisito / decisión | Cubierto por |
|---|---|
| R10.7 — la guarda de cierre de jornada no se puede saltear por gesto | `app/app/_layout.tsx` (3 rutas) → **veredicto DEVICE** (web no tiene el gesto modal de iOS); nota de reconciliación bajo R10.7 |
| Ancla del arrastre = header, siempre | `sheet-gestures.test.ts` "el HEADER arrastra siempre…" + e2e `sheet-arrastre.spec.ts:2` (caso "el header sí") |
| Body arrastra SOLO en el tope | `sheet-gestures.test.ts` "desde el BODY solo…" + e2e `sheet-arrastre.spec.ts:2` (control at-top + caso scrolleado) |
| Umbral por distancia (25% / piso 64) | `sheet-gestures.test.ts` (4 casos) + e2e `sheet-arrastre.spec.ts:1` (corto NO cierra / largo SÍ) |
| Flick + cancelación por flick inverso | `sheet-gestures.test.ts` (4 casos) |
| Solo hacia abajo | `sheet-gestures.test.ts` (3 casos) |
| Fail-closed ante medidas rotas | `sheet-gestures.test.ts` (3 casos) |
| Teclado arriba → baja teclado | `sheet-gestures.test.ts` (3 casos) → **veredicto DEVICE** del efecto real |
| El sheet sigue al dedo (el gesto TOMA) | e2e: `translateY` medido del DOM con el dedo abajo (anti-falso-verde en los 3 casos) |
| No se rompió el scroll táctil de web | e2e: assert de `touch-action: pan-y` |
| Nada previo del shell se rompió | `sheet-teclado` 3/3, `maniobra-config-sheet-race` 4/4, `maniobra-customfield-validacion`, `maniobra-custom` 2/2, `maniobra-custom-gestion` 5/5, `maniobra-wizard`, `maniobra-sanitaria`, `maniobra-rutinas-gestion`, `maniobra-offline`, `sigsa-breed-renspa` 4/4, `maniobra-identify` 16/16 |

## Verificación (ejecutada, no leída)

- `pnpm typecheck` (app) — **verde**.
- Unit del repo completo (lista explícita de `run-tests.mjs`, 130 archivos): **2432/2432**, incluidos los 21
  nuevos de `sheet-gestures.test.ts`.
- `node scripts/check-hardcode.mjs` — **0 violaciones** (ADR-023 §4).
- E2E (build web fresco con el código FINAL): `sheet-arrastre` 2/2 (NUEVO), `sheet-teclado` 3/3,
  `maniobra-config-sheet-race` 4/4 → **9/9** en la última corrida; antes, en batches: `maniobra-wizard` +
  `maniobra-custom` + `maniobra-custom-gestion` 8/8, `maniobra-sanitaria` + `maniobra-rutinas-gestion` +
  `maniobra-identify` 24 pass / 2 fail → **los 2 rojos se re-corrieron y pasan** (aislados 2/2 y la suite
  entera `maniobra-identify` 16/16): flake de contención contra la DB remota compartida en un batch largo
  (clase ya documentada en memoria del repo), no regresión.
- Capture del Gate 2.5: `pnpm exec playwright test e2e/captures/sheet-arrastre.capture.ts --config
  playwright.capture.config.ts` → **2/2, 8 PNG** en `app/e2e/captures/__shots__/sheet-arrastre/`
  (gitignored, NO los agregué al índice).
- **`node scripts/check.mjs` NO se corrió entero, a propósito**: (a) el `SUPABASE_ACCESS_TOKEN` revocado
  (bloqueante abierto en `progress/current.md`) lo deja en rojo con cualquier código; (b) hay otra terminal
  trabajando contra la misma DB remota y las suites backend son irrelevantes para este cambio
  (**frontend puro**: cero SQL, cero RPC, cero RLS, cero `establishment_id`). Lo que el check aporta para
  este delta —typecheck + los 130 archivos de unit + anti-hardcode— **sí se corrió, con el comando exacto
  extraído de `run-tests.mjs`**.

## Autorrevisión adversarial (qué busqué / qué encontré / cómo lo cerré)

1. **¿Rompí el clamp de alto del sheet al mover `maxHeight` a la envoltura?** — Busqué el escenario del bug
   U5 (colapso a 0) y el del teclado. Cerrado en web por el oráculo geométrico de `sheet-teclado` (viewport
   412×420: sheet sin desbordarse, título/input/CTA dentro). **En NATIVO es veredicto de device**: Yoga
   resuelve porcentajes distinto y esa es la clase exacta del bug U5. Lo dejo declarado, no disimulado.
2. **¿Le robé el scroll al body?** — Encontré que el default `touch-action:'none'` de RNGH web habría matado
   el scroll táctil del body. Cerrado con `touchAction="pan-y"` en el detector del cuerpo + assert en e2e.
   En nativo, `failOffsetY(-8)` hace fallar el pan ante cualquier arrastre hacia arriba y `.enabled(false)`
   lo apaga con la lista scrolleada.
3. **¿Un test verde por la razón equivocada?** — El primer e2e del gate de scroll pasaba sin probar que el
   cuerpo arrastre; le agregué el **control at-top** (con la lista en el tope el cuerpo SÍ arrastra) para que
   la variable del caso sea el scroll. Y los 3 casos miden el `translateY` real con el dedo abajo, así
   "no cerró" nunca puede significar "el gesto nunca existió".
4. **¿La X sigue andando con un pan encima del header?** — Sí (los 3 casos de `sheet-teclado` que cierran por
   la X siguen verdes); el pan exige 8px de recorrido para activarse.
5. **Comentarios que mienten** — encontré dos que quedaron desactualizados por mi propio cambio ("las 5
   responsabilidades", "el padre YStack maxHeight:85%") y los corregí; también el comentario de `dragInert`
   (decía solo "teclado" cuando cubre dos motivos).
6. **Spring inútil en cada tap** — `onFinalize` corre aunque el gesto nunca active (tocar la X pasa por ahí);
   agregué el guard `if (translateY.value !== 0)`.
7. **Doble `onClose`** si los dos detectores activaran a la vez: RNGH cancela uno (relación
   ancestro/descendiente) y, aun si no, `onClose` es idempotente en los 4 consumidores (setState a
   `false`/`null`). Verificado leyendo los 4 call-sites.
8. **Alcance del FIX 1 más allá de las 3 rutas** — `/crear-animal` (empujada desde la identificación) hereda
   el mismo mecanismo y sigue descartable por gesto. **NO lo cambié** (se usa desde varios flujos ajenos a
   maniobra; el daño es el alta en curso, no la jornada) → `docs/backlog.md` con el fix candidato.
9. **Multi-tenant / offline-first** — N/A real: cambio 100% de presentación y gestos, sin datos, sin red,
   sin `establishment_id`. No hay superficie de seguridad nueva (Gate 1 N/A).

## Reconciliación de specs (as-built)

- `design.md` §6.bis.1 → **As-built v9** nuevo: los dos fixes, con la cadena de evidencia (archivos y líneas
  de expo-router / react-native-screens), la decisión `fullScreenModal` + `gestureEnabled:false`, las reglas
  del arrastre con sus constantes, la conducta con el teclado, el cambio estructural del `maxHeight`, lo que
  queda intacto, la cobertura y el límite ADR-029.
- `requirements.md` → nota de reconciliación bajo **R10.7** (el *qué* no cambia; lo que cambia es que la
  guarda de cierre ya no se puede saltear con un gesto). EARS sin reescribir.
- `tasks.md` → **As-built v10** + la línea `Archivos:` con los 6 archivos del delta.
- `docs/backlog.md` → entrada del overflow (`/crear-animal`).

## FIX-LOOP del reviewer (F1 / F2 / F3) — cerrado

**F1 (bloqueante) — flag compartido entre dos instancias de gesto.** Correcto y era mío: el detector del
cuerpo estaba montado en la envoltura que CONTIENE al header, así que un toque en el grabber lo trackeaban
los dos Pan, construidos por el mismo builder → **un solo `dragInert`**. El `onFinalize` del perdedor (RNGH
lo dispara también en FAILED/CANCELLED) lo reseteaba a `false` después de que el ganador lo puso en `true`;
en iOS, donde la exclusión la hace UIKit y no hay orquestador, el orden no está garantizado → con el teclado
arriba el arrastre podía cerrar el sheet igual y descartar lo tipeado. Mi autorrevisión había mirado los dos
detectores solo por el doble `onClose`; no miré el efecto del `onFinalize` del cancelado sobre el estado
compartido.

Resuelto como se pidió: **detectores DISJUNTOS + un `inert` por instancia**.
- El del header queda sobre el header; el del cuerpo pasó **al CONTENIDO del `ScrollView`** (un `YStack`
  propio dentro del contentContainer, que absorbe el `gap`). El **footer ya no es ancla** de arrastre.
- Descarté dos alternativas **con evidencia, no por gusto**: (a) montarlo sobre el `ScrollView` de Tamagui →
  lo probé y **gesture-handler-web aplica su estilo a un nodo que no es el scroller** (dump del DOM: el
  `touch-action: pan-y` cae en un `SPAN` y el scroller queda en `auto`) y **el pan del cuerpo queda muerto en
  web** (el control at-top del e2e midió traslación 0); (b) envolver el `ScrollView` en otra vista → toca el
  flex del body, que es exactamente donde vive el bug U5.
- `bodyAtTop` salió de las deps del builder (entra por parámetro) → cruzar el tope del scroll **ya no
  reconstruye el gesto del header**.
- El gate puro pasó de geometría (`touchY`/`headerBottomY`) a **zona** (`'header' | 'body'`), que es lo que
  el diseño disjunto hace literal; se fueron el shared value `headerBottomY` y su `onLayout`.

**F2 — doc del primitivo.** `docs/design-system.md` reconciliado: el contrato de `BottomSheetShell` pasó de
7 a **9 responsabilidades** (+ arrastre-para-cerrar con sus reglas y umbrales, + back de Android), con un
aviso explícito para quien lo adopte: **el shell trae dos vías de cierre por gesto que llaman a `onClose`**,
así que si un sheet nuevo necesita confirmar antes de cerrar, la confirmación va DENTRO de su `onClose`.
También se actualizaron el comentario del archivo (6→7 responsabilidades, ancla literal) y el texto del
ancla en `design.md` §6.bis.1 v9.

**F3 — back físico de Android.** Implementado **en el shell**: mientras el sheet está montado, el back
cierra el sheet por el **mismo `onClose`** (ahí vive el flush del texto tipeado) y **consume** el evento
(regla pura `sheetBackPress`, 2 unit). **Suscripción única al montar** (deps `[]` + ref al callback): RN
corre los handlers en orden inverso al de registro, así que el último MONTADO (el sheet de más arriba) gana
y los de abajo no se enteran; re-suscribir en cada cambio de identidad de `onClose` habría roto esa
precedencia. Gateado a Android (única plataforma con back físico). **Encaja con lo que hizo la otra terminal
sin coordinación previa**: su `useHardwareBack` (pantallas) documenta que difiere al sheet y que su registro
es estable justamente para que el del sheet gane. No importé su `shouldRegisterHardwareBack` a propósito:
vive en `utils/maniobra-back.ts` y el shell es un primitivo genérico (lo usa también spec 08) — meter una
util de maniobra en `src/components` sería una inversión de capas.

### Verificación del fix-loop (ejecutada)

- `pnpm typecheck` verde · `check-hardcode` 0 violaciones · unit del módulo 22/22.
- **`node scripts/check.mjs` → RC=0** (verde de punta a punta, incluidas las suites backend; el client unit
  del check corrió **2448/2448** con `sheet-gestures.test.ts` en la lista).
- E2E sobre build fresco: `sheet-arrastre` **3/3** (se sumó el caso **"el FOOTER no es ancla de arrastre"**,
  que cae si alguien vuelve a montar el detector del cuerpo sobre el sheet entero, y que además verifica que
  el CTA del footer sigue tappable) · batch `sheet-arrastre + sheet-teclado + config-sheet-race +
  customfield-validacion` **11/11** · batch `wizard + custom + custom-gestion + sigsa-breed-renspa` **12/12**
  · batch `sanitaria + offline + rutinas-gestion` **11/11** · capturas Gate 2.5 **2/2 (8 PNG regenerados)**.
- **Flake honesto**: `maniobra-config-sheet-race` (test del guard anti click-huérfano) falló **2 veces**,
  ambas en la PRIMERA corrida después de un `e2e:build` fresco, y luego pasó **12 veces seguidas**
  (aislado, con `--repeat-each=4`, en su archivo y en el batch que había fallado). Es un test con carrera
  temporal propia (tap táctil → doble rAF); mi cambio solo agrega vistas al montaje, lo que retrasa el armado
  del guard y por lo tanto juega a FAVOR del test, no en contra. No lo cuento como regresión, pero lo dejo
  anotado por si vuelve a aparecer.

## SEGUNDO fix-loop (F1 / F2 / F3 / F4 + nits) — cerrado

**F1 (bloqueante) — el aserto de `touch-action` no podía fallar. Tenía razón.** Mi `evaluate()` leía el
**scroller** (primer descendiente con `overflowY: auto|scroll`), pero gesture-handler-web escribe
`touchAction` sobre la vista del **propio detector** (`GestureHandlerWebDelegate`: `this.view.style
['touchAction']`), que es el contenedor del contenido del body — nunca el scroller. El scroller computaba el
default `auto`, que estaba en mi set aceptado → verde siempre.
Arreglado: `testID` propio `<sheet>-body-drag` en la superficie del detector y el aserto lee **ese** nodo.
**FALSIFICADO ejecutando** (que es lo que faltaba): saqué `touchAction="pan-y"`, rebuild, corrí → el test
**cae** con `Expected: "pan-y" / Received: "none"`; lo repuse, rebuild, corrí → **verde**. Queda documentado
en el propio spec.

**F2 (bloqueante) — evidencia citada que el repo no respalda.** Corregido en los dos lugares
(`BottomSheetShell.tsx` y `design.md` v9): lo de "el pan del cuerpo queda muerto en web" pasa a decir
explícitamente que fue una **medición ad-hoc durante el desarrollo** (dump del DOM + el control at-top dando
0), **no cobertura viva** — la alternativa no está en el árbol y el spec no puede ejercitarla. Y la
afirmación "envolver el `ScrollView` = clase del bug U5" se bajó a lo que es: el bug U5 era `flex:1`
(basis 0%); una envoltura con `flexShrink:1 + minHeight:0` (basis auto) **no** es ese patrón. De hecho ahora
hay una envoltura así —la que sostiene el fade— y el comentario dice por qué no reintroduce U5.

**F3 (bloqueante, veto visual) — el body se cortaba al ras del CTA.** Cerrado con la respuesta canónica del
repo, no una inventada: **peek** (`paddingBottom` `$6` al final del contenido, el mismo token que el peek de
`FooterActionShell`) + **fade + chevron ▾** cuando queda contenido oculto abajo, decidido por la MISMA
función pura que ya usan `FooterActionShell` y las listas de maniobra (`shouldShowScrollPeek`) → una sola
fuente de verdad del affordance. El fade es `pointerEvents="none"` (no intercepta scroll, arrastre ni taps) y
cuelga de una envoltura del `ScrollView` con la misma geometría flex que el ScrollView tenía. **Capturado el
peor caso** (`06b-vacunacion-alto-recortado-peek.png`: 412×420 con 6 vacunas → el chip ya no queda rebanado
contra "Listo", hay aire + fade + chevron) **y el caso que NO debe mostrarlo** (`06-vacunacion-reposo.png`:
contenido que entra entero → sin fade; el affordance no miente).

**F4 — precondición de adopción.** Agregada al contrato normativo (`docs/design-system.md`, ahora **10**
responsabilidades) como **dos precondiciones explícitas**: (1) el shell se **monta solo mientras el sheet
está abierto** — el back se registra al MONTAR y un consumidor con toggle de visibilidad se comería todos los
back de Android en silencio (cito el patrón real del repo, `LotePickerSheet` en `carga.tsx`, aclarando que
ese sheet todavía no usa el shell); (2) el shell trae **tres** vías de cierre que llaman a `onClose` (scrim,
arrastre, back) → una confirmación previa al cierre va DENTRO de `onClose`, no en el CTA. La misma
precondición quedó como comentario en el efecto del `BackHandler` y en `design.md` v9. API sin cambios.

**Nits**: (a) el gate de plataforma dejó de ser un `Platform.OS !== 'android'` inline → predicado puro
`sheetBackHandlerApplies` **con test** (era la única decisión del módulo sin cubrir, y gatea los 4 sheets);
(b) el `gap` ya no está duplicado: vive solo en el View del contenido (único hijo del contentContainer, que
ahora lleva el `paddingBottom` del peek) y el comentario dice la verdad; (c) `sheet-drag.ts` → **`sheet-gestures.ts`**
(+ su test), con todas las referencias actualizadas (componente, `run-tests.mjs`, specs, DS, e2e).

**Dato corregido**: son **4** consumidores del shell (`ManeuverConfigSheet`, `CustomFieldSheet`,
`SavePresetSheet`, `BreedPickerSheet` — este último es el de spec 08). Mis textos ya decían 4.

### Verificación del segundo fix-loop (ejecutada)

- `pnpm typecheck` verde · `check-hardcode` **0** · unit del módulo **23/23**.
- **`node scripts/check.mjs` → RC=0** con el código final (client unit **2452/2452**).
- E2E sobre build fresco: batch `sheet-arrastre + sheet-teclado + config-sheet-race + customfield-validacion`
  **11/11** · `sigsa-breed-renspa + maniobra-wizard` **5/5** · `maniobra-sanitaria` **6/6** ·
  `maniobra-custom + custom-gestion + rutinas-gestion` verdes en el batch previo · captures **2/2 (9 PNG)**.
- **Falsificación del aserto de F1**: documentada arriba (cae sin el fix, pasa con el fix).
- **Ruido de infraestructura, no regresión**: durante estas corridas hubo dos tandas con fallos
  (`net::ERR_CONNECTION_REFUSED at http://localhost:8099/` en el `error-context.md`): el server estático
  compartido del puerto 8099 se cae cuando la otra terminal termina su propia corrida de Playwright
  (`reuseExistingServer` sobre el mismo puerto). Re-corridas inmediatamente: **todas verdes**. Sigue
  apareciendo, además, el flake ya anotado del test del guard anti click-huérfano en la PRIMERA corrida tras
  un `e2e:build`.

## TERCER fix-loop — CRASH 🔴 EN DEVICE (iOS build 76f0837c): diagnóstico y fix

**Cuál de los tres candidatos era: (a) el `runOnJS` de la rama del teclado.** Probado así:

1. **Salida REAL de babel del componente** (compilado con el `babel.config.js` del repo, plugin de worklets
   incluido): el `__closure` del worklet de `onStart` era
   `{inert, sheetDragIntent, keyboardUp, runOnJS, Keyboard}` con `Keyboard: _reactNative.Keyboard`. O sea:
   el plugin captura el **identificador raíz** de `Keyboard.dismiss` → se llevaba **el objeto módulo entero**
   (una instancia de la clase `KeyboardImpl`), no la función.
2. **Serializador de `react-native-worklets` 0.8.3** (`memory/serializable.native.js`): `isPlainJSObject` es
   `Object.getPrototypeOf(o) === Object.prototype`; una instancia de clase no lo es, no es host object ni
   TurboModule → cae en `inaccessibleObject()`, que el propio archivo documenta como *"a Proxy object that
   throws on any attempt of accessing its fields"*.
3. → En el runtime de UI, **leer `Keyboard.dismiss` TIRA**. Eso es SINCRÓNICO y DENTRO del worklet, que es
   exactamente lo que muestra el `.ips`: `UIEventHandler::process → runSyncOnRuntime → WorkletRuntime::runSync
   → HermesRuntimeImpl::call → throwPendingError → __cxa_throw → std::terminate → abort`.
4. → Y explica la condición exacta del repro: el proxy se crea callado al serializar, así que **no explota al
   abrir el sheet**, sino recién cuando se ejecuta la ÚNICA rama que lee esa propiedad — la del teclado
   arriba.
5. **La hipótesis del `this` queda REFUTADA con fuente**: `Keyboard.dismiss()` de RN 0.85 es
   `dismiss() { dismissKeyboard(); }` (`Libraries/Components/Keyboard/Keyboard.js:169`) — no usa `this`. Y,
   como bien decía el brief, un fallo en el hilo de JS habría dado redbox, no `SIGABRT`.

**Candidato (b) —función sin `'worklet'` llamada desde el hilo de UI— REFUTADO ejecutando**: compilé
`sheet-gestures.ts` con el babel del repo y las **4** funciones que los callbacks llaman
(`sheetDragAllowedFrom`, `sheetDragOffset`, `shouldDismissSheet`, `sheetDragIntent`) salen workletizadas
(`__workletHash` + `__initData`); las 2 que NO lo están (`sheetBackPress`, `sheetBackHandlerApplies`) solo
corren en el hilo de JS (las llama el `BackHandler`). Además (b) habría crasheado en TODO arrastre.

**Candidato (c) —shared value / `measure()`— REFUTADO por inspección**: los worklets solo leen/escriben
shared values creados con `useSharedValue` en el propio componente (`inert`, `keyboardUp`, `sheetHeight`,
`translateY`); no hay `measure()` ni refs animados en el shell. (c) tampoco sería keyboard-condicional.

**Fix**: callback JS propio y estable — `const dismissKeyboard = useCallback(() => { Keyboard.dismiss(); }, [])`
y `runOnJS(dismissKeyboard)()`. **Verificado recompilando**: el closure pasó de `{…, Keyboard}` a
`{…, dismissKeyboard}` (una función común → `cloneRemoteFunction`, que es justo lo que `scheduleOnRN` espera).

**Auditoría completa de la tanda** (sobre la salida de babel, no a ojo): los 6 worklets del shell capturan
shared values, funciones workletizadas, números, `runOnJS`/`withSpring` de reanimated, el literal
`RETURN_SPRING` y `onClose`. `Keyboard` era el ÚNICO módulo capturado. Revisé los 4 consumidores: todos pasan
`onClose` como arrow function o `useCallback` local — ninguno un método pelado. En todo el repo, `runOnJS` se
usa con identificadores simples salvo la línea que rompió (grep de `app/` + `src/`).

**Guard permanente + falsificado**: `app/src/components/worklet-callbacks-guard.test.ts` escanea `app/app` +
`app/src` y falla si a `runOnJS`/`scheduleOnRN` se le pasa un `X.y`, con válvula de escape justificada.
Falsificación ejecutada: reintroduje `runOnJS(Keyboard.dismiss)()` → el test **cae** señalando
`src/components/BottomSheetShell.tsx:441`; restauré → verde. Registrado en `scripts/run-tests.mjs`.

**El problema más grande, atendido en el mismo pase**: *cualquier* excepción no atrapada dentro de un worklet
mata la app, sin redbox ni log — porque el guard de worklets (`callGuardDEV`) **solo existe en builds de
debug** (lo dice su propio archivo). Los 5 callbacks del gesto quedaron con **`try/catch`**: el `catch`
degrada a "el gesto no hace nada" (fail-closed: `inert = true`, y en `onFinalize` reset duro a 0 para que el
sheet no quede trabado) y **re-lanza en DEV** (`__DEV__`, que reanimated lee dentro de sus propios worklets)
para no tapar errores durante el desarrollo. Verifiqué en la salida de babel que los 5 `try` llegan
compilados al worklet y que `__DEV__` se captura como **booleano** (serializable, sin riesgo). La
recuperación de cada `catch` solo escribe shared values → **en la práctica** no puede re-tirar (son
`useSharedValue` creados en el propio shell = host objects serializables); no es garantía absoluta: si lo
que tiró dentro del `try` fuese el acceso a `inert`/`translateY`, el `catch` tiraría igual. No envolví
`useAnimatedStyle`, y **no porque falte un fallback** (el reposo `{ translateY: 0 }` es justo lo que escribe
el `catch` de `onFinalize`): un catch ahí solo taparía el síntoma — ese worklet únicamente LEE
`translateY.value`, y si esa lectura tirara, `onUpdate`/`onFinalize` ya estarían tirando y el shell estaría
roto de raíz.

**Lo que este pase NO puede probar**: que el crash desapareció. `runOnJS` es prácticamente un no-op en
react-native-web y el unit no monta worklets → **es veredicto de DEVICE** (ADR-029): Raf tiene que arrastrar
el grabber de Vacunación con el teclado abierto en el build nuevo.

## Pendiente / riesgos (honesto)

- **VEREDICTO DE DEVICE (ADR-029), iOS y Android** — nada de esto es verificable en react-native-web
  (se agregan: el **back físico de Android** cerrando el sheet de más arriba y su precedencia sobre la guarda
  de pantalla —`BackHandler` no emite en web—; y **que el crash del arrastre-con-teclado desapareció**:
  `runOnJS` es casi un no-op en web y el unit no monta worklets, así que el único oráculo es Raf arrastrando
  el grabber de Vacunación con el teclado abierto en el build nuevo):
  1. que el arrastre hacia abajo **ya no descarte** jornada/identificar/carga (y que la única salida siga
     siendo el ‹ → `ExitJornadaSheet`);
  2. que el paso a `fullScreenModal` no traiga efecto colateral visual (la transición pasa a ser full-screen
     y las pantallas dejan de verse como page-sheets apilados: es la mejora buscada, pero hay que mirarla);
  3. que el `maxHeight` de la envoltura se comporte igual en **Yoga nativo** (clase del bug U5);
  4. el **arrastre real con el dedo** (el web lo ejerce con mouse: mismo gesture-handler, distinto input) y
     que en el body el pan de RNGH le gane al pan del `UIScrollView` en el tope (si perdiera, el body haría
     bounce en vez de arrastrar — degradación, no rotura: el header siempre arrastra);
  5. la conducta con el **teclado arriba** (web no monta teclado virtual).
- `design/**/*.png` aparecen modificados en `git status`: los re-renderizan las corridas E2E (quirk conocido
  del repo). **No los toqué ni los reverti** — son territorio compartido con la otra terminal; el leader
  decide qué stagea.
- NADA commiteado, `git add` no ejecutado (lo hace el leader).
