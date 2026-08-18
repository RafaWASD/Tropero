/*
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *  baston-emulator — emulador de bastones RFID sobre ESP32 (banco de regresión del bastón, spec 04)
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * PARA QUÉ EXISTE
 * ---------------
 * Los tres bugs 🔴 del camino SPP de Android (commit dad711f) se cazaron LEYENDO el código nativo
 * de la librería, no ejecutando nada: el framing invertido (el adapter no habría emitido UNA sola
 * lectura), el `pairDevice()` que cuelga para siempre, y la cadena de reintentos que moría después
 * del primer fallo. Los tres eran de MÁQUINA DE ESTADOS y los tres estaban "escritos y testeados".
 * Un emulador los muestra en segundos. Este firmware es ese banco: emite el protocolo del Allflex
 * RS420 con fidelidad de campo y, sobre todo, **puede provocar los estados que rompen** (repetidos,
 * ráfagas, cortes, tramas malformadas, mudez).
 *
 * QUÉ NO ES
 * ---------
 * No es un RS420. Valida NUESTRO lado (adapter → framer → parser → dedup → UI → reconexión), no
 * las mañas del lector real. Lo que NO cubre está listado en el README, sección "Qué NO valida".
 *
 * LA TRAMA (capturada en campo con un lector real — specs/active/04-bluetooth-baston/field-findings.md
 * y app/src/services/ble/parser-rs420.ts)
 * ------------------------------------------------------------------------------------------------
 *   [0x02 STX] + "1000000" + <EID: 15 dígitos> + <YYMMDDHHMMSS: 12 dígitos> + \n   (a veces \r\n)
 *
 *   \x021000000982000364696050260530101701\r\n
 *        ^^^^^^^                            header fijo del lector (el parser lo descarta)
 *               ^^^^^^^^^^^^^^^             EID = 982000364696050 (el dato útil)
 *                              ^^^^^^^^^^^^ reloj del lector (el parser lo descarta)
 *
 * El generador de tramas y de EIDs vive en la sección 2 de ESTE archivo y es la ÚNICA fuente de
 * verdad para los tres modos. Duplicarlo es cómo se desincroniza del parser.
 *
 * TRES MODOS, TRES BINARIOS (ver README para el veredicto medido de por qué no van juntos)
 * ---------------------------------------------------------------------------------------
 *   MODO_SPP   Bluetooth Classic SPP  → replica al RS420 en Android (adapter-spp-android.ts)
 *   MODO_HID   teclado BLE HID        → camino iOS sin MFi (levanta el gate de adapter-hid-wedge.ts)
 *   MODO_GATT  BLE Nordic UART        → tercer transporte del multivendor (adapter-ble-gatt, futuro)
 *
 * Se elige con el `#define EMU_MODE` de la sección 0 (o con -DEMU_MODE=... desde arduino-cli).
 *
 * CONTROL: comandos de una línea por el puerto serie USB a 115200 (`help` los lista). El botón BOOT
 * también sirve sin consola. Protocolo completo documentado en el README.
 *
 * Este ESP32 es el mismo que corría el bridge de la balanza Vesta; su firmware está respaldado en
 * firmware/backup/ con instrucciones de restauración. ADR-003 §"Segundo rol del mismo ESP32" habilita
 * este uso y exige que, emulando un bastón, NO se anuncie como `VESTA_BRIDGE`.
 */

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 0. MODO DE COMPILACIÓN Y CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════════════════════════════════════════

#define MODO_SPP 1
#define MODO_HID 2
#define MODO_GATT 3

// ▼▼▼ ELEGÍ EL MODO ACÁ (o pasá -DEMU_MODE=MODO_HID desde arduino-cli) ▼▼▼
#ifndef EMU_MODE
#define EMU_MODE MODO_SPP
#endif
// ▲▲▲

#if (EMU_MODE != MODO_SPP) && (EMU_MODE != MODO_HID) && (EMU_MODE != MODO_GATT)
#error "EMU_MODE tiene que ser MODO_SPP, MODO_HID o MODO_GATT"
#endif

// Nombres Bluetooth por modo. El del SPP matchea a propósito el `deviceMatch.namePattern` del
// driver RS420 (`/RS\s?420|allflex/i`, driver-rs420.ts) para que la app lo reconozca como bastón.
// Los de BLE NO matchean a propósito: hoy el registro no tiene un driver BLE-HID ni BLE-GATT, así
// que lo honesto es que aparezcan como "no reconocido" (RMV3.8). Se cambian en caliente con `name`.
#ifndef EMU_NAME_SPP
#define EMU_NAME_SPP "RS420-EMU"
#endif
#ifndef EMU_NAME_HID
#define EMU_NAME_HID "EMU-HID-380"
#endif
#ifndef EMU_NAME_GATT
#define EMU_NAME_GATT "EMU-GATT-STICK"
#endif

// EID y reloj iniciales = los de la captura de campo, para que la primera trama del boot sea
// byte-por-byte comparable contra field-findings.md.
#define EMU_DEFAULT_EID "982000364696050"
#define EMU_DEFAULT_CLOCK "260530101701"
// Segundo EID real capturado (caravana oficial argentina, prefijo 032). Atajo del comando `eid ar`.
#define EMU_AR_EID "032010006382438"

#define EMU_DEFAULT_GAP_MS 800  // separación por defecto entre lecturas de una serie
#define EMU_SERIAL_BAUD 115200  // el cable de esta máquina no aguanta más (ver README)

// SPP: el RS420 se empareja con PIN fijo 1234 (manual Rev 2.5 + driver-rs420.ts). Con 1 el ESP32
// hace legacy pairing con ese PIN (fiel). Si algún Android se niega a emparejar, poné 0 → SSP
// "just works" (menos fiel, pero empareja siempre).
#ifndef EMU_SPP_LEGACY_PIN
#define EMU_SPP_LEGACY_PIN 1
#endif
#define EMU_SPP_PIN "1234"

// GATT: tamaño de notificación. La trama son ~37 bytes y el payload ATT por defecto son 20 → un
// notify entero se truncaría. Partirla es además lo que ejercita al LineFramer del lado nuestro.
#ifndef EMU_GATT_CHUNK
#define EMU_GATT_CHUNK 20
#endif

// HID: modo de autenticación BLE. Con IO_CAP_NONE (no hay display ni teclado en el ESP32) la única
// asociación posible es "just works", que por definición NO puede satisfacer MITM. Pedir MITM es
// pedir algo que no podemos dar: la librería lo traduce a ESP_BLE_SEC_ENCRYPT_MITM
// (BLESecurity.cpp:247-253), que exige una LTK autenticada, y un host estricto puede rechazar el
// pairing con "Authentication Requirements" (Core spec Vol 3 Part H §2.3.5.1). Por eso el default es
// SC_BOND: bonding + LE Secure Connections, sin MITM. Los bits se descomponen en txBegin().
#ifndef EMU_HID_AUTH
#define EMU_HID_AUTH ESP_LE_AUTH_REQ_SC_BOND
#endif
#define EMU_HID_DEFAULT_KEY_DELAY_MS 12  // un wedge real teclea a ~10-20 ms por carácter

// Largo máximo del nombre Bluetooth. Lo fija el peor caso: en BLE el nombre comparte los 31 bytes
// del paquete de advertising con los flags (3), el appearance (4) y el UUID de servicio (4 si es de
// 16 bits) → quedan 18 para el nombre con su cabecera de 2 bytes.
#define EMU_NAME_MAX 18

// Periféricos de la placa. -1 para desactivar.
#ifndef EMU_LED_PIN
#define EMU_LED_PIN 2  // LED onboard del DevKit-V1
#endif
#ifndef EMU_BOOT_PIN
#define EMU_BOOT_PIN 0  // botón BOOT (activo en LOW)
#endif

#include <Arduino.h>
#include <Preferences.h>
#include <ctype.h>
#include <string.h>
#include <strings.h>  // strcasecmp: el argumento de `name` NO se pasa a minúscula (es el nombre BT)
#include <stdlib.h>

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 1. TIPOS
//
// ⚠️ VAN ARRIBA DE TODO A PROPÓSITO. El preprocesador de Arduino genera los prototipos de todas las
// funciones del .ino y los inserta ANTES de la primera definición de función del archivo. Un tipo
// declarado más abajo pero usado en una firma rompe la compilación con "has not been declared".
// Si agregás un tipo que aparezca en la firma de alguna función, declaralo en este bloque.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/** Terminador de línea. El lector real manda `\n`, a veces `\r\n`. `EMU_TERM_NONE` es un caso de test. */
enum EmuTerm { EMU_TERM_CRLF = 0, EMU_TERM_LF, EMU_TERM_CR, EMU_TERM_NONE };

/** Tramas malformadas que el parser DEBE descartar devolviendo null, sin romperse. */
enum EmuBadCase {
  BAD_HEADER = 0,  // header 1000001 → no es el RS420
  BAD_SHORT,       // EID de 14 dígitos
  BAD_LONG,        // EID de 16 dígitos
  BAD_ALPHA,       // una letra en el medio del EID
  BAD_TSJUNK,      // timestamp no numérico
  BAD_NOTS,        // trama cortada: header + EID, sin timestamp
  BAD_NOTERM,      // trama válida SIN terminador (se queda pegada a la siguiente)
  BAD_BINARY,      // basura binaria
  BAD_EMPTY,       // solo STX + terminador
  BAD_GARBAGE,     // texto sin estructura
  BAD_COUNT
};

/** Una tecla del teclado HID (solo se usa en MODO_HID; declarada acá por lo de los prototipos). */
struct HidKey {
  uint8_t code;
  bool shift;
};

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 2. UTILIDADES
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/** Comparación de deadlines a prueba del rollover de millis() (a los ~49 días). */
static inline bool timeReached(uint32_t deadlineMs) {
  return (int32_t)(millis() - deadlineMs) >= 0;
}

/** Imprime bytes crudos con los no-imprimibles escapados, para poder leer una trama en la consola. */
static void printEscaped(Print &out, const uint8_t *data, size_t len) {
  for (size_t i = 0; i < len; i++) {
    const uint8_t b = data[i];
    if (b == '\r') {
      out.print("\\r");
    } else if (b == '\n') {
      out.print("\\n");
    } else if (b == '\t') {
      out.print("\\t");
    } else if (b >= 0x20 && b < 0x7f) {
      out.write((char)b);
    } else {
      char hex[6];
      snprintf(hex, sizeof(hex), "\\x%02X", b);
      out.print(hex);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 3. GENERADOR DE TRAMAS Y DE EIDs  —  ÚNICA FUENTE DE VERDAD, COMPARTIDA POR LOS TRES MODOS
//
// Es la parte que tiene que ser fiel al lector real y a lo que `parser-rs420.ts` espera. Los tres
// transportes consumen ESTAS funciones; ninguno arma bytes por su cuenta.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/** Header fijo del lector: 7 dígitos, CONSTANTE (confirmado en campo con dos tags distintos). */
static const char READER_HEADER[] = "1000000";
static const uint8_t STX = 0x02;

static const char *const BAD_NAMES[BAD_COUNT] = {"header", "short", "long", "alpha",  "tsjunk",
                                                 "nots",   "noterm", "binary", "empty", "garbage"};

// ── Estado del generador ──────────────────────────────────────────────────────────────────────
static char g_eid[16] = EMU_DEFAULT_EID;  // 15 dígitos + NUL
static bool g_seq = false;                // EIDs incrementales (muchos animales distintos)
static bool g_stx = true;                 // byte de control 0x02 al inicio
static EmuTerm g_term = EMU_TERM_CRLF;

// Reloj del lector: se guarda como epoch-segundos + el millis() en que valía eso, así el campo de
// 12 dígitos avanza igual que en la captura de campo (los segundos incrementan lectura a lectura).
static uint32_t g_clockBaseSecs = 0;
static uint32_t g_clockBaseMs = 0;

/** Días desde 1970-01-01 de una fecha civil (algoritmo de Howard Hinnant, dominio público). */
static int32_t daysFromCivil(int32_t y, uint32_t m, uint32_t d) {
  y -= (m <= 2) ? 1 : 0;
  const int32_t era = (y >= 0 ? y : y - 399) / 400;
  const uint32_t yoe = (uint32_t)(y - era * 400);
  const uint32_t doy = (153u * (m + (m > 2 ? -3u : 9u)) + 2u) / 5u + d - 1u;
  const uint32_t doe = yoe * 365u + yoe / 4u - yoe / 100u + doy;
  return era * 146097 + (int32_t)doe - 719468;
}

/** Inversa de daysFromCivil. */
static void civilFromDays(int32_t z, int32_t *y, uint32_t *m, uint32_t *d) {
  z += 719468;
  const int32_t era = (z >= 0 ? z : z - 146096) / 146097;
  const uint32_t doe = (uint32_t)(z - era * 146097);
  const uint32_t yoe = (doe - doe / 1460u + doe / 36524u - doe / 146096u) / 365u;
  const int32_t yy = (int32_t)yoe + era * 400;
  const uint32_t doy = doe - (365u * yoe + yoe / 4u - yoe / 100u);
  const uint32_t mp = (5u * doy + 2u) / 153u;
  *d = doy - (153u * mp + 2u) / 5u + 1u;
  *m = mp + (mp < 10u ? 3u : -9u);
  *y = yy + ((*m <= 2u) ? 1 : 0);
}

/** "YYMMDDHHMMSS" → epoch-segundos. false si no son 12 dígitos o los campos son imposibles. */
static bool parseReaderClock(const char *s, uint32_t *outSecs) {
  if (s == nullptr) return false;
  for (uint8_t i = 0; i < 12; i++) {
    if (s[i] < '0' || s[i] > '9') return false;
  }
  if (s[12] != '\0') return false;
  const int v[6] = {(s[0] - '0') * 10 + (s[1] - '0'),  (s[2] - '0') * 10 + (s[3] - '0'),
                    (s[4] - '0') * 10 + (s[5] - '0'),  (s[6] - '0') * 10 + (s[7] - '0'),
                    (s[8] - '0') * 10 + (s[9] - '0'),  (s[10] - '0') * 10 + (s[11] - '0')};
  if (v[1] < 1 || v[1] > 12 || v[2] < 1 || v[2] > 31 || v[3] > 23 || v[4] > 59 || v[5] > 59) return false;
  const int32_t days = daysFromCivil(2000 + v[0], (uint32_t)v[1], (uint32_t)v[2]);
  *outSecs = (uint32_t)days * 86400u + (uint32_t)v[3] * 3600u + (uint32_t)v[4] * 60u + (uint32_t)v[5];
  return true;
}

/** Reloj del lector AHORA, en epoch-segundos. */
static uint32_t readerClockNow() {
  return g_clockBaseSecs + (millis() - g_clockBaseMs) / 1000u;
}

/**
 * epoch-segundos → los 12 dígitos `YYMMDDHHMMSS` del lector (out necesita 13 bytes).
 * Los seis campos van con `% 100` para que sean 2 dígitos SIEMPRE: son exactamente 12 caracteres y
 * el campo no puede quedar truncado ni corto (un timestamp de 11 dígitos haría fallar el parseo por
 * el largo, no por el contenido — y eso sería un falso negativo del banco, no un hallazgo).
 */
static void formatReaderClock(char *out, uint32_t secs) {
  const int32_t days = (int32_t)(secs / 86400u);
  const uint32_t rem = secs % 86400u;
  int32_t y = 1970;
  uint32_t m = 1, d = 1;
  civilFromDays(days, &y, &m, &d);
  snprintf(out, 13, "%02u%02u%02u%02u%02u%02u", (unsigned)((((y % 100) + 100) % 100) % 100), (unsigned)(m % 100),
           (unsigned)(d % 100), (unsigned)((rem / 3600u) % 100), (unsigned)(((rem % 3600u) / 60u) % 100),
           (unsigned)((rem % 60u) % 100));
}

/** ¿15 dígitos exactos? Mismo criterio que `isValidTag` (parser-rs420.ts). */
static bool eidIsValid(const char *eid) {
  if (eid == nullptr) return false;
  size_t n = 0;
  while (eid[n] != '\0') {
    if (eid[n] < '0' || eid[n] > '9') return false;
    if (++n > 15) return false;
  }
  return n == 15;
}

/** Avanza el EID actual en 1, manteniendo 15 dígitos (vuelve al default si desbordara). */
static void advanceEid() {
  unsigned long long v = strtoull(g_eid, nullptr, 10);
  v += 1ull;
  if (v > 999999999999999ull) {
    snprintf(g_eid, sizeof(g_eid), "%s", EMU_DEFAULT_EID);
    return;
  }
  snprintf(g_eid, sizeof(g_eid), "%015llu", v);
}

/** Escribe el terminador elegido. Devuelve los bytes escritos. */
static size_t appendTerm(uint8_t *buf, size_t cap, size_t at, EmuTerm term) {
  const char *t = (term == EMU_TERM_CRLF) ? "\r\n" : (term == EMU_TERM_LF) ? "\n" : (term == EMU_TERM_CR) ? "\r" : "";
  size_t n = 0;
  while (t[n] != '\0' && at + n < cap) {
    buf[at + n] = (uint8_t)t[n];
    n++;
  }
  return n;
}

/**
 * Arma UNA trama del lector: [STX] + "1000000" + <EID 15> + <ts 12> + terminador.
 * `eid` puede tener otro largo que 15 (los casos malformados lo usan a propósito).
 * Devuelve los bytes escritos (la trama puede contener no-imprimibles).
 */
static size_t buildReaderFrame(uint8_t *buf, size_t cap, const char *eid, bool stx, EmuTerm term, bool withTs,
                               const char *tsOverride) {
  size_t n = 0;
  if (stx && n < cap) buf[n++] = STX;
  for (size_t i = 0; READER_HEADER[i] != '\0' && n < cap; i++) buf[n++] = (uint8_t)READER_HEADER[i];
  for (size_t i = 0; eid[i] != '\0' && n < cap; i++) buf[n++] = (uint8_t)eid[i];
  if (withTs) {
    char ts[13];
    if (tsOverride != nullptr) {
      snprintf(ts, sizeof(ts), "%s", tsOverride);
    } else {
      formatReaderClock(ts, readerClockNow());
    }
    for (size_t i = 0; ts[i] != '\0' && n < cap; i++) buf[n++] = (uint8_t)ts[i];
  }
  n += appendTerm(buf, cap, n, term);
  return n;
}

/** Trama normal con el EID y el formato actuales. */
static size_t buildCurrentFrame(uint8_t *buf, size_t cap) {
  return buildReaderFrame(buf, cap, g_eid, g_stx, g_term, true, nullptr);
}

/**
 * Arma una trama MALFORMADA. Todas salen de los mismos primitivos que la buena (header, EID y reloj
 * actuales) para que no puedan desincronizarse de ella: lo único que cambia es el defecto inyectado.
 */
static size_t buildBadFrame(uint8_t *buf, size_t cap, EmuBadCase which) {
  char eid[20];
  switch (which) {
    case BAD_HEADER: {
      // Mismo largo y estructura, header equivocado → el regex anclado del parser no matchea.
      size_t n = 0;
      if (g_stx && n < cap) buf[n++] = STX;
      const char *wrong = "1000001";
      for (size_t i = 0; wrong[i] != '\0' && n < cap; i++) buf[n++] = (uint8_t)wrong[i];
      for (size_t i = 0; g_eid[i] != '\0' && n < cap; i++) buf[n++] = (uint8_t)g_eid[i];
      char ts[13];
      formatReaderClock(ts, readerClockNow());
      for (size_t i = 0; ts[i] != '\0' && n < cap; i++) buf[n++] = (uint8_t)ts[i];
      n += appendTerm(buf, cap, n, g_term);
      return n;
    }
    case BAD_SHORT:  // 14 dígitos: uno de menos
      snprintf(eid, sizeof(eid), "%.14s", g_eid);
      return buildReaderFrame(buf, cap, eid, g_stx, g_term, true, nullptr);
    case BAD_LONG:  // 16 dígitos: uno de más
      snprintf(eid, sizeof(eid), "%s0", g_eid);
      return buildReaderFrame(buf, cap, eid, g_stx, g_term, true, nullptr);
    case BAD_ALPHA:  // una letra adentro del EID
      snprintf(eid, sizeof(eid), "%s", g_eid);
      eid[6] = 'X';
      return buildReaderFrame(buf, cap, eid, g_stx, g_term, true, nullptr);
    case BAD_TSJUNK:  // timestamp con basura
      return buildReaderFrame(buf, cap, g_eid, g_stx, g_term, true, "ABCDEF101701");
    case BAD_NOTS:  // trama cortada: sin los 12 dígitos del reloj
      return buildReaderFrame(buf, cap, g_eid, g_stx, g_term, false, nullptr);
    case BAD_NOTERM:  // trama VÁLIDA sin terminador: se pega a la próxima
      return buildReaderFrame(buf, cap, g_eid, g_stx, EMU_TERM_NONE, true, nullptr);
    case BAD_BINARY: {  // bytes no imprimibles
      size_t n = 0;
      const uint8_t junk[] = {0x00, 0x01, 0xFF, 0x7F, 0x1B, 0x80, 0x02, 0xFE};
      for (size_t i = 0; i < sizeof(junk) && n < cap; i++) buf[n++] = junk[i];
      n += appendTerm(buf, cap, n, g_term);
      return n;
    }
    case BAD_EMPTY: {  // solo framing: STX + terminador
      size_t n = 0;
      if (n < cap) buf[n++] = STX;
      n += appendTerm(buf, cap, n, g_term);
      return n;
    }
    case BAD_GARBAGE:
    default: {  // texto sin estructura
      size_t n = 0;
      const char *g = "hola mundo";
      for (size_t i = 0; g[i] != '\0' && n < cap; i++) buf[n++] = (uint8_t)g[i];
      n += appendTerm(buf, cap, n, g_term);
      return n;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 4. TRANSPORTE (una implementación por modo, la MISMA interfaz)
//
//   txBegin()      levanta la radio y se anuncia
//   txPoll()       mantenimiento + detección de cambios de link (se llama en cada loop)
//   txLinked()     ¿hay un central/cliente conectado?
//   txSendRaw()    manda bytes crudos (en HID: los TIPEA)
//   txDropLink()   corta el link, sigue visible/emparejado  → "salió de rango"
//   txRadioOff()   desaparece del aire                       → "se apagó el bastón"
//   txRadioOn()    vuelve a anunciarse
//   txModeName() / txDeviceName()
// ═══════════════════════════════════════════════════════════════════════════════════════════════

static void handleCommandLine(char *line, Print &out);  // fwd: los transportes pueden recibir comandos
static void logLine(const char *msg);

#if EMU_MODE == MODO_GATT
// Comando recibido POR AIRE (solo MODO_GATT, por el RX del Nordic UART: un teclado HID no tiene
// canal de entrada y el SPP lo reservamos para el protocolo del lector). NO se ejecuta dentro del
// callback del stack BLE: un `bad`/`split` desde ahí notificaría en pleno callback de escritura
// (reentrada) y un `reboot` reiniciaría con el stack a medio camino. Se encola y lo corre el loop().
static char g_airCmd[80];
static volatile bool g_airCmdReady = false;

static void queueAirCommand(const char *line) {
  if (g_airCmdReady) return;  // el loop todavía no consumió el anterior: se descarta el nuevo
  snprintf(g_airCmd, sizeof(g_airCmd), "%s", line);
  g_airCmdReady = true;
}
#endif

static Preferences g_prefs;
static char g_btName[33];

/** Nombre por defecto del modo compilado. */
static const char *defaultBtName() {
#if EMU_MODE == MODO_SPP
  return EMU_NAME_SPP;
#elif EMU_MODE == MODO_HID
  return EMU_NAME_HID;
#else
  return EMU_NAME_GATT;
#endif
}

/** Carga el nombre persistido (comando `name`) o el del compilado. */
static void loadBtName() {
  snprintf(g_btName, sizeof(g_btName), "%s", defaultBtName());
  if (g_prefs.begin("emu", true)) {
    char stored[33] = {0};
    const size_t n = g_prefs.getString("btname", stored, sizeof(stored));
    g_prefs.end();
    if (n > 0 && stored[0] != '\0') snprintf(g_btName, sizeof(g_btName), "%s", stored);
  }
}

static void storeBtName(const char *name) {
  if (!g_prefs.begin("emu", false)) return;
  if (name == nullptr) {
    g_prefs.remove("btname");
  } else {
    g_prefs.putString("btname", name);
  }
  g_prefs.end();
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
#if EMU_MODE == MODO_SPP
// ─── Bluetooth Classic SPP: el transporte REAL del RS420 en Android ─────────────────────────────
#include "BluetoothSerial.h"

static BluetoothSerial SerialBT;
static bool g_sppUp = false;      // radio levantada
static bool g_sppLinked = false;  // último estado de link conocido (para detectar transiciones)

static const char *txModeName() {
  return "MODO_SPP (Bluetooth Classic SPP)";
}
static const char *txDeviceName() {
  return g_btName;
}

static void txBegin() {
#if EMU_SPP_LEGACY_PIN
  // Pairing legacy con PIN fijo, como el RS420 (manual Rev 2.5: PIN 1234). disableSSP() SOLO tiene
  // efecto ANTES del begin(); setPin() SOLO después (necesita el stack inicializado).
  SerialBT.disableSSP();
#endif
  // disableBLE=true: en este modo no usamos BLE y liberar su RAM le da ~10 kB al stack Classic.
  if (!SerialBT.begin(g_btName, false, true)) {
    logLine("SPP: begin() FALLÓ");
    return;
  }
#if EMU_SPP_LEGACY_PIN
  if (!SerialBT.setPin(EMU_SPP_PIN, strlen(EMU_SPP_PIN))) logLine("SPP: setPin() falló (¿emparejá con SSP?)");
#endif
  g_sppUp = true;
  g_sppLinked = false;
}

static bool txLinked() {
  return g_sppUp && SerialBT.hasClient();
}

static void txPoll() {
  if (!g_sppUp) return;
  const bool linked = SerialBT.hasClient();
  if (linked != g_sppLinked) {
    g_sppLinked = linked;
    logLine(linked ? "SPP: cliente CONECTADO" : "SPP: cliente DESCONECTADO");
  }
  // El RS420 no acepta comandos nuestros y la app nunca escribe: lo que llegue se descarta para
  // que no se llene la cola de RX.
  while (SerialBT.available() > 0) (void)SerialBT.read();
}

static size_t txSendRaw(const uint8_t *data, size_t len) {
  if (!txLinked()) return 0;
  return SerialBT.write(data, len);
}

static void txDropLink() {
  if (!g_sppUp) return;
  SerialBT.disconnect();  // corta el RFCOMM; el ESP32 sigue visible y emparejado
  g_sppLinked = false;
}

static void txRadioOff() {
  if (!g_sppUp) return;
  SerialBT.end();  // apaga el stack: desaparece del aire (≈ bastón apagado)
  g_sppUp = false;
  g_sppLinked = false;
}

static void txRadioOn() {
  if (g_sppUp) return;
  txBegin();
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
#elif EMU_MODE == MODO_HID
// ─── Teclado BLE HID: el camino iOS SIN MFi ─────────────────────────────────────────────────────
// Un bastón BLE-HID no "streamea": parea como TECLADO del sistema operativo y TIPEA el EID en el
// TextInput que tenga el foco (+ un terminador). Por eso acá `txSendRaw` no escribe bytes: los
// convierte en pulsaciones. Los bytes que un teclado no puede tipear (STX, binario) se descartan y
// se avisa — es una limitación REAL del transporte, no del emulador.
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEHIDDevice.h>
#include <BLESecurity.h>
#include <BLEUtils.h>
#include <BLE2902.h>

static BLEServer *g_server = nullptr;
static BLEHIDDevice *g_hid = nullptr;
static BLECharacteristic *g_input = nullptr;
static volatile bool g_bleLinked = false;
static bool g_bleAdvertising = false;  // ¿QUEREMOS estar en el aire? (lo baja `off`, no una desconexión)
static volatile bool g_bleReAdvertise = false;  // pedido de re-anuncio dejado por el callback del stack
// Estado de SEGURIDAD del link. "Conectado" no alcanza para tipear: un host HID sólo acepta reportes
// sobre un link cifrado, y el cifrado sale del pairing. Sin esto el emulador decía "lectura →" con el
// iPhone conectado y sin emparejar, que es exactamente cómo se falsea un gate.
static volatile bool g_bleEncrypted = false;   // hubo ESP_GAP_BLE_AUTH_CMPL_EVT con success
static volatile bool g_bleAuthFailed = false;  // el último intento de emparejar falló
static volatile uint8_t g_bleAuthMode = 0;     // auth_mode negociado (bit0 bond, bit2 MITM, bit3 SC)
static uint32_t g_hidKeyDelayMs = EMU_HID_DEFAULT_KEY_DELAY_MS;
static bool g_hidRaw = false;  // tipear la trama completa en vez de solo el EID
// Terminador TECLEADO: '\n' = Enter, '\t' = Tab, 0 = ninguno. No es un EmuTerm: un teclado no
// tipea CRLF, y hay lectores HID que cierran con Tab en vez de Enter.
static char g_hidTermKey = '\n';

/** Report map de un teclado boot estándar (report ID 1, input de 8 bytes). */
static const uint8_t HID_REPORT_MAP[] = {
    0x05, 0x01,  // Usage Page (Generic Desktop)
    0x09, 0x06,  // Usage (Keyboard)
    0xA1, 0x01,  // Collection (Application)
    0x85, 0x01,  //   Report ID (1)
    0x05, 0x07,  //   Usage Page (Key Codes)
    0x19, 0xE0,  //   Usage Min (224) modificadores
    0x29, 0xE7,  //   Usage Max (231)
    0x15, 0x00, 0x25, 0x01, 0x75, 0x01, 0x95, 0x08,
    0x81, 0x02,  //   Input (Data,Var,Abs) — byte de modificadores
    0x95, 0x01, 0x75, 0x08,
    0x81, 0x01,  //   Input (Const) — byte reservado
    0x95, 0x05, 0x75, 0x01, 0x05, 0x08, 0x19, 0x01, 0x29, 0x05,
    0x91, 0x02,  //   Output (LEDs)
    0x95, 0x01, 0x75, 0x03,
    0x91, 0x01,  //   Output (Const) — padding
    0x95, 0x06, 0x75, 0x08, 0x15, 0x00, 0x25, 0x65, 0x05, 0x07, 0x19, 0x00, 0x29, 0x65,
    0x81, 0x00,  //   Input (Data,Array) — 6 keycodes
    0xC0         // End Collection
};

class HidServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer *) override {
    g_bleLinked = true;
    // El cifrado se re-negocia en CADA conexión (con la LTK guardada si hay bond). Hasta que llegue
    // el AUTH_CMPL, este link NO está cifrado: darlo por bueno sería heredar el estado del anterior.
    g_bleEncrypted = false;
    g_bleAuthFailed = false;
    logLine("HID: central CONECTADO");
  }
  void onDisconnect(BLEServer *) override {
    g_bleLinked = false;
    g_bleEncrypted = false;
    g_bleReAdvertise = true;  // el re-anuncio lo hace txPoll(), NO este callback (ver abajo)
    logLine("HID: central DESCONECTADO");
  }
};
static HidServerCallbacks g_hidCallbacks;

static const char *txModeName() {
  return "MODO_HID (teclado BLE HID)";
}
static const char *txDeviceName() {
  return g_btName;
}

/** Formatea los 6 bytes de un esp_bd_addr_t. Recibe `const uint8_t *` a propósito: ver §1. */
static void hidFormatAddr(char *out, size_t n, const uint8_t *bda) {
  snprintf(out, n, "%02X:%02X:%02X:%02X:%02X:%02X", bda[0], bda[1], bda[2], bda[3], bda[4], bda[5]);
}

/**
 * Traduce el `fail_reason` de un pairing fallido.
 *
 * Los números crudos no sirven para atribuir un fallo: "0x66" no dice nada, `CONN_TOUT` dice que el
 * link se cortó a mitad del SMP y `PAIR_AUTH_FAIL` diría que el host rechazó nuestros requisitos de
 * autenticación (o sea: hay que tocar EMU_HID_AUTH). Los valores salen del `esp_ble_auth_fail_rsn_t`
 * del core instalado (esp_gap_ble_api.h:727-757), que arranca en 78 = las razones del Core Spec 5.0
 * Vol 3 Part H §3.5.5 y sigue con las internas de Bluedroid.
 */
static const char *hidAuthFailName(unsigned r) {
  switch (r) {
    case 78: return "SMP_PASSKEY_FAIL";
    case 79: return "SMP_OOB_FAIL";
    case 80: return "SMP_PAIR_AUTH_FAIL (el host rechazó nuestros requisitos de autenticación)";
    case 81: return "SMP_CONFIRM_VALUE_FAIL";
    case 82: return "SMP_PAIR_NOT_SUPPORT";
    case 83: return "SMP_ENC_KEY_SIZE";
    case 84: return "SMP_INVALID_CMD";
    case 85: return "SMP_UNKNOWN_ERR";
    case 86: return "SMP_REPEATED_ATTEMPT";
    case 87: return "SMP_INVALID_PARAMETERS";
    case 88: return "SMP_DHKEY_CHK_FAIL";
    case 89: return "SMP_NUM_COMP_FAIL";
    case 90: return "SMP_BR_PARING_IN_PROGR";
    case 91: return "SMP_XTRANS_DERIVE_NOT_ALLOW";
    case 92: return "SMP_INTERNAL_ERR";
    case 93: return "SMP_UNKNOWN_IO";
    case 94: return "SMP_INIT_FAIL";
    case 95: return "SMP_CONFIRM_FAIL";
    case 96: return "SMP_BUSY";
    case 97: return "SMP_ENC_FAIL";
    case 98: return "SMP_STARTED";
    case 99: return "SMP_RSP_TIMEOUT (el host nunca contestó el SMP)";
    case 100: return "SMP_DIV_NOT_AVAIL";
    case 101: return "SMP_UNSPEC_ERR";
    case 102: return "SMP_CONN_TOUT (se cortó el link a mitad del emparejamiento)";
    default: return "desconocido";
  }
}

/**
 * Resultado del emparejamiento, dicho en voz alta.
 *
 * Sin esto, un pairing que falla y un pairing que nunca se intenta se ven IGUAL desde la consola
 * (link=CONECTADO en los dos), y esa ambigüedad ya costó una sesión de gate: el emulador informaba
 * `lecturas=1` con el iPhone conectado y sin emparejar. `bond=NO` en el auth_mode es la diferencia
 * entre "emparejó" y "emparejó y va a seguir emparejado después de apagar el Bluetooth".
 */
static void hidLogAuthComplete(bool ok, uint8_t authMode, unsigned failReason, const uint8_t *bda) {
  char addr[20];
  hidFormatAddr(addr, sizeof(addr), bda);
  char msg[224];
  if (ok) {
    g_bleAuthMode = authMode;
    g_bleAuthFailed = false;
    g_bleEncrypted = true;
    snprintf(msg, sizeof(msg), "HID: EMPAREJADO con %s — link CIFRADO (auth_mode=0x%02X bond=%s sc=%s mitm=%s)",
             addr, (unsigned)authMode, (authMode & ESP_LE_AUTH_BOND) ? "SI" : "NO",
             (authMode & ESP_LE_AUTH_REQ_SC_ONLY) ? "si" : "no", (authMode & ESP_LE_AUTH_REQ_MITM) ? "si" : "no");
  } else {
    g_bleAuthFailed = true;
    g_bleEncrypted = false;
    snprintf(msg, sizeof(msg), "HID: el emparejamiento con %s FALLÓ: %s (0x%02X) — sin bond y sin cifrado, no se tipea nada",
             addr, hidAuthFailName(failReason), failReason);
  }
  logLine(msg);
}

/**
 * ¿El host suscribió el input report (CCCD 0x2902)?
 *
 * `BLECharacteristic::notify()` descarta EN SILENCIO si el CCCD está apagado
 * (BLECharacteristic.cpp:861-867) y no devuelve nada. Sin este chequeo el emulador contaba como
 * tipeada una tecla que nunca salió del ESP32.
 */
static bool hidSubscribed() {
  // Sin link no hay suscripción: el valor del CCCD queda escrito de la conexión anterior (la librería
  // lo persiste para los bonded, BLEDevice.cpp:1399-1403) y reportarlo con el link caído sería mentir.
  if (!g_bleLinked || g_input == nullptr) return false;
  BLE2902 *cccd = (BLE2902 *)g_input->getDescriptorByUUID(BLEUUID((uint16_t)0x2902));
  return cccd != nullptr && cccd->getNotifications();
}

/**
 * Bonds guardados en NVS (CONFIG_BT_BLE_SMP_BOND_NVS_FLASH=y en el sdkconfig del core).
 *
 * Es EL oráculo local de "el bond persiste", y el único que no depende de la UI de otro sistema
 * operativo: si después de un `reboot` el peer sigue listado acá, la LTK se guardó de verdad.
 */
static void hidPrintBonds(Print &out) {
  const int n = esp_ble_get_bond_device_num();
  out.print("[emu] bonds guardados en NVS: ");
  out.println(n);
  if (n <= 0) return;
  esp_ble_bond_dev_t *list = (esp_ble_bond_dev_t *)malloc(sizeof(esp_ble_bond_dev_t) * (size_t)n);
  if (list == nullptr) {
    out.println("[emu] ERR: sin heap para listar los bonds");
    return;
  }
  int got = n;
  if (esp_ble_get_bond_device_list(&got, list) == ESP_OK) {
    if (got > n) got = n;  // el buffer tiene n: un bond nuevo entre las dos llamadas no lo desborda
    for (int i = 0; i < got; i++) {
      char addr[20];
      hidFormatAddr(addr, sizeof(addr), list[i].bd_addr);
      // key_mask: bit0 PENC (LTK del peer), bit1 PID (IRK del peer) — sin PENC no hay reconexión
      // cifrada, sin PID no se resuelve la dirección privada aleatoria del iPhone.
      char msg[96];
      snprintf(msg, sizeof(msg), "  %s  claves=0x%02X (LTK=%s IRK=%s)", addr, (unsigned)list[i].bond_key.key_mask,
               (list[i].bond_key.key_mask & ESP_LE_KEY_PENC) ? "si" : "NO",
               (list[i].bond_key.key_mask & ESP_LE_KEY_PID) ? "si" : "no");
      out.print("[emu]");
      out.println(msg);
    }
  } else {
    out.println("[emu] ERR: esp_ble_get_bond_device_list falló");
  }
  free(list);
}

/**
 * Borra TODOS los bonds del emulador.
 *
 * El gate del iPhone tiene que arrancar desde cero: un bond viejo (de la PC, de un intento anterior)
 * hace que el emulador se re-cifre con una LTK guardada y enmascara si el pairing nuevo funciona.
 */
static void hidClearBonds(Print &out) {
  const int n = esp_ble_get_bond_device_num();
  if (n <= 0) {
    out.println("[emu] no había bonds que borrar");
    return;
  }
  esp_ble_bond_dev_t *list = (esp_ble_bond_dev_t *)malloc(sizeof(esp_ble_bond_dev_t) * (size_t)n);
  if (list == nullptr) {
    out.println("[emu] ERR: sin heap para borrar los bonds");
    return;
  }
  int got = n;
  int borrados = 0;
  if (esp_ble_get_bond_device_list(&got, list) == ESP_OK) {
    if (got > n) got = n;
    for (int i = 0; i < got; i++) {
      if (esp_ble_remove_bond_device(list[i].bd_addr) == ESP_OK) borrados++;
    }
  }
  free(list);
  // `esp_ble_remove_bond_device` es ASINCRÓNICO (va por la cola del BTC): listar en la línea de abajo
  // devolvía el conteo viejo y parecía que el borrado no había funcionado. Se espera a que baje.
  for (int espera = 0; espera < 20 && esp_ble_get_bond_device_num() > 0; espera++) delay(50);
  // El auth_mode que muestra `status` es el del último emparejamiento: dejarlo puesto con bonds=0
  // sería decir "autenticado" sobre un emulador que ya no tiene con qué.
  g_bleAuthMode = 0;
  g_bleAuthFailed = false;
  char msg[96];
  snprintf(msg, sizeof(msg), "bonds borrados: %d de %d (quedan %d)", borrados, n, esp_ble_get_bond_device_num());
  logLine(msg);
  // Si el host todavía tiene SU lado del emparejamiento, va a reconectar en loop e intentar cifrar
  // con una LTK que acá ya no existe. Borrar de los dos lados o el aire queda inutilizable.
  logLine("OJO: si el host sigue emparejado, se va a reconectar en loop — borralo también de su lado");
}

static void txBegin() {
  BLEDevice::init(g_btName);

  // Instrumentación del emparejamiento. Va como lambda SIN captura (se convierte sola al puntero de
  // función que pide `setCustomGapHandler`) y no como función suelta A PROPÓSITO: una función del
  // .ino con `esp_gap_ble_cb_event_t` en la firma se rompe con el generador de prototipos de Arduino
  // (misma trampa que documenta la §1 para `HidKey`). El cuerpo sólo LOGUEA: no se reentra al stack
  // BLE desde su propio callback (misma razón que el `queueAirCommand` del MODO_GATT).
  BLEDevice::setCustomGapHandler([](esp_gap_ble_cb_event_t event, esp_ble_gap_cb_param_t *param) {
    switch (event) {
      case ESP_GAP_BLE_SEC_REQ_EVT: logLine("HID: el host pidió seguridad (la librería la acepta sola)"); break;
      case ESP_GAP_BLE_KEY_EVT: {
        char msg[64];
        snprintf(msg, sizeof(msg), "HID: clave intercambiada (tipo 0x%02X)", (unsigned)param->ble_security.ble_key.key_type);
        logLine(msg);
        break;
      }
      case ESP_GAP_BLE_AUTH_CMPL_EVT:
        hidLogAuthComplete(param->ble_security.auth_cmpl.success, (uint8_t)param->ble_security.auth_cmpl.auth_mode,
                           (unsigned)param->ble_security.auth_cmpl.fail_reason, param->ble_security.auth_cmpl.bd_addr);
        break;
      default: break;
    }
  });

  // ⚠️ TRAMPA de BLESecurity (core esp32 3.3.8): hay DOS `setAuthenticationMode` y NO son
  // equivalentes. El de `uint8_t` (BLESecurity.cpp:105-115) SOLO empuja el authReq al GAP. El de
  // 3 `bool` (:239-258) es el único que además prende `m_securityEnabled` y fija `m_securityLevel`
  // (vía setEncryptionLevel). Y `m_securityEnabled` es lo que gatea que el periférico ARRANQUE la
  // seguridad al conectarse: BLEDevice.cpp:1219-1225 (ESP_GATTS_CONNECT_EVT → startSecurity) sólo
  // llama a `esp_ble_set_encryption` si está en true. Con la sobrecarga de `uint8_t` quedaba en
  // false → el emulador NUNCA mandaba el Security Request, el host se conectaba y enumeraba sin
  // emparejar, y como el HID de esta librería deja el CCCD y el Report Map sin cifrado
  // (BLEHIDDevice.cpp:162-193, "removed per HOGP specification"), tampoco había un error de
  // "insufficient authentication" que empujara al host a emparejar por su cuenta. Resultado
  // medido: conecta, no queda bond, y no se tipea una sola tecla.
  // Además `m_securityLevel` es un static sin inicializador (BLESecurity.cpp:87) → 0, que NO es un
  // `esp_ble_sec_act_t` válido (ESP_BLE_SEC_ENCRYPT == 1). El de 3 bool también lo arregla.
  // Ver progress/impl_emulador-hid-bonding.md.
  BLESecurity::setCapability(ESP_IO_CAP_NONE);  // sin display ni teclado → "just works"
  BLESecurity::setAuthenticationMode(
      (((uint8_t)EMU_HID_AUTH) & ESP_LE_AUTH_BOND) != 0,        // bonding
      (((uint8_t)EMU_HID_AUTH) & ESP_LE_AUTH_REQ_MITM) != 0,    // MITM
      (((uint8_t)EMU_HID_AUTH) & ESP_LE_AUTH_REQ_SC_ONLY) != 0  // LE Secure Connections
  );
  // ⚠️ Segunda trampa de la misma clase: las máscaras de distribución de claves y el tamaño de clave
  // los fija el CONSTRUCTOR de BLESecurity (BLESecurity.cpp:96-101), y acá no corre ninguno porque
  // usamos la API estática. Los estáticos arrancan en `m_initKey = m_respKey = 0` (:76-77), así que
  // esos parámetros del GAP quedaban en lo que trajera Bluedroid de fábrica, sin que el sketch lo
  // declarara. Se declaran: ENC (LTK, para poder re-cifrar en la reconexión) + ID (IRK, para
  // resolver la dirección privada aleatoria del iPhone, que rota).
  BLESecurity::setInitEncryptionKey(ESP_BLE_ENC_KEY_MASK | ESP_BLE_ID_KEY_MASK);
  BLESecurity::setRespEncryptionKey(ESP_BLE_ENC_KEY_MASK | ESP_BLE_ID_KEY_MASK);
  BLESecurity::setKeySize(16);

  g_server = BLEDevice::createServer();
  g_server->setCallbacks(&g_hidCallbacks);
  g_server->advertiseOnDisconnect(false);  // el re-anuncio lo manejamos nosotros (comando `off`)

  g_hid = new BLEHIDDevice(g_server);
  g_input = g_hid->inputReport(1);
  // ⚠️ TRAMPA de BLEHIDDevice (core esp32 3.3.8): el CONSTRUCTOR **no** crea la característica de
  // fabricante (0x2a29). La crea el getter `manufacturer()` (BLEHIDDevice.cpp:128-130); el setter
  // `manufacturer(String)` escribe derecho por el puntero (:137-138) y ese miembro no tiene
  // inicializador (BLEHIDDevice.h:92) → hasta que se llama al getter guarda basura. Llamar al
  // setter primero desreferencia esa basura: LoadProhibited y boot loop, que es exactamente lo que
  // tenía este modo (backtrace simbolizado en progress/impl_emulador-hid-crash.md). La forma
  // correcta es la del ejemplo Server_Gamepad de la propia librería: getter (que CREA) y recién
  // ahí el valor.
  g_hid->manufacturer()->setValue("RAFAQ");
  g_hid->pnp(0x02, 0xE502, 0xA111, 0x0210);
  g_hid->hidInfo(0x00, 0x01);
  g_hid->reportMap((uint8_t *)HID_REPORT_MAP, sizeof(HID_REPORT_MAP));
  g_hid->startServices();
  g_hid->setBatteryLevel(95);

  BLEAdvertising *adv = g_server->getAdvertising();
  adv->setAppearance(HID_KEYBOARD);
  adv->addServiceUUID(g_hid->hidService()->getUUID());
  adv->setScanResponse(false);
  adv->start();
  g_bleAdvertising = true;
}

static bool txLinked() {
  return g_bleLinked;
}

/**
 * Re-anuncio después de una desconexión.
 *
 * En BLE el stack DEJA de anunciarse solo cuando un central se conecta, y `advertiseOnDisconnect(false)`
 * hace que no vuelva por su cuenta. Sin esto, en cuanto se corta el link el emulador queda invisible
 * PARA SIEMPRE: `drop` incumpliría su contrato ("sigue visible y emparejado", README §comandos) y —lo
 * caro— si el iPhone corta el link al mandar la app a background, la medición (d) del gate daría "iOS
 * no reconecta" cuando la mudez es NUESTRA. Un teclado BLE real vuelve al aire; el emulador tiene que
 * hacer lo mismo o no emula la cosa que se está midiendo.
 *
 * Va en el loop y no en el callback del stack por la misma razón que el `queueAirCommand` del MODO_GATT:
 * no se reentra al stack BLE desde su propio callback.
 */
static void txPoll() {
  if (!g_bleReAdvertise) return;
  g_bleReAdvertise = false;
  // `off` bajó la radio a propósito ("se apagó el bastón"): tiene que SEGUIR desaparecido.
  if (!g_bleAdvertising) return;
  BLEDevice::startAdvertising();
  logLine("HID: de vuelta en el aire (un teclado real se re-anuncia al desconectarse)");
}

/** ASCII → keycode HID (+ shift). false si un teclado no puede tipear ese byte. */
static bool hidMapAscii(uint8_t c, HidKey *out) {
  if (c >= '1' && c <= '9') {
    out->code = 0x1E + (uint8_t)(c - '1');
    out->shift = false;
    return true;
  }
  if (c == '0') {
    out->code = 0x27;
    out->shift = false;
    return true;
  }
  if (c >= 'a' && c <= 'z') {
    out->code = 0x04 + (uint8_t)(c - 'a');
    out->shift = false;
    return true;
  }
  if (c >= 'A' && c <= 'Z') {
    out->code = 0x04 + (uint8_t)(c - 'A');
    out->shift = true;
    return true;
  }
  switch (c) {
    case ' ': out->code = 0x2C; out->shift = false; return true;
    case '-': out->code = 0x2D; out->shift = false; return true;
    case '.': out->code = 0x37; out->shift = false; return true;
    case '\t': out->code = 0x2B; out->shift = false; return true;
    case '\r':
    case '\n': out->code = 0x28; out->shift = false; return true;  // Enter
    default: return false;
  }
}

static void hidPressRelease(const HidKey &k) {
  uint8_t report[8] = {0};
  report[0] = k.shift ? 0x02 : 0x00;  // LeftShift
  report[2] = k.code;
  g_input->setValue(report, sizeof(report));
  g_input->notify();
  uint8_t release[8] = {0};
  g_input->setValue(release, sizeof(release));
  g_input->notify();
}

/** "Escribe" tipeando. Colapsa `\r\n` en un solo Enter y descarta lo no tipeable, avisando. */
static size_t txSendRaw(const uint8_t *data, size_t len) {
  if (!txLinked()) return 0;
  // Un central conectado NO es un teclado del otro lado. Si el host no suscribió el input report,
  // `notify()` tira el reporte en silencio y el emulador estaría contando teclas que nunca salieron.
  if (!hidSubscribed()) {
    logLine("HID: el host NO suscribió el input report — conectado pero sin teclado del otro lado");
    return 0;
  }
  // Sin cifrado no hubo pairing, y un host HID real ignora reportes sobre un link en claro. Se avisa
  // y se manda igual: el emulador no decide por el host, pero deja de mentir sobre lo que pasó.
  if (!g_bleEncrypted) {
    logLine("HID: OJO, el link NO está cifrado (no hubo emparejamiento) — un host HID real descarta estos reportes");
  }
  size_t typed = 0, skipped = 0;
  bool lastWasEnter = false;
  for (size_t i = 0; i < len; i++) {
    HidKey k;
    if (!hidMapAscii(data[i], &k)) {
      skipped++;
      continue;
    }
    if (k.code == 0x28 && lastWasEnter) continue;  // \r\n = un Enter, no dos
    lastWasEnter = (k.code == 0x28);
    hidPressRelease(k);
    typed++;
    if (g_hidKeyDelayMs > 0) delay(g_hidKeyDelayMs);
  }
  if (skipped > 0) {
    char msg[96];
    snprintf(msg, sizeof(msg), "HID: %u byte(s) no tipeables descartados (un teclado no manda STX ni binario)",
             (unsigned)skipped);
    logLine(msg);
  }
  return typed;
}

static void txDropLink() {
  if (g_server != nullptr && g_bleLinked) g_server->disconnect(g_server->getConnId());
  g_bleLinked = false;
}

static void txRadioOff() {
  txDropLink();
  if (g_bleAdvertising) {
    BLEDevice::stopAdvertising();
    g_bleAdvertising = false;
  }
}

static void txRadioOn() {
  if (g_bleAdvertising) return;
  BLEDevice::startAdvertising();
  g_bleAdvertising = true;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
#else  // EMU_MODE == MODO_GATT
// ─── BLE GATT Nordic UART: el tercer transporte del multivendor ─────────────────────────────────
// Mismos UUIDs que ADR-003 (Nordic UART). Notifica la trama COMPLETA por TX, partida en trozos de
// `chunk` bytes: con MTU por defecto (23) el payload son 20, así que una trama de ~37 bytes SIEMPRE
// llega partida — que es justamente lo que tiene que reensamblar nuestro LineFramer.
// El RX (write) acepta los mismos comandos de control que el puerto serie: se puede manejar el
// emulador desde nRF Connect o desde la app, sin cable.
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

#define NUS_SERVICE_UUID "6E400001-B5A3-F393-E0A9-E50E24DCCA9E"
#define NUS_RX_UUID "6E400002-B5A3-F393-E0A9-E50E24DCCA9E"  // teléfono → ESP32 (WRITE)
#define NUS_TX_UUID "6E400003-B5A3-F393-E0A9-E50E24DCCA9E"  // ESP32 → teléfono (NOTIFY)

static BLEServer *g_server = nullptr;
static BLECharacteristic *g_tx = nullptr;
static volatile bool g_bleLinked = false;
static bool g_bleAdvertising = false;  // ¿QUEREMOS estar en el aire? (lo baja `off`, no una desconexión)
static volatile bool g_bleReAdvertise = false;  // pedido de re-anuncio dejado por el callback del stack
static uint16_t g_chunk = EMU_GATT_CHUNK;

class GattServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer *) override {
    g_bleLinked = true;
    logLine("GATT: central CONECTADO");
  }
  void onDisconnect(BLEServer *) override {
    g_bleLinked = false;
    g_bleReAdvertise = true;  // el re-anuncio lo hace txPoll(), NO este callback (ver abajo)
    logLine("GATT: central DESCONECTADO");
  }
};
static GattServerCallbacks g_gattCallbacks;

class GattRxCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *c) override {
    String v = c->getValue();
    char buf[80];
    snprintf(buf, sizeof(buf), "%s", v.c_str());
    // Se toma la PRIMERA línea y se encola: el comando lo ejecuta el loop(), no este callback.
    for (char *p = buf; *p != '\0'; p++) {
      if (*p == '\n' || *p == '\r') {
        *p = '\0';
        break;
      }
    }
    if (buf[0] != '\0') queueAirCommand(buf);
  }
  /** Aviso de "conectado pero sin suscribirse": es una falla real de NUESTRO lado. */
  void onStatus(BLECharacteristic *, Status s, uint32_t) override {
    if (s == ERROR_NOTIFY_DISABLED || s == ERROR_NO_SUBSCRIBER) {
      logLine("GATT: nadie suscripto al CCCD del TX → la lectura no salió");
    }
  }
};
static GattRxCallbacks g_rxCallbacks;

static const char *txModeName() {
  return "MODO_GATT (BLE Nordic UART)";
}
static const char *txDeviceName() {
  return g_btName;
}

static void txBegin() {
  BLEDevice::init(g_btName);
  g_server = BLEDevice::createServer();
  g_server->setCallbacks(&g_gattCallbacks);
  g_server->advertiseOnDisconnect(false);

  BLEService *svc = g_server->createService(NUS_SERVICE_UUID);
  g_tx = svc->createCharacteristic(NUS_TX_UUID, BLECharacteristic::PROPERTY_NOTIFY);
  g_tx->addDescriptor(new BLE2902());
  g_tx->setCallbacks(&g_rxCallbacks);
  BLECharacteristic *rx =
      svc->createCharacteristic(NUS_RX_UUID, BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR);
  rx->setCallbacks(&g_rxCallbacks);
  svc->start();

  BLEAdvertising *adv = g_server->getAdvertising();
  adv->addServiceUUID(NUS_SERVICE_UUID);
  adv->setScanResponse(true);
  adv->start();
  g_bleAdvertising = true;
}

static bool txLinked() {
  return g_bleLinked;
}

/**
 * Re-anuncio después de una desconexión — misma razón, palabra por palabra, que en el MODO_HID: el
 * stack deja de anunciarse al conectarse un central y `advertiseOnDisconnect(false)` no lo reanuda,
 * así que sin esto `drop` dejaría al emulador invisible para siempre y la reconexión —el escenario
 * que este banco existe para provocar— no se podría probar. Se hace desde el loop, no desde el
 * callback del stack.
 */
static void txPoll() {
  if (!g_bleReAdvertise) return;
  g_bleReAdvertise = false;
  // `off` bajó la radio a propósito ("se apagó el bastón"): tiene que SEGUIR desaparecido.
  if (!g_bleAdvertising) return;
  BLEDevice::startAdvertising();
  logLine("GATT: de vuelta en el aire (drop ≠ desaparecer del aire)");
}

static size_t txSendRaw(const uint8_t *data, size_t len) {
  if (!txLinked() || g_tx == nullptr) return 0;
  const uint16_t step = (g_chunk == 0 || g_chunk > len) ? (uint16_t)len : g_chunk;
  size_t sent = 0;
  while (sent < len) {
    const size_t n = ((len - sent) < step) ? (len - sent) : step;
    g_tx->setValue((uint8_t *)(data + sent), n);
    g_tx->notify();
    sent += n;
    if (sent < len) delay(10);  // el stack necesita aire entre notificaciones
  }
  return sent;
}

static void txDropLink() {
  if (g_server != nullptr && g_bleLinked) g_server->disconnect(g_server->getConnId());
  g_bleLinked = false;
}

static void txRadioOff() {
  txDropLink();
  if (g_bleAdvertising) {
    BLEDevice::stopAdvertising();
    g_bleAdvertising = false;
  }
}

static void txRadioOn() {
  if (g_bleAdvertising) return;
  BLEDevice::startAdvertising();
  g_bleAdvertising = true;
}

#endif  // EMU_MODE

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 5. ESCENARIOS (lo que vuelve útil al banco: provocar los estados que rompen)
// ═══════════════════════════════════════════════════════════════════════════════════════════════

static uint32_t g_gapMs = EMU_DEFAULT_GAP_MS;
static uint32_t g_pending = 0;       // lecturas de la serie en curso
static uint32_t g_pendingGapMs = 0;  // separación de esa serie
static uint32_t g_nextEmitMs = 0;
static bool g_pendingSame = false;  // la serie NO avanza el EID (dedup por ventana)
static uint32_t g_autoMs = 0;       // emisión automática (0 = off)
static uint32_t g_autoNextMs = 0;
static uint32_t g_muteUntilMs = 0;   // conectado pero MUDO
static bool g_muted = false;
static uint32_t g_radioBackMs = 0;   // radio abajo hasta
static bool g_radioDown = false;
static uint32_t g_flapLeft = 0;      // ciclos de flap pendientes
static uint32_t g_flapDownMs = 0;
static uint32_t g_flapNextDownMs = 0;  // 0 = sin próximo corte programado
// Aire ARRIBA entre dos cortes de un flap. Tiene que alcanzar para que un reintento del backoff
// llegue a conectar; si no, el flap solo prueba "el device no está" y nunca el ciclo completo.
#define EMU_FLAP_SETTLE_MS 4000
static uint32_t g_readCount = 0;     // lecturas emitidas desde el boot

static void logLine(const char *msg) {
  Serial.print("[emu] ");
  Serial.println(msg);
}

static void blinkLed() {
#if EMU_LED_PIN >= 0
  digitalWrite(EMU_LED_PIN, HIGH);
  delay(8);
  digitalWrite(EMU_LED_PIN, LOW);
#endif
}

/**
 * ÚNICA salida de bytes del emulador. Devuelve lo que realmente se mandó (0 = nada).
 *
 * La mudez se chequea ACÁ y no en cada `emit*`: es el único cuello de botella por el que sale todo,
 * así que un escenario nuevo que se agregue mañana nace respetando el `mute` sin que haya que
 * acordarse. Y distingue los tres motivos de "no salió" en vez de mentir uno solo:
 * mudo / nadie conectado / conectado pero nada mandable (el caso del HID con bytes no tipeables).
 */
static size_t sendBytes(const uint8_t *data, size_t len, const char *what) {
  if (g_muted) {
    Serial.print("[emu] MUDO (bastón prendido que no lee): ");
    Serial.print(what);
    Serial.println(" suprimida");
    return 0;
  }
  const size_t n = txSendRaw(data, len);
  Serial.print("[emu] ");
  Serial.print(what);
  if (n > 0) {
    Serial.print(" → ");
  } else if (!txLinked()) {
    Serial.print(" (DESCARTADA, nadie conectado) → ");
  } else {
    Serial.print(" (conectado pero NADA mandable) → ");
  }
  printEscaped(Serial, data, len);
  Serial.println();
  if (n > 0) blinkLed();
  return n;
}

/**
 * Emite UNA lectura normal.
 * En SPP/GATT sale la trama completa del lector; en HID sale solo el EID + Enter (un teclado no
 * puede tipear el STX ni el header binario), salvo que `hidraw on` pida la trama entera.
 */
static void emitReading(bool advance) {
  uint8_t buf[64];
  size_t len;
#if EMU_MODE == MODO_HID
  if (g_hidRaw) {
    len = buildCurrentFrame(buf, sizeof(buf));
  } else {
    len = 0;
    for (size_t i = 0; g_eid[i] != '\0' && len < sizeof(buf); i++) buf[len++] = (uint8_t)g_eid[i];
    if (g_hidTermKey != '\0' && len < sizeof(buf)) buf[len++] = (uint8_t)g_hidTermKey;
  }
#else
  len = buildCurrentFrame(buf, sizeof(buf));
#endif
  // El contador cuenta lo que SALIÓ, no lo que se intentó: así `lecturas=N` es directamente
  // comparable contra lo que la app debería haber ingerido (menos el dedup).
  if (sendBytes(buf, len, "lectura") > 0) g_readCount++;
  if (advance && g_seq) advanceEid();
}

static void emitBad(EmuBadCase which) {
  uint8_t buf[64];
  const size_t len = buildBadFrame(buf, sizeof(buf), which);
  char what[40];
  snprintf(what, sizeof(what), "malformada[%s]", BAD_NAMES[which]);
  sendBytes(buf, len, what);
}

/** Trama válida partida en DOS escrituras con una pausa: ¿el framer reensambla? */
static void emitSplit(uint32_t pauseMs) {
  uint8_t buf[64];
  const size_t len = buildCurrentFrame(buf, sizeof(buf));
  const size_t half = len / 2;
  sendBytes(buf, half, "split 1/2");
  delay(pauseMs);
  if (sendBytes(buf + half, len - half, "split 2/2") > 0) g_readCount++;
  if (g_seq) advanceEid();
}

/** DOS tramas válidas en UNA escritura: ¿el lado nuestro separa las dos lecturas? */
static void emitDouble() {
  uint8_t buf[128];
  size_t len = buildCurrentFrame(buf, sizeof(buf));
  if (g_seq) advanceEid();
  len += buildCurrentFrame(buf + len, sizeof(buf) - len);
  if (sendBytes(buf, len, "dos tramas pegadas") > 0) g_readCount += 2;
  if (g_seq) advanceEid();
}

/** Programa una serie de `n` lecturas separadas `gapMs`. `same` = sin avanzar el EID. */
static void scheduleReads(uint32_t n, uint32_t gapMs, bool same) {
  g_pending = n;
  g_pendingGapMs = gapMs;
  g_pendingSame = same;
  g_nextEmitMs = millis();
}

static void radioDownFor(uint32_t ms) {
  txRadioOff();
  g_radioDown = true;
  g_radioBackMs = millis() + ms;
  char msg[64];
  snprintf(msg, sizeof(msg), "radio ABAJO %lu ms (desaparece del aire)", (unsigned long)ms);
  logLine(msg);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 6. CONSOLA DE CONTROL (protocolo documentado en el README)
// ═══════════════════════════════════════════════════════════════════════════════════════════════

static void printHelp(Print &out) {
  out.println("[emu] comandos (una línea, terminada en Enter):");
  out.println("  help | status | selftest | reboot");
  out.println("  read [n] [ms]        n lecturas (default 1) separadas ms (default gap)");
  out.println("  same [n] [ms]        n lecturas del MISMO EID (dedup: ventana de 3000 ms por TAG)");
  out.println("  burst [n]            n lecturas sin pausa (rafaga <1s)");
  out.println("  eid [15dig|ar|def]   fija/muestra el EID actual");
  out.println("  seq on|off           EIDs incrementales (muchos animales)");
  out.println("  gap <ms>             separacion por defecto de una serie");
  out.println("  auto <ms>            emision automatica cada ms (0 = off)");
  out.println("  mute <s>             conectado pero MUDO s segundos (0 = cancelar)");
  out.println("  drop                 corta el link (sigue visible y emparejado)");
  out.println("  off <ms>             radio abajo ms (desaparece del aire) y vuelve");
  out.println("  flap <n> <ms>        n ciclos de off/on con ms abajo (backoff)");
  out.println("  bad <caso>           header|short|long|alpha|tsjunk|nots|noterm|binary|empty|garbage");
  out.println("  split [ms]           trama valida partida en 2 escrituras");
  out.println("  double               2 tramas validas en UNA escritura");
  out.println("  stx on|off           byte de control 0x02 al inicio");
  out.println("  term crlf|lf|cr|none terminador de linea");
  out.println("  clock [YYMMDDHHMMSS] reloj del lector");
  out.println("  name [nombre|reset]  nombre Bluetooth (persiste y reinicia)");
#if EMU_MODE == MODO_GATT
  out.println("  chunk <n>            bytes por notificacion (0 = una sola)");
#endif
#if EMU_MODE == MODO_HID
  out.println("  hidterm enter|tab|none | hiddelay <ms> | hidraw on|off");
  out.println("  bonds                lista los emparejamientos guardados (sobreviven al reboot)");
  out.println("  unbond               borra TODOS los bonds (dejar limpio antes de un gate)");
#endif
  out.println("  boton BOOT: corto = 1 lectura | largo = off 5000");
}

static const char *termName(EmuTerm t) {
  return (t == EMU_TERM_CRLF) ? "crlf" : (t == EMU_TERM_LF) ? "lf" : (t == EMU_TERM_CR) ? "cr" : "none";
}

static void printStatus(Print &out) {
  char ts[13];
  formatReaderClock(ts, readerClockNow());
  out.print("[emu] modo=");
  out.print(txModeName());
  out.print(" nombre=");
  out.println(txDeviceName());
  out.print("[emu] link=");
  out.print(txLinked() ? "CONECTADO" : "libre");
  out.print(g_radioDown ? " radio=ABAJO" : " radio=arriba");
  out.print(g_muted ? " MUDO" : "");
  out.print(" lecturas=");
  out.println(g_readCount);
  out.print("[emu] eid=");
  out.print(g_eid);
  out.print(" seq=");
  out.print(g_seq ? "on" : "off");
  out.print(" stx=");
  out.print(g_stx ? "on" : "off");
  out.print(" term=");
  out.print(termName(g_term));
  out.print(" reloj=");
  out.println(ts);
  out.print("[emu] gap=");
  out.print(g_gapMs);
  out.print("ms auto=");
  out.print(g_autoMs);
  out.print("ms pendientes=");
  out.print(g_pending);
#if EMU_MODE == MODO_GATT
  out.print(" chunk=");
  out.print(g_chunk);
#endif
#if EMU_MODE == MODO_HID
  out.print(" hidterm=");
  out.print(g_hidTermKey == '\n' ? "enter" : g_hidTermKey == '\t' ? "tab" : "none");
  out.print(" hiddelay=");
  out.print(g_hidKeyDelayMs);
  out.print("ms hidraw=");
  out.print(g_hidRaw ? "on" : "off");
#endif
  out.print(" heap=");
  out.println(ESP.getFreeHeap());
#if EMU_MODE == MODO_HID
  // La línea que faltaba: sin ella, "conectado sin emparejar" y "conectado y tipeando" se ven igual.
  out.print("[emu] cifrado=");
  out.print(g_bleEncrypted ? "SI" : (g_bleAuthFailed ? "NO (el pairing falló)" : "no"));
  out.print(" cccd=");
  out.print(hidSubscribed() ? "suscripto" : "apagado");
  out.print(" auth_mode=0x");
  out.print(g_bleAuthMode, HEX);
  out.print(" bonds=");
  out.println(esp_ble_get_bond_device_num());
#endif
}

/**
 * Imprime cada variante de trama SIN necesidad de teléfono ni de conexión. Sirve para comparar la
 * salida del generador contra la captura de campo y contra los casos de parser-rs420.test.ts en la
 * mesa, antes de conectar nada.
 */
static void printSelfTest(Print &out) {
  uint8_t buf[64];
  size_t len = buildReaderFrame(buf, sizeof(buf), g_eid, true, EMU_TERM_CRLF, true, EMU_DEFAULT_CLOCK);
  out.print("[emu] captura de campo   : ");
  printEscaped(out, buf, len);
  out.println();
  len = buildCurrentFrame(buf, sizeof(buf));
  out.print("[emu] trama actual       : ");
  printEscaped(out, buf, len);
  out.println();
  for (uint8_t i = 0; i < BAD_COUNT; i++) {
    len = buildBadFrame(buf, sizeof(buf), (EmuBadCase)i);
    out.print("[emu] malformada ");
    out.print(BAD_NAMES[i]);
    for (size_t p = strlen(BAD_NAMES[i]); p < 8; p++) out.print(' ');
    out.print(": ");
    printEscaped(out, buf, len);
    out.println();
  }
  // Ojo con `noterm`: su CONTENIDO es una trama válida. El defecto es de transporte (sin terminador
  // la línea no se entrega nunca), así que no se verifica contra el parser sino contra el framer.
  out.println("[emu] las 2 primeras deben dar el EID; las malformadas, null en parseRs420Line —");
  out.println("[emu] MENOS 'noterm', cuyo contenido es válido: ese se verifica contra el framer");
  out.println("[emu] (la línea no se tiene que entregar hasta que llegue un terminador).");
}

/** Parte la línea en comando + hasta 2 argumentos (in-place). */
static void splitArgs(char *line, char **cmd, char **a1, char **a2) {
  *cmd = *a1 = *a2 = nullptr;
  char **slots[3] = {cmd, a1, a2};
  uint8_t slot = 0;
  char *p = line;
  while (*p != '\0' && slot < 3) {
    while (*p == ' ' || *p == '\t') p++;
    if (*p == '\0') break;
    *slots[slot++] = p;
    while (*p != '\0' && *p != ' ' && *p != '\t') p++;
    if (*p != '\0') *p++ = '\0';
  }
}

static bool isOn(const char *s) {
  return s != nullptr && (strcmp(s, "on") == 0 || strcmp(s, "1") == 0 || strcmp(s, "si") == 0);
}

static uint32_t argU32(const char *s, uint32_t fallback) {
  if (s == nullptr || *s == '\0') return fallback;
  char *end = nullptr;
  const unsigned long v = strtoul(s, &end, 10);
  if (end == s) return fallback;
  return (uint32_t)v;
}

static void lowerInPlace(char *s) {
  if (s == nullptr) return;
  for (char *p = s; *p != '\0'; p++) *p = (char)tolower((unsigned char)*p);
}

static void handleCommandLine(char *line, Print &out) {
  char *cmd = nullptr, *a1 = nullptr, *a2 = nullptr;
  splitArgs(line, &cmd, &a1, &a2);
  if (cmd == nullptr) return;
  lowerInPlace(cmd);
  // Los argumentos se normalizan a minúscula MENOS el de `name`: ese es un nombre Bluetooth y se
  // guarda tal cual se escribió (lo va a ver el operario en los ajustes del teléfono).
  if (strcmp(cmd, "name") != 0) {
    lowerInPlace(a1);
    lowerInPlace(a2);
  }

  if (strcmp(cmd, "help") == 0 || strcmp(cmd, "?") == 0) {
    printHelp(out);
  } else if (strcmp(cmd, "status") == 0 || strcmp(cmd, "st") == 0) {
    printStatus(out);
  } else if (strcmp(cmd, "selftest") == 0) {
    printSelfTest(out);
  } else if (strcmp(cmd, "read") == 0 || strcmp(cmd, "r") == 0) {
    scheduleReads(argU32(a1, 1), argU32(a2, g_gapMs), false);
  } else if (strcmp(cmd, "same") == 0) {
    scheduleReads(argU32(a1, 3), argU32(a2, g_gapMs), true);
  } else if (strcmp(cmd, "burst") == 0) {
    scheduleReads(argU32(a1, 5), 0, false);  // sin pausa: varias lecturas en <1s
  } else if (strcmp(cmd, "eid") == 0) {
    if (a1 == nullptr) {
      out.print("[emu] eid=");
      out.println(g_eid);
    } else if (strcmp(a1, "ar") == 0) {
      snprintf(g_eid, sizeof(g_eid), "%s", EMU_AR_EID);
      printStatus(out);
    } else if (strcmp(a1, "def") == 0) {
      snprintf(g_eid, sizeof(g_eid), "%s", EMU_DEFAULT_EID);
      printStatus(out);
    } else if (eidIsValid(a1)) {
      snprintf(g_eid, sizeof(g_eid), "%s", a1);
      printStatus(out);
    } else {
      logLine("ERR: el EID tiene que ser EXACTAMENTE 15 dígitos");
    }
  } else if (strcmp(cmd, "seq") == 0) {
    g_seq = isOn(a1);
    printStatus(out);
  } else if (strcmp(cmd, "gap") == 0) {
    g_gapMs = argU32(a1, g_gapMs);
    printStatus(out);
  } else if (strcmp(cmd, "auto") == 0) {
    g_autoMs = argU32(a1, 0);
    g_autoNextMs = millis() + g_autoMs;
    printStatus(out);
  } else if (strcmp(cmd, "mute") == 0) {
    const uint32_t secs = argU32(a1, 30);
    if (secs == 0) {
      g_muted = false;
      logLine("mudez cancelada");
    } else {
      g_muted = true;
      g_muteUntilMs = millis() + secs * 1000u;
      char msg[72];
      snprintf(msg, sizeof(msg), "MUDO %lu s: conectado y sin emitir (bastón prendido que no lee)",
               (unsigned long)secs);
      logLine(msg);
    }
  } else if (strcmp(cmd, "drop") == 0) {
    logLine("corto el link desde el emulador (sigue visible y emparejado)");
    txDropLink();
  } else if (strcmp(cmd, "off") == 0) {
    radioDownFor(argU32(a1, 5000));
  } else if (strcmp(cmd, "flap") == 0) {
    g_flapNextDownMs = 0;  // cancela un flap anterior en curso
    g_flapLeft = argU32(a1, 3);
    g_flapDownMs = argU32(a2, 3000);
    char msg[72];
    snprintf(msg, sizeof(msg), "flap: %lu ciclo(s) de %lu ms abajo + %d ms arriba",
             (unsigned long)g_flapLeft, (unsigned long)g_flapDownMs, EMU_FLAP_SETTLE_MS);
    logLine(msg);
    if (g_flapLeft > 0) {
      g_flapLeft--;
      radioDownFor(g_flapDownMs);
    }
  } else if (strcmp(cmd, "bad") == 0) {
    bool found = false;
    for (uint8_t i = 0; i < BAD_COUNT && a1 != nullptr; i++) {
      if (strcmp(a1, BAD_NAMES[i]) == 0) {
        emitBad((EmuBadCase)i);
        found = true;
        break;
      }
    }
    if (!found) logLine("ERR: bad <header|short|long|alpha|tsjunk|nots|noterm|binary|empty|garbage>");
  } else if (strcmp(cmd, "split") == 0) {
    emitSplit(argU32(a1, 300));
  } else if (strcmp(cmd, "double") == 0) {
    emitDouble();
  } else if (strcmp(cmd, "stx") == 0) {
    g_stx = isOn(a1);
    printStatus(out);
  } else if (strcmp(cmd, "term") == 0) {
    if (a1 == nullptr) {
      logLine("ERR: term crlf|lf|cr|none");
    } else if (strcmp(a1, "crlf") == 0) {
      g_term = EMU_TERM_CRLF;
      printStatus(out);
    } else if (strcmp(a1, "lf") == 0) {
      g_term = EMU_TERM_LF;
      printStatus(out);
    } else if (strcmp(a1, "cr") == 0) {
      g_term = EMU_TERM_CR;
      printStatus(out);
    } else if (strcmp(a1, "none") == 0) {
      g_term = EMU_TERM_NONE;
      printStatus(out);
    } else {
      logLine("ERR: term crlf|lf|cr|none");
    }
  } else if (strcmp(cmd, "clock") == 0) {
    if (a1 == nullptr) {
      printStatus(out);
    } else {
      uint32_t secs = 0;
      if (parseReaderClock(a1, &secs)) {
        g_clockBaseSecs = secs;
        g_clockBaseMs = millis();
        printStatus(out);
      } else {
        logLine("ERR: clock YYMMDDHHMMSS (12 dígitos)");
      }
    }
  } else if (strcmp(cmd, "name") == 0) {
    if (a1 == nullptr) {
      out.print("[emu] nombre=");
      out.println(g_btName);
    } else if (strcasecmp(a1, "reset") == 0) {
      storeBtName(nullptr);
      logLine("nombre por defecto restaurado; reiniciando…");
      delay(200);
      ESP.restart();
    } else if (strlen(a1) > EMU_NAME_MAX) {
      // No es un capricho: en BLE el nombre viaja en los 31 bytes del paquete de advertising junto
      // con los flags, el appearance y el UUID de servicio. Si no entra, la lib lo TRUNCA en
      // silencio (`buildRawAdvData`) y uno se pasa media hora buscando por qué el teléfono ve otro
      // nombre. Se corta acá, con el motivo.
      char msg[80];
      snprintf(msg, sizeof(msg), "ERR: el nombre no puede pasar de %d caracteres (BLE lo truncaría)", EMU_NAME_MAX);
      logLine(msg);
    } else {
      storeBtName(a1);
      logLine("nombre guardado; reiniciando (el emparejamiento viejo puede quedar obsoleto)…");
      delay(200);
      ESP.restart();
    }
  } else if (strcmp(cmd, "reboot") == 0) {
    logLine("reiniciando…");
    delay(200);
    ESP.restart();
#if EMU_MODE == MODO_GATT
  } else if (strcmp(cmd, "chunk") == 0) {
    g_chunk = (uint16_t)argU32(a1, g_chunk);
    printStatus(out);
#endif
#if EMU_MODE == MODO_HID
  } else if (strcmp(cmd, "hidterm") == 0) {
    if (a1 != nullptr && strcmp(a1, "tab") == 0) {
      g_hidTermKey = '\t';
    } else if (a1 != nullptr && strcmp(a1, "none") == 0) {
      g_hidTermKey = '\0';
    } else {
      g_hidTermKey = '\n';
    }
    printStatus(out);
  } else if (strcmp(cmd, "hiddelay") == 0) {
    g_hidKeyDelayMs = argU32(a1, g_hidKeyDelayMs);
    printStatus(out);
  } else if (strcmp(cmd, "hidraw") == 0) {
    g_hidRaw = isOn(a1);
    printStatus(out);
  } else if (strcmp(cmd, "bonds") == 0) {
    hidPrintBonds(out);
  } else if (strcmp(cmd, "unbond") == 0) {
    hidClearBonds(out);
    hidPrintBonds(out);
#endif
  } else if (strcmp(cmd, "chunk") == 0 || strcmp(cmd, "hidterm") == 0 || strcmp(cmd, "hiddelay") == 0 ||
             strcmp(cmd, "hidraw") == 0 || strcmp(cmd, "bonds") == 0 || strcmp(cmd, "unbond") == 0) {
    // El comando existe pero es de otro modo: se dice, no se ignora en silencio.
    logLine("ERR: ese comando no aplica al modo compilado");
  } else {
    logLine("ERR: comando desconocido (probá 'help')");
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 7. ENTRADAS (puerto serie + botón BOOT) Y LOOP
// ═══════════════════════════════════════════════════════════════════════════════════════════════

static char g_lineBuf[80];
static size_t g_lineLen = 0;

#if EMU_MODE == MODO_GATT
/** Ejecuta el comando que llegó por aire, ya fuera del callback del stack BLE. */
static void pollAirCommand() {
  if (!g_airCmdReady) return;
  char line[sizeof(g_airCmd)];
  snprintf(line, sizeof(line), "%s", g_airCmd);
  g_airCmdReady = false;
  Serial.print("[emu] comando por aire: ");
  Serial.println(line);
  handleCommandLine(line, Serial);
}
#endif

static void pollSerial() {
  while (Serial.available() > 0) {
    const int c = Serial.read();
    if (c < 0) break;
    if (c == '\n' || c == '\r') {
      if (g_lineLen > 0) {
        g_lineBuf[g_lineLen] = '\0';
        handleCommandLine(g_lineBuf, Serial);
        g_lineLen = 0;
      }
    } else if (g_lineLen + 1 < sizeof(g_lineBuf)) {
      g_lineBuf[g_lineLen++] = (char)c;
    }
  }
}

#if EMU_BOOT_PIN >= 0
static bool g_btnDown = false;
static uint32_t g_btnSinceMs = 0;

/** BOOT: pulsación corta = una lectura; larga (≥800 ms) = radio abajo 5 s. Sirve sin consola. */
static void pollButton() {
  const bool down = digitalRead(EMU_BOOT_PIN) == LOW;
  const uint32_t now = millis();
  if (down && !g_btnDown) {
    g_btnDown = true;
    g_btnSinceMs = now;
  } else if (!down && g_btnDown) {
    g_btnDown = false;
    const uint32_t heldMs = now - g_btnSinceMs;
    if (heldMs < 30) return;  // rebote
    if (heldMs < 800) {
      scheduleReads(1, 0, false);
    } else {
      radioDownFor(5000);
    }
  }
}
#endif

static void pollScenarios() {
  const uint32_t now = millis();

  if (g_muted && timeReached(g_muteUntilMs)) {
    g_muted = false;
    logLine("fin de la mudez");
  }

  if (g_radioDown && timeReached(g_radioBackMs)) {
    g_radioDown = false;
    txRadioOn();
    // El heap va en el log a propósito: bajar y subir el stack Bluetooth muchas veces (un `flap`
    // largo) puede irlo comiendo, y así se ve ANTES de confundir una fuga con un bug de la app.
    char msg[64];
    snprintf(msg, sizeof(msg), "radio ARRIBA otra vez (heap %lu)", (unsigned long)ESP.getFreeHeap());
    logLine(msg);
    // Si quedan ciclos de flap, el próximo corte NO es inmediato: se le da aire para que el
    // reintento del backoff alcance a conectar y el ciclo pruebe reconexión, no solo ausencia.
    if (g_flapLeft > 0) g_flapNextDownMs = now + EMU_FLAP_SETTLE_MS;
  }

  if (g_flapNextDownMs != 0 && timeReached(g_flapNextDownMs)) {
    g_flapNextDownMs = 0;
    g_flapLeft--;
    radioDownFor(g_flapDownMs);
  }

  if (g_pending > 0 && timeReached(g_nextEmitMs)) {
    emitReading(!g_pendingSame);
    g_pending--;
    g_nextEmitMs = millis() + g_pendingGapMs;
  }

  if (g_autoMs > 0 && timeReached(g_autoNextMs)) {
    emitReading(true);
    g_autoNextMs = millis() + g_autoMs;
  }
}

void setup() {
  Serial.begin(EMU_SERIAL_BAUD);
  delay(300);
#if EMU_LED_PIN >= 0
  pinMode(EMU_LED_PIN, OUTPUT);
  digitalWrite(EMU_LED_PIN, LOW);
#endif
#if EMU_BOOT_PIN >= 0
  pinMode(EMU_BOOT_PIN, INPUT_PULLUP);
#endif

  uint32_t secs = 0;
  if (parseReaderClock(EMU_DEFAULT_CLOCK, &secs)) g_clockBaseSecs = secs;
  g_clockBaseMs = millis();

  loadBtName();

  Serial.println();
  logLine("emulador de bastones RFID (banco de regresión de spec 04)");
  Serial.print("[emu] ");
  Serial.print(txModeName());
  Serial.print(" · se anuncia como '");
  Serial.print(g_btName);
  Serial.println("'");
  txBegin();
  printStatus(Serial);
  logLine("'help' para la lista de comandos");
}

void loop() {
  pollSerial();
#if EMU_MODE == MODO_GATT
  pollAirCommand();
#endif
#if EMU_BOOT_PIN >= 0
  pollButton();
#endif
  txPoll();
  pollScenarios();
  delay(2);
}
