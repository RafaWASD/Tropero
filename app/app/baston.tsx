// app/baston.tsx — ruta de la PANTALLA DE CONEXIÓN del bastón (delta multivendor, RMV3.1; ADR-018:
// vive en "Más", el listener es global, no una tab). Es un re-export delgado: la pantalla es
// territorio de 04 (`features/ble-stick/`), consume el provider global montado en el layout raíz.
//
// La ENTRADA de "Más" que navega acá (una fila `ActionRow` en `(tabs)/mas.tsx`) la agrega quien sea
// dueño de `mas.tsx` (hoy la otra terminal — colisión-safe): la ruta ya queda registrada + alcanzable
// (deep-link `/baston`) desde este archivo + el `<Stack.Screen name="baston" />` del layout raíz.

export { default } from '@/features/ble-stick/screens/StickConnectionScreen';
