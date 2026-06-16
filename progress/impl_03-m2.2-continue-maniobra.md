baseline_commit: edac67034a027d9baf7c7adc593a555e8b3137e4

# impl — M2.2-continue-maniobra (alta desde la manga → continúa la carga de la maniobra)

Feature: `03-modo-maniobras` (in_progress). Tarea acotada de FLUJO/navegación, frontend puro
(sin backend, sin migraciones, sin schema). Cierra el TODO de R4.1 anotado en `onDarDeAlta`:
"M2.2 puede encadenar el retorno directo a la carga; por ahora el alta es el destino".

## Bug / contexto (reportado por Raf, `pnpm web`)
En MODO MANIOBRAS, caravana desconocida → hero "Animal nuevo" → "Dar de alta" →
`/crear-animal` → wizard → al crear, happy-path `router.replace('/animal/[id]')` → **dead-end
de la jornada**: el operario queda en la ficha sin forma de volver a cargar la maniobra; al ir
para atrás cae en la pantalla "Animal nuevo" stale del stack. NO es bug de conexión
(`createAnimal` es offline-first, el animal se crea optimista). Es puramente navegación/flujo.

**Pedido**: cuando el scan/alta es DESDE modo maniobras, al dar de alta continuar con la carga
de la maniobra de ese animal (→ `/maniobra/carga`), no la ficha.

## Plan (tasks)
- **T1** — `identificar.tsx`: pasar `sessionId` al alta en los DOS handlers que dan de alta
  (`onDarDeAlta` outcome unknown; `onCreateFromPicker` outcome ambiguous → "dar de alta").
  Guard: solo si `sessionId` existe. Actualizar el comentario del TODO de `onDarDeAlta`.
- **T2** — `crear-animal.tsx`: leer `sessionId` de params (`maneuverSessionId`). Si presente =
  "alta desde modo maniobras". Happy-path → `router.replace('/maniobra/carga', {sessionId, profileId})`
  (no la ficha). Soft-fail → CTA "Continuar con la maniobra" + rutea a `/maniobra/carga`. Early-return
  de `onSubmit` cuando `createdProfileId` ya seteado → también rutea a carga en contexto maniobra.
  Label del CTA adaptativo. Sin sessionId → todo igual que hoy (ficha) — sin regresión.
- **T3** — Verificar el loop limpio (alta → carga del nuevo animal → confirmar → identify fresco).
- **T4** — e2e: caravana desconocida en maniobras → alta → wizard → "Crear animal" → assert navega a
  `/maniobra/carga` con el profileId. Regresión: alta SIN sessionId → `/animal/[id]`.
- **T5** — check.mjs + e2e relevantes + autorrevisión + reconciliación de specs.

## Baseline check
`node scripts/check.mjs` baseline: typecheck + anti-hardcode + client unit PASAN; el backend rojo
es SOLO `animals_tag_unique` (23505 duplicate key) = flake conocido de terminales paralelas (seed
collision), NO regresión. Esta tarea es frontend puro.

## As-built (resumen de cambios)
- **`app/app/maniobra/identificar.tsx`** — `onDarDeAlta` (unknown) y `onCreateFromPicker` (ambiguous
  → "dar de alta") pasan `sessionId` a `/crear-animal` (guard: `sessionId ? {...prefilled, sessionId}
  : prefilled`). Aplica a manual Y BLE. Comentario del TODO de `onDarDeAlta` actualizado (ahora encadena
  la carga). Deps de los dos callbacks: agregado `sessionId`. NO toqué el exit-hero (ExitJornadaSheet/
  ConnectHero/ManualPromptHero) ni ningún otro handler.
- **`app/app/crear-animal.tsx`** — `params` type + `maneuverSessionId = typeof params.sessionId ===
  'string' ? params.sessionId : ''`. Happy-path: con `maneuverSessionId` → `router.replace('/maniobra/
  carga', {sessionId, profileId})`; sin él → `/animal/[id]` (igual que hoy). Soft-fail: mensaje suave
  adaptado + CTA "Continuar con la maniobra" + rutea a carga (vía el early-return de `createdProfileId`).
  Early-return de `onSubmit` (createdProfileId seteado): rutea a carga en contexto maniobra. Label del
  CTA adaptativo. `maneuverSessionId` agregado a las deps de `onSubmit`.
- **`app/e2e/maniobra-identify.spec.ts`** — helper `walkCrearAnimalWizard` + tests (n) [alta desde la
  manga → carga del nuevo animal] y (o) [regresión: alta sin sessionId → ficha]. Import de
  `waitForServerAnimalProfile`.

## Trazabilidad R → test
- **R4.1** (cierra el TODO M2.1-core: "al confirmar deberá continuar el wizard de maniobras para ese
  animal"):
  - `app/e2e/maniobra-identify.spec.ts` (n) — desconocido en maniobras → "Dar de alta" → wizard →
    "Crear animal" → asserta `/maniobra/carga` (display de peso + "· 1 de 1" + keypad, marcadores
    exclusivos de la carga) + NEGATIVA de los marcadores de la ficha (Historial / Dar de baja).
  - `app/e2e/maniobra-identify.spec.ts` (o) — REGRESIÓN: alta sin sessionId (lista) → ficha `/animal/[id]`
    (Identificación / Historial / Dar de baja) + NEGATIVA de la carga + `waitForServerAnimalProfile`.
  - El path `ambiguous → "dar de alta"` comparte el mismo `crear-animal.tsx` (routing idéntico,
    verificado por código) + el picker ya se ejercita en (f).
  - El alta normal sigue verde en `app/e2e/animals.spec.ts` (14/14, no regresión de `crear-animal.tsx`).

## Autorrevisión adversarial (paso 8)
Busqué activamente como revisor hostil:
- **(a) Desviación del spec**: el EARS R4.1 YA pedía "al confirmar deberá continuar el wizard de
  maniobras para ese animal" — M2.1-core lo había diferido a M2.2. Esta tarea lo cumple sin cambiar el
  *qué*. ✅ cerrado.
- **(b) Edge: `sessionId` como array** (expo-router puede devolver `string[]`). Usé `typeof === 'string'`
  (consistente con `prefilledTag/idv/visual` del mismo archivo); un array cae a `''` → ficha = fail-SEGURO
  (no introduce dead-end, solo no encadena en el caso patológico que `identificar.tsx` nunca produce —
  pasa el param una sola vez). Aceptado.
- **(c) Offline-first**: el animal se crea optimista por la outbox (`createAnimal` → local insert) y la
  carga lee LOCAL (`fetchAnimalDetail` → `runLocalQuerySingle`, SQLite) → el animal recién creado es
  inmediatamente legible sin red. El frame de carga ya tiene spinner + timeout de gating. Verificado por
  código + empíricamente (test n aterriza con identidad/rodeo/categoría/Pesaje del nuevo animal). ✅
- **(d) Soft-fail en contexto maniobra**: el animal existe → hay que poder continuar; el early-return de
  `createdProfileId` + el label + el mensaje usan la MISMA condición `maneuverSessionId` → consistentes
  (ninguna rama rutea a ficha con sessionId presente). Difícil de e2e (requiere fallo de evento post-create
  con createAnimal OK) → verificado por inspección de las 3 ramas.
- **(e) Tests que pasan por la razón equivocada**: la 1ra corrida CAZÓ que el header de la carga TRUNCA
  el visual largo (`numberOfLines`) → `getByText(visualLargo, exact)` no matcheaba aunque la navegación
  SÍ era correcta (el YAML dump probó `/maniobra/carga` con el keypad). Arreglé: visual CORTO + asserts
  sobre marcadores EXCLUSIVOS de cada destino (carga: "· 1 de 1"/weight-display; ficha: Historial/Dar de
  baja) + NEGATIVAS cruzadas → cada test ejerce el path real y verifica el destino correcto Y el rechazo
  del incorrecto. Sin esto, un test podría pasar sin distinguir carga de ficha.
- **(f) No-regresión del camino BLE / exit-hero**: NO toqué ningún componente del exit-hero ni el camino
  BLE; la suite completa maniobra-identify 15/15 (incl. a-m previos) verde.
Resultado: el único hallazgo (e) lo cerré y re-verifiqué. No quedan gaps abiertos.

## Verificación
- `tsc --noEmit` (client + e2e): OK.
- `check.mjs`: anti-hardcode 0 violaciones, typecheck OK, client unit verde (exit 0 en la corrida limpia;
  el rojo de baseline era el flake `animals_tag_unique` de terminales paralelas, no reapareció).
- e2e `maniobra-identify.spec.ts`: **15/15** (a-o, incl. los nuevos n,o).
- e2e `animals.spec.ts`: **14/14** (regresión del alta normal por `crear-animal.tsx`, sin cambios).

## Reconciliación de specs
- `design.md` §6.bis.9 NUEVA (as-built del encadenado alta→carga: identificar pasa sessionId, crear-animal
  rutea a /maniobra/carga, loop limpio verificado, no-regresión del alta normal).
- `requirements.md` R4.1: nota de reconciliación NUEVA que CIERRA el TODO de M2.1-core (sin reescribir el
  EARS — el EARS ya pedía el encadenado).
- `tasks.md`: task `[x] M2.2-continue-maniobra` agregada (satisface R4.1, archivos, aceptación, tests).
- `progress/current.md`: registro de la sesión.

## Notas de stack
Tras crear en contexto maniobra y navegar a `/maniobra/carga`, la pantalla `identificar(unknown)` queda
montada abajo en el stack pero es **inalcanzable en la práctica** (el back ya NO popea — abre el
`ExitJornadaSheet`, §6.bis.8). El loop (alta → carga del nuevo animal → confirmar → `onConfirmAnimal`
`router.replace('/maniobra/identificar', {sessionId})` = identify fresco) funciona. NO forcé gimnasia de
stack para limpiar el screen stale: sería riesgosa (manipular el stack del modal de maniobra) y es
innecesaria (inalcanzable con el back→sheet). Dejado como nota, sin cambio.

NO marco `done` — lo decide el reviewer.
