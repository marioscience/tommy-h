import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

// Preserve original console handles
const origConsole = { info: console.info, warn: console.warn, error: console.error };
const calls = { info: [], warn: [], error: [] };

function resetSpies() {
  calls.info.length = 0;
  calls.warn.length = 0;
  calls.error.length = 0;
  console.info = (...args) => calls.info.push(args);
  console.warn = (...args) => calls.warn.push(args);
  console.error = (...args) => calls.error.push(args);
}

function restoreConsole() {
  console.info = origConsole.info;
  console.warn = origConsole.warn;
  console.error = origConsole.error;
}

// 1. Setup DOM and evaluate common.js with complete Node global bindings
function setupEnvironment(debugMode = false, hasContainer = true) {
  resetSpies();

  const html = hasContainer
    ? '<!DOCTYPE html><html><body><div id="toast-container"></div></body></html>'
    : '<!DOCTYPE html><html><body></body></html>';
  const dom = new JSDOM(html, { url: 'http://localhost' });
  const { window } = dom;

  // Bind browser globals into Node execution scope for eval
  global.window = window;
  global.document = window.document;
  global.location = window.location;
  global.localStorage = window.localStorage;

  // Load and evaluate common.js
  const commonSrc = fs.readFileSync('frontend/public/js/common.js', 'utf8');
  window.eval(commonSrc);

  // Bind Nexus to global scope and set active mode
  global.Nexus = window.Nexus;
  window.Nexus.debugMode = debugMode;

  // Wire up window.showToast with missing-container guard
  window.showToast = (message, type = 'success', options = {}) => {
    window.Nexus?.mirrorToast(message, type, options);
    const container = window.document.getElementById('toast-container');
    if (!container) return;
    const toast = window.document.createElement('div');
    toast.className = 'toast ' + type;
    container.appendChild(toast);
  };

  return { window, calls, dom };
}

// ---------------------------------------------------------------------------
// Acceptance Criteria Test Suite
// ---------------------------------------------------------------------------

test('AC-1: Debug Guardrail produces zero console noise when debugMode === false', () => {
  const { window, calls } = setupEnvironment(false);

  window.showToast('Production Toast', 'success');
  window.showToast('Production Alert', 'danger');

  assert.equal(calls.info.length, 0, 'No console.info allowed in production');
  assert.equal(calls.warn.length, 0, 'No console.warn allowed in production');
  assert.equal(calls.error.length, 0, 'No console.error allowed in production');
});

test('AC-2: Active Mirroring formats badge and CSS colors when debugMode === true', () => {
  const { window, calls } = setupEnvironment(true);

  window.showToast('Sample', 'success');

  assert.equal(calls.info.length, 1, 'Should call console.info once');
  // Match %c[Toast:success @ HH:MM:SS.mmm]%c Sample
  assert.match(calls.info[0][0], /^%c\[Toast:success @ \d{2}:\d{2}:\d{2}\.\d{3}\]%c Sample$/);
  assert.equal(calls.info[0][1], 'color: #55ff55; font-weight: bold;', 'Badge must be green');
  assert.equal(calls.info[0][2], 'color: inherit;', 'Message text must reset color');
});

test('AC-3: Deduplication suppresses mirrored console log when triggered via reportError', () => {
  const { window, calls } = setupEnvironment(true);

  // Dispatch an error that requests a UI toast
  window.Nexus.reportError(new Error('Network partition detected'), {
    source: 'network',
    showToast: true
  });

  // 1. reportError must log the structured error payload
  assert.equal(calls.error.length, 1, 'Exactly one console.error should be emitted');
  assert.match(calls.error[0][0], /\[Client Error\]\[network\] Network partition detected/);

  // 2. Toast mirroring must be suppressed (zero info or warn calls from the toast)
  assert.equal(calls.info.length, 0, 'No info toast should be logged');
  assert.equal(calls.warn.length, 0, 'No warn toast should be logged');

  // 3. Direct verification of options.skipConsole
  window.showToast('Direct mute test', 'info', { skipConsole: true });
  assert.equal(calls.info.length, 0, 'skipConsole: true must suppress mirroring');
});

test('AC-4: Severity Matrix routes correctly to console methods and colors', () => {
  const { window, calls } = setupEnvironment(true);

  // Warning -> console.warn (#ffaa00)
  window.showToast('Disk space at 85%', 'warning');
  assert.equal(calls.warn.length, 1);
  assert.match(calls.warn[0][0], /\[Toast:warning @/);
  assert.equal(calls.warn[0][1], 'color: #ffaa00; font-weight: bold;');

  // Info -> console.info (#00bbff)
  window.showToast('Backup started', 'info');
  assert.equal(calls.info.length, 1);
  assert.match(calls.info[0][0], /\[Toast:info @/);
  assert.equal(calls.info[0][1], 'color: #00bbff; font-weight: bold;');

  // Danger -> console.error (#ff5555)
  window.showToast('Process crashed', 'danger');
  assert.equal(calls.error.length, 1);
  assert.match(calls.error[0][0], /\[Toast:error @/);
  assert.equal(calls.error[0][1], 'color: #ff5555; font-weight: bold;');

  // Error -> console.error (#ff5555)
  window.showToast('Syntax fault', 'error');
  assert.equal(calls.error.length, 2);
  assert.match(calls.error[1][0], /\[Toast:error @/);
  assert.equal(calls.error[1][1], 'color: #ff5555; font-weight: bold;');

  // Default / Fallback for unknown type -> console.info (#55ff55)
  window.showToast('Unknown type message', 'unrecognized-type');
  assert.equal(calls.info.length, 2);
  assert.match(calls.info[1][0], /\[Toast:success @/);
  assert.equal(calls.info[1][1], 'color: #55ff55; font-weight: bold;');
});

test('AC-5: Timestamp Invariant conforms strictly to HH:MM:SS.mmm format', () => {
  const { window, calls } = setupEnvironment(true);

  window.showToast('Timestamp precision test', 'info');
  assert.equal(calls.info.length, 1);

  const rawLog = calls.info[0][0];
  const match = rawLog.match(/@ (\d{2}:\d{2}:\d{2}\.\d{3})/);
  assert.ok(match, 'Timestamp must match HH:MM:SS.mmm format');

  const [hours, minutes, seconds, millis] = match[1].split(/[:.]/).map(Number);
  assert.ok(hours >= 0 && hours <= 23, 'Valid hours');
  assert.ok(minutes >= 0 && minutes <= 59, 'Valid minutes');
  assert.ok(seconds >= 0 && seconds <= 59, 'Valid seconds');
  assert.ok(millis >= 0 && millis <= 999, 'Valid milliseconds');
});

test('AC-6: Headless Resilience executes cleanly when #toast-container is absent', () => {
  const { window, calls } = setupEnvironment(true, false);

  assert.doesNotThrow(() => {
    window.showToast('Headless execution test', 'success');
  }, 'showToast must not crash when #toast-container is missing');
  assert.equal(calls.info.length, 1, 'Mirroring still functions even without DOM container');

  restoreConsole();
});