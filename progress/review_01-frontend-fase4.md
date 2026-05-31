# Review — 01-identity-multitenancy · Frontend B.1.2 (Fase 4 — establecimientos)

**Revisor:** reviewer
**Fecha:** 2026-05-31 (sesion 21)
**Baseline:** 4686ac0
**Bitacora:** progress/impl_01-frontend-fase4.md

## Veredicto

**CHANGES_REQUESTED**

check.mjs esta verde y la cobertura de logica pura es solida, pero loadMemberships()
(app/src/services/establishments.ts) tiene un bug de multi-tenancy en el cliente que rompe
el escenario beta real (owner con un miembro invitado, p.ej. Facundo como vet en el campo
del owner): devuelve el campo DUPLICADO una vez por cada user_roles activo visible y le
asigna un rol que puede no ser el del usuario. Esto corrompe el set available que alimenta
el landing por cantidad (R6.7) y el badge de rol (R6.6), y contradice la autorrevision
loadMemberships solo trae campos del usuario. Es bloqueante.

---

## Cambios requeridos

### [BLOQUEANTE - HIGH] loadMemberships duplica el campo y puede mal-etiquetar el rol cuando el usuario es owner con miembros
**Archivo:** app/src/services/establishments.ts:56-88

La query selecciona role + establishment(join) de user_roles con .eq(active,true) y NO
filtra por user_id = auth.uid(). La policy user_roles_select
(supabase/migrations/0008_rls_membership.sql:11-17) usa:
using ( user_id = auth.uid() or is_owner_of(establishment_id) ).

Para un OWNER del campo X con otros miembros activos (vet Y, operario Z), la RLS devuelve 3
filas, las tres con establishment = X (su propia fila owner + las de Y y Z). Entonces:
- rows.map(r => r.establishment) -> [X, X, X]
- el .map(e => ...) de la linea 76 produce 3 entradas para X, y en la 77
  rows.find(r => r.establishment?.id === e.id) devuelve la PRIMERA fila que matchea, que
  puede ser la de Y (veterinarian) o Z (field_operator), NO la del owner.

Consecuencias:
1. Mis campos (mis-campos.tsx) renderiza N cards duplicadas del mismo campo (rompe R6.6).
2. El badge de rol puede ser incorrecto (R6.6 / R6.6.2).
3. resolveState (utils/establishment.ts:69) ve available.length >= 2 para un owner de UN
   solo campo con un miembro -> lo manda a choosing / Mis campos en vez de la home (rompe
   R6.4/R6.7: 1 campo -> home auto-activo). Falsea la cuenta de campos.
4. detectActiveLost / buildRecents / sortMyEstablishments operan sobre un set inflado.

Fix sugerido (no lo aplico): scopear la query a las filas del propio usuario, p.ej.
.eq(user_id, userId) ademas de .eq(active, true); o dedupe por establishment.id quedandose
con la fila cuyo user_id === auth.uid(). Agregar un test de loadMemberships para el caso
owner-con-miembros (hoy ese modulo no tiene test y la suite RLS valida SQL, no el mapeo del
cliente, por eso paso).

### [MENOR - LOW] tasks.md no refleja el estado de las tasks de Fase 4
**Archivo:** specs/active/01-identity-multitenancy/tasks.md:203-232

T4.1-T4.5 siguen sin marcador de checkbox (### T4.1, no ### [x] T4.1). La bitacora dice todas
las tasks quedaron hechas y declara T4.5 diferida a B.1.2b, pero el tasks.md canonico no se
actualizo. No bloquea por si solo (la feature es in_progress, no done; CHECKPOINTS C6 exige
[x] recien al cerrar done), pero el seam T4.5/T4.2 deberia quedar trazado en tasks.md (T4.2
EstablishmentSelector quedo foldeada en mis-campos.tsx; T4.5 editar/borrar diferida).

---

## Trazabilidad R<n> <-> test / evidencia

| R<n> | Cubierto por | Estado |
|---|---|---|
| R3.1 crear campo | createEstablishment (establishments.ts:110) + Edge suite + crear-campo.tsx | OK |
| R3.2 owner auto | trigger 0011_establishment_auto_owner.sql + Edge suite (verde) | OK |
| R3.3 nombre+provincia | validateCreateEstablishment test (validation.test.ts:84) + form | OK |
| R3.8 telefono | isValidPhone test (validation.test.ts:76) + CompletePhoneScreen + loadOwnProfile/saveOwnPhone (RLS verde) | OK |
| R6.3 activo por default | resolveState preferido-presente test (establishment.test.ts:45) + switchEstablishment | OK (sujeto al set correcto) |
| R6.4 auto-activo con 1 | resolveState exactamente-1 test (establishment.test.ts:29) | OK en logica pura; ROTO en runtime para owner con miembros por el bug |
| R6.5 wizard CTA dual | onboarding.tsx (primario crear / secundario pegar-link STUB) | OK |
| R6.6/6.6.1 Mis campos + orden | sortMyEstablishments tests (establishment.test.ts:93-116) + mis-campos.tsx (search >8) | Orden OK; cards duplicadas + badge incorrecto por el bug |
| R6.7 landing por cantidad | resolveState 0/1/>=2 tests + RootGate | OK en logica pura; cuenta de campos falseada por el bug |
| R6.8.1 dropdown switch | buildRecents tests (establishment.test.ts:120-144) + home (pickVisited) | OK |
| R6.9 last_establishment_opened + rastro | promoteInTrail tests (establishment-store.test.ts) + buildRecents + store | OK |
| R6.10 active_lost + re-ruteo | detectActiveLost tests (establishment.test.ts:71-89) + acknowledgeActiveLost + campo-perdido.tsx + RootGate | OK |
| R7.2/R7.4 aislamiento/invalidacion | RLS suite (verde) + sin logout en active_lost | RLS server-side OK; el filtrado cliente NO scopea por user_id (ver bug) |
| R9.2 crear campo requiere conexion | clasif network en createEstablishment/saveOwnPhone + OFFLINE_COPY; switch local | OK |

Todos los R aplicables tienen >=1 test concreto. La regla dura ningun-R-sin-test se cumple;
el rechazo es por el defecto de correctitud en loadMemberships, no por falta de cobertura.

## Tasks completas

NO en tasks.md (T4.1-T4.5 sin [x]). Funcionalmente: T4.1/T4.3/T4.4 implementadas; T4.2 foldeada
en mis-campos.tsx; T4.5 diferida a B.1.2b y bien declarada como seam en la bitacora. La feature
es in_progress, asi que no es bloqueante por CHECKPOINTS C6, pero tasks.md deberia reflejar el
estado/seam antes de done.

## CHECKPOINTS

- C1 harness completo: [x] check.mjs exit 0.
- C2 estado coherente: [x] una sola feature in_progress (01); current.md describe la sesion.
- C3 arquitectura: [x] capas correctas; sin deps externas nuevas (bump safe-area-context justificado por Expo SDK 56, NO finding); TODO Crear rodeo (index.tsx:248) referencia spec 02 con contexto; sin establishment_id hardcodeado.
- C4 verificacion real: [ ] parcial - 48 unit cliente + RLS 15 + Edge 26 + Animal 28 + Maniobras 13 verdes con fixtures reales, PERO loadMemberships (modulo con logica de mapeo no trivial) no tiene test y por eso el bug paso.
- C5 cierre: N/A - sesion en curso.
- C6 SDD: [x] 3 archivos de spec; EARS OK; cada R con >=1 test. Tasks [x] no exigible hasta done.
- C7 multi-tenant: [x] server-side (RLS cross-tenant verde) / [ ] cliente - loadMemberships no scopea por user_id (no es leak cross-tenant -RLS lo impide- pero corrompe el set por-usuario).
- C8 offline-first: N/A - Fase 4 admin online (R9.2); PowerSync diferido (declarado); cambiar de campo local OK.

## Checklist RAFAQ-especifico

### A. Tablas con establishment_id (multi-tenancy / RLS)
N/A nuevas tablas (Fase 4 no crea tablas; schema/RLS backend ya gateado). Sobre el USO de RLS desde el cliente:
- [x] El cliente no hardcodea establishment_id (se deriva de auth.uid() via RLS / del contexto).
- [ ] Aislamiento por-usuario en el cliente: loadMemberships NO filtra por user_id, contamina el set con filas de otros miembros del mismo campo (ver bug HIGH). No es leak cross-tenant, pero rompe la vista por-usuario.
- [x] deleted_at / active=false filtrados (query .eq(active,true) + filtro cliente deleted_at == null; soft-delete de campo desactiva roles por R3.6).

### B. Datos en campo (offline-first)
N/A - Fase 4 es identidad/admin online (R9.2). Cambiar de campo si es offline (local, sin round-trip) - correcto. PowerSync diferido a Fase 7, seam declarado.

### C. BLE
N/A - la feature no toca BLE.

### D. UI de campo (parcial; pantallas tambien en oficina, Mis campos mixta)
- [x] Componentes de libreria ya dimensionados para target grande (dropdown item >= touchMin 56px).
- [x] Fuentes via tokens del DS.
- [x] Una decision por pantalla (onboarding CTA dual con jerarquia; campo-perdido un solo CTA; crear-campo form minimo).
- [x] Estados de loading visibles (phase loading en crear-campo; splash mantenido mientras est.status loading en RootGate; Guardando/Creando en botones).

### E. Edge Functions
N/A - Fase 4 no agrega/modifica Edge Functions (insert directo via trigger 0011 + RLS).

## Verificacion de los 4 bugs de Raf

- (a) cambiar de campo cambia contexto/datos: cableado correcto (index.tsx:340 -> switchEstablishment -> re-render por contexto). OK a nivel cableado, pero el set de campos viene de loadMemberships -> afectado por el bug para owners con miembros.
- (b) el saliente queda en visitados y el activo re-seleccionable: promoteInTrail lo conserva (test establishment-store.test.ts:15). OK.
- (c) ver todos: onSeeAll -> /mis-campos. OK.
- (d) crear campo: onCreate -> /crear-campo. OK.

El bug de loadMemberships no anula los 4 fixes a nivel cableado, pero degrada (a)/(b) en el
escenario owner-con-miembros (campos duplicados en switch/lista). Corregir el filtro por user_id cierra el riesgo.

## No-findings confirmados
- Bump react-native-safe-area-context ^5.8.0 -> ~5.7.0 (package.json + pnpm-lock.yaml): legitimo (pin Expo SDK 56). NO finding.
- feature_list.json / progress/current.md / scripts/check.mjs / .claude/settings.json: cambios del leader (coordinacion), fuera del alcance del implementer. NO findings.
- MOCK_ANIMALS en app/app/(tabs)/animales.tsx: pertenece a feature 09 (fuera de alcance B.1.2). NO finding.
- RootGate: sin loop de re-ruteo (replace condicionado a segmento != destino; active no expulsa de tabs/mis-campos/crear-campo). OK.
- Anti-hardcode (ADR-023 seccion 4): 0 violaciones. OK.
