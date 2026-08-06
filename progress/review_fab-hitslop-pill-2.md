reviewed_commit_base: c252b72 (diff SIN commitear)
review_previo: progress/review_fab-hitslop-pill.md (CHANGES_REQUESTED)
informe_revisado: progress/impl_fab-hitslop-pill.md
alcance: RE-REVIEW ACOTADA del delta. No re-audite la unidad entera.

# Re-review — unidad «el FAB de Maniobra le roba los taps a la banda de arriba del nav» (2a pasada)

## Veredicto: **CHANGES_REQUESTED**

**Los dos 🔴 anteriores están cerrados de verdad.** El pill volvió a ser informativo (verificado con
mutante, no leído) y el guard v3 resiste 24 de las 36 grafías con las que lo ataqué, incluidas las 9 que
el implementer no probó. El fail-closed del resolvedor **es real**: se lo probé con ternario, llamada,
`Object.assign`, helper importado, identificador que viene por props, clave computada quoteada, hex y
aritmética irresoluble — **tira en todas**, y el throw llega hasta una aserción roja (no devuelve un
objeto incompleto).

Lo que lo frena son **dos cosas, y ninguna es re-hacer nada**:

1. **Un agujero nuevo, de la misma familia que el anterior**: `(B1)` dejó de mirar el token pero sigue
   mirando la **grafía** — exige un `+` literal y solo lee la prop `bottom`. Seis mutantes de overlay
   interactivo anclado **al pico del FAB** pasan 47/47, y a diferencia de los otros survivors **este no
   lo cubre nada** (ni el E2E ni el modelo aritmético).
2. **Las specs quedaron viejas otra vez** (paso 6 del protocolo): `design.md` y `tasks.md` describen el
   guard **v2** — 16+17 casos cuando son **26+21**, y **omiten `(B-banda)`**, que es la pieza central de
   esta ronda. Más dos afirmaciones que contradicen el as-built (`docs/backlog.md:340` y un comentario en
   `mas.tsx:289` dicen que el pill es tocable / es un botón).

---

# 1. Lo que verifiqué EN VERDE (ejecutado por mí, no leído)

- **`nav-target-bands.test.ts` + `tap-target-collision-guard.test.ts` = 47/47, 0 fail.** Comando extraído
  del bloque de `scripts/run-tests.mjs`; **los dos están en la lista explícita** (verificado en el diff).
- **`npx tsc --noEmit` → RC=0.** Confirmo al leader.
- **El reparto real de casos**: `nav-target-bands.test.ts` **26**, `tap-target-collision-guard.test.ts`
  **21**, `e2e/fab-target-geometry.spec.ts` **2**, `connection-view.test.ts` **42**.
- **El pill NO es tocable, y `(E)` lo hace cumplir** — probado con mutantes, no leído:
  - `onPress` + `pointerEvents="auto"` → **(E) ROJO**.
  - sacarle el `pointerEvents="none"` → **(E) ROJO**.
  - escribirlo `pointerEvents={'none'}` → **(E) ROJO** (fail-closed, va del lado seguro).
  - En el fuente: sin `onPress`, sin `pressStyle`, sin `buttonA11y`, sin `role`/`accessibilityRole`;
    contenedor `box-none` (`StickStatusIndicator.tsx:186`), pill `pointerEvents="none"` (:204),
    `labelA11y` (:205). `connectionIndicatorA11yLabel` / `STICK_INDICATOR_ACTION` **no existen en el
    árbol** (grep vacío): la reversión no dejó exports muertos.
- **El fail-closed del resolvedor es REAL** (era el punto crítico del pliego). Diez gramáticas distintas
  que no puede leer → **`TargetResolutionError` que llega hasta un test rojo**, nunca un objeto
  incompleto. Y la promesa se cumple también del lado de `(B-banda)`: una superficie **registrada** con
  aritmética ilegible (`bottom={safeBottom + navOffset()}`) **tira** en vez de saltearse en silencio.
- **`(B-banda)` no es decorativo**: acercar el pill 12 dp al FAB con la MISMA grafía (`$4 - 12`) lo pone
  rojo con el número («quedan 8 dp, menos que el piso de 16»). Mide valores, no formas.
- **Los números corregidos están todos bien** (los recalculé uno por uno, §4).
- **Árbol byte-idéntico al de partida**: sha256 + tamaño de los 6 archivos que muté
  (`_layout.tsx` 21.596 B · `StickStatusIndicator.tsx` 12.975 B · `nav-target-bands.ts` 28.439 B ·
  `tap-target-collision-guard.test.ts` 57.890 B · `mas.tsx` 53.576 B · `tamagui.config.ts` 27.941 B),
  `git status --porcelain` con las mismas 52 entradas, `git status -- design/` **limpio**. Sin `git add`.
- **No corrí `check.mjs` ni la lista completa de `run-tests.mjs`** (instrucción del leader: otra unidad en
  vuelo en el mismo árbol). No toqué ningún archivo de esa unidad.

---

# 2. LA CAMPAÑA DE MUTANTES — 36 aplicados, 24 rojos, 12 verdes

Todos aplicados con reemplazo de cadena exacta, corridos contra las 2 suites y restaurados desde un
respaldo binario con verificación de **hash + tamaño** después de cada uno (nada del incidente de los
343 KB: los 6 archivos volvieron al byte).

## 2.1 Ataques al `hitSlop` — **14/14 ROJOS**

| # | Grafía | Resultado |
|---|---|---|
| M1 | `tap-target-disable-next-line -- …` + `{{ ...HIT_SLOP, top: FAB_RAISE }}` (**la válvula de escape como bypass**) | ROJO x4 (A-inverso · A-fix · A-fix bis · B-banda) |
| M2 | `hitSlop={slopFromProps}` — el valor viene por **props**, no está en el archivo | ROJO x4 |
| M3 | `hitSlop = {{ … }}` con **espacios alrededor del `=`** (esquiva el regex `hitSlop=`) | ROJO x5 (incluye A-bis) |
| M4 | `const HIT_SLOP = buildFabSlop();` — **helper de otro módulo** | ROJO x5 |
| M5 | `Platform.OS === 'android' ? {…, top} : {…}` — **ternario** | ROJO x5 |
| M6 | `Object.assign({ bottom }, { top: FAB_RAISE })` | ROJO x5 |
| M7 | `{ bottom: 20, top: 26 }` — **números crudos, sin tokens** | ROJO x3 |
| M8 | `{ top: FAB_RAISE, bottom: … }` — **orden de claves invertido** | ROJO x2 |
| M9 | `{ …, ['top']: FAB_RAISE }` — **clave computada quoteada** | ROJO x3 |
| M10 | `top: FAB_SIZE - COLOR.fabSize + FAB_RAISE` — aritmética indirecta que resuelve a 26 | ROJO x2 |
| M11 | `top: Number(FAB_RAISE)` | ROJO x3 |
| M12 | `top: 0x1a` — **hexadecimal** | ROJO x3 |
| M13 | `{…, top: FAB_RAISE } as const` | ROJO x3 |
| M14 | `const HIT_SLOP: { bottom: number; top: number } = {…, top: FAB_RAISE }` | ROJO x3 |

**Conclusión**: el resolvedor **no se puede burlar por la grafía del `hitSlop`**. Es exactamente lo que
prometía y lo cumple.

## 2.2 Ataques a la BANDA (superficie nueva anclada al pico del FAB)

| # | Anclaje del overlay interactivo | Resultado |
|---|---|---|
| B-a | `bottom={insets.bottom + 86}` | ROJO (B1) |
| B-e | `bottom={86 + insets.bottom}` (reserva a la derecha) | ROJO (B1) |
| B-g | `style={{ position:'absolute', bottom: insets.bottom + 86 }}` | ROJO (B1-bis) |
| **B-h** | **`bottom={Math.max(insets.bottom, 86)}`** | **🔴 VERDE 47/47** |
| **B-b** | **`bottom={0}` + `marginBottom={insets.bottom + 86}`** | **🔴 VERDE 47/47** |
| **B-c** | **`bottom={insets.bottom}` + `marginBottom={86}`** | **🔴 VERDE 47/47** |
| **B-d** | **`bottom={insets.bottom}` + `transform={[{ translateY: -86 }]}`** | **🔴 VERDE 47/47** |
| **B-f** | **`bottom={insets.bottom - -86}`** | **🔴 VERDE 47/47** |
| **B-i** | **`bottom={insets.bottom ? 86 : 86}`** | **🔴 VERDE 47/47** |
| B-j | el **pill** (registrado) anclado con `Math.max(…)` | ROJO x2 (B-banda «no se verificó NI UN anclaje» · D) |
| B-k | el pill 12 dp más cerca del FAB, misma grafía | ROJO (B-banda, con el número) |
| B-m | el pill (registrado) con aritmética **ilegible** | ROJO x2 (fail-closed cumplido) |
| B-n | el pill (registrado) con identificador importado | ROJO x2 |

## 2.3 Ataques al pill

| # | Mutante | Resultado |
|---|---|---|
| P1 | `onPress` + `pointerEvents="auto"` | ROJO (E) |
| P4 | se le saca `pointerEvents="none"` | ROJO (E) |
| P5b | `pointerEvents={'none'}` | ROJO (E) |
| **P2/P2b** | **`onPressIn` + `pointerEvents="auto"`, con el `none` mudado al `<Text>`** | **VERDE 47/47** |
| **P3** | **`onLongPress` + idem** | **VERDE 47/47** |

## 2.4 El target del FAB SIN tocar el `hitSlop`

| # | Mutante | Resultado |
|---|---|---|
| F1 | `marginTop: -FAB_RAISE * 2` (el Pressable entero sube 26 dp más) | VERDE 47/47 |
| F2 | `height: FAB_SIZE + FAB_RAISE` (la caja crece hacia arriba) | VERDE 47/47 |
| F3 | `pressRetentionOffset={{ top: FAB_RAISE, … }}` | VERDE 47/47 — **no es vector**: RN solo retiene el press ya iniciado, no roba el tap inicial. Lo descarto. |

**F1/F2 están DECLARADOS como territorio del E2E** («este archivo es el que caza el DRIFT DE LAYOUT que
la aritmética no puede ver», `fab-target-geometry.spec.ts:20`) y la aserción (2) —`fab.top - pill.bottom
>= 16`— los pondría en rojo con la caja real. **No lo ejecuté** (el E2E pide build + Supabase): lo cuento
como razonado, no verificado. **No los pido como cambio.**

---

# 3. Cambios requeridos (priorizados)

## 🔴 1 — `(B1)` sigue vigilando la GRAFÍA: exige un `+` literal y solo lee la prop `bottom`

**Seis mutantes de overlay interactivo anclado al pico del FAB pasan 47/47** (§2.2). El más natural de
todos es el que más duele:

```tsx
<XStack position="absolute" bottom={Math.max(insets.bottom, 86)} onPress={…}>   // 86 = navBar 60 + fabRaise 26
```

`app/src/utils/tap-target-collision-guard.test.ts:332-340` — `anchorsAboveBottomReserve()`:

```ts
if (reserve.test(expr) && expr.includes('+')) return true;
```

`expr.includes('+')` es literalmente **la firma de ayer**: `Math.max(reserva, N)` es la forma idiomática
de decir "al menos N desde abajo" y no lleva `+`. Y `bottom` es la única prop que se extrae, así que
`marginBottom` y `transform: translateY` pasan sin que nadie mire.

**Por qué es 🔴 y no 🟡**:
(a) es **la clase que esta ronda vino a cerrar** — el comentario de `(B1)` dice *«La firma tiene que ser
el DESTINO, no el camino»* (:498) y el header promete *«v3 no cuenta claves ni nombres: **resuelve
valores**»* (:31); acá sigue contando un carácter.
(b) **A diferencia de todos los otros survivors, este no lo cubre nada**: el E2E solo muestrea la franja
que el *slop del FAB* agrega (vacía con `top:0`) en 2 pantallas — un toast nuevo en la banda no aparece en
ningún oráculo.
(c) el ejemplo del propio mensaje de error («antes de agregar un toast/banner/snackbar ahí») describe
exactamente el caso que se escapa.

**Fix sugerido** (no lo elijo yo, pero el material ya está en el repo): el disparador de `(B1)` puede
dejar de ser textual — `evaluateDp()` + `bottomReserveNames() → 0` ya resuelven cualquier aritmética a un
número, que es lo que `(B-banda)` hace con las superficies registradas. Con eso, "¿este `bottom` cae en la
banda?" se contesta con el valor y `Math.max`, el ternario y la resta de negativo caen solos. Lo que
queda irreducible (`marginBottom`, `transform`) **se declara** en el bloque «LO QUE ESTE GUARD NO VE» —
hoy ese bloque solo menciona el número pelado y los dos niveles de indirección, así que estas tres formas
no están ni cerradas ni declaradas.

## 🔴 2 — Las specs describen el guard **v2**: los conteos y la pieza central están mal

Es el paso 6 del protocolo otra vez: la reescritura v3 cambió estructura y las specs quedaron viejas.

| Sitio | Dice | As-built |
|---|---|---|
| `specs/…/design-multivendor.md:527` | `nav-target-bands.test.ts` **16 casos** | **26** |
| `specs/…/design-multivendor.md:528` | `tap-target-collision-guard.test.ts` **17 casos** | **21** |
| `specs/…/design-multivendor.md:528` | enumera (A) (A-fix) (B1) (B2) (C) (D) (E) | **faltan `(A-fix bis)`, `(A-bis)`, `(B1-bis)` y sobre todo `(B-banda)`** |
| `specs/…/tasks-multivendor.md:61` | «16 casos» / «17 casos» / «22 mutantes en total» | **26 / 21 / 15+13+5** |
| `progress/impl_fab-hitslop-pill.md:203` y el ⚪ de §0 | «16 casos» / «hoy son 17» | el propio informe se contradice con su §«DIAGNÓSTICO», que dice 21 y 47/47 |

`(B-banda)` es, según el propio informe, la contramedida que **cierra la salida de "registrarse"** — y el
design no la nombra. Un lector del design en 6 meses cree que alcanza con anotarse en
`BOTTOM_BAND_SURFACES`. Reconciliar los 5 sitios.

## 🟠 3 — Dos afirmaciones que contradicen el as-built (el pill NO es tocable)

- **`docs/backlog.md:340`**: *«…el pill subió a ~20 dp de aire **y pasó a ser tocable → `/baston`**»*.
  Sobrevivió a la reversión. En el mismo archivo, 20 líneas más arriba, todo lo demás está bien corregido.
- **`app/app/(tabs)/mas.tsx:288-290`**: *«el nombre accesible se arma en `connection-view.ts` JUNTO al del
  pill del chrome, **que es el otro botón que lleva a `/baston`**»*. El pill no es un botón y no navega.
  Contradice directamente el docblock de `connection-view.ts:189-195`, que dice lo correcto («El pill del
  chrome NO tiene entrada acá **a propósito**: no es un botón»). Dos comentarios del mismo cambio que se
  desmienten entre sí.

## 🟡 4 — `(E)` es burlable con dos cambios coordinados

`tap-target-collision-guard.test.ts:678-699`:

- `assert.doesNotMatch(src, /\bonPress\b/)` → **`onPressIn` y `onLongPress` no matchean** (el `\b` corta).
- `assert.match(src, /pointerEvents="none"/)` **no está anclado al pill**: le alcanza con que el string
  exista en cualquier parte del archivo. Ponerle `pointerEvents="none"` al `<Text>` y `"auto"` al pill
  deja el guard verde con el pill capturando toques (P2b/P3, medido).
- Tampoco mira `role`/`accessibilityRole` crudos (solo el helper `buttonA11y`).

**Lo cubre el E2E** (`fab-target-geometry.spec.ts:366-373` asierta `getComputedStyle(pill).pointerEvents
=== 'none'`, `role === ''` y `isPill === false`), así que no es un agujero abierto — pero el E2E no corre
en `check.mjs` y `(E)` es el que promete en su docblock *«si aparece un `onPress` o se va el
`pointerEvents="none"`, el guard se pone rojo»*. **Razonado, no ejecutado** (no corrí el E2E).
Fix barato: extraer el bloque JSX del pill (ya hay `jsxPropExpressions`/`braceBody` para eso) y asertar
sobre **ese** fragmento, con `/\bon(Press|LongPress|Touch)[A-Za-z]*\b/`.

## ⚪ 5 — Menores

- **La caja del pill en el A07 aparece con dos valores distintos**: `[241,1244]-[479,1306]`
  (`docs/backlog.md`) vs `[220,1244]-[500,1306]` (`StickStatusIndicator.tsx:29`, RMV3.6, T-MV.4.8). Mismo
  device, misma altura, ancho distinto (238 vs 280 px). Puede ser otro label, pero las dos se presentan
  como "el pill en el A07" sin decir cuál estado. Aclarar o unificar.
- **`progress/current.md:36`** dice «11 mutantes nuevos»; con la ronda v3 son 11+5. Es del leader.
- **El capture file quedó en 5 shots** (01, 02, 04, 05, 06 — sin 03, que era el de PRESS). El header
  explica por qué no hay press pero no por qué se saltea el 03. Cosmético.
- **`feature_list.json`**: `04-bluetooth-baston` sigue en `deferred` y **no hay ninguna feature
  `in_progress`** (verificado). El paso 2 del protocolo de review sigue sin resolver. Es del leader.

## Lo que NO pido que se toque

- El fix en sí y su comentario nuevo en `_layout.tsx`: correcto, medido, y el bloque de 55 líneas que
  afirmaba algo falso quedó reemplazado por uno corto y cierto.
- **El resolvedor `nav-target-bands.ts`**: es lo mejor de esta ronda. Fail-closed real, verificado con 10
  gramáticas. La decisión de compartir **una sola traducción** entre el guard estático y el E2E cierra el
  agujero del espejo de raíz, y `(C)` lo blinda prohibiendo por nombre que las copias vuelvan.
- `(B-banda)`: hace lo que promete, con números y sobre el fuente real (B-k/B-m/B-n lo confirman).
- La reversión del pill y su documentación (bloque ⛔ + nota de RMV3.6 + shot 06): la evidencia queda
  escrita donde el próximo la va a encontrar. Bien resuelto.
- `connection-view.ts`: el label centralizado, sus 5 tests nuevos (incluido el espejo del locator de la
  E2E) y el docblock que explica por qué el pill NO tiene entrada ahí.
- La corrección de `docs/backlog.md` 2026-07-18 — **salvo la línea 340**.

---

# 4. Exactitud de los números y comentarios (recalculados uno por uno)

El pliego pedía confirmar que quedaron **todos** corregidos, no solo el que el implementer vio.

| Afirmación | Dónde | Recalculado |
|---|---|---|
| `$6` = 32 (era 24) | guard:494, `nav-target-bands.test.ts:248`, `e2e:56` | OK, y **cruzado contra tamagui** por (C) |
| `$navBar + $6` = **92 dp**, pico del FAB en **84**, borde de abajo del pill en **104** | guard:494-496 | OK (0+60+32=92 · 60-2+26=84 · 60+26+18=104) |
| `86 = navBar 60 + fabRaise 26` | guard:29 | OK |
| `hitSlop.bottom` = `60 - 2 - (64 - 26)` = **20** | `_layout.tsx:145`, `nav-target-bands.test.ts:74` | OK |
| Separación as-built **20 dp** = `$4 (18) + $navItemTop (2)` | 4 sitios | OK, y derivada por (C) desde los tokens |
| Contrafáctico `1f1c002` = **-17 dp**, **52 %** del pill | `nav-target-bands.test.ts:146,150` | OK (122 vs 105 -> 17; 17/33 = 52 %) |
| `top: FAB_RAISE` con el aire nuevo = **-6** | :156 | OK |
| gap `$2` con slop 0 = **9 dp** | :161 | OK |
| A07: densidad 300 -> 1 dp = **1,875 px**; 48 px = **25,6 dp**; 30 px = **16 dp**; círculo 1324-1444 = 64 dp | `_layout.tsx:123-132`, backlog | OK los cuatro |
| `1362 - 1276 = 86 px` por encima del techo de la barra | `_layout.tsx:131` | OK |
| «16 casos / 17 casos» | design:527-528, tasks:61, informe:203 | **MAL -> 26 / 21** (🔴-2) |
| «22 mutantes en total» | tasks:61 | **MAL** — 15 (1a) + 13 (fix-loop) + 5 (v3) (🔴-2) |
| «el pill … pasó a ser tocable» | `docs/backlog.md:340` | **MAL** (🟠-3) |
| «el pill … es el otro botón que lleva a /baston» | `mas.tsx:289` | **MAL** (🟠-3) |

**`docs/backlog.md` 2026-07-18 (lo que pedía el pliego)**: refleja que la **hipótesis (a) era la
correcta** («el `hitSlop` del Pressable extiende el área efectiva 26 dp sobre el círculo, en Android,
medido»), descarta (b) y (c) con el hecho 2, y nombra el error de método con precisión — prever **un solo**
modo de falla y correr un experimento que **da el mismo resultado con y sin el defecto**. También corrige
la línea «Si reaparece», que era el vehículo del error. **Cumple, con la salvedad de la línea 340.**

---

# 5. Trazabilidad `R<n>` <-> test

| Requisito / invariante | Test concreto | Estado |
|---|---|---|
| **RMV3.5** el indicador global existe y refleja el estado | `connection-view.test.ts` (42) · `e2e/baston-multivendor.spec.ts` (a-f) | OK |
| **RMV3.6** el indicador NO bloquea: el CONTENEDOR no captura | `(D)` + `(E)` (`box-none` explícito) | OK |
| **RMV3.6** el pill **no intercepta** el toque (as-built restaurado) | `(E)` (mutantes P1/P4/P5b -> rojo, **corridos por mí**) **+** `e2e/fab-target-geometry.spec.ts` -> `el pill NO intercepta el toque` (2 pantallas: pointerEvents computado + elementFromPoint + tap táctil real) | OK (con el hueco 🟡-4 de `(E)`) |
| **RMV3.1** el rótulo "Dispositivos" + la fila | `fab-hitslop-pill.capture.ts` shots 04/05 · `baston-multivendor.spec.ts` (e)/(f) | PENDIENTE del veto visual del leader |
| **BUG 🔴** el target del FAB no invade la banda de arriba | `nav-target-bands.test.ts` (solape + piso + 4 reservas + contrafáctico) · `(A-fix)` · `e2e` (0)/(1)/(1-bis) | OK |
| El `top` no puede volver **por ninguna grafía** | `(A)` · `(A-fix)` · `(A-fix bis)` · `(A-bis)` — **14 mutantes míos, 14 rojos** | OK |
| El resolvedor es **fail-closed** | `nav-target-bands.test.ts` "lo que NO puede leer, TIRA" (8 formas) · `(A-fix bis)` · **10 gramáticas mías -> rojo** | OK |
| El E2E **no tiene espejo** (deriva el slop del fuente) | `(C)` (exige `resolveFabHitSlop`, prohíbe las 4 copias por nombre, cruza la tabla de space) | OK |
| Separación >= piso, independiente de la plataforma | `nav-target-bands.test.ts` (4 reservas + el inset se cancela) | OK |
| El fix no crea zona muerta en el FAB | `nav-target-bands.test.ts` (el círculo entero dentro de su target) | OK |
| Clase: **una superficie nueva en la banda** | `(B1)` · `(B1-bis)` · `(B2)` · `(B-banda)` | **6 mutantes VERDES -> 🔴-1** |
| Clase: registrarse no alcanza (la banda cierra con números) | `(B-banda)` — B-k/B-m/B-n -> rojo | OK |
| a11y del nombre de la fila (WCAG 2.5.3) | `connection-view.test.ts` (5 casos nuevos, incl. el espejo del locator de la E2E) | OK |
| El fix del `hitSlop` **en device** | — | PENDIENTE: exige build de EAS (gate de CLAUDE.md). Correctamente declarado. |

## Tasks completas

**Sí.** `T-MV.4.8` está en `[x]`. Los 6 `[ ]` restantes de `tasks-multivendor.md` (T-MV.5.6, T-MV.5.18,
T-MV.6.2, T-MV.6.3, T-MV.7.3, T-MV.7.4) siguen con justificación in-line (GATED por hardware RS420, MFi,
device o doc de cierre). Ninguna es de esta unidad. **Lo que falla no son las tasks: es el CONTENIDO de
T-MV.4.8, que describe el guard v2** (🔴-2).

---

# 6. CHECKPOINTS

**C1 — El harness está completo**
- [x] `AGENTS.md`, `feature_list.json`, `progress/*`, `docs/*`, los 5 agentes
- [ ] `node scripts/check.mjs` exit 0 -> **no re-corrido en esta pasada por instrucción del leader** (otra
      unidad y otro reviewer trabajando en el mismo árbol). En su lugar: guards 47/47 + typecheck RC=0.

**C2 — El estado es coherente**
- [ ] como mucho una feature `in_progress` -> hay **0**, y `04` está en `deferred` (⚪-5, del leader)
- [x] `progress/current.md` describe la sesión activa

**C3 — El código respeta la arquitectura**
- [x] capas previstas · sin dependencias nuevas · no se hardcodea `establishment_id`
- [x] **sin logs de debug sueltos** -> el `console.log` del review anterior se convirtió en aserción; los
      dos que quedan en `fab-target-geometry.spec.ts:247-254` son **diagnóstico impreso junto a aserciones
      reales**, no en lugar de ellas. Cerrado.

**C4 — La verificación es real**
- [x] al menos un test por módulo con lógica · fixtures reales · el runner muestra >0 y verdes (47/47)
- [x] RLS -> **N/A**

**C5 — La sesión se cerró bien**
- [x] sin artefactos temporales sin trackear · `design/` limpio
- [ ] `progress/history.md` con entrada de la sesión -> es del leader al cerrar

**C6 — Spec Driven Development**
- [x] los 3 archivos + los `-multivendor`; EARS intactos (la nota anota, no reescribe)
- [x] las tasks de la unidad en `[x]`
- [ ] **el design describe el as-built** -> **NO**: guard v2 en las specs, `(B-banda)` ausente, conteos
      42 % abajo, y dos afirmaciones de "pill tocable" sobrevivientes (🔴-2, 🟠-3)

**C7 — Multi-tenant** -> **N/A** (diff de `supabase/` y `sync-streams/` vacío)

**C8 — Offline-first** -> **N/A** (cero red, cero PowerSync; geometría + navegación local)

**C9 — Verificación E2E + visual (ADR-029)**
- [x] `fab-target-geometry.spec.ts` **2/2** (corrido por el leader; yo no lo re-corrí) y **lo levanta
      `pnpm e2e`** (testDir './e2e' + testMatch default — verificado)
- [x] capture file con los estados clave (5 shots, incluido el 06 con su aserción de superposición)
- [ ] Gate 2.5 del leader (veto visual) -> pendiente, es del leader
- [x] los `__shots__/*.png` no están commiteados

---

# 7. Checklist RAFAQ-específico

**A. Multi-tenancy / RLS** — **N/A**: no toca tablas, policies ni migraciones.

**B. Offline-first** — **N/A**: cero I/O, cero red, cero `establishment_id`.

**C. BLE (Vesta / Allflex)** — parcialmente aplicable (el pill vive del estado de conexión):
- [x] desconexión repentina + UI clara: el pill refleja `disconnected` / `permission_denied`; el acceso a
      `/baston` está por la fila de "Dispositivos" y el `ConnectHero`
- [x] modo manual de fallback en <=1 tap: intacto
- N/A correlación TAG-peso (la unidad no toca ingesta)
- [x] **los eventos BLE no bloquean el flujo del operario** -> **la caja que fallaba en el review anterior
      ahora PASA**: con el pill de vuelta a `pointerEvents="none"`, el toque lo atraviesa y llega al CTA de
      abajo. Es el cierre del 🔴-1 anterior.

**D. UI de campo (manga, wizard)** — aplica:
- [x] target: el FAB sigue en 64 dp + 20 dp de slop hacia abajo (label "Maniobra" tocable). El pill dejó
      de fingir ser un target (se le sacó `$chipMin`): su alto es el de su contenido, ~33 dp
- [x] fuente: fontSize $2 con lineHeight $2 **matching**
- [x] una decisión por pantalla · [x] estado de loading visible (el pill **es** el feedback)
- [x] **separación de targets adyacentes**: 20 dp pill-FAB, verificado en 4 reservas de plataforma y con
      contrafáctico. Y el pill ya no compite con lo que tapa

**E. Edge Functions** — **N/A**.

---

## Nota de método

Todo lo que digo "medido" lo ejecuté en esta sesión. Los 36 mutantes se aplicaron con reemplazo de cadena
exacta y se restauraron desde respaldo **binario**, con verificación de sha256 **y tamaño** después de cada
uno. Uno de ellos mutó un **comentario** en vez del prop y dio un falso verde: lo detecté imprimiendo la
línea mutada y lo re-corrí bien — queda como recordatorio de que a un mutante hay que verificarle que
**aplicó donde se cree**. Los scripts viven en el scratchpad, fuera del repo.

Lo que **no** verifiqué, y lo digo como tal: `check.mjs` completo, la suite E2E (incluida
`fab-target-geometry` y los 3 captures migrados), el comportamiento de F1/F2/P2b bajo el E2E (razonado
desde el código del oráculo, no ejecutado), y cualquier cosa en device.
