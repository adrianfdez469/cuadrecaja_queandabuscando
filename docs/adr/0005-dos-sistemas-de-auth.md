# 0005 — Dos sistemas de autenticación separados

**Aceptada** · 2026-08-25

## Contexto

Dos poblaciones muy distintas: clientes finales (que pueden comprar sin cuenta) y
administradores de negocio (que ya tienen credenciales en cuadrecaja).

## Decisión

Dos sistemas que no comparten sesión, cookie ni tabla.

**Clientes** → Supabase Auth (Google, Facebook, Apple, correo). Cookies `sb-`.
El pedido sin cuenta es el camino principal; la cuenta solo guarda contacto e
historial.

**Administradores** → SSO de un solo uso. cuadrecaja firma un JWT de ~60 s con
quién es y qué tiendas gestiona; `/admin/sso` lo canjea por una cookie propia
(`qab-admin-session`, httpOnly, 12 h) y consume el `jti` para que el enlace no se
pueda replayear desde el historial del navegador.

## Por qué no replicar las credenciales

La alternativa era sincronizar los usuarios con su hash bcrypt. Funciona sin
depender de cuadrecaja en runtime, pero duplica la superficie de riesgo: dos
bases con contraseñas en vez de una, y la de la tienda es la expuesta a internet.

Con SSO no se replica ninguna contraseña, y la lista de tiendas gestionables
llega firmada desde la fuente de verdad.

## Consecuencia

El acceso se **re-deriva del token en cada login** en lugar de acumularse, así
que revocar una tienda en el POS surte efecto en el siguiente inicio de sesión.

`lib/auth/adminSession.ts` y `lib/auth/customerSession.ts` son los únicos puntos
donde se lee una sesión.
