# Convenciones — Estilo, nombres, errores

## Runtime y versiones

- **Node**: 20.x (LTS).
- **TypeScript**: 5.x, modo estricto (`"strict": true`).
- **Expo SDK**: la versión LTS más reciente al arrancar el proyecto.
- **Supabase CLI**: la versión más reciente.

## Linter / formatter

- **ESLint** con preset Expo + plugin TypeScript.
- **Prettier** para formato (single quotes, trailing comma all, semi true).
- `.editorconfig` en raíz para encoding/indent.

## Idioma

- **Código**: inglés (variables, funciones, comentarios).
- **Strings de UI**: español argentino (interface del usuario).
- **Commits**: español, presente, descriptivos. Ej: `agrega validación de email en signup`.
- **Specs / ADRs / docs**: español.

## Nombres

- **Archivos**: kebab-case (`animal-profile.ts`).
- **Componentes**: PascalCase (`AnimalCard.tsx`).
- **Hooks**: camelCase con prefijo `use` (`useEstablishment.ts`).
- **Types/Interfaces**: PascalCase (`AnimalProfile`).
- **Constantes globales**: SCREAMING_SNAKE (`MAX_TAG_LENGTH`).
- **Funciones**: camelCase (`fetchAnimalById`).
- **Tablas SQL**: snake_case plural (`animal_profiles`, `user_roles`).
- **Columnas SQL**: snake_case singular (`establishment_id`, `created_at`).

## Estructura de archivo

```
src/
  screens/
    home/
      HomeScreen.tsx
      HomeScreen.test.tsx
      home-state.ts
  components/
  contexts/
  hooks/
  services/
    supabase/
      client.ts
      types.ts
    powersync/
    ble/
  types/
  utils/
```

## Tests

> Los tests del **cliente** (lo de abajo) todavía no están seteados — aplican cuando arranque Fase 3+. Hoy los tests reales son los runners Node-nativos de backend (RLS + Edge), ver `docs/verification.md`.

- **Framework**: Jest con preset `jest-expo` + React Native Testing Library.
- **Ubicación**: junto al archivo bajo test (`Foo.tsx` ↔ `Foo.test.tsx`).
- **Naming**: `describe(unit, () => { it('caso esperado', () => {...}) })`.
- **Mocks**: minimizar. Servicios mockeables vía dependency injection o context override.
- **Fixtures**: archivos `__fixtures__/` con datos realistas.

## TypeScript

- **`strict: true`** siempre.
- **Sin `any`.** Si hace falta, `unknown` + narrowing.
- **Tipos explícitos** en bordes (parámetros, return types públicos). Inferencia solo en internos.
- **`Result<T, E>`** para operaciones que pueden fallar y la falla es esperable (no exceptional).

## Errores

- **Excepciones tipadas** que extienden una base `AppError` del dominio.
- **Errores de red / Supabase**: capturados en services, traducidos a `AppError`.
- **UI**: error boundaries por pantalla; mensajes accionables ("revisá tu conexión"), no stack traces ni "Network Error".

## Comentarios

- Default: **no escribir comentarios.**
- Solo cuando el WHY no es obvio: una invariante oculta, un workaround para un bug específico, comportamiento que sorprendería al lector.
- Nunca explicar QUÉ hace el código (los nombres lo hacen).
- Nunca referenciar la tarea actual ("agregado para X") — eso va en el commit.

## Imports

- Orden: built-in → externos → internos absolutos → internos relativos.
- Sin re-exports innecesarios (no barrel files que oculten dependencias).

## SQL (migrations)

- Una migration por cambio lógico, nombre numerado + descripción: `0001_users.sql`, `0002_establishments.sql`.
- Incluir RLS + helpers + indexes en la misma migration que crea la tabla cuando es posible.
- Comentarios SQL en español si explican el porqué del modelo.

## Formato de commits

Convención: `<tipo>(<scope opcional>): <descripción corta en presente>` + descripción larga opcional + `Refs:` cuando aplica.

Tipos:
- `feat` — funcionalidad nueva
- `fix` — corrección de bug
- `docs` — documentación, specs, ADRs, CONTEXT, progress
- `refactor` — reorganización sin cambio funcional
- `test` — tests agregados o ajustados
- `chore` — config, build, deps, scripts
- `style` — formato, espaciado (no lógica)

Reglas:
- Mensaje en español, presente indicativo (`agrega`, no `agregó` ni `agregar`).
- Commits atómicos: cada commit debería poder revertirse independientemente sin romper el resto.
- Cuando el commit responde a una decisión, referenciar el ADR/spec (`ADR-XXX`, `spec NNN`). En la práctica la referencia va inline en el cuerpo del mensaje; el trailer `Refs:` es opcional, no obligatorio.

Ejemplo:

```
feat(maniobras): wizard de carga secuencial por animal

Implementa el flujo descrito en spec 003-modo-maniobras.
Pantalla por maniobra + resumen final antes de commit.

Refs: ADR-008, spec 003
```
