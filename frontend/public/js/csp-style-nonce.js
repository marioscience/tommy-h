(() => {
  'use strict';

  if (window.__rnStyleNoncePropagationInstalled) return;
  const nonce = document.currentScript?.nonce || '';
  if (!nonce) return;

  const originalCreateElement = Document.prototype.createElement;
  Document.prototype.createElement = function createElementWithCspNonce(tagName, options) {
    const element = originalCreateElement.call(this, tagName, options);
    if (String(tagName).toLowerCase() === 'style') element.nonce = nonce;
    return element;
  };
  window.__rnStyleNoncePropagationInstalled = true;
})();
