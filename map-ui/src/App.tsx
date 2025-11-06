import { MapContainer, Marker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import './App.css';
import { useState, useEffect, useRef } from 'react';
import type { SearchResult, MapFilters, Palette } from './types';
import { CanvasRenderer } from './components/CanvasRenderer';
import { MapController } from './components/MapController';
import { PRESET_PALETTES } from './constants/palettes';

// Fix for default marker icon in React-Leaflet
import L from 'leaflet';
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';

const DefaultIcon = L.icon({
  iconUrl: icon,
  shadowUrl: iconShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41]
});

L.Marker.prototype.options.icon = DefaultIcon;


function App() {

  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState<SearchResult[]>([]);
  const [selectedPosition, setSelectedPosition] = useState<[number, number] | null>(() => {
    const saved = localStorage.getItem('lastPosition');
    if (saved) {
      const pos = JSON.parse(saved);
      // Validate position is reasonable (latitude between -90 and 90, longitude between -180 and 180)
      if (Array.isArray(pos) && pos.length === 2 &&
          pos[0] >= -90 && pos[0] <= 90 &&
          pos[1] >= -180 && pos[1] <= 180) {
        return pos as [number, number];
      }
    }
    return null;
  });
  const [selectedBounds, setSelectedBounds] = useState<[[number, number], [number, number]] | null>(() => {
    const saved = localStorage.getItem('lastBounds');
    if (saved) {
      console.log('Loading bounds from localStorage:', saved);
      const bounds = JSON.parse(saved);
      // Validate bounds format and values
      if (Array.isArray(bounds) && bounds.length === 2 &&
          Array.isArray(bounds[0]) && bounds[0].length === 2 &&
          Array.isArray(bounds[1]) && bounds[1].length === 2) {
        const [[south, west], [north, east]] = bounds;
        console.log('Parsed bounds:', { south, west, north, east });
        // Check if bounds are reasonable
        if (south >= -90 && south <= 90 && north >= -90 && north <= 90 &&
            west >= -180 && west <= 180 && east >= -180 && east <= 180 &&
            south < north && west < east) {
          console.log('Bounds are valid, using them');
          return bounds as [[number, number], [number, number]];
        }
        console.warn('Bounds failed validation');
      }
      // Invalid bounds, clear it
      console.log('Clearing invalid bounds from localStorage');
      localStorage.removeItem('lastBounds');
    }
    return null;
  });
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [filters, setFilters] = useState<MapFilters>(PRESET_PALETTES[0].filters);
  const [customPalettes, setCustomPalettes] = useState<Palette[]>([]);
  const [selectedPalette, setSelectedPalette] = useState<string>('Default');
  const [showLabels, setShowLabels] = useState<boolean>(() => {
    const saved = localStorage.getItem('showLabels');
    return saved ? JSON.parse(saved) : true;
  });
  const [nightMode, setNightMode] = useState<boolean>(() => {
    const saved = localStorage.getItem('nightMode');
    return saved ? JSON.parse(saved) : false;
  });
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load last search query on mount
  useEffect(() => {
    const savedQuery = localStorage.getItem('lastSearchQuery');
    if (savedQuery) {
      setSearchQuery(savedQuery);
    }
  }, []);

  useEffect(() => {
    if (searchQuery.length < 3) {
      setSuggestions([]);
      return;
    }

    // Debounce the search
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }

    debounceTimer.current = setTimeout(async () => {
      try {
        const response = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}&limit=5&dedupe=1`
        );
        const data = await response.json();
        // Remove duplicates based on display_name
        const uniqueResults = data.filter((result: SearchResult, index: number, self: SearchResult[]) =>
          index === self.findIndex((r) => r.display_name === result.display_name)
        );
        setSuggestions(uniqueResults);
        setShowSuggestions(true);
      } catch (error) {
        console.error('Error fetching suggestions:', error);
      }
    }, 300);

    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, [searchQuery]);

  const handleSelectAddress = (result: SearchResult) => {
    const lat = parseFloat(result.lat);
    const lon = parseFloat(result.lon);
    const position: [number, number] = [lat, lon];

    console.log('Selected address:', result.display_name, 'boundingbox:', result.boundingbox);

    // If result has a bounding box, use it to fit the view
    if (result.boundingbox && result.boundingbox.length === 4) {
      const [south, north, west, east] = result.boundingbox.map(parseFloat);
      console.log('Parsed bounds from API:', { south, north, west, east });
      const bounds: [[number, number], [number, number]] = [[south, west], [north, east]];
      console.log('Bounds to be saved:', bounds);

      const latSpan = north - south;
      const lonSpan = east - west;

      // For very large bounds (countries with remote territories), save the center point
      // for map view but keep the full bounds for data querying
      // Special handling: if lonSpan is very large but latSpan is moderate, this likely
      // indicates a country with remote islands (e.g., Chile with Easter Island)
      // In this case, use the Nominatim center point for the view
      const hasRemoteTerritory = (latSpan > 50 || lonSpan > 50) || (lonSpan > 30 && latSpan < 50);

      if (hasRemoteTerritory) {
        console.log('Large bounds detected - using center point for view, full bounds for data');
        setSelectedPosition(position); // Use Nominatim's center point for view
        setSelectedBounds(bounds);     // Keep full bounds for data queries

        // Save both to localStorage
        localStorage.setItem('lastPosition', JSON.stringify(position));
        localStorage.setItem('lastBounds', JSON.stringify(bounds));
      } else {
        // Normal sized bounds - use bounds for both view and data
        setSelectedBounds(bounds);
        setSelectedPosition(null);

        // Save bounds to localStorage
        localStorage.setItem('lastBounds', JSON.stringify(bounds));
        console.log('Saved to localStorage:', JSON.stringify(bounds));
        localStorage.removeItem('lastPosition');
      }
    } else {
      // No bounding box, just center on the point
      setSelectedPosition(position);
      setSelectedBounds(null);

      // Save position to localStorage
      localStorage.setItem('lastPosition', JSON.stringify(position));
      localStorage.removeItem('lastBounds'); // Remove bounds when using position
    }

    // Hide suggestions immediately
    setShowSuggestions(false);
    setSuggestions([]);

    // Remove comma after street number
    const cleanedAddress = result.display_name.replace(/^(\d+),\s*/, '$1 ');
    setSearchQuery(cleanedAddress);

    // Save query to localStorage
    localStorage.setItem('lastSearchQuery', cleanedAddress);
  };

  const allPalettes = [...PRESET_PALETTES, ...customPalettes];

  const handlePaletteChange = (paletteName: string) => {
    setSelectedPalette(paletteName);
    const palette = allPalettes.find(p => p.name === paletteName);
    if (palette) {
      setFilters(palette.filters);
    }
  };

  const handleSaveCustomPalette = () => {
    const name = prompt('Enter a name for this custom palette:');
    if (name && name.trim()) {
      const newPalette: Palette = {
        name: name.trim(),
        filters: { ...filters }
      };
      setCustomPalettes([...customPalettes, newPalette]);
      setSelectedPalette(newPalette.name);
    }
  };

  const handleFilterChange = (key: keyof MapFilters, value: number) => {
    setFilters({...filters, [key]: value});
    setSelectedPalette('Custom');
  };

  // Save preferences to localStorage
  useEffect(() => {
    localStorage.setItem('showLabels', JSON.stringify(showLabels));
  }, [showLabels]);

  useEffect(() => {
    localStorage.setItem('nightMode', JSON.stringify(nightMode));
  }, [nightMode]);

  const filterStyle = `brightness(${filters.brightness}%) contrast(${filters.contrast}%) saturate(${filters.saturation}%) hue-rotate(${filters.hueRotate}deg) grayscale(${filters.grayscale}%)`;

  // Theme colors
  const bgColor = nightMode ? '#1e1e1e' : '#ffffff';
  const textColor = nightMode ? '#e0e0e0' : '#000000';
  const borderColor = nightMode ? '#404040' : '#ccc';
  const hoverBg = nightMode ? '#2d2d2d' : '#f0f0f0';

  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex' }}>
      {/* Left Sidebar - Search Panel */}
      <div style={{
        width: '300px',
        height: '100%',
        backgroundColor: bgColor,
        borderRight: `1px solid ${borderColor}`,
        display: 'flex',
        flexDirection: 'column',
        zIndex: 1000
      }}>
        <div style={{ padding: '16px', borderBottom: `1px solid ${borderColor}` }}>
          <h2 style={{ margin: '0 0 12px 0', fontSize: '18px', color: textColor, fontWeight: 'bold' }}>Search Location</h2>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && suggestions.length > 0) {
                handleSelectAddress(suggestions[0]);
              }
            }}
            placeholder="Search for an address..."
            style={{
              width: '100%',
              padding: '10px',
              fontSize: '14px',
              border: `1px solid ${borderColor}`,
              borderRadius: '4px',
              backgroundColor: bgColor,
              color: textColor
            }}
          />
        </div>

        {showSuggestions && suggestions.length > 0 && (
          <div style={{
            maxHeight: '300px',
            overflowY: 'auto',
            borderBottom: `1px solid ${borderColor}`
          }}>
            {suggestions.map((result) => {
              const cleanedName = result.display_name.replace(/^(\d+),\s*/, '$1 ');
              return (
                <div
                  key={result.place_id}
                  onClick={() => handleSelectAddress(result)}
                  style={{
                    padding: '12px 16px',
                    cursor: 'pointer',
                    borderBottom: `1px solid ${borderColor}`,
                    color: textColor,
                    fontSize: '13px'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = hoverBg}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = bgColor}
                >
                  {cleanedName}
                </div>
              );
            })}
          </div>
        )}

        {/* Night Mode Toggle */}
        <div style={{ padding: '16px', marginTop: 'auto', borderTop: `1px solid ${borderColor}` }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: textColor }}>
            <input
              type="checkbox"
              checked={nightMode}
              onChange={(e) => setNightMode(e.target.checked)}
              style={{ cursor: 'pointer' }}
            />
            <span>Night Mode</span>
          </label>
        </div>
      </div>

      {/* Main Map Area */}
      <div style={{ flex: 1, height: '100%', position: 'relative', filter: filterStyle }}>
        <MapContainer
          center={selectedPosition || (selectedBounds ? [
            (selectedBounds[0][0] + selectedBounds[1][0]) / 2,
            (selectedBounds[0][1] + selectedBounds[1][1]) / 2
          ] : [37.8, -122.4])}
          zoom={selectedPosition ? 15 : (selectedBounds ? 10 : 12)}
          style={{ height: '100%', width: '100%', backgroundColor: '#70b8ff' }}
        >
          <MapController position={selectedPosition} zoom={15} bounds={selectedBounds} />
          <CanvasRenderer showLabels={showLabels} filters={filters} />
          {selectedPosition && (
            <Marker position={selectedPosition}>
              <Popup>
                {searchQuery}
              </Popup>
            </Marker>
          )}
        </MapContainer>
      </div>

      {/* Right Sidebar - Settings Panel */}
      <div style={{
        width: '300px',
        height: '100%',
        backgroundColor: bgColor,
        borderLeft: `1px solid ${borderColor}`,
        display: 'flex',
        flexDirection: 'column',
        overflowY: 'auto',
        zIndex: 1000
      }}>
        <div style={{ padding: '16px' }}>
          <div style={{ marginBottom: '16px' }}>
            <h2 style={{ margin: '0 0 12px 0', fontSize: '18px', color: textColor, fontWeight: 'bold' }}>Map Colors</h2>

            <div style={{ marginBottom: '12px' }}>
              <label style={{ color: textColor, fontSize: '12px', fontWeight: 'bold', marginBottom: '4px', display: 'block' }}>Palette</label>
              <select
                value={selectedPalette}
                onChange={(e) => handlePaletteChange(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px',
                  border: `1px solid ${borderColor}`,
                  borderRadius: '4px',
                  color: textColor,
                  backgroundColor: bgColor
                }}
              >
                <option value="Custom">Custom</option>
                {allPalettes.map(palette => (
                  <option key={palette.name} value={palette.name}>{palette.name}</option>
                ))}
              </select>
            </div>

            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: textColor }}>
                <input
                  type="checkbox"
                  checked={showLabels}
                  onChange={(e) => setShowLabels(e.target.checked)}
                  style={{ cursor: 'pointer' }}
                />
                <span style={{ fontSize: '12px' }}>Show Labels</span>
              </label>
            </div>

            <div style={{ marginBottom: '12px' }}>
              <label style={{ color: textColor, fontSize: '12px' }}>Brightness: {filters.brightness}%</label>
              <input
                type="range"
                min="0"
                max="200"
                value={filters.brightness}
                onChange={(e) => handleFilterChange('brightness', Number(e.target.value))}
                style={{ width: '100%' }}
              />
            </div>

            <div style={{ marginBottom: '12px' }}>
              <label style={{ color: textColor, fontSize: '12px' }}>Contrast: {filters.contrast}%</label>
              <input
                type="range"
                min="0"
                max="200"
                value={filters.contrast}
                onChange={(e) => handleFilterChange('contrast', Number(e.target.value))}
                style={{ width: '100%' }}
              />
            </div>

            <div style={{ marginBottom: '12px' }}>
              <label style={{ color: textColor, fontSize: '12px' }}>Saturation: {filters.saturation}%</label>
              <input
                type="range"
                min="0"
                max="200"
                value={filters.saturation}
                onChange={(e) => handleFilterChange('saturation', Number(e.target.value))}
                style={{ width: '100%' }}
              />
            </div>

            <div style={{ marginBottom: '12px' }}>
              <label style={{ color: textColor, fontSize: '12px' }}>Hue Rotate: {filters.hueRotate}°</label>
              <input
                type="range"
                min="0"
                max="360"
                value={filters.hueRotate}
                onChange={(e) => handleFilterChange('hueRotate', Number(e.target.value))}
                style={{ width: '100%' }}
              />
            </div>

            <div style={{ marginBottom: '12px' }}>
              <label style={{ color: textColor, fontSize: '12px' }}>Grayscale: {filters.grayscale}%</label>
              <input
                type="range"
                min="0"
                max="100"
                value={filters.grayscale}
                onChange={(e) => handleFilterChange('grayscale', Number(e.target.value))}
                style={{ width: '100%' }}
              />
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => handlePaletteChange('Default')}
                style={{
                  flex: 1,
                  padding: '10px',
                  backgroundColor: hoverBg,
                  border: `1px solid ${borderColor}`,
                  borderRadius: '4px',
                  cursor: 'pointer',
                  color: textColor,
                  fontSize: '13px'
                }}
              >
                Reset
              </button>
              <button
                onClick={handleSaveCustomPalette}
                style={{
                  flex: 1,
                  padding: '10px',
                  backgroundColor: '#4CAF50',
                  border: '1px solid #45a049',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  color: 'white',
                  fontWeight: 'bold',
                  fontSize: '13px'
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
