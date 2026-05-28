# ADR-022 — Gate de refinamiento de contexto antes de la spec (Gate 0) + política de pipeline

**Status**: Accepted
**Fecha**: 2026-05-28
**Decisores**: Raf, con análisis del leader

## Contexto

El flujo SDD del proyecto (ADR-001) iba `pending → spec_author → spec_ready → ⏸ humano → implementer`. El `spec_author` redactaba los tres documentos Kiro (requirements/design/tasks) directamente desde el `acceptance` de `feature_list.json` + los CONTEXT/ADRs relevantes.

Dos problemas concretos aparecieron en la práctica:

1. **Specs largas e ilegibles.** Las specs de RAFAQ son extensas (la de spec 02 supera las 200 líneas en `requirements.md` y 400 en `design.md`). A Raf le cuesta leerlas enteras, y la aprobación humana (Puerta 1) termina siendo superficial — se aprueba sin leer todo el detalle.

2. **Rework por contexto mal refinado.** Cuando la spec se escribe desde un contexto incompleto o con edge cases sin contemplar, sale mal y hay que reescribirla. Evidencia: la spec 02 se reescribió **dos veces** (refinamiento sesión 11 + refundición completa sesión 14 por un bug en el modelo de plantilla de datos que no se había pensado al escribir la primera versión). Reescribir una spec larga es caro.

La causa raíz de ambos: **se saltaba la etapa barata de validar contexto y cerrar edge cases ANTES de invertir en la spec larga.** El humano recién veía el problema cuando leía (o no) la spec terminada.

## Decisión

Insertar un **gate de refinamiento de contexto** (Gate 0) antes de la redacción de la spec. Seis piezas:

### 1. Estado nuevo `context_ready`

Entre `pending` y `spec_ready` en `rules.valid_status` de `feature_list.json`. Significa: el contexto y los edge cases fueron validados con el humano; la feature tiene "el detalle 100%" listo para que el `spec_author` escriba sin re-decidir nada.

### 2. Artefacto nuevo `context.md`

Vive en `specs/active/<name>/context.md`. Es **corto y legible** — el documento que el humano sí lee y aprueba. Estructura:

- **Contexto validado** — qué se entiende de la feature. El humano confirma o corrige.
- **Alcance** — qué entra y qué queda afuera.
- **Casos y decisiones** — el corazón: cada edge case con su resolución acordada.
- **Pendientes** — cuáles de `CONTEXT/07-pendientes.md` toca; resueltos acá o marcados como bloqueantes.
- **Insumos para spec_author** — punteros a ADRs, CONTEXT y specs relacionadas.
- **Aprobación** — fecha + nombre de quien aprueba.

Reparte responsabilidades: `context.md` es el **contrato humano** (decisiones), la spec es la **elaboración para la máquina** (EARS/design/tasks). El humano confía en la spec larga porque las decisiones ya se cerraron en el doc corto.

### 3. Gate 0 (puerta de aprobación humana, siempre)

El flujo pasa de **dos puertas humanas a tres**: contexto → spec → código. La de contexto es la más barata y la que evita el rework caro.

### 4. El refinamiento lo conduce el `leader` en conversación directa

No es un subagente. El refinamiento es una **charla con el humano** (validar contexto, enumerar edge cases, acordar resolución de cada uno) — un subagente no puede hacer eso en vivo. El leader opcionalmente lanza 1 `Explore` para pre-armar la lista de edge cases + preguntas. Escribir `context.md` es editar un doc, ya permitido al leader por CLAUDE.md.

### 5. `spec_author` arranca de `context_ready` y lee `context.md` como fuente de verdad

Cambia su trigger: toma features `context_ready` (no `pending`). Lee `context.md` como **fuente de verdad primaria** — no re-decide contexto ni cierra edge cases por su cuenta; los traduce a EARS/design/tasks. Cada "Caso y decisión" del `context.md` debe quedar cubierto por ≥1 `R<n>`.

`check.mjs` exige `context.md` cuando la feature está en `context_ready`. El gate aplica **hacia adelante** (principio "SDD aplica solo hacia adelante", `docs/specs.md`): las features aprobadas antes de este ADR (01, 02, 09) **no se retrofitean**. La primera feature que lo usa es **03 MODO MANIOBRAS**.

### 6. Política de pipeline (orden entre refinar, spec-ear e implementar)

Tres actividades, tres ritmos. La implementación es prioridad; refinar y spec-ear van adelante lo justo para no frenarla:

- **Implementación: WIP = 1** (lo enforza `check.mjs`, `one_feature_at_a_time`).
- **Spec completa: buffer = 1** (una feature on-deck, aprobada, esperando turno). No se spec-ea todo el roadmap — las specs largas se pudren.
- **Refinamiento de contexto: buffer = 2–3** (barato y no se pudre rápido; lockea decisiones temprano y alimenta las specs just-in-time).

Alternar entre spec-ear e implementar **no está mal**: es correcto siempre que sea dirigido por el pipeline (cuando la implementación se bloquea o falta la spec on-deck), no por humor. Esta separación "lockear decisiones barato / escribir spec caro JIT" es lo que permite rushear el MVP sin acumular rework.

## Alternativas consideradas

### Artefacto `context.md` sin estado nuevo
- **Pros**: menos cambios al harness (no se toca `feature_list.json` ni `check.mjs`).
- **Contras**: sin estado `context_ready`, no hay guardia automática — `check.mjs` no puede impedir que el `spec_author` arranque sin contexto refinado. Queda en disciplina, no en máquina.
- **Razón de descarte**: los gates duros son la razón por la que el SDD funciona acá (mismo argumento que ADR-019 contra hooks/skills sin gates). El costo de un estado más es bajo.

### Subagente dedicado `context_refiner`
- **Pros**: rigor, template consistente.
- **Contras**: un subagente no puede charlar con el humano en vivo. Pre-armaría un draft y el humano lo revisaría async — ida y vuelta más lenta, y el valor del refinamiento es justamente el diálogo.
- **Razón de descarte**: el refinamiento es conversacional por naturaleza. El leader ya es el orquestador que habla con el humano.

### Extender `spec_author` con un modo "discovery" previo
- **Pros**: un solo agente para todo el ciclo de spec.
- **Contras**: mezcla responsabilidades — el `spec_author` pasaría a decidir contexto además de traducirlo. La separación "quién decide (humano+leader) / quién redacta (spec_author)" se pierde.
- **Razón de descarte**: viola la división de roles del harness.

### No hacer nada (status quo)
- **Razón de descarte**: es el dolor actual (specs largas sin leer + rework de spec 02 ×2).

## Consecuencias

### Positivas
- **Menos rework de specs**: el contexto se valida cuando es barato cambiarlo (charla + doc corto), no cuando ya se invirtió en 600 líneas de spec.
- **Aprobación humana real**: Raf lee y aprueba un doc corto orientado a decisiones, en vez de hojear una spec larga.
- **Edge cases cubiertos antes**: el "corazón" del `context.md` es enumerar y resolver casos — lo que antes se descubría tarde.
- **Habilita el rush del MVP**: lockear decisiones temprano (buffer 2–3) sin comprometerse a specs largas que se pudren permite avanzar en paralelo sin acumular deuda.
- **Trazabilidad**: cada feature nueva tendrá su `context.md` como registro de qué se decidió y por qué, antes de la spec.

### Negativas
- **Un paso más en el flujo**: una puerta humana adicional. Mitigación: es la más barata y reemplaza el loop de rework caro — neto, más rápido.
- **Riesgo de doble documentación**: que `context.md` y `requirements.md` digan lo mismo. Mitigación: `context.md` es decisiones/edge cases (el "por qué" y los casos), la spec es EARS/design/tasks (el "qué" y "cómo" verificables). No se solapan si cada uno se mantiene en su rol.
- **Disciplina de no saltearlo**: el leader podría tener la tentación de ir directo a la spec. Mitigación: `check.mjs` + reglas duras en `leader.md` ("NUNCA lanzás spec_author si no está context_ready").

### Notas de implementación
- `feature_list.json`: `context_ready` agregado a `valid_status`.
- `scripts/check.mjs`: `context_ready` en `validStatus`; `requiresContext = ['context_ready']` exige `context.md`; sin retro-exigencia a `spec_ready+` (grandfathering).
- `docs/specs.md`: diagrama de estados con Gate 0; sección "context.md — refinamiento de contexto"; tres puertas; sección "Política de pipeline".
- `.claude/agents/leader.md`: flujo con Gate 0; Caso A (refinamiento, leader-led) + Caso A-bis (`context_ready` → spec_author).
- `.claude/agents/spec_author.md`: trigger `context_ready`; lee `context.md` como fuente de verdad.
- `AGENTS.md` y `CLAUDE.md`: flujo, reglas duras y mapa actualizados.
- Primera prueba real: refinamiento de **03 MODO MANIOBRAS** (Ola 0 del `progress/plan.md`).

### Reversibilidad
Alta. Son cambios de proceso en archivos del repo, fáciles de revertir vía git. No genera artefactos de código difíciles de deshacer (a diferencia de ADR-019). Si el gate resultara overhead innecesario, se quita `context_ready` de `valid_status` y se vuelve al flujo de dos puertas.

**Relacionado**:
- ADR-001 (SDD): este ADR extiende el flujo con un gate previo a la spec.
- ADR-019 (security analyzer): mismo patrón de "gates duros en el flujo". Los gates ahora son tres puertas humanas + dos de seguridad.
- ADR-020 / ADR-021 (lote + plantilla de datos): el rework de spec 02 que motivó este ADR vino de no haber pensado el modelo de plantilla al escribir la primera versión.
