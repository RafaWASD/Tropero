# Estado del Frontend / Design — RAFAQ

> **Leer al retomar frontend** (cuando Raf diga "retomar frontend" o equivalente).
> Snapshot del trabajo de diseño hecho hasta **2026-05-28**. Frontend pausado por decisión de Raf para cerrar specs primero.
> Última sesión de diseño: exploración + 3 iteraciones en Stitch del flujo onboarding de spec 01.

---

## ✅ HOME FIX RESUELTO (sesión 17, 2026-05-29) — vía Stitch, no Figma

La home definitiva se corrigió **prompteando Stitch** (Raf descartó el fix manual en Figma). Cambios aplicados y verificados (render local con Chrome headless):

- **CTA "Crear rodeo"** → pill verde botella `#1e5a3e` **full-width** debajo del body del Paso 1, ~56px. (Era chico y a la derecha — patrón desktop-first; RAFAQ es mobile-first uso con guante, CLAUDE.md principio 4.)
- **FAB "Maniobra"** → elevado de verdad, sobresale sobre la barra, anillo blanco + sombra, ⚡ centrado, label "Maniobra" debajo (ya no se superpone).
- **Hamburguesa → switch de establecimiento** "La Juanita ▾" en el header (también da feedback de en qué campo estás; abre la futura pantalla "Mis campos", ver `docs/backlog.md` 2026-05-29).
- **Stepper** → riel vertical único, 3 círculos = diámetro centrados en la línea, Paso 1 verde con "+" (la asimetría card/plano que desalineaba todo desapareció).
- **Banner "establecimiento listo"** → descartable (✕).
- **Fondo** → blanco neutro `#faf9f9` (≈ blanco puro, sin tinte frío ni cálido).

**Causa raíz del tinte frío** (lo que reaparecía siempre): el token `background` del design system de Stitch era `#f8f9ff` (default Material You), generado por `overrideNeutralColor` azulado. Se arregló **a nivel design system** (no por pantalla) → ver abajo.

**Home canónica actual**: `design/stitch-iter-4/00-home-CANONICAL.png`
**Screen ID en Stitch**: `a5bac4039faf4a2abe5f808425b177bf` ("Home RAFAQ - Wizard Final (White) v2")
**HTML fuente**: `design/stitch-iter-4/home-final.html`

### Lección de Stitch (importante para futuras ediciones)
- El **motor de color dinámico (Material You)** pisa los colores explícitos del `designMd`: re-deriva la rampa de surfaces desde `customColor` + `overrideNeutralColor` + `colorVariant`. Para controlar el fondo hay que tocar **esos params**, no el YAML del designMd.
- Para **blanco neutro + verde botella en containers**: `colorVariant: FIDELITY` (preserva el seed verde en los containers) + `overrideNeutralColor: #808080` (gris puro chroma 0 → fondo neutro sin tinte). Con `NEUTRAL` el fondo sale neutro PERO desatura `primary-container` a verde menta (rompe el pill activo del nav). Con neutral cálido (`#78716c`) el fondo sale `#fff8f5` (blanco cálido).
- **Consistencia eventual**: `update_design_system` tarda en commitear; un `apply_design_system` disparado inmediato puede leer la versión anterior. Si el resultado no refleja el update, reaplicar.
- La edición rápida por **DOM ops** (`edit_screens` con cambios chicos) a veces NO persiste al archivo. `apply_design_system` sí persiste confiable.
- Modelo: usar **GEMINI_3_1_PRO** (el mejor que ofrece Stitch; el otro es 3 Flash).

---

## Dirección de diseño cerrada

**Híbrido por capa de uso** (documentado en detalle en `design/design-brief-v1.md`). 5 referencias por momento:

| Momento | Inspiración primaria | Secundaria |
|---|---|---|
| Onboarding + signup wizard | Galicia (minimalismo) | Linear (cards elevados) |
| Home post-creación | Modo (greeting emoji + pills) | MP (microcopy) |
| Tab Animales | Attio (CRM table view) | MP tab Actividad + Cowgazer foto-avatars |
| Ficha animal | Fi (cards 2-col + timeline) | Cowgazer (avatar grande) |
| Empty/error/loading | Galicia | — |
| MODO MANIOBRAS | Auravant (funcional) | Galicia (foco) |
| Settings | MP tab Más | Modo |
| Identidad visual | Cowgazer/Modo verde botella | Attio disciplina cromática |

### Paleta canónica (validada en iteraciones Stitch)
- **Background base**: BLANCO PURO `#FFFFFF` (decisión de Raf: "más veterinario/limpio que el bone").
- **Surface secundario** (cards info): BONE `#F8F6F1` (warm, cálido — para cards específicas, NO el bg general).
- **Brand primary**: VERDE BOTELLA `#1e5a3e`.
- **Tertiary/alertas**: TERRACOTA `#c84a2c`.
- **Verde container claro** (icons): `#93cfac`.
- **Text negro**: `#0F0E0C`. **Grey**: `#707972`. **Grey muted**: `#A8A29D`. **Divisor**: `#E5E5E3`.
- Status colors por estado del animal (ver design-brief-v1.md).
- NO usar azul-blanco frío (`#f8f9ff`) — Stitch lo metió por default de Material You, se corrigió a blanco puro.

### Tipografía
- **Inter** exclusivo. Weights 700 (display/headlines) / 600 (subheadings/card titles) / 500 (labels) / 400 (body).

### Iconografía
- Lucide React Native. NO emoji como sustituto de iconos (solo emoji en greetings/notifications: "¡Hola [nombre]! 👋").

### Tono
- Voseo argentino constante. Microcopy explicativo. Tildes UTF-8 correctas.

---

## Bottom nav definitivo (de la home canonizada)

5 items con FAB central elevado:

```
[Inicio] [Animales] [⚡ FAB Maniobra] [Reportes] [Más]
```

- FAB central verde botella `#1e5a3e`, ~64px diámetro, elevado con shadow, icono rayo ⚡ blanco, label "Maniobra" grey debajo.
- Item activo en verde botella, inactivos en grey.
- Pendiente formalizar en **ADR-018** (item A.2 del plan).

---

## Proyecto Stitch

- **Título**: "Onboarding App Ganadera RAFAQ"
- **ID**: `15162191993835764100`
- **MCP de Stitch oficial** instalado (`https://stitch.googleapis.com/mcp` con `X-Goog-Api-Key`). API key en `.env.local` (NO commitear).
- Modelo usado: **Gemini 3.1 Pro**.
- El design_md del proyecto Stitch ya tiene el brief incorporado (verde botella + bone + terracota + Inter + voseo + 60px tap targets).

### Cómo retomar la generación en Stitch desde el chat
- Las tools del MCP (`generate_screen_from_text`, `edit_screens`, `generate_variants`, `get_screen`, `list_screens`, `update_design_system`) están disponibles cuando Claude Code inicia con el MCP cargado.
- Patrón de uso: cada operación tarda minutos y puede dar **timeout** — NO retry; en su lugar `list_screens` + bajar el screenshot con `curl -sL` de la `downloadUrl`.
- Las URLs de screenshot son de `lh3.googleusercontent.com/aida/...` con tokens — bajar con `curl -sL -o archivo.png 'URL'`.

---

## Iteraciones hechas (en disco)

```
design/stitch-iter-1/   — 9 screens base del flujo onboarding signup wizard
design/stitch-iter-2/   — 11 screens: bone bg + CTA primary email + FAB nav + logo R monograma
design/stitch-iter-3/   — 8 screens: bg blanco puro + back arrow corregido + sin brújula
                          + home-final-v2.png (home previa, con CTA pendiente)
design/stitch-iter-4/   — home FINAL (sesión 17): switch de campo + FAB elevado + stepper
                          riel + CTA full-width + banner descartable + bg blanco neutro.
                          00-home-CANONICAL.png (LA HOME CANÓNICA) + home-final.html
```

Flujo cubierto (8 pantallas spec 01): Splash, Registro, Verificación Email, Inicio Onboarding (CTA dual R6.5), Validación Teléfono (R3.8), Crear Establecimiento, Home post-creación, Aceptar Invitación (R5.3). + Logo R monograma + Design System.

### Aciertos validados en las iteraciones
- Autocomplete de dominios email (@gmail/@hotmail/@outlook) — MP pattern.
- Pre-fill +54 con dropdown bandera — MP pattern.
- Greeting "¡Hola Lucas! 👋" emoji integrado — Modo pattern.
- Wizard "tarjetas con CTA solo en activo" — MP pattern (es la home elegida).
- Foto real de campo en card de invitación.
- Empty state CTA dual (R6.5).
- Back arrow cerca del headline (corregido en White screens).
- Sin brújula decorativa en onboarding (corregido).

### Issue conocido de Stitch
- **Render de tildes**: al exportar el PNG, Stitch a veces corta tildes ("Definí"→"Defini", "Más"→"Ms", "cría"→"cria"). Es bug de render del screenshot, NO del HTML. Cuando se implemente en código RN se escriben las tildes correctas. No bloquea.

---

## A.1 — design system ✅ CERRADO (sesión 20)

> **El design system v4 quedó canonizado.** Fuente única: `app/tamagui.config.ts` + `docs/design-system.md` (canónico). El draft "Campo Profundo" se archivó en `design/explorations/`. No se mantiene un `design/tokens.json` paralelo (ADR-023 §1, código = fuente). El **lint anti-hardcode** (`scripts/check-hardcode.mjs`, cableado en `check.mjs`) cierra el guardrail de ADR-023 §4: 8 literales tokenizados, 0 excepciones. El reencuadre histórico de ADR-023 se conserva abajo.

⚠️ **Cambio de enfoque (histórico):** el design system NO se canoniza en abstracto. Se **deriva de construir la home a mano** en Tamagui/Expo. Esta home de Stitch (`design/stitch-iter-4/00-home-CANONICAL.png`) es **referencia de dirección visual, NO código a portar** (Stitch escupe HTML web, no Tamagui). Ver `docs/adr/ADR-023-workflow-diseno-frontend.md`.

Orden nuevo:
1. ~~Fix de la home~~ ✅ + ~~ADR-018 bottom nav~~ ✅ (sesión 17).
2. **B.0 — scaffold del stack ADR-013** en `app/` (Tamagui + Expo Router + Reanimated + `tamagui.config.ts` provisional sembrado con los tokens v4 de abajo + shell bottom-nav stub). `app/` hoy es un Expo pelado, nunca se instaló el stack. → implementer.
3. **Construir la home a mano** corriendo en Expo, ensamblada con componentes (`BottomNav`/`Card`/`Button`/`Stepper`/`FormField`/`ListRow`) + tokens que se derivan. Test de cobertura.
4. Validar corriendo en device frame real (gate "primer try").
5. ✅ **Canonizado** (sesión 20): `tamagui.config.ts` (sin "provisional") + `docs/design-system.md` (canónico). `design/tokens.json` (Tokens Studio) NO se recrea — código = fuente única (ADR-023 §1).
6. **Lint guardrail** desde día 1: falla ante color/spacing hardcodeado (ADR-023 §4).

**Tokens validados (design system v4 de Stitch) para sembrar el `tamagui.config.ts` provisional:** base blanco `#FFFFFF`/`#faf9f9` (neutro, sin tinte), verde botella `#1e5a3e`, bone `#F8F6F1` (cards), terracota `#c84a2c` (alertas), verde claro `#93cfac` (icon container), texto `#0F0E0C`, gris `#707972`, divisor `#E5E5E3`, Inter (700/600/500/400), touch-target ≥56px, radios 16px cards / pill botones.

---

## Decisión de producto cerrada en esta sesión (relevante para specs)

- **Wizard home paso 1 = "Creá y configurá tu primer rodeo"**. Esto se alineó con el refinamiento de spec 02 R2.6 (sesión 13 de Raf): NO existe rodeo default automático; el usuario crea el rodeo manualmente vía wizard eligiendo sistema + data_keys. La home refleja esa decisión.
