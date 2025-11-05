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
  display_name: string
  lat: string
  lon: string
  boundingbox: string[]
  type: string
  class: string
}

export interface MapFilters {
  minArea: number
}

export interface Palette {
  waterFill: string
  waterStroke: string
  roadStroke: string
  roadBorderStroke: string
  buildingFill: string
  buildingStroke: string
  labelFill: string
  labelStroke: string
}
