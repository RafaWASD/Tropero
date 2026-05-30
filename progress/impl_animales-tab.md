# impl — `AnimalRow` + pantalla `AnimalsTabScreen` (frontend, spec 09 R1)

baseline_commit: fa753d38d6266b403d30db7c9e375c65be83b324

> Tarea de **frontend de diseño** (track ADR-023, componentes = deliverable), NO el pipeline
> SDD de la feature 09 (que sigue su curso por separado: backend + puerta BLE). Incremento 1
> de la tab Animales = la **puerta manual** de BUSCAR ANIMAL (R1.1..R1.5). Mismo régimen con
> que se construyó la home y "Mis campos": **mock data**, sin tocar backend, rutas/_layout, ni
> archivos de coordinación. No marca la feature como `done`.
>
> **Criticidad manga 🔴 (NO negociable)**: BUSCAR ANIMAL es feature CORE, se usa SÍ o SÍ en la
> manga → estándar máximo (buscador XL, target grande, identificador que pop-ea, contraste AAA,
> operable con una mano/guante). Ante duda estética vs operabilidad, gana operabilidad.

## Decisión de diseño materializada — V2: fila MP-Actividad + slot de avatar Cowgazer

La fila NO es una card. Es una **fila densa tappable** (patrón lista-de-actividad de Mercado
Pago) con un **avatar circular** a la izquierda (slot estilo Cowgazer) y el identificador
como **titular que pop-ea**. Decisiones pro fundamentadas:

- **El identificador es el titular** (jerarquía visual / Nielsen #8 — match con el mundo real):
  el operario lee la caravana/IDV/visual del animal físico y busca esa fila → ese dato es por
  el que toca, así que pop-ea ($6/18px, bold, $textPrimary, contraste AAA 18:1) mientras
  categoría·rodeo quedan de contexto ($3/$textMuted/400). Misma lógica de "valor que pop-ea +
  contexto apagado" que la métrica hero de `EstablishmentCard`.
- **Avatar = sexo, no estado** (recognition > recall, Nielsen #6): el sexo es el atributo
  siempre-presente más útil de un vistazo y **no necesita paleta de color** (que el v4 todavía
  no define — design-system §2). Fallback neutro: círculo $surface + borde $divider + glifo
  ♀/♂ en $textMuted. La foto lo reemplaza cuando exista (JIT, casi siempre ausente en MVP).
- **"sin caravana" es estado NEUTRO, no alarma** (no se inventó paleta success/warning/error):
  chip outline $surface/$divider/$textMuted, mismo lenguaje que el `RoleBadge`. Es el gancho
  del filtro R1.5 y de las opciones A/B (asignar caravana a un animal cargado solo con visual).
- **Buscador XL por 🔴** (Fitts): el de Animales es más grande (alto $searchBarLg=56) que el de
  "Mis campos" (pill estándar) porque se tipea en la manga, con una mano, a pleno sol.

## API pública de `AnimalRow` (`app/src/components/AnimalRow.tsx`)

```ts
export type AnimalSex = 'male' | 'female';
export type AnimalStatus = 'active' | 'sold' | 'dead' | 'transferred';
export type AnimalRowProps = {
  idv?: string;                  // caravana oficial/IDV (identificador primario si existe)
  visualId?: string;             // número/texto visible pintado (visual_id_alt)
  tagElectronic?: string | null; // null/undefined → chip "sin caravana"
  category: string;              // texto neutro, SIN color de estado
  sex: AnimalSex;                // alimenta el glifo del avatar fallback
  rodeo: string;
  photoUrl?: string;             // JIT: casi siempre ausente → fallback avatar neutro
  onPress?: () => void;
};
```

Anatomía (XStack, `minHeight="$animalRow"` 72px, fondo `$white`, borde inferior `$divider`,
`paddingHorizontal="$4"`, `pressStyle` $surface, tappable con `accessibilityRole="button"`):

- **Izquierda — avatar 48px ($icon)**: foto (cover, `backgroundImage`, con
  `design-lint-disable-next-line` por URL dinámica) o fallback círculo $surface/$divider con
  glifo de sexo ($7, $textMuted).
- **Centro (flex, minWidth=0)** — dos líneas:
  - **Hero**: `idv ?? visualId ?? '—'` ($6/700/$textPrimary, `numberOfLines={1}`/`flexShrink`).
    Si existen AMBOS → hero = `idv` + secundario inline `· #${visualId}` ($3/$textMuted).
  - **Subtítulo**: `${category} · ${rodeo}` ($3/$textMuted/400). El sexo NO se repite (ya en avatar).
- **Derecha**: con tag → `ChevronRight` lucide en `$textFaint` (color leído con `getTokenValue`);
  sin tag → chip neutro "sin caravana".
- **a11y**: `"${category}, ${idv ?? visualId ?? 'sin identificador'}, ${rodeo}[, sin caravana]"`.

Exportado desde `app/src/components/index.ts` (componente + `AnimalRowProps` + `AnimalSex` + `AnimalStatus`).

## Pantalla `AnimalsTabScreen` (`app/app/(tabs)/animales.tsx`, reemplaza el stub)

Top→bottom (R1.1..R1.5), espejando el scaffold de `mis-campos.tsx` (header con `useSafeAreaInsets`,
sub-componente local con `getTokenValue` para el TextInput, mock tipado arriba, `// TODO` para backend):

1. **Header**: título "Animales" ($8/700) + subtítulo de conteo "12 activos · 3 rodeos" (sale del
   largo del mock y de `countRodeos`).
2. **Buscador permanente** (R1.2): sub-componente local `AnimalSearchBar`, pill XL `$searchBarLg`,
   ícono `Search`, placeholder "Buscar por caravana, IDV o número visual". Filtra el mock localmente
   (`includes` case-insensitive es-AR sobre idv/visualId/category).
3. **Chips de filtro** (R1.5): `ScrollView` horizontal — "Rodeo ▾" / "Estado ▾" (stubs visuales no-op)
   + "Sin caravana" (**toggle REAL** sobre `tagElectronic == null`). Seleccionado = $primary lleno;
   `showsHorizontalScrollIndicator={false}`.
4. **Lista**: `ScrollView` vertical de `AnimalRow` sobre **12 mocks** variados (con/sin idv, con/sin
   visualId, con/sin tag, las 6 categorías de cría, ambos sexos, 3 rodeos). Divider entre filas vía
   el borde inferior de `AnimalRow`. Orden = mock tal cual ("más reciente primero").
5. **Estados**:
   - **Sin match** (query no vacío, 0 resultados): `NoMatchState` — "No encontramos «{query}»." +
     CTA primario "Dar de alta este animal" (entrada al find-or-create, R1.4).
   - **Establecimiento vacío**: `const EMPTY_STATE = false` arriba del archivo conmuta a
     `EmptyEstablishmentState` (empty amable + CTA "Dar de alta tu primer animal"). Default `false`.

## Tokens nuevos (JIT, en `app/tamagui.config.ts`, grupo `size`)

| Token | px | Justificación |
|---|---|---|
| `$animalRow` | 72 | alto mínimo de `AnimalRow` (avatar 48 + 2 líneas + chevron/chip, target con guante) |
| `$searchBarLg` | 56 | alto del buscador XL 🔴 (= touchMin pero token semántico propio: es un buscador) |
| `$chipMin` | 40 | alto mínimo de los chips de filtro (target tappable, un escalón bajo touchMin) |

Reusados: `$icon`(48) avatar, `$touchMin`(56) CTA, `$inputText`(16) input, `$navIcon`(24) chevron,
`$pill`/`$surface`/`$divider`/`$white`/`$primary`/`$primaryPress`, `$textPrimary/$textMuted/$textFaint`,
escala de fuente `$2..$8`, spacing `$1..$8`. **Cero hardcode** (lint 0 violaciones).

## Qué quedó MOCK / STUB / TODO (NO en alcance — feature 09)

- **Motor real**: find-or-create (`findOrCreateAnimal`), match exacto TAG/IDV + fuzzy visual (R5 de
  spec 02), **debounce 250ms**. Acá el filtro es `includes` síncrono sobre el mock.
- **Navegación**: `onPress` de la fila → EDIT (R5) y CTAs → CREATE (R4) son `// TODO`: **esas
  pantallas todavía no existen**.
- **Filtros "Rodeo"/"Estado"**: stubs visuales (onPress no-op). Solo "Sin caravana" filtra de verdad.
- **Datos reales / PowerSync / scoping por `EstablishmentContext`**: todo el mock; en producción sale
  del rollup del establishment activo. **Nunca se hardcodea `establishment_id`** (CLAUDE.md ppio 6) —
  anotado en los comentarios del mock.
- **Foto del animal**: branch funcional en web (`backgroundImage`); render nativo (`<Image source>`,
  caché offline) queda stub hasta Supabase Storage (mismo estado que `EstablishmentCard`).
- **Paleta de estado** (success/warning/error): **NO inventada** — categoría/estado van como texto
  neutro (design-system §2; la dispara la ficha de animal más adelante).
- **Extracción de `SearchField` compartido**: anotada como `// TODO(futuro)`; NO se re-tocó
  `mis-campos.tsx` en este incremento (el buscador de Animales es sub-componente local).

## Trazabilidad (R1.x → evidencia)

La verificación de esta tarea de diseño es **typecheck + lint anti-hardcode** (no hay framework de
unit-test de componentes RN en el repo; el test command es typecheck + suites DB). Mapa requisito →
materialización en código:

| R1.x | Materialización |
|---|---|
| R1.1 (pantalla lista animales del establishment) | `AnimalsTabScreen` lista `AnimalRow` sobre el mock; conteo en header. Scoping por `EstablishmentContext` = TODO backend |
| R1.2 (campo de búsqueda permanente) | `AnimalSearchBar` pill XL `$searchBarLg`, filtra el mock (`includes` es-AR). Debounce 250ms = TODO |
| R1.3 (match → EDIT) | `AnimalRow.onPress` → `// TODO(feature 09)` abrir `AnimalEditScreen` (R5) |
| R1.4 (no match → CTA "Dar de alta") | `NoMatchState` con CTA "Dar de alta este animal" cuando query≠'' y 0 resultados |
| R1.5 (filtros rodeo/estado/sin caravana) | 3 `FilterChip`; "Sin caravana" = toggle real (`tagElectronic == null`), Rodeo/Estado = stubs |

## Desviaciones mecánicas

Ninguna desviación del brief. Detalles menores tomados como default (sin consecuencia
arquitectónica):

- **Glifos de sexo**: usé los caracteres Unicode ♀ (U+2640) / ♂ (U+2642) en `Text` (como pedía el
  brief), no íconos lucide — el glifo es más reconocible y no agrega dependencia de ícono.
- **3 tokens nuevos** en vez de reusar `$touchMin` para el buscador: agregué `$searchBarLg`/`$animalRow`/
  `$chipMin` como tokens semánticos propios (el brief lo dejaba a criterio: "definí token … o reusá").
  `$searchBarLg` y `$touchMin` valen ambos 56 pero el token semántico documenta la intención y permite
  divergir después sin tocar pantallas.
- **Copy de los empty/no-match states**: redactado en es-AR informal (voseo) coherente con la UI; es
  copy de preview, refinable cuando se cierre el copy final de R1 (refinamiento incremental, ver spec).

## Verificación

`node scripts/check.mjs` **verde**:
- Lint anti-hardcode (ADR-023 §4): **0 violaciones** en `app/app` + `app/src/components`.
- Typecheck client: OK (`tsc --noEmit`).
- Suites DB intactas (esta tarea no las toca): RLS **15/15**, Edge **26/26**, Animal (spec 02) **28/28**.

## Cómo correr el preview

1. Desde `app/`: `pnpm.cmd web` (Expo web dev server, Metro en `http://localhost:8081`).
2. Navegar a la tab **Animales** del bottom-nav (ruta `(tabs)/animales`).
3. Para previsualizar el empty state: poné `const EMPTY_STATE = true` arriba de `animales.tsx`.
4. Para el estado sin-match: tipeá algo que no matchee ningún mock (ej. "zzz") en el buscador.
