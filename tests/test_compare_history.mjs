import assert from "node:assert/strict";
import { appendComparison } from "../web/compare_history.js";

const first = {originals: ["source-a"], results: ["result-a"]};
const second = appendComparison(first, {originals: ["source-b"], results: ["result-b", "result-c"]});
assert.deepEqual(second, {originals: ["source-a", "source-b", "source-b"], results: ["result-a", "result-b", "result-c"]});
assert.deepEqual(first, {originals: ["source-a"], results: ["result-a"]}, "Do not mutate saved history");
const legacy = {originals: ["a", "b"], results: [1, 2, 3, 4]};
assert.deepEqual(appendComparison(legacy, {originals: ["c"], results: [5]}), {
    originals: ["a", "a", "b", "b", "c"], results: [1, 2, 3, 4, 5],
});
assert.deepEqual(appendComparison(undefined, first), first);
assert.deepEqual(appendComparison(first, {}), first);
assert.deepEqual(appendComparison({}, {results: ["orphan"]}), {originals: [], results: []});
assert.deepEqual(appendComparison(JSON.parse(JSON.stringify(second)), first).results, ["result-a", "result-b", "result-c"], "Cached execution replay must not count twice");
const preview = {filename: "preview_001.png", subfolder: "", type: "temp"};
const one = {originals: ["source-a"], results: [preview]};
assert.equal(appendComparison(one, {originals: ["source-a"], results: [{...preview}]}).results.length, 1);
assert.equal(appendComparison(one, {originals: ["source-a"], results: [{...preview, filename: "preview_002.png"}]}).results.length, 2);
assert.equal(appendComparison(one, {originals: ["source-a"], results: [{...preview, subfolder: "other"}]}).results.length, 2);
assert.equal(appendComparison(one, {originals: ["source-a"], results: [{...preview, type: "output"}]}).results.length, 2);
assert.deepEqual(appendComparison({originals: ["source-a", "source-a"], results: [preview, {...preview}]}), one, "Repair duplicates already saved in workflows");
console.log("Comparison history checks passed");
