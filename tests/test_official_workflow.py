"""The public template stays portable and routes each preset independently."""
import json
from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]


class OfficialWorkflowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.path = ROOT / "examples" / "Adachi-Workbench.json"
        cls.raw = cls.path.read_text(encoding="utf-8")
        cls.workflow = json.loads(cls.raw)
        cls.nodes = {node["id"]: node for node in cls.workflow["nodes"]}
        cls.links = {link[0]: link for link in cls.workflow["links"]}
        cls.groups = {group["id"]: group for group in cls.workflow["groups"]}

    def typed(self, name):
        return [node for node in self.nodes.values() if node["type"] == name]

    def group_members(self, group):
        x, y, width, height = group["bounding"]
        return [node for node in self.nodes.values()
                if x <= node["pos"][0] and y <= node["pos"][1]
                and node["pos"][0] + node["size"][0] <= x + width
                and node["pos"][1] + node["size"][1] <= y + height]

    def test_one_complete_official_template(self):
        self.assertEqual([self.path.name], sorted(p.name for p in (ROOT / "examples").glob("*.json")))
        for name in ("CheckpointLoaderSimple", "EmptyLatentImage", "KSampler", "VAEDecode",
                     "SaveImage", "AdachiInlineMask", "AdachiWebUIInpaint", "AdachiImageCompare",
                     "AdachiGroupPresets"):
            self.assertEqual(len(self.typed(name)), 1, name)
        self.assertEqual(len(self.typed("AdachiExclusiveSwitch")), 3)
        self.assertEqual(len(self.typed("CLIPTextEncode")), 4)
        allowed = {"CheckpointLoaderSimple", "EmptyLatentImage", "KSampler", "VAEDecode", "SaveImage",
                   "CLIPTextEncode", "Note", "AdachiInlineMask", "AdachiWebUIInpaint",
                   "AdachiImageCompare", "AdachiGroupPresets", "AdachiExclusiveSwitch"}
        self.assertTrue({node["type"] for node in self.nodes.values()} <= allowed)

    def test_ids_and_reciprocal_link_types(self):
        self.assertEqual(len(self.nodes), len(self.workflow["nodes"]))
        self.assertEqual(len(self.links), len(self.workflow["links"]))
        self.assertEqual(self.workflow["last_node_id"], max(self.nodes))
        self.assertEqual(self.workflow["last_link_id"], max(self.links))
        for key, source, out, target, inp, kind in self.links.values():
            origin = self.nodes[source]["outputs"][out]
            destination = self.nodes[target]["inputs"][inp]
            self.assertIn(key, origin["links"])
            self.assertEqual(destination["link"], key)
            for socket in (origin, destination):
                self.assertTrue(kind == socket["type"] or "*" in (kind, socket["type"]),
                                (key, kind, socket))
        for node in self.nodes.values():
            for index, socket in enumerate(node.get("inputs", [])):
                if socket.get("link") is not None:
                    self.assertEqual(self.links[socket["link"]][3:5], [node["id"], index])
            for index, socket in enumerate(node.get("outputs", [])):
                for key in socket.get("links") or []:
                    self.assertEqual(self.links[key][1:3], [node["id"], index])

    def test_presets_enable_one_branch_and_keep_common_nodes_enabled(self):
        controller = self.typed("AdachiGroupPresets")[0]
        state = controller["properties"]["adachi_group_presets"]
        self.assertEqual(state["activeId"], "text-to-image")
        self.assertEqual({preset["id"] for preset in state["presets"]}, {"text-to-image", "inpaint"})
        membership = {}
        for key, group in self.groups.items():
            for node in self.group_members(group):
                self.assertNotIn(node["id"], membership, "Mode groups must not overlap")
                membership[node["id"]] = key
        for node in self.nodes.values():
            if node["type"] in ("AdachiExclusiveSwitch", "CheckpointLoaderSimple", "SaveImage", "AdachiGroupPresets"):
                self.assertNotIn(node["id"], membership, node["type"])
        for preset in state["presets"]:
            self.assertEqual({value["mode"] for value in preset["groups"].values()}, {0, 4})
            modes = {node["id"]: preset["groups"][f"group:{membership[node['id']]}"]["mode"]
                     if node["id"] in membership else node["mode"] for node in self.nodes.values()}
            expected = 1 if preset["id"] == "text-to-image" else 2
            for switch in self.typed("AdachiExclusiveSwitch"):
                active = sum((1 << index) for index, socket in enumerate(switch["inputs"])
                             if modes[self.links[socket["link"]][1]] == 0)
                self.assertEqual(active, expected, (preset["id"], switch["title"]))
            if preset["id"] == state["activeId"]:
                for node in self.nodes.values():
                    self.assertEqual(node["mode"], modes[node["id"]], node["title"])

    def test_no_private_source_or_locale_is_bundled(self):
        self.assertEqual(self.typed("CheckpointLoaderSimple")[0]["widgets_values"], ["YOUR_CHECKPOINT.safetensors"])
        self.assertIsNone(re.search(r"[\u3400-\u9fff]", self.raw), "Template text must be English")
        self.assertIsNone(re.search(r"[A-Za-z]:[\\/]|data:image|https?://|/Users/|/root/", self.raw))
        inline = self.typed("AdachiInlineMask")[0]
        self.assertEqual(inline["widgets_values"][:7], ["", "", "", "mask", "{}", "", ""])
        self.assertEqual(set(self.workflow["extra"]), {"ds"})

    def test_saving_text_to_image_does_not_depend_on_an_uploaded_image(self):
        controller = self.typed("AdachiGroupPresets")[0]
        presets = controller["properties"]["adachi_group_presets"]["presets"]
        members = {node["id"]: group["id"] for group in self.groups.values()
                   for node in self.group_members(group)}
        for preset in presets:
            enabled = {key for key, node in self.nodes.items()
                       if (preset["groups"][f"group:{members[key]}"]["mode"]
                           if key in members else node["mode"]) == 0}
            seen, todo = set(), [self.typed("SaveImage")[0]["id"]]
            while todo:
                key = todo.pop()
                if key in seen:
                    continue
                self.assertIn(key, enabled, "Active output must not use a disabled branch")
                seen.add(key)
                node = self.nodes[key]
                sockets = node.get("inputs", [])
                if node["type"] == "AdachiExclusiveSwitch":
                    sockets = [socket for socket in sockets if self.links[socket["link"]][1] in enabled]
                    self.assertEqual(len(sockets), 1)
                todo.extend(self.links[socket["link"]][1] for socket in sockets if socket.get("link") is not None)
            types = {self.nodes[key]["type"] for key in seen}
            if preset["id"] == "text-to-image":
                self.assertTrue({"KSampler", "VAEDecode", "EmptyLatentImage"} <= types)
                self.assertTrue({"AdachiInlineMask", "AdachiWebUIInpaint", "AdachiImageCompare"}.isdisjoint(types))
            else:
                self.assertTrue({"AdachiInlineMask", "AdachiWebUIInpaint", "AdachiImageCompare"} <= types)
                self.assertTrue({"KSampler", "VAEDecode", "EmptyLatentImage"}.isdisjoint(types))


if __name__ == "__main__":
    unittest.main()
