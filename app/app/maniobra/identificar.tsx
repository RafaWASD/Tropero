// app/maniobra/identificar.tsx — IDENTIFICACIÓN del animal en MODO MANIOBRAS (spec 03 M2.1-core).
//
// CABLEADO (plomería) del design spike scan-first ya vetado + aprobado por Raf. Mantiene la dirección
// visual (header de sesión slim / hero de escaneo dominante / entrada manual en la thumb zone) y la
// conecta a las piezas REALES — NO se rediseña, se cablea:
//   - SESIÓN (M1): se lee por `sessionId` (param del wizard) → rodeo + maniobras + contador.
//   - BLE (spec 04): `useBleStickListener` (manga-owned) recibe el EID YA validado+dedupeado del provider
//     (R3.3); el feedback visual+vibración lo da el provider al entrar la lectura (R3.4/R12.3).
//   - SUSPENSIÓN del listener global (R3.2): el FindOrCreateOverlay global se SUPRIME por ruta mientras
//     estamos en `maniobra/*` (mismo patrón que la asignación masiva) → un solo consumidor del bastón.
//   - LOOKUP (spec 02/09): `lookupByTag` (BLE) / `searchAnimals` (manual idv exacto + visual fuzzy, R3.5).
//   - find-or-create inline (R4.1): desconocido → /crear-animal con el identificador precargado +
//     el rodeo de la sesión (reusa el idiom del FindOrCreateOverlay; el alta encola por el camino offline).
//   - AUTO-AVANCE (decisión de Raf): match único y claro → flash de confirmación ~0,8s → carga rápida.
//   - disconnect/reconnect (R3.6/R3.7): el provider reconecta solo; el chip refleja el estado; el manual
//     queda SIEMPRE disponible (manual-first) → si se cae el bastón se sigue por la franja inferior sin
//     perder la sesión ni los datos.
//
// La decisión PURA (found / otro-establecimiento / desconocido / ambiguo + el gate de auto-avance) vive
// en `utils/maniobra-identify.ts` (unit-testeada). Acá solo hacemos la I/O + el render por estado.
//
// DIFERIDO a M2.1-EDGE (anotado, estado SEGURO — NO se auto-elige el equivocado):
//   - R4.2: manual con >1 candidato (caravana visual duplicada) → outcome `ambiguous` → aviso + TODO.
//   - R4.7: heurística de "rodeo de jornada mal elegido" (primeros ~3 de otro rodeo).
//   - R4.4: pasar el animal a este rodeo (UPDATE de animal_profiles.rodeo_id al rodeo de la SESIÓN) /
//           saltar — se ofrece cuando el animal found está en otro rodeo del MISMO campo y sistema.
//
// RECORTE DE DESCENDENTES (regla dura): todo heading ($6+) y Text con numberOfLines lleva lineHeight
// matching. Cero hardcode (ADR-023 §4): tokens; lo que cruza a lucide/RN se lee con getTokenValue. es-AR.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { getTokenValue, Text, View, XStack, YStack } from 'tamagui';
import { ArrowRightLeft, Bluetooth, Check, Keyboard, PlusCircle } from 'lucide-react-native';

import { StickIcon } from '@/theme/icons';
import { Button } from '@/components';
import { BleConnectionChip } from '@/components/BleConnectionChip';
import { useEstablishment, useRodeo } from '@/contexts';
import { useBleStickListener } from '@/services/ble/stick';
import { useBleProviderApi } from '@/services/ble/BleStickListenerProvider';
import { fetchAnimalDetail, lookupByTag, moveAnimalToRodeo, searchAnimals } from '@/services/animals';
import { closeSession, getSessionById, setSessionRodeo, type Session } from '@/services/sessions';
import { extractManeuvers } from '@/utils/maneuver-config';
import { maneuverLabel } from '@/utils/maneuver-wizard';
import { formatEidReadable } from '@/utils/eid-format';
import { SEARCH_TERM_MAX_LENGTH } from '@/utils/animal-identifier';
import {
  resolveBleIdentify,
  resolveManualIdentify,
  shouldAutoAdvance,
  resolvePrefilledCreateParams,
  type IdentifyOutcome,
} from '@/utils/maniobra-identify';
import {
  canChangeSessionRodeo,
  dismissStreak,
  emptyStreak,
  isOtherRodeo,
  pushSeenRodeo,
  shouldWarnMisconfiguredRodeo,
  type DisambiguationCandidate,
  type SeenRodeoStreak,
} from '@/utils/maniobra-edge';
import { resolveListenConnState } from '@/utils/maniobra-listen-state';
import { buttonA11y, labelA11y } from '@/utils/a11y';

import { SpikeSessionHeader } from './_components/SpikeSessionHeader';
import { CandidatePicker } from './_components/CandidatePicker';
import { OtherRodeoSheet } from './_components/OtherRodeoSheet';
import { RodeoMismatchBanner } from './_components/RodeoMismatchBanner';
import { ExitJornadaSheet } from './_components/ExitJornadaSheet';

// Tiempo del flash de confirmación antes de auto-avanzar a la carga rápida (decisión de Raf: ~0,8s).
const AUTO_ADVANCE_MS = 800;

type ManualState = 'collapsed' | 'expanded';

export default function ManiobraIdentificar() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ sessionId?: string }>();
  const sessionId = Array.isArray(params.sessionId) ? params.sessionId[0] : params.sessionId;

  const { state: est } = useEstablishment();
  const { state: rodeo } = useRodeo();
  const establishmentId = est.status === 'active' ? est.current.id : null;

  // La sesión de la jornada (R10.5 reanudación): rodeo + maniobras + contador. Lectura local (offline).
  const [session, setSession] = useState<Session | null>(null);
  useEffect(() => {
    if (!sessionId) return;
    let active = true;
    void getSessionById(sessionId).then((r) => {
      if (active && r.ok) setSession(r.value);
    });
    return () => {
      active = false;
    };
  }, [sessionId]);

  // El outcome de la última identificación (null = escuchando). El found dispara el auto-avance; el
  // resto (otro-establecimiento / desconocido / ambiguo) requiere una acción explícita del operario.
  const [outcome, setOutcome] = useState<IdentifyOutcome | null>(null);
  const [manual, setManual] = useState<ManualState>('collapsed');
  const [searching, setSearching] = useState(false);

  // ─── M2.1-edge ───
  // R4.4: el animal `found` está en OTRO rodeo del mismo campo que el de la sesión → aviso + pasar el
  // animal a este rodeo / saltar (no se carga directo: el tenant-check del DB lo rechazaría). null = no aplica.
  const [otherRodeo, setOtherRodeo] = useState<{
    profileId: string;
    animalLabel: string;
    /** rodeo de ORIGEN del animal (R4.4: mostrar de dónde se lo saca). */
    animalRodeoId: string;
    animalRodeoName: string;
    canChange: boolean;
  } | null>(null);
  // R4.7: tracker de la racha de "otro rodeo" (primeros ~3 consecutivos de otro rodeo → sugerir cambiar
  // la jornada). Reducer PURO; el banner se deriva con shouldWarnMisconfiguredRodeo.
  const [streak, setStreak] = useState<SeenRodeoStreak>(emptyStreak);

  // Guard de secuencia (live-rescan): un bastonazo/búsqueda nuevo descarta un lookup viejo en vuelo. Mismo
  // idiom que el FindOrCreateOverlay (RB3.5): escanear-escanear-escanear es el ritmo del bastón.
  const seqRef = useRef(0);
  // Guard de montaje: el auto-avance (router.replace) DESMONTA esta pantalla; un lookup en vuelo que
  // resuelva DESPUÉS no debe llamar setOutcome sobre un componente desmontado (warning + write inútil).
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Navega a la carga rápida con el animal identificado + la sesión. PUNTO DE INTEGRACIÓN M2.2: la carga
  // rápida REAL (frame + maniobras por orden) es M2.2; por ahora aterriza en la pantalla del spike M2.0
  // (`/maniobra/carga`) pasándole sessionId + profileId. M2.2 reemplaza el cuerpo de carga.tsx por el real
  // consumiendo estos params — NO cambia este call-site.
  const goToCarga = useCallback(
    (profileId: string) => {
      if (!sessionId) return;
      router.replace({ pathname: '/maniobra/carga', params: { sessionId, profileId } });
    },
    [router, sessionId],
  );

  // ─── Identificación por BLE (R3.3 / R4.3 / R4.5) ───
  // El EID llega YA validado+dedupeado del provider (parser-rs420 + dedup); el feedback visual+vibración
  // (R3.4/R12.3) lo dispara el provider al entrar la lectura. Acá solo resolvemos y enrutamos.
  const onTagRead = useCallback(
    (eid: string) => {
      if (!establishmentId) return;
      const ticket = ++seqRef.current;
      void (async () => {
        const res = await lookupByTag(eid, establishmentId);
        if (!mountedRef.current || seqRef.current !== ticket) return; // desmontado o descartado por uno más nuevo
        if (!res.ok) {
          // Lectura local fallida (raro): volvemos a escuchar (manual-first sigue disponible).
          setOutcome(null);
          return;
        }
        setOutcome(resolveBleIdentify(res.value, eid));
      })();
    },
    [establishmentId],
  );

  // Listener del bastón MANGA-OWNED (R3.2): el FindOrCreateOverlay global se suprime por ruta mientras
  // estamos en `maniobra/*` → ESTE es el único consumidor del bastón. enabled=true mantiene el transporte
  // escuchando (no lo apagamos: queremos las lecturas acá). isConnected refleja el estado físico (R3.6/R3.7).
  const { isConnected } = useBleStickListener({ enabled: true, onTagRead });

  // API del provider del bastón (R3.6/R3.7): `transport != null` = hay un transporte CONECTABLE (web-serial
  // antes de elegir puerto, o un bastón que se cayó); `transport == null` = no hay nada que conectar (native
  // manual-first hoy). Alimenta el HERO ADAPTATIVO del estado "escuchando" (3 sub-estados) + el tap de
  // conectar del ConnectHero. Reactivo: si el transporte se monta/desmonta, el hero reacciona sin flicker.
  const bleApi = useBleProviderApi();
  const conectable = bleApi?.transport != null;
  // Sub-estado del HERO ADAPTATIVO de "escuchando" (R3.6/R3.7), decisión PURA (testeada sin device):
  //   'connected'   → ScanHero (el bastón lee solo).
  //   'connectable' → ConnectHero (disco = botón, tap→connect; web antes de elegir puerto / bastón caído).
  //   'manual'      → MANUAL PROMOVIDO (sin disco, el input es la tarea primaria; native manual-first hoy).
  // Reactivo a isConnected/transport: si conecta/cae o aterriza un transporte buildable, el hero reacciona.
  const listenConn = resolveListenConnState({ isConnected, conectable });
  const manualPromoted = listenConn === 'manual';
  const connectStick = useCallback(() => {
    void bleApi?.transport?.connect().catch(() => undefined);
  }, [bleApi]);

  // ─── Identificación MANUAL (R3.5) — idv exacto + visual fuzzy ───
  const onManualSearch = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!establishmentId || trimmed.length === 0) return;
      const ticket = ++seqRef.current;
      setSearching(true);
      const res = await searchAnimals(establishmentId, trimmed);
      if (!mountedRef.current || seqRef.current !== ticket) return; // desmontado o descartado por uno más nuevo
      setSearching(false);
      if (!res.ok) {
        setOutcome({ kind: 'unknown', source: 'manual', identifier: trimmed });
        return;
      }
      // R4.2: pasamos los candidatos ENRIQUECIDOS (visual/idv/tag/rodeo/categoría) → si hay >1, el picker
      // los muestra con lo que los distingue; si hay 1 → found; si 0 → unknown (find-or-create).
      setOutcome(
        resolveManualIdentify(
          res.value.map((a) => ({
            profileId: a.profileId,
            visualIdAlt: a.visualIdAlt,
            idv: a.idv,
            tagElectronic: a.tagElectronic,
            rodeoName: a.rodeoName,
            categoryName: a.categoryName,
          })),
          trimmed,
        ),
      );
    },
    [establishmentId],
  );

  // Gate del auto-avance: solo se arma cuando R4.4 ya descartó "otro rodeo" (o no aplica). El profileId a
  // avanzar (null = todavía resolviendo el rodeo del found / no hay found).
  const [advanceProfileId, setAdvanceProfileId] = useState<string | null>(null);
  const setReadyToAdvance = useCallback((profileId: string) => {
    if (mountedRef.current) setAdvanceProfileId(profileId);
  }, []);

  // ─── Resolución del rodeo del animal `found` (R4.4 + R4.7) ───
  // Antes de auto-avanzar, resolvemos el rodeo REAL del animal (lectura local barata) y lo comparamos con
  // el de la sesión. Si difiere (otro rodeo del MISMO campo) → R4.4 (aviso + cambiar jornada / saltar): NO
  // se carga directo (el tenant-check del DB rechazaría el evento). Si coincide → camino feliz (auto-avance).
  // En ambos casos alimentamos el tracker R4.7 (la racha de "otro rodeo" se corta con un animal del rodeo
  // correcto). El systemId del rodeo del animal lo resolvemos contra rodeo.available (todos los rodeos del
  // campo activo) — sin tocar el backend; si el rodeo del animal no está en available (raro), conservador:
  // no ofrecemos el cambio (canChange=false → solo saltar).
  const availableRodeos = rodeo.status === 'active' ? rodeo.available : [];
  const sessionRodeoId = session?.rodeoId ?? null;
  // Guard contra resolver dos veces el mismo found (el efecto re-corre si cambia el outcome/sesión).
  const resolvedFoundRef = useRef<string | null>(null);
  useEffect(() => {
    if (!outcome || outcome.kind !== 'found' || !sessionRodeoId) return;
    // Esperamos a tener los rodeos del campo (RodeoContext): sin ellos no podemos resolver el systemId del
    // cambio de rodeo (R4.4). En la práctica ya están (el RootGate exige rodeo activo + el wizard eligió
    // uno), pero el guard evita decidir con info incompleta si el efecto corre antes del primer set.
    if (availableRodeos.length === 0) return;
    const profileId = outcome.animal.profileId;
    const ticket = `${seqRef.current}:${profileId}`;
    if (resolvedFoundRef.current === ticket) return; // ya resuelto este found
    resolvedFoundRef.current = ticket;
    void (async () => {
      const det = await fetchAnimalDetail(profileId);
      if (!mountedRef.current || resolvedFoundRef.current !== ticket) return;
      if (!det.ok) {
        // Lectura local fallida (raro): camino conservador → auto-avanza igual (el frame de carga re-lee
        // el animal y su rodeo real; si hubiera mismatch real, el DB lo rechazaría al confirmar).
        setReadyToAdvance(profileId);
        return;
      }
      const animal = det.value;
      const sessionRodeo = availableRodeos.find((r) => r.id === sessionRodeoId);
      const animalRodeo = availableRodeos.find((r) => r.id === animal.rodeoId);
      // Alimentamos el tracker R4.7 con el rodeo de ESTE animal (corta la racha si es el correcto).
      setStreak((prev) => pushSeenRodeo(prev, animal.rodeoId, animal.rodeoName, sessionRodeoId));

      // ¿Otro rodeo del mismo campo? Comparamos por rodeoId (ambos del mismo establecimiento acá).
      const animalRodeoInfo = { rodeoId: animal.rodeoId, rodeoName: animal.rodeoName, systemId: animalRodeo?.systemId ?? '' };
      const sessionRodeoInfo = { rodeoId: sessionRodeoId, systemId: sessionRodeo?.systemId ?? '' };
      if (isOtherRodeo(animalRodeoInfo, sessionRodeoInfo)) {
        // R4.4: NO cargamos directo. Solo ofrecemos cambiar la jornada si es del MISMO sistema (canChange);
        // si el rodeo del animal no se resolvió en available (systemId ''), canChange queda false (solo saltar).
        setOtherRodeo({
          profileId,
          animalLabel: animal.visualIdAlt ?? animal.idv ?? (animal.tagElectronic ? formatEidReadable(animal.tagElectronic) : 'Este animal'),
          animalRodeoId: animal.rodeoId,
          animalRodeoName: animal.rodeoName,
          canChange: animalRodeo != null && canChangeSessionRodeo(animalRodeoInfo, sessionRodeoInfo),
        });
        return;
      }
      // Mismo rodeo que la jornada → camino feliz: auto-avance.
      setReadyToAdvance(profileId);
    })();
    // availableRodeos es un array nuevo por render: lo serializamos en la dep por ids estables (los rodeos
    // del campo no cambian salvo switch de campo) para no re-disparar el efecto en cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outcome, sessionRodeoId, availableRodeos.map((r) => r.id).join(',')]);

  // ─── AUTO-AVANCE (decisión de Raf): found en el rodeo correcto → flash ~0,8s → carga rápida ───
  useEffect(() => {
    if (!advanceProfileId) return;
    const t = setTimeout(() => goToCarga(advanceProfileId), AUTO_ADVANCE_MS);
    return () => clearTimeout(t);
  }, [advanceProfileId, goToCarga]);

  // Volver a escuchar (saltar el animal de otro campo/rodeo / cerrar el ambiguo / cancelar el desconocido).
  // Colapsa también la entrada manual: tras resolver un caso, se vuelve al estado de escucha LIMPIO (el
  // bastón es el 95% del flujo) — el hero de escaneo vuelve a dominante en vez de quedar atenuado.
  const backToListening = useCallback(() => {
    seqRef.current += 1; // invalida cualquier lookup en vuelo
    resolvedFoundRef.current = null;
    setOutcome(null);
    setOtherRodeo(null);
    setAdvanceProfileId(null);
    setManual('collapsed');
  }, []);

  // ─── SALIDA de la jornada (R10.7 cerrar / R10.5-R10.6 salir reanudable) ───
  // El botón ‹ del header abre un SHEET de salida en vez de navegar atrás directo (decisión de Raf: no se
  // "va atrás", se CIERRA una jornada que siempre hay que cerrar en algún momento). El sheet ofrece:
  //   - Terminar jornada → closeSession (UPDATE offline, R10.7) → confirmación → navegar fuera del flujo.
  //   - Salir sin terminar → navegar fuera SIN cerrar (la sesión queda activa + reanudable, R10.5/R10.6).
  //   - Seguir en la jornada → cierra el sheet.
  const [exitOpen, setExitOpen] = useState(false);
  const openExitSheet = useCallback(() => setExitOpen(true), []);
  const closeExitSheet = useCallback(() => setExitOpen(false), []);

  // Navega FUERA del flujo de maniobra: el flujo es un STACK de modal (maniobra) + push (jornada) + replace
  // (identificar/carga) sobre los (tabs) → router.dismissAll() pop-ea TODO el flujo y vuelve a la superficie
  // principal de la app (los tabs), de donde se lanzó la maniobra. Es el idiom de routing del repo para
  // "salir del flujo modal completo" (mismo Stack que abre el FAB → maniobra modal). Si NO hay nada que
  // dismissear (llegada directa por deep-link / sin stack), reemplazamos a (tabs) — la superficie principal —
  // para no quedar atrapados en la pantalla (fail-safe).
  const exitManiobraFlow = useCallback(() => {
    if (router.canDismiss()) router.dismissAll();
    else router.replace('/(tabs)');
  }, [router]);

  // Terminar la jornada (R10.7): cierra la sesión OFFLINE. Devuelve true al OK (el sheet pasa al paso de
  // confirmación), false al fallo (el sheet NO navega: superficia el error y deja reintentar — fail-closed,
  // mismo espíritu que ManeuverErrorBanner). El sessionId SIEMPRE del param de la ruta (NUNCA hardcodeado).
  const onTerminarJornada = useCallback(async (): Promise<boolean> => {
    if (!sessionId) return false;
    const res = await closeSession(sessionId);
    return res.ok;
  }, [sessionId]);

  // find-or-create inline (R4.1): desconocido → alta con el identificador precargado + rodeo de la sesión.
  const onDarDeAlta = useCallback(() => {
    if (!outcome || outcome.kind !== 'unknown') return;
    const prefilled = resolvePrefilledCreateParams(outcome);
    // El alta vive en /crear-animal (spec 02/09): el identificador va precargado y NO editable (RB6.3); el
    // animal nuevo entra al rodeo default del campo (el rodeo de la sesión se muestra como contexto en el
    // hero "Animal nuevo"). M2.2 — encadenado alta→carga (cierra el TODO previo de R4.1): pasamos el
    // `sessionId` de la jornada al alta → al confirmar, crear-animal continúa DIRECTO a la carga de la
    // maniobra de ese animal nuevo (/maniobra/carga), sin re-identificarlo. Aplica a ambas fuentes (manual
    // y BLE: el `unknown` por bastón también continúa la maniobra). Guard: solo si hay sesión.
    router.push({
      pathname: '/crear-animal',
      params: sessionId ? { ...prefilled, sessionId } : prefilled,
    });
  }, [outcome, router, sessionId]);

  // ─── R4.2 — picker de candidatos: elegir UNO → cargar sobre él ───
  const onPickCandidate = useCallback(
    (candidate: DisambiguationCandidate) => {
      // El operario eligió el correcto → se reusa el mismo camino del `found`: lo seteamos como outcome
      // found → el efecto de resolución de rodeo (R4.4/R4.7) lo evalúa igual que cualquier found (si está
      // en otro rodeo, ofrece cambiar/saltar; si no, auto-avanza).
      // El identificador del flash de confirmación = la caravana REAL del animal ELEGIDO (visual > idv >
      // tag), NO el texto tecleado. Importa en el caso de match por substring (fix "otra caravana"): el
      // operario tecleó "42" y eligió el animal "1428" → el flash debe mostrar "1428", no "42".
      const typed = outcome?.kind === 'ambiguous' ? outcome.identifier : '';
      const id =
        candidate.visualIdAlt ??
        candidate.idv ??
        (candidate.tagElectronic ? formatEidReadable(candidate.tagElectronic) : null) ??
        typed;
      resolvedFoundRef.current = null;
      setOutcome({ kind: 'found', source: 'manual', animal: { profileId: candidate.profileId }, identifier: id });
    },
    [outcome],
  );

  // find-or-create desde el picker (R4.2 → R4.1): ninguno es el correcto → alta con el texto precargado.
  // Igual que onDarDeAlta: en contexto maniobra pasamos el sessionId → al crear, continúa la carga de la
  // maniobra del animal nuevo (no la ficha).
  const onCreateFromPicker = useCallback(() => {
    if (!outcome || outcome.kind !== 'ambiguous') return;
    const prefilled = resolvePrefilledCreateParams({ kind: 'unknown', source: 'manual', identifier: outcome.identifier });
    router.push({
      pathname: '/crear-animal',
      params: sessionId ? { ...prefilled, sessionId } : prefilled,
    });
  }, [outcome, router, sessionId]);

  // ─── R4.4 — PASAR EL ANIMAL a este rodeo (el de la JORNADA) → cargar sobre él ───
  // Honra el EARS R4.4: el animal está en otro rodeo del MISMO campo y sistema → lo MOVEMOS al rodeo de la
  // sesión (UPDATE de animal_profiles.rodeo_id), no cambiamos la jornada. Lo valida el trigger same-system
  // server-side (spec 02 R4.5.1, 0047) al subir. Tras moverlo, el animal YA está en el rodeo de la jornada
  // → el tenant-check de sesión lo acepta → cargar sobre él. Alimentamos el tracker R4.7 con el rodeo NUEVO
  // (= el de la sesión) para cortar la racha de "otro rodeo" (ya no es de otro rodeo).
  const onMoveAnimalToRodeo = useCallback(
    async (profileId: string) => {
      if (!sessionRodeoId) return;
      const res = await moveAnimalToRodeo(profileId, sessionRodeoId);
      if (!mountedRef.current) return;
      if (res.ok) {
        // El animal ahora está en el rodeo de la jornada → la racha de "otro rodeo" se corta (animalRodeoId
        // == sessionRodeoId → pushSeenRodeo devuelve emptyStreak, el name es irrelevante en esa rama).
        setStreak((prev) => pushSeenRodeo(prev, sessionRodeoId, '', sessionRodeoId));
      }
      setOtherRodeo(null);
      resolvedFoundRef.current = null;
      setReadyToAdvance(profileId);
    },
    [sessionRodeoId, setReadyToAdvance],
  );

  // ─── R4.7 — confirmar el aviso de rodeo mal elegido: cambiar la jornada al rodeo de la racha ───
  const onConfirmStreakRodeo = useCallback(async () => {
    if (!sessionId || !streak.streakRodeoId) return;
    const toRodeoId = streak.streakRodeoId;
    const res = await setSessionRodeo(sessionId, toRodeoId);
    if (!mountedRef.current) return;
    if (res.ok) {
      setSession((prev) => (prev ? { ...prev, rodeoId: toRodeoId } : prev));
    }
    // El aviso se cierra (la racha se resetea: el rodeo de la jornada ahora ES el de la racha).
    setStreak(emptyStreak());
    // Si había un aviso de "otro rodeo" abierto para un animal de ESE rodeo, ahora coincide → no aplica.
    setOtherRodeo(null);
  }, [sessionId, streak.streakRodeoId]);

  // Datos del header de sesión (reales). Sin sesión cargada aún, placeholders neutros (no rompe el render).
  const rodeoName =
    rodeo.status === 'active'
      ? (rodeo.available.find((r) => r.id === session?.rodeoId)?.name ?? rodeo.current.name)
      : '';
  const maniobrasLabel = session
    ? extractManeuvers(session.config).map(maneuverLabel).join(' · ')
    : '';
  const progreso = session ? `${session.animalCount} hoy` : '0 hoy';

  const bottomPad = Math.max(insets.bottom, getTokenValue('$navBottomMin', 'size'));

  // R4.7: el banner de "rodeo de jornada mal elegido" se muestra cuando la heurística dispara Y no hay un
  // sheet modal de R4.2/R4.4 arriba (no apilamos un aviso no-bloqueante bajo un modal). No-bloqueante.
  const showRodeoWarning =
    shouldWarnMisconfiguredRodeo(streak) && otherRodeo === null && outcome?.kind !== 'ambiguous';

  return (
    <YStack flex={1} backgroundColor="$bg" paddingTop={insets.top}>
      {/* ── 1) HEADER DE SESIÓN SLIM (estado de la jornada, Nielsen #1) + chip de conexión (R3.6/R3.7) ──
            El botón ‹ NO navega atrás directo: abre el ExitJornadaSheet (cierre de jornada, R10.7). ── */}
      <SpikeSessionHeader
        rodeo={rodeoName}
        maniobrasLabel={maniobrasLabel}
        progreso={progreso}
        onBack={openExitSheet}
        right={<BleConnectionChip />}
      />

      {/* ── R4.7) AVISO NO-BLOQUEANTE de rodeo de jornada mal elegido (banner anclado, dismissable). ── */}
      {showRodeoWarning && streak.streakRodeoName ? (
        <RodeoMismatchBanner
          rodeoName={streak.streakRodeoName}
          count={streak.streakCount}
          onChangeRodeo={() => void onConfirmStreakRodeo()}
          onDismiss={() => setStreak((prev) => dismissStreak(prev))}
        />
      ) : null}

      {/* ── 2) HERO (dominante) — cambia por outcome: escuchando / encontrado / desconocido / otro campo /
            ambiguo. El estado "escuchando" (outcome===null) es ADAPTATIVO por conexión (R3.6/R3.7):
              - CONECTADO → ScanHero ("Acercá el bastón"): el escaneo es la tarea, el manual es banda 2ª.
              - DESCONECTADO + CONECTABLE → ConnectHero: el disco es un BOTÓN que conecta (web/bastón caído).
              - DESCONECTADO + NO CONECTABLE → manual PROMOVIDO: sin disco, el input es la tarea primaria.
            Con el manual EXPANDIDO el hero de escaneo/conexión se ATENÚA (compact): el bastón sigue
            escuchando (R3.6) pero el input es la tarea activa → no compiten dos heroes de igual peso.
            Las ramas de outcome (found/unknown/other/ambiguous) quedan IGUAL. ── */}
      {outcome?.kind === 'found' ? (
        <FoundHero identifier={outcome.identifier} />
      ) : outcome?.kind === 'unknown' ? (
        <UnknownHero
          identifier={outcome.identifier}
          source={outcome.source}
          rodeoName={rodeoName}
          bottomPad={bottomPad}
          onDarDeAlta={onDarDeAlta}
          onCancel={backToListening}
        />
      ) : outcome?.kind === 'other_establishment' ? (
        <OtherFieldHero
          otherFieldName={outcome.otherFieldName}
          bottomPad={bottomPad}
          onSkip={backToListening}
        />
      ) : outcome?.kind === 'ambiguous' ? (
        // R4.2: la pantalla sigue "escuchando" de fondo; el picker de candidatos se monta como sheet encima.
        // El fondo refleja el sub-estado de conexión real (conectado=scan / conectable=connect / manual).
        listenConn === 'connected' ? (
          <ScanHero compact connected />
        ) : listenConn === 'connectable' ? (
          <ConnectHero compact onConnect={connectStick} />
        ) : (
          <ManualPromptHero compact />
        )
      ) : listenConn === 'connected' ? (
        // CONECTADO → ScanHero (sin cambios). Se atenúa con el manual expandido.
        <ScanHero compact={manual === 'expanded'} connected />
      ) : listenConn === 'connectable' ? (
        // DESCONECTADO pero CONECTABLE (web antes de elegir puerto / bastón caído) → ConnectHero: el disco
        // es un botón que dispara connect() con el gesto del tap (web-serial lo exige). Mismo tamaño/posición
        // que ScanHero (Jakob, sin salto de layout). Se atenúa con el manual expandido.
        <ConnectHero compact={manual === 'expanded'} onConnect={connectStick} />
      ) : (
        // DESCONECTADO y NO CONECTABLE (native manual-first hoy) → MANUAL PROMOVIDO: sin disco, el input es
        // la tarea primaria. Tono NEUTRO (es lo normal en ese dispositivo, no un error).
        <ManualPromptHero compact={manual === 'expanded'} />
      )}

      {/* ── 3) BANDA INFERIOR — entrada manual (thumb zone, R3.5). Solo en escucha (sin outcome): cuando
            hay un outcome, el hero trae su propia acción (Dar de alta / Saltar / Volver). Cuando NO hay
            transporte conectable (manual-first), el manual va PROMOVIDO = expandido por default (la entrada
            manual es la tarea primaria) y sin el "Cancelar→volver al escaneo" (no hay nada que escanear). ── */}
      {outcome === null ? (
        <ManualEntry
          expanded={manualPromoted || manual === 'expanded'}
          promoted={manualPromoted}
          searching={searching}
          bottomPad={bottomPad}
          onExpand={() => setManual('expanded')}
          onCollapse={() => setManual('collapsed')}
          onSearch={onManualSearch}
        />
      ) : null}

      {/* ── R4.2) PICKER de candidatos (sheet encima): manual con >1 candidato (caravana visual duplicada).
            Elegir uno → cargar; ninguno → dar de alta. NO se auto-elige el equivocado. ── */}
      {outcome?.kind === 'ambiguous' ? (
        <CandidatePicker
          query={outcome.identifier}
          candidates={outcome.candidates}
          onPick={onPickCandidate}
          onCreateNew={onCreateFromPicker}
          onClose={backToListening}
        />
      ) : null}

      {/* ── R4.4) SHEET "otro rodeo del mismo campo" (encima): pasar el animal a este rodeo / saltar. ── */}
      {otherRodeo ? (
        <OtherRodeoSheet
          animalLabel={otherRodeo.animalLabel}
          animalRodeoName={otherRodeo.animalRodeoName}
          sessionRodeoName={rodeoName}
          canChange={otherRodeo.canChange}
          onMoveAnimal={() => void onMoveAnimalToRodeo(otherRodeo.profileId)}
          onSkip={backToListening}
        />
      ) : null}

      {/* ── SHEET de SALIDA de la jornada (encima): abierto por el botón ‹ del header. Terminar (R10.7) /
            salir sin terminar (reanudable R10.5/R10.6) / seguir. NADA destructivo (no hay rojo). ── */}
      {exitOpen ? (
        <ExitJornadaSheet
          animalCount={session?.animalCount ?? 0}
          onTerminar={onTerminarJornada}
          onExit={exitManiobraFlow}
          onClose={closeExitSheet}
        />
      ) : null}
    </YStack>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// HERO DE ESCANEO ("escuchando") — figura-fondo dominante, una sola cosa que mirar. El disco de pulso es
// un target PASIVO (no se toca: el target es el animal). Dimensionado por figura-fondo ($heroScan).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
function ScanHero({ compact = false, connected }: { compact?: boolean; connected: boolean }) {
  const heroFull = getTokenValue('$heroScan', 'size');
  const heroScan = compact ? heroFull * 0.55 : heroFull;
  const heroIconFull = getTokenValue('$heroIcon', 'size');
  const heroIcon = compact ? heroIconFull * 0.55 : heroIconFull;
  const ring = getTokenValue('$heroRing', 'size');

  return (
    <YStack
      flex={1}
      alignItems="center"
      justifyContent="center"
      paddingHorizontal="$5"
      gap={compact ? '$3' : '$6'}
      opacity={compact ? 0.55 : 1}
    >
      <View
        width={heroScan}
        height={heroScan}
        alignItems="center"
        justifyContent="center"
        {...labelA11y(Platform.OS, 'Escuchando el bastón')}
      >
        <View position="absolute" width={heroScan} height={heroScan} borderRadius="$pill" backgroundColor="$fabHalo" />
        <View
          position="absolute"
          width={heroScan * 0.72}
          height={heroScan * 0.72}
          borderRadius="$pill"
          backgroundColor="$greenLight"
        />
        <View
          width={heroScan * 0.5}
          height={heroScan * 0.5}
          borderRadius="$pill"
          backgroundColor="$primary"
          borderWidth={ring}
          borderColor="$white"
          alignItems="center"
          justifyContent="center"
        >
          <StickIcon size={heroIcon} color={getTokenValue('$white', 'color')} strokeWidth={2} />
        </View>
      </View>

      {compact ? (
        <Text fontFamily="$body" fontSize="$4" lineHeight="$4" fontWeight="500" color="$textMuted" textAlign="center">
          O acercá el bastón al animal
        </Text>
      ) : (
        <YStack alignItems="center" gap="$2">
          <Text fontFamily="$heading" fontSize="$9" lineHeight="$9" fontWeight="700" color="$textPrimary" textAlign="center">
            Acercá el bastón al animal
          </Text>
          <Text fontFamily="$body" fontSize="$5" lineHeight="$5" fontWeight="500" color="$textMuted" textAlign="center">
            {connected
              ? 'La lectura entra sola, sin tocar la pantalla'
              : 'Sin chip o sin bastón, ingresá la caravana abajo'}
          </Text>
        </YStack>
      )}
    </YStack>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// HERO "CONECTÁ EL BASTÓN" (R3.6/R3.7) — DESCONECTADO pero CON un transporte conectable (web-serial antes de
// elegir puerto, o el bastón se cayó y se puede reconectar). MISMO tamaño/posición del disco que ScanHero
// (Jakob, sin salto de layout), pero el disco es un BOTÓN ACTIVO (no el pulse pasivo): que LUZCA tappable.
// El tap ES el gesto de usuario que web-serial exige (requestPort) → dispara connect(). Ícono = StickIcon +
// un badge Bluetooth (metáfora "conectar el bastón"). El manual sigue como banda secundaria abajo.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
function ConnectHero({ compact = false, onConnect }: { compact?: boolean; onConnect: () => void }) {
  const heroFull = getTokenValue('$heroScan', 'size');
  const heroScan = compact ? heroFull * 0.55 : heroFull;
  const heroIconFull = getTokenValue('$heroIcon', 'size');
  const heroIcon = compact ? heroIconFull * 0.55 : heroIconFull;
  const white = getTokenValue('$white', 'color');
  // El badge Bluetooth se monta como disco chico sobreimpreso sobre el disco grande (esquina inf-der), con
  // borde blanco para despegarlo del verde. Su tamaño se deriva del disco (≈28% → reconocible sin tapar el
  // StickIcon). Glifo blanco sobre $primary, mismo lenguaje que el disco.
  const badge = heroScan * 0.28;

  return (
    <YStack
      flex={1}
      alignItems="center"
      justifyContent="center"
      paddingHorizontal="$5"
      gap={compact ? '$3' : '$6'}
      opacity={compact ? 0.55 : 1}
    >
      {/* El DISCO es el target tappable (no pasivo): pressStyle + a11y de botón. Tamaño/posición = ScanHero. */}
      <View
        width={heroScan}
        height={heroScan}
        alignItems="center"
        justifyContent="center"
        pressStyle={{ opacity: 0.85 }}
        onPress={onConnect}
        testID="connect-stick-disc"
        {...buttonA11y(Platform.OS, { label: 'Conectá el bastón' })}
      >
        <View position="absolute" width={heroScan} height={heroScan} borderRadius="$pill" backgroundColor="$fabHalo" />
        <View
          position="absolute"
          width={heroScan * 0.72}
          height={heroScan * 0.72}
          borderRadius="$pill"
          backgroundColor="$greenLight"
        />
        <View
          width={heroScan * 0.5}
          height={heroScan * 0.5}
          borderRadius="$pill"
          backgroundColor="$primary"
          alignItems="center"
          justifyContent="center"
        >
          <StickIcon size={heroIcon} color={white} strokeWidth={2} />
        </View>
        {/* Badge Bluetooth sobreimpreso (esquina inf-der del disco grande). */}
        <View
          position="absolute"
          width={badge}
          height={badge}
          borderRadius="$pill"
          backgroundColor="$primary"
          borderWidth={getTokenValue('$heroRing', 'size') * 0.5}
          borderColor="$white"
          alignItems="center"
          justifyContent="center"
          // Anclado a la esquina inf-der: el disco grande tiene radio heroScan/2 → el badge cae sobre el
          // borde del disco central a ~63%/~63% del contenedor (deriva del tamaño, sin literales).
          bottom={heroScan * 0.16}
          right={heroScan * 0.16}
        >
          <Bluetooth size={badge * 0.55} color={white} strokeWidth={2.5} />
        </View>
      </View>

      {compact ? (
        <Text fontFamily="$body" fontSize="$4" lineHeight="$4" fontWeight="500" color="$textMuted" textAlign="center">
          O tocá para conectar el bastón
        </Text>
      ) : (
        <YStack alignItems="center" gap="$2">
          <Text fontFamily="$heading" fontSize="$9" lineHeight="$9" fontWeight="700" color="$textPrimary" textAlign="center">
            Conectá el bastón
          </Text>
          <Text fontFamily="$body" fontSize="$5" lineHeight="$5" fontWeight="500" color="$textMuted" textAlign="center">
            Tocá para conectar · o cargá la caravana abajo
          </Text>
        </YStack>
      )}
    </YStack>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// HERO "MANUAL PROMOVIDO" (R3.6/R3.7) — DESCONECTADO y SIN transporte conectable (native manual-first hoy,
// el estado cotidiano en el celular de campo hasta que aterrice el BLE native). SIN disco de scan, SIN botón
// de conectar (no hay nada que conectar): la ENTRADA MANUAL es la tarea primaria. Acá el hero es solo un
// PROMPT calmo ("Ingresá la caravana del animal"); el input grande lo trae el ManualEntry expandido por
// default (banda inferior, promoted). Tono NEUTRO/positivo — no es un error, es lo normal en ese dispositivo.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
function ManualPromptHero({ compact = false }: { compact?: boolean }) {
  const heroIcon = getTokenValue('$heroIcon', 'size');
  const primary = getTokenValue('$primary', 'color');

  return (
    <YStack
      flex={1}
      alignItems="center"
      justifyContent="center"
      paddingHorizontal="$5"
      gap={compact ? '$3' : '$5'}
      opacity={compact ? 0.55 : 1}
    >
      <View
        width={getTokenValue('$heroScan', 'size') * 0.5}
        height={getTokenValue('$heroScan', 'size') * 0.5}
        borderRadius="$pill"
        backgroundColor="$greenLight"
        alignItems="center"
        justifyContent="center"
        {...labelA11y(Platform.OS, 'Ingresá la caravana del animal')}
      >
        <Keyboard size={heroIcon} color={primary} strokeWidth={2} />
      </View>

      {compact ? (
        <Text fontFamily="$body" fontSize="$4" lineHeight="$4" fontWeight="500" color="$textMuted" textAlign="center">
          Ingresá la caravana del animal
        </Text>
      ) : (
        <YStack alignItems="center" gap="$2">
          <Text fontFamily="$heading" fontSize="$9" lineHeight="$9" fontWeight="700" color="$textPrimary" textAlign="center">
            Ingresá la caravana del animal
          </Text>
          <Text fontFamily="$body" fontSize="$4" lineHeight="$4" fontWeight="500" color="$textFaint" textAlign="center">
            El bastón no está disponible en este dispositivo
          </Text>
        </YStack>
      )}
    </YStack>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// HERO "ENCONTRADO" (R3.4 feedback visual) — la lectura entró + matcheó un animal. Flash verde + check +
// el identificador resuelto. Es el instante de confirmación antes del auto-avance a la carga rápida.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
function FoundHero({ identifier }: { identifier: string }) {
  const heroScan = getTokenValue('$heroScan', 'size');
  const heroIcon = getTokenValue('$heroIcon', 'size');
  const white = getTokenValue('$white', 'color');
  // El identificador entró por BLE (EID 15 díg → legible agrupado) o manual (texto tal cual). formatEidReadable
  // devuelve el string sin tocar si no son 15 dígitos → un visual/idv manual se muestra como se tipeó.
  const readable = formatEidReadable(identifier);

  return (
    <YStack flex={1} alignItems="center" justifyContent="center" paddingHorizontal="$5" gap="$5">
      <View width={heroScan} height={heroScan} alignItems="center" justifyContent="center">
        <View position="absolute" width={heroScan} height={heroScan} borderRadius="$pill" backgroundColor="$greenLight" />
        <View
          width={heroScan * 0.62}
          height={heroScan * 0.62}
          borderRadius="$pill"
          backgroundColor="$primary"
          alignItems="center"
          justifyContent="center"
          {...labelA11y(Platform.OS, 'Animal encontrado')}
        >
          <Check size={heroIcon} color={white} strokeWidth={3} />
        </View>
      </View>

      <YStack alignItems="center" gap="$2">
        <Text fontFamily="$body" fontSize="$5" lineHeight="$5" fontWeight="600" color="$primary" textAlign="center">
          Lectura recibida
        </Text>
        <Text
          fontFamily="$heading"
          fontSize="$8"
          lineHeight="$8"
          fontWeight="700"
          color="$textPrimary"
          textAlign="center"
          numberOfLines={1}
          letterSpacing={1}
        >
          {readable}
        </Text>
      </YStack>
    </YStack>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// HERO "DESCONOCIDO → DAR DE ALTA" (R4.1 find-or-create) — el identificador no matchea ningún animal del
// campo. Reusa el idiom del FindOrCreateOverlay (PlusCircle + "Animal nuevo" + identificador precargado +
// rodeo de la sesión + "Dar de alta"). NO reimplementa el overlay; el alta vive en /crear-animal.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
function UnknownHero({
  identifier,
  source,
  rodeoName,
  bottomPad,
  onDarDeAlta,
  onCancel,
}: {
  identifier: string;
  source: 'ble' | 'manual';
  rodeoName: string;
  bottomPad: number;
  onDarDeAlta: () => void;
  onCancel: () => void;
}) {
  const dot = getTokenValue('$dot', 'size');
  const heroIcon = getTokenValue('$heroIcon', 'size');
  const primary = getTokenValue('$primary', 'color');
  // BLE → EID legible agrupado; manual → el texto tal cual (no es un EID de 15 díg).
  const readable = source === 'ble' ? formatEidReadable(identifier) : identifier;

  return (
    <YStack flex={1} paddingHorizontal="$4" paddingTop="$4" paddingBottom={bottomPad} gap="$4">
      <YStack flex={1} alignItems="center" justifyContent="center" gap="$5">
        <View
          width={getTokenValue('$heroScan', 'size') * 0.62}
          height={getTokenValue('$heroScan', 'size') * 0.62}
          borderRadius="$pill"
          backgroundColor="$greenLight"
          alignItems="center"
          justifyContent="center"
        >
          <PlusCircle size={heroIcon} color={primary} strokeWidth={2} />
        </View>

        <YStack alignItems="center" gap="$2">
          <Text fontFamily="$heading" fontSize="$9" lineHeight="$9" fontWeight="700" color="$textPrimary" textAlign="center">
            Animal nuevo
          </Text>
          <Text fontFamily="$body" fontSize="$5" lineHeight="$5" fontWeight="500" color="$textMuted" textAlign="center">
            No hay ningún animal con esta caravana. Dalo de alta y seguí con las maniobras.
          </Text>
        </YStack>

        <YStack width="100%" backgroundColor="$surface" borderWidth={1} borderColor="$divider" borderRadius="$card" padding="$4" gap="$3">
          <YStack gap="$1">
            <Text fontFamily="$body" fontSize="$2" lineHeight="$2" fontWeight="600" color="$textMuted">
              {source === 'ble' ? 'Caravana leída' : 'Caravana ingresada'}
            </Text>
            <Text fontFamily="$body" fontSize="$7" lineHeight="$7" fontWeight="700" color="$textPrimary" numberOfLines={1} letterSpacing={1}>
              {readable}
            </Text>
          </YStack>
          {rodeoName ? (
            <>
              <View height={1} backgroundColor="$divider" />
              <XStack alignItems="center" gap="$2">
                <View width={dot} height={dot} borderRadius="$pill" backgroundColor="$primary" />
                <Text fontFamily="$body" fontSize="$4" lineHeight="$4" fontWeight="500" color="$textMuted" numberOfLines={1}>
                  Entra al rodeo <Text fontWeight="700" color="$textPrimary">{rodeoName}</Text>
                </Text>
              </XStack>
            </>
          ) : null}
        </YStack>
      </YStack>

      <YStack gap="$3">
        <View
          backgroundColor="$primary"
          borderRadius="$pill"
          minHeight="$touchMin"
          flexDirection="row"
          alignItems="center"
          justifyContent="center"
          gap="$2"
          pressStyle={{ backgroundColor: '$primaryPress' }}
          onPress={onDarDeAlta}
          {...buttonA11y(Platform.OS, { label: 'Dar de alta' })}
        >
          <PlusCircle size={getTokenValue('$fabIcon', 'size')} color={getTokenValue('$white', 'color')} strokeWidth={2.5} />
          <Text fontFamily="$body" fontSize="$6" lineHeight="$6" fontWeight="700" color="$white" numberOfLines={1}>
            Dar de alta
          </Text>
        </View>
        <Button variant="secondary" fullWidth onPress={onCancel}>
          Volver a escanear
        </Button>
      </YStack>
    </YStack>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// HERO "OTRO ESTABLECIMIENTO" (R4.5) — el animal existe pero en OTRO campo del usuario. Avisamos "está en
// el campo X", SALTAMOS para no frenar la fila, y sugerimos transferir después (la transferencia es la
// feature 11 — acá NO se implementa, solo el aviso + saltar).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
function OtherFieldHero({
  otherFieldName,
  bottomPad,
  onSkip,
}: {
  otherFieldName: string;
  bottomPad: number;
  onSkip: () => void;
}) {
  const heroIcon = getTokenValue('$heroIcon', 'size');
  const terracota = getTokenValue('$terracota', 'color');

  return (
    <YStack flex={1} paddingHorizontal="$4" paddingTop="$4" paddingBottom={bottomPad} gap="$4">
      <YStack flex={1} alignItems="center" justifyContent="center" gap="$5">
        <View
          width={getTokenValue('$heroScan', 'size') * 0.62}
          height={getTokenValue('$heroScan', 'size') * 0.62}
          borderRadius="$pill"
          backgroundColor="$surface"
          borderWidth={1}
          borderColor="$terracota"
          alignItems="center"
          justifyContent="center"
        >
          <ArrowRightLeft size={heroIcon} color={terracota} strokeWidth={2} />
        </View>

        <YStack alignItems="center" gap="$2">
          <Text fontFamily="$heading" fontSize="$9" lineHeight="$9" fontWeight="700" color="$textPrimary" textAlign="center">
            Está en otro campo
          </Text>
          <Text fontFamily="$body" fontSize="$5" lineHeight="$5" fontWeight="500" color="$textMuted" textAlign="center">
            Este animal está en{' '}
            <Text fontWeight="700" color="$textPrimary">{otherFieldName}</Text>. Lo salteamos por ahora;
            podés transferirlo cuando termines la jornada.
          </Text>
        </YStack>
      </YStack>

      <View
        backgroundColor="$primary"
        borderRadius="$pill"
        minHeight="$touchMin"
        alignItems="center"
        justifyContent="center"
        pressStyle={{ backgroundColor: '$primaryPress' }}
        onPress={onSkip}
        {...buttonA11y(Platform.OS, { label: 'Saltar y seguir escaneando' })}
      >
        <Text fontFamily="$body" fontSize="$6" lineHeight="$6" fontWeight="700" color="$white" numberOfLines={1}>
          Saltar y seguir
        </Text>
      </View>
    </YStack>
  );
}

// (R4.2) El outcome `ambiguous` (manual con >1 candidato) ya NO usa un hero de aviso: M2.1-edge le dio la
// UI de SELECCIÓN — el CandidatePicker (sheet) se monta encima del ScanHero. Ver el bloque de render.

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ENTRADA MANUAL (R3.5) — colapsada por default (el bastón es el 95%), expandible con un tap en la thumb
// zone. Colapsada: affordance "¿Sin chip? Ingresá la caravana". Expandida: input grande + "Buscar".
//
// `promoted` (R3.6/R3.7 sub-estado manual-first): cuando NO hay transporte conectable, la entrada manual es
// la TAREA PRIMARIA → el caller la fuerza expandida y acá ocultamos el "Cancelar → volver al escaneo" (no
// hay nada que escanear: colapsarla dejaría un hero de scan engañoso). El input queda como única tarea.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
function ManualEntry({
  expanded,
  promoted = false,
  searching,
  bottomPad,
  onExpand,
  onCollapse,
  onSearch,
}: {
  expanded: boolean;
  promoted?: boolean;
  searching: boolean;
  bottomPad: number;
  onExpand: () => void;
  onCollapse: () => void;
  onSearch: (text: string) => void;
}) {
  const muted = getTokenValue('$textMuted', 'color');
  const textPrimary = getTokenValue('$textPrimary', 'color');
  const inputFontSize = getTokenValue('$inputText', 'size');
  const navIcon = getTokenValue('$navIcon', 'size');
  const [value, setValue] = useState('');

  if (!expanded) {
    return (
      <View paddingHorizontal="$4" paddingTop="$3" paddingBottom={bottomPad}>
        <XStack
          minHeight="$touchMin"
          alignItems="center"
          justifyContent="center"
          gap="$3"
          backgroundColor="$surface"
          borderWidth={1}
          borderColor="$divider"
          borderRadius="$pill"
          paddingHorizontal="$4"
          pressStyle={{ backgroundColor: '$greenLight' }}
          onPress={onExpand}
          {...buttonA11y(Platform.OS, { label: 'Sin chip, ingresá la caravana a mano' })}
        >
          <Keyboard size={navIcon} color={muted} strokeWidth={2} />
          <Text fontFamily="$body" fontSize="$5" lineHeight="$5" fontWeight="600" color="$textMuted" numberOfLines={1}>
            ¿Sin chip? Ingresá la caravana
          </Text>
        </XStack>
      </View>
    );
  }

  const canSearch = value.trim().length > 0 && !searching;

  return (
    <YStack paddingHorizontal="$4" paddingTop="$3" paddingBottom={bottomPad} gap="$3">
      <XStack alignItems="center" justifyContent="space-between">
        <Text fontFamily="$body" fontSize="$5" lineHeight="$5" fontWeight="700" color="$textPrimary">
          Ingresá la caravana
        </Text>
        {/* "Cancelar → volver al escaneo" SOLO cuando hay algo que escanear (no promovido). En manual-first
            (promoted) no hay scan al cual volver → ocultamos el cancelar para no engañar. */}
        {promoted ? null : (
          <Pressable
            onPress={() => {
              setValue('');
              onCollapse();
            }}
            {...buttonA11y(Platform.OS, { label: 'Volver al escaneo' })}
          >
            <View paddingHorizontal="$3" paddingVertical="$1">
              <Text fontFamily="$body" fontSize="$4" lineHeight="$4" fontWeight="600" color="$primary">
                Cancelar
              </Text>
            </View>
          </Pressable>
        )}
      </XStack>

      <XStack
        minHeight="$searchBarLg"
        alignItems="center"
        gap="$3"
        backgroundColor="$surface"
        borderWidth={2}
        borderColor="$primary"
        borderRadius="$card"
        paddingHorizontal="$4"
      >
        <TextInput
          value={value}
          // Tope de longitud (UX) = corte AUTORITATIVO de classifySearchQuery (slice(0, SEARCH_TERM_MAX_LENGTH=64)
          // en animal-identifier.ts, server-consumido antes de toda query). Importamos la MISMA constante (no
          // redefinir/hardcodear) — mismo patrón que el buscador de (tabs)/animales.tsx. `maxLength` corta en
          // native; el `.slice` asegura el tope también en web. Cazado por el Gate 2 (security_code_03, MED-2).
          onChangeText={(t) => setValue(t.slice(0, SEARCH_TERM_MAX_LENGTH))}
          maxLength={SEARCH_TERM_MAX_LENGTH}
          onSubmitEditing={() => {
            if (canSearch) onSearch(value);
          }}
          placeholder="Número o caravana visual"
          placeholderTextColor={muted}
          accessibilityLabel="Número o caravana visual"
          testID="manual-entry-input"
          autoCorrect={false}
          autoCapitalize="characters"
          returnKeyType="search"
          style={{ flex: 1, color: textPrimary, fontFamily: 'Inter', fontSize: inputFontSize, fontWeight: '700' }}
        />
      </XStack>

      <View
        backgroundColor={canSearch ? '$primary' : '$divider'}
        borderRadius="$pill"
        minHeight="$touchMin"
        alignItems="center"
        justifyContent="center"
        opacity={canSearch ? 1 : 0.7}
        pressStyle={canSearch ? { backgroundColor: '$primaryPress' } : undefined}
        onPress={canSearch ? () => onSearch(value) : undefined}
        {...buttonA11y(Platform.OS, { label: 'Buscar animal', disabled: !canSearch })}
      >
        <Text fontFamily="$body" fontSize="$6" lineHeight="$6" fontWeight="700" color="$white" numberOfLines={1}>
          {searching ? 'Buscando…' : 'Buscar'}
        </Text>
      </View>
    </YStack>
  );
}
