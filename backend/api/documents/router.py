"""Document processing API endpoints"""
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import JSONResponse, FileResponse
from pathlib import Path

from core.dependencies import get_current_user
from schemas.documents import ProcessFileRequest
from services.document.file_service import FileService
from services.document.document_service import DocumentService

router = APIRouter(prefix="/api/documents", tags=["documents"])

# Initialize services
file_service = FileService()
document_service = DocumentService()

@router.post("/process/file/{file_id}", dependencies=[Depends(get_current_user)])
async def process_uploaded_file(file_id: str, request: ProcessFileRequest = ProcessFileRequest()):
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
            extract_figures=request.extract_figures
        )
        
        if not result["success"]:
            raise HTTPException(status_code=500, detail=f"Conversion failed: {result['error']}")
        
        # Build response with available metadata
        response_content = {
            "message": "Document processed successfully",
            "conversion_id": result["conversion_id"],
            "markdown_path": result["markdown_path"],
            "content_length": result["metadata"]["content_length"],
            "conversion_time": result["metadata"]["conversion_time"],
            "processor_used": result.get("processor_used", "unknown"),
            "processor_fallback": result.get("processor_fallback", False),
            "fallback_reason": result.get("fallback_reason")
        }
        
        # Include figures information if available
        if "figures_found" in result["metadata"]:
            response_content["figures_found"] = result["metadata"]["figures_found"]
            response_content["figures"] = result["metadata"].get("figures", [])
        
        return JSONResponse(
            status_code=200,
            content=response_content
        )
        
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
        markdown_content = await document_service.get_markdown_content(document_id, processor_used)
        if markdown_content is None:
            raise HTTPException(status_code=404, detail="Document processing not found or failed")
        
        return JSONResponse(
            status_code=200,
            content={
                "document_id": document_id,
                "markdown_content": markdown_content
            }
        )
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving document content: {str(e)}")

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
                detail="No figures found. Document may not exist or was not processed with Azure Document Intelligence."
            )
        
        return JSONResponse(
            status_code=200,
            content={
                "document_id": document_id,
                "figures_count": len(figures),
                "figures": figures
            }
        )
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving document figures: {str(e)}")

@router.get("/{document_id}/figures/{figure_filename}", dependencies=[Depends(get_current_user)])
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
        
        # Try unified directory structure for both processors
        # Priority: docling -> azure_doc_intelligence -> legacy (backward compatibility)
        possible_paths = [
            base_path / "markdown_output" / "docling" / document_id / "figures" / figure_filename,
            base_path / "markdown_output" / "azure_doc_intelligence" / document_id / "figures" / figure_filename,
            # Legacy path for backward compatibility
            base_path / "markdown_output" / document_id / "figures" / figure_filename,
        ]
        
        print(f"[FIGURE] Attempting to serve figure: {document_id}/{figure_filename}")
        
        figure_path = None
        for path in possible_paths:
            print(f"[FIGURE] Checking path: {path}")
            if path.exists():
                figure_path = path
                print(f"[FIGURE] ✅ Found at: {path}")
                break
        
        if not figure_path:
            print(f"[FIGURE] File not found in any location")
            raise HTTPException(status_code=404, detail=f"Figure image not found: {figure_filename}")
        
        # Security check: ensure the file is within the expected markdown_output directory
        markdown_output_dir = base_path / "markdown_output"
        if not figure_path.is_relative_to(markdown_output_dir):
            print(f"[FIGURE] Security check failed - path not within markdown_output directory")
            raise HTTPException(status_code=403, detail="Access denied")
        
        print(f"[FIGURE] ✅ Serving figure: {figure_filename}")
        
        # Return the image file
        return FileResponse(
            path=str(figure_path),
            media_type="image/png",
            filename=figure_filename
        )
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"[FIGURE] Error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error retrieving figure image: {str(e)}")