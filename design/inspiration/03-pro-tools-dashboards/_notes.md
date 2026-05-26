# 03 — Pro Tools / Dashboards / Hero Numbers

Patterns para tu **home post-establishment** (R6.1) y **dashboard de KPIs del rodeo** (spec 07).

---

## revolut-dashboard-dark-hero.png · Revolut Business ⭐⭐

**Dashboard dark con hero number centrado + grid de 4 acciones rápidas + card de status**.

Header avatar + search bar + menú. Hero `$0 Revenue` centrado gigante + "Last 30 days ⓘ" sublabel. Grid de 4 quick actions circulares (`+ Get paid`, `↓ Payout`, `🧩 Integrations`, `⋯ More`). Card oscura "Request to accept customer payments" con stepper horizontal compacto (`Application started ● → Complete application ⚠ → Application under review ○`). Bottom nav 5 items.

- [palette] black/navy dark gradient + texto blanco + accents azul
- [typography] hero number gigante display bold + caption uppercase
- [pattern] **hero number centrado** + **quick actions grid 4-up** + **card con mini-stepper**
- [keep] **layout entero adaptable** para home RAFAQ: hero metric (% preñez del rodeo activo) + quick actions (cargar sesión, ver animales, scan TAG, más) + card de "sesión en curso" o "rodeo pendiente de revisión"
- [mobbin] https://mobbin.com/screens/aeb7ab34-145a-47e8-9036-2091a57c5bf3

---

## docusign-hero-numbers.png · Docusign ⭐

**Hero metric centrado gigante en cards 2-col**.

Header con burger + search. Card púrpura "Upgrade Your Account" con ilustración. Headline `Welcome`. Dos cards 2-col `0 Action Required` + `0 Waiting for Others` con número display masivo (~80pt) negro centrado. Sección "Get started" con 3 rows (Create/Edit profile, Request Signatures, Sign Document) cada una con icono.

- [pattern] **número display masivo centrado en card** + **sección "Get started" como lista de tasks**
- [keep] número masivo en card 2-col es excelente para mostrar pares de KPIs ("preñadas / vacías", "activas / vendidas")
- [keep] "Get started" como lista de tasks complementa el pattern de Jobber
- [mobbin] https://mobbin.com/screens/c16ac9bf-7f44-4e37-b86c-6b7912fe5e1f

---

## revolut-timeline-vertical.png · Revolut Business ⭐

**Timeline vertical para chronology** — referencia directa para ficha de animal (spec 02 acceptance 4: "ficha muestra cronología de eventos").

Card oscura expandida con 4 puntos verticales conectados con línea vertical: `● Application started · Today 3:23 PM`, `⚠ Complete application · Today 3:23 PM · Use the link below to finish` con CTA blanco "Complete application", `○ Application under review`, `○ Application outcome · Est. 04 Dec`. Cancel link al final.

- [pattern] **timeline vertical** con estados (completado/activo/pendiente) + acción inline en evento activo
- [keep] **molde directo para ficha de animal**: cada evento (nacimiento, vacunación, pesaje, sesión maniobra, parto, etc.) como punto en timeline cronológico con expansibles
- [adapt] colores estados → semantic Campo Profundo
- [mobbin] https://mobbin.com/screens/a3c1cf52-5eed-4472-906f-3b0657d3f7be
