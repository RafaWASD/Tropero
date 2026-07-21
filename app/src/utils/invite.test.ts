// Tests de lógica pura de invitaciones (spec 01, Fase 5 / B.1.3).
// node:test + type-stripping nativo de Node 24 (sin Jest; consistente con el resto del cliente).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseInviteToken,
  inviteErrorCopy,
  alreadyMemberCopy,
  inviteShareMessage,
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

test('inviteShareMessage: termina con la URL (sink limpio para la share sheet)', () => {
  const url = 'https://app.rafq.ar/invite?token=' + TOKEN;
  assert.ok(inviteShareMessage('Campo', url).endsWith(url));
});
