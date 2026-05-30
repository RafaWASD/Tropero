# impl — `EstablishmentCard` + preview "Mis campos" (frontend, spec 01 R6.6.2)

baseline_commit: a80342d40f63da8c9e96497f5a52352cf77280e7

> Tarea de **frontend de diseño** (track ADR-023, componentes = deliverable), NO el
> pipeline SDD de la feature 01 (que sigue `deferred`: backend done, frontend pausado).
> Mismo régimen con que se construyó la home (`app/app/(tabs)/index.tsx`). No marca la
> feature como `done`; es un componente derivado del design system v4 canónico.

## Qué se construyó

- **`app/src/components/EstablishmentCard.tsx`** — card reusable de "Mis campos", variante A
  (banner-strip arriba). Anatomía top→bottom (R6.6.2):
  1. **Banner-strip slim** (~76px, token `$bannerStrip`): por default **gradiente verde botella
     visible** (`$primaryLight` → `$primary`, diagonal) con la **inicial** del campo en blanco
     ($10). Prop opcional `imageUrl` → muestra foto custom en vez del gradiente.
  2. **Nombre** hero ($7 / 700, `$textPrimary`, trunca con ellipsis).
  3. **Indicador "● activo"** (`$primary`) cuando `isActive` + **badge de rol** (chip neutro
     `$surface`/borde `$divider`, texto `$textMuted`). Labels en español: Dueño / Operario / Veterinario.
  4. **2 contadores** (`1.240 vacas · 3 rodeos`, `$textMuted`, miles con separador es-AR vía
     `toLocaleString('es-AR')`).
  5. **Métrica hero adaptativa** (discriminated union `heroMetric` — el componente decide por la
     forma de la prop): `pregnancy` → `Preñez 92% · may'26`; `headcount` → `1.240 cabezas · últ.
     maniobra 12 may`; `empty` → CTA visual `+ Configurá tu rodeo`. **Slot de benchmark reservado**
     en la línea (un `<View flex={1}>` vacío) — VACÍO en MVP, no se promete comparación sin baseline.
  6. **Señal de atención** opcional (`⚠ <texto>`) en `$terracota`, solo si viene la prop `attention`.
  - Toda la card es **tappable** (`Pressable` externo, `accessibilityRole="button"` + label con
    nombre/rol/estado). El CTA del estado vacío es **visual** (no un `<button>` anidado — eso es
    HTML inválido en web; la card entera ya dispara el `onPress`).
- **`app/src/components/index.ts`** — export de `EstablishmentCard` + tipos
  (`EstablishmentCardProps`, `EstablishmentRole`, `EstablishmentHeroMetric`).
- **`app/app/mis-campos.tsx`** — pantalla preview standalone (fuera de `(tabs)`): título "Mis campos"
  + CTA "Crear campo" + `ScrollView` con **4 mock establishments** que ejercitan los estados:
  - **La Juanita** — Dueño, **activo**, preñez 92% may'26, `⚠ tacto pendiente`.
  - **El Ombú** — Veterinario, cabezas + última maniobra (sin atención).
  - **Santa Rosa** — Dueño, campo **vacío** (0/0) → CTA "Configurá tu rodeo".
  - **Don Alfredo** — Operario, preñez 88% abr'26, con `imageUrl` mock (banner con foto).
- **`app/app/_layout.tsx`** — registrada la ruta `mis-campos` en el Stack raíz.
- **`app/tamagui.config.ts`** — 3 tokens nuevos JIT (derivados al construir la card):
  `color.primaryLight` (#2e8259, verde botella claro para el gradiente del banner), `size.bannerStrip`
  (76), `size.dot` (8). (El único lugar con literales del frontend; el lint los permite acá.)
- **`scripts/cdp-capture.py`** — helper de preview fiel (CDP `Emulation.setDeviceMetricsOverride`),
  reusable para la tubería de la skill `design-review`.

## Qué quedó MOCK / STUB

- **Todas las stats de la card son MOCK** (vacas / rodeos / % preñez / última maniobra / atención).
  El rollup/queries backend + `last_establishment_opened` (R6.9) son **sub-tarea de la otra
  terminal/backend** → anotado en `docs/backlog.md` (2026-05-30). Aviso: no hardcodear
  `establishment_id` cuando se cablee real — viene del contexto multi-tenant (CLAUDE.md ppio 6).
- **Foto custom (`imageUrl`)**: el branch funciona (en web se pinta vía `backgroundImage`), pero el
  render nativo real (`<Image source>`, caché offline, placeholder de carga) queda **stubbed** hasta
  que exista Supabase Storage. En el preview se usa una URL de placeholder (picsum) para verificar el
  branch.
- **Routing del `onPress`** (fijar campo activo R6.3 + navegar a home R6.7): `TODO` del incremento 2.
- **FUERA de scope (incremento 2, no construido)**: searchbar de R6.6.1 (solo con >8 campos — con 4
  no aplica), orden real de la lista (R6.6.1), CTA "pegar link de invitación" (R6.5) cuando corresponda.

## Trazabilidad (R6.6.2 → evidencia)

La verificación de esta tarea de diseño es **typecheck + lint anti-hardcode + render fiel medido**
(no hay framework de unit-test de componentes en el repo; el test command es typecheck + suites DB).
Cada sub-requisito de R6.6.2 → su evidencia en el render `design/stitch-iter-4/mis-campos-cards.png`:

| R6.6.2 (sub-anatomía) | Evidencia en el render / mock |
|---|---|
| banner default = gradiente verde + inicial | La Juanita/El Ombú/Santa Rosa: gradiente medido `$primaryLight`(46,129,89)→`$primary`(30,90,62), delta 82 (no plano) + inicial L/E/S |
| banner foto custom (opcional) | Don Alfredo: `imageUrl` → banner con foto (sin inicial) |
| nombre + badge rol + indicador activo | 4 cards: nombre hero + chip Dueño/Veterinario/Operario; La Juanita con `● activo` |
| 2 contadores (animales · rodeos), miles formateados | `1.240 vacas · 3 rodeos`, `2.100 vacas · 5 rodeos` |
| métrica hero `pregnancy` | La Juanita `Preñez 92% · may'26`; Don Alfredo `Preñez 88% · abr'26` |
| métrica hero `headcount` | El Ombú `860 cabezas · últ. maniobra 12 may` |
| métrica hero `empty` → CTA | Santa Rosa `+ Configurá tu rodeo` (chip outline) |
| slot benchmark reservado, vacío MVP | `<View flex={1}>` en la línea de la métrica, sin comparación |
| señal de atención opcional (terracota) | La Juanita `⚠ tacto pendiente` en `$terracota` |
| card tappable + accesible | `Pressable` con `accessibilityRole="button"` + label `nombre, rol[, campo activo]` |

## Cómo correr el preview

1. Desde `app/`: `pnpm.cmd web` (Expo web dev server, Metro en `http://localhost:8081`). Requiere
   Node ≥ 20.19.4.
2. Navegar a **`http://localhost:8081/mis-campos`**.
3. Captura fiel (opcional, lo que se usó para vetear): Chrome headless con
   `--remote-debugging-port=9223 --remote-allow-origins=*` + `python scripts/cdp-capture.py
   http://localhost:8081/mis-campos <out.png> 412 1200 2` (412px / dsf2 / mobile). Matar
   Chrome + Metro al terminar.

## Verificación

- `node scripts/check.mjs` **verde**: anti-hardcode **0 violaciones**, typecheck OK, suites DB
  (RLS 15 / Edge 26 / Animal 28) todas pasan.
- Render fiel capturado y medido (CDP + Pillow): gradiente visible (delta 82), banner-strip ~75px
  logical (= token `$bannerStrip` 76), sin overflow horizontal a 412px, sin warnings de DOM
  (el nested-`<button>` se eliminó).
- Procesos http.server/Chrome muertos; puertos 8081/9223 libres; sin temporales.

## Captura

`design/stitch-iter-4/mis-campos-cards.png` (412px, dsf2, mobile).
