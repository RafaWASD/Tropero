// TagScanSheet — BASTONEAR la caravana electrónica (delta caravana-ficha bastoneo, RCF.6; generalizado al
// ALTA y al PARTO en el delta bastoneo-captura-alta-parto). Bottom-sheet de scan ACOTADO: lee el EID del
// bastón — NO es find-or-create, NO hay picker (el contexto es conocido). Mucho más simple que el flujo global.
//
// DOS MODOS (por el prop `onSubmit`, neutral):
//   - ASIGNAR (ficha): el animal YA existe → `onSubmit` hace el RPC assign_tag_to_animal (pre-check dup +
//     encolar) → devuelve ok=false accionable si falla (fail-closed). Copy default ("Asignar caravana …").
//   - CAPTURAR (alta / parto): el animal NO existe todavía → `onSubmit` solo SETEA el estado del form del
//     caller (setTag / onUpdate) y devuelve ok=true sincrónico (sin RPC). El caller pasa copy propia
//     (title/confirmLabel/confirmSublabel) para que el texto encaje ("Usar caravana … para este ternero").
// El sheet no sabe cuál es: llama `onSubmit(eid)` y reacciona a su ok/error. Todo lo demás (scoped scanner,
// heroes adaptativos, validación 15 díg, manualModeRef) es IDÉNTICO en ambos modos.
//
// UX (Raf, 2026-07-06): en la ficha queda SOLO "Bastonear la caravana". La carga MANUAL del EID por teclado
// vive DENTRO de este sheet, detrás de "¿Sin bastón? Cargá la caravana a mano" (o el CTA del estado
// manual-promovido). NO hay carga manual directa de la electrónica desde la ficha.
//
// `hideManualEntry` (delta bastoneo-cría-al-pie, RCAP): para superficies que YA tienen su PROPIO campo de
// texto (el buscador de cría al pie acepta EID **o** IDV → la carga manual del sheet, EID-only 15 díg, NO
// aplica). Con hideManualEntry=true, los controles de "¿Sin bastón?" hacen `onClose` (cierran el sheet para
// que el operario tipee en el campo externo) en vez de abrir el `ManualTagEntry`, que NUNCA se muestra. El
// default (false) deja el comportamiento de ficha/alta/parto intacto (manual anidado dentro del sheet).
//
// Propiedad EXCLUSIVA del listener (el punto crítico, RCF.6): la ficha suspende el listener global con
// `useBusyWhileMounted` (busyMode) para que un bastonazo no dispare el FindOrCreateOverlay encima. Este sheet
// necesita lo INVERSO pero exclusivo → mientras está montado ADQUIERE un "scanner acotado" en el provider
// (`useScopedScannerControls`): (1) el listener escucha para ÉL aunque busyMode esté prendido, y (2) el
// FindOrCreateOverlay ignora esas lecturas (chequea `scopedScannerActive`). Acquire al montar / release en el
// cleanup (incl. back-gesture / desmontaje de la ficha) → sin transporte colgado ni busyMode inconsistente.
// En modo MANUAL el scoped scanner sigue IGUAL (dueño exclusivo); solo IGNORA las lecturas entrantes (el
// usuario eligió tipear — un bastonazo no debe pisar lo que escribe).
//
// Lenguaje visual ADAPTATIVO REPLICADO de la maniobra (`maniobra/identificar.tsx`, `resolveListenConnState`):
//   - CONECTADO      → hero de escaneo (pulso pasivo, "Acercá el bastón al animal") + link "¿Sin bastón?".
//   - CONECTABLE     → hero "Conectá el bastón" (disco tappable) + link "¿Sin bastón?".
//   - MANUAL (sin transporte, native Expo Go hoy) → prompt NEUTRO "El bastón no está disponible en este
//                      dispositivo" → CTA "Cargar la caravana a mano".
//
// Al leer un EID (ya validado+dedupeado por el contrato) → confirmación visual pre-commit (integridad SENASA,
// ADR-024): los 15 díg legibles + la copy de confirmación (confirmLabel/confirmSublabel) → onSubmit(eid)
// (assign encolado por outbox en la ficha / captura al form en alta-parto) → éxito → cierra; error → surface
// sin cerrar (fail-closed). El path MANUAL usa el MISMO onSubmit, con validación de forma (15 díg) inline previa.
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
import { TAG_ELECTRONIC_LENGTH, isValidTagElectronic, sanitizeTagInput } from '@/utils/animal-input';
import { buttonA11y, labelA11y } from '@/utils/a11y';

import { Button } from './Button';
import { FormField } from './FormField';

export type TagScanSheetProps = {
  /** Cierra el sheet (X, backdrop, o tras un submit exitoso). El host lo desmonta al cerrar. */
  onClose: () => void;
  /**
   * Consume la caravana electrónica leída/tipeada (15 díg, ya validada+dedupeada). Neutral entre modos:
   *   - ASIGNAR (ficha): pre-check de dup + encolar el RPC `assign_tag_to_animal` (offline-safe) + optimismo
   *     en sitio.
   *   - CAPTURAR (alta / parto): setea el EID en el estado del form del caller (setTag / onUpdate) y devuelve
   *     ok=true (sin RPC — el animal no existe todavía).
   * Devuelve ok=false con un mensaje accionable si falla (dup / encolado) → se surfacea inline y el sheet
   * queda ABIERTO para reintentar (fail-closed). En éxito, el host ya reflejó el TAG → este sheet se cierra.
   */
  onSubmit: (eid: string) => Promise<{ ok: boolean; error?: string }>;
  /** Título del header (default "Bastonear la caravana"). */
  title?: string;
  /** Label del botón primario de confirmación, en ambos estados BLE y manual (default "Asignar caravana"). */
  confirmLabel?: string;
  /** Sub-texto sobre el EID leído en la confirmación pre-commit (default "Asignar esta caravana a este animal."). */
  confirmSublabel?: string;
  /**
   * Oculta la carga MANUAL del EID dentro del sheet (default false). Para superficies con su PROPIO campo de
   * texto (buscador de cría al pie, EID **o** IDV): los controles de "¿Sin bastón?" hacen `onClose` (cerrar
   * para tipear afuera) en vez de abrir el `ManualTagEntry`, que nunca se muestra. false → comportamiento de
   * ficha/alta/parto (manual anidado). Solo aplica a los controles del path BLE; el path de confirmación no cambia.
   */
  hideManualEntry?: boolean;
};

export function TagScanSheet({
  onClose,
  onSubmit,
  title = 'Bastonear la caravana',
  confirmLabel = 'Asignar caravana',
  confirmSublabel = 'Asignar esta caravana a este animal.',
  hideManualEntry = false,
}: TagScanSheetProps) {
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
  // Modo carga MANUAL por teclado (detrás de "¿Sin bastón?"): el usuario eligió tipear el EID.
  const [manualMode, setManualMode] = useState(false);
  // Refs para leer estos flags dentro del callback del listener sin re-suscribir:
  //   - assigning: no yanquear la confirmación mientras se asigna.
  //   - manualMode: en carga manual IGNORAMOS las lecturas BLE (un bastonazo no pisa lo que se escribe).
  const assigningRef = useRef(assigning);
  assigningRef.current = assigning;
  const manualModeRef = useRef(manualMode);
  manualModeRef.current = manualMode;

  // ── Lectura del bastón (RCF.6): el EID llega YA validado+dedupeado del contrato. Live-rescan: un EID nuevo
  //    reemplaza al que estaba a confirmar (escanear-escanear es el ritmo del bastón), salvo assign en vuelo
  //    o carga manual activa (el usuario está tipeando → ignoramos el bastón). ──
  const onTagRead = useCallback((eid: string) => {
    if (assigningRef.current || manualModeRef.current) return;
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

  const enterManual = useCallback(() => setManualMode(true), []);
  const exitManual = useCallback(() => setManualMode(false), []);
  // Acción de los controles de "¿Sin bastón?": con hideManualEntry el sheet NO tiene carga manual propia (la
  // superficie tiene su campo externo) → cerramos para que el operario tipee afuera. Sin él, abrimos el
  // ManualTagEntry anidado (comportamiento de ficha/alta/parto). Estable entre renders.
  const onManualAction = hideManualEntry ? onClose : enterManual;

  const onAssign = useCallback(async () => {
    if (!readEid || assigningRef.current) return;
    setAssigning(true);
    setAssignError(null);
    const r = await onSubmit(readEid);
    if (!r.ok) {
      // Fail-closed: surfaceamos el error inline y dejamos el sheet ABIERTO para reintentar/re-escanear.
      setAssigning(false);
      setAssignError(r.error ?? 'No pudimos asignar la caravana. Probá de nuevo.');
      return;
    }
    // Éxito (assign encolado / captura seteada): el host reflejó el TAG → cerramos el sheet.
    onClose();
  }, [readEid, onSubmit, onClose]);

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
            {title}
          </Text>
          <Pressable testID="tag-scan-close" onPress={onClose} {...buttonA11y(Platform.OS, { label: 'Cerrar' })}>
            <X size={getTokenValue('$navIcon', 'size')} color={getTokenValue('$textMuted', 'color')} strokeWidth={2.25} />
          </Pressable>
        </XStack>

        {/* manualMode nunca es true con hideManualEntry (onManualAction=onClose no lo prende) → ManualTagEntry
            NUNCA se muestra en ese modo; el guard `&& !hideManualEntry` lo blinda de forma defensiva. */}
        {manualMode && !hideManualEntry ? (
          <ManualTagEntry onSubmit={onSubmit} confirmLabel={confirmLabel} onClose={onClose} onBack={exitManual} />
        ) : readEid !== null ? (
          <ReadConfirmation
            eid={readEid}
            assigning={assigning}
            error={assignError}
            confirmLabel={confirmLabel}
            confirmSublabel={confirmSublabel}
            onAssign={() => void onAssign()}
            onBack={backToScanning}
          />
        ) : listenConn === 'connected' ? (
          <ScanHero onManual={onManualAction} hideManualEntry={hideManualEntry} />
        ) : listenConn === 'connectable' ? (
          <ConnectHero onConnect={connectStick} onManual={onManualAction} hideManualEntry={hideManualEntry} />
        ) : (
          <ManualPromptHero onManual={onManualAction} hideManualEntry={hideManualEntry} />
        )}
      </YStack>
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// HERO "ESCUCHANDO" (CONECTADO) — el bastón lee solo. Disco de pulso PASIVO (no se toca: el target es el
// animal). Replica el lenguaje de maniobra/identificar a escala de sheet. + link a la carga manual (dentro).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
function ScanHero({ onManual, hideManualEntry }: { onManual: () => void; hideManualEntry: boolean }) {
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

      <ManualFallbackLink onPress={onManual} hideManualEntry={hideManualEntry} />
    </YStack>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// HERO "CONECTÁ EL BASTÓN" (CONECTABLE) — desconectado pero con un transporte conectable (web-serial antes de
// elegir puerto / bastón caído). El disco es un BOTÓN (tap = gesto que web-serial exige → connect()). Mismo
// lenguaje que la maniobra (StickIcon + badge Bluetooth). + link a la carga manual (dentro del sheet).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
function ConnectHero({
  onConnect,
  onManual,
  hideManualEntry,
}: {
  onConnect: () => void;
  onManual: () => void;
  hideManualEntry: boolean;
}) {
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

      <ManualFallbackLink onPress={onManual} hideManualEntry={hideManualEntry} />
    </YStack>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// HERO "MANUAL PROMOVIDO" (sin transporte, native Expo Go hoy) — SIN disco de scan ni botón de conectar (no
// hay nada que conectar). Prompt NEUTRO (no es un error, es lo normal en ese dispositivo) → CTA "Cargar la
// caravana a mano" que ABRE la carga manual DENTRO del sheet (no cierra).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
function ManualPromptHero({ onManual, hideManualEntry }: { onManual: () => void; hideManualEntry: boolean }) {
  const heroIcon = getTokenValue('$heroIcon', 'size') * 0.6;
  // Con hideManualEntry el sheet NO carga la electrónica adentro (la superficie tiene su campo externo, EID o
  // IDV) → el CTA CIERRA el sheet para tipear afuera. Sin él, abre el ManualTagEntry (15 díg) anidado.
  const title = 'Cargá la caravana a mano';
  const subtitle = 'El bastón no está disponible en este dispositivo';
  const cta = hideManualEntry ? 'Cerrá y escribí la caravana' : 'Cargar la caravana a mano';

  return (
    <YStack alignItems="center" justifyContent="center" paddingVertical="$4" gap="$5">
      <View
        width={getTokenValue('$heroScan', 'size') * 0.36}
        height={getTokenValue('$heroScan', 'size') * 0.36}
        borderRadius="$pill"
        backgroundColor="$greenLight"
        alignItems="center"
        justifyContent="center"
        {...labelA11y(Platform.OS, subtitle)}
      >
        <Keyboard size={heroIcon} color={getTokenValue('$primary', 'color')} strokeWidth={2} />
      </View>

      <YStack alignItems="center" gap="$2">
        <Text fontFamily="$heading" fontSize="$7" lineHeight="$7" fontWeight="700" color="$textPrimary" textAlign="center">
          {title}
        </Text>
        <Text fontFamily="$body" fontSize="$4" lineHeight="$4" fontWeight="500" color="$textMuted" textAlign="center">
          {subtitle}
        </Text>
      </YStack>

      <Button testID="tag-scan-to-manual" variant="primary" fullWidth onPress={onManual}>
        {cta}
      </Button>
    </YStack>
  );
}

// ─── Link a la carga MANUAL (detrás de "¿Sin bastón?"). Sin hideManualEntry abre el TextInput de 15 díg DENTRO
//     del sheet; con hideManualEntry CIERRA el sheet para tipear en el campo externo de la superficie. ───
function ManualFallbackLink({ onPress, hideManualEntry }: { onPress: () => void; hideManualEntry: boolean }) {
  const label = hideManualEntry ? '¿Sin bastón? Cerrá y escribí la caravana' : '¿Sin bastón? Cargá la caravana a mano';
  return (
    <Pressable testID="tag-scan-manual-link" onPress={onPress} {...buttonA11y(Platform.OS, { label })}>
      <View paddingHorizontal="$3" paddingVertical="$2">
        <Text fontFamily="$body" fontSize="$4" lineHeight="$4" fontWeight="600" color="$primary" textAlign="center">
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// CARGA MANUAL del EID DENTRO del sheet (RCF.6.6) — el usuario tipea los 15 díg (sin bastón). Sanitiza en vivo
// (solo dígitos ≤15), valida la forma al confirmar (misma copy que el alta) ANTES de confirmar, y usa el MISMO
// onSubmit que el path BLE (assign RPC en la ficha / captura al form en alta-parto). Éxito → cierra; error →
// inline, sheet abierto (fail-closed). "Volver" regresa al estado de scan.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
function ManualTagEntry({
  onSubmit,
  confirmLabel,
  onClose,
  onBack,
}: {
  onSubmit: (eid: string) => Promise<{ ok: boolean; error?: string }>;
  confirmLabel: string;
  onClose: () => void;
  onBack: () => void;
}) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleChange = useCallback((raw: string) => {
    setValue(sanitizeTagInput(raw));
    // Al re-tipear, limpiamos el error (no-op si ya era null → React bail-out, sin re-render inútil).
    setError((e) => (e ? null : e));
  }, []);

  const handleConfirm = useCallback(async () => {
    if (busy) return;
    // 1) Validación de FORMA (15 díg) — inline, sin invocar nada (misma copy que la carga manual del alta).
    if (!(isValidTagElectronic(value) && value.trim().length === TAG_ELECTRONIC_LENGTH)) {
      setError('La caravana electrónica tiene que tener 15 dígitos.');
      return;
    }
    // 2) Confirmación real (assign: pre-check dup + encolar / captura: setea el form). El optimismo lo hace el host.
    setBusy(true);
    setError(null);
    const r = await onSubmit(value);
    if (!r.ok) {
      // Fail-closed: error accionable inline, la afordancia queda ABIERTA para reintentar.
      setBusy(false);
      setError(r.error ?? 'No se pudo guardar el cambio.');
      return;
    }
    // Éxito: el host reflejó el TAG → cerramos (no setBusy(false): el sheet se desmonta).
    onClose();
  }, [busy, value, onSubmit, onClose]);

  return (
    <YStack testID="tag-scan-manual" gap="$4">
      <FormField
        label="Caravana electrónica"
        value={value}
        onChangeText={handleChange}
        error={error}
        placeholder="982 0001 2345 6789"
        keyboardType="number-pad"
        maxLength={TAG_ELECTRONIC_LENGTH}
        autoCapitalize="none"
        returnKeyType="done"
        onSubmitEditing={() => void handleConfirm()}
      />
      <Button
        testID="tag-scan-manual-assign"
        variant="primary"
        fullWidth
        disabled={busy}
        onPress={() => void handleConfirm()}
      >
        {busy ? 'Guardando…' : confirmLabel}
      </Button>
      <Button variant="secondary" fullWidth disabled={busy} onPress={onBack}>
        Volver
      </Button>
    </YStack>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// CONFIRMACIÓN PRE-COMMIT (integridad SENASA, ADR-024) — el EID leído en 15 díg LEGIBLES + la copy de
// confirmación (default "Asignar … a este animal"; captura: "Usar … para este ternero"). El operario verifica
// de un vistazo, con una mano, a pleno sol. Confirmar → onSubmit; "Volver a escanear" → vuelve a escuchar (por
// si leyó la caravana equivocada). Error inline (fail-closed).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
function ReadConfirmation({
  eid,
  assigning,
  error,
  confirmLabel,
  confirmSublabel,
  onAssign,
  onBack,
}: {
  eid: string;
  assigning: boolean;
  error: string | null;
  confirmLabel: string;
  confirmSublabel: string;
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
          {confirmSublabel}
        </Text>
        {error ? (
          <Text fontFamily="$body" fontSize="$3" lineHeight="$3" fontWeight="500" color="$terracota">
            {error}
          </Text>
        ) : null}
      </YStack>

      <Button testID="tag-scan-assign" variant="primary" fullWidth disabled={assigning} onPress={onAssign}>
        {assigning ? 'Guardando…' : confirmLabel}
      </Button>
      <Button variant="secondary" fullWidth disabled={assigning} onPress={onBack}>
        Volver a escanear
      </Button>
    </YStack>
  );
}
