---
feature: F-037
agente: orquestador
actualizado: 2026-09-07T18:05:00Z
estado: no aplica
---

## No aplica

F-037 no construye ni retoca ninguna pantalla. Cambia **quién llega a su
handler** dentro del bucle que aplica un lote del sync: un evento cuya
dependencia falló en ese mismo lote vuelve en `failed[]` en vez de aplicarse a
medias. Todo el feature vive entre `src/constants/sync.ts`,
`src/features/sync/server/processBatch.ts` y un módulo puro nuevo de
`src/features/sync/`. No hay ruta nueva, ni componente, ni token de tema, ni un
byte de JavaScript de cliente.

Quien lo ve no es una persona delante de un navegador: es el POS de cuadrecaja,
leyendo el `207` que ya recibe hoy, con un código de error que el contrato ya
publicó en la v11. El efecto visible para el comerciante es indirecto y está
escrito en `.agent/specs/F-037/spec.md` § Problema: un producto deja de
aparecer sin categoría en la vitrina, y aparece bien una entrega más tarde.

El único diseño que sí tiene este feature es el de sus **mensajes de
diagnóstico**, y no es de pantalla: la forma de la línea de `console.warn` está
fijada en `.agent/specs/F-037/architecture.md` § AD5, y el motivo por el que no
puede ser `console.error` está en `AGENTS.md` § «Cosas que muerden».
