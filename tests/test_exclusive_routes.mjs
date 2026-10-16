import assert from "node:assert/strict";
import { branchIsEnabled } from "../web/exclusive_routes.js";

const nodes = new Map(), links = new Map();
const graph = {getNodeById: id => nodes.get(id), getLink: id => links.get(id)};
let sequence = 0;
function node(type, options = {}) {
    const value = {id: ++sequence, type, mode: 0, inputs: [], graph, ...options};
    nodes.set(value.id, value); return value;
}
function connect(source, target, name = "value") {
    const id = ++sequence;
    links.set(id, {origin_id: source.id, origin_slot: 0});
    target.inputs.push({name, link: id});
}
const a = node("CLIPTextEncode"), b = node("CLIPTextEncode");
const sa = node("SetNode", {isVirtualNode: true}), sb = node("SetNode", {isVirtualNode: true});
connect(a, sa); connect(b, sb);
const ga = node("GetNode", {isVirtualNode: true, findSetter: () => sa});
const gb = node("GetNode", {isVirtualNode: true, findSetter: () => sb});
const switchNode = node("AdachiExclusiveSwitch");
connect(ga, switchNode, "input_a"); connect(gb, switchNode, "input_b");
const state = () => Number(branchIsEnabled(switchNode, "input_a")) | (Number(branchIsEnabled(switchNode, "input_b")) << 1);
assert.equal(state(), 3, "both real branches enabled");
sa.mode = 4; assert.equal(state(), 2, "ignored Set disables A despite enabled Get");
sa.mode = 0; sb.mode = 4; assert.equal(state(), 1, "reverse ignored Set selects A");
sb.mode = 0; a.mode = 4; assert.equal(state(), 2, "ignored encoder is found beyond Get/Set");
a.mode = 0; b.mode = 2; assert.equal(state(), 1, "muted encoder is also disabled");
b.mode = 0; ga.mode = 4; assert.equal(state(), 2, "ignored Get is disabled"); ga.mode = 0;
const reroute = node("Reroute"); connect(a, reroute); sa.inputs = []; connect(reroute, sa);
reroute.mode = 4; assert.equal(state(), 2, "ignored reroute behind Set is disabled");
reroute.mode = 0; a.mode = 4; assert.equal(state(), 2, "enabled reroute follows ignored source"); a.mode = 0;
sa.inputs = []; connect(ga, sa); assert.equal(state(), 2, "virtual routing cycle is disabled safely");
ga.findSetter = () => null; assert.equal(state(), 2, "missing setter is disabled");
const modern = node("VirtualRouter", {isVirtualNode: true, resolveVirtualOutput: () => ({node: a, slot: 0})});
const routed = node("AdachiExclusiveSwitch"); connect(modern, routed, "input_a");
assert.equal(branchIsEnabled(routed, "input_a"), true, "modern virtual output API is followed");
a.mode = 4;
assert.equal(branchIsEnabled(routed, "input_a"), false, "modern virtual output respects ignored source");
assert.equal(branchIsEnabled({...switchNode, graph: null}, "input_a"), false);
assert.equal(branchIsEnabled(switchNode, "not_connected"), false);
console.log("Exclusive routing: Get/Set, bypass/mute, reroutes, cycles and missing inputs passed");
