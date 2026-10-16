"""Adachi-Inpaint-Workbench custom-node package for ComfyUI."""

from .backend import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS, normalize_exclusive_prompt
from server import PromptServer

if not getattr(PromptServer.instance, "_adachi_exclusive_normalizer", False):
    PromptServer.instance.add_on_prompt_handler(normalize_exclusive_prompt)
    PromptServer.instance._adachi_exclusive_normalizer = True

WEB_DIRECTORY = "./web"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
