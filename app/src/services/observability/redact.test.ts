// Tests de FALSIFICACIÓN del scrubber redact.ts (feature 17, R7.4/R7.4.1/R7.4.2/R7.4.3). node:test +
// type-stripping (sin SDK: redact.ts es PURO). Cada test DEBE fallar si se quita/afloja el scrubber:
//   · identidad (redactEvent(x)=x) → los '[redacted]' no aparecen → rojo.
//   · denylist vacío → email/opData salen crudos → rojo.
//   · sin fail-closed (sin try/catch) → redactEvent(throwing) TIRA en vez de devolver null → rojo.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { redactEvent, redactBreadcrumb } from './redact.ts';

test('R7.4: redacta claves del denylist recursivamente (email en contexts.user, opData en extra)', () => {
  const event = {
    contexts: { user: { email: 'peon@campo.com', id: 'user-1' } },
    extra: { opData: { peso: 385, tag: '982000123456789' } },
    tags: { establishment_id: 'est-1', env: 'production' },
  };
  const out = redactEvent(event) as typeof event;
  assert.equal(out.contexts.user.email, '[redacted]');
  // opData redactado ENTERO (la clave del denylist), no solo su interior.
  assert.equal(out.extra.opData as unknown, '[redacted]');
  // NO se redacta lo que NO es PII: id de usuario, establishment_id (R7.2), env (R7.3) se conservan.
  assert.equal(out.contexts.user.id, 'user-1');
  assert.equal(out.tags.establishment_id, 'est-1');
  assert.equal(out.tags.env, 'production');
  // Que un valor de PII crudo NO sobreviva en ningún lado del serializado.
  assert.equal(JSON.stringify(out).includes('peon@campo.com'), false);
  assert.equal(JSON.stringify(out).includes('385'), false);
});

test('R7.4.1: match case-insensitive + clave normalizada (memberName/member_name/MemberName colapsan)', () => {
  const out = redactEvent({
    a: { memberName: 'Facundo' },
    b: { member_name: 'Raf' },
    c: { MemberName: 'X' },
    d: { 'member-name': 'Y' },
    e: { NOMBRE: 'Z' },
  }) as Record<string, Record<string, unknown>>;
  assert.equal(out.a.memberName, '[redacted]');
  assert.equal(out.b.member_name, '[redacted]');
  assert.equal(out.c.MemberName, '[redacted]');
  assert.equal(out.d['member-name'], '[redacted]');
  assert.equal(out.e.NOMBRE, '[redacted]');
  assert.equal(JSON.stringify(out).includes('Facundo'), false);
});

test('R7.4/R7.4.1 (MED-1): sesión Supabase completa → access_token Y refresh_token Y email → [redacted]', () => {
  // El refresh_token es OPACO (`v1.M…`, no JWT) → NO lo atrapa ni STRING_SECRET_PATTERNS ni la igualdad
  // exacta contra `token`. Solo cae por INCLUSIÓN (`refreshtoken`.includes('token')). Es la parte que hoy
  // se escapaba: el test se pone ROJO si se revierte el split a igualdad.
  const session = {
    access_token: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEifQ.sig-abc_DEF-123',
    refresh_token: 'v1.M2x9QdaopacoNOesJWTnoMatcheaNingunPatronStringABC123',
    token_type: 'bearer',
    expires_in: 3600,
    user: { id: 'uuid-1', email: 'x@y.com' },
  };
  // Contenedores con clave BENIGNA: así el objeto de sesión NO se redacta entero por su clave y podemos
  // inspeccionar sus hojas una por una. Refleja cómo `captureConsole` serializa un `console.error(.., authObj)`
  // (el objeto cae en `extra.arguments[i]` con claves generadas por Sentry, benignas; las claves de credencial
  // son las HOJAS `access_token`/`refresh_token`). NB: una clave literal `session`/`auth` SÍ se redacta entera
  // (raíz de secreto) — defensa extra, cubierta por el resto del suite.
  const out = redactEvent({
    contexts: { app: { state: session } },
    extra: { arguments: [session] },
  }) as { contexts: { app: { state: typeof session } }; extra: { arguments: [typeof session] } };

  const s1 = out.contexts.app.state;
  const s2 = out.extra.arguments[0];
  for (const s of [s1, s2]) {
    assert.equal(s.access_token as unknown, '[redacted]');
    assert.equal(s.refresh_token as unknown, '[redacted]', 'el refresh_token OPACO es lo que hoy escapa');
    assert.equal(s.user.email as unknown, '[redacted]');
    // no-PII / no-secreto se conserva.
    assert.equal(s.expires_in, 3600);
    assert.equal(s.user.id, 'uuid-1');
  }
  // Ningún valor de credencial/PII crudo sobrevive el serializado (ni el opaco).
  const dump = JSON.stringify(out);
  assert.equal(dump.includes('v1.M2x9'), false, 'el refresh_token opaco no debe sobrevivir');
  assert.equal(dump.includes('eyJhbGciOiJIUzI1NiJ9'), false, 'el access_token no debe sobrevivir');
  assert.equal(dump.includes('x@y.com'), false, 'el email no debe sobrevivir');
});

test('R7.4.1 (blindaje stack traces): un stackframe (filename/function/module/abs_path) queda INTACTO', () => {
  // Regresión que hay que impedir: si PII pasara a match por inclusión, `filename` (contiene `name`) se
  // redactaría y mataría los stack traces de Sentry. Las claves estándar de stackframe NO se tocan.
  const out = redactEvent({
    exception: {
      values: [
        {
          stacktrace: {
            frames: [
              {
                filename: 'app/foo.tsx',
                function: 'render',
                module: 'app.foo',
                abs_path: '/Users/x/app/foo.tsx',
                lineno: 42,
                in_app: true,
              },
            ],
          },
        },
      ],
    },
  }) as {
    exception: {
      values: {
        stacktrace: {
          frames: {
            filename: unknown;
            function: unknown;
            module: unknown;
            abs_path: unknown;
            lineno: unknown;
            in_app: unknown;
          }[];
        };
      }[];
    };
  };
  const frame = out.exception.values[0].stacktrace.frames[0];
  assert.equal(frame.filename, 'app/foo.tsx');
  assert.equal(frame.function, 'render');
  assert.equal(frame.module, 'app.foo');
  assert.equal(frame.abs_path, '/Users/x/app/foo.tsx');
  assert.equal(frame.lineno, 42);
  assert.equal(frame.in_app, true);
});

test('R7.4.2 (fail-closed): si el walk TIRA, redactEvent devuelve null (NO el evento crudo)', () => {
  const evil: Record<string, unknown> = { safe: 'ok' };
  Object.defineProperty(evil, 'boom', {
    enumerable: true,
    get() {
      throw new Error('getter hostil');
    },
  });
  // El fail-safe es "no enviar", jamás "enviar sin filtrar".
  assert.equal(redactEvent({ payload: evil }), null);
  assert.equal(redactBreadcrumb({ data: evil }), null);
});

test('R7.4.3 (defensa de valores string): Bearer / JWT / token= embebidos → [redacted]', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc-DEF_123';
  const out = redactEvent({
    breadcrumb: { message: `Authorization: Bearer ${jwt}` },
    url: `https://api.rafq.ar/x?token=supersecreto123&y=1`,
    raw: jwt,
  }) as Record<string, unknown>;
  const s = JSON.stringify(out);
  assert.equal(s.includes(jwt), false, 'el JWT crudo no debe sobrevivir');
  assert.equal(s.includes('supersecreto123'), false, 'el token= no debe sobrevivir');
  assert.equal(s.includes('[redacted]'), true);
});

test('R7.4: maneja CICLOS sin colgarse y redacta la PII igual', () => {
  const a: Record<string, unknown> = { email: 'x@y.com' };
  a.self = a; // ciclo
  const out = redactEvent(a) as Record<string, unknown>;
  assert.equal(out.email, '[redacted]');
  assert.equal(out.self, '[circular]');
});

test('R7.4: corte de profundidad (estructura patológica) → [truncated], sin PII filtrada', () => {
  let deep: Record<string, unknown> = { email: 'leaf@pii.com' };
  for (let i = 0; i < 40; i++) deep = { child: deep };
  const out = redactEvent(deep);
  const s = JSON.stringify(out);
  assert.equal(s.includes('[truncated]'), true);
  assert.equal(s.includes('leaf@pii.com'), false);
});

test('R7.4: NO muta el original (devuelve una copia)', () => {
  const orig = { email: 'a@b.com', nested: { nombre: 'Juan', ok: 1 } };
  const out = redactEvent(orig) as typeof orig;
  // original intacto
  assert.equal(orig.email, 'a@b.com');
  assert.equal(orig.nested.nombre, 'Juan');
  // copia redactada
  assert.equal(out.email, '[redacted]');
  assert.equal(out.nested.nombre, '[redacted]');
  assert.equal(out.nested.ok, 1);
  assert.notEqual(out, orig);
});

test('R7.4: arrays se recorren y sus elementos se redactan', () => {
  const out = redactEvent({
    breadcrumbs: [{ data: { email: 'a@b.com' } }, { data: { ok: true } }],
  }) as { breadcrumbs: { data: Record<string, unknown> }[] };
  assert.equal(out.breadcrumbs[0].data.email, '[redacted]');
  assert.equal(out.breadcrumbs[1].data.ok, true);
});

test('R7.4: null / undefined / no-objeto no rompen (passthrough seguro)', () => {
  assert.equal(redactEvent(null), null);
  assert.equal(redactEvent(undefined), undefined);
  assert.equal(redactEvent(42 as unknown), 42);
});

test('MEDIUM-2 (Gate 2 del delta ios-ble-mfi): el id de dispositivo Bluetooth se redacta en el breadcrumb', () => {
  // El breadcrumb BLE se arma con `data: { ...event }` VERBATIM (payloads.ts), así que el
  // `connect_superseded { deviceId }` de los tres adapters mandaba el identificador del dispositivo tal
  // cual: la MAC en Android, el serial del accesorio en MFi. `normalizeKey` colapsa las tres grafías.
  const out = redactBreadcrumb({
    category: 'ble',
    data: { kind: 'connect_superseded', deviceId: '11:22:33:44:55:66', device_id: 'AA:BB:CC', deviceid: 'x' },
  }) as { data: Record<string, unknown> };
  assert.equal(out.data.deviceId, '[redacted]');
  assert.equal(out.data.device_id, '[redacted]');
  assert.equal(out.data.deviceid, '[redacted]');
  assert.equal(out.data.kind, 'connect_superseded', 'el kind es diagnóstico: no se toca');
  assert.equal(JSON.stringify(out).includes('11:22:33:44:55:66'), false);
});

test('MEDIUM-2: el scrubber por CLAVES no alcanza un id interpolado en un texto (por eso el fix fue sacarlo)', () => {
  // Este test NO exige una capacidad que el scrubber no tiene: la DOCUMENTA, y por eso el arreglo de
  // fondo vive en el EMISOR (`ble/adapter-ble-gatt.ts`: el `ble_device_not_recognized` pasó a llevar el
  // ordinal del escaneo en vez del identificador del dispositivo).
  // Si algún día el scrubber aprende a barrer identificadores dentro de free-text, este test cae y hay
  // que venir a celebrarlo acá — mientras tanto, es la razón escrita de por qué la defensa no es esta.
  const out = redactBreadcrumb({
    category: 'ble',
    data: { kind: 'connect_error', message: 'ble_device_not_recognized: 11:22:33:44:55:66' },
  }) as { data: Record<string, unknown> };
  assert.equal(
    String(out.data.message).includes('11:22:33:44:55:66'),
    true,
    'un scrubber key-based NO puede tocar un valor embebido en una oración: el fix es no interpolarlo',
  );
});
