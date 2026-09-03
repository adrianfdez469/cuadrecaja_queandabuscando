---
feature: F-034
agente: orquestador
actualizado: 2026-09-03T00:00:00Z
estado: no aplica
---

## No aplica

F-034 no construye ninguna pantalla. Lo que hace es abrir una ruta máquina a
máquina —`POST /api/provisioning/credential` (por crear)— que llama el
superadministrador de cuadrecaja **desde cuadrecaja**, con un
`Authorization: Bearer` y un secreto compartido. Ninguna sesión de navegador la
alcanza, `robots.ts` ya deniega `/api/` entero, y el `matcher` de
`src/proxy.ts` no la roza. No hay pantalla, ni breakpoint, ni token de tema, ni
un byte de JavaScript de cliente que diseñar; el presupuesto de bundle no se
mueve con este feature.

**La ausencia de pantalla es una decisión, no un olvido.** El botón que dispara
esta llamada vive **en cuadrecaja**, y ahí es donde el humano lo quiso: la
admisión de negocios es de ellos ([D1](../propuestas/credenciales-de-integracion.md)
y § La admisión: existe, y no vive aquí de esa misma propuesta). Diseñar aquí
una pantalla de aprovisionamiento sería replicar una decisión que se toma al
otro lado y quedarnos con la copia rancia — el error que
[ADR 0005](../../../docs/adr/0005-dos-sistemas-de-auth.md) ya descartó con los
hashes de contraseña.

Lo que sí queda del lado de queandabuscando y **no** es diseño de interfaz:

- La vía de rescate sigue siendo una terminal, `npm run mint:token -- <externalId>`
  (R18 de `spec.md`).
- Revocar o dar de baja un negocio sigue siendo `Business.active`, que hoy no
  tiene pantalla y esta propuesta no le da una (§ Fuera de `spec.md`).

Si algún día queandabuscando administra negocios que no existen en cuadrecaja,
eso no es una pantalla más sobre esta ruta: es la § El futuro que no se prepara
aquí de la propuesta, con cuatro bloqueos que ninguna interfaz resuelve.
