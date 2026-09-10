---
feature: F-040
agente: sdd-tester
actualizado: 2026-09-10T21:55:00Z
estado: listo
veredicto: listo
---

## Estrategia

Tres niveles, cada uno en el entorno que `AGENTS.md` § Cosas que muerden
manda por la extensión del archivo:

- **Unitario, proyecto `node` (`*.test.ts`)**: ya escrito por el
  implementador antes de este ciclo —
  `src/features/catalog/unpricedCatalog.test.ts` (R1-R3, E16, E17, E18, sin
  Prisma) y los casos nuevos de `src/lib/storeClosure.test.ts` (la frase,
  E19 con `isStoreDisabledReasonCode`/`storeStatusBodySchema`, la línea de
  cierre, el mensaje de WhatsApp). Los dos corren dentro de `npm test`, que
  este documento vuelve a ejecutar, no solo cita.
- **Runtime, HTTP real (`.agent/specs/F-040/smoke.sh`)**: los criterios 1,
  2, 3, 4, 5 y 7 — los que exigen "sembrando" o "ejecutando" contra una
  tienda de verdad. Siembra su propio fixture con
  `.agent/specs/F-040/seed-muted-store.ts` (Prisma directo — ver § Por qué
  no `dbFixtures.ts`) y lo borra al terminar, pase lo que pase (`trap`).
- **Manual, una sola vez, documentado para repetirlo**: el criterio 6 —
  conteo de consultas de Prisma con el mismo procedimiento de
  `.agent/specs/F-025/tests.md`, sobre dos estados del código (antes/después
  del feature) obtenidos con `git stash`, no con la app en pie de
  `--smoke` (esa solo ve el código de HOY).
- **Navegador real, `.agent/specs/F-040/visual.mjs`**: los seis pasos que
  `design.md` § «Lo que queda por mirar cuando el código exista» deja
  pendientes — lo que `curl`/`smoke.sh` no pueden ver porque solo miran el
  HTML servido, nunca lo que pasa **después** de que el cliente hidrata.
  Reusa el mismo `seed-muted-store.ts`. **Encontró un fallo real** en su
  primera corrida — bajó el veredicto a `no-listo` un ciclo — y ya lo
  confirma corregido en su segunda: ver § Verificación visual y
  § Fallos encontrados.

### Por qué no `dbFixtures.ts`

El implementador señaló `src/features/marketplace/server/dbFixtures.ts`
(`createFixtureSession`) como la maquinaria a reutilizar. Se evaluó y se
descartó por dos motivos, los dos verificados ejecutando, no leyendo:

1. `createFixtureSession()` no deja fijar `Business.baseCurrencyCode` (crea
   siempre con el valor por defecto de la columna, `"CUP"`) — y el criterio 1
   exige literalmente una base **sin tasa**, código distinto de `"CUP"`.
2. El `Storefront` que crea no lleva ninguna fila `Slug`, así que
   `resolvePublicSlug` (lo que usan las siete vistas públicas) no lo
   resuelve — el mismo hallazgo que ya documenta
   `src/features/orders/server/createOrder.zone.db.test.ts` para
   `session.createStore()`.

`.agent/specs/F-040/seed-muted-store.ts` reescribe el mismo patrón
(un negocio por escenario, prefijo de IDs propio, limpieza explícita)
directamente con Prisma, sin tocar `dbFixtures.ts` ni ningún dato de
`prisma/seed.ts`. Modos `up [sufijo]` / `down <sufijo>`; el sufijo por
defecto es `Date.now()` y `smoke.sh` genera el suyo propio
(`f040sm$(date +%s)`) para no colisionar con otra corrida sobre el mismo
Postgres compartido entre worktrees.

## Mapa criterio → prueba

| Criterio de aceptación                                                          | Prueba                                                                                                                                                                                                                                                                        | Archivo                                                                                                | Resultado |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | --------- |
| 1 — tienda CON productos, NINGUNO resuelve precio → estado de cierre con motivo | `smoke.sh` § criterio 1 (E1: base `XXX` sin tasa) + § E16 (base `CUP`, productos en `EUR` sin tasa) por HTTP. `visual.mjs` V1/V4 (E5/E6, en navegador, tras hidratar) — el primer ciclo encontró V4 en rojo; corregido y **reverificado en verde** (§ Fallos encontrados, F1) | `.agent/specs/F-040/smoke.sh`, `.agent/specs/F-040/visual.mjs`; unitario: `unpricedCatalog.test.ts` R1 | **LISTO** |
| 2 — SOLO ALGUNOS sin precio → catálogo con los que sí, sin aviso                | `smoke.sh` § criterio 2 (E2): dos productos con precio real, uno sin tasa, sin la frase de cierre                                                                                                                                                                             | `.agent/specs/F-040/smoke.sh`; unitario: `unpricedCatalog.test.ts` "resolves false when at least one…" | **LISTO** |
| 3 — tienda publicada sin productos → catálogo vacío de siempre, sin marcar      | `smoke.sh` § criterio 3 (E3)                                                                                                                                                                                                                                                  | `.agent/specs/F-040/smoke.sh`; unitario: `unpricedCatalog.test.ts` R3                                  | **LISTO** |
| 4 — la detección no escribe nada (fila idéntica antes/después)                  | `smoke.sh` § criterio 4 (E10): `SELECT status, disabledReasonCode, disabledMessage, disabledAt` antes y después de las siete visitas                                                                                                                                          | `.agent/specs/F-040/smoke.sh`; unitario: `storeClosure.test.ts` E19                                    | **LISTO** |
| 5 — crear un pedido no responde 500 ni deja importes inválidos                  | `smoke.sh` § criterio 5 (E11 `/api/orders/quote` → 200 `NO_PRICE`; E12 `/api/orders` PICKUP y DELIVERY/`ZONE_BASED` → 409 `ITEMS_UNAVAILABLE`, `count(*)` sin cambios, cero filas con importes `NULL`)                                                                        | `.agent/specs/F-040/smoke.sh`                                                                          | **LISTO** |
| 6 — la condición no añade ninguna consulta (ADR 0025)                           | Log de consultas de Prisma, antes/después del feature vía `git stash` — ver § Cómo se contó el criterio 6                                                                                                                                                                     | procedimiento manual, este documento                                                                   | **LISTO** |
| 7 — la ficha de producto dice lo mismo que la portada                           | `smoke.sh` § criterio 7 (E4) por HTTP + `visual.mjs` V1 (las siete, incluida la ficha, comparadas EN NAVEGADOR tras hidratar): sin importe, sin botón de carrito, sin "Consultar precio"                                                                                      | `.agent/specs/F-040/smoke.sh`, `.agent/specs/F-040/visual.mjs`                                         | **LISTO** |
| 8 — `bash .agent/verify.sh F-040 --full` termina en 0                           | § Ejecuciones → El sensor                                                                                                                                                                                                                                                     | —                                                                                                      | **LISTO** |

**8 de 8 LISTO.** El criterio 1 pasó por dos ciclos: el primero lo dejó en
NO LISTO (parcial) porque `visual.mjs` —el navegador real, que `smoke.sh`
no puede simular— destapó que `/[slug]/c/no-existe` bajo una tienda muda
decía lo correcto en el HTML servido y luego, tras hidratar, lo cambiaba
por el `not-found.tsx` de la categoría. El implementador lo corrigió
(§ Fallos encontrados, F1) y la reverificación —`bash .agent/verify.sh
F-040 --visual`, V4 en verde, 0 `VISUAL FAIL`— lo sube a LISTO. Los ocho
criterios se verificaron ejecutando algo real: HTTP contra una tienda
sembrada, `psql`, el log de Prisma, un navegador de verdad, o `npm test` —
ninguno se dio por bueno leyendo el código implementado y razonando que
debería funcionar.

## Cómo se contó el criterio 6

**No existe contador de consultas en este repo** (confirmado leyendo
`.agent/specs/F-025/tests.md` y `architecture.md`, que son las dos únicas
referencias). Se usó el primero de los dos procedimientos que deja escritos
F-025 — el log de consultas de Prisma —, no el delta de `xact_commit` de
`pg_stat_database`: ese segundo exige parar todo lo demás que hable con la
base compartida entre worktrees, y aquí hay al menos otro worktree con sus
propios procesos (`AGENTS.md` § Emuladores compartidos), así que no es
reproducible sin coordinación externa. El de Prisma sí lo es: aísla por
proceso (`next dev` propio en un puerto propio) y no depende de qué más
esté tocando la base al mismo tiempo.

**La app en pie de `--smoke` no sirve para este criterio**: solo existe el
código de HOY (con el feature), así que no hay «antes» con el que comparar
dentro de esa misma corrida. El único «antes» reproducible es el código sin
el feature, y la única forma de tenerlo en este worktree sin perder el
trabajo es revertirlo temporalmente con `git stash` (la misma técnica que ya
usó F-025, con los 16 archivos que `impl.md` lista) y no un checkout de
otra rama, que se llevaría por delante los documentos de `.agent/` que este
mismo ciclo necesita.

### Procedimiento exacto (repetible)

1. `cp src/lib/prisma.ts /tmp/prisma.ts.orig`; cambiar el `log` del
   `PrismaClient` (`src/lib/prisma.ts:42`) a
   `["query", "warn", "error"]` — temporal, revertido byte a byte al
   final (`git diff --stat src/lib/prisma.ts` vacío al cerrar).
2. Objetivo: las **cuatro** URL donde el criterio 6 se cuenta (E13) —
   `/tienda-demo`, `/tienda-demo/p/jugo-de-mango-1-l`,
   `/tienda-demo/catalogo`, `/tienda-demo/c/bebidas` — el mismo fixture ya
   sembrado que usa `F-025`. Para cada una, en los DOS estados del código
   (antes/después): `rm -rf .next`, `npx next dev -p <puerto>`, calentar con
   `GET /` una vez (0 consultas — no toca ningún catálogo), marcar el número
   de líneas `^prisma:query` del log del servidor, pedir la URL objetivo UNA
   vez, y volver a contar — el delta es el coste de esa URL. Servidor propio
   por medición (no un único servidor reutilizado entre las cuatro URL): así
   ninguna se beneficia de la caché de datos que otra ya calentó, y el mismo
   cuidado se repite en los dos estados.
3. **Después** (working tree tal cual, el feature completo):

   | URL                                | `prisma:query` |
   | ---------------------------------- | -------------: |
   | `/tienda-demo`                     |             24 |
   | `/tienda-demo/p/jugo-de-mango-1-l` |             60 |
   | `/tienda-demo/catalogo`            |             26 |
   | `/tienda-demo/c/bebidas`           |             60 |

4. **Antes**: `git stash push -u -m "<tag>"` sobre los 17 archivos que
   `impl.md` lista como tocados/creados (los 15 modificados más los 2
   nuevos — nunca `git stash` a secas, que también se habría llevado los
   cuatro `.md` de `.agent/playbook/` que otra sesión tenía tocados y que
   no son de este feature). `git stash list --format='%H %gs'` para anotar
   el SHA exacto antes de seguir. Con el feature fuera (confirmado:
   `ls src/features/catalog/unpricedCatalog.ts` → «No such file»), se repite
   el mismo procedimiento del paso 2:

   | URL                                | `prisma:query` |
   | ---------------------------------- | -------------: |
   | `/tienda-demo`                     |             24 |
   | `/tienda-demo/p/jugo-de-mango-1-l` |             60 |
   | `/tienda-demo/catalogo`            |             26 |
   | `/tienda-demo/c/bebidas`           |             60 |

5. `git stash apply <sha>` (no `pop` — el stack de `stash` se comparte entre
   worktrees) para devolver el feature, verificado con `git status --short`
   contra el estado de partida; `git stash drop <sha>` una vez confirmado
   que el working tree coincide byte a byte con el de antes de empezar.
   `cp /tmp/prisma.ts.orig src/lib/prisma.ts` — revertido,
   `git diff --stat -- src/lib/prisma.ts` vacío.

**24 = 24, 60 = 60, 26 = 26, 60 = 60.** Las cuatro vistas de catálogo piden
exactamente el mismo número de consultas con y sin el feature: `E13` se
cumple, tal como `architecture.md` AD5 lo predice por construcción
(`getStoreCatalogPricing` sustituye las dos entradas del `Promise.all` sin
añadir ninguna lectura propia).

**Nota de honestidad, porque el protocolo lo exige**: la primera pasada
(midiendo las cuatro URL una tras otra dentro del MISMO servidor, sin
reiniciarlo entre cada una) dio dos discrepancias de ±1 — `/catalogo` (25 en
«antes», 26 en «después») y `/c/bebidas` (60 en «antes», 59 en «después»).
Investigado antes de concluir nada: al repetir cada medición de forma
aislada (servidor propio, `.next` limpio, una sola URL por corrida — el
procedimiento que queda escrito arriba), las dos convergieron a un número
idéntico en los dos estados, dos veces seguidas. La causa más probable es
ruido de temporización del primer método (un `sleep` fijo entre la petición
y la lectura del log, con varias URL compartiendo el mismo proceso y su
caché de datos calentándose de forma distinta según el orden), no una
consulta real que el feature añada o quite. Se documenta en vez de
esconderse: si alguien repite el procedimiento AISLADO de arriba y no
obtiene 24/60/26/60 en los dos lados, es una señal real y hay que
reabrir el criterio.

## Verificación visual

`.agent/specs/F-040/visual.mjs`, copiado de `.agent/templates/visual.mjs`.
Traduce los seis pasos de `design.md` § «Lo que queda por mirar cuando el
código exista» a aserciones de Playwright, con su propio fixture (el mismo
`seed-muted-store.ts` que `smoke.sh`, sembrado y borrado en el `finally`,
pase lo que pase). Se repite con:

```bash
bash .agent/verify.sh F-040 --visual
```

**Primer ciclo** (`.agent/runs/F-040/031-visual.log`, corrida completa con
`--full --smoke --visual`): código de salida `1`. 69 aserciones, **68
`ok`, 1 `VISUAL FAIL`** — el único fallo, en V4.

**Segundo ciclo, tras el arreglo del implementador**
(`.agent/runs/F-040/039-visual.log`, misma corrida completa): **código de
salida `0`. 69 aserciones, las 69 `ok`.** `V4` pasa entero (8/8, incluida
«la MISMA frase que la portada» para `categoria-no-existe`, que era la que
fallaba). El resto —V1, V2, V3, V5, V6— sigue en verde: el arreglo no movió
nada de lo que ya pasaba.

| Paso                                                                 | Qué comprobó                                                                                                                                                                                                                                                              | 1er ciclo        | 2do ciclo |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | --------- |
| V1 — las siete vistas de una tienda muda de verdad, a 360px          | Sin scroll horizontal; la MISMA cadena exacta en las siete (comparada entre sí, no contra un literal repetido siete veces); cero `.shadow-card` (tarjetas); sin "Consultar"/"Agotado"/"Pocas unidades"; sin ningún `$NN.NN`                                               | 49/49 ok         | 49/49 ok  |
| V2 — `disabledMessage` no deja rastro                                | Cero nodos `.whitespace-pre-line` en el DOM — la clase que `StoreClosedNotice.tsx` solo usa para el párrafo del cierre del comerciante; no solo oculto, AUSENTE                                                                                                           | 1/1 ok           | 1/1 ok    |
| V3 — marca propia: botón teñido, aviso no                            | El botón de WhatsApp de una tienda con `themeTokens` propios usa un color computado DISTINTO del de la paleta por defecto (`tienda-principal`, control); el aviso (`role="alert"`, tono `warning`) usa el MISMO color con marca propia y sin ella                         | 2/2 ok           | 2/2 ok    |
| V4 — `/p/no-existe` y `/c/no-existe` bajo tienda muda                | Las dos responden 200 (nunca 404); ninguna nombra el producto ni la categoría; la MISMA frase que la portada en navegador, tras hidratar                                                                                                                                  | **7/8, 1 FALLA** | **8/8**   |
| V5 — comparación con una tienda cerrada de verdad (`tienda-cerrada`) | La tienda muda nunca dice "cerrada" ni "cerrado"; el MISMO componente (misma clase de `Alert`) en las dos; pero la FRASE es distinta                                                                                                                                      | 4/4 ok           | 4/4 ok    |
| V6 — recuperación en vivo (E14)                                      | Antes: sigue muda. Se manda un `EXCHANGE_RATE` real por `/api/internal/sync/catalog` (con un `syncToken` propio del negocio mudo, minteado igual que `dbFixtures.ts`) — `207`, `ok:[eventId]`. Se recarga: CERO avisos, sin "Consultar", al menos una tarjeta de producto | 5/5 ok           | 5/5 ok    |

**Dos problemas de la prueba, ninguno de producto, corregidos antes de
confiar en el resultado** (por eso el número de aserciones "ok" es alto y
no un accidente):

- `page.getByRole("alert")` encuentra TAMBIÉN el
  `<div id="__next-route-announcer__" role="alert">` que Next inyecta en
  cada página (el anunciador de ruta para lectores de pantalla) —
  `.first()` a veces daba el anunciador (vacío) en vez del aviso real, o
  el conteo "cero avisos" de V6 nunca podía dar `0` porque el anunciador
  siempre está ahí. Arreglado con un selector que lo excluye por `id`
  (`avisoLocator()` en `visual.mjs`).
- `page.locator("body").textContent()` incluye el texto de los `<script>`
  con el payload de streaming de React — una referencia interna como
  `"sesion-cerrada"` dentro de ese JSON se colaba como si fuera texto
  visible y hacía fallar V5 con un falso "la tienda muda SÍ dice
  'cerrada'". Arreglado usando `innerText()` (respeta el layout calculado,
  como lo vería quien mira la pantalla).

## Fallos encontrados

**F1 — severidad: media. RESUELTO, reverificado ejecutando.**
`/[slug]/c/[categorySlug]` bajo una tienda muda,
con un `categorySlug` que no existe: el HTML servido es correcto (200, con
la frase del cierre — lo que `smoke.sh`/`curl` ven), pero **tras hidratar
el cliente** (~300-500 ms después, confirmado en `next dev` Y en
`next build && next start` — no es un artefacto de Turbopack ni de HMR), el
DOM se sustituye por el `not-found.tsx` de la categoría
(`src/app/[slug]/c/[categorySlug]/not-found.tsx`, "Esta categoría ya no
está"). Viola R7/E6 de `spec.md` («bajo una tienda muda, un categorySlug
que no existe enseña el aviso en vez de 404») y el punto 4 de `design.md`
§ Verificación visual — en el navegador real, no en la respuesta HTTP cruda.

**Causa exacta**, `src/app/[slug]/c/[categorySlug]/page.tsx:47-70`
(`generateMetadata`): comprueba `store.status !== "PUBLISHED"` pero **nunca**
`pricing.unpriced` antes de `const view = await getStoreCategoryView(...);
if (!view) notFound();` — a diferencia del CUERPO de la página (líneas
~124-145), que sí tiene la guarda `if (pricing.unpriced) { return <aviso/> }`
ANTES de mirar `!view` (arquitectura AD7). El servidor manda el HTML del
cuerpo (correcto) pero streamea TAMBIÉN, en el mismo documento, el segmento
`not-found` que `generateMetadata` disparó por su cuenta; el cliente lo
adopta al hidratar. `/[slug]/p/[productSlug]/page.tsx` no tiene este
problema: su `generateMetadata` nunca llama a `notFound()` para un producto
que no existe, solo devuelve `{ title: "Producto no encontrado" }`.

**Reproducción exacta**:

```bash
bash .agent/verify.sh F-040 --visual
grep -aEi -- 'VISUAL FAIL V4 \(categoria-no-existe\)' .agent/runs/F-040/031-visual.log
```

o a mano: sembrar el fixture (`npx tsx .agent/specs/F-040/seed-muted-store.ts
up x1`), abrir `/<slug-muda>/c/no-existe` en un navegador de verdad (no
`curl`) y esperar medio segundo — el texto cambia solo.

**El arreglo que aplicó `sdd-implementer`** (la primera opción de la
ficha): `generateMetadata` ahora lee `getStoreCatalogPricing` (memoizada
con `cache()` de React — no añade ninguna consulta, la misma entrada que ya
paga el cuerpo) justo después del chequeo de `status`, y si
`pricing.unpriced` devuelve `{ title: "${store.name} · No disponible
ahora", robots: { index: false } }` — la MISMA forma que la rama de tienda
cerrada, sin nombrar la categoría — **antes** de llegar a
`getStoreCategoryView`/`notFound()`. Mismo orden que el cuerpo, AD7.

**Reverificado, en tres frentes, ejecutando cada uno — no leyendo el
diff y confiando**:

1. `bash .agent/verify.sh F-040 --visual` → código `0`, V4 8/8 (§ Verificación
   visual, segundo ciclo). `.agent/runs/F-040/039-visual.log`.
2. **Que la metadata nueva no filtra nada**: sembrado el fixture
   (`npx tsx .agent/specs/F-040/seed-muted-store.ts up f040meta1`), `curl`
   directo a `/<slug-muda>/c/no-existe` contra un `next dev` propio —
   `<title>F-040 muda base f040meta1 · No disponible ahora ·
queandabuscando</title>`, `<meta name="robots" content="noindex"/>`,
   `<meta name="description" content="Tiendas online para negocios
cubanos."/>` (el genérico del layout, no uno propio de esta rama). Ni
   el `categorySlug`, ni ningún nombre de producto, ni la palabra
   "cerrada"/"cerrado" en el `<title>` ni en la `<meta description>`. La
   única aparición de "cerrada" en el HTML crudo es
   `"...\"cuenta\",\"sesion-cerrada\"]..."` — el segmento de ruta interno
   `/cuenta/sesion-cerrada` que Next serializa en el payload de streaming
   de CUALQUIER página (confirmado: aparece igual en `/tienda-demo`), no
   texto de este feature.
3. **Que el agujero era solo ahí**: releídas las seis vistas restantes,
   línea por línea, no solo el diff:
   - `/[slug]/page.tsx` — `generateMetadata` no llama a `notFound()` en
     ningún camino; para una tienda `PUBLISHED` (muda o no) siempre
     devuelve `{ title: store.name, ... }` — sin filtrar nada porque no
     hay nada condicionado a `pricing.unpriced` que pueda hacerlo (R15: la
     metadata no cambia para la tienda muda, a propósito).
   - `/[slug]/p/[productSlug]/page.tsx` — confirmado que sigue como antes:
     `if (!product) return { title: "Producto no encontrado" }`, nunca
     `notFound()`.
   - `/[slug]/catalogo/page.tsx` y `/[slug]/buscar/page.tsx` — el ÚNICO
     `notFound()` de cada `generateMetadata` es `if (resolution.kind ===
"selector") notFound()`, la MISMA línea, en el MISMO sitio, que el
     cuerpo de la página — no depende de `pricing.unpriced` en absoluto,
     así que no hay guarda que pueda desalinearse.
   - `/[slug]/carrito/page.tsx` y `/[slug]/checkout/page.tsx` — `export
const metadata: Metadata = { robots: { index: false } }`, un valor
     estático, no una función: no hay ningún `generateMetadata` que pueda
     divergir del cuerpo.
   - Y `visual.mjs` V1 ya ejecuta las siete vistas —incluidas estas seis—
     con el mismo margen de espera post-hidratación que destapó F1
     (`prepararPagina()`, 400 ms tras `networkidle`) y compara la MISMA
     frase entre todas: si cualquiera de las seis tuviera el mismo
     problema, V1 lo habría vuelto a fallar. No lo hizo, en ninguno de los
     dos ciclos.

Cerrado. No queda ningún archivo con la misma clase de guarda desalineada.

**F2 — no es un fallo, un descuido de la propia prueba, corregido antes de
confiar en el resultado.** `smoke.sh` (criterio 5) usaba `SELECT id FROM
"StoreProduct" sp JOIN "Store" s ON s.id=sp."storeId" …`, con `id` ambiguo
entre las dos tablas — Postgres lo rechazó con `ERROR: column reference
"id" is ambiguous`, lo que hizo fallar las diez aserciones del criterio 5
con un `400` en vez de `409`/`200`. Corregido calificando la columna
(`sp.id`); no se anota como ficha porque no da ninguna lección repetible
—es un typo de SQL, no una trampa del repo.

## Ejecuciones

### El sensor

`bash .agent/verify.sh F-040 --full` (sin `--visual`), intento 22 — todo lo
que no necesita navegador está en verde, código de salida `0`:

```
$ bash .agent/verify.sh F-040 --full
== Verificación F-040 · intento 22 ==
  ✓ harness    1s
  ✓ typecheck  1s
  ✓ lint       5s
  ✓ format     11s
  ✓ test       35s
  ✓ prisma     1s
  ✓ build      5s
  ✓ theme      0s
  ✓ bundle     0s

PASA
```

`bash .agent/verify.sh F-040 --full --smoke --visual`, intento 31 — con el
navegador real, **código de salida `1`**: el único fallo es el de § Fallos
encontrados (F1), ya reconocido por su ficha de playbook.

```
$ bash .agent/verify.sh F-040 --full --smoke --visual
== Verificación F-040 · intento 31 ==
  ✓ harness    1s
  ✓ typecheck  1s
  ✓ lint       5s
  ✓ format     10s
  ✓ test       35s
  ✓ prisma     1s
  ✓ build      5s
  ✓ theme      1s
  ✓ bundle     1s
  ✓ smoke      9s
  ✗ visual     …s  (salida 1)

FALLA en visual. Firma: visual:VISUAL FAIL V4 (categoria-no-existe)…
YA NOS PASÓ — la bitácora reconoce este fallo:
  generatemetadata-notfound-independiente-del-guardado-muda
```

**Tercer ciclo, después del arreglo de `sdd-implementer`** — intento 39,
**código de salida `0`**, las diez etapas en verde, `visual` incluida:

```
$ bash .agent/verify.sh F-040 --full --smoke --visual
== Verificación F-040 · intento 39 ==
  ✓ harness    0s
  ✓ typecheck  2s
  ✓ lint       5s
  ✓ format     10s
  ✓ test       39s
  ✓ prisma     1s
  ✓ build      5s
  ✓ theme      0s
  ✓ bundle     0s
  ✓ smoke      9s
  ✓ visual     26s

PASA
```

`npm test` (dentro de la etapa `test`): **165 archivos, 1814 pruebas, todas
verdes** — incluye `unpricedCatalog.test.ts` (7 casos) y los casos nuevos de
`storeClosure.test.ts` (frase, E19, línea de cierre, mensaje de WhatsApp).
Repetido cinco veces en total entre los tres ciclos:
`src/features/account/server/orderIdentity.test.ts` › «timeout» —fichado,
`.agent/playbook/settimeout-fira-antes-que-performance-now.md`— no falló
ninguna.

`bash .agent/verify.sh pending F-040` → **vacío**. Nada que dismiss ni que
fichar en este tercer ciclo: el único fallo real de todo el trabajo (F1) ya
pasa, y su ficha se queda escrita porque documenta una clase de error que
puede repetirse en cualquier ruta con `generateMetadata` y `notFound()`
propios.

### `smoke.sh`

```
$ bash .agent/verify.sh F-040 --smoke
== Verificación F-040 · intento 18 ==
  ✓ typecheck  2s
  ✓ lint       5s
  ✓ format     10s
  ✓ test       35s
  ✓ smoke      9s

PASA
```

`.agent/runs/F-040/018-smoke.log`: **63 aserciones `ok`, 0 `SMOKE FAIL`**.
La salida del servidor capturada por el guardián (`guardian_servidor`) no
contiene ninguna línea `Error`/`⨯`/`Unhandled` — cubre literalmente la
exigencia de E12 sobre la salida de servidor de una corrida de humo.
Confirmado también a mano, fuera del sensor, contra un `next dev` propio
(`/tmp/f040-smoke-manual.log`): `grep -nE "Error|⨯|Unhandled"` vacío salvo
el bloque de `nextjs-agent-rules` que `next dev` reescribe siempre.

Fixture: sembrado con `npx tsx .agent/specs/F-040/seed-muted-store.ts up
<sufijo>` al principio de `smoke.sh` y borrado con `down <sufijo>` en un
`trap … EXIT` — confirmado con `psql` que no queda ninguna fila
`f040-smoke-%` ni tras una corrida en verde ni tras una en rojo (se forzó
un fallo real durante el desarrollo de este `smoke.sh` — un `id` ambiguo en
un `JOIN` de la propia prueba — y la limpieza se ejecutó igual).

## Huecos de cobertura

- ~~`generateStaticParams`/ISR real (E14, la tienda deja de estar muda
  sola).~~ **Ya no es un hueco**: cubierto en este segundo ciclo por
  `visual.mjs` V6, que siembra la tasa que falta por el mismo canal que el
  POS (un `EXCHANGE_RATE` real vía `/api/internal/sync/catalog`) y
  comprueba, en un navegador de verdad, que la primera visita posterior ya
  no trae el aviso. Se deja la entrada (tachada, no borrada) porque el
  primer ciclo la anotó como hueco y es la evidencia de que el segundo la
  cerró.
- **`BranchBar` en una marca de dos o más sucursales (E21).** El fixture de
  este ciclo usa marcas de una sola sucursal (el caso que ejercitan los
  ocho criterios literales); `E21` pide una marca con ≥2 sucursales
  renderizables para ver el `BranchBar` en su forma cerrada. No es ninguno
  de los ocho `acceptance_criteria` de `features.json` — es uno de los
  `[nuevo]` que `spec.md` propone al humano y que no llegó a la tabla de
  criterios del feature. Riesgo de no probarlo: bajo — `isOpen={false}` es
  el mismo prop y el mismo componente que ya usan las cinco vistas en su
  rama de tienda `SUSPENDED` (código sin tocar, `AD7`), y `design.md` ya lo
  midió visualmente contra `/el-trebol-playa` (`SUSPENDED`, no muda, pero el
  mismo componente).
- **Contraste, tabulación y demás accesibilidad de la pantalla muda de
  verdad.** `design.md` § Verificación visual los deja pendientes «cuando
  el código exista» y los midió simulando la cadena sobre la pantalla
  cerrada. No se repitió aquí: no hay ningún `acceptance_criteria` de
  F-040 sobre accesibilidad, y el componente (`StoreClosedNotice`) es el
  mismo, sin cambios, que la pantalla de cierre ya mide.

## Veredicto

**LISTO.** Los ocho `acceptance_criteria` se verificaron ejecutando algo —
ninguno se dio por bueno leyendo el código y razonando que debería
funcionar. El camino no fue lineal, y queda escrito porque es la prueba de
que el sensor hizo su trabajo: la primera pasada de `visual.mjs` bajó el
veredicto a NO LISTO al encontrar un fallo real en el criterio 1
(§ Fallos encontrados, F1); `sdd-implementer` lo corrigió; esta sesión lo
reverificó en tres frentes —`bash .agent/verify.sh F-040 --visual` en `0`
con V4 en verde, la metadata de la rama arreglada comprobada sin fugas
sembrando y pidiendo la página de verdad, y una relectura de las otras seis
vistas confirmando que ninguna comparte la misma clase de guarda
desalineada— y solo entonces vuelve a LISTO. Los ocho:

| #   | Criterio                                                                   | Veredicto |
| --- | -------------------------------------------------------------------------- | --------- |
| 1   | Tienda muda con motivo, siete vistas, en HTTP y en navegador tras hidratar | **LISTO** |
| 2   | Solo algunos sin precio → catálogo con los que sí, sin aviso               | **LISTO** |
| 3   | Tienda vacía, sin marcar                                                   | **LISTO** |
| 4   | La detección no escribe nada                                               | **LISTO** |
| 5   | Pedido sin 500 ni importes inválidos                                       | **LISTO** |
| 6   | Ninguna consulta nueva (24=24, 60=60, 26=26, 60=60)                        | **LISTO** |
| 7   | La ficha dice lo mismo que la portada                                      | **LISTO** |
| 8   | `bash .agent/verify.sh F-040 --full` en 0                                  | **LISTO** |

**`"passes": true` en `.agent/features.json`** lo retiró el orquestador
cuando este documento bajó a NO LISTO; con el veredicto de vuelta en LISTO
y los tres frentes de esta sesión verificados, ya no hay motivo para que
siga fuera — el orquestador lo repone y corre `sdd.sh done F-040`, que es
quien cierra el feature de verdad (regla 3: `"passes": true` no lo escribe
el probador).

## Preguntas al humano

Ninguna. El criterio 6 tuvo un resultado reproducible con el procedimiento
del log de Prisma (a diferencia de lo que `plan.md` temía como riesgo de
cierre), y el hallazgo de `visual.mjs` tuvo arreglo, reverificación y
cierre dentro del propio ciclo del feature — no hizo falta subir ninguna
`TP`.
