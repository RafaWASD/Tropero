---
name: design-review
description: Criterios + procedimiento de diseñador UX/UI mobile profesional para RAFAQ. Usar al DISEÑAR, CRITICAR o REVISAR cualquier UI (pantallas, componentes, navegación, microinteracciones), y SIEMPRE al vetear lo que devuelve el implementer en una tarea de diseño ANTES de mostrárselo a Raf. Triggers fuertes — "analizá este diseño", "criticá esta pantalla", "¿está bien este componente?", "revisá lo que devolvió el implementer", "qué opinás de cómo quedó", o cualquier iteración de diseño visual. El objetivo: que a Raf solo le llegue diseño que pasó un filtro profesional (lindo + buenas prácticas), no cada devolución cruda.
---

# Design Review — criterios + procedimiento (RAFAQ)

RAFAQ apunta a "el mejor en el primer try": el polish de UX pesa más que YAGNI estricto. El leader es el **primer revisor de diseño**, NO un pasamanos: filtra antes de molestar a Raf.

## Procedimiento (OBLIGATORIO en toda tarea de diseño)
1. **Lluvia de ideas + análisis ANTES de implementar.** Ante un pedido de diseño, generar 2–4 ideas, analizar cada una con los criterios de abajo (nombrando el principio), elegir la mejor con fundamento, y recién ahí mandar al implementer. No implementar la primera ocurrencia.
2. **Vetear ANTES de mostrar a Raf.** Cuando el implementer devuelve: capturar el render fiel, analizarlo contra el checklist, y **mostrar a Raf SOLO si pasa**. Si no, re-iterar con el implementer (loop leader↔implementer) sin molestar a Raf. Recién cuando está aceptable (lindo + buenas prácticas), mostrárselo.
3. **Medir, no estimar a ojo.** Usar CDP + Pillow para medir proporciones/colores/posiciones, y comparar contra referencias reales (Mercado Pago en `design/inspiration/06-argentino/`, Mobbin vía MCP).

## Tubería de preview fiel
- Render fiel = **CDP `Emulation.setDeviceMetricsOverride`** (viewport mobile real). NO usar `chrome --screenshot --window-size` → da **falso recorte** (maqueta más ancho y cropea). Lección aprendida sesión 17.
- Chrome `--headless=new --remote-debugging-port=9223 --remote-allow-origins=*`; script CDP en Python (`websocket-client`) navega + setDeviceMetricsOverride(412/360, dsf 2, mobile) + captura. Medir/recortar/componer side-by-side con **Pillow**.
- Para ver el margen real del device, simular la **safe area** (banda + home indicator) sobre la captura (el preview web tiene `insets=0`).

## Los criterios (vetear contra esto)

### Heurísticas de Nielsen (10)
1. Visibilidad del estado del sistema (feedback). 2. Match con el mundo real (lenguaje del usuario, no del dev). 3. Control y libertad (deshacer, salidas claras). 4. Consistencia y estándares. 5. Prevención de errores. 6. **Reconocer > recordar** (pistas visibles). 7. Flexibilidad y eficiencia (atajos para expertos). 8. **Estético y minimalista** (jerarquía clara, sacar ruido). 9. Reconocer/recuperar de errores (mensajes claros, sin códigos). 10. Ayuda y documentación.

### Leyes de UX
- **Fitts**: tiempo para alcanzar un target ∝ distancia / tamaño. Targets grandes y cerca del pulgar.
- **Hick**: más opciones → decisión más lenta. Reducir opciones por pantalla ("una decisión por pantalla" = manga).
- **Miller**: ~7±2 ítems en memoria de trabajo; no sobrecargar.
- **Jakob**: respetar modelos mentales existentes (patrones conocidos de iOS/Android/MP). No reinventar lo que el usuario ya sabe.
- **Aesthetic-Usability**: lo estéticamente agradable se percibe como más usable (y perdona fallas menores). El polish importa.

### Mobile (HIG / Material / thumb-zone)
- **Touch targets** ≥ 44pt (iOS) / 48dp (Android), **gap ≥ 8px**. RAFAQ: tirar más grande (guante/barro). Botones primarios ≥56px.
- **Thumb zone**: acciones primarias en el **tercio inferior** (≈75% de los toques son con el pulgar). Esquinas superiores = incómodas en teléfonos grandes.
- **Safe areas**: respetar insets (home indicator iOS ≈34px, gesture/3-botones Android). NO poner contenido tocable/importante en esa franja. Patrón: `paddingBottom = max(insets.bottom, mínimo)`.
- **Bottom nav 3–5 ítems** (4 es el sweet spot; más = targets chicos). Íconos **con label** salvo símbolo universal (evitar "mystery meat").
- **Device real** para el veredicto final, no emulador/mouse.

### Composición y visual
- **Centrado robusto ante decoraciones (ADR-027 — bug recurrente, vetear SIEMPRE)**: cuando un contenido está (o debería estar) **centrado** respecto a su contenedor y conviven una **decoración lateral** (radio/check/tilde/ícono/badge/chevron/contador/avatar), validar que la decoración **NO corra el centro**. El bug clásico: el label centrado se desplaza porque la decoración es un hermano flex que come ancho de un solo lado → queda desalineado vs las filas hermanas sin decoración (caso canónico: la card "Cría" corrida por su radio, `tests/DESCENTRADO.png`). **Fix canónico**: primitiva `CenteredRow` (slots laterales de ancho IGUAL) o `position: absolute` para texto corto fijo. **Corolarios**: (a) decoración condicional (check solo si seleccionado) → reservar su **slot SIEMPRE**, así togglear no recorre el layout; (b) ícono *ligado al label* (leading de un CTA) → se centra el **grupo** ícono+label, eso NO es este bug. **Cada vez que agregues un círculo/tilde/checkbox/ícono/badge a algo, verificá explícitamente que no descentre nada.**
- **Regla de los tercios**: anclar elementos clave en líneas de 1/3 o 2/3, no centrado muerto (lectura más dinámica). Ej.: cuánto asoma un FAB sobre el navbar.
- **Figura-fondo** (Gestalt): separación clara figura/fondo (ej. FAB flotante + halo). Otros principios Gestalt: proximidad, similitud, continuidad, cierre.
- **Jerarquía visual**: tamaño / peso / color guían el ojo a lo importante primero.
- **Consistencia**: elementos iguales se ven/comportan igual. La **distinción** solo si es **intencional y justificada** (ej. el label del FAB resalta porque etiqueta la acción más importante del nav).
- **Ritmo / espaciado**: spacing consistente, respiro (whitespace), alineación a una grilla.
- **Contraste / legibilidad**: medir el contraste texto↔fondo si hay duda (ej. texto sobre un halo translúcido).

### RAFAQ-specific
- **Manga-friendly (criticidad GRADUADA — clasificar la pantalla ANTES de diseñar)**: targets y fonts grandes, una decisión por pantalla; el operario opera con guante/barro/sol/sin red. Velocidad operativa > elegancia. **La exigencia NO es uniforme — depende de DÓNDE se usa la pantalla:**
  - 🔴 **CRÍTICO (manga-only)** — flujos que se usan SÍ o SÍ en la manga, casi nunca desde un lugar cómodo: **MODO MANIOBRAS, BUSCAR ANIMAL**, y cualquier pantalla que identifiques como exclusiva/principalmente de campo (lectura BLE, carga de evento en el momento, pesaje en balanza, sanidad en el brete). Acá manga-friendly es **NO NEGOCIABLE y de máxima prioridad**: targets XL, una sola decisión por pantalla, un solo pulgar, tolerante a error de toque, legible a pleno sol, operable sin mirar fijo. Si dudás entre estética y operabilidad acá, **gana operabilidad siempre**. Es donde se gana o se pierde el producto.
  - 🟡 **IMPORTANTE pero no crítico (mixto)** — pantallas que A VECES se acceden desde la manga pero otras veces desde un lugar cómodo (oficina, sillón, escritorio): home, reportes, "Mis campos", configuración, alta de establecimiento. Acá manga-friendly **se aplica igual** (es buena práctica general y el contexto de uso es variable), pero hay más margen para densidad de info, más opciones por pantalla y refinamiento visual. No sacrificar operabilidad, pero no está todo en juego en cada toque.
  - **Regla de clasificación**: ante cualquier pantalla nueva, primero preguntarse *"¿esto se va a usar en la manga sí o sí?"*. Si la respuesta es sí → 🔴, aplicar el estándar máximo. En las 🔴 **no hay chance de que se nos pase por alto**: es el corazón del producto.
- **"El mejor en el primer try"**: cuidar especialmente los estados de alto impacto (vacío, error, sync offline, lectura BLE fallida) — ahí se gana o pierde la percepción de calidad.
- **El vet es el canal de adquisición**: nunca degradar la experiencia del vet.
- **Design system (v4)**: base BLANCO NEUTRO (`#FFFFFF`/`#faf9f9`, sin tinte) · verde botella `#1e5a3e` (primary/activo) · bone `#F8F6F1` (cards) · terracota `#c84a2c` (alertas) · Inter (700/600/500/400). Componentes = deliverable (ADR-023): **cero color/spacing hardcodeado** en pantallas, todo vía tokens.
- **Referencias**: Mercado Pago (patrón cultural argentino, `design/inspiration/06-argentino/`) + Mobbin (medir patrones reales, no estimar).

## Checklist rápido (correr antes de mostrar a Raf)
- [ ] **Clasificar criticidad manga PRIMERO**: ¿esta pantalla es 🔴 manga-only (Maniobras / Buscar Animal / campo) o 🟡 mixta? Si es 🔴 → el estándar manga-friendly es máximo y NO negociable (ante la duda, gana operabilidad).
- [ ] Targets ≥ 44px, alcanzables con pulgar/guante; primarios en el tercio inferior.
- [ ] Safe areas respetadas (nada importante bajo el home indicator / gesture bar).
- [ ] Sin overflow horizontal (medido a 360 y 412px con CDP).
- [ ] Jerarquía clara; consistencia (distinción solo si justificada y nombrada).
- [ ] **Centrado robusto (ADR-027)**: ningún contenido centrado se corre por una decoración lateral (radio/check/ícono/badge). Si agregaste algo a un costado, verificá que no descentre vs las filas hermanas. Decoración condicional → slot reservado siempre.
- [ ] Figura-fondo, alineación a grilla, ritmo de espaciado coherente.
- [ ] Contraste / legibilidad OK (medido si hay duda).
- [ ] Estados vacío/error/offline contemplados (si aplica a la pantalla).
- [ ] Tokens, no hardcode (ADR-023 §4).
- [ ] Render **fiel** (CDP) mirado de cerca, no asumido; comparado 1:1 contra la referencia si existe.
- [ ] Veredicto: ¿se ve **lindo** + buenas prácticas? Si NO → corregir con el implementer, **no** mostrar a Raf.

Fuentes: NN/g (10 heurísticas) · Laws of UX (Fitts/Hick/Miller/Jakob/Aesthetic-Usability) · Apple HIG + Material (touch targets) · Smashing/UXPin (thumb zone, safe areas).
