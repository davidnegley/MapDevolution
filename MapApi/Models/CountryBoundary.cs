namespace MapApi.Models
{
    public class CountryBoundary
    {
        public string Type { get; set; } = "country";
        public string? Name { get; set; }
        public GeometryData Geometry { get; set; } = new GeometryData();
    }

    public class GeometryData
    {
        public double[][][] Coordinates { get; set; } = new double[0][][];
    }

    public class OsmResponse
    {
        public double Version { get; set; }
        public string Generator { get; set; } = string.Empty;
        public List<OsmElement> Elements { get; set; } = new List<OsmElement>();
    }

    public class OsmElement
    {
        public string Type { get; set; } = string.Empty;
        public long Id { get; set; }
        public Dictionary<string, string>? Tags { get; set; }
        public List<OsmMember>? Members { get; set; }
        public List<OsmPoint>? Geometry { get; set; }
    }

    public class OsmMember
    {
        public string Type { get; set; } = string.Empty;
        public long Ref { get; set; }
        public string Role { get; set; } = string.Empty;
        public List<OsmPoint>? Geometry { get; set; }
    }

    public class OsmPoint
    {
        public double Lat { get; set; }
        public double Lon { get; set; }
    }
}
