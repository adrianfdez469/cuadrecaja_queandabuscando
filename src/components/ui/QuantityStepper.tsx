/**
 * `−` n `+`, fully controlled from `CartView` — no internal state, so no
 * `"use client"` here: architecture.md fixes exactly four islands, and a
 * stepper with no state or events of its own does not need to be a fifth.
 */
export function QuantityStepper({
  value,
  min = 1,
  max = 99,
  label,
  onIncrement,
  onDecrement,
  onChange,
}: {
  value: number;
  min?: number;
  max?: number;
  label: string;
  onIncrement: () => void;
  onDecrement: () => void;
  onChange: (value: number) => void;
}) {
  const inputId = `qty-${label.replace(/\s+/g, "-").toLowerCase()}`;

  return (
    <div className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={onDecrement}
        disabled={value <= min}
        className="border-border hover:bg-surface-muted flex h-11 w-11 shrink-0 items-center justify-center rounded-md border text-lg disabled:opacity-50"
        aria-label={`Quitar una unidad de ${label}`}
      >
        −
      </button>
      <label className="sr-only" htmlFor={inputId}>
        {`Cantidad de ${label}`}
      </label>
      <input
        id={inputId}
        type="text"
        inputMode="numeric"
        value={value}
        onChange={(event) => {
          const digits = event.target.value.replace(/\D/g, "");
          if (digits === "") return;
          onChange(Math.min(Math.max(Number(digits), 0), max));
        }}
        className="border-border h-11 w-12 rounded-md border text-center"
      />
      <button
        type="button"
        onClick={onIncrement}
        disabled={value >= max}
        className="border-border hover:bg-surface-muted flex h-11 w-11 shrink-0 items-center justify-center rounded-md border text-lg disabled:opacity-50"
        aria-label={`Agregar una unidad de ${label}`}
      >
        +
      </button>
    </div>
  );
}
