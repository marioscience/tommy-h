import assert from 'node:assert/strict';
import fs from 'node:fs';

const panel = fs.readFileSync('frontend/public/js/panel.js', 'utf8');

assert.ok(!panel.includes('event.currentTarget'), 'panel.js must not depend on delegated event.currentTarget');
assert.ok(!panel.includes('window.event'), 'panel.js must not depend on the browser global event');
assert.match(
  panel,
  /selectDiskPack\(\(p\.id\), \(p\.paypal_plan_id\), \(p\.gb_amount\), element\)/,
  'dynamic disk selection must receive the bound element explicitly'
);
assert.match(
  panel,
  /event\?\.target instanceof Element[\s\S]*?event\.target\.closest\('button'\)/,
  'delegated button actions must resolve the originating button safely'
);

console.log('Delegated action contract passed.');
