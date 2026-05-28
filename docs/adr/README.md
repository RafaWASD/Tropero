# Architecture Decision Records

Este directorio contiene los ADRs (Architecture Decision Records) del proyecto. Cada ADR documenta una decisión arquitectónica significativa: el contexto, las alternativas consideradas, la decisión tomada y sus consecuencias.

## Cuándo crear un nuevo ADR

Crear un ADR cuando:
- Se elige entre opciones arquitectónicas no triviales (ej: qué framework usar)
- Se toma una decisión que será difícil de revertir
- Se establece una convención que afecta a múltiples partes del código
- Se rechaza explícitamente una alternativa popular y conviene dejar constancia del razonamiento

NO crear ADRs para:
- Detalles de implementación local (eso va en código y comments)
- Decisiones de producto (eso va en `/CONTEXT/`)
- Tareas operativas (eso va en specs)

## Formato

Cada ADR sigue este template:

```markdown
# ADR-NNN — Título corto

**Status**: Proposed | Accepted | Deprecated | Superseded by ADR-XXX
**Fecha**: YYYY-MM
**Decisores**: Quién decidió

## Contexto
Qué problema o pregunta motiva esta decisión.

## Decisión
Qué se decidió. Concreto.

## Alternativas consideradas
Qué otras opciones se evaluaron y por qué se descartaron.

## Consecuencias
Positivas, negativas y mitigaciones.
```

## Inmutabilidad y superseding

Un ADR aceptado es **inmutable**. No se edita contenido, no se reescribe contexto, no se "actualiza" la decisión.

Cuando una decisión cambia:

1. Crear un ADR nuevo con status `Accepted` que explica el nuevo razonamiento.
2. En el ADR viejo, **solo se modifica el campo `Status`**: pasa a `Superseded by ADR-XXX`. Nada más.
3. La justificación del cambio vive en el ADR nuevo, nunca en el viejo.

Esto preserva el razonamiento histórico: cualquiera puede leer el ADR viejo y entender qué se pensaba en su momento, y por qué se reemplazó.

## Índice de ADRs

| Nº | Título | Status |
|---|---|---|
| 001 | Specification-Driven Development | Accepted |
| 002 | Stack tecnológico (RN + Expo + Supabase + PowerSync) | Accepted |
| 003 | BLE Nordic UART Service (no Bluetooth Classic) | Accepted |
| 004 | Jerarquía multi-tenant User→Establishment→Rodeo→Animal | Accepted |
| 005 | Identificación flexible de animales | Accepted |
| 006 | Modelo de roles (3 roles, vet independiente) | Accepted |
| 007 | Lab integration vía parsers configurables | Accepted |
| 008 | Transiciones automáticas de categoría con override | Accepted |
| 009 | Billing infrastructure diferida post-beta | Accepted |
| 010 | Hardware integration con Vesta vía bridge ESP32 | Accepted |
| 011 | Package manager pnpm con `onlyBuiltDependencies` | Accepted |
| 012 | Patrones de implementación (triggers, tests, CLI) | Accepted |
| 013 | Stack de frontend (Tamagui + Expo Router + Reanimated + ...) | Accepted |
| 014 | Invitaciones por link shareable (en vez de magic link por email) | Accepted |
| ~~015~~ | ~~Design system "Campo Profundo"~~ — eliminado 2026-05-26 (formalización prematura, ver `docs/design-system.md` draft) | — |
| 016 | Terminología: rodeo (grupo de animales) y sistema (tipo productivo) | Accepted |
| 017 | Timeline append-only de eventos del animal (no nota plana sobreescribible) | Accepted |
| 018 | _(reservado para estructura de navegación principal — pending hasta cerrar A.2 del plan)_ | — |
| 019 | Security analyzer como 5to subagente + skill getsentry/security-review | Accepted |
