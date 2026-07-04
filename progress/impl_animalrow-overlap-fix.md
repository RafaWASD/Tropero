baseline_commit: 9912c1d7b61ebaa59c0027f66ec37b84018d584d

# impl — fix overlap AnimalRow (chip "Sin caravana" pisado por "Servida sin tacto")

Bug de layout Nivel A (ADR-028, sin delta-spec). En la lista de Animales, con categoría LARGA
("Vaca segundo servicio") + estado repro ("Servida sin tacto") + SIN caravana, la línea 2 del
subtítulo desbordaba hacia la derecha y **pisaba** el chip "Sin caravana".

## Root cause (confirmado)

`app/src/components/AnimalRow.tsx`, subtítulo de la fila NORMAL (no compact). La línea 2 era un
`XStack` con `CategoryBadge` + `ReproStatusChip` (**ambos flexShrink 0**) + rodeo (flexShrink 1),
dentro del centro `YStack flex={1} minWidth={0}`. El chip "Sin caravana" (`NoTagChip`) vive FUERA
del centro, a la derecha. Cuando badge (largo) + chip repro superaban el ancho del centro, como
ninguno de los dos podía encoger, **desbordaban** (RN no clipea por default) y se pintaban sobre el
chip de la derecha; el rodeo flexShrink-1 ya había truncado a 0 y no alcanzaba.

## Fix (solo `app/src/components/AnimalRow.tsx`)

Degradación elegante con la prioridad decidida por el leader:

1. **Badge de categoría — SIEMPRE completo.** Se envolvió `<CategoryBadge>` en `<View flexShrink={0}>`
   (CategoryBadge no reenvía props de layout, por eso el wrapper). Nunca trunca su texto.
2. **Chip "Sin caravana" (derecha) — intacto.** No se tocó `NoTagChip` ni su `flexShrink 0`.
3. **Chip de estado reproductivo — último recurso.** `ReproStatusChip`: `flexShrink 0` → `flexShrink 1`
   + `minWidth 0` (load-bearing: sin `minWidth 0` el min-content del chip impide encogerlo por debajo
   de su texto y el desborde vuelve). Su `Text` interno ya tenía `numberOfLines={1}` (+ `lineHeight $2`
   anti-descendente) → trunca con "…".
4. **Rodeo — cede PRIMERO.** `flexShrink 1` → `flexShrink 5000` (peso MUY superior al del chip repro):
   se consume casi por completo antes de que el chip repro empiece a truncar. Se agregó `lineHeight="$3"`
   (Text con numberOfLines → convención anti-recorte de descendentes).

   > Nota (por qué 5000, no 100): con `numberOfLines={1}` el flex-basis del rodeo resuelve a MIN-content
   > (chico) en web, así que un peso moderado (probé 100) hacía que el chip repro absorbiera ~12% del
   > encogimiento y truncara de más en el caso NORMAL (regresión respecto al pre-fix, donde el chip era
   > flexShrink 0 y nunca truncaba). Un peso muy alto (5000) hace que el rodeo domine el shrink y el chip
   > quede completo salvo en el caso apretado real. Verificado con la fila de control del capture (multípara
   > con caravana + rodeo largo → chip "Servida sin tacto" COMPLETO, solo el rodeo trunca).
5. **Red de seguridad.** `overflow="hidden"` en el `XStack` del subtítulo (línea 2, targeted — NO toca la
   línea del hero): si algo aún no puede encoger (categoría descomunal), se **clipea** en el borde del
   centro en vez de superponerse. Con el truncado del punto 3, el corte queda con "…", no a lo bruto.

Cero hardcode nuevo (solo tokens / flexbox). `buttonA11y`/`labelA11y`/labels intactos. es-AR intacto.

## Autorrevisión adversarial (paso 8) — 4 casos

- **(a) categoría CORTA ("Multípara") + sin caravana:** no cambia nada. El badge corto + chip repro +
  rodeo entran holgados en el centro; nadie llega a su `flexShrink` límite → render idéntico al previo.
  El `overflow hidden` no muerde (no hay overflow). ✅
- **(b) categoría LARGA "Vaca segundo servicio" + "Servida sin tacto" + SIN caravana (el bug):** el badge
  queda completo (flexShrink 0), el rodeo se va primero (flexShrink 100), y si aún falta ancho el chip
  repro trunca "Servida sin t…" (flexShrink 1 + minWidth 0 + numberOfLines 1). `overflow hidden` garantiza
  que NADA cruce el borde del centro → NO se superpone con "Sin caravana". ✅
- **(c) categoría larga + estado repro + CON caravana (chevron en vez de NoTagChip):** el chevron ocupa
  ~24px (vs ~104px del NoTagChip) → el centro tiene mucho más ancho → badge + chip repro completo + rodeo
  entran; degradación no se dispara. ✅
- **(d) compact:** el subtítulo compacto es OTRA rama (`categoría · edad` + FutureBullBadge), NO usa
  `ReproStatusChip`, `CategoryBadge` ni `NoTagChip`, y no se tocó. Sin cambios. ✅

Chequeos extra del adversario:
- ¿El rodeo cede antes que el chip repro? Sí: flexShrink 100 vs 1, y el rodeo puede llegar a 0 (minWidth 0)
  → absorbe ~99% del shrink antes de que el chip empiece.
- ¿Hero/categoría intactos? El hero (línea 1) no se tocó (sigue con su ellipsis, no overlapea nada porque
  el `NoTagChip` está a la derecha de TODO el centro y el hero vive dentro del centro con minWidth 0). El
  badge queda completo por el wrapper flexShrink 0.
- ¿Anti-recorte de descendentes en los Text con numberOfLines? Chip repro: `lineHeight $2` (ya). Rodeo:
  se AGREGÓ `lineHeight $3` (antes faltaba). `overflow hidden` clipea horizontalmente en el borde del
  XStack (que hugea la altura del hijo más alto = el badge, con el rodeo centrado con slack vertical) →
  no clipea descendentes verticalmente.
- ¿`overflow hidden` rompe el hero? No — se puso en el XStack del subtítulo (línea 2), no en el YStack
  centro; la línea del hero no se ve afectada.

## Reconciliación de specs

N/A — es un fix de layout Nivel A (ADR-028), sin delta-spec y sin cambio de contrato/comportamiento
observable más allá de la degradación descrita. No hay `requirements/design/tasks` de esta corrección.

## Verificación

- `cd app && pnpm typecheck`: **limpio** (incluye el nuevo `.capture.ts`).
- `node scripts/check.mjs --fast` (anti-hardcode ADR-023 §4): **0 violaciones** en app/app + app/src/components.
- Unit: AnimalRow NO tiene test dedicado; el fix es puro layout (flex/overflow), sin lógica nueva → nada que
  testear en unit. `shouldShowFutureBullBadge`/`reproChipTier` (helpers puros) no se tocaron.
- **Capture Gate 2.5** (`app/e2e/captures/animalrow-overlap.capture.ts`, viewport 412×915, `--workers=1`):
  `1 passed`. Genera 4 capturas en `app/e2e/captures/__shots__/animalrow-overlap/` (gitignoreadas):
  - `01-lista-sin-overlap.png` — lista completa: fila apretada (2210) + normal (3301) + control (5501), sin superposición.
  - `02-fila-apretada-sin-overlap.png` — el caso del BUG: badge "Vaca segundo servicio" COMPLETO + chip repro
    truncado a "Se…" (último recurso) + chip "Sin caravana" COMPLETO, **SIN pisarse**.
  - `03-fila-normal-chevron.png` — fila normal (Ternero + chevron): categoría corta, sin cambios.
  - `04-fila-control-chip-completo.png` — multípara con caravana + rodeo largo: chip "Servida sin tacto"
    COMPLETO (solo el rodeo trunca) → confirma que el caso normal NO cambió.
  - El capture incluye un ORÁCULO de no-superposición: `reproBox.x + reproBox.width <= noTagBox.x + 0.5` en la
    fila del bug (chips scopeados DENTRO de esa fila) → **pasa**. El `.capture.ts` se commitea; los `__shots__` NO.
- `git diff supabase/` **vacío** (frontend-only) y `git status design/` **limpio** (el `e2e:build` no dejó
  diffs espurios en `design/`; no hizo falta revertir nada).
