// Máscara do campo de km: só dígitos (máx. 5), com "." antes dos 2 últimos
// quando há 3 ou mais (525 -> 5.25). Com até 2 dígitos não insere ".", para o
// backspace sobre o ponto não ser desfeito.
function maskKm(raw) {
  const digits = String(raw).replace(/\D/g, '').slice(0, 5);
  return digits.length <= 2 ? digits : `${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

// Aplica a máscara e mantém o cursor após o mesmo número de dígitos que tinha antes
function maskKmWithCaret(raw, caret) {
  const value = maskKm(raw);
  if (value === raw) return { value, caret };
  const digitsBefore = raw.slice(0, caret).replace(/\D/g, '').length;
  let pos = 0;
  let seen = 0;
  while (pos < value.length && seen < digitsBefore) {
    if (/\d/.test(value[pos])) seen += 1;
    pos += 1;
  }
  return { value, caret: pos };
}

// km (número) -> valor do campo editável (10.5 -> "10.50")
function kmToInput(km) {
  return km === null || km === undefined ? '' : km.toFixed(2);
}

// "10.50" -> 10.5; campo vazio -> null
function parseKmInput(text) {
  return text === '' ? null : Number(text);
}

if (typeof module !== 'undefined') module.exports = { maskKm, maskKmWithCaret, kmToInput, parseKmInput };
