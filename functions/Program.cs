using Microsoft.Azure.Functions.Worker.Builder;
using Microsoft.Extensions.Hosting;

// Isolated-worker host. The Azure Monitor / OpenTelemetry exporter that the
// template adds needs a live App Insights connection string, so it's omitted
// here to keep local `func start` clean; in Azure, telemetry is wired via the
// APPLICATIONINSIGHTS_CONNECTION_STRING app setting (see infra/).
var builder = FunctionsApplication.CreateBuilder(args);
builder.ConfigureFunctionsWebApplication();
builder.Build().Run();
