// Idempotencia de las operaciones masivas DE EVENTO (spec 10, T-CL.5 / R6.1). SIN I/O, SIN RN/expo/
// supabase: testeable con node:test (mismo patrón que bulk-candidates.ts / bulk-selection.ts).
//
// MODELO (design §7 / R6.1): para vacunación y destete (ops que INSERTAN un evento), la PK (`id`) del
// evento se deriva DETERMINÍSTICAMENTE de la clave lógica `(animal_profile_id, tipo, fecha)` con UUIDv5
// sobre un namespace fijo. Así, si dos syncs concurrentes del MISMO evento lógico se suben (re-intento
// at-least-once, dos dispositivos offline que aplicaron la misma masiva), COLISIONAN en la PK → la DB
// deduplica sin constraint nuevo (M2 Gate 1 s21). Es la 2da barrera; la 1ra es la exclusión local de
// ya-procesados (R6.2, en bulk-candidates: los ya destetados/castrados no son candidatos; vacunación
// skip already_applied).
//
//   ⚠ La CASTRACIÓN NO usa este módulo: es un UPDATE de estado (`is_castrated`), no un INSERT de evento
//     → no tiene PK que dedupe; su idempotencia es SEMÁNTICA (estado absoluto: re-UPDATE = no-op por
//     valor; los ya castrados ni son candidatos — R6.1/D3). La observación automática que acompaña al
//     flip (R13.7) usa `id` RANDOM (crypto.randomUUID), NO este UUIDv5 (design §3.5: se crea exactamente
//     una vez por apply local; el dedup determinístico cruzado borraría la autoría de un actor).
//
// LÍMITE consciente (R6.1): dos vacunaciones LEGÍTIMAS del mismo animal el mismo día por la masiva
// colapsan a un solo evento (misma clave → mismo id). Es el comportamiento deseado para la masiva
// (idempotencia > duplicado); si el productor necesita dos dosis el mismo día, las carga por el flujo
// INDIVIDUAL (id random, events.ts). Sin falsos positivos entre animales/tipos/fechas distintos.
//
// UUIDv5 (RFC 4122 §4.3): version 5 = SHA-1(namespace_bytes ++ utf8(name)), tomando los primeros 16
// bytes, con los bits de versión (5) y variante (RFC 4122) seteados. Implementamos SHA-1 PURO en JS
// (sin node:crypto ni deps nativas) para que corra idéntico en Hermes (RN), web y Node — el repo nunca
// usa node:crypto (solo globalThis.crypto.randomUUID para ids random). Determinístico y sin estado.

/** Tipos de operación de EVENTO que llevan id determinístico (la castración NO — ver header). */
export type EventBulkType = 'vaccination' | 'weaning';

/** La clave lógica idempotente de un evento de masiva: (animal, tipo, fecha). */
export type IdempotencyKey = {
  /** animal_profiles.id sobre el que se aplica el evento. */
  animalProfileId: string;
  /** Tipo de evento ('vaccination' → sanitary_events / 'weaning' → reproductive_events). */
  type: EventBulkType;
  /** Fecha de la operación 'YYYY-MM-DD' (la fecha del evento, NO el timestamp de aplicación). */
  date: string;
};

/**
 * Namespace UUID FIJO de las operaciones masivas de RAFAQ (RFC 4122 §4.3). Es un UUID v4 generado UNA vez
 * y CONGELADO acá: cambiar este valor cambiaría TODOS los ids derivados → NUNCA modificar (rompería la
 * dedup contra eventos ya subidos). No es secreto (es un discriminador de namespace, no una clave).
 */
export const BULK_EVENT_NAMESPACE = '6b9a7d2e-1c4f-5a83-9e0b-2f3c4d5e6a7b';

/**
 * Construye la cadena canónica de la clave (el "name" del UUIDv5). Orden y separador FIJOS — cambiarlos
 * cambiaría los ids. Formato: `<type>:<animalProfileId>:<date>`. El tipo va primero para que dos eventos
 * de tipos distintos del mismo animal/fecha NUNCA colisionen.
 */
export function idempotencyName(key: IdempotencyKey): string {
  return `${key.type}:${key.animalProfileId}:${key.date}`;
}

/**
 * `id` (PK) determinístico de un evento de masiva (R6.1): UUIDv5(BULK_EVENT_NAMESPACE, name(key)). Misma
 * clave ⇒ MISMO id (dedup); claves distintas ⇒ ids distintos (sin colisión espuria). PURA, sin estado.
 */
export function bulkEventId(key: IdempotencyKey): string {
  return uuidv5(idempotencyName(key), BULK_EVENT_NAMESPACE);
}

/**
 * Dado un conjunto de claves candidatas y el set de ids YA PRESENTES localmente (eventos ya cargados de
 * este tipo/fecha — el caller los lee del SQLite), devuelve SOLO las claves cuyo id determinístico NO
 * existe aún → las mutaciones REALMENTE nuevas (R6.2/R6.3: re-ejecutar la masiva excluye los ya
 * procesados). PURA: el caller resuelve el `existingIds` (lectura local) y consume el resultado.
 */
export function filterNewEventKeys(
  keys: readonly IdempotencyKey[],
  existingIds: ReadonlySet<string>,
): { key: IdempotencyKey; id: string }[] {
  const out: { key: IdempotencyKey; id: string }[] = [];
  const seen = new Set<string>(); // dedup intra-batch (dos claves iguales en la misma corrida)
  for (const key of keys) {
    const id = bulkEventId(key);
    if (existingIds.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push({ key, id });
  }
  return out;
}

// ─── UUIDv5 (RFC 4122 §4.3) sobre SHA-1 puro ───────────────────────────────────────────────────

/**
 * UUID versión 5 de `name` bajo `namespace` (un UUID en formato canónico). RFC 4122 §4.3:
 *   hash = SHA-1( namespace_bytes(16) ++ utf8_bytes(name) )
 *   uuid = primeros 16 bytes de hash, con version=5 y variant=RFC4122.
 */
export function uuidv5(name: string, namespace: string): string {
  const nsBytes = parseUuidToBytes(namespace);
  const nameBytes = utf8Bytes(name);
  const input = new Uint8Array(nsBytes.length + nameBytes.length);
  input.set(nsBytes, 0);
  input.set(nameBytes, nsBytes.length);

  const hash = sha1(input); // 20 bytes
  const bytes = hash.slice(0, 16);
  // version 5: bits altos del byte 6 = 0101.
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  // variant RFC 4122: bits altos del byte 8 = 10.
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return bytesToUuid(bytes);
}

/** Parsea un UUID canónico ('8-4-4-4-12' hex) a 16 bytes. Lanza si el formato es inválido. */
function parseUuidToBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, '');
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) {
    throw new Error(`UUID namespace inválido: ${uuid}`);
  }
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i += 1) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** 16 bytes → UUID canónico en minúsculas ('8-4-4-4-12'). */
function bytesToUuid(bytes: Uint8Array): string {
  const hex: string[] = [];
  for (let i = 0; i < 16; i += 1) hex.push(bytes[i].toString(16).padStart(2, '0'));
  return (
    hex.slice(0, 4).join('') +
    '-' +
    hex.slice(4, 6).join('') +
    '-' +
    hex.slice(6, 8).join('') +
    '-' +
    hex.slice(8, 10).join('') +
    '-' +
    hex.slice(10, 16).join('')
  );
}

/** Codifica una cadena a bytes UTF-8. Usa TextEncoder (disponible en Hermes, web, Node). */
function utf8Bytes(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

/**
 * SHA-1 puro (FIPS 180-1) sobre un Uint8Array → 20 bytes. Sin deps nativas (corre en Hermes/web/Node).
 * Implementación clásica de 80 rondas; suficiente para la dedup determinística (NO es criptografía de
 * seguridad — solo un hash estable para derivar la PK; SHA-1 es exactamente lo que pide RFC 4122 §4.3).
 */
export function sha1(data: Uint8Array): Uint8Array {
  // Padding: mensaje ++ 0x80 ++ zeros ++ longitud en bits (64-bit big-endian).
  const ml = data.length * 8;
  const withOne = data.length + 1;
  const totalLen = withOne + ((56 - (withOne % 64) + 64) % 64) + 8;
  const msg = new Uint8Array(totalLen);
  msg.set(data, 0);
  msg[data.length] = 0x80;
  // longitud en bits, big-endian, en los últimos 8 bytes (solo soportamos < 2^32 bits ≈ 512MB → alcanza).
  const lenView = new DataView(msg.buffer);
  lenView.setUint32(totalLen - 4, ml >>> 0, false);
  lenView.setUint32(totalLen - 8, Math.floor(ml / 0x100000000), false);

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;

  const w = new Uint32Array(80);
  for (let chunk = 0; chunk < totalLen; chunk += 64) {
    for (let i = 0; i < 16; i += 1) {
      w[i] = lenView.getUint32(chunk + i * 4, false);
    }
    for (let i = 16; i < 80; i += 1) {
      w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;

    for (let i = 0; i < 80; i += 1) {
      let f: number;
      let k: number;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const tmp = (rotl(a, 5) + f + e + k + w[i]) | 0;
      e = d;
      d = c;
      c = rotl(b, 30);
      b = a;
      a = tmp;
    }

    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
  }

  const out = new Uint8Array(20);
  const outView = new DataView(out.buffer);
  outView.setUint32(0, h0 >>> 0, false);
  outView.setUint32(4, h1 >>> 0, false);
  outView.setUint32(8, h2 >>> 0, false);
  outView.setUint32(12, h3 >>> 0, false);
  outView.setUint32(16, h4 >>> 0, false);
  return out;
}

/** Rotación circular a la izquierda de un uint32 por `n` bits. */
function rotl(x: number, n: number): number {
  return ((x << n) | (x >>> (32 - n))) | 0;
}
