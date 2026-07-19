// Teléfono — ORIGEN ÚNICO de la normalización, la máscara y el copy (spec 01, delta TELÉFONO).
//
// Lógica PURA (sin RN, sin red): testeable con node:test. Es el único lugar del cliente donde viven
// las reglas del teléfono (RTEL.2.9): la consumen el input (PhoneField), los services, los helpers de
// la suite E2E y la validación. Ningún otro módulo las reimplementa.
//
// ⚠️ RTEL.2.9 ES UN CONTROL DE SEGURIDAD, NO PROLIJIDAD. La aceptación del riesgo residual R-7 (PII en
//    el log del servidor por el `DETAIL: Failing row contains (...)` del rechazo del CHECK) se apoya en
//    que el rechazo sea prácticamente INALCANZABLE, y eso solo se sostiene mientras el cliente y el
//    CHECK coincidan en TODOS los bordes. Hay tres encodings de las mismas reglas:
//      1. este archivo (TypeScript),
//      2. el backfill `do $$` de supabase/migrations/0126_user_private_phone_format.sql (PL/pgSQL),
//      3. el regex del CHECK `user_private_phone_format_chk` (^\+[1-9][0-9]{7,14}$).
//    La equivalencia 1↔3 la verifica `phone-vectors.json` recorrido por las DOS suites (phone.test.ts y
//    supabase/tests/user_private/run.cjs); la 2↔3 la garantiza el precheck abortivo de la propia
//    migración. Debilitar cualquiera de esas patas obliga a RE-EVALUAR R-7; no es un refactor libre.
//
// Formato canónico (C1/RTEL.1): '+54' + los 10 dígitos NACIONALES para Argentina (sin el 9 de celular:
// no es derivable y un 9 inventado corrompe los fijos de forma irrecuperable), o '+' + 8..15 dígitos
// para el escape internacional. Sin espacios, guiones ni paréntesis.

// ─── Techos (C4) ────────────────────────────────────────────────────────────────────────────────
//
// Cada uno mide una cosa DISTINTA — no son intercambiables, y confundirlos es exactamente el bug que
// este delta cerró. El que gobierna lo PERSISTIDO es PHONE_MAX_STORED_LENGTH (y lo hace cumplir el CHECK
// server, con independencia del cliente); PHONE_MAX_LENGTH solo acota el buffer visible de caracteres.
//
// El par que más se confunde: PHONE_AR_NATIONAL_DIGITS (10) es lo que hace VÁLIDO a un número argentino;
// PHONE_AR_TYPING_MAX_DIGITS (12) es solo hasta dónde se puede TIPEAR. No son el mismo número a propósito
// (ver el docstring de PHONE_AR_TYPING_MAX_DIGITS): 11 y 12 dígitos son estados transitorios que jamás
// llegan a `valid` ni se persisten.

/** AR: el número nacional tiene SIEMPRE 10 dígitos (código de área incluido), sea fijo o celular. */
export const PHONE_AR_NATIONAL_DIGITS = 10;
/**
 * Tope de dígitos TIPEABLES en modo AR (RTEL.4.2). Es 12, NO 10, y la diferencia es deliberada:
 *
 * Con el tope en 10, quien TIPEA su celular como se dice en Argentina —`11 15 2345 6789`— se quedaba en
 * `11 1523-4567`: 10 dígitos, formalmente VÁLIDOS, un número equivocado guardado sin un solo aviso. La
 * ayuda de DP4 nunca llegaba a correr, porque necesita ver los 12 dígitos y el tope los cortaba antes.
 * Pegar funcionaba (el pegado nunca pasó por el tope); tipear, que es el caso común en la manga, no.
 *
 * Dejar entrar los 12 dígitos NO afloja la validación: `normalizePhone` sigue exigiendo el número
 * nacional de 10 (RTEL.5.1) y `111523456789` sigue cayendo en N6 → `incomplete`. Lo que cambia es que
 * ahora el estado inválido es ALCANZABLE tipeando, y con él el diagnóstico y la sugerencia del 15.
 *
 * Efecto secundario buscado: N3 (`0` troncal, 11 dígitos) y N4 (`54` adelante, 12 dígitos) también eran
 * inalcanzables tipeando y se truncaban a 10 dígitos que normalizaban a un número DISTINTO
 * (`01123456789` → `0112345678` → `+540112345678`). Ahora el tipeo llega a la regla correcta.
 *
 * Sigue siendo un tope de BUFFER: nada de 11 o 12 dígitos se persiste jamás — o normaliza por N3/N4, o
 * queda `incomplete` y ninguna de las dos pantallas guarda.
 */
export const PHONE_AR_TYPING_MAX_DIGITS = 12;
/** Mínimo de dígitos del escape internacional (E.164). */
export const PHONE_MIN_DIGITS = 8;
/** Máximo de dígitos del escape internacional (E.164, incluye el código de país). */
export const PHONE_MAX_DIGITS = 15;
/** Largo máximo del valor ALMACENADO: '+' + 15 dígitos. Espeja el CHECK server (RTEL.1.5). */
export const PHONE_MAX_STORED_LENGTH = 16;
/** Tope de caracteres TIPEABLES en el input (buffer de display, RTEL.4.9). No gobierna lo persistido. */
export const PHONE_MAX_LENGTH = 20;
/** Código de país de Argentina (adorno visual fijo del input en modo AR). */
export const PHONE_AR_COUNTRY = '54';

// ─── Copy (voseo, es-AR) — centralizado acá para que no diverja por pantalla (T9) ───────────────

/** Formato esperado en modo AR. Enseña el formato en vez de solo rechazar (RTEL.6.4). */
export const PHONE_HELP_AR = 'Ingresá los 10 dígitos, sin el 0 ni el 15.';
/** Caso detectado del prefijo 15 (RTEL.6.6): mensaje específico, no el genérico. */
export const PHONE_HELP_TRUNK_15 = 'Sacá el 15: no va dentro del número.';
/** Formato esperado en modo internacional (el usuario arrancó con '+'). */
export const PHONE_HELP_INTL = 'Ingresá entre 8 y 15 dígitos, con el código de país.';
/** Código de país que empieza con 0: ninguno del plan E.164 lo hace (MEDIUM-1). */
export const PHONE_HELP_INTL_ZERO = 'El código de país no puede empezar con 0.';
/** El teléfono es obligatorio en el gate de alta de campo (R3.8 / RTEL.5.3). */
export const PHONE_HELP_REQUIRED = 'Ingresá tu teléfono.';
/**
 * El teléfono GUARDADO no se pudo leer al canónico (fila legacy previa a la migración `0126`).
 * `phoneValueFromStored` la reporta `incomplete` y `phoneInputFromValue` no tiene texto crudo con el que
 * rehidratar el campo (el tipo garantiza que solo `valid` transporta contenido) → el input arranca
 * VACÍO con un valor `incomplete` detrás. Sin este mensaje, `validateProfile` bloquea el guardado y el
 * usuario no ve ni borde ni error: un callejón sin salida silencioso. Post-`0126` el residuo es cero,
 * pero producción todavía no está migrada, así que el estado se cubre igual.
 */
export const PHONE_HELP_STORED_UNREADABLE =
  'No pudimos leer tu teléfono guardado. Ingresalo de nuevo.';
/**
 * Copy FIJO del rechazo server-side del formato (23514 sobre `user_private_phone_format_chk`,
 * RTEL.8.3). Es fijo a propósito: la respuesta de Postgres a un CHECK violado trae en `details` el
 * `Failing row contains (...)` con email y teléfono EN CLARO, así que la UI no muestra NADA que venga
 * del error — solo esta cadena (RTEL.8.5).
 */
export const PHONE_FORMAT_REJECTED_COPY =
  'El teléfono no tiene un formato válido. Ingresá los 10 dígitos, sin el 0 ni el 15.';

// ─── Extracción y sanitizado ─────────────────────────────────────────────────────────────────────

// Caracteres permitidos al tipear: dígitos + separadores de formato comunes. Las LETRAS no entran.
const PHONE_ALLOWED_CHAR = /[\d+\-() ]/;

/** Extrae solo los dígitos (descarta '+', espacios, guiones, paréntesis y todo lo demás). */
export function phoneDigits(phone: string): string {
  return phone.replace(/\D/g, '');
}

/**
 * Sanitiza en vivo lo tipeado: descarta lo que no sea dígito o separador permitido y recorta a
 * PHONE_MAX_LENGTH. Se conserva como export porque es el sanitizado genérico de un campo telefónico;
 * `PhoneField` no lo necesita (trabaja directo sobre los dígitos).
 */
export function sanitizePhoneInput(raw: string): string {
  let out = '';
  for (const ch of raw) {
    if (PHONE_ALLOWED_CHAR.test(ch)) out += ch;
    if (out.length >= PHONE_MAX_LENGTH) break;
  }
  return out;
}

// ─── Normalización N1–N6 (RTEL.2) ────────────────────────────────────────────────────────────────

export type NormalizedPhone =
  | { ok: true; canonical: string }
  | { ok: false; reason: 'empty' | 'unrecognized' };

const AR_COUNTRY_MOBILE = '549';

function canonical(value: string): NormalizedPhone {
  return { ok: true, canonical: value };
}

/**
 * Normaliza un texto arbitrario al canónico de RTEL.1, o devuelve "no normalizable". PURA, nunca lanza.
 *
 * La PRECEDENCIA entre la rama '+' y la rama sin '+' NO es cosmética (RTEL.2.10): sin ella un número
 * extranjero de 10 dígitos (+34 600 12345) caería en N2 y se convertiría en un teléfono argentino
 * INVENTADO, y un '+549…' conservaría el 9 contra RTEL.1.4. El '+' es la señal explícita del usuario de
 * que el país NO se asume.
 *
 * El prefijo 15 NUNCA se remueve acá (RTEL.2.8): localizarlo exige la tabla de códigos de área, y esa
 * tabla es COSMÉTICA por diseño (RTEL.4.6) — si participara de la escritura, un largo de área mal
 * clasificado recortaría los dos dígitos equivocados y persistiría en silencio un teléfono incorrecto.
 * La ayuda ante el 15 vive en `detectArTrunkPrefix`, que PROPONE y no escribe.
 */
export function normalizePhone(raw: string): NormalizedPhone {
  const text = raw.trim();
  if (text.length === 0) return { ok: false, reason: 'empty' };

  const digits = phoneDigits(text);
  if (digits.length === 0) return { ok: false, reason: 'unrecognized' };

  if (text.startsWith('+')) {
    // N5 — el usuario dio el 9 de celular: se REMUEVE para tener una sola representación por número
    // nacional (DP2). Va antes que N4/N1 o el 9 sobreviviría.
    if (digits.length === 13 && digits.startsWith(AR_COUNTRY_MOBILE)) {
      return canonical(`+${PHONE_AR_COUNTRY}${digits.slice(-PHONE_AR_NATIONAL_DIGITS)}`);
    }
    // N4 — '+54' + 10 nacionales: ya es el canónico.
    if (digits.length === 12 && digits.startsWith(PHONE_AR_COUNTRY)) {
      return canonical(`+${digits}`);
    }
    // N1 — internacional. El primer dígito NO puede ser '0' (MEDIUM-1): ningún código de país del plan
    // E.164 empieza con 0 (el 0 es prefijo troncal NACIONAL, que es justo lo que descarta N3) y el CHECK
    // server exige ^\+[1-9]… — sin esta condición el cliente daría por válido un valor que el server
    // rechaza con 23514, rompiendo RTEL.2.9 justo en el borde que vuelve alcanzable el leak de R-7.
    if (
      digits.length >= PHONE_MIN_DIGITS &&
      digits.length <= PHONE_MAX_DIGITS &&
      digits[0] !== '0'
    ) {
      return canonical(`+${digits}`);
    }
    return { ok: false, reason: 'unrecognized' }; // N6
  }

  // N2 — 10 dígitos nacionales.
  if (digits.length === PHONE_AR_NATIONAL_DIGITS) {
    return canonical(`+${PHONE_AR_COUNTRY}${digits}`);
  }
  // N3 — 11 dígitos con el 0 troncal adelante.
  if (digits.length === 11 && digits[0] === '0') {
    return canonical(`+${PHONE_AR_COUNTRY}${digits.slice(-PHONE_AR_NATIONAL_DIGITS)}`);
  }
  // N4 — 12 dígitos con 54 adelante.
  if (digits.length === 12 && digits.startsWith(PHONE_AR_COUNTRY)) {
    return canonical(`+${digits}`);
  }
  // N5 — 13 dígitos con 549 adelante: se saca el 9 (DP2).
  if (digits.length === 13 && digits.startsWith(AR_COUNTRY_MOBILE)) {
    return canonical(`+${PHONE_AR_COUNTRY}${digits.slice(-PHONE_AR_NATIONAL_DIGITS)}`);
  }
  return { ok: false, reason: 'unrecognized' }; // N6
}

/**
 * Teléfono válido (RTEL.5.1/RTEL.5.2): AR = 10 dígitos exactos; internacional ('+') = 8 a 15 dígitos con
 * primer dígito distinto de 0. Es exactamente `normalizePhone(raw).ok` — una sola definición.
 *
 * ⚠️ CAMBIO DE CRITERIO vs. el as-built previo: antes 8 dígitos sin '+' daban true (rango E.164 crudo);
 * con D2 el modo AR exige los 10 dígitos nacionales.
 */
export function isValidPhone(raw: string): boolean {
  return normalizePhone(raw).ok;
}

// ─── Códigos de área y máscara (DP1) ─────────────────────────────────────────────────────────────
//
// ⚠️ ESTA TABLA ES PURAMENTE COSMÉTICA (RTEL.4.6). NO participa de la validación (siempre 10 dígitos)
//    ni del almacenamiento (siempre '+54' + los 10 dígitos). Una entrada faltante o equivocada solo
//    cambia dónde caen el espacio y el guión: NUNCA bloquea al usuario ni corrompe un dato. Esa
//    propiedad es lo que hace aceptable mantenerla a mano en vez de sumar una librería multi-país (D4).

const AR_AREA_2 = ['11'];
const AR_AREA_3 = [
  '220', '221', '223', '230', '236', '237', '249', '260', '261', '263', '264', '266',
  '280', '291', '297', '299', '336', '341', '342', '343', '345', '348', '351', '353',
  '358', '362', '364', '370', '376', '379', '380', '381', '383', '385', '387', '388',
];

/**
 * Largo del código de área argentino: 2, 3 o 4 dígitos. EXHAUSTIVA por construcción — todo lo que no
 * está en las dos listas se trata como 4 dígitos (el caso más común: 2241 Chascomús, 2914, 3489, …).
 */
export function arAreaCodeLength(digits: string): 2 | 3 | 4 {
  if (AR_AREA_2.includes(digits.slice(0, 2))) return 2;
  if (AR_AREA_3.includes(digits.slice(0, 3))) return 3;
  return 4;
}

/**
 * Agrupa los dígitos NACIONALES para el tipeo en vivo (RTEL.4.3): `11 2345-6789` / `341 456-7890` /
 * `2241 43-0000` según el largo del código de área.
 *
 * NUNCA emite un separador antes de que exista un dígito que lo siga (RTEL.4.4) — agrupa SOLO lo ya
 * tipeado. Eso elimina de raíz el loop clásico "backspace borra el separador → la máscara lo re-agrega
 * → el usuario queda trabado": como no hay separador colgando al final, el backspace siempre saca un
 * dígito.
 *
 * ESTADOS TRANSITORIOS DE 11 Y 12 DÍGITOS (alcanzables tipeando desde que el tope subió a
 * PHONE_AR_TYPING_MAX_DIGITS, y desde siempre al pegar): el excedente se acumula en el ÚLTIMO grupo
 * (`11 1523-45678`, `11 1523-456789`, `2241 15-430000`). No se abre un grupo nuevo a propósito: el
 * excedente tiene que LEERSE como excedente, y además así la posición del espacio y del guion no se
 * mueve mientras el usuario sigue tipeando. Sigue sin haber separador colgando, así que RTEL.4.4 vale
 * igual en estos largos.
 */
export function maskArPhone(digits: string): string {
  const area = arAreaCodeLength(digits);
  if (digits.length <= area) return digits;

  const head = digits.slice(0, area);
  const rest = digits.slice(area);
  const midLength = PHONE_AR_NATIONAL_DIGITS - area - 4;
  if (rest.length <= midLength) return `${head} ${rest}`;
  return `${head} ${rest.slice(0, midLength)}-${rest.slice(midLength)}`;
}

/**
 * Formatea un canónico para MOSTRARLO (RTEL.10.1): '+541123456789' → '+54 11 2345-6789'. Un canónico
 * internacional se muestra tal cual (no conocemos su agrupación). null / vacío → cadena vacía (el
 * caller decide el placeholder, ej. "Sin teléfono").
 */
export function formatPhoneDisplay(canonicalValue: string | null | undefined): string {
  const value = (canonicalValue ?? '').trim();
  if (value.length === 0) return '';
  const arPrefix = `+${PHONE_AR_COUNTRY}`;
  const national = value.startsWith(arPrefix) ? value.slice(arPrefix.length) : '';
  if (national.length === PHONE_AR_NATIONAL_DIGITS && /^\d+$/.test(national)) {
    return `${arPrefix} ${maskArPhone(national)}`;
  }
  return value;
}

// ─── Ayuda ante el prefijo 15 — DP4 (opción D: detectar y SUGERIR con confirmación) ─────────────

/**
 * Detecta el patrón del prefijo 15 (forma corriente de escribir un celular en AR: `11 15 2345 6789`) y
 * PROPONE el número de 10 dígitos resultante.
 *
 * ⚠️ INVARIANTE DE SEGURIDAD (RTEL.6.8, verificado por el re-Gate 1 — NO relajar): esta función NO se
 *    invoca desde `normalizePhone` ni desde ningún camino de escritura. Vive en la capa de presentación
 *    del error: PROPONE, no escribe. Es lo que mantiene la tabla de códigos de área confinada a
 *    presentación (RTEL.4.6) y sostiene la justificación de RTEL.2.8 — si la tabla escribiera, un largo
 *    de área mal clasificado recortaría los dígitos equivocados y persistiría en silencio un teléfono
 *    incorrecto. El valor sugerido, una vez ACEPTADO por el usuario, vuelve a entrar por el camino
 *    normal (normalizePhone → PhoneValue → re-normalización del service → CHECK), sin atajo (RTEL.6.9).
 *
 * Modo de falla si la tabla estuviera mal: el chequeo del 15 cae en el offset equivocado → casi siempre
 * NO matchea → no hay sugerencia → se cae al mensaje genérico. Degrada a "sin ayuda", nunca a dato malo.
 */
export function detectArTrunkPrefix(digits: string): { suggestion: string } | null {
  if (digits.length !== PHONE_AR_NATIONAL_DIGITS + 2) return null;
  const area = arAreaCodeLength(digits);
  if (digits.slice(area, area + 2) !== '15') return null;
  return { suggestion: digits.slice(0, area) + digits.slice(area + 2) };
}

// ─── Valor del campo (contrato de PhoneField) ────────────────────────────────────────────────────

/**
 * Valor del campo de teléfono. TRES estados explícitos (RTEL.3.1.1): el caller nunca recibe texto crudo
 * tipeado, porque el único campo que transporta un valor vive en `valid`. Y `empty` NO se conflaciona
 * con inválido: esa distinción es funcional — el perfil acepta vacío y persiste null (RTEL.5.4)
 * mientras que el gate de alta de campo debe rechazarlo (RTEL.5.3).
 *
 * Vive acá (utils) y no en el componente para que la derivación y el copy sean PUROS y testeables sin
 * montar React; `PhoneField` re-exporta el tipo como parte de su contrato.
 */
export type PhoneValue =
  | { kind: 'empty' }
  | { kind: 'incomplete' }
  | { kind: 'valid'; canonical: string };

/** Deriva el `PhoneValue` del estado interno del input (dígitos + modo). PURA. */
export function phoneValueFrom(digits: string, intl: boolean): PhoneValue {
  if (digits.length === 0) return { kind: 'empty' };
  const result = normalizePhone(intl ? `+${digits}` : digits);
  return result.ok ? { kind: 'valid', canonical: result.canonical } : { kind: 'incomplete' };
}

/**
 * `PhoneValue` a partir de un teléfono ya ALMACENADO (lo que devuelve la DB). Vacío/null → `empty`.
 * Un valor legacy que no normalice queda `incomplete` (el campo arranca vacío y el usuario lo vuelve
 * a cargar) — nunca se muestra como si fuera un canónico válido.
 */
export function phoneValueFromStored(stored: string | null | undefined): PhoneValue {
  if (stored == null || stored.trim().length === 0) return { kind: 'empty' };
  const result = normalizePhone(stored);
  return result.ok ? { kind: 'valid', canonical: result.canonical } : { kind: 'incomplete' };
}

/** ¿Dos `PhoneValue` representan lo mismo? (comparación por contenido, no por identidad). */
export function samePhoneValue(a: PhoneValue, b: PhoneValue): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'valid' && b.kind === 'valid') return a.canonical === b.canonical;
  return true;
}

// ─── Transición del input (lo que hace `PhoneField` en cada tecla) ───────────────────────────────
//
// Vive acá, PURA, y no dentro del componente: así el tipeo, el borrado, el pegado y los topes se
// testean sin montar React (el repo no tiene renderer de componentes). El componente queda como una
// cáscara que renderiza `renderPhoneInput` y emite lo que devuelve `phoneInputChange`.

export type PhoneInputState = {
  /** Solo dígitos. El texto visible es DERIVADO (máscara). */
  digits: string;
  /** Modo internacional: el usuario arrancó con '+' → sin adorno +54 y sin máscara AR. */
  intl: boolean;
};

export const EMPTY_PHONE_INPUT: PhoneInputState = { digits: '', intl: false };

/** Texto visible del input a partir del estado. */
export function renderPhoneInput(state: PhoneInputState): string {
  return state.intl ? `+${state.digits}` : maskArPhone(state.digits);
}

/**
 * Estado del input a partir de un `PhoneValue`. Solo `valid` transporta contenido, así que `empty` e
 * `incomplete` arrancan vacíos — no hay texto crudo que recuperar (es la garantía del tipo).
 */
export function phoneInputFromValue(value: PhoneValue): PhoneInputState {
  if (value.kind !== 'valid') return EMPTY_PHONE_INPUT;
  const digits = value.canonical.replace(/\D/g, '');
  const country = PHONE_AR_COUNTRY;
  if (digits.startsWith(country) && digits.length === country.length + PHONE_AR_NATIONAL_DIGITS) {
    return { digits: digits.slice(country.length), intl: false };
  }
  return { digits, intl: true };
}

/**
 * Aplica un cambio de texto del input y devuelve el estado nuevo + el valor a EMITIR al caller.
 *
 * El valor se devuelve SIEMPRE (nunca `undefined` "porque no cambió nada relevante"): el componente
 * emite en cada cambio, incluidas las transiciones `valid → incomplete` y `valid → empty`
 * (RTEL.3.1.2 / L-2). Si emitiera solo al alcanzar `valid`, borrar un dígito de un número ya válido
 * dejaría al caller con el canónico VIEJO y persistiría un número que el usuario ya editó, sin que
 * ninguna de las tres capas lo atrapara (el tipo estaría bien, re-normalizar un canónico es
 * idempotente, y el CHECK lo aceptaría: ES un canónico bien formado, del número equivocado).
 */
export function phoneInputChange(
  previous: PhoneInputState,
  incoming: string,
): { state: PhoneInputState; value: PhoneValue } {
  const state = nextPhoneInput(previous, incoming);
  return { state, value: phoneValueFrom(state.digits, state.intl) };
}

function nextPhoneInput(previous: PhoneInputState, incoming: string): PhoneInputState {
  // Modo internacional: se activa cuando el PRIMER carácter es '+' (tipeado o pegado) y se desactiva
  // al vaciar el campo (RTEL.4.7 / RTEL.4.8).
  const intl = incoming.trimStart().startsWith('+');
  const digits = incoming.replace(/\D/g, '');

  if (digits.length === 0) return { digits: '', intl };

  const added = digits.length - previous.digits.length;

  if (added > 1) {
    // PEGADO (RTEL.4.5): entra más de un dígito de una. Se pasa por normalizePhone; si sale canónico
    // se adopta con su modo. Si NO, se conservan los dígitos pegados y el caller muestra el error —
    // NO se truncan a 10 en silencio (eso los haría parecer válidos y escondería el problema). El
    // corte en PHONE_MAX_DIGITS es una cota de buffer: arriba de 15 dígitos nada puede ser un teléfono.
    const normalized = normalizePhone(incoming);
    if (normalized.ok) return phoneInputFromValue({ kind: 'valid', canonical: normalized.canonical });
    return { digits: digits.slice(0, PHONE_MAX_DIGITS), intl };
  }

  if (added === 0 && incoming.length < renderPhoneInput(previous).length) {
    // El usuario borró un SEPARADOR de la máscara (misma cantidad de dígitos, texto más corto). Se
    // descarta el último dígito para que el backspace nunca quede trabado (RTEL.4.4).
    return { digits: digits.slice(0, -1), intl };
  }

  if (added > 0) {
    // TIPEO: el modo AR acota a 12 dígitos (RTEL.4.2 — ver PHONE_AR_TYPING_MAX_DIGITS: con el tope en
    // 10, un celular tipeado con el 15 se recortaba a 10 dígitos VÁLIDOS del número equivocado) y el
    // internacional a 15 (E.164). El tope frena solo el CRECIMIENTO: si el campo ya tiene más dígitos
    // (por un pegado no normalizable), no se recorta lo que el usuario pegó. Al devolver el estado
    // ANTERIOR (en vez de "no cambiar nada"), el input controlado se re-renderiza y el carácter de más
    // no queda pegado en el DOM/nativo.
    const cap = intl ? PHONE_MAX_DIGITS : PHONE_AR_TYPING_MAX_DIGITS;
    if (digits.length > cap) return previous;
  }

  return { digits, intl };
}

/** Diagnóstico del contenido del input: mensaje accionable + sugerencia confirmable (DP4). */
export type PhoneDiagnosis = { message: string; suggestion: string | null };

/**
 * Mensaje de error del campo derivado de lo que hay tipeado (RTEL.6.4 / RTEL.6.6 / RTEL.6.7). PURA.
 * Devuelve null cuando no hay nada que reportar (valor válido, o vacío en un campo opcional).
 *
 * `suggestion` son los 10 dígitos NACIONALES propuestos ante el patrón del 15; el componente los
 * muestra formateados y solo los aplica tras una acción explícita del usuario (RTEL.6.7/RTEL.6.8).
 *
 * `unreadableStored` cubre el único estado en que el campo está VACÍO y aun así hay algo mal: el valor
 * guardado no se pudo normalizar (legacy pre-`0126`), así que no hay texto con el que rehidratar. Gana
 * sobre `required` porque el usuario no "se olvidó" de escribirlo — se lo perdimos nosotros.
 */
export function phoneDiagnosis(
  digits: string,
  options: { intl: boolean; required: boolean; unreadableStored?: boolean },
): PhoneDiagnosis | null {
  if (digits.length === 0) {
    if (options.unreadableStored) {
      return { message: PHONE_HELP_STORED_UNREADABLE, suggestion: null };
    }
    return options.required ? { message: PHONE_HELP_REQUIRED, suggestion: null } : null;
  }
  if (phoneValueFrom(digits, options.intl).kind === 'valid') return null;

  if (options.intl) {
    const message = digits[0] === '0' ? PHONE_HELP_INTL_ZERO : PHONE_HELP_INTL;
    return { message, suggestion: null };
  }

  const trunk = detectArTrunkPrefix(digits);
  if (trunk) return { message: PHONE_HELP_TRUNK_15, suggestion: trunk.suggestion };
  return { message: PHONE_HELP_AR, suggestion: null };
}
