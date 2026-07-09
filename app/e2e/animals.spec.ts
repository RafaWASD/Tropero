// e2e/animals.spec.ts — red de seguridad del flujo C2: ALTA find-or-create MANUAL + LISTA
// (spec 02 frontend + spec 09 puerta manual R1/R3/R4/R5).
//
// Corre contra el export ESTÁTICO de prod servido en :8099 + Supabase remoto (mismo patrón que
// rodeos.spec.ts). Estado de partida: usuario con teléfono (saltea gate R3.8) + 1 campo sembrado
// con 1 rodeo (aterriza en home, no en el bloqueo total de rodeo de C1).
//
// Cubre (criterios de aceptación de C2):
//   1. Empty → crear animal → aparece en la lista → abre la ficha.
//   2. Buscar un identificador INEXISTENTE → CTA "Dar de alta" → CREATE con el id precargado.
//   3. Buscar un animal EXISTENTE (sembrado) → tocar el resultado → ficha.
//
// Usuarios + campos namespaced; cleanup en afterAll + global-teardown.

import { test, expect } from './helpers/fixtures';
import {
  admin,
  anonClient,
  createTestUser,
  seedEstablishmentWithRodeo,
  seedRodeo,
  seedAnimal,
  seedCustomField,
  seedCustomAttribute,
  addMember,
  setUserPhone,
  waitForServerAnimalProfile,
  waitForServerBirth,
  waitForServerCustomAttribute,
  getServerBirthState,
  readServerProfileCategory,
  cleanupAll,
  RUN_TAG,
} from './helpers/admin';
import { signIn, waitForHome, gotoAnimales, gotoTab } from './helpers/ui';

test.afterAll(async () => {
  await cleanupAll();
});

// Helper: camina el wizard de la alta guiada desde el paso 2 (sexo) hasta el paso 4 (datos),
// eligiendo el sexo y la categoría indicados. Con 1 rodeo el wizard auto-avanza el paso 1 → arranca
// en sexo. Selectores robustos por a11y (buttonA11y emite role=button + aria-label en web).
/** Habilita el campo `apodo` (data_key='apodo') en un rodeo (fd per-est propiedad/text + rodeo_data_config
 *  enabled), espejo del seed 0119 + el opt-in del owner por rodeo. Devuelve el field_definition_id. delta IDU:
 *  un animal SIN caravana (idv/tag vacíos) sigue identificable por su Nombre/Apodo (el hero). */
async function enableApodo(establishmentId: string, rodeoId: string): Promise<string> {
  return seedCustomField(establishmentId, rodeoId, {
    label: 'Nombre/Apodo',
    dataKey: 'apodo',
    dataType: 'propiedad',
    uiComponent: 'text',
  });
}

async function walkWizardToData(
  page: import('@playwright/test').Page,
  opts: { sex: 'Macho' | 'Hembra'; categoryName: string },
) {
  // Paso 2 — sexo (full-screen).
  await expect(page.getByText('¿Es macho o hembra?', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: `Sexo ${opts.sex}`, exact: true }).click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();

  // Paso 3 — categoría (picker cerrado, filtrado por sexo+sistema).
  await expect(page.getByText('¿Qué categoría es?', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: `Categoría ${opts.categoryName}`, exact: true }).click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();

  // Paso 4 — datos.
  await expect(page.getByText('Datos del animal', { exact: true })).toBeVisible({ timeout: 20_000 });
}

test('alta guiada desde empty → wizard (sexo→categoría→datos) → el animal aparece en la lista y abre la ficha', async ({
  page,
}) => {
  const user = await createTestUser('alta');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId } = await seedEstablishmentWithRodeo(user.id, 'Campo Alta');

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);

  // fix-loop 3: en la home, el paso "Cargá tu primer animal" arranca PENDIENTE (campo sin animales)
  // — el count real es 0, no hardcodeado. Aún no debe mostrarse como hecho.
  await expect(page.getByText('Cargá tu primer animal', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Cargaste tu primer animal', { exact: true })).toHaveCount(0);

  await gotoAnimales(page);

  // Campo sin animales → empty-state con el CTA "Dar de alta tu primer animal".
  const emptyCta = page.getByRole('button', { name: 'Dar de alta tu primer animal' });
  await expect(emptyCta).toBeVisible({ timeout: 20_000 });
  await emptyCta.click();

  // Con 1 rodeo el wizard auto-avanza el paso 1 → arranca en SEXO. Elegimos Hembra → Ternera (coincide
  // con la computada para una hembra sin fecha → vaquillona NO: sin fecha computa vaquillona; acá
  // elegimos "Vaquillona" para que coincida y no haya override en este caso base).
  await walkWizardToData(page, { sex: 'Hembra', categoryName: 'Vaquillona' });

  // Paso 4: caravana visual (recomendado; el alta en blanco no precarga ningún identificador). El delta #2
  // NOMBRE/APODO removió el built-in editable "Nombre / seña" (RNA.2.1) → el idv es el identificador libre.
  const idv = `6111${Date.now().toString().slice(-6)}`;
  const idvInput = page.getByLabel('Caravana visual (recomendado)', { exact: true });
  await expect(idvInput).toBeVisible({ timeout: 20_000 });
  await idvInput.fill(idv);

  // Crear.
  await page.getByRole('button', { name: 'Crear animal', exact: true }).click();

  // R4.7: aterriza en la ficha del recién creado. La ficha tiene el bloque "Identificación" y el
  // valor visual cargado (aparece en el hero Y en la fila → .first()).
  await expect(page.getByText('Identificación', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(idv, { exact: true }).first()).toBeVisible();
  // El badge de categoría refleja la elegida ("Vaquillona") — coincide con la computada → sin override.
  await expect(page.getByText('Vaquillona', { exact: true }).first()).toBeVisible();
  // Sección Historial (C3.1) — reemplaza el teaser "Próximamente". Un animal recién creado tiene
  // solo el `initial` → empty/sparse cálido.
  await expect(page.getByText('Historial', { exact: true })).toBeVisible();

  // ── ORÁCULO de PERSISTENCIA server-side (Run create-animal-rpc). La UI de arriba muestra el OVERLAY
  // local — eso NO prueba que el alta llegó al server (el bug del backlog 2026-06-10 pasó invisible
  // exactamente por asertar solo la UI: ninguna alta aterrizaba server-side y la suite seguía verde).
  // Acá esperamos la fila REAL en animal_profiles vía admin (el drenado online de la outbox → RPC
  // create_animal 0083 corre enseguida con red).
  await waitForServerAnimalProfile(establishmentId, { idv });

  // Volvemos a la lista vía "Volver" (el create se hizo con replace → back desde la ficha cae en
  // (tabs)/Animales). El animal aparece.
  await page.getByRole('button', { name: 'Volver', exact: true }).click();
  await expect(page.getByText(idv, { exact: true }).first()).toBeVisible({ timeout: 20_000 });

  // fix-loop 3: volvemos a Inicio → el paso de animal ahora está HECHO (count real = 1, no
  // hardcodeado). useFocusEffect recarga el count al re-enfocar la home tras crear el animal.
  await gotoTab(page, 'Inicio', page.getByText(/¡Hola.*👋/));
  await expect(page.getByText('Cargaste tu primer animal', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Cargá tu primer animal', { exact: true })).toHaveCount(0);
});

test('delta aptitud (RAR.1/RAR.3/RAR.4): alta de VAQUILLONA "Sí, apta" → fila Aptitud "Apta" en la ficha + chip "Apta" en la lista', async ({
  page,
}) => {
  // RAR.1.1: el prompt de aptitud aparece SOLO para vaquillona. RAR.1.3: "Sí, apta" → tacto_vaquillona apta.
  // RAR.4.1: la ficha muestra la fila "Aptitud reproductiva" = "Apta". RAR.3.1: la lista muestra el chip único.
  const user = await createTestUser('aptitud');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo Aptitud');

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);

  await page.getByRole('button', { name: 'Dar de alta tu primer animal' }).click();
  await walkWizardToData(page, { sex: 'Hembra', categoryName: 'Vaquillona' });

  // El prompt de aptitud (RAR.1.1) está presente para la vaquillona, con las 3 opciones es-AR.
  await expect(page.getByText('¿Está apta para servicio? (opcional)', { exact: true })).toBeVisible();
  // Identificador libre = caravana visual numérica (el built-in "Nombre / seña" fue removido, delta #2 RNA.2.1).
  const idv = `6112${Date.now().toString().slice(-6)}`;
  await page.getByLabel('Caravana visual (recomendado)', { exact: true }).fill(idv);
  // Elegimos "Sí, apta" (a11y label "Aptitud Sí, apta", buttonA11y).
  await page.getByRole('button', { name: 'Aptitud Sí, apta', exact: true }).click();

  await page.getByRole('button', { name: 'Crear animal', exact: true }).click();

  // Ficha: la fila "Aptitud reproductiva" con valor "Apta" (RAR.4.1) en "Estado actual".
  await expect(page.getByText('Identificación', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Estado actual', { exact: true })).toBeVisible();
  await expect(page.getByText('Aptitud reproductiva', { exact: true })).toBeVisible();
  await expect(page.getByText('Apta', { exact: true }).first()).toBeVisible({ timeout: 20_000 });

  // Volvemos a la lista → el chip de estado reproductivo "Apta" (RAR.3.1, a11y "Estado reproductivo: Apta").
  await page.getByRole('button', { name: 'Volver', exact: true }).click();
  await expect(page.getByText(idv, { exact: true }).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByLabel('Estado reproductivo: Apta').first()).toBeVisible();
});

test('delta aptitud (RAR.1.3): alta de VAQUILLONA "Aún no sé" → fila Aptitud "Diferida" (diferida, NO servida)', async ({
  page,
}) => {
  // RAR.1.3/RAR.1.6: "Aún no sé" = diferida → la ficha muestra "Diferida"; 0105 la EXCLUYE de servidas aun con
  // edad (el veredicto explícito gana al fallback; verificado a nivel de la función 0105, que NO se modifica).
  const user = await createTestUser('diferida');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo Diferida');

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);

  await page.getByRole('button', { name: 'Dar de alta tu primer animal' }).click();
  await walkWizardToData(page, { sex: 'Hembra', categoryName: 'Vaquillona' });

  await page.getByLabel('Caravana visual (recomendado)', { exact: true }).fill(`6113${Date.now().toString().slice(-6)}`);
  await page.getByRole('button', { name: 'Aptitud Aún no sé', exact: true }).click();
  await page.getByRole('button', { name: 'Crear animal', exact: true }).click();

  await expect(page.getByText('Aptitud reproductiva', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Diferida', { exact: true }).first()).toBeVisible();
});

test('delta aptitud (RAR.1.2): el prompt de aptitud NO aparece para una categoría que no es vaquillona (ternera)', async ({
  page,
}) => {
  // RAR.1.2: el prompt está gateado por categoría. Una ternera (recría) NO lo muestra.
  const user = await createTestUser('noaptitud');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo NoAptitud');

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);

  await page.getByRole('button', { name: 'Dar de alta tu primer animal' }).click();
  await walkWizardToData(page, { sex: 'Hembra', categoryName: 'Ternera' });

  await expect(page.getByText('¿Está apta para servicio? (opcional)', { exact: true })).toHaveCount(0);
});

test('B: alta de una MULTÍPARA → el form NO pide peso, SÍ dientes/condición/preñez/cría al pie; se crea con override + condición en Estado actual', async ({
  page,
}) => {
  // Sub-chunk B (datos por categoría): una multípara NO es de recría → su form NO pide peso; pide
  // dientes + condición corporal + estado de preñez + cría al pie (tabla §2). Cargamos dientes +
  // condición + cría al pie → se crea (override=true, no derivable) y la ficha muestra "Multípara"
  // + la condición en "Estado actual".
  const user = await createTestUser('multipara');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo Multipara');

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);

  await page.getByRole('button', { name: 'Dar de alta tu primer animal' }).click();
  await walkWizardToData(page, { sex: 'Hembra', categoryName: 'Multípara' });

  // El form NO pide peso (no es recría). Y SÍ ofrece dientes/condición/preñez/cría al pie.
  await expect(page.getByLabel('Peso en kg (opcional)', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Dientes (opcional)', { exact: true })).toBeVisible();
  await expect(page.getByText('Condición corporal (opcional, 1 a 5)', { exact: true })).toBeVisible();
  await expect(page.getByText('Estado de preñez (opcional)', { exact: true })).toBeVisible();
  await expect(page.getByText('Cría al pie (opcional)', { exact: true })).toBeVisible();

  // Identificación (caravana visual) + dientes + condición 3 + con cría al pie.
  await page.getByLabel('Caravana visual (recomendado)', { exact: true }).fill(`6114${Date.now().toString().slice(-6)}`);
  await page.getByRole('button', { name: 'Dientes Boca llena', exact: true }).click();
  // Condición por STEPPER (delta #13): arranca "sin cargar" en 3,00 (atenuado) → + y − la cargan en 3,00.
  await page.getByTestId('score-plus').click();
  await page.getByTestId('score-minus').click();
  await expect(page.getByTestId('score-display').getByText('3,00', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cría al pie Con cría al pie', exact: true }).click();

  await page.getByRole('button', { name: 'Crear animal', exact: true }).click();

  // Delta #15 (RCAP.1.1): la vaca se creó CON cría al pie (nursing=true) → aparece el prompt SALTABLE de
  // vinculación ANTES de navegar. Acá no vinculamos (la cría al pie se prueba aparte); "Ahora no" cierra el
  // prompt y sigue a la ficha (la vaca queda intacta con nursing=true, RCAP.1.3/1.4).
  await expect(page.getByText('¿Vincular su cría al pie?', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Ahora no', exact: true }).click();

  // Ficha: badge "Multípara" (override, no derivable) + condición corporal en "Estado actual".
  await expect(page.getByText('Identificación', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Multípara', { exact: true }).first()).toBeVisible();
  // El override se refleja en el a11y label del badge ("fijada manualmente").
  await expect(
    page.getByLabel('Categoría Multípara, fijada manualmente', { exact: true }).first(),
  ).toBeVisible();
  // La condición corporal cargada al alta quedó como EVENTO post-create → aparece su valor "3 / 5" en
  // "Estado actual" (deriveCurrentState lo deriva del condition_score_event recién insertado). El valor
  // es la prueba real de que el evento se guardó (el label "Condición corporal" lo renderiza RN-web en
  // div+span anidados → matchea 2 nodos en strict mode; asertamos el VALOR, que es único y diagnóstico).
  await expect(page.getByText('Estado actual', { exact: true })).toBeVisible();
  await expect(page.getByText(/3 \/ 5/).first()).toBeVisible({ timeout: 20_000 });
});

test('B: alta de un TERNERO → el form pide PESO, NO dientes/preñez', async ({ page }) => {
  // Sub-chunk B: un ternero es de recría → su form pide SOLO peso (de los extra); no dientes ni preñez.
  const user = await createTestUser('ternerob');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo TerneroB');

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);

  await page.getByRole('button', { name: 'Dar de alta tu primer animal' }).click();
  await walkWizardToData(page, { sex: 'Macho', categoryName: 'Ternero' });

  // Pide peso; NO pide dientes ni preñez.
  await expect(page.getByLabel('Peso en kg (opcional)', { exact: true })).toBeVisible();
  await expect(page.getByText('Dientes (opcional)', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Estado de preñez (opcional)', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Condición corporal (opcional, 1 a 5)', { exact: true })).toHaveCount(0);

  // Cargamos identificación (caravana visual) + peso → se crea.
  await page.getByLabel('Caravana visual (recomendado)', { exact: true }).fill(`6115${Date.now().toString().slice(-6)}`);
  await page.getByLabel('Peso en kg (opcional)', { exact: true }).fill('180');

  await page.getByRole('button', { name: 'Crear animal', exact: true }).click();

  await expect(page.getByText('Identificación', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Ternero', { exact: true }).first()).toBeVisible();
  // El peso de alta (entry_weight) NO es un weight_event → "Estado actual / Peso actual" queda
  // "Sin registrar" (el peso de entrada vive en la columna, no en el timeline). Un macho NO muestra
  // la fila "Estado reproductivo".
  await expect(page.getByText('Estado reproductivo', { exact: true })).toHaveCount(0);
});

test('B: alta de una VAQUILLONA PREÑADA con preñez "Cabeza" → estado reproductivo Preñada (cabeza) + badge SIN override (derivable)', async ({
  page,
}) => {
  // Sub-chunk B + override refinado: elegir vaquillona_prenada Y capturar preñez "Cabeza" (large) →
  // es DERIVABLE (un tacto+ la transiciona server-side) → override=FALSE. El tacto+ se crea post-create
  // → la ficha muestra "Estado reproductivo: Preñada (cabeza)" y el badge "Vaquillona preñada" SIN la
  // marca de override.
  const user = await createTestUser('vaqprenada');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo VaqPrenada');

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);

  await page.getByRole('button', { name: 'Dar de alta tu primer animal' }).click();
  await walkWizardToData(page, { sex: 'Hembra', categoryName: 'Vaquillona preñada' });

  // El form de vaquillona preñada pide preñez + condición; NO peso ni dientes ni cría al pie.
  await expect(page.getByText('Estado de preñez (opcional)', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Peso en kg (opcional)', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Dientes (opcional)', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Cría al pie (opcional)', { exact: true })).toHaveCount(0);

  await page.getByLabel('Caravana visual (recomendado)', { exact: true }).fill(`6116${Date.now().toString().slice(-6)}`);
  await page.getByRole('button', { name: 'Preñez Cabeza', exact: true }).click();

  await page.getByRole('button', { name: 'Crear animal', exact: true }).click();

  // Ficha: estado reproductivo "Preñada (cabeza)" (del tacto+ post-create) + badge "Vaquillona preñada"
  // SIN override (a11y label sin "fijada manualmente").
  await expect(page.getByText('Identificación', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Estado reproductivo', { exact: true })).toBeVisible();
  await expect(page.getByText(/Preñada \(cabeza\)/).first()).toBeVisible({ timeout: 20_000 });
  // Badge derivable → SIN "fijada manualmente".
  await expect(
    page.getByLabel('Categoría Vaquillona preñada', { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByLabel('Categoría Vaquillona preñada, fijada manualmente', { exact: true }),
  ).toHaveCount(0);
});

test('alta guiada: elegir una categoría que DIFIERE de la computada → override (Multípara con fecha vieja)', async ({
  page,
}) => {
  // Caso A5 "vaca comprada": una hembra con fecha de nacimiento vieja computa Vaquillona, pero el
  // usuario la da de alta como Multípara (comprada sin historial cargado). Como difiere → override:
  // el recálculo del server NO la revierte a vaquillona; la ficha muestra el badge "Multípara".
  const user = await createTestUser('override');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo Override');

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);

  await page.getByRole('button', { name: 'Dar de alta tu primer animal' }).click();

  // SEXO Hembra → CATEGORÍA Multípara (en el picker de hembra; no aparece para macho).
  await walkWizardToData(page, { sex: 'Hembra', categoryName: 'Multípara' });

  // Identificación + año de nacimiento VIEJO (computaría vaquillona) → override aplica (la multípara
  // no es derivable del alta, así que el override es true por code; el año viejo refuerza el caso).
  await page.getByLabel('Caravana visual (recomendado)', { exact: true }).fill(`6117${Date.now().toString().slice(-6)}`);
  await page.getByLabel('Año de nacimiento (opcional, AAAA)', { exact: true }).fill('2020');

  await page.getByRole('button', { name: 'Crear animal', exact: true }).click();

  // Ficha: el badge muestra la categoría ELEGIDA ("Multípara"), NO la computada (vaquillona) → el
  // override preservó la elección. (El badge "Multípara" en el hero confirma category_id + el punto
  // de override sutil no es asertable por texto; basta con la categoría elegida.)
  await expect(page.getByText('Identificación', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Multípara', { exact: true }).first()).toBeVisible();
  // Y NUNCA muestra "Vaquillona" (la computada): si el override hubiera fallado, el server la habría
  // dejado como vaquillona o el recálculo la revertiría.
  await expect(page.getByText('Vaquillona', { exact: true })).toHaveCount(0);
});

test('alta guiada: elegir la categoría que COINCIDE con la computada → sin override (vaquillona sin año)', async ({
  page,
}) => {
  // Una hembra SIN año de nacimiento computa Vaquillona (default conservador); el usuario elige
  // "Vaquillona" → coincide → sin override (auto-transiciona después). (No usamos un año reciente para
  // "ternera" porque el year-only se mapea a AAAA-07-01 — mitad de año — y la edad respecto al corte de
  // 1 año queda ambigua según el mes actual; el caso "sin año → vaquillona coincide" es determinista.)
  const user = await createTestUser('coincide');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo Coincide');

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);

  await page.getByRole('button', { name: 'Dar de alta tu primer animal' }).click();

  await walkWizardToData(page, { sex: 'Hembra', categoryName: 'Vaquillona' });

  await page.getByLabel('Caravana visual (recomendado)', { exact: true }).fill(`6118${Date.now().toString().slice(-6)}`);
  // Sin año → hembra computa vaquillona → coincide con la elegida → sin override.

  await page.getByRole('button', { name: 'Crear animal', exact: true }).click();

  await expect(page.getByText('Identificación', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Vaquillona', { exact: true }).first()).toBeVisible();
  // Coincide → SIN override (a11y label sin "fijada manualmente").
  await expect(page.getByLabel('Categoría Vaquillona', { exact: true }).first()).toBeVisible();
  await expect(
    page.getByLabel('Categoría Vaquillona, fijada manualmente', { exact: true }),
  ).toHaveCount(0);
});

test('fix-loop 4: con un 2do miembro sembrado, el paso de equipo de la home aparece HECHO', async ({
  page,
}) => {
  // Owner con teléfono (saltea el gate R3.8) + 1 campo con rodeo (aterriza en home).
  const owner = await createTestUser('teamowner');
  await setUserPhone(owner.id, '1123456789');
  const { establishmentId } = await seedEstablishmentWithRodeo(owner.id, 'Campo Equipo');
  // Sembramos un SEGUNDO miembro activo (un vet) en el campo → señal de "equipo iniciado" real.
  const member = await createTestUser('teammember');
  await addMember(member.id, establishmentId, 'veterinarian');

  await page.goto('/');
  await signIn(page, owner);
  await waitForHome(page);

  // El paso de equipo se drivea por estado real (countTeam: ≥1 otro miembro): como hay un 2do miembro
  // sembrado, debe mostrarse HECHO ("Tu equipo está en marcha") y NO el pendiente "Invitá a tu vet o
  // capataz". Si el paso siguiera hardcodeado `future`, este assert fallaría (= el bug original).
  await expect(page.getByText('Tu equipo está en marcha', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Invitá a tu vet o capataz', { exact: true })).toHaveCount(0);
});

test('fix-loop 4: sin equipo, el paso de equipo de la home arranca PENDIENTE', async ({ page }) => {
  // Owner SOLO (sin otros miembros ni invitaciones pendientes) → el paso de equipo arranca pendiente.
  const owner = await createTestUser('soloowner');
  await setUserPhone(owner.id, '1123456789');
  await seedEstablishmentWithRodeo(owner.id, 'Campo Solo');

  await page.goto('/');
  await signIn(page, owner);
  await waitForHome(page);

  // count real = 0 otros miembros + 0 pendientes → paso pendiente, NO hecho.
  await expect(page.getByText('Invitá a tu vet o capataz', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Tu equipo está en marcha', { exact: true })).toHaveCount(0);
});

test('buscar un identificador INEXISTENTE → CTA "Dar de alta" → CREATE con el id precargado', async ({
  page,
}) => {
  const user = await createTestUser('nomatch');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo NoMatch');

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);

  // Tipeamos un identificador numérico que no existe → tras el debounce, no-match.
  const search = page.getByLabel('Buscar animal por caravana o número', { exact: true });
  await search.fill('77123');

  const cta = page.getByRole('button', { name: 'Dar de alta este animal' });
  await expect(cta).toBeVisible({ timeout: 20_000 });
  await cta.click();

  // El find-or-create NO cambia: el id tipeado se precarga. El wizard arranca DESPUÉS del id; con 1
  // rodeo auto-avanza a SEXO. El header muestra "Creando: 77123" (el id precargado) en todos los pasos.
  await expect(page.getByText('Creando: 77123', { exact: true })).toBeVisible({ timeout: 20_000 });

  // Caminamos hasta el paso de DATOS, donde está la identificación.
  await walkWizardToData(page, { sex: 'Macho', categoryName: 'Ternero' });

  // CREATE: como el texto es numérico/estructurado (R1.4), se precarga en idv READ-ONLY.
  const idvReadonly = page.getByLabel('Caravana visual (no editable)', { exact: true });
  await expect(idvReadonly).toBeVisible({ timeout: 20_000 });
  await expect(idvReadonly).toHaveValue('77123');
  // Y NO debe haber un input editable de IDV (el precargado ocupa ese rol).
  await expect(page.getByLabel('Caravana visual (recomendado)', { exact: true })).toHaveCount(0);
});

test('buscar un animal EXISTENTE → tocar el resultado → ficha', async ({ page }) => {
  const user = await createTestUser('existe');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Existe');
  // Sembramos un animal con un IDV único y buscable.
  const idv = `9911${Date.now().toString().slice(-5)}`;
  await seedAnimal(establishmentId, rodeoId, { idv, sex: 'female' });

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  // Blindaje anti-flash de onboarding (fix showstopper): el usuario SÍ tiene un campo sembrado, así que
  // tras aterrizar en home NO debe quedar ningún CTA de "Crear mi primer campo" (el bug era aterrizar en
  // onboarding porque el gate leía el SQLite local vacío antes de bajar el first-sync).
  await expect(page.getByRole('button', { name: 'Crear mi primer campo' })).toHaveCount(0);
  await gotoAnimales(page);

  // El animal aparece en la lista (carga inicial).
  await expect(page.getByText(idv, { exact: true }).first()).toBeVisible({ timeout: 20_000 });

  // Buscar por el IDV exacto → el resultado aparece; tocarlo abre la ficha.
  const search = page.getByLabel('Buscar animal por caravana o número', { exact: true });
  await search.fill(idv);

  // Tocamos la fila del resultado (el AnimalRow es un button con el idv en su a11y label).
  const row = page.getByRole('button', { name: new RegExp(idv) }).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.click();

  // Ficha del animal: bloque "Datos del animal" + el IDV en "Identificación" (aparece en el
  // título del header Y en la fila → .first()).
  await expect(page.getByText('Datos del animal', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(idv, { exact: true }).first()).toBeVisible();
});

test('fix-loop 2: buscar por un PREFIJO de la caravana electrónica encuentra el animal', async ({
  page,
}) => {
  const user = await createTestUser('caravprefix');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Caravana');
  // Sembramos un animal con caravana electrónica FDX-B de 15 díg + un IDV distinto. La búsqueda
  // será por un PREFIJO de la caravana (no 15 díg, no exacto) → debe encontrarlo por substring.
  const tag = `03200${Date.now().toString().slice(-10)}`.slice(0, 15).padEnd(15, '0');
  const prefix = tag.slice(0, 5); // los primeros 5 díg de la caravana — un prefijo parcial
  const idv = `8822${Date.now().toString().slice(-5)}`;
  await seedAnimal(establishmentId, rodeoId, { idv, tag, sex: 'male' });

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);

  // El animal aparece en la lista (carga inicial) — se identifica por su IDV.
  await expect(page.getByText(idv, { exact: true }).first()).toBeVisible({ timeout: 20_000 });

  // Buscamos por un PREFIJO de la caravana electrónica (substring, no exacto de 15 díg). Antes del
  // fix daba "no encontramos"; ahora debe matchear por substring de tag_electronic.
  const search = page.getByLabel('Buscar animal por caravana o número', { exact: true });
  await search.fill(prefix);

  // El resultado aparece (no el empty "No encontramos"). El AnimalRow lleva el idv en su a11y label.
  const row = page.getByRole('button', { name: new RegExp(idv) }).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(new RegExp(`No encontramos`))).toHaveCount(0);
});

test('FIX2: el alta LIMITA los inputs en vivo (caravana 15 díg, fecha/peso sin basura) y rechaza submit inválido', async ({
  page,
}) => {
  const user = await createTestUser('limites');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo Limites');

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);

  await page.getByRole('button', { name: 'Dar de alta tu primer animal' }).click();

  // El sexo y la categoría ahora son pasos del wizard (no inputs de texto) → se eligen, no se "limitan".
  // Caminamos al paso de DATOS, donde están los inputs de texto que SÍ se acotan en vivo.
  await walkWizardToData(page, { sex: 'Macho', categoryName: 'Torito' });

  // Año de nacimiento: tipeamos basura → solo 4 dígitos numéricos (year-only, sub-chunk B).
  const yearInput = page.getByLabel('Año de nacimiento (opcional, AAAA)', { exact: true });
  await yearInput.fill('asdasd');
  await expect(yearInput).toHaveValue(''); // nada de "asdasd"
  await yearInput.fill('20240115');
  await expect(yearInput).toHaveValue('2024'); // cortado a 4 dígitos

  // Peso (el torito es recría → pide peso): tipeamos basura → solo número decimal.
  const weightInput = page.getByLabel('Peso en kg (opcional)', { exact: true });
  await weightInput.fill('dasdas');
  await expect(weightInput).toHaveValue('');
  await weightInput.fill('180');
  await expect(weightInput).toHaveValue('180');

  // Caravana electrónica (delta bastoneo-captura-alta-parto, RCF.6 generalizado al alta): YA NO hay un campo
  // tipeable suelto en el form — se captura vía el CTA "Bastonear la caravana (opcional)" que abre el
  // TagScanSheet. La carga MANUAL del EID + su límite en vivo (15 díg) viven DENTRO del sheet, detrás de
  // "¿Sin bastón?" (sin mock BLE, el transporte web-serial cae al hero "Conectá el bastón" con ese link).
  await expect(page.getByLabel('Caravana electrónica (recomendado, 15 dígitos)', { exact: true })).toHaveCount(0);
  await page.getByTestId('tag-scan-open').click();
  await expect(page.getByTestId('tag-scan-sheet')).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('tag-scan-manual-link').click();
  await expect(page.getByTestId('tag-scan-manual')).toBeVisible({ timeout: 10_000 });
  const tagInput = page.getByLabel('Caravana electrónica', { exact: true });
  // Límite en vivo: letras + 40 dígitos → SOLO 15 dígitos (FDX-B).
  await tagInput.fill('abc1234567890123456789012345');
  await expect(tagInput).toHaveValue('123456789012345');
  // Caravana INCOMPLETA (8 díg) → "Usar caravana" muestra el error de largo y NO cierra (fail-closed).
  await tagInput.fill('12345678'); // 8 díg < 15
  await page.getByTestId('tag-scan-manual-assign').click();
  await expect(page.getByText('La caravana electrónica tiene que tener 15 dígitos.')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('tag-scan-manual')).toBeVisible(); // sigue en la carga manual del sheet
  // Cerramos el sheet: seguimos en el paso de datos del wizard (no aterrizó en una ficha — la ficha tiene "Historial").
  await page.getByTestId('tag-scan-close').click();
  await expect(page.getByTestId('tag-scan-sheet')).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByText('Historial', { exact: true })).toHaveCount(0);
});

test('C3.3 baja: owner da de baja (Venta) → desaparece de la tab Animales y la ficha queda archivada ("Vendido")', async ({
  page,
}) => {
  // Estado de partida: owner + campo con rodeo + 1 animal ACTIVO sembrado, identificable por su IDV.
  // El owner gatea el botón "Dar de baja" por la rama owner (created_by del seed es null — el
  // service_role no tiene auth.uid() —, así que la rama de autor no aplica; la de owner sí, R4.14).
  const user = await createTestUser('baja');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Baja');
  const idv = `4411${Date.now().toString().slice(-5)}`;
  await seedAnimal(establishmentId, rodeoId, { idv, sex: 'female' });

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);

  // El animal aparece en la lista (activo) → tocarlo abre la ficha.
  const row = page.getByRole('button', { name: new RegExp(idv) }).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.click();

  // Ficha del animal activo: el botón "Dar de baja" está visible (owner del campo del animal). El
  // animal recién sembrado tiene la sección Historial; NO tiene badge de archivada todavía.
  await expect(page.getByText('Historial', { exact: true })).toBeVisible({ timeout: 20_000 });
  const exitBtn = page.getByRole('button', { name: 'Dar de baja', exact: true });
  await expect(exitBtn).toBeVisible();
  await exitBtn.click();

  // Paso 1 del sheet de baja: elegimos "Venta" (la card con su a11y label = el título).
  await expect(page.getByText('¿Qué pasó con este animal?', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Venta', exact: true }).click();

  // Paso 2: la fecha viene precargada con hoy; la Venta ofrece peso + precio OPCIONALES. Cargamos
  // un peso de salida (opcional) para ejercer el path de datos de venta, y confirmamos.
  const weightInput = page.getByLabel('Peso de salida en kg (opcional)', { exact: true });
  await expect(weightInput).toBeVisible({ timeout: 20_000 });
  await weightInput.fill('380');
  // El precio queda vacío (opcional) → no debe bloquear la baja.

  // El botón destructivo "Dar de baja" del paso 2 (el del paso 1 era "Venta"/cards; acá el CTA fijo).
  await page.getByRole('button', { name: 'Dar de baja', exact: true }).click();

  // De vuelta en la ficha (in-situ): modo archivada → badge "Vendido el …" + el botón "Dar de baja"
  // YA NO está (el animal está de baja) + "Agregar evento" tampoco.
  await expect(page.getByText(/Vendido el /).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Dar de baja', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Agregar evento', exact: true })).toHaveCount(0);

  // Volvemos a la tab Animales → el animal vendido YA NO aparece (la lista filtra status='active').
  await page.getByRole('button', { name: 'Volver', exact: true }).click();
  await expect(page.getByLabel('Buscar animal por caravana o número', { exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByRole('button', { name: new RegExp(idv) })).toHaveCount(0);

  // Pero SÍ aparece si filtramos por "Vendidos" (sigue archivado y visible, R4.12/R4.15).
  await page.getByRole('button', { name: 'Filtrar por estado' }).click();
  await page.getByRole('button', { name: 'Vendidos', exact: true }).click();
  await expect(page.getByText(idv, { exact: true }).first()).toBeVisible({ timeout: 20_000 });
});

// ─── Delta alta-form-refinamiento (#3 fecha DD/MM separada del año · #13 condición stepper · #14 destildar) ──
//
// RAF2.1 (fecha DD/MM), RAF2.2/RAF2.3.2/2.3.3 (condición por stepper con tri-estado), RAF2.3.1 (re-tap
// deselecciona los opcionales). Oráculos server-side: birth_date exacta vs midpoint (tabla animals);
// condición persiste / NO persiste (condition_score_events sin session_id, vienen del alta post-create).

/** Pollea `animals.birth_date` (la fecha vive en `animals`, no en `animal_profiles`) por animal_id. */
async function readServerBirthDate(animalId: string): Promise<string | null> {
  for (let i = 0; i < 30; i++) {
    const { data, error } = await admin
      .from('animals')
      .select('birth_date')
      .eq('id', animalId)
      .maybeSingle();
    if (error) throw new Error(`readServerBirthDate: ${error.message}`);
    if (data?.birth_date) return data.birth_date as string;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return null;
}

/** Cuenta los condition_score_events del alta (sin session_id) de un perfil. */
async function countConditionScores(profileId: string): Promise<{ count: number; scores: number[] }> {
  const { data, error } = await admin
    .from('condition_score_events')
    .select('score')
    .eq('animal_profile_id', profileId)
    .is('deleted_at', null);
  if (error) throw new Error(`countConditionScores: ${error.message}`);
  return { count: data?.length ?? 0, scores: (data ?? []).map((r) => r.score as number) };
}

test('delta #3 (RAF2.1.4): alta con Año + DD/MM → birth_date EXACTA (AAAA-MM-DD)', async ({ page }) => {
  test.setTimeout(120_000); // alta + 2 polls server (perfil + birth_date) → headroom sobre el default 60s.
  const user = await createTestUser('ddmmexact');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId } = await seedEstablishmentWithRodeo(user.id, 'Campo DDMMExact');

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);

  await page.getByRole('button', { name: 'Dar de alta tu primer animal' }).click();
  await walkWizardToData(page, { sex: 'Hembra', categoryName: 'Vaquillona' });

  // Identificador = caravana visual numérica (el built-in "Nombre / seña" fue removido, delta #2 RNA.2.1);
  // el oráculo server matchea por idv.
  const idv = `6131${Date.now().toString().slice(-6)}`;
  await page.getByLabel('Caravana visual (recomendado)', { exact: true }).fill(idv);
  await page.getByLabel('Año de nacimiento (opcional, AAAA)', { exact: true }).fill('2022');
  // El sanitizer en vivo formatea "1503" → "15/03" (día-primero es-AR).
  const dm = page.getByLabel('Día y mes (opcional, DD/MM)', { exact: true });
  await dm.fill('0107');
  await expect(dm).toHaveValue('01/07');

  await page.getByRole('button', { name: 'Crear animal', exact: true }).click();

  // "Historial" sólo existe en la FICHA (no en el form) → confirma que el alta navegó (create OK).
  await expect(page.getByText('Historial', { exact: true })).toBeVisible({ timeout: 20_000 });
  const { animal_id } = await waitForServerAnimalProfile(establishmentId, { idv });
  expect(await readServerBirthDate(animal_id)).toBe('2022-07-01');
});

test('delta #3 (RAF2.1.3): alta SOLO con Año (sin DD/MM) → birth_date midpoint AAAA-07-01', async ({
  page,
}) => {
  test.setTimeout(120_000); // alta + 2 polls server (perfil + birth_date) → headroom sobre el default 60s.
  const user = await createTestUser('ddmmmid');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId } = await seedEstablishmentWithRodeo(user.id, 'Campo DDMMMid');

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);

  await page.getByRole('button', { name: 'Dar de alta tu primer animal' }).click();
  await walkWizardToData(page, { sex: 'Hembra', categoryName: 'Vaquillona' });

  const idv = `6132${Date.now().toString().slice(-6)}`;
  await page.getByLabel('Caravana visual (recomendado)', { exact: true }).fill(idv);
  await page.getByLabel('Año de nacimiento (opcional, AAAA)', { exact: true }).fill('2022');
  // Sin tocar el campo DD/MM → midpoint (no se rompe el camino año-solo).

  await page.getByRole('button', { name: 'Crear animal', exact: true }).click();

  await expect(page.getByText('Historial', { exact: true })).toBeVisible({ timeout: 20_000 });
  const { animal_id } = await waitForServerAnimalProfile(establishmentId, { idv });
  expect(await readServerBirthDate(animal_id)).toBe('2022-07-01');
});

test('delta override-imputación: macho "Torito" con SOLO el año (borde 2 años) → categoría NO flipeada + category_override=false', async ({
  page,
}) => {
  test.setTimeout(120_000); // alta + 2 polls server (perfil + categoría) → headroom sobre el default 60s.
  const user = await createTestUser('imputetorito');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId } = await seedEstablishmentWithRodeo(user.id, 'Campo ImputeTorito');

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);

  await page.getByRole('button', { name: 'Dar de alta tu primer animal' }).click();
  await walkWizardToData(page, { sex: 'Macho', categoryName: 'Torito' });

  // Año = hace 2 años (borde del corte de 2 años). El midpoint CIEGO 'AAAA-07-01' caería ≈2 años → el
  // server computaría "toro" y, con override=false, el cron nocturno FLIPEARÍA la elección a toro. La
  // imputación consciente de la categoría (delta) elige un día del cruce [1,2) años → compute da "torito"
  // → override=false SIN flip. Año dinámico para que el test no envejezca.
  const year = new Date().getFullYear() - 2;
  const idv = `6134${Date.now().toString().slice(-6)}`;
  await page.getByLabel('Caravana visual (recomendado)', { exact: true }).fill(idv);
  await page.getByLabel('Año de nacimiento (opcional, AAAA)', { exact: true }).fill(String(year));
  // Sin DD/MM → year-only → dispara la imputación consciente de la categoría.

  await page.getByRole('button', { name: 'Crear animal', exact: true }).click();

  // Aterriza en la ficha (create OK) y el badge muestra la categoría ELEGIDA (Torito), no la flipeada.
  await expect(page.getByText('Historial', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Torito', { exact: true }).first()).toBeVisible();

  // ORÁCULO server: la categoría almacenada = Torito y category_override=FALSE (auto-avanza sin flip). Sin
  // el fix, el midpoint ciego daría category_override=TRUE (la elección quedaría pineada/congelada).
  const { id: profileId } = await waitForServerAnimalProfile(establishmentId, { idv });
  const { categoryOverride, categoryCode } = await readServerProfileCategory(profileId);
  expect(categoryCode).toBe('torito');
  expect(categoryOverride).toBe(false);
});

test('delta override-imputación: macho "Ternero" con SOLO el año en curso → ternero consistente + category_override=false', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const user = await createTestUser('imputeternero');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId } = await seedEstablishmentWithRodeo(user.id, 'Campo ImputeTernero');

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);

  await page.getByRole('button', { name: 'Dar de alta tu primer animal' }).click();
  await walkWizardToData(page, { sex: 'Macho', categoryName: 'Ternero' });

  // Año en curso → un ternero (<1 año). La imputación cae dentro del cruce [0,1) año ∩ año en curso ∩
  // pasado → compute da "ternero" → override=false (la categoría elegida coincide con la derivable).
  const year = new Date().getFullYear();
  const idv = `6135${Date.now().toString().slice(-6)}`;
  await page.getByLabel('Caravana visual (recomendado)', { exact: true }).fill(idv);
  await page.getByLabel('Año de nacimiento (opcional, AAAA)', { exact: true }).fill(String(year));

  await page.getByRole('button', { name: 'Crear animal', exact: true }).click();

  await expect(page.getByText('Historial', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Ternero', { exact: true }).first()).toBeVisible();

  const { id: profileId } = await waitForServerAnimalProfile(establishmentId, { idv });
  const { categoryOverride, categoryCode } = await readServerProfileCategory(profileId);
  expect(categoryCode).toBe('ternero');
  expect(categoryOverride).toBe(false);
});

test('delta #3 (RAF2.1.7): DD/MM inválido (31/02) → error inline + animal NO creado', async ({ page }) => {
  const user = await createTestUser('ddmmbad');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo DDMMBad');

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);

  await page.getByRole('button', { name: 'Dar de alta tu primer animal' }).click();
  await walkWizardToData(page, { sex: 'Hembra', categoryName: 'Vaquillona' });

  await page.getByLabel('Caravana visual (recomendado)', { exact: true }).fill(`6133${Date.now().toString().slice(-6)}`);
  await page.getByLabel('Año de nacimiento (opcional, AAAA)', { exact: true }).fill('2022');
  await page.getByLabel('Día y mes (opcional, DD/MM)', { exact: true }).fill('3102'); // 31/02 inexistente

  await page.getByRole('button', { name: 'Crear animal', exact: true }).click();

  // Error inline (sin clamp) + NO navega a la ficha (la ficha tiene "Historial").
  await expect(page.getByText('El día y mes no son válidos (revisá DD/MM).')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Historial', { exact: true })).toHaveCount(0);
});

test('delta #3 (RAF2.1.5): DD/MM sin año → error inline en el campo día/mes + animal NO creado', async ({
  page,
}) => {
  const user = await createTestUser('ddmmnoyear');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo DDMMNoYear');

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);

  await page.getByRole('button', { name: 'Dar de alta tu primer animal' }).click();
  await walkWizardToData(page, { sex: 'Hembra', categoryName: 'Vaquillona' });

  await page.getByLabel('Caravana visual (recomendado)', { exact: true }).fill(`6134${Date.now().toString().slice(-6)}`);
  // DD/MM presente SIN año → no hay fecha sin año.
  await page.getByLabel('Día y mes (opcional, DD/MM)', { exact: true }).fill('1503');

  await page.getByRole('button', { name: 'Crear animal', exact: true }).click();

  await expect(page.getByText('Cargá el año para poder usar el día y mes.')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Historial', { exact: true })).toHaveCount(0);
});

test('delta #13 (RAF2.2): condición por STEPPER → cargar 3,25 con + → persiste (condition_score_event)', async ({
  page,
}) => {
  test.setTimeout(120_000); // alta + 2 polls server (perfil + condition_score) → headroom sobre el default 60s.
  const user = await createTestUser('condstep');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId } = await seedEstablishmentWithRodeo(user.id, 'Campo CondStep');

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);

  await page.getByRole('button', { name: 'Dar de alta tu primer animal' }).click();
  await walkWizardToData(page, { sex: 'Hembra', categoryName: 'Multípara' });

  // Identificador = caravana visual numérica (el built-in "Nombre / seña" fue removido, delta #2 RNA.2.1);
  // el oráculo server matchea por idv.
  const idv = `6135${Date.now().toString().slice(-6)}`;
  await page.getByLabel('Caravana visual (recomendado)', { exact: true }).fill(idv);

  // El stepper arranca "sin cargar" mostrando 3,00 (atenuado); el 1er + lo marca cargado en 3,25.
  await expect(page.getByTestId('score-display').getByText('3,00', { exact: true })).toBeVisible();
  await page.getByTestId('score-plus').click();
  await expect(page.getByTestId('score-display').getByText('3,25', { exact: true })).toBeVisible();
  // Cargado → aparece la afordancia "Sin cargar" (RAF2.3.2).
  await expect(page.getByRole('button', { name: 'Quitar condición corporal', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Crear animal', exact: true }).click();

  await expect(page.getByText('Historial', { exact: true })).toBeVisible({ timeout: 20_000 });
  const { id: profileId } = await waitForServerAnimalProfile(establishmentId, { idv });
  // El score 3,25 se persiste como evento post-create (sin session_id, del alta).
  await expect
    .poll(async () => (await countConditionScores(profileId)).scores, { timeout: 30_000 })
    .toContain(3.25);
});

test('delta #14 (RAF2.3.3): condición SIN tocar (3,00 atenuado) NO persiste; "Sin cargar" la limpia', async ({
  page,
}) => {
  test.setTimeout(120_000); // alta + poll server (perfil) → headroom sobre el default 60s.
  const user = await createTestUser('condnone');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId } = await seedEstablishmentWithRodeo(user.id, 'Campo CondNone');

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);

  await page.getByRole('button', { name: 'Dar de alta tu primer animal' }).click();
  await walkWizardToData(page, { sex: 'Hembra', categoryName: 'Multípara' });

  // Identificador = caravana visual numérica (el built-in "Nombre / seña" fue removido, delta #2 RNA.2.1);
  // el oráculo server matchea por idv.
  const idv = `6136${Date.now().toString().slice(-6)}`;
  await page.getByLabel('Caravana visual (recomendado)', { exact: true }).fill(idv);

  // Sin cargar → no hay afordancia "Sin cargar" todavía (estado null, 3,00 atenuado).
  await expect(page.getByRole('button', { name: 'Quitar condición corporal', exact: true })).toHaveCount(0);
  // La toco (+ → 3,25) y la limpio con "Sin cargar" → vuelve a 3,00 (sin cargar) y la afordancia desaparece.
  await page.getByTestId('score-plus').click();
  await page.getByRole('button', { name: 'Quitar condición corporal', exact: true }).click();
  await expect(page.getByTestId('score-display').getByText('3,00', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Quitar condición corporal', exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Crear animal', exact: true }).click();

  await expect(page.getByText('Historial', { exact: true })).toBeVisible({ timeout: 20_000 });
  const { id: profileId } = await waitForServerAnimalProfile(establishmentId, { idv });
  // El animal llegó al server pero la condición quedó "sin cargar" → NO se creó ningún condition_score_event.
  expect((await countConditionScores(profileId)).count).toBe(0);
});

test('delta #14 (RAF2.3.1): re-tap del valor seleccionado DESELECCIONA dientes y preñez (opt-in)', async ({
  page,
}) => {
  const user = await createTestUser('deselect');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo Deselect');

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);

  await page.getByRole('button', { name: 'Dar de alta tu primer animal' }).click();
  await walkWizardToData(page, { sex: 'Hembra', categoryName: 'Multípara' });

  // Dientes: tap "Boca llena" → seleccionado (aria-pressed true); re-tap → deseleccionado (aria-pressed false).
  const teeth = page.getByRole('button', { name: 'Dientes Boca llena', exact: true });
  await teeth.click();
  await expect(teeth).toHaveAttribute('aria-pressed', 'true');
  await teeth.click();
  await expect(teeth).toHaveAttribute('aria-pressed', 'false');

  // Preñez: idéntico.
  const preg = page.getByRole('button', { name: 'Preñez Cabeza', exact: true });
  await preg.click();
  await expect(preg).toHaveAttribute('aria-pressed', 'true');
  await preg.click();
  await expect(preg).toHaveAttribute('aria-pressed', 'false');
});

test('delta #14 (RAF2.3.6): el selector REQUERIDO de categoría NO es deseleccionable (re-tap lo mantiene)', async ({
  page,
}) => {
  const user = await createTestUser('reqsel');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo ReqSel');

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);

  await page.getByRole('button', { name: 'Dar de alta tu primer animal' }).click();

  // Paso 3 — categoría (requerido): elegir Vaquillona, re-tocar → SIGUE seleccionada (no deselecciona).
  await expect(page.getByText('¿Es macho o hembra?', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Sexo Hembra', exact: true }).click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByText('¿Qué categoría es?', { exact: true })).toBeVisible({ timeout: 20_000 });
  const cat = page.getByRole('button', { name: 'Categoría Vaquillona', exact: true });
  await cat.click();
  await expect(cat).toHaveAttribute('aria-pressed', 'true');
  await cat.click(); // re-tap del requerido → NO deselecciona
  await expect(cat).toHaveAttribute('aria-pressed', 'true');
});

test('FIX3: con un filtro de Estado activo y 0 resultados, el empty es contextual (no "no cargaste")', async ({
  page,
}) => {
  const user = await createTestUser('filtroempty');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Filtro');
  // El campo SÍ tiene un animal ACTIVO (así el empty del filtro no se confunde con campo vacío).
  await seedAnimal(establishmentId, rodeoId, { idv: `5511${Date.now().toString().slice(-5)}`, sex: 'female' });

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);

  // Abrimos el filtro de Estado y elegimos "Vendidos" (no hay vendidos sembrados).
  await page.getByRole('button', { name: 'Filtrar por estado' }).click();
  await page.getByRole('button', { name: 'Vendidos', exact: true }).click();

  // Empty CONTEXTUAL: "No hay animales vendidos." + CTA "Limpiar filtro" (NO "Todavía no cargaste").
  await expect(page.getByText('No hay animales vendidos.')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Todavía no cargaste animales.')).toHaveCount(0);

  // Limpiar el filtro vuelve a mostrar el animal activo.
  await page.getByRole('button', { name: 'Limpiar filtro' }).click();
  await expect(page.getByText('No hay animales vendidos.')).toHaveCount(0);
});

// ─── Delta caravana-ficha (#6 manual): agregar caravana visual/electrónica desde la ficha (RCF.1–RCF.5) ──
//
// Afordancia "Agregar caravana …" en la sección "Identificación" para completar lo VACÍO (NULL→valor); lo
// seteado queda solo-lectura (inmutabilidad R4.13). idv = UPDATE local (offline-first); tag = RPC existente.
// NOTA (reconciliación estática): estos e2e NO se corren en vivo en esta sesión (la red a Supabase flakea —
// ver progress/current.md); las aserciones están reconciliadas contra el as-built de [id].tsx.

test('caravana-ficha (RCF.1.3/RCF.3.3/RCF.3.5): "Agregar caravana visual" → tipear idv → confirmar → idv en solo-lectura (UPDATE local optimista)', async ({
  page,
}) => {
  const user = await createTestUser('cfidv');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo CFIdv');
  // Animal ACTIVO SIN idv y SIN tag (ambos vacíos → ambas afordancias se ofrecen). delta IDU: el 4to canal
  // visual_id_alt se eliminó → identificable por su Nombre/Apodo (el hero, ya que no hay idv/tag).
  const apodoFd = await enableApodo(establishmentId, rodeoId);
  const apodoLabel = `Cara${Date.now().toString().slice(-6)}`;
  const profileId = await seedAnimal(establishmentId, rodeoId, { sex: 'female' });
  await seedCustomAttribute(profileId, apodoFd, apodoLabel);

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);

  // Abrimos la ficha (la fila lleva el apodo en su a11y label, al ser el hero).
  const row = page.getByRole('button', { name: new RegExp(apodoLabel) }).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.click();
  await expect(page.getByText('Identificación', { exact: true })).toBeVisible({ timeout: 20_000 });

  // La afordancia "Agregar caravana visual" está disponible (idv vacío + activo → canAssignIdv true).
  const addIdv = page.getByRole('button', { name: 'Agregar caravana visual', exact: true });
  await expect(addIdv).toBeVisible();
  await addIdv.click();

  // Se expande el FormField "Caravana visual" → tipeamos el idv (solo dígitos) → Confirmar.
  const idv = `7733${Date.now().toString().slice(-6)}`;
  const idvInput = page.getByLabel('Caravana visual', { exact: true });
  await expect(idvInput).toBeVisible();
  await idvInput.fill(idv);
  await page.getByTestId('assign-idv-confirm').click();

  // OPTIMISMO EN SITIO (RCF.3.5): la fila pasa a mostrar el idv en SOLO-LECTURA al instante (UPDATE local,
  // offline-first) → ya no se ofrece la afordancia "Agregar caravana visual".
  await expect(page.getByText(idv, { exact: true }).first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('button', { name: 'Agregar caravana visual', exact: true })).toHaveCount(0);
});

test('caravana-ficha (RCF.2.1/RCF.2.2/RCF.2.4/RCF.2.7): la electrónica se carga por el sheet de bastoneo → manual 14 díg = error; 15 díg → asigna + optimismo en sitio', async ({
  page,
}) => {
  const user = await createTestUser('cftag');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo CFTag');
  // delta IDU: sin visual_id_alt → el animal es identificable por su idv (hero); el tag queda vacío para
  // ejercer la asignación de la caravana electrónica.
  const visualLabel = `${RUN_TAG}-CFTAG`;
  await seedAnimal(establishmentId, rodeoId, { idv: visualLabel, sex: 'female' });

  // Transporte MANUAL (sin bastón): delta UX 2026-07-06 — la ficha ya NO ofrece "Agregar caravana
  // electrónica" directa; la electrónica se carga por el sheet de bastoneo, con la entrada manual detrás del
  // CTA (paridad con baston-ficha.spec.ts (c); la marca MANUAL cae al hero manual-promovido, sin transporte).
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__RAFAQ_BLE_E2E__ = true;
    (window as unknown as Record<string, unknown>).__RAFAQ_BLE_E2E_MANUAL__ = true;
  });
  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);

  const row = page.getByRole('button', { name: new RegExp(visualLabel) }).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.click();
  await expect(page.getByText('Identificación', { exact: true })).toBeVisible({ timeout: 20_000 });

  // RCF.2.1: la ficha NO ofrece carga manual DIRECTA de la electrónica — solo "Bastonear la caravana".
  await expect(page.getByRole('button', { name: 'Agregar caravana electrónica', exact: true })).toHaveCount(0);
  await page.getByTestId('tag-scan-open').click();
  await expect(page.getByTestId('tag-scan-sheet')).toBeVisible({ timeout: 10_000 });

  // Sin transporte → abrir la carga MANUAL dentro del sheet (detrás del CTA).
  await page.getByTestId('tag-scan-to-manual').click();
  await expect(page.getByTestId('tag-scan-manual')).toBeVisible({ timeout: 10_000 });
  const tagInput = page.getByLabel('Caravana electrónica', { exact: true });
  await expect(tagInput).toBeVisible();

  // 14 díg → error inline "…15 dígitos." sin asignar (RCF.2.2/2.4: sigue en la vista manual).
  await tagInput.fill('12345678901234'); // 14 díg
  await page.getByTestId('tag-scan-manual-assign').click();
  await expect(page.getByText('La caravana electrónica tiene que tener 15 dígitos.')).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByTestId('tag-scan-manual')).toBeVisible();

  // 15 díg → "Asignar caravana" → encola el RPC → optimismo en sitio (RCF.2.7): el sheet cierra + ya no se
  // ofrece "Bastonear la caravana" (tag seteado).
  const tag = `98200${Date.now().toString().slice(-10)}`.slice(0, 15).padEnd(15, '0');
  await tagInput.fill(tag);
  await page.getByTestId('tag-scan-manual-assign').click();
  await expect(page.getByTestId('tag-scan-sheet')).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByTestId('tag-scan-open')).toHaveCount(0);
});

test('caravana-ficha (RCF.1.2/RCF.1.4): un identificador YA seteado NO ofrece afordancia (solo-lectura, inmutable R4.13)', async ({
  page,
}) => {
  const user = await createTestUser('cfset');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo CFSet');
  // Animal con idv Y tag YA seteados → ninguno debe ofrecer la afordancia de asignación.
  const idv = `6622${Date.now().toString().slice(-6)}`;
  const tag = `03200${Date.now().toString().slice(-10)}`.slice(0, 15).padEnd(15, '0');
  await seedAnimal(establishmentId, rodeoId, { idv, tag, sex: 'female' });

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);

  // El idv es el hero → la fila lo lleva en su a11y label.
  const row = page.getByRole('button', { name: new RegExp(idv) }).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.click();
  await expect(page.getByText('Identificación', { exact: true })).toBeVisible({ timeout: 20_000 });

  // El idv seteado se muestra en solo-lectura; NO se ofrece "Agregar caravana visual" (R4.13).
  // `.filter({ visible: true })`: este animal NO tiene visual → su identificador PRIMARIO en la lista es el
  // propio idv, y la fila de la lista sigue MONTADA (oculta) bajo el overlay de la ficha → `.first()` pelado
  // caería en esa ocurrencia HIDDEN. Acá afirmamos el valor solo-lectura VISIBLE del bloque "Identificación".
  await expect(page.getByText(idv, { exact: true }).filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Agregar caravana visual', exact: true })).toHaveCount(0);
  // El tag seteado (propagado a animal_profiles.animal_tag_electronic por el trigger 0079) → solo-lectura;
  // NO se ofrece "Agregar caravana electrónica".
  await expect(page.getByText(tag, { exact: true }).filter({ visible: true }).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Agregar caravana electrónica', exact: true })).toHaveCount(0);
});

// ─── Delta VINCULAR LA CRÍA AL PIE (#15): prompt saltable post-alta (RCAP.1–RCAP.5 / RCAP.10.7) ──────────
//
// Tras crear una vaca CON cría al pie (nursing=true) en el happy path, aparece un prompt SALTABLE que pide
// la caravana del ternero y lo VINCULA (find-or-create): encontrado → linkCalfToMother; nuevo → registerBirth
// (crea+vincula). "Ahora no" cierra sin vincular (la vaca queda intacta). Cubre RCAP.10.7.

test('delta #15 (RCAP.1.2): alta de una vaca SIN cría al pie → el prompt de vinculación NO aparece', async ({
  page,
}) => {
  // RCAP.1.2: el prompt está gateado por nursing=true. "Sin cría al pie" (nursing=false) → no prompt.
  const user = await createTestUser('criano');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo CriaNo');

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);

  await page.getByRole('button', { name: 'Dar de alta tu primer animal' }).click();
  await walkWizardToData(page, { sex: 'Hembra', categoryName: 'Multípara' });

  await page.getByLabel('Caravana visual (recomendado)', { exact: true }).fill(`6151${Date.now().toString().slice(-6)}`);
  // Elegimos EXPLÍCITAMENTE "Sin cría al pie" (nursing=false) → showNursing true pero nursing !== true.
  await page.getByRole('button', { name: 'Cría al pie Sin cría al pie', exact: true }).click();
  await page.getByRole('button', { name: 'Crear animal', exact: true }).click();

  // Sin cría al pie → NO se dispara el prompt; navega directo a la ficha.
  await expect(page.getByText('Identificación', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('¿Vincular su cría al pie?', { exact: true })).toHaveCount(0);
});

test('delta #15 (RCAP.1.1/1.3/1.4): vaca CON cría al pie → prompt → "Ahora no" preserva la vaca SIN crear vínculo', async ({
  page,
}) => {
  test.setTimeout(120_000); // alta + poll server (perfil + estado de partos) → headroom.
  const user = await createTestUser('criaskip');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId } = await seedEstablishmentWithRodeo(user.id, 'Campo CriaSkip');

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);

  // Identificador = caravana visual numérica (el built-in "Nombre / seña" fue removido, delta #2 RNA.2.1).
  const motherIdv = `6152${Date.now().toString().slice(-6)}`;
  await page.getByRole('button', { name: 'Dar de alta tu primer animal' }).click();
  await walkWizardToData(page, { sex: 'Hembra', categoryName: 'Multípara' });
  await page.getByLabel('Caravana visual (recomendado)', { exact: true }).fill(motherIdv);
  await page.getByRole('button', { name: 'Cría al pie Con cría al pie', exact: true }).click();
  await page.getByRole('button', { name: 'Crear animal', exact: true }).click();

  // RCAP.1.1: el prompt SALTABLE aparece. RCAP.1.3: "Ahora no" lo cierra y navega a la ficha.
  await expect(page.getByText('¿Vincular su cría al pie?', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Ahora no', exact: true }).click();
  await expect(page.getByText('Identificación', { exact: true })).toBeVisible({ timeout: 20_000 });

  // RCAP.1.4: la vaca quedó creada (aterriza server-side) y NO se creó NINGÚN vínculo/parto (el skip no linkea).
  const { id: motherId } = await waitForServerAnimalProfile(establishmentId, { idv: motherIdv });
  expect((await getServerBirthState(motherId)).birthEventCount).toBe(0);
});

test('delta #15 (RCAP.3.1/3.2/3.5): vaca con cría al pie → vincular un ternero EXISTENTE → parto + birth_calf en el server', async ({
  page,
}) => {
  test.setTimeout(150_000);
  const user = await createTestUser('crialink');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo CriaLink');
  // Ternero EXISTENTE en el campo (find-or-create lo encuentra por su caravana visual/idv).
  const calfIdv = `7711${Date.now().toString().slice(-6)}`;
  await seedAnimal(establishmentId, rodeoId, { idv: calfIdv, sex: 'male' });

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);
  // Gate de sync: el ternero sembrado aparece en la lista → está en el SQLite local → el find-or-create lo verá.
  await expect(page.getByText(calfIdv, { exact: true }).first()).toBeVisible({ timeout: 20_000 });

  // El campo ya tiene un animal → el alta arranca por el buscador (un id fresco no-match → "Dar de alta este animal").
  const motherIdv = `5512${Date.now().toString().slice(-6)}`;
  await page.getByLabel('Buscar animal por caravana o número', { exact: true }).fill(motherIdv);
  await page.getByRole('button', { name: 'Dar de alta este animal' }).click();
  await walkWizardToData(page, { sex: 'Hembra', categoryName: 'Multípara' });
  await page.getByRole('button', { name: 'Cría al pie Con cría al pie', exact: true }).click();
  await page.getByRole('button', { name: 'Crear animal', exact: true }).click();

  // Prompt → tipear la caravana del ternero existente → Buscar → ENCONTRADO → Vincular.
  await expect(page.getByText('¿Vincular su cría al pie?', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByLabel('Caravana del ternero', { exact: true }).fill(calfIdv);
  await page.getByTestId('link-calf-search').click();
  await expect(page.getByText('Ternero encontrado', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(calfIdv, { exact: true }).first()).toBeVisible();
  await page.getByTestId('link-calf-confirm').click();

  // Navega a la ficha de la vaca (reflejo optimista). Oráculo server: 1 parto con 1 birth_calf.
  await expect(page.getByText('Identificación', { exact: true })).toBeVisible({ timeout: 20_000 });
  const { id: motherId } = await waitForServerAnimalProfile(establishmentId, { idv: motherIdv });
  const birth = await waitForServerBirth(motherId, { expectedCalves: 1 });
  expect(birth.birthEventCount).toBe(1);
  expect(birth.calfCount).toBe(1);
});

test('delta #15 (RCAP.4/RCAP.5): vaca con cría al pie → ternero NUEVO con rodeo preseleccionado + leyenda, editable → parto en el server', async ({
  page,
}) => {
  test.setTimeout(150_000);
  const user = await createTestUser('criacreate');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId } = await seedEstablishmentWithRodeo(user.id, 'Campo CriaCreate'); // rodeo A = "Rodeo general"
  // 2do rodeo del MISMO sistema (cría) → el picker del ternero lo ofrece como destino editable (RCAP.5.3/5.4).
  await seedRodeo(establishmentId, 'Destete'); // rodeo B = "{RUN_TAG} Destete"

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);

  // Identificador = caravana visual numérica (el built-in "Nombre / seña" fue removido, delta #2 RNA.2.1).
  const motherIdv = `6153${Date.now().toString().slice(-6)}`;
  await page.getByRole('button', { name: 'Dar de alta tu primer animal' }).click();
  // 2 rodeos → el wizard pide el rodeo (paso 1). La madre va al rodeo A ("general").
  await expect(page.getByText('¿A qué rodeo va este animal?', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: /Rodeo .*general/i }).click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await walkWizardToData(page, { sex: 'Hembra', categoryName: 'Multípara' });
  await page.getByLabel('Caravana visual (recomendado)', { exact: true }).fill(motherIdv);
  await page.getByRole('button', { name: 'Cría al pie Con cría al pie', exact: true }).click();
  await page.getByRole('button', { name: 'Crear animal', exact: true }).click();

  // Prompt → caravana NUEVA (no existe) → Buscar → camino CREATE (mini-form).
  await expect(page.getByText('¿Vincular su cría al pie?', { exact: true })).toBeVisible({ timeout: 20_000 });
  const calfIdv = `8811${Date.now().toString().slice(-6)}`;
  await page.getByLabel('Caravana del ternero', { exact: true }).fill(calfIdv);
  await page.getByTestId('link-calf-search').click();
  await expect(page.getByText('Sexo del ternero', { exact: true })).toBeVisible({ timeout: 20_000 });

  // "Cambiar caravana" (control & freedom): desde CREATE volver a la captura CONSERVANDO lo tipeado → un typo
  // en la manga no obliga a crear un ternero bogus. Reaparece el campo con el valor previo y se puede re-buscar.
  await page.getByTestId('link-calf-back').click();
  const calfField = page.getByLabel('Caravana del ternero', { exact: true });
  await expect(calfField).toBeVisible();
  await expect(calfField).toHaveValue(calfIdv);
  await page.getByTestId('link-calf-search').click();

  // RCAP.5.1/5.2: el rodeo del ternero arranca PRESELECCIONADO al de la madre, con la leyenda.
  await expect(page.getByText('Sexo del ternero', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('(Mismo rodeo que la madre)', { exact: true })).toBeVisible();

  // RCAP.5.3: editar a OTRO rodeo del mismo sistema (Destete) → la leyenda desaparece (ya no coincide).
  await page.getByRole('button', { name: 'Elegir rodeo del ternero' }).click();
  await page.getByRole('button', { name: /Rodeo .*Destete/i }).click();
  await expect(page.getByText('(Mismo rodeo que la madre)', { exact: true })).toHaveCount(0);

  // RCAP.4.2 (rama de ERROR): "Crear y vincular" SIN elegir sexo → error inline, NO crea ni navega
  // (sigue en la fase create). El sexo es requerido.
  await page.getByTestId('link-calf-create').click();
  await expect(page.getByText('Elegí el sexo del ternero.', { exact: true })).toBeVisible();
  await expect(page.getByTestId('link-calf-create')).toBeVisible(); // sigue en CREATE (no navegó a la ficha)

  // Sexo REQUERIDO (RCAP.4.2) → elegir → "Crear y vincular".
  await page.getByRole('button', { name: 'Sexo Macho', exact: true }).click();
  await page.getByTestId('link-calf-create').click();

  await expect(page.getByText('Identificación', { exact: true })).toBeVisible({ timeout: 20_000 });
  const { id: motherId } = await waitForServerAnimalProfile(establishmentId, { idv: motherIdv });
  const birth = await waitForServerBirth(motherId, { expectedCalves: 1 });
  expect(birth.calfCount).toBe(1);
});

test('delta #15 (RCAP.3.3): un ternero que YA tiene madre no se re-vincula → aviso "ya tiene una madre registrada"', async ({
  page,
}) => {
  test.setTimeout(150_000);
  const user = await createTestUser('criamadre');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo CriaMadre');
  // Madre PRE-EXISTENTE + ternero, vinculados por un parto. birth_calves es server-only (sin GRANT de INSERT
  // a NADIE salvo el DEFINER — ni siquiera service_role lo puede insertar directo, RCAP.6.10), así que el
  // vínculo lo crea la RPC REAL link_calf_to_mother desde un cliente AUTENTICADO (el propio owner) — es el
  // único camino server-side legítimo (mismo que usa la app).
  const pmIdv = `4411${Date.now().toString().slice(-6)}`;
  const calfIdv = `6611${Date.now().toString().slice(-6)}`;
  const motherProfileId = await seedAnimal(establishmentId, rodeoId, { idv: pmIdv, sex: 'female' });
  const calfProfileId = await seedAnimal(establishmentId, rodeoId, { idv: calfIdv, sex: 'male' });
  const authed = anonClient();
  const { error: signErr } = await authed.auth.signInWithPassword({ email: user.email, password: user.password });
  if (signErr) throw new Error(`seed sign-in: ${signErr.message}`);
  const { error: linkErr } = await authed.rpc('link_calf_to_mother', {
    p_mother_profile_id: motherProfileId,
    p_calf_profile_id: calfProfileId,
    p_event_date: '2026-01-15',
  });
  if (linkErr) throw new Error(`seed link_calf_to_mother: ${linkErr.message}`);
  await authed.auth.signOut();

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);

  // Gate de sync DETERMINISTA: la ficha del ternero muestra la card "Madre" (fetchMother LOCAL) → el
  // birth_calf sembrado YA bajó al SQLite local → el prompt lo verá como "ya tiene madre" (sin race de sync).
  await expect(page.getByText(calfIdv, { exact: true }).first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: new RegExp(calfIdv) }).first().click();
  await expect(page.getByLabel(`Ver la ficha de la madre: ${pmIdv}`)).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Volver', exact: true }).click();

  // Alta de una NUEVA vaca con cría al pie → prompt → buscar el ternero que YA tiene madre.
  const newMotherIdv = `5513${Date.now().toString().slice(-6)}`;
  await page.getByLabel('Buscar animal por caravana o número', { exact: true }).fill(newMotherIdv);
  await page.getByRole('button', { name: 'Dar de alta este animal' }).click();
  await walkWizardToData(page, { sex: 'Hembra', categoryName: 'Multípara' });
  await page.getByRole('button', { name: 'Cría al pie Con cría al pie', exact: true }).click();
  await page.getByRole('button', { name: 'Crear animal', exact: true }).click();

  await expect(page.getByText('¿Vincular su cría al pie?', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByLabel('Caravana del ternero', { exact: true }).fill(calfIdv);
  await page.getByTestId('link-calf-search').click();

  // RCAP.3.3: aviso "ya tiene una madre" + NO se ofrece confirmar el vínculo (sigue en la fase de captura).
  await expect(page.getByText(/ya tiene una madre registrada/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('link-calf-confirm')).toHaveCount(0);
});

// ─── Delta #2 NOMBRE/APODO por rodeo (RNA.2/RNA.3/RNA.8) ─────────────────────────────────────────────────
//
// El built-in editable "Nombre / seña" (visual_id_alt) DEJÓ de mostrarse por default en el alta (RNA.2.1); el
// apodo pasa a ser un dato custom opt-in por rodeo (CustomPropertiesForm → custom_attributes). El mensaje de
// identificador mínimo ya no menciona "nombre/seña" (RNA.3.1), sin relajar hasAtLeastOneIdentifier (RNA.3.2).

test('delta #2 nombre/apodo (RNA.2.1/RNA.3.1): el alta NO muestra "Nombre / seña" por default + el mensaje de identificador mínimo no lo menciona', async ({
  page,
}) => {
  const user = await createTestUser('apodo-off');
  await setUserPhone(user.id, '1123456789');
  await seedEstablishmentWithRodeo(user.id, 'Campo ApodoOff');

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);

  await page.getByRole('button', { name: 'Dar de alta tu primer animal' }).click();
  await walkWizardToData(page, { sex: 'Hembra', categoryName: 'Vaquillona' });

  // RNA.2.1: paso 4 SIN el input editable "Nombre / seña (opcional)" por default; el identificador libre es la
  // caravana visual. Ninguna mención a "Nombre / seña" en el form (ni label ni copy de validación).
  await expect(page.getByLabel('Caravana visual (recomendado)', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByLabel('Nombre / seña (opcional)', { exact: true })).toHaveCount(0);
  await expect(page.getByText(/nombre\s*\/\s*seña/i)).toHaveCount(0);

  // RNA.3.1/RNA.3.2: alta EN BLANCO (sin ningún identificador) → "Crear animal" muestra el mensaje mínimo
  // ENUMERANDO solo caravana electrónica + caravana visual (sin "nombre/seña"); no encola el alta.
  await page.getByRole('button', { name: 'Crear animal', exact: true }).click();
  await expect(
    page.getByText('Cargá al menos un identificador: caravana electrónica o caravana visual.', { exact: true }),
  ).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/nombre\s*\/\s*seña/i)).toHaveCount(0);
  // NO navegó a la ficha (la ficha tiene "Historial"): el alta condenada no se encoló (RNA.3.2).
  await expect(page.getByText('Historial', { exact: true })).toHaveCount(0);
});

test('delta #2 nombre/apodo (RNA.2.2/RNA.4.2/RNA.8.2): con el "apodo" habilitado por rodeo → aparece en el alta (Datos personalizados) → custom_attributes → ficha', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const user = await createTestUser('apodo-on');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo ApodoOn');
  // Habilitamos el "apodo" en el rodeo vía service_role (espejo del seed 0119 + set_rodeo_config del owner; el
  // fd per-est del alta lo enable por rodeo). El E2E NO depende de la migración 0119: siembra su propio fd apodo.
  const fieldId = await seedCustomField(establishmentId, rodeoId, {
    label: 'Nombre / apodo',
    dataKey: 'apodo',
    dataType: 'propiedad',
    uiComponent: 'text',
  });

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);

  const emptyCta = page.getByRole('button', { name: 'Dar de alta tu primer animal' });
  await expect(emptyCta).toBeVisible({ timeout: 20_000 });
  // Dwell: el fd apodo + su rodeo_data_config se asientan en el SQLite local antes del alta.
  await page.waitForTimeout(3000);
  await emptyCta.click();
  await walkWizardToData(page, { sex: 'Hembra', categoryName: 'Vaquillona' });

  const idv = `6120${Date.now().toString().slice(-6)}`;
  await page.getByLabel('Caravana visual (recomendado)', { exact: true }).fill(idv);

  // RNA.2.2: el built-in "Nombre / seña" sigue AUSENTE; el apodo se ofrece por la sección "Datos personalizados".
  await expect(page.getByLabel('Nombre / seña (opcional)', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Datos personalizados', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Nombre / apodo', { exact: true }).first()).toBeVisible();
  const apodoInput = page.getByTestId('custom-prop-text').first();
  await expect(apodoInput).toBeVisible();
  await apodoInput.fill('Pinto');

  await page.getByRole('button', { name: 'Crear animal', exact: true }).click();

  // Aterriza en la ficha del recién creado. Oráculo SERVER: el apodo aterrizó en custom_attributes ("Pinto").
  await expect(page.getByText('Identificación', { exact: true }).first()).toBeVisible({ timeout: 20_000 });
  const { id: profileId } = await waitForServerAnimalProfile(establishmentId, { idv });
  await waitForServerCustomAttribute(profileId, fieldId, 'Pinto');

  // RNA.4.2: la ficha muestra el apodo por "Datos personalizados" (sin fila dedicada nueva).
  await expect(page.getByText('Datos personalizados', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Pinto', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
});
