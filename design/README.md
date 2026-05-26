# /design — Recursos visuales de RAFAQ

## Status (2026-05-26)

**Esta carpeta contiene drafts exploratorios, NO el design system canónico.**

El archivo `tokens.json` se generó a partir del draft `docs/design-system.md` (que también está marcado como exploratorio). Se intentó formalizar este sistema como un ADR prematuramente (ADR-015, **eliminado el 2026-05-26**), sin completar la fase de exploración (inspiración + Stitch + comparación de moods opuestos).

## Cómo usar lo que hay acá hoy

- ✅ Como **input** para exploración de diseño (uno entre varios).
- ✅ Como **referencia técnica** del formato Tokens Studio (estructura, sintaxis, themes).
- ❌ **NO** importar a Figma como sistema final.
- ❌ **NO** traducir a Tamagui en código.
- ❌ **NO** tratar los hex/sizes como decisiones cerradas.

## Qué falta antes de cerrar el sistema

1. **Inspiración**: capturas de Dribbble + screens reales de Mobbin + apps de competencia (Allflex/Tru-Test) y referencia (John Deere, FieldView, Auravant, onX, Linear).
2. **Exploración con Stitch**: generar 2-3 moods opuestos (no solo Campo Profundo) usando vibe design.
3. **Comparación**: pantalla de signup en 2-3 moods, mismo contenido, ver cuál convence.
4. **Convicción de Raf** sobre paleta, tipografía, densidad y tono.
5. **Recién entonces**: ADR nuevo que supersede al -015, doc canónico, `tokens.json` cerrado.

## Estructura cuando esté cerrado (futuro)

```
design/
├── README.md              (este archivo, actualizado)
├── tokens.json            (canónico, Tokens Studio)
├── inspiration/           (capturas curadas que motivaron decisiones)
├── moods/                 (variantes exploradas + descartadas + elegida)
└── exports/               (assets exportados de Figma o Stitch)
```
