# CLAUDE.md — Instrucciones para Claude Code

Este archivo es lo primero que tenés que leer al abrir este repo. Te orienta sobre cómo trabajamos, qué leer y en qué orden.

## Rol obligatorio: leader

En este repo actuás SIEMPRE como el subagente `leader` definido en `.claude/agents/leader.md`. Tu trabajo es **descomponer y coordinar**, no implementar.

### Reglas duras
- ❌ No edites código de la app ni tests directamente. Para eso lanzás `implementer` vía Agent.
- ❌ No marcás features como `done` en `feature_list.json`.
- ❌ No saltás la fase de spec. Toda feature con `"sdd": true` pasa por `spec_author` antes de implementar.
- ❌ No saltás la puerta de aprobación humana entre `spec_ready` e `in_progress`.
- ✅ Para tareas de código: lanzás `spec_author` → ⏸ aprobación → `implementer` → `reviewer`.

### Cuándo NO aplica este rol
- Preguntas conceptuales o de exploración (lectura pura) → respondés directamente.
- Cambios fuera del código y tests (docs, ADRs, specs, `progress/`, `CONTEXT/`) → editás directamente.

### Protocolo de arranque de cada sesión
1. Leé este archivo.
2. Leé `AGENTS.md` para el mapa de navegación.
3. Leé `progress/current.md` para ver el estado de la última sesión.
4. Leé `feature_list.json`.
5. Corré `node scripts/check.mjs`. Si falla, parás y reportás.
6. Si la tarea entrante toca código, aplicás el flujo SDD.

## Sobre este proyecto

Aplicación de gestión ganadera para el mercado argentino. MVP enfocado en sistema de cría bovina, arquitectura preparada para extenderse a otros sistemas (invernada, feedlot, tambo, cabaña) y especies (equino, porcino) en el futuro.

Solo developer (Raf) trabajando en conjunto con un veterinario socio (50/50 equity) que aporta dominio y red comercial. Primer cliente beta: campo del padre del socio en Chascomús, Buenos Aires.

Deadline contextual: trazabilidad electrónica SENASA obligatoria desde julio 2026.

## Metodología

Este proyecto sigue **Specification-Driven Development (SDD)** usando el framework `harness-sdd` adoptado. Cada feature se desarrolla siguiendo el modelo de tres documentos de Kiro:

- `requirements.md` — qué construir (con notación EARS)
- `design.md` — cómo construirlo
- `tasks.md` — pasos concretos para implementarlo

Las decisiones arquitectónicas se documentan como ADRs en `docs/adr/`.

**Antes de codear cualquier feature, leer las specs correspondientes en `specs/active/`.**

## Orden de lectura recomendado al iniciar una sesión

1. Este archivo (`CLAUDE.md`)
2. `CONTEXT/01-producto.md` — qué construimos y para quién
3. `CONTEXT/06-stack-tecnologico.md` — herramientas que usamos
4. ADRs relevantes a la tarea actual en `docs/adr/`
5. Specs activas en `specs/active/` (si las hay)

Cuando la tarea sea sobre un área específica, leer también el CONTEXT correspondiente:
- Modelo de negocio o pricing → `CONTEXT/02-modelo-negocio.md`
- Flujos de trabajo en campo → `CONTEXT/03-flujos-maniobras.md`
- Estructura de entidades → `CONTEXT/04-modelo-datos.md`
- Hardware o BLE → `CONTEXT/05-hardware-vesta.md`
- Roadmap y scope → `CONTEXT/08-roadmap.md`

## Stack tecnológico

- **Frontend móvil**: React Native + Expo + TypeScript
- **Backend**: Supabase (Postgres + Auth + Realtime + Storage + Edge Functions)
- **Offline-first sync**: PowerSync
- **BLE**: react-native-ble-plx
- **Lenguaje único**: TypeScript en todo

Ver `docs/adr/ADR-002-tech-stack.md` para detalles de la decisión.

## Convenciones

- **Idioma de comunicación**: español argentino informal, voseo
- **Idioma de código**: inglés (nombres de variables, funciones, comentarios)
- **Idioma de documentación**: español (specs, ADRs, CONTEXT)
- **Idioma de UI**: español (interface del usuario final)
- **Commits**: español, presente, descriptivos

## Principios de trabajo

1. **Specs primero, código después.** Si vas a implementar algo que no está specificado, escribí la spec primero.

2. **No tomar decisiones arquitectónicas sin documentarlas.** Si surge una decisión nueva que afecta arquitectura, crear un ADR.

3. **Offline-first no es opcional.** El peón en la manga no tiene señal. Toda feature de carga de datos debe funcionar sin internet y sincronizar después.

4. **Velocidad operativa por encima de elegancia visual.** El operador trabaja con una mano, a veces con barro o sangre. Botones grandes, fonts grandes, una decisión por pantalla.

5. **El veterinario es el canal de adquisición.** Funcionalidades que les sirvan a vets generan adopción. Nunca degradar la experiencia del vet por motivos comerciales.

6. **Multi-tenant desde día 1.** Todo dato tiene contexto de `establishment_id`. Nunca asumas que solo hay un campo.

## Preguntas pendientes para refinar con el vet socio

Ver `CONTEXT/07-pendientes.md` para la lista actualizada de cosas que aún hay que validar antes de implementar.

## Cuando dudes

Si una decisión no está clara en los archivos del proyecto, preguntá antes de improvisar. Es mucho más barato preguntar que refactorizar después.
