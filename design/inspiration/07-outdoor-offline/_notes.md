# 07 — Outdoor / Offline / High Contrast

Refs para el lado **manga** de RAFAQ — operario en sol fuerte, una mano, offline-first.

---

## komoot-navigate-save-offline.png · komoot ⭐⭐

**Offline como CTA visible**, no escondido en menú.

Header con back + título "The Ancient Aravalli Range o..." + menú dots. Mapa cream/oliva con ruta azul punteada + paneles satelitales a la derecha (3 layers + view modes). **CTA dual fixed-bottom: "Navigate" sólido naranja-terracota** (con icono arrow) + **"Save offline" outline blanco** (con icono download). Sección "Surfaces" expandible con dropdown + barra de progreso de superficies (Street 3.81 mi grey + asphalt + dirt). Bottom nav 5 items con icono + label.

- [pattern] **offline como CTA igual de visible que la acción primaria**
- [keep] **principio universal para RAFAQ offline-first**: cuando un screen tiene acción que requiere conectividad (sync, descargar, enviar email), el equivalente offline debe ser CTA visible, no opción oculta
- [keep] paleta naranja CTA + cream + verde-oliva del mapa = **Campo Profundo en acción**
- [mobbin] https://mobbin.com/screens/f95ad840-1c57-421f-8bdb-47a76692c209

---

## alltrails-stats-floating-card.png · AllTrails ⭐

**Floating stats card** para datos puntuales clean sobre map.

Mapa satellite con ruta verde + azul + waypoint blanco circular. **Card flotante esquina superior derecha**: `Length 0.9 mi · Elev. gain 330 ft` con tipografía clean grey small label + número bold. Card inferior con nombre "Hemlock Falls Trail via Lenape, Ra..." + ubicación + play icon.

- [pattern] **floating card con stats** sin invadir el contenido principal
- [keep] **molde para mostrar stats durante carga de animal**: peso, conteo de animales pesados, último TAG leído. Visible pero no invasivo.
- [keep] **card inferior con nombre + meta + acción primaria** = footer pattern para detail screens
- [mobbin] https://mobbin.com/screens/3d94d831-ae33-4674-8723-65bf3f62d69f

---

## apple-maps-dark-instruction.png · Apple Maps

**Alert crítica en bocadillo dark de máximo contraste**.

Bocadillo grande dark esquina superior con flecha grande arrow `↗ 700 ft Turn right onto Santa Cruz Ave` con dot indicators de instrucciones próximas. Resto del mapa Apple Maps dark mode con calles. Pin "1226 University Dr" rojo. Bottom sheet "To Foothills Park · 19 min" con drag handle.

- [pattern] **alert crítica como bocadillo dark de máximo contraste**, contenido siempre visible aunque el resto sea caótico
- [keep] **molde para alerts/warnings durante carga**: "TAG ya registrado en este rodeo", "Sin conexión BLE al bastón", "Sesión pausada" — bocadillo dark sobre cualquier fondo
- [mobbin] https://mobbin.com/screens/fa3e962f-5b20-4705-b9ee-853017b9c8b4
