# impl — ADR-027: Centrado robusto ante decoraciones (CenteredRow)

baseline_commit: b23c4cda616af4fbcf8ebb12c0eede354879f4b0

Tarea de diseño/frontend (no SDD spec dir): implementar el invariante de ADR-027 — primitiva
`CenteredRow`, fix de la card "Cría" del wizard Crear rodeo, y sweep de todas las pantallas/componentes.

## Entregable 1 — `CenteredRow` (app/src/components/CenteredRow.tsx)

API final real (coincide con el contrato del ADR-027; única precisión: `XStackProps` se modela con
`GetProps<typeof XStack>` como el resto de la librería — Button/Card usan `GetProps` — en vez de
importar el tipo `XStackProps` de `@tamagui/stacks`):

```tsx
export type CenteredRowProps = Omit<GetProps<typeof XStack>, 'children'> & {
  children: ReactNode;             // contenido centrado
  left?: ReactNode;                // decoración izquierda (opcional, default null)
  right?: ReactNode;               // decoración derecha (opcional, default null)
  sideWidth: SizeTokens | number;  // ancho reservado a CADA lado (IGUAL en ambos)
};
```

Render: `[ slot izq width=sideWidth flexShrink=0 justify=flex-start ][ centro flex=1 minWidth=0
align=center justify=center ][ slot der width=sideWidth flexShrink=0 justify=flex-end ]`. Los dos
slots laterales se renderizan SIEMPRE (aunque `left`/`right` sea null) → centrado real + reserva del
slot de decoraciones condicionales. Frame `XStack width=100% alignItems=center` + passthrough de
props de XStack (gap/minHeight/padding/…). Exportado `CenteredRow` + `CenteredRowProps` en
`app/src/components/index.ts`. Cero hardcode (sideWidth = token o número; resto via tokens).

## Entregable 2 — Fix SystemCard (app/app/crear-rodeo.tsx)

Decisión Raf: cards CENTRADAS, SIN círculo de radio.
- SACADO: el `View` del radio circular (`$icon`/`$pill`/borde + `$dot` interno) y su comentario.
- El `XStack` (row con label flex + radio) → `YStack alignItems=center justifyContent=center`. Label
  `{system.name}` y subtítulo "Próximamente" con `textAlign="center"`. Todas las cards (Cría + las
  disabled) centradas al MISMO x.
- MANTENIDO: estado a11y `selected` (buttonA11y → `aria-pressed`), borde/fondo por `selected`
  ($primary 2px + $surface bone), `minHeight="$touchMin"`, `opacity` disabled, `Pressable`
  disabled/onSelect.
- NO se usó CenteredRow (ya no hay decoración lateral → centrado simple alcanza, como pide el brief).
- e2e: `rodeos.spec.ts` + helpers seleccionan "Sistema Cría" por su `aria-label` (role button), NO
  asertan presencia del círculo → no se debilitó cobertura; la selección sigue verificable por el
  flujo (Continuar habilitado tras elegir Cría). No hubo que tocar el spec.

## Entregable 3 — Sweep (32 app/**/*.tsx + 15 components, animal/[id].tsx EXCLUIDO)

Método: grep estructural (ChevronLeft/ArrowLeft, textAlign=center, justifyContent=center,
space-between, X/onClose, {selected ?…}) + lectura de cada locus candidato. Resultado: **2 FIX**
(crear-rodeo ya hecho como entregable 2; nada más), **1 EXCLUDED** (animal/[id].tsx), el resto CLEAN.

Hallazgo clave: los headers con back-chevron son TODOS títulos **left-aligned** (patrón iOS
large-title / Material), NO títulos centrados — el back no corre ningún centro → CLEAN (no es el
bug). Las listas seleccionables (FilterPopover, OptionRows, Select.Option, ToggleRow, menú del
switcher) son **intencionalmente left-aligned** con label flex + check/toggle a la derecha → CLEAN
(no convertir a centradas, lo dice el brief). Los CTAs con ícono leading ligado al label
(PrimaryCta, "Agregar otro ternero", Copiar/Compartir de ShareLink) → grupo ícono+label centrado,
exclusión explícita del ADR-027 → CLEAN.

### Tabla de auditoría

| Archivo | Clasif. | Nota |
|---|---|---|
| app/app/crear-rodeo.tsx | **FIX** | SystemCard: sacado el radio, contenido centrado (entregable 2) |
| app/app/animal/[id].tsx | **EXCLUDED** | working-tree de C6 sin commitear; reportado, no tocado |
| app/app/(tabs)/index.tsx | CLEAN | header space-between (switcher/wordmark/avatar) FIRMADO; wordmark en flujo space-between, no título-centrado corrido — ver "reportado" |
| app/app/(tabs)/animales.tsx | CLEAN | FilterPopover = left-aligned + check en slot reservado (FIX 3, ya correcto); chips de filtro centrados sin decoración lateral; empty-states centrados sin decoración |
| app/app/(tabs)/mas.tsx | CLEAN | ActionRow/EmailRow left-aligned con slots; CTAs destructivos = grupo ícono+label centrado; header "Más" left-aligned |
| app/app/(tabs)/reportes.tsx | CLEAN | stub centrado, sin decoración |
| app/app/(tabs)/maniobra-fab.tsx | CLEAN | stub "…" centrado, sin decoración |
| app/app/(tabs)/_layout.tsx | CLEAN | tab bar (React Navigation) + NavTabIcon firmado (ADR-018), ícono+label como grupo |
| app/app/maniobra.tsx | CLEAN | stub centrado (ícono+texto+botón apilados), sin decoración lateral |
| app/app/agregar-evento.tsx | CLEAN | header left-aligned; OptionSelector left-aligned + check sin slot pero anclado izq (no centra); chips condición centrados sin decoración; "Agregar ternero" = grupo ícono+label |
| app/app/crear-animal.tsx | CLEAN | header left-aligned; OptionRows left-aligned + check anclado izq; chips condición centrados |
| app/app/import-rodeo.tsx | CLEAN | headers left-aligned (3); icon-container con ícono centrado en su propia caja |
| app/app/rodeos.tsx | CLEAN | header "Rodeos" left-aligned |
| app/app/lotes.tsx | CLEAN | header "Lotes" left-aligned |
| app/app/editar-plantilla.tsx | CLEAN | header left-aligned (título+rodeo en YStack flex) |
| app/app/animal/baja.tsx | CLEAN | header left-aligned; icon-container centrado en su caja |
| app/app/miembros.tsx | CLEAN | header: back + título "Equipo" flex left-aligned + "Invitar" → título left-aligned (no centrado) |
| app/app/mis-campos.tsx | CLEAN | header space-between título left-aligned + CTA; CreateFieldButton/PasteInvite = grupo ícono+label; SearchBar leading-icon |
| app/app/crear-campo.tsx | CLEAN | AuthScreenShell + FormField |
| app/app/editar-campo.tsx | CLEAN | AuthScreenShell + FormField |
| app/app/onboarding.tsx | CLEAN | AuthScreenShell + Button |
| app/app/campo-perdido.tsx | CLEAN | AuthScreenShell + Button + InfoNote |
| app/app/cambiar-email.tsx | CLEAN | AuthScreenShell |
| app/app/invitar.tsx | CLEAN | AuthScreenShell + ShareLink + FormField |
| app/app/invite.tsx | CLEAN | AuthScreenShell |
| app/app/verify-email.tsx | CLEAN | AuthScreenShell |
| app/app/update-password.tsx | CLEAN | AuthScreenShell |
| app/app/(auth)/sign-in.tsx | CLEAN | AuthScreenShell |
| app/app/(auth)/sign-up.tsx | CLEAN | AuthScreenShell |
| app/app/(auth)/forgot-password.tsx | CLEAN | AuthScreenShell |
| app/app/(auth)/_layout.tsx | CLEAN | Stack config (sin UI) |
| app/app/_layout.tsx | CLEAN | RootGate (lógica de navegación, sin filas UI) |
| app/app/update-password.tsx | CLEAN | AuthScreenShell |
| app/app/baston-test.tsx | CLEAN | harness dev (no prod): filas space-between label/valor; banner ícono+texto flex-start |
| app/src/components/CenteredRow.tsx | CLEAN | la primitiva nueva (entregable 1) |
| app/src/components/Button.tsx | CLEAN | label centrado, sin decoración lateral |
| app/src/components/Card.tsx | CLEAN | superficie, sin filas |
| app/src/components/AuthScreenShell.tsx | CLEAN | wordmark alignSelf=center solo en su fila; título left-aligned |
| app/src/components/AuthBits.tsx | CLEAN | FormError/InfoNote bloque texto; LinkButton texto centrado sin decoración |
| app/src/components/FormField.tsx | CLEAN | label-above-input |
| app/src/components/Stepper.tsx | CLEAN | rail (slot fijo) + contenido left-aligned flex |
| app/src/components/EstablishmentCard.tsx | CLEAN | nombre left-aligned + spacer flex + RoleBadge; todo alignSelf/textAlign left |
| app/src/components/EstablishmentSwitcherDropdown.tsx | CLEAN | Row = menú left-aligned (icon slot fijo + label flex + trailing slot) |
| app/src/components/FieldTemplateToggleList.tsx | CLEAN | ToggleRow left-aligned + toggle a la derecha (slot fijo) |
| app/src/components/AnimalRow.tsx | CLEAN | avatar (slot) + contenido flex left + trailing siempre presente (chevron|chip) |
| app/src/components/CategoryBadge.tsx | CLEAN | pill standalone |
| app/src/components/RoleBadge.tsx | CLEAN | chip standalone |
| app/src/components/TimelineEvent.tsx | CLEAN | gutter (slot) + contenido flex left |
| app/src/components/ShareLink.tsx | CLEAN | link box; botones Copiar/Compartir = grupo ícono+label centrado (ícono swap Copy↔Check no descentra) |
| app/src/components/Select.tsx | CLEAN | trigger left-aligned + chevron; Option left-aligned + check (anclado izq) |

## Reportado-pero-no-tocado

1. **app/app/animal/[id].tsx** (EXCLUIDO): tiene working-tree de C6 sin commitear. El caso "Crear
   lote nuevo" (~línea 996) YA está correcto con spacer simétrico (`width={20}` hardcodeado, el
   2do parche ad-hoc que cita el ADR). Follow-up posible: migrarlo a `CenteredRow` cuando C6 cierre,
   para matar el último spacer hardcodeado. NO tocado.
2. **app/app/(tabs)/index.tsx** header (FIRMADO por Raf): el wordmark "RAFAQ" vive en un header
   `justifyContent="space-between"` de 3 elementos (switcher variable a la izq, wordmark al medio,
   avatar fijo a la der). El wordmark NO está matemáticamente centrado — flota en el medio de un
   space-between y su x depende del ancho del switcher (que trunca). NO es el bug canónico (ninguna
   decoración "come un solo lado" de un elemento que se quiera centrado; es un layout space-between
   deliberado y firmado). Lo dejo CLEAN, pero lo reporto por si Raf quiere el wordmark
   perfectamente centrado a viewport (sería un `CenteredRow sideWidth=$avatar` con switcher izq +
   avatar der). Decisión de producto, no del invariante. NO tocado.

## Entregable 4 — Verificación + autorrevisión

- `node scripts/check.mjs` desde la raíz → **exit 0** (incluye el lint anti-hardcode: mis archivos
  pasan sin literales hex/px).
- `pnpm typecheck` (tsc --noEmit) → **exit 0** (CenteredRow con SizeTokens/GetProps tipa OK).
- e2e `rodeos.spec.ts` (web export + Playwright/chromium) → **2 passed, 1 failed**.
  - PASA: "BUG 2 — clickear fila toggle flippea aria-checked" y "BUG 1 — crear rodeo desde
    empty-state aterriza en home sin CTA pendiente". AMBAS recorren el wizard COMPLETO con mi
    SystemCard cambiado (eligen "Sistema Cría" por aria-label role button → Continuar → nombre →
    plantilla → Crear → home). Prueban que el fix NO rompió la selección ni el create.
  - FALLA (pre-existente, AJENA a mi cambio): "crear rodeo con un toggle destildado → la config
    queda deshabilitada", en la línea 138 — una query SERVER-SIDE (`rodeos.length > 0` tras
    re-login anon con RLS) devolvió 0. El fallo NO es de UI: el test pasó `gotoCrearRodeoStep3`,
    `completeCrearRodeo` y `waitForHome` (todo el flujo visual del wizard) sin romper; reventó
    recién en la verificación de DB remota. Reproducible (no flake), pero independiente de mi diff:
    mi cambio en crear-rodeo.tsx es PURAMENTE visual (XStack→YStack + sacar el círculo; ver
    `git diff app/app/crear-rodeo.tsx` — no toca onCreate/createRodeo/services). El working-tree
    tiene cambios sin commitear de OTRAS terminales (C6 en animal/[id].tsx, spec 10, animals.ts,
    admin.ts seedAnimal) que tocan el estado de la DB remota compartida durante la corrida — causa
    probable. Las 2 tests que SÍ crean rodeo y aterrizan en home pasan → el create funciona. No
    "debilité" la cobertura: la selección de "Cría" sigue verificada por el avance del wizard.

### Autorrevisión adversarial

- ¿El centro queda REAL en el centro? En CenteredRow sí: dos slots de ancho IGUAL → centro
  matemático. En SystemCard, `YStack alignItems=center` sobre el ancho 100% de la card (sin
  decoración lateral) → centro real, todas las cards al mismo x. ✔
- ¿Slot asimétrico? No: ambos slots usan el MISMO `sideWidth`; left a flex-start, right a flex-end,
  ambos flexShrink=0. ✔
- ¿a11y roto? No: SystemCard conserva `buttonA11y(...selected)` (aria-pressed/accessibilityState
  selected) + label disabled/próximamente. CenteredRow es layout puro (sin a11y propio; el caller
  pone el suyo). ✔
- ¿Hardcode colado? No (lint verde). `sideWidth` se pasa como token ($navIcon/$icon/$avatar) o
  número por el caller; la primitiva no hardcodea nada. ✔
- ¿Sweep exhaustivo? Recorrí los 33 archivos de app/app/** (incluye el nuevo conteo) y los 16 de
  components/** (15 previos + CenteredRow). Ninguno salteado; cada uno clasificado con razón. ✔
- ¿Tests por la razón equivocada? El e2e de rodeos ejercita el path real (elige Cría por aria-label
  role button, avanza, crea) — sigue verde tras sacar el círculo porque la selección NO dependía del
  círculo visual, dependía del estado `selected` (que se mantuvo). No es un falso verde. ✔

## Reconciliación de specs

ADR-027 ya describe el contrato; la única diferencia con el código es `XStackProps` →
`GetProps<typeof XStack>` (decisión de consistencia con la librería, no cambia la API pública ni el
comportamiento). No reescribo el ADR por esto — queda anotado acá y en el header de CenteredRow.tsx.
No hay `specs/active/<feature>` para esta tarea (es de diseño directa, no SDD).
