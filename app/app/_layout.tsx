// app/_layout.tsx — layout raíz de RAFAQ (Expo Router).
//
// Monta los providers globales del frontend (ADR-013):
//   - GestureHandlerRootView: requerido por react-native-gesture-handler en la
//     raíz para que los gestos (swipes, long-press en manga) funcionen en todo
//     el árbol.
//   - SafeAreaProvider: insets seguros (notch / home indicator).
//   - TamaguiProvider: inyecta el design system (tamagui.config.ts).
//   - AuthProvider (spec 01, T3.1): sesión Supabase Auth. El gating de navegación
//     raíz se hace según el AuthState (ver AuthGate abajo).
//
// Gating de navegación (spec 01, R1.3 / R7.* / design.md §Navegación raíz):
//   - loading                          → splash (no renderizamos rutas hasta saber)
//   - unauthenticated                  → grupo (auth): SignIn / SignUp / ForgotPassword
//   - authenticated + email NO verif.  → /verify-email (EmailVerificationGate, R1.3)
//   - authenticated + verificado       → gating de ESTABLECIMIENTO (Fase 4 / B.1.2):
//       · loading            → splash (el contexto aún carga las memberships)
//       · no_establishments  → /onboarding (wizard R6.5)
//       · choosing (≥2)      → /mis-campos (selector, landing R6.7)
//       · active (1 o fijo)  → (tabs) (home del campo activo, R6.4/R6.7)
//       · active_lost        → /campo-perdido (aviso R6.10 + re-ruteo, sin logout R7.4)
// Las rutas /maniobra, /mis-campos, /update-password, /onboarding, /crear-campo,
// /campo-perdido se mantienen accesibles.
//
// Carga de fuentes (A.1): cargamos Inter de verdad (400/500/600/700).
//
// Splash nativo (fix loop sesión 21, FIX 1 — evita el flash de (tabs) en cold start):
//   RootLayout NO renderiza el árbol de navegación hasta que las FUENTES están listas
//   (devuelve null), y NO oculta el splash por su cuenta. El splash nativo se mantiene
//   visible hasta que TAMBIÉN la sesión resuelva (AuthState.status !== 'loading'): es el
//   AuthGate quien llama a SplashScreen.hideAsync(), recién DESPUÉS de re-rutear según el
//   estado. Así, al destaparse el splash, ya estamos en la ruta correcta y nunca se ve un
//   frame de (tabs) con datos mock cuando el usuario no tiene sesión.
//   Fallbacks por timeout: ~3s para las fuentes (RootLayout) y ~5s para auth (AuthGate),
//   para no quedar colgados en el splash si algo no resuelve.

import 'react-native-gesture-handler';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { TamaguiProvider } from 'tamagui';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter';

import config from '../tamagui.config';
import {
  AuthProvider,
  EstablishmentProvider,
  ProfileProvider,
  RodeoProvider,
  useAuth,
  useEstablishment,
  useRodeo,
} from '@/contexts';
import { getPendingInvitationToken } from '@/services/pending-invitation';
import { PowerSyncProvider } from '@/services/powersync/provider';
import { FIRST_SYNC_TIMEOUT_MS } from '@/services/powersync/first-sync';
import { BleStickListenerProvider } from '@/services/ble/BleStickListenerProvider';
import { FindOrCreateOverlay } from './_components/FindOrCreateOverlay';
import { BleE2EBridge } from './_components/BleE2EBridge';
import { isBleE2E } from './_components/ble-e2e-flag';

// Fallback que destapa el splash si NADA resuelve (getSession/memberships colgados). DEBE ser MAYOR
// que FIRST_SYNC_TIMEOUT_MS (la espera del primer sync en EstablishmentContext, ~4500ms): así, cuando
// el splash se destapa, el contexto YA resolvió su ruta (con datos usables, timeout, o 'cached') y no
// se ve un frame de onboarding/(tabs) erróneo. Si el sync llega DESPUÉS del destape, el listener
// statusChanged del EstablishmentContext re-rutea de onboarding a home sin intervención del usuario.
const SPLASH_FALLBACK_MS = FIRST_SYNC_TIMEOUT_MS + 500;

SplashScreen.preventAutoHideAsync().catch(() => {
  /* noop: en web/algunos targets puede no estar disponible */
});

// Grupo de rutas de auth (debe coincidir con el nombre del directorio app/(auth)).
const AUTH_GROUP = '(auth)';
const VERIFY_ROUTE = 'verify-email';
// Rutas accesibles SIN estar autenticado/verificado (no las re-ruteamos): la pantalla
// de actualizar contraseña (destino del link de reset) puede alcanzarse en medio del
// flujo de recuperación; y /invite (aceptar invitación, Fase 5) puede abrirse vía deep-link
// por alguien sin sesión — ahí ofrece Registrarme/Iniciar sesión persistiendo el token (R5.13),
// así que NO debemos rebotarlo a sign-in (perdería el contexto de la invitación).
const PUBLIC_ROUTES = new Set(['update-password', 'invite']);

// Rutas del gating de ESTABLECIMIENTO (Fase 4). Top-segment de cada destino.
const ONBOARDING_ROUTE = 'onboarding'; // wizard sin campos (R6.5)
const MIS_CAMPOS_ROUTE = 'mis-campos'; // selector / landing ≥2 (R6.6/R6.7)
const CREAR_CAMPO_ROUTE = 'crear-campo'; // alta de campo (R3.1) — destino navegable, NO se re-rutea desde acá
// 'editar-campo' (R3.4) es un destino navegable más en estado 'active': NO está en
// strandedOnGatingRoute, así que el gate no lo expulsa a (tabs) mientras se edita. Se registra
// en el Stack abajo; no necesita constante de re-ruteo porque nunca se re-rutea desde 'active'.
const CAMPO_PERDIDO_ROUTE = 'campo-perdido'; // aviso active_lost (R6.10)
const INVITE_ROUTE = 'invite'; // aceptar invitación (R5.4) — destino navegable desde wizard/mis-campos
// Destinos de Fase 5 que el usuario abre explícitamente y NO deben re-rutearse mientras estén
// abiertos, en CUALQUIER estado de establecimiento (no solo 'active'): /invite lo abre tanto un
// usuario con 0 campos (invitado nuevo, estado no_establishments) como uno con ≥2 (choosing); si
// lo rebotáramos a onboarding/mis-campos perdería el flujo de aceptación. /invitar y /miembros se
// abren desde 'active' (owner), pero los listamos por robustez. Ver gating abajo.
const FASE5_DESTINATIONS = new Set([INVITE_ROUTE, 'invitar', 'miembros']);

// Rutas del gating de RODEO (spec 02 C1). El chequeo de rodeo corre DESPUÉS del de
// establecimiento (solo en estado 'active'): un campo recién creado arranca con 0 rodeos →
// bloqueo total hacia el wizard "Crear rodeo" (R2.6). 'rodeos' (gestión) y 'editar-plantilla'
// son destinos navegables del owner que NO se re-rutean (no son del bloqueo total).
const CREAR_RODEO_ROUTE = 'crear-rodeo'; // wizard (R2.6) — destino del bloqueo total + de RodeosScreen
const RODEOS_ROUTE = 'rodeos'; // gestión de rodeos (owner) — destino navegable desde "Más"
const EDITAR_PLANTILLA_ROUTE = 'editar-plantilla'; // editar plantilla (owner) — destino navegable
const LOTES_ROUTE = 'lotes'; // gestión de lotes (spec 02 C4, ADR-020) — destino desde Rodeos/"Más"
const IMPORT_RODEO_ROUTE = 'import-rodeo'; // wizard de importación masiva (spec 12) — destino owner/vet desde Rodeos
// Destinos de C1 que el usuario abre con un rodeo YA existente (estado 'active' de rodeo) y NO
// deben re-rutearse al wizard. crear-rodeo entra acá también (crear un 2do rodeo desde la lista).
// import-rodeo (spec 12): destino del owner/vet desde Rodeos con un rodeo existente; no se expulsa
// a (tabs) en estado 'active' (igual que rodeos/editar-plantilla).
const RODEO_DESTINATIONS = new Set([
  RODEOS_ROUTE,
  EDITAR_PLANTILLA_ROUTE,
  CREAR_RODEO_ROUTE,
  IMPORT_RODEO_ROUTE,
  LOTES_ROUTE,
]);

// Destinos de C2 (animales): el alta find-or-create (R4) y la ficha del animal (R5). Son
// navegación legítima desde la tab Animales con un rodeo YA existente (estado 'active' de rodeo)
// y NO deben re-rutearse al wizard ni a (tabs). 'animal' es el top-segment de /animal/[id].
const CREAR_ANIMAL_ROUTE = 'crear-animal'; // AnimalCreateScreen (R4)
const ANIMAL_ROUTE = 'animal'; // ficha del animal /animal/[id] (R5)
const AGREGAR_EVENTO_ROUTE = 'agregar-evento'; // wizard "Agregar evento" desde la ficha (C3.1)
const ANIMAL_DESTINATIONS = new Set([CREAR_ANIMAL_ROUTE, ANIMAL_ROUTE, AGREGAR_EVENTO_ROUTE]);

// Destinos de spec 10 (operaciones masivas por grupo): la vista de grupo de un rodeo (/rodeo/[id]) o
// lote (/lote/[id]) — se llega desde Inicio (tabs) con un rodeo existente — y los flujos de operación
// masiva (selección explícita / vacunación). Son navegación legítima en estado 'active'; NO se re-rutean.
// 'rodeo' y 'lote' son los top-segments de /rodeo/[id] y /lote/[id].
const GROUP_DESTINATIONS = new Set([
  'rodeo',
  'lote',
  'seleccion-masiva',
  'vacunacion-masiva',
]);

// Harness de DEV/TEST (spec 04 R5, /baston-test): pantalla WEB-ONLY para validar el
// adapter-web-serial contra el RS420 real, sin pasar por el gating de auth/establecimiento/
// rodeo. Sin este bypass, una sesión web no logueada (o sin campo/rodeo activo) rebotaría a
// sign-in/onboarding/crear-rodeo y el harness sería inalcanzable — justo lo contrario del
// objetivo "probar en pnpm web lo antes posible". Solo aplica en web (Platform.OS==='web'):
// en native la ruta no funciona (Web Serial no existe) y queda gateada como cualquier otra.
// Cero superficie de seguridad (frontend puro, sin red/DB). Reversible: borrar este Set + el
// early-return del efecto de abajo.
const DEV_WEB_ROUTES = new Set(['baston-test']);

/**
 * Gate unificado de navegación: auth (R1.3 / R7.*) + establecimiento (Fase 4: R6.4–R6.10).
 * Vive DENTRO de AuthProvider + EstablishmentProvider (usa useAuth/useEstablishment) y del
 * árbol de navegación (useSegments/useRouter). Reacciona a cambios de estado re-ruteando.
 *
 * Orden de decisión:
 *   1. auth loading                        → no re-rutea (splash).
 *   2. unauthenticated                     → /(auth)/sign-in.
 *   3. authenticated + !emailVerified      → /verify-email.
 *   3.5 authenticated + verificado + TOKEN DE INVITACIÓN PENDIENTE (R5.13) → /invite?token=…
 *        FUENTE ÚNICA del re-ruteo del token (Opción A). Toma precedencia sobre el gating de
 *        establecimiento, así cubre TODOS los aterrizajes post-auth, no solo no_establishments:
 *        un usuario EXISTENTE con campos que se desloguea, abre /invite, va a sign-in y vuelve
 *        logueado+verificado aterriza en (tabs)/mis-campos SIN pasar por verify-email/onboarding;
 *        si el re-ruteo viviera solo en esos seams, el token quedaría huérfano y la invitación
 *        nunca se aceptaría. Guard one-shot (useRef) + chequeo de no-estar-ya-en-/invite contra loop.
 *   4. authenticated + verificado          → delega al EstablishmentState:
 *        loading           → no re-rutea (splash; el contexto está cargando memberships).
 *        no_establishments → /onboarding (R6.5).
 *        choosing (≥2)     → /mis-campos (selector, R6.7).
 *        active            → (tabs) (home del campo activo, R6.4/R6.7).
 *        active_lost       → /campo-perdido (aviso R6.10, sin logout R7.4).
 *
 * Rutas "destino" (a las que el usuario navega explícitamente, NO se re-rutean fuera de
 * ellas mientras estén abiertas): crear-campo (alta de campo desde wizard/switch/mis-campos)
 * y mis-campos (que también es landing). Ver ALLOWED_WHEN_ACTIVE.
 */
function RootGate() {
  const { state: auth } = useAuth();
  const { state: est } = useEstablishment();
  const { state: rodeo } = useRodeo();
  const segments = useSegments();
  const router = useRouter();

  // R5.13 (FUENTE ÚNICA, Opción A) — token de invitación pendiente.
  // La lectura del store (expo-secure-store / localStorage) es ASYNC, pero el efecto de gating es
  // SYNC (decide ruta a partir de auth/est en el mismo ciclo). Para que el gating pueda consultar el
  // token sin await, lo mantenemos en state: un efecto chico lo lee con getPendingInvitationToken()
  // cuando el usuario está authenticated && emailVerified, y lo limpia del state si deja de estarlo
  // (logout / sesión perdida) — así un token viejo no re-dispara el re-ruteo en otra sesión.
  const isAuthedVerified = auth.status === 'authenticated' && auth.emailVerified;
  const [pendingInviteToken, setPendingInviteToken] = useState<string | null>(null);
  // Guard one-shot: una vez que mandamos a /invite por un token pendiente, no volvemos a forzarlo en
  // este mount. Cubre el caso 5 ("Ahora no" → router.replace('/(tabs)')): el usuario salió de /invite
  // a propósito; sin el guard, el gating de 'active' lo dejaría en (tabs) pero el token (que sigue en
  // storage hasta que lo acepte) volvería a empujarlo a /invite en cada re-render → loop/flash. Con el
  // guard one-shot, el re-prompt recién puede ocurrir en un cold-start futuro (mount nuevo), que es
  // aceptable por el brief.
  const reroutedForInvite = useRef(false);
  useEffect(() => {
    if (!isAuthedVerified) {
      // No autenticado/verificado → no debe haber token “armado”. Lo limpiamos del state (no del
      // storage: el store lo administra invite.tsx al aceptar/errores terminales) y reseteamos el
      // guard para el próximo login.
      setPendingInviteToken(null);
      reroutedForInvite.current = false;
      return;
    }
    let active = true;
    getPendingInvitationToken().then((token) => {
      if (active) setPendingInviteToken(token);
    });
    return () => {
      active = false;
    };
  }, [isAuthedVerified]);

  // FIX 1 (heredado de B.1.1): el splash nativo se oculta UNA sola vez, recién cuando el
  // gating resolvió (o por timeout). El ref evita ocultar dos veces.
  const splashHidden = useRef(false);
  const hideSplashOnce = useCallback(() => {
    if (splashHidden.current) return;
    splashHidden.current = true;
    SplashScreen.hideAsync().catch(() => {
      /* noop: web/algunos targets */
    });
  }, []);

  // Fallback de seguridad: si algo nunca resuelve (getSession/memberships colgados), no
  // dejamos la app trabada en el splash. Tras SPLASH_FALLBACK_MS (= FIRST_SYNC_TIMEOUT_MS + margen)
  // destapamos igual; el gate seguirá re-ruteando cuando el estado cambie (el listener statusChanged
  // del EstablishmentContext re-rutea de onboarding a home si el sync baja tarde).
  useEffect(() => {
    const timer = setTimeout(hideSplashOnce, SPLASH_FALLBACK_MS);
    return () => clearTimeout(timer);
  }, [hideSplashOnce]);

  useEffect(() => {
    if (auth.status === 'loading') return;

    const top = segments[0] ?? '';
    const inAuthGroup = top === AUTH_GROUP;
    const inVerify = top === VERIFY_ROUTE;
    const inPublic = PUBLIC_ROUTES.has(top);

    // Bypass de gating para harnesses de dev web (ver DEV_WEB_ROUTES): alcanzables directo en
    // `pnpm web` sin sesión / campo / rodeo, así Raf puede probar el bastón sin rebotar a login.
    if (Platform.OS === 'web' && DEV_WEB_ROUTES.has(top)) {
      hideSplashOnce();
      return;
    }

    if (auth.status === 'unauthenticated') {
      // Sin sesión → al grupo de auth (salvo ruta pública como reset).
      if (!inAuthGroup && !inPublic) router.replace('/(auth)/sign-in');
      hideSplashOnce();
      return;
    }

    if (!auth.emailVerified) {
      // Email sin verificar → gate de verificación (R1.3). Permitimos rutas públicas.
      if (!inVerify && !inPublic) router.replace('/verify-email');
      hideSplashOnce();
      return;
    }

    // R5.13 (FUENTE ÚNICA, Opción A) — re-ruteo del token de invitación pendiente. Va DESPUÉS del
    // gate de emailVerified (no aceptamos sin verificar) y ANTES del gating de establecimiento, así
    // toma precedencia sobre home/mis-campos/onboarding/campo-perdido y cubre TODOS los aterrizajes
    // post-auth — incluido el del usuario existente con campos (EL BUG). Condiciones:
    //   - hay token en state (lo cargó el efecto de arriba cuando auth quedó verificado),
    //   - no estamos YA en /invite (top !== INVITE_ROUTE) — si ya estamos ahí, dejamos que invite.tsx
    //     maneje el flujo (confirm/accept) sin re-empujar (caso 4: usuario logueado abre /invite directo),
    //   - el guard one-shot no se consumió (evita el loop del caso 5 "Ahora no" → (tabs)).
    // Matriz cubierta (ver impl_01-frontend-fase5.md):
    //   1) nuevo usuario verifica con token → cae acá tras verify → /invite (ya no hace falta el seam de
    //      verify-email; lo eliminamos por eso). 2) nuevo sin campos idem (no llega a onboarding).
    //   3) EXISTENTE con campos logueado → /invite (EL FIX). 4) ya logueado abre /invite → no re-empuja
    //      (top === INVITE_ROUTE). 5) "Ahora no" → guard ya consumido → no rebota. 6) tras aceptar OK
    //      invite.tsx limpió el token → en el próximo ciclo no hay token (y el guard tampoco rebota).
    //      7) error terminal → invite.tsx limpió el token → ídem.
    if (pendingInviteToken && top !== INVITE_ROUTE && !reroutedForInvite.current) {
      reroutedForInvite.current = true;
      router.replace({ pathname: '/invite', params: { token: pendingInviteToken } });
      hideSplashOnce();
      return;
    }

    // authenticated + verificado → gating de ESTABLECIMIENTO (Fase 4).
    if (est.status === 'loading') {
      // El contexto está cargando memberships: mantenemos el splash hasta que resuelva
      // (igual que con la sesión). No re-ruteamos a ciegas para no flashear (tabs).
      return;
    }

    // Si estamos en una ruta de auth/verify y ya pasamos esos gates, hay que salir de ahí.
    const inAuthFlow = inAuthGroup || inVerify;
    // Rutas que el usuario abre explícitamente y NO deben re-rutearse mientras el estado
    // sea 'active' (si las re-ruteáramos, no podría crear un campo ni navegar el switch).
    const onCrearCampo = top === CREAR_CAMPO_ROUTE;
    // Aceptar invitación (R5.4): destino navegable en CUALQUIER estado de establecimiento — un
    // invitado nuevo (0 campos) lo abre desde el wizard, uno con ≥2 desde "Mis campos". No lo
    // rebotamos a onboarding/mis-campos (perdería la aceptación). /invitar y /miembros idem.
    const onFase5Destination = FASE5_DESTINATIONS.has(top);
    // Destinos de C1 (rodeo): el wizard "Crear rodeo" (bloqueo total + crear 2do rodeo), la
    // gestión de rodeos y editar plantilla. Son navegación legítima del owner; no se re-rutean.
    const onRodeoDestination = RODEO_DESTINATIONS.has(top);
    // Destinos de C2 (animales): el alta find-or-create (R4) y la ficha del animal (R5). Solo
    // tienen sentido con un rodeo existente; no se re-rutean en estado 'active' con rodeo.
    const onAnimalDestination = ANIMAL_DESTINATIONS.has(top);
    // Destinos de spec 10 (vista de grupo + operación masiva): navegables desde Inicio con rodeo.
    const onGroupDestination = GROUP_DESTINATIONS.has(top);

    if (est.status === 'no_establishments') {
      if (top !== ONBOARDING_ROUTE && !onCrearCampo && !onFase5Destination) router.replace('/onboarding');
    } else if (est.status === 'choosing') {
      if (top !== MIS_CAMPOS_ROUTE && !onCrearCampo && !onFase5Destination) router.replace('/mis-campos');
    } else if (est.status === 'active_lost') {
      if (top !== CAMPO_PERDIDO_ROUTE && !onFase5Destination) router.replace('/campo-perdido');
    } else if (est.status === 'active') {
      // Campo activo fijado → gating de RODEO (spec 02 C1, R2.6). El chequeo de rodeo va DESPUÉS
      // del de establecimiento (auth → email → token → establecimiento → RODEO), porque sin campo
      // activo no hay sobre qué rodeo decidir.
      if (rodeo.status === 'loading') {
        // El RodeoContext está cargando los rodeos del campo activo (o reintentando tras un fallo
        // de red): mantenemos el splash, igual que con memberships. NO afirmamos bloqueo a ciegas.
        return;
      }
      if (rodeo.status === 'no_rodeos') {
        // Bloqueo total (R2.6): el campo activo no tiene rodeos → wizard "Crear rodeo" como primera
        // pantalla. Bloquea TODO el resto de la app (incluido (tabs)/mis-campos). Solo dejamos
        // pasar el propio wizard. NO permitimos otros destinos de rodeo acá (rodeos/editar-plantilla
        // no tienen sentido sin un rodeo).
        if (top !== CREAR_RODEO_ROUTE) router.replace('/crear-rodeo');
      } else {
        // Hay rodeo activo → home. Forzamos a (tabs) solo si el usuario quedó "varado" en un destino
        // del gating que ya no aplica (auth, onboarding, campo-perdido). NO sacamos al usuario de
        // (tabs), mis-campos, crear-campo, los destinos de Fase 5, ni los destinos de rodeo
        // (rodeos/crear-rodeo/editar-plantilla = navegación legítima del owner).
        const strandedOnGatingRoute =
          inAuthFlow ||
          top === ONBOARDING_ROUTE ||
          top === CAMPO_PERDIDO_ROUTE;
        // No de-strand de un destino de rodeo (gestión), animales (alta/ficha) ni grupo (vista de
        // grupo / operación masiva): son navegación legítima desde Más / la tab Animales / Inicio.
        if (
          strandedOnGatingRoute &&
          !onRodeoDestination &&
          !onAnimalDestination &&
          !onGroupDestination
        ) {
          router.replace('/(tabs)');
        }
      }
    }

    // El re-ruteo ya quedó solicitado: ocultamos el splash en el mismo ciclo (FIX 1).
    hideSplashOnce();
  }, [auth, est, rodeo, segments, router, hideSplashOnce, pendingInviteToken]);

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="verify-email" />
      <Stack.Screen name="update-password" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="maniobra" options={{ presentation: 'modal' }} />
      {/* "Mis campos" (R6.6): pantalla standalone, header propio. */}
      <Stack.Screen name="mis-campos" />
      {/* Onboarding wizard (R6.5) — sin campos. */}
      <Stack.Screen name="onboarding" />
      {/* Alta de campo (R3.1/R3.8) — destino del wizard / switch / mis-campos. */}
      <Stack.Screen name="crear-campo" />
      {/* Edición de campo (R3.4) — destino owner-only desde "Más". */}
      <Stack.Screen name="editar-campo" />
      {/* Cambio de email (R2.1/R2.2) — destino desde "Más" (fila de email del perfil). Como
          editar-campo: NO está en strandedOnGatingRoute, así el gate no lo expulsa a (tabs)
          mientras se cambia el email. */}
      <Stack.Screen name="cambiar-email" />
      {/* Aviso de pérdida del campo activo (R6.10) — transitorio. */}
      <Stack.Screen name="campo-perdido" />
      {/* Fase 5 — equipo: Miembros (R5.x), Invitar (T5.2), Aceptar invitación (T5.4). */}
      <Stack.Screen name="miembros" />
      <Stack.Screen name="invitar" />
      <Stack.Screen name="invite" />
      {/* Spec 02 C1 — rodeos: wizard "Crear rodeo" (R2.6, también empty-state de bloqueo total),
          gestión de rodeos (owner) y editar plantilla de datos (owner, R2.12). */}
      <Stack.Screen name="crear-rodeo" />
      <Stack.Screen name="rodeos" />
      <Stack.Screen name="editar-plantilla" />
      {/* Spec 02 C4 — lotes (ADR-020): gestión (crear/renombrar/borrar + ver miembros), owner-gated.
          Destino navegable desde Rodeos / "Más" con un rodeo existente (no se re-rutea al wizard). */}
      <Stack.Screen name="lotes" />
      {/* Spec 12 — importación masiva de rodeo: wizard owner/vet (fuente+destino → mapeo →
          preview → resultado), destino navegable desde Rodeos con un rodeo existente. */}
      <Stack.Screen name="import-rodeo" />
      {/* Spec 02 C2 — animales: alta find-or-create (R4) y ficha del animal (R5). Destinos
          navegables desde la tab Animales con un rodeo existente (no se re-rutean al wizard). */}
      <Stack.Screen name="crear-animal" />
      <Stack.Screen name="animal/[id]" />
      {/* Spec 02 C3.3 — baja / egreso de animal desde la ficha (motivo + fecha + datos de venta). */}
      <Stack.Screen name="animal/baja" />
      {/* Spec 02 C3.1 — wizard "Agregar evento" desde la ficha (peso / condición / observación). */}
      <Stack.Screen name="agregar-evento" />
      {/* Spec 10 — vista de grupo (operaciones masivas por rodeo/lote): metadatos + config + lista de
          animales activos + acciones masivas. Destino navegable desde Inicio (card de rodeo/lote). */}
      <Stack.Screen name="rodeo/[id]" />
      <Stack.Screen name="lote/[id]" />
      {/* Spec 10 — flujos de operación masiva (selección explícita castrar/destetar; vacunación masiva).
          STUB navegable en este chunk (la pantalla real es del próximo chunk de Fase 4). */}
      <Stack.Screen name="seleccion-masiva" />
      <Stack.Screen name="vacunacion-masiva" />
    </Stack>
  );
}

/**
 * Host del flujo BLE de BUSCAR ANIMAL (spec 09 chunk "BLE global", RB1.2): el <Stack> de navegación +
 * el <FindOrCreateOverlay/> hermano (bottom-sheet que se renderiza POR ENCIMA de la pantalla activa sin
 * desmontarla) + el bridge de E2E (solo bajo el flag de Playwright, FUERA de producción). Vive dentro de
 * BleStickListenerProvider + los providers de datos → el overlay tiene Auth/PowerSync/Establishment/Rodeo
 * en contexto y puede consumir useBleStickListener.
 */
function BleHost() {
  return (
    <>
      <RootGate />
      <FindOrCreateOverlay />
      {isBleE2E() ? <BleE2EBridge /> : null}
    </>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter: Inter_400Regular,
    'Inter-Medium': Inter_500Medium,
    'Inter-SemiBold': Inter_600SemiBold,
    'Inter-Bold': Inter_700Bold,
  });

  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setTimedOut(true), 3000);
    return () => clearTimeout(timer);
  }, []);

  // Gate de FUENTES: hasta que cargan (o el timeout), no montamos el árbol de navegación
  // (devolvemos null y el splash nativo queda visible). NO ocultamos el splash acá: eso lo
  // hace el AuthGate cuando la sesión resuelve (FIX 1), así no se ve (tabs) antes del redirect.
  const ready = fontsLoaded || fontError != null || timedOut;

  if (!ready) {
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <TamaguiProvider config={config} defaultTheme="light">
          <StatusBar style="dark" />
          <AuthProvider>
            {/* PowerSyncProvider (spec 15, T1.7): provee el DB local de PowerSync al árbol
                (PowerSyncContext) y orquesta connect/disconnect según la sesión Supabase. Monta
                DENTRO de AuthProvider (lee el AuthState para saber cuándo hay sesión válida) y
                ENVUELVE a los providers de datos para que sus lecturas watchables puedan
                suscribirse al DB local. Sin sesión válida no conecta (fetchCredentials → null). */}
            <PowerSyncProvider>
              {/* ProfileProvider (Fase 6): fuente única del saludo (name/phone de public.users,
                  email del session). Monta DENTRO de AuthProvider (lee user.id/email del
                  AuthContext) y ENVUELVE a EstablishmentProvider + RootGate para que home /
                  onboarding puedan consumir useProfile(). Sin sesión queda neutro (no fetcha). */}
              <ProfileProvider>
              {/* EstablishmentProvider monta siempre, pero se auto-inhabilita sin sesión
                  verificada (lee user_id del AuthContext; sin user queda en 'loading' y no
                  consulta). Así no remonta al pasar los gates de auth y el gating de
                  establecimiento (RootGate) tiene contexto disponible. */}
              <EstablishmentProvider>
                {/* RodeoProvider (spec 02 C1): rodeo activo del campo activo. Monta DENTRO de
                    EstablishmentProvider (scope = campo activo) y ENVUELVE al RootGate para que el
                    gating de rodeo (bloqueo total R2.6) y las pantallas de C1 puedan usar useRodeo().
                    Sin campo activo queda en 'loading' y no fetcha (deps primitivas, sin loop). */}
                <RodeoProvider>
                  {/* BleStickListenerProvider (spec 04, montado por spec 09 chunk "BLE global", RB1.1):
                      listener global del bastón. Monta ENTRE RodeoProvider y el host BLE para que el
                      FindOrCreateOverlay tenga Auth/PowerSync/Establishment/Rodeo en contexto y pueda
                      scopear el lookup al campo activo + leer el rodeo default. NO auto-conecta el
                      transporte (RB1.3): la conexión la dispara un gesto (web-serial) o el MockAdapter
                      en E2E. mode='mock' SOLO bajo el flag de E2E (isBleE2E, fuera de producción);
                      'auto' en cualquier build normal (web-serial/manual por plataforma). baston-test
                      queda intacto (su provider es self-contained). */}
                  <BleStickListenerProvider mode={isBleE2E() ? 'mock' : 'auto'}>
                    <BleHost />
                  </BleStickListenerProvider>
                </RodeoProvider>
              </EstablishmentProvider>
              </ProfileProvider>
            </PowerSyncProvider>
          </AuthProvider>
        </TamaguiProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
