import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const source = await fs.readFile('frontend/public/js/csp-bindings.js', 'utf8');
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  runScripts: 'dangerously',
  url: 'http://127.0.0.1/'
});
const { window } = dom;
window.eval(source);

let clickCount = 0;
let boundElement = null;
const clickAttribute = window.rnBind('click', (event, element) => {
  clickCount += 1;
  boundElement = element;
  return false;
});

const root = window.document.getElementById('root');
root.insertAdjacentHTML('beforeend', `<button id="bound" ${clickAttribute}>Seguro</button>`);
const button = window.document.getElementById('bound');
const click = new window.MouseEvent('click', { bubbles: true, cancelable: true });
button.dispatchEvent(click);

assert.equal(clickCount, 1);
assert.equal(boundElement, button);
assert.equal(click.defaultPrevented, true);
assert.equal(button.hasAttribute('onclick'), false);
assert.match(clickAttribute, /^data-rn-bind-click="[A-Za-z0-9_-]{24}"$/);

// Re-rendering an async view may reuse its trusted template string. The new
// control must retain the closure even though MutationObserver sees the old
// element leave the DOM in the same turn.
root.innerHTML = `<button id="rebound" ${clickAttribute}>Seguro</button>`;
await new Promise((resolve) => window.queueMicrotask(resolve));
const rebound = window.document.getElementById('rebound');
rebound.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
assert.equal(clickCount, 2, 'a synchronously replaced binding must remain active');

let enterCount = 0;
const keyupAttribute = window.rnBind('keyup', (event) => {
  if (event.key === 'Enter') enterCount += 1;
});
root.insertAdjacentHTML('beforeend', `<input id="command" ${keyupAttribute}>`);
const commandInput = window.document.getElementById('command');
commandInput.dispatchEvent(new window.KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
assert.equal(enterCount, 1, 'keyup bindings must support command and search inputs');

assert.throws(() => window.rnBind('load', () => {}), /Unsupported CSP event/);
assert.throws(() => window.rnBind('click', 'not-a-function'), /must be a function/);

rebound.remove();
await new Promise((resolve) => window.queueMicrotask(resolve));
dom.window.close();

const styleNonceSource = await fs.readFile('frontend/public/js/csp-style-nonce.js', 'utf8');
const styleDom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
  runScripts: 'dangerously',
  url: 'http://127.0.0.1/'
});
const nonceBootstrap = styleDom.window.document.createElement('script');
nonceBootstrap.nonce = 'fixture-nonce';
nonceBootstrap.textContent = styleNonceSource;
styleDom.window.document.head.appendChild(nonceBootstrap);
const dynamicStyle = styleDom.window.document.createElement('style');
assert.equal(dynamicStyle.nonce, 'fixture-nonce');
styleDom.window.close();

console.log('CSP closure-binding fixture passed.');
