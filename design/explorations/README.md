# /design/explorations — Exploraciones de diseño superadas

Esta carpeta guarda exploraciones de diseño que **NO son canónicas** pero se conservan como referencia (no se borran — pueden tener ideas reutilizables).

## Contenido

### `design-system-campo-profundo.md` + `tokens-campo-profundo.json`

El **primer** intento de design system de RAFAQ ("Campo Profundo"), charlado en otro chat (2026-05-26). Mood cream/terracota + verde oscuro, con **light + dark** y formato Tokens Studio para Figma. Un intento de formalizarlo como ADR-015 fue **eliminado** por prematuro.

**Por qué quedó superado**: era la fase de *exploración* que el propio draft pedía (inspiración → exploración → comparación → decisión). Esa fase se completó: el design system **v4** (blanco neutro / verde botella `#1e5a3e` / bone `#F8F6F1` / terracota `#c84a2c`, derivado de Stitch y **del build real de la home + nav** que Raf firmó) ganó la comparación. El v4 canónico vive en **`docs/design-system.md`** + `app/tamagui.config.ts`.

**Diferencias clave v4 vs Campo Profundo**: v4 es **blanco neutro** (no cream), **light-only** para MVP (dark diferido post-MVP), y se **deriva del código** (ADR-023), no de un draft en abstracto.

**Qué sigue siendo útil acá** (rescatar JIT cuando se construya la pantalla que lo necesite): la **anatomía de componentes** (Button/Card/Chip/Input/Header/Sheet), las reglas de **accesibilidad** (contraste, focus, hit-area), la **escala tipográfica nombrada** (display/title/body/caption), y la paleta **dark** + los **colores de estado** (success/warning/error con fg) para cuando se aborden esas features. Tomar como insumo, no como verdad.

> Ver la decisión de archivado en el journal de la sesión 19/20 y en `docs/design-system.md` (canónico).
