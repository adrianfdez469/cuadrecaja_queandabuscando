---
slug: secretos-de-desarrollo-en-env-example
sintoma: un escáner de secretos (GitGuardian) marca claves en el PR, y son claves de demostración públicas puestas a mano en .env.example o docker-compose.yml
firma: —
etapa: review
visto_en: F-011
creado: 2026-08-26T23:44:02Z
promovido_a_agents: no
arreglo: saca el literal del repo; genera las claves locales por máquina con `node scripts/storage-dev-keys.mjs --write` y que docker-compose las lea de .env
---

## Qué pasa de verdad

No hay filtración: son las claves de demostración públicas de Supabase
(`iss: supabase-demo`, las de su documentación de self-hosting), puestas en
`.env.example` y en `docker-compose.yml` para que el emulador de Storage
arrancara sin configuración previa. No hay nada que rotar.

El aviso tiene razón de fondo, y no por «el escáner es pesado». Primero,
`.env.example` es **documentación**: algo con forma de clave ahí enseña a la
siguiente persona a pegar la de verdad en el mismo hueco. Segundo, un literal así
salta en **cada** PR para siempre, y eso entrena al equipo a ignorar al escáner —
que es exactamente cómo se acaba colando el secreto real.

## Cómo se arregla

Las claves no viven en el repo: se generan por máquina.

```bash
node scripts/storage-dev-keys.mjs --write   # firma el secreto y los dos JWT en .env
docker compose up -d --force-recreate storage storage-gateway
```

`.env` está en `.gitignore` y `docker compose` lee ese mismo archivo, así que la
aplicación y el emulador coinciden sin que ninguno de los dos valores exista en
git (`docker-compose.yml:74-76`). La interpolación va con `${VAR:?mensaje}`: un
arranque sin claves falla con la instrucción en pantalla en vez de levantar un
contenedor que responde 401 opacos. `.agent/init.sh` avisa con ese comando en
lugar de decir «falta una variable».

En `.env.example` solo van nombres de variables y cómo obtener el valor. Ni
claves reales, ni de demostración, ni de ejemplo.

## Cuándo NO es esto

Si la clave marcada **no** es de demostración —no lleva un `iss` de demo, o el
escáner la reconoce como de un proveedor real— entonces sí hay filtración y esta
ficha no aplica: hay que rotarla en el proveedor antes de tocar el repo, porque
quitarla del árbol no la desactiva y sigue en la historia de git.

## Cómo se evita

Que el arreglo no rompió nada se comprueba en tres pasos, y el tercero es el que
importa: `git grep` del literal sale vacío, la clave nueva lista el bucket con
200, y **la vieja de demostración responde 400**. Eso último es lo que demuestra
que el emulador cambió de secreto de verdad y no está aceptando las dos.
