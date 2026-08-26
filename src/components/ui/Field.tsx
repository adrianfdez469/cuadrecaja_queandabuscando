import type { ReactNode } from "react";

/**
 * Wraps a label + control + help + error and wires `id`, `aria-describedby`
 * and `aria-invalid` in one place. The control itself is a render prop
 * rather than a cloned child: this repo has no input primitive yet, and a
 * render prop keeps the control's own type (`<input>`, `<textarea>`, a radio
 * group) instead of forcing everything through one shape.
 */
export function Field({
  id,
  label,
  help,
  error,
  children,
}: {
  id: string;
  label: string;
  help?: string;
  error?: string;
  children: (controlProps: {
    id: string;
    "aria-describedby": string | undefined;
    "aria-invalid": boolean;
  }) => ReactNode;
}) {
  const helpId = help ? `${id}-help` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [helpId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div>
      <label htmlFor={id} className="text-fg mb-1 block text-sm font-medium">
        {label}
      </label>
      {children({ id, "aria-describedby": describedBy, "aria-invalid": Boolean(error) })}
      {help && !error && (
        <p id={helpId} className="text-fg-muted mt-1 text-xs">
          {help}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-danger mt-1 text-xs">
          {error}
        </p>
      )}
    </div>
  );
}
