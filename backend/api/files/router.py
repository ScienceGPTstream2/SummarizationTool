"""File management API endpoints"""

from fastapi import APIRouter, File, UploadFile, HTTPException, Depends, Request
from fastapi.responses import JSONResponse, FileResponse

from core.dependencies import get_current_user
from services.document.file_service import FileService

router = APIRouter(prefix="/api", tags=["files"])

# Initialize services
file_service = FileService()


@router.post("/upload", dependencies=[Depends(get_current_user)])
async def upload_file(request: Request, file: UploadFile = File(...)):
    """
    Upload and store a PDF file
    """
    print(f"[UPLOAD] Request headers: {request.headers}")
    # Check content-length header first to fail fast for large files
    # This helps identify if a proxy/server is blocking the request before it reaches the app
    if "content-length" in request.headers:
        content_length = int(request.headers["content-length"])
        # The router has a 20MB limit, but we'll check against a slightly larger 25MB buffer
        # to see if the request even makes it past the proxy.
        if content_length > 25 * 1024 * 1024:  # 25MB
            raise HTTPException(
                status_code=413,  # Payload Too Large
                detail=(
                    f"Request size ({content_length / 1024 / 1024:.2f}MB) exceeds the server's limit. "
                    "This may be due to a proxy or server configuration."
                ),
            )

    try:
        # Log upload attempt
        print(
            f"[UPLOAD] Received file: {file.filename}, content_type: {file.content_type}"
        )

        # Check if filename exists
        if not file.filename:
            raise HTTPException(status_code=400, detail="No filename provided")

        # Validate file extension (case-insensitive) - basic check
        if not file.filename.lower().endswith(".pdf"):
            raise HTTPException(
                status_code=400,
                detail=f"Only PDF files are allowed. Received file: {file.filename}",
            )

        # Read file content
        content = await file.read()
        file_size = len(content)

        # SECURITY: Validate it's actually a PDF by checking magic bytes (file signature)
        # This prevents users from renaming malicious files to .pdf
        # PDF files MUST start with "%PDF-" (hex: 25 50 44 46 2D)
        # More flexible check: search for magic bytes within the first 1024 bytes
        if b"%PDF-" not in content[:1024]:
            print(f"[UPLOAD] Invalid PDF signature. First 20 bytes: {content[:20]}")
            raise HTTPException(
                status_code=400,
                detail="File is not a valid PDF. The file content does not match PDF format.",
            )

        # Validate file size (20MB limit)

        if file_size > 20 * 1024 * 1024:  # 20MB in bytes
            raise HTTPException(status_code=400, detail="File size exceeds 20MB limit")

        # Save file using file service
        file_path = await file_service.save_uploaded_file(file.filename, content)
        file_info = await file_service.get_file_info(file_path)

        print(f"[UPLOAD] ✅ PDF validated and saved: {file_info['file_id']}")

        return JSONResponse(
            status_code=200,
            content={
                "message": "File uploaded successfully",
                "file_id": file_info["file_id"],
                "filename": file_info["original_filename"],
                "file_size": file_info["file_size"],
                "upload_time": file_info["upload_time"],
            },
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error uploading file: {str(e)}")


@router.get("/files/{file_id}/info", dependencies=[Depends(get_current_user)])
async def get_file_info(file_id: str):
    """
    Get information about an uploaded file
    """
    try:
        file_info = await file_service.get_file_by_id(file_id)
        if not file_info:
            raise HTTPException(status_code=404, detail="File not found")

        return JSONResponse(status_code=200, content=file_info)

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error retrieving file info: {str(e)}"
        )


@router.get("/files/{file_id}", dependencies=[Depends(get_current_user)])
async def download_file(file_id: str):
    """
    Download/serve the uploaded file content
    """
    try:
        file_info = await file_service.get_file_by_id(file_id)
        if not file_info:
            raise HTTPException(status_code=404, detail="File not found")

        file_path = file_info.get("file_path")
        if not file_path:
            raise HTTPException(status_code=404, detail="File path not found")

        return FileResponse(
            path=file_path,
            media_type="application/pdf",
            filename=file_info.get("original_filename", "document.pdf"),
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error downloading file: {str(e)}")


@router.delete("/files/{file_id}", dependencies=[Depends(get_current_user)])
async def delete_file(file_id: str):
    """
    Delete an uploaded file
    """
    try:
        success = await file_service.delete_file(file_id)
        if not success:
            raise HTTPException(status_code=404, detail="File not found")

        return JSONResponse(
            status_code=200, content={"message": "File deleted successfully"}
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error deleting file: {str(e)}")
