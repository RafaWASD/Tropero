baseline_commit: 7bdc87ec9ffc1cca817e75c08580073be6d5b264

# BUG 🔴 «abrir un sheet con el teclado abierto» — ABRIR UN SHEET BAJA EL TECLADO

**Nada commiteado** (lo hace el leader). `design/**/*.png` verificado intacto (`git status --porcelain design/` = 0 líneas) después de la pasada 1 (`e2e:build` + 6 tandas de E2E + las capturas) **y** de la pasada 2 (que no corrió E2E).

## Plan (T1..T5) — todas cerradas

- [x] T1 — decisión PURA `shouldDismissKeyboardOnOpen` (`src/utils/sheet-shell.ts`) + 6 tests.
- [x] T2 — hook `useDismissKeyboardOnOpen` (`src/hooks/useDismissKeyboardOnOpen.ts`).
- [x] T3 — adopción en los **22 archivos con `$scrim`** + la excepción `claimsKeyboard`.
- [x] T4 — GUARD estático (**11 tests**) + registro en `scripts/run-tests.mjs` + **14 falsificaciones** (9 en la pasada 1, 5 en la pasada 2).
- [x] T5 — E2E propia (4 tests, falsificada) + capturas + reconciliación de specs/docs + verificación.

---

## 0. Los 3 pedidos del reviewer — cómo quedaron (pasada 2)

Los tres eran **afirmaciones más fuertes que lo verificado**. Es el modo de falla que esta serie vino a cerrar, así que ninguno se cerró bajando la afirmación: se subió lo verificado.

| # | qué señaló | cómo quedó |
|---|---|---|
| **C1** | El guard afirmaba que **no existe ningún overlay modal sin `$scrim`**. Existe: `EstablishmentSwitcherDropdown` (backdrop `$textPrimary` @0.18 sobre `StyleSheet.absoluteFill`). | **Confirmado: la frase era falsa.** No alcanzaba con corregir el comentario, porque la promesa de completitud es justamente lo que deja escapar a la próxima superficie. Ahora: (1) el header dice qué garantiza la semilla `$scrim` —**una sola dirección**— y qué no; (2) hay una **regla secundaria** que enumera los overlays a pantalla completa por **geometría** (`absoluteFill` / `<Modal` de RN / capa absoluta con los 4 insets en 0 y sin `pointerEvents="none"`) y exige que todo el que no pinte `$scrim` esté **nombrado** en `NON_SCRIM_OVERLAYS`; (3) el dropdown es esa única excepción, con sus **3 razones ancladas y ejecutables** (se ancla ARRIBA con `top={anchorTop}`, no tiene campos de texto propios, y su único call site —`app/(tabs)/index.tsx`— tampoco). Si cualquiera de las tres deja de valer, el test cae. Falsificaciones (k), (l), (m), (n). |
| **C2** | `claimsKeyboard` estaba cubierto en **una sola dirección**: cazaba el falso negativo (auto-enfoca y no declara) pero no el falso positivo (marcado de más). | **Era barato de cerrar, así que se cerró** (no se declaró como límite). Test nuevo: todo `claimsKeyboard` declarado tiene que mostrar **evidencia de auto-foco** en el archivo (`autoFocus` o un `.focus(` programático), con el sitio de DEFINICIÓN (`BottomSheetShell`) excluido y explicado; además el conjunto de sheets que lo declaran se compara por igualdad (hoy: solo `SavePresetSheet`). El tramo que **sigue** siendo lectura y no ejecución —que ese `.focus(` corra al MONTAR y no en un `onPress`— quedó escrito como límite (b) del header. Falsificación (j), aislada: 🔴 exactamente 1 fail. |
| **C3** | `tasks.md` As-built v15 decía "3 tests" de la E2E; son **4**. | Corregido a **4**, y de paso el resto de esa línea quedó completo (11 tests del guard, el capture file con sus 4 tests / 7 capturas). |

**Barrida propia de cifras** (pedida por el reviewer, porque es la 3ra entrega de la serie con números que no reproducen): re-conté con un scan sobre el árbol real todo lo contable de este informe. Detalle en §7 → *Pasada 2*. **Dos errores propios encontrados y corregidos**: (i) "8 falsificaciones sintéticas … self-closing" era un conteo a ojo que además citaba un caso que no existe; (ii) §4(b) llamaba "anidados" a `ExitJornadaSheet` → `SugerenciaVaciasSheet`, que en realidad son **hermanos encadenados** en `identificar.tsx`. Todo lo demás reprodujo.

---

## 1. La causa REAL — la del reporte era media

El leader diagnosticó el **límite del montaje** de `KeyboardAvoidingShell` (monta con el teclado ya abierto → `height` arranca en 0). Ese límite existe y es real, pero **no es la causa del sheet reportado**:

> **`ExitJornadaSheet` no monta `KeyboardAvoidingShell`.** No tiene ningún campo de texto, así que el guard del teclado (REGLA B) no se lo exige y nunca lo tuvo. Para ese sheet **el lift no existía en absoluto**: está anclado al fondo de la pantalla con `position:absolute + justifyContent:flex-end`, y el teclado se dibuja encima. Por eso solo asomaba una franja: no es que el lift arrancara en 0, es que **no hay lift**.

O sea que había DOS defectos apilados, y el segundo (el que el leader nombró) recién se habría manifestado si alguien le hubiera agregado el shell. Lo mismo vale para `CandidatePicker` y `OtherRodeoSheet` —los otros dos sheets de `identificar.tsx` que el leader mandó a revisar—: **ninguno de los tres monta el shell**. El único de esa pantalla que sí lo monta es `SugerenciaVaciasSheet` (tiene input).

Esto invalida la justificación que quedó escrita en el header del shell («paridad con iOS, no regresión» + «el flujo del bug reportado no lo toca»). **Corregida en el archivo**, con la falsificación citada.

## 2. Dónde vive el fix, y por qué ahí

**Un hook**, `app/src/hooks/useDismissKeyboardOnOpen.ts`, llamado por `BottomSheetShell` y por cada sheet a mano. **No** en `BottomSheetShell` solo, **no** en `KeyboardAvoidingShell`.

| candidato | qué cubriría | por qué NO |
|---|---|---|
| `BottomSheetShell` | 4 sheets | deja afuera al **sheet del reporte** y a los otros 20 hechos a mano. |
| `KeyboardAvoidingShell` | 6 sheets a mano + los 4 del shell | **tampoco cubre el sheet del reporte** (no lo monta), y además alcanza a las **15 PANTALLAS** que montan el primitivo, que no son overlays: ahí "bajar el teclado al montar" es otra conducta, con otra justificación y otro blast radius. |
| **un hook + adopción por archivo** ✅ | **los 22** | el invariante es de la clase "overlay modal con scrim", y esa clase **no tiene un primitivo único en este repo**: 4 sheets sobre el shell + 21 a mano (algunos con `KeyboardAvoidingShell`, otros sin nada). El hook es el mínimo común, y el guard lo hace total. |

La alternativa "primero extraer un `ScrimOverlay` y meter el fix ahí" es la correcta a largo plazo, pero es un refactor de 22 archivos con riesgo visual en pantallas 🔴 — fuera de alcance para un bugfix. Quedó como entrada de backlog (ampliando la que ya existía de migrar los sheets a mano al primitivo).

### El contrato (decisión PURA, testeada)

`shouldDismissKeyboardOnOpen({ wasOpen, isOpen })` → dispara **solo en el flanco cerrado→abierto**. El modo de falla que ese predicado existe para lockear no es "no dispara" sino **"dispara de más"**: un efecto por render haría que un sheet con input propio cierre su propio teclado en cada tecla, y en web eso es invisible.

**Argumento del hook**: los sheets que se MONTAN al abrirse van con el default; los que viven SIEMPRE montados detrás de una prop de visibilidad **tienen que pasarla** (`LotePickerSheet`, `SugerenciaVaciasSheet`, `LinkCalfPrompt`, `MarkDeclaredSheet` pasan `open`; `FindOrCreateOverlay` pasa `state !== null`). Con el default, esos cinco medirían el flanco del montaje de la PANTALLA y **no dispararían nunca** — falso verde perfecto. El guard lo chequea.

### La EXCEPCIÓN (`claimsKeyboard`) — encontrada falsificando, no razonando

La primera versión razonaba (y lo dejé escrito en un comentario) que el `autoFocus` de `SavePresetSheet` no se veía afectado, porque `Keyboard.dismiss()` con nada enfocado es `blurTextInput(null)`. **Era falso, y lo agarré ejecutando** en la autorrevisión: con el descarte puesto, el input de "Guardar como rutina" **nacía SIN foco**. En web, React enfoca al hijo con `autoFocus` durante el `commitMount`, o sea DENTRO del mismo commit y ANTES del efecto del padre → el `Keyboard.dismiss()` del shell llegaba después y lo blureaba. Verificado contra baseline: **sin el fix el foco llega; con el fix (sin la excepción) no**.

El arreglo no es un parche, es la semántica correcta: **un sheet que auto-enfoca su input no está SALIENDO del contexto de escritura, está ENTRANDO a uno.** Prop `claimsKeyboard` en `BottomSheetShell` (default `false`) → `useDismissKeyboardOnOpen(!claimsKeyboard)`. La declara `SavePresetSheet`, el **único** `autoFocus` del repo. El guard exige la declaración a todo sheet con `autoFocus`, y verifica que el shell la HONRE (no que solo la acepte).

## 3. Alcance: los 22 archivos (enumeración completa, computada — no a ojo)

Criterio: todo archivo de `app/app` + `app/src` cuyo fuente (con comentarios blanqueados) use el token **`$scrim`**. En este repo ese token tiene un solo uso: el backdrop a pantalla completa de un overlay modal.

| # | archivo | arg del hook | ¿montaba `KeyboardAvoidingShell`? |
|---|---|---|---|
| 1 | `app/maniobra/_components/ExitJornadaSheet.tsx` ⭐ **el del reporte** | default | **no** |
| 2 | `app/maniobra/_components/CandidatePicker.tsx` | default | **no** |
| 3 | `app/maniobra/_components/OtherRodeoSheet.tsx` | default | **no** |
| 4 | `app/maniobra/_components/SugerenciaVaciasSheet.tsx` | `open` | sí |
| 5 | `app/maniobra/_components/SkipAnimalSheet.tsx` | default | no |
| 6 | `app/maniobra/_components/SyncRechazoSheet.tsx` | default | no |
| 7 | `app/maniobra/_components/NuevaJornadaConfirmSheet.tsx` | default | no |
| 8 | `app/maniobra/_components/ConfirmDeleteSheet.tsx` | default | no |
| 9 | `app/maniobra/_components/CustomFieldActionsSheet.tsx` | default | no |
| 10 | `app/maniobra/_components/PresetActionsSheet.tsx` | default | no |
| 11 | `app/maniobra/_components/TactoConfigSheet.tsx` | default | no |
| 12 | `app/maniobra/_components/LotePickerSheet.tsx` | **`open`** (vive siempre montado) | no |
| 13 | `app/maniobra/_components/DientesStep.tsx` (`CutPromptSheet`, anidado) | default | no |
| 14 | `app/maniobra/_components/CircunferenciaEscrotalStep.tsx` (`AgeAdjustSheet`, anidado) | default | no |
| 15 | `app/_components/FindOrCreateOverlay.tsx` | **`state !== null`** (overlay GLOBAL) | sí |
| 16 | `src/components/TagScanSheet.tsx` | default | sí |
| 17 | `src/components/LinkCalfPrompt.tsx` | **`open`** | sí |
| 18 | `src/components/TreatmentStartSheet.tsx` | default | sí |
| 19 | `src/components/TreatmentApplicationSheet.tsx` | default | sí |
| 20 | `src/components/BulkConfirmSheet.tsx` | default | no |
| 21 | `src/components/sigsa/MarkDeclaredSheet.tsx` | **`open`** | no |
| 22 | `src/components/BottomSheetShell.tsx` | `!claimsKeyboard` | sí (es el que lo monta) |

Vía el shell (no dibujan scrim propio, no están en la semilla): `ManeuverConfigSheet`, `CustomFieldSheet`, `SavePresetSheet` (**+ `claimsKeyboard`**), `BreedPickerSheet`.

**Dos casos vivos que el leader no había enumerado y que son tan directos como el reportado**:
- **`AgeAdjustSheet` (dentro del paso de CIRCUNFERENCIA ESCROTAL)**: el paso tiene un `TextInput` hero (los cm) que el operario está tipeando **con el teclado arriba**; tocar la edad abría la rueda debajo del teclado. Mismo bug, otro flujo 🔴. *(Efecto colateral bueno: el `onBlur={commit}` de ese input se dispara con el descarte y **guarda** lo tipeado en vez de dejarlo en draft.)*
- **`FindOrCreateOverlay`**: el peor de todos. Es **global** (`app/_layout.tsx`, sobre cualquier pantalla) y **no lo abre un tap del usuario sino un BASTONAZO** → puede aparecer literalmente mientras se tipea, en cualquier formulario. Es, además, el único disparador que permite verificar el fix en web (§6).

## 4. Veredicto sobre la CAPA 2 (sembrar la altura al montar): **NO**

Con fundamento, no por pereza:

1. **La única fuente disponible al montar es `Keyboard.metrics()`, y su `height` es la de RN — la que está mal bajo edge-to-edge** (`ReactRootView.java:978` = `imeInsets.bottom - barInsets.bottom`). Sembrar con eso exige **sumar de vuelta** el inset inferior de `systemBars`. Ese término de corrección es exactamente lo que el diseño actual eligió NO tocar cuando descartó `KeyboardAvoidingView` y se fue a `useAnimatedKeyboard`: reintroducirlo es reabrir el agujero que se cerró, en el único lugar que nadie puede medir.
2. **No hay forma barata de verificarlo.** El bug entero es invisible en web (RNW no monta teclado virtual) y el unit no monta el nativo. Un valor mal calculado da un **lift equivocado**, que es **peor que no levantar nada**: el contenido salta a un lugar incorrecto y recién se acomoda con el próximo evento del IME. "No sube" es un defecto legible; "sube 48dp de menos" se lee como layout roto.
3. **El término no está garantizado que sea el mismo.** `useSafeAreaInsets().bottom` de safe-area-context no es, por contrato, idéntico al `systemBars().bottom` que RN resta (gestos vs 3 botones, display cutouts) — y este repo ya tuvo que **blindarse contra que ese mismo inset reporte 0 en el frame 0** (`useSafeBottomInset`). Sembrar con un 0 espurio da lift 0 igual, con más código.
4. **Es off-contract**: `height` es un shared value cuyo dueño es el `KeyboardAnimationManager`; escribirle desde JS depende de un detalle interno de una API que además ya está `@deprecated` (la migración a `react-native-keyboard-controller` está en backlog).
5. **El beneficio residual es chico**: con la capa 1 puesta, lo único que queda expuesto es una superficie que monte con el teclado arriba **sin ser un overlay**.

**Superficies que pueden montar con el teclado arriba** (lo que el leader pidió enumerar):

| clase | ¿cubierta? |
|---|---|
| **(a) Overlays modales con scrim** — los 22 de arriba | ✅ **capa 1**, con guard total |
| **(b) Overlays ANIDADOS** (`LinkCalfPrompt` monta `TagScanSheet`; `DientesStep` monta `CutPromptSheet`; `CircunferenciaEscrotalStep` monta `AgeAdjustSheet`) **y ENCADENADOS** (el `onElegirLote` del `ExitJornadaSheet` abre el `SugerenciaVaciasSheet`, que es su hermano en `identificar.tsx`, no su hijo — corregido: la v1 de este informe los llamaba "anidados") | ✅ todos llaman al hook; el descarte es idempotente |
| **(c) Una PANTALLA nueva pusheada mientras se tipea** (p. ej. tocar un animal desde el buscador de Animales) | ❌ **el único residuo**. Se auto-corrige al primer evento del IME, y la pantalla de destino no tiene foco propio, así que el primer tap del operario lo resuelve. Sin reporte. |
| **(d) Un shell que se monte tarde dentro de una pantalla** (gate de carga) | N/A — cae en (c): el input que sostendría el teclado está *adentro* del shell, así que no puede haberlo abierto antes de que el shell exista. Verificado: **ninguna** de las 15 pantallas monta el primitivo condicionalmente detrás de un toggle de visibilidad. |

Backlog: entrada nueva con este razonamiento, atada a la migración a `react-native-keyboard-controller`, **y** con la alternativa barata anotada por si aparece un caso 🔴 de (c): descartar el teclado también en el cambio de ruta (mismo criterio de producto, cero aritmética).

## 5. El GUARD — `app/src/components/sheet-keyboard-dismiss-guard.test.ts` (**11 tests**)

Sí hay uno, y no es decorativo. Mismo espíritu que los 4 existentes; registrado en la lista explícita de `scripts/run-tests.mjs`.

- **Semilla**: `$scrim` sobre el fuente con comentarios blanqueados. Es la firma más difícil de evadir sin querer (se puede renombrar el componente, mover el archivo o cambiar el esqueleto; un sheet sin scrim no es un sheet). La definición del token vive en `app/tamagui.config.ts`, fuera de los roots escaneados → no hace falta excepción. ⚠️ Lo que garantiza es **una sola dirección** (todo `$scrim` del repo es un backdrop modal anclado abajo), NO la recíproca — ver la regla secundaria.
- **Cubierto**: llama al hook **o** monta `<BottomSheetShell`. El shell está en la MISMA semilla (dibuja el scrim), así que si dejara de llamar al hook cae él, no sus 4 consumidores en silencio.
- **Regla secundaria (cierra la enumeración)**: los overlays a pantalla completa se enumeran también por **geometría** (`StyleSheet.absoluteFill` / `<Modal` de RN / capa absoluta con los 4 insets en 0 y sin `pointerEvents="none"`), y todo el que NO pinte `$scrim` tiene que estar **nombrado con su razón** en `NON_SCRIM_OVERLAYS`. Hoy hay exactamente uno (`EstablishmentSwitcherDropdown`) y sus 3 razones están ancladas en el test. Comparación por **igualdad**: también cae una excepción obsoleta.
- **Sub-regla del argumento**: un sheet con `open: boolean` no puede llamar al hook pelado.
- **Sub-regla del `autoFocus`, en las DOS direcciones**: (i) todo sheet con `autoFocus` declara `claimsKeyboard`, y el shell tiene que pasarlo al hook; (ii) todo `claimsKeyboard` declarado muestra **evidencia de auto-foco** en el archivo (`autoFocus` o un `.focus(`), y el conjunto de sheets que lo declaran se compara por igualdad (hoy: `SavePresetSheet` y nadie más).
- **No-decorativo**: el hook tiene que tener `Keyboard.dismiss()`, el predicado puro, `useEffect` y la dep **`[open]`** (con `[]` un sheet siempre-montado no dispararía nunca; sin deps dispararía en cada render).
- **Auto-verificación de cobertura** (`assertScanCoverage`) como los otros 4.
- Válvula de escape con razón escrita obligatoria.

### Las 14 falsificaciones — (a)…(n), una mutación por vez, sobre el árbol REAL, revertidas con backup/restore

| mutación | resultado |
|---|---|
| (a) `ExitJornadaSheet` sin la llamada al hook | 🔴 2 fail (la regla + el ancla del motor) |
| (b) `BottomSheetShell` deja de llamar al hook | 🔴 3 fail (la regla + el ancla + el test del primitivo) |
| (c) `LotePickerSheet`: `useDismissKeyboardOnOpen(open)` → `()` | 🔴 1 fail (sub-regla del argumento) |
| (d) el hook pierde el `Keyboard.dismiss()` | 🔴 1 fail (no-decorativo) |
| (e) el hook cambia la dep `[open]` → `[]` | 🔴 1 fail (no-decorativo) |
| (f) archivo NUEVO con scrim y sin hook | 🔴 1 fail (la regla) |
| (g) glob roto (`src` → `srcs`) | 🔴 2 fail (auto-verificación + ancla) |
| (h) `SavePresetSheet` sin declarar `claimsKeyboard` | 🔴 1 fail (sub-regla del `autoFocus`) |
| (i) el shell ACEPTA `claimsKeyboard` pero no se lo pasa al hook | 🔴 1 fail (misma sub-regla) |
| **(j)** `ManeuverConfigSheet` (sin `autoFocus` ni `.focus(`) marca `claimsKeyboard` | 🔴 **1 fail** (`claimsKeyboard` exige evidencia) — es el gap C2 del reviewer, aislado |
| **(k)** archivo nuevo con `StyleSheet.absoluteFill` + backdrop, sin `$scrim` | 🔴 1 fail (regla secundaria) |
| **(l)** archivo nuevo con el idiom Tamagui (4 insets en 0, `justifyContent="flex-end"`) y backdrop de otro color, sin `$scrim` | 🔴 1 fail (regla secundaria) — **la clase que C1 avisaba que se escapaba** |
| **(m)** `EstablishmentSwitcherDropdown` deja de anclarse arriba (`top={anchorTop}` → `bottom="$0"`) | 🔴 1 fail, con el mensaje que nombra la razón #1 de su excepción |
| **(n)** una excepción OBSOLETA en `NON_SCRIM_OVERLAYS` (path que no existe) | 🔴 1 fail (la comparación es por igualdad: no hay allowlist muerta) |

Más las falsificaciones **sintéticas** dentro del propio test (`el guard DETECTA`), etiquetadas (a)…(i-bis) y verificables leyendo: sheet con scrim y sin nada, hook llamado con y sin argumento, el shell como indirección, un import que NO cubre, menciones en comentario (scrim / hook / shell), un componente con prefijo parecido (`BottomSheetShellLegacy`), los dos lados de la sub-regla del argumento (+ `routeOpen`, que no cuenta), los dos lados de la del `autoFocus`, los dos lados de la de `claimsKeyboard`, la firma geométrica de overlay (absoluteFill / Modal / idiom Tamagui multilínea) contra las capas decorativas (`pointerEvents="none"`, inset parcial) y una pantalla común, y la válvula sin razón.

*(La v1 de este informe decía "8 falsificaciones sintéticas … self-closing": el conteo era a ojo y **no había** ningún caso de tag self-closing del shell. Corregido: se enumeran las que están.)*

## 6. Verificación

### `node scripts/check.mjs` — **RC=0** (output literal, corrida de la PASADA 2, sobre el árbol final)

Corrida completa **después** de las tres correcciones (C1/C2/C3), no antes. Los `...` marcan tramos elididos; los 11 tests del guard van enteros, sin recortar.

```
-- 1. Archivos base del harness ----------------------
[OK]    Existe AGENTS.md
[OK]    Existe CLAUDE.md
[OK]    Existe CHECKPOINTS.md
[OK]    Existe feature_list.json
[OK]    Existe progress/current.md
...
-- 2. Validando feature_list.json y specs ------------
[OK]    feature_list.json válido (22 features)
[OK]    context.md presente en context_ready; specs presentes en spec_ready+

-- 2b. Higiene de progress/current.md ----------------
[WARN]  current.md parece inflado (0 bloque(s) de sesión, 485 líneas). Al cerrar sesión, mové el resumen a history.md y dejá current.md limpio (AGENTS.md §6).

-- 2c. Lint anti-hardcode (ADR-023 §4) ---------------
[OK]    Anti-hardcode (ADR-023 §4): 0 violaciones en app/app + app/src/components

-- 3. Ejecutando tests -------------------------------
    > node scripts/run-tests.mjs

>>> typecheck client
...
✔ todo overlay con SCRIM baja el teclado al abrirse (542.9995ms)
✔ un overlay a pantalla completa SIN `$scrim` no se escapa en silencio: está NOMBRADO con su razón (461.9734ms)
✔ un sheet con prop `open` NO puede llamar al hook sin argumento (dispararía al montar la pantalla) (552.4896ms)
✔ un sheet que AUTO-ENFOCA su input tiene que declarar `claimsKeyboard` (si no, el descarte le mata el foco) (460.7423ms)
✔ `claimsKeyboard` exige EVIDENCIA de auto-foco (la otra dirección: marcarlo de más revive el bug) (435.0234ms)
✔ el motor VE el árbol real y encuentra los overlays que este fix tocó (417.5395ms)
✔ ANCLA: el primitivo llama al hook (si no, sus 4 consumidores se quedan sin la conducta) (11.2178ms)
✔ el hook HACE lo que dice (no es un no-op decorativo) (2.0551ms)
✔ el predicado PURO existe y lo exporta el módulo de la lógica del sheet (1.5104ms)
✔ el guard DETECTA (no pasa verde por no estar mirando nada) (0.9525ms)
✔ AUTO-VERIFICACIÓN: el guard escaneó todo el árbol, y los archivos ENTEROS (788.5009ms)
...
<<< Health EF suite (spec 16 Run C) OK

All tests passed.
[OK]    Tests verdes

-- 4. Resumen ----------------------------------------
[OK]    Entorno listo. Podés trabajar.
RC=0
```

⚠️ **Alcance declarado**: `check.mjs` **NO corre E2E**. La E2E de abajo se corrió aparte, a mano, en la pasada 1 — **no se volvió a correr en la pasada 2**, y no hacía falta: los cambios de esta pasada son un test estático nuevo, dos assertions más en otro, y texto (specs/docs). Cero cambios de código de runtime: los únicos archivos tocados en la pasada 2 son `app/src/components/sheet-keyboard-dismiss-guard.test.ts` (que no lo importa ningún bundle), `specs/active/03-modo-maniobras/{design,tasks}.md`, `docs/design-system.md` y este informe. Los dos archivos que se mutaron para falsificar (`ManeuverConfigSheet.tsx`, `EstablishmentSwitcherDropdown.tsx`) se restauraron con backup/restore y quedaron **fuera** de `git status` (verificado). `design/**/*.png`: 0 líneas.

### E2E — comparada contra BASELINE corrido, no contra memoria

**0 regresiones.** Todo rojo se reprodujo idéntico en el baseline (`git stash` → `e2e:build` → run → `git stash pop`, con el patch verificado **md5-idéntico** antes y después, las dos veces).

| tanda | con el fix | baseline | veredicto |
|---|---|---|---|
| `sheet-teclado` + `sheet-arrastre` + `maniobra-config-sheet-race` + `maniobra-back-hardware` + `cta-siempre-visible` | **13/13** | — | verde |
| `maniobra-identify` + `maniobra-vacias-lote` + `maniobra-rechazo-sync` + `maniobra-skip-paso` + `maniobra-lote` + `maniobra-custom-gestion` + `maniobra-rutinas-gestion` | 32 ok / **3 fail** | **3 fail idénticos** | `maniobra-vacias-lote` ×3, error `seedAnimal category: Cannot coerce…` en `helpers/admin.ts:899` — **falla de SEEDING**, antes de tocar UI |
| `maniobra-circunferencia-escrotal` + `ficha-circunferencia-escrotal` + `cut-ficha` + `maniobra-tacto-adaptativo` + `maniobra-tacto-bugfix` + `treatments` + `sigsa-export` | 16 ok / **9 fail** | **los 9, idénticos** | clase "el paso de tacto no renderiza" (`PREÑADA`/`VACÍA` ausentes) + `cut-ficha` + `treatments:36` |
| `operaciones-*` ×3 + `alta-bastoneo` + `baston-ficha` + `cria-al-pie-bastoneo` + `maniobra-carga` + `lotes` | 18 ok / **3 fail** | **los 3, idénticos** | `maniobra-carga` ×2 (misma clase tacto) + `lotes:61` (bug de oráculo `.first()`, ya clasificado) |
| **final, tras el fix de `claimsKeyboard`**: `sheet-baja-teclado` + `sheet-teclado` + `maniobra-config-sheet-race` + `maniobra-rutinas-gestion` + `baston` + `sheet-arrastre` + `cta-siempre-visible` + `maniobra-back-hardware` | **verde** | — | |

*(Nota sobre la clase "tacto": 9 tests en 3 specs distintas fallan porque el paso de tacto no renderiza. Se reprodujo entera en el baseline. **No es de esta unidad**, pero es ruido que le va a comer tiempo a la próxima: hoy `maniobra-tacto-*` y `maniobra-carga` no sirven como semáforo sin correr el baseline al lado.)*

### E2E PROPIA — `app/e2e/sheet-baja-teclado.spec.ts` (4 tests), falsificada en las DOS direcciones

Lo importante de este spec es **cómo se llegó al oráculo**, porque la primera versión era un falso verde y lo cacé falsificando:

> El oráculo natural en web es "el input pierde el foco" (RNW implementa `Keyboard.dismiss()` como `blurTextInput(currentlyFocusedField())`). **Pero pasa igual SIN el fix** si el sheet lo abre un **click** (el mousedown cae sobre un div no focusable y el browser desenfoca solo) o un **Enter** (el `handleKeyDown` de RNW hace `blurOnSubmit` por default en single-line). Lo verifiqué sacando el hook de `ExitJornadaSheet` + `BottomSheetShell` y rebuildeando: **el test pasaba igual**. Un test así es peor que no tenerlo.
>
> El único disparador que **no** toca el foco por su cuenta es el que no viene del usuario: un **BASTONAZO** (`window.__rafaqBle.tagRead()` → `FindOrCreateOverlay`). Con eso el test discrimina de verdad.

| test | qué mide | falsificación |
|---|---|---|
| (1) MECANISMO | bastonazo con el buscador de Animales enfocado → el overlay abre y el input **se desenfoca** | 🔴 al sacarle el hook a `FindOrCreateOverlay` |
| (2) NO-REGRESIÓN "dispara de más" | el input propio del sheet de vacunas se tipea letra por letra sin perder el foco | 🔴 mutando el hook para que dispare en cada render |
| (3) NO-REGRESIÓN de la EXCEPCIÓN | el `autoFocus` de "Guardar como rutina" **sobrevive** | 🔴 con el fix y sin `claimsKeyboard` (así se descubrió el bug) |
| (4) FLUJO DEL REPORTE | ‹ con la caravana tipeada → el sheet abre con sus DOS acciones, no navega, y **lo tipeado no se pierde** | — (declarado: no prueba el descarte, ver arriba) |

### Gate 2.5 — capture file — **4/4 passed**

`app/e2e/captures/sheet-baja-teclado.capture.ts` → 7 capturas en `__shots__/sheet-baja-teclado/` (gitignoreadas; el `.capture.ts` se commitea):

```
01-identificar-caravana-tipeada.png          05-config-vacunacion-recien-abierto.png
02-exit-jornada-sheet-dos-acciones.png       06-config-vacunacion-tipeado.png
03-exit-jornada-sheet-alto-recortado.png     07-guardar-rutina-autofocus-enfocado.png
04-overlay-global-por-bastonazo.png
```

**Límite honesto, declarado en el header del archivo**: el bug es **estructuralmente invisible en web** — ninguna captura puede mostrar "el sheet ya no queda debajo del teclado". Lo que sí vetan: que los sheets se sigan dibujando igual, el **peor caso geométrico** (viewport 412×420 ≈ teclado arriba: la 03 muestra el `ExitJornadaSheet` entero, con sus 3 acciones y el título "Terminar la jornada" **sin recortar la j**), y la excepción del `autoFocus` (la 07 muestra el input con el anillo de foco).

## 7. Autorrevisión adversarial (qué busqué, qué encontré, cómo lo cerré)

| qué busqué | resultado |
|---|---|
| **Que el diagnóstico del leader fuera el correcto** | **No lo era del todo.** `ExitJornadaSheet` ni monta el shell: el límite del montaje no era su causa, la AUSENCIA de mecanismo sí. Corregido en el header del shell, en la spec y en este informe. |
| **Superficies que se me escaparan** | No confié en la lista de 3 del encargo: derivé el universo por firma (`$scrim`) → **22**, y aparecieron dos casos vivos que nadie había nombrado (`AgeAdjustSheet` del paso de CE, con un `TextInput` hero enfocado al lado; y `FindOrCreateOverlay`, que se abre **solo** sobre cualquier pantalla). |
| **Que el fix rompa un sheet con input propio** | Es el modo de falla más caro y no es hipotético: lo reproduje mutando el hook. Cerrado con el predicado de flanco + su test puro + el test (2) de la E2E. |
| **Que rompa un `autoFocus`** 🔴 | **SÍ LO ROMPÍA.** Lo encontré ejecutando, después de haber escrito un comentario afirmando lo contrario. Comparado contra baseline (sin el fix el foco llega). Cerrado con `claimsKeyboard` + guard + test E2E + captura. **Es el hallazgo principal de esta pasada.** |
| **Que un hook quede después de un early return** (rules-of-hooks) | Barrido mecánico sobre los 22: **0**. `FindOrCreateOverlay` y los 4 con prop `open` lo llaman ANTES del `return null`. |
| **Que un sheet reciba el argumento equivocado** | Los 5 que viven siempre montados detrás de una prop pasan su prop; los 17 que se montan/desmontan van con el default — verificado **call-site por call-site** (todos renderizados condicionalmente). Convertido en sub-regla del guard para que no rote. |
| **Que mi E2E pase por la razón equivocada** | **Pasaba.** El oráculo del foco no discrimina si el sheet lo abre un click o un Enter (verificado en la fuente de RNW y ejecutando sin el fix). Reescrito sobre el bastonazo, que es el único disparador no-usuario. |
| **Efectos colaterales del blur en web** | Barrido de `onBlur` en todo el árbol: **uno solo** (`CircunferenciaEscrotalStep`, `onBlur={commit}`). El efecto es **deseable**: salir del contexto de escritura **guarda** el valor tipeado en vez de dejarlo en draft. Anotado en el archivo. Barrido de `.focus()` programático: uno solo, en un `onPress` (post-montaje, no afectado). |
| **Worklets** | Cero. Es un efecto de montaje en el hilo de JS; el guard de worklets sigue verde y el propio guard nuevo asserta que el archivo del hook no contiene `worklet`/`runOnJS`. |
| **Atribuirme rojos ajenos** | Ninguna falla declarada pre-existente sin **correr el baseline** del mismo lote (dos rondas de stash, con el patch verificado md5-idéntico las dos veces). |
| **Higiene** | `design/**/*.png` revertido y verificado en 0 líneas tras todas las corridas. Sin `git add`. Nada commiteado. |

### Pasada 2 (post-review, cerrando C1/C2/C3) — qué busqué DE MÁS

| qué busqué | resultado |
|---|---|
| **Afirmaciones de COMPLETITUD que no verifiqué** (la clase del C1) | Barrí el árbol por otras firmas de overlay a pantalla completa (`StyleSheet.absoluteFill`, `<Modal` de RN, capa absoluta con los 4 insets en 0). **4 candidatos**: 3 son gradientes/hairlines decorativos con `pointerEvents="none"` (`CustomManeuverStep`, `WheelPicker`, `FooterActionShell`) y **1 es un overlay de verdad**: `EstablishmentSwitcherDropdown`. O sea: el reviewer tenía razón, la frase era falsa. |
| **Las dos direcciones de cada excepción** (la clase del C2) | `claimsKeyboard` estaba cubierto en un solo sentido. La dirección abierta era la PEOR (marcar de más → el sheet vuelve a quedar debajo del teclado, con el guard en verde). Cerrada con regla + igualdad de conjunto + falsificación (j). |
| **Cifras que no reproducen** (la clase del C3) | Re-conté TODO lo contable de este informe con un scan sobre el árbol real: 366 archivos escaneados ✅, 22 con `$scrim` ✅ (lista idéntica a la tabla de §3), 22 llamadas al hook con el argumento que dice la tabla ✅, 4 consumidores del shell ✅, 6 sheets a mano con `KeyboardAvoidingShell` + 15 pantallas ✅, 1 solo `autoFocus` ✅, 1 solo `.focus(` ✅, 1 solo `onBlur` ✅, 6 tests del predicado ✅, 4 tests de la E2E propia ✅ (tasks.md decía 3 → **C3**), 4 tests + 7 capturas del capture file ✅, 153 archivos del `phone-field-guard` ✅ (no había drift ahí). **Dos encontradas por mi cuenta**: el conteo "8 falsificaciones sintéticas … self-closing" era a ojo y citaba un caso inexistente; y §4(b) llamaba "anidados" a `ExitJornadaSheet` → `SugerenciaVaciasSheet`, que son **hermanos encadenados** en `identificar.tsx` (los anidados de verdad son `LinkCalfPrompt`→`TagScanSheet`, `DientesStep`→`CutPromptSheet`, `CircunferenciaEscrotalStep`→`AgeAdjustSheet`). Las dos corregidas arriba. |
| **Que la excepción nueva no sea un "allowlist y me olvido"** | Las 3 razones del dropdown quedaron **ancladas y ejecutables** (anclado arriba / sin inputs propios / call site sin inputs), y el mapa se compara por igualdad para que una excepción obsoleta también caiga. Falsificado: (m) y (n). |

**Incidente propio, para que quede escrito**: en la falsificación (a) usé `git checkout --` para revertir la mutación y **me llevé puesto mi propio fix** en `ExitJornadaSheet` (el archivo estaba sin commitear). Lo detecté al instante por el reminder de estado, lo reapliqué y **verifiqué el diff**; a partir de ahí todas las mutaciones se hicieron con backup/restore de archivo, nunca con `git checkout`.

## 8. Reconciliación de specs y docs

| archivo | qué se reconcilió |
|---|---|
| `app/src/components/KeyboardAvoidingShell.android.tsx` | El bloque "LÍMITE CONOCIDO" **corregido**: las dos afirmaciones que lo despachaban ("paridad con iOS, no regresión" / "el flujo del bug reportado no lo toca") estaban mal y quedan marcadas como falsificadas por este reporte. Agregado cómo quedó cerrado y **por qué NO se sembró la altura**. |
| `app/src/components/BottomSheetShell.tsx` | 8va responsabilidad (abrir el sheet baja el teclado) + la excepción `claimsKeyboard` con su docblock. |
| `docs/design-system.md` §6 | Bullet nuevo del hook (dónde vive y **por qué no en un shell**) + la responsabilidad (11) del `BottomSheetShell` + la excepción + qué chequea el guard. |
| `docs/backlog.md` | Entrada nueva del **límite del montaje** (capa 2 descartada, con el razonamiento completo y la alternativa barata) + entrada nueva de los 21 sheets a mano arrastrando ya **dos** invariantes copiados. |
| `specs/active/03-modo-maniobras/design.md` | **As-built v12**: la causa doble, la corrección de la v11, la adopción de los 22, la excepción, el guard, el descarte de la capa 2 y el límite de cobertura E2E. |
| `specs/active/03-modo-maniobras/tasks.md` | **As-built v15** con la lista real de archivos. |
| `specs/active/03-modo-maniobras/requirements.md` | Nota de reconciliación bajo **R10.7** (el *qué* del EARS no cambia; la conducta nueva es transversal y está declarada, con su límite de verificación ADR-029). |
| `scripts/run-tests.mjs` | Registra el guard nuevo (un guard que no corre da falsa confianza). |
| 3 guards (`keyboard-avoiding`, `worklet-callbacks`, `safe-bottom-inset`) | El conteo de archivos escaneados decía **364**; el real es **366**. Corregido (el piso de 300 no cambia). |

### Pasada 2 (post-review)

| archivo | qué se reconcilió |
|---|---|
| `app/src/components/sheet-keyboard-dismiss-guard.test.ts` | **C1**: la afirmación "un overlay modal que NO use `$scrim` hoy no existe en el repo" era **falsa** → el bloque `EL MODELO` ahora dice qué garantiza la semilla (una sola dirección) y qué NO, y el límite (b) viejo se reemplazó por la **regla secundaria** + la **excepción nombrada** con sus 3 razones. **C2**: test nuevo de la dirección faltante de `claimsKeyboard` + límite (b) nuevo declarando hasta dónde llega la evidencia (`.focus(` prueba que hay mecanismo de foco, no que corra al montar). El guard pasó de 9 a **11 tests**. |
| `specs/active/03-modo-maniobras/tasks.md` | **C3**: "(3 tests)" de la E2E → **4**. Además: el guard con sus 11 tests, las dos direcciones de `claimsKeyboard`, la regla secundaria y la excepción nombrada; y el capture file con sus 4 tests / 7 capturas. |
| `specs/active/03-modo-maniobras/design.md` (As-built v12) | Qué chequea el guard, ahora completo: dos direcciones de `claimsKeyboard` + cierre de la enumeración por geometría + `EstablishmentSwitcherDropdown` como excepción con sus razones. |
| `docs/design-system.md` §6 | Ídem, en el bullet del hook (es el lugar donde un dev lo va a leer antes de escribir el próximo sheet). |
| este informe | §4(b) (anidados vs encadenados), §5 (11 tests + las dos reglas nuevas + la enumeración honesta de las sintéticas), §6 (output literal de la corrida final), §7 (pasada 2), §9 (límites 3 y 4 reescritos). |

## 9. Lo que me quedó dudoso (para el reviewer / el leader)

1. **El veredicto es DEVICE y no lo puedo dar yo.** En web no hay IME. A mirar en el Android de Raf: (a) que la ‹ con el teclado abierto baje el teclado **y** muestre el sheet entero; (b) el mismo caso en el paso de CE (tipear cm → tocar la edad); (c) que un bastonazo mientras se tipea baje el teclado y muestre el overlay; (d) que "Guardar como rutina" **siga abriendo el teclado solo** (la excepción); (e) que el sheet de vacunas se siga tipeando normal.
2. **iOS también cambia.** El descarte no está gateado por plataforma, y en iOS el defecto era el mismo (el sheet se dibuja bajo el teclado). Es roto→arreglado, no una regresión, pero iOS no se puede re-testear hasta el 1/8 → el cambio se mantuvo **mínimo y auditable leyendo**: una línea por archivo, sin tocar layout.
3. **`claimsKeyboard` ahora está cerrado en las dos direcciones** (faltaba, C2): el guard exige la declaración a todo sheet con `autoFocus` **y** exige evidencia de auto-foco a todo `claimsKeyboard` declarado. Lo que queda, y está escrito como límite (b) en el header: el guard prueba que **hay** un mecanismo de foco en el archivo (`autoFocus` o `.focus(`), no que **corra al montar** — un `.focus(` puede vivir en un `onPress`. Ese último tramo es lectura, no ejecución. Hoy el único `.focus(` del repo está en un `onPress` (`CircunferenciaEscrotalStep`) y ese archivo no declara `claimsKeyboard`, así que el caso no está vivo.
4. **El argumento del hook no es verificable estáticamente en general.** La sub-regla cubre el caso mecánico (`open: boolean` + llamada pelada), pero `FindOrCreateOverlay` no tiene prop `open` — pasa `state !== null`. Un sheet futuro que se abra por estado interno y llame al hook pelado quedaría roto en silencio. Declarado como límite (a).
4-bis. **La enumeración de overlays ya no es una promesa escrita, pero sigue teniendo un borde.** Se cierra por DOS firmas (color: `$scrim`; geometría: `absoluteFill` / `<Modal` / capa absoluta con 4 insets en 0 e interactiva), y todo lo que cae afuera de la primera tiene que estar nombrado. Un overlay que no matchee **ninguna** de las dos —p. ej. un sheet de una librería que se portalice solo— seguiría escapando; hoy no existe ninguno y está declarado como límite (c).
5. **La clase de rojos del "paso de tacto"** (9 tests en 3 specs, pre-existente y reproducida en baseline) no es mía, pero conviene mirarla pronto: hoy `maniobra-tacto-*` y `maniobra-carga` no sirven de semáforo sin correr el baseline al lado.
6. **No migré ningún sheet a mano al primitivo** (fuera de alcance para un bugfix, y son 21 con riesgo visual en pantallas 🔴). Queda en backlog, ahora con el argumento reforzado: cada invariante nuevo del patrón sheet cuesta 21 ediciones + un guard.
