---
slug: sdd-done-no-es-una-sonda
sintoma: «progress/<ID>.md no existe» a mitad de un ciclo, con el feature todavía en marcha y la bitácora sin anotar
firma: —
etapa: —
visto_en: F-039
creado: 2026-09-08T17:43:01Z
promovido_a_agents: no
arreglo: no ejecutes `sdd.sh done` para averiguar si falta algo — usa `sdd.sh status <ID>`, que informa sin cerrar
---

## Qué pasa de verdad

`bash .agent/sdd.sh done <ID>` **no** es una comprobación con efectos
secundarios: es el cierre. Comprueba sus cinco condiciones y, si están todas,
**borra `.agent/progress/<ID>.md`** — que es lo que tiene que hacer, porque el
progreso llevaba el estado de un trabajo que ya terminó
(`.agent/README.md` § «Al completar un feature»).

El problema es que se lee como un `check`. Un agente que quiere saber si le
falta algo para cerrar lo ejecuta «a ver qué dice», le salen las cinco
condiciones cumplidas, y descubre que ha cerrado el feature **de verdad** cuando
ya no hay progreso que anotar. Y el progreso **no está versionado**: no hay
`git checkout` que lo devuelva. Lo que se reconstruye después sale de la memoria
de la conversación, que es fiel a lo que el agente recuerda, no a lo que había
escrito.

En F-039 pasó al final del ciclo del probador: el cierre era correcto y el
feature estaba efectivamente listo, así que el daño fue reconstruir a mano un
documento que ya no hacía falta. Con `passes: false`, o a mitad del trabajo, el
mismo comando se niega —y ahí está la trampa: **que se niegue casi siempre es lo
que le da la apariencia de sonda**.

## Cómo se arregla

Para saber qué falta, **`bash .agent/sdd.sh status <ID>`**: dice los artefactos,
su estado, los ciclos, la última verificación y el próximo paso, y no escribe
nada. Y para las condiciones sueltas, cada una tiene su comando propio, todos
de solo lectura:

```bash
bash .agent/sdd.sh gate <ID>          # ¿está el plan firmado?
bash .agent/verify.sh pending <ID>    # ¿queda algún fallo sin ficha ni descarte?
grep -c '^- \[x\]' .agent/progress/<ID>.md   # ¿cuántos criterios marcados?
```

Si ya se ejecutó y el progreso se borró con el feature realmente listo, **no lo
reconstruyas**: el estado correcto de un feature cerrado es no tener progreso.
Comprueba que lo que importaba vive donde se conserva —`specs/<ID>/` y, si es
una decisión del humano, la nota del feature en `.agent/features.json`— y sigue.
Si se borró con el trabajo a medias, el progreso hay que reescribirlo, y
entonces lo honesto es decir que sale de la memoria de la sesión.

## Cuándo NO es esto

Un «no existe `progress/<ID>.md`» al **empezar** un feature no es esto: es un
feature sin empezar, y lo crea `bash .agent/sdd.sh new <ID>`. Tampoco lo es que
`done` se **niegue** con un motivo (falta el veredicto, faltan casillas, falta
la firma, falta un `visual.mjs`): eso es el guion haciendo su trabajo, y no
borra nada.

## Cómo se evita

Dos hábitos, y el segundo es del orquestador:

- **`done` se ejecuta una vez, a sabiendas, cuando ya se decidió cerrar.** Nunca
  para informarse.
- **El orquestador encarga las condiciones de cierre antes de encargar el
  cierre.** En F-039 faltó pedirle al probador el `visual.mjs` que `done` exige
  cuando `design.md` está en `listo`, y fue justo esa negativa la que llevó al
  probador a usar `done` como sonda. La sexta condición de cierre no está en la
  lista de cinco que cuenta el propio guion, así que hay que leerla en
  `.agent/sdd.sh` o descubrirla como aquí.
