import React from 'react';
import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { PluginReadme } from './PluginReadme';

test('README never creates active HTML, remote media or script links', () => {
  const html = renderToStaticMarkup(<PluginReadme markdown={'# Example\n\n<script>alert(1)</script>\n\n<img src="https://tracker.example/pixel">\n\n![track](https://tracker.example/x.svg)\n\n[run](javascript:alert%281%29)\n\n[docs](https://example.com)\n\n```html\n<iframe src="file:///secret">\n```'} />);
  assert.doesNotMatch(html, /<(script|img|iframe|svg)\b/);
  assert.doesNotMatch(html, /href="(javascript|file):/);
  assert.match(html, /href="https:\/\/example.com"/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.match(html, /&lt;script&gt;/);
});

test('README only renders registered local rasterized images and placeholders otherwise', () => {
  const path = `/assets/${'a'.repeat(64)}.png`;
  const html = renderToStaticMarkup(<PluginReadme markdown={`![ok](${path}) ![tracker](https://evil.test/x) ![bad](/unknown)`} images={{ [path]: 'data:image/png;base64,YQ==' }} />);
  assert.match(html, /src="data:image\/png;base64,YQ=="/);
  assert.match(html, /\[tracker\]/);
  assert.match(html, /\[bad\]/);
  assert.doesNotMatch(html, /evil\.test/);
});

test('README renders GitHub-style centered HTML headers and GFM pipe tables cleanly without leaking raw HTML or remote images', () => {
  const md = [
    '<p align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/icon.svg"><img src="assets/icon.svg" alt="Icon" width="84"></picture></p>',
    '<h1 align="center">Netcatty Database</h1>',
    '<p align="center"><strong>Enterprise IDE &amp; BI Dashboard</strong></p>',
    '<p align="center"><a href="https://github.com/binaricat/netcatty-database-plugin"><img src="https://img.shields.io/badge/version-v0.3.0-0ea5e9" alt="v0.3.0"></a></p>',
    '',
    '| Engine | Status |',
    '| --- | --- |',
    '| PostgreSQL | **Live** |',
    '| MongoDB | `Aggregation` |',
  ].join('\n');
  const html = renderToStaticMarkup(<PluginReadme markdown={md} />);
  assert.match(html, /<h3[^>]*text-center[^>]*>Netcatty Database<\/h3>/);
  assert.match(html, /<strong>Enterprise IDE &amp; BI Dashboard<\/strong>/);
  assert.doesNotMatch(html, /&lt;p align=/);
  assert.doesNotMatch(html, /&lt;picture&gt;/);
  assert.doesNotMatch(html, /<(img|picture|source)\b/);
  assert.doesNotMatch(html, /shields\.io/);
  assert.match(html, /<table[^>]*>.*<th[^>]*>Engine<\/th>.*<td[^>]*>PostgreSQL<\/td>.*<strong>Live<\/strong>/);
});
