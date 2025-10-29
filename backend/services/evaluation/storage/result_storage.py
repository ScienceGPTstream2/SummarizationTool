"""Storage handler for evaluation results"""

import json
import aiofiles
from pathlib import Path
from typing import Dict, Any, List, Optional


class EvaluationResultStorage:
    """Handles storage and retrieval of evaluation results"""

    def __init__(self, output_dir: Optional[str] = None):
        """
        Initialize result storage

        Args:
            output_dir: Directory to store evaluation results
        """
        # Base path is backend/
        base_path = Path(__file__).resolve().parents[3]
        self.output_dir = (
            Path(output_dir) if output_dir else base_path / "output" / "evaluations"
        )
        self.output_dir.mkdir(parents=True, exist_ok=True)

    async def save(self, evaluation_id: str, result: Dict[str, Any]) -> None:
        """
        Save evaluation result to disk

        Args:
            evaluation_id: Unique evaluation identifier
            result: Evaluation result dictionary
        """
        result_path = self.output_dir / f"{evaluation_id}.json"
        async with aiofiles.open(result_path, "w", encoding="utf-8") as f:
            await f.write(json.dumps(result, indent=2))

    async def get(self, evaluation_id: str) -> Optional[Dict[str, Any]]:
        """
        Retrieve evaluation result by ID

        Args:
            evaluation_id: Unique evaluation identifier

        Returns:
            Evaluation result dictionary or None if not found
        """
        result_path = self.output_dir / f"{evaluation_id}.json"
        if not result_path.exists():
            return None

        try:
            async with aiofiles.open(result_path, "r", encoding="utf-8") as f:
                content = await f.read()
                return json.loads(content)
        except Exception:
            return None

    async def list_all(self) -> List[Dict[str, Any]]:
        """
        List all evaluation results

        Returns:
            List of evaluation result dictionaries, sorted by timestamp (newest first)
        """
        evaluations = []
        for result_file in self.output_dir.glob("*.json"):
            try:
                async with aiofiles.open(result_file, "r", encoding="utf-8") as f:
                    content = await f.read()
                    evaluation = json.loads(content)
                    evaluations.append(evaluation)
            except Exception:
                continue

        return sorted(evaluations, key=lambda x: x.get("timestamp", ""), reverse=True)

    async def delete(self, evaluation_id: str) -> bool:
        """
        Delete an evaluation result

        Args:
            evaluation_id: Unique evaluation identifier

        Returns:
            True if deleted, False if not found
        """
        result_path = self.output_dir / f"{evaluation_id}.json"
        if not result_path.exists():
            return False

        try:
            result_path.unlink()
            return True
        except Exception:
            return False

    def get_storage_path(self) -> Path:
        """Get the storage directory path"""
        return self.output_dir
