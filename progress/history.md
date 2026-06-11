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

---

# Consolidación de bitácoras (movidas desde `progress/current.md` el 2026-05-28)

> Estas bitácoras de sesión vivían acumuladas en `current.md` y nunca se movieron al cerrar cada sesión. Se consolidan acá, reordenadas por número de sesión, preservando su texto original.
>
> **Nota**: el detalle de implementación rico de las fases backend (Fase 0/1 schema+RLS, Fase 2 Edge Functions, refactor link shareable) vive además en `progress/impl_01-identity-multitenancy.md` (artefacto del implementer); acá queda el resumen de sesión.

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

## Bitácora — sesión 9 (research curado + findings + Mobbin MCP operativo)

- `2026-05-26` — Raf instala Mobbin MCP (`claude mcp add mobbin --scope user --transport http https://api.mobbin.com/mcp`) y completa OAuth. Tool `mcp__mobbin__search_screens` disponible. Acceso a 621.500+ screens reales desde Claude.
- `2026-05-26` — Sesión de research conjunta en modo A: leader busca via MCP, Raf reacciona. 6 categorías browseadas (agtech/tracking, field-service wizards, pro-tools dashboards, onboarding wizards, outdoor/offline, signup puro + fintech). **41 screens revisadas**, **22 curadas** descargadas a `design/inspiration/{00..99}/` con `_notes.md` por categoría con tags + links Mobbin.
- `2026-05-26` — Leader sintetiza en `design/research-findings.md`:
  - **3 direcciones viables** emergen, cada una validada por app real exitosa: (A) Campo Profundo tierra-criollo validada por Komoot/Lifesum, (B) Verde Teal Fresco SaaS validada por Gusto, (C) Pro-Clean Minimalismo validada por Attio. Una 4ta dirección (premium editorial con serif tipo Neo Financial) se descarta como principal pero queda como referencia tonal para marketing futuro.
  - **11 patrones universales** que aplican a cualquier dirección elegida (CTA fixed-bottom con brand, step indicator dots-conectados estilo Shopee, hero number centrado, validation inline bajo password, offline como CTA visible, lista tasks en empty state, timeline vertical para chronology, CTA dual sólido+outline para R6.5, bocadillo dark para alerts críticos, mini-stepper en card de status, hero preview value en welcome).
  - **Decisiones del draft afirmadas por research**: dual theme (Revolut Business confirma), sans no serif (universal), CTA exclusivo brand (universal), touch targets grandes (Jobber/Shopee), Inter (dominante). **No afirmadas todavía**: paleta exacta (A vs B vs C abierta), iconografía custom (a definir cuando armemos pantallas).
  - **Recomendación de leader**: probar **A híbrida con disciplina C** (Campo Profundo + minimalismo Attio) en Stitch con el flujo signup wizard del spec 01. Alternativa fuerte: B con disciplina C si Raf prefiere distancia del cliché agtech.
- `2026-05-26` — Tareas pendientes que Raf debe cubrir offline (Mobbin no las tiene): apps argentinas (MP, Modo, Ualá, Brubank), apps agtech (Auravant, JDOC, FieldView), competencia directa fea (Allflex, Tru-Test, Datamars). Guardar en subcarpetas de `design/inspiration/`.
- `2026-05-26` — Raf carga **23 capturas device adicionales**: 13 de Mercado Pago register flow + home post-login ("moderno, pro, alta UX/UI") y 10 de Auravant crear actividad ("estéticamente feo pero parecido en funcionalidad"). Leader renombra a convención (`mercadopago-register-NN-descripcion.jpeg`, `auravant-crear-registro-NN-descripcion.jpeg`), mueve un Auravant misplaced de `06-argentino/` a `01-agtech-rural/`, lee las 23 imágenes, y arma notes detallados:
  - `design/inspiration/06-argentino/_notes.md` (nuevo) con análisis MP screen por screen
  - `design/inspiration/01-agtech-rural/_notes.md` (actualizado) con sección Auravant separando estética [anti] de arquitectura funcional [function-ref] [keep]
- `2026-05-26` — Leader integra hallazgos al `design/research-findings.md` con nueva sección "Validaciones device". Cambios clave:
  - **Mercado Pago refuerza la dirección A híbrida con C**: header brand persistente + cards blancas elevadas + disciplina B2B + microinteractions argentinas (voseo, WhatsApp OTP, autocomplete dominios, pre-fill +54).
  - **Auravant es el molde funcional para MODO MANIOBRAS (spec 03)**: top bar contexto jerárquico activo, grid 2x2 select type, modal sheets stacked, form principal con secciones agrupadas, "Add X" mini-cards inline, mismo form crear=editar.
  - **Patrón universal #12 nuevo emergente**: wizard "tarjetas con CTA solo en activo" (de MP) — alternativa objetivamente mejor al step indicator clásico para pasos independientes.
  - **Insight de producto**: arquitectura funcional Auravant + estética dirección A híbrida con C + microinteractions MP = diferenciación clara contra competencia (Allflex/Tru-Test/Datamars/Auravant mismo).
  - Tabla "Material descargado" actualizada: 45 screens totales (22 Mobbin + 23 device) en 8 carpetas.
- `2026-05-26` — Raf carga **3 capturas adicionales de MP** (pestañas del bottom nav: Actividad, Beneficios, Más). Le interesa evaluar este pattern para entrar a MODO MANIOBRA y BUSCAR ANIMAL. Leader analiza y propone **estructura tentativa de bottom nav RAFAQ**: `[Inicio] [Animales] [⚡Modo Maniobra (FAB central)] [Reportes] [Más]`. El FAB central comunica "acción más crítica del operador" + es el más accesible para mano enguantada. Tab `Animales` resuelve BUSCAR ANIMAL como pestaña dedicada (no sub-menú) reflejando su rol CORE. Tab `Actividad` de MP es plantilla casi 1:1 para `Animales` (stats + search permanente + chips filtros + lista agrupada). Tab `Más` de MP es plantilla directa para settings de RAFAQ.
- `2026-05-26` — Adelanto de Raf: **BUSCAR ANIMAL es funcionalidad CORE igual que MODO MANIOBRA**. Hoy no existe en `feature_list.json` — probablemente sea spec separada (ej. `09-buscar-animal`) o extensión sustantiva de `02-modelo-animal`. Raf va a explicar el flujo en otra sesión para escribir las specs. Anotado como nota en research-findings.md.
- Material total ahora: **48 screens** (22 Mobbin + 26 device). 16 en `06-argentino/` (13 register + home + 3 tabs).

## Bitácora — sesión 10 (discovery BUSCAR ANIMAL + validación terminología + ADRs 016/017 + spec 09 + plan.md)

- `2026-05-26` — Raf explica al leader la feature CORE **BUSCAR ANIMAL**: dos puertas de entrada (manual desde ANIMALES tipeando ID visual + bastón BLE como listener global activo en cualquier pantalla excepto MODO MANIOBRAS) que convergen en flujo find-or-create. Si el animal no existe → form CREATE con ID precargado + selección de rodeo + form dinámico según sistema del rodeo. Si existe → form EDIT con datos precargados + acceso al timeline. Leader hace 4 preguntas clave (selección de rodeo, ID visual vs electrónica + duplicados, modelo de comentarios, terminología rodeo/lote).
- `2026-05-26` — Respuestas y decisiones: (1) **`lastRodeoSelected`** scope app session, persiste hasta cerrar app, fallback a último rodeo usado en device. (2) **IDs únicas, no hay duplicados**; al crear se muestran ambos campos (visual + electrónica), el usado para entrar viene precargado y no modificable, el otro vacío recomendado pero no obligatorio. (3) **Comentarios = timeline append-only** con autor + timestamp + tipo + payload + edit_window. (4) **Terminología validada con el vet socio (Facundo, UNLP)**: rodeo = grupo de animales (entidad principal), sistema = tipo productivo, lote no se usa para grupos.
- `2026-05-26` — Duplicados lógicos (animal con solo visual + después se le pone electrónica): MVP cubre con **A** (búsqueda intermedia previa al alta cuando se bastonea algo sin match) **+ B** (flujo dedicado de "asignación masiva de caravanas"). Opción **C** (detección automática + merge guiado) **diferida a post-MVP** → anotada en `CONTEXT/07-pendientes.md` sección "Funcionalidades a priorizar después del MVP".
- `2026-05-26` — **Purga de alucinaciones**: Raf detecta que el leader inventó "Hugo" como nombre del vet socio. Búsqueda exhaustiva descubre que la alucinación se extendió a 6 archivos del repo con datos falsos: "Joaquín Giménez (Matrícula 13759)" como vet del campo, "Los Tamarindos" como campo beta (Tamarindos es un campo real pero NO el de prueba — fue material de referencia), "174 animales Angus" como inventario. Reales: vet socio = **Facundo** (UNLP, equity 50/50), RAFAQ = Raf + Facundo, campo de prueba en **Chascomús**. Limpieza quirúrgica en `CONTEXT/01-producto.md`, `CONTEXT/02-modelo-negocio.md`, `CONTEXT/07-pendientes.md`, `CONTEXT/08-roadmap.md`, `docs/adr/ADR-007-lab-integration-parsers.md`, `docs/adr/ADR-010-vesta-hardware-integration.md`. Cero ocurrencias residuales post-cleanup. Memoria `feedback-no-inventar-nombres` + `product-people` agregadas.
- `2026-05-26` — Leader propone reordenar la ejecución del proyecto en 4 bloques (A preparación → B esqueleto → C workflows → D soporte/salida) priorizando dependencias reales sobre orden numérico. Raf pide que el plan viva en archivo persistente para sesiones futuras. Leader crea **`progress/plan.md`** con IDs estables (A.1, A.2, etc.), estado, dueño, dependencias, output por item, sección "Decisiones cerradas en charla pero todavía no formalizadas" y changelog. `AGENTS.md` actualizado: "leer plan.md al arrancar sesión" sumado a la lista obligatoria + entrada en mapa del repositorio. Memoria `project-execution-plan` agregada como pointer.
- `2026-05-26` — Raf autoriza avanzar con los 3 ítems del plan que el leader puede hacer sin esperarlo: A.3, A.4, A.6. Leader entrega:
  1. **`docs/adr/ADR-016-terminologia-rodeo-sistema.md`** (no 015 — el slot 015 quedó vacío por la retirada del ADR de design system "Campo Profundo" en sesión 8; saltar evita ambigüedad con referencias residuales en `current.md`, `design/README.md`, `docs/design-system.md`).
  2. **`docs/adr/ADR-017-timeline-eventos-animal.md`** con schema canónico de `animal_events` (id, animal_id, establishment_id, author_id, created_at, event_type enum, text, structured_payload jsonb, edit_window_until 15min, deleted_at). Hereda heurística de "si se cuenta/filtra/grafica → estructurado; si es observación humana sin schema → texto libre en evento `observacion`".
  3. **Feature 9 `09-buscar-animal`** agregada a `feature_list.json` con `status: pending`, `sdd: true`, `notes` documentando dependencias (specs 02 + 04) y los ADRs.
  4. `docs/adr/README.md` actualizado con ADR-016, ADR-017 e indicación de que 015 fue eliminado.
  5. `progress/plan.md` actualizado: A.3 + A.4 + A.6 marcados como `done`. Changelog del plan registra el avance. La estructura bottom nav (item A.2) reasignada de ADR-017 a ADR-018 ya que el 017 quedó tomado.
- **Estado al cierre de sesión**: bloque A del plan parcialmente avanzado. Lo que sigue queda en cancha de Raf: refinar spec 02 antes de aprobar (A.5) y cerrar design system canónico (A.1). El leader no avanza sin esas decisiones humanas.

## Bitácora — sesión 11 (2026-05-26)

### 11a — refinamiento + aprobación de spec 02 con R14 tentativo

- `2026-05-26` — Sesión arranca con todos los archivos base leídos + `node scripts/check.mjs` verde (15 RLS + 26 Edge tests pasando). Estado: bloque A del plan con A.3/A.4/A.6 done, A.1 in_progress (Raf), A.5 pendiente.
- `2026-05-26` — Leader propone avanzar A.5 (refinar spec 02) que es lo único que puede hacer sin esperar a Raf. Raf aprueba.
- `2026-05-26` — Conflicto arquitectónico detectado: spec 02 actual tiene 5 tablas de eventos tipadas + auditoría, pero ADR-017 (escrito después) propone una tabla unificada genérica. Leader hace AskUserQuestion con 3 opciones (Híbrido / ADR-017 literal / ADR-017 con vistas). Primera ronda Raf pide explicación menos técnica. Leader reformula sin DB enfocando consecuencias funcionales (analytics, validación, esfuerzo de refactor). Raf elige **Híbrido**: conservar 5 tablas tipadas + agregar `animal_events` solo para `event_type IN ('observacion','otro')`. Decisión clave: "data analytics es PILAR".
- `2026-05-26` — También cerrado: R15 entero se borra del spec 02 (UX se mueve a spec 09).
- `2026-05-26` — Leader lanza `spec_author` con scope acotado: Híbrido + R15 borrar + R4.13 inmutabilidad + R10.1 séptimo origen + terminología + motor de form dinámico + cabeceras con fecha. Spec_author refina los 3 archivos (~250 líneas netas agregadas), 3 migrations nuevas (0033/0034/0035), housekeeping renumerada a 0036. `check.mjs` verde. Status sigue `spec_ready`.
- `2026-05-26` — Leader entrega resumen escaneable del spec en chat. Raf cuestiona: "¿no está mal cerrar specs sin tener definido el design UX/UI?". Leader analiza: ~93% del spec es independiente del design system; solo R14 (pantalla Ficha animal) lo toca, y aún así de forma genérica (qué muestra, no cómo se ve). El patrón ya validado en spec 01 es: aprobar spec entero + implementar solo backend + pausar frontend hasta design system. Leader propone 3 caminos vía AskUserQuestion.
- `2026-05-26` — Raf elige "Aprobar con R14 marcado como tentativo". Decisión grabada.
- `2026-05-26` — Leader ejecuta la aprobación condicional:
  1. `requirements.md`: agrega disclaimer en R14 ("⚠️ Sección TENTATIVA, sujeta a refinamiento incremental cuando se cierre design system") + bullet en Historial de refinamiento documentando la aprobación con condición.
  2. `feature_list.json`: spec 02 pasa de `spec_ready` a `in_progress` con `notes` documentando la pausa de frontend (mismo patrón que spec 01).
  3. `progress/plan.md`: A.5 marcado como `done` con detalle de cambios. Tabla "Estado global resumido" actualizada. Changelog agrega entrada sesión 11.
  4. `progress/current.md`: bitácora sesión 11 documentada.

### 11b — continuación: A.7 spec 09 redactada

- `2026-05-26` — Raf elige avanzar A.7 antes que B.2 (recomendación del leader: cerrar todo el modelo del frontend antes de implementar backend para tener visibilidad total).
- `2026-05-26` — Leader lanza `spec_author` con prompt detallado: 9 decisiones cerradas explicitadas (dos puertas, find-or-create, `lastRodeoSelected`, identificación dual, form dinámico, timeline append-only, duplicados A+B+C, terminología, dependencias). Scope hard: NO modificar spec 02, NO redefinir schemas, NO escribir código, marcar UI como tentativa.
- `2026-05-26` — `spec_author` entrega:
  - `specs/active/09-buscar-animal/requirements.md` (252 líneas, 12 requirements R1-R12).
  - `specs/active/09-buscar-animal/design.md` (421 líneas, arquitectura + hooks + pantallas + alternativa descartada).
  - `specs/active/09-buscar-animal/tasks.md` (449 líneas, 6 fases, trazabilidad R↔T completa).
  - `feature_list.json`: spec 09 movida a `status: spec_ready` con `notes` listando TODOs y dependencias.
  - `check.mjs` verde.
- `2026-05-26` — Leader actualiza `progress/plan.md`: A.7 marcado `done`, B.4 actualizado, decisiones cerradas tildadas en sección "Decisiones cerradas en charla", changelog agrega entrada de continuación sesión 11.

### 11c — aprobación spec 09

- `2026-05-26` — Raf pidió resumen ejecutivo de spec 09 para leer en chat sin abrir VSCode. Leader leyó los 3 archivos completos y armó resumen escaneable: 1 oración del qué + diagrama de 2 puertas + tabla de 12 requirements (6 def + 6 UI tentativa) + 8 pantallas + 4 hooks clave + alternativa descartada + riesgos + plan de fases con bloqueos.
- `2026-05-26` — Raf aprobó spec 09 entera. Status en `feature_list.json` movido a `blocked` con notes explícita (no `in_progress` para respetar `one_feature_at_a_time` del check.mjs — spec 02 sigue como feature activa porque es prerequisito técnico). Historial de aprobación agregado al requirements.md de spec 09. _(Nota 2026-05-28: este status `blocked` fue luego migrado a `deferred` al introducir ese estado en el enum.)_

### 11d — resolución R12 ↔ R4.13

- `2026-05-26` — Raf pide analizar la tensión R12 ↔ R4.13 antes de avanzar con aprobación de spec 09 o backend de spec 02. Leader presenta análisis técnico: el trigger actual bloquea TODO cambio de `tag_electronic` (incluyendo `NULL → valor`); R7/R8 de spec 09 necesitan exactamente ese caso. Distinción semántica clara entre "completar info" (`NULL → valor`) y "reescribir identidad" (`valor → otro valor`).
- `2026-05-26` — Leader evalúa 5 opciones y descarta 2 (modelar TAG como evento append-only = over-engineering; diferir R7/R8 = sacrifica caso central del deadline SENASA). Presenta 3 opciones a Raf vía AskUserQuestion:
  - **A**: refinar trigger en 2 líneas SQL para permitir `NULL → valor`.
  - **B**: refinar trigger + Edge Function dedicada `assign_tag_to_animal` con audit granular.
  - **C**: soft-delete + alta nuevo (rompe trazabilidad SENASA).
- `2026-05-26` — Raf elige **opción A**. Razones documentadas por el leader: velocidad de MVP, distinción semántica defensible, backwards compatible si después se quiere sumar audit granular (opción B post-MVP).
- `2026-05-26` — Cambios aplicados (4 archivos editados):
  1. `specs/active/02-modelo-animal/design.md` — trigger `tg_animals_block_tag_change` actualizado: `if old.tag_electronic is null then return new` antes del check de `IS DISTINCT FROM`. Mismo cambio en `tg_animal_profiles_block_idv_change` para `idv`. Comentarios SQL explicando la distinción semántica. Notas debajo del bloque ampliadas.
  2. `specs/active/02-modelo-animal/requirements.md` — R4.13 reescrita con sub-cláusulas R4.13.a (`NULL → valor` permitido), R4.13.b (`valor → otro valor` prohibido), R4.13.c (`valor → NULL` prohibido). Entrada nueva al Historial de refinamiento explicando razón y backwards-compatibility.
  3. `specs/active/09-buscar-animal/requirements.md` — R12 marcada ✅ RESUELTA con trazabilidad histórica. R12.2 actualizada con `WHERE tag_electronic IS NULL` defensivo + manejo de race condition. R12.4 documenta upgrade path post-MVP a opción B (Edge Function con audit granular). Criterio de aceptación global "implementación bloqueada" cambiado a "habilitada para implementación end-to-end".
  4. `specs/active/09-buscar-animal/tasks.md` — Fase 3 desbloqueada: header del archivo + diagrama de dependencias + tabla de trazabilidad R↔T + T3.1 reescrita como "validar precondición R4.13 a nivel DB". Eliminada la columna "Depende de R12" de la tabla de fases.
  5. `feature_list.json` spec 09 notes — eliminado el TODO de R12, mantenidos spec 04 + ADR-018.
- `2026-05-26` — Decisión meta: **no se crea ADR separado**. Es refinamiento de spec, no decisión arquitectónica transversal. La trazabilidad vive en los Historiales de spec 02 y 09 + esta bitácora.

## Bitácora — sesión 12 (security_analyzer + skill Sentry) (2026-05-27)

- `2026-05-27` — Raf pregunta sobre agregar un agente experto en ciberseguridad al flujo. Menciona "Cyber Neo Claude" como candidato. Leader investiga: encuentra `Hainrixz/cyber-neo` (proyecto verde, 2 commits, 127 stars, autor individual + comunidad tododeia.com).
- `2026-05-27` — Leader compara contra alternativas + `/security-review` built-in de Anthropic. Raf recibe luego info sobre `getsentry/skills@security-review` desde fuente externa. Leader investiga a fondo: empresa Sentry, Apache-2.0, 747 stars, 221 commits, sistema de confianza HIGH/MEDIUM/LOW, 27 reference files (17 vulns + 5 lenguajes + 5 infra), read-only enforced, methodology de tracing en vez de checklist.
- `2026-05-27` — Veredicto del leader: getsentry security-review es claramente superior a Cyber Neo en madurez + methodology + reducción de false positives. Recomendación final: getsentry como skill base.
- `2026-05-27` — Análisis de cómo implementar el agente en RAFAQ. Raf propone 5to subagente que revise specs antes de aprobación + código pre-aprobación. Leader evalúa 4 patrones (A subagente always-on / B skill libre / C hook automático / D subagente + 2 gates condicionales). Recomienda Patrón D.
- `2026-05-27` — Raf aprueba Patrón D + instala el plugin Sentry a nivel user (`claude plugin install sentry-skills@sentry-skills`).
- `2026-05-27` — Leader entrega los 7 cambios:
  1. **`docs/adr/ADR-019-security-analyzer-skill-sentry.md`** — decisión arquitectónica formal con análisis completo de alternativas (Cyber Neo, agamm, Phoenix, mahmutka, /security-review built-in, Sentry) y de patrones de implementación (A/B/C/D).
  2. **`.claude/agents/security_analyzer.md`** — nuevo subagente con 2 modos (`spec` y `code`), checklist RAFAQ-específico, formato de output consistente con reviewer (`progress/security_spec_<feature>.md` y `progress/security_code_<feature>.md`).
  3. **`.claude/agents/leader.md`** — actualizado con flujo SDD que incluye Gate 1 (condicional) y Gate 2 (siempre), criterios para invocar cada gate, escalado de esfuerzo actualizado, reglas duras nuevas (NUNCA saltar Gate 2).
  4. **`AGENTS.md`** — flujo SDD con gates + mapa del repositorio actualizado.
  5. **`docs/specs.md`** — diagrama de estados con 2 puertas de aprobación humana.
  6. **`docs/adr/README.md`** — agregada fila ADR-019 + slot 018 reservado para bottom nav.
  7. **`progress/plan.md`** y `current.md` — bitácora y changelog.

---

### Notas y pendientes anexados a la consolidación (point-in-time)

**TODOs documentados en spec 09 — estado** (de sesión 11)

1. ~~**R12 — tensión con R4.13 de spec 02**~~ ✅ **RESUELTA el 2026-05-26** (ver bitácora 11d).
2. **Dependencia spec 04**: la puerta BLE (R2 de spec 09) y la Fase 4 de tasks.md siguen bloqueadas hasta que spec 04 (BLE bastón) esté implementada. Stub declarado en T1.5.
3. **Dependencia ADR-018**: estructura de navegación principal (bottom nav) asumida como tentativa.

**TODOs / próximas pruebas** (de sesión 12)

- **Primera prueba real del flujo nuevo**: cuando arranquemos B.2 (backend spec 02). Gate 1 debería aplicar (spec 02 toca RLS + schema + Edge Functions). Gate 2 sobre migrations + tests cuando estén implementadas.
- **Documentar replicación del plugin**: cuando llegue el momento de onboarding de otro dev, agregar a `docs/setup-frontend.md` el paso de instalar `sentry-skills@sentry-skills`.
- **Considerar pin a tag específico**: si la skill cambia comportamiento entre versiones, podemos pinear a un commit/tag específico del repo `getsentry/skills` en vez de `main` indiscriminadamente. Por ahora no se hace (proyecto pre-prod, OK aceptar updates).

**Decisiones de criterio propio del spec_author (Raf debería validar al revisar)** (de sesión 11)

- **Heurística R1.4**: input numérico/estructurado → `idv`; texto libre → `visual_id_alt`. Diferida al design.md para detalle.
- **`useBusyMode()`**: hook que las pantallas activan para suspender el listener BLE global durante un form CREATE/EDIT abierto (evita que un bastoneo accidental pise el flujo activo).
- **Mock provider del bastón**: para tests sin device físico, expone `mockTagRead(tag)` y se monta con `mode='mock'`.

**ADRs creados en el ciclo (sesiones 1-12)**

- `ADR-011` — Package manager pnpm con `onlyBuiltDependencies`.
- `ADR-012` — Patrones de implementación: triggers postgres, tests Node nativo, Supabase CLI como devDep.
- `ADR-013` — Stack frontend ambicioso (Tamagui + Reanimated + Moti + Maestro + Sentry + PostHog + MCPs).
- `ADR-014` — Invitaciones por link shareable (modelo bearer estilo Slack/Notion) en vez de email magic link.
- ~~`ADR-015` — Design system "Campo Profundo"~~ **Eliminado 2026-05-26** (formalización prematura — design system sigue en exploración, ver `docs/design-system.md` draft).
- `ADR-016` — Terminología rodeo/sistema.
- `ADR-017` — Timeline append-only de eventos del animal.
- `ADR-019` — Security analyzer como 5to subagente + skill Sentry.

> Las secciones forward-looking de `current.md` ("Próximos pasos posibles", "Estado real del frontend post-corrección", "Próximo paso") describían estado planificado ya superado; su contenido vigente vive en `progress/plan.md`. No se reproducen acá.

---

## Sesión 13 — Auditoría de consistencia del harness (2026-05-28)

- **Agente:** claude (sesión meta, no SDD — análisis y corrección del harness, no implementación de feature).
- **Pedido de Raf:** analizar harness/flujo/agentes y reportar inconsistencias / contradicciones / huecos.
- **Inconsistencias arregladas y commiteadas** (commit `bf879fa`):
  - `check.mjs` valida `security_analyzer.md` (5to agente) + `progress/plan.md`; `CHECKPOINTS.md` C1 → "5 agentes".
  - Estado `deferred` agregado al enum (`feature_list.json` + `check.mjs` + `docs/specs.md`). Features 01 y 09 migradas de `blocked` → `deferred` (no hay bloqueante externo; postergadas por decisión propia).
  - Gate 2 (security modo `code`) diffea desde `baseline_commit` que registra el implementer (se trabaja sobre `main`, no `main...HEAD`). Tocados `implementer.md`, `security_analyzer.md`, `leader.md`.
  - Skill namespaceada `sentry-skills:security-review` en `security_analyzer.md`.
  - Arranque de `CLAUDE.md` alineado con `AGENTS.md` (corre check antes de leer estado + incluye `plan.md`).
  - Fila "Trivial" del escalado del leader incluye reviewer (Gate 2 depende de su aprobación).
  - `spec_author`: modo "refinamiento" para specs ya `spec_ready` (Gate 1 FAIL + "pedí cambios").
  - `verification.md` / `architecture.md` / `conventions.md`: comandos reales (pnpm / Node-nativo, no pgTAP / npx), tests de cliente marcados forward-looking, `Refs` opcional.
  - `AGENTS.md`: fila `.harness/config.json` actualizada (ya no "cuando habilités tests reales").
  - `plan.md`: división de autoridad feature_list ↔ plan + tabla marcada como snapshot.
- **Higiene:** bitácoras de sesiones 1-12 consolidadas en este `history.md` (commit `84cd2a8`); `current.md` reseteado. Sumado WARN en `check.mjs` que avisa cuando `current.md` se ve inflado (≥2 bloques de sesión o >150 líneas) — recordatorio del paso manual de cierre.
- **Descartado (no eran problema):** la columna de estado de `plan.md` (trackea implementación, no estado SDD) y las skills on-demand `llm-council` / `stitch-workflow` (no van en el mapa del workflow porque se disparan solo cuando Raf las pide explícitamente).
- **Dejado COMO ESTÁ por decisión de Raf:** Stop hook corre la suite remota en cada cierre de turno (peaje de segundos OK) y `git push *` auto-allowed en `settings.local.json` (evita fricción al pushear lo que Raf ya pidió).
- **Inmutable, no tocado:** ADR-019 (drift de naming interno; los docs operativos ya usan el nombre correcto, así que el ADR queda como registro histórico).
- **Commits:** `84cd2a8` (bitácoras) + `bf879fa` (fixes de consistencia), ambos pusheados a `origin/main`. El cierre de sesión (este resumen + WARN + reset de `current.md`) va en commit aparte.
- **Verificación:** `node scripts/check.mjs` verde en cada paso (typecheck + 15 RLS + 26 Edge contra DB remota).
- **No tocado (trabajo previo de Raf, sin commitear):** `specs/active/02-modelo-animal/*`, `specs/active/09-buscar-animal/*`, `design/*`.

---

## Sesión 14 — Refundición consolidada de spec 02: lote + plantilla de datos (2026-05-28)

- **Agente:** claude (sesión SDD de refinamiento de specs — edición directa de docs, sin lanzar implementer; spec 02 ya aprobada → confirmación humana en cada paso).
- **Origen:** la conversación arrancó con Raf revisando spec 02 ("¿cómo es eso del rodeo default?"). Derivó en detectar que spec 02 tenía premisas falsas (rodeo default autogenerado) y, tras dos iteraciones, un **bug estructural** en el modelo de plantilla de datos.
- **Trayecto:**
  - Primera ronda (2026-05-27): se eliminó el rodeo default y se modeló la plantilla de datos como catálogo **por sistema** (`system_data_templates`). Raf detectó que ese modelo no soportaba "rodeo de tambo que también tactea preñez" (un dato no se puede reusar entre sistemas).
  - Raf paró el avance incremental ("¿no conviene tirar la spec, charlar y rehacerla?"). Se acordó: NO tirar spec 02 (80% estaba sólido), sí refundir los hilos abiertos.
  - Raf cerró dos decisiones en chats externos y las bajó como ADRs **commiteados**: **ADR-020** (lote como agrupación de manejo, fbe1c79) y **ADR-021** (plantilla de datos: catálogo global + defaults por sistema + toggle por rodeo + gating, ffb53d2).
- **Decisiones de diseño tomadas con Raf (vía AskUserQuestion):**
  - Nombre canónico de la tabla de lote: **`management_groups`** (inglés, regla CLAUDE.md; UI lo muestra como "Lote").
  - Enforcement del gating de "el animal hereda los datos del rodeo": **doble capa UI + DB**, mapeo maniobra→data_keys hardcodeado (el detalle DB es de spec 03).
  - Empty state de establishment sin rodeo: **bloqueo total** (wizard como primera pantalla).
  - Reconciliación de `sessions.lote_label` / `sanitary_campaigns.lote_label` → `management_group_id` FK (a nivel modelo conceptual en CONTEXT/04; spec 03 implementa).
- **Refundición aplicada (commit `9f066a1`, 8 archivos):**
  - **spec 02** (3 archivos): R2.B reemplazada por 3 tablas (`field_definitions` global + `system_default_fields` + `rodeo_data_config`), R2.C nueva (lote), R7.7 ortogonalidad, R4.1 +columna, seed 26 fields cría (TENTATIVO, 23 ON / 3 OFF), gating doble capa documentado, criterios + caso tambo+preñez. SQL de las 3 tablas + `management_groups` + trigger auto-poblado + RLS. Migrations renumeradas: plantilla en `0016`, lote en `0036`, check_grants `0037` (bloques `0017–0035` sin cambios). Historiales → Changelog en cada archivo. Todo el detalle ganado preservado (R4.13, modelo Híbrido, ternero al pie, transiciones, split insert+select).
  - **spec 09** (3 archivos): consume plantilla+lote; **distinción clave** form-fields del alta (columnas `animal_profiles`, hardcode cría) vs data_keys de eventos (`rodeo_data_config`); selector de lote en CREATE/EDIT; **corregida** la lista de tipos de evento de R5.4/AddEventSheet (usaba los tipos viejos del enum ADR-017 que el modelo Híbrido descartó); riesgo R4.13 marcado RESUELTO (era stale). **Re-aprobada por Raf** tras resumen integral.
  - **CONTEXT/04**: 3 tablas + `management_groups` + columna; sección de 3 ejes ortogonales; "Lo que NO se modela" aclarado (lote ya no prohibido; sí potreros físicos y tabla `movements`); reconciliado `lote_label` → `management_group_id` FK.
  - **progress/plan.md**: estado spec 02/09, B.2 migrations `0012..0037` + tablas nuevas, changelog sesión 14.
- **Verificación:** `node scripts/check.mjs` verde en estructura (harness + feature_list + specs). `data_keys` ASCII consistentes (`prenez`, `tamano_prenez`, `condicion_corporal`); `system_data_templates` solo como referencia histórica (changelogs + alternativas de ADR-021), nunca tabla viva.
- **Higiene:** handoffs externos borrados tras aplicar (`docs/adr/handoff-lote/`, `docs/adr/handoff-plantilla/`, `handoff-plantilla.zip`, `tropero-docs.zip`) — el único permanente fue cada ADR. Working tree limpio.
- **Commits de la sesión:** `fbe1c79` (ADR-020) + `ffb53d2` (ADR-021) + `9f066a1` (refundición). Cierre de sesión (este resumen + reset de `current.md`) en commit aparte. **No pusheados todavía** (Raf decide cuándo).
- **Pendiente abierto:** validar el seed de cría de `field_definitions` (26 fields) con Facundo — ajustable por migration sin reabrir spec. Sigue sin redactarse spec 03 (dueña del gating de maniobras + sessions/lote_label reconciliation).
- **Próximo paso:** B.2 (backend spec 02, ahora con plantilla + lote) o seguir A.1 (design system). Raf elige.

---

## Sesión 15 — Gate de refinamiento de contexto + reorden del roadmap (2026-05-28)

- **Agente:** claude (rol leader — cambio de proceso/docs del harness, edición directa sin implementer; planificado en plan mode y aprobado por Raf antes de ejecutar).
- **Origen:** Raf pidió leer todo el contexto/specs/pendientes y armar un plan de desarrollo ordenado, resolviendo tres dolores: (1) specs largas que salían mal por contexto sin refinar (spec 02 reescrita ×2), (2) falta de política de orden entre spec-ear e implementar, (3) falta de un orden claro de qué definir/implementar primero. Pidió explícitamente agregar el paso de refinamiento al workflow del harness.
- **Decisiones tomadas con Raf (vía AskUserQuestion):**
  - Modelado del refinamiento: **estado `context_ready` + artefacto `context.md`** (chequeable por check.mjs).
  - Quién refina: **el leader en conversación directa** (no subagente — el valor es el diálogo en vivo).
  - Política de orden y arranque: Raf delegó el análisis → recomendación adoptada (ver abajo).
- **Parte 1 — Gate 0 de refinamiento (ADR-022):**
  - `feature_list.json`: `context_ready` agregado a `valid_status`.
  - `scripts/check.mjs`: `context_ready` en `validStatus` + `requiresContext=['context_ready']` que exige `context.md`; sin retro-exigencia a `spec_ready+` (grandfathering 01/02/09).
  - `docs/specs.md`: diagrama de estados con Gate 0; sección "context.md — refinamiento de contexto"; tres puertas humanas (contexto → spec → código); sección "Política de pipeline".
  - `.claude/agents/leader.md`: flujo con Gate 0; Caso A (refinamiento leader-led → context.md → context_ready) + Caso A-bis (context_ready aprobado → spec_author).
  - `.claude/agents/spec_author.md`: arranca de `context_ready`, lee `context.md` como fuente de verdad.
  - `AGENTS.md` + `CLAUDE.md`: flujo, reglas duras y mapa actualizados.
  - `docs/adr/ADR-022-gate-refinamiento-contexto.md` creado (Accepted) + índice README.
- **Parte 2 — Política de pipeline:** dos tracks, implementación WIP=1, spec buffer=1, refinamiento buffer=2–3. Conclusión: alternar spec/impl no está mal si es dirigido por el pipeline, no por humor. Documentada en ADR-022 + docs/specs.md.
- **Parte 3 — Roadmap por olas (rush MVP):** sección "Orden de ejecución (olas)" en plan.md. Arranque paralelo (Ola 0): B.2 backend 02 + A.1 design system (Raf) + refinar contexto de 03 + research SIGSA + agendar día de campo. Orden de implementar: 02 backend → 01 fe → 02 fe → 04 → 09 → 05 → 03 → 08 → 06 → 07. Reconciliado el drift de la tabla "Estado global resumido" (09 es deferred, no blocked).
- **Verificación:** `node scripts/check.mjs` verde con el código nuevo (typecheck + 15 RLS + 26 Edge contra DB remota). Dry-run de la guardia: flip temporal de 03 a `context_ready` sin context.md → check FALLÓ con "falta ...context.md" (exit 1) → revertido a `pending` (cambio net-zero, estado idéntico al verde).
- **Higiene:** sin temporales; `feature_list.json` restaurado exacto tras el dry-run.
- **Commits:** ninguno todavía — Raf decide cuándo commitear (cambios sin commitear: harness + ADR-022 + plan.md + este resumen).
- **Pendiente abierto:** sigue sin validarse el seed de cría con Facundo; sigue sin redactarse spec 03 (ahora pasa primero por el Gate 0 nuevo).
- **Ola 0 ejecutada (misma sesión 15):**
  - **(a) B.2 backend de spec 02 — DONE.** Implementer (background) aplicó migrations `0013-0042` al remoto + suite `supabase/tests/animal` 19/19. 4 desviaciones documentadas (SECURITY DEFINER en identity_check + record_category_change, fix de revert de override, soft-delete vía RPCs `soft_delete_*`, renumber +1). Reviewer **APPROVED**. Gate 2 (security_analyzer) encontró **SEC-HIGH-01**: `apply_auto_transition` (SECURITY DEFINER, helper interno del trigger) quedó expuesta como RPC con `EXECUTE TO PUBLIC` → un authenticated podía reescribir la categoría de un animal de otro tenant. Rebote al implementer → `0042_revoke_internal_function_grants.sql` (revoke) + test `T2.18` → **Gate 2 re-run PASS** (cierre confirmado runtime). Raf aprobó (Puerta 2) → spec 02 a `deferred` (backend done, frontend Fase 3+ pausado, patrón spec 01). `design.md` actualizado al as-built (Changelog).
  - **(b) Gate 0 estrenado con 03 MODO MANIOBRAS.** Refinamiento conducido por el leader con Raf (2 rondas de AskUserQuestion): sessions persistida (1 rodeo/sesión), find-or-create de spec 09 para alta en manga, vacuna/pajuela texto libre, raspado solo machos, pesaje ternero mínimo (peso al pie/destete → backlog), **lote NO auto-asignado desde la sesión** (edge case que el gate atrapó en vivo: un turno puede tocar 2 lotes y los pisaría), gating DB por trigger, migrations 0038+. `context.md` aprobado → `03` a `context_ready`; spec diferida JIT (buffer=1).
  - **Bug menor de harness RESUELTO**: el subagente `security_analyzer` no tenía tool `Write` → no pudo persistir su reporte de Gate 2 (lo persistió el leader). Fix: se le agregó `Write` a `.claude/agents/security_analyzer.md`, acotado por protocolo a escribir SOLO su reporte en `progress/` (sigue read-only sobre el código).
- **Verificación:** `node scripts/check.mjs` verde en cada paso (typecheck + 15 RLS + 26 Edge + 19 Animal contra DB remota).
- **Recomendaciones priorizadas Ola 0/1** guardadas en `progress/plan.md` § "Recomendaciones priorizadas — próximas sesiones" (P0: design system; P1: día de campo + research SIGSA + validar seed con Facundo; P2: pre-refinar 04 / pull-left 09).
- **Commits de la sesión:** 3 pusheados por Raf (`c1cae84..2adcfd1`): (1) proceso/harness (Gate 0 + pipeline + ADR-022 + roadmap olas), (2) contexto de 03, (3) backend de spec 02. + 1 commit de cierre (fix `Write` en security_analyzer + recomendaciones priorizadas + cierre de sesión).
- **Próximo:** ver `plan.md` § Recomendaciones priorizadas. Resumen: design system (Raf, destraba frontend) → frontend 01 → 04/09 → 05/03; en paralelo research SIGSA + día de campo. Pendiente: validar seed de cría con Facundo.

---

## Sesión 16 — Research SIGSA (Ola 0, P1) (2026-05-28)

- **Agente:** claude (rol leader — research autónomo + edición directa de docs base/ADRs, sin implementer).
- **Origen:** item P1 long-lead de Ola 0 (research del formato de exportación SENASA, dueño leader, sin dependencias). Adelanta el long-lead de la feature 08; no abre la feature (sigue `pending`, no se escribió `context.md`).
- **Trabajo:** 2 agentes web en paralelo (formato + regulatorio). Output: `specs/active/08-export-sigsa/research-findings.md` (insumo pre-Gate-0, NO es spec).
- **Hallazgos clave:**
  - **Formato CONFIRMADO** (manual oficial SIGSA v2.42.80, dic 2025): archivo `.txt`, registro `RFID-SEXO-RAZA-MM/AAAA` por animal, separados por `;`. Ej: `032010000000000-M-H-08/2025;…`. RENSPA/especie/fecha-aplicación/motivo se eligen en pantalla, no van en el archivo. Feature viable HOY con info pública. Es upload manual, no API.
  - **Corrección de supuesto base (VERIFICADA contra el articulado del BO):** el "deadline julio 2026" NO existe en la norma vigente. Leído el texto Arts. 1°–30° de la Res. SENASA 841/2025 con citas: cronograma = terneros al destete desde 1/1/2026 + reposición natural, sin corte para adultos (Art. 3°); plazo de declaración 10 días hábiles (Art. 8°); campos = RFID+sexo+raza+fecha/mes-año nac. (Art. 8°); vías = oficina local / SIGSA / SIGBIOTRAZA (Art. 8°); responsable = el productor (Art. 5°). Raf eligió verificar antes de tocar docs base → verificación HECHA → Raf aprobó aplicar en docs base + ADRs.
  - **APLICADO:** reword en CLAUDE.md, feature_list.json, CONTEXT/01, CONTEXT/08, plan.md ("julio 2026" → "obligación vigente desde 1/1/2026 + reposición natural, declaración 10 días hábiles, Res. 841/2025"). ADRs corregidos (Raf confirmó que "julio 2026" fue error — la norma se anunció jul-2025, Res. 530/2025 BO 21/07/2025, rige desde 1/1/2026): ADR-002/005/009/017 (005 y 017 con reword semántico). Ya no queda "julio 2026" fuera de las líneas que documentan la corrección. Hitos de CONTEXT/08 ("pre-julio 2026") marcados "a re-evaluar por Raf" porque hoy (2026-05-28) la obligación ya rige.
  - SIGBIOTRAZA (app BLE→SIGSA directo) es competidor, no integrable. Oportunidad: RAFAQ como alternativa generando el TXT.
- **Incertidumbres abiertas** (en el doc §6): tabla completa de códigos de raza, si spec 02 captura raza/sexo/fecha-nac + RENSPA en establishments, validaciones server-side (probar upload real).
- **Commits:** ninguno en la sesión — cambios de sesión 16 quedaron sin commitear (M en CLAUDE.md, CONTEXT/01, CONTEXT/08, ADR-002/005/009/017, feature_list.json, plan.md, current.md + ?? specs/active/08-export-sigsa/).

---

## Sesión 17 — P0 design: ADR-018 bottom nav + Stitch home + ADR-023 + scaffold B.0 + refi 01/02 + home a mano (2026-05-28→29)

Trabajo de la sesión: **cerrar A.2 del plan** (estructura de navegación principal), una de las dos mitades del P0 design (la otra, A.1 design system, sigue siendo dueño Raf y depende de su fix manual en Figma).

Hecho:
- **ADR-018 escrito** (`docs/adr/ADR-018-estructura-navegacion-principal.md`, `Accepted`) + agregado al índice `docs/adr/README.md`. Formaliza el bottom nav de 5 items `[Inicio] [Animales] [⚡FAB Maniobra] [Reportes] [Más]`:
  - FAB central elevado = MODO MANIOBRAS (acción más crítica; verde botella `#1e5a3e`, ~64px, icono rayo, label "Maniobra").
  - Tab **Animales** = puerta manual de BUSCAR ANIMAL (`AnimalsTabScreen`, spec 09 R1), primer nivel de jerarquía (no submenú).
  - Regla transversal: el **bastón BLE es listener global, no una tab** — activo en todas las pantallas excepto MODO MANIOBRAS.
  - **Más** = settings + perfil + miembros/invitaciones (spec 01) + asignación masiva de caravanas (spec 09 R8) + switch de establecimiento.
  - 5 alternativas evaluadas y rechazadas (drawer, 4 tabs sin FAB, FAB para Buscar Animal, +5 items, top tab bar).
- **plan.md A.2** marcado `done` (sesión 17) con el output detallado. Bloqueante levantado: las secciones de navegación raíz de design.md de specs 01 y 09 dejan de citar "ADR-018 pending" y referencian el ADR al implementar B.1.
- **Cierre administrativo de sesión 16**: su resumen (research SIGSA) movido de `current.md` a `history.md` (no se había cerrado formalmente).

- **Home definitiva rediseñada vía Stitch** (A.1, avance grande). Raf descartó el fix manual de Figma → se prompteó Stitch (MCP, modelo GEMINI_3_1_PRO). Cambios aplicados y verificados con render local (Chrome headless): CTA "Crear rodeo" full-width, FAB elevado (⚡ centrado, ya no se superpone), hamburguesa → **switch de establecimiento** "La Juanita ▾", stepper riel único centrado (Paso 1 verde con "+"), banner descartable (✕), **fondo blanco neutro** `#faf9f9`. Canónica: `design/stitch-iter-4/00-home-CANONICAL.png` (screen `a5bac4039faf4a2abe5f808425b177bf`).
  - **Design system de Stitch corregido a nivel proyecto (v4)**: variant FIDELITY + `overrideNeutralColor #808080` → base blanco neutro (mató el tinte frío `#f8f9ff` de Material You de raíz, para todas las pantallas) + verde botella en containers + bone en cards. Lección y gotchas en `design/FRONTEND-STATUS.md` (el motor de color pisa el designMd; consistencia eventual; DOM-ops no persiste).
  - **Nuevo hueco de producto detectado**: pantalla "Mis campos" + landing por rol (owner vs vet). Anotado en `docs/backlog.md` (2026-05-29) + memoria. A resolver en sesión dedicada.

- **Workflow de frontend DEFINIDO por LLM Council → ADR-023** (`Accepted`). Se evaluó si Stitch es cuello de botella + se relevaron herramientas nuevas por web (Claude Design abr-2026, TapUI, Bolt — ninguna genera Tamagui nativo). Veredicto del council: (1) **componentes = deliverable, no pantallas**; (2) herramientas demotadas a inspiración, Stitch fuera del critical path; (3) hand-craft pantallas de alto impacto, generar las CRUD con agentes; (4) **lint guardrail** anti color/spacing hardcodeado (oráculo de QA + anti-drift); (5) **derivar el design system de construir la home a mano**, no canonizar en abstracto; (6) iterar en Expo real. Asesor más fuerte: Primeros Principios (test de cobertura). Punto ciego marcado: Expansionista (scope creep "generador como producto"). 
- **Hallazgo crítico**: `app/` es un Expo pelado — **el stack de ADR-013 (Tamagui/Expo Router/Reanimated) nunca se instaló**. Nuevo item **B.0 (scaffold)** en el plan, prerequisito duro.

- **B.0 — scaffold del stack ADR-013 DONE** (sesión 17). Tamagui 2.0.0 + Expo Router + Reanimated 4 instalados; `app/app/` con Expo Router + `(tabs)` + FAB elevado (ADR-018) como stubs; `tamagui.config.ts` provisional con tokens v4. typecheck + check.mjs + `expo export` verdes. Detalle en `progress/impl_B.0-scaffold-frontend.md`. Desviaciones: Reanimated 4 (no 3), bottom-tabs a mano, Node 20.13.1 < 20.19.4 (warning). Sin render en device aún.
- **"Mis campos" + landing por cantidad: DECIDIDO y formalizado** (sesión 17). Raf cerró la regla: ≥2 campos → pantalla "Mis campos" (landing de vets/multi-campo); ==1 → home directa + "Mis campos" vía switch del header. Folded en spec 01 `R6.6`-`R6.9` + flujo en su `design.md`. Backlog 2026-05-29 → RESUELTO; memoria actualizada. Se implementa en B.1.

- **Refi de edge cases sobre specs 01 y 02 (Gate 0 retroactivo) APROBADA por Raf (2026-05-29).** 2 auditorías en paralelo → 8 decisiones (switch dropdown + last_opened requerido + crear-campo-requiere-red en 01; baja/egreso con enum + mellizos MVP + detección blanda + transiciones-por-edad-no-automáticas + corrección de eventos tipados + cambio-de-rodeo-bloqueado en 02) + ~15 gaps foldeados. Aplicada por spec_author a requirements+design de ambas specs. Verificada (check verde, IDs sin colisión). Decisiones de criterio propio del spec_author aprobadas junto con la refi.
- **Delta backend de spec 02 PENDIENTE** (se desprende de la refi aprobada; spec 02 backend estaba "done", se reabre incremento acotado): agregar `created_by` a `animal_profiles` (confirmado: falta), `exit_reason` text→enum, tabla `birth_calves` + conteo de partos en compute_category, trigger de recálculo al editar/borrar evento, `weaning` en enum event_type si falta. Lo hace el implementer cuando toque (puede ir en paralelo a la home).

- **Diseño "Mis campos" RESUELTO** (sesión 17): card "híbrido adaptivo" (`EstablishmentCard`) + métrica hero adaptativa + slot de benchmark (off en MVP) + imagen default-generada/opcional + searchbar. Foldeado en R6.6.2 de spec 01 (req + design). Rollup de stats / vista mapa / benchmarking-post-beta → backlog.
- **Home a mano — Incremento 1 CONSTRUIDO y verde** (A.1 paso 2): componentes `Button`/`Card`/`Stepper` en `app/src/components/`, Inter cargada (con timeout-fallback en el gate de fuentes — fix de robustez anti splash-infinito), home armada en `app/app/(tabs)/index.tsx` contra el mockup canónico. 3/3 gates verdes (typecheck, check.mjs, expo export web). Detalle en `progress/impl_A.1-home-increment-1.md`. **Render NO verificado aún**: el preview web headless del leader está bloqueado por un mismatch react 19.2.3 vs react-dom 19.2.6 (web-only, NO afecta nativo); el veredicto "primer try" va en device (Raf con Metro). Dropdown del switch (R6.8.1) y EstablishmentCard quedan para incrementos siguientes.

**Render/preview RESUELTO vía WEB** (sesión 17): react-dom alineado a 19.2.3 (= react) → el React #527 murió, la home renderiza. Leader la screenshotea headless; Raf la ve con `pnpm.cmd web` en el navegador. **Device real bloqueado por gap de Expo:** SDK 56 salió 21-may-2026 y Expo Go SDK 56 NO está en App Store / Play Store (sin fecha) → la Expo Go de tienda (SDK 54) no carga el proyecto. NO es Cylance ni config de Raf. Decisión (sesión 17): **web para iterar diseño ahora**; device real = dev-build propio más adelante (o sideload Android del APK SDK 56). No requiere cuenta Expo ni MCP para correr local.
**Issue detectado en el render (para incremento 2): overflow horizontal** — el contenido se va más ancho que la pantalla (412px): se cortan a la derecha el avatar del header, el ✕ del banner, el CTA, el body de los pasos y el item "Más" del nav. Falta constreñir el contenido al ancho + padding simétrico.

- **Home a mano — Incremento 3 CONSTRUIDO y verde** (2 ajustes acotados, modo colaborativo, sin backend). Detalle en `progress/impl_A.2-home-increment-3.md`.
  - **Ajuste 1 — overflow horizontal en WEB resuelto** (el inc. 2 lo arregló para NATIVO con `flexShrink`, pero en react-native-web los flex items tienen `min-width:auto` y no encogen por debajo del ancho intrínseco de su contenido). Fix: `minWidth:0` en los contenedores flex con texto — columna de contenido + title + body del `Stepper`; Pressable/XStack/Text del switch del header; Text del banner en `index.tsx`. Defensa raíz: `width:100% + maxWidth:100% + overflow:hidden` en el `YStack` raíz y `maxWidth:100%` en el `ScrollView` (no rompe el scroll vertical). Sin tokens nuevos.
  - **Ajuste 2 — elevación del FAB bajada a ~57%** (Mercado Pago real medido): `FAB_RAISE_RATIO 0.66→0.57` → `size.fabRaise = round(64*0.57) = 36` (antes 42). Cruce: 36/64 = ~57% arriba / ~43% solapado. Anillo blanco + sombra intactos. Label "Maniobra" `marginTop $3→$2` para realinear.
  - **Render verificado headless (Edge + CDP `setDeviceMetricsOverride`) a 360 y 412px: 0 elementos exceden el viewport** (`docScrollWidth == clientWidth == viewport` en ambos). Avatar, ✕, CTA, bodies wrappeados y los 5 items del nav (incl. "Más") visibles. Lección: el screenshot por `--window-size` da falso corte (recorta la ventana del SO, no el viewport CSS); usar `Emulation.setDeviceMetricsOverride`. 3/3 gates verdes (typecheck, check.mjs, expo export web — `dist/` regenerado, bundle `entry-6b78c1e8…`).

Pendiente / próximo:
- **Raf abre la home con `pnpm.cmd web`** y da feedback → incremento 2 = arreglar el overflow horizontal + lo que Raf note.
- Construir incrementos siguientes: dropdown switch (R6.8.1), pantalla "Mis campos" + EstablishmentCard.
- Delta backend de spec 02 (ver arriba).
- **Node ≥20.19.4 es REQUERIDO** (NO es warning: `expo start` corta y no levanta con Node viejo). Raf tiene nvm-windows; actualizar con `nvm install 24.16.0 && nvm use 24.16.0` (pnpm vive en AppData\Roaming\npm, sobrevive el switch). `node scripts/check.mjs` igual corría con 20.13.1, pero el dev server de Expo no.
- Commits de sesión 16 y 17 sin commitear (Raf decide).


## Sesión 18 — Gate 0 refinamiento de contexto (08/04/09/03) + audits profundos + features 10/11 (2026-05-29)

Raf pidió pasar por Gate 0 (refinamiento de contexto + edge cases) de todo lo que quedaba por refinar. Alcance acordado (vía AskUserQuestion): **08 SIGSA** (ahora) → **04 bastón** (solo no-hardware) → **auditar edge cases de 09**; **05 balanza** diferida entera al día de campo; **06 labs / 07 reportes** diferidos a su momento (respeta buffer de ADR-022 — 06 necesita PDFs reales de CEDIVE, 07 se beneficia de uso real).

Hecho (3 `context.md` escritos, **TODOS pendientes de aprobación de Raf**):
- **`specs/active/08-export-sigsa/context.md`** — 4 decisiones de Raf: (1) **catálogo de razas con código SENASA** (delta spec 02: `breed` texto libre → referencia controlada + migración); (2) **RENSPA opcional** en establishments (delta spec 01); (3) **marcador `sigsa_declared_at` por animal + lista de pendientes + `export_log`** (audit); (4) **validar-y-bloquear** (lista "a completar" antes de generar). Scope MVP = solo alta de dispositivos. Sub-tareas pre-spec: extraer tabla de códigos de raza del manual + probar upload real contra SIGSA.
- **`specs/active/04-bluetooth-baston/context.md`** (parcial) — arquitectura ya contractualizada por spec 09 (`useBleStickListener`, provider, `useBusyMode`, mock). 3 decisiones: (1) **recordar bastón + reconexión automática**; (2) **dedup por TAG ~3s** (no rompe asignación masiva); (3) **feedback vibración+sonido(apagable)+visual**. **Hardware = BLOQUEANTE día de campo**: UUIDs + parsing del mensaje del Allflex RS420 (nRF Connect).
- **`specs/active/09-buscar-animal/context.md`** — auditoría de edge cases (Gate 0 retroactivo; 09 nunca tuvo la de 01/02). 1 agente Explore (~15 gaps) + verificación contra specs reales → mayoría ya cubiertos → **3 decisiones reales**: (D1) **bloquear cambio de campo** con flujo abierto (cubre R10.3); (D2) **transferencia mínima en MVP** cuando el TAG está activo en otro campo del usuario — ⚠️ **write cross-tenant → Gate 1** + convierte R4.11 de spec 02 de "futura" a flujo MVP; (D3) **set acotado editable inline + baja en sub-flujo aparte** (cubre R5.2).

**Profundización del audit (Raf pidió revisión cruzada más a fondo)** — lectura completa de spec 02 (493 líneas) + cruce con las decisiones nuevas. 5 hallazgos reales (3 introducidos en esta misma sesión), 4 decisiones de Raf:
- **🔴 Aborto sin transición** (spec 02): R6.2 tiene el evento `abortion` en el enum pero R7.1-R7.3 no lo manejan → una preñada que aborta queda "preñada" para siempre (rompe % preñez/analytics). **Decisión: manejar en MVP** — `abortion` revierte categoría + compute_category lo resta (categoría destino a confirmar con Facundo). **Delta nuevo sobre spec 02.**
- **🔴 Marcador SIGSA mal ubicado** (lo metí yo en 08): estaba "por animal global"; la declaración es por RENSPA/establecimiento. **Decisión: marcador por (establecimiento, animal)** — en `animal_profiles` o tabla `sigsa_declarations`. Corregido en el context de 08.
- **🔴 D2 transferencia — costo nuevo**: la versión "mínima" dejaba huérfano el timeline/linaje. **Decisión: transferencia que PRESERVA historia** (re-apunta eventos/vínculos al perfil nuevo). Es la opción más pesada (re-parenting cross-tenant, `session_id`/idv/linaje a resolver, **Gate 1**, candidata a sub-spec). Corregido en el context de 09.
- **🟡 RENSPA cardinalidad** (lo simplifiqué yo en 08): **Decisión: un RENSPA por establecimiento en MVP** (campo único; export deja tipear si hay multi-unidad). Confirmado.
- **🟡 Multípara comprada sin historial** (spec 02): compute_category cuenta partos del sistema; una comprada no los tiene → vaquillona salvo override. **Default (sin pregunta): MVP = override manual + documentar**; campo de paridad de ingreso → backlog analytics.

Deltas cross-spec actualizados (a coordinar al implementar; tocan backend ya `done`, se suman al delta de sesión 17):
- **spec 02**: catálogo de razas + migración de `breed` **y `reproductive_events.breed` + trigger de ternero al pie** (de 08); **transición de aborto** (revierte categoría + compute_category, nuevo); transferencia con **re-parenting de historia** + R4.11 "futura"→MVP (de 09 D2, **Gate 1**, candidata a sub-spec).
- **spec 01**: `renspa` opcional (único) en establishments (de 08); switch del header respeta guard "flujo abierto" (de 09 D1).

**Raf pidió audits profundos de TODO + re-parenting como sub-spec aparte.** Cobertura: spec 02 (full) + spec 09 (full) + contexts 04/08 + **03 (deep audit hecho)** + **01 (en curso)**.

**Audit profundo de 03 MODO MANIOBRAS (context s15 vs spec 02 s17/s18) — decisiones de Raf, foldadas en `specs/active/03-modo-maniobras/context.md` (refinamiento s18, pendiente aprobación):**
- **Contradicción rodeo-change corregida**: el context s15 ofrecía "pasar a este rodeo" (UPDATE rodeo_id), R4.5.1 (s17) lo bloqueaba. **Decisión: relajar R4.5.1 → mover de rodeo permitido dentro del mismo sistema** (delta spec 02).
- **Parto/aborto/destete = solo ficha (no maniobras)**: parto→ficha madre (mellizos acá), aborto→ficha madre, destete→ficha ternero (R7.8). Solo tacto/inseminación son maniobras reproductivas de manga.
- **Castración = evento individual (ficha) + operación masiva "castrar todo" (rodeo/lote, feature 10); NO maniobra de manga en MVP** ("quizás a futuro"). ⚠️ efecto de categoría pendiente Facundo (cría no tiene "novillo"); nuevo data_key `castracion` (delta spec 02 R2.13/ADR-021).
- **Animal de otro establecimiento en sesión (D2)**: avisar + saltar en la manga + sugerir "bastonealo después de las maniobras para transferirlo".
- **CONTEXT/03 sección "Lotes" STALE** (texto libre en sesiones vs `management_groups`/ADR-020) — flageado, pendiente reconciliar con OK de Raf.

**Scope NUEVO capturado (excede audit → feature propia + Gate 0, Raf decide):**
- **Operaciones masivas por rodeo** (destetar todo / castrar todo / vacunar todo) desde una **vista de rodeo**. "Vacunar todo" ya tiene sustrato (`sanitary_campaigns`).
- **Navegación rodeo-céntrica** → probable **reapertura de ADR-018** (no hay tab Rodeos hoy). Recomendación leader: feature nueva, no foldear en 03.

**Re-parenting de transferencia (09 D2) = SUB-SPEC APARTE** (decisión Raf s18). Candidata a feature nueva con Gate 1.

**Audit profundo de 01 identity (ya muy refinada en s17 → pocos hallazgos, los nuevos por cruce con D1/offline) — decisiones de Raf (deltas para foldar por spec_author en spec 01, no reescrito acá):**
- **`active_lost` + trabajo en curso/encolado** (cruce R6.10 + D1 + offline): te remueven/borran el campo con un form abierto o mutaciones offline encoladas → RLS las rechaza al sincronizar. **Decisión: informar + descartar** (form abierto: avisar y descartar; mutaciones encoladas: surface vía path de error de sync de 09 R11.5, "estos N cambios en campo X no se guardaron"). Delta R6.10.
- **R6.2 "cambiar en cualquier momento" vs guard D1**: foldear la excepción (switch bloqueado con flujo abierto). Delta R6.2/R6.8.1 (la decisión ya está en D1 de 09).
- **Aceptar invitación a campo soft-deleted**: R5.6 no lo rechaza → gap. Delta: R5.5/R5.6 rechaza si el establishment está soft-deleted.
- **Restaurar campo borrado**: **NO en MVP** (soft-delete del campo no reversible desde la UI; data persiste soft-linked; restore self-service post-MVP). Documentar en R3.6.
- **RENSPA** (delta 08): campo opcional en R3.3. **Acceso temporal del vet** (CONTEXT/07): NO modelado en `user_roles` (post-MVP/billing) — nota.

**ITEMS PARA FACUNDO (consolidado, bloquean cierre fino de varias specs):** categoría destino del aborto (02); efecto de categoría de castración (02/03 — ¿agregar "novillo"?); marca-en-madre opcional al destetar (02/03); lista de razas relevantes para el catálogo SENASA (08); seed de cría 26 fields (02, ya tentativo); peso al pie vs destete (03, ya backlog).

Pendiente / próximo:
- **✅ APROBADO por Raf (Gate 0, sesión 18)**: 08, 04, 09-audit, 03-refi, deltas 01/02. **Aplicado**: `feature_list.json` (08/04→`context_ready`, +features 10/11, deltas en 01/02/09), `plan.md` (changelog s18 + orden definir/refinar), `CONTEXT/07` (items Facundo).
- **Scan cruzado de consistencia HECHO (sesión 18, 3 agentes verificados contra el texto)**: confirmó consistente el núcleo (RLS, ortogonalidad de ejes, gating, modelo híbrido, terminología, nav). **Cazó 1 alucinación** (Agent B citó "CONTEXT/08:309" inexistente; el stale real está en CONTEXT/04:309-310). Arreglados stale: `CONTEXT/03` "Lotes"→ADR-020, `current.md` castración, `CONTEXT/04:310`→feature 11. **4 decisiones de Raf**: raza del ternero = heredar de la madre (cruza se corrige en ficha); op masiva + override = preview avisa + deja revertir; lote en transferencia → NULL; baja madre/toro = sin aviso (R4.15 ya preserva vínculo). Folds al bloque de delta de spec 02 (rama aborto/weaning, data_key castracion, R4.5.1→mismo-sistema, created_by en R4.1, enum tacto_vaquillona, migración de breed) + spec 09 (R5.5 sin ventana para eventos tipados).
- **Feature 10 (operaciones-rodeo)**: `context.md` + edge cases del scan foldeados. **✅ APROBADO por Raf → `context_ready`.**
- **Feature 11 (transferencia re-parenting)**: `context.md` Gate 0 completo. **✅ APROBADO por Raf → `context_ready`.** **Gate 1** obligatorio al spec-ear.
- **Bloque grande pendiente**: el delta backend de spec 02 (s17+s18) — planificar como bloque, no incremento.
- **Verificación dura 08**: confirmar formato EXACTO de SIGSA con upload real / login clave fiscal (Raf/Facundo).
- **Día de campo** sigue bloqueando: hardware de 04 (UUIDs Allflex) + 05 entera.
- **Para Facundo**: ver `CONTEXT/07` (aborto/categoría, castración/novillo, destete-madre, razas SENASA).

---

## Sesión 19 — cierre P0 design: nav firmado + skill design-review + higiene (2026-05-30)

Continuación del cierre del **P0 design** (A.1 design system + A.2 nav). El nav (A.2) quedó firmado y se estaba cerrando A.1.

Hecho:
- **Nav (ADR-018) FIRMADO por Raf** ("AHORA SI, ME ENCANTA") tras iteración fina del FAB central + halo + label, medida con CDP a 360/412px (no a ojo). Estado final en `app/app/(tabs)/_layout.tsx`: FAB flota ~55% sobre la barra (`fabRaise=35`), halo verde pálido absoluto detrás (no empuja layout), label **"Maniobra"** con distinción intencional (negro/negrita/12px, bajado a -2px). `navBar=60` + `max(insets.bottom, navBottomMin=12)`. Cero hardcode (tokens vía `getTokenValue`).
- **Skill `design-review` creada y APROBADA** (`.claude/skills/design-review/SKILL.md`): procedimiento (lluvia de ideas + análisis ANTES de implementar · vetear ANTES de mostrar · medir-no-estimar · tubería CDP) + criterios (Nielsen 10, Laws of UX, mobile/HIG/thumb-zone, Gestalt/tercios) + criticidad manga GRADUADA (🔴 manga-only = máximo no negociable; 🟡 mixtas = con margen) + checklist. Complementa las memorias `feedback-design-pro-analysis` + `feedback-design-vet-before-showing`.
- **Higiene**: trim de current.md (s17+s18 a history); matados artefactos colgados del pipeline de preview (2 `http.server` + 2 Chrome headless); limpiadas 14 capturas intermedias de `design/stitch-iter-4/` (2.3M→737KB, conservado el set canónico).

En curso al cerrar (continúa en `plan.md` A.1):
- **Canonización del design system (cierre A.1 / ADR-023)**: `tamagui.config.ts` canónico, `docs/design-system.md` sin DRAFT, `design/tokens.json`, lint anti-hardcode (ADR-023 §4). Luego: dropdown del switch (R6.8.1) → "Mis campos" + `EstablishmentCard`. **Pausada** al pivotar al backend.

_Cierre: Raf pivotea al bloque backend de spec 02 (sesión 20). Features 10/11 ya `context_ready`. El delta backend de spec 02 es un **bloque**, no un incremento acotado._

---

## Sesión 20 — Tier 1 backend spec 02 + canonización design + frontends (Animales/Mis campos) + día de campo 04 (2026-05-30)

Sesión larga y multi-hebra (terminales en paralelo). Cerró el delta backend Tier 1 de spec 02, canonizó el design system (A.1), construyó dos pantallas de frontend, redactó spec 03 en paralelo y trajo un **hallazgo bloqueante de hardware** del día de campo.

Hecho:
- **Spec 02 — delta backend Tier 1 (DONE)**. Pipeline SDD completo en autónomo: `spec_author` foldeó Tier 1 (R4.1 `created_by`, R4.5.1 mismo-sistema, `exit_reason` enum, `birth_calves` + conteo de partos, recálculo R6.14) → **Gate 1 FAIL** (2 HIGH + 2 MEDIUM, clase SEC-HIGH-01) → endurecido (`has_role_in` en `exit_animal_profile`, RPC `register_birth` con SQL firme + grant acotado, `created_by` forzado server-side, `birth_calves` select-only + `deleted_at`) → **Gate 1 re-audit PASS** → `implementer` migrations **0043-0049** (aplicadas a remoto) → suite animal **19→28** verde (T2.19: 6 no-bypass + L2 + R4.5.1 + rollback) → `reviewer` APPROVED → **Gate 2 PASS** → ✅ **Raf aprobó**. **Tier 2/3 diferidos a Facundo** (targets aborto/destete, razas SENASA, efecto castración). Deuda L1 (`soft_delete_event` sin `has_role_in`) → backlog. Backlog s14-20 commiteado en commits temáticos.
- **A.1 — design system v4 CANONIZADO** (cierra el item A.1 del plan). Draft "Campo Profundo" archivado en `design/explorations/`; `docs/design-system.md` reescrito como **v4 canónico** (blanco neutro / verde botella `#1e5a3e` / bone `#F8F6F1` / terracota, **light-only**, derivado del build per ADR-023); `tamagui.config.ts` des-provisionalizado; **lint anti-hardcode** (`scripts/check-hardcode.mjs`, cableado en `check.mjs`, 0 excepciones). Análisis pro (skill `design-review`) + **fix de contraste medido WCAG** (`textFaint` 2.40→4.03 redefinido terciario, `textMuted`/`terracota` recalibrados AA holgado para sol de manga). **Frontend DESTRABADO.** Colores de estado + dark → JIT/post-MVP.
- **Frontend "Mis campos"** (spec 01 R6.6-R6.9, design-track). `EstablishmentCard` (variante A banner-strip, métrica hero adaptativa) + pantalla `mis-campos.tsx` (orden activo+alfabético, searchbar >8, CTAs) + `EstablishmentSwitcherDropdown` (R6.8.1, cableado al header de la home). Vetado CDP. **Fix latente cazado en el veteo**: `accessibilityRole` se filtraba al DOM en TODOS los botones (`Button.tsx`) → split por plataforma. Commit `fa753d3` (front-only).
- **Frontend tab Animales** (spec 09 R1, puerta manual de BUSCAR ANIMAL 🔴 core). `AnimalRow` (fila MP-Actividad: avatar glifo-sexo/foto-JIT + ID hero que popea + "sin caravana") + `AnimalsTabScreen` (buscador XL permanente, chips de filtro, lista mock, estados sin-match R1.4 + vacío). Lluvia analizada (fila MP sobre card-foto/ID-gigante). Paleta de estado **diferida** (texto neutro). Vetado CDP 360+412 + estado sin-match. Commit `57cafe2`.
- **[paralelo] Spec 03 MODO MANIOBRAS redactada** → `spec_ready`. 12 US / ~70 reqs + 28 tasks; tablas `sessions` + `maneuver_presets`, FK `session_id` en las 5 tablas de evento, gating capa 2. **Gate 1 pendiente** (schema-sensitive). 7 decisiones abiertas + 3 conflictos para Raf (design §9). Commit `2421cf3`.
- **[día de campo] Spec 04 — hallazgo BLOQUEANTE** (leader + Raf, bastón conectado). El Allflex RS420 usa **Bluetooth Classic (SPP + iAP/MFi), NO BLE** → `react-native-ble-plx` (ADR-002) no puede hablarle. Android viable vía SPP nativo; iOS requiere cert MFi. TAG confirmado (ISO 11784/11785 FDX-B, 15 díg, prefijo 982); transmite en vivo por SPP (protocolo capturado COM9). `specs/active/04-bluetooth-baston/field-findings.md` + evidencia. Commit `f7aa050`. **Requiere ADR de transporte antes de foldear spec 04.**

Pendiente / próximo (orden en `plan.md`):
- 🔴 **ADR de transporte del bastón** (spec 04): SPP nativo Android / MFi iOS / bridge VESTA_BRIDGE. BLOQUEA spec 04 + revisa supuesto BLE de ADR-002/CONTEXT-05.
- **Spec 03 Gate 1** (security_analyzer modo spec) + resolver las 7 decisiones abiertas + 3 conflictos antes de aprobar/implementar.
- **Spec 02 Tier 2/3** → Facundo (targets de transición, razas SENASA, castración).
- **Frontend**: ficha de animal (pantalla EDIT R5, destino del tap de `AnimalRow`); refinamiento hero-identificador de `AnimalRow` (IDV vs visual — duda de dominio para Facundo); routing landing-por-cantidad de "Mis campos" (Inc 4, R6.7 + active_lost R6.10); wiring de stats reales (backlog).
- **Verificación dura 08**: formato EXACTO de SIGSA con upload real.

_Cierre: Raf pidió commitear todo (4 commits: front Animales, spec 03, día de campo 04, cierre) y cerrar sesión. El hallazgo del bastón es el bloqueante de mayor prioridad para la próxima sesión._

---

## 2026-06-04/05 — Hardening de seguridad (ampliación security_analyzer → 2 features HIGH cerradas en prod)

- **Agentes:** leader + implementer/reviewer/spec_author/security_analyzer (ciclo SDD completo, autónomo, pausando en puertas humanas) + LLM Council (5 asesores) para B3-1. Terminal paralela activa en feature 2 (alta guiada).
- **Disparador:** Raf pidió ampliar el `security_analyzer` (validar inputs de formularios/buscadores/prompts con límites + validación; verificar rate limits). El leader cuestionó y escaló a un catálogo completo de clases de defecto.
- **security_analyzer ampliado** (`.claude/agents/security_analyzer.md`): validación de inputs (capa cliente UX bypasseable vs autoritativa server) + rate limits + **Catálogo de dominios A–I** (authz/service-role/mass-assignment/IDOR · exposición/err.message/PII · offline/PowerSync/data-at-rest · secretos/supply-chain · abuso-escala/DoW/captcha/enumeration · inyección/ingesta/SSRF · BLE · auth/sesión · compliance/mobile) + 3 tablas de trazabilidad. Leader Gate 1: auto-trigger ampliado (cualquier campo que el usuario tipea). Commits `99fa631` (agente) + `1847159` (baseline).
- **Auditoría baseline** (`progress/security_baseline_shipped.md`): 3 HIGH / 6 MEDIUM / 4 LOW del código mergeado. HIGH: B3-1 (PII coworkers), INPUT-1 (sin tope server), H2-1 (password 6 vs 8). Service-role de las 8 EFs verificado LIMPIO (corrigió un supuesto del leader).
- **Feature 14 `14-pii-user-private` (B3-1) — DONE + desplegada + committeada (`0ef6736`):** la PII de contacto (email/phone) era legible por cualquier coworker vía PostgREST directo (RLS es row-level). Council unánime → **opción D**: separar a tabla `user_private` self-only (única defensa que cierra la PII también en el canal WAL de realtime/PowerSync; views/RPC/column-GRANTs no). **ADR-025** fija el patrón. Migración 0068 (backfill + drop columns + trigger de propagación de email confirmado) aplicada vía Management API (MCP read-only); EFs re-ruteadas. Verificado por test: coworker no ve PII ajena.
- **Feature 13 `13-hardening-seguridad` (5 fixes) — DONE + desplegada + committeada (`1da96a4`):** INPUT-1 (CHECK char_length en 45 columnas/15 tablas, migración 0070), B1-1 (helper `serverError`, ningún err.message crudo al cliente en las 8 EFs), A1-1 (`animals_update` con `with check` que re-valida has_role_in, 0071), F1-1 (buscador parametrizado `.ilike` + tope de término), H1-1 (RPC `revoke_user_sessions` que borra `auth.sessions`, 0072 — el ban finito de 1s NO revocaba la sesión, probado empíricamente; el RPC sí, persistente). 3 migraciones + 8 EFs en prod.
- **Verificación adversarial (no pasamanos):** correr reviewer + Gate 2 + prueba empírica cazó 2 bugs que un gate solo dejaba pasar (el ban de H1-1; el Gate 2 que se equivocó afirmando que revocaba). Aplicar de verdad + validar contra data real cazó 4 colisiones invisibles a los gates estáticos (colisión 13↔14 por email/phone, basura de e2e en tag_electronic, deadlock con la terminal paralela, cap de tags vs fixtures de test).
- **Reglas/memoria nuevas:** toda corrección de código se reconcilia en la spec antes de cerrar (`feedback_correcciones_en_specs`). Specs de 13 reconciliadas con las 4 correcciones del deploy.
- **Config:** `minimum_password_length` 6→8 (config.toml committeado `6a92ceb` + aplicado al Auth remoto vía Management API). Stop hook arreglado (feature 1 `in_progress`→`deferred`: su B.1 estaba done y rompía one_feature_at_a_time).
- **Terminal paralela (feature 2):** Tier 2/3 modelo de categorías de cría (novillito/novillo + castración + transiciones + cría al pie, commit `0496387`) + orden del timeline (`57ffe09`) + **alta guiada A+B** (wizard rodeo→sexo→categoría→datos por categoría + override por preñez + año-only, `06d2273`).
- **Pendiente:** [Raf] web-check de feature 14 (perfil/cambiar-email); captcha Turnstile (necesita cuenta+secret) + decisión email-confirmation (E3-1). [Backlog] limpiar data de e2e de prod antes del beta de Chascomús; `deno check` de EFs al pipeline; residuales MEDIUM (A1-1-resto column-level write authz, H1-1 access-token ~1h cubierto por RLS). [Coordinación] `current.md` se limpió esta sesión.
- **Cierre:** los 2 findings HIGH explotables (B3-1, INPUT-1) cerrados de punta a punta en producción y committeados. Todo gateado (Gate 1/reviewer/Gate 2) y documentado.

---

## 2026-06-06/07 — Feature 04 (bastón: capa buildable + harness web), Feature 12 (import masivo end-to-end + CERRADA), C3.3 baja de animal

- **Agentes:** leader + implementer/reviewer/spec_author/security_analyzer (ciclo SDD autónomo, pausa solo en puertas humanas + decisiones reales). Terminal paralela activa en spec 02 C3.3.
- **Feature 04 bastón — capa buildable-hoy ✅ DONE (el RESTO `deferred` por hardware):** todo en `app/src/services/ble/` (contrato de ingesta reusa `parser-rs420.ts` + confirmación pre-commit + feedback + adapters manual/web-serial/mock + interfaz `StickAdapter` + provider/hooks con la firma EXACTA de spec 09 + offline/no-read/permisos). 75/75 tests BLE + reviewer APPROVED + Gate 2 PASS. **Pantalla de TEST WEB** (`app/app/baston-test.tsx`, navegable en `localhost:8081/baston-test`) para la prueba real con el RS420 en `pnpm web` (lo que Raf tiene hoy): monta su propio provider + `WebSerialAdapter` + engine, ejercita el código committeado end-to-end. Bypass de gating dev-web en `_layout.tsx` (`DEV_WEB_ROUTES`). DEFERIDO: spp-android, hid-wedge (gate físico iPhone), pantalla de conexión R9, prueba real RS420 (T2.5), MFi-Allflex (Facundo). **ADR-024** cerró que el RS420 NO es BLE GATT (es BT Classic SPP/iAP-MFi). `CONTEXT/07` actualizado con el hardware del bastón.
- **Feature 12 import masivo de rodeo — ✅ DONE + CERRADA (puerta de código de Raf, "cerra 12", 2026-06-07):** el enabler del beta de Chascomús (cargar el padrón entero desde planilla/SIGSA sin esperar a colocar TAGs).
  - **Implementación completa (2026-06-06), 5 commits, todas las fases con reviewer APPROVED + Gate 2 PASS:** spec `ebec9d5` → backend (`import_log` 0073 + RPC `import_rodeo_bulk` SECURITY DEFINER 0074, aplicadas al remoto vía Management API) + utils puros `e2ee997` → service `67d8619` → parser `.xlsx` (SheetJS vetado del CDN, post-CVE) `dfef10f` → wizard 4 pasos + entry point `4e1b6d5`. **Gate 1 PASS** (0 HIGH). **Puerta 1 (Raf):** D1=`.xlsx` en MVP con parser vetado; D2=Escenario B (RPC bulk SECURITY DEFINER); D3=categoría placeholder → Facundo; D4=topes 5MB/5000. **Gate 2 cazó 1 HIGH** (SEC-12B-HIGH-01: el cap de 5000 filas vivía solo en el cliente → DoW) → fix-loop → cap server-side en el RPC, verificado adversarialmente por el leader (orden authz→cap, tests de borde).
  - **Cierre (2026-06-07, probando en vivo con Raf — cada bug que reportó se arregló):** `3ae4478` mapeo SOURCE-DRIVEN (una fila por COLUMNA + muestra de datos + combo de campos fijos) + componente `Select` reutilizable, corrige el "Caravana electrónica = sexo" (inspo Mobbin/Expensify); `cd2b6c8` `parse-csv` auto-detecta delimitador `,`/`;`/tab (Excel es-AR exporta `;`, leía todo en una columna), R3.9; `f10ed27` el preview AVISA categorías declaradas que no matchean el catálogo (el "Vaca→vaquillona"), visibilidad client-side sin adivinar el dominio, R10.7; `8576369` e2e `rodeos.spec.ts` descarta el `OnboardingImportOffer` (3/3 verde Playwright). Cierre `5c8acc0` (status `done` + reconciliación). Cada fix: veto de diseño del leader + check.mjs verde + spec reconciliada.
  - **DEFERIDO a Facundo (D3, no bloquea):** qué hace una "Vaca" genérica declarada (no existe `code` 'vaca' en el catálogo de cría — se parte en multipara/2do-servicio/cabaña; el RPC matchea solo por `code` exacto). Opciones anotadas en `CONTEXT/07-pendientes.md`. Spec 12 queda en `specs/active/` por ese hilo abierto.
- **Spec 02 C3.3 — baja/egreso de animal desde la ficha (TERMINAL PARALELA) ✅ DONE + committeada (`5a4f34a`):** en RAFAQ no se borra, se da de baja (archivar con motivo Venta/Muerte/Transferencia, preserva historia). Frontend + servicio sobre el RPC `exit_animal_profile` ya gateado (0044). Gate 0 con Raf, reviewer APPROVED, Gate 2 PASS 0 HIGH (1 MED al backlog: `exit_weight`/`exit_price` sin CHECK>0 DB). Spec 02 sigue `deferred` (C4 lotes + C5 PowerSync pendientes).
- **Pendiente:** [Facundo] D3 categoría "Vaca" genérica del import; CE toritos (3 momentos/unidad); pricing; campos temporales vet. [Raf] web-check feature 14; live test del bastón con RS420 en web. [Backlog] limpiar data de e2e de prod antes del beta; MED-01 CHECK>0 en exit_weight/price; rate-limit de frecuencia de import; `deno check` de EFs al pipeline.
- **Cierre:** feature 12 cerrada de punta a punta (el enabler del beta), feature 04 con capa buildable + harness para el RS420, C3.3 baja de animal cerrada en paralelo. Todo verde (`check.mjs` + e2e Playwright), gateado y reconciliado. Raf pidió cerrar la sesión y dejar `current.md` limpio.

---

## 2026-06-07 — Spec 02 C4 (frontend de lotes / `management_groups`) — DONE + committeada (`36c5437`)

- **Agentes:** leader + implementer/reviewer/security_analyzer + general-purpose (captura CDP para el veto de diseño). Ciclo SDD autónomo, pausa solo en puertas humanas + decisiones reales.
- **Arranque:** Raf preguntó si había trabajo paralelo colisión-safe para 2 terminales; el leader mapeó el estado (nada `in_progress`, slot libre) y ofreció **spec 11 (transferencia) como spec colisión-safe** para una 2da terminal. Raf preguntó cómo destrabar **PowerSync** → el leader le dio los pasos (Cloud, no self-hosted por Docker bloqueado; prep de publication + instancia + auth Supabase JWT + sync-rules por establishment; el cliente C5 lo cablea el leader; feature 14 ya dejó la PII fuera del WAL) → Raf lo **parkeó**.
- **Feature 10 (masivas) descartada para implementar ya:** el leader la propuso (spec_ready + Gate 1 PASS) pero al vetarla **cazó que está STALE vs el backend Tier 2 de Facundo** — la castración masiva está specceada como `sanitary_events` marker, pero el efecto de categoría as-built (`0064`) dispara sobre `animals.is_castrated` → como está, crearía eventos sin transicionar categoría. Además: **conflicto de Puerta 1** (`feature_list` dice PENDIENTE, `requirements.md` dice APROBADA — sin confirmar por Raf) + scope (Inicio rodeo-céntrico = rebuild; vistas de lote dependen de C4). → spec 10 **on-deck, a reconciliar antes de implementar**. Raf eligió **C4 lotes primero** (limpio, prereq de la mitad lote de 10).
- **C4 lotes — DONE:** Gate 0 con Raf (`context-c4-lotes.md`): D1 borrar = reasignar animales a NULL + soft-delete; D2 gestión junto a Rodeos (`/lotes`); D3 ver-miembros (la vista de grupo rodeo-céntrica + agrupamiento en Inicio + aviso "N sin lote" = spec 10, NO se tocó). Entregado: `management-groups.ts` (CRUD), `management-group.ts` (validación + gating por rol, 8 unit tests), `LotesScreen` (`/lotes`, crear/renombrar/borrar owner + ver-miembros), `LoteControl` en la ficha (asignar/cambiar/quitar + quick-create owner), entry points (Rodeos + Más), e2e `lotes.spec.ts` (2/2). FRONTEND PURO (backend `0037` ya aplicado) → Gate 1 N/A.
- **Falso "bloqueante de backend" cazado por el leader (no pasamanos):** el implementer reportó que el owner no podía soft-deletear lotes (`UPDATE deleted_at` → 42501) y lo declaró bug de backend que "también rompe rodeos". El leader lo refutó: el 42501 es el **gotcha de visibilidad de PostgREST documentado en `0041`**, y el RPC `soft_delete_management_group` (0041, SECURITY DEFINER owner-only) **ya existía** para eso; rodeos borra vía `soft_delete_rodeo` (nunca estuvo roto). Fix-loop → el service usa el RPC. (El Gate 0 original asumió "sin RPC" — error del leader, corregido en `context-c4-lotes.md`.)
- **Gates:** reviewer APPROVED + Gate 2 PASS 0 HIGH (clear-NULL no es bypass cross-tenant; sin service-role; inputs con CHECK server-side) + veto de diseño del leader (8 capturas CDP a viewport mobile, clasificación 🟡 mixta) + **puerta de código de Raf** en vivo. 3 iteraciones del "Crear lote nuevo" en el combo de la ficha (quedó CTA centrada con divisor + "+" a la izq; centrado imperfecto, aceptado por Raf). `check.mjs` verde (628 unit + e2e lotes 2/2). Commit `36c5437` (19 archivos).
- **Estado:** spec 02 vuelve a `deferred` — queda **C5 PowerSync** (bloqueado por infra de Raf). Backlog: error-copy de create/rename de lotes (MEDIUM-1 transversal), member-count en card colapsada, "Eliminar lote" siempre visible.
- **Pendiente:** [Raf] provisionar PowerSync (prep lista cuando diga); live test bastón RS420; web-check feature 14. [Leader, on-deck] reconciliación de spec 10 vs Tier 2 + confirmar conflicto de Puerta 1. [Facundo] D3 import; CE toritos; pricing. [Backlog] limpiar data e2e de prod; polish C4.
- **Cierre:** C4 cerrado de punta a punta y committeado. Raf pidió cerrar la sesión.

---

## 2026-06-08/09/10 — Feature 15 PowerSync (offline-first end-to-end, in_progress) + bugfixes del alta offline

- **Agentes:** leader + implementer/reviewer/spec_author/security_analyzer (ciclo SDD autónomo; pausa solo en puertas humanas + decisiones reales). Sesión multi-día de una feature multi-run.
- **Provisioning + spec + gates (06-08):** instancia PowerSync Cloud `rafaq-beta` (BR) con Raf hands-on; Gate 0 APROBADO (D1 data offline/identidad online, D2 dual SDK, LWW MVP); spec R1-R12 + Gate 1 en 3 ciclos FAIL→fix→PASS (HIGH-1 streams deleted_at; HIGH-D1 IDOR por replay de register_birth → guard scopeado + índice compuesto 0075); Puerta 1 APROBADA (outbox+RPC-mapping offline; roles offline owner-only).
- **Runs 1-8 + T6 + T9.8/T9.9:** cimientos cliente (AppSchema 26 tablas + overlay localOnly `pending_*` + outbox insertOnly `op_intents`, factory web/native, connector); delta 0075 (idempotencia register_birth) aplicado; swap de LECTURA total (T3 catálogos/identidad + T4 animals/events/timeline/lotes → SQLite local, builders puros + I/O separado); swap de ESCRITURA (T5 CRUD plano local; T6 outbox+overlay+RPC-mapping con clear/rollback por client_op_id; T9.8 create_rodeo RPC 0081 + T9.9 set_rodeo_config RPC 0082 offline); online-guard (writes online-only fast-fail "Necesitás conexión").
- **SAGA DE BUCKETS (PSYNC_S2305):** V1 (subselects) y V2 (INNER JOIN, re-Gate 1 PASS) REVENTARON en runtime (PowerSync evalúa cada tabla del JOIN como parameter query sin scope → 102 campos × streams > 1000 buckets). LECCIÓN: la semántica de buckets solo se ve en runtime; Gate 1 valida autorización, NO el límite operativo. **V3 JOIN-FREE vigente**: cada tabla filtra directo por `establishment_id`; trigger+guard 0076 (roles ⇔ campo vivo, 2 mitades del invariante); denormalización 0077-0080 (establishment_id en 8 hijas + identidad de animal en perfiles b1 + member_name c2, ADR-026) → **25 streams / 43 buckets, validado en vivo**, independiente del volumen (DB beta contaminada con 344K animals de test).
- **Fix showstopper firstSync-gate (06-09):** el gate de establecimiento y las lecturas resolvían el SQLite local ANTES del first-sync → onboarding fantasma/listas vacías. `waitForUsableSync` + re-evaluación en la transición first-sync + `lastSyncedAt` en tabs. + Run residuales-offline: crear-campo con id de cliente + aterrizaje optimista; exit_date en overlay; stepper. E2E 18/18.
- **🐛 Bugfix del día (06-10), 2 causas raíz — ambas cerradas y gateadas (commit `656a44d`):**
  - **Causa 1 (UI, Run bugfix-overlay-list):** "animal creado offline desaparece al navegar de tab" — la tab re-corría la LISTA al re-enfocar pero NO la búsqueda activa → no-match stale. Fix `runSearch` en useFocusEffect+lastSyncedAt. Diagnóstico con repro E2E instrumentado (dump SQLite local): overlay SANO, hipótesis de rollback/JOIN/contexto descartadas con evidencia. Primeros tests offline reales de la suite (`animals-offline.spec.ts`).
  - **Causa 2 (PÉRDIDA REAL, Run create-animal-rpc):** Raf re-reprodujo; el leader la cazó con logs API + DB remota — el alta como 2 upserts no atómicos se auto-envenenaba en el reintento (half-state → ON CONFLICT DO UPDATE en `animals` → policy UPDATE exige perfil visible → 42501/403 → permanent_reject → rollbackOverlay → dato descartado; "12"/"211" de Raf irrecuperables). **Fix: RPC `create_animal` atómica e idempotente (0083, APLICADA)** — authz primero, ON CONFLICT (id) DO NOTHING solo-PK, guards anti-IDOR patrón 0081, HEALING del half-state; upload.ts traduce el shape histórico de intents encolados. + **oráculo E2E de persistencia server-side** (el gap que dejó pasar el bug: los tests miraban la UI/overlay, no el server) — prueba A/B del reviewer: contra el build viejo el oráculo cazó la cadena en vivo. Gates por run: reviewer APPROVED + Gate 1 PASS 0 HIGH + Gate 2 PASS 0 HIGH. Validado con el caso real de Raf (alta offline "1212" + 4 eventos aterrizaron).
  - Gotcha de soporte cazado en vivo: **pestañas duplicadas de la app** bloquean el socket de PowerSync web (lock del SQLite) → la UI queda "Sin conexión" estando online.
- **Migraciones aplicadas al remoto en el bloque:** 0075-0082 (sesiones 08/09) + **0083** (06-10, autorizada por Raf, Management API).
- **Pendiente:** [feature 15] T7 (tests E2E restantes) + T8 native (dev build Android); puerta de código final al cerrar la feature. [Backlog nuevo] transiciones de categoría no visibles offline (recálculo server-side; golpeó 2 veces a Raf — espejo client-side o hint de UI, decidir alcance); ProfileContext pegado en "Sin conexión" pre-first-sync; surfacing UI de rechazos permanentes de upload; entry_weight sin CHECK de rango (con MED-01); huérfanos de animals → limpieza DB beta; migración a useQuery/watch.
- **Notas técnicas vigentes:** pnpm vía Bash (Cylance bloquea PowerShell); Node ≥20.19.4; web (`pnpm web`) hasta el dev build; migraciones por `scripts/apply-migration.mjs` (Management API, MCP read-only); E2E con `pnpm e2e:build` primero (dist/ stale en silencio); numeración as-built llega a **0083**.
- **Cierre:** capa de sync completa + escritura offline end-to-end + los 2 bugs del alta offline cerrados con evidencia. Commits `656a44d` + `2e8d87b`. check.mjs verde. Raf pidió cerrar la sesión.

---

## 2026-06-10/11 — Cierre de tests de feature 15 + Gate 0 v2 y spec 10 reconciliada + chunk C6 (espejo de categorías) end-to-end

- **Agentes:** leader + implementer/reviewer (Opus, regla nueva) + spec_author/security_analyzer (Fable) + general-purpose (capturas). Ciclo SDD autónomo; pausa solo en puertas humanas. Sesión multi-día con corte por session limit en el medio (reanudada post-reset 3am sin pérdida).
- **Reglas/config nuevas (pedidos de Raf, persistidos en memoria + hook):** (1) implementer/reviewer SIEMPRE con `model: opus`; (2) hook `Stop` global (`~/.claude/hooks/stop-push-reminder.mjs`) que fuerza PushNotification al terminar turnos esperando a Raf — "push siempre", sin excepción por foco de terminal (suele estar AFK).
- **Feature 15 — bloque de tests CERRADO + COMMITEADO (`11999e6`) → feature `deferred` (scope web completo):** Run T7 (suite no-bypass `supabase/tests/sync_streams/run.cjs` 25 subtests — la frontera de autorización de las 25 streams V3, enganchada al check; E2E peso offline con oráculo server-side) + Run T7.9 (parto offline mono/mellizos con oráculo "EXACTAMENTE 1 birth", baja offline, **rollback in-vivo del overlay** por madre soft-deleteada 23503, contraprueba transitoria). Gates ×2: reviewer APPROVED (con **mutation-test empírico**: sin filtro de tenant fallan 12 subtests; restaurado byte-idéntico) + Gate 2 PASS 0 HIGH. **Los 8 e2e rojos de otros specs: CONFIRMADOS PRE-EXISTENTES** en worktree limpio sobre HEAD (fallos de aserción, no de red) → backlog con triage. T8 (native) diferido al dev build Android. Incidente: un reviewer murió por corte de RED de la máquina (DNS caído) → watcher de conectividad → relanzado al recuperarse.
- **Gap "transiciones de categoría no visibles offline" — DECIDIDO + Gate 0 (chunk C6):** opción A de Raf = espejo client-side display-only de `compute_category` + badge de override ("1212" NO era bug offline: tenía `category_override=true` y el server no transiciona ni online, R4.9 — gap de comunicación). `context-c6-categoria-espejo.md` aprobado.
- **Spec 10 — RE-GATE-0 v2 + RECONCILIACIÓN COMPLETA + COMMITEADA (`2cbd1ca`), spec_ready ON-DECK:** Raf trajo de Facundo el rediseño de la castración masiva → refinado eje por eje en chat (mockups ASCII en AskUserQuestion + refs Mobbin: Apple Wallet/Todoist): **Castrar/Destetar = selección explícita** (checkbox por animal, secciones por categoría con defaults — terneros tildados, ⭐ futuros toritos y adultos no —, warning terracota sin modal, CTA con número vivo, bottom-sheet con copy REVERSIBLE), **flag `future_bull`** (ficha-only, badge solo positivo, auto-clear al castrar), **castrado = ESTADO editable reversible** (NO evento — "descastrar" no existe; la historia queda en category_history; cae el data_key castracion/gating/marker del diseño viejo). Staleness vs Tier 2 corregida (R5.5 weaning transiciona solo; R5.7 efecto definido; RT2.2.6 superseded). Delta backend nuevo: `future_bull` + **denorm `is_castrated` con write-through perfil→animals** (cierra F1 de C6) + recompute simétrico. Gate 1 re-corrido PASS 0 HIGH (write-through sin escalamiento, A1-1 intacto) + 2 MED foldeados + **Puerta 1 re-aprobada** con LIM-1=mitigar con observación automática y LIM-2=tolerar-y-saltear (pre-filtro espejo de rodeo_check, RAISE LOG sin skip-report UI anti-leak) + re-chequeo puntual PASS (equivalencia exacta verificada).
- **Chunk C6 — DONE + COMMITEADO (`969dadc`, puerta de código de Raf) → feature 2 `deferred`:** espejo COMPLETO de `compute_category` en TS puro (fixtures espejo de la matriz server T2.21-T2.30 = defensa anti-drift; desempate por índice en doble-null de created_at, RC6.1.4, cazado con e2e de aborto offline), display-only en ficha/lista/búsqueda (overlay incluido, CERO writes, fail-safe), `CategoryOverrideCard` (badge + quitar fijación con **consecuencia visible** "La categoría pasará a X" — RC6.4.6, fix del veto de diseño del leader; preview sobre la MISMA resolución que el revert), inferencia `is_castrated` transitoria. **El implementer murió por session limit a ~170 tool-uses → relevo que assesló el diff heredado y lo cerró con CERO fixes.** Gates: reviewer APPROVED + Gate 2 PASS 0 HIGH + veto de diseño PASS (capturas reales 412/360, 1 iteración). check exit 0, 140/140 unit, e2e C6 2/2, **los 2 e2e de transición antes rojos (events 190/279) ahora VERDES**.
- **Pendiente / próximo:** [SIGUIENTE SESIÓN] **implementar spec 10** (todo verde, delta backend ≥0084 con Gate 1 hecho) — arrancar fresca con el protocolo. [Terminal paralela opcional] redactar spec 11 (transferencia, context_ready). [Raf] dev build Android (T8 de 15 + spp-android de 04) · live test RS420 web · web-check feature 14. [Backlog] triage de los 6 e2e rojos restantes (509/639 de events + account/profile×3/rodeos) · limpieza DB beta pre-Chascomús. [Coordinación] quedó trabajo SIN COMMITEAR de OTRA terminal en el working tree (ADR-027 centrado robusto + CenteredRow + crear-rodeo + skill design-review + design-system) — lo commitea su terminal dueña.
- **Cierre:** Raf aprobó C6 y pidió cerrar. Commits de la sesión: `11999e6` (tests 15) + `b23c4cd` (coordinación) + `969dadc` (C6) + `2cbd1ca` (spec 10 v2) + cierre. check.mjs verde.
