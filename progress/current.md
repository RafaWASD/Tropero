# Sesión actual

> Este archivo se vacía al cerrar cada sesión y su resumen se mueve a `history.md`.
> Mientras trabajás, **mantenelo actualizado en tiempo real**, no al final.

## Sesión 20 — bloque backend spec 02 (delta s17/s18) (2026-05-30)

Raf pivotea del track de diseño (s19, canonización pausada → `plan.md` A.1) al **bloque backend de spec 02**: el conjunto de cambios al backend (ya `done`, migrations 0013-0042) que se desprende de los refinamientos de Gate 0 + audits de s17/s18. Es un **bloque**, no un incremento acotado.

### Decomposición del bloque (lo que toca el backend de spec 02)
**Tier 1 — listo, sin dependencia externa:**
- `created_by` en `animal_profiles` (+ trigger BEFORE INSERT default `auth.uid()`). Confirmado: falta.
- `exit_reason` text → enum (`sale|death|transfer|culling|theft|other`).
- Tabla puente `birth_calves` (1 parto → N terneros) + `compute_category` cuenta **partos distintos** (no terneros) + trigger de alta de ternero (0032) soporta N terneros.
- Trigger de **recálculo de categoría** al editar/borrar un evento tipado que disparó transición (R6.14), si no hay override.
- **R4.5.1 relajada**: permitir cambio de `rodeo_id` **dentro del mismo sistema** (validación en trigger).

**Tier 2 — listo con default, Facundo confirma el target:**
- Rama de **destete** (`weaning`): ternero→torito, ternera→vaquillona (R7.8, target propuesto).
- Rama de **aborto** (`abortion`): `vaquillona_prenada` → `vaquillona` (único estado "preñada" en cría; revierte + compute_category deja de contar preñez).

**Tier 3 — BLOQUEADO (Facundo / research):**
- **Castración**: data_key `castracion` (se puede sembrar) + **efecto de categoría** (¿agregar `novillo`? ¿solo sanitario?) → Facundo.
- **Catálogo de razas SENASA** + migración de `breed` (texto→FK, incl. `reproductive_events.breed` + ternero hereda de la madre): bloqueado por la **tabla de códigos de raza** (manual SIGSA = PDF de imágenes, no extraíble) + lista de razas relevantes → Facundo.

**FUERA de este bloque (features propias):**
- **Transferencia re-parenting** (R4.11→MVP + RPC atómico) = **feature 11**, su propia spec + **Gate 1**.
- `renspa` en establishments = delta de **spec 01**. Marcador SIGSA = impl de **feature 08**.

### Plan de pipeline SDD para el bloque (a confirmar arranque)
1. `spec_author` folda Tier 1 + Tier 2 en spec 02 requirements+design (Tier 3 como TENTATIVO/TODO).
2. **Gate 1** (security_analyzer modo `spec`) — el bloque toca schema + triggers + RLS (schema-sensitive, ADR-019).
3. `implementer` — migrations 0043+ + tests (suite animal).
4. `reviewer`.
5. **Gate 2** (security_analyzer modo `code`) — siempre.
6. ⏸ Raf aprueba final.

### En curso / próximo
- **DECIDIDO (Raf, 2026-05-30): SOLO Tier 1 ahora.** Tier 2 (ramas aborto/destete) y Tier 3 (castración, razas) → se ven con Facundo. No se asumen los targets de transición.
- **Tier 1 a implementar**: `created_by` en `animal_profiles` · `exit_reason` text→enum · `birth_calves` + conteo de partos en `compute_category` + trigger de ternero N-terneros · trigger de recálculo de categoría al editar/borrar evento (R6.14) · R4.5.1 relajada (rodeo mismo-sistema).
- **Pipeline (estado real)**: ✅ `spec_author` foldeó Tier 1 en req (R4.1 `created_by`, R4.5.1 mismo-sistema, Changelog s20) + design (SQL de migrations 0043-0047). ✅ **Gate 1** corrió: **FAIL** (2 HIGH + 2 MEDIUM, misma clase que SEC-HIGH-01) → `spec_author` endureció (guarda `has_role_in` en `exit_animal_profile`, RPC `register_birth` con SQL firme + grant acotado, `created_by` forzado server-side, `birth_calves` select-only + filtro `deleted_at`) + T2.19 (6 no-bypass) → **Gate 1 re-audit PASS**. Reporte en `progress/security_spec_02-modelo-animal.md`. L1 (deuda `soft_delete_event`) → backlog. ✅ **`implementer` corrió** (Tier 1 backend): migrations **0043-0049** aplicadas a remoto (`migration list` Local=Remote=0001..0049), suite animal **19 → 28** verde (T2.19: 6 no-bypass + L2 + R4.5.1 + control de rollback atómico), `check.mjs` verde. Feature 02 pasó a `in_progress`. 3 desviaciones mecánicas documentadas en `progress/impl_02-tier1-backend.md` (birth_calves mono se puebla en AFTER INSERT por el FK; grant a service_role; compute_category re-emitida idempotente). ✅ `reviewer` **APPROVED** (`progress/review_02-tier1-backend.md`; 2 obs no-bloqueantes O1/O2). ✅ **Gate 2 PASS** (`progress/security_code_02-tier1-backend.md`; R1-NEW + R2-NEW cerradas y probadas con tests de estado reales, 0 findings HIGH). **⏸ AHORA: puerta humana FINAL — Raf aprueba el cierre del Tier 1.** Pendiente de commit (Raf decide); ver O1/O2 abajo.

**Pendientes abiertas (orden en `plan.md`):**
- **Canonización del design system** (A.1) — pausada al pivotar; retomar para destrabar el resto del frontend. **Decisiones tomadas s19 (Raf), aplicar al retomar**: (1) **light-only** para MVP, dark diferido post-MVP; (2) `docs/design-system.md` + `design/tokens.json` actuales describen el sistema viejo **"Campo Profundo"** (cream/dark, otro chat, NO canónico) → **archivar como exploración** (mover a `design/explorations/`, rescatar su guía de componentes/a11y/tipografía JIT) y reescribir `docs/design-system.md` como el **v4 vivo** (blanco neutro / verde botella `#1e5a3e` / bone `#F8F6F1` / terracota `#c84a2c`, derivado del build per ADR-023). Colores de estado (success/warning/error) → JIT cuando la 1ª pantalla con chips los necesite.
- **Verificación dura 08**: formato EXACTO de SIGSA con upload real (Raf/Facundo).
- **Día de campo**: hardware de 04 (UUIDs Allflex RS420) + 05 entera.
- **Items para Facundo** (`CONTEXT/07`): categoría destino del aborto · efecto de castración (¿"novillo"?) · marca-en-madre al destetar · razas SENASA · seed de cría.

_Última cerrada: sesión 19 — cierre P0 design (nav firmado + skill design-review) (2026-05-30). Ver `history.md`._

## Estado del proyecto (al 2026-05-30)

- **Backend `02-modelo-animal` DONE** (sesión 15): migrations 0013-0042 + suite animal 19/19 + reviewer APPROVED + Gate 2 PASS. **Se reabre un BLOQUE** por el delta s17/s18 (ver sesión 20). No hay feature `in_progress` ahora.
- **`deferred`:** `01-identity-multitenancy` (backend done + tests; frontend en curso vía la home) · `02-modelo-animal` (backend done; frontend Fase 3+ pausado) · `09-buscar-animal` (spec aprobada + auditada s18; esperando turno).
- **`context_ready`:** `03-modo-maniobras` (refinado s15 + audit s18) · `08-export-sigsa` · `04-bluetooth-baston` (parcial, hardware bloqueante) · **`10-operaciones-rodeo`** (nueva, aprobada s18) · **`11-transferencia-animal`** (nueva, aprobada s18, Gate 1).
- **`pending`:** `05-bluetooth-balanza` (día de campo) · `06-import-laboratorios` (archivos CEDIVE reales) · `07-reportes-basicos` (uso real).
- **ADRs:** último cerrado ADR-023 (workflow diseño). Próximo libre: **ADR-024**.
- **Bloque A del plan (P0 design):** A.2 (nav → ADR-018) **`done` + firmado**; A.1 (design system) **en canonización, pausada**; A.3–A.7 `done`.

## Notas técnicas vigentes para el implementer

- En PowerShell usar `pnpm.cmd` (no `pnpm`) — Cylance Script Control bloquea `.ps1`.
- **Node ≥20.19.4 REQUERIDO** para el dev server de Expo (`expo start` corta con Node viejo; `check.mjs` igual corre). Raf en 24.16.0 vía nvm-windows.
- **Device real bloqueado**: Expo Go SDK 56 no está en tiendas → iterar diseño por **web** (`pnpm.cmd web`); veredicto final en device = dev-build propio más adelante.
- **Preview fiel del leader = CDP `Emulation.setDeviceMetricsOverride`** (NO `--window-size`, da falso recorte). Tubería en la skill `design-review`. Matar los `http.server`/Chrome headless al terminar.
- En migrations: `GRANT` explícito a `authenticated` siempre — Auto-expose new tables está OFF.
- Tests RLS/Edge/animal en Node nativo, no pgTAP/deno (Docker bloqueado). Corre todo `scripts/run-tests.mjs`.
- RLS-on-RETURNING gotcha: el cliente NO debe usar `.insert().select()` en un solo roundtrip; split insert + select.
- Migrations del bloque backend 02 arrancan en **0043+** (0013-0042 ya aplicadas).
- **Nav (ADR-018)**: el FAB central elevado usa un `tabBarButton` custom en Expo Router. Stub navegable hasta implementar spec 03.
