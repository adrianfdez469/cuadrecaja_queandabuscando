---
propuesta: contraste-de-tokens-de-tema
agente: orquestador
actualizado: 2026-08-30T19:00:00Z
estado: propuesta
---

> Origen: F-019. Su `visual.mjs` fue el primero del repo que **mide** contraste
> en vez de darlo por bueno, y a la primera encontró un token compartido que
> llevaba tiempo mal.

## Problema

`npm run check:theme` comprueba que los tokens de tema **resuelvan a `var()`**.
No comprueba que se **puedan leer**. Son dos cosas distintas, y hoy solo se
verifica la primera.

El caso que lo destapó: `--color-warning` medía en torno a **2,2:1** sobre fondo
claro, contra el 4,5:1 que exige texto normal. Lo usan 22 archivos —panel de
admin, carrito, tienda, página del pedido— y nadie lo había medido nunca. Se
corrigió dentro de F-019 con autorización expresa del humano, porque el arreglo
tocaba un token compartido.

Lo que no se sabe es **cuántos más están así**. `--color-warning` no tenía nada
de especial: simplemente fue el primero que un guion visual llegó a medir.

## Alcance

### Dentro

- Medir el contraste de todos los tokens de color de `src/theme/tokens.css`
  contra los fondos reales sobre los que se pintan, en tema **claro y oscuro**.
- Distinguir el umbral que toca a cada uso: 4,5:1 para texto normal, 3:1 para
  texto grande y para componentes de interfaz. Un token usado como fondo no se
  mide igual que uno usado como texto.
- Dejar el resultado como algo que **se ejecuta**, no como un informe: lo natural
  es ampliar `scripts/check-theme-tokens.mjs`, que ya recorre los tokens.

### Fuera (explícito)

- Rediseñar la paleta. Esto mide y corrige lo que no llega; no cambia la
  identidad visual del producto.
- El contraste de imágenes, de contenido subido por las tiendas, o de cualquier
  color que no salga de un token.

## Actores y precondiciones

Nadie lo dispara: es una comprobación del CI. Precondición: que el guion sepa
sobre qué fondo se pinta cada token, que es la parte que de verdad cuesta —
medir un color contra el fondo equivocado da un número que tranquiliza y no
significa nada.

## Comportamiento esperado

- **E1** — Dado un token que no llega a su umbral, cuando corre el guion,
  entonces falla nombrando el token, el fondo, el valor medido y el exigido.
- **E2** — Dado el tema oscuro, entonces se mide igual que el claro. El fallo de
  F-019 estaba en claro, pero nada garantiza que el oscuro esté mejor.
- **E3** — Dado un token que solo se usa como fondo, entonces se mide contra lo
  que se pinta encima, no como si fuera texto.

## Reglas de negocio

- **R1** — Se mide componiendo colores de verdad (canvas 1×1), no leyendo el
  valor declarado. Un color translúcido sobre un fondo translúcido no se puede
  calcular a ojo: es la lección de la ficha
  `.agent/playbook/alert-tone-hereda-color-en-body-de-texto-largo.md`.
- **R2** — Un token que no llega **se corrige**, no se le baja el umbral.

## Criterios de aceptación propuestos

Los escribe el humano si esto entra al backlog. Como punto de partida:

1. `npm run check:theme` falla si algún token de texto queda por debajo de 4,5:1
   en claro o en oscuro, nombrando cuál y con qué medida.
2. Con la paleta actual ya corregida, el guion termina en 0.

## Huecos y preguntas al humano

- ¿Cuántos tokens hay hoy por debajo? Nadie lo sabe: hasta que se mida, esta
  propuesta no puede decir si es media hora de trabajo o un rediseño.
- ¿El guion debe fallar el CI desde el primer día, o avisar durante un tiempo?
  Si resulta que la mitad de la paleta no llega, fallar de golpe bloquea todo lo
  demás.
