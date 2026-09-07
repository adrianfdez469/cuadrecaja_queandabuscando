# Solicitudes de cuadrecaja — nuestra respuesta

El equipo del POS anota lo que necesita de nuestra API en **su** repo,
en `.agents/solicitudes-qab.md`. Ese documento es suyo: no se edita desde aquí,
ni se copia. Este archivo es la otra mitad —**qué contestamos nosotros**— y es lo
único que un agente de aquí escribe.

La ruta a su repo es de cada máquina, así que no vive en ningún archivo
versionado. `bash .agent/solicitudes.sh` la busca sola (hermanos del repo, y del
checkout principal si trabajas en un worktree); si en tu máquina está en otro
sitio, fíjala una vez:

```bash
echo '/ruta/a/cuadrecaja' > .agent/cuadrecaja.path   # no se commitea
# o, para una sola sesión: export CUADRECAJA_REPO=/ruta/a/cuadrecaja
```

`bash .agent/init.sh` —y por tanto `sdd.sh start`— cruza las dos tablas en cada
sesión y avisa de tres cosas: una solicitud suya que aquí no tiene fila, un
documento que cambió desde la última vez que se miró en esta máquina, y una fila
de aquí que ellos ya quitaron de sus abiertas.

**Una fila aquí no es un compromiso.** Es la postura, incluida «no lo vamos a
hacer, y por esto». Lo que sí es compromiso va donde siempre: un feature de
`features.json`, que escribe el humano, y —si cambia lo que el POS envía o
recibe— una versión mayor de `docs/sync-contract.md` coordinada con ellos.

## Abiertas

Una fila por solicitud suya que siga en su tabla de abiertas.

| #     | Qué piden                                                              | Nuestra postura                                                                                                                                                                                                                       | Dónde vive                                                                                                                                |
| ----- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| S-007 | Envío por zonas: `ZONE_BASED`, tarifario por zona y `contact.zoneCode` | **Cerrada de diseño el 2026-09-06** entre los dos arneses, con el mapa dentro: lista como camino primario, mapa como desempate y geometría por cobertura declarada. `ZONE_TARIFF` con `rule` y **sin `DELETE`**. Sigue sin publicarse | **v13** · **F-041** y **F-042** (propuesta aceptada el 2026-09-06) · faltan tres cosas de diseño antes de publicarla · reabre la ADR 0028 |

**Publicada el 2026-09-06: `docs/sync-contract.md` está en la v12.1.** La v12
concede S-008 con la entidad `BUSINESS` y es **aditiva** —quien implementó la v11
y no la emita sigue siendo un lector correcto—, con un aviso que sí muerde:
`entity` todavía no acepta `BUSINESS`, así que emitirlo antes de que se avise
responde `400 INVALID_BATCH` y **se lleva el lote entero**. S-007 quedó cerrada
de diseño el mismo día y será la **v13**.

**S-008 la cerraron ellos el 2026-09-06 contra la v12.1**, así que su fila ya no
está en esta tabla — su entrada está abajo, en «Cerradas», y el razonamiento
sigue aquí porque S-007 se negoció con ella y sigue abierta.

La **v12.1**, del mismo día, aclara tres cosas del `payload` de `BUSINESS` que su
arné señaló al leer la v12, y una evitaba un fallo: el `updatedAt` de un
`BUSINESS` es **el instante en que cambió la lista** y no «la marca de la fila de
origen», porque no hay fila de origen —la lista es un conjunto—; y sobre todo
**no es el máximo** de las marcas de esas filas, porque retirar una moneda haría
bajar ese máximo y la retirada no se aplicaría nunca sin que nada fallara. Es el
fallo de la v11 ② entrando por la puerta de al lado, y lo vieron ellos.

Una fila se queda en esta tabla **mientras la solicitud siga en la de abiertas
de ellos**, que es la regla de la sección: su documento lo actualizan ellos, no
nosotros. Quitarla antes hace que `bash .agent/solicitudes.sh` la reporte como
«SIN TRIAR», porque el cruce busca una fila nuestra para cada solicitud suya que
siga abierta — una falsa alarma que cuesta más que la duplicación. S-001 sale de
esta tabla hoy, 2026-09-06, porque ellos la pasaron a sus resueltas el 2026-09-03;
lo que se acordó sigue entero abajo, en «Cerradas».

**S-007 y S-008 · Cerradas de diseño el 2026-09-06, entre los dos arneses.** El
humano de aquí pidió que las resolviéramos hablando directamente con el arnés
del repo web de cuadrecaja, orientando la decisión a la usabilidad de los
usuarios de cada lado, y que le propusiéramos el resultado. Lo que sigue es lo
acordado; lo que hay publicado es la **v12** (S-008), y S-007 es la **v13**, que
todavía no se publica porque le faltan tres cosas de diseño.

**La instrucción que desatascó la única discrepancia real.** Habíamos chocado en
una sola cosa: ellos querían que el comprador tocara su municipio **sobre un
mapa**, y aquí se objetó el peso del GeoJSON por el presupuesto de JavaScript de
F-013. El humano levantó esa objeción con estas palabras: si alguien puede abrir
una tienda online con imágenes desde Cuba, también puede mostrar un mapa para
elegir la localización. Dejó de ser un veto y pasó a ser un requisito de diseño
—el mapa entra, servido de forma que no castigue una conexión mala—, y eso
permitió que la conversación llegara a una solución mejor que las dos posturas de
partida.

**Cómo elige el comprador su zona, que era el punto en disputa.** Lista con
escritura predictiva como camino primario y **mapa como desempate**, confirmando
en texto antes de aceptar. Su argumento para el mapa es real y es de usabilidad:
en La Habana mucha gente no sabe si su calle es Playa o Marianao, y una lista de
168 nombres no resuelve esa duda. Y la geometría **se sirve por cobertura
declarada de la tienda**, no por país ni por provincia: si un comercio reparte en
cuatro municipios, se sirven cuatro polígonos. Esa granularidad es idea de ellos
y es mejor que la de aquí (que era el fichero por provincia): el grano es el
tarifario, que ya se conoce antes de pintar nada, así que el caso cubano común
descarga unos pocos KB y solo quien sirve media provincia paga lo que pesa media
provincia. El paso de provincia aparece únicamente cuando la cobertura cruza más
de una.

**Un dato de aquí que estaba mal y ellos corrigieron.** La precarga iba a salir
de `Store.province`; verificado en nuestro schema, es texto libre sin validar
—llegan «La Habana», «Habana», «habana»— y las coordenadas son nulables. Por eso
`STORE` gana un `zoneCode` propio en la v13, y las reglas que van con él: el
código es lo **computable**, `city`/`province` siguen siendo texto de
**presentación**, no se derivan uno del otro y contradecirse no es un error.

**Un dato de aquí que estaba peor, y lo corregimos nosotros.** Yo les había
descrito —y anoté arriba, en la fila de S-008— que la tienda pinta «el precio
canónico en su moneda». **No es lo que hace nuestro código**: todas las páginas
públicas pasan `displayCurrency = store.baseCurrencyCode` y **convierten todos
los precios a la moneda base del negocio** (`resolvePrice` solo se salta la
conversión cuando ya coinciden). De ahí salieron las dos cosas que de verdad
importan de S-008: que el importe en la base es **el primario y el que se
cobra**, y que la moneda que elige el comprador **se añade al lado y nunca
sustituye** —enseñarle el euro como número grande cuando se le cobra en CUP es
justo la confusión que la solicitud venía a evitar—. Y una consecuencia sobre la
v11 ①: como el precio mostrado de un producto que no está en la base ya dependía
de la tasa, la ventana de hasta una hora no envejecía un adorno decorativo,
**envejecía el precio**. La solicitud pedía lo correcto por una razón más débil
de la que tenía.

**El fallo que ellos cazaron en una regla que yo había adoptado.** Dije que una
moneda sin tasa vigente no se pinta, copiando `useMonedasAlternativas`. Esa
función hace dos cosas —descarta las sin tasa **y descarta la base**— porque su
trabajo son las _alternativas_, y `displayCurrencies` es la lista completa. Como
CUP es el ancla y por este contrato nunca tiene fila de tasa, aplicada literal
esa regla habría dejado a casi todos los negocios sin la moneda en la que paga el
comprador, y en silencio. La regla quedó en dos capas: **la lista no se poda por
falta de tasa** —es una declaración del comerciante, no una lista derivada— y lo
que se omite es **el importe concreto que no se puede calcular**, producto a
producto, que es lo que nuestro código ya hace (`resolveProductPrice` atrapa
`MoneyError` y devuelve `null` para que un producto sin tasa no tumbe el
catálogo).

**Dónde vive `displayCurrencies`: entidad `BUSINESS`, no repetido en `STORE`.**
Aquí ya nos habíamos retractado de la primera recomendación —N eventos que pueden
fallar por separado dejan dos sucursales de la misma marca con listas distintas
sin que nada esté roto— y ellos añadieron el argumento concreto que lo cierra:
desde la v9, un `openingHours` malformado **rechaza el evento `STORE` entero**,
así que habilitar el euro se perdería precisamente en la sucursal que tiene el
calendario mal puesto, con el único rastro en un `failed[]` de un evento que iba
de otra cosa.

**Y cómo se valida la lista, que es donde «que sea ruidoso» se paga mal.** Ellos
pidieron ruido por evento. Declararla estricta en el schema del sobre lo habría
convertido en un `400 INVALID_BATCH` que mata un lote de 500 eventos por un
código de moneda: más ruido, del tipo equivocado. Va por el camino que abrió
`openingHours` en la v9 —laxo en el schema a propósito, la forma validada en el
aplicador, `207 failed[]` de ese evento—, y con dos códigos propios,
`BUSINESS_DISPLAY_CURRENCIES_INVALID` y `BUSINESS_DELETE_NOT_SUPPORTED`.

**El tarifario de zonas, para la v13.** Tarifa por provincia con excepciones por
municipio —un comercio que reparte en 8 municipios no teclea 8 importes en un
móvil—, gana siempre lo más específico, y una fila de provincia declara servidas
sus zonas. La forma final es un **discriminante en la fila**, no dos banderas:
`rule: "FEE" | "NOT_SERVED" | "INHERIT"`, con `deliveryFee` obligatorio en el
primero y **prohibido** en los otros dos (precedente de `barcode`, v4). Con eso
desaparece el `served: false` que habíamos acordado a medias y con él la
posibilidad de un `served: true` sin importe que habría necesitado su propio
`refine`.

**Y `ZONE_TARIFF` no acepta `DELETE`, que es la mejor pieza del acuerdo.** De
aquí salió el agujero: la guarda anti-rancio corre antes de la rama del `DELETE`
—en `handleCategory` ya es así—, pero una vez aplicado el borrado no queda marca
con la que comparar y **un `UPDATE` rancio resucita la fila** con un importe que
el encargado ya había retirado. La primera propuesta de aquí fue dejar lápida;
la contrapropuesta de ellos es mejor y se adoptó: si la fila nunca desaparece de
verdad, el `DELETE` no expresa una eliminación, expresa el tercer estado por un
canal que además abre la ventana. Así que el tercer estado es un **valor**
(`INHERIT`) y el `DELETE` se rechaza con nombre propio — ruido, no el silencio
con el que `CURRENCY` y `EXCHANGE_RATE` ignoran `operation` desde la v10.1.

Corolario que casi se cuela por omisión, y que decidimos al revés de como venía
propuesto: **una fila de provincia con `INHERIT` es legal**. Ellos querían
rechazarla por «configuración que el encargado no puede explicar», pero al matar
el `DELETE`, `INHERIT` quedó como **el único mecanismo de retracción que
existe**, en todos los niveles: quien puso «toda La Habana a 400» y quiere volver
a no tener regla de provincia, conservando sus excepciones, no tiene otro camino.
Y no necesita regla nueva: «`INHERIT` cae al escalón de encima; si no hay
escalón, no servida» ya lo cubre en el techo. Lo único que hacía falta era
decirlo, porque sin decirlo un lado la leía como ausencia y el otro como no
servida — la marca exacta de lo que diverge en silencio entre dos
implementaciones.

**Cosas de las dos partes que van al contrato porque nadie las habría escrito
solo.** `contact.zoneName` además del `zoneCode`, instantánea del nombre tal como
lo vio el comprador, con el precedente de `rateSnapshot`: si los catálogos se
desincronizan una versión, su encargado y su mensajero leen «Playa» y no un
código DPA. Su disciplina al lado, que es la que se viola sola: **`zoneName` es
de lectura humana y nunca se compara, se parsea ni resuelve nada.** Un
`zoneCode` inválido en un `STORE` **rechaza el evento** con su propio código, y
la razón es de ellos: un calendario lo teclea un humano y equivocarse es normal,
pero un `zoneCode` sale de un selector sobre un catálogo compartido, así que solo
puede estar mal si los catálogos divergen — y esa es una alarma que no queremos
oír bajito. Las filas de tarifario **mueren con la sucursal**, por clave ajena de
este lado, no por eventos de zona: «sin `DELETE`» no significa que no mueran
nunca. Y un `ZONE_TARIFF` repetido de la misma `(storeId, zoneCode)` es un upsert
con guarda anti-rancio, con la misma exigencia que la v11 ② puso a las tasas: el
`updatedAt` tiene que ser el instante real de la edición del encargado.

**El vector de precedencia, y por qué en JSON.** La precedencia **la implementan
los dos lados** —su POS tiene que enseñarle al encargado lo que se va a cobrar—,
así que si las dos implementaciones divergen, diverge el importe que el
comerciante cree que cobra y el que cobra. La v13 publicará un vector de prueba
como el § ⑤ ya publica el suyo para el hash: **en JSON y no solo en una tabla**,
porque transcribirlo a mano es exactamente donde las dos implementaciones se
separan, y calculado ejecutando y no a mano. Nuestro test lo leerá **del propio
contrato**, no de una copia. Siete casos, los que ninguno de los dos acertaría
por intuición: `NOT_SERVED` de municipio bajo provincia con `FEE`; `INHERIT` de
municipio bajo provincia con `FEE`; municipio sin fila bajo provincia sin fila;
zona fuera de toda la cobertura; `FEE` de municipio bajo provincia `NOT_SERVED`
(«no sirvo Artemisa excepto Bauta»); y las dos del techo, provincia `INHERIT` con
municipio `FEE` y provincia `INHERIT` con municipio sin fila.

**Lo que se descartó por escrito, que es tan parte del acuerdo como lo que se
eligió.** La versión simple —zonas con **nombre libre** que declara cada tienda,
sin catálogo DPA, sin geometría y sin versión que sincronizar— era por donde iba
su F-013 original y se pidió expresamente que no muriera por omisión. Contestaron
en contra de lo cómodo: **el catálogo geográfico hoy tiene un solo consumidor**,
no hay ningún feature de búsqueda ni de informes por zona en su backlog, ni
abierto ni previsto, y el argumento «ya lo usaremos» no existe escrito en ninguna
parte. Aun así lo defienden, y aquí se comparte, por cuatro razones que no son
esa: un nombre libre **no se puede dibujar**, así que sin catálogo no hay mapa;
sería el mismo concepto en dos bases de datos de dos organizaciones, que es lo
que ya mordió dos veces; no es más simple, es el mismo problema **repartido entre
quinientos comerciantes** que teclean la lista que ve el comprador, y ahí nadie
lo puede arreglar; y `contact.zoneName` se queda sin sentido, porque con nombres
libres el código _es_ el nombre y la instantánea no congela nada. **El costo que
se asume con los ojos abiertos**, y va escrito para poder releerlo: el catálogo
necesita un responsable en cada lado y una versión que se compare,
indefinidamente, para dar de comer a un solo consumidor; si dentro de un año el
tarifario sigue siendo lo único que lo usa y mantener la versión sincronizada
cuesta más de lo que ahorra, la decisión correcta era la otra y esta conversación
es donde nos equivocamos.

**Dos cosas que salieron de aquí y no son de contrato, para que no se pierdan.**
Una: un negocio con una `baseCurrency` **bien formada y falsa** (`"XXX"`) no
tiene un producto sin equivalente, tiene **la tienda entera muda**, porque nada
se puede convertir a esa base; tratado como «N productos sin precio» es
invisible, y el sitio correcto es el que ya existe,
`Store.disabledReasonCode`/`disabledMessage`, que es como decimos «esta tienda no
puede vender y este es el motivo». Un código de forma inválida no puede entrar
por el cable —`baseCurrency` es `length(3)` en el schema de `STORE`—, así que el
residual es solo ese. Y dos: el agujero de la resurrección **también lo tenemos
en `CATEGORY`**, y es anterior a esta conversación; verificado que ahí es
cosmético —los productos no se re-atan, quedan con `localCategoryId` a `NULL`, y
el selector y la vista de categoría se derivan de los productos, así que una
categoría resucitada es una fila a la que no llega ninguna página—. Por eso se
cierra de raíz en `ZONE_TARIFF`, donde habría sido un importe cobrado, y no se
gasta una versión en cerrarlo en `CATEGORY`.

**Por qué la v12 y la v13 van separadas.** Porque el criterio que agrupó las
cuatro de la v11 no aplica: allí las cuatro estaban decididas y publicar tres
versiones seguidas solo repartía la misma lectura en tres. Aquí S-008 está
decidida y S-007 tiene diseño abierto, así que agruparlas sería retener la
decidida como rehén de la otra. Su número lo cierra: su feature del escaparate
multi-moneda se queda **sin ninguna dependencia** el día que se publique la v12,
mientras la rama de zonas arrastra cuatro features. Con el compromiso, de este
lado, de avisar si la v13 empieza a esperar por trámite y no por diseño — en ese
caso se agrupan.

<!-- Ejemplo del formato; no lo borres, que es lo que explica las columnas:
  | S-000 | Releer un pedido sin depender del cursor | Aceptada: `?status=` | F-033 · contrato v7.1 |
     ↑ su id     ↑ su título, tal cual        ↑ aceptada/rechazada/en espera + el porqué en una línea
                                                                              ↑ feature y/o versión del contrato
-->

## Cerradas

Lo que se decidió y por qué, aunque ellos ya la hayan quitado de su tabla. Esta
sección no se poda: es la memoria de la negociación entre los dos sistemas.

### S-008 · Qué monedas enseña el escaparate (`displayCurrencies`)

**Concedida.** Cerrada el 2026-09-06 con la **v12** de `docs/sync-contract.md`
—entidad `BUSINESS` nueva, no un campo repetido en `STORE`— y **afinada en la
v12.1** el mismo día, con las tres correcciones que su arné encontró al leerla.
Ellos la pasaron a sus resueltas ese día. Nos queda construirla: **F-038** (el
aplicador, con sus dos errores por evento y la guarda) y **F-039** (lo que el
comprador ve), más **F-040**, que no es de esta solicitud pero salió de ella.

El razonamiento completo de las dos —S-007 y S-008 se negociaron en la misma
conversación y no se pueden separar— está arriba, en el bloque de «Abiertas»,
mientras S-007 siga abierta para ellos. Cuando se cierre, el bloque entero baja
aquí.

### S-002 · El SQL espejo y el borrado en blando

**Aceptada, en la dirección que ellos proponían.** Cerrada el 2026-09-06 con la
**v11** de `docs/sync-contract.md`: el SQL del § ⑤ lleva
`AND p."deletedAt" IS NULL AND pt."deletedAt" IS NULL` y la razón queda escrita
como la quinta decisión de esa sección. Sin feature: no hay código nuestro que
cambiar. Desbloquea su F-008.

**El razonamiento de S-002, que es lo que se pierde si solo queda la fila.** Su
SQL espejo filtra por tienda, por `publicarEnTienda` y por precio y moneda no
nulos, y no puede filtrar más porque el schema de cuadrecaja no lo conocemos.
Pero ellos no borran productos: los marcan con `deletedAt`. Una fila así sigue
teniendo precio y moneda y sigue colgando de un producto publicable, **así que su
espejo la cuenta** — y del lado nuestro ese producto ya no está, porque lo
despublicamos cuando llegó su baja. El hash diverge y **no vuelve a converger
nunca**, y esa divergencia es exactamente la señal con la que F-008 concluye que
la sincronización se rompió: dispararía la recuperación y la alerta una y otra
vez sobre datos que están bien.

Por eso la postura no es solo «sí, filtradlo». Lo que nos toca es que **la regla
quede escrita en el documento vinculante**, que es su propio argumento y lo
comparto: si cada lado ajusta el espejo por su cuenta para que le cuadre, el hash
deja de detectar lo que existe para detectar. La nota va al § ⑤ y **no cambia lo
que el POS envía ni recibe**: por su letra sería una menor, y va en la v11 solo
porque la v11 se abre igualmente. No bloquea nada inmediato, pero tiene que estar
resuelto **antes de F-008** —el suyo—, que es donde el hash pasa a ser una
decisión operativa.

### S-004, S-005 y S-006 · Las tres reglas que cambió la v11

La v11 llevó estas tres más la nota de S-002, y dejó S-007 y S-008 escritas como
conversación abierta —sin campo, sin enum, sin ruta— en su propia sección. De
paso se retiró de su cabecera la advertencia de la v6, que seguía diciendo que el
lado receptor no estaba en pie tres versiones después de estarlo.

**Las tres aceptadas y publicadas en la v11 el 2026-09-06**, antes de estar
construidas de este lado —como se hizo con la v6— y cada una con su feature
esperando: **F-035** (la caché), **F-036** (la tasa vigente) y **F-037** (el
arrastre en el lote). Hasta que estén en pie siguen valiendo las reglas de la
v10.1, y la cabecera del contrato lo dice.

**Las cinco caben en una sola v11, y no por comodidad.** El propio contrato lo
dejó dicho al cerrar la v10.1: «si alguna de esas reglas no es la que cuadrecaja
necesita, la conversación es una v11 y no una corrección de redacción». S-004,
S-005 y S-006 son exactamente eso —respuestas a esa invitación, una por regla—,
y S-007 y S-008 ya venían marcadas como v11 por ellos; la nota de S-002 viaja en
la misma edición porque no tiene sentido publicarla sola. Publicar tres versiones
seguidas para que la cuarta las reagrupe sería peor para quien las implementa:
una sola edición, una sola lectura.

**S-004 · La invalidación ya está construida; falta enchufarla.** Sus dos
condiciones no hay que negociarlas porque son cómo funciona hoy
`src/features/sync/server/processBatch.ts`: los handlers no revalidan nada,
devuelven qué tocaron, el lote acumula slugs en un `Set` y **al final** dispara
una invalidación por sucursal. Un lote de 500 eventos sobre tres tiendas hace
seis llamadas, no mil — coalescido por lote, y por sucursal, nunca global. Las
tres o cuatro monedas de un clic de elTOQUE llegan en el mismo drenaje y salen
como **una** invalidación por tienda.

Lo que falta es una línea de fontanería: `handleExchangeRate` devuelve
`PROCESSED` a secas, sin `touchedStoreSlugs`. Tiene que resolver las sucursales
del negocio y devolverlas, que es lo mismo que ya hace `handleCategory` desde
F-026 y por el mismo motivo. El tag encaja sin inventar nada: la vitrina lee las
tasas por `getStoreRates`, cacheado con `storeTag(canonicalSlug)`, que es
exactamente el tag que `revalidateStores` expira.

Un matiz sobre `CURRENCY`, que no lo lleva: su tabla es **global a la
plataforma** y el evento no trae `businessId`, así que no hay negocio del que
derivar sucursales — salvo el del token, que es quien lo emite. Nos vale:
invalidamos las sucursales del emisor. Hoy ninguna página pública lee esa tabla
(`name`, `symbol`), así que la invalidación de `CURRENCY` es preventiva; la que
de verdad importa es la de `EXCHANGE_RATE`.

**S-005 · La guarda, sí; el rechazo, no.** El fallo que describen es real y está
en dos lecturas, no en una: `catalog/server/queries.ts::loadRates` y
`orders/server/quote.ts::loadFreshRates` toman las filas `orderBy: createdAt
desc` y se quedan con la primera de cada moneda. «Vigente» es literalmente la
última que llegó, así que su caso 5 —#101 reintentado después de #102— devuelve
440 a la vitrina **y también al checkout**, que lee fresco pero lee lo mismo. La
garantía de «un pedido nunca se cotiza con una tasa caducada» no cubre este caso:
la tasa no está caducada, está resucitada.

Preferimos la variante de orden por tres razones, y la tercera es suya: el
append-only queda intacto y no hay hueco en el histórico; no hace falta
vocabulario nuevo en la respuesta, así que su outbox no gasta ninguno de los 6
intentos de la ADR 0011 de ustedes en algo que no es un fallo; y es el criterio
que ya aplican `STORE`, `PRODUCT` y `CATEGORY` —extender uno escrito, no inventar
otro—. El empate (`updatedAt` idéntico) lo gana la última llegada: es lo que pasa
hoy y no cuesta nada dejarlo dicho.

De nuestro lado es una columna `sourceUpdatedAt` en `ExchangeRate` —la tabla solo
tiene `createdAt`—, su índice, y las dos lecturas ordenando por ella. **La trampa
que hay que escribir en el plan:** las filas anteriores a esa migración quedan
con `NULL`, y Postgres pone los `NULL` **primero** en un `ORDER BY ... DESC`, así
que una fila vieja sin marca ganaría para siempre y el arreglo produciría
exactamente el fallo que viene a arreglar. Se rellena `sourceUpdatedAt =
createdAt` en la misma migración; ordenar con `NULLS LAST` también funcionaría,
pero deja la trampa viva para el siguiente que escriba una consulta.

Y una nota sobre el cable, que es la mejor noticia de esta solicitud:
`updatedAt` **ya viaja** en el `payload` de `EXCHANGE_RATE` y **ya se valida**
(`exchangeRatePayloadSchema`). No hay campo nuevo que emitir ni nada que cambiar
de su lado. Lo que cambia es que ese dato deja de ser decorativo y pasa a
decidir, y por eso es una versión y no un arreglo silencioso.

Su mitigación —cancelar los `EXCHANGE_RATE` pendientes de la misma clave al
encolar uno nuevo— nos parece bien y no la sustituye esta guarda: son las dos
capas que ustedes mismos describen, no dos candidatas.

**S-006 · La cascada sí, pero una de las dos dependencias no existe aquí.**
`CURRENCY → PRODUCT` no es una dependencia de este lado:
`StoreProduct.syncedPriceCurrency` es un `String` plano, sin clave foránea y sin
consulta previa, así que un `PRODUCT` con una moneda que nadie declaró **no
falla, no crea nada y no queda a medias** — se guarda el código y ya. La fila
provisional `USD / USD` la crea **solo** `handleExchangeRate`, en su `upsert` de
`Currency`. Las dependencias reales son dos: `CATEGORY → PRODUCT` y
`CURRENCY → EXCHANGE_RATE`.

Y no son igual de graves, lo cual cambia dónde merece la pena el trabajo. La
moneda provisional **la repara el propio reintento**: cuando el `CURRENCY` que
falló vuelve a entrar, su `update` escribe `name` y `symbol` de verdad encima. La
categoría no la repara nadie —el producto se queda con `localCategoryId: NULL`
hasta el siguiente evento **de ese producto**—, y eso es lo que justifica
construir la cascada.

El precio de aceptarla, que el humano tiene que ver antes de firmar nada:
**mientras la dependencia siga fallando, el dependiente deja de existir en vez de
existir mal.** Hoy el producto se publica sin categoría; con la cascada no se
publica. Si el `CATEGORY` agota sus 6 intentos, el `PRODUCT` agota los suyos
detrás y el comerciante no ve el producto en absoluto. Lo aceptamos igual —un
producto visible con datos falsos es peor que un producto que llega una corrida
más tarde, y la cascada solo se dispara cuando la dependencia ya falló—, pero es
un intercambio, no una mejora gratis.

Un detalle a favor que su propio texto casi regala: la trampa del `updatedAt` que
describen **no aplica a la cascada**. Un evento que nunca llegamos a aplicar se
reintenta con su `updatedAt` original contra una fila cuya marca es más vieja, así
que entra sin más. Es su red de seguridad —reencolar a posteriori— la que
necesita marca nueva. Otro motivo para que la cascada viva de este lado.

De nuestro lado es contenido: el bucle de `processBatch` es secuencial y ya
conoce el resultado de cada evento anterior, así que basta con llevar las claves
que fallaron (`categoryId`, `code`) y saltar a `failed[]` los posteriores del
mismo lote que las referencian. Lo que sí necesita la v11 es **cómo se llama ese
fallo** en el § Vocabulario de errores: un evento correcto que vuelve en
`failed[]` por culpa de otro tiene que poder distinguirse de uno que falló por sí
mismo, o su outbox no puede contar nada útil.

### S-001 · Releer un pedido concreto sin depender del cursor

**Aceptada, las dos formas.** Cerrada el 2026-09-02 con **F-033** y la
**v8** de `docs/sync-contract.md`.

- `?status=<ESTADO>` — un solo estado por petición, no una lista. Es la pregunta
  que de verdad querían hacer en el ciclo normal, porque el POS no lleva la lista.
- `?ids=a,b,c` — relectura puntual de un conjunto ya conocido, **tope de 100**.
  El tope no es estético: 500 ids de siete cifras son ~3.500 caracteres de URL,
  por encima del límite seguro de los proxies.
- **Ninguna de las dos mueve `nextCursor`**, que vale `null` en toda respuesta
  lateral. Era su condición y es la regla que manda: es una lectura lateral, no
  un avance.
- Paginación de la lectura por estado con un parámetro **propio**, `after=<id>`,
  y su puntero `nextAfter`. No se reusó `since` justamente para que las dos
  paginaciones no se confundan.
- Mezclar `since` con `status` o con `ids` es **400**, igual que `status`+`ids`,
  `after` sin `status` y `limit`+`ids`: preferimos rechazar antes que elegir en
  silencio cuál gana.
- La lectura lateral **no** cuenta para «un solo pull en vuelo por negocio»:
  pueden lanzarla en paralelo con su pull. Y **no** marca `PENDING → PULLED`, así
  que releer no consume.
- Asimetría que conviene que sepan sin descubrirla probando: `after` e `ids`
  están acotados al techo de un `BIGINT` con signo y **`since` no**, porque el
  pull incremental quedó fuera del alcance de F-033.

El apaño que pedían evitar —`?since=<id-1>&limit=1` por pedido— ya no hace falta.

Ellos la retiraron de su tabla de abiertas el **2026-09-03**, y con eso desbloquearon
sus F-013 y F-017. Su fila salió de nuestras «Abiertas» el 2026-09-06, que es cuando
se leyó su documento actualizado por primera vez desde aquí.
