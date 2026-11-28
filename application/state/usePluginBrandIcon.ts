import { useEffect, useState } from 'react';
import { netcattyBridge } from '../../infrastructure/services/netcattyBridge';

type Raster = { light: string; dark?: string };

const MAX_CATALOG_BRAND_ICON_CACHE = 256;
const SAFE_PNG_DATA_URI = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/;
const catalogBrandIconCache = new Map<string, Raster | null>();
const catalogBrandIconPending = new Map<string, Promise<Raster | null>>();

function normalizeCatalogBrandIcon(value: { light?: string | null; dark?: string | null } | null | undefined): Raster | null {
  if (!value || typeof value !== 'object') return null;
  const isSafe = (uri: unknown): uri is string =>
    typeof uri === 'string' && uri.length <= 700_000 && SAFE_PNG_DATA_URI.test(uri);
  const light = isSafe(value.light) ? value.light : null;
  const dark = isSafe(value.dark) ? value.dark : null;
  if (light) return dark ? { light, dark } : { light };
  if (dark) return { light: dark, dark };
  return null;
}

export function clearCatalogBrandIconCacheForTests(): void {
  catalogBrandIconCache.clear();
  catalogBrandIconPending.clear();
}

export function usePluginBrandIcon(plugin?: NetcattyInstalledPlugin): Raster | null {
  const pluginId = plugin?.id;
  const kind = plugin?.manifest?.icon?.kind;
  const key = JSON.stringify([pluginId, plugin?.activeVersion, plugin?.archiveSha256, plugin?.runtime?.quarantinedAt, plugin?.manifest?.icon]);
  const [loaded, setLoaded] = useState<{ key: string; value: Raster | null } | null>(null);
  useEffect(() => {
    if (!pluginId || kind !== 'package') return;
    let cancelled = false;
    void netcattyBridge.get()?.getPluginBrandIcon?.(pluginId).then((value) => {
      if (!cancelled) setLoaded({ key, value });
    }).catch(() => { if (!cancelled) setLoaded({ key, value: null }); });
    return () => { cancelled = true; };
  }, [key, pluginId, kind]);
  return loaded?.key === key ? loaded.value : null;
}

export function useCatalogBrandIcon(entry?: NetcattyPluginCatalogEntry, sourceId = 'official'): Raster | null {
  const entryId = entry?.id;
  const selectionToken = entry?.selectionToken;
  const iconKind = entry?.manifest?.icon?.kind;
  const cacheKey = entryId && selectionToken && iconKind !== 'theme'
    ? JSON.stringify([sourceId, entryId, selectionToken])
    : null;
  const cached = cacheKey && catalogBrandIconCache.has(cacheKey)
    ? catalogBrandIconCache.get(cacheKey) ?? null
    : undefined;
  const [loaded, setLoaded] = useState<{ key: string; value: Raster | null } | null>(null);

  useEffect(() => {
    if (!cacheKey || !entryId || !selectionToken) return;
    if (catalogBrandIconCache.has(cacheKey)) {
      setLoaded({ key: cacheKey, value: catalogBrandIconCache.get(cacheKey) ?? null });
      return;
    }
    const fetchIcon = netcattyBridge.get()?.getPluginCatalogBrandIcon;
    if (!fetchIcon) return;
    let cancelled = false;
    let request = catalogBrandIconPending.get(cacheKey);
    if (!request) {
      request = Promise.resolve(fetchIcon(entryId, selectionToken, sourceId))
        .then((raw) => {
          const normalized = normalizeCatalogBrandIcon(raw);
          if (catalogBrandIconCache.size >= MAX_CATALOG_BRAND_ICON_CACHE) {
            catalogBrandIconCache.clear();
          }
          catalogBrandIconCache.set(cacheKey, normalized);
          return normalized;
        })
        .finally(() => {
          if (catalogBrandIconPending.get(cacheKey) === request) {
            catalogBrandIconPending.delete(cacheKey);
          }
        });
      catalogBrandIconPending.set(cacheKey, request);
    }
    void request.then((value) => {
      if (!cancelled) setLoaded({ key: cacheKey, value });
    }).catch(() => {
      if (!cancelled) setLoaded({ key: cacheKey, value: null });
    });
    return () => { cancelled = true; };
  }, [cacheKey, entryId, selectionToken, sourceId]);

  if (!cacheKey) return null;
  if (cached !== undefined) return cached;
  return loaded?.key === cacheKey ? loaded.value : null;
}
