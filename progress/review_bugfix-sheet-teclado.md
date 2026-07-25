# Review — BUGFIX 🔴 MANGA: el teclado tapaba TODO el bottom sheet (primitivo `BottomSheetShell`)

- **Fecha**: 2026-07-25
- **Baseline**: `8384d0a` (working tree, sin commitear)
- **Informe del implementer**: `progress/impl_bugfix-sheet-teclado.md`
- **Alcance revisado**: `app/src/components/BottomSheetShell.tsx` (nuevo), `app/src/utils/sheet-shell.ts(+.test.ts)` (nuevos),
  `ManeuverConfigSheet.tsx`, `CustomFieldSheet.tsx`, `SavePresetSheet.tsx`, `BreedPickerSheet.tsx` (migrados),
  `app/e2e/sheet-teclado.spec.ts` + `app/e2e/captures/sheet-teclado.capture.ts` (nuevos),
  reconciliación de specs + `docs/design-system.md`.
- **FUERA de alcance (otra terminal, ignorado a propósito)**: `ManeuverReorderList.tsx`, `reorder-autoscroll.*`,
  `maniobra-reorder-autoscroll.spec.ts`, `reorder-autoscroll.capture.ts`, `jornada.tsx` (`testID="jornada-scroll"`),
  y las entradas de `docs/backlog.md` / `tasks.md` del auto-scroll.

## Veredicto

**CHANGES_REQUESTED**

El fix técnico es sólido y lo verifiqué de punta a punta: 22/22 E2E verdes con build fresco, 2405/2405 unit,
typecheck limpio, anti-hardcode 0, testIDs preservados, y las 3 afirmaciones de API del informe
(`submitBehavior` en RN 0.85.3, react-native-web sólo lee `blurOnSubmit`, `app.config.ts` sin override de teclado)
son **ciertas** — las verifiqué en `node_modules`, no las creí.

Rechazo por dos cosas concretas:

1. **`check.mjs` en ROJO** (regla dura). El rojo NO es del diff — es de entorno (PAT de Supabase vencido) — pero
   no puedo firmar APPROVED con el gate en rojo. Detalle y acción en R1.
2. **`tasks.md` no reconciliado** para este fix + **colisión de etiqueta "As-built v7"** entre `design.md` y
   `tasks.md` (dos fixes distintos con el mismo nombre en la misma spec). Regla del repo: toda corrección se
   reconcilia en `{requirements, design, tasks}.md`.

Más un tercer punto de criterio (R3): el reorden "input arriba de los chips" se aplicó a un sheet y no al otro
que tiene exactamente la misma interacción.

---

## Verificación que CORRÍ yo (no leída del informe)

| Qué | Resultado |
|---|---|
| `pnpm typecheck` (`tsc --noEmit`) | **exit 0** |
| Unit suite completa de `scripts/run-tests.mjs` (130 archivos, incluye `sheet-shell.test.ts`) | **2405/2405** |
| `node scripts/check-hardcode.mjs` (ADR-023 §4) | **0 violaciones** |
| `pnpm e2e:build` (export web FRESCO — el `dist` del implementer era anterior al último edit de `BottomSheetShell.tsx`) | OK |
| `sheet-teclado.spec.ts` + `maniobra-customfield-validacion.spec.ts` + `maniobra-config-sheet-race.spec.ts` | **7/7** |
| `sigsa-breed-renspa.spec.ts` + `maniobra-custom.spec.ts` + `maniobra-custom-gestion.spec.ts` + `maniobra-rutinas-gestion.spec.ts` | **15/15** |
| `node scripts/check.mjs` (2 corridas completas) | **ROJO las dos** — ver R1 |
| `design/**/*.png` | **INTACTO** (no corrí `maniobra-wizard`/`maniobra-sanitaria` a propósito: son las que escriben ahí) |
| Fixture leftover `'9'.repeat(64)` en el remoto | consultado read-only: **0 filas hoy** → el rojo de la corrida 1 fue leftover transitorio |

**Total E2E del área: 22/22.** Nada commiteado.

### Verificaciones puntuales de API (contra `node_modules`, no contra el informe)

- `react-native@0.85.3`; `TextInput.d.ts:92` define `SubmitBehavior = 'submit'|'blurAndSubmit'|'newline'` y
  `:760` `submitBehavior?`. `TextInput.js:559-581`: si `submitBehavior != null` **gana** sobre `blurOnSubmit`,
  sin warning → pasar los dos props NO se contradice.
- `react-native-web/dist/exports/TextInput/index.js:86,274-284`: sólo lee `blurOnSubmit`; **no conoce**
  `submitBehavior` → el par es necesario para que el E2E (`toBeFocused()`) ejercite el path real.
- `react-native-web/dist/exports/KeyboardAvoidingView/index.js`: es un `<View>` con el `style` pasado tal cual
  (`onKeyboardChange` vacío) → en web el KAV no altera el layout. La E2E NO puede ejercitar el lift.
- `app/app.config.ts`: **no** hay `softwareKeyboardLayoutMode` ni `edgeToEdgeEnabled` → default de Expo.
- `app/tamagui.config.ts`: `$icon=48`, `$navIcon=24`, `$touchMin=56`, `$navBottomMin=12`, `$searchBarLg=56`,
  `$inputText=16`, fuente `$7=20` / lineHeight `$7=28` → el `lineHeight="$7"` del título es matching correcto.

---

## Trazabilidad (requisito ↔ test concreto)

No hay `requirements.md` propio (bugfix por Puerta 1 del leader). Mapeo contra el reporte de Raf y contra la
nota de reconciliación que el implementer metió bajo **R1.8** (afecta R1.7/R1.8).

| Requisito (reporte de Raf / reconciliación) | Test concreto | Estado |
|---|---|---|
| "no se ve lo que estás escribiendo" → el input queda visible con poco alto útil | `app/e2e/sheet-teclado.spec.ts:102-112` (viewport 412×420 → `expectInsideViewport('maneuver-config-input')`) | verde (proxy geométrico; lift = device) |
| "no tenés feedback de si escribiste la vacuna bien o mal" → los chips cargados se ven | `sheet-teclado.spec.ts:83-92` (3 chips tras cada Enter) | verde |
| "no ves ningún CTA para confirmar" → el CTA primario queda alcanzable | `sheet-teclado.spec.ts:113-119` (`Guardar` visible + `y+height <= 420`) | verde |
| Cargar 3 vacunas seguidas sin reabrir el teclado (multi: Enter agrega y no blurea) | `sheet-teclado.spec.ts:83-92` (`toHaveValue('')` + `toBeFocused()` + sheet abierto) | verde |
| Input ARRIBA de los chips | `sheet-teclado.spec.ts:94-99` (`inputBox.y < chipBox.y`) | verde |
| La salida nunca desaparece: X siempre presente | `src/utils/sheet-shell.test.ts:31-34` + `sheet-teclado.spec.ts:123,150,161,196` (la X cierra los 4 sheets) | verde |
| CONDENSACIÓN (soltar descripción + secundario, nunca el primario) — **decisión** | `src/utils/sheet-shell.test.ts:11-41` (4 tests) | verde |
| CONDENSACIÓN — **cableado del componente** (que `BottomSheetShell` honre las 3 flags) | **NINGUNO** | ⚠️ ver N3 |
| Lift real sobre el teclado (iOS `KeyboardAvoidingView`) | **NINGUNO posible en web** | ⚠️ device (ADR-029) |
| El backdrop no se auto-cierra en web táctil (guard movido al primitivo) | `e2e/maniobra-config-sheet-race.spec.ts` **3/3 sin tocar el test** | verde (corrido por mí) |
| Validación del custom field intacta (scroll-al-campo + borde terracota + error inline) | `e2e/maniobra-customfield-validacion.spec.ts` **1/1** (oráculo de geometría sobre `custom-field-scroll`) | verde (corrido por mí) |
| El buscador de razas sigue filtrando tras mover al body | `sheet-teclado.spec.ts:190-193` + `sigsa-breed-renspa.spec.ts` **4/4** | verde (corrido por mí) |
| Enum append-only / edición / borrado de datos custom sin regresión | `maniobra-custom.spec.ts` 2/2 + `maniobra-custom-gestion.spec.ts` 5/5 | verde |
| Presets: crear / renombrar / reconfigurar / borrar sin regresión | `maniobra-rutinas-gestion.spec.ts` 4/4 | verde |

**Conclusión de trazabilidad**: todo lo que el reporte de Raf pedía tiene test, salvo las dos filas ⚠️, que son
**estructuralmente inobservables en web** (rn-web no monta teclado virtual y el repo no tiene infra de test de
componentes). Están declaradas por el implementer y quedan gateadas al veredicto device. Lo acepto, pero lo dejo
explícito para que no se lea como "cubierto".

---

## Regresión funcional por sheet migrado (foco 1)

| Sheet | Comportamiento propio | Veredicto |
|---|---|---|
| `ManeuverConfigSheet` | multi/single, chips, `filterAutocomplete`, `handleSave` (incluye guardar-vacío = limpiar), a11y, `config-chip-*`/`config-suggestion-*` | **Intacto.** Diff comparado línea a línea: sólo cambió el orden del cuerpo y los props de Enter. |
| `CustomFieldSheet` | scroll-al-campo determinista (`scrollRef` + `viewportHRef` + `pendingScrollRef` + `onFieldLayout` + `onContentSizeChange`), borde terracota, error inline, caps, append-only enum, modo edit | **Intacto.** El shell relaya `scrollViewRef`/`onBodyLayout`/`onBodyContentSizeChange`; las secciones siguen siendo hijas DIRECTAS del contentContainer (el fragment no crea nodo de layout) → los `layout.y` medidos no cambian de sistema de referencia. `maxHeight="90%"` conservado. Oráculo de geometría verde a 360 y 412. |
| `SavePresetSheet` | `autoFocus`, fail-closed + error, `maxLength` 60, Enter→guardar, scrim con label "Cancelar" | **Intacto** (`scrimA11yLabel="Cancelar"` preservado). **Gana** `maxHeight 85%` + body scrolleable (antes sin cap). Mejora real, pero no está en el as-built v7 del design (N5). |
| `BreedPickerSheet` | filtro, "Sin raza" siempre presente, 2 empty-states, guard re-armado por apertura, `breed-sheet-*` | **Intacto.** Verifiqué que el `if (!open) return null` está en `BreedPickerSheet.tsx:83`, **antes** del shell → monta/desmonta por apertura → el `useEffect` del guard (`BottomSheetShell.tsx:160-179`) se re-arma. Equivalente al a-mano. El buscador movido al body sigue usable (primer hijo + `keyboardShouldPersistTaps="handled"`). |

**Bug U5 (foco 2)**: verificado. En los 4 sheets migrados + el shell hay **UN solo `ScrollView`**
(`BottomSheetShell.tsx:299-311`) y va `flexShrink={1}` + `style={{minHeight:0}}`. **Ningún body con `flex:1`.**
Bonus: el `CustomFieldSheet` tenía `flex:1` en el paso *classify* (contenido corto) → ése era U5 **latente y
probablemente roto en nativo**; la migración lo cierra de paso.

**testIDs (foco 4)**: comparé `git show HEAD:<file>` vs el archivo nuevo, uno por uno. **Cero pérdidas.**
Los `*-scrim` pasaron a props (`scrimTestID`) y `custom-field-scroll` a `bodyTestID` — por eso un grep ingenuo
de `testID="` los "pierde"; están todos. Nuevos: `<sheet>-close` x4.

**Condensación / salidas (foco 3)**: `hasFooter = footer != null || (secondaryFooter != null && showSecondaryAction)`
(`BottomSheetShell.tsx:200`). En `BreedPickerSheet` (sólo secundario) con el teclado arriba el footer desaparece
**entero** — buscado y documentado; la salida sigue siendo la X + el scrim. Con `secondaryFooter` ausente no hay
caso roto. La X: 48x48 (`$icon`) + `hitSlop 8` >=44, `buttonA11y` con label "Cerrar", pieza Tamagui con `onPress`
+ `pressStyle` (NO un `Pressable` de RN envolviendo Tamagui — respeta `reference_rn_pressable_tamagui_tap`).
**Flicker**: el mount/unmount de descripción + CTA secundario en `keyboardWillShow/Hide` es un salto de layout
real si el teclado parpadea; en los 4 sheets el único con 2 inputs es `CustomFieldSheet` y mover el foco entre
ellos NO baja el teclado en iOS → riesgo bajo. **Sin cobertura automática** → guion device.

---

## Tasks

`impl_bugfix-sheet-teclado.md` declara T1–T9 todas en `[x]`, y **todas están efectivamente hechas** (verifiqué
archivo por archivo). El problema no es el ledger del informe: es que **`specs/active/03-modo-maniobras/tasks.md`
no tiene ninguna entrada de este fix** (ver R2).

- Tasks completas: **sí en el informe / NO en la spec**.

---

## CHECKPOINTS

| # | Checkpoint | Estado |
|---|---|---|
| C1 | Archivos base + docs + 5 agentes | **[x]** |
| C1 | `node scripts/check.mjs` exit 0 | **[ ]** — rojo por entorno (R1) |
| C2 | Como mucho una feature `in_progress` | **[x]** (ninguna; 03 está `done`, esto es delta de bugfix) |
| C2 | Toda feature `done` con tests que pasan | **[x]** en frontend; backend no evaluable hoy (R1) |
| C2 | `progress/current.md` describe la sesión activa | **[x]** |
| C3 | Capas previstas (`components`, `utils`) | **[x]** — primitivo en `src/components`, lógica pura en `src/utils` |
| C3 | Sin deps externas nuevas | **[x]** (`package.json` sin tocar) |
| C3 | Sin logs de debug / TODOs sin contexto | **[x]** |
| C3 | Sin `establishment_id` hardcodeado | **[x]** (UI pura, no toca datos) |
| C4 | >=1 test por módulo con lógica | **[x]** (`sheet-shell.test.ts`, registrado en `scripts/run-tests.mjs:66`) |
| C4 | Fixtures reales | **[x]** (E2E contra Supabase real, usuarios namespaced + cleanup) |
| C4 | Runner >0 tests, todos verdes | **[x]** frontend (2405 + 22 E2E) / **[ ]** suite completa (R1) |
| C4 | Test cross-tenant si toca RLS | **N/A** |
| C5 | Sin artefactos sin trackear | **[x]** (`__shots__/` gitignored y sin `git add`; `design/` intacto) |
| C5 | `progress/history.md` con entrada de la sesión | **[ ]** — lo cierra el leader al final de sesión |
| C5 | Última feature en su estado correcto | **[x]** |
| C6 | Feature `sdd:true` con los 3 archivos de spec | **[x]** |
| C6 | `requirements.md` EARS estricto | **[x]** (la nota de reconciliación es prosa bajo R1.8, no reescribe los EARS — correcto) |
| C6 | Toda feature `done` con `sdd:true` tiene sus tasks `[x]` | **[ ]** — `tasks.md` sin entrada del delta (R2) |
| C6 | Cada `R<n>` cubierto por >=1 test | **[x]** con las 2 salvedades declaradas (N3 / device) |
| C7 | Multi-tenant | **N/A** |
| C8 | Offline-first | **N/A** |
| C9 | Suite E2E de regresión verde | **[x]** (`sheet-teclado.spec.ts` 3/3, corrido por mí) |
| C9 | Capture file con estados clave | **[x]** (`sheet-teclado.capture.ts`, 9 estados; NO lo re-corrí) |
| C9 | Gate 2.5 del leader adjuntado a Puerta 2 | **[ ]** — pendiente del leader |
| C9 | `__shots__/*.png` NO commiteados | **[x]** |

---

## Checklist RAFAQ-específico

- **A. Multi-tenancy / RLS** — **N/A**. El delta no crea ni toca tablas, policies, RPCs ni migraciones
  (`git status`: cero archivos bajo `supabase/`). Los sheets no leen ni escriben datos: `onSave`/`onCreate`/
  `onSelect` siguen siendo callbacks del caller.
- **B. Offline-first** — **N/A**. Ningún sheet migrado importa servicios, PowerSync ni Supabase. Sin sync bucket
  ni resolución de conflictos que definir.
- **C. BLE** — **N/A**. `TagScanSheet` / `ble-stick` / `services/ble` **no fueron tocados** (verificado en el
  diff); quedaron a propósito fuera por ser territorio de la otra terminal, con entrada en `docs/backlog.md`.
- **D. UI de campo (manga)** — aplica:
  - [x] **Targets**: CTAs `Button fullWidth` >= `$touchMin`=56; "+" de agregar 56x56 (`$searchBarLg`);
        `breed-sheet-cancelar` `minHeight="$touchMin"`; X de cierre 48 + `hitSlop 8` (>=44).
        *Nota*: el checklist pide >=60dp; el repo canoniza **56** (`$touchMin`) y este delta no lo baja. La X a 48
        es el token `$icon` del repo y es una salida secundaria. Cumplido contra la convención del repo.
  - [x] **Fuente**: título `$7`=20pt con `lineHeight="$7"`=28 (matching → "Vacunación"/"Configuración" no recortan
        g/j — regla dura, cumplida en `BottomSheetShell.tsx:253-261`); inputs `$inputText`=16 (as-built de TODOS
        los inputs del repo, no lo introduce este fix); descripción `$3`=13, es texto de ayuda y es lo PRIMERO que
        se condensa. Todo `Text` con `numberOfLines` del delta lleva `lineHeight` matching — verificado uno por uno.
  - [x] **Una decisión por pantalla**: el sheet sigue siendo mono-propósito; la condensación lo refuerza.
  - [x] **Loading visible**: "Creando…" / "Guardando…" en los CTAs (`CustomFieldSheet.tsx:362`,
        `SavePresetSheet.tsx:116`) + `disabled` mientras vuela.
- **E. Edge Functions** — **N/A**. No se tocó `supabase/functions/`.

---

## Cambios requeridos

### R1 — `check.mjs` en rojo (BLOQUEANTE por regla dura; **causa de ENTORNO, no del diff**)

Corrí `node scripts/check.mjs` **dos veces completas**. Las dos en rojo, con fallas **distintas** y **ninguna
alcanzable desde este diff** (100% TSX/TS de cliente + E2E + docs; cero archivos bajo `supabase/`):

1. **Corrida 1** — `supabase/tests/animal/run.cjs:1892` → `R2: INPUT-1 CHECK rechaza techo+1…`:
   `23505 duplicate key value violates unique constraint "animals_tag_unique"` en el borde `'9'.repeat(64)`
   (`run.cjs:1933`). Es el flake documentado (`reference_input1_tag_collision`): el fixture usa un tag FIJO y
   global. **Consulté el remoto read-only: hoy hay 0 filas con ese tag** → era un leftover transitorio. En la
   corrida 2 esta suite **pasó**.
2. **Corrida 2 (y re-run aislado → DETERMINISTA)** — `supabase/tests/operaciones_rodeo/run.cjs:415/:606/:641`:
   `Error: adminQuery HTTP 401: {"message":"Unauthorized"}`.
   `adminQuery` (`run.cjs:58-70`) pega a `https://api.supabase.com/v1/projects/<ref>/database/query` con
   `Bearer ${SUPABASE_ACCESS_TOKEN}`. **El PAT de la Management API está vencido o revocado.**

> **Acción (Raf, no el implementer)**: renovar `SUPABASE_ACCESS_TOKEN` en `.env.local` y re-correr
> `node scripts/check.mjs`. Mientras el PAT esté vencido, `check.mjs` **no puede** dar verde con ningún código.
> El mismo token lo usa `scripts/apply-migration.mjs` → cualquier migración también está bloqueada.

Para que el leader no quede ciego: la parte del gate que **sí** depende del código está verde y la corrí entera
(typecheck + 2405 unit + anti-hardcode + 22 E2E). Lo único no evaluable son las suites de DB que usan el PAT.

### R2 — `specs/active/03-modo-maniobras/tasks.md` sin reconciliar + colisión de etiqueta "As-built v7"

Estado actual:

- `specs/active/03-modo-maniobras/design.md:723` → **"As-built v7"** = *bugfix del TECLADO / `BottomSheetShell`* (este delta).
- `specs/active/03-modo-maniobras/tasks.md:189` → **"As-built v7"** = *bugfix del AUTO-SCROLL del drag* (otra terminal).
- `design.md:712` etiqueta al auto-scroll como **"As-built v3-bis"**.

O sea: dentro de la MISMA spec, "As-built v7" significa dos fixes distintos según el archivo que abras. Y
`tasks.md` **no menciona en ningún lado** este fix ni sus archivos nuevos: la línea `Archivos:` (`tasks.md:190`)
sigue describiendo `ManeuverConfigSheet.tsx` como "v5 = guard / v6 = body flexShrink" y **no lista**
`app/src/components/BottomSheetShell.tsx`, `app/src/utils/sheet-shell.ts(+.test.ts)`,
`app/e2e/sheet-teclado.spec.ts`, `app/e2e/captures/sheet-teclado.capture.ts`, ni la migración de
`CustomFieldSheet` / `SavePresetSheet`.

La regla del repo es reconciliar `{requirements, design, tasks}.md` antes de cerrar. `requirements.md` y
`design.md` están impecables (la nota bajo R1.8 y el as-built v7 del design son de las mejores reconciliaciones
del repo); falta el tercero.

> **Qué hacer**: agregar en `tasks.md` la entrada del delta bajo una etiqueta que NO colisione (p. ej.
> **"As-built v8 (BUGFIX 🔴 MANGA — teclado / `BottomSheetShell`)"**) con su lista de archivos, y **alinear la
> etiqueta del design** (o `design.md:723` pasa a v8, o se deja una línea de mapeo explícita). Cualquiera de las
> dos, pero que un lector futuro no tenga que adivinar.
> Coordinación: `tasks.md` lo está tocando también la otra terminal → que el leader serialice la edición.

### R3 — Inconsistencia de orden chips↔input entre dos sheets del MISMO delta

- `ManeuverConfigSheet.tsx:163-219` = **input + "+"**, después `:221-250` = **chips**.
- `CustomFieldSheet.tsx:552-584` = **chips de opciones**, después `:586-642` = **input + "Agregar"**.

Es la misma interacción ("cargar N ítems de texto libre uno por uno con el teclado abierto"), y el implementer
aplicó a los DOS inputs el mismo fix de Enter (`ManeuverConfigSheet.tsx:180-183` y `CustomFieldSheet.tsx:603-605`,
con el mismo comentario) — pero el reorden a uno solo. El argumento que justifica el cambio en vacunación
("cada ítem agregado CRECE el contenido por encima del input y lo EMPUJA fuera de la vista",
`ManeuverConfigSheet.tsx:27-32`) vale **idéntico** para el editor de opciones: cargar 4-5 opciones con el teclado
arriba empuja el input de opciones hacia abajo.

> **Qué hacer**: o se aplica el mismo orden en `CustomFieldSheet` (input arriba, chips debajo), o se documenta en
> el archivo y en el design **por qué** ahí el orden opuesto es correcto. Hoy queda como olvido, no como decisión.
> (Si Raf rechaza el reorden en la Puerta 2, esto se resuelve solo en la dirección contraria — el leader puede
> diferirlo hasta después del veto visual, pero no dejarlo sin decidir.)

---

## Observaciones (NO bloquean, para el leader / Puerta 2)

- **N1 — Deriva cosmética de la reserva inferior.** As-built, `ManeuverConfigSheet` y `CustomFieldSheet` usaban
  `Math.max(insets.bottom, $4=16)`. El shell usa `computeSafeBottomInset(..., minInset: $navBottomMin=12)`
  (`BottomSheetShell.tsx:190-198`). En web y en Android sin inset esos dos sheets pierden 4px de aire inferior.
  (`SavePresetSheet` y `BreedPickerSheet` ya usaban `$navBottomMin` → sin cambio.) Unificación razonable, pero
  no documentada en el as-built v7.

- **N2 — La X no se deshabilita con `submitting`.** `CustomFieldSheet.tsx:367` deshabilita "Cancelar" durante el
  submit; la X del shell (`BottomSheetShell.tsx:271-294`) no tiene concepto de estado ocupado. No empeora la
  situación (el scrim ya era una salida no gateada as-built), pero la asimetría queda y el shell no expone prop
  para bloquearla si algún sheet futuro la necesita.

- **N3 — El CABLEADO de la condensación no tiene test.** `sheet-shell.test.ts` cubre la función pura, que son 3
  booleanos: los tests son correctos y lockean el invariante duro (la X siempre), pero son **casi tautológicos**
  — no verifican que `BottomSheetShell` realmente consuma `showDescription`/`showSecondaryAction`. Y no puede
  verificarse: `Keyboard` de rn-web nunca emite y el repo no tiene infra de test de componentes. **Queda 100% en
  el veredicto device.** No pido cambio; pido que no se lea como "cubierto".

- **N4 — Qué prueba y qué NO prueba la E2E nueva (respuesta explícita al foco 8).**
  **Prueba**: (a) Enter en multi agrega el chip, limpia el input, **conserva el foco** y no cierra el sheet, x3
  seguidas; (b) `inputBox.y < chipBox.y`; (c) con viewport 412x420 el título no se desborda por arriba del sheet,
  el input entra entero y `Guardar` cae dentro del viewport; (d) la X cierra los 4 sheets.
  **NO prueba**: que el sheet SUBA. El `KeyboardAvoidingView` en web es un `<View>` inerte, así que (c) sólo
  ejercita el **clamp** (`maxHeight` + `flexShrink` del body y de la columna) con poco alto útil — la mitad
  determinante del layout, pero no el lift. Tampoco prueba la condensación ni que el Enter no baje el teclado del
  SO (usa el proxy exacto: el foco sobrevive). El header del spec lo dice sin maquillaje.

- **N5 — `SavePresetSheet` ganó `maxHeight 85%` + body scrolleable** (antes sin cap). Mejora real, pero no figura
  en el as-built v7 del `design.md`.

- **N6 — `blurOnSubmit` está `@deprecated`** en RN 0.85.3 (`TextInput.d.ts:728-740`). El uso está justificado y
  comentado, pero no hay entrada de backlog para sacarlo cuando react-native-web soporte `submitBehavior`.

- **N7 — Residuo de la MISMA clase 🔴 en un sheet migrado.** En `CustomFieldSheet` el input de OPCIONES vive al
  fondo del body (después del label y de los 7 tipos). Con el teclado arriba el sheet sube, pero **nada garantiza
  que ese input quede dentro del viewport del scroll**: RN no auto-scrollea al campo enfocado y el `ScrollView` no
  usa `automaticallyAdjustKeyboardInsets`. Vale medirlo en device (lo agregué al guion).

- **N8 — Riesgo Android confirmado (foco 9).** `app/app.config.ts` **no** pisa `softwareKeyboardLayoutMode`
  (queda `resize`), pero tampoco desactiva edge-to-edge — y con **Expo SDK 56** edge-to-edge está **ON por
  default**. El riesgo #1 del implementer es real y es **la misma apuesta que ya tomó U2 / `FooterActionShell`**
  (`FooterActionShell.tsx:98`, KAV idéntico), cuyo device-test también sigue pendiente. Si Raf lo ve roto en
  Android, la contingencia del implementer (lift medido con `endCoordinates.screenY` + `measureInWindow`,
  auto-corrector) es la correcta y aplica a los DOS primitivos de una.

- **N9 — Supuesto del KAV (riesgo #2 del implementer): lo doy por sostenido, con evidencia distinta a la suya.**
  El KAV calcula el lift con `frame.y + frame.height` relativo al padre, y los sheets montan dentro de pantallas
  con `paddingTop={insets.top}` (`jornada.tsx:449`). Su argumento es de layout de Yoga; el mío es empírico: **en
  la captura del bug de Raf el `$scrim` cubre la pantalla entera**, franja del notch incluida → el overlay arranca
  en y=0 de la ventana → el supuesto se sostiene. Si en device el lift quedara corto ~47px en un iPhone con notch,
  ésa es la causa y la contingencia es la de N8.

- **N10 — `design/**/*.png` desactualizado a propósito.** No corrí `maniobra-wizard`/`maniobra-sanitaria` (son las
  que escriben ahí) y el árbol quedó limpio. Pero `design/maniobra-wizard/etapa2-sheet.png` y
  `etapa3-sheet-rutina.png` **ya no reflejan el as-built** (input arriba + X en el header). El leader decide si
  re-renderiza post-aprobación.

---

## Guion de veredicto en DEVICE (Raf) — lo que web no puede decidir

1. Wizard → etapa 2 → Vacunación → enfocar el input: el sheet debe **subir**; con el teclado arriba deben verse
   título + input + chips + **"Guardar"**, **sin** "Cancelar" ni descripción, **con** la X.
2. Cargar 3 vacunas seguidas con el Enter del teclado: **no** debe bajarse el teclado entre una y otra.
3. Tocar un chip de "Usadas antes" con el teclado abierto: debe agregarse al **primer** toque.
4. "Guardar como rutina" (el teclado abre solo por `autoFocus`) y el buscador de razas del alta: mismo veredicto.
5. **(agregado por el reviewer, N7)** Maniobra custom → tipo `enum_multi` → enfocar el input de **"Nueva opción"**
   con el teclado arriba y cargar 4 opciones: ¿el input de opciones sigue visible o se va abajo del fold?
6. **(agregado por el reviewer, N8)** Repetir 1-5 en **Android** (es donde el lift se delega a `adjustResize` con
   edge-to-edge ON).

---

## Resumen para el leader

- El código está bien y lo verifiqué de verdad: **22/22 E2E** con build fresco, **2405/2405 unit**, typecheck 0,
  anti-hardcode 0, testIDs intactos, sin regresión funcional en ninguno de los 4 sheets, sin `flex:1` en ningún
  body, y las 3 afirmaciones de API del informe son ciertas.
- **Bloquea R1** (check.mjs rojo → PAT de Supabase vencido, acción de Raf) y **R2** (tasks.md sin reconciliar +
  "As-built v7" colisionado, acción del implementer, ~10 minutos).
- **R3** es criterio: puede diferirse hasta el veto visual de Raf, pero hay que decidirlo, no dejarlo caer.
- Nada commiteado. `design/**/*.png` intacto.

---
---

# RE-REVISIÓN ACOTADA — fix-loop (2026-07-25)

Alcance: SOLO lo que cambió después de la revisión anterior. No re-reviso el delta de sheets.
El leader ya resolvió mi finding 2 (tasks.md "As-built v8" + linaje explícito v7↔§6.bis.1 v7 y
auto-scroll↔v3-bis + `Archivos:` con los 4 archivos nuevos) — **verificado, correcto**. Mi finding 1
(check.mjs / PAT vencido) sigue abierto y es acción de Raf.

## Veredicto de la re-revisión

**CHANGES_REQUESTED** — un solo bloqueante: **`design.md` quedó mintiendo sobre el as-built que el
fix-loop acaba de cambiar** (regla 6). Los puntos 2, 3 y 4 los apruebo.

## Verificación corrida (fix-loop)

| Qué | Resultado |
|---|---|
| `pnpm typecheck` | **exit 0** |
| `node scripts/check-hardcode.mjs` | **0 violaciones** |
| Unit suite completa (130 archivos) | **2405/2405** |
| `pnpm e2e:build` (export FRESCO, `CustomFieldSheet` cambió) | OK |
| `sheet-teclado` (3) + `maniobra-customfield-validacion` (1) + `maniobra-config-sheet-race` (3) + `maniobra-reorder-autoscroll` (2) + `maniobra-custom` (2) + `maniobra-custom-gestion` (5) | **16/16** |
| `design/**/*.png` | **INTACTO** |
| Working tree | sin cambios inesperados; **nada commiteado** |

## 1. `CustomFieldSheet` — reorden + geometría del scroll-al-campo → **el código está BIEN; la spec NO**

**El cálculo (`runScrollToField`, `CustomFieldSheet.tsx:171-195`) es correcto.**

- **Con 0 chips es BYTE-IDÉNTICO al anterior.** `criticalH = max(0, rect.height − chipsHRef.current)`
  (`:184`) con `chipsHRef = 0` da `criticalH = rect.height`, `criticalBottom = rect.y + rect.height` y
  `fitsWhole = rect.height + pad <= viewportH` — exactamente las tres expresiones de antes. Es el único
  caso que cubre `maniobra-customfield-validacion` y **quedó verde a 360 y a 412** (lo corrí).
- **Con N chips el signo es el correcto**: `criticalH` más chico → o entra en `fitsWhole` (alinea el TOPE
  de la sección → título + nota + input + mensaje a la vista) o alinea un `criticalBottom` que excluye la
  cola. Con 50 opciones, el cálculo viejo habría alineado la ÚLTIMA fila de chips contra el fondo del
  viewport y **el input se iría de pantalla**. El fix es el correcto.
- **Wrap de varias filas**: no requiere caso especial — `chipsHRef` guarda el alto MEDIDO del `XStack`
  `flexWrap` (`:643-650`), no un cálculo por fila. 1 fila o 4, es el alto real.
- **Sesgo residual (no defecto)**: `rect.height − chipsH` incluye además el `gap $2` entre el mensaje y los
  chips + el `padding $2` y el `borderWidth 2` inferiores del editor cuando está inválido (~18px). Eso
  **sobre-estima** `criticalBottom` → scrollea un poco de MÁS → el mensaje queda un poco más ARRIBA del
  borde inferior. Sesgo en la dirección segura; `scrollTo` clampea solo al máximo real.

**Staleness de `chipsHRef`: no encontré ningún camino sucio.** Enumeré los tres únicos `setOptions(` del
archivo (`:279` add, `:293` remove, `:301` pickType) y las dos transiciones a `options.length === 0` tienen
reset explícito (`:292` y `:303`). Los demás casos se auto-corrigen porque el bloque sigue montado y su
`onLayout` re-dispara cuando cambia el alto: agregar un chip que suma fila de wrap OK, quitar uno que resta
fila OK, enum_single/enum_multi (conserva opciones) OK, cerrar/reabrir el sheet (el componente se desmonta,
el ref nace en 0) OK, error que aparece/desaparece (mueve los chips en `y` pero **no cambia su `height`** →
el valor guardado sigue siendo válido, así que el orden en que disparen los `onLayout` es indiferente) OK.

**La regla dura (scroll-al-campo + borde `$terracota` + error inline) sigue en pie, también con chips.** El
error inline quedó **pegado al input** (`:636`, entre el input y los chips) y el borde terracota sigue en el
`custom-field-options-editor` (`:570-573`). Antes el orden era chips → input → error; ahora input → error →
chips: en los dos el mensaje está inmediatamente debajo del campo. Sin regresión.

**Lo que SÍ hay que decir en voz alta (no es un defecto, es honestidad de cobertura):** la rama
`chipsH > 0` de `runScrollToField` es hoy **inalcanzable desde la UI**, y por eso no tiene assert. En
`handleCreate` el scroll se dispara con `customFieldErrorTarget` (`custom-field.ts:177-190`), que para
`'options'` puede devolver 4 causas — pero `addOption` ya bloquea duplicados, `> OPTION_LABEL_MAX`
(+ `maxLength` en el input) y `>= OPTIONS_MAX` (`CustomFieldSheet.tsx:267-278`), y en modo `edit` las
opciones vienen validadas por el server (0093). Queda **solo `opts.length < 1`**, que por definición implica
`options.length === 0` ⇒ **el bloque de chips ni siquiera está montado**. O sea: `chipsHRef` es código
DEFENSIVO, correcto y barato, para un estado que hoy no se puede producir. No pido sacarlo (blinda el día
que aparezca un error de opciones que conviva con chips) — pido que nadie lo lea como "comportamiento nuevo
testeado". Los otros errores de opciones (`addOption`: "Esa opción ya está.", cap, largo) sí conviven con
chips, pero **nunca scrollean** (comportamiento pre-existente, no lo tocó el fix-loop).

### 1-BIS — BLOQUEANTE: `design.md` quedó viejo respecto del as-built del fix-loop (regla 6)

`tasks.md` (v8) y `docs/design-system.md` sí describen el reorden en los DOS sheets. `design.md` **no**, y
encima es el archivo donde vive el contrato del scroll-al-campo. Tres pasajes quedaron falsos:

1. **`specs/active/03-modo-maniobras/design.md:723`** (As-built v7) dice: *"**Cambios de contenido propios
   del sheet de preconfig**: (a) el **input va ARRIBA de los chips**…"* y recién al final de (b) aclara
   *"Mismo criterio en el input de OPCIONES del `CustomFieldSheet`"* — que ahí refiere **solo al Enter**.
   As-built real: el reorden ya **no es "propio del sheet de preconfig"**, se aplica también al editor de
   opciones del `CustomFieldSheet` (`CustomFieldSheet.tsx:575-682`).
2. **`design.md:1523`** (Reconciliación as-built v7 bajo FIX 3) dice: *"error inline y scroll-al-campo
   determinista **se conservan tal cual**"*. Ya **no**: (a) el error inline se movió de "al final del editor"
   a "entre el input y los chips"; (b) el algoritmo de scroll cambió (descuento de `chipsHRef`).
3. **`design.md:1525`** (FIX-LOOP scroll-360) describe el algoritmo como *"calcula el `y` que mete la
   **sección COMPLETA** (input + borde terracota + mensaje) en el viewport (alinea el TOPE si entra entera,
   el FONDO … si la sección es más alta que el viewport)"*. As-built real: ya no es la sección completa
   sino el **bloque crítico = sección − cola de chips** (`CustomFieldSheet.tsx:184`).

> **Qué hacer** (edición de docs, ~10 min): actualizar esos tres pasajes de `design.md` para que digan el
> as-built real — reorden en los DOS sheets, error inline pegado al input (arriba de los chips), y
> `criticalH = alto de sección − cola de chips` con su razón (con N opciones, alinear el fondo de la sección
> deja el input fuera de pantalla) + la nota de que la rama `chipsH>0` es defensiva/no alcanzable hoy.

## 2. `liftStateOf()` — oráculo de gesto: **APROBADO, es robusto**

- Lee `zIndex`/`scaleX` del DOM subiendo hasta 3 niveles desde `selected-row-N`; el `Animated.View` que
  lleva el `animatedStyle` es el **padre directo** de ese nodo (`ManeuverReorderList.tsx:318-343`) → está
  holgadamente dentro del alcance.
- Lo que lee sólo lo escribe `useAnimatedStyle` cuando `isActive` (`:270-281`), e `isActive =
  activeKey.value === maneuver || frozen`. `activeKey` lo setea **`pan.onStart`** (`:213`), que sólo corre
  cuando el Pan **ACTIVÓ** (tras `activeOffsetY`), y `frozen` viene del hook `?dragFreeze=` que este spec
  **no** usa. Es prueba genuina de activación.
- **Lo que lo vuelve sólido de verdad es el control en reposo** (`spec:164-166`): mide la MISMA cadena de
  nodos ANTES de tocar nada y exige `zIndex < 50` y `scaleX < 1.02`. Con eso, un `zIndex` alto de un
  ancestro por otra causa o un default distinto **rompen el control primero** — el oráculo se falsifica solo.
- Timing OK: el `lift` se lee **con el dedo todavía abajo** (`spec:130-131`), tras 1000ms de hold; el
  `withTiming` de la escala es de 120ms → ya asentado. `Number.parseInt(cs.zIndex)` con `auto` da NaN y se
  descarta (`Number.isFinite`), y `transform: 'none'` se saltea: sin falsos positivos por defaults.
- Los modos de falla del helper (si reanimated escribiera el estilo en otro nodo) dan **falso ROJO**, no
  falso verde. Dirección correcta para un oráculo.
- Nota: el helper prueba que el **gesto** tomó, no que el auto-scroll se haya *pedido*. Ese hueco lo cierra
  el **par de tests**: el test 2 mueve el scroll con el MISMO helper y la misma mecánica, así que "el dedo
  nunca llegó a la `EDGE_ZONE`" no explica el test 1. Además `yTarget = viewport.height − 10` cae por debajo
  del fondo del ScrollView de la jornada (el CTA está pinneado abajo) → `absoluteY > bottom − EDGE_ZONE` es
  verdadero con margen. No re-falsifiqué revirtiendo el código (soy read-only); me apoyo en el par 1+2.

## 3. `optionInputContentY()` — métrica en coordenadas de contenido: **APROBADO, prueba lo que dice**

`top(input) − top(scroller) + scrollTop` (`sheet-teclado.spec.ts:58-64`) es exactamente el offset del input
dentro del contentContainer, y aísla las dos fuentes de ruido que el comentario nombra (el sheet crece hacia
arriba porque ancla abajo, y Playwright scrollea antes de cada click). El `testID="custom-field-scroll"` está
en el nodo scrolleable del `ScrollView` de rn-web (es el que tiene `scrollTop`) y el contentContainer no
aporta padding ni borde → `scrollTop` y `getBoundingClientRect().top` son conmensurables. **Es falsificante**:
con el layout viejo (chips arriba) el delta sería el alto del bloque de chips (~40-50px) contra un umbral de
1px. También es más estricto de lo necesario, porque capta cualquier corrimiento de la sección entera.
Único matiz: el título `Opciones (0)` → `(3)` no cambia de alto (1 línea), así que la línea base no se
contamina — lo verifiqué en el markup (`CustomFieldSheet.tsx:560-562`).

## 4. `docs/design-system.md` — regla del patrón "escribir → agregar → chip": **APROBADO, describe el as-built**

*"el **input va ARRIBA y los ítems agregados crecen DEBAJO** (con el mensaje de error inline pegado al
input)"*. Contrastado contra el código:
- `ManeuverConfigSheet.tsx`: input+"+" (`:165-219`) → chips (`:223-250`) → "Usadas antes" (`:254-283`). OK
  (no tiene UI de error, así que el paréntesis es vacuo ahí, no falso).
- `CustomFieldSheet.tsx`: input+"Agregar" (`:577-632`) → error inline (`:636`) → chips (`:642-682`). OK
  literal, incluido el paréntesis.
La justificación que da (área visible ~150-250px con el teclado arriba; ley de Jakob) es la misma que está
en los comentarios de los dos archivos. Sin contradicción.

## Resumen de la re-revisión

- Puntos **2, 3 y 4: APROBADOS**. Los dos oráculos nuevos son buenos (el de `liftStateOf` es especialmente
  bien construido: trae su propio control de falsificación) y la regla del design-system es fiel.
- Punto **1: el código está bien** (cálculo correcto, 0 chips idéntico al anterior, sin staleness alcanzable,
  regla dura intacta, 16/16 e2e verdes) **pero `design.md` quedó viejo en los 3 pasajes que el fix-loop
  tocó** (`:723`, `:1523`, `:1525`) → **CHANGES_REQUESTED** por regla 6.
- Sigue abierto de la revisión anterior: **`check.mjs` rojo por `SUPABASE_ACCESS_TOKEN` vencido** (Raf).
- `design/**/*.png` intacto. Nada commiteado.
