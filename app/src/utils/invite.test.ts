// Tests de lógica pura de invitaciones (spec 01, Fase 5 / B.1.3).
// node:test + type-stripping nativo de Node 24 (sin Jest; consistente con el resto del cliente).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseInviteToken,
  inviteErrorCopy,
  alreadyMemberCopy,
  inviteShareMessage,
  invitePhaseForAuth,
} from './invite.ts';

const TOKEN = '550e8400-e29b-41d4-a716-446655440000';

// ─── parseInviteToken ────────────────────────────────────────────────────────────

test('parseInviteToken: URL universal https con token → extrae token', () => {
  assert.equal(parseInviteToken(`https://app.rafq.ar/invite?token=${TOKEN}`), TOKEN);
});

test('parseInviteToken: deep-link rafq:// con token → extrae token', () => {
  assert.equal(parseInviteToken(`rafq://invite?token=${TOKEN}`), TOKEN);
});

test('parseInviteToken: token crudo (UUID suelto) → lo devuelve', () => {
  assert.equal(parseInviteToken(TOKEN), TOKEN);
  assert.equal(parseInviteToken(`  ${TOKEN}  `), TOKEN); // con espacios alrededor
});

test('parseInviteToken: URL con params extra → toma el token igual', () => {
  assert.equal(
    parseInviteToken(`https://app.rafq.ar/invite?ref=wsp&token=${TOKEN}&utm=x`),
    TOKEN,
  );
  assert.equal(
    parseInviteToken(`https://app.rafq.ar/invite?token=${TOKEN}&ref=mail`),
    TOKEN,
  );
});

test('parseInviteToken: token percent-encoded en la URL → lo decodifica', () => {
  // invite_user usa encodeURIComponent; un UUID no tiene chars especiales, pero validamos
  // que un valor encodeado se decodifique (ej. si el token trajera un %2D).
  const raw = 'abc%2Ddef';
  assert.equal(parseInviteToken(`https://app.rafq.ar/invite?token=${raw}`), 'abc-def');
});

test('parseInviteToken: vacío / garbage → null', () => {
  assert.equal(parseInviteToken(''), null);
  assert.equal(parseInviteToken('   '), null);
  assert.equal(parseInviteToken('hola que tal'), null);
  assert.equal(parseInviteToken('https://app.rafq.ar/invite'), null); // sin ?token
  assert.equal(parseInviteToken('https://app.rafq.ar/invite?token='), null); // token vacío
  assert.equal(parseInviteToken('no-soy-un-uuid'), null);
});

test('parseInviteToken: fallback regex cuando la URL no parsea limpio pero hay token=', () => {
  // Texto pegado con ruido alrededor del token= (ej. mensaje de WhatsApp).
  assert.equal(parseInviteToken(`Sumate: token=${TOKEN}`), TOKEN);
});

// ─── inviteErrorCopy ──────────────────────────────────────────────────────────────

test('inviteErrorCopy: mapea códigos conocidos a copy en español', () => {
  assert.match(inviteErrorCopy('expired'), /venció/i);
  assert.match(inviteErrorCopy('not_found'), /no encontramos/i);
  assert.match(inviteErrorCopy('invalid_state'), /ya fue usado|cancelado/i);
  assert.match(inviteErrorCopy('forbidden'), /permisos|dueño/i);
  assert.match(inviteErrorCopy('last_owner'), /dueño/i);
  assert.match(inviteErrorCopy('pending_exists'), /pendiente/i);
  assert.match(inviteErrorCopy('no_change'), /ya tiene ese rol/i);
  assert.match(inviteErrorCopy('already_member'), /ya es miembro/i);
  // U9 (opción A): binding al email → copy propio, NO el fallback genérico.
  assert.match(inviteErrorCopy('email_mismatch'), /otra dirección de email/i);
  assert.notEqual(inviteErrorCopy('email_mismatch'), inviteErrorCopy('algo_raro'));
  // U9 HIGH-1: email coincidente pero no verificado → copy propio accionable (verificá tu email).
  assert.match(inviteErrorCopy('email_unverified'), /verificá tu email/i);
  assert.notEqual(inviteErrorCopy('email_unverified'), inviteErrorCopy('email_mismatch'));
});

test('inviteErrorCopy: código desconocido / null / undefined → fallback genérico', () => {
  const fallback = inviteErrorCopy('algo_raro');
  assert.match(fallback, /no pudimos/i);
  assert.equal(inviteErrorCopy(null), fallback);
  assert.equal(inviteErrorCopy(undefined), fallback);
  assert.equal(inviteErrorCopy(''), fallback);
});

// ─── alreadyMemberCopy ──────────────────────────────────────────────────────────────

test('alreadyMemberCopy: nombra el rol actual en español', () => {
  assert.match(alreadyMemberCopy('field_operator'), /Operario/);
  assert.match(alreadyMemberCopy('veterinarian'), /Veterinario/);
  assert.match(alreadyMemberCopy('owner'), /Dueño/);
  assert.match(alreadyMemberCopy('field_operator'), /Cambiar rol/i);
});

test('alreadyMemberCopy: sin rol → cae al copy genérico de already_member', () => {
  assert.equal(alreadyMemberCopy(null), inviteErrorCopy('already_member'));
});

// ─── inviteShareMessage (bugfix U8b: el link sale UNA sola vez) ─────────────────────

test('inviteShareMessage: la URL aparece EXACTAMENTE una vez en el mensaje', () => {
  const url = 'https://app.rafq.ar/invite?token=' + TOKEN;
  const msg = inviteShareMessage('La Escondida', url);
  // Contar ocurrencias del link completo — el bug U8b lo repetía (una en el texto + una del `url`).
  const occurrences = msg.split(url).length - 1;
  assert.equal(occurrences, 1, `la URL debería aparecer 1 vez, apareció ${occurrences}: ${msg}`);
});

test('inviteShareMessage: incluye el nombre del campo y es es-AR (voseo, invitación)', () => {
  const msg = inviteShareMessage('La Escondida', 'https://x/y?token=z');
  assert.match(msg, /La Escondida/); // nombre del campo preservado
  assert.match(msg, /Te invito/i); // voseo / es-AR
  assert.match(msg, /link para aceptar/i);
});

// ─── Rebrand fase 1 (2026-08-10): el texto SALIENTE nombra la marca ─────────────────
//
// Este mensaje sale de la app hacia afuera (WhatsApp/mail/SMS): es marca visible para alguien que
// todavía NO es usuario. El assert es sobre el nombre EXACTO ("miTropero": `mi` minúscula pegado a
// `T` mayúscula) y sobre la AUSENCIA del viejo — un rebrand a medias acá manda al invitado a buscar
// una app que no se llama así.
test('inviteShareMessage: nombra la marca "miTropero" con la grafía exacta y NO dice el nombre viejo', () => {
  const msg = inviteShareMessage('La Escondida', 'https://x/y?token=z');
  assert.match(msg, /\bmiTropero\b/, `el mensaje tiene que nombrar la marca: ${msg}`);
  assert.doesNotMatch(msg, /rafaq/i, `quedó el nombre viejo en el mensaje saliente: ${msg}`);
  // Grafía: NO "MiTropero", NO "Mi Tropero", NO "mitropero".
  assert.doesNotMatch(msg, /MiTropero|Mi Tropero|mitropero(?![.\w])/, `grafía incorrecta de la marca: ${msg}`);
});

test('inviteShareMessage: termina con la URL (sink limpio para la share sheet)', () => {
  const url = 'https://app.rafq.ar/invite?token=' + TOKEN;
  assert.ok(inviteShareMessage('Campo', url).endsWith(url));
});

// ─── invitePhaseForAuth (fix del LOOP de /invite?token= con sesión activa) ──────────

test('invitePhaseForAuth: sin token → paste (cualquier estado de auth)', () => {
  assert.equal(invitePhaseForAuth(false, 'loading'), 'paste');
  assert.equal(invitePhaseForAuth(false, 'unauthenticated'), 'paste');
  assert.equal(invitePhaseForAuth(false, 'authenticated'), 'paste');
});

test('invitePhaseForAuth: con token + auth LOADING → resolving (NO auth_required → NO persiste)', () => {
  // Núcleo del fix del loop: mientras auth carga NO decidimos auth_required (que dispararía la
  // persistencia del token) — esperamos a que resuelva. 'resolving' nunca persiste.
  assert.equal(invitePhaseForAuth(true, 'loading'), 'resolving');
});

test('invitePhaseForAuth: con token + authenticated → confirm', () => {
  assert.equal(invitePhaseForAuth(true, 'authenticated'), 'confirm');
});

test('invitePhaseForAuth: con token + unauthenticated → auth_required (deslogueado: acá SÍ persiste)', () => {
  assert.equal(invitePhaseForAuth(true, 'unauthenticated'), 'auth_required');
});

test('invitePhaseForAuth: la MISMA función resuelve la transición resolving→destino al dejar loading', () => {
  // El efecto de InviteScreen re-invoca la función cuando authStatus deja de ser 'loading'. Debe dar
  // el destino correcto según el resultado de auth (confirm si authed, auth_required si no).
  assert.equal(invitePhaseForAuth(true, 'authenticated'), 'confirm');
  assert.equal(invitePhaseForAuth(true, 'unauthenticated'), 'auth_required');
});
