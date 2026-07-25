# impl 03-back-hardware-android — el botón físico de atrás dejaba de existir para las guardas

baseline_commit: 963a825d09012796580b495ef454ac2df5d69a66

> Delta sobre spec 03 (MODO MANIOBRAS), misma tanda que el auto-guardado del preconfig. Frontend puro
> (Gate 1 N/A). Trabajo en paralelo con otro implementer: **NO se tocaron** `app/src/components/BottomSheetShell.tsx`
> ni `app/app/_layout.tsx`.

## El problema

El grep del leader era correcto y lo re-verifiqué: **no había ni un `BackHandler`, ni un `beforeRemove`, ni
un `usePreventRemove` en toda la app**. El botón físico de atrás de Android hacía `pop` de la ruta sin pasar
por ninguna guarda:

- **`jornada.tsx`** — atrás desde la etapa 2 o 3 **destruía la configuración entera** de la jornada, cuando
  el chevron ‹ (`onBack`) retrocede una etapa.
- **`identificar.tsx`** — atrás **salteaba el `ExitJornadaSheet`** (cierre guardado, R10.7) con la jornada
  ACTIVA.
- **`carga.tsx`** — atrás abandonaba el animal dejando **huérfanas** las filas de evento que R5.8 ya
  persistió paso por paso (la confirmación de `SkipAnimalSheet` existe justamente para descartarlas).

Es el mismo defecto que Raf reportó en iOS como swipe-hacia-abajo, por otro camino. El
`presentation:'fullScreenModal'` + `gestureEnabled:false` del otro implementer **no lo cubre**: eso sólo
toca el dismiss interactivo de iOS.

## Cómo quedó

### Mecanismo — `app/src/hooks/useHardwareBack.ts` (NUEVO)
`BackHandler` + **`useFocusEffect`** (no `useEffect`: las pantallas del stack quedan montadas al navegar;
sin acotar al foco habría dos listeners vivos a la vez). Dos invariantes documentadas en el archivo:
1. **Siempre consume** (`return true`) → el back nunca popea por atrás de una guarda.
2. **Registro estable** (una vez por foco, `useCallback(..., [])`) + handler vivo en un `ref`. Esto es
   load-bearing para la precedencia (ver abajo): con deps no estables la pantalla se re-registraría última
   y se comería el back del sheet.

Gateado a Android por el predicado puro `shouldRegisterHardwareBack` (iOS no tiene botón atrás; en web
`BackHandler` no emite).

### Decisiones — `app/src/utils/maniobra-back.ts` (NUEVO, puro)
`jornadaBackAction` / `identifyBackAction` / `cargaBackAction`. Cada pantalla cablea el resultado **al
handler que YA existe**, no a un segundo camino:

| Pantalla | Sin nada abierto | Con una guarda abierta |
|---|---|---|
| `jornada.tsx` | `onBack()` — el MISMO del chevron ‹ (retrocede de etapa; sale sólo desde la etapa 1) | sheet con shell → **`defer-to-sheet`** (no lo cierro yo: arrastraría el flush del preconfig); `TactoConfigSheet` → lo cierro |
| `identificar.tsx` | `openExitSheet()` — el MISMO del chevron ‹ (R10.7) | sugerencia → su `onClose`; exit sheet → `closeExitSheet`; `CandidatePicker`/`OtherRodeoSheet` → `backToListening` |
| `carga.tsx` | abre el **`SkipAnimalSheet`** (su salida guardada, R5.15) | skip sheet / lote picker → los cierro |

**`carga.tsx` no tiene chevron ‹ a propósito**, así que su back va a la salida guardada. **No inventé un
"volver al paso anterior"**: esa afordancia no existe en la UI (la corrección se hace desde el resumen) y
duplicarla sería exactamente el segundo camino que el leader pidió evitar.

## Precedencia con el sheet — VERIFICADA, no asumida (pero leída, no ejecutada)

Leí `app/node_modules/react-native/Libraries/Utilities/BackHandler.android.js` de este repo:

```js
const _backPressSubscriptions: Array<BackPressHandler> = [];
RCTDeviceEventEmitter.addListener('hardwareBackPress', function () {
  for (let i = _backPressSubscriptions.length - 1; i >= 0; i--) {
    if (_backPressSubscriptions[i]?.()) { return; }
  }
  BackHandler.exitApp();
});
```

`addEventListener` hace `push`; el dispatcher itera **hacia atrás** y **corta en el primero que devuelve
truthy**. O sea: último registrado = primero en correr, y el `true` corta la cadena entera (incluido el
handler del navigation container, que es el que popearía). Como el sheet monta DESPUÉS que la pantalla,
**gana solo**. Por eso el registro de la pantalla tiene que ser estable — y por eso el hook usa el `ref`.

**Honestidad**: esto es **lectura de la implementación**, no ejecución. La cadena corriendo de verdad es
veredicto de device Android.

**¿Mi guarda de pantalla se traga el evento con un sheet abierto?** No en el caso que importa: si por lo que
fuera el evento llegara a la pantalla con un sheet **con shell** abierto, la decisión es `defer-to-sheet`
(no hago nada y consumo) → **no** se cierra el sheet salteando su flush, pero tampoco se corre la salida de
la pantalla por debajo del modal. El costo declarado de esa elección: en ese escenario hipotético el back
quedaría **inerte** (el sheet se cierra igual con su X, su scrim o su arrastre). Prefiero inerte antes que
perder el texto tipeado del preconfig.

## Trazabilidad `R<n> → archivo:test`

| R | Test |
|---|---|
| **R1.2** (wizard 3 etapas) — el back retrocede de etapa, no destruye la config | `app/src/utils/maniobra-back.test.ts`: `jornadaBackAction: sin nada abierto → el MISMO camino que el chevron ‹` · e2e `maniobra-back-hardware.spec.ts`: el ‹ vuelve de la etapa 3 a la 2 **con "Brucelosis" y las 2 maniobras intactas**, y de la 2 a la 1 |
| **R10.7** (cierre guardado de la jornada) — el back no lo saltea | `maniobra-back.test.ts`: `identifyBackAction: sin nada abierto → abre el ExitJornadaSheet` · e2e: el ‹ de la identificación abre `exit-jornada-sheet` y "Seguir en la jornada" lo cierra sin navegar |
| **R5.15** (saltear con descarte) — el back pasa por la confirmación | `maniobra-back.test.ts`: `cargaBackAction: sin nada abierto → abre el SkipAnimalSheet` |
| **Precedencia / no saltear guardas** | `maniobra-back.test.ts`: `defer-to-sheet` gana sobre todo en jornada · la sugerencia gana sobre el exit · el exit gana sobre los sheets de identidad · el skip gana sobre el lote · **`invariante: ninguna pantalla corre su salida mientras hay una guarda abierta arriba`** |
| **Gate de plataforma** | `maniobra-back.test.ts`: `shouldRegisterHardwareBack: SOLO android registra el listener` |

## AUTORREVISIÓN ADVERSARIAL

- **Un test que no podía fallar — lo cacé y lo saqué.** La primera versión de la E2E asertaba "consola
  limpia" contra el `console.error` que el stub de `BackHandler` de react-native-web loguea en
  `addEventListener` (lo leí en `node_modules/react-native-web/dist/exports/BackHandler/index.js`). Lo
  **falsifiqué**: saqué el gate de plataforma, rebuild, corrí → **seguía pasando**. Metí un probe
  (`console.error('RAFAQ_PROBE_HW_BACK_EFFECT_RAN')` en el mismo lugar) y ese **sí** lo capturó el test →
  el efecto corre en web y el listener de Playwright funciona, pero el `console.error` del stub **no
  aparece** en el export web de este repo (ese módulo no es el que resuelve). Conclusión: el assert era
  verde-pase-lo-que-pase. **Lo saqué** y lo reemplacé por un predicado puro con unit test. **Corregí también
  el comentario del hook**, que afirmaba el bug de LogBox como si lo hubiera observado: ahora dice qué está
  medido y qué no. (Es exactamente el tipo de afirmación falsa por la que el reviewer me frenó el delta
  anterior; no lo repito.)
- **¿El hook rompe web?** No: `shouldRegisterHardwareBack` corta antes de tocar `BackHandler`. Verificado
  por suites: `maniobra-identify` 16/16, `maniobra-sanitaria` 6/6, `maniobra-wizard` 1/1,
  `maniobra-config-sheet-race` 4/4.
- **¿Deja el back inerte en algún estado?** Sólo en el `defer-to-sheet` hipotético (arriba, declarado). En
  todos los demás estados de las 3 pantallas hay una acción definida — lo blinda el test de invariante.
- **¿Registro duplicado / listeners zombis?** `useFocusEffect` con cleanup (`sub.remove()`); RN además
  dedupea por identidad de handler. Cada foco crea un closure nuevo → sin colisión.
- **¿Segundo camino que se desincronice?** No: jornada usa el mismo `onBack` del ‹, identificar el mismo
  `openExitSheet`, y los cierres de sheets son los mismos `setXOpen(false)` / `onClose` que ya existían.
- **¿Toqué archivos del otro implementer?** No. `git diff` confirma que `BottomSheetShell.tsx` y
  `_layout.tsx` sólo tienen SUS cambios. Sí toqué `scripts/run-tests.mjs` (una línea) para registrar el
  test nuevo — sin eso el test no corre y da falsa confianza (el propio archivo lo advierte).
- **Multi-tenant / offline**: sin superficie nueva (navegación pura, sin red, sin DB, sin
  `establishment_id`).

## RECONCILIACIÓN DE SPECS

- `requirements.md` → nota de reconciliación bajo **R10.7** (que cubre R1.2 y R5.15 explícitamente): el
  *qué* no cambia; se declara que el back de hardware espeja al chevron ‹ en cada pantalla y qué pasa con
  una guarda abierta.
- `design.md` §6.bis.1 → **As-built v10**: causa, regla, mecanismo, decisiones puras, la precedencia leída
  en la fuente de RN, y el límite de verificación (incluido el assert descartado y por qué).
- `tasks.md` M1.4 → **As-built v11** + `Archivos:` con los 3 archivos nuevos y los 2 cableados.

## ESTADO DE VERIFICACIÓN (ejecutado)

- `pnpm -C app typecheck` — **verde**. *(Durante el trabajo dio 2 errores transitorios en
  `BottomSheetShell.tsx`, archivo del otro implementer a mitad de edición; al cerrar, verde.)*
- `node scripts/check-hardcode.mjs` — **0 violaciones**.
- Unit del cliente completo — **2448/2448**, con los **15** casos nuevos de `maniobra-back.test.ts`
  (registrado en `scripts/run-tests.mjs`).
- E2E: `maniobra-back-hardware.spec.ts` **2/2** (nueva) · `maniobra-identify.spec.ts` **16/16** ·
  `maniobra-sanitaria.spec.ts` **6/6** · `maniobra-wizard.spec.ts` **1/1** ·
  `maniobra-config-sheet-race.spec.ts` **4/4**.
- *Flakes de infraestructura observados y descartados* (dos terminales sobre el mismo árbol y la misma DEV):
  una corrida combinada dio 6 rojos en `maniobra-identify` cuyo error real era **la pantalla de login sin
  renderizar** (`getByLabel('Email')` not found = contención de auth), y 3 rojos en `maniobra-sanitaria` con
  `net::ERR_CONNECTION_REFUSED at localhost:8099` (el `e2e:build` de la otra terminal reescribió `dist/` y
  se cayó el server). Re-corridas aisladas: 16/16 y 6/6.

## LO QUE QUEDA COMO VEREDICTO DE DEVICE ANDROID (ADR-029) — no lo presento como verificado

`BackHandler` **no emite en web**: Playwright no puede disparar el back físico. Por eso la E2E blinda el
**contrato que el back espeja** (el chevron ‹), no el back en sí. Falta probar en un device Android:
1. Back en la etapa 2/3 del wizard → retrocede de etapa con la config intacta (no vuelve al landing).
2. Back en la identificación con jornada activa → abre el `ExitJornadaSheet`.
3. Back en la carga rápida con maniobras ya cargadas → abre el `SkipAnimalSheet` (y confirmar descarta).
4. **Back con un sheet abierto → cierra el SHEET, no la pantalla** (la precedencia que leí en la fuente de
   RN pero no ejecuté). Caso más jugoso: el sheet de preconfig con texto tipeado sin "Agregar" → el back
   tiene que cerrarlo **y** guardar ese texto (el flush del delta anterior).

## 2º FIX-LOOP (reviewer de integración) — F1 y F2

### F1 — el invariante de precedencia estaba indefenso y fallaba en silencio

**El reviewer tiene razón y mi justificación estaba incompleta.** Yo escribí que la precedencia se sostiene
con "registro ESTABLE (`useCallback([])`)". Eso cubre **re-renders**, no **re-focos**: `useFocusEffect` de
expo-router re-ejecuta su callback en **cada** evento de `focus`
(`node_modules/expo-router/build/useFocusEffect.js`), así que un re-foco **re-suscribe** a la pantalla y la
manda al final del array → le roba la precedencia al sheet. Hoy es inalcanzable (el wizard es la única
pantalla con el hook que hospeda sheets del shell y ninguno navega), pero **un solo `router.push` adentro
de cualquiera de esos tres sheets** lo vuelve alcanzable, y el síntoma sería un **back muerto** invisible
para web, E2E y unit.

**(a) Justificación corregida en los tres lugares** — `useHardwareBack.ts`, `maniobra-back.ts` y
`design.md` As-built v10 — para que digan la condición REAL: registro estable **y** sin re-foco con un
sheet montado, con el escenario que lo rompe y por qué hoy no se alcanza.

**(b) `defer` dejó de ser silencioso.** Partí la acción según lo que la pantalla PUEDE hacer:
- **`'defer-to-preconfig-sheet'`** — sólo el `ManeuverConfigSheet`, el único que la pantalla no puede
  cerrar sin saltear el flush del texto tipeado. Acá el caller emite un **`console.warn` en dev** con el
  diagnóstico ("¿la pantalla se re-enfocó con el sheet abierto?").
- **`'close-shell-sheet'`** — `SavePresetSheet` / `CustomFieldSheet`: su cierre es un reset de estado sin
  nada que perder, así que la pantalla los cierra como **último recurso**. En el camino feliz esa rama no
  se ejecuta; existe para que un desliz de precedencia degrade en un **cierre correcto** en vez de un botón
  inerte.

Test de invariante nuevo: `defer` está **acotado** al preconfig y ningún otro estado lo devuelve.

### F2 — dos fuentes de verdad para "hay un sheet del shell montado"

También correcto: yo calculaba `configManeuver !== null || savePresetOpen || customSheetOpen`, pero el
render está gateado por `configManeuver && FREE_TEXT_PRECONFIG[configManeuver]` y por
`isOwner && customSheetOpen`. Cualquier divergencia = deferir a un sheet que no está montado = back muerto.
**Derivado**: `preconfigSheetMounted` y `customSheetMounted` se calculan **una vez** y alimentan **tanto**
la decisión del back **como** la guarda de render (el JSX ahora consume esos mismos booleanos, y el sheet
de preconfig lee sus props del `preconfigSheet` ya resuelto en vez de re-indexar `FREE_TEXT_PRECONFIG`).

### Nit
`app/src/hooks/index.ts` agregado a la línea `Archivos:` de `tasks.md`.

### 3er fix-loop — conteo stale en la cabecera del spec e2e
`app/e2e/maniobra-back-hardware.spec.ts:11` citaba **15 casos** de `maniobra-back.test.ts`; son **18**
(medido: `tests 18 / pass 18`) desde que el 2º fix-loop agregó los casos de `close-shell-sheet` y el
invariante de `defer` acotado. `design.md` y `tasks.md` ya decían 18 — la cita del spec era la única que
había quedado atrás. Corregida (una línea). Re-verificado: `maniobra-back.test.ts` 18/18 y
`maniobra-back-hardware.spec.ts` 2/2. Grep de control: no queda ningún "15 casos" en el código, las specs
ni este archivo.

### Re-verificación del 2º fix-loop (ejecutada)
`pnpm -C app typecheck` verde · anti-hardcode 0 · `maniobra-back.test.ts` **18/18** (15 → 18) · unit del
cliente completo verde · **`check.mjs` RC=0** · e2e `maniobra-back-hardware` **2/2**, `maniobra-identify`
**16/16**, `maniobra-sanitaria` **6/6**, `maniobra-offline` **1/1**, `sheet-teclado` **3/3**,
`maniobra-config-sheet-race` **4/4**, `maniobra-wizard` **1/1**.

*Flakes de infra descartados (dos terminales sobre el mismo `dist/`)*: tres rojos distintos cuyo error real
fue `net::ERR_CONNECTION_REFUSED at localhost:8099` y uno con el server devolviendo **"Index of dist/"**
(el `e2e:build` de la otra terminal borrando el árbol a mitad de corrida), más un `(l)` de identify que
pasa aislado y en la re-corrida completa. Todos re-corridos en verde.

**Lo que NO cambió**: la decisión de `carga` → `SkipAnimalSheet`, la lectura de precedencia en la fuente de
RN, y el veredicto de device Android de la sección anterior siguen igual.

## NO done

No marco `done`. Espera reviewer + Gate 2.
