# 0008 — Bearer token como baseline; HMAC cuando el marketplace sea público

**Aceptada** · 2026-08-25

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

Sin `SYNC_TOKEN` configurado el servidor responde **503**, nunca 200. Un token
ausente jamás puede significar «deja pasar todo», y un 401 escondería un deploy
roto detrás de lo que parece un error del llamante.

## Cuándo pasar a HMAC

Firma HMAC-SHA256 sobre `timestamp + "." + body`, rechazando una deriva mayor a
5 minutos. Gana integridad del cuerpo y una ventana de replay acotada si el
token aparece en un log. Disparadores:

- **Antes de abrir el marketplace al público.**
- Ante cualquier sospecha de filtración del token.

Como la verificación está aislada, el cambio no toca ninguna ruta.
