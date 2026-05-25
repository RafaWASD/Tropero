# ADR-014 — Invitaciones por link shareable (en vez de magic link por email)

**Status**: Accepted
**Fecha**: 2026-05-25
**Decisores**: Raf
**Supersedes parcialmente**: decisiones de invitación documentadas en `specs/active/01-identity-multitenancy/requirements.md` (sección "Decisiones tomadas", ítems sobre "Invitaciones" y "Email de invitación").

## Contexto

El spec 01 (`identity-multitenancy`) tenía como decisión cerrada que las invitaciones se enviaban por **email con magic link**: el owner ingresaba el email del invitado, el sistema generaba un token y disparaba un mail vía Resend con un link de aceptación. El backend (Fases 0+1+2) ya está implementado bajo ese modelo: tabla `invitations` con `email NOT NULL`, Edge Function `invite_user` que valida email y dispara email best-effort, `accept_invitation` que valida email-matching contra el JWT del que acepta, y `resend_invitation` que regenera token y reenvía mail.

Al evaluar el flujo de UX para el cliente (Fase 3+, pausada), Raf identifica tres problemas con el modelo email-bound:

1. **Deliverability**: el mail puede caer en spam, especialmente con dominios genéricos o cuando el destinatario tiene filtros agresivos. El feedback típico del usuario rural argentino es "no me llegó". Esto genera fricción de onboarding y soporte.
2. **Canal equivocado para el contexto**: en el campo argentino, **WhatsApp es el canal real de comunicación**. Forzar email como medio de invitación va contra el flujo natural del owner (productor) que quiere invitar a su veterinario o peón.
3. **Modelo mental obsoleto**: las herramientas modernas que el usuario equipara con "profesional" (Slack, Notion, Figma, Discord, Linear) usan **link shareable** desde hace años. Email-only se siente arcaico.

En paralelo, el backend ya está construido de manera defensiva: el email send es best-effort (si Resend falla, la invitación se crea igual y retorna el token), y la respuesta del Edge Function incluye el token en claro. Eso significa que el costo de pivotar al modelo link shareable es bajo.

El posicionamiento del producto ("el mejor en el primer try", ver memoria `product_positioning`) refuerza la decisión: el polish del flujo de invitación es uno de los primeros touchpoints que cualquier usuario nuevo experimenta. Si se siente moderno, la app entera se siente moderna.

## Decisión

**Las invitaciones se generan como link shareable.** El owner crea la invitación (sin ingresar email), recibe inmediatamente un link tipo `https://app.rafq.ar/invite?token=XXX` (y/o `rafq://invite?token=XXX` para deep link nativo), y lo comparte por el canal que prefiera (WhatsApp, SMS, mail, copy-paste manual) usando la share sheet nativa del SO o el botón de copy al clipboard.

Cambios concretos respecto al modelo anterior:

1. **Tabla `invitations`**: el campo `email` se vuelve **nullable**. No se borra: queda como anotación opcional (el owner puede registrar a quién va dirigida la invitación, sin que eso se valide contra el destinatario real).
2. **Edge Function `invite_user`**: input cambia de `{ establishment_id, email, role }` a `{ establishment_id, role, email? }`. El email queda opcional como anotación. Ya no dispara email automático al destinatario. Retorna `{ invitation_id, token, accept_url, expires_at }`.
3. **Edge Function `accept_invitation`**: se elimina la validación de "email del JWT debe matchear email de la invitación". El token vale por sí solo (modelo bearer). El resto del flujo (insert `user_roles`, marcar accepted, notificar al owner por email + push) queda intacto.
4. **Edge Function `resend_invitation`**: se renombra conceptualmente a "regenerar link" (mantiene el nombre del archivo para no romper deploys). Genera nuevo token, invalida el viejo, reinicia expiración. Ya no dispara email — solo retorna el nuevo link.
5. **Wizard de onboarding (R6.5)**: el CTA secundario "compartir mi email con productores" se reemplaza por **"pegar link de invitación"**, que abre un input para que el usuario pegue manualmente el link recibido por WhatsApp (red de seguridad cuando el deep link no autoabre).
6. **Email del owner cuando aceptan (R5.10) y push notification (R5.11)**: **se mantienen sin cambios**. El helper `_shared/email.ts` y la infraestructura de Resend siguen vigentes para este flujo (que sí tiene sentido: el owner se entera de que alguien aceptó).

La seguridad del modelo se apoya en:
- Token = UUID v4 (122 bits de entropía efectiva): imposible de adivinar por fuerza bruta dentro de la vida útil del link.
- Expiración corta (7 días, configurable).
- Acción de "regenerar link" invalida el anterior, dando al owner un mecanismo de revocación si comparte el link por error.
- UI muestra al owner qué links están activos en cualquier momento y permite cancelarlos.

## Alternativas consideradas

### Mantener email magic link (status quo del spec original)
- **Pros**: cero refactor, modelo conocido, validación implícita "el que recibe el mail es el dueño del email".
- **Contras**: deliverability frágil, canal equivocado para el contexto rural argentino, percepción de UX anticuada, dependencia operativa de Resend para el flujo crítico de onboarding.

### Email magic link + link shareable como fallback en paralelo
- **Pros**: cobertura máxima, el owner elige el medio.
- **Contras**: doble lógica de validación (¿valido email-matching si vino por email pero no si vino por link?), doble superficie de bug, doble carga cognitiva en la UI del owner. Hace al sistema más complejo sin ganancia clara — los usuarios que prefieren mail pueden simplemente pegar el link en un mail manual.

### Códigos numéricos de invitación (estilo Discord Nitro)
- **Pros**: ultra simple de compartir verbalmente ("invitate con código 1234"), fácil de tipear.
- **Contras**: espacio reducido de combinaciones (forzaría rate-limiting agresivo), expirations cortas obligatorias, peor UX para deep-link nativo (no podés generar `accept_url` desde un código sin un servidor adicional). Modelo más típico de soporte humano que de invitación 1:1.

### QR code en vez de link (o además del link)
- **Pros**: muy útil cara a cara ("escaneá esto del celu del productor").
- **Contras**: en remoto (WhatsApp) sigue siendo más cómodo el link. Se puede agregar como complemento futuro sin un ADR aparte — es solo un render visual del mismo token.

## Consecuencias

**Positivas**:

- **Deliverability deja de ser un problema operativo** del flujo de invitación.
- **WhatsApp y otros canales modernos se convierten en first-class citizens** — alineado con cómo se comunica el usuario rural argentino en la práctica.
- **UX percibida más moderna**, alineada con el posicionamiento del producto. El modelo es idéntico al de Slack/Notion/Figma/Discord/Linear, así que es inmediatamente legible para cualquier usuario digital.
- **Menos dependencia de Resend** para el flujo crítico (sigue siendo dependencia para notificar al owner cuando aceptan, pero ese flujo tolera fallar silenciosamente sin bloquear nada).
- **Costo bajo**: ~4 horas de refactor sobre código ya escrito; 0 trabajo del frontend perdido porque la Fase 3 aún no arrancó.
- **El backend ya está casi diseñado para esto**: el email send siempre fue best-effort y la respuesta ya incluía el token. El cambio formaliza la decisión que el código ya sugería.

**Negativas**:

- **Modelo bearer**: cualquier persona con el link puede aceptar. Si el owner lo comparte por error con la persona equivocada, esa persona entra al establishment. Mitigación: regenerar link (revoca el anterior), expiración corta, lista visible de links activos.
- **Se pierde el "doble factor implícito"** que daba email-matching (el invitado tenía que tener acceso al email Y al link). Aceptable dado el tamaño del impacto (un solo establishment, role limitado, removible por el owner en un tap) y la entropía del token.
- **R5.9 "no invitar a alguien que ya es miembro" se vuelve más débil como precheck**: sin email upfront, no podemos validar antes de generar el link. La validación se mueve al momento de aceptar (el unique index de `user_roles` ya garantiza que no se cree un segundo rol activo). UX trade-off menor: el invitado descubre "ya estabas" al aceptar, no el owner al invitar.
- **Hay que confiar en deep linking + universal links** funcionando bien en Expo. Mitigación: el CTA secundario del wizard ("pegar link de invitación") permite recuperarse manualmente cuando el deep link no autoabre.

**Notas de implementación**:

- Migration nueva (`0012_invitations_email_nullable.sql`): `alter table invitations alter column email drop not null`. Mantenemos el campo para audit / anotación opcional.
- Tests RLS no se tocan (las policies de `invitations` filtran por `establishment_id`, no por email).
- Tests de Edge Functions: ~6-8 modificaciones (assertions sobre el link retornado en vez de sobre email enviado; el test de email-mismatch en `accept_invitation` se borra).
- Helper `_shared/email.ts` permanece. Resend sigue siendo dependencia para R5.10 (email al owner cuando aceptan).
- Documentación a actualizar: `specs/active/01-identity-multitenancy/{requirements,design,tasks}.md` y `progress/current.md`.

**Reversibilidad**: alta. Si en el futuro algún regulación o requerimiento nos obliga a volver a email-bound (no es probable), el código del helper y la columna `email` siguen ahí. Sería re-activar la validación en `accept_invitation` y volver a llamar `sendInvitationEmail` desde `invite_user`. Un par de horas en sentido inverso.
