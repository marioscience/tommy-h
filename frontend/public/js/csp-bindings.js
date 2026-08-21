'use strict';

// CSP-safe bindings for controls created from trusted HTML templates. The
// callback remains a real closure; no source text, eval or global-name lookup
// is used when the event fires.
(() => {
  const handlers = new Map();
  const supportedEvents = new Set([
    'change', 'click', 'error', 'input', 'keydown', 'keypress', 'mouseout', 'mouseover'
  ]);

  function token() {
    const bytes = new Uint8Array(18);
    crypto.getRandomValues(bytes);
    return btoa(String.fromCharCode(...bytes))
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replaceAll('=', '');
  }

  globalThis.rnBind = function rnBind(eventType, handler) {
    if (!supportedEvents.has(eventType)) throw new Error(`Unsupported CSP event: ${eventType}`);
    if (typeof handler !== 'function') throw new TypeError('CSP event handler must be a function');
    const id = token();
    handlers.set(id, { eventType, handler });
    return `data-rn-bind-${eventType}="${id}"`;
  };

  function dispatch(event) {
    for (const target of event.composedPath()) {
      if (!(target instanceof Element)) continue;
      const id = target.getAttribute(`data-rn-bind-${event.type}`);
      if (!id) continue;
      const binding = handlers.get(id);
      if (!binding || binding.eventType !== event.type) {
        console.error('[CspBinding] Invalid or expired binding');
        continue;
      }
      try {
        if (binding.handler(event, target) === false) event.preventDefault();
      } catch (error) {
        console.error('[CspBinding]', error);
      }
      if (event.cancelBubble) break;
    }
  }

  for (const eventType of supportedEvents) {
    document.addEventListener(eventType, dispatch, eventType === 'error');
  }

  function releaseTree(node) {
    if (!(node instanceof Element)) return;
    for (const element of [node, ...node.querySelectorAll('*')]) {
      for (const attribute of element.attributes) {
        if (!attribute.name.startsWith('data-rn-bind-')) continue;
        handlers.delete(attribute.value);
      }
    }
  }

  new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.removedNodes) releaseTree(node);
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
