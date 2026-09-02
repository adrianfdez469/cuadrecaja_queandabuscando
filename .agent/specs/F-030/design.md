---
feature: F-030
agente: sdd-designer
actualizado: 1970-01-01T00:00:00Z
estado: borrador
---

## Flujo de usuario

Pantallas y transiciones, de la entrada al objetivo cumplido. Dónde se puede
volver atrás y qué se pierde al hacerlo.

## Inventario de pantallas y estados

Por pantalla: normal, vacío, cargando, error, sin permiso, resultado parcial.
Un estado sin diseñar es un bug que aparece en producción.

## Estructura por breakpoint

| Zona | 360px | 768px | 1280px |
| ---- | ----- | ----- | ------ |

Móvil primero. Qué se apila, qué se oculta, qué cambia de jerarquía.

## Componentes de UI

Cuáles de `src/components/ui/` se reutilizan, cuáles hay que crear y por qué no
alcanza con los existentes.

## Tokens y tema

Todo color, espaciado y tipografía sale de `src/theme/tokens.css`. Nada
hardcodeado — `scripts/check-theme-tokens.mjs` lo verifica. Cómo responde al
branding por tienda.

## Accesibilidad

Orden de foco, contraste, roles y `aria-*`, área de toque mínima, textos
alternativos, comportamiento con teclado.

## Coste de cliente

Qué necesita `"use client"` y por qué. **Nada que renderice catálogo lo lleva**:
la tienda tiene que leerse sin esperar el JavaScript.

## Textos

Microcopy exacto, en español, incluidos los mensajes de error.

## Verificación visual

Qué mirar, en qué viewport y con qué datos para dar el diseño por correcto.

## Preguntas al humano

`DP1..DPn`, con opciones y recomendación.
