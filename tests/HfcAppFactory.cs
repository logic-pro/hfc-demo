using System.Data.Common;
using System.Net.Http.Headers;
using HfcDemo;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace HfcDemo.Tests;

// Spins up the real API in-process (WebApplicationFactory) but swaps the SQLite
// connection for a test database, so the whole pipeline runs: JWT validation →
// claim-resolution seam → EF global query filter. The auth path uses the
// default symmetric dev key (Auth:Authority unset), so tests mint genuinely
// valid tokens with DevTokens.Mint — proving the verified path, not a bypass.
public class HfcAppFactory : WebApplicationFactory<Program>
{
    private readonly string _connString;
    private SqliteConnection? _keepAlive;

    // In-memory by default (fast, isolated per factory via a unique cache name).
    // Pass a file-backed connection string for the concurrency test, where
    // independent pooled connections must race for the same slot.
    public HfcAppFactory(string? connString = null)
        => _connString = connString ?? $"Data Source=hfc-test-{Guid.NewGuid():N};Mode=Memory;Cache=Shared";

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.ConfigureServices(services =>
        {
            Remove(services, typeof(DbContextOptions<AppDb>));
            Remove(services, typeof(DbConnection));

            // For shared-cache in-memory, keep one connection open for the
            // factory's lifetime so the database isn't dropped between requests.
            if (_connString.Contains("Mode=Memory", StringComparison.OrdinalIgnoreCase))
            {
                _keepAlive = new SqliteConnection(_connString);
                _keepAlive.Open();
            }

            services.AddDbContext<AppDb>(o => o.UseSqlite(_connString));
        });
    }

    private static void Remove(IServiceCollection services, Type serviceType)
    {
        foreach (var d in services.Where(s => s.ServiceType == serviceType).ToList())
            services.Remove(d);
    }

    // An HttpClient whose every request carries a valid token for `franchiseeId`.
    public HttpClient ClientFor(string franchiseeId, string brandId)
    {
        var client = CreateClient();
        client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", DevTokens.Mint(franchiseeId, brandId));
        return client;
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        if (disposing) _keepAlive?.Dispose();
    }
}
