using System.Text.Json;
using System.Text.Json.Serialization;
using Anthropic;
using Anthropic.Core;
using Anthropic.Models.Messages;

namespace HfcDemo;

// ── AI-assisted structured intake ───────────────────────────────────────────
// A free-text request ("water heater burst, need someone ASAP, I'm Dana in
// Tustin") is turned into a TYPED, human-verifiable intake draft — never a
// chatbot that books the job itself. The LLM extracts fields into a fixed
// schema via tool-calling (forced tool_choice), the UI shows them for review
// and edit, and only then does the human commit to a real booking.
//
// Production guardrails baked in here (the parts a reviewer probes):
//   • Spend cap   — input is truncated, MaxTokens is tiny, one forced call.
//   • Latency cap — a hard timeout; the request never hangs the UI.
//   • Failure     — any error, timeout, or missing key degrades to a
//                   deterministic heuristic extractor, so intake never breaks.
// The response is transparent about which path produced it (UsedAi + Source).

// What time of day the customer prefers. Kept as an enum so the UI can offer a
// fixed control rather than free text the booking logic would have to parse.
[JsonConverter(typeof(JsonStringEnumConverter))]
public enum TimeOfDay { Any, Morning, Afternoon, Evening }

// How quickly they need service. Drives triage; "Emergency" is the signal a
// brand like Lightspeed Restoration cares about.
[JsonConverter(typeof(JsonStringEnumConverter))]
public enum Urgency { Routine, Soon, Emergency }

// The typed schema the LLM must fill — every field human-verifiable before commit.
public record IntakeDraft
{
    public string? CustomerName { get; init; }
    public string Service { get; init; } = "";
    public Urgency Urgency { get; init; } = Urgency.Routine;
    public TimeOfDay PreferredTimeOfDay { get; init; } = TimeOfDay.Any;
    public string? PreferredDate { get; init; }      // natural-language date hint, e.g. "Friday"
    public string? TerritoryHint { get; init; }      // city/area mentioned, matched to a Territory client-side
    public string Notes { get; init; } = "";         // anything useful not captured above
    public double Confidence { get; init; }          // 0..1 — how sure the extractor is overall

    // Provenance — surfaced in the UI so the field values are never mistaken
    // for ground truth. "ai" = model extraction; "heuristic" = local fallback.
    public string Source { get; init; } = "heuristic";
    public bool UsedAi { get; init; }
    public string? Notice { get; init; }             // why we fell back, if we did
    public string? Model { get; init; }
    public int LatencyMs { get; init; }
}

// Request body: the customer's own words, plus the brand context the caller is
// acting as (so the model knows the service vocabulary it should map onto).
public record IntakeRequest(string Text);

public class IntakeService
{
    private readonly IConfiguration _config;
    private readonly ILogger<IntakeService> _log;

    // Spend/latency caps — deliberately conservative for a field-extraction task.
    private const int MaxInputChars = 1200;   // truncate runaway input before it costs tokens
    private const int MaxTokens = 600;        // a filled tool call is small; cap hard
    private const int TimeoutMs = 8000;       // never hang the booking UI on the model
    private const string ModelId = "claude-opus-4-8";

    public IntakeService(IConfiguration config, ILogger<IntakeService> log)
    {
        _config = config;
        _log = log;
    }

    // Brand-specific service vocabulary, so the model maps "my water heater
    // flooded the basement" → "Water damage restoration" for Lightspeed, etc.
    private static readonly Dictionary<string, string[]> ServicesByBrand = new()
    {
        ["budget-blinds"]   = new[] { "In-home consult", "Window covering measure", "Motorized shades quote" },
        ["tailored-closet"] = new[] { "In-home consult", "Closet design", "Garage storage design" },
        ["premier-garage"]  = new[] { "In-home consult", "Garage flooring quote", "Cabinet & storage design" },
        ["kitchen-tuneup"]  = new[] { "In-home consult", "Cabinet refacing quote", "Redooring estimate" },
        ["bath-tuneup"]     = new[] { "In-home consult", "One-day bath update quote", "Tub-to-shower consult" },
        ["two-maids"]       = new[] { "Standard clean", "Deep clean", "Move-out clean" },
        ["aussie-pet"]      = new[] { "Mobile grooming", "Bath & tidy", "Full groom" },
        ["lightspeed"]      = new[] { "Water damage restoration", "Fire & smoke restoration", "Mold remediation", "Emergency assessment" },
    };

    private static string[] ServicesFor(string? brandId) =>
        brandId is not null && ServicesByBrand.TryGetValue(brandId, out var s)
            ? s
            : new[] { "In-home consult" };

    public async Task<IntakeDraft> ParseAsync(string text, string? brandId, CancellationToken ct)
    {
        text = (text ?? "").Trim();
        if (text.Length > MaxInputChars) text = text[..MaxInputChars];   // spend cap
        var services = ServicesFor(brandId);

        var apiKey = _config["ANTHROPIC_API_KEY"]
                     ?? Environment.GetEnvironmentVariable("ANTHROPIC_API_KEY");

        if (string.IsNullOrWhiteSpace(text))
            return Heuristic(text, services, notice: null);   // nothing to do; return empty draft

        if (string.IsNullOrWhiteSpace(apiKey))
            return Heuristic(text, services,
                notice: "AI key not configured — fields extracted locally. Review before booking.");

        try
        {
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            cts.CancelAfter(TimeoutMs);                        // latency cap
            return await ExtractWithClaudeAsync(text, services, apiKey!, cts.Token);
        }
        catch (OperationCanceledException)
        {
            _log.LogWarning("Intake AI call timed out after {Ms}ms; using heuristic.", TimeoutMs);
            return Heuristic(text, services, notice: "AI timed out — fields extracted locally. Review before booking.");
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Intake AI call failed; using heuristic.");
            return Heuristic(text, services, notice: "AI unavailable — fields extracted locally. Review before booking.");
        }
    }

    // ── The AI path: one forced tool call yields the typed schema ────────────
    private async Task<IntakeDraft> ExtractWithClaudeAsync(
        string text, string[] services, string apiKey, CancellationToken ct)
    {
        var started = Environment.TickCount64;
        var client = new AnthropicClient(new ClientOptions { ApiKey = apiKey });

        // The schema we force the model to fill. Constraining `service` to the
        // brand's enum keeps extraction on-vocabulary; everything else is the
        // small set of fields the booking form needs.
        var tool = new Tool
        {
            Name = "record_intake",
            Description = "Record the structured intake fields extracted from the customer's request. "
                        + "Always call this tool exactly once. Do not invent details that are not present "
                        + "in the request; leave optional fields null and lower the confidence instead.",
            InputSchema = new InputSchema
            {
                Properties = new Dictionary<string, JsonElement>
                {
                    ["customerName"] = Schema(new { type = new[] { "string", "null" }, description = "The customer's name if stated, else null." }),
                    ["service"] = Schema(new { type = "string", @enum = services, description = "The best-matching service from this brand's catalog." }),
                    ["urgency"] = Schema(new { type = "string", @enum = new[] { "Routine", "Soon", "Emergency" }, description = "How urgent the request sounds." }),
                    ["preferredTimeOfDay"] = Schema(new { type = "string", @enum = new[] { "Any", "Morning", "Afternoon", "Evening" }, description = "Preferred time of day, or Any." }),
                    ["preferredDate"] = Schema(new { type = new[] { "string", "null" }, description = "Any date/day hint in the customer's words (e.g. 'Friday', 'next week'), else null." }),
                    ["territoryHint"] = Schema(new { type = new[] { "string", "null" }, description = "Any city/neighborhood mentioned (e.g. 'Tustin'), else null." }),
                    ["notes"] = Schema(new { type = "string", description = "Short summary of anything useful not captured by the other fields. May be empty." }),
                    ["confidence"] = Schema(new { type = "number", description = "Your overall confidence in this extraction, 0.0 to 1.0." }),
                },
                Required = new[] { "service", "urgency", "preferredTimeOfDay", "notes", "confidence" },
            },
        };

        var system =
            "You are an intake assistant for a home-services franchise. Extract structured booking "
            + "fields from the customer's free-text request and return them by calling the record_intake "
            + "tool. Only use information actually present in the request. This is an assist for a human "
            + "agent who will verify every field — accuracy and honest confidence matter more than filling "
            + "every slot.";

        var parameters = new MessageCreateParams
        {
            Model = ModelId,
            MaxTokens = MaxTokens,
            System = system,
            Tools = new ToolUnion[] { tool },
            ToolChoice = new ToolChoiceTool { Name = "record_intake" },   // force the typed call
            Messages = new[]
            {
                new MessageParam
                {
                    Role = Role.User,
                    Content = $"Customer request:\n\"\"\"\n{text}\n\"\"\"",
                },
            },
        };

        var message = await client.Messages.Create(parameters, cancellationToken: ct);

        foreach (var block in message.Content)
        {
            if (block.TryPickToolUse(out var toolUse) && toolUse.Name == "record_intake")
            {
                var draft = FromToolInput(toolUse.Input, services);
                return draft with
                {
                    Source = "ai",
                    UsedAi = true,
                    Model = ModelId,
                    LatencyMs = (int)(Environment.TickCount64 - started),
                };
            }
        }

        // Model answered without the forced tool (rare) — fall back transparently.
        return Heuristic(text, services, notice: "AI returned no structured result — extracted locally. Review before booking.");
    }

    private static JsonElement Schema(object o) => JsonSerializer.SerializeToElement(o);

    // Map the tool's JSON input (loosely typed) onto our DTO, tolerating
    // missing/odd fields — we never trust the model's shape blindly.
    private static IntakeDraft FromToolInput(IReadOnlyDictionary<string, JsonElement> input, string[] services)
    {
        string? Str(string k) =>
            input.TryGetValue(k, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

        var service = Str("service");
        // Keep service on-vocabulary even if the model improvises.
        if (string.IsNullOrWhiteSpace(service) ||
            !services.Contains(service, StringComparer.OrdinalIgnoreCase))
            service = services[0];

        double confidence = 0.5;
        if (input.TryGetValue("confidence", out var c) && c.ValueKind == JsonValueKind.Number)
            confidence = Math.Clamp(c.GetDouble(), 0, 1);

        return new IntakeDraft
        {
            CustomerName = Str("customerName"),
            Service = service,
            Urgency = ParseEnum(Str("urgency"), Urgency.Routine),
            PreferredTimeOfDay = ParseEnum(Str("preferredTimeOfDay"), TimeOfDay.Any),
            PreferredDate = Str("preferredDate"),
            TerritoryHint = Str("territoryHint"),
            Notes = Str("notes") ?? "",
            Confidence = confidence,
        };
    }

    private static TEnum ParseEnum<TEnum>(string? s, TEnum fallback) where TEnum : struct =>
        Enum.TryParse<TEnum>(s, ignoreCase: true, out var v) ? v : fallback;

    // ── The fallback path: deterministic keyword/heuristic extraction ────────
    // Good enough to be genuinely useful when there's no key or the call fails,
    // and clearly labeled so it's never mistaken for the model's output.
    private static IntakeDraft Heuristic(string text, string[] services, string? notice)
    {
        var lower = (text ?? "").ToLowerInvariant();

        var urgency =
            ContainsAny(lower, "emergency", "asap", "urgent", "right now", "flood", "burst", "leaking", "leak", "fire", "smoke")
                ? Urgency.Emergency
            : ContainsAny(lower, "soon", "this week", "tomorrow", "quickly")
                ? Urgency.Soon
            : Urgency.Routine;

        var tod =
            ContainsAny(lower, "morning", "am", "before noon") ? TimeOfDay.Morning
            : ContainsAny(lower, "afternoon", "midday") ? TimeOfDay.Afternoon
            : ContainsAny(lower, "evening", "after work", "pm", "tonight") ? TimeOfDay.Evening
            : TimeOfDay.Any;

        // Map keywords to the brand's own service list (best-effort substring match).
        var service = services[0];
        foreach (var s in services)
        {
            var first = s.Split(' ')[0].ToLowerInvariant();
            if (first.Length > 3 && lower.Contains(first)) { service = s; break; }
        }
        if (ContainsAny(lower, "water", "flood", "burst", "leak")) service = PickContaining(services, "water") ?? service;
        if (ContainsAny(lower, "mold")) service = PickContaining(services, "mold") ?? service;
        if (ContainsAny(lower, "fire", "smoke")) service = PickContaining(services, "fire") ?? service;

        var day = FindDay(lower);
        var territory = FindTerritory(text ?? "");
        var name = FindName(text ?? "");

        return new IntakeDraft
        {
            CustomerName = name,
            Service = service,
            Urgency = urgency,
            PreferredTimeOfDay = tod,
            PreferredDate = day,
            TerritoryHint = territory,
            Notes = string.IsNullOrWhiteSpace(text) ? "" : "Auto-summarized from request; please verify.",
            Confidence = string.IsNullOrWhiteSpace(text) ? 0 : 0.45,
            Source = "heuristic",
            UsedAi = false,
            Notice = notice,
            LatencyMs = 0,
        };
    }

    private static bool ContainsAny(string s, params string[] needles) => needles.Any(s.Contains);

    private static string? PickContaining(string[] services, string needle) =>
        services.FirstOrDefault(s => s.ToLowerInvariant().Contains(needle));

    private static string? FindDay(string lower)
    {
        foreach (var d in new[] { "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "today", "tomorrow", "next week" })
            if (lower.Contains(d)) return char.ToUpper(d[0]) + d[1..];
        return null;
    }

    // Match a known seeded city, else null. Conservative on purpose — a wrong
    // guess is worse than an empty field the human fills in.
    private static string? FindTerritory(string text)
    {
        foreach (var city in new[] { "Irvine", "Tustin" })
            if (text.Contains(city, StringComparison.OrdinalIgnoreCase)) return city;
        return null;
    }

    // Very light name spotting: "I'm Dana", "this is Dana", "my name is Dana".
    private static string? FindName(string text)
    {
        foreach (var cue in new[] { "i'm ", "i am ", "this is ", "my name is ", "name's " })
        {
            var i = text.ToLowerInvariant().IndexOf(cue, StringComparison.Ordinal);
            if (i < 0) continue;
            var rest = text[(i + cue.Length)..].TrimStart();
            var word = new string(rest.TakeWhile(ch => char.IsLetter(ch) || ch == '-' || ch == '\'').ToArray());
            if (word.Length is >= 2 and <= 30)
                return char.ToUpper(word[0]) + word[1..];
        }
        return null;
    }
}
