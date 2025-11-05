import { useState, useEffect, useRef } from 'react'
import { useMap } from 'react-leaflet'
import L from 'leaflet'
import type { Road, Building, Water, Park, Label, Boundary, MapData, MapFilters } from '../types'
import { getCachedData, setCachedData } from '../services/cacheService'
import { simplifyGeometry } from '../utils/geometry'

interface CanvasRendererProps {
  showLabels: boolean
  filters: MapFilters
}

export function CanvasRenderer({ showLabels, filters: _filters }: CanvasRendererProps) {
  const map = useMap()
  const [mapData, setMapData] = useState<MapData>({ roads: [], buildings: [], water: [], parks: [], labels: [], boundaries: [] })
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    console.log('mapData updated:', {
      roads: mapData.roads.length,
      boundaries: mapData.boundaries.length,
      parks: mapData.parks.length,
      water: mapData.water.length
    })
  }, [mapData])
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fetchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rateLimitedUntil = useRef<number>(0)
  const lastBboxRef = useRef<string>('')
  const queryCounterRef = useRef<number>(0)

  useEffect(() => {
    // Debounced fetch to avoid too many API calls during zoom/pan
    const fetchMapData = async () => {
      const bounds = map.getBounds()

      // Normalize bounds to valid lat/lon ranges
      const south = Math.max(-90, Math.min(90, bounds.getSouth()))
      const north = Math.max(-90, Math.min(90, bounds.getNorth()))
      let west = bounds.getWest()
      let east = bounds.getEast()

      // Wrap longitude to -180..180 range
      while (west < -180) west += 360
      while (west > 180) west -= 360
      while (east < -180) east += 360
      while (east > 180) east -= 360

      // Fix negative longitude span (crossing dateline)
      let lonSpan = east - west
      if (lonSpan < 0) {
        lonSpan += 360  // Crossing dateline: -170 to 170 = 340° not -340°
      }

      // Skip if bbox is invalid (east < west but not crossing dateline properly)
      if (west > east && lonSpan > 180) {
        console.warn('Invalid bbox detected (likely world wrap issue):', { south, west, north, east, lonSpan })
        setIsLoading(false)
        return
      }

      // Handle dateline crossing: split into two bboxes
      const crossesDateline = west > east
      const bboxes = crossesDateline
        ? [`${south},${west},${north},180`, `${south},-180,${north},${east}`]
        : [`${south},${west},${north},${east}`]
      const bbox = bboxes[0] // For logging and single bbox operations

      // Increment query counter to track this specific query (do this early before any returns)
      queryCounterRef.current += 1
      const currentQueryId = queryCounterRef.current

      // If bbox spans more than 360 degrees (world wrap), fetch only country boundaries
      if (Math.abs(lonSpan) > 360) {
        // Check if we already fetched world boundaries
        if (lastBboxRef.current === 'world-wrap-boundaries') {
          console.log('World boundaries already fetched, skipping')
          return
        }

        console.warn('Bbox spans too wide (world wrap), fetching only country boundaries')

        // For very large areas, just fetch country boundaries
        try {
          interface OSMElement {
            type: string
            tags?: Record<string, string>
            geometry?: Array<{ lat: number, lon: number }>
            members?: Array<{
              role: string
              geometry?: Array<{ lat: number, lon: number }>
            }>
          }

          interface OSMResponse {
            elements: OSMElement[]
          }

          // For world-wrap views, only fetch boundaries (coastline query would be too large)
          const query = `
            [out:json][timeout:25];
            (
              relation["boundary"="administrative"]["admin_level"="2"];
            );
            out geom;
          `

          const response = await fetch('https://overpass-api.de/api/interpreter', {
            method: 'POST',
            body: `data=${encodeURIComponent(query)}`
          })

          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`)
          }

          const data: OSMResponse = await response.json()

          const boundaries: Boundary[] = data.elements
            .filter((el: OSMElement): el is OSMElement & { tags: Record<string, string> } =>
              !!el.tags?.boundary && el.tags.boundary === 'administrative' && el.tags?.admin_level === '2')
            .map((el: OSMElement & { tags: Record<string, string> }) => {
              // For relations with members, need to handle connected vs disconnected ways
              const coords = el.type === 'relation' && el.members
                ? (() => {
                    const outerWays = el.members
                      .filter((m: { role: string, geometry?: Array<{ lat: number, lon: number }> }) => m.role === 'outer' || m.role === '')
                      .map((m: { geometry?: Array<{ lat: number, lon: number }> }) =>
                        m.geometry?.filter((pt: { lat: number, lon: number }) => pt && pt.lon != null && pt.lat != null)
                          .map((pt: { lat: number, lon: number }) => [pt.lon, pt.lat]) || []
                      )
                      .filter((way: number[][]) => way.length > 0)

                    if (outerWays.length === 0) return []
                    if (outerWays.length === 1) return [outerWays[0]]

                    // Group connected ways together
                    const rings: number[][][] = []
                    const used = new Set<number>()

                    for (let i = 0; i < outerWays.length; i++) {
                      if (used.has(i)) continue

                      let currentRing = [...outerWays[i]]
                      used.add(i)

                      // Try to connect more ways to this ring
                      let foundConnection = true
                      while (foundConnection) {
                        foundConnection = false
                        const ringStart = currentRing[0]
                        const ringEnd = currentRing[currentRing.length - 1]

                        for (let j = 0; j < outerWays.length; j++) {
                          if (used.has(j)) continue

                          const way = outerWays[j]
                          const wayStart = way[0]
                          const wayEnd = way[way.length - 1]

                          // Check if this way connects to the end of current ring
                          if (Math.abs(ringEnd[0] - wayStart[0]) < 0.0001 && Math.abs(ringEnd[1] - wayStart[1]) < 0.0001) {
                            currentRing = [...currentRing.slice(0, -1), ...way]
                            used.add(j)
                            foundConnection = true
                            break
                          }
                          // Check if this way connects reversed
                          else if (Math.abs(ringEnd[0] - wayEnd[0]) < 0.0001 && Math.abs(ringEnd[1] - wayEnd[1]) < 0.0001) {
                            currentRing = [...currentRing.slice(0, -1), ...way.reverse()]
                            used.add(j)
                            foundConnection = true
                            break
                          }
                          // Check if this way connects to the start of current ring
                          else if (Math.abs(ringStart[0] - wayEnd[0]) < 0.0001 && Math.abs(ringStart[1] - wayEnd[1]) < 0.0001) {
                            currentRing = [...way.slice(0, -1), ...currentRing]
                            used.add(j)
                            foundConnection = true
                            break
                          }
                          // Check if this way connects to start reversed
                          else if (Math.abs(ringStart[0] - wayStart[0]) < 0.0001 && Math.abs(ringStart[1] - wayStart[1]) < 0.0001) {
                            currentRing = [...way.reverse().slice(0, -1), ...currentRing]
                            used.add(j)
                            foundConnection = true
                            break
                          }
                        }
                      }

                      rings.push(currentRing)
                    }

                    return rings
                  })()
                : [[el.geometry?.filter((pt: { lat: number, lon: number }) => pt && pt.lon != null && pt.lat != null)
                    .map((pt: { lat: number, lon: number }) => [pt.lon, pt.lat]) || []]]

              return {
                type: 'country',
                name: el.tags?.name,
                geometry: { coordinates: coords as unknown as number[][][] }
              }
            })
            .filter((b: Boundary) => b.geometry.coordinates.length > 0 && b.geometry.coordinates[0] && b.geometry.coordinates[0].length > 0)

          console.log('Fetched boundaries:', boundaries.length, 'Setting mapData')

          // Only update if this is still the most recent query
          if (currentQueryId === queryCounterRef.current) {
            setMapData({ roads: [], buildings: [], water: [], parks: [], labels: [], boundaries })
            console.log('setMapData called with', boundaries.length, 'boundaries')
            lastBboxRef.current = 'world-wrap-boundaries' // Mark as fetched to prevent refetch
          }
        } catch (error) {
          console.error('Error fetching boundaries:', error)
          // Don't clear existing data on error - keep what we have
        }
        return
      }

      const latSpan = north - south

      console.log('Map bounds:', { south, west, north, east, latSpan, lonSpan })

      // Use actual map zoom instead of calculated zoom
      // This ensures query decisions match what the user sees
      const actualZoom = map.getZoom()

      // Calculate zoom level from lat span (rough approximation) as fallback
      // At equator: zoom ~= log2(360 / latSpan)
      const approximateZoom = actualZoom || Math.log2(180 / latSpan)

      // If bbox is extremely large (> 200 degrees longitude OR > 60 degrees latitude),
      // use a minimal query with only country boundaries to avoid timeouts
      // Also use backend boundaries for low zoom (< 9) to get better coastline detail
      // Backend has pre-processed, detailed boundaries from Natural Earth data
      if (approximateZoom < 9 || lonSpan > 200 || latSpan > 60) {
        console.log('Using backend boundaries for better coastline detail:', { latSpan, lonSpan, zoom: approximateZoom })

        // Skip if we just did this query
        const cacheKey = `large-bbox-${Math.round(south)}-${Math.round(west)}-${Math.round(north)}-${Math.round(east)}`
        if (lastBboxRef.current === cacheKey) {
          console.log('Large area boundaries already fetched, skipping')
          setIsLoading(false)
          return
        }

        setIsLoading(true)

        try {
          // Fetch pre-processed country boundaries from backend API
          console.log('Fetching country boundaries from backend API...')

          const response = await fetch('http://localhost:5257/api/boundaries/countries')

          if (!response.ok) {
            console.warn('Backend API failed:', response.status, '- falling back to Overpass')
            setIsLoading(false)
            return
          }

          const boundaries: Boundary[] = await response.json()

          console.log('Loaded', boundaries.length, 'country boundaries from backend')

          // Only update if this is still the most recent query
          if (currentQueryId === queryCounterRef.current) {
            setMapData({ roads: [], buildings: [], water: [], parks: [], labels: [], boundaries })
            lastBboxRef.current = cacheKey
          }
          setIsLoading(false)
          return
        } catch (error) {
          console.error('Error fetching boundaries from backend:', error)
          setIsLoading(false)
          return
        }
      }

      // Skip relation queries when zoomed out too far (bbox > 1 degree)
      const skipRelations = latSpan > 1 || lonSpan > 1

      // Skip buildings when zoomed out beyond zoom 13
      const skipBuildings = approximateZoom < 13

      // Skip minor roads when zoomed out beyond zoom 11
      const skipMinorRoads = approximateZoom < 11

      // At very low zoom, only show major features (parks, water)
      const onlyMajorFeatures = approximateZoom < 9

      // Expand bbox slightly for relation queries (helps catch large areas)
      const latExpand = latSpan * 0.3
      const lonExpand = lonSpan * 0.3

      // Limit expanded bbox to max ~0.5 degrees (to avoid Overpass API rejecting query)
      const maxExpandLat = Math.min(latExpand, 0.5)
      const maxExpandLon = Math.min(lonExpand, 0.5)

      // For expanded bbox with dateline crossing, also split into two
      const expandedBboxes = crossesDateline
        ? [
            `${south - maxExpandLat},${west - maxExpandLon},${north + maxExpandLat},180`,
            `${south - maxExpandLat},-180,${north + maxExpandLat},${east + maxExpandLon}`
          ]
        : [`${south - maxExpandLat},${west - maxExpandLon},${north + maxExpandLat},${east + maxExpandLon}`]

      // Skip if same bbox
      if (bbox === lastBboxRef.current) {
        return
      }

      // Mark this bbox as being fetched to prevent overlapping queries
      lastBboxRef.current = bbox

      // Check if we're rate limited
      const now = Date.now()
      if (now < rateLimitedUntil.current) {
        console.warn(`Rate limited. Try again in ${Math.ceil((rateLimitedUntil.current - now) / 1000)}s`)
        return
      }

      // Check cache first (but skip cache for debugging boundary issues)
      const cached = await getCachedData(bbox)
      if (cached && approximateZoom >= 10) {  // Only use cache for high zoom levels
        const hasData = (cached.roads?.length || 0) > 0 ||
                        (cached.parks?.length || 0) > 0 ||
                        (cached.water?.length || 0) > 0

        console.log('Using cached data for bbox:', bbox, {
          roads: cached.roads?.length || 0,
          buildings: cached.buildings?.length || 0,
          parks: cached.parks?.length || 0,
          water: cached.water?.length || 0,
          hasData
        })

        // Only use cache if it has actual data (not empty from a failed fetch)
        if (hasData) {
          if (currentQueryId === queryCounterRef.current) {
            setMapData(cached)
          }
          return
        } else {
          console.log('Cached data is empty, fetching fresh data...')
        }
      } else if (cached) {
        console.log('Skipping cache for low zoom (< 10) to fetch boundaries')
      }

      console.log('Fetching map data for bbox:', bbox, 'zoom level:', approximateZoom.toFixed(1))

      setIsLoading(true)

      try {
        // Don't query boundaries/coastlines if bbox is too large (will timeout)
        // At very low zoom (< 6), allow very large bbox for country boundaries (up to 160°)
        // This handles countries with remote territories (e.g., Norway with Svalbard, France with overseas territories)
        // At low-medium zoom (6-8), allow medium bbox for state boundaries (up to 60°)
        // At higher zoom, be more conservative to avoid timeouts
        const bboxIsTooLarge = approximateZoom < 6
          ? (latSpan > 160 || lonSpan > 160)  // World/continent scale - allows countries with territories
          : approximateZoom < 9
          ? (latSpan > 60 || lonSpan > 60)    // Large region scale (e.g., Hawaii, Alaska)
          : (latSpan > 5 || lonSpan > 5)      // State/regional scale

        // Helper function to build query parts for a single bbox
        const buildQueryPartsForBbox = (singleBbox: string) => {
          const queryParts: string[] = []

          // At zoom < 11, fetch minimal data to keep query fast
          // At zoom >= 11, fetch all features for custom rendering
          if (approximateZoom < 11) {
            // Minimal query for low zoom
            // At zoom < 9, ONLY query boundaries - any way queries cause timeouts with boundary relations
            // At zoom 9-10, add roads and water features
            if (approximateZoom >= 9) {
              queryParts.push(`way["highway"~"motorway|trunk"](${singleBbox});`)
              queryParts.push(`way["waterway"](${singleBbox});`)
              queryParts.push(`way["natural"="water"](${singleBbox});`)
            }
            // Note: boundaries are added below outside this block
          } else {
            // Full query for high zoom - all features
            // Roads
            if (skipMinorRoads) {
              queryParts.push(`way["highway"~"motorway|trunk|primary|secondary"](${singleBbox});`)
            } else {
              queryParts.push(`way["highway"](${singleBbox});`)
            }

            // Buildings only at high zoom
            if (!skipBuildings) {
              queryParts.push(`way["building"](${singleBbox});`)
            }

            // Water features
            queryParts.push(`way["waterway"](${singleBbox});`)
            queryParts.push(`way["natural"="water"](${singleBbox});`)

            // Parks and natural features
            queryParts.push(`way["leisure"="park"](${singleBbox});`)
            queryParts.push(`way["leisure"="nature_reserve"](${singleBbox});`)
            queryParts.push(`way["boundary"="national_park"](${singleBbox});`)
            queryParts.push(`way["boundary"="protected_area"](${singleBbox});`)
            queryParts.push(`way["landuse"="forest"](${singleBbox});`)
            queryParts.push(`way["landuse"="grass"](${singleBbox});`)
            queryParts.push(`way["landuse"="meadow"](${singleBbox});`)
            queryParts.push(`way["landuse"="wetland"](${singleBbox});`)
            queryParts.push(`way["natural"="wood"](${singleBbox});`)
            queryParts.push(`way["natural"="wetland"](${singleBbox});`)
            queryParts.push(`way["natural"="marsh"](${singleBbox});`)
            queryParts.push(`way["natural"="swamp"](${singleBbox});`)

            // Labels
            queryParts.push(`node["name"](${singleBbox});`)
          }

          // Fetch coastlines at zoom 6+ for better detail, with very restrictive bbox limits
          // Coastline queries return massive datasets (100K+ elements), so limit carefully
          // At zoom 6-8: very small bbox only (< 5° lat, < 15° lon)
          // At zoom 9+: slightly larger bbox allowed
          if (approximateZoom >= 6 && approximateZoom < 9 && latSpan < 5 && lonSpan < 15) {
            queryParts.push(`way["natural"="coastline"](${singleBbox});`)
          } else if (approximateZoom >= 9 && latSpan < 10 && lonSpan < 30) {
            queryParts.push(`way["natural"="coastline"](${singleBbox});`)
          }

          // Country boundaries for continent-scale views (zoom < 6)
          // State/province boundaries for regional views (zoom 6-9)
          // Since we skip highways/waterways at low zoom, boundaries alone are fast even for large bbox
          if (approximateZoom < 6 && !bboxIsTooLarge) {
            // Admin level 2 = countries - works well even for large areas
            queryParts.push(`relation["boundary"="administrative"]["admin_level"="2"](${singleBbox});`)
          } else if (approximateZoom >= 6 && approximateZoom < 9 && !bboxIsTooLarge) {
            // Fetch state/province boundaries (admin_level 4 in US, sometimes 4-6 elsewhere)
            queryParts.push(`relation["boundary"="administrative"]["admin_level"~"4|5|6"](${singleBbox});`)
          }

          // For medium zoom (9-11), also fetch state/county boundaries to show land areas
          if (approximateZoom >= 9 && approximateZoom < 11 && !bboxIsTooLarge) {
            queryParts.push(`relation["boundary"="administrative"]["admin_level"~"4|5|6"](${singleBbox});`)
          }

          return queryParts
        }

        // Build query parts for all bboxes (handles dateline crossing)
        const allQueryParts = bboxes.flatMap(buildQueryPartsForBbox)

        if (bboxIsTooLarge) {
          console.log('Bbox too large for boundary/coastline queries:', { latSpan, lonSpan })
        }

        const wayQuery = allQueryParts.length > 0 ? allQueryParts.join('\n            ') : ''

        // Relation queries (for large protected areas) - skip at very low zoom
        // Generate relation queries for all expanded bboxes
        const relationQueryParts = !skipRelations && !onlyMajorFeatures
          ? expandedBboxes.flatMap(expBbox => [
              `rel(${expBbox})["natural"="water"];`,
              `rel(${expBbox})["leisure"="nature_reserve"];`,
              `rel(${expBbox})["boundary"="national_park"];`,
              `rel(${expBbox})["boundary"="protected_area"];`,
              `rel(${expBbox})["landuse"="wetland"];`,
              `rel(${expBbox})["natural"="wetland"];`,
              `rel(${expBbox})["natural"="marsh"];`,
              `rel(${expBbox})["natural"="swamp"];`
            ])
          : []

        const relationQuery = relationQueryParts.length > 0 ? `
          (
            ${relationQueryParts.join('\n            ')}
          );
          out geom(${bbox});
        ` : ''

        const query = `
          [out:json][timeout:25];
          (
            ${wayQuery}
          );
          out geom;
          ${relationQuery}
        `

        console.log('Query for zoom', approximateZoom.toFixed(1), 'Query parts:', allQueryParts.length)
        console.log('Full query:', query)

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

        console.log('Raw API response:', {
          totalElements: data.elements.length,
          elementTypes: [...new Set(data.elements.map(el => el.type))],
          adminLevels: [...new Set(data.elements.filter(el => el.tags?.admin_level).map(el => el.tags?.admin_level))],
          coastlines: data.elements.filter(el => el.tags?.natural === 'coastline').length
        })

        // Calculate simplification tolerance based on zoom level
        // Higher tolerance (more simplification) at lower zoom levels
        const simplificationTolerance = approximateZoom < 10 ? 0.001 : approximateZoom < 13 ? 0.0001 : 0

        const roads: Road[] = data.elements
          .filter((el): el is OSMElement & { tags: Record<string, string> } => !!el.tags?.highway && !!el.geometry)
          .map((el) => {
            const coords = el.geometry?.filter(pt => pt && pt.lon != null && pt.lat != null).map(pt => [pt.lon, pt.lat]) || []
            const simplified = simplificationTolerance > 0 && coords.length > 2
              ? simplifyGeometry(coords, simplificationTolerance)
              : coords
            return {
              type: el.tags.highway,
              geometry: {
                coordinates: simplified
              }
            }
          })
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
          .filter((el) => (el.tags?.waterway || el.tags?.natural === 'water' || el.tags?.natural === 'coastline') && (el.geometry || el.members))
          .map((el) => ({
            type: el.tags?.waterway || el.tags?.natural || 'water',
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

        // Parse boundaries (countries, states, provinces)
        const boundaries: Boundary[] = data.elements
          .filter((el) => el.tags?.boundary === 'administrative' &&
                         (el.tags?.admin_level === '2' || el.tags?.admin_level === '4' ||
                          el.tags?.admin_level === '5' || el.tags?.admin_level === '6'))
          .map((el) => {
            // For relations with members, need to handle connected vs disconnected ways
            const coords = el.type === 'relation' && el.members
              ? (() => {
                  const outerWays = el.members
                    .filter(m => m.role === 'outer' || m.role === '')
                    .map(m => m.geometry?.filter(pt => pt && pt.lon != null && pt.lat != null).map(pt => [pt.lon, pt.lat]) || [])
                    .filter((way: number[][]) => way.length > 0)

                  if (outerWays.length === 0) return []
                  if (outerWays.length === 1) return [outerWays[0]]

                  // Group connected ways together
                  const rings: number[][][] = []
                  const used = new Set<number>()

                  for (let i = 0; i < outerWays.length; i++) {
                    if (used.has(i)) continue

                    let currentRing = [...outerWays[i]]
                    used.add(i)

                    // Try to connect more ways to this ring
                    let foundConnection = true
                    while (foundConnection) {
                      foundConnection = false
                      const ringStart = currentRing[0]
                      const ringEnd = currentRing[currentRing.length - 1]

                      for (let j = 0; j < outerWays.length; j++) {
                        if (used.has(j)) continue

                        const way = outerWays[j]
                        const wayStart = way[0]
                        const wayEnd = way[way.length - 1]

                        // Check if this way connects to the end of current ring
                        if (Math.abs(ringEnd[0] - wayStart[0]) < 0.0001 && Math.abs(ringEnd[1] - wayStart[1]) < 0.0001) {
                          currentRing = [...currentRing.slice(0, -1), ...way]
                          used.add(j)
                          foundConnection = true
                          break
                        }
                        // Check if this way connects reversed
                        else if (Math.abs(ringEnd[0] - wayEnd[0]) < 0.0001 && Math.abs(ringEnd[1] - wayEnd[1]) < 0.0001) {
                          currentRing = [...currentRing.slice(0, -1), ...way.reverse()]
                          used.add(j)
                          foundConnection = true
                          break
                        }
                        // Check if this way connects to the start of current ring
                        else if (Math.abs(ringStart[0] - wayEnd[0]) < 0.0001 && Math.abs(ringStart[1] - wayEnd[1]) < 0.0001) {
                          currentRing = [...way.slice(0, -1), ...currentRing]
                          used.add(j)
                          foundConnection = true
                          break
                        }
                        // Check if this way connects to start reversed
                        else if (Math.abs(ringStart[0] - wayStart[0]) < 0.0001 && Math.abs(ringStart[1] - wayStart[1]) < 0.0001) {
                          currentRing = [...way.reverse().slice(0, -1), ...currentRing]
                          used.add(j)
                          foundConnection = true
                          break
                        }
                      }
                    }

                    rings.push(currentRing)
                  }

                  return rings
                })()
              : [[el.geometry?.filter(pt => pt && pt.lon != null && pt.lat != null).map(pt => [pt.lon, pt.lat]) || []]]

            return {
              type: el.tags?.admin_level === '2' ? 'country' : 'state',
              name: el.tags?.name,
              geometry: {
                coordinates: coords
              }
            }
          })
          .filter(b => b.geometry.coordinates.length > 0 && b.geometry.coordinates[0].length > 0)

        const mapData = { roads, buildings, water, parks: filteredParks, labels, boundaries }

        // Debug: log what we found
        console.log('Features found:', {
          roads: roads.length,
          buildings: buildings.length,
          parks: filteredParks.length,
          water: water.length,
          labels: labels.length,
          boundaries: boundaries.length,
          parkTypes: [...new Set(filteredParks.map((p: Park) => p.type))],
          waterTypes: [...new Set(water.map((w: Water) => w.type))]
        })

        // Only update state if this is still the most recent query
        if (currentQueryId === queryCounterRef.current) {
          setMapData(mapData)

          // Cache the result
          await setCachedData(bbox, mapData)
        } else {
          console.log('Ignoring stale query response for bbox:', bbox)
        }
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
    // Fetch immediately on first load (no debounce)
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

      const zoom = map.getZoom()
      const hasData = (mapData.roads?.length || 0) > 0 ||
                      (mapData.parks?.length || 0) > 0 ||
                      (mapData.water?.length || 0) > 0 ||
                      (mapData.boundaries?.length || 0) > 0

      // Determine background based on what data we have
      const hasCoastlines = mapData.water?.some((w: Water) => w.type === 'coastline') || false
      const hasBoundaries = (mapData.boundaries?.length || 0) > 0

      // Always paint background for artistic custom rendering
      if (zoom < 6) {
        // At very low zoom (continent/world scale), default to ocean blue
        // Boundaries will paint land on top
        ctx.fillStyle = '#70b8ff'  // Ocean blue (same as inland water)
      } else if (zoom < 9) {
        if (hasBoundaries || hasCoastlines) {
          ctx.fillStyle = '#70b8ff'  // Ocean blue (boundaries will show land)
        } else {
          ctx.fillStyle = '#f0ead6'  // Beige land color (no boundaries = probably inland)
        }
      } else {
        // At zoom 9+, check if we have coastlines (indicating islands/coastal areas)
        // If so, paint ocean blue background - land will be painted on top
        // Otherwise, paint white background - water features will paint blue on top
        if (hasCoastlines) {
          ctx.fillStyle = '#70b8ff'  // Ocean blue for islands/coastal areas
          console.log('Painting ocean blue background for coastlines at zoom:', zoom)
        } else {
          ctx.fillStyle = '#ffffff'  // White base for inland areas
          console.log('Painting white background at zoom:', zoom)
        }
      }

      console.log('Painting background with color:', ctx.fillStyle, 'at zoom:', zoom)
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      console.log('Rendering canvas:', {
        canvasSize: { width: canvas.width, height: canvas.height },
        zoom,
        hasData,
        dataLength: {
          roads: mapData.roads?.length || 0,
          parks: mapData.parks?.length || 0,
          water: mapData.water?.length || 0,
          boundaries: mapData.boundaries?.length || 0
        },
        willRenderBoundaries: zoom < 6 && mapData.boundaries && mapData.boundaries.length > 0,
        actualZoom: zoom,
        zoomCheck: zoom < 6,
        boundariesExist: !!mapData.boundaries,
        boundariesLength: mapData.boundaries?.length
      })

      // Render boundaries (countries at zoom < 6, states at zoom 6-11)
      if (zoom < 11 && mapData.boundaries && mapData.boundaries.length > 0) {
        // Fill boundaries to show land at zoom < 9
        // At zoom 9+, only stroke (outline) - don't fill, similar to OSM.org
        const shouldFillBoundaries = zoom < 9
        console.log('About to render', mapData.boundaries.length, 'boundaries', 'shouldFill:', shouldFillBoundaries, 'zoom:', zoom)

        if (shouldFillBoundaries) {
          ctx.fillStyle = '#f0ead6'  // Beige land color
        }
        ctx.strokeStyle = '#999999'  // Gray boundary
        ctx.lineWidth = zoom < 9 ? 2 : 1  // Thinner line at high zoom

        let boundariesRendered = 0
        mapData.boundaries.forEach((boundary: Boundary) => {
          boundariesRendered++
          if (boundariesRendered === 1) {
            console.log('First boundary to render:', boundary.name, 'coords:', boundary.geometry.coordinates.length)
          }
          if (boundary.geometry && boundary.geometry.coordinates) {
            // Start a single path for this entire boundary (all its rings)
            ctx.beginPath()

            // Each element in coordinates is a ring (array of [lon, lat] pairs)
            boundary.geometry.coordinates.forEach((ring: number[][] | number[][][]) => {
              const actualRing = ring as number[][]

              if (actualRing && actualRing.length > 2) {
                // Check for antimeridian crossing and split if needed
                const segments: number[][][] = []
                let currentSegment: number[][] = []

                for (let i = 0; i < actualRing.length; i++) {
                  const coord = actualRing[i]
                  if (!coord || coord.length !== 2 || isNaN(coord[0]) || isNaN(coord[1])) continue

                  if (i > 0) {
                    const prevCoord = actualRing[i - 1]
                    // Check for antimeridian crossing (longitude jump > 180 degrees)
                    if (Math.abs(coord[0] - prevCoord[0]) > 180) {
                      if (currentSegment.length > 0) {
                        segments.push(currentSegment)
                        currentSegment = []
                      }
                    }
                  }
                  currentSegment.push(coord)
                }

                if (currentSegment.length > 0) {
                  segments.push(currentSegment)
                }

                // Add each segment to the same path (for proper hole handling)
                segments.forEach((segment: number[][]) => {
                  if (segment.length > 2) {
                    let firstPoint: { coord: number[], point: L.Point, canvasSize: { width: number, height: number } } | null = null
                    segment.forEach((coord: number[], i: number) => {
                      const point = map.latLngToContainerPoint([coord[1], coord[0]])
                      if (i === 0) {
                        firstPoint = { coord, point, canvasSize: { width: canvas.width, height: canvas.height } }
                        ctx.moveTo(point.x, point.y)
                      } else {
                        ctx.lineTo(point.x, point.y)
                      }
                    })
                    ctx.closePath()

                    // Log first point of first segment for debugging
                    if (boundariesRendered === 1 && firstPoint) {
                      console.log('First boundary first point:', firstPoint)
                    }
                  }
                })
              }
            })

            // Fill and stroke the entire boundary at once (handles holes correctly with evenodd rule)
            if (shouldFillBoundaries) {
              ctx.fill('evenodd')
            }
            ctx.stroke()
          }
        })
      }

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

      // First, render land areas enclosed by coastlines (if at high zoom with ocean background)
      if (zoom >= 9 && hasCoastlines) {
        // Collect all coastline segments and fill enclosed areas with land color
        ctx.fillStyle = '#f0ead6'  // Beige land color
        ctx.strokeStyle = '#a0a0a0'  // Gray coastline border
        ctx.lineWidth = 1

        mapData.water?.forEach((water: Water) => {
          if (water.geometry && water.geometry.coordinates && water.geometry.coordinates.length > 0 && water.type === 'coastline') {
            // Render coastline as filled polygon (land) with stroked border
            ctx.beginPath()
            let firstPoint = true
            water.geometry.coordinates.forEach((coord: number[] | number[][]) => {
              const c = coord as number[]
              if (c && c.length === 2) {
                const point = map.latLngToContainerPoint([c[1], c[0]])
                if (firstPoint) {
                  ctx.moveTo(point.x, point.y)
                  firstPoint = false
                } else {
                  ctx.lineTo(point.x, point.y)
                }
              }
            })
            ctx.closePath()
            ctx.fill()
            ctx.stroke()
          }
        })
      }

      // Render water bodies
      mapData.water?.forEach((water: Water) => {
        if (water.geometry && water.geometry.coordinates && water.geometry.coordinates.length > 0) {
          const type = water.type || 'water'

          if (type === 'coastline') {
            // Coastlines already rendered above as land areas at high zoom
            // Skip individual coastline rendering here
          } else if (type === 'river' || type === 'stream' || type === 'canal') {
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
      // Increase line width at lower zoom levels for visibility
      const zoomMultiplier = zoom < 10 ? 2.5 : zoom < 12 ? 1.5 : 1

      let roadsRendered = 0
      mapData.roads.forEach((road: Road, idx: number) => {
        if (road.geometry && road.geometry.coordinates) {
          roadsRendered++
          if (idx === 0) {
            // Log first road for debugging
            console.log('First road:', {
              type: road.type,
              coordCount: road.geometry.coordinates.length,
              firstCoord: road.geometry.coordinates[0]
            })
          }
          // Color roads by type (highway, residential, etc.)
          const type = road.type || 'default'
          switch(type) {
            case 'motorway':
              ctx.strokeStyle = '#e892a2'
              ctx.lineWidth = 4 * zoomMultiplier
              break
            case 'trunk':
              ctx.strokeStyle = '#f9b29c'
              ctx.lineWidth = 3 * zoomMultiplier
              break
            case 'primary':
              ctx.strokeStyle = '#fcd6a4'
              ctx.lineWidth = 3 * zoomMultiplier
              break
            case 'secondary':
              ctx.strokeStyle = '#f7fabf'
              ctx.lineWidth = 2.5 * zoomMultiplier
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

      console.log('Roads rendered:', roadsRendered)

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
