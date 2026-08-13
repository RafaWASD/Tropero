// scripts/check-app-icon.mjs — verifica los assets de ícono ANTES de gastar un build de EAS.
//
// Por qué existe: un ícono con canal alfa hace que Apple RECHACE la entrega, y un adaptive icon
// de Android que no respeta la zona segura sale recortado y no se descubre hasta que está
// publicado. Las dos cosas cuestan un ciclo de build de un pool de 30 por mes.
//
// Uso:  node scripts/check-app-icon.mjs
//
// NO es un guard de la suite todavía: hoy los assets son el template de Expo y estaría en rojo
// permanente. Pasarlo a `scripts/run-tests.mjs` cuando entre el ícono real (ver docs/backlog.md).

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..', 'app');
const ASSETS = join(APP, 'assets');

/** Lee el IHDR de un PNG. Sin dependencias: los bytes están en posiciones fijas del formato. */
function leerPng(ruta) {
  const b = readFileSync(ruta);
  const firma = b.subarray(0, 8).toString('hex');
  if (firma !== '89504e470d0a1a0a') throw new Error('no es un PNG válido');
  const colorType = b[25];
  return {
    ancho: b.readUInt32BE(16),
    alto: b.readUInt32BE(20),
    profundidad: b[24],
    colorType,
    // 4 = gris+alfa, 6 = RGBA. Además tRNS declara transparencia en paletas/color indexado.
    tieneAlfa: colorType === 4 || colorType === 6 || b.includes(Buffer.from('tRNS')),
    bytes: b.length,
  };
}

/** Fecha del scaffold de Expo: si un asset sigue con ese contenido, es el template. */
const TEMPLATE_ICON_BYTES = 393493; // el icon.png de ejemplo que trae Expo (la "A" azul)

const CHEQUEOS = [
  {
    archivo: 'icon.png',
    lado: 1024,
    alfaProhibida: true,
    porQue: 'Apple RECHAZA la entrega si el ícono tiene canal alfa. Va cuadrado y opaco: el redondeo lo hace el sistema.',
  },
  {
    archivo: 'android-icon-foreground.png',
    lado: null, // Expo acepta varias medidas; lo que importa es la zona segura
    alfaProhibida: false,
    porQue: 'Es la capa de FRENTE y va sobre transparente. Todo lo legible tiene que caber en el circulo seguro (66dp de 108dp = 61% del ancho) o el recorte circular se lo come.',
  },
  {
    archivo: 'android-icon-background.png',
    lado: null,
    alfaProhibida: false,
    porQue: 'Capa de FONDO, archivo separado. Si el logo vino aplanado en una sola imagen, el adaptive icon está mal armado.',
  },
  {
    archivo: 'android-icon-monochrome.png',
    lado: null,
    alfaProhibida: false,
    porQue: 'Silueta de un solo color para los íconos temáticos de Android.',
  },
  { archivo: 'favicon.png', lado: null, alfaProhibida: false, porQue: 'Para la web.' },
];

let fallas = 0;
let avisos = 0;

console.log('Verificando assets de ícono en app/assets/\n');

for (const c of CHEQUEOS) {
  const ruta = join(ASSETS, c.archivo);
  if (!existsSync(ruta)) {
    console.log(`  ✗ ${c.archivo} — NO EXISTE`);
    console.log(`      ${c.porQue}`);
    fallas++;
    continue;
  }

  let png;
  try {
    png = leerPng(ruta);
  } catch (e) {
    console.log(`  ✗ ${c.archivo} — ${e.message}`);
    fallas++;
    continue;
  }

  const problemas = [];
  if (c.lado && (png.ancho !== c.lado || png.alto !== c.lado)) {
    problemas.push(`mide ${png.ancho}×${png.alto}, tiene que ser ${c.lado}×${c.lado}`);
  }
  if (png.ancho !== png.alto) problemas.push(`no es cuadrado (${png.ancho}×${png.alto})`);
  if (c.alfaProhibida && png.tieneAlfa) {
    problemas.push('TIENE CANAL ALFA — Apple rechaza la entrega');
  }

  if (problemas.length) {
    console.log(`  ✗ ${c.archivo} — ${problemas.join(' · ')}`);
    console.log(`      ${c.porQue}`);
    fallas++;
  } else if (c.archivo === 'icon.png' && png.bytes === TEMPLATE_ICON_BYTES) {
    console.log(`  ⚠ ${c.archivo} — ${png.ancho}×${png.alto}, pero sigue siendo EL TEMPLATE DE EXPO`);
    console.log(`      Es la "A" azul con las guías de construcción. Se publicaría eso.`);
    avisos++;
  } else {
    console.log(`  ✓ ${c.archivo} — ${png.ancho}×${png.alto}${png.tieneAlfa ? ' (con alfa)' : ' (opaco)'}`);
  }
}

console.log(`
Lo que este script NO puede verificar, y hay que mirar a ojo:
  · Que a 48 píxeles se distinga. Es el tamaño real en un teléfono.
  · Que en negro plano se reconozca. Si no, el logo se apoya en el color y no en la forma.
  · Que la capa de frente respete el circulo seguro (61% del ancho).
Para eso: node scripts/preview-app-icon.mjs (genera las tres pruebas en una página).`);

if (fallas) {
  console.log(`\n${fallas} problema(s) que bloquean una entrega.`);
  process.exit(1);
}
console.log(`\nSin problemas bloqueantes${avisos ? ` (${avisos} aviso)` : ''}.`);
