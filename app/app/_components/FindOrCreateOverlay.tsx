// FindOrCreateOverlay — host GLOBAL del flujo BLE de BUSCAR ANIMAL (spec 09 chunk "BLE global",
// RB1.2 / RB2 / RB3 / RB5 / RB6 / RB7). Montado hermano del <Stack> dentro de RootGate (_layout.tsx),
// sobre los providers de datos (Auth/PowerSync/Establishment/Rodeo) → puede scopear el lookup al campo
// activo y leer el rodeo default.
//
// "Ventana de la manga": el operario tiene una mano ocupada con el bastón, a veces con barro/sangre, y
// mira la pantalla <1s. UNA decisión por pantalla, EID legible a pleno sol, 1 CTA grande (≥56px, Fitts).
// Bottom-sheet sobre la pantalla activa (DEC-1): NO desmonta el contexto de fondo.
//
// Flujo:
//   useBleStickListener({ enabled, onTagRead })  — enabled = est.active && rodeo.active (RB2.1).
//   onTagRead(eid) → loading → lookupByTag(eid, establishmentId) → ready/error.
//   Live-rescan (RB3.5): un EID NUEVO descarta el lookup viejo en vuelo (guard de secuencia con ref) y
//   abre el nuevo, SIN cerrar el sheet — escanear-escanear-escanear es el ritmo del bastón.
//   Cerrar (RB3.4): estado null; el listener sigue (el provider nunca se desmonta).
//   Cambio de establishment con sheet abierto (RB2.4): cierra (el lookup se scopeó al campo del disparo).
//
// El listener se suspende solo (busyMode) cuando hay un form CREATE/EDIT abierto (useBusyWhileMounted en
// crear-animal/animal[id]/agregar-evento, Run 1) → un bastonazo no apila overlay sobre un form.
//
// Cero hardcode (ADR-023 §4): tokens + getTokenValue para íconos lucide. Voseo es-AR.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getTokenValue, ScrollView, Text, View, XStack, YStack } from 'tamagui';
import { useRouter, useSegments } from 'expo-router';
import { useStatus } from '@powersync/react';
import { ArrowRightLeft, ChevronRight, PlusCircle, Radio, Search, Tag, X } from 'lucide-react-native';

import { Button, Card, CategoryBadge } from '@/components';
import { useAuth, useEstablishment, useRodeo } from '@/contexts';
import { useBleStickListener } from '@/services/ble/stick';
import {
  assignTagToAnimal,
  fetchAnimalDetail,
  fetchAnimals,
  lookupByTag,
  newTransferTargetProfileId,
  searchAnimals,
  transferAnimal,
  type AnimalDetail,
  type AnimalListItem,
  type TagLookupResult,
} from '@/services/animals';
import { runLocalQuery, runLocalQuerySingle } from '@/services/powersync/local-query';
import {
  buildCategoryIdByCodeQuery,
  buildNoTagCandidatesCountQuery,
} from '@/services/powersync/local-reads';
import { resolveCreateOrAssign } from '@/services/tag-lookup';
import { readLastRodeo, queryLastUsedRodeoFromDb, resolveDefaultRodeoId } from '@/services/last-rodeo';
import { TRANSFER_OFFLINE_MESSAGE } from '@/services/transfer-animal';
import { formatEidReadable } from '@/utils/eid-format';
import { buttonA11y, labelA11y } from '@/utils/a11y';

// El cuerpo resuelto del sheet para un lookup `mode:'create'` (opción A del chunk dedup): o la intermedia
// `assign_or_create` (≥1 candidato sin caravana), o el `create` directo (0 candidatos, RD3.2). Se resuelve
// en el host (tras una lectura local del conteo) y se guarda en el estado ready — NO toca el `TagLookupResult`
// puro del service (que sigue con sus 3 modos edit/transfer/create).
type ResolvedBody = TagLookupResult | { mode: 'assign_or_create' };

type OverlayState =
  | null
  | { eid: string; status: 'loading' }
  | { eid: string; status: 'ready'; result: ResolvedBody }
  | { eid: string; status: 'error'; message: string };

/**
 * Espera (best-effort) a que el perfil nuevo de un transfer BAJE por la stream al SQLite local antes de
 * navegar a su ficha (RB7.4). El RPC `transfer_animal` crea la fila server-side; la ficha (`/animal/[id]`)
 * lee con `fetchAnimalDetail` (LOCAL, emptyIsSyncing:false) → si navegáramos al instante mostraría
 * "No se encontró el animal" hasta que el sync lo trae (segundos). Polleamos `fetchAnimalDetail` hasta
 * que aparezca o se agote el presupuesto; si no llega a tiempo, navegamos igual (la ficha reintenta al
 * enfocar). El transfer es ONLINE-only → el sync está activo, así que el perfil baja enseguida.
 */
async function waitForProfileLocally(profileId: string, tries = 20, delayMs = 400): Promise<void> {
  for (let i = 0; i < tries; i++) {
    const res = await fetchAnimalDetail(profileId);
    if (res.ok) return;
    await new Promise((r) => setTimeout(r, delayMs));
  }
}

// Ruta de la pantalla de asignación MASIVA (spec 09 chunk dedup opción B, RD5). Mientras esa pantalla
// está montada, ESTE overlay global NO debe abrirse por un bastoneo: la pantalla masiva maneja los EIDs
// con su PROPIO listener (anti-stacking, design §4.2). Suprimimos por ruta (no por `busyMode`, que en el
// provider gatea TODO el listener incl. el de la masiva) — la vía que NO toca `ble/*`.
const BULK_ASSIGN_ROUTE = 'asignar-caravanas';

export function FindOrCreateOverlay() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { state: auth } = useAuth();
  const { state: est } = useEstablishment();
  const { state: rodeo } = useRodeo();
  const syncStatus = useStatus();
  const segments = useSegments();

  // ¿Estamos en la pantalla de asignación masiva? (top-segment de la ruta activa). Si sí, el overlay no
  // procesa bastoneos (la pantalla masiva los consume). Ref para leerlo dentro del callback sin re-crearlo.
  const onBulkAssignRoute = (segments[0] ?? '') === BULK_ASSIGN_ROUTE;
  const onBulkAssignRouteRef = useRef(onBulkAssignRoute);
  onBulkAssignRouteRef.current = onBulkAssignRoute;

  const establishmentId = est.status === 'active' ? est.current.id : null;
  const activeFieldName = est.status === 'active' ? est.current.name : '';
  const userId = auth.status === 'authenticated' ? auth.user.id : null;
  // RB2.1: el host solo dispara con campo activo fijado Y rodeo existente (hay sobre qué crear/transferir).
  const enabled = est.status === 'active' && rodeo.status === 'active';
  const isOnline = syncStatus.connected === true;

  const [state, setState] = useState<OverlayState>(null);
  // Guard de secuencia (RB3.5 live-rescan): cada bastonazo incrementa el ticket; un lookup que resuelve
  // tarde solo aplica si su ticket sigue siendo el último (un EID nuevo lo descartó).
  const seqRef = useRef(0);
  // El establishment del disparo: si cambia mientras el lookup está en vuelo / el sheet abierto, descartamos.
  const lookupEstablishmentRef = useRef<string | null>(null);

  const close = useCallback(() => {
    seqRef.current += 1; // invalida cualquier lookup en vuelo
    setState(null);
  }, []);

  // ─── Disparo del overlay (RB3.1): EID validado+dedupeado del provider → lookup local ───
  const onTagRead = useCallback(
    (eid: string) => {
      if (!establishmentId) return; // defensa: enabled ya lo gatea, pero no disparamos sin campo
      // Anti-stacking (design §4.2 / RD5.2): si la pantalla de asignación masiva está activa, ELLA maneja
      // el bastoneo con su propio listener → el overlay global NO abre nada (sería doble proceso del EID).
      if (onBulkAssignRouteRef.current) return;
      const ticket = ++seqRef.current;
      lookupEstablishmentRef.current = establishmentId;
      setState({ eid, status: 'loading' });
      void (async () => {
        const res = await lookupByTag(eid, establishmentId);
        // Live-rescan / cierre / cambio de campo: solo aplicamos si seguimos siendo el último bastonazo.
        if (seqRef.current !== ticket) return;
        if (!res.ok) {
          setState({ eid, status: 'error', message: res.error.message });
          return;
        }
        // Opción A (RD3.1/RD3.2/RD8): SOLO la rama `create` (EID sin match en ningún campo del usuario) abre
        // la intermedia "¿es uno de tus animales sin caravana?". edit/transfer NO cambian. La intermedia es
        // EXCLUSIVA de la puerta BLE (RD3.8: la puerta manual ya va directo a CREATE en otro flujo).
        if (res.value.mode === 'create') {
          // Una lectura LOCAL más (RD8.2, sin red): conteo de candidatos noTag del campo activo. La decisión
          // (intermedia vs CREATE directo) es PURA (resolveCreateOrAssign). Si la lectura falla, fail-safe a
          // CREATE directo (nunca bloqueamos el alta por no poder contar candidatos).
          const countRes = await runLocalQuerySingle<{ count: number }>(
            buildNoTagCandidatesCountQuery(establishmentId),
            { emptyIsSyncing: false },
          );
          // Re-chequeo del guard tras el await (otro bastonazo / cierre / cambio de campo pudo invalidar).
          if (seqRef.current !== ticket) return;
          const count = countRes.ok ? (countRes.value?.count ?? 0) : 0;
          setState({ eid, status: 'ready', result: resolveCreateOrAssign(count) });
          return;
        }
        setState({ eid, status: 'ready', result: res.value });
      })();
    },
    [establishmentId],
  );

  useBleStickListener({ enabled, onTagRead });

  // ─── RB2.4: cambio de establishment activo con el overlay abierto → cerrar (no mostrar stale) ───
  useEffect(() => {
    if (state === null) return;
    if (lookupEstablishmentRef.current !== null && lookupEstablishmentRef.current !== establishmentId) {
      close();
    }
  }, [establishmentId, state, close]);

  // ─── Anti-stacking (design §4.2 / RD5.2): si entramos a la pantalla de asignación masiva con el overlay
  // abierto (p. ej. un live-rescan lo abrió justo antes de navegar), lo cerramos — esa pantalla maneja los
  // bastoneos por su cuenta y no debe quedar un sheet stale encima. ───
  useEffect(() => {
    if (onBulkAssignRoute && state !== null) close();
  }, [onBulkAssignRoute, state, close]);

  if (state === null) return null;

  const eidReadable = formatEidReadable(state.eid);

  return (
    <View
      position="absolute"
      top="$0"
      left="$0"
      right="$0"
      bottom="$0"
      backgroundColor="$scrim"
      justifyContent="flex-end"
    >
      {/* Backdrop tappable: cierra (RB3.4). Cubre el área por encima del sheet. */}
      <Pressable style={{ flex: 1, width: '100%' }} onPress={close} {...buttonA11y(Platform.OS, { label: 'Cerrar' })} />

      <YStack
        width="100%"
        maxHeight="85%"
        backgroundColor="$bg"
        borderTopLeftRadius="$card"
        borderTopRightRadius="$card"
        paddingHorizontal="$4"
        paddingTop="$4"
        // Safe-area inferior (RB3.3): el CTA primario de la manga NO debe quedar bajo el home
        // indicator iOS / barra de gestos Android. Mismo idiom que crear-animal/agregar-evento:
        // inset + baseline $6 → SIEMPRE >= insets.bottom (nunca menor al inset del sistema).
        paddingBottom={insets.bottom + getTokenValue('$6', 'space')}
        gap="$4"
      >
        {/* Grip visual del sheet. */}
        <View
          alignSelf="center"
          width={getTokenValue('$icon', 'size')}
          height={getTokenValue('$progressTrack', 'size')}
          borderRadius="$pill"
          backgroundColor="$divider"
        />

        {/* Encabezado SIEMPRE = el EID leído, formateado legible (RB3.2: confirmación visual SENASA). */}
        <XStack alignItems="center" gap="$3">
          <Radio size={getTokenValue('$navIcon', 'size')} color={getTokenValue('$primary', 'color')} strokeWidth={2.25} />
          <YStack flex={1} gap="$1">
            <Text fontFamily="$body" fontSize="$2" fontWeight="500" color="$textMuted">
              Caravana leída
            </Text>
            <Text
              fontFamily="$body"
              fontSize="$8" lineHeight="$8"
              fontWeight="700"
              color="$textPrimary"
              letterSpacing={1}
              {...labelA11y(Platform.OS, `Caravana ${eidReadable}`)}
            >
              {eidReadable}
            </Text>
          </YStack>
          <Pressable onPress={close} {...buttonA11y(Platform.OS, { label: 'Cerrar' })}>
            <X size={getTokenValue('$navIcon', 'size')} color={getTokenValue('$textMuted', 'color')} strokeWidth={2.25} />
          </Pressable>
        </XStack>

        {state.status === 'loading' ? (
          <OverlayLoading />
        ) : state.status === 'error' ? (
          <OverlayError message={state.message} onClose={close} />
        ) : (
          <OverlayBody
            eid={state.eid}
            result={state.result}
            activeFieldName={activeFieldName}
            establishmentId={establishmentId}
            userId={userId}
            isOnline={isOnline}
            onClose={close}
          />
        )}
      </YStack>
    </View>
  );
}

// ─── Estado de carga del lookup (local, casi instantáneo; defensivo para sets grandes) ───
function OverlayLoading() {
  return (
    <Card>
      <Text fontFamily="$body" fontSize="$4" fontWeight="500" color="$textMuted">
        Buscando el animal…
      </Text>
    </Card>
  );
}

function OverlayError({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <YStack gap="$3">
      <Card backgroundColor="$surface" borderWidth={1} borderColor="$terracota">
        <Text fontFamily="$body" fontSize="$4" fontWeight="500" color="$textPrimary">
          {message}
        </Text>
      </Card>
      <Button variant="secondary" fullWidth onPress={onClose}>
        Cerrar
      </Button>
    </YStack>
  );
}

// ─── Cuerpo del sheet por modo (una decisión por pantalla, RB3.3) ───
function OverlayBody({
  eid,
  result,
  activeFieldName,
  establishmentId,
  userId,
  isOnline,
  onClose,
}: {
  eid: string;
  result: ResolvedBody;
  activeFieldName: string;
  establishmentId: string | null;
  userId: string | null;
  isOnline: boolean;
  onClose: () => void;
}) {
  if (result.mode === 'edit') {
    return <EditBody profileId={result.profileId} onClose={onClose} />;
  }
  if (result.mode === 'create') {
    return <CreateBody eid={eid} onClose={onClose} />;
  }
  // Opción A (RD3): la intermedia "¿es uno de tus animales sin caravana?" — solo cuando el host computó
  // ≥1 candidato noTag para un lookup `create` (RD3.1). 0 candidatos ya cayó a `create` arriba (RD3.2).
  // `key={eid}`: un live-rescan (RD4.2) con un EID DISTINTO debe RESETEAR el cuerpo (su búsqueda + el
  // candidato a confirmar) — sin el key, React preservaría el sub-estado `confirming` del EID viejo mientras
  // el prop `eid` cambia, y el operario asignaría el EID NUEVO al candidato del flujo VIEJO sin re-confirmar.
  if (result.mode === 'assign_or_create') {
    return <AssignOrCreateBody key={eid} eid={eid} establishmentId={establishmentId} onClose={onClose} />;
  }
  return (
    <TransferBody
      eid={eid}
      sourceProfileId={result.sourceProfileId}
      otherFieldName={result.otherFieldName}
      activeFieldName={activeFieldName}
      establishmentId={establishmentId}
      userId={userId}
      isOnline={isOnline}
      onClose={onClose}
    />
  );
}

// ─── Modo EDIT (RB5): card del animal + "Ver ficha" ───
function EditBody({ profileId, onClose }: { profileId: string; onClose: () => void }) {
  const router = useRouter();
  const [detail, setDetail] = useState<AnimalDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void fetchAnimalDetail(profileId).then((res) => {
      if (!active) return;
      if (res.ok) setDetail(res.value);
      else setLoadError(res.error.message);
    });
    return () => {
      active = false;
    };
  }, [profileId]);

  const onView = useCallback(() => {
    onClose();
    router.push({ pathname: '/animal/[id]', params: { id: profileId } });
  }, [router, profileId, onClose]);

  const hero = detail ? (detail.idv ?? detail.visualIdAlt ?? detail.tagElectronic ?? 'Animal') : '';
  const sexLabel = detail ? (detail.sex === 'male' ? 'Macho' : 'Hembra') : '';

  return (
    <YStack gap="$4">
      <Card gap="$2">
        {loadError ? (
          <Text fontFamily="$body" fontSize="$4" fontWeight="500" color="$textPrimary">
            {loadError}
          </Text>
        ) : detail === null ? (
          <Text fontFamily="$body" fontSize="$4" fontWeight="500" color="$textMuted">
            Cargando datos del animal…
          </Text>
        ) : (
          <YStack gap="$2">
            <Text fontFamily="$body" fontSize="$7" lineHeight="$7" fontWeight="700" color="$textPrimary">
              {hero}
            </Text>
            <CategoryBadge label={detail.categoryName} manual={detail.categoryOverride} size="md" />
            <XStack flexWrap="wrap" gap="$2">
              <MetaPill text={sexLabel} />
              <MetaPill text={detail.rodeoName} />
            </XStack>
          </YStack>
        )}
      </Card>
      <Button variant="primary" fullWidth onPress={onView}>
        Ver ficha
      </Button>
    </YStack>
  );
}

// ─── Modo CREATE (RB6): "Animal nuevo" + "Dar de alta" → /crear-animal con el TAG precargado ───
function CreateBody({ eid, onClose }: { eid: string; onClose: () => void }) {
  const router = useRouter();
  const onCreate = useCallback(() => {
    onClose();
    router.push({ pathname: '/crear-animal', params: { tag: eid } });
  }, [router, eid, onClose]);

  return (
    <YStack gap="$4">
      <Card gap="$2">
        <XStack alignItems="center" gap="$2">
          <PlusCircle size={getTokenValue('$dot', 'size')} color={getTokenValue('$primary', 'color')} strokeWidth={2.5} />
          <Text fontFamily="$body" fontSize="$6" lineHeight="$6" fontWeight="700" color="$textPrimary">
            Animal nuevo
          </Text>
        </XStack>
        <Text fontFamily="$body" fontSize="$3" fontWeight="400" color="$textMuted">
          No hay ningún animal con esta caravana en tus campos. Dalo de alta con la caravana ya cargada.
        </Text>
      </Card>
      <Button variant="primary" fullWidth onPress={onCreate}>
        Dar de alta
      </Button>
    </YStack>
  );
}

// ─── Modo ASSIGN_OR_CREATE (opción A del chunk dedup, RD3): "¿es uno de tus animales sin caravana?" ───
//
// Pantalla MANGA-CRÍTICA (RD3.3-RD3.7): el operario bastoneó un EID que no matchea ningún animal con
// caravana, pero el campo tiene ≥1 animal SIN caravana (cargado solo con visual/IDV). En vez de ir directo
// a CREATE, le ofrecemos asignarle el EID a uno de esos candidatos. Layout de una-decisión-por-pantalla:
//   - Título accionable arriba (el EID legible ya lo pinta el host = confirmación SENASA).
//   - Buscador (RD3.4): searchAnimals scopeado a noTag (filtra IDV/visual).
//   - Lista SCROLLABLE de candidatos (RD3.5): idv/visual/category/sex/rodeo, recientes primero (updated_at).
//   - CTA grande SIEMPRE visible "Es un animal nuevo → dar de alta" (RD3.7) — PINNED fuera del scroll (Fitts).
// Tocar un candidato → confirmación ("Asignar caravana <EID> a este animal") → assignTagToAnimal(profileId,
// eid) (offline, RD3.6) → cerrar + navegar a la ficha. "Es nuevo" → /crear-animal?tag=<eid> (idéntico a CREATE).
function AssignOrCreateBody({
  eid,
  establishmentId,
  onClose,
}: {
  eid: string;
  establishmentId: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const eidReadable = formatEidReadable(eid);

  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [candidates, setCandidates] = useState<AnimalListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // El candidato elegido (paso de confirmación) — null = lista; no-null = "Asignar caravana a este animal".
  const [confirming, setConfirming] = useState<AnimalListItem | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);
  // Guard de secuencia de la búsqueda (mismo idiom que la tab Animales): una búsqueda que resuelve tarde
  // solo aplica si sigue siendo la última (un nuevo término la descartó).
  const searchSeq = useRef(0);

  // Debounce del término (250ms, mismo que la tab Animales).
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(t);
  }, [query]);

  // Carga de la lista (RD4.1: 100% local, scopeada al campo activo). Sin término → todos los candidatos
  // noTag (updated_at DESC, RD3.3). Con término → searchAnimals + filtro client-side a noTag (design §3.4:
  // el filtro client-side por tagElectronic IS NULL es más simple y suficiente para MVP).
  useEffect(() => {
    if (!establishmentId) return;
    const seq = ++searchSeq.current;
    setLoading(true);
    setLoadError(null);
    const q = debounced.trim();
    void (async () => {
      const res = q.length === 0
        ? await fetchAnimals(establishmentId, { noTag: true, orderBy: 'updated_at' })
        : await searchAnimals(establishmentId, q);
      if (seq !== searchSeq.current) return; // descartado por un término más nuevo / desmontaje lógico
      setLoading(false);
      if (!res.ok) {
        setLoadError('No pudimos cargar tus animales sin caravana.');
        setCandidates([]);
        return;
      }
      // Solo candidatos SIN caravana (RD3.3): la lista ya filtra noTag; la búsqueda se filtra acá (puede
      // traer animales con caravana que matchean el término — los excluimos).
      setCandidates(res.value.filter((a) => a.tagElectronic == null));
    })();
  }, [establishmentId, debounced]);

  const onAssign = useCallback(async () => {
    if (!confirming) return;
    setAssigning(true);
    setAssignError(null);
    const res = await assignTagToAnimal(confirming.profileId, eid);
    if (!res.ok) {
      // El encolado offline casi nunca falla (devuelve la intención). Si falla, surfaceamos sin cerrar.
      setAssigning(false);
      setAssignError('No pudimos asignar la caravana. Probá de nuevo.');
      return;
    }
    // Éxito del ENCOLADO (offline-first, RD3.6): cerramos y navegamos a la ficha. El UPDATE real lo aplica el
    // RPC al sincronizar; la ficha lee el denorm local (que se actualiza al bajar la propagación 0079).
    const profileId = confirming.profileId;
    onClose();
    router.push({ pathname: '/animal/[id]', params: { id: profileId } });
  }, [confirming, eid, onClose, router]);

  const onCreateNew = useCallback(() => {
    onClose();
    router.push({ pathname: '/crear-animal', params: { tag: eid } });
  }, [onClose, router, eid]);

  // ── Paso de CONFIRMACIÓN: "Asignar caravana <EID> a este animal" (RD3.6) ──
  if (confirming) {
    return (
      <YStack gap="$4">
        <Card gap="$3">
          <XStack alignItems="center" gap="$2">
            <Tag size={getTokenValue('$dot', 'size')} color={getTokenValue('$primary', 'color')} strokeWidth={2.5} />
            <Text fontFamily="$body" fontSize="$6" lineHeight="$6" fontWeight="700" color="$textPrimary">
              Asignar caravana
            </Text>
          </XStack>
          <Text fontFamily="$body" fontSize="$4" fontWeight="500" color="$textMuted">
            Le vas a asignar la caravana{' '}
            <Text fontWeight="700" color="$textPrimary" letterSpacing={1}>{eidReadable}</Text>{' '}
            a este animal:
          </Text>
          <CandidateSummary candidate={confirming} />
          {assignError ? (
            <Text fontFamily="$body" fontSize="$3" fontWeight="500" color="$terracota">
              {assignError}
            </Text>
          ) : null}
        </Card>
        <Button
          variant="primary"
          fullWidth
          disabled={assigning}
          onPress={() => {
            void onAssign();
          }}
        >
          {assigning ? 'Asignando…' : 'Asignar caravana'}
        </Button>
        <Button variant="secondary" fullWidth disabled={assigning} onPress={() => setConfirming(null)}>
          Volver
        </Button>
      </YStack>
    );
  }

  // ── Lista de candidatos + buscador + CTA "es nuevo" ──
  return (
    <YStack gap="$3">
      <Text fontFamily="$body" fontSize="$6" lineHeight="$6" fontWeight="700" color="$textPrimary">
        ¿Es uno de tus animales sin caravana?
      </Text>

      {/* Buscador (RD3.4): filtra la lista por IDV/visual. */}
      <CandidateSearchBar value={query} onChangeText={setQuery} />

      {/* Lista SCROLLABLE (RD3.5): el CTA "es nuevo" queda PINNED abajo, fuera del scroll (RD3.7 / Fitts). */}
      <ScrollView
        // Tope de alto para que el buscador y el CTA "es nuevo" SIEMPRE queden visibles (manga, una mano).
        maxHeight={getTokenValue('$candidateListMax', 'size')}
        showsVerticalScrollIndicator
        keyboardShouldPersistTaps="handled"
      >
        {loading ? (
          <Text fontFamily="$body" fontSize="$4" fontWeight="500" color="$textMuted" paddingVertical="$3">
            Buscando…
          </Text>
        ) : loadError ? (
          <Text fontFamily="$body" fontSize="$4" fontWeight="500" color="$terracota" paddingVertical="$3">
            {loadError}
          </Text>
        ) : candidates.length === 0 ? (
          <Text fontFamily="$body" fontSize="$4" fontWeight="500" color="$textMuted" paddingVertical="$3">
            {debounced.trim().length > 0
              ? 'Ningún animal sin caravana coincide con la búsqueda.'
              : 'No hay animales sin caravana en este campo.'}
          </Text>
        ) : (
          <YStack gap="$2">
            {candidates.map((c) => (
              <CandidateRow key={c.profileId} candidate={c} onPress={() => setConfirming(c)} />
            ))}
          </YStack>
        )}
      </ScrollView>

      {/* CTA grande SIEMPRE visible (RD3.7): el animal NO está en la lista → darlo de alta con el EID. */}
      <Button variant="secondary" fullWidth onPress={onCreateNew}>
        Es un animal nuevo → dar de alta
      </Button>
    </YStack>
  );
}

// ─── Buscador de candidatos (mismo idiom que la tab Animales; API RN TextInput, estilos via token) ───
function CandidateSearchBar({
  value,
  onChangeText,
}: {
  value: string;
  onChangeText: (t: string) => void;
}) {
  const muted = getTokenValue('$textMuted', 'color');
  const textPrimary = getTokenValue('$textPrimary', 'color');
  const fontSize = getTokenValue('$inputText', 'size');
  return (
    <XStack
      width="100%"
      minHeight="$searchBarLg"
      alignItems="center"
      gap="$3"
      backgroundColor="$surface"
      borderWidth={1}
      borderColor="$divider"
      borderRadius="$pill"
      paddingHorizontal="$4"
      paddingVertical="$2"
    >
      <Search size={getTokenValue('$dot', 'size')} color={muted} strokeWidth={2} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder="Buscar por número o visual"
        placeholderTextColor={muted}
        accessibilityLabel="Buscar animal sin caravana por número o visual"
        autoCorrect={false}
        autoCapitalize="none"
        style={{ flex: 1, color: textPrimary, fontFamily: 'Inter', fontSize }}
      />
    </XStack>
  );
}

// ─── Fila de un candidato (RD3.5): idv/visual + categoría + sexo + rodeo, escaneable de un vistazo ───
function CandidateRow({
  candidate,
  onPress,
}: {
  candidate: AnimalListItem;
  onPress: () => void;
}) {
  // Hero: IDV si existe, si no el visual, si no un genérico (siempre hay algo que mostrar).
  const hero = candidate.idv ?? candidate.visualIdAlt ?? 'Sin identificación';
  const sexLabel = candidate.sex === 'male' ? 'Macho' : 'Hembra';
  // Chevron de afford de tap (patrón Jakob de fila tappable iOS/Android): a pleno sol, una mano,
  // <1s, deja inequívoco que TOCAR el candidato asigna la caravana. Decoración lateral DERECHA
  // indiferente al contenido (ADR-027): el hero/metadata quedan a la izquierda en `flex={1}` y el
  // chevron es un hermano de ancho fijo (`flexShrink={0}`) → NO empuja ni recorta el hero, y NO le
  // roba área de tap a la fila (todo el `Pressable` sigue tappable). Tamaño/color via token
  // (ADR-023 §4): `$navIcon` = tamaño de ícono estándar (idéntico a AnimalRow), color `$textMuted`.
  const chevronSize = getTokenValue('$navIcon', 'size');
  const chevronColor = getTokenValue('$textMuted', 'color');
  const a11y = buttonA11y(Platform.OS, {
    label: `Asignar caravana a ${hero}, ${candidate.categoryName}, ${sexLabel}, ${candidate.rodeoName}`,
  });
  return (
    <Pressable onPress={onPress} {...a11y}>
      <Card>
        <XStack alignItems="center" gap="$3">
          <YStack flex={1} gap="$2">
            <XStack alignItems="center" justifyContent="space-between" gap="$2">
              <Text fontFamily="$body" fontSize="$6" lineHeight="$6" fontWeight="700" color="$textPrimary" numberOfLines={1}>
                {hero}
              </Text>
              {candidate.visualIdAlt && candidate.idv ? (
                <Text fontFamily="$body" fontSize="$3" fontWeight="500" color="$textMuted" numberOfLines={1}>
                  {candidate.visualIdAlt}
                </Text>
              ) : null}
            </XStack>
            <CategoryBadge label={candidate.categoryName} size="sm" />
            <XStack flexWrap="wrap" gap="$2">
              <MetaPill text={sexLabel} />
              <MetaPill text={candidate.rodeoName} />
            </XStack>
          </YStack>
          <View flexShrink={0} alignSelf="center">
            <ChevronRight size={chevronSize} color={chevronColor} strokeWidth={2} />
          </View>
        </XStack>
      </Card>
    </Pressable>
  );
}

// ─── Resumen del candidato en el paso de confirmación (sin Pressable: solo info) ───
function CandidateSummary({ candidate }: { candidate: AnimalListItem }) {
  const hero = candidate.idv ?? candidate.visualIdAlt ?? 'Sin identificación';
  const sexLabel = candidate.sex === 'male' ? 'Macho' : 'Hembra';
  return (
    <YStack
      gap="$2"
      backgroundColor="$surface"
      borderWidth={1}
      borderColor="$divider"
      borderRadius="$card"
      padding="$3"
    >
      <Text fontFamily="$body" fontSize="$6" lineHeight="$6" fontWeight="700" color="$textPrimary" numberOfLines={1}>
        {hero}
      </Text>
      <CategoryBadge label={candidate.categoryName} size="sm" />
      <XStack flexWrap="wrap" gap="$2">
        <MetaPill text={sexLabel} />
        <MetaPill text={candidate.rodeoName} />
      </XStack>
    </YStack>
  );
}

// ─── Modo TRANSFER (RB7, online-only): "Está en [otro campo]" + "Transferir a [campo activo]" ───
function TransferBody({
  eid,
  sourceProfileId,
  otherFieldName,
  activeFieldName,
  establishmentId,
  userId,
  isOnline,
  onClose,
}: {
  eid: string;
  sourceProfileId: string;
  otherFieldName: string;
  activeFieldName: string;
  establishmentId: string | null;
  userId: string | null;
  isOnline: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const { state: rodeo } = useRodeo();
  const [submitting, setSubmitting] = useState(false);
  const [transferError, setTransferError] = useState<string | null>(null);
  // Éxito con IDV caído (RB7.4): el transfer aplicó pero el idv colisionó en el destino → quedó NULL.
  // En vez de navegar a ciegas, mostramos el aviso accionable en el MISMO sheet con un CTA a la ficha
  // (la ficha de spec 02/11 no lee un param de aviso → lo damos acá, sin tocar scope ajeno).
  const [doneProfileId, setDoneProfileId] = useState<{ id: string; idvDropped: boolean } | null>(null);
  // El targetProfileId se genera UNA vez por intent (idempotencia, spec 11 R6.2): estable entre reintentos.
  const targetProfileIdRef = useRef<string>(newTransferTargetProfileId());

  const goToNewProfile = useCallback(
    (id: string) => {
      onClose();
      router.push({ pathname: '/animal/[id]', params: { id } });
    },
    [router, onClose],
  );

  const onTransfer = useCallback(async () => {
    if (!establishmentId || rodeo.status !== 'active') return;
    setSubmitting(true);
    setTransferError(null);

    // 1) Rodeo DESTINO: el default del campo activo (lastRodeoSelected → último usado → primer activo).
    const available = rodeo.available;
    const persisted = userId ? await readLastRodeo(userId, establishmentId) : null;
    const dbLastUsedRes = await queryLastUsedRodeoFromDb(establishmentId);
    const dbLastUsed = dbLastUsedRes.ok ? dbLastUsedRes.value : null;
    const targetRodeoId = resolveDefaultRodeoId(
      available.map((r) => r.id),
      persisted,
      dbLastUsed,
    );
    const targetRodeo = available.find((r) => r.id === targetRodeoId);
    if (!targetRodeo) {
      setSubmitting(false);
      setTransferError('No hay un rodeo disponible en el campo activo para recibir el animal.');
      return;
    }

    // 2) Categoría DESTINO: leemos la categoría del perfil de ORIGEN (sincronizado local) y la resolvemos
    //    por CÓDIGO en el sistema del rodeo destino (buildCategoryIdByCodeQuery). En MVP (un solo sistema)
    //    el code resuelve a la misma fila; si los sistemas difieren, mapea por código. Si NO resuelve →
    //    PARAMOS con un error accionable (NO inventamos un default — design §10.3 / regla del leader).
    const sourceDetailRes = await fetchAnimalDetail(sourceProfileId);
    if (!sourceDetailRes.ok) {
      setSubmitting(false);
      setTransferError(sourceDetailRes.error.message);
      return;
    }
    const sourceCategoryCode = sourceDetailRes.value.categoryCode;
    const catRes = await runLocalQuery<{ id: string }>(
      buildCategoryIdByCodeQuery(targetRodeo.systemId, sourceCategoryCode),
      { emptyIsSyncing: false },
    );
    if (!catRes.ok) {
      setSubmitting(false);
      setTransferError(catRes.error.message);
      return;
    }
    if (catRes.value.length === 0) {
      setSubmitting(false);
      setTransferError(
        'No se pudo determinar la categoría del animal en el campo de destino. Revisá que el rodeo sea del mismo sistema.',
      );
      return;
    }
    const targetCategoryId = catRes.value[0].id;

    // 3) Transfer (online-only; el RPC deriva origen + animal_id de la fila real, anti-IDOR).
    const res = await transferAnimal({
      sourceProfileId,
      targetEstablishmentId: establishmentId,
      targetRodeoId: targetRodeo.id,
      targetProfileId: targetProfileIdRef.current,
      targetCategoryId,
    });

    if (!res.ok) {
      // Copy accionable de classifyTransferError (nunca sqlerrm crudo); el sheet queda abierto para reintentar.
      setSubmitting(false);
      setTransferError(res.error.message);
      return;
    }

    // El RPC aplicó server-side; esperamos a que el perfil nuevo BAJE al SQLite local antes de navegar a su
    // ficha (la ficha lee LOCAL → sin esto mostraría "No se encontró el animal" hasta que el sync lo trae).
    await waitForProfileLocally(res.value.targetProfileId);
    setSubmitting(false);

    if (res.value.idvDropped) {
      // RB7.4: el idv colisionó en el destino → quedó NULL. Avisamos en el sheet ANTES de navegar.
      setDoneProfileId({ id: res.value.targetProfileId, idvDropped: true });
    } else {
      goToNewProfile(res.value.targetProfileId);
    }
  }, [establishmentId, rodeo, userId, sourceProfileId, goToNewProfile]);

  // RB7.4: éxito con IDV caído → aviso accionable + CTA a la ficha nueva.
  if (doneProfileId) {
    return (
      <YStack gap="$4">
        <Card backgroundColor="$surface" borderWidth={1} borderColor="$divider" gap="$2">
          <Text fontFamily="$body" fontSize="$6" lineHeight="$6" fontWeight="700" color="$textPrimary">
            Animal transferido
          </Text>
          <Text fontFamily="$body" fontSize="$4" fontWeight="500" color="$terracota">
            El IDV quedó vacío porque ya existía en {activeFieldName}. Completá el IDV en el campo nuevo desde la ficha.
          </Text>
        </Card>
        <Button variant="primary" fullWidth onPress={() => goToNewProfile(doneProfileId.id)}>
          Ver ficha
        </Button>
      </YStack>
    );
  }

  return (
    <YStack gap="$4">
      <Card gap="$2">
        <XStack alignItems="center" gap="$2">
          <ArrowRightLeft size={getTokenValue('$dot', 'size')} color={getTokenValue('$terracota', 'color')} strokeWidth={2.5} />
          <Text fontFamily="$body" fontSize="$6" lineHeight="$6" fontWeight="700" color="$textPrimary">
            Está en otro campo
          </Text>
        </XStack>
        <Text fontFamily="$body" fontSize="$4" fontWeight="500" color="$textMuted">
          Este animal está activo en <Text fontWeight="700" color="$textPrimary">{otherFieldName}</Text>. Transferilo a{' '}
          <Text fontWeight="700" color="$textPrimary">{activeFieldName}</Text> para traerlo acá con toda su historia.
        </Text>
        {!isOnline ? (
          <Text fontFamily="$body" fontSize="$3" fontWeight="500" color="$terracota">
            {TRANSFER_OFFLINE_MESSAGE}
          </Text>
        ) : null}
        {transferError ? (
          <Text fontFamily="$body" fontSize="$3" fontWeight="500" color="$terracota">
            {transferError}
          </Text>
        ) : null}
      </Card>
      <Button
        variant="primary"
        fullWidth
        disabled={!isOnline || submitting}
        onPress={() => {
          void onTransfer();
        }}
      >
        {submitting ? 'Transfiriendo…' : 'Transferir a este campo'}
      </Button>
      <Button variant="secondary" fullWidth disabled={submitting} onPress={onClose}>
        Cancelar
      </Button>
    </YStack>
  );
}

// ─── Pill de metadato de la card edit (sexo / rodeo) ───
function MetaPill({ text }: { text: string }) {
  if (!text) return null;
  return (
    <View backgroundColor="$surface" borderRadius="$pill" paddingHorizontal="$3" paddingVertical="$1" borderWidth={1} borderColor="$divider">
      <Text fontFamily="$body" fontSize="$2" fontWeight="600" color="$textMuted">
        {text}
      </Text>
    </View>
  );
}
