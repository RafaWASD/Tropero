# impl 10 — UI-A iteración 2: home polish (íconos + hide-stepper) + re-captura

baseline_commit: 7840b43337391fda7bf665a308b634fe530d1774

> Punto desde el cual Gate 2 calcula el diff (trabajamos sobre `main`, sin feature-branches).
> Mismo baseline que `impl_10-ui-a-nav-grupo.md` (esta iteración es polish sobre la misma Fase 4 UI,
> aún sin commitear). NO sobreescribir (feature multi-sesión).

## Alcance (SOLO esto)

Dos cambios de frontend puro pedidos por Raf sobre la home + consistencia de íconos, + re-captura para
el design-review del leader. NADA más (sin schema/RLS/services/lógica de negocio).

1. **Cambio 1 — unificar íconos rodeo/lote** a la convención canónica del repo: **rodeo = `Boxes`
   (cubos), lote = `Layers` (pila)**. Había 2 lugares al revés.
2. **Cambio 2 — ocultar el wizard de "primeros pasos"** cuando los 3 pasos están confirmados done.
3. **Re-captura** de `design/spec10-ui-a/`: `inicio-onboardeado.png`, `inicio-nuevo.png`, `mas.png`,
   y arreglo del `animalrow-detalle.png` roto (137 B → 12 KB).

## Estado: DONE. Esperando reviewer + Gate 2 + design-review del leader. NO marqué nada done.

---

## Archivos tocados

### Cambio 1 — íconos (rodeo=Boxes / lote=Layers)
- `app/app/(tabs)/mas.tsx` — INVERTIDOS los dos ActionRow: "Rodeos" pasó de `Layers`→`Boxes`, "Lotes"
  de `Boxes`→`Layers`. Import SIN cambios (ambos íconos siguen usándose en el archivo).
- `app/app/animal/[id].tsx` — sección "Lote" (`LoteControl`): `Boxes`→`Layers` en los 2 usos
  (DetailSection icon + el trigger del selector). Import: saqué `Boxes` (ya no se usa en el archivo),
  agregué `Layers`.
- `app/src/components/GroupSummaryCard.tsx` — REFORCÉ la nota de convención en el doc-comment del prop
  `icon` (de una frase a "CONVENCIÓN CANÓNICA del repo: Boxes para rodeo, Layers para lote… No invertir").
  (Este archivo es de la Fase 4 en curso, untracked; lo edité solo en su doc-comment.)
- NO toqué los que ya estaban bien: `index.tsx`, `rodeo/[id].tsx`, `lote/[id].tsx`, `lotes.tsx`,
  `rodeos.tsx`. La nota gemela en `GroupViewScreen.tsx` ya era correcta → la dejé.

### Cambio 2 — ocultar el stepper cuando el onboarding está completo
- `app/src/utils/onboarding.ts` — **NUEVO**, lógica PURA (sin I/O, sin RN/expo): `allOnboardingStepsDone(
  { rodeoDone, hasAnimals, teamStarted })` → `rodeoDone && hasAnimals === true && teamStarted`. Criterio
  CONSERVADOR (anti-parpadeo): `hasAnimals === null` ("todavía no sabemos") NO cuenta como hecho.
- `app/src/utils/onboarding.test.ts` — **NUEVO**, 6 tests node:test (los 3 done→true; null→false;
  false→false; falta equipo→false; falta rodeo→false; nada hecho→false).
- `app/app/(tabs)/index.tsx` — 3 hunks MÍOS (el resto del diff vs HEAD es de la Fase 4 ya presente en
  el working tree, NO de esta iteración): (a) import de `allOnboardingStepsDone`; (b)
  `const allStepsDone = allOnboardingStepsDone({ rodeoDone, hasAnimals, teamStarted })`; (c) el bloque
  del `<Stepper>` envuelto en `{allStepsDone ? null : (<YStack…><Stepper/></YStack>)}`.
- `scripts/run-tests.mjs` — enganché `app/src/utils/onboarding.test.ts` en la suite client unit (junto
  a `management-group.test.ts`).

### Re-captura
- `app/e2e/captures/spec10-screenshots.capture.ts` — MODIFICADO: el test rico ahora siembra también 1
  OTRO miembro (vet) → los 3 pasos quedan done → captura `inicio-onboardeado.png` (con oráculo de que el
  wizard NO se renderiza) + `mas.png` (íconos unificados, asertados por a11y label único). Arreglado el
  `animalrow-detalle.png` (clip clampeado al viewport + altura mínima + scrollIntoView → ya no degenera a
  137 B). Nuevo 2do test: campo NUEVO (rodeo, sin animales ni equipo) → `inicio-nuevo.png` (con oráculo de
  que el wizard SÍ se muestra). Borré `design/spec10-ui-a/inicio.png` (quedó huérfano/stale — ya no se
  genera, lo reemplaza `inicio-onboardeado.png`).

### NO tocados por mí (aparecen en `git status` por la Fase 4 en curso, no por esta iteración)
`app/app/_layout.tsx` (rutas de grupo), `app/tsconfig.json` (exclude de la capture config), y el resto de
los `??`/`M` de spec 10 Fase 4. Mi diff es disjunto de esos salvo `index.tsx` (compartido, hunks no
adyacentes) y `GroupSummaryCard.tsx` (solo su doc-comment).

---

## Grep final de íconos (cero al revés)

`grep -rn "Boxes|Layers" app/ --include=*.tsx --include=*.ts` (sin imports):

**Boxes (todos rodeo):** `index.tsx:664` (Mis rodeos), `mas.tsx:840` (fila Rodeos), `rodeo/[id].tsx:80`
(vista grupo rodeo), `rodeos.tsx:230` (lista rodeos).
**Layers (todos lote):** `index.tsx:686` (Lotes), `mas.tsx:851` (fila Lotes), `animal/[id].tsx:926,964`
(sección Lote), `lote/[id].tsx:88` (vista grupo lote), `lotes.tsx:385` (lista lotes).

→ **CERO `Layers` para rodeo, CERO `Boxes` para lote.** Convención canónica unificada. Validado además
visualmente en los shots (mas.png: Rodeos=cubos, Lotes=pila).

---

## Comando de captura + imágenes generadas

Build del bundle web (necesario porque cambié `index.tsx`/`mas.tsx`, las pantallas capturadas):
```
cd app && pnpm.cmd run e2e:build
```
Captura (harness E2E, viewport mobile 412×915):
```
cd app && pnpm.cmd exec playwright test e2e/captures/spec10-screenshots.capture.ts --config playwright.capture.config.ts
```
Resultado: **2 passed**. (El `Assertion failed: !(handle->flags…)` / exit 127 al final es un crash
BENIGNO de libuv al cerrar Node en Windows — ocurre DESPUÉS de "2 passed"; no afecta tests ni imágenes.)

Imágenes en `C:\DEV\RAFAQ\app-ganado\design\spec10-ui-a\` (todas > 1 KB):
- `inicio-onboardeado.png` — 60 825 B — stepper OCULTO, cards rodeo (cubos) + lote (pila) visibles. ✅ verificado visual.
- `inicio-nuevo.png` — 81 051 B — stepper VISIBLE (rodeo tildado, animal+equipo pendientes). ✅ verificado visual.
- `mas.png` — 58 561 B — Rodeos=cubos / Lotes=pila. ✅ verificado visual.
- `animalrow-detalle.png` — 12 151 B — arreglado (antes 137 B), muestra 2 filas + badge "★ Futuro torito". ✅
- `vista-grupo-rodeo.png` — 64 761 B — regenerada.
- `vista-grupo-lote.png` — 50 938 B — regenerada.
- (`inicio.png` viejo BORRADO — stale.)

---

## Verificación

- `cd app && pnpm.cmd typecheck` → **exit 0** (verde).
- `node scripts/check.mjs` → **exit 0** (typecheck + 199 client unit incluyendo onboarding 6/6 + suite
  operaciones-rodeo 22/22 + RLS/edge).
- `onboarding.test.ts` aislado → **6/6 pass**.

## Tests tocados

- **NUEVO**: `app/src/utils/onboarding.test.ts` (6 tests de la lógica pura `allOnboardingStepsDone`).
- **E2E de regresión: NINGUNO tocado.** Triage hecho (autorrevisión, abajo): ningún `*.spec.ts` siembra
  los 3 pasos completos a la vez, así que **ninguno asume el stepper visible tras onboarding completo** →
  ninguno se rompe con el hide-when-complete. Detalle:
  - `animals.spec.ts` test A: rodeo + 1 animal, SIN equipo → `allStepsDone=false` → stepper visible →
    sus asserts ("Cargaste tu primer animal") siguen pasando.
  - `animals.spec.ts` fix-loop 4 (2do miembro): rodeo + equipo, SIN animales → `hasAnimals===false` →
    stepper visible → sus asserts ("Tu equipo está en marcha") siguen pasando.
  - `rodeos.spec.ts`: solo rodeo (0 animales, 0 equipo) → stepper visible → "Gestionar rodeos"/"Ir a
    Animales" siguen pasando.
- **Captura** (`*.capture.ts`, NO regresión): modificada (ver arriba).

---

## Autorrevisión adversarial (antes de reportar)

Qué busqué / qué encontré / cómo lo cerré:

1. **¿Quedó algún ícono al revés?** Grep final de toda `app/` → cero `Layers`-rodeo / cero `Boxes`-lote.
   Validado también por los 3 shots (mas/inicio-onboardeado: cubos en rodeo, pila en lote).
2. **¿El import de `animal/[id].tsx` quedó con `Boxes` muerto?** Verifiqué con grep: `Boxes` no se usa en
   ningún otro lado del archivo → lo saqué del import (typecheck verde confirma que no quedó dangling).
3. **Anti-parpadeo del stepper (el edge case crítico):** un usuario ya-onboardeado NO debe ver un flash
   del stepper, PERO un usuario nuevo TAMPOCO debe ver el stepper desaparecer antes de saber si cargó
   animales. La trampa sería ocultar con `hasAnimals` falsy (que incluye `null`). Usé `hasAnimals === true`
   explícito → con `null` (cargando) NO oculto (stepper visible). Testeado como caso dedicado. `teamStarted`
   ya viene conservador (su `null` interno → false). `rodeoDone` siempre true en la home.
4. **¿Test que pasa por la razón equivocada?** El test `null→false` ejerce el path real del anti-parpadeo
   (no un mock trivial); los 5 negativos verifican que CADA paso faltante mantiene el stepper, no solo el
   caso global.
5. **¿La captura miente?** Verifiqué las 3 imágenes clave VISUALMENTE (no pasamanos del shot):
   inicio-onboardeado SÍ tiene el espacio sin wizard + cards; inicio-nuevo SÍ tiene el wizard con el paso
   de rodeo tildado; mas SÍ tiene cubos en Rodeos y pila en Lotes. Además puse ORÁCULOS en el script
   (toHaveCount(0) de los títulos del wizard en el onboardeado; toBeVisible del wizard en el nuevo) → la
   captura falla si el comportamiento se rompe, no genera un PNG mentiroso.
6. **Strict-mode del oráculo de "Más":** la 1ra corrida falló porque `getByText('Lotes')` matcheaba 2
   nodos (label + ActionRow). Lo cerré usando `getByRole('button', { name: <a11y label único> })`. La app
   NO cambió → no rebuildeé el dist para la 2da corrida.
7. **Mezcla de diffs:** confirmé que el grueso del `git diff index.tsx` vs HEAD es de la Fase 4 ya presente
   en el working tree (cards, loadGroups), NO de esta iteración — mis hunks son solo los 3 del stepper.
   `_layout.tsx`/`tsconfig.json` modificados NO son míos (Fase 4). Lo documenté arriba para que el reviewer
   y el Gate 2 no me atribuyan ese código.

## Reconciliación de specs

NO aplica reconciliación de `requirements.md`/`design.md` de spec 10 en esta iteración: estos 2 cambios
son polish de UI que NO contradicen ni cambian el contrato/comportamiento specceado de spec 10 (las cards,
la vista de grupo, las operaciones masivas quedan idénticas). El hide-when-complete del wizard de
"primeros pasos" es comportamiento de la home (spec 01, onboarding) — un refinamiento de presentación, no
un cambio de requisito EARS. La convención de íconos rodeo=Boxes/lote=Layers quedó documentada en el código
canónico (`GroupSummaryCard.tsx`). Si el leader quiere dejar registro del hide-stepper en spec 01, es
decisión suya en el design-review; no fabriqué un EARS nuevo por una decisión de UI menor.
