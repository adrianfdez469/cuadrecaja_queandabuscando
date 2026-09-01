---
feature: F-020
agente: sdd-tester
actualizado: 2026-09-01T06:24:06Z
estado: listo
veredicto: listo
---

## Estrategia

Los 17 criterios de `.agent/specs/F-020/spec.md` (los 7 de `features.json`
sin tocar su texto, más los 10 `[nuevo]`) se verificaron **ejecutando**, no
leyendo código: el sensor completo (`bash .agent/verify.sh F-020 --full
--smoke`), el guion de runtime (`scripts/realtime-bell.mjs`) contra un
`next dev` real y el emulador de Realtime completo, consultas SQL directas
contra `realtime-db`, `grep` a mano, y dos experimentos deliberados:

1. **Sabotaje de `bell.ts`** para comprobar que `bell.db.test.ts` de verdad
   pesca la coalescencia en memoria de proceso (I5) — el peor modo de fallo
   posible de este feature, verde en local y falso en producción.
2. **Sabotaje de `guardian_servidor`** (la función real de `.agent/verify.sh`,
   extraída y ejecutada, no una copia) contra un log fabricado con un objeto
   `Error` crudo, para comprobar que el guardián de la etapa smoke sigue vivo
   y no se calló por accidente.

Ningún archivo de `src/`, `docker-compose.yml`, `docker/*.sql` ni
`.agent/verify.sh` quedó modificado al terminar: los dos sabotajes se
revirtieron y se re-confirmó verde antes de seguir. El entorno (Postgres,
Storage, Auth, Realtime) quedó arriba y sano al terminar.

## Mapa criterio → prueba

| #    | Criterio (`spec.md`)                                 | Prueba                                                                                  | Comando                                                                                                                                                                                                     | Resultado                                                                                                                                               |
| ---- | ---------------------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Broadcast sin datos al crear                         | `scripts/realtime-bell.mjs --criterio1`, suscriptor Phoenix real                        | `bash .agent/verify.sh F-020 --full --smoke` (incluye los 9 modos)                                                                                                                                          | ok — payload `{ "t": "pedidos" }` exacto; no contiene `code`, `total`, `phone`, `name`/`contact` (verificado sobre el mensaje serializado crudo, `raw`) |
| 2    | Aislamiento entre negocios                           | `--criterio2`, dos suscriptores (A y B)                                                 | mismo comando                                                                                                                                                                                               | ok — A recibe 1, B recibe 0                                                                                                                             |
| 3    | Realtime inalcanzable                                | `--criterio3`, `docker compose stop/start realtime` alrededor de un `POST /api/orders`  | mismo comando + verificación manual de la desviación (ver abajo)                                                                                                                                            | ok — `201` y el pedido aparece en el pull con Realtime caído                                                                                            |
| 4/17 | Menos timbres que pedidos (redacción del 17, ver I1) | `--criterio4`: 10 pedidos en <5s, 1–2 timbres; y `bell.db.test.ts` contra Postgres real | `npx vitest run --project db bell.db.test.ts` + smoke                                                                                                                                                       | ok — 6/6 casos; **sabotaje deliberado con `Map` de módulo puso 3/6 en rojo** (ver detalle)                                                              |
| 5    | Sin salida hacia el POS                              | —                                                                                       | `grep -rn "CUADRECAJA_API_URL" src/`                                                                                                                                                                        | ok — 0 líneas, exit 1                                                                                                                                   |
| 6    | RLS y documentación                                  | consulta a `pg_policies` en `realtime-db`; grep a `docs/sync-contract.md`               | `docker compose exec -T realtime-db psql -U postgres -d realtime -c "select policyname from pg_policies where schemaname='realtime' and tablename='messages'"` + `grep -n "negocio:" docs/sync-contract.md` | ok — 1 fila (`negocio_lee_solo_su_canal`); 3 líneas de match, sección con los 5 elementos mínimos que pide § Datos y contrato                           |
| 7    | El sensor (`--full`)                                 | —                                                                                       | `bash .agent/verify.sh F-020 --full --smoke` (superconjunto)                                                                                                                                                | ok — exit 0                                                                                                                                             |
| 8    | El timbre llega a tiempo                             | `--criterio8`                                                                           | smoke                                                                                                                                                                                                       | ok — latencia dentro de 2 s                                                                                                                             |
| 9    | Ningún evento se queda sin timbre (E9)               | `--criterio9` + caso E9 de `bell.db.test.ts`                                            | smoke + `vitest run --project db`                                                                                                                                                                           | ok                                                                                                                                                      |
| 10   | Los dos disparadores, y solo esos                    | `--criterio10`: aprobar, rechazar, repetir (idempotente), vencimiento forzado por cron  | smoke                                                                                                                                                                                                       | ok — aprobar y rechazar timbran; repetir responde 200 y 0 timbres; vencimiento forzado responde 200 y 0 timbres                                         |
| 11   | Emitir no retrasa                                    | `--criterio11`: mediana de 5 `POST` sano vs. roto                                       | smoke + verificación manual del tipo de fallo (ver abajo)                                                                                                                                                   | ok — mediana rota ≤ mediana sana + margen                                                                                                               |
| 12   | El emulador se levanta y es opcional                 | `docker compose up -d` ×2; `init.sh` con `realtime` parado; `/tienda-demo`              | ver comandos abajo                                                                                                                                                                                          | ok                                                                                                                                                      |
| 13   | La credencial es del negocio que la pide             | `--criterio13` + `src/app/api/internal/realtime/credential/route.test.ts`               | smoke + `npx vitest run --project server credential/route.test.ts`                                                                                                                                          | ok — canales distintos, B nunca recibe el timbre de A ni con cuerpo falsificado                                                                         |
| 14   | Frontera de cliente intacta                          | `boundaries.test.ts` + `check:bundle`                                                   | `npx vitest run` (suite completa, dentro de `--full`) + `npm run check:bundle`                                                                                                                              | ok — 177.6 KB / 193 KB de presupuesto, sin moverse                                                                                                      |
| 15   | El paso operativo queda escrito                      | —                                                                                       | `grep -n "Realtime" docs/despliegue.md`                                                                                                                                                                     | ok — 4 líneas                                                                                                                                           |
| 16   | El sensor completo, con runtime                      | —                                                                                       | `bash .agent/verify.sh F-020 --full --smoke`                                                                                                                                                                | ok — exit 0 (ver log completo abajo)                                                                                                                    |
| 17   | Redacción del criterio 4                             | ya adoptada por el humano en `features.json.notes`                                      | mismo que 4                                                                                                                                                                                                 | ok                                                                                                                                                      |

## Lo que se rompió a propósito

### 1. La coalescencia (criterios 4/17, I5)

Se reemplazó temporalmente `claimBell()` en
`src/features/orders/server/bell.ts` por una implementación con un
`Map<string, number>` de ámbito de módulo (memoria de proceso), dejando el
resto del archivo intacto. Se corrió:

```
npx vitest run --project db src/features/orders/server/bell.db.test.ts
```

Resultado: **3 de 6 casos en rojo**, exactamente los que `architecture.md`
predice que deben pescarlo:

- «case 1 — a window opened with raw SQL... is seen as first_defer, not
  ring»: `expected 'ring' to be 'first_defer'` (el `Map` nace vacío y no ve
  la fila que un proceso _distinto_ — aquí, el propio test con SQL crudo —
  escribió).
- «case 3 — ten claimBell... yield exactly one ring and one first_defer»:
  con dos `PrismaClient` en `Promise.all`, `rings = 0` en vez de `1` (dos
  "instancias" con memoria de proceso propia no se coordinan).
- «ringOrderBell — el camino real end-to-end»: `PrismaClientKnownRequestError`
  porque el `Map` nunca escribe la fila `OrderBellWindow` que el resto del
  test espera encontrar.

Se restauró el archivo original (`bell.ts` idéntico al de partida, diff
verificado) y se re-corrió: 6/6 en verde. **El test es real: sin la fila de
Postgres, se pone rojo; con ella, pasa.**

### 2. El guardián de la etapa smoke (criterios 3, 16)

Se extrajo la función `guardian_servidor` de `.agent/verify.sh` (líneas
338–350, sin modificar el archivo) junto con `SERVIDOR_ERROR_RE` y
`SERVIDOR_ERROR_IGNORAR_RE`, y se ejecutó:

- Contra el log real de la corrida de smoke
  (`.agent/runs/F-020/007-smoke.log`, que incluye la línea
  `[realtime] bell not emitted { businessId: '...', reason: 'rejected' }`
  del criterio 3): `guardian_servidor` devuelve **0** (pasa) — el guardián no
  confunde el log plano de `[realtime]` con un error.
- Contra un log fabricado con `Error: fetch failed` (lo que Node imprimiría
  si `logFailure` pasara el objeto `Error` crudo en vez de la cadena):
  `guardian_servidor` devuelve **1** (falla) y escribe la línea
  `SMOKE FAIL el servidor registró un error...`.

El guardián está vivo y discrimina correctamente. Código de `src/lib/realtime/broadcast.ts`
y `src/features/orders/server/bell.ts` confirmado: `logFailure`/`logBellFailure`
siempre pasan una cadena (`error.message` o `String(error)`), nunca el objeto.

### 3. La desviación de criterios 3/11 (contenedor parado vs. IP TEST-NET-3)

El implementador se desvió de la spec (`NEXT_PUBLIC_SUPABASE_URL` a
`203.0.113.1`) y en su lugar para/levanta el contenedor `realtime`. Se juzgó
empíricamente si eso reproduce el "traga la conexión" de E6 o el "rechaza"
de E5:

```
docker compose stop realtime
time curl -sS -o /dev/null -w "http_code=%{http_code} time_total=%{time_total}\n" \
  -m 20 -H "Authorization: Bearer <anon>" \
  http://localhost:54321/realtime/v1/api/tenants/realtime-dev/health
```

Resultado: `http_code=502 time_total=14.327220` — nginx tarda **~14,3 s** en
darse por vencido con el upstream, no responde al instante con un rechazo.
Esto **sí** reproduce el comportamiento de E6 ("se traga la conexión en vez
de rechazarla"): el `AbortSignal.timeout(REALTIME_BELL_EMIT_TIMEOUT_MS)` de
`broadcastBell` (1000 ms) es quien corta antes de que nginx conteste. La
justificación del implementador se sostiene contra la medición real, no solo
contra su propia narración.

## Comandos ejecutados por mí, con salida

```
$ bash .agent/verify.sh F-020 --full --smoke
== Verificación F-020 · intento 7 ==
  ✓ harness    0s
  ✓ typecheck  2s
  ✓ lint       4s
  ✓ format     5s
  ✓ test       27s
  ✓ prisma     1s
  ✓ build      4s
  ✓ theme      0s
  ✓ bundle     0s
  ✓ smoke      94s
PASA
$ echo $?
0
```

```
$ grep -rn "CUADRECAJA_API_URL" src/
(sin salida)
$ echo $?
1
```

```
$ docker compose exec -T realtime-db psql -U postgres -d realtime -c \
  "select policyname, tablename from pg_policies where schemaname='realtime' and tablename='messages';"
        policyname         | tablename
---------------------------+-----------
 negocio_lee_solo_su_canal | messages
(1 row)
```

```
$ grep -n "negocio:" docs/sync-contract.md
488: ... (fila de una tabla ajena, mención incidental)
761:### El timbre del canal `negocio:` (aclaración aditiva, sin bump de versión)
829:  "channel": "negocio:9f3c…",
```

```
$ grep -n "Realtime" docs/despliegue.md
130:## 4. El timbre de Realtime (F-020)
136:1. Habilitar Realtime en el proyecto de Supabase ...
143:3. **⚠ Desactivar «Allow public access» en Realtime Settings.** ...
231:4. **Aplicar la política RLS de Realtime en el editor SQL del proyecto** ...
```

```
$ docker compose up -d   # primera vez, todo ya arriba
$ echo $?
0
$ docker compose up -d   # segunda vez, en frío para el volumen ya creado
$ echo $?
0
```

```
$ docker compose stop realtime
$ bash .agent/init.sh | grep -A1 "== Realtime =="
== Realtime ==
  ! emulador de Realtime no responde — ejecuta: docker compose up -d
$ echo $?   # de init.sh completo
0            # ENTORNO LISTO igual
$ PORT=3100 npx next dev -p 3100 &
$ curl -o /dev/null -s -w "%{http_code}" http://localhost:3100/tienda-demo
200
$ docker compose start realtime   # repuesto antes de seguir
```

```
$ npx vitest run --project server \
    src/app/api/internal/realtime/credential/route.test.ts \
    src/lib/realtime/broadcast.test.ts \
    src/lib/realtime/subscriptionToken.test.ts \
    src/features/orders/server/bell.test.ts \
    src/app/api/orders/route.test.ts \
    "src/app/[slug]/pedido/[code]/respuesta/route.test.ts" \
    src/features/account/boundaries.test.ts
Test Files  7 passed (7)
     Tests  63 passed (63)
```

```
$ npm run check:bundle
✓ Heaviest page: bodega-central/p/agua-natural-500-ml.html
    client JS: 177.6 KB gzipped (budget 193 KB)
```

```
$ bash .agent/verify.sh pending F-020
(sin salida — no hay lecciones de este ciclo sin ficha)
```

## Observación (no bloquea ningún criterio)

`src/features/orders/server/bell.ts` cita en un comentario «`maxDuration` on
the two calling routes covers the same requirement from the platform's
side» (architecture.md § Riesgos, riesgo 4), pero ni
`src/app/api/orders/route.ts` ni
`src/app/[slug]/pedido/[code]/respuesta/route.ts` exportan `maxDuration`.
`architecture.md` § Escalabilidad enuncia esa mitigación como **condicional**
(«si el tope de invocación de la plataforma quedara por debajo de
`(duración de la petición + 5 s)`»), y ningún criterio de `spec.md` la exige
contra `next dev` (que no impone tope). No es un hueco de los 17 criterios —
es una decisión de despliegue explícitamente diferida por `architecture.md`,
del mismo tipo que el paso manual de la política RLS en producción. Queda
anotado para que quien despliegue no lo redescubra como sorpresa; el
comentario del código podría precisar mejor que la mitigación es condicional
y no un hecho ya cubierto.

## Veredicto

**LISTO — los 17 criterios verdes**, cada uno ejecutando algo real: el
sensor completo, el guion de runtime contra Realtime real, SQL directo, y
dos sabotajes deliberados (coalescencia en memoria de proceso; guardián de
error crudo) que confirmaron que las dos defensas más importantes del
feature (I5 y el guardián de smoke) de verdad detectan la regresión que
dicen detectar, y no solo la documentan.

Ningún fallo que reportar; ninguna ficha de `.agent/playbook/` pendiente de
escribir (`bash .agent/verify.sh pending F-020` vacío — las dos fichas de
este ciclo, `realtime-bell-close-clock-skew` y
`db-test-cross-process-clock-skew`, ya estaban escritas por
`sdd-implementer`).
