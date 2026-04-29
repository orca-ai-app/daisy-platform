/**
 * TerritoryMap. Wave 3A wires Google Maps via @vis.gl/react-google-maps
 * with VITE_GOOGLE_MAPS_API_KEY. Status-coloured markers, click → callback,
 * graceful fallback when the key is missing or coordinates are unset.
 *
 * Reference: docs/M1-build-plan.md §6 Wave 3 Agent 3A,
 *            daisy-flow/03-hq-dashboard.html for visual style.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  AdvancedMarker,
  APIProvider,
  Map,
  Pin,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import { EmptyState } from './EmptyState';

export interface TerritoryMapItem {
  id: string;
  lat: number | null;
  lng: number | null;
  status: 'active' | 'vacant' | 'reserved';
  postcode_prefix: string;
  name: string;
  franchisee_name?: string | null;
}

interface TerritoryMapProps {
  territories: TerritoryMapItem[];
  /** Marker click handler. The parent typically uses this to drive
   *  a side card or info panel. */
  onMarkerClick?: (territory: TerritoryMapItem) => void;
  /** id of the currently-selected territory; rendered with an accent ring. */
  selectedId?: string | null;
  className?: string;
}

const STATUS_COLOURS: Record<TerritoryMapItem['status'], { bg: string; border: string }> = {
  active: { bg: '#67A671', border: '#3F7F4F' },
  vacant: { bg: '#FCAF17', border: '#B97C0E' },
  reserved: { bg: '#3AC1EA', border: '#1D88A8' },
};

const UK_CENTRE = { lat: 54.5, lng: -2.5 };
const UK_DEFAULT_ZOOM = 6;

// Map ID is required by @vis.gl/react-google-maps to render AdvancedMarker.
// Using a generated literal keeps things working without a Cloud-side
// styled map; Daisy can register a real Map ID later for branded styles.
const DAISY_MAP_ID = 'daisy-territory-map';

/**
 * Side-effect component that fits the map bounds to the supplied territories.
 * Re-runs whenever the territory list changes.
 */
function FitBounds({ territories }: { territories: TerritoryMapItem[] }) {
  const map = useMap();
  const coreLib = useMapsLibrary('core');

  useEffect(() => {
    if (!map || !coreLib) return;
    const withCoords = territories.filter(
      (t) => typeof t.lat === 'number' && typeof t.lng === 'number',
    );
    if (withCoords.length === 0) {
      map.setCenter(UK_CENTRE);
      map.setZoom(UK_DEFAULT_ZOOM);
      return;
    }
    if (withCoords.length === 1) {
      map.setCenter({ lat: withCoords[0].lat as number, lng: withCoords[0].lng as number });
      map.setZoom(11);
      return;
    }
    const bounds = new coreLib.LatLngBounds();
    for (const t of withCoords) {
      bounds.extend({ lat: t.lat as number, lng: t.lng as number });
    }
    map.fitBounds(bounds, 64);
  }, [map, coreLib, territories]);

  return null;
}

export function TerritoryMap({
  territories,
  onMarkerClick,
  selectedId,
  className,
}: TerritoryMapProps) {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;

  const { mappable, ungeocodedCount } = useMemo(() => {
    let unmapped = 0;
    const ok: TerritoryMapItem[] = [];
    for (const t of territories) {
      if (typeof t.lat === 'number' && typeof t.lng === 'number') {
        ok.push(t);
      } else {
        unmapped += 1;
      }
    }
    return { mappable: ok, ungeocodedCount: unmapped };
  }, [territories]);

  if (!apiKey || apiKey.trim().length === 0) {
    return (
      <div className={className} data-daisy="TerritoryMap">
        <EmptyState
          title="Map unavailable"
          body="Set VITE_GOOGLE_MAPS_API_KEY in your environment to enable the territory map."
        />
      </div>
    );
  }

  return (
    <div className={className ?? 'flex flex-col gap-2'} data-daisy="TerritoryMap">
      <div className="border-daisy-line-soft shadow-card h-[520px] overflow-hidden rounded-[12px] border">
        <APIProvider apiKey={apiKey}>
          <Map
            mapId={DAISY_MAP_ID}
            defaultCenter={UK_CENTRE}
            defaultZoom={UK_DEFAULT_ZOOM}
            gestureHandling="greedy"
            disableDefaultUI={false}
            clickableIcons={false}
            style={{ width: '100%', height: '100%' }}
          >
            <FitBounds territories={mappable} />
            {mappable.map((t) => {
              const colours = STATUS_COLOURS[t.status];
              const isSelected = selectedId === t.id;
              return (
                <AdvancedMarker
                  key={t.id}
                  position={{ lat: t.lat as number, lng: t.lng as number }}
                  title={`${t.postcode_prefix} — ${t.name}`}
                  onClick={() => onMarkerClick?.(t)}
                >
                  <Pin
                    background={colours.bg}
                    borderColor={isSelected ? '#006FAC' : colours.border}
                    glyphColor={'#FFFFFF'}
                    scale={isSelected ? 1.25 : 1}
                  />
                </AdvancedMarker>
              );
            })}
          </Map>
        </APIProvider>
      </div>

      <MapLegend />

      {ungeocodedCount > 0 ? (
        <p className="text-daisy-muted text-xs">
          {ungeocodedCount} territor{ungeocodedCount === 1 ? 'y' : 'ies'} not yet geocoded — use the
          geocode-postcode helper to populate lat/lng.
        </p>
      ) : null}
    </div>
  );
}

function MapLegend() {
  return (
    <div className="text-daisy-muted flex flex-wrap items-center gap-4 text-xs font-semibold">
      <LegendDot colour={STATUS_COLOURS.active.bg} label="Active" />
      <LegendDot colour={STATUS_COLOURS.vacant.bg} label="Vacant" />
      <LegendDot colour={STATUS_COLOURS.reserved.bg} label="Reserved" />
    </div>
  );
}

function LegendDot({ colour, label }: { colour: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden
        className="inline-block h-2.5 w-2.5 rounded-full"
        style={{ background: colour }}
      />
      <span className="tracking-wide uppercase">{label}</span>
    </span>
  );
}

// Re-export the selection helper for callers that need to track state
// without redeclaring the type.
export type { TerritoryMapItem as TerritoryMapTerritory };

// ---------------------------------------------------------------------------
// useTerritoryMapSelection — tiny convenience hook for a parent that wants
// "selected territory" state without rolling its own useState.
// ---------------------------------------------------------------------------

export function useTerritoryMapSelection<T extends TerritoryMapItem>() {
  const [selected, setSelected] = useState<T | null>(null);
  return { selected, setSelected };
}
