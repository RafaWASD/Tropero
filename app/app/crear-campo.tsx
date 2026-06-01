// app/crear-campo.tsx — CreateEstablishmentScreen + gate de teléfono (spec 01, T4.4).
//
// Cubre R3.1 (crear), R3.2 (owner automático vía trigger 0011), R3.3 (nombre + provincia
// obligatorios; ciudad y hectáreas opcionales), R3.8 (gate de teléfono), R9.2 (crear campo
// REQUIERE conexión → copy accionable ante error de red).
//
// Flujo de dos fases en la misma ruta:
//   1. GATE DE TELÉFONO (R3.8): al montar, leemos users.phone. Si está vacío, mostramos
//      CompletePhoneScreen — pide el teléfono y lo guarda en public.users ANTES de seguir.
//   2. FORM DE ALTA: name + province (obligatorios) + city + hectáreas (opcionales).
//      Al crear OK: refreshEstablishments(nuevoId) — UNA sola llamada que re-lee el set (ahora
//      con el campo nuevo) y lo fija activo (R6.3) en la misma operación → el gating raíz
//      aterriza en su home. NUNCA se hardcodea establishment_id ni owner: el trigger los deriva
//      de auth.uid().
//
// Cero hardcode (ADR-023 §4): AuthScreenShell + FormField + Button + FormError/InfoNote +
// tokens. Voseo argentino.

import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { YStack } from 'tamagui';

import { AuthScreenShell, Button, FormField, FormError, InfoNote } from '@/components';
import { useAuth, useEstablishment } from '@/contexts';
import {
  createEstablishment,
  loadOwnProfile,
  saveOwnPhone,
} from '@/services/establishments';
import { isValidPhone, validateCreateEstablishment } from '@/utils/validation';
import { hasDuplicateName, parseHectares } from '@/utils/establishment';

// Copy accionable ante falta de conexión (R9.2): crear campo es operación online.
const OFFLINE_COPY =
  'Necesitás conexión para crear un campo. Conectate a internet y volvé a intentar.';

type Phase = 'loading' | 'need_phone' | 'form';

export default function CrearCampoScreen() {
  const router = useRouter();
  const { state: authState } = useAuth();
  const { refreshEstablishments } = useEstablishment();

  const userId = authState.status === 'authenticated' ? authState.user.id : null;

  const [phase, setPhase] = useState<Phase>('loading');

  // ── Gate de teléfono (R3.8) ──────────────────────────────────────────────────
  useEffect(() => {
    if (!userId) return;
    let active = true;
    (async () => {
      const result = await loadOwnProfile(userId);
      if (!active) return;
      if (!result.ok) {
        // Si no pudimos leer el perfil (red), entramos al gate de teléfono por seguridad:
        // mejor pedirlo que crear el campo sin contacto. El guardado del teléfono también
        // requiere red, así que el copy de offline aparecerá ahí si sigue sin conexión.
        setPhase('need_phone');
        return;
      }
      setPhase(result.profile.phone && result.profile.phone.trim().length > 0 ? 'form' : 'need_phone');
    })();
    return () => {
      active = false;
    };
  }, [userId]);

  if (phase === 'loading') {
    return (
      <AuthScreenShell title="Crear campo" subtitle="Un momento…">
        <YStack gap="$4" marginTop="$2">
          <InfoNote>Cargando…</InfoNote>
        </YStack>
      </AuthScreenShell>
    );
  }

  if (phase === 'need_phone') {
    return (
      <CompletePhoneScreen
        userId={userId}
        onSaved={() => setPhase('form')}
        onCancel={() => router.back()}
      />
    );
  }

  return (
    <CreateForm
      userId={userId}
      onCreated={async (newId) => {
        // Re-leemos el set (ahora incluye el campo nuevo) fijándolo como preferido en la MISMA
        // operación (R6.3). Una sola llamada: refreshEstablishments(newId) recarga del server y
        // resuelve `active` directo sobre el campo nuevo. NO encadenamos un switchEstablishment
        // posterior: ese leería un `available` que aún no reflejaba el set fresco (timing async
        // de setState) y falseaba active_lost — aterrizaba en /campo-perdido en vez de la home.
        await refreshEstablishments(newId);
        // El gating raíz (RootGate) detecta 'active' sobre el campo nuevo y aterriza en su
        // home. Reemplazamos para no dejar el form en el back-stack.
        router.replace('/(tabs)');
      }}
    />
  );
}

// ─── Gate de teléfono (R3.8) ────────────────────────────────────────────────────

function CompletePhoneScreen({
  userId,
  onSaved,
  onCancel,
}: {
  userId: string | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit() {
    setError(null);
    if (!isValidPhone(phone)) {
      setError('Ingresá un teléfono válido (al menos 8 dígitos).');
      return;
    }
    if (!userId) {
      setError('No pudimos identificar tu cuenta. Cerrá sesión y volvé a entrar.');
      return;
    }
    setSaving(true);
    const result = await saveOwnPhone(userId, phone);
    setSaving(false);
    if (result.ok) {
      onSaved();
    } else {
      setError(result.error.kind === 'network' ? OFFLINE_COPY : 'No pudimos guardar el teléfono. Probá de nuevo.');
    }
  }

  return (
    <AuthScreenShell
      title="Tu teléfono"
      subtitle="Para crear un campo necesitamos un teléfono de contacto. Lo guardamos en tu perfil."
    >
      <YStack gap="$4" marginTop="$2">
        <FormField
          label="Teléfono"
          value={phone}
          onChangeText={setPhone}
          placeholder="Ej. 11 2345 6789"
          keyboardType="phone-pad"
          autoComplete="tel"
          textContentType="telephoneNumber"
          error={error}
        />
        <Button variant="primary" fullWidth disabled={saving} onPress={onSubmit}>
          {saving ? 'Guardando…' : 'Continuar'}
        </Button>
        <Button variant="secondary" fullWidth onPress={onCancel}>
          Cancelar
        </Button>
      </YStack>
    </AuthScreenShell>
  );
}

// ─── Form de alta (R3.1/R3.3) ───────────────────────────────────────────────────

function CreateForm({
  userId,
  onCreated,
}: {
  userId: string | null;
  onCreated: (newId: string) => void | Promise<void>;
}) {
  const router = useRouter();
  // `recents` es el set de campos accesibles del usuario (con nombres) → fuente para detectar
  // nombres duplicados (Run 2 f). Se advierte (no se bloquea) si el nombre tipeado coincide.
  const { recents } = useEstablishment();
  const [name, setName] = useState('');
  const [province, setProvince] = useState('');
  const [city, setCity] = useState('');
  const [hectares, setHectares] = useState('');

  const [nameError, setNameError] = useState<string | null>(null);
  const [provinceError, setProvinceError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Advertencia NO bloqueante (Run 2 f): el nombre coincide con un campo existente del usuario.
  // En vivo mientras tipea; no bloquea el submit (decisión council). En ALTA no se excluye nada
  // (el campo nuevo aún no existe en `recents`).
  const duplicateName = hasDuplicateName(name, recents);

  async function onSubmit() {
    setFormError(null);
    const v = validateCreateEstablishment({ name, province });
    setNameError(v.name);
    setProvinceError(v.province);
    if (!v.valid) return;

    if (!userId) {
      setFormError('No pudimos identificar tu cuenta. Cerrá sesión y volvé a entrar.');
      return;
    }

    // Hectáreas: opcional. Parseo tolerante (coma o punto decimal). Si no es número, lo
    // ignoramos (no bloqueamos el alta por un campo opcional mal tipeado).
    const parsedHa = parseHectares(hectares);

    setCreating(true);
    const result = await createEstablishment(userId, {
      name,
      province,
      city: city.trim() || null,
      totalHectares: parsedHa,
    });
    setCreating(false);

    if (result.ok) {
      await onCreated(result.establishment.id);
    } else {
      setFormError(result.error.kind === 'network' ? OFFLINE_COPY : 'No pudimos crear el campo. Probá de nuevo.');
    }
  }

  return (
    <AuthScreenShell
      title="Crear campo"
      subtitle="Datos básicos de tu establecimiento. Después podés completar el resto."
    >
      <YStack gap="$4" marginTop="$2">
        <FormField
          label="Nombre del campo"
          value={name}
          onChangeText={setName}
          placeholder="Ej. La Juanita"
          autoCapitalize="words"
          error={nameError}
        />
        {/* Advertencia NO bloqueante de nombre duplicado (Run 2 f): hint muted, no error rojo.
            El submit NO se bloquea — podés crear igual. */}
        {duplicateName ? (
          <InfoNote>Ya tenés un campo con este nombre. Podés crearlo igual.</InfoNote>
        ) : null}
        <FormField
          label="Provincia"
          value={province}
          onChangeText={setProvince}
          placeholder="Ej. Buenos Aires"
          autoCapitalize="words"
          error={provinceError}
        />
        <FormField
          label="Ciudad (opcional)"
          value={city}
          onChangeText={setCity}
          placeholder="Ej. Chascomús"
          autoCapitalize="words"
        />
        <FormField
          label="Hectáreas (opcional)"
          value={hectares}
          onChangeText={setHectares}
          placeholder="Ej. 1200"
          keyboardType="numeric"
        />

        <FormError message={formError} />

        <Button variant="primary" fullWidth disabled={creating} onPress={onSubmit}>
          {creating ? 'Creando…' : 'Crear campo'}
        </Button>
        <Button variant="secondary" fullWidth onPress={() => router.back()}>
          Cancelar
        </Button>
      </YStack>
    </AuthScreenShell>
  );
}
