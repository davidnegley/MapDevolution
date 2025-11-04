#!/bin/bash
# Download Natural Earth coastline data with better detail than current boundaries

# Natural Earth provides multiple resolution levels:
# 1:10m - High detail (10 million scale)
# 1:50m - Medium detail (50 million scale) - good for zoom 5-8
# 1:110m - Low detail (110 million scale) - good for zoom 0-4

echo "Downloading Natural Earth coastline data..."

# Create temp directory
TEMP_DIR="./temp-natural-earth"
mkdir -p "$TEMP_DIR"
cd "$TEMP_DIR"

# Download 1:50m scale (medium resolution) - best balance for your use case
echo "Downloading 1:50m scale countries with coastlines..."
curl -L -o ne_50m_admin_0_countries.zip \
  "https://naciscdn.org/naturalearth/50m/cultural/ne_50m_admin_0_countries.zip"

# Download 1:10m scale (high resolution) for comparison
echo "Downloading 1:10m scale countries with detailed coastlines..."
curl -L -o ne_10m_admin_0_countries.zip \
  "https://naciscdn.org/naturalearth/10m/cultural/ne_10m_admin_0_countries.zip"

# Unzip
echo "Extracting files..."
unzip -o ne_50m_admin_0_countries.zip
unzip -o ne_10m_admin_0_countries.zip

echo "Downloaded Natural Earth data to $TEMP_DIR"
echo ""
echo "Next steps:"
echo "1. Install ogr2ogr (part of GDAL): brew install gdal"
echo "2. Convert shapefiles to GeoJSON:"
echo "   ogr2ogr -f GeoJSON -t_srs EPSG:4326 ne_50m_countries.geojson ne_50m_admin_0_countries.shp"
echo "   ogr2ogr -f GeoJSON -t_srs EPSG:4326 ne_10m_countries.geojson ne_10m_admin_0_countries.shp"
echo "3. Simplify and convert to your format"
