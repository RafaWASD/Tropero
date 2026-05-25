// Envío de emails transaccionales via Resend.
// Si `RESEND_API_KEY` no está configurada, las funciones retornan `{ ok: false,
// reason: 'no_key' }` SIN tirar — el caller decide si bloquea o continúa.
// Esto permite que R5.10 sea best-effort hasta que Raf agregue la key.

export type EmailRecipient = {
  email: string;
  name?: string;
};

export type EmailResult =
  | { ok: true; id: string }
  | { ok: false; reason: 'no_key' | 'api_error'; detail?: string };

const FROM_DEFAULT =
  Deno.env.get('RESEND_FROM_EMAIL') ?? 'RAFAQ <noreply@rafq.ar>';

async function sendViaResend(payload: {
  to: string;
  subject: string;
  html: string;
}): Promise<EmailResult> {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  if (!apiKey) {
    console.warn(
      'RESEND_API_KEY no configurada, R5.10 best-effort skipped',
    );
    return { ok: false, reason: 'no_key' };
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM_DEFAULT,
      to: payload.to,
      subject: payload.subject,
      html: payload.html,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.error(`Resend API error ${res.status}: ${detail}`);
    return { ok: false, reason: 'api_error', detail };
  }

  const body = await res.json().catch(() => ({}));
  return { ok: true, id: body.id ?? 'unknown' };
}

// Email de invitación al destinatario.
// Magic link incluye el token: la app extrae token del query string y llama
// accept_invitation.
export async function sendInvitationEmail(params: {
  to: string;
  establishmentName: string;
  inviterName: string;
  role: 'field_operator' | 'veterinarian';
  token: string;
}): Promise<EmailResult> {
  const appUrl = Deno.env.get('APP_URL') ?? 'https://app.rafq.ar';
  const link = `${appUrl}/invite?token=${encodeURIComponent(params.token)}`;
  const roleEs =
    params.role === 'veterinarian' ? 'veterinario' : 'operario de campo';

  const html = `
    <p>Hola,</p>
    <p><strong>${escapeHtml(params.inviterName)}</strong> te invitó a sumarte
    al establecimiento <strong>${escapeHtml(params.establishmentName)}</strong>
    en RAFAQ como <strong>${roleEs}</strong>.</p>
    <p><a href="${link}">Aceptar invitación</a></p>
    <p>O copiá y pegá este link en la app:<br>${link}</p>
    <p>El link expira en 7 días.</p>
    <p>— Equipo RAFAQ</p>
  `;

  return sendViaResend({
    to: params.to,
    subject: `${params.inviterName} te invitó a ${params.establishmentName}`,
    html,
  });
}

// Email al owner cuando aceptan una invitación. R5.10.
export async function sendInvitationAcceptedEmail(params: {
  to: string;
  ownerName: string;
  establishmentName: string;
  newMemberName: string;
  newMemberEmail: string;
  role: 'field_operator' | 'veterinarian';
}): Promise<EmailResult> {
  const roleEs =
    params.role === 'veterinarian' ? 'veterinario' : 'operario de campo';

  const html = `
    <p>Hola ${escapeHtml(params.ownerName)},</p>
    <p><strong>${escapeHtml(params.newMemberName)}</strong>
    (${escapeHtml(params.newMemberEmail)}) aceptó tu invitación y ya forma
    parte de <strong>${escapeHtml(params.establishmentName)}</strong> como
    <strong>${roleEs}</strong>.</p>
    <p>— Equipo RAFAQ</p>
  `;

  return sendViaResend({
    to: params.to,
    subject: `${params.newMemberName} aceptó tu invitación`,
    html,
  });
}

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
