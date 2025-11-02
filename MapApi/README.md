# MapApi

## Setup

### Country Boundaries Data

The `country-boundaries.json` file (292MB) is required but not included in git due to its size.

To download it:

```bash
cd MapApi
curl -s -X POST https://overpass-api.de/api/interpreter --data-urlencode 'data=[out:json][timeout:90];relation["boundary"="administrative"]["admin_level"="2"];out geom;' > country-boundaries.json
```

This downloads all country boundaries from OpenStreetMap via the Overpass API.

## Running the API

```bash
dotnet build
dotnet run
```

The API will be available at `http://localhost:5257`
