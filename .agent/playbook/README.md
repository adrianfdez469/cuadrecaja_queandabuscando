# Bitácora de problemas

Lo que ya nos mordió una vez, con su arreglo. Una ficha por problema.

A diferencia de `progress/<id>.md` —que se **borra** al cerrar el feature— esta
carpeta se conserva y se commitea: es la única memoria del arnés que sobrevive
al feature que la produjo.

## Cómo se consulta

No se consulta a mano. `bash .agent/verify.sh` la consulta por ti: cuando una
etapa falla, cruza la salida del error contra el campo `firma` de cada ficha e
imprime las que reconocen ese fallo, con su arreglo, antes de que improvises uno.

Para buscar por texto —un síntoma que aún no ha fallado, algo que recuerdas a
medias— `bash .agent/sdd.sh playbook <texto>`.

## Cómo se escribe

```bash
bash .agent/sdd.sh learn pooler-transaccion-deadlock
```

Copia `TEMPLATE.md` y te deja rellenarla. Los campos que hacen el trabajo:

| Campo      | Para qué                                                                |
| ---------- | ----------------------------------------------------------------------- |
| `firma`    | ERE que se busca en el log del fallo. `—` si no hay forma de detectarlo |
| `arreglo`  | Una línea imperativa. Es lo que `verify.sh` imprime al reconocerlo      |
| `etapa`    | Dónde se manifiesta: una etapa del sensor, o `review`                   |
| `visto_en` | En qué features mordió. Lo **escribe el sensor**, no tú                 |

Una ficha sin `arreglo` concreto no es una ficha: es una queja. Si el arreglo
todavía es «depende», acábala antes de guardarla.

## La firma pesca de más, a propósito

`firma` es una expresión regular contra el log entero, no una igualdad.
Preferimos sugerir una ficha de sobra —que el agente lee y descarta en diez
segundos— a no sugerir la que habría ahorrado media hora. Por eso cada ficha
lleva una sección **«Cuándo NO es esto»**: es lo que hace barato el falso
positivo.

## Qué entra y qué no

Entra lo que **volverá a pasar**: una trampa del stack, una restricción de
infraestructura, una convención que el CI impone y nada explica.

No entra lo que pasó una vez por descuido —un typo, un puerto ocupado, un
`import` mal escrito—. Eso se descarta diciéndolo:

```bash
bash .agent/verify.sh dismiss F-007 '<firma>' 'typo en el nombre del campo'
```

`sdd.sh done` no cierra un feature mientras queden fallos que no estén ni
explicados por una ficha ni descartados. Es a propósito: el momento de escribir
la lección es cuando todavía se recuerda.

## Cuando una ficha se repite

`visto_en` va acumulando los features en los que mordió cada trampa. En cuanto
son dos o más, la ficha es candidata a subir a `AGENTS.md` § «Cosas que muerden»
—que es la bitácora que se lee **antes** de fallar— y a marcarse aquí como
`promovido_a_agents: sí`. `bash .agent/sdd.sh playbook` lo lista: la columna
`→AG` dice cuáles ya subieron, y marca en amarillo las que deberían.

Las fichas que ya nacieron promovidas vienen de esa sección: esto empezó
copiando lo que el repo ya sabía.
