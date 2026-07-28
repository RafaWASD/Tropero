baseline_commit_declarado: 7bdc87ec9ffc1cca817e75c08580073be6d5b264
HEAD_al_revisar: abd167c (docs/backlog.md se commiteó desde OTRA terminal a mitad de la review — ver §8)

# REVIEW — bugfix 🔴 «el sheet monta con el teclado abierto» (ABRIR UN SHEET BAJA EL TECLADO)

## VEREDICTO: **CHANGES_REQUESTED**

**No encontré ningún defecto de CONDUCTA.** El fix es correcto, la excepción `claimsKeyboard` está bien
puesta, el guard falsifica de verdad y la E2E es una regresión real (la falsifiqué yo, ejecutando). Los 3
cambios que pido son **afirmaciones falsas o desactualizadas en artefactos nuevos** — exactamente la clase
de defecto que esta unidad existió para corregir (el header del shell que despachaba un límite con dos
afirmaciones falsas). Son 3 ediciones de 1-2 líneas, ninguna toca runtime.

---

## 1. Lo que verifiqué EJECUTANDO (no leyendo)

| # | qué corrí | resultado |
|---|---|---|
| V1 | `node scripts/check.mjs` (árbol completo) | **RC=0**, "Entorno listo". Todas las suites verdes. |
| V2 | `grep -n "e2e\|playwright" scripts/check.mjs scripts/run-tests.mjs` | **0 matches** → confirmado: el semáforo verde NO cubre E2E. |
| V3 | los 4 guards estáticos + `sheet-shell.test.ts` juntos | **47/47** verdes. |
| V4 | **Falsificación (a)**: `ExitJornadaSheet` sin la llamada al hook | 🔴 **2 fail** (la regla + el ancla del motor). Coincide con lo declarado. |
| V5 | **Falsificación (b)**: `SavePresetSheet` sin `claimsKeyboard` | 🔴 **1 fail** (sub-regla del autoFocus). Coincide. |
| V6 | **Falsificación (b2, mía)**: `ManeuverConfigSheet` **marcado** `claimsKeyboard` **sin** autoFocus | 🟢 **9/9 PASS** → el guard **NO ve** la dirección de falso positivo. Ver cambio C2. |
| V7 | **Falsificación (c)**: archivo nuevo con `$scrim` y sin hook | 🔴 **1 fail** (la regla). Coincide. |
| V8 | **Falsificación (d)**: `LotePickerSheet` con el hook pelado | 🔴 **1 fail** (sub-regla del argumento). Coincide. |
| V9 | `e2e/sheet-baja-teclado.spec.ts` con el fix puesto | **4 passed** (24,2 s). |
| V10 | **E2E falsificada**: saqué el hook de `FindOrCreateOverlay`, **rebuild**, re-corrida | 🔴 **1 failed / 3 passed** — cae el test (1) en `spec.ts:119` (poll del foco, timeout 5 s). **El test de regresión es real, no un falso verde.** |
| V11 | No-regresión de lo que Raf ya dio por bueno: `sheet-teclado` + `sheet-arrastre` + `maniobra-config-sheet-race` + `maniobra-custom-gestion` + `maniobra-rutinas-gestion` + `maniobra-back-hardware` + `sigsa-breed-renspa` | **25 passed** (2,5 min). Cubre **los 4** consumidores del `BottomSheetShell`, el arrastre, el race y el back. |
| V12 | Clase pre-existente "el paso de tacto no renderiza": `maniobra-tacto-adaptativo` con el fix | 🔴 **4 failed** (el botón PREÑADA no aparece, timeout 30 s). |
| V13 | La MISMA spec sobre **BASELINE** (`git stash push -u` de app/docs/specs/progress + rebuild) | 🔴 **los mismos 4, idénticos** → **pre-existente, NO de esta unidad**. Restaurado: `git diff` **md5-idéntico** antes/después (`8e012132…`) y `git status` idéntico. |
| V14 | `git status --porcelain design/` tras 5 builds + 4 tandas de E2E | **0 líneas** → `design/**/*.png` intacto. Borré `app/test-results/`. |

Todas las mutaciones fueron **de a una**, con backup del archivo (`cp`) y restore verificado por `md5sum` —
nunca `git checkout` (el incidente que el implementer declara en su §7).

## 2. PRIORIDAD 1 — auditoría de `claimsKeyboard`, los 22 uno por uno

**Falsos negativos (auto-enfoca y no está marcado): CERO.** Verificado por barrido del árbol, no a ojo:

- `autoFocus` aparece **una sola vez** en todo `app/app` + `app/src`: `SavePresetSheet.tsx:157` — y ese
  archivo declara `claimsKeyboard` en la línea 117. Es el único, y está marcado.
- `.focus()` programático aparece **una sola vez**: `CircunferenciaEscrotalStep.tsx:321`, dentro de un
  `onPress` (post-montaje) → no compite con el descarte del montaje. **La afirmación del implementer (el
  guard no ve un `ref.focus()`, pero hoy no existe ninguno) es correcta**: la verifiqué en `.tsx` y en `.ts`
  (0 en `.ts` fuera de un comentario del propio hook), incluyendo `focusTextInput` y `TextInputState`.

**Falsos positivos (marcado sin auto-enfocar): CERO en el árbol** — `claimsKeyboard` solo aparece en
`SavePresetSheet` (+ su definición en el shell + el guard). Pero **el guard no lo puede cazar** (V6).

**Argumento del hook, call-site por call-site (leído, los 21 + el shell):**

| grupo | archivos | verificación |
|---|---|---|
| Pasan su prop de visibilidad | `LotePickerSheet(open)`, `SugerenciaVaciasSheet(open)`, `LinkCalfPrompt(open)`, `MarkDeclaredSheet(open)`, `FindOrCreateOverlay(state !== null)` | los 4 primeros tienen `if (!open) return null` **después** del hook (líneas 90/110/429/94 contra 53/68/120/56) → sin la prop no dispararían nunca. Correcto. |
| Default (`open = true`) | los 16 restantes | **leí los 19 call sites**: todos renderizados condicionalmente. Ninguno vive montado detrás de un toggle. Correcto. |
| Los 4 del shell | `ManeuverConfigSheet`, `CustomFieldSheet`, `SavePresetSheet`, `BreedPickerSheet` | 3 son condicionales en el call site. **`BreedPickerSheet` NO lo es** (`crear-animal.tsx:892` lo monta siempre) — pero hace `if (!open) return null` en `BreedPickerSheet.tsx:83` **antes** de montar el shell, así que el flanco del shell sigue siendo el de la apertura. Correcto, aunque frágil: si alguien le saca ese early return, el shell queda montado siempre y el descarte no dispara nunca (el guard no lo ve: `BreedPickerSheet` no está en la semilla `$scrim`). |
| Rules-of-hooks | los 22 | el hook precede a todo `return null` en los 5 que lo tienen. OK. |
| Sub-componentes anidados | `CutPromptSheet` (DientesStep:125), `AgeAdjustSheet` (CircunferenciaEscrotalStep:393) | definidos a **nivel de módulo**, no inline dentro del render del padre → no re-montan por cada render del padre (si lo estuvieran, el descarte dispararía en cada tecla). OK. |

**Efecto colateral del blur en el paso de CE**: `CmInputField.commit` (línea 294) solo hace `onCommit(parsed)`
→ `commitCm` (línea 97) → `setCm`. **No navega, no avanza de paso, no cierra nada.** El efecto es el que
declara el implementer: guarda lo tipeado en vez de dejarlo en draft. Correcto.

## 3. PRIORIDAD 2 — nada de lo que Raf ya verificó en device se movió

- `ManeuverConfigSheet` (el sheet de Vacunación del APK `a3b8d804`): **V11** lo ejercita en 2 specs
  (`sheet-teclado:85` — Enter agrega sin perder el teclado — y `maniobra-config-sheet-race`) + **V9 test (2)**
  tipea letra por letra verificando `document.activeElement` en cada paso. Verde.
- `CustomFieldSheet` / `SavePresetSheet` / `BreedPickerSheet`: **V11** (`maniobra-custom-gestion` x5,
  `maniobra-rutinas-gestion` x4, `sheet-teclado:158` y `:229`, `sigsa-breed-renspa` x4). Verde.
- El descarte al montar es **no-op** en esos 4: el teclado no estaba abierto, y `Keyboard.dismiss()` sobre
  nada enfocado no hace nada. La única excepción (donde SÍ había algo enfocado: el `autoFocus`) es la que el
  implementer cazó y cerró con `claimsKeyboard`.
- **Worklets: cero.** `useDismissKeyboardOnOpen.ts` no contiene `worklet` ni `runOnJS` ni `scheduleOnRN` (el
  guard nuevo lo assertea en sus líneas 304-305), el descarte va en un `useEffect` del hilo de JS, y
  `worklet-callbacks-guard.test.ts` sigue verde (V1/V3). El patrón que crasheó en device no se reintrodujo.
- **Aire / navbar**: ningún archivo tocó `useSafeBottomInset` / `useKeyboardAwareBottomInset` / layout. El
  diff de los 21 sheets es **una línea de código + comentario** cada uno (5-9 líneas por archivo, todas `+`).

## 4. PRIORIDAD 3

**3.1 — La enumeración de los 22 y el punto de inserción.** La semilla `$scrim` (post-blanqueo de
comentarios) da exactamente los 22 declarados; lo reproduje. La elección del punto de inserción es
**correcta**: `BottomSheetShell` cubriría 4 y deja afuera el sheet del reporte; `KeyboardAvoidingShell`
alcanzaría a 15 PANTALLAS que no son overlays (verifiqué la lista de consumidores: `(tabs)/animales`, `mas`,
`animal/[id]`, `animal/baja`, `asignar-caravanas`, `crear-rodeo`, `export-sigsa`, `lote/venta`, `lotes`,
`maniobra/carga`, `maniobra/identificar`, `mis-campos`, `seleccion-masiva`, `vacunacion-masiva`, +
`AuthScreenShell` y `GroupViewScreen`), donde "bajar el teclado al montar" es otra conducta. Coincido con el
hook + guard. **PERO la semilla NO es completa** → cambio **C1**.

**3.2 — El guard.** Falsificado por mí con 4 mutaciones (V4-V8), una por vez, sobre el árbol real,
revertidas y verificadas por md5. Detecta lo que dice detectar. Gap encontrado → cambio **C2**.

**3.3 — El E2E.** Falsificado por mí (V10): con el hook revertido en `FindOrCreateOverlay`, el test (1)
**cae**. El oráculo del bastonazo es el correcto y la justificación (click/Enter desenfocan solos) se
sostiene. El test (4) está honestamente declarado como "no prueba el descarte".

**3.4 — La capa 2 rechazada: COINCIDO.** El fundamento se sostiene: (a) `Keyboard.metrics()` deriva del
mismo evento de RN cuyo `height` es `imeInsets.bottom - barInsets.bottom` bajo edge-to-edge, así que sembrar
con eso exige reintroducir a mano el término que el diseño actual eligió NO tocar; (b) ese término no es
verificable desde web ni desde el unit, y un lift equivocado se lee como layout roto (peor que no levantar);
(c) escribir el shared value es off-contract sobre una API ya `@deprecated`. **El residuo declarado —una
pantalla pusheada mientras se tipea— es aceptable**: no hay reporte, se auto-corrige al primer evento del
IME, la pantalla destino no tiene foco propio, y la alternativa barata (descartar también en el cambio de
ruta, sin aritmética) quedó escrita en `docs/backlog.md`. No pediría la capa 2 hoy.

**3.5 — Las afirmaciones corregidas en `KeyboardAvoidingShell.android.tsx`: quedaron bien.** El bloque
(líneas 90-122) ahora nombra el límite sin despacharlo, marca las dos afirmaciones anteriores como
falsificadas con su evidencia (APK `a3b8d804`), dice explícitamente que "la paridad describe el alcance del
defecto, no lo justifica", y agrega cómo quedó cerrado + por qué no se sembró la altura. Es fiel al código.

**iOS**: el cambio es un `Keyboard.dismiss()` por montaje de overlay, sin gate de plataforma, sin tocar
layout ni geometría. **No encontré nada que mueva iOS más allá de "los sheets ahora bajan el teclado"**, que
es roto→arreglado. No hay bloqueo por la cuota de EAS.

## 5. CAMBIOS REQUERIDOS (3, ninguno de runtime)

**C1 — `app/src/components/sheet-keyboard-dismiss-guard.test.ts:42-43`: la afirmación es FALSA.**
Dice: *"(b) Un overlay modal que NO use `$scrim` (un `Modal` de RN, un sheet de una librería). **Hoy no
existe ninguno en el repo**"*. Existe: **`app/src/components/EstablishmentSwitcherDropdown.tsx:259-270`** —
overlay modal a pantalla completa (`<View style={StyleSheet.absoluteFill} zIndex={1000}>` + `Pressable`
backdrop `absoluteFill` que cierra + card anclada), que pinta el backdrop con
`backgroundColor="$textPrimary" opacity={0.18}` en vez de `$scrim` y **se escapa de la semilla**.
*Riesgo práctico hoy: bajo* — está anclado ARRIBA (`top={anchorTop}`), el teclado tapa abajo, y su único
call site es `app/(tabs)/index.tsx:768` (home, que verifiqué que **no tiene ningún input**). O sea: no hay
bug vivo. Pero la frase que despacha el límite es falsa, y es el mismo modo de falla que esta unidad vino a
corregir en el header del shell.
**Pedido**: o (i) llamar al hook también ahí (coherente con la regla: abrir el dropdown es salir del contexto
de escritura) y ampliar la semilla, o (ii) reescribir el límite (b) nombrando el caso real y por qué queda
afuera. Cualquiera de las dos.

**C2 — El guard no ve la dirección de FALSO POSITIVO de `claimsKeyboard`, y no está declarado.**
Verificado ejecutando (V6): marqué `ManeuverConfigSheet` con `claimsKeyboard` **sin** tener `autoFocus` y el
guard pasó **9/9**. Un sheet mal marcado = el bug del reporte sigue vivo ahí, en silencio, y en web no se ve.
Hoy no hay ninguna instancia, pero el guard cubre una sola dirección de la excepción.
**Pedido**: la regla inversa es una línea sobre el mismo `sheetUniverse`
(`CLAIMS.test(src) && !AUTO_FOCUS.test(src)` → violación); o, si se prefiere no cerrarla, declararla en el
bloque "LO QUE ESTE GUARD **NO** PUEDE VER" junto a la del `ref.focus()`. Hoy no está en ninguno de los dos
lados. *(Relacionado, NO bloqueante: `hasEscapeHatch()` (líneas 135-138) busca la válvula en **cualquier**
línea del archivo, así que `-disable-next-line` funciona como disable-FILE. Es el mismo patrón de los guards
hermanos → no lo pido, pero el nombre miente.)*

**C3 — `specs/active/03-modo-maniobras/tasks.md` (As-built v15) dice "3 tests" y son 4.**
El texto: *"E2E: `app/e2e/sheet-baja-teclado.spec.ts` (**3 tests**, falsificado en las dos direcciones)"*.
El archivo tiene 4 (`spec.ts:92`, `:125`, `:168`, `:212`) y el propio informe del implementer declara 4. Es
un conteo de una iteración anterior que quedó viejo: spec que contradice el as-built = reconciliación
pendiente. (`design.md` v12 y la nota de `requirements.md` bajo R10.7 están bien: no dan conteo y describen
la conducta real.)

## 6. Trazabilidad (bugfix sobre feature 03, que está `done`)

No hay `R<n>` nuevos: el EARS no cambia (así lo dice, bien, la nota de reconciliación bajo R10.7). La
trazabilidad es conducta ↔ test:

| conducta | test que la verifica |
|---|---|
| R10.7 (guarda de cierre) deja de ser inoperable con el teclado arriba | `e2e/sheet-baja-teclado.spec.ts:212` (flujo del reporte, sheet con sus 2 acciones + el dato tipeado intacto) + `:92` (el mecanismo del descarte, falsificado en V10) |
| El descarte dispara SOLO en el flanco cerrado→abierto | `app/src/utils/sheet-shell.test.ts` (6 casos: montaje, apertura, ya-abierto, cierre, cerrado, reapertura) |
| Un sheet con input propio no pierde su teclado | `e2e/sheet-baja-teclado.spec.ts:125` + `sheet-teclado.spec.ts:85` (V11) |
| La excepción `claimsKeyboard` (autoFocus sobrevive) | `e2e/sheet-baja-teclado.spec.ts:168` |
| Todo overlay con scrim tiene la conducta (invariante de clase) | `sheet-keyboard-dismiss-guard.test.ts` (9 tests; falsificado por mí en V4/V5/V7/V8) |
| El hook no es decorativo (Keyboard.dismiss + predicado + dep `[open]`) | mismo guard, test "el hook HACE lo que dice" |

**Tasks completas**: sí. Las 5 del plan del implementer (T1-T5) están en `[x]` y las verifiqué contra el
árbol (decisión pura + hook + 22 adopciones + guard registrado en `run-tests.mjs` + E2E/capturas/specs).
No quedó ninguna `[ ]`.

## 7. CHECKPOINTS

- **C1** — [x] harness completo; [x] `check.mjs` RC=0 (V1).
- **C2** — [x] una sola feature fuera de `done` (`17-observabilidad` en `context_ready`, ajena a esta unidad);
  [x] la 03 sigue `done` y con tests verdes; [ ] `current.md` **inflado** (485 líneas, `[WARN]` de check.mjs)
  — pre-existente, es del leader, no de esta unidad.
- **C3** — [x] capas respetadas (hook en `src/hooks/`, decisión pura en `src/utils/`, adopción en componentes);
  [x] 0 deps nuevas; [x] sin logs sueltos ni TODOs; [x] sin `establishment_id` hardcodeado.
- **C4** — [x] la decisión pura tiene 6 tests; [x] guard estático nuevo **registrado** en `run-tests.mjs`;
  [x] el runner muestra >0 tests y todos verdes; [—] RLS N/A.
- **C5** — [x] sin artefactos temporales (borré `app/test-results/`; `design/` intacto, V14); [ ] entrada en
  `history.md`: la cierra el leader; [x] la feature 03 queda en su estado.
- **C6** — [x] specs presentes y reconciliadas… **salvo C3** (conteo de tests viejo en `tasks.md`).
- **C7 / C8** — **N/A** (esta unidad no toca tablas, RLS, PowerSync ni sync buckets: es cliente puro).
- **C9** — [x] suite E2E propia verde y **falsificada por el reviewer** (V9/V10); [x] capture file
  `app/e2e/captures/sheet-baja-teclado.capture.ts` (7 estados, con su límite de cobertura declarado en el
  header); [ ] **Gate 2.5 con veto visual del leader: PENDIENTE** (lo corre el leader); [x] los
  `__shots__/*.png` no están en el árbol.

## 8. Checklist RAFAQ-específico

- **A (multi-tenancy / RLS)** — **N/A**: cero SQL, cero tablas, cero policies.
- **B (offline-first)** — **N/A**: no toca lectura/escritura de datos ni sync buckets; el fix corre 100% en
  cliente, así que no degrada nada offline.
- **C (BLE)** — **parcialmente aplicable, y sale bien**: [x] `FindOrCreateOverlay` lo abre un **bastonazo** y
  el descarte no bloquea ni demora el flujo del operario (efecto de montaje en el hilo de JS, no un worklet);
  [x] el modo MANUAL del `TagScanSheet` no se ve afectado (el hook dispara solo en el flanco de apertura; ese
  modo se activa después, con un tap — leído en `TagScanSheet.tsx:103-110`); [—] desconexión/correlación
  TAG-peso: no las toca esta unidad.
- **D (UI de campo)** — [x] no cambia tamaños de botón ni de fuente (diff = 1 línea por archivo, sin layout);
  [x] una decisión por pantalla intacta; [x] sin estados de loading nuevos; [x] **mejora directa del 🔴 manga**:
  los CTAs del `ExitJornadaSheet` dejan de estar tapados.
- **E (Edge Functions)** — **N/A**.

## 9. Nota de coordinación (no es un defecto de la unidad)

A mitad de la review apareció el commit **`abd167c` `docs(backlog): …`** desde otra terminal, que **se llevó
`docs/backlog.md` del working tree** (el baseline pasó de `7bdc87e` a `abd167c`). El contenido de las **dos
entradas de esta unidad** (límite del montaje + los 21 sheets con dos invariantes copiados) está intacto,
ahora en HEAD. El resto del árbol sigue sin commitear, como pidió el leader. Lo dejo escrito porque el
informe del implementer declara `docs/backlog.md` como modificado y ya no lo está.

## 10. Resumen para el leader

Nada que reimplementar. **3 ediciones de texto/guard** (C1, C2, C3) y esto vuelve APPROVED sin re-verificar
nada de lo que ya corrí — ninguna toca runtime. El veredicto de DEVICE (los 5 puntos que el implementer
lista en su §9.1) sigue siendo de Raf y no lo puedo dar yo; nada de lo que ejecuté lo contradice.
