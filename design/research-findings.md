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

## Validaciones device — Mercado Pago + Auravant (2026-05-26)

Raf cargó **26 capturas adicionales** del device, dos casos que cierran categorías que Mobbin no cubre y refinan la dirección del design system.

### Mercado Pago (16 screens: register + home + 3 tabs) — Validación argentino-profesional ⭐⭐⭐

Para Raf el flujo le pareció "moderno, pro, alta UX/UI". Validaciones concretas:

| Hallazgo | Implicación para RAFAQ |
|---|---|
| Voseo argentino constante ("Ingresá", "Asegurate", "Sacate", "Buscá") | El copy del MVP usa voseo. `CLAUDE.md` ya lo dice; MP es validación viva del registro. |
| Header brand persistente amarillo + greeting `Hola, Rafael ›` + chevron al perfil + bell + pill `Ayuda 24 hs` | Molde para top bar persistente en home de RAFAQ con greeting + chevron + bell + soporte visible. |
| Wizard "tarjetas con CTA solo en activo" (no step indicator clásico) | Patrón **objetivamente mejor** que dots/barra para wizards de pasos independientes — sabés exactamente qué hacer ahora. Adoptable para R3 spec 01 (crear establishment). |
| Microcopy explicativo en cada step | "El documento determinará quién será titular", "Recibirás información de tu cuenta" — explica por qué pedimos el dato. Adoptable para todos los inputs de RAFAQ. |
| Helper text grey bajo inputs con formato | "Usá el formato nombre@ejemplo.com", "Ingresá solo números, sin puntos, espacios ni guiones". Adoptable para TAG, IDV, teléfono, etc. |
| CTA disabled hasta input válido | Feedback claro de "falta algo". |
| Reenviar OTP **por WhatsApp** como opción primera | Sensibilidad cultural argentina máxima. Para invitaciones spec 01 R5 (link shareable), share sheet va a priorizar WhatsApp — validado. |
| Autocomplete inteligente de dominios email | Microinteraction delicada — aplicable a input de TAG con autocomplete de TAGs leídos recientes en la sesión. |
| Pre-fill `+54` detección país automático | Pre-fill inteligente reduce fricción. Aplicable a campos con default obvio (especie del establishment, sistema de cría). |
| Confirmación visual de pasos completados (checkmark verde + texto grey muted + edit icon) | Feedback inmediato + permite corregir sin retroceder. |
| Persona real argentina en hero (no ilustración stock) | Trust pattern cultural fuerte. **Idea para landing/marketing**: persona real productor argentino del campo. |
| Home post-login: top bar brand + card hero blanca + 4 quick actions circulares + grid 4x2 secundarias + FAB central en bottom nav | Molde directo para home post-establishment de RAFAQ (R6.1). |
| Privacy toggle de números sensibles (ojo cerrado en saldo) | Patrón útil para datos sensibles (cantidad de animales, valor del rodeo). |
| Chip inline `▲ Rinde 18,2%` verde para tendencia | Compacto para KPIs con dirección (`▲ Preñez 84%`, `▼ Mortalidad 0,8%`). |

**Lectura cromática**: MP usa amarillo brand top bar + blanco cards + azul brand acciones + cards oscuras + accents verde para tendencia. Es la **arquitectura visual** que adoptamos (top bar brand persistente + cards blancas elevadas + accent funcional), pero la paleta concreta depende de qué dirección elijamos (A Campo Profundo, B Teal Fresco, C Pro-Clean).

**MP refuerza la dirección A híbrida con C** porque:
- Usa identidad de marca FUERTE en el top bar (yellow MP) — Campo Profundo verde puede hacer lo mismo.
- Cards blancas elevadas con disciplina (mucho whitespace, una decisión por pantalla) — eso es C Attio aplicado.
- Acción primaria en bottom anchored — universal.

#### Estructura de navegación principal (bottom nav) — propuesta a partir de MP

Las 3 capturas adicionales de las pestañas del bottom nav de MP (`Actividad`, `Beneficios`, `Más`) sugieren una **estructura tentativa de navegación principal para RAFAQ** que resuelve dos features core simultáneamente (Raf marcó que **MODO MANIOBRA** y **BUSCAR ANIMAL** son funcionalidades CORE del producto, ambas con peso comparable):

```
[ 🏠 Inicio ] [ 🐄 Animales ] [ ⚡ Modo Maniobra (FAB) ] [ 📊 Reportes ] [ ☰ Más ]
```

| Tab | Rol | Inspiración | Spec |
|---|---|---|---|
| **Inicio** | Home post-establishment con KPIs + quick actions (4 circulares) | `mercadopago-homepage` | R6.1 (spec 01) |
| **Animales** | BUSCAR ANIMAL — stats 2-col scrolleable + search permanente + chips de filtros + lista agrupada | `mercadopago-tab-actividad` | spec separada CORE (a definir, Raf lo va a explicar) |
| **⚡ Modo Maniobra (FAB)** | Acción más crítica del operador en manga, elevada al centro del bottom nav | FAB QR central de MP | spec 03 (CORE) |
| **Reportes** | KPIs del rodeo, comparativas, exportaciones SIGSA | (estructura propia) | spec 07 + spec 08 |
| **Más** | Settings, perfil, theme switch, ayuda, sesión | `mercadopago-tab-mas` | varios |

**Por qué este pattern encaja**:
- **FAB central elevado** comunica "esto es lo más importante" — para el operador en manga, MODO MANIOBRA es exactamente eso. Además es el botón más accesible para una mano enguantada (centro del thumb-zone).
- **`Animales` como pestaña dedicada** (no como sub-menú) refleja la centralidad de BUSCAR ANIMAL — Raf lo marcó como CORE.
- **`Reportes` como pestaña dedicada** (no como sub-menú de Más) refleja que el productor argentino paga la app por los reportes (analytics + KPIs + benchmarking según memoria `product-positioning`).
- **El tab `Actividad` de MP es plantilla casi 1:1 para `Animales` de RAFAQ**: stats arriba (`Activos / Preñadas / En venta`) + search permanente + chips de filtros + lista agrupada por categoría o fecha + row con icono + TAG + categoría + estado + valor.
- **El tab `Más` de MP es plantilla directa**: bloque perfil top + banner destacado + lista vertical con icono + chevron + separators.

**Próximo paso (cuando armemos pantallas en Stitch)**: validar esta estructura en mockup high-fi del bottom nav + las 5 pestañas. Si Raf valida el pattern, queda como decisión de navegación principal antes de detallar cada pestaña.

> ⚠ **Nota sobre BUSCAR ANIMAL**: Raf adelantó en chat que es funcionalidad CORE igual que MODO MANIOBRA, y va a explicar el flujo en otra sesión para que escribamos las specs. **Hoy no existe en `feature_list.json`** — probablemente sea spec separada (ej. `09-buscar-animal`) o extensión sustantiva del `02-modelo-animal`. Cuando Raf lo explique, definimos si requiere nueva feature.

### Auravant (10 screens crear-registro) — Validación funcional para MODO MANIOBRAS (spec 03) ⭐⭐

Para Raf "fea estéticamente pero parecido en funcionalidad a lo que tenemos que hacer". Es **referencia híbrida**: anti-patrón estético + pro-patrón funcional. El flujo `crear actividad` de Auravant mapea casi 1:1 con `iniciar sesión de maniobras` que necesitamos en RAFAQ.

| Hallazgo funcional | Implicación para RAFAQ |
|---|---|
| Top bar persistente con contexto activo jerárquico (`Season 25/26 / Farm Trial / Field Lote1`) | Molde para barra siempre visible en RAFAQ con `Establecimiento / Rodeo` activos. El operador NUNCA pierde contexto en manga. |
| Grid 2x2 de cards "tipo de algo" para selección principal (Sowing/Application/Harvest/Other) | Molde directo para "Seleccionar maniobra" en spec 03 — 4 cards principales (MOVILIZACIÓN / PESAJE / VACUNACIÓN / OTRO) cada una con icono + label. |
| Modal sheets stacked que mantienen contexto previo visible (disabled) | Pattern para flujos multi-step sin perder de vista lo que ya elegiste. |
| Form principal con secciones agrupadas (HARVEST DATA / NOTES / COSTS / ADVANCED) | Molde para form de "cargar evento" o "detalles de sesión" con grupos lógicos. |
| `Add machinery / Add person` como mini-cards inline al final del form | Patrón para "agregar entidades relacionadas" durante el flow. Para RAFAQ: `+ Agregar bastón / + Agregar balanza / + Agregar vet presente`. |
| Chip de estado inline en el form (`Planned` + pencil) | Mostrar estado del registro mientras se edita (Planificada / En curso / Confirmada). |
| Dropdowns inline para unidades (ha, Tn/ha) | Para campos con units en RAFAQ: kg, %, dosis, días. |
| Lista agrupada por entidad parent + kebab `⋮` por row | Patrón para listar sesiones agrupadas por rodeo, o eventos agrupados por animal. |
| **Mismo form para crear y editar** (DRY) | Principio crítico para implementación: un solo componente form que se prepopula con datos en edit. Reduce código + UX consistente. |
| Selector full-sheet con search bar + lista | Para elegir entre N opciones (categorías de animales, vacunas, etc.). |
| Date range picker From/To | Filtros de período en reportes (spec 07). |
| Filtros chips horizontales scrolleables con activo destacado | Para filtrar listas de animales en spec 02. |

**Lo que NO se copia de Auravant**: paleta gris-azul-saturado + verde lima + cards lila claro = sin armonía; chips angulados con bordes oblicuos = caprichoso; tipografía sin jerarquía clara; forms underline-only = look "Material 2017"; números con 13 decimales sin truncar.

**Insight clave**: si RAFAQ adopta la **arquitectura funcional de Auravant** con **dirección A híbrida con C** + **microinteractions estilo MP**, ofrece a productores argentinos un agtech con estética B2B pro que la competencia (Allflex/Tru-Test/Datamars/incluso Auravant mismo) no tiene. Diferenciación de producto vía UX.

### Nuevo patrón universal (#12) emergente de las capturas device

**Wizard "tarjetas con CTA solo en el activo"** (MP). Pattern que reemplaza al step indicator clásico cuando los pasos son independientes o pueden completarse en orden flexible. Los items completados muestran checkmark verde + texto muted + edit icon; los pendientes muestran sólo label/descripción sin CTA; sólo el activo tiene card elevada + CTA visible.

**Aplicable a**: cualquier flujo donde N pasos contribuyen a un objetivo (signup, crear establishment, configuración inicial), pero el usuario no necesariamente los hace en orden estricto.

---

## Lo que falta cubrir antes de cerrar

### Tareas offline pendientes para Raf (Mobbin no las tiene)

1. **Apps argentinas adicionales** (opcional — MP ya cubre lo más importante):
   - **Modo** signup + home (alternativa fintech AR)
   - **Ualá** signup + home (fintech popular, target masivo)
   - **Brubank** onboarding business (más afín a B2B)
   - Guardar en `design/inspiration/06-argentino/` con notas adicionales.

2. **Apps agtech específicas** adicionales (opcional — Auravant ya cubre el flujo crítico):
   - **John Deere Operations Center** (paleta verde-amarillo industrial pro)
   - **Climate FieldView** (limpio, datos densos)
   - **CattleMax** o similares de cría USA
   - Guardar en `design/inspiration/01-agtech-rural/`.

3. **Competencia directa fea (antipatterns vivos)** — **prioritario**:
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

Total: **48 screens** organizadas en 8 carpetas bajo `design/inspiration/` (22 vía Mobbin MCP + 26 capturas device de Raf). Cada carpeta tiene su `_notes.md` con tags, descripciones y links a Mobbin cuando aplica.

| Carpeta | Screens | Tema |
|---|---|---|
| `00-mood-candidates/` | 5 | Una imagen por dirección de mood (A, B, C, D, validación) |
| `01-agtech-rural/` | 13 | Mobbin: Fi + Withings (3) · **Device Auravant** (10) — referencia funcional MODO MANIOBRAS |
| `02-blue-collar-manga/` | 4 | Field service + wizards business + steppers |
| `03-pro-tools-dashboards/` | 3 | Hero numbers + timeline vertical |
| `04-onboarding-wizards/` | 4 | R6.5, validation, madlib, preview value |
| `06-argentino/` | 16 | **Device Mercado Pago** — register completo + home + 3 tabs bottom nav (Actividad/Beneficios/Más) ⭐⭐⭐ |
| `07-outdoor-offline/` | 3 | Offline visible, stats card, dark alert |
| `99-antipatterns/` | 1 | Qué NO hacer (Cleo) |

Carpetas vacías opcionales: `05-data-heavy/`, `08-healthcare-pro/`. Para complementar: más apps argentinas en `06-argentino/` y antipatterns reales (Allflex/Tru-Test/Datamars) en `99-antipatterns/`.
