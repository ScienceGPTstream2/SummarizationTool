import os
import asyncio
import time
from typing import Dict, Any, Optional
from datetime import datetime

try:
    import google.generativeai as genai

    GEMINI_AVAILABLE = True
except ImportError:
    GEMINI_AVAILABLE = False
    genai = None


class GeminiLLMClient:
    def __init__(self):
        self.gemini_project = os.environ.get("GEMINI_PROJECT")
        self.gemini_location = os.environ.get("GEMINI_LOCATION")
        self.disabled = (
            not GEMINI_AVAILABLE or not self.gemini_project or not self.gemini_location
        )
        if not self.disabled and genai:
            try:
                self.gemini_client = genai.Client(
                    vertexai=True,
                    project=self.gemini_project,
                    location=self.gemini_location,
                )
            except Exception:
                self.disabled = True
                self.gemini_client = None
        else:
            self.gemini_client = None

    async def extract_entities_with_gemini(
        self, markdown: str, extraction_prompt: str, gemini_model: Optional[str] = None
    ) -> Dict[str, Any]:
        if self.disabled:
            return {"success": False, "error": "Gemini project or location missing."}

        gemini_models = [
            "gemini-2.5-pro",
            "gemini-2.5-flash",
            "gemini-2.5-flash-lite",
            "gemini-2.0-flash",
            "gemini-2.0-flash-lite",
        ]

        model = gemini_model if gemini_model in gemini_models else "gemini-2.5-pro"

        contents = f"""<markdown study>
{markdown}
</markdown study>

Prompt:
{extraction_prompt}
"""

        try:
            start_time = time.time()
            response = await asyncio.to_thread(
                lambda: self.gemini_client.models.generate_content(
                    model=model, contents=contents
                )
            )
            duration = time.time() - start_time

            return {
                "success": True,
                "content": response.text,
                "raw": response,
                "meta": {
                    "timestamp": datetime.utcnow().isoformat(),
                    "model": model,
                    "duration": duration,
                },
            }
        except Exception as e:
            return {"success": False, "error": f"Gemini request failed: {str(e)}"}
