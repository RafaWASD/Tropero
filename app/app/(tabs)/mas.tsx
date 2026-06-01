// app/(tabs)/mas.tsx — pantalla "Más" (settings) de RAFAQ (spec 01, ADR-018).
//
// Cajón de ajustes (patrón Settings iOS/Android / tab "Más" de Mercado Pago — Jakob, modelo
// mental conocido): SECCIONES AGRUPADAS con título mudo arriba + filas/cards adentro.
//   - Perfil (R2.1/R2.2): nombre + teléfono + email, todos editables. name/phone → public.users
//     (RLS users_update_self), vía ProfileContext (fuente única del saludo — Fase 6). El EMAIL es
//     EDITABLE (Fase 6): cambiarlo dispara `auth.updateUser({email})` → Supabase manda verificación
//     al email nuevo y MANTIENE el viejo hasta confirmar (R2.2 nativo); el display sigue mostrando
//     el viejo (del session) hasta que el usuario confirme.
//   - Campo activo "<nombre>": "Editar campo" (R3.4) + "Eliminar campo" (R3.6/R3.6.1), visibles
//     SOLO si el rol del usuario en el campo activo es `owner` (EstablishmentContext). A un
//     no-owner NO se le ofrecen (la RLS las bloquearía igual, pero la UI no debe ofrecerlas).
//   - Equipo (miembros/invitaciones): → /miembros (Fase 5).
//   - Cerrar sesión (T6.2 / R1.6): DIFERENCIADA (destructiva, $terracota), thumb-zone.
//   - Zona de peligro (Fase 6, R2.4/R2.5/R2.5.1): "Eliminar cuenta" al FONDO, separada. DOBLE
//     confirmación (no un solo alert). Si el usuario es único owner de ≥1 campo → lista de campos
//     bloqueantes con atajo a soft-delete por campo (reusa el flujo de eliminar campo) + reintentar.
//
// Eliminar campo (R3.6.1): ANTES de borrar, confirmación destructiva + warning con el CONTEO de
// miembros activos que perderán acceso. Tras borrar, refreshEstablishments() → el contexto detecta
// la pérdida del activo (o re-resuelve sobre los restantes) y el RootGate re-rutea (active_lost,
// R6.10).
//
// Diseño (🟡 pantalla mixta, no manga-crítica): jerarquía clara (títulos de sección $textMuted
// chicos, filas con label + chevron/acción); acciones destructivas diferenciadas ($terracota) y
// abajo (thumb-zone); confirmación obligatoria en lo destructivo (Nielsen #5 + #3); touch-targets
// ≥56px ($touchMin); tokens-only (ADR-023 §4); voseo argentino.

import { useCallback, useRef, useState, type ReactNode } from 'react';
import { Alert, Platform, Pressable } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getTokenValue, ScrollView, Text, View, XStack, YStack } from 'tamagui';
import { AlertTriangle, Building2, CheckCircle2, ChevronRight, Layers, LogOut, Pencil, Trash2, Users } from 'lucide-react-native';

import { Button, Card, FormField, FormError, InfoNote } from '@/components';
import { useAuth, useEstablishment, useProfile } from '@/contexts';
import {
  countActiveMembers,
  saveProfile,
  softDeleteEstablishment,
} from '@/services/establishments';
import {
  deleteAccount,
  type BlockingEstablishment,
} from '@/services/account';
import {
  NAME_MAX_LENGTH,
  PHONE_MAX_LENGTH,
  sanitizePhoneInput,
  validateProfile,
} from '@/utils/validation';

const OFFLINE_COPY = 'Necesitás conexión para esto. Conectate a internet y volvé a intentar.';

// ─── Título de sección (mudo, $textMuted chico — jerarquía de settings) ──────────

function SectionTitle({ children }: { children: string }) {
  return (
    <Text
      fontFamily="$body"
      fontSize="$3"
      fontWeight="600"
      color="$textMuted"
      marginBottom="$2"
      marginTop="$5"
    >
      {children}
    </Text>
  );
}

// ─── Fila de acción genérica (target ≥ $touchMin; ícono + label + trailing) ──────

function ActionRow({
  icon,
  label,
  destructive = false,
  trailing,
  accessibilityLabel,
  onPress,
}: {
  icon: ReactNode;
  label: string;
  destructive?: boolean;
  trailing?: ReactNode;
  accessibilityLabel?: string;
  onPress: () => void;
}) {
  const labelColor = destructive ? '$terracota' : '$textPrimary';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
    >
      <XStack
        width="100%"
        alignItems="center"
        gap="$3"
        minHeight="$touchMin"
        paddingHorizontal="$4"
        paddingVertical="$2"
        pressStyle={{ backgroundColor: '$bg' }}
      >
        <View width="$icon" alignItems="center" flexShrink={0}>
          {icon}
        </View>
        <Text
          flex={1}
          minWidth={0}
          textAlign="left"
          numberOfLines={1}
          fontFamily="$body"
          fontSize="$5"
          fontWeight="500"
          color={labelColor}
        >
          {label}
        </Text>
        {trailing ? (
          <View flexShrink={0} alignItems="flex-end">
            {trailing}
          </View>
        ) : null}
      </XStack>
    </Pressable>
  );
}

// ─── Sección Perfil (R2.1/R2.2): ver + editar nombre/teléfono; email en su fila ───
//
// Fuente de datos = ProfileContext (Fase 6, fuente única): name/phone de public.users, email del
// session de auth. Tras guardar name/phone, refrescamos el ProfileContext → el saludo de la home
// se actualiza sin reload.
//
// IA de la vista (Fix 4, Mobbin KOHO/Airbnb): el modo lectura muestra filas Nombre / Email /
// Teléfono. Nombre + Teléfono se editan JUNTOS con "Editar perfil" (ProfileEditForm). El EMAIL
// tiene su propia fila con acción "Cambiar" → navega a /cambiar-email (pantalla dedicada, R2.2);
// NO es un form inline. (Opcional Ubank/Acorns: badge "Verificado" si emailVerified.)
//
// Fix 1 (reset-on-blur): el tab "Más" queda montado, así el modo edición persistiría al salir y
// volver. useFocusEffect resetea editing=false en el cleanup (blur) → al volver estás en lectura,
// descartando la edición sin guardar. (La pantalla de email es ruta aparte → se descarta sola.)

function ProfileSection({ userId }: { userId: string }) {
  const router = useRouter();
  const { profile, loading, error, refresh } = useProfile();
  const { state: authState } = useAuth();
  const emailVerified = authState.status === 'authenticated' && authState.emailVerified;
  const [editing, setEditing] = useState(false);

  // Fix 1 — descartar la edición sin guardar al salir de la pantalla (blur). El cleanup corre al
  // perder foco; el setState solo dispara si seguía en modo edición (funcional, sin dep de `editing`
  // → no re-suscribe el efecto en cada toggle). Al re-enfocar, el modo lectura ya está activo.
  useFocusEffect(
    useCallback(() => {
      return () => setEditing(false);
    }, []),
  );

  if (loading && !profile) {
    return <InfoNote>Cargando tu perfil…</InfoNote>;
  }

  if (!profile) {
    // Error de carga sin perfil cacheado (ej. sin red en el primer fetch). Reintentable.
    return (
      <YStack gap="$2">
        <FormError message={error ?? 'No pudimos cargar tu perfil.'} />
        <Button variant="secondary" fullWidth onPress={() => void refresh()}>
          Reintentar
        </Button>
      </YStack>
    );
  }

  if (editing) {
    return (
      <ProfileEditForm
        userId={userId}
        initialName={profile.name}
        initialPhone={profile.phone}
        onDone={() => {
          // Refresca la fuente única (public.users) → saludo de la home al día (Fase 6).
          void refresh();
          setEditing(false);
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <Card gap="$3">
      <ProfileField label="Nombre" value={profile.name || '—'} />
      {/* Email en su fila con acción "Cambiar" → pantalla dedicada (Fix 4). */}
      <EmailRow
        email={profile.email}
        verified={emailVerified}
        onChange={() => router.push('/cambiar-email')}
      />
      <ProfileField label="Teléfono" value={profile.phone || 'Sin teléfono'} />
      <Button variant="secondary" fullWidth onPress={() => setEditing(true)}>
        Editar perfil
      </Button>
    </Card>
  );
}

function ProfileField({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <YStack gap="$1">
      <Text fontFamily="$body" fontSize="$3" fontWeight="500" color="$textMuted">
        {label}
      </Text>
      <Text fontFamily="$body" fontSize="$5" fontWeight="500" color="$textPrimary">
        {value}
      </Text>
      {hint ? (
        <Text fontFamily="$body" fontSize="$2" fontWeight="400" color="$textFaint">
          {hint}
        </Text>
      ) : null}
    </YStack>
  );
}

// ─── Fila de Email con acción "Cambiar" (Fix 4 — Mobbin KOHO/Airbnb) ──────────────
//
// Label + valor a la izquierda, link "Cambiar" a la derecha (estilo "Update/Editar"). Navega a la
// pantalla dedicada de cambio de email. Badge "Verificado" opcional (Ubank/Acorns) cuando el email
// está verificado — solo un mini-chip al lado del label, no recarga la fila.

function EmailRow({
  email,
  verified,
  onChange,
}: {
  email: string | null;
  verified: boolean;
  onChange: () => void;
}) {
  const primary = getTokenValue('$primary', 'color');
  return (
    <XStack alignItems="center" gap="$3">
      <YStack flex={1} minWidth={0} gap="$1">
        <XStack alignItems="center" gap="$2">
          <Text fontFamily="$body" fontSize="$3" fontWeight="500" color="$textMuted">
            Email
          </Text>
          {verified ? (
            <XStack alignItems="center" gap="$1">
              <CheckCircle2 size={14} color={primary} strokeWidth={2.5} />
              <Text fontFamily="$body" fontSize="$2" fontWeight="600" color="$primary">
                Verificado
              </Text>
            </XStack>
          ) : null}
        </XStack>
        <Text
          numberOfLines={1}
          fontFamily="$body"
          fontSize="$5"
          fontWeight="500"
          color="$textPrimary"
        >
          {email || '—'}
        </Text>
      </YStack>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Cambiar email"
        hitSlop={8}
        onPress={onChange}
      >
        <XStack
          flexShrink={0}
          alignItems="center"
          justifyContent="center"
          minHeight="$chipMin"
          paddingHorizontal="$2"
          pressStyle={{ opacity: 0.6 }}
        >
          <Text fontFamily="$body" fontSize="$4" fontWeight="600" color="$primary">
            Cambiar
          </Text>
        </XStack>
      </Pressable>
    </XStack>
  );
}

function ProfileEditForm({
  userId,
  initialName,
  initialPhone,
  onDone,
  onCancel,
}: {
  userId: string;
  initialName: string;
  initialPhone: string | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState(initialPhone ?? '');
  const [nameError, setNameError] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit() {
    setFormError(null);
    const v = validateProfile({ name, phone });
    setNameError(v.name);
    setPhoneError(v.phone);
    if (!v.valid) return;

    setSaving(true);
    const nextPhone = phone.trim() || null;
    // El nombre se guarda trimeado (el saludo no debe arrastrar espacios sobrantes).
    const result = await saveProfile(userId, { name: name.trim(), phone: nextPhone });
    setSaving(false);

    if (result.ok) {
      onDone();
    } else {
      setFormError(
        result.error.kind === 'network' ? OFFLINE_COPY : 'No pudimos guardar los cambios.',
      );
    }
  }

  return (
    <Card gap="$3">
      <FormField
        label="Nombre"
        value={name}
        onChangeText={setName}
        placeholder="Tu nombre"
        autoCapitalize="words"
        autoComplete="name"
        maxLength={NAME_MAX_LENGTH}
        error={nameError}
      />
      <FormField
        label="Teléfono"
        value={phone}
        // Fix 2: sanitizamos en vivo → las letras no pueden tipearse; solo dígitos y separadores
        // (+ - ( ) y espacio). maxLength acota el largo total.
        onChangeText={(text) => setPhone(sanitizePhoneInput(text))}
        placeholder="Ej. 11 2345 6789"
        keyboardType="phone-pad"
        autoComplete="tel"
        textContentType="telephoneNumber"
        maxLength={PHONE_MAX_LENGTH}
        error={phoneError}
      />
      <FormError message={formError} />
      <Button variant="primary" fullWidth disabled={saving} onPress={() => void onSubmit()}>
        {saving ? 'Guardando…' : 'Guardar'}
      </Button>
      <Button variant="secondary" fullWidth onPress={onCancel}>
        Cancelar
      </Button>
    </Card>
  );
}

// ─── Zona de peligro: Eliminar cuenta (R2.4/R2.5/R2.5.1) ──────────────────────────
//
// DOBLE confirmación (R2.4): NO un solo alert. Máquina de estados:
//   idle    → botón "Eliminar cuenta".
//   confirm → tarjeta destructiva con las consecuencias (perdés acceso a tus campos y datos, es
//             irreversible) + "Sí, eliminar mi cuenta" (segundo paso explícito) + "Cancelar".
//   deleting→ llamada al edge. Resultado:
//             · ok / already_deleted → signOut() local + estado breve "cuenta eliminada"; el
//               RootGate (al cambiar el AuthState) re-rutea a AuthStack. Sin pantalla nueva pesada.
//             · sole_owner (R2.5) → lista de campos bloqueantes con atajo a soft-delete por campo
//               (reusa softDeleteEstablishment + warning de miembros R3.6.1) + "Reintentar baja".
//             · network / unknown → error legible, no se borró nada; vuelve a confirm.

type DeleteStep =
  | { kind: 'idle' }
  | { kind: 'confirm' }
  | { kind: 'deleting' }
  | { kind: 'deleted' }
  | { kind: 'blocked'; establishments: BlockingEstablishment[] }
  | { kind: 'error'; message: string };

function DeleteAccountSection({
  userId,
  signOut,
  refreshEstablishments,
}: {
  userId: string;
  signOut: () => Promise<void>;
  refreshEstablishments: (preferredId?: string) => Promise<void>;
}) {
  const terracota = getTokenValue('$terracota', 'color');
  const [step, setStep] = useState<DeleteStep>({ kind: 'idle' });
  // Re-entrancy guard: cubre la llamada al edge (un doble-tap no dispara dos bajas).
  const busyRef = useRef(false);

  const callDelete = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setStep({ kind: 'deleting' });
    const result = await deleteAccount();
    busyRef.current = false;

    if (result.ok) {
      // Baja consumada (o ya estaba dada de baja). signOut local → el RootGate rutea a auth.
      setStep({ kind: 'deleted' });
      await signOut();
      return;
    }
    if (result.reason === 'sole_owner') {
      setStep({ kind: 'blocked', establishments: result.establishments });
      return;
    }
    setStep({
      kind: 'error',
      message:
        result.reason === 'network'
          ? OFFLINE_COPY
          : result.reason === 'unauthorized'
            ? 'Tu sesión expiró. Cerrá sesión y volvé a entrar.'
            : 'No pudimos eliminar tu cuenta. Probá de nuevo.',
    });
  }, [signOut]);

  // Soft-delete de un campo bloqueante (R2.5.1 → R3.6/R3.6.1): warning con conteo + confirmación.
  // Tras borrar, sacamos el campo de la lista de bloqueantes; cuando no quedan, el usuario reintenta.
  const onSoftDeleteBlocking = useCallback(
    async (est: BlockingEstablishment) => {
      if (busyRef.current) return;
      busyRef.current = true;

      const countResult = await countActiveMembers(est.id, userId);
      if (!countResult.ok) {
        busyRef.current = false;
        Alert.alert(
          'No se pudo continuar',
          countResult.error.kind === 'network'
            ? OFFLINE_COPY
            : 'No pudimos verificar los miembros del campo. Probá de nuevo.',
        );
        return;
      }
      const memberCount = countResult.count;
      const warning =
        memberCount > 0
          ? `"${est.name}" tiene ${memberCount} ${memberCount === 1 ? 'miembro' : 'miembros'} que van a perder acceso. Esta acción no se puede deshacer. ¿Eliminar el campo?`
          : `Vas a eliminar "${est.name}". Esta acción no se puede deshacer. ¿Eliminarlo?`;

      const confirmed = await confirmDestructive('Eliminar campo', warning, 'Eliminar');
      if (!confirmed) {
        busyRef.current = false;
        return;
      }

      const result = await softDeleteEstablishment(est.id);
      busyRef.current = false;
      if (!result.ok) {
        Alert.alert(
          'No se pudo eliminar',
          result.error.kind === 'network' ? OFFLINE_COPY : result.error.message,
        );
        return;
      }
      // Refrescamos el contexto (el campo borrado sale del set; si era el activo entra active_lost
      // y el RootGate re-rutea — pero seguimos mostrando la baja hasta que se desmonte la pantalla).
      await refreshEstablishments();
      // Sacamos el campo de la lista de bloqueantes. Si no quedan, el usuario puede reintentar.
      setStep((prev) =>
        prev.kind === 'blocked'
          ? { kind: 'blocked', establishments: prev.establishments.filter((e) => e.id !== est.id) }
          : prev,
      );
    },
    [userId, refreshEstablishments],
  );

  if (step.kind === 'deleted') {
    return (
      <Card gap="$2" borderColor="$terracota">
        <Text fontFamily="$body" fontSize="$5" fontWeight="600" color="$textPrimary">
          Tu cuenta fue eliminada.
        </Text>
        <Text fontFamily="$body" fontSize="$3" fontWeight="400" color="$textMuted">
          Te estamos sacando de la sesión…
        </Text>
      </Card>
    );
  }

  if (step.kind === 'blocked') {
    const remaining = step.establishments;
    return (
      <Card gap="$3" borderColor="$terracota">
        <XStack alignItems="center" gap="$2">
          <AlertTriangle size={20} color={terracota} strokeWidth={2.5} />
          <Text flex={1} minWidth={0} fontFamily="$body" fontSize="$5" fontWeight="600" color="$textPrimary">
            No podés eliminar tu cuenta todavía
          </Text>
        </XStack>
        {remaining.length > 0 ? (
          <>
            <Text fontFamily="$body" fontSize="$4" fontWeight="400" color="$textMuted">
              Sos el único dueño de estos campos. Eliminá cada uno (o transferilo) para poder darte
              de baja:
            </Text>
            <YStack gap="$2">
              {remaining.map((est) => (
                <XStack
                  key={est.id}
                  alignItems="center"
                  gap="$3"
                  minHeight="$touchMin"
                  borderWidth={1}
                  borderColor="$divider"
                  borderRadius="$card"
                  paddingHorizontal="$3"
                >
                  <Building2 size={20} color={terracota} strokeWidth={2} />
                  <Text
                    flex={1}
                    minWidth={0}
                    numberOfLines={1}
                    fontFamily="$body"
                    fontSize="$4"
                    fontWeight="500"
                    color="$textPrimary"
                  >
                    {est.name || 'Campo sin nombre'}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Eliminar el campo ${est.name || 'sin nombre'} (acción destructiva)`}
                    hitSlop={8}
                    onPress={() => void onSoftDeleteBlocking(est)}
                  >
                    <XStack
                      alignItems="center"
                      gap="$1"
                      minHeight="$chipMin"
                      paddingHorizontal="$2"
                      pressStyle={{ opacity: 0.6 }}
                    >
                      <Trash2 size={18} color={terracota} strokeWidth={2} />
                      <Text fontFamily="$body" fontSize="$3" fontWeight="600" color="$terracota">
                        Eliminar
                      </Text>
                    </XStack>
                  </Pressable>
                </XStack>
              ))}
            </YStack>
          </>
        ) : (
          <Text fontFamily="$body" fontSize="$4" fontWeight="400" color="$textMuted">
            Listo, ya no quedan campos bloqueantes. Podés reintentar la baja.
          </Text>
        )}
        <Button
          variant="secondary"
          fullWidth
          disabled={remaining.length > 0}
          onPress={() => void callDelete()}
        >
          Reintentar baja
        </Button>
        <Button variant="secondary" fullWidth onPress={() => setStep({ kind: 'idle' })}>
          Cancelar
        </Button>
      </Card>
    );
  }

  if (step.kind === 'confirm' || step.kind === 'deleting' || step.kind === 'error') {
    const deleting = step.kind === 'deleting';
    return (
      <Card gap="$3" borderColor="$terracota">
        <XStack alignItems="center" gap="$2">
          <AlertTriangle size={20} color={terracota} strokeWidth={2.5} />
          <Text flex={1} minWidth={0} fontFamily="$body" fontSize="$5" fontWeight="600" color="$textPrimary">
            ¿Eliminar tu cuenta?
          </Text>
        </XStack>
        <Text fontFamily="$body" fontSize="$4" fontWeight="400" color="$textMuted">
          Vas a perder el acceso a tus campos y a todos tus datos. Esta acción no se puede deshacer.
        </Text>
        {step.kind === 'error' ? <FormError message={step.message} /> : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Sí, eliminar mi cuenta (acción destructiva)"
          disabled={deleting}
          onPress={() => void callDelete()}
        >
          <XStack
            width="100%"
            alignItems="center"
            justifyContent="center"
            minHeight="$touchMin"
            borderRadius="$pill"
            backgroundColor="$terracota"
            paddingHorizontal="$5"
            opacity={deleting ? 0.5 : 1}
            pressStyle={{ opacity: 0.85 }}
          >
            <Text fontFamily="$body" fontSize="$5" fontWeight="600" color="$white">
              {deleting ? 'Eliminando…' : 'Sí, eliminar mi cuenta'}
            </Text>
          </XStack>
        </Pressable>
        <Button
          variant="secondary"
          fullWidth
          disabled={deleting}
          onPress={() => setStep({ kind: 'idle' })}
        >
          Cancelar
        </Button>
      </Card>
    );
  }

  // idle
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Eliminar cuenta (acción destructiva)"
      onPress={() => setStep({ kind: 'confirm' })}
    >
      <XStack
        width="100%"
        alignItems="center"
        justifyContent="center"
        gap="$2"
        minHeight="$touchMin"
        borderWidth={2}
        borderColor="$terracota"
        borderRadius="$pill"
        paddingHorizontal="$5"
        pressStyle={{ backgroundColor: '$surface' }}
      >
        <Trash2 size={20} color={terracota} strokeWidth={2.5} />
        <Text fontFamily="$body" fontSize="$5" fontWeight="600" color="$terracota">
          Eliminar cuenta
        </Text>
      </XStack>
    </Pressable>
  );
}

// ─── Pantalla ─────────────────────────────────────────────────────────────────

export default function MasScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { state: authState, signOut } = useAuth();
  const { state: estState, refreshEstablishments } = useEstablishment();

  const userId = authState.status === 'authenticated' ? authState.user.id : null;

  // Campo activo + rol. "Editar/Eliminar campo" solo si el usuario es OWNER del activo (R3.4/R3.6).
  const activeField =
    estState.status === 'active'
      ? { id: estState.current.id, name: estState.current.name }
      : null;
  const isOwner = estState.status === 'active' && estState.role === 'owner';

  // `busy` = re-entrancy guard (cubre TODO el flujo: contar + confirmar + borrar) para que un
  // doble-tap no dispare dos borrados. `deleting` = solo el label visible "Eliminando…", que se
  // enciende RECIÉN tras confirmar (antes el usuario está en el diálogo de confirmación, no
  // borrando — mostrar "Eliminando…" ahí sería engañoso, sobre todo en native donde el Alert no
  // bloquea el render).
  const busyRef = useRef(false);
  const [deleting, setDeleting] = useState(false);

  // Colores que cruzan a la API no-Tamagui de lucide (prop `color`), leídos del token.
  const muted = getTokenValue('$textMuted', 'color');
  const primary = getTokenValue('$primary', 'color');
  const terracota = getTokenValue('$terracota', 'color');

  // ── Eliminar campo (R3.6/R3.6.1): warning con conteo + confirmación destructiva ──
  const onDeleteField = useCallback(async () => {
    if (!activeField || !userId || busyRef.current) return;
    busyRef.current = true;

    // 1. Contamos los miembros activos DISTINTOS del owner (R3.6.1): cuántos perderán acceso.
    const countResult = await countActiveMembers(activeField.id, userId);
    if (!countResult.ok) {
      busyRef.current = false;
      Alert.alert(
        'No se pudo continuar',
        countResult.error.kind === 'network' ? OFFLINE_COPY : 'No pudimos verificar los miembros del campo. Probá de nuevo.',
      );
      return;
    }
    const memberCount = countResult.count;

    // 2. Confirmación destructiva con el conteo (R3.6.1, Nielsen #5 prevención de errores).
    const warning =
      memberCount > 0
        ? `"${activeField.name}" tiene ${memberCount} ${memberCount === 1 ? 'miembro' : 'miembros'} que van a perder acceso. Esta acción no se puede deshacer. ¿Eliminar el campo?`
        : `Vas a eliminar "${activeField.name}". Esta acción no se puede deshacer. ¿Eliminarlo?`;

    const confirmed = await confirmDestructive('Eliminar campo', warning, 'Eliminar');
    if (!confirmed) {
      busyRef.current = false;
      return;
    }

    // 3. Confirmado → ahora SÍ borramos: encendemos el label "Eliminando…".
    setDeleting(true);
    // Soft-delete (R3.6). Tras esto, refreshEstablishments() → el contexto detecta que el campo
    // activo desapareció (active_lost) o re-resuelve sobre los restantes, y el RootGate re-rutea
    // (Mis campos / wizard / home). No navegamos a mano: dejamos que el gate decida.
    const result = await softDeleteEstablishment(activeField.id);
    if (!result.ok) {
      setDeleting(false);
      busyRef.current = false;
      Alert.alert(
        'No se pudo eliminar',
        result.error.kind === 'network' ? OFFLINE_COPY : result.error.message,
      );
      return;
    }
    await refreshEstablishments();
    // El RootGate re-rutea fuera de "Más" al detectar el cambio de estado. No reseteamos
    // busyRef/deleting: esta pantalla se desmonta. (Si por alguna razón no se desmontara, el
    // botón queda en "Eliminando…" hasta el próximo render del gate — borde inofensivo.)
  }, [activeField, userId, refreshEstablishments]);

  // Re-rutea a auth en logout: lo maneja el RootGate al cambiar el AuthState; acá solo disparamos.
  const onLogout = useCallback(async () => {
    const confirmed = await confirmDestructive(
      'Cerrar sesión',
      '¿Querés cerrar la sesión en este dispositivo?',
      'Cerrar sesión',
    );
    if (!confirmed) return;
    await signOut();
  }, [signOut]);

  return (
    <YStack flex={1} width="100%" maxWidth="100%" overflow="hidden" backgroundColor="$bg">
      {/* Header propio (el tab no muestra header nativo, ADR-018). */}
      <YStack width="100%" paddingTop={insets.top} paddingHorizontal="$4">
        <XStack width="100%" alignItems="center" paddingVertical="$3">
          <Text fontFamily="$body" fontSize="$8" fontWeight="700" color="$textPrimary">
            Más
          </Text>
        </XStack>
      </YStack>

      <ScrollView
        flex={1}
        width="100%"
        maxWidth="100%"
        contentContainerStyle={{
          paddingHorizontal: getTokenValue('$4', 'space'),
          paddingBottom: getTokenValue('$8', 'space'),
          width: '100%',
          maxWidth: '100%',
        }}
        keyboardShouldPersistTaps="handled"
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Perfil (R2.1) ── */}
        <SectionTitle>Perfil</SectionTitle>
        {userId ? (
          <ProfileSection userId={userId} />
        ) : (
          <InfoNote>No pudimos identificar tu cuenta. Cerrá sesión y volvé a entrar.</InfoNote>
        )}

        {/* ── Campo activo (R3.4 / R3.6) — acciones OWNER-ONLY + Rodeos (todos los roles) ── */}
        {activeField ? (
          <>
            <SectionTitle>{`Campo activo · ${activeField.name}`}</SectionTitle>
            <Card padding="$0" gap="$0" overflow="hidden">
              {/* Rodeos (spec 02 C1): la lista es visible a todos los roles; la gestión (crear /
                  editar plantilla / eliminar) es owner-only dentro de la pantalla (R2.3). */}
              <ActionRow
                icon={<Layers size={20} color={primary} strokeWidth={2} />}
                label="Rodeos"
                accessibilityLabel="Ver y gestionar los rodeos del campo"
                trailing={<ChevronRight size={20} color={muted} strokeWidth={2} />}
                onPress={() => router.push('/rodeos')}
              />
              {isOwner ? (
                <>
                  <View height={1} backgroundColor="$divider" marginHorizontal="$4" />
                  <ActionRow
                    icon={<Pencil size={20} color={primary} strokeWidth={2} />}
                    label="Editar campo"
                    trailing={<ChevronRight size={20} color={muted} strokeWidth={2} />}
                    onPress={() => router.push('/editar-campo')}
                  />
                  <View height={1} backgroundColor="$divider" marginHorizontal="$4" />
                  <ActionRow
                    icon={<Trash2 size={20} color={terracota} strokeWidth={2} />}
                    label={deleting ? 'Eliminando…' : 'Eliminar campo'}
                    destructive
                    accessibilityLabel="Eliminar campo (acción destructiva)"
                    onPress={() => void onDeleteField()}
                  />
                </>
              ) : null}
            </Card>
            {!isOwner ? (
              <InfoNote>
                Solo el dueño del campo puede editar o eliminar sus datos. Vos sos miembro de este
                campo.
              </InfoNote>
            ) : null}
          </>
        ) : null}

        {/* ── Equipo (miembros/invitaciones) — Fase 5 / B.1.3 ── */}
        {activeField ? (
          <>
            <SectionTitle>Equipo</SectionTitle>
            <Card padding="$0" gap="$0" overflow="hidden">
              <ActionRow
                icon={<Users size={20} color={primary} strokeWidth={2} />}
                label="Miembros e invitaciones"
                accessibilityLabel="Ver miembros e invitaciones del equipo"
                trailing={<ChevronRight size={20} color={muted} strokeWidth={2} />}
                onPress={() => router.push('/miembros')}
              />
            </Card>
          </>
        ) : null}

        {/* ── Cerrar sesión (T6.2 / R1.6) — destructiva, thumb-zone (abajo) ── */}
        <YStack marginTop="$8" width="100%">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cerrar sesión"
            onPress={() => void onLogout()}
          >
            <XStack
              width="100%"
              alignItems="center"
              justifyContent="center"
              gap="$2"
              minHeight="$touchMin"
              borderWidth={2}
              borderColor="$terracota"
              borderRadius="$pill"
              paddingHorizontal="$5"
              pressStyle={{ backgroundColor: '$surface' }}
            >
              <LogOut size={20} color={terracota} strokeWidth={2.5} />
              <Text fontFamily="$body" fontSize="$5" fontWeight="600" color="$terracota">
                Cerrar sesión
              </Text>
            </XStack>
          </Pressable>
        </YStack>

        {/* ── Zona de peligro (Fase 6, R2.4/R2.5/R2.5.1) — al FONDO, separada visualmente ── */}
        {userId ? (
          <YStack marginTop="$8" width="100%">
            <SectionTitle>Zona de peligro</SectionTitle>
            <DeleteAccountSection
              userId={userId}
              signOut={signOut}
              refreshEstablishments={refreshEstablishments}
            />
          </YStack>
        ) : null}
      </ScrollView>
    </YStack>
  );
}

/**
 * Confirmación destructiva multiplataforma. Native: Alert.alert con botones (cancel/destructive).
 * Web (react-native-web): Alert.alert NO renderiza botones accionables, así que usamos
 * window.confirm (síncrono, pero lo envolvemos en una promesa para una sola firma). Devuelve true
 * si el usuario confirmó. Garantiza que las acciones destructivas SIEMPRE pidan confirmación
 * (Nielsen #5 prevención de errores) en ambas plataformas — el testing de Raf es en web.
 */
function confirmDestructive(title: string, message: string, confirmLabel: string): Promise<boolean> {
  if (Platform.OS === 'web') {
    // window.confirm: bloqueante pero confiable en web. typeof guard por SSR/headless.
    const ok = typeof globalThis !== 'undefined' && typeof (globalThis as { confirm?: unknown }).confirm === 'function'
      ? (globalThis as { confirm: (m?: string) => boolean }).confirm(`${title}\n\n${message}`)
      : false;
    return Promise.resolve(ok);
  }
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: 'Cancelar', style: 'cancel', onPress: () => resolve(false) },
      { text: confirmLabel, style: 'destructive', onPress: () => resolve(true) },
    ]);
  });
}
