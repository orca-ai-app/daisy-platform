/**
 * TerritoryMap. Imperative Google Maps integration with marker clustering.
 *
 * Why imperative? With ~2,800 territory rows, rendering one React component
 * per pin causes a re-render storm on every state change (search, selection,
 * filter). Using google.maps.Marker directly + MarkerClusterer means the
 * heavy work is done by Google's native code, React only owns the surrounding
 * shell, and clusters aggregate distant pins so the on-screen marker count
 * stays small (typically <50 visible) at any zoom.
 *
 * The selected territory is panned-to via a separate effect and visually
 * indicated by the side panel — no per-marker selection ring, which would
 * defeat the clustering benefit.
 *
 * Reference: docs/M1-build-plan.md §6 Wave 3 Agent 3A.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { APIProvider, Map, useMap, useMapsLibrary } from '@vis.gl/react-google-maps';
import { MarkerClusterer } from '@googlemaps/markerclusterer';
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
  /** Marker click handler. Drives the side card / inspector panel. */
  onMarkerClick?: (territory: TerritoryMapItem) => void;
  /** id of the currently-selected territory; map pans to it when set. */
  selectedId?: string | null;
  className?: string;
}

// Vacant and reserved shifted to clearer yellow-orange and mid-blue —
// the previous amber + cyan read as "red" and "blue" on some screens
// (Jenni's feedback May 2026). Active stays green.
const STATUS_COLOURS: Record<TerritoryMapItem['status'], { fill: string; stroke: string }> = {
  active: { fill: '#67A671', stroke: '#3F7F4F' },
  vacant: { fill: '#F59E0B', stroke: '#B45309' },
  reserved: { fill: '#3B82F6', stroke: '#1E40AF' },
};

const UK_CENTRE = { lat: 54.5, lng: -2.5 };
const UK_DEFAULT_ZOOM = 6;

export function TerritoryMap({
  territories,
  onMarkerClick,
  selectedId,
  className,
}: TerritoryMapProps) {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;

  // Stable filtered list of geocoded items. The reference is stable across
  // renders unless lat/lng/status actually change for some row.
  const mappable = useMemo(
    () => territories.filter((t) => typeof t.lat === 'number' && typeof t.lng === 'number'),
    [territories],
  );
  const ungeocodedCount = territories.length - mappable.length;

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
            defaultCenter={UK_CENTRE}
            defaultZoom={UK_DEFAULT_ZOOM}
            gestureHandling="greedy"
            disableDefaultUI={false}
            clickableIcons={false}
            style={{ width: '100%', height: '100%' }}
          >
            <ClusteredMarkers territories={mappable} onMarkerClick={onMarkerClick} />
            <PanToSelection territories={mappable} selectedId={selectedId} />
            <FitBoundsOnce territories={mappable} />
          </Map>
        </APIProvider>
      </div>

      <MapLegend />

      {ungeocodedCount > 0 ? (
        <p className="text-daisy-muted text-xs">
          {ungeocodedCount.toLocaleString('en-GB')} territor
          {ungeocodedCount === 1 ? 'y' : 'ies'} not yet geocoded.
        </p>
      ) : null}
    </div>
  );
}

/**
 * Imperative marker + clusterer manager. Creates google.maps.Marker
 * instances for every territory and wraps them in a MarkerClusterer.
 * Re-runs only when the territories array reference changes (memoised
 * upstream).
 */
function ClusteredMarkers({
  territories,
  onMarkerClick,
}: {
  territories: TerritoryMapItem[];
  onMarkerClick?: (t: TerritoryMapItem) => void;
}) {
  const map = useMap();
  const markerLib = useMapsLibrary('marker');
  const clustererRef = useRef<MarkerClusterer | null>(null);
  // Stash the latest click handler in a ref so we don't have to rebuild
  // markers when the parent's callback identity changes.
  const onClickRef = useRef(onMarkerClick);
  onClickRef.current = onMarkerClick;

  useEffect(() => {
    if (!map || !markerLib) return;

    // Build markers imperatively. google.maps.Marker is lighter than
    // AdvancedMarkerElement and more than fast enough for this use case.
    const markers = territories.map((t) => {
      const colours = STATUS_COLOURS[t.status];
      const marker = new google.maps.Marker({
        position: { lat: t.lat as number, lng: t.lng as number },
        title: `${t.postcode_prefix} · ${t.name}`,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          fillColor: colours.fill,
          fillOpacity: 1,
          strokeColor: colours.stroke,
          strokeWeight: 1.5,
          scale: 6,
        },
      });
      marker.addListener('click', () => onClickRef.current?.(t));
      return marker;
    });

    const clusterer = new MarkerClusterer({ map, markers });
    clustererRef.current = clusterer;

    return () => {
      clusterer.clearMarkers();
      for (const m of markers) {
        m.setMap(null);
      }
      clustererRef.current = null;
    };
  }, [map, markerLib, territories]);

  return null;
}

/**
 * One-shot bounds fit on initial load. We deliberately don't refit on every
 * territories change — selection, search, and filter changes shouldn't
 * yank the map view around. The user can pan/zoom freely after the first
 * fit; explicit selection clicks pan to the chosen pin.
 */
function FitBoundsOnce({ territories }: { territories: TerritoryMapItem[] }) {
  const map = useMap();
  const coreLib = useMapsLibrary('core');
  const fittedRef = useRef(false);

  useEffect(() => {
    if (!map || !coreLib || fittedRef.current) return;
    if (territories.length === 0) return;

    if (territories.length < 5) {
      // Too few to make a useful bounds fit — keep the UK default view.
      fittedRef.current = true;
      return;
    }

    const bounds = new coreLib.LatLngBounds();
    for (const t of territories) {
      bounds.extend({ lat: t.lat as number, lng: t.lng as number });
    }
    map.fitBounds(bounds, 64);
    fittedRef.current = true;
  }, [map, coreLib, territories]);

  return null;
}

/**
 * Pans the map smoothly to the selected territory. Only adjusts zoom if
 * we're zoomed too far out to see individual pins.
 */
function PanToSelection({
  territories,
  selectedId,
}: {
  territories: TerritoryMapItem[];
  selectedId: string | null | undefined;
}) {
  const map = useMap();

  useEffect(() => {
    if (!map || !selectedId) return;
    const sel = territories.find((t) => t.id === selectedId);
    if (!sel || typeof sel.lat !== 'number' || typeof sel.lng !== 'number') return;
    const target = { lat: sel.lat, lng: sel.lng };
    const currentZoom = map.getZoom() ?? 0;
    if (currentZoom < 10) {
      // Smooth single transition: pan first, then zoom in once the pan
      // settles. Setting both simultaneously can feel jumpy.
      map.panTo(target);
      window.setTimeout(() => map.setZoom(11), 250);
    } else {
      map.panTo(target);
    }
  }, [map, territories, selectedId]);

  return null;
}

function MapLegend() {
  return (
    <div className="text-daisy-muted flex flex-col gap-1 text-xs">
      <LegendDot
        colour={STATUS_COLOURS.active.fill}
        label="Active"
        description="assigned to a franchisee"
      />
      <LegendDot
        colour={STATUS_COLOURS.vacant.fill}
        label="Vacant"
        description="open for recruitment"
      />
      <LegendDot
        colour={STATUS_COLOURS.reserved.fill}
        label="Reserved"
        description="held for a candidate in onboarding"
      />
    </div>
  );
}

function LegendDot({
  colour,
  label,
  description,
}: {
  colour: string;
  label: string;
  description: string;
}) {
  return (
    <span className="inline-flex items-center gap-2">
      <span
        aria-hidden
        className="inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full"
        style={{ background: colour }}
      />
      <span className="font-bold tracking-wide uppercase">{label}</span>
      <span className="font-semibold">{description}</span>
    </span>
  );
}

export type { TerritoryMapItem as TerritoryMapTerritory };

// ---------------------------------------------------------------------------
// useTerritoryMapSelection — convenience hook (unchanged from the previous
// implementation, kept for any consumers that import it).
// ---------------------------------------------------------------------------

export function useTerritoryMapSelection<T extends TerritoryMapItem>() {
  const [selected, setSelected] = useState<T | null>(null);
  return { selected, setSelected };
}
