---
feature: F-030
agente: orquestador
actualizado: 2026-09-02T00:29:25Z
estado: listo
aprobado: sí
---

## Qué se va a construir

Hoy, cuando un comprador con sesión iniciada hace un pedido y el servidor no
consigue averiguar quién es a tiempo, el pedido se crea igual pero **sin
enlazar a su cuenta**, y eso no deja ningún rastro: queda idéntico a un pedido
de invitado. Después de este ciclo seguirá pasando exactamente lo mismo —eso es
lo correcto, resolver la identidad nunca puede impedir una venta— pero **quedará
escrito**, con qué pasó y cuánto tardó, en la salida del servidor. Además avisará
antes de que empiece a fallar, cuando la consulta ya va lenta pero todavía llega.

Lo que **no** cambia: el comprador no ve nada nuevo, la respuesta HTTP es la
misma byte a byte, el POS recibe el mismo pedido, no hay pantalla nueva, ni tabla
nueva, ni dependencia nueva, ni un kilobyte más de JavaScript en el navegador.

## Pasos

| Nº  | Qué se hace                                                                                                                                                                                                                          | Archivos                                                                                                         | Criterio que acerca | Cómo se verifica                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 1   | El umbral de aviso (300 ms) y los seis desenlaces, como objeto `as const` con su tipo derivado. `ORDER_CUSTOMER_LINK_TIMEOUT_MS` no se toca.                                                                                         | `src/constants/account.ts`                                                                                       | 4, 6                | `bash .agent/verify.sh F-030` en 0                                                                                 |
| 2   | El módulo que observa y emite: reloj monótono, la regla de qué desenlace es cuál, la única llamada a `console.warn` con el prefijo `[orders] customer link`, y la programación de la línea tardía. Nunca lanza, nunca lleva PII.     | src/features/account/server/orderLinkObserver.ts (por crear)                                                     | 1–5, 10             | `bash .agent/verify.sh F-030` en 0                                                                                 |
| 3   | Enganchar el observador en la resolución: misma firma, mismo techo, mismo `Promise.race`. La rama perdedora se neutraliza al crearla, para que un rechazo tardío sea imposible. Corte por cookie primero, por configuración después. | `src/features/account/server/orderIdentity.ts`                                                                   | 1–5, 7, 9           | `bash .agent/verify.sh F-030` en 0                                                                                 |
| 4   | Los nueve casos unitarios, uno por desenlace más los dos de «cero líneas», espiando `console.warn`. Sin Docker, sin red.                                                                                                             | `src/features/account/server/orderIdentity.test.ts`                                                              | 6, 7, 9             | `npx vitest run src/features/account/server/orderIdentity.test.ts` en 0                                            |
| 5   | El guion que provoca el fallo de verdad: proxy lento delante del Auth de F-028, su propio servidor, las siete corridas A–G y la limpieza de lo que creó.                                                                             | scripts/order-link-probe.mjs (por crear)                                                                         | 1–5, 9, 10          | `node scripts/order-link-probe.mjs` en 0                                                                           |
| 6   | La etapa `--probe` del sensor: comprueba precondiciones, pasa puerto y archivo de salida al guion, aplica el guardián de errores y exige que el puerto quede libre al terminar.                                                      | `.agent/verify.sh`                                                                                               | 1–5, 9, 10          | `bash .agent/verify.sh F-030 --probe` en 0                                                                         |
| 7   | Dejar escrita la lección: `visual` y `probe` como etapas válidas de una ficha, la convención de registro en las convenciones del repo, y la ficha del playbook.                                                                      | `.agent/playbook/TEMPLATE.md`, `AGENTS.md`, una ficha nueva en `.agent/playbook/` con `bash .agent/sdd.sh learn` | —                   | `npm run check:harness` en 0 y `npm run format:check` en 0                                                         |
| 8   | Cierre: la suite entera, el build, el presupuesto de JavaScript y que F-010 y F-012 sigan intactos pese a las líneas nuevas.                                                                                                         | ninguno                                                                                                          | 8, 11, 12           | `bash .agent/verify.sh F-030 --full` en 0, `bash .agent/verify.sh F-012 --smoke` en 0, `npm run check:bundle` en 0 |

Los pasos 1–4 son un solo ciclo del implementador: el 4 es lo que demuestra que
los tres anteriores hacen lo que dicen. Los pasos 5–6 son el segundo ciclo y van
juntos porque el guion y su etapa se verifican el uno al otro. El 7 y el 8 cierran.

## De dónde sale cada paso

| Paso | Sale de                                                                                                                     |
| ---- | --------------------------------------------------------------------------------------------------------------------------- |
| 1    | `architecture.md` § Contratos → «Constantes nuevas» y DA3; `spec.md` § Datos y contrato → «Constantes»                      |
| 2    | `architecture.md` DA1, DA4, DA9 y § Contratos → «El observador»; `spec.md` R1–R3, R9, R10                                   |
| 3    | `architecture.md` DA2, DA5 y § Contratos → «`resolveOrderCustomerId()` — la forma, no el código»; `spec.md` R4, R5, R11–R13 |
| 4    | `spec.md` § «Mitad determinista, en CI» (la tabla de nueve casos); criterio 6 del feature                                   |
| 5    | `architecture.md` DA7 y § «El guion»; `spec.md` § «Mitad de verdad, contra el Auth real de F-028» (corridas A–G)            |
| 6    | `architecture.md` DA6 y § Contratos → «La etapa `probe`»; `spec.md` I5; decisión del humano del 2026-09-01                  |
| 7    | `architecture.md` DA10 y § «¿Hace falta una ADR?»; `spec.md` I6; `AGENTS.md` § Documentación                                |
| 8    | Criterios 8, 11 y 12 del feature; `architecture.md` § Riesgos, riesgo 4                                                     |

Ningún paso se inventó alcance: los ocho salen de una línea concreta de la spec
o de la arquitectura.

## Qué queda fuera

- **Cambiar el techo de 600 ms o el mecanismo que lo aplica.** Este feature
  MIDE, no cambia. Lo fijan las `notes` del propio feature.
- **Enlazar el pedido a la cuenta después de responder** (o por cualquier otra
  vía alternativa). Es lo que preguntaste el 2026-09-01; queda fuera y, si entra,
  entra como feature nuevo que decides tú. Por decisión tuya del 2026-09-01, no
  se escribe ni la propuesta.
- **Guardar las observaciones en la base de datos.** Se quedan en la salida del
  servidor. Es el escalón siguiente si el número deja de ser cero.
- **Avisar a alguien.** No hay alerta, ni panel, ni recogida de logs. El fallo
  pasa a ser contable **cuando alguien mira**, no avisable. Dicho sin adornos:
  un fallo a las tres de la madrugada queda escrito y, si el despliegue rota sus
  logs antes de que alguien entre, se pierde.
- **Un job de CI para el guion que provoca el fallo.** Decisión tuya del
  2026-09-01: es una etapa del sensor que se pide a mano. La mitad determinista
  (los nueve casos unitarios) sí corre en CI dentro de `npm test`.
- **Arreglar el token caducado en el checkout** (paga dos viajes a Auth dentro
  del mismo techo, porque el proxy solo refresca en `/cuenta*` y `/auth*`). Es
  el caso con más probabilidad de agotar los 600 ms y este feature lo hará
  visible por primera vez, pero tocar el `matcher` del proxy es el error más
  caro del repo: primero medir, luego decidir.
- **Instrumentar los otros tres caminos que también consultan a Auth**
  (`/cuenta`, la edición de perfil, el autocompletado del checkout). Ninguno
  tiene a la vez presupuesto de tiempo y consecuencia silenciosa.
- **Poder cruzar cada línea con su pedido.** La resolución empieza antes de leer
  el cuerpo, así que cuando la línea se escribe el pedido todavía no tiene
  código. Las líneas se **cuentan**, no se cruzan (cerrado en DA8).

## Riesgos y plan B

- **Ninguna migración, ningún cambio en el contrato con cuadrecaja, ningún
  comando prohibido.** `prisma/schema.prisma`, `docs/sync-contract.md` y
  `package.json` no se tocan. No hay nada aquí que aprobar de pasada.
- **El riesgo real: durante una caída de Auth, la petición podría quedarse viva
  más tiempo del debido.** Para escribir la línea tardía hay que esperar a que
  la consulta que perdió la carrera termine, y la ruta de pedidos no tiene hoy
  un tope de duración. Si Auth se cae con conexiones que se cuelgan en vez de
  fallar, invocaciones de un segundo pasan a durar decenas. Se notaría en la
  factura de la plataforma, no en un error. Plan B, dos salidas de una línea
  cada una: poner un tope de duración a la ruta, o quitar la espera y aceptar
  perder la línea tardía en producción (que la spec ya acepta como pérdida
  tolerable). Ninguna toca el instrumento.
- **El guion podría dejar un servidor de desarrollo colgado**, y eso rompería la
  verificación de cualquier otro feature con un mensaje que no dice la causa.
  Mitigado dos veces: limpieza pase lo que pase dentro del guion, y comprobación
  en el sensor de que el puerto volvió a quedar libre.
- **La verificación de F-012 empezará a imprimir una línea nueva por corrida**
  (manda una cookie basura a propósito). Es consecuencia buscada y no la pone en
  rojo, porque es un aviso y no un error. El criterio 8 lo comprueba ejecutando
  esa verificación.
- **El criterio 7, leído al pie de la letra, no es medible** en el servidor de
  desarrollo: la primera petición compila y ya se pasa del tiempo que menciona,
  sin que nada vaya mal. El criterio no se toca (regla 3); se mide donde sí
  significa algo: en la propia resolución de identidad, y como diferencia contra
  una corrida de control ya calentada. Si quieres el aserto literal sobre HTTP,
  hace falta un criterio nuevo — y eso lo escribes tú (PP1).

## Coste

- **Tres ciclos de agente**: implementador (pasos 1–4), implementador (5–7),
  probador (8 y el veredicto). Más los ciclos de verificación que cada uno corra
  solo.
- **Código de producto: unas 40 líneas** repartidas en dos archivos, más un
  archivo nuevo de instrumentación. El grueso del trabajo no es el instrumento:
  es el guion que demuestra que se dispara.
- **De lo que ya funciona se toca una sola función**,
  `resolveOrderCustomerId()`, conservando su firma, su techo y su mecanismo. La
  ruta de pedidos y la creación del pedido **no se tocan**.
- **Marcha atrás**: `git revert` del ciclo y ya está. No hay migración que
  deshacer, ni datos que recuperar, ni nada desplegado que avisar. El feature es
  aditivo de principio a fin.

## Preguntas antes de aprobar

**PP1 — el criterio 7.** Dice «con la resolucion colgada, el pedido responde por
debajo del techo mas 100 ms». Leído sobre la petición HTTP completa no es
medible en el servidor de desarrollo (la compilación de la primera petición ya
se lo come). El plan lo verifica donde sí significa algo: la resolución de
identidad por debajo de 700 ms en la prueba unitaria, y en el guion como
diferencia contra una corrida de control ya calentada.

- **(a) Adelante así (recomendado).** El criterio no se toca —la regla 3 lo
  protege— y se verifica donde mide lo que este feature controla.
- **(b) Quiero además el aserto literal sobre HTTP.** Entonces hace falta un
  criterio **nuevo** que fije su entorno de medida (build de producción, ruta ya
  caliente), y ese lo escribes tú en `.agent/features.json`: la regla 4 me
  impide añadirlo.

**RESUELTA el 2026-09-01: (a).** El humano eligió «Medirlo donde sí significa
algo». El criterio 7 **no se toca** y no se añade ninguno nuevo. Queda verificado
por el caso unitario de la resolución colgada
(`resolveOrderCustomerId()` por debajo de `ORDER_CUSTOMER_LINK_TIMEOUT_MS + 100`)
y por el caso de invitado con cero llamadas a Auth y a Prisma; en el guion,
además, como diferencia contra la corrida de control ya calentada. No queda
ninguna pregunta abierta: el plan se puede firmar.

## Aprobación

<!-- Lo escribe `bash .agent/sdd.sh approve F-030 '<lo que dijo el humano>'`.
     No se edita a mano, y esta sección se queda al final del archivo: la firma
     se añade al pie. -->

- 2026-09-02T00:29:25Z — aprobado por el humano: «Medirlo donde sí significa algo (PP1). Apruebo, adelante con los ocho pasos.»
