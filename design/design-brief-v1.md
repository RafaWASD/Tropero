# Brief de Design System v1 — Direccional para Stitch

> **Status**: Direccional, listo para alimentar Stitch + generar primer flujo de prueba (signup wizard spec 01).
> **Fecha**: 2026-05-27
> **Autor**: leader (sintetizado a partir de research-findings.md + 60+ screens curadas + análisis con Raf en sesión 12).
>
> Este documento es la **entrada para Stitch web**. Cuando Stitch genere los primeros flujos basados en este brief, los validamos contra los principios acá y refinamos. Cuando Raf apruebe los outputs, este brief se canoniza en `docs/design-system.md` + `design/tokens.json` + ADR-020.

---

## Decisión de dirección

**Híbrido por capa de uso, no una sola app**.

La dirección NO es "copiar MP" ni "copiar Galicia" ni "copiar Cowapp". Es una arquitectura visual que toma 5 referencias, cada una para el momento del usuario donde es más fuerte:

| Momento | Inspiración primaria | Inspiración secundaria | Por qué |
|---|---|---|---|
| Onboarding + signup wizard | **Galicia** (minimalismo extremo + whitespace + foco) | **Linear** (cards elevados + dots pattern + CTA pill) | El usuario hace UNA cosa por screen — máxima claridad |
| Home post-establishment | **Modo** (greeting emoji + grid pills 2x2 verdes + cards rounded) | **MP** (stats hero + microcopy) | Funcional argentino moderno + acción rápida |
| Tab Animales (BUSCAR ANIMAL) | **Attio** (CRM table view + status chips + FAB) | **MP tab Actividad** (search + chips filtros + lista agrupada) | Pro data-dense + funcional |
| Ficha de animal | **Fi home-tracker** (cards 2-col + sparkline + timeline) | **Cowgazer-02** (foto avatar grande + ID + stats) | Personalidad + tracking premium |
| Empty states + errors + loading | **Galicia** (icono naranja + headline + CTA dual stacked) | — | Insuperable |
| MODO MANIOBRAS form | **Auravant** (arquitectura funcional: secciones + Add X + chip estado) | **Galicia** (whitespace + un paso por screen) | Funcional aprobado por el dominio + foco RAFAQ |
| Settings + Más | **MP tab Más** (bloque perfil + banners + lista vertical + chevron + badges) | **Modo** (paleta verde + cards rounded) | Lista clara + paleta alineada |
| Tone copy | **MP + Galicia + Modo** (voseo argentino constante) | — | Identidad cultural |
| Identidad visual paleta | **Cowgazer + Modo** (verde botella brand) + **Attio** (disciplina cromática) | — | Verde sin ruido |
| Premium feel | **Linear** (cards elevados + dots pattern + sutileza) | — | Solo donde queremos comunicar "pro B2B" |

---

## Paleta canónica (draft v1, sujeta a Stitch + iteración)

### Color brand primario
- **Verde Botella** `#1E5A3E` (campo profundo, autoridad agtech argentina)
- Variantes:
  - `verde-50` `#E8F2EB` (background sutil)
  - `verde-100` `#C8E0CF` (chip soft)
  - `verde-500` `#1E5A3E` (CTA primary)
  - `verde-700` `#143F2A` (hover + dark text)
  - `verde-900` `#0A2517` (extreme dark, headline opcional)

### Color brand secundario / accent
- **Terracota** `#C84A2C` (alertas accionables, eventos críticos, identificadores)
  - O alternativa **Sage** `#8FA68E` (más sereno, mood pampa) — a decidir en Stitch

### Neutros
- `white` `#FFFFFF`
- `bone` `#F8F6F1` (background cards alternativo, mood cálido)
- `grey-50` `#F5F5F4`
- `grey-100` `#E5E5E3`
- `grey-300` `#A8A29D`
- `grey-700` `#3F3D38`
- `black` `#0F0E0C` (text)

### Status colors (codificados por estado del animal)
- `active` `#4A7C59` (verde sage)
- `pregnant` `#E8B14B` (amber)
- `sold` `#6E6964` (grey muted)
- `dead` `#8A3F2C` (rust)
- `transferred` `#3F6F8E` (blue muted)

### Dark mode (preparado, no urgente MVP)
- `bg-dark` `#0F1411`
- `card-dark` `#1A2520`
- `text-dark` `#E8F2EB`

---

## Tipografía

- **Heading**: **Inter** (sans, peso 700/600/500) — premium sin pretensión, alineado con MP, Galicia, Modo, Linear, Attio.
  - Display H1: 32px / 38px / 700
  - H2: 24px / 30px / 700
  - H3: 20px / 26px / 600
  - H4: 18px / 22px / 600
- **Body**: **Inter** (sans, peso 400/500)
  - Body large: 16px / 22px / 400 (default operativo, legible al sol)
  - Body regular: 14px / 20px / 400
  - Caption: 12px / 16px / 400
- **Numeric**: **Inter Tabular Nums** (mismo peso) — para pesos, fechas, IDs, cantidades. Garantiza alineación vertical en columnas.
- **Mono opcional**: **JetBrains Mono** o **IBM Plex Mono** — solo para TAGs/IDs si queremos diferenciarlos visualmente (no urgente MVP).

**Cargar con `expo-font` + assets locales**. No webfonts (no aplica RN).

---

## Spacing scale (Tamagui tokens)

- `xs` 4px
- `sm` 8px
- `md` 12px
- `base` 16px (default operativo)
- `lg` 24px
- `xl` 32px
- `2xl` 48px
- `3xl` 64px

Padding base de pantalla: `lg` (24px). Cards: `base` (16px) padding interno, `md` (12px) entre cards.

---

## Border radius

- `none` 0
- `sm` 6px (chips pequeños)
- `md` 12px (inputs, cards default)
- `lg` 16px (cards hero, modales)
- `xl` 24px (pills CTA)
- `full` 9999px (avatares, FAB)

---

## Componentes clave — patrones canónicos

### CTA Primary (pill grande)
- Background: `verde-500`
- Text: white, Inter 600, 16px
- Padding: `base` vertical × `lg` horizontal
- Border radius: `xl` (24px) — pill grande
- Estados: hover `verde-700`, disabled `grey-300`, pressed scale 0.97
- **Tamaño mínimo: 60px alto para acciones críticas en manga, 48px alto para secundarias**

### CTA Secondary (outline)
- Background: transparent
- Border: 1.5px `verde-500`
- Text: `verde-500`, Inter 600, 16px
- Mismo padding y radius que primary

### CTA Tertiary (linkstyle)
- Sin background, sin border
- Text: `verde-500`, Inter 600, 14px, no underline
- Solo para acciones de bajo peso (cancelar, "no tengo X", etc.)

### Input field
- Background: white
- Border: 1px `grey-100` (default) → 1.5px `verde-500` (focused) → 1.5px `terracota` (error)
- Padding: `base` horizontal × `md` vertical
- Border radius: `md`
- Label arriba (no float), Inter 500, 14px
- Helper text debajo, Inter 400, 12px, `grey-700`
- **NO usar underline-only (Galicia style)** — perdimos accessibility hits

### Card default
- Background: white
- Border: ninguno
- Shadow sutil: `0 1px 3px rgba(15,14,12,0.04)`
- Padding interno: `base`
- Border radius: `lg`
- Hover/pressed: shadow más fuerte + scale 1.01

### Status chip
- Padding: `sm` horizontal × 2px vertical
- Border radius: `full`
- Dot color + label
- Inter 500, 12px
- Background: white (con dot color que indica estado) o color soft del estado

### Bottom nav
- 5 items: `[Inicio] [Animales] [⚡FAB Maniobra] [Reportes] [Más]`
- Background: white con shadow superior sutil
- Item activo: pattern Modo (card blanca circular elevada con shadow + icon + label verde)
- Item inactivo: icon outline grey-300 + label grey-700
- **FAB central elevado**: `verde-500` con shadow más fuerte, icon white, label opcional debajo "Maniobra"

### Avatar de animal
- Circular, foto del animal cuando esté cargada (Cowgazer pattern)
- Fallback: monograma (ID + categoría) sobre `verde-100` background
- Borde sutil 2px white sobre background no-blanco
- Tamaños: `sm` 32px (lista) / `md` 48px (cards) / `lg` 80px (ficha individual) / `xl` 120px (hero)

### Stats card (hero post-establishment)
- Background: white card elevada
- Layout: label uppercase grey-300 + número grande (Inter 700, 32px+) + sublabel/trend chip
- Chip de tendencia inline: `▲ +12%` verde / `▼ -5%` terracota
- Scrollable horizontal en home (pattern MP tab Actividad)

### Wizard de tarjetas con CTA solo en activo (MP pattern)
- Lista vertical de pasos
- Cada paso: icono circular + título + body + (CTA primary si activo, sin CTA si pendiente, checkmark verde + texto muted si completado)
- Solo el paso activo tiene card elevada blanca + CTA visible
- **Patrón canónico para signup wizard de spec 01**

### Empty state (Galicia pattern)
- Icono circular grande naranja/terracota warning O verde info
- Headline display bold debajo
- Subtitle grey-700 explicativo
- CTA dual stacked: primary fill + secondary outline + opcional linkstyle al final
- Mucho whitespace alrededor

### Loading state (Galicia pattern)
- Spinner circular `verde-500` mid-screen
- Headline "Estamos procesando los datos" Inter 700, 24px
- Subtitle "Esto puede tardar unos segundos" Inter 400, 14px, grey-700
- Cero distracción, sin %

---

## Tono de copy

- **Voseo argentino constante**: "Escribí", "Ingresá", "Continuá", "Cargá", "Bastoneá", "podés", "tenés", "necesitás", "Acumulá".
- **Microcopy explicativo**: cada step del wizard explica el "por qué" (MP pattern: "El documento determinará quién será titular...", "Lo usarás para iniciar sesión...").
- **Helper text bajo inputs** con formato esperado.
- **Emoji integrado en headlines** cuando agrega calor sin caer en cursi (Modo pattern: "¡Hola Rafael! 👋", "Notificaciones 🔔") — usar con moderación, solo en greetings y notificaciones.
- **Sin imperativos secos**: en vez de "Confirmar acción" → "Confirmar y guardar".
- **Sin lenguaje técnico expuesto**: "TAG electrónico" → "caravana electrónica". "RLS" → no mencionar nunca al usuario.
- **Errores accionables**: copy explica qué pasó + qué hacer ahora (Galicia 14 pattern).

---

## Microinteractions (animaciones)

Stack: **Reanimated + Moti** (ADR-013). Ver `.claude/skills/stitch-workflow/SKILL.md` para sintaxis adaptada de RN.

### Catálogo de animaciones canónicas

- **Entrada de pantalla**: `from: opacity 0, translateY 28` → `animate: opacity 1, translateY 0`, duración 700ms, ease bezier(0.25, 0.46, 0.45, 0.94).
- **Entrada de cards en lista**: stagger 90ms entre cards, mismo perfil que entrada de pantalla.
- **Pressed feedback (botones)**: scale 0.97 con spring stiffness 400, damping 20.
- **Cards interactivas**: scale 1.018 + shadow más fuerte al pressIn.
- **Headlines palabra por palabra**: opcional, solo en pantallas hero (splash, success states). Stagger 100ms por palabra.
- **AnimatePresence en modales y bottom sheets**: fade + scale + translateY (Moti).
- **Loading spinner**: rotación infinita 1.2s ease-in-out.
- **Counters animados**: de 0 al valor final en 1400ms (para KPIs del rodeo en home).
- **Scroll-linked parallax**: fondo 0.4x, foreground 0.85x (solo en hero home, no en listas operativas).
- **Reduced motion**: respetar `AccessibilityInfo.isReduceMotionEnabled()` — reemplazar blur+transform por fade simple.

---

## Iconografía

- **Lucide React Native** (open source, consistente, ~1500 íconos).
- Stroke width: 2px default, 1.5px en pantallas dense (Attio pattern).
- Tamaños: `sm` 16px (inline) / `md` 20px (botones) / `lg` 24px (nav) / `xl` 32px (hero empty state).
- Color: heredar del context (`currentColor`), no hardcodear.
- **NO usar emoji como sustituto de íconos** en pantallas operativas (Notion pattern descartado). Solo emoji en headlines de greeting/notification.

---

## Patrones a NO copiar (explícito)

- ❌ Top bar brand persistente con muchos elementos (MP amarillo abrumador en cada tab).
- ❌ Inputs underline-only (Galicia) — perdemos accessibility cues.
- ❌ Paleta multi-accent (MP tiene amarillo + azul + verde + dorado + rojo — demasiado ruido).
- ❌ Tipografía sin jerarquía (Auravant todo similar tamaño).
- ❌ CTAs verde lima (Auravant) sin autoridad.
- ❌ Cards rectangulares con corners agudos (Auravant Material 2017).
- ❌ Números con 13 decimales sin truncar (Auravant problema UX numérica).
- ❌ Iconos line-art genéricos sin personalidad (Auravant).
- ❌ Emoji como sustituto de iconos en pantallas operativas (Notion).
- ❌ Copy promocional aspiracional (MP Beneficios) — no aplica al tono RAFAQ.

---

## Lo que SÍ es novedoso de RAFAQ (no copiado de nadie)

1. **Foto-avatares de animales** (de Cowgazer) — un productor reconoce sus vacas por cara, no por código. Patrón identitario fuerte.
2. **Categorías productivas codificadas por color** (extensión Attio) — verde activa / amber preñada / grey vendida / rust muerta / blue transferida.
3. **Top bar contexto activo persistente** (de Auravant pero refinado) — `Establecimiento / Rodeo` siempre visible para que el operador en la manga nunca pierda contexto. **Adoptamos la idea, no la estética**.
4. **FAB central Modo Maniobra** — el bot más accesible para mano enguantada, comunica visualmente "acción más crítica".
5. **Listener BLE global** — el bastón es "ambient input", no un modo. Único en agtech.

---

## Brief para Stitch (lenguaje natural, copy-pasteable)

Para alimentar el primer flujo en stitch.withgoogle.com, usar el siguiente prompt:

```
Diseñá un flujo de onboarding completo para RAFAQ, una app móvil de gestión ganadera argentina.
Usuario target: productor ganadero argentino o veterinario, edad 30-60, usa la app en el campo
con barro o sangre en las manos, a veces con guantes.

Stack visual:
- Paleta: verde botella #1E5A3E como brand primario, blanco, bone #F8F6F1 para cards, grey
  contenido, terracota #C84A2C para alertas. Sin multi-accent.
- Tipografía: Inter sans, peso 700 para headlines display, 600 para subheadings, 400/500 body.
- Cards rounded large 16px radius, shadow sutil, mucho whitespace.
- CTAs pill grandes verde botella fill (primary) + verde botella outline (secondary).
- Tap targets ≥ 60px para CTAs primarios (manga, guantes).
- Voseo argentino constante en el copy.

Estilo de referencia:
- Minimalismo + foco extremo: Galicia (banco argentino, paleta naranja, mucho whitespace).
- Cards elevados + premium B2B feel: Linear (paleta lila, dots pattern background).
- Disciplina cromática: Attio (CRM B2B premium).
- Identidad argentina + paleta verde + greeting con emoji: Modo (fintech argentino).
- Patrón wizard tarjetas con CTA solo en activo: Mercado Pago (no step indicator clásico).

Pantallas a generar para el flujo signup wizard:
1. Splash: logo RAFAQ + headline "Te damos la bienvenida" + CTA primary "Crear cuenta" +
   linkstyle "Ya tengo cuenta".
2. Signup form: input email (con autocomplete dominios @gmail.com, @hotmail.com) + input password
   con eye toggle + checkbox aceptar TyC + CTA "Continuar". Microcopy explicando por qué pedimos
   cada dato.
3. Verificá email: pantalla con ilustración line-art + headline "Te enviamos un correo a
   [email]" + microcopy "Hacé click en el link" + CTA "Reenviar correo" (linkstyle).
4. Onboarding empty state post-signup: headline "¿Cómo querés arrancar?" + CTA dual stacked:
   primary "Crear mi establecimiento" + secondary outline "Pegar link de invitación".
5. Completá teléfono (R3.8): input teléfono con prefill +54 + helper text formato +
   CTA "Continuar". Voseo: "Te enviaremos un código por SMS para validarlo."
6. Crear establecimiento: input nombre del campo + CTA primary "Crear establecimiento".
7. Home post-creación: greeting "¡Hola [nombre]! 👋" + card hero blanca con KPI principal
   "Tu establecimiento [nombre] está listo" + grid 2x2 pills altos verdes con quick actions
   "Cargar primer animal", "Invitar miembro", "Ver tutorial", "Configurar campo".
8. Aceptar invitación (R5.3): pantalla con headline "Te invitaron a [establishment]" +
   info del establecimiento + CTA primary "Aceptar y entrar" + secondary "Rechazar".

Cada pantalla con:
- Status bar negro (no transparente).
- Padding 24px horizontal.
- Mucho whitespace vertical.
- CTA principal fixed cerca del bottom (no en el centro vertical).
- Voseo en todos los strings.
- Headlines Inter 700 display, 32px+.
- Body Inter 400, 16px.

Generar 2-3 variaciones del mismo flujo para comparar.
Exportar a Figma con auto layouts + named layers + texto editable.
```

---

## Cómo se canoniza este brief (próximos pasos)

1. **Vos generás** este flujo en stitch.withgoogle.com con el prompt de arriba.
2. **Vos elegís** la mejor variación (o me la pasás para que yo opine).
3. **Yo recibo** el output de Stitch vía Stitch MCP (`get_screen_code` + `get_screen_image`).
4. **Yo proceso** y comparo contra este brief: marca inconsistencias, valida principios.
5. **Yo refino** en Figma vía MCP write (si tu Education te da Full Seat) o te paso ajustes textuales si es Dev Seat.
6. **Vos aprobás** los frames finales en Figma.
7. **Yo canonizo** en `docs/design-system.md` + `design/tokens.json` + ADR-020 + actualizo `tamagui.config.ts` para implementación.

---

## Apps de referencia consultadas (resumen)

| App | Carpeta | Función |
|---|---|---|
| Mercado Pago | `06-argentino/mercadopago-*` | 13 screens — onboarding + home + 3 tabs |
| Galicia | `06-argentino/galicia_*` | 14 screens — onboarding minimalismo extremo |
| Modo | `06-argentino/modoCapturas/` | 4 screens — fintech argentino verde brand |
| Cowapp / Cowgazer | `01-agtech-rural/cow*` | 5 screens — agtech moderno con foto-avatars |
| Auravant | `01-agtech-rural/auravant-*` | 10 screens — agtech argentino [function-ref] [anti-aesthetic] |
| John Deere | `01-agtech-rural/johndeere-*` | 10 screens — agtech US, agregar miembro |
| Fi (collar tracker) | `01-agtech-rural/fi-*` | 2 screens — tracking de seres vivos premium |
| Withings | `01-agtech-rural/withings-*` | 1 screen — greeting + tasks |
| Linear Mobile | (Mobbin, no descargado) | 8 screens — B2B SaaS premium |
| Notion Mobile | (Mobbin, no descargado) | 6 screens — DESCARTADO para MVP |
| Attio | (Mobbin, no descargado) | 6 screens — CRM B2B disciplina visual |

48+ screens curadas, 60+ revisadas. Detalles por app en `_notes.md` de cada carpeta.
