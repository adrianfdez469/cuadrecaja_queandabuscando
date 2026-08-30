# Propuestas

Ideas escritas con criterios ejecutables que **todavía no son features**. El
backlog lo define el humano (regla 4 de `.agent/features.json`): un agente
escribe la propuesta, el humano decide si entra.

Se crean con `bash .agent/sdd.sh propose <slug>`.

## Cuándo se borra una

**Cuando su contenido ya vive en otro sitio**: el feature existe en
`.agent/features.json` **y** su `.agent/specs/<ID>/spec.md` está escrito. Ahí la
propuesta pasa a ser una copia desactualizada de la spec, y una copia
desactualizada engaña a quien la lea. El historial de git la conserva.

**Lo que NO se borra**: una propuesta cuyo feature existe pero **todavía no
tiene `spec.md`**. Ahí la propuesta es el único análisis escrito que hay, y
borrarla destruye trabajo.

Limpieza del 2026-08-30: se borraron nueve propuestas ya trasladadas a su
`spec.md` (F-010, F-018, F-021, F-023, F-024, F-025, F-026, F-027, F-028).
