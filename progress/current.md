# Sesión actual

> Este archivo se vacía al cerrar cada sesión y su resumen se mueve a `history.md`.
> Mientras trabajás, **mantenelo actualizado en tiempo real**, no al final.

_(Sin trabajo en curso — sesión cerrada 2026-06-25. Resumen en `history.md`: "2026-06-24/25 — SPEC 08 EXPORT SIGSA → code-complete + committeada (`9c372a8`), `in_progress` (gated por Facundo)".)_

**Pendiente del flip a `done` de spec 08** (lo único abierto):
1. **Facundo: upload de formato a SIGSA** (decisión 4, gate duro) → confirma el TXT exacto (¿`;` final? ¿espacios? ¿rango de fechas? validación RFID? mayúsc/minúsc?). ⚠ Confirmar antes si es dry-run o declaración legal firme. El generador es swappable → ajuste en un solo lugar.
2. **Limpiar el huérfano de test** → `! node scripts/cleanup-test-orphan.mjs 72735816-867f-472e-a742-b924c408ec95` → restaura `check.mjs` full-verde (hoy rojo SOLO por ese flake del Animal suite, ajeno a spec 08).
3. **Push**: `main` está adelantado de `origin/main` (el commit `9c372a8` + previos, sin pushear).

Backlog menor: el test INPUT-1 del Animal suite (spec 02/13) usa un tag FIJO `'9'×64` → flake recurrente al interrumpir una corrida; conviene que use un tag único por RUN_TAG (fix de 1 línea).
