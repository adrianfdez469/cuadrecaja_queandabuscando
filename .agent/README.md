# Protocolo de trabajo para agentes

Tres archivos, tres responsabilidades:

| Archivo            | Qué es                                       | Quién lo escribe  |
| ------------------ | -------------------------------------------- | ----------------- |
| `features.json`    | Qué hay que construir y **cómo se verifica** | El humano         |
| `progress/<id>.md` | Cómo va un feature en curso                  | El agente         |
| `init.sh`          | Comprueba que el entorno sirve               | Nadie, se ejecuta |

## Al empezar una sesión

1. `bash .agent/init.sh` — debe terminar en `ENTORNO LISTO`.
2. Leer `AGENTS.md` (convenciones) y `features.json` (backlog) completos.
3. Elegir un feature con `passes: false` cuyos `depends_on` estén todos en `true`.
4. Si existe `progress/<id>.md`, retomar desde su **Próximo paso concreto**.
   Si no existe, crearlo copiando `progress/TEMPLATE.md`.

## Al cerrar una sesión

Obligatorio, **aunque el trabajo quede a medias**: actualizar `progress/<id>.md`,
con «Próximo paso concreto» relleno. Un progreso que dice «avanzando en el
handler» no sirve a nadie; uno que dice «implementar el caso 2(c) en
`features/sync/handlers/product.ts:47`, el test que lo cubre ya está escrito y
falla» permite que otra sesión continúe sin releer el hilo.

## Al completar un feature

`passes` pasa a `true` **solo** cuando cada `acceptance_criteria` fue verificado
**ejecutando algo** — un comando y su código de salida, una petición HTTP y su
respuesta. Leer el código y concluir que debería funcionar no cuenta. Después se
borra el `progress/<id>.md`.

## Lo que un agente no hace

- Agregar features por iniciativa propia. Si aparece uno, se propone al humano.
- Modificar un `acceptance_criteria` ya escrito. Si está mal, se agrega un
  feature nuevo que lo corrija; el viejo queda como registro de lo que se creyó.
- Borrar un feature. Se marca `"status": "deprecated"` y se explica en `notes`.
