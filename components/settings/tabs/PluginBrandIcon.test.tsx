import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { inspectPluginBrandIcon } from '@netcatty/plugin-contract';
import { clearCatalogBrandIconCacheForTests } from '../../../application/state/usePluginBrandIcon';
import { PluginBrandIcon } from '../../plugins/PluginBrandIcon';
import { resolveCatalogBrandIcon } from '../../plugins/catalogBrandIcons';
import previews from '../../plugins/catalog-brand-icons.json';

const preview = previews[0];
const entry = { ...preview, manifest: { icon: preview.icon } } as unknown as NetcattyPluginCatalogEntry;
test('reviewed catalog brand previews bind version, source and declaration, never arbitrary URLs', () => {
  assert.ok(resolveCatalogBrandIcon(entry));
  const catalog = JSON.parse(readFileSync(new URL('../../../electron/plugins/catalog.json', import.meta.url), 'utf8')) as NetcattyPluginCatalogEntry[];
  assert.equal(previews.length, 2);
  assert.equal(catalog.length, 2);
  for (const item of previews) {
    assert.ok(resolveCatalogBrandIcon(catalog.find((c) => c.id === item.id)!), `catalog should match preview for ${item.id}`);
    for (const theme of ['light', 'dark'] as const) {
      const bytes = Buffer.from(item[theme].split(',')[1], 'base64');
      assert.equal(createHash('sha256').update(bytes).digest('hex'), item[`${theme}Sha256`]);
      const inspected = inspectPluginBrandIcon(bytes, item.icon[theme]);
      assert.ok(inspected.width === 128 || inspected.width === 256);
    }
  }
  for (const replacement of [{ version: '9.0.0' }, { commit: '0'.repeat(40) }, { repository: 'untrusted/plugin' }, { manifest: { icon: { kind: 'package', light: 'https://attacker.invalid/a.png' } } }]) {
    assert.equal(resolveCatalogBrandIcon({ ...entry, ...replacement } as NetcattyPluginCatalogEntry), null);
  }
  const html = renderToStaticMarkup(<PluginBrandIcon entry={entry} />);
  assert.match(html, /data-plugin-brand="package"/);
  assert.match(html, /dark:hidden/);
  assert.match(html, /dark:block/);
  assert.doesNotMatch(html, /src="https?:/);
  assert.match(renderToStaticMarkup(<PluginBrandIcon />), /data-plugin-brand="fallback"/);
});
test('installed brand uses metadata only, rejects stale responses, and falls back after image errors', async () => {
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousAct = (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const requests: Array<(v: { light: string }) => void> = [];
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { netcatty: { getPluginBrandIcon: () => new Promise((resolve) => requests.push(resolve)) } } });
  const plugin = { id: 'com.netcatty.starter', enabled: false, activeVersion: '1.0.0', archiveSha256: 'a', runtime: {}, manifest: { icon: preview.icon } } as NetcattyInstalledPlugin;
  let renderer: ReactTestRenderer | undefined;
  try {
    await act(async () => { renderer = create(<PluginBrandIcon plugin={plugin} />); });
    assert.equal(requests.length, 1);
    await act(async () => { renderer!.update(<PluginBrandIcon plugin={{ ...plugin, archiveSha256: 'b' }} />); });
    await act(async () => requests[0]({ light: preview.light }));
    assert.equal(renderer!.root.findAllByType('img').length, 0);
    await act(async () => requests[1]({ light: preview.light }));
    assert.equal(renderer!.root.findAllByType('img').length, 1);
    await act(async () => renderer!.root.findByType('img').props.onError());
    assert.equal(renderer!.root.findAllByType('img').length, 0);
    await act(async () => { renderer!.update(<PluginBrandIcon />); });
    assert.equal(renderer!.root.findAllByType('img').length, 0);
  } finally {
    await act(async () => renderer?.unmount());
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow); else Reflect.deleteProperty(globalThis, 'window');
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = previousAct;
  }
});


test('disabled brand theme names cannot resolve Object prototype members', () => {
  for (const name of ['constructor', '__proto__', 'toString', 'valueOf', 'hasOwnProperty']) {
    const plugin = { id: 'com.test.theme', enabled: false, activeVersion: '1.0.0', runtime: {}, manifest: { icon: { kind: 'theme', name } } } as NetcattyInstalledPlugin;
    const html = renderToStaticMarkup(<PluginBrandIcon plugin={plugin} />);
    assert.match(html, /lucide-puzzle/);
    assert.doesNotMatch(html, /<img/);
  }
});

test('catalog brand icon fetches verified remote icons, caches per selectionToken, and falls back safely', async () => {
  clearCatalogBrandIconCacheForTests();
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousAct = (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const calls: Array<{ id: string; selectionToken?: string; sourceId?: string }> = [];
  const remoteLight = 'data:image/png;base64,iVBORw0KGgo=';
  const remoteDark = 'data:image/png;base64,iVBORw0KGgoAAA==';
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      netcatty: {
        getPluginCatalogBrandIcon: async (id: string, selectionToken?: string, sourceId?: string) => {
          calls.push({ id, selectionToken, sourceId });
          if (selectionToken === 'tok-unsafe') return { light: 'https://attacker.invalid/evil.png', dark: null };
          if (selectionToken === 'tok-empty') return { light: null, dark: null };
          return { light: remoteLight, dark: remoteDark };
        },
      },
    },
  });
  const unbundledEntry = {
    id: 'com.example.remote',
    version: '1.0.0',
    repository: 'example/remote',
    commit: '1'.repeat(40),
    selectionToken: 'tok-1',
    manifest: { icon: { kind: 'package', light: 'assets/light.png', dark: 'assets/dark.png' } },
  } as unknown as NetcattyPluginCatalogEntry;
  let renderer: ReactTestRenderer | undefined;
  try {
    await act(async () => { renderer = create(<PluginBrandIcon entry={unbundledEntry} sourceId="official" />); });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], { id: 'com.example.remote', selectionToken: 'tok-1', sourceId: 'official' });
    const imgs = renderer!.root.findAllByType('img');
    assert.equal(imgs.length, 2);
    assert.equal(imgs[0].props.src, remoteLight);
    assert.equal(imgs[1].props.src, remoteDark);

    // Remounting with the same selectionToken uses the in-memory cache without refetching.
    await act(async () => renderer!.unmount());
    await act(async () => { renderer = create(<PluginBrandIcon entry={unbundledEntry} sourceId="official" />); });
    assert.equal(calls.length, 1);
    assert.equal(renderer!.root.findAllByType('img').length, 2);

    // Unsafe URLs from bridge are rejected and fall back to default glyph.
    await act(async () => { renderer!.update(<PluginBrandIcon entry={{ ...unbundledEntry, selectionToken: 'tok-unsafe' }} sourceId="official" />); });
    assert.equal(calls.length, 2);
    assert.equal(renderer!.root.findAllByType('img').length, 0);

    // Bundled preview is used as fallback when remote delivery has no icons.
    await act(async () => { renderer!.update(<PluginBrandIcon entry={{ ...entry, selectionToken: 'tok-empty' }} sourceId="official" />); });
    assert.equal(calls.length, 3);
    const bundledImgs = renderer!.root.findAllByType('img');
    assert.equal(bundledImgs.length, 2);
    assert.equal(bundledImgs[0].props.src, preview.light);
    assert.equal(bundledImgs[1].props.src, preview.dark);
  } finally {
    await act(async () => renderer?.unmount());
    clearCatalogBrandIconCacheForTests();
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow); else Reflect.deleteProperty(globalThis, 'window');
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = previousAct;
  }
});
