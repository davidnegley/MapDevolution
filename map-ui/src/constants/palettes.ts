import type { Palette } from '../types';

export const PRESET_PALETTES: Palette[] = [
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
];
