"""Relevance metric for entity extraction evaluation"""

from typing import List, Optional
from deepeval.metrics import GEval
from deepeval.test_case import LLMTestCaseParams


class RelevanceMetricFactory:
    """Factory for creating Relevance evaluation metrics"""

    @staticmethod
    def create(
        model,
        threshold: float = 0.5,
        strict_mode: bool = False,
        custom_steps: Optional[List[str]] = None,
    ) -> GEval:
        """
        Create a relevance evaluation metric for entity extraction

        Evaluates whether extraction stays focused on requested entities (referenceless).

        Args:
            model: DeepEval model for evaluation
            threshold: Score threshold for passing
            strict_mode: If True, only perfect scores pass
            custom_steps: Custom evaluation steps (optional)

        Returns:
            GEval metric instance
        """
        default_steps = [
            "Check if 'actual output' directly addresses the extraction task in 'input'",
            "Ensure all extracted information is relevant to the requested entities",
            "Penalize inclusion of irrelevant or tangential information",
            "Verify that the extraction stays focused on the specified criteria",
        ]

        return GEval(
            name="Entity Extraction Relevance",
            evaluation_steps=custom_steps or default_steps,
            evaluation_params=[
                LLMTestCaseParams.INPUT,
                LLMTestCaseParams.ACTUAL_OUTPUT,
            ],
            model=model,
            threshold=threshold,
            strict_mode=strict_mode,
            async_mode=True,
            verbose_mode=False,
        )

    @staticmethod
    def get_required_params() -> List[str]:
        """Get list of required LLMTestCase parameters"""
        return ["input", "actual_output"]

    @staticmethod
    def get_description() -> str:
        """Get metric description"""
        return "Evaluates whether extraction stays focused on requested entities"
