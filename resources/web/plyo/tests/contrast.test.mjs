// Contrastes du panneau (WCAG AA, 4,5:1 pour le texte courant) : lus directement dans les jetons de index.html.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const LIGHT_BG = '#ffffff';
const DARK_BG = '#2d2d31'; // fond du thème sombre d'Orca

function block(selector) {
  const at = html.indexOf(selector + ' {');
  assert.ok(at >= 0, 'bloc ' + selector + ' introuvable');
  return html.slice(at, html.indexOf('}', at));
}
function token(css, name) {
  const m = new RegExp('--' + name + ':\\s*(#[0-9a-fA-F]{6})').exec(css);
  return m && m[1];
}
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
// color-mix(in srgb, a p%, b) : mélange linéaire des composantes, comme le navigateur.
function mix(a, p, b) {
  const ch = (h, i) => parseInt(h.slice(i, i + 2), 16);
  return '#' + [1, 3, 5].map((i) => Math.round(ch(a, i) * p + ch(b, i) * (1 - p)).toString(16).padStart(2, '0')).join('');
}

const light = block(':root');
const dark = block(':root[data-orca-theme="dark"]');
const pick = (name) => token(dark, name) || token(light, name);

test('thème clair : boutons pleins et textes de couleur au moins à 4,5:1', () => {
  assert.ok(ratio(token(light, 'on-accent'), token(light, 'accent-fill')) >= 4.5, 'blanc sur --accent-fill');
  for (const name of ['accent-text', 'warn-text', 'danger-text'])
    assert.ok(ratio(token(light, name), LIGHT_BG) >= 4.5, '--' + name + ' sur blanc : ' + ratio(token(light, name), LIGHT_BG).toFixed(2));
  // Puces « on » et pastilles : texte accentué sur le fond teinté à 10 %.
  assert.ok(ratio(token(light, 'accent-text'), mix('#009688', 0.10, LIGHT_BG)) >= 4.5, '--accent-text sur --accent-soft');
});

test('thème sombre : mêmes exigences sur le fond d’Orca', () => {
  assert.ok(ratio(token(light, 'on-accent'), pick('accent-fill')) >= 4.5, 'blanc sur --accent-fill');
  for (const name of ['accent-text', 'warn-text', 'danger-text'])
    assert.ok(ratio(pick(name), DARK_BG) >= 4.5, '--' + name + ' sur le fond sombre : ' + ratio(pick(name), DARK_BG).toFixed(2));
  assert.ok(ratio(pick('accent-text'), mix('#009688', 0.16, DARK_BG)) >= 4.5, '--accent-text sur --accent-soft sombre');
});

test('l’ancien vert #009688 ne suffit pas pour du texte blanc (raison des jetons)', () => {
  assert.ok(ratio('#ffffff', '#009688') < 4.5);
});
