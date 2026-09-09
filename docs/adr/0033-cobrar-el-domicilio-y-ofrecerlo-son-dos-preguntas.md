# 0033 — Con qué cobrar el domicilio y ofrecerlo a un comprador son dos preguntas distintas

**Propuesta** · 9 de septiembre de 2026 · F-041 — pasa a **Aceptada** cuando
F-041 esté construido, verificado y fusionado, como hizo
[ADR 0017](0017-frontera-de-escritura-del-panel.md) con su propia versión.

**Estrecha el invariante (e) de
[ADR 0028](0028-configuracion-de-compra-del-pos.md)**, así que no puede ser una
nota dentro de ella (AGENTS.md § Documentación: «contradecir una decisión
publicada exige una ADR nueva que la supere»). 0028 (e) dice, con esas
palabras, cuál es el estado que el sync nunca debe escribir; esta ADR cambia
**para quién** aplica esa regla, sin tocar lo que ya es cierto para los dos
modos que existían antes.

## Contexto

0028 (e) fija el invariante: una fila del sync nunca queda con
`deliveryEnabled = true` **y** nada con qué cobrar el domicilio — hoy,
`deliveryFeeMode = FLAT_RATE` **y** `deliveryFee IS NULL`. La comprobación era,
hasta F-041, una sola función: `isDeliveryConfigInconsistent` se escribía en
términos de `isDeliveryOffered`
(`src/features/orders/deliveryOffer.ts:42-44`), porque para `FLAT_RATE` y
`QUOTED_PER_ORDER` «¿tiene esta configuración con qué cobrar?» y «¿se le puede
ofrecer domicilio a este comprador ahora mismo?» daban siempre la misma
respuesta.

`ZONE_BASED` (F-041) rompe esa coincidencia. Con qué cobrar es **el
tarifario** — una entidad distinta del sobre (`ZONE_TARIFF`) que puede llegar
después de la fila `Store` y cambiar sin que ella se toque. Si
`isDeliveryConfigInconsistent` se siguiera escribiendo en términos de
`isDeliveryOffered`, y este feature necesita que `isDeliveryOffered` conteste
`false` para `ZONE_BASED` hasta que exista el selector de F-042, entonces
**toda** tienda `ZONE_BASED` con `deliveryEnabled: true` fallaría con
`STORE_DELIVERY_CONFIG_INCONSISTENT` para siempre — el POS no podría configurar
el modo que este feature existe para dar.

## Decisión

**Dos funciones, cada una con un `switch` exhaustivo sobre el enum generado, en
vez de una escrita en términos de la otra.**

1. **`hasSomethingToChargeDeliveryWith`** — la pregunta de la CONFIGURACIÓN, y
   la que ahora protege el invariante de 0028 (e). En `ZONE_BASED` contesta
   **SÍ**: el tarifario existe como concepto aunque hoy esté vacío, y llega por
   una entidad que el sync todavía no ha visto en el mismo evento.
2. **`isDeliveryOffered`** — la pregunta del COMPRADOR. En `ZONE_BASED`, hasta
   que exista el selector de F-042, contesta **NO**: no hay zona que resolver,
   así que la respuesta honesta es que hoy no se puede cerrar ese envío.
   F-042 sustituye esta rama por su propio criterio 9 («¿tiene esta tienda
   alguna zona con tarifa resoluble?»).

`isDeliveryConfigInconsistent` pasa a escribirse en términos de la primera, no
de la segunda:

```ts
config.deliveryEnabled && !hasSomethingToChargeDeliveryWith(config);
```

El `deliveryFee` residual de la columna **no se cobra nunca** en `ZONE_BASED`
(sigue siendo el importe de `FLAT_RATE`), y el sync **no lo borra por su
cuenta** — «omitir no es apagar» sigue aplicando, igual que en
`QUOTED_PER_ORDER`. Y `ZONE_BASED` y `QUOTED_PER_ORDER` son excluyentes: nunca
entran en el mismo ciclo de cotización.

## Consecuencias

- **`deliveryFeeForNewOrder` gana una tercera rama que LANZA para
  `ZONE_BASED` + `"DELIVERY"`.** Es inalcanzable por construcción —
  `createOrder.ts` decide `isDelivery` con `isDeliveryOffered`, que para
  `ZONE_BASED` es `false` hasta F-042—, y si alguna vez se alcanzara, un `500`
  visible es preferible a cobrar `"0.00"` de envío en silencio.
- **Una tienda `ZONE_BASED` con `deliveryEnabled: true` se acepta y se guarda
  desde el primer día**, aunque su tarifario esté vacío — degrada a recogida en
  silencio hasta F-042 (decisión del humano SP2 de `spec.md`).
- **El día que aparezca un quinto modo**, `npm run typecheck` avisará antes que
  nadie: los dos `switch` tienen `default` con `never`, que nombra el modo sin
  case en el mensaje de error.
- **La DA1 de F-031** — «el día que aparezca un tercer `DeliveryFeeMode` hay
  exactamente un sitio que decide si hay con qué cerrar el domicilio» — acertó
  en el sitio y se equivocó en la forma: había un sitio, pero contestaba dos
  preguntas a la vez sin saberlo, porque hasta ahora coincidían.

## Alternativas descartadas

- **Ofrecer domicilio en `ZONE_BASED` sin cotizar** (reusar el ciclo de
  F-019/F-031). Reintroduce el ciclo de propuesta y aprobación que este
  feature existe para eliminar cuando el comercio ya sabe su tarifario.
- **Cobrar el `deliveryFee` residual de la columna.** Es la que la spec
  descarta con estas palabras: «sería el fallo silencioso más caro que este
  feature puede introducir» — cobrar un importe que nadie fijó para esa zona.
- **Seguir escribiendo `isDeliveryConfigInconsistent` en términos de
  `isDeliveryOffered`.** Es la forma de hoy, y es exactamente lo que hace
  imposible configurar una tienda `ZONE_BASED` con domicilio (I4 de
  `architecture.md`).

## Lo que esta ADR no decide

- **Qué contesta `isDeliveryOffered` para `ZONE_BASED` después de F-042.** Ese
  feature sustituye la rama entera por su criterio 9.
- **El selector de zona, el mapa o `contact.zoneCode`.** Son de F-042.

## Reabrir cuando

- **F-042 exista** y `isDeliveryOffered` necesite su pregunta de verdad para
  `ZONE_BASED` — la sustitución ya está anticipada en el propio código con un
  comentario que cita esta ADR.
- **Aparezca un modo de envío nuevo.** `npm run typecheck` lo señala antes de
  que se le pueda escapar a nadie.
