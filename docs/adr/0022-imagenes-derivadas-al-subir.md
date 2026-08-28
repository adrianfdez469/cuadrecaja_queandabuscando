# 0022 — Imágenes derivadas al subir, servidas del CDN

**Aceptada** · 28 de agosto de 2026 · F-023

> El humano firmó `.agent/specs/F-023/plan.md` («Apruebo el plan»,
> 2026-08-28T17:49:34Z) y los 15 pasos quedaron implementados y verificados
> (`bash .agent/verify.sh F-023 --full` y `--smoke`, ambos en `0`). Las tres
> decisiones estructurales de más abajo se implementaron tal cual estaban
> escritas aquí; el detalle de la implementación real está en
> `.agent/specs/F-023/impl.md`.

## Contexto

Desde F-011 toda imagen de producto se sirve por `next/image`: el navegador pide
`/_next/image?url=…&w=…&q=…` y el servidor la optimiza **en cada petición**. Eso
tiene dos costos que solo aparecen cuando llega el tráfico:

1. En Vercel la optimización de imágenes es un recurso **medido**. El gasto
   crece con las visitas, no con el catálogo.
2. Choca con lo que este producto consiguió en F-004 y F-013: las páginas de
   tienda salen del CDN con del orden de 3 KB de HTML, y ese trabajo se pierde
   entero en el primer `<img>` si cada producto arrastra una imagen sin
   comprimir. El público objetivo declarado es el comprador con conexión
   limitada, que es justo quien paga esa diferencia.

La alternativa obvia —la transformación de imágenes de Supabase— quedó
descartada por el humano el 2026-08-28 (SP1 de `.agent/specs/F-023/spec.md`): es
de pago en algunos planes y seguiría siendo trabajo por petición.

En paralelo, F-011 dejó dicho en su R22 que «quitar una URL de `imageUrls` no
borra el objeto del bucket […] la recolección de huérfanos es otro feature». Ese
otro feature es este.

## Decisión

**(a) No hay optimización de imágenes en caliente en este producto.**
`next.config.ts` fija `images: { unoptimized: true }`, y con él se van
`formats`, `remotePatterns` y `dangerouslyAllowLocalIP` —que solo existían para
alimentar al optimizador—. Reintroducir un `<Image>` por descuido ya no puede
volver a encenderlo. Una guarda de pruebas complementa el config: ningún módulo
bajo `src/` importa `next/image`.

El trabajo se mueve al **momento de subir**: la app decodifica el archivo una
vez con `sharp`, emite un juego fijo de variantes (dos anchos × dos formatos,
AVIF y WebP) y las sube al mismo bucket. La tienda las sirve directo del CDN de
Supabase con un `<picture>`, sin JavaScript de cliente y sin intermediario.

**(b) Una imagen es un directorio, y sus variantes se derivan de la ruta.**
La ruta de objeto pasa de `stores/<storeId>/products/<storeProductId>/<uuid>.<ext>`
a un directorio por imagen:

```
stores/<storeId>/products/<storeProductId>/<uuid>/original.<ext>
stores/<storeId>/products/<storeProductId>/<uuid>/w<ancho>.<formato>
```

`StoreProduct.imageUrls` **no cambia**: sigue guardando una sola URL por imagen,
la del original. Todo lo demás lo calcula una función pura que no consulta ni la
base ni el bucket —sustitución del último segmento de una cadena—. Eso tiene tres
consecuencias buscadas:

- El esquema de Prisma, el contrato con cuadrecaja y la validación de prefijo de
  bucket del panel se quedan exactamente como estaban. Cero migraciones.
- Una URL heredada de F-011 se distingue de una de F-023 **mirando solo su
  ruta** (una termina en `<uuid>.<ext>`, la otra en `<uuid>/original.<ext>`), así
  que las filas viejas siguen funcionando como un `<img>` simple y **no hace
  falta backfill**.
- Todo lo de una imagen cuelga de un prefijo listable, y todo lo de un producto
  de otro: es lo que hace posible (c).

**(c) El bucket es un derivado de `imageUrls`.** Cuando una URL deja de estar
referenciada por una fila viva, su original y sus variantes se borran. Esto
**sustituye la R22 de F-011** y define dónde ocurre:

- El admin quitando una imagen en el panel → el borrado va **después** de la
  escritura y su revalidación, dentro del mismo camino que ya pasa por
  `commit()`.
- El sync con `operation: DELETE` → además del borrado suave, se vacía
  `imageUrls` y se borra el prefijo entero del producto. Esa purga viaja en el
  `HandlerOutcome` y la drena el procesador del lote **después** de revalidar,
  no el handler.
- **`publishToStore: false` NO borra nada.** Despublicar es un interruptor
  reversible y cotidiano; borrar las fotos del admin cada vez que un tendero
  desmarca «publicar en la tienda» destruiría trabajo que nadie pidió destruir.

Vaciar `imageUrls` en el `DELETE` terminal es la **única excepción** a
[ADR 0007](0007-price-override.md) y a
[ADR 0017](0017-frontera-de-escritura-del-panel.md), que reparten esa columna al
panel y prohíben al sync tocarla. Se acepta acotada a ese camino y por un motivo
que no es de propiedad sino de existencia: su contenido dejó de existir.

Todo borrado es **idempotente** y **best-effort**: borrar lo ya borrado es éxito,
y un fallo de Storage se registra en el log sin tumbar la escritura en Postgres
ni marcar el evento de sync como fallido. Reportar `failed` un evento cuyo efecto
en Postgres sí ocurrió haría que el POS lo reintentara sin necesidad; reportarlo
`ok` cuando la fila no se escribió es el error contrario, que `AGENTS.md`
prohíbe. Aquí la fila **sí** se escribe.

## Consecuencias

- **Una dependencia de producción nueva y nativa**, `sharp`. Es la primera de
  este repo. No afecta al presupuesto de JavaScript de cliente (mide otra cosa),
  sí al tamaño del despliegue (~30 MB) y al tiempo de la función de subida
  (1,5-2,5 s en el peor caso admitido). Vive aislada en un único módulo, y una
  guarda de pruebas impide que se importe desde otro sitio.
- **El bucket crece ~1,4×** y pasa de 1 a 5 objetos por imagen. El original
  domina el peso porque se conserva sin recomprimir: es la fuente de la que se
  regeneran las variantes si el juego cambia. Si un día ese coste muerde, la
  salida es moverlos a un prefijo frío o dejar de conservarlos, y eso reabre esta
  ADR.
- **El HTML de una página de catálogo se hace más pequeño**, no más grande: dos
  `<source>` con dos candidatos pesan menos que el `srcset` completo de la escala
  de `deviceSizes` que `<Image fill>` emitía.
- **El cuarto `acceptance_criteria` de F-011** («… y la sirve por `next/image`»)
  queda sustituido, no editado — la regla 3 de `.agent/features.json` protege el
  criterio, y el patrón de sustituirlo desde otro feature es el mismo que F-016
  usó con F-003.
- **Aparece un presupuesto de peso de imágenes** (300 KB por página de catálogo)
  con su propia comprobación ejecutable, separada del presupuesto de JavaScript
  de F-013: son dos números que miden cosas distintas y no se derivan uno del
  otro.
- **Las imágenes que F-011 ya dejó huérfanas en el bucket siguen ahí.** La
  recolección retroactiva queda fuera de alcance; las filas viejas funcionan sin
  ella.

## Reabrir cuando

- El juego de variantes deje de ser derivable de la ruta —por ejemplo, si hiciera
  falta un tercer ancho por tipo de pantalla, o recorte con relación de aspecto
  variable—: ahí `imageUrls` tendría que guardar más que una cadena y esta ADR
  cae entera.
- Guardar el original deje de compensar (coste de almacenamiento por encima del
  coste de re-subida).
- Aparezca una segunda columna del panel que el sync necesite vaciar: dos
  excepciones a ADR 0007 ya no son una excepción, son una regla que hay que
  escribir.
