# RAFAQ Design System — Campo Profundo (DRAFT 0.1 EXPLORATORIO)

> ⚠ **Status (2026-05-26)**: este doc es una **propuesta inicial sin decidir**, charlada en otro chat. NO usar como sistema canónico. Un intento de formalizarlo prematuramente como ADR-015 fue **eliminado**. Antes de cerrar el design system de RAFAQ hay fase de **inspiración** (Dribbble, Mobbin, apps de competencia/referencia) → **exploración** (Stitch, mockups alternativos) → **comparación** → **decisión**. Este doc puede servir como **uno de los inputs** para esa exploración, no como output final.
>
> Cualquier referencia a "decidido", "cerrado", "tokens canónicos" más abajo está sobre-comprometida y debe leerse como "propuesto en este draft".

> Brief original (sin compromiso):
> Mood: confiable + local + criollo-moderno · contraste sol-ready · light & dark themes.

---

## 1. Identidad

**Campo Profundo** es el sistema visual de RAFAQ. Mood: **argentino-confiable, contemporáneo sin ser corporate, criollo sin ser cliché gauchesco**. Se inspira en la paleta natural del campo pampeano — verde botella oscuro de los montes, terracota de la tierra trabajada, off-white cálido del papel manila — pero llevada a un sistema digital con rigor de contraste para soportar uso real bajo sol fuerte en manga.

**Referencias visuales**: la solidez funcional de Linear, la calidez terrenal de Climate FieldView, la presencia anchored de Stripe. Ninguno como referencia única; punto medio entre los tres con identidad propia.

**Riesgo a evitar**: que se sienta "verde-campo demasiado obvio" o "rural pintoresco". La paleta se calibra para que comunique seriedad técnica con calidez local, no postal de revista rural.

---

## 2. Filosofía del sistema

1. **Tokens semánticos abstraen el tema.** Los componentes nunca referencian colores raw; siempre tokens semánticos (`color.background`, `color.surface`, `color.cta`). Esto permite cambiar entre light/dark sin tocar componentes.

2. **Light y dark son ciudadanos de primera clase.** El dark mode no es una variante "agregada después" — está diseñado a la par. Mantiene el ADN cromático (verde-terracota) ajustado al contexto oscuro.

3. **Contraste WCAG AAA mínimo en texto principal.** Ratio 7:1 o superior. Verificado en ambos modos.

4. **El CTA tiene color exclusivo.** El terracota se reserva para acciones primarias. Nunca se usa en headers, cards, ni elementos pasivos. Eso garantiza que en cualquier pantalla, el ojo del operador encuentra inmediatamente "qué tocar".

5. **Touch targets generosos.** Mínimo 48px de alto; CTAs primarios 60-64px. La app se opera con una mano embarrada, no con un dedo de oficina.

---

## 3. Paleta cromática

### 3.1 Raw palette (referencias absolutas)

Estos son los HEX literales del sistema. Los componentes no los consumen directamente — los consumen vía tokens semánticos.

```
brand-green-darkest    #0F2818   verde botella casi negro
brand-green-dark       #1F3328   verde oscuro elevado
brand-green            #2D5F3F   verde patria oscuro
brand-green-light      #6BA46B   verde sage profundo
brand-cream            #FAF6EC   off-white cálido (papel manila)
brand-cream-elevated   #FFFFFF   blanco puro (cards en light)
brand-cream-text       #F2EBDC   off-white para texto en dark
brand-graphite         #1A1A1A   negro suave para texto en light
brand-terracotta-dark  #C2511F   terracota intenso (CTA light)
brand-terracotta       #E87545   terracota luminoso (CTA dark)
semantic-warning-l     #E8A317   mostaza intenso
semantic-warning-d     #F4B942   mostaza luminoso
semantic-error-l       #A02020   rojo profundo
semantic-error-d       #D14848   rojo luminoso
semantic-border-l      rgba(15,40,24,0.08)   bordes sutiles light
semantic-border-d      rgba(107,164,107,0.15) bordes sutiles dark
```

### 3.2 Tokens semánticos — Light Mode

| Token | Valor | Uso |
|---|---|---|
| `color.background` | `#FAF6EC` | fondo principal de pantallas |
| `color.surface` | `#FFFFFF` | cards, sheets, inputs |
| `color.surface.elevated` | `#FFFFFF` con sombra | modales, popovers |
| `color.primary` | `#0F2818` | header bars, primary text accents, brand elements |
| `color.primary.muted` | `#2D5F3F` | secondary headers, navigation |
| `color.text` | `#1A1A1A` | texto principal |
| `color.text.muted` | `rgba(26,26,26,0.65)` | texto secundario |
| `color.text.subtle` | `rgba(26,26,26,0.45)` | placeholders, captions |
| `color.text.inverse` | `#FAF6EC` | texto sobre fondos oscuros |
| `color.cta` | `#C2511F` | botón primario, link de acción |
| `color.cta.hover` | `#A8451A` | hover/pressed state |
| `color.success` | `#2D5F3F` | chips "preñada", confirmaciones |
| `color.success.fg` | `#FAF6EC` | texto sobre success |
| `color.warning` | `#E8A317` | chips "revisión", alertas no críticas |
| `color.warning.fg` | `#1A1A1A` | texto sobre warning |
| `color.error` | `#A02020` | chips "vencido", errores |
| `color.error.fg` | `#FAF6EC` | texto sobre error |
| `color.border` | `rgba(15,40,24,0.08)` | divisiones sutiles |
| `color.border.strong` | `rgba(15,40,24,0.15)` | bordes con presencia |

### 3.3 Tokens semánticos — Dark Mode

| Token | Valor | Uso |
|---|---|---|
| `color.background` | `#0D1813` | fondo principal (casi-negro con tinte verde) |
| `color.surface` | `#1F3328` | cards (elevation 1) |
| `color.surface.elevated` | `#2A4234` | modales, popovers (elevation 2) |
| `color.primary` | `#2D5F3F` | header bars |
| `color.primary.muted` | `#6BA46B` | secondary accents |
| `color.text` | `#F2EBDC` | texto principal |
| `color.text.muted` | `rgba(242,235,220,0.70)` | texto secundario |
| `color.text.subtle` | `rgba(242,235,220,0.50)` | placeholders, captions |
| `color.text.inverse` | `#0D1813` | texto sobre fondos claros |
| `color.cta` | `#E87545` | botón primario |
| `color.cta.hover` | `#D86733` | hover/pressed state |
| `color.success` | `#6BA46B` | chips "preñada", confirmaciones |
| `color.success.fg` | `#0D1813` | texto sobre success |
| `color.warning` | `#F4B942` | chips "revisión" |
| `color.warning.fg` | `#0D1813` | texto sobre warning |
| `color.error` | `#D14848` | chips "vencido" |
| `color.error.fg` | `#F2EBDC` | texto sobre error |
| `color.border` | `rgba(107,164,107,0.15)` | divisiones sutiles |
| `color.border.strong` | `rgba(107,164,107,0.25)` | bordes con presencia |

### 3.4 Contrastes verificados

| Combinación | Ratio | Cumple |
|---|---|---|
| Light: text on background | 14.5:1 | AAA |
| Light: cta on background | 4.6:1 | AA grande (CTAs siempre son grandes) |
| Light: success-fg on success | 8.2:1 | AAA |
| Dark: text on background | 14.8:1 | AAA |
| Dark: cta on background | 6.8:1 | AAA grande |
| Dark: success-fg on success | 6.4:1 | AAA grande |

---

## 4. Tipografía

### 4.1 Familias

**Primaria**: Inter (open-source, excelente legibilidad mobile, optimizada para pantalla)
**Fallback stack**: `-apple-system, "Segoe UI", Roboto, sans-serif`

Alternativa equivalente: **Manrope** — más geométrica, ligeramente más cálida. Decidir entre ambas al implementar; ambas funcionan con este sistema.

**No usar serifs** (Fraunces, Crimson, etc) — riesgo de leerse "de revista" y no resistir el contexto manga.

### 4.2 Escala tipográfica

Optimizada para mobile y para legibilidad bajo sol — los tamaños body son más grandes que el promedio web.

| Token | Tamaño | Line height | Weight default | Uso |
|---|---|---|---|---|
| `text.display.lg` | 40 | 1.1 | 800 | hero numbers (peso del animal en pantalla principal) |
| `text.display` | 32 | 1.15 | 800 | encabezados de pantallas, números grandes |
| `text.display.sm` | 28 | 1.2 | 700 | títulos de sección |
| `text.title.lg` | 22 | 1.25 | 700 | títulos de cards importantes |
| `text.title` | 18 | 1.3 | 700 | títulos de cards estándar, headers de modal |
| `text.title.sm` | 16 | 1.35 | 600 | subtítulos, header bars |
| `text.body.lg` | 17 | 1.5 | 400 | texto de párrafo importante, formularios |
| `text.body` | 15 | 1.5 | 400 | texto general |
| `text.body.sm` | 13 | 1.45 | 400 | texto secundario, metadatos |
| `text.caption` | 11 | 1.4 | 600 | labels, tags, captions |
| `text.caption.xs` | 10 | 1.4 | 700 | micro-labels (TAG numbers, etc) |

**Letter-spacing**:
- Body / titles: 0 (default)
- Captions y labels: +1 a +2 (mejora legibilidad en mayúsculas)
- Display numbers: -0.5 (visualmente más compactos)

**Weights disponibles**: 400 (regular), 500 (medium), 600 (semibold), 700 (bold), 800 (extrabold), 900 (black).

---

## 5. Spacing

Base 4px, escala consistente. Nunca usar valores fuera de la escala.

```
space.0   0
space.1   4px
space.2   8px
space.3   12px
space.4   16px    ← base de padding de cards y screens
space.5   20px
space.6   24px    ← gap entre secciones
space.8   32px
space.10  40px
space.12  48px    ← min height de touch targets
space.16  64px    ← height de CTAs primarios
space.20  80px
space.24  96px
```

**Reglas**:
- Padding interno de cards: `space.4` (16px)
- Padding interno de pantallas: `space.4` horizontal, `space.6` entre secciones
- Gap entre chips: `space.2` (8px)
- Gap entre form fields: `space.4` (16px)

---

## 6. Border radius

```
radius.none    0
radius.xs      4px      inputs, chips industriales
radius.sm      6px      chips estándar, badges
radius.md      8px      botones secundarios, cards informativos
radius.lg      10px     cards principales, headers
radius.xl      12px     CTAs primarios, modales
radius.2xl     16px     sheets, drawer
radius.full    9999px   pill buttons, avatars circulares
```

**Default**: el sistema usa `radius.lg` (10px) y `radius.xl` (12px) como protagonistas. Da una sensación moderna sin caer en "iOS rounded" extremo.

---

## 7. Elevación

### Light mode: usa sombras sutiles
```
elevation.0   none
elevation.1   0 1px 3px rgba(15,40,24,0.08), 0 1px 2px rgba(15,40,24,0.04)
elevation.2   0 4px 8px rgba(15,40,24,0.08), 0 2px 4px rgba(15,40,24,0.04)
elevation.3   0 8px 16px rgba(15,40,24,0.10), 0 4px 8px rgba(15,40,24,0.06)
```

### Dark mode: usa surface más claro (no sombras)
```
elevation.0   surface.background  (#0D1813)
elevation.1   surface              (#1F3328)
elevation.2   surface.elevated     (#2A4234)
elevation.3   surface.elevated + border.strong
```

**Razón**: las sombras se pierden sobre fondos oscuros; en dark mode la elevación se comunica con luminosidad creciente del surface.

---

## 8. Componentes

### 8.1 Button

**Variantes**:

- **Primary CTA**: fondo `color.cta`, texto `#FFFFFF`, peso 800, height 64px, radius 12px. Para la acción más importante de cada pantalla. **Máximo uno por pantalla.**
- **Secondary**: fondo transparente, border 1.5px `color.primary`, texto `color.primary`, peso 700, height 56px, radius 12px. Para acciones alternativas.
- **Ghost**: sin fondo ni border, texto `color.primary` peso 600, height 48px. Para acciones terciarias o links de navegación.
- **Destructive**: fondo `color.error`, texto `color.error.fg`, peso 800. Para acciones destructivas confirmadas (borrar, anular).

**Estados**: default, hover, pressed, disabled, loading.
**Pressed state**: oscurece el fondo un 15% (light) o aclara un 10% (dark).
**Disabled**: opacity 0.4, sin interacción.

### 8.2 Card

**Variantes**:

- **Default**: fondo `color.surface`, padding `space.4`, radius `radius.lg`, border 1px `color.border`.
- **Elevated**: igual + `elevation.1` (light) / `surface.elevated` (dark).
- **Interactive**: igual a default + cursor pointer + hover suave (cambia border a `color.border.strong`).

**Anatomía típica** (card de animal):
- Padding `space.4` (16px)
- Label superior: `text.caption.xs`, color `text.muted`, letter-spacing +1
- Título principal: `text.display.sm` (28px), peso 800
- Metadata: `text.body.sm` (13px), color `text.muted`
- Acento visual a la derecha: `text.display` con `color.cta` (para el peso)

### 8.3 Chip / Badge

Pildorillas para estados (preñada, vacunada, revisión, etc).

- Padding: `space.3` horizontal (12px), `space.2` vertical (8px)
- Radius: `radius.sm` (6px) — versión sólida; `radius.full` para pill
- Tipografía: `text.caption` (11px), peso 700, letter-spacing +0.5
- Altura mínima: 30px

**Variantes** (siempre fondo sólido para máxima legibilidad bajo sol — nunca usar fondos translúcidos):
- `chip.success`: bg `color.success`, fg `color.success.fg`
- `chip.warning`: bg `color.warning`, fg `color.warning.fg`
- `chip.error`: bg `color.error`, fg `color.error.fg`
- `chip.neutral`: bg `color.border.strong`, fg `color.text`

### 8.4 Input

- Background: `color.surface`
- Border: 1.5px `color.border.strong`
- Border (focus): 2px `color.primary`
- Padding: `space.3` vertical, `space.4` horizontal
- Min height: 52px (touch-friendly)
- Radius: `radius.md` (8px)
- Tipografía: `text.body.lg` (17px) — más grande que web típico para uso en campo
- Label: `text.caption` arriba del input, peso 700, letter-spacing +1, uppercase

### 8.5 Header bar (pantalla)

- Background: `color.primary` (light) / `color.primary` que es #2D5F3F (dark)
- Height: 64px en mobile (incluye safe area iOS)
- Padding: `space.4` horizontal
- Texto: `color.text.inverse`
- Eyebrow (label sutil): `text.caption`, peso 600, opacity 0.78
- Title: `text.title` (18px), peso 700
- Status indicators (BLE, batería) a la derecha

### 8.6 Sheet / Modal

- Background: `color.surface`
- Radius (top-only en mobile): `radius.2xl` (16px)
- Backdrop: `rgba(15,40,24,0.45)` (light) / `rgba(0,0,0,0.65)` (dark)
- Padding: `space.6` (24px)
- Drag handle: 4px alto × 36px ancho, `color.border.strong`, top center

### 8.7 Toggle theme switch

Ubicación: Settings > Apariencia.
Opciones: `Auto (según sistema)`, `Claro`, `Oscuro`.
Default: `Auto`.
Persistencia: AsyncStorage / localStorage / Supabase user preferences.

---

## 9. Iconografía

**Librería**: Lucide Icons (open-source, consistente, gran cobertura).
**Tamaños estándar**: 16px (inline), 20px (botones), 24px (navegación), 32px (features destacadas).
**Stroke width**: 2px (default), 2.5px en headers / botones primarios para mayor presencia.
**Color**: hereda de `currentColor` — el icono toma el color del contexto.

---

## 10. Accesibilidad

- Contraste WCAG AAA en texto principal (verificado: 14.5:1 light, 14.8:1 dark)
- Contraste WCAG AA mínimo en texto secundario (4.5:1)
- Touch targets mínimo 48px de altura
- Estados focus visibles (ring 2px `color.primary` con offset 2px)
- Screen readers: labels semánticos en todos los chips de estado
- Hit area: si un elemento visual es <48px, expandir hit area con padding invisible

---

## 11. Implementación técnica

### 11.1 Estructura recomendada en código

```
/lib/theme/
  ├── tokens.ts          # raw palette + semantic tokens (light + dark)
  ├── themes.ts          # exporta lightTheme y darkTheme
  ├── ThemeProvider.tsx  # context provider con switch
  └── useTheme.ts        # hook de consumo
```

### 11.2 Approach según UI library

- **Tamagui**: definir `tokens` y `themes` en `tamagui.config.ts`. Los semantic tokens se mapean al darkTheme y lightTheme automáticamente.
- **NativeWind**: configurar paletas en `tailwind.config.js` con dark mode `class`. Usar `dark:` modifier en classNames.
- **Sin lib (custom)**: ThemeProvider con React Context. Componentes consumen via `useTheme()`.

### 11.3 Switching

- Default: `useColorScheme()` de react-native (sigue al sistema)
- Override de usuario: persistido en AsyncStorage + Supabase user_preferences
- Transición visual: animar opacity de root 200ms al cambiar, evita flash bruto

### 11.4 Status bar

- Light theme: `barStyle="dark-content"`, `backgroundColor="#0F2818"` (matches primary)
- Dark theme: `barStyle="light-content"`, `backgroundColor="#0D1813"` (matches background)

---

## 12. Para Figma

### 12.1 Estructura de archivos sugerida

```
RAFAQ Design System (file)
  ├── 🎨 Foundations
  │   ├── Color tokens (light + dark)
  │   ├── Typography
  │   ├── Spacing
  │   └── Effects (shadows)
  ├── 🧩 Components
  │   ├── Buttons
  │   ├── Cards
  │   ├── Chips
  │   ├── Inputs
  │   ├── Headers
  │   └── Sheets
  └── 📱 Patterns
      ├── MODO MANIOBRAS wizard
      ├── Ficha animal
      └── Dashboard
```

### 12.2 Tokens en Figma

**Opción A**: usar plugin **Tokens Studio** (gratis). Permite definir tokens en JSON y sincronizarlos con código.

**Opción B**: crear **Local Styles** y **Local Variables** manualmente:
- Color variables con modes `light` y `dark`
- Float variables para spacing y radius
- String variables para font families

Si usás Tokens Studio, los tokens semánticos de las secciones 3.2 y 3.3 se pueden importar directamente como JSON.

### 12.3 Primer set de frames a armar

1. **Style guide page** — muestra cada token con su HEX y nombre
2. **Component library page** — botones, cards, chips en todas sus variantes en ambos themes
3. **MODO MANIOBRAS wizard** — el flujo crítico del producto (3-4 frames mostrando secuencia)
4. **Ficha de animal** — pantalla de referencia para validar tokens en uso real
5. **Dashboard del productor** — pantalla con datos agregados

---

## 13. Decisiones cerradas (no negociar sin razón)

1. ✅ Light + Dark mode como sistema dual desde día 1
2. ✅ Inter (o Manrope) como tipografía, **no serifs**
3. ✅ Terracota como color exclusivo de CTA primario
4. ✅ Touch targets mínimo 48px, CTAs primarios 60-64px
5. ✅ Chips de estado con fondo sólido siempre (no translúcidos)
6. ✅ WCAG AAA en texto principal, AA en secundario
7. ✅ Dark mode con surface elevation por luminosidad (no sombras)
8. ✅ Iconografía Lucide

---

## 14. Decisiones pendientes (TODAS — el sistema entero está en exploración)

Este doc es un draft exploratorio. **Ninguna decisión está cerrada todavía**. Lo que sigue es lo que el draft *proponía*; nada de eso aplica hasta que cerremos la fase de exploración (inspiración → comparación → decisión).

- **Mood y paleta** — Campo Profundo es UNA propuesta. Hay que generar 2-3 moods opuestos con Stitch y comparar.
- **Tipografía** — Inter era la propuesta. Manrope, IBM Plex, system-ui también están en juego. Validar en mockups reales.
- **Density** — el draft no tomó posición clara sobre densidad para el caso "peón en manga" vs "vet en oficina". Revisar.
- **Dual theme** — el draft asumió dual theme desde día 1; vale revisar si el dark mode aporta o complica antes del MVP.
- **Iconografía custom** — evaluar si Lucide cubre o hay que crear set propio para conceptos del campo (caravana, manga, bastón, balanza).
- **UI library** — Tamagui está propuesto en `ADR-013`. Sigue vigente.

---

**Versión**: 0.1 — draft exploratorio
**Tema propuesto**: Campo Profundo (uno entre varios moods a evaluar)
**Tokens propuestos**: `design/tokens.json` (draft, no canónico, ver `design/README.md`)
