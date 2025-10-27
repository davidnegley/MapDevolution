import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import './App.css'
import { useState, useEffect, useRef } from 'react'

// Fix for default marker icon in React-Leaflet
import L from 'leaflet'
import icon from 'leaflet/dist/images/marker-icon.png'
import iconShadow from 'leaflet/dist/images/marker-shadow.png'

const DefaultIcon = L.icon({
  iconUrl: icon,
  shadowUrl: iconShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41]
})

L.Marker.prototype.options.icon = DefaultIcon

interface MapData {
  roads: any[]
  buildings: any[]
  labels: any[]
}

// IndexedDB cache for map data
const DB_NAME = 'MapCache'
const STORE_NAME = 'tiles'
const DB_VERSION = 1

const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'bbox' })
      }
    }
  })
}

const getCachedData = async (bbox: string): Promise<MapData | null> => {
  try {
    const db = await openDB()
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.get(bbox)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result?.data || null)
    })
  } catch (error) {
    console.error('Cache read error:', error)
    return null
  }
}

const setCachedData = async (bbox: string, data: MapData): Promise<void> => {
  try {
    const db = await openDB()
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.put({ bbox, data, timestamp: Date.now() })
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve()
    })
  } catch (error) {
    console.error('Cache write error:', error)
  }
}

// Custom Canvas Renderer Component
function CustomCanvasLayer({ map, mapData, showLabels, filters }: { map: L.Map, mapData: MapData, showLabels: boolean, filters: MapFilters }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    if (!map || !canvasRef.current) return

    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Create custom Leaflet layer
    const CanvasLayer = L.Layer.extend({
      onAdd: function(map: L.Map) {
        const size = map.getSize()
        canvas.width = size.x
        canvas.height = size.y
        canvas.style.position = 'absolute'
        canvas.style.top = '0'
        canvas.style.left = '0'
        canvas.style.pointerEvents = 'none'
        map.getPanes().overlayPane?.appendChild(canvas)

        map.on('move zoom viewreset', this._reset, this)
        this._reset()
      },

      onRemove: function(map: L.Map) {
        map.off('move zoom viewreset', this._reset, this)
        canvas.remove()
      },

      _reset: function() {
        const size = map.getSize()
        const topLeft = map.containerPointToLayerPoint([0, 0])

        canvas.width = size.x
        canvas.height = size.y
        canvas.style.transform = `translate(${topLeft.x}px, ${topLeft.y}px)`

        this._render()
      },

      _render: function() {
        ctx.clearRect(0, 0, canvas.width, canvas.height)

        // Render roads
        ctx.strokeStyle = '#888888'
        ctx.lineWidth = 2
        mapData.roads.forEach((road: any) => {
          if (road.geometry && road.geometry.coordinates) {
            ctx.beginPath()
            road.geometry.coordinates.forEach((coord: [number, number], i: number) => {
              const point = map.latLngToContainerPoint([coord[1], coord[0]])
              if (i === 0) ctx.moveTo(point.x, point.y)
              else ctx.lineTo(point.x, point.y)
            })
            ctx.stroke()
          }
        })

        // Render buildings
        ctx.fillStyle = '#cccccc'
        ctx.strokeStyle = '#999999'
        ctx.lineWidth = 1
        mapData.buildings.forEach((building: any) => {
          if (building.geometry && building.geometry.coordinates) {
            building.geometry.coordinates[0].forEach((ring: [number, number][]) => {
              ctx.beginPath()
              ring.forEach((coord: [number, number], i: number) => {
                const point = map.latLngToContainerPoint([coord[1], coord[0]])
                if (i === 0) ctx.moveTo(point.x, point.y)
                else ctx.lineTo(point.x, point.y)
              })
              ctx.closePath()
              ctx.fill()
              ctx.stroke()
            })
          }
        })

        // Render labels
        if (showLabels) {
          ctx.fillStyle = '#000000'
          ctx.font = '12px Arial'
          ctx.textAlign = 'center'
          mapData.labels.forEach((label: any) => {
            if (label.lat && label.lon && label.name) {
              const point = map.latLngToContainerPoint([label.lat, label.lon])
              ctx.fillText(label.name, point.x, point.y)
            }
          })
        }
      }
    })

    const layer = new CanvasLayer()
    layer.addTo(map)

    return () => {
      layer.remove()
    }
  }, [map, mapData, showLabels])

  return <canvas ref={canvasRef} style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }} />
}

function CanvasRenderer({ showLabels, filters }: { showLabels: boolean, filters: MapFilters }) {
  const map = useMap()
  const [mapData, setMapData] = useState<MapData>({ roads: [], buildings: [], labels: [] })
  const [isLoading, setIsLoading] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fetchTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    // Debounced fetch to avoid too many API calls during zoom/pan
    const fetchMapData = async () => {
      const bounds = map.getBounds()
      const bbox = `${bounds.getSouth()},${bounds.getWest()},${bounds.getNorth()},${bounds.getEast()}`

      // Check cache first
      const cached = await getCachedData(bbox)
      if (cached) {
        setMapData(cached)
        return
      }

      setIsLoading(true)

      try {
        const query = `
          [out:json];
          (
            way["highway"](${bbox});
            way["building"](${bbox});
            node["name"](${bbox});
          );
          out geom;
        `

        const response = await fetch('https://overpass-api.de/api/interpreter', {
          method: 'POST',
          body: `data=${encodeURIComponent(query)}`
        })

        const data = await response.json()

        const roads = data.elements.filter((el: any) => el.tags?.highway).map((el: any) => ({
          geometry: {
            coordinates: el.geometry?.map((pt: any) => [pt.lon, pt.lat])
          }
        }))

        const buildings = data.elements.filter((el: any) => el.tags?.building).map((el: any) => ({
          geometry: {
            coordinates: [[el.geometry?.map((pt: any) => [pt.lon, pt.lat])]]
          }
        }))

        const labels = data.elements.filter((el: any) => el.tags?.name).map((el: any) => ({
          lat: el.lat,
          lon: el.lon,
          name: el.tags.name
        }))

        const mapData = { roads, buildings, labels }
        setMapData(mapData)

        // Cache the result
        await setCachedData(bbox, mapData)
      } catch (error) {
        console.error('Error fetching map data:', error)
      } finally {
        setIsLoading(false)
      }
    }

    const debouncedFetch = () => {
      if (fetchTimeoutRef.current) {
        clearTimeout(fetchTimeoutRef.current)
      }
      fetchTimeoutRef.current = setTimeout(fetchMapData, 500)
    }

    map.on('moveend', debouncedFetch)
    fetchMapData()

    return () => {
      map.off('moveend', debouncedFetch)
      if (fetchTimeoutRef.current) {
        clearTimeout(fetchTimeoutRef.current)
      }
    }
  }, [map])

  // Render canvas layer
  useEffect(() => {
    if (!canvasRef.current || !map) return

    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const render = () => {
      const size = map.getSize()
      canvas.width = size.x
      canvas.height = size.y

      ctx.clearRect(0, 0, canvas.width, canvas.height)

      // White background
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      // Render roads
      ctx.strokeStyle = '#888888'
      ctx.lineWidth = 2
      mapData.roads.forEach((road: any) => {
        if (road.geometry && road.geometry.coordinates) {
          ctx.beginPath()
          road.geometry.coordinates.forEach((coord: [number, number], i: number) => {
            const point = map.latLngToContainerPoint([coord[1], coord[0]])
            if (i === 0) ctx.moveTo(point.x, point.y)
            else ctx.lineTo(point.x, point.y)
          })
          ctx.stroke()
        }
      })

      // Render buildings
      ctx.fillStyle = '#dddddd'
      ctx.strokeStyle = '#999999'
      ctx.lineWidth = 1
      mapData.buildings.forEach((building: any) => {
        if (building.geometry && building.geometry.coordinates && building.geometry.coordinates[0]) {
          const rings = Array.isArray(building.geometry.coordinates[0][0])
            ? building.geometry.coordinates[0]
            : [building.geometry.coordinates[0]]

          rings.forEach((ring: [number, number][]) => {
            if (ring && ring.length > 0) {
              ctx.beginPath()
              ring.forEach((coord: [number, number], i: number) => {
                if (coord && coord.length === 2) {
                  const point = map.latLngToContainerPoint([coord[1], coord[0]])
                  if (i === 0) ctx.moveTo(point.x, point.y)
                  else ctx.lineTo(point.x, point.y)
                }
              })
              ctx.closePath()
              ctx.fill()
              ctx.stroke()
            }
          })
        }
      })

      // Render labels with collision detection
      if (showLabels) {
        ctx.fillStyle = '#000000'
        ctx.font = '14px Arial'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'

        // Track occupied rectangles for collision detection
        const occupiedAreas: { x: number, y: number, width: number, height: number }[] = []

        const isOverlapping = (x: number, y: number, width: number, height: number) => {
          const padding = 5
          return occupiedAreas.some(rect =>
            x < rect.x + rect.width + padding &&
            x + width + padding > rect.x &&
            y < rect.y + rect.height + padding &&
            y + height + padding > rect.y
          )
        }

        mapData.labels.forEach((label: any) => {
          if (label.lat && label.lon && label.name) {
            const point = map.latLngToContainerPoint([label.lat, label.lon])
            const metrics = ctx.measureText(label.name)
            const width = metrics.width
            const height = 16
            const x = point.x - width / 2
            const y = point.y - height / 2

            if (!isOverlapping(x, y, width, height)) {
              // Draw white background for better readability
              ctx.fillStyle = 'rgba(255, 255, 255, 0.8)'
              ctx.fillRect(x - 2, y - 2, width + 4, height + 4)

              ctx.fillStyle = '#000000'
              ctx.fillText(label.name, point.x, point.y)

              occupiedAreas.push({ x, y, width, height })
            }
          }
        })
      }
    }

    const handleMapUpdate = () => {
      render()
    }

    map.on('move zoom viewreset', handleMapUpdate)
    render()

    return () => {
      map.off('move zoom viewreset', handleMapUpdate)
    }
  }, [map, mapData, showLabels])

  return (
    <>
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          zIndex: 400
        }}
      />
      {isLoading && (
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          backgroundColor: 'rgba(0, 0, 0, 0.7)',
          color: 'white',
          padding: '12px 24px',
          borderRadius: '8px',
          zIndex: 500,
          fontSize: '14px'
        }}>
          Loading map data...
        </div>
      )}
    </>
  )
}

interface SearchResult {
  place_id: number
  display_name: string
  lat: string
  lon: string
}

function MapController({ position, zoom }: { position: [number, number] | null, zoom: number }) {
  const map = useMap()

  useEffect(() => {
    if (position) {
      map.flyTo(position, zoom, { duration: 1.5 })
    }
  }, [position, zoom, map])

  return null
}

interface MapFilters {
  brightness: number
  contrast: number
  saturation: number
  hueRotate: number
  grayscale: number
}

interface Palette {
  name: string
  filters: MapFilters
}

const PRESET_PALETTES: Palette[] = [
  {
    name: 'Default',
    filters: { brightness: 100, contrast: 100, saturation: 100, hueRotate: 0, grayscale: 0 }
  },
  {
    name: 'Grayscale',
    filters: { brightness: 100, contrast: 100, saturation: 0, hueRotate: 0, grayscale: 100 }
  },
  {
    name: 'Sepia',
    filters: { brightness: 110, contrast: 90, saturation: 50, hueRotate: 20, grayscale: 40 }
  },
  {
    name: 'High Contrast',
    filters: { brightness: 105, contrast: 150, saturation: 120, hueRotate: 0, grayscale: 0 }
  },
  {
    name: 'Muted',
    filters: { brightness: 95, contrast: 85, saturation: 60, hueRotate: 0, grayscale: 20 }
  },
  {
    name: 'Vibrant',
    filters: { brightness: 110, contrast: 110, saturation: 150, hueRotate: 10, grayscale: 0 }
  },
  {
    name: 'Night Mode',
    filters: { brightness: 70, contrast: 120, saturation: 70, hueRotate: 200, grayscale: 0 }
  },
  {
    name: 'Warm',
    filters: { brightness: 105, contrast: 100, saturation: 110, hueRotate: 350, grayscale: 0 }
  },
  {
    name: 'Cool',
    filters: { brightness: 100, contrast: 100, saturation: 110, hueRotate: 180, grayscale: 0 }
  }
]

function App() {
  const [searchQuery, setSearchQuery] = useState('')
  const [suggestions, setSuggestions] = useState<SearchResult[]>([])
  const [selectedPosition, setSelectedPosition] = useState<[number, number] | null>(() => {
    const saved = localStorage.getItem('lastPosition')
    return saved ? JSON.parse(saved) : null
  })
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [showFilters, setShowFilters] = useState(false)
  const [filters, setFilters] = useState<MapFilters>(PRESET_PALETTES[0].filters)
  const [customPalettes, setCustomPalettes] = useState<Palette[]>([])
  const [selectedPalette, setSelectedPalette] = useState<string>('Default')
  const [showLabels, setShowLabels] = useState<boolean>(() => {
    const saved = localStorage.getItem('showLabels')
    return saved ? JSON.parse(saved) : true
  })
  const [useCustomRenderer, setUseCustomRenderer] = useState<boolean>(() => {
    const saved = localStorage.getItem('useCustomRenderer')
    return saved ? JSON.parse(saved) : false
  })
  const debounceTimer = useRef<NodeJS.Timeout | null>(null)

  // Load last search query on mount
  useEffect(() => {
    const savedQuery = localStorage.getItem('lastSearchQuery')
    if (savedQuery) {
      setSearchQuery(savedQuery)
    }
  }, [])

  useEffect(() => {
    if (searchQuery.length < 3) {
      setSuggestions([])
      return
    }

    // Debounce the search
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current)
    }

    debounceTimer.current = setTimeout(async () => {
      try {
        const response = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}&limit=5&dedupe=1`
        )
        const data = await response.json()
        // Remove duplicates based on display_name
        const uniqueResults = data.filter((result: SearchResult, index: number, self: SearchResult[]) =>
          index === self.findIndex((r) => r.display_name === result.display_name)
        )
        setSuggestions(uniqueResults)
        setShowSuggestions(true)
      } catch (error) {
        console.error('Error fetching suggestions:', error)
      }
    }, 300)

    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current)
      }
    }
  }, [searchQuery])

  const handleSelectAddress = (result: SearchResult) => {
    const lat = parseFloat(result.lat)
    const lon = parseFloat(result.lon)
    const position: [number, number] = [lat, lon]
    setSelectedPosition(position)
    // Remove comma after street number
    const cleanedAddress = result.display_name.replace(/^(\d+),\s*/, '$1 ')
    setSearchQuery(cleanedAddress)
    setSuggestions([])
    setShowSuggestions(false)

    // Save to localStorage
    localStorage.setItem('lastPosition', JSON.stringify(position))
    localStorage.setItem('lastSearchQuery', cleanedAddress)
  }

  const allPalettes = [...PRESET_PALETTES, ...customPalettes]

  const handlePaletteChange = (paletteName: string) => {
    setSelectedPalette(paletteName)
    const palette = allPalettes.find(p => p.name === paletteName)
    if (palette) {
      setFilters(palette.filters)
    }
  }

  const handleSaveCustomPalette = () => {
    const name = prompt('Enter a name for this custom palette:')
    if (name && name.trim()) {
      const newPalette: Palette = {
        name: name.trim(),
        filters: { ...filters }
      }
      setCustomPalettes([...customPalettes, newPalette])
      setSelectedPalette(newPalette.name)
    }
  }

  const handleFilterChange = (key: keyof MapFilters, value: number) => {
    setFilters({...filters, [key]: value})
    setSelectedPalette('Custom')
  }

  // Save preferences to localStorage
  useEffect(() => {
    localStorage.setItem('showLabels', JSON.stringify(showLabels))
  }, [showLabels])

  useEffect(() => {
    localStorage.setItem('useCustomRenderer', JSON.stringify(useCustomRenderer))
  }, [useCustomRenderer])

  const filterStyle = `brightness(${filters.brightness}%) contrast(${filters.contrast}%) saturate(${filters.saturation}%) hue-rotate(${filters.hueRotate}deg) grayscale(${filters.grayscale}%)`

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative' }}>
      <div style={{
        position: 'absolute',
        top: '20px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 1000,
        width: '90%',
        maxWidth: '500px'
      }}>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && suggestions.length > 0) {
              handleSelectAddress(suggestions[0])
            }
          }}
          placeholder="Search for an address..."
          style={{
            width: '100%',
            padding: '12px',
            fontSize: '16px',
            border: '2px solid #ccc',
            borderRadius: '8px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
          }}
        />
        {showSuggestions && suggestions.length > 0 && (
          <div style={{
            marginTop: '4px',
            backgroundColor: 'white',
            border: '1px solid #ccc',
            borderRadius: '8px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
            maxHeight: '300px',
            overflowY: 'auto'
          }}>
            {suggestions.map((result) => {
              // Remove comma after street number
              const cleanedName = result.display_name.replace(/^(\d+),\s*/, '$1 ')
              return (
                <div
                  key={result.place_id}
                  onClick={() => handleSelectAddress(result)}
                  style={{
                    padding: '12px',
                    cursor: 'pointer',
                    borderBottom: '1px solid #eee',
                    color: '#000'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f0f0f0'}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'white'}
                >
                  {cleanedName}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Color Filter Controls */}
      <div style={{
        position: 'absolute',
        top: '20px',
        right: '20px',
        zIndex: 1000,
        backgroundColor: 'white',
        borderRadius: '8px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
        padding: '12px',
        minWidth: '250px',
        pointerEvents: 'auto'
      }}>
        <div style={{ marginBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }} onClick={() => setShowFilters(!showFilters)}>
          <strong style={{ color: '#000' }}>Map Colors</strong>
          <span style={{ fontSize: '18px' }}>
            {showFilters ? '▼' : '▶'}
          </span>
        </div>
        {showFilters && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div>
              <label style={{ color: '#000', fontSize: '12px', fontWeight: 'bold', marginBottom: '4px', display: 'block' }}>Palette</label>
              <select
                value={selectedPalette}
                onChange={(e) => handlePaletteChange(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px',
                  border: '1px solid #ccc',
                  borderRadius: '4px',
                  color: '#000',
                  backgroundColor: 'white'
                }}
              >
                <option value="Custom">Custom</option>
                {allPalettes.map(palette => (
                  <option key={palette.name} value={palette.name}>{palette.name}</option>
                ))}
              </select>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input
                type="checkbox"
                id="showLabels"
                checked={showLabels}
                onChange={(e) => setShowLabels(e.target.checked)}
                style={{ cursor: 'pointer' }}
              />
              <label htmlFor="showLabels" style={{ color: '#000', fontSize: '12px', cursor: 'pointer' }}>
                Show Labels
              </label>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input
                type="checkbox"
                id="useCustomRenderer"
                checked={useCustomRenderer}
                onChange={(e) => setUseCustomRenderer(e.target.checked)}
                style={{ cursor: 'pointer' }}
              />
              <label htmlFor="useCustomRenderer" style={{ color: '#000', fontSize: '12px', cursor: 'pointer' }}>
                Custom Renderer (Beta)
              </label>
            </div>
            <div>
              <label style={{ color: '#000', fontSize: '12px' }}>Brightness: {filters.brightness}%</label>
              <input
                type="range"
                min="0"
                max="200"
                value={filters.brightness}
                onChange={(e) => handleFilterChange('brightness', Number(e.target.value))}
                style={{ width: '100%' }}
              />
            </div>
            <div>
              <label style={{ color: '#000', fontSize: '12px' }}>Contrast: {filters.contrast}%</label>
              <input
                type="range"
                min="0"
                max="200"
                value={filters.contrast}
                onChange={(e) => handleFilterChange('contrast', Number(e.target.value))}
                style={{ width: '100%' }}
              />
            </div>
            <div>
              <label style={{ color: '#000', fontSize: '12px' }}>Saturation: {filters.saturation}%</label>
              <input
                type="range"
                min="0"
                max="200"
                value={filters.saturation}
                onChange={(e) => handleFilterChange('saturation', Number(e.target.value))}
                style={{ width: '100%' }}
              />
            </div>
            <div>
              <label style={{ color: '#000', fontSize: '12px' }}>Hue Rotate: {filters.hueRotate}°</label>
              <input
                type="range"
                min="0"
                max="360"
                value={filters.hueRotate}
                onChange={(e) => handleFilterChange('hueRotate', Number(e.target.value))}
                style={{ width: '100%' }}
              />
            </div>
            <div>
              <label style={{ color: '#000', fontSize: '12px' }}>Grayscale: {filters.grayscale}%</label>
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
                  padding: '8px',
                  backgroundColor: '#f0f0f0',
                  border: '1px solid #ccc',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  color: '#000'
                }}
              >
                Reset
              </button>
              <button
                onClick={handleSaveCustomPalette}
                style={{
                  flex: 1,
                  padding: '8px',
                  backgroundColor: '#4CAF50',
                  border: '1px solid #45a049',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  color: 'white',
                  fontWeight: 'bold'
                }}
              >
                Save
              </button>
            </div>
          </div>
        )}
      </div>

      <div style={{ height: '100%', width: '100%', filter: filterStyle }}>
        <MapContainer
          center={selectedPosition || [37.8, -122.4]}
          zoom={selectedPosition ? 15 : 12}
          style={{ height: '100%', width: '100%' }}
        >
          <MapController position={selectedPosition} zoom={15} />
          {!useCustomRenderer && (
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url={showLabels
                ? "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                : "https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png"
              }
            />
          )}
          {useCustomRenderer && <CanvasRenderer showLabels={showLabels} filters={filters} />}
          {selectedPosition && (
            <Marker position={selectedPosition}>
              <Popup>
                {searchQuery}
              </Popup>
            </Marker>
          )}
        </MapContainer>
      </div>
    </div>
  )
}

export default App
