baseline_commit: 8384d0a3a7f3a27993922d9ba8f4f5ba315e4efb

# BUGFIX 🔴 MANGA — el teclado tapa TODO el bottom sheet → primitivo `BottomSheetShell`

Reporte de Raf (device iOS, build preview-dev): al enfocar el input del sheet **"Vacunación"** (etapa 2 del
wizard de jornada) **solo quedaba visible el título**; el input, los chips ya agregados, el "+", las
sugerencias y los DOS CTAs caían debajo del teclado. *"No se ve lo que estás escribiendo, no tenés feedback
de si escribiste la vacuna bien o mal, y no ves ningún CTA para confirmar lo escrito."*

Causa raíz (verificada, no re-investigada): **bug de CLASE**. Ningún bottom sheet del repo tenía
keyboard-avoidance — el idiom se copiaba a mano en cada sheet (`View absolute inset0 $scrim` + backdrop
`Pressable` + `YStack maxHeight` anclado abajo) y en iOS el teclado se dibuja ENCIMA sin empujar nada.

Alcance aprobado por el leader (Puerta 1): primitivo reusable + migrar los **4 sheets con input de texto**.
Territorio de la otra terminal (`ble-stick/**`, `services/ble/**`, `TagScan*`, `BleConnectionChip`) **NO
tocado** — verificado en el diff final.

## Tasks

- [x] T1 — Lógica PURA `app/src/utils/sheet-shell.ts` (`sheetCondensation`) + unit `sheet-shell.test.ts`
      (5 tests). Registrado en `scripts/run-tests.mjs`.
- [x] T2 — Primitivo `app/src/components/BottomSheetShell.tsx` + export en `components/index.ts`.
- [x] T3 — Migrado `app/app/maniobra/_components/ManeuverConfigSheet.tsx` (el del bug) + fixes propios
      (orden del cuerpo, Enter multi).
- [x] T4 — Migrado `app/app/maniobra/_components/CustomFieldSheet.tsx` (3 modos: classify / maniobra / edit).
- [x] T5 — Migrado `app/app/maniobra/_components/SavePresetSheet.tsx`.
- [x] T6 — Migrado `app/src/components/sigsa/BreedPickerSheet.tsx`.
- [x] T7 — E2E `app/e2e/sheet-teclado.spec.ts` (3 tests) — verde.
- [x] T8 — Capture Gate 2.5 `app/e2e/captures/sheet-teclado.capture.ts` (9 shots) — verde.
- [x] T9 — Reconciliación de specs + `docs/design-system.md` + autorrevisión adversarial.

## API del primitivo (y por qué cada prop)

`BottomSheetShell` es el **hermano de `FooterActionShell`** (mismo problema, sheets en vez de pantallas) y
**reusa** su lógica pura (`computeSafeBottomInset` / `resolveFooterPaddingBottom` de `utils/footer-action.ts`)
y su hook (`useKeyboardVisible`). Nada se reimplementó.

| Prop | Por qué |
|---|---|
| `title` / `description` | El header es del shell: título `$7` con `lineHeight` matching (regla de descendentes: "Vacunación" trae g/j) y descripción **condensable**. Si el copy viviera en el hijo, la condensación no podría existir. |
| `children` | Body (va dentro del `ScrollView` del shell). |
| `footer` / `secondaryFooter` | **Dos slots, no uno**: la condensación necesita distinguir el CTA primario (nunca se oculta) del secundario (se oculta con el teclado). Un solo slot obligaría a que cada sheet reimplemente la decisión. |
| `onClose` | Lo disparan el backdrop (con guard) **y** la X del header. Una sola vía de salida para el caller. |
| `testID` / `scrimTestID` / `closeTestID?` / `bodyTestID?` | Los testID as-built **no siguen un patrón derivable** (`maneuver-config-sheet`+`maneuver-config-scrim` vs `breed-sheet`+`breed-sheet-scrim`) → explícitos para **preservar los E2E existentes**. `closeTestID` default `${testID}-close`. `bodyTestID` existe porque el oráculo de geometría de `maniobra-customfield-validacion` mide el viewport del scroll (`custom-field-scroll`). |
| `maxHeight` | Default `'85%'`; `CustomFieldSheet` conserva su `'90%'` as-built. |
| `scrollViewRef` / `onBodyLayout` / `onBodyContentSizeChange` | El **scroll-al-campo determinista** del `CustomFieldSheet` (ref + alto de viewport + crecimiento del contenido) sigue viviendo en el sheet: el shell solo relaya. Sin estos tres, migrarlo habría regresionado la validación. |
| `contentGap` | El gap del contentContainer difiere por sheet ($2 razas / $3 preconfig / $4 form custom). |
| `keyboardShouldPersistTaps` | Default `'handled'`: con el teclado abierto, tocar un chip de sugerencia lo agrega al **primer** toque. |
| `showGrip`, `scrimA11yLabel`, `closeA11yLabel` | Escapes chicos para no perder detalles as-built (el scrim del `SavePresetSheet` se anuncia "Cancelar", no "Cerrar"). |

**Lo que el shell decide y el sheet ya no**: backdrop + guard doble-rAF, `KeyboardAvoidingView`, esqueleto
header/body/footer con los `flexShrink` correctos, safe-area, condensación, X de cierre, grip, radios y
paddings del sheet.

## Diff por archivo

| Archivo | Qué |
|---|---|
| `app/src/utils/sheet-shell.ts` (NUEVO) | Decisión pura `sheetCondensation({keyboardVisible})` → `{showDescription, showSecondaryAction, showCloseButton}`. La X se devuelve como decisión (siempre `true`) para **lockearla por test**. |
| `app/src/utils/sheet-shell.test.ts` (NUEVO) | 5 tests: qué se suelta con el teclado, qué NUNCA (la X), pureza. |
| `app/src/components/BottomSheetShell.tsx` (NUEVO) | El primitivo. Contiene el comentario largo del **guard anti click-huérfano** (movido íntegro desde `ManeuverConfigSheet`) y el del **bug U5** (`flexShrink:1`, nunca `flex:1`). |
| `app/src/components/index.ts` | Export del primitivo + tipo. |
| `ManeuverConfigSheet.tsx` | −100 líneas de esqueleto (guard, scrim, YStack, header, footer, safe-area) → shell. **Cambios de contenido**: (a) **input ARRIBA de los chips**; (b) multi: `submitBehavior="submit"` + `blurOnSubmit={false}` + `returnKeyType="next"` (Enter agrega y **no baja el teclado**); single: `blurAndSubmit`/`done` (sin cambio). Lógica multi/single, chips, autocompletar, `handleSave` intactos. |
| `CustomFieldSheet.tsx` | Esqueleto → shell (guard + scrim + header + footer + safe-area borrados). Los **dos pasos** (classify/form) ahora varían `children` + `footer`/`secondaryFooter` del mismo shell; el "Cancelar" del paso classify pasó de estar DENTRO del scroll al footer fijo. Scroll-al-campo, borde terracota, error inline y caps intactos. Input de OPCIONES: mismo fix de Enter (agrega sin bajar el teclado). |
| `SavePresetSheet.tsx` | Esqueleto → shell. Es el caso más expuesto (`autoFocus` abre el teclado al montar). Gana `maxHeight` (antes sin cap: con error + input largo podía desbordar). Fail-closed, error, `maxLength`, Enter→guardar intactos. |
| `BreedPickerSheet.tsx` | Esqueleto → shell. El **buscador pasó del header FIJO al primer lugar del body**: con el teclado arriba, 3 bloques fijos (título+descripción+buscador) dejaban la lista sin alto útil. Guard re-armado por montaje (`open` monta/desmonta el shell) en vez de a mano. |
| `app/e2e/sheet-teclado.spec.ts` (NUEVO) | 3 tests de regresión (abajo). |
| `app/e2e/captures/sheet-teclado.capture.ts` (NUEVO) | 9 capturas nombradas para el Gate 2.5. |
| `scripts/run-tests.mjs` | Registra `sheet-shell.test.ts` (convive con el `reorder-autoscroll.test.ts` que agregó la otra terminal). |
| `specs/active/03-modo-maniobras/{design,requirements}.md`, `specs/active/08-export-sigsa/design.md`, `docs/design-system.md` | Reconciliación (abajo). |

## Trazabilidad (requisito → test)

No hay `requirements.md` propio (bugfix con Puerta 1 del leader). Se mapea contra el reporte de Raf:

| Requisito del reporte | Test concreto |
|---|---|
| "no se ve lo que estás escribiendo" → el input tiene que quedar visible con el teclado arriba | `e2e/sheet-teclado.spec.ts` (viewport 412×420 ≈ alto útil con teclado → `expectInsideViewport('maneuver-config-input')`) + capturas 03/05/07/09. **Lift real = device.** |
| "no tenés feedback de si escribiste la vacuna bien o mal" → los chips cargados tienen que verse | `sheet-teclado.spec.ts` (3 chips visibles tras cada Enter + el input queda ARRIBA de los chips: `inputBox.y < chipBox.y`) + captura 02 |
| "no ves ningún CTA para confirmar" → el CTA primario tiene que quedar alcanzable | `sheet-teclado.spec.ts` (`Guardar` visible y su `y+height ≤ 420`) + capturas 03/05/07 |
| Condensación (soltar descripción + secundario, nunca el primario) | `src/utils/sheet-shell.test.ts` (4 tests) — **no observable en web** |
| La salida nunca desaparece (X siempre) | `sheet-shell.test.ts` ("la X está SIEMPRE") + `sheet-teclado.spec.ts` (la X cierra los 4 sheets) |
| Cargar 3 vacunas seguidas sin reabrir el teclado | `sheet-teclado.spec.ts` (loop de 3 con `press('Enter')` → chip + `toHaveValue('')` + `toBeFocused()` + sheet sigue abierto) |
| El backdrop sigue sin auto-cerrarse en web táctil (guard movido al primitivo) | `e2e/maniobra-config-sheet-race.spec.ts` **3/3 sin tocar** |
| El buscador de razas sigue filtrando tras mover al body | `sheet-teclado.spec.ts` + `e2e/sigsa-breed-renspa.spec.ts` 4/4 |
| Validación scroll-al-campo del custom field intacta | `e2e/maniobra-customfield-validacion.spec.ts` 1/1 (oráculo de geometría sobre `custom-field-scroll`) |

## Verificación corrida (lo que EJECUTÉ y vi)

- `pnpm typecheck` → **exit 0**. Además `tsc --noUnusedLocals` filtrado a los archivos tocados → **0 hallazgos**.
- `node scripts/check-hardcode.mjs` → **0 violaciones** (ADR-023 §4).
- Unit del área: `maneuver-wizard` + `custom-field` + `breed-picker` + `footer-action` + `sheet-shell` +
  `scroll-affordance` → **123/123**.
- `node scripts/check.mjs --fast` → **entorno OK** (estructura + feature_list + anti-hardcode). El check
  COMPLETO no se corrió: pega contra la Supabase dev compartida y hay **otra terminal trabajando en paralelo**
  (rate-limit flake conocido); el leader lo corre antes de commitear.
- E2E (web export fresco, `pnpm e2e:build`):
  - `sheet-teclado.spec.ts` → **3/3** (`--workers=1`).
  - `maniobra-config-sheet-race.spec.ts` + `maniobra-customfield-validacion.spec.ts` + `maniobra-custom.spec.ts` → **6/6**.
  - `maniobra-rutinas-gestion.spec.ts` + `maniobra-custom-gestion.spec.ts` + `sigsa-breed-renspa.spec.ts` → **13/13**.
  - `maniobra-wizard.spec.ts` + `maniobra-sanitaria.spec.ts` → **7/7**.
  - `maniobra-offline.spec.ts` → **1/1**.
  - **2 rojos transitorios, ambos re-corridos verdes**: fallaron en `waitForSignIn`/`waitForHome` (la pantalla
    de login no montó) — flake de arranque bajo carga paralela, NO tocan sheets. Re-run individual: verde.
- Capturas Gate 2.5: `playwright test e2e/captures/sheet-teclado.capture.ts --config playwright.capture.config.ts`
  → **2 passed, 9 shots** en `app/e2e/captures/__shots__/sheet-teclado/` (gitignored, NO se `git add`).
  *(El `Assertion failed: UV_HANDLE_CLOSING` al final es el crash de teardown de Node en Windows POSTERIOR al
  pass — no es fallo de test, memoria `reference_playwright_win_teardown`.)*
- **Auto-veto visual de las 9 capturas** (las miré): título completo sin recorte de descendentes en los 4
  sheets; X alineada con el título y sin pisarlo; input arriba y chips debajo; con alto recortado (412×420)
  el sheet clampea al 85% y el body scrollea con el CTA siempre abajo; sin overflow horizontal a 412.

### Límite de la verificación (ADR-029) — qué NO pude verificar

react-native-web **no monta teclado virtual**: `Keyboard` nunca emite → `useKeyboardVisible()` queda `false`.
Por lo tanto **en web NO se puede observar** (a) el lift real sobre el teclado, (b) la condensación, (c) que
el Enter no baje el teclado del SO (en web verifiqué el proxy exacto: el input **conserva el foco**).
Lo que web sí ejercita es la **geometría con alto útil recortado** (viewport 412×420), que es la mitad
determinante del layout. **Veredicto en device (Raf), iOS y Android**, con este guion:
1. Wizard → etapa 2 → Vacunación → tocar el cuerpo → enfocar el input: el sheet debe **subir**; con el
   teclado arriba deben verse título + input + chips + **"Guardar"**, sin "Cancelar" ni descripción, con la **X**.
2. Cargar 3 vacunas seguidas con el Enter del teclado: no debe bajarse el teclado entre una y otra.
3. Tocar un chip de "Usadas antes" con el teclado abierto: debe agregarse al **primer** toque.
4. Ídem en "Guardar como rutina" (el teclado abre solo por `autoFocus`) y en el buscador de razas del alta.

## Autorrevisión adversarial (qué busqué, qué encontré, cómo lo cerré)

1. **¿El body colapsa a 0 en nativo con contenido corto (bug U5)?** No: el body va `flexShrink:1` +
   `minHeight:0` + `basis:auto` — exactamente el fix U5, ahora en el primitivo con su comentario. Encontré un
   riesgo NUEVO al meter el KAV: la **columna del sheet** con `flexShrink:0` (as-built) se **desbordaría por
   arriba** cuando el alto útil se parte al medio (título fuera de pantalla). Cerrado poniéndole
   `flexShrink:1` a la columna (shrink, no grow → no colapsa con contenido corto). Verificado empíricamente a
   412×420: el sheet clampea y el título queda dentro (assert en el E2E, no solo a ojo).
2. **¿El footer queda alcanzable con el teclado arriba?** Sí por construcción (footer fuera del scroll +
   KAV + `resolveFooterPaddingBottom` que no reserva safe-area con el teclado abierto). Assert de geometría
   en el E2E con el viewport recortado. El lift en sí es device.
3. **¿El scrim se auto-cierra en web (click huérfano)?** No: el guard doble-rAF se movió **entero** al
   primitivo (con su comentario). `maniobra-config-sheet-race.spec.ts` 3/3 sin tocar el test.
   Sub-riesgo detectado: `BreedPickerSheet` **re-armaba** el guard en cada `open` (queda montado con
   `open=false`). En el primitivo el guard arma al MONTAR → verifiqué que el early `if (!open) return null`
   está **antes** del shell, así que monta/desmonta por apertura: equivalente. Si alguien saca ese early
   return, el guard deja de re-armarse → lo dejé anotado en el archivo.
4. **¿Algún sheet migrado perdió comportamiento propio?** Revisé uno por uno: validación con scroll-al-campo
   + borde terracota + error inline (custom), fail-closed + `autoFocus` + `maxLength` + Enter→guardar
   (preset), multi/single + chips + autocompletar + guardar-vacío-limpia (preconfig), filtro + "Sin raza"
   siempre + empty-states (razas). Todo preservado y cubierto por sus E2E existentes, que corrí.
5. **testIDs**: preservados TODOS (grep + los E2E existentes pasan). Nuevos: `<sheet>-close`.
6. **Tests que pasan por la razón equivocada**: el `toBeFocused()` sí ejercita el path real (sin
   `blurOnSubmit={false}` rn-web blurea y el assert cae — lo verifiqué razonando sobre el código de
   `react-native-web/dist/exports/TextInput`, que **ignora `submitBehavior`** y solo lee `blurOnSubmit`; por
   eso paso **los dos** props, no solo el canónico de RN 0.85).
7. **API real, no adivinada**: verifiqué `submitBehavior` en `react-native/Libraries/Components/TextInput/
   TextInput.d.ts` (`SubmitBehavior = 'submit'|'blurAndSubmit'|'newline'`) y su resolución en `TextInput.js`
   (submitBehavior gana sobre blurOnSubmit, sin warning). RN instalado = **0.85.3**.
8. **`app.config.ts` no pisa el modo de teclado de Android**: no hay `softwareKeyboardLayoutMode` → queda el
   default `resize` de Expo. Verificado leyendo el archivo.
9. **UX que el reporte no pedía pero es el mismo bug**: `ManeuverConfigSheet` NO tenía
   `keyboardShouldPersistTaps` → con el teclado abierto, el primer toque sobre un chip de "Usadas antes" solo
   bajaba el teclado (dos toques por vacuna, 🔴 manga). El shell lo pone en `'handled'` para los 4.
10. **Multi-tenant / offline-first**: N/A — es UI pura, sin acceso a datos ni `establishment_id`; ningún
    sheet migrado toca servicios ni red (el `onSave`/`onCreate` siguen siendo callbacks del caller).
11. **Colisión con la otra terminal**: `git status` confirma que los archivos de BLE/TagScan y los suyos
    (`ManeuverReorderList.tsx`, `jornada.tsx`, `reorder-autoscroll*`, `docs/backlog.md`) **no fueron tocados
    por mí**. Compartimos `scripts/run-tests.mjs`: ambas entradas conviven.

## Reconciliación de specs (hecha, no propuesta)

- `specs/active/03-modo-maniobras/design.md` → **"As-built v7"** nuevo (después del v6/U5): causa raíz, las 7
  responsabilidades del primitivo, los 4 sheets migrados, los cambios de contenido del sheet de preconfig
  (input arriba + Enter multi), cobertura, límite de verificación en web y la lista de sheets **no** migrados.
- `specs/active/03-modo-maniobras/design.md` → nota bajo **FIX 3 (M5-CUSTOMFIELDSHEET-FIX)**: el `flex:1` del
  cuerpo que describía quedó **superado** por el `flexShrink:1` del shell (y el `custom-field-scroll` sigue en
  el viewport scrolleable → el oráculo del e2e no cambia).
- `specs/active/03-modo-maniobras/requirements.md` → **nota de reconciliación bajo R1.8** (afecta R1.7/R1.8):
  el *qué* no cambia; se reconcilia **cómo se opera el sheet con el teclado** (sube + condensa + X; Enter
  multi no baja el teclado; input arriba de los chips). No reescribí los EARS.
- `specs/active/08-export-sigsa/design.md` → nota **2026-07-25** del `BreedPickerSheet` (migración al shell,
  buscador del header fijo al body, X, guard por montaje, testIDs preservados).
- `docs/design-system.md` §6 → entrada del primitivo **`BottomSheetShell`** con la regla: *todo bottom sheet
  nuevo usa este shell; el que tenga input de texto, obligatoriamente*.

## Riesgos / regresiones que veo (para el leader)

1. **Android edge-to-edge (MEDIO, device).** En iOS el lift lo hace `KeyboardAvoidingView behavior='padding'`;
   en Android se delega al `adjustResize` de la ventana (default de Expo, sin override). Con edge-to-edge
   (Android 15+) hay implementaciones donde la ventana **no** se redimensiona → el sheet podría seguir tapado
   SOLO en Android. Es la misma apuesta que ya hizo `FooterActionShell` (U2, cuyo device-test también sigue
   pendiente). **Contingencia lista si Raf lo ve roto en Android**: reemplazar el KAV por un lift medido —
   `Keyboard` (`endCoordinates.screenY`) + `measureInWindow` del overlay → `lift = max(0, bottomDelOverlay −
   screenYdelTeclado)`, que es auto-corrector (si la ventana ya se redimensionó da 0, sin doble lift) y
   testeable como decisión pura. No lo hice ahora para no desviarme del mecanismo canónico del repo.
2. **Supuesto del KAV (MEDIO, device).** `KeyboardAvoidingView` calcula el lift con `frame.y + frame.height`
   **relativo al padre**, asumiendo que el padre arranca en y=0 de la ventana. Los sheets montan dentro de
   pantallas que aplican `paddingTop={insets.top}`; el overlay es `position:absolute inset0`, que en Yoga se
   posiciona contra la **padding box** (cubre la franja del inset) → el supuesto se sostiene. **Es análisis de
   código, no medición en device**: si el lift quedara corto ~47px en iPhone con notch, ésa es la causa y el
   arreglo es la contingencia (1).
3. **Cambio visual deliberado** en el sheet de preconfig: los chips ahora van DEBAJO del input. Es un cambio
   de diseño (justificado: con los chips arriba, cargar la 3ª/4ª vacuna empujaba el input fuera de la vista);
   **necesita el OK visual de Raf** en la Puerta 2 con las capturas 01/02 a la vista.
4. **Sheets NO migrados con el mismo bug latente**: `TagScanSheet` (tiene `TextInput`, **territorio de la otra
   terminal** → no lo toqué a propósito) y el resto sin input (`ExitJornadaSheet`, `NuevaJornadaConfirmSheet`,
   `OtherRodeoSheet`, `SyncRechazoSheet`, `TactoConfigSheet`, `LotePickerSheet`, `BulkConfirmSheet`,
   `TreatmentStartSheet`/`TreatmentApplicationSheet`, age-sheet de `CircunferenciaEscrotalStep`). Backlog:
   migrarlos al shell borra ~80 líneas duplicadas por sheet y unifica el guard.
5. **`design/**/*.png`**: correr `maniobra-wizard`/`maniobra-sanitaria` re-renderizó 15 PNGs; **los revertí**
   (`git checkout -- design/`). OJO: `design/maniobra-wizard/etapa2-sheet.png` y `etapa3-sheet-rutina.png`
   reflejan cambios REALES (input arriba + X) → si el leader quiere el design actualizado, hay que
   re-renderizarlos a propósito post-aprobación.
6. **NO commiteé nada** (instrucción). Los `__shots__/*.png` quedan gitignored y sin `git add`.
