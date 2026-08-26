---
slug: next-image-optimizer-bloquea-ip-privada
sintoma: "GET /_next/image?url=... responde 400 sin cuerpo, aun con el host ya en remotePatterns"
firma: resolved to private IP
etapa: smoke
visto_en: F-011
creado: 2026-08-26T20:16:13Z
promovido_a_agents: no
arreglo: "añade `images.dangerouslyAllowLocalIP: true` en next.config.ts — solo hace falta cuando `remotePatterns` ya restringe host/puerto/pathname a un origen propio que puede resolver a localhost/IP privada (el emulador de Storage, por ejemplo)"
---

## Qué pasa de verdad

Next 16 trae un endurecimiento SSRF en el optimizador de `next/image`: si el
host de la imagen resuelve a una IP privada o de loopback (`127.0.0.1`,
`::1`, rangos `10.x`/`172.16-31.x`/`192.168.x`), `/_next/image` responde **400
sin cuerpo y sin razón** — ni siquiera aparece en la respuesta el motivo, solo
en el log del servidor:

```
⨯ upstream image http://localhost:54321/... hostname resolved to private IP
["::1","127.0.0.1"] If this is expected and you understand SSRF risk, use
images.dangerouslyAllowLocalIP = true to continue.
```

Que el host ya esté en `remotePatterns` (protocolo, host, puerto, pathname
exactos) **no evita este chequeo**: son dos guardas distintas y las dos tienen
que pasar. El emulador local de Supabase Storage vive en `localhost`, así que
cualquier feature que lo use como origen de imágenes lo dispara siempre en
desarrollo, y nunca en producción (donde el host es el dominio público real
de Supabase).

## Cómo se arregla

En `next.config.ts`:

```ts
images: {
  remotePatterns: [...],
  dangerouslyAllowLocalIP: true,
}
```

Es seguro específicamente porque `remotePatterns` ya restringe la petición a
un host, puerto y `pathname` propios y conocidos — esta bandera no abre el
optimizador a que un atacante mande cualquier host; solo permite que ESE
mismo host, ya en la lista blanca, se sirva aunque resuelva en local.

## Cuándo NO es esto

Si el 400 viene sin la línea `resolved to private IP` en el log del
servidor (revisa la consola de `next start`, no la respuesta HTTP, que no
lleva cuerpo), es el problema más común de `remotePatterns`: falta el
`port`, el `protocol` no coincide, o el `pathname` no cubre la ruta real. Ver
architecture.md § `next.config.ts`.

## Cómo se evita

Cualquier origen de imágenes que pueda apuntar a un host local en desarrollo
(un emulador, un backend propio en `localhost`) necesita esta bandera desde
el principio de la configuración, no como parche tras el primer 400. Se
detecta ejecutando `/_next/image` de verdad contra ese origen — no aparece
leyendo `remotePatterns` ni la documentación de `images`.
