# Arquitectura — Qué significa "hacer un buen trabajo"

> Los revisores evalúan el código contra este archivo. Si no está acá, no es un requisito.

## Stack

- **Frontend móvil**: React Native + Expo (managed workflow) + TypeScript estricto.
- **Backend**: Supabase (Postgres + Auth + Realtime + Storage + Edge Functions en Deno).
- **Sync offline**: PowerSync con SQLite local.
- **BLE**: react-native-ble-plx.
- **Lenguaje único**: TypeScript en cliente, TypeScript/Deno en Edge Functions.

Decisión completa: `docs/adr/ADR-002-tech-stack.md`.

## Capas del cliente

```
screens/         → pantallas (presentación + navegación)
components/      → UI reutilizable (sin fetch directo)
contexts/        → AuthContext, EstablishmentContext, etc.
hooks/           → custom hooks (use-establishment, use-animals, etc.)
services/        → supabase, powersync, ble, etc. (boundary con I/O)
types/           → tipos compartidos
utils/           → helpers puros
```

**Regla de dependencias**:
- `screens` puede importar de `components`, `contexts`, `hooks`, `types`, `utils`.
- `components` solo importa de `components`, `types`, `utils`. NUNCA de `services` directamente.
- `hooks` orquestan `services` y exponen estado a `screens`/`components`.
- `services` son la única capa que toca I/O (Supabase, PowerSync, BLE).
- Datos sensibles a multi-tenancy pasan **siempre** por `services` que leen el establishment activo de `EstablishmentContext`.

## Capas del backend

- **`supabase/migrations/`** — schema SQL versionado, incluye RLS policies y helpers.
- **`supabase/functions/`** — Edge Functions (Deno) para operaciones que no se expresan limpio en RLS (invitaciones, validaciones complejas, integraciones externas).
- **`supabase/tests/`** — pgTAP o scripts SQL que validan RLS y triggers.

## Principios

1. **Offline-first.** Toda feature de carga de datos en campo funciona sin internet y sincroniza después (`CLAUDE.md` principio 3).

2. **Multi-tenant desde día 1.** Todo dato de negocio tiene `establishment_id`. RLS lo enforce. Helpers `has_role_in()` / `is_owner_of()` se usan consistentemente (`ADR-004`).

3. **Errores explícitos.** Servicios retornan `Result<T, E>` o tiran excepciones tipadas — nunca silencian errores. UI muestra mensajes accionables, no stack traces.

4. **Soft deletes.** `deleted_at timestamptz nullable` en toda entidad de negocio. RLS filtra `deleted_at IS NULL` por default.

5. **Una decisión por pantalla.** El operario en manga no tiene tiempo ni paciencia para formularios largos. Velocidad operativa > elegancia visual (`CLAUDE.md` principio 4).

6. **El veterinario es el canal de adquisición.** Funcionalidades que les sirvan a vets no se degradan por motivos comerciales (`CLAUDE.md` principio 5).

## Flujo de datos típico (lectura)

```
Screen → useEstablishment() para obtener establishment activo
       → useSomethingHook() que llama service
       → service → PowerSync (SQLite local) → resultado tipado
       → Screen renderiza
```

Lo que NO se hace: `Screen → fetch directo a Supabase`. Siempre vía service + cache local.

## Flujo de datos típico (escritura offline)

```
Screen → useSomethingHook().mutate()
       → service → PowerSync upsert (SQLite local + cola de sync)
       → cuando vuelve red: PowerSync sincroniza con Supabase
       → conflictos: last-write-wins por default; estrategias custom documentadas
```

## Qué NO hacer

- ❌ Lógica de negocio en componentes JSX.
- ❌ Fetch directo a Supabase desde una pantalla o componente.
- ❌ Hardcodear `establishment_id` en queries.
- ❌ Mock de I/O crítico en tests (RLS, PowerSync) — usar fixtures reales.
- ❌ Cualquier tabla con datos de campo sin `establishment_id` + RLS.
- ❌ Componentes con lógica de fetching (debe estar en hooks/services).
- ❌ Cualquier feature de campo que no funcione offline.

## Decisiones que vinculan esta arquitectura

| Decisión | ADR |
|---|---|
| Stack tecnológico | `ADR-002-tech-stack.md` |
| Multi-tenancy hierarchy | `ADR-004-multi-tenancy-hierarchy.md` |
| Modelo de roles | `ADR-006-role-model.md` |
| Identificación flexible de animales | `ADR-005-flexible-animal-identification.md` |
| Transiciones automáticas de categoría | `ADR-008-automatic-category-transitions.md` |
| BLE Nordic UART | `ADR-003-ble-nordic-uart.md` |
| Hardware Vesta | `ADR-010-vesta-hardware-integration.md` |
| Parsers de laboratorio | `ADR-007-lab-integration-parsers.md` |
| Billing diferido | `ADR-009-billing-deferred.md` |
