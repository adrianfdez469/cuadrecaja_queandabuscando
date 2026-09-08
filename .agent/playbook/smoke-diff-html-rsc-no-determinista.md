---
slug: smoke-diff-html-rsc-no-determinista
sintoma: SMOKE FAIL … antes y después … son idénticas — esperaba <!DOCTYPE html>…
firma: SMOKE FAIL.*antes y despu.s
etapa: smoke
visto_en: F-038
creado: 2026-09-08T01:51:02Z
promovido_a_agents: no
arreglo: normaliza quitando TODOS los `<script>…</script>` de las dos mitades antes de comparar, nunca solo el token que viste fallar
---

## Qué pasa de verdad

Un guion de humo que hace `curl -s` de una página del catálogo dos veces
seguidas — sin tocar nada entre medio — y las diffea espera que salgan
idénticas. Bajo `next dev` (Turbopack + RSC streaming) no salen idénticas:
cada petición regenera el payload de React Server Components y Next asigna
los ids internos del stream (`self.__next_r="<token>"`, la numeración de los
chunks `$8`, `$9a`, …) en el orden en que las promesas del render resuelven,
que varía petición a petición. Nada de eso vive en el HTML que un `curl` sin
JavaScript le muestra a quien mira — vive dentro de los `<script>` que
hidratan el árbol — pero si el diff es byte a byte, revienta igual, y el
mensaje no dice «esto es ruido de RSC»: enseña dos páginas de HTML enteras
que parecen no tener nada que ver.

## Cómo se arregla

Antes de comparar, quita TODOS los `<script>…</script>` de las dos mitades
con la misma normalización (nunca solo el primer token que se vea diferir:
medido con `difflib` carácter a carácter en F-038, el primer intento de
normalizar solo `self.__next_r="..."` no bastó porque la numeración interna
del stream también se reordena más adelante en el documento):

```js
html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "");
```

Con esa normalización aplicada a los DOS lados, dos peticiones seguidas sin
tocar nada salen byte a byte idénticas (comprobado). Es además la
comparación correcta para lo que el criterio pregunta — «¿cambió lo que se
ve?» — porque este mismo repo exige que la tienda se lea sin esperar el
JavaScript (AGENTS.md § Prohibiciones): el contenido fuera de `<script>` es
exactamente lo que un lector sin JS recibe.

## Cuándo NO es esto

Si el diff aparece FUERA de cualquier `<script>` — en el marcado visible,
una clase, un texto, un precio — no es esto: es el feature pintando algo que
no debía, y hay que investigar el código, no la normalización.

## Cómo se evita

Antes de escribir un guion de humo que compara dos `curl` de la MISMA
página con una acción en medio, corre primero el control descrito en
architecture.md § AD7(3) (dos peticiones seguidas, sin tocar nada, diffeadas
entre sí) contra un `next dev` real, para descubrir esto ANTES de escribir
el escenario real — así el guion normaliza desde el principio en vez de
fallar en rojo la primera vez que alguien lo corre. F-035/F-036 nunca
tropezaron con esto porque sus guiones comparan un fragmento extraído
(`price_of`), no la página entera — evitar el diff completo también evita
la trampa, si el criterio lo permite.
