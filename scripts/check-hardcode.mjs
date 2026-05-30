#!/usr/bin/env node
// scripts/check-hardcode.mjs — guardrail anti-hardcode del frontend (ADR-023 §4).
//
// Falla (exit 1) si una PANTALLA o COMPONENTE hardcodea color o spacing en vez de
// referenciar un token del design system. La ÚNICA fuente literal de hex/px del
// frontend es app/tamagui.config.ts (fuente única canónica, ADR-023 §1); su lectura
// humana es docs/design-system.md. Todo lo demás referencia tokens ($primary, $4,
// borderRadius="$card", "$pill"…) o los lee con getTokenValue('$x', grupo) cuando
// el valor cruza a una API no-Tamagui (React Navigation, íconos lucide).
//
// Reemplaza al "mockup de referencia" como oráculo de QA: no validás contra
// imágenes, validás contra los tokens canónicos. Cuando un token cambia, las
// pantallas se re-derivan solas en vez de quedar pegadas a la v1.
//
// Qué marca:
//   1. Literales de COLOR (#hex, rgb()/rgba()/hsl()/hsla()) en cualquier parte.
//   2. Números CRUDOS en props de COLOR/SPACING que tienen escala de token
//      (padding*, margin*, gap, insets top/left/right/bottom, borderRadius,
//      fontSize, lineHeight). Esos deben venir de un token.
//
// Qué NO marca (a propósito): props sin token semántico ni equivalente en la escala
//   — borderWidth (hairlines 1/2px), width/height (geometría libre / derivada de
//   tokens), letterSpacing (tracking tipográfico), flex, zIndex, opacity, strokeWidth
//   / size de íconos lucide (API no-Tamagui), numberOfLines, hitSlop, etc. Y los
//   comentarios (se blanquean antes de escanear, así una mención textual a "#fff" o
//   "-8" en una nota no dispara un falso positivo).
//
// Excepción acotada: si una línea necesita un literal genuino e inevitable, marcala
// con un comentario en la MISMA línea o la ANTERIOR:
//   // design-lint-disable-next-line -- <justificación>
//   // design-lint-disable-line -- <justificación>
// (no hay disable de archivo entero: una excepción es de una línea y va justificada).
//
// Uso: node scripts/check-hardcode.mjs  (lo invoca scripts/check.mjs).

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

// Directorios cubiertos: pantallas y librería de componentes (ADR-023). El config
// (app/tamagui.config.ts) queda FUERA a propósito: es la única fuente de literales.
const ROOTS = [join(repoRoot, 'app', 'app'), join(repoRoot, 'app', 'src', 'components')];

// Props de COLOR: un literal hex/rgb/hsl acá es siempre un hardcode.
const COLOR_PROPS = [
  'color',
  'backgroundColor',
  'borderColor',
  'borderTopColor',
  'borderBottomColor',
  'borderLeftColor',
  'borderRightColor',
  'borderStartColor',
  'borderEndColor',
  'shadowColor',
  'textShadowColor',
  'tintColor',
  'placeholderTextColor',
  'overlayColor',
];

// Props de SPACING/SIZE con escala de token: un número crudo acá debe venir de un
// token (o de getTokenValue para APIs no-Tamagui). NO incluye width/height/
// borderWidth/letterSpacing/flex/zIndex/opacity (sin token semántico, ver cabecera).
const SPACING_PROPS = [
  'padding',
  'paddingTop',
  'paddingBottom',
  'paddingLeft',
  'paddingRight',
  'paddingStart',
  'paddingEnd',
  'paddingHorizontal',
  'paddingVertical',
  'margin',
  'marginTop',
  'marginBottom',
  'marginLeft',
  'marginRight',
  'marginStart',
  'marginEnd',
  'marginHorizontal',
  'marginVertical',
  'gap',
  'rowGap',
  'columnGap',
  'top',
  'bottom',
  'left',
  'right',
  'borderRadius',
  'fontSize',
  'lineHeight',
];

// Color literal: #rgb/#rgba/#rrggbb/#rrggbbaa  o  rgb()/rgba()/hsl()/hsla()(...).
const COLOR_LITERAL = /(#[0-9a-fA-F]{3,8}\b)|(\b(?:rgb|rgba|hsl|hsla)\s*\()/;

// Prop de color asignada a un STRING (JSX `="..."` o objeto `: '...'`). El valor del
// string se inspecciona por COLOR_LITERAL.
const colorPropRe = new RegExp(
  `\\b(${COLOR_PROPS.join('|')})\\s*[:=]\\s*(\\{\\s*)?["'\\\`]([^"'\\\`]*)["'\\\`]`,
  'g'
);

// Prop de spacing/size asignada a un número crudo: prop={-8} | prop: 12 | prop={12}.
const spacingPropRe = new RegExp(`\\b(${SPACING_PROPS.join('|')})\\s*[:=]\\s*\\{?\\s*-?\\d`, 'g');

const DISABLE_RE = /design-lint-disable-(next-line|line)/;

/**
 * Blanquea comentarios (// y /* *\/) reemplazándolos por espacios, preservando saltos
 * de línea (los números de línea quedan intactos) y SIN tocar el contenido de strings
 * / templates (para no perder literales de color dentro de un string). Devuelve el
 * texto saneado + el set de comentarios crudos por línea (para detectar el disable).
 */
function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  // Estados: normal | string('|"|`) | lineComment | blockComment
  let state = 'normal';
  let quote = '';
  const commentByLine = new Map(); // line(1-based) -> texto del comentario en esa línea
  let line = 1;

  const pushComment = (ln, text) => {
    commentByLine.set(ln, (commentByLine.get(ln) || '') + text);
  };

  while (i < n) {
    const c = src[i];
    const c2 = i + 1 < n ? src[i + 1] : '';

    if (c === '\n') line++;

    if (state === 'normal') {
      if (c === '/' && c2 === '/') {
        state = 'lineComment';
        let j = i;
        let txt = '';
        while (j < n && src[j] !== '\n') {
          txt += src[j];
          out += ' ';
          j++;
        }
        pushComment(line, txt);
        i = j;
        state = 'normal';
        continue;
      }
      if (c === '/' && c2 === '*') {
        state = 'blockComment';
        let j = i;
        let txt = '';
        while (j < n && !(src[j] === '*' && src[j + 1] === '/')) {
          if (src[j] === '\n') {
            out += '\n';
            line++;
          } else {
            out += ' ';
          }
          txt += src[j];
          j++;
        }
        // consumir el cierre */
        if (j < n) {
          out += '  ';
          txt += '*/';
          j += 2;
        }
        // el comentario de bloque cuenta para la primera línea que ocupa
        pushComment(line, txt);
        i = j;
        state = 'normal';
        continue;
      }
      if (c === '"' || c === "'" || c === '`') {
        state = 'string';
        quote = c;
        out += c;
        i++;
        continue;
      }
      out += c;
      i++;
      continue;
    }

    if (state === 'string') {
      out += c;
      if (c === '\\') {
        // escape: copiar el siguiente char tal cual
        if (i + 1 < n) {
          out += src[i + 1];
          if (src[i + 1] === '\n') line++;
          i += 2;
          continue;
        }
      }
      if (c === quote) {
        state = 'normal';
        quote = '';
      }
      i++;
      continue;
    }

    i++;
  }
  return { sanitized: out, commentByLine };
}

/** Map de offset de char → número de línea (1-based) para reportar ubicaciones. */
function lineOf(src, index) {
  let line = 1;
  for (let i = 0; i < index && i < src.length; i++) {
    if (src[i] === '\n') line++;
  }
  return line;
}

function listFiles(dir) {
  const found = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return found; // dir inexistente → nada que escanear
  }
  for (const name of entries) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      found.push(...listFiles(p));
    } else if (/\.(ts|tsx)$/.test(name)) {
      found.push(p);
    }
  }
  return found;
}

function disabledAt(commentByLine, ln) {
  const here = commentByLine.get(ln) || '';
  const prev = commentByLine.get(ln - 1) || '';
  return (
    (DISABLE_RE.test(here) && /disable-line/.test(here)) ||
    (DISABLE_RE.test(prev) && /disable-next-line/.test(prev)) ||
    // disable-line también puede estar en la misma línea aunque el patrón general
    // matchee next-line: aceptamos cualquiera de los dos en la línea misma.
    (DISABLE_RE.test(here) && !/disable-next-line/.test(here))
  );
}

const violations = [];

for (const root of ROOTS) {
  for (const file of listFiles(root)) {
    const raw = readFileSync(file, 'utf8');
    const { sanitized, commentByLine } = stripComments(raw);
    const rel = relative(repoRoot, file).split(sep).join('/');

    // 1. Literales de color en props de color.
    colorPropRe.lastIndex = 0;
    let m;
    while ((m = colorPropRe.exec(sanitized)) !== null) {
      const value = m[3];
      if (COLOR_LITERAL.test(value)) {
        const ln = lineOf(sanitized, m.index);
        if (!disabledAt(commentByLine, ln)) {
          violations.push({
            file: rel,
            line: ln,
            kind: 'color',
            detail: `${m[1]} = "${value}" (usá un token de color, ej. $primary)`,
          });
        }
      }
    }

    // 2. Cualquier literal de color suelto (por si aparece fuera de una prop de color
    //    conocida — ej. un objeto de estilo). Evita falsos negativos.
    {
      const loose = /(#[0-9a-fA-F]{3,8}\b)|\b(?:rgb|rgba|hsl|hsla)\s*\(/g;
      let lm;
      while ((lm = loose.exec(sanitized)) !== null) {
        const ln = lineOf(sanitized, lm.index);
        // Evitar doble-reporte de los ya capturados como prop de color en esta línea.
        const already = violations.some(
          (v) => v.file === rel && v.line === ln && v.kind === 'color'
        );
        if (already) continue;
        if (!disabledAt(commentByLine, ln)) {
          violations.push({
            file: rel,
            line: ln,
            kind: 'color',
            detail: `literal de color "${lm[0]}" (usá un token de color)`,
          });
        }
      }
    }

    // 3. Números crudos en props de spacing/size.
    spacingPropRe.lastIndex = 0;
    while ((m = spacingPropRe.exec(sanitized)) !== null) {
      const ln = lineOf(sanitized, m.index);
      if (!disabledAt(commentByLine, ln)) {
        violations.push({
          file: rel,
          line: ln,
          kind: 'spacing',
          detail: `${m[1]} con número crudo (usá un token de spacing, ej. "$4", o getTokenValue para APIs no-Tamagui)`,
        });
      }
    }
  }
}

const C = { reset: '\x1b[0m', green: '\x1b[32m', red: '\x1b[31m' };

if (violations.length === 0) {
  console.log(`${C.green}[OK]${C.reset}    Anti-hardcode (ADR-023 §4): 0 violaciones en app/app + app/src/components`);
  process.exit(0);
}

console.log(`${C.red}[FAIL]${C.reset}  Anti-hardcode (ADR-023 §4): ${violations.length} violación(es)`);
console.log('        Las pantallas/componentes NO hardcodean color/spacing — referenciá un token del');
console.log('        design system (app/tamagui.config.ts / docs/design-system.md). Si un literal es');
console.log('        genuinamente inevitable, justificalo con // design-lint-disable-next-line -- razón\n');
for (const v of violations.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)) {
  console.log(`        ${v.file}:${v.line}  [${v.kind}]  ${v.detail}`);
}
process.exit(1);
