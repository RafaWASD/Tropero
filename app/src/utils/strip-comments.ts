// stripSourceComments — blanquea comentarios de un fuente TS/TSX **preservando posiciones y saltos de
// línea**, para que los guards estáticos del repo puedan escanear CÓDIGO sin confundir una mención
// documental con una violación (y sin desalinear los números de línea que reportan).
//
// ── POR QUÉ EXISTE (bug real, encontrado en esta unidad) ──────────────────────────────────────────────
// Los guards nacieron con este blanqueo hecho a dos regexes:
//
//     src.replace(/\/\*[\s\S]*?\*\//g, blanquear)   // 1) comentarios de bloque
//        .replace(/\/\/[^\n]*/g, blanquear)          // 2) comentarios de línea
//
// El paso (1) corre PRIMERO sobre el fuente crudo, así que un `/*` que aparece **dentro de un comentario
// de línea** abre un bloque falso que se come todo hasta el próximo `*/` del archivo. Medido sobre el
// árbol de `fc4d164`: en `app/_components/FindOrCreateOverlay.tsx` el comentario de la línea 91 termina
// con «La vía que NO toca `ble/*`.» → el falso bloque va de la línea **91 a la 229** (139 líneas, de las
// cuales **84 son código**: la declaración del componente y su JSX). Para los guards que usaban ese
// blanqueo, ese pedazo del archivo simplemente NO EXISTÍA: cualquier violación ahí adentro pasaba en
// verde, en silencio, en una de las pantallas 🔴 de la manga.
//
// ── LA MEDICIÓN, CON LA MÉTRICA DECLARADA ───────────────────────────────────────────────────────────
// Métrica: **líneas de CÓDIGO que el escáner viejo dejaba invisibles** — una línea cuenta si el blanqueo
// correcto le deja algo distinto de espacios y el viejo la deja ENTERA en blanco. Universo: los archivos
// `.ts`/`.tsx` de `app/app` + `app/src` sin los `.test.*` (o sea, exactamente lo que los guards escanean),
// sobre el árbol de `fc4d164`. Resultado: **556 líneas en 6 archivos** — 341 `app/maniobra/identificar.tsx`,
// 113 `app/asignar-caravanas.tsx`, 84 `app/_components/FindOrCreateOverlay.tsx`, 10 `app/_layout.tsx`,
// 6 `src/services/sigsa/sigsa-validator.ts`, 2 `src/services/sigsa/sigsa-txt-generator.ts`.
// (Una versión anterior de este header decía "1008 líneas en 57 archivos". Ese número no reproduce con
// ninguna métrica y se corrigió: un guard que documenta su propio historial con un número inventado es el
// mismo modo de falla que vino a cerrar.)
// Invertir el orden no arregla nada: blanquear `//` primero rompe los bloques que contienen una URL
// (`* ver https://…`), y ahí el `*/` desaparece y el bloque se come el resto del ARCHIVO.
//
// La única forma correcta es recorrer el fuente **con estado**, distinguiendo código / comentario de
// línea / comentario de bloque / string ('…', "…", `…`). Eso es lo que hace esta función.
//
// ── LÍMITE DECLARADO ────────────────────────────────────────────────────────────────────────────────
// No es un parser de TS: no distingue una división (`a / b`) de un literal de regex (`/ab+/`). Un regex
// que contenga `//` o `/*` podría confundirla. Es una diferencia teórica para este uso (los guards leen
// componentes de UI) y el costo de un parser real no se paga: preferimos el escáner de estados, que ya
// elimina el modo de falla que sí estaba pasando en el árbol real.

/** Estados del escáner. `code` es "afuera de todo". */
type ScanState = 'code' | 'line' | 'block' | 'single' | 'double' | 'template';

/**
 * Devuelve el mismo fuente con **todo el contenido de los comentarios reemplazado por espacios**
 * (los `\n` se conservan): mismo largo, mismas líneas, mismos offsets.
 *
 * Las strings NO se blanquean (un guard tiene que poder ver `testID="…"`), pero sí se ATRAVIESAN sin
 * interpretar comentarios adentro: `'https://x'` no abre un comentario de línea.
 */
export function stripSourceComments(src: string): string {
  return scan(src, false);
}

/**
 * Igual que `stripSourceComments`, pero blanquea TAMBIÉN el contenido (y los delimitadores) de las
 * strings. Se usa para poder contar los delimitadores del CÓDIGO —hoy: el balance de llaves— sin que una
 * llave escrita dentro de un literal (`'{'`, `` `${x}` `` ya cerrado, un mensaje de error con `}`) cuente
 * como estructura. NO sirve para los guards de firmas (que necesitan ver `testID="…"`).
 */
export function stripSourceCommentsAndStrings(src: string): string {
  return scan(src, true);
}

function scan(src: string, blankStrings: boolean): string {
  const out = src.split('');
  let state: ScanState = 'code';
  let i = 0;

  /** Blanquea el carácter i (respetando el `\n`, que sostiene la numeración de líneas). */
  const blank = (idx: number) => {
    if (out[idx] !== '\n') out[idx] = ' ';
  };

  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];

    switch (state) {
      case 'code':
        if (c === '/' && next === '/') {
          state = 'line';
          blank(i);
          blank(i + 1);
          i += 2;
        } else if (c === '/' && next === '*') {
          state = 'block';
          blank(i);
          blank(i + 1);
          i += 2;
        } else if (c === "'" || c === '"' || c === '`') {
          state = c === "'" ? 'single' : c === '"' ? 'double' : 'template';
          if (blankStrings) blank(i);
          i++;
        } else {
          i++;
        }
        break;

      case 'line':
        if (c === '\n') {
          state = 'code';
          i++;
        } else {
          blank(i);
          i++;
        }
        break;

      case 'block':
        if (c === '*' && next === '/') {
          state = 'code';
          blank(i);
          blank(i + 1);
          i += 2;
        } else {
          blank(i);
          i++;
        }
        break;

      // Strings: se atraviesan tal cual (o se blanquean, según `blankStrings`). `\` escapa el siguiente
      // carácter (incluido el delimitador).
      case 'single':
      case 'double':
      case 'template': {
        const quote = state === 'single' ? "'" : state === 'double' ? '"' : '`';
        if (c === '\\') {
          if (blankStrings) {
            blank(i);
            blank(i + 1);
          }
          i += 2;
        } else if (c === quote) {
          state = 'code';
          if (blankStrings) blank(i);
          i++;
        } else if (c === '\n' && state !== 'template') {
          // Una comilla sin cerrar en la línea (o un fuente raro): no arrastramos el estado a la línea
          // siguiente. Fail-safe hacia "ver de más", que para un guard es el lado seguro.
          state = 'code';
          i++;
        } else {
          if (blankStrings) blank(i);
          i++;
        }
        break;
      }
    }
  }

  return out.join('');
}
