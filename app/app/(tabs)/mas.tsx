// app/(tabs)/mas.tsx — pantalla "Más" (settings) de RAFAQ (spec 01, ADR-018).
//
// Cajón de ajustes (patrón Settings iOS/Android / tab "Más" de Mercado Pago — Jakob, modelo
// mental conocido): SECCIONES AGRUPADAS con título mudo arriba + filas/cards adentro. Cierra en
// este Run:
//   - Perfil (R2.1): nombre + email + teléfono (de public.users). Editar nombre y teléfono inline
//     (update a `users`, RLS users_update_self). El email es SOLO-LECTURA (cambiarlo dispara
//     verificación, R2.2 → TODO Fase 5, no se implementa ahora).
//   - Campo activo "<nombre>": "Editar campo" (R3.4) + "Eliminar campo" (R3.6/R3.6.1), visibles
//     SOLO si el rol del usuario en el campo activo es `owner` (EstablishmentContext). A un
//     no-owner NO se le ofrecen (la RLS las bloquearía igual, pero la UI no debe ofrecerlas).
//   - Equipo (miembros/invitaciones): estado "Próximamente" honesto (llega en Fase 5 / B.1.3).
//   - Cerrar sesión (T6.2 / R1.6): abajo del todo, DIFERENCIADA (destructiva, $terracota), en la
//     thumb-zone (tercio inferior). signOut() → el RootGate re-rutea al grupo de auth.
//
// Eliminar campo (R3.6.1): ANTES de borrar, confirmación destructiva (Alert nativo) + warning con
// el CONTEO de miembros activos que perderán acceso. Tras borrar, refreshEstablishments() → el
// contexto detecta la pérdida del activo (o re-resuelve sobre los restantes) y el RootGate
// re-rutea (Mis campos / wizard / home) — camino ya manejado por active_lost (R6.10).
//
// Diseño (🟡 pantalla mixta, no manga-crítica): jerarquía clara (títulos de sección $textMuted
// chicos, filas con label + chevron/acción); filas iguales se ven iguales (consistencia); acciones
// destructivas diferenciadas ($terracota) y abajo (thumb-zone); confirmación obligatoria en lo
// destructivo (Nielsen #5 + #3); touch-targets ≥56px ($touchMin) en las filas; tokens-only
// (ADR-023 §4); voseo argentino.

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, Platform, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getTokenValue, ScrollView, Text, View, XStack, YStack } from 'tamagui';
import { Building2, ChevronRight, LogOut, Pencil, Trash2, Users } from 'lucide-react-native';

import { Button, Card, FormField, FormError, InfoNote } from '@/components';
import { useAuth, useEstablishment } from '@/contexts';
import {
  countActiveMembers,
  loadFullProfile,
  saveProfile,
  softDeleteEstablishment,
  type FullProfile,
} from '@/services/establishments';
import { validateProfile } from '@/utils/validation';

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

// ─── Sección Perfil (R2.1): ver + editar nombre/teléfono; email solo-lectura ─────

function ProfileSection({ userId }: { userId: string }) {
  const [profile, setProfile] = useState<FullProfile | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    const result = await loadFullProfile(userId);
    if (result.ok) {
      setProfile(result.profile);
      setLoadError(null);
    } else {
      setLoadError(
        result.error.kind === 'network' ? OFFLINE_COPY : 'No pudimos cargar tu perfil.',
      );
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loadError && !profile) {
    return (
      <YStack gap="$2">
        <FormError message={loadError} />
        <Button variant="secondary" fullWidth onPress={() => void load()}>
          Reintentar
        </Button>
      </YStack>
    );
  }

  if (!profile) {
    return <InfoNote>Cargando tu perfil…</InfoNote>;
  }

  if (editing) {
    return (
      <ProfileEditForm
        userId={userId}
        initial={profile}
        onSaved={(updated) => {
          setProfile(updated);
          setEditing(false);
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <Card gap="$3">
      <ProfileField label="Nombre" value={profile.name || '—'} />
      {/* Email SOLO-LECTURA: cambiarlo dispara verificación (R2.2) → TODO Fase 5. */}
      <ProfileField label="Email" value={profile.email || '—'} hint="Para cambiar tu email, escribinos. Próximamente desde acá." />
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

function ProfileEditForm({
  userId,
  initial,
  onSaved,
  onCancel,
}: {
  userId: string;
  initial: FullProfile;
  onSaved: (updated: FullProfile) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [phone, setPhone] = useState(initial.phone ?? '');
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
    const result = await saveProfile(userId, { name, phone: nextPhone });
    setSaving(false);

    if (result.ok) {
      onSaved({ ...initial, name: name.trim(), phone: nextPhone });
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
        error={nameError}
      />
      <FormField
        label="Teléfono"
        value={phone}
        onChangeText={setPhone}
        placeholder="Ej. 11 2345 6789"
        keyboardType="phone-pad"
        autoComplete="tel"
        textContentType="telephoneNumber"
        error={phoneError}
      />
      <FormError message={formError} />
      <Button variant="primary" fullWidth disabled={saving} onPress={onSubmit}>
        {saving ? 'Guardando…' : 'Guardar'}
      </Button>
      <Button variant="secondary" fullWidth onPress={onCancel}>
        Cancelar
      </Button>
    </Card>
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

        {/* ── Campo activo (R3.4 / R3.6) — acciones OWNER-ONLY ── */}
        {activeField ? (
          <>
            <SectionTitle>{`Campo activo · ${activeField.name}`}</SectionTitle>
            {isOwner ? (
              <Card padding="$0" gap="$0" overflow="hidden">
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
              </Card>
            ) : (
              <InfoNote>
                Solo el dueño del campo puede editar o eliminar sus datos. Vos sos miembro de este
                campo.
              </InfoNote>
            )}
          </>
        ) : null}

        {/* ── Equipo (miembros/invitaciones) — Fase 5 / B.1.3 ── */}
        <SectionTitle>Equipo</SectionTitle>
        <Card>
          <XStack alignItems="center" gap="$3">
            <View width="$icon" alignItems="center" flexShrink={0}>
              <Users size={20} color={muted} strokeWidth={2} />
            </View>
            <YStack flex={1} minWidth={0} gap="$1">
              <Text fontFamily="$body" fontSize="$5" fontWeight="500" color="$textPrimary">
                Miembros e invitaciones
              </Text>
              <Text fontFamily="$body" fontSize="$3" fontWeight="400" color="$textMuted">
                Próximamente vas a poder invitar a tu vet o capataz y administrar permisos.
              </Text>
            </YStack>
          </XStack>
        </Card>

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
