using System.Text;

namespace HfcDemo;

// Shared seed utilities.
public static partial class Seed
{
    // Lowercase, hyphenate non-alphanumerics, trim — "Pacific Shade Partners LLC"
    // → "pacific-shade-partners-llc". Operator names are distinct, so are slugs.
    private static string Slugify(string s)
    {
        var sb = new StringBuilder(s.Length);
        bool lastDash = false;
        foreach (char c in s.ToLowerInvariant())
        {
            if (char.IsLetterOrDigit(c)) { sb.Append(c); lastDash = false; }
            else if (!lastDash) { sb.Append('-'); lastDash = true; }
        }
        return sb.ToString().Trim('-');
    }
}
