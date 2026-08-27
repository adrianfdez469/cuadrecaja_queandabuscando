---
feature: F-017
agente: sdd-tester
actualizado: 2026-08-27T07:50:00Z
estado: verificado
veredicto: listo
---

> Ciclo 4 de prueba (cierre final). Los ocho criterios literales de
> `.agent/features.json` pasan, verificados ejecutando. Las tres apariciones
> del defecto de revalidación (`regroupStoreIntoBrand`, `setStoreEnabled`,
> `handleStore`) están **arregladas y confirmadas con repro propia**, con
> metodología de caché **calentado** (nunca frío) para que la confirmación
> pruebe algo real. El test de frontera nuevo (`boundaries.test.ts`) **sí
> pesca** el patrón en un archivo que el implementador nunca tocó, pero es
> **parcial**: de nueve variantes sintácticas equivalentes que probé, solo
> dos caen en su red — hay que decirlo, no ocultarlo. No encontré una
> cuarta instancia del defecto original. El coste en el sync es el que se
> prometió: cero consultas nuevas, confirmado en código y con un lote real
> de 500 eventos. No se tocó `.github/workflows/ci.yml`, `src/lib/prisma.ts`
> ni `src/lib/prisma.test.ts`.

## 1. El arreglo de la instancia 3 — confirmado con MI repro, con caché calentado a propósito

Reproduje de cero, con fixtures propias por sync (`warm-p1/p2/d/e-<ts>`,
nunca las del `smoke.sh` del implementador ni `bodega-uno`/`bodega-dos`),
las tres instancias — y esta vez **calenté la caché explícitamente antes**
de cada escritura, para que la confirmación no dependa de que la primera
lectura de una página ocurra después del cambio (ver § 3, por qué esto
importa).

**Instancia 1** (marca que se encoge a 1 sucursal):

```
1. Agrupar P2 en P1 → marca de P1 con 2 sucursales.
2. curl /warm-p1  →  "Elige tu sucursal" · Warm P1 · Warm P2   (CALENTADO,
   confirmado que el selector viejo está realmente en caché)
3. Agrupar P2 (que ya estaba en la marca de P1) en D → la marca de P1
   se encoge a 1.
4. curl /warm-p1, SIN esperar nada  →  "Catálogo" · Warm P1  (sin "Warm P2",
   sin "Elige tu sucursal")
```

**Instancia 2** (hermana preexistente no se enteraba de un tercer miembro):

```
1. curl /warm-p2/sucursales  →  Warm D · Warm P2   (CALENTADO: sin "Warm E")
2. Agrupar E en la marca de D (que ya tenía a D y a P2).
3. curl /warm-p2/sucursales, sin esperar  →  Warm D · Warm E · Warm P2
```

**Instancia 3** (evento `STORE` de rutina en una marca multi-sucursal —
el objeto de este ciclo):

```
1. curl /warm-d          →  ...Warm P2...              (CALENTADO)
   curl /warm-e/sucursales →  ...Warm P2...             (CALENTADO)
2. Evento STORE UPDATE sobre "warm-p2-<ts>", name="Warm P2 RENOMBRADA".
3. curl /warm-d, sin esperar          →  Warm P2 RENOMBRADA (el SELECTOR)
   curl /warm-e/sucursales, sin esperar →  Warm P2 RENOMBRADA (la HERMANA)
```

Ninguna de las seis URL implicadas devolvió `404` en ningún momento de las
tres secuencias. Las tres instancias están **arregladas**, confirmado por
mí, no solo leído del `impl.md`.

## 2. Por qué "calentar antes" no es un detalle — es la diferencia entre probar algo y no probar nada

Al reconstruir mi propio repro para este ciclo noté que, en mi confirmación
del ciclo anterior, nunca había leído `/verif2-p1` **antes** de encogerlo —
la primera vez que esa URL se pedía era **después** de la escritura. Eso
significa que aquella confirmación, aunque dio el resultado correcto, no
podía distinguir "el arreglo funciona" de "no había nada cacheado que
pudiera estar rancio" (una lectura en frío siempre calcula el valor
correcto, arreglo o no). Es el mismo vicio que el implementador encontró en
su propia aserción de la hermana E y corrigió.

Por eso el repro de este ciclo (§ 1) calienta cada página explícitamente y
**demuestra con un `curl` intermedio** que lo que estaba cacheado era
justo el contenido viejo, antes de la escritura que lo invalida. Sin ese
paso intermedio, un "PASA" no es evidencia de nada.

## 3. `smoke.sh`: encontré el mismo vicio en sus propias aserciones `[ALTA #1]`/`[ALTA #2]` — lo arreglé

El implementador cazó el vicio del caché frío en su aserción de la
instancia 3 (`[ALTA #3]`, la hermana E) y la corrigió precalentando su
página antes del evento. **Pero las dos aserciones anteriores del mismo
bloque, `[ALTA #1]` (la marca de A que se encoge) y `[ALTA #2]` (la
hermana B que ve a un tercer miembro), nunca leían su página ANTES de la
escritura que se supone que revalidan** — exactamente el mismo vicio, sin
corregir, en el mismo archivo, a pocas líneas de donde ya se había
diagnosticado una vez.

Verifiqué que el vicio era real (no solo teórico) reconstruyendo el
escenario con mis propias fixtures y comparando calentar-antes contra
no-calentar (§ 1-2): el resultado observable es el mismo en ambos casos
**porque el arreglo de verdad funciona** — pero eso no se podía saber
leyendo solo `[ALTA #1]`/`[ALTA #2]` tal como estaban escritas, porque
nunca demostraban que había algo rancio que revalidar.

**Arreglé `.agent/specs/F-017/smoke.sh`** (no es código de producto, es mi
propia herramienta de prueba — el encargo permite ampliarla): añadí una
lectura explícita de `/A` inmediatamente después del paso 1 (antes de
encogerla en el paso 2), con una aserción de que en ese momento SÍ sirve el
selector de 2; y una lectura de `/B/sucursales` inmediatamente después del
paso 2 (antes de que E se una en el paso 3), con una aserción de que en ese
momento NO trae el nombre de E todavía. Las dos leídas quedan confirmadas
en el propio log de la corrida:

```
ok   repro (calentando caché) — /A todavía sirve el selector de 2 ANTES de encogerse
ok   [ALTA #1] la marca de A, YA CALENTADA con el selector viejo, deja de servirlo — sin esperar el piso de ISR
ok   repro (calentando caché) — /sucursales de B todavía NO trae a E antes del paso 3
ok   [ALTA #2] la sucursal B, YA en la marca antes del paso 3, ve a E en su propia /sucursales
```

`bash .agent/verify.sh F-017 --smoke` sigue en `0` con este cambio.

## 4. El test de frontera (`boundaries.test.ts`) — pesca algo real, pero es parcial

**Sí atrapa el patrón en un archivo que el implementador nunca escribió ni
probó.** Añadí, en `src/features/orders/server/quote.ts` (elegido a
propósito por no tener nada que ver con marcas ni sucursales), una función
muerta con la forma exacta del bug:

```ts
function __tempSiblingSlugProjection(members: { slug: string | null }[]) {
  return members.map((member) => member.slug);
}
```

`npx vitest run src/features/storefront/server/boundaries.test.ts` falló,
señalando `src/features/orders/server/quote.ts` como infractor. Reverti el
archivo después (`diff` limpio confirmado). El test no es un escaparate que
solo reconoce su propia fixture.

**Pero es una red angosta.** Probé nueve variantes semánticamente
equivalentes del mismo patrón (una función que proyecta una lista de
miembros a sus slugs) en el mismo archivo de prueba, una por una:

| Variante                                              | ¿La caza? |
| ----------------------------------------------------- | --------- |
| `.map((x) => x.slug)`                                 | Sí        |
| `.map(x => x.slug)` (sin paréntesis)                  | Sí        |
| `.map(({slug}) => slug)` (desestructurado)            | **No**    |
| `.map((m) => { return m.slug; })` (cuerpo con llaves) | **No**    |
| `.map((m) => m.slug ?? "")` (encadenado tras `.slug`) | **No**    |
| `for (const m of members) out.push(m.slug)`           | **No**    |
| `.reduce((acc, m) => { acc.push(m.slug); ... })`      | **No**    |
| `.map(getSlug)` (función nombrada aparte)             | **No**    |
| `.flatMap((m) => (m.slug ? [m.slug] : []))`           | **No**    |

Solo **dos de nueve** caen en la red. El regex (`/\.map\(\s*\(?\s*\w+\s*\)?
\s*=>\s*\w+\.slug\s*\)/`) exige que el `.map` cierre inmediatamente después
de `algo.slug`, sin desestructurar, sin llaves, sin encadenar nada más, y
sin usar `for`/`reduce`/`flatMap`/una función nombrada — que son formas
igual de naturales de escribir "proyecta esta lista a sus slugs" y que
cualquiera de las tres funciones que ya cayeron en este defecto podría
haber usado con la misma facilidad que la que sí cayó.

**Veredicto sobre este test**: no es un test de escaparate en el sentido
de "solo reconoce su propio archivo" — eso queda descartado. Pero **sí**
es una defensa parcial contra la forma exacta, no contra la intención. Una
cuarta instancia escrita con cualquiera de las siete formas de la tabla
pasaría el test sin que nadie se entere. Recomendación, sin implementarla
yo: la defensa de verdad no es una que dependa de la sintaxis, sino una
que afirme el **comportamiento** — igual que hicieron los tests que sí
cazaron las tres instancias reales (`registry.test.ts`, `mutations.test.ts`,
`src/features/sync/server/handlers/store.test.ts`), que verifican qué slugs concretos llegan a
`revalidateSlugs`, no cómo se escribió el código que los calculó. El test
de forma puede quedarse como una alarma temprana barata, pero no debería
ser la única defensa.

## 5. Coste en el camino del sync — cero consultas nuevas, confirmado

**Estático**: contando las llamadas `prisma.*` dentro de `handleStore()`,
son exactamente las mismas de antes de este ciclo —
`prisma.business.upsert`, `prisma.store.findUnique` (con `slug` añadido a
un `select` anidado que ya existía, ninguna consulta nueva) y un
`prisma.store.update`—. `expandBrandTouch()` es aritmética pura sobre datos
que esa única consulta ya traía.

**En vivo**: envié dos lotes reales al endpoint de sync contra una marca de
verdad con varias sucursales:

- 60 eventos (4 tiendas, mezclados) → `ok: 60, failed: 0`, `0.57s` de punta
  a punta.
- **500 eventos** (el tamaño que `architecture.md` usa como ejemplo) → `ok:
500, failed: 0`, `5.4s` de punta a punta — lineal, sin señales de una
  consulta añadida por marca ni por sucursal tocada. El estado final de la
  marca (`curl` de la página compartida) reflejó correctamente el ÚLTIMO
  valor de cada una de las cuatro tiendas del lote, confirmando que la
  fusión en un solo `Set` deduplicado (`revalidateSlugs`, una sola llamada
  por lote) funcionó también bajo carga real, no solo en el test unitario
  que lo afirma con dos eventos.

No hay indicio de riesgo para ADR 0003 (timeouts del POS): el tiempo por
evento (~10ms) es el mismo orden que ya tenía el camino antes de F-017 — la
expansión no lo cambia.

## 6. Las pruebas nuevas fallan de verdad sin el arreglo — confirmado revirtiendo, no solo leído

Reverti a mano, por separado, `handleStore()` (quitando `touchedSlugValues`
de sus DOS ramas — la de publicar y la de darse de baja, que el
implementador solo probó en una) y `processBatch.ts` (volviendo
`revalidateSlugs(touchedStores)` a como estaba, sin fundir
`touchedSlugValues`):

```
src/features/sync/server/handlers/store.test.ts (revertido)  → 2 fallidos, 10 pasan (de 12)
src/features/sync/server/handlers/store.test.ts (restaurado) → 12 pasan
src/features/sync/server/processBatch.test.ts   (revertido)  → 2 fallidos, 1 pasa (de 3)
src/features/sync/server/processBatch.test.ts   (restaurado) → 3 pasan
```

(El primer intento de reversión solo tocó una de las dos ramas de
`handleStore()` y dejó pasar un test que sí debía fallar — lo noté
comparando comparando el número de fallos esperado contra el real, y
corregí la reversión antes de concluir nada. Los dos archivos quedaron
`diff`-limpios tras restaurar.)

## 7. Cuarta instancia — no encontré ninguna

Revisé el resto de escritores que tocan `Slug`/`Storefront`/
`Store.storefrontId` o el estado de una tienda dentro de una marca
multi-sucursal: `createStorefrontWithStore` (crea, no hay hermanas
todavía), `handleProduct`/`availability.ts` (productos y disponibilidad son
de la sucursal, no de la marca — no aparecen en el `branches[]`/selector de
nadie), `mutations.ts::commit()` para productos y promociones (mismo
motivo). Los tres escritores que SÍ tocan algo que una hermana o un
selector lee (`regroupStoreIntoBrand`, `setStoreEnabled`, `handleStore`) ya
pasan por `expandBrandTouch()`, confirmado leyendo cada uno.

No encontré una cuarta instancia. Si alguien la encuentra después y el test
de frontera no la vio, § 4 ya explica por qué: la red es angosta, no
inexistente.

## Mapa criterio → prueba (cierre)

| #   | Criterio                                                 | Resultado                                                                                                                              |
| --- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Marca con UNA sucursal, sin selector                     | **PASA**                                                                                                                               |
| 2   | Marca con DOS sucursales, ambas en el HTML               | **PASA** — las tres instancias del defecto de revalidación que tocan este mecanismo están arregladas y confirmadas con caché calentado |
| 3   | Slug de `Store` viejo → 200, sin redirección             | **PASA**                                                                                                                               |
| 4   | Slug ya usado por una marca → error de restricción única | **PASA**                                                                                                                               |
| 5   | `admin`/`api` → falla                                    | **PASA**                                                                                                                               |
| 6   | Aviso del carrito en el HTML, antes de aplicar           | **PASA**                                                                                                                               |
| 7   | `npm run build` sigue `(SSG)`                            | **PASA**                                                                                                                               |
| 8   | `verify.sh --full` → 0                                   | **PASA**                                                                                                                               |

## Sensor

```
$ bash .agent/verify.sh F-017 --full   → 0 — harness · typecheck · lint · format · test · prisma · build · theme · bundle
$ bash .agent/verify.sh F-017 --smoke  → 0  (con las dos aserciones de § 3 endurecidas)
$ bash .agent/verify.sh F-017 --visual → 0
$ bash .agent/verify.sh pending F-017  → (vacío)
$ npm test                             → 415 passed (47 archivos)
```

`bash .agent/specs/F-010/smoke.sh` y `bash .agent/specs/F-011/smoke.sh`,
contra el mismo servidor, sin editarlos: **0 aserciones fallidas** en los
dos, repetido después del lote de 500 eventos de § 5.

## Huecos de cobertura

- El test de frontera de § 4 no cubre siete de las nueve formas
  equivalentes de reintroducir el patrón. No es un hueco que yo pueda
  cerrar sin escribir producto (el encargo pide solo decirlo).
- iOS Safari, contraste de paleta, el envío del contrato a cuadrecaja:
  igual que en los ciclos anteriores.

## Veredicto

**`listo`.** Los ocho criterios literales de `.agent/features.json` pasan,
verificados ejecutando en cada ciclo, no releídos de un ciclo anterior. Las
tres apariciones del defecto de revalidación (`regroupStoreIntoBrand`,
`setStoreEnabled`, `handleStore`) están arregladas, confirmadas con mi
propia reproducción y con metodología de caché calentado (no frío) para
que la confirmación pruebe algo real. Las pruebas nuevas fallan de verdad
sin el arreglo, en los dos niveles (unitario y — para las dos aserciones
que arreglé — de humo). El coste en el camino del sync es el prometido:
cero consultas nuevas, confirmado en código y con un lote real de 500
eventos sin señales de degradación.

**Lo único que no es un cierre perfecto**, y que no bloquea este veredicto
porque no es un criterio ni un defecto de producto, sino una nota de
calidad del propio arnés de pruebas: el test de frontera nuevo es una
defensa parcial (§ 4) — deja pasar siete de nueve formas equivalentes de
reintroducir el patrón. Vale la pena reforzarlo con una prueba de
comportamiento (qué slugs llegan a `revalidateSlugs`) en el próximo ciclo
que toque este código, pero no es motivo para retener este feature: los
tres escritores reales que existen hoy ya pasan por `expandBrandTouch()`,
confirmado uno por uno.

Este documento es el que decide `passes: true` en `.agent/features.json` —
el humano puede marcarlo sin releer nada más.

## Preguntas al humano

Ninguna.
