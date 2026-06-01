baseline_commit: acf1d3dbde8bab8a5944a2695d09f4ecfcc7cd41

# impl — spec 02 frontend · C1 RODEOS · FIX-LOOP (2 bugs de runtime + cobertura E2E)

Feature en curso: **02-modelo-animal** (frontend, chunk C1). Fix-loop de los 2 bugs que Raf
encontró probando en web. **Frontend only.** Baseline = el de C1 (multi-sesión, NO se sobreescribe).

## Bugs a fixear

- **BUG 1** — la home muestra "Creá y configurá tu primer rodeo" como paso ACTIVO aunque ya hay
  rodeo. Causa: `app/app/(tabs)/index.tsx` tiene un Stepper ESTÁTICO (`WIZARD_STEPS`) con estado
  hardcodeado + CTA con `// TODO: navegar` muerto.
- **BUG 2** — en el paso 3 del wizard "Crear rodeo", los toggles no responden al tap. Causa real:
  a determinar reproduciendo con Playwright contra un browser real (NO asumir).

## Plan (tasks de este run)

- **T1 — Reproducir BUG 2 con Playwright** (spec nuevo `rodeos.spec.ts`): navegar al paso 3,
  clickear una fila de toggle, asertar que `aria-checked` flippea. Debe FALLAR contra el código
  actual (= reproduce el bug). Diagnóstico de la causa REAL antes de tocar el componente.
- **T2 — Fix BUG 2** en `FieldTemplateToggleList.tsx` (+ aplicar a "Editar plantilla", mismo
  componente). Re-correr el spec → VERDE.
- **T3 — Fix BUG 1** en `app/app/(tabs)/index.tsx`: Stepper driveado por estado real (useRodeo +
  membership), sin CTAs muertos.
- **T4 — Spec E2E de rodeos** (`rodeos.spec.ts`): empty-state → crear rodeo → home limpia (cubre
  BUG 1); toggle interactivo (cubre BUG 2 = regresión); (si barato) crear con un toggle destildado
  → config persistida.
- **T5 — `app/e2e/README.md`** con las filas nuevas.
- **T6 — Verificar**: `node scripts/check.mjs` verde + `pnpm e2e` con los nuevos VERDES.

## Estado al re-abrir (sesión nueva)

La infra de test ya estaba escrita por una pasada previa (NO se sobreescribe el baseline):
- `app/e2e/rodeos.spec.ts` (3 tests: BUG 2 toggle, BUG 1 home limpia, config persistida) ✅ existe.
- `app/e2e/helpers/rodeos.ts` (`gotoCrearRodeoStep3`, `completeCrearRodeo`) ✅ existe.
- `app/e2e/README.md` NO tiene aún la fila de rodeos (sigue en "13 tests") → pendiente T5.

Los FIXES de código NO están aplicados todavía:
- `FieldTemplateToggleList.tsx` sigue spreadeando `role`/`aria-*` crudos sobre el `Pressable` de RN-web (BUG 2 sin fixear).
- `app/(tabs)/index.tsx` sigue con `WIZARD_STEPS` estático + CTA con `// TODO: navegar` muerto (BUG 1 sin fixear).

Plan restante: reproducir BUG 2 (T1) → fixear BUG 2 (T2) → fixear BUG 1 (T3) → README (T5) → verificar (T6).

---

## CAUSA REAL de BUG 2 (el hallazgo clave)

El bug **NO se reproduce en el export estático de producción** (`expo export -p web`, lo que corre la
suite E2E): ahí el toggle SIEMPRE respondió al tap (verificado con diag de Playwright: center-click y
touchscreen-tap, ambos flippean; sin overlays; `touch-action: manipulation`, `pointer-events: auto`).
Por eso el `rodeos.spec.ts` "BUG 2" pasaba aún contra el código sin fixear → era un test que **pasaba
por la razón equivocada**.

Raf probó en **`pnpm web` (Metro DEV)**, no el export. Reproduje contra el dev server (:8077) con un
diag temporal y capturé el error de la consola:

> **React does not recognize the `accessibilityLabel` prop on a DOM element.**

Mecanismo: `react-native-web` NO traduce `accessibilityLabel` a `aria-label` cuando se spreadea sobre
un `Pressable`/`View` que ya tiene props ARIA crudas (`role`/`aria-*`) → React lo deja pasar al `<div>`
como atributo desconocido y **tira el warning**. En DEV (Metro/Expo) ese warning **monta el
error-overlay/LogBox de Expo**, que cubre la pantalla e **intercepta los toques** → "no había acción"
en el toggle (y en cualquier control de esa pantalla, incl. "Continuar" del paso 1). En el export de
PRODUCCIÓN los warnings y el LogBox se eliminan → el overlay no existe → invisible. Lead #1 (tokens
`$toggleTrack`/etc.) DESCARTADO: existen y resuelven. La causa era el leak de `accessibilityLabel`,
exactamente la familia del lead #2 (props a11y crudas sobre el Pressable de RN-web).

## Fixes aplicados (T2 + T3)

**BUG 2 — leak de `accessibilityLabel` (T2).** Centralicé el patrón correcto (web → `aria-label`;
native → `accessibilityLabel`, igual que `Button.tsx`) en un helper PURO testeado:
- **`app/src/utils/a11y.ts`** (nuevo): `switchA11y(platform, {label,checked,disabled})` y
  `buttonA11y(platform, {label,disabled?,selected?})`. En web emiten SOLO atributos ARIA DOM-válidos
  (NUNCA `accessibility*`); en native SOLO `accessibility*`. Lógica pura, sin React/RN → node:test.
- **`app/src/utils/a11y.test.ts`** (nuevo): 8 tests. Propiedad load-bearing: en web NUNCA se emite
  `accessibilityLabel` (la prop que monta el overlay). Wired en `scripts/run-tests.mjs`.
- Aplicado a la superficie de C1: `FieldTemplateToggleList.tsx` (`switchA11y`), `crear-rodeo.tsx`
  (SystemCard + ProgressBar, `buttonA11y`/branch), `rodeos.tsx` (3 Pressables, `buttonA11y`),
  `editar-plantilla.tsx` (back, `buttonA11y`). "Editar plantilla" usa el MISMO componente de toggle →
  el fix lo cubre por composición.

**BUG 1 — Stepper estático con CTA muerto (T3).** En `app/app/(tabs)/index.tsx`:
- Borré `WIZARD_STEPS` (estático, paso "rodeo" hardcodeado `active`, CTA con `// TODO`).
- Los pasos se derivan de estado REAL (`useRodeo` + rol del campo activo). Como el RootGate garantiza
  ≥1 rodeo en la home (con 0 rodeos muestra el bloqueo total, NO la home), el paso de rodeo SIEMPRE
  está **`done`** acá. CTAs reales, ninguno muerto:
  - "Configurá tu rodeo" → `done` → CTA "Gestionar rodeos" (`/rodeos`).
  - "Cargá tu primer animal" → `active` → CTA "Ir a Animales" (`router.navigate('/(tabs)/animales')`,
    la tab stub ya es navegable; el alta find-or-create es C2).
  - "Invitá a tu vet o capataz" → `future` → CTA "Invitar al equipo" (`/miembros`) **solo si owner**
    (R5); a un no-owner no se le ofrece el CTA.
- **`app/src/components/Stepper.tsx`**: agregué el estado `done` (círculo relleno verde con ✓; título
  atenuado), además de `active`/`future`. (El bug pedía "mirá los estados disponibles" — no había
  `done`, lo agregué.)

## Trazabilidad (bug → fix → test)

| Bug | Fix | Test(s) |
|---|---|---|
| BUG 2 (toggle no responde en DEV) | `a11y.ts` + aplicado a FieldTemplateToggleList/crear-rodeo/rodeos/editar-plantilla | **Regresión REAL de la causa**: `a11y.test.ts` (web nunca emite `accessibilityLabel`, 8 tests). **Verificación contra DEV (oráculo)**: diag manual contra Metro :8077 → toggle flippea + 0 warnings `accessibilityLabel` (diag removido). **Regresión de interacción**: `rodeos.spec.ts` "BUG 2" (la fila sigue siendo `role=switch` tappable en el export). |
| BUG 1 (home miente + CTA muerto) | Stepper driveado por estado real en `index.tsx` + estado `done` en `Stepper.tsx` | `rodeos.spec.ts` "BUG 1" (tras crear rodeo, home SIN "Creá tu primer rodeo" + SIN CTA "Crear rodeo" muerto + CON "Gestionar rodeos"/"Ir a Animales"). **Verificación contra DEV**: diag manual → `pendiente=0, ctaCrear(muerto)=0, gestionar=1, irAnimales=1` (removido). |

## Regresión expuesta por C1 (gate de rodeo) — fixtures E2E

El RootGate de C1 bloquea TODA la app si el campo activo tiene 0 rodeos (bloqueo total R2.6). Eso hizo
fallar 8 tests E2E pre-C1 (account/auth-logout/invitations/profile) que sembraban un campo SIN rodeo y
esperaban aterrizar en home/Más → ahora caían en el wizard "Creá tu primer rodeo". NO es bug de mi fix;
es la interacción correcta del gate nuevo con fixtures viejos. Resuelto:
- **`app/e2e/helpers/admin.ts`**: nuevos `seedRodeo(estId)` y `seedEstablishmentWithRodeo(ownerId, name)`
  (vía service_role, resuelven bovino/cría por code, el trigger 0018 pre-pobla config; cleanup por
  CASCADE del establishment).
- Sembrado un rodeo donde el test necesita llegar a home: `profile.spec.ts` (×3), `account.spec.ts`
  (×3, incl. el miembro de "baja simple"), `auth.spec.ts` (logout), `invitations.spec.ts` (Campo
  Equipo, lo heredan owner + invitado), `establishments.spec.ts` (Campo Norte elegido).
- **`establishments.spec.ts` "crear campo desde onboarding"**: ahora termina, correctamente, en el
  bloqueo total de rodeo (no en home) — refleja el flujo real post-C1 (R2.6) y lo deja determinista
  (antes pasaba por una carrera de render).

## Out-of-scope anotado (backlog 2026-06-01)

El leak de `accessibilityLabel` crudo existe en MUCHAS pantallas fuera de C1 (mas/miembros/mis-campos/
AnimalRow/EstablishmentCard/etc.). Fix transversal + lint anti-`accessibilityLabel` → backlog. No
bloquea. (Raf probó esas pantallas en dev sin bloqueo evidente; el badge no las tapaba.)

## Autorrevisión adversarial

- **¿El toggle realmente cambia en el browser?** SÍ, verificado contra el DEV server (Metro :8077), no
  solo el export — toggle flippea + 0 warnings `accessibilityLabel`. El export ya lo hacía (no era el
  oráculo del bug).
- **¿Test que pasa por la razón equivocada?** Detectado: el `rodeos.spec.ts` "BUG 2" pasaba contra el
  código sin fixear (el bug no vive en el export). Documentado en el header del spec + README; el guard
  REAL de la causa es el unit `a11y.test.ts`. NO lo dejé como "verde engañoso".
- **¿La home refleja estado real sin CTAs muertos?** SÍ. Paso de rodeo `done`, sin "Creá tu primer
  rodeo", sin CTA "Crear rodeo" muerto; los 2 CTAs nuevos navegan a destinos reales. Invite solo owner.
- **¿Token faltante (lead #1)?** Descartado: `$toggleTrack/$toggleThumb/$toggleKnob/$progressTrack/
  $dot/$avatar` existen en `tamagui.config.ts` y resuelven.
- **¿Leaks de a11y restantes en la superficie de C1?** Grep confirmó: 0 `accessibilityLabel` crudo en
  crear-rodeo/rodeos/editar-plantilla/FieldTemplateToggleList (solo en ramas native correctas + comments).
- **¿Rompí otros flujos?** Las 8 fallas E2E eran fixtures pre-C1 chocando con el gate nuevo (no mi fix);
  resueltas sembrando rodeo. Suite completa 16/16. check.mjs 154 unit + 17 RLS + 36 edge + 28 animal +
  13 maniobras, anti-hardcode 0, typecheck OK.
- **Edge case home en `rodeo.status==='loading'`**: el RootGate mantiene el splash en loading (no pinta
  la home); si por carrera se pintara, el paso saldría `active` un tick y el CTA "Gestionar rodeos"
  funciona igual → no hay CTA muerto ni mentira persistente.
- **Multi-tenant/offline**: sin hardcode de establishment_id (todo de contexto). Crear/editar rodeo es
  online (R9.2, como crear campo) — sin cambios. Voseo respetado en copy nuevo.

## Verificación (T6)

- `node scripts/check.mjs` **VERDE**: client unit **154/154** (146 + 8 a11y), RLS 17/17, Edge 36/36,
  Animal 28/28, Maneuvers 13/13, anti-hardcode **0**, typecheck client OK.
- `pnpm e2e` (build export + Playwright) **16/16 VERDE**: auth 4, establishments 2, invitations 1,
  profile 3, account 3, **rodeos 3** (BUG 2 toggle, BUG 1 home limpia, config destildada persiste).
- Verificación adicional contra el **DEV server** (oráculo del bug): toggle flippea + 0 warnings; home
  con estado real y CTAs vivos. (Diags temporales removidos.)

## Estado: LISTO PARA REVIEWER (no marco done — espera reviewer + Gate 2)
