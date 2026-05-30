# ADR-023 — Workflow de diseño de frontend: componentes como deliverable + generación con guardrails

**Status**: Accepted
**Fecha**: 2026-05
**Decisores**: Raf (decisión pasada por el LLM Council, sesión 17)

## Contexto

El frontend de RAFAQ (React Native + Expo + Tamagui, ver ADR-002/ADR-013) estuvo bloqueado esperando "cerrar el design system". Durante las sesiones de diseño se usó **Google Stitch** (Gemini 3.1 Pro) vía MCP para generar mockups de pantallas. La práctica reveló problemas estructurales:

- Ajustar **una** pantalla (la home) costó ~4 idas y vueltas solo para clavar un color de fondo (el motor Material You de Stitch pisa los colores explícitos); fricción de MCP (screenshots cacheados, consistencia eventual, DOM-ops que no persisten).
- El output de Stitch es **HTML/Tailwind web**, no responsive, y **se re-implementa igual en Tamagui** — se paga un peaje de traducción por un artefacto que se descarta.
- **Verdad estructural** (verificada con relevamiento web, may-2026): **ninguna** herramienta de design-to-code genera Tamagui nativamente. Todas escupen HTML web, StyleSheet o NativeWind (Stitch, Claude Design de Anthropic, v0, Bolt.new, TapUI, Locofy, Anima). Claude Design lee tu design system y hace handoff a Claude Code, pero su output sigue siendo web, no RN.

Esto abrió la pregunta de fondo: **¿conviene diseñar las ~30 pantallas en una herramienta, o demotar el diseño a inspiración y que los implementer agents generen el frontend desde un design system + prompts?** Por las apuestas (define el workflow de todo el frontend del MVP; equivocarse = semanas de rework o un MVP que se siente mal en el "primer try"), la decisión se pasó por el **LLM Council** (5 asesores + revisión por pares + síntesis). El veredicto convergió fuerte y corrigió la hipótesis inicial en puntos concretos.

**Hallazgo del leader durante la ejecución**: el scaffold de `app/` **no tenía el stack de ADR-013 montado** (faltaban Tamagui, Expo Router, Reanimated, `tamagui.config.ts`); era un Expo pelado con `App.tsx` placeholder. Eso agrega un prerequisito de scaffold antes de poder construir cualquier pantalla.

## Decisión

**El deliverable del frontend son los componentes, no las pantallas.** El workflow de diseño/implementación de frontend de RAFAQ es:

1. **La verdad canónica vive en código**: `tamagui.config.ts` (tokens: color, spacing, tipografía, radios, touch-targets) + una **librería de componentes RN reales** (`BottomNav`, `Card`, `Button`, `Stepper`, `FormField`, `ListRow`, …). Una pantalla deja de ser un acto de diseño y pasa a ser **composición de componentes ya correctos** — por construcción no puede verse inconsistente. Ahí muere el "drift visual".

2. **Las herramientas de diseño se demotan a inspiración, con cero handoff de código.** Stitch sale del critical path. No se cimenta el workflow sobre TapUI/Bolt/Claude Design (ninguna genera Tamagui; agregar una sería otra fuente de verdad que mantener). Para inspiración de patrones móviles reales se usa **Mobbin** (vía MCP) y opcionalmente Claude Design puntual. Los mockups existentes (home canónica, `design/stitch-iter-4/`) quedan como **referencia visual de dirección**, no como spec ni como código a portar.

3. **Hand-craft vs generate, deliberado.** El "primer try" (posicionamiento de RAFAQ) se gana en las pantallas de alto impacto: el wizard de MODO MANIOBRAS, estados vacíos, errores de sync offline, feedback del bastón BLE, la pantalla a las 6am con barro. **Esas se hacen a mano.** Las pantallas CRUD-aburridas (listas, forms estándar) las generan los implementer agents desde tokens + librería + arquetipo cercano. No se persigue un "generador universal de pantallas" (eso sería scope creep incompatible con rush-MVP).

4. **Guardrail = oráculo de QA + defensa contra drift.** Un lint/check **falla ante cualquier color o spacing hardcodeado** (hex/px literal en pantallas): todo valor visual debe referenciar un token. Esto reemplaza al "mockup de referencia" como oráculo de QA (no validás contra imágenes, validás contra los componentes/tokens canónicos) y garantiza que cuando un token cambia, las pantallas se re-derivan solas en vez de quedar pegadas a la v1.

5. **El design system se DERIVA de construir una pantalla real, no se canoniza en abstracto.** Se construye **una pantalla a mano** (la home, que ya tiene dirección visual aprobada) corriendo en Expo, y de ahí se derivan qué tokens y componentes hacen falta. La pantalla real es el **test de cobertura** del design system: "si no podés componer la home con tus componentes, te falta un componente, no una pantalla". Recién entonces se canoniza `tamagui.config.ts` + la librería. El riesgo que esto evita: descubrir en la pantalla 22 que faltaba un primitivo.

6. **Se itera en la app corriendo (Expo) con frames de dispositivos reales** — el único lugar donde la responsividad existe de verdad (el bottom-nav que se cortaba en pantallas chicas es responsive/safe-area en RN, se resuelve una vez en el componente con `useSafeAreaInsets`, no en un mockup).

7. **El Agent skill de RN best-practices es tooling interno** (mejora cómo los implementer agents escriben Tamagui), no un producto ni un "foso" a perseguir. Subproducto gratis y bienvenido: los componentes manga-friendly son IP de dominio reutilizable para los sistemas futuros (invernada, feedlot, tambo) — pero es consecuencia, no objetivo.

**Prerequisito de ejecución**: antes de construir la home hay que **scaffoldear el stack de ADR-013** en `app/` (instalar Tamagui + Expo Router + Reanimated, crear `tamagui.config.ts` provisional sembrado con los tokens validados del design system v4 de Stitch, migrar a estructura de Expo Router, shell de bottom-nav de ADR-018 como stubs, verificar que bootea y typecheckea).

## Alternativas consideradas

### Diseñar las ~30 pantallas pixel-perfect en una herramienta (Stitch/Figma) antes de codear
- **Pros**: aprobás lo visual antes de invertir en código; menos riesgo de "no me gusta cuando lo veo".
- **Contras**: falsa precisión (el mockup no es responsive ni es tu stack), iterás dos veces (en la herramienta y en código), lento, y como nada genera Tamagui se re-implementa todo igual. El Council lo descartó: el mockup no es el deliverable.

### No diseñar nada; los agents construyen todo desde prompts
- **Pros**: máxima velocidad.
- **Contras**: el agente extrapola patrones, no "se inspira"; lo no-dicho (responsividad, estados emocionales) sale como promedio competente que mata el "primer try". El Council lo rechazó para las pantallas de alto impacto.

### Migrar a una herramienta con output RN (TapUI / Bolt.new)
- **Pros**: TapUI/Bolt sí generan RN/Expo (no web).
- **Contras**: Tamagui solo "reconocido" no soportado a fondo; responsive no documentado; tooling de semanas de vida (may-2026) → cimentar todo el frontend ahí es deuda, no base. Sirven a lo sumo como punto de partida puntual, no como motor.

### Canonizar el design system en abstracto primero, después construir pantallas
- **Pros**: orden intuitivo ("primero el sistema").
- **Contras**: el Council lo corrigió — canonizar a ciegas arriesga descubrir primitivos faltantes en la pantalla 22. Mejor derivar el sistema de construir una pantalla real (ver Decisión punto 5).

## Consecuencias

**Positivas**:
- **Consistencia por construcción**: si las pantallas se componen de los mismos componentes, no pueden verse inconsistentes. Elimina el drift sin necesidad de un revisor con ojo de diseño comparando contra mockups.
- **Cero peaje de traducción**: no se re-implementa lo que se diseñó en otra herramienta.
- **Resiliente al churn de herramientas**: como ninguna herramienta es parte del critical path, que aparezca/muera una herramienta nueva no rompe el workflow.
- **El guardrail de lint es a la vez QA y gobernanza de tokens**: una sola regla resuelve dos problemas.
- **Subproducto**: librería de componentes manga-friendly reutilizable para el roadmap multi-sistema.

**Negativas / riesgos**:
- **Se pierde el oráculo "mockup de referencia"** para QA visual. Mitigación: el lint (Decisión 4) + validar las pantallas de alto impacto a mano + iterar en device real.
- **Los implementer agents pueden hardcodear estilos** en vez de consumir tokens. Mitigación: el Agent skill de RN best-practices no es opcional + el lint falla el build ante hardcode.
- **Requiere validación humana del "primer try"**: el polish de las pantallas hand-crafted hay que verlo corriendo. Mitigación: gate de validar UNA pantalla-manga real (idealmente con Facundo / el operario beta de Chascomús) antes de canonizar.
- **Dependés de la calidad de los implementer agents** para el grueso CRUD. Mitigación: el reviewer + Gate 2 del flujo SDD siguen aplicando.

**Reversibilidad**: alta. Si el camino "agents + componentes" no produce calidad suficiente, se puede volver a diseñar más pantallas a mano sin tirar nada (los componentes y tokens siguen siendo la base correcta en cualquier escenario).

**Relación con otros ADRs**: ejecuta ADR-002/ADR-013 (stack). Consume la estructura de ADR-018 (bottom nav). El design system canónico derivado (tokens + `docs/design-system.md`) es artefacto downstream de este ADR (no requiere ADR propio salvo que surja una decisión arquitectónica nueva).
