baseline_commit: f41749ea8ca9555dad711a89db7c9aec383fcadf

# impl — Bug B: aplicabilidad de tactos (servida vs vaquillona-no-apta)

Delta-fix ADR-028, Nivel A (frontend puro). Gate 1 N/A. Bug B del triage
`docs/correcciones-demo-facundo-padre-2026-07-10.md`.

## Bug
En MODO MANIOBRA, una maniobra con `tacto` (preñez) Y `tacto_vaquillona` (aptitud): una TERNERA pasaba por
AMBOS, y cualquier hembra pasaba por ambos. Causa raíz: `maneuver-applicability.ts` `case 'tacto'` /
`case 'tacto_vaquillona'` devolvían solo `animal.sex === 'female'`, sin distinguir servida vs vaquillona-no-apta.

## Nota de coordinación (parallel implementers)
El brief avisa que hay OTRO implementer que podría tocar `carga.tsx`. Para ser collision-safe:
- toqué en `carga.tsx` SOLO `toApplicabilityInfo` (~1088-1098) + su comentario, nada más.
- NO edité `progress/current.md` (archivo de coordinación compartido, lo maneja el leader).
- NO hice `git add`/commit.

## Plan
- T1: enriquecer `AnimalApplicabilityInfo` con `reproStatus` (opcional) + importar `ReproStatus` /
  `PROVEN_FEMALE_CATEGORY_CODES` de repro-status.ts (fuente única).
- T2: separar el switch de `appliesToAnimal` (`tacto` = servida; `tacto_vaquillona` = vaquillona-no-apta) con
  helpers puros que encapsulan la precedencia de `reproStatus`.
- T3: pasar `reproStatus` desde `toApplicabilityInfo(animal)` en `carga.tsx`.
- T4: reescribir los tests falsos (85-107) + los de integración (228-233) al comportamiento correcto + edge cases.
- T5: verificación (typecheck + suite unit maneuver-applicability), autorrevisión, reconciliación spec 03.

Todas [x]. Verificación: `tsc --noEmit` verde (exit 0); `maneuver-applicability.test.ts` 51/51 pass.
NO se corrió `node scripts/check.mjs` completo (evitar contención de DB con implementers en paralelo, por brief).

## Lógica final de cada tacto (maneuver-applicability.ts)

`case 'tacto'` (PREÑEZ):
```
sex === 'female' && (PROVEN_FEMALE_CATEGORY_CODES.has(categoryCode ?? '') || isServedReproStatus(reproStatus))
isServedReproStatus(s) = s !== undefined && s.kind ∈ {served_untested, pregnant, empty}
```
→ hembra SERVIDA = categoría probada (fuente única de repro-status.ts) o evidencia de servicio/tacto previo.

`case 'tacto_vaquillona'` (APTITUD):
```
sex === 'female' && categoryCode === 'vaquillona' && needsFitnessEvaluation(reproStatus)
needsFitnessEvaluation(s) = s === undefined ? false : s.kind === 'unknown' ? true : (s.kind === 'fitness' && s.fitness !== 'apta')
```
→ vaquillona AÚN NO apta = sin evaluar (unknown) o veredicto no_apta/diferida (fitness≠apta). `reproStatus` es la
fuente única (encapsula la precedencia RAR.2.4): una vaquillona ya SERVIDA resuelve a `served_untested` (precedencia
> fitness) y por eso queda EXCLUIDA del tacto de aptitud — más correcto que gatear por `reproAptitude` suelto (una
servida con veredicto null se colaría). Por eso NO usé `reproAptitude !== 'apta'` a secas.

## Matriz de comportamiento (autorrevisión adversarial, paso 8)

| animal | reproStatus | tacto (preñez) | tacto_vaquillona (aptitud) |
|---|---|---|---|
| ternera | none | ✗ | ✗ |  ← el bug reportado (pasaba por ambos), ahora NINGUNO
| vaquillona sin evaluar | unknown | ✗ | ✓ |  solo aptitud
| vaquillona no_apta/diferida | fitness≠apta | ✗ | ✓ |  solo aptitud
| vaquillona apta SIN servicio | fitness=apta | ✗ | ✗ |  ninguno (espera servicio)
| vaquillona servida | served_untested | ✓ | ✗ |  solo preñez
| vaca probada (multipara/etc) | served_untested | ✓ | ✗ |  solo preñez
| vaca preñada | pregnant | ✓ | ✗ |  solo preñez
| vaca vacía | empty | ✓ | ✗ |  solo preñez
| vaca probada + CUT | cut | ✓ (vía PROVEN) | ✗ |  tactable antes de venderla
| macho / sexo null | * | ✗ | ✗ |  ninguno (un toro no se tacta / fail-safe)
| sin reproStatus (fail-safe) | undefined | ✓ solo si PROVEN | ✗ |

Todos verificados mentalmente Y con test. NADA de tests que pasen por la razón equivocada: el test "sin
reproStatus fail-safe" ejercita el path real (HEIFER sin dato → ambos ✗; MULTIPARA sin dato → tacto ✓ por categoría).

Edge cazado y aceptado (matchea el spec del brief): una **vaquillona SERVIDA-y-luego-CUT** (no probada) resuelve a
`reproStatus.kind='cut'` (precedencia is_cut > served) y categoría no-probada → tacto de preñez ✗. Es un estado
contradictorio raro; la regla del brief define el set servida como {PROVEN ∨ served_untested/pregnant/empty}, 'cut'
NO está incluido a propósito. Las CUT probadas (el caso común de "vieja de descarte") sí quedan tactables por la
cláusula PROVEN. Consistente con el spec; no lo "arreglé" fuera de scope.

## Trazabilidad R<n> → test (maneuver-applicability.test.ts)

- **R6.2** (tacto de preñez = solo hembras SERVIDAS) →
  - "R6.2 (bug B): tacto de preñez APLICA a hembras SERVIDAS (servida sin tacto / preñada / vacía / probada)"
  - "R6.2 (bug B): tacto de preñez NO aplica a NO-servidas (ternera / vaquillona sin evaluar / no_apta / apta sin servicio)"
  - integración: "secuencia (bug B): una VACA servida → tacto de preñez (sí), aptitud NO … raspado se salta"
- **R6.3** (tacto de aptitud = solo vaquillonas AÚN NO aptas) →
  - "R6.3 (bug B): tacto de aptitud APLICA a vaquillonas AÚN NO aptas (sin evaluar / no_apta / diferida)"
  - "R6.3 (bug B): tacto de aptitud NO aplica a vaquillona ya apta, ni a servida/preñada, ni a ternera/vaca"
  - integración: "secuencia (bug B): una VAQUILLONA no-apta → tacto de aptitud (sí), preñez NO … raspado se salta"
- **Bug reproducido** (ternera por ambos) → "R6.2/R6.3 (bug B): una TERNERA NO pasa por NINGÚN tacto (el bug reportado)"
  + "filterByAnimalApplicability saca AMBOS tactos de una TERNERA".
- Casos borde: SOLO-preñez (vaquillona servida), SOLO-aptitud (vaquillona no_apta), NINGUNO (vaquillona apta sin
  servicio), macho, sexo desconocido, fail-safe sin reproStatus → tests homónimos "R6.2/R6.3 (bug B): …".

## Tests reescritos

- `maneuver-applicability.test.ts` sección "R6.2/R6.3": los 4 tests FALSOS viejos (codificaban "ambos tactos =
  cualquier hembra") reemplazados por 13 tests del comportamiento correcto + fixtures con `reproStatus`.
- Integración: "secuencia: una HEMBRA → tactos según rodeo (sí)" (falso: esperaba ambos tactos) → dividido en 2
  (VACA servida → solo preñez; VAQUILLONA no-apta → solo aptitud). El test de MACHO (ambos se saltan) quedó igual
  (seguía correcto). Header del archivo + comentario de sección actualizados.

## Reconciliación de specs (paso 9)

- `design.md` §6.bis: marqué el bullet v2 "tacto → solo HEMBRAS" como REFINADO y agregué el bloque "as-built v3
  (bug B)" con la lógica final de cada tacto + la matriz + el hueco server-side.
- `requirements.md` R6.2/R6.3: agregué "Reconciliación as-built v3 (bug B)" bajo la nota v1, refinando "solo hembras".
- (`tasks.md` de spec 03 no lista este delta-fix como task; es un delta ADR-028 sobre feature done — la traza queda
  en las notas de reconciliación de requirements/design, patrón de los deltas previos.)

## Hueco server-side (para BACKLOG — NO tocado, por scope)

El gate de tactos es de CLIENTE (qué maniobras ofrecer). El trigger de gating capa 2 `tg_*_events_gating` (`0054`)
NO valida el sexo/categoría/estado-reproductivo del animal contra el evento reproductivo: hoy el server ACEPTARÍA un
`reproductive_events` (`event_type='tacto'`) sobre una ternera, o un `tacto_vaquillona` sobre una vaca preñada, si un
cliente malicioso/buggeado lo mandara. Es el MISMO hueco pre-existente que ya tenían `tacto`/`tacto_vaquillona`/
`raspado` por sexo (el gating `0054` gatea por rodeo/data_key, no por atributos del animal). Defensa server-side por
atributos = ítem de backlog (fuera del scope de este delta frontend puro).
