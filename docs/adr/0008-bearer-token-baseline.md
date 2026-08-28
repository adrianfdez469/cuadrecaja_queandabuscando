# 0008 — Bearer token como baseline; HMAC cuando el marketplace sea público

**Aceptada** · 2026-08-25

> **Modificada en parte por [ADR 0013](0013-identidad-de-integracion.md) (F-018)**: la invariante del 503 sigue viva, pero su sujeto ya no es `SYNC_TOKEN` —que dejó de existir— sino «ningún `Business` tiene `syncTokenHash`».

## Contexto

`/api/internal/*` acepta escrituras del catálogo. Hay que autenticarlo.

## Decisión

Bearer token largo y aleatorio, comparado en **tiempo constante**, en las
variables de entorno de los dos proyectos. TLS ya aporta confidencialidad e
integridad en tránsito, y el único llamante es un cron en un proyecto propio.

La verificación está aislada en `src/lib/syncAuth.ts`.

## Detalle de implementación

`timingSafeEqual` lanza si los buffers tienen distinta longitud, y el propio
throw filtraría si las longitudes coinciden. Por eso se hashea primero: la
comparación es siempre entre dos buffers de 32 bytes.

Sin ningún token configurado el servidor responde **503**, nunca 200. Un token
ausente jamás puede significar «deja pasar todo», y un 401 escondería un deploy
roto detrás de lo que parece un error del llamante. (F-018: el sujeto de esa
frase pasó de una variable de entorno única a «ningún `Business` tiene
`syncTokenHash`» — ver la nota de arriba.)

## Cuándo pasar a HMAC

Firma HMAC-SHA256 sobre `timestamp + "." + body`, rechazando una deriva mayor a
5 minutos. Gana integridad del cuerpo y una ventana de replay acotada si el
token aparece en un log. Disparadores:

- **Antes de abrir el marketplace al público.**
- Ante cualquier sospecha de filtración del token.

Como la verificación está aislada, el cambio no toca ninguna ruta.
