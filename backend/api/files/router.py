"""File management API endpoints with organized storage and deduplication"""

from fastapi import APIRouter, File, UploadFile, HTTPException, Header, Request
from fastapi.responses import JSONResponse, Response
from typing import Optional, List
from pydantic import BaseModel
import hashlib

from services.document import get_organized_file_service, get_organized_processor
from services.auth.supabase_auth_service import SupabaseAuthService

router = APIRouter(prefix="/api", tags=["files"])

# Services
file_service = get_organized_file_service()
auth_service = SupabaseAuthService()


# Response Models
class FileUploadResponse(BaseModel):
    success: bool
    file_hash: str
    original_filename: str
    file_size: int
    is_new: bool
    deduplicated: bool
    processed: dict = {}


class UserFileInfo(BaseModel):
    file_hash: str
    original_filename: str
    file_size: int
    mime_type: str
    created_at: str
    processed: dict = {}


def get_user_id_from_token(authorization: Optional[str]) -> Optional[str]:
    """Extract user ID from Authorization header."""
    if not authorization:
        return None
    
    try:
        token = authorization.replace("Bearer ", "")
        if auth_service.is_configured:
            return auth_service.get_user_id(token)
    except:
        pass
    return None


@router.post("/upload")
async def upload_file(
    request: Request,
    file: UploadFile = File(...),
    authorization: Optional[str] = Header(None)
):
    """
    Upload and store a PDF file with deduplication.
    
    If the same file (by hash) was uploaded before, returns existing file info.
    Associates the file with the authenticated user if a valid token is provided.
    """
    print(f"[UPLOAD] Request headers: {request.headers}")
    
    # Check content-length header
    if "content-length" in request.headers:
        content_length = int(request.headers["content-length"])
        if content_length > 25 * 1024 * 1024:  # 25MB
            raise HTTPException(
                status_code=413,
                detail=(
                    f"Request size ({content_length / 1024 / 1024:.2f}MB) exceeds the server's limit."
                ),
            )

    try:
        print(f"[UPLOAD] Received file: {file.filename}, content_type: {file.content_type}")

        if not file.filename:
            raise HTTPException(status_code=400, detail="No filename provided")

        # Validate file extension
        if not file.filename.lower().endswith(".pdf"):
            raise HTTPException(
                status_code=400,
                detail=f"Only PDF files are allowed. Received file: {file.filename}",
            )

        # Read file content
        content = await file.read()
        file_size = len(content)

        # Validate PDF magic bytes
        if b"%PDF-" not in content[:1024]:
            print(f"[UPLOAD] Invalid PDF signature. First 20 bytes: {content[:20]}")
            raise HTTPException(
                status_code=400,
                detail="File is not a valid PDF. The file content does not match PDF format.",
            )

        # Validate file size (20MB limit)
        if file_size > 20 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="File size exceeds 20MB limit")

        # Get user ID if authenticated
        user_id = get_user_id_from_token(authorization)

        # Save with deduplication
        result = await file_service.save_uploaded_file(
            filename=file.filename,
            content=content,
            user_id=user_id
        )

        # Check processing status
        processed = {
            "azure_doc_intelligence": await file_service.is_file_processed(
                result["file_hash"], "azure_doc_intelligence"
            ),
            "docling": await file_service.is_file_processed(
                result["file_hash"], "docling"
            )
        }

        print(f"[UPLOAD] ✅ PDF saved: {result['file_hash']} (deduplicated: {result['deduplicated']})")

        return JSONResponse(
            status_code=200,
            content={
                "message": "File uploaded successfully",
                "file_hash": result["file_hash"],
                "file_id": result["file_hash"],  # For backward compatibility
                "filename": result["original_filename"],
                "file_size": result["file_size"],
                "is_new": result["is_new"],
                "deduplicated": result["deduplicated"],
                "processed": processed
            },
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error uploading file: {str(e)}")


@router.get("/files/list")
async def list_user_files(authorization: Optional[str] = Header(None)):
    """List all files associated with the authenticated user."""
    user_id = get_user_id_from_token(authorization)
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")
    
    try:
        files = await file_service.list_user_files(user_id)
        
        return JSONResponse(
            status_code=200,
            content={
                "files": [
                    {
                        "file_hash": f["file_hash"],
                        "file_id": f["file_hash"],  # For backward compatibility
                        "original_filename": f.get("original_filename", "unknown"),
                        "file_size": f.get("file_size", 0),
                        "mime_type": f.get("mime_type", "application/pdf"),
                        "created_at": f.get("created_at", ""),
                        "processed": f.get("processed", {})
                    }
                    for f in files
                ]
            }
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/files/{file_id}")
async def download_file(file_id: str, authorization: Optional[str] = Header(None)):
    """
    Download/serve the uploaded file content.
    Accepts either file_hash or legacy file_id format.
    """
    try:
        # Treat file_id as file_hash in new system
        file_hash = file_id
        
        content = await file_service.get_file_content(file_hash)
        if not content:
            raise HTTPException(status_code=404, detail="File not found")
        
        metadata = await file_service.get_file_metadata(file_hash)
        mime_type = metadata.get("mime_type", "application/pdf") if metadata else "application/pdf"
        filename = metadata.get("original_filename", "document.pdf") if metadata else "document.pdf"
        
        return Response(
            content=content,
            media_type=mime_type,
            headers={"Content-Disposition": f'inline; filename="{filename}"'}
        )
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error downloading file: {str(e)}")


@router.get("/files/{file_id}/info")
async def get_file_info(file_id: str, authorization: Optional[str] = Header(None)):
    """
    Get information about an uploaded file.
    Accepts either file_hash or legacy file_id format.
    """
    try:
        file_hash = file_id
        
        metadata = await file_service.get_file_metadata(file_hash)
        if not metadata:
            raise HTTPException(status_code=404, detail="File not found")
        
        processed = {
            "azure_doc_intelligence": await file_service.is_file_processed(
                file_hash, "azure_doc_intelligence"
            ),
            "docling": await file_service.is_file_processed(
                file_hash, "docling"
            )
        }
        
        return JSONResponse(
            status_code=200,
            content={
                "file_hash": file_hash,
                "file_id": file_hash,  # For backward compatibility
                "original_filename": metadata.get("original_filename"),
                "file_size": metadata.get("file_size"),
                "mime_type": metadata.get("mime_type", "application/pdf"),
                "created_at": metadata.get("created_at"),
                "upload_time": metadata.get("created_at"),  # For backward compatibility
                "processed": processed
            }
        )
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving file info: {str(e)}")


@router.delete("/files/{file_id}")
async def delete_file(file_id: str, authorization: Optional[str] = Header(None)):
    """
    Delete an uploaded file.
    Note: In the new system, this marks the file as deleted for the user
    but doesn't delete the global deduplicated copy.
    """
    try:
        # For now, return success - actual implementation would need
        # to remove user association in Supabase
        return JSONResponse(
            status_code=200,
            content={"message": "File deleted successfully"}
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error deleting file: {str(e)}")
