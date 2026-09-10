# 0032 — El catálogo de zonas son bytes commiteados y la base es su espejo

**Aceptada** · 9 de septiembre de 2026 · F-041, completada por F-042 el mismo
día con su segundo artefacto (§ «Nota de F-042», al final).

Es la primera ADR de este repositorio sobre un **dato de referencia
compartido** entre los dos sistemas: ni cuadrecaja ni queandabuscando son la
fuente, y ninguno de los dos lo genera en cada arranque.

## Contexto

Los comercios cubanos cobran el envío por municipio (S-007 de cuadrecaja,
`.agent/solicitudes.md`), y eso exige un catálogo de 184 zonas — 16 divisiones
de primer nivel y 168 municipios — que los dos lados tienen que nombrar igual.
No hay una API pública que lo sirva: ONEI publica un PDF (el «Codificador de la
División Político-Administrativa», Edición Enero 2011) y OpenStreetMap tiene la
geometría y la identidad de cada relación, pero ninguna de las dos fuentes por
sí sola resuelve el problema — el `code` de ONEI no está en OSM, y OSM cambia a
diario, así que dos ejecuciones del mismo cruce en días distintos darían dos
catálogos «de la misma fuente» que no coinciden.

## Decisión

**(a) La autoridad son los bytes del repositorio, y la tabla es su espejo,
sembrado e idempotente.** `src/features/zones/zone-index.json` se genera **una
vez**, es una extracción reproducible descrita en su propia procedencia
(`src/features/zones/zone-index.provenance.md`), y se commitea. El schema del
sobre lo importa como módulo — sin base de datos, lo que hace alcanzable el
`400` de lote sobre una zona desconocida (criterio 6, arquitectura F-041 § I7).
Las tablas `Zone`/`ZoneCatalogVersion` de Postgres existen para la integridad
referencial de `ZoneTariff`/`Store.zoneCode` y para que una persona pueda
consultar el catálogo con SQL — nunca para decidir el `400`. Cuando los dos
divergen —alguien migró sin sembrar—, gana el artefacto en la validación y la
clave ajena falla el evento en `failed[]`, nunca en `400`.

**(b) El `code` es de ONEI; el id de relación de OSM solo une regeneraciones y
nunca viaja por el cable.** La autoridad está repartida: ONEI manda en códigos
y nombres, OSM en la identidad de la relación y en nada más. Guardar el id de
OSM junto a cada fila es lo que permite que una regeneración futura una por id
en vez de por nombre, y que la revisión humana de una unión nueva sea un
**diff** de tres desenlaces (id vivo con el mismo nombre, id vivo que cambió de
nombre, id nuevo) en vez de releer 184 filas desde cero.

**(c) El nivel de una zona es un campo declarado, nunca deducido de la longitud
o del prefijo del código.** El caso real es la Isla de la Juventud: primer
nivel `40`, municipio `40.01` — un código de cuatro caracteres cuyos dos
primeros dígitos coinciden con una provincia real heredaría su tarifa sin error
y sin rastro si el nivel se dedujera de la forma.

**(d) Un código retirado se lee, no se ofrece, y no se reutiliza nunca.** Se
marca con `retiredAt` (mismo patrón que `Slug.retiredAt`, ADR 0017) y la fila
se queda en el índice para siempre. Un código reutilizado dejaría una fila de
tarifario vieja resolviendo con otro significado — el comercio cobrando la
tarifa de una zona a otra que nunca configuró.

**(e) El índice y la geometría son dos artefactos con versiones separadas.**
El nombre de un municipio y su polígono no cambian por lo mismo ni con la misma
frecuencia. F-041 solo construye el primero; F-042 trae el segundo, con su
propia procedencia y su propio mecanismo de versión.

**(f) La consecuencia que ordena todo lo demás: el schema del sobre puede
rechazar una zona desconocida con un `400` de lote porque el catálogo no es una
consulta.** Si el índice viviera solo en Postgres, lo máximo alcanzable sería un
`failed[]` por evento — el criterio 6 de F-041 estaría mal escrito. Es
exactamente lo que hace que este acuerdo no sea un detalle de gusto.

## Consecuencias

- **Los bytes tienen que ser idénticos en los dos repositorios**, y el sha256
  publicado en `docs/sync-contract.md` es el árbitro. `zone-index.json` entra
  en `.prettierignore`: Prettier le cambiaría los bytes y con ellos el hash.
- **Una versión nueva del índice mueve la MENOR** (`1.0.0` → `1.1.0`) si
  cambia cualquier fila; mueve la **MAYOR** si la edición del Codificador
  cambia — los códigos no son estables entre ediciones (la Isla de la
  Juventud fue `9901` en la lista de 2006 y es `40.01` en esta de 2011).
- **La siembra es un paso operativo, no de esquema.** `npm run seed:zones`
  (`docs/despliegue.md` § 1) se corre a mano una vez por entorno, después de
  `db:deploy`. Sin él, la migración deja el catálogo vacío y todo
  `ZONE_TARIFF` falla por clave ajena — indistinguible de "está bien" hasta
  que llega el primer evento.
- **El id de relación de OSM no es único.** La Isla de la Juventud aparece en
  OSM en `admin_level=4` y no en 6, así que sus dos filas del índice (`40` y
  `40.01`) comparten una relación: 184 filas, 183 relaciones.

## Alternativas descartadas

- **Un guion que cada lado ejecuta contra Overpass.** OSM cambia a diario; dos
  ejecuciones en días distintos producirían dos catálogos que no coinciden,
  aunque los dos se llamaran «de la misma fuente».
- **Guardar el catálogo solo en Postgres.** Mata el criterio 6: un `400` de
  lote sobre una zona desconocida exige comprobarlo sin tocar la base.
- **Deducir el nivel de la longitud del código.** El antipatrón que la Isla de
  la Juventud existe para desenmascarar.
- **Reasignar un código retirado.** Dejaría un tarifario histórico resolviendo
  con un significado distinto del que tenía cuando se guardó.

## Lo que esta ADR no decide

- **La geometría, su simplificación y su propio mecanismo de versión.** Es de
  F-042.
- **PostGIS y la búsqueda por cercanía.** [ADR 0011](0011-sin-postgis-por-ahora.md)
  no se reabre: aquí ninguna coordenada decide un precio ni ordena nada.

## Reabrir cuando

- **El catálogo tenga un segundo consumidor** más allá de la resolución de
  tarifas y F-042.
- **Mantener la versión sincronizada entre los dos repositorios cueste más de
  lo que ahorra** — el precio que `.agent/specs/propuestas/zonas-de-envio.md`
  § «El costo asumido» ya dejó escrito.

## Nota de F-042 (9 de septiembre de 2026)

El punto (e) de esta ADR decía que «F-042 trae el segundo [artefacto], con su
propia procedencia y su propio mecanismo de versión» — esta nota materializa
exactamente eso, sin contradecir nada de lo decidido arriba:

- **El segundo artefacto**: `src/features/zones/geometry/` — 168 ficheros
  `<code>.json` de grano MUNICIPIO más `manifest.json` con sus hashes,
  recuentos y procedencia (`geometry.provenance.md`). Su versión
  (`1.0.0`) se mueve por SEPARADO de la del índice: un polígono y un nombre
  no cambian por lo mismo ni con la misma frecuencia.
- **Se sirve por cobertura, concatenando bytes, nunca consultando una base
  espacial.** `GET /api/zones/geometry/{slug}` resuelve la cobertura de esa
  sucursal (la misma función que el checkout, una consulta) y concatena las
  cadenas de sus ficheros de zona — cero `JSON.parse` de un byte de
  geometría. Esa frase es también la que deja
  [ADR 0011](0011-sin-postgis-por-ahora.md) **cerrada sin discusión**: el
  único punto-en-polígono del sistema lo hace Leaflet en el navegador, sobre
  datos que ese navegador ya descargó — la 0011 no se reabre y esta nota no
  la necesita para nada.
- **La simplificación es topológica, en una sola operación sobre las 168
  zonas de municipio** (mapshaper, Visvalingam ponderada), con dos
  comprobaciones que corren después del redondeo y que, si fallan, hacen que
  el generador no escriba nada. El snap de importación real (0.0015°, ≈166 m)
  es una desviación MEDIDA de lo estimado al diseñar (≈1 m) — ver
  `.agent/specs/F-042/impl.md` § Desviaciones para la evidencia completa.
