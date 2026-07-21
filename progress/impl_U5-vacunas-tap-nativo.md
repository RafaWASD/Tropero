# impl U5 — "cargar vacunas" no funciona en la maniobra en NATIVO 🔴

baseline_commit: 080100b399dd75467130295b5ef6abb5f7130cc1

Bugfix U5 (tanda `docs/plan-mejoras-2026-07-20.md`). Reportado por Raf en device (iOS + Android):
la carga de vacunas de la maniobra no responde al tap en nativo (anda en web).

## Veredicto

**La hipótesis fuerte se CONFIRMA como la causa raíz — pero el offender YA ESTABA ARREGLADO.**
El patrón exacto (RN `<Pressable>` envolviendo un Tamagui con `pressStyle`) existía en las filas del
checklist de vacunas y fue corregido en el **lote 6 del barrido de taps** (commit `47a4b5c`, 2026-07-18).
El árbol actual (HEAD `080100b`) ya contiene el fix. **No hay cambio de código para aplicar de mi parte.**

Conclusión operativa: el reporte de device de U5 casi seguro viene de un build ANTERIOR al lote 6
(el propio barrido de 6 lotes se disparó por reportes de taps de Raf en device; el fix de vacunas cayó
en el ÚLTIMO lote). Acción: **Raf rebuildea main actual en device y re-testea.**

## El offender (confirmado en git)

Archivo: `app/app/maniobra/_components/SilentVaccinationStep.tsx` — filas del checklist APLICA/NO-APLICA.

Versión PRE-lote-6 (`git show 47a4b5c^:...`), líneas ~109-118 — patrón ofensor EXACTO:

```tsx
<Pressable                                   // ← RN Pressable (outer)
  key={it.name}
  onPress={() => toggle(it.name)}            // ← onPress acá NO dispara en nativo new-arch
  testID={`vaccine-check-${it.name}`}
  {...switchA11y(...)}
>
  <XStack
    backgroundColor={applies ? '$greenLight' : '$white'}
    ...
    pressStyle={{ opacity: 0.85 }}           // ← Tamagui-con-pressStyle (inner) roba el responder
  >
    ...
```

El `<XStack>` interno tiene `pressStyle`; en RN new-arch le roba el responder de touch al `<Pressable>`
que lo envuelve → el `onPress` del Pressable no dispara en nativo (en web sí). Es exactamente
`reference_rn_pressable_tamagui_tap`.

## El fix (ya presente, lote 6 · commit 47a4b5c)

Fix canónico aplicado: se ELIMINÓ el `<Pressable>` y `onPress` + a11y quedaron en la MISMA pieza Tamagui
(el `<XStack>`) que tiene su `pressStyle`. Estado actual (líneas 109-124):

```tsx
<XStack
  key={it.name}
  onPress={() => toggle(it.name)}            // ← onPress en la MISMA pieza con pressStyle → dispara nativo
  testID={`vaccine-check-${it.name}`}
  backgroundColor={applies ? '$greenLight' : '$white'}
  ...
  pressStyle={{ opacity: 0.85 }}
  {...switchA11y(Platform.OS, { label: it.name, checked: applies, disabled: false })}
>
```

## Barrido de TODA la superficie de tap de vacunas (lote chico, solo vacunas)

Revisado y SIN patrón ofensor:

- **`SilentVaccinationStep.tsx`** (step por-animal, el checklist):
  - Filas toggle → `<XStack onPress pressStyle>` (fix lote 6). OK.
  - CTA "Aplicar y seguir / Seguir sin aplicar" → `<View onPress pressStyle>` (patrón canónico).
    IDÉNTICO al CTA de `CondicionCorporalStep`/`PesajeStep` (mismo flujo de maniobra, NO reportados rotos
    en nativo) → patrón PROBADO en nativo new-arch. OK.
- **`ManeuverConfigSheet.tsx`** (preconfig de tanda = "Cargá una o varias vacunas para toda la tanda"):
  cero `pressStyle` en todo el archivo. "Agregar" = `<Pressable>` → `<View>` SIN pressStyle (no ofensor,
  dispara). "Guardar"/"Cancelar" = `<Button>` del DS. Backdrop/chips/sugerencias = `<Pressable>` sin
  pressStyle interno. OK.
- **`ManeuverReorderList.tsx`** (tocar la fila "Vacunación" para abrir el sheet de preconfig): usa
  `GestureDetector` + `Gesture.Tap()` de gesture-handler (no es el patrón Pressable/pressStyle) → nativo OK.
  Si esto fallara, fallaría también Inseminación (mismo gesto), no solo vacunas.
- **`GroupActionsBar.tsx`** (acción masiva "Vacunar"): ya arreglado — `onPress` en el `<XStack>` con
  `pressStyle` (el match del grep fue el COMENTARIO explicativo). OK.
- **`vacunacion-masiva.tsx`** (pantalla de vacunación masiva): `<Pressable>` sin pressStyle interno +
  CTA `<Button>`. OK.

Grep multiline `<Pressable ...>{0,600}pressStyle=` en toda `app/` → 13 hits, TODOS falsos positivos
(Pressable cerca de un pressStyle que no envuelve, o el término en un comentario). Ninguno en el flujo
de vacunas.

## Autorrevisión adversarial

- ¿La hipótesis se confirma? SÍ, al 100% (git show del pre-lote-6 muestra el patrón exacto).
- ¿El fix está realmente en el árbol actual? SÍ (leído en disco líneas 109-124; `git log` confirma que
  el último commit que tocó el archivo es 47a4b5c; `git status` sin cambios pendientes en ese archivo).
- ¿El CTA `<View onPress>` dispara en nativo o es otro offender latente? Dispara — es el MISMO patrón
  que `PesajeStep` (teclas numéricas `<View onPress pressStyle>`) y `CondicionCorporalStep` (CTA), ambos
  del mismo flujo de maniobra y NO reportados rotos. Patrón probado.
- ¿"cargar vacunas" podría referirse al preconfig y no al step? Cubrí ambos: preconfig (ManeuverConfigSheet)
  tampoco tiene el patrón; sus taps disparan en nativo.
- ¿Podría ser una causa native-específica DISTINTA (no el patrón)? Posible pero NO evidenciada en el
  código. Si tras un build fresco sigue roto, NO es el patrón Pressable/pressStyle (ya arreglado) → habría
  que diagnosticar en device (p. ej.: ¿el checklist llega vacío porque el preconfig de la tanda no persistió
  en stage-2?). NO adiviné un fix para eso (regla del task).

## Verificación

- `pnpm run typecheck` (app/) → **limpio** (0 errores). No hice cambios de código, así que el árbol queda
  igual que HEAD (feature 21, verde).
- Verificación real = DEVICE (Raf). No reproducible en web (por eso se escapó del E2E). No inventé un E2E web.

## Qué debe testear Raf en device (entregable)

1. **Rebuildear la app nativa desde main actual** (debe incluir `47a4b5c` o posterior; HEAD `080100b` lo
   incluye). Este es el paso clave: el fix ya está en el código, falta que llegue al build del teléfono.
2. Arrancar una maniobra con **Vacunación** configurada (≥1 vacuna en el preconfig de la tanda, stage 2).
3. Llegar al step de vacunas por animal (checklist "Vacunas de la tanda"):
   - Tocar una fila → debe alternar APLICA (verde, casilla llena ✓) ↔ NO APLICA (blanca, casilla vacía).
   - Tocar **"Aplicar y seguir"** → debe persistir y avanzar al próximo paso/animal.
4. Si TODO responde → U5 resuelto (era build viejo).
5. Si SIGUE sin responder en un build fresco → **NO es el patrón Pressable/pressStyle** (ya corregido y
   equivalente a Pesaje/Condición corporal que sí andan). Reportar a leader/Raf para diagnóstico en device
   (candidato a revisar: si el checklist aparece vacío = "No hay vacunas definidas para esta tanda", el
   problema está en la persistencia del preconfig de stage-2, no en el tap del step).

## Reconciliación de specs

Sin cambios de código → sin reconciliación. El as-built del step ya coincide con el fix documentado en el
commit 47a4b5c.
