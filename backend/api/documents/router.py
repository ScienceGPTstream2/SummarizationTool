"""Document processing API endpoints"""
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import JSONResponse

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
            processor=request.processor
        )
        
        if not result["success"]:
            raise HTTPException(status_code=500, detail=f"Conversion failed: {result['error']}")
        
        return JSONResponse(
            status_code=200,
            content={
                "message": "Document processed successfully",
                "conversion_id": result["conversion_id"],
                "markdown_path": result["markdown_path"],
                "content_length": result["metadata"]["content_length"],
                "conversion_time": result["metadata"]["conversion_time"],
                "processor_used": result.get("processor_used", "unknown"),
                "processor_fallback": result.get("processor_fallback", False),
                "fallback_reason": result.get("fallback_reason")
            }
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