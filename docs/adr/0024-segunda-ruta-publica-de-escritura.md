# 0024 — La segunda ruta pública de escritura: el comprador responde a la propuesta sin sesión

**Aceptada** · 30 de agosto de 2026 · F-019 — el humano firmó
`.agent/specs/F-019/plan.md`

## Contexto

[ADR 0016](0016-escritura-publica-sin-sesion.md) decidió que existe **una** ruta
pública de escritura, `POST /api/orders`, y lo escribió sin ambigüedad:

> «Existe **una** ruta pública de escritura, `POST /api/orders`, sin
> autenticación […] No hay ninguna más y añadir otra es una decisión de este
> mismo peso.»

[ADR 0023](0023-cuenta-del-comprador.md) ya se midió contra esa frase y la
respetó: las cuatro rutas de `/api/account/*` escriben `Customer`, no pedidos, y
la ADR lo dice en voz alta («sigue habiendo una sola ruta pública que escribe
pedidos»).

F-019 no puede decir eso. Su comportamiento central —E5 y E6 de
`.agent/specs/F-019/spec.md`— es que **el comprador aprueba o rechaza una
modificación desde la página de su pedido**, y eso escribe en `Order` y en
`OrderItem`. El comprador es un invitado: F-012 le da cuenta opcional, pero el
pedido pudo hacerse sin ella y la única credencial que tiene en la mano es el
`code` de diez caracteres que lleva su URL (R22 de la spec, y la § «`Order.code`
es una credencial» de la 0016).

Esta es, entonces, la **segunda** ruta pública de escritura, y por la frase de
arriba merece una decisión del mismo peso, no un comentario en un handler. El
humano la tomó el 2026-08-30 al responder I7: «segunda ruta pública, con ADR
nueva» — no una enmienda de la 0016, sino un documento que enumere sus defensas
una por una como aquella enumeró las seis del checkout.

## Decisión

Existe una **segunda** ruta pública de escritura:

```
POST /[slug]/pedido/[code]/respuesta
body: decision=aprobar | decision=rechazar   (application/x-www-form-urlencoded)
```

Sin autenticación y sin sesión. La credencial es el `code` que ya está en la URL
de la página, exactamente la misma que protege la lectura de esa página desde
F-010. **No hay ninguna tercera**, y añadir otra sigue siendo una decisión de
este mismo peso.

Es un route handler y no una Server Action, y el cuerpo es un formulario y no
JSON, por una razón de producto que la spec fija en R16: **responder no puede
exigir JavaScript**. Un `<form method="post">` con dos botones `submit`
funciona en un navegador con el JavaScript desactivado, en uno viejo y en uno
que todavía no ha hidratado. El detalle de la forma —la negociación por
`Accept`, el patrón POST/Redirect/GET— está en
`.agent/specs/F-019/architecture.md` § «La respuesta del comprador»; aquí solo
importa que la ruta existe y por qué es aceptable.

## Por qué es aceptable — el alcance de lo que esa ruta puede tocar

La 0016 defendió su ruta midiendo **qué puede corromper el peor abuso**. La
respuesta aquí es más estrecha todavía, y de una forma que conviene decir
completa:

**Esta ruta no acepta ni un solo dato del comprador.** El cuerpo entero es un
enum de dos valores. Los importes que se escriben —`subtotal`,
`discountTotal`, `deliveryFee`, `total`— y las líneas que sustituyen a las
vigentes son **los que la tienda propuso** por `POST /api/internal/orders/proposal`,
ya validados y ya persistidos en la fila; la escritura los copia de una columna
de la misma fila a otra, dentro de una sola sentencia SQL. El motivo de
cancelación de un rechazo es una **constante del servidor**
(`src/constants/orders.ts`), no un texto que el comprador escriba. No se guarda
su IP, ni su user-agent, ni una marca de qué navegador usó.

Dicho al revés: si alguien adivinara un `code` y aprobara una propuesta ajena,
lo que conseguiría es que un pedido pase a `CONFIRMED` con los importes que la
propia tienda pidió confirmar. No puede inventar un precio, no puede añadir una
línea, no puede cambiar el teléfono ni la dirección de nadie, y no puede leer
nada que la página —que ya es pública con ese mismo `code`— no le enseñara igual.

Y como en la 0016: la escritura está confinada a `Order` y `OrderItem`, dos
tablas que nadie más posee. No toca `StoreProduct`, ni precios, ni
disponibilidad, ni `rateSnapshot` (criterio 6 del feature: las tasas congeladas
son idénticas byte a byte antes y después de aprobar). El catálogo y la relación
con cuadrecaja quedan fuera de alcance por construcción.

## Las defensas, y qué ataja cada una

Enumeradas de una en una, con el mismo criterio que la 0016: el valor está en
que la siguiente persona sepa **qué puede quitar y qué no**. Las seis primeras
son las que el humano tenía delante al decidir; las tres últimas salieron del
análisis de la forma concreta de la ruta.

1. **El `code` no es adivinable.** Diez caracteres Crockford base32 con
   aleatoriedad criptográfica —50 bits, sin secuencia y sin derivarse del `id`
   (`src/lib/orderCode.ts`, § «`Order.code` es una credencial» de la 0016)—. Es
   la defensa principal contra la enumeración, y la única que de verdad la
   ataja: ningún límite de tasa sustituye a esto.
2. **La ruta no es un oráculo de existencia.** Un `code` inexistente, uno de
   **otra** tienda y un pedido sin propuesta viva se responden igual, con la
   misma consulta acotada por `(storeId, code)` que ya usa la página (R22 de la
   spec, E17 de F-010). Quien pruebe códigos al azar no aprende ni siquiera
   cuáles existen.
3. **`expiresAt > now()` va en la condición de escritura, no en un `if`
   anterior.** El plazo lo comprueba Postgres en el mismo `UPDATE` que cambia el
   estado (R8, E11). Una propuesta vencida no se puede aprobar aunque el cron de
   vencimiento vaya tarde, y aunque el atacante congele su reloj: el `now()` que
   manda es el del servidor de la base.
4. **El estado exigido, `AWAITING_CUSTOMER`, va en esa misma condición.** Un
   pedido que la tienda ya canceló, rechazó, marcó como entregado o que nunca
   tuvo propuesta afecta **0 filas** (E8). No hay ninguna ventana entre «leer el
   estado» y «escribir»: no se lee antes de escribir.
5. **Un solo uso.** La primera respuesta saca la fila de `AWAITING_CUSTOMER`, así
   que la segunda —la misma o la contraria— vuelve a afectar 0 filas y no escribe
   nada (E7). La idempotencia la impone la base con «filas afectadas = 0», nunca
   un «mira si ya respondió», que pierde la carrera; es la misma disciplina que
   la defensa 1 de la 0016 (`P2002` capturado, no consultado).
6. **Ningún dato nuevo del comprador.** El cuerpo es
   `decision=aprobar|rechazar` y nada más; cualquier otro campo se ignora. El
   `cancelReason` de un rechazo es una constante del servidor. No hay campo
   libre que sanear, ni dato personal nuevo que retener, ni superficie de
   inyección: no se persiste una sola cadena que venga de fuera.
7. **Tope de cuerpo y tipo de contenido acotado.** Solo
   `application/x-www-form-urlencoded`, con un tope duro de 1 KB. Es la mitad
   que sí aplica de la defensa 4 de la 0016: un formulario **no** puede exigir
   `application/json` sin romper R16 —esa es precisamente la concesión que se
   hace aquí—, así que el _preflight_ CORS deja de proteger esta ruta y hay que
   decirlo (§ Consecuencia).
8. **`Origin` cruzado se rechaza con `403`.** Cuando la cabecera viene y no es la
   del sitio, la petición no se atiende. Es barata (tres líneas) y no estorba a
   nadie, pero **no es lo que sostiene la ruta**: como esta ruta no monta sobre
   ninguna credencial ambiente —no hay cookie que el navegador adjunte sola—, un
   envío cruzado no le da al atacante nada que no consiguiera con `curl` si ya
   supiera el `code`. El CSRF clásico aquí no aplica; la cabecera solo frena el
   «pulsa aquí» de una página que ya conociera el código.
9. **Límite de tasa: regla de plataforma en el firewall de Vercel, no
   código.** PP1 — el humano decidió, al firmar `.agent/specs/F-019/plan.md`,
   que esta defensa **no** se implementa en el repositorio: no existe
   `src/lib/rateLimit.ts`, ni un mapa en memoria, ni ningún contador de
   ningún tipo para esta ruta. Es deliberadamente **la única de las nueve
   defensas que el sensor no puede comprobar** — no hay ningún test que se
   ponga rojo si la regla no existe, no viaja con el código a un entorno
   nuevo (un `git clone` no la trae) y nadie se entera si alguien la borra
   del panel. Queda como deuda **visible**, escrita aquí con esas palabras, en
   vez de como una defensa que este documento afirma y que el sistema en
   realidad no tiene — eso sería peor que no tenerla. **Tarea manual, no
   automatizable**: crear la regla en el panel de Vercel el día del
   despliegue (contador por `(storeId, code)` o por IP, a discreción de quien
   la configure). Plan B si la falta de verificabilidad molesta: el contador
   en memoria de la recomendación original (diez intentos por minuto y
   clave, mapa acotado a 5.000 claves), media hora de trabajo, sin migración
   ni dato personal — descartado por ahora porque, en memoria, un contador
   así **tampoco** sobrevive a un reinicio ni se comparte entre instancias
   serverless: no compraba mucho más que la regla de plataforma y sí sumaba
   código que mantener.

**Y una propiedad estructural, que no es una defensa pero acota el daño de un
abuso volumétrico:** la ruta hace **una** consulta cuando acierta y **dos**
cuando falla (el `UPDATE` condicional y, solo si afectó 0 filas, la lectura que
decide si la respuesta es `200` idempotente o `409`). Nunca crea filas. Un
diluvio contra esta ruta no deja basura en la base — a diferencia del checkout
de la 0016, que sí puede llenarse de pedidos falsos.

## Alternativas descartadas

- **Exigir cuenta para responder** (F-012 ya la ofrece): mata el caso normal. El
  pedido se hace de invitado por diseño, y el disparador más frecuente de una
  propuesta es el costo de envío, es decir, **casi todos** los pedidos de esa
  modalidad. Pedir cuenta al final del embudo es pedirla en el peor momento.
- **Un token de un solo uso enviado en el enlace `wa.me`**, distinto del `code`:
  no compra nada. El mismo mensaje que llevaría el token lleva ya la URL con el
  `code`, así que quien tenga uno tiene el otro; y añade una tabla, una purga y
  un cron más.
- **Firmar la respuesta (HMAC) con un secreto del servidor**: protege contra
  quien no tenga el enlace, que es exactamente contra quien ya protegen los 50
  bits del `code`. Coste real, beneficio nulo.
- **Server Action en vez de route handler**: la decisión está razonada en
  `architecture.md`; en lo que toca a esta ADR, una Server Action no se puede
  ejercitar con `curl` —su identificador cambia en cada build—, así que el
  criterio 2 del feature no tendría cómo verificarse desde el guion de humo.
- **Resolverlo por el POS** («que el encargado marque él si el cliente aceptó»):
  es lo que pasa hoy y es justo el problema que F-019 existe para cerrar; deja
  la decisión del comprador sin registro y sin reloj.

## Consecuencia — los dos límites que se aceptan a sabiendas

**1. Esta ruta no tiene el _preflight_ CORS que la 0016 sí tenía.** La defensa 4
de aquella ADR era `content-type: application/json` estricto, que fuerza el
_preflight_ y deja fuera el POST cruzado desde otro origen. Un formulario HTML
no puede enviar ese tipo de contenido sin JavaScript, y R16 dice que responder no
puede exigirlo. Se acepta porque no hay credencial ambiente que un tercero pueda
montar (defensa 8) y porque el peor resultado de un envío cruzado es aplicar la
decisión que la propia tienda propuso.

**2. El límite de tasa no frena a quien rote códigos**, igual que el de la 0016
no frena a quien rote teléfonos. La diferencia juega a favor: allí el abuso
dejaba filas basura que además viajaban al POS; aquí un intento fallido no
escribe nada en absoluto. Lo que un atacante con un `code` válido puede hacer es
**decidir por el comprador**, y eso es real: si un enlace de pedido se filtra
—una captura de pantalla reenviada, un teléfono compartido—, quien lo tenga
puede aprobar o rechazar. Es el mismo alcance que la 0016 ya aceptó al decidir
que el `code` es la única credencial de una página que muestra nombre, teléfono
y dirección: quien tiene el enlace **es** el comprador a todos los efectos del
sistema. **Es una decisión, no un olvido.**

## Lo que esto NO cambia de la ADR 0016

- Sus seis defensas siguen en pie tal cual para `POST /api/orders`. Ninguna se
  relaja, ninguna se reinterpreta.
- `Order.code` sigue siendo una credencial de lectura y ahora también de
  escritura; la página sigue con `noindex` y sin caché, y el `code` sigue sin ir
  a ningún log.
- Los importes que se persisten los sigue calculando el servidor: en el checkout,
  de su propia lectura del catálogo; aquí, de lo que la tienda propuso por la
  ruta interna autenticada. De un cuerpo público **nunca** sale un número que
  acabe en la base.

## Reabrir cuando

- Aparezca abuso real medido sobre esta ruta (entonces la defensa 9 deja de
  ser solo la regla de plataforma y se paga un contador persistido, con lo
  que eso implica: guardar la IP, migración, retención).
- Entren pagos en línea: aprobar dejaría de ser «confirmar unos importes» y
  pasaría a mover dinero, y entonces la credencial de 50 bits ya no basta.
- Alguien proponga una **tercera** ruta pública de escritura. Sigue siendo una
  decisión de este peso, y la frase de la 0016 se mantiene con el número
  actualizado: hay **dos**, y no hay ninguna más.
