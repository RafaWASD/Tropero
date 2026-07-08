# RAFAQ Design System — v4 (canónico)

**Status**: Activo (canonizado 2026-05-30, sesión 20). Cierra el item **A.1** del plan.
**Reemplaza**: el draft exploratorio "Campo Profundo" (archivado en `design/explorations/`, NO canónico).
**Fuente única de verdad**: **`app/tamagui.config.ts`** (ADR-023 §1). Este documento es la **lectura humana** de ese archivo — si hay conflicto, gana el código. Los valores literales (hex/px) viven SOLO en el config; las pantallas los consumen por token, nunca hardcodeados (ADR-023 §4, enforced por lint).

> **Cómo se canonizó**: este sistema se **derivó de construir una pantalla real** (la home + el bottom nav, que Raf firmó), no en abstracto (ADR-023 §5). Lo que está acá es lo que esas pantallas necesitaron. Crece **JIT**: cuando una pantalla nueva necesite un token/componente que no existe, se agrega entonces — no se inventa por adelantado.

---

## 1. Principios

1. **Verdad en código.** `tamagui.config.ts` define los tokens. `docs/design-system.md` (esto) los documenta. `design/tokens.json` paralelo **no existe** a propósito (sería una 2da fuente a mantener; si en el futuro se sincroniza con Figma, se genera desde el config).
2. **Cero hardcode en pantallas.** Todo color/spacing/tamaño referencia un token (`$primary`, `$4`, `borderRadius="$card"`). Valores que cruzan a APIs no-Tamagui (React Navigation, íconos lucide) se leen con `getTokenValue('$token', grupo)` — siguen referenciando el token, no son literales. Un **lint** falla el build ante hex/px literal en pantallas.
3. **Light-only en MVP.** El dark mode se difiere a post-MVP (decisión sesión 19). El sistema está arquitecturado light; cuando se agregue dark, los tokens semánticos absorben el theme sin tocar pantallas.
4. **Manga-criticidad graduada.** Aplicar el sistema NO es uniforme: en flujos **manga-only** (MODO MANIOBRAS, BUSCAR ANIMAL, campo) los targets/fonts grandes y "una decisión por pantalla" son **no negociables**; en pantallas **mixtas** (home, reportes, config) hay más margen. Detalle + criterios pro en la skill **`design-review`**.
5. **Componentes = deliverable** (ADR-023). Una pantalla es composición de componentes ya correctos (`app/src/components/`), no un acto de diseño. Eso mata el drift visual por construcción.

---

## 2. Color (paleta v4)

Base **blanco neutro** (sin tinte frío ni cálido — se mató el `#f8f9ff` de Material You de Stitch). Brand verde botella. Acento terracota reservado para alertas.

| Token | Hex | Rol / uso |
|---|---|---|
| `$white` | `#FFFFFF` | blanco puro (superficies sobre fondo, nav bar) |
| `$bg` | `#faf9f9` | fondo base de la app (neutro) |
| `$primary` | `#1e5a3e` | **verde botella** — brand, FAB, item activo del nav, CTA primario |
| `$primaryPress` | `#184a33` | estado pressed del primary (derivado) |
| `$surface` | `#F8F6F1` | **bone** — superficie de cards (cálido, SOLO cards) |
| `$terracota` | `#C0451F` | **alertas / tertiary** — reservado; no usar en headers/cards/elementos pasivos |
| `$greenLight` | `#93cfac` | verde claro — contenedores de ícono, halo del FAB |
| `$textPrimary` | `#0F0E0C` | texto principal (casi-negro de marca, no `#000` puro) |
| `$textMuted` | `#5C655F` | texto secundario, labels, items inactivos del nav, **placeholders** |
| `$textFaint` | `#807A74` | texto **terciario** — captions/metadata grandes (≥14px) y disabled/decorativo; **NO** para texto esencial chico ni placeholders |
| `$divider` | `#E5E5E3` | líneas/bordes sutiles |

**Contraste (medido, WCAG — sesión 20):** texto principal y marca en **AAA** (`$textPrimary` 18:1, `$primary` 7.7:1, blanco sobre `$primary` 8:1). Los grises y el terracota se **recalibraron a AA holgado** pensando en legibilidad bajo sol de manga (el glare baja el contraste efectivo): `$textMuted` 5.7:1, `$terracota` 4.9:1. `$textFaint` (4:1, AA-large) es **terciario**: solo captions grandes / disabled / decorativo, nunca texto esencial chico ni placeholders (esos usan `$textMuted`). **Regla**: al agregar un token de color, **medir** el contraste contra `$bg`/`$surface`/`$white` (no estimar a ojo) — skill `design-review`.

**Colores de estado (success / warning / error)** → **JIT**: el v4 todavía no los define (la home/nav no los necesitaron). Se agregan cuando se construya la **primera pantalla con chips de estado** (ej. ficha de animal con "preñada"/"vencido"). Insumo para esa decisión: la paleta de estado del draft archivado (`design/explorations/`). Por ahora, alertas puntuales usan `$terracota`.

### 2.1 Botones/chips de realce verde — regla A/B (legibilidad al sol) — canonizado 2026-07-07

`$greenLight` (#93cfac) es, por rol, **fondo de contenedores de ícono y halos** (ver tabla) — un ícono lucide `$primary` encima pasa el **3:1** de objetos gráficos (WCAG 1.4.11) y se lee bien. **NO es, por default, un fondo para TEXTO.** El combo **texto `$primary` (#1e5a3e) sobre `$greenLight` mide 4.55:1** (medido) — al filo de AA y **se vuelve ilegible al sol** (el glare de manga baja el contraste efectivo ~a la mitad). Ese combo se coló en varios botones/chips con texto (drift del rol documentado).

**Regla (para cualquier botón/chip de realce VERDE con TEXTO):**

| | Recipe | Contraste | Cuándo |
|---|---|---|---|
| **A — sólido / alto contraste** | fondo `$primary` + **texto e ícono `$white`** | **8:1** (AAA) | **En modo maniobra** (`app/maniobra/**`) y todo botón verde manga-crítico que deba destacar. Es la misma polaridad del CTA primario (`Guardar evento`). |
| **B — suave** | fondo `$greenLight` + **texto `$textPrimary`** (#0F0E0C casi-negro); el ícono puede quedar `$primary` (gráfico, pasa 3:1) o ir `$textPrimary` | **10.8:1** (texto, AAA) | **Fuera de modo maniobra**. Conserva el look "pill suave / afordancia secundaria" sin sacrificar legibilidad (no compite con el CTA de commit). |

❌ **Prohibido**: texto esencial `$primary` sobre `$greenLight` (4.55:1). ✅ Sigue OK: `$greenLight` como **container de ícono / halo / pulso / pressStyle transitorio** (sin texto encima). Ambas recetas usan **tokens existentes** (sin hex nuevo). Al elegir, guiarse por la **criticidad-manga graduada** (§1.4): maniobra = A, resto = B. Validar lo dudoso con **APCA** (Chrome DevTools) + prueba real al sol, no solo el ratio WCAG.

---

## 3. Tipografía

**Familia única: Inter** (400/500/600/700). Se carga en `app/app/_layout.tsx` (`useFonts`) bajo `Inter`, `Inter-Medium`, `Inter-SemiBold`, `Inter-Bold`. No serifs.

**Escala** (token de tamaño → px / line-height), pensada para legibilidad mobile bajo sol (body más grande que el web típico):

| Token | px | line-height | uso típico |
|---|---|---|---|
| `$1` | 11 | 16 | micro-labels (nav inactivo, captions) |
| `$2` | 12 | 17 | labels, el label "Maniobra" del FAB |
| `$3` | 13 | 18 | metadata, texto secundario |
| `$4` | 14 | 20 | **body base** (`true`) |
| `$5` | 16 | 22 | body grande, inputs |
| `$6` | 18 | 25 | subtítulos, títulos de card |
| `$7` | 20 | 28 | títulos de sección |
| `$8` | 23 | 31 | headings |
| `$9` | 30 | 38 | display |
| `$10` | 38 | 46 | display grande / hero numbers |

**Pesos**: `400` body · `500` labels · `600` subtítulos / títulos de card · `700` display / headlines.

---

## 4. Spacing, radius y tamaños

**Spacing**: se usa la **escala default de `@tamagui/config/v4`** (heredada, no se override). Las pantallas usan `$1`, `$2`, `$3`, `$4`… El mapeo px exacto vive en el config de Tamagui; la convención de uso: padding de cards/pantallas ≈ `$4`, gap entre secciones mayor.

**Radius** (custom RAFAQ sobre la escala v4):

| Token | px | uso |
|---|---|---|
| `$card` | 16 | radio de cards |
| `$pill` | 9999 | botones pill (CTA primarios), avatares |

**Tamaños / touch targets** (manga-friendly — más grandes que el web/MP típico, uso con guante; Fitts):

| Token | px | uso |
|---|---|---|
| `$touchMin` | 56 | alto mínimo de botones primarios |
| `$navBar` | 60 | alto de contenido del bottom-nav (sin insets) |
| `$navBottomMin` | 12 | margen inferior mínimo del nav cuando `insets.bottom = 0` |
| `$fab` | 64 | diámetro del FAB central (ADR-018) |
| `$fabHalo` | 80 | diámetro del halo del FAB (`fab + 16`, referencia del inset -8) |
| `$fabRaise` | 35 | cuánto FLOTA el FAB sobre la barra (`fab × 0.55`) |
| `$avatar` | 40 | avatar de usuario en el header |
| `$icon` | 48 | contenedores de ícono circulares (banner, etc.) |

**Safe areas**: respetar insets siempre — patrón `paddingBottom = max(insets.bottom, $navBottomMin)`. Nada tocable/importante bajo el home indicator (iOS ≈34px) ni la gesture bar (Android).

**Invariante de centrado robusto (ADR-027)**: contenido que se quiere **centrado** respecto a su contenedor debe centrarse sobre el **ancho REAL** del contenedor — las **decoraciones laterales** (radio/check/ícono/badge/chevron) **NO consumen** el espacio de centrado, o corren el contenido y lo desalinean vs las filas hermanas sin decoración (bug recurrente, ya parchado ad-hoc 2 veces antes de canonizarse). Mecanismo: **slots laterales de ancho IGUAL** a ambos lados (primitiva `CenteredRow`, §6). Corolarios: (a) una decoración **condicional** (un check que aparece solo si seleccionado) reserva su **slot SIEMPRE**, también cuando no se muestra, para que togglear no recorra el layout; (b) un ícono **ligado al label** (leading de un CTA, ej. `+ Dar de alta`) se centra como **grupo** ícono+label — eso NO es este invariante y no se "arregla". Para texto corto de ancho fijo (ej. título de header con back) se acepta `position: absolute` en la decoración si no hay riesgo de overlap.

---

## 5. Elevación

Tamagui v4 no expone tokens de sombra escalares, así que la elevación vive como **objeto de estilo exportado** desde `tamagui.config.ts` (`shadows.card`) — las pantallas lo importan, no lo hardcodean:

- `shadows.card`: sombra suave para cards. Color `$textPrimary` (negro de marca, no `#000`), offset `(0, 2)`, opacity `0.06`, radius `12`, `elevation: 2` (Android).

Cuando haga falta más de un nivel de elevación, se promueve a un sistema (`elevation.1/2/3`) — JIT.

---

## 6. Componentes (librería)

La librería vive en `app/src/components/` y es el deliverable real (ADR-023). Construidos hasta ahora (derivados de la home):

- **`Button`** — CTA. Variantes según necesidad; primario = `$primary`, alto ≥ `$touchMin`, radio `$pill`.
- **`Card`** — superficie `$surface` (bone), radio `$card`, `shadows.card`.
- **`Stepper`** — wizard de pasos (riel + estados).
- **`CenteredRow`** — fila con contenido **centrado robusto** a decoraciones laterales (ADR-027). Slots `left`/`right` de ancho IGUAL (`sideWidth`) → el centro nunca se corre aunque solo un lado tenga decoración, y reserva el slot de decoraciones condicionales. Usar siempre que haya contenido centrado conviviendo (o que pueda convivir) con un ícono/check/radio/badge a un costado.
- **Bottom nav** (`app/app/(tabs)/_layout.tsx`) — 5 items + FAB central elevado (ADR-018). Firmado por Raf.

Crece JIT: cuando una pantalla necesite `FormField`, `ListRow`, `Chip`, etc., se construye el componente (no se compone la pantalla con primitivos sueltos).

---

## 7. Diferido a post-MVP

- **Dark mode** — arquitectura dual-theme. El sistema está listo para absorberlo vía tokens semánticos sin tocar pantallas. Insumo: la paleta dark del draft archivado.
- **Colores de estado** (success/warning/error) — JIT, primera pantalla con chips.
- **`design/tokens.json` para Figma/Tokens-Studio** — no se mantiene (ADR-023 jubiló el handoff con Figma; código = fuente). El workflow viejo en `docs/setup-frontend.md` quedó histórico.

---

## 8. Relación con otros ADRs

- **ADR-023** (workflow de diseño): este doc es el artefacto canónico downstream que ese ADR anticipa.
- **ADR-018** (bottom nav): consume estos tokens (`$fab`, `$fabRaise`, `$navBar`…).
- **ADR-013/ADR-002** (stack): Tamagui v2 + Expo. La config monta la paleta brand + Inter sobre `@tamagui/config/v4`.
- **Skill `design-review`**: criterios pro (Nielsen, Laws of UX, mobile/HIG, composición) + la criticidad-manga graduada + la tubería de preview fiel (CDP) para vetear diseño contra este sistema.
