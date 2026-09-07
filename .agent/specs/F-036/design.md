---
feature: F-036
agente: orquestador
actualizado: 2026-09-07T04:20:00Z
estado: no aplica
---

## No aplica

F-036 no construye ni retoca ninguna pantalla. Cambia **qué fila se considera
vigente** al leer `ExchangeRate`: hoy la última que llegó, después la de
`sourceUpdatedAt` mayor. Todo el feature vive entre `prisma/schema.prisma`, una
migración, `src/features/catalog/server/queries.ts` y
`src/features/orders/server/quote.ts`. No hay ruta nueva, ni componente, ni
estado de cliente, ni token de tema que decidir.

**Que el importe en pantalla cambie no lo convierte en diseño.** Lo que este
feature altera es el **número** que sale de una consulta, no cómo se pinta:
la tipografía del precio, su posición, el formato de la moneda y su
comportamiento sin JavaScript ya los fijaron F-004, F-021 y F-027, y ninguno
se toca aquí. El comprador no ve una pantalla distinta; ve la cifra correcta
donde antes podía ver una resucitada.

**Y el caso que más se parece a un problema de diseño no lo es.** Cuando el
importe cambia porque llegó una tasa más nueva, el comprador que tenía la
página abierta no recibe ningún aviso — igual que hoy. Avisarle sí sería una
pantalla (un cartel en la vitrina, un «la tasa se actualizó» en el carrito), y
eso está **fuera** de este feature y del anterior: sería uno nuevo que escribe
el humano en `.agent/features.json`. Lo mismo vale para el otro lado del
mostrador: que el encargado vea en algún sitio que un evento llegó rancio y no
se aplicó como vigente es una pantalla **de cuadrecaja**, no de aquí, y la
regla ② del contrato ya dice que el rancio responde `processed` sin señal
propia.

Consecuencias que quedan anotadas para que nadie las busque en un documento de
diseño que no existe:

- **El presupuesto de JavaScript no se mueve.** Cero bytes de cliente nuevos,
  así que `npm run check:bundle` no cambia de número.
- **Ningún `"use client"` nuevo**, y ninguno en algo que renderice catálogo.
- **Sin verificación visual propia.** Lo que hay que mirar es un importe y un
  plan de consulta, no un aspecto: C1, C5, C6 y C7 son criterios ejecutables
  de `spec.md` y los verifica `sdd-tester` con el sensor y con `EXPLAIN`, no
  una captura en tres breakpoints.
