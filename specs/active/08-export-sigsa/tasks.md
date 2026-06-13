# Spec 08 — Exportación SIGSA — Tasks

**Status**: spec_ready
**Fecha**: 2026-06-13

## Notas de implementación antes de arrancar

1. **Migrations cross-spec**: las migrations 0089-0092 tocan tablas de specs ya `done` (spec 01 y spec 02). Revisar el estado actual de la DB antes de aplicar; usar `IF NOT EXISTS` donde corresponda.
2. **Gate duro de formato**: NO modificar el separador, la longitud del RFID ni los códigos de raza sin confirmar con upload real a SIGSA. El módulo `SigsaTxtGenerator` está diseñado para absorber este ajuste en un solo lugar.
3. **Números de migration**: las tasks asumen 0089..0096+. Si la DB tiene migrations más recientes al momento de implementar, renumerar en consecuencia.
4. **Trazabilidad R→T**: cada task lista los `R<n>` que cubre. Los tests descritos en cada task cubren los requisitos correspondientes.

---

## Bloque A — Deltas backend cross-spec (DB ya `done`)

> Estas tasks tocan tablas de specs 01 y 02. Requieren cuidado: son incrementos sobre migrations existentes y producción.

- [ ] **T1** — Migration 0089: crear tabla `breed_catalog` + seed de 28 razas bovinas + 3 bubalinas (`active=false`) + `S/E`. Grafías literales del manual (ver `razas-senasa-codigos.md`). Habilitar RLS con SELECT abierto a `authenticated` sin INSERT/UPDATE/DELETE de cliente. Cubre: R1.1, R1.2, R1.3.

  **Tests**: (a) `authenticated` puede SELECT de `breed_catalog`; (b) `authenticated` no puede INSERT/UPDATE/DELETE; (c) hay exactamente 28 filas con `species='bovine' AND active=true`; (d) el código `S/E` existe; (e) los 3 bubalinos tienen `active=false`.

- [ ] **T2** — Migration 0090: agregar `animal_profiles.breed_id` FK nullable + índice + migración best-effort de texto libre. Actualizar trigger del ternero al pie para heredar `breed_id` de la madre. Cubre: R1.4, R1.5, R1.7.

  **Tests**: (a) columna existe y acepta `NULL`; (b) acepta un `breed_id` válido; (c) rechaza `breed_id` que no existe en `breed_catalog`; (d) migración best-effort: un perfil con `breed='Aberdeen Angus'` recibe `breed_id` del código `AA`; (e) un perfil con `breed='texto_raro_sin_match'` queda con `breed_id=NULL`; (f) ternero al pie creado por un evento `birth` hereda `breed_id` de la madre.

- [ ] **T3** — Migration 0091: agregar `reproductive_events.breed_id` FK nullable + migración best-effort análoga. Cubre: R1.6.

  **Tests**: (a) columna existe y acepta `NULL`; (b) migración best-effort: un `reproductive_event` con `breed='Hereford'` recibe `breed_id` del código `H`; (c) sin match queda `NULL`.

- [ ] **T4** — Migration 0092: agregar `establishments.renspa` (text nullable) + índice UNIQUE parcial (`renspa IS NOT NULL AND deleted_at IS NULL`) + constraint de longitud (1-20 chars). Agregar RPC `update_renspa(p_establishment_id, p_renspa)` SECURITY DEFINER con guard `is_owner_of` (MEDIUM-1 — ver design migration 0092). NO crear policy UPDATE nueva más permisiva que la existente 0007. Cubre: R2.1, R2.2, R2.3.

  **Tests**: (a) owner puede llamar a `update_renspa` y el campo se actualiza; (b) `veterinarian` recibe error 42501 al llamar `update_renspa`; (c) `field_operator` recibe error 42501 al llamar `update_renspa`; (d) `veterinarian` recibe error al intentar UPDATE directo de `renspa` vía PostgREST (bloqueado por policy 0007); (e) dos establecimientos activos no pueden tener el mismo `renspa` (unique violation); (f) un establecimiento eliminado (`deleted_at IS NOT NULL`) puede tener un `renspa` idéntico al de uno activo; (g) string vacío o mayor a 20 chars es rechazado.

- [ ] **T5** — Migration 0093: crear tabla `sigsa_declarations` + UNIQUE `(establishment_id, animal_profile_id)` + RLS (SELECT `has_role_in`, INSERT solo `owner`/`vet` con IDOR-check, sin UPDATE/DELETE) + trigger `sigsa_declarations_set_declared_by` (HIGH-1) + función `tg_force_declared_by_auth_uid`. Cubre: R3.1, R3.2, R3.3, R3.5, R3.6, R3.7, R11.1, R11.2, R11.3.

  **Tests**: (a) `owner` puede INSERT una declaración; (b) `veterinarian` puede INSERT; (c) `field_operator` no puede INSERT; (d) segundo INSERT del mismo par `(establishment_id, animal_profile_id)` viola UNIQUE; (e) usuario sin rol no puede SELECT; (f) usuario con rol en otro establishment no puede ver declaraciones del primero; (g) un animal transferido al campo destino puede tener su propia declaración independiente del campo origen; (h) `declared_by` siempre refleja `auth.uid()` aunque el payload del cliente envíe un UUID diferente (HIGH-1); (i) INSERT con `animal_profile_id` perteneciente a otro establecimiento es rechazado aunque el `establishment_id` sea válido para el caller (MEDIUM-4 — IDOR).

- [ ] **T6** — Migration 0094: crear tabla `export_log` + RLS (SELECT `has_role_in`, INSERT solo `owner`/`vet`, sin UPDATE/DELETE) + trigger `export_log_set_generated_by` (HIGH-1) + función `tg_force_generated_by_auth_uid` + constraints de tope (`file_content` 5 MB, `file_name` 255 chars, HIGH-2) + agregar FK `sigsa_declarations.export_log_id`. Cubre: R4.1, R4.2, R4.3, R4.4, R11.1, R11.2, R11.3.

  **Tests**: (a) `owner` puede INSERT en `export_log`; (b) `veterinarian` puede INSERT; (c) `field_operator` no puede INSERT; (d) usuario en otro establishment no puede SELECT; (e) FK `export_log_id` en `sigsa_declarations` apunta a filas reales de `export_log`; (f) borrar un `export_log` setea `export_log_id = NULL` en `sigsa_declarations` (ON DELETE SET NULL); (g) INSERT con `file_content` > 5 MB es rechazado por la DB; INSERT con `file_name` > 255 chars es rechazado (HIGH-2); (h) `generated_by` siempre refleja `auth.uid()` aunque el payload del cliente envíe un UUID diferente (HIGH-1).

---

## Bloque B — PowerSync sync config + schema local

- [ ] **T7** — Agregar `breed_catalog`, `sigsa_declarations`, `export_log` al schema de PowerSync (`app/src/services/powersync/schema.ts`) y a `sync-streams/rafaq.yaml` con las streams explícitas del diseño (MEDIUM-2): `sigsa_breed_catalog` (global), `sigsa_declarations` (`org_scope`), `sigsa_export_log` (`org_scope`). Cubre: R1.8, R14.2, R14.3, R15.1.

  **Tests**: (a) el schema local TypeScript tiene las columnas correctas para las 3 tablas nuevas; (b) una inserción local en `sigsa_declarations` queda en la cola de sync de PowerSync; (c) offline: se puede leer `breed_catalog` del SQLite local; (d) un usuario con rol en 2 establecimientos solo recibe en SQLite local los `sigsa_declarations` y `export_log` de los establecimientos donde tiene rol activo (no de otros tenants) (MEDIUM-2).

---

## Bloque C — Módulo generador de TXT + validador

- [ ] **T8** — Crear `app/src/services/sigsa/types.ts` con los tipos `AnimalExportRecord`, `SigsaTxtOptions`, `ExportValidationResult`, `PendingAnimalInfo`. Cubre: (tipos de soporte para todo el bloque C/D).

- [ ] **T9** — Crear `app/src/services/sigsa/sigsa-txt-generator.ts` como módulo **puro** (sin I/O, sin efectos, sin imports de PowerSync/Supabase). Implementar `generateSigsaTxt(records, options)` que produce `{RFID}-{SEXO}-{RAZA}-{MM/AAAA}` por registro, separados por `;`. Parámetro `trailingSemicolon: boolean` (default `false`). Mes en 2 dígitos (`08` no `8`). Cubre: R5.1, R5.2, R5.4, R5.5, R5.6, R6.1, R6.2, R6.3, R6.4, R6.5.

  **Tests**: (a) un animal `{rfid: '032010000000000', sex: 'M', breedCode: 'H', birthMonthYear: '08/2025'}` genera `032010000000000-M-H-08/2025`; (b) dos animales se separan con `;` sin trailing; (c) con `trailingSemicolon: true` el string termina en `;`; (d) mes `1` se formatea como `01`; (e) el módulo lanza si `rfid` no tiene 15 dígitos numéricos; (f) el módulo lanza si `breedCode` está vacío; (g) output es UTF-8 sin BOM (verificar que no hay `﻿`).

- [ ] **T10** — Crear `app/src/services/sigsa/sigsa-validator.ts` que implemente la validación pre-export: separa `AnimalExportRecord[]` en `exportable` y `incomplete` con el campo faltante por animal. Cubre: R8.1, R8.2, R8.3, R8.6.

  **Tests**: (a) animal con `tag_electronic = null` queda en `incomplete` con razón `'missing_rfid'`; (b) animal con RFID de 14 dígitos queda en `incomplete` con razón `'invalid_rfid'`; (c) animal con RFID de 15 dígitos numéricos pasa; (d) RFID con letras queda en `incomplete`; (e) animal con `birth_date = null` queda en `incomplete` con razón `'missing_birth_date'`; (f) animal con `breed_id = null` queda en `incomplete` con razón `'missing_breed'`; (g) animal que pasa las 3 validaciones queda en `exportable`.

---

## Bloque D — Servicio de export + persistencia

- [ ] **T11** — Crear `app/src/services/sigsa/sigsa-export-service.ts` que implemente:
  - `queryPendingAnimals(establishmentId, filters)`: query al SQLite local (PowerSync) para obtener animales pendientes con RFID + breed_id + birth_date. Aplicar filtros de rodeo y fecha si presentes.
  - `saveAndShare(content, fileName)`: escribir TXT a sistema de archivos (`expo-file-system`) y abrir share sheet (`expo-sharing`).
  - `persistDeclarations(animals, exportLogEntry, establishmentId)`: insertar en `export_log` (1 fila) y en `sigsa_declarations` (N filas) vía PowerSync.
  Cubre: R4.3, R5.3, R5.4, R9.1, R9.2, R9.3, R9.4, R11.1, R11.2, R13.1, R14.1, R14.2. *(R10.3 removida: diferida a post-MVP en el veto del leader.)*

  **Tests**: (a) `queryPendingAnimals` no incluye animales ya en `sigsa_declarations` para ese establishment; (b) `queryPendingAnimals` no incluye animales con `tag_electronic IS NULL`; (c) filtro por `rodeo_id` funciona; (d) filtro por rango de fechas funciona; (e) animales con `status != 'active'` no aparecen en pendientes; (f) `persistDeclarations` inserta exactamente 1 fila en `export_log` y N filas en `sigsa_declarations` donde N = cantidad de animales exportados; (g) usuario con rol `field_operator` que llama a `persistDeclarations` recibe error (RLS lo rechaza).

- [ ] **T12** — Crear `app/src/hooks/useExportSigsa.ts` que orqueste: (1) cargar pendientes, (2) validar, (3) generar TXT, (4) share, (5) persistir. Exponer estado: `pendingAnimals`, `exportableCount`, `incompleteAnimals`, `isGenerating`, `lastExport`. Cubre: R8.4, R8.5, R9.5, R10.1.

  **Tests**: (a) cuando no hay animales exportables, `exportableCount = 0` y el botón de export está deshabilitado; (b) cuando todos los animales fallan validación, `generateExport()` retorna error accionable; (c) re-descarga de un export previo no crea nuevas filas en `sigsa_declarations`.

---

## Bloque E — UX / pantallas

- [ ] **T13** — Crear `app/src/components/sigsa/BreedPicker.tsx`: selector de raza del `breed_catalog`. Ordenado por `sort_order`. Muestra código SENASA + nombre. Acepta `null` (sin raza). Cuando el animal tiene `breed` texto libre sin `breed_id`, muestra badge "Completar para SIGSA". Cubre: R1.4 (UX de completar breed_id), R8.3.

  **Tests**: (a) picker muestra 28 razas bovinas activas; (b) seleccionar una raza setea `breed_id`; (c) acepta selección de `null` (sin raza).

- [ ] **T14** — Crear `app/src/components/sigsa/SigsaChecklistReminder.tsx`: modal/banner con los 4 datos del checklist (RENSPA, especie, fecha de aplicación, motivo). Si hay `renspa` guardado, pre-popularlo en el ítem 1 con un badge. Incluir nota del plazo de 10 días hábiles. Cubre: R13.2, R13.3, R13.4.

- [ ] **T15** — Crear `app/src/components/sigsa/ExportAnimalRow.tsx`: fila de animal en la lista de export. Muestra: TAG (primeros 6 y últimos 4 dígitos del RFID), categoría, rodeo, badge "✓ declarado" si ya está en `sigsa_declarations`. Si el animal está en "a completar", muestra icono de advertencia + dato faltante. Cubre: R12.1, R12.3.

- [ ] **T16** — Crear `app/src/screens/sigsa/ExportSigsaScreen.tsx`: pantalla principal. Secciones: (1) filtros (rodeo, rango de fechas), (2) lista de animales con tabs "Listos" / "A completar", (3) botón "Exportar N animales" (deshabilitado si `exportableCount = 0`), (4) tab/botón "Historial". Roles `field_operator` no acceden a esta pantalla (guard de rol). Cubre: R7.1, R7.2, R7.3, R9.1, R9.2, R9.3, R9.4, R9.5, R12.1, R12.2.

  **Tests de integración**: (a) usuario `field_operator` ve la pantalla bloqueada o no la ve en navegación; (b) lista "Listos" solo muestra animales que pasan la validación; (c) lista "A completar" muestra animales con datos faltantes; (d) botón "Exportar" llama a `generateExport()` y abre share sheet; (e) historial muestra entradas de `export_log` ordenadas por `generated_at DESC`.

- [ ] **T17** — Agregar CTA/aviso de RENSPA en la pantalla de configuración del establecimiento: si `renspa` es `NULL`, mostrar banner "Completá tu RENSPA para facilitar la exportación SIGSA" con botón de acción. Cubre: R2.1, R2.3, R13.3.

- [ ] **T18** — Integrar `BreedPicker` en el form de alta/edición de animal (pantalla del animal, spec 02/09). Cuando se edita un animal sin `breed_id`, mostrar el picker con la raza actual (texto libre) como sugerencia. Cubre: R1.4, R1.5 (vía UX de completar).

---

## Bloque F — Marcado manual + re-export

- [ ] **T19** — Implementar `markAsDeclared(animalProfileId, establishmentId)` en `SigsaExportService`: crea fila en `sigsa_declarations` sin `export_log_id` (para declaraciones hechas por otros medios). Cubre: R10.2.

  **Tests**: (a) el animal marcado manualmente desaparece de la lista de pendientes; (b) la fila tiene `export_log_id = NULL`; (c) un usuario con rol `field_operator` que llama a `markAsDeclared` recibe error (RLS rechaza el INSERT con 42501) (MEDIUM-3).

- [ ] **T20** — Implementar re-descarga de export previo en `SigsaExportService.redownload(exportLogId)`: lee `file_content` de `export_log` del SQLite local y llama al share sheet. No crea nuevas `sigsa_declarations`. Cubre: R10.1.

  **Tests**: (a) re-descarga produce exactamente el mismo contenido que el original; (b) no inserta nuevas filas en `sigsa_declarations`.

---

## Notas de trazabilidad

| R | Tasks |
|---|---|
| R1.1, R1.2, R1.3 | T1 |
| R1.4, R1.5, R1.7 | T2, T18 |
| R1.6 | T3 |
| R1.8 | T7 |
| R2.1, R2.2, R2.3 | T4, T17 |
| R2.4 | T9 (el generador no incluye RENSPA) |
| R3.1–R3.5 | T5 |
| R3.6 | T5 (test h — trigger declared_by) |
| R3.7 | T5 (test i — IDOR check) |
| R4.1–R4.3 | T6, T11 |
| R4.4 | T6 (test h — trigger generated_by) |
| R5.1–R5.6 | T9 |
| R6.1–R6.5 | T9 |
| R7.1–R7.3 | T16 |
| R8.1–R8.6 | T10, T12 |
| R9.1–R9.5 | T11, T12, T16 |
| R10.1 | T20 |
| R10.2 | T19 |
| R10.3 | (diferida post-MVP — veto del leader) |
| R11.1–R11.3 | T5, T6 |
| R12.1–R12.3 | T15, T16 |
| R13.1–R13.4 | T11, T14 |
| R14.1–R14.3 | T7, T11 |
| R14.2 (sync scope) | T7 (test d — scope PowerSync) |
| R15.1–R15.3 | T5, T6, T7 |
