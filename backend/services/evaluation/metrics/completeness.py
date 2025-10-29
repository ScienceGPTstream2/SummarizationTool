"""Completeness metric for entity extraction evaluation"""

from typing import List, Optional
from deepeval.metrics import GEval
from deepeval.test_case import LLMTestCaseParams


class CompletenessMetricFactory:
    """Factory for creating Completeness evaluation metrics"""

    @staticmethod
    def create(
        model,
        threshold: float = 0.5,
        strict_mode: bool = False,
        custom_steps: Optional[List[str]] = None,
    ) -> GEval:
        """
        Create a completeness evaluation metric for entity extraction

        Evaluates whether all key information is extracted.

        Args:
            model: DeepEval model for evaluation
            threshold: Score threshold for passing
            strict_mode: If True, only perfect scores pass
            custom_steps: Custom evaluation steps (optional)

        Returns:
            GEval metric instance
        """
        default_steps = [
            "Identify all key information elements expected in 'expected output'",
            "Check if 'actual output' includes all these key elements",
            "Penalize missing information more heavily than extra information",
            "Minor details missing are acceptable, but critical facts must be present",
        ]

        return GEval(
            name="Entity Extraction Completeness",
            evaluation_steps=custom_steps or default_steps,
            evaluation_params=[
                LLMTestCaseParams.ACTUAL_OUTPUT,
                LLMTestCaseParams.EXPECTED_OUTPUT,
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
        return ["actual_output", "expected_output"]

    @staticmethod
    def get_description() -> str:
        """Get metric description"""
        return "Evaluates whether all key information is extracted"
