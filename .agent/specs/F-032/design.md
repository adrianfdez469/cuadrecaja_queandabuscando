---
feature: F-032
agente: orquestador
actualizado: 2026-09-01T21:05:00Z
estado: no aplica
---

## No aplica

F-032 no construye ninguna pantalla. Lo que hace es abrir cinco columnas de
`Store` al canal máquina a máquina que ya existe: el `payload` de `STORE` de
`POST /api/internal/sync/catalog`, que llama cuadrecaja con un
`Authorization: Bearer` y que ninguna sesión de navegador alcanza
(`src/app/api/internal/_lib/guard.ts`). No hay pantalla, ni breakpoint, ni token
de tema, ni un byte de JavaScript de cliente que diseñar; el presupuesto de
bundle no se mueve con este feature.

**La ausencia de pantalla es una decisión, no un olvido.** El humano la tomó en
la SP3 de F-031 —no hay editor de configuración en el panel— y la `notes` de
F-032 la mantiene explícitamente entre lo que queda fuera. El panel sigue sin
tocar ninguna de las cinco columnas, y el criterio 7 lo verifica.

## Dónde sí se ve el efecto, y de quién es esa pantalla

El criterio 2 se lee en el checkout: tras el lote, la tienda **ofrece o deja de
ofrecer** domicilio y muestra el importe nuevo. Esa pantalla es
`src/features/cart/components/CheckoutForm.tsx` y **es de F-010 y F-031**: ya
está especificada y verificada en `.agent/specs/F-010/design.md` y
`.agent/specs/F-031/design.md`, incluidos los dos estados que este feature puede
provocar —domicilio ofrecido con importe fijo, y domicilio ofrecido sin importe
porque la tienda cotiza por pedido—.

Lo que F-032 garantiza sobre ella no es diseño, es propagación: que el valor que
escribe el sync sea el que lee el checkout **sin reiniciar el servidor**. Eso se
comprueba ejecutando (criterio 2), y la spec lo argumenta en R22: la
configuración llega por `POST /api/orders/quote`, que no cachea. Ninguna página
ISR imprime estas cinco columnas.

Si al implementar apareciera un estado de pantalla que F-010/F-031 no cubren,
**deja de ser cierto que este feature no tiene diseño**: se para y se llama a
`sdd-designer`, en vez de resolverlo dentro del formulario sobre la marcha.
