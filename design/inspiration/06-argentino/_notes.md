# 06 — Argentino / Latam (capturas device de Raf, no Mobbin)

Mobbin no tiene Mercado Pago, Modo, Ualá, Brubank ni ningún fintech argentino. Material capturado por Raf directamente del device, 2026-05-26.

**MP es la referencia argentina más importante** para RAFAQ — sensibilidad local + alta UX + identidad visual fuerte. 13 capturas: 12 del flujo de register completo + 1 home post-login.

---

## mercadopago-homepage.jpeg ⭐⭐⭐ — Home post-login

**Es el molde directo del home post-establishment de RAFAQ (R6.1 spec 01)**.

Top bar amarillo brand persistente:
- Avatar circular pequeño con logo MP
- Greeting personalizado `Hola, Rafael ›` con chevron al perfil
- Bell con badge `3` (notificaciones pendientes)
- Pill outline `Ayuda 24 hs` top-right

Card hero blanca elevada sobre yellow:
- Label `Disponible` + chip verde inline `▲ Rinde 18,2%` (tendencia positiva)
- Link blue `Ir a movimientos ›` top-right
- Saldo `$***` con ojo cerrado 🔒 (privacy toggle)
- Grid 4 quick actions circulares: `Ingresar / Transferir / Sacar / Tus alias`
- Card oscura horizontal "Mastercard crédito" con info de tarjeta + banner amarillo bottom "Comprá con tarjeta y ganá premios"
- Carrusel preview de otra tarjeta a la derecha

Card blanca secundaria:
- Grid 4x2 de acciones (Pagos, Recargar celular, Cargar transporte, Pagar viaje con QR, Delivery, Cobrar ahora, **Recomendar la app** con badge `CONOCÉ` amarillo, Ver más)
- Iconos azul brand outline minimalistas

Card promocional product:
- Producto físico foto + rating ★ 4.7 (15) + nombre + precio

FAB QR azul central en bottom nav (acción más frecuente elevada).
FAB AI sparkle amarillo flotante esquina inferior derecha.

Bottom nav 5 items: `Inicio (activo) / Actividad / [QR FAB] / Beneficios / Más`.

- [palette] amarillo brand top bar persistente + blanco cards + azul brand acciones + negro cards de tarjeta + accents verde tendencia
- [pattern] **top bar brand persistente con greeting personalizado + chevron perfil + bell badge + pill ayuda**
- [pattern] **card hero blanca elevada con valor principal + 4 quick actions circulares**
- [pattern] **grid 4x2 de acciones secundarias** sin entrar a menús
- [pattern] **FAB central en bottom nav** para la acción más usada
- [pattern] **chip inline `▲ Rinde 18,2%`** verde compacto para tendencia positiva
- [pattern] **privacy toggle de números sensibles** (ojo cerrado)
- [pattern] **badge `CONOCÉ` amarillo en feature nueva** para introducir sin obligar
- [pattern] **`Ayuda 24 hs` pill outline** visible siempre — trust pattern argentino fuerte
- [keep] **molde entero adaptable para home de RAFAQ post-creación de establishment**:
  - Top bar verde Campo Profundo: avatar + `Hola, [nombre] ›` + bell + pill `Ayuda`
  - Card hero blanca: nombre del establecimiento activo + KPI principal (ej: `Preñez 84% ▲`) + chevron a reporte + 4 quick actions (Cargar sesión / Ver animales / Escanear TAG / Reportes)
  - Sección secundaria grid 4x2: Configurar campo / Invitar miembro / Exportar SIGSA / etc.
  - FAB central: `Escanear TAG` o `Nueva sesión` (depende del usuario más frecuente)
- [adapt] amarillo MP → verde Campo Profundo (o whatever dirección ganemos); azul acciones → terracota o teal

---

## mercadopago-register-01-landing.jpeg ⭐⭐ — Landing

Splash inicial con persona real argentina sosteniendo tarjeta MP. Top: step indicator carrusel 5 dots + logo MP pill amarillo. Headline blanco bold sobre foto `Te damos la bienvenida a Mercado Pago`. CTA azul brand pill `Abrir cuenta gratis` + linkstyle blanco `Iniciar sesión` debajo.

- [pattern] **persona real argentina como hero** — trust pattern cultural fuerte (en Arg la confianza interpersonal pesa más que la institucional)
- [pattern] **headline blanco sobre foto + CTA pill anchored bottom**
- [keep] **dirección de usar persona real (productor real en campo argentino)** para landing/marketing RAFAQ — mucho más potente que ilustración stock
- [copy] "Te damos la bienvenida a" → cálido sin ser cursi, pluralis modestiae
- [mobbin] N/A (capture device)

---

## mercadopago-register-02-tyc.jpeg — TyC con checkboxes inline

Header amarillo brand + back arrow. Headline display bold `Para empezar, conocé nuestras políticas de uso`. Dos secciones con título + body + link azul + checkbox + label:
- `Declaración de privacidad` + "Al ofrecerte nuestros servicios, tenemos que pedirte algunos datos personales..."
- `Términos y condiciones` + "Cuando utilizás Mercado Pago, tenés derechos y responsabilidades..."

CTA `Continuar` azul brand fixed mid-screen.

- [pattern] **TyC con checkboxes inline en el screen, no enterrados en footer** — mucho más prolijo
- [copy] **voseo constante**: "conocé", "utilizás", "tenés"
- [keep] **pattern de TyC explícito** con dos checkboxes separados (privacy + ToC) en lugar de uno solo combinado

---

## mercadopago-register-03-dni.jpeg — Input DNI/CUIT

Headline `Ingresá un DNI o un CUIT`. Subtítulo body `El documento determinará quién será titular de la cuenta, podés ser vos o tu negocio.` Input outline vacío. Helper text grey `Ingresá solo números, sin puntos, espacios ni guiones.` CTA `Continuar`.

- [pattern] **helper text bajo input** explicando formato esperado
- [pattern] **microcopy explica el por qué** ("El documento determinará quién será titular...") — no asume contexto
- [copy] voseo: "Ingresá", "podés ser vos o tu negocio"
- [keep] **molde para R1.1 spec 01** — explicar por qué pedimos el dato, helper text con formato

---

## mercadopago-register-04-wizard-mail-step.jpeg ⭐⭐⭐ — Wizard "tarjetas con CTA en activo"

**Patrón objetivamente mejor que step indicator** para wizards de pasos independientes.

Headline `Completá los datos para crear tu cuenta`. Lista vertical de 3 items, cada uno con icono circular + título + body:
- `Agregá tu e-mail` / "Recibirás información de tu cuenta." → CTA `Agregar` azul (DENTRO DE CARD ELEVADA blanca)
- `Validá tu teléfono` / "Lo usarás para iniciar sesión en tu cuenta." → sin CTA, sin card (deshabilitado visualmente)
- `Validá tu identidad` / "Nadie más podrá crear una cuenta a tu nombre." → sin CTA, sin card

Solo el item activo tiene card blanca elevada + CTA visible.

- [pattern] **wizard "tarjetas con CTA solo en el activo"** — sabés exactamente qué hacer ahora sin necesitar step indicator
- [keep] **alternativa al stepper de Shopee/Jobber para wizards donde los pasos no son estrictamente secuenciales** (ej: el R3 spec 01 — completar teléfono opcional + nombre del campo)
- [keep] **microcopy explica el valor de cada paso** ("Recibirás información", "Lo usarás para iniciar sesión", "Nadie más podrá crear una cuenta a tu nombre") — vende cada paso

---

## mercadopago-register-05-mail-input.jpeg — Input mail

Headline `Ingresá tu e-mail`. Subtítulo `Asegurate de tener acceso a él.` Input vacío. Helper grey `Usá el formato nombre@ejemplo.com`. CTA `Continuar` disabled grey.

- [pattern] **CTA disabled hasta input válido** — feedback claro
- [pattern] **helper text con ejemplo de formato**
- [copy] "Asegurate" voseo

---

## mercadopago-register-06-mail-autocomplete.jpeg ⭐⭐ — Microinteraction autocomplete

**Microinteraction delicada que ahorra typing**.

Mismo screen escribiendo `RAFAQ@`. Aparece **dropdown overlay** con sugerencias de dominios: `@gmail.com`, `@hotmail.com`, `@yahoo.com`, `@outlook.com`.

- [pattern] **autocomplete inteligente de dominios comunes** cuando se escribe @
- [keep] **idea de microinteractions delicadas** en inputs para reducir typing (especialmente útil en manga donde tipear es difícil con guantes/barro)
- [adapt] para RAFAQ podría aplicarse en input de TAG: autocomplete con TAGs leídos recientemente, o sugerencias por prefijo si todos los TAGs del rodeo tienen un prefijo común

---

## mercadopago-register-07-wizard-phone-step.jpeg ⭐⭐ — Wizard con progreso visible

Mismo screen del wizard de tarjetas, pero ahora:
- Item email tiene **checkmark verde** + texto grey `E-mail agregado / lckkckdobj@gmail.com` + ✏ edit icon — ya completado
- Item teléfono ACTIVO con card elevada + CTA `Agregar`
- Item identidad sigue sin card

- [pattern] **estado completado: checkmark verde + texto grey muted + edit icon** — feedback visual de progreso
- [pattern] **wizard "vivo"**: la pantalla del wizard cambia visualmente a medida que se completan pasos, no es un step indicator estático
- [keep] **molde directo para R3 crear establishment** + cualquier wizard de RAFAQ con pasos independientes

---

## mercadopago-register-08-phone-input.jpeg — Input teléfono con prefijo país

Headline `Ingresá tu teléfono`. Subtítulo `Te enviaremos un código por SMS para validarlo.` Input pre-fill `+54` con código país argentino. Helper grey `Usá el formato código de área + número.` Question icon top-right (help). CTA disabled.

- [pattern] **pre-fill `+54` detecta país automático** — pequeño detalle de UX que reduce fricción
- [pattern] **help icon top-right** accesible sin abrumar
- [keep] **pre-fill inteligente** para inputs de RAFAQ (ej: TAG si el rodeo tiene prefijo común, o tipo de animal según especie del establishment)

---

## mercadopago-register-09-otp-validation.jpeg ⭐⭐ — OTP con WhatsApp argentino

**Sensibilidad cultural argentina máxima**.

Headline `Ingresá el código que te enviamos por SMS`. Subtítulo con número visible + link inline `podés cambiar tu número`. 4 boxes pequeños cuadrados outline + cursor blue en primero. Debajo:
- `Reenviar código por WhatsApp 00:24` (grey con countdown)
- `Reenviar código por llamada 00:24`

- [pattern] **OTP boxes con cursor visible en activo**
- [pattern] ⭐ **reenviar por WhatsApp como opción primera** — en Argentina todos usan WhatsApp. Esto es identificación cultural directa.
- [pattern] **countdown para evitar spam de reenvíos**
- [keep] **idea de adaptar canales de comunicación al contexto argentino** — para invitaciones del spec 01 R5 (link shareable), el share sheet nativo va a priorizar WhatsApp porque es lo que usa el productor argentino. Validado.

---

## mercadopago-register-10-otp-tyc.jpeg — OTP confirmado + opt-in

Headline + subtítulo iguales. Boxes ahora con `2 2 8 0` grey muted + ✓ verde `Código confirmado`. Checkbox pre-marcado `Acepto que me contacten por WhatsApp y/o SMS a este número.` CTA `Continuar` azul ENABLED.

- [pattern] **confirmación visual del OTP correcto** (icono verde + texto)
- [pattern] **CTA se enable solo cuando hay validación correcta**
- [pattern] **opt-in con consentimiento explícito** (pre-marcado por default) para comunicaciones
- [keep] pattern de **estados de input visualmente claros**: vacío / escribiendo / validando / OK / error

---

## mercadopago-register-11-identity-face-step.jpeg — Wizard con 2 pasos completados

Mismo wizard. Email ✓ + Teléfono ✓ (con número `+54 11 4058-7134` visible). Identidad ACTIVO con CTA `Validar` (no `Agregar`, copy distinto por contexto).

- [pattern] **copy del CTA varía según contexto** ("Agregar" para datos, "Validar" para identidad)
- [keep] **adaptar copy del CTA al contexto** — no caer en "Continuar / Siguiente / Next" genérico para todo

---

## mercadopago-register-12-face-prepare.jpeg — Instrucciones antes de cámara

Imagen full-bleed de mujer espalda usando teléfono con preview de captura facial. Headline bold `Sacate una selfie`. Body `Buscá un lugar bien iluminado y no uses objetos como anteojos, gorros o bufandas.` CTA `Sacar selfie` azul fixed bottom.

- [pattern] **instrucciones claras + ilustración real** antes de un step que requiere acción física (foto, scan, etc.)
- [copy] voseo: "Sacate", "Buscá"
- [keep] **molde para pantallas pre-acción** en RAFAQ — antes de escanear TAG, antes de iniciar sesión BLE, antes de pesaje: pantalla preparatoria con instrucciones + ilustración + CTA

---

## mercadopago-tab-actividad.jpeg ⭐⭐⭐ — Pestaña Actividad (molde para BUSCAR ANIMAL)

**Es el molde directo de BUSCAR ANIMAL** que Raf marcó como funcionalidad core del producto (spec todavía no escrita).

Top bar amarillo brand persistente con AI sparkle FAB esquina derecha. Header blanco con `Actividad` display bold grande.

**Stats cards 2-col scrolleable horizontal**:
- `Actividades / 1 / en curso` (label + número + caption)
- `Salidas / $ 2.016.234 / en mayo` (label + número grande + caption)
- (carrusel sugiere más cards a la derecha)

**Search bar pill permanente** con icono lupa + placeholder `Buscar`.

**Chips de filtros horizontales scrolleables**: `⚙ Filtros` (con icono ajustes) · `Transferencias` · `Pagos y compras` · (más a la derecha).

**Lista cronológica agrupada por fecha**:
- Header `Hoy` (bold)
- Row con icono circular outline + nombre destino bold + tipo (Pago) + ícono brand + chip de método (Mastercard crédito) — derecha: monto `-US$22,50` rojo + hora `01:41 hs`
- Header `25 de mayo`
- Row siguiente con mismo pattern (Transferencia enviada / Dinero disponible)

Bottom nav 5 items con `Actividad` **activo en azul brand** (resto grey con label).

- [pattern] ⭐⭐ **stats cards 2-col scrolleable como hero arriba de la lista** — para BUSCAR ANIMAL: `Activos / 127 / en rodeo` · `Preñadas / 89 / 84%` · `En venta / 12 / mayo` · etc.
- [pattern] ⭐ **search bar pill permanente** debajo del stats — siempre visible al filtrar la lista
- [pattern] ⭐ **chips horizontales scrolleables con icono Filtros + categorías** — para RAFAQ: `⚙ Filtros` + `Todos` · `Por rodeo` · `Por categoría` · `Preñadas` · `En venta` · etc.
- [pattern] ⭐⭐ **lista cronológica agrupada por fecha header bold** — para timeline de eventos del animal en ficha individual (spec 02 acceptance 4): `Hoy` / `Ayer` / `25 de mayo` como headers, eventos como rows
- [pattern] **row de actividad con: icono circular outline + nombre + tipo + chip de método / valor + hora a derecha** — molde para row de evento en RAFAQ: icono categoría animal + TAG + tipo evento + chip estado / valor (peso/dosis) + fecha
- [keep] **toda esta pestaña es plantilla casi 1:1 para BUSCAR ANIMAL**:
  - stats arriba (`Activos / Preñadas / En venta`)
  - search permanente (por TAG / IDV / visual_id_alt)
  - chips de filtros (rodeo / categoría / estado / sistema)
  - lista de animales agrupada por categoría o última actividad
  - row de animal con: icono especie + TAG + categoría + último evento + chip estado / fecha
- [adapt] amarillo top → verde Campo Profundo; azul activo → terracota o teal según dirección final
- [meta] esta pestaña sugiere que **el pattern de bottom nav con tab "Actividad/Animales" funciona perfectamente para BUSCAR ANIMAL**

---

## mercadopago-tab-beneficios.jpeg — Pestaña Beneficios (carrusel + lista)

Top bar amarillo brand persistente con AI sparkle FAB esquina. Header blanco `Beneficios` display bold.

**Carrusel hero de cards full-bleed** con cards horizontales scrolleables: card promocional `Conocé tu Tarjeta de Crédito Mercado Pago / Cuotas sin interés en Mercado Libre y más.` con ilustración de tarjeta + fondo azul-cielo gradiente a amarillo.

**Sección `🏆 Tus desafíos`** (icono trofeo + label) con card blanca:
- Icono circular con $ + chip dorado
- `Ganá $ 10.000 de cashback`
- Link blue `Conocer desafío`

**Sección de promociones brand cards 2-col horizontal scrolleable**: foto producto/comercio + logo + texto `¡20% OFF + Cuotas en Arredo!` + `Pagando con QR en tiendas físicas`.

Bottom nav con `Beneficios` activo azul brand.

- [pattern] **carrusel hero full-bleed scrolleable** con cards promocionales — patrón para hero rotativo de tarjetas
- [pattern] **secciones temáticas con icono + label** + cards dentro de cada sección
- [pattern] **chips dorados** (`Conocé`) y badges sobre cards para destacar "lo nuevo"
- [meta] **Esta pestaña NO aplica directamente a RAFAQ** — es marketing/promociones de MP. Pero el pattern de "carrusel hero + secciones temáticas con icono" puede usarse para una eventual pestaña de **"Recomendaciones"** o **"Próximas tareas"** (vacunaciones próximas, pesajes pendientes, animales sin ver hace 30 días). Lo dejo como referencia tonal pero no es prioritario.
- [skip] copy promocional aspiracional no aplica al tono profesional pro de RAFAQ

---

## mercadopago-tab-mas.jpeg ⭐⭐ — Pestaña Más (settings + cuenta + lista navegable)

Top bar amarillo brand persistente. Bloque de perfil grande:
- Avatar circular blanco con icono persona
- Nombre `Rafael` display bold
- `Tu perfil ›` subtítulo + chevron al perfil completo

**Banner promocional `meli+ Total / Suscribite con hasta 40% OFF`** card púrpura-gradiente con chevron.

**Banner `Mercado Libre`** con logo MP + arrow up-right (link externo a la app ML).

**Lista vertical de items** con icono outline + label + chevron a la derecha (solo en items con sub-página):
- 🏠 `Inicio` (link a tab inicio aunque haya bottom nav — útil para discoverability)
- 🔔 `Notificaciones` con badge red `3`
- ✨ `Asistente personal` (AI feature destacada)
- 🔒 `Seguridad` + chip outline azul `CONOCÉ` (badge de "feature nueva sin ver")
- ❓ `Ayuda ›`
- ─── separator ───
- 📥 `Cobrar`
- 💳 `Tu dinero ›`
- 📄 `Reportes de tenencias` + chip outline azul `NUEVO`
- 💼 `Tarjetas`
- 📱 `Recargar celular`
- 💸 `Cuentas y servici...` (truncado)

Bottom nav con `Más` activo azul brand.

- [pattern] ⭐ **bloque perfil top con avatar + nombre + subtítulo + chevron** — molde directo para perfil de RAFAQ
- [pattern] ⭐⭐ **lista vertical de items con icono outline + label + chevron a la derecha** + separators agrupando secciones — pattern universal para "Settings/Más" en mobile. **Adoptable directamente** para RAFAQ:
  - 👤 Perfil
  - 🏛 Establecimiento (con sub: cambiar activo / invitar miembro / configurar)
  - 🔔 Notificaciones (badge contador)
  - 📊 Reportes (badge NUEVO)
  - 🔗 Exportar SIGSA / SIGBIOTRAZA
  - 🎨 Apariencia (theme switch light/dark/auto)
  - ❓ Ayuda
  - 🚪 Cerrar sesión
- [pattern] **badges `CONOCÉ` / `NUEVO`** pill azul outline para features sin ver — patrón delicado para introducir features sin abrumar
- [pattern] **banner promocional como card destacada al inicio de la lista** (meli+ Total) — para RAFAQ podría ser banner de "Próxima vacunación pendiente" o "3 animales sin pesar hace 60 días" (alerta accionable, no marketing)
- [pattern] **icono outline 24px + label sans regular + chevron right** — anatomía de row de settings universal
- [keep] **esta pestaña es plantilla directa para tab Más de RAFAQ** — solo cambia el listado de items

---

## mercadopago-tab-actividad.jpeg + mercadopago-tab-mas.jpeg combinados = pattern bottom nav universal

El bottom nav de MP es **5 items con FAB central elevado**, donde cada tab:
- Mantiene top bar brand persistente (consistencia de marca)
- Tiene su propio header con título display bold
- Estructura propia: stats / hero / lista / settings según contexto
- Item activo destacado en color brand (azul)
- Resto grey con label visible

**Para RAFAQ esto sugiere directamente la siguiente estructura tentativa de bottom nav** (a discutir cuando armemos pantallas en Stitch):

```
[ 🏠 Inicio ] [ 🐄 Animales ] [ ⚡ Modo Maniobra (FAB) ] [ 📊 Reportes ] [ ☰ Más ]
```

Donde:
- **Inicio** = home post-establishment con KPIs + quick actions (molde mercadopago-homepage)
- **Animales** = BUSCAR ANIMAL con stats + search + filtros + lista (molde mercadopago-tab-actividad) — funcionalidad CORE del producto según Raf
- **[FAB Modo Maniobra]** = el botón más prominente, acción crítica del operador en manga — molde de FAB QR centro de MP
- **Reportes** = KPIs del rodeo + comparativas + exportaciones (spec 07)
- **Más** = settings, perfil, ayuda, theme switch, exportar SIGSA, etc. (molde mercadopago-tab-mas)

---

## Resumen del valor de MP para RAFAQ

**Para Raf este flujo le pareció "moderno, pro, alta UX/UI"** y validó la dirección. Los hallazgos clave que llevamos a `research-findings.md`:

### Del flujo register + home (sesiones anteriores)

1. **Voseo constante** como tono argentino del copy.
2. **Header brand persistente** + greeting personalizado.
3. **Wizard "tarjetas con CTA en activo"** como alternativa al stepper clásico (4-7-11).
4. **Microcopy explicativo en cada step** (no asume contexto del usuario).
5. **Helper text bajo inputs** con formato esperado.
6. **CTA disabled hasta input válido** (5-8).
7. **WhatsApp como canal primero** (9) — sensibilidad cultural AR.
8. **Confirmaciones visuales con checkmark verde + texto grey muted** (7-10-11).
9. **Microinteractions delicadas** (autocomplete 6, pre-fill país 8).
10. **Persona real argentina** en hero (1) — trust pattern.
11. **Home post-login con top bar brand + card hero + quick actions grid + FAB central** (homepage) — molde para R6.1.
12. **Privacy toggle de números sensibles** (homepage ojo cerrado).
13. **Chip inline `▲ Rinde 18,2%`** verde para tendencia (homepage).

### De las 3 pestañas del bottom nav (nuevo, esta sesión)

14. **Estructura de bottom nav con FAB central** = molde para navegación principal de RAFAQ (con `Modo Maniobra` en el FAB central, `Animales` en una pestaña, `Más` en otra).
15. **Tab "Actividad" = molde directo de BUSCAR ANIMAL**: stats 2-col scrolleable + search permanente + chips de filtros + lista cronológica agrupada por fecha + row con icono+nombre+chip+valor+fecha.
16. **Tab "Más" = molde directo de settings de RAFAQ**: bloque perfil top + banners + lista vertical con icono outline + chevron + separators.
17. **Cada tab tiene top bar brand persistente** (consistencia visual cross-tab).
18. **Item activo destacado en color brand** en bottom nav.
19. **Banner promocional/destacado** al inicio de listas (adaptable para alertas accionables en RAFAQ tipo "3 animales sin pesar hace 60 días").
20. **Badges `CONOCÉ` / `NUEVO` outline azul** para features sin ver.

### Patrón más importante de toda la sesión

El **wizard de MP no usa step indicator clásico, usa lista de tarjetas donde solo el activo tiene CTA** (#3 arriba). Es objetivamente más claro para el usuario porque siempre sabe qué hacer ahora. **Llevado a `research-findings.md` como patrón universal #12**.
