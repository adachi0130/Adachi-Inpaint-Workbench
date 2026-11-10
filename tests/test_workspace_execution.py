"""Workspace validation must not execute, save or modify the submitted graph."""
import importlib.util
from pathlib import Path
import types
import unittest

SPEC = importlib.util.spec_from_file_location("adachi_workspace_execution", Path(__file__).resolve().parents[1] / "workspace_execution.py")
workspace = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(workspace)


class WorkspaceTests(unittest.IsolatedAsyncioTestCase):
    def prompt(self):
        return {
            "1": {"class_type": "ImageSource", "inputs": {}},
            "2": {"class_type": "ImageInvert", "inputs": {"image": ["1", 0]}},
            "3": {"class_type": "AdachiImageCompare", "inputs": {"original": ["1", 0], "result": ["2", 0]}},
            "4": {"class_type": "SaveImage", "inputs": {"images": ["2", 0]}},
            "5": {"class_type": "NotInstalled", "inputs": {}},
        }

    async def test_only_comparison_branch_is_validated(self):
        original = self.prompt()
        calls = []

        async def validate(prompt_id, prompt, targets):
            calls.append((prompt_id, prompt, targets))
            return True, None, ["3"], {}

        server = types.SimpleNamespace(trigger_on_prompt=lambda data: data)
        data, _, valid = await workspace.prepare_workspace(server, types.SimpleNamespace(validate_prompt=validate), {"prompt": original, "compare_id": "3"})
        self.assertTrue(valid[0])
        self.assertEqual(set(data["prompt"]), {"1", "2", "3"})
        self.assertEqual(calls[0][2], ["3"])
        self.assertEqual(set(original), {"1", "2", "3", "4", "5"})

    async def test_hooks_restore_links_before_pruning(self):
        original = self.prompt()
        original["2"]["inputs"].clear()

        def hook(data):
            data["prompt"]["2"]["inputs"]["image"] = ["1", 0]
            return data

        def validate(prompt):
            self.assertIn("1", prompt)
            return True, None, ["3"], {}

        server = types.SimpleNamespace(trigger_on_prompt=hook)
        await workspace.prepare_workspace(server, types.SimpleNamespace(validate_prompt=validate), {"prompt": original, "compare_id": "3"})
        self.assertEqual(original["2"]["inputs"], {})

    def test_missing_dependency_and_non_comparison_output_rejected(self):
        with self.assertRaises(ValueError):
            workspace.dependency_prompt(self.prompt(), "4")
        prompt = self.prompt()
        del prompt["2"]
        with self.assertRaisesRegex(ValueError, "missing node"):
            workspace.dependency_prompt(prompt, "3")

    def test_malformed_node_inputs_are_a_validation_error(self):
        for value in ([], None, "invalid", 42):
            prompt = self.prompt()
            prompt["2"]["inputs"] = value
            with self.assertRaisesRegex(ValueError, "Invalid input mapping"):
                workspace.dependency_prompt(prompt, "3")

    async def test_bad_inputs_never_reach_core_replacement_hooks(self):
        def unexpected(_prompt):
            self.fail("Malformed inputs reached a core hook")
        server = types.SimpleNamespace(trigger_on_prompt=lambda data: data,
            node_replace_manager=types.SimpleNamespace(apply_replacements=unexpected))
        prompt = self.prompt()
        prompt["2"]["inputs"] = None
        with self.assertRaisesRegex(ValueError, "Invalid input mapping"):
            await workspace.prepare_workspace(server, types.SimpleNamespace(), {"prompt":prompt, "compare_id":"3"})

    async def test_validation_error_is_returned_without_queueing(self):
        def validate(prompt):
            return False, {"message": "missing checkpoint"}, [], {"1": {"errors": []}}
        server = types.SimpleNamespace(trigger_on_prompt=lambda data: data)
        _, _, valid = await workspace.prepare_workspace(server, types.SimpleNamespace(validate_prompt=validate), {"prompt": self.prompt(), "compare_id": "3"})
        self.assertFalse(valid[0])
        self.assertEqual(valid[1]["message"], "missing checkpoint")
