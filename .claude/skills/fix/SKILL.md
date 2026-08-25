---
name: fix
description: Resuelve un fallo concreto — un test rojo, el CI en rojo, un error en pantalla, algo que dejó de funcionar — con el bucle de auto-corrección del arnés: consultar la bitácora de problemas ya resueltos, ejecutar el sensor, arreglar sobre el error real y dejar la lección escrita. Úsalo cuando hay algo roto y no un feature que construir. Invocable como /fix "el build falla en Vercel".
---

# Arreglar

Esto no es `/sdd`. `/sdd` construye lo que no existe; esto repara lo que existía
y dejó de funcionar. Si el arreglo resulta ser un feature nuevo, para y dilo: el
backlog lo escribe el humano (regla 4).

El bucle es el mismo que corre `sdd-implementer` dentro de un feature, y está
descrito entero en [`.agent/README.md`](../../../.agent/README.md) § «Cuando algo
falla». Aquí solo va lo que cambia cuando no hay feature.

## 1. Antes de investigar, pregunta si ya nos pasó

```bash
bash .agent/sdd.sh playbook             # todas las fichas
bash .agent/sdd.sh playbook revalidate  # las que mencionen algo del síntoma
```

Busca por el **síntoma**, no por tu hipótesis: la ficha describe lo que se ve,
no lo que lo causa. Y lee `AGENTS.md` § «Cosas que muerden», que es la misma
bitácora ya promovida a convención.

Si encuentras la ficha, ya terminaste de investigar: aplica su `arreglo`,
verifica y salta al paso 4. Si el arreglo que propone ya no sirve, **corrígela**
en el mismo movimiento — una ficha que miente cuesta más que ninguna.

## 2. Reprodúcelo con el sensor

```bash
bash .agent/verify.sh                   # typecheck · lint · format · test
bash .agent/verify.sh --full            # + harness · prisma · build · theme · bundle
bash .agent/verify.sh --only test       # una sola etapa, cuando ya sabes cuál
```

Sin `F-NNN` el historial va a `.agent/runs/_libre/`, y todo lo demás funciona
igual: captura la salida cruda, le pone firma y consulta la bitácora.

Si el fallo **no** lo ve ninguna etapa —es lento, es feo, se cuelga— antes de
arreglar nada consigue que alguna lo vea. Un fallo que no se puede reproducir
ejecutando algo tampoco se puede dar por arreglado ejecutando algo.

## 3. Arregla sobre el error real, no sobre tu recuerdo del error

El sensor te imprimió la salida y te dejó el log completo. Arregla, vuelve a
ejecutar, repite. No pidas permiso entre vueltas.

A la tercera vuelta con la **misma firma** sale con `2` (`ESTANCADO`) y ahí se
para: significa que el fallo no está donde lo estás buscando. Cambia de
hipótesis o sube el problema al humano con las tres que ya descartaste. No hay
cuarta vuelta.

## 4. Deja la lección escrita

Es la mitad del trabajo, no el papeleo del final:

```bash
bash .agent/sdd.sh learn <slug>     # si volverá a pasar
```

Rellena `firma` con un ERE que reconozca el próximo fallo igual y `arreglo` con
una línea imperativa, y **comprueba que la firma pesca**:

```bash
grep -aEi -- '<tu firma>' .agent/runs/_libre/*.log
```

Si fue un descuido que no le enseña nada a nadie, ciérralo diciéndolo:

```bash
bash .agent/verify.sh dismiss _libre '<firma>' 'motivo'
```

## 5. Y dilo donde toque

- Si el arreglo tocó código de un feature en curso, anótalo también en su
  progreso: `bash .agent/sdd.sh log F-NNN sdd-implementer`.
- Si la ficha ya aparece en dos features distintos, propón al humano subirla a
  `AGENTS.md` § «Cosas que muerden» y márcala `promovido_a_agents: sí`.
- Si el fallo revela que un `acceptance_criteria` estaba mal escrito, **no lo
  cambies**: la regla 3 se lo reserva al humano. Dilo y espera.
