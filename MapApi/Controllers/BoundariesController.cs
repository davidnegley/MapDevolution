using Microsoft.AspNetCore.Mvc;
using MapApi.Models;
using System.Text.Json;

namespace MapApi.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class BoundariesController : ControllerBase
    {
        private static List<CountryBoundary>? _cachedBoundaries;
        private static readonly object _lock = new object();
        private readonly ILogger<BoundariesController> _logger;

        public BoundariesController(ILogger<BoundariesController> logger)
        {
            _logger = logger;
        }

        [HttpGet("countries")]
        public ActionResult<IEnumerable<CountryBoundary>> GetCountries()
        {
            try
            {
                // Load and cache boundaries on first request
                if (_cachedBoundaries == null)
                {
                    lock (_lock)
                    {
                        if (_cachedBoundaries == null)
                        {
                            _logger.LogInformation("Loading country boundaries from file...");
                            var jsonPath = Path.Combine(AppContext.BaseDirectory, "country-boundaries.json");

                            if (!System.IO.File.Exists(jsonPath))
                            {
                                _logger.LogError("country-boundaries.json not found at {Path}", jsonPath);
                                return NotFound("Country boundaries data not found");
                            }

                            var jsonData = System.IO.File.ReadAllText(jsonPath);
                            var options = new JsonSerializerOptions
                            {
                                PropertyNameCaseInsensitive = true
                            };
                            var osmResponse = JsonSerializer.Deserialize<OsmResponse>(jsonData, options);

                            if (osmResponse == null || osmResponse.Elements == null)
                            {
                                _logger.LogError("Failed to deserialize country boundaries");
                                return StatusCode(500, "Failed to load boundaries");
                            }

                            _logger.LogInformation("Processing {Count} country boundaries...", osmResponse.Elements.Count);
                            _cachedBoundaries = ProcessBoundaries(osmResponse.Elements);
                            _logger.LogInformation("Loaded and cached {Count} country boundaries", _cachedBoundaries.Count);
                        }
                    }
                }

                return Ok(_cachedBoundaries);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error loading country boundaries");
                return StatusCode(500, "Internal server error");
            }
        }

        private List<CountryBoundary> ProcessBoundaries(List<OsmElement> elements)
        {
            var boundaries = new List<CountryBoundary>();

            foreach (var element in elements)
            {
                if (element.Type != "relation" || element.Tags?.GetValueOrDefault("admin_level") != "2")
                    continue;

                var outerMembers = element.Members?
                    .Where(m => m.Role == "outer" && m.Geometry != null && m.Geometry.Count > 0)
                    .ToList() ?? new List<OsmMember>();

                List<List<double[]>> coords;

                if (outerMembers.Count > 0)
                {
                    coords = ProcessMultipolygon(outerMembers);
                }
                else if (element.Geometry != null && element.Geometry.Count > 0)
                {
                    // Simple polygon from geometry
                    var ring = element.Geometry
                        .Where(pt => pt != null)
                        .Select(pt => new double[] { pt.Lon, pt.Lat })
                        .ToList();
                    coords = new List<List<double[]>> { ring };
                }
                else
                {
                    continue;
                }

                if (coords.Count > 0)
                {
                    var boundary = new CountryBoundary
                    {
                        Type = "country",
                        Name = element.Tags?.GetValueOrDefault("name"),
                        Geometry = new GeometryData
                        {
                            Coordinates = coords.Select(c => c.ToArray()).ToArray()
                        }
                    };
                    boundaries.Add(boundary);
                }
            }

            return boundaries;
        }

        private List<List<double[]>> ProcessMultipolygon(List<OsmMember> outerMembers)
        {
            var outerWays = outerMembers
                .Select(m => m.Geometry?
                    .Where(pt => pt != null)
                    .Select(pt => new double[] { pt.Lon, pt.Lat })
                    .ToList() ?? new List<double[]>())
                .Where(way => way.Count > 0)
                .ToList();

            if (outerWays.Count == 0)
                return new List<List<double[]>>();

            var rings = new List<List<double[]>>();
            var used = new HashSet<int>();

            for (int i = 0; i < outerWays.Count; i++)
            {
                if (used.Contains(i)) continue;

                var currentRing = new List<double[]>(outerWays[i]);
                used.Add(i);

                bool foundConnection = true;
                while (foundConnection && currentRing.Count > 0)
                {
                    foundConnection = false;
                    var ringStart = currentRing[0];
                    var ringEnd = currentRing[currentRing.Count - 1];

                    for (int j = 0; j < outerWays.Count; j++)
                    {
                        if (used.Contains(j)) continue;

                        var way = outerWays[j];
                        var wayStart = way[0];
                        var wayEnd = way[way.Count - 1];

                        // Check various connection possibilities
                        if (ArePointsClose(ringEnd, wayStart))
                        {
                            currentRing.RemoveAt(currentRing.Count - 1);
                            currentRing.AddRange(way);
                            used.Add(j);
                            foundConnection = true;
                            break;
                        }
                        else if (ArePointsClose(ringEnd, wayEnd))
                        {
                            currentRing.RemoveAt(currentRing.Count - 1);
                            way.Reverse();
                            currentRing.AddRange(way);
                            used.Add(j);
                            foundConnection = true;
                            break;
                        }
                        else if (ArePointsClose(ringStart, wayEnd))
                        {
                            way.RemoveAt(way.Count - 1);
                            currentRing.InsertRange(0, way);
                            used.Add(j);
                            foundConnection = true;
                            break;
                        }
                        else if (ArePointsClose(ringStart, wayStart))
                        {
                            way.Reverse();
                            way.RemoveAt(way.Count - 1);
                            currentRing.InsertRange(0, way);
                            used.Add(j);
                            foundConnection = true;
                            break;
                        }
                    }
                }

                rings.Add(currentRing);
            }

            return rings;
        }

        private bool ArePointsClose(double[] p1, double[] p2)
        {
            return Math.Abs(p1[0] - p2[0]) < 0.0001 && Math.Abs(p1[1] - p2[1]) < 0.0001;
        }
    }
}
