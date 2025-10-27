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

interface Geometry {
  coordinates: number[][] | number[][][]
}

interface Road {
  type: string
  geometry: Geometry
}

interface Building {
  geometry: {
    coordinates: number[][][]
  }
}

interface Water {
  type: string
  geometry: Geometry
}

interface Park {
  type: string
  name?: string
  geometry: {
    coordinates: number[][][] | number[][][][]
  }
}

interface Label {
  lat: number
  lon: number
  name: string
}

interface MapData {
  roads: Road[]
  buildings: Building[]
  water: Water[]
  parks: Park[]
  labels: Label[]
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
        mapData.roads.forEach((road: Road) => {
          if (road.geometry && road.geometry.coordinates) {
            ctx.beginPath()
            road.geometry.coordinates.forEach((coord: number[] | number[][], i: number) => {
              const c = coord as number[]
              const point = map.latLngToContainerPoint([c[1], c[0]])
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
        mapData.buildings.forEach((building: Building) => {
          if (building.geometry && building.geometry.coordinates) {
            building.geometry.coordinates[0].forEach((ring: number[][]) => {
              ctx.beginPath()
              ring.forEach((coord: number[], i: number) => {
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
          mapData.labels.forEach((label: Label) => {
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
  const [mapData, setMapData] = useState<MapData>({ roads: [], buildings: [], water: [], parks: [], labels: [] })
  const [isLoading, setIsLoading] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fetchTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const rateLimitedUntil = useRef<number>(0)
  const lastBboxRef = useRef<string>('')

  useEffect(() => {
    // Debounced fetch to avoid too many API calls during zoom/pan
    const fetchMapData = async () => {
      const bounds = map.getBounds()
      const bbox = `${bounds.getSouth()},${bounds.getWest()},${bounds.getNorth()},${bounds.getEast()}`

      // Calculate bbox dimensions and zoom level
      const south = bounds.getSouth()
      const west = bounds.getWest()
      const north = bounds.getNorth()
      const east = bounds.getEast()
      const latSpan = north - south
      const lonSpan = east - west

      // Skip relation queries when zoomed out too far (bbox > 1 degree)
      const skipRelations = latSpan > 1 || lonSpan > 1

      // Expand bbox slightly for relation queries (helps catch large areas)
      const latExpand = latSpan * 0.3
      const lonExpand = lonSpan * 0.3

      // Limit expanded bbox to max ~0.5 degrees (to avoid Overpass API rejecting query)
      const maxExpandLat = Math.min(latExpand, 0.5)
      const maxExpandLon = Math.min(lonExpand, 0.5)
      const expandedBbox = `${south - maxExpandLat},${west - maxExpandLon},${north + maxExpandLat},${east + maxExpandLon}`

      // Skip if same bbox
      if (bbox === lastBboxRef.current) {
        return
      }

      // Check if we're rate limited
      const now = Date.now()
      if (now < rateLimitedUntil.current) {
        console.warn(`Rate limited. Try again in ${Math.ceil((rateLimitedUntil.current - now) / 1000)}s`)
        return
      }

      // Check cache first
      const cached = await getCachedData(bbox)
      if (cached && cached.water && cached.parks) {
        setMapData(cached)
        lastBboxRef.current = bbox
        return
      }

      setIsLoading(true)

      try {
        const query = skipRelations ? `
          [out:json][timeout:25];
          (
            way["highway"](${bbox});
            way["building"](${bbox});
            way["waterway"](${bbox});
            way["natural"="water"](${bbox});
            way["leisure"="park"](${bbox});
            way["leisure"="nature_reserve"](${bbox});
            way["boundary"="national_park"](${bbox});
            way["boundary"="protected_area"](${bbox});
            way["landuse"="forest"](${bbox});
            way["landuse"="grass"](${bbox});
            way["landuse"="meadow"](${bbox});
            way["landuse"="wetland"](${bbox});
            way["natural"="wood"](${bbox});
            way["natural"="wetland"](${bbox});
            way["natural"="marsh"](${bbox});
            way["natural"="swamp"](${bbox});
            node["name"](${bbox});
          );
          out geom;
        ` : `
          [out:json][timeout:25];
          (
            way["highway"](${bbox});
            way["building"](${bbox});
            way["waterway"](${bbox});
            way["natural"="water"](${bbox});
            way["leisure"="park"](${bbox});
            way["leisure"="nature_reserve"](${bbox});
            way["boundary"="national_park"](${bbox});
            way["boundary"="protected_area"](${bbox});
            way["landuse"="forest"](${bbox});
            way["landuse"="grass"](${bbox});
            way["landuse"="meadow"](${bbox});
            way["landuse"="wetland"](${bbox});
            way["natural"="wood"](${bbox});
            way["natural"="wetland"](${bbox});
            way["natural"="marsh"](${bbox});
            way["natural"="swamp"](${bbox});
            node["name"](${bbox});
          );
          out geom;

          (
            rel(${expandedBbox})["natural"="water"];
            rel(${expandedBbox})["leisure"="nature_reserve"];
            rel(${expandedBbox})["boundary"="national_park"];
            rel(${expandedBbox})["boundary"="protected_area"];
            rel(${expandedBbox})["landuse"="wetland"];
            rel(${expandedBbox})["natural"="wetland"];
            rel(${expandedBbox})["natural"="marsh"];
            rel(${expandedBbox})["natural"="swamp"];
          );
          out geom(${bbox});
        `

        const response = await fetch('https://overpass-api.de/api/interpreter', {
          method: 'POST',
          body: `data=${encodeURIComponent(query)}`
        })

        // Handle rate limiting
        if (response.status === 429) {
          rateLimitedUntil.current = Date.now() + 120000 // Block for 120 seconds
          console.warn('Rate limited by Overpass API. Blocked for 120 seconds.')
          setIsLoading(false)
          return
        }

        // Handle gateway timeout - use cached data if available
        if (response.status === 504) {
          console.warn('Overpass API timeout. Using cached data if available.')
          setIsLoading(false)
          return
        }

        // Handle bad request (query too large) - use cached data if available
        if (response.status === 400) {
          console.warn('Overpass API rejected query (area too large). Using cached data if available.')
          setIsLoading(false)
          return
        }

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`)
        }

        interface OSMElement {
          type: string
          tags?: Record<string, string>
          geometry?: Array<{ lat: number, lon: number }>
          members?: Array<{
            role: string
            geometry?: Array<{ lat: number, lon: number }>
          }>
          lat?: number
          lon?: number
        }

        interface OSMResponse {
          elements: OSMElement[]
        }

        const data: OSMResponse = await response.json()

        const roads: Road[] = data.elements
          .filter((el): el is OSMElement & { tags: Record<string, string> } => !!el.tags?.highway && !!el.geometry)
          .map((el) => ({
            type: el.tags.highway,
            geometry: {
              coordinates: el.geometry?.filter(pt => pt && pt.lon != null && pt.lat != null).map(pt => [pt.lon, pt.lat]) || []
            }
          }))
          .filter(r => r.geometry.coordinates.length > 0)

        const buildings: Building[] = data.elements
          .filter((el) => el.tags?.building && el.geometry)
          .map((el) => ({
            geometry: {
              coordinates: [el.geometry?.filter(pt => pt && pt.lon != null && pt.lat != null).map(pt => [pt.lon, pt.lat]) || []]
            }
          }))
          .filter(b => b.geometry.coordinates[0].length > 0)

        const water: Water[] = data.elements
          .filter((el) => (el.tags?.waterway || el.tags?.natural === 'water') && (el.geometry || el.members))
          .map((el) => ({
            type: el.tags?.waterway || 'water',
            geometry: {
              coordinates: el.geometry?.filter(pt => pt && pt.lon != null && pt.lat != null).map(pt => [pt.lon, pt.lat]) ||
                          (el.members ? el.members.flatMap(m => m.geometry?.filter(pt => pt && pt.lon != null && pt.lat != null).map(pt => [pt.lon, pt.lat]) || []) : [])
            }
          }))
          .filter(w => w.geometry.coordinates.length > 0)

        const parks: Park[] = data.elements
          .filter((el) =>
            (el.tags?.leisure === 'park' ||
            el.tags?.leisure === 'nature_reserve' ||
            el.tags?.boundary === 'national_park' ||
            el.tags?.boundary === 'protected_area' ||
            el.tags?.landuse === 'forest' ||
            el.tags?.landuse === 'grass' ||
            el.tags?.landuse === 'meadow' ||
            el.tags?.landuse === 'wetland' ||
            el.tags?.natural === 'wood' ||
            el.tags?.natural === 'wetland' ||
            el.tags?.natural === 'marsh' ||
            el.tags?.natural === 'swamp') &&
            (el.geometry || el.members)
          )
          .map((el) => ({
            type: el.tags?.leisure || el.tags?.landuse || el.tags?.natural || el.tags?.boundary || 'park',
            name: el.tags?.name,
            geometry: {
              coordinates: el.type === 'relation' && el.members
                ? (() => {
                    // For multipolygon relations, concatenate all outer ways into one ring
                    const outerWays = el.members
                      .filter(m => m.role === 'outer' || m.role === '')
                      .map(m => m.geometry?.filter(pt => pt && pt.lon != null && pt.lat != null).map(pt => [pt.lon, pt.lat]) || [])
                      .filter(coords => coords.length > 0)

                    if (outerWays.length === 0) return []
                    if (outerWays.length === 1) return [outerWays[0]]

                    // Concatenate all outer ways into a single ring
                    const concatenated = outerWays.reduce((acc, way) => acc.concat(way), [])
                    return [concatenated]
                  })()
                : [[el.geometry?.filter(pt => pt && pt.lon != null && pt.lat != null).map(pt => [pt.lon, pt.lat]) || []]]
            }
          }))

        const filteredParks = parks.filter(p => p.geometry.coordinates.length > 0 && p.geometry.coordinates[0].length > 0)

        const labels: Label[] = data.elements
          .filter((el): el is OSMElement & { lat: number, lon: number, tags: Record<string, string> } =>
            !!el.tags?.name && typeof el.lat === 'number' && typeof el.lon === 'number'
          )
          .map((el) => ({
            lat: el.lat,
            lon: el.lon,
            name: el.tags.name
          }))

        const mapData = { roads, buildings, water, parks: filteredParks, labels }

        // Debug: log what we found
        if (parks.length > 0 || water.length > 0) {
          console.log('Features found:', {
            parks: parks.length,
            water: water.length,
            parkTypes: [...new Set(parks.map((p: Park) => p.type))],
            waterTypes: [...new Set(water.map((w: Water) => w.type))]
          })
        }

        setMapData(mapData)
        lastBboxRef.current = bbox

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
      fetchTimeoutRef.current = setTimeout(fetchMapData, 5000)  // Increased to 5s to avoid rate limiting
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

      // Light background
      ctx.fillStyle = '#f5f5f5'
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      // Separate parks into background (large protected areas) and foreground (detailed features)
      const backgroundParks = mapData.parks?.filter((p: Park) =>
        p.type === 'nature_reserve' || p.type === 'national_park' || p.type === 'protected_area'
      ) || []
      const foregroundParks = mapData.parks?.filter((p: Park) =>
        p.type !== 'nature_reserve' && p.type !== 'national_park' && p.type !== 'protected_area'
      ) || []

      // Render large background areas first (nature reserves, national parks)
      const renderPark = (park: Park) => {
        if (park.geometry && park.geometry.coordinates && park.geometry.coordinates.length > 0) {
          const type = park.type || 'park'
          switch(type) {
            case 'forest':
            case 'wood':
              ctx.fillStyle = '#8dc87f'  // Darker forest green
              break
            case 'wetland':
            case 'marsh':
            case 'swamp':
              ctx.fillStyle = '#8fbc8f'  // More visible wetland green (darker sea green)
              break
            case 'meadow':
              ctx.fillStyle = '#c8e6a0'  // Light meadow green
              break
            case 'nature_reserve':
            case 'national_park':
            case 'protected_area':
              ctx.fillStyle = '#e8f5e3'  // Very light green background for large protected areas
              break
            case 'grass':
              ctx.fillStyle = '#b8e6a1'  // Darker grass green
              break
            default:
              ctx.fillStyle = '#9cd68d'  // Darker default park green
          }
          ctx.strokeStyle = type === 'nature_reserve' || type === 'national_park' || type === 'protected_area'
            ? '#a8d5a0'  // Light border for background
            : '#6b9e5c'  // Darker border for foreground
          ctx.lineWidth = type === 'nature_reserve' || type === 'national_park' || type === 'protected_area' ? 2 : 1

          // Handle both simple polygons and complex multipolygons
          park.geometry.coordinates.forEach((coordSet: number[][] | number[][][]) => {
            const rings = Array.isArray(coordSet[0]?.[0]) ? (coordSet as number[][][]) : [coordSet as number[][]]

            rings.forEach((ring: number[][]) => {
              if (ring && ring.length > 0) {
                ctx.beginPath()
                let hasValidPoint = false
                ring.forEach((coord: number[], i: number) => {
                  if (coord && coord.length === 2 && !isNaN(coord[0]) && !isNaN(coord[1])) {
                    const point = map.latLngToContainerPoint([coord[1], coord[0]])
                    if (i === 0) {
                      ctx.moveTo(point.x, point.y)
                    } else {
                      ctx.lineTo(point.x, point.y)
                    }
                    hasValidPoint = true
                  }
                })
                if (hasValidPoint) {
                  ctx.closePath()
                  ctx.fill()
                  ctx.stroke()
                }
              }
            })
          })
        }
      }

      // Render background parks first
      backgroundParks.forEach(renderPark)

      // Render detailed foreground parks (wetlands, forests, etc.)
      foregroundParks.forEach(renderPark)

      // Render water bodies
      mapData.water?.forEach((water: Water) => {
        if (water.geometry && water.geometry.coordinates && water.geometry.coordinates.length > 0) {
          const type = water.type || 'water'

          if (type === 'river' || type === 'stream' || type === 'canal') {
            // Render as line (waterway)
            ctx.strokeStyle = '#70b8ff'  // Darker blue for visibility
            ctx.lineWidth = type === 'river' ? 3 : type === 'canal' ? 2 : 1.5
            ctx.beginPath()
            water.geometry.coordinates.forEach((coord: number[] | number[][], i: number) => {
              const c = coord as number[]
              if (c && c.length === 2) {
                const point = map.latLngToContainerPoint([c[1], c[0]])
                if (i === 0) ctx.moveTo(point.x, point.y)
                else ctx.lineTo(point.x, point.y)
              }
            })
            ctx.stroke()
          } else {
            // Render as polygon (lake, pond)
            ctx.fillStyle = '#70b8ff'  // Darker blue for visibility
            ctx.strokeStyle = '#5a9fd6'  // Darker border
            ctx.lineWidth = 0.5
            ctx.beginPath()
            water.geometry.coordinates.forEach((coord: number[] | number[][], i: number) => {
              const c = coord as number[]
              if (c && c.length === 2) {
                const point = map.latLngToContainerPoint([c[1], c[0]])
                if (i === 0) ctx.moveTo(point.x, point.y)
                else ctx.lineTo(point.x, point.y)
              }
            })
            ctx.closePath()
            ctx.fill()
            ctx.stroke()
          }
        }
      })

      // Render roads with different colors by type
      mapData.roads.forEach((road: Road) => {
        if (road.geometry && road.geometry.coordinates) {
          // Color roads by type (highway, residential, etc.)
          const type = road.type || 'default'
          switch(type) {
            case 'motorway':
              ctx.strokeStyle = '#e892a2'
              ctx.lineWidth = 4
              break
            case 'trunk':
              ctx.strokeStyle = '#f9b29c'
              ctx.lineWidth = 3
              break
            case 'primary':
              ctx.strokeStyle = '#fcd6a4'
              ctx.lineWidth = 3
              break
            case 'secondary':
              ctx.strokeStyle = '#f7fabf'
              ctx.lineWidth = 2.5
              break
            case 'residential':
              ctx.strokeStyle = '#ffffff'
              ctx.lineWidth = 2
              break
            default:
              ctx.strokeStyle = '#d4d4d4'
              ctx.lineWidth = 1.5
          }

          ctx.beginPath()
          road.geometry.coordinates.forEach((coord: number[] | number[][], i: number) => {
            const c = coord as number[]
            const point = map.latLngToContainerPoint([c[1], c[0]])
            if (i === 0) ctx.moveTo(point.x, point.y)
            else ctx.lineTo(point.x, point.y)
          })
          ctx.stroke()
        }
      })

      // Render buildings with subtle color variation
      ctx.lineWidth = 0.5
      const buildingColors = ['#e8e8e8', '#f0f0f0', '#e0e0e0', '#ececec', '#d8d8d8']

      mapData.buildings.forEach((building: Building, idx: number) => {
        if (building.geometry && building.geometry.coordinates && building.geometry.coordinates[0]) {
          // Use index to get consistent but varied colors
          ctx.fillStyle = buildingColors[idx % buildingColors.length]
          ctx.strokeStyle = '#c0c0c0'

          const firstCoord = building.geometry.coordinates[0]
          const rings: number[][][] = Array.isArray(firstCoord[0])
            ? (firstCoord as unknown as number[][][])
            : [firstCoord as unknown as number[][]]

          rings.forEach((ring: number[][]) => {
            if (ring && ring.length > 0) {
              ctx.beginPath()
              ring.forEach((coord: number[], i: number) => {
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

        mapData.labels.forEach((label: Label) => {
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
