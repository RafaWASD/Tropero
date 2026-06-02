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

test('alta desde empty → el animal aparece en la lista y abre la ficha', async ({ page }) => {
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

  // Pantalla CREATE. Completamos: visual + sexo (requerido). El identificador visual lo tipeamos
  // como "recomendado" (el alta en blanco no precarga ninguno).
  const visualLabel = `${RUN_TAG}-V1`;
  const visualInput = page.getByLabel('Identificación visual (recomendado)', { exact: true });
  await expect(visualInput).toBeVisible({ timeout: 20_000 });
  await visualInput.fill(visualLabel);

  // Sexo: segmented control grande. Elegimos Hembra.
  await page.getByRole('button', { name: 'Sexo Hembra', exact: true }).click();

  // Crear.
  await page.getByRole('button', { name: 'Crear animal', exact: true }).click();

  // R4.7: aterriza en la ficha del recién creado. La ficha tiene el bloque "Identificación" y el
  // valor visual cargado (aparece en el hero Y en la fila → .first()).
  await expect(page.getByText('Identificación', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(visualLabel, { exact: true }).first()).toBeVisible();
  // Teaser cálido del Historial (C3, fix-loop FIX 1) — reemplaza el "Próximamente" gris.
  await expect(page.getByText('Historial de eventos', { exact: true })).toBeVisible();

  // Volvemos a la lista. La ficha está FUERA del grupo (tabs) (es un Stack screen), así que no
  // tiene la bottom-nav: usamos su botón "Volver" para regresar a la tab Animales (el create se
  // hizo con replace, así que back desde la ficha cae en (tabs)/Animales). El animal aparece.
  await page.getByRole('button', { name: 'Volver', exact: true }).click();
  await expect(page.getByText(visualLabel, { exact: true }).first()).toBeVisible({ timeout: 20_000 });

  // fix-loop 3: volvemos a Inicio → el paso de animal ahora está HECHO (count real = 1, no
  // hardcodeado). useFocusEffect recarga el count al re-enfocar la home tras crear el animal: el
  // paso muestra "Cargaste tu primer animal" y YA NO el "Cargá tu primer animal" pendiente.
  await gotoTab(page, 'Inicio', page.getByText(/¡Hola.*👋/));
  await expect(page.getByText('Cargaste tu primer animal', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Cargá tu primer animal', { exact: true })).toHaveCount(0);
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

  // Caravana electrónica: tipeamos letras + 40 dígitos → debe quedar SOLO 15 dígitos (FDX-B).
  const tagInput = page.getByLabel('Caravana electrónica (recomendado, 15 dígitos)', { exact: true });
  await expect(tagInput).toBeVisible({ timeout: 20_000 });
  await tagInput.fill('abc1234567890123456789012345');
  await expect(tagInput).toHaveValue('123456789012345'); // 15 dígitos, sin letras

  // Fecha de nacimiento: tipeamos basura → la máscara descarta letras y arma AAAA-MM-DD.
  const birthInput = page.getByLabel('Fecha de nacimiento (opcional, AAAA-MM-DD)', { exact: true });
  await birthInput.fill('asdasd');
  await expect(birthInput).toHaveValue(''); // nada de "asdasd"
  await birthInput.fill('20240115');
  await expect(birthInput).toHaveValue('2024-01-15'); // guiones automáticos

  // Peso: tipeamos basura → solo número decimal.
  const weightInput = page.getByLabel('Peso de entrada en kg (opcional)', { exact: true });
  await weightInput.fill('dasdas');
  await expect(weightInput).toHaveValue('');
  await weightInput.fill('180');
  await expect(weightInput).toHaveValue('180');

  // Dejamos la caravana INCOMPLETA (borramos y ponemos 8 díg) y NO elegimos sexo → submit debe
  // mostrar errores y NO navegar (seguimos en la pantalla de alta).
  await tagInput.fill('12345678'); // 8 díg < 15
  await page.getByRole('button', { name: 'Crear animal', exact: true }).click();
  await expect(page.getByText('La caravana electrónica tiene que tener 15 dígitos.')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Elegí el sexo del animal.')).toBeVisible();
  // Sigue en la pantalla de alta (no aterrizó en una ficha).
  await expect(page.getByText('Datos del animal', { exact: true })).toHaveCount(0);
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
