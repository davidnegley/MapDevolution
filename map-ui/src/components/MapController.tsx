import { useEffect } from 'react';
import { useMap } from 'react-leaflet';

interface MapControllerProps {
  position: [number, number] | null
  zoom: number
  bounds?: [[number, number], [number, number]] | null
}

export function MapController({ position, zoom, bounds }: MapControllerProps) {
  const map = useMap();

  useEffect(() => {
    if (bounds) {
      // If we have bounds, fit to them instead of using position/zoom
      const [[south, west], [north, east]] = bounds;
      const latSpan = north - south;
      const lonSpan = east - west;

      console.log('Fitting bounds:', { bounds, latSpan, lonSpan });

      // For very large bounds (> 50° in BOTH dimensions), estimate mainland bounds to avoid remote territories
      // Only trim if both lat AND lon are large (e.g., France with overseas territories, Norway with Svalbard)
      // Don't trim elongated countries like Chile (large lat span but small lon span)
      let boundsToFit = bounds;
      let adjustedLatSpan = latSpan;
      let adjustedLonSpan = lonSpan;

      if (latSpan > 50 && lonSpan > 50) {
        // Exclude extreme 20% on each end to focus on mainland
        const latPadding = latSpan * 0.2;
        const lonPadding = lonSpan * 0.2;
        boundsToFit = [
          [south + latPadding, west + lonPadding],
          [north - latPadding, east - lonPadding]
        ];
        // Recalculate spans for the trimmed bounds
        adjustedLatSpan = latSpan * 0.6;  // 60% of original (removed 20% from each end)
        adjustedLonSpan = lonSpan * 0.6;
        console.log('Large bounds detected - using estimated mainland bounds', {
          originalLatSpan: latSpan,
          adjustedLatSpan,
          originalLonSpan: lonSpan,
          adjustedLonSpan
        });
      }

      // For large adjusted bounds, use fixed zoom level
      // Leaflet's fitBounds doesn't support minZoom, may zoom out too far (zoom 3 shows whole world)
      if (adjustedLatSpan > 15) {
        // Very large region - use zoom 5 which shows ~22° viewport
        // This is a good compromise: shows significant portion while keeping queries fast
        const fixedZoom = 5;

        console.log('Large region - using fixed zoom 5:', {
          adjustedLatSpan,
          adjustedLonSpan,
          zoom: fixedZoom
        });

        // Use position from geocoding if available (proper country center)
        // Otherwise calculate center from trimmed bounds
        let centerLat, centerLon;
        if (position) {
          [centerLat, centerLon] = position;
          console.log('Using geocoding center point:', { lat: centerLat, lon: centerLon });
        } else {
          centerLat = boundsToFit[0][0] + (boundsToFit[1][0] - boundsToFit[0][0]) / 2;
          centerLon = boundsToFit[0][1] + (boundsToFit[1][1] - boundsToFit[0][1]) / 2;
          console.log('Using calculated center from bounds:', { lat: centerLat, lon: centerLon });
        }
        map.setView([centerLat, centerLon], fixedZoom, { animate: true });
      } else {
        // Small enough region - use fitBounds
        console.log('Using fitBounds for region:', { adjustedLatSpan, adjustedLonSpan });
        map.fitBounds(boundsToFit, {
          padding: [50, 50],
          animate: true,
          duration: 1.5,
          maxZoom: 15
        });
      }

      // Log the actual zoom level after fitting
      setTimeout(() => {
        console.log('Zoom level after fitBounds:', map.getZoom());
      }, 100);
    } else if (position) {
      map.flyTo(position, zoom, { duration: 1.5 });
    }
  }, [position, zoom, bounds, map]);

  return null;
}
