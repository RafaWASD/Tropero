# Estado del Frontend / Design — RAFAQ

> **Leer al retomar frontend** (cuando Raf diga "retomar frontend" o equivalente).
> Snapshot del trabajo de diseño hecho hasta **2026-05-28**. Frontend pausado por decisión de Raf para cerrar specs primero.
> Última sesión de diseño: exploración + 3 iteraciones en Stitch del flujo onboarding de spec 01.

---

## ⚠️ ACCIÓN PENDIENTE PRIORITARIA — corregir la home a mano en Figma

La pantalla **home definitiva** quedó canonizada como referencia PERO tiene **una corrección pendiente que Raf hace a mano en Figma** (no vale seguir prompteando Stitch por esto).

**Qué corregir**: el CTA **"Crear rodeo"** del Paso 1 del wizard está **alineado a la derecha y es chico**.

**Cómo corregirlo**:
- Cambiar el CTA a **pill verde botella (#1e5a3e) full-width** dentro del card del Paso 1, ubicado **debajo del body text** (no a la derecha).
- Alto mínimo **56-60px**, padding generoso.
- Texto blanco "Crear rodeo", Inter weight 600, 16px.

**Por qué** (razonamiento cerrado con el leader):
- El patrón "CTA chico a la derecha de la card" es B2B desktop-first (Linear/Notion/Attio con mouse).
- RAFAQ es **mobile-first para uso en campo con mano enguantada** → necesita tap targets grandes (CLAUDE.md principio 4: "botones grandes, una decisión por pantalla").
- Un CTA chico a la derecha puede pasarse desapercibido y el usuario podría tocar el FAB Maniobra central por confusión.
- Full-width dentro del card mantiene la jerarquía (el FAB central sigue siendo el botón más prominente de la pantalla) pero hace la acción del wizard fácil de pegar.

**Archivo de referencia de la home actual**: `design/stitch-iter-3/07-home-final-v2.png`
**Screen ID en Stitch**: `0753a3cb5be5403bbe731bed77655873` ("Home RAFAQ - Wizard Final (White)")

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
                          + home-final-v2.png (LA HOME CANONIZADA, con CTA pendiente de fix manual)
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

## Qué falta para cerrar A.1 (design system canónico)

1. Raf corrige el CTA del home a mano en Figma (acción pendiente arriba).
2. (Opcional) Aplicar la dirección a 2-3 pantallas más clave hasta el mismo estándar.
3. Canonizar:
   - Actualizar `design/design-brief-v1.md` → v2 con lo validado en iteraciones.
   - Crear `docs/design-system.md` canónico (quitar disclaimer DRAFT EXPLORATORIO).
   - Actualizar `design/tokens.json` con valores canónicos (formato Tokens Studio).
   - Crear **ADR-020** (design system canónico) — reemplaza el draft. Nota: ADR-015 fue eliminado, 016/017 ocupados, 018 reservado para bottom nav, 019 ocupado por security_analyzer. Próximo libre: **020**.
   - Crear **ADR-018** (estructura bottom nav) — item A.2 del plan.
4. Traducir tokens a `tamagui.config.ts` cuando arranque la implementación frontend (B.1).

---

## Decisión de producto cerrada en esta sesión (relevante para specs)

- **Wizard home paso 1 = "Creá y configurá tu primer rodeo"**. Esto se alineó con el refinamiento de spec 02 R2.6 (sesión 13 de Raf): NO existe rodeo default automático; el usuario crea el rodeo manualmente vía wizard eligiendo sistema + data_keys. La home refleja esa decisión.
