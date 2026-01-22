"""Document processing API endpoints"""

from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import JSONResponse, FileResponse
from pathlib import Path
from typing import Dict, Any, List

from core.dependencies import get_current_user
from schemas.documents import ProcessFileRequest
from services.document import get_organized_file_service
from services.document.document_service import DocumentService
from services.document.bbox_normalizer import normalize_bbox_format

router = APIRouter(prefix="/api/documents", tags=["documents"])

# Initialize services
file_service = get_organized_file_service()
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
    Process an uploaded file to markdown using specified or auto-selected processor.
    
    If the file has already been processed with the same processor, returns cached results.
    
    Args:
        file_id: Can be either file_hash (new) or legacy file_id
    """
    try:
        # file_id is now the file_hash in the new system
        file_hash = file_id
        
        # Get file path from organized file service
        file_path = await file_service.get_original_file_path(file_hash)
        if not file_path:
            raise HTTPException(status_code=404, detail="File not found")

        # Get processor name
        processor_name = request.processor if hasattr(request, 'processor') else "azure_doc_intelligence"
        
        # Check if already processed with this processor (CACHE CHECK)
        is_processed = await file_service.is_file_processed(file_hash, processor_name)
        output_dir = file_service.get_processing_output_path(file_hash, processor_name)
        
        if is_processed:
            # Return cached results
            print(f"[PROCESS] ✅ Using cached results for {file_hash} ({processor_name})")
            
            # Read cached metadata and content
            import json
            import aiofiles
            
            metadata_path = output_dir / "metadata.json"
            markdown_path = output_dir / "document.md"
            
            cached_metadata = {}
            markdown_content_length = 0
            
            if metadata_path.exists():
                async with aiofiles.open(metadata_path, 'r') as f:
                    cached_metadata = json.loads(await f.read())
            
            if markdown_path.exists():
                async with aiofiles.open(markdown_path, 'r') as f:
                    markdown_content_length = len(await f.read())
            
            return JSONResponse(status_code=200, content={
                "message": "Document already processed (cached)",
                "conversion_id": cached_metadata.get("conversion_id", file_hash),
                "file_hash": file_hash,
                "markdown_path": str(markdown_path),
                "content_length": markdown_content_length,
                "conversion_time": cached_metadata.get("conversion_time", "cached"),
                "processor_used": processor_name,
                "cached": True,
                "figures_found": cached_metadata.get("figures_found", 0),
                "figures": cached_metadata.get("figures", []),
                "tables_found": cached_metadata.get("tables_found", 0),
            })
        
        # Not cached, process the file
        print(f"[PROCESS] Processing {file_hash} -> {output_dir}")

        # Convert file to markdown, saving directly to organized structure
        result = await document_service.convert_document_to_markdown(
            str(file_path),
            "file",
            processor=request.processor,
            extract_figures=request.extract_figures,
            output_dir=output_dir,  # Direct output to organized structure
        )

        if not result["success"]:
            raise HTTPException(
                status_code=500, detail=f"Conversion failed: {result['error']}"
            )

        processor_used = result.get("processor_used", processor_name)
        print(f"[PROCESS] ✅ Saved directly to organized structure: {output_dir}")

        # Build response with available metadata
        response_content = {
            "message": "Document processed successfully",
            "conversion_id": result["conversion_id"],
            "file_hash": file_hash,  # Include file_hash for frontend
            "markdown_path": result["markdown_path"],
            "content_length": result["metadata"]["content_length"],
            "conversion_time": result["metadata"]["conversion_time"],
            "processor_used": processor_used,
            "processor_fallback": result.get("processor_fallback", False),
            "fallback_reason": result.get("fallback_reason"),
            "cached": False,
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
        document_id: The file_hash
        processor_used: Optional processor that was used (improves efficiency)
    """
    try:
        import aiofiles
        
        # Check organized file structure
        processors_to_check = [processor_used] if processor_used else ["azure_doc_intelligence", "docling"]
        
        for proc in processors_to_check:
            if proc is None:
                continue
            output_dir = file_service.get_processing_output_path(document_id, proc)
            markdown_path = output_dir / "document.md"
            
            if markdown_path.exists():
                async with aiofiles.open(markdown_path, 'r', encoding='utf-8') as f:
                    markdown_content = await f.read()
                
                return JSONResponse(
                    status_code=200,
                    content={"document_id": document_id, "markdown_content": markdown_content},
                )
        
        raise HTTPException(
            status_code=404, detail="Document processing not found"
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
        import json
        import aiofiles
        
        # Check organized file structure
        processors_to_check = ["azure_doc_intelligence", "docling"]
        analysis_result = None
        
        for proc in processors_to_check:
            output_dir = file_service.get_processing_output_path(document_id, proc)
            raw_analysis_path = output_dir / "raw_analysis.json"
            
            if raw_analysis_path.exists():
                async with aiofiles.open(raw_analysis_path, 'r', encoding='utf-8') as f:
                    analysis_result = json.loads(await f.read())
                break

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

        # Organized file structure only (file_hash based)
        possible_paths = [
            file_service.get_processing_output_path(document_id, "azure_doc_intelligence") / "figures" / figure_filename,
            file_service.get_processing_output_path(document_id, "docling") / "figures" / figure_filename,
        ]

        print(f"[FIGURE] Attempting to serve figure: {document_id}/{figure_filename}")

        figure_path = None
        for path in possible_paths:
            if path.exists():
                figure_path = path
                print(f"[FIGURE] ✅ Found at: {path}")
                break

        if not figure_path:
            print(f"[FIGURE] File not found")
            raise HTTPException(
                status_code=404, detail=f"Figure image not found: {figure_filename}"
            )

        # Security check: ensure the file is within the files directory
        files_dir = base_path / "files"
        if not figure_path.is_relative_to(files_dir):
            print(f"[FIGURE] Security check failed")
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

        # Try organized file structure first (new), then output directories
        # Organized file structure only (file_hash based)
        possible_paths = [
            file_service.get_processing_output_path(document_id, "azure_doc_intelligence") / "tables" / table_filename,
            file_service.get_processing_output_path(document_id, "docling") / "tables" / table_filename,
        ]

        print(f"[TABLE] Attempting to serve table: {document_id}/{table_filename}")

        table_path = None
        for path in possible_paths:
            if path.exists():
                table_path = path
                print(f"[TABLE] ✅ Found at: {path}")
                break

        if not table_path:
            print(f"[TABLE] File not found")
            raise HTTPException(
                status_code=404, detail=f"Table file not found: {table_filename}"
            )

        # Security check: ensure the file is within the files directory
        files_dir = base_path / "files"
        if not table_path.is_relative_to(files_dir):
            print(f"[TABLE] Security check failed")
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
