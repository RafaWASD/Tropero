// e2e/ficha-categoria.spec.ts — red E2E de "fijar la categoría a mano desde la ficha"
// (delta spec 02 `ficha-categoria-tacto`, TCT.27 → RCM.1/RCM.3/RCM.4/RCM.5/RCM.7).
//
// Corre contra el export ESTÁTICO de prod (:8099) + Supabase remoto + PowerSync (mismo patrón que
// cut-ficha.spec.ts). WEB TÁCTIL REAL (memoria `reference_rn_web_pitfalls`): `hasTouch: true` +
// `touchscreen.tap()` — con un viewport desktop, Playwright emula click y ENMASCARA los defectos táctiles
// (tap-through al scrim, targets chicos).
//
// Cubre:
//   (a) vaquillona → "Cambiar" → "Vaca multípara" → confirmación con la CONSECUENCIA → Confirmar →
//       el badge del hero pasa a "Vaca multípara" y aparece la card "Categoría fijada manualmente";
//   (b) volver a elegir la categoría AUTOMÁTICA → la card desaparece (P2: elegir la automática des-fija);
//   (c) ternera de < 1 año → elegir "Vaca multípara" → aparece el AVISO de edad → Confirmar IGUAL
//       (el aviso NO bloquea, C1.2);
//   (d) hembra CUT → la fila "Categoría" NO ofrece "Cambiar" y muestra el hint (RCM.7.2).
//
// Datos namespaced (RUN_TAG); cleanup en afterAll + global-teardown. Aserta SOLO sobre datos propios.

import { test, expect } from './helpers/fixtures';
import {
  admin,
  createTestUser,
  seedEstablishmentWithRodeo,
  seedAnimal,
  setUserPhone,
  cleanupAll,
  todayLocalIso,
  RUN_TAG,
} from './helpers/admin';
import { signIn, waitForHome, gotoAnimales } from './helpers/ui';

test.use({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true });

test.afterAll(async () => {
  await cleanupAll();
});

/** Abre la ficha del animal buscándolo por su IDV en la tab Animales. */
async function openFicha(page: import('@playwright/test').Page, idv: string): Promise<void> {
  const search = page.getByLabel('Buscar animal por caravana o número', { exact: true });
  await expect(search).toBeVisible({ timeout: 20_000 });
  await search.fill(idv);
  const row = page.getByRole('button', { name: new RegExp(idv) }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.tap();
  await expect(page.getByText('Datos del animal', { exact: true })).toBeVisible({ timeout: 20_000 });
}

test('fila "Categoría": fijar a mano → card de fijación → elegir la automática → se des-fija', async ({
  page,
}) => {
  const user = await createTestUser('catpin');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo CatPin');

  // Hembra ADULTA (nacida hace años) sin eventos → el espejo deriva "Vaquillona" (rama hembra ≥1 año) y
  // `category_override` arranca en false. Es el caso base: la categoría se actualiza sola.
  const idv = `CAT${RUN_TAG.slice(-6)}`;
  await seedAnimal(establishmentId, rodeoId, {
    idv,
    sex: 'female',
    categoryCode: 'vaquillona',
    birthDate: '2022-03-01',
  });

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);
  await openFicha(page, idv);

  // La fila "Categoría" existe, muestra la VIGENTE y ofrece "Cambiar" (RCM.1.1/RCM.1.2).
  await expect(page.getByTestId('ficha-categoria-valor')).toHaveText('Vaquillona');
  await expect(page.getByText('Categoría fijada manualmente', { exact: true })).toHaveCount(0);
  const cambiar = page.getByTestId('ficha-categoria-cambiar');
  await expect(cambiar).toBeVisible();
  await cambiar.tap();

  // Sheet de selección (RCM.3.1/RCM.3.2): la vigente aparece marcada como seleccionada (RCM.2.7).
  await expect(page.getByTestId('category-sheet')).toBeVisible({ timeout: 10_000 });
  // La VIGENTE viene marcada como seleccionada (`buttonA11y({selected})` → `aria-pressed` en web) y las
  // demás no — el check + el borde $primary son la señal visual de lo mismo.
  await expect(page.getByTestId('category-option-vaquillona')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('category-option-multipara')).toHaveAttribute('aria-pressed', 'false');
  // `cut` y `vaca_cabana` NUNCA se ofrecen (RCM.2.4/RCM.2.5), ni las categorías de macho.
  await expect(page.getByTestId('category-option-cut')).toHaveCount(0);
  await expect(page.getByTestId('category-option-vaca_cabana')).toHaveCount(0);
  await expect(page.getByTestId('category-option-toro')).toHaveCount(0);

  // Elegir "Multípara" → fase de CONFIRMACIÓN dentro del MISMO sheet (RCM.3.3).
  await page.getByTestId('category-option-multipara').tap();
  await expect(page.getByTestId('category-sheet-confirm')).toBeVisible();
  await expect(page.getByTestId('category-confirm-question')).toContainText('¿Fijar la categoría en');
  // La CONSECUENCIA se muestra siempre (RCM.4.2): la categoría deja de actualizarse sola.
  await expect(page.getByTestId('category-confirm-consequence')).toContainText(
    'deja de actualizarse sola',
  );
  // Esta hembra tiene años → "Multípara" NO es incoherente con su edad → sin aviso (P5: el único piso es 365 d).
  await expect(page.getByTestId('category-age-warning')).toHaveCount(0);

  await page.getByRole('button', { name: 'Confirmar', exact: true }).tap();

  // El sheet cierra y la ficha refleja el cambio EN SITIO: el valor de la fila + el badge del hero +
  // la card "Categoría fijada manualmente" (RCM.7.4) aparecen en el mismo render.
  await expect(page.getByTestId('category-sheet')).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByTestId('ficha-categoria-valor')).toHaveText('Multípara', { timeout: 15_000 });
  await expect(page.getByLabel(/^Categoría Multípara/).filter({ visible: true }).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Categoría fijada manualmente', { exact: true })).toBeVisible({
    timeout: 15_000,
  });

  // ── (b) Volver a elegir la AUTOMÁTICA (Vaquillona) → se QUITA la fijación (RCM.5.2 / P2). ────────
  await page.getByTestId('ficha-categoria-cambiar').tap();
  await expect(page.getByTestId('category-sheet')).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('category-option-vaquillona').tap();
  await expect(page.getByTestId('category-sheet-confirm')).toBeVisible();
  // El COPY cambia (RCM.5.3): vuelve a actualizarse sola.
  await expect(page.getByTestId('category-confirm-consequence')).toContainText(
    'vuelve a actualizarse sola',
  );
  await page.getByRole('button', { name: 'Confirmar', exact: true }).tap();

  await expect(page.getByTestId('category-sheet')).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByTestId('ficha-categoria-valor')).toHaveText('Vaquillona', { timeout: 15_000 });
  await expect(page.getByText('Categoría fijada manualmente', { exact: true })).toHaveCount(0, {
    timeout: 15_000,
  });
});

test('RCM.3.4/RCM.3.5: tocar la categoría VIGENTE es no-op, y cerrar desde la confirmación cancela', async ({
  page,
}) => {
  const user = await createTestUser('catnoop');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo CatNoop');
  const idv = `NOP${RUN_TAG.slice(-6)}`;
  const profileId = await seedAnimal(establishmentId, rodeoId, {
    idv,
    sex: 'female',
    categoryCode: 'vaquillona',
    birthDate: '2022-03-01',
  });

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);
  await openFicha(page, idv);

  // (RCM.3.4) Tocar la categoría que YA está vigente y no cambia el `override`: cierra sin pedir
  // confirmación y sin escribir.
  await page.getByTestId('ficha-categoria-cambiar').tap();
  await expect(page.getByTestId('category-sheet')).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('category-option-vaquillona').tap();
  await expect(page.getByTestId('category-sheet')).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByTestId('category-sheet-confirm')).toHaveCount(0);

  // (RCM.3.5) Elegir OTRA categoría y CERRAR el sheet desde la fase de confirmación (la X del header):
  // cancela sin escribir.
  await page.getByTestId('ficha-categoria-cambiar').tap();
  await expect(page.getByTestId('category-sheet')).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('category-option-multipara').tap();
  await expect(page.getByTestId('category-sheet-confirm')).toBeVisible();
  await page.getByTestId('category-sheet-close').tap();
  await expect(page.getByTestId('category-sheet')).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByTestId('ficha-categoria-valor')).toHaveText('Vaquillona');
  await expect(page.getByText('Categoría fijada manualmente', { exact: true })).toHaveCount(0);

  // ORÁCULO SERVER de "no escribió NADA": el perfil sigue con override=false y su category_id original.
  // Es el oráculo fuerte — la pantalla podría mentir por un optimismo mal revertido; la fila no.
  const { data, error } = await admin
    .from('animal_profiles')
    .select('category_override, categories_by_system!inner(code)')
    .eq('id', profileId)
    .single();
  if (error) throw new Error(`read profile: ${error.message}`);
  expect(data.category_override).toBe(false);
  expect((data as unknown as { categories_by_system: { code: string } }).categories_by_system.code).toBe(
    'vaquillona',
  );
});

test('categoría incoherente con la edad: aparece el aviso y NO bloquea (se puede confirmar igual)', async ({
  page,
}) => {
  const user = await createTestUser('catedad');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo CatEdad');

  // TERNERA de ~8 meses (nacida hace 240 días) → por edad le corresponde "Ternera".
  const born = new Date();
  born.setDate(born.getDate() - 240);
  const birthDate = todayLocalIso(born); // día LOCAL (mismo criterio que la app: nunca UTC recortado)
  const idv = `EDA${RUN_TAG.slice(-6)}`;
  await seedAnimal(establishmentId, rodeoId, { idv, sex: 'female', categoryCode: 'ternera', birthDate });

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);
  await openFicha(page, idv);

  await expect(page.getByTestId('ficha-categoria-valor')).toHaveText('Ternera');
  await page.getByTestId('ficha-categoria-cambiar').tap();
  await expect(page.getByTestId('category-sheet')).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('category-option-multipara').tap();

  // AVISO de edad (RCM.4.4): nombra la edad REAL y la categoría que le correspondería.
  const warning = page.getByTestId('category-age-warning');
  await expect(warning).toBeVisible();
  await expect(warning).toContainText('meses');
  await expect(warning).toContainText('Ternera');
  // NO bloquea: Confirmar sigue habilitado y el cambio se aplica (C1.2).
  await page.getByRole('button', { name: 'Confirmar', exact: true }).tap();
  await expect(page.getByTestId('category-sheet')).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByTestId('ficha-categoria-valor')).toHaveText('Multípara', { timeout: 15_000 });
});

test('MACHO CASTRADO: elegir la categoría automática (Novillito) QUITA la fijación, no la re-fija (P2)', async ({
  page,
}) => {
  const user = await createTestUser('catcastr');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo CatCastr');

  // ── POR QUÉ ESTE FIXTURE EXISTE (🔴-1 del review) ────────────────────────────────────────────────
  // La derivada la resuelve `resolveRevertCategory`, COMPARTIDA con "Quitar fijación" (RCM.6.1). Esa
  // función pasaba `isCastrated: false` HARDCODEADO; se corrigió al valor REAL del perfil. Ningún test lo
  // ejercitaba: **no había un solo macho castrado en toda la suite E2E**, así que P2 quedaba verificado
  // solo en hembras — justo donde el eje castración no aplica y el defecto es invisible.
  //
  // Este animal es el ÚNICO fixture que distingue el arreglo del defecto:
  //   · castrado, 500 días (entre 1 y 2 años) → `compute_category` da **novillito**;
  //   · con el defecto (is_castrated=false), la derivada daría **torito**.
  // Efecto medible: al elegir "Novillito" (que ES la automática), con el arreglo la elegida COINCIDE con la
  // derivada → se QUITA la fijación (`override = false`, RCM.5.2 / P2); con el defecto DIFIERE de `torito`
  // → se FIJA (`override = true`), congelando exactamente lo que P2 evita. La categoría escrita es la misma
  // en los dos casos, así que el discriminante es el `override`, NO el `category_id`.
  //
  // Arranca FIJADO en "Novillo" (≠ la derivada) para que "Cambiar" se ofrezca y el cambio sea real.
  const born = new Date();
  born.setDate(born.getDate() - 500);
  const idv = `CAS${RUN_TAG.slice(-6)}`;
  const profileId = await seedAnimal(establishmentId, rodeoId, {
    idv,
    sex: 'male',
    isCastrated: true,
    categoryCode: 'novillo',
    categoryOverride: true,
    birthDate: todayLocalIso(born),
  });

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);
  await openFicha(page, idv);

  // Estado de partida: categoría FIJADA en "Novillo" (la card de fijación está a la vista).
  await expect(page.getByTestId('ficha-categoria-valor')).toHaveText('Novillo');
  await expect(page.getByText('Categoría fijada manualmente', { exact: true })).toBeVisible({
    timeout: 20_000,
  });

  await page.getByTestId('ficha-categoria-cambiar').tap();
  await expect(page.getByTestId('category-sheet')).toBeVisible({ timeout: 10_000 });

  // RCM.2.3 / P1 en E2E (hasta ahora solo tenía unit): a un macho CASTRADO se le ofrecen exactamente
  // ternero/novillito/novillo. Ofrecerle "Toro" o "Torito" sería un estado que se contradice solo.
  await expect(page.getByTestId('category-option-novillito')).toBeVisible();
  await expect(page.getByTestId('category-option-novillo')).toBeVisible();
  await expect(page.getByTestId('category-option-ternero')).toBeVisible();
  await expect(page.getByTestId('category-option-toro')).toHaveCount(0);
  await expect(page.getByTestId('category-option-torito')).toHaveCount(0);
  // Y nada de hembra (control de que el filtro por sexo sigue puesto en la rama de macho).
  await expect(page.getByTestId('category-option-vaquillona')).toHaveCount(0);

  await page.getByTestId('category-option-novillito').tap();
  await expect(page.getByTestId('category-sheet-confirm')).toBeVisible();
  // ORÁCULO 1 (copy): la confirmación tiene que anunciar que la categoría VUELVE a actualizarse sola. Con la
  // derivada mal calculada (`torito`), el sheet diría "queda fijada a mano" → este assert cae.
  await expect(page.getByTestId('category-confirm-consequence')).toContainText(
    'vuelve a actualizarse sola',
  );
  await page.getByRole('button', { name: 'Confirmar', exact: true }).tap();

  // ORÁCULO 2 (UI): la card de fijación DESAPARECE.
  await expect(page.getByTestId('category-sheet')).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByTestId('ficha-categoria-valor')).toHaveText('Novillito', { timeout: 15_000 });
  await expect(page.getByText('Categoría fijada manualmente', { exact: true })).toHaveCount(0, {
    timeout: 15_000,
  });

  // ORÁCULO 3 (SERVER, el que no puede mentir): `category_override = false` + la categoría automática.
  // Con el defecto, acá se leería `true`.
  let landed: { override: boolean; code: string } | null = null;
  for (let i = 0; i < 30; i++) {
    const { data, error } = await admin
      .from('animal_profiles')
      .select('category_override, categories_by_system!inner(code)')
      .eq('id', profileId)
      .single();
    if (error) throw new Error(`read profile: ${error.message}`);
    landed = {
      override: data.category_override as boolean,
      code: (data as unknown as { categories_by_system: { code: string } }).categories_by_system.code,
    };
    if (landed.override === false && landed.code === 'novillito') break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  expect(landed).toEqual({ override: false, code: 'novillito' });
});

test('animal CUT: la fila "Categoría" NO ofrece "Cambiar" y explica cómo destrabarlo', async ({ page }) => {
  const user = await createTestUser('catcut');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo CatCut');

  // Hembra ya marcada CUT (categoría 'cut' + override, como la deja `setCut`). RCM.7.2: cambiarle la
  // categoría dejaría is_cut=1 con una categoría no-CUT — el estado inconsistente que RCUT.2.3 prohíbe.
  const idv = `CUT${RUN_TAG.slice(-6)}`;
  const profileId = await seedAnimal(establishmentId, rodeoId, {
    idv,
    sex: 'female',
    categoryCode: 'cut',
    categoryOverride: true,
    birthDate: '2019-03-01',
  });
  const { error } = await admin.from('animal_profiles').update({ is_cut: true }).eq('id', profileId);
  if (error) throw new Error(`seed is_cut: ${error.message}`);

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);
  await openFicha(page, idv);

  // La categoría se sigue MOSTRANDO (RCM.1.3: nunca se oculta), pero sin afordancia y con el hint.
  await expect(page.getByTestId('ficha-categoria-valor')).toHaveText('CUT');
  await expect(page.getByTestId('ficha-categoria-hint-cut')).toHaveText(
    'Quitá la marca CUT para cambiar la categoría.',
  );

  // ⚠️ EL SETTLE NO ES DECORATIVO — sin él este test es CIEGO, y se verificó con un mutante.
  // La afordancia "Cambiar" depende de `categoryOptions`, que sale de una lectura ASÍNCRONA del catálogo
  // (`fetchRodeoCategoryCatalog`). En t=0 esa lista todavía está vacía ⇒ la fila es solo-lectura para
  // CUALQUIER animal, y un `toHaveCount(0)` matchea al instante: con el gate de CUT ROTO (canPinCategory
  // ignorando `is_cut`) el test seguía en VERDE. Esperamos a que el catálogo resuelva y RECIÉN ahí
  // asertamos la ausencia + que el hint SIGUE puesto (con el gate roto, el hint desaparece y aparece el
  // link). Referencia de tiempo: en el mismo build, el sheet del primer test abre con sus 5 opciones a los
  // pocos ms de montar la ficha (la lectura es SQLite local).
  await page.waitForTimeout(2000);
  await expect(page.getByTestId('ficha-categoria-cambiar')).toHaveCount(0);
  await expect(page.getByTestId('ficha-categoria-hint-cut')).toBeVisible();
});
