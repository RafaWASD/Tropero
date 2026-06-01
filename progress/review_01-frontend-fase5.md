# Review - B.1.3 / Fase 5 spec 01 (invitaciones y miembros)

Feature: 01-identity-multitenancy (in_progress) - Run B.1.3. Baseline working tree sin commitear sobre 1a5d6aa. Scope: cliente Expo (app/); backend Fase 2 NO se toco.

## Veredicto: APPROVED

node scripts/check.mjs verde (91 unit + 17 RLS + 26 edge + 28 animal + 13 maniobras; anti-hardcode 0 violaciones).

## Trazabilidad R<n> a test / verificacion

Logica pura con tests concretos (app/src/utils/invite.test.ts, 11 tests). Flujos UI cableados a Edge Functions cubiertas por supabase/tests/edge/run.cjs (26 tests, Fase 2). Codigos de error del cliente verificados contra las funciones.

- R5.4/R6.5 (extraer token: universal/rafq/crudo/params-extra/percent-encoded/garbage-null/fallback-regex) -> invite.test.ts parseInviteToken. Usado en invite.tsx:56,93.
- R5.6 (copy ya-usado/expirado/no-encontrado) -> invite.test.ts inviteErrorCopy. Verificado vs accept_invitation/index.ts:51 (404 not_found), :69 (410 expired), :88 (409 invalid_state/already_member).
- R5.9 (already_member nombra rol) -> invite.test.ts alreadyMemberCopy. No-auto-cambio de rol en backend; cliente solo muestra copy.
- R5.1/R5.2/R5.3 (crear+compartir) -> invite_user (edge) + invitar.tsx + ShareLink.tsx. invalid_input/already_member/pending_exists mapeados.
- R5.5 (aceptar) -> accept_invitation; acceptInvitation (members.ts:339) devuelve {establishmentId,role} = shape edge (index.ts:175).
- R5.7 cancelar -> cancel_invitation. R5.8 regenerar -> resend_invitation. R5.12 listar pendientes -> loadPendingInvitations (owner-only).
- R4.5 cambiar rol -> change_member_role (last_owner). R4.7 remover -> remove_member (last_owner).
- R5.13 (token cross-cold-start) -> pending-invitation.ts + re-ruteo centralizado en RootGate. Matriz de 7 casos auditada (abajo).

Veredicto: toda R<n> de Fase 5 tiene >=1 test concreto o flujo cableado a edge testeado. OK.

## Tasks completas: SI (con diferidos justificados)

- T5.1 [x] miembros.tsx lista + owner/no-owner adaptativo (hallazgo RLS #1).
- T5.2 [x] invitar.tsx rol obligatorio + email opcional + ShareLink.
- T5.3 [x] miembros.tsx pendientes Copiar/Compartir/Regenerar/Cancelar.
- T5.4 [~] invite.tsx entrada manual + parse + confirm generico + accept + R5.13. DIFERIDO con razon (device-blocked): universal-link assoc (apple-app-site-association/assetlinks) + verificacion on-device del deep-link nativo (Expo Go SDK 56 fuera de tiendas + dominio app.rafq.ar inexistente). scheme rafq ya en app.json; loop probado en web. NO bloquea.
- T5.5 [x] cambiar rol picker + error legible (last_owner).
- T5.6 [x] remover confirmDestructive + error legible.

No quedan tasks [ ] sin justificar en el scope de Fase 5.

## CHECKPOINTS

- C3 arquitectura: [x] solo capas previstas; ShareLink/RoleBadge NO importan de services. [x] unica dep nueva expo-clipboard ~56.0.3 (pin SDK 56, R5.3) legitima. [x] sin logs debug; TODOs con contexto. [x] no se hardcodea establishment_id (members.ts lo recibe del contexto).
- C4 verificacion: [x] invite.ts <-> invite.test.ts; wrappers thin sobre edges testeados. [x] runner >0 verde (91 unit). [N/A directo] cross-tenant cubierto por RLS Fase 1/2 (17 pass); esta run no agrega tablas/policies.
- C6 SDD: [x] 3 archivos de spec, EARS, tasks as-built. [x] cada R<n> de Fase 5 cubierto. Feature sigue in_progress (no se marca done).
- C7/C8 ver checklist RAFAQ A y B.

## Checklist RAFAQ-especifico

### A. Tablas con establishment_id / RLS - N/A para el cambio, heredado verificado
Esta run NO crea/modifica tablas/policies (cero migrations/deploys). Aislamiento enforced por backend Fase 1/2 (RLS 17 pass). El cliente respeta la RLS honestamente:
- [x] loadMembers (members.ts:181) selecciona SOLO id,name del user embebido - NUNCA phone/email de otros (hallazgo #2). Filtra por establishment_id del contexto + active=true.
- [x] loadPendingInvitations (members.ts:222) solo si isOwner (miembros.tsx:121) - owner-only por RLS 0008.
- [x] Owner-centrico honesto (hallazgo #1): owner ve lista completa; no-owner solo su fila + nota (miembros.tsx:229).
- [x] Confirm de aceptacion generico (sin preview): invitado no lee la invitacion antes de aceptar (RLS owner-only, hallazgo #3).

### B. Offline-first - N/A estricto (operaciones administrativas, R9.2 = online). Aun asi:
- [x] Red vs terminal: invokeFn (members.ts:92) atrapa fetch -> network; pantallas muestran copy de conexion sin tumbar.
- [x] invite.tsx:130 borra token solo en error fn (terminal); en network lo conserva (reintentable).

### C. BLE - N/A (la feature no toca BLE).

### D. UI de campo (manga) - APLICA PARCIAL (pantallas mixtas)
- [x] Targets: filas $touchMin (miembros.tsx:372); ShareLink botones $touchMin; chips $chipMin (apropiado); Invitar $chipMin.
- [x] Fuente: nombres $5, titulos $8, acciones $5; metadata $2/$3 (etiquetas secundarias).
- [x] Una decision por pantalla (invitar = rol+email opc; aceptar = aceptar/ahora-no).
- [x] Loading visible (Generando link invitar:161, Aceptando invite:138, Cargando equipo miembros:199).

### E. Edge Functions - N/A (no se toco backend; Fase 2 ya revisada).

## R5.13 (lo mas critico) - auditoria de la matriz de 7 casos

Centralizacion en RootGate (_layout.tsx, paso 3.5, lineas 194-214) como FUENTE UNICA. Verificado:
- [x] Orden: re-ruteo DESPUES de emailVerified y ANTES del gating de establecimiento -> cubre todos los aterrizajes post-auth, incluido usuario EXISTENTE con campos (bug del orphan). _layout.tsx:209.
- [x] Guard one-shot (reroutedForInvite :134) + top != INVITE_ROUTE (:209): cortan loop del caso 5 (Ahora no) y doble-empuje del caso 4 (logueado abre /invite directo).
- [x] pendingInviteToken en deps del efecto de gating (_layout.tsx:252). Re-evalua cuando el token se carga async.
- [x] Reset en logout (:136-142): limpia state del token + resetea guard -> token de otra sesion no re-dispara.
- [x] Token se persiste SOLO en estado deslogueado (invite.tsx:73-77, fase auth_required) -> caso 4 no arrastra token.
- [x] Limpieza tras consumir: accept (invite.tsx:108) + error terminal fn (invite.tsx:131); red NO limpia.
- [x] Gating Fase 4 intacto: FASE5_DESTINATIONS evita rebotar /invite,/invitar,/miembros desde cualquier estado (_layout.tsx:233-248).
- [x] Seams redundantes eliminados en verify-email.tsx y onboarding.tsx (sin doble-ruteo; imports huerfanos removidos, typecheck verde).

Los 7 casos cubiertos sin loop ni token huerfano. Re-prompt en cold-start futuro (caso 5) aceptable por el brief.

## Otras verificaciones del brief

- Anti-hardcode (#2): scanner cubre app/app + app/src/components. Lo que NO atrapa (borderWidth, width/height, strokeWidth, size de iconos, hitSlop) cae en props sin token semantico (geometria/iconos) - legitimo. Color/spacing 100% por tokens o getTokenValue. 0 violaciones.
- invokeFn (#4): desempaqueta el code del no-2xx via error.context.json() (members.ts:123-143); distingue red de terminal; defensa de 2xx-con-error-en-body. Espejo de push-notifications.ts.
- Offline/best-effort (#5): Copiar (Clipboard) y Compartir (Share) en try/catch en ShareLink y PendingInvitationCard - no rompen sin clipboard/share sheet (web).
- Overflow del link (#6): ShareLink y PendingInvitationCard usan maxWidth 100% + overflow hidden + numberOfLines + ellipsizeMode middle + selectable.
- Consistencia (#7): roleLabel fuente unica en utils/establishment.ts; RoleBadge extraido y reusado por EstablishmentCard + Miembros (EstablishmentRole === UserRole, type-safe); confirmDestructive espeja mas.tsx. ROLE_LABELS re-declarado en invite.ts justificado (no acoplar el modulo puro) y el test verifica el mismo string.

## Observaciones (NO bloqueantes)

1. progress/current.md modificado (el brief lo listo como ajeno). El diff es legitimamente de B.1.3. Archivo de coordinacion/docs, no codigo/tests. No afecta el veredicto. Nota de proceso: confirmar que no pisa otra terminal.
2. Layering screen->service directo (sin hook intermedio): patron YA establecido en todo el cliente (sign-in, crear-campo, editar-campo, mas, mis-campos). app/src/hooks/ es solo index stub. Consistente; no es regresion.
3. already_member cae a copy generico en accept (el 409 del edge no trae el rol destino). Documentado; alreadyMemberCopy(role) listo si el edge lo expusiera. Aceptable MVP.

Ninguna observacion alcanza el umbral de CHANGES_REQUESTED.
