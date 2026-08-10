// e2e/campana-cierre.spec.ts — cierre de campaña con CICLO INCOMPLETO (delta campañas congeladas, ADR-032).
//
// POR QUÉ ESTE CAMINO Y NO OTRO. La capa de datos ya está bien cubierta por `supabase/tests/reports`
// (TR.12 inmutabilidad, TR.12b el contrafactual del gemelo abierto, TR.13 cómputo histórico, TR.14 authz y
// carreras). Lo que NINGÚN test tocaba es la UI — y ahí vive una máquina de estados propia, en
// `(tabs)/reportes.tsx`:
//
//   el reconocimiento del ciclo incompleto NO se ofrece de entrada. Recién aparece cuando el server
//   RECHAZA el primer intento con 23514, y solo si el estado dice que la campaña es cerrable con datos
//   faltantes. La decisión se toma por el ESTADO, nunca por el texto del error.
//
// Esa regla es exactamente la clase de cosa que se rompe en silencio: si alguien ofrece el ack de entrada,
// el server sigue aceptando el cierre y todos los tests backend siguen verdes — pero la app pasó a
// entrenar al usuario a apretar "cerrar igual" sin haber visto nunca qué le falta. El oráculo de acá es el
// ORDEN: primero NO está, después SÍ.
//
// Los testIDs los dejó puestos el autor del componente ("testID estable para el capture y la E2E"); esta
// es la E2E que faltaba.

import { test, expect } from './helpers/fixtures';
import {
  createTestUser,
  setUserPhone,
  seedEstablishmentWithRodeo,
  seedAnimal,
  seedReproductiveServiceEvent,
  setRodeoDataKey,
  RUN_TAG,
  cleanupAll,
} from './helpers/admin';
import { signIn, waitForHome, gotoTab } from './helpers/ui';

test.afterAll(async () => {
  await cleanupAll();
});

// ⛔ `fixme` — el TEST está escrito y su oráculo es correcto; lo que falta es el FIXTURE.
//
// Para que una hembra cuente como SERVIDA no alcanza con el evento en la ventana: la suite backend
// (`supabase/tests/reports/run.cjs`, `seedProbeScenario`) llama `backdateCategoryHistory(profileId, ENTRY)`
// ANTES de insertar la IA — la hembra tiene que haber ESTADO en una categoría elegible en la fecha de
// referencia de la campaña. Sin esa historia, el reporte muestra "0 servidas · Sin datos de esta campaña",
// no hay campaña que cerrar y el botón no aparece.
//
// Ese helper no existe del lado E2E. Lo que falta, concreto: portar `backdateCategoryHistory` a
// `e2e/helpers/admin.ts` (inserta en la tabla de historia de categoría con fecha anterior a la ventana de
// servicio) y llamarlo acá antes del `seedReproductiveServiceEvent`.
//
// Se deja `fixme` y NO `skip`: skip dice "esto no aplica", fixme dice "esto debería andar y no anda", que
// es la verdad. Y no se commitea en rojo para no estrenar el nightly con un falso negativo.
test.fixme('campaña con ciclo incompleto: el reconocimiento NO se ofrece de entrada, aparece tras el rechazo', async ({
  page,
}) => {
  test.setTimeout(180_000);

  const user = await createTestUser('camp');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Campaña', {
    rodeoName: 'Cría hembras',
    rodeoRawName: true,
    // La ventana de servicio DEBE incluir el mes corriente: el evento se siembra con fecha de hoy y, con
    // una ventana oct-dic, caía fuera de la campaña → "0 servidas · Sin datos de esta campaña".
    serviceMonths: [7, 8, 9],
  });
  // Hembra SERVIDA y sin tacto → hay campaña en curso pero el ciclo está INCOMPLETO, que es la precondición
  // del camino que se quiere probar (sin esto el cierre saldría derecho y nunca veríamos el reconocimiento).
  const profileId = await seedAnimal(establishmentId, rodeoId, {
    idv: `${RUN_TAG}-CAMP`,
    sex: 'female',
    categoryCode: 'vaquillona',
  });
  // El gating fail-closed del rodeo (spec 03 M5) rechaza una IA si `inseminacion` no está habilitada:
  // "maneuver gated: rodeo … is missing enabled data_keys {inseminacion}". El guard está bien y avisa
  // con el nombre de la clave; el fixture tiene que pedirla explícitamente.
  await setRodeoDataKey(rodeoId, 'inseminacion', true);
  // `ai` y NO `natural` a propósito: `rodeo_serviced_females` (0105) tiene dos ramas y solo la de IA cuenta
  // por el EVENTO (`extract(year from event_date) = p_year`). La de servicio natural no mira el evento —
  // infiere la servida por elegibilidad, que para una vaquillona exige el tacto de aptitud. Con `natural`
  // el reporte mostraba "0 servidas · Sin datos de esta campaña" y no había campaña que cerrar: el fixture
  // parecía razonable y no producía el estado que este test necesita.
  await seedReproductiveServiceEvent(profileId, { serviceType: 'ai' });

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);

  const stateBar = page.getByTestId('campaign-state-bar');
  await gotoTab(page, 'Reportes', stateBar);
  await expect(stateBar).toBeVisible({ timeout: 30_000 });

  // ── 1er intento: el sheet abre SIN la opción de reconocer ──────────────────────────────────────────
  await page.getByTestId('campaign-close-btn').click();
  const sheet = page.getByTestId('campaign-confirm-sheet');
  await expect(sheet).toBeVisible({ timeout: 20_000 });

  // EL ORÁCULO, primera mitad: el ack NO está disponible todavía. `toHaveCount(0)` acá es seguro porque el
  // sheet YA está montado y asertado visible — no es una ausencia evaluada en t=0 antes de que cargue nada.
  await expect(page.getByTestId('campaign-confirm-ack')).toHaveCount(0);
  await expect(page.getByTestId('campaign-confirm-primary')).toBeVisible();

  // Confirmar → el server rechaza con 23514 (ciclo incompleto).
  await page.getByTestId('campaign-confirm-primary').click();

  // ── 2do intento: recién ahora la pantalla ofrece reconocer, y dice QUÉ falta ────────────────────────
  await expect(page.getByTestId('campaign-confirm-ack')).toBeVisible({ timeout: 30_000 });
  // El detalle de lo que falta es lo que justifica pedir el reconocimiento: sin eso, "cerrar igual" sería
  // un botón a ciegas.
  await expect(page.getByTestId('campaign-confirm-missing')).toBeVisible();

  await page.getByTestId('campaign-confirm-ack').click();

  // ── La campaña quedó cerrada: la barra lo refleja y ahora ofrece REABRIR ────────────────────────────
  await expect(page.getByTestId('campaign-reopen-btn')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('campaign-close-btn')).toHaveCount(0);
});
