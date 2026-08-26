# 0016 — Escritura pública sin sesión: el checkout de invitado y sus defensas

**Aceptada** · 26 de agosto de 2026

## Contexto

Hasta F-010, **nada sin credencial escribe en esta base**. ADR 0002 decide que
todas las llamadas las inicia el POS y que el runtime público no tiene
secretos de salida; ADR 0008 fija el bearer `SYNC_TOKEN` para
`/api/internal/*`; `src/app/api/` solo contiene rutas máquina-a-máquina y
crons. El modelo mental resultante, que está escrito en
`docs/sync-contract.md`, es «lo público solo lee». F-010 necesita que un
comprador anónimo cree un `Order` sin cuenta (criterio 4 del feature y R24: el
checkout no lee cookies de sesión). Eso rompe el modelo mental, y romperlo sin
dejar constancia es cómo alguien acaba «arreglándolo» dentro de un año
poniéndole un guard que hace el checkout imposible.

## Decisión

Existe **una** ruta pública de escritura, `POST /api/orders`, sin
autenticación, y una de lectura asociada, `POST /api/orders/quote`. No hay
ninguna más y añadir otra es una decisión de este mismo peso.

## Por qué es aceptable — el alcance de lo que esa ruta puede tocar

La escritura está confinada a `Order` y `OrderItem`, dos tablas que nadie más
posee: el sync no las lee ni las escribe, el catálogo no depende de ellas, y
el POS solo las consume por pull. No toca `StoreProduct`, ni precios, ni
disponibilidad, ni nada que el sync posea, así que ni el peor abuso puede
corromper el catálogo ni la relación con cuadrecaja. Todos los importes los
calcula el servidor a partir de su propia lectura (R6); del cuerpo del cliente
no se persiste un solo número.

**Las defensas, y qué ataja cada una.** Enumerarlas de una en una, porque el
valor de la ADR es que la siguiente persona sepa qué puede quitar y qué no:

1. `Order.idempotencyKey @unique` — el doble envío y el reintento de red crean
   **un** pedido (R26–R29). La unicidad la impone la base capturando el
   `P2002`, no un «mira si existe», que pierde la carrera.
2. Tope de 5 pedidos `PENDING` por tienda + teléfono normalizado en 10 minutos
   → 429 con `Retry-After` (R30). Comparte una sola consulta con la
   idempotencia, y la idempotencia gana: un reintento legítimo nunca recibe
   un 429 (R31).
3. Topes de tamaño: 50 líneas, 99 unidades por línea, 32 KB de cuerpo.
4. `content-type: application/json` estricto, que fuerza _preflight_ CORS y
   deja fuera el POST cruzado desde otro origen.
5. `robots.ts` ya prohíbe `/api/`.
6. La respuesta solo contiene el pedido que se acaba de crear. Nunca datos de
   otro.

**`Order.code` es una credencial, no un identificador bonito.**
`/[slug]/pedido/[code]` es pública y muestra nombre, teléfono y dirección de
una persona: el `code` es lo único que la protege. Por eso son 10 caracteres
Crockford base32 con aleatoriedad criptográfica (50 bits), sin secuencia y sin
derivarse del `id`, y por eso la página va con `noindex` y sin caché. Un
`code` correlativo convertiría la página en un directorio de teléfonos
recorrible.

## Alternativas descartadas

Exigir cuenta para pedir (mata el feature: el criterio es explícitamente «se
puede completar un pedido sin iniciar sesión»); un token de un solo uso
emitido por la página de checkout (no defiende de un script que primero pide
la página, y añade estado de servidor); firmar el carrito en el servidor (el
precio se revalida igual al confirmar, así que la firma no compra nada).

## Consecuencia — el límite que se acepta a sabiendas

El tope por teléfono **no frena a quien rote teléfonos**: un script puede
llenar `Order` de filas basura que además viajarán al POS por el pull. Se
acepta en F-010 porque el daño es basura en una tabla —no hay pago, ni reserva
de stock, ni pérdida de datos— y porque las tres alternativas cuestan más de
lo que evitan: el tope por IP en memoria no defiende en serverless (cada
instancia lleva su contador), el persistido obliga a guardar la IP —dato
personal que hoy no se guarda— con columna, migración y retención, y un
captcha mete JavaScript de terceros justo en la ruta que F-013 quiere
adelgazar, penalizando al comprador con conexión lenta que es el público
objetivo. **Es una decisión, no un olvido**, tomada por el humano el
2026-08-26 al responder AP2.

## Reabrir cuando

Aparezca abuso real medido, entren pagos en línea, o se resuelva el filtrado
por negocio de `pullOrders` (I7, ADR 0013 y la propuesta
`identidad-integracion`), que es lo que hoy hace que un token pueda leer los
pedidos —con sus datos personales— de un negocio ajeno.
