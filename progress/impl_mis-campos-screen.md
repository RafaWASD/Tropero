# impl — pantalla "Mis campos" (frontend, spec 01 R6.6 + R6.6.1 + R6.5)

baseline_commit: a80342d40f63da8c9e96497f5a52352cf77280e7

> Tarea de **frontend de diseño** (track ADR-023, componentes = deliverable), NO el
> pipeline SDD de la feature 01 (que sigue `deferred`: backend done, frontend pausado).
> Mismo régimen con que se construyó la home + la `EstablishmentCard`. No marca la feature
> como `done`. Continúa `progress/impl_mis-campos-card.md` (mismo baseline; la card ya
> estaba construida y aprobada — acá se hace la PANTALLA real sobre ella, sin tocarla).

## Qué se construyó

Se reescribió **`app/app/mis-campos.tsx`** de preview mínimo (4 mocks) a la **pantalla real**
de "Mis campos" (R6.6). Reusa la `EstablishmentCard` aprobada **tal cual** (no se modificó el
componente). Composición:

1. **Header** (R6.6) — título "Mis campos" ($8/700) + CTA **"Crear campo"** (pill outline
   $primary, arriba-derecha). Se mantuvo el del preview.
2. **Orden de la lista (R6.6.1)** — `sortEstablishments()`: el **campo activo o último
   visitado primero** (mock `ACTIVE_ID = 'la-juanita'`, en prod = `last_establishment_opened`
   R6.9 del contexto), el **resto alfabético** por nombre (`localeCompare('es-AR',
   { sensitivity: 'base' })` → acento-insensitive, "Á" no se separa de "A").
3. **Searchbar (R6.6.1)** — componente `SearchBar` (pill $surface/borde $divider, ícono
   `Search` de lucide + `TextInput` de RN). Se renderiza **SOLO con > `SEARCH_THRESHOLD`
   (8) campos** (`showSearch = ordered.length > 8`); con ≤8 NO se monta. Filtra por nombre
   **case/acento-insensitive en vivo** (`toLocaleLowerCase('es-AR') + includes`). Es
   **sticky**: vive en el header fijo (fuera del `ScrollView`), así queda arriba al
   scrollear la lista larga. Con search activo y 0 resultados → mensaje legible. Con ~10
   mocks (>8) **aparece** (verificado en el render).
4. **CTA "pegar link de invitación" (R6.5/R6.6, "si corresponde")** — componente
   `PasteInviteLink`: **ghost** (sin relleno, ícono `Link2` + texto $textMuted "¿Te
   invitaron a un campo? Pegá el link"), al **final** de la lista. No compite con "Crear
   campo" ni con la lista. Se **oculta mientras se busca** (no aporta al triage).
5. **Estado del activo** — la card de `ACTIVE_ID` recibe `isActive` → muestra "● activo"
   (lo hace el componente) y queda **primera** por el orden.

**Mock** (~10 establishments, nombres variados para verificar orden alfabético; roles
mezclados; los 3 estados de métrica hero repartidos + dos con ⚠):

| Campo | Rol | Métrica hero | Atención |
|---|---|---|---|
| **La Juanita** (ACTIVO) | Dueño | preñez 92% may'26 | ⚠ tacto pendiente |
| Bella Vista | Dueño | preñez 79% abr'26 | — |
| Don Alfredo | Operario | preñez 88% abr'26 | — |
| El Ombú | Veterinario | 860 cabezas · 12 may | — |
| El Triángulo | Operario | 320 cabezas · 28 abr | — |
| La Esperanza | Veterinario | **vacío → CTA "Configurá tu rodeo"** | — |
| Las Acacias | Veterinario | 540 cabezas · 03 may | ⚠ datos sin sincronizar |
| Monte Grande | Dueño | preñez 95% may'26 | — |
| San Isidro | Veterinario | 1.120 cabezas · 19 may | — |
| Santa Rosa | Dueño | **vacío → CTA "Configurá tu rodeo"** | — |

Orden renderizado (verificado): **La Juanita (activo) → Bella Vista → Don Alfredo → El Ombú
→ El Triángulo → La Esperanza → Las Acacias → Monte Grande → San Isidro → Santa Rosa**
(activo primero, resto alfabético). ✔

## Tokens nuevos

- **`app/tamagui.config.ts`** → **`size.inputText` (16)** — JIT, font size del `<TextInput>`
  del searchbar. Espeja `font.size.$5` (16px, "body grande / inputs" del DS v4) pero vive
  como token de `size` porque **cruza a una API no-Tamagui** (el `style.fontSize` del
  TextInput de RN, que pide un número) y se lee con `getTokenValue('$inputText', 'size')`.
  Mismo patrón que `navLabel` (font size del nav que cruza a `tabBarLabelStyle`). Sin esto
  se usó por error `getTokenValue('$5', 'size')` (escala `size`, no font → placeholder
  gigante); corregido. Único token nuevo de esta tarea; 0 literales en la pantalla.

## Qué quedó MOCK / STUB

- **Stats de cada card MOCK** (vacas/rodeos/preñez/última-maniobra/atención): rollup +
  queries backend + `last_establishment_opened` (R6.9) son sub-tarea del contexto
  multi-tenant / backend. Al cablear real: **nunca hardcodear `establishment_id`** — viene
  del contexto (CLAUDE.md ppio 6); `ACTIVE_ID` = `last_establishment_opened`.
- **Routing del `onPress`** (fijar campo activo R6.3 + navegar a home R6.7) y de los CTAs
  (crear campo R3.1, pegar invitación R6.5): `TODO`, sin routing real (preview).
- **Foto custom (`imageUrl`)**: no se usa en este mock (la card lo soporta; el branch se
  verificó en `impl_mis-campos-card.md`).

## Trazabilidad (R → evidencia)

La verificación de esta tarea de diseño es **typecheck + lint anti-hardcode + render fiel
medido** (no hay framework de unit-test de componentes en el repo; el `test` command son
typecheck + suites DB). Cada sub-requisito → su evidencia en los renders.

| Requisito | Evidencia |
|---|---|
| **R6.6** lista de campos con nombre + rol + indicador de activo + CTA crear campo | `design/stitch-iter-4/mis-campos-screen.png`: 10 cards (nombre + chip rol + "● activo" en La Juanita), header con "Crear campo" |
| **R6.6** al tocar → fija activo + navega a home | `onPress` cableado (TODO routing real, preview) |
| **R6.6.1** orden: activo/último-visitado primero, resto alfabético | render: La Juanita (activo) primero, luego Bella Vista→…→Santa Rosa alfabético; `sortEstablishments()` |
| **R6.6.1** searchbar SOLO con >8 campos | `showSearch = ordered.length > 8`; con 10 mocks aparece (visible en ambos renders); con ≤8 no se monta |
| **R6.6.1** filtra por nombre case-insensitive en vivo | `mis-campos-search.png`: "la" → La Juanita / Bella Vista / La Esperanza / Las Acacias (substring, acento-insensitive) |
| **R6.6.1** searchbar sticky | vive en el header fijo, fuera del `ScrollView` → queda arriba al scrollear |
| **R6.5/R6.6** CTA "pegar link de invitación" secundario y sutil, al final | `PasteInviteLink` ghost al final de la lista (`mis-campos-screen.png`, abajo); oculto al buscar |
| **R6.6.2** card del activo muestra "● activo" y queda primera | La Juanita: `● activo` + posición 1 |

## Verificación

- `node scripts/check.mjs` **verde**: anti-hardcode **0 violaciones** en `app/app` +
  `app/src/components`, typecheck client OK, suites DB (RLS / Edge / Animal 28) **0 fail**.
- Render fiel capturado con **CDP `Emulation.setDeviceMetricsOverride`** (412px, dsf2,
  mobile), no `--window-size`:
  - **`design/stitch-iter-4/mis-campos-screen.png`** — tope (header + searchbar + primeras
    cards) + el orden completo + el CTA "pegar link" al final.
  - **`design/stitch-iter-4/mis-campos-search.png`** — con "la" tipeado → lista filtrada a
    4 campos (incl. Las Acacias con ⚠), CTA "pegar link" oculto.
- Procesos Chrome headless + Metro (8081/9223) **muertos**; temp user-data-dir limpiado;
  script one-off de captura con búsqueda removido (no queda temporal). Puertos libres.

## Capturas

- `design/stitch-iter-4/mis-campos-screen.png` (412px, dsf2, mobile)
- `design/stitch-iter-4/mis-campos-search.png` (412px, dsf2, mobile — búsqueda "la")
