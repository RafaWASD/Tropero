# Sesión actual

> Este archivo se vacía al cerrar cada sesión y su resumen se mueve a `history.md`.
> Mientras trabajás, **mantenelo actualizado en tiempo real**, no al final.

**SESIÓN 2026-06-25 — VERIFICACIÓN POST-DEPLOY DE SPEC 08 + 2 FIXES (fix-loop autónomo).**

**Estado de spec 08:** implementación **100% code-complete y gateada** — DB (0107-0112) + trigger derive-breed_id (**0113**, cierra T18) + PowerSync schema/YAML + servicio + hooks + UI + e2e + veto de diseño. Todos los chunks con reviewer APPROVED + Gate 2 PASS. Las notas de `feature_list.json` que decían "UI/servicio pendiente" eran mid-impl (24/06) y quedaron stale → reconciliadas.

**Gate #1 (deploy del YAML) HECHO** por Raf en el dashboard de PowerSync → las 3 tablas nuevas bajan al SQLite local. Verificado por E2E: `sigsa-export.spec.ts` (path de lectura/download) **verde**.

**La verificación post-deploy cazó + arregló 2 bugs REALES de producto** (E2E `sigsa-breed-renspa.spec.ts`, deterministas, nunca corridos verdes antes — los asserts server-side se agregaron gateados a 0113 sin correr el check):
1. **Pérdida silenciosa de datos en alta-EN-BLANCO**: "Dar de alta tu primer animal" podía llegar al submit con los 3 identificadores vacíos → `create_animal` rechazaba server-side con `23514` (`animal_profiles_identity_check`, 0021) al subir → el animal quedaba solo en el overlay local y **se perdía al sincronizar**. Esto **cierra un gap latente de spec 02 R13.3** (ya exigía el gate cliente, nunca implementado en el alta-en-blanco porque find-or-create siempre precarga un id). FIX: helper puro `hasAtLeastOneIdentifier` (`animal-form.ts`, trim defensivo espejando `nullif(trim())` del server) + bloqueo en `crear-animal.tsx::onSubmit` con error accionable antes de encolar.
2. **Banner RENSPA stale**: `RenspaBanner` (`mas.tsx`) leía el renspa local one-shot al focus; `update_renspa` es RPC online → el valor baja async por la stream `est_establishments` → al volver a "Más" el banner seguía pidiéndolo. FIX: reactivo a `subscribeSyncUiState` (re-lee en cada `statusChanged`, mismo patrón que `ProfileContext`).
   GATES del fix-loop: leader veto PASS + reviewer APPROVED (2 fixes correctos, sin rework) + Gate 2 (security code) PASS 0 HIGH. E2E `sigsa-breed-renspa` 4/4 + `sigsa-export` 6/6 + regresión `animals`+`maniobra-identify` 30/30 + 270 unit + typecheck verde. Specs reconciliadas (spec 02 R13.3 as-built + spec 08 R13.3/design/tasks). Puerta 2 aprobada por Raf.

**Limpieza de orphans (DB compartida, OK de Raf):** 13 `field_definitions` `custom_test_%` (2 globales rompían T2.16 + 11 scoped + dependientes en custom_measurements/attributes/rodeo_data_config) — leak de **mi propia corrida de `check.mjs` interrumpida a los 7 min** (Custom suite spec 03 M5 killeada antes del teardown). Catálogo global vuelto a **27** (canónico; NO era drift → la rec del reviewer de "bumpear a 29" era incorrecta). `pezu` scoped dejado intacto.

**Pendiente del flip a `done` de spec 08** (1 gate EXTERNO, no hay código por hacer):
- **Facundo: upload de formato a SIGSA** (decisión 4, gate duro) → confirma el TXT exacto (¿`;` final? ¿espacios? ¿rango de fechas? validación RFID? mayúsc/minúsc?). ⚠ Confirmar antes si es dry-run o declaración legal firme. El generador es swappable → ajuste en un solo lugar.

**Hecho esta sesión:** huérfano de animal limpiado (arranque) · push confirmado · gate #1 YAML deployado por Raf · 2 fixes post-deploy gateados + Puerta 2 · orphans `custom_test_%` limpiados.

**BACKLOG (higiene de test recurrente):** la **Custom suite (spec 03 M5)** crea `field_definitions` GLOBALES en la DB compartida y los leakea si se interrumpe la corrida → polucionan T2.16 (Animal suite). Conviene teardown idempotente o un guard tipo `cleanup-test-orphan.mjs` para `custom_test_%`. (Mismo patrón que el flake del tag `'9'×64` del Animal suite.) El `check.mjs` completo es sano pero lento (~13 suites contra la DB remota, >7 min) → NO interrumpirlo (deja orphans); correrlo en background hasta el final.
