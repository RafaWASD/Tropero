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
