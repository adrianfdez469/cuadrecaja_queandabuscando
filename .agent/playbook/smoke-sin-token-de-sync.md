---
slug: smoke-sin-token-de-sync
sintoma: "smoke falla con: QAB_BEARER_TOKEN no está configurado — acúñalo con: npm run mint:token"
firma: QAB_BEARER_TOKEN no está configurado
etapa: smoke
visto_en: F-026
creado: 2026-08-31T04:43:48Z
promovido_a_agents: no
arreglo: npm run mint:token -- seed-negocio-1, y pega el valor en QAB_BEARER_TOKEN de .env
---

## Qué pasa de verdad

No falta una dependencia ni está roto el servidor: falta un **secreto que no
está en el repo y no puede estarlo**. Los guiones de humo que envían eventos de
sync (`.agent/specs/*/smoke.sh`, `scripts/send-catalog-batch.mjs`) se
autentican contra `/api/internal/sync/*` con un bearer token que se acuña
contra la base, y `.env.example` lo trae como cadena vacía porque un token real
en git sería una credencial filtrada.

Lo que hace que muerda **precisamente al empezar** es que nada lo bloquea antes:
`bash .agent/sdd.sh start` lo lista como aviso (`!`, «sin valor en .env»), no
como `✗`, así que el entorno sale `ENTORNO LISTO` y uno se pone a trabajar. El
fallo aparece media hora después, en la primera etapa que levanta la app de
verdad, y el mensaje habla de una variable que nunca has visto.

Un `.env` copiado de otro checkout tampoco lo trae: el token se muestra **una
sola vez** al acuñarlo, así que quien montó aquel entorno lo pegó a mano y esa
línea puede no estar.

## Cómo se arregla

```bash
npm run mint:token -- seed-negocio-1     # imprime el token UNA vez
```

Y se pega el valor en `.env`:

```
QAB_BEARER_TOKEN="<lo que imprimió>"
```

`seed-negocio-1` es el `externalId` del negocio que siembra `npm run seed`. Para
otro negocio, su propio `externalId`. `.env` está en `.gitignore`: el token se
queda en la máquina.

## Cuándo NO es esto

La firma es específica de esta variable, así que apenas pesca de más. Pero
**otro** `403` o `401` del endpoint de sync durante el humo no es esto: si
`QAB_BEARER_TOKEN` tiene valor y aun así rechaza, el token es de **otro
negocio** que el que el guion usa —o se acuñó contra otra base, o la base se
resembró después y el registro del token se fue con ella—. Acúñalo de nuevo
contra la base que está corriendo ahora.

Y no lo confundas con `.agent/playbook/env-optional-secreto-vacio-rompe-serverenv.md`:
aquel es sobre secretos en **cadena vacía** rompiendo `serverEnv()` en silencio
(lo que F-029 promete cerrar); este es sobre uno que hay que acuñar y pegar a
mano, y que falla ruidosamente y con instrucciones.

## Cómo se evita

Acuñarlo al montar el entorno, junto a `node scripts/storage-dev-keys.mjs --write`,
y no al primer `--smoke`. Lo barato de verdad sería que `.agent/init.sh` lo
tratara como los demás secretos de desarrollo —imprimiendo el comando que lo
genera, como ya hace con las claves de Storage— en vez de dejarlo en un aviso
que no distingue «opcional» de «lo vas a necesitar en cuanto levantes la app».
Eso es exactamente la forma del problema que **F-029** abre para las otras tres
claves; si esta ficha aparece en un segundo feature, la variable debería entrar
en ese mismo arreglo y subir a `AGENTS.md` § Cosas que muerden.
