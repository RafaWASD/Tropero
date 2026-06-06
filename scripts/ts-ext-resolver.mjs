// Resolver de imports extensionless para `node --test` sobre los .ts del cliente.
//
// Contexto: el cliente (app/) usa imports relativos SIN extensión (`./config`,
// `./parser-rs420`) — lo resuelve Metro (bundler) y lo acepta el typecheck
// (moduleResolution: bundler). Pero el loader ESM nativo de Node EXIGE la extensión
// explícita en specifiers relativos, así que un módulo puro testeable que value-importa
// otro módulo fuente fallaba con ERR_MODULE_NOT_FOUND bajo `node --test`.
//
// Este hook (Node 24 `module.registerHooks`, síncrono y estable) intercepta la resolución:
// si un specifier relativo (./ o ../) no resuelve tal cual, reintenta agregando `.ts`. Solo
// afecta a la resolución de los tests corridos con `--import`; NO toca el bundle de la app
// (Metro tiene su propio resolver) ni el typecheck. Mantiene los módulos fuente con imports
// extensionless (consistente con todo el repo) y habilita node:test para módulos puros que
// se importan entre sí (ej. contract.ts → dedup.ts / parser-rs420.ts).

import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

registerHooks({
  resolve(specifier, context, nextResolve) {
    const isRelative = specifier.startsWith('./') || specifier.startsWith('../');
    // Solo intervenimos en relativos SIN extensión conocida (no .ts/.js/.json/.mjs).
    if (isRelative && !/\.[a-zA-Z0-9]+$/.test(specifier)) {
      try {
        // ¿Resuelve tal cual? (ej. apunta a un dir con index, o ya existe). Si sí, no tocamos.
        return nextResolve(specifier, context);
      } catch {
        // Reintentar con .ts agregado.
        const candidate = `${specifier}.ts`;
        try {
          const resolved = nextResolve(candidate, context);
          if (resolved?.url) {
            try {
              if (existsSync(fileURLToPath(resolved.url))) return resolved;
            } catch {
              return resolved;
            }
            return resolved;
          }
        } catch {
          // cae al next por defecto abajo
        }
      }
    }
    return nextResolve(specifier, context);
  },
});
