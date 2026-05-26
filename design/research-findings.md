# RAFAQ — Research Findings de Diseño (Fase 1)

**Fecha**: 2026-05-26
**Source**: 41 screens revisadas en 6 categorías vía Mobbin MCP (Pro account) + análisis curado en `design/inspiration/`
**Status**: borrador para discusión — NO formaliza decisiones, **alimenta la decisión que toma Raf**

---

## TL;DR

De la fase 1 emergen **3 direcciones viables** para el design system de RAFAQ, cada una validada por al menos una app real exitosa. Una 4ta dirección (premium editorial con serif) se descarta como dirección principal pero queda como referencia tonal para futuro marketing.

Recomendación operativa: **probar dirección A híbrida con disciplina C en Stitch primero**, generar el flujo signup en alta fidelidad, comparar contra dirección B si hay duda, decidir con evidencia. Recién después ADR nuevo + tokens canónicos.

---

## Las 3 direcciones contrastadas

### A — Campo Profundo (tierra, criollo-pro)

**Inspirado por**: komoot (validación más fuerte — paleta exacta funcionando), Lifesum (verde profundo + número gigante blanco).

**Paleta candidata**:
```
verde oliva oscuro    #2D4A2A   primario / CTA secundario
verde sage            #6BA46B   accents, success
cream cálido          #FAF6EC   fondo
cream elevado         #FFFFFF   surface (light) o ajustar
terracota oscuro      #C2511F   CTA primario (light)
terracota luminoso    #E87545   CTA primario (dark)
graphite              #1A1A1A   texto principal (light)
```

**Tipografía**: Inter o Manrope sans, no serif.

**Mood**: tierra, calmo, criollo-profesional. "Esto entiende mi mundo".

**Pro**:
- Máxima cercanía cultural al productor argentino.
- Paleta probada en outdoor real (Komoot, +13M usuarios).
- Refuerza identidad propia, diferente a competencia agtech anglo (que tiende a verde-amarillo industrial).
- El "verde profundo + número blanco gigante" funciona técnicamente para mostrar KPIs ganaderos.

**Contra**:
- Riesgo de "muy verde campo cliché" si no se calibra. Si se calibra mal cae en estética gauchesca tipo postal.
- Saturación moderada de "verde" en competencia agtech — vale diferenciar con tono terracota como CTA exclusivo.

**Refs concretas**: `00-mood-candidates/komoot-recenter-start.png`, `00-mood-candidates/lifesum-dashboard.png`, `07-outdoor-offline/komoot-navigate-save-offline.png`.

---

### B — Verde Teal Fresco (B2B SaaS moderno)

**Inspirado por**: Gusto Mobile (la referencia más cercana — paleta teal fresca con card iluminada como hero).

**Paleta candidata**:
```
verde teal            #0E7C66   primario / CTA primario
teal claro            #4FA994   accents, success
cream                 #FAF7F0   fondo
white                 #FFFFFF   surface
dorado mostaza        #D4A032   accent secundario
slate                 #2C3E50   texto principal
```

**Tipografía**: Inter sans, opcionalmente Manrope para mayor calidez.

**Mood**: moderno, fresco, B2B SaaS profesional. Estética "Stripe-meets-agtech".

**Pro**:
- Lectura "moderno y profesional" inmediata.
- Distintivo en agtech (la mayoría usan oliva/amarillo industrial).
- Escalable: si en el futuro RAFAQ se extiende a otras categorías (porcino, equino, tambo), el teal no está "atado al campo".
- El teal de Gusto se siente menos "rural" y más "tool moderno".

**Contra**:
- Menos identificación cultural inmediata con el productor argentino.
- Riesgo de sentirse "fintech-y" en lugar de "del campo".
- Si el vet socio es conservador, puede leerlo como "moderno gringo".

**Refs concretas**: `00-mood-candidates/gusto-welcome-teal.png`.

---

### C — Pro-Clean Minimalismo (sobrio, premium)

**Inspirado por**: Attio (signup minimalista extremo), Linear (referencia implícita por reputación), Stripe (paleta neutra).

**Paleta candidata**:
```
white                 #FFFFFF   fondo
near-black            #0F0F0F   texto principal
slate light           #F4F5F7   surface / cards
graphite              #5D6573   texto muted
accent brand          #C2511F   un único color brand (terracota o teal — definir)
border                #E5E7EB   bordes sutiles
```

**Tipografía**: Inter (display bold para headlines, regular para body) + opcionalmente JetBrains Mono para números.

**Mood**: sobrio, premium, B2B serio. Estética "tool de profesionales que respetamos".

**Pro**:
- Máxima legibilidad — el fondo blanco/casi-blanco siempre gana en contraste.
- Sin riesgo de "verse rural cliché".
- Escalable a cualquier vertical futura.
- La disciplina de "una decisión por pantalla" se aplica de forma natural.

**Contra**:
- Puede sentirse desconectado del campo — el productor podría leerlo como "esto no es para mí".
- Riesgo de "frío" si el accent no le da calidez.
- Dual theme (light + dark) menos diferenciado — todo blanco/negro tiende a verse igual en ambos.

**Refs concretas**: `00-mood-candidates/attio-signup-minimal.png`.

---

### D (descartada como dirección principal) — Premium Editorial con Serif

**Inspirado por**: Neo Financial (dark + dorado + serif + ilustración custom).

**Por qué se descarta como dirección principal**: el contexto manga (operador con guantes, sol fuerte, una mano) requiere robustez visual. Serif display + mood lifestyle editorial **no resiste el contexto operativo**. Las apps que usan este mood son típicamente fintech consumer o lifestyle, no herramientas de trabajo.

**Por qué se conserva como referencia**: el tono "premium con alma" puede ser útil para **landing de marketing, splash inicial, comunicaciones externas, materiales de venta**. La idea de **ilustraciones custom del campo argentino** (vacas, manga, paisajes pampeanos) sí vale considerar para áreas no operativas de la app.

**Ref**: `00-mood-candidates/neo-financial-dark-illustration.png`.

---

## Patrones universales (aplican a las 3 direcciones)

Estos patterns se confirmaron por **frecuencia recurrente** (>=3 apps los usan) y son **independientes de la dirección elegida**. Cualquiera que sea A, B o C, estos quedan.

### 1. CTA primaria fija fixed-bottom con brand color exclusivo
**Frequency**: 10 de 13 wizards revisados (77%). **Validado por**: Jobber, monday, Attio, Lightyear, PayPal, Wise, Airwallex, Shopee, Revolut Business, Vivid.
**Implicación**: el botón primario va anchored al bottom, color brand exclusivo, alto contraste.

### 2. Step indicator visible en wizards multi-paso
**Variantes**: barra horizontal (Jobber, Wise) · dots conectados con línea (Shopee — el más limpio) · dots simples (monday).
**Recomendación para RAFAQ**: dots conectados estilo Shopee — más prolijo para 3-4 pasos.

### 3. Hero number centrado para métricas principales
**Frequency**: 5 apps. **Validado por**: Lifesum (`1286 KCAL`), MacroFactor (`165.0 lbs`), Revolut (`$0 Revenue`), Docusign (`0 Action Required`), Otter (`599 mins`).
**Implicación para RAFAQ**: el dashboard de KPIs (% preñez, conteo total, peso promedio) usa hero numbers centrados, no tablas.

### 4. Validation rules inline visible bajo input
**Frequency**: 3 apps. **Validado por**: PayPal, Lightyear, Zocdoc.
**Implicación para R1.1 spec 01**: el campo password muestra rules abajo con checkmarks que se van marcando (`✓ 8 caracteres`, `✓ una mayúscula`, etc).

### 5. Offline como CTA visible
**Frequency**: 2 apps outdoor. **Validado por**: Komoot ("Save offline" outline), AllTrails ("Downloaded" chip).
**Implicación para RAFAQ (offline-first)**: cuando hay acción que requiere conectividad, el equivalente offline NO se esconde — es CTA igual de visible.

### 6. Welcome con preview de valor
**Frequency**: 1 app fuerte. **Validado por**: Monarch (mostra cards de UI real antes del signup).
**Implicación**: el splash de RAFAQ puede mostrar mini-cards de "127 vacas activas", "última sesión hace 3 días" — promete el valor antes de pedir signup.

### 7. Lista de tasks pendientes como rows en empty state
**Frequency**: 3 apps. **Validado por**: Jobber, Docusign, Withings.
**Implicación para R6.5 spec 01**: el empty state puede ir más allá del CTA dual y mostrar lista de pasos pendientes ("Cargá tu primer animal", "Asigná un rodeo", "Conectá un bastón").

### 8. Timeline vertical para chronology
**Frequency**: 1 app fuerte. **Validado por**: Revolut Business.
**Implicación para ficha de animal (spec 02 acceptance 4)**: cada evento (nacimiento, vacunación, pesaje, parto, etc.) como punto vertical conectado con línea, con acción inline en el evento activo.

### 9. CTA dual sólido + outline para empty states con dos acciones
**Validado por**: Kakao T (match exacto para R6.5), Shopee ("Back" + "Next"), Vivid ("Open account" + "Log in").
**Implicación para R6.5 spec 01**: "Crear mi primer campo" (sólido) + "Pegar link de invitación" (outline).

### 10. Bocadillo dark de máximo contraste para alerts críticos
**Frequency**: 2 apps. **Validado por**: Apple Maps, Waze.
**Implicación**: alerts importantes durante carga ("TAG ya registrado", "Sin BLE", "Sin conexión") van como bocadillo dark visible sobre cualquier fondo.

### 11. Stepper horizontal compacto dentro de card de status
**Validado por**: Revolut Business (mini-stepper dentro del card "Request to accept payments").
**Implicación**: sesiones en curso o procesos asíncronos pueden mostrar mini-stepper dentro de su card de status.

---

## Decisiones que el research afirma vs el draft Campo Profundo

| Decisión del draft | Status post-research |
|---|---|
| Dual theme (light + dark) desde día 1 | ✅ Validado — Revolut Business demuestra dark mode para signup serio business |
| Tipografía sans no serif | ✅ Validado — todas las apps B2B pro usan sans (Inter dominante) |
| CTA exclusivo color brand | ✅ Validado — universal en 10/13 wizards |
| Touch targets ≥48px CTAs primarios 60-64px | ✅ Validado — Jobber, Procore, Shopee respetan |
| WCAG AAA texto principal | ⚪ No probado directamente — todas las direcciones lo permiten técnicamente |
| Paleta verde botella + terracota + cream | ⚠ **Una opción entre tres** — A es la candidata, B y C son alternativas viables |
| Iconografía Lucide | ⚪ No probado — sigue siendo decisión separada del mood |
| Inter como typography | ✅ Validado — Inter aparece dominante en B2B mobile |

---

## Lo que falta cubrir antes de cerrar

### Tareas offline pendientes para Raf (Mobbin no las tiene)

1. **Apps argentinas reales** — descargar al device y capturar:
   - **Mercado Pago** signup + home (trust patterns AR + copy español)
   - **Modo** signup + home
   - **Ualá** signup + home
   - **Brubank** signup + onboarding business
   - Guardar en `design/inspiration/06-argentino/` con su `_notes.md`.

2. **Apps agtech específicas** — descargar al device (algunas requieren cuenta):
   - **Auravant** (argentino — referencia más cercana culturalmente)
   - **John Deere Operations Center**
   - **Climate FieldView**
   - **CattleMax** o similares de cría
   - Guardar en `design/inspiration/01-agtech-rural/`.

3. **Competencia directa fea (antipatterns vivos)**:
   - **Allflex Senior** / **APR3** (apps de los bastones de competencia)
   - **Tru-Test Datalink**
   - **Datamars**
   - Guardar en `design/inspiration/99-antipatterns/` — son tu mejor argumento de diferenciación.

### Categorías que podríamos browsear más en Mobbin si hace falta

- **Data viz numérica avanzada** — Cash App, Stripe, Robinhood, Coinbase para patterns de tablas de animales con muchos números y filtros.
- **Account/workspace switcher** — para el switcher de establishment activo (R6.1).
- **Detail view de entidad** — patterns específicos para ficha de animal.

---

## Recomendación operativa (qué hacer ahora)

### Paso 1: revisar este doc + el material curado

Raf lee este doc + entra a `design/inspiration/` y mira las 22 PNGs descargadas + los `_notes.md`. Tiempo estimado: 30-45 min.

### Paso 2: decidir dirección candidata principal

Mi recomendación: **A híbrida con disciplina C** — Campo Profundo (paleta tierra) + minimalismo Attio (una decisión por pantalla, vasto whitespace). Razones:
- A tiene cercanía cultural máxima.
- C aporta la disciplina B2B serio que evita que A caiga en cliché rural.
- La combinación da un look diferenciado: ni industrial-anglo, ni fintech-millennial, ni rural-folclórico.

**Alternativa fuerte**: si Raf prefiere distancia del cliché agtech, **B con disciplina C** — verde teal fresco con minimalismo. Más "tool moderno", menos "del campo".

### Paso 3: validar en Stitch

Tomar la dirección elegida y generar **el flujo signup wizard del spec 01** en Stitch con un brief escrito desde estos findings (NO desde el doc viejo `docs/design-system.md`). Comparar contra una segunda dirección si hay dudas.

### Paso 4: auditar prompt del Notion

Sigue pendiente. Cuando Raf lo copy/paste, audito con los criterios ya enumerados (prompt injection, secrets handling, hooks auto-ejecutables, etc.).

### Paso 5 (recién entonces): formalizar

ADR nuevo (probablemente -016 si seguimos el orden) + `docs/design-system.md` canónico (reemplazo del draft 0.1) + `design/tokens.json` actualizado y marcado como canónico + plan de implementación a Tamagui.

---

## Material descargado

Total: **22 screens** organizadas en 7 carpetas bajo `design/inspiration/`. Cada carpeta tiene su `_notes.md` con tags, descripciones y links a Mobbin.

| Carpeta | Screens | Tema |
|---|---|---|
| `00-mood-candidates/` | 5 | Una imagen por dirección de mood (A, B, C, D, validación) |
| `01-agtech-rural/` | 3 | Tracking individual + greeting personal |
| `02-blue-collar-manga/` | 4 | Field service + wizards business + steppers |
| `03-pro-tools-dashboards/` | 3 | Hero numbers + timeline vertical |
| `04-onboarding-wizards/` | 4 | R6.5, validation, madlib, preview value |
| `07-outdoor-offline/` | 3 | Offline visible, stats card, dark alert |
| `99-antipatterns/` | 1 | Qué NO hacer (Cleo) |

Carpetas vacías a llenar por Raf: `05-data-heavy/`, `06-argentino/`, `08-healthcare-pro/` + complementar `01-agtech-rural/` y `99-antipatterns/`.
