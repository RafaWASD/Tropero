# Spec 03 — Stream B: puesta en servicio (cliente / manga) — Tasks

**Status**: `spec_ready` (frontend; **Gate 1 N/A** salvo reapertura — design §0; **Gate 2 por chunk**).
**Fecha**: 2026-06-23.
**Fuente de verdad**: `requirements-puesta-en-servicio-cliente.md` (`RPSC.x`) + `design-puesta-en-servicio-cliente.md`.

> El implementer marca `[x]` al completar y documenta el mapa `RPSC.<n> → archivo:test` en `progress/impl_03-puesta-en-servicio-cliente.md`. El reviewer rechaza si queda `[ ]` sin justificación. **No se aplica ninguna migración** (Stream B es frontend; el backend lo hizo Stream A, `0102`–`0105`, ya done).

> **Orden de chunks (DD-PSC-1): B4 PRIMERO** (cierra el drift display-only vivo, sin design-spike), luego B1/B2 (cada uno con design-spike + veto del leader **antes** de mostrar a Raf), B3 cuando convenga (independiente). Cada chunk pasa **Gate 2 (code)** tras el reviewer.

---

## Chunk B4 — alinear el espejo client-side (RPSC.1) — PRIMERO, URGENTE

> Lógica pura + tests. Sin UI nueva, sin design-spike. Cierra el drift vivo (server `0104` ya aplicado ≠ espejo cliente).

- [x] **T-B4.1** — `app/src/utils/animal-category.ts`: quitar la declaración `const hasService` y su uso `|| hasService` de la rama `vaquillona` de `computeCategoryCode` (líneas ~261/269). NADA MÁS de la función cambia (precedencia, rama macho, cortes de edad, tacto+ vigente, partos). Cubre: RPSC.1.1, RPSC.1.3.
- [x] **T-B4.2** — `animal-category.ts`: actualizar el comentario de precedencia ("vaquillona(destete|servicio|≥1año)" → sin "servicio") + el header anti-drift (RC6.5.1: la rama `vaquillona` espeja `0104`, ya no `0062` en lo que toca service). Cubre: RPSC.1.7.
- [x] **T-B4.3** — Test `animal-category.test.ts`: invertir T2.23 — ternera <1año + solo `service` (sin destete) → **`ternera`** (antes `vaquillona`); vaquillona por edad/destete + `service` → sigue `vaquillona`. Cubre: RPSC.1.1, RPSC.1.4.
- [x] **T-B4.4** — Test `animal-category.test.ts`: conservar verdes los casos de precedencia con `service` presente + evento dominante (parto → `vaca_segundo_servicio`; tacto+ → `vaquillona_prenada`) — el dominante manda, `service` ya no es disparador. Cubre: RPSC.1.3, RPSC.1.4.
- [x] **T-B4.5** — Test `animal-category.test.ts`: con destete → `vaquillona`; ≥1año conocido → `vaquillona` por edad (tras quitar `service`, las vías canónicas siguen). Cubre: RPSC.1.2.
- [x] **T-B4.6** — `app/src/utils/maneuver-category-preview.ts`: `syntheticEventsForFemaleCategory('vaquillona')` reconstruye con `[weaning]` (no `[service]`, DD-PSC-7) para que el estado de partida siga dando `vaquillona` post-`0104`. Cubre: RPSC.1.5.
- [x] **T-B4.7** — `maneuver-category-preview.ts`: `capturedReproEvents` deja de inyectar un evento `service` por `kind:'inseminacion'` (la IA ya no anticipa transición de categoría — RPS.4.8). Cubre: RPSC.1.5.
- [x] **T-B4.8** — Test `maneuver-category-preview.test.ts`: invertir "ternera + inseminación (service) → vaquillona" a **→ null** (sin transición); verificar que tacto+ sigue anticipando `vaquillona_prenada` (no se rompió). Cubre: RPSC.1.5.
- [x] **T-B4.9** — Verificar (NO tocar) que `MIRROR_EVENT_TYPES` (`local-reads.ts:936`) sigue incluyendo `'service'` (el evento se sigue leyendo para el timeline; solo dejó de influir en `computeCategoryCode`). Cubre: RPSC.1.6. ✔ VERIFICADO: `local-reads.ts:936` sigue `('birth','weaning','service','tacto','abortion')` — NO tocado.
- [x] **T-B4.10** — Correr `node scripts/check.mjs` + la suite de unit del cliente (animal-category + maneuver-category-preview verdes) + regresión. Gate 2 (code) del chunk B4. Cubre: RPSC.8.5.

---

## Chunk B1 — selector de 12 meses en el wizard de rodeo (RPSC.2/RPSC.3)

> **Design-spike M-PSC-B1.0 + veto del leader (skill `design-review`) ANTES de mostrar a Raf** (design §3.1). Cross-spec: el wizard de rodeo es spec 02 C1.

- [ ] **T-B1.0** — **Design-spike** del selector de 12 meses (grid manga, primavera pre-tildada, recorte de descendentes, densidad R12.5, atajos primavera/otoño/todo/ninguno). Veto del leader en **web táctil real** (`hasTouch`). Solo se muestra a Raf lo aceptable. Cubre: RPSC.2.1 (visual), RPSC.5.9-análogo.
- [ ] **T-B1.1** — `app/src/utils/service-months.ts` (PURO): `parseServiceMonths` (TEXT/JSON de PowerSync → `number[] | null` tolerante), `toServiceMonthsArray` (set tildado → array ordenado/único/1–12), `isMonthChecked`, `SPRING_DEFAULT={10,11,12}`. Cubre: RPSC.2.6, RPSC.3.7.
- [ ] **T-B1.2** — Test `service-months.test.ts`: parseo de null/''/no-array/fuera-de-rango → "sin configurar"/filtrado (RPSC.3.7); array `{}` (vacío) distinguible de null; mapeo de checkboxes; default primavera. Cubre: RPSC.2.6, RPSC.3.7.
- [ ] **T-B1.3** — `app/src/services/powersync/schema.ts`: agregar `service_months: column.text` a la tabla `rodeos`. Verificar que la stream `est_rodeos` (`sync-streams/rafaq.yaml`) emite la columna; si no, anotar gap de Stream A (no debería). Cubre: RPSC.3.7.
- [ ] **T-B1.4** — `local-reads.ts` (`buildRodeosQuery` + overlay `pending_rodeos`): proyectar `service_months` en la lectura del rodeo (para que la pantalla de edición y el default del tacto lo vean). Cubre: RPSC.3.1, RPSC.4.2.
- [ ] **T-B1.5** — `app/app/_components/ServiceMonthsSelector.tsx`: componente reutilizable (grid 12 meses) según el spike aprobado (T-B1.0). Cubre: RPSC.2.1, RPSC.2.3, RPSC.3.1.
- [ ] **T-B1.6** — `app/src/services/powersync/outbox.ts`: `enqueueSetRodeoServiceMonths({ rodeoId, params:{ p_rodeo_id, p_service_months } })` (gemelo de `enqueueSetRodeoConfig`, overlay optimista sobre `service_months` del rodeo). Cubre: RPSC.3.3, RPSC.3.4.
- [ ] **T-B1.7** — `app/src/services/powersync/upload.ts`: agregar `'set_rodeo_service_months'` a `RPC_OP_TYPES` (mapea a `supabase.rpc('set_rodeo_service_months', params)`) + `P0002 && opType==='set_rodeo_service_months' → permanent_reject` (rollback del overlay). Cubre: RPSC.3.3, RPSC.3.6.
- [ ] **T-B1.8** — Test `outbox`/`upload` (node:test): el intent `set_rodeo_service_months` mapea a la RPC con params tal cual; idempotencia (replay = no-op); P0002 → permanent_reject. Cubre: RPSC.3.3, RPSC.3.5, RPSC.3.6.
- [ ] **T-B1.9** — `app/src/services/rodeos.ts`: `createRodeo` pasa `p_service_months` (default primavera si no se eligió, RPSC.2.5) en los params de `enqueueCreateRodeo`; +`setRodeoServiceMonths(rodeoId, months)` que llama `enqueueSetRodeoServiceMonths`. Cubre: RPSC.2.4, RPSC.2.5, RPSC.3.3.
- [ ] **T-B1.10** — `app/src/services/powersync/outbox.ts` (`enqueueCreateRodeo`): aceptar/pasar `p_service_months` en `params`. Cubre: RPSC.2.4.
- [ ] **T-B1.11** — `app/app/crear-rodeo.tsx`: integrar el `ServiceMonthsSelector` como paso/sección (DD-PSC-5), primavera pre-tildada (RPSC.2.2); confirmar el alta envía los meses por el camino offline; un alta que ignore el paso queda con primavera (RPSC.2.5). Cubre: RPSC.2.1, RPSC.2.2, RPSC.2.5.
- [ ] **T-B1.12** — `app/app/editar-plantilla.tsx` y/o `app/app/rodeos.tsx`: superficie de ver/editar meses (owner) → `setRodeoServiceMonths` offline + optimista; rodeo `NULL` se presenta "sin configurar" (NO pre-tildar primavera en la edición, RPSC.3.2) e invita a configurar. Cubre: RPSC.3.1, RPSC.3.2, RPSC.3.4.
- [ ] **T-B1.13** — e2e (`app/e2e/`, web táctil): alta con primavera pre-tildada + persiste por outbox (RPSC.2.2/RPSC.2.4); editar meses de rodeo existente offline + optimista + idempotente (RPSC.3.1/RPSC.3.3/RPSC.3.4/RPSC.3.5); rodeo "sin configurar" invita a configurar (RPSC.3.2). Oráculo server: `service_months` en `rodeos` tras drenar. Cubre: RPSC.2.x, RPSC.3.x.
- [ ] **T-B1.14** — `check.mjs` + unit + e2e B1 verdes; Gate 2 (code) del chunk B1 (RLS no-bypass: la escritura va por la RPC owner-only; sin hardcode de establishment_id). Cubre: RPSC.8.1, RPSC.8.2, RPSC.8.5.

---

## Chunk B2 — tacto configurable + buckets en TactoStep (RPSC.4/RPSC.5)

> **Design-spike M-PSC-B2.0 + veto del leader ANTES de mostrar a Raf** (design §3.2). [TENTATIVO] en el bucketing 4–11 / política 12m (Gate 0 §9).

- [ ] **T-B2.0** — **Design-spike** del config "¿medir tamaño? sí/no" (`ManeuverConfigSheet`, default derivado visible) + `TactoStep` con 2/3/0 bloques de tamaño (reparto del alto R12.5, "PREÑADA" sin recorte, NO rediseñar el binario). Veto del leader en **web táctil real**. Solo se muestra a Raf lo aceptable. Cubre: RPSC.4.1 (visual), RPSC.5.9.
- [ ] **T-B2.1** — `app/src/utils/pregnancy-buckets.ts` (PURO): `sizeBucketsForServiceMonths(nMonths)` (0/1/12+→[]; 2→cabeza/cola; 3–11→cabeza/cuerpo/cola) + `defaultMeasureSize(nMonths)` (≥1 bucket → SÍ). Mapeo cabeza/cuerpo/cola→large/medium/small. [TENTATIVO 4–11/12m]. Cubre: RPSC.4.5, RPSC.5.6, RPSC.5.8.
- [ ] **T-B2.2** — Test `pregnancy-buckets.test.ts`: 1→0, 2→2, 3→3, 4/7/11→3 (tercios), 12→0, null/0→0; default "¿medir?" 2/3/4–11→SÍ, 1/12/null/vacío→NO; mapeo 1:1. Cubre: RPSC.4.2, RPSC.5.2–RPSC.5.6, RPSC.5.8.
- [ ] **T-B2.3** — Config "¿medir tamaño?" en el wizard de jornada (`ManeuverConfigSheet` o sheet/uso nuevo) para la maniobra `tacto`: persiste la elección en el `config` jsonb (preconfig de `tacto`), con el default derivado del rodeo (`defaultMeasureSize`, RPSC.4.2) y override (RPSC.4.3). Cubre: RPSC.4.1, RPSC.4.2, RPSC.4.3, RPSC.4.4.
- [ ] **T-B2.4** — `app/app/maniobra/jornada.tsx`: derivar el default de "¿medir tamaño?" de `service_months` del rodeo de la jornada (parseado, B1 T-B1.4) al ofrecer el config del tacto. Cubre: RPSC.4.2, RPSC.4.4.
- [ ] **T-B2.5** — `app/app/maniobra/_components/TactoStep.tsx`: recibir `buckets: SizeBucket[]` y renderizar N bloques de tamaño (0→salta directo con `'large'` DD-PSC-2; 2→cabeza/cola; 3→cabeza/cuerpo/cola), preservando el lenguaje visual aprobado. Cubre: RPSC.5.1, RPSC.5.2, RPSC.5.3, RPSC.5.4, RPSC.5.5, RPSC.5.6, RPSC.5.9.
- [ ] **T-B2.6** — `carga.tsx`/`paso.tsx` (frame): computar `buckets` con `sizeBucketsForServiceMonths(nMeses)` (∩ el config "¿medir tamaño?") y pasarlos al `TactoStep`; persistir un único `reproductive_events` (sin cambio en el write-path). "Preñada sin tamaño" → `'large'` (DD-PSC-2). Cubre: RPSC.5.2, RPSC.5.7, RPSC.5.8.
- [ ] **T-B2.7** — `app/src/utils/maneuver-sequence.ts` (`describeStepValue`): cuando la jornada NO mide tamaño, el resumen del tacto positivo muestra **"Preñada"** (sin "· Cabeza"), DD-PSC-8. Cubre: RPSC.5.7.
- [ ] **T-B2.8** — Test (unit del frame / `describeStepValue`): preñada sin tamaño persiste positivo (`'large'`) y el resumen muestra "Preñada"; con tamaño muestra "Preñada · Cabeza/Cuerpo/Cola". Cubre: RPSC.5.6, RPSC.5.7.
- [ ] **T-B2.9** — e2e (`app/e2e/`, web táctil): tacto en rodeo de 2 meses → 2 botones (cabeza/cola); 3 meses → 3 botones; 1/12 meses o "no medir" → sin sub-paso de tamaño (salta), preñada persistida positiva; "PREÑADA" sin recorte. Cubre: RPSC.5.2–RPSC.5.5, RPSC.5.9.
- [ ] **T-B2.10** — `check.mjs` + unit + e2e B2 verdes; Gate 2 (code) del chunk B2. Cubre: RPSC.8.5.

---

## Chunk B3 — baja de la carga manual de servicio natural (RPSC.6)

> Frontend puro, sin design-spike. Solo IA y TE quedan en la ficha; la IA de manga intacta.

- [x] **T-B3.1** — `app/src/utils/event-input.ts`: const NUEVA `SERVICE_TYPE_INPUT_OPTIONS` (`['ai','te']`, subset de `SERVICE_TYPE_OPTIONS` que queda como catálogo completo); `agregar-evento.tsx` `ServiceForm` apunta a ella (estado/props narroweados a `ManualServiceType='ai'|'te'`). NO tocado el enum DB ni `addService` (`AddServiceInput.serviceType` sigue siendo `ServiceType` completo). Cubre: RPSC.6.1, RPSC.6.6.
- [x] **T-B3.2** — `agregar-evento.tsx`: subtítulo de la card "Servicio" del paso 1 "Monta natural, IA o TE" → **"Inseminación o TE"** (default DD-PSC-6). Cubre: RPSC.6.1.
- [x] **T-B3.3** — Verificado (NO tocado): `InseminacionStep` (manga, `service`+`ai`) intacto; `fetchTimeline` no filtra por tipo + `humanizeServiceType('natural')='Monta natural'` sin tocar → los `service` históricos (incl. `natural`) siguen en el timeline. Cubre: RPSC.6.2, RPSC.6.3.
- [x] **T-B3.4** — Constatación RPSC.6.4 documentada en `progress/impl_03-streamB-b3.md` (no hay preset/secuencia/maniobra de servicio natural que romper — nunca fue `ManeuverKind`). Cubre: RPSC.6.4.
- [x] **T-B3.5** — `app/e2e/events.spec.ts`: 4 tests reescritos a "Inseminación (IA)" + test NUEVO `B3 baja monta natural…` (selector sin "Monta natural" + IA/TE presentes + `natural` histórico sembrado por admin sigue en el timeline). + unit `event-input.test.ts` (`SERVICE_TYPE_INPUT_OPTIONS`). El gate-por-sexo no cambia. Cubre: RPSC.6.5.
- [x] **T-B3.6** — `check.mjs` VERDE end-to-end + e2e `events.spec.ts` 14/14; captura `tests/stream-b/b3-servicio-selector-{360,412}.png`. **Pendiente: veto liviano del leader + reviewer + Gate 2 (code) del chunk B3.** Cubre: RPSC.8.5.

> **Nota de tracking del ledger (B3):** el ledger real de este chunk es `progress/impl_03-streamB-b3.md` (per-chunk, patrón establecido por B4/B1/B2), no `impl_03-puesta-en-servicio-cliente.md` del header.

---

## Chunk B-VERIF — aptitud (RPSC.7) — verificación, sin cambio de código

- [ ] **T-VERIF.1** — Verificar (NO tocar) que `TactoVaquillonaStep` captura los 3 veredictos (`HeiferFitness = apta|no_apta|diferida`) y persiste a `reproductive_events.heifer_fitness`, sin disparar transición de categoría en el cliente. Cubre: RPSC.7.1, RPSC.7.2.
- [ ] **T-VERIF.2** — Confirmar que NO se agrega captura de peso a la aptitud (POST-MVP, Gate 0 §3). Documentar fuera-de-alcance. Cubre: RPSC.7.3.

---

## Reconciliación final (regla dura — antes de cerrar cada chunk)

- [ ] **T-REC.1** — Reconciliar al as-built (design §1 + requirements "Historial"): si Gate 2 o un fix cambió comportamiento, reflejarlo en `requirements-/design-puesta-en-servicio-cliente.md` antes de commitear, preservando los IDs `RPSC.x` (`docs/conventions.md` §correcciones-en-specs). Cubre: RPSC.8.3, RPSC.8.5.
- [ ] **T-REC.2** — Citar (sin contradecir) las specs cross-tocadas en el `progress/impl_…`: spec 02 C1 (wizard rodeo, B1), spec 02 C6 (espejo, B4), spec 03 base (M2.2 `TactoStep` B2; R8.4 preview B4), `RPS.x` (Stream A consumido). Cubre: RPSC.8.3.
- [ ] **T-REC.3** — Verificar que NINGÚN chunk reabrió schema/RLS/Edge/migración (Gate 1 N/A confirmado, design §0); si alguno lo hizo → PARAR y marcar Gate 1 OBLIGATORIO (RPSC.8.4). Cubre: RPSC.8.4.

---

## Mapa de cobertura (cada RPSC tiene ≥1 task)

| RPSC | Tasks |
|---|---|
| RPSC.1.1 | T-B4.1, T-B4.3 |
| RPSC.1.2 | T-B4.5 |
| RPSC.1.3 | T-B4.1, T-B4.4 |
| RPSC.1.4 | T-B4.3, T-B4.4 |
| RPSC.1.5 | T-B4.6, T-B4.7, T-B4.8 |
| RPSC.1.6 | T-B4.9 |
| RPSC.1.7 | T-B4.2 |
| RPSC.2.1 | T-B1.0, T-B1.5, T-B1.11 |
| RPSC.2.2 | T-B1.11 |
| RPSC.2.3 | T-B1.5 |
| RPSC.2.4 | T-B1.9, T-B1.10, T-B1.11 |
| RPSC.2.5 | T-B1.9, T-B1.11 |
| RPSC.2.6 | T-B1.1, T-B1.2 |
| RPSC.2.7 | T-B1.14 (Gate 2 / outbox classify) |
| RPSC.3.1 | T-B1.4, T-B1.5, T-B1.12, T-B1.13 |
| RPSC.3.2 | T-B1.12, T-B1.13 |
| RPSC.3.3 | T-B1.6, T-B1.7, T-B1.8, T-B1.9 |
| RPSC.3.4 | T-B1.6, T-B1.12 |
| RPSC.3.5 | T-B1.8, T-B1.13 |
| RPSC.3.6 | T-B1.7, T-B1.8 |
| RPSC.3.7 | T-B1.1, T-B1.2, T-B1.3, T-B1.4 |
| RPSC.4.1 | T-B2.0, T-B2.3 |
| RPSC.4.2 | T-B2.1, T-B2.2, T-B2.3, T-B2.4 |
| RPSC.4.3 | T-B2.3 |
| RPSC.4.4 | T-B2.3, T-B2.4 |
| RPSC.4.5 | T-B2.1 |
| RPSC.5.1 | T-B2.5 |
| RPSC.5.2 | T-B2.2, T-B2.5, T-B2.6, T-B2.9 |
| RPSC.5.3 | T-B2.2, T-B2.5, T-B2.9 |
| RPSC.5.4 | T-B2.2, T-B2.5, T-B2.9 |
| RPSC.5.5 | T-B2.2, T-B2.5, T-B2.9 |
| RPSC.5.6 | T-B2.1, T-B2.2, T-B2.5, T-B2.8 |
| RPSC.5.7 | T-B2.6, T-B2.7, T-B2.8 |
| RPSC.5.8 | T-B2.1, T-B2.2, T-B2.6 |
| RPSC.5.9 | T-B2.0, T-B2.5, T-B2.9 |
| RPSC.6.1 | T-B3.1, T-B3.2 |
| RPSC.6.2 | T-B3.3 |
| RPSC.6.3 | T-B3.3 |
| RPSC.6.4 | T-B3.4 |
| RPSC.6.5 | T-B3.5 |
| RPSC.6.6 | T-B3.1 |
| RPSC.7.1 | T-VERIF.1 |
| RPSC.7.2 | T-VERIF.1 |
| RPSC.7.3 | T-VERIF.2 |
| RPSC.8.1 | T-B1.14 |
| RPSC.8.2 | T-B1.14 |
| RPSC.8.3 | T-REC.1, T-REC.2 |
| RPSC.8.4 | T-REC.3 |
| RPSC.8.5 | T-B4.10, T-B1.14, T-B2.10, T-B3.6, T-REC.1 |
