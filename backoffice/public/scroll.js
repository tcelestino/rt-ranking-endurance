// Rolagem suave controlada pela Page Visibility API: com a aba oculta a rolagem
// fica pendente (só a última) e é executada quando a aba volta a ficar visível.
function createScrollController({ doc, win }) {
  let pending = null;

  const behavior = () => (win.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');

  function run(action) {
    if (doc.visibilityState === 'hidden') {
      pending = action;
      return;
    }
    action();
  }

  doc.addEventListener('visibilitychange', () => {
    if (doc.visibilityState !== 'visible' || !pending) return;
    const action = pending;
    pending = null;
    action();
  });

  return {
    // só rola se o elemento não estiver inteiro visível (ou seja, quando há scroll)
    scrollToElement(el) {
      run(() => el.scrollIntoView({ behavior: behavior(), block: 'nearest' }));
    },
    scrollToTop() {
      run(() => win.scrollTo({ top: 0, behavior: behavior() }));
    },
  };
}

if (typeof module !== 'undefined') module.exports = { createScrollController };
