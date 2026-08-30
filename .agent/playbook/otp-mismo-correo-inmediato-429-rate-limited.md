---
slug: otp-mismo-correo-inmediato-429-rate-limited
sintoma: "VISUAL FAIL … el paso se rompió: page.waitForSelector: Timeout … waiting for locator('#signin-code')"
firma: error de consola.*status of 429|"error":"RATE_LIMITED"
etapa: visual
visto_en: F-012 (sdd-tester, escribiendo visual.mjs)
creado: 2026-08-30T02:27:52Z
promovido_a_agents: no
arreglo: >-
  Nunca pidas un segundo código (`POST /api/account/otp`, o el paso 1 de
  `/cuenta/entrar`) para el MISMO correo sin dejar pasar el enfriamiento real
  de Auth. Si un paso necesita "pedir código, volver atrás, pedir otro", usa
  un correo NUEVO para el segundo, o espera antes de reintentar con el mismo.
---

## Qué pasa de verdad

El emulador de Supabase Auth (F-028) impone su propio enfriamiento por
identidad para `/auth/v1/otp` — independiente de `GOTRUE_RATE_LIMIT_EMAIL_SENT`
(ese es un tope por HORA, `docker-compose.yml`, y estaba en `1000000/1h`: no
es el que dispara aquí). Un segundo `POST /api/account/otp` para el **mismo**
correo, pedido casi de inmediato (menos de ~5 s después del primero),
responde `429 {"error":"RATE_LIMITED"}`. `SignInCard.tsx` maneja ese 429
mostrando el aviso de "Pediste varios códigos seguidos…" y **se queda en el
paso "correo"**, sin pasar al paso "código" — así que cualquier guion que
espere `#signin-code` tras ese segundo envío cuelga hasta el timeout, con un
error de consola 429 de por medio (`vigilarConsola` lo reporta si no se
filtra).

Confirmado en vivo: `POST /api/account/otp` con el mismo correo dos veces
seguidas (sin esperar nada) → `200` y luego `429`; con 5 s de por medio entre
ambas → `200` las dos veces.

## Cómo se arregla

En un guion de Playwright/Node que ejercite el flujo de acceso por correo
más de una vez seguida (p. ej. "pide un código, vuelve a 'Cambiar el
correo', pide otro" o dos escenarios consecutivos que reutilizan la misma
dirección): usa un correo **distinto** para cada envío nuevo, o inserta una
espera real de varios segundos antes de reenviar al mismo. No hace falta
esperar los 30 s completos del enfriamiento DE LA INTERFAZ
(`OTP_RESEND_COOLDOWN_SECONDS`) — ese es un número de diseño de F-012, no el
enfriamiento real de Auth, y ambos no tienen por qué coincidir (de hecho el
guion de F-012 solo lo confirmó empírico, no lo dedujo de ninguna constante).

## Cuándo NO es esto

Si el 429 aparece tras **muchos** envíos acumulados en poco tiempo (no un
segundo envío inmediato para un correo puntual), es el tope por hora
(`GOTRUE_RATE_LIMIT_EMAIL_SENT`) el que se agotó — revisa cuántas corridas de
smoke/visual usaron OTP real en esta sesión de Docker, no el enfriamiento por
identidad.

## Cómo se evita

Cualquier guion nuevo que pida un código dos veces para el mismo correo
dentro de un mismo escenario debe, o usar un correo con sufijo distinto para
cada envío (mismo patrón que ya usan `place-order.mjs`/`smoke.sh` con
teléfonos aleatorios para no chocar con `ORDER_RATE_LIMIT_MAX_PENDING`), o
medir antes cuánto enfriamiento real exige el emulador en ese entorno en vez
de asumir que 0 s o los 30 s de diseño de la interfaz son seguros.
