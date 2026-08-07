// GUARD DE CLASE: el estado del bastón no se dice DOS VECES en la misma pantalla — y quién se calla no
// se decide con una lista de rutas.
//
// ── EL DEFECTO QUE CIERRA (pedido de Raf, 2026-08-06) ───────────────────────────────────────────────
// El indicador global del chrome (`StickStatusIndicator`, RMV3.5) se monta sobre TODA la app. En las
// pantallas que YA muestran el estado del bastón —el chip del header de `(tabs)/animales` y de
// `maniobra/identificar`, la card de `/baston`— el mismo dato aparecía dos veces.
//
// ── POR QUÉ UN GUARD, Y SOBRE LA AUSENCIA ───────────────────────────────────────────────────────────
// Arreglar las tres pantallas de hoy y declarar victoria sería el error de siempre: el mecanismo
// —montar una superficie de estado del bastón sin decidir qué hace el indicador global— queda intacto
// para la próxima. Y la forma más obvia de "arreglarlo" (una lista de rutas adentro del indicador) ya
// nos mordió: es la clase de `BLE_OWNED_ROUTES` — mover o renombrar una ruta la rompe EN SILENCIO.
//
// Por eso el guard se escribe sobre **la ausencia**: la población son los call sites de
// `useBleConnectionStatus()` (la ÚNICA fuente del estado en toda la app), y cada uno tiene que estar en
// el registro declarando si reclama el lugar del indicador global o no, y por qué. Una superficie nueva
// nace en ROJO hasta que alguien decida.
//
// Lo que se fija, en seis pedazos:
//   (A) POBLACIÓN: todo call site de `useBleConnectionStatus()` está en el registro.
//   (B) COHERENCIA: el que dice `reclama: true` llama a `useStickStatusSurface(`; el que dice `false`, no.
//   (C) EL CONSUMIDOR: el indicador global lee el reclamo y **no** gatea por ruta (ni `usePathname`, ni
//       `'/baston'`, ni `useSegments`) — el literal que esta unidad borró no puede volver.
//   (D) FOCO Y NO MONTAJE: el reclamo se ata a `useFocusEffect`. Con `useEffect` de montaje, entrar UNA
//       vez a la tab "Animales" dejaría el indicador global apagado en toda la app para siempre.
//   (E) SIN PUERTA DE ATRÁS: nadie llama `claimStickStatusSurface()` directo salteándose el hook (sería
//       un reclamo sin foco, o sea el bug de (D) escrito a mano).
//   (F) REGISTRO VIVO: sin entradas muertas, y el guard falsificado con mutantes sintéticos.
//
// ⚠️ Registrado en la lista EXPLÍCITA de `scripts/run-tests.mjs`: un guard que no corre da falsa
// confianza. Y ninguna E2E web lo reemplaza: el bug de (D) es invisible en una corrida que visita una
// pantalla sola, y el de (C) solo aparece cuando alguien RENOMBRA una ruta.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { stripSourceComments } from '../../utils/strip-comments.ts';
import { assertScanCoverage } from '../../utils/scan-coverage.ts';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const APP_ROOT = resolve(HERE, '..', '..', '..'); // app/
const ROOTS = [join(APP_ROOT, 'app'), join(APP_ROOT, 'src')];

/** Piso de archivos escaneados (`app/app` + `app/src`, sin `.test.*`). Ver `utils/scan-coverage.ts`. */
const SCANNED_FILES_FLOOR = 300;

const INDICATOR = 'src/features/ble-stick/components/StickStatusIndicator.tsx';
const CLAIM_HOOK = 'src/hooks/useStickStatusSurface.ts';
const STORE = 'src/services/ble/stick-status-surface.ts';
const STATUS_HOOK_OWNER = 'src/services/ble/connection-status.ts';

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// (A) REGISTRO de TODA superficie que lee el estado de conexión del bastón.
//
// Entrar acá no es un permiso: es la obligación de haber DECIDIDO qué pasa con el indicador global
// cuando esta superficie está en pantalla. Si agregás una, agregá la entrada y la decisión.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
interface SurfaceEntry {
  /**
   * POR QUÉ está en el registro:
   *   · `'muestra-el-estado'` — lee `useBleConnectionStatus()` y lo pinta. El indicador global sería el
   *     mismo dato dos veces.
   *   · `'usa-la-banda'` — NO muestra el estado, pero ya ocupa la banda donde el indicador flota (debajo
   *     de la fila del header, a la derecha). Reclama para que el chrome no se dibuje encima de algo
   *     legible. Medido, pantalla por pantalla, en `progress/impl_pill-arriba-derecha.md`.
   */
  tipo: 'muestra-el-estado' | 'usa-la-banda';
  /** ¿Reclama el lugar del indicador global mientras está enfocada? */
  reclama: boolean;
  /** Qué muestra / qué ocupa, y por qué reclama (o por qué no). */
  motivo: string;
}

const STATUS_SURFACES: Record<string, SurfaceEntry> = {
  'src/components/BleConnectionChip.tsx': {
    tipo: 'muestra-el-estado',
    reclama: true,
    motivo:
      'chip de estado en el header de `(tabs)/animales` y `maniobra/identificar` (spec 09 RB8.1): dice ' +
      'exactamente lo mismo que el indicador global, a treinta píxeles. Reclama solo cuando se PINTA ' +
      '(`view !== null`): sin transporte no renderiza nada y reclamar sería apagar el chrome a cambio de nada.',
  },
  'src/features/ble-stick/screens/StickConnectionScreen.tsx': {
    tipo: 'muestra-el-estado',
    reclama: true,
    motivo:
      'la card de estado de `/baston`, con su CTA. Hasta el 2026-08-06 esto lo resolvía un literal en el ' +
      'indicador (`pathname === \'/baston\'`); ahora la propiedad la declara la pantalla, igual que el ' +
      'scanner acotado (RMV3.1).',
  },
  'app/(tabs)/mas.tsx': {
    tipo: 'muestra-el-estado',
    reclama: false,
    motivo:
      'la fila "Dispositivos → Bastón" muestra el estado EN VIVO en su trailing (`connectionRowStatus`, ' +
      'RMV3.1), pero NO es un indicador de pantalla: es una fila de lista a media pantalla, lejos del ' +
      'chrome, y el indicador global no la tapa ni la repite en el mismo golpe de vista. **Queda pendiente ' +
      'de la decisión de MOVER el indicador arriba a la derecha** (ver `progress/impl_pill-arriba-derecha.md`): ' +
      'si el chip aterriza en esa esquina, en "Más" quedarían dos "Conectado" en la misma pantalla y esta ' +
      'entrada pasa a `reclama: true`.',
  },
  [INDICATOR]: {
    tipo: 'muestra-el-estado',
    reclama: false,
    motivo:
      'ES el indicador global: el consumidor del reclamo, no una superficie que lo emita. Si reclamara, se ' +
      'apagaría a sí mismo. Lo verifica (C).',
  },
  'app/maniobra/_components/SpikeIdentityHeader.tsx': {
    tipo: 'usa-la-banda',
    reclama: true,
    motivo:
      'el header de identidad de la manga (carga · paso · rueda-ce · tacto-spike) ya usa esa esquina: el ' +
      'pill "Saltear ‹maniobra›" y el "⋮" viven en la fila (a propósito, por Fitts) y el chip "Animal N" ' +
      'cae JUSTO en la banda de abajo — medido @412: chip x=[317,393] y=[91,112] vs indicador x=[354,394] ' +
      'y=[66,106]. No se pierde información: la pantalla que importa para el bastón (maniobra/identificar) ' +
      'muestra el estado en su propio chip, y acá el animal ya está identificado.',
  },
  'app/(tabs)/reportes.tsx': {
    tipo: 'usa-la-banda',
    reclama: true,
    motivo:
      'el selector de rodeo a ancho completo arranca pegado al título y cae justo en la banda — lo MIDIÓ el ' +
      'sondeo de `e2e/baston-indicador-unico.spec.ts`, que reportó al indicador (x=[354,394] y=[66,106]) ' +
      'encima del control "Elegir el rodeo a reportar". Esta pantalla no lee caravanas: no se pierde nada.',
  },
  'src/components/GroupViewScreen.tsx': {
    tipo: 'usa-la-banda',
    reclama: true,
    motivo:
      'la vista de grupo (rodeo/[id] y lote/[id]) tiene un header de un solo chevron y el BUSCADOR a ancho ' +
      'completo pegado abajo — medido @412: input en y=[58,108], el indicador iría a y=[66,106]. El círculo ' +
      'quedaría flotando sobre el campo de búsqueda, tapando la cola de lo que el operario escribe.',
  },
};

/** Firma de la ÚNICA fuente del estado de conexión en toda la app. */
const STATUS_HOOK_CALL = /\buseBleConnectionStatus\s*\(/;
/** Firma del reclamo (el hook) y de la primitiva imperativa del store. */
const CLAIM_HOOK_CALL = /\buseStickStatusSurface\s*\(/;
const CLAIM_IMPERATIVE_CALL = /\bclaimStickStatusSurface\s*\(/;

function listFiles(dir: string): string[] {
  const found: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return found;
  }
  for (const name of entries) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) found.push(...listFiles(p));
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) found.push(p);
  }
  return found;
}

const rel = (file: string) => relative(APP_ROOT, file).split(sep).join('/');

/** El árbol escaneado, con el fuente SIN comentarios (una mención no es un uso). */
function scannedSources(): Array<{ file: string; src: string }> {
  return ROOTS.flatMap(listFiles).map((path) => ({
    file: rel(path),
    src: stripSourceComments(readFileSync(path, 'utf8')),
  }));
}

/** Código (sin comentarios) de un archivo relativo a `app/`. */
function code(relPath: string): string {
  return stripSourceComments(readFileSync(join(APP_ROOT, relPath), 'utf8'));
}

/** Archivos que LEEN el estado de conexión (sin contar al módulo que define el hook). */
function statusSurfaceFiles(): string[] {
  return scannedSources()
    .filter(({ file, src }) => file !== STATUS_HOOK_OWNER && STATUS_HOOK_CALL.test(src))
    .map(({ file }) => file);
}

// ═══ (A) La población ════════════════════════════════════════════════════════════════════════════════

test('(A) toda superficie que lee el estado del bastón está en el REGISTRO', () => {
  const unregistered = statusSurfaceFiles().filter(
    (file) => !Object.prototype.hasOwnProperty.call(STATUS_SURFACES, file),
  );
  assert.deepEqual(
    unregistered,
    [],
    'Este archivo llama `useBleConnectionStatus()`, o sea muestra el estado del bastón en una pantalla — y ' +
      'el chrome de la app YA lo muestra con el indicador global (RMV3.5). Sin decidir, el operario ve el ' +
      'mismo dato dos veces en la misma pantalla (el defecto que Raf reportó el 2026-08-06). Registralo en ' +
      '`STATUS_SURFACES` diciendo si reclama el lugar del indicador global (`useStickStatusSurface()`) y por ' +
      'qué. Ojo: NO agregues una lista de rutas en el indicador — es la clase de `BLE_OWNED_ROUTES`, se ' +
      'rompe en silencio al renombrar una ruta.',
  );
});

test('(A-inverso) el registro no tiene entradas MUERTAS', () => {
  const alive = new Set(statusSurfaceFiles());
  for (const [file, entry] of Object.entries(STATUS_SURFACES)) {
    if (entry.tipo === 'muestra-el-estado') {
      assert.ok(
        alive.has(file),
        `\`${file}\` está registrado como que MUESTRA el estado pero ya no lee \`useBleConnectionStatus()\`. ` +
          'Si se renombró, la entrada queda cubriendo un archivo que no existe y el que sí existe entra sin ' +
          'registrarse; si dejó de mostrarlo, cambiá el tipo o sacalo.',
      );
      continue;
    }
    // `usa-la-banda`: no lee el estado (no tiene por qué). Lo que sí tiene que seguir haciendo es
    // RECLAMAR — si no, la entrada es un permiso sin dueño y el indicador vuelve a dibujarse encima.
    assert.match(
      code(file),
      CLAIM_HOOK_CALL,
      `\`${file}\` está registrado como dueño de la banda pero ya no la reclama: sacalo del registro (o, si ` +
        'la pantalla dejó de ocupar la esquina, verificá con una captura antes de quitar el reclamo).',
    );
  }
});

// ═══ (B) Coherencia entre lo declarado y lo que el archivo hace ══════════════════════════════════════

test('(B) el que declara que RECLAMA llama al hook; el que declara que NO, no lo llama', () => {
  const mismatched: string[] = [];
  for (const [file, entry] of Object.entries(STATUS_SURFACES)) {
    const claims = CLAIM_HOOK_CALL.test(code(file));
    if (claims !== entry.reclama) {
      mismatched.push(
        `${file}: el registro dice reclama=${entry.reclama} y el código ${claims ? 'SÍ' : 'NO'} llama ` +
          '`useStickStatusSurface(`',
      );
    }
  }
  assert.deepEqual(
    mismatched,
    [],
    'El registro y el código dicen cosas distintas. Un registro que describe una app imaginaria es peor que ' +
      'no tenerlo: es la prosa que hace creer que algo está verificado.',
  );
});

test('(B-bis) cada entrada del registro tiene un MOTIVO escrito, no un placeholder', () => {
  for (const [file, entry] of Object.entries(STATUS_SURFACES)) {
    assert.ok(
      entry.motivo.trim().length >= 40,
      `\`${file}\` está registrado sin explicar la decisión. El motivo es la parte que sirve dentro de seis ` +
        'meses; sin él, el registro es una lista de permisos sin dueño.',
    );
  }
});

// ═══ (C) El consumidor: lee el reclamo y NO gatea por ruta ═══════════════════════════════════════════

test('(C) el indicador global se suprime por RECLAMO y no por una lista de rutas', () => {
  // ── EL LITERAL QUE ESTA UNIDAD BORRÓ, Y QUE NO PUEDE VOLVER ────────────────────────────────────────
  //     const pathname = usePathname();
  //     if (pathname === '/baston') return null;
  // Funcionaba… hasta que alguien mueva `app/baston.tsx` o le cambie el nombre a la ruta: ahí el
  // indicador vuelve a duplicar el estado sobre la card de la pantalla de conexión, en silencio y sin que
  // ningún test lo vea. Es la misma clase de `BLE_OWNED_ROUTES` (reconciliación de RMV3.1).
  const src = code(INDICATOR);
  assert.match(
    src,
    /useStickStatusSurfaceClaimed\s*\(\s*\)/,
    'el indicador tiene que leer el reclamo de las superficies (`useStickStatusSurfaceClaimed()`)',
  );
  for (const [pattern, why] of [
    [/\busePathname\b/, 'lee la ruta actual'],
    [/\buseSegments\b/, 'lee los segmentos de la ruta'],
    [/\/baston\b/, "tiene el literal '/baston' adentro"],
    [/BLE_OWNED_ROUTES/, 'usa la lista de rutas dueñas del bastón'],
  ] as const) {
    assert.doesNotMatch(
      src,
      pattern,
      `El indicador global ${why}: la supresión NO se decide por ruta. La declara la superficie que muestra ` +
        'el estado, con `useStickStatusSurface()`, mientras está enfocada — así renombrar o mover una ruta no ' +
        'rompe nada en silencio.',
    );
  }
});

test('(C-bis) el indicador NO reclama (se apagaría a sí mismo, para siempre)', () => {
  assert.doesNotMatch(code(INDICATOR), CLAIM_HOOK_CALL, 'el consumidor del reclamo no puede emitir uno');
});

// ═══ (D) El reclamo se ata al FOCO, no al montaje ════════════════════════════════════════════════════

test('(D) el hook de reclamo usa `useFocusEffect` — con `useEffect` el indicador moriría para siempre', () => {
  // ── EL BUG QUE ESTE TEST IMPIDE ────────────────────────────────────────────────────────────────────
  // Las pantallas del stack quedan MONTADAS al navegar encima, y una tab visitada queda montada el resto
  // de la sesión. Con un `useEffect` de montaje, entrar UNA vez a "Animales" dejaría el reclamo vivo para
  // siempre: el indicador global apagado en TODA la app, sin un solo síntoma. Ninguna E2E que visite una
  // pantalla sola puede ver eso, y en web tampoco se nota (nadie navega dos veces en un test corto).
  const src = code(CLAIM_HOOK);
  assert.match(src, /\buseFocusEffect\s*\(/, 'el reclamo tiene que vivir dentro de `useFocusEffect`');
  assert.doesNotMatch(
    src,
    /\buseEffect\s*\(/,
    'un `useEffect` acá ata el reclamo al MONTAJE. Las pantallas quedan montadas al navegar encima: el ' +
      'reclamo sobreviviría a la pantalla que lo emitió y apagaría el indicador global en toda la app.',
  );
  assert.doesNotMatch(
    src,
    /\buseLayoutEffect\s*\(/,
    'idem `useLayoutEffect`: el problema no es CUÁNDO corre el efecto sino a qué está atado (montaje vs foco)',
  );
});

test('(D-bis) el store NO importa `expo-router` (si no, deja de ser testeable)', () => {
  // `import('expo-router')` no carga en node puro (el paquete se publica sin transpilar): un import acá
  // sacaría el store —y sus reglas de conteo, que son las que evitan que dos superficies se pisen— de
  // `node:test`. Es exactamente por eso que el hook de reclamo vive en otro archivo.
  assert.doesNotMatch(code(STORE), /from\s+'expo-router'/, 'el store tiene que poder correr en node:test');
  assert.doesNotMatch(code(STORE), /from\s+'react-native'/, 'idem react-native');
});

// ═══ (E) Sin puerta de atrás ═════════════════════════════════════════════════════════════════════════

test('(E) nadie llama `claimStickStatusSurface()` directo salteándose el hook', () => {
  const offenders = scannedSources()
    .filter(({ file }) => file !== STORE && file !== CLAIM_HOOK)
    .filter(({ src }) => CLAIM_IMPERATIVE_CALL.test(src))
    .map(({ file }) => file);
  assert.deepEqual(
    offenders,
    [],
    'La primitiva imperativa del store es para el hook y para los tests. Llamarla desde una pantalla es ' +
      'reclamar SIN foco: el reclamo sobrevive a la pantalla que lo emitió y apaga el indicador global en ' +
      'toda la app (el bug de (D), escrito a mano). Usá `useStickStatusSurface()`.',
  );
});

test('(E-bis) toda pantalla que RECLAMA está en el registro (aunque no lea el estado)', () => {
  // El caso que esto cubre: una pantalla que reclama el lugar por otro motivo (p. ej. "esta esquina es
  // mía") sin mostrar el estado. Es un uso legítimo y previsible — pero apaga el indicador global, así que
  // tiene que estar declarado con su motivo y no aparecer de contrabando.
  const claimers = scannedSources()
    .filter(({ file, src }) => file !== CLAIM_HOOK && CLAIM_HOOK_CALL.test(src))
    .map(({ file }) => file);
  const unregistered = claimers.filter((f) => !Object.prototype.hasOwnProperty.call(STATUS_SURFACES, f));
  assert.deepEqual(
    unregistered,
    [],
    'Este archivo apaga el indicador global del bastón mientras está enfocado y no está en `STATUS_SURFACES`. ' +
      'Registralo con el motivo: apagar el chrome sin poner nada en su lugar es una regresión invisible.',
  );
});

// ═══ (F) Falsificación + auto-verificación ═══════════════════════════════════════════════════════════

test('el guard DETECTA las formas de burlarlo (mutantes sintéticos)', () => {
  // Un guard que no puede fallar es un guard muerto. Se le dan al DETECTOR los fuentes mutados y se exige
  // que los clasifique como el bug que son.
  const detectaEstado = (s: string) => STATUS_HOOK_CALL.test(stripSourceComments(s));
  const detectaReclamo = (s: string) => CLAIM_HOOK_CALL.test(stripSourceComments(s));

  // (1) La superficie nueva: una pantalla que muestra el estado sin decidir nada.
  assert.ok(detectaEstado('const status = useBleConnectionStatus();'));
  assert.ok(detectaEstado('const s=useBleConnectionStatus ();'), 'con espacio antes del paréntesis, igual');
  // (2) Una MENCIÓN en un comentario no es un uso (si no, el guard se llena de falsos positivos y se apaga).
  assert.ok(!detectaEstado('// antes usaba useBleConnectionStatus() acá'));
  assert.ok(!detectaEstado('/* useBleConnectionStatus() */'));
  // (3) Un nombre PARECIDO no dispara (si el guard se pusiera rojo con esto, alguien lo apagaría).
  assert.ok(!detectaEstado('const x = useBleConnectionStatusLabel();'));
  assert.ok(!detectaReclamo('useStickStatusSurfaceClaimed();'), 'LEER el reclamo no es EMITIRLO');
  // (4) El reclamo se detecta escrito como esté escrito.
  assert.ok(detectaReclamo("useStickStatusSurface('header-chip', view !== null);"));
  assert.ok(detectaReclamo('useStickStatusSurface(\n  kind,\n);'));
  assert.ok(!detectaReclamo('// useStickStatusSurface(...)'));

  // (5) EL MUTANTE DEL LITERAL DE RUTA: el indicador volviendo a gatear por pathname. Es la regresión
  // exacta que (C) impide, y acá se prueba que el detector la ve sobre el fuente REAL mutado.
  const conLiteral = code(INDICATOR).replace(
    'const visible = !isNonDemoE2E() && !surfaceClaimed',
    "const visible = pathname !== '/baston'",
  );
  assert.notEqual(conLiteral, code(INDICATOR), 'el fuente del indicador cambió de forma: revisá este test');
  assert.match(conLiteral, /\/baston\b/, 'el detector de (C) tiene que ver el literal de ruta');

  // (6) EL MUTANTE DEL MONTAJE: el hook de reclamo con `useEffect` en vez de `useFocusEffect`.
  const conMontaje = code(CLAIM_HOOK).replace(/useFocusEffect/g, 'useEffect');
  assert.match(conMontaje, /\buseEffect\s*\(/, 'el detector de (D) tiene que ver el efecto de montaje');
  assert.doesNotMatch(conMontaje, /\buseFocusEffect\s*\(/);
});

test('AUTO-VERIFICACIÓN: el guard escaneó todo el árbol, y los archivos ENTEROS', () => {
  assertScanCoverage({
    guard: 'stick-status-surface',
    files: ROOTS.flatMap(listFiles),
    minFiles: SCANNED_FILES_FLOOR,
    label: rel,
    read: (f) => readFileSync(f, 'utf8'),
    strip: stripSourceComments,
  });
});

test('el guard recorre el árbol real y ENCUENTRA las superficies que ya existen', () => {
  // Si el escaneo se rompiera, (A) pasaría vacío — verde por ceguera. Acá se exige que la población real
  // no esté vacía y que contenga las cuatro que hoy sabemos que existen.
  const found = statusSurfaceFiles();
  assert.ok(found.length >= 4, `el guard solo encontró ${found.length} superficies de estado (esperaba ≥4)`);
  for (const [file, entry] of Object.entries(STATUS_SURFACES)) {
    if (entry.tipo !== 'muestra-el-estado') continue; // los dueños de la BANDA no leen el estado
    assert.ok(found.includes(file), `${file} debería estar dentro de la población escaneada`);
  }
  // Y las dos poblaciones juntas no pueden quedar vacías por un escaneo roto.
  const claimers = scannedSources().filter(({ src }) => CLAIM_HOOK_CALL.test(src)).length;
  assert.ok(claimers >= 4, `el guard solo encontró ${claimers} archivos que reclaman (esperaba ≥4)`);
});
