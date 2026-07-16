// polyfills.ts — polyfills de runtime que DEBEN correr antes que TODO el código de app.
//
// POR QUÉ y ORDEN (crítico — bring-up nativo):
//   La app se validó siempre en WEB; el primer build iOS (Hermes) crashea al boot porque Hermes
//   NO trae varias globals que el navegador y Node dan por sentadas y que nuestro código usa a
//   NIVEL MÓDULO (corren en el import, antes de cualquier gate de plataforma):
//
//   1. `URL` incompleta en Hermes → `@supabase/supabase-js` la usa dentro de createClient(), que
//      services/supabase.ts invoca a NIVEL MÓDULO (se importa vía `@/contexts` en app/_layout.tsx).
//      Sin un URL completo el arranque puede crashear ANTES de pintar nada. Lo cubre
//      react-native-url-polyfill.
//   2. `globalThis.crypto` NO existe en Hermes. ~10 services generan ids de cliente con
//      `globalThis.crypto.randomUUID()`. No crashea al boot (se llama dentro de funciones) pero
//      crashea al crear cualquier registro. Lo cubrimos con expo-crypto (native module, ya en deps).
//
//   Por eso este archivo se importa PRIMERO (ver app/index.js, el entry custom): así los polyfills
//   están en su lugar antes del createClient de supabase o de cualquier uso de crypto.
//
// WEB: NO-OP INTENCIONAL. En el navegador `URL` y `crypto` ya existen y son los REALES:
//   - react-native-url-polyfill/auto ya se auto-guarda con `Platform.OS !== 'web'` (no toca URL en web).
//   - El bloque de crypto de abajo es GUARDADO por método: solo rellena lo que falta, así NUNCA pisa
//     el WebCrypto real del browser (que además es el que ejercitan los ~70 e2e).

import 'react-native-url-polyfill/auto';
import { getRandomValues as expoGetRandomValues, randomUUID as expoRandomUUID } from 'expo-crypto';

// Forma mínima de `crypto` que la app necesita. No pretende ser el `Crypto` completo del DOM.
type MinimalCrypto = {
  randomUUID(): string;
  getRandomValues<T extends ArrayBufferView | null>(array: T): T;
};

// `globalThis as unknown as {...}` para no chocar con el tipo `Crypto` del lib.dom (donde exista)
// y evitar `any` crudo. Solo describimos lo que vamos a tocar.
const globalObject = globalThis as unknown as { crypto?: Partial<MinimalCrypto> };

// Hermes puede no exponer NINGÚN objeto `crypto`: creamos uno vacío para colgarle los métodos.
if (globalObject.crypto == null) {
  globalObject.crypto = {};
}

const cryptoObject = globalObject.crypto;

// GUARDADO por método: solo definimos lo que no exista. En web ambos ya existen (WebCrypto real),
// así que estos ifs son falsos y no pisamos nada.
if (typeof cryptoObject.randomUUID !== 'function') {
  cryptoObject.randomUUID = () => expoRandomUUID();
}

if (typeof cryptoObject.getRandomValues !== 'function') {
  cryptoObject.getRandomValues = <T extends ArrayBufferView | null>(array: T): T => {
    if (array == null) {
      return array;
    }
    // expo-crypto llena el buffer IN-PLACE (misma semántica que WebCrypto) y devuelve el mismo ref.
    // Acepta typed arrays de enteros — el único caso que WebCrypto.getRandomValues también soporta.
    const view: ArrayBufferView = array;
    expoGetRandomValues(view as Parameters<typeof expoGetRandomValues>[0]);
    return array;
  };
}
