baseline_commit: a25e21f40984b5bc7b829e917f78e37038bf931e

# impl — Delta VINCULAR LA CRÍA AL PIE (#15) — spec 02, Nivel B

**Alcance de ESTE run (implementer):** BACKEND + plumbing offline. **NO** el frontend del prompt
(`LinkCalfPrompt.tsx`/`crear-animal.tsx`/E2E) — eso es un run aparte. Tasks cubiertas acá:
T1, T2, T3, T4 (migraciones), T5–T10 (suite backend no-bypass), T11, T12, T13 (servicios + outbox +
upload), y T20-parcial (clasificación `permanent_reject` del link, unit). T14–T19, T21 quedan para el
run de frontend.

⚠️ **Las migraciones NO se aplican desde acá** — las aplica el LEADER por Supabase MCP (Raf autorizó el
deploy). Las suites backend nuevas FALLAN con `PGRST202` hasta que el leader aplique — ESPERADO.

## Plan (tasks de este run)
- [x] T1 — `0114_link_calf_to_mother_rpc.sql` (RPC nuevo, 8 guards a→h + folds Gate 1)
- [x] T2 — cierre 0114: revoke/grant + smoke-check fail-closed + sin INSERT policy en birth_calves
- [x] T3 — `0115_register_birth_calf_rodeo.sql` (DROP+CREATE, p_calf_rodeo_id + folds LOW-1/2/3)
- [x] T4 — cierre 0115: revoke/grant firma nueva + notify
- [x] T5–T10 — suite backend no-bypass (`supabase/tests/animal/run.cjs`)
- [x] T11 — `enqueueLinkCalfToMother` (outbox) + test de shape
- [x] T12 — `link_calf_to_mother` en upload.ts (RPC_OP_TYPES + p_client_op_id + idempotent_discard 23505) + tests
- [x] T13 — `linkCalfToMother` + extensión `registerBirth`/`RegisterBirthInput` (calfRodeoId/calfIdv)
- [x] T20-parcial — clasificación del rechazo de link (unit)

## Mapa RCAP.<n> → archivo:test

| RCAP | Archivo | Test / evidencia |
|------|---------|------------------|
| RCAP.6.1–6.10 | `0114_link_calf_to_mother_rpc.sql` | T5–T9 (`animal/run.cjs`) |
| RCAP.7.1–7.7 | `0115` + `0116_register_birth_breed_id_fix.sql` | T10 (`animal/run.cjs`) + SIGSA T3 R1.7 |
| RCAP.8.1 | `outbox.ts` (`enqueueLinkCalfToMother`) | `outbox` unit (shape intent/overlay) |
| RCAP.8.2/8.3 | `upload.ts` (`RPC_OP_TYPES` + `p_client_op_id`) | `upload.test.ts` (`mapIntentToRpc`) |
| RCAP.8.5 | `upload.ts` (idempotent_discard 23505) | `upload.test.ts` (clasificación) |
| RCAP.3.1/3.2/4.3 | `events.ts` (`linkCalfToMother` + `RegisterBirthInput.calfRodeoId`) | unit `events`/`local-reads` |

**Fase E/F (frontend prompt + E2E)** quedan para el run de frontend: T14–T19, T21, T20-restante.

