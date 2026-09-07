---
slug: eslint-lintea-lo-que-gitignore-esconde
sintoma: la etapa lint falla con errores en archivos `_qa_*.js` de la raíz del repo que no aparecen en `git status` y que nadie de este ciclo escribió
firma: _qa_[^/]*\.js
etapa: lint
visto_en: F-035
creado: 2026-09-07T01:37:32Z
promovido_a_agents: no
arreglo: borra o aparta los `_qa_*.js` de la raíz (son de usar y tirar, `.gitignore:63`) y vuelve a ejecutar; el arreglo de fondo, si vuelven a estorbar, es añadir `"_qa_*.js"` al `globalIgnores([...])` de `eslint.config.mjs`
---

## Qué pasa de verdad

`.gitignore:62-63` reserva el prefijo `_qa_*.js` para «scripts de consulta a la
base local, de usar y tirar: se quedan en la máquina». Git los esconde, así que
`git status` sale limpio y nadie los ve — pero `eslint.config.mjs` no los tiene
en su `globalIgnores([...])`, y `npm run lint` sin argumentos recorre el
directorio entero. Un script de depuración de hace cuatro días, escrito con
`require()` porque es un `.js` suelto que se lanza con `node`, pone la etapa
`lint` en rojo con `@typescript-eslint/no-require-imports` **en un archivo que
no tiene nada que ver con el feature que se está verificando**.

Lo que hace perder el tiempo no es el error, que es obvio en cuanto se lee la
ruta: es que la firma (`lint:@typescript-eslint/no-require-imports`) apunta a
una regla de TypeScript y hace pensar en código del feature, y que `git status`
—el primer sitio donde uno mira para saber qué cambió— jura que no hay nada
nuevo. En F-035 el ciclo era de un agente que solo había escrito un `.md`: la
etapa `lint` no podía fallar por su trabajo, y aun así falló.

## Cómo se arregla

```bash
ls _qa_*.js          # confirma de qué archivos habla el log
rm _qa_*.js          # son de usar y tirar; si alguno hace falta, muévelo fuera del repo
bash .agent/verify.sh <F-NNN>
```

Si estos scripts son parte del flujo de trabajo de la máquina y van a volver,
el arreglo que cierra el hueco es una línea en `eslint.config.mjs`, dentro del
`globalIgnores([...])` que ya lista `.next/**`, `src/generated/**` y
`coverage/**`:

```js
"_qa_*.js",
```

Es la misma doctrina que ya aplican esas tres entradas: lo que no es código del
proyecto no se linta. Y deja `.gitignore` y `eslint.config.mjs` diciendo lo
mismo, que es lo que hoy no pasa.

## Cuándo NO es esto

Si el `no-require-imports` cae en un archivo bajo `src/` o `scripts/`, no es
esto: ahí `require()` sí es un error de verdad y hay que convertirlo a `import`.
La señal que distingue los dos casos es la **ruta** de la línea anterior al
error en el log, no la regla. Y si el log habla de `.next/**` o
`src/generated/**`, tampoco es esto: esos ya están ignorados, así que lo que
falla es otra cosa.

## Cómo se evita

Antes de dar por bueno un fallo de `lint` que no encaja con lo que acabas de
escribir, mira la **ruta** de cada error y pregúntate si es tuya. Un error en un
archivo que `git status` no menciona no es tuyo: o está ignorado (esta ficha) o
viene de `main`. Y al añadir un patrón nuevo a `.gitignore` para ficheros de
trabajo local, comprueba si el linter y el formateador también tienen que
ignorarlo — `eslint.config.mjs` y `.prettierignore` no leen `.gitignore`.
