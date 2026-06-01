# Review — Spec 01 Fase 6 FRONTEND (perfil / cuenta)

Reviewer: reviewer agent
Fecha: 2026-06-01
Feature: 01-identity-multitenancy (in_progress) — frontend de la Fase 6 (T6.1 + T6.3 frontend + consolidacion del saludo).
Scope: SOLO frontend. El backend (RPC delete_account_tx 0058 + edge delete_account) es deploy-pending del leader y queda EXPLICITAMENTE fuera de este review (las 8 fallas del edge suite son esperadas).

## Veredicto

APPROVED

El frontend de la Fase 6 cumple R2.1/R2.2/R2.4/R2.5/R2.5.1 contra requirements.md y el contrato de design-T6.3-delete-account.md (seccion Frontend). Verificacion de frontend en verde: typecheck limpio, anti-hardcode 0 violaciones, 124/124 client unit tests (incluye los 18 nuevos de account-result). Codigo respeta architecture.md (capas) y conventions.md (TS estricto, sin any, sin logs sueltos, errores tipados, voseo en UI).

## Verificacion ejecutada

- node scripts/check-hardcode.mjs -> OK (0 violaciones en app/app + app/src/components).
- cd app && pnpm.cmd typecheck -> OK (limpio, exit 0).
- client unit tests (suite completa de run-tests.mjs) -> 124/124 pass (incluye los 18 de account-result.test.ts; +0 regresion).
- account-result.test.ts aislado -> 18/18 pass.
- NOTA sobre check.mjs COMPLETO: corre ademas el edge suite, que tiene 8 fallas ESPERADAS en delete_account (edge no deployado, backend del leader). Esas fallas NO son del frontend y estan fuera del scope. El frontend no toca la suite edge. Las piezas de frontend que SI corren en check.mjs (typecheck + client unit) estan verdes.

## Trazabilidad R<n> a test

- R2.1 (editar name/phone/email): name/phone -> validation.test.ts R2.1 validateProfile + mas.tsx ProfileEditForm -> saveProfile (escribe SOLO public.users). email editable -> account-result.test.ts (6 casos de classifyAuthEmailError) + mas.tsx EmailChangeForm. CUBIERTO.
- R2.2 (cambio email, verificacion, mantener viejo): account-result.test.ts (clasificacion de errores de updateUser) + account.ts changeEmail delega a auth.updateUser email = doble-confirmacion nativa; el display lee profile.email = session.email = viejo hasta confirmar. CUBIERTO.
- R2.4 (eliminar cuenta, doble confirmacion): account-result.test.ts deleteAccount error (mapeo del Result) + mas.tsx DeleteAccountSection (maquina idle-confirm-deleting-deleted; segundo paso explicito). CUBIERTO.
- R2.5 (bloqueo unico-owner): account-result.test.ts 409 sole_owner + sole_owner sin establishments + mas.tsx rama blocked. CUBIERTO.
- R2.5.1 (lista de campos bloqueantes + atajo soft-delete): account-result.test.ts sole_owner reason+lista (R2.5.1) + parseBlockingEstablishments (4 casos) + mas.tsx onSoftDeleteBlocking (reusa countActiveMembers + softDeleteEstablishment + confirmDestructive con warning R3.6.1) + Reintentar baja gated hasta lista vacia. CUBIERTO.

Nota de cobertura (aceptada): la logica PURA (mapeo de errores, parseo de la lista bloqueante, clasificacion de email) esta testeada con node:test (18 tests, shapes reales del contrato del edge). La UI con estado y el wiring de ProfileContext se verifican por razonamiento del flujo + oraculo de Raf en web (patron documentado del proyecto). Cada R<n> tiene al menos 1 test concreto: regla dura cumplida.

## Tasks completas

Si (para este run de frontend). tasks.md:
- T6.1 [x] — as-built de Fase 6 frontend documentado (name/phone/email + ProfileContext fuente unica).
- T6.3 [x] con sub-estado: Backend [x] (deploy-pending leader) + Frontend [x] (as-built documentado).
- T6.2 (Logout) NO esta en [x] pero NO es scope de este run (el logout ya existe en mas.tsx onLogout). No bloquea.

No quedan tasks [ ] del scope de este run sin justificacion.

## CHECKPOINTS

- C2 (estado coherente): [x] una sola feature in_progress (01); current.md describe sesion activa.
- C3 (arquitectura): [x] solo capas previstas (services/contexts/utils/screens). [x] sin deps externas nuevas. [x] sin logs de debug ni TODOs sueltos. [x] no se hardcodea establishment_id (identidad solo del JWT en deleteAccount; queries reusan servicios RLS-scoped).
- C4 (verificacion real): [x] al menos 1 test por modulo con logica (account-result: 18). [x] el runner muestra >0 tests, todos verdes (124/124 client). Aislamiento cross-tenant: N/A (no agrega queries cross-tenant; reusa softDeleteEstablishment/countActiveMembers ya gateados con RLS owner-only).
- C6 (SDD): [x] specs presentes; [x] cada R<n> de Fase 6 cubierto por al menos 1 test; tasks del run en [x].
- C1 / C5 / C7 / C8: no aplican a este run de frontend (C7/C8 son backend/RLS/PowerSync; no se toca schema ni buckets).

## Checklist RAFAQ-especifico

### A. Tablas con establishment_id / RLS — N/A
Este run no crea ni altera tablas, RLS ni helpers. Reusa queries ya gateadas (softDeleteEstablishment, countActiveMembers — RLS owner-centrica) y el edge delete_account (backend, fuera de scope). saveProfile escribe public.users con RLS users_update_self (id = auth.uid()), ya existente. La lista de campos bloqueantes la fabrica el SERVER (edge), no el cliente.

### B. Datos en campo / offline-first — N/A
Las 3 operaciones (editar perfil, cambiar email, eliminar cuenta) son administrativas ONLINE por diseno (R9.2). No son carga de datos en manga. El cliente maneja network -> OFFLINE_COPY accionable en las 3 piezas.

### C. BLE — N/A
No toca BLE.

### D. UI de campo — APLICA PARCIAL (pantalla amarilla settings, no manga-critica)
- [x] Touch targets: filas/botones primarios usan minHeight touchMin (56px, estandar documentado del proyecto alineado a CLAUDE.md ppio 4). El chip inline Eliminar dentro de la lista de bloqueantes usa chipMin (40px) — accion secundaria dentro de una fila que ya es touchMin; aceptable. El checklist generico pide >=60dp; mas.tsx es pantalla mixta de ajustes (no manga), y 56px/touchMin es el target canonico del DS — no bloqueante.
- [x] Fuente en texto operativo: labels/valores de perfil y CTAs usan token 5 (16px) y mayores (8/9 en titulos); el texto secundario (hints/section titles) usa token 3 — consistente con la jerarquia de settings del DS. Para pantalla de ajustes (no lectura a pleno sol en manga) es coherente.
- [x] Una decision por pantalla / por paso: la eliminacion de cuenta es una maquina de estados con UN paso de decision por vez (idle -> confirm -> ...); no es un formulario largo.
- [x] Estado de loading visible: Guardando, Enviando, Eliminando, Cargando tu perfil, Te estamos sacando de la sesion — feedback presente en cada operacion de red.

### E. Edge Functions — N/A
No crea ni modifica edge functions. El edge delete_account es backend (deploy-pending del leader), fuera de scope.

## Puntos verificados del encargo

1. Consolidacion del saludo — OK
   - saveProfile (establishments.ts:231) escribe SOLO public.users; ya NO llama auth.updateUser data. Grep confirma que ningun otro lugar necesita el sync de metadata para el saludo: toAuthUser (AuthContext) sigue poblando name desde metadata pero NADIE lo consume para el saludo; el e2e helper escribe name a metadata en signup -> el trigger DB lo copia a public.users.name -> ProfileContext lo lee bien.
   - home (index.tsx:231,240,402) y onboarding (onboarding.tsx:34-35,39) leen el saludo de useProfile().profile.name (no de AuthContext).
   - ProfileProvider montado DENTRO de AuthProvider y envolviendo a EstablishmentProvider + RootGate (_layout.tsx:307-321) -> home/onboarding consumen useProfile(). OK
   - Flujo tras editar nombre: ProfileEditForm.onSubmit -> saveProfile (public.users) -> onDone -> refresh() del ProfileContext -> re-lee public.users -> profile.name cambia -> home/onboarding re-renderizan. Una sola fuente; el desync de 2 fuentes queda eliminado de raiz. OK

2. Anti-footgun de loops (leccion miembros.tsx B.1.3) — OK
   - ProfileContext: el efecto de carga depende de [userId, loadFor]. userId es PRIMITIVO (string|null del AuthState), loadFor es useCallback con deps vacias (estable). refresh depende de [userId, loadFor] (estables). El value memoizado depende de primitivos o estables. El email se compone en el value SIN disparar fetch. Guard loadSeq (useRef) descarta resultados stale de un login viejo. Sin loop de fetch. OK
   - home/mas/onboarding: efectos con deps primitivas (userId, activeId, isAuthedVerified) o callbacks estables; sin objetos recreados en deps.

3. Cambio de email — OK
   - changeEmail solo dispara auth.updateUser email; no asume que cambio. El display lee profile.email (= session.email = viejo) hasta que el usuario confirme desde el mail (R2.2 nativo). Copy explicito: tu email sigue siendo el viejo.
   - Maneja email_taken / invalid / network / unknown (clasificador testeado, 6 casos; network gana sobre clasificaciones por mensaje). Pre-valida formato local (isValidEmail) + guard de mismo-email antes de pegarle al server.

4. Eliminar cuenta — OK
   - Doble confirmacion REAL: maquina de estados idle -> confirm (tarjeta con consecuencias + boton Si eliminar) -> deleting. No es un solo alert; son dos pasos UI explicitos.
   - Flujo sole_owner: rama blocked muestra la lista de campos bloqueantes con atajo a soft-delete por campo (warning de miembros R3.6.1 via countActiveMembers + confirmDestructive); al borrar, el campo sale de la lista (filter); Reintentar baja queda disabled hasta lista vacia -> re-llama deleteAccount.
   - Re-entrancy guard busyRef (useRef) cubre callDelete y onSoftDeleteBlocking; todos los caminos resetean busyRef (verificado rama por rama) -> un doble-tap no dispara dos bajas.
   - En OK / already_deleted -> setStep deleted + await signOut() -> RootGate re-rutea a auth. Body de la invocacion = objeto vacio (sin user_id -> sin IDOR, D5 del contrato). OK
   - Edge conocido documentado (NO bug): reintentar baja cuando el campo bloqueante es el ACTIVO -> soft-delete dispara active_lost (R6.10) -> MasScreen se desmonta; la operacion sigue recuperable. Aceptable para MVP.

5. Cero hardcode (ADR-023 seccion 4) — OK: 0 violaciones (check-hardcode.mjs verde). Donde un valor cruza a API no-Tamagui (color de iconos lucide) se lee con getTokenValue.

6. Housekeeping — OK: T6.1 y T6.3 marcados [x] con as-built coherente. Bitacora impl_01-frontend-fase6-frontend.md completa con trazabilidad y autorrevision adversarial (paso 8). Archivos uncommitted en el working tree como se esperaba (5 NEW, 8 MODIFIED). Sin any, sin console, sin TODOs marcadores reales.

## Cambios requeridos

Ninguno. APPROVED.

## Observaciones menores (NO bloqueantes, para el leader)

- toAuthUser sigue leyendo user_metadata.name (AuthContext) aunque ya nadie lo consume para el saludo. Inofensivo, pero deuda muerta: en una pasada futura conviene podar AuthUser.name si no tiene consumidores legitimos. No bloquea.
- T6.2 (Logout) funciona (onLogout en mas.tsx) pero su checkbox en tasks.md sigue [ ]. No es scope de este run; dejar constancia para el run que cierre Fase 6 completa.
- Cobertura de UI con estado descansa en razonamiento + oraculo web (patron del proyecto). Cuando exista la suite Playwright e2e, sumar cobertura de los flujos de Fase 6 cerraria el gap de integracion. No bloquea el MVP.
