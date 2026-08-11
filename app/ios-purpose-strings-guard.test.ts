// GUARD de los PURPOSE STRINGS de iOS, escrito sobre la AUSENCIA (defecto real: build 5 de iOS,
// 2026-08-10 — `ITMS-90683: Missing purpose string in Info.plist`, NSBluetoothAlwaysUsageDescription).
//
// ── POR QUÉ ESTE GUARD Y NO UN ASSERT MÁS EN `app.config.test.ts` ────────────────────────────────────
// El defecto NO fue una clave mal escrita: fue que **nadie estaba mirando la lista**. `app.config.test.ts`
// verifica lo que alguien se acordó de poner; eso no puede fallar por lo que falta. Acá el oráculo es al
// revés: se enumeran los RECURSOS PROTEGIDOS de iOS con su clave, se **escanea el código nativo Apple de
// todo lo instalado** buscando los símbolos que delatan el uso de cada uno, y todo módulo que toque un
// recurso tiene que tener un veredicto escrito: o **exige** su purpose string (y entonces la clave tiene
// que estar declarada y con texto útil), o está **excluido con un motivo que se sostiene EJECUTANDO algo**.
// Un módulo nuevo que toque un recurso protegido nace en ROJO.
//
// No es cosmético, y son DOS costos distintos que conviene no mezclar:
//  · INCONDICIONAL: el validador de App Store Connect RECHAZA la entrega si el binario linkea el
//    framework y la clave no está (ITMS-90683). No depende de que la app ejecute nada. Y el aviso llega
//    DESPUÉS de gastar un build de EAS (recurso agotable: plan Free, 30 por mes, ya se agotaron una vez),
//    así que enterarse por Apple cuesta un ciclo entero.
//  · CONDICIONAL: instanciar `CBCentralManager` sin la clave **aborta el proceso**. Eso pasa cuando la
//    app monta el manager — que en iOS HOY no ocurre: no hay transporte iOS (`selectTransportAdapter`
//    devuelve `manual` y `isSppNativeAvailable()` corta por `Platform.OS !== 'android'`), así que la
//    pantalla del bastón en iPhone es manual-first y no llega a CoreBluetooth. El día que se destrabe
//    el camino iOS, este pasa a ser el modo de falla principal.
//
// ── LO QUE ESTE GUARD **NO** CUBRE (declarado, no fingido) ──────────────────────────────────────────
//  1. **Recursos protegidos que no estén en `IOS_PROTECTED_RESOURCES`.** La tabla es enumerable y está
//     completa para las purpose strings que existen hoy, pero es una lista escrita a mano: un recurso
//     nuevo de un iOS futuro no se detecta solo. Mitigación parcial: `CENSUS` pinea las dependencias
//     DIRECTAS con código nativo Apple, así que agregar una obliga a pasar por acá y mirar.
//  2. **Código nativo que no viva en `<paquete>/ios`, `<paquete>/apple`, o en un paquete con `.podspec`
//     en la raíz.** Es la convención de todo el ecosistema RN/Expo (verificado sobre el árbol real: los
//     51 paquetes nativos instalados la cumplen), pero un paquete que ponga sus fuentes en `darwin/`
//     sin podspec quedaría invisible al escaneo de símbolos.
//  3. **Uso de un recurso protegido desde código propio en el proyecto nativo** (`ios/` generado por
//     prebuild). Hoy no hay: la app es 100% managed/CNG y no tiene carpeta `ios/` versionada.
//  4. **Que el bastón MFi FUNCIONE en iOS.** La clave `UISupportedExternalAccessoryProtocols` SÍ está
//     cubierta (se exige DECLARADA mientras `react-native-bluetooth-classic` esté instalado — ver el
//     test de abajo), pero se acepta VACÍA a propósito: eso evita el trap del force-cast del módulo, no
//     habilita ningún accesorio. Sin el protocol string del fabricante (trámite MFi, gateado) el bastón
//     no aparece en iOS, y este guard no puede saber cuál es ese string ni verificar el trámite.
//  5. **El `Info.plist` FINAL.** Lo que se verifica es la FUENTE (`app.config.ts`), no el plist que sale
//     del prebuild: un config plugin podría borrar una clave después. Los nuestros no tocan iOS
//     (`with-bluetooth-classic` solo escribe el AndroidManifest), y verificar el plist real exigiría
//     correr `expo prebuild` en cada corrida de la suite — un costo que no se paga por un riesgo que hoy
//     no existe. Si algún día se agrega un plugin que escriba el Info.plist, esto hay que revisarlo.
//
// ⚠️ Debe estar registrado en la lista EXPLÍCITA de `scripts/run-tests.mjs`: un guard que no corre da
// falsa confianza.

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, type Dirent } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import config from './app.config.ts';
import { FEEDBACK_AUDIO_MODE } from './src/services/ble/feedback-logic.ts';
import { stripSourceComments } from './src/utils/strip-comments.ts';

const APP_ROOT = dirname(fileURLToPath(import.meta.url)); // app/
const NODE_MODULES = join(APP_ROOT, 'node_modules');

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// (0) LA TABLA DE RECURSOS PROTEGIDOS: qué clave exige iOS y qué símbolo delata el uso
// ─────────────────────────────────────────────────────────────────────────────────────────────────────

interface ProtectedResource {
  /** La clave de `Info.plist` que iOS exige para poder tocar el recurso. */
  key: string;
  /** Los símbolos del SDK de Apple que delatan el uso. Se buscan en el fuente nativo, sin comentarios. */
  symbols: RegExp;
  /** Qué queda AFUERA del patrón y por qué (los casos que NO piden permiso). */
  note: string;
}

const IOS_PROTECTED_RESOURCES = {
  bluetooth: {
    key: 'NSBluetoothAlwaysUsageDescription',
    symbols: /CBCentralManager|CBPeripheralManager|CBManager|import CoreBluetooth|<CoreBluetooth/,
    note: 'la clásica `NSBluetoothPeripheralUsageDescription` está deprecada desde iOS 13; la vigente es esta',
  },
  camera: {
    key: 'NSCameraUsageDescription',
    symbols: /AVCaptureDevice|AVCaptureSession|UIImagePickerController/,
    note: '`AVCaptureSession` entra a propósito aunque sola no pida permiso: quien arma una sesión de captura termina en `AVCaptureDevice`',
  },
  microphone: {
    key: 'NSMicrophoneUsageDescription',
    symbols: /AVAudioRecorder|requestRecordPermission|AVAudioSessionRecordPermission|kAudioUnitSubType_VoiceProcessingIO/,
    note: 'REPRODUCIR audio no pide permiso — `AVAudioPlayer`/`AVAudioSession` a secas quedan afuera; el permiso lo dispara GRABAR',
  },
  location: {
    key: 'NSLocationWhenInUseUsageDescription',
    symbols: /CLLocationManager|import CoreLocation|<CoreLocation/,
    note: 'los TIPOS de CoreLocation (CLLocationCoordinate2D, CLCircularRegion) no piden permiso, pero importar el framework es señal suficiente para exigir veredicto',
  },
  photos: {
    key: 'NSPhotoLibraryUsageDescription',
    symbols: /PHPhotoLibrary|PHAsset|import Photos|<Photos\//,
    note: '`PHPickerViewController` queda AFUERA a propósito: corre fuera de proceso y NO requiere permiso ni purpose string',
  },
  contacts: {
    key: 'NSContactsUsageDescription',
    symbols: /CNContactStore/,
    note: 'los tipos (CNContact) no piden permiso; el store sí',
  },
  calendar: {
    key: 'NSCalendarsUsageDescription',
    symbols: /EKEventStore/,
    note: 'desde iOS 17 hay variantes (FullAccess/WriteOnly); la clásica sigue siendo la que exige el validador',
  },
  reminders: {
    key: 'NSRemindersUsageDescription',
    symbols: /EKReminder\b/,
    note: 'recordatorios es un permiso distinto del de calendario aunque compartan EventKit',
  },
  faceid: {
    key: 'NSFaceIDUsageDescription',
    symbols: /LAContext|import LocalAuthentication|<LocalAuthentication/,
    note: 'el Keychain a secas NO pide Face ID; lo pide el item protegido por biometría (LAContext)',
  },
  speech: {
    key: 'NSSpeechRecognitionUsageDescription',
    symbols: /SFSpeechRecognizer/,
    note: '`AVSpeechSynthesizer` (que el teléfono HABLE) no pide permiso; reconocer voz sí',
  },
  motionFitness: {
    key: 'NSMotionUsageDescription',
    symbols: /CMPedometer|CMMotionActivityManager|CMSensorRecorder/,
    note: '`CMMotionManager` (acelerómetro/giróscopo crudos, lo que usa react-native-reanimated en `useAnimatedSensor`) NO pide permiso ni purpose string — el permiso es de "Movimiento y estado físico", o sea podómetro/actividad',
  },
  tracking: {
    key: 'NSUserTrackingUsageDescription',
    symbols: /ATTrackingManager|ASIdentifierManager/,
    note: 'PostHog/Sentry no lo tocan mientras no pidan el IDFA',
  },
  health: {
    key: 'NSHealthShareUsageDescription',
    symbols: /HKHealthStore/,
    note: 'HealthKit además exige entitlement; acá solo se vigila la purpose string',
  },
  homekit: {
    key: 'NSHomeKitUsageDescription',
    symbols: /HMHomeManager/,
    note: '',
  },
  nfc: {
    key: 'NFCReaderUsageDescription',
    symbols: /NFCNDEFReaderSession|NFCTagReaderSession/,
    note: 'relevante a futuro si la lectura de caravanas pasa por NFC del teléfono en vez del bastón',
  },
  mediaLibrary: {
    key: 'NSAppleMusicUsageDescription',
    symbols: /MPMediaLibrary|MPMediaQuery/,
    note: 'reproducir un .wav empaquetado no es la biblioteca multimedia del usuario',
  },
  localNetwork: {
    key: 'NSLocalNetworkUsageDescription',
    symbols: /NSNetServiceBrowser|NSNetService\b|NWBrowser|nw_browser/,
    note: 'Bonjour/multicast. No aborta el proceso: sin la clave, el descubrimiento simplemente falla',
  },
  siri: {
    key: 'NSSiriUsageDescription',
    symbols: /INInteraction|INPreferences/,
    note: '',
  },
} as const satisfies Record<string, ProtectedResource>;

type ResourceId = keyof typeof IOS_PROTECTED_RESOURCES;
const RESOURCE_IDS = Object.keys(IOS_PROTECTED_RESOURCES) as ResourceId[];

/**
 * Claves que se declaran A PROPÓSITO sin que ningún módulo las exija. Existe para que el test de
 * "nada de más" no obligue a sacar una clave puesta con criterio, pero exigiendo el criterio escrito.
 */
const DELIBERATE_EXTRA_KEYS: Record<string, string> = {
  NSBluetoothPeripheralUsageDescription:
    'deprecada desde iOS 13 y probablemente innecesaria: se declara igual porque un SEGUNDO aviso del ' +
    'validador cuesta un ciclo entero de build de EAS (30/mes, ya se agotaron una vez). Ver app.config.ts.',
};

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// (1) EL ESCANEO: código nativo Apple de TODO lo instalado (transitivas incluidas)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** Fuentes de Apple. `.h` entra: una interfaz que declara el tipo ya delata la dependencia. */
const APPLE_SOURCE = /\.(swift|m|mm|h)$/;

/** `readdirSync` que devuelve `[]` en vez de tirar (un directorio ausente no puede romper el guard). */
function readDirSafe(dir: string): Dirent[] {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function listNativeFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readDirSafe(dir)) {
    if (entry.name === 'node_modules') continue; // los nested se recorren como paquetes propios
    const p = join(dir, entry.name);
    if (entry.isDirectory()) listNativeFiles(p, acc);
    else if (APPLE_SOURCE.test(entry.name)) acc.push(p);
  }
  return acc;
}

/** Todos los paquetes de `node_modules` (incluye los `@scope/…`), transitivas incluidas. */
function installedPackages(): string[] {
  const out: string[] = [];
  for (const entry of readDirSafe(NODE_MODULES)) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    if (entry.name.startsWith('@')) {
      for (const scoped of readDirSafe(join(NODE_MODULES, entry.name))) {
        if (scoped.isDirectory()) out.push(`${entry.name}/${scoped.name}`);
      }
    } else out.push(entry.name);
  }
  return out.sort();
}

/**
 * Dónde vive el código Apple de un paquete: `ios/` o `apple/` (la convención de RN/Expo) y, si no tiene
 * ninguna de las dos pero sí un `.podspec` en la raíz, el paquete entero (el caso de `react-native`,
 * que reparte sus fuentes en `React/`, `Libraries/`, `ReactCommon/`).
 */
function appleRoots(pkg: string): string[] {
  const base = join(NODE_MODULES, pkg);
  const conventional = ['ios', 'apple'].map((d) => join(base, d)).filter((p) => existsSync(p));
  if (conventional.length > 0) return conventional;
  if (readDirSafe(base).some((entry) => entry.name.endsWith('.podspec'))) return [base];
  return [];
}

/** ¿El paquete trae código nativo de Apple? (aunque hoy no toque ningún recurso protegido). */
function hasAppleNativeCode(pkg: string): boolean {
  return appleRoots(pkg).length > 0;
}

const nativeFilesCache = new Map<string, string[]>();
function nativeFilesOf(pkg: string): string[] {
  const cached = nativeFilesCache.get(pkg);
  if (cached) return cached;
  const files = appleRoots(pkg).flatMap((root) => listNativeFiles(root));
  nativeFilesCache.set(pkg, files);
  return files;
}

/**
 * Archivos nativos de `pkg` donde el símbolo aparece **en código** (no en un comentario).
 *
 * Dos fases a propósito: el `test` crudo descarta el 99,6% de los archivos sin pagar el blanqueo, y el
 * blanqueo (caro) corre solo sobre los candidatos. Sin la segunda fase, un comentario dispararía el
 * guard — pasa de verdad: `react-native/React/Views/RCTConvert+CoreLocation.h` menciona `PHAssetLibrary`
 * en una nota de un HACK, y eso pediría `NSPhotoLibraryUsageDescription` por nada.
 */
function vendorMatches(pkg: string, symbols: RegExp): string[] {
  const found: string[] = [];
  for (const file of nativeFilesOf(pkg)) {
    let src: string;
    try {
      src = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    if (!symbols.test(src)) continue;
    if (!symbols.test(stripSourceComments(src))) continue;
    found.push(relative(join(NODE_MODULES, pkg), file).split(sep).join('/'));
  }
  return found;
}

interface NativeHit {
  pkg: string;
  resource: ResourceId;
  files: string[];
}

const NATIVE_PACKAGES = installedPackages().filter(hasAppleNativeCode);

/**
 * Pre-filtro: la unión de todos los patrones. Deja el caso común (un fuente que no toca NINGÚN recurso
 * protegido, o sea el 99,6% del árbol) en UNA pasada de regex en vez de una por recurso.
 */
const ANY_SYMBOL = new RegExp(RESOURCE_IDS.map((r) => IOS_PROTECTED_RESOURCES[r].symbols.source).join('|'));

/** Una sola lectura por archivo: `HITS` se arma en una pasada, no una por recurso. */
function scanPackage(pkg: string): NativeHit[] {
  const byResource = new Map<ResourceId, string[]>();
  for (const file of nativeFilesOf(pkg)) {
    let src: string;
    try {
      src = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    if (!ANY_SYMBOL.test(src)) continue;
    const stripped = stripSourceComments(src);
    if (!ANY_SYMBOL.test(stripped)) continue;
    const rel = relative(join(NODE_MODULES, pkg), file).split(sep).join('/');
    for (const resource of RESOURCE_IDS) {
      if (!IOS_PROTECTED_RESOURCES[resource].symbols.test(stripped)) continue;
      byResource.set(resource, [...(byResource.get(resource) ?? []), rel]);
    }
  }
  return [...byResource].map(([resource, files]) => ({ pkg, resource, files }));
}

const HITS: NativeHit[] = NATIVE_PACKAGES.flatMap(scanPackage);

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// (2) EL CÓDIGO PROPIO: lo que sostiene las exclusiones
// ─────────────────────────────────────────────────────────────────────────────────────────────────────

const OWN_SOURCE_ROOTS = ['app', 'src', 'plugins'].map((d) => join(APP_ROOT, d));

function listOwnSources(dir: string, acc: string[] = []): string[] {
  for (const entry of readDirSafe(dir)) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) listOwnSources(p, acc);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) acc.push(p);
  }
  return acc;
}

/** `<rel>:<línea>` de cada línea del código PROPIO (sin tests, sin comentarios) que matchea. */
function ownSourceMatches(re: RegExp): string[] {
  const hits: string[] = [];
  for (const root of OWN_SOURCE_ROOTS) {
    for (const file of listOwnSources(root)) {
      const rel = relative(APP_ROOT, file).split(sep).join('/');
      stripSourceComments(readFileSync(file, 'utf8'))
        .split(/\r?\n/)
        .forEach((line, i) => {
          if (re.test(line)) hits.push(`${rel}:${i + 1}`);
        });
    }
  }
  return hits;
}

function pluginNames(): string[] {
  return (config().plugins ?? []).map((p) => (Array.isArray(p) ? String(p[0]) : String(p)));
}

function directDependencies(): string[] {
  const pkg = JSON.parse(readFileSync(join(APP_ROOT, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  return [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})].sort();
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// (3) LOS VEREDICTOS: cada módulo que toca un recurso protegido tiene uno, escrito
// ─────────────────────────────────────────────────────────────────────────────────────────────────────

type Verdict =
  | { requires: true; why: string }
  /**
   * Excluido. `stillHolds` devuelve `null` si la exclusión SIGUE VALIENDO, o el motivo por el que dejó
   * de valer. Es la diferencia entre una excepción y un comentario: la condición se **ejecuta**.
   */
  | { requires: false; why: string; stillHolds: () => string | null };

/**
 * ── LA RED POR NOMBRE (segunda capa, para lo que el escaneo NO puede ver) ───────────────────────────
 *
 * El escaneo de símbolos es el oráculo bueno, pero tiene un punto ciego obvio: **solo ve lo instalado**.
 * Una dependencia agregada a `package.json` y todavía sin `pnpm install` —o instalada en la máquina de
 * otro— no tiene fuentes que escanear, y el guard la dejaría pasar en verde justo en el momento en que
 * más importa (el commit que la agrega).
 *
 * Estos son los módulos del ecosistema RN/Expo cuyo PROPÓSITO **es** el recurso protegido: si el nombre
 * aparece en `package.json`, la clave hace falta, esté instalado o no. No están los ambiguos (`expo-av`,
 * `expo-audio`): esos pueden entrar por reproducción y su veredicto sale del escaneo.
 */
const MODULES_BY_NAME: Record<string, ResourceId[]> = {
  'expo-camera': ['camera', 'microphone'],
  'expo-barcode-scanner': ['camera'],
  'expo-image-picker': ['camera', 'photos'],
  'expo-media-library': ['photos'],
  'expo-location': ['location'],
  'expo-contacts': ['contacts'],
  'expo-calendar': ['calendar', 'reminders'],
  'expo-local-authentication': ['faceid'],
  'expo-sensors': ['motionFitness'],
  'expo-tracking-transparency': ['tracking'],
  'expo-speech-recognition': ['speech', 'microphone'],
  'react-native-vision-camera': ['camera', 'microphone'],
  'react-native-image-picker': ['camera', 'photos'],
  'react-native-ble-plx': ['bluetooth'],
  'react-native-nfc-manager': ['nfc'],
  'react-native-health': ['health'],
  '@react-native-community/geolocation': ['location'],
};

/** Los módulos de la red por nombre que tocan un recurso dado (los "dueños naturales" del permiso). */
function modulesTouching(resource: ResourceId): string[] {
  return Object.entries(MODULES_BY_NAME)
    .filter(([, resources]) => resources.includes(resource))
    .map(([name]) => name);
}

const MODULE_VERDICTS: Record<string, Partial<Record<ResourceId, Verdict>>> = {
  'react-native-bluetooth-classic': {
    bluetooth: {
      requires: true,
      why:
        'el bastón lector (spec 04). Su `ios/RNBluetoothClassic.swift` usa CoreBluetooth: sin la clave, ' +
        'iOS aborta el proceso al instanciar el manager y el validador frena el build (ITMS-90683).',
    },
  },
  'expo-audio': {
    microphone: {
      requires: false,
      why:
        'trae el grabador (`ios/AudioRecorder.swift`) pero la app NO graba: se usa solo para el pip de ' +
        'la lectura del bastón, con `allowsRecording: false` y sin enganchar su config plugin (que ' +
        'agregaría NSMicrophoneUsageDescription y RECORD_AUDIO). Ver `src/services/ble/feedback-guard.test.ts` ' +
        '(«el aviso NO graba») y `app.config.test.ts` («expo-audio NO se engancha como config plugin»). ' +
        'Un pedido de micrófono en una app de ganadería es un problema de confianza, no un detalle.',
      stillHolds: () => {
        if (FEEDBACK_AUDIO_MODE.allowsRecording !== false) {
          return '`FEEDBACK_AUDIO_MODE.allowsRecording` dejó de ser `false`: la sesión de audio ya arrastra el micrófono';
        }
        if (pluginNames().includes('expo-audio')) {
          return 'se enganchó el config plugin de `expo-audio`, que declara NSMicrophoneUsageDescription por su cuenta';
        }
        const recording = ownSourceMatches(
          /\b(useAudioRecorder|AudioRecorder|RecordingPresets|requestRecordingPermissionsAsync|getRecordingPermissionsAsync)\b|allowsRecording:\s*true/,
        );
        if (recording.length > 0) {
          return `la app empezó a usar la API de GRABACIÓN de expo-audio: ${recording.join(', ')}`;
        }
        return null;
      },
    },
  },
  'expo-file-system': {
    photos: {
      requires: false,
      why:
        'el camino de Photos es el legacy de URIs `assets-library:`/`ph://` (`ios/Legacy/FileSystemHelpers.swift`), ' +
        'que solo se ejecuta si le pasás una URI de la fototeca. La app usa `documentDirectory`/`cacheDirectory` ' +
        'para el export SIGSA y los archivos del import: nunca toca una URI de fototeca, y no hay ningún ' +
        'módulo instalado que pueda producir una.',
      stillHolds: () => {
        const deps = directDependencies();
        const cameraOrPhotos = [...new Set([...modulesTouching('photos'), ...modulesTouching('camera')])];
        const entraron = cameraOrPhotos.filter((m) => deps.includes(m) || existsSync(join(NODE_MODULES, m)));
        if (entraron.length > 0) {
          return `entró ${entraron.join(', ')}: ahora sí puede haber URIs de la fototeca en juego`;
        }
        const uris = ownSourceMatches(/assets-library:|ph:\/\/|PHAsset/);
        if (uris.length > 0) return `la app empezó a manejar URIs de la fototeca: ${uris.join(', ')}`;
        return null;
      },
    },
  },
  'expo-modules-core': {
    camera: {
      requires: false,
      why:
        'son DECLARACIONES de protocolo (`ios/Interfaces/Camera/EXCameraInterface.h` y el de FaceDetector) ' +
        'que tipan un `AVCaptureSession` para el módulo que las implemente. No hay captura: la implementación ' +
        'la traería `expo-camera`, que no está instalado (y si se instalara, entraría al escaneo con su propio veredicto).',
      stillHolds: () => {
        const real = vendorMatches('expo-modules-core', /AVCaptureDevice|UIImagePickerController/);
        if (real.length > 0) {
          return `expo-modules-core pasó de declarar interfaces a usar la cámara de verdad: ${real.join(', ')}`;
        }
        return null;
      },
    },
  },
  'expo-notifications': {
    location: {
      requires: false,
      why:
        'importa CoreLocation para (des)serializar el `CLCircularRegion` de un `UNLocationNotificationTrigger` ' +
        '(`ios/ExpoNotifications/Notifications/NotificationRecords.swift`). No instancia ningún `CLLocationManager`: ' +
        'sin pedir la ubicación no hay trigger geográfico posible, y la app solo usa push remoto.',
      stillHolds: () => {
        const real = vendorMatches('expo-notifications', /CLLocationManager/);
        if (real.length > 0) return `expo-notifications ahora instancia un CLLocationManager: ${real.join(', ')}`;
        return null;
      },
    },
  },
  'react-native': {
    location: {
      requires: false,
      why:
        'es la categoría de conversión `React/Views/RCTConvert+CoreLocation.h` (JSON → CLLocationDegrees / ' +
        'CLLocationCoordinate2D). Son TIPOS: el core de RN no pide ubicación, y una app RN pelada se publica ' +
        'sin ninguna purpose string.',
      stillHolds: () => {
        const real = vendorMatches('react-native', /CLLocationManager/);
        if (real.length > 0) return `el core de RN ahora instancia un CLLocationManager: ${real.join(', ')}`;
        return null;
      },
    },
  },
  'expo-secure-store': {
    faceid: {
      requires: false,
      why:
        'usa `LAContext` solo en el camino `requireAuthentication: true` (`ios/SecureStoreModule.swift`). ' +
        'La app guarda la sesión de Supabase sin esa opción, así que el item del Keychain nunca queda ' +
        'protegido por biometría y iOS nunca pide Face ID.',
      stillHolds: () => {
        const uses = ownSourceMatches(/requireAuthentication/);
        if (uses.length > 0) {
          return `la app empezó a pedir items del Keychain con biometría: ${uses.join(', ')}`;
        }
        return null;
      },
    },
  },
  'expo-dev-launcher': {
    localNetwork: {
      requires: false,
      why:
        'descubre servidores de desarrollo por Bonjour (`ios/SwiftUI/NetworkUtilities.swift`). Entra solo por ' +
        '`expo-dev-client` (transitiva) y su superficie es el build de desarrollo; la clave que le faltaría ' +
        'NO aborta el proceso ni la marca el validador: el descubrimiento falla y se pega la URL a mano. ' +
        'No se declara para no pedirle al usuario final un permiso que la app publicada no usa. Lo que sí ' +
        'vigila el guard es que NINGÚN otro paquete toque Bonjour: ese tendría que traer su propio veredicto.',
      stillHolds: () => {
        if (directDependencies().includes('expo-dev-launcher')) {
          return '`expo-dev-launcher` pasó a ser dependencia DIRECTA: dejó de ser un detalle del dev-client';
        }
        return null;
      },
    },
  },
};

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// (4) LOS TESTS
// ─────────────────────────────────────────────────────────────────────────────────────────────────────

const VARIANTS: (string | undefined)[] = [undefined, 'development', 'preview', 'production'];

function infoPlistOf(variant: string | undefined): Record<string, unknown> {
  if (variant === undefined) delete process.env.APP_VARIANT;
  else process.env.APP_VARIANT = variant;
  return (config().ios?.infoPlist ?? {}) as Record<string, unknown>;
}

/**
 * Qué hace aceptable un purpose string. Apple rechaza los genéricos ("esta app usa Bluetooth") y para
 * iOS un string vacío es lo mismo que la clave ausente. El texto sale en el diálogo del SO, así que va
 * en español y tiene que decir PARA QUÉ.
 */
function purposeStringProblem(value: unknown): string | null {
  if (typeof value !== 'string') return `no está declarada (es ${JSON.stringify(value)})`;
  const text = value.trim();
  if (text.length === 0) return 'está VACÍA — para iOS es exactamente lo mismo que no declararla';
  if (text.length < 30) return `tiene ${text.length} caracteres: es un genérico, y Apple los rechaza`;
  if (!/ para /i.test(text)) return 'no explica el PARA QUÉ (le falta la cláusula "… para …"), que es lo único que Apple pide';
  return null;
}

// ── `UISupportedExternalAccessoryProtocols`: no es una purpose string, y se rompe PEOR ───────────────
// `react-native-bluetooth-classic` hace, dentro del `init()` de su módulo nativo
// (`ios/RNBluetoothClassic.swift:68-69`):
//
//     self.supportedProtocols = Bundle.main
//         .object(forInfoDictionaryKey: "UISupportedExternalAccessoryProtocols") as! [String]
//
// `object(forInfoDictionaryKey:)` devuelve un opcional: SIN la clave eso es `nil as! [String]`, que
// TRAPEA. El módulo no falla al usarse — falla al INSTANCIARSE. Y en bridgeless (RN 0.85) instanciarlo
// es más barato de lo que parece: leer `NativeModules.RNBluetoothClassic` ya crea el objeto nativo
// (BridgelessNativeModuleProxy → RCTTurboModuleManager → `[moduleClass new]`), así que hasta el chequeo
// defensivo `NativeModules.X == null` de `loadRNBC()` sería el disparador. Hoy no se dispara porque en
// iOS `isSppNativeAvailable()` corta antes por `Platform.OS !== 'android'`: un `if` de distancia.
//
// Por eso la clave se declara VACÍA en `app.config.ts`. El oráculo de acá abajo tiene que ACEPTAR el
// array vacío (es el estado correcto de hoy: cero protocolos MFi aprobados) y fallar si NO ESTÁ.
const EA_PROTOCOLS_KEY = 'UISupportedExternalAccessoryProtocols';
const EA_MODULE = 'react-native-bluetooth-classic';

/** El force-cast concreto que hace obligatoria la clave, tal como está en el fuente instalado. */
const EA_FORCE_CAST = /UISupportedExternalAccessoryProtocols[\s\S]{0,60}as!\s*\[\s*String\s*\]/;

/** ¿Está el módulo del force-cast? (declarado o instalado: cualquiera de los dos obliga la clave). */
const EA_MODULE_PRESENT = directDependencies().includes(EA_MODULE) || existsSync(join(NODE_MODULES, EA_MODULE));

/**
 * Qué hace ACEPTABLE el valor de `UISupportedExternalAccessoryProtocols`. Ojo con el oráculo: el array
 * VACÍO es válido —evita el trap sin declarar accesorios que no tenemos— y lo que tiene que cazar es la
 * AUSENCIA (y el "casi": un string suelto en vez de un array, que trapea igual porque el cast es a
 * `[String]`).
 */
function eaProtocolsProblem(value: unknown): string | null {
  if (value === undefined) {
    return (
      'NO está declarada: `Bundle.main.object(forInfoDictionaryKey:)` devuelve nil y el `as! [String]` ' +
      'del `init()` de react-native-bluetooth-classic TRAPEA al instanciarse el módulo'
    );
  }
  if (!Array.isArray(value)) {
    return `está declarada como ${JSON.stringify(value)}: el cast del módulo es a [String], tiene que ser un ARRAY (vacío vale)`;
  }
  const basura = value.filter((v) => typeof v !== 'string' || v.trim().length === 0);
  if (basura.length > 0) {
    return `tiene entradas que no son protocol strings: ${JSON.stringify(basura)}`;
  }
  return null; // `[]` es VÁLIDO a propósito: hoy no hay ningún protocolo MFi aprobado.
}

/** Todas las claves que hoy son OBLIGATORIAS: las que exige el árbol instalado + las que exige el nombre. */
function requiredKeys(): Map<string, string> {
  const out = new Map<string, string>(); // key → quién la exige
  for (const hit of HITS) {
    if (MODULE_VERDICTS[hit.pkg]?.[hit.resource]?.requires !== true) continue;
    out.set(IOS_PROTECTED_RESOURCES[hit.resource].key, hit.pkg);
  }
  const deps = directDependencies();
  for (const [mod, resources] of Object.entries(MODULES_BY_NAME)) {
    if (!deps.includes(mod)) continue;
    for (const resource of resources) out.set(IOS_PROTECTED_RESOURCES[resource].key, mod);
  }
  return out;
}

test('GUARD: todo módulo instalado que toca un recurso protegido de iOS tiene VEREDICTO escrito', () => {
  // El corazón del guard. No enumera "los módulos que sabemos": deriva del árbol instalado quién toca
  // qué, y exige decisión escrita por cada par (módulo, recurso). Un módulo nuevo nace en ROJO.
  const sinVeredicto = HITS.filter((h) => MODULE_VERDICTS[h.pkg]?.[h.resource] === undefined).map(
    (h) => `${h.pkg} → ${h.resource} (${IOS_PROTECTED_RESOURCES[h.resource].key}) en ${h.files.slice(0, 3).join(', ')}`,
  );
  assert.deepEqual(
    sinVeredicto,
    [],
    'Hay código nativo instalado que toca un recurso protegido de iOS SIN veredicto en `MODULE_VERDICTS`:\n' +
      `  ${sinVeredicto.join('\n  ')}\n` +
      'No está prohibido: está prohibido EN SILENCIO. Decidí y escribilo — o exige su purpose string ' +
      '(`requires: true`, y la declarás en `app.config.ts`), o está excluido con un motivo y una ' +
      'condición `stillHolds()` que se pueda EJECUTAR. Acordate del costo del error: sin la clave, iOS ' +
      'no muestra un permiso feo, ABORTA el proceso — y enterarte por el validador de Apple cuesta un build de EAS.',
  );
});

test('GUARD: las purpose strings EXIGIDAS están declaradas, con texto útil, en TODAS las variantes', () => {
  // El build que Raf instala en el teléfono es el `dev`: declarar la clave en una sola rama del ternario
  // de `app.config.ts` sería el mismo agujero con otra cara.
  const required = requiredKeys();
  assert.ok(required.size > 0, 'no se detectó NINGUNA clave obligatoria — ver la auto-verificación');

  const problems: string[] = [];
  for (const variant of VARIANTS) {
    const info = infoPlistOf(variant);
    for (const [key, quien] of required) {
      const problem = purposeStringProblem(info[key]);
      if (problem) problems.push(`variant=${variant}: \`${key}\` (la exige ${quien}) ${problem}`);
    }
  }
  assert.deepEqual(
    problems,
    [],
    `Purpose strings faltantes o inservibles en \`app.config.ts\`:\n  ${problems.join('\n  ')}\n` +
      'Esto es lo que Apple devolvió como ITMS-90683 en el build 5 de iOS. Y no es cosmético: sin la ' +
      'clave, iOS ABORTA el proceso cuando el módulo instancia su manager.',
  );
});

test('GUARD por NOMBRE: un módulo de recurso protegido en package.json exige su clave, esté instalado o no', () => {
  // El punto ciego del escaneo: `pnpm add expo-camera` deja el módulo en `package.json` y el árbol sin
  // fuentes hasta el `install`. Este test no depende de node_modules — mira el nombre.
  const deps = directDependencies();
  const info = infoPlistOf(undefined);
  const problems: string[] = [];
  for (const [mod, resources] of Object.entries(MODULES_BY_NAME)) {
    if (!deps.includes(mod)) continue;
    for (const resource of resources) {
      const { key } = IOS_PROTECTED_RESOURCES[resource];
      const problem = purposeStringProblem(info[key]);
      if (problem) problems.push(`\`${mod}\` está en package.json y \`${key}\` ${problem}`);
    }
  }
  assert.deepEqual(
    problems,
    [],
    `Módulos de recurso protegido sin su purpose string:\n  ${problems.join('\n  ')}\n` +
      'Declarala en `ios.infoPlist` de `app.config.ts`, con un texto de cara al usuario que diga para qué ' +
      '(Apple rechaza los genéricos). Si el módulo entró para algo que NO toca el recurso, sacalo de ' +
      '`MODULES_BY_NAME` dejando escrito por qué.',
  );
});

test('GUARD: `UISupportedExternalAccessoryProtocols` está DECLARADA (vacía vale) mientras esté el bastón MFi', (t) => {
  // No es una purpose string y por eso no entra en la maquinaria de arriba, pero el modo de falla es el
  // mismo y peor: sin la clave, el módulo de `react-native-bluetooth-classic` TRAPEA en su `init()`
  // (force-cast de `nil` a `[String]`). Todas las variantes, por el mismo motivo que las purpose strings:
  // el build que se instala en el teléfono es el `dev`.
  if (!EA_MODULE_PRESENT) {
    t.skip(`\`${EA_MODULE}\` ya no está (ni declarado ni instalado): sin su force-cast, la clave dejó de ser obligatoria`);
    return;
  }
  const problems: string[] = [];
  for (const variant of VARIANTS) {
    const problem = eaProtocolsProblem(infoPlistOf(variant)[EA_PROTOCOLS_KEY]);
    if (problem) problems.push(`variant=${variant}: \`${EA_PROTOCOLS_KEY}\` ${problem}`);
  }
  assert.deepEqual(
    problems,
    [],
    `\`${EA_PROTOCOLS_KEY}\` en \`app.config.ts\`:\n  ${problems.join('\n  ')}\n` +
      `Va declarada mientras \`${EA_MODULE}\` esté instalado, y va VACÍA (\`[]\`) hasta que salga el ` +
      'trámite MFi: con el array vacío el cast tiene éxito y el módulo arranca con la lista vacía, que ' +
      'es la verdad de hoy (no tenemos ningún protocolo MFi aprobado). NO inventes un protocol string ' +
      'para "completarla": no habilita ningún accesorio y le miente al SO.',
  );
});

test('AUTO-VERIFICACIÓN: el force-cast que obliga esa clave SIGUE en el fuente instalado', (t) => {
  // El `stillHolds()` de una EXIGENCIA (en vez de una exclusión): la clave se declara por un defecto
  // concreto de la librería, y si la librería lo arregla, el motivo escrito acá deja de ser cierto.
  if (!EA_MODULE_PRESENT) {
    t.skip(`\`${EA_MODULE}\` ya no está: no hay force-cast que verificar`);
    return;
  }
  const files = vendorMatches(EA_MODULE, EA_FORCE_CAST);
  assert.ok(
    files.includes('ios/RNBluetoothClassic.swift'),
    `no se encontró el force-cast de \`${EA_PROTOCOLS_KEY}\` en ${EA_MODULE}/ios/RNBluetoothClassic.swift ` +
      `(se vio: ${files.join(', ') || 'nada'}).\n` +
      'Dos lecturas posibles, y las dos piden mirar: (a) la librería lo arregló (un `as?` con default) y ' +
      'entonces la clave ya no es obligatoria —podés dejarla igual, pero actualizá el motivo escrito en ' +
      '`app.config.ts`—, o (b) el escaneo dejó de ver el archivo y este guard está ciego.',
  );
});

test('FALSIFICACIÓN: el oráculo de la clave MFi ACEPTA el array vacío y caza la ausencia', () => {
  assert.equal(eaProtocolsProblem([]), null); // el estado CORRECTO de hoy: sin trámite MFi, lista vacía
  assert.equal(eaProtocolsProblem(['com.fabricante.rs420']), null); // el día que salga el trámite
  assert.match(String(eaProtocolsProblem(undefined)), /NO está declarada/); // el bug que cierra este test
  assert.match(String(eaProtocolsProblem(null)), /ARRAY/);
  assert.match(String(eaProtocolsProblem('')), /ARRAY/); // string vacío ≠ array vacío: el cast trapea igual
  assert.match(String(eaProtocolsProblem('com.fabricante.rs420')), /ARRAY/); // el protocolo sin el array
  assert.match(String(eaProtocolsProblem([''])), /protocol strings/);
  assert.match(String(eaProtocolsProblem([42])), /protocol strings/);

  // Y el patrón que busca el motivo en el fuente instalado: ve la forma REAL del force-cast y NO se
  // dispara con la forma arreglada (un `as?` con default). Sin esto, un patrón muerto dejaría la
  // auto-verificación de arriba en verde por no ver nada — o en rojo eterno, que es peor.
  const REAL = '.object(forInfoDictionaryKey: "UISupportedExternalAccessoryProtocols") as! [String]';
  const ARREGLADO = '.object(forInfoDictionaryKey: "UISupportedExternalAccessoryProtocols") as? [String] ?? []';
  assert.ok(EA_FORCE_CAST.test(REAL), 'el patrón del force-cast NO ve la línea real de RNBluetoothClassic.swift');
  assert.ok(!EA_FORCE_CAST.test(ARREGLADO), 'el patrón del force-cast se dispara con el cast SEGURO');
});

test('GUARD: las EXCLUSIONES se sostienen (una excepción que no se ejecuta es un comentario)', () => {
  const rotas: string[] = [];
  for (const hit of HITS) {
    const verdict = MODULE_VERDICTS[hit.pkg]?.[hit.resource];
    if (!verdict || verdict.requires) continue;
    const broken = verdict.stillHolds();
    if (broken) {
      rotas.push(
        `${hit.pkg} → ${hit.resource}: la exclusión YA NO VALE — ${broken}. ` +
          `Ahora hace falta \`${IOS_PROTECTED_RESOURCES[hit.resource].key}\` en app.config.ts (o un motivo nuevo).`,
      );
    }
  }
  assert.deepEqual(rotas, [], rotas.join('\n'));
});

test('GUARD: todo veredicto de la tabla describe el árbol REAL (nada de exclusiones fantasma)', () => {
  // La contracara del test de arriba: una tabla que excluye módulos que ya nadie instala, o recursos que
  // el paquete dejó de tocar, deja de describir la app — y el día que el módulo vuelva, el veredicto
  // viejo lo absuelve sin que nadie lo mire.
  const fantasmas: string[] = [];
  for (const [pkg, byResource] of Object.entries(MODULE_VERDICTS)) {
    for (const resource of Object.keys(byResource) as ResourceId[]) {
      const hit = HITS.find((h) => h.pkg === pkg && h.resource === resource);
      if (!hit) fantasmas.push(`${pkg} → ${resource}`);
    }
  }
  assert.deepEqual(
    fantasmas,
    [],
    `Veredictos que ya no corresponden a nada instalado: ${fantasmas.join(', ')}. ` +
      'Sacalos (o el escaneo dejó de ver lo que decía ver, que es peor).',
  );
});

test('GUARD: no hay purpose strings declaradas de más (una clave sin dueño escrito)', () => {
  // Pedir un permiso que no se usa es un motivo de rechazo de App Store y, peor, ruido que enseña a
  // ignorar la lista. La única clave sin módulo que la exija es la deprecada de Bluetooth, y está
  // justificada por escrito.
  const required = requiredKeys();
  const declared = Object.keys(infoPlistOf(undefined)).filter((k) => /UsageDescription$/.test(k));
  const huerfanas = declared.filter((k) => !required.has(k) && !(k in DELIBERATE_EXTRA_KEYS));
  assert.deepEqual(
    huerfanas,
    [],
    `Claves de permiso declaradas que ningún módulo instalado exige: ${huerfanas.join(', ')}. ` +
      'Si es a propósito (como NSBluetoothPeripheralUsageDescription), va en `DELIBERATE_EXTRA_KEYS` con el motivo.',
  );
  // Y las "a propósito" también tienen que ser un texto útil: una clave de más con un string vacío es
  // ruido puro, y con un genérico es un motivo de rechazo.
  for (const [key, why] of Object.entries(DELIBERATE_EXTRA_KEYS)) {
    assert.ok(why.length > 40, `\`${key}\` está en la lista de "a propósito" sin motivo escrito`);
    const info = infoPlistOf(undefined);
    if (key in info) {
      assert.equal(purposeStringProblem(info[key]), null, `\`${key}\` está declarada pero su texto no sirve`);
    }
  }
});

test('CENSO: las dependencias DIRECTAS con código nativo Apple son exactamente estas (una nueva nace en rojo)', () => {
  // El escaneo de símbolos cubre el caso "un módulo toca un recurso que la tabla conoce". Este censo
  // cubre el hueco que queda: un recurso protegido que `IOS_PROTECTED_RESOURCES` todavía NO enumera.
  // Agregar una dependencia nativa cuesta una línea acá y una mirada a esta lista — que es exactamente
  // la mirada que faltó cuando entró el bastón sin su purpose string.
  //
  // Solo DIRECTAS a propósito: pinear también las transitivas convertiría cada `pnpm update` en un rojo
  // sin señal. Las transitivas SÍ entran al escaneo de símbolos (que es el oráculo que importa).
  const CENSUS = [
    '@op-engineering/op-sqlite',
    '@powersync/op-sqlite',
    '@react-native-community/netinfo',
    '@react-native-google-signin/google-signin',
    '@sentry/react-native',
    'expo',
    'expo-apple-authentication',
    'expo-application',
    'expo-audio',
    'expo-clipboard',
    'expo-constants',
    'expo-crypto',
    'expo-dev-client',
    'expo-device',
    'expo-document-picker',
    'expo-file-system',
    'expo-haptics',
    'expo-linear-gradient',
    'expo-linking',
    'expo-localization',
    'expo-notifications',
    'expo-router',
    'expo-secure-store',
    'expo-sharing',
    'expo-splash-screen',
    'react-native',
    'react-native-bluetooth-classic',
    'react-native-gesture-handler',
    'react-native-reanimated',
    'react-native-safe-area-context',
    'react-native-screens',
    'react-native-svg',
    'react-native-worklets',
  ];
  // Antes del censo: el guard NO puede certificar un `package.json` que no puede leer en el árbol. Una
  // dependencia declarada y no instalada es invisible para el escaneo de símbolos, así que en vez de
  // pasar en verde sobre algo que no miró, se planta.
  const noInstaladas = directDependencies().filter((d) => !existsSync(join(NODE_MODULES, d)));
  assert.deepEqual(
    noInstaladas,
    [],
    `Hay dependencias en package.json que no están en node_modules: ${noInstaladas.join(', ')}. ` +
      'El escaneo de recursos protegidos no las puede mirar (no hay fuentes nativas que leer), así que el ' +
      'guard no certifica nada: corré `pnpm install` y volvé a correr la suite.',
  );

  const actual = directDependencies().filter(hasAppleNativeCode);
  assert.deepEqual(
    actual,
    CENSUS,
    'Cambió el conjunto de dependencias DIRECTAS con código nativo de Apple.\n' +
      'Antes de actualizar la lista: mirá si el módulo nuevo toca un recurso protegido que ' +
      '`IOS_PROTECTED_RESOURCES` todavía no enumera (cámara, ubicación, contactos, NFC…). Si lo toca y ' +
      'está en la tabla, el guard de veredictos ya te lo va a decir; si NO está en la tabla, agregalo ahí ' +
      'primero. Este censo existe para forzar esa mirada.',
  );
});

test('AUTO-VERIFICACIÓN: el guard escaneó el árbol REAL (si no, todo lo de arriba pasa por no mirar nada)', () => {
  // Sin esto, un `node_modules` ausente o un cambio de convención de rutas dejaría CERO hits y todos los
  // tests en verde: el modo de falla exacto que este archivo vino a cerrar, pero del lado del guard.
  assert.ok(existsSync(NODE_MODULES), `no existe ${NODE_MODULES}: el guard no puede verificar nada`);
  assert.ok(
    NATIVE_PACKAGES.length >= 40,
    `se esperaban decenas de paquetes con código nativo Apple y se vieron ${NATIVE_PACKAGES.length}`,
  );
  const scannedFiles = NATIVE_PACKAGES.reduce((n, pkg) => n + nativeFilesOf(pkg).length, 0);
  assert.ok(scannedFiles >= 2000, `el escaneo vio solo ${scannedFiles} fuentes nativas: algo se rompió`);

  // El caso concreto del defecto: el bastón TIENE que aparecer como usuario de CoreBluetooth.
  const baston =
    HITS.find((h) => h.pkg === 'react-native-bluetooth-classic' && h.resource === 'bluetooth')?.files ?? [];
  assert.ok(
    baston.includes('ios/RNBluetoothClassic.swift'),
    `el escaneo no vio CoreBluetooth en react-native-bluetooth-classic/ios/RNBluetoothClassic.swift ` +
      `(vio: ${baston.join(', ') || 'nada'}) — el guard está ciego`,
  );

  // Y el escaneo del código PROPIO también mira algo real (lo usan las exclusiones).
  const ownFiles = OWN_SOURCE_ROOTS.flatMap((r) => listOwnSources(r));
  assert.ok(ownFiles.length >= 300, `el escaneo del código propio vio ${ownFiles.length} archivos`);
  assert.ok(
    ownFiles.some((f) => f.endsWith(`${sep}feedback-logic.ts`)),
    'el escaneo del código propio no encontró feedback-logic.ts',
  );
});

test('FALSIFICACIÓN: los patrones VEN las formas reales de tocar cada recurso', () => {
  // Un patrón muerto deja el guard verde con el bug puesto. Se prueba cada uno contra la forma en que el
  // símbolo aparece de verdad en un fuente Swift/ObjC.
  const MUTANTES: [ResourceId, string][] = [
    ['bluetooth', 'import CoreBluetooth'],
    ['bluetooth', '  private var centralManager: CBCentralManager?'],
    ['bluetooth', '#import <CoreBluetooth/CoreBluetooth.h>'],
    ['bluetooth', '_manager = [[CBCentralManager alloc] initWithDelegate:self queue:nil];'],
    ['camera', 'let device = AVCaptureDevice.default(for: .video)'],
    ['camera', '@property (nonatomic, strong) AVCaptureSession *session;'],
    ['microphone', 'let recorder = try AVAudioRecorder(url: url, settings: settings)'],
    ['microphone', '[session requestRecordPermission:^(BOOL granted) {'],
    ['location', 'private let locationManager = CLLocationManager()'],
    ['photos', 'let status = PHPhotoLibrary.authorizationStatus(for: .readWrite)'],
    ['photos', 'import Photos'],
    ['contacts', 'let store = CNContactStore()'],
    ['calendar', 'let store = EKEventStore()'],
    ['faceid', 'let context = LAContext()'],
    ['speech', 'let recognizer = SFSpeechRecognizer(locale: locale)'],
    ['motionFitness', 'let pedometer = CMPedometer()'],
    ['tracking', 'ATTrackingManager.requestTrackingAuthorization { status in'],
    ['nfc', 'let session = NFCTagReaderSession(pollingOption: .iso14443, delegate: self)'],
    ['localNetwork', 'let browser = NWBrowser(for: .bonjour(type: "_expo._tcp", domain: nil), using: params)'],
  ];
  for (const [resource, line] of MUTANTES) {
    assert.ok(
      IOS_PROTECTED_RESOURCES[resource].symbols.test(line),
      `el patrón de \`${resource}\` NO ve: ${line}`,
    );
  }
});

test('FALSIFICACIÓN: los patrones NO disparan con lo benigno (un guard que grita siempre se apaga)', () => {
  const BENIGNOS: [ResourceId, string][] = [
    // Reproducir audio no pide micrófono — es literalmente lo que hace el pip del bastón.
    ['microphone', 'let player = AVAudioPlayer(contentsOf: url)'],
    ['microphone', 'try AVAudioSession.sharedInstance().setCategory(.playback)'],
    // El picker moderno de fotos corre fuera de proceso: no pide permiso ni purpose string.
    ['photos', 'let picker = PHPickerViewController(configuration: config)'],
    // Acelerómetro/giróscopo crudos (react-native-reanimated) no piden "Movimiento y estado físico".
    ['motionFitness', '  CMMotionManager *_motionManager;'],
    // Que el teléfono HABLE no es reconocimiento de voz.
    ['speech', 'let synth = AVSpeechSynthesizer()'],
    // El Keychain sin biometría no pide Face ID.
    ['faceid', 'SecItemAdd(query as CFDictionary, nil)'],
    ['bluetooth', 'const value = "bluetooth" // solo texto'],
  ];
  for (const [resource, line] of BENIGNOS) {
    assert.ok(
      !IOS_PROTECTED_RESOURCES[resource].symbols.test(line),
      `falso positivo del patrón de \`${resource}\` con: ${line}`,
    );
  }
});

test('FALSIFICACIÓN: la regla del TEXTO caza la clave vacía, la ausente y el genérico', () => {
  // Los tres modos de falla reales de este defecto, verificados contra la función que los juzga.
  assert.match(String(purposeStringProblem(undefined)), /no está declarada/);
  assert.match(String(purposeStringProblem('')), /VACÍA/);
  assert.match(String(purposeStringProblem('   ')), /VACÍA/);
  assert.match(String(purposeStringProblem('Esta app usa Bluetooth.')), /genérico/);
  assert.match(String(purposeStringProblem('Necesitamos acceso a tu Bluetooth porque sí, dale.')), /PARA QUÉ/);
  assert.equal(
    purposeStringProblem(
      'miTropero se conecta por Bluetooth con el bastón lector para leer las caravanas electrónicas de los animales.',
    ),
    null,
  );
});

test('PIN: la tabla de recursos es EXACTAMENTE la declarada (borrar un recurso cuesta romper dos asserts)', () => {
  // Mismo pin que `SENSORY_OWNERS` en `services/ble/feedback-guard.test.ts`: la forma barata de anular
  // este guard es borrar una fila de `IOS_PROTECTED_RESOURCES` (el módulo deja de tener hits y el
  // veredicto se vuelve "fantasma", que también avisa — pero con el diff a la vista es imposible confundirlo).
  assert.deepEqual(RESOURCE_IDS.sort(), [
    'bluetooth',
    'calendar',
    'camera',
    'contacts',
    'faceid',
    'health',
    'homekit',
    'localNetwork',
    'location',
    'mediaLibrary',
    'microphone',
    'motionFitness',
    'nfc',
    'photos',
    'reminders',
    'siri',
    'speech',
    'tracking',
  ]);
  // Toda clave es un `NS…UsageDescription` (o la de NFC, que Apple nombró distinto) y no se repite.
  const keys = RESOURCE_IDS.map((r) => IOS_PROTECTED_RESOURCES[r].key);
  assert.equal(new Set(keys).size, keys.length, 'hay dos recursos apuntando a la misma clave');
  for (const key of keys) assert.match(key, /UsageDescription$/);
  // Y todo veredicto tiene motivo escrito: una allowlist sin porqué es una lista de excepciones.
  for (const [pkg, byResource] of Object.entries(MODULE_VERDICTS)) {
    for (const [resource, verdict] of Object.entries(byResource)) {
      assert.ok(verdict && verdict.why.length > 60, `${pkg} → ${resource} está en la tabla sin un motivo escrito`);
    }
  }
});
