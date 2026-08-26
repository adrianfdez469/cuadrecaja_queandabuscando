---
propuesta: imagenes-sin-optimizacion-caliente
agente: sdd-spec
actualizado: 2026-08-26T02:02:32Z
estado: propuesta
---

> Origen: revisión de arquitectura del 2026-08-25.

## Problema

F-011 sube las imágenes a Supabase Storage y las sirve por `next/image`. Eso
optimiza **en caliente, por petición**, y en Vercel la optimización de imágenes es
un recurso medido: es el costo que aparece de golpe cuando llega el tráfico, no
mientras se desarrolla.

Además choca con el objetivo declarado del proyecto: el público tiene conexión
limitada y las páginas ya salen del CDN con ~3 KB de HTML. Si cada producto
arrastra una imagen pesada, el trabajo de F-004 y F-013 se pierde en el primer
`<img>`.

## Alcance

### Dentro

- Generar dos o tres tamaños **al subir**, no al servir.
- AVIF/WebP con respaldo, y presupuesto de peso por imagen.
- Servir directo desde el CDN de Supabase (loader propio o transformación de
  Supabase), sin pasar por el optimizador de Vercel.
- Extender `check:bundle` o añadir una comprobación equivalente para el peso de
  las imágenes de una página de catálogo.

### Fuera (explícito)

- Recorte o edición en el panel.
- Imágenes de `CanonicalProduct` para el marketplace. Mismo mecanismo, otro
  feature.

## Actores y precondiciones

El administrador sube desde el panel. Precondición: F-011 y el bucket público.

## Comportamiento esperado

- **E1** — Dada una imagen subida, se almacenan sus variantes de tamaño en el
  momento de la subida.
- **E2** — Dada una página de tienda, las imágenes se piden al CDN de Supabase y
  no al optimizador de Vercel.
- **E3** — Dado un navegador que acepta AVIF, se sirve AVIF; si no, el respaldo.
- **E4** — Dada una imagen que supera el presupuesto de peso, la subida avisa.
- **E5** — Dado un producto sin imagen, la página renderiza sin hueco roto.

## Reglas de negocio

- **R1** — Ninguna imagen se optimiza por petición.
- **R2** — La página de catálogo tiene un presupuesto de peso total de imágenes.
- **R3** — La `url` almacenada sigue siendo la unidad que viaja; las variantes se
  derivan de ella.
- **R4** — Borrar un producto no deja huérfanos en el bucket.

## Casos límite y errores

- Imagen corrupta o con un tipo MIME mentido.
- Imagen enorme (límite de subida).
- Fallo a mitad de generar variantes: no debe quedar una variante sí y otra no.
- Reemplazar la imagen de un producto: invalidar las variantes viejas y el ISR.
- Formatos que el navegador del comprador no soporta.

## Datos y contrato

No toca el contrato con cuadrecaja: `imageUrls` es propiedad del panel y el sync
no lo pisa ([ADR 0007]).

## Criterios de aceptación propuestos

Todos `[nuevo]`.

1. Subir una imagen deja más de un objeto en el bucket (original + variantes).
2. El HTML servido de `/[slug]` no contiene ninguna URL de `/_next/image`.
3. El peso total de imágenes de una página de catálogo está por debajo del
   presupuesto, medido sobre el servidor levantado.
4. Con `Accept: image/avif` se responde AVIF; sin él, el respaldo.
5. Reemplazar la imagen de un producto cambia lo que se ve tras la revalidación.
6. `node scripts/check-bundle-budget.mjs` sigue terminando en 0.
7. `bash .agent/verify.sh <id> --full` termina en 0.

## Incongruencias detectadas

- F-011 tiene el criterio «Subir una imagen la almacena en Supabase Storage y la
  sirve por `next/image`», ya escrito. Por la regla 3 **no se toca**: este feature
  lo sustituye explícitamente y hay que decirlo en sus `notes`, igual que hizo
  F-016 con F-003.
- `next.config.ts` habrá que revisarlo: `images.unoptimized` o un loader propio.

## Huecos y preguntas al humano

- **SP1** — ¿Transformación de imágenes de Supabase (de pago en algunos planes) o
  generarlas nosotros al subir? Recomendación: **generarlas al subir**. Es una vez
  por imagen, sin dependencia de plan, y el resultado es estático en el CDN.
- **SP2** — ¿Presupuesto de peso por página? Recomendación: fijarlo mirando lo que
  ya mide F-013, para que las dos cifras cuenten la misma historia.

## No decidido a propósito

Los tamaños exactos. Salen del diseño responsivo (`sdd-designer`), no de aquí.
