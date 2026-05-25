# ADR-001 — Adopción de Specification-Driven Development como metodología

**Status**: Accepted
**Fecha**: 2026-05
**Decisores**: Raf

## Contexto

El proyecto es desarrollado por un solo developer (Raf) con asistencia de IA (Claude Max + Claude Code). Las metodologías tradicionales orientadas a equipos (Scrum, Kanban con tickets) agregan overhead innecesario en este contexto.

El problema central no es "qué hacer próximo" sino **mantener consistencia arquitectónica y de producto a lo largo del tiempo**, especialmente cuando se trabaja en sprints intercalados y con AI agents que reciben contexto fragmentado.

Adicionalmente, los autores de referencia (Sean Grove, "The New Code"; Gojko Adzic, "Specification by Example") y herramientas emergentes (GitHub Spec Kit, Amazon Kiro, harness-sdd) coinciden en que la unidad fundamental de trabajo con IA es la **especificación**, no el código.

## Decisión

Adoptar **Specification-Driven Development (SDD)** como metodología principal, usando el framework `harness-sdd` (GitHub) como estructura.

Cada feature se desarrolla en tres documentos siguiendo el modelo de Kiro de AWS:
- `requirements.md` — requerimientos del feature en notación EARS
- `design.md` — diseño técnico de cómo se implementa
- `tasks.md` — pasos concretos para construirlo

Decisiones arquitectónicas transversales se documentan como **ADRs** (este formato) en `docs/adr/`.

Complementariamente, **TDD táctico** en lógica crítica:
- Correlación temporal Vesta ↔ Allflex (motor BLE)
- Sincronización offline y resolución de conflictos
- Cálculos de KPIs y analítica
- Importación de archivos de laboratorio
- Transiciones automáticas de categoría

## Alternativas consideradas

**Desarrollo ad-hoc con tickets en Notion/Linear**
- Pros: cero overhead
- Contras: no genera artefactos que sirvan a futuro, dependencia total de la memoria del developer y del contexto que se le pasa a la IA

**TDD puro como metodología principal**
- Pros: muy validado, alta calidad de código
- Contras: lento para producto early-stage donde el QUE cambia tanto como el COMO; tests pueden volverse deuda si se redefine el feature

**Documentación a posteriori**
- Pros: máxima velocidad inicial
- Contras: documentación nunca llega a escribirse, conocimiento queda en la cabeza del developer

**Framework de agent orchestration (LangGraph, CrewAI)**
- Pros: automatización de workflow
- Contras: prematuro en este stage; complica setup; sobre-engineering para un solo developer

## Consecuencias

**Positivas**:
- Specs sirven como contexto persistente para Claude Code entre sesiones
- ADRs preservan razonamiento de decisiones críticas (útil para retomar contexto y para auditorías futuras)
- Onboarding del vet socio o de un eventual segundo developer es factible
- Forzar el ejercicio de specificar antes de codear evita scope creep

**Negativas**:
- Overhead de escribir documentación antes de cada feature
- Risk de specs que se desactualizan respecto del código (mitigación: ADRs solo para decisiones, specs vivas que se actualizan)
- Aprender notación EARS toma tiempo al principio

**Neutras**:
- El stack de herramientas (harness-sdd, Kiro, Spec Kit) es nuevo y está en evolución; hay que estar dispuesto a adaptar la metodología
