// app/asignar-caravanas.tsx — BulkTagAssignmentScreen: asignación MASIVA de caravanas (spec 09 chunk
// "09 resto · dedup A/B", opción B / RD5). El operario bastonea el rodeo EN SERIE y, para cada EID,
// elige el candidato sin caravana al que se la asigna. Una decisión por pantalla, contador de sesión.
//
// Pantalla MANGA-CRÍTICA (🔴): se usa SÍ o SÍ en el corral, caravaneando todo el rodeo en serie, una
// mano, sol, SIN red (RD5.7). Ritmo bastón→elegir→siguiente fluido; targets XL; cero hardcode (tokens,
// ADR-023 §4). Voseo es-AR.
//
// ─── Anti-stacking con el overlay GLOBAL (design §4.2 / RD5.2) ───────────────────────────────────────
// Mientras esta pantalla está montada, el `FindOrCreateOverlay` global NO debe abrirse por el mismo
// bastoneo (sería doble proceso del EID). El mecanismo de spec 04 `useBusyWhileMounted()` NO sirve acá:
// pone el listener global en `busy=true`, que en el provider gatea `listening = enabled && !busy` ANTES
// de entregar a CUALQUIER suscriptor (incl. el nuestro) → con busy=true esta pantalla TAMPOCO recibiría
// tags. En cambio, el overlay global se hace ROUTE-AWARE: cuando la ruta activa es `asignar-caravanas`,
// su `onTagRead` no abre nada (ver FindOrCreateOverlay.tsx, guard de ruta). Esta pantalla consume su
// PROPIO `useBleStickListener` con `busy=false` → recibe los tags; el overlay los ignora en esta ruta.
// Net: un bastoneo en la masiva NO apila el overlay y NO se procesa dos veces. (Reconciliación de design
// §4.2: el `useBusyWhileMounted` que el sketch sugería era inviable por el gate global del provider — la
// supresión por ruta del overlay es la vía limpia que NO toca `ble/*`, gateado.)
//
// ─── Cola de sesión + asignación 1×1 (RD5.2/RD5.3/RD5.5) ─────────────────────────────────────────────
// Cada `onTagRead(eid)` empuja el EID a la cola (estado local). La cabeza de la cola es el EID ACTUAL: la
// pantalla muestra sus candidatos `noTag` + buscador. Elegir candidato → confirmar → `assignTagToAnimal`
// (offline) → el candidato sale de la sesión (client-side, RD2.5) + avanza la cola + sube el contador.
// Cerrar la pantalla NO rollbackea (cada intent quedó independiente en la outbox, RD5.5).
//
// ─── Prevención client-side del dup al bastonear (RD6.1 — reconciliada por el leader, post-Run-3) ─────
// ANTES de encolar un EID, corremos `lookupByTag(eid, establishmentId)` (lectura LOCAL, ya existente). Si
// el EID YA resuelve a un animal del usuario (`mode:'edit'` o `'transfer'` = ya tiene caravana asignada),
// NO lo encolamos: mostramos un aviso accionable in-sesión ("ese TAG ya está asignado a otro animal — no se
// puede reasignar") y dejamos al operario listo para el siguiente bastoneo, SIN perder el progreso/contador.
// Solo `mode:'create'` (EID genuinamente nuevo) entra a la cola para ofrecer candidatos. Así prevenimos el
// dup en el momento del bastoneo en vez de esperar el rechazo del sync — el canal de rechazos de sync
// as-built (`connector.ts::surfaceUploadRejection`) es solo `console.warn` y no surfacea copy (RD6.3). El
// residual (un assign que igual rebote al sincronizar: race auto-sanante o dup cross-tenant casi imposible)
// lo maneja la maquinaria existente (classifyIntentUploadError → permanent_reject → descarte + log); NO
// agregamos un canal/toast de rechazo de sync nuevo (cross-cutting, diferido por RD6.3). Es una LIM doc.

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { Platform, Pressable, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { getTokenValue, ScrollView, Text, View, XStack, YStack } from 'tamagui';
import { ChevronLeft, ChevronRight, Radio, Search, Tag } from 'lucide-react-native';

import { Button, Card, CategoryBadge } from '@/components';
import { useEstablishment, useRodeo } from '@/contexts';
import { useBleStickListener } from '@/services/ble/stick';
import {
  assignTagToAnimal,
  fetchAnimals,
  lookupByTag,
  searchAnimals,
  type AnimalListItem,
} from '@/services/animals';
import { formatEidReadable } from '@/utils/eid-format';
import { pickHeroIdentifier } from '@/utils/animal-identifier';
import { buttonA11y, labelA11y } from '@/utils/a11y';
import { backOr } from '@/utils/nav';

const SEARCH_DEBOUNCE_MS = 250;

// ─── Estado de la sesión (cola de EIDs + contador + perfiles ya asignados client-side) ───────────────
//
// `queue`: EIDs en orden de llegada; la cabeza (queue[0]) es el EID ACTUAL. Dedup defensivo: si el mismo
// EID se bastonea dos veces mientras sigue en cola, NO lo apilamos (el provider ya des-duplica en su
// ventana, pero un re-bastoneo tardío podría re-encolarlo — lo evitamos).
// `assignedCount`: contador visible "X caravanas asignadas" (RD5.5).
// `assignedProfileIds`: perfiles ya asignados en ESTA sesión → se quitan de las listas de candidatos
// client-side (RD2.5), enmascarando la staleness del denorm local hasta el sync.
type SessionState = {
  queue: string[];
  assignedCount: number;
  assignedProfileIds: ReadonlySet<string>;
};

type SessionAction =
  | { type: 'enqueue'; eid: string }
  | { type: 'assigned'; profileId: string }
  | { type: 'skipHead' }
  | { type: 'reset' };

function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case 'enqueue': {
      // Defensivo: no apilar el mismo EID si ya está en cola (re-bastoneo tardío).
      if (state.queue.includes(action.eid)) return state;
      return { ...state, queue: [...state.queue, action.eid] };
    }
    case 'assigned': {
      // Avanza la cola (saca la cabeza = EID recién asignado) + suma el contador + marca el perfil como
      // asignado client-side. El `op_intent` ya quedó encolado (independiente) — esto es solo la sesión.
      const nextAssigned = new Set(state.assignedProfileIds);
      nextAssigned.add(action.profileId);
      return {
        queue: state.queue.slice(1),
        assignedCount: state.assignedCount + 1,
        assignedProfileIds: nextAssigned,
      };
    }
    case 'skipHead':
      // Saca la cabeza SIN asignar (el operario descartó el EID actual / lo va a dar de alta nuevo).
      return { ...state, queue: state.queue.slice(1) };
    case 'reset':
      return { queue: [], assignedCount: 0, assignedProfileIds: new Set() };
    default:
      return state;
  }
}

const INITIAL_SESSION: SessionState = { queue: [], assignedCount: 0, assignedProfileIds: new Set() };

// ─── Aviso de dup al bastonear (RD6.1) ───
// `already_tagged`: el EID ya resuelve a un animal del usuario (mode edit/transfer) → no se puede reasignar.
// `lookup_error`: la verificación local falló (raro) → pedir un re-bastoneo (fail-closed, no se encoló nada).
type DupNotice = { eid: string; kind: 'already_tagged' | 'lookup_error' };

export default function BulkTagAssignmentScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { state: est } = useEstablishment();
  const { state: rodeo } = useRodeo();

  const establishmentId = est.status === 'active' ? est.current.id : null;
  // El listener se habilita igual que el host global (RB2.1): campo activo + rodeo existente. Sin eso no
  // hay sobre qué asignar. NUNCA usamos `useBusyWhileMounted` acá (mataría nuestro propio listener — ver
  // el comentario de cabecera): consumimos el listener con busy=false; el overlay global se suprime por
  // ruta.
  const enabled = est.status === 'active' && rodeo.status === 'active';

  const [session, dispatch] = useReducer(sessionReducer, INITIAL_SESSION);
  // Aviso de re-escopeo al cambiar de campo (RD7.3 / DA-3): banner transitorio "reiniciamos la sesión".
  const [fieldChangedNotice, setFieldChangedNotice] = useState(false);
  // Aviso de dup al bastonear (RD6.1): un EID que YA tiene caravana (mode edit/transfer) NO se encola; se
  // muestra este banner accionable in-sesión. `kind` distingue el caso (ya en este/otro campo) del fallo de
  // verificación. El banner es transitorio y NO toca la cola/contador (no se pierde progreso).
  const [dupNotice, setDupNotice] = useState<DupNotice | null>(null);

  // El EID en cabeza de la cola = el actual. null = cola vacía ("bastoneá para empezar").
  const currentEid = session.queue.length > 0 ? session.queue[0] : null;

  // El establishmentId vive en un ref para leerlo dentro del callback `onTagRead` sin re-crearlo en cada
  // cambio (el callback va a una ref del listener; re-crearlo no re-suscribe pero evitamos churn). El reset
  // al cambiar de campo (más abajo) ya cubre la invariante de no mostrar candidatos ajenos.
  const establishmentIdRef = useRef(establishmentId);
  establishmentIdRef.current = establishmentId;

  // ─── Listener BLE en modo asignación (RD5.2) + PREVENCIÓN DE DUP (RD6.1) ───
  // ANTES de encolar el EID, verificamos con `lookupByTag` (lectura LOCAL, sin red) si ya está asignado a un
  // animal del usuario. Solo `mode:'create'` (EID nuevo) entra a la cola; `edit`/`transfer` (ya tiene
  // caravana) muestran un aviso accionable sin encolar (no se pierde la sesión). Un fallo de la lectura local
  // (casi nunca ocurre) → fail-CLOSED: avisamos "no pudimos verificar" y NO encolamos (mejor pedir un
  // re-bastoneo que encolar un EID sin verificar y arriesgar un dup que rebote al sync).
  const onTagRead = useCallback((eid: string) => {
    const estId = establishmentIdRef.current;
    if (!estId) return; // defensa: enabled ya lo gatea (campo activo), pero no procesamos sin campo.
    void (async () => {
      const res = await lookupByTag(eid, estId);
      // Re-chequeo del campo tras el await: si cambió mientras la lectura estaba en vuelo, descartamos (el
      // lookup se scopeó al campo del disparo; el reset por cambio de campo ya limpió la sesión).
      if (establishmentIdRef.current !== estId) return;
      if (!res.ok) {
        setDupNotice({ eid, kind: 'lookup_error' });
        return;
      }
      if (res.value.mode === 'create') {
        // EID genuinamente nuevo (sin match en ningún campo del usuario): a la cola para ofrecer candidatos.
        // Un bastoneo válido limpia cualquier aviso de dup previo (ya no es relevante).
        setDupNotice(null);
        dispatch({ type: 'enqueue', eid });
        return;
      }
      // mode:'edit' (ya tiene caravana en ESTE campo) o 'transfer' (en OTRO campo del usuario): ya está
      // asignado → NO se puede reasignar. Avisamos sin encolar; la sesión sigue intacta (RD6.1).
      setDupNotice({ eid, kind: 'already_tagged' });
    })();
  }, []);
  useBleStickListener({ enabled, onTagRead });

  // ─── Re-escopeo de sesión al cambiar de establishment (RD7.3 / DA-3): reiniciar + avisar ───
  // Invariante DURA: nunca mostrar candidatos de un campo que no es el activo. Al cambiar el campo activo,
  // la cola (EIDs bastoneados en el campo anterior) y el contador se reinician; mostramos un aviso. Las
  // asignaciones ya encoladas NO se tocan (quedaron en la outbox, independientes). El ref arranca con el
  // campo inicial → un primer render no dispara el reset (solo un CAMBIO real lo hace).
  const prevEstablishmentRef = useRef<string | null>(establishmentId);
  useEffect(() => {
    if (prevEstablishmentRef.current === establishmentId) return;
    prevEstablishmentRef.current = establishmentId;
    dispatch({ type: 'reset' });
    setFieldChangedNotice(true);
    // El aviso de dup era del campo anterior (su EID se verificó contra ese campo) → lo limpiamos.
    setDupNotice(null);
  }, [establishmentId]);

  const onAssigned = useCallback((profileId: string) => {
    dispatch({ type: 'assigned', profileId });
  }, []);

  const onCreateNew = useCallback(
    (eid: string) => {
      // "Es un animal nuevo" (RD5.6): saca el EID de la cola (se va a dar de alta CON ese EID) y navega a
      // CREATE. Al volver, la sesión sigue su curso (la cola conserva los EIDs restantes; el contador
      // queda intacto). crear-animal vuelve con router.back() a esta pantalla (la sesión persiste).
      dispatch({ type: 'skipHead' });
      router.push({ pathname: '/crear-animal', params: { tag: eid } });
    },
    [router],
  );

  const onSkip = useCallback(() => {
    // El operario descarta el EID actual sin asignar ni crear (pasa al siguiente de la cola).
    dispatch({ type: 'skipHead' });
  }, []);

  const muted = getTokenValue('$textMuted', 'color');

  return (
    <YStack flex={1} width="100%" maxWidth="100%" overflow="hidden" backgroundColor="$bg">
      {/* Header con back + título + contador de sesión (RD5.5: contador SIEMPRE visible). */}
      <YStack width="100%" paddingTop={insets.top} paddingHorizontal="$4">
        <XStack width="100%" alignItems="center" gap="$2" paddingVertical="$3">
          <Pressable
            hitSlop={8}
            onPress={() => backOr(router, '/(tabs)/animales')}
            {...buttonA11y(Platform.OS, { label: 'Volver' })}
          >
            <ChevronLeft size={28} color={muted} strokeWidth={2} />
          </Pressable>
          <YStack flex={1} minWidth={0}>
            <Text fontFamily="$body" fontSize="$8" lineHeight="$8" fontWeight="700" color="$textPrimary" numberOfLines={1}>
              Asignar caravanas
            </Text>
          </YStack>
          <SessionCounter count={session.assignedCount} />
        </XStack>
      </YStack>

      {/* Aviso de cambio de campo (RD7.3): la sesión se reinició al nuevo campo activo. */}
      {fieldChangedNotice ? (
        <YStack paddingHorizontal="$4" paddingBottom="$2">
          <FieldChangedNotice onDismiss={() => setFieldChangedNotice(false)} />
        </YStack>
      ) : null}

      {/* Aviso de dup al bastonear (RD6.1): el EID ya tiene caravana → no se encoló. La sesión sigue. */}
      {dupNotice ? (
        <YStack paddingHorizontal="$4" paddingBottom="$2">
          <DupNoticeBanner notice={dupNotice} onDismiss={() => setDupNotice(null)} />
        </YStack>
      ) : null}

      {/* Cuerpo: EID actual + sus candidatos, o el estado vacío "bastoneá para empezar". */}
      {currentEid === null ? (
        <EmptyQueueState />
      ) : (
        <BulkEidBody
          // key={currentEid}: cada EID nuevo en cabeza REMONTA el cuerpo (resetea búsqueda + candidato a
          // confirmar). Sin el key, el sub-estado `confirming` del EID viejo sobreviviría al avanzar la
          // cola y se asignaría el EID nuevo al candidato del flujo viejo (mismo bug que el AssignOrCreateBody
          // del Run 2 cerró con key={eid}).
          key={currentEid}
          eid={currentEid}
          establishmentId={establishmentId}
          excludedProfileIds={session.assignedProfileIds}
          safeBottom={insets.bottom + getTokenValue('$3', 'space')}
          onAssigned={onAssigned}
          onCreateNew={onCreateNew}
          onSkip={onSkip}
        />
      )}
    </YStack>
  );
}

// ─── Contador de sesión "X asignadas" (RD5.5), siempre visible en el header ───
function SessionCounter({ count }: { count: number }) {
  return (
    <View
      flexShrink={0}
      alignItems="center"
      justifyContent="center"
      minHeight="$chipMin"
      minWidth="$chipMin"
      paddingHorizontal="$3"
      borderRadius="$pill"
      backgroundColor={count > 0 ? '$primary' : '$surface'}
      borderWidth={1}
      borderColor={count > 0 ? '$primary' : '$divider'}
      {...labelA11y(Platform.OS, `${count} ${count === 1 ? 'caravana asignada' : 'caravanas asignadas'}`)}
    >
      <Text fontFamily="$body" fontSize="$5" fontWeight="700" color={count > 0 ? '$white' : '$textMuted'}>
        {count}
      </Text>
    </View>
  );
}

// ─── Aviso transitorio de re-escopeo al cambiar de campo (RD7.3) ───
function FieldChangedNotice({ onDismiss }: { onDismiss: () => void }) {
  return (
    <Card backgroundColor="$surface" borderWidth={1} borderColor="$divider" gap="$2">
      <Text fontFamily="$body" fontSize="$4" fontWeight="600" color="$textPrimary">
        Cambiaste de campo
      </Text>
      <Text fontFamily="$body" fontSize="$3" fontWeight="400" color="$textMuted">
        Reiniciamos la sesión de caravaneo para mostrarte solo los animales del campo activo. Las caravanas
        que ya asignaste se guardaron.
      </Text>
      <Button variant="secondary" fullWidth onPress={onDismiss}>
        Entendido
      </Button>
    </Card>
  );
}

// ─── Aviso de dup al bastonear (RD6.1): el EID ya tiene caravana → no se reasigna ───
// Reusa el patrón Card + Button de FieldChangedNotice (componentes ya vetados) con acento de advertencia
// `$terracota`. Muestra el EID legible (confirmación SENASA) + copy accionable en voseo. NO toca la sesión:
// el operario descarta el aviso y sigue con el próximo bastoneo (no se perdió el progreso/contador).
function DupNoticeBanner({ notice, onDismiss }: { notice: DupNotice; onDismiss: () => void }) {
  const eidReadable = formatEidReadable(notice.eid);
  const title = notice.kind === 'already_tagged' ? 'Esa caravana ya está asignada' : 'No pudimos verificar la caravana';
  const body =
    notice.kind === 'already_tagged'
      ? 'Ese TAG ya está asignado a otro animal de tus campos, así que no se puede reasignar. Bastoneá la próxima caravana para seguir.'
      : 'No pudimos chequear si esa caravana ya estaba asignada. No la guardamos. Bastoneala de nuevo para reintentar.';
  return (
    <Card
      backgroundColor="$surface"
      borderWidth={1}
      borderColor="$terracota"
      gap="$2"
      {...labelA11y(Platform.OS, `${title}. Caravana ${eidReadable}. ${body}`)}
    >
      <XStack alignItems="center" gap="$2">
        <Tag size={getTokenValue('$dot', 'size')} color={getTokenValue('$terracota', 'color')} strokeWidth={2.5} />
        <Text fontFamily="$body" fontSize="$5" fontWeight="700" color="$textPrimary">
          {title}
        </Text>
      </XStack>
      <Text fontFamily="$body" fontSize="$3" fontWeight="500" color="$textPrimary" letterSpacing={1}>
        {eidReadable}
      </Text>
      <Text fontFamily="$body" fontSize="$3" fontWeight="400" color="$textMuted">
        {body}
      </Text>
      <Button variant="secondary" fullWidth onPress={onDismiss}>
        Entendido
      </Button>
    </Card>
  );
}

// ─── Estado vacío: cola vacía → "bastoneá para empezar" (RD5.2) ───
function EmptyQueueState() {
  return (
    <YStack flex={1} width="100%" alignItems="center" justifyContent="center" gap="$4" paddingHorizontal="$6">
      <Radio size={getTokenValue('$icon', 'size')} color={getTokenValue('$textMuted', 'color')} strokeWidth={1.75} />
      <YStack alignItems="center" gap="$2">
        <Text fontFamily="$body" fontSize="$7" lineHeight="$7" fontWeight="700" color="$textPrimary" textAlign="center">
          Bastoneá para empezar
        </Text>
        <Text fontFamily="$body" fontSize="$4" fontWeight="400" color="$textMuted" textAlign="center">
          Pasá el bastón por la caravana del animal. Acá vas a elegir a cuál de tus animales sin caravana
          se la asignás.
        </Text>
      </YStack>
    </YStack>
  );
}

// ─── Cuerpo del EID ACTUAL: EID legible + candidatos noTag + buscador + asignar/es-nuevo/saltar ───
//
// Espeja la estructura del AssignOrCreateBody (opción A, Run 2) para consistencia visual: misma card de
// candidato CON chevron de tap, mismo buscador, mismo paso de confirmación. La diferencia es el ritmo:
// acá tras asignar NO se cierra una pantalla, se AVANZA la cola al siguiente EID (sesión persistente).
function BulkEidBody({
  eid,
  establishmentId,
  excludedProfileIds,
  safeBottom,
  onAssigned,
  onCreateNew,
  onSkip,
}: {
  eid: string;
  establishmentId: string | null;
  excludedProfileIds: ReadonlySet<string>;
  safeBottom: number;
  onAssigned: (profileId: string) => void;
  onCreateNew: (eid: string) => void;
  onSkip: () => void;
}) {
  const eidReadable = formatEidReadable(eid);

  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [candidates, setCandidates] = useState<AnimalListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<AnimalListItem | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);
  const searchSeq = useRef(0);

  // Debounce del término (250ms, mismo idiom que la tab Animales / AssignOrCreateBody).
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  // Carga de candidatos (RD5.7: 100% local, scopeado al campo activo). Sin término → todos los noTag
  // (updated_at DESC, RD5.2). Con término → searchAnimals + filtro client-side a noTag (design §3.4).
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
      if (seq !== searchSeq.current) return;
      setLoading(false);
      if (!res.ok) {
        setLoadError('No pudimos cargar tus animales sin caravana.');
        setCandidates([]);
        return;
      }
      setCandidates(res.value.filter((a) => a.tagElectronic == null));
    })();
  }, [establishmentId, debounced]);

  const onAssign = useCallback(async () => {
    if (!confirming) return;
    const profileId = confirming.profileId;
    setAssigning(true);
    setAssignError(null);
    const res = await assignTagToAnimal(profileId, eid);
    if (!res.ok) {
      // El encolado offline casi nunca falla. Si falla, surfaceamos sin avanzar la cola.
      setAssigning(false);
      setAssignError('No pudimos asignar la caravana. Probá de nuevo.');
      return;
    }
    // Éxito del ENCOLADO (offline-first, RD5.3): avanzar la cola + sumar el contador + quitar el candidato
    // de la sesión (client-side, RD2.5). NO cerramos la pantalla: la sesión sigue con el próximo EID. El
    // UPDATE real lo aplica el RPC al sincronizar; un dup/race se surfacea por el canal de status (RD6).
    onAssigned(profileId);
  }, [confirming, eid, onAssigned]);

  // Los candidatos visibles excluyen los ya asignados en la sesión (RD2.5): aunque el denorm local siga
  // mostrándolos sin caravana hasta el sync, no deben re-aparecer para re-asignar.
  const visibleCandidates = candidates.filter((c) => !excludedProfileIds.has(c.profileId));

  // ── Paso de CONFIRMACIÓN: "Asignar caravana <EID> a este animal" (RD5.3) ──
  if (confirming) {
    return (
      <ScrollView
        flex={1}
        width="100%"
        contentContainerStyle={{
          paddingHorizontal: getTokenValue('$4', 'space'),
          paddingBottom: safeBottom + getTokenValue('$6', 'space'),
        }}
        keyboardShouldPersistTaps="handled"
      >
        <YStack gap="$4" paddingTop="$2">
          <EidHeader eidReadable={eidReadable} />
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
      </ScrollView>
    );
  }

  // ── Lista de candidatos + buscador + CTAs ("es nuevo" / "saltar") ──
  return (
    <YStack flex={1} width="100%" paddingHorizontal="$4" gap="$3">
      <EidHeader eidReadable={eidReadable} />

      <Text fontFamily="$body" fontSize="$6" lineHeight="$6" fontWeight="700" color="$textPrimary">
        ¿A cuál de tus animales sin caravana?
      </Text>

      {/* Buscador (RD5.4): filtra por IDV/visual. */}
      <CandidateSearchBar value={query} onChangeText={setQuery} />

      {/* Lista SCROLLABLE: el buscador (arriba) y los CTAs (abajo) quedan FIJOS (Fitts). */}
      <ScrollView
        flex={1}
        width="100%"
        showsVerticalScrollIndicator
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: getTokenValue('$3', 'space') }}
      >
        {loading ? (
          <Text fontFamily="$body" fontSize="$4" fontWeight="500" color="$textMuted" paddingVertical="$3">
            Buscando…
          </Text>
        ) : loadError ? (
          <Text fontFamily="$body" fontSize="$4" fontWeight="500" color="$terracota" paddingVertical="$3">
            {loadError}
          </Text>
        ) : visibleCandidates.length === 0 ? (
          <Text fontFamily="$body" fontSize="$4" fontWeight="500" color="$textMuted" paddingVertical="$3">
            {debounced.trim().length > 0
              ? 'Ningún animal sin caravana coincide con la búsqueda.'
              : 'No hay animales sin caravana en este campo.'}
          </Text>
        ) : (
          <YStack gap="$2">
            {visibleCandidates.map((c) => (
              <CandidateRow key={c.profileId} candidate={c} onPress={() => setConfirming(c)} />
            ))}
          </YStack>
        )}
      </ScrollView>

      {/* CTAs SIEMPRE visibles (RD5.6): "es nuevo" da de alta CON el EID; "saltar" descarta el EID actual. */}
      <YStack width="100%" gap="$2" paddingBottom={safeBottom}>
        <Button variant="secondary" fullWidth onPress={() => onCreateNew(eid)}>
          Bastoneé un animal nuevo, no está en la lista
        </Button>
        <Pressable onPress={onSkip} {...buttonA11y(Platform.OS, { label: 'Saltar esta caravana' })}>
          <XStack width="100%" minHeight="$chipMin" alignItems="center" justifyContent="center">
            <Text fontFamily="$body" fontSize="$4" fontWeight="600" color="$textMuted">
              Saltar esta caravana
            </Text>
          </XStack>
        </Pressable>
      </YStack>
    </YStack>
  );
}

// ─── Encabezado del EID actual (RD5.2: EID legible = confirmación SENASA) ───
function EidHeader({ eidReadable }: { eidReadable: string }) {
  return (
    <XStack alignItems="center" gap="$3" paddingTop="$2">
      <Radio size={getTokenValue('$navIcon', 'size')} color={getTokenValue('$primary', 'color')} strokeWidth={2.25} />
      <YStack flex={1} minWidth={0} gap="$1">
        <Text fontFamily="$body" fontSize="$2" fontWeight="500" color="$textMuted">
          Caravana leída
        </Text>
        <Text
          fontFamily="$body"
          fontSize="$8" lineHeight="$8"
          fontWeight="700"
          color="$textPrimary"
          letterSpacing={1}
          numberOfLines={1}
          {...labelA11y(Platform.OS, `Caravana ${eidReadable}`)}
        >
          {eidReadable}
        </Text>
      </YStack>
    </XStack>
  );
}

// ─── Buscador de candidatos (mismo idiom que la tab Animales / AssignOrCreateBody) ───
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

// ─── Fila de un candidato (idv/visual + categoría + sexo + rodeo + chevron de tap) ───
// Mismo patrón visual que el CandidateRow del AssignOrCreateBody (opción A, Run 2) para consistencia.
function CandidateRow({
  candidate,
  onPress,
}: {
  candidate: AnimalListItem;
  onPress: () => void;
}) {
  const heroResult = pickHeroIdentifier({
    apodo: candidate.apodo,
    rodeoUsesApodo: candidate.rodeoUsesApodo,
    idv: candidate.idv,
    tag: candidate.tagElectronic,
  });
  const hero = heroResult.value ?? 'Sin identificación';
  const sexLabel = candidate.sex === 'male' ? 'Macho' : 'Hembra';
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
              {heroResult.secondary ? (
                <Text fontFamily="$body" fontSize="$3" fontWeight="500" color="$textMuted" numberOfLines={1}>
                  {`#${heroResult.secondary.value}`}
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
  const hero =
    pickHeroIdentifier({
      apodo: candidate.apodo,
      rodeoUsesApodo: candidate.rodeoUsesApodo,
      idv: candidate.idv,
      tag: candidate.tagElectronic,
    }).value ?? 'Sin identificación';
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

// ─── Pill de metadato (sexo / rodeo) ───
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
