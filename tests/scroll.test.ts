import assert from 'node:assert/strict';
import test from 'node:test';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createScrollController } = require('../backoffice/public/scroll.js');

function setup({ reducedMotion = false, visibility = 'visible' } = {}) {
  let handler: (() => void) | null = null;
  const doc = {
    visibilityState: visibility,
    addEventListener: (type: string, fn: () => void) => {
      if (type === 'visibilitychange') handler = fn;
    },
  };
  const scrollToCalls: unknown[] = [];
  const win = {
    scrollTo: (opts: unknown) => scrollToCalls.push(opts),
    matchMedia: () => ({ matches: reducedMotion }),
  };
  const elCalls: unknown[] = [];
  const el = { scrollIntoView: (opts: unknown) => elCalls.push(opts) };
  const controller = createScrollController({ doc, win });
  return { doc, el, elCalls, scrollToCalls, controller, fire: () => handler?.() };
}

test('scrollToElement rola suave até o elemento com a aba visível', () => {
  const { controller, el, elCalls } = setup();
  controller.scrollToElement(el);
  assert.deepEqual(elCalls, [{ behavior: 'smooth', block: 'nearest' }]);
});

test('scrollToTop rola suave ao topo com a aba visível', () => {
  const { controller, scrollToCalls } = setup();
  controller.scrollToTop();
  assert.deepEqual(scrollToCalls, [{ top: 0, behavior: 'smooth' }]);
});

test('prefers-reduced-motion usa behavior auto', () => {
  const { controller, el, elCalls, scrollToCalls } = setup({ reducedMotion: true });
  controller.scrollToElement(el);
  controller.scrollToTop();
  assert.deepEqual(elCalls, [{ behavior: 'auto', block: 'nearest' }]);
  assert.deepEqual(scrollToCalls, [{ top: 0, behavior: 'auto' }]);
});

test('aba oculta adia a rolagem até ficar visível', () => {
  const { controller, doc, el, elCalls, fire } = setup({ visibility: 'hidden' });
  controller.scrollToElement(el);
  assert.equal(elCalls.length, 0);
  doc.visibilityState = 'visible';
  fire();
  assert.equal(elCalls.length, 1);
});

test('aba oculta guarda só a última rolagem pendente', () => {
  const { controller, doc, el, elCalls, scrollToCalls, fire } = setup({ visibility: 'hidden' });
  controller.scrollToElement(el);
  controller.scrollToTop();
  doc.visibilityState = 'visible';
  fire();
  assert.equal(scrollToCalls.length, 1);
  assert.equal(elCalls.length, 0);
});

test('visibilitychange para hidden não executa pendência e ela não repete', () => {
  const { controller, doc, el, elCalls, fire } = setup({ visibility: 'hidden' });
  controller.scrollToElement(el);
  fire();
  assert.equal(elCalls.length, 0);
  doc.visibilityState = 'visible';
  fire();
  fire();
  assert.equal(elCalls.length, 1);
});
