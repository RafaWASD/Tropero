// e2e/global-teardown.ts — barrido final de fixtures de la corrida.
//
// Cada spec limpia lo suyo en afterAll, pero este teardown global es la red de seguridad:
// borra TODO lo creado por esta corrida (usuarios @rafaq-e2e.test + establishments con el
// RUN_TAG en el nombre, vía service_role con CASCADE). Así no dejamos basura en la DB remota
// compartida con el testing manual de Raf, ni siquiera si un test crashea a mitad.

import { cleanupAll } from './helpers/admin';

export default async function globalTeardown(): Promise<void> {
  try {
    await cleanupAll();
  } catch (e) {
    // No rompemos el reporte por un fallo de cleanup; lo logueamos para que se vea.
    console.error('[e2e global-teardown] cleanup falló:', (e as Error).message);
  }
}
