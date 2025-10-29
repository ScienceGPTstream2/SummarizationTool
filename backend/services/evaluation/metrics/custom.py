"""Custom metric factory for domain-specific evaluation"""

from typing import List, Optional
from deepeval.metrics import GEval
from deepeval.test_case import LLMTestCaseParams


class CustomMetricFactory:
    """Factory for creating custom G-Eval metrics"""

    @staticmethod
    def create(
        name: str,
        evaluation_steps: List[str],
        model,
        evaluation_params: Optional[List[LLMTestCaseParams]] = None,
        threshold: float = 0.5,
        strict_mode: bool = False,
    ) -> GEval:
        """
        Create a custom G-Eval metric with user-defined criteria

        Allows creation of domain-specific metrics for specialized evaluation needs.

        Args:
            name: Name of the metric
            evaluation_steps: List of evaluation steps
            model: DeepEval model for evaluation
            evaluation_params: Parameters to use (default: INPUT, ACTUAL_OUTPUT, EXPECTED_OUTPUT)
            threshold: Score threshold for passing
            strict_mode: If True, only perfect scores pass

        Returns:
            GEval metric instance

        Example:
            >>> custom_metric = CustomMetricFactory.create(
            ...     name="Toxicology Accuracy",
            ...     evaluation_steps=[
            ...         "Verify chemical compound names are correct",
            ...         "Check dosage amounts and units",
            ...         "Ensure NOAEL/LOAEL values are accurate"
            ...     ],
            ...     model=eval_model,
            ...     threshold=0.8
            ... )
        """
        if evaluation_params is None:
            evaluation_params = [
                LLMTestCaseParams.INPUT,
                LLMTestCaseParams.ACTUAL_OUTPUT,
                LLMTestCaseParams.EXPECTED_OUTPUT,
            ]

        return GEval(
            name=name,
            evaluation_steps=evaluation_steps,
            evaluation_params=evaluation_params,
            model=model,
            threshold=threshold,
            strict_mode=strict_mode,
            async_mode=True,
            verbose_mode=False,
        )

    @staticmethod
    def get_description() -> str:
        """Get metric description"""
        return "Create custom evaluation metrics with user-defined criteria"
