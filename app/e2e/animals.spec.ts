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
  createTestUser,
  seedEstablishmentWithRodeo,
  seedAnimal,
  addMember,
  setUserPhone,
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
  await seedEstablishmentWithRodeo(user.id, 'Campo Alta');

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

  // Paso 4: identificación visual (recomendado; el alta en blanco no precarga ninguno).
  const visualLabel = `${RUN_TAG}-V1`;
  const visualInput = page.getByLabel('Identificación visual (recomendado)', { exact: true });
  await expect(visualInput).toBeVisible({ timeout: 20_000 });
  await visualInput.fill(visualLabel);

  // Crear.
  await page.getByRole('button', { name: 'Crear animal', exact: true }).click();

  // R4.7: aterriza en la ficha del recién creado. La ficha tiene el bloque "Identificación" y el
  // valor visual cargado (aparece en el hero Y en la fila → .first()).
  await expect(page.getByText('Identificación', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(visualLabel, { exact: true }).first()).toBeVisible();
  // El badge de categoría refleja la elegida ("Vaquillona") — coincide con la computada → sin override.
  await expect(page.getByText('Vaquillona', { exact: true }).first()).toBeVisible();
  // Sección Historial (C3.1) — reemplaza el teaser "Próximamente". Un animal recién creado tiene
  // solo el `initial` → empty/sparse cálido.
  await expect(page.getByText('Historial', { exact: true })).toBeVisible();

  // Volvemos a la lista vía "Volver" (el create se hizo con replace → back desde la ficha cae en
  // (tabs)/Animales). El animal aparece.
  await page.getByRole('button', { name: 'Volver', exact: true }).click();
  await expect(page.getByText(visualLabel, { exact: true }).first()).toBeVisible({ timeout: 20_000 });

  // fix-loop 3: volvemos a Inicio → el paso de animal ahora está HECHO (count real = 1, no
  // hardcodeado). useFocusEffect recarga el count al re-enfocar la home tras crear el animal.
  await gotoTab(page, 'Inicio', page.getByText(/¡Hola.*👋/));
  await expect(page.getByText('Cargaste tu primer animal', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Cargá tu primer animal', { exact: true })).toHaveCount(0);
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

  // Identificación + dientes + condición 3 + con cría al pie.
  const visualLabel = `${RUN_TAG}-MP`;
  await page.getByLabel('Identificación visual (recomendado)', { exact: true }).fill(visualLabel);
  await page.getByRole('button', { name: 'Dientes Boca llena', exact: true }).click();
  await page.getByRole('button', { name: 'Condición 3', exact: true }).click();
  await page.getByRole('button', { name: 'Cría al pie Con cría al pie', exact: true }).click();

  await page.getByRole('button', { name: 'Crear animal', exact: true }).click();

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

  // Cargamos identificación + peso → se crea.
  const visualLabel = `${RUN_TAG}-TERB`;
  await page.getByLabel('Identificación visual (recomendado)', { exact: true }).fill(visualLabel);
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

  const visualLabel = `${RUN_TAG}-VQP`;
  await page.getByLabel('Identificación visual (recomendado)', { exact: true }).fill(visualLabel);
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
  const visualLabel = `${RUN_TAG}-MULTI`;
  await page.getByLabel('Identificación visual (recomendado)', { exact: true }).fill(visualLabel);
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

  const visualLabel = `${RUN_TAG}-VQ`;
  await page.getByLabel('Identificación visual (recomendado)', { exact: true }).fill(visualLabel);
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
  const idvReadonly = page.getByLabel('Caravana / IDV (no editable)', { exact: true });
  await expect(idvReadonly).toBeVisible({ timeout: 20_000 });
  await expect(idvReadonly).toHaveValue('77123');
  // Y NO debe haber un input editable de IDV (el precargado ocupa ese rol).
  await expect(page.getByLabel('Caravana / IDV (recomendado)', { exact: true })).toHaveCount(0);
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

  // Caravana electrónica: tipeamos letras + 40 dígitos → debe quedar SOLO 15 dígitos (FDX-B).
  const tagInput = page.getByLabel('Caravana electrónica (recomendado, 15 dígitos)', { exact: true });
  await expect(tagInput).toBeVisible({ timeout: 20_000 });
  await tagInput.fill('abc1234567890123456789012345');
  await expect(tagInput).toHaveValue('123456789012345'); // 15 dígitos, sin letras

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

  // Dejamos la caravana INCOMPLETA (8 díg) → submit debe mostrar el error de largo y NO navegar
  // (seguimos en el paso de datos; el error es accionable, no rompe el flujo — R4.8).
  await tagInput.fill('12345678'); // 8 díg < 15
  await page.getByRole('button', { name: 'Crear animal', exact: true }).click();
  await expect(page.getByText('La caravana electrónica tiene que tener 15 dígitos.')).toBeVisible({ timeout: 10_000 });
  // Sigue en el paso de datos del wizard (no aterrizó en una ficha — la ficha tiene "Historial").
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
