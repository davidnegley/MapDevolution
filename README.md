# Map Project

A styled map application with .NET backend and React/TypeScript frontend using OpenStreetMap.

## Setup

### Backend (.NET)
```bash
cd MapApi
dotnet run
```
Backend runs on `http://localhost:5000` (or `https://localhost:5001`)

### Frontend (React + Vite)
```bash
cd map-ui
npm install
npm run dev
```
Frontend runs on `http://localhost:5173`

**No API key required!** OpenStreetMap tiles are completely free.

## Tech Stack

- **Backend**: .NET 8 Web API
- **Frontend**: React 18 + TypeScript + Vite
- **Maps**: Leaflet + React-Leaflet
- **Map Data**: OpenStreetMap (free, no credit card)

## Features

- Interactive map with pan/zoom
- Click markers for popups
- Completely free - no API keys needed
- CORS configured for local development

## Map Customization

You can customize the map tiles by changing the TileLayer URL in `App.tsx`. Free alternatives:
- **OpenStreetMap**: `https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png`
- **OpenTopoMap**: `https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png`
- **CartoDB**: `https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png`
