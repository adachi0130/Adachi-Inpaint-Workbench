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
    return { originals: [...before.originals, ...next.originals], results: [...before.results, ...next.results] };
}
