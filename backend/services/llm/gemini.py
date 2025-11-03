import os
import asyncio
import time
import json
import requests
from typing import Dict, Any, Optional
from datetime import datetime


class GeminiLLMClient:
    def __init__(self):
        self.project_id = os.environ.get("GEMINI_PROJECT_ID")
        self.location = os.environ.get("GEMINI_LOCATION")
        self.api_key = os.environ.get("GEMINI_API_KEY")
        self.disabled = not self.project_id or not self.location or not self.api_key

    async def _call_gemini_api(
        self,
        model_id: str,
        contents: Dict[str, Any],
        max_tokens: int = 1024,
        temperature: float = 0.0,
    ) -> Dict[str, Any]:
        print(f"[LLMService] Gemini API call starting - Model: {model_id}, Location: {self.location}")
        print(f"[LLMService] Project ID: {self.project_id}, API Key present: {bool(self.api_key)}")
        
        if self.disabled:
            print(f"[LLMService] Gemini disabled - Project ID: {bool(self.project_id)}, Location: {bool(self.location)}, API Key: {bool(self.api_key)}")
            return {
                "success": False,
                "error": "Gemini project ID, location, or API key missing.",
            }

        # Always use aiplatform API with the format from your working example
        # Extract simple model name from full model ID
        if model_id.startswith("publishers/google/models/"):
            simple_model_id = model_id.replace("publishers/google/models/", "")
        else:
            simple_model_id = model_id
            
        url = (
            f"https://{self.location}-aiplatform.googleapis.com/v1/"
            f"projects/{self.project_id}/locations/{self.location}/publishers/google/models/{simple_model_id}:generateContent"
            f"?key={self.api_key}"
        )
        print(f"[LLMService] Using aiplatform endpoint with model '{simple_model_id}': {url.replace(self.api_key, 'HIDDEN')}")

        payload = {"contents": contents, "generationConfig": {"temperature": temperature, "maxOutputTokens": max_tokens}}
        headers = {"Content-Type": "application/json"}
        
        print(f"[LLMService] Request payload: {json.dumps(payload, indent=2)}")

        try:
            start_time = time.time()
            print(f"[LLMService] Making HTTP request...")
            resp = await asyncio.to_thread(
                lambda: requests.post(url, headers=headers, json=payload, timeout=120)
            )
            duration = time.time() - start_time
            
            print(f"[LLMService] HTTP response received - Status: {resp.status_code}, Duration: {duration:.2f}s")
            print(f"[LLMService] Response headers: {dict(resp.headers)}")
            print(f"[LLMService] Response content length: {len(resp.content) if resp.content else 0}")

            # Check if response is empty or not JSON
            if not resp.content:
                print(f"[LLMService] Gemini returned empty response")
                return {"success": False, "error": "Empty response from Gemini API"}

            print(f"[LLMService] Raw response text: {resp.text[:500]}...")  # First 500 chars

            try:
                raw = resp.json()
                print(f"[LLMService] Parsed JSON response: {json.dumps(raw, indent=2)}")
            except json.JSONDecodeError as je:
                print(f"[LLMService] Gemini JSON decode error: {je}, Response: {resp.text}")
                return {"success": False, "error": f"Invalid JSON response: {resp.text[:200]}"}

            if not resp.ok:
                err = raw.get("error") if isinstance(raw, dict) else resp.text
                print(f"[LLMService] Gemini Error response: {raw}")
                return {"success": False, "error": err, "raw": raw}

            # Extract content safely
            try:
                content = raw.get("candidates", [])[0].get("content", {}).get("parts", [])[0].get("text", "")
                print(f"[LLMService] Extracted content length: {len(content)}")
                print(f"[LLMService] Content preview: {content[:200]}...")
            except (IndexError, KeyError) as e:
                print(f"[LLMService] Gemini content extraction error: {e}, Raw: {raw}")
                return {"success": False, "error": f"Unexpected response format: {raw}"}

            return {
                "success": True,
                "content": content,
                "raw": raw,
                "meta": {
                    "timestamp": datetime.utcnow().isoformat(),
                    "model": model_id,
                    "duration": duration,
                },
            }
        except Exception as e:
            print(f"[LLMService] Gemini request failed with exception: {e}")
            print(f"[LLMService] Exception type: {type(e).__name__}")
            import traceback
            print(f"[LLMService] Traceback: {traceback.format_exc()}")
            return {"success": False, "error": f"Gemini request failed: {str(e)}"}

    async def extract_entities_with_gemini(
        self,
        markdown: str,
        extraction_prompt: str,
        model_id: Optional[str] = None,
        max_tokens: int = 1024,
        temperature: float = 0.0,
    ) -> Dict[str, Any]:
        # Use correct Vertex AI model IDs
        gemini_models = [
            "publishers/google/models/gemini-2.5-pro",
            "publishers/google/models/gemini-2.5-flash-lite",
            "publishers/google/models/gemini-2.5-flash",
            "publishers/google/models/gemini-2.0-flash-lite-001",
            "publishers/google/models/gemini-2.0-flash-001",
        ]
        
        # Handle model ID mapping for backwards compatibility
        if model_id and not model_id.startswith("publishers/google/models/"):
            # Map old model IDs to new ones for backwards compatibility
            model_mapping = {
                "gemini-2.5-pro": "publishers/google/models/gemini-2.5-pro",
                "gemini-2.5-flash-lite-preview-09-2025": "publishers/google/models/gemini-2.5-flash-lite",
                "gemini-2.0-flash-lite-001": "publishers/google/models/gemini-2.0-flash-lite-001",
                "gemini-1.5-flash-002": "publishers/google/models/gemini-2.5-flash",  # Map to available model
            }
            model_id = model_mapping.get(model_id, model_id)
        
        used_model_id = model_id if model_id in gemini_models else "publishers/google/models/gemini-2.5-pro"

        contents = [
            {"role": "user", "parts": [{"text": f"""<markdown study>
{markdown}
</markdown study>

Prompt:
{extraction_prompt}
"""}]}
        ]
        return await self._call_gemini_api(
            used_model_id, contents, max_tokens, temperature
        )

    async def generate_paragraph_with_gemini(
        self,
        prompt: str,
        model_id: Optional[str] = None,
        max_tokens: int = 2048,
        temperature: float = 0.0,
    ) -> Dict[str, Any]:
        # Use correct Vertex AI model IDs
        gemini_models = [
            "publishers/google/models/gemini-2.5-pro",
            "publishers/google/models/gemini-2.5-flash-lite",
            "publishers/google/models/gemini-2.5-flash",
            "publishers/google/models/gemini-2.0-flash-lite-001",
            "publishers/google/models/gemini-2.0-flash-001",
        ]
        
        # Handle model ID mapping for backwards compatibility
        if model_id and not model_id.startswith("publishers/google/models/"):
            # Map old model IDs to new ones for backwards compatibility
            model_mapping = {
                "gemini-2.5-pro": "publishers/google/models/gemini-2.5-pro",
                "gemini-2.5-flash-lite-preview-09-2025": "publishers/google/models/gemini-2.5-flash-lite",
                "gemini-2.0-flash-lite-001": "publishers/google/models/gemini-2.0-flash-lite-001",
                "gemini-1.5-flash-002": "publishers/google/models/gemini-2.5-flash",  # Map to available model
            }
            model_id = model_mapping.get(model_id, model_id)
        
        used_model_id = model_id if model_id in gemini_models else "publishers/google/models/gemini-2.5-pro"

        contents = [
            {"role": "user", "parts": [{"text": prompt}]}
        ]
        return await self._call_gemini_api(
            used_model_id, contents, max_tokens, temperature
        )
