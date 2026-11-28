const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { PluginContributionIconService } = require('./contributionIconService.cjs');
async function fixture(t, rasterize) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'brand-icon-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.copyFile(path.join(__dirname, '../..', 'examples/plugins/starter-netcatty/assets/logo-light.png'), path.join(root, 'logo.png'));
  let plugin = { id: 'com.test.brand', activeVersion: '1.0.0', archiveSha256: 'a', enabled: false, runtime: {}, manifest: { icon: { kind: 'package', light: 'logo.png' } } };
  const service = new PluginContributionIconService({ database: { getActivePlugin: () => plugin }, packageStore: { preparePackageRoot: async () => root }, rasterizeIcon: rasterize ?? (async () => {
    const output = Buffer.alloc(24); Buffer.from([137,80,78,71,13,10,26,10]).copy(output); output.write('IHDR', 12); output.writeUInt32BE(32, 16); output.writeUInt32BE(32, 20); return output;
  }) });
  return { service, plugin, setPlugin: (value) => { plugin = value; } };
}
test('disabled installed branding is readable without runtime activation or changing contribution admission', async (t) => {
  const { service, plugin } = await fixture(t);
  assert.match((await service.resolveBrand(plugin.id)).light, /^data:image\/png;base64,/);
  await assert.rejects(service.resolve({ pluginId: plugin.id, icon: plugin.manifest.icon }), /not declared/);
  plugin.manifest.contributes = { views: [{ icon: plugin.manifest.icon }] };
  await assert.rejects(service.resolve({ pluginId: plugin.id, icon: plugin.manifest.icon }), /unavailable/);
  plugin.runtime.quarantinedAt = 1;
  assert.equal(await service.resolveBrand(plugin.id), null);
});
test('brand results cannot survive uninstall or a changed package hash during decoding', async (t) => {
  for (const change of ['uninstall', 'hash']) {
    let release; let entered;
    const started = new Promise((resolve) => { entered = resolve; });
    const gate = new Promise((resolve) => { release = resolve; });
    const f = await fixture(t, async () => { entered(); await gate; const b = Buffer.alloc(24); Buffer.from([137,80,78,71,13,10,26,10]).copy(b); b.write('IHDR',12); b.writeUInt32BE(32,16); b.writeUInt32BE(32,20); return b; });
    const pending = f.service.resolveBrand(f.plugin.id);
    await started;
    if (change === 'uninstall') f.setPlugin(null); else f.plugin.archiveSha256 = 'b';
    release();
    await assert.rejects(pending, /ownership changed/);
  }
});

test('catalog brand icon resolver verifies SHA-256/size/format, rasterizes, and caches', async () => {
  const { createHash } = require('node:crypto');
  const sourcePng = await fs.readFile(path.join(__dirname, '../..', 'examples/plugins/starter-netcatty/assets/logo-light.png'));
  const sha = createHash('sha256').update(sourcePng).digest('hex');
  const reference = { path: `/assets/${sha}.png`, sha256: sha, size: sourcePng.length };
  let rasterCalls = 0;
  let readCalls = 0;
  const service = new PluginContributionIconService({
    database: { getActivePlugin: () => null },
    packageStore: {},
    rasterizeIcon: async ({ body, maxEdge }) => {
      rasterCalls += 1;
      assert.equal(maxEdge, 128);
      return body;
    },
  });
  const req = {
    sourceId: 'official',
    reference,
    read: async () => { readCalls += 1; return sourcePng; },
  };
  const first = await service.resolveCatalogBrandIcon(req);
  assert.match(first, /^data:image\/png;base64,/);
  assert.equal(readCalls, 1);
  assert.equal(rasterCalls, 1);
  // Cached hit avoids re-reading and re-rasterizing.
  assert.equal(await service.resolveCatalogBrandIcon(req), first);
  assert.equal(readCalls, 1);
  assert.equal(rasterCalls, 1);
  // Tampered bytes reject.
  await assert.rejects(service.resolveCatalogBrandIcon({
    sourceId: 'official',
    reference: { ...reference, path: `/assets/${'b'.repeat(64)}.png`, sha256: 'b'.repeat(64) },
    read: async () => sourcePng,
  }), /Invalid plugin brand icon bytes/);
  // Extension/magic mismatch rejects.
  await assert.rejects(service.resolveCatalogBrandIcon({
    sourceId: 'official',
    reference: { ...reference, path: `/assets/${sha}.webp` },
    read: async () => sourcePng,
  }), /Brand icons require matching PNG or WebP|format/);
});
