// TagScanSheet — BASTONEAR la caravana electrónica desde la FICHA del animal (delta caravana-ficha
// bastoneo, RCF.6). Bottom-sheet de scan ACOTADO: lee el EID del bastón y lo asigna a ESTE animal (el de la
// ficha) — NO es find-or-create, NO hay picker (el animal es conocido). Mucho más simple que el flujo global.
//
// Propiedad EXCLUSIVA del listener (el punto crítico, RCF.6): la ficha suspende el listener global con
// `useBusyWhileMounted` (busyMode) para que un bastonazo no dispare el FindOrCreateOverlay encima. Este sheet
// necesita lo INVERSO pero exclusivo → mientras está montado ADQUIERE un "scanner acotado" en el provider
// (`useScopedScannerControls`): (1) el listener escucha para ÉL aunque busyMode esté prendido, y (2) el
// FindOrCreateOverlay ignora esas lecturas (chequea `scopedScannerActive`). Acquire al montar / release en el
// cleanup (incl. back-gesture / desmontaje de la ficha) → sin transporte colgado ni busyMode inconsistente.
//
// Lenguaje visual ADAPTATIVO REPLICADO de la maniobra (`maniobra/identificar.tsx`, `resolveListenConnState`):
//   - CONECTADO      → hero de escaneo (pulso pasivo, "Acercá el bastón al animal").
//   - CONECTABLE     → hero "Conectá el bastón" (disco tappable, gesto que web-serial exige antes de elegir
//                      puerto / bastón caído).
//   - MANUAL (sin transporte, native Expo Go hoy) → prompt NEUTRO "El bastón no está disponible en este
//                      dispositivo" → deriva a la carga MANUAL de la ficha (piso siempre presente).
// La carga MANUAL de 15 díg (IdentifierAssignRow de la ficha) NO se toca — queda como fallback siempre
// presente; el sheet ofrece "Cargá la caravana a mano" que cierra y aterriza en esa afordancia.
//
// Al leer un EID (ya validado+dedupeado por el contrato) → confirmación visual pre-commit (integridad SENASA,
// ADR-024): los 15 díg legibles + "Asignar caravana … a este animal" → onAssignTag(eid) (offline-safe, encola
// por outbox) → éxito → cierra; error → surface sin cerrar (fail-closed).
//
// Cero hardcode (ADR-023 §4): tokens + getTokenValue para íconos lucide. Voseo es-AR. lineHeight matching en
// todo heading con descendentes. a11y por los helpers de utils/a11y.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getTokenValue, Text, View, XStack, YStack } from 'tamagui';
import { Bluetooth, Keyboard, Radio, Tag, X } from 'lucide-react-native';

import { StickIcon } from '@/theme/icons';
import { useBleStickListener, useScopedScannerControls } from '@/services/ble/stick';
import { useBleProviderApi } from '@/services/ble/BleStickListenerProvider';
import { resolveListenConnState } from '@/utils/maniobra-listen-state';
import { formatEidReadable } from '@/utils/eid-format';
import { buttonA11y, labelA11y } from '@/utils/a11y';

import { Button } from './Button';

export type TagScanSheetProps = {
  /** Cierra el sheet (X, backdrop, o tras un assign exitoso). El host lo desmonta al cerrar. */
  onClose: () => void;
  /**
   * Asigna la caravana electrónica leída/tipeada a ESTE animal (el de la ficha): pre-check de dup +
   * encolar el RPC `assign_tag_to_animal` (offline-safe) + optimismo en sitio. Devuelve ok=false con un
   * mensaje accionable si falla (dup / encolado) → se surfacea inline y el sheet queda ABIERTO para
   * reintentar (fail-closed). En éxito, el host ya reflejó el TAG optimista → este sheet se cierra.
   */
  onAssignTag: (eid: string) => Promise<{ ok: boolean; error?: string }>;
};

export function TagScanSheet({ onClose, onAssignTag }: TagScanSheetProps) {
  const insets = useSafeAreaInsets();

  // ── Propiedad EXCLUSIVA del listener mientras el sheet está montado (RCF.6). Acquire al montar, release en
  //    el cleanup (garantiza limpieza incluso si el sheet se cierra por back-gesture o la ficha se desmonta). ──
  const acquireScopedScanner = useScopedScannerControls();
  useEffect(() => {
    const release = acquireScopedScanner();
    return release;
  }, [acquireScopedScanner]);

  // El EID leído (null = escuchando; no-null = confirmación pre-commit). `assigning`/`error` del assign.
  const [readEid, setReadEid] = useState<string | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);
  // Mientras estamos ASIGNANDO no dejamos que un bastonazo nuevo pise la confirmación en vuelo (evita
  // asignar un EID distinto del que el operario confirmó). Ref para leerlo dentro del callback sin re-sub.
  const assigningRef = useRef(assigning);
  assigningRef.current = assigning;

  // ── Lectura del bastón (RCF.6): el EID llega YA validado+dedupeado del contrato. Live-rescan: un EID nuevo
  //    reemplaza al que estaba a confirmar (escanear-escanear es el ritmo del bastón), salvo assign en vuelo. ──
  const onTagRead = useCallback((eid: string) => {
    if (assigningRef.current) return; // no yanquear la confirmación mientras se asigna
    setAssignError(null);
    setReadEid(eid);
  }, []);

  // Suscripción al listener (enabled=true; el scoped scanner ya fuerza la escucha aunque busyMode esté
  // prendido). Nos da isConnected para el hero adaptativo (paridad con maniobra/identificar).
  const { isConnected } = useBleStickListener({ enabled: true, onTagRead });

  // transport != null → hay algo CONECTABLE (web-serial antes de elegir puerto / bastón caído). null → no hay
  // transporte (native manual-first hoy) → el hero cae a "manual promovido". connect() con gesto del tap.
  const bleApi = useBleProviderApi();
  const conectable = bleApi?.transport != null;
  const listenConn = resolveListenConnState({ isConnected, conectable });
  const connectStick = useCallback(() => {
    void bleApi?.transport?.connect().catch(() => undefined);
  }, [bleApi]);

  const onAssign = useCallback(async () => {
    if (!readEid || assigningRef.current) return;
    setAssigning(true);
    setAssignError(null);
    const r = await onAssignTag(readEid);
    if (!r.ok) {
      // Fail-closed: surfaceamos el error inline y dejamos el sheet ABIERTO para reintentar/re-escanear.
      setAssigning(false);
      setAssignError(r.error ?? 'No pudimos asignar la caravana. Probá de nuevo.');
      return;
    }
    // Éxito del encolado (offline-safe): el host reflejó el TAG optimista → cerramos el sheet.
    onClose();
  }, [readEid, onAssignTag, onClose]);

  const backToScanning = useCallback(() => {
    setReadEid(null);
    setAssignError(null);
  }, []);

  const bottomPad = insets.bottom + getTokenValue('$6', 'space');

  return (
    <View
      testID="tag-scan-sheet-scrim"
      position="absolute"
      top="$0"
      left="$0"
      right="$0"
      bottom="$0"
      backgroundColor="$scrim"
      justifyContent="flex-end"
    >
      {/* Backdrop tappable: cierra el sheet. Cubre el área por encima del panel. */}
      <Pressable style={{ flex: 1, width: '100%' }} onPress={onClose} {...buttonA11y(Platform.OS, { label: 'Cerrar' })} />

      <YStack
        testID="tag-scan-sheet"
        width="100%"
        maxHeight="85%"
        backgroundColor="$bg"
        borderTopLeftRadius="$card"
        borderTopRightRadius="$card"
        paddingHorizontal="$4"
        paddingTop="$4"
        paddingBottom={bottomPad}
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

        {/* Header: título + cerrar. */}
        <XStack alignItems="center" gap="$3">
          <Tag size={getTokenValue('$navIcon', 'size')} color={getTokenValue('$primary', 'color')} strokeWidth={2.25} />
          <Text
            flex={1}
            fontFamily="$body"
            fontSize="$6"
            lineHeight="$6"
            fontWeight="700"
            color="$textPrimary"
            numberOfLines={1}
          >
            Bastonear la caravana
          </Text>
          <Pressable testID="tag-scan-close" onPress={onClose} {...buttonA11y(Platform.OS, { label: 'Cerrar' })}>
            <X size={getTokenValue('$navIcon', 'size')} color={getTokenValue('$textMuted', 'color')} strokeWidth={2.25} />
          </Pressable>
        </XStack>

        {readEid !== null ? (
          <ReadConfirmation
            eid={readEid}
            assigning={assigning}
            error={assignError}
            onAssign={() => void onAssign()}
            onBack={backToScanning}
          />
        ) : listenConn === 'connected' ? (
          <ScanHero />
        ) : listenConn === 'connectable' ? (
          <ConnectHero onConnect={connectStick} onManual={onClose} />
        ) : (
          <ManualPromptHero onManual={onClose} />
        )}
      </YStack>
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// HERO "ESCUCHANDO" (CONECTADO) — el bastón lee solo. Disco de pulso PASIVO (no se toca: el target es el
// animal). Replica el lenguaje de maniobra/identificar a escala de sheet. + link a la carga manual (piso).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
function ScanHero() {
  const disc = getTokenValue('$heroScan', 'size') * 0.6;
  const heroIcon = getTokenValue('$heroIcon', 'size') * 0.6;
  const ring = getTokenValue('$heroRing', 'size');

  return (
    <YStack alignItems="center" justifyContent="center" paddingVertical="$4" gap="$5">
      <View width={disc} height={disc} alignItems="center" justifyContent="center" {...labelA11y(Platform.OS, 'Escuchando el bastón')}>
        <View position="absolute" width={disc} height={disc} borderRadius="$pill" backgroundColor="$fabHalo" />
        <View position="absolute" width={disc * 0.72} height={disc * 0.72} borderRadius="$pill" backgroundColor="$greenLight" />
        <View
          width={disc * 0.5}
          height={disc * 0.5}
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

      <YStack alignItems="center" gap="$2">
        <Text fontFamily="$heading" fontSize="$7" lineHeight="$7" fontWeight="700" color="$textPrimary" textAlign="center">
          Acercá el bastón al animal
        </Text>
        <Text fontFamily="$body" fontSize="$4" lineHeight="$4" fontWeight="500" color="$textMuted" textAlign="center">
          La lectura entra sola, sin tocar la pantalla
        </Text>
      </YStack>
    </YStack>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// HERO "CONECTÁ EL BASTÓN" (CONECTABLE) — desconectado pero con un transporte conectable (web-serial antes de
// elegir puerto / bastón caído). El disco es un BOTÓN (tap = gesto que web-serial exige → connect()). Mismo
// lenguaje que la maniobra (StickIcon + badge Bluetooth). + link a la carga manual (piso).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
function ConnectHero({ onConnect, onManual }: { onConnect: () => void; onManual: () => void }) {
  const disc = getTokenValue('$heroScan', 'size') * 0.6;
  const heroIcon = getTokenValue('$heroIcon', 'size') * 0.6;
  const white = getTokenValue('$white', 'color');
  const badge = disc * 0.28;

  return (
    <YStack alignItems="center" justifyContent="center" paddingVertical="$4" gap="$5">
      <View
        width={disc}
        height={disc}
        alignItems="center"
        justifyContent="center"
        pressStyle={{ opacity: 0.85 }}
        onPress={onConnect}
        testID="tag-scan-connect-disc"
        {...buttonA11y(Platform.OS, { label: 'Conectá el bastón' })}
      >
        <View position="absolute" width={disc} height={disc} borderRadius="$pill" backgroundColor="$fabHalo" />
        <View position="absolute" width={disc * 0.72} height={disc * 0.72} borderRadius="$pill" backgroundColor="$greenLight" />
        <View
          width={disc * 0.5}
          height={disc * 0.5}
          borderRadius="$pill"
          backgroundColor="$primary"
          alignItems="center"
          justifyContent="center"
        >
          <StickIcon size={heroIcon} color={white} strokeWidth={2} />
        </View>
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
          bottom={disc * 0.16}
          right={disc * 0.16}
        >
          <Bluetooth size={badge * 0.55} color={white} strokeWidth={2.5} />
        </View>
      </View>

      <YStack alignItems="center" gap="$2">
        <Text fontFamily="$heading" fontSize="$7" lineHeight="$7" fontWeight="700" color="$textPrimary" textAlign="center">
          Conectá el bastón
        </Text>
        <Text fontFamily="$body" fontSize="$4" lineHeight="$4" fontWeight="500" color="$textMuted" textAlign="center">
          Tocá el disco para conectar
        </Text>
      </YStack>

      <ManualFallbackLink onPress={onManual} />
    </YStack>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// HERO "MANUAL PROMOVIDO" (sin transporte, native Expo Go hoy) — SIN disco de scan ni botón de conectar (no
// hay nada que conectar). Prompt NEUTRO (no es un error, es lo normal en ese dispositivo) → deriva a la carga
// MANUAL de la ficha (piso siempre presente). El botón primario CIERRA el sheet → la afordancia manual de la
// sección "Identificación" queda a la vista.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
function ManualPromptHero({ onManual }: { onManual: () => void }) {
  const heroIcon = getTokenValue('$heroIcon', 'size') * 0.6;

  return (
    <YStack alignItems="center" justifyContent="center" paddingVertical="$4" gap="$5">
      <View
        width={getTokenValue('$heroScan', 'size') * 0.36}
        height={getTokenValue('$heroScan', 'size') * 0.36}
        borderRadius="$pill"
        backgroundColor="$greenLight"
        alignItems="center"
        justifyContent="center"
        {...labelA11y(Platform.OS, 'El bastón no está disponible en este dispositivo')}
      >
        <Keyboard size={heroIcon} color={getTokenValue('$primary', 'color')} strokeWidth={2} />
      </View>

      <YStack alignItems="center" gap="$2">
        <Text fontFamily="$heading" fontSize="$7" lineHeight="$7" fontWeight="700" color="$textPrimary" textAlign="center">
          Cargá la caravana a mano
        </Text>
        <Text fontFamily="$body" fontSize="$4" lineHeight="$4" fontWeight="500" color="$textMuted" textAlign="center">
          El bastón no está disponible en este dispositivo
        </Text>
      </YStack>

      <Button testID="tag-scan-to-manual" variant="primary" fullWidth onPress={onManual}>
        Cargar la caravana a mano
      </Button>
    </YStack>
  );
}

// ─── Link a la carga MANUAL (piso siempre presente): cierra el sheet → la afordancia manual de la ficha. ───
function ManualFallbackLink({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress} {...buttonA11y(Platform.OS, { label: 'Cargá la caravana a mano' })}>
      <View paddingHorizontal="$3" paddingVertical="$2">
        <Text fontFamily="$body" fontSize="$4" lineHeight="$4" fontWeight="600" color="$primary" textAlign="center">
          ¿Sin bastón? Cargá la caravana a mano
        </Text>
      </View>
    </Pressable>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// CONFIRMACIÓN PRE-COMMIT (integridad SENASA, ADR-024) — el EID leído en 15 díg LEGIBLES + "Asignar caravana
// … a este animal". El operario verifica de un vistazo, con una mano, a pleno sol. Asignar → onAssignTag;
// "Volver a escanear" → vuelve a escuchar (por si leyó la caravana equivocada). Error inline (fail-closed).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
function ReadConfirmation({
  eid,
  assigning,
  error,
  onAssign,
  onBack,
}: {
  eid: string;
  assigning: boolean;
  error: string | null;
  onAssign: () => void;
  onBack: () => void;
}) {
  const eidReadable = formatEidReadable(eid);
  return (
    <YStack testID="tag-scan-read" gap="$4">
      <YStack gap="$3" backgroundColor="$surface" borderWidth={1} borderColor="$divider" borderRadius="$card" padding="$4">
        <XStack alignItems="center" gap="$2">
          <Radio size={getTokenValue('$dot', 'size')} color={getTokenValue('$primary', 'color')} strokeWidth={2.5} />
          <Text fontFamily="$body" fontSize="$2" lineHeight="$2" fontWeight="600" color="$textMuted">
            Caravana leída
          </Text>
        </XStack>
        <Text
          fontFamily="$body"
          fontSize="$8"
          lineHeight="$8"
          fontWeight="700"
          color="$textPrimary"
          letterSpacing={1}
          numberOfLines={1}
          {...labelA11y(Platform.OS, `Caravana ${eidReadable}`)}
        >
          {eidReadable}
        </Text>
        <Text fontFamily="$body" fontSize="$4" lineHeight="$4" fontWeight="500" color="$textMuted">
          Asignar esta caravana a este animal.
        </Text>
        {error ? (
          <Text fontFamily="$body" fontSize="$3" lineHeight="$3" fontWeight="500" color="$terracota">
            {error}
          </Text>
        ) : null}
      </YStack>

      <Button testID="tag-scan-assign" variant="primary" fullWidth disabled={assigning} onPress={onAssign}>
        {assigning ? 'Asignando…' : 'Asignar caravana'}
      </Button>
      <Button variant="secondary" fullWidth disabled={assigning} onPress={onBack}>
        Volver a escanear
      </Button>
    </YStack>
  );
}
