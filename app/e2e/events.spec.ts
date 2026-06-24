// e2e/events.spec.ts — red de seguridad del flujo C3.1: FICHA + CRONOLOGÍA (spec 02 R10/R14).
//
// Corre contra el export ESTÁTICO de prod servido en :8099 + Supabase remoto (mismo patrón que
// animals.spec.ts). Estado de partida: usuario con teléfono (saltea gate R3.8) + 1 campo con 1
// rodeo + 1 animal sembrado (find-or-create / seedAnimal).
//
// Cubre:
//   1. Abrir la ficha del animal → el timeline muestra al menos el evento `initial` de categoría
//      (todo animal tiene un category_change con reason 'initial' por el trigger 0030) — en C3.1
//      se ve como el empty/sparse cálido ("Todavía no hay eventos").
//   2. Agregar un PESO → aparece en el timeline ("Pesaje" + kg) arriba.
//   3. Agregar una OBSERVACIÓN → aparece en el timeline arriba.
//
// La E2E corre el export de PROD → es CIEGA a overlays de DEV; por eso el a11y helper es obligatorio
// (los Pressables del wizard usan buttonA11y). Usuarios + campos namespaced; cleanup en afterAll.

import { test, expect } from './helpers/fixtures';
import {
  createTestUser,
  seedEstablishmentWithRodeo,
  seedAnimal,
  seedReproductiveServiceEvent,
  setUserPhone,
  cleanupAll,
} from './helpers/admin';
import { signIn, waitForHome, gotoAnimales } from './helpers/ui';

test.afterAll(async () => {
  await cleanupAll();
});

test('ficha → timeline (sparse inicial) → agregar peso y observación → aparecen arriba', async ({
  page,
}) => {
  const user = await createTestUser('timeline');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Timeline');
  // Animal sembrado con un IDV único y buscable (para abrir su ficha desde la lista).
  const idv = `7711${Date.now().toString().slice(-5)}`;
  await seedAnimal(establishmentId, rodeoId, { idv, sex: 'female' });

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);

  // El animal aparece en la lista → tocarlo abre la ficha.
  const row = page.getByRole('button', { name: new RegExp(idv) }).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.click();

  // Ficha: el bloque "Historial" + el empty/sparse cálido (solo está el `initial`, que no se
  // muestra como nodo solitario → empty cálido).
  await expect(page.getByText('Historial', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Todavía no hay eventos', { exact: true })).toBeVisible();

  // ── Agregar un PESO. ──────────────────────────────────────────────────────────────────
  await page.getByRole('button', { name: 'Agregar evento', exact: true }).click();

  // Paso 1: elegir el tipo. Tocamos "Pesaje".
  await expect(page.getByText('¿Qué querés cargar?', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Pesaje', exact: true }).click();

  // Paso 2: cargar el peso (la fecha viene precargada con hoy).
  const weightInput = page.getByLabel('Peso en kilos', { exact: true });
  await expect(weightInput).toBeVisible({ timeout: 20_000 });
  await weightInput.fill('320');
  await page.getByRole('button', { name: 'Guardar evento', exact: true }).click();

  // De vuelta en la ficha: el timeline ahora muestra "Pesaje" + "320 kg" (el empty cálido se fue).
  await expect(page.getByText('Pesaje', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('320 kg', { exact: true })).toBeVisible();
  await expect(page.getByText('Todavía no hay eventos', { exact: true })).toHaveCount(0);

  // FIX C: "Estado actual" surfacea el peso vigente (el del último weight_event) como ATRIBUTO del
  // animal — "Peso actual" + el valor con su timestamp ("320 kg · Hoy", el peso se cargó recién).
  await expect(page.getByText('Estado actual', { exact: true })).toBeVisible();
  await expect(page.getByText('Peso actual', { exact: true })).toBeVisible();
  await expect(page.getByText(/320 kg · /)).toBeVisible();
  // La condición corporal todavía no se cargó → "Sin registrar" (la sección se muestra siempre).
  // Como el animal es HEMBRA, "Estado reproductivo" también muestra "Sin registrar" (C3.2a) → hay 2
  // filas "Sin registrar"; usamos .first() (su presencia es lo que importa, no la unicidad).
  await expect(page.getByText('Condición corporal', { exact: true })).toBeVisible();
  await expect(page.getByText('Sin registrar', { exact: true }).first()).toBeVisible();

  // ── Agregar una OBSERVACIÓN. ──────────────────────────────────────────────────────────
  await page.getByRole('button', { name: 'Agregar evento', exact: true }).click();
  await page.getByRole('button', { name: 'Observación', exact: true }).click();

  const obsText = 'Renguea de la pata derecha, revisar';
  const obsInput = page.getByLabel('Observación', { exact: true });
  await expect(obsInput).toBeVisible({ timeout: 20_000 });
  await obsInput.fill(obsText);
  await page.getByRole('button', { name: 'Guardar evento', exact: true }).click();

  // De vuelta en la ficha: la observación aparece arriba (más reciente), y el pesaje sigue.
  await expect(page.getByText(obsText, { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Pesaje', { exact: true })).toBeVisible();
});

test('agregar-evento: validación EN VIVO + rechazo de submit inválido (peso vacío)', async ({
  page,
}) => {
  const user = await createTestUser('eventvalid');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo EventValid');
  const idv = `6611${Date.now().toString().slice(-5)}`;
  await seedAnimal(establishmentId, rodeoId, { idv, sex: 'male' });

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);

  const row = page.getByRole('button', { name: new RegExp(idv) }).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.click();

  await page.getByRole('button', { name: 'Agregar evento', exact: true }).click();
  await page.getByRole('button', { name: 'Pesaje', exact: true }).click();

  // El peso filtra basura EN VIVO (solo decimal): tipeamos letras → queda vacío.
  const weightInput = page.getByLabel('Peso en kilos', { exact: true });
  await expect(weightInput).toBeVisible({ timeout: 20_000 });
  await weightInput.fill('abc');
  await expect(weightInput).toHaveValue('');

  // FIX B: la parte entera se acota a 4 cifras EN VIVO (ningún bovino llega a 5 cifras). Tipear
  // "12345" deja "1234" (el 5to dígito entero se descarta).
  await weightInput.fill('12345');
  await expect(weightInput).toHaveValue('1234');
  // Volvemos a vaciar el campo para probar abajo el rechazo de submit con peso vacío.
  await weightInput.fill('');
  await expect(weightInput).toHaveValue('');

  // Submit con el peso vacío → error, NO navega (seguimos en el wizard).
  await page.getByRole('button', { name: 'Guardar evento', exact: true }).click();
  await expect(page.getByText('Ingresá el peso en kilos.', { exact: true })).toBeVisible({ timeout: 10_000 });
  // Sigue en el wizard (el campo de peso sigue visible; no aterrizó en la ficha).
  await expect(weightInput).toBeVisible();
});

// Gate por SEXO de los eventos REPRODUCTIVOS (bug que Raf pegó en web): el wizard "Agregar evento"
// NO debe ofrecer Tacto/Servicio/Parto para un MACHO (tacto, servicio y parto son solo de hembras).
// Sembramos un macho → abrimos su ficha → Agregar evento → el paso 1 muestra SOLO "General"
// (Pesaje/Condición corporal/Observación), sin la sección "Reproductivo" ni sus 3 botones.
// (El test "reproductivo" de abajo cubre el caso HEMBRA: la sección SÍ aparece — espejo del gate.)
test('macho: el paso 1 NO ofrece eventos reproductivos (tacto/servicio/parto)', async ({ page }) => {
  const user = await createTestUser('machogate');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo MachoGate');
  const idv = `3311${Date.now().toString().slice(-5)}`;
  // MACHO → categoría inicial torito. La preñez/servicio/parto no aplican.
  await seedAnimal(establishmentId, rodeoId, { idv, sex: 'male' });

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);

  const row = page.getByRole('button', { name: new RegExp(idv) }).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.click();
  await expect(page.getByText('Historial', { exact: true })).toBeVisible({ timeout: 20_000 });

  await page.getByRole('button', { name: 'Agregar evento', exact: true }).click();
  await expect(page.getByText('¿Qué querés cargar?', { exact: true })).toBeVisible({ timeout: 20_000 });

  // SÍ están las 3 cards de "General" (un macho carga peso/condición/observación normal).
  await expect(page.getByRole('button', { name: 'Pesaje', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Condición corporal', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Observación', exact: true })).toBeVisible();

  // NO está la sección "Reproductivo" ni ninguno de sus 3 eventos (gate por sexo).
  await expect(page.getByText('Reproductivo', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Tacto', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Servicio', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Parto', exact: true })).toHaveCount(0);
});

// C3.2a — Reproductivo: Tacto (preñez) + Servicio simple. Verifica:
//   - el wizard agrupado (sección "Reproductivo") y el selector vertical de opciones,
//   - el evento "Tacto" aparece en el timeline,
//   - "Estado reproductivo" en "Estado actual" muestra "Preñada (cuerpo)" (deriveCurrentState),
//   - la TRANSICIÓN de categoría server-side real: el CategoryBadge del hero pasa a "Vaquillona preñada"
//     (un tacto positivo sobre una vaquillona dispara vaquillona → vaquillona_prenada),
//   - un Servicio ("Inseminación (IA)") aparece luego en el timeline con su tipo enriquecido (service_type).
//     B3 (RPSC.6.1): la carga manual ya NO ofrece "Monta natural" → el alta de servicio usa IA.
//
// La hembra se siembra con seedAnimal (categoría inicial vaquillona por sexo female, category_override
// false por default) → la transición server-side aplica al insertar el tacto positivo.
test('reproductivo: tacto (preñez media) → estado reproductivo + transición de categoría → servicio', async ({
  page,
}) => {
  const user = await createTestUser('repro');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Repro');
  const idv = `5511${Date.now().toString().slice(-5)}`;
  // Hembra → categoría inicial vaquillona (seedAnimal computa por sexo).
  await seedAnimal(establishmentId, rodeoId, { idv, sex: 'female' });

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);

  const row = page.getByRole('button', { name: new RegExp(idv) }).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.click();

  // Ficha cargada: el hero arranca en "Vaquillona" (categoría inicial). Anclamos al historial.
  await expect(page.getByText('Historial', { exact: true })).toBeVisible({ timeout: 20_000 });
  // Estado reproductivo arranca "Sin registrar" (no hay tacto/parto/aborto todavía). La sección
  // muestra peso + condición + (hembra) estado reproductivo.
  await expect(page.getByText('Estado reproductivo', { exact: true })).toBeVisible();

  // ── Agregar un TACTO con preñez media. ──────────────────────────────────────────────────
  await page.getByRole('button', { name: 'Agregar evento', exact: true }).click();

  // Paso 1 agrupado: la sección "Reproductivo" existe; tocamos "Tacto".
  await expect(page.getByText('¿Qué querés cargar?', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Reproductivo', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Tacto', exact: true }).click();

  // Paso 2: selector vertical de resultado. B1: el label es SOLO el término de campo → "Cuerpo".
  const pregOption = page.getByRole('button', { name: 'Cuerpo', exact: true });
  await expect(pregOption).toBeVisible({ timeout: 20_000 });
  await pregOption.click();
  await page.getByRole('button', { name: 'Guardar evento', exact: true }).click();

  // De vuelta en la ficha: el timeline muestra "Tacto"; el estado reproductivo muestra la preñez.
  // B1: la fila de estado lleva "Preñada (cuerpo)" (término entre paréntesis, sin palabra de tamaño).
  await expect(page.getByText('Tacto', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Preñada \(cuerpo\) · /)).toBeVisible();

  // La TRANSICIÓN server-side aplicó: el CategoryBadge del hero cambió de "Vaquillona" a la categoría
  // preñada. El nombre del catálogo es "Vaquillona preñada" (contiene "preñada"). Lo distinguimos del
  // texto del estado reproductivo ("Preñada — media (cuerpo)") matcheando el nombre de la CATEGORÍA
  // (empieza con "Vaquillona"), tolerante a mayúsc./minúsc. y a un cambio menor de copy del catálogo.
  await expect(page.getByText(/vaquillona pre[ñn]ada/i).first()).toBeVisible({ timeout: 20_000 });

  // ── Agregar un SERVICIO (Inseminación IA). ──────────────────────────────────────────────
  await page.getByRole('button', { name: 'Agregar evento', exact: true }).click();
  await page.getByRole('button', { name: 'Servicio', exact: true }).click();

  // Selector vertical de tipo de servicio. B3: "Monta natural" YA NO se ofrece → elegimos "Inseminación (IA)".
  await expect(page.getByRole('button', { name: 'Monta natural', exact: true })).toHaveCount(0);
  const ia = page.getByRole('button', { name: 'Inseminación (IA)', exact: true });
  await expect(ia).toBeVisible({ timeout: 20_000 });
  await ia.click();
  // Esta hembra FIGURA preñada (el tacto Cuerpo de arriba) → registrar un servicio dispara el AVISO
  // SUAVE "figura preñada, ¿registrar el servicio igual?". Lo aceptamos (page.once('dialog')); sin este
  // handler Playwright auto-dismiss el confirm y el servicio NO se registraría.
  let serviceDialog = '';
  page.once('dialog', async (dialog) => {
    serviceDialog = dialog.message();
    await dialog.accept();
  });
  await page.getByRole('button', { name: 'Guardar evento', exact: true }).click();
  await expect.poll(() => serviceDialog, { timeout: 20_000 }).toMatch(/figura preñada/i);

  // De vuelta en la ficha: el timeline muestra "Servicio" + el tipo enriquecido "Inseminación (IA)".
  await expect(page.getByText('Cargando ficha…', { exact: true })).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByText('Servicio', { exact: true }).filter({ visible: true })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText('Inseminación (IA)', { exact: true }).filter({ visible: true })).toBeVisible();
  // El tacto sigue en el timeline.
  await expect(page.getByText('Tacto', { exact: true }).filter({ visible: true }).first()).toBeVisible();
});

// C3.2b — PARTO con MELLIZOS (register_birth N terneros) + link a la MADRE (R14.7). Verifica:
//   - el form de parto: lista dinámica de terneros (agregar un 2do → mellizos, R9.5),
//   - register_birth crea ATÓMICAMENTE el evento + 2 terneros + transición de categoría server-side,
//   - de vuelta en la madre: nodo "Parto" en el timeline; "Estado reproductivo → Vacía" (parió);
//     el CategoryBadge transicionó (vaquillona_prenada → "vaca…", contiene "vaca"),
//   - los 2 terneros aparecen en la tab Animales con el visual "recién nacido — pendiente de caravana",
//   - abrir UN ternero → la card "Madre" muestra el idv de la madre → tocarla → ficha de la madre.
//
// Para que la madre sea vaquillona_prenada (y el parto la transicione a vaca_segundo_servicio),
// primero le damos un TACTO positivo por UI (B1: el label de cabeza/large es "Cabeza"), reusando C3.2a.
test('parto con mellizos: register_birth crea 2 terneros + transición + link a la madre (R14.7)', async ({
  page,
}) => {
  const user = await createTestUser('parto');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Parto');
  // Hembra → categoría inicial vaquillona. El IDV de la MADRE: lo usamos para abrir su ficha y, tras
  // navegar desde el ternero, para confirmar que aterrizamos en ella.
  const motherIdv = `4411${Date.now().toString().slice(-5)}`;
  await seedAnimal(establishmentId, rodeoId, { idv: motherIdv, sex: 'female' });

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);

  const motherRow = page.getByRole('button', { name: new RegExp(motherIdv) }).first();
  await expect(motherRow).toBeVisible({ timeout: 20_000 });
  await motherRow.click();
  await expect(page.getByText('Historial', { exact: true })).toBeVisible({ timeout: 20_000 });

  // ── 1) Tacto positivo (preñez grande) → la madre pasa a vaquillona_prenada. ───────────────
  await page.getByRole('button', { name: 'Agregar evento', exact: true }).click();
  await page.getByRole('button', { name: 'Tacto', exact: true }).click();
  const pregOption = page.getByRole('button', { name: 'Cabeza', exact: true });
  await expect(pregOption).toBeVisible({ timeout: 20_000 });
  await pregOption.click();
  await page.getByRole('button', { name: 'Guardar evento', exact: true }).click();
  await expect(page.getByText('Tacto', { exact: true })).toBeVisible({ timeout: 20_000 });
  // La transición server-side aplicó: el badge contiene "preñada" (vaquillona preñada).
  await expect(page.getByText(/vaquillona pre[ñn]ada/i).first()).toBeVisible({ timeout: 20_000 });

  // ── 2) PARTO con 2 terneros (mellizos). ───────────────────────────────────────────────────
  await page.getByRole('button', { name: 'Agregar evento', exact: true }).click();
  await expect(page.getByText('¿Qué querés cargar?', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Parto', exact: true }).click();

  // Por default hay UN ternero ("Ternero 1"). Agregamos un 2do (mellizos, R9.5).
  await expect(page.getByText('Ternero 1', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Agregar otro ternero', exact: true }).click();
  await expect(page.getByText('Ternero 2', { exact: true })).toBeVisible();

  // Elegimos el sexo de cada ternero (los selectores Macho/Hembra son por ternero; hay 2 de cada uno
  // → tomamos por orden con .nth()). Ternero 1 = Macho (1er "Macho"), Ternero 2 = Hembra (2do "Hembra").
  await page.getByRole('button', { name: 'Macho', exact: true }).first().click();
  await page.getByRole('button', { name: 'Hembra', exact: true }).nth(1).click();

  await page.getByRole('button', { name: 'Guardar evento', exact: true }).click();

  // ── 3) De vuelta en la ficha de la MADRE. ─────────────────────────────────────────────────
  // ANCLA: router.back() vuelve a la ficha y useFocusEffect dispara un refetch (detail+timeline+madre
  // en Promise.all, con "Cargando ficha…" hasta que resuelven). Esperamos a que la ficha esté
  // RECARGADA antes de asertar el estado derivado: "Historial" vuelve a estar y el "Cargando ficha…"
  // se fue. Sin esto, podríamos leer el estado del render previo (antes del refetch). Espera por
  // estado/elemento, NO timeout fijo.
  await expect(page.getByText('Cargando ficha…', { exact: true })).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByText('Historial', { exact: true })).toBeVisible({ timeout: 20_000 });

  // Nodo "Parto" en el timeline (señal determinística más fuerte: el evento se persistió).
  await expect(page.getByText('Parto', { exact: true })).toBeVisible({ timeout: 20_000 });
  // Estado reproductivo → "Vacía · …" (parió: ya no está preñada; deriveCurrentState con birth → empty).
  // DETERMINÍSTICO tras el fix de TAREA 2: el parto (created_at posterior) gana al tacto del mismo día,
  // aunque ambos caigan en el mismo event_date (columna `date`, sin hora). Antes era ~50% flake.
  await expect(page.getByText(/^Vacía · /)).toBeVisible({ timeout: 20_000 });
  // El CategoryBadge transicionó: vaquillona_prenada → vaca_segundo_servicio. El nombre del catálogo
  // contiene "vaca" (tolerante a copy exacto: "Vaca de segundo servicio" / similar). Lo distinguimos
  // del badge previo (que ya no debe decir "vaquillona preñada").
  // NOTA: NO asertamos que "vaquillona preñada" desaparezca: el timeline conserva el nodo de
  // category_change "Cambió a Vaquillona preñada (automático)" del tacto → ese texto persiste en el
  // historial para siempre (es historia, no estado). La señal de transición es el badge "vaca" del hero
  // + el estado reproductivo "Vacía" + el nodo "Parto", todos ya asertados arriba.
  await expect(page.getByText(/vaca/i).first()).toBeVisible({ timeout: 20_000 });

  // ── 4) Los 2 terneros aparecen en la tab Animales con el visual de "pendiente de caravana". ─
  await page.getByRole('button', { name: 'Volver', exact: true }).click();
  await gotoAnimales(page);
  // El visual_id_alt fallback "recién nacido — pendiente de caravana" aparece (hay 2; tomamos uno).
  const calfRow = page
    .getByRole('button', { name: /recién nacido — pendiente de caravana/ })
    .first();
  await expect(calfRow).toBeVisible({ timeout: 20_000 });

  // ── 5) Abrir UN ternero → card "Madre" → tocarla → ficha de la madre. ─────────────────────
  await calfRow.click();
  // La ficha del ternero: la card "Madre" muestra el idv de la madre (R14.7).
  await expect(page.getByText('Madre', { exact: true })).toBeVisible({ timeout: 20_000 });
  const motherCard = page.getByRole('button', { name: new RegExp(`ficha de la madre.*${motherIdv}`) });
  await expect(motherCard).toBeVisible({ timeout: 20_000 });
  await motherCard.click();

  // Aterrizamos en la ficha de la MADRE. ANCLA: el IDV de la madre (hero + fila de identificación).
  //
  // ⚠️ En web, Expo Router deja montadas DETRÁS las pantallas previas del stack (aria-hidden): acá
  // conviven la instancia VIEJA de la ficha de la madre (la del paso 3, oculta) + la del ternero
  // (oculta) + la NUEVA de la madre (visible). Por eso el motherIdv aparece varias veces en el DOM y
  // un `.first()` puede caer en una instancia OCULTA → "hidden". Filtramos a la ocurrencia VISIBLE
  // (`filter({ visible: true })`) para anclar inequívocamente en la ficha en pantalla. Espera por
  // estado/elemento, sin timeout fijo.
  await expect(
    page.getByText(motherIdv, { exact: true }).filter({ visible: true }).first(),
  ).toBeVisible({ timeout: 20_000 });
  // Y el "Parto" sigue en su timeline visible (confirma que es la madre, no otro animal).
  await expect(
    page.getByText('Parto', { exact: true }).filter({ visible: true }).first(),
  ).toBeVisible({ timeout: 20_000 });
});

// C3.2 gating final — AVISO SUAVE: PARTO sobre una hembra que NO figura preñada (no bloqueo). Un parto
// solo lo da una hembra preñada, PERO puede estar preñada de verdad sin el tacto cargado (figura "Sin
// registrar"); el parto ya es prueba de la preñez. Entonces NO bloqueamos: al "Guardar evento" de un
// PARTO sobre una hembra que no figura preñada, aparece una CONFIRMACIÓN suave ("no figura preñada,
// ¿registrar igual?"). Si confirma → procede y crea el parto. Si la hembra SÍ figura preñada (tacto
// positivo previo), NO hay aviso → eso ya lo cubre el test "parto con mellizos" de arriba (le da un
// tacto Cabeza antes del parto → figura preñada → guarda directo, sin window.confirm).
//
// El aviso es window.confirm en web → en Playwright hay que manejar el dialog explícitamente
// (page.once('dialog')): si NO lo manejáramos, Playwright lo auto-dismiss (devuelve false) y el parto
// no procedería. Asertamos el TEXTO del diálogo + que al aceptar el parto se crea.
test('parto en hembra NO preñada: aparece el aviso suave → al confirmar crea el parto (no bloqueo)', async ({
  page,
}) => {
  const user = await createTestUser('partoaviso');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo PartoAviso');
  // Hembra → vaquillona. SIN tacto previo → "Estado reproductivo: Sin registrar" → NO figura preñada.
  const idv = `2211${Date.now().toString().slice(-5)}`;
  await seedAnimal(establishmentId, rodeoId, { idv, sex: 'female' });

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);

  const row = page.getByRole('button', { name: new RegExp(idv) }).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.click();
  await expect(page.getByText('Historial', { exact: true })).toBeVisible({ timeout: 20_000 });
  // De partida la hembra NO figura preñada (Sin registrar) — el estado reproductivo arranca vacío.
  await expect(page.getByText('Estado reproductivo', { exact: true })).toBeVisible();

  // ── Registrar un PARTO directamente, SIN tacto previo. ────────────────────────────────────
  await page.getByRole('button', { name: 'Agregar evento', exact: true }).click();
  await expect(page.getByText('¿Qué querés cargar?', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Parto', exact: true }).click();

  // Ternero 1: elegimos el sexo (requerido) — un solo ternero alcanza.
  await expect(page.getByText('Ternero 1', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Macho', exact: true }).first().click();

  // El "Guardar evento" dispara el AVISO SUAVE (window.confirm). Capturamos el dialog: verificamos
  // que el mensaje habla de "no figura preñada" y lo ACEPTAMOS (= "Registrar igual"). Sin este
  // handler, Playwright auto-dismiss el confirm (false) y el parto no se crearía.
  let dialogText = '';
  page.once('dialog', async (dialog) => {
    dialogText = dialog.message();
    await dialog.accept();
  });
  await page.getByRole('button', { name: 'Guardar evento', exact: true }).click();

  // El diálogo apareció con el copy del aviso suave (no un error de "no podés", sino "¿registrar igual?").
  await expect.poll(() => dialogText, { timeout: 20_000 }).toMatch(/no figura preñada/i);
  await expect.poll(() => dialogText).toMatch(/registrar el parto igual/i);

  // Tras CONFIRMAR el parto procede: de vuelta en la ficha de la madre, el nodo "Parto" aparece en el
  // timeline (se persistió) y el estado reproductivo pasa a "Vacía" (parió).
  await expect(page.getByText('Cargando ficha…', { exact: true })).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByText('Parto', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/^Vacía · /)).toBeVisible({ timeout: 20_000 });
});

// C3.2 gating final — ESPEJO (camino preñada): una hembra que SÍ figura preñada (tacto positivo previo)
// NO debe disparar el aviso al registrar el parto → guarda DIRECTO. Verificación fuerte: registramos un
// page.on('dialog') que FALLA si aparece un confirm; el parto debe completarse sin él.
test('parto en hembra PREÑADA: NO aparece aviso → guarda directo (sin confirmación)', async ({
  page,
}) => {
  const user = await createTestUser('partosinaviso');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo PartoSinAviso');
  const idv = `1122${Date.now().toString().slice(-5)}`;
  await seedAnimal(establishmentId, rodeoId, { idv, sex: 'female' });

  // Cualquier window.confirm que se dispare es un BUG (la hembra figura preñada → no debe avisar).
  let unexpectedDialog = false;
  page.on('dialog', async (dialog) => {
    unexpectedDialog = true;
    await dialog.dismiss();
  });

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);

  const row = page.getByRole('button', { name: new RegExp(idv) }).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.click();
  await expect(page.getByText('Historial', { exact: true })).toBeVisible({ timeout: 20_000 });

  // ── 1) Tacto positivo (Cabeza) → la hembra FIGURA preñada. ────────────────────────────────
  await page.getByRole('button', { name: 'Agregar evento', exact: true }).click();
  await page.getByRole('button', { name: 'Tacto', exact: true }).click();
  const pregOption = page.getByRole('button', { name: 'Cabeza', exact: true });
  await expect(pregOption).toBeVisible({ timeout: 20_000 });
  await pregOption.click();
  await page.getByRole('button', { name: 'Guardar evento', exact: true }).click();
  await expect(page.getByText('Tacto', { exact: true })).toBeVisible({ timeout: 20_000 });
  // El estado reproductivo confirma que figura preñada (deriveCurrentState computa pregnant del tacto).
  await expect(page.getByText(/Preñada \(cabeza\) · /)).toBeVisible({ timeout: 20_000 });

  // ── 2) PARTO → debe guardar DIRECTO, sin aviso. ───────────────────────────────────────────
  await page.getByRole('button', { name: 'Agregar evento', exact: true }).click();
  await page.getByRole('button', { name: 'Parto', exact: true }).click();
  await expect(page.getByText('Ternero 1', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Macho', exact: true }).first().click();
  await page.getByRole('button', { name: 'Guardar evento', exact: true }).click();

  // El parto se creó sin confirmación: nodo "Parto" + estado "Vacía".
  await expect(page.getByText('Cargando ficha…', { exact: true })).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByText('Parto', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/^Vacía · /)).toBeVisible({ timeout: 20_000 });
  // Y NUNCA apareció un window.confirm (la hembra figuraba preñada → guarda directo).
  expect(unexpectedDialog).toBe(false);
});

// C3.2 gating reproductivo — ABORTO (nuevo tipo): cargar un aborto sobre una hembra → aparece el nodo
// "Aborto" en el timeline + el estado reproductivo pasa a "Vacía" (el aborto revierte la preñez) + el
// flag "Tuvo aborto" (terracota, A2) aparece en el hero de la ficha. El aborto sobre una hembra que NO
// figura preñada dispara el aviso suave "no figura preñada, ¿registrar el aborto igual?" → lo
// confirmamos (page.once('dialog')) para que proceda.
test('aborto: cargar un aborto → nodo "Aborto" + estado "Vacía" + flag "Tuvo aborto" en la ficha', async ({
  page,
}) => {
  const user = await createTestUser('aborto');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Aborto');
  const idv = `8811${Date.now().toString().slice(-5)}`;
  // Hembra → vaquillona. La sembramos PREÑADA por UI (tacto Cabeza) para que el aborto no dispare el
  // aviso de "no figura preñada" en este test (lo que probamos acá es el evento + estado + flag).
  await seedAnimal(establishmentId, rodeoId, { idv, sex: 'female' });

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);

  const row = page.getByRole('button', { name: new RegExp(idv) }).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.click();
  await expect(page.getByText('Historial', { exact: true })).toBeVisible({ timeout: 20_000 });

  // ── 1) Tacto positivo (Cabeza) → la hembra FIGURA preñada (así el aborto guarda directo). ──
  await page.getByRole('button', { name: 'Agregar evento', exact: true }).click();
  await page.getByRole('button', { name: 'Tacto', exact: true }).click();
  const pregOption = page.getByRole('button', { name: 'Cabeza', exact: true });
  await expect(pregOption).toBeVisible({ timeout: 20_000 });
  await pregOption.click();
  await page.getByRole('button', { name: 'Guardar evento', exact: true }).click();
  await expect(page.getByText('Tacto', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Preñada \(cabeza\) · /)).toBeVisible({ timeout: 20_000 });

  // ── 2) Cargar un ABORTO (la 4ta card de "Reproductivo"). ──────────────────────────────────
  await page.getByRole('button', { name: 'Agregar evento', exact: true }).click();
  await expect(page.getByText('¿Qué querés cargar?', { exact: true })).toBeVisible({ timeout: 20_000 });
  // La card "Aborto" existe en la sección Reproductivo (solo hembras).
  await page.getByRole('button', { name: 'Aborto', exact: true }).click();

  // Paso 2 "Aborto": solo fecha (prefill hoy) + notas opcionales. El campo de fecha del aborto confirma
  // que estamos en el form correcto. Guardamos directo (figura preñada → sin aviso).
  await expect(page.getByLabel('Fecha del aborto (AAAA-MM-DD)', { exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await page.getByRole('button', { name: 'Guardar evento', exact: true }).click();

  // ── 3) De vuelta en la ficha: nodo "Aborto" + estado "Vacía" + flag "Tuvo aborto". ──────────
  await expect(page.getByText('Cargando ficha…', { exact: true })).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByText('Historial', { exact: true }).filter({ visible: true })).toBeVisible({
    timeout: 20_000,
  });
  // Nodo "Aborto" en el timeline (el evento se persistió). filter visible: Expo Router web deja pantallas
  // previas montadas aria-hidden (la card "Aborto" del paso 1) → anclamos a la ocurrencia visible.
  await expect(
    page.getByText('Aborto', { exact: true }).filter({ visible: true }).first(),
  ).toBeVisible({ timeout: 20_000 });
  // El aborto revierte la preñez → estado reproductivo "Vacía · …" (deriveCurrentState con abortion).
  await expect(page.getByText(/^Vacía · /)).toBeVisible({ timeout: 20_000 });
  // El flag "Tuvo aborto" (A2, terracota) aparece en el hero — permanente, derivado del timeline.
  await expect(page.getByText('Tuvo aborto', { exact: true }).filter({ visible: true })).toBeVisible({
    timeout: 20_000,
  });
});

// C3.2 gating reproductivo — AVISO SUAVE de SERVICIO sobre una hembra PREÑADA (no bloqueo). No se da
// servicio a una hembra ya preñada, PERO puede figurar preñada por un tacto viejo y haberlo perdido sin
// registrarlo → avisamos suave ("figura preñada, ¿registrar el servicio igual?") y dejamos confirmar.
// La hembra figura preñada por un tacto positivo previo (Cabeza).
test('servicio en hembra PREÑADA: aparece el aviso "figura preñada" → al confirmar registra', async ({
  page,
}) => {
  const user = await createTestUser('servpren');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo ServPren');
  const idv = `9911${Date.now().toString().slice(-5)}`;
  await seedAnimal(establishmentId, rodeoId, { idv, sex: 'female' });

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);

  const row = page.getByRole('button', { name: new RegExp(idv) }).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.click();
  await expect(page.getByText('Historial', { exact: true })).toBeVisible({ timeout: 20_000 });

  // ── 1) Tacto positivo (Cabeza) → la hembra FIGURA preñada. ────────────────────────────────
  await page.getByRole('button', { name: 'Agregar evento', exact: true }).click();
  await page.getByRole('button', { name: 'Tacto', exact: true }).click();
  const pregOption = page.getByRole('button', { name: 'Cabeza', exact: true });
  await expect(pregOption).toBeVisible({ timeout: 20_000 });
  await pregOption.click();
  await page.getByRole('button', { name: 'Guardar evento', exact: true }).click();
  await expect(page.getByText('Tacto', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Preñada \(cabeza\) · /)).toBeVisible({ timeout: 20_000 });

  // ── 2) Registrar un SERVICIO (IA) → debe disparar el aviso suave "figura preñada". ──────────
  await page.getByRole('button', { name: 'Agregar evento', exact: true }).click();
  await page.getByRole('button', { name: 'Servicio', exact: true }).click();
  // B3: el alta manual ya NO ofrece "Monta natural" → usamos "Inseminación (IA)".
  const ia = page.getByRole('button', { name: 'Inseminación (IA)', exact: true });
  await expect(ia).toBeVisible({ timeout: 20_000 });
  await ia.click();

  // El "Guardar evento" dispara el window.confirm del aviso suave: capturamos el dialog, verificamos el
  // copy ("figura preñada" / "registrar el servicio igual") y lo ACEPTAMOS.
  let dialogText = '';
  page.once('dialog', async (dialog) => {
    dialogText = dialog.message();
    await dialog.accept();
  });
  await page.getByRole('button', { name: 'Guardar evento', exact: true }).click();

  await expect.poll(() => dialogText, { timeout: 20_000 }).toMatch(/figura preñada/i);
  await expect.poll(() => dialogText).toMatch(/registrar el servicio igual/i);

  // Tras confirmar, el servicio se registra: de vuelta en la ficha el nodo "Servicio" + "Inseminación (IA)".
  await expect(page.getByText('Cargando ficha…', { exact: true })).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByText('Servicio', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Inseminación (IA)', { exact: true })).toBeVisible({ timeout: 20_000 });
});

// B3 (spec 03 Stream B / RPSC.6) — BAJA de la carga manual de "monta natural". Verifica:
//   (1) RPSC.6.1: el alta manual de servicio de la ficha YA NO ofrece "Monta natural" como tipo.
//   (2) RPSC.6.2 / DD-PSC-6: SÍ ofrece "Inseminación (IA)" y "Transferencia embrionaria (TE)" (intactas).
//   (3) RPSC.6.3 (backward-compat): un evento `service` con service_type='natural' HISTÓRICO (sembrado
//       por admin, como si se hubiera cargado antes de la baja) SIGUE renderizando en el timeline con su
//       label "Monta natural" — la baja es de la VÍA DE CARGA nueva, no de la historia.
test('B3 baja monta natural: el alta manual ofrece IA/TE y NO monta natural; el histórico natural sigue en el timeline', async ({
  page,
}) => {
  const user = await createTestUser('b3montanatural');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo B3MontaNat');
  const idv = `5533${Date.now().toString().slice(-5)}`;
  const profileId = await seedAnimal(establishmentId, rodeoId, { idv, sex: 'female' });
  // Evento HISTÓRICO de monta natural cargado "antes" de la baja (vía admin, service_role). Debe seguir
  // visible en el timeline (RPSC.6.3) aunque ya no se pueda CREAR uno nuevo a mano.
  await seedReproductiveServiceEvent(profileId, { serviceType: 'natural' });

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);

  const row = page.getByRole('button', { name: new RegExp(idv) }).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.click();
  await expect(page.getByText('Historial', { exact: true })).toBeVisible({ timeout: 20_000 });

  // (3) El servicio HISTÓRICO de monta natural sigue en el timeline (render intacto, label "Monta natural").
  await expect(page.getByText('Servicio', { exact: true }).filter({ visible: true }).first()).toBeVisible({
    timeout: 20_000,
  });
  await expect(
    page.getByText('Monta natural', { exact: true }).filter({ visible: true }).first(),
  ).toBeVisible({ timeout: 20_000 });

  // ── Abrir el alta manual de servicio: el selector de tipo. ──────────────────────────────────
  await page.getByRole('button', { name: 'Agregar evento', exact: true }).click();
  await expect(page.getByText('¿Qué querés cargar?', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Servicio', exact: true }).click();

  // (2) El selector OFRECE IA + TE (carga reproductiva real per-vaca, intactas).
  await expect(page.getByRole('button', { name: 'Inseminación (IA)', exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await expect(
    page.getByRole('button', { name: 'Transferencia embrionaria (TE)', exact: true }),
  ).toBeVisible();
  // (1) El selector YA NO ofrece "Monta natural" (RPSC.6.1).
  await expect(page.getByRole('button', { name: 'Monta natural', exact: true })).toHaveCount(0);
});

// BUG DE ORDEN DEL TIMELINE (fix 0069 + parseTimeline): un evento TIPADO (date-only, vuelve 00:00 UTC)
// cargado HOY aparecía POR DEBAJO de los eventos del mismo día con hora real (el "Alta"/category_change,
// las observaciones). Causa: el orden era por event_date y los date-only volvían como medianoche-UTC
// (00:00) < la hora real (ej. 15:45) de los timestamp-events. El fix ordena por (día calendario desc,
// created_at desc) → lo recién registrado queda ARRIBA dentro de su día.
//
// Verificación: seed de un animal → su único nodo es el "Alta" (category_change `initial`, con hora real
// del seed). Cargamos un SERVICIO (date-only, created_at = ahora, posterior al seed) → el nodo "Servicio"
// debe aparecer ARRIBA del nodo "Cambió a…"/"Alta" del MISMO día. Comparamos la posición VERTICAL real
// (boundingBox().y): arriba = y menor. Antes del fix, el "Servicio" caía al fondo (00:00 < hora del seed).
test('orden del timeline: un SERVICIO cargado hoy aparece ARRIBA del "Cambió a…" del mismo día (bug 0069)', async ({
  page,
}) => {
  const user = await createTestUser('orden');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo Orden');
  // Hembra → vaquillona. Un servicio sobre una vaquillona la mantiene/confirma vaquillona; lo que nos
  // importa es que el nodo "Servicio" (date-only, recién cargado) gane al category_change del seed.
  const idv = `6622${Date.now().toString().slice(-5)}`;
  await seedAnimal(establishmentId, rodeoId, { idv, sex: 'female' });

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);

  const row = page.getByRole('button', { name: new RegExp(idv) }).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.click();
  await expect(page.getByText('Historial', { exact: true })).toBeVisible({ timeout: 20_000 });

  // ── Cargar un SERVICIO (IA). La hembra no figura preñada → guarda directo (sin aviso). ──
  // B3: el alta manual ya NO ofrece "Monta natural" → usamos "Inseminación (IA)".
  await page.getByRole('button', { name: 'Agregar evento', exact: true }).click();
  await expect(page.getByText('¿Qué querés cargar?', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Servicio', exact: true }).click();
  const ia = page.getByRole('button', { name: 'Inseminación (IA)', exact: true });
  await expect(ia).toBeVisible({ timeout: 20_000 });
  await ia.click();
  await page.getByRole('button', { name: 'Guardar evento', exact: true }).click();

  // De vuelta en la ficha: el timeline muestra "Servicio" + "Inseminación (IA)" y el "Alta" del seed.
  await expect(page.getByText('Cargando ficha…', { exact: true })).toHaveCount(0, { timeout: 20_000 });
  const servicio = page.getByText('Servicio', { exact: true }).filter({ visible: true }).first();
  // El nodo del seed: el category_change `initial` → título "Alta" (describeCategoryChange).
  const alta = page.getByText('Alta', { exact: true }).filter({ visible: true }).first();
  await expect(servicio).toBeVisible({ timeout: 20_000 });
  await expect(alta).toBeVisible({ timeout: 20_000 });

  // ── La aserción del BUG: el "Servicio" (recién cargado hoy) está ARRIBA del "Alta" del mismo día. ──
  // Arriba = coordenada Y MENOR. Antes del fix 0069, el date-only (00:00 UTC) caía debajo del "Alta"
  // (hora real del seed) → el servicio estaba al FONDO. Ahora el created_at (now() de inserción) lo
  // sube. Comparamos las posiciones verticales reales en pantalla (no el orden del DOM a ciegas).
  const servicioBox = await servicio.boundingBox();
  const altaBox = await alta.boundingBox();
  expect(servicioBox).not.toBeNull();
  expect(altaBox).not.toBeNull();
  expect(servicioBox!.y).toBeLessThan(altaBox!.y);
});

// C3.2 gating reproductivo — ESPEJO: SERVICIO sobre una hembra que NO figura preñada NO debe avisar →
// guarda DIRECTO (es el caso normal). Verificación fuerte: page.on('dialog') que FALLA si aparece un
// confirm; el servicio debe completarse sin él.
test('servicio en hembra NO preñada: NO aparece aviso → guarda directo (sin confirmación)', async ({
  page,
}) => {
  const user = await createTestUser('servsinpren');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo ServSinPren');
  // Hembra → vaquillona, SIN tacto previo → NO figura preñada (Sin registrar).
  const idv = `7733${Date.now().toString().slice(-5)}`;
  await seedAnimal(establishmentId, rodeoId, { idv, sex: 'female' });

  // Cualquier window.confirm que se dispare es un BUG (la hembra no figura preñada → servicio directo).
  let unexpectedDialog = false;
  page.on('dialog', async (dialog) => {
    unexpectedDialog = true;
    await dialog.dismiss();
  });

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);

  const row = page.getByRole('button', { name: new RegExp(idv) }).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.click();
  await expect(page.getByText('Historial', { exact: true })).toBeVisible({ timeout: 20_000 });
  // De partida NO figura preñada.
  await expect(page.getByText('Estado reproductivo', { exact: true })).toBeVisible();

  // Registrar un SERVICIO (IA) directamente, SIN tacto previo → debe guardar sin aviso.
  // B3: el alta manual ya NO ofrece "Monta natural" → usamos "Inseminación (IA)".
  await page.getByRole('button', { name: 'Agregar evento', exact: true }).click();
  await page.getByRole('button', { name: 'Servicio', exact: true }).click();
  const ia = page.getByRole('button', { name: 'Inseminación (IA)', exact: true });
  await expect(ia).toBeVisible({ timeout: 20_000 });
  await ia.click();
  await page.getByRole('button', { name: 'Guardar evento', exact: true }).click();

  // El servicio se creó sin confirmación: nodo "Servicio" + "Inseminación (IA)".
  await expect(page.getByText('Cargando ficha…', { exact: true })).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByText('Servicio', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Inseminación (IA)', { exact: true })).toBeVisible({ timeout: 20_000 });
  // Y NUNCA apareció un window.confirm (no figura preñada → guarda directo).
  expect(unexpectedDialog).toBe(false);
});

// ════════════════════════════════════════════════════════════════════════════════════════════
// C6 — Espejo client-side de categoría (offline) + visibilidad del override (spec 02, RC6.x).
// ════════════════════════════════════════════════════════════════════════════════════════════

// C6 / RC6.3.1 — ESPEJO: una hembra vaquillona + tacto positivo → el hero muestra "Vaquillona preñada"
// DERIVADA LOCALMENTE por el espejo, sin depender del sync-down server-side. Antes de C6 este badge
// dependía de que la transición server-side volviera por sync (flaky/lento); ahora el espejo lo computa
// del evento local recién escrito → determinístico. (Es el gap que cierra los e2e de transición.)
test('C6 espejo: tacto+ sobre vaquillona → el hero muestra "Vaquillona preñada" derivado localmente', async ({
  page,
}) => {
  const user = await createTestUser('c6espejo');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo C6Espejo');
  const idv = `9911${Date.now().toString().slice(-5)}`;
  // Hembra → vaquillona, category_override=false (default) → el espejo aplica.
  await seedAnimal(establishmentId, rodeoId, { idv, sex: 'female' });

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);

  const row = page.getByRole('button', { name: new RegExp(idv) }).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.click();
  await expect(page.getByText('Historial', { exact: true })).toBeVisible({ timeout: 20_000 });
  // El hero arranca en "Vaquillona" (categoría inicial sembrada). Anclamos por el a11y label del
  // CategoryBadge (el texto del badge tiene overflow-hidden por numberOfLines → el span pelado puede
  // evaluar "hidden" en Playwright; el aria-label del contenedor es estable).
  await expect(page.getByLabel('Categoría Vaquillona', { exact: true }).filter({ visible: true }).first()).toBeVisible({ timeout: 20_000 });

  // Tacto positivo (Cuerpo = medium). addTacto escribe el evento en reproductive_events LOCAL.
  await page.getByRole('button', { name: 'Agregar evento', exact: true }).click();
  await page.getByRole('button', { name: 'Tacto', exact: true }).click();
  const pregOption = page.getByRole('button', { name: 'Cuerpo', exact: true });
  await expect(pregOption).toBeVisible({ timeout: 20_000 });
  await pregOption.click();
  await page.getByRole('button', { name: 'Guardar evento', exact: true }).click();

  // De vuelta en la ficha: el ESPEJO derivó vaquillona_prenada del tacto local → el hero muestra el badge
  // "Vaquillona preñada" (categoría del catálogo, contiene "preñada"). Anclamos por el a11y label del
  // CategoryBadge. NO se muestra el indicador de "fijada manualmente" (override sigue false: transición auto).
  await expect(page.getByText('Tacto', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByLabel(/Categoría Vaquillona pre[ñn]ada/i).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Categoría fijada manualmente', { exact: true })).toHaveCount(0);
});

// C6 / RC6.4 — OVERRIDE: una hembra con categoría FIJADA manualmente (category_override=true) muestra el
// indicador "Categoría fijada manualmente" en la ficha + la acción "Quitar fijación". Al quitarla
// (confirmación inline), el override se limpia y el hero pasa a mostrar la categoría DERIVADA por el
// espejo (multipara fijada sobre una hembra sin partos → al revertir, el espejo deriva "Vaquillona").
test('C6 override: badge "Categoría fijada manualmente" + quitar fijación → hero pasa a la derivada', async ({
  page,
}) => {
  const user = await createTestUser('c6override');
  await setUserPhone(user.id, '1123456789');
  const { establishmentId, rodeoId } = await seedEstablishmentWithRodeo(user.id, 'Campo C6Override');
  const idv = `8811${Date.now().toString().slice(-5)}`;
  // Hembra FIJADA como "Multípara" a mano (override=true), SIN eventos de parto. El server NO la
  // transiciona (override manda). Al QUITAR la fijación, el espejo deriva su categoría real: sin partos
  // ni tactos y sin birth_date conocida → "Vaquillona" (default conservador de la rama hembra).
  await seedAnimal(establishmentId, rodeoId, {
    idv,
    sex: 'female',
    categoryCode: 'multipara',
    categoryOverride: true,
  });

  await page.goto('/');
  await signIn(page, user);
  await waitForHome(page);
  await gotoAnimales(page);

  const row = page.getByRole('button', { name: new RegExp(idv) }).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.click();
  await expect(page.getByText('Historial', { exact: true })).toBeVisible({ timeout: 20_000 });

  // El indicador "Categoría fijada manualmente" está visible (override=true). El hero muestra "Multípara"
  // (la guardada — el espejo NO aplica con override=true, RC6.3.3). El a11y label del badge con override
  // lleva el sufijo ", fijada manualmente".
  await expect(page.getByText('Categoría fijada manualmente', { exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByLabel('Categoría Multípara, fijada manualmente', { exact: true })).toBeVisible();

  // Quitar la fijación: la acción + la confirmación inline.
  await page.getByRole('button', { name: 'Quitar fijación', exact: true }).click();
  // RC6.4.6 (Nielsen #1 visibilidad / #5 prevención de error): la confirmación ANTICIPA la CONSECUENCIA
  // — a qué categoría AUTOMÁTICA volvería el animal (el NAME legible de la derivada por el espejo, no el
  // code). Para esta multípara-sin-partos la derivada es "Vaquillona". El texto se resuelve async (preview
  // del service) → lo esperamos antes de confirmar.
  await expect(page.getByText('La categoría pasará a Vaquillona.', { exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await page.getByRole('button', { name: 'Sí, quitar', exact: true }).click();

  // Tras el revert (UPDATE local override=false + category_id derivada): la ficha recarga, el indicador
  // desaparece y el hero muestra la categoría DERIVADA por el espejo ("Vaquillona", sin sufijo manual).
  await expect(page.getByText('Cargando ficha…', { exact: true })).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByText('Categoría fijada manualmente', { exact: true })).toHaveCount(0, {
    timeout: 20_000,
  });
  await expect(page.getByLabel('Categoría Vaquillona', { exact: true }).filter({ visible: true }).first()).toBeVisible({ timeout: 20_000 });
});
