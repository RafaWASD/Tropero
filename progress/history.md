# Bitácora histórica (append-only)

> Cada vez que se cierra una sesión, su resumen se agrega acá.
> No editar entradas anteriores. Solo agregar al final.

---

## 2026-05-24 — Setup del harness RAFAQ

- **Agente:** claude (sesión bootstrap, sin agentes formales todavía).
- **Plan:** crear estructura completa del harness adaptado a RAFAQ (stack RN+Expo+TS+Supabase, sin PowerShell por Cylance).
- **Cambios:**
  - `CLAUDE.md` fusionado con sección "Rol obligatorio: leader" al principio.
  - `AGENTS.md`, `CHECKPOINTS.md`, `docs/architecture.md`, `docs/conventions.md`, `docs/verification.md` creados.
  - `docs/specs.md` reescrito (era legacy del proyecto Java original).
  - 4 agentes en `.claude/agents/` (leader, spec_author, implementer, reviewer con checklist RAFAQ-específico de 5 secciones: RLS, offline, BLE, UI campo, Edge Functions).
  - `scripts/check.mjs` (reemplaza `init.ps1`).
  - `.claude/settings.json` con hook `Stop` apuntando a `node scripts/check.mjs`.
  - `feature_list.json` con 8 features del roadmap; id=1 en `spec_ready` (ya tenía spec escrito en sesión previa).
  - `progress/current.md` plantilla vacía; este `history.md` con entrada inicial.
  - `HARNESS_BLUEPRINT.md` reducido a pointer hacia los archivos reales.
- **Verificación:** `node scripts/check.mjs` esperado en verde (bootstrap mode, sin tests todavía).
- **Cierre:** harness operativo. Próximo paso: humano aprueba spec de feature 1 (`01-identity-multitenancy`), leader la pasa a `in_progress`, implementer la empieza cuando exista entorno Expo + Supabase configurado.
