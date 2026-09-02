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

| #     | Qué piden                                         | Nuestra postura                                                                                                           | Dónde vive                                                               |
| ----- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| S-001 | Releer un pedido concreto sin depender del cursor | Aceptada, las dos formas: `?status=` para el ciclo normal y `?ids=` para relecturas puntuales. Ninguna mueve `nextCursor` | F-033, sin empezar · sube versión de `docs/sync-contract.md` al cerrarlo |

<!-- Ejemplo del formato; no lo borres, que es lo que explica las columnas:
  | S-000 | Releer un pedido sin depender del cursor | Aceptada: `?status=` | F-033 · contrato v7.1 |
     ↑ su id     ↑ su título, tal cual        ↑ aceptada/rechazada/en espera + el porqué en una línea
                                                                              ↑ feature y/o versión del contrato
-->

## Cerradas

Lo que se decidió y por qué, aunque ellos ya la hayan quitado de su tabla. Esta
sección no se poda: es la memoria de la negociación entre los dos sistemas.

_(vacío)_
