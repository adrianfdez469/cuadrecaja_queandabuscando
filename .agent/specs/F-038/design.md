---
feature: F-038
agente: orquestador
actualizado: 2026-09-07T21:10:00Z
estado: no aplica
---

## No aplica

F-038 no construye ni retoca ninguna pantalla. Abre el sobre del sync a una
sexta entidad, `BUSINESS`, y guarda lo único que trae —la lista de monedas que
el negocio quiere enseñar— con su guarda anti-rancio y sus dos errores por
evento. Todo el feature vive entre `prisma/schema.prisma`,
`src/constants/sync.ts`, `src/features/sync/schemas.ts`,
`src/features/sync/dependencies.ts`, `src/features/sync/server/processBatch.ts`,
un handler nuevo bajo src/features/sync/server/handlers/ (por crear) y
`scripts/send-catalog-batch.mjs`. No hay ruta nueva, ni componente, ni token de
tema, ni un byte de JavaScript de cliente.

El criterio 11 lo dice al revés y es la forma de comprobarlo: las páginas de la
tienda del seed tienen que mostrar **exactamente** lo que mostraban antes, con
el mismo catálogo. Si algo cambia en pantalla, este feature se salió de su
sitio.

Quien lo ve no es una persona delante de un navegador: es el POS de cuadrecaja,
leyendo el `207` que ya recibe hoy, con dos códigos de error que el contrato ya
publicó en la v12 y una entidad que hasta ahora respondía
`400 INVALID_BATCH`.

La mitad visible —el escaparate pintando el precio en la moneda que se cobra y
sus equivalentes— es **F-039**, que depende de este. Ahí sí entra
`sdd-designer`.
