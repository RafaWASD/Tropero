baseline_commit: 638679fa61672e884fc75b3ae94a855bf9853642

# impl — spec 03 (MODO MANIOBRAS) — chunk M3.2b (pantallas de paso restantes)

> Frontend puro sobre M3.1 (orquestador done) + M3.2a + backend done (`0091` aplicada). Gate 1 N/A.
> Las pantallas de paso de las maniobras restantes: **sanitarias silent_apply** (vacunación / antiparasitario / antibiótico), **sangrado** (1 tubo), **raspado** (2 tubos), **pesaje de ternero**. Con esto quedan renderizables **las 12 maniobras**.
> **NO marco done** — espera reviewer + Gate 2.

## Estado: DONE (técnico) — check.mjs RC=0. NO marco done (espera reviewer + Gate 2).

Feature 03 `in_progress`, spec aprobado (Puerta 1). Construí SOLO los renderers que faltaban + su cableado al `switch` del dispatcher de `carga.tsx` (el SEAM de M3.1). NO reimplemento el write-path (M3.1 ya lo tiene: `persistManeuverEvent` con StepValue `sanitary`/`vaccination`/`lab`/`lab_double`/`pesaje`).

## baseline Gate 2
`638679fa61672e884fc75b3ae94a855bf9853642` (= baseline de M3.1/M3.2a; NO se sobreescribe — feature multi-sesión, SHA previo a la 1ra task de la feature 03 cliente reciente).

## Plan — todas cerradas

- [x] T1 — `SilentSanitaryStep.tsx` (silent_apply de UN producto: antiparasitario/antibiótico) + `SilentVaccinationStep.tsx` (multi-vacuna).
- [x] T2 — `LabSampleStep.tsx` (sangrado, 1 tubo) + `LabDoubleStep.tsx` (raspado, 2 tubos).
- [x] T3 — pesaje ternero (reusa PesajeStep, ya cae en `case 'pesaje'`; header muestra la categoría ternera).
- [x] T4 — cableé los `case` (silent_single/silent_multi/lab_single/lab_double) + `eventIds` (UUIDs válidos) para multi-write + soft-delete de huérfanos de la corrección de vacunación. **FIX (autorrevisión): el frame no aplicaba `filterByAnimalApplicability` (R6.12 raspado solo machos) → lo cerré.**
- [x] T5 — tests (unit `maneuver-config.test.ts` preconfig helpers; e2e `maniobra-sanitaria.spec.ts` 3/3) + 5 capturas 412×915.
- [x] T6 — check.mjs RC=0; autorrevisión; reconciliación design §6.bis.4/tasks M3.2b `[x]`/M3.2c; mapas.

## Archivos tocados
**Nuevos:**
- `app/app/maniobra/_components/SilentSanitaryStep.tsx` — silent_apply de UN producto (antiparasitario/antibiótico). Hero del producto preconfig + "Aplicar y seguir"; sin producto → input + autocompletar.
- `app/app/maniobra/_components/SilentVaccinationStep.tsx` — silent_apply MULTI (vacunación, N vacunas → chips).
- `app/app/maniobra/_components/LabSampleStep.tsx` — sangrado (1 nº de tubo, input de texto).
- `app/app/maniobra/_components/LabDoubleStep.tsx` — raspado (2 nº de tubo, ambos visibles etiquetados).
- `app/e2e/maniobra-sanitaria.spec.ts` — e2e de las 5 maniobras + hembra-salta-raspado + pesaje ternero.

**Modificados:**
- `app/app/maniobra/carga.tsx` — dispatcher: 4 `case` nuevos (silent_single/silent_multi/lab_single/lab_double) + prop `config` al `ManeuverStep` (preconfig) + **FIX R6.12** (la secuencia aplica `filterByAnimalApplicability`) + `eventIds` multi-write (UUIDs estables) + soft-delete de huérfanos al corregir vacunación.
- `app/src/utils/maneuver-config.ts` — helpers PUROS nuevos `preconfigStringFor` + `preconfigHistory` + tipo `preconfig` en `ManeuverConfig`.
- `app/src/utils/maneuver-config.test.ts` — 8 tests nuevos de los 2 helpers.
- `app/src/services/maneuver-events.ts` — `softDeleteManeuverEvents` (retira filas huérfanas de la corrección multi-write).
- `app/tamagui.config.ts` — token `$tubeText`=24 (número de tubo grande). JIT provisional.
- `app/e2e/helpers/admin.ts` — oráculos server `waitForServerSanitaryWithSession` / `waitForServerLabSampleWithSession` / `countScrapeSamples`.
- Specs reconciliadas: `tasks.md` (M3.2b `[x]` as-built + split M3.2c deferido), `design.md` (§6.bis.4 as-built).

## Mapa StepKind → componente → write-path (M3.1, ya existente — M3.2b solo CAPTURA el valor)
| StepKind (dispatcher) | Componente (M3.2b) | StepValue capturado | Persiste (M3.1) |
|---|---|---|---|
| `silent_single` | SilentSanitaryStep | `{kind:'sanitary', eventType, productName}` | 1× `sanitary_events` deworming\|treatment (SIN route, D10) |
| `silent_multi` | SilentVaccinationStep | `{kind:'vaccination', products[]}` | N× `sanitary_events` vaccination |
| `lab_single` | LabSampleStep | `{kind:'lab', tubeNumber}` | 1× `lab_samples` blood |
| `lab_double` | LabDoubleStep | `{kind:'lab_double', tubeTricho, tubeCampylo}` | 2× `lab_samples` scrape_tricho + scrape_campylo |
| `pesaje` (ternero) | PesajeStep (reuso) | `{kind:'pesaje', weightKg}` | 1× `weight_events` |

eventType del silent_single: antiparasitario→`deworming` (R6.13), antibiótico→`treatment` (R6.15) — lo fija la maniobra en el dispatcher, NO el usuario.

## tube_number: TEXTO, no keypad — la decisión
`lab_samples.tube_number` es **`text not null`** (0029, cap `<= 64` por CHECK en 0070). Los códigos de tubo de laboratorio son **alfanuméricos** en la práctica (ej. "A-104", "CEDIVE-23", "TR-1") — un keypad numérico excluiría los códigos con letras/guiones, que el lab SÍ usa. Por eso ambos pasos de lab (sangrado/raspado) usan un **input de texto grande** (`$tubeText`=24, manga-friendly, `autoCapitalize="characters"`), NO el keypad de pesaje. Es **código de máquina → SIN formato es-AR** (memoria `reference_es_ar_number_format`: el es-AR aplica a la UI de números humanos, no a códigos de máquina). El tubo es REQUERIDO (NOT NULL + R5.7 → CTA bloqueado si vacío).

## Qué REUSÉ
- **`PesajeStep`** (M2.2): pesaje de ternero = mismo keypad (ya caía en `case 'pesaje'`; no hubo que tocar nada — la categoría ternera la trae el header del frame por el espejo C6).
- **`filterAutocomplete`** (maneuver-wizard, R1.8): autocompletar "Usadas antes" en silent_single y silent_multi.
- **patrón multi de `ManeuverConfigSheet`** (M1-UI): chips con ×, input + "Agregar", para la vacunación multi (NO importé el sheet — repliqué el patrón inline en la pantalla de paso, que NO es un sheet sino la pantalla completa de la maniobra).
- **`SpikeIdentityHeader`** (M2.0): el header de identidad (lo pone el frame, no los pasos).
- **orquestador M3.1** (`persistManeuverEvent` + `buildManeuverEventQueries`): el write de cada maniobra, incl. el array multi-write (vacunación N / raspado 2).
- **`buildSoftDeleteEventUpdate`** (spec 10): para el soft-delete de los huérfanos de la corrección de vacunación.
- tokens/es-AR/`buttonA11y`/`labelA11y`.

## Mapa test → R
| R | Test(s) |
|---|---|
| R6.1 (vacunación silent multi, N → N sanitary_events) | maniobra-sanitaria e2e macho: 2 vacunas → `waitForServerSanitaryWithSession('vaccination', minCount:2)` con productNames=[Aftosa,Mancha] |
| R6.13/R6.14 (antiparasitario deworming, SIN route, una maniobra) | maniobra-sanitaria e2e macho: → `waitForServerSanitaryWithSession('deworming', {productName:'Ivermectina'})` con session_id; el write SIN route lo prueba el node:sqlite de M3.1 |
| R6.15 (antibiótico treatment) | maniobra-sanitaria e2e macho: → `waitForServerSanitaryWithSession('treatment', {productName:'Oxitetraciclina'})` |
| R6.4 (sangrado blood + tube_number) | maniobra-sanitaria e2e macho: tubo A-104 → `waitForServerLabSampleWithSession('blood', {tubeNumber:'A-104'})` |
| R6.11 (raspado 2 lab_samples scrape_*) | maniobra-sanitaria e2e macho: TR-1/CA-2 → `waitForServerLabSampleWithSession('scrape_tricho'/'scrape_campylo')` con sus tubos |
| R6.12 (raspado solo machos, hembra salta) | maniobra-sanitaria e2e hembra: jornada {raspado, antiparasitario} → · 1 de 1 (raspado NO en secuencia) + `countScrapeSamples`=0 |
| R6.10 (pesaje ternero + categoría) | maniobra-sanitaria e2e ternera: header "· Ternera" + 95 kg → `waitForServerWeightEventWithSession(95)` con session_id |
| R5.7 (required faltante bloquea) | LabSampleStep/LabDoubleStep: CTA `Confirmar` deshabilitado si el/los tubo(s) vacío(s) (canConfirm); vacunación CTA deshabilitado con 0 vacunas |
| R5.9 (corrección no duplica) | maniobra-sanitaria e2e macho: corrige antiparasitario desde el resumen → hero "Ivermectina" → re-confirma (UPDATE, no 2do INSERT) → vuelve al resumen |
| R5.14 (orden de config) | maniobra-sanitaria e2e macho: la secuencia muestra · 1..5 de 5 en el orden de selección (vacunación→antiparasitario→antibiótico→sangrado→raspado) |
| R1.7/R1.8 (preconfig + autocompletar) | maneuver-config.test: preconfigStringFor (string/objeto products/default_pajuela) + preconfigHistory (aplana + dedup); SilentSanitaryStep hero con preconfig (capturable) |
| R5.2/R12.5 (botones gigantes / densidad) | 5 capturas 412×915 (CTA full-width botella; hero del producto; campos de tubo en thumb-zone) |

## Rutas de las capturas (412×915) — `design/maniobra-sanitaria/`
- `sanitaria-silent.png` — **silent_apply CON producto** (hero "Ivermectina" + "Cambiar producto" + "Aplicar y seguir") — antiparasitario corregido desde el resumen (la dirección #1 del leader).
- `vacunacion.png` — silent_apply MULTI (chips Aftosa/Mancha con × + input "Ej.: Aftosa" + "Aplicar y seguir").
- `sangrado.png` — 1 nº de tubo (campo "A-104" grande + "Confirmar").
- `raspado.png` — 2 nº de tubo (Tricomoniasis "TR-1" / Campylobacteriosis "CA-2" + "Confirmar").
- `pesaje-ternero.png` — keypad de pesaje (header "Cría · Ternera", "95 kg" hero).

## Autorrevisión adversarial (paso 8) — qué busqué, qué encontré, cómo lo cerré
- **(a) R cubierto / a medias**: revisé R6.1/R6.4/R6.10/R6.11/R6.13/R6.14/R6.15 + R5.4/5.5/5.7/5.9/5.11/5.14 contra el código + tests. **HALLAZGO GORDO (cerrado)**: el frame NO aplicaba la aplicabilidad per-animal `filterByAnimalApplicability` (R6.12) — la secuencia solo filtraba por el gating del rodeo (R5.5). Un raspado en una jornada NO se saltaba para una hembra (lo escribía igual). M3.1 había construido `appliesToAnimal`/`filterByAnimalApplicability` JUSTO para esto y los dejó "para M3.2 al armar la secuencia" — el frame nunca los enganchó. Cerrado: `sequence` = orden ∩ gating rodeo ∩ aplicabilidad atributos; e2e de la hembra lo verifica server-side (0 scrape_*). R5.6 (required/opcional por rodeo de las de campo) — las sanitarias/lab de M3.2b no tienen "campo opcional faltante" (el producto es libre; el tubo es required por NOT NULL) → no aplica el flag `required` per-rodeo acá; anotado.
- **(b) edge cases / NULL / vacío / límites / orden**:
  - **Vacunación con CERO vacunas**: el orquestador mapea products→events → 0 productos = 0 eventos, PERO el resumen mostraba "Aplicada" (`describeStepValue`) = mentira (no persistió nada). Cerrado: la vacunación deshabilita "Aplicar y seguir" con 0 vacunas (R6.1 escribe 1 fila POR vacuna → no se "aplica cero"). Los silents de UN producto SÍ quedan habilitados con producto vacío (el evento "se aplicó" igual existe — semántica distinta, correcta).
  - **Tubo vacío** (sangrado/raspado): `tube_number` es NOT NULL → un tubo vacío rompería al subir. Cerrado: CTA "Confirmar" deshabilitado si el/los tubo(s) vacío(s) (R5.7). `cleanNote` del orquestador devolvería null → el guard de cliente lo previene antes.
  - **Multi-write ids no-UUID**: el fallback del orquestador (`${eventId}-${i}` / `${eventId}-campylo`) NO es un UUID → 22P02 al subir. Cerrado: el frame genera UUIDs estables adicionales (`extraIdsFor`) para raspado (1 extra) y vacunación (N-1 extras).
  - **Corrección de vacunación con MENOS vacunas** (de 2→1): las filas extra ya escritas no se pisan por el re-INSERT (que solo toca las N nuevas) → quedarían huérfanas en el server. Cerrado: el frame soft-deletea los huérfanos (`softDeleteManeuverEvents`, ids por índice 0=eventId, i≥1=extras[i-1]). El raspado (conteo FIJO=2) no puede dejar huérfanos. Track del conteo previo en `lastWriteCountRef`.
  - **tube_number alfanumérico vs keypad**: verifiqué el tipo (`text not null`, 0029) → input de texto (no keypad), porque los códigos de lab tienen letras/guiones. Cap 64 (input maxLength = CHECK 0070).
- **(c) seguridad / gaps**:
  - **created_by/establishment_id NUNCA en el payload** (los fuerza el trigger 0043); `session_id` del caller (no hardcodeado).
  - **eventType del silent NO viene del usuario**: el dispatcher lo deriva de la maniobra (antiparasitario→deworming, antibiótico→treatment) — el usuario no puede inyectar un event_type arbitrario.
  - **gating capa 2 (0091) + tenant-check (0056) re-validan al subir**: un sanitary_event deworming/treatment sobre un rodeo sin el data_key → rechazado fail-closed server-side (verificado por la suite backend T2.4c, verde). El cliente NO replica la autorización.
  - **soft-delete de huérfanos sin IDOR**: `softDeleteManeuverEvents` solo retira filas que ESTA sesión acaba de escribir (ids estables del frame, derivados de `extraIdsFor`/`eventIdFor`) — nunca filas de otro origen; la RLS UPDATE (`is_owner_of OR created_by = auth.uid()`, 0027) es la barrera real al subir. El guard `deleted_at IS NULL` lo hace idempotente.
  - **tube_number / product_name son texto libre con cap server-side** (tube ≤64 0070; product_name ≤160 — verificado en M3.1 SEC): el input los capea (maxLength) + el CHECK del DB es la barrera. SQL parametrizado (los builders de M3.1 usan `?`).
- **(d) multi-tenant / offline**: todo CRUD-plano local (INSERT sanitary/lab/weight + UPDATE de corrección + soft-delete) → CrudEntry → upload; offline-first (la jornada corre sin red, sube al reconectar — el e2e de M2.2 ya probó el camino offline con session_id; estas reusan el MISMO `persistManeuverEvent`). NUNCA establishment_id hardcodeado (anti-hardcode lint verde). `preconfigStringFor`/`preconfigHistory` son 100% puros (sin I/O).
- **(e) tests que pasan por la razón equivocada**: el e2e verifica SERVER-side con service_role (no solo UI): deworming con product_name='Ivermectina' + session_id NO null; treatment 'Oxitetraciclina'; 2 filas vaccination con productNames=[Aftosa,Mancha]; blood/scrape_* con sus tube_numbers exactos; los 5 con el MISMO session_id (misma jornada). El test de la hembra prueba el REJECT del raspado de DOS formas: (1) la UI nunca muestra el paso de raspado (· 1 de 1, no · 1 de 2), (2) `countScrapeSamples`=0 server-side. El de la ternera prueba la categoría autocompletada (header "· Ternera") + el peso con session. La corrección del antiparasitario prueba el round-trip (hero → re-confirma → resumen) y que el deworming sigue con 'Ivermectina' (UPDATE, no duplicado).

## Reconciliación de specs (paso 9)
- `tasks.md`: la task M3.2b (monolítica) se SPLITEÓ en **M3.2b** (`[x]` as-built — las 4 pantallas nuevas + pesaje ternero + el fix R6.12 + multi-write) + **M3.2c** (`[ ]` el resto: inseminación R6.5 + preview transición R8.4 + lote R9.x + label timeline → DIFERIDO a M4). El `Satisface:` de M3.2b se acotó a lo realmente hecho (sin R6.5/R8.4/R9.x). El detalle del tacto vaca 2-pasos (R6.2) que estaba en el viejo M3.2b ya era de M2.2 (no se re-hizo) — quedó documentado en §6.bis.2.
- `design.md`: nuevo **§6.bis.4** (as-built M3.2b) describiendo las 4 pantallas, la decisión tube_number=texto, el fix de aplicabilidad per-animal en el frame (R6.12), el multi-write con UUIDs estables + soft-delete de huérfanos, los helpers puros nuevos, y los diferidos a M3.2c/M4. La línea "Diferido a M3.2b" de §6.bis.3 se actualizó a "M3.2b/M3.2c". El §6.bis.2 (tacto 2-pasos) y §4 (gating) ya describían el backend — no contradicen.
- `requirements.md`: SIN cambios de *qué* (no se reconcilió ningún EARS — la implementación honra R6.1/R6.4/R6.10/R6.11/R6.13/R6.14/R6.15 tal como están; D10 SIN route ya estaba en R6.14; tube_number=texto no contradice ningún EARS, R6.4/R6.11 dicen "número de tubo" sin imponer keypad).

## Nota de decisiones visuales (para el veto del leader)
- **Silent_apply de UN producto = hero + 1 toque** (dirección #1): con producto preconfig → el producto GRANDE/hero ("Ivermectina" $10) + "Cambiar producto" (editable) + CTA gigante "Aplicar y seguir" botella. SIN producto → input + autocompletar primero. CTA SIEMPRE habilitado (silent: la maniobra se aplicó aunque no se nombre el producto). Captura `sanitaria-silent.png`. **Opinable**: hay aire vertical sobre el hero (el hero está centrado en el flex:1) — manga-claro (una decisión por pantalla), pero si se prefiere más densidad se puede subir el hero.
- **Vacunación multi = chips** (consistente con el preconfig de M1): chips Aftosa/Mancha con × + input + "Agregar" + "Usadas antes". CTA deshabilitado con 0 vacunas (no se "aplica cero"). Captura `vacunacion.png`. **Opinable**: el aire entre los chips y el CTA (contenido top-aligned) — aceptable para una pantalla tipo-form.
- **tube_number = input de texto grande, NO keypad**: la columna es `text` y los códigos de lab son alfanuméricos (A-104/TR-1). Un keypad numérico sería incorrecto (no podrías tipear "A-104"). El número se muestra grande ($tubeText=24) para leerlo al rotular. Sangrado = 1 campo centrado en la thumb-zone; raspado = 2 campos etiquetados (Tricomoniasis/Campylobacteriosis) en la thumb-zone. Capturas `sangrado.png` / `raspado.png`.
- **Pesaje ternero = el MISMO keypad del pesaje** (R6.10): no se rediseñó; la categoría ternera la trae el header (espejo C6, "Cría · Ternera"). Captura `pesaje-ternero.png`.
- **Recorte de descendentes**: verificado en "Sangrado (brucelosis)" (g), "Aplicar y seguir" (g/p), "Tricomoniasis" (no trae descendente pero los Text llevan lineHeight matching por regla), "Antiparasitario" (p) — todos con lineHeight matching, sin recorte en las capturas.

## check.mjs
RC=0 (run limpio): typecheck client + anti-hardcode (0 violaciones en los 4 componentes + el token nuevo) + client unit (incl. maneuver-config 8 nuevos) + RLS/Edge/Animal/Maneuvers/Operaciones-rodeo backend verdes. Sin flake de rate-limit ni spec-12 en este run.

## e2e
- **`maniobra-sanitaria.spec.ts` 3/3** (mi chunk: macho 5 maniobras / hembra raspado-salta / ternera pesaje) — verde y estable (corrido múltiples veces).
- **Regresión: `maniobra-elegir` 2/2** + **`maniobra-carga`** — el fix de aplicabilidad (R6.12) NO rompió las existentes.
- **FLAKE PRE-EXISTENTE (NO regresión de M3.2b)**: `maniobra-carga` test1 ("flujo completo … tacto + pesaje") falló 1 vez en una corrida combinada con `Test timeout` esperando "Confirmar peso" → el `weight-display` del keypad de M2.2 se reseteó a `0` mid-test (el valor tecleado "412" se perdió). Causa: el frame de M2.2 vacía la secuencia transitoriamente cuando `useManeuverGating` re-fetchea (focus/`lastSyncedAt`) → `gating.loading` true momentáneo → `sequence=[]` → el `PesajeStep` se desmonta y pierde el valor tecleado. Es una característica de TIMING del frame de M2.2 (el `gating.loading` ya estaba en el guard antes de M3.2b; mi cambio agregó `animal` a las deps del useMemo pero NO toca ese guard). **Re-corrido AISLADO 2/2 verde** + pasó en la 1ra corrida combinada (8/8) → es intermitente, no determinista. NO lo introdujo M3.2b. Endurecer el keypad contra el desmonte-por-secuencia-vacía-transitoria es robustez del frame M2.2/M4 (fuera de scope de M3.2b; el reviewer de M2.2 ya lockeó ese frame) — anotado para el reviewer.

## NO done
Espera reviewer + Gate 2 (security code) + veto de diseño del leader + OK de Raf. M3.2c (inseminación + preview/lote, diferido a M4) es el siguiente chunk.

---

# FIX-LOOP M3.2b (2026-06-15) — el leader veteó las capturas: cero espacio muerto + inseminación

> Frontend puro (NO toca backend). Reviewer + Gate 2 después. baseline_commit SIN cambios (= `638679fa…`, misma feature multi-sesión).

## Estado: DONE (técnico) — check.mjs RC=0. NO marco done (espera reviewer + Gate 2).

2 cambios del leader:

### CAMBIO 1 — ESPACIO MUERTO (Gate 0 "cero espacio muerto")
Las pantallas no-keypad nuevas (`SilentSanitaryStep`/`SilentVaccinationStep`/`LabSampleStep`/`LabDoubleStep`) tenían ~50-60% de pantalla vacía (contenido flotando arriba/medio, CTA abajo con hueco grande). Fix (patrón **CondicionCorporalStep**, figura-fondo): el contenido pasó a una **CARD DOMINANTE de superficie** (`backgroundColor="$surface"` + borde `$divider`, `flex={1}`) que ocupa el alto disponible → la card ES el bloque dominante; el CTA gigante queda abajo DISJUNTO.
- **SilentSanitaryStep**: hero del producto ($11=64px) + "Cambiar producto" DENTRO de la card → disjunto del CTA "Aplicar y seguir" (sin mis-tap). Hero subido a $11 (era $10). Componente **parametrizado** (noun/questionLabel/changeLabel/emptyHero/inputPlaceholder/ctaLabel) para reusarlo en inseminación.
- **SilentVaccinationStep**: título+chips+input+autocompletar dentro de la card (scroll interno); CTA abajo. Chips/sugerencias/botón-agregar deshabilitado migrados de `$surface`→`$white` (la card ahora es `$surface`).
- **LabSampleStep / LabDoubleStep**: inputs centrados verticalmente en la card dominante (label $5→$6). Pantalla balanceada sin vacío de arriba.

### CAMBIO 2 — INSEMINACIÓN (R6.5)
`InseminacionStep.tsx` (NUEVO) + `case 'inseminacion'` en el dispatcher de `carga.tsx`. **El write-path YA existía en M3.1** (`buildAddManeuverInseminationInsert`/`buildUpdateManeuverInsemination` → `reproductive_events` `event_type='service'`/`service_type='ai'`, pajuela en `notes`; data_key `inseminacion` en `MANEUVER_DATA_KEY_REQS`; StepKind `inseminacion`; StepValue `{kind:'inseminacion', semenName}`) → SOLO faltaba UI + case. R6.5:
- **1 pajuela** preconfig (de la tanda, M1) → confirmar de un toque (reusa `SilentSanitaryStep` con copia de inseminación: "pajuela"/"Cambiar pajuela"/"Aplicar y seguir"). Hero + "Cambiar pajuela" + CTA.
- **>1 pajuela** disponible → SELECTOR: bloques grandes `$primary` (un toque = elige y aplica) + "Otra pajuela" (`$surface`, abre input + autocompletar para una libre).
- Pajuela por texto libre + autocompletar (R1.8, `preconfigHistory`).
- Helper PURO nuevo `pajuelasFor(config)` (`maneuver-config.ts`): lista de pajuelas de la tanda (tolerante: string simple / coma-separado / `{pajuelas:[]}` / `{default_pajuela|pajuela}`; dedup, sin vacíos) → fuente del "1 vs >1". `preconfigHistory` enriquecido con pajuelas multi.

## Decisión de divergencia R6.5 (reconciliada en requirements)
El EARS dice "1 pajuela → popup informativo". El leader dirigió "confirmar de un toque". Implementé el hero + 1 toque (un popup que descartar agrega fricción en manga; el hero comunica la pajuela y un toque la aplica, consistente con la carga rápida). Reconciliado en `requirements.md` (nota bajo R6.5) + `design.md` §6.bis.5.

## Archivos tocados (fix-loop)
**Nuevos:**
- `app/app/maniobra/_components/InseminacionStep.tsx` — paso de inseminación (1 toque / selector).

**Modificados:**
- `app/app/maniobra/_components/SilentSanitaryStep.tsx` — card dominante + parametrización (reusable por inseminación).
- `app/app/maniobra/_components/SilentVaccinationStep.tsx` — card dominante; `$surface`→`$white` en chips/sugerencias/agregar deshabilitado.
- `app/app/maniobra/_components/LabSampleStep.tsx` / `LabDoubleStep.tsx` — card dominante centrada.
- `app/app/maniobra/carga.tsx` — `case 'inseminacion'` + import `InseminacionStep`/`pajuelasFor`.
- `app/src/utils/maneuver-config.ts` — `pajuelasFor` (nuevo) + `preconfigHistory` enriquecido con pajuelas multi.
- `app/src/utils/maneuver-config.test.ts` — 8 tests nuevos (`pajuelasFor` 6 + `preconfigHistory` enriquecido 1 + el de 1-toque cubierto por e2e) → 28 total.
- `app/e2e/maniobra-sanitaria.spec.ts` — 2 tests de inseminación (1 pajuela / >1 selector) + helper `startInseminacionSession`.
- `app/e2e/helpers/admin.ts` — `setRodeoDataKey` (prende `inseminacion`, deshabilitada por default) + `waitForServerInseminationWithSession` (oráculo server reproductive_events service ai).
- Specs reconciliadas: `requirements.md` (nota R6.5), `design.md` (§6.bis.5 + actualiza diferidos), `tasks.md` (M3.2b fix-loop as-built + M3.2c sin inseminación).

## Mapa test → R (fix-loop)
| R | Test(s) |
|---|---|
| R6.5 (inseminación 1 pajuela → 1 toque, service ai, notes, session) | maniobra-sanitaria e2e: preconfig "Toro 123" → hero `silent-product-hero` "Toro 123" → Aplicar → `waitForServerInseminationWithSession({semenName:'Toro 123'})` con session + notes='Toro 123' |
| R6.5 (inseminación >1 pajuela → selector) | maniobra-sanitaria e2e: preconfig "Toro 123, Toro 456" → 2 bloques `pajuela-block-*` + "Otra pajuela", NO hero → elige "Toro 456" → server notes='Toro 456' (prueba que el selector eligió la CORRECTA, no cualquiera) |
| R1.8 (pajuela autocompletar) | maneuver-config.test: `pajuelasFor` (string/coma/pajuelas[]/default_pajuela; dedup; sin vacíos; no-strings); `preconfigHistory` enriquecido con pajuelas multi |
| R5.2/R12.5 (cero espacio muerto, card dominante) | 5 capturas 412×915 (card de superficie ocupa el alto; CTA abajo; sin banda muerta de 50%) |
| R5.9 (corrección inseminación no duplica) | InseminacionStep: con `initialPajuela` → modo single (hero), no re-muestra selector; re-confirma → UPDATE notes (M3.1, `isCorrection`) |

## Rutas de las 5 capturas (412×915) — `design/maniobra-sanitaria/`
- `sanitaria-silent.png` — card dominante, hero "Ivermectina" centrado, "Cambiar producto" disjunto del CTA. SIN vacío.
- `vacunacion.png` — card dominante, chips Aftosa/Mancha + input + "Agregar". SIN banda muerta de 50%.
- `sangrado.png` — card dominante, "Número de tubo" + input "A-104" centrado. Balanceada.
- `raspado.png` — card dominante, Tricomoniasis "TR-1" / Campylobacteriosis "CA-2" centrados. Balanceada.
- `inseminacion.png` (NUEVA) — card dominante, hero "Toro 123" + "Cambiar pajuela" disjunto del CTA. SIN vacío.

## Autorrevisión adversarial (paso 8) — qué busqué, qué encontré, cómo lo cerré
- **Miré mis 5 capturas** (la dirección del leader): ¿quedó lleno el alto? **SÍ** — la card de superficie ocupa el alto disponible en las 5; el CTA gigante queda abajo sin banda muerta de 50%. Sangrado/raspado/inseminación/sanitaria centran el contenido en la card (figura-fondo, patrón CondicionCorporalStep); vacunación es top-aligned (los chips agregados empujan hacia abajo, UX de form multi-add) pero la card llena el alto. **¿Mis-tap entre aplicar/cambiar?** NO — "Cambiar producto"/"Cambiar pajuela" vive DENTRO de la card (separado por todo el cuerpo de la card del CTA "Aplicar y seguir" de abajo); en el selector, los bloques `$primary` (aplican) y "Otra pajuela" `$surface` (abre input) son targets grandes distintos con gap.
- **(a) R cubierto / a medias**: R6.5 cubierto (1 toque / selector / texto libre + autocompletar / `reproductive_events` service ai). Verifiqué que M3.1 YA mapea inseminación (data_key `inseminacion`, StepKind, StepValue, builder) → NO hubo que agregar mapeo, solo UI + case (como anticipaba la tarea). R5.14 (secuencia): la inseminación entra a la secuencia por el orden de config ∩ gating ∩ aplicabilidad (no tiene gate per-animal → aplica a cualquier sexo). R5.9 (corrección): con `initialPajuela` el step entra en modo single con la pajuela cargada (no re-muestra el selector) → UPDATE notes.
- **(b) edge cases**:
  - **0 pajuelas + sin initial** → `availablePajuelas=[]` → `single` (length<=1) → SilentSanitaryStep arranca en input (sin preconfig) → confirmar con vacío → `onConfirm('')` → `cleanNote` null → INSERT notes=null (inseminación "registrada sin nombrar pajuela", semántica silent consistente).
  - **availablePajuelas.length === 1** → `single` (length<=1) → confirmar de un toque (R6.5 1 pajuela). Correcto.
  - **pajuela con coma en el nombre** (vía wizard single input) → `pajuelasFor` la splitea → selector con 2. Tradeoff conocido del separador coma; aceptable (la preconfig single es típicamente 1 código corto). Documentado.
  - **>1 pajuela, corrección** → tras elegir, `captured.semenName` setea `initialPajuela` → single (no re-selector). Probado por el flujo.
- **(c) seguridad / gaps**:
  - **service_type='ai'/event_type='service' FIJOS** por el builder M3.1 (NO del usuario). La pajuela va en `notes` (texto libre) — `reproductive_events.notes` tiene CHECK ≤4000 server-side (0070 l.218) → barrera autoritativa. Consistente con el product_name del silent sanitario (cap ≤160 server-side, ya pasó Gate 2 M3.1). El input no tiene `maxLength` client (= estado as-built del input sanitario; el CHECK del DB es la barrera) — defensa en profundidad, no gap nuevo explotable.
  - **gating capa 2 re-valida**: inseminación nace DESHABILITADA en cría (0018 l.96) → el trigger `assert_data_keys_enabled(['inseminacion'])` (0054) rechaza fail-closed un service ai sobre un rodeo sin el data_key. El cliente NO replica la autorización; el e2e PRENDE el data_key (`setRodeoDataKey`, lo que el owner haría desde la config).
  - **created_by/establishment_id/session_id** forzados/pasados igual que el resto (no en el payload de cliente para los 2 primeros).
  - **`pajuelasFor`/`preconfigHistory` 100% puros** (sin I/O); descartan no-strings sin tirar; dedup case-insensitive.
- **(d) multi-tenant / offline**: el write de inseminación es CRUD-plano offline (mismo `persistManeuverEvent`); NUNCA establishment_id hardcodeado (anti-hardcode 0 violaciones). El selector/hero funcionan sin red.
- **(e) tests que pasan por la razón equivocada**: el e2e verifica SERVER-side (service_role) `event_type='service'` + `service_type='ai'` + `notes` exacto + `session_id` not null. El test del selector confirma que la pajuela ELEGIDA ("Toro 456", NO "Toro 123") quedó en notes → prueba que el selector eligió la correcta, no "alguna". El test de 1 pajuela confirma el hero con la preconfig + el confirm. Ambos confirman que la inseminación apareció en el pool (el data_key prendido).

## Reconciliación de specs (paso 9, fix-loop)
- `requirements.md`: nota de reconciliación bajo R6.5 (1 pajuela = confirmar de un toque por dirección del leader, no "popup informativo"; el EARS NO se reescribe). El *qué* cambió → nota, no reescritura.
- `design.md`: nuevo **§6.bis.5** (fix-loop as-built: card dominante + inseminación + `pajuelasFor` + divergencia R6.5 + el data_key deshabilitado por default). Actualizado el "Diferido" de §6.bis.3/§6.bis.4 (inseminación sale de M3.2c → hecho en M3.2b fix-loop).
- `tasks.md`: M3.2b `Satisface` suma R6.5 + bloque "FIX-LOOP M3.2b" as-built. M3.2c re-acotado a R8.4/R9.x (sin inseminación) + archivos actualizados.

## check.mjs (fix-loop)
RC=0 (run limpio): typecheck client + anti-hardcode (0 violaciones, incl. InseminacionStep + las cards) + client unit (incl. maneuver-config 28: +8 nuevos `pajuelasFor`/`preconfigHistory`) + RLS/Edge/Animal/Maneuvers/Operaciones-rodeo backend verdes. Sin flake de rate-limit ni spec-12.

## e2e (fix-loop)
- **`maniobra-sanitaria.spec.ts` 5/5** (las 3 previas + 2 de inseminación) — verde.
- **Regresión**: `maniobra-elegir` 2/2 + `maniobra-carga` 4/5 — el 5to (`resumen corregible: tocar el pesaje vuelve al keypad`) falló 1 vez en corrida combinada, **PASA AISLADO** (re-corrido 1/1). Es el **FLAKE PRE-EXISTENTE de timing del frame M2.2** ya documentado arriba (el frame vacía la secuencia transitoriamente cuando `useManeuverGating` re-fetchea → desmonta el keypad). NO lo introdujo el fix-loop (no toqué PesajeStep ni el guard de `gating.loading`). Endurecer el keypad es robustez del frame M2.2/M4 (fuera de scope).
