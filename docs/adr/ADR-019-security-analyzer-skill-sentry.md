# ADR-019 — Security analyzer como 5to subagente + skill getsentry/security-review

**Status**: Accepted
**Fecha**: 2026-05-27
**Decisores**: Raf, con análisis comparativo del leader

## Contexto

RAFAQ tiene superficie de ataque real: multi-tenant + RLS de Postgres + Edge Functions de Supabase + auth con invitaciones por link bearer (ADR-014) + datos personales y de SENASA + sync offline con PowerSync + integración BLE. Hasta esta decisión, el flujo SDD del proyecto (ADR-001) tenía 4 subagentes — `leader`, `spec_author`, `implementer`, `reviewer` — donde el reviewer cubría calidad funcional + checklist específico de RAFAQ (RLS, offline, BLE, UI campo, Edge Functions) pero **no había un agente especializado en análisis de seguridad** con metodología propia.

El riesgo concreto que se quería mitigar: que una decisión de RLS mal diseñada en una spec, o una Edge Function con validación de input débil, o un endpoint con secrets mal manejados, pase la revisión por estar dentro de "lo que funciona" sin ser explícitamente revisado por un ángulo de seguridad.

Durante una sesión de investigación de skills de Claude Code disponibles para análisis de seguridad, se evaluaron 5 alternativas: Cyber Neo (Hainrixz), agamm/claude-code-owasp, Security-Phoenix-demo/security-skills-claude-code, mahmutka/cybersecurity-claude-skills, getsentry/skills@security-review. Adicionalmente, Claude Code provee `/security-review` built-in de Anthropic como capacidad mínima.

El criterio de decisión fue: madurez del repo + metodología (no checklist) + reducción de false positives + read-only por diseño + reference files extensos + maintainer establecido.

## Decisión

**Adoptar dos cambios en simultáneo**:

### 1. Skill: `getsentry/skills@security-review`

Skill open source mantenida por Sentry (Apache-2.0). Características que la diferencian:

- **Sistema de confianza** que clasifica findings en HIGH (vulnerable pattern + attacker-controlled input confirmado), MEDIUM (patrón encontrado pero source de input incierto), LOW (teórico/best-practice). **Solo HIGH se reporta**. Reduce ruido drásticamente vs checklists genéricos.
- **Metodología de tracing**: traza data flow + verifica upstream validation + verifica exploitability ANTES de reportar. No reporta "esto se ve sospechoso", reporta "esto es exploitable porque X".
- **False-positive awareness real**: distingue framework auto-escape (Django templates), input controlado por server (Django settings vs request.POST), parameterized queries vs concatenación.
- **27 reference files**: 17 vulnerabilidades específicas (injection, XSS, SSRF, CSRF, auth, crypto, etc.) + 5 lenguajes (Python, JavaScript, Go, Rust, Java) + 5 infraestructura (Docker, Kubernetes).
- **Output estructurado**: VULN-001/VERIFY-001 con file:line + confidence + evidence snippet + fix recomendado.
- **Read-only enforced**: `allowed-tools: Read, Grep, Glob, Bash, Task` — bajo riesgo de daño.

Plugin instalado a nivel user vía `claude plugin install sentry-skills@sentry-skills` (marketplace `getsentry/skills`).

### 2. Subagente nuevo: `security_analyzer`

Quinto subagente del flujo SDD, definido en `.claude/agents/security_analyzer.md`. Tools heredados: `Read, Glob, Grep, Bash, Skill` (este último para invocar `security-review` de Sentry).

El subagente opera en **dos modos** según invocación:

- **Modo `spec`**: revisa `specs/active/<feature>/{requirements,design,tasks}.md` por decisiones de seguridad inadecuadas a nivel diseño. Foco: RLS coverage, schema con datos sensibles, secrets handling en Edge Functions, audit trail, multi-tenant isolation, sanitización en bordes (input validation), exposición de PII.
- **Modo `code`**: invoca la skill `security-review` de Sentry sobre el diff del branch actual. Foco: HIGH-confidence findings sobre los archivos modificados por el implementer.

### 3. Dos gates condicionales en el flujo SDD

El `leader` incorpora dos gates de security review:

```
spec_author → spec_ready
              ↓
       [security_analyzer modo `spec`] ← Gate 1 (CONDICIONAL)
              ↓
       ⏸ APROBACIÓN HUMANA
              ↓
       implementer → reviewer
              ↓
       [security_analyzer modo `code`] ← Gate 2 (SIEMPRE)
              ↓
       ⏸ APROBACIÓN HUMANA FINAL
              ↓
       done
```

**Gate 1 (spec security review) — Condicional**. Se invoca cuando la spec toca **cualquiera** de estos dominios:
- Schema de DB con `establishment_id` o datos personales / sensibles.
- RLS policies nuevas o modificadas.
- Edge Functions de Supabase.
- Manejo de auth, sessions, tokens, secrets.
- Endpoints expuestos públicamente.
- Datos regulados (SENASA, PII).

Para specs puramente UI sin datos nuevos (ej: refactor de pantalla), Gate 1 se saltea con justificación documentada en `progress/current.md`.

**Gate 2 (code security review) — Siempre**. Se invoca tras la aprobación del `reviewer` y antes de presentar al humano para aprobación final. Si el `security_analyzer` reporta findings HIGH, el flujo vuelve a `implementer` con los findings como input para fix. Si no hay HIGH, sigue a aprobación humana.

## Alternativas consideradas

### Cyber Neo (Hainrixz/cyber-neo)
- **Pros**: cubre más dominios (CI/CD, secrets con 60+ regex, supply chain), 11 dominios, scan paralelo con 5 subagentes.
- **Contras**: proyecto MUY verde (2 commits, v0.1.0, autor individual + comunidad Instagram), reporta todo sin sistema de confianza, methodology de checklist. Snyk ToxicSkills research detectó prompt injection en 36% de skills comunitarias — cyber-neo específicamente mitiga eso con read-only + std library only, pero el ecosistema general tiene supply-chain risk real.
- **Razón de descarte**: madurez insuficiente vs Sentry; sin sistema de confianza genera ruido vs señal.

### `/security-review` built-in de Anthropic
- **Pros**: viene de fábrica, mantenido por Anthropic, cero superficie de prompt injection comunitaria.
- **Contras**: opera sobre branch actual, sin reference files extensos, sin metodología documentada de tracing, sin sistema de confianza HIGH/MEDIUM/LOW.
- **Razón de descarte como única opción**: complementa pero no reemplaza Sentry. **Se mantiene disponible** para uso ad-hoc del humano antes de commits significativos; Sentry es el gate sistemático.

### agamm/claude-code-owasp
- **Pros**: ~17KB de cheat sheets compactos OWASP 2025 + ASVS 5.0 + Agentic AI security + 20+ language-specific security quirks. Se activa cuando Claude escribe/revisa código.
- **Contras**: orientada a "elevar el piso de calidad al escribir", no a auditoría posterior. Sin sistema de confianza. No reemplaza la auditoría como gate.
- **Razón de descarte como skill principal**: complementaria. Puede sumarse en el futuro como skill always-on para el implementer si el ruido inicial es aceptable.

### Security-Phoenix-demo, mahmutka, transilienceai, nobrainer-tech
- **Pros**: cada una con su nicho (pentest, DevSecOps, hardening).
- **Contras**: ninguna tiene la combinación de Sentry (sistema de confianza + methodology + maintainer establecido + 221 commits + reference files extensos).
- **Razón de descarte**: no superan a Sentry en el delta combinado.

### Patrón B — Skill invocada por cualquier agente (sin subagente nuevo)
- **Pros**: simplicidad, sin nuevo subagente que mantener.
- **Contras**: depende de que cada agente "se acuerde" de invocar la skill. Sin gates duros, no hay garantía sistémica.
- **Razón de descarte**: gates duros son la razón por la que el SDD funciona en este proyecto. Sumar security sin gates duros sería inconsistente.

### Patrón C — Hook automático (PostToolUse en settings.json)
- **Pros**: cero olvidos, dispara después de cada Edit/Write.
- **Contras**: ruido constante en código a medio escribir, gasto de tokens alto, false positives en commits intermedios.
- **Razón de descarte**: viola el principio de "señal > ruido". Gates en puntos específicos del flujo son superiores a hooks indiscriminados.

### Patrón A — Subagente nuevo + Gate 1 + Gate 2 (variante: ambos siempre)
- **Pros**: máxima cobertura.
- **Contras**: muchas specs no tocan dominios de seguridad (refactor puro de UI, cambios de docs, etc.). Correr Gate 1 sobre todas suma overhead sin valor proporcional.
- **Razón de ajuste**: se eligió **Patrón D** (Gate 1 condicional, Gate 2 siempre) — más eficiente sin sacrificar cobertura real.

## Consecuencias

### Positivas

- **Cobertura sistemática de seguridad en el flujo SDD**: lo que antes dependía de que el reviewer recordara un checklist genérico, ahora es un subagente especializado con metodología propia.
- **Reducción de false positives**: el sistema HIGH/MEDIUM/LOW de Sentry filtra ruido. El humano solo ve findings con evidence concreta.
- **Trazabilidad**: cada feature implementada va a tener un `progress/security_<name>.md` con el output del Gate 2. Auditoría post-hoc disponible.
- **Compatibilidad con SENASA + cumplimiento**: aunque SENASA no exige auditoría automática hoy, tener evidencia de security review en cada feature reduce riesgo si en el futuro se requiere certificación.
- **Skill battle-tested**: Sentry maneja errores y código a escala. La skill se prueba en su propio codebase. Bajo riesgo de bugs catastróficos.
- **Read-only**: la skill no modifica archivos. Bajo riesgo de daño accidental.

### Negativas

- **Costo de tokens sube ~15-25%** por feature implementada. Gate 2 corre security review completo en cada flujo. Mitigación: HIGH-only output es corto.
- **Tiempo de sesión sube ~5-10 minutos** por feature por el gate. Mitigación: el subagente corre en background si se delega correctamente; el humano puede revisar el output cuando esté.
- **Dependencia externa**: si Sentry deja de mantener la skill o cambia el comportamiento entre versiones, el flujo se afecta. Mitigación: pin a un commit/tag específico del repo (no a `main` indiscriminadamente) cuando se considere production-critical.
- **Gaps específicos de RAFAQ**: la skill no tiene guides explícitos de Deno (Edge Functions), Postgres RLS, PowerSync, React Native, BLE. Cobertura indirecta vía guides de Python/JS/Go/Rust/Java. Mitigación: el `security_analyzer` complementa con el checklist RAFAQ del `reviewer` (sección A "tablas con establishment_id" + sección E "Edge Functions"). En el futuro vale evaluar si crear reference files complementarios para los gaps.
- **Curva de aprendizaje**: el equipo (Raf solo por ahora) tiene que entender cómo leer los findings VULN-001/VERIFY-001 y aprender a iterar con el security_analyzer. Primera vez puede ser confuso.
- **No es bala de plata**: las skills de Claude Code no reemplazan revisiones humanas en momentos críticos (pre-prod deploy, exposición pública de endpoint nuevo, auditoría regulatoria). Quedan como complemento.

### Notas de implementación

- Plugin Sentry instalado a nivel user (`scope: user`) en máquina de Raf vía `claude plugin install sentry-skills@sentry-skills`. Otros desarrolladores deben replicar la instalación; documentar en `docs/setup-frontend.md` cuando llegue ese momento.
- `.claude/agents/security_analyzer.md` creado con dos modos explícitos.
- `.claude/agents/leader.md` actualizado para incluir los gates.
- `AGENTS.md` actualizado: mapa del repositorio con security_analyzer + flujo SDD con gates.
- `docs/specs.md` actualizado: diagrama de estados con gates intercalados.
- Output del Gate 1 (cuando aplica): `progress/security_spec_<name>.md`. Output del Gate 2: `progress/security_code_<name>.md`. Patrón consistente con `progress/review_<name>.md` del reviewer existente.
- Cuando se llegue a implementar B.2 (backend spec 02), es la primera prueba real del flujo nuevo con security_analyzer en acción.
- Si en post-MVP surge necesidad de auditoría regulatoria SENASA explícita, este ADR queda como base de evidencia.

### Reversibilidad

Media. Adoptar la skill + crear el subagente + actualizar los agentes existentes son cambios atómicos en archivos del repo, fáciles de revertir vía git. Lo que NO es trivial revertir: las decisiones tomadas con el security review activo (cambios al código que se hicieron por findings del security_analyzer). Si en el futuro se quiere desinstalar la skill, los cambios al código ya están integrados.

**Relacionado**:
- ADR-001 (SDD): este ADR extiende el flujo SDD con 2 gates.
- ADR-014 (invitaciones link bearer): caso de uso típico que el security_analyzer va a auditar (token bearer + expiración + scoping).
- Checklist RAFAQ del `reviewer` (`.claude/agents/reviewer.md` sección A "RLS" + E "Edge Functions"): complementa al security_analyzer en los gaps específicos del proyecto.
