---
slug: playbook-firma-grep-bsd-no-gnu
sintoma: "una ficha nueva del playbook no se reconoce a sí misma: verify.sh dice 'La bitácora no reconoce este fallo' aunque la firma, probada a mano, sí matchea el log"
firma: —
etapa: review
visto_en: F-010
creado: 2026-08-26T05:10:00Z
promovido_a_agents: no
arreglo: escribe la firma en ERE POSIX puro — nada de \w, \d, \s ni otras clases estilo Perl/GNU — porque verify.sh corre con el grep real del sistema, no con el que ves en tu propia sesión interactiva
---

## Qué pasa de verdad

En este entorno (Claude Code sobre macOS), el `grep` de la sesión interactiva
del agente es una función de shell que envuelve `ugrep` — mucho más permisivo
que el `grep` real: acepta `\w`, `\d` y otras clases estilo Perl incluso en
modo `-E`. Esa función de shell **no se hereda** cuando `verify.sh` se ejecuta
como proceso nuevo con `bash`: ahí corre el `grep` real
del sistema (BSD grep en macOS), que en modo `-E` (POSIX ERE) **no entiende
`\w`** — lo trata como una `w` literal escapada de forma rara, y el patrón
completo deja de matchear el log real.

Consecuencia: se prueba la firma a mano en la sesión del agente, matchea, se
guarda en la ficha — y en la primera ejecución real de `verify.sh` la propia
ficha que se acaba de escribir no se reconoce a sí misma.

## Cómo se arregla

1. Sustituye cualquier clase estilo Perl/GNU por su equivalente POSIX:
   `\w` → `[A-Za-z0-9_]` (o `[A-Za-z0-9._-]` si hace falta incluir punto y
   guion), `\d` → `[0-9]`, `\s` → `[[:space:]]`.
2. Vuelve a probar la firma, pero **no** con el `grep` de la sesión
   interactiva: usa `bash -c 'grep -aEi -- "<firma>" archivo.log'` en un
   proceso nuevo, o mejor todavía, corre de verdad
   `bash .agent/verify.sh <ID> --only <etapa>` y comprueba que la ficha
   aparece bajo «YA NOS PASÓ».

## Cuándo NO es esto

Si la firma nunca matcheó ni siquiera en la sesión interactiva, el problema
es la expresión regular en sí (algo más simple: paréntesis sin escapar, una
alternancia mal puesta), no esta trampa del `grep` envuelto.

## Cómo se evita

Al escribir una ficha nueva, verificar la firma **siempre** con
`bash .agent/verify.sh <ID> --only <etapa>` de verdad — no con un `grep`
suelto en la sesión del agente — es lo único que reproduce exactamente el
entorno donde la firma tiene que funcionar.
