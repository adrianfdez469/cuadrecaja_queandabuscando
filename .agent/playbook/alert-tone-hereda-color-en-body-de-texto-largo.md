---
slug: alert-tone-hereda-color-en-body-de-texto-largo
sintoma: un banner o insignia con tono warning/danger/positive tiene contraste
  medido por debajo de 4.5:1 (texto normal) o incluso de 3:1 (texto corto y en
  negrita) en tema claro, pese a que el diseño da el patrón por bueno
firma: "contrasta ≥4.5:1.*obtuve.*false|contrasta ≥3:1.*obtuve.*false"
etapa: visual
visto_en: F-019
creado: 2026-08-30T19:50:00Z
promovido_a_agents: no
arreglo: medir el contraste de verdad (canvas 1x1, componiendo contra TODOS
  los fondos translúcidos de los ancestros, no solo el del propio elemento)
  ANTES de dar por buena una afirmación de "X:1" en un design.md. Si el texto
  va dentro de un `Alert`/`Badge` de tono compartido, envolver el cuerpo largo
  en un `<p className="text-fg">` NO BASTA por sí solo si lo que se mide es el
  contenedor (p.ej. `[role]`), porque ese contenedor sigue teniendo
  `text-{tono}` sobre SÍ MISMO — un hijo no puede cambiar el `color` computado
  de su padre. Añadir además `className="!text-fg"` (el `!` de Tailwind) en el
  punto de uso concreto, sin tocar el componente compartido: en el CSS de
  Tailwind v4 generado, `.text-fg` se declara ANTES que `.text-positive`/
  `.text-warning` (orden alfabético), así que sin `!important` un `className`
  normal en el mismo elemento pierde el empate de cascada contra el tono.
---

## Qué pasa de verdad

Dos causas distintas que producen el mismo síntoma medible, encontradas en el
mismo ciclo de F-019 al medir con Playwright en vez de leer el componente:

1. **La implementación no envolvió el texto como el diseño pedía.**
   `src/app/[slug]/pedido/[code]/page.tsx` pinta
   `<Alert tone={banner.tone}>{banner.text}</Alert>` con el texto como hijo
   directo. `Alert` (`src/components/ui/Alert.tsx`) pone `text-warning` /
   `text-danger` / `text-positive` en el **div contenedor**, así que todo el
   texto lo hereda. `.agent/specs/F-019/design.md` § «Tokens y tema» dice
   explícitamente: «los banners de § 4.5 llevan el texto largo en un
   `<p class="text-fg">` dentro del `Alert`» — precisamente para evitar esto.
   Esa envoltura nunca se escribió. Medido con un canvas 1×1 componiendo
   contra el fondo real: 5 de los 6 banners de resultado (`aprobada`,
   `conflicto`, `vencida`, `no-disponible`, `demasiados-intentos`) caen entre
   2.17:1 y 3.86:1 en tema claro — todos por debajo de 4.5:1, y dos por debajo
   incluso del 3:1 de texto grande.
2. **Un color de tono se usó donde el propio diseño admite un umbral menor
   (3:1, texto corto y en negrita), pero el valor real medido tampoco alcanza
   ESE umbral relajado.** El plazo apretado (`text-warning`, tramo 15-59 min)
   y la insignia `Badge tone="warning"` miden 2.17-2.53:1 en claro — muy por
   debajo incluso de 3:1. El diseño asumió que «3:1 es admisible por tamaño y
   peso» sin medir el valor real compuesto contra el fondo translúcido
   (`bg-warning/15` sobre `bg-surface`), que es más claro que el fondo sólido
   contra el que probablemente se estimó a ojo.

Ninguna de las dos la pesca un test que solo lea las clases CSS o el código:
Tailwind v4 resuelve `bg-warning/15` con `color-mix()`, y `getComputedStyle`
devuelve el color en `oklab()`/`lab()`, no en `rgb()` — hay que normalizarlo
pintando un canvas y solo entonces calcular la razón WCAG.

## Cómo se arregla

Causa 1 (implementación, vuelve a `sdd-implementer`): en `page.tsx`, cambiar
`<Alert tone={banner.tone}>{banner.text}</Alert>` a
`<Alert tone={banner.tone} className="!text-fg"><p className="text-fg">{banner.text}</p></Alert>`.
El `className="!text-fg"` en el propio `Alert` es imprescindible: verificado
con Playwright (`getComputedStyle` antes/después, en un `next dev` propio)
que sin él el `<div role="…">` que `Alert` renderiza sigue devolviendo el
color del tono al medir `getComputedStyle(el).color` sobre ESE elemento —
exactamente el que un guion visual con selector `#respuesta [role]` mide —,
sin importar qué color lleve el `<p>` hijo. Esto no toca `Alert.tsx` (sigue
sin token nuevo, tal como pide `design.md`): es un `className` puesto solo en
este punto de uso.

Causa 2 (el propio diseño, vuelve a `sdd-designer`): o se sube el peso/tamaño
del plazo apretado hasta que el 3:1 medido de verdad se cumpla, o se cambia el
texto a `text-fg` con el icono/palabra de advertencia llevando todo el peso
semántico (que es exactamente lo que el documento ya hace para el CUERPO largo
de un banner warning — aplicar el mismo criterio al plazo). El caso del
`Badge` es un componente **compartido y pre-existente** (ya usado en F-011,
`ProductTable`/`StorePublicSwitch` antes de F-019): no es de ámbito de un
feature que solo lo consume: cualquier arreglo ahí es una decisión de sistema
de diseño, no un parche local.

**Actualización — lo que de verdad se aplicó (F-019, ciclo 3).** Ninguna de
las dos opciones de arriba se ejecutó. El humano, con las tres opciones
delante (subir peso/tamaño del plazo, exceptuar el `Badge`, u oscurecer el
token), eligió una cuarta que esta ficha no había contemplado:
**oscurecer `--color-warning` en tema claro**, de
`oklch(0.72 0.15 75)` a `oklch(0.50 0.15 75)` en
`src/theme/tokens.css`, sabiendo que el token lo usan 22 archivos y que el
efecto se sale del ámbito de un solo feature. Medido con la misma técnica
(canvas 1×1, contra el fondo compuesto real, `next dev` propio): el plazo
pasó de 2.17-2.53:1 a **5.84-6.09:1** y la insignia `Badge tone="warning"` de
2.17:1 a **4.61-4.77:1**, ambos ≥4.5:1. Tema oscuro no se tocó: ya medía
9.26:1 (plazo) y 7.68:1 (insignia), por encima del umbral, así que bajarle la
luminosidad también habría sido un cambio sin motivo. Consecuencia: el arreglo
scoped por componente (subir peso/tamaño, o exceptuar `Badge` con una clase
`!` local) queda descartado en favor de una corrección de sistema de diseño;
si un futuro feature vuelve a medir por debajo de 4.5:1 en un tono
warning/positive/danger, **lo primero que hay que comprobar es si el token ya
se movió una vez** (este historial) antes de proponer otro parche local.

## Cuándo NO es esto

Si la medición se hizo contra el fondo **sólido** de la página
(`--color-bg`) en vez de contra el fondo **compuesto** real del elemento (un
`bg-warning/15` sobre una tarjeta `bg-surface` sobre `bg-bg`), el número sale
distinto y puede parecer que pasa cuando en el DOM real no pasa — por eso la
composición tiene que recorrer TODOS los ancestros con fondo, no solo
`document.body`.

## Cómo se evita

Cuando un design.md afirma una razón de contraste concreta ("X:1"), no darla
por buena: medirla en el propio guion visual con la técnica del canvas 1×1
contra el fondo compuesto real, en claro y en oscuro, antes de aprobar el
paso correspondiente. Es exactamente lo que F-010/visual.mjs ya hacía para un
banner suyo (V17) y lo que este ciclo generalizó a los seis banners y al
plazo de F-019 — la próxima vez que un design.md incluya un `Alert`/`Badge`
con texto largo en un tono no neutro, este es el primer sitio donde mirar.
