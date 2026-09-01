---
slug: next-dev-uno-por-directorio
sintoma: "una etapa que levanta la app (smoke, visual) falla porque el servidor no llegó a levantar, y el log del servidor dice que ya hay otro next dev corriendo"
firma: Another next dev server is already running
etapa: smoke | visual
visto_en: F-010, F-018, F-012, F-020
creado: 2026-08-26T10:36:00Z
promovido_a_agents: sí
arreglo: no lances otro; reutiliza el que ya corre en este directorio — verify.sh lo hace solo con servidor_propio(), y si el fallo persiste es que el puerto lo ocupa OTRO checkout
---

## Qué pasa de verdad

Next 16 admite **un solo `next dev` por directorio**, y no lo decide por el
puerto: lo decide por el directorio. Levantar un segundo con `-p 3101` mientras
ya hay uno en el 3057 no arranca dos servidores en dos puertos — el segundo
muere imprimiendo el puerto y el PID del primero.

El sensor solo veía el síntoma de fuera («el servidor de desarrollo no llegó a
levantar») porque la causa la escribía el servidor en su propio log, que se pega
al final del feedback. Si no se lee hasta abajo, parece que Next está roto.

## Cómo se arregla

1. **No lances otro servidor: reutiliza el que hay.** `verify.sh` ya lo hace:
   `servidor_propio()` busca un `next-server` cuyo **cwd sea este directorio** y
   devuelve su puerto. Es lo correcto además de lo que funciona — es el servidor
   que el humano está mirando en su navegador.

   Hasta F-020 esto solo lo hacía `correr_visual`; `correr_smoke` lanzaba
   siempre el suyo. La asimetría no se notó mientras hubo **una** etapa smoke
   por trabajo de CI, y se pagó al haber dos (F-028 y F-020 en el trabajo
   `auth`): la segunda no podía levantar nada. Ahora las dos reutilizan.

   **Cambiar el puerto no arregla esto** — es el error que se cometió primero.
   Next lo decide por el **directorio**, así que `SMOKE_PORT=3102` muere igual,
   y solo cambia el mensaje: en vez de `EADDRINUSE` sale «Another next dev
   server is already running» con el PID y el `Dir:` del primero.

2. **En CI, la reutilización no se activa: ciérralo tú.** `servidor_propio()` y
   `puerto_libre()` preguntan las dos a `lsof`, y en el runner de GitHub
   ninguna vio el servidor que la etapa anterior dejó escuchando. El resultado
   fue el peor posible: `next dev` murió con `EADDRINUSE` mientras el guion de
   runtime corría contra el servidor del OTRO feature y asertaba
   `0 aserciones fallidas` — solo el guardián de errores de servidor lo puso
   rojo. Por eso `.github/workflows/ci.yml` **no depende de detectar nada**:
   entre dos etapas smoke mata el servidor anterior y comprueba con `curl` que
   el puerto dejó de responder, fallando ruidosamente si no.

3. Si aun así falla, el puerto lo ocupa **otro** proceso. Eso es distinto y peor:
   ver § «Cuándo NO es esto».

## Cuándo NO es esto

Si el mensaje del log no es «Another next dev server…» sino que la etapa dice
que **el puerto ya está ocupado por el PID N**, no es este caso: hay un servidor
ajeno escuchando ahí. Eso lo pesca `puerto_libre()`, que falla **antes** de
levantar nada, y por un motivo mucho más grave que la comodidad: en esta máquina
hay varios checkouts del mismo repo, y un `next dev` del checkout de al lado
sirve código distinto. Probar contra él sale **verde** y hace creer que un
feature entero no se implementó. Pasó de verdad en F-010: había un `next dev` del
checkout principal en el 3000 y el trabajo estaba en el 3057.

La lección que vale para cualquier etapa que hable con un servidor: **comprobar
que el servidor que responde es el tuyo.** Verde contra la aplicación equivocada
es la peor salida posible del sensor, porque es indistinguible de verde de
verdad.

## Cómo se evita

Antes de levantar nada, saber qué hay levantado:

```bash
lsof -Pan -i TCP -sTCP:LISTEN | grep -i node
```

Y para saber de qué directorio sale cada uno, que es lo que de verdad importa:

```bash
lsof -a -p <PID> -d cwd -Fn
```
