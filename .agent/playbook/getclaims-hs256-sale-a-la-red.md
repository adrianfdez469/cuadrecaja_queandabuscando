---
slug: getclaims-hs256-sale-a-la-red
sintoma: "diseñaste contando con que `getClaims()` verifica el JWT en local, y en ejecución cada resolución de sesión es una petición HTTP a Auth: la prueba de sesión sin backend no pasa, o el presupuesto de latencia no cuadra"
firma: getClaims|auth/v1/user|bad_jwt
etapa: test
visto_en: F-012
creado: 2026-08-30T00:00:00Z
promovido_a_agents: no
arreglo: mira el `alg` del token antes de prometer verificación local — con HS256 (secreto simétrico) `getClaims()` cae a `getUser()` y sale a la red en cada llamada; solo ES256/RS256 tienen JWKS público que cachear
---

## Qué pasa de verdad

`@supabase/auth-js` documenta `getClaims()` como el método que verifica el JWT
localmente contra el JWKS cacheado. Es cierto **a medias**, y la mitad que falta
es la que decide el diseño. En `GoTrueClient.getClaims()`:

- si el `alg` de la cabecera empieza por `HS` —o falta el `kid`, o no hay
  WebCrypto— la librería **no busca ninguna clave**: llama a `getUser(token)`,
  que es un `GET` a `/auth/v1/user`. Petición HTTP real, en **cada** llamada, sin
  caché del resultado;
- solo con claves asimétricas (ES256/RS256) baja el JWKS público, lo cachea 10
  minutos por realm de JS y verifica la firma con `crypto.subtle` sin red.

Un proyecto Supabase con el secreto JWT clásico —y cualquier emulador GoTrue
local, que se configura con `GOTRUE_JWT_SECRET`— emite **HS256**. O sea: el
camino barato no existe ahí, y el coste no es del código sino del algoritmo.

Dos consecuencias que muerden por separado. En **verificación**: no se puede
fingir una sesión válida sin un backend de Auth de verdad, porque cada
resolución de identidad va a la red a preguntar. Y en **arquitectura**: cualquier
presupuesto de latencia escrito como «esto cuesta microsegundos» está mal por
dos órdenes de magnitud, y con él las tablas de coste que se apoyen en él.

## Cómo se arregla

Comprueba el `alg` real antes de creerte el coste:

```bash
# la cabecera del access token que emite tu Auth
printf '%s' "$JWT" | cut -d. -f1 | base64 -d 2>/dev/null; echo
# → {"alg":"HS256","typ":"JWT"}  ⇒ getClaims() = 1 viaje de red por llamada
```

Con `HS256` hay tres salidas, por orden de coste:

1. **Aceptarlo y escribirlo**: 1 viaje de red por resolución de sesión. Es lo
   correcto si la resolución corre en paralelo con otro trabajo y tiene techo
   (`Promise.race` contra un temporizador). Lo que **no** se puede seguir
   afirmando es «no retrasa nada».
2. **Migrar el proyecto a claves de firma asimétricas**: la promesa de
   verificación local se cumple sola, sin tocar el código que llama.
3. **Verificar el JWT tú mismo** con el secreto simétrico, si de verdad hace
   falta el microsegundo. Sale caro en otra moneda: el secreto pasa a vivir en la
   app y la revocación deja de ser cosa de Auth.

Lo que **sí** sigue ganando `getClaims()` sobre `getUser()` con HS256: valida el
`exp` **antes** de salir a la red, así que un token vencido se descarta en local
sin gastar el viaje.

## Cuándo NO es esto

La `firma` pesca cualquier log que nombre `getClaims` o `/auth/v1/user`. No es
esta ficha si el token es ES256/RS256 (mira la cabecera: entonces la red solo se
toca al bajar el JWKS, una vez cada 10 minutos), ni si el fallo es un `bad_jwt`
por firma inválida —eso es un secreto que no coincide entre quien firma y quien
verifica, y se arregla igualando `GOTRUE_JWT_SECRET`— ni si es
`token is expired`, que es caducidad legítima y se descarta sin red.

Tampoco aplica a `getSession()`: ese sí lee la cookie y no comprueba firma, así
que solo sale a la red cuando toca refrescar. Confundir el coste de uno con el
del otro es exactamente el error que esta ficha registra.

## Cómo se evita

Cuando un diseño diga «se verifica en local, sin viaje», que la frase venga con
el `alg` al lado. Una promesa de coste sin el algoritmo que la sostiene es una
promesa sobre un montaje que no es el nuestro, y sobrevive al cierre del feature
metida en una tabla de latencia que nadie vuelve a mirar.
