# Sesión actual

> Este archivo se vacía al cerrar cada sesión y su resumen se mueve a `history.md`.
> Mientras trabajás, **mantenelo actualizado en tiempo real**, no al final.

## 2026-06-24 (cont.) — SPEC 08 EXPORT SIGSA: arranque de implementación (Ola 4)

**Estado de entrada**: spec 08 `spec_ready` + Gate 1 PASS + Puerta 1 aprobada (2026-06-13). Capa pura
(T8/T9/T10: types + generador TXT + validador) YA construida y gateada en terminal paralela. Faltan
capas DB (T1-T6), PowerSync (T7), servicio/hook (T11-T12, T19-T20) y UI (T13-T18).

**Boot protocol**: CLAUDE.md + AGENTS.md leídos. `node scripts/check.mjs` → **VERDE (exit 0)**.
current/plan/feature_list leídos.

### Las 4 decisiones abiertas — RESUELTAS (Raf, 2026-06-24)

3 ya estaban cerradas por Raf el 2026-06-13; el leader las re-cuestionó (no pasamanos) + cerró la #3:

1. **Raza desconocida** → soft-block + `OR` 1-tap (ya resuelta). Default del leader: `OR` NO se promueve
   en el picker (sort_order 28 = último; render estricto por sort_order, no degradar analytics). `OR` vs
   `S/E` → Facundo (no bloquea).
2. **markAsDeclared (R10.2)** → ENTRA al MVP (ya resuelta). Default del leader: copy = "Marcar como ya
   declarado por otro medio" (no "Declarar"); `export_log_id=NULL` distingue marca manual.
3. **RENSPA único global** → **RESUELTA HOY: texto opcional, SIN unique** (solo CHECK de largo 1-20 +
   RPC owner-gate). Mata bug colisión cross-tenant + fuga de existencia. Desacopla MVP de Facundo. La
   pregunta "¿RENSPA 1:1?" queda viva como anti-fraude POST-MVP. Relajar NO reabre Gate 1.
4. **GATE DURO de formato** → lo hace Facundo (upload real, 5 incógnitas). Gatea el `done`, NO la
   construcción (generador swappable). ⚠ RIESGO NUEVO planteado: ¿el upload de Facundo ES una
   declaración legal real ante SENASA? Confirmar antes de que lo haga (sandbox vs declaración firme).

**Ninguna de las 4 dispara re-run de Gate 1** (#1/#2 superficie ya gateada, #3 saca superficie, #4 proceso).

### Hallazgo: renumeración de migraciones
El design asume `0089-0094`, pero esos números ya están tomados (DB va hasta `0106`). Las 6 migraciones
de spec 08 se renumeran a **`0107`-`0112`**:
- 0107 breed_catalog · 0108 animal_profiles.breed_id · 0109 reproductive_events.breed_id
- 0110 establishments.renspa · 0111 sigsa_declarations · 0112 export_log

### Plan de ejecución (pipeline autónomo, Raf autorizó deploy en sesión)
- [x] **P0** Reconciliar specs 08 con las 4 decisiones + renumeración (leader) — DONE
- [x] **P1a** Capa DB: implementer migraciones 0107-0112 (T1-T6) escritas + autorrevisadas — DONE
- [x] **P1b** Leader gate: review SQL + diff byte-a-byte de 0108/0109 vs as-built (0048/0075) + verificación de supuestos de schema contra DB viva — DONE (todo OK)
- [x] **P1c** APLICADAS al remoto (0107→0112, Management API, HTTP 201 c/u). Permiso `apply-migration-mgmt.mjs` agregado a settings.local.json (Raf autorizó). Post-apply verificado: 32 razas, FKs, RPC, 2 triggers, 3 CHECKs, FK export_log, renspa SIN unique. — DONE
- [x] **P1d** Tests: suite SIGSA 63/63 + **check.mjs completo VERDE** (cero regresión de las redefiniciones) — DONE
- [x] **P1e** Gate del chunk DB: **reviewer APPROVED + Gate 2 PASS** (0 HIGH/0 MEDIUM nuevos) — DONE. `progress/review_08-sigsa-db.md` + `progress/security_code_08-sigsa-db.md`.
- [x] **P2** PowerSync T7 (schema.ts + rafaq.yaml): implementado (run cortado por API error → bitácora reconstruida por leader) + **Gate 2 PASS** (`progress/security_code_08-sigsa-t7-powersync.md`, scope file_content = org_scope, sin fuga cross-tenant; cierra MEDIUM-2). check.mjs corriendo para confirmar. **DEPLOY del YAML = acción de Raf PENDIENTE** (dashboard Validate+Deploy).
- [x] **P3** Servicio/hook T11/T12/T19/T20: implementado (typecheck + 23 unit tests + 55/55 suite sigsa) + **reviewer APPROVED + Gate 2 PASS** (`review_08-sigsa-service.md` + `security_code_08-sigsa-service.md`). Agregó dep `expo-sharing` (faltaba). E2E pendiente del deploy de streams.
- [~] **P4** UI T13-T18 — streams deployados por Raf ✅. **Run 1 (flagship) DONE**: `export-sigsa.tsx` + `ExportAnimalRow` + `SigsaChecklistReminder` + `sigsa-display` util (typecheck + 11 unit + 4 e2e + 0 hardcode). **Veto design-review del leader: PASA** (capturas en `design/veto-sigsa-export/`; limpio, on-brand, buen empty state). Pendiente: Run 2 (BreedPicker T13 + form T18 + RENSPA CTA T17) + completar diferidos (markAsDeclared UI R10.2 [decisión 2=MVP], filtro de fechas R9.3, metadata de fila categoría/rodeo) → gate UI (reviewer+Gate 2) → Puerta 2.
  - **Decisiones del leader (Raf 2026-06-25: "elegí la mejor y seguí", sin menús de opciones — ver [[feedback_decide_dont_offer_options]])**: (1) terracota "1 animal a completar" → `$textMuted` (no es alerta); (2) CTA export → **sticky-bottom** (acción primaria, lista larga, thumb-zone); (3) markAsDeclared → action-sheet por fila Listos (R10.2 MVP); (4) filtro de fechas R9.3 → agregar; (5) metadata categoría/rodeo en fila → diferido post-MVP.
- [ ] **P4 Run 2** (EN CURSO): refinaciones del flagship (1-4 arriba) + BreedPicker T13 + integración form T18 + RENSPA CTA/edit T17 + renspa en schema local (R13.3 prepopular checklist) → veto design-review → gate UI (reviewer+Gate 2) → Puerta 2.
- [~] **P4 Run 3** (EN CURSO, implementer 2026-06-25) — cierre del GAP breed_id (T18): migración **0113** trigger derive-breed_id + edición de raza en la ficha + e2e/tests. Plan (T1..T6 del run):
  - T1: migración `0113_derive_breed_id_from_breed.sql` (trigger BEFORE INSERT OR UPDATE OF breed, guard `NEW.breed IS NOT NULL` para no pisar herencia del ternero). NO aplicada (gate del leader).
  - T2: tests de trigger en `supabase/tests/sigsa/run.cjs` (a:match, b:nomatch→NULL, c:guard herencia, d:UPDATE re-deriva, e:case-insensitive). Gated al apply.
  - T3: helper puro `breedCodeForName` (name→senasa_code) en `breed-picker.ts` + test.
  - T4: ficha edit (`[id].tsx`) — row/CTA "Raza" → BreedPickerSheet → UPDATE offline-safe de `breed` (patrón CUT/0040) → `setBreed` en animals.ts + `buildSetBreedUpdate` en local-reads.ts.
  - T5: e2e extendido (`sigsa-breed-renspa.spec.ts`) — alta con raza → server-side assert breed_id no-NULL (gated al apply) + ficha-edit completa raza.
  - T6: verificación (typecheck + unit + e2e que corre sin apply) + autorrevisión + reconciliación specs.
- [ ] **GATE** Puerta 2 (código) — Raf (al cerrar la UI).

## CHECKPOINT 2026-06-25 — todo lo construible-sin-deploy está DONE + gateado
Capas pura/DB/PowerSync/servicio: completas y gateadas verde. Falta solo la UI, que depende del deploy de
streams. **3 acciones de Raf destrabann el cierre** (ver handoff): (1) limpiar el huérfano de test
`animal_id=72735816-867f-472e-a742-b924c408ec95` (tag 9×64) para baseline verde; (2) deployar
`sync-streams/rafaq.yaml` en el dashboard PowerSync (Gate-2-aprobado); (3) Facundo upload de formato.
Backlog: el test INPUT-1 del Animal suite usa un tag FIJO `'9'×64` → flake recurrente al interrumpir una
corrida; convendría que use un tag único por RUN_TAG (fix de 1 línea, spec 02, no urgente).

**Dos dependencias externas que gatean el `done`** (ninguna la puede cerrar el leader solo):
1. **Deploy de sync rules** (Raf, dashboard PowerSync). El `rafaq.yaml` NO se deploya desde el repo (línea 5 del archivo). El scope de `file_content` (TXT con RFIDs) es el control de seguridad más sensible → Gate 2 lo revisa antes de pasártelo.
2. **Upload de formato a SIGSA** (Facundo, decisión 4) — confirma las 5 incógnitas del TXT. ⚠ Verificar antes si el upload es dry-run o declaración legal firme.

**Hallazgo del leader (corregido en design):** la query de export del design hacía `JOIN animals`, pero `animals` NO entra al sync set de PowerSync (ADR-026) → habría roto offline (R14). Corregido: usa las columnas denormalizadas `animal_profiles.animal_{tag_electronic,sex,birth_date}` (0079). El implementer de servicio (T11) debe seguir el query corregido.

**Reconciliación clave (impl):** `reproductive_events.breed` (texto) NO existe (verificado en DB viva) → el UPDATE best-effort de R1.6/0109 es no-op documentado; la herencia de raza que importa (R1.7) va al `animal_profiles.breed_id` del ternero en ambos caminos (trigger mono `tg_reproductive_events_create_calf` en 0108 + RPC mellizos `register_birth` en 0109), byte-idénticos al as-built salvo las 3 adiciones de breed_id.

**Notas técnicas vigentes**: pnpm.cmd en PowerShell; tests Node nativo en run-tests.mjs; el trigger de
ternero al pie (0109) hereda breed_id de la madre — el implementer reconcilia contra el as-built real
(birth_calves + register_birth, NO el `tg_create_calf_on_birth` que cita el design viejo).

## 🏁 PUERTA 2 — FEATURE 08 CODE-COMPLETE + TODO GATEADO VERDE (2026-06-25)
Todas las capas construidas y cada chunk gateado (reviewer + Gate 1/2 + veto design-review donde aplica):
- **Pura** T8-T10 (generador TXT + validador, 32 tests).
- **DB** T1-T6 (migraciones 0107-0112, aplicadas) — reviewer + Gate 2 PASS, suite SIGSA 63→72.
- **PowerSync** T7 (schema + 3 streams) — Gate 2 PASS. **Streams DEPLOYADOS por Raf** ✅.
- **Servicio** T11/T12/T19/T20 + hook — reviewer + Gate 2 PASS.
- **Fix de connector** (append-only `.insert()` — la feature estaba rota end-to-end) — reviewer + Gate 2 PASS.
- **UI** T13-T18 (flagship + BreedPicker + RENSPA + refinaciones) — veto design-review PASS + reviewer + Gate 2 PASS.
- **Run 3 / 0113** (trigger derive-breed_id + edición de raza en ficha, cierra T18) — APLICADA, Gate 1 + reviewer + Gate 2 PASS, §T18 72/72, animal suite sin regresión.

**Verificación**: suite SIGSA 72/72 · animal suite 107/109 (las 2 fallas = SOLO el flake del huérfano '9'×64, ajeno) · typecheck + ~300 unit + e2e verdes. check.mjs FULL-verde gateado por limpiar el huérfano.

**Falta para `done`** (3 cosas, ninguna la cierra el leader solo):
1. **Limpiar el huérfano** → `! node scripts/cleanup-test-orphan.mjs 72735816-867f-472e-a742-b924c408ec95` (o autorizar el permiso) → restaura check.mjs full-verde.
2. **Puerta 2** (aprobación de código de Raf) — el feature está code-complete + gateado, listo para tu OK.
3. **Facundo: upload de formato a SIGSA** (decisión 4, GATE DURO) → confirma el TXT exacto → flip a `done`.

Sin commitear todavía (regla: commit cuando Raf lo pida). El árbol tiene todo el trabajo de spec 08 + el WIP de design/veto-*.
