"""Document processing API endpoints"""

from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import JSONResponse, FileResponse
from pathlib import Path
from typing import Dict, Any, List

from core.dependencies import get_current_user
from schemas.documents import ProcessFileRequest
from services.document.file_service import FileService
from services.document.document_service import DocumentService
from services.document.bbox_normalizer import normalize_bbox_format

router = APIRouter(prefix="/api/documents", tags=["documents"])

# Initialize services
file_service = FileService()
document_service = DocumentService()


def camel_to_snake_case(name: str) -> str:
    """Convert camelCase to snake_case"""
    import re

    # Insert underscore before capital letters and convert to lowercase
    s1 = re.sub("(.)([A-Z][a-z]+)", r"\1_\2", name)
    return re.sub("([a-z0-9])([A-Z])", r"\1_\2", s1).lower()


def transform_keys_to_snake_case(data: Any) -> Any:
    """
    Recursively transform all dictionary keys from camelCase to snake_case.
    This ensures frontend compatibility with Azure Document Intelligence responses.
    """
    if isinstance(data, dict):
        return {
            camel_to_snake_case(k): transform_keys_to_snake_case(v)
            for k, v in data.items()
        }
    elif isinstance(data, list):
        return [transform_keys_to_snake_case(item) for item in data]
    else:
        return data


@router.post("/process/file/{file_id}", dependencies=[Depends(get_current_user)])
async def process_uploaded_file(
    file_id: str, request: ProcessFileRequest = ProcessFileRequest()
):
    """
    Process an uploaded file to markdown using specified or auto-selected processor
    """
    try:
        # Get file info
        file_info = await file_service.get_file_by_id(file_id)
        if not file_info:
            raise HTTPException(status_code=404, detail="File not found")

        # Convert file to markdown using user-selected processor
        file_path = file_info["file_path"]
        result = await document_service.convert_document_to_markdown(
            file_path,
            "file",
            processor=request.processor,
            extract_figures=request.extract_figures,
        )

        if not result["success"]:
            raise HTTPException(
                status_code=500, detail=f"Conversion failed: {result['error']}"
            )

        # Build response with available metadata
        response_content = {
            "message": "Document processed successfully",
            "conversion_id": result["conversion_id"],
            "markdown_path": result["markdown_path"],
            "content_length": result["metadata"]["content_length"],
            "conversion_time": result["metadata"]["conversion_time"],
            "processor_used": result.get("processor_used", "unknown"),
            "processor_fallback": result.get("processor_fallback", False),
            "fallback_reason": result.get("fallback_reason"),
        }

        # Include figures information if available
        if "figures_found" in result["metadata"]:
            response_content["figures_found"] = result["metadata"]["figures_found"]
            response_content["figures"] = result["metadata"].get("figures", [])

        # Include tables information if available
        if "tables_found" in result["metadata"]:
            response_content["tables_found"] = result["metadata"]["tables_found"]

        return JSONResponse(status_code=200, content=response_content)

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error converting file: {str(e)}")


@router.get("/{document_id}/content", dependencies=[Depends(get_current_user)])
async def get_document_content(document_id: str, processor_used: str = None):
    """
    Get the processed markdown content of a document

    Args:
        document_id: The document/conversion ID
        processor_used: Optional processor that was used (improves efficiency)
    """
    try:
        markdown_content = await document_service.get_markdown_content(
            document_id, processor_used
        )
        if markdown_content is None:
            raise HTTPException(
                status_code=404, detail="Document processing not found or failed"
            )

        return JSONResponse(
            status_code=200,
            content={"document_id": document_id, "markdown_content": markdown_content},
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error retrieving document content: {str(e)}"
        )


@router.get("/{document_id}/figures", dependencies=[Depends(get_current_user)])
async def get_document_figures(document_id: str):
    """
    Get all figures metadata for a document processed with Azure Document Intelligence

    Args:
        document_id: The document/conversion ID

    Returns:
        List of figure metadata including captions, bounding regions, and image paths
    """
    try:
        figures = await document_service.get_figures_for_conversion(document_id)

        if figures is None:
            raise HTTPException(
                status_code=404,
                detail="No figures found. Document may not exist or was not processed with Azure Document Intelligence.",
            )

        return JSONResponse(
            status_code=200,
            content={
                "document_id": document_id,
                "figures_count": len(figures),
                "figures": figures,
            },
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error retrieving document figures: {str(e)}"
        )


@router.get("/{document_id}/analysis", dependencies=[Depends(get_current_user)])
async def get_document_analysis(document_id: str):
    """
    Get the complete raw analysis result with ALL bounding boxes

    This endpoint works for documents processed with either Azure Document Intelligence or Docling.

    Azure Document Intelligence returns:
    - All pages with words, lines, and their bounding polygons
    - All paragraphs with bounding regions and roles (title, sectionHeading, etc.)
    - All tables with cells and bounding boxes
    - All figures with bounding regions and captions
    - All selection marks (checkboxes) with bounding boxes
    - All sections and structural information

    Docling returns:
    - All pages with dimensions
    - All text items (paragraphs) with bounding regions and roles
    - All tables with cells and bounding boxes
    - All pictures/figures with bounding regions and captions
    - Document structure (body, furniture, groups)

    Note: Azure DI field names are transformed from camelCase to snake_case for frontend compatibility.
    Docling already uses snake_case.

    Args:
        document_id: The document/conversion ID

    Returns:
        Complete analysis result with all bounding box data
        The response includes a "processor" field to identify the source (azure_doc_intelligence or docling)
    """
    try:
        analysis_result = await document_service.get_raw_analysis_result(document_id)

        if analysis_result is None:
            raise HTTPException(
                status_code=404,
                detail="Analysis result not found. Document may not exist or was not processed yet.",
            )

        # Normalize both formats to a consistent structure for frontend
        # This ensures both Docling and Azure DI have:
        # - Same field names (snake_case)
        # - Same units (points)
        # - Same structure
        normalized_result = normalize_bbox_format(analysis_result)

        # Ensure processor field is always present in the result
        processor = normalized_result.get("processor", "unknown")

        return JSONResponse(
            status_code=200,
            content={
                "document_id": document_id,
                "processor": processor,
                "analysis_result": normalized_result,
            },
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error retrieving document analysis: {str(e)}"
        )


@router.get(
    "/{document_id}/figures/{figure_filename}", dependencies=[Depends(get_current_user)]
)
async def get_figure_image(document_id: str, figure_filename: str):
    """
    Serve a specific figure image file

    Args:
        document_id: The document/conversion ID
        figure_filename: The figure filename (e.g., "1.1.png" or "table-1.png")

    Returns:
        The image file
    """
    try:
        base_path = Path(__file__).resolve().parents[2]

        # Try unified output directory structure for both processors
        # Priority: output/docling -> output/azure_doc_intelligence -> legacy (backward compatibility)
        possible_paths = [
            base_path
            / "output"
            / "docling"
            / document_id
            / "figures"
            / figure_filename,
            base_path
            / "output"
            / "azure_doc_intelligence"
            / document_id
            / "figures"
            / figure_filename,
            # Legacy paths for backward compatibility
            base_path
            / "markdown_output"
            / "docling"
            / document_id
            / "figures"
            / figure_filename,
            base_path
            / "markdown_output"
            / "azure_doc_intelligence"
            / document_id
            / "figures"
            / figure_filename,
            base_path / "markdown_output" / document_id / "figures" / figure_filename,
        ]

        print(f"[FIGURE] Attempting to serve figure: {document_id}/{figure_filename}")

        figure_path = None
        for path in possible_paths:
            print(f"[FIGURE] Checking path: {path.absolute()}")
            if path.exists():
                figure_path = path
                print(f"[FIGURE] ✅ Found at: {path}")
                break

        if not figure_path:
            print(f"[FIGURE] File not found in any location")
            raise HTTPException(
                status_code=404, detail=f"Figure image not found: {figure_filename}"
            )

        # Security check: ensure the file is within the expected output or markdown_output directory
        output_dir = base_path / "output"
        markdown_output_dir = base_path / "markdown_output"
        if not (
            figure_path.is_relative_to(output_dir)
            or figure_path.is_relative_to(markdown_output_dir)
        ):
            print(
                f"[FIGURE] Security check failed - path not within output or markdown_output directory"
            )
            raise HTTPException(status_code=403, detail="Access denied")

        print(f"[FIGURE] ✅ Serving figure: {figure_filename}")

        # Return the image file
        return FileResponse(
            path=str(figure_path), media_type="image/png", filename=figure_filename
        )

    except HTTPException:
        raise
    except Exception as e:
        print(f"[FIGURE] Error: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Error retrieving figure image: {str(e)}"
        )


@router.get(
    "/{document_id}/tables/{table_filename}", dependencies=[Depends(get_current_user)]
)
async def get_table_html(document_id: str, table_filename: str):
    """
    Serve a specific table HTML file

    Args:
        document_id: The document/conversion ID
        table_filename: The table filename (e.g., "table-1.html")

    Returns:
        The table HTML file
    """
    try:
        base_path = Path(__file__).resolve().parents[2]

        # Try unified output directory structure for both processors
        possible_paths = [
            base_path / "output" / "docling" / document_id / "tables" / table_filename,
            base_path
            / "output"
            / "azure_doc_intelligence"
            / document_id
            / "tables"
            / table_filename,
        ]

        print(f"[TABLE] Attempting to serve table: {document_id}/{table_filename}")

        table_path = None
        for path in possible_paths:
            print(f"[TABLE] Checking path: {path}")
            if path.exists():
                table_path = path
                print(f"[TABLE] ✅ Found at: {path}")
                break

        if not table_path:
            print(f"[TABLE] File not found in any location")
            raise HTTPException(
                status_code=404, detail=f"Table file not found: {table_filename}"
            )

        # Security check: ensure the file is within the expected output directory
        output_dir = base_path / "output"
        if not table_path.is_relative_to(output_dir):
            print(f"[TABLE] Security check failed - path not within output directory")
            raise HTTPException(status_code=403, detail="Access denied")

        print(f"[TABLE] ✅ Serving table: {table_filename}")

        # Return the HTML file
        return FileResponse(
            path=str(table_path), media_type="text/html", filename=table_filename
        )

    except HTTPException:
        raise
    except Exception as e:
        print(f"[TABLE] Error: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Error retrieving table file: {str(e)}"
        )
