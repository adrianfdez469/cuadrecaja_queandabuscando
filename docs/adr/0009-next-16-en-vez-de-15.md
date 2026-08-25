# 0009 — Next.js 16 y React 19.2, no Next 15 como cuadrecaja

**Aceptada** · 2026-08-25

## Contexto

El plan asumía Next 15 por consistencia con cuadrecaja (15.2.6).
`create-next-app@latest` instaló **16.3.2**, la estable actual.

## Decisión

Quedarse en 16. Proyecto nuevo, sin código que migrar.

## Lo que cambia respecto de Next 15

- **`middleware.ts` → `proxy.ts`.** La convención anterior está deprecada y avisa
  en cada build. El export por defecto se llama `proxy`.
- **`revalidateTag(tag)` → `revalidateTag(tag, profile)`.** El segundo argumento
  es un perfil de `cacheLife` o `{ expire }`. Aquí se usa `{ expire: 0 }`: tras
  un lote de sync el valor cacheado ya se sabe incorrecto.
- **`"use cache"` y `cacheTag` están estabilizados**, pero requieren
  `cacheComponents: true`. Ver [ADR 0006](0006-isr-con-revalidacion-por-tag.md).
- **Tipos de rutas generados**: `PageProps<"/[slug]">` y `LayoutProps<"/admin">`
  se generan en `.next/types` durante el build. Un `tsc --noEmit` sobre una ruta
  nueva **falla hasta que se corre `next build`**, lo cual desconcierta.

## Consecuencia

Los dos repos divergen de framework. Compartir componentes entre ellos ya no era
viable de todos modos (cuadrecaja usa MUI, aquí Tailwind), así que el costo real
es tener que recordar cuál es cuál.
