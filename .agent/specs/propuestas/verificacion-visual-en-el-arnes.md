---
propuesta: verificacion-visual-en-el-arnes
agente: orquestador
actualizado: 2026-08-26T10:45:00Z
estado: propuesta
---

## Problema

F-010 se cerró con sus 22 pasos de verificación visual **sin ejecutar**, y el
motivo no fue descuido de nadie: era estructural.

- `sdd-designer` tenía las herramientas de Chrome, pero dependen de que un humano
  conecte la extensión. No estaba conectada.
- `sdd-tester` —el agente al que el orquestador mandó los pasos— tenía
  `tools: Read, Write, Edit, Bash`. **Cero capacidad de navegador.** No es que
  fallara: no tenía con qué. Habría sido igual con Chrome perfectamente conectado.
- Y nada lo impedía: `sdd.sh done` comprobaba cinco cosas y ninguna era «alguien
  miró la interfaz».

Un feature con pantallas que nadie vio no está terminado, está sin comprobar. El
agujero no era que se olvidara: era que no había forma de que no se olvidara.

## Lo que ya se hizo (2026-08-26)

Esto ya está implementado y verificado; queda aquí escrito para que el humano
decida si lo convierte en feature con criterios propios o lo deja como parte del
arnés.

- **Etapa `visual` en `.agent/verify.sh`** — levanta la app y le entrega las
  pantallas a un Chromium headless que maneja `.agent/specs/<ID>/visual.mjs`.
  Bandera `--visual`. Headless y por Bash a propósito: la extensión de Chrome
  necesita un humano, no existe en CI y no se repite entre sesiones; esto lo corre
  cualquier agente, porque todos tienen `Bash`.
- **Falta el guion → la etapa está en ROJO**, no «sin comprobar». Misma regla que
  `smoke`: verde sin ejecutar nada es peor que rojo.
- **Plantilla `.agent/templates/visual.mjs`** con lo que `curl` no puede ver:
  desbordamiento horizontal a 360 px, desplazamiento de contenido al hidratar,
  etiquetas accesibles de los campos, errores de consola del navegador como
  fallos, y una captura por paso en `.agent/runs/<ID>/shots/`.
- **Puerta en `sdd.sh done`** — si `design.md` está en `listo` (que es lo que
  declara que el feature tiene pantallas), no se cierra sin que la etapa `visual`
  haya salido `PASA` alguna vez. Es lo que convierte «se nos olvidó» en imposible.
- **`sdd-tester` recibió las herramientas de Chrome**, para el repaso con ojos que
  ninguna aserción sustituye. La etapa headless y el repaso humano son
  complementarios: una detecta regresiones, el otro detecta que algo está feo.
- **`servidor_propio()`** — Next 16 admite un solo `next dev` por directorio, así
  que la etapa reutiliza el que ya corre en este worktree en vez de morir.
  Ficha: `.agent/playbook/next-dev-uno-por-directorio.md`.
- **`puerto_libre()`** — falla ANTES de levantar nada si el puerto está ocupado.
  Esto salió de un susto real: había un `next dev` de **otro checkout** del mismo
  repo en el 3000, y probar contra él sale **verde** y hace creer que un feature
  entero no se implementó. Verde contra la aplicación equivocada es la peor salida
  posible del sensor, porque es indistinguible de verde de verdad.
- **El journal apunta las etapas que corrieron**, no un `todas` que no decía nada.
  Sin eso, la puerta no puede saber si `visual` llegó a ejecutarse.

## Lo que falta, y es la mitad del trabajo

`.agent/specs/F-010/visual.mjs` **es todavía la plantilla**, no los pasos de
F-010. Traducir los `V7`–`V22` de su `design.md` —el estado de carga del carrito,
Slow 4G, Offline con «Continuar de todos modos», el rebote de la recotización, el
foco del formulario de checkout— es lo que haría que este mecanismo cubra el
feature que lo motivó, en vez de solo demostrar que funciona.

Hasta que eso esté, la etapa pasa comprobando el catálogo, que es real pero es
poco.

## Preguntas al humano

- **P1** — ¿Esto es un feature de `features.json` con sus `acceptance_criteria`, o
  parte del arnés que no se versiona como producto? El arnés hasta ahora ha
  crecido sin ser feature; esto es más grande que lo habitual.
- **P2** — ¿La etapa `visual` entra en `--full` (y por tanto en el CI), o se queda
  como bandera aparte? En CI hace falta `npx playwright install chromium`, que
  añade ~1–2 min y unos 150 MB de descarga cacheable. Recomiendo que **no** entre
  en `--full` y sí en un job propio del CI, para no encarecer el bucle local que
  los agentes corren decenas de veces.
- **P3** — ¿Se traducen los `V7`–`V22` de F-010 ahora, reabriendo el feature, o se
  quedan como deuda anotada en sus `notes`?
