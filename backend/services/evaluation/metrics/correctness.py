"""Correctness metric for entity extraction evaluation"""

from typing import List, Optional
from deepeval.metrics import GEval
from deepeval.test_case import LLMTestCaseParams


class CorrectnessMetricFactory:
    """Factory for creating Correctness evaluation metrics"""

    @staticmethod
    def create(
        model,
        threshold: float = 0.5,
        strict_mode: bool = False,
        custom_steps: Optional[List[str]] = None,
    ) -> GEval:
        """
        Create a correctness evaluation metric for entity extraction

        Evaluates factual accuracy by comparing actual output with expected output.

        Args:
            model: DeepEval model for evaluation
            threshold: Score threshold for passing (0-1)
            strict_mode: If True, only perfect scores pass
            custom_steps: Custom evaluation steps (optional)

        Returns:
            GEval metric instance
        """
        default_steps = [
            "Check whether the facts in 'actual output' contradicts any facts in 'expected output'",
            "Heavily penalize omission of critical details or factual inaccuracies",
            "Vague language is acceptable only if it matches the expected output's level of specificity",
            "Minor formatting differences are acceptable if the content is correct",
        ]

        return GEval(
            name="Entity Extraction Correctness",
            evaluation_steps=custom_steps or default_steps,
            evaluation_params=[
                LLMTestCaseParams.INPUT,
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
        return ["input", "actual_output", "expected_output"]

    @staticmethod
    def get_description() -> str:
        """Get metric description"""
        return "Evaluates factual accuracy of extracted entities compared to expected output"
