# HARNESS_BLUEPRINT.md

> **Este archivo es histórico.** El blueprint genérico (Java/React, PowerShell, etc.) fue reemplazado por una implementación nativa de RAFAQ adaptada al stack (RN + Expo + TS + Supabase + PowerSync + BLE) y al entorno (Windows con Cylance bloqueando PS).

## Dónde vive el harness real

| Archivo | Contiene |
|---|---|
| `CLAUDE.md` | Rol leader + contexto de producto + principios |
| `AGENTS.md` | Mapa de navegación del repo |
| `.claude/agents/leader.md` | Orquestador |
| `.claude/agents/spec_author.md` | Redactor de specs Kiro-style |
| `.claude/agents/implementer.md` | Implementador con tests |
| `.claude/agents/reviewer.md` | Revisor con checklist RAFAQ (RLS, offline, BLE, UI campo, Edge Functions) |
| `.claude/settings.json` | Hooks (Stop → `node scripts/check.mjs`) |
| `docs/specs.md` | Proceso SDD (EARS, puerta humana, trazabilidad) |
| `docs/architecture.md` | Capas del cliente + backend + principios |
| `docs/conventions.md` | Estilo, naming, errores |
| `docs/verification.md` | Niveles de tests + comandos del stack |
| `CHECKPOINTS.md` | Criterios de cierre (C1–C8, incluye C7 multi-tenant y C8 offline-first) |
| `scripts/check.mjs` | Validador Node (reemplaza `init.ps1`) |
| `feature_list.json` | Backlog + máquina de estados |
| `progress/current.md` | Bitácora viva de la sesión actual |
| `progress/history.md` | Bitácora append-only de sesiones cerradas |
| `.harness/config.json` | Config del check (testCommand). Se crea cuando arranca el código. |

## Si querés portarlo a otro proyecto

Leé esos archivos directamente. Si necesitás una versión genérica/portable, extraela en ese momento desde la implementación real — va a ser más fiel que un meta-doc abstracto.
