# /design — Recursos visuales de RAFAQ

## Status (2026-05-30)

El **design system canónico (v4) ya está cerrado** (item A.1 del plan). Vive en:
- **`docs/design-system.md`** — documento canónico (lectura humana).
- **`app/tamagui.config.ts`** — fuente única de verdad de los tokens (ADR-023 §1).

Esta carpeta guarda **recursos de apoyo** (inspiración, capturas, exploraciones), NO el sistema canónico.

## Estructura

```
design/
├── README.md              (este archivo)
├── FRONTEND-STATUS.md     (estado/roadmap del frontend)
├── design-brief-v1.md     (brief original, histórico)
├── research-findings.md   (research de diseño, histórico)
├── inspiration/           (capturas curadas: MP, John Deere, Auravant, Mobbin, etc.)
├── explorations/          (exploraciones SUPERADAS — "Campo Profundo" archivado; ver su README)
└── stitch-iter-*/         (iteraciones de Stitch; stitch-iter-4 = home + nav firmados)
```

## Cómo se usa

- ✅ `inspiration/` = referencia visual real (medir patrones, no estimar — ver skill `design-review`).
- ✅ `explorations/` = ideas reutilizables JIT (componentes/a11y/dark del draft viejo), NO canónico.
- ✅ `stitch-iter-4/` = la home + nav aprobados, como referencia de dirección.
- ❌ Nada de esta carpeta es la fuente de tokens. Esa es `app/tamagui.config.ts` (+ `docs/design-system.md`).

## Nota sobre Stitch / Figma

ADR-023 **demotó** las herramientas de diseño a inspiración (ninguna genera Tamagui nativo; código = fuente). El workflow de importar `tokens.json` a Figma (Tokens Studio) que describía `docs/setup-frontend.md` quedó **histórico** — no se mantiene un `tokens.json` paralelo.
