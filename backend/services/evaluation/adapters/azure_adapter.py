"""
Custom Azure OpenAI adapter for DeepEval using LangChain
This follows the official DeepEval documentation pattern
"""

import os
from typing import Optional
from deepeval.models.base_model import DeepEvalBaseLLM
from langchain_openai import AzureChatOpenAI


class AzureOpenAIDeepEvalModel(DeepEvalBaseLLM):
    """
    Custom DeepEval model adapter for Azure OpenAI using LangChain
    Follows official DeepEval documentation pattern for Azure OpenAI
    """

    def __init__(
        self,
        deployment: Optional[str] = None,
        endpoint: Optional[str] = None,
        api_key: Optional[str] = None,
        api_version: Optional[str] = None,
        model_name: Optional[str] = None,
        temperature: Optional[float] = None,
        max_tokens: int = 2048,
    ):
        """
        Initialize Azure OpenAI adapter for DeepEval

        Args:
            deployment: Azure deployment name
            endpoint: Azure OpenAI endpoint
            api_key: Azure OpenAI API key
            api_version: API version
            model_name: Model name (for display purposes)
            temperature: Temperature for generation (None = use model default, typically 1.0 for GPT-5 Mini)
            max_tokens: Max tokens for generation (default 2048)
        """
        self.deployment = (
            deployment
            or os.getenv("AZURE_OPENAI_DEPLOYMENT")
            or os.getenv("AZURE_OPENAI_MODEL_NAME")
        )
        self.endpoint = endpoint or os.getenv("AZURE_OPENAI_ENDPOINT")
        self.api_key = api_key or os.getenv("AZURE_OPENAI_KEY")
        self.api_version = api_version or os.getenv(
            "AZURE_OPENAI_API_VERSION", "2024-12-01-preview"
        )
        self._model_name = model_name or os.getenv(
            "AZURE_OPENAI_MODEL_NAME", "gpt-5-mini"
        )
        self.temperature = temperature
        self.max_tokens = max_tokens

        if not self.endpoint or not self.api_key or not self.deployment:
            raise ValueError(
                "Azure OpenAI endpoint, api_key, and deployment must be provided"
            )

        # Initialize LangChain Azure ChatOpenAI
        # Note: GPT-5 Mini only supports default temperature (1.0), so we omit it if not specified
        model_kwargs = {
            "openai_api_version": self.api_version,
            "azure_deployment": self.deployment,
            "azure_endpoint": self.endpoint,
            "openai_api_key": self.api_key,
            "max_tokens": self.max_tokens,
        }

        # Only set temperature if explicitly provided
        if self.temperature is not None:
            model_kwargs["temperature"] = self.temperature

        self.model = AzureChatOpenAI(**model_kwargs)

    def load_model(self):
        """Load the LangChain model"""
        return self.model

    def generate(self, prompt: str) -> str:
        """
        Generate text using Azure OpenAI via LangChain

        Args:
            prompt: The prompt to send to the model

        Returns:
            Generated text response
        """
        chat_model = self.load_model()
        return chat_model.invoke(prompt).content

    async def a_generate(self, prompt: str) -> str:
        """
        Async generate text using Azure OpenAI via LangChain

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
