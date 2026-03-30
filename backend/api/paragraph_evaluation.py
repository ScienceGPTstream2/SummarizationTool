"""API endpoint for creating and managing paragraph evaluation records (human-only scoring)."""

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import List, Optional, Dict, Any

from core.auth import get_current_user
from services.database import get_db_service

router = APIRouter(prefix="/api/paragraph-evaluation", tags=["paragraph_evaluation"])

# Sentinel constants — these identify paragraph eval records in evaluation_results
PARAGRAPH_EVAL_METRIC = "paragraph_human_eval"
PARAGRAPH_EVAL_JUDGE = "human"


def build_paragraph_ground_truth(entities: List[Dict[str, Any]]) -> str:
    """
    Build a deterministic ground truth paragraph from extracted entities.

    Input: list of dicts with 'name' and 'extracted_text' keys, in session-config order.
    Output: multi-line string, one entity per line.

    Rules:
    - Entity order is preserved as passed in (caller must pass in session-config order)
    - Entities with null/empty extracted_text are skipped entirely
    - Values are NOT reworded — exact extracted text preserved, only strip whitespace
    - Format mirrors paragraph generator input: **EntityName**: extracted_text
    - Lines are joined with newlines
    """
    lines = []
    for entity in entities:
        name = (entity.get("name") or "").strip()
        value = (entity.get("extracted_text") or "").strip()
        if name and value:
            lines.append(f"**{name}**: {value}")
    return "\n".join(lines)


class ParagraphEvalGenerateRequest(BaseModel):
    session_id: str
    file_hash: str
    user_id: Optional[str] = None  # resolved from auth token; not required in body
    entity_order: Optional[List[str]] = None  # Ordered entity names from session config


@router.post("/generate", dependencies=[Depends(get_current_user)])
async def generate_paragraph_evaluation(
    request: ParagraphEvalGenerateRequest,
    user: Dict = Depends(get_current_user),
):
    """
    Create or update a paragraph evaluation record with deterministic ground truth.

    This endpoint:
    1. Finds the __paragraph_summary__ extraction result for the given document
    2. Fetches all other entity extraction results for the same document
    3. Sorts them by entity_order (session config order) if provided
    4. Builds a deterministic ground truth string
    5. Upserts an evaluation_result record with metric='paragraph_human_eval', judge_model='human'

    No LLM is called. Ground truth is built purely from extracted entity values.
    """
    db = get_db_service()

    # 1. Find the document by file_hash within this session
    documents = db.get_documents_by_session(request.session_id)
    document = next(
        (d for d in documents if d.get("file_hash") == request.file_hash), None
    )
    if not document:
        raise HTTPException(
            status_code=404,
            detail=f"Document with file_hash '{request.file_hash}' not found in session '{request.session_id}'",
        )

    document_id = document["id"]

    # 2. Get all extraction results for this document
    all_extractions = db.get_extraction_results_by_document(document_id)

    # 3. Separate paragraph summary from entity extractions
    paragraph_extraction = next(
        (e for e in all_extractions if e.get("entity_name") == "__paragraph_summary__"),
        None,
    )

    if not paragraph_extraction:
        raise HTTPException(
            status_code=404,
            detail="No paragraph summary found for this document. Generate a paragraph first.",
        )

    paragraph_extraction_id = paragraph_extraction["id"]

    # Filter out paragraph summary and failed extractions from entity list
    entity_extractions = [
        e
        for e in all_extractions
        if e.get("entity_name") != "__paragraph_summary__"
        and e.get("status") == "completed"
        and e.get("extracted_text")
    ]

    # 4. Sort by entity_order if provided, otherwise alphabetically
    if request.entity_order:
        order_map = {name: idx for idx, name in enumerate(request.entity_order)}
        entity_extractions.sort(
            key=lambda e: order_map.get(e["entity_name"], len(request.entity_order))
        )
    else:
        entity_extractions.sort(key=lambda e: e["entity_name"])

    # 4b. Deduplicate: keep first extraction per entity_name (preserving sort order)
    seen_names: set = set()
    deduped = []
    for e in entity_extractions:
        if e["entity_name"] not in seen_names:
            seen_names.add(e["entity_name"])
            deduped.append(e)
    entity_extractions = deduped

    # 5. Build deterministic ground truth
    entities_for_gt = [
        {"name": e["entity_name"], "extracted_text": e["extracted_text"]}
        for e in entity_extractions
    ]
    ground_truth = build_paragraph_ground_truth(entities_for_gt)

    if not ground_truth:
        raise HTTPException(
            status_code=422,
            detail="No non-empty entity extractions found to build ground truth from.",
        )

    # 6. Upsert evaluation_result record (no LLM score, human-only)
    existing = db.get_evaluation_results_by_extraction(paragraph_extraction_id)
    existing_record = next(
        (
            r
            for r in existing
            if r.get("metric") == PARAGRAPH_EVAL_METRIC
            and r.get("judge_model") == PARAGRAPH_EVAL_JUDGE
        ),
        None,
    )

    db.upsert_evaluation_result(
        extraction_result_id=paragraph_extraction_id,
        metric=PARAGRAPH_EVAL_METRIC,
        judge_model=PARAGRAPH_EVAL_JUDGE,
        score=None,
        reasoning=None,
        human_score=existing_record.get("human_score") if existing_record else None,
        ground_truth=ground_truth,
    )

    status = "updated" if existing_record else "created"
    print(
        f"[ParagraphEval] {status} eval record for document {document_id}, "
        f"ground_truth length={len(ground_truth)}"
    )

    return {
        "ground_truth": ground_truth,
        "status": status,
        "paragraph_model_id": paragraph_extraction.get("model_id", ""),
    }
