// Lógica PURA de resolución/validación de las variables de entorno públicas.
//
// SIN imports de RN/expo: testeable con node:test (mismo patrón que exit-animal.ts ↔
// animals.ts). La lectura real de las vars (process.env / Constants.expoConfig.extra)
// vive en env.ts, que importa expo-constants y NO carga bajo node:test. Acá: el ensamblado
// + la validación fail-closed con un mensaje accionable en español.

export type RequiredEnv = {
  supabaseUrl: string;
  supabaseAnonKey: string;
  powersyncUrl: string;
  // OPCIONAL (spec 19, R7.4): el Web Client ID de Google (NO es secreto). Vive FUERA del check
  // fail-closed: su ausencia NO aborta el arranque (la app es buildable-now sin el ID de Raf; si
  // falta en runtime, el sign-in nativo de Google falla con DEVELOPER_ERROR → copy R6.3, degradado
  // aceptable). Se lee después del throw, así el resto de la app arranca igual.
  googleWebClientId?: string;
  // OPCIONAL (bring-up nativo): el iOS Client ID de Google (NO es secreto; ya público en el reversed
  // URL scheme del app.config.ts). Mismo régimen que googleWebClientId: fuera del fail-closed. El SDK
  // nativo de Google en iOS lo necesita en configure() — el config plugin solo setea el URL scheme
  // (CFBundleURLSchemes), NO el GIDClientID; sin este ID el signIn() nativo iOS falla.
  googleIosClientId?: string;
};

/** Lee el valor de una var pública por nombre. Devuelve undefined si no está o está vacía. */
export type EnvReader = (name: string) => string | undefined;

/**
 * Compone un EnvReader con precedencia (spec 16, R3.1/R3.2). PURA (testeable bajo node:test):
 *   1. `staticMap[name]` — accesos ESTÁTICOS literales (`process.env.EXPO_PUBLIC_X`) que
 *      `babel-preset-expo` inlinea en el build web de producción (R3.1). Sin esto, en el bundle web
 *      las vars quedan undefined (el acceso dinámico por key variable NO se inlinea).
 *   2. `dynamicRead(name)` — `process.env[name]` con key VARIABLE (dev server + shim E2E de
 *      fixtures.ts, que setea globalThis.process.env antes del boot; R3.2).
 *   3. `extraRead(name)` — `Constants.expoConfig.extra[name]` (último fallback; R3.2).
 * Devuelve el primer valor no vacío; si ninguno resuelve, undefined (resolveEnv decide el
 * fail-closed, R3.3). El orden garantiza: build web inlineado > runtime (dev/E2E) > extra.
 */
export function composeReader(
  staticMap: Record<string, string | undefined>,
  dynamicRead: EnvReader,
  extraRead: EnvReader,
): EnvReader {
  return (name) => {
    const s = staticMap[name];
    if (s && s.length > 0) return s;
    const d = dynamicRead(name);
    if (d && d.length > 0) return d;
    return extraRead(name);
  };
}

/**
 * Ensambla y valida el set de env requerido a partir de un reader. PURA (testeable): si falta
 * cualquiera de las tres, tira un Error con copy accionable en español (nunca un crash opaco, R1.3).
 * El mensaje nombra las tres vars y apunta a `.env.local`, igual que el error histórico de Supabase.
 */
export function resolveEnv(read: EnvReader): RequiredEnv {
  const supabaseUrl = read('EXPO_PUBLIC_SUPABASE_URL');
  const supabaseAnonKey = read('EXPO_PUBLIC_SUPABASE_ANON_KEY');
  const powersyncUrl = read('EXPO_PUBLIC_POWERSYNC_URL');

  if (!supabaseUrl || !supabaseAnonKey || !powersyncUrl) {
    throw new Error(
      'Faltan variables de entorno EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY ' +
        'o EXPO_PUBLIC_POWERSYNC_URL. Asegurate de tener .env.local en la raíz del repo.',
    );
  }

  // OPCIONALES, fuera del fail-closed (R7.4): si faltan, quedan undefined y la app arranca igual.
  const googleWebClientId = read('EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID');
  const googleIosClientId = read('EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID');

  return { supabaseUrl, supabaseAnonKey, powersyncUrl, googleWebClientId, googleIosClientId };
}
