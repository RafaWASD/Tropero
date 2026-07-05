// app/crear-animal.tsx — alta guiada (wizard, spec 02 frontend "alta guiada" A; reusa find-or-create
// de C2 / spec 09 R4).
//
// REDISEÑO de C2 (form plano → wizard guiado manga-friendly, "alta = mini-maniobra"). El find-or-create
// NO cambia: el identificador tipeado precargado (idv si numérico, visual si texto — heurística R1.4 de
// animales.tsx) llega por params, read-only, y se muestra en el header del wizard ("Creando: [id]"). El
// wizard arranca DESPUÉS del id, con 4 pasos, una decisión clara por pantalla:
//
//   PASO 1 — RODEO   : 1 rodeo → fijo read-only + auto-avanza al paso 2; ≥2 → selector vertical. (R4.4/R6)
//   PASO 2 — SEXO    : 2 opciones grandes Macho/Hembra (full-screen, una decisión por pantalla). (R4.5)
//   PASO 3 — CATEGORÍA: selector CERRADO vertical full-width, filtrado por (sistema del rodeo, sexo).
//                       Las categorías salen de fetchSystemCategories(systemId) + categoriesForSex.
//   PASO 4 — DATOS   : el form de datos de C2 (fecha nac, raza, pelaje, ingreso, peso, lote) MENOS el
//                       selector de rodeo y de sexo (ahora pasos 1 y 2). CTA "Crear animal" acá.
//
// OVERRIDE (alta guiada A #4): la categoría ELEGIDA (paso 3) reemplaza a la computada. Al submit,
// categoryOverrideFor(chosen, sex, birthDate) decide: coincide con la computada → override=false
// (auto-transiciona); difiere → override=true (preserva la elección, ej. multípara comprada). El
// service createAnimal recibe categoryCode + categoryOverride y resuelve category_id por code.
//
// Header con back paso a paso (paso 2→1, 3→2, 4→3; en el paso 1, backOr a la lista de animales) +
// indicador "Paso N de 4" + CTA fijo abajo (zona pulgar). Criticidad 🟡. Cero hardcode (ADR-023 §4):
// tokens + componentes; lo que cruza a API no-Tamagui (íconos lucide) con getTokenValue. a11y por
// helper (buttonA11y/labelA11y, nunca crudo). Validación robusta en vivo (lección C2): los inputs del
// paso 4 se conservan tal cual; el selector de categoría es CERRADO.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, type ScrollView as RNScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { getTokenValue, ScrollView, Text, View, XStack, YStack } from 'tamagui';
import { Check, ChevronDown, ChevronLeft, Mars, Venus, X } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';

import { Button, Card, ConditionScoreStepper, FormField, FormError, InfoNote, LinkCalfPrompt } from '@/components';
import { BreedPickerSheet } from '@/components/sigsa';
import { useAuth, useEstablishment, useRodeo } from '@/contexts';
import { createAnimal, fetchSystemCategories, type SystemCategory } from '@/services/animals';
import { fetchBreedCatalog } from '@/services/sigsa/sigsa-export-service';
import { selectedBreedLabel, type BreedCatalogEntry } from '@/utils/breed-picker';
import { useBusyWhileMounted } from '@/services/ble/stick';
import { addConditionScore, addTacto, addTactoVaquillona } from '@/services/events';
import type { HeiferFitness } from '@/utils/maneuver-sequence';
import { setCustomAttribute } from '@/services/custom-attributes';
import {
  CustomPropertiesForm,
  type CustomPropertiesFormHandle,
} from './maniobra/_components/CustomPropertiesSection';
import { fetchManagementGroups, type ManagementGroup } from '@/services/management-groups';
import {
  readLastRodeo,
  writeLastRodeo,
  queryLastUsedRodeoFromDb,
  resolveDefaultRodeoId,
} from '@/services/last-rodeo';
import type { Rodeo } from '@/services/rodeos';
import { parseWeight, hasAtLeastOneIdentifier } from '@/utils/animal-form';
import {
  sanitizeTagInput,
  sanitizeIdvInput,
  sanitizeWeightInput,
  isValidTagElectronic,
  TAG_ELECTRONIC_LENGTH,
} from '@/utils/animal-input';
import { categoryOverrideFor, imputeBirthDateForCategory, type AnimalSex } from '@/utils/animal-category';
import { categoriesForSex } from '@/utils/animal-category-picker';
import {
  fieldsForCategory,
  TEETH_OPTIONS,
  type CategoryDataField,
  type TeethState,
} from '@/utils/animal-category-fields';
import { PREGNANCY_OPTIONS } from '@/utils/event-input';
import { SCORE_DEFAULT } from '@/utils/condition-stepper';
import {
  sanitizeBirthYearInput,
  sanitizeDayMonthInput,
  validateBirthDate,
  isPregnantStatus,
  type PregnancyStatus,
} from '@/utils/animal-birth-year';
import { buttonA11y, labelA11y } from '@/utils/a11y';
import { backOr } from '@/utils/nav';

const OFFLINE_COPY =
  'Necesitás conexión para dar de alta un animal. Conectate a internet y volvé a intentar.';

// Tope de texto libre (pelaje): acotado para que no se vuelva un campo de párrafo. (La raza ya no es texto
// libre: el BreedPicker la elige del catálogo SENASA — spec 08, T18 — y setea `breed` con el nombre del catálogo.)
const COAT_MAX_LENGTH = 40;

const TOTAL_STEPS = 4;

// Fecha de hoy en ISO 'YYYY-MM-DD' (local) para fechar los eventos post-create (condición/preñez). El
// caso del alta es "lo cargué hoy" — el evento se fecha hoy (mismo patrón que agregar-evento.tsx).
function todayIso(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

// Qué identificador vino precargado y en qué campo. 'idv' | 'visual' (puerta MANUAL, heurística R1.4) |
// 'tag' (rama BLE: el EID bastoneado llega por el param `tag` desde el overlay del chunk BLE global —
// spec 09 RB6.3). Sin params → alta "en blanco" (no hay id precargado en el header).
type PrefillKind = 'idv' | 'visual' | 'tag' | null;

type WizardStep = 1 | 2 | 3 | 4;

export default function CrearAnimalScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ idv?: string; visual?: string; tag?: string; sessionId?: string }>();
  const { state: authState } = useAuth();
  const { state: estState } = useEstablishment();
  const { state: rodeoState } = useRodeo();

  const userId = authState.status === 'authenticated' ? authState.user.id : null;
  const establishmentId = estState.status === 'active' ? estState.current.id : null;

  // Anti-stacking (RB2.2): mientras este form de ALTA está montado, suspendemos el listener global del
  // bastón → un bastonazo NO abre el overlay find-or-create encima del wizard. No-op seguro hasta que el
  // provider se monte en la raíz (Run 2 del chunk BLE global).
  useBusyWhileMounted();

  // El identificador precargado (R4.2): viene por params. read-only durante el alta. Se muestra en el
  // header del wizard ("Creando: [id]"). Prioridad: tag (BLE bastoneado, RB6.3) > idv > visual — si
  // (por error) llegaran varios, el TAG manda (es la identidad SENASA confirmada por el bastón).
  const prefilledTag = typeof params.tag === 'string' ? params.tag : '';
  const prefilledIdv = typeof params.idv === 'string' ? params.idv : '';
  const prefilledVisual = typeof params.visual === 'string' ? params.visual : '';
  const prefillKind: PrefillKind = prefilledTag
    ? 'tag'
    : prefilledIdv
      ? 'idv'
      : prefilledVisual
        ? 'visual'
        : null;
  const prefilledId = prefilledTag || prefilledIdv || prefilledVisual; // lo que se muestra en "Creando: [id]"

  // Contexto de MODO MANIOBRAS (spec 03 R4.1, M2.2): si el alta vino DESDE la manga (find-or-create
  // inline), `identificar.tsx` pasa el `sessionId` de la jornada. Presente = "alta desde modo maniobras"
  // → al crear (o tras un soft-fail), en vez de aterrizar en la ficha del animal (dead-end de la jornada)
  // continuamos DIRECTO a la carga de la maniobra de ese animal nuevo (`/maniobra/carga`), sin
  // re-identificarlo. Vacío = alta normal (desde la lista de animales) → ficha, como hoy (sin regresión).
  const maneuverSessionId = typeof params.sessionId === 'string' ? params.sessionId : '';

  // Identificadores: el precargado va read-only (no editable); los otros quedan EDITABLES en el paso 4
  // (recomendados, no obligatorios — R4.3). Por la rama BLE (RB6.3) el TAG bastoneado llega precargado
  // read-only (el operario no lo re-tipea: ya lo leyó el bastón); por la puerta MANUAL el TAG arranca
  // vacío y editable (idv/visual son el precargado). El find-or-create no cambia.
  const [tag, setTag] = useState(prefillKind === 'tag' ? prefilledTag : '');
  const [idv, setIdv] = useState(prefillKind === 'idv' ? prefilledIdv : '');
  // "Nombre / seña" (visual_id_alt) dejó de ser un campo EDITABLE del alta (delta #2 NOMBRE/APODO, RNA.2.1):
  // el apodo ahora es un dato custom opt-in por rodeo (CustomPropertiesForm). `visual` queda como valor
  // READ-ONLY: solo lo puebla el camino find-or-create-por-texto (prefillKind === 'visual', spec 09 R1.4),
  // donde el operario ya comprometió ese identificador en el buscador (RNA.2.3). Nunca se muta desde el alta.
  const visual = prefillKind === 'visual' ? prefilledVisual : '';

  // ── Paso actual del wizard. ──
  const [step, setStep] = useState<WizardStep>(1);

  // ── Rodeo (paso 1, R4.4 / R6). available viene del RodeoContext (scopeado al campo activo). ──
  const rodeos: Rodeo[] = rodeoState.status === 'active' ? rodeoState.available : [];
  const [selectedRodeoId, setSelectedRodeoId] = useState<string | null>(null);
  // Guard one-shot para no re-resolver el default cada render (deps primitivas, sin loop).
  const defaultResolvedRef = useRef(false);

  // ── Sexo (paso 2, R4.5, REQUERIDO). ──
  const [sex, setSex] = useState<AnimalSex | null>(null);

  // ── Categoría elegida (paso 3, picker CERRADO). El catálogo del sistema del rodeo + filtro por sexo. ──
  const [categories, setCategories] = useState<SystemCategory[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [categoriesError, setCategoriesError] = useState<string | null>(null);
  const [selectedCategoryCode, setSelectedCategoryCode] = useState<string | null>(null);

  // ── Datos (paso 4) — DINÁMICO por categoría (sub-chunk B). Base (todas): identificación + raza +
  //    pelaje + año de nacimiento + lote. Extra por categoría (fieldsForCategory): peso / dientes /
  //    condición / preñez / cría al pie. Todos los estados viven acá; el render muestra solo los que
  //    la categoría pide (los no-mostrados quedan en su default y NO se mandan).
  const [birthYear, setBirthYear] = useState(''); // año-only (AAAA → AAAA-07-01); base de la edad
  const [birthYearError, setBirthYearError] = useState<string | null>(null);
  // Día/mes OPCIONAL separado del año (delta RAF2.1): con DD/MM → fecha exacta; sin → midpoint del año.
  const [birthDayMonth, setBirthDayMonth] = useState('');
  const [dayMonthError, setDayMonthError] = useState<string | null>(null);
  // Raza CONTROLADA (spec 08, T18): el BreedPicker setea el NOMBRE elegido en `breed` (texto, que persiste por
  // la RPC create_animal) + recuerda el CÓDIGO SENASA para el resumen del trigger + la selección del sheet.
  // ⚠ breed_id NO se persiste desde el alta (la RPC 0083 no lo soporta — ver createAnimal + el progress). El
  // picker es la entrada de raza del alta; el hint "Completá para SIGSA" refleja que sin breed_id queda "a completar".
  const [breed, setBreed] = useState('');
  const [breedCode, setBreedCode] = useState<string | null>(null);
  const [breedPickerOpen, setBreedPickerOpen] = useState(false);
  const [breedCatalog, setBreedCatalog] = useState<BreedCatalogEntry[]>([]);
  const [coatColor, setCoatColor] = useState('');
  // recría: peso (= entry_weight).
  const [entryWeight, setEntryWeight] = useState('');
  const [entryWeightError, setEntryWeightError] = useState<string | null>(null);
  // adultas/toro: dientes (teeth_state, columna).
  const [teethState, setTeethState] = useState<TeethState | null>(null);
  // adultas/toro/vaq.preñada: condición corporal (evento post-create).
  const [conditionScore, setConditionScore] = useState<number | null>(null);
  // hembras preñables: estado de preñez (tacto, evento post-create si es positivo).
  const [pregnancyStatus, setPregnancyStatus] = useState<PregnancyStatus | null>(null);
  // vaquillonas: aptitud reproductiva (tacto_vaquillona, evento post-create soft-fail). null = no elegida (se
  // omite). delta spec 02 aptitud (RAR.1): prompt gateado a vaquillona, opcional.
  const [heiferFitness, setHeiferFitness] = useState<HeiferFitness | null>(null);
  // vacas con servicio: cría al pie (nursing, columna). null = no elegido (se omite).
  const [nursing, setNursing] = useState<boolean | null>(null);

  // ── Lote (opcional, ADR-020). ──
  const [groups, setGroups] = useState<ManagementGroup[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [groupPickerOpen, setGroupPickerOpen] = useState(false);

  const [tagError, setTagError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const busyRef = useRef(false);
  // Si createAnimal salió OK pero un evento POST-create (condición/preñez) falló, el animal YA EXISTE
  // (no se pierde). Guardamos su profileId acá para (a) NO permitir re-crear (duplicado) — el CTA pasa
  // a "Ver la ficha del animal" — y (b) mostrar el aviso suave en el form. El happy-path navega solo.
  const [createdProfileId, setCreatedProfileId] = useState<string | null>(null);

  // Prompt "Vincular la cría al pie" (delta #15, RCAP.1): tras crear una vaca con cría al pie (nursing=true)
  // en el happy path, en vez de navegar, mostramos el prompt saltable. `linkPromptMotherId` = el profileId
  // de la madre recién creada (id de cliente, offline-safe) → controla el montaje del prompt. Tras "Ahora no"
  // o un vínculo exitoso, navegamos por la MISMA rama (maniobra→carga / alta→ficha) — la vaca ya existe.
  const [linkPromptMotherId, setLinkPromptMotherId] = useState<string | null>(null);

  // Ref del form de PROPIEDADES CUSTOM (R13.10): el submit recolecta sus valores y los persiste post-create
  // (custom_attributes), mismo patrón soft-fail que condición/preñez. Vive en el paso 4 (form dinámico).
  const customPropsRef = useRef<CustomPropertiesFormHandle>(null);

  // ── Scroll-al-campo del error (RAF2.4.4, MUST de forms): cuando una validación del paso 4 falla, además
  //    del borde rojo + error inline, traemos el campo culpable a la vista. Medimos por GEOMETRÍA (onLayout)
  //    igual que CustomFieldSheet: cada SECCIÓN (datos base / datos de la categoría) reporta su `y` RELATIVO
  //    al contentContainer (es hija directa del ScrollView vía el Fragment de Step4Data), y cada CAMPO
  //    validado su `y` RELATIVO a su sección; la suma es la posición absoluta dentro del scroll. Robusto en
  //    web y native, sin depender de measureLayout. Si no hay geometría aún, el error inline + borde igual
  //    se muestran (no rompe). En scope: DD/MM; por coherencia con el MUST, también año y peso (decisión (d)).
  const scrollRef = useRef<RNScrollView | null>(null);
  const sectionYRef = useRef<Record<string, number>>({});
  const fieldYRef = useRef<Record<string, { section: string; y: number }>>({});
  const onSectionLayout = useCallback((key: string, y: number) => {
    sectionYRef.current[key] = y;
  }, []);
  const onFieldLayout = useCallback((field: string, section: string, y: number) => {
    fieldYRef.current[field] = { section, y };
  }, []);
  const scrollToField = useCallback((field: 'year' | 'dayMonth' | 'weight') => {
    const f = fieldYRef.current[field];
    const sv = scrollRef.current;
    if (!f || !sv) return;
    const sectionY = sectionYRef.current[f.section] ?? 0;
    const pad = getTokenValue('$4', 'space');
    const y = Math.max(0, sectionY + f.y - pad);
    // Diferimos un frame: el error inline recién se montó (cambia el layout); el scroll corre después.
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => sv.scrollTo({ y, animated: true }));
    } else {
      sv.scrollTo({ y, animated: true });
    }
  }, []);

  // Campos EXTRA que la categoría elegida pide (tabla §2). Vacío hasta elegir categoría (paso 3).
  const categoryFields: readonly CategoryDataField[] = useMemo(
    () => (selectedCategoryCode && sex ? fieldsForCategory(sex, selectedCategoryCode) : []),
    [selectedCategoryCode, sex],
  );
  const showWeight = categoryFields.includes('weight');
  const showTeeth = categoryFields.includes('teeth');
  const showCondition = categoryFields.includes('conditionScore');
  const showPregnancy = categoryFields.includes('pregnancy');
  const showNursing = categoryFields.includes('nursing');
  // delta spec 02 aptitud (RAR.1.1/RAR.1.2): el prompt de aptitud aparece SOLO para la vaquillona (gateado por
  // categoría, igual que el resto de los campos extra del paso 4). Es la categoría con eje de aptitud pre-servicio.
  const showFitness = selectedCategoryCode === 'vaquillona';

  // Rodeo elegido + sus datos (system_id para resolver categoría/picker).
  //
  // ⚠️ FIX (carrera del rodeo-default, C3.2b T0, conservado): con EXACTAMENTE 1 rodeo el default se
  // resuelve ASYNC; `selectedRodeo` cae al único rodeo aunque `selectedRodeoId` aún no resolvió → el
  // paso 1 con 1 rodeo nunca queda sin rodeo. El caso ≥2 NO cambia (combo + default async, R4.4).
  const selectedRodeo = useMemo(
    () => rodeos.find((r) => r.id === selectedRodeoId) ?? (rodeos.length === 1 ? rodeos[0] : null),
    [rodeos, selectedRodeoId],
  );

  const hasMultipleRodeos = rodeos.length >= 2;
  const noRodeo = rodeos.length === 0;

  // ── Resolver el rodeo default (R6.2→R6.3→R6.4) una vez que hay set + user + campo. ──
  // Dep PRIMITIVA: una key string del set de ids (no el array de objetos, que se recrea cada render).
  const rodeoIdsKey = useMemo(() => rodeos.map((r) => r.id).join(','), [rodeos]);
  useEffect(() => {
    if (defaultResolvedRef.current) return;
    const ids = rodeoIdsKey.length > 0 ? rodeoIdsKey.split(',') : [];
    if (!userId || !establishmentId || ids.length === 0) return;
    let active = true;
    (async () => {
      const persisted = await readLastRodeo(userId, establishmentId);
      if (!active) return;
      let dbLastUsed: string | null = null;
      if (!persisted || !ids.includes(persisted)) {
        const r = await queryLastUsedRodeoFromDb(establishmentId);
        if (!active) return;
        if (r.ok) dbLastUsed = r.value;
      }
      const def = resolveDefaultRodeoId(ids, persisted, dbLastUsed);
      if (!active) return;
      defaultResolvedRef.current = true;
      setSelectedRodeoId(def);
    })();
    return () => {
      active = false;
    };
  }, [userId, establishmentId, rodeoIdsKey]);

  // ── Cargar los lotes del campo (selector opcional, paso 4). ──
  useEffect(() => {
    if (!establishmentId) return;
    let active = true;
    (async () => {
      const r = await fetchManagementGroups(establishmentId);
      if (!active) return;
      if (r.ok) setGroups(r.value);
    })();
    return () => {
      active = false;
    };
  }, [establishmentId]);

  // ── Cargar el catálogo de razas SENASA (global, offline) para el BreedPicker del paso 4 (spec 08, T13). ──
  useEffect(() => {
    let active = true;
    (async () => {
      const r = await fetchBreedCatalog();
      if (!active) return;
      if (r.ok) setBreedCatalog(r.value);
      // Si falla (sin sync aún), el catálogo queda vacío → el sheet muestra su empty-state; el alta NO se
      // bloquea (la raza es opcional). No mostramos error duro acá (degradación graciosa).
    })();
    return () => {
      active = false;
    };
  }, []);

  // ── Cargar el catálogo de categorías del SISTEMA del rodeo (para el paso 3). Dep PRIMITIVA: el
  //    systemId (string) — no el objeto rodeo (que se recrea). Se recarga si cambia el rodeo elegido
  //    (sistemas distintos → catálogos distintos). El filtrado por sexo es en render (categoriesForSex).
  const systemId = selectedRodeo?.systemId ?? null;
  useEffect(() => {
    if (!systemId) return;
    let active = true;
    setCategoriesLoading(true);
    setCategoriesError(null);
    (async () => {
      const r = await fetchSystemCategories(systemId);
      if (!active) return;
      setCategoriesLoading(false);
      if (r.ok) {
        setCategories(r.value);
      } else {
        setCategories([]);
        setCategoriesError(
          r.error.kind === 'network'
            ? 'Sin conexión: no pudimos cargar las categorías. Reintentá.'
            : 'No pudimos cargar las categorías del rodeo.',
        );
      }
    })();
    return () => {
      active = false;
    };
  }, [systemId]);

  // Categorías ofrecidas al sexo elegido (picker cerrado). Si no hay sexo todavía, vacío.
  const categoryOptions = useMemo(
    () => (sex ? categoriesForSex(categories, sex) : []),
    [categories, sex],
  );

  const onSelectRodeo = useCallback(
    (rodeoId: string) => {
      setSelectedRodeoId(rodeoId);
      if (userId && establishmentId) void writeLastRodeo(userId, establishmentId, rodeoId);
    },
    [userId, establishmentId],
  );

  // ── Navegación del wizard ──────────────────────────────────────────────────────────
  // Avanzar de paso (valida lo mínimo del paso actual antes de pasar). El back retrocede paso a paso.
  const goNext = useCallback(() => {
    setFormError(null);
    setStep((s) => (s < TOTAL_STEPS ? ((s + 1) as WizardStep) : s));
  }, []);

  const goBack = useCallback(() => {
    setFormError(null);
    if (step > 1) {
      setStep((s) => (s - 1) as WizardStep);
      return;
    }
    // En el paso 1, back robusto (backOr) a la lista de animales (de donde se llega al alta).
    backOr(router, '/(tabs)/animales');
  }, [step, router]);

  // Cambiar de sexo limpia la categoría elegida (un code de un sexo no aplica al otro). Lo hacemos en
  // el setter del paso 2, no en un efecto, para evitar borrar selección por re-render espurio.
  const onSelectSex = useCallback((s: AnimalSex) => {
    setSex((prev) => {
      if (prev !== s) setSelectedCategoryCode(null);
      return s;
    });
  }, []);

  // Elegir raza del BreedPicker (spec 08, T18): recuerda el CÓDIGO (para el resumen + re-abrir el sheet con la
  // selección) y setea `breed` (texto) con el NOMBRE elegido — la columna que PERSISTE por la RPC create_animal
  // (breed_id no se manda desde el alta, ver createAnimal). "Sin raza" (null, null) limpia ambos. Cierra el sheet.
  const onSelectBreed = useCallback(
    (_breedId: string | null, senasaCode: string | null) => {
      if (senasaCode == null) {
        setBreedCode(null);
        setBreed('');
      } else {
        setBreedCode(senasaCode);
        const label = selectedBreedLabel(breedCatalog, senasaCode);
        setBreed(label?.name ?? '');
      }
      setBreedPickerOpen(false);
    },
    [breedCatalog],
  );

  // Paso 1 (rodeo): con 1 rodeo, auto-avanzamos al paso 2 (no hay decisión que tomar) UNA sola vez.
  // Con ≥2 rodeos, el usuario elige y toca "Continuar". Guard one-shot para no re-saltar si el
  // usuario vuelve atrás al paso 1 a propósito.
  const autoAdvancedRef = useRef(false);
  useEffect(() => {
    if (autoAdvancedRef.current) return;
    if (step !== 1) return;
    if (noRodeo) return;
    if (rodeos.length === 1 && selectedRodeo) {
      autoAdvancedRef.current = true;
      setStep(2);
    }
  }, [step, noRodeo, rodeos.length, selectedRodeo]);

  // Navegación post-create (R4.7 / M2.2): en contexto MODO MANIOBRAS continuamos DIRECTO a la carga de la
  // maniobra del animal nuevo (/maniobra/carga, sin re-identificarlo); si no, a su ficha. `replace` para no
  // dejar el form en el back-stack. Fuente ÚNICA de la navegación post-create (la usan el happy-path, el
  // re-tap tras soft-fail, y el cierre del prompt de cría al pie).
  const navigateAfterCreate = useCallback(
    (profileId: string) => {
      if (maneuverSessionId) {
        router.replace({
          pathname: '/maniobra/carga',
          params: { sessionId: maneuverSessionId, profileId },
        });
      } else {
        router.replace({ pathname: '/animal/[id]', params: { id: profileId } });
      }
    },
    [maneuverSessionId, router],
  );

  // Cierre del prompt de cría al pie (RCAP.1.3/3.5/4.5): "Ahora no" o vínculo/creación con éxito → cerramos
  // el prompt y navegamos por la rama normal (la vaca ya existe; no se re-crea ni se modifica).
  const finishLinkPrompt = useCallback(() => {
    const id = linkPromptMotherId;
    setLinkPromptMotherId(null);
    if (id) navigateAfterCreate(id);
  }, [linkPromptMotherId, navigateAfterCreate]);

  const onSubmit = useCallback(async () => {
    if (busyRef.current) return;
    // Si el animal YA se creó (un evento post-create falló), NO re-creamos: navegamos sin re-crear (evita
    // un DUPLICADO si el operario re-toca el CTA tras el aviso suave). En contexto MODO MANIOBRAS (M2.2)
    // continuamos la carga de la maniobra del animal nuevo; si no, a su ficha (como hoy).
    if (createdProfileId) {
      navigateAfterCreate(createdProfileId);
      return;
    }
    setFormError(null);

    // Estado base previo a la categoría (no debería pasar: el CTA solo aparece en el paso 4 con
    // categoría elegida). Defensivo.
    if (!establishmentId || !selectedRodeo) {
      setFormError('Elegí un rodeo para el animal.');
      return;
    }
    if (!sex) {
      setFormError('Volvé al paso de sexo y elegí Macho o Hembra.');
      return;
    }
    if (!selectedCategoryCode) {
      setFormError('Volvé al paso de categoría y elegí una.');
      return;
    }

    // Validación del paso 4 (campos base + los EXTRA que la categoría pide). La FECHA DE NACIMIENTO es base
    // (todas las categorías): UNA sola validación combinada año + día/mes (delta RAF2.1) → fecha exacta
    // (AAAA-MM-DD si hay DD/MM) o midpoint (AAAA-07-01 si solo año) o null (todo vacío). El peso solo si la
    // categoría lo pide (showWeight). El resto de los extras son selectores cerrados (opcionales, sin formato).
    const now = new Date();
    const dateV = validateBirthDate(birthYear, birthDayMonth, now);
    const dateErrField = dateV.ok ? null : dateV.field;
    setBirthYearError(!dateV.ok && dateV.field === 'year' ? dateV.error : null);
    setDayMonthError(!dateV.ok && dateV.field === 'dayMonth' ? dateV.error : null);

    let entryWeightKg: number | null = null;
    let weightBad = false;
    if (showWeight) {
      const trimmedW = entryWeight.trim();
      if (trimmedW.length > 0) {
        const w = parseWeight(trimmedW);
        if (w == null || w <= 0) {
          setEntryWeightError('El peso tiene que ser un número mayor a 0.');
          weightBad = true;
        } else {
          setEntryWeightError(null);
          entryWeightKg = w;
        }
      } else {
        setEntryWeightError(null);
      }
    }

    const tagOk = isValidTagElectronic(tag);
    setTagError(tagOk ? null : `La caravana electrónica tiene que tener ${TAG_ELECTRONIC_LENGTH} dígitos.`);

    // Identidad MÍNIMA (animal_profiles_identity_check, 0021 / R6.2): el alta DEBE llevar al menos UN
    // identificador (caravana electrónica, IDV o visual). Por find-or-create siempre hay uno precargado
    // (R4.2), pero el ALTA EN BLANCO puede llegar acá con los tres vacíos → create_animal rechaza con
    // 23514 al subir y el animal se PIERDE en silencio (queda en el overlay local, nunca aterriza en
    // Postgres). Lo validamos ANTES de encolar el intent: no encolamos un alta condenada. El error va al
    // formError (cross-campo: "al menos uno de tres", no atado a un solo input) sobre el CTA, zona pulgar.
    const hasIdentifier = hasAtLeastOneIdentifier(tag, idv, visual);
    if (!hasIdentifier) {
      setFormError('Cargá al menos un identificador: caravana electrónica o caravana visual.');
    }
    if (!dateV.ok || weightBad || !tagOk || !hasIdentifier) {
      // Scroll-al-campo (RAF2.4.4): al primer campo con error en orden del form (fecha arriba, luego peso).
      // El tag (inline en su FormField) y el identificador (banner sobre el CTA) viven al alcance del pulgar.
      if (dateErrField === 'year') scrollToField('year');
      else if (dateErrField === 'dayMonth') scrollToField('dayMonth');
      else if (weightBad) scrollToField('weight');
      return;
    }

    // Fecha year-only (solo año, sin DD/MM) → IMPUTACIÓN CONSCIENTE DE LA CATEGORÍA (delta
    // override-imputacion-categoria): en vez del midpoint ciego 'AAAA-07-01' (que puede caer del lado
    // equivocado del corte de edad y hacer que compute_category flipee la categoría elegida), imputamos un
    // día dentro del cruce (año ∩ ventana-etaria-de-la-elegida ∩ pasado) → la fecha queda category-consistent
    // → categoryOverrideFor da override=FALSE (auto-avanza sin flip). Si la categoría es imposible para el
    // año (cruce vacío), imputeBirthDateForCategory cae al MISMO midpoint ciego → override=true (pin). Con
    // fecha EXACTA (precision 'exact') o sin fecha ('none') NO se toca nada.
    let birthDate = dateV.date;
    if (birthDate != null && dateV.precision === 'year') {
      birthDate = imputeBirthDateForCategory(selectedCategoryCode, sex, birthDate, now);
    }
    // Preñez capturada (solo si la categoría la pide Y es positiva): refina el override (vaquillona
    // preñada derivable) y dispara el tacto+ post-create. Un "Vacía" del alta NO cuenta como preñez.
    const pregnantCaptured = showPregnancy && isPregnantStatus(pregnancyStatus);

    // OVERRIDE (alta guiada #4, refinado en B): la categoría elegida vs. la que el sistema computaría
    // por sexo + edad + PREÑEZ capturada. vaquillona_prenada + preñez → coincide → override=false. La
    // comparación puntual queda IGUAL; toda la inteligencia year-only está en la fecha imputada de arriba.
    const categoryOverride = categoryOverrideFor(selectedCategoryCode, sex, birthDate, {
      today: now,
      pregnant: pregnantCaptured,
    });

    busyRef.current = true;
    setSubmitting(true);
    const created = await createAnimal({
      establishmentId,
      rodeoId: selectedRodeo.id,
      systemId: selectedRodeo.systemId,
      sex,
      categoryCode: selectedCategoryCode,
      categoryOverride,
      birthDate,
      tagElectronic: tag.trim() || null,
      idv: idv.trim() || null,
      visualIdAlt: visual.trim() || null,
      breed: breed.trim() || null,
      coatColor: coatColor.trim() || null,
      // entry_weight solo en recría (showWeight); el resto de categorías no lo mandan.
      entryWeight: entryWeightKg,
      // teeth_state (dientes) solo si la categoría lo pide y se eligió; nursing solo si la categoría
      // lo pide y se eligió (null = no elegido → se omite → default false del DB).
      teethState: showTeeth ? teethState : null,
      nursing: showNursing ? nursing : null,
      managementGroupId: selectedGroupId,
    });

    if (!created.ok) {
      setSubmitting(false);
      busyRef.current = false;
      // R4.8: mantener el form cargado + mensaje accionable.
      setFormError(created.error.kind === 'network' ? OFFLINE_COPY : created.error.message);
      return;
    }

    // ── Eventos post-create (datos que NO son columnas: condición corporal + preñez). Se crean DESPUÉS
    //    de createAnimal con el profileId devuelto, fechados HOY. TOLERANTE: si createAnimal salió OK
    //    pero un evento falla, NO se pierde el animal — avisamos suave y navegamos a la ficha igual
    //    (el operario lo agrega desde "Agregar evento"). El tenant lo deriva la RLS (sin establishmentId).
    const profileId = created.value.profileId;
    const eventDate = todayIso();
    const softFails: string[] = [];

    if (showCondition && conditionScore != null) {
      const r = await addConditionScore({ profileId, score: conditionScore, eventDate });
      if (!r.ok) softFails.push('la condición corporal');
    }
    // Tacto: solo si la preñez capturada es POSITIVA (Cabeza/Cuerpo/Cola). "Vacía" del alta NO crea
    // evento (no hay diagnóstico positivo que registrar en un animal recién dado de alta; un tacto
    // 'empty' solo agregaría ruido al timeline. El estado "vacía" es el default — sin evento).
    if (pregnantCaptured && pregnancyStatus != null) {
      const r = await addTacto({ profileId, pregnancyStatus, eventDate });
      if (!r.ok) softFails.push('el estado de preñez');
    }
    // Aptitud reproductiva (delta aptitud RAR.1.3/RAR.1.5): solo vaquillona + opción elegida → evento
    // tacto_vaquillona post-create (mismo patrón soft-fail). "Aún no sé"=diferida (RAR.1.6: el veredicto
    // explícito EXCLUYE de servidas aunque tenga edad, vía 0105 existente). Sin opción → no se manda (RAR.1.4).
    if (showFitness && heiferFitness != null) {
      const r = await addTactoVaquillona({ profileId, fitness: heiferFitness, eventDate });
      if (!r.ok) softFails.push('la aptitud reproductiva');
    }

    // Propiedades CUSTOM cargadas en el form (R13.10): current-value por (animal, field) → custom_attributes.
    // Mismo patrón soft-fail: el animal YA existe; si una falla, se avisa y se sigue (se agrega luego desde la
    // ficha). El gating capa 2 (0096) + el audit forzado los re-validan server-side al subir.
    const customValues = customPropsRef.current?.collectValues() ?? [];
    for (const cv of customValues) {
      const r = await setCustomAttribute({
        animalProfileId: profileId,
        fieldDefinitionId: cv.fieldDefinitionId,
        value: cv.value.value,
      });
      if (!r.ok) softFails.push(`el dato "${cv.label}"`);
    }

    setSubmitting(false);
    busyRef.current = false;

    if (softFails.length > 0) {
      // El animal SE CREÓ; solo falló guardar un dato secundario (evento). NO navegamos automáticamente:
      // mostramos el aviso suave en el form + marcamos createdProfileId → el CTA pasa a "Continuar con la
      // maniobra" (contexto manga) / "Ver la ficha del animal" (alta normal) — sin re-crear → sin
      // duplicado. El operario lee el aviso y agrega el dato faltante después (desde la ficha o tras la
      // jornada). No es un error: es un aviso accionable que no traba. En contexto MANIOBRA el animal ya
      // existe → hay que poder CONTINUAR la jornada (el dato faltante se agrega luego desde la ficha).
      setCreatedProfileId(profileId);
      setFormError(
        maneuverSessionId
          ? `El animal se creó, pero no pudimos guardar ${softFails.join(' ni ')}. Tocá "Continuar con la maniobra"; lo agregás después desde la ficha.`
          : `El animal se creó, pero no pudimos guardar ${softFails.join(' ni ')}. Tocá "Ver la ficha" y agregalo desde ahí.`,
      );
      return;
    }
    // Happy-path. Delta #15 (RCAP.1.1): si la vaca se creó CON cría al pie (nursing=true), en vez de navegar
    // mostramos el prompt SALTABLE de vinculación ANTES de irnos. Guardamos createdProfileId para blindar
    // contra un re-tap del CTA (no re-crear) mientras el prompt está arriba; el cierre del prompt navega por
    // la rama normal (navigateAfterCreate). Si NO hay cría al pie → navegamos como siempre (sin prompt).
    if (showNursing && nursing === true) {
      setCreatedProfileId(profileId);
      setLinkPromptMotherId(profileId);
      return;
    }
    navigateAfterCreate(profileId);
  }, [
    createdProfileId,
    maneuverSessionId,
    sex,
    birthYear,
    birthDayMonth,
    entryWeight,
    breed,
    coatColor,
    tag,
    idv,
    visual,
    establishmentId,
    selectedRodeo,
    selectedCategoryCode,
    selectedGroupId,
    scrollToField,
    showWeight,
    showTeeth,
    showCondition,
    showPregnancy,
    showNursing,
    showFitness,
    teethState,
    conditionScore,
    pregnancyStatus,
    heiferFitness,
    nursing,
    navigateAfterCreate,
  ]); // isValidTagElectronic/TAG_ELECTRONIC_LENGTH/validateBirthYear/categoryOverrideFor son puras

  const muted = getTokenValue('$textMuted', 'color');

  // Habilitación del CTA de cada paso (gating para no avanzar incompleto — manga-friendly).
  const canContinueStep1 = !noRodeo && !!selectedRodeo;
  const canContinueStep2 = !!sex;
  const canContinueStep3 = !!selectedCategoryCode;

  const headerTitle =
    step === 1 ? 'Elegí el rodeo'
    : step === 2 ? 'Sexo del animal'
    : step === 3 ? 'Categoría'
    : 'Datos del animal';

  return (
    <YStack flex={1} width="100%" maxWidth="100%" overflow="hidden" backgroundColor="$bg">
      {/* Header: back paso a paso + título del paso + "Creando: [id]" + progreso "Paso N de N". */}
      <YStack width="100%" paddingTop={insets.top} paddingHorizontal="$4" gap="$2">
        <XStack width="100%" alignItems="center" gap="$2" paddingTop="$3">
          <Pressable hitSlop={8} onPress={goBack} {...buttonA11y(Platform.OS, { label: 'Volver' })}>
            <ChevronLeft size={28} color={muted} strokeWidth={2} />
          </Pressable>
          <YStack flex={1} minWidth={0}>
            <Text fontFamily="$body" fontSize="$8" lineHeight="$8" fontWeight="700" color="$textPrimary" numberOfLines={1}>
              {headerTitle}
            </Text>
            {prefilledId ? (
              <Text fontFamily="$body" fontSize="$3" fontWeight="500" color="$textMuted" numberOfLines={1}>
                {`Creando: ${prefilledId}`}
              </Text>
            ) : null}
          </YStack>
        </XStack>
        {/* Indicador de progreso: "Paso N de 4" + barra de puntos. */}
        <StepIndicator current={step} total={TOTAL_STEPS} />
      </YStack>

      <ScrollView
        ref={scrollRef}
        flex={1}
        width="100%"
        maxWidth="100%"
        contentContainerStyle={{
          paddingHorizontal: getTokenValue('$4', 'space'),
          paddingTop: getTokenValue('$3', 'space'),
          paddingBottom: insets.bottom + getTokenValue('$6', 'space'),
          width: '100%',
          maxWidth: '100%',
          gap: getTokenValue('$4', 'space'),
        }}
        keyboardShouldPersistTaps="handled"
        showsHorizontalScrollIndicator={false}
      >
        {noRodeo ? (
          <InfoNote>
            Creá un rodeo antes de cargar animales. Sin rodeo no hay dónde darlos de alta.
          </InfoNote>
        ) : step === 1 ? (
          <Step1Rodeo
            rodeos={rodeos}
            selectedId={selectedRodeoId}
            hasMultiple={hasMultipleRodeos}
            singleName={selectedRodeo?.name ?? rodeos[0]?.name ?? '—'}
            onSelect={onSelectRodeo}
          />
        ) : step === 2 ? (
          <Step2Sex value={sex} onChange={onSelectSex} />
        ) : step === 3 ? (
          <Step3Category
            loading={categoriesLoading}
            error={categoriesError}
            options={categoryOptions}
            value={selectedCategoryCode}
            onChange={(code) => {
              setSelectedCategoryCode(code);
              setFormError(null);
            }}
          />
        ) : (
          <Step4Data
            prefillKind={prefillKind}
            idv={idv}
            visual={visual}
            tag={tag}
            tagError={tagError}
            onIdv={(t) => setIdv(sanitizeIdvInput(t))}
            onTag={(t) => {
              setTag(sanitizeTagInput(t));
              if (tagError) setTagError(null);
            }}
            birthYear={birthYear}
            birthYearError={birthYearError}
            onBirthYear={(t) => {
              setBirthYear(sanitizeBirthYearInput(t));
              if (birthYearError) setBirthYearError(null);
            }}
            birthDayMonth={birthDayMonth}
            dayMonthError={dayMonthError}
            onBirthDayMonth={(t) => {
              setBirthDayMonth(sanitizeDayMonthInput(t));
              if (dayMonthError) setDayMonthError(null);
            }}
            breedCode={breedCode}
            breedLabel={selectedBreedLabel(breedCatalog, breedCode)}
            onOpenBreedPicker={() => setBreedPickerOpen(true)}
            coatColor={coatColor}
            onCoatColor={(t) => setCoatColor(t.slice(0, COAT_MAX_LENGTH))}
            showWeight={showWeight}
            entryWeight={entryWeight}
            entryWeightError={entryWeightError}
            onEntryWeight={(t) => {
              setEntryWeight(sanitizeWeightInput(t));
              if (entryWeightError) setEntryWeightError(null);
            }}
            showTeeth={showTeeth}
            teethState={teethState}
            onTeeth={setTeethState}
            showCondition={showCondition}
            conditionScore={conditionScore}
            onCondition={setConditionScore}
            onClearCondition={() => setConditionScore(null)}
            showPregnancy={showPregnancy}
            pregnancyStatus={pregnancyStatus}
            onPregnancy={setPregnancyStatus}
            showFitness={showFitness}
            heiferFitness={heiferFitness}
            onFitness={setHeiferFitness}
            showNursing={showNursing}
            nursing={nursing}
            onNursing={setNursing}
            groups={groups}
            selectedGroupId={selectedGroupId}
            groupPickerOpen={groupPickerOpen}
            onToggleGroupPicker={() => setGroupPickerOpen((v) => !v)}
            onSelectGroup={(id) => {
              setSelectedGroupId(id);
              setGroupPickerOpen(false);
            }}
            muted={muted}
            onSectionLayout={onSectionLayout}
            onFieldLayout={onFieldLayout}
            customProps={
              <CustomPropertiesForm ref={customPropsRef} rodeoId={selectedRodeo?.id ?? null} />
            }
          />
        )}
      </ScrollView>

      {/* CTA fijo abajo (thumb-zone). En los pasos 1–3 = "Continuar"; en el 4 = "Crear animal". */}
      {!noRodeo ? (
        <YStack
          width="100%"
          paddingHorizontal="$4"
          paddingTop="$3"
          paddingBottom={insets.bottom + 12}
          gap="$2"
          borderTopWidth={1}
          borderTopColor="$divider"
          backgroundColor="$bg"
        >
          <FormError message={formError} />
          {step === 1 ? (
            <Button variant="primary" fullWidth disabled={!canContinueStep1} onPress={goNext}>
              Continuar
            </Button>
          ) : step === 2 ? (
            <Button variant="primary" fullWidth disabled={!canContinueStep2} onPress={goNext}>
              Continuar
            </Button>
          ) : step === 3 ? (
            <Button variant="primary" fullWidth disabled={!canContinueStep3} onPress={goNext}>
              Continuar
            </Button>
          ) : (
            <Button
              variant="primary"
              fullWidth
              disabled={submitting || !selectedRodeo}
              onPress={() => void onSubmit()}
            >
              {createdProfileId
                ? maneuverSessionId
                  ? 'Continuar con la maniobra'
                  : 'Ver la ficha del animal'
                : submitting
                  ? 'Creando…'
                  : 'Crear animal'}
            </Button>
          )}
        </YStack>
      ) : null}

      {/* BreedPicker (spec 08, T13/T18): sheet de raza del catálogo SENASA. Montado al ROOT (cubre la pantalla
          con su scrim). Setea `breed` (texto) con el nombre elegido. */}
      <BreedPickerSheet
        open={breedPickerOpen}
        onClose={() => setBreedPickerOpen(false)}
        breeds={breedCatalog}
        selectedCode={breedCode}
        onSelect={onSelectBreed}
      />

      {/* Prompt SALTABLE "Vincular la cría al pie" (delta #15, RCAP.1–RCAP.5). Montado al ROOT (cubre la
          pantalla con su scrim). Se dispara tras el alta de una vaca con cría al pie (nursing=true) en el
          happy path; "Ahora no" o un vínculo/creación exitoso navegan por la rama normal (finishLinkPrompt). */}
      <LinkCalfPrompt
        open={linkPromptMotherId != null}
        motherProfileId={linkPromptMotherId}
        establishmentId={establishmentId}
        motherRodeoId={selectedRodeo?.id ?? null}
        motherRodeoName={selectedRodeo?.name ?? null}
        motherSystemId={selectedRodeo?.systemId ?? null}
        rodeos={rodeos}
        onSkip={finishLinkPrompt}
        onLinked={finishLinkPrompt}
      />
    </YStack>
  );
}

// ─── Indicador de progreso "Paso N de N" + puntos ────────────────────────────────────────

function StepIndicator({ current, total }: { current: number; total: number }) {
  const primary = getTokenValue('$primary', 'color');
  return (
    <XStack
      width="100%"
      alignItems="center"
      gap="$2"
      {...labelA11y(Platform.OS, `Paso ${current} de ${total}`)}
    >
      <Text fontFamily="$body" fontSize="$3" fontWeight="600" color="$textMuted">
        {`Paso ${current} de ${total}`}
      </Text>
      <XStack flex={1} alignItems="center" gap="$1" justifyContent="flex-end">
        {Array.from({ length: total }).map((_, i) => (
          <View
            key={i}
            height={6}
            flex={1}
            maxWidth={28}
            borderRadius="$pill"
            backgroundColor={i < current ? '$primary' : '$divider'}
          />
        ))}
      </XStack>
    </XStack>
  );
}

// ─── Paso 1: Rodeo (1 → fijo read-only; ≥2 → selector vertical full-width) ─────────────────

function Step1Rodeo({
  rodeos,
  selectedId,
  hasMultiple,
  singleName,
  onSelect,
}: {
  rodeos: Rodeo[];
  selectedId: string | null;
  hasMultiple: boolean;
  singleName: string;
  onSelect: (id: string) => void;
}) {
  if (!hasMultiple) {
    // Un solo rodeo activo → fijo, read-only (R4.4). El wizard auto-avanza al paso 2; esto se ve
    // solo si el usuario vuelve atrás a propósito.
    return (
      <YStack gap="$2">
        <Text fontFamily="$body" fontSize="$3" fontWeight="500" color="$textMuted">
          Este animal va al rodeo
        </Text>
        <Card paddingVertical="$3">
          <Text fontFamily="$body" fontSize="$5" fontWeight="600" color="$textPrimary">
            {singleName}
          </Text>
        </Card>
      </YStack>
    );
  }
  return (
    <YStack gap="$2">
      <Text fontFamily="$body" fontSize="$6" lineHeight="$6" fontWeight="600" color="$textPrimary">
        ¿A qué rodeo va este animal?
      </Text>
      <OptionRows
        options={rodeos.map((r) => ({ value: r.id, label: r.name }))}
        value={selectedId}
        onChange={(v) => {
          if (v != null) onSelect(v); // REQUERIDO: sin allowDeselect nunca llega null (RAF2.3.6).
        }}
        a11yPrefix="Rodeo"
      />
    </YStack>
  );
}

// ─── Paso 2: Sexo (2 opciones grandes full-screen, una decisión por pantalla) ──────────────

function Step2Sex({
  value,
  onChange,
}: {
  value: AnimalSex | null;
  onChange: (s: AnimalSex) => void;
}) {
  return (
    <YStack gap="$4">
      <Text fontFamily="$body" fontSize="$6" lineHeight="$6" fontWeight="600" color="$textPrimary">
        ¿Es macho o hembra?
      </Text>
      <YStack gap="$3">
        <SexCard
          icon={Mars}
          label="Macho"
          selected={value === 'male'}
          onPress={() => onChange('male')}
        />
        <SexCard
          icon={Venus}
          label="Hembra"
          selected={value === 'female'}
          onPress={() => onChange('female')}
        />
      </YStack>
    </YStack>
  );
}

/** Opción de sexo grande (card full-width con ícono) — target amplio, manga-friendly. */
function SexCard({
  icon: Icon,
  label,
  selected,
  onPress,
}: {
  icon: LucideIcon;
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const primary = getTokenValue('$primary', 'color');
  const white = getTokenValue('$white', 'color');
  return (
    <Pressable onPress={onPress} {...buttonA11y(Platform.OS, { label: `Sexo ${label}`, selected })}>
      <XStack
        width="100%"
        alignItems="center"
        gap="$3"
        minHeight="$touchMin"
        borderRadius="$card"
        borderWidth={2}
        borderColor={selected ? '$primary' : '$divider'}
        backgroundColor={selected ? '$primary' : '$white'}
        paddingHorizontal="$4"
        paddingVertical="$4"
        pressStyle={{ opacity: 0.85 }}
      >
        <View
          width="$icon"
          height="$icon"
          borderRadius="$pill"
          backgroundColor={selected ? '$white' : '$greenLight'}
          alignItems="center"
          justifyContent="center"
          flexShrink={0}
        >
          <Icon size={22} color={primary} strokeWidth={2.5} />
        </View>
        <Text
          flex={1}
          minWidth={0}
          fontFamily="$body"
          fontSize="$7" lineHeight="$7"
          fontWeight="600"
          color={selected ? '$white' : '$textPrimary'}
        >
          {label}
        </Text>
        {selected ? <Check size={22} color={white} strokeWidth={2.5} /> : null}
      </XStack>
    </Pressable>
  );
}

// ─── Paso 3: Categoría (selector CERRADO vertical full-width, filtrado por sexo+sistema) ────

function Step3Category({
  loading,
  error,
  options,
  value,
  onChange,
}: {
  loading: boolean;
  error: string | null;
  options: SystemCategory[];
  value: string | null;
  onChange: (code: string) => void;
}) {
  return (
    <YStack gap="$3">
      <Text fontFamily="$body" fontSize="$6" lineHeight="$6" fontWeight="600" color="$textPrimary">
        ¿Qué categoría es?
      </Text>
      {loading ? (
        <Text fontFamily="$body" fontSize="$4" fontWeight="400" color="$textMuted">
          Cargando categorías…
        </Text>
      ) : error ? (
        <InfoNote>{error}</InfoNote>
      ) : options.length === 0 ? (
        <InfoNote>No hay categorías disponibles para este rodeo.</InfoNote>
      ) : (
        <OptionRows
          options={options.map((c) => ({ value: c.code, label: c.name }))}
          value={value}
          onChange={(v) => {
            if (v != null) onChange(v); // REQUERIDO: sin allowDeselect nunca llega null (RAF2.3.6).
          }}
          a11yPrefix="Categoría"
        />
      )}
    </YStack>
  );
}

// ─── Paso 4: Datos DINÁMICO por categoría (sub-chunk B, tabla §2) ───────────────────────────
//
// Base (TODAS las categorías): identificación + raza + pelaje + AÑO de nacimiento + lote. Extra por
// categoría (los flags show*): peso (recría) / dientes + condición (vacas/toros) / preñez (preñables) /
// cría al pie (vacas con servicio). Solo se renderiza lo que la categoría pide → el operario ve un form
// corto y relevante (manga-friendly), no un form plano con campos que no aplican.

function Step4Data({
  prefillKind,
  idv,
  visual,
  tag,
  tagError,
  onIdv,
  onTag,
  birthYear,
  birthYearError,
  onBirthYear,
  birthDayMonth,
  dayMonthError,
  onBirthDayMonth,
  breedCode,
  breedLabel,
  onOpenBreedPicker,
  coatColor,
  onCoatColor,
  showWeight,
  entryWeight,
  entryWeightError,
  onEntryWeight,
  showTeeth,
  teethState,
  onTeeth,
  showCondition,
  conditionScore,
  onCondition,
  onClearCondition,
  showPregnancy,
  pregnancyStatus,
  onPregnancy,
  showFitness,
  heiferFitness,
  onFitness,
  showNursing,
  nursing,
  onNursing,
  groups,
  selectedGroupId,
  groupPickerOpen,
  onToggleGroupPicker,
  onSelectGroup,
  muted,
  onSectionLayout,
  onFieldLayout,
  customProps,
}: {
  prefillKind: PrefillKind;
  idv: string;
  visual: string;
  tag: string;
  tagError: string | null;
  onIdv: (t: string) => void;
  onTag: (t: string) => void;
  birthYear: string;
  birthYearError: string | null;
  onBirthYear: (t: string) => void;
  /** Día/mes opcional DD/MM (delta RAF2.1), separado del año, día-primero es-AR. */
  birthDayMonth: string;
  dayMonthError: string | null;
  onBirthDayMonth: (t: string) => void;
  /** Código SENASA de la raza elegida (null = sin raza). Controla el resumen + el hint del trigger. */
  breedCode: string | null;
  /** Nombre + código de la raza elegida (de selectedBreedLabel), o null si sin raza. */
  breedLabel: { senasaCode: string; name: string } | null;
  /** Abre el BreedPickerSheet (spec 08, T18). */
  onOpenBreedPicker: () => void;
  coatColor: string;
  onCoatColor: (t: string) => void;
  showWeight: boolean;
  entryWeight: string;
  entryWeightError: string | null;
  onEntryWeight: (t: string) => void;
  showTeeth: boolean;
  teethState: TeethState | null;
  /** null = re-tap deselecciona (delta RAF2.3.1). */
  onTeeth: (t: TeethState | null) => void;
  showCondition: boolean;
  conditionScore: number | null;
  onCondition: (s: number) => void;
  /** Vuelve la condición a "sin cargar" (delta RAF2.3.2). */
  onClearCondition: () => void;
  showPregnancy: boolean;
  pregnancyStatus: PregnancyStatus | null;
  /** null = re-tap deselecciona (delta RAF2.3.1). */
  onPregnancy: (s: PregnancyStatus | null) => void;
  /** delta aptitud (RAR.1): prompt de aptitud de vaquillona — gateado a `vaquillona`, opcional. */
  showFitness: boolean;
  heiferFitness: HeiferFitness | null;
  /** null = re-tap deselecciona (delta RAF2.3.1). */
  onFitness: (f: HeiferFitness | null) => void;
  showNursing: boolean;
  nursing: boolean | null;
  /** null = re-tap deselecciona (delta RAF2.3.1). */
  onNursing: (v: boolean | null) => void;
  groups: ManagementGroup[];
  selectedGroupId: string | null;
  groupPickerOpen: boolean;
  onToggleGroupPicker: () => void;
  onSelectGroup: (id: string | null) => void;
  muted: string;
  /** Scroll-al-campo (RAF2.4.4): reportan la geometría de la sección / campo validado para traerlo a la vista. */
  onSectionLayout: (key: string, y: number) => void;
  onFieldLayout: (field: string, section: string, y: number) => void;
  /** Form de propiedades CUSTOM (R13.10) — render desde el parent (carga por rodeo + ref de recolección). */
  customProps: React.ReactNode;
}) {
  const selectedGroupName = groups.find((g) => g.id === selectedGroupId)?.name ?? 'Sin lote';
  // ¿Hay algún dato EXTRA específico de la categoría? (para el título de la sección).
  const hasExtra = showWeight || showTeeth || showCondition || showPregnancy || showFitness || showNursing;
  return (
    <>
      {/* ── Identificadores (R4.2 precargado read-only + R4.3 recomendados). BASE. ── */}
      <YStack gap="$2">
        <Text fontFamily="$body" fontSize="$6" lineHeight="$6" fontWeight="600" color="$textPrimary">
          Identificación
        </Text>
        {prefillKind === 'tag' ? (
          // Rama BLE (RB6.3): el TAG bastoneado llega precargado read-only (el operario ya lo leyó con el
          // bastón; no lo re-tipea). idv/visual quedan editables abajo (recomendados, R4.3). El bastón solo
          // entrega EIDs ya validados (15 díg FDX-B), así que tagError normalmente queda null; igual lo
          // pasamos para no dejar un dead-end silencioso si llegara un TAG inválido (p.ej. deep-link a mano).
          <FormField
            label="Caravana electrónica (no editable)"
            value={tag}
            onChangeText={() => {}}
            editable={false}
            error={tagError}
          />
        ) : prefillKind === 'idv' ? (
          <FormField
            label="Caravana visual (no editable)"
            value={idv}
            onChangeText={() => {}}
            editable={false}
          />
        ) : prefillKind === 'visual' ? (
          <FormField
            label="Nombre / seña (no editable)"
            value={visual}
            onChangeText={() => {}}
            editable={false}
          />
        ) : null}

        {/* Delta #2 NOMBRE/APODO (RNA.2.1): el "Nombre / seña" (visual_id_alt) DEJÓ de ser un campo editable
            del alta — el apodo ahora es un dato custom opt-in por rodeo (sección "Datos personalizados" abajo,
            CustomPropertiesForm). Los identificadores editables del alta son SOLO caravana visual (idv) +
            caravana electrónica (tag). El display read-only de "Nombre / seña" se conserva arriba únicamente
            para el camino find-or-create-por-texto (prefillKind === 'visual', RNA.2.3). */}
        {prefillKind !== 'idv' ? (
          <FormField
            label="Caravana visual (recomendado)"
            value={idv}
            onChangeText={onIdv}
            keyboardType="number-pad"
            placeholder="Número de caravana oficial"
          />
        ) : null}
        {/* TAG editable SOLO en la puerta manual (sin TAG precargado). Por la rama BLE el TAG ya se mostró
            read-only arriba — no se ofrece un 2do campo editable que lo pisaría. */}
        {prefillKind !== 'tag' ? (
          <FormField
            label={`Caravana electrónica (recomendado, ${TAG_ELECTRONIC_LENGTH} dígitos)`}
            value={tag}
            onChangeText={onTag}
            keyboardType="number-pad"
            placeholder="982 0001 2345 6789"
            error={tagError}
          />
        ) : null}
      </YStack>

      {/* ── Datos base de cría (TODAS las categorías): AÑO + día/mes opcional + raza + pelaje. ── */}
      <YStack gap="$3" onLayout={(e) => onSectionLayout('base', e.nativeEvent.layout.y)}>
        <View onLayout={(e) => onFieldLayout('year', 'base', e.nativeEvent.layout.y)}>
          <FormField
            label="Año de nacimiento (opcional, AAAA)"
            value={birthYear}
            onChangeText={onBirthYear}
            placeholder="Ej. 2022"
            keyboardType="number-pad"
            error={birthYearError}
          />
        </View>
        {/* Día / Mes OPCIONAL (delta RAF2.1): separado del año, día-primero es-AR (DD/MM), teclado numérico.
            Con DD/MM → fecha exacta; sin DD/MM → midpoint del año (AAAA-07-01). Todo-o-nada al submit. */}
        <View onLayout={(e) => onFieldLayout('dayMonth', 'base', e.nativeEvent.layout.y)}>
          <FormField
            label="Día y mes (opcional, DD/MM)"
            value={birthDayMonth}
            onChangeText={onBirthDayMonth}
            placeholder="Ej. 15/03"
            keyboardType="number-pad"
            error={dayMonthError}
          />
        </View>
        {/* Raza CONTROLADA (spec 08, T18): trigger → BreedPickerSheet (catálogo SENASA). Reemplaza al input de
            texto libre. Muestra la raza elegida (código + nombre) o el placeholder; el hint recuerda que sin
            raza el animal queda "a completar" para SIGSA. */}
        <BreedPickerTrigger
          breedLabel={breedLabel}
          hasBreed={breedCode != null}
          onOpen={onOpenBreedPicker}
          muted={muted}
        />
        <FormField
          label="Pelaje (opcional)"
          value={coatColor}
          onChangeText={onCoatColor}
          autoCapitalize="sentences"
          maxLength={COAT_MAX_LENGTH}
          placeholder="Ej. Colorado"
        />
      </YStack>

      {/* ── Datos ESPECÍFICOS de la categoría (tabla §2). Solo se muestran los que la categoría pide. ── */}
      {hasExtra ? (
        <YStack gap="$4" onLayout={(e) => onSectionLayout('cat', e.nativeEvent.layout.y)}>
          <Text fontFamily="$body" fontSize="$6" lineHeight="$6" fontWeight="600" color="$textPrimary">
            Datos de la categoría
          </Text>

          {showWeight ? (
            <View onLayout={(e) => onFieldLayout('weight', 'cat', e.nativeEvent.layout.y)}>
              <FormField
                label="Peso en kg (opcional)"
                value={entryWeight}
                onChangeText={onEntryWeight}
                keyboardType="decimal-pad"
                placeholder="Ej. 180"
                error={entryWeightError}
              />
            </View>
          ) : null}

          {/* Opcionales del paso 4: re-tap del valor ya elegido lo DESELECCIONA → "sin cargar" (delta RAF2.3.1).
              `allowDeselect` distingue estos opcionales de los selectores REQUERIDOS (rodeo/categoría), que NO
              son deseleccionables. Lo "sin cargar" (null) no se envía a create_animal (RAF2.3.5). */}
          {showTeeth ? (
            <FieldGroup label="Dientes (opcional)">
              <OptionRows
                options={TEETH_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                value={teethState}
                onChange={(v) => onTeeth(v as TeethState | null)}
                a11yPrefix="Dientes"
                allowDeselect
              />
            </FieldGroup>
          ) : null}

          {/* Condición corporal: stepper +/− (delta RAF2.2) con TRI-ESTADO (RAF2.3.2/2.3.3): arranca "sin cargar"
              mostrando 3,00 ATENUADO; el 1er −/+ lo marca cargado; "Sin cargar" lo vuelve a null (no se envía). */}
          {showCondition ? (
            <FieldGroup label="Condición corporal (opcional, 1 a 5)">
              <ConditionScoreStepper
                compact
                score={conditionScore ?? SCORE_DEFAULT}
                dimmed={conditionScore == null}
                onChange={onCondition}
              />
              {conditionScore != null ? (
                <ClearOptionalControl
                  label="Sin cargar"
                  a11yLabel="Quitar condición corporal"
                  onPress={onClearCondition}
                />
              ) : null}
            </FieldGroup>
          ) : null}

          {showPregnancy ? (
            <FieldGroup label="Estado de preñez (opcional)">
              <OptionRows
                options={PREGNANCY_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                value={pregnancyStatus}
                onChange={(v) => onPregnancy(v as PregnancyStatus | null)}
                a11yPrefix="Preñez"
                allowDeselect
              />
            </FieldGroup>
          ) : null}

          {/* delta aptitud (RAR.1.1): prompt de aptitud de la vaquillona — 3 opciones es-AR con el lenguaje de
              color de TactoVaquillonaStep (apta=verde/diferida=ámbar/no_apta=terracota). Opcional (RAR.1.4). */}
          {showFitness ? (
            <FieldGroup label="¿Está apta para servicio? (opcional)">
              <FitnessOptionRows value={heiferFitness} onChange={onFitness} allowDeselect />
            </FieldGroup>
          ) : null}

          {showNursing ? (
            <FieldGroup label="Cría al pie (opcional)">
              <OptionRows
                options={[
                  { value: 'with', label: 'Con cría al pie' },
                  { value: 'without', label: 'Sin cría al pie' },
                ]}
                value={nursing == null ? null : nursing ? 'with' : 'without'}
                onChange={(v) => onNursing(v == null ? null : v === 'with')}
                a11yPrefix="Cría al pie"
                allowDeselect
              />
            </FieldGroup>
          ) : null}
        </YStack>
      ) : null}

      {/* ── Lote (opcional, ADR-020). BASE. Solo si el campo tiene lotes. ── */}
      {groups.length > 0 ? (
        <YStack gap="$2">
          <Text fontFamily="$body" fontSize="$3" fontWeight="500" color="$textMuted">
            Lote (opcional)
          </Text>
          <GroupCombo
            groups={groups}
            selectedId={selectedGroupId}
            selectedName={selectedGroupName}
            open={groupPickerOpen}
            onToggle={onToggleGroupPicker}
            onSelect={onSelectGroup}
            muted={muted}
          />
        </YStack>
      ) : null}

      {/* ── Datos PERSONALIZADOS del rodeo (R13.10): propiedades custom enabled → custom_attributes. El form
            se renderiza desde el parent (carga por rodeo + ref para recolectar al submit). Si el rodeo no
            tiene propiedades custom, no renderiza nada. ── */}
      {customProps}
    </>
  );
}

/** Grupo de un dato por categoría: label muted arriba + el selector debajo (coherencia visual). */
function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <YStack gap="$2">
      <Text fontFamily="$body" fontSize="$3" fontWeight="500" color="$textMuted">
        {label}
      </Text>
      {children}
    </YStack>
  );
}

/**
 * Control "Sin cargar" / limpiar de un opcional del paso 4 (delta RAF2.3.2): afordancia EXPLÍCITA para volver
 * un campo a "sin cargar" después de haberlo tocado (hoy se usa para la condición corporal, que distingue
 * "tocado" de "default 3,00"). Text-button discreto (✕ + label muted), target ≥ $chipMin (Fitts). Tokens-only.
 */
function ClearOptionalControl({
  label,
  a11yLabel,
  onPress,
}: {
  label: string;
  a11yLabel: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} {...buttonA11y(Platform.OS, { label: a11yLabel })}>
      <XStack alignItems="center" gap="$1" minHeight="$chipMin" paddingHorizontal="$1" pressStyle={{ opacity: 0.6 }}>
        <X size={16} color={getTokenValue('$textMuted', 'color')} strokeWidth={2.5} />
        <Text fontFamily="$body" fontSize="$3" lineHeight="$3" fontWeight="600" color="$textMuted">
          {label}
        </Text>
      </XStack>
    </Pressable>
  );
}

// ─── Selector vertical full-width de opción única (reusado: rodeo paso 1, categoría paso 3) ─
//
// Cada opción es una FILA ancha (no chip): labels largos como "Vaca segundo servicio" entran cómodos
// (mejor Fitts que un chip apretado). Patrón consistente con el OptionSelector de agregar-evento
// (borde 2px, selected = relleno+texto $white). a11y por buttonA11y. Cero hardcode: tokens.
function OptionRows({
  options,
  value,
  onChange,
  a11yPrefix,
  allowDeselect = false,
}: {
  options: readonly { value: string; label: string }[];
  value: string | null;
  /** null sólo cuando `allowDeselect` y se re-toca el valor ya seleccionado (delta RAF2.3.1). */
  onChange: (v: string | null) => void;
  /** Prefijo del a11y label de cada fila (ej. "Categoría", "Rodeo") → "Categoría Multípara". */
  a11yPrefix: string;
  /** Opt-in (delta RAF2.3.1/2.3.6): re-tap del valor seleccionado lo deselecciona (→ null). Default false
   *  → los selectores REQUERIDOS (rodeo paso 1, categoría paso 3) conservan su comportamiento idéntico. */
  allowDeselect?: boolean;
}) {
  const white = getTokenValue('$white', 'color');
  return (
    <YStack width="100%" gap="$2">
      {options.map((opt) => {
        const selected = value === opt.value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(allowDeselect && selected ? null : opt.value)}
            {...buttonA11y(Platform.OS, { label: `${a11yPrefix} ${opt.label}`, selected })}
          >
            <XStack
              width="100%"
              alignItems="center"
              gap="$2"
              minHeight="$touchMin"
              borderRadius="$card"
              borderWidth={2}
              borderColor={selected ? '$primary' : '$divider'}
              backgroundColor={selected ? '$primary' : '$white'}
              paddingHorizontal="$4"
              paddingVertical="$3"
              pressStyle={{ opacity: 0.85 }}
            >
              <Text
                flex={1}
                minWidth={0}
                fontFamily="$body"
                fontSize="$5"
                fontWeight="600"
                color={selected ? '$white' : '$textPrimary'}
              >
                {opt.label}
              </Text>
              {selected ? <Check size={20} color={white} strokeWidth={2.5} /> : null}
            </XStack>
          </Pressable>
        );
      })}
    </YStack>
  );
}

// ─── Selector de APTITUD de vaquillona (delta spec 02 aptitud, RAR.1.1) ──────────────────────
//
// Espeja OptionRows (fila ancha, borde 2px, selected = relleno + texto $white + check) PERO conserva el
// LENGUAJE DE COLOR de TactoVaquillonaStep (apta=verde $primary / diferida=ámbar $amber / no_apta=terracota
// $terracota) en vez del verde único de OptionRows — para que la aptitud se lea por color además del texto.
// Las 3 opciones es-AR fijadas por RAR.1.1: "Sí, apta" / "Aún no sé" / "No es apta". Cero hardcode: tokens.
const FITNESS_OPTIONS: readonly { value: HeiferFitness; label: string; bg: '$primary' | '$amber' | '$terracota' }[] = [
  { value: 'apta', label: 'Sí, apta', bg: '$primary' },
  { value: 'diferida', label: 'Aún no sé', bg: '$amber' },
  { value: 'no_apta', label: 'No es apta', bg: '$terracota' },
];

function FitnessOptionRows({
  value,
  onChange,
  allowDeselect = false,
}: {
  value: HeiferFitness | null;
  /** null sólo cuando `allowDeselect` y se re-toca el valor ya seleccionado (delta RAF2.3.1). */
  onChange: (v: HeiferFitness | null) => void;
  allowDeselect?: boolean;
}) {
  const white = getTokenValue('$white', 'color');
  return (
    <YStack width="100%" gap="$2">
      {FITNESS_OPTIONS.map((opt) => {
        const selected = value === opt.value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(allowDeselect && selected ? null : opt.value)}
            {...buttonA11y(Platform.OS, { label: `Aptitud ${opt.label}`, selected })}
          >
            <XStack
              width="100%"
              alignItems="center"
              gap="$2"
              minHeight="$touchMin"
              borderRadius="$card"
              borderWidth={2}
              borderColor={selected ? opt.bg : '$divider'}
              backgroundColor={selected ? opt.bg : '$white'}
              paddingHorizontal="$4"
              paddingVertical="$3"
              pressStyle={{ opacity: 0.85 }}
            >
              <Text
                flex={1}
                minWidth={0}
                fontFamily="$body"
                fontSize="$5"
                fontWeight="600"
                color={selected ? '$white' : '$textPrimary'}
              >
                {opt.label}
              </Text>
              {selected ? <Check size={20} color={white} strokeWidth={2.5} /> : null}
            </XStack>
          </Pressable>
        );
      })}
    </YStack>
  );
}

// ─── Trigger del BreedPicker (spec 08, T18) — abre el sheet de raza del catálogo SENASA ────
//
// Espeja la afordancia del GroupCombo (pill ancho con chevron) pero abre un SHEET (no un acordeón inline): la
// lista de razas es larga (~28 + búsqueda) y el sheet con header/body/footer fijos la maneja mejor. Muestra el
// CÓDIGO + NOMBRE de la raza elegida, o "Elegí la raza" si no hay; + un hint recordando que sin raza el animal
// queda "a completar" para SIGSA (R1.4 UX). Target ≥$touchMin (Fitts).

function BreedPickerTrigger({
  breedLabel,
  hasBreed,
  onOpen,
  muted,
}: {
  breedLabel: { senasaCode: string; name: string } | null;
  hasBreed: boolean;
  onOpen: () => void;
  muted: string;
}) {
  return (
    <YStack gap="$2">
      <Text fontFamily="$body" fontSize="$3" fontWeight="500" color="$textMuted">
        Raza (opcional)
      </Text>
      <Pressable onPress={onOpen} {...buttonA11y(Platform.OS, { label: 'Elegir raza' })}>
        <XStack
          width="100%"
          minHeight="$touchMin"
          alignItems="center"
          gap="$3"
          backgroundColor="$white"
          borderRadius="$card"
          borderWidth={1}
          borderColor="$divider"
          paddingHorizontal="$4"
          pressStyle={{ backgroundColor: '$surface' }}
        >
          {/* Chip del código SENASA cuando hay raza elegida (slot que alinea el nombre). */}
          {breedLabel ? (
            <View
              minWidth="$icon"
              height="$chipMin"
              paddingHorizontal="$2"
              borderRadius="$pill"
              backgroundColor="$greenLight"
              alignItems="center"
              justifyContent="center"
              flexShrink={0}
            >
              <Text fontFamily="$body" fontSize="$3" lineHeight="$3" fontWeight="700" color="$primary" numberOfLines={1}>
                {breedLabel.senasaCode}
              </Text>
            </View>
          ) : null}
          <Text
            flex={1}
            minWidth={0}
            numberOfLines={1}
            fontFamily="$body"
            fontSize="$5"
            fontWeight={hasBreed ? '600' : '400'}
            color={hasBreed ? '$textPrimary' : '$textMuted'}
          >
            {breedLabel ? breedLabel.name : 'Elegí la raza'}
          </Text>
          <ChevronDown size={22} color={muted} strokeWidth={2} />
        </XStack>
      </Pressable>
      {/* Hint: sin raza del catálogo, el animal queda "a completar" para la exportación SIGSA (R1.4). */}
      {!hasBreed ? (
        <Text fontFamily="$body" fontSize="$2" lineHeight="$2" fontWeight="400" color="$textFaint">
          Completá la raza para poder exportar el animal a SIGSA.
        </Text>
      ) : null}
    </YStack>
  );
}

// ─── Combo de lote (opcional, ADR-020) — incluye "Sin lote" ──────────────────────────

function GroupCombo({
  groups,
  selectedId,
  selectedName,
  open,
  onToggle,
  onSelect,
  muted,
}: {
  groups: ManagementGroup[];
  selectedId: string | null;
  selectedName: string;
  open: boolean;
  onToggle: () => void;
  onSelect: (id: string | null) => void;
  muted: string;
}) {
  return (
    <YStack gap="$2">
      <Pressable onPress={onToggle} {...buttonA11y(Platform.OS, { label: 'Elegir lote', selected: open })}>
        <XStack
          width="100%"
          minHeight="$touchMin"
          alignItems="center"
          gap="$3"
          backgroundColor="$white"
          borderRadius="$card"
          borderWidth={1}
          borderColor="$divider"
          paddingHorizontal="$4"
          pressStyle={{ backgroundColor: '$surface' }}
        >
          <Text flex={1} minWidth={0} numberOfLines={1} fontFamily="$body" fontSize="$5" fontWeight="600" color="$textPrimary">
            {selectedName}
          </Text>
          <ChevronDown size={22} color={muted} strokeWidth={2} />
        </XStack>
      </Pressable>
      {open ? (
        <Card gap="$1" paddingVertical="$2">
          <GroupOption label="Sin lote" selected={selectedId === null} onPress={() => onSelect(null)} />
          {groups.map((g) => (
            <GroupOption
              key={g.id}
              label={g.name}
              selected={g.id === selectedId}
              onPress={() => onSelect(g.id)}
            />
          ))}
        </Card>
      ) : null}
    </YStack>
  );
}

function GroupOption({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} {...buttonA11y(Platform.OS, { label: `Lote ${label}`, selected })}>
      <XStack alignItems="center" gap="$2" minHeight="$chipMin" paddingHorizontal="$2" pressStyle={{ opacity: 0.6 }}>
        <Text flex={1} minWidth={0} numberOfLines={1} fontFamily="$body" fontSize="$4" fontWeight="500" color="$textPrimary">
          {label}
        </Text>
        {selected ? <Check size={20} color={getTokenValue('$primary', 'color')} strokeWidth={2.5} /> : null}
      </XStack>
    </Pressable>
  );
}
