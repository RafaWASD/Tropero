// app/(tabs)/index.tsx — Home de RAFAQ (post-creación de establecimiento).
//
// Construida a mano como TEST DE COBERTURA del design system (A.1, ADR-023 §5):
// reproduce el mockup canónico `design/stitch-iter-4/00-home-CANONICAL.png`
// ensamblándose con los componentes derivados (Button / Card / Stepper) + tokens.
// El tab tiene headerShown:false (ADR-018), así que el header es propio de la
// pantalla.
//
// Incremento 1 (colaborativo): header estático + saludo + banner descartable +
// wizard de 3 pasos + CTA del paso 1.
//
// Incremento (R6.8.1): el switch del header pasa de ESTÁTICO a DROPDOWN funcional
// (EstablishmentSwitcherDropdown): campo activo ● → últimos 2 visitados → "Ver todos
// mis campos" (→ /mis-campos) → "Crear nuevo campo +" (→ /crear-campo).
//
// B.1.2 (Fase 4): la home se CABLEA a datos reales — fuera el mock data. El nombre del
// usuario viene de AuthContext; el campo activo y los visitados, de EstablishmentContext.
// El switch refleja el campo activo REAL; al elegir un visitado, switchEstablishment(id)
// cambia el contexto y la home re-renderiza con el campo nuevo (bug (a) de Raf). NUNCA se
// hardcodea establishment_id (CLAUDE.md ppio 6).
//
// Cero hardcode de color/spacing (ADR-023 §4): todo via tokens. Donde un valor
// cruza a una API no-Tamagui (tamaño de íconos lucide) se lee con getTokenValue.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getTokenValue, ScrollView, Text, View, XStack, YStack } from 'tamagui';
import { Check, ChevronDown, User, X } from 'lucide-react-native';
import { useStatus } from '@powersync/react';

import {
  Button,
  Card,
  EstablishmentSwitcherDropdown,
  GroupSummaryCard,
  Stepper,
  pickVisited,
  type StepperStep,
  type SwitcherField,
} from '@/components';
import { CampoIcon, LoteIcon, RodeoIcon } from '@/theme/icons';
import { useAuth, useEstablishment, useProfile, useRodeo } from '@/contexts';
import { localityOf, shouldShowReadyBanner } from '@/utils/establishment';
import { allOnboardingStepsDone } from '@/utils/onboarding';
import { addDismissedBanner, loadDismissedBanners } from '@/services/establishment-store';
import { countAnimals } from '@/services/animals';
import { countTeam } from '@/services/members';
import { fetchRodeoHeadCounts, fetchGroupHeadCounts } from '@/services/group-data';
import { fetchManagementGroups, type ManagementGroup } from '@/services/management-groups';
import { fetchProductionSystems, type Rodeo } from '@/services/rodeos';


/** Header propio de la home (el tab no muestra header nativo, ADR-018). */
function HomeHeader({
  activeName,
  isOpen,
  highlight,
  onSwitchPress,
}: {
  activeName: string;
  isOpen: boolean;
  /** Pulso de confirmación al cambiar de campo (Run 2 d): fondo $greenLight breve en el chip. */
  highlight: boolean;
  onSwitchPress: () => void;
}) {
  const iconColor = getTokenValue('$primary', 'color');
  const avatarSize = getTokenValue('$avatar', 'size');
  const mutedColor = getTokenValue('$textMuted', 'color');

  return (
    // Fila a ancho completo. Los 3 bloques (switch · wordmark · avatar) se reparten
    // con space-between; sin width:100% la fila tomaría su ancho intrínseco y, como
    // los hijos RN no encogen por default (flexShrink:0), el avatar quedaba fuera de
    // pantalla a la derecha (Fix 1 — overflow horizontal, incremento 2).
    <XStack width="100%" alignItems="center" justifyContent="space-between" paddingVertical="$3">
      {/* Switch de establecimiento — al tocarlo DESPLIEGA el dropdown inline (R6.8.1).
          Puede encoger (flexShrink) y el nombre trunca con ellipsis para no empujar la
          fila. `aria-expanded` comunica el estado abierto a tecnologías de asistencia. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Establecimiento activo: ${activeName}. Tocá para cambiar de campo.`}
        aria-expanded={isOpen}
        onPress={onSwitchPress}
        // minWidth:0 además de flexShrink:1 — en react-native-web el min-width:auto
        // por default impide que el bloque encoja por debajo del ancho intrínseco del
        // nombre del campo; sin esto la fila del header se estira y empuja el avatar
        // fuera de pantalla a la derecha (Fix overflow web).
        style={{ flexShrink: 1, minWidth: 0 }}
      >
        {/* Chip del switch. Lleva el pulso de confirmación al cambiar de campo (Run 2 d):
            fondo $greenLight breve (~450ms) que aparece y se desvanece, dejando el chip en
            su estado normal (transparente). borderRadius $pill + padding chico para que el
            realce se vea como una pill, no un bloque cuadrado. El pulso es DECORATIVO: no
            mueve el layout (el padding está siempre presente) ni bloquea toques. Sin driver
            de `animations` en el config (tamagui.config.ts) → toggle de fondo con timeout. */}
        <XStack
          alignItems="center"
          gap="$2"
          flexShrink={1}
          minWidth={0}
          borderRadius="$pill"
          paddingHorizontal="$2"
          paddingVertical="$1"
          backgroundColor={highlight ? '$greenLight' : 'transparent'}
        >
          <CampoIcon size={20} color={iconColor} />
          <Text
            fontFamily="$body"
            fontSize="$5"
            fontWeight="600"
            color="$primary"
            flexShrink={1}
            minWidth={0}
            numberOfLines={1}
          >
            {activeName}
          </Text>
          {/* El chevron rota 180° cuando el dropdown está abierto (feedback de estado,
              Nielsen #1). rotate cruza a transform; no es color/spacing → sin token. */}
          <View style={{ transform: [{ rotate: isOpen ? '180deg' : '0deg' }] }}>
            <ChevronDown size={18} color={iconColor} />
          </View>
        </XStack>
      </Pressable>

      {/* Wordmark RAFAQ. No encoge (flexShrink:0): es identidad de marca. */}
      <Text
        fontFamily="$body"
        fontSize="$7" lineHeight="$7"
        fontWeight="700"
        color="$primary"
        letterSpacing={1}
        flexShrink={0}
        marginHorizontal="$2"
      >
        RAFAQ
      </Text>

      {/* Avatar (placeholder: círculo bone con ícono de usuario). No encoge: queda
          siempre visible en el extremo derecho. */}
      <View
        width={avatarSize}
        height={avatarSize}
        borderRadius="$pill"
        backgroundColor="$surface"
        borderWidth={1}
        borderColor="$divider"
        alignItems="center"
        justifyContent="center"
        flexShrink={0}
      >
        <User size={20} color={mutedColor} />
      </View>
    </XStack>
  );
}

/** Banner "establecimiento listo" — descartable (✕). */
function ReadyBanner({
  establishmentName,
  onDismiss,
}: {
  establishmentName: string;
  onDismiss: () => void;
}) {
  const checkColor = getTokenValue('$primary', 'color');
  const iconBox = getTokenValue('$icon', 'size');
  const xColor = getTokenValue('$textMuted', 'color');

  return (
    // Card a ancho completo (alignSelf:stretch) para que el ✕ quede visible a la
    // derecha y no se corte (Fix 1 — overflow horizontal, incremento 2).
    <Card marginTop="$4" alignSelf="stretch">
      <XStack width="100%" alignItems="center" gap="$3">
        {/* Círculo verde claro con check verde botella. Ancho fijo, no encoge. */}
        <View
          width={iconBox}
          height={iconBox}
          borderRadius="$pill"
          backgroundColor="$greenLight"
          alignItems="center"
          justifyContent="center"
          flexShrink={0}
        >
          <Check size={24} color={checkColor} strokeWidth={3} />
        </View>

        {/* El texto toma el espacio restante y wrappea (no empuja la fila). minWidth:0
            — en react-native-web el min-width:auto por default impide que el bloque de
            texto encoja por debajo de su ancho intrínseco; sin esto la fila del banner
            se estira y el ✕ queda fuera de pantalla a la derecha (Fix overflow web). */}
        <Text flex={1} minWidth={0} fontFamily="$body" fontSize="$5" fontWeight="400" color="$textPrimary">
          Tu establecimiento{' '}
          <Text fontFamily="$body" fontWeight="600" color="$textPrimary">
            {establishmentName}
          </Text>{' '}
          está listo.
        </Text>

        {/* ✕ siempre visible a la derecha (no encoge). */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Descartar aviso"
          onPress={onDismiss}
          hitSlop={8}
          style={{ flexShrink: 0 }}
        >
          <X size={22} color={xColor} />
        </Pressable>
      </XStack>
    </Card>
  );
}

export default function InicioScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { state: authState } = useAuth();
  const { state: estState, recents, switchEstablishment } = useEstablishment();
  const { profile, loading: profileLoading } = useProfile();
  const { state: rodeoState } = useRodeo();

  const userId = authState.status === 'authenticated' ? authState.user.id : null;

  // ── Datos reales (Fase 4 + Fase 6) ───────────────────────────────────────────
  // Nombre del usuario ← ProfileContext (FUENTE ÚNICA, public.users; Fase 6 — antes salía de
  // AuthContext/user_metadata y no se actualizaba al editar). Campo activo ← contexto
  // multi-tenant (R6.3). NUNCA se hardcodea (CLAUDE.md ppio 6). Mientras el perfil carga,
  // mostramos el saludo NEUTRO (sin parpadear "Hola undefined").
  const userFirstName = firstNameOf(profile?.name ?? null);

  // El campo activo real. La home solo se renderiza cuando el gating ya garantizó estado
  // 'active' (RootGate), pero defendemos por si se monta en transición. Lleva localidad + rol
  // (Run 2 e) para el subtítulo de desambiguación del dropdown del switch.
  const activeField: SwitcherField | null =
    estState.status === 'active'
      ? {
          id: estState.current.id,
          name: estState.current.name,
          locality: localityOf(estState.current),
          role: estState.current.role,
        }
      : null;
  const activeId = activeField?.id ?? null;
  // Rol del usuario en el campo activo (primitivo) — solo el owner puede invitar/gestionar miembros (R5)
  // y solo él necesita el conteo de equipo (la RLS es owner-céntrica). Lo usan el step de equipo y el
  // loader (deps primitivas, sin loops).
  const isOwner = activeField?.role === 'owner';

  // Estado de sync de PowerSync (el árbol está bajo PowerSyncContext): lo usamos para re-leer los
  // conteos del Stepper (animales/equipo) cuando AVANZA un sync, sin depender solo del re-foco (fix
  // showstopper, mismo patrón que la tab Animales). Primitivo (ms) → dep estable, no loopea.
  const syncStatus = useStatus();
  const lastSyncedMs = syncStatus.lastSyncedAt?.getTime() ?? 0;

  // ── Banner "establecimiento listo" per-campo + dismiss persistido (Run 2 c) ──
  // El banner se controlaba con un useState(true) local → NO era per-campo (se mantenía
  // visible al cambiar de campo y el descarte no era por-campo). Ahora: per-campo, dismiss
  // persistido per-usuario (establishment-store). Cargamos el set de descartados al montar
  // (por userId) y lo mantenemos en estado; el banner se muestra SOLO para el campo activo y
  // SOLO si su id no está descartado (shouldShowReadyBanner, null-safe). Al cambiar de campo,
  // el banner se re-evalúa contra el activo nuevo. Descartar en A no afecta a B (per-campo) y
  // volver a A no lo resucita (persistido).
  const [dismissedBanners, setDismissedBanners] = useState<string[]>([]);
  useEffect(() => {
    if (!userId) return;
    let active = true;
    loadDismissedBanners(userId).then((ids) => {
      if (active) setDismissedBanners(ids);
    });
    return () => {
      active = false;
    };
  }, [userId]);

  const bannerVisible = shouldShowReadyBanner(activeId, dismissedBanners);

  async function dismissBanner() {
    if (!userId || !activeId) return;
    // Persistimos el descarte per-campo y actualizamos el estado para ocultar de inmediato.
    const next = await addDismissedBanner(userId, activeId);
    setDismissedBanners(next);
  }

  // ── Switch de establecimiento (R6.8.1) ──────────────────────────────────────
  const [switcherOpen, setSwitcherOpen] = useState(false);
  // Alto del header medido en runtime (insets + fila) para anclar el dropdown JUSTO
  // debajo. onLayout → número derivado del layout, no un literal de spacing.
  const [headerBottom, setHeaderBottom] = useState(0);

  // ── Micro-feedback al cambiar de campo (Run 2 d) ─────────────────────────────
  // Pulso breve (~450ms) de fondo $greenLight en el chip del switch del header que confirma
  // el cambio (SIN skeleton / SIN pantalla de carga: el switch es local, no hay round-trip).
  // Dispara SOLO cuando activeId pasa de un campo REAL a OTRO campo real estando la home
  // MONTADA (caso dropdown del switch). NO dispara: (1) en el montaje inicial; (2) cuando el
  // activo "aparece" por primera vez (null → id, ej. una carrera de render donde el contexto
  // resuelve un tick tarde) — eso no es un cambio que el usuario haya pedido confirmar. Por
  // eso comparamos contra el activeId PREVIO real (ref), no contra un flag de montaje.
  // Caso "Mis campos" → home: onSelect hace switch + router.replace → la home MONTA fresca; en
  // montaje fresco el prev arranca null → no hay pulso, y está BIEN (el cambio de pantalla
  // completo ya es feedback suficiente). NO forzamos el pulso cross-screen (complejidad
  // innecesaria).
  const [switchHighlight, setSwitchHighlight] = useState(false);
  const prevActiveIdRef = useRef<string | null>(activeId);
  useEffect(() => {
    const prev = prevActiveIdRef.current;
    prevActiveIdRef.current = activeId;
    // Solo pulso si había un activo real distinto del nuevo (cambio genuino de campo).
    if (!activeId || !prev || prev === activeId) return;
    setSwitchHighlight(true);
    const t = setTimeout(() => setSwitchHighlight(false), 450);
    return () => clearTimeout(t);
  }, [activeId]);

  // Los "últimos 2 visitados" distintos del activo (R6.8.1), derivados del rastro REAL de
  // visitados (R6.9). Al hacer switch, el saliente entra a recientes → reaparece como
  // visitado (bug (b) de Raf). Mapeamos los recents del contexto a SwitcherField, con
  // localidad + rol para el subtítulo de desambiguación (Run 2 e).
  const recentFields: SwitcherField[] = recents.map((e) => ({
    id: e.id,
    name: e.name,
    locality: localityOf(e),
    role: e.role,
  }));
  const visited = activeField ? pickVisited(recentFields, activeField.id) : [];

  // ── Conteo de animales del campo activo → drivea el paso "Cargá tu primer animal" (fix-loop 3) ──
  // El paso "Cargá tu primer animal" estaba HARDCODEADO state:'active' (cuando se hizo el fix de C1,
  // la capa de animales C2 no existía). Ahora SÍ existe → el paso debe reflejar si el campo activo
  // tiene ≥1 animal. Cargamos un count liviano (head:true, sin traer filas).
  //
  // `hasAnimals` arranca null = "todavía no sabemos" (no afirmamos pendiente ni hecho hasta tener el
  // primer count). Mientras carga / en error NO reseteamos a null → no parpadeamos el paso.
  const [hasAnimals, setHasAnimals] = useState<boolean | null>(null);
  // Guard de secuencia: si el campo activo cambia (o el foco re-dispara) mientras una carga está en
  // vuelo, descartamos el resultado viejo (evita una respuesta tardía pisando una nueva).
  const animalCountSeq = useRef(0);
  // Último campo cuyo count tenemos aplicado. Distingue "re-foco del MISMO campo" (conservar el valor
  // → sin parpadeo, brief: "asumí el estado previo") de "cambio de campo" (resetear a null → no
  // heredar el "hecho" del campo viejo en uno nuevo donde quizá no hay animales = NO mentir).
  const countedEstIdRef = useRef<string | null>(null);

  const loadAnimalCount = useCallback((estId: string | null) => {
    if (!estId) {
      countedEstIdRef.current = null;
      setHasAnimals(null);
      return;
    }
    // Cambio de campo: olvidamos el valor del campo anterior (no afirmamos "hecho" heredado en el
    // campo nuevo durante su carga). Re-foco del mismo campo: conservamos el valor (sin parpadeo).
    if (countedEstIdRef.current !== estId) {
      countedEstIdRef.current = estId;
      setHasAnimals(null);
    }
    const seq = ++animalCountSeq.current;
    void countAnimals(estId).then((result) => {
      if (seq !== animalCountSeq.current) return; // cambió el campo / re-foco mientras cargaba.
      // En error (red/permisos) NO afirmamos un estado falso: dejamos el valor previo (no
      // parpadeamos el paso). El usuario que ya tiene animales no ve "Cargá tu primer animal"
      // reaparecer por un hipo de red; el que no los tiene, no ve un falso "hecho".
      if (result.ok) setHasAnimals(result.value > 0);
    });
  }, []);

  // ── Conteo del equipo del campo activo → drivea el paso "Invitá a tu vet o capataz" (fix-loop 4) ──
  // Mismo PATRÓN que el conteo de animales (arriba): el paso 3 estaba HARDCODEADO `state:'future'`
  // (estático) → MENTÍA cuando ya habías sumado/invitado a alguien (el caso de Raf: sumó a su vet pero
  // el Inicio seguía pidiendo "Invitá a tu operario o vet"). Ahora se drivea por estado real.
  //
  // Señal de "equipo iniciado": ≥1 OTRO miembro activo (además del usuario actual) O ≥1 invitación
  // pendiente. Para el OWNER el conteo (countTeam) responde ambas; para un NO-OWNER la RLS owner-céntrica
  // (0008) hace que `others`/`pending` den 0 (no ve al owner ni a sus pares), PERO un no-owner que llegó a
  // la home ES evidencia de un equipo de ≥2 (alguien lo sumó) → para él el paso lo cierra el ROL, no el
  // conteo (ver `teamStarted` abajo). Así ningún rol ve el paso mentir.
  //
  // `teamCounts` arranca null = "todavía no sabemos" (no afirmamos hecho/pendiente hasta el primer
  // conteo). Mientras carga / en error NO reseteamos a null → no parpadeamos el paso.
  const [teamCounts, setTeamCounts] = useState<{ others: number; pending: number } | null>(null);
  // Guard de secuencia (descarta respuestas tardías) y guard de campo (resetea a null SOLO al cambiar de
  // campo, no en re-foco del mismo) — IDÉNTICOS al patrón del conteo de animales (countedEstIdRef), para
  // no heredar el "hecho" de un campo viejo al switchear (no mentir) ni parpadear en re-foco.
  const teamCountSeq = useRef(0);
  const teamCountedEstIdRef = useRef<string | null>(null);

  const loadTeamCount = useCallback((estId: string | null, selfId: string | null, owner: boolean) => {
    // Solo el OWNER necesita el conteo: para un no-owner el paso lo cierra el rol (ver teamStarted) y
    // la RLS owner-céntrica le daría 0/0 igual → no malgastamos 2 round-trips ni dependemos de un valor
    // que ignoraríamos. Dejamos teamCounts en null (el rol decide, no el conteo).
    if (!owner || !estId || !selfId) {
      teamCountedEstIdRef.current = null;
      setTeamCounts(null);
      return;
    }
    // Cambio de campo: olvidamos el conteo del anterior (no afirmamos "hecho" heredado durante la carga
    // del nuevo). Re-foco del mismo campo: conservamos el valor (sin parpadeo).
    if (teamCountedEstIdRef.current !== estId) {
      teamCountedEstIdRef.current = estId;
      setTeamCounts(null);
    }
    const seq = ++teamCountSeq.current;
    void countTeam(estId, selfId).then((result) => {
      if (seq !== teamCountSeq.current) return; // cambió el campo / re-foco mientras cargaba.
      // En error (red/permisos) NO afirmamos un estado falso: dejamos el valor previo (no parpadeamos).
      if (result.ok) setTeamCounts(result.counts);
    });
  }, []);

  // ── Grupos del campo activo (Inicio rodeo-céntrico, T-UI.2 / R2.1) ──────────────────────────────
  // Cabezas activas por rodeo + por lote (Map id → count) + la lista de lotes del campo. Los rodeos
  // salen del RodeoContext (ya cargado). Se cargan al enfocar y al avanzar el sync (mismo patrón que los
  // conteos del Stepper). Guard de secuencia para descartar respuestas tardías al cambiar de campo.
  const [rodeoHeadCounts, setRodeoHeadCounts] = useState<Map<string, number>>(new Map());
  const [groupHeadCounts, setGroupHeadCounts] = useState<Map<string, number>>(new Map());
  const [lotes, setLotes] = useState<ManagementGroup[]>([]);
  // Nombre del sistema productivo por system_id (ej. "Cría") → subtítulo de la card de rodeo (R2.1: la
  // card lleva nombre + SISTEMA + cabezas). Se resuelve barato del catálogo global LOCAL (offline):
  // fetchProductionSystems('bovino') es UNA lectura SQLite ya usada por el wizard (no es una query nueva
  // ni un round-trip de red). El catálogo es field-independent → se mapea systemId → name una vez y se
  // reusa para todos los rodeos. Las cards de LOTE NO llevan sistema (un lote es cross-rodeo: no tiene un
  // sistema único — ADR-020). Si el catálogo aún no sincronizó, queda vacío y la card cae a solo cabezas.
  const [systemNames, setSystemNames] = useState<Map<string, string>>(new Map());
  const groupsSeq = useRef(0);

  const loadGroups = useCallback((estId: string | null) => {
    if (!estId) {
      setRodeoHeadCounts(new Map());
      setGroupHeadCounts(new Map());
      setLotes([]);
      // El catálogo de sistemas es global (no per-campo) → NO lo reseteamos al perder el campo activo:
      // una vez resuelto, sirve para cualquier campo y no hace falta re-leerlo.
      return;
    }
    const seq = ++groupsSeq.current;
    void Promise.all([
      fetchRodeoHeadCounts(estId),
      fetchGroupHeadCounts(estId),
      fetchManagementGroups(estId),
      // bovino es la única especie del MVP (todos los rodeos son bovinos); la lectura es local + offline.
      fetchProductionSystems('bovino'),
    ]).then(([rodeoCounts, groupCounts, groups, systems]) => {
      if (seq !== groupsSeq.current) return; // cambió el campo mientras cargaba.
      if (rodeoCounts.ok) setRodeoHeadCounts(rodeoCounts.value);
      if (groupCounts.ok) setGroupHeadCounts(groupCounts.value);
      // fetchManagementGroups degrada a "sincronizando" si un campo nuevo aún no bajó sus lotes →
      // en ese caso dejamos la lista vacía (la sección de lotes simplemente no aparece, sin error).
      if (groups.ok) setLotes(groups.value);
      // Mapa systemId → name. Si el catálogo aún no bajó (primer login sin red) degrada a error/vacío →
      // NO pisamos el mapa previo (no parpadeamos el subtítulo de la card a "solo cabezas").
      if (systems.ok) setSystemNames(new Map(systems.value.map((s) => [s.systemId, s.name])));
    });
  }, []);

  // Recargamos al ENFOCAR la home (mount + volver de la tab Animales/Equipo) y cuando cambia el campo
  // activo. Dep PRIMITIVA (activeId string + userId, NO el objeto activeField — lección RodeoContext/
  // miembros.tsx: un objeto recreado cada render dispararía un loop de fetch). `loadAnimalCount` y
  // `loadTeamCount` son estables (useCallback sin deps) y el foco es un evento DISCRETO → no loopea.
  useFocusEffect(
    useCallback(() => {
      loadAnimalCount(activeId);
      loadTeamCount(activeId, userId, isOwner);
      loadGroups(activeId);
    }, [activeId, userId, isOwner, loadAnimalCount, loadTeamCount, loadGroups]),
  );

  // FIX showstopper: re-leer los conteos cuando AVANZA el sync (lastSyncedAt). Al bajar el first-sync
  // —o cuando una alta optimista pasa de overlay a fila sincronizada— los conteos locales cambian; sin
  // este re-read el Stepper quedaría mostrando "Cargá tu primer animal" hasta el próximo re-foco. La
  // dep es un primitivo (ms), estable entre syncs → no loopea. El useFocusEffect queda de red de
  // seguridad. Se omite mientras lastSyncedMs===0 (aún no hubo sync; el efecto de foco ya cargó).
  useEffect(() => {
    if (lastSyncedMs === 0) return;
    loadAnimalCount(activeId);
    loadTeamCount(activeId, userId, isOwner);
    loadGroups(activeId);
  }, [lastSyncedMs, activeId, userId, isOwner, loadAnimalCount, loadTeamCount, loadGroups]);

  // ── Pasos de "primeros pasos" DRIVEADOS POR ESTADO REAL (bug 1 de Raf). ──────────────
  // El Stepper era ESTÁTICO: el paso "Crear rodeo" estaba hardcodeado 'active' con un CTA que solo
  // tenía un `// TODO` → la home seguía diciendo "Creá tu primer rodeo" DESPUÉS de crearlo, y el CTA
  // no hacía nada. Pero la home solo se renderiza cuando el RootGate ya garantizó ≥1 rodeo (con 0
  // rodeos el bloqueo total muestra el wizard, NO la home), así que el paso de rodeo SIEMPRE está
  // HECHO acá. Lo driveamos desde estado real (useRodeo + rol del campo activo); ningún CTA es un
  // TODO muerto.
  const rodeoDone = rodeoState.status === 'active';
  // Solo el owner puede invitar miembros (R5): a un no-owner no le ofrecemos ese CTA (isOwner arriba).
  const canInvite = isOwner;

  // ── Grupos para las cards de Inicio (R2.1/R2.2) ────────────────────────────────────────────────
  // Rodeos del campo activo (del RodeoContext, ya cargados). Las cards muestran nombre + cabezas y
  // tappean a la vista de grupo (/rodeo/[id]). Los lotes (cards secundarias) salen de `lotes`.
  const rodeos: Rodeo[] = rodeoState.status === 'active' ? rodeoState.available : [];
  const openRodeo = useCallback(
    (rodeoId: string) => router.push({ pathname: '/rodeo/[id]', params: { id: rodeoId } }),
    [router],
  );
  const openLote = useCallback(
    (groupId: string) => router.push({ pathname: '/lote/[id]', params: { id: groupId } }),
    [router],
  );

  // Paso "Invitá a tu vet o capataz" DRIVEADO por estado real (fix-loop 4): `done` cuando el campo ya
  // tiene equipo (≥1 otro miembro o ≥1 invitación pendiente), `active` cuando todavía no.
  //   - NO-OWNER: el solo hecho de estar en la home de un campo ajeno = equipo iniciado (alguien lo
  //     sumó); además la RLS no le deja ver al owner ni invitaciones → el rol cierra el paso (`done`).
  //   - OWNER: lo decide el conteo real. `teamCounts === null` (cargando / aún sin saber) = NO afirmamos
  //     "hecho": mostramos PENDIENTE (default honesto; el peor error sería afirmar "hecho" en falso). En
  //     re-foco del mismo campo el valor previo se conserva → sin parpadeo.
  const teamStarted =
    !isOwner || (teamCounts != null && (teamCounts.others >= 1 || teamCounts.pending >= 1));

  const steps: StepperStep[] = [
    {
      // El gate garantiza ≥1 rodeo en la home → este paso está hecho. Su CTA lleva a la gestión de
      // rodeos (NO un TODO), por si el usuario quiere crear/editar otro.
      state: rodeoDone ? 'done' : 'active',
      title: 'Configurá tu rodeo',
      body: 'Definiste el sistema productivo y los datos que cargás por animal. Podés ajustarlo cuando quieras.',
      children: (
        <Button variant="secondary" fullWidth onPress={() => router.push('/rodeos')}>
          Gestionar rodeos
        </Button>
      ),
    },
    {
      // Paso "Cargá tu primer animal" DRIVEADO por estado real (fix-loop 3): `done` cuando el campo
      // activo ya tiene ≥1 animal (hasAnimals === true), `active` cuando todavía no. El rodeo SIEMPRE
      // está hecho en la home (el RootGate garantiza ≥1 rodeo antes de renderizarla — ver el paso de
      // rodeo arriba), así que no hace falta condicionar el `active` a rodeoDone: el único eje real
      // de este paso es "¿hay animales?".
      // Mientras el primer count carga (hasAnimals === null) el paso se muestra PENDIENTE: es el
      // default honesto para alguien de quien todavía no sabemos si cargó animales (el bug que motivó
      // este fix era el inverso — afirmar "pendiente" para SIEMPRE aunque ya hubiera animales; el peor
      // error sería afirmar "hecho" en falso, que NO hacemos). En re-focos (volver de otra tab) el
      // valor previo se conserva → sin parpadeo; el único flash posible es el mount frío inicial (1
      // render, count head:true rápido). El CTA "Ir a Animales" queda disponible en AMBOS estados
      // (mismo criterio que "Gestionar rodeos" del paso rodeo done): cuando está hecho sirve para
      // seguir cargando; nunca es un botón muerto.
      state: hasAnimals ? 'done' : 'active',
      title: hasAnimals ? 'Cargaste tu primer animal' : 'Cargá tu primer animal',
      body: hasAnimals
        ? 'Ya tenés animales registrados en este campo. Seguí cargando desde la pestaña Animales.'
        : 'Empezá registrando los animales de tu rodeo desde la pestaña Animales.',
      children: (
        <Button
          variant={hasAnimals ? 'secondary' : 'primary'}
          fullWidth
          onPress={() => router.navigate('/(tabs)/animales')}
        >
          Ir a Animales
        </Button>
      ),
    },
    {
      // Paso "Invitá a tu vet o capataz" DRIVEADO por estado real (fix-loop 4): `done` cuando el campo
      // ya tiene equipo (teamStarted), `active` cuando todavía no. Se rendea `done` igual que los pasos
      // rodeo/animal (Stepper ✓ verde + título atenuado), consistencia visual. El CTA "Equipo" queda
      // disponible en AMBOS estados para el owner (mismo criterio que los otros pasos done: cuando está
      // hecho sirve para gestionar el equipo; nunca es un botón muerto). A un no-owner no se le ofrece el
      // CTA (no puede invitar, R5) y su paso ya está `done` por rol.
      state: teamStarted ? 'done' : 'active',
      title: teamStarted ? 'Tu equipo está en marcha' : 'Invitá a tu vet o capataz',
      body: teamStarted
        ? 'Ya sumaste a tu equipo a este campo. Gestioná miembros y permisos cuando quieras.'
        : 'Sumá miembros con permisos específicos para tu equipo.',
      // CTA solo para el owner (el único que puede invitar/gestionar, R5) → pantalla de equipo (/miembros).
      children: canInvite ? (
        <Button variant="secondary" fullWidth onPress={() => router.push('/miembros')}>
          {teamStarted ? 'Gestionar equipo' : 'Invitar al equipo'}
        </Button>
      ) : undefined,
    },
  ];

  // ── Ocultar el wizard de "primeros pasos" cuando el onboarding está COMPLETO ───────────────────
  // El stepper es una guía de arranque: una vez que el campo tiene los 3 pasos hechos (rodeo + ≥1
  // animal + equipo en marcha), deja de aportar y se oculta — un usuario ya-onboardeado no lo ve.
  // CRITERIO CONSERVADOR (anti-parpadeo, mismo del resto del archivo): solo ocultamos cuando los 3
  // están CONFIRMADOS done. `hasAnimals === true` exige el count real (null = "todavía no sabemos"
  // → NO ocultamos, mostramos el stepper). `teamStarted` ya es conservador (null → false). Así un
  // usuario nuevo siempre ve el stepper (sin flash de "completo" con info incompleta) y solo
  // desaparece cuando de verdad terminó. Si faltan 1 o 2 pasos, el stepper sigue (con los hechos
  // tildados). La decisión es lógica PURA (utils/onboarding) → testeable en aislamiento.
  const allStepsDone = allOnboardingStepsDone({ rodeoDone, hasAnimals, teamStarted });

  // Guarda de transición: la home solo tiene sentido con un campo activo. El gating
  // (RootGate) garantiza estado 'active' antes de mostrar (tabs); si por una carrera de
  // render no hay campo activo todavía, no pintamos la home mock — devolvemos un lienzo
  // vacío con el fondo de marca (el gate reubica en el próximo tick).
  if (!activeField) {
    return <YStack flex={1} width="100%" backgroundColor="$bg" />;
  }

  return (
    // Raíz a ancho completo: flex:1 + width:100%. El padding horizontal es simétrico
    // ($4 a ambos lados) y vive en los contenedores internos, no acá, para que el
    // fondo $bg cubra todo el ancho (Fix 1 — overflow horizontal, incremento 2).
    // Defensa web (Fix overflow web): maxWidth:100% + overflow:hidden horizontal en la
    // raíz garantizan que NINGÚN hijo pueda exceder el viewport (último cinturón de
    // seguridad si algún flex item se resiste a encoger). El scroll vertical lo maneja
    // el ScrollView interno, así que clipear la raíz no lo rompe.
    <YStack flex={1} width="100%" maxWidth="100%" overflow="hidden" backgroundColor="$bg">
      {/* Safe-area arriba: el header propio respeta el notch/status bar. onLayout mide
          el alto real (insets + fila) para anclar el dropdown del switch justo debajo. */}
      <YStack
        width="100%"
        paddingTop={insets.top}
        paddingHorizontal="$4"
        onLayout={(e) => setHeaderBottom(e.nativeEvent.layout.height)}
      >
        <HomeHeader
          activeName={activeField.name}
          isOpen={switcherOpen}
          highlight={switchHighlight}
          onSwitchPress={() => setSwitcherOpen((v) => !v)}
        />
      </YStack>

      <ScrollView
        flex={1}
        width="100%"
        maxWidth="100%"
        contentContainerStyle={{
          paddingHorizontal: getTokenValue('$4', 'space'),
          // El contenido nunca excede el ancho del ScrollView → sin scroll horizontal.
          width: '100%',
          maxWidth: '100%',
        }}
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
      >
        {/* Saludo. Nombre real del usuario (ProfileContext, fuente única — Fase 6). Mientras
            el perfil carga o no hay nombre, saludo NEUTRO (sin parpadear "Hola undefined"). */}
        <Text
          fontFamily="$body"
          fontSize="$9" lineHeight="$9"
          fontWeight="700"
          color="$textPrimary"
          marginTop="$4"
        >
          {!profileLoading && userFirstName ? `¡Hola ${userFirstName}! 👋` : '¡Hola! 👋'}
        </Text>

        {/* Banner descartable per-campo (Run 2 c): solo para el campo activo y solo si su id
            no fue descartado (persistido per-usuario). Al cerrar, se persiste el descarte. */}
        {bannerVisible ? (
          <ReadyBanner
            establishmentName={activeField.name}
            onDismiss={() => void dismissBanner()}
          />
        ) : null}

        {/* Mis rodeos (Inicio rodeo-céntrico, R2.1/R2.2): cards de rodeo del campo activo → vista de
            grupo. Es el corazón de la home: tocás un rodeo y ves su config + animales + acciones
            masivas. Cada card muestra el nombre + las cabezas activas (conteo local, offline). */}
        {rodeos.length > 0 ? (
          <YStack width="100%" marginTop="$6" gap="$3">
            <Text fontFamily="$body" fontSize="$6" lineHeight="$6" fontWeight="600" color="$textPrimary">
              Mis rodeos
            </Text>
            {rodeos.map((r) => (
              <GroupSummaryCard
                key={r.id}
                icon={RodeoIcon}
                name={r.name}
                headCount={rodeoHeadCounts.get(r.id) ?? 0}
                // Sistema productivo del rodeo (ej. "Cría") → "Cría · N cabezas" (R2.1). undefined si el
                // catálogo aún no resolvió → la card cae a solo cabezas (sin parpadeo de un · vacío).
                meta={systemNames.get(r.systemId)}
                onPress={() => openRodeo(r.id)}
              />
            ))}
          </YStack>
        ) : null}

        {/* Lotes (cards SECUNDARIAS, R2.1): grupos de manejo cross-rodeo (ADR-020). Solo aparecen si el
            campo tiene lotes. Cada card → vista de grupo del lote (/lote/[id]). */}
        {lotes.length > 0 ? (
          <YStack width="100%" marginTop="$6" gap="$3">
            <Text fontFamily="$body" fontSize="$6" lineHeight="$6" fontWeight="600" color="$textPrimary">
              Lotes
            </Text>
            {lotes.map((g) => (
              <GroupSummaryCard
                key={g.id}
                icon={LoteIcon}
                name={g.name}
                headCount={groupHeadCounts.get(g.id) ?? 0}
                onPress={() => openLote(g.id)}
              />
            ))}
          </YStack>
        ) : null}

        {/* Wizard de 3 pasos — "primeros pasos" (onboarding). Va DESPUÉS de los rodeos: es la guía de
            arranque, no el contenido principal de la home rodeo-céntrica. Se OCULTA cuando los 3 pasos
            están confirmados done (allStepsDone) → el usuario ya-onboardeado no lo ve. */}
        {allStepsDone ? null : (
          <YStack marginTop="$6" marginBottom="$8">
            <Stepper steps={steps} />
          </YStack>
        )}
      </ScrollView>

      {/* Dropdown del switch de establecimiento (R6.8.1). Se monta SOBRE todo (overlay
          absoluto con backdrop) al abrir; se ancla justo bajo el header (headerBottom).
          Vive al nivel de la raíz para que el backdrop cubra la pantalla completa. */}
      {switcherOpen ? (
        <EstablishmentSwitcherDropdown
          active={activeField}
          visited={visited}
          anchorTop={headerBottom}
          onClose={() => setSwitcherOpen(false)}
          onSelectActive={() => {
            // Tocar el campo activo no hace nada más que cerrar (R6.8.1).
          }}
          onSelectVisited={(field) => {
            // Fija el campo como activo (R6.3) + cambia el contexto multi-tenant (R6.8.1).
            // switchEstablishment promueve el saliente en el rastro de visitados (R6.9) y
            // dispara el re-render de la home con el campo nuevo (bug (a) de Raf). La home
            // sigue siendo la misma ruta; el contexto manda el nuevo activo.
            void switchEstablishment(field.id);
          }}
          onSeeAll={() => {
            // "Ver todos mis campos" → pantalla "Mis campos" (R6.6).
            router.push('/mis-campos');
          }}
          onCreate={() => {
            // "Crear nuevo campo +" → flujo de alta de establecimiento (R3.1) — bug (d) de Raf.
            router.push('/crear-campo');
          }}
        />
      ) : null}
    </YStack>
  );
}

/** Primer nombre del nombre completo guardado en el perfil (para el saludo). */
function firstNameOf(name: string | null): string | null {
  if (!name) return null;
  const first = name.trim().split(/\s+/)[0];
  return first || null;
}
