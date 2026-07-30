"""Banco de regresion del baston: corre los escenarios del README contra la app en un Android real.

Requiere, y lo verifica antes de arrancar:
  - el ESP32 flasheado con `-DEMU_MODE=MODO_SPP` y enchufado por USB (COM7 por defecto)
  - el telefono conectado por `adb`, desbloqueado, con el device `RS420-EMU` YA emparejado
  - la app instalada y con sesion iniciada

Uso:
    python run-bench.py                 # los 16 escenarios del README + los 3 casos de estado
    python run-bench.py --port COM5
    python run-bench.py --only E1,E4,BENCH1
    python run-bench.py --list

Escribe el informe en bench-report.md (al lado de este archivo) y sale con codigo != 0 si algun
escenario no dio lo esperado. Los escenarios de estado (BENCH1, LATCH) tocan el Bluetooth del
telefono y lo dejan como estaba.

Por que existe: los tres bugs de `dad711f` eran de maquina de estados y ninguna suite unit los vio.
Esto es lo que convierte "el baston esta cableado" en "el baston lee". Ver
`progress/bench_baston-spp-emulador.md` para la corrida que lo estreno (2026-07-30).
"""
import argparse
import os
import re
import subprocess
import sys
import threading
import time
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
ADB = os.path.expanduser("~/AppData/Local/Android/Sdk/platform-tools/adb.exe")
PKG = "ar.rafq.app"
REPORT = os.path.join(HERE, "bench-report.md")

# ─── adb ────────────────────────────────────────────────────────────────────────


def adb(*args, binary=False, timeout=60):
    out = subprocess.run([ADB, *args], capture_output=True, timeout=timeout)
    return out.stdout if binary else out.stdout.decode("utf-8", "replace")


def adb_shell(cmd, timeout=60):
    return adb("shell", cmd, timeout=timeout)


# ─── lectura de la UI (uiautomator, parseado como XML) ──────────────────────────

BOUNDS = re.compile(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]")
# One UI mete marcadores de direccion invisibles que rompen cualquier regex ingenuo
INVIS = re.compile("[‎‏‪-‮⁦-⁩]")


def norm(s):
    return INVIS.sub("", s or "").strip()


def ui_nodes():
    raw = adb_shell("uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; cat /sdcard/ui.xml")
    i = raw.find("<?xml")
    if i < 0:
        i = raw.find("<hierarchy")
    if i < 0:
        return []
    try:
        root = ET.fromstring(raw[i:].strip())
    except ET.ParseError:
        return []
    out = []
    for n in root.iter("node"):
        txt, desc = norm(n.get("text")), norm(n.get("content-desc"))
        if not (txt or desc):
            continue
        m = BOUNDS.match(n.get("bounds") or "")
        if not m:
            continue
        x1, y1, x2, y2 = (int(v) for v in m.groups())
        out.append(
            {
                "text": txt,
                "desc": desc,
                "rid": n.get("resource-id") or "",
                "box": (x1, y1, x2, y2),
                "cx": (x1 + x2) // 2,
                "cy": (y1 + y2) // 2,
                "clickable": n.get("clickable") == "true",
            }
        )
    return out


def ui_find(pattern, nodes=None):
    rx = re.compile(pattern, re.I)
    return [
        n
        for n in (nodes if nodes is not None else ui_nodes())
        if rx.search(n["text"]) or rx.search(n["desc"]) or rx.search(n["rid"])
    ]


def ui_tap(pattern):
    hits = ui_find(pattern)
    if not hits:
        return False
    clicks = [h for h in hits if h["clickable"]] or hits
    # el clickable mas chico es el mas especifico (evita tapear el contenedor o la nav bar)
    clicks.sort(key=lambda h: (h["box"][2] - h["box"][0]) * (h["box"][3] - h["box"][1]))
    n = clicks[0]
    adb("shell", "input", "tap", str(n["cx"]), str(n["cy"]))
    return True


# ─── puente serie con el emulador ───────────────────────────────────────────────


class Emu:
    """Abre el puerto con DTR/RTS bajos para NO resetear el ESP32 al conectarse."""

    def __init__(self, port):
        import serial  # import perezoso: solo hace falta si se corre de verdad

        self.lines = []
        self.lock = threading.Lock()
        self.ser = serial.Serial()
        self.ser.port = port
        self.ser.baudrate = 115200
        self.ser.timeout = 0.1
        self.ser.dtr = False
        self.ser.rts = False
        try:
            self.ser.open()
        except serial.SerialException as exc:
            if "denegado" in str(exc) or "denied" in str(exc).lower():
                raise SystemExit(
                    "COM %s ocupado: cerra el Monitor Serie del Arduino IDE (o cualquier otra\n"
                    "consola serie) y volve a correr. Un solo proceso puede tener el puerto." % port
                )
            raise
        self.stop = threading.Event()
        threading.Thread(target=self._reader, daemon=True).start()

    def _reader(self):
        buf = b""
        while not self.stop.is_set():
            try:
                chunk = self.ser.read(4096)
            except Exception:
                return
            if not chunk:
                continue
            buf += chunk
            while b"\n" in buf:
                line, buf = buf.split(b"\n", 1)
                with self.lock:
                    self.lines.append(
                        (time.time(), line.decode("utf-8", "replace").rstrip("\r"))
                    )

    def mark(self):
        with self.lock:
            return len(self.lines)

    def since(self, mark):
        with self.lock:
            return [t for _, t in self.lines[mark:]]

    def send(self, cmd):
        self.ser.write((cmd + "\n").encode("utf-8"))
        self.ser.flush()
        time.sleep(0.25)

    def ask(self, cmd, wait=1.5):
        m = self.mark()
        self.send(cmd)
        time.sleep(wait)
        return self.since(m)

    def linked(self):
        return any("link=CONECTADO" in l for l in self.ask("status"))

    def close(self):
        self.stop.set()
        time.sleep(0.2)
        self.ser.close()


# ─── estado de la pantalla /baston ──────────────────────────────────────────────

COUNT = re.compile(r"Lecturas\s*\((\d+)\)")
EID_ROW = re.compile(r"^\d{15}$")


def close_overlay(nodes=None):
    """Cierra el sheet global de find-or-create. NUNCA con back: no tiene BackHandler y
    el back hace pop de la ruta (backlog conocido)."""
    ns = nodes if nodes is not None else ui_nodes()
    if not ui_find(r"Caravana le[ií]da", ns):
        return False
    for n in ns:
        if n["clickable"] and "cerrar" in n["desc"].lower() and (n["box"][2] - n["box"][0]) < 400:
            adb("shell", "input", "tap", str(n["cx"]), str(n["cy"]))
            time.sleep(1.2)
            return True
    adb("shell", "input", "tap", "360", "60")
    time.sleep(1.2)
    return True


def screen():
    ns = ui_nodes()
    count = -1
    for n in ns:
        m = COUNT.search(n["text"])
        if m:
            count = int(m.group(1))
            break
    else:
        if any(n["text"] == "Lecturas" for n in ns):
            count = 0
    status = next(
        (n["text"] for n in ns if n["text"].startswith("Bast") and n["text"] != "Bastón"), ""
    )
    return {
        "count": count,
        "status": status,
        "eids": [n["text"] for n in ns if EID_ROW.match(n["text"])],
        "nodes": ns,
    }


def clear_reads():
    ui_tap(r"^Limpiar$")
    time.sleep(1.0)


def foreground():
    adb("shell", "am", "start", "-n", "%s/.MainActivity" % PKG)
    time.sleep(4)


def background():
    adb("shell", "input", "keyevent", "KEYCODE_HOME")
    time.sleep(3)


def ensure_connected(emu, tries=2):
    """Deja la app y el emulador conectados de verdad (no solo segun la app)."""
    for _ in range(tries):
        foreground()
        close_overlay()
        if emu.linked() and "conectado" in screen()["status"].lower():
            return True
        # desconectar y reconectar por gesto
        if ui_tap("stick-status-cta"):
            time.sleep(3)
        ui_tap("stick-device-row")
        time.sleep(7)
    return emu.linked()


# ─── escenarios ─────────────────────────────────────────────────────────────────
# (id, titulo, [comandos], espera_seg, esperado_o_None, nota)
COUNTING = [
    ("E1", "repetidas dentro de la ventana de dedup", ["seq off", "same 5 300"], 6, 1),
    ("E2", "repetidas CRUZANDO la ventana", ["gap 800", "same 5"], 8, 2),
    ("E3", "ráfaga del mismo animal", ["seq off", "burst 8"], 6, 1),
    ("E4", "ráfaga de animales distintos", ["seq on", "burst 8"], 8, 8),
    ("E5", "lecturas espaciadas", ["seq off", "same 5 3500"], 20, 5),
    ("E6", "muchos animales", ["seq on", "read 20 500"], 16, 20),
    (
        "E7",
        "9 tramas malformadas",
        ["seq off"] + ["bad " + c for c in
                       "header short long alpha tsjunk nots binary empty garbage".split()],
        10,
        0,
    ),
    ("E8", "trama sin terminador, sola", ["bad noterm"], 6, 0),
    ("E8b", "sin terminador + una válida (se la come)", ["bad noterm", "read"], 6, 0),
    ("E9", "trama partida en dos escrituras", ["split 300"], 6, 1),
    ("E10", "dos tramas pegadas", ["seq on", "double"], 6, 2),
    ("E11", "terminador LF solo", ["term lf", "read"], 6, 1),
    ("E12", "sin byte STX", ["stx off", "read"], 6, 1),
    ("E12c", "vuelta a STX+CRLF", ["stx on", "term crlf", "read"], 6, 1),
    ("E16", "conectado pero mudo", ["mute 15", "read 5"], 20, 0),
    ("E16b", "post-mute vuelve a leer", ["read"], 8, 1),
]


def run_counting(emu, sid, title, cmds, wait, expected, out):
    close_overlay()
    clear_reads()
    mark = emu.mark()
    for c in cmds:
        emu.send(c)
    time.sleep(wait)
    close_overlay()
    st = screen()
    ok = expected is None or st["count"] == expected
    out.append(
        "| %s | %s | `%s` | %s | **%s** | %s |"
        % (sid, title, " ; ".join(cmds), expected, st["count"], "✅" if ok else "❌")
    )
    return ok


def run_drop(emu, out):
    """E13/E14/E15: cortes y reconexion. Oraculo = el link del emulador + que vuelva a leer."""
    ok_all = True
    for sid, title, cmd, wait in [
        ("E13", "corte del link (drop)", "drop", 30),
        ("E14", "bastón apagado 8s", "off 8000", 45),
        ("E15", "flap: 4 cortes seguidos", "flap 4 3000", 75),
    ]:
        close_overlay()
        clear_reads()
        emu.send(cmd)
        time.sleep(wait)
        close_overlay()
        clear_reads()
        emu.send("read")
        time.sleep(6)
        close_overlay()
        st = screen()
        ok = st["count"] == 1
        ok_all = ok_all and ok
        out.append(
            "| %s | %s | `%s` | reconecta y vuelve a leer | **%s** | %s |"
            % (sid, title, cmd, "lee" if ok else "NO lee", "✅" if ok else "❌")
        )
    return ok_all


def run_bench1(emu, out):
    """BENCH1: corte con la app MINIMIZADA -> ¿queda un 'conectado' mentiroso?

    Es el 🔴 mas grave que encontro la corrida del 2026-07-30 (3/3 repro contra `dad711f`).
    PASA si al volver a primer plano la app NO miente: o dice que esta desconectada, o
    reconcilia y vuelve a leer.
    """
    if not ensure_connected(emu):
        out.append("| BENCH1 | corte con la app minimizada | — | — | **no se pudo conectar** | ⚠️ |")
        return False
    background()
    emu.send("off 8000")
    time.sleep(22)
    linked = emu.linked()
    foreground()
    close_overlay()
    clear_reads()
    st = screen()
    dice_conectado = "conectado" in st["status"].lower() and "desconectado" not in st["status"].lower()
    emu.send("read")
    time.sleep(6)
    close_overlay()
    lee = screen()["count"] == 1
    miente = dice_conectado and not lee
    out.append(
        "| BENCH1 | corte con la app MINIMIZADA | `off 8000` en background | no mentir | "
        "**app dice %r · emulador link=%s · lee=%s** | %s |"
        % (st["status"], "CONECTADO" if linked else "libre", lee, "❌ MIENTE" if miente else "✅")
    )
    return not miente


def run_latch(emu, out):
    """LATCH: BT apagado, la app pide activarlo, y el operario lo prende por afuera sin
    contestarle al dialogo. PASA si la app se recupera sola en <60s.

    Deja el Bluetooth prendido, como estaba.
    """
    ensure_connected(emu)
    adb_shell("cmd bluetooth_manager disable")
    time.sleep(12)
    adb_shell("cmd bluetooth_manager enable")  # el operario lo prende desde el panel rapido
    time.sleep(60)
    st = screen()
    recovered = emu.linked()
    # limpieza: si quedo un dialogo del sistema colgado, lo cancelamos
    if ui_find(r"solicitando que active Bluetooth"):
        adb("shell", "input", "keyevent", "KEYCODE_BACK")
        time.sleep(8)
    out.append(
        "| LATCH | BT prendido por afuera sin contestar el diálogo | `bluetooth_manager disable/enable` | "
        "reconecta sola en <60s | **%s** (app: %r) | %s |"
        % ("reconectó" if recovered else "NO reconectó", st["status"], "✅" if recovered else "❌")
    )
    return recovered


ALL_IDS = [s[0] for s in COUNTING] + ["E13", "E14", "E15", "BENCH1", "LATCH"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", default="COM7")
    ap.add_argument("--only", default="")
    ap.add_argument("--list", action="store_true")
    args = ap.parse_args()

    if args.list:
        print("\n".join(ALL_IDS))
        return 0

    only = {s.strip() for s in args.only.split(",") if s.strip()}

    # ── precondiciones, explicitas (un banco que arranca a medias miente) ──
    if PKG not in adb("shell", "pm", "list", "packages"):
        print("FALTA: la app %s no esta instalada" % PKG)
        return 2
    if "RS420-EMU" not in adb_shell("dumpsys bluetooth_manager"):
        print("FALTA: RS420-EMU no esta emparejado (Ajustes > Bluetooth del telefono)")
        return 2
    emu = Emu(args.port)
    st = emu.ask("status")
    if not any("MODO_SPP" in l for l in st):
        print("FALTA: el ESP32 no esta en MODO_SPP:\n  " + "\n  ".join(st))
        emu.close()
        return 2

    adb_shell("svc power stayon usb")
    adb("shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", "rafq://baston")
    time.sleep(5)
    if not ensure_connected(emu):
        print("FALTA: no se pudo dejar el baston conectado")
        emu.close()
        return 2

    out = [
        "# Banco del bastón — corrida automática",
        "",
        "| # | escenario | comando | esperado | medido | |",
        "|---|---|---|---|---|---|",
    ]
    failures = []

    for sid, title, cmds, wait, expected in COUNTING:
        if only and sid not in only:
            continue
        if not run_counting(emu, sid, title, cmds, wait, expected, out):
            failures.append(sid)

    if not only or {"E13", "E14", "E15"} & only:
        if not run_drop(emu, out):
            failures.append("E13/E14/E15")
    if not only or "BENCH1" in only:
        if not run_bench1(emu, out):
            failures.append("BENCH1")
    if not only or "LATCH" in only:
        if not run_latch(emu, out):
            failures.append("LATCH")

    out.append("")
    out.append("**%d escenario(s) en rojo**: %s" % (len(failures), ", ".join(failures) or "ninguno"))
    text = "\n".join(out)
    print(text)
    with open(REPORT, "w", encoding="utf-8") as fh:
        fh.write(text + "\n")
    emu.close()
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
