# impl 03-config-sheet-autosave — auto-guardado del sheet de preconfig de tanda (UX 4)

baseline_commit: 963a825d09012796580b495ef454ac2df5d69a66

> Delta de UX sobre spec 03 (etapa 2 del wizard, R1.7/R1.8), **aprobado por Raf** y bajado por el leader.
> Frontend puro. Backend NO se toca (Gate 1 N/A). Trabajo en paralelo con otro implementer:
> **NO se tocaron** `app/src/components/BottomSheetShell.tsx` ni `app/app/_layout.tsx`.

## El problema (tal como lo bajó el leader)

El sheet tenía **commit diferido**: los chips vivían en el estado local `items` y sólo se persistían al
tocar "Guardar". Dos defectos:

1. **Confirmación redundante.** "Agregar" (o Enter) ya es el gesto de commit y el chip que aparece ya es el
   feedback. "Guardar" pedía confirmar lo ya confirmado — en 🔴 manga cada tap se paga.
2. **Descarte silencioso (el grave).** El sheet tiene CUATRO salidas (Guardar, Cancelar, la X del header,
   el tap en el scrim) y las últimas tres llamaban a `onClose` = **descartaban sin avisar**. Cuatro vacunas
   cargadas se perdían de un roce del guante en el scrim, sin feedback (Nielsen #5).

Auto-guardar es barato acá porque el preconfig **no se escribe en la DB** desde el sheet: sólo actualiza el
estado `preconfig` del wizard; la persistencia real es la etapa 3 (`createSession`/`createPreset`), que ya es
una confirmación explícita aguas abajo.

## Decisiones de Raf ejecutadas tal cual (no re-abiertas)

1. Auto-guardado en los **dos** modos (`multi`/Vacunación y `single`/Inseminación). "Cancelar" eliminado.
2. `multi`: cada `addItem` y cada `removeItem` commitea en el acto. Sacar el último chip commitea `''` =
   borrado del preconfig. → **Se actualizó el comentario de v4** que justificaba "Guardar siempre
   habilitado" (quedaba contradiciendo al código).
3. `single`: commitea en el cambio del input (trim).
4. Texto tipeado sin agregar → se agrega **al cerrar**, por **todas** las vías.
5. Footer: un único primario full-width **"Listo"**. `secondaryFooter` sacado **sólo de este sheet**
   (`CustomFieldSheet`, `SavePresetSheet`, `BreedPickerSheet` lo siguen usando — verificado por grep).
6. × del chip → target `$touchMin` (56px), sin romper el `flexWrap`.

## Cómo quedó implementado

### Lógica pura nueva (`app/src/utils/maneuver-wizard.ts`)
- **`addMultiPreconfigItem(items, raw)`** → lista nueva, o **`null`** si no hay nada que commitear (vacío o
  duplicado case-insensitive). El `null` es lo que hace barato el auto-guardado: un duplicado no dispara un
  commit idéntico al estado actual.
- **`pendingCloseCommit(kind, items, typed)`** → valor a commitear **al cerrar** si quedó texto tipeado sin
  agregar; `null` si no hay nada pendiente. En `single` siempre `null` (ese modo ya commiteó en cada cambio).

### `ManeuverConfigSheet.tsx`
- `onSave` → **`onCommit`** (rename semántico: se dispara N veces y **no cierra**). El contrato es de un solo
  consumidor (`jornada.tsx`, verificado por grep).
- `commitItems(next)` escribe `itemsRef` + estado + commitea. **`itemsRef`** existe a propósito: dos taps en
  el mismo frame (React batchea) leerían el mismo `items` de render y el segundo pisaría al primero.
- `handleClose()` = flush (`pendingCloseCommit`) + `onClose()`. Se pasa **tanto** al CTA "Listo" **como** al
  `onClose` del `BottomSheetShell` → cubre X, scrim y **el arrastre que el otro implementer está agregando
  al shell** (todas las salidas del shell rutean por ese `onClose`).
- Footer: un `Button` "Listo". Sin `secondaryFooter`.
- × del chip: `View` Tamagui de `$touchMin`×`$touchMin` con `onPress` + `pressStyle` (NO `Pressable`
  envolviendo un Tamagui con `pressStyle` — memoria del repo: en nativo new-arch roba el responder), ícono
  `$navIcon`=24, `testID="config-chip-remove-<valor>"`. El chip pierde el `paddingVertical` (queda a 56 =
  alto del input) y gana `maxWidth="100%"` + texto `flexShrink:1` para que el `flexWrap` aguante nombres
  largos con la × 22px más ancha.
- Comentario de cabecera reescrito (el bloque "UX 4" explica el porqué; se corrigió también la mención a la
  condensación del "Cancelar", que este sheet ya no tiene).

### `jornada.tsx` (el punto que el leader marcó)
`onConfigSave` persistía **y** cerraba en el mismo paso. Partido:
- **`onConfigCommit(m, value)`** — sólo persiste. Con **guard de no-op**: si el valor trimmeado no cambia
  devuelve el MISMO objeto de estado. Cubre exactamente dos casos: ediciones que sólo tocan **whitespace**
  y el **re-commit idempotente del flush de cierre**. **NO** evita el re-render por tecla del modo `single`
  (cada tecla da un valor distinto → objeto nuevo → re-render de la etapa 2, incluida `ManeuverReorderList`,
  que no está memoizada). No se memoiza en este delta: costo en device sin medir, la lista está tapada por
  el scrim con el sheet abierto, y un `React.memo` con props de callback no memoizados no haría nada →
  backlog del leader. *(Corregido en el fix-loop del reviewer, F1: la versión previa de este comentario
  afirmaba lo contrario y era falsa.)*
- El cierre sigue siendo `onClose={() => setConfigManeuver(null)}`, una sola vez.
- `key={configManeuver}` en el sheet (estado fresco garantizado por maniobra).
- El `TactoConfigSheet` mantiene su semántica save+close (no es este sheet, no se tocó).

## Trazabilidad `R<n> → archivo:test`

| R | Test |
|---|---|
| **R1.7** (preconfig de tanda una sola vez) — *auto-guardado* | `app/src/utils/maneuver-wizard.test.ts`: `addMultiPreconfigItem: agrega la vacuna tipeada al final, con trim` · `addMultiPreconfigItem: null cuando NO hay nada que commitear (vacío o duplicado)` · `addMultiPreconfigItem: no muta la lista de entrada` |
| **R1.7** — *cerrar no descarta (las 4 salidas)* | `app/src/utils/maneuver-wizard.test.ts`: `pendingCloseCommit (multi): el texto tipeado SIN "Agregar" entra al cerrar` · `pendingCloseCommit (multi): null si no quedó nada pendiente` · `pendingCloseCommit (single): siempre null` |
| **R1.7** — *e2e: agregar → cerrar por SCRIM → persistió* | `app/e2e/maniobra-config-sheet-race.spec.ts`: `UX 4 auto-guardado: las vacunas AGREGADAS sobreviven al cierre por SCRIM…` (bloque A) |
| **R1.7** — *e2e: sacar el último chip limpia el preconfig* | idem, bloque B (`selected-config-0` count 0 + `selected-config-warn-0` visible + "Completá las vacunas") |
| **R1.7** — *e2e: tipear sin "Agregar" → cerrar → entró igual* | `app/e2e/maniobra-config-sheet-race.spec.ts`: `el sheet de preconfig NO se auto-cierra…` CASO 2 (**assert invertido**: antes verificaba el descarte) |
| **R1.7** — *e2e: × del chip ≥44px* | idem, bloque C (`boundingBox` de `config-chip-remove-Aftosa`) |
| **R1.7** — *e2e: footer con un solo CTA* | `app/e2e/maniobra-wizard.spec.ts` (`Guardar`/`Cancelar` `toHaveCount(0)` dentro del sheet) |
| **R1.7** — *e2e: cerrar por la X ya no descarta, y el texto tipeado sin "Agregar" entra por ESA vía* | `app/e2e/sheet-teclado.spec.ts` (se tipea "Mancha" sin agregar → X del header → `selected-config-0` = "Brucelosis, Aftosa, Carbunclo, **Mancha**") |
| **R1.7 (single)** — *e2e: la pajuela persiste sin "Guardar"* | `app/e2e/maniobra-sanitaria.spec.ts` (jornada de inseminación: se tipea y se cierra con "Listo"; el paso de carga usa la pajuela) + capture `10/11` |
| **R1.8** (autocompletar) — sin cambios funcionales | `maneuver-wizard.test.ts` (`filterAutocomplete`, existente) + `maniobra-wizard.spec.ts` ("Usadas antes" + sugerencia → chip) |

## Capture Gate 2.5 (ADR-029) — `app/e2e/captures/config-sheet-autosave.capture.ts`

11 estados nombrados en `__shots__/config-sheet-autosave/`: 01 etapa 2 sin vacunas (aviso) · 02 sheet vacío
con el CTA único · 03 un chip con la × grande · 04 tres chips (flexWrap) · 05 texto tipeado sin agregar ·
06 cerrado por **scrim táctil** con el valor persistido · 07 reabierto (round-trip) · 08 sin chips con el
sheet abierto (la fila de atrás ya reclama) · 09 alto recortado (412×420 ≈ teclado) con chips · 10 sheet
**single** (inseminación) · 11 single cerrado por la X con la pajuela persistida.
El `.capture.ts` se commitea; los `__shots__/*.png` van gitignored (NO se `git add`).

## AUTORREVISIÓN ADVERSARIAL (qué busqué / qué encontré / cómo lo cerré)

- **¿Alguna salida del sheet sigue descartando?** Las cuatro rutean por `handleClose` (el CTA directo; X,
  scrim y arrastre vía el `onClose` que recibe el shell — leído en `BottomSheetShell.tsx`: `onBackdropPress`
  y la X llaman `onClose`, y el arrastre del otro implementer se enchufa al mismo prop). **Cubierto** por
  e2e para scrim y X; el arrastre no existe todavía en `main` (queda cubierto por construcción).
- **Race de dos taps en el mismo frame** (dos sugerencias seguidas, o × de dos chips): el código original
  usaba `setItems(prev => …)` (seguro para el estado) pero yo necesito el `next` para commitear. Lo cerré
  con `itemsRef` (espejo síncrono) en vez de leer `items` del render → determinista bajo batching.
- **¿`onCommit` en cada tecla del single re-renderiza la etapa entera?** **Sí, sigue re-renderizándola.**
  Agregué un guard de no-op en `onConfigCommit`, pero **sólo cubre valores trimmeados IDÉNTICOS**
  (whitespace + el re-commit del flush de cierre): cada tecla produce un valor distinto → objeto nuevo →
  re-render. Mi conclusión original acá era **errónea** y el reviewer la cazó (F1); está corregida en el
  código y en las specs. Se decidió no memoizar `ManeuverReorderList` en este delta (fuera de scope,
  costo sin medir, la lista está tapada por el scrim) → backlog del leader.
- **¿El comentario de v4 quedó mintiendo?** Sí (justificaba "Guardar siempre habilitado para poder borrar").
  **Reescrito**, y reconciliado también en `design.md`/`tasks.md`.
- **¿La × más grande rompe el `flexWrap` o desborda con nombres largos?** El chip suma 22px de ancho. Lo cerré
  con `maxWidth="100%"` en el chip + `flexShrink={1}` en el texto (antes no los tenía: un nombre largo podía
  desbordar la fila).
- **`Pressable` de RN envolviendo Tamagui con `pressStyle`** (bug conocido del repo, nativo new-arch): la ×
  nueva usa `pressStyle` → la implementé como pieza Tamagui con `onPress`, NO como `Pressable` envolvente.
- **¿`getByRole('button')` sigue funcionando sobre una pieza Tamagui?** Verificado con precedente vivo:
  `animal/[id].tsx` usa `XStack` + `buttonA11y` + `onPress` y `events.spec.ts:890` la clickea por rol en una
  suite verde. Igual agregué `testID` a la × para el oráculo de tamaño (no depender del rol para medir).
- **¿Rompí otros sheets?** Grep: `secondaryFooter` sigue usado por `CustomFieldSheet`, `SavePresetSheet`,
  `BreedPickerSheet`. Los `getByRole('Guardar')` restantes en e2e apuntan a `save-preset-sheet` y a
  `tacto-config-sheet` (sheets distintos) — verificado por grep, no los toqué.
- **¿"Listo" colisiona con otro botón en pantalla?** "Listo" existe en `ExitJornadaSheet` y en operaciones de
  grupo, **ninguno** montado en la etapa 2 del wizard. Igual **scopeé todos los locators al sheet**
  (`getByTestId('maneuver-config-sheet').getByRole(...)`) para que no dependa de eso.
- **¿Algún test pasa por la razón equivocada?** El CASO 2 del race spec verificaba **el descarte** ("la fila
  sigue con Faltan vacunas"): con el cambio pasaría a ser un falso negativo silencioso si lo dejaba borrado.
  Lo **invertí** a asertar que el valor entró — es el oráculo del defecto que se cerró.
- **Multi-tenant / offline**: el sheet no toca red, DB ni `establishment_id`; el preconfig sigue viajando en
  el `config` jsonb que arma `buildCurrentConfig()` con el establishment del contexto. Sin superficie nueva
  de seguridad (frontend puro, sin RPC, sin schema).

## RECONCILIACIÓN DE SPECS (as-built, antes del reviewer)

- `requirements.md` **R1.7** → nota de reconciliación "iteración UX 4" (el *qué* no cambia; cambia **cuándo
  queda guardado** + las cuatro salidas + el borrado por quitar el último valor + el CTA único).
- `design.md` **§6.bis.1 → "As-built v8"** (nuevo): causa, las 6 decisiones, la separación commit↔cierre en
  el caller, el target de la ×, qué queda intacto y la cobertura. Marca explícita de que **supersede** el
  argumento de v4 sobre "Guardar siempre habilitado".
- `tasks.md` **M1.4 → "As-built v9"** (la numeración de `tasks.md` corre una adelante de la de `design.md`
  desde el fix del 2026-07-25; cada entrada cita su linaje) + `Archivos:` actualizado.

## ESTADO DE VERIFICACIÓN (ejecutado, no leído)

- `pnpm -C app typecheck` — **verde**.
- `node scripts/check-hardcode.mjs` — **0 violaciones** (ADR-023 §4).
- Unit del cliente (la lista completa de `run-tests.mjs`) — **2432/2432**; `maneuver-wizard.test.ts`
  **43/43** (**6 casos nuevos**: 37 → 43; 3 de `addMultiPreconfigItem` + 3 de `pendingCloseCommit`).
- **`node scripts/check.mjs` — VERDE, RC=0** (typecheck + anti-hardcode + 2432 unit + las suites backend
  incl. RLS/Edge/Animal/Maneuvers/audit/health). El bloqueante `SUPABASE_ACCESS_TOKEN` que figuraba en
  `current.md` **ya no reproduce** en esta corrida.
- **E2E** (build `pnpm e2e:build` fresco, project por defecto):
  - `maniobra-config-sheet-race.spec.ts` — **4/4** (incluye el test nuevo de auto-guardado y el CASO 2
    invertido).
  - `maniobra-wizard.spec.ts` + `sheet-teclado.spec.ts` — **4/4**, y re-corridas junto al race spec
    **8/8** tras restaurar todo.
  - `maniobra-sanitaria.spec.ts` + `maniobra-offline.spec.ts` — **7/7**.
  - Capture Gate 2.5 `config-sheet-autosave.capture.ts` — **2/2**, 11 PNG generados y **mirados** (los
    reviso abajo).
  - *(El `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` que aparece al final de algunas corridas
    es el crash de teardown de Node en Windows DESPUÉS de pasar — no es un fallo de test.)*

### ROJO PRE-EXISTENTE, FALSIFICADO (no es de este delta)

`maniobra-tacto-adaptativo.spec.ts` — **4/4 fallan**. Falla en el paso PREÑADA de la carga rápida con
*"Ninguna maniobra de la jornada aplica a este animal en su rodeo"* (gating: el `rodeo_data_config` /
`serviceMonths` del rodeo sembrado no resuelve). No toca el sheet de preconfig (ese spec usa
`tacto-config-sheet`, otro componente, no tocado).

**Falsificado empíricamente, no razonado**: hice `git stash` de mis TRES archivos de código
(`ManeuverConfigSheet.tsx`, `jornada.tsx`, `maneuver-wizard.ts` — sin tocar los del otro implementer),
rebuild completo y re-corrí `maniobra-tacto-adaptativo.spec.ts:216`: **falla igual**. Restaurado con
`git stash pop` + typecheck verde + rebuild + re-run de mis suites (8/8).

### Interacción con el delta en paralelo (arrastre para cerrar)

El otro implementer agregó drag-to-dismiss al `BottomSheetShell` **mientras yo trabajaba** (verificado:
mi build es posterior a su edición, así que todas mis corridas ejercitaron el árbol combinado). Leí su
diff: el arrastre llama **`onClose()`** → cae en mi `handleClose` → **el flush del texto tipeado también
cubre el arrastre**, sin coordinación extra. Corrí **su** `sheet-arrastre.spec.ts` con mi cambio puesto:
**2/2 verde** (su capture arrastra justamente el `maneuver-config-sheet`). No toqué `BottomSheetShell.tsx`
ni `_layout.tsx`.

### Veto propio de las capturas (previo al del leader)

Miré 04/08/09/10. El chip de 56px con la × grande no rompe el `flexWrap` (4 vacunas envuelven en 2 filas),
el título no se recorta, con alto recortado (412×420) siguen dentro del viewport título + input + "Listo",
y en 08/10 se ve la fila de atrás **ya actualizada con el sheet abierto** (la evidencia visual del commit
inmediato). El veto formal es del leader.

### Higiene del árbol (para el leader, que commitea)

Correr las E2E re-renderizó `design/maniobra-wizard/*.png` y `design/maniobra-sanitaria/*.png` con diffs
espurios. **NO los revertí a propósito**: hacer `git checkout -- design/` con otra terminal corriendo E2E
en el mismo árbol es peor que dejar el ruido. **No van al commit.** Los `__shots__/*.png` del capture están
gitignored; el `.capture.ts` sí se commitea. Tampoco hice `git add` ni commits.

## FIX-LOOP DEL REVIEWER (2026-07-25)

El reviewer verificó la implementación ejecutando y la aprobó en mérito (el commit de `''` sobrevive al
guard, las 4 salidas flushean, round-trip y autocompletar intactos). Bloqueó por **dos afirmaciones falsas
mías** + un assert faltante. Cerrados:

- **F1 — el comentario del guard de no-op mentía.** Afirmaba que evitaba re-renderizar la etapa 2 en cada
  tecla del modo single. Es falso: el guard sólo bailea con el valor trimmeado idéntico. Reescrito en los
  **tres** lugares (`app/app/maniobra/jornada.tsx` ~L296, `design.md` §6.bis.1 As-built v8, `tasks.md`
  As-built v9) para decir exactamente lo que sí cubre (whitespace + re-commit idempotente del flush) y para
  declarar que **no** evita el re-render por tecla. **No memoicé `ManeuverReorderList`** (indicación
  explícita del leader: fuera de scope, va al backlog).
- **F2 — "7 unit nuevos" eran 6** (37 → 43). Corregido en `tasks.md`, `design.md` y este archivo.
- **F3 — faltaba el assert de la X del header con texto tipeado sin agregar.** Agregado en
  `app/e2e/sheet-teclado.spec.ts`: se tipea "Mancha" sin tocar "Agregar" → X → la fila queda
  "Brucelosis, Aftosa, Carbunclo, Mancha". Ahora las tres vías web del flush (CTA, scrim, X) tienen assert
  propio; el arrastre lo cubre por construcción (mismo `onClose`).

**Re-verificación del fix-loop** (ejecutada): `pnpm -C app typecheck` verde · anti-hardcode 0 ·
`maneuver-wizard.test.ts` 43/43 · unit del cliente completo 2432/2432 · rebuild `e2e:build` + e2e
`sheet-teclado.spec.ts` **3/3** (con el assert nuevo de la X) y `maniobra-config-sheet-race.spec.ts`
**4/4**.

*Flake observado y descartado*: en la primera corrida combinada (`sheet-teclado` + `race` en un solo
comando) cayó `sheet-teclado.spec.ts:158` ("la X del header cierra el sheet de maniobra custom y el de
Guardar como rutina") — un test que este fix-loop **no toca** (mi assert nuevo vive en `:85`). Re-corrido
aislado: **pasa**; re-corrido el archivo completo: **3/3**. No dejó `error-context.md` en disco. Es la
contención habitual de dos terminales contra la DEV compartida, no una regresión.

## 2º FIX-LOOP — VETO VISUAL del leader sobre la × del chip (F3)

**Lo que hice mal.** Para subir el área tocable de la × usé `$touchMin`=56, y eso infló **el chip entero**
al alto del botón primario, con el mismo relleno `$primary`. Con 3-4 vacunas quedaban cuatro bloques verdes
pesados apilados justo arriba del "Listo" (también verde): el ojo dejaba de distinguir cuál era la acción —
**jerarquía aplanada** (Nielsen #8). El diagnóstico del leader da en el clavo: **el método de medición
terminó dictando el visual** (el `boundingBox` del e2e pedía ≥44 y yo estiré el pill hasta 56 para que
"sobrara"), cuando Fitts pide **área táctil** ≥44, no un pill visual de 56.

**Cómo quedó.** El pill mide **`$4`=44** (el token existe exacto) y la × ocupa **todo su alto**
(`height="100%"`) con `minWidth="$4"` → se conservan los **44×44** de área tocable, el aserto de
`boundingBox` sigue pasando **sin** distorsionar el diseño, y el chip deja de competir con el CTA. El
**verde se queda** (verde = "elegido" es el lenguaje establecido: la fila de maniobra seleccionada es
verde). Ajustes de acompañamiento: `paddingLeft` `$4`→`$3` y se sacó el `gap` (el ancho del target ya
separa el texto de la ×).

**Verificado en las capturas regeneradas** (las miré): con 3 chips entran en UNA fila y el "Listo" domina;
con **4 chips** (`07-reabierto-round-trip`) son dos filas compactas y el CTA sigue siendo lo más pesado de
la pantalla; con alto recortado (`09`) el CTA sigue alcanzable.

**Nit del mismo fix-loop**: `handleClose` quedó **memoizado** (`useCallback`, con lo tipeado leído de un
`typedRef`) → los `useMemo` de gesto del shell dejan de reconstruirse en cada tecla del modo `single`. No
era bug de correctitud, era churn gratis.

**Re-verificación**: typecheck verde · anti-hardcode 0 · unit del cliente completo verde ·
`maniobra-config-sheet-race` **4/4** (incluye el aserto ≥44px de la ×) · `sheet-teclado` **3/3** ·
`maniobra-wizard` **1/1** · capture regenerado **2/2** (11 estados) · `check.mjs` **RC=0**.

## NO done

No marco `done`. Espera reviewer + Gate 2 + Gate 2.5 (veto visual del leader sobre las capturas).
