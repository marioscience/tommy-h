import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const serverSource = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
const commonSource = fs.readFileSync(
  new URL('../../frontend/public/js/common.js', import.meta.url),
  'utf8'
);
const emailSource = fs.readFileSync(
  new URL('../src/services/emailService.js', import.meta.url),
  'utf8'
);

describe('Panel domain policy', () => {
  it('moves authenticated production surfaces to panel.ragenodes.app', () => {
    assert.match(serverSource, /PANEL_APP_ORIGIN = 'https:\/\/panel\.ragenodes\.app'/);
    assert.match(serverSource, /PUBLIC_MARKETING_HOSTS/);
    assert.match(serverSource, /panelAppPaths = new Set\(\['\/panel', '\/admin'\]\)/);
    assert.match(serverSource, /res\.redirect\(308,/);
  });

  it('keeps staging and local hosts outside the production redirect', () => {
    assert.doesNotMatch(serverSource, /PUBLIC_MARKETING_HOSTS[^\n]*ragenodes\.dev/);
    assert.match(commonSource, /hostname !== 'ragenodes\.com'/);
    assert.match(commonSource, /hostname !== 'www\.ragenodes\.com'/);
  });

  it('sends public login actions and email links to the technical app domain', () => {
    assert.match(commonSource, /https:\/\/panel\.ragenodes\.app/);
    assert.match(commonSource, /params\.get\('login'\) === '1'/);
    assert.doesNotMatch(emailSource, /https:\/\/ragenodes\.com\/panel/);
    assert.match(emailSource, /https:\/\/panel\.ragenodes\.app\/panel/);
  });
});
