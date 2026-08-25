# queandabuscando

Tiendas online para los negocios que ya usan **Cuadre de Caja**. Cada local
publicado vive en `dominio/[slug]`: los clientes ven el catálogo con precios y
disponibilidad reales, y hacen pedidos. A futuro, un marketplace.

Los dos sistemas tienen bases de datos separadas y **ninguno tiene credenciales
del otro**. cuadrecaja empuja cambios de catálogo por HTTP y lee los pedidos.
El contrato completo está en [`docs/sync-contract.md`](docs/sync-contract.md).

## Empezar

```bash
nvm use
npm ci
cp .env.example .env         # ver DATABASE_URL de abajo
docker compose up -d         # Postgres propio en el puerto 5433
npm run db:migrate
npm run seed
npm run dev                  # http://localhost:3000
```

Para desarrollo local, `DATABASE_URL` y `DIRECT_URL` apuntan al contenedor:

```
postgresql://postgres:postgres@localhost:5433/queandabuscando
```

El puerto es **5433** a propósito: el 5432 suele estar ocupado por el Postgres
de otro proyecto, y compartirlo significa que parar aquel se lleva por delante
esta base de datos.

Comprobar que el entorno sirve:

```bash
bash .agent/init.sh       # debe terminar en ENTORNO LISTO
```

Con el seed cargado hay dos tiendas con paletas distintas:
[`/tienda-demo`](http://localhost:3000/tienda-demo) y
[`/tienda-dos`](http://localhost:3000/tienda-dos).

## Dónde está cada cosa

|                                                  |                                                        |
| ------------------------------------------------ | ------------------------------------------------------ |
| [`AGENTS.md`](AGENTS.md)                         | Convenciones, arquitectura y las trampas del repo      |
| [`.agent/`](.agent/README.md)                    | Backlog (`features.json`) y protocolo de progreso      |
| [`docs/sync-contract.md`](docs/sync-contract.md) | Lo que implementa el equipo de cuadrecaja              |
| [`docs/adr/`](docs/adr/)                         | Por qué las decisiones estructurales son como son      |
| `scripts/`                                       | Simuladores del POS para verificar sin el otro sistema |

## Verificar el contrato sin cuadrecaja

Los scripts de `scripts/` hacen de POS. Con `npm run dev` levantado:

```bash
node scripts/send-catalog-batch.mjs --repeat        # processed
node scripts/send-catalog-batch.mjs --repeat        # duplicate
node scripts/send-catalog-batch.mjs --bad-token     # 401
node scripts/send-catalog-batch.mjs --unknown-store # skipped_not_published
node scripts/send-catalog-batch.mjs --stale         # stale
node scripts/send-availability-batch.mjs OUT_OF_STOCK
node scripts/mint-sso-token.mjs                     # imprime la URL de login admin
```

Tras el primer comando, recargar `/tienda-demo`: el precio del refresco cambia
de 450 a 499. Esa es la cadena completa sync → inbox → `revalidateTag` → ISR.

Apuntan a `http://localhost:3000`; para otro puerto, `QAB_BASE_URL=... node ...`.
