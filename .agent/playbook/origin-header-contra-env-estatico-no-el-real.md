---
slug: origin-header-contra-env-estatico-no-el-real
sintoma: un navegador real (con o sin JavaScript) que hace un POST legítimo a
  una ruta con defensa de `Origin` recibe 403 FORBIDDEN_ORIGIN
firma: "FORBIDDEN_ORIGIN"
etapa: visual
visto_en: F-019
creado: 2026-08-30T19:47:13Z
promovido_a_agents: no
arreglo: comparar el `Origin` de la petición contra el origen REAL de esa
  misma petición (`request.headers.get("host")`, o `new URL(request.url).origin`
  detrás de un proxy que conserve el host), nunca contra un valor configurado
  aparte (`NEXT_PUBLIC_SITE_URL` u otro) que puede desincronizarse del
  servidor que de verdad atiende la petición.
---

## Qué pasa de verdad

Una defensa "rechaza `Origin` cruzado" necesita saber cuál es el origen
"propio" contra el que comparar. Es tentador usar una constante ya disponible
—`NEXT_PUBLIC_SITE_URL`, pensada para construir URLs absolutas en mensajes— en
vez de derivarlo de la petición misma. Un navegador real (a diferencia de
`curl`/`fetch` desde un script, que NUNCA añaden `Origin` por su cuenta en un
POST propio) SIEMPRE manda `Origin` en cualquier método que no sea GET/HEAD,
también en una petición perfectamente same-origin. Si el servidor compara ese
`Origin` contra una constante que no coincide EXACTAMENTE con el host:puerto
que de verdad sirvió la página —cualquier puerto de desarrollo que no sea el
que esa constante nombra, cualquier deploy de preview con URL distinta a la
del dominio canónico configurado— la petición legítima se rechaza con 403,
aunque sea exactamente el mismo origen sirviendo y respondiendo.

Encontrado en F-019: `isCrossOrigin()` en
`src/app/[slug]/pedido/[code]/respuesta/route.ts:37-42` compara
`request.headers.get("origin")` contra `publicEnv.siteUrl`
(`NEXT_PUBLIC_SITE_URL`, fija en `.env` a `http://localhost:3000`). Cualquier
`next dev` en otro puerto —incluido el que `bash .agent/verify.sh --visual`
levanta por su cuenta en `$VISUAL_PORT` (3101 por defecto)— hace que un
navegador real, sin una sola línea de JavaScript, reciba `{"error":
"FORBIDDEN_ORIGIN"}` con status 403 al aprobar o rechazar una propuesta,
rompiendo exactamente la promesa que esa ruta existe para cumplir (R16: "responde
sin JavaScript"). `scripts/renegotiate-order.mjs` y el resto de la suite de
`--smoke` nunca lo vieron porque usan `fetch()` desde Node, que no agrega
`Origin` a un POST por su cuenta — solo un navegador de verdad (Playwright con
`javaScriptEnabled: false` incluido) lo reproduce.

## Cómo se arregla

En `isCrossOrigin()`, comparar contra el origen de la propia petición en vez
de contra `publicEnv.siteUrl`:

```ts
function isCrossOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const propio = request.headers.get("host");
  try {
    return propio !== null && new URL(origin).host !== propio;
  } catch {
    return true;
  }
}
```

(Ajustar si hay proxy delante que reescriba `Host`: usar el header que ese
proxy garantice, no asumir `request.url` — Next expone `request.nextUrl.origin`
ya resuelto, que es otra opción válida si coincide con lo que el proxy dejó.)

Esto no lo arregla `sdd-tester`: es un cambio de código de producto, y vuelve
a `sdd-implementer` (impl.md de F-019 § Desviaciones no lo menciona: es un
hallazgo nuevo, no una desviación ya conocida).

## Cuándo NO es esto

Si el 403 aparece SOLO quitando la cabecera `Origin` a propósito (un ataque
cruzado de verdad, el caso que la defensa sí debe frenar), la defensa está
haciendo su trabajo — no es este bug. Esto es específicamente cuando el
`Origin` que manda el navegador SÍ es el mismo host:puerto que sirvió la
página, y aun así el servidor lo rechaza porque compara contra una constante
distinta.

## Cómo se evita

Cualquier defensa de `Origin`/`Referer` en una ruta nueva se prueba con un
navegador real (Playwright, `--visual`) que someta el formulario de verdad —
nunca solo con `curl`/`fetch`, que no reproducen la cabecera `Origin` de un
POST propio y dejarían pasar este bug sin que ningún test lo viera. El
`visual.mjs` de un feature que añada una ruta pública de escritura con esta
defensa debería incluir, como paso obligatorio, un envío real sin JavaScript
contra el puerto que `verify.sh` de verdad usa (no contra uno fijado a mano
que coincida con la constante de entorno).
