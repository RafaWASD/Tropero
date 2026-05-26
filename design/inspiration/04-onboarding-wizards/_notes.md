# 04 — Onboarding / Welcome / Wizards específicos

Refs específicas para tu **flujo signup wizard del spec 01** (splash → signup → verify → onboarding empty state R6.5 → crear establishment R3).

---

## kakao-t-cta-dual.png · Kakao T ⭐⭐ (R6.5 exacto)

**Pattern EXACTO de R6.5 del spec 01**: dos CTAs visibles en empty state.

Header simple con back + título coreano. Sección "담당자로 직접 가입하기" (registrate como responsable) con CTA sólido **amarillo brand** "비즈 통합계정으로 가입하기" + CTA outline azul "직접 가입하기". Separador. Segunda sección "서비스 소개서 받기" (recibir info) con CTA outline "이메일 입력하기".

- [pattern] **CTA dual sólido + outline** dentro de sección visualmente agrupada
- [keep] **es el match exacto para R6.5**: "Crear mi primer campo" (sólido terracota) + "Pegar link de invitación" (outline verde). Más una sección secundaria opcional "Recibir invitación por email" si se quiere ofrecer eso.
- [keep] separador visual entre acciones primarias y secundarias
- [adapt] amarillo → terracota Campo Profundo, azul → verde Campo Profundo
- [mobbin] https://mobbin.com/screens/499c253b-22a9-4065-ae7c-9859f0933146

---

## monday-com-wizard-madlib.png · monday.com

**Wizard tipo "madlib"** con palabras subrayadas como dropdowns inline en el headline.

Step indicator dot pattern arriba. Headline grande negro `I want to manage **More Workflows** and I mainly work on **Business operations**.` con palabras en azul subrayadas (clickeables). Opciones como botones pill grandes 2-col: Business operations (selected azul outline + fondo lila claro), Client projects, Content calendar, Event management. CTA "Create your account" sólido azul fixed bottom + terms tiny.

- [pattern] **headline interactivo (madlib)** + **opciones grandes como botones tile**
- [keep] **el patrón madlib** funciona bien para definir el tipo de campo: "Mi campo es de **cría bovina** y trabajamos con **bastón electrónico**". Muy explícito y rápido.
- [skip] paleta azul/lila — adaptable, no copiar literal
- [mobbin] https://mobbin.com/screens/79d9c3cf-64d6-4493-8198-a52828adc368

---

## lightyear-signup-validation.png · Lightyear ⭐

**Validation rojo inline bajo input** — pattern directo para R1.1 spec 01 (signup email+password).

Headline display bold negro `Get started in minutes` 2-líneas. Input email pre-fill "john.smith@me.com". Input password con asteriscos + **toggle visibility 👁️ rojo** (estado error) + **borde rojo** + label cambia a rojo. Error message rojo bajo el input "Password must contain at least one number." + "Forgot password?" linkstyle azul. CTA "Continue" sólido azul fixed bottom + terms.

- [pattern] **estado error visual completo**: borde + label + icono + mensaje en rojo coherentes
- [keep] **adoptable directo para R1.1** — validation inline en password (8+ chars, mayúsculas, número, símbolo)
- [adapt] rojo → semantic.error Campo Profundo (#A02020)
- [mobbin] https://mobbin.com/screens/68e17e82-6956-4681-8391-1b4f72bb0617

---

## monarch-welcome-preview-value.png · Monarch ⭐

**Welcome con preview del valor** antes de pedir signup.

Logo Monarch arriba + "Sign in" link top-right azul. **Card flotante grande con preview de UI real**: `$1.92M net worth ↑$5,000` con sparkline verde + card "Spending This month vs last month" con line chart naranja/grey + leyenda + valores. Headline `See all your money in one place` + body explicativo. Dot indicator de carousel (5 dots). CTA outline blanco "Continue with Apple" (Apple logo) + outline blanco "Continue with Google" (G logo). Separador "OR". CTA **gradient naranja-rojo grande** "Sign up with email".

- [pattern] **preview del producto en card antes del signup** — muestra qué vas a recibir
- [pattern] sociales primero (outline) + email como acción principal (gradient)
- [keep] **idea de preview**: en welcome de RAFAQ mostrar mini-card con "Vacas activas 127", "Última sesión hace 3 días" etc — promete el valor antes de pedir signup
- [mobbin] https://mobbin.com/screens/c3f8a8a3-3850-4fbd-a4ca-e673fe4de40b
