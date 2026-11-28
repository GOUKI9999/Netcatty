import React, { useState } from 'react';
import { Package } from 'lucide-react';
import { useCatalogBrandIcon, usePluginBrandIcon } from '../../application/state/usePluginBrandIcon';
import { PluginContributionIcon } from './PluginContributionIcon';
import { resolveCatalogBrandIcon } from './catalogBrandIcons';

export function PluginBrandIcon({ plugin, entry, sourceId = 'official', size = 32, className = '' }: {
  plugin?: NetcattyInstalledPlugin;
  entry?: NetcattyPluginCatalogEntry;
  sourceId?: string;
  size?: number;
  className?: string;
}) {
  const manifest = plugin?.manifest ?? entry?.manifest;
  const icon = manifest?.icon;
  const key = JSON.stringify([plugin?.id, plugin?.activeVersion, plugin?.archiveSha256, plugin?.runtime?.quarantinedAt, icon]);
  const loaded = usePluginBrandIcon(plugin);
  const remoteCatalogIcon = useCatalogBrandIcon(plugin ? undefined : entry, sourceId);
  const bundledCatalogIcon = !plugin && entry ? resolveCatalogBrandIcon(entry) : null;
  const [failed, setFailed] = useState<string | null>(null);
  const remoteKey = JSON.stringify([key, entry?.id, entry?.selectionToken, sourceId, remoteCatalogIcon]);
  const raster = plugin
    ? loaded
    : (remoteCatalogIcon && failed !== remoteKey ? remoteCatalogIcon : bundledCatalogIcon);
  const imageKey = JSON.stringify([key, entry?.id, entry?.selectionToken, sourceId, raster]);
  if (icon?.kind === 'theme') return <PluginContributionIcon icon={icon} size={size} className={className} />;
  if (!raster || failed === imageKey) return <Package size={size} className={className} aria-hidden="true" data-plugin-brand="fallback" />;
  return <span className={`inline-flex shrink-0 ${className}`} style={{ width: size, height: size }} aria-hidden="true" data-plugin-brand="package">
    <img src={raster.light} alt="" width={size} height={size} className={raster.dark ? 'h-full w-full object-contain dark:hidden' : 'h-full w-full object-contain'} onError={() => setFailed(imageKey)} />
    {raster.dark && <img src={raster.dark} alt="" width={size} height={size} className="hidden h-full w-full object-contain dark:block" onError={() => setFailed(imageKey)} />}
  </span>;
}
