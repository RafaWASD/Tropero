#!/usr/bin/env node
// scripts/run-tests.mjs — orquestador de tests del repo.
//
// Corre 22 stages en orden: typecheck del cliente, unit de scripts, unit del cliente, 3 guards puros de
// Edge Functions, y 16 suites contra la base DEV remota (que se saltean si no hay service_role key).
//
// Los stages de TEST no se cortan entre sí: un rojo se acumula y la corrida sigue. Al final imprime un
// RESUMEN TOTAL que nombra a los 22 (PASS / FAIL / SKIP / NO CORRIÓ) y setea el exit code. El porqué
// está en el bloque de comentario de `createStageRunner` más abajo y en scripts/lib/stage-runner.mjs.
//
// El runner asume `node scripts/check.mjs` que ya hace chdir a repoRoot.
// Lo importa el harness desde .harness/config.json::testCommand.

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { platform } from 'node:process';

import { createStageRunner } from './lib/stage-runner.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
process.chdir(repoRoot);

// Carga .env.local (anon/service keys + project ref) en process.env.
const envLocalPath = resolve(repoRoot, '.env.local');
if (existsSync(envLocalPath)) {
  const text = readFileSync(envLocalPath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    if (m[1].startsWith('#')) continue;
    if (!(m[1] in process.env)) {
      process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
    }
  }
}

// HUSO PINEADO. Los tests corren SIEMPRE en hora argentina, en la máquina de Raf y en el runner
// de CI (que es UTC). No es cosmético: toda la clase de bugs de fecha de este proyecto vive en el
// offset −3 — el bug de `today-iso` (cargas posteriores a las 21:00 fechadas MAÑANA en una columna
// `date`) es literalmente INVISIBLE en UTC, así que correr la suite en UTC desarmaría en silencio
// los guards que lo cubren. Además hay tests que solo tienen sentido al oeste de UTC
// (`event-timeline.test.ts`, el que hizo roja la primera corrida de CI).
const TZ = 'America/Argentina/Buenos_Aires';

// ── EL ORQUESTADOR ACUMULA LOS FALLOS (2026-08-17) ──────────────────────────────────────────────────
// ANTES este `run()` llamaba a `execSync` SIN `try`. `execSync` tira cuando el comando devuelve ≠0 y
// nadie capturaba → el proceso moría en el PRIMER stage rojo y los stages siguientes NUNCA CORRÍAN. Con
// `client unit tests` en la posición 3 de 22, un rojo ahí apagaba las 16 suites de backend, que son las
// únicas que ven RLS / tenant-isolation / audit / drift de migraciones contra el remoto. Pasó de verdad
// y durante días (docs/backlog.md, entrada del 2026-08-17): el modo de falla es SILENCIO CON FORMA DE
// SEÑAL CONOCIDA — un único rojo que ya tiene explicación tapa a los 19 que no se ejecutaron.
// AHORA cada stage corre dentro de `try`, el fallo se acumula, y al final hay un RESUMEN TOTAL que
// nombra a los 22 stages declarados uno por uno (incluidos los que no corrieron). Ver
// scripts/lib/stage-runner.mjs para el razonamiento completo y el contrato con check.mjs / los CI.
//
// Flags (mutuamente excluyentes):
//   --fail-fast   corta en el primer rojo, sea cual sea (el comportamiento viejo, para loops cortos).
//   --keep-going  ignora los stages `fatal` y barre los 22 igual (ej.: querés señal de backend mientras
//                 arreglás un error de tipos).
const FAIL_FAST = process.argv.includes('--fail-fast');
const KEEP_GOING = process.argv.includes('--keep-going');
if (FAIL_FAST && KEEP_GOING) {
  console.error('run-tests.mjs: --fail-fast y --keep-going son mutuamente excluyentes. Elegí uno.');
  process.exit(2);
}

const runner = createStageRunner({
  // ÚNICO punto del archivo que ejecuta un comando. El guard estático de
  // scripts/lib/stage-runner.test.mjs exige que siga siendo único: un `execSync` suelto sería
  // exactamente la regresión que cerramos acá.
  exec: (cmd) => execSync(cmd, { stdio: 'inherit', cwd: repoRoot, env: { ...process.env, TZ } }),
  failFast: FAIL_FAST,
  keepGoing: KEEP_GOING,
  colors: Boolean(process.stdout.isTTY),
});
const run = (label, cmd, opts) => runner.run(label, cmd, opts);

const pnpmCmd = platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

// ⚠️ ÚNICO stage `fatal` del archivo, y es una decisión de COSTO, no de seguridad. Si el árbol no
// compila, el veredicto del check ya es "no" (no se commitea igual), y las 16 suites de backend cuestan
// minutos, escriben fixtures en la base DEV COMPARTIDA y suman un tercer escritor al flake conocido de
// rate-limit de auth. Gastar eso sobre un árbol a medio editar es puro costo. Abortar acá NO reintroduce
// el defecto viejo porque el resumen final igual NOMBRA los stages que no corrieron; y si querés la
// barrida completa igual, está `--keep-going`.
run('typecheck client', `cd app && ${pnpmCmd} typecheck`, { fatal: true });

// Unit tests PUROS de los scripts de ops (spec 16 Run B): resolución de target por ambiente + guarda
// destino-aware (env-target), plan del replay/ledger (ledger-plan), armado del comando de backup
// (backup-cmd). Son .mjs puros (sin red, sin RN, sin ts-ext-resolver) → corren siempre, sin keys.
//
// ⚠️ LISTA EXPLÍCITA (no hay glob): un test que no figure acá NUNCA corre.
// `scripts/lib/backup-ci-consistency.test.mjs` (rebrand Cat. H, 2026-08-17) es el guard que ata el
// NOMBRE del dump —que decide `backupFilename()` en backup-cmd.mjs— con las 6 referencias de
// `.github/workflows/backup-prod.yml` (los dos globs de gpg + los 4 nombres de artifact). Ese
// acoplamiento no lo ve NADA más: cambiar el prefijo en el script y no en el glob rompe el backup
// diario de PROD EN SILENCIO (gpg no encuentra el .sql.gz, no hay artifact, y el único síntoma es un
// job rojo a las 3 AM). El guard DERIVA el prefijo del script en vez de hardcodearlo, así que el
// próximo rename nace en rojo sin que nadie se acuerde de venir a actualizarlo. Verificarlo de verdad
// costaría disparar el workflow, que corre contra PROD.
//
// `scripts/lib/stage-runner.test.mjs` (2026-08-17) es el guard del ORQUESTADOR QUE TENÉS DELANTE: ejerce
// con un `exec` inyectado que un stage rojo no corta a los siguientes y que el resumen nombra a los 22
// (incluidos los que no corrieron), y vigila estáticamente este archivo (un solo `execSync`, ningún
// `process.exit()` que trunque el resumen, ningún stage de TEST marcado `fatal`). Va en el stage 2 —el
// SEGUNDO de 22, y no fatal— a propósito: es el único que puede avisar que el mecanismo que hace correr
// a los otros 21 se rompió.
run(
  'scripts unit tests (spec 16 Run B)',
  `node --test scripts/lib/env-target.test.mjs scripts/lib/ledger-plan.test.mjs scripts/lib/backup-cmd.test.mjs scripts/lib/backup-ci-consistency.test.mjs scripts/lib/stage-runner.test.mjs`,
);

// Tests unitarios del CLIENTE (lógica pura: validación, mapeo de errores de auth,
// lockout). node:test con type-stripping nativo de Node 24 (sin Jest; mismo patrón
// que las suites backend). No tocan red ni RN: corren siempre, sin keys de Supabase.
// --disable-warning silencia el aviso MODULE_TYPELESS_PACKAGE_JSON (no hay
// "type":"module" en app/package.json; los .ts se reparsean como ESM, es benigno).
run(
  'client unit tests',
  // ⚠️ LISTA EXPLÍCITA (no hay glob): un test que no figure acá NUNCA corre. En particular
  // `app/src/services/classify-error.test.ts` es la pata ejecutable de la aceptación del riesgo R-7
  // del delta TELÉFONO (que la PII del `DETAIL` de un 23514 no llegue al cliente) y
  // `app/src/components/phone-field-guard.test.ts` es el guard de paridad del input de teléfono —
  // un guard que no corre da falsa confianza, que es peor que no tenerlo. Los otros tres guards
  // estáticos (worklet-callbacks / safe-bottom-inset / keyboard-avoiding / sheet-keyboard-dismiss) están
  // por la misma razón: cierran bugs de CLASE que ninguna E2E puede ver desde web.
  //
  // ⚠️ `app/src/utils/nav-target-bands.test.ts` + `app/src/utils/tap-target-collision-guard.test.ts` son
  // el par que cierra el bug 🔴 del 2026-08-05 (el `hitSlop.top` del FAB de Maniobra invadiendo la banda
  // del pill del bastón y robándole los toques). Tienen que correr SIEMPRE y por un motivo estructural:
  // `hitSlop` es NO-OP en react-native-web, así que NINGUNA E2E web puede ver ese bug por comportamiento
  // — el único oráculo barato es geométrico/estático.
  //
  // ⚠️ `app/src/services/ble/feedback-guard.test.ts` + `beep-pref-cache.test.ts` son de la unidad del
  // 2026-08-06 «el bastón tiene que sonar y vibrar de verdad» (🟡-11 / 🟡-12). El primero vigila los
  // MÓDULOS sensoriales importados y que los .wav existan, sean audibles y sean DISTINTOS entre sí —
  // nada de eso lo puede ver una E2E web ni el typecheck, y el fix de 🟡-12 se anula copiando un asset
  // sobre el otro. El segundo verifica por COMPORTAMIENTO la invalidación del caché de la preferencia
  // (sacar `readBeepEnabled()` del camino caliente se puede fingir de mil formas que un regex no ve).
  //
  // ⚠️ `app/src/services/ble/stick-status-surface.test.ts` + `stick-status-surface-guard.test.ts`
  // son la unidad del 2026-08-06 «el indicador del bastón no dice lo mismo dos veces». El store fija las reglas
  // de conteo (dos superficies montadas a la vez, liberación en cualquier orden) y el guard vigila LA AUSENCIA:
  // todo call site de `useBleConnectionStatus()` tiene que declarar si reclama el lugar del indicador global.
  // Ninguna E2E los reemplaza: el modo de falla peor —atar el reclamo al MONTAJE, que deja el indicador mudo en
  // TODA la app después de visitar una tab— es invisible para un test que visita una sola pantalla.
  // `indicator-morph.test.ts` es de la misma unidad: decide CUÁNDO el indicador se estira de círculo a pill.
  // Su caso central —que el backoff de reconexión (`connecting`↔`scanning`, minutos) sea UNA sola noticia y no
  // un parpadeo permanente— no lo puede ver ninguna E2E: exigiría esperar el backoff real en el navegador.
  //
  // ⚠️ `app/src/utils/today-iso-guard.test.ts` + `current-state-tiebreak-guard.test.ts` son la unidad de
  // los 3 🔴 de corrección de datos del QA de maniobras en device (2026-08-06). Los dos cierran bugs de
  // CLASE que ningún test funcional puede ver:
  //   · today-iso: "hoy" derivado en UTC dejaba TODA la carga posterior a las 21:00 (AR, UTC−3) fechada
  //     MAÑANA en una columna `date`. 21 de las 24 horas del día el UTC y el local coinciden ⇒ cualquier
  //     corrida diurna de cualquier suite pasa verde con el bug puesto. La única señal determinista es la
  //     firma en el código, y el guard la prohíbe en TODO el árbol (no en los 4 archivos que la tenían).
  //   · current-state-tiebreak: el "valor vigente" de peso/condición desempataba dos cargas del mismo día
  //     por un UUID RANDOM (~50/50). Un test por rama no alcanza —el bug nació de arreglar UNA rama y
  //     dejar las hermanas—, así que el guard DERIVA del código la lista de ramas y exige que todas pasen
  //     la misma sonda: la rama que se agregue mañana nace en rojo.
  //   · search-idv-wiring: el 3er 🔴 de esa unidad (tipear la caravana COMO ESTÁ IMPRESA devolvía "Animal
  //     nuevo" y ofrecía duplicar el animal) no estaba en la función pura sino en QUIÉN LA CONSUME, y
  //     apareció por duplicado en los DOS motores de búsqueda. El guard deriva del árbol la lista de
  //     motores: el tercero nace en rojo hasta que consuma los términos correctos.
  //
  // ⚠️ `app/src/utils/brand-name-guard.test.ts` es de la VUELTA 2 del rebrand (2026-08-10). La vuelta 1
  // se hizo por grep de los archivos que alguien recordó y dejó la app INCOHERENTE: la home decía el
  // nombre nuevo y el login —la primera pantalla de todo usuario nuevo— el viejo, y el mail llegaba DE
  // una marca firmado por la otra. El guard escanea el ÁRBOL (no una lista), así que una pantalla nueva
  // con el nombre viejo o con otra grafía nace en rojo. Trae además la regla del DESCENDENTE: el nombre
  // nuevo tiene una `p` y el viejo era todo mayúsculas — sin `lineHeight` matching el `fontSize`,
  // Tamagui recorta la `p`, y eso NINGUNA E2E lo ve (el texto "está"), solo una captura mirada a ojo.
  //
  // ⚠️ `app/src/services/storage-keys-guard.test.ts` es el guard de las OCHO claves de storage `rafq.*`
  // (auditoría del rebrand, 2026-08-17). Son prefijos de AsyncStorage/SecureStore/localStorage que YA
  // VIVEN EN LOS DEVICES INSTALADOS: renombrarlas borra el bastón recordado (hay que re-emparejar EN LA
  // MANGA), el rodeo activo, el rastro de campos, una invitación en curso, y REINICIA EL CONTADOR DE
  // LOCKOUT. No hay OTA ni migración automática, así que el daño es irreversible y silencioso — la app
  // arranca perfecta, sin estado. `brand-name-guard` no las ve (conoce `rafaq`, con "a"; estas dicen
  // `rafq`), así que hasta hoy renombrarlas pasaba VERDE por las 22 stages. El guard declara las ocho con
  // su módulo dueño y qué se pierde, y vigila las DOS direcciones: una clave nueva hardcodeada nace en
  // rojo, y una declarada que desaparece también (con el mensaje diciendo que el rename correcto es una
  // migración, no un swap de literal). Ninguna E2E puede ver esto: el device que pierde el estado es el
  // que YA tenía la app instalada, no el navegador que arranca limpio en cada corrida.
  //
  // ⚠️ `app/ios-purpose-strings-guard.test.ts` es el guard del defecto ITMS-90683 (build 5 de iOS,
  // 2026-08-10): el bundle no declaraba NINGÚN purpose string y en iOS instanciar el manager de
  // CoreBluetooth sin `NSBluetoothAlwaysUsageDescription` ABORTA el proceso — el primer tester que abría
  // la pantalla del bastón perdía la app. Ni el typecheck ni la E2E web pueden ver eso: la única señal
  // barata es estática. El guard escanea el código nativo Apple de node_modules y exige veredicto escrito
  // por cada módulo que toque un recurso protegido, así que un módulo nuevo nace en ROJO en vez de
  // enterarnos por el validador de Apple (que cuesta un build de EAS, recurso agotable).
  //
  // ⚠️ `app/eas-profiles-guard.test.ts` + `app/src/utils/dev-crash-gate.test.ts` son el par del defecto
  // del build 5 de iOS (2026-08-10): en TestFlight, la pantalla principal mostraba el chip «crash»
  // (DEV-ONLY, cierra la app a propósito). La causa raíz no era el chip: NINGÚN perfil de `eas.json`
  // declaraba `EXPO_PUBLIC_ENV`, así que `getAppEnv()` caía a su default y TODO build —incluido
  // `production`— se creía en `development`. El primero es el guard sobre la AUSENCIA: enumera los
  // perfiles DESDE el archivo y exige que cada uno declare su ambiente, así un perfil nuevo nace en rojo
  // (lo que falló no fue un valor mal puesto, fue que nadie miraba que estuviera puesto). El segundo
  // ejerce el gate del chip por COMPORTAMIENTO —vive en un .ts propio justamente porque node:test no
  // puede importar el .tsx (es JSX)— y barre la superficie de UI (`app/app` + `src/components`) para que
  // ninguna pantalla vuelva a decidir por ambiente inline. Ni el typecheck ni la E2E web ven nada de
  // esto: la E2E corre en env `e2e` y el
  // archivo de EAS no lo mira nadie hasta que Apple o un tester avisan, y eso cuesta un build (recurso
  // agotable).
  //
  // ⚠️ Las SEIS suites del delta `ios-ble-mfi` (spec 04) van en la lista por la misma razón que el
  // resto, y una de ellas ya había nacido sin registrar: `frame-parser-resolve.test.ts` (F1) es el
  // oráculo de COMPORTAMIENTO de que el parser de trama sale del driver y no de un fallback silencioso
  // (RBM1.4/RBM1.6) — el fix que el review de F1 exigió después de que un `?? DRIVER_REGISTRY[0]
  // .frameParser` dejara todo en verde. Sin figurar acá, ese oráculo NO CORRÍA NUNCA en el check.
  // `ble-gatt-protocol.test.ts` fija las decisiones de protocolo del transporte BLE (base64 byte a byte
  // con el STX vivo, UUID normalizados, delimitador del LECTOR, reensamblado con el troceo real de
  // 20 bytes) y `adapter-ble-gatt.test.ts` ejercita la máquina de estados completa con el entorno
  // inyectado —incluidas las promesas que no resuelven nunca— que es lo único que baja el gate de
  // hardware de "todo el transporte" a "solo el stream" (RBM3.11). Ninguna E2E web puede ver nada de
  // esto: en web el binding es `serial` y no hay radio.
  // Las dos de F4: `ea-protocols.test.ts` es el ÚNICO oráculo ejecutable de RBM4.7 ("el día que llegue la
  // cadena del fabricante el diff es el DATO, cero código") y del fail-closed de la lista de protocolos —
  // sin él, el gate de MFi podría quedar diciendo `available:true` sobre un plist que iOS va a rechazar.
  // Y la de F5: `adapter-mfi-ios.test.ts` es lo único que puede medir RBM4.2 —que con la lista de
  // protocolos VACÍA el arranque en frío NO toca el módulo nativo—, y ahí no alcanza un comentario: leer
  // `NativeModules.RNBluetoothClassic` INSTANCIA el módulo en bridgeless, y en iOS cada método del nativo
  // pasa por un `CBCentralManager` lazy que puede mostrarle el diálogo de Bluetooth del SO a un operario
  // que no tocó nada. El oráculo CUENTA los toques al borde nativo (0 en frío, con control positivo). Es
  // además el único lugar donde este transporte se ejercita completo: no hay banco posible sin un accesorio
  // con licencia MFi y sin la cadena del fabricante, así que si esta suite no corre, del MFi no se sabe
  // NADA.
  // `remembered-format.test.ts` cubre la compatibilidad del formato VIEJO del bastón recordado (RBM5.7):
  // el mundo malo es un teléfono ya instalado que queda sin poder reconectar en la manga por una migración
  // de formato, y eso NO lo ve ni el typecheck (el valor viene de storage, tipado `string`) ni la E2E.
  //
  // ⚠️ `app/src/services/ble/read-dispatch.test.ts` cierra el 🔴-2 del barrido del 2026-08-06 (en
  // `maniobra/carga` la lectura VIBRABA y no la recibía nadie). Además de la decisión pura, trae DOS
  // guards estáticos que ninguna otra cosa puede dar: (a) el ORDEN dentro del provider (`.tsx`, sin
  // cobertura node:test; y en web no hay vibración, así que el E2E tampoco lo ve), y (b) la TABLA de
  // consumidores del bastón — el bug nació de una pantalla SIN el mecanismo, así que un call site nuevo
  // del listener tiene que nacer en rojo hasta que alguien decida si se auto-censura.
  //
  // ⚠️ `app/src/services/ble/line-framer.test.ts` es el fix de HIGH-1 del Gate 2 del delta `ios-ble-mfi`
  // (2026-08-17): el reensamblador de trama del transporte acumulaba SIN TOPE y su invariante no lo
  // vigilaba nada —el archivo de test no existía—. Se verificaba de refilón en `adapter-web-serial` y en
  // `ble-gatt-protocol`, los dos por el camino feliz. Mientras el único call site de producción fue web
  // (detrás del gesto obligatorio de `requestPort()`) eso era teórico; `adapter-ble-gatt` es el primero
  // NATIVO, sobre la radio y que auto-conecta sin gesto, así que un lector con otro fin de trama —el
  // `term cr` que ya se pagó en el SPP— o cualquier periférico que se haga reconocer llenaba el buffer
  // para siempre, y el daño llegaba por CPU antes que por memoria (barrido del buffer entero por
  // notificación) y se llevaba EL PROCESO: o sea la carga manual, que es ley (R7.2 / RBM9.5). La suite
  // exige las cuatro cosas que ninguna otra puede dar: que el caso legítimo (trama partida en
  // notificaciones de 20 bytes) siga reensamblando, que el chorro sin delimitador NO crezca sin límite,
  // que el descarte deje un evento DISTINGUIBLE (`framer_overflow`, no un silencio ni un
  // `connected_silent`) y que el tope no sea una opción que un call site pueda apagar.
  `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./scripts/ts-ext-resolver.mjs --test app/src/utils/phone.test.ts app/src/components/phone-field-guard.test.ts app/src/components/worklet-callbacks-guard.test.ts app/src/utils/safe-bottom-inset-guard.test.ts app/src/utils/nav-target-bands.test.ts app/src/utils/tap-target-collision-guard.test.ts app/src/components/keyboard-avoiding-guard.test.ts app/src/components/sheet-keyboard-dismiss-guard.test.ts app/src/utils/strip-comments.test.ts app/src/utils/brand-name-guard.test.ts app/src/services/storage-keys-guard.test.ts app/src/services/classify-error.test.ts app/src/utils/validation.test.ts app/src/utils/auth-errors.test.ts app/src/utils/lockout.test.ts app/src/utils/establishment.test.ts app/src/utils/establishment-mapping.test.ts app/src/utils/sort-members.test.ts app/src/utils/invite.test.ts app/src/utils/account-result.test.ts app/src/utils/rodeo-template.test.ts app/src/utils/a11y.test.ts app/src/utils/animal-identifier.test.ts app/src/utils/animal-category.test.ts app/src/utils/animal-category-picker.test.ts app/src/utils/animal-category-fields.test.ts app/src/utils/animal-birth-year.test.ts app/src/utils/link-calf-query.test.ts app/src/utils/animal-age.test.ts app/src/utils/group-actions.test.ts app/src/utils/group-page-cursor.test.ts app/src/utils/group-view-model.test.ts app/src/utils/animal-form.test.ts app/src/utils/animal-input.test.ts app/src/utils/event-timeline.test.ts app/src/utils/event-input.test.ts app/src/utils/treatment-input.test.ts app/src/utils/calf-birth.test.ts app/src/utils/bulk-candidates.test.ts app/src/utils/bulk-selection.test.ts app/src/utils/bulk-idempotency.test.ts app/src/utils/bulk-operations-plan.test.ts app/src/utils/batch-exit-selection.test.ts app/src/utils/batch-exit-plan.test.ts app/src/utils/castration-copy.test.ts app/src/utils/cut-eligibility.test.ts app/src/utils/category-pin.test.ts app/src/utils/ficha-tacto-offer.test.ts app/src/utils/identifier-assign.test.ts app/src/services/cut-service-core.test.ts app/src/services/category-pin-core.test.ts app/src/utils/selection-display.test.ts app/src/utils/vaccination-preview.test.ts app/src/utils/last-rodeo.test.ts app/src/utils/eid-format.test.ts app/src/utils/nav.test.ts app/src/utils/management-group.test.ts app/src/utils/onboarding.test.ts app/src/utils/env-resolve.test.ts app/src/utils/app-env.test.ts app/src/utils/dev-crash-gate.test.ts app/src/utils/request-id.test.ts app/src/services/observability/redact.test.ts app/src/services/observability/payloads.test.ts app/src/services/observability/env.test.ts app/app.config.test.ts app/ios-purpose-strings-guard.test.ts app/eas-profiles-guard.test.ts app/src/services/establishment-store.test.ts app/src/services/exit-animal.test.ts app/src/services/transfer-animal.test.ts app/src/services/tag-lookup.test.ts app/src/services/powersync/platform-select.test.ts app/src/services/powersync/upload-classify.test.ts app/src/services/powersync/status-derive.test.ts app/src/services/powersync/online-guard.test.ts app/src/services/powersync/first-sync.test.ts app/src/services/powersync/schema.test.ts app/src/services/powersync/local-reads.test.ts app/src/services/powersync/maneuver-reads.test.ts app/src/services/powersync/upload.test.ts app/src/services/powersync/upload-rejections.test.ts app/src/utils/maneuver-gating.test.ts app/src/utils/maneuver-gating-load.test.ts app/src/utils/maneuver-config.test.ts app/src/utils/maneuver-wizard.test.ts app/src/utils/maniobra-identify.test.ts app/src/utils/maniobra-edge.test.ts app/src/utils/maniobra-listen-state.test.ts app/src/utils/bulk-assign-empty.test.ts app/src/utils/maniobra-resume.test.ts app/src/utils/maniobra-back.test.ts app/src/utils/maneuver-step-kind.test.ts app/src/utils/maneuver-sequence.test.ts app/src/utils/maneuver-category-preview.test.ts app/src/utils/maneuver-event-query.test.ts app/src/utils/maneuver-skip.test.ts app/src/utils/maneuver-applicability.test.ts app/src/utils/vaccine-checklist.test.ts app/src/utils/repro-status.test.ts app/src/utils/lote-picker.test.ts app/src/utils/condition-stepper.test.ts app/src/utils/wheel-picker.test.ts app/src/utils/haptics.test.ts app/src/utils/hero-text-size.test.ts app/src/utils/maneuver-title-size.test.ts app/src/utils/scroll-affordance.test.ts app/src/utils/reorder-autoscroll.test.ts app/src/utils/tab-bar-insets.test.ts app/src/utils/footer-action.test.ts app/src/utils/sheet-shell.test.ts app/src/utils/sheet-gestures.test.ts app/src/utils/teeth-options.test.ts app/src/utils/custom-value.test.ts app/src/utils/custom-field.test.ts app/src/utils/custom-render.test.ts app/src/utils/service-months.test.ts app/src/utils/pregnancy-buckets.test.ts app/src/utils/calving-stage.test.ts app/src/utils/reports-format.test.ts app/src/utils/format-date-es-ar.test.ts app/src/utils/today-iso.test.ts app/src/utils/today-iso-guard.test.ts app/src/utils/current-state-tiebreak-guard.test.ts app/src/services/search-idv-wiring-guard.test.ts app/src/services/reports-online-guard.test.ts app/src/services/ble/line-framer.test.ts app/src/services/ble/parser-rs420.test.ts app/src/services/ble/dedup.test.ts app/src/services/ble/contract.test.ts app/src/services/ble/feedback.test.ts app/src/services/ble/feedback-guard.test.ts app/src/services/ble/beep-pref-cache.test.ts app/src/services/ble/adapter-mock.test.ts app/src/services/ble/adapter-web-serial.test.ts app/src/services/ble/wiring.test.ts app/src/services/ble/offline-noread.test.ts app/src/services/ble/listener-gate.test.ts app/src/services/ble/read-dispatch.test.ts app/src/services/ble/driver-registry.test.ts app/src/services/ble/selection-priority.test.ts app/src/services/ble/adapter-simulator.test.ts app/src/services/ble/demo-gate.test.ts app/src/services/ble/adapter-spp-android.test.ts app/src/services/ble/spp-protocol.test.ts app/src/services/ble/bridge-timeout.test.ts app/src/services/ble/adapter-ingest-mode.test.ts app/src/services/ble/spp-bridge-timeout-guard.test.ts app/src/services/ble/frame-parser-resolve.test.ts app/src/services/ble/ble-gatt-protocol.test.ts app/src/services/ble/adapter-ble-gatt.test.ts app/src/services/ble/ea-protocols.test.ts app/src/services/ble/adapter-mfi-ios.test.ts app/src/services/ble/remembered-format.test.ts app/src/services/ble/connect-trigger.test.ts app/src/services/ble/permissions-android.test.ts app/src/services/ble/stick-status-surface.test.ts app/src/services/ble/stick-status-surface-guard.test.ts app/src/features/ble-stick/indicator-morph.test.ts app/plugins/with-bluetooth-classic.test.ts app/src/components/ble-connection-view.test.ts app/src/features/ble-stick/connection-view.test.ts app/src/utils/import/parse-csv.test.ts app/src/utils/import/parse-sigsa-txt.test.ts app/src/utils/import/breed-senasa.test.ts app/src/utils/import/column-mapping.test.ts app/src/utils/import/normalize-row.test.ts app/src/utils/import/validate-rows.test.ts app/src/utils/import/import-write.test.ts app/src/utils/import/parse-xlsx.test.ts app/src/utils/import/import-ui.test.ts app/src/services/sigsa/sigsa-txt-generator.test.ts app/src/services/sigsa/sigsa-validator.test.ts app/src/services/sigsa/sigsa-export-service.test.ts app/src/utils/sigsa-display.test.ts app/src/utils/breed-picker.test.ts app/src/utils/renspa-validate.test.ts app/src/utils/sigsa-filters.test.ts`,
);

// spec 23 — guard del NO-LEAK del wrapper `serveEf`. `supabase/functions/_shared/serve-log.ts` es el módulo
// PURO (solo globals web: Request/Response/atob/JSON, SIN deps Deno-only) extraído de `serve.ts`: construye los
// objetos `ef_in`/`ef_out` que se loguean. Este test FALSIFICA el invariante de seguridad R2.8/R2.9 — que
// NUNCA salga el token/JWT/Authorization crudo ni el body/`message` de la respuesta (solo `bodyBytes`, el `sub`
// como `actor`, y `error.code`). Corre en el harness de node (type-stripping nativo + ts-ext-resolver), SIN
// Deno instalado. Es la MISMA función que consume `serve.ts` en producción, no un espejo. Vive fuera del bloque
// gateado por SUPABASE_SERVICE_ROLE_KEY porque es puro (no toca red ni la DB).
run(
  'serve-log no-leak guard (spec 23)',
  `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./scripts/ts-ext-resolver.mjs --test supabase/functions/_shared/serve-log.test.ts`,
);

// rebrand fase 5 — guard del RENAME EN DOS TIEMPOS de los headers propios (`X-Rafaq-*` → `X-Mitropero-*`).
// `supabase/functions/_shared/request-headers.ts` es la ÚNICA definición de los nombres; `cors.ts` DERIVA
// de ahí su `Access-Control-Allow-Headers`. Este test falsifica las tres cosas que, si se caen, se caen en
// silencio: (a) que el servidor siga leyendo el nombre VIEJO —hay builds instaladas y NO hay OTA: sin eso,
// esos clientes entran al audit con `request_id` NULL y la correlación se pierde sin síntoma—, (b) que el
// preflight permita TODOS los nombres que la EF lee (el skew de CORS de la spec 23, que en nativo no se
// ve), y (c) que ningún archivo de `supabase/functions` vuelva a hardcodear el literal (escrito sobre la
// AUSENCIA: escanea el árbol, no una lista). Puro (Request/Response/Headers), sin Deno ni keys.
run(
  'request-headers rename guard (rebrand fase 5)',
  `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./scripts/ts-ext-resolver.mjs --test supabase/functions/_shared/request-headers.test.ts`,
);

// spec 24 — helpers PUROS de la EF `audit_query` (visor forense interno). `supabase/functions/audit_query/
// query.ts` es el módulo sin deps Deno-only (solo globals JS: Date/RegExp/Set/Map) que hace el gate de
// staff (parseStaffAllowlist, FAIL-CLOSED si el secret falta) y la validación AUTORITATIVA de filtros
// (validateFilters): uuids por regex antes del cast, allowlists de table_name/op, cap de limit, guards de
// tipo en from/to. Este test FALSIFICA que un valor malformado o inyectivo NUNCA produzca un `Filtros`
// (que es lo único que db.ts liga como parámetros) y que la allowlist de staff no se abra por default. El
// runtime (index.ts/db.ts) usa Deno/Postgres.js → deploy-gated, no corre acá; su SQL 100% tagged-template
// (sin unsafe/concat) es garantía estática. Corre en el harness de node, sin Deno ni keys de Supabase.
run(
  'audit_query pure helpers (spec 24)',
  `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./scripts/ts-ext-resolver.mjs --test supabase/functions/audit_query/query.test.ts`,
);

// spec 24 delta (cloudflare-access) — helpers PUROS del gate de auth de la EF `audit_query`.
// `supabase/functions/audit_query/access-helpers.ts` es el módulo sin deps Deno-only (solo globals JS +
// TextEncoder) extraído para el swap a Cloudflare Access, aislado de `access.ts` (que importa `npm:jose`,
// Deno-only, NO importable por node). Falsifica: (a) `parseEmailAllowlist` → `null` cuando el secret está
// ausente (Access-como-autoridad, NO fail-open) y Set lowercased si poblado (RCFA.2.13); (b) el gate del
// secreto compartido Function↔EF [M-1]: FAIL-CLOSED si el env secret falta (aunque venga el header),
// comparación en TIEMPO CONSTANTE (sin early-return por contenido → no filtra bytes por timing), match
// byte-exacto. La verificación del JWT de Access (jose/JWKS, en `access.ts`) es integración deploy-gated:
// se ejerce en el smoke end-to-end del deploy (T5.5), no acá. Corre en el harness de node, sin Deno ni keys.
run(
  'audit_query access helpers (spec 24 cloudflare-access)',
  `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./scripts/ts-ext-resolver.mjs --test supabase/functions/audit_query/access-helpers.test.ts`,
);

// Las 16 suites de abajo pegan contra la base DEV REMOTA y necesitan keys de Supabase. Sin
// service_role se SALTEAN (ci.yml corre check.mjs sin keys en cada push y tiene que quedar verde) —
// pero se saltean UNA POR UNA y con nombre, no en bloque.
//
// ⚠️ POR QUÉ `db()` Y UN BLOQUE DESNUDO EN VEZ DEL `if (KEY) { … } else { … }` DE ANTES:
//   (a) el `else` imprimía una lista de suites ESCRITA A MANO que ya estaba podrida — nombraba 10 de
//       las 16 (le faltaban Reports, SIGSA, Treatments, Audit, Health y Puesta-en-servicio). Una lista
//       paralela que se pudre es la misma clase de bug que estamos cerrando: ahora el SKIP se DERIVA
//       del call site real, así que una suite nueva aparece sola en el resumen.
//   (b) el bloque desnudo `{ … }` conserva la indentación de los 16 call sites y de sus ~60 líneas de
//       comentario: el diff queda en las 16 líneas que de verdad cambian.
const db = process.env.SUPABASE_SERVICE_ROLE_KEY
  ? run
  : (label) => runner.skip(label, 'falta SUPABASE_SERVICE_ROLE_KEY en el env');
{
  db('RLS suite', `node --test supabase/tests/rls/run.cjs`);
  db('Edge Functions suite', `node --test supabase/tests/edge/run.cjs`);
  db('Animal suite (spec 02)', `node --test supabase/tests/animal/run.cjs`);
  db('Maneuvers suite (spec 03)', `node --test supabase/tests/maneuvers/run.cjs`);
  // spec 02 Stream A (modelo de puesta en servicio) — delta backend: columna service_months en rodeos +
  // CHECK (0102), camino de escritura offline owner-only/anti-IDOR + helper (0103), reescritura de
  // compute_category sin `service` (0104), contrato de derivación servidas/entoradas tenant-scoped (0105) +
  // verificación del enum heifer_fitness. La suite no-bypass cubre RPS.1-RPS.6. ✅ APLICADAS 0102-0105 al
  // remoto por el leader (2026-06-23: Gate 1 PASS + reviewer + Gate 2 + Puerta 2/3 + OK de Raf; 0102 con fix
  // del CHECK vía función immutable service_months_is_valid — subquery directa en CHECK no se permite). Corre
  // contra la DB remota.
  db('Puesta-en-servicio suite (spec 02 Stream A)', `node --test supabase/tests/puesta-en-servicio/run.cjs`);
  // spec 07 Stream C (reportes / analytics) — backend delta: las 9 RPC SQL SECURITY DEFINER de cómputo
  // server-side (0106_reports_rpcs.sql): session_event_summary / rodeo_sessions_list / rodeo_pregnancy_kpi /
  // rodeo_calving_kpi / rodeo_ccl_distribution / rodeo_calving_by_stage / rodeo_weight_by_category /
  // establishment_overdue_doses / establishment_unweighed. La suite no-bypass cubre tenant-isolation /
  // anti-IDOR (incl. M1 de las 2 alertas) / fail-closed / cotas de input (M4: p_year, p_lookback_days/p_limit,
  // p_threshold_days [0,3650], cardinality≤64) / 0-denominador sin NaN / wrap por set-membership / archivados
  // incluidos en el histórico de sesión / correctitud de cada KPI / read-only / revoke anon-public.
  // spec 07 Stream C: 0106 APLICADA al remoto por el leader (2026-06-24, vía Management API / scripts/apply-migration-mgmt.mjs;
  // reviewer APPROVED + Gate 2 PASS + OK de deploy de Raf "segui con CLI") → hook DESCOMENTADO (corre contra la DB remota).
  db('Reports suite (spec 07 Stream C)', `node --test supabase/tests/reports/run.cjs`);
  // spec 03 chunk M5 (datos/maniobras CUSTOM) — delta backend: RLS reabierta de field_definitions +
  // custom_measurements/custom_attributes + gating genérico fail-closed + validación de value por
  // ui_component + inmutabilidad + caps INPUT-1. ⚠️ DESCOMENTAR cuando el LEADER aplique 0093–0097 al
  // remoto (la suite corre contra la DB remota → fallaría antes del apply). Patrón de spec 12/14.
  db('Custom suite (spec 03 M5)', `node --test supabase/tests/custom/run.cjs`);
  // spec 03 chunk M6 (CIRCUNFERENCIA ESCROTAL) — delta backend: tabla typed scrotal_measurements (0098) +
  // data_key/seed cría (0099) + gating capa 2 fail-closed single-key (0100) + RLS + frontera WAL. La suite
  // no-bypass cubre RLS tenant / audit forzado (INSERT *y* UPDATE-path, M6-CODE-01) / gating fail-closed /
  // binding / seed cría / CHECK de rango / frontera WAL / corrección append-only / session_id tenant-check
  // (M6-SEC-02). Migraciones 0098–0100 APLICADAS al remoto (2026-06-18) → hook DESCOMENTADO (la suite corre
  // contra la DB remota; verde post-apply confirma el no-bypass / gating capa 2 / RLS / fail-closed).
  db('Scrotal/CE suite (spec 03 M6)', `node --test supabase/tests/scrotal/run.cjs`);
  // spec 14 (user_private) — enganchada por el leader tras aplicar la migración 0068 + redeploy
  // de invite_user/accept_invitation (deploy coordinado, 2026-06-04).
  // ⚠️ spec 01 delta TELÉFONO: esta suite trae además el bloque del CHECK de formato
  //    `user_private_phone_format_chk` (0126). Ese bloque se AUTO-SALTEA mientras la migración no esté
  //    aplicada al remoto (imprime un SKIP explícito) — así el resto de la suite spec 14, que no
  //    depende de 0126, sigue corriendo en verde en vez de quedar comentada entera. Tras el apply
  //    (T22), la tarea T23 exige verlo en VERDE: si sigue saliendo SKIP, la migración no entró.
  db('User_private suite (spec 14 + delta TELÉFONO)', `node --test supabase/tests/user_private/run.cjs`);
  // spec 12 (import masivo de rodeo) — backend: import_log RLS + RPC import_rodeo_bulk
  // (SECURITY DEFINER, authz cross-tenant). Enganchada por el leader tras el run de backend
  // (las migraciones 0073/0074 ya aplicadas al remoto vía Management API, 2026-06-06).
  db('Import suite (spec 12)', `node --test supabase/tests/import/run.cjs`);
  // spec 15 (no-bypass por device) — la frontera de AUTORIZACIÓN de las sync streams (T7.2 + T9.7):
  // por cada clase de stream, A no recibe la data de B, user_private es self-only, catálogos globales
  // llegan a todos, soft-deleted sale del sync set, y las tablas hijas denormalizadas (paso 2) no
  // cruzan tenant. Espejo de la RLS suite, pero sobre las streams (simulando el predicado contra
  // Postgres con el user_id de cada actor — design §7). Autocontenida (2 campos/usuarios dedicados).
  db('Sync streams no-bypass suite (spec 15)', `node --test supabase/tests/sync_streams/run.cjs`);
  // spec 10 (operaciones-rodeo) — Fase 1 backend delta: future_bull + denorm is_castrated con
  // write-through perfil->animals + propagación down con pre-filtro LIM-2 + recompute simétrico.
  // Migraciones 0084/0085/0086 ya aplicadas al remoto vía Management API (database/query).
  db('Operaciones-rodeo suite (spec 10 Fase 1)', `node --test supabase/tests/operaciones_rodeo/run.cjs`);
  // spec 08 (export SIGSA) — capa DB: breed_catalog (0107) + animal_profiles/reproductive_events.breed_id
  // (0108/0109, herencia de raza del ternero al pie en ambos caminos mono/mellizos) + establishments.renspa
  // (0110, RPC owner-gate + CHECK, sin unique) + sigsa_declarations (0111, RLS IDOR-check + declared_by
  // forzado + UNIQUE) + export_log (0112, RLS + CHECKs 5MB/255 + generated_by forzado + FK export_log_id).
  // Migraciones 0107–0112 APLICADAS al remoto por el leader vía Management API (2026-06-24).
  db('SIGSA suite (spec 08 capa DB)', `node --test supabase/tests/sigsa/run.cjs`);
  // spec 02 delta TRATAMIENTOS — capa DB: tabla treatments (header, 0123) + treatment_id FK en
  // sanitary_events + triggers (force establishment_id/created_by, inmutabilidad SEC-TRT-01, tenant-check
  // incondicional del link SEC-TRT-03) + RLS fail-closed + CHECKs de tope (SEC-TRT-02) + exención acotada del
  // gating de maniobra (RTR.2.7/2.8, LOW-1). La suite cubre fail-closed / anti-spoof establishment_id+created_by
  // / anti-IDOR 23514/23503 (INSERT+UPDATE) / ciclo iniciar-aplicar-finalizar / peón finaliza / inmutabilidad /
  // CHECKs / exención de gating / perfil inexistente 23503.
  // Migración 0123 APLICADA + verificada en el remoto (2026-07-11: tabla + treatment_id + RLS + 3 triggers +
  // gating short-circuit + revoke execute ✅) → hook DESCOMENTADO (la suite corre contra la DB remota).
  db('Treatments suite (spec 02 delta tratamientos)', `node --test supabase/tests/treatments/run.cjs`);
  // spec 18 (audit-log) — capa DB: schema `audit` vendoreado (supa_audit) con record_version append-only
  // (sin FK/CHECK) + resolve_actor total (actor real por header X-Mitropero-Actor guardado por rol
  // service_role / auth.uid(); rebrand fase 5 / 0133: se acepta además el nombre viejo X-Rafaq-Actor
  // mientras queden builds instaladas sin OTA) + trigger SECURITY DEFINER best-effort/estricto + REVOKEs
  // fail-closed + smoke-check doble
  // (EXECUTE + muro de lectura) + retención pg_cron mensual >90d. Tracking incremento 1: user_roles (estricto);
  // animals GATEADA por el gate de volumen (T12/R5.4). La suite cubre TA.1–TA.21 (actor JWT/header nuevo y
  // viejo/spoof de las dos grafías, request_id de las dos grafías, fail-closed, append-only, frontera WAL
  // por sync-streams, retención, modo de falla).
  // ⚠️ DESCOMENTAR cuando el LEADER aplique 0124 al remoto + redeploye las 4 EFs (accept_invitation,
  //    change_member_role, remove_member, delete_account). Antes del apply, esta suite FALLA (el schema audit
  //    no existe) → mismo patrón que spec 12/14/M6/tratamientos.
  db('Audit suite (spec 18)', `node --test supabase/tests/audit/run.cjs`);
  // spec 16 Run C (Edge Function `health`) — endpoint público (verify_jwt=false) que invoca la RPC
  // public.health_status() (SECURITY DEFINER, 0125) y devuelve {ok, schema_version, env}. La suite cubre
  // C4(a) 200+ok:true+schema_version prefijo 4 dígitos / C4(b) invocable sin JWT / C4(c) body ⊆
  // {ok,schema_version,env} (no leak) / C4(d) anon NO puede rpc/health_status directo (REVOKE FROM PUBLIC, M1)
  // / C4(e) el VALOR de `env` pertenece al dominio conocido, nunca 'unknown'.
  // ⚠️ C4(e) se agregó el 2026-08-17 y cierra un agujero que costó semanas de señal muda: hasta ese día
  //    el secret de ambiente NUNCA estuvo seteado en DEV y el endpoint venía diciendo `env:"unknown"`.
  //    C4(c) —que mira el JUEGO DE CLAVES— pasaba en verde con ese mismo body: está verificado corriendo
  //    la suite contra una respuesta stubeada. Un endpoint de salud que reporta mal el ambiente no se
  //    detecta mirando la FORMA del body; hay que mirar el VALOR.
  // ⚠️ DESCOMENTAR cuando el LEADER aplique 0125_health_status.sql a DEV + deploye la EF `health` a DEV
  //    (`supabase functions deploy health --no-verify-jwt`). Antes del deploy, esta suite FALLA (la EF/RPC no
  //    existen) → mismo patrón que spec 12/14/M6/tratamientos/audit. Detalle en progress/impl_16-runC.md.
  db('Health EF suite (spec 16 Run C)', `node --test supabase/tests/health/run.cjs`);
}

// El RESUMEN TOTAL: una línea por stage declarado, incluidos los que fallaron, los que se saltearon y
// los que no llegaron a correr. Es lo que reemplaza al viejo `All tests passed.` — que solo se imprimía
// cuando todo estaba verde y, cuando NO lo estaba, no decía nada (el proceso ya había muerto).
console.log(runner.summary());

// ⚠️ `process.exitCode`, NO `process.exit()`. En Windows la escritura de stdout a un PIPE es asíncrona:
// `process.exit()` puede TRUNCAR el resumen justo cuando más importa (y check.mjs lo invoca con
// stdio:'inherit', que en un pipeline es exactamente ese caso). Seteando el código y dejando terminar el
// loop de eventos, la salida se vacía completa. El contrato con check.mjs se mantiene: 0 verde, ≠0 rojo.
// Un SKIP declarado NO pinta rojo (ci.yml corre sin keys en cada push y tiene que quedar verde).
process.exitCode = runner.exitCode;
