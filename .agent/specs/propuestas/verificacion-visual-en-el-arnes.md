---
propuesta: verificacion-visual-en-el-arnes
agente: orquestador
actualizado: 2026-08-28T22:55:00Z
estado: resuelta
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

## Resuelto (2026-08-28)

Las tres preguntas se le pusieron al humano y esto es lo que decidió, todo por
la opción recomendada:

- **P1 — parte del arnés.** No hay `F-025`: los `V7`–`V22` viven en el propio
  `design.md` de F-010 (que ya los definía) y el mecanismo en `.agent/`, igual
  que el resto de la infraestructura de verificación.
- **P2 — job propio de CI, fuera de `--full`.** `.github/workflows/ci.yml`
  ahora tiene un job `visual` separado de `verify` (`needs: verify`), con su
  propio `npx playwright install --with-deps chromium` y capturas subidas como
  artifact si falla. El bucle local (`--full` sin `--visual`) no paga ese costo.
- **P3 — se tradujeron ahora.** `.agent/specs/F-010/visual.mjs` dejó de ser la
  plantilla: los 16 pasos `V7`–`V22` están escritos y `bash .agent/verify.sh
F-010 --visual` sale `PASA` (46 aserciones, 0 fallos, reproducido en más de
  diez corridas seguidas tras estabilizarlo — ver notas de F-010 en
  `features.json`).

Dos cosas se descubrieron traduciendo los pasos, no leyendo el código, y valen
la pena dejarlas aquí para la próxima vez que alguien escriba un `visual.mjs`:

1. **Estrangular la conexión entera con
   `Network.emulateNetworkConditions` no es fiable contra `next dev`** — el
   HMR y los chunks de compilación se estrangulan con todo lo demás y el
   tiempo hasta `domcontentloaded` deja de ser predecible (se midió más de
   10s sin resolver con un perfil de 4s de latencia). Interceptar con
   `page.route()` solo la petición que a la app le importa (la cotización)
   da el mismo efecto observable y es determinista.
2. **`getComputedStyle(...).color` no devuelve `rgb()` en esta app** — los
   tokens están en OKLCH y Tailwind v4 resuelve las variantes de opacidad con
   `color-mix()`; Chromium lo serializa en `lab()`/`oklab()`. Un parser que
   solo entienda `rgba?(...)` falla en silencio con cualquier color real, sin
   que reintentar arregle nada (parecía una condición de carrera y no lo era).
   Pintar el color en un canvas de 1×1 y leer el píxel con `getImageData`
   normaliza cualquier color CSS a RGBA sin tener que parsear su sintaxis.
