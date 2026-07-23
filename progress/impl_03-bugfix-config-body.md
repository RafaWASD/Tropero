# impl 03-bugfix-config-body — el CUERPO del ManeuverConfigSheet queda INVISIBLE en nativo (U5)

baseline_commit: 54eedfee5d84c14f9592814b937e99133b571423

> Bug 🔴 MANGA reportado por Raf en device iOS (con captura), spec 03 MODO MANIOBRAS, wizard etapa 2.
> Frontend puro. Backend NO se toca. Feature 03 activa (delta/bugfix, mismo patrón que `impl_03-bugfix-config-sheet.md`).
> Fix ya diagnosticado por el leader; lo apliqué + verifiqué la NO-regresión en web (el bug es NATIVE-ONLY).

## Feature en curso + plan
- **Feature**: fix de sizing del cuerpo del `ManeuverConfigSheet` (delta de spec 03).
- **T1** — Cambiar el `flex={1}` del `ScrollView` del cuerpo por `flexShrink={1}` (grow:0 shrink:1 basis:auto),
  conservando `minHeight:0` y header/footer en `flexShrink:0`. [x]
- **T2** — Regresión web: confirmar que la E2E del sheet sigue verde + captura web del sheet con el input visible. [x]
- **T3** — Reconciliar specs (design §6.bis.1 v6 + tasks M1.4 v6) al as-built. [x]

## Síntoma (Raf, iOS)
El sheet de preconfig de **Vacunación** aparece con el **cuerpo VACÍO**: solo se ven título "Vacunación",
subtítulo "Cargá una o varias vacunas para toda la tanda" y los botones Guardar/Cancelar — pero **NO el input**
para agregar vacunas → no se pueden cargar vacunas → la marca "Faltan vacunas" no se va. Solo en **NATIVO**;
en **web** anda bien (por eso la E2E web no lo cazó).

## Causa raíz (diagnóstico del leader, confirmado por mi razonamiento de Yoga)
El cuerpo era `<ScrollView flex={1} style={{ minHeight: 0 }}>` (línea ~229) dentro del `YStack` exterior con
`maxHeight="85%"` pero **SIN altura fija** (se dimensiona por contenido). En nativo (Yoga), `flex={1}` =
`flexGrow:1 flexShrink:1 flexBasis:0%`: cuando el contenido total (header + input + footer) es **CORTO** y NO
llega al cap del 85%, el padre queda a la altura del contenido → **no hay "espacio libre"** que el `flexGrow:1`
pueda absorber → el ScrollView resuelve a su `basis:0%` → **altura 0 → cuerpo invisible**.
- Contraste as-built (verificado leyendo ambos): `BulkConfirmSheet` usa `<ScrollView>` **sin flex** (default RN
  `flexShrink:0 basis:auto` → content-sized, capado por el `maxHeight` del padre) y anda. `CustomFieldSheet` usa
  `flex:1` pero su contenido es **SIEMPRE alto** → clampea el padre al `maxHeight` y no colapsa. Vacunación tiene
  contenido **corto** → colapsa. Encaja exacto con el síntoma.

## Fix aplicado (T1)
`app/app/maniobra/_components/ManeuverConfigSheet.tsx`, cuerpo scrolleable:
- **`flex={1}` → `flexShrink={1}`** (grow:0, shrink:1, basis:auto). Conservado `style={{ minHeight: 0 }}`.
- Header (línea ~205) y footer (línea ~343) siguen `flexShrink={0}` (sin tocar).
- Comentario ampliado explicando el colapso en nativo y por qué `flexShrink:1` no colapsa (elegí ESTA opción
  sobre la alternativa BulkConfirmSheet porque es el patrón textbook de "body scrolleable entre header/footer
  fijos con padre content-capped" — más robusta que depender del default RN `flexShrink:0` para el caso alto).

**Por qué NO colapsa en nativo (mi razonamiento):**
- Contenido **CORTO** (vacunación: input + pocos chips): `basis:auto` = altura del contenido; no hay presión de
  shrink (el padre queda por debajo del cap del 85%) → el ScrollView se dimensiona al contenido → **el input SE VE**.
- Contenido **ALTO** (muchos chips + sugerencias + teclado): `basis:auto` = altura grande; la suma de hijos
  supera el `maxHeight:85%` → el padre clampea → como header/footer son `flexShrink:0`, ESTE ScrollView (shrink:1)
  absorbe TODO el faltante → se achica y su contenido (más alto que el frame) **scrollea**, con el footer siempre
  abajo. Es el mismo comportamiento de scroll que `CustomFieldSheet` (que usa flex:1 = también shrink:1); la única
  diferencia es `basis` (0% vs auto), que solo importa en el caso CORTO → `flexShrink:1` arregla el corto sin
  romper el alto. `minHeight:0` permite que el flex item se achique por debajo de su contenido (necesario en web).

## Trazabilidad R<n> → test
El fix toca la superficie del preconfig de tanda (R1.7 preconfig + R1.8 autocompletar). El bug es NATIVE-ONLY
(veredicto DEVICE por Raf, ADR-029); lo que SÍ se verifica en automatizado es la **NO-regresión en web**:
- **R1.7 (preconfig de tanda: abrir el sheet, cargar y guardar el valor)** →
  `app/e2e/maniobra-config-sheet-race.spec.ts:87` (abre el sheet, tipea "Brucelosis" en el input, el sheet queda
  interactivo) + `app/e2e/captures/config-sheet-body.capture.ts` (sheet abierto con el input visible + chip cargado).
- **R1.8 (autocompletar "Usadas antes")** → `config-sheet-body.capture.ts` (sugerencias Brucelosis/Aftosa dentro
  del cuerpo scrolleable — si se ven, el body no colapsó) + `maniobra-wizard.spec.ts` (autocompletar hero, intacto).
- El input, "Agregar"/"+", chips y sugerencias son hijos DIRECTOS del `ScrollView` arreglado (verificado en el
  archivo: el `<ScrollView>` abre en ~229 y cierra en ~340, envolviendo chips + input + sugerencias).

## Deliverable Gate 2.5 (ADR-029) — capture file
UI tocada → entregado `app/e2e/captures/config-sheet-body.capture.ts` (recogido por `playwright.capture.config.ts`,
viewport 412×915). Corrido OK → genera en `e2e/captures/__shots__/config-sheet-body/`:
- `01-sheet-abierto-vacio.png` — sheet abierto: título + subtítulo + **INPUT visible** + "Usadas antes"
  (Brucelosis/Aftosa) + Guardar/Cancelar. Es el estado que estaba ROTO en nativo (cuerpo invisible).
- `02-vacuna-cargada.png` — chip "Brucelosis" agregado (con ×), el input SIGUE visible, "Aftosa" sigue en "Usadas
  antes", Guardar habilitado.
Los `.capture.ts` se commitean; los `__shots__/*.png` van gitignored (no los `git add`). El leader corre este
capture en el Gate 2.5 y vetea contra las capturas. **Revisé las 2 capturas yo mismo**: el cuerpo renderiza
completo en web (input + chips + sugerencias) — sin regresión de layout.

## Autorrevisión adversarial (paso 8)
- **¿El input + "Agregar" + chips + sugerencias quedan DENTRO del ScrollView arreglado?** SÍ — son hijos directos
  del `<ScrollView flexShrink={1}>` (chips ~231-258, input+"+"XStack ~261-307, sugerencias ~310-339); el ScrollView
  cierra en ~340. Nada quedó fuera.
- **¿Header/footer siguen `flexShrink:0`?** SÍ — header YStack ~205 y footer YStack ~343, sin tocar.
- **¿`minHeight:0` conservado?** SÍ — `style={{ minHeight: 0 }}` intacto (necesario en web).
- **¿Web sin regresión?** SÍ — `maniobra-config-sheet-race.spec.ts` 3/3 (abre el sheet, escribe, backdrop
  deliberado cierra) + capturas web muestran el cuerpo completo.
- **¿La lógica del sheet intacta?** SÍ — SOLO cambié la prop de sizing del cuerpo (`flex={1}`→`flexShrink={1}`)
  y su comentario. El guard `readyToDismissRef` (v5), la lógica multi/single, `addItem`/`removeItem`/`handleSave`,
  chips, autocompletar y el guard del backdrop quedan idénticos.
- **¿Tests que pasan por la razón equivocada?** El race spec ejercita el input real (fill + assert value); la
  captura assertea `toBeVisible` del input y de "Usadas antes" (contenido interno del body) → si el body colapsara
  en web fallaría. No hay assert engañoso.
- **¿Elegí la opción más robusta?** Sí. Consideré la alternativa del leader (BulkConfirmSheet: ScrollView sin flex
  + maxHeight explícito). La descarté porque `flexShrink:1` es el patrón estándar de body-scrolleable entre
  header/footer fijos con padre content-capped, y no necesita un `maxHeight` explícito extra (el padre ya lo capa
  vía maxHeight:85% menos header/footer). Documentado en el comentario del código.
- **¿Frontend puro?** SÍ — `git diff supabase/ sync-streams/` vacío.
- **¿Toqué `CustomFieldSheet.tsx`?** NO (restricción del leader — tiene el mismo patrón latente pero no está roto
  hoy; scope aparte / backlog del leader).

## Reconciliación de specs (paso 9, as-built, antes del reviewer)
El *qué* de R1.7/R1.8 NO cambió (el sheet abre, configura, guarda igual) → NO toqué los EARS de `requirements.md`
(misma regla que la reconciliación v5). Reconciliado el *cómo*:
- `specs/active/03-modo-maniobras/design.md` §6.bis.1 → **As-built v6**: causa raíz (colapso Yoga con basis:0% en
  padre content-height), fix (`flexShrink:1`/basis:auto), contraste con BulkConfirmSheet/CustomFieldSheet, y la
  verificación web + captura.
- `specs/active/03-modo-maniobras/tasks.md` M1.4 → **As-built v6** + `Archivos` (ManeuverConfigSheet v6 + capture nuevo).

## Estado
- `node scripts/check.mjs`: typecheck client **OK** + anti-hardcode (ADR-023 §4) **0 violaciones** + unit verdes.
  ROJO en la suite backend RLS (`unrecognized JWT kid <nil> for algorithm ES256` en spec 15, guard 0076) = flake
  de infra de auth (memoria "Check rojo = rate-limit/JWT"), NO regresión — mi cambio es frontend-only y no toca backend.
- e2e web: `maniobra-config-sheet-race` **3/3** · capture `config-sheet-body` **1/1** (2 shots generados).
- `git diff supabase/ sync-streams/`: **vacío** (frontend puro).
- `design/**/*.png`: sin churn (no corrí la suite/`e2e:build` completo; el capture escribe a `__shots__` gitignored).
- **Nota**: `docs/backlog.md` aparece modificado por OTRA terminal (investigación presets/gating) — NO es mío, no lo toqué.

## Archivos tocados
- `app/app/maniobra/_components/ManeuverConfigSheet.tsx` — body `flex={1}` → `flexShrink={1}` + comentario (FIX).
- `app/e2e/captures/config-sheet-body.capture.ts` — NUEVO, captura web del cuerpo del sheet (veto Gate 2.5).
- `specs/active/03-modo-maniobras/design.md` (§6.bis.1 v6) + `tasks.md` (M1.4 v6) — reconciliación as-built.

## NO done
No marco `done`. Espera reviewer + Gate 2 + veto visual del leader (Gate 2.5) + device-test de Raf (native-only).
