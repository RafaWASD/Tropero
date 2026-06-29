// app/animal/[id].tsx — ficha del animal con IDENTIDAD RAFAQ (spec 09 R5 versión C2 / spec 02 R14
// parcial). Fix-loop C2 FIX 1: era una lista label-valor pelada en negro (genérica); ahora tiene
// jerarquía y marca.
//
// Aterrizaje del find-or-create (match → EDIT, post-create → R4.7) y del tap en la lista (R1.3).
// Anatomía:
//   - HERO header (capa de identidad): el identificador visual/IDV grande (Inter 700) + CategoryBadge
//     (firma verde de RAFAQ) + sexo con ícono en color ($primary) + rodeo. "La ficha de ESTE animal".
//   - Secciones (Identificación · Datos del animal): cards bone ($surface) con header de sección
//     (ícono lucide chico $primary) + filas label/valor. Identificadores largos truncados (no wrap).
//   - "Historial de eventos": teaser cálido ($greenLight + reloj $primary), NO un cuadro gris muerto.
// Las zonas Timeline + Editar + Agregar evento son C3.
//
// Criticidad 🟡. Cero hardcode (ADR-023 §4): tokens + componentes; íconos lucide con getTokenValue.
// Voseo es-AR. a11y por helper (utils/a11y).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { getTokenValue, ScrollView, Text, View, XStack, YStack } from 'tamagui';
import {
  Archive,
  Ban,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock,
  Gauge,
  HeartCrack,
  Layers,
  Mars,
  Milk,
  Pin,
  Plus,
  Ruler,
  Scissors,
  Star,
  Tag,
  Trash2,
  Venus,
} from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';

import { Button, Card, CategoryBadge, InfoNote, FormError, FormField, TimelineEvent } from '@/components';
import {
  fetchAnimalDetail,
  previewCastrationCategory,
  previewRevertCategory,
  revertCategoryOverride,
  setBreed,
  setCastrated,
  setCut,
  setFutureBull,
  unsetCut,
  type AnimalDetail,
  type AnimalStatus,
} from '@/services/animals';
import { fetchBreedCatalog } from '@/services/sigsa/sigsa-export-service';
import { BreedPickerSheet } from '@/components/sigsa';
import {
  breedCodeForName,
  selectedBreedLabel,
  type BreedCatalogEntry,
} from '@/utils/breed-picker';
import { fetchRodeoGating } from '@/services/rodeo-config';
import { canMarkCut, canUnmarkCut } from '@/utils/cut-eligibility';
import { archivedBadgeLabel } from '@/services/exit-animal';
import { useBusyWhileMounted } from '@/services/ble/stick';
import { CustomPropertiesFicha } from '../maniobra/_components/CustomPropertiesSection';
import { useAuth, useEstablishment } from '@/contexts';
import {
  assignAnimalToGroup,
  createManagementGroup,
  fetchManagementGroups,
  type ManagementGroup,
} from '@/services/management-groups';
import { canManageGroups, validateGroupName } from '@/utils/management-group';
import {
  deleteTypedEvent,
  fetchTimeline,
  fetchMother,
  type TimelineItem,
  type MotherLink,
} from '@/services/events';
import { shouldShowFutureBullBadge } from '@/components/AnimalRow';
import {
  deriveCurrentState,
  formatAgeYearsAR,
  formatEventDate,
  hasAbortion,
  humanizePregnancyState,
  scrotalRowsToTimelineItems,
  sortTimelineItems,
  type CurrentState,
} from '@/utils/event-timeline';
import { formatConditionScore } from '@/utils/event-input';
import { reproStatusLabel, type ReproStatus } from '@/utils/repro-status';
import type { HeiferFitness } from '@/utils/maneuver-sequence';
import { isBullEntire } from '@/utils/maneuver-applicability';
import { fetchScrotalHistory, type ScrotalMeasurementRow } from '@/services/scrotal';
import { formatCmWithUnitAR } from '@/utils/wheel-picker';
import { scrollFades, type ScrollFades } from '@/utils/scroll-affordance';
import { buttonA11y, labelA11y } from '@/utils/a11y';
import { backOr } from '@/utils/nav';

export default function AnimalDetailScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id?: string }>();
  const profileId = typeof params.id === 'string' ? params.id : null;

  // Anti-stacking (RB2.2): mientras la ficha (contexto EDIT) está montada, suspendemos el listener global
  // del bastón → un bastonazo NO abre el overlay find-or-create encima. No-op seguro hasta el mount del
  // provider en la raíz (Run 2 del chunk BLE global).
  useBusyWhileMounted();

  // Contexto de autorización para el gating del botón "Dar de baja" (C3.3, R4.14): el RPC enforça
  // server-side `has_role_in(est) AND (is_owner_of(est) OR created_by = auth.uid())`. El gating de
  // cliente es best-effort (el RPC es la barrera real), pero no mostramos el botón a quien no podría.
  const { state: authState } = useAuth();
  const { state: estState } = useEstablishment();
  const userId = authState.status === 'authenticated' ? authState.user.id : null;

  const [detail, setDetail] = useState<AnimalDetail | null>(null);
  // Lotes del campo del ANIMAL (C4): para el selector "Lote" de la ficha. Se cargan del
  // detail.establishmentId (el campo del perfil), NO del contexto activo (el usuario podría tener
  // otro campo activo mientras mira esta ficha — mismo cuidado multi-tenant que canExit).
  const [groups, setGroups] = useState<ManagementGroup[]>([]);
  const [timeline, setTimeline] = useState<TimelineItem[] | null>(null);
  const [timelineError, setTimelineError] = useState<string | null>(null);
  // Link a la madre (R14.7). null = no es ternero con parto registrado (o falló el fetch blando) → la
  // ficha NO muestra la card "Madre". El fetch es blando: si falla, la cabecera/timeline siguen vivos.
  const [mother, setMother] = useState<MotherLink | null>(null);
  // Gate de cliente de "Marcar como CUT" (delta spec 02, RCUT.7): true SOLO si el rodeo del animal habilita
  // el data_key `dientes` (best-effort, leído del rodeo_data_config local). `buildSetCutUpdate` es un cambio
  // ADITIVO (is_cut false→true) que el trigger 0054 rechaza al subir (23514) si `dientes` está off → no
  // ofrecemos algo que el server rechazaría. FAIL-SAFE conservador (RCUT.7.3): estado inicial `false` (no se
  // ofrece marcar a ciegas) y queda false si la lectura no resuelve / falla / no hay fila. NO gatea "Quitar
  // CUT" (sustractivo, RCUT.7.2). Solo se resuelve para hembras (el gate no aplica a machos).
  const [dientesEnabled, setDientesEnabled] = useState(false);
  // Histórico de CE del animal (spec 03 M6, R14.14). Solo se lee para MACHOS ENTEROS (la tarjeta de
  // tendencia se muestra solo a ellos — paridad con la fila repro solo-hembras). null = aún no cargado /
  // no aplica (no es macho entero); [] = macho entero sin mediciones (la 1ra medición es un caso legítimo,
  // no falta de sync). Lectura LOCAL blanda (fetchScrotalHistory): si falla, la tarjeta no se rompe (queda []).
  const [scrotalHistory, setScrotalHistory] = useState<ScrotalMeasurementRow[] | null>(null);
  // Catálogo de razas SENASA (offline, breed_catalog global) para el BreedPickerSheet de la ficha (spec 08,
  // T18 — editar la raza para completar breed_id). Carga blanda: si falla, el sheet muestra su empty-state
  // ("el catálogo no se descargó") y la fila Raza queda solo-lectura — no rompe la ficha.
  const [breedCatalog, setBreedCatalog] = useState<BreedCatalogEntry[]>([]);
  const [breedPickerOpen, setBreedPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // `load` distingue CARGA INICIAL (puede blanquear: setea `loading`, que desmonta el contenido y resetea
  // el scroll al tope) de REFRESH SILENCIOSO post-acción (`silent: true` — NO toca `loading`: el ScrollView
  // queda montado, el scroll se mantiene, solo cambian los datos). Las acciones de la ficha (toggle castrado,
  // ⭐, borrar evento, lote, revertir override) usan el refresh silencioso para reconciliar con el server SIN
  // el parpadeo en blanco / salto al tope que Raf reportó. El optimismo en sitio adelanta el cambio; este
  // refresh confirma (la observación automática en el timeline, la categoría del espejo C6).
  const load = useCallback(async (opts: { silent?: boolean } = {}) => {
    const silent = opts.silent === true;
    if (!profileId) {
      setError('No se encontró el animal.');
      setLoading(false);
      return;
    }
    if (!silent) setLoading(true);
    setError(null);
    setTimelineError(null);
    // Detalle + timeline + madre en paralelo (R10/R14/R14.7): un solo loading para la ficha entera.
    // El timeline y la madre tienen su propio manejo blando (si fallan, la cabecera sigue).
    const [detailR, timelineR, motherR] = await Promise.all([
      fetchAnimalDetail(profileId),
      fetchTimeline(profileId),
      fetchMother(profileId),
    ]);
    if (!silent) setLoading(false);
    if (!detailR.ok) {
      // En un refresh SILENCIOSO (post-acción) un fallo transitorio del detalle NO debe volar la ficha
      // entera (el contenido optimista ya está montado); dejamos el estado actual y salimos sin tocar el
      // error de pantalla. En la carga inicial sí mostramos el error (no hay nada que preservar).
      if (!silent) {
        setError(
          detailR.error.kind === 'network'
            ? 'Sin conexión: no pudimos cargar el animal.'
            : detailR.error.message,
        );
      }
      return;
    }
    setDetail(detailR.value);
    // Lotes del campo del animal (selector de lote, C4). Blando: si falla, el selector queda sin
    // opciones (se puede igual quitar el lote actual) — no rompe la ficha. Scope = campo del PERFIL.
    void fetchManagementGroups(detailR.value.establishmentId).then((gr) => {
      setGroups(gr.ok ? gr.value : []);
    });
    // Gate de "Marcar como CUT" (RCUT.7): resolver si el rodeo habilita `dientes` (best-effort, local).
    // Solo para HEMBRAS (el gate no aplica a machos; CUT es female-only). FAIL-SAFE conservador (RCUT.7.3):
    // arrancamos en false y solo lo prendemos si la lectura resuelve con `dientes` enabled === true. Cualquier
    // fallo / sin fila / sin rodeo → queda false (no ofrecer una acción que el server podría rechazar).
    if (detailR.value.sex === 'female') {
      void fetchRodeoGating(detailR.value.rodeoId).then((g) => {
        setDientesEnabled(g.ok ? g.value['dientes']?.enabled === true : false);
      });
    } else {
      setDientesEnabled(false);
    }
    // Histórico de CE (R14.14): solo para MACHOS ENTEROS (isBullEntire — mismo criterio que la aplicabilidad
    // de la maniobra, R14.2/R14.3). Lectura LOCAL blanda: si falla → [] (la tarjeta omite la lista, no rompe
    // la ficha). A hembra/ternero/castrado NO se lee (queda null → la tarjeta no se renderiza). El gate de
    // DISPLAY usa la categoría del espejo C6 (categoryCode) + is_castrated REAL, igual que el resto de la ficha.
    if (isBullEntire(detailR.value.categoryCode, detailR.value.isCastrated)) {
      void fetchScrotalHistory(detailR.value.profileId).then((h) => {
        setScrotalHistory(h.ok ? h.value : []);
      });
    } else {
      setScrotalHistory(null);
    }
    if (timelineR.ok) {
      setTimeline(timelineR.value);
    } else if (!silent) {
      setTimeline(null);
      setTimelineError(
        timelineR.error.kind === 'network'
          ? 'Sin conexión: no pudimos cargar el historial.'
          : 'No pudimos cargar el historial.',
      );
    }
    // En silent: si el timeline falló, conservamos el que ya estaba montado (no lo blanqueamos).
    // Madre (R14.7): blando — un fallo (red) deja la card sin mostrar, no rompe la ficha. value puede
    // ser null (el animal no es un ternero con parto registrado) → tampoco se muestra la card.
    setMother(motherR.ok ? motherR.value : null);
  }, [profileId]);

  // Recargar al enfocar. La PRIMERA carga (mount / cambio de profileId) puede blanquear (no hay nada que
  // preservar); los RE-FOCUS posteriores (volver de agregar-evento, o tras crear) son SILENCIOSOS → el
  // timeline se refresca y el evento nuevo aparece sin el parpadeo en blanco / salto al tope. El ref se
  // resetea al cambiar de animal (profileId) → ese cambio sí vuelve a mostrar la carga inicial.
  const didInitialLoadRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      const silent = didInitialLoadRef.current;
      didInitialLoadRef.current = true;
      void load({ silent });
    }, [load]),
  );
  // Al cambiar de animal, la próxima carga vuelve a ser inicial (blanquea — es otra ficha).
  const lastProfileIdRef = useRef(profileId);
  if (lastProfileIdRef.current !== profileId) {
    lastProfileIdRef.current = profileId;
    didInitialLoadRef.current = false;
  }

  // Catálogo de razas SENASA (global, breed_catalog del SQLite local) para el BreedPickerSheet de la ficha
  // (spec 08, T18). UNA sola lectura (es global e inmutable → no depende del animal ni del refresh). Blando:
  // si falla, queda [] → el sheet muestra su empty-state y la fila Raza queda solo-lectura, sin romper la ficha.
  useEffect(() => {
    void fetchBreedCatalog().then((bc) => {
      if (bc.ok) setBreedCatalog(bc.value);
    });
  }, []);

  const goToAddEvent = useCallback(() => {
    if (!detail) return;
    // Pasamos el SEXO del animal: el wizard oculta la sección "Reproductivo" (tacto/servicio/parto)
    // para machos — esos eventos son solo de hembras. detail.sex es 'male' | 'female'.
    //
    // Y pasamos si la hembra FIGURA PREÑADA en nuestros registros (deriveCurrentState del MISMO
    // timeline que ya alimenta la fila "Estado reproductivo"): el wizard usa esto para el AVISO SUAVE
    // al registrar un PARTO sobre una hembra que no figura preñada (no bloquea, solo confirma). Los
    // params de expo-router son strings → mandamos '1'/'0' y el wizard lo parsea. Si el timeline no
    // determina preñez (Sin registrar), pregnant=false → el wizard avisa (conservador).
    const pregnant = deriveCurrentState(timeline).pregnancy?.kind === 'pregnant';
    router.push({
      pathname: '/agregar-evento',
      params: {
        profileId: detail.profileId,
        establishmentId: detail.establishmentId,
        sex: detail.sex,
        pregnant: pregnant ? '1' : '0',
      },
    });
  }, [detail, timeline, router]);

  // Navegar a la ficha de la madre (R14.7). Tolerante a madre archivada (status ≠ active): la ficha
  // destino se carga igual (fetchAnimalDetail NO filtra por status), sin dead-end ni crash (R4.15).
  const goToMother = useCallback(() => {
    if (!mother) return;
    router.push({ pathname: '/animal/[id]', params: { id: mother.profileId } });
  }, [mother, router]);

  // Identificador HERO del animal (idv → visual → caravana → "Animal"): lo mismo que muestra el hero,
  // reusado para el resumen del sheet de baja. Memo: depende solo del detalle.
  const heroLabel = useMemo(
    () => detail?.idv ?? detail?.visualIdAlt ?? detail?.tagElectronic ?? 'Animal',
    [detail],
  );

  // Timeline COMPUESTO en el cliente (R14.14): el riel del server (`timeline`) + las mediciones de CE
  // (compuestas localmente, NO vienen de la vista server `animal_timeline` — design §12.6). Se mergean y
  // re-ordenan con el MISMO criterio que el resto del riel (`sortTimelineItems`). Si no hay CE (null/[]),
  // es el timeline tal cual. La CE solo se mergea para machos enteros (scrotalHistory queda null si no).
  const composedTimeline = useMemo(() => {
    if (timeline == null) return timeline; // aún cargando / error → no inventamos un riel
    if (!scrotalHistory || scrotalHistory.length === 0) return timeline;
    // ScrotalMeasurementRow es un superset estructural de ScrotalTimelineRow (id/circumferenceCm/ageMonths/
    // measuredAt/createdAt) → se pasa directo; scrotalRowsToTimelineItems ignora el sessionId extra.
    const scrotalItems = scrotalRowsToTimelineItems(scrotalHistory);
    return sortTimelineItems([...timeline, ...scrotalItems]);
  }, [timeline, scrotalHistory]);

  // ¿Mostramos "Dar de baja"? (C3.3, R4.14) Solo si:
  //   - el animal está ACTIVO (un archivado ya está de baja, no se vuelve a ofrecer), Y
  //   - el usuario es OWNER del campo del animal, O lo CARGÓ (detail.createdBy === userId).
  // Conservadurismo multi-tenant: el `role`/owner del contexto es del establishment ACTIVO. Si el
  // animal pertenece a OTRO campo (detail.establishmentId !== activo), el owner-flag del contexto NO
  // aplica a ese campo → en ese caso habilitamos SOLO por created_by === userId (el RPC re-valida con
  // has_role_in del campo del animal igual). Si coincide el campo activo, usamos estState.role.
  // ¿El usuario es OWNER del campo del ANIMAL? (best-effort, multi-tenant): el `role` del contexto es del
  // campo ACTIVO → solo lo sabemos si el animal pertenece al campo activo Y ese rol es owner. Si el animal
  // es de OTRO campo, no conocemos el rol del usuario en ese campo → false (conservador; la RLS del server
  // re-valida con has_role_in/is_owner_of del campo real). Reusado por canExit + el gating de borrar evento.
  const isOwnerOfAnimal = useMemo(() => {
    if (!detail) return false;
    const activeEstId = estState.status === 'active' ? estState.current.id : null;
    const animalInActiveEst = activeEstId != null && activeEstId === detail.establishmentId;
    return animalInActiveEst && estState.status === 'active' && estState.role === 'owner';
  }, [detail, estState]);

  const canExit = useMemo(() => {
    if (!detail || detail.status !== 'active') return false;
    const isAuthor = userId != null && detail.createdBy != null && detail.createdBy === userId;
    return isAuthor || isOwnerOfAnimal;
  }, [detail, userId, isOwnerOfAnimal]);

  const goToBaja = useCallback(() => {
    if (!detail) return;
    router.push({
      pathname: '/animal/baja',
      params: { profileId: detail.profileId, hero: heroLabel },
    });
  }, [detail, heroLabel, router]);

  // ── Lote (C4): gating + acciones. ──
  // El control de lote SOLO se muestra si el animal está ACTIVO (un archivado no se reorganiza). La
  // ASIGNACIÓN la permite cualquier rol operativo del campo del animal (RLS animal_profiles_update);
  // la UI la ofrece siempre (la RLS es la barrera real, un error 0-filas se traduce a copy es-AR). El
  // QUICK-CREATE de un lote nuevo es owner-only: como el `role` del contexto es del campo ACTIVO, solo
  // lo habilitamos si el animal pertenece al campo activo Y ese rol es owner (mismo cuidado que canExit;
  // si el animal es de otro campo no sabemos el rol → no ofrecemos crear, sí asignar a uno existente).
  const canEditLote = detail != null && detail.status === 'active';
  const canQuickCreateLote = useMemo(() => {
    if (!detail) return false;
    const activeEstId = estState.status === 'active' ? estState.current.id : null;
    const animalInActiveEst = activeEstId != null && activeEstId === detail.establishmentId;
    return animalInActiveEst && canManageGroups(estState.status === 'active' ? estState.role : null);
  }, [detail, estState]);

  // ── Raza (spec 08, T18): editar la raza desde la ficha para completar breed_id (exportable a SIGSA). ──
  // Editable SOLO si el animal está ACTIVO (un archivado no se re-clasifica). Cualquier rol operativo del
  // campo puede editar `breed` (RLS animal_profiles_update = has_role_in, mismo path que la CUT-ficha); la
  // RLS es la barrera real. El `selectedCode` del picker = el senasa_code que matchea el `breed` (nombre)
  // guardado (espeja el match del trigger 0113); null si el animal no tiene raza o el texto es legacy sin match.
  const canEditBreed = detail != null && detail.status === 'active';
  const selectedBreedCode = useMemo(
    () => breedCodeForName(breedCatalog, detail?.breed ?? null),
    [breedCatalog, detail?.breed],
  );

  // ── Quitar fijación de categoría (C6 / RC6.4). ──
  // Se ofrece SOLO si la categoría está fijada manualmente (override) Y el animal está ACTIVO (un
  // archivado no se reorganiza, igual que el Lote). Cualquier rol activo puede intentarlo: la RLS
  // `animal_profiles_update` es la barrera real (mismo razonamiento que el control de Lote). El revert
  // funciona OFFLINE (RC6.4.4): UPDATE local inmediato; la autorización se valida al subir.
  const canRevertOverride = detail != null && detail.categoryOverride && detail.status === 'active';

  const onRevertOverride = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    if (!detail) return { ok: false };
    const r = await revertCategoryOverride(detail.profileId);
    if (!r.ok) {
      return {
        ok: false,
        error:
          r.error.kind === 'network'
            ? 'Sin conexión: no pudimos quitar la fijación. Conectate y volvé a intentar.'
            : r.error.message,
      };
    }
    // Refresh SILENCIOSO (mismo principio en-sitio del fix Raf 2026-06-12): ahora override=false → el hero
    // muestra la categoría DERIVADA (offline, el UPDATE local ya pegó) SIN blanquear la pantalla ni saltar
    // al tope. La CategoryOverrideCard desmonta sola al re-leer detail.categoryOverride=false.
    await load({ silent: true });
    return { ok: true };
  }, [detail, load]);

  // Anticipa la CONSECUENCIA del revert (RC6.4.6): el NOMBRE de la categoría automática a la que volvería
  // el animal, para mostrarlo en la confirmación inline ("La categoría pasará a …"). Solo lectura (display).
  // null = no resoluble localmente (mismo caso que aborta el revert) → la card omite la línea de consecuencia.
  const onPreviewRevert = useCallback(async (): Promise<string | null> => {
    if (!detail) return null;
    const r = await previewRevertCategory(detail.profileId);
    return r.ok && r.value ? r.value.derivedName : null;
  }, [detail]);

  // ── Castrado Sí/No (spec 10 T-UI.7 / R13.1). ──
  // Solo machos activos. Anticipa la consecuencia (el NAME de la categoría destino con el is_castrated NUEVO,
  // espejo C6) en la confirmación; al confirmar, setCastrated encola el UPDATE + la observación automática
  // (R13.7). El espejo C6 muestra la categoría nueva al instante offline; el future_bull se auto-limpia al
  // castrar (server + el UPDATE) → al recargar la ficha ya no muestra el ⭐. La RLS es la barrera real al subir.
  const canEditCastrated = detail != null && detail.sex === 'male' && detail.status === 'active';

  // Anticipa el NAME de la categoría destino al flipear is_castrated a `nextValue` (RC6.4.6 espejo): null =
  // sin transición que anticipar (override, o destino == sin catálogo) → la card omite la línea de consecuencia.
  const onPreviewCastration = useCallback(
    async (nextValue: boolean): Promise<string | null> => {
      if (!detail) return null;
      const r = await previewCastrationCategory(detail.profileId, nextValue);
      // Solo anticipamos si el destino DIFIERE de la categoría actual (p. ej. ternero no transiciona al
      // castrarse → destino == actual → no mostramos una "consecuencia" que no cambia nada).
      if (!r.ok || !r.value || r.value.code === detail.categoryCode) return null;
      return r.value.name;
    },
    [detail],
  );

  const onSetCastrated = useCallback(
    async (value: boolean): Promise<{ ok: boolean; error?: string }> => {
      if (!detail) return { ok: false };
      const snapshot = detail; // para revertir el optimismo si la escritura falla
      // Anticipamos la categoría destino con el espejo C6 (mismo mirror que la confirmación) ANTES de
      // escribir → la podemos aplicar optimistamente. null = override / sin transición → no cambia categoría.
      const target = await previewCastrationCategory(detail.profileId, value);
      const targetCat = target.ok ? target.value : null;
      // OPTIMISMO EN SITIO (fix Raf 2026-06-12): reflejamos el cambio YA, sin esperar el re-fetch ni
      // blanquear la pantalla. is_castrated → value; al castrar se limpia el ⭐ (R12.4); la categoría
      // mostrada salta a la del espejo si hubo transición. El server es la verdad (LWW reconcilia al subir).
      setDetail((d) =>
        d == null
          ? d
          : {
              ...d,
              isCastrated: value,
              futureBull: value ? false : d.futureBull,
              ...(targetCat ? { categoryCode: targetCat.code, categoryName: targetCat.name } : {}),
            },
      );
      const r = await setCastrated(detail.profileId, value);
      if (!r.ok) {
        setDetail(snapshot); // REVERT: no dejamos un estado mentido si la acción fue rechazada
        return {
          ok: false,
          error:
            r.error.kind === 'network'
              ? 'Sin conexión: no pudimos guardar el cambio. Conectate y volvé a intentar.'
              : r.error.message,
        };
      }
      // Refresh SILENCIOSO (no blanquea, no resetea scroll): trae la observación automática al timeline +
      // confirma la categoría del espejo C6 con el is_castrated REAL ya persistido.
      void load({ silent: true });
      return { ok: true };
    },
    [detail, load],
  );

  // ── ⭐ Futuro torito (spec 10 T-UI.7 / R12.2). ──
  // Toggle SOLO en la ficha (no en el alta), solo machos NO castrados activos (un castrado ya no es futuro
  // torito — el flag se auto-limpia). Sin observación automática (no es castración). El badge ⭐ se muestra
  // solo si positivo y oculto en `toro` (R12.3, shouldShowFutureBullBadge).
  const canEditFutureBull =
    detail != null && detail.sex === 'male' && !detail.isCastrated && detail.status === 'active';

  const onSetFutureBull = useCallback(
    async (value: boolean): Promise<{ ok: boolean; error?: string }> => {
      if (!detail) return { ok: false };
      const snapshot = detail;
      // OPTIMISMO EN SITIO: el ⭐ no genera observación ni cambia categoría → solo flipeamos el flag. Sin
      // blanquear la pantalla. El badge ⭐ se recomputa en el render (shouldShowFutureBullBadge).
      setDetail((d) => (d == null ? d : { ...d, futureBull: value }));
      const r = await setFutureBull(detail.profileId, value);
      if (!r.ok) {
        setDetail(snapshot); // REVERT si la escritura fue rechazada
        return {
          ok: false,
          error:
            r.error.kind === 'network'
              ? 'Sin conexión: no pudimos guardar el cambio. Conectate y volvé a intentar.'
              : r.error.message,
        };
      }
      // Refresh silencioso para reconciliar (no hay cambio de timeline, pero mantiene el patrón uniforme).
      void load({ silent: true });
      return { ok: true };
    },
    [detail, load],
  );

  // ── Marcar / Quitar CUT (descarte) — delta spec 02 (RCUT.3/RCUT.5/RCUT.7). ──
  // CUT es female-only (D3). El predicado PURO (canMarkCut/canUnmarkCut) decide a quién se ofrece; el gate
  // de `dientes` (RCUT.7) lo AND-ea la ficha SOLO para marcar (el desmarcado es sustractivo, no gateado).
  // Conservador con categoryCode irresoluble (canMarkCut → false). La afordancia solo se ofrece en activos.
  const cutInfo = detail
    ? { sex: detail.sex, status: detail.status, categoryCode: detail.categoryCode, isCut: detail.isCut }
    : null;
  // "Marcar como CUT": hembra activa ≠ ternera, no-CUT (canMarkCut) Y el rodeo habilita `dientes` (RCUT.7.1).
  const canMark = cutInfo != null && canMarkCut(cutInfo) && dientesEnabled;
  // "Quitar CUT": hembra activa que YA es CUT (canUnmarkCut) — SIN gate de `dientes` (RCUT.7.2).
  const canUnmark = cutInfo != null && canUnmarkCut(cutInfo);

  const onSetCut = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    if (!detail) return { ok: false };
    const snapshot = detail; // para revertir el optimismo si la escritura falla
    // OPTIMISMO EN SITIO (mismo principio que onSetCastrated): la categoría pasa a CUT al instante (badge del
    // hero → amarillo) sin blanquear la ficha. isCut=true + override=true + categoryCode/Name = 'cut'/'CUT'
    // (lo que el espejo C6 mostrará: con override=true NO recalcula, así que la guardada manda).
    setDetail((d) =>
      d == null
        ? d
        : { ...d, isCut: true, categoryOverride: true, categoryCode: 'cut', categoryName: 'CUT' },
    );
    const r = await setCut(detail.profileId);
    if (!r.ok) {
      setDetail(snapshot); // REVERT: no dejamos un estado mentido si la acción fue rechazada
      return {
        ok: false,
        error:
          r.error.kind === 'network'
            ? 'Sin conexión: no pudimos marcar como CUT. Conectate y volvé a intentar.'
            : r.error.message,
      };
    }
    // Refresh SILENCIOSO: confirma la categoría CUT persistida (el UPDATE local ya pegó) sin saltar al tope.
    void load({ silent: true });
    return { ok: true };
  }, [detail, load]);

  const onUnsetCut = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    if (!detail) return { ok: false };
    const snapshot = detail;
    // OPTIMISMO EN SITIO: quitamos la marca CUT al instante (isCut=false + override=false). La categoría
    // DERIVADA la trae el refresh silencioso (el espejo C6 la recomputa con override=false) — no la
    // adivinamos acá para no mostrar una categoría equivocada; el badge sale de amarillo al quitar isCut.
    setDetail((d) => (d == null ? d : { ...d, isCut: false, categoryOverride: false }));
    const r = await unsetCut(detail.profileId);
    if (!r.ok) {
      setDetail(snapshot); // REVERT
      return {
        ok: false,
        error:
          r.error.kind === 'network'
            ? 'Sin conexión: no pudimos quitar la marca CUT. Conectate y volvé a intentar.'
            : r.error.message,
      };
    }
    // Refresh SILENCIOSO: trae la categoría derivada (override=false) y el badge vuelve a verde.
    void load({ silent: true });
    return { ok: true };
  }, [detail, load]);

  // ── Corrección individual de eventos (spec 10 T-UI.8 / R4.5). ──
  // Un evento de vacunación/destete del timeline es borrable (soft-delete) por OWNER del campo o AUTOR del
  // evento (reuso spec 02 R6.8.1). Gating de cliente best-effort: la RLS UPDATE (owner|autor) es la barrera
  // real. Solo se ofrece si el animal está ACTIVO (un archivado no recibe correcciones en MVP, igual que el
  // resto de las acciones de la ficha).
  const canDeleteEvent = useCallback(
    (item: TimelineItem): boolean => {
      if (!detail || detail.status !== 'active') return false;
      // Solo vacunación (sanitary 'vaccination') y destete (reproductive 'weaning') — los eventos que
      // generan las masivas de spec 10 (R4.5). El resto del timeline no se corrige desde acá en este chunk.
      const isVaccination = item.kind === 'sanitary' && item.eventType === 'vaccination';
      const isWeaning = item.kind === 'reproductive' && item.eventType === 'weaning';
      if (!isVaccination && !isWeaning) return false;
      const author = item.kind === 'sanitary' || item.kind === 'reproductive' ? item.createdBy : null;
      const isAuthor = userId != null && author != null && author === userId;
      return isOwnerOfAnimal || isAuthor;
    },
    [detail, userId, isOwnerOfAnimal],
  );

  const onDeleteEvent = useCallback(
    async (item: TimelineItem): Promise<{ ok: boolean; error?: string }> => {
      const snapshot = timeline; // para restaurar el ítem si el borrado fue rechazado
      // OPTIMISMO EN SITIO: sacamos el evento del timeline YA (sin blanquear la pantalla ni resetear el
      // scroll). El (eventId, kind) identifica el ítem unívocamente.
      setTimeline((tl) =>
        tl == null ? tl : tl.filter((t) => !(t.kind === item.kind && t.eventId === item.eventId)),
      );
      const r = await deleteTypedEvent({ kind: item.kind, eventId: item.eventId });
      if (!r.ok) {
        setTimeline(snapshot ?? null); // REVERT: el evento re-aparece si el server rechazó el borrado
        return {
          ok: false,
          error:
            r.error.kind === 'network'
              ? 'Sin conexión: no pudimos borrar el evento. Conectate y volvé a intentar.'
              : r.error.message,
        };
      }
      // Refresh SILENCIOSO: el detalle refleja el recálculo de categoría offline (un destete borrado revierte
      // la categoría vía el espejo C6) y el timeline confirma la baja — sin parpadeo ni salto al tope.
      void load({ silent: true });
      return { ok: true };
    },
    [timeline, load],
  );

  const onAssignLote = useCallback(
    async (groupId: string | null): Promise<{ ok: boolean; error?: string }> => {
      if (!detail) return { ok: false };
      const snapshot = detail;
      // OPTIMISMO EN SITIO: el lote mostrado salta al elegido (su nombre sale de `groups`; null = "Sin lote")
      // sin blanquear la pantalla ni resetear el scroll.
      const newName = groupId == null ? null : (groups.find((g) => g.id === groupId)?.name ?? null);
      setDetail((d) => (d == null ? d : { ...d, managementGroupId: groupId, managementGroupName: newName }));
      const r = await assignAnimalToGroup(detail.profileId, groupId);
      if (!r.ok) {
        setDetail(snapshot); // REVERT si el server rechazó
        return {
          ok: false,
          error: r.error.kind === 'network'
            ? 'Sin conexión: no pudimos cambiar el lote. Conectate y volvé a intentar.'
            : r.error.message,
        };
      }
      // Refresh SILENCIOSO para reconciliar (sin parpadeo ni salto al tope).
      void load({ silent: true });
      return { ok: true };
    },
    [detail, groups, load],
  );

  // Editar la RAZA desde la ficha (spec 08, T18 — completar/cambiar la raza para que el animal sea exportable
  // a SIGSA). El BreedPickerSheet llama con (breedId, senasaCode); persistimos el NOMBRE de la raza en `breed`
  // (texto), que es la columna que el trigger 0113 usa para DERIVAR breed_id al subir. "Sin raza" → (null,null)
  // → breed = null (el trigger deja breed_id NULL). NUNCA mandamos breed_id (lo deriva el trigger).
  const onSelectBreed = useCallback(
    async (_breedId: string | null, senasaCode: string | null): Promise<void> => {
      setBreedPickerOpen(false);
      if (!detail) return;
      // El nombre EXACTO del catálogo (lo que persiste en `breed`). "Sin raza" (senasaCode null) → null.
      const label = senasaCode == null ? null : selectedBreedLabel(breedCatalog, senasaCode);
      const newBreed = label ? label.name : null;
      if (newBreed === (detail.breed ?? null)) return; // sin cambio → no escribir
      const snapshot = detail;
      // OPTIMISMO EN SITIO: la raza mostrada salta a la elegida sin blanquear ni resetear el scroll.
      setDetail((d) => (d == null ? d : { ...d, breed: newBreed }));
      const r = await setBreed(detail.profileId, newBreed);
      if (!r.ok) {
        setDetail(snapshot); // REVERT si la escritura falló (no dejamos un estado mentido)
        return;
      }
      // Refresh SILENCIOSO para reconciliar (sin parpadeo ni salto al tope). breed_id lo deriva el trigger al
      // subir; el SQLite local convergerá al re-sincronizar (la ficha muestra `breed`, ya optimista).
      void load({ silent: true });
    },
    [detail, breedCatalog, load],
  );

  // Quick-create de un lote (owner) sin salir de la ficha + asignarlo de una. Devuelve el grupo nuevo
  // (para que el selector lo seleccione) o un error es-AR. Refresca los grupos del campo del animal.
  const onQuickCreateLote = useCallback(
    async (name: string): Promise<{ ok: boolean; group?: ManagementGroup; error?: string }> => {
      if (!detail) return { ok: false };
      const valid = validateGroupName(name);
      if (!valid.ok) return { ok: false, error: valid.error };
      const created = await createManagementGroup(detail.establishmentId, valid.value);
      if (!created.ok) {
        return {
          ok: false,
          error: created.error.kind === 'network'
            ? 'Sin conexión: no pudimos crear el lote. Conectate y volvé a intentar.'
            : created.error.message,
        };
      }
      const gr = await fetchManagementGroups(detail.establishmentId);
      if (gr.ok) setGroups(gr.value);
      return { ok: true, group: created.value };
    },
    [detail],
  );

  const muted = getTokenValue('$textMuted', 'color');

  return (
    <YStack flex={1} width="100%" maxWidth="100%" overflow="hidden" backgroundColor="$bg">
      {/* Barra superior compacta: solo el back (el título es el HERO, abajo). */}
      <YStack width="100%" paddingTop={insets.top} paddingHorizontal="$4">
        <XStack width="100%" alignItems="center" paddingVertical="$3">
          {/* "Volver" ROBUSTO (backOr): si el stack está vacío (web-refresh / hot-reload / deep-link
              / cold-start directo en la ficha) router.back() fallaría y dejaría al usuario trabado →
              caemos a la lista de animales (de donde se llega a la ficha por tap, R1.3). */}
          <Pressable
            hitSlop={8}
            onPress={() => backOr(router, '/(tabs)/animales')}
            {...buttonA11y(Platform.OS, { label: 'Volver' })}
          >
            <ChevronLeft size={28} color={muted} strokeWidth={2} />
          </Pressable>
        </XStack>
      </YStack>

      <ScrollView
        flex={1}
        width="100%"
        maxWidth="100%"
        contentContainerStyle={{
          paddingHorizontal: getTokenValue('$4', 'space'),
          paddingTop: getTokenValue('$1', 'space'),
          paddingBottom: insets.bottom + getTokenValue('$6', 'space'),
          width: '100%',
          maxWidth: '100%',
          gap: getTokenValue('$4', 'space'),
        }}
        showsHorizontalScrollIndicator={false}
      >
        {loading ? (
          <InfoNote>Cargando ficha…</InfoNote>
        ) : error ? (
          <FormError message={error} />
        ) : detail ? (
          <>
            <AnimalHero detail={detail} hadAbortion={hasAbortion(timeline)} />

            {/* Modo archivada (C3.3, R14.9): si el animal está de baja (status ≠ active), badge bajo el
                hero con el verbo + fecha de egreso ("Vendido el …"). Para un animal activo → null. */}
            <ArchivedBadge status={detail.status} exitDate={detail.exitDate} />

            {/* Categoría fijada manualmente (C6 / RC6.4.1): si el override está activo, un indicador
                explícito bajo el hero + (si el animal está activo) la acción "Quitar fijación" con
                confirmación inline. Para override=false → null (el espejo ya gobierna el display).
                Delta spec 02 (RCUT.5.7): un CUT (override=true + isCut=true) NO ofrece esta card genérica
                ("Quitar fijación" usa revertCategoryOverride, que NO resetea is_cut → estado inconsistente);
                su único desmarcado es "Quitar CUT" (en la sección Manejo). La card SÍ se sigue mostrando para
                un override NO-CUT (ej. "vaca comprada" fijada a multípara manual). */}
            {detail.categoryOverride && !detail.isCut ? (
              <CategoryOverrideCard
                canRevert={canRevertOverride}
                onRevert={onRevertOverride}
                onPreviewRevert={onPreviewRevert}
              />
            ) : null}

            {/* Link a la MADRE (R14.7): solo si el animal es un ternero con parto registrado. Tappable
                → ficha de la madre. Tolera madre archivada (status ≠ active): indicador + navega igual. */}
            {mother ? <MotherCard mother={mother} onPress={goToMother} /> : null}

            {/* Identificación: los 3 identificadores, truncados si son largos. */}
            <DetailSection icon={Tag} title="Identificación">
              <AttributeRow label="Caravana electrónica" value={detail.tagElectronic ?? '—'} />
              <AttributeRow label="Caravana / IDV" value={detail.idv ?? '—'} />
              <AttributeRow label="Identificación visual" value={detail.visualIdAlt ?? '—'} />
            </DetailSection>

            {/* Datos del animal. */}
            <DetailSection icon={ClipboardList} title="Datos del animal">
              <AttributeRow label="Sexo" value={detail.sex === 'male' ? 'Macho' : 'Hembra'} />
              <AttributeRow label="Nacimiento" value={detail.birthDate ?? '—'} />
              <AttributeRow label="Rodeo" value={detail.rodeoName || '—'} />
              {/* Raza (spec 08, T18): muestra la raza actual + afordancia para editarla (abre el BreedPickerSheet).
                  Sin raza → CTA "Completar raza para SIGSA". El trigger 0113 deriva breed_id del nombre al subir. */}
              <BreedRow
                breed={detail.breed}
                editable={canEditBreed}
                onEdit={() => setBreedPickerOpen(true)}
              />
              {detail.coatColor ? <AttributeRow label="Pelaje" value={detail.coatColor} /> : null}
            </DetailSection>

            {/* Manejo (spec 10 T-UI.7): Castrado Sí/No + ⭐ Futuro torito — SOLO machos (la castración no
                aplica a hembras; future_bull es solo-machos). Para hembras esta sección no se renderiza. */}
            {detail.sex === 'male' ? (
              <ManagementSection
                isCastrated={detail.isCastrated}
                futureBull={detail.futureBull}
                categoryCode={detail.categoryCode}
                canEditCastrated={canEditCastrated}
                canEditFutureBull={canEditFutureBull}
                onPreviewCastration={onPreviewCastration}
                onSetCastrated={onSetCastrated}
                onSetFutureBull={onSetFutureBull}
              />
            ) : null}

            {/* Manejo de HEMBRAS (delta spec 02, RCUT.5): afordancia CUT (descarte). Se ofrece "Marcar como
                CUT" si la hembra es activa ≠ ternera, no-CUT Y el rodeo habilita `dientes` (canMark); "Quitar
                CUT" si ya es CUT (canUnmark). Si ninguna aplica, la sección no se renderiza para esa hembra. */}
            {detail.sex === 'female' && (canMark || canUnmark) ? (
              <DetailSection icon={Ban} title="Manejo">
                <CutRow mode={canUnmark ? 'unmark' : 'mark'} onConfirm={canUnmark ? onUnsetCut : onSetCut} />
              </DetailSection>
            ) : null}

            {/* Lote (ADR-020 / C4): control para asignar / cambiar / quitar el lote. Cualquier rol
                operativo puede asignar (RLS); el quick-create de un lote nuevo es owner-only. Modo
                archivada (status ≠ active) → solo lectura (un animal de baja no se reorganiza). */}
            <LoteControl
              currentGroupId={detail.managementGroupId}
              currentGroupName={detail.managementGroupName}
              groups={groups}
              editable={canEditLote}
              canQuickCreate={canQuickCreateLote}
              onAssign={onAssignLote}
              onQuickCreate={onQuickCreateLote}
            />

            {/* Estado actual (fix-loop 2 FIX C): el VALOR VIGENTE de cada medición tipada (peso /
                condición corporal) = el del último evento de ese tipo. Es un ATRIBUTO del animal,
                no solo historia. El timeline de abajo sigue siendo la auditoría completa. */}
            <CurrentStateSection
              timeline={timeline}
              sex={detail.sex}
              categoryCode={detail.categoryCode}
              reproStatus={detail.reproStatus}
              reproAptitude={detail.reproAptitude}
            />

            {/* Tarjeta de tendencia de CIRCUNFERENCIA ESCROTAL (spec 03 M6, R14.14): la serie de mediciones
                (cm + edad + fecha es-AR) + una mini-tendencia. Se muestra SOLO a machos ENTEROS (isBullEntire
                — paridad con la fila "Estado reproductivo" solo-hembras). `scrotalHistory` queda null para el
                resto (no se renderiza). Para un macho entero SIN mediciones aún ([]) se muestra un empty cálido. */}
            {scrotalHistory != null ? <ScrotalTrendSection history={scrotalHistory} /> : null}

            {/* Datos PERSONALIZADOS (R13.10/R13.12): propiedades custom enabled del rodeo + sus current-values
                (custom_attributes). Editable in-place por cualquier rol (R13.13), salvo modo archivado (solo
                lectura). Si el rodeo no tiene propiedades custom (ni el animal valores), no renderiza nada. */}
            <CustomPropertiesFicha
              profileId={detail.profileId}
              rodeoId={detail.rodeoId}
              editable={detail.status === 'active'}
            />

            {/* Historial real (C3.1): riel de eventos + CTA "Agregar evento". El CTA se OCULTA en modo
                archivada (C3.3): un animal dado de baja no recibe eventos nuevos en MVP. Usa el timeline
                COMPUESTO (server + CE mergeada en cliente, R14.14) → la CE aparece en el riel. */}
            <HistorySection
              timeline={composedTimeline}
              error={timelineError}
              onAddEvent={goToAddEvent}
              onRetry={() => void load()}
              archived={detail.status !== 'active'}
              canDeleteEvent={canDeleteEvent}
              onDeleteEvent={onDeleteEvent}
            />

            {/* "Dar de baja" (C3.3, R4.14): al FONDO de la ficha, discreto (terracota/outline), gated:
                solo activo + (owner del campo o autor del alta). El RPC es la barrera real (42501). */}
            {canExit ? <ExitButton onPress={goToBaja} /> : null}
          </>
        ) : null}
      </ScrollView>

      {/* BreedPickerSheet (spec 08, T18): overlay para editar la raza (completar breed_id → exportable a SIGSA).
          Montado al ROOT (cubre toda la pantalla con su scrim). Solo si el animal cargó y es editable. Setea
          `breed` (nombre); el trigger 0113 deriva breed_id al subir. */}
      {detail && canEditBreed ? (
        <BreedPickerSheet
          open={breedPickerOpen}
          onClose={() => setBreedPickerOpen(false)}
          breeds={breedCatalog}
          selectedCode={selectedBreedCode}
          onSelect={onSelectBreed}
        />
      ) : null}
    </YStack>
  );
}

// ─── Hero de identidad del animal ─────────────────────────────────────────────────────

/**
 * Hero header: el identificador HERO grande (idv → visual → caravana) + CategoryBadge (firma verde)
 * + (si tuvo aborto) el flag "Tuvo aborto" terracota + sexo con ícono en color + rodeo muted. Es la
 * "cara" de la ficha — da personalidad donde antes había un título negro pelado.
 */
function AnimalHero({ detail, hadAbortion }: { detail: AnimalDetail; hadAbortion: boolean }) {
  const primary = getTokenValue('$primary', 'color');
  const hero = detail.idv ?? detail.visualIdAlt ?? detail.tagElectronic ?? 'Animal';
  const SexIcon = detail.sex === 'male' ? Mars : Venus;
  const sexLabel = detail.sex === 'male' ? 'Macho' : 'Hembra';
  const categoryLabel = detail.categoryName || detail.categoryCode;

  return (
    <YStack width="100%" gap="$3" paddingTop="$1">
      {/* Identificador hero: grande, bold, truncado a 1 línea (un IDV de 40 díg no wrappea).
          lineHeight="$9" (= fontSize "$9") para que el line-box no clipee el glifo arriba/abajo
          (mismo bug que el título "Equipo" de B.1.3, resuelto seteando lineHeight al fontSize). */}
      <Text
        fontFamily="$body"
        fontSize="$9"
        lineHeight="$9"
        fontWeight="700"
        color="$textPrimary"
        numberOfLines={1}
        minWidth={0}
      >
        {hero}
      </Text>

      {/* Fila de chips de identidad: categoría (verde) · [flag aborto terracota] · sexo (ícono color)
          · rodeo. El flag "Tuvo aborto" (A2, marquita roja) va junto al CategoryBadge si hubo ≥1 aborto. */}
      <XStack width="100%" alignItems="center" gap="$2" flexWrap="wrap">
        {/* code={detail.categoryCode}: ruta preferida de detección CUT (RCUT.6.2) → el badge del hero pasa a
            AMARILLO al toque cuando se marca CUT (el optimismo en sitio setea categoryCode='cut'). */}
        <CategoryBadge label={categoryLabel} code={detail.categoryCode} manual={detail.categoryOverride} size="md" />
        {hadAbortion ? <AbortionFlag /> : null}
        <XStack alignItems="center" gap="$1" {...labelA11y(Platform.OS, `Sexo ${sexLabel}`)}>
          <SexIcon size={18} color={primary} strokeWidth={2.5} />
          <Text fontFamily="$body" fontSize="$4" fontWeight="500" color="$textMuted">
            {sexLabel}
          </Text>
        </XStack>
        {detail.rodeoName ? (
          <>
            <Text fontFamily="$body" fontSize="$4" fontWeight="400" color="$textFaint">
              ·
            </Text>
            <Text
              fontFamily="$body"
              fontSize="$4"
              fontWeight="500"
              color="$textMuted"
              numberOfLines={1}
              flexShrink={1}
              minWidth={0}
            >
              {detail.rodeoName}
            </Text>
          </>
        ) : null}
      </XStack>
    </YStack>
  );
}

// ─── Flag "Tuvo aborto" (A2, marquita roja — dominio Facundo §1) ──────────────────────
//
// Indicador chico TERRACOTA en el hero si el animal tuvo al menos un aborto (hasAbortion del timeline).
// Permanente: una vez que hubo un aborto, queda marcado (es historia, no estado que se limpie). Pill al
// lenguaje del CategoryBadge pero en terracota (señal médica/pérdida): como NO hay token terracota-claro
// en la paleta (igual que TimelineEvent), usamos $surface de fondo + borde y texto $terracota + el ícono
// HeartCrack. a11y por helper (View no mapea accessibilityLabel a aria-label en web → labelA11y). Cero
// hardcode: tokens + getTokenValue para el ícono lucide (cruza a API no-Tamagui).
function AbortionFlag() {
  const terracota = getTokenValue('$terracota', 'color');
  return (
    <View
      backgroundColor="$surface"
      borderWidth={1}
      borderColor="$terracota"
      borderRadius="$pill"
      paddingHorizontal="$3"
      paddingVertical="$1"
      alignSelf="flex-start"
      {...labelA11y(Platform.OS, 'Tuvo aborto')}
    >
      <XStack alignItems="center" gap="$1">
        <HeartCrack size={14} color={terracota} strokeWidth={2.5} />
        <Text fontFamily="$body" fontSize="$4" fontWeight="600" color="$terracota" numberOfLines={1}>
          Tuvo aborto
        </Text>
      </XStack>
    </View>
  );
}

// ─── Badge de modo archivada (C3.3, R14.9) ────────────────────────────────────────────
//
// Si el animal está de baja (status ≠ active), una fila bajo el hero con el ÍCono Archive + el verbo
// derivado de status+exit_date ("Vendido el {fecha}" / "Muerto el …" / "Transferido el …"). Para un
// animal activo, archivedBadgeLabel devuelve null → no se renderiza nada. La fecha puede ser null
// (datos viejos): el helper PURO ya evita el "null" literal (solo el verbo). Lenguaje terracota como
// AbortionFlag (señal de estado de salida): $surface de fondo + borde/texto/ícono $terracota (no hay
// token terracota-claro). a11y por helper (View no mapea accessibilityLabel a aria-label en web).
function ArchivedBadge({ status, exitDate }: { status: AnimalStatus; exitDate: string | null }) {
  const label = archivedBadgeLabel(status, exitDate);
  if (!label) return null;
  const terracota = getTokenValue('$terracota', 'color');
  return (
    <View
      backgroundColor="$surface"
      borderWidth={1}
      borderColor="$terracota"
      borderRadius="$card"
      paddingHorizontal="$4"
      paddingVertical="$3"
      alignSelf="flex-start"
      {...labelA11y(Platform.OS, label)}
    >
      <XStack alignItems="center" gap="$2">
        <Archive size={18} color={terracota} strokeWidth={2.5} />
        <Text fontFamily="$body" fontSize="$5" fontWeight="600" color="$terracota" numberOfLines={1}>
          {label}
        </Text>
      </XStack>
    </View>
  );
}

// ─── Card "Categoría fijada manualmente" + quitar fijación (C6 / RC6.4) ───────────────
//
// Indicador EXPLÍCITO bajo el hero cuando la categoría está fijada a mano (category_override = true):
// el server NO transiciona la categoría de este animal (R4.9 "override manda") — el dueño la gestiona
// manual. Más visible que el punto sutil del CategoryBadge: comunica POR QUÉ no transiciona.
//
// Acción "Quitar fijación" (RC6.4.2/RC6.4.3): solo si el animal está ACTIVO (`canRevert`); cualquier rol
// activo puede intentarla (la RLS `animal_profiles_update` es la barrera real). Confirmación INLINE
// (expande Confirmar/Cancelar) — la acción es reversible-en-la-práctica (volver a fijar = editar la
// categoría) pero cambia el comportamiento del animal, así que pedimos un toque de confirmación. Funciona
// OFFLINE (el UPDATE local pega al instante; RC6.4.4). Si la derivada no resuelve localmente, el service
// devuelve un error es-AR accionable y NO escribe (RC6.4.5) → se muestra acá sin tocar la categoría.
//
// CONSECUENCIA visible (RC6.4.6, Nielsen #1 visibilidad + #5 prevención de error): al confirmar, la card
// anticipa A QUÉ CATEGORÍA volvería el animal ("La categoría pasará a …") usando el NAME legible de la
// derivada (`onPreviewRevert`, la MISMA resolución que el revert ⇒ no divergen). Si no es resoluble
// localmente (RC6.4.5), no se anticipa nada (el flujo de error del revert manda) → línea omitida.
//
// Lenguaje visual: $surface + borde/ícono/texto $primary (firma RAFAQ, NO terracota — esto NO es una
// alerta ni una baja). a11y por helper. Cero hardcode (tokens + getTokenValue para el ícono lucide).
function CategoryOverrideCard({
  canRevert,
  onRevert,
  onPreviewRevert,
}: {
  canRevert: boolean;
  onRevert: () => Promise<{ ok: boolean; error?: string }>;
  /** Anticipa el NAME de la categoría derivada (consecuencia) o null si no es resoluble (RC6.4.6). */
  onPreviewRevert: () => Promise<string | null>;
}) {
  const primary = getTokenValue('$primary', 'color');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Name de la categoría derivada para la línea de consecuencia. null = aún no resuelta / no resoluble.
  const [derivedName, setDerivedName] = useState<string | null>(null);

  const startConfirm = useCallback(() => {
    setConfirming(true);
    setError(null);
    setDerivedName(null);
    // Anticipamos la consecuencia (la categoría a la que volvería). Blando: si no resuelve, la línea no se
    // muestra (no bloquea la acción — el revert real surfaceará el error si lo hubiera). Sin race relevante:
    // el peor caso es que el name llegue un instante después (la confirmación ya está visible).
    void onPreviewRevert().then((name) => setDerivedName(name));
  }, [onPreviewRevert]);

  const onConfirm = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const r = await onRevert();
    // Si OK, la ficha recarga (override=false) → esta card desmonta sola; no reseteamos busy para evitar
    // un parpadeo. Si falla, surfaceamos el error y volvemos a habilitar.
    if (!r.ok) {
      setBusy(false);
      setError(r.error ?? 'No se pudo quitar la fijación.');
      return;
    }
  }, [busy, onRevert]);

  return (
    <View
      backgroundColor="$surface"
      borderWidth={1}
      borderColor="$primary"
      borderRadius="$card"
      paddingHorizontal="$4"
      paddingVertical="$3"
      gap="$3"
      {...labelA11y(Platform.OS, 'Categoría fijada manualmente')}
    >
      <XStack alignItems="center" gap="$2">
        <Pin size={18} color={primary} strokeWidth={2.5} />
        <Text flex={1} minWidth={0} fontFamily="$body" fontSize="$4" fontWeight="600" color="$primary" numberOfLines={2}>
          Categoría fijada manualmente
        </Text>
      </XStack>

      {error ? <FormError message={error} /> : null}

      {/* Acción "Quitar fijación" SOLO para un animal activo (canRevert). Confirmación inline. */}
      {canRevert ? (
        confirming ? (
          <YStack gap="$3">
            {/* Consecuencia (RC6.4.6): a qué categoría vuelve el animal. Tipografía SECUNDARIA ($3/muted)
                — informa sin competir con los botones. Solo cuando la derivada resolvió (sino, omitida). */}
            {derivedName ? (
              <Text
                fontFamily="$body"
                fontSize="$3"
                fontWeight="500"
                color="$textMuted"
                {...labelA11y(Platform.OS, `La categoría pasará a ${derivedName}.`)}
              >
                La categoría pasará a {derivedName}.
              </Text>
            ) : null}
            <XStack gap="$2">
              <YStack flex={1}>
                <Button
                  variant="secondary"
                  fullWidth
                  disabled={busy}
                  onPress={() => {
                    setConfirming(false);
                    setError(null);
                    setDerivedName(null);
                  }}
                >
                  Cancelar
                </Button>
              </YStack>
              <YStack flex={1}>
                <Button variant="primary" fullWidth disabled={busy} onPress={() => void onConfirm()}>
                  {busy ? 'Quitando…' : 'Sí, quitar'}
                </Button>
              </YStack>
            </XStack>
          </YStack>
        ) : (
          <Pressable
            style={{ width: '100%' }}
            onPress={startConfirm}
            {...buttonA11y(Platform.OS, { label: 'Quitar fijación' })}
          >
            <XStack
              width="100%"
              minHeight="$touchMin"
              alignItems="center"
              justifyContent="center"
              gap="$2"
              borderRadius="$pill"
              backgroundColor="transparent"
              borderWidth={2}
              borderColor="$primary"
              paddingHorizontal="$5"
              pressStyle={{ backgroundColor: '$greenLight' }}
            >
              <Text fontFamily="$body" fontSize="$5" fontWeight="600" color="$primary">
                Quitar fijación
              </Text>
            </XStack>
          </Pressable>
        )
      ) : null}
    </View>
  );
}

// ─── Fila CUT (descarte) de la ficha de HEMBRAS (delta spec 02, RCUT.5) ───────────────
//
// Espejo estructural de CastrationRow: confirmación INLINE (expande Confirmar/Cancelar, no navega ni abre
// modal), optimismo EN SITIO (lo maneja el padre en onConfirm → setCut/unsetCut), error inline, `busy`.
// Dos modos:
//   - mark   → "Marcar como CUT (descarte)" + consecuencia literal "La categoría pasará a CUT (descarte)."
//              (la consecuencia es FIJA, no consulta el catálogo — design §3). Confirmar → setCut.
//   - unmark → "Quitar CUT" + pregunta "¿Quitar la marca CUT de este animal?" (sin línea de consecuencia,
//              la derivada la trae el refresh). Confirmar → unsetCut.
//
// Lenguaje visual: la marca de descarte usa los tokens AMBER del badge CUT ($cutText / $cutBg) — coherencia
// con el badge amarillo (RCUT.6) y señal de "esto saca al animal del rodeo productivo", distinta del verde
// de manejo neutro. Cero hardcode (tokens + getTokenValue para el ícono lucide). a11y por helper. El texto
// "Marcar como CUT (descarte)" tiene descendentes (g/j) → lineHeight matcheando el fontSize.
function CutRow({
  mode,
  onConfirm,
}: {
  mode: 'mark' | 'unmark';
  onConfirm: () => Promise<{ ok: boolean; error?: string }>;
}) {
  const cutText = getTokenValue('$cutText', 'color');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isMark = mode === 'mark';
  const actionLabel = isMark ? 'Marcar como CUT (descarte)' : 'Quitar CUT';
  const question = isMark ? '¿Marcar este animal como CUT (descarte)?' : '¿Quitar la marca CUT de este animal?';

  const startConfirm = useCallback(() => {
    setConfirming(true);
    setError(null);
  }, []);

  const handleConfirm = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const r = await onConfirm();
    // El cambio es OPTIMISTA en el padre (la ficha NO se recarga blanqueando). En OK cerramos la confirmación
    // (la fila ya refleja el estado nuevo / desmonta al cambiar canMark/canUnmark); en error mostramos el
    // motivo y dejamos la confirmación abierta para reintentar (sin cambiar el estado mostrado, RCUT.5.3).
    setBusy(false);
    if (!r.ok) {
      setError(r.error ?? 'No se pudo guardar el cambio.');
      return;
    }
    setConfirming(false);
  }, [busy, onConfirm]);

  return (
    <YStack gap="$2">
      {/* Afordancia colapsada: el botón de acción (amber-outline, marca de descarte). Al tocar expande la
          confirmación inline. Mientras confirma, se oculta (los botones Confirmar/Cancelar lo reemplazan). */}
      {!confirming ? (
        <Pressable
          style={{ width: '100%' }}
          onPress={startConfirm}
          {...buttonA11y(Platform.OS, { label: actionLabel })}
        >
          <XStack
            width="100%"
            minHeight="$touchMin"
            alignItems="center"
            justifyContent="center"
            gap="$2"
            borderRadius="$pill"
            backgroundColor="transparent"
            borderWidth={2}
            borderColor="$cutText"
            paddingHorizontal="$5"
            pressStyle={{ backgroundColor: '$cutBg' }}
          >
            <Ban size={18} color={cutText} strokeWidth={2.5} />
            <Text
              fontFamily="$body"
              fontSize="$5"
              lineHeight="$5"
              fontWeight="600"
              color="$cutText"
              numberOfLines={1}
            >
              {actionLabel}
            </Text>
          </XStack>
        </Pressable>
      ) : null}

      {error ? <FormError message={error} /> : null}

      {/* Confirmación inline (RCUT.5.1). Anticipa la pregunta + (solo al marcar) la CONSECUENCIA literal. */}
      {confirming ? (
        <YStack gap="$3" paddingTop="$1">
          <Text fontFamily="$body" fontSize="$4" lineHeight="$4" fontWeight="500" color="$textPrimary">
            {question}
          </Text>
          {/* Consecuencia FIJA (RCUT.5.2): solo al MARCAR. Tipografía secundaria — informa sin competir. */}
          {isMark ? (
            <Text
              fontFamily="$body"
              fontSize="$3"
              lineHeight="$3"
              fontWeight="500"
              color="$textMuted"
              {...labelA11y(Platform.OS, 'La categoría pasará a CUT (descarte).')}
            >
              La categoría pasará a CUT (descarte).
            </Text>
          ) : null}
          <XStack gap="$2">
            <YStack flex={1}>
              <Button
                variant="secondary"
                fullWidth
                disabled={busy}
                onPress={() => {
                  setConfirming(false);
                  setError(null);
                }}
              >
                Cancelar
              </Button>
            </YStack>
            <YStack flex={1}>
              <Button variant="primary" fullWidth disabled={busy} onPress={() => void handleConfirm()}>
                {busy ? 'Guardando…' : 'Confirmar'}
              </Button>
            </YStack>
          </XStack>
        </YStack>
      ) : null}
    </YStack>
  );
}

// ─── Sección "Manejo" (spec 10 T-UI.7): Castrado Sí/No + ⭐ Futuro torito (solo machos) ────────
//
// Dos controles de manejo del macho, agrupados en una card con la firma RAFAQ (DetailSection + Scissors):
//   1. "Castrado": estado editable (R13.1) con confirmación que ANTICIPA el recálculo de categoría (espejo
//      C6, igual patrón que CategoryOverrideCard). Al confirmar → setCastrated (UPDATE + observación
//      automática R13.7). El flip NO es un evento tipado en el timeline (D10) — aparece como observación.
//   2. "Futuro torito" ⭐ (R12.2): toggle que protege al ternero de la castración masiva. Solo si el animal
//      NO está castrado (un castrado ya no es futuro torito; el flag se auto-limpia). Badge ⭐ visible solo
//      positivo + oculto en `toro` (R12.3, shouldShowFutureBullBadge). Sin observación (no es castración).
//
// Cero hardcode (tokens + getTokenValue para íconos). a11y por helper. La confirmación del castrado es una
// acción con CONSECUENCIA (recalcula categoría) → confirmación inline explícita; el ⭐ es un toggle liviano.
function ManagementSection({
  isCastrated,
  futureBull,
  categoryCode,
  canEditCastrated,
  canEditFutureBull,
  onPreviewCastration,
  onSetCastrated,
  onSetFutureBull,
}: {
  isCastrated: boolean;
  futureBull: boolean;
  categoryCode: string;
  canEditCastrated: boolean;
  canEditFutureBull: boolean;
  /** Anticipa el NAME de la categoría destino al flipear is_castrated a `next` (o null si no transiciona). */
  onPreviewCastration: (next: boolean) => Promise<string | null>;
  onSetCastrated: (value: boolean) => Promise<{ ok: boolean; error?: string }>;
  onSetFutureBull: (value: boolean) => Promise<{ ok: boolean; error?: string }>;
}) {
  return (
    <DetailSection icon={Scissors} title="Manejo">
      <CastrationRow
        isCastrated={isCastrated}
        editable={canEditCastrated}
        onPreviewCastration={onPreviewCastration}
        onSetCastrated={onSetCastrated}
      />
      {/* Futuro torito: solo se ofrece el toggle si el animal NO está castrado (un castrado ya no es futuro
          torito). Si está castrado, la fila desaparece (no hay nada que togglear). */}
      {!isCastrated ? (
        <FutureBullRow
          futureBull={futureBull}
          categoryCode={categoryCode}
          editable={canEditFutureBull}
          onSetFutureBull={onSetFutureBull}
        />
      ) : null}
    </DetailSection>
  );
}

/**
 * Fila "Castrado Sí/No" (R13.1). Muestra el estado actual (Sí/No) + un control para cambiarlo (solo machos
 * activos, `editable`). Al tocar "Cambiar" expande una confirmación INLINE que ANTICIPA el recálculo de
 * categoría ("La categoría se recalcula: Torito → Novillito") usando el espejo C6 (onPreviewCastration). Al
 * confirmar → onSetCastrated(nuevoValor). El destino se anticipa solo si la categoría cambia (en `ternero` no
 * transiciona → no se muestra la línea; igual se aplica el flip + la observación automática R13.7).
 */
function CastrationRow({
  isCastrated,
  editable,
  onPreviewCastration,
  onSetCastrated,
}: {
  isCastrated: boolean;
  editable: boolean;
  onPreviewCastration: (next: boolean) => Promise<string | null>;
  onSetCastrated: (value: boolean) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // NAME de la categoría destino para la línea de consecuencia. null = aún no resuelta / no transiciona.
  const [targetName, setTargetName] = useState<string | null>(null);

  const nextValue = !isCastrated; // el cambio invierte el estado actual

  const startConfirm = useCallback(() => {
    setConfirming(true);
    setError(null);
    setTargetName(null);
    // Anticipamos la consecuencia (la categoría destino con el is_castrated NUEVO). Blando: si no transiciona
    // (ternero) o no resuelve, la línea no se muestra — el flip se aplica igual (+ observación R13.7).
    void onPreviewCastration(nextValue).then((name) => setTargetName(name));
  }, [onPreviewCastration, nextValue]);

  const onConfirm = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const r = await onSetCastrated(nextValue);
    // El cambio es OPTIMISTA en el padre (la ficha NO se recarga blanqueando) → esta fila persiste su
    // instancia; reseteamos busy SIEMPRE (si no, un próximo "Cambiar" abriría la confirmación con los botones
    // trabados en disabled). En OK cerramos la confirmación (la fila ya muestra el estado nuevo); en error
    // revertimos + mostramos el motivo, dejando la confirmación abierta para reintentar.
    setBusy(false);
    if (!r.ok) {
      setError(r.error ?? 'No se pudo guardar el cambio.');
      return;
    }
    setConfirming(false);
    setTargetName(null);
  }, [busy, onSetCastrated, nextValue]);

  return (
    <YStack gap="$2">
      <XStack alignItems="center" gap="$2">
        <YStack flex={1} minWidth={0} gap="$1">
          <Text fontFamily="$body" fontSize="$3" fontWeight="500" color="$textMuted">
            Castrado
          </Text>
          <Text fontFamily="$body" fontSize="$5" fontWeight="600" color="$textPrimary">
            {isCastrated ? 'Sí' : 'No'}
          </Text>
        </YStack>
        {/* "Cambiar" SOLO para un macho activo (editable). Discreto (link $primary), abre la confirmación. */}
        {editable && !confirming ? (
          <Pressable
            hitSlop={8}
            onPress={startConfirm}
            {...buttonA11y(Platform.OS, { label: isCastrated ? 'Marcar como no castrado' : 'Marcar como castrado' })}
          >
            <Text fontFamily="$body" fontSize="$4" fontWeight="600" color="$primary">
              Cambiar
            </Text>
          </Pressable>
        ) : null}
      </XStack>

      {error ? <FormError message={error} /> : null}

      {/* Confirmación inline que anticipa el recálculo (R13.1). */}
      {editable && confirming ? (
        <YStack gap="$3" paddingTop="$1">
          <Text fontFamily="$body" fontSize="$4" fontWeight="500" color="$textPrimary">
            {nextValue ? '¿Marcar este animal como castrado?' : '¿Marcar este animal como NO castrado?'}
          </Text>
          {/* Consecuencia (espejo C6): a qué categoría se recalcula. Tipografía secundaria. Omitida si no
              transiciona (ternero) o no resolvió → solo se aplica el flip + la observación automática. */}
          {targetName ? (
            <Text
              fontFamily="$body"
              fontSize="$3"
              fontWeight="500"
              color="$textMuted"
              {...labelA11y(Platform.OS, `La categoría se recalcula a ${targetName}.`)}
            >
              La categoría se recalcula: {targetName}
            </Text>
          ) : null}
          <XStack gap="$2">
            <YStack flex={1}>
              <Button
                variant="secondary"
                fullWidth
                disabled={busy}
                onPress={() => {
                  setConfirming(false);
                  setError(null);
                  setTargetName(null);
                }}
              >
                Cancelar
              </Button>
            </YStack>
            <YStack flex={1}>
              <Button variant="primary" fullWidth disabled={busy} onPress={() => void onConfirm()}>
                {busy ? 'Guardando…' : 'Confirmar'}
              </Button>
            </YStack>
          </XStack>
        </YStack>
      ) : null}
    </YStack>
  );
}

/**
 * Fila "Futuro torito" ⭐ (R12.2): toggle de manejo del ternero macho. Muestra el badge ⭐ cuando es positivo
 * (y la categoría no es `toro`, R12.3) + un control para marcar/desmarcar (solo machos no castrados activos,
 * `editable`). Sin confirmación (toggle liviano, sin consecuencia de categoría) y sin observación. El cambio
 * recarga la ficha (onSetFutureBull → load) → el badge se actualiza al instante.
 */
function FutureBullRow({
  futureBull,
  categoryCode,
  editable,
  onSetFutureBull,
}: {
  futureBull: boolean;
  categoryCode: string;
  editable: boolean;
  onSetFutureBull: (value: boolean) => Promise<{ ok: boolean; error?: string }>;
}) {
  const terracota = getTokenValue('$terracota', 'color');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const showStar = shouldShowFutureBullBadge(futureBull, categoryCode);

  const onToggle = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const r = await onSetFutureBull(!futureBull);
    // El cambio es OPTIMISTA en el padre (la ficha NO se recarga blanqueando) → este componente persiste su
    // instancia; reseteamos busy SIEMPRE para no dejar el botón trabado en "Guardando…". En OK la fila ya
    // se re-renderizó con el `futureBull` nuevo; en error revertimos + mostramos el motivo.
    setBusy(false);
    if (!r.ok) {
      setError(r.error ?? 'No se pudo guardar el cambio.');
    }
  }, [busy, onSetFutureBull, futureBull]);

  return (
    <YStack gap="$2">
      <XStack alignItems="center" gap="$2">
        <YStack flex={1} minWidth={0} gap="$1">
          <Text fontFamily="$body" fontSize="$3" fontWeight="500" color="$textMuted">
            Futuro torito
          </Text>
          <XStack alignItems="center" gap="$2">
            <Text fontFamily="$body" fontSize="$5" fontWeight="600" color="$textPrimary">
              {futureBull ? 'Sí' : 'No'}
            </Text>
            {showStar ? <Star size={16} color={terracota} strokeWidth={2.5} fill={terracota} /> : null}
          </XStack>
        </YStack>
        {/* Toggle (marcar/desmarcar) — solo macho no castrado activo. Discreto (link $primary). */}
        {editable ? (
          <Pressable
            hitSlop={8}
            disabled={busy}
            onPress={() => void onToggle()}
            {...buttonA11y(Platform.OS, { label: futureBull ? 'Quitar futuro torito' : 'Marcar como futuro torito' })}
          >
            <Text fontFamily="$body" fontSize="$4" fontWeight="600" color={busy ? '$textFaint' : '$primary'}>
              {busy ? 'Guardando…' : futureBull ? 'Quitar' : 'Marcar'}
            </Text>
          </Pressable>
        ) : null}
      </XStack>
      {error ? <FormError message={error} /> : null}
    </YStack>
  );
}

// ─── Card "Madre" (link a la ficha de la madre, R14.7) ────────────────────────────────

/**
 * Mapa status (≠ active) → label de archivada para el indicador (R14.7). El `exit_reason` detallado y
 * el "modo archivada" completo de la ficha son C3.3; acá solo NO hacemos dead-end e indicamos que la
 * madre no está activa. status 'active' → null (no se muestra indicador).
 */
function archivedLabel(status: AnimalStatus): string | null {
  switch (status) {
    case 'sold':
      return 'Vendida';
    case 'dead':
      return 'Muerta';
    case 'transferred':
      return 'Transferida';
    default:
      return null;
  }
}

/**
 * Card tappable "Madre" (R14.7): ícono Milk (firma RAFAQ verde) + label de la madre + su categoría;
 * si la madre está archivada (status ≠ active), un indicador chico ("Vendida"/"Muerta"/"Transferida").
 * Al tocar → ficha de la madre (tolerante a archivada, R4.15). a11y por helper (Pressable). Cero
 * hardcode (tokens). Mismo lenguaje visual que las TypeCard (borde, halo verde, chevron).
 */
function MotherCard({ mother, onPress }: { mother: MotherLink; onPress: () => void }) {
  const primary = getTokenValue('$primary', 'color');
  const faint = getTokenValue('$textFaint', 'color');
  const archived = archivedLabel(mother.status);
  // Subtítulo: categoría de la madre + (si archivada) el estado. Ej. "Vaca multípara · Vendida".
  const subtitleParts = [mother.categoryName, archived].filter(Boolean) as string[];
  const subtitle = subtitleParts.length > 0 ? subtitleParts.join(' · ') : 'Madre';

  return (
    <Pressable onPress={onPress} {...buttonA11y(Platform.OS, { label: `Ver la ficha de la madre: ${mother.label}` })}>
      <XStack
        width="100%"
        alignItems="center"
        gap="$3"
        minHeight="$touchMin"
        borderRadius="$card"
        borderWidth={2}
        borderColor="$divider"
        backgroundColor="$white"
        paddingHorizontal="$4"
        paddingVertical="$3"
        pressStyle={{ backgroundColor: '$surface' }}
      >
        <View
          width="$icon"
          height="$icon"
          borderRadius="$pill"
          backgroundColor="$greenLight"
          alignItems="center"
          justifyContent="center"
          flexShrink={0}
        >
          <Milk size={22} color={primary} strokeWidth={2.5} />
        </View>
        <YStack flex={1} minWidth={0} gap="$1">
          <Text fontFamily="$body" fontSize="$3" fontWeight="500" color="$textMuted">
            Madre
          </Text>
          <Text fontFamily="$body" fontSize="$5" fontWeight="600" color="$textPrimary" numberOfLines={1}>
            {mother.label}
          </Text>
          <Text fontFamily="$body" fontSize="$3" fontWeight="400" color="$textMuted" numberOfLines={1}>
            {subtitle}
          </Text>
        </YStack>
        <ChevronRight size={22} color={faint} strokeWidth={2} />
      </XStack>
    </Pressable>
  );
}

// ─── Sección de detalle (card bone con header de ícono $primary) ──────────────────────

/**
 * Card bone con un header de sección: ícono lucide chico en $primary dentro de un halo $greenLight
 * + título $6/600. Da calidez y jerarquía (no flat white). Reusable (base de la capa de identidad
 * que C3 va a reusar para la ficha completa).
 */
function DetailSection({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children: React.ReactNode;
}) {
  const primary = getTokenValue('$primary', 'color');
  return (
    <Card gap="$3">
      <XStack alignItems="center" gap="$2">
        <View
          width={28}
          height={28}
          borderRadius="$pill"
          backgroundColor="$greenLight"
          alignItems="center"
          justifyContent="center"
        >
          <Icon size={16} color={primary} strokeWidth={2.5} />
        </View>
        <Text fontFamily="$body" fontSize="$6" lineHeight="$6" fontWeight="600" color="$textPrimary">
          {title}
        </Text>
      </XStack>
      <YStack gap="$3">{children}</YStack>
    </Card>
  );
}

// ─── Fila de atributo (label arriba muted, valor abajo, truncado) ─────────────────────

function AttributeRow({ label, value }: { label: string; value: string }) {
  return (
    <YStack gap="$1">
      <Text fontFamily="$body" fontSize="$3" fontWeight="500" color="$textMuted">
        {label}
      </Text>
      <Text
        fontFamily="$body"
        fontSize="$5"
        fontWeight="600"
        color="$textPrimary"
        numberOfLines={1}
        minWidth={0}
      >
        {value}
      </Text>
    </YStack>
  );
}

// ─── Fila de RAZA editable (spec 08, T18) ─────────────────────────────────────────────
//
// Muestra la raza actual del animal + una afordancia para editarla (abre el BreedPickerSheet). Tres estados:
//   - CON raza + editable → valor (nombre) + link discreto "Cambiar" (toca → abre el picker).
//   - SIN raza + editable → CTA cálido "Completá la raza para SIGSA" ($primary, Fitts ≥$touchMin) — cierra el
//     loop "A completar → completar" del export (el animal sin breed_id no es exportable, R8.2).
//   - read-only (animal archivado) → solo el valor o "—" (un animal de baja no se re-clasifica).
//
// La raza se persiste como `breed` (NOMBRE del catálogo); el trigger 0113 deriva breed_id al subir. a11y por
// helper (buttonA11y, NUNCA accessibilityLabel crudo en Pressable RN-web). Cero hardcode (tokens + getTokenValue).
function BreedRow({
  breed,
  editable,
  onEdit,
}: {
  breed: string | null;
  editable: boolean;
  onEdit: () => void;
}) {
  const primary = getTokenValue('$primary', 'color');
  const hasBreed = breed != null && breed.trim().length > 0;

  // Sin raza + editable → CTA "Completar raza para SIGSA" (cierra el loop del export).
  if (!hasBreed && editable) {
    return (
      <YStack gap="$1">
        <Text fontFamily="$body" fontSize="$3" fontWeight="500" color="$textMuted">
          Raza
        </Text>
        <XStack
          testID="ficha-breed-completar"
          minHeight="$touchMin"
          alignItems="center"
          gap="$2"
          alignSelf="flex-start"
          pressStyle={{ opacity: 0.6 }}
          onPress={onEdit}
          {...buttonA11y(Platform.OS, { label: 'Completá la raza para SIGSA' })}
        >
          <Plus size={18} color={primary} strokeWidth={2.5} />
          <Text fontFamily="$body" fontSize="$5" lineHeight="$5" fontWeight="700" color="$primary" numberOfLines={1}>
            Completá la raza para SIGSA
          </Text>
        </XStack>
      </YStack>
    );
  }

  // Con raza (o read-only sin raza): label + valor; si editable, link "Cambiar" a la derecha.
  return (
    <YStack gap="$1">
      <XStack alignItems="center" justifyContent="space-between" gap="$2">
        <Text fontFamily="$body" fontSize="$3" fontWeight="500" color="$textMuted">
          Raza
        </Text>
        {editable ? (
          <Text
            testID="ficha-breed-cambiar"
            fontFamily="$body"
            fontSize="$3"
            fontWeight="700"
            color="$primary"
            pressStyle={{ opacity: 0.6 }}
            onPress={onEdit}
            {...buttonA11y(Platform.OS, { label: 'Cambiar la raza' })}
          >
            Cambiar
          </Text>
        ) : null}
      </XStack>
      <Text
        fontFamily="$body"
        fontSize="$5"
        fontWeight="600"
        color="$textPrimary"
        numberOfLines={1}
        minWidth={0}
      >
        {hasBreed ? (breed as string) : '—'}
      </Text>
    </YStack>
  );
}

// ─── Control de Lote (C4 / ADR-020): asignar / cambiar / quitar desde la ficha ────────
//
// Lote = agrupación de manejo libre (ADR-020), ortogonal a rodeo/categoría. Desde la ficha el
// operario (cualquier rol) asigna / cambia / QUITA (→ "Sin lote", management_group_id NULL) el lote
// del animal. La RLS es la barrera real (la asignación es un UPDATE de animal_profiles permitido a
// cualquier rol operativo); el quick-create de un lote nuevo es OWNER-only (lo gatea `canQuickCreate`).
//
// Estados:
//   - read-only (editable=false: animal archivado) → solo muestra el lote actual.
//   - sin lotes en el campo + NO puede crear → copy "pedíle al dueño que cree uno".
//   - selector inline (acordeón): "Sin lote" + cada lote activo + (owner) "Crear lote nuevo".
//
// Cero hardcode (tokens + getTokenValue para íconos). a11y por helper (NUNCA accessibilityLabel crudo
// en Pressable de RN-web). El cambio refresca la ficha (onAssign llama a load()) → el lote mostrado
// se actualiza al instante.
function LoteControl({
  currentGroupId,
  currentGroupName,
  groups,
  editable,
  canQuickCreate,
  onAssign,
  onQuickCreate,
}: {
  currentGroupId: string | null;
  currentGroupName: string | null;
  groups: ManagementGroup[];
  editable: boolean;
  canQuickCreate: boolean;
  onAssign: (groupId: string | null) => Promise<{ ok: boolean; error?: string }>;
  onQuickCreate: (name: string) => Promise<{ ok: boolean; group?: ManagementGroup; error?: string }>;
}) {
  const primary = getTokenValue('$primary', 'color');
  const muted = getTokenValue('$textMuted', 'color');
  const checkSize = getTokenValue('$navIcon', 'size'); // 24

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Sub-modo "crear lote nuevo" (owner) dentro del selector.
  const [creatingNew, setCreatingNew] = useState(false);
  const [newName, setNewName] = useState('');

  const currentLabel = currentGroupName ?? 'Sin lote';
  // El a11y label del trigger DEBE coincidir con su texto visible: en RN-web el aria-label OVERRIDE-a
  // el texto como nombre accesible → si difirieran, getByRole(name) del e2e (y el lector de pantalla)
  // verían un nombre distinto al que se lee en la UI.
  const triggerLabel = currentGroupId ? 'Cambiar lote' : 'Asignar a un lote';

  const onPick = useCallback(
    async (groupId: string | null) => {
      if (busy || groupId === currentGroupId) {
        setOpen(false);
        return;
      }
      setBusy(true);
      setError(null);
      const r = await onAssign(groupId);
      setBusy(false);
      if (!r.ok) {
        setError(r.error ?? 'No se pudo cambiar el lote.');
        return;
      }
      setOpen(false);
    },
    [busy, currentGroupId, onAssign],
  );

  const onSubmitNew = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const r = await onQuickCreate(newName);
    if (!r.ok || !r.group) {
      setBusy(false);
      setError(r.error ?? 'No se pudo crear el lote.');
      return;
    }
    // Creado: asignamos el animal al lote nuevo de una.
    const assigned = await onAssign(r.group.id);
    setBusy(false);
    if (!assigned.ok) {
      setError(assigned.error ?? 'El lote se creó, pero no pudimos asignarlo. Probá elegirlo de la lista.');
      return;
    }
    setNewName('');
    setCreatingNew(false);
    setOpen(false);
  }, [busy, newName, onQuickCreate, onAssign]);

  return (
    <DetailSection icon={Layers} title="Lote">
      <YStack gap="$3">
        {/* Lote actual (siempre visible). */}
        <YStack gap="$1">
          <Text fontFamily="$body" fontSize="$3" fontWeight="500" color="$textMuted">
            Lote actual
          </Text>
          <Text fontFamily="$body" fontSize="$5" fontWeight="600" color="$textPrimary" numberOfLines={1} minWidth={0}>
            {currentLabel}
          </Text>
        </YStack>

        {error ? <FormError message={error} /> : null}

        {editable ? (
          <>
            {/* Trigger del selector (cambiar lote). */}
            <Pressable
              onPress={() => {
                setOpen((v) => !v);
                setCreatingNew(false);
                setError(null);
              }}
              {...buttonA11y(Platform.OS, { label: triggerLabel, selected: open })}
            >
              <XStack
                width="100%"
                minHeight="$touchMin"
                alignItems="center"
                justifyContent="center"
                gap="$2"
                borderRadius="$pill"
                backgroundColor="transparent"
                borderWidth={2}
                borderColor="$primary"
                paddingHorizontal="$5"
                pressStyle={{ backgroundColor: '$surface' }}
              >
                <Layers size={18} color={primary} strokeWidth={2.5} />
                <Text fontFamily="$body" fontSize="$5" fontWeight="600" color="$primary">
                  {triggerLabel}
                </Text>
              </XStack>
            </Pressable>

            {open ? (
              creatingNew ? (
                <Card gap="$3">
                  <Text fontFamily="$body" fontSize="$5" fontWeight="600" color="$textPrimary">
                    Nuevo lote
                  </Text>
                  <FormField
                    label="Nombre del lote"
                    value={newName}
                    onChangeText={(t) => {
                      setNewName(t);
                      if (error) setError(null);
                    }}
                    placeholder="Ej. Otoño 2026"
                    autoCapitalize="sentences"
                  />
                  <XStack gap="$2">
                    <YStack flex={1}>
                      <Button
                        variant="secondary"
                        fullWidth
                        onPress={() => {
                          setCreatingNew(false);
                          setNewName('');
                          setError(null);
                        }}
                      >
                        Cancelar
                      </Button>
                    </YStack>
                    <YStack flex={1}>
                      <Button variant="primary" fullWidth disabled={busy} onPress={() => void onSubmitNew()}>
                        {busy ? 'Creando…' : 'Crear y asignar'}
                      </Button>
                    </YStack>
                  </XStack>
                </Card>
              ) : (
                <Card gap="$1" paddingVertical="$2">
                  {/* "Sin lote" (quitar). */}
                  <LoteOption
                    label="Sin lote"
                    selected={currentGroupId === null}
                    primary={primary}
                    checkSize={checkSize}
                    onPress={() => void onPick(null)}
                  />
                  {groups.map((g) => (
                    <LoteOption
                      key={g.id}
                      label={g.name}
                      selected={g.id === currentGroupId}
                      primary={primary}
                      checkSize={checkSize}
                      onPress={() => void onPick(g.id)}
                    />
                  ))}
                  {/* Crear lote nuevo (owner-only): CTA al pie de la lista, centrada y separada de las
                      opciones por un divisor (mismo patrón que "Renombrar"/"Eliminar lote" en lotes.tsx). */}
                  {canQuickCreate ? (
                    <>
                      <View height={1} backgroundColor="$divider" />
                      <Pressable
                        onPress={() => {
                          setCreatingNew(true);
                          setError(null);
                        }}
                        {...buttonA11y(Platform.OS, { label: 'Crear lote nuevo' })}
                      >
                        <XStack
                          alignItems="center"
                          gap="$2"
                          minHeight="$chipMin"
                          paddingHorizontal="$2"
                          pressStyle={{ opacity: 0.6 }}
                        >
                          <Plus size={20} color={primary} strokeWidth={2.5} />
                          <Text flex={1} textAlign="center" minWidth={0} fontFamily="$body" fontSize="$4" fontWeight="600" color="$primary">
                            Crear lote nuevo
                          </Text>
                          <View width={20} flexShrink={0} />
                        </XStack>
                      </Pressable>
                    </>
                  ) : groups.length === 0 ? (
                    <InfoNote>Todavía no hay lotes en este campo. Pedíle al dueño que cree uno.</InfoNote>
                  ) : null}
                </Card>
              )
            ) : null}
          </>
        ) : null}
      </YStack>
    </DetailSection>
  );
}

/** Una fila de opción del selector de lote. Target ≥ $chipMin; la elegida lleva un check $primary. */
function LoteOption({
  label,
  selected,
  primary,
  checkSize,
  onPress,
}: {
  label: string;
  selected: boolean;
  primary: string;
  checkSize: number;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} {...buttonA11y(Platform.OS, { label: `Lote ${label}`, selected })}>
      <XStack alignItems="center" gap="$2" minHeight="$chipMin" paddingHorizontal="$2" pressStyle={{ opacity: 0.6 }}>
        <Text
          flex={1}
          minWidth={0}
          numberOfLines={1}
          fontFamily="$body"
          fontSize="$4"
          fontWeight={selected ? '600' : '500'}
          color={selected ? '$primary' : '$textPrimary'}
        >
          {label}
        </Text>
        <View width={checkSize} alignItems="center" justifyContent="center" flexShrink={0}>
          {selected ? <Check size={20} color={primary} strokeWidth={2.5} /> : null}
        </View>
      </XStack>
    </Pressable>
  );
}

// ─── Sección "Estado actual" (FIX C): valor vigente de cada medición tipada ───────────
//
// El peso/condición actuales son DATOS del animal (el del evento más reciente de cada tipo), no solo
// historia. Esta sección los muestra como atributos; el Historial de abajo es la auditoría completa.
// Se muestra SIEMPRE (enseña qué se trackea): si no hay evento de un tipo → "Sin registrar" (muted,
// consistente con los "—" del resto de la ficha).
//
// C3.2a: la sección escala al ESTADO REPRODUCTIVO (preñez) — fila "Estado reproductivo" SOLO para
// hembras (la preñez no aplica a machos). `deriveCurrentState` es el punto de extensión (computa
// `pregnancy` del último evento determinante: tacto/birth/abortion). La transición de categoría
// (vaquillona → vaquillona_prenada) la hace el server y la refleja el CategoryBadge del hero; esta
// fila muestra el estado de preñez crudo del último tacto/parto/aborto. La observación libre NO va
// acá (solo timeline: no tiene "valor actual").
// Etiqueta es-AR de la aptitud para la fila de la ficha (RAR.4.1): null (sin veredicto) → "Sin evaluar".
function aptitudeRowLabel(aptitude: HeiferFitness | null): string {
  if (aptitude === 'apta') return 'Apta';
  if (aptitude === 'diferida') return 'Diferida';
  if (aptitude === 'no_apta') return 'No apta';
  return 'Sin evaluar';
}

function CurrentStateSection({
  timeline,
  sex,
  categoryCode,
  reproStatus,
  reproAptitude,
}: {
  timeline: TimelineItem[] | null;
  sex: 'male' | 'female';
  // delta aptitud (RAR.4): categoría VIGENTE + estado/aptitud derivados (de fetchAnimalDetail, display-only).
  categoryCode: string;
  reproStatus: ReproStatus;
  reproAptitude: HeiferFitness | null;
}) {
  // `now` para el timestamp relativo de cada valor (un Date por render, determinístico acá).
  const now = new Date();
  const state: CurrentState = deriveCurrentState(timeline);

  const weightValue = state.weight
    ? `${formatKg(state.weight.kg)} kg · ${formatEventDate(state.weight.date, now, { dateOnly: true })}`
    : null;
  const scoreValue = state.conditionScore
    ? `${formatConditionScore(state.conditionScore.score)} / 5 · ${formatEventDate(state.conditionScore.date, now, { dateOnly: true })}`
    : null;

  // Estado reproductivo (solo hembras): preñez del último evento determinante (humanizePregnancyState + fecha);
  // si no hay preñez pero la hembra está servida/probada sin tacto → "Servida sin tacto" (RAR.4.2); si no →
  // null → "Sin registrar". La preñez sigue saliendo del timeline (conserva "(cabeza) · fecha", RAR.4.4).
  const pregnancyText = humanizePregnancyState(state.pregnancy);
  const reproValue =
    pregnancyText && state.pregnancy
      ? `${pregnancyText} · ${formatEventDate(state.pregnancy.date, now, { dateOnly: true })}`
      : reproStatus.kind === 'served_untested'
        ? reproStatusLabel(reproStatus)
        : null;

  // Aptitud reproductiva (RAR.4.1): SOLO hembra y SOLO en la fase de vaquillona (con o sin veredicto). Las
  // adultas probadas no tienen eje de aptitud → se omite la fila (su estado vive en "Estado reproductivo").
  const showAptitude = sex === 'female' && categoryCode === 'vaquillona';

  return (
    <DetailSection icon={Gauge} title="Estado actual">
      <CurrentStateRow label="Peso actual" value={weightValue} />
      <CurrentStateRow label="Condición corporal" value={scoreValue} />
      {showAptitude ? (
        <CurrentStateRow label="Aptitud reproductiva" value={aptitudeRowLabel(reproAptitude)} />
      ) : null}
      {sex === 'female' ? (
        <CurrentStateRow label="Estado reproductivo" value={reproValue} />
      ) : null}
    </DetailSection>
  );
}

/**
 * Fila de "Estado actual": label muted arriba, valor abajo. Si no hay valor → "Sin registrar" muted
 * (mismo lenguaje que los "—" del resto de la ficha). El valor presente va con su timestamp embebido
 * (ej. "320 kg · Hoy"). Reusa el patrón de AttributeRow para coherencia visual.
 */
function CurrentStateRow({ label, value }: { label: string; value: string | null }) {
  return (
    <YStack gap="$1">
      <Text fontFamily="$body" fontSize="$3" fontWeight="500" color="$textMuted">
        {label}
      </Text>
      {value ? (
        <Text
          fontFamily="$body"
          fontSize="$5"
          fontWeight="600"
          color="$textPrimary"
          numberOfLines={1}
          minWidth={0}
        >
          {value}
        </Text>
      ) : (
        <Text fontFamily="$body" fontSize="$5" fontWeight="500" color="$textMuted">
          Sin registrar
        </Text>
      )}
    </YStack>
  );
}

/** Formatea kg sin decimales innecesarios ("320.00" → "320", "320.50" → "320,5"). Espeja el de
 * TimelineEvent (el riel y el estado actual muestran el peso igual). */
function formatKg(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '').replace('.', ',');
}

// ─── Tarjeta de tendencia de CIRCUNFERENCIA ESCROTAL (spec 03 M6, R14.14) ─────────────
//
// Card de la ficha (solo machos enteros, gateada por el caller con isBullEntire). Muestra la SERIE de
// mediciones (más reciente primero, igual que buildScrotalHistoryQuery): cada fila = la CE en cm (es-AR,
// grande) + "edad · fecha" (muted). La edad va en AÑOS tras los 24 meses (FIX #11). Si la serie es larga, la
// lista scrollea con un FADE de affordance abajo (scrollFades) para que se note que hay más.
//
// (FIX #11, 2026-06-29 — pedido de Raf): se REMOVIÓ la mini-tendencia (sparkline de barras verde). La card
// queda solo con la lista de todas las mediciones (sin hueco muerto); la evolución se lee en la lista y el riel.
//
// Cero hardcode (ADR-023 §4): tokens + getTokenValue para los íconos lucide. a11y por helper. El título de la
// card sin recorte (lineHeight matcheando el fontSize, igual que DetailSection — reference_descender_clipping).
// es-AR (coma decimal "36,5 cm"). El empty (macho entero sin mediciones) es un caso de negocio legítimo (la
// 1ra medición), no falta de sync → empty cálido $greenLight, NO un error.

/** Alto de la franja de fade del affordance de scroll (geometría libre, decorativa). */
const FADE_H = 20;

/** Cuántas filas de la serie caben antes de que la lista pase a scrollear (con fade). Sobre esto, scroll. */
const SCROTAL_VISIBLE_ROWS = 4;

function ScrotalTrendSection({ history }: { history: ScrotalMeasurementRow[] }) {
  // `now` por render para los timestamps relativos de cada medición (determinístico dentro del render).
  const now = new Date();

  return (
    <DetailSection icon={Ruler} title="Circunferencia escrotal">
      {history.length === 0 ? (
        // Macho entero SIN mediciones: la 1ra medición es un caso legítimo (no falta de sync) → empty cálido.
        <YStack width="100%" backgroundColor="$greenLight" borderRadius="$card" padding="$4" gap="$2">
          <Text fontFamily="$body" fontSize="$5" lineHeight="$5" fontWeight="600" color="$primary">
            Todavía no hay mediciones
          </Text>
          <Text fontFamily="$body" fontSize="$3" fontWeight="400" color="$primary">
            Medí la circunferencia escrotal de este toro en una jornada de manga y vas a ver su evolución acá.
          </Text>
        </YStack>
      ) : (
        // FIX #11 (2026-06-29): sin sparkline — solo la lista de todas las mediciones (sin hueco muerto).
        <ScrotalSeriesList history={history} now={now} />
      )}
    </DetailSection>
  );
}

/**
 * Lista de la serie de mediciones (más reciente primero). Cada fila: la CE en cm (es-AR, grande $primary) +
 * "edad · fecha" (muted). Si hay más de SCROTAL_VISIBLE_ROWS, la lista scrollea con un FADE de affordance
 * abajo (scrollFades) — que se note que hay más. La geometría del scroll se mide con onLayout/onContentSize/
 * onScroll. Hasta el umbral, la lista crece natural (sin cap, sin fade).
 */
function ScrotalSeriesList({ history, now }: { history: ScrotalMeasurementRow[]; now: Date }) {
  const [fades, setFades] = useState<ScrollFades>({ top: false, bottom: false });
  const geomRef = useRef({ scrollY: 0, viewportHeight: 0, contentHeight: 0 });
  const recompute = useCallback(() => {
    setFades(scrollFades(geomRef.current));
  }, []);

  const overflows = history.length > SCROTAL_VISIBLE_ROWS;
  // Alto de una fila (~$5 valor + $3 sub + gaps + el divisor) ≈ 64px. Cap a SCROTAL_VISIBLE_ROWS filas con un
  // PEEK (medio ítem extra asomando) para que se vea que la lista sigue, además del fade.
  const ROW_H = 64;
  const maxHeight = overflows ? Math.round(ROW_H * (SCROTAL_VISIBLE_ROWS + 0.5)) : undefined;

  const rows = history.map((m, i) => (
    <ScrotalSeriesRow key={m.id} m={m} now={now} isLast={i === history.length - 1} />
  ));

  if (!overflows) {
    return <YStack gap="$0">{rows}</YStack>;
  }

  return (
    <View width="100%" position="relative">
      <ScrollView
        maxHeight={maxHeight}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={(e) => {
          geomRef.current.scrollY = e.nativeEvent.contentOffset.y;
          geomRef.current.viewportHeight = e.nativeEvent.layoutMeasurement.height;
          geomRef.current.contentHeight = e.nativeEvent.contentSize.height;
          recompute();
        }}
        onLayout={(e) => {
          geomRef.current.viewportHeight = e.nativeEvent.layout.height;
          recompute();
        }}
        onContentSizeChange={(_w, h) => {
          geomRef.current.contentHeight = h;
          recompute();
        }}
      >
        <YStack gap="$0">{rows}</YStack>
      </ScrollView>
      {/* Fade de affordance: una franja $surface→transparente en el borde con contenido oculto. Decorativa
          (pointerEvents none) → no roba el toque del scroll. Arriba se muestra al haber scrolleado. */}
      {fades.top ? <ScrollFade edge="top" /> : null}
      {fades.bottom ? <ScrollFade edge="bottom" /> : null}
    </View>
  );
}

/** Franja de fade (decorativa) en el borde de la lista scrolleable. Token $surface (el fondo de la card). */
function ScrollFade({ edge }: { edge: 'top' | 'bottom' }) {
  return (
    <View
      position="absolute"
      left="$0"
      right="$0"
      height={FADE_H}
      pointerEvents="none"
      backgroundColor="$surface"
      opacity={0.85}
      {...(edge === 'top' ? { top: '$0' } : { bottom: '$0' })}
    />
  );
}

/**
 * Una fila de la serie de CE: la CE en cm (es-AR, $primary 600, grande) + "edad · fecha" (muted). El divisor
 * inferior separa de la siguiente (salvo la última). a11y por helper (la fila es display).
 */
function ScrotalSeriesRow({
  m,
  now,
  isLast,
}: {
  m: ScrotalMeasurementRow;
  now: Date;
  isLast: boolean;
}) {
  // "edad · fecha": la edad snapshot (R14.8, nullable → omitida) + la fecha de medición (date-only, es-AR).
  // Edad en AÑOS tras los 24 meses (FIX #11): < 24m → "18 meses"; ≥ 24m → "2 años 3 meses".
  const age = formatAgeYearsAR(m.ageMonths);
  const date = formatEventDate(m.measuredAt, now, { dateOnly: true });
  const subParts = [age, date].filter(Boolean) as string[];
  const sub = subParts.join(' · ');
  return (
    <YStack
      gap="$1"
      paddingVertical="$2"
      borderBottomWidth={isLast ? 0 : 1}
      borderColor="$divider"
      {...labelA11y(Platform.OS, `${formatCmWithUnitAR(m.circumferenceCm)}${sub ? `, ${sub}` : ''}`)}
    >
      <Text fontFamily="$body" fontSize="$6" lineHeight="$6" fontWeight="700" color="$primary" numberOfLines={1}>
        {formatCmWithUnitAR(m.circumferenceCm)}
      </Text>
      {sub ? (
        // lineHeight matcheando el fontSize: Tamagui NO aplica el lineHeight del token con `fontSize` suelto
        // → sin esto, numberOfLines={1} recorta los descendentes de las abreviaturas de mes (jun/jul/ago).
        <Text fontFamily="$body" fontSize="$3" lineHeight="$3" fontWeight="500" color="$textMuted" numberOfLines={1}>
          {sub}
        </Text>
      ) : null}
    </YStack>
  );
}

// ─── Sección Historial (C3.1): riel de eventos + CTA "Agregar evento" ─────────────────

/**
 * Historial de eventos del animal (R10/R14). Header "Historial" + botón primario "Agregar evento"
 * (zona pulgar, ≥$touchMin). Debajo, el riel de TimelineEvent. Estados:
 *   - error blando → FormError + reintentar (la cabecera de la ficha ya se mostró).
 *   - sparse/empty → si el único evento es el `initial` de categoría (o no hay ninguno), un empty
 *     cálido $greenLight invita a cargar el primer evento (el timeline NUNCA está 100% vacío:
 *     siempre hay al menos el `initial`, pero un animal recién creado "se siente" vacío).
 *   - con eventos → la lista, el más reciente arriba.
 */
function HistorySection({
  timeline,
  error,
  onAddEvent,
  onRetry,
  archived,
  canDeleteEvent,
  onDeleteEvent,
}: {
  timeline: TimelineItem[] | null;
  error: string | null;
  onAddEvent: () => void;
  onRetry: () => void;
  /** Modo archivada (status ≠ active): oculta el CTA "Agregar evento" (C3.3). */
  archived: boolean;
  /** ¿Este evento es corregible (borrable) desde la ficha? (spec 10 T-UI.8 / R4.5 — owner|autor). */
  canDeleteEvent: (item: TimelineItem) => boolean;
  /** Soft-deletea el evento (vacunación/destete) y recarga la ficha. */
  onDeleteEvent: (item: TimelineItem) => Promise<{ ok: boolean; error?: string }>;
}) {
  const primary = getTokenValue('$primary', 'color');
  // `now` se calcula UNA vez por render de la sección (no por fila) — determinístico dentro del render.
  const now = new Date();

  // "Sparse": no hay eventos, o el único que hay es el `initial` (el alta). El operario aún no
  // cargó nada propio → mostramos un empty cálido en vez de un riel de un solo nodo solitario.
  const isSparse =
    timeline != null &&
    (timeline.length === 0 ||
      (timeline.length === 1 &&
        timeline[0].kind === 'category_change' &&
        timeline[0].reason === 'initial'));

  return (
    <YStack width="100%" gap="$3">
      <XStack width="100%" alignItems="center" gap="$2">
        <View
          width={28}
          height={28}
          borderRadius="$pill"
          backgroundColor="$greenLight"
          alignItems="center"
          justifyContent="center"
        >
          <Clock size={16} color={primary} strokeWidth={2.5} />
        </View>
        <Text flex={1} minWidth={0} fontFamily="$body" fontSize="$6" lineHeight="$6" fontWeight="600" color="$textPrimary">
          Historial
        </Text>
      </XStack>

      {/* CTA "Agregar evento" — oculto en modo archivada (un animal de baja no recibe eventos en MVP). */}
      {archived ? null : <AddEventButton onPress={onAddEvent} />}

      {error ? (
        <YStack gap="$2">
          <FormError message={error} />
          <Button variant="secondary" fullWidth onPress={onRetry}>
            Reintentar
          </Button>
        </YStack>
      ) : timeline == null ? (
        <InfoNote>Cargando el historial…</InfoNote>
      ) : isSparse ? (
        <YStack width="100%" backgroundColor="$greenLight" borderRadius="$card" padding="$4" gap="$2">
          <Text fontFamily="$body" fontSize="$5" fontWeight="600" color="$primary">
            Todavía no hay eventos
          </Text>
          <Text fontFamily="$body" fontSize="$3" fontWeight="400" color="$primary">
            Cargá el primer evento de este animal —un pesaje, su condición corporal o una
            observación— y va a aparecer acá arriba.
          </Text>
        </YStack>
      ) : (
        <Card gap="$1">
          {timeline.map((item, i) => {
            const isLast = i === timeline.length - 1;
            // Vacunación/destete corregibles (owner|autor, R4.5) → wrapper con botón de borrar. El resto
            // del timeline queda display-only (el TimelineEvent canónico no cambia su contrato).
            return canDeleteEvent(item) ? (
              <DeletableTimelineEvent
                key={`${item.kind}-${item.eventId}`}
                item={item}
                isLast={isLast}
                now={now}
                onDelete={() => onDeleteEvent(item)}
              />
            ) : (
              <TimelineEvent
                key={`${item.kind}-${item.eventId}`}
                item={item}
                isLast={isLast}
                now={now}
              />
            );
          })}
        </Card>
      )}
    </YStack>
  );
}

// ─── Nodo del timeline CORREGIBLE (spec 10 T-UI.8 / R4.5): TimelineEvent + botón borrar ──────────
//
// Wrapper local de un TimelineEvent de vacunación/destete con un botón de BORRAR (corrección individual,
// reuso spec 02 R6.8.1). NO se toca el TimelineEvent canónico (display-only, components/) — el botón vive
// acá, en la ficha. Confirmación INLINE (la baja de un evento es reversible-en-la-práctica recargándolo,
// pero borra un dato → pedimos un toque de confirmación). El soft-delete es offline-safe; la RLS (owner|
// autor) es la barrera real al subir (un rechazo re-aparece el evento). Sobre un destete, el server
// recalcula la categoría (revierte la transición) — el espejo C6 lo refleja al recargar.
function DeletableTimelineEvent({
  item,
  isLast,
  now,
  onDelete,
}: {
  item: TimelineItem;
  isLast: boolean;
  now: Date;
  onDelete: () => Promise<{ ok: boolean; error?: string }>;
}) {
  const terracota = getTokenValue('$terracota', 'color');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onConfirm = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const r = await onDelete();
    // OK → la ficha recarga (el evento desaparece del timeline) → este nodo desmonta. No reseteamos busy
    // (evita parpadeo). Si falla, surfaceamos el error y rehabilitamos.
    if (!r.ok) {
      setBusy(false);
      setError(r.error ?? 'No se pudo borrar el evento.');
      return;
    }
  }, [busy, onDelete]);

  return (
    <YStack width="100%">
      <XStack width="100%" alignItems="flex-start">
        {/* El TimelineEvent canónico ocupa el ancho; el botón borrar va a la derecha, alineado al título. */}
        <View flex={1} minWidth={0}>
          <TimelineEvent item={item} isLast={isLast} now={now} />
        </View>
        {!confirming ? (
          <Pressable
            hitSlop={8}
            onPress={() => {
              setConfirming(true);
              setError(null);
            }}
            {...buttonA11y(Platform.OS, { label: 'Borrar evento' })}
          >
            <View padding="$2">
              <Trash2 size={18} color={terracota} strokeWidth={2} />
            </View>
          </Pressable>
        ) : null}
      </XStack>

      {/* Confirmación inline del borrado. Indentada para alinear con el contenido del nodo (después del
          gutter del riel) — usa el token de spacing $8, sin número crudo (ADR-023 §4). */}
      {confirming ? (
        <YStack gap="$2" paddingLeft="$8" paddingBottom="$3">
          {error ? <FormError message={error} /> : null}
          <Text fontFamily="$body" fontSize="$3" fontWeight="500" color="$textMuted">
            ¿Borrar este evento? Se puede volver a cargar si te equivocaste.
          </Text>
          <XStack gap="$2">
            <YStack flex={1}>
              <Button
                variant="secondary"
                fullWidth
                disabled={busy}
                onPress={() => {
                  setConfirming(false);
                  setError(null);
                }}
              >
                Cancelar
              </Button>
            </YStack>
            <YStack flex={1}>
              {/* "Sí, borrar" terracota (acción destructiva-suave; el Button canónico no tiene variante
                  destructiva → Pressable a mano con el lenguaje terracota, igual que ExitButton). */}
              <Pressable
                style={{ width: '100%' }}
                disabled={busy}
                onPress={() => void onConfirm()}
                {...buttonA11y(Platform.OS, { label: 'Sí, borrar' })}
              >
                <XStack
                  width="100%"
                  minHeight="$touchMin"
                  alignItems="center"
                  justifyContent="center"
                  gap="$2"
                  borderRadius="$pill"
                  backgroundColor="transparent"
                  borderWidth={2}
                  borderColor="$terracota"
                  paddingHorizontal="$5"
                  opacity={busy ? 0.6 : 1}
                  pressStyle={{ backgroundColor: '$surface' }}
                >
                  <Trash2 size={18} color={terracota} strokeWidth={2.5} />
                  <Text fontFamily="$body" fontSize="$5" fontWeight="600" color="$terracota">
                    {busy ? 'Borrando…' : 'Sí, borrar'}
                  </Text>
                </XStack>
              </Pressable>
            </YStack>
          </XStack>
        </YStack>
      ) : null}
    </YStack>
  );
}

// CTA primario "Agregar evento" con ícono lucide (el Button canónico solo acepta `children: string`,
// así que para el ícono + texto armamos el botón a mano replicando su forma con TOKENS — pill,
// $touchMin, $primary, texto blanco). a11y por helper (web=ARIA, native=accessibility*) — NUNCA
// accessibilityLabel crudo en el Pressable de RN-web (BUG del LogBox que tapa la pantalla, lección C1).
function AddEventButton({ onPress }: { onPress: () => void }) {
  const white = getTokenValue('$white', 'color');
  return (
    <Pressable
      style={{ width: '100%' }}
      onPress={onPress}
      {...buttonA11y(Platform.OS, { label: 'Agregar evento' })}
    >
      <XStack
        width="100%"
        minHeight="$touchMin"
        alignItems="center"
        justifyContent="center"
        gap="$2"
        borderRadius="$pill"
        backgroundColor="$primary"
        paddingHorizontal="$5"
        pressStyle={{ backgroundColor: '$primaryPress' }}
      >
        <Plus size={20} color={white} strokeWidth={2.5} />
        <Text fontFamily="$body" fontSize="$5" fontWeight="600" color="$white">
          Agregar evento
        </Text>
      </XStack>
    </Pressable>
  );
}

// Botón "Dar de baja" DISCRETO al fondo de la ficha (C3.3): outline terracota (NO un primario que
// compita con "Agregar evento"). La baja es destructiva e infrecuente → fricción a propósito (Fitts
// inverso: hay que scrollear hasta el fondo). Solo navega al sheet de baja; la confirmación + el
// write viven en /animal/baja. a11y por helper (NUNCA accessibilityLabel crudo en el Pressable de
// RN-web). Cero hardcode: tokens + getTokenValue para el ícono lucide.
function ExitButton({ onPress }: { onPress: () => void }) {
  const terracota = getTokenValue('$terracota', 'color');
  return (
    <Pressable
      style={{ width: '100%' }}
      onPress={onPress}
      {...buttonA11y(Platform.OS, { label: 'Dar de baja' })}
    >
      <XStack
        width="100%"
        minHeight="$touchMin"
        alignItems="center"
        justifyContent="center"
        gap="$2"
        borderRadius="$pill"
        backgroundColor="transparent"
        borderWidth={2}
        borderColor="$terracota"
        paddingHorizontal="$5"
        pressStyle={{ backgroundColor: '$surface' }}
      >
        <Archive size={18} color={terracota} strokeWidth={2.5} />
        <Text fontFamily="$body" fontSize="$5" fontWeight="600" color="$terracota">
          Dar de baja
        </Text>
      </XStack>
    </Pressable>
  );
}
