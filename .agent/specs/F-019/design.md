---
feature: F-019
agente: sdd-designer
actualizado: 2026-08-30T14:14:02Z
estado: listo
---

> **Alcance de este documento.** Lo que ve y hace **el comprador** cuando la
> tienda le propone un cambio, más la copia de los tres estados nuevos. No se
> rediseña nada de lo que F-010 cerró en `/[slug]/pedido/[code]`: se **extiende**
> esa página. Todo lo de servidor —modelo, rutas, ADR— es de `architecture.md`,
> que se escribe en paralelo; aquí los endpoints se describen por su
> comportamiento observable y la ruta queda como «la que fije la arquitectura».
>
> `estado: listo` quiere decir que el documento no tiene huecos: cada `DP`
> lleva ya aplicada la opción que recomiendo, así que si el humano no responde
> ninguna esto se puede implementar tal cual. Las `DP1..DP5` siguen bloqueando
> la firma de plan.md, que es lo que manda el arnés, no este archivo.

## Qué se miró antes de diseñar

`AGENTS.md` entero (§ Prohibiciones, § «El presupuesto de JavaScript no es un
muro», § Cosas que muerden, § Idioma), `.agent/specs/F-019/spec.md` completa
(E1–E24, R1–R22, casos límite, 10 criterios), `.agent/progress/F-019.md` con
las ocho decisiones del humano, `.agent/specs/F-010/design.md` entera —sobre
todo § «Inventario de pantallas y estados · 4» y § Textos—,
[ADR 0016](../../../docs/adr/0016-escritura-publica-sin-sesion.md), y el
código: `src/app/[slug]/pedido/[code]/page.tsx`,
`src/app/[slug]/pedido/[code]/not-found.tsx`,
`src/features/orders/components/OrderStatusBadge.tsx`,
`src/features/orders/components/OrderLinesTable.tsx`,
`src/features/orders/components/WhatsappOrderLink.tsx`,
`src/features/orders/server/read.ts`, `src/features/orders/whatsapp.ts`,
`src/components/ui/` completo, `src/lib/money.ts`, `src/theme/tokens.css` y
`scripts/check-bundle-budget.mjs`.

**Lo que se verificó de verdad, y lo que no.**

- El `next dev` que escuchaba en `:3000` **no es de este checkout**: su `cwd` es
  `.orca-worktree-trash/wt-1787975564239-8d7709e1` y devolvía `500`. Es
  exactamente la trampa de AGENTS.md § «Un solo `next dev` por directorio»: no
  se verificó nada contra él. Se levantó uno propio en `:3100`, se miró, y se
  apagó al terminar —ese puerto es el `SMOKE_PORT` de `.agent/verify.sh` y
  dejarlo ocupado rompe la etapa `smoke` de quien venga detrás.
- Sobre ese servidor propio, `GET /tienda-demo/pedido/NQ8XYCMH8N` sirve la
  página tal como está hoy: código en `text-3xl tracking-[0.2em]` partido
  `NQ8XY-CMH8N`, insignia `Pendiente de confirmación` con su explicación
  debajo, el enlace de WhatsApp a ancho completo, el párrafo de expectativa de
  F-010 y las dos tarjetas (Entrega/Contacto y Tu pedido). El HTML pesa 25 KB.
- **La propiedad «cero módulos de cliente propios» se midió, no se supuso:**
  `grep -o '_next/static/chunks[^"]*' | sort -u | wc -l` da **20** en la página
  del pedido y **20** en `/tienda-demo`. Ese es el número que este diseño se
  compromete a no mover (paso V5 de F-010, repetido aquí como V4).
- **No hay juicio visual fiable a 360/768/1280.** El navegador respondió y se
  vio la página renderizada —en modo oscuro, que es lo que tenía el sistema—,
  pero las dos capturas tras redimensionar la ventana salieron **idénticas**:
  el viewport capturado no siguió al `resize`. Así que las medidas de este
  documento salen de leer el HTML servido y las clases de Tailwind. Los pasos
  V7–V16 de § Verificación visual quedan para quien tenga el navegador
  obedeciendo, y son ejecutables uno a uno.

## Cómo encaja con architecture.md

`architecture.md` se escribe a la vez que esto, así que este documento deja
**seis suposiciones** numeradas. Ninguna cambia la copia; la **A5 sí puede
cambiar cómo se pinta la diferencia**, y por eso está escrita con su plan B.

| #      | Suposición                                                                                                                                                                                                                                                                                                 | Si no se cumple                                                                                                                                                                                                                               |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A1** | Aprobar y rechazar son dos `<form method="post">` a una ruta que responde **303** al `GET` de la propia página del pedido (POST-redirect-GET). Si la arquitectura prefiere una Server Action, tiene que conservar las dos propiedades: funciona sin JS y no añade un solo módulo de cliente a esta página. | Cualquier transporte que exija JS incumple R16 y el criterio de este ciclo. No hay plan B.                                                                                                                                                    |
| **A2** | El formulario lleva, además del `code`, un identificador de **la propuesta vigente**. El servidor rechaza el de una propuesta reemplazada (E13).                                                                                                                                                           | Sin él, una pestaña abierta desde antes aprueba importes que ya no existen. El estado «la tienda cambió la propuesta mientras la mirabas» desaparece del inventario y se convierte en un fallo silencioso.                                    |
| **A3** | El resultado vuelve en un parámetro **enumerado**, `?respuesta=…`, y la redirección apunta al ancla `#respuesta`. Los valores desconocidos no pintan nada.                                                                                                                                                 | Sin el parámetro, quien aprueba ve la página confirmada sin saber si fue su clic; se puede vivir, pero los cinco desenlaces de § «Llegué tarde» se pierden.                                                                                   |
| **A4** | La lectura del pedido devuelve en **una sola consulta**: importes y líneas vigentes, importes y líneas propuestos, `expiresAt`, el mensaje de la tienda, la atribución de la cancelación, y un derivado `propuestaVencida = expiresAt <= now()`.                                                           | Una segunda petición en esta página sería el primer viaje extra de una pantalla que hoy es de una sola pieza.                                                                                                                                 |
| **A5** | Las líneas propuestas traen una **clave estable** que las empareja con las vigentes (el mismo identificador de producto que ya usa el pedido), así que la diferencia línea a línea se calcula **en el servidor**.                                                                                          | **Plan B, y es peor:** sin clave no hay emparejamiento fiable y el bloque «Qué cambia» se queda solo con envío, subtotal y total; las líneas se muestran como dos listas completas —la vigente plegada— y el comprador diffea a ojo.          |
| **A6** | Un `POST` de formulario llega como `application/x-www-form-urlencoded`, así que **la defensa 4 de la ADR 0016** (content-type JSON estricto, que fuerza preflight CORS) **no aplica** a esta ruta.                                                                                                         | Hay que decir en la ADR nueva qué la sustituye. Observación para el arquitecto: aquí no hay cookie ni sesión, así que un POST cruzado no gana nada —quien puede forjar el formulario ya conoce el `code`—, pero eso se escribe, no se supone. |

## Flujo de usuario

Una frase: **al comprador le llega por WhatsApp el enlace de siempre, abre su
pedido, lee qué cambia y cuánto pagaría, aprueba o rechaza con dos toques sin
que el navegador ejecute una línea de JavaScript, y vuelve a la misma página ya
resuelta.**

```
WhatsApp del encargado  ─►  https://…/[slug]/pedido/[code]
      │  (el mismo enlace de F-010; no hay ruta nueva para el comprador)
      ▼
GET /[slug]/pedido/[code]     estado AWAITING_CUSTOMER
      │  arriba: «La tienda propone un cambio en tu pedido»
      │           + enlace de salto «Ver el cambio y responder» → #propuesta
      │  panel:  plazo · mensaje de la tienda · QUÉ CAMBIA ·
      │           total actual + total propuesto · dos acciones
      │
      ├─ <details> «Aprobar el cambio»   ─► POST  decision=approve
      │        confirmación dentro: «Sí, acepto pagar $1,700.00»
      │
      └─ <details> «Rechazar el cambio»  ─► POST  decision=reject
               motivo (radios) + texto opcional
               confirmación dentro: «Sí, rechazar y cancelar el pedido»
      ▼
303 See Other  →  /[slug]/pedido/[code]?respuesta=<valor>#respuesta
      ▼
GET de vuelta, con el banner del resultado y el foco puesto en él
      ├─ aprobada   → CONFIRMED, con los importes nuevos
      ├─ rechazada  → CANCELLED / comprador
      ├─ vencida    → la propuesta ya había vencido: no se escribió nada
      ├─ cambiada   → la tienda propuso otra cosa mientras mirabas
      ├─ cancelada  → la tienda canceló o rechazó mientras respondías
      └─ error      → no se registró nada; el panel sigue ahí
```

**El punto de no retorno son dos, y los dos están detrás de una confirmación
explícita:** el `POST` de aprobar (cambia lo que va a pagar) y el de rechazar
(cancela el pedido, y de eso no se vuelve). Antes del `POST` no se escribe
nada; después, el comprador no puede deshacerlo desde esta página.

**Vueltas atrás y qué se pierde.**

| Desde → hacia                                          | Qué se conserva                                           | Qué se pierde                                                                                                                                                               |
| ------------------------------------------------------ | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Abrir un `<details>` y cerrarlo                        | Todo                                                      | Nada. Es una revelación nativa, no una navegación.                                                                                                                          |
| Rellenar el motivo del rechazo y cerrar el `<details>` | El navegador conserva lo tecleado mientras no se recargue | Al **recargar** se pierde el texto del motivo. Es un `<textarea>` opcional de 200 caracteres: no se guarda en ningún sitio (misma regla que R13 de F-010 para el checkout). |
| Botón atrás del navegador después de responder         | Nada que se pueda deshacer                                | Nada: el `303` hace que el atrás lleve al `GET` anterior, no a reenviar el `POST`. **Ningún diálogo de «¿Reenviar formulario?»** — es la razón principal de usar PRG.       |
| Recargar la página en cualquier momento                | Todo: la página se recalcula entera en cada `GET`         | Nada. Es la propiedad que da R17 (`dynamic`, `revalidate = 0`), y de ella depende que el plazo mostrado sea cierto.                                                         |
| Cerrar la pestaña sin responder                        | El pedido, en `AWAITING_CUSTOMER`                         | Nada, hasta que venza el plazo. Al vencer se cancela solo (R6) y el enlace sigue funcionando para leer el desenlace.                                                        |
| Volver al catálogo desde el pie («Seguir comprando»)   | El pedido y su propuesta                                  | Nada. El enlace del pie sigue siendo el de F-010.                                                                                                                           |

## Inventario de pantallas y estados

Hay **una sola pantalla**: `/[slug]/pedido/[code]`. No se crea ninguna ruta que
el comprador vea. Lo que cambia es qué bloques aparecen dentro de ella.

### 4.1 · Dónde se inserta cada bloque (extensión de F-010 § pantalla 4)

El esqueleto de hoy —tira superior, código, insignia, WhatsApp, párrafo de
expectativa, tarjeta Entrega/Contacto, tarjeta Tu pedido, «Actualiza la
página», «Seguir comprando»— **no se toca**. Con propuesta viva pasa esto, en
este orden vertical:

| #   | Bloque                                                 | Con propuesta viva (`AWAITING_CUSTOMER`)                                                                                                                                                                       |
| --- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | Alerta de tienda cerrada (HD11, ya existe)             | Igual que hoy. Se apila encima de todo y **no** impide responder: la propuesta es de un pedido que ya existe.                                                                                                  |
| 0b  | Banner del resultado (nuevo, `id="respuesta"`)         | Solo cuando la URL trae `?respuesta=…`. Es el primer elemento del contenido y el ancla de la redirección.                                                                                                      |
| 1   | Tira `¡Pedido recibido!` (`positive`)                  | **Se sustituye** por la tira de propuesta: `warning`, con el titular, la frase de qué hay que hacer, y el enlace de salto `Ver el cambio y responder`.                                                         |
| 2   | Código + `Guarda este código…`                         | Igual que hoy. Es lo que ancla «esto es mi pedido».                                                                                                                                                            |
| 3   | Insignia de estado                                     | `Esperando tu respuesta` (§ Textos).                                                                                                                                                                           |
| 4   | **Panel de propuesta (nuevo)**, `id="propuesta"`       | Plazo · mensaje de la tienda · Qué cambia · los dos totales · las dos acciones. Es el bloque grande de este feature.                                                                                           |
| 5   | Enlace `Enviar el pedido por WhatsApp`                 | **No se pinta** (DP1): su mensaje lleva los importes viejos y presentarlo aquí es ofrecerle al comprador que reenvíe un pedido que está en discusión. En su lugar, dentro del panel, `Escribirle a la tienda`. |
| 6   | Párrafo de expectativa de F-010 (DP4 literal)          | **No se pinta** (DP2): «La tienda va a revisar tu pedido y te va a contactar…» es falso aquí —ya lo revisó y ya te contactó—. Lo sustituye la frase del panel.                                                 |
| 7   | Tarjeta Entrega / Contacto                             | Igual que hoy, con los datos **vigentes**. Si la propuesta cambia el envío, el cambio se lee en el panel, no aquí: esta tarjeta es «a nombre de quién y dónde», no «cuánto».                                   |
| 8   | Tarjeta Tu pedido (`OrderLinesTable`)                  | Muestra las **líneas propuestas** (E3) bajo el título `Tu pedido si aceptas el cambio` + `Badge` `Propuesta`, y debajo un `<details>` `Ver tu pedido tal como está ahora` con la lista vigente.                |
| 9   | `Actualiza la página para ver el estado más reciente.` | Igual que hoy. Con propuesta viva gana sentido: es lo que sustituye a un temporizador.                                                                                                                         |
| 10  | `Seguir comprando`                                     | Igual que hoy.                                                                                                                                                                                                 |

En cualquier otro estado la página es exactamente la de F-010, con la insignia
que corresponda y —si hubo una renegociación aprobada— la nota del punto 12 de
§ 4.2.

### 4.2 · Estados de la página

| #   | Estado                                                                 | Qué se ve                                                                                                                                                                                                                                                                                                                        |
| --- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Propuesta viva, con mensaje de la tienda**                           | El caso normal, y el de la § 4.1 entera. Panel completo con las dos acciones.                                                                                                                                                                                                                                                    |
| 2   | **Propuesta viva, sin mensaje**                                        | El bloque del mensaje **desaparece** —no queda un hueco ni un «(sin mensaje)» entrecomillado— y en su lugar va una línea `muted`: `La tienda no dejó un mensaje.` El resto, idéntico: la diferencia sigue explicando el cambio aunque nadie lo escriba.                                                                          |
| 3   | **Propuesta viva que no cambia el total** (caso límite)                | El bloque de totales dice `El total no cambia: sigue siendo {total}.` y **no se inventa un antes/ahora falso**. La lista de «Qué cambia» sí trae sus líneas (cambió qué, no cuánto). Las dos acciones, iguales.                                                                                                                  |
| 4   | **Propuesta viva sin plazo útil** (`< 15 min`)                         | Todo igual, con el plazo en `danger` y su copia propia. No se deshabilita nada: mientras el servidor no diga que venció, se puede responder.                                                                                                                                                                                     |
| 5   | **Propuesta vencida, fila todavía en `AWAITING_CUSTOMER`** (E12)       | Insignia `Sin respuesta a tiempo`. El panel se degrada: **sin `<details>`, sin formularios y sin botones**. Quedan el mensaje de la tienda y el bloque de totales, en gris, bajo el título `Esta propuesta venció`, más `Escribirle a la tienda`.                                                                                |
| 6   | **Aprobada** (`CONFIRMED`)                                             | Banner `positive` `Aprobaste el cambio.` Insignia `Confirmado`. El pedido muestra **los importes nuevos**, y bajo la tabla la nota del punto 12.                                                                                                                                                                                 |
| 7   | **Rechazada por el comprador** (`CANCELLED` / comprador)               | Banner `muted` `Rechazaste el cambio y el pedido quedó cancelado.` Insignia `Cancelado por ti`. Sin panel, sin acciones.                                                                                                                                                                                                         |
| 8   | **Vencida y ya cancelada** (`CANCELLED` / vencimiento)                 | Insignia `Cancelado: no respondiste a tiempo`. Sin panel. Tarjeta `muted` con el motivo literal de R6 y `Escribirle a la tienda`.                                                                                                                                                                                                |
| 9   | **Rechazada por la tienda** (`REJECTED_BY_STORE`)                      | Insignia `Rechazado por la tienda`. Sin panel. Datos de contacto de la tienda a la vista.                                                                                                                                                                                                                                        |
| 10  | **Cancelada por la tienda** (`CANCELLED` / tienda)                     | La página de F-010, con la insignia `Cancelado por la tienda`.                                                                                                                                                                                                                                                                   |
| 11  | **Cancelada sin atribución** (filas anteriores a la migración)         | Insignia `Cancelado` con **el texto de F-010 sin tocar**. Es el estado aburrido que se olvida: la columna de atribución es nullable y todo lo cancelado antes de este feature llega con `null`.                                                                                                                                  |
| 12  | **Pedido que incluye un cambio aprobado** (cualquier estado posterior) | Bajo la tabla de líneas, `muted`: `Este pedido incluye un cambio que aprobaste.` + `<details>` `Ver qué cambió` con la misma lista de diferencias y los dos totales. **Hace falta**: el comprobante que el comprador tiene en su WhatsApp lleva los importes viejos, y sin esta nota la diferencia parece un cobro de más (DP4). |
| 13  | **`IN_TRANSIT`, pedido con envío**                                     | Insignia `En camino`, tono `positive`. Sin panel.                                                                                                                                                                                                                                                                                |
| 14  | **`IN_TRANSIT`, pedido de retiro** (E22)                               | Insignia `La tienda lo puso en camino`, tono `warning`, con la explicación que dice qué hacer. La página **no rompe y no miente**.                                                                                                                                                                                               |
| 15  | **Sin JavaScript**                                                     | **Idéntica en todo.** No hay `<noscript>` porque no hay nada que degradar: ni el panel, ni la revelación, ni los formularios necesitan un byte de cliente.                                                                                                                                                                       |
| 16  | **Código inexistente o de otra tienda**                                | El `not-found.tsx` de F-010, sin cambios (R22).                                                                                                                                                                                                                                                                                  |
| 17  | **Error del cascarón**                                                 | `src/app/error.tsx`, que ya existe. Sin estado propio.                                                                                                                                                                                                                                                                           |

No hay estado «cargando»: la página es HTML servido de una pieza y R17 la
recalcula en cada `GET`. No hay estado «sin permiso»: el comprador es invitado
y el `code` es la única credencial; su equivalente sigue siendo el 404 (R22).

### 4.3 · Anatomía del panel de propuesta

De arriba abajo, dentro de una `Card` con `border-warning/30`:

1. **Título** `<h2 id="propuesta-titulo">La tienda propone un cambio</h2>`.
2. **Plazo.** Una línea, texto real, sin cuenta atrás. § 4.6.
3. **Mensaje de la tienda.** `<blockquote>` con el texto tal cual lo escribió el
   encargado, precedido de `La tienda dice:`. Entrecomillado y en `text-fg`,
   nunca en cursiva de adorno. Es lo único que responde «por qué», y por eso va
   **antes** de los números.
4. **Qué cambia.** La diferencia. § 4.4.
5. **Lo que pagarías.** Los dos totales. § 4.4.
6. **Las dos acciones.** § 4.5.
7. **Salida lateral:** `Escribirle a la tienda` (enlace `wa.me` al número de la
   tienda, con un texto corto que solo lleva el código del pedido), y la frase
   `Si no respondes antes de que se acabe el plazo, el pedido se cancela solo.`

### 4.4 · Cómo se presenta la diferencia — la decisión y su porqué

**Decisión: diferencia explícita («Qué cambia») + los dos totales + la lista
propuesta completa, con la lista vigente disponible pero plegada.** No dos
listas completas enfrentadas.

Por qué, en orden de peso:

1. **El disparador dominante no cambia ninguna línea.** El costo de envío se
   fija al gestionar el pedido y ocurre en **todos** los pedidos de esa
   modalidad (spec § Problema). Dos listas completas enfrentadas serían, en ese
   caso, dos listas **idénticas** con un total distinto debajo: la comparación
   que el comprador haría a ojo devuelve «no cambió nada» justo cuando lo que
   cambió es lo que va a pagar. La diferencia, en cambio, se reduce a **una
   línea** que dice exactamente lo que pasó: `Envío: antes sin costo, ahora
$500.00.`
2. **El comprador no sabe qué cambió.** Es la premisa. Pedirle que compare doce
   filas en 360 px de ancho es pedirle que haga el trabajo del diseño. La
   diferencia lo hace el servidor, que tiene los dos juegos de datos delante.
3. **El criterio 1 solo exige los dos totales**, y el bloque «Lo que pagarías»
   los da los dos, distintos y presentes, en texto plano dentro del HTML —que
   es lo que el modo `--propose` del guion va a `grep`ear.
4. **La lista propuesta completa sigue haciendo falta** (E3): «qué cambia»
   responde a la diferencia, pero «qué me llevo» solo lo responde la lista
   entera. Van las dos, en este orden: primero el cambio, después el pedido
   resultante.
5. **La lista vigente no se tira, se pliega.** Un `<details>` `Ver tu pedido tal
como está ahora` cuesta cero JavaScript, no ocupa sitio y salva al comprador
   desconfiado, que existe. Plegada y no abierta porque en el caso dominante no
   aporta nada.

**El bloque «Qué cambia»** es un `<ul>` de frases, no una tabla de dos
columnas: en un lector de pantalla una tabla de 2×N se recorre celda a celda y
en 360 px se parte. Una fila por cambio, en este orden fijo —productos primero,
dinero después—:

| Cambio                | Frase                                                           |
| --------------------- | --------------------------------------------------------------- |
| Línea que sale        | `Café Cubita 500 g: sale del pedido (eran 2 unidades).`         |
| Línea que entra       | `Agua mineral 1.5 L: se agrega al pedido (1 unidad).`           |
| Cantidad              | `Café Cubita 500 g: antes 3 unidades, ahora 2.`                 |
| Precio unitario       | `Café Cubita 500 g: antes $450.00 c/u, ahora $480.00 c/u.`      |
| Cantidad **y** precio | Dos frases, no una condensada: la que menos hace pensar gana.   |
| Envío                 | `Envío: antes sin costo, ahora $500.00.`                        |
| Subtotal              | `Subtotal: antes $1,200.00, ahora $1,200.00.` — solo si cambió. |

Cada frase lleva `antes` y `ahora` **como palabras**. Nada de tachado como
único indicador, nada de flechas, nada de rojo/verde: el color se reserva para
la insignia y el borde de la tarjeta, porque un cambio de precio no es un error
ni un éxito.

**El bloque «Lo que pagarías»** es un `<dl>` de tres pares, en este orden:

```
Total actual        $1,200.00
Total propuesto     $1,700.00      ← text-2xl font-semibold, text-fg
Diferencia          $500.00 más
```

El orden es deliberado y se justifica en § Accesibilidad. Cuando los dos
importes coinciden, el bloque colapsa a una sola línea (estado 3 de § 4.2).

### 4.5 · Aprobar y rechazar sin JavaScript

**La forma.** Dos `<details>` hermanos, cada uno con su `<form method="post">`
dentro. El `<summary>` es la acción visible; el contenido es la confirmación y
el `<button type="submit">` de verdad.

```
<details>
  <summary>Aprobar el cambio</summary>            ← paso 1, un toque
  <form method="post" action="(la que fije la arquitectura)">
    <input type="hidden" name="decision" value="approve">
    <input type="hidden" name="proposalId" value="…">      ← A2
    «Vas a aceptar pagar $1,700.00 en vez de $1,200.00…»
    <button type="submit">Sí, acepto pagar $1,700.00</button>  ← paso 2
  </form>
</details>
```

**Por qué así.**

- **La confirmación no es un `confirm()`.** Aprobar cambia lo que el comprador
  va a pagar, así que hay dos pasos deliberados: revelar y confirmar. Lo hace
  el navegador con `<details>`/`<summary>`, que es un elemento nativo, tiene
  semántica de botón en el árbol de accesibilidad, anuncia su estado
  expandido/plegado solo, funciona con teclado sin código y **pesa cero
  bytes**. Un `confirm()` bloquea el hilo, no se puede redactar, no se puede
  estilar y no existe sin JavaScript.
- **Por qué no una segunda página de confirmación.** Es un viaje más en la
  conexión del público objetivo, y saca al comprador de la pantalla donde está
  la diferencia justo cuando tiene que decidir sobre ella.
- **El texto del botón repite el importe.** Quien llega al botón con el foco,
  sin haber leído la tarjeta, tiene que poder saber qué está confirmando.
- **El rechazo pide motivo en el mismo sitio**: un `<fieldset>` de `RadioCard`
  con cuatro motivos y un `<textarea>` opcional de 200 caracteres. El primer
  motivo va `checked` **por defecto**, para que `cancelReason` nunca salga
  vacío (criterio 3 exige `cancelReason` no nulo) sin bloquear el envío con una
  validación que en un navegador viejo podría no dispararse. El servidor
  compone el motivo con la etiqueta elegida y, si lo hay, el texto libre.
- **Los dos `<details>` pueden estar abiertos a la vez.** No se usa el atributo
  `name` para hacerlos excluyentes: es soporte reciente y el WebView de un
  Android viejo es exactamente el navegador que este repo no puede dar por
  supuesto. Que se abran los dos no rompe nada.
- **Doble envío.** No se puede deshabilitar un botón sin JavaScript, y no hace
  falta: el `UPDATE` condicional de R14 y la idempotencia de E7 hacen que el
  segundo `POST` de la misma decisión no cambie nada y responda igual. El `303`
  evita además que recargar reenvíe el formulario.
- **Ningún dato nuevo del comprador.** El formulario manda decisión,
  identificador de propuesta y, como mucho, un motivo de texto. Es una de las
  defensas que el humano enumeró al aceptar la segunda ruta pública, y el
  diseño la respeta: no hay ni un campo de contacto en esta pantalla.

**La vuelta.** `303 See Other` →
`/[slug]/pedido/[code]?respuesta=<valor>#respuesta`. El banner del resultado
lleva `id="respuesta"` y `tabindex="-1"`, así que el ancla **mueve el foco sin
JavaScript**. Los valores son un enumerado cerrado; cualquier otra cosa en el
parámetro no pinta nada.

| `?respuesta=` | Cuándo                                                | Banner                                                                                           |
| ------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `aprobada`    | 200/303 tras aprobar, incluida la repetición (E7)     | `positive` · `Aprobaste el cambio.`                                                              |
| `rechazada`   | Tras rechazar, incluida la repetición                 | `muted` · `Rechazaste el cambio y el pedido quedó cancelado.`                                    |
| `vencida`     | 409 por `expiresAt <= now()` (E11)                    | `danger` · `No pudimos registrar tu respuesta: el plazo ya se había acabado.`                    |
| `cambiada`    | 409 porque la propuesta ya no es la vigente (E13, A2) | `warning` · `La tienda cambió la propuesta mientras la mirabas. Abajo está la nueva.`            |
| `cerrada`     | 409 porque la tienda canceló o rechazó (E8)           | `danger` · `No pudimos registrar tu respuesta: la tienda cerró este pedido mientras respondías.` |
| `conflicto`   | 409 por la decisión contraria a la ya registrada (E7) | `warning` · `Este pedido ya tenía una respuesta registrada, y no era esa.`                       |
| `espera`      | 429                                                   | `warning` · `Recibimos varias respuestas seguidas. Espera un momento y vuelve a intentarlo.`     |
| `error`       | 500 o red                                             | `danger` · `No pudimos registrar tu respuesta. No se cambió nada: vuelve a intentarlo.`          |

En `vencida`, `cerrada` y `conflicto` **el estado real de la fila ya lo cuenta
todo** —la insignia dirá `Sin respuesta a tiempo`, `Cancelado por la tienda` o
lo que toque—; el banner solo añade lo que la página no puede saber sola: que
el clic del comprador no tuvo efecto. En `error` y `espera` el panel sigue
completo y se puede volver a intentar.

### 4.6 · El plazo, sin temporizador

**Texto relativo calculado en el servidor en cada `GET`.** R17 ya prohíbe
cachear esta página, así que el dato es fresco por construcción, y R18 prohíbe
la hora local porque no existe la zona horaria de la tienda.

| Restan       | Copia                                          | Tono                                  |
| ------------ | ---------------------------------------------- | ------------------------------------- |
| ≥ 2 h        | `Te quedan unas {N} horas para responder.`     | `text-fg`                             |
| 60 – 119 min | `Te queda alrededor de 1 hora para responder.` | `text-warning` (icono no, palabra sí) |
| 15 – 59 min  | `Te queda menos de 1 hora para responder.`     | `text-warning`                        |
| < 15 min     | `Te quedan pocos minutos para responder.`      | `text-danger`                         |
| ≤ 0          | Estado 5 de § 4.2: `Esta propuesta venció.`    | `text-danger`                         |

`{N}` es la división entera de los minutos restantes entre 60: con el default
de 24 h, quien abre el enlace al momento lee `Te quedan unas 24 horas para
responder.` La frase va envuelta en un `<time dateTime="…Z">` con el instante
exacto en UTC: es un atributo, no se pinta, no dice ninguna hora local y deja
el dato disponible para quien inspeccione el HTML.

**Cuánto JavaScript cuesta esto: cero bytes.** No hay `setInterval`, no hay
isla, no hay `"use client"`. Lo que se pierde: el número no baja solo mientras
la pestaña está abierta. Lo que se gana: la página sigue siendo la más robusta
del producto y el texto nunca miente más de lo que dura la sesión. La frase
`Actualiza la página para ver el estado más reciente.` que ya existe al pie es
literalmente el sustituto, y aquí es donde por fin sirve para algo.

## Estructura por breakpoint

360 primero. El contenedor de la página ya es `max-w-2xl py-8 lg:max-w-4xl` y
**no se cambia**: el panel vive dentro de él, a ancho completo, por encima de la
rejilla `lg:grid-cols-2` de las dos tarjetas.

| Zona                            | 360px                                                                                                                                                                                                                        | 768px                                                                                                | 1280px                                                                                                           |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Tira de propuesta               | Titular en dos líneas + frase de acción + enlace `Ver el cambio y responder`. El enlace importa aquí: el panel queda por debajo del pliegue por culpa del código en `text-3xl`.                                              | Igual, titular en una línea                                                                          | Igual. El enlace de salto sigue puesto: cuesta nada y con la tarjeta de tienda cerrada arriba también hace falta |
| Panel de propuesta              | Una columna, `Card p-4`, ancho completo                                                                                                                                                                                      | `p-6`, contenido a `max-w-prose` para que las frases del cambio no se estiren                        | Igual que 768, dentro del `lg:max-w-4xl`                                                                         |
| Mensaje de la tienda            | `blockquote` con `border-l-2 border-border pl-3`, sin comillas tipográficas de adorno                                                                                                                                        | Igual                                                                                                | Igual                                                                                                            |
| Qué cambia                      | Una frase por ítem, ocupando las líneas que necesite. **Sin dos columnas**: partir «antes/ahora» en columnas de 150 px produce saltos de línea dentro de un importe                                                          | Igual, con más aire (`space-y-2`)                                                                    | Igual                                                                                                            |
| Lo que pagarías                 | `dl` apilado: etiqueta (`text-sm text-fg-muted`) e importe debajo. El propuesto en `text-2xl font-semibold`                                                                                                                  | `dl` en dos columnas (`sm:grid-cols-[1fr_auto]`), etiqueta a la izquierda e importe a la derecha     | Igual que 768                                                                                                    |
| Las dos acciones                | **Apiladas siempre**, cada `<summary>` a ancho completo con `min-h-12`. Aprobar arriba, rechazar debajo, `gap-3`                                                                                                             | Siguen apiladas: al abrirse, un panel dentro de media columna deja el motivo en una franja de 300 px | Siguen apiladas, a `max-w-md`                                                                                    |
| Contenido de un `<details>`     | Se despliega hacia abajo, dentro del borde de la tarjeta; nunca desplaza lo que está por encima                                                                                                                              | Igual                                                                                                | Igual                                                                                                            |
| Motivos del rechazo             | Cuatro `RadioCard` apiladas, `min-h-14`, y el `textarea` debajo                                                                                                                                                              | Igual                                                                                                | Igual                                                                                                            |
| Lista propuesta / lista vigente | Tarjeta `Tu pedido si aceptas el cambio` en flujo; el `<details>` de la lista vigente justo debajo, cerrado                                                                                                                  | Igual                                                                                                | La rejilla `lg:grid-cols-2` de hoy: Entrega/Contacto a la izquierda, la tarjeta de líneas a la derecha           |
| Banner del resultado            | Ancho completo, encima de todo el contenido                                                                                                                                                                                  | Igual                                                                                                | Igual                                                                                                            |
| Insignia de estado              | Debajo del código, como hoy. Las etiquetas nuevas más largas (`Cancelado: no respondiste a tiempo`, `La tienda lo puso en camino`) caben en dos líneas dentro del `Badge`: no se trunca ni se abrevia con puntos suspensivos | Igual, casi siempre en una línea                                                                     | Una línea                                                                                                        |

**La regla que gobierna los tres tamaños:** una columna, ninguna acción
flotante, ningún `sticky` —el `Confirmar` del checkout ya se dejó fuera de
`sticky` por la misma razón (F-010 § Estructura)—, y **nada que se abra por
encima de algo que el comprador ya estaba leyendo**: las dos revelaciones
crecen hacia abajo.

## Componentes de UI

**Se reutilizan tal cual, sin tocarlos:** `Container`, `Card`, `Badge`,
`Alert` (los cuatro tonos y sus dos `role` ya cubren los ocho banners de § 4.5),
`Button` (que es un server component y sirve de `type="submit"` sin ninguna
directiva), `RadioCard` (también server component: un `<input type="radio">` de
verdad dentro de una superficie de `min-h-14`, que es justo lo que pide el
motivo del rechazo), `Field` (para el `<textarea>` del motivo, que así ya trae
`label`, ayuda y `aria-describedby` cableados) y
`src/features/orders/components/OrderLinesTable.tsx`.

**No hace falta ningún primitivo nuevo en `src/components/ui/`.** Lo que se
necesita —revelación, formulario, radios, banner— o existe en el repo o lo da
el navegador.

**Componentes de dominio.** El arquitecto ubica los archivos; van en
`src/features/orders/components/` por coherencia con los tres que ya viven ahí.

| Componente                                            | Qué hace                                                                                                                                                        | `"use client"`                                                                                   |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| OrderProposalPanel.tsx (por crear)                    | El panel entero de § 4.3: plazo, mensaje, diferencia, los dos totales y las dos revelaciones con sus formularios                                                | **No.** Sin estado y sin eventos: ponérselo sería la prohibición de AGENTS.md al pie de la letra |
| OrderProposalDiff.tsx (por crear)                     | El `<ul>` de frases de § 4.4, a partir de la diferencia que ya calculó el servidor                                                                              | **No**                                                                                           |
| OrderProposalTotals.tsx (por crear)                   | El `<dl>` de los dos totales y la diferencia, incluido el caso «el total no cambia»                                                                             | **No**                                                                                           |
| OrderResponseBanner.tsx (por crear)                   | El banner de `?respuesta=…`, con `id="respuesta"` y `tabindex="-1"`. Traduce el enumerado a `Alert` + copia                                                     | **No**                                                                                           |
| `src/features/orders/components/OrderStatusBadge.tsx` | **Se amplía**: tres estados nuevos, la variante de propuesta vencida y las tres atribuciones de cancelación                                                     | **No** — sigue siendo server component puro                                                      |
| `src/features/orders/components/OrderLinesTable.tsx`  | **Se amplía** con un título y una insignia opcionales, para poder decir `Tu pedido si aceptas el cambio` + `Propuesta`                                          | **No**                                                                                           |
| `src/features/orders/whatsapp.ts`                     | **Se amplía** con el enlace corto `Escribirle a la tienda` (solo el código del pedido, sin importes) y con el `wa.me` hacia el comprador que E1 y E24 necesitan | No aplica: es lógica de servidor                                                                 |

**Sobre `OrderStatusBadge` y su `switch` sin `default`.** Es un guardarraíl
deliberado (I1) y **no se apaga**: al ampliar `OrderStatus` el typecheck se
pondrá rojo hasta que los tres casos nuevos tengan copia, que es exactamente lo
que este documento entrega en § Textos. Lo que sí cambia es la firma: hoy
recibe `status` y `hasDelivery`; necesita además saber si la propuesta venció y
a quién se atribuye la cancelación. Se le pasa **un objeto**, no cuatro
posicionales, y el `switch` sigue siendo exhaustivo sobre `OrderStatus`, con la
bifurcación de `AWAITING_CUSTOMER` y la de `CANCELLED` **dentro** de su `case`.

**Una corrección menor de F-010 que el criterio 9 obliga.** Hoy `READY` con
envío explica `Va en camino.`, que es justo lo que ahora significa
`IN_TRANSIT`. Se cambia a `La tienda lo tiene listo para salir.` Sin eso, dos
estados distintos cuentan lo mismo y el criterio 9 —`IN_TRANSIT` con copia
propia, distinta de `READY`— no se cumple de verdad aunque la etiqueta difiera.

## Tokens y tema

**Ni un token nuevo.** Todo sale de `src/theme/tokens.css` tal como está:

| Uso                                      | Token / utilidad                                                                                                               |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Tarjeta del panel                        | `bg-surface` + `border-warning/30` + `rounded-lg` + `shadow-card`                                                              |
| Tira superior de propuesta               | `bg-warning/15` + `border-warning/30`                                                                                          |
| Título, frases del cambio y los importes | `text-fg` (nunca `text-brand`: ver abajo)                                                                                      |
| Etiquetas, mensaje sin contenido, notas  | `text-fg-muted`                                                                                                                |
| Cita del mensaje de la tienda            | `border-l-2 border-border pl-3`, texto en `text-fg`                                                                            |
| Plazo apretado / muy apretado            | `text-warning` / `text-danger`, siempre acompañado de la palabra                                                               |
| Insignia por estado                      | Los cuatro tonos que `Badge` ya tiene, según § Textos                                                                          |
| Botón de aprobar                         | `Button` `variant="primary"` → `bg-brand text-brand-contrast`                                                                  |
| Revelación de rechazar y su botón        | `Button` `variant="secondary"` → `bg-surface-muted text-fg border-border`                                                      |
| Radios del motivo                        | `RadioCard`, que ya usa `has-[:checked]:border-brand has-[:checked]:bg-brand/8`                                                |
| Banners de resultado                     | `Alert` con `positive` · `warning` · `danger` · `muted`                                                                        |
| Anillo de foco                           | `focus-visible:outline-brand outline-2 outline-offset-2`, igual que `Button`                                                   |
| Esquinas                                 | `rounded-sm`, `rounded-md` y `rounded-lg` por nombre, nunca `rounded-[--radius-lg]` (es lo que persigue `npm run check:theme`) |

**Los importes no van en `text-brand`.** Es la decisión deliberada de F-010 y
aquí importa el doble: `brand` lo elige la tienda, `storeTheme.ts` solo valida
que sea un color CSS y no que contraste, y el número que se pinta aquí es
exactamente el que decide si el comprador acepta pagar más. Va en `text-fg
font-semibold`.

**Aviso de contraste que este diseño se toma en serio.** `--color-warning` es
`oklch(0.72 0.15 75)`: sobre `--color-bg` (`oklch(0.99 …)`) no llega a 4.5:1
para texto normal. Por eso, dentro del panel y de la tira, **el amarillo pinta
el borde y el fondo translúcido, y el cuerpo del texto va en `text-fg`**. Se
reserva `text-warning` para frases cortas y en negrita (el plazo apretado), que
es donde 3:1 es admisible por tamaño y peso. Vale igual para `Alert
tone="warning"`, que hoy pone todo su contenido en `text-warning`: los banners
de § 4.5 llevan el texto largo en un `<p class="text-fg">` dentro del `Alert`.
Esto **no** es un token nuevo ni un cambio en `Alert`: es cómo se usa aquí, y
el paso V13 lo mide.

**Branding por tienda.** La tienda solo puede redefinir `brand`,
`brandContrast`, `accent`, `accentContrast` y la escala `radius`.
Consecuencias buscadas: el botón `Sí, acepto pagar {total}` se pinta con la
marca —la única acción de la pantalla que la lleva—; con `radius: round` la
tarjeta del panel y las `RadioCard` se redondean solas; y los tonos
`positive`/`warning`/`danger` **no** son overridables, así que una tienda no
puede repintar de su color el aviso de que la propuesta venció.

## Accesibilidad

**Orden de foco (Tab), con propuesta viva.** Cabecera de la tienda →
`Carrito` → `Cuenta` → (banner del resultado, si lo hay, que además **ya tiene
el foco** por el ancla) → `Ver el cambio y responder` → `Aprobar el cambio`
(`summary`) → [si está abierto: `Sí, acepto pagar {total}`] → `Rechazar el
cambio` (`summary`) → [si está abierto: los cuatro radios → el `textarea` →
`Sí, rechazar y cancelar el pedido`] → `Escribirle a la tienda` → `Ver tu
pedido tal como está ahora` (`summary`) → `Seguir comprando`.

- **Nada mueve el foco por programa**, porque no hay JavaScript que pueda
  moverlo. Lo único que lo mueve es el ancla `#respuesta` de la redirección, que
  es comportamiento nativo del navegador sobre un elemento con `tabindex="-1"`.
- **`<summary>` no lleva `aria-expanded` a mano.** El navegador ya expone el
  estado del `<details>`; escribirlo a mano es la forma clásica de acabar con
  dos fuentes de verdad y una de ellas mintiendo.

**El orden de lectura de los dos totales, que es la pregunta delicada.** El
`<dl>` se lee `Total actual, $1,200.00. Total propuesto, $1,700.00. Diferencia,
$500.00 más.` Tres decisiones dentro de eso:

1. **Primero el actual, después el propuesto.** Es el orden cronológico y deja
   como último dato oído el importe sobre el que hay que decidir. Al revés
   —propuesto primero— quien escucha se queda con el número viejo en la cabeza
   justo antes de llegar al botón.
2. **La diferencia se dice con palabras, no se deduce.** `$500.00 más` /
   `$300.00 menos` / `El total no cambia`. Restar dos importes de memoria
   mientras un lector de pantalla los dicta no es razonable, y la resta la hace
   el servidor con `subtract()` de `src/lib/money.ts`.
3. **El total anterior no va tachado.** Sigue siendo el precio vigente hasta que
   el comprador responda; tacharlo daría por hecho el cambio. Y un `line-through`
   no lo anuncia ningún lector: la palabra `actual` sí.

**Otros compromisos concretos.**

- Área de toque ≥ 44 px en todo lo pulsable: los dos `<summary>` se estilan con
  `min-h-12` y `px-4` (son bloques, no texto suelto), los `<button type="submit">`
  son `Button size="lg"` (`min-h-12`), las `RadioCard` traen `min-h-14`.
- El `<summary>` lleva `cursor-pointer`, `list-style: none` y su propio
  indicador de texto —`Aprobar el cambio` / `Rechazar el cambio`— para no
  depender del triangulito nativo, que en iOS y en Android no se ve igual. El
  estado abierto/cerrado **no** se comunica solo por ese indicador: lo anuncia
  el navegador.
- El panel es `<section aria-labelledby="propuesta-titulo">`, así que un lector
  puede saltar a él por landmarks.
- El motivo del rechazo es un `<fieldset>` con
  `<legend>¿Por qué lo rechazas?</legend>` y `RadioCard` reales: flechas del
  teclado, semántica de grupo, cero `div role="radio"`.
- El `<textarea>` va dentro de `Field` con su `<label>` visible
  (`Cuéntale a la tienda, si quieres`) y su ayuda; el contador de 200
  caracteres se enuncia en la ayuda, no como un contador vivo que exigiría JS.
- El banner de resultado usa el `role` que `Alert` ya asigna por tono:
  `danger`/`warning` interrumpen (`role="alert"`), `positive`/`muted` informan
  (`role="status"`). Como llega en una carga de página completa, no hay
  anuncio duplicado.
- El plazo es **texto real** dentro del panel, no un `title` ni un `aria-label`.
  Quien lo lee, lo lee.
- Las frases del cambio nunca dependen del color: `antes` y `ahora` son
  palabras, y ninguna línea se marca solo con rojo o verde.
- El código del pedido conserva su `aria-label` deletreado de F-010.
- Contraste: cuerpo de texto siempre `text-fg` o `text-fg-muted` sobre
  `bg-surface`; `text-warning`/`text-danger` solo en frases cortas y en
  negrita. Comprobado a ojo contra los tokens en claro y en oscuro, y medido en
  V13.

## Coste de cliente

**Cero bytes de JavaScript nuevos. Ni un `"use client"`. Ni un módulo.**

| Pieza                          | Directiva | Por qué                                                                               |
| ------------------------------ | --------- | ------------------------------------------------------------------------------------- |
| Panel de propuesta             | —         | Sin estado y sin eventos: la revelación la hace `<details>` y el envío, el formulario |
| Diferencia y totales           | —         | Se calculan en el servidor, que tiene los dos juegos de importes                      |
| Los dos formularios            | —         | HTML nativo, `method="post"`, respuesta `303`                                         |
| Motivo del rechazo             | —         | `<fieldset>` + radios + `<textarea>` nativos                                          |
| Plazo                          | —         | Texto renderizado en cada `GET` (R17)                                                 |
| Banner del resultado           | —         | Se deriva del parámetro de la URL en el servidor                                      |
| Insignia de los estados nuevos | —         | Server component puro, como hoy                                                       |

**Contra el presupuesto.** `BUDGET_KB` sigue en **193** y no hay que tocarlo.
Dos razones, y las dos se pueden comprobar:

1. `scripts/check-bundle-budget.mjs` mide páginas **prerenderizadas**;
   `/[slug]/pedido/[code]` es `ƒ` (`dynamic = "force-dynamic"`) y **no entra en
   la medida**. Subir el número no vendría a cuento ni aunque este diseño
   pesara.
2. Lo que sí importa, y es más estricto que el presupuesto, es la propiedad que
   el humano fijó en F-010 DP2: esta página no ejecuta un byte de JavaScript
   propio. Hoy sirve **20** URLs de `_next/static/chunks`, las mismas que
   `/tienda-demo`. Después de este feature tiene que seguir sirviendo las
   mismas: es el paso V4.

**Dónde se aplicó la regla de AGENTS.md § «El presupuesto no es un muro».** No
hubo que sacrificar nada: entre las opciones, la que menos pesa resultó ser
también la mejor. Lo que se descartó, y por qué, para que nadie lo reintroduzca
creyendo que mejora algo:

1. **Cuenta atrás en vivo.** Un `setInterval` por segundo y la primera isla de
   esta página, para un número que se entiende igual en horas y que R18 obliga a
   dar relativo de todos modos. Coste estimado si alguien insiste: ~0.4 KB gzip
   más el primer `"use client"` de la pantalla. Recomendación: no.
2. **`confirm()` del navegador.** Prohibido por el encargo, imposible sin JS y
   sin una palabra de copia editable.
3. **Pestañas «Actual / Propuesto».** Se pueden hacer con radios y CSS, pero
   esconden la mitad del dato justo cuando el criterio 1 exige que las dos
   estén presentes en el HTML.
4. **Deshabilitar el botón tras enviar.** Necesita JS y no aporta: lo resuelven
   el `UPDATE` condicional (R14), la idempotencia (E7) y el `303`.
5. **Refresco automático del estado.** Ya lo descartó F-010 y aquí valdría lo
   mismo: red constante para quien tiene conexión limitada.
6. **Contador vivo de caracteres del motivo.** El límite se dice en la ayuda y
   lo aplica el servidor.

## Textos

Español, tuteo, frases cortas, el mismo registro que ya usa la página. Los
importes se pintan con `formatMoney()` de `src/lib/money.ts` (locale `es-CU`);
en los ejemplos van como `$1,700.00`, y en las plantillas como `{total}`.

### La insignia de estado — la tabla completa

Los `switch` de `describe()` quedan así. Los seis primeros son de F-010 y solo
uno cambia; los demás son nuevos.

| Estado                                     | Etiqueta                             | Tono       | Explicación                                                                                                            |
| ------------------------------------------ | ------------------------------------ | ---------- | ---------------------------------------------------------------------------------------------------------------------- |
| `PENDING`                                  | `Pendiente de confirmación`          | `positive` | `La tienda todavía no lo revisó.`                                                                                      |
| `PULLED`                                   | `Recibido por la tienda`             | `positive` | `La tienda ya lo tiene en su sistema.`                                                                                 |
| `AWAITING_CUSTOMER`, plazo vivo            | `Esperando tu respuesta`             | `warning`  | `La tienda propuso un cambio en tu pedido. Apruébalo o recházalo aquí abajo.`                                          |
| `AWAITING_CUSTOMER`, plazo vencido (E12)   | `Sin respuesta a tiempo`             | `danger`   | `El plazo para responder se acabó. La tienda va a cancelar el pedido; si todavía lo quieres, escríbele.`               |
| `CONFIRMED`                                | `Confirmado`                         | `positive` | `La tienda confirmó tu pedido.`                                                                                        |
| `READY`, con envío **(cambia)**            | `Listo para enviar`                  | `positive` | `La tienda lo tiene listo para salir.` — antes decía `Va en camino.`, que ahora es `IN_TRANSIT` (criterio 9)           |
| `READY`, para recoger                      | `Listo para recoger`                 | `positive` | `Puedes pasar a recogerlo.`                                                                                            |
| `IN_TRANSIT`, con envío                    | `En camino`                          | `positive` | `Tu pedido va hacia la dirección que dejaste. Ten el teléfono a mano.`                                                 |
| `IN_TRANSIT`, para recoger (E22)           | `La tienda lo puso en camino`        | `warning`  | `Tu pedido era para recogerlo en la tienda, así que escríbeles antes de ir: puede que te lo estén llevando.`           |
| `DELIVERED`                                | `Entregado`                          | `muted`    | `Gracias por tu compra.`                                                                                               |
| `CANCELLED`, canceló el comprador (R9)     | `Cancelado por ti`                   | `muted`    | `Rechazaste el cambio que propuso la tienda, así que el pedido se canceló. Puedes hacer otro cuando quieras.`          |
| `CANCELLED`, venció la propuesta (R9)      | `Cancelado: no respondiste a tiempo` | `danger`   | `La propuesta de la tienda venció sin respuesta y el pedido se canceló. Si todavía lo quieres, escríbele a la tienda.` |
| `CANCELLED`, la canceló la tienda (R9)     | `Cancelado por la tienda`            | `danger`   | `La tienda canceló este pedido. Si no sabes por qué, contáctala.`                                                      |
| `CANCELLED`, sin atribución (filas viejas) | `Cancelado`                          | `danger`   | `La tienda canceló este pedido. Si no sabes por qué, contáctala.` — el texto de F-010, intacto                         |
| `REJECTED_BY_STORE`                        | `Rechazado por la tienda`            | `danger`   | `La tienda no pudo atender este pedido. No se te cobró nada. Si quieres saber por qué, escríbele.`                     |

Los **tres desenlaces de cancelación de R9 se dicen con palabras distintas**, y
la diferencia está en la etiqueta, no solo en la explicación: `Cancelado por
ti` · `Cancelado: no respondiste a tiempo` · `Cancelado por la tienda`. Con
`REJECTED_BY_STORE` son cuatro finales distinguibles a golpe de vista.

### La tira de propuesta

- Titular: `La tienda propone un cambio en tu pedido`
- Debajo: `Revísalo y responde. Si no respondes a tiempo, el pedido se cancela.`
- Enlace de salto: `Ver el cambio y responder`

### El panel

- Título: `La tienda propone un cambio`
- Plazo, según § 4.6: `Te quedan unas {N} horas para responder.` ·
  `Te queda alrededor de 1 hora para responder.` ·
  `Te queda menos de 1 hora para responder.` ·
  `Te quedan pocos minutos para responder.`
- Mensaje: `La tienda dice:` + la cita literal
- Sin mensaje: `La tienda no dejó un mensaje.`
- Cabecera de la diferencia: `Qué cambia`
- Frases de la diferencia (§ 4.4): `{producto}: sale del pedido (eran {n}
unidades).` · `{producto}: se agrega al pedido ({n} unidad/unidades).` ·
  `{producto}: antes {n} unidades, ahora {m}.` · `{producto}: antes {x} c/u,
ahora {y} c/u.` · `Envío: antes {x}, ahora {y}.` · `Envío: antes sin costo,
ahora {y}.` · `Subtotal: antes {x}, ahora {y}.`
- Cabecera de los totales: `Lo que pagarías`
- Etiquetas del `dl`: `Total actual` · `Total propuesto` · `Diferencia`
- Diferencia: `{importe} más` · `{importe} menos`
- Total sin cambio: `El total no cambia: sigue siendo {total}.`
- Cierre del panel: `Si no respondes antes de que se acabe el plazo, el pedido
se cancela solo.`
- Salida lateral: `Escribirle a la tienda`

### Los dos botones

**Aprobar**

- `<summary>`: `Aprobar el cambio`
- Dentro: `Vas a aceptar el cambio: pagarías {total propuesto} en vez de {total
actual}. La tienda prepara tu pedido con estos importes y te contacta por
teléfono.`
- Botón: `Sí, acepto pagar {total propuesto}`
- Debajo del botón: `Se paga contra entrega, como siempre: aquí no se cobra
nada.`

**Rechazar**

- `<summary>`: `Rechazar el cambio`
- Dentro: `Si rechazas, el pedido se cancela y la tienda no lo prepara. No pasa
nada: puedes hacer otro cuando quieras.`
- `<legend>`: `¿Por qué lo rechazas?`
- Motivos (el primero marcado por defecto): `El precio nuevo no me sirve` ·
  `Ya no necesito el pedido` · `No estoy de acuerdo con lo que quitaron` ·
  `Otro motivo`
- `<label>` del texto libre: `Cuéntale a la tienda, si quieres`
- Ayuda: `Opcional, hasta 200 caracteres. Lo va a leer la tienda.`
- Botón: `Sí, rechazar y cancelar el pedido`

### La propuesta vencida (estado 5 de § 4.2)

- Título del panel: `Esta propuesta venció`
- Cuerpo: `El plazo para responder se acabó, así que ya no se puede aprobar ni
rechazar. La tienda va a cancelar el pedido.`
- Después: `Si todavía lo quieres, escríbele a la tienda o haz el pedido de
nuevo.`
- Enlaces: `Escribirle a la tienda` · `Ver el catálogo`
- Motivo, cuando el pedido ya está cancelado por vencimiento, literal de R6:
  `La propuesta venció sin respuesta`

### Los banners de resultado

Los ocho de la tabla de § 4.5, literales:

- `Aprobaste el cambio.` / `La tienda ya lo sabe y prepara tu pedido con los
importes nuevos.`
- `Rechazaste el cambio y el pedido quedó cancelado.` / `La tienda ya lo sabe.`
- `No pudimos registrar tu respuesta: el plazo ya se había acabado.`
- `La tienda cambió la propuesta mientras la mirabas. Abajo está la nueva.`
- `No pudimos registrar tu respuesta: la tienda cerró este pedido mientras
respondías.`
- `Este pedido ya tenía una respuesta registrada, y no era esa.`
- `Recibimos varias respuestas seguidas. Espera un momento y vuelve a
intentarlo.`
- `No pudimos registrar tu respuesta. No se cambió nada: vuelve a intentarlo.`

### Las líneas y la nota del cambio aprobado

- Título de la lista propuesta: `Tu pedido si aceptas el cambio` + `Badge`
  `Propuesta`
- Revelación de la lista vigente: `Ver tu pedido tal como está ahora`
- Nota bajo la tabla, en cualquier estado posterior a una aprobación:
  `Este pedido incluye un cambio que aprobaste.` + revelación `Ver qué cambió`

### El `wa.me` corto hacia la tienda

Texto exacto antes de URL-encodear, sin importes —los importes están en
discusión y meterlos en el mensaje sería fijar una versión u otra—:

```
Hola {store.name}, es sobre mi pedido {A7K3M-9PQR2}.
```

## Verificación visual

`V1`–`V6` no necesitan navegador. `V7`–`V16` sí, y **no se ejecutaron en este
ciclo**: las capturas no siguieron al redimensionado de la ventana (§ Qué se
miró). Con `npm run dev` en un puerto que no sea el `3100` del sensor.

- **V1** — `curl -s $BASE/tienda-demo/pedido/$CODE` sobre un pedido en
  `AWAITING_CUSTOMER` trae **los dos importes**, el actual y el propuesto,
  distintos y los dos presentes. Es el criterio 1, y se comprueba sobre el HTML,
  no sobre la fila.
- **V2** — el mismo HTML trae `<form method="post"` **dos veces** y
  `<details>` al menos dos: aprobar y rechazar existen sin JavaScript (R16, E9).
- **V3** — el mismo HTML **no** trae `wa.me` con el mensaje del pedido completo
  mientras hay propuesta viva (DP1), pero sí el enlace corto a la tienda.
- **V4** — `grep -o '_next/static/chunks[^"]*' | sort -u | wc -l` sobre la
  página del pedido da **el mismo número** que sobre `/tienda-demo`. Hoy son 20
  y 20. Si sube, alguien metió un `"use client"`.
- **V5** — con el pedido en `IN_TRANSIT` y `deliveryAddress` no nulo, el HTML
  dice `En camino`; con `deliveryAddress` nulo, dice `La tienda lo puso en
camino`. Los dos textos **no** aparecen en el HTML de un pedido `READY`
  (criterio 9).
- **V6** — con `expiresAt` puesto a `now() - interval '1 hour'` y **sin** correr
  el cron, el HTML dice `Esta propuesta venció` y **no** contiene ningún
  `<form method="post"` (E12).
- **V7** — 360 px, propuesta viva con seis líneas: sin scroll horizontal, el
  enlace `Ver el cambio y responder` lleva al panel, y los dos `<summary>` miden
  ≥ 44 px de alto.
- **V8** — 360 px: abrir `Rechazar el cambio` con el teclado en pantalla; los
  cuatro motivos y el botón quedan alcanzables sin que nada flote encima.
- **V9** — 768 px y 1280 px: el `dl` de totales pasa a dos columnas, las dos
  acciones siguen apiladas y la rejilla de las dos tarjetas es la de hoy.
- **V10** — **Sin JavaScript** (DevTools, _Disable JavaScript_): aprobar y
  rechazar funcionan de punta a punta, incluida la vuelta con el banner. Es el
  paso que decide si este diseño cumple R16.
- **V11** — recargar (F5) después de responder: **no aparece** el diálogo de
  reenviar el formulario. Si aparece, el `303` no está.
- **V12** — el foco después de responder está en el banner, sin tocar el ratón:
  pulsar Tab una vez lleva al primer enlace del contenido, no a la cabecera.
- **V13** — **contraste**, con el inspector: dentro del panel y de los banners,
  todo el cuerpo de texto ≥ 4.5:1 en claro y en oscuro. Mirar en concreto el
  `Alert tone="warning"` y el plazo en `text-danger`.
- **V14** — **Branding**: la misma propuesta en `/tienda-dos` (verde,
  `radius: round`): el botón de aprobar es verde, la tarjeta se redondea, y los
  dos totales siguen igual de legibles porque no dependen de `brand`.
- **V15** — **Oscuro** (`prefers-color-scheme: dark`): la tira `warning`, la
  insignia `Cancelado: no respondiste a tiempo` y la cita del mensaje.
- **V16** — **Lector de pantalla** (VoiceOver): entrar al panel por landmark,
  oír `Total actual … Total propuesto … Diferencia … más`, oír el estado
  expandido del `<details>` y oír el botón con su importe dentro.

## Preguntas al humano

Las cinco llevan aplicada la opción recomendada, así que el documento se puede
implementar tal cual si no respondes ninguna. Bloquean la firma de plan.md, no
este diseño.

**DP1 — Con propuesta viva, ¿se esconde el enlace `Enviar el pedido por
WhatsApp`?**
_Qué está en juego:_ ese enlace arma un mensaje con los importes **viejos** y
lo manda a la tienda. Ofrecerlo mientras hay un cambio en discusión invita a
reenviar un pedido que ya no es el que se está negociando.
_Opciones:_ (a) esconderlo mientras el pedido está en `AWAITING_CUSTOMER` y
ofrecer en su lugar un enlace corto `Escribirle a la tienda` con solo el
código; (b) dejarlo como está; (c) esconderlo y no ofrecer nada.
_Recomendación:_ (a), y es lo que está aplicado.

**DP2 — ¿Se puede sustituir, en los estados nuevos, el párrafo que aprobaste
literal en F-010 DP4?**
_Qué está en juego:_ «La tienda va a revisar tu pedido y te va a contactar por
teléfono para confirmarlo» es falso con una propuesta encima de la mesa —ya lo
revisó y ya te contactó— y falso en `REJECTED_BY_STORE`.
_Opciones:_ (a) el párrafo se sigue mostrando **igual y literal** en los
estados de F-010, y en `AWAITING_CUSTOMER` / `CANCELLED` / `REJECTED_BY_STORE`
lo sustituye la copia de este documento; (b) mostrarlo siempre; (c) reescribirlo
para todos los estados.
_Recomendación:_ (a). No cambia ni una palabra de lo que firmaste, solo deja de
decirlo donde no es cierto. Aplicado.

**DP3 — El motivo del rechazo: ¿motivos predefinidos o texto libre?**
_Qué está en juego:_ el criterio 3 exige `cancelReason` no nulo, y ese texto lo
lee el encargado en cuadrecaja. Un `<textarea>` obligatorio en un teléfono es
fricción justo en el momento en que alguien ya está molesto.
_Opciones:_ (a) cuatro motivos en radios, el primero marcado, más un texto
libre opcional de 200 caracteres; (b) solo texto libre obligatorio; (c) sin
motivo, con un `cancelReason` fijo puesto por el servidor.
_Recomendación:_ (a): garantiza el dato, no bloquea a nadie y le da al encargado
algo accionable. Aplicado. Si tienes motivos mejores para la lista, cámbialos:
son cuatro cadenas.

**DP4 — ¿La página deja rastro del cambio después de aprobarlo?**
_Qué está en juego:_ el comprador tiene en su WhatsApp el comprobante con los
importes viejos. Si la página pasa a mostrar los nuevos sin decir nada, la
diferencia se lee como un cobro de más.
_Opciones:_ (a) una nota `muted` bajo la tabla —`Este pedido incluye un cambio
que aprobaste.`— con la diferencia plegada en un `<details>`; (b) no mostrar
nada; (c) mostrar la diferencia siempre desplegada.
_Recomendación:_ (a). Aplicado. Nota para el arquitecto: exige **conservar** la
propuesta aprobada, no sobrescribirla al aplicarla.

**DP5 — `IN_TRANSIT` sobre un pedido de retiro: ¿describir o pedir que
contacte?**
_Qué está en juego:_ E22 solo exige que la página «no rompa ni mienta». El POS
es la autoridad (R15) y puede marcar en camino un pedido que el comprador iba a
recoger; puede ser un error del encargado o un reparto de cortesía.
_Opciones:_ (a) etiqueta `La tienda lo puso en camino`, tono `warning`, y la
explicación que le dice que escriba antes de ir; (b) la misma copia que el
envío, `En camino`; (c) copia neutra que no sugiera nada.
_Recomendación:_ (a). Es la única que no manda a alguien a la tienda a buscar un
pedido que va de camino a su casa. Aplicado.
