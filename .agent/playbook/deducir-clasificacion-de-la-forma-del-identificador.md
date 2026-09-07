---
slug: deducir-clasificacion-de-la-forma-del-identificador
sintoma: ningún log — el resultado sale bien formado y es el de otra cosa
firma: —
etapa: review
visto_en: v13 (zonas de envío), cruce con cuadrecaja
creado: 2026-09-06T00:00:00Z
promovido_a_agents: no
arreglo: la clasificación es un campo declarado del dato, nunca algo que se deduce de la forma de su identificador
---

## Qué pasa de verdad

Un identificador **parece** llevar su clasificación encima —dos dígitos es una
provincia y cuatro un municipio, un prefijo dice el tipo, la longitud dice el
nivel— y se escribe la deducción en vez de leer el campo. Funciona en casi todas
las filas. La excepción, cuando llega, **no da error**: encuentra otro camino
válido en la misma escalera y devuelve un resultado bien formado que es el de
otro dato.

El caso que lo estrenó: en el tarifario por zonas de la v13, la provincia de un
municipio son los dos primeros dígitos de su código. Con eso, **una zona de
primer nivel con código de cuatro dígitos cuyos dos primeros coincidan con una
provincia real hereda la tarifa de esa provincia** — el comercio cobraría un
importe que nunca fijó para esa zona, sin excepción, sin log y sin diferencia
visible en la pantalla. En Cuba la excepción tiene nombre: la Isla de la
Juventud, un municipio especial al nivel de una provincia.

## Cómo se arregla

El nivel —o el tipo, o lo que se estuviera deduciendo— **se declara en el dato**
y se lee de ahí. En este caso, el artefacto del catálogo geográfico lleva un
campo de nivel explícito por zona y la resolución de la tarifa lo consulta;
`zoneCode.length === 4` no aparece en ninguna parte.

Si la deducción tiene que sobrevivir un tiempo —porque el dato declarado
todavía no existe—, vale, pero **documentada como comportamiento de arranque y
con fecha de muerte**: cuando llegue el campo, se borra. Lo que no vale es que
sobreviva como convención del formato.

## Cuándo NO es esto

No aplica a un identificador cuyo formato **es** el contrato y está validado en
la entrada: un GTIN de 13 dígitos es un GTIN de 13 dígitos, y comprobar la
longitud ahí es validar, no clasificar. La diferencia es qué haces con el
resultado: si decides **qué es** el dato, es esta ficha; si decides si el dato
**está bien formado**, no lo es.

## Cómo se evita

Tres señales de que estás a punto de hacerlo, y las tres estaban presentes aquí:

1. La regla se cumple en casi todas las filas y **la excepción tiene nombre
   propio** — si alguien puede nombrarla, existe.
2. La deducción cabe en **una función de una línea** que nadie va a revisar.
3. Cuando la excepción entra **no falla**: encuentra otro camino válido y
   devuelve algo bien formado.

Y la parte que no es sobre código, que es la que costó: **este fallo no lo
encuentra leer el propio código.** Los dos lados del contrato habíamos escrito la
misma regla implícita —uno en una función, el otro a punto de dejarla como
convención— y ninguno la habría visto revisando lo suyo. Lo que la destapó fue
implementar el mismo acuerdo **dos veces, por separado y sin ver el resultado del
otro**. Cuando algo se implementa en dos sitios por contrato, el cruce no es
burocracia: es el único lector que no comparte tus suposiciones. Lo mismo pasó
con el vector de precedencia — las dos implementaciones devolvían solo la fila
decisoria y las dos habrían publicado un vector ciego a lo que las pantallas
tienen que distinguir.

Ningún sensor de `verify.sh` puede pescar esto: no hay log, no hay excepción y el
resultado es bien formado. Por eso la ficha es de etapa `review`.
