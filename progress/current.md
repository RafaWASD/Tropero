# Sesión actual

> Este archivo se vacía al cerrar cada sesión y se mueve a `history.md`.
> Mientras trabajás, **mantenelo actualizado en tiempo real**, no al final.

- **Feature en curso:** `01-identity-multitenancy` (sesión 6 — refactor backend a invitaciones link shareable cerrado y aprobado por reviewer)
- **Feature pausada intencionalmente:** `02-modelo-animal` (spec_ready esperando aprobación humana)
- **Inicio sesión:** 2026-05-25
- **Agente activo:** `leader` (cerrando sesión)

## Estado de `01-identity-multitenancy`

- ✅ **Fase 0** (setup) — scaffold Expo + Supabase CLI + Expo Notifications.
- ✅ **Fase 1** (schema + RLS) — 12 migrations aplicadas a remoto (sumó `0012_invitations_email_nullable.sql` en sesión 6) + 15 tests RLS verdes.
- ✅ **Fase 2** (Edge Functions) — 7 funciones desplegadas + 26 tests verdes. Refactor a modelo link shareable (`ADR-014`) en sesión 6: `invite_user`, `accept_invitation`, `resend_invitation` ya no usan email para invitar (Resend sigue solo para R5.10).
- ⏸ **Fases 3-8** (frontend + PowerSync + QA) — pausadas intencionalmente. Raf decidió no avanzar frontend hasta refinar stack (`ADR-013`) y agregar tooling de UX (Figma MCP + Tamagui + etc).

Status en `feature_list.json` queda `in_progress` con `notes` documentando la pausa. Cuando Raf esté listo para frontend, retomamos.

`node scripts/check.mjs` verde con typecheck + 41 tests reales contra DB remota (15 RLS + 26 Edge).

## Estado de `02-modelo-animal` (en curso)

- `spec_author` lanzado para escribir los 3 archivos del spec (requirements + design + tasks).
- Scope: feature completa con identificación flexible (TAG/IDV/visual_id_alt), categorías auto-calculadas, ternero al pie como entidad independiente, ficha cronológica.
- Cuando el spec esté listo (estado `spec_ready`), Raf lo aprueba y decidimos si implementar solo backend (Fase 1-2 equivalente) y diferir frontend, siguiendo el mismo patrón que con 01.

## Bitácora — sesión 1 (refinamiento del spec 01 + Fase 0)

- `2026-05-25` — Refinamiento del spec 01 + aprobación humana. Cerradas 7 preguntas abiertas; sin `user_type`, wizard con CTA dual, teléfono solo al crear campo, notificaciones email + push, sin transferencia de ownership, hard-delete diferido.
- `2026-05-25` — Setup Supabase + intento inicial de `npm install` falla con `Z_DATA_ERROR` (Cylance MITM npm). Raf flaguea preocupación por ataques de cadena de suministro npm. Leader propone migrar a pnpm; Raf aprueba.
- `2026-05-25` — Migración a pnpm: `app/.npmrc` con `node-linker=hoisted`, whitelist `pnpm.onlyBuiltDependencies`. `ADR-011` creado. `pnpm.cmd install` exitoso (466 paquetes en 28s).

## Bitácora — sesión 2 (Fase 0 + Fase 1)

- `2026-05-25` — T0.2 cerrada: scaffold + 10 deps de spec + estructura `app/src/{...}/` + App.tsx splash + helper env.ts.
- `2026-05-25` — T0.3: Supabase CLI 2.101.0 como devDep. `supabase init` + `link` + `db push` end-to-end.
- `2026-05-25` — T0.4 parcial: plugin expo-notifications configurado, helper tipado. Validación con device físico para T3.6.
- `2026-05-25` — Fase 1 completa: 9 migrations base + 2 extras (`0010_grants_fix`, `0011_establishment_auto_owner` trigger). 15 tests RLS verdes en Node nativo.
- `2026-05-25` — Hallazgo crítico: RLS-on-RETURNING gotcha en `insert().select()`. Documentado, patrón split adoptado.

## Bitácora — sesión 3 (Fase 2)

- `2026-05-25` — Implementer relanzado para Fase 2. Decisión de leader: email a owner (R5.10) via Resend.
- `2026-05-25` — Raf crea cuenta Resend, genera `RESEND_API_KEY`. Leader pushea a Supabase secrets.
- `2026-05-25` — 6 shared helpers (`_shared/{cors,errors,supabase,auth,email,push}.ts`) + 7 Edge Functions desplegadas a remoto. 24 tests verdes en `supabase/tests/edge/`.

## Bitácora — sesión 4 (pausa + ADRs + setup spec 02)

- `2026-05-25` — Raf intenta arrancar Fase 3 (frontend) pero corta antes de codear. Plantea ser ambicioso: agregar tooling de UX profesional, MCPs de diseño, stack opinionated.
- `2026-05-25` — Leader crea `ADR-013` (stack frontend: Tamagui + Expo Router + Reanimated + Moti + Lottie + EAS + Sentry + PostHog + Maestro + MCPs Figma/Supabase).
- `2026-05-25` — Leader crea `docs/setup-frontend.md` con instrucciones paso a paso para instalar Figma MCP, Supabase MCP, y librerías del stack cuando llegue el momento.
- `2026-05-25` — Feature 01 marcada como pausada intencionalmente en `feature_list.json` (campo `notes`).
- `2026-05-25` — Leader lanza `spec_author` para `02-modelo-animal` → cierra con status `spec_ready` (3 archivos escritos).

## Bitácora — sesión 5 (MCPs operativos + decisión de empezar designs)

- `2026-05-25` — Raf instala Figma MCP y Supabase MCP. Aprendizaje del entorno: `npx` está roto (Cylance MITM rompe el fetch); reemplazado por `pnpm dlx`. Setup `--scope user` desde **bash**, no PowerShell (resuelve el shim correcto y permite cargar `.env.local`). Raf actualiza `docs/setup-frontend.md` con los comandos reales.
- `2026-05-25` — Leader verifica en sesión: ambas MCPs disponibles (`mcp__figma__*` + `mcp__supabase__*`). Spec 02 sigue en `spec_ready` esperando lectura/aprobación humana.
- `2026-05-25` — Decisión de Raf: **antes de aprobar spec 02 o destrabar Fase 3 del spec 01**, avanzar primero designs en Figma. Primer mockup: flujo de **wizard signup + crear establishment** del spec 01 (backend ya done, contratos estables). Pantallas a diseñar: splash, signup, verificá email, login, onboarding empty state con CTA dual (R6.5), completar teléfono (R3.8), nombre del establecimiento, home post-creación, y bonus aceptar invitación (R5.3).
- `2026-05-25` — Leader cierra higiene: commit de `setup-frontend.md` con los cambios del aprendizaje real de las MCPs.

## Bitácora — sesión 6 (refactor a invitaciones link shareable — ADR-014)

- `2026-05-25` — Raf cuestiona el flujo de invitaciones email-magic-link y propone link shareable estilo Slack/Notion: owner genera link y lo comparte por WhatsApp/mail/etc con share sheet nativa + botón copiar. Leader analiza impacto: backend ya está casi diseñado para esto (email best-effort), las 7 líneas de email-matching en `accept_invitation` son lo único que ata al modelo email-bound. Estimación 4hs de trabajo, ningún trabajo previo perdido porque la Fase 3 está pausada.
- `2026-05-25` — Raf aprueba avanzar. Decisión cerrada sobre el CTA secundario de R6.5: "pegar link de invitación" (red de seguridad si el deep link no autoabre).
- `2026-05-25` — Leader crea `ADR-014` (invitaciones por link shareable) con contexto, alternativas (mantener email, dual paralelo, códigos numéricos, QR), consecuencias y mitigaciones (token UUID v4 + expiración 7d + regenerar revoca + lista visible al owner). Actualiza índice del README de ADRs.
- `2026-05-25` — Leader refina `specs/active/01-identity-multitenancy/{requirements,design,tasks}.md`: R5.1-R5.12 reescritos (R5.12 nuevo), R6.5 con "pegar link", schema marca `email` nullable + nota a migration 0012, sección "Flujo de invitación" en dos partes (owner + destinatario), tabla de Decisiones actualizada, sección Riesgos con mitigación del modelo bearer, Dependencias externas con rol residual de Resend.
- `2026-05-25` — Leader lanza implementer con scope acotado: migration 0012 + refactor de 3 Edge Functions + cleanup de `_shared/email.ts` (borrar `sendInvitationEmail`) + actualización de tests. NO tocar `cancel_invitation`/`remove_member`/`change_member_role`/`register_push_token`/migrations 0001-0011/RLS tests. Implementer cierra `done` con 41 tests verdes (15 RLS + 26 Edge, antes 39).
- `2026-05-25` — Leader lanza reviewer. Aprobado: ADR-014 sigue template, specs coherentes, migration correcta, Edge Functions cumplen el bearer model con R5.9 hard 409, `sendInvitationEmail` eliminada sin imports muertos, R5.10/R5.11 intactos, tests cubren bearer cross-email + already_member. 4 findings cosméticos en `design.md` (residuos del modelo viejo en policy `invitations`, paso 8 del flujo de signup, env var `PUBLIC_APP_URL` vs `APP_URL` real, "deep link via magic link"). Leader arregla los 4 antes del commit.
- `2026-05-25` — Cierre: `node scripts/check.mjs` verde, commit + sesión 6 al `history.md`.

### Gotcha de env var (relevante para Fase 3 del cliente)

El código real de Edge Functions usa `Deno.env.get('APP_URL')` (env del Edge Function en Supabase secrets). El spec original mencionaba `PUBLIC_APP_URL` / `EXPO_PUBLIC_APP_URL` (prefijo del cliente Expo). Quedó alineado a `APP_URL` en código + spec. Cuando arranque Fase 3, el cliente Expo va a necesitar su propia env (`EXPO_PUBLIC_APP_URL` o similar) para construir universal links — son dos vars distintas pero deben apuntar al mismo host.

## Bitácora — sesión 7 (design system "Campo Profundo" formalizado)

- `2026-05-25` — Raf colabora en chat aparte y baja `RAFAQ-Design-System-Campo-Profundo.md` al root del repo: brief completo de design system con dual theme (light + dark), paleta Campo Profundo (verde botella + sage + terracota + crema), WCAG AAA, Inter/Manrope, Lucide, touch targets ≥48px / CTAs 60-64px. Mood: confiable + local + criollo-moderno, contraste sol-ready, light & dark switch para uso en manga al sol y revisión nocturna en casa.
- `2026-05-25` — Leader procesa el doc y ejecuta 6 movidas para formalizarlo:
  1. Crea `docs/adr/ADR-015-design-system-campo-profundo.md` — formaliza el sistema como decisión arquitectónica, incluye alternativas descartadas (industrial outdoor, pro-vet clean, pampa premium, MD3 puro, Local Variables manuales).
  2. Mueve el doc del root a `docs/design-system.md` (lugar correcto — el root no debe tener docs sueltos).
  3. Genera `design/tokens.json` — formato **Tokens Studio for Figma**, fuente única de verdad. Incluye `global` (raw palette + spacing + radius + tipografía completa con text-styles), `light`, `dark`, `$themes` y `$metadata`. Importable directo al plugin de Figma → genera todas las Variables nativas. Después se traduce a Tamagui en código.
  4. Agrega `docs/setup-frontend.md` § 1.3 con pasos para instalar plugin Tokens Studio en Figma e importar el JSON. Tilda los pasos ya hechos (MCPs) del checklist.
  5. Resuelve dos pendientes del doc: **Inter como tipografía default** (Manrope queda como alternativa) y **Tamagui como UI library** (ya estaba en ADR-013 — el doc tenía la pregunta abierta por inconsistencia).
  6. Alinea `docs/design-system.md` sección 14 con esas resoluciones.
- `2026-05-25` — `check.mjs` verde post-cambios (todos los tests reales contra DB remota pasan; el design system no toca código de app ni tests).

## Bitácora — sesión 8 (correctivo: ADR-015 withdrawn, fase de exploración)

- `2026-05-26` — Raf corrige error de leader en sesión 7: el doc `RAFAQ-Design-System-Campo-Profundo.md` que él bajó al root era una **idea exploratoria** charlada en otro chat, no decisión cerrada. Leader lo había formalizado prematuramente como ADR-015 accepted + tokens canónicos + edits en setup-frontend.md. Raf aclara: quiere primero **buscar inspiraciones** (Dribbble, Mobbin, apps de competencia y referencia), explorar con Stitch (que evaluó positivo en sesión previa), y darle look & feel propio. NO quiere que el design system se sienta "vibecodeado más".
- `2026-05-26` — Leader guarda feedback memory `feedback-tentative-vs-firm` para no repetir el patrón: confirmar nivel de compromiso antes de formalizar.
- `2026-05-26` — Leader ejecuta reversa:
  - `docs/adr/ADR-015-design-system-campo-profundo.md` **eliminado** del repo (queda en git history). Raf eligió eliminarlo en vez de dejar Withdrawn para evitar que en futuras sesiones se confunda como base de decisión.
  - `docs/design-system.md` marcado como **DRAFT 0.1 EXPLORATORIO** con disclaimer al principio. Sección 14 reescrita: NADA está cerrado, todo en exploración.
  - `design/README.md` nuevo: explica que `tokens.json` es draft, no canónico, y enumera qué falta antes de cerrar el sistema.
  - `docs/setup-frontend.md` § 1.3 marcada como pendiente; checklist con prefijo "(FUTURO)" hasta cerrar design system.
  - Referencias cruzadas al ADR-015 limpiadas en todos los archivos.

## Estado real del frontend (post-corrección)

- **Design system**: en **fase de inspiración**. Nada decidido. El draft Campo Profundo es uno entre N moods posibles, no el ganador.
- **Stitch**: aprobado por Raf como herramienta a usar. Pendiente: explorar standalone, evaluar MCP (`@davideast/stitch-mcp`), auditar prompt del Notion que Raf compartió (`nexumai.notion.site/.../36a27c52...`) — leader no pudo leerlo (Notion bloquea scrapers); Raf debe copy/paste el contenido para auditar.
- **Figma + Tokens Studio**: en standby hasta cerrar el sistema. Las MCPs ya instaladas (Figma + Supabase) siguen vigentes.

## Próximo paso

1. **Raf**: iniciar **fase de inspiración** — armar tablero (Figma file o Dribbble board o carpeta `design/inspiration/`) con 15-30 referencias visuales. Leader le pasa lista curada de fuentes + queries específicos.
2. **En paralelo**: Raf prueba Stitch standalone en `stitch.withgoogle.com` (gratis, Google login). Genera 2-3 moods opuestos para el flujo wizard signup, sin compromiso. Vibe design + multi-screen.
3. **Sincronización**: cuando Raf tenga inspiración + outputs de Stitch, leader analiza patrones (paleta, tipografía, densidad, tono), propone 2-3 direcciones contrastadas con evidencia, Raf elige con convicción.
4. **Recién entonces**: ADR nuevo (probablemente -016) que supersede al -015, doc canónico, `tokens.json` cerrado, importación a Figma.
5. **Auditar prompt del Notion** cuando Raf lo copy/paste (Notion no se deja scrapear). Criterios ya enumerados en el chat: ignorar prompts injection, no exponer secrets, no hooks auto-ejecutables, etc.
6. **Decisiones que quedan pendientes (no urgentes)**:
   - Aprobar o pedir cambios en `specs/active/02-modelo-animal/` (3 archivos, ~115KB).
   - Destrabar Fase 3 del spec 01 (Tamagui + Expo Router + …) — depende de design system cerrado.

## ADRs creados en este ciclo

- `ADR-011` — Package manager pnpm con `onlyBuiltDependencies`.
- `ADR-012` — Patrones de implementación: triggers postgres, tests Node nativo, Supabase CLI como devDep.
- `ADR-013` — Stack frontend ambicioso (Tamagui + Reanimated + Moti + Maestro + Sentry + PostHog + MCPs).
- `ADR-014` — Invitaciones por link shareable (modelo bearer estilo Slack/Notion) en vez de email magic link.
- ~~`ADR-015` — Design system "Campo Profundo"~~ **Eliminado 2026-05-26** (formalización prematura — design system sigue en exploración, ver `docs/design-system.md` draft).

## Notas técnicas vigentes para el implementer

- En PowerShell usar `pnpm.cmd` (no `pnpm`) — Cylance Script Control bloquea `.ps1`.
- En migrations: `GRANT` explícito a `authenticated` siempre — Auto-expose new tables está OFF.
- Tests RLS en Node nativo, no pgTAP (Docker bloqueado).
- Edge Functions: secrets en Supabase con `supabase secrets set` además de `.env.local`.
