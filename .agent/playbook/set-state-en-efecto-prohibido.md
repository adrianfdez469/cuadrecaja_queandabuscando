---
slug: set-state-en-efecto-prohibido
sintoma: "lint falla con react-hooks/set-state-in-effect: Avoid calling setState() directly within an effect"
firma: Avoid calling setState\(\) directly within an effect
etapa: lint
visto_en: F-010, F-017
creado: 2026-08-26T11:20:00Z
promovido_a_agents: sí
arreglo: si el valor se pinta, derívalo del render o de useSyncExternalStore; si es una intención de una sola vez (mover el foco, hacer scroll), guárdala en un useRef y consúmela en el efecto — una ref no infringe la regla y además no debe sobrevivir al render siguiente
---

## Qué pasa de verdad

La regla no es un detalle de estilo: un `setState` dentro de un efecto provoca un
segundo render en cascada, y con React 19 y el compilador activo es error de
ESLint, no aviso. En F-010 mordió **cuatro veces** —la disponibilidad de
`localStorage`, el flag de hidratación, el temporizador de «conexión lenta» y el
foco del resumen de errores del checkout— así que no es mala suerte: es el patrón
por defecto que a uno se le ocurre y está prohibido aquí.

## Cómo se arregla

Depende de qué clase de cosa sea el valor, y esa es la pregunta que hay que
hacerse primero:

1. **Es algo que se pinta y viene de fuera de React** (`localStorage`, el tamaño
   de la ventana, `matchMedia`): `useSyncExternalStore`. Es lo que usa
   `src/features/cart/cartStore.ts`, y AGENTS.md § Arquitectura lo fija como la
   convención del repo.
2. **Es algo que se puede derivar del render**: derívalo y no guardes estado.
3. **Es una intención de una sola vez que necesita el DOM ya montado** —mover el
   foco, hacer scroll, medir— y por tanto no puede resolverse en el cuerpo del
   evento: guárdala en un `useRef`, ponla a `true` en el handler y consúmela en un
   efecto cuyas dependencias sean el estado que monta el nodo.

   ```tsx
   const quiereFoco = useRef(false);
   // en el handler: quiereFoco.current = true;   (nada de setState)
   useEffect(() => {
     if (!quiereFoco.current) return;
     quiereFoco.current = false; // consumir, no dejar pegado
     nodoRef.current?.focus();
   }, [estadoQueMontaElNodo]);
   ```

   Una ref no dispara render, así que la regla no aplica. Y consumirla en la misma
   pasada no es cosmético: si se queda a `true`, un re-render posterior le roba el
   foco a donde el usuario lo haya movido.

4. **Lo que NO vale**: `setState` en un `setTimeout(…, 0)` para esquivar la regla.
   El lint calla y la cascada de renders sigue ahí. Diferir a un temporizador es
   legítimo solo cuando de verdad hay que esperar algo (`fetchQuote` en
   `CheckoutForm` lo hace porque su primera línea es un `setState`), no como truco.

## Cuándo NO es esto

Si el `setState` está en la **función de limpieza** del efecto, la regla no salta
y es correcto: limpiar al desmontar no encadena renders del mismo commit.

## Cómo se evita

Antes de escribir un `useEffect` que ponga estado, contestar: ¿esto se pinta, o es
una orden al DOM? Si es una orden, es una ref. La mitad de los casos de F-010 eran
órdenes disfrazadas de estado.
