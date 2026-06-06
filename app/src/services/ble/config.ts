// Constantes del contrato de ingesta de EID y de los adaptadores de transporte (spec 04).
//
// Único punto de verdad para los valores ajustables del contrato: la ventana de dedup
// (R3.4 — ajustable, no hardcodeada en varios lugares), el UUID SPP del RS420 y el baud
// por defecto del harness web-serial. Mantenerlos acá deja el resto de los módulos
// (dedup, adaptadores) sin números mágicos.
//
// Puro: sin imports de RN ni I/O → importable desde código y desde node:test.

/**
 * Ventana de deduplicación por-TAG (R3.4). Reexportada desde dedup.ts, donde vive su única
 * definición (módulo puro testeable bajo node:test). Importarla desde acá o desde dedup.ts
 * da el mismo valor. Ajustable cambiando la constante en dedup.ts.
 */
export { DEDUP_WINDOW_MS } from './dedup';

/**
 * UUID del Serial Port Profile (RFCOMM) del Allflex RS420 (R6.1, R6.8). Lo consume el
 * adapter-spp-android (fuera de este run, dev build). Se declara acá para que el contrato
 * y los adaptadores compartan la constante.
 */
export const SPP_UUID = '00001101-0000-1000-8000-00805F9B34FB';

/**
 * Baud por defecto del harness web-serial (R5.2). El COM virtual del SPP ignora el baud
 * (SPP es baud-independiente, R6.8), pero la Web Serial API EXIGE pasar uno a port.open().
 */
export const DEFAULT_BAUD = 9600;
