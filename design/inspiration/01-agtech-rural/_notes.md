# 01 — Agtech / Tracking de seres vivos

Mobbin no tiene Auravant, JDOC, FieldView ni Allflex (son apps muy verticales). Los patterns más cercanos vienen de **tracking individual de seres vivos** (mascotas, salud personal) — la analogía estructural es directa: identidad + status + métricas + chronología.

> ⚠ Tarea offline pendiente para Raf: capturar screens reales con device de **Auravant**, **John Deere Operations Center**, **Climate FieldView** — esas son las refs culturales más directas y Mobbin no las tiene. Guardar acá como `auravant-*.png` etc.

---

## fi-home-tracker.png · Fi (collar tracker mascotas)

**Pattern directo aplicable a "ficha de animal"** del spec 02.

Header con nombre "Tilda" + breed "SCOTTISH FOLD" pequeño debajo + iconos (regalo + bell). Card mapa con badge "67% · Online · Now" + chevron de battery + ubicación dentro de un cuadrado amarillo. Dos cards "Rest" y "Activity" con métrica + sparkline pequeño verde. Sección "Last time outside" + bottom nav Live/Health/Community/Tilda.

- [pattern] **identidad animal arriba (nombre + sub-categoría) + status + métricas en cards** — molde de ficha de animal RAFAQ
- [layout] hero map + cards 2-col + sección scrollable
- [keep] **estructura entera adaptable**: cambiar gato por vaca, breed por categoría (vaquillona/vaca/toro), location por rodeo actual, métricas por peso/preñez/última vacunación
- [adapt] paleta neutra → Campo Profundo
- [mobbin] https://mobbin.com/screens/0664355c-9bc5-4a8a-8b06-ea31593f8601

---

## fi-discover-timeline.png · Fi

**Cards scrollable + timeline pattern para chronology del animal**.

Continuación del scroll del home — "Naps Today" + "Active Time" cards en grid 2-col con número grande color + ilustraciones pequeñas. Sección "Last time outside" con timeline link + card "Your cat's time outside of the safe zone will show up here" + ilustración trees. Sección "Discover" con card promocional.

- [pattern] mix de cards metrics + cards informacionales + empty states ilustrados con micro-copy
- [keep] **empty state con micro-ilustración** ("Your cat's time will show up here") = pattern para "Aún no cargaste eventos en este animal"
- [mobbin] https://mobbin.com/screens/9ab8e5f6-2417-44c8-82e9-b585908c9407

---

## withings-home-greeting.png · Withings Health Mate

**Pattern de home post-creación de establishment** (R3 + R6.1 spec 01).

"Good morning, John" headline + avatar circular arriba a la izquierda + bell de notificaciones + plus + scale icons. Card "You have no new notifications" + sección "Today's Missions" con 2 cards (Article + scale ✓ tarea) + sección "Latest Measurements" con weight + bottom nav.

- [pattern] greeting personal + tasks pendientes en cards + métricas latest
- [keep] **"Good morning, [nombre]" como header de home** es cálido sin ser cursi
- [keep] **lista de tareas pendientes en cards** = pattern R6.5 expandido
- [adapt] paleta neutra → Campo Profundo
- [mobbin] https://mobbin.com/screens/c3703a14-d83b-4170-863f-fd17c6a31b2b
