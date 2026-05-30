# A.1 — Canonización del design system (lado código)

> Infraestructura/diseño incremental, NO una feature con spec (igual naturaleza que B.0 / los
> incrementos de la home). Cierra el item **A.1** del lado código:
> (1) des-provisionalizar `app/tamagui.config.ts` y (2) implementar el lint anti-hardcode de
> ADR-023 §4. NO se cambió ningún VALOR de token (la paleta/escala v4 ya está firmada vía la
> home + nav que Raf aprobó) — solo el framing "provisional" y el guardrail.

baseline_commit: 0d401b150723b8ce716197d86951252340896d8a

## Estado: COMPLETO — `node scripts/check.mjs` VERDE (typecheck + lint anti-hardcode + 28 tests backend).

> Nota sobre tests: igual que los otros incrementos de frontend (A.1 home, B.0), este es infra/
> diseño SIN spec (no hay R<n>). No hay runner de tests unitarios de UI en `app/`. El gate del lint
> ES su propio test: se verificó que (a) queda VERDE sobre el código actual, (b) FALLA ante un
> fixture con violaciones reales (hex, rgba, padding/marginTop crudos), (c) ignora comentarios y
> (d) respeta los disables justificados. Fixture creado y borrado (no quedó en el repo).

---

## Tarea 1 — des-provisionalizar `app/tamagui.config.ts`

Sin cambios de valores. Cambios de framing + tokens nuevos (todos derivados de literales que YA
existían en el código, no inventados):

- **Encabezado**: reemplazado "PROVISIONAL — se endurece al construir la home / base de trabajo,
  no contrato final" por: **fuente única canónica de tokens (ADR-023 §1)**, lectura humana =
  `docs/design-system.md`, valores = v4 canónico derivado de la home + nav (ADR-023 §5), crece JIT.
  Mención explícita al lint como garante.
- **`primaryPress`**: sacado el "(provisional)" del comentario (es el press canónico derivado).
- **`shadows`**: sacado el "PROVISIONAL: cuando se canonice se evalúa promover a sistema de
  elevación". Ahora: "objetos de estilo canónicos; dos niveles porque la home + el nav los
  necesitaron; más elevación se agrega JIT". Se agregó `shadows.fab` (ver Tarea 2).
- El comentario de `avatar`/`icon` ("Derivado al construir la home (A.1)") se dejó: describe la
  derivación canónica de ADR-023 §5, no provisionalidad.

### Tokens nuevos (para tokenizar literales que vivían en `(tabs)/_layout.tsx`)
Todos son la formalización de un literal o geometría que YA estaba en el código — cero cambio visual:

| Token | Grupo | Valor | Reemplaza al literal |
|---|---|---|---|
| `$fabHalo` (color) | color | `rgba(147, 207, 172, 0.45)` | el `backgroundColor="rgba(147, 207, 172, 0.45)"` del halo. Es `$greenLight` (#93cfac) @ 45% — atado por comentario a `greenLight`. RN no deriva alpha de un token, así que la rgba se escribe en el config (única fuente). |
| `$fabHaloInset` | size | `8` = (fabHalo−fab)/2 | el inset `-8` del anillo (top/left/right/bottom). La pantalla aplica `-$fabHaloInset`. Geometría DERIVADA, no literal suelto. |
| `$navIcon` | size | `24` | el `size={24}` de los 4 íconos lucide del nav (Home/PawPrint/BarChart3/Menu). |
| `$fabIcon` | size | `28` | el `size={28}` del ⚡ (Zap) del FAB. |
| `$navLabel` | size | `11` (= font.size.$1) | el `fontSize: 11` de `tabBarLabelStyle` (API React Navigation). |
| `$navItemTop` | size | `2` | el `paddingTop: 2` de `tabBarItemStyle`. |
| `shadows.fab` | objeto | shadowColor `$primary`, offset (0,4), opacity 0.3, radius 8, elevation 6 | la sombra inline del Pressable del FAB (idéntica). |

`docs/design-system.md` NO se tocó: ya documenta los tokens base como canónicos; los nuevos son
detalle de nav que el doc cubre conceptualmente (halo del FAB en §2/§4) — si Raf quiere, se agregan
filas, pero no era el scope (la tarea pidió des-provisionalizar el CONFIG, no reescribir el doc).

## Tarea 2 — lint anti-hardcode (ADR-023 §4)

`app/` NO tiene ESLint montado (no hay `.eslintrc`/`eslint.config.*` ni binario), así que el
mecanismo es un **script dedicado**: `scripts/check-hardcode.mjs`, invocado desde `scripts/check.mjs`
(sección "2c. Lint anti-hardcode"). Falla el check (exit 1) ante cualquier violación.

### Cómo se corre
- Standalone: `node scripts/check-hardcode.mjs` (exit 0 verde / 1 con el listado de violaciones).
- Integrado: `node scripts/check.mjs` lo corre en la sección **2c** (antes de los tests); una
  violación pone `exitCode=1` y tira abajo todo el check del harness.

### Qué marca (cubre `app/app/**` + `app/src/components/**`, `.ts`/`.tsx`)
1. **Literales de color** (`#hex` de 3–8, `rgb()/rgba()/hsl()/hsla()`) en props de color
   (`color`, `backgroundColor`, `borderColor`, `shadowColor`, …) **y** sueltos en cualquier objeto
   de estilo (red de seguridad anti falso-negativo).
2. **Números crudos** en props de color/spacing con escala de token: `padding*`, `margin*`, `gap`,
   insets `top/left/right/bottom`, `borderRadius`, `fontSize`, `lineHeight`. Deben venir de un token
   (`"$4"`) o de `getTokenValue` para APIs no-Tamagui.

### Qué NO marca (a propósito, para que sea guardrail real y no ruido)
- Props sin token semántico ni equivalente en la escala: `borderWidth` (hairlines 1/2px),
  `width`/`height` (geometría libre o derivada de tokens, ej. `width={avatarSize}`),
  `letterSpacing` (tracking tipográfico, sin token), `flex`, `zIndex`, `opacity`, `strokeWidth` y
  `size` de íconos lucide (API no-Tamagui), `numberOfLines`, `hitSlop`.
- **Comentarios**: se blanquean antes de escanear (preservando nº de línea) con un mini-tokenizer
  que respeta strings/templates → una mención textual a `#fff` o `-8` en una nota NO dispara falso
  positivo. (Verificado con fixture.)

### Excepción acotada (no disable de archivo entero)
`// design-lint-disable-next-line -- <razón>` (línea anterior) o
`// design-lint-disable-line -- <razón>` (misma línea). Verificado que ambos suprimen. **No se usó
ninguno en el código actual**: todo lo que el lint marcaba se pudo tokenizar limpio.

## Violaciones encontradas en el código actual y cómo quedaron

Corrida inicial del lint sobre el código pre-existente → **8 violaciones**, todas TOKENIZADAS
(0 excepciones/disables):

| # | Archivo | Literal | Resolución |
|---|---|---|---|
| 1 | `(tabs)/_layout.tsx` | `backgroundColor="rgba(147, 207, 172, 0.45)"` (halo) | → `backgroundColor="$fabHalo"` (token de color = mismo rgba exacto) |
| 2–5 | `(tabs)/_layout.tsx`, `index.tsx` ×2, `Stepper.tsx` | `borderRadius={9999}` (círculos) | → `borderRadius="$pill"` (token radius = 9999, idéntico) |
| 6 | `(tabs)/_layout.tsx` | inset `top/left/right/bottom={-8}` del halo | → `-COLOR.fabHaloInset` (`getTokenValue('$fabHaloInset','size')` = 8, geometría derivada) |
| 7 | `(tabs)/_layout.tsx` | `fontSize: 11` en `tabBarLabelStyle` | → `COLOR.navLabel` (`$navLabel`=11) |
| 8 | `(tabs)/_layout.tsx` | `paddingTop: 2` en `tabBarItemStyle` | → `COLOR.navItemTop` (`$navItemTop`=2) |

Además se tokenizaron (no las marcaba el lint por ser API no-Tamagui, pero se hizo por coherencia
y para borrar literales del nav): `size={24}` ×4 → `COLOR.navIcon`; `size={28}` (Zap) →
`COLOR.fabIcon`; y la **sombra inline del FAB** (5 props raw: shadowColor/Offset/Opacity/Radius/
elevation) → `...shadows.fab`.

### Visual-neutralidad (verificado por mapeo de valores, no por adivinar)
Todos los reemplazos son byte-idénticos al valor previo:
- `$fabHalo` = `rgba(147, 207, 172, 0.45)` (literal exacto movido al config).
- `$pill` = 9999 (= el literal `9999`).
- `$fabHaloInset` = (80−64)/2 = 8 → `-8` (idéntico).
- `$navLabel`=11, `$navItemTop`=2, `$navIcon`=24, `$fabIcon`=28 (= los literales).
- `shadows.fab` = mismos shadowColor `$primary` / offset (0,4) / opacity 0.3 / radius 8 / elevation 6.

No hay cambio de render del nav/home (refactor visual-neutro). No se tocó ningún valor de paleta/escala.

## Verificación (todo verde)

| Check | Resultado |
|---|---|
| `node scripts/check-hardcode.mjs` (standalone) | **VERDE** — 0 violaciones |
| Fixture con violaciones reales (hex, rgba, padding/marginTop crudos) | **FALLA** correctamente (4 detectadas) + comentarios ignorados + disables respetados |
| `cd app && pnpm.cmd typecheck` | **VERDE** (tsc --noEmit) — los nuevos tokens tipan y se leen con getTokenValue |
| `node scripts/check.mjs` (root) | **VERDE** — sección 2c lint OK + typecheck cliente + RLS/Edge/Animal 28/28 (backend intacto) |

## Archivos tocados
- `app/tamagui.config.ts` — des-provisionalizado + 6 tokens nuevos + `shadows.fab` (sin cambiar valores existentes).
- `app/app/(tabs)/_layout.tsx` — tokenizado (halo color/inset, icon sizes, label font, item pad, sombra FAB).
- `app/app/(tabs)/index.tsx` — `borderRadius={9999}` ×2 → `"$pill"`.
- `app/src/components/Stepper.tsx` — `borderRadius={9999}` → `"$pill"` + comentario de exenciones actualizado.
- `scripts/check-hardcode.mjs` — NUEVO, el lint.
- `scripts/check.mjs` — invoca el lint en la sección 2c.

## Fuera de scope (no tocado)
- Valores de tokens (paleta/escala v4) — INTACTOS por consigna.
- `docs/design-system.md` — ya canónico; no requería cambios (la tarea pedía des-provisionalizar el config).
- Backend / migrations / supabase/ — INTACTO.
- Marcar A.1 como `done` — lo hace el reviewer, no el implementer.

---

## Addendum — Fix de contraste WCAG (3 tokens de color)

> Cambio **value-only** decidido por el leader con medición WCAG. A diferencia del resto de A.1
> (que NO tocó valores), este sí ajusta 3 hexes de la `palette` para subir el contraste a AA.
> Layout idéntico — solo cambia el color de 3 tokens. El doc canónico `docs/design-system.md` ya
> fue actualizado con estos hexes + la nota de contraste (coherencia hecha por el leader).

### Cambios EXACTOS en `app/tamagui.config.ts` (objeto `palette`) — únicos 3

| Token | Antes | Después | Contraste sobre `$bg` (#faf9f9) | Notas |
|---|---|---|---|---|
| `textMuted` | `#707972` | `#5C655F` | 4.28 → **5.74** (AA holgado) | sun-safe; oscurecido del mismo gris verdoso. Es el color de labels secundarios **y de los items inactivos del nav que Raf firmó**. |
| `textFaint` | `#A8A29D` | `#807A74` | 2.40 ❌ → **4.03** (AA-large) | pasa a ser token **terciario** (antes no alcanzaba ni AA-large). |
| `terracota` | `#c84a2c` | `#C0451F` | 4.47 → **4.86** (AA) | sigue siendo terracota (alertas / tertiary). |

El grupo `color` de `createTokens` referencia `palette.*` (no duplica literales), así que cambiar la
`palette` propaga al token consumido como `$textMuted` / `$textFaint` / `$terracota`. **Cero cambio de
layout**: las props que usan estos tokens (color de texto/íconos) no afectan geometría.

### Re-vet del render (skill `design-review` §tubería — render FIEL, no asumido)

El cambio toca el **nav firmado** (`textMuted` = items inactivos), así que se VERIFICÓ visualmente:

- **Tubería**: `npx expo export --platform web` → server estático local (`python -m http.server 8099`)
  → captura con **CDP `Emulation.setDeviceMetricsOverride`** (412px, deviceScaleFactor 2, mobile) vía
  cliente DevTools raw sobre `ws` (NO `--window-size`, que da falso recorte). Chrome headless `--headless=new`.
- **Captura**: `design/stitch-iter-4/nav-contrast-fix.png` (home renderizada fiel: header "La Juanita" /
  "¡Hola Lucas!", banner establecimiento, onboarding 3 pasos, bottom-nav con FAB).
- **Veredicto del vet** (los 3 objetivos, confirmados mirando la captura):
  - **(a) Items inactivos del nav siguen leyéndose como inactivos** ✅ — "Animales/Maniobra/Reportes/Más"
    en gris `$textMuted` nuevo, más oscuros/legibles que antes pero claramente subordinados al verde
    `$primary` del activo ("Inicio"). Sin tinte verde, sin peso extra: no se confunden con activo.
  - **(b) El resto del home no se afeó** ✅ — body copy secundario (descripciones de los pasos) un poco
    más oscuro = mejor legibilidad, sigue subordinado a los títulos negros (`$textPrimary`). Números de
    paso "2"/"3" y bordes muted (`$textFaint`) legibles, sin dureza. CTA verde y headings intactos.
  - **(c) Sin overflow** ✅ — todo el home entra en el viewport (915px alto), sin recorte ni scroll horizontal.
- **Limpieza**: `http.server` (PID matado), Chrome headless (SIGKILL en el `finally` del script),
  script efímero `cdp-capture.mjs` borrado, `dist-web/` y user-data-dirs temporales borrados. Nada colgado.

### Verificación

| Check | Resultado |
|---|---|
| `node scripts/check.mjs` | **VERDE** — lint anti-hardcode (0 violaciones; estos son valores del config, permitidos) + typecheck client + 28/28 tests backend |

### Archivos tocados (este addendum)
- `app/tamagui.config.ts` — 3 hexes de la `palette` (`textMuted`, `textFaint`, `terracota`). Nada más.
- `design/stitch-iter-4/nav-contrast-fix.png` — NUEVO, captura del re-vet.
