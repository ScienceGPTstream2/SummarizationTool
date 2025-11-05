"""
Custom Vertex AI (Gemini) adapter for DeepEval using LangChain
This follows the official DeepEval documentation pattern with safety settings
"""

import os
from typing import Optional
from deepeval.models.base_model import DeepEvalBaseLLM
from langchain_google_vertexai import (
    ChatVertexAI,
    HarmBlockThreshold,
    HarmCategory,
)


class VertexAIDeepEvalModel(DeepEvalBaseLLM):
    """
    Custom DeepEval model adapter for Vertex AI using LangChain
    Follows official DeepEval documentation pattern for Google Vertex AI

    Includes safety settings to ensure evaluation responses are not blocked
    """

    def __init__(
        self,
        model_name: str = "gemini-2.0-flash-exp",
        project: Optional[str] = None,
        location: Optional[str] = None,
        temperature: Optional[float] = None,
        max_output_tokens: int = 2048,
    ):
        """
        Initialize Vertex AI adapter for DeepEval

        Args:
            model_name: Gemini model name (e.g., 'gemini-2.0-flash-exp', 'gemini-1.5-pro')
            project: GCP project ID
            location: GCP location (e.g., 'us-central1')
            temperature: Temperature for generation (None = use model default)
            max_output_tokens: Max tokens for generation (default 2048)
        """
        self._model_name = model_name
        self.project = project or os.getenv("GEMINI_PROJECT")
        self.location = location or os.getenv("GEMINI_LOCATION", "us-central1")
        self.temperature = temperature

        if not self.project:
            raise ValueError(
                "GCP project must be provided or set via GEMINI_PROJECT env var"
            )

        # Initialize safety filters for vertex model
        # This is CRITICAL to ensure no evaluation responses are blocked
        # As per official DeepEval documentation
        safety_settings = {
            HarmCategory.HARM_CATEGORY_UNSPECIFIED: HarmBlockThreshold.BLOCK_NONE,
            HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT: HarmBlockThreshold.BLOCK_NONE,
            HarmCategory.HARM_CATEGORY_HATE_SPEECH: HarmBlockThreshold.BLOCK_NONE,
            HarmCategory.HARM_CATEGORY_HARASSMENT: HarmBlockThreshold.BLOCK_NONE,
            HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT: HarmBlockThreshold.BLOCK_NONE,
        }

        # Initialize LangChain ChatVertexAI
        model_kwargs = {
            "model_name": model_name,
            "safety_settings": safety_settings,
            "project": self.project,
            "location": self.location,
            "max_output_tokens": max_output_tokens,
        }

        # Only set temperature if explicitly provided
        if self.temperature is not None:
            model_kwargs["temperature"] = self.temperature

        self.model = ChatVertexAI(**model_kwargs)

    def load_model(self):
        """Load the LangChain model"""
        return self.model

    def generate(self, prompt: str) -> str:
        """
        Generate text using Vertex AI via LangChain

        Args:
            prompt: The prompt to send to the model

        Returns:
            Generated text response
        """
        chat_model = self.load_model()
        return chat_model.invoke(prompt).content

    async def a_generate(self, prompt: str) -> str:
        """
        Async generate text using Vertex AI via LangChain

        Args:
            prompt: The prompt to send to the model

        Returns:
            Generated text response
        """
        chat_model = self.load_model()
        res = await chat_model.ainvoke(prompt)
        return res.content

    def get_model_name(self) -> str:
        """Return the model name"""
        return self._model_name
