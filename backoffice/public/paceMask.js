// Máscara do campo de pace: só dígitos (máx. 4), com ":" antes dos 2 últimos
// quando há 3 ou mais (545 -> 5:45). Com até 2 dígitos não insere ":", para o
// backspace sobre o ":" não ser desfeito.
function maskPace(raw) {
  const digits = String(raw).replace(/\D/g, '').slice(0, 4);
  return digits.length <= 2 ? digits : `${digits.slice(0, -2)}:${digits.slice(-2)}`;
}

// Aplica a máscara e mantém o cursor após o mesmo número de dígitos que tinha antes
function maskPaceWithCaret(raw, caret) {
  const value = maskPace(raw);
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

if (typeof module !== 'undefined') module.exports = { maskPace, maskPaceWithCaret };
