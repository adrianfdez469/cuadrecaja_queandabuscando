---
slug: verde-visual-que-no-mira-tu-feature
sintoma: el check `visual` del PR sale verde y el mismo guion visual falla en local
firma: —
etapa: visual
visto_en: F-026
creado: 2026-08-31T06:30:00Z
promovido_a_agents: no
arreglo: no es tu guion — `.github/workflows/ci.yml` solo ejecuta el `--visual` de F-010; corre `bash .agent/verify.sh <TU-ID> --visual` en local y créele a eso
---

## Qué pasa de verdad

No hay ninguna discrepancia entre el CI y tu máquina: **el CI no ejecutó tu
guion**. `.github/workflows/ci.yml` tiene una única línea de verificación
visual y está clavada a un feature:

```yaml
run: bash .agent/verify.sh F-010 --visual
```

Hay ocho features con `visual.mjs` y el CI corre uno. Si el tuyo no es F-010, tu
check `visual` verde significa «el guion de F-010 pasa», nada más. Los
artefactos de capturas y trazas del workflow están clavados al mismo sitio, así
que descargarlos tampoco te va a enseñar tu pantalla.

Esta ficha no existe porque el fallo sea difícil de arreglar, sino porque el
síntoma **invita a la conclusión equivocada y tranquilizadora**: «pasa en CI,
será cosa de mi entorno». Ya pasó una vez, con un `VISUAL FAIL` estable en cinco
corridas locales y un check verde al lado en el PR, y estuvo a punto de decidir
un merge.

Sin `firma`: no hay línea de log que pescar, porque el fallo es un **silencio**.
Se detecta comparando lo que dice el PR con lo que dice tu terminal, como la
ficha `proxy-matcher-anula-isr` — que tampoco falla en ninguna comprobación.

## Cómo se arregla

Para ti, ahora: **créele a tu máquina, no al check.**

```bash
bash .agent/verify.sh <TU-ID> --visual     # esto sí mira tu feature
```

Si sale `1` o `2`, tu pantalla tiene un problema real aunque el PR esté verde.
Trátalo como cualquier fallo del sensor.

Para el repositorio: está propuesto en
`.agent/specs/propuestas/etapa-visual-del-ci-clavada-a-un-feature.md`, con la
decisión pendiente de si se ejecutan todos los guiones o solo los del diff. **No
lo arregles de paso en un PR de producto**: activar los siete guiones que hoy
nadie ejecuta puede poner el CI en rojo por features ajenos, y eso es alcance que
nadie te firmó.

## Cuándo NO es esto

Si tu feature **es** F-010, el verde sí significa algo y una discrepancia con tu
máquina es un problema de verdad: mira el entorno (versión de Chromium, ancho de
ventana, datos de la base) antes de sospechar del CI.

Y no confundas esto con un guion inestable. Si tu `--visual` local pasa unas
veces y falla otras, el problema es el guion —una espera implícita, un dato que
otra corrida dejó a medias— y esta ficha no te sirve. Aquí el patrón es
**estable en local, verde en CI**: eso es el CI no mirando, no el azar.

## Cómo se evita

Que la lista de guiones a ejecutar se **derive** del disco en vez de mantenerse
a mano, que es la misma prohibición que `AGENTS.md` ya tiene para el array de
slugs a revalidar. Y que algo avise cuando existe un `visual.mjs` que ninguna
corrida ejecuta: un guion que nadie corre es peor que ninguno, porque ocupa el
sitio de la garantía sin darla.

Mientras eso no exista, la regla práctica para cualquier agente que cierre un
feature con interfaz: **el `--visual` que cuenta es el que corriste tú.** El
check del PR no es una segunda opinión, es la primera opinión sobre otro
feature.
