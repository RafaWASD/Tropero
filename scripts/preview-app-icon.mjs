// scripts/preview-app-icon.mjs — arma las tres pruebas VISUALES del ícono en una sola imagen.
//
// El script hermano (`check-app-icon.mjs`) verifica lo medible: medidas, canal alfa, que los
// archivos existan. Lo que NO se puede automatizar es si el ícono SE ENTIENDE, y eso se mira:
//
//   1. A 48 px — el tamaño real en un teléfono. Si ahí no se distingue, no sirve.
//   2. En negro plano — si sin color no se reconoce, el logo se apoya en el color, no en la forma.
//   3. Recortado en círculo, con la zona segura marcada — es como lo recorta Android.
//      Ojo: la zona segura es un círculo de 66dp sobre un lienzo de 108dp, o sea el 61% del ancho.
//      Decir "66%" es confundir dp con porcentaje y dibuja el círculo MÁS GRANDE que la realidad,
//      que es el lado peligroso del error: avisa de menos.
//
// Uso:  node scripts/preview-app-icon.mjs [carpeta-de-salida]
// Deja un PNG para mirar. Requiere Chrome instalado (mismo camino que la generación de PDFs).

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(RAIZ, 'app', 'assets');
const SALIDA = resolve(process.argv[2] ?? join(RAIZ, 'design', 'icon-preview'));

const CHROMES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',
];

function dataUri(archivo) {
  const ruta = join(ASSETS, archivo);
  if (!existsSync(ruta)) return null;
  return 'data:image/png;base64,' + readFileSync(ruta).toString('base64');
}

const icono = dataUri('icon.png');
if (!icono) {
  console.error('No existe app/assets/icon.png');
  process.exit(1);
}
const frente = dataUri('android-icon-foreground.png');
const fondo = dataUri('android-icon-background.png');
const mono = dataUri('android-icon-monochrome.png');

const bloqueAdaptive = frente && fondo
  ? `<div class="caso">
       <h2>3 · Recorte circular de Android, con la zona segura</h2>
       <p>Todo lo legible tiene que caber dentro del círculo punteado. Es un círculo de 66dp sobre un lienzo de 108dp: <b>61% del ancho</b>, no 66%. Lo que quede afuera
          se corta en los teléfonos que recortan en círculo, y no se descubre hasta publicar.</p>
       <div class="fila">
         <div class="pieza">
           <div class="adaptive redondo">
             <img src="${fondo}" alt=""><img src="${frente}" alt="">
           </div>
           <span>recortado en círculo</span>
         </div>
         <div class="pieza">
           <div class="adaptive">
             <img src="${fondo}" alt=""><img src="${frente}" alt="">
             <div class="zona-segura"></div>
           </div>
           <span>completo + zona segura</span>
         </div>
         <div class="pieza">
           <div class="adaptive gota">
             <img src="${fondo}" alt=""><img src="${frente}" alt="">
           </div>
           <span>recorte "gota"</span>
         </div>
       </div>
     </div>`
  : `<div class="caso"><h2>3 · Recorte de Android</h2>
       <p class="falta">Faltan las capas <code>android-icon-foreground.png</code> y/o
       <code>android-icon-background.png</code>. En Android el ícono son DOS capas separadas,
       no una imagen aplanada.</p></div>`;

const html = `<!doctype html><html lang="es-AR"><head><meta charset="utf-8"><style>
  body { margin:0; background:#FAF9F9; color:#0F0E0C; font-family:-apple-system,"Segoe UI",Roboto,sans-serif; padding:32px; }
  h1 { font-size:22px; margin:0 0 4px; }
  .sub { color:#5C655F; margin:0 0 28px; font-size:14px; }
  .caso { border-top:1px solid #E5E5E3; padding-top:20px; margin-bottom:32px; }
  h2 { font-size:16px; margin:0 0 4px; }
  .caso > p { color:#5C655F; font-size:13px; line-height:1.5; margin:0 0 16px; max-width:70ch; }
  .falta { color:#C0451F; font-weight:600; }
  .fila { display:flex; gap:28px; align-items:flex-end; flex-wrap:wrap; }
  .pieza { display:flex; flex-direction:column; align-items:center; gap:6px; }
  .pieza span { font-size:11px; color:#5C655F; }
  .pieza img { display:block; image-rendering:auto; }
  .negro img { filter: brightness(0); }
  .gris img { filter: grayscale(1); }
  .adaptive { position:relative; width:180px; height:180px; overflow:hidden; }
  .adaptive img { position:absolute; inset:0; width:100%; height:100%; }
  .redondo { border-radius:50%; }
  .gota { border-radius:50% 50% 50% 12%; }
  .zona-segura { position:absolute; left:19.4%; top:19.4%; width:61.1%; height:61.1%;
                 border:2px dashed #C0451F; border-radius:50%; }
</style></head><body>
  <h1>miTropero — pruebas del ícono</h1>
  <p class="sub">Generado por <code>scripts/preview-app-icon.mjs</code>. Las tres cosas que ningún test automático puede juzgar.</p>

  <div class="caso">
    <h2>1 · Tamaño real</h2>
    <p>48 px es el tamaño al que lo ve el usuario en la grilla de su teléfono. Si a esa escala no se
       distingue de cualquier otro ícono, el diseño no funciona — nadie lo va a ver a 1024.</p>
    <div class="fila">
      <div class="pieza"><img src="${icono}" width="48" height="48"><span>48 px (real)</span></div>
      <div class="pieza"><img src="${icono}" width="72" height="72"><span>72 px</span></div>
      <div class="pieza"><img src="${icono}" width="120" height="120"><span>120 px</span></div>
      <div class="pieza"><img src="${icono}" width="192" height="192"><span>192 px</span></div>
    </div>
  </div>

  <div class="caso">
    <h2>2 · Sin color</h2>
    <p>Si sin color no se reconoce, el logo está apoyado en el color y no en la forma. Importa además
       porque Android lo usa así en los íconos temáticos.</p>
    <p><b>Ojo con cómo se hace esta prueba.</b> Ennegrecer <code>icon.png</code> no sirve: como es opaco,
       se tiñe también el fondo y sale un cuadrado negro, que no muestra nada. El negro plano se prueba
       sobre la <b>capa monocroma</b>, que es la silueta. Sobre el ícono a color, lo que sí dice algo es
       sacarle el tono y dejar los grises: si ahí se pierde, el contraste interno es flojo.</p>
    <div class="fila">
      ${mono
        ? `<div class="pieza negro"><img src="${mono}" width="48" height="48"><span>monocroma · 48 px</span></div>
           <div class="pieza negro"><img src="${mono}" width="120" height="120"><span>monocroma · 120 px</span></div>`
        : `<p class="falta">Falta <code>android-icon-monochrome.png</code>: sin esa capa no hay prueba de negro plano.</p>`}
      <div class="pieza gris"><img src="${icono}" width="48" height="48"><span>sin tono · 48 px</span></div>
      <div class="pieza gris"><img src="${icono}" width="120" height="120"><span>sin tono · 120 px</span></div>
    </div>
  </div>

  ${bloqueAdaptive}
</body></html>`;

mkdirSync(SALIDA, { recursive: true });
const htmlPath = join(SALIDA, 'icon-preview.html');
writeFileSync(htmlPath, html, 'utf8');

const chrome = CHROMES.find((c) => existsSync(c));
if (!chrome) {
  console.log(`Página generada: ${htmlPath}`);
  console.log('No encontré Chrome para renderizarla; abrila a mano.');
  process.exit(0);
}

const pngPath = join(SALIDA, 'icon-preview.png');
execFileSync(chrome, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars',
  '--force-device-scale-factor=2', '--window-size=1100,1400',
  `--screenshot=${pngPath}`, `file:///${htmlPath.replace(/\\/g, '/')}`,
], { stdio: 'pipe' });

console.log(`Listo:\n  ${pngPath}\n  ${htmlPath}`);
