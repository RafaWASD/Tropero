#!/usr/bin/env node
// scripts/gen-baston-sounds.mjs — GENERADOR de los dos avisos sonoros del bastón (spec 04, R4.2/R4.8).
//
// ── POR QUÉ SE GENERAN Y NO SE BAJAN ────────────────────────────────────────────────────────────────
// Un .wav bajado de un banco de sonidos trae tres problemas que no queremos discutir de nuevo en seis
// meses: (1) la licencia hay que rastrearla y demostrarla, (2) nadie puede explicar POR QUÉ ese sonido
// y no otro, y (3) no se puede ajustar. Acá el asset ES este script: los parámetros de síntesis son la
// documentación, la licencia es nuestra, y cambiar el tono es cambiar un número y volver a correrlo.
//
//   node scripts/gen-baston-sounds.mjs
//
// Salida (se COMMITEA — Metro los empaqueta con require(), `wav` está en assetExts por default):
//   app/assets/sounds/read-ok.wav      · lectura confirmada
//   app/assets/sounds/read-error.wav   · llegó algo y NO servía (trama corrupta / EID inválido)
//
// ── POR QUÉ ESAS FRECUENCIAS (la manga, no el gusto) ────────────────────────────────────────────────
// El parlante de un teléfono es un transductor de ~1 cm: por debajo de ~700 Hz prácticamente no emite,
// y su pico de eficiencia cae en 2–4 kHz. El oído humano, por su lado, es más sensible justo ahí
// (2–5 kHz). O sea: un tono en esa banda es lo MÁS FUERTE que un teléfono puede hacer con la misma
// potencia. Y el ruido de la manga (vacas berreando, motor, portones) tiene su energía bien abajo, así
// que un agudo se separa del piso de ruido en vez de competir con él. Es también la banda donde beepean
// los lectores de código de barras (~2,7 kHz), así que suena a "el aparato leyó" sin que nadie lo
// explique.
//
//   read-ok    → UN pip de 3150 Hz, 110 ms. Corto, agudo, único.
//   read-error → DOS pips DESCENDENTES (1300 → 850 Hz), 250 ms en total. Distinto en las TRES
//                dimensiones que se perciben con ruido: altura (más grave), cantidad (dos) y duración
//                (más del doble). Descendente = convención universal de "no" (ascendente = "sí").
//
// Se agrega un poco de 3.º armónico: un tono con armónicos impares se recorta ("cuts through") sobre
// ruido de banda ancha mucho mejor que una senoidal pura del mismo RMS, sin sonar a alarma.
// Envolvente con ataque y caída suaves: un corte abrupto produce un click de banda ancha (y en un
// parlante chico, distorsión) que ensucia justo el transitorio que queremos que se oiga.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(HERE, '..', 'app', 'assets', 'sounds');

const SAMPLE_RATE = 44100;
/** Pico de la muestra. 0,89 deja headroom: al sumar el armónico no se satura el entero de 16 bits. */
const PEAK = 0.89;
/** Ataque/caída de la envolvente (s). Sin esto, el corte cuadrado hace un click y distorsiona. */
const ATTACK_S = 0.004;
const RELEASE_S = 0.02;
/** Amplitud relativa del 3.º armónico (brillo/penetración sin sonar a alarma). */
const THIRD_HARMONIC = 0.28;

/** @typedef {{ freq: number, ms: number }} Pip */
/** @typedef {{ gapMs: number, pips: Pip[] }} Cue */

/** Envolvente lineal ataque/sostén/caída de una muestra dentro de un pip de `n` muestras. */
function envelope(i, n) {
  const attack = Math.max(1, Math.round(ATTACK_S * SAMPLE_RATE));
  const release = Math.max(1, Math.round(RELEASE_S * SAMPLE_RATE));
  if (i < attack) return i / attack;
  if (i > n - release) return Math.max(0, (n - i) / release);
  return 1;
}

/** Muestras float [-1,1] de un cue (secuencia de pips separados por silencio). */
function renderCue(cue) {
  /** @type {number[]} */
  const out = [];
  cue.pips.forEach((pip, index) => {
    if (index > 0) {
      const gap = Math.round((cue.gapMs / 1000) * SAMPLE_RATE);
      for (let i = 0; i < gap; i++) out.push(0);
    }
    const n = Math.round((pip.ms / 1000) * SAMPLE_RATE);
    for (let i = 0; i < n; i++) {
      const t = i / SAMPLE_RATE;
      const w = Math.sin(2 * Math.PI * pip.freq * t) + THIRD_HARMONIC * Math.sin(2 * Math.PI * 3 * pip.freq * t);
      out.push(w * envelope(i, n));
    }
  });
  // Normalización al PICO REAL de la suma, no a una cota teórica: dividir por (1 + armónico) dejaba el
  // pico en ~0,63 de fondo de escala, o sea ~4 dB REGALADOS en un aviso cuyo único trabajo es oírse
  // arriba del ruido de la manga. Se normaliza al máximo medido y recién ahí se aplica el headroom.
  const peak = out.reduce((m, s) => Math.max(m, Math.abs(s)), 0);
  const gain = peak > 0 ? PEAK / peak : 0;
  return out.map((s) => s * gain);
}

/** WAV PCM 16-bit mono, cabecera RIFF mínima de 44 bytes. */
function toWav(samples) {
  const dataBytes = samples.length * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16); // tamaño del bloque fmt
  buf.writeUInt16LE(1, 20); // PCM sin comprimir
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(SAMPLE_RATE, 24);
  buf.writeUInt32LE(SAMPLE_RATE * 2, 28); // byte rate = sampleRate * canales * bytesPorMuestra
  buf.writeUInt16LE(2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits por muestra
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(clamped * 32767), 44 + i * 2);
  }
  return buf;
}

/** @type {Record<string, Cue>} */
const CUES = {
  // Lectura confirmada: un solo pip agudo y corto (el "tic" del lector).
  'read-ok': { gapMs: 0, pips: [{ freq: 3150, ms: 110 }] },
  // Llegó algo y no servía: dos pips descendentes, más graves y más largo en total.
  'read-error': { gapMs: 45, pips: [{ freq: 1300, ms: 95 }, { freq: 850, ms: 110 }] },
};

mkdirSync(OUT_DIR, { recursive: true });
for (const [name, cue] of Object.entries(CUES)) {
  const wav = toWav(renderCue(cue));
  const file = join(OUT_DIR, `${name}.wav`);
  writeFileSync(file, wav);
  const totalMs = cue.pips.reduce((a, p) => a + p.ms, 0) + cue.gapMs * (cue.pips.length - 1);
  console.log(`${file}  ${wav.length} bytes  ${totalMs} ms  ${cue.pips.map((p) => `${p.freq}Hz`).join(' → ')}`);
}
