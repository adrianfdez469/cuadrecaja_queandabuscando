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

| #     | Qué piden                                                | Nuestra postura                                                                                                                                                                | Dónde vive                                                       |
| ----- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| S-001 | Releer un pedido concreto sin depender del cursor        | **Entregada**, las dos formas. El detalle de lo acordado está abajo, en «Cerradas» — esta fila solo la mantiene visible aquí                                                   | F-033 (cerrado 2026-09-02) · `docs/sync-contract.md` **v8**      |
| S-002 | Qué hace el SQL espejo con un producto borrado en blando | **Confirmado: el espejo excluye las filas dadas de baja**, y la exclusión es del lado que tiene el `deletedAt`, o sea el suyo. Nos toca dejarlo escrito en el § ⑤ del contrato | Nota en `docs/sync-contract.md`, versión **menor** · sin feature |

La fila de S-001 se queda en esta tabla **mientras siga en la de abiertas de
ellos**, que es la regla de la sección: su documento lo actualizan ellos, no
nosotros. Quitarla de aquí antes hace que `bash .agent/solicitudes.sh` la
reporte como «SIN TRIAR», porque el cruce busca una fila nuestra para cada
solicitud suya que siga abierta — una falsa alarma que cuesta más que la
duplicación.

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
deja de detectar lo que existe para detectar. La nota va al § ⑤ y es una versión
**menor**, no mayor: aclara lo ya acordado y no cambia lo que el POS envía ni
recibe. No bloquea nada inmediato, pero tiene que estar resuelto **antes de
F-008**, que es donde el hash pasa a ser una decisión operativa.

<!-- Ejemplo del formato; no lo borres, que es lo que explica las columnas:
  | S-000 | Releer un pedido sin depender del cursor | Aceptada: `?status=` | F-033 · contrato v7.1 |
     ↑ su id     ↑ su título, tal cual        ↑ aceptada/rechazada/en espera + el porqué en una línea
                                                                              ↑ feature y/o versión del contrato
-->

## Cerradas

Lo que se decidió y por qué, aunque ellos ya la hayan quitado de su tabla. Esta
sección no se poda: es la memoria de la negociación entre los dos sistemas.

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
