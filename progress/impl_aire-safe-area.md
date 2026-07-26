# impl — UNIDAD «aire» (separación entre el contenido inferior y la barra del sistema)

baseline_commit: 5fc8848e3ddf4cff6f641ceea944f5976583e21a

Bug 🔴 reportado por Raf en device Android (Samsung, barra de 3 botones), build EAS `7402575a`.
Diagnóstico medido por el leader (no re-investigado acá): con `insets.bottom = 48`, la fórmula
`max(insets.bottom, $navBottomMin=12)` devuelve 48 → el CTA queda a **1dp** del borde superior de la
barra del sistema. El mínimo de 12 solo se puede disparar cuando el inset es 0 (web).

---

## ⚠️ LAS TRES FÓRMULAS/DECISIONES DESCARTADAS — leer esto primero

Para que nadie re-proponga ninguna en 6 meses. Las tres viven además comentadas en el código
(`tamagui.config.ts`, `utils/footer-action.ts`, `hooks/useSafeBottomInset.ts`) y en `docs/design-system.md` §4.

| # | qué se descartó | cuándo | por qué |
|---|---|---|---|
| 1 | `max(insets.bottom, $navBottomMin)` — la fórmula que el repo tenía copiada en ~25 archivos | **era el bug 🔴** | el mínimo solo puede ganar con inset 0 (web). Con una barra real de 48dp reserva 48 y nada más → CTA a 1dp de la barra |
| 2 | `max(insetVigente, insetArranque) + aire` **en todas las plataformas** | fix-loop 1 (veto del leader) | engordaba iOS (tab bar 94 → 110pt) y borraba el piso de web (12 → 16), sin razón de diseño. Detalle abajo |
| 3 | conservar el `+ 12` de 8 footers como `{ extra: getTokenValue('$navBottomMin','size') }` | **fix-loop 2** (este pase) | ese `+12` era una **grafía accidental** de la reserva canónica, no aire deliberado. Detalle abajo |

---

## ⚠️ FIX-LOOP 2 (2026-07-26): el `extra: $navBottomMin` de 8 call sites se DESCARTÓ (decisión #3)

Los 8 call sites (`animal/baja` · `crear-rodeo` ×2 · `editar-plantilla` · `editar-servicio` ·
`import-rodeo` · `lote/[id]` · `lote/venta`) pasan a **`useSafeBottomInset()` pelado**.

**El fundamento no es estético, es documental**: el propio repo ya había clasificado ese `+12` como deuda,
en el **baseline**, en `docs/plan-mejoras-ux-2026-07-18.md` §4:

> "Deuda menor a foldear: las 14 pantallas con footer fijo hardcodean `+ 12` **en vez de usar
> `$navBottomMin`**"

O sea: la lectura previa del proyecto era que ese `+12` es una **grafía accidental de la reserva
canónica**, deuda a plegar DENTRO de ella — no aire de diseño. Nadie vetó nunca "46pt en iOS" como valor.
Conservarlo dejaba la app con **DOS** reservas de footer conviviendo (Android 3 botones: **64** canónica vs
**76** en estos 8) sin razón escrita, justo en la unidad cuyo punto es que hay UNA.

**Por qué esto no contradice la regla "esta unidad agrega aire, nunca lo saca"** (que sigue vigente para
las otras 5 superficies con knob, 7 call sites): esa regla existe para que no se cuele una regresión
**silenciosa**. Acá es una
**armonización deliberada y con evidencia escrita**: iOS 46 → 34 mueve 8 outliers al valor que ya usan los
otros 26 footers/sheets del repo, que es el que Raf vio y aprobó en device iOS. No se inventó un valor
nuevo: se borró una excepción no documentada.

| plataforma | baseline (y fix-loop 1) | fix-loop 2 |
|---|---|---|
| web | 12 | **12** (sin cambio) |
| iOS | 46 | **34** ↓ (= la canónica) |
| Android gestos | 36 (baseline) / 52 (fl1) | **40** ↑ vs baseline |
| Android 3 botones | 60 (baseline) / 76 (fl1) | **64** ↑ vs baseline |

**Consecuencia en la verificación, sin maquillar**: la propiedad "0 pérdidas de padding en ninguna
plataforma" que reportaba el fix-loop 1 **ya no se cumple**. Hay 8 reducciones en iOS, todas
intencionales y todas al mismo valor canónico. Los números recalculados están más abajo, en «Paridad».

**El guard se endureció junto con la decisión.** La regla 4 tenía una excepción a medida
(`$navBottomMin` permitido en un call site "solo como argumento del hook") que existía **únicamente** para
acomodar esta elección. Sin los 8 outliers no tiene ningún consumidor legítimo y sí un costo: deja la
puerta abierta a que alguien declare 12px de "aire propio" en una superficie nueva y vuelvan a existir dos
reservas. Ahora es **`$navBottomMin` no aparece fuera del hook, punto**.

---

## ⚠️ FIX-LOOP 1 (2026-07-26): la fórmula ADITIVA-EN-TODAS-LAS-PLATAFORMAS se DESCARTÓ (decisión #2)

La primera entrega implementó, tal como estaba especificado,
`paddingBottom = max(insetVigente, insetArranque) + aire` **en todas las plataformas**. El leader la
vetó en review y corrigió el spec. Queda asentado para que **nadie la re-proponga en 6 meses**:

| | fórmula descartada | por qué está mal |
|---|---|---|
| web | 12 → **16** | borraba el piso `$navBottomMin` sin ninguna razón de diseño |
| iOS | 34 → **50** (tab bar 94 → 110pt) | el inset de 34pt de iOS **ya es aire**: es espacio pintado con el fondo de la app con el home indicator (una pildorita fina) adentro. Sumarle 16 hace la tab bar **33% más alta que la nativa de iOS** y deja los CTAs a 50pt del borde, comiendo zona de pulgar. Y era una **regresión** en la plataforma donde Raf ya había dicho que se veía bien —y que no puede re-testear hasta el 1/8 (cuota EAS agotada) |
| Android 3 botones | 48 → 64 ✅ | lo único que la fórmula descartada acertaba |

El error conceptual: tratar "inset" y "aire" como aditivos **siempre**. La aditividad depende de **qué
hay dentro del inset**. La duda #1 de la primera entrega ("el nav crece también en iOS") destapó esto.

### Fórmula correcta (implementada acá) — TRES conceptos, no dos

```
paddingBottom = max(insetVigente, insetArranque, PISO) + (aplicaAire ? AIRE : 0)
```

| término | token | qué es | cuándo gana |
|---|---|---|---|
| **inset** | — | lo que el SO obliga a NO tapar. `max(vigente, arranque)` = blindaje frame-0 de Android (U7, conservado) | siempre que exista |
| **piso** | `$navBottomMin` = 12 | respiro mínimo cuando NO hay inset | solo con inset 0 → **web** |
| **aire** | `$navBarGap` = 16 | separación contra la **barra de navegación** del SO | **solo Android** |

**El justificativo del condicional** (escrito como comentario en `tamagui.config.ts`, en la pura y en el
hook — es el POR QUÉ, no "porque Android"): en Android el inset inferior vale **exactamente** el alto de
la barra de navegación, que el SO dibuja como losa opaca sobre el contenido → reservar el inset deja el
contenido **apoyado sobre su borde** (medido en la captura del device: CTA a 1dp de la barra). En iOS el
inset de 34pt es espacio pintado con el fondo de la app con una pildorita fina adentro: el inset ya *es*
el aire, y sumarle más solo come zona de pulgar.

| | hoy (baseline) | con el fix |
|---|---|---|
| web | 12 | **12** (sin cambio) |
| iOS (home indicator 34) | 34 | **34** (sin cambio) |
| Android gestos (inset ~24) | 24 | **40** ✅ |
| Android 3 botones (inset 48) | 48 | **64** ✅ |

### Cómo quedó implementado

- **La pura sigue pura**: `computeSafeBottomInset` recibe **`applyGap: boolean` por parámetro**. Cero
  `Platform` en `utils/` → sigue corriendo con `node:test`.
- **El `Platform.OS === 'android'` vive en UN solo archivo**: `src/hooks/useSafeBottomInset.ts`, en una
  const nombrada (`OS_DRAWS_NAV_BAR`) con el porqué al lado. El guard lo hace cumplir con **dos** reglas:
  nadie más puede combinar `Platform.OS === 'android'` con la reserva, y **nadie más puede llamar a la
  pura** (llamarla implica decidir `applyGap`).
- **`computeTabBarInsetLayout` dejó de calcular la reserva**: ahora recibe `{ navHeight, safeBottomInset }`
  y solo compone el alto. Así `(tabs)/_layout.tsx` pide la reserva por el mismo hook que todos y el token
  del aire queda leído en **un** archivo (antes eran dos).
- **Los dos tokens conviven** en `tamagui.config.ts`, cada uno con su comentario de qué es y cuándo gana.

### La unidad no puede QUITAR aire por criterio propio (duda #2 de la primera entrega) — barrido completo

La primera entrega unificó `TagScanSheet` y `FindOrCreateOverlay` de 32 → 16 por criterio propio, sin
evidencia de que ese aire fuera accidental. Va en contra de la regla: **esta unidad agrega aire, y solo lo
saca cuando hay evidencia escrita de que no era aire deliberado** (que es el caso, y el ÚNICO caso, de los
8 outliers del `+12` — ver el fix-loop 2 arriba). Restaurados, y barrido el resto con el mismo criterio.
El hook admite dos knobs opcionales, siempre por token de **spacing** (ADR-023 §4):

- **`{ extra }`** — aire PROPIO que se suma al inset (lo que la superficie ya sumaba a mano).
- **`{ floor }`** — piso PROPIO, cuando la superficie ya tenía un mínimo mayor que 12.

Se combinan sin doble-contar: `max(inset + extra, piso, floor) + (aplicaAire ? aire : 0)`. El `extra` se
suma **antes** del `max` con los pisos justamente para que en web una superficie con `extra: 32` dé 32 y
no 44 (piso + extra sería sumar dos veces lo mismo).

| familia (baseline) | call sites | qué se le pasa al hook |
|---|---|---|
| `max(inset, $navBottomMin)` — la canónica | 25 | nada (default) |
| `inset + 12` hardcodeado (footers de wizard) — **8 sitios en 7 archivos** (`crear-rodeo` ×2) | 8 | **nada (default)** — plegados a la canónica en el fix-loop 2 |
| `inset + $3` (barras de selección masiva) | 3 | `{ extra: getTokenValue('$3','space') }` |
| `max(inset, $4)` (CutPromptSheet, TactoConfigSheet) | 2 | `{ floor: getTokenValue('$4','space') }` |
| `inset + $6` (TagScanSheet, FindOrCreateOverlay) | 2 | `{ extra: getTokenValue('$6','space') }` |
| `insets.bottom` **pelado** como base de una POSICIÓN (`StickStatusIndicator`) | 1 | nada (default) — ver más abajo |

Quedan **5 superficies con knob**, todas porque YA tenían más aire que el resto antes de la unidad y ese
aire sí es deliberado (un sheet de escaneo con `$6`, barras de selección masiva con `$3`, dos sheets con
piso `$4`). El knob se pide **siempre con un token de spacing**, nunca con `$navBottomMin`: nombrar el
piso en un call site es escribir la reserva canónica de otra forma, no declarar aire propio.

---

## Plan (tasks)

- [x] T1 — Tokens: `$navBottomMin: 12` **y** `$navBarGap: 16` conviven en `app/tamagui.config.ts`, cada
      uno con su comentario (qué es, cuándo gana, y el porqué de que el aire sea solo-Android).
- [x] T2 — `computeSafeBottomInset` con los 3 conceptos + `applyGap` por parámetro + `extra`/`floor`
      opcionales. Doc del archivo reescrito con las **dos** fórmulas muertas. Tests reescritos.
- [x] T3 — `computeTabBarInsetLayout` pasa a composición pura (`navHeight + safeBottomInset`). Tests
      reescritos: contrato de composición + la tabla de la decisión compuesta con la reserva real.
- [x] T4 — Hook compartido `useSafeBottomInset(own?)` (`app/src/hooks/useSafeBottomInset.ts`): insets +
      los dos tokens + **el único `Platform.OS === 'android'`** de la reserva. Exportado desde `hooks/index.ts`.
- [x] T5 — Barrido de los call sites (41 sitios) → hook compartido. Cero copias. Extras restaurados.
- [x] T6 — Guard estático (`app/src/utils/safe-bottom-inset-guard.test.ts`), **8 reglas** (la 4ª endurecida
      y la 8ª —resolución real de los tokens— agregadas en el fix-loop 2). Registrado en `run-tests.mjs`.
- [x] T7 — Root `SafeAreaProvider initialMetrics={initialWindowMetrics}` (`app/app/_layout.tsx`).
- [x] T8 — Reconciliación de docs/specs (design-system §4/§6, plan-mejoras ×2, spec 03, skill design-review).
- [x] T9 — `node scripts/check.mjs` verde + greps de aceptación + verificación de paridad con el baseline.
- [x] T10 — Capture file de Gate 2.5 (`app/e2e/captures/aire-safe-area.capture.ts`), corrido: 6 capturas
      + assertion de runtime de que el nav en web sigue midiendo 72px/12px.
- [x] T11 — Entrada de `docs/backlog.md`: `check.mjs` no cubre E2E + los 22 rojos pre-existentes.
- [x] T12 (fix-loop 2) — Armonización de los 8 outliers del `+12` + regla 4 del guard endurecida +
      regla 8 nueva (los tokens RESUELVEN) + reconciliación de `specs/active/03` y `specs/active/04` +
      `docs/design-system.md` §4 ("Los 8 outliers") + `docs/plan-mejoras-ux-2026-07-18.md` +
      entrada de backlog del comentario mentiroso de `export-sigsa`.

## Verificación (ejecutada, no leída)

**`node scripts/check.mjs` → EXIT=0**, sobre el árbol final del **fix-loop 2**. Suite por suite, del
output real: anti-hardcode **0 violaciones** · typecheck client OK · scripts unit 28/28 · **client unit
2470/2470** · RLS 22 · Edge Functions 42 · Animal 139 · Maneuvers 14 ·
Puesta-en-servicio 11 · Reports 16 · Custom 20 · Scrotal/CE 12 · User_private 28 · Import 25 ·
Sync-streams 25 · Operaciones-rodeo 22 · SIGSA 72 · Treatments 11 · Audit 15 · Health EF 5 — **todas `OK`,
`fail 0`**. Cierre: `All tests passed` / `[OK] Tests verdes` / `[OK] Entorno listo.`

> Nota sobre el conteo: el fix-loop 1 reportaba **2468** client unit y este pase agrega **exactamente un
> test** (la regla 8 del guard) → deberían ser 2469, y la corrida real da **2470**. O sea que el 2468 del
> informe anterior estaba **desactualizado en 1** (transcrito de una corrida previa a su último test). No
> lo maquillo: el número bueno es el medido ahora, 2470/2470 con `fail 0`.

**Greps de aceptación — los cuatro en CERO** (`rc=1` en los cuatro; sobre `app/app` + `app/src`):

| # | qué busca | resultado |
|---|---|---|
| A | `Math.max( insets?.bottom` / `Math.max( bottomInset` — la fórmula vieja | 0 |
| B | `getTokenValue('$navBarGap'` fuera del hook — el aire suelto | 0 |
| C | `getTokenValue('$navBottomMin'` fuera del hook (sin excepciones, desde el fix-loop 2) | 0 |
| D | un token del borde inferior combinado a mano con un inset (la re-implementación aditiva) | 0 |

Los cuatro están codificados como tests en el guard (que además arma sus firmas por concatenación para
no ensuciar los greps).

### Paridad con el baseline, call site por call site (la propiedad fuerte)

Script de verificación que **extrae mecánicamente** la fórmula del baseline de cada archivo
(`git show 5fc8848:<file>` + regex de las 6 firmas que existían) y los `extra`/`floor` del HEAD, evalúa
ambas con los tokens reales (`$3`=13, `$4`=18, `$6`=32, `$navBottomMin`=12, `$navBarGap`=16) en los 4
perfiles de plataforma, y compara. **41 call sites** cubiertos.

**Números RECALCULADOS después del fix-loop 2** (corrida real del verificador sobre el árbol final):

```
call sites comparados: 41
WEB — sitios con valor distinto al baseline: 1
PÉRDIDAS de padding en cualquier plataforma: 8
   !! animal/baja#0 iOS: 46 → 34
   !! crear-rodeo#0 iOS: 46 → 34
   !! crear-rodeo#1 iOS: 46 → 34
   !! editar-plantilla#0 iOS: 46 → 34
   !! editar-servicio#0 iOS: 46 → 34
   !! import-rodeo#0 iOS: 46 → 34
   !! lote/[id]#0 iOS: 46 → 34
   !! lote/venta#0 iOS: 46 → 34
```

Lectura honesta de esos dos números:

- **Web sigue idéntico en 40/41.** El fix-loop 2 **no movió web**: los 8 outliers valían `0 + 12 = 12` en
  el baseline y valen 12 ahora (el piso los cubre). *(El review anticipaba que esta propiedad se caía;
  medido, no se cae — lo que se cae es la de "0 pérdidas". Lo dejo escrito para que el próximo lector no
  arrastre el supuesto.)* La única diferencia en web es **intencional y no es un padding**: el `bottom`
  del `StickStatusIndicator` (pill de estado del bastón), que pasa de 93 a 105 porque se posiciona
  RELATIVO al nav y antes usaba el inset **pelado** (0 en web) en vez del `paddingBottom` real del nav
  (12) → el pico del FAB (98) se lo comía por 5px. iOS queda idéntico (127) y Android sube 16 igual que
  el nav. Reconciliado en `specs/active/04-bluetooth-baston/design-multivendor.md` §7.
- **8 reducciones, todas en iOS, todas al mismo valor y todas deliberadas** (fix-loop 2, decisión #3):
  46 → 34, que es la reserva canónica que ya usan los otros 26 footers/sheets. Ninguna otra plataforma
  pierde: en **Android** los 41 sitios ganan o quedan igual (los 8 outliers pasan de 36 → 40 con gestos y
  de 60 → 64 con 3 botones, **vs baseline**), y en web nadie pierde.
- **Cero pérdidas NO INTENCIONALES**: las 8 son exactamente las 8 esperadas de la armonización, ni una más.
  Ese es el chequeo que importa ahora que la propiedad "0 pérdidas" ya no aplica.
- Nota del script: `lote/[id].tsx` reporta "baseline 2 vs head 1" — legítimo, es **un** hook alimentando
  **dos** consumidores JSX; las dos líneas del baseline eran la misma fórmula (`inset + 12`).
- Tabla completa (extracto de las familias no-canónicas):

| call site | baseline | propio | web | iOS | and-gestos | and-3btn |
|---|---|---|---|---|---|---|
| bottom-nav | `max(inset,$navBottomMin)` | — | 12→12 = | 34→34 = | 24→40 + | 48→64 + |
| CutPromptSheet / TactoConfigSheet | `max(inset,$4)` | floor `$4` | 18→18 = | 34→34 = | 24→40 + | 48→64 + |
| **8 footers de wizard** | `inset + 12` | **—** | 12→12 = | **46→34 ↓** | 36→40 + | 60→64 + |
| selección masiva ×3 | `inset + $3` | extra `$3` | 13→13 = | 47→47 = | 37→53 + | 61→77 + |
| TagScanSheet / FindOrCreateOverlay | `inset + $6` | extra `$6` | 32→32 = | 66→66 = | 56→72 + | 80→96 + |
| StickStatusIndicator (posición, no padding) | inset pelado | — | 0→12 + | 34→34 = | 24→40 + | 48→64 + |

### Cierre del lazo source → runtime

La paridad de arriba es sobre el **código**. Se cerró contra el **DOM renderizado** con **dos** assertions
en la capture file (la segunda es del fix-loop 2):

1. **El bottom-nav**: `getComputedStyle` del contenedor del `role="tablist"` → **`height: 72px` /
   `paddingBottom: 12px`**, exactamente lo que medía antes de esta unidad. Si alguien volviera a la
   aditiva-en-todas-las-plataformas, ahí daría 76/16 y la captura falla.
2. **Un footer de pantalla** (`crear-rodeo`, uno de los 8 outliers armonizados): se sube por los
   ancestros del CTA hasta la barra (el único contenedor con `border-top-width: 1px`) y se asserta
   **`paddingBottom: 12px`** — el MISMO píxel que el `insets.bottom + 12` del baseline. Si la
   armonización hubiera movido web daría 24 (piso + extra) o 0.

**Lo que ninguna de las dos puede probar** (y por eso existe la regla 8 del guard): en web `applyGap` es
`false`, así que **`$navBarGap` nunca se lee** en toda la corrida E2E. Un token mal escrito o movido de
grupo lo dejaría en `undefined` → 0 → el fix sería un **no-op en Android con toda la suite verde**. Los
otros dos tokens de la geometría sí quedan verificados en runtime por estas assertions (`$navBar` = 60 y
`$navBottomMin` = 12 se leen de los 72px / 12px del nav).

### Suite E2E

- **Fix-loop 2, sobre un build fresco (`pnpm e2e:build`, exit 0) del árbol final** — se corrieron los
  specs que ejercitan las **pantallas armonizadas** (crear-rodeo, lotes, footers fijos con CTA) y los de
  rodeo grande (`lote/[id]` en modo selección + la ruta a `lote/venta`):
  - `rodeos.spec.ts` + `cta-siempre-visible.spec.ts` + `lotes.spec.ts` → **8 passed / 1 failed**
  - `rodeo-grande.spec.ts` → **6/6 verdes**
  - El único rojo es **`lotes.spec.ts:61`**, que está en la lista de **22 rojos pre-existentes** ya
    registrada en `docs/backlog.md` (familia del oráculo `.first()`). Verificado que la firma coincide:
    falla en `expect(page.getByText(loteName).first()).toBeVisible()` (`:103`), o sea el `.first()` que
    matchea el nodo oculto de la pantalla de fondo — no tiene nada que ver con padding ni con esta unidad.
- **Fix-loop 1**: `sheet-teclado` + `maniobra-config-sheet-race` + `maniobra-elegir` + `sheet-arrastre`
  = 12/12 verdes (los specs que más ejercitan footers fijos, bottom sheets y el CTA del wizard).
- La corrida completa (269 tests) de la entrega anterior dio 247/22, con los 22 **atribuidos
  empíricamente** a un worktree en el baseline → todos pre-existentes. Como la fórmula corregida deja web
  **numéricamente idéntico** al baseline en los 41 call sites, esa atribución sigue valiendo: esta unidad
  no puede haber movido un píxel en web. El hallazgo quedó registrado en `docs/backlog.md`.
- `design/**/*.png` re-renderizados por las corridas E2E → **revertidos** (churn espurio, memoria
  `reference_e2e_design_png_rerender`).

**Capture de Gate 2.5** (re-corrida en el fix-loop 2): `pnpm exec playwright test
e2e/captures/aire-safe-area.capture.ts --config playwright.capture.config.ts --workers=1` → **1 passed,
6 PNG** en `__shots__/aire-safe-area/` (gitignoreados, NO stageados). Las **dos** assertions de runtime
pasan (nav `72px`/`12px`, footer de `crear-rodeo` `12px`). Miradas: `03-maniobra-cta-nueva-jornada` (el
CTA del reporte de Raf) y `06-crear-rodeo-footer` (uno de los 8 armonizados) — el CTA queda con su
respiro de 12 sobre el borde, idéntico al baseline, nada corrido.
**Arreglo de la propia capture**: el shot 06 salía con el cuerpo en *"Cargando sistemas productivos…"*
(el CTA se monta antes que los datos) → servía para el assert numérico pero **no para vetar diseño**.
Ahora espera a que el placeholder desaparezca; el shot muestra la pantalla real (5 sistemas + footer).

**Lo que NO puedo verificar yo** (y no maquillo):

- **Android**: en web `insets.bottom = 0`, así que **el bug no es observable acá**. Que el CTA deje de
  estar soldado a la barra de 3 botones es **veredicto de DEVICE Android** (ADR-029). Y con web sin barra
  de navegación, **`$navBarGap` nunca se lee en ninguna corrida automatizada** — de eso se ocupa la regla
  8 del guard, que es lo más cerca que se puede estar de verificarlo sin device.
- **Web**: queda por construcción idéntico al baseline en 40 de 41 call sites (verificado
  numéricamente + dos assertions de DOM), así que el riesgo en web es nulo. La 41ª es el pill del bastón,
  intencional.
- **iOS — acá sí hay algo que vetar, y no lo puedo hacer yo**: hasta el fix-loop 1 iOS quedaba idéntico al
  baseline por construcción y el riesgo era nulo. **Ya no**: la armonización de los 8 outliers baja esos
  footers de **46 → 34pt** en iOS. Es un cambio deliberado y hacia el valor que el resto de la app ya usa
  (o sea, hacia lo que Raf ya vio y aprobó en device iOS), pero **es un cambio visible en iOS y merece
  ojo humano**. Contexto operativo: Raf no puede re-testear iOS hasta el 1/8 (cuota EAS agotada). Las 7
  pantallas afectadas: `animal/baja`, `crear-rodeo` (wizard + oferta de import), `editar-plantilla`,
  `editar-servicio`, `import-rodeo`, `lote/[id]`, `lote/venta`.

## Trazabilidad (requisito → test)

| Requisito | Test |
|---|---|
| Android 3 botones (inset 48) → 64, estrictamente > 48 | `footer-action.test.ts` "REGRESIÓN del bug 🔴…" · `tab-bar-insets.test.ts` idem |
| Android gestos (inset 24) → 40, > 24 | `footer-action.test.ts` "Android gestos (inset ~24)…" · `tab-bar-insets.test.ts` idem |
| **iOS NO crece** (34 → 34, nav 94pt) — la aditiva pura está muerta | `footer-action.test.ts` "REGRESIÓN de la fórmula aditiva-en-TODAS-las-plataformas…" · `tab-bar-insets.test.ts` "…iOS queda en 34 (nav 94pt), NO en 50 (110pt)" |
| **El piso de web vuelve** (0 → 12, no 16) | `footer-action.test.ts` "REGRESIÓN del piso perdido…" · `tab-bar-insets.test.ts` "…web → padding 12 (nav 72), NO 16" |
| El piso solo gana cuando el inset es menor que él | `footer-action.test.ts` "el PISO solo puede ganar…" |
| Blindaje frame-0 de Android (U7) se conserva | `footer-action.test.ts` "Android frame-cero…" · `tab-bar-insets.test.ts` idem |
| Aire propio (`extra`) se suma al inset y no duplica el piso en web | `footer-action.test.ts` "`extra` (aire propio)…" y "`extra` chico…" |
| Piso propio (`floor`) compite en el max, no se suma | `footer-action.test.ts` "`floor` (piso propio)…" |
| Los knobs por default son inocuos (= canónico) | `footer-action.test.ts` "sin `extra`/`floor`…" |
| `height = navHeight + paddingBottom`, y el nav NO re-calcula la reserva | `tab-bar-insets.test.ts` (2 tests de contrato) |
| Endurecimiento (NaN/negativos/Infinity) | ambos archivos, caso "NaN / negativos / no-finitos" |
| Ningún call site re-implementa la fórmula (5 firmas distintas) | `safe-bottom-inset-guard.test.ts` (reglas 1-4 y 6) |
| **Ni `$navBarGap` ni `$navBottomMin` salen del hook — el piso tampoco como argumento** | `safe-bottom-inset-guard.test.ts` reglas 3 y 4 (la 4 endurecida en el fix-loop 2) + el contra-test que verifica que la regla 2 NO la cazaría sola |
| **Los dos tokens RESUELVEN de verdad** (existen en el grupo `size`, valen números finitos > 0, el hook los pide de ESE grupo) | `safe-bottom-inset-guard.test.ts` "los tokens del borde inferior RESUELVEN…" (regla 8) |
| **Las constantes hardcodeadas de los tests puros (`PISO`/`GAP`) siguen siendo los valores reales de los tokens** | idem, punto (d) — cruza `footer-action.test.ts` y `tab-bar-insets.test.ts` contra `tamagui.config.ts` |
| La decisión de plataforma no se bifurca | `safe-bottom-inset-guard.test.ts` regla 5 + "el hook decide el aire por PLATAFORMA" |
| El guard puede fallar (no es decorativo) | `safe-bottom-inset-guard.test.ts` "el guard DETECTA las firmas…" + "…recorre el árbol real" + las 5 mutaciones falsificadas (abajo) |
| En web nada se movió (runtime, no código) | `e2e/captures/aire-safe-area.capture.ts`: assert `72px`/`12px` sobre el nav **+ assert `12px` sobre el footer de `crear-rodeo`** (uno de los 8 armonizados) |

## Qué cambió, archivo por archivo

**Núcleo (la fórmula vive acá y solo acá)**
- `app/tamagui.config.ts` — **`navBottomMin: 12` (piso) + `navBarGap: 16` (aire)**, cada uno con su
  comentario: qué es, cuándo gana, y el porqué por plataforma del aire.
- `app/src/utils/footer-action.ts` — `computeSafeBottomInset` con `minInset` + `gap` + **`applyGap`** +
  `extra`/`floor` opcionales. Docblock con las **dos** fórmulas muertas y por qué. Sin `Platform`.
- `app/src/utils/tab-bar-insets.ts` — `computeTabBarInsetLayout({ navHeight, safeBottomInset })`: pasa a
  **componer solo el alto**. Ya no importa `computeSafeBottomInset` ni lee tokens.
- `app/src/hooks/useSafeBottomInset.ts` — el hook compartido. Acá y solo acá: los dos tokens, los dos
  insets, y `OS_DRAWS_NAV_BAR = Platform.OS === 'android'`. Firma `useSafeBottomInset({ extra?, floor? })`.
- `app/app/_layout.tsx` — `<SafeAreaProvider initialMetrics={initialWindowMetrics}>` (follow-up de U7).

**Nav y primitivos**
- `app/app/(tabs)/_layout.tsx` — pide la reserva con `useSafeBottomInset()` y compone el alto. Deja de
  leer `$navBarGap` y de usar `useSafeAreaInsets`/`initialWindowMetrics` (ya no los necesita).
- `FooterActionShell`, `BottomSheetShell`, `maniobra/carga.tsx` — hook compartido; rama de teclado
  (`resolveFooterPaddingBottom`) **intacta** (es de la unidad siguiente).

**Call sites con aire/piso propio (5 superficies, 7 call sites)**
- `{ extra: $3 }` (3): `asignar-caravanas` (`BulkEidBody`), `seleccion-masiva`, `vacunacion-masiva`.
- `{ floor: $4 }` (2): `DientesStep` (`CutPromptSheet`), `TactoConfigSheet`.
- `{ extra: $6 }` (2): `TagScanSheet`, `FindOrCreateOverlay` (los dos que la primera entrega había
  bajado de 32 a 16 por criterio propio — restaurados en el fix-loop 1).

**Call sites ARMONIZADOS a la canónica (fix-loop 2) — 8 sitios en 7 archivos**
`animal/baja` · `crear-rodeo` ×2 (wizard + `OnboardingImportOffer`) · `editar-plantilla` ·
`editar-servicio` · `import-rodeo` · `lote/[id]` · `lote/venta`. Pasaron de
`{ extra: getTokenValue('$navBottomMin','size') }` (fix-loop 1) a `useSafeBottomInset()` pelado. En cada
uno el comentario explica **por qué** su `+12` no se conserva, citando la clasificación de deuda del
propio repo — para que el próximo que lea el diff no lo tome por una pérdida de aire accidental.

**Resto del barrido (sin knobs, reserva canónica)** — se conserva de la primera entrega: 16 sheets/steps
de maniobra, 6 pantallas que siguen usando `insets.top`, `export-sigsa` (`ExportStickyBar` dejó de recibir
`bottomInset` por prop), `LinkCalfPrompt`, `MarkDeclaredSheet`, y `StickStatusIndicator` (el hallazgo de
la autorrevisión: se posiciona relativo a la tab bar).

**Guard + tests**
- `footer-action.test.ts` / `tab-bar-insets.test.ts` — reescritos a los 3 conceptos, con **un test de
  regresión por cada una de las tres fórmulas muertas o incorrectas** (el `max`, la aditiva pura, y el
  piso borrado).
- `safe-bottom-inset-guard.test.ts` — reescrito. Ahora prohíbe: (1) el `max` sobre el inset; (2)
  combinar un token del borde inferior con un inset; (3) leer `$navBarGap` fuera del hook; (4) **nombrar
  `$navBottomMin` fuera del hook, punto** (endurecida en el fix-loop 2: antes se permitía como argumento
  del hook); (5) bifurcar `Platform.OS === 'android'` sobre la reserva; (6) llamar a la pura fuera del
  hook; (7) que el hook fije `applyGap` en un literal; **(8) que los tokens no RESUELVAN** — que
  `$navBottomMin`/`$navBarGap` existan en el grupo `size` de `tamagui.config.ts` con un número finito
  > 0, que el hook los pida de ese mismo grupo, y que las constantes hardcodeadas de los tests puros
  (`PISO`/`GAP`) coincidan con esos valores. Más los dos meta-tests (que el guard detecta y que recorre
  el árbol real, incluido el path del hook).
- `app/e2e/captures/aire-safe-area.capture.ts` — cabecera reescrita + **dos** assertions de runtime
  (nav 72/12 y footer de `crear-rodeo` 12).

**Docs/specs reconciliados**
- `docs/design-system.md` — tabla de tokens (los dos), §4 "Safe areas" reescrita con la tabla de los tres
  términos, el bloque "por qué el aire es solo Android", el cómo pedir aire propio, y **las dos fórmulas
  muertas**; §6 (contratos de `FooterActionShell` / `BottomSheetShell`).
- `docs/plan-mejoras-2026-07-20.md` §U7 — nota de corrección reescrita: la fórmula de tres términos y el
  hecho de que **no cambia nada en iOS ni web**.
- `docs/plan-mejoras-ux-2026-07-18.md` — deuda del `+12` cerrada (aclarando que conservan su respiro por
  token) + la medida del nav en iPhone **sigue siendo 94px** (la nota anterior decía 110).
- `specs/active/03-modo-maniobras/design.md` — as-built del sheet de preconfig (el `$4` sobrevive como
  `floor`) y del `BottomSheetShell`.
- `.claude/skills/design-review/SKILL.md` — el bullet de safe areas ahora prescribe la fórmula correcta y
  nombra **los dos** errores a no repetir.
- `docs/backlog.md` — entrada nueva: `check.mjs` no cubre E2E + los 22 rojos pre-existentes (14 del
  fixture del tacto + **6 con el bug de oráculo `.first()`**, familia de `reference_e2e_sheet_no_nav_oracle`).

## Autorrevisión adversarial (paso 8) — del fix-loop

Lo del primer pase se conserva (call sites escapados, doble aire por anidamiento, rules of hooks,
acoplamiento del `StickStatusIndicator`, imports huérfanos, tests que pasan por la razón equivocada).
Lo que busqué **en este fix-loop**:

1. **¿Alguien pierde padding, en cualquier plataforma?** No confié en revisar a ojo los 41 sitios: escribí
   el verificador que extrae las fórmulas del baseline **mecánicamente** y compara las 4 plataformas.
   Encontró exactamente lo que el leader anticipaba y más: además de los 2 sheets con `$6`, perdían aire
   en iOS los **8 footers con `+12`** (46 → 34; son **8 call sites en 7 archivos** — `crear-rodeo` tiene
   dos: el wizard y el `OnboardingImportOffer`) y los **3 con `+$3`** (47 → 34), y perdían en **web** los
   2 sheets con `max(inset,$4)` (18 → 12). Los 15 se cerraron con `extra`/`floor` en el fix-loop 1.
   ⚠️ **Corregido en el fix-loop 2**: este informe decía "9 sitios / 7 archivos", que era un error de
   conteo (D1 del review) — y de esos 8, los que llevaban `extra: $navBottomMin` se revirtieron a la
   reserva canónica por decisión del fix-loop 2, así que el "0 pérdidas" de acá **ya no es el estado
   final**: los números vigentes son los de la sección «Paridad».
2. **Un bug en mi propio verificador.** La primera corrida reportaba "FindOrCreateOverlay: baseline 1 vs
   head 0" — mi stripper de comentarios borraba bloques con `/* … */` **antes** que los de línea, y el
   archivo tiene un comentario `//` que contiene la cadena `ble/*` → abría un bloque falso que se comía
   medio archivo, incluida la llamada al hook. Si no lo miraba, el verificador me daba un verde con un
   call site invisible. Corregido (línea primero, bloque después) y re-corrido: 41 sitios, no 39.
3. **El único término que ningún test podía cubrir.** El hook no es testeable con `node:test` (importa RN
   + tamagui). Si alguien pone `applyGap: true`, la aditiva-en-todas-las-plataformas vuelve **sin que
   caiga nada**. Agregué la regla 7 del guard (estática, sobre el fuente del hook) y la **falsifiqué**:
   con `applyGap: true` el test cae; restaurado, pasa. Doble red: la capture asserta 12px en web (con
   `true` daría 28).
4. **¿El guard quedó laxo al permitir `$navBottomMin` en call sites?** Verifiqué que el agujero real
   (`insets.bottom + getTokenValue('$navBottomMin')`) sigue cerrado por la regla 2 (token + inset en la
   misma línea) y lo probé en el contra-test con las dos variantes (`insets.bottom + $navBarGap` y
   `safeBottom + $navBottomMin`). Además `$navBottomMin` solo pasa si la línea contiene
   `useSafeBottomInset(`.
5. **Doble-conteo del `extra` con el piso.** El orden del `max` importa: `max(inset + extra, piso)` da 32
   en web para un `extra: 32`; `max(inset, piso) + extra` daría 44 (piso + aire propio = sumar dos veces
   el mismo concepto). Está testeado explícitamente ("no duplica el piso en web") y comentado en la pura.
6. **Casos borde del condicional.** Android **sin** barra (botones físicos, inset 0) → 12+16=28: es más
   aire del necesario, pero nunca menos, y gatear el aire por `inset > 0` acoplaría el aire a la magnitud
   del inset (peor). Android en landscape con la barra al costado (`bottom` 0) → mismo caso, inocuo.
   Documentado en el test.
7. **Imports huérfanos y unused locals.** `tsc --noUnusedLocals` sobre todo el árbol: 26 `TS6133`, **todos
   pre-existentes** — verificado símbolo por símbolo contra el baseline con conteo de ocurrencias
   (`router`, `white`, `primary`, `XStack`, `SequenceItem`, …: hits idénticos). Ninguno introducido acá.
   `(tabs)/_layout.tsx` quedó sin `useSafeAreaInsets`/`initialWindowMetrics` (ya no los usa).
8. **Comentarios que quedaron mintiendo.** Barrido de todas las menciones a "inset + aire" / "aditivo" /
   `$navBarGap` en `app/app` + `app/src`: 10 comentarios describían la fórmula descartada (en
   `export-sigsa`, `carga`, `paso`, `BottomSheetShell` ×3, `FooterActionShell` ×2, `StickStatusIndicator`
   ×2, `(tabs)/_layout` ×2). Todos corregidos. Un comentario que describe una fórmula muerta es una bomba
   de tiempo para el próximo que copie el patrón — que es literalmente cómo nació este bug.

## Autorrevisión adversarial (paso 8) — del FIX-LOOP 2

Lo de los dos pases anteriores se conserva. Lo que busqué **en este**:

1. **¿La armonización mueve web en algún lado?** No lo di por hecho: re-corrí el verificador mecánico y
   además agregué una **assertion de runtime sobre el DOM** de uno de los 8 footers (`crear-rodeo`,
   `paddingBottom === '12px'`). Web queda en 12, igual que el baseline. Si alguien re-introdujera el
   `extra`, ese assert daría 24 y la capture falla.
2. **¿Los `!!` que reporta el verificador son EXACTAMENTE los 8 esperados?** Sí: 8 líneas, todas iOS
   46→34, todas de los 7 archivos armonizados. Ni una pérdida en web, ni una en Android, ni una en un
   sitio que no tocara la decisión. Es el chequeo que reemplaza a la propiedad "0 pérdidas".
3. **¿La regla 4 endurecida caza de verdad, o la tapa otra regla?** Verificado que la regla 2 (token +
   inset en la misma línea) **no** ve `useSafeBottomInset({ extra: getTokenValue('$navBottomMin',…) })`
   —no hay inset en esa línea— y que la 4 la caza sola. Está asertado en el contra-test, no solo probado
   a mano: si mañana alguien relaja la 4 "porque total la 2 lo cubre", el contra-test cae.
4. **¿El guard nuevo (regla 8) puede fallar?** Falsificado con 4 mutaciones distintas (ver abajo), cada
   una atacando un eslabón distinto de la cadena: nombre del token, valor del token, grupo que pide el
   hook, y la constante hardcodeada del test puro. Las 4 en rojo con el mensaje correcto.
5. **¿Quedó algún comentario mintiendo después del fix-loop 2?** Barrido de `$navBottomMin` en
   `app/app` + `app/src`: los 8 comentarios de los call sites reescritos (ya no dicen "se conserva por
   token"), más el del hook y el de la pura, que siguen siendo correctos. En la capture file, el bloque
   del shot 06 decía "conserva ese respiro propio" → reescrito. Y el `getTokenValue` sigue usándose en
   los 7 archivos por otras razones (ícono/color/spacing), así que no quedaron imports huérfanos.
6. **¿La nota que yo mismo escribí en `specs/active/03` era verdad?** No lo era (bloqueante B1 del review,
   y con razón). La verifiqué en la fuente: `ManeuverConfigSheet.tsx:194` renderiza `<BottomSheetShell>`,
   y el shell pide `useSafeBottomInset()` **sin `floor`** (`BottomSheetShell.tsx:223`) → web **12**, no 18.
   El `max(insets.bottom, $4)` de la v4 quedó SUPERSEDED por la v7 (migración al shell), o sea que mi
   nota describía un as-built que no existe en ninguna versión del archivo. Los únicos dos `floor: $4`
   del repo son `DientesStep.tsx:131` y `TactoConfigSheet.tsx:155`, que **no** migraron al shell.
   **La lección que me llevo**: escribí esa nota derivando del *baseline del archivo que citaba la spec*
   en vez de leer el as-built vigente — el mismo error que la memoria `reference_function_recreate_base`
   describe para funciones de DB. Repasé por eso las otras notas de reconciliación que escribí (v7 del
   sheet, `docs/plan-mejoras-2026-07-20.md` §U7, `design-system.md` §4, `SKILL.md`) contra el archivo
   real: esas cuatro sí describen el as-built.

### Falsificación del guard (mutación → rojo → revertir → verde)

| # | mutación | resultado |
|---|---|---|
| M1 | reponer `{ extra: getTokenValue('$navBottomMin','size') }` en `lote/venta.tsx` | 🔴 regla 4, reporta `app/lote/venta.tsx:83` |
| M2 | `navBarGap` → `navBarGapp` en `tamagui.config.ts` | 🔴 regla 8: "el token `navBarGap` no está en el grupo `size`" |
| M3 | `navBarGap: 16` → `navBarGap: 0` | 🔴 regla 8: "tiene que ser un número finito > 0" |
| M4 | el hook pide `getTokenValue('$navBarGap', 'space')` | 🔴 regla 8: "el hook pide $navBarGap del grupo 'space' pero el token vive en 'size'" |
| M5 | `const GAP = 16` → `20` en `footer-action.test.ts` | 🔴 regla 8 (d): "hardcodea GAP = 20 pero $navBarGap vale 16" |

Control con el árbol restaurado: **10/10 verde**. Las mutaciones se hicieron con backup/restore de
archivo (`cp`), no con `git checkout` — ver el incidente más abajo.

## Reconciliación de specs y docs (paso 9) — del FIX-LOOP 2

| archivo | qué se reconcilió |
|---|---|
| `specs/active/03-modo-maniobras/design.md` (v4 del sheet de preconfig) | **B1**: la nota anterior (mía) afirmaba un as-built falso (`floor: $4`, web 18). Ahora dice que el `max(insets.bottom,$4)` de la v4 quedó **SUPERSEDED por la v7**, que la reserva la da el `BottomSheetShell` con `useSafeBottomInset()` sin `floor` (web 12 · iOS 34 · Android 40/64) y que los dos únicos `floor: $4` del repo son `DientesStep` y `TactoConfigSheet` — con un "no copiar de acá un `floor` que este sheet no tiene" |
| `specs/active/04-bluetooth-baston/design-multivendor.md` §7 | **B2**: el as-built del veto de Gate 2.5 decía `bottom = insets.bottom + $navBar + $fabRaise + $2`. Ahora registra `useSafeBottomInset() + …` **con el porqué**: con el inset pelado el borde del pill caía en 93 y el pico del FAB está en 98 → lo tapaba 5px; ahora 105 = 98 + `$2`, y sigue la reserva del nav por construcción |
| `docs/design-system.md` §4 | subsección nueva "**Los 8 outliers del `+12`**" (decisión, evidencia y números) + el knob se pide con token de **spacing**, nunca con `$navBottomMin` + el enunciado del guard actualizado con las reglas 4 endurecida y 8 (incluido el modo de falla que cierra) |
| `docs/plan-mejoras-ux-2026-07-18.md` §4 | **restaurado el texto original del baseline** ("en vez de usar `$navBottomMin`") — mi pase anterior lo había parafraseado a "en vez de usar el token", borrando justamente la palabra que después sirvió de evidencia. La nota de cierre ahora dice que el `+12` **se plegó** dentro de la canónica (que es lo que ese párrafo pedía), con los números |
| `app/e2e/captures/aire-safe-area.capture.ts` | cabecera y comentario del shot 06 al día + la 2ª assertion de runtime |
| `docs/backlog.md` | entrada nueva (**D3**): el comentario de `export-sigsa:335-336` dice que la lista scrollea "POR DETRÁS" del sticky CTA, pero la barra es un **hermano flex** debajo del `ScrollView` (`:344-345`). Ya era falso en el baseline → **no se arregló**, se registró |

**Lo que NO se tocó a propósito**: `requirements.md` de ninguna spec. Ni B1 ni B2 ni B3 cambian el *qué*
(qué tiene que pasar), solo el *cómo* y su registro — la armonización de los 8 outliers no altera ningún
EARS: la reserva inferior sigue siendo "una sola, canónica, que no deja el contenido pegado a la barra".

## Incidente de proceso (lo registro porque afecta qué revisar)

Durante la falsificación de M1 usé `git checkout -- <archivo>` para revertir una mutación. **Toda la
unidad está sin commitear** (HEAD = `5fc8848`, el baseline), así que ese comando no revirtió la mutación:
borró el trabajo de la unidad en `app/app/lote/venta.tsx` y en `app/tamagui.config.ts`, dejándolos en el
baseline. Reconstruidos a mano y **verificados por diff contra el baseline**:

- `app/tamagui.config.ts`: +23/−3 — los dos tokens del borde inferior con sus comentarios (`navBottomMin`
  con la explicación de piso, `navBarGap: 16` nuevo con el porqué por plataforma). Confirmado por la
  regla 8 del guard, que ahora lee ese archivo y falla si el token no está.
- `app/app/lote/venta.tsx`: +11/−3 — import del hook, el bloque de comentario, `const bottomPad =
  useSafeBottomInset()` y `paddingBottom={bottomPad}` en lugar de `insets.bottom + 12`.

Las mutaciones posteriores se hicieron con copia de respaldo del archivo. **Recomendación para el
reviewer**: mirar esos dos archivos con un poco más de atención que el resto del diff.

## Dudas / decisiones que dejo explícitas para el review

1. ~~**`{ extra }` con `$navBottomMin` en 9 footers**~~ — **CERRADA en el fix-loop 2**: eran 8 call sites
   (no 9) en 7 archivos, y no se conservan. Pasan a la reserva canónica pelada, con el fundamento
   documental del propio repo (ver arriba). La tercera opción que estaba sobre la mesa —cambiar el token
   a `$3` (13)— también queda descartada: hubiera mantenido la excepción, apenas con otro número.
2. **`computeTabBarInsetLayout` quedó casi vacío** (`{ height: navHeight + paddingBottom, paddingBottom }`).
   Se podría inlinear en `(tabs)/_layout.tsx`, pero conserva su nombre, su archivo y sus tests, y mantiene
   el contrato "el padding vive POR DEBAJO del contenido" bajo test. Lo dejé.
3. **Dos knobs (`extra` y `floor`)** para 7 de 41 call sites (eran 16 antes del fix-loop 2). Refleja que el
   repo tenía 5 spellings distintos de la misma idea. No los unifiqué a un solo knob porque
   `max(inset,$4)` y `inset + $6` son semánticamente distintos: colapsarlos habría inflado el sheet de
   tacto a 82dp en Android sin que nadie lo pidiera.
4. **El pill del bastón sube 12px en web** (93 → 105). Es la única diferencia de web contra el baseline y
   es intencional: alinea el pill con el `paddingBottom` REAL del nav en vez del inset pelado. Antes el
   pico del FAB (98) le pasaba por encima por 5px. En device iOS no cambia nada (127 → 127). Reconciliado
   en `specs/active/04-bluetooth-baston/design-multivendor.md` §7.
5. **`check.mjs` no corre la suite E2E** — confirmado por el leader, registrado en `docs/backlog.md`.

## Fuera de alcance (declarado)

- Los 4 `KeyboardAvoidingView` y la rama `keyboardVisible === true` de `resolveFooterPaddingBottom`:
  intactos (unidad siguiente, bug de teclado en Android).
- `paddingTop` / `insets.top`: no se tocó nada.
- El `paddingBottom` del `contentContainerStyle` de los scrolls (`insets.bottom + $6/$8/$10`): NO se
  convirtió. Es *slack* de contenido que scrollea, no algo apoyado en el borde de la pantalla; ya es
  aditivo y con más aire (24-32) que el canónico. Criterio escrito en `docs/design-system.md` §4 ("Qué NO
  lleva la reserva") y comentado en el call site donde convivían los dos casos (`crear-rodeo` →
  `OnboardingImportOffer`).
- Los 22 rojos E2E pre-existentes (14 del fixture del tacto + 6 del oráculo `.first()`): registrados en
  `docs/backlog.md`, **no arreglados** (instrucción explícita).
