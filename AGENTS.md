# AGENTS.md — Mapa de navegación para agentes de IA

> Punto de entrada. NO es una biblia: es un MAPA. Leés solo lo que necesités cuando lo necesités.

## 1. Antes de empezar (obligatorio)

1. Ejecutá `node scripts/check.mjs`. Si falla, **parás**.
2. Leé `progress/current.md` (estado de la última sesión).
3. Leé `progress/plan.md` (plan de ejecución de todo el proyecto — comparalo contra `current.md` y `history.md`).
4. Leé `feature_list.json`. Feature `"sdd": true` → SDD (`docs/specs.md`).
5. Leé `docs/specs.md` antes de tocar cualquier spec.

## 2. Mapa del repositorio

| Archivo / carpeta | Qué contiene | Cuándo leerlo |
|---|---|---|
| `CLAUDE.md` | Contexto del proyecto + rol leader | Siempre, al empezar |
| `CONTEXT/` | Producto, modelo de negocio, datos, hardware, etc. | Cuando la tarea toque ese dominio |
| `docs/adr/` | Decisiones arquitectónicas | Antes de tomar decisión relacionada |
| `feature_list.json` | Backlog + estado | Siempre, al empezar |
| `progress/current.md` | Sesión actual | Siempre, al empezar |
| `progress/plan.md` | Plan de ejecución multi-sesión (bloques A→B→C→D, dependencias, decisiones pendientes de formalizar) | Siempre, al empezar — comparar contra current/history |
| `progress/history.md` | Bitácora append-only | Si necesitás histórico |
| `specs/active/<feature>/` | requirements + design + tasks | Antes de implementar feature SDD |
| `docs/architecture.md` | Qué es "buen trabajo" en este stack | Antes de implementar |
| `docs/conventions.md` | Estilo, nombres, errores | Antes de escribir código |
| `docs/specs.md` | Proceso SDD (EARS + puerta humana) | Antes de redactar/leer un spec |
| `docs/verification.md` | Cómo verificar | Antes de declarar `done` |
| `CHECKPOINTS.md` | Estado final correcto | Para auto-evaluarte |
| `.claude/agents/` | Definiciones de subagentes (leader, spec_author, implementer, reviewer, **security_analyzer**) | Si orquestás trabajo |
| `scripts/check.mjs` | Validador del entorno | Cada arranque y antes de cerrar |
| `.harness/config.json` | Config del check (`testCommand` → `scripts/run-tests.mjs`) | Si tocás cómo se corren los tests |

## 3. Reglas duras (no negociables)

- Una sola feature a la vez (validado por `check.mjs`).
- No declarás `done` sin verificación verde.
- No saltás la fase de spec ni la aprobación humana.
- Documentás en `progress/current.md` **mientras** trabajás, no al final.
- Dejás el repo limpio antes de cerrar.
- Si no sabés algo, lo buscás en `docs/` o `CONTEXT/` antes de inventar.

## 4. Flujo SDD

```
pending → [spec_author] → spec_ready
                              ↓
                  [security_analyzer modo `spec`] ← Gate 1 (condicional, ver ADR-019)
                              ↓
                       ⏸ HUMANO APRUEBA
                              ↓
                       in_progress
                              ↓
                  [implementer → reviewer]
                              ↓
                  [security_analyzer modo `code`] ← Gate 2 (siempre, ver ADR-019)
                              ↓
                       ⏸ HUMANO APRUEBA FINAL
                              ↓
                            done
```

**Gate 1** (condicional): se invoca si la spec toca RLS, schema sensible, Edge Functions, auth/tokens, secrets, o datos regulados (SENASA/PII). Si no, el leader lo salta documentando en `progress/current.md`.

**Gate 2** (siempre): se invoca después del reviewer y antes de la aprobación humana final. Usa la skill `security-review` de Sentry (plugin `sentry-skills`). Reporta solo findings HIGH-confidence. Si FAIL, relanza implementer con los findings.

Detalle completo del flujo y criterios en `.claude/agents/leader.md` § "Gates de seguridad" y en `docs/adr/ADR-019-security-analyzer-skill-sentry.md`.

## 5. MUSTs específicos de RAFAQ

- **Offline-first.** Toda feature de carga debe funcionar sin internet y sincronizar después.
- **Multi-tenant desde día 1.** Todo dato tiene `establishment_id`.
- **Velocidad operativa.** Botones grandes, fonts grandes, una decisión por pantalla.
- **Idioma**: comunicación y docs en español argentino, código en inglés, UI en español.

Detalles completos en `CLAUDE.md` (principios) y `docs/architecture.md`.

## 6. Cierre de sesión

1. `node scripts/check.mjs` verde.
2. Si la tarea acabó: `status: "done"` en `feature_list.json`.
3. Mové el resumen de `progress/current.md` al final de `history.md`.
4. Vaciá `progress/current.md` dejando la plantilla.
5. Sin temporales, sin logs de debug, sin TODOs sin contexto.

## 7. Si te bloqueás

Releé `docs/`. No inventes workarounds: documentá el bloqueo en `progress/current.md` con estado `blocked` y parás.
