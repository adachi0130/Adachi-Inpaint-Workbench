"""Adachi-Inpaint-Workbench custom-node package for ComfyUI."""

from .backend import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS, normalize_exclusive_prompt
from .preview_cleanup import start_preview_cleanup
from .preview_store import PREVIEWS
from aiohttp import web
from server import PromptServer
import re

if not getattr(PromptServer.instance, "_adachi_exclusive_normalizer", False):
    PromptServer.instance.add_on_prompt_handler(normalize_exclusive_prompt)
    PromptServer.instance._adachi_exclusive_normalizer = True

if not getattr(PromptServer.instance, "_adachi_preview_route", False):
    @PromptServer.instance.routes.get("/adachi-inpaint/compare/{filename}")
    async def adachi_comparison_preview(request):
        name = request.match_info["filename"]
        if not re.fullmatch(r"[A-Za-z0-9_-]{32}\.png", name):
            raise web.HTTPNotFound()
        data = PREVIEWS.get(name[:-4])
        if data is None:
            raise web.HTTPNotFound(text="Comparison preview expired; run the workflow again.")
        return web.Response(body=data, content_type="image/png", headers={"Cache-Control": "no-store"})

    PromptServer.instance._adachi_preview_route = True

start_preview_cleanup()

WEB_DIRECTORY = "./web"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
