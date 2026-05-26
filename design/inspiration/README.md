# /design/inspiration — Material de research curado

Capturas y referencias visuales de apps reales para informar el design system de RAFAQ. Material de la **Fase 1 — Inspiración** (ver `progress/current.md` y `design/README.md`).

## Estructura por categoría

```
01-agtech-rural/          Agricultura, ganadería, agrotech (Auravant, JDOC, FieldView, CattleMax)
02-blue-collar-manga/     Field service y blue-collar mobile (Procore, ServiceTitan, Fieldwire, Jobber)
03-pro-tools/             B2B pro con typography fuerte (Linear, Notion, Stripe, Attio, Vercel)
04-onboarding-wizards/    Flujos signup + multi-step específicos (cross-categoría)
05-data-heavy/            Fintech con densidad numérica (Cash App, Robinhood, Coinbase)
06-argentino/             Latam con sensibilidad local (Mercado Pago, Modo, Ualá, Brubank)
07-outdoor-dual-mode/     Apps outdoor con alto contraste (onX Hunt, AllTrails, Komoot, Strava)
08-healthcare-pro/        Pro healthcare mobile (Epic Rover, Doximity, One Medical)
99-antipatterns/          Competencia fea, qué NO hacer (Allflex, Tru-Test, Datamars)
```

## Convención de nombres

`{app}-{flow}-{n}.png` minúsculas y guiones.

Ejemplos:
- `linear-signup-step2.png`
- `auravant-empty-state.png`
- `jobber-create-business.png`

## Notas por categoría

Cada subcarpeta tiene un `_notes.md` con tags por screen:

```markdown
## linear-signup-step1.png
- [palette] paleta neutra con accent púrpura
- [typography] sans condensada para títulos
- [pattern] step indicator dots arriba
- [keep] copy minimalista, tone serio sin acartonado
- [skip] el accent púrpura no encaja con ganadería
- [mobbin] https://mobbin.com/screens/...
```

**Tags útiles**: `[palette]`, `[typography]`, `[pattern]`, `[density]`, `[copy]`, `[layout]`, `[motion]`, `[icon]`, `[keep]`, `[skip]`, `[adapt]`, `[anti]` (anti-patrón), `[mobbin]` (link a la screen original).

## Análisis posterior

Cuando se cubran las 8 categorías con material curado, se genera `design/research-findings.md` con:
- Patrones recurrentes (frequency analysis).
- 3 direcciones de mood contrastadas, no solo Campo Profundo.
- Tipografías candidatas justificadas.
- Density target para los dos perfiles de usuario (peón en manga vs vet en oficina).
- Referencias específicas pantalla por pantalla del wizard signup del spec 01.

Recién después se cierra el design system con un ADR nuevo y `design/tokens.json` canónico.
