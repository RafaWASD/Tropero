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

## Formato de datos para el usuario (es-AR)

Todo dato **mostrado al usuario** va en formato argentino. Los formatos de **MÁQUINA** (SIGSA/CSV/DB/RPC,
payloads, comparaciones lexicográficas, entrada en vivo de la rueda/máscara) NO se tocan: son ISO / punto
decimal por diseño.

- **Números**: coma decimal + punto de miles (`385 kg`, `4,5`, `1.050`). El teclado numérico usa `,`.
  Formateo centralizado en los helpers es-AR (`formatKgAR`, `formatPercentAR`, `formatCmAR`, …).
- **Fechas**: `dd/mm/aaaa` (ej. `07/06/2026`); **contextual `dd/mm`** cuando el año es obvio (año corriente
  — invitaciones, "retomar la jornada", timeline mismo-año). Con hora: `dd/mm/aaaa · HH:MM`. Formateo
  centralizado en **`app/src/utils/format-date-es-ar.ts`** (`formatDateEsAr` / `formatDateCompactEsAr` /
  `formatDateTimeEsAr`) + `formatEventDate` (timeline, con sus relativos "Hoy HH:MM" / "Ayer"). NUNCA se
  muestra un ISO crudo (`2026-06-07`) ni un mes abreviado (`15 abr`).
  - **TZ-safe (regla dura, lección del rojo e2e 777)**: una fecha **date-only** (`AAAA-MM-DD`, columna
    Postgres `date`) se formatea por **manipulación de STRING** (split del prefijo → reordenar), **NUNCA**
    `new Date(iso)` (parsea como UTC-medianoche y en huso AR (UTC-3) corre −1 día). Un **instante real**
    (timestamptz con hora) sí usa `new Date` + getters LOCALES (el día calendario que ve el operario).

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

## UI — actualización optimista en el lugar (no re-fetch que parpadee)

**Regla**: una acción del usuario sobre una pantalla que YA tiene contenido montado (crear/editar/borrar/togglear/asignar un item de una lista, togglear un campo de un detalle, etc.) **NO debe** disparar un re-fetch completo que swappee el contenido por un spinner/placeholder (la pantalla "parpadea en blanco") ni que re-monte la lista (el scroll salta al tope). Eso es un anti-patrón de UX y rompe el pilar "el mejor en el primer try".

**La forma correcta (offline-first con PowerSync)**: la mutación ya escribe al SQLite local (CRUD plano → CrudEntry → `uploadData` reconcilia al subir). La UI debe reflejar el cambio **al instante, en el lugar**, actualizando el estado local de forma **optimista** — sin togglear el estado de `loading` que blankea, sin re-montar. El servidor sigue siendo la verdad (los triggers recalculan al subir; el espejo client-side —ej. `compute_category` de C6— ya converge a eso); el optimismo solo **adelanta** lo que el server va a confirmar, y LWW lo hace seguro.

**Cómo aplicarlo:**
1. **Separá "carga inicial" de "refresh post-acción".** El spinner/placeholder que reemplaza el contenido se muestra SOLO en la primera carga (sin datos previos): guardalo con `loading && data === null`, NO con `loading` a secas. En un refresh con datos ya montados, nunca blanquees.
2. **Preferí mutar el estado en el lugar** (insertar/actualizar/quitar el item del array; setear el campo toggleado; recomputar lo derivado con el espejo client-side) por sobre re-fetchear. Si re-leés, que sea un refresh **silencioso**: actualiza los datos sin togglear el estado que desmonta y sin reemplazar el array de una forma que pierda el scroll (mantené el `ScrollView`/`FlatList` montado, keys estables).
3. **Si la mutación falla**, revertí el cambio optimista + mostrá un error accionable. Nunca dejes un estado "mentido".
4. **Norte a futuro**: la migración de las lecturas de campo a `useQuery`/`watch` de PowerSync (reads reactivos) borra el re-fetch manual entero — la UI se re-renderiza sola ante cualquier cambio del SQLite local (incluido el write optimista). Hasta entonces, aplicá esta receta a mano. (Backlog 2026-06-09.)

**Referencias en el repo que ya lo hacen bien** (copiar de acá): `app/app/(tabs)/mas.tsx` (`ProfileSection`/`applyOwnProfile` — aterrizaje optimista, NO re-fetchea a propósito), `app/app/(tabs)/index.tsx` (loaders con guards de secuencia que conservan el valor previo y nunca blanquean en refresh del mismo contexto), `app/app/(tabs)/animales.tsx` (el `loading` solo alimenta el subtítulo del header, jamás swappea el body de la lista).

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
- **PII sensible → tabla `*_private` self-only (ADR-025).** Toda columna de PII de contacto/identidad
  personal/dato regulado que viva en una tabla cuyas filas son visibles a otros usuarios del tenant
  va a una tabla compañera `<entidad>_private (<entidad>_id PK)` con RLS self-only, NO a la tabla
  pública. La RLS de Postgres es row-level (no column-level) y el WAL (realtime/PowerSync) replica la
  tabla base ignorando views/RPCs/column-GRANTs → solo la separación FÍSICA cierra la PII en todos los
  canales. Un `ALTER TABLE ... ADD COLUMN pii` sobre una tabla pública es un anti-patrón. Primera
  instancia: `public.user_private` (email/phone), spec 14 / migración `0068`. Detalle y alternativas
  descartadas en `docs/adr/ADR-025-pii-tabla-private-self-only.md`.

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
