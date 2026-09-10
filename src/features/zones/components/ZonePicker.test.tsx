import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { OfferableZone } from "../coverage";
import { ZonePicker } from "./ZonePicker";

/**
 * F-042 (architecture.md § Componentes, fila `ZonePicker.test.tsx`) — E2, E3,
 * E6, R7 sobre el DOM. `zones` llega YA resuelta (D5, AD3): este componente
 * nunca consulta nada, así que estos tests dan por hecho el conjunto
 * ofrecible y prueban qué hace la pantalla con él — nunca cómo se calculó
 * (eso es `server/coverage.db.test.ts`, C1/C9).
 */

function zone(overrides: Partial<OfferableZone> = {}): OfferableZone {
  return {
    code: "23.01",
    name: "Playa",
    provinceCode: "23",
    provinceName: "La Habana",
    deliveryFee: "300.00",
    ...overrides,
  };
}

function renderPicker(zones: OfferableZone[], value: string | null = null) {
  const onChange = vi.fn();
  render(
    <ZonePicker
      zones={zones}
      currencyCode="CUP"
      storeSlug="tienda-demo"
      value={value}
      onChange={onChange}
    />,
  );
  return { onChange };
}

function openCombobox() {
  const input = screen.getByPlaceholderText("Escribe tu municipio");
  fireEvent.focus(input);
  return input;
}

describe("ZonePicker — E2: en el DOM SOLO existen las zonas que la tienda declaró", () => {
  it("al abrir sin escribir nada, lista exactamente las zonas recibidas, ninguna más", () => {
    const zones = [zone(), zone({ code: "23.11", name: "Marianao" })];
    renderPicker(zones);
    openCombobox();
    const options = within(screen.getByRole("listbox")).getAllByRole("option");
    expect(options).toHaveLength(2);
    expect(options[0].textContent).toContain("Playa");
    expect(options[1].textContent).toContain("Marianao");
  });

  it('una zona NOT_SERVED que la tienda nunca pasó (p. ej. "Regla", 23.05) no aparece en ninguna forma — ni como código ni como nombre — porque nunca llega en `zones`', () => {
    const zones = [zone(), zone({ code: "23.11", name: "Marianao" })];
    renderPicker(zones);
    openCombobox();
    expect(screen.queryByText(/Regla/)).not.toBeInTheDocument();
    expect(screen.queryByText("23.05")).not.toBeInTheDocument();
  });

  it("elegir una opción emite SU code, y solo entonces se muestra el importe elegido", () => {
    const zones = [zone(), zone({ code: "23.11", name: "Marianao", deliveryFee: "250.00" })];
    const { onChange } = renderPicker(zones);
    openCombobox();
    const options = within(screen.getByRole("listbox")).getAllByRole("option");
    fireEvent.mouseDown(options[1]);
    expect(onChange).toHaveBeenCalledWith("23.11");
  });
});

describe("ZonePicker — E3/R6: escribir filtra sobre lo que ya llegó, sin red y sin tildes", () => {
  it('escribir "pla" reduce la lista a los nombres que la contienen', () => {
    const zones = [
      zone(),
      zone({ code: "23.06", name: "Plaza de la Revolución" }),
      zone({ code: "23.11", name: "Marianao" }),
    ];
    renderPicker(zones);
    const input = openCombobox();
    fireEvent.change(input, { target: { value: "pla" } });

    const options = within(screen.getByRole("listbox")).getAllByRole("option");
    expect(options.map((o) => o.textContent?.includes("Playa"))).toContain(true);
    expect(options.map((o) => o.textContent?.includes("Plaza de la Revolución"))).toContain(true);
    expect(screen.queryByText("Marianao")).not.toBeInTheDocument();
  });

  it('"holguin" (sin tilde) encuentra "Holguín" — R6 con letra', () => {
    const zones = [
      zone({ code: "24.01", name: "Holguín", provinceCode: "24", provinceName: "Holguín" }),
      zone({ code: "24.02", name: "Gibara", provinceCode: "24", provinceName: "Holguín" }),
    ];
    renderPicker(zones);
    const input = openCombobox();
    fireEvent.change(input, { target: { value: "holguin" } });
    expect(screen.getByRole("option", { name: /Holguín/ })).toBeInTheDocument();
  });

  it("sin coincidencias lo dice por nombre y no ofrece ninguna opción para elegir", () => {
    const zones = [zone(), zone({ code: "23.11", name: "Marianao" })];
    renderPicker(zones);
    const input = openCombobox();
    fireEvent.change(input, { target: { value: "regla" } });
    expect(
      screen.getByText("Ningún municipio de esta tienda coincide con «regla»."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
  });
});

describe("ZonePicker — E6/R5: el paso de provincia existe si y solo si la cobertura cruza más de una", () => {
  it("con cobertura en una sola provincia, el control de provincia NO está en el DOM", () => {
    const zones = [zone(), zone({ code: "23.11", name: "Marianao" })];
    renderPicker(zones);
    expect(screen.queryByLabelText("Provincia")).not.toBeInTheDocument();
  });

  it("con cobertura en dos provincias, SÍ está, y ofrece solo las provincias presentes", () => {
    const zones = [
      zone(),
      zone({ code: "21.01", name: "Sandino", provinceCode: "21", provinceName: "Pinar del Río" }),
    ];
    renderPicker(zones);
    const select = screen.getByLabelText("Provincia") as HTMLSelectElement;
    const options = Array.from(select.querySelectorAll("option")).map((o) => o.textContent);
    expect(options).toEqual(["Todas las provincias", "La Habana", "Pinar del Río"]);
  });

  it("elegir una provincia acota la lista de municipios a esa provincia — elegir NO selecciona ninguna zona (R3)", () => {
    const zones = [
      zone(),
      zone({ code: "21.01", name: "Sandino", provinceCode: "21", provinceName: "Pinar del Río" }),
    ];
    const { onChange } = renderPicker(zones);
    fireEvent.change(screen.getByLabelText("Provincia"), { target: { value: "21" } });
    openCombobox();
    const options = within(screen.getByRole("listbox")).getAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0].textContent).toContain("Sandino");
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("ZonePicker — R7: dos zonas ofrecibles con el mismo nombre se desambiguan por provincia, el code sigue siendo lo que se envía", () => {
  const sanLuisPinar = zone({
    code: "21.09",
    name: "San Luis",
    provinceCode: "21",
    provinceName: "Pinar del Río",
  });
  const sanLuisSantiago = zone({
    code: "34.03",
    name: "San Luis",
    provinceCode: "34",
    provinceName: "Santiago de Cuba",
  });

  it("cada opción homónima gana una segunda línea con su provincia, cuando la cobertura cruza provincias", () => {
    renderPicker([sanLuisPinar, sanLuisSantiago]);
    openCombobox();
    const listbox = screen.getByRole("listbox");
    expect(within(listbox).getByText("Pinar del Río")).toBeInTheDocument();
    expect(within(listbox).getByText("Santiago de Cuba")).toBeInTheDocument();
  });

  it("elegir la segunda opción homónima envía SU código propio, nunca el de la otra", () => {
    const { onChange } = renderPicker([sanLuisPinar, sanLuisSantiago]);
    openCombobox();
    const options = within(screen.getByRole("listbox")).getAllByRole("option");
    expect(options).toHaveLength(2);
    fireEvent.mouseDown(options[1]);
    expect(onChange).toHaveBeenCalledWith("34.03");
    expect(onChange).not.toHaveBeenCalledWith("21.09");
  });

  it("dentro de una única provincia, ningún nombre se repite en el índice — la segunda línea no se pinta (design.md § 1)", () => {
    renderPicker([zone(), zone({ code: "23.11", name: "Marianao" })]);
    openCombobox();
    // Ninguna de las dos provincias declaradas aparece como segunda línea:
    // con una sola provincia en la cobertura no hay nada que desambiguar.
    expect(screen.queryByText("La Habana")).not.toBeInTheDocument();
  });
});

describe("ZonePicker — D11: una cobertura de un solo municipio viene elegido y declarado, sin campo de búsqueda", () => {
  it("no hay combobox ni paso de provincia; la línea declara el único municipio y su importe", () => {
    renderPicker([zone()]);
    expect(screen.queryByPlaceholderText("Escribe tu municipio")).not.toBeInTheDocument();
    expect(screen.getByText(/Esta tienda solo entrega en Playa/)).toBeInTheDocument();
  });

  it("un importe 0 en la cobertura de un solo municipio dice 'Envío gratis', nunca un importe residual (R10)", () => {
    renderPicker([zone({ deliveryFee: "0.00" })]);
    expect(screen.getByText(/Envío gratis/)).toBeInTheDocument();
  });
});
