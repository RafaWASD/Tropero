# Spec Driven Development (SDD) — Proceso

> Flujo Kiro-style: requirements → design → tasks → code. El código no se escribe hasta que el spec está aprobado por un humano.

## Estructura

Cada feature `"sdd": true` tiene `specs/active/<feature-name>/` con cuatro archivos:

- `context.md` — REFINAMIENTO de contexto y edge cases (se escribe primero; ver abajo)
- `requirements.md` — QUÉ se construye (EARS)
- `design.md` — CÓMO se construye
- `tasks.md` — PASOS concretos

`<feature-name>` = campo `name` de `feature_list.json` (ej: `01-identity-multitenancy`).

## Estados

```
pending → [refinamiento: leader + humano] → context.md
                              ↓
                       ⏸ HUMANO APRUEBA CONTEXTO ← Gate 0 (NUEVO, siempre)
                              ↓
                       context_ready → [spec_author lee context.md] → spec_ready
                              ↓
                  [security_analyzer modo `spec`] ← Gate 1 (condicional)
                              ↓
                       ⏸ HUMANO APRUEBA SPEC
                              ↓
                       in_progress
                              ↓
                  [implementer → reviewer]
                              ↓
                  [security_analyzer modo `code`] ← Gate 2 (siempre)
                              ↓
                       ⏸ HUMANO APRUEBA FINAL
                              ↓
                            done
```

## Estados de parking: `blocked` vs `deferred`

El diagrama de arriba es el ciclo de vida SDD. Ortogonal a eso, una feature puede quedar "estacionada" fuera del flujo:

- **`blocked`** — hay un bloqueante externo real que impide avanzar (dependencia de hardware, decisión de un tercero, bug upstream). No se puede trabajar aunque se quiera.
- **`deferred`** — la feature está lista para avanzar (o parcialmente hecha) pero se posterga por decisión propia: espera turno por `one_feature_at_a_time`, o tiene una fase pausada intencionalmente (ej: backend `done`, frontend en pausa hasta cerrar el design system).

Regla mnemotécnica: `blocked` = *no puedo*; `deferred` = *elijo no ahora*. Ninguno de los dos cuenta como `in_progress` para `one_feature_at_a_time`. El `check.mjs` tampoco exige specs para una feature `deferred` (igual que `blocked`), aunque la tenga aprobada — la info de "spec aprobada" se documenta en el campo `notes`.

## Las puertas de aprobación humana (tres)

El flujo se detiene **tres veces** para el humano:

**Puerta 0 — contexto** (ADR-022): tras el refinamiento, el humano lee `specs/active/<feature>/context.md` (corto) y aprueba el contexto + los edge cases + sus resoluciones. Solo entonces el leader pasa la feature a `context_ready` y habilita al `spec_author`. Es la puerta más barata y la que evita el rework de specs mal cimentadas.

**Puerta 1 — spec** (ADR-019): tras `spec_author` (y eventualmente tras Gate 1 si aplica). El humano lee `specs/active/<feature>/` y dice "aprobado" (o pide cambios). Solo entonces el leader hace `spec_ready → in_progress` y lanza al implementer.

**Puerta 2 — código** (ADR-019): tras `reviewer` APPROVED + `security_analyzer` modo `code` PASS. El humano valida el output del security review en `progress/security_code_<feature>.md` y aprueba `done`. Si el security review reportó findings HIGH, el flujo vuelve a implementer antes de llegar a esta puerta.

## Gates de seguridad (resumen — detalle en ADR-019)

- **Gate 1 (spec security)** — Condicional. Se invoca si la spec toca: RLS, schema sensible, Edge Functions, auth/tokens, secrets, datos regulados (SENASA/PII). El subagente `security_analyzer` en modo `spec` audita las decisiones de diseño y emite veredicto PASS / FAIL / NEEDS_CLARIFICATION. Output: `progress/security_spec_<feature>.md`.

- **Gate 2 (code security)** — Siempre. Se invoca después de `reviewer` APPROVED. El subagente `security_analyzer` en modo `code` invoca la skill `security-review` de Sentry (plugin `sentry-skills` instalado a nivel user) sobre el diff del branch. Reporta solo findings HIGH-confidence + complementa con checklist específico de RAFAQ (RLS, Edge Functions, secrets, triggers). Veredicto PASS / FAIL. Output: `progress/security_code_<feature>.md`.

## context.md — refinamiento de contexto (Gate 0)

Antes de escribir la spec larga, el leader y el humano refinan el contexto en una conversación y lo cierran en un `context.md` **corto y legible**. Es el contrato humano: acá se valida que el contexto sea correcto y se cubren los edge cases que antes quedaban afuera. La spec (requirements/design/tasks) pasa a ser la elaboración para la máquina — el humano confía en ella porque las decisiones ya se cerraron acá.

Lo conduce el **leader en conversación directa** (opcionalmente lanza 1 Explore para pre-armar la lista de edge cases + preguntas). El `spec_author` lo lee como **fuente de verdad primaria** y no re-decide nada: lo traduce a EARS/design/tasks.

Estructura:

- **Contexto validado** — qué se entiende de la feature (de CONTEXT/ADRs/charlas). El humano confirma o corrige.
- **Alcance** — qué entra y qué queda afuera (límites explícitos).
- **Casos y decisiones** — el corazón: cada edge case con su resolución acordada.
- **Pendientes** — cuáles de `CONTEXT/07-pendientes.md` toca; resueltos acá o marcados como bloqueantes.
- **Insumos para spec_author** — punteros a ADRs, secciones de CONTEXT y specs relacionadas.
- **Aprobación** — fecha + nombre de quien aprueba.

`check.mjs` exige `context.md` cuando la feature está en `context_ready`. El gate aplica **hacia adelante**: las features aprobadas antes de ADR-022 (01, 02, 09) no se retrofitean.

## requirements.md — EARS estricto (español)

Cada requirement es un párrafo numerado (`R1`, `R2`, ...) con uno de estos patrones:

| Patrón | Plantilla |
|---|---|
| Ubicuo | `El sistema deberá <acción>.` |
| Evento | `Cuando <disparador>, el sistema deberá <acción>.` |
| Estado | `Mientras <estado>, el sistema deberá <acción>.` |
| Opcional | `Donde <feature opcional>, el sistema deberá <acción>.` |
| No deseado | `Si <evento no deseado>, entonces el sistema deberá <acción>.` |

Reglas:
- ID estable (no reordenar después de aprobar).
- Cada `R<n>` verificable por ≥1 test.
- No mezclar varios "deberá" en un mismo requirement.
- Solo `deberá`/`no deberá` (nada de "podría", "soporta", "permitiría").

## design.md — decisiones técnicas

Antes de tocar código documentás:
- Archivos a crear o modificar.
- Si toca DB: schema SQL completo + RLS policies + helpers usados.
- Si toca offline-sync: buckets de PowerSync + estrategia de conflictos.
- Si toca BLE: protocolo + ventana de correlación + fallback manual.
- Si toca Edge Functions: input/output + validaciones de auth.
- **Mínimo una alternativa descartada con su porqué.**

Apoyate en `architecture.md` y `conventions.md`. Documentá solo donde la feature roza la frontera de esas reglas.

## tasks.md — checklist ejecutable

Pasos discretos en orden, cada uno con checkbox y los `R<n>` que cubre:

```
- [ ] T1 — Migration SQL: crear tabla users con FK a auth.users. Cubre: R1.1, R2.3.
- [ ] T2 — Test: insertar en auth.users dispara trigger a public.users. Cubre: R1.1.
- [ ] T3 — Pantalla SignUp con validación de email. Cubre: R1.1.
```

El implementer marca `[x]`. El reviewer rechaza si queda `[ ]` sin justificación documentada.

## Trazabilidad (regla dura)

Cada test mapea a un `R<n>`; cada `R<n>` tiene ≥1 test. El reviewer lo comprueba. El implementer documenta el mapa `R<n> → archivo:test` en `progress/impl_<name>.md`.

## Reconciliación de specs al as-built (regla dura)

Las specs son la fuente de verdad, no un artefacto de una sola pasada. Toda corrección que cambie el comportamiento o la estructura después de escrita la spec —fix de la autorrevisión del implementer, fix de un FAIL de Gate 1/2, o una decisión tomada en un gate— se reconcilia en `specs/active/<feature>/{requirements,design,tasks}.md` **antes de cerrar/commitear**. Nunca queda una spec que contradiga el código.

La dirección importa. La trazabilidad de arriba garantiza *spec → código* (cada `R<n>` tiene test). Esta regla garantiza *código → spec*: el `design.md` describe lo que el código realmente hace y el `requirements.md` no quedó viejo. Un fix de seguridad que cambia el diseño se refleja en el `design.md`; si cambia el *qué*, se anota bajo el `R<n>` afectado en `requirements.md` (no se reescriben los EARS por gusto — nota de reconciliación, patrón de `impl_13`).

Triple cobertura para que no dependa de la memoria de nadie:
- **implementer** la ejecuta (paso 9 de su protocolo) antes de pasar al reviewer.
- **reviewer** la verifica —rechaza con CHANGES_REQUESTED si el `design.md` quedó mintiendo.
- **leader** la exige como pre-condición de `done` (no aprueba con specs sin reconciliar).

## Política de pipeline (orden entre refinar, spec-ear e implementar)

Tres actividades, tres ritmos. La implementación es la prioridad; refinar y spec-ear van adelante lo justo para no frenarla nunca:

- **Implementación: WIP = 1** — una feature `in_progress` a la vez (lo enforza `check.mjs`, regla `one_feature_at_a_time`).
- **Spec completa: buffer = 1** — como mucho una feature "on-deck" (spec aprobada esperando turno). No se spec-ea todo el roadmap: las specs largas se pudren (spec 02 se reescribió 2 veces).
- **Refinamiento de contexto: buffer = 2–3** — es barato y no se pudre rápido. Se lockean decisiones temprano de las próximas features; alimentan las specs just-in-time.

Alternar entre spec-ear e implementar **no está mal** — pero debe ser dirigido por el pipeline, no por humor. Regla: cuando la implementación se bloquea (design system, día de campo) o cuando falta la spec on-deck, usás la holgura para refinar/spec-ear la próxima del critical path. Detalle y justificación en ADR-022.

## Cuándo NO aplica SDD

Features sin `"sdd": true` no tienen spec. SDD aplica solo hacia adelante: si una feature ya `done` no la tiene, no se reescribe retroactivamente.
