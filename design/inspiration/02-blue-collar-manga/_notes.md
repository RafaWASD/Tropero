# 02 — Blue-Collar / Field Service / Wizards business

Refs directas para tu **wizard "crear establishment"** (R3 spec 01) y para el lado **manga** (operario con guantes/sol). Field service apps + business onboarding bancario.

---

## jobber-business-setup.png · Jobber ⭐⭐ (match más cercano)

**El match más cercano a crear establishment en RAFAQ**. Field service real (contractors/blue-collar mismo perfil que productor argentino).

Step indicator: barra horizontal verde brand (1/3 completo aprox) + AI sparkle arriba der. Headline display bold `Tell us about your business` + subtítulo conciso explicativo. Dos inputs: Company name (outline) + Industry dropdown. CTA "Next" verde sólido fixed bottom.

- [palette] verde dark brand + greys neutros + ivory cream
- [typography] **display bold large para headline** (~32px estimado)
- [pattern] step indicator + headline + form 2-campos + CTA fixed
- [keep] **estructura entera** — adoptable directamente para "crear establishment"
- [adapt] cambiar "Company name" → "Nombre del campo", "Industry" → sistema (cría/invernada/etc)
- [mobbin] https://mobbin.com/screens/1df9a76a-ab8c-4225-ae60-cd1ecebba0aa

---

## jobber-home-onboarding-tasks.png · Jobber ⭐

**R6.5 expandido** — empty state con lista de tasks pendientes como rows clickeables.

"Wednesday, December 3rd" header con bell + AI sparkle. Tres rows de onboarding tasks ("Build your client list", "Create a customized schedule", "Try Jobber on desktop") cada una con icono + título + subtítulo + flecha verde. Sección "Business health" con métricas. Sección "Discover".

- [pattern] **lista de tasks pendientes para que el usuario sepa qué hacer**
- [keep] R6.5 spec 01 puede ir más allá de CTA dual — ser una lista expandible de "siguientes pasos" cuando el campo está vacío (sin animales, sin rodeos, sin sesiones)
- [adapt] paleta + iconos
- [mobbin] https://mobbin.com/screens/7c26cbf3-c152-4731-b827-e411bcbd5cc7

---

## revolut-business-dark-signup.png · Revolut Business ⭐

**Validación de dark mode para signup serio** — banco para empresas, no juguete.

Headline display bold blanco `Legal business type` + body grey + dropdown dark "Exempt Private Company Limited by S..." con chevron blanco. Vasto whitespace inferior. Checkbox de marketing opt-in con copy chico. CTA "Continue" pill blanco sólido (alto contraste sobre negro).

- [palette] negro #000 + dark surface + texto blanco + CTA blanco pill
- [pattern] form denso pero **vasto whitespace** para reducir abrumo
- [keep] **prueba viva de dual theme** para business signup — refuta la objeción "dark no encaja en pro"
- [adapt] negro puro probablemente muy "tech", probar dark más cálido (#0D1813 estilo Campo Profundo)
- [mobbin] https://mobbin.com/screens/450b32a8-c094-44cc-b6f8-14dc3cdd8504

---

## shopee-stepper-horizontal.png · Shopee ⭐⭐ (mejor step indicator)

**El mejor step indicator que vimos**. Dots numerados conectados con línea horizontal en estados ✓ ● ○.

Header "Shop Information" + "Save" link naranja. Stepper: `Identity Verification ✓ (sólido naranja)` ── `Shop Information ● (naranja outline activo)` ── `Upload Product ○ (gris)`. Form con 4 campos (Shop Name con contador 15/30, Address & Shipping con sublabel grey, Email, Phone). CTA dual fixed bottom: "Back" outline naranja + "Next" sólido naranja.

- [pattern] **stepper horizontal con dots + label + línea conectora** — el cleanest para wizards 3-4 pasos
- [keep] **stepper exacto** para wizard crear establishment (3 pasos: nombre → teléfono opcional → ubicación)
- [keep] CTA dual "Back" outline + "Next" sólido para wizards multi-step
- [adapt] paleta naranja → terracota Campo Profundo (coincide)
- [mobbin] https://mobbin.com/screens/4cf2458c-3ddc-47bb-9d79-3f7c2a709fa8
