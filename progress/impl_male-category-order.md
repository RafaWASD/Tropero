# impl — Reorder categorías MACHO del alta (Nivel A, ADR-028)

baseline_commit: (post #16, `0841ffb` + docs)

**Cambio CHICO (Nivel A — sin delta-spec).** Decisión de Raf (2026-07-03): reordenar las categorías macho del alta del sistema cría a **Ternero → Torito → Toro → Novillito → Novillo** (rama entera/reproductiva primero, después castrada/invernada; edad joven→adulto dentro de cada rama). El orden previo (Ternero → Toro → Torito → Novillito → Novillo) era un accidente del `sort_order` de siembra.

## Qué se hizo
- **`supabase/migrations/0120_male_category_order.sql`**: `UPDATE categories_by_system SET sort_order` para torito=91 / toro=92 / novillito=93 / novillo=94 (ternero queda 10, primero, sin cambio). Scopeado al sistema **cría** vía CTE join-by-code (`systems_by_species`/`species`, codes bovino/cria — NO UUID hardcodeado, robusto ante reset). No toca HEMBRAS (20-80, no aparecen en el picker de macho) ni otros sistemas. Idempotente (UPDATE por system_id+code).
- **Frontend**: SIN cambios — el picker ya ordena por `sort_order ASC` (`local-reads.ts:113`).

## Verificación (leader)
- **Veto de SQL**: el CTE resuelve el system_id de cría (`7babeff4-...`, `matches_expected=true`, 4 codes macho) — verificado contra el remoto ANTES de aplicar.
- **Aplicada por el leader por MCP** (`male_category_order_0120`, deploy autorizado).
- **Orden post-apply (query al remoto)**: Ternero(10) → Torito(91) → Toro(92) → Novillito(93) → Novillo(94) ✓ = Opción A.
- Gate 2.5: **capture N/A** (cambio de dato-config puro, sin código de UI; el picker ordena determinísticamente por `sort_order` → la data verificada ES el orden). Se puede generar un screenshot del picker on-demand.

## Recuperación de agente muerto
El implementer murió (API ConnectionRefused) tras escribir el `0120`; no alcanzó el capture ni este reporte. El leader recuperó el `.sql`, lo vetó contra el remoto, lo aplicó, y verificó el orden. (Lección `reference_crashed_agent_recovery`: verificar contra el as-built real.)
