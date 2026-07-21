# Security audit — U9: seguridad del token de invitación

**Modo**: code (auditoría read-only del código EXISTENTE — no hubo cambio que revisar).
**Fecha**: 2026-07-21
**Alcance**: flujo de invitación completo — generación, muestra/compartir, aceptación, revocación.
**Pregunta de Raf**: "¿es seguro mostrar el token así? evaluá temas de seguridad en invitación."

## Veredicto

**ACEPTABLE CON RESERVAS** — no hay un bug de implementación crítico; el código implementa
fielmente el modelo documentado en ADR-014. Pero hay **1 finding HIGH que es una decisión de
producto** (no hay binding al email: el link es bearer puro — cualquiera con el link entra) que Raf
debe re-afirmar conscientemente, **+ 2 MEDIUM accionables** (race en el single-use; token en query
string + persistido en localStorage en web).

La respuesta directa a "¿es seguro mostrar el token así?": **sí, mostrarlo/compartirlo es correcto**
— encriptarlo no aportaría nada (quien lo recibe tiene que presentarlo igual; sería bearer de todos
modos, tal cual anticipó el marco del plan). Lo que define la seguridad es binding + expiry +
single-use + revocación + entropía. De esos cinco, cuatro están bien resueltos; **el binding al
email es el que falta y es una decisión deliberada de ADR-014**, no un descuido.

---

## Respuestas a las 6 preguntas (con evidencia)

### 1. Al ACEPTAR, ¿se verifica que el email del que acepta coincide con el invitado?

**NO.** Es bearer puro por diseño (ADR-014). → **FINDING HIGH-1** (abajo).

Evidencia:
- `supabase/functions/accept_invitation/index.ts:4-6` — comentario literal: *"El token es bearer: NO
  se valida email-matching con el JWT (cualquier user logueado con el link puede aceptar)."*
- Los únicos gates al aceptar son: token existe (`:44-54`), status `pending` (`:56-62`), no expirado
  (`:64-72`), y que el caller no tenga YA un rol activo en ese establishment (`:77-93`). **En ningún
  punto se compara `inv.email` contra `user.email`.** El `select` ni siquiera necesita el email para
  validar — lo trae solo para la notificación al owner.
- `supabase/migrations/0012_invitations_email_nullable.sql:13-15` — el email de la invitación es
  "solo anotación... **no se valida al aceptar**".
- `docs/adr/ADR-014-shareable-invitation-links.md:30` y `:72-73` — decisión explícita: se eliminó la
  validación de email-matching; consecuencia negativa asumida: *"cualquier persona con el link puede
  aceptar. Si el owner lo comparte por error... esa persona entra al establishment."*

Consecuencia concreta (la que preocupa a Raf): un reenvío de WhatsApp mete a un desconocido al campo.
El desconocido entra con rol `field_operator` o `veterinarian` (nunca `owner` — bloqueado en
`invite_user/index.ts:22` + CHECK `invitations_role_not_owner` en `0004:31`), ve animales y datos del
campo, y puede cargar/editar según su rol.

### 2. ¿El token/invitación vence? ¿En cuánto? ¿Se chequea al aceptar?

**SÍ. 7 días. Sí se chequea.** Bien resuelto.
- TTL: `invite_user/index.ts:23` (`INVITATION_TTL_DAYS = 7`), `expires_at` calculado en `:133-135`.
- Chequeo al aceptar: `accept_invitation/index.ts:64-72` — si `expires_at < now` devuelve 410 y marca
  la fila `expired` (best-effort). `expires_at` es `not null` en el schema (`0004:23`).

### 3. ¿Es de un solo uso?

**SÍ, de facto — con una salvedad de concurrencia.** → **FINDING MEDIUM-1**.
- Tras aceptar, la fila pasa a `accepted` (`accept_invitation/index.ts:109-118`) y todo intento
  posterior con status ≠ `pending` se rechaza con 409 `invalid_state` (`:56-62`). No se puede reusar
  para sumar a una segunda persona.
- Salvedad: el check de status y la marca de `accepted` **no son atómicos** (TOCTOU). El insert del
  `user_roles` ocurre en `:96-106` ANTES de marcar `accepted` en `:109-118`. Dos users distintos
  logueados que golpean `accept_invitation` con el mismo token en paralelo pueden **ambos** pasar el
  check `pending`, ambos insertar su propio `user_roles` (user_id distinto → sin conflicto de unique),
  y ambos quedar dentro. Rompe la garantía de un-solo-uso bajo carrera. Ventana chica, pero real.

### 4. ¿Se puede revocar una invitación ya enviada?

**SÍ, por dos vías, owner-only.** Bien resuelto.
- Cancelar: `cancel_invitation/index.ts:57-66` (status → `cancelled`), gated por
  `requireOwnerOf` (`:47`).
- Regenerar link: `resend_invitation/index.ts:63-77` genera token nuevo y **sobrescribe la columna
  `token`**, dejando el link viejo muerto (el lookup por el token viejo da 404). Gated por
  `requireOwnerOf` (`:53`).
- UI wired en `app/app/miembros.tsx:547` (regenerar) y `:569` (cancelar).
- Limitación menor: revocar requiere estar online y solo aplica mientras `pending`. Una vez aceptada,
  la baja es por `remove_member` (existe). Aceptable.

### 5. Entropía y generación del token

**CSPRNG, UUID v4, ~122 bits. No predecible/secuencial.** Bien resuelto.
- `invite_user/index.ts:132` y `resend_invitation/index.ts:63`: `crypto.randomUUID()` (en Deno usa
  RNG criptográficamente seguro; v4 → 122 bits efectivos). Coincide con lo que declara ADR-014:36.
- Columna `token` con `unique` (`0004:21`) → sin colisiones. Longitud acotada por CHECK ≤512
  (`0070:160-161`), suficiente y no restrictiva.
- Brute-force: 122 bits es infeasible dentro de la vida útil de 7 días, aun sin rate limit.

### 6. ¿Filtra el token por referrer, logs o historial?

**Parcialmente — vector real pero acotado.** → **FINDING MEDIUM-2**.
- El token viaja en **query string**: `https://app.rafq.ar/invite?token=XXX`
  (`invite_user/index.ts:154-155`, `resend_invitation/index.ts:79-80`,
  `app/src/services/members.ts:48-50`). Los query-string tokens filtran por: historial del navegador,
  header `Referer` (si la página `/invite` carga cualquier recurso de terceros o el user hace click a
  un link externo desde ahí), logs de servidor/proxy/CDN, y analytics.
- La ACEPTACIÓN en sí NO filtra: el token va en el **body de un POST** (`functions.invoke`
  → `members.ts:404-406`), no en la URL. Correcto.
- Los Edge Functions **no loguean el token** (verificado: no hay `console.*` del token en
  `supabase/functions/`). El único logging server-side es de errores sin token.
- Persistencia cliente: `app/src/services/pending-invitation.ts:30-43` guarda el token en
  **SecureStore en nativo (Keychain/Keystore — OK)** pero en **web cae a `localStorage`** (`:31-35`),
  que es legible por cualquier XSS del origin y persiste hasta que se limpia. Se limpia tras consumir
  (`invite.tsx:107-108,130-132`), pero mientras tanto queda expuesto.

---

## Findings priorizados

### HIGH-1 — Sin binding al email: el link es bearer puro (cualquiera con el link entra)

- **Dónde**: `supabase/functions/accept_invitation/index.ts:4-6` (comentario) + ausencia de
  comparación `inv.email == user.email` en todo el handler (gates en `:56-93`).
- **Confianza**: HIGH sobre el HECHO (confirmado: no hay binding). Es una **decisión de producto
  documentada** (ADR-014), no un bug de implementación.
- **Riesgo real (acotado)**: un reenvío/leak del link mete a un desconocido al campo, con rol no-owner,
  removible por el owner en un tap. El owner recibe push + email cuando alguien acepta
  (`accept_invitation/index.ts:148-180`), así que hay detección. El token de 122 bits hace inviable el
  acceso sin recibir el link explícitamente.
- **REQUIERE_DECISION_ARQUITECTONICA / DE PRODUCTO** — Raf debe re-afirmar o cambiar el modelo. Tres
  opciones accionables, de menor a mayor fricción:
  1. **Mantener bearer (status quo)** y apoyarse en las mitigaciones ya existentes (expiry 7d,
     regenerar=revocar, lista visible, notificación al aceptar, rol no-owner). Es el modelo de
     Slack/Notion/Figma. Barato: cero código. Recomendado **solo si** se acorta el TTL (ver abajo) y
     se documenta el riesgo como aceptado.
  2. **Binding opcional al email anotado**: SI la invitación se creó con email-anotación, exigir en
     `accept_invitation` que `user.email == inv.email` (devolver 403 si no matchea); si se creó sin
     email, seguir bearer. Da al owner un control opt-in ("esta invitación es solo para
     facundo@x.com") sin romper el flujo WhatsApp-first cuando no le importa. Costo bajo (~1 guard).
  3. **Binding fuerte + confirmación**: email obligatorio + OTP/aprobación del owner al aceptar.
     Máxima seguridad, máxima fricción — probablemente overkill para el contexto (campo chico, rol
     removible). No recomendado para el MVP.
- **Recomendación**: opción 2 (binding opcional) como mejor relación seguridad/fricción, + acortar
  TTL. Pero es decisión de Raf; llevarlo a Puerta con estas opciones.

### MEDIUM-1 — Single-use no atómico (TOCTOU): dos users concurrentes pueden aceptar el mismo token

- **Dónde**: `supabase/functions/accept_invitation/index.ts` — check `pending` en `:56-62`, insert de
  `user_roles` en `:96-106`, marca `accepted` recién en `:109-118`. Los tres pasos no están en una
  transacción con lock.
- **Riesgo**: dos usuarios logueados distintos con el mismo link, en paralelo, ambos entran (rompe la
  garantía de un-solo-uso). Ventana estrecha; marginal frente al modelo bearer, pero es un gap real de
  correctitud/seguridad.
- **Fix accionable**: reclamar la invitación de forma atómica ANTES de insertar el rol —
  `UPDATE invitations SET status='accepted', accepted_at=now() WHERE id=? AND status='pending'` y
  verificar filas afectadas = 1; solo el ganador inserta el `user_roles`. O envolver todo en una RPC
  `SECURITY DEFINER` con `SELECT ... FOR UPDATE` sobre la fila. Invierte el orden actual (primero
  claim, después rol).

### MEDIUM-2 — Token en query string + persistido en localStorage (web)

- **Dónde**: URL con `?token=` (`invite_user/index.ts:154-155`, `resend_invitation/index.ts:79-80`);
  persistencia web en `localStorage` (`pending-invitation.ts:31-35`).
- **Riesgo**: leak por Referer/historial/logs/analytics de la página `/invite`, y exposición a XSS del
  origin mientras el token vive en localStorage. Acotado por expiry + single-use + los 122 bits.
  ADR-014 acepta el modelo de URL, pero conviene endurecer la superficie web.
- **Fix accionable** (cuando exista la página web `app.rafq.ar/invite`):
  - Servir `/invite` con `Referrer-Policy: no-referrer` y sin recursos de terceros (fonts/analytics)
    en esa ruta, para cerrar el leak por Referer.
  - Consumir el token y limpiarlo de la URL (`history.replaceState`) apenas se lee, y del localStorage
    apenas se decide la fase (ya se limpia tras aceptar; adelantarlo reduce la ventana).
  - Confirmar que ninguna capa de logging (CDN/edge/analytics) capture query strings en esa ruta.

---

## Mandato permanente — rate limiting y enumeración

**Tabla de rate limits (acciones abusables del flujo):**

| acción | rate limit | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| `invite_user` (crear invitación) | **NO** | — | — | Supabase no rate-limitea EFs por default. Owner autenticado, solo crea filas en SU establishment. NO manda email/SMS (sin denial-of-wallet). Riesgo LOW (storage abuse acotado por CHECK de largo + scope propio). |
| `accept_invitation` (aceptar) | **NO** | — | — | Enumeración inviable: token 122 bits + requiere JWT válido (`requireUser`, `:31`). Sin rate limit ES aceptable HOY **solo por la entropía**. Si alguna vez se migra a códigos cortos (alternativa que evaluó ADR-014:51-53), rate limit pasa a ser OBLIGATORIO. |
| `cancel_invitation` / `resend_invitation` | NO | — | — | Owner-only (`requireOwnerOf`). Idempotentes/acotados a su establishment. LOW. |
| Auth (signup/signin/OTP) | **SÍ (nativo)** | per-IP | sí | `config.toml:192-206`: `sign_in_sign_ups=30/5min`, `token_verifications=30/5min`, `email_sent=2/h`, `token_refresh=150/5min`. Defaults sanos, NO aflojados. |

- **¿Brute-forceable el endpoint de aceptar?** No en la práctica: 122 bits de token + JWT requerido.
  Marcar como informativo, no como finding — pero atar la ausencia de rate limit a la entropía del
  token (si baja la entropía, sube el requisito).
- **Recomendación menor (LOW)**: agregar un límite propio a `accept_invitation` por user (p.ej. N
  intentos fallidos/hora) es defensa en profundidad barata y desincentiva scripts, aunque no sea
  estrictamente necesario hoy.

## Caveats / cabos a confirmar (no findings, pero relevantes al modelo)

- **`config.toml:221` tiene `enable_confirmations = false`** (config LOCAL de dev). Interactúa con el
  modelo bearer: si en PRODUCCIÓN la confirmación de email estuviera OFF, un desconocido podría
  aceptar con un email throwaway sin verificar. El repo tiene flujo de verificación
  (`app/app/verify-email.tsx`) y persistencia del token a través de la verificación, lo que sugiere
  que prod la tiene ON — pero **conviene confirmar el setting de prod en el dashboard**, sobre todo si
  se adopta la opción 2 de HIGH-1 (binding al email), que solo tiene sentido si el email está
  verificado.
- **TTL de 7 días** es razonable para el modelo bearer, pero si se mantiene bearer (opción 1 de
  HIGH-1), acortarlo (p.ej. 48-72h) reduce la ventana de leak sin costo de UX relevante (el owner
  regenera en un tap).

## Archivos analizados

- `supabase/functions/invite_user/index.ts`
- `supabase/functions/accept_invitation/index.ts`
- `supabase/functions/cancel_invitation/index.ts`
- `supabase/functions/resend_invitation/index.ts`
- `supabase/functions/_shared/{auth,errors,supabase}.ts`
- `supabase/migrations/0004_invitations.sql`, `0012_invitations_email_nullable.sql`,
  `0008_rls_membership.sql`, `0070_check_text_length_caps.sql`
- `app/app/invite.tsx`, `app/app/invitar.tsx`, `app/app/miembros.tsx`
- `app/src/components/ShareLink.tsx`, `app/src/utils/invite.ts`,
  `app/src/services/{members,pending-invitation}.ts`
- `supabase/config.toml`, `docs/adr/ADR-014-shareable-invitation-links.md`

## Cobertura

Auditoría manual RAFAQ-specific (Deno/RLS/EF service-role/RN). No se corrió la skill
`sentry-skills:security-review` porque no hay diff (auditoría de código ya mergeado, no de un cambio).
Todos los findings salen de trazado manual de data-flow contra el catálogo de dominios (A: authz/IDOR,
B: information disclosure, E: abuso a escala, H: auth/sesión/token-en-URL).
