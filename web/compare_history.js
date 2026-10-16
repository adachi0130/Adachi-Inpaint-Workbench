// Store one matching original per result, including batches from older workflows.
export function appendComparison(previous, incoming) {
    const pairs = data => {
        const originals = Array.isArray(data?.originals) ? data.originals : [];
        const results = Array.isArray(data?.results) ? data.results : [];
        if (!originals.length || !results.length) return { originals: [], results: [] };
        const repetitions = results.length / originals.length;
        return {
            originals: results.map((_, index) => originals[Math.min(originals.length - 1, Math.floor(index / repetitions))]),
            results,
        };
    };
    const before = pairs(previous), next = pairs(incoming);
    const history = { originals: [], results: [] }, seen = new Set();
    for (const data of [before, next]) data.results.forEach((result, index) => {
        // Cached execution notifications can replay the same preview. Its file
        // identity is stable, while a genuinely new generation gets a new file.
        const key = typeof result === "object" && result !== null
            ? JSON.stringify([result.type || "temp", result.subfolder || "", result.filename])
            : JSON.stringify(result);
        if (seen.has(key)) return;
        seen.add(key);
        history.originals.push(data.originals[index]); history.results.push(result);
    });
    return history;
}
