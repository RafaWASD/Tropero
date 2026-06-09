// database.ts — factory del DB local de PowerSync por plataforma + instancia singleton (T1.4 / R2.2).
//
// Factory por plataforma (D2 del context):
//   - Platform.OS === 'web'  → @powersync/web (wa-sqlite / WASM). Es el BANCO DE PRUEBAS de hoy.
//   - resto (device)         → @powersync/react-native (RNQS / adapter por defecto). Diferido al
//                              dev build Android (no hay device hoy; ver disclaimer R2.5/T8).
//
// La selección es por `require()` GUARDADO por Platform.OS (mismo patrón que services/ble/feedback.ts):
// así el bundle de WEB solo pulla @powersync/web y el de NATIVE solo @powersync/react-native — sin
// arrastrar el peer nativo (@journeyapps/react-native-quick-sqlite) al bundle web ni el WASM al nativo.
// Un `import` estático de ambos paquetes rompería el bundle de la plataforma contraria.
//
// La lógica de sync (connector, provider, hooks watchables) es AGNÓSTICA de plataforma: solo el
// factory difiere (design §1.3). El connect(connector)/disconnect() lo orquesta el provider (T1.7).

import { Platform } from 'react-native';
import type { AbstractPowerSyncDatabase } from '@powersync/common';

import { AppSchema } from './schema';
import { pickPowerSyncPackage } from './platform-select';

const DB_FILENAME = 'rafaq.db';

// Worker del DB pre-bundleado (UMD) servido estáticamente desde `app/public/@powersync/` por el
// dev server de Expo (publicFolder → ruta `/`). Lo copia el prebuild del script web con
// `powersync-web copy-assets --output public` (ver design §1.3 / impl_15 Hotfix Run 1.2). Esta ruta
// ROOT-ABSOLUTA es independiente del base URL del sitio y NO pasa por Metro ni por `import.meta.url`.
const WEB_DB_WORKER_URL = '/@powersync/worker/WASQLiteDB.umd.js';

function createDatabase(): AbstractPowerSyncDatabase {
  if (pickPowerSyncPackage(Platform.OS) === 'web') {
    const { PowerSyncDatabase, WASQLiteOpenFactory, WASQLiteVFS } =
      require('@powersync/web') as typeof import('@powersync/web');
    // El DB se abre con un open-factory EXPLÍCITO (no la forma "settings") porque solo el factory
    // tipa la opción `worker`. El `worker` apunta al worker UMD SERVIDO desde `public/@powersync/`
    // (no al import bundleado por Metro): el SDK hace `new Worker('/@powersync/worker/WASQLiteDB.umd.js')`
    // y ESE worker carga su propio wa-sqlite WASM (los `.wasm` copiados) vía su publicPath de webpack.
    // Así el WASM SÍ se fetchea de un dir estático servido; el path por-defecto (worker que Metro
    // bundlearía) resuelve el `.wasm` con `new URL(..., import.meta.url)`, que Metro/Hermes NO resuelve
    // → el DB se cuelga en init() ANTES de pedir credenciales (síntoma Hotfix Run 1.2). Ver design §1.3.
    // VFS = IDBBatchAtomicVFS (default): NO requiere worker dedicado → compatible con `enableMultiTabs:false`.
    const database = new WASQLiteOpenFactory({
      dbFilename: DB_FILENAME,
      vfs: WASQLiteVFS.IDBBatchAtomicVFS,
      worker: WEB_DB_WORKER_URL,
      // El factory resuelve SUS propios flags (lado DB): worker dedicado, sin multi-tab.
      flags: { useWebWorker: true, enableMultiTabs: false },
    });
    return new PowerSyncDatabase({
      schema: AppSchema,
      database,
      // Flags de NIVEL DB (consume `resolveWebPowerSyncFlags` para el lado SYNC): `enableMultiTabs:false`
      // hace que el sync use `WebStreamingSyncImplementation` IN-PROCESS (no `SharedSyncImplementation.worker.js`,
      // que sí usaría `import.meta.url`). Single-tab es aceptable en el harness web (D2). La rama native no
      // usa worker web, no se toca.
      flags: { useWebWorker: true, enableMultiTabs: false },
    });
  }
  const { PowerSyncDatabase } =
    require('@powersync/react-native') as typeof import('@powersync/react-native');
  return new PowerSyncDatabase({
    schema: AppSchema,
    database: { dbFilename: DB_FILENAME },
  });
}

let instance: AbstractPowerSyncDatabase | null = null;

/**
 * Instancia singleton del DB local de PowerSync. Lazy: se crea en el primer acceso (cuando ya
 * estamos en runtime de la plataforma, no en import-time, para no bootear el WASM/RNQS de más).
 * El boot real (.init() implícito al conectar/consultar) lo dispara el provider.
 */
export function getPowerSync(): AbstractPowerSyncDatabase {
  if (instance === null) {
    instance = createDatabase();
  }
  return instance;
}
