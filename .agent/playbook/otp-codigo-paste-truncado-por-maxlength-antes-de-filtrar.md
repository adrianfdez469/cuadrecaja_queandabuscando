---
slug: otp-codigo-paste-truncado-por-maxlength-antes-de-filtrar
sintoma: 'VISUAL FAIL pegar "123 456" desde el portapapeles deja "123456" — obtuve algo más corto o vacío'
firma: VISUAL FAIL pegar "123 456" desde el portapapeles
etapa: visual
visto_en: F-012
creado: 2026-08-30T02:43:04Z
promovido_a_agents: no
arreglo: >-
  quita el `maxLength` HTML del `<input>` de un código que se filtra en
  `onChange` (no-dígitos fuera, recortado a la longitud correcta con
  `.slice()`); el navegador no sabe filtrar, solo cuenta caracteres crudos.
---

## Qué pasa de verdad

Un `<input>` de código (OTP) con `maxLength={N}` y un `onChange` que filtra
los caracteres que no son dígitos (`value.replace(/\D/g, "")`) parece
redundante — dos capas de la misma regla — pero no lo son: se aplican en
orden distinto. `maxLength` lo impone el **navegador**, sobre el texto que se
va a insertar, **antes** de que React vea el evento y el `onChange` corra.
Al pegar `"123 456"` (con espacio) en un campo con `maxLength={6}`, el
navegador corta a los primeros 6 **caracteres crudos** — `"123 45"` — y solo
entonces `onChange` filtra el espacio, dejando `"12345"`: un dígito real
perdido, no por el filtro, sino por el corte que pasó antes que él. Pegar
`"Tu código es 123456"` es peor: los primeros 6 caracteres crudos son
`"Tu cód"`, sin un solo dígito, así que el campo queda vacío.

Teclear dígito a dígito nunca lo revela porque cada tecla ya es un solo
carácter válido — el corte y el filtro coinciden. Solo un paste real
(`navigator.clipboard.writeText` + `Ctrl/Cmd+V`, no `.fill()` de Playwright,
que asigna el value final sin pasar por los eventos del navegador) lo saca a
la luz.

## Cómo se arregla

Quita el atributo `maxLength` del `<input>`. El `onChange` ya hace el
recorte correcto — `.replace(/\D/g, "").slice(0, N)` — así que el límite de
longitud sigue existiendo, solo que se aplica **después** de filtrar, no
antes. El valor del campo es controlado (`value={code}`), así que no hay
forma de que un usuario deje más de `N` dígitos en pantalla aunque el HTML
ya no lo impida por su cuenta.

Ejemplo real: `src/features/account/components/SignInCard.tsx` (campo
`#signin-code`, `OTP_CODE_LENGTH` = 6).

## Cuándo NO es esto

Si el campo **no** filtra nada en `onChange` (un `<input>` de texto libre
cualquiera con `maxLength`), quitar el atributo sí cambiaría el
comportamiento — ahí el arreglo no aplica: la firma de este fallo es
específica de campos que ya hacen su propio filtrado/recorte en JS.

## Cómo se evita

Cuando un campo controlado ya recorta su propio valor en `onChange`, no le
pongas también `maxLength`: es la fuente de datos crudos (paste,
autorrelleno) la que necesita pasar entera por el filtro antes de cortarse,
nunca al revés. Si hace falta un tope visible para quien teclea con teclado
físico sin JS (poco común en un campo que ya depende de "use client" para
funcionar), documenta por qué se acepta el riesgo en vez de añadir el
atributo por reflejo.
