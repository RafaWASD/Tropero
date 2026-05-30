#!/usr/bin/env python3
# scripts/cdp-capture.py — captura fiel de una ruta web via CDP (design-review skill).
#
# Render fiel = Emulation.setDeviceMetricsOverride (viewport mobile real), NO
# --window-size (da falso recorte). Chrome headless con remote-debugging.
#
# Uso: python scripts/cdp-capture.py <url> <out.png> [width] [height] [dsf]
import json
import sys
import time

from websocket import create_connection

url = sys.argv[1]
out = sys.argv[2]
width = int(sys.argv[3]) if len(sys.argv) > 3 else 412
height = int(sys.argv[4]) if len(sys.argv) > 4 else 915
dsf = int(sys.argv[5]) if len(sys.argv) > 5 else 2

PORT = 9223
import urllib.request

# Descubrir el target page (CDP /json).
targets = json.loads(urllib.request.urlopen(f"http://localhost:{PORT}/json").read())
page = next(t for t in targets if t["type"] == "page")
ws_url = page["webSocketDebuggerUrl"]

ws = create_connection(ws_url, max_size=None)
_id = 0


def cmd(method, params=None, settle=0.0):
    global _id
    _id += 1
    ws.send(json.dumps({"id": _id, "method": method, "params": params or {}}))
    while True:
        msg = json.loads(ws.recv())
        if msg.get("id") == _id:
            if settle:
                time.sleep(settle)
            return msg
        # ignorar eventos


cmd("Page.enable")
cmd("Runtime.enable")
# Viewport mobile real (412 x 915, dsf 2, mobile=true) — el "fiel".
cmd(
    "Emulation.setDeviceMetricsOverride",
    {
        "width": width,
        "height": height,
        "deviceScaleFactor": dsf,
        "mobile": True,
        "screenWidth": width,
        "screenHeight": height,
    },
)
cmd("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 5})

# Navegar y esperar el bundle de Metro + el render del árbol RN-web.
cmd("Page.navigate", {"url": url})
print(f"navigated to {url}, waiting for Metro bundle + render...", flush=True)
time.sleep(35)  # primer bundle de Metro es lento; damos margen amplio.

# Verificar que hay contenido (heurística: el body tiene texto "Mis campos").
probe = cmd(
    "Runtime.evaluate",
    {
        "expression": "document.body ? document.body.innerText.slice(0,400) : 'NO-BODY'",
        "returnByValue": True,
    },
)
text = probe.get("result", {}).get("result", {}).get("value", "")
# ASCII-safe (la consola Windows es cp1252; el body trae el ⚠ que rompe el encode).
safe = text.encode("ascii", "replace").decode("ascii")
print("BODY-TEXT-PROBE:", repr(safe)[:300], flush=True)

# Pequeño settle extra para fuentes/imágenes.
time.sleep(4)

shot = cmd("Page.captureScreenshot", {"format": "png", "captureBeyondViewport": True})
data = shot["result"]["data"]
import base64

with open(out, "wb") as f:
    f.write(base64.b64decode(data))
print(f"saved {out}", flush=True)
ws.close()
