---
propuesta: zonas-de-envio
agente: orquestador
actualizado: 2026-09-06T00:00:00Z
estado: aceptada
---

> **Aceptada por el humano el 2026-09-06** («la propuesta de v13 me parece
> bien»). Entró al backlog como **dos** features —resolviendo SP4—:
> **F-041**, el contrato y el lado que no ve nadie, y **F-042**, el checkout que
> ve el comprador. El corte es «lo que no ve nadie» contra «lo que ven el
> comprador y el POS de un pedido concreto».
>
> Este documento **se conserva** porque todavía no hay
> `.agent/specs/F-041/spec.md`:
> mientras no exista, es el único análisis escrito que hay y borrarlo destruye
> trabajo (`.agent/specs/propuestas/README.md`). Cuando esas specs existan, esta
> propuesta pasa a ser una copia desactualizada y se borra.
>
> **SP1, SP2, SP3 y SP5 están cerradas** (2026-09-06): las tres primeras
> diseñadas junto con el arné de cuadrecaja con permiso de los dos humanos
> —§ «El catálogo, cerrado» y § «El vector, cruzado»—, y SP5 por el humano.
> Queda **una** cosa: la **lista oficial de códigos DPA/ONEI**, que no se puede
> obtener desde esta máquina (§ «Lo verificado el 2026-09-06») y que bloquea
> generar el catálogo, y por tanto F-041.

## Problema

Los comercios cubanos cobran el envío **por municipio**, y hoy el contrato solo
permite una tarifa plana por sucursal o cotizar a mano pedido a pedido. Con
`FLAT_RATE` el comprador del municipio de al lado paga lo mismo que el del otro
extremo de la provincia; con `QUOTED_PER_ORDER` **confirma sin ver el costo del
envío** y el total le llega a medias, con un ciclo de propuesta y aprobación que
ni el comercio ni él necesitan cuando el comercio ya sabe su tarifario («Playa
300, Habana Vieja 250, Boyeros 500»).

Lo que falta para cerrarlo es que el precio del envío pueda depender de **dónde**
se entrega, y eso hoy no tiene forma de existir: `contact` tiene cuatro claves
—`name`, `phone`, `email`, `address`— y `address` es texto libre. **Ningún dato
de la dirección del comprador es computable.**

Es la **S-007** de `.agents/solicitudes-qab.md` (el documento de cuadrecaja) y su
diseño quedó **cerrado el 2026-09-06** entre los dos arneses, por encargo de los
dos humanos. La postura y el razonamiento completo están en
[`.agent/solicitudes.md`](../../solicitudes.md); esta propuesta es lo que habría
que construir **de este lado** si el humano la acepta. Bloquea cuatro features
de su backlog y ninguno de aquí.

## Alcance

### Dentro

- **v13 del contrato** (mayor): `ZONE_BASED`, la entidad `ZONE_TARIFF`,
  `STORE.zoneCode`, `contact.zoneCode` y `contact.zoneName`, y el vector de
  precedencia.
- **Catálogo geográfico** de este lado: provincias y municipios por código
  DPA/ONEI, sembrado desde OpenStreetMap (`admin_level` 4 y 6).
- **Resolución de la tarifa** por precedencia, como función pura con tests.
- **Selector de zona en el checkout**: lista con escritura predictiva como camino
  primario y **mapa como desempate**, con la geometría servida **por cobertura
  declarada de la tienda**.
- **Invalidación**: un `ZONE_TARIFF` expira las páginas cacheadas de esa
  sucursal, por la maquinaria de la v11 ①.

### Fuera (explícito)

- **PostGIS y la búsqueda por cercanía.** La ADR 0011 se reabre con «una consulta
  de tipo tiendas a menos de N km», y aquí las coordenadas **no** deciden el
  precio ni ordenan nada. `Store.latitude`/`longitude` siguen viajando y
  guardándose como hasta ahora.
- **Geocodificar direcciones o confiar en el GPS.** En Cuba el callejero es fino
  y no hay números de casa: un pin es una fuente de verdad falsa. La zona **la
  elige la persona**; el GPS, si acaso, sugiere.
- **Que los polígonos viajen por el sync.** Por el cable va el `code` y nada más.
- **La pantalla del tarifario del encargado**, que es de cuadrecaja. De este lado
  solo se consume.
- **Búsqueda o informes por zona.** No existen y nadie los ha pedido — ver «El
  costo asumido».

## Actores y precondiciones

- **El comprador**, en el checkout de una tienda con `deliveryFeeMode:
"ZONE_BASED"` y domicilio habilitado. Elige su zona antes de confirmar.
- **El encargado**, en cuadrecaja, que arma el tarifario y no toca nada de aquí.
- Precondición: los dos lados tienen el **mismo catálogo geográfico**, sembrado
  de la misma fuente, y saben que lo comparten (§ SP2).

## Comportamiento esperado

- **E1.** Dado un comprador en una tienda `ZONE_BASED`, cuando abre el checkout a
  domicilio, entonces ve **solo las zonas que esa tienda sirve**, nunca una zona
  que luego haya que cotizar o rechazar.
- **E2.** Dado que conoce su municipio, cuando escribe dos letras en el selector,
  entonces lo encuentra sin abrir ningún mapa y sin descargar geometría.
- **E3.** Dado que **no** sabe si su calle es de un municipio o del vecino,
  cuando abre el mapa, entonces toca su zona sobre él y **confirma en texto** el
  nombre del municipio antes de aceptar.
- **E4.** Dado que la tienda sirve cuatro municipios, cuando se abre el mapa,
  entonces se sirven **cuatro polígonos**, no una provincia ni un país.
- **E5.** Dado que la cobertura de la tienda cruza más de una provincia, cuando
  se abre el selector, entonces aparece un paso de provincia; si no la cruza,
  **ese paso no existe**.
- **E6.** Dado un pedido con zona elegida, cuando el POS lo pullea, entonces
  recibe `contact.zoneCode` y `contact.zoneName` —el nombre **tal como lo vio el
  comprador**— y el importe de envío ya resuelto.
- **E7.** Dado un `ZONE_TARIFF` que amplía la cobertura, cuando se aplica,
  entonces la tienda ofrece la zona nueva **en la primera visita posterior**, sin
  esperar el suelo de revalidación.

## Reglas de negocio

- **R1.** Una zona **sin tarifa resoluble no se sirve**: el checkout no ofrece
  domicilio a ella. Nunca se ofrece para después cotizar.
- **R2.** `ZONE_BASED` y `QUOTED_PER_ORDER` son **excluyentes** por sucursal. Es
  lo único consistente con R1.
- **R3.** Precedencia, en tres escalones: fila del **municipio** → fila de la
  **provincia** → **no servida**. Gana siempre lo más específico.
- **R4.** Cada fila lleva `rule: "FEE" | "NOT_SERVED" | "INHERIT"`, con
  `deliveryFee` **obligatorio** en `FEE` y **prohibido** en las otras dos
  (precedente de `barcode`, v4: presente es `400`, nunca un descarte silencioso).
- **R5.** `INHERIT` cae al escalón de encima; **si no hay escalón de encima, no
  servida**. Una fila **de provincia** con `INHERIT` es legal y es el único
  mecanismo que existe para retirar una regla de provincia.
- **R6.** `ZONE_TARIFF` **no acepta `DELETE`**: vuelve en `failed[]` con su
  propio código. Una fila nunca desaparece por un evento de zona, así que la
  guarda anti-rancio tiene siempre contra qué comparar.
- **R7.** Las filas de tarifario **mueren con la sucursal**, por clave ajena,
  cuando llega el `DELETE` de su `STORE`. «Sin `DELETE`» no significa que no
  mueran nunca.
- **R8.** Un `ZONE_TARIFF` repetido de la misma `(storeId, zoneCode)` es un
  **upsert con guarda anti-rancio** por `updatedAt`, como `STORE`, `PRODUCT` y
  `CATEGORY`.
- **R9.** `zoneCode` es lo **computable**; `city`/`province` de `STORE` siguen
  siendo texto de **presentación**. No se derivan uno del otro y contradecirse
  **no** es un error.
- **R10.** `contact.zoneName` es de **lectura humana**: no se compara, no se
  parsea y no resuelve nada. El precio, la cobertura y el emparejamiento salen
  siempre del `zoneCode`.
- **R11.** Las coordenadas (`contact.lat`/`lng`, opcionales) son para el
  mensajero. **Nunca** para cobrar.

## Casos límite y errores

- Un `zoneCode` **inválido en un `STORE`** rechaza ese evento con su propio
  código, en `failed[]` y nunca como `400` de lote. Hereda la trampa del
  `openingHours` —un teléfono que viajara en el mismo evento se queda sin
  corregir— y se acepta a propósito: un `zoneCode` sale de un selector sobre un
  catálogo compartido, así que **solo puede estar mal si los catálogos
  divergen**, y esa alarma no se quiere oír bajito.
- Un `ZONE_TARIFF` de una zona que este lado no conoce: `400` con nombre propio,
  nunca una tarifa guardada que nadie puede seleccionar.
- Una zona que **desaparece del catálogo** en una versión nueva deja filas
  apuntando a un código muerto → § SP2.
- Retirar la regla de provincia (`INHERIT`) y declarar la provincia no servida
  (`NOT_SERVED`) son cosas **opuestas** y van a estar a un clic en la misma
  pantalla del encargado. Es su problema de diseño y está anotado de su lado.
- Sin JavaScript el selector tiene que seguir funcionando: la lista es HTML, el
  mapa es la mejora.

## Datos y contrato

- **Contrato**: v13 de `docs/sync-contract.md`, mayor. `ZONE_BASED` como tercer
  valor de `deliveryFeeMode` **reabre la ADR 0028** por su propia regla («un modo
  de envío nuevo es una versión nueva del contrato, no un literal más en una
  lista», § Reabrir cuando).
- **`ZONE_TARIFF`** (sexta entidad): `{ storeId, zoneCode, rule, deliveryFee?,
updatedAt }`. Entidad y no un array en el `payload` de `STORE` por dos razones:
  ~168 municipios no caben en un payload cuyo precedente de tamaño
  (`openingHours`) son 2 KB, y ese payload es un upsert de la fila entera con
  guarda anti-rancio, así que cambiar una tarifa reenviaría la configuración del
  local y **competiría con la guarda** por quién escribió el último.
- **`Order`**: tres columnas nuevas anulables (`zoneCode`, `zoneName`, y el par
  de coordenadas), más la forma del pedido en el pull. El contacto ya es una
  instantánea plana (`contactName`, `contactPhone`, `contactEmail`,
  `deliveryAddress`).
- **Catálogo**: `code` DPA/ONEI estable, nombre y jerarquía. Los polígonos son un
  **activo estático de la web**, no una tabla.
- **Vector de precedencia**, publicado **en JSON** dentro del contrato y
  calculado ejecutando, no a mano. Nuestro test lo lee **del propio contrato** y
  no de una copia: transcribirlo es exactamente donde dos implementaciones se
  separan. Siete casos:

  1. municipio `NOT_SERVED` bajo provincia `FEE` → no servida
  2. municipio `INHERIT` bajo provincia `FEE` → el importe de la provincia
  3. municipio sin fila bajo provincia sin fila → no servida
  4. zona fuera de toda la cobertura → no servida
  5. municipio `FEE` bajo provincia `NOT_SERVED` → el del municipio («no sirvo
     Artemisa excepto Bauta»)
  6. provincia `INHERIT` con municipio `FEE` → el del municipio
  7. provincia `INHERIT` con municipio sin fila → no servida

## Criterios de aceptación propuestos

Todos `[nuevo]`: no hay feature todavía.

1. La resolución de precedencia pasa los **siete casos** del vector leyéndolo del
   propio `docs/sync-contract.md`, no de una copia; si el bloque JSON del
   contrato cambia, el test cambia con él.
2. Un `ZONE_TARIFF` con `operation: "DELETE"` responde `failed[]` con su código y
   **no borra ninguna fila**, comprobado leyendo la tabla antes y después.
3. Un `ZONE_TARIFF` rancio de una `(storeId, zoneCode)` que ya existe responde
   `stale` y no pisa el importe nuevo.
4. Un `ZONE_TARIFF` con `rule: "NOT_SERVED"` y `deliveryFee` presente responde
   `400`, no lo descarta en silencio.
5. Borrar la sucursal por un `STORE` con `DELETE` se lleva sus filas de tarifario,
   verificado contándolas después.
6. El checkout de una tienda `ZONE_BASED` **no ofrece** una zona sin tarifa
   resoluble, verificado con una zona `NOT_SERVED` bajo una provincia con `FEE`.
7. Con la tienda sirviendo cuatro municipios, la respuesta que sirve la geometría
   pesa lo de cuatro polígonos, medido en bytes, y no incluye ninguno más.
8. El selector funciona con JavaScript deshabilitado: se puede elegir la zona y
   confirmar el pedido.
9. Un pedido hecho con zona elegida llega al pull con `zoneCode` y `zoneName`, y
   el `zoneName` es **el que vio el comprador** aunque el catálogo haya cambiado
   de versión después, verificado cambiando el nombre en el catálogo entre el
   pedido y el pull.
10. Aplicar un `ZONE_TARIFF` que amplía la cobertura hace que la zona nueva
    aparezca en la primera visita posterior, sin esperar los 3600 s.
11. `docs/sync-contract.md` sube a **v13** con todo lo de § «Datos y contrato»,
    coordinada con cuadrecaja antes de publicarla.
12. `bash .agent/verify.sh <ID> --full` termina con código 0.

## Incongruencias detectadas

- **ADR 0028** § «Reabrir cuando» nombra literalmente la aparición de un tercer
  modo de envío: **se reabre**, no se elude.
- **ADR 0011** dice que las coordenadas se capturan «para el día que se
  implemente la búsqueda por cercanía». Cuadrecaja escribió que «ese día es
  este»; **no lo es**, y por su propio diseño: aquí no se ordena por distancia.
  La ADR sigue cerrada.
- **`DeliveryFeeMode`** tiene hoy dos valores en `prisma/schema.prisma`, y el
  vocabulario del cable sale del enum generado: un valor más es una migración y
  una versión del contrato, no un literal en una lista.
- **`Store.city`/`province`** son `String?` de texto libre, sin validar. Con
  `zoneCode` habrá dos representaciones del mismo hecho conviviendo a propósito
  (R9).

## Huecos y preguntas al humano

**SP1, SP2 y SP3 se cerraron el 2026-09-06** entre los dos arneses, con el
permiso de los dos humanos, y lo acordado está abajo en § «El catálogo, cerrado»
y § «El vector, cruzado». Ya no bloquean la v13. **SP5 lo cerró el humano el
mismo día.** Queda una sola cosa, y necesita una decisión suya nueva:

- **SP-H · La lista de códigos DPA/ONEI. CERRADO el 2026-09-08: la lista
  apareció.** Es el «Codificador de la División Político-Administrativa», Edición
  Enero 2011, recuperado del Internet Archive — § «El DPA, recuperado del
  Internet Archive». No hay que inventar ningún código y **ya no bloquea generar
  el catálogo**. La decisión del 2026-09-06 sigue en pie tal cual: la unión la
  hace el agente y el humano revisa solo las filas dudosas, que de momento son
  las nueve de Santiago de Cuba por una errata de la fuente.

- **SP4** resuelto por el orquestador: son **dos** features, F-041 y F-042.
- **SP5 · El peso del mapa, cerrado por el humano el 2026-09-06**, con estas
  palabras: no importa el tamaño, tratar de que sea **menos de 1 MB** pero si es
  necesario ocupar más, que se ocupe. Se interpreta sobre **lo que descarga un
  comprador**, que con la geometría por cobertura declarada es la cobertura de
  **una** tienda y no el país: el objetivo es holgado para el caso común y el
  techo no es un muro. Queda medido en el criterio del mapa de F-042.

## Lo verificado el 2026-09-06, antes de generar nada

Comprobado ejecutando, para saber si la generación era posible desde aquí. La
mitad de OSM sí; la de los códigos no.

**La geometría y los nombres se pueden obtener hoy, sin instalar nada.** No hace
falta el volcado `.osm.pbf` ni `osmium` ni `ogr2ogr` —ninguno está instalado—:
la API de Overpass responde y devuelve las relaciones administrativas de Cuba
directamente. Una consulta por `admin_level` 4 y 6 dentro del área de Cuba trae
**183 relaciones: 16 de nivel 4 y 167 de nivel 6**, cada una con su `name`, su id
de relación y su identificador de Wikidata.

**Y ahí está medido el «cuadra casi» que se temía.** La **Isla de la Juventud**
es la relación `1854614` y está en **`admin_level` 4**, no en 6: no aparece entre
las 167. Los «~168 municipios» que se citan son **167 de nivel 6 más la Isla**,
contada como municipio aunque esté al nivel de una provincia. Es exactamente el
caso que hace que el nivel tenga que ser un campo declarado y no una deducción, y
ahora está confirmado con una cifra y no con una sospecha. **El recuento
esperado de la procedencia, por tanto: 16 divisiones de primer nivel y 167
relaciones de nivel 6.**

**Los códigos DPA/ONEI no se pueden conseguir desde esta máquina, y no se van a
inventar.** Dos vías descartadas ejecutándolas:

- `onei.gob.cu` **no responde** desde aquí (fallo de conexión, no un 404).
- **Wikidata no tiene una propiedad para el código DPA/ONEI**: la búsqueda de
  propiedades por «ONEI», «DPA Cuba» y «Cuba municipality code» no devuelve
  ninguna. Las 183 relaciones **sí** traen todas su identificador de Wikidata,
  así que Wikidata sirve como identidad estable para unir contra otra lista —
  pero no como fuente del código.

Ninguna de las dos era la autoridad de todas formas (§ «El catálogo»: ONEI manda
en códigos, OSM en geometría), así que esto no cambia el acuerdo: confirma que
la lista tiene que entrar por una vía humana. **Lo que hace falta es un fichero**
—la publicación de la DPA con provincia, municipio y código, en PDF, CSV o lo que
haya— y con él el agente hace la unión por nombre y devuelve solo las filas
dudosas, que es lo que el humano pidió.

Si esa lista no aparece, la alternativa es nombrar los códigos nosotros, y
entonces se pierde lo que hacía preferible el DPA frente a los nombres libres: la
autoridad compartida y la comparabilidad entre negocios. No es la recomendación;
queda escrito para que la decisión sea consciente.

## El DPA, recuperado del Internet Archive (2026-09-08)

**SP-H se cierra con la lista real: no hay que inventar ningún código.** El humano
pidió agotar el Internet Archive antes de aceptar otra identidad, y preguntó
además si existía una lista **vieja y completa** sobre la que aplicar los cambios
de la reforma. Esa pregunta es la que lo encontró: buscando la vieja apareció,
en el mismo rincón del sitio, **la nueva y completa**.

**La fuente, y es la autoridad que el § «El catálogo, cerrado» pedía:**

- **«Codificador de la División Político-Administrativa», República de Cuba,
  Edición Enero 2011**, ONEI, 9 páginas, en
  `web.archive.org/web/20110125204824id_/http://www.one.cu/publicaciones/08informacion/mapasdecuba/DPA.pdf`.
  Trae los códigos de **las 16 divisiones de primer nivel y los 168 municipios**,
  con la forma `PP.MM` — provincia de dos dígitos, municipio de dos dígitos.
- **Los códigos de primer nivel:** 21 Pinar del Río, 22 Artemisa, 23 La Habana,
  24 Mayabeque, 25 Matanzas, 26 Villa Clara, 27 Cienfuegos, 28 Sancti Spíritus,
  29 Ciego de Ávila, 30 Camagüey, 31 Las Tunas, 32 Holguín, 33 Granma, 34
  Santiago de Cuba, 35 Guantánamo, y **40 para el Municipio Especial Isla de la
  Juventud**, cuyo único municipio es el `40.01`.

**Las tres fuentes cuadran, y esto es la comprobación de la procedencia hecha
antes de generar nada:** el codificador da 15 provincias y 168 municipios
contando la Isla; el capítulo Territorio del AEC 2012 dice «15 provincias, 168
municipios»; y Overpass devuelve 16 relaciones de nivel 4 y 167 de nivel 6, que
son las 15 provincias más la Isla al nivel de una provincia, y sus 167 municipios
más la Isla contada como municipio. **168 = 167 + 1**, por el mismo caso especial
que ya obligaba a declarar el nivel.

**Y la Isla lo confirma una tercera vez, con un cambio de código:** en la lista
pre-reforma de 2006 era `9901`, y en el codificador de 2011 es `40.01`. El código
de una zona no es estable entre ediciones de la DPA, así que la edición usada va
en la procedencia y **el id de OSM sigue siendo lo que une las regeneraciones**.

**UNA ERRATA EN LA FUENTE, y es del propio PDF de ONEI, no de la extracción.** El
bloque encabezado `PROVINCIA: 34 SANTIAGO DE CUBA` imprime sus nueve municipios
como `32.01 Contramaestre` … `32.09 Guamá`, repitiendo el prefijo de Holguín, que
en la misma página gasta `32.01`–`32.14`. Los códigos correctos han de ser
`34.01`–`34.09`, pero **eso no se arregla en silencio**: son nueve municipios con
dos códigos posibles y entran en el informe de filas dudosas que revisa el
humano, con la errata citada. Si se corrigiera sin decirlo, el catálogo tendría
nueve códigos que ninguna fuente respalda, y sería indistinguible de haberlos
inventado. Es, de paso, la mejor defensa de por qué la revisión humana de la
unión no era ceremonia: el fallo estaba en la fuente oficial y lo caza contar.

**Material de apoyo recuperado, que sirve para el contraste:**

- **«Codificación de la DPA en provincias y municipios que sufren
  modificaciones»**, ONEI, 2010-08-04, en
  `web.archive.org/web/20101221055419id_/http://www.one.cu/publicaciones/cepde/Nueva%20DPA/Territorios%20DPA.doc`
  — los municipios de las seis provincias que la reforma tocó (Pinar del Río,
  Artemisa, La Habana, Mayabeque, Matanzas, Guantánamo).
- **La DPA completa pre-reforma**, en
  `web.archive.org/web/20060708194124id_/http://www.one.cu/dpa.htm`
  — 14 provincias `01`–`14` y la Isla como `9901`, 169 municipios. Es lo que
  cierra la aritmética de la reforma: Pinar del Río 14 → 11, la antigua provincia
  de La Habana 19 → Artemisa 11 + Mayabeque 11 (los tres que faltaban salen de
  Pinar del Río: Bahía Honda, Candelaria y San Cristóbal), Matanzas 14 → 13, las
  nueve provincias no tocadas mantienen sus 96, y 169 → 168.
- **Los anuarios estadísticos municipales de ONEI**, cuyos nombres de fichero
  llevan el código: `2101_anuario_estadistico_sandino_2019.pdf`,
  `anuario_2020_edicion_2021_-_municipio_bahia_honda_2201.pdf`. Confirman el
  codificador desde una publicación distinta y **coincidieron 11 de 11 en
  Artemisa**.

**Lo que NO se pudo conseguir, y ya no bloquea:** `onei.gob.cu` sigue sin
responder desde esta máquina el 2026-09-08, y Wikidata no tiene propiedad para el
código DPA. La lista entró por el Archive, no por la web viva, así que **la
edición usada queda congelada en la procedencia**: Codificador, Edición Enero 2011. Si ONEI publicó una edición posterior, este catálogo no la refleja, y eso
se sabrá porque está escrito.

**El QID de Wikidata se queda, pero como herramienta de unión, no como `code`.**
Verificado el 2026-09-08: las 183 relaciones de Overpass traen QID, sin
duplicados y sin ninguna sin nombre. Sirve para unir el codificador con la
geometría sin depender del nombre, que es justo donde la unión falla: entre las
183 hay **12 nombres repetidos** —cada provincia con su municipio capital
homónimo, y `San Luis`, que son dos municipios en dos provincias distintas—. El
`code` que viaja por el cable sigue siendo el DPA, como decía el acuerdo.

## El catálogo, cerrado (SP1 y SP2)

**Son dos artefactos con vidas distintas, no uno.** El **índice** `code → nombre`
son ~184 filas: diminuto, hace falta en cada pantalla y es lo que resuelve
`zoneName`. La **geometría** es grande y solo la necesita el mapa, que además la
carga por cobertura declarada. Sus versiones se mueven por separado: el nombre de
un municipio y su polígono no cambian por lo mismo ni con la misma frecuencia.

**La autoridad está repartida, y esto es lo que ninguno de los dos había
nombrado hasta el final:** el `code` **no sale de OSM**. La lista oficial
DPA/ONEI es la autoridad de códigos y nombres; OSM es la autoridad de la
geometría y de nada más. La unión entre las dos **es** el artefacto, y se genera
con un informe donde cada código sin geometría y cada geometría sin código
**fallan a la vista**, nunca se descartan en silencio — ahí se verifica la
consistencia entre los dos artefactos en vez de suponerla de una fuente única.

**Los genera queandabuscando, una vez, y son bytes commiteados.** No un guion que
cada lado ejecuta: OSM cambia a diario, así que dos ejecuciones del mismo comando
en días distintos dan ficheros distintos y tendríamos dos catálogos «de la misma
fuente» que no coinciden. Una extracción, dos artefactos, los mismos bytes a los
dos lados, y el hash lo demuestra.

**Tres identidades por zona, y cada una con su papel escrito**, porque la
confusión entre ellas es lo que rompería el mecanismo:

| Identidad   | Para qué                                    | Viaja por el cable |
| ----------- | ------------------------------------------- | ------------------ |
| `code` ONEI | Decide el precio y empareja las dos bases   | **Sí, y solo él**  |
| id de OSM   | Unir en cada **regeneración**, sin nombres  | Nunca              |
| nombre      | Para las personas (`zoneName`, el selector) | Solo como copia    |

**El id de OSM se guarda para que el emparejamiento por nombre ocurra una vez en
la vida.** Sin él, cada edición nueva de ONEI o cada volcado más fresco vuelve a
unir por nombre —con los mismos acentos y la misma persona, que esta vez ya no
revisa 184 filas con atención porque «ya lo revisamos»—: el riesgo no se cierra,
se reprograma. Con el id, toda regeneración une por id y la revisión humana pasa
a ser el **diff**. Y se guarda **también el nombre que la zona tenía en OSM al
generarse**, para que el diff distinga tres desenlaces y no dos: id nuevo, id
desaparecido, e **id vivo que cambió de nombre** — el tercero es el único que
necesita una persona, porque un renombrado puede ser una errata o el rastro de un
cambio territorial.

**El nivel de cada zona es un campo explícito del artefacto y NO se deduce de la
longitud del código.** «2 dígitos = provincia, 4 = municipio» es la regla
implícita que los dos arneses estábamos a punto de dejar pasar, y el fallo que
produce es concreto: **una zona de primer nivel con código de cuatro dígitos
cuyos dos primeros coincidan con una provincia real heredaría la tarifa de esa
provincia**, sin error y sin rastro, y el comprador pagaría un precio que nadie
fijó para su zona. Con el nivel declarado deja de importar qué código tenga cada
zona. El caso que lo hace real y no teórico es la **Isla de la Juventud**, un
municipio especial al nivel de una provincia: su código lo dice ONEI y no se
inventa aquí, y hasta generar el artefacto no se puede descartar que sea de
cuatro dígitos.

**La simplificación tiene que preservar la topología**, y su fallo es el peor de
todo el diseño porque aparece exactamente donde se usa el mapa. Si cada polígono
se simplifica **por separado** —que es lo que hace cualquier bucle escrito con
buena intención— la frontera compartida entre dos municipios se simplifica de dos
formas distintas y quedan **huecos y solapes** a lo largo de ella: el comprador
toca su casa en el límite entre Playa y Marianao y el punto no cae en ninguna
zona, o cae en dos. Es el argumento del mapa volviéndose contra sí mismo. La
condición: **el conjunto se simplifica en una sola operación**, con todas las
zonas en el mismo fichero, para que cada frontera se simplifique una vez y las
dos vecinas hereden la misma línea. Y se comprueba al generar, con dos
comprobaciones y no una: que la unión de los municipios de una provincia
reconstruya la provincia sin huecos ni solapes, y —la que describe el uso— que
**cualquier punto de una provincia caiga en exactamente una** de sus zonas. La
primera puede pasar por poco; la segunda no.

**Un `code` retirado no muere y no se reutiliza nunca** (SP2). Se queda en el
catálogo marcado como retirado: es matar el `DELETE` de `ZONE_TARIFF` un nivel
más arriba. Si un código pudiera desaparecer, una fila de tarifario quedaría
colgando de la nada y un `zoneName` histórico dejaría de resolver, y un pedido
viejo tiene que poder leerse siempre. **Y no reutilizarlo es la mitad que de
verdad importa**: en Cuba ha habido reorganizaciones territoriales que parten y
fusionan municipios, y un código reutilizado dejaría una fila de tarifario vieja
**resolviendo con otro significado** — el comercio cobrando la tarifa de Playa a
un municipio que nunca configuró, sin error y sin rastro. Un código retirado
**se lee pero no se escribe**: el selector del checkout no lo ofrece, y una fila
de tarifario que apunte a él sigue resolviendo para que un pedido existente se
pueda explicar.

**La procedencia que va escrita junto a los bytes** —sin esto, dentro de un año
nadie sabe regenerar el mismo fichero y la única salida es empezar con otros
bytes:

- edición de la lista DPA/ONEI usada, con su fuente. Importa: la reorganización
  que creó Artemisa y Mayabeque a partir de la antigua provincia de La Habana
  cambió los códigos de primer nivel, así que una lista vieja y una nueva no son
  la misma cosa
- el volcado de OSM exacto: el fichero con su fecha y su suma de comprobación
  publicada, nunca «OSM»
- los `admin_level` usados
- proyección (WGS84 / EPSG:4326), tolerancia de simplificación, **que fue
  topológica**, la herramienta que la aplicó, y la precisión decimal a la que se
  redondean las coordenadas —que es una **segunda** pérdida y suele olvidarse—
- recuento de divisiones de primer nivel y de municipios: es la cifra que una
  persona mira y dice «falta uno», y es lo que detecta que la Isla de la Juventud
  se colara en el nivel equivocado
- las filas que necesitaron emparejamiento manual
- hash de cada artefacto y fecha de generación

**Lo que cuadrecaja hace con el índice** cuando exista: entra como artefacto
versionado con un test de integridad que verifica el recuento esperado, que los
dos primeros dígitos de cada municipio correspondan a una provincia presente en
el mismo fichero, que no haya códigos duplicados y que ningún código retirado
reaparezca activo. Convierte la «cifra que un humano mira» en algo que falla
solo. No está escrito todavía, a propósito: un test contra un fichero imaginario
se ajusta a lo que salga, que es lo contrario de un test.

## El vector, cruzado (SP3)

**Diez casos, calculados por las dos partes con implementaciones independientes y
sin ver los resultados del otro: cero divergencias** en importe, en fila
decisoria y en camino.

Hacerlo a ciegas no fue ceremonia. Las dos implementaciones devolvían **solo la
fila decisoria**, y eso no distingue lo que las pantallas tienen que distinguir:
`0303` y `0304` los decide la misma fila (`03`, `FEE`) por caminos distintos —una
tenía fila propia que dijo `INHERIT`, la otra no tenía fila—, y de los tres «no
servida», en uno hay una fila de provincia (`INHERIT`) que declina decidir y en
los otros dos no hay nada en ningún nivel. Con los resultados del otro delante,
los dos habríamos coincidido en los diez importes y **los dos** habríamos
publicado un vector ciego a esa diferencia. Por eso el vector lleva, por caso,
**el camino completo** —los escalones consultados y qué dijo cada uno— y no solo
la fila que decidió.

El fixture y los diez casos van en **JSON dentro del contrato**, calculados
ejecutando y no a mano, y **el test de este lado los lee del propio contrato**,
no de una copia: transcribirlos es exactamente donde dos implementaciones se
separan. Los dos lados escribieron además la misma instrucción para el futuro:
**si algún día las dos funciones divergen, no se ajusta ninguna para que cuadre —
se averigua cuál de las dos lecturas es la del contrato.**

Tres guardas que el vector no cubría y que van al contrato con él:

1. Una fila `FEE` **sin importe** no es envío gratis: **no decide** y cae al
   escalón de arriba.
2. Una tarifa de **0 sí es envío gratis**, y no «no servida». Es la trampa del
   `0.00` de la v6 otra vez, y en código tiene una forma concreta que va escrita
   al lado de la regla: la comprobación es contra `null`/`undefined`, **nunca
   contra un valor falsy** — un `if (!fila.deliveryFee)` convierte el envío
   gratis en el importe de la provincia por una línea que parece correcta.
3. Un importe **negativo** se rechaza en el schema —como ya hace `deliveryFee` en
   `STORE`— **y** la fila se trata como que no decide, cayendo al escalón de
   arriba. Lo segundo no es defensivo: es lo que hace que las dos
   implementaciones coincidan incluso en el caso corrupto que el schema no
   debería dejar pasar.

## No decidido a propósito

- **La pantalla del tarifario**, que es de cuadrecaja. Se comprometieron a que el
  encargado lea «sirvo estas 14 zonas a estos precios» y no cuatro filas que hay
  que resolver mentalmente, y a que no pueda producir un `DELETE` cuando quiere
  decir «aquí no vamos».
- **Qué proveedor sirve las teselas del mapa**, si acaba habiendo teselas. Con
  polígonos propios sobre un fondo neutro puede no hacer falta ninguno.

## El costo asumido, escrito para poder releerlo

El catálogo geográfico **tiene hoy un solo consumidor**: este tarifario. No hay
ningún feature de búsqueda ni de informes por zona, ni aquí ni en el backlog de
cuadrecaja, y el argumento «ya lo usaremos para otras cosas» no está escrito en
ninguna parte. Se elige igual el código DPA compartido frente a **zonas con
nombre libre que declara cada tienda** por cuatro razones: un nombre libre no se
puede dibujar, así que sin catálogo no hay mapa; sería el mismo concepto en dos
bases de datos de dos organizaciones, que es lo que ya mordió antes; no es más
simple, es el mismo problema repartido entre quinientos comerciantes que teclean
la lista que ve el comprador, donde nadie lo puede arreglar; y `contact.zoneName`
se queda sin sentido, porque con nombres libres el código _es_ el nombre.

**Y el precio**: el catálogo necesita un responsable en cada lado y una versión
que se compare, indefinidamente, para dar de comer a un solo consumidor. Si
dentro de un año el tarifario sigue siendo lo único que lo usa y mantener la
versión sincronizada cuesta más de lo que ahorra, la decisión correcta era la
otra y esta propuesta es donde nos equivocamos.
