#!/usr/bin/env node
// scripts/gradle.mjs — corre Gradle (app/android) con JDK 17, sin tocar el JAVA_HOME global.
//
// POR QUÉ EXISTE
// La máquina tiene JAVA_HOME apuntando a jdk1.8.0_172 (residuo de los JDK del banco) y
// Gradle 9.3.1 lo rechaza en seco:
//   "Gradle requires JVM 17 or later to run. Your build is currently configured to use JVM 8."
// Este script arma el env SOLO para el proceso hijo, así lo que dependa del Java 8 del banco
// sigue andando igual y no hay que cambiar ninguna variable de sistema.
//
// POR QUÉ .mjs Y NO UN .bat
// Un .bat setea variables en su propio proceso y mueren con él — no puede "cambiarle" el
// JAVA_HOME a la shell que lo invocó. Y llamarlo desde Git Bash es frágil: MSYS mangea los
// flags estilo `/c` y las reglas de comillas de `cmd /c` rompen el pasaje de argumentos
// (probado: `cmd //c wrapper.bat gradlew.bat ...` termina en "no se reconoce como comando").
// Un .mjs se invoca igual desde Bash, PowerShell y cmd, y es la convención del repo.
//
// USO
//   node scripts/gradle.mjs                          -> assembleDebug (el caso del 95%)
//   node scripts/gradle.mjs :app:assembleDebug --dry-run
//   node scripts/gradle.mjs clean assembleRelease
//
// OJO: `gradlew --version` responde IGUAL con Java 8 (lo contesta el launcher antes de forkear
// el daemon) → NO sirve para verificar que el JDK quedó bien. La prueba real es una tarea que
// configure el proyecto, ej. `:app:assembleDebug --dry-run`.

import { existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { platform } from 'node:process';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const androidDir = join(repoRoot, 'app', 'android');

const MIN_JDK = 17;

// Candidatos: la ruta conocida primero, después un escaneo de los vendors habituales por si
// Raf actualiza el JDK y la ruta fija deja de existir.
function findJdk() {
  const known = 'C:\\Program Files\\Amazon Corretto\\jdk17.0.15_6';
  if (hasJava(known)) return known;

  const roots = [
    ['C:\\Program Files\\Amazon Corretto', /^jdk(\d+)/],
    ['C:\\Program Files\\Eclipse Adoptium', /^jdk-(\d+)/],
    ['C:\\Program Files\\Microsoft', /^jdk-(\d+)/],
    ['C:\\Program Files\\Java', /^jdk-?(\d+)/],
  ];
  const found = [];
  for (const [root, re] of roots) {
    if (!existsSync(root)) continue;
    for (const name of readdirSync(root)) {
      const m = name.match(re);
      if (!m) continue;
      const major = Number(m[1]);
      const dir = join(root, name);
      if (major >= MIN_JDK && hasJava(dir)) found.push({ major, dir });
    }
  }
  // El más nuevo primero.
  found.sort((a, b) => b.major - a.major);
  return found[0]?.dir ?? null;
}

function hasJava(dir) {
  return existsSync(join(dir, 'bin', platform === 'win32' ? 'java.exe' : 'java'));
}

// No confiar en el NOMBRE de la carpeta: preguntarle a la JVM. Una carpeta "jdk17*" que
// resulte no ser 17 daría el mismo error críptico de Gradle 200 líneas después.
function javaMajor(jdk) {
  const r = spawnSync(join(jdk, 'bin', 'java'), ['-version'], { encoding: 'utf8' });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const m = out.match(/version "(\d+)[.".]/);
  return m ? Number(m[1]) : null;
}

const jdk = findJdk();
if (!jdk) {
  console.error(`[gradle.mjs] No encontré un JDK ${MIN_JDK}+ instalado.`);
  console.error('             Busqué en Amazon Corretto, Eclipse Adoptium, Microsoft OpenJDK y Java.');
  process.exit(1);
}

const major = javaMajor(jdk);
if (major === null || major < MIN_JDK) {
  console.error(`[gradle.mjs] ${jdk} reporta Java ${major ?? '?'} — Gradle necesita ${MIN_JDK}+.`);
  process.exit(1);
}

if (!existsSync(androidDir)) {
  console.error(`[gradle.mjs] No existe ${androidDir}.`);
  console.error('             app/android/ está gitignoreado: en un clone limpio hay que correr');
  console.error('             `npx expo prebuild` desde app/ antes de buildear.');
  process.exit(1);
}

const args = process.argv.slice(2);
const tasks = args.length > 0 ? args : ['assembleDebug'];
const isWin = platform === 'win32';
const gradlew = isWin ? join(androidDir, 'gradlew.bat') : join(androidDir, 'gradlew');

console.log(`[gradle.mjs] JDK ${major} → ${jdk}`);
console.log(`[gradle.mjs] gradlew ${tasks.join(' ')}`);

const opts = {
  cwd: androidDir,
  stdio: 'inherit',
  // JAVA_HOME solo para el hijo. El del sistema (Java 8 del banco) queda intacto.
  env: { ...process.env, JAVA_HOME: jdk, PATH: `${join(jdk, 'bin')};${process.env.PATH}` },
};

// ⚠️ Node >= 18.20 se NIEGA a spawnear .bat/.cmd sin `shell: true` (endurecimiento por
// CVE-2024-27980). Y no tira excepción: devuelve `r.error` con status null. Un script que
// solo mira `r.status` termina en un exit 1 mudo, sin decir por qué — pasó acá mismo.
const quote = (s) => (/[\s"^&|<>]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s);
const r = isWin
  ? spawnSync(`${quote(gradlew)} ${tasks.map(quote).join(' ')}`, { ...opts, shell: true })
  : spawnSync(gradlew, tasks, opts);

if (r.error) {
  console.error(`[gradle.mjs] no pude ejecutar gradlew: ${r.error.message}`);
  process.exit(1);
}

process.exit(r.status ?? 1);
