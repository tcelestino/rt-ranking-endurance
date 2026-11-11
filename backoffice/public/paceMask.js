// Máscara do campo de pace: só dígitos (máx. 4), com ":" antes dos 2 últimos
// quando há 3 ou mais (545 -> 5:45). Com até 2 dígitos não insere ":", para o
// backspace sobre o ":" não ser desfeito.
function maskPace(raw) {
  const digits = String(raw).replace(/\D/g, '').slice(0, 4);
  return digits.length <= 2 ? digits : `${digits.slice(0, -2)}:${digits.slice(-2)}`;
}

if (typeof module !== 'undefined') module.exports = { maskPace };
