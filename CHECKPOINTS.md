# CHECKPOINTS — Evaluación del estado final

> No se evalúa el camino, se evalúa el destino. El reviewer recorre estos checkpoints para decidir si la sesión puede cerrar.

## C1 — El harness está completo
- [ ] Existen archivos base: `AGENTS.md`, `feature_list.json`, `progress/current.md`, `progress/history.md`.
- [ ] Existen docs: `architecture.md`, `conventions.md`, `verification.md`, `specs.md`.
- [ ] Existen los 5 agentes en `.claude/agents/` (leader, spec_author, implementer, reviewer, security_analyzer).
- [ ] `node scripts/check.mjs` termina con exit code 0.

## C2 — El estado es coherente
- [ ] Como mucho una feature en `in_progress`.
- [ ] Toda feature `done` tiene tests que pasan.
- [ ] `progress/current.md` vacío o describe la sesión activa.

## C3 — El código respeta la arquitectura
- [ ] Solo contiene capas previstas en `architecture.md` (screens, components, contexts, services, hooks, types, utils).
- [ ] No hay dependencias externas no justificadas en `package.json`.
- [ ] Sin logs de debug sueltos, sin TODOs sin contexto.
- [ ] No se hardcodea `establishment_id` en ningún lado.

## C4 — La verificación es real
- [ ] Al menos un test por módulo con lógica.
- [ ] Tests con fixtures reales, no mocks de I/O crítico sin necesidad.
- [ ] El runner muestra > 0 tests y todos verdes.
- [ ] Si la feature toca RLS, hay test de aislamiento cross-tenant.

## C5 — La sesión se cerró bien
- [ ] Sin artefactos temporales sin trackear (`node_modules/`, `.expo/`, `dist/`, `coverage/` en `.gitignore`).
- [ ] `progress/history.md` tiene una entrada por la última sesión.
- [ ] La última feature está en su estado correcto.

## C6 — Spec Driven Development
- [ ] Toda feature `"sdd": true` en `spec_ready`/`in_progress`/`done` tiene `specs/active/<name>/` con los 3 archivos.
- [ ] `requirements.md` usa EARS estricto.
- [ ] Toda feature `done` con `"sdd": true` tiene todas sus tasks `[x]`.
- [ ] Cada `R<n>` cubierto por ≥1 test concreto.

## C7 — Multi-tenant correcto (RAFAQ)
- [ ] Toda tabla nueva con datos de campo tiene `establishment_id` como FK.
- [ ] Toda tabla con `establishment_id` tiene RLS habilitado.
- [ ] Helpers `has_role_in()` / `is_owner_of()` usados consistentemente (no SQL duplicado inline).
- [ ] Test cross-tenant: como user A no puedo leer datos de establishment B.

## C8 — Offline-first (RAFAQ)
- [ ] Toda feature de carga de datos en campo funciona sin conexión.
- [ ] Configurada en bucket de PowerSync correcto.
- [ ] Conflict resolution documentada o usa default explícito (last-write-wins).

## C9 — Verificación E2E + visual (UI, ADR-029)
> Aplica solo a features/deltas con UI. Backend-only → N/A (documentar).
- [ ] La feature tiene suite E2E de regresión (`app/e2e/*.spec.ts`) verde.
- [ ] La feature tiene capture file (`app/e2e/captures/<feature>.capture.ts`) con capturas nombradas de cada estado clave (pantallas/sheets, validación, pickers, avisos, vacío/loading/error).
- [ ] El leader corrió el Gate 2.5 (E2E + capturas + veto visual contra spec + criterios de diseño) y adjuntó las capturas a la Puerta 2.
- [ ] Los `__shots__/*.png` NO están commiteados (solo el `.capture.ts`).

---

**Uso:** el `reviewer` recorre cada checkbox aplicable a la feature, marca `[x]`/`[ ]`, y rechaza el cierre si quedan boxes vacíos en checkpoints aplicables.
