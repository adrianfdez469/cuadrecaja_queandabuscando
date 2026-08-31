---
name: pr
description: Deja el trabajo del árbol listo para revisar — agrupa los cambios en commits, abre el PR y espera al CI para entregarlo ya con veredicto. NO hace merge: eso lo decide el humano. Úsalo cuando el trabajo está terminado y verificado, no para guardar avances a medias. Invocable como /pr o /pr "F-025".
---

# Dejarlo listo para revisar

Este skill **termina en el PR**, con el CI ya resuelto. **No hace merge, nunca**,
ni siquiera con los tres trabajos en verde.

No es una precaución genérica, es la forma de este repositorio: `main` despliega
a Vercel, así que mergear no es integrar, es **publicar en producción**. Y `main`
no está protegido, así que no hay nada entre el merge y los usuarios: ni revisión
obligatoria, ni comprobación de estado, ni una segunda persona. Un `git revert`
arregla el código pero no deshace una migración aplicada, ni un contrato ya
publicado al otro equipo, ni un correo enviado. Ese botón es del humano.

Lo que sí hace este skill es que, cuando el humano llegue a ese botón, **ya no
quede nada por averiguar**: commits legibles, PR que explica qué cambia, y el CI
en verde o el fallo concreto en la mano.

Esto no es `/fix` ni `/sdd`. `/sdd` construye, `/fix` repara, esto **entrega lo
que ya está hecho y verificado**. Si al empezar descubres que el trabajo no está
terminado, para y dilo: un PR a medias es peor que ninguno.

## 0. Mirar antes de tocar

```bash
git status --porcelain          # qué hay sin commitear
git branch --show-current       # dónde estás
git log --oneline origin/main..HEAD   # qué llevas por delante de main
gh pr status                    # ¿ya hay un PR de esta rama?
```

Tres cosas que **paran el flujo** y se preguntan al humano:

- **Estás en `main`.** No se commitea en `main` ni se empuja a `main`
  directamente. Crea rama y sigue.
- **Hay cambios que no son tuyos.** Si `git status` trae archivos que no
  reconoces de este trabajo, no los arrastres al PR. Enséñalos y pregunta.
- **Ya hay un PR abierto para esta rama.** Entonces no se crea otro: se le
  añaden commits y se salta al paso 4.

En este repositorio se trabaja con **varios worktrees a la vez**. La pila de
`git stash` es compartida entre todos, así que nada de `git stash` / `git stash
pop` a secas: te puedes llevar el trabajo de otra sesión. Si necesitas apartar
algo, un commit temporal.

## 1. El sensor local, antes de empujar nada

El CI tarda minutos en decirte lo que el sensor te dice en segundos, y encima te
lo dice en público. Primero en local:

```bash
npm run format                  # SIEMPRE, y antes que nada
bash .agent/verify.sh --full    # harness · typecheck · lint · format · test · prisma · build · theme · bundle
```

`npm run format` va primero **a propósito**, y es la línea que más veces ha
salvado un CI en este repositorio. El hook de pre-commit corre `lint-staged`, que
solo formatea **lo que ya está en el índice**; un archivo recién escrito y sin
añadir no pasa por el hook, y la etapa `format` se limita a decir que está crudo.
La ficha `.agent/playbook/prettier-sin-formatear.md` lleva **catorce entradas**
en su `visto_en` por esto exactamente, trece features y un PR.

Con una excepción que importa: **no formatees a ciegas prosa ajena.** Prettier
convierte en viñeta cualquier línea de continuación que empiece por `-`, `+` o
`*`, y eso **cambia lo que dice la frase**. Si `npm run format` tocó documentos
que tú no escribiste, mira el diff línea a línea antes de dar el paso por bueno
(`.agent/playbook/prettier-write-reescribe-prosa-ajena.md`).

Si el sensor sale `1`, esto no es tu trabajo: es `/fix`. Arregla y vuelve.
Si sale `2` (`ESTANCADO`), tampoco: sube el problema al humano.

**Y el sensor verde no es el CI verde.** Hay tres cosas que solo se ven allí, y
conviene saberlo antes de que te sorprendan:

- `prisma migrate deploy` contra una base vacía, y el **seed ejecutado dos
  veces** para probar que es idempotente. El sensor local no los corre.
- La etapa `visual` del CI está clavada a **F-010**
  (`.github/workflows/ci.yml`), así que la verificación visual de tu feature
  **no corre en el CI**. Si tu trabajo tiene un guion visual propio, córrelo tú:
  `bash .agent/verify.sh F-NNN --visual`.
- El trabajo `auth`, que levanta los emuladores de Storage y Auth.

Si tu cambio toca `prisma/`, el seed, o algo que dependa de los emuladores, ahí
es donde te va a fallar.

## 2. Commits: uno por unidad coherente

Conventional Commits, **en inglés** (`AGENTS.md` § Idioma: código, ramas y
mensajes de commit en inglés; la UI y la documentación en español). Los tipos que
usa el repositorio: `feat:`, `fix:`, `refactor:`, `docs:`, `style:`, `chore:`,
`test:`.

Agrupa por **intención, no por carpeta**. Un feature típico de este repositorio
sale en tres o cuatro commits, y así es como se leen los que ya están:

```
feat(catalog): browse a store by category, with a page of its own
docs(agent): F-026 spec, architecture, design, plan, impl, tests and smoke
test(catalog): run design.md's visual steps instead of reading them
fix(catalog): let the keyboard reach every category chip, in CSS
```

O sea: el código de producto por un lado, los artefactos de `.agent/` por otro,
las pruebas por otro. Lo que **no** se hace es un único commit «F-NNN» con
sesenta archivos dentro.

Dos detalles que este repositorio tiene y otros no:

- **El bloque `nextjs-agent-rules` de `AGENTS.md` lo reescribe `next dev`.**
  Si aparece en tu diff, **commitéalo con tu trabajo**. Quitarlo del diff solo
  hace que vuelva a aparecer como cambio sin commitear.
- **`.agent/progress/<ID>.md` se borra al cerrar un feature.** Ese borrado va en
  el commit, y es correcto: `.agent/specs/<ID>/` es lo que se conserva.

Antes de dar por buenos los commits, **lee el diff**, no solo la lista de
archivos:

```bash
git add -A && git status --short
git diff --cached --stat
git diff --cached          # de verdad, léelo
```

## 3. Rama y empuje

Si ya estás en una rama de trabajo, se usa esa. Si no, se crea: el repositorio
usa `<usuario>/<descripción-corta>` (`adrianfdez469/pick-feature-backlog`),
aunque `AGENTS.md` § Git escriba el patrón antiguo `feature/descripcion`. En
inglés, y describiendo el trabajo, no el número.

```bash
git push -u origin "$(git branch --show-current)"
```

**Nunca `--force`.** Si el empuje se rechaza, para: alguien más tocó esa rama y
eso es una conversación, no un flag.

## 4. El PR

```bash
gh pr create --title "..." --body "..."
```

El título, como los que ya hay: `F-025: rastro de navegación en la tienda` para
un feature, o el propio mensaje de commit para un cambio suelto. El cuerpo tiene
que responder tres preguntas, y ninguna es «qué archivos cambiaron» —eso ya lo
enseña GitHub:

1. **Qué puede hacer alguien ahora que antes no podía.** En el idioma del
   humano, no en el del código.
2. **Cómo se verificó.** Los comandos que se ejecutaron y su resultado. Si es un
   feature, la línea de `tests.md` que dice `veredicto: listo` y cuántos
   criterios pasaron.
3. **Qué queda fuera**, y qué decisiones tomó el humano por el camino. Sale de
   `plan.md` § Qué queda fuera y de § Decisiones tomadas del progreso.

Si el trabajo es un feature del backlog, enlaza sus artefactos: `.agent/specs/`
sobrevive al cierre justamente para esto.

## 5. Esperar al CI

```bash
gh pr checks --watch
```

Se queda mirando hasta que terminan los tres trabajos —`verify`, `visual` y
`auth`— y sale distinto de cero si alguno falla. Espera de verdad: no declares
nada mientras siga corriendo.

**Si sale rojo, no se entrega como listo y no se reintenta a ciegas.** Un PR en
rojo que se pasa al humano diciendo «ya está» le hace perder el tiempo dos veces.
Un CI rojo es un fallo concreto y tiene su bucle, que es `/fix`:

```bash
gh run view --log-failed        # el error crudo, no el resumen
bash .agent/sdd.sh playbook     # ¿ya nos pasó? Búscalo por el síntoma
```

Arregla, commitea, empuja, y el CI se vuelve a lanzar solo. Si el mismo trabajo
falla tres veces con el mismo error, para: eso es `ESTANCADO` y la decisión ya
no es tuya. Y si el fallo enseñó algo que volverá a pasar, deja la ficha antes de
seguir (`bash .agent/sdd.sh learn <slug>`).

## 6. Entregar, y parar

Aquí se acaba el trabajo del skill. **No ejecutes `gh pr merge`.** Lo que se
entrega al humano son cuatro líneas, no un informe:

1. **El número y la URL del PR.**
2. **El estado del CI**, dicho como está: los tres trabajos en verde, o cuál
   falló y con qué error.
3. **Qué se commiteó**, en una línea por commit.
4. **Lo que tiene que mirar antes de mergear**, si el diff toca alguna de las
   tres cosas de abajo.

Esas tres son las que un `git revert` **no** deshace, y por eso se nombran
explícitamente en vez de dejar que las descubra al leer el diff:

- **Una migración en `prisma/migrations/`.** Revertir el código no revierte la
  base. Comprueba además que el paso quedó escrito en `docs/despliegue.md`, en
  este mismo ciclo, y dilo si no está.
- **Un cambio en `docs/sync-contract.md`.** Hay otro equipo al otro lado: el
  contrato se coordina con ellos antes, no se publica y se avisa después.
- **Un paso operativo nuevo** —un secreto, un cron de `vercel.json`, un bucket,
  una regla de plataforma—. Va en `docs/despliegue.md` en el mismo ciclo que lo
  introduce, porque es justo lo que ningún sensor comprueba.

Si no toca ninguna, dilo también: «nada que requiera un paso manual» es
información útil, y es lo que permite mergear sin releer el diff entero.

Cuando el humano mergee, `main` despliega a Vercel. Si te pide que lo hagas tú,
eso es una instrucción suya en ese momento —y entonces se usa `gh pr merge
--merge`, no `--squash`, porque el historial de este repositorio son commits de
merge y los individuales se conservan—. Lo que no ocurre es que este flujo lo
haga por su cuenta.

## Lo que este skill no hace nunca

- **Empujar a `main` directamente**, ni commitear estando en `main`.
- **`git push --force`**, sobre ninguna rama.
- **Mergear.** Ni en verde, ni «porque es un cambio pequeño», ni con
  `--admin`. El merge publica en producción y lo decide el humano. La única
  excepción es que te lo pida él, en ese momento y para ese PR.
- **Dar el CI por bueno sin haberlo esperado.** «Es solo el formato» también es
  rojo.
- **Tocar `.agent/features.json`** para marcar nada como hecho: `"passes": true`
  lo escribe el humano (regla 3 y 4 del backlog).
- **Arrastrar al PR cambios que no son del trabajo en curso.**
