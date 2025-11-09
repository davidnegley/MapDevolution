export interface Geometry {
  coordinates: number[][] | number[][][]
}

export interface Road {
  type: string
  geometry: Geometry
}

export interface Building {
  geometry: {
    coordinates: number[][][]
  }
}

export interface Water {
  type: string
  geometry: Geometry
}

export interface Park {
  type: string
  name?: string
  geometry: {
    coordinates: number[][][] | number[][][][]
  }
}

export interface Label {
  lat: number
  lon: number
  name: string
}

export interface Boundary {
  type: string
  name?: string
  geometry: {
    coordinates: number[][][] | number[][][][]
  }
}

export interface MapData {
  roads: Road[]
  buildings: Building[]
  water: Water[]
  parks: Park[]
  labels: Label[]
  boundaries: Boundary[]
}

export interface SearchResult {
  place_id: number
  display_name: string
  lat: string
  lon: string
  boundingbox?: [string, string, string, string] // [south, north, west, east]
}

export interface MapFilters {
  brightness: number
  contrast: number
  saturation: number
  hueRotate: number
  grayscale: number
}

export interface Palette {
  name: string
  filters: MapFilters
}

export type FeatureState = 'enabled' | 'download-only' | 'disabled';

export interface FeatureControls {
  roads: FeatureState
  buildings: FeatureState
  water: FeatureState
  parks: FeatureState
  boundaries: FeatureState
  labels: FeatureState
}
