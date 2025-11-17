"""
Custom Anthropic Vertex AI adapter for DeepEval
This follows the official DeepEval documentation pattern using Anthropic Vertex SDK
"""

import os
from typing import Optional
from deepeval.models.base_model import DeepEvalBaseLLM
from anthropic import AnthropicVertex


class AnthropicVertexDeepEvalModel(DeepEvalBaseLLM):
    """
    Custom DeepEval model adapter for Anthropic via Vertex AI
    Follows official DeepEval documentation pattern
    
    Uses AnthropicVertex SDK with service account authentication
    """

    def __init__(
        self,
        model_name: str = "claude-sonnet-4-5@20250929",
        project: Optional[str] = None,
        location: str = "global",
        temperature: Optional[float] = None,
        max_tokens: int = 2048,
    ):
        """
        Initialize Anthropic Vertex adapter for DeepEval

        Args:
            model_name: Claude model name (default: claude-sonnet-4-5@20250929)
            project: GCP project ID (defaults to hcsx-scigpt2-innocentrhino-acm)
            location: GCP location (default: global for Anthropic)
            temperature: Temperature for generation (None = use model default)
            max_tokens: Max tokens for generation (default 2048)
        """
        # Set the Google Application Credentials environment variable
        credentials_path = os.path.join(
            os.path.dirname(__file__),
            "..",
            "..",
            "..",
            "core",
            "hcsx-scigpt2-innocentrhino-acm-f87f8026be3d.json",
        )
        os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = credentials_path

        self._model_name = model_name
        self.project = project or "hcsx-scigpt2-innocentrhino-acm"
        self.location = location
        self.temperature = temperature
        self.max_tokens = max_tokens

        # Initialize Anthropic Vertex client
        self.client = AnthropicVertex(region=self.location, project_id=self.project)

    def load_model(self):
        """Load the Anthropic Vertex client"""
        return self.client

    def generate(self, prompt: str) -> str:
        """
        Generate text using Anthropic Vertex AI

        Args:
            prompt: The prompt to send to the model

        Returns:
            Generated text response
        """
        client = self.load_model()
        
        # Prepare request parameters
        request_params = {
            "max_tokens": self.max_tokens,
            "messages": [{"role": "user", "content": prompt}],
            "model": self._model_name,
        }

        # Add temperature if explicitly provided
        if self.temperature is not None:
            request_params["temperature"] = self.temperature

        # Make the API call
        message = client.messages.create(**request_params)

        # Extract content from response
        if message.content and len(message.content) > 0:
            return message.content[0].text
        return ""

    async def a_generate(self, prompt: str) -> str:
        """
        Async generate text using Anthropic Vertex AI

        Args:
            prompt: The prompt to send to the model

        Returns:
            Generated text response
        """
        # Anthropic SDK doesn't have async support yet, so we use sync version
        # This is acceptable as DeepEval will handle async wrapping
        return self.generate(prompt)

    def get_model_name(self) -> str:
        """Return the model name"""
        return self._model_name
