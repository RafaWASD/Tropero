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
