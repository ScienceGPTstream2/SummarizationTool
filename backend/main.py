from fastapi import FastAPI, File, UploadFile, HTTPException, Form
from fastapi import Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from services.auth_router import auth_service as auth_service_router

security = HTTPBearer()

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    token = credentials.credentials
    try:
        payload = auth_service_router.verify_token(token)
        return payload['sub']
    except Exception:
        raise HTTPException(status_code=401, detail='Invalid or expired token')
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel
from typing import Optional, List
import uvicorn
import asyncio
import os
from pathlib import Path

# Load secrets.toml (if present) into environment variables so LLMService can read them.
# This allows local development with Summarization_tool/secrets.toml without forcing a specific secrets backend.
try:
    # Python 3.11+: tomllib in stdlib
    import tomllib as toml
except Exception:
    try:
        # Fallback to third-party toml if available
        import toml
    except Exception:
        toml = None

if toml:
    # secrets.toml is placed at the project root: Summarization_tool/secrets.toml
    # main.py is in Summarization_tool/backend/main.py so parents[1] -> Summarization_tool
    try:
        config_path = Path(__file__).resolve().parents[1] / "secrets.toml"
        if config_path.exists():
            with open(config_path, "rb") as f:
                cfg = toml.load(f)
            azure_cfg = cfg.get("azure_openai", {}) or {}
            endpoint = azure_cfg.get("endpoint")
            api_key = azure_cfg.get("api_key")
            api_version = azure_cfg.get("api_version")
            if endpoint:
                os.environ.setdefault("AZURE_OPENAI_ENDPOINT", endpoint)
            if api_key:
                os.environ.setdefault("AZURE_OPENAI_KEY", api_key)
            if api_version:
                os.environ.setdefault("AZURE_OPENAI_API_VERSION", api_version)
            # Optional: set default deployment/model name so LLMService can pick it up
            deployment = azure_cfg.get("deployment") or azure_cfg.get("model_name")
            model_name = azure_cfg.get("model_name")
            if deployment:
                os.environ.setdefault("AZURE_OPENAI_DEPLOYMENT", deployment)
            if model_name:
                os.environ.setdefault("AZURE_OPENAI_MODEL_NAME", model_name)
            
            vertex_cfg = cfg.get("vertex_ai", {}) or {}
            project = vertex_cfg.get("project")
            location = vertex_cfg.get("location")
            if project:
                os.environ.setdefault("GEMINI_PROJECT", project)
            if location:
                os.environ.setdefault("GEMINI_LOCATION", location)
    except Exception:
        # Fail silently — service will produce helpful errors if not configured
        pass

from services.file_service import FileService
from services.docling_service import DoclingService
from services.llm_service import LLMService
from services.auth_service import AuthService
from services.auth_router import router as auth_router

# Pydantic models
class ConvertURLRequest(BaseModel):
    url: str

# Create FastAPI app
app = FastAPI(
    title="Document Summarization API",
    description="Backend API for the Document Summarization Tool",
    version="1.0.0"
)

# Configure CORS
# NOTE: During local development many people run the frontend on a public host
# (vite --host) or access it via a machine IP. The frontend origin will then
# be something like "http://<PUBLIC_IP>:3000" which is different from
# "http://localhost:3000", and the browser will block responses unless that
# origin is allowed by the backend CORS policy.
#
# For development, allow_origins is set to ["*"] so the dev frontend can call
# the API regardless of how you're accessing the dev server. Do NOT use this
# in production; restrict origins to a specific list there.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Dev-only: allow any origin. For production, restrict this.
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(auth_router)

# Initialize services
file_service = FileService()
docling_service = DoclingService()
llm_service = LLMService()

@app.get("/", dependencies=[Depends(get_current_user)])
async def root():
    """Health check endpoint"""
    return {"message": "Document Summarization API is running"}

@app.post("/api/upload", dependencies=[Depends(get_current_user)])
async def upload_file(file: UploadFile = File(...)):
    """
    Upload and store a PDF file
    """
    try:
        # Check if filename exists
        if not file.filename:
            raise HTTPException(status_code=400, detail="No filename provided")
        
        # Validate file type
        if not file.filename.endswith('.pdf'):
            raise HTTPException(status_code=400, detail="Only PDF files are allowed")
        
        # Validate file size (10MB limit)
        content = await file.read()
        file_size = len(content)
        
        if file_size > 10 * 1024 * 1024:  # 10MB in bytes
            raise HTTPException(status_code=400, detail="File size exceeds 10MB limit")
        
        # Save file using file service
        file_path = await file_service.save_uploaded_file(file.filename, content)
        file_info = await file_service.get_file_info(file_path)
        
        return JSONResponse(
            status_code=200,
            content={
                "message": "File uploaded successfully",
                "file_id": file_info["file_id"],
                "filename": file_info["original_filename"],
                "file_size": file_info["file_size"],
                "upload_time": file_info["upload_time"]
            }
        )
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error uploading file: {str(e)}")

@app.get("/api/files/{file_id}", dependencies=[Depends(get_current_user)])
async def get_file_info(file_id: str):
    """
    Get information about an uploaded file
    """
    try:
        file_info = await file_service.get_file_by_id(file_id)
        if not file_info:
            raise HTTPException(status_code=404, detail="File not found")
        
        return JSONResponse(
            status_code=200,
            content=file_info
        )
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving file info: {str(e)}")

@app.delete("/api/files/{file_id}", dependencies=[Depends(get_current_user)])
async def delete_file(file_id: str):
    """
    Delete an uploaded file
    """
    try:
        success = await file_service.delete_file(file_id)
        if not success:
            raise HTTPException(status_code=404, detail="File not found")
        
        return JSONResponse(
            status_code=200,
            content={"message": "File deleted successfully"}
        )
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error deleting file: {str(e)}")

# Docling Document Conversion Endpoints

@app.post("/api/convert/file/{file_id}", dependencies=[Depends(get_current_user)])
async def convert_uploaded_file(file_id: str):
    """
    Convert an uploaded file to markdown using Docling
    """
    try:
        # Get file info
        file_info = await file_service.get_file_by_id(file_id)
        if not file_info:
            raise HTTPException(status_code=404, detail="File not found")
        
        # Convert file to markdown
        file_path = file_info["file_path"]
        result = await docling_service.convert_document_to_markdown(file_path, "file")
        
        if not result["success"]:
            raise HTTPException(status_code=500, detail=f"Conversion failed: {result['error']}")
        
        return JSONResponse(
            status_code=200,
            content={
                "message": "File converted successfully",
                "conversion_id": result["conversion_id"],
                "markdown_path": result["markdown_path"],
                "content_length": result["metadata"]["content_length"],
                "conversion_time": result["metadata"]["conversion_time"]
            }
        )
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error converting file: {str(e)}")

@app.post("/api/convert/url", dependencies=[Depends(get_current_user)])
async def convert_url(request: ConvertURLRequest):
    """
    Convert a document from URL to markdown using Docling (synchronous)
    """
    try:
        # Convert URL to markdown
        result = await docling_service.convert_document_to_markdown(request.url, "url")
        
        if not result["success"]:
            raise HTTPException(status_code=500, detail=f"Conversion failed: {result['error']}")
        
        return JSONResponse(
            status_code=200,
            content={
                "message": "URL converted successfully",
                "conversion_id": result["conversion_id"],
                "markdown_path": result["markdown_path"],
                "content_length": result["metadata"]["content_length"],
                "conversion_time": result["metadata"]["conversion_time"]
            }
        )
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error converting URL: {str(e)}")

# New background-start endpoint for file conversions (returns immediately with conversion_id)
@app.post("/api/convert/file/{file_id}/start", dependencies=[Depends(get_current_user)])
async def start_convert_uploaded_file(file_id: str):
    """
    Start conversion of an uploaded file in the background and return conversion_id immediately.
    """
    try:
        file_info = await file_service.get_file_by_id(file_id)
        if not file_info:
            raise HTTPException(status_code=404, detail="File not found")
        
        file_path = file_info["file_path"]
        result = await docling_service.start_conversion(file_path, "file")
        
        return JSONResponse(
            status_code=200,
            content={
                "message": "Conversion started",
                "conversion_id": result["conversion_id"],
                "markdown_path": result.get("markdown_path")
            }
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error starting conversion: {str(e)}")

# SSE endpoint to stream conversion logs
@app.get("/api/conversions/{conversion_id}/logs", dependencies=[Depends(get_current_user)])
async def stream_conversion_logs(conversion_id: str):
    """
    Stream conversion logs as Server-Sent Events (SSE). The endpoint will keep
    streaming new log lines until the conversion metadata status becomes
    'success' or 'error', after which it will send a final 'done' event.
    """
    try:
        # Ensure conversion metadata (may exist with status 'running' if started via start_conversion)
        conversion_info = await docling_service.get_conversion_by_id(conversion_id)
        if not conversion_info:
            raise HTTPException(status_code=404, detail="Conversion not found")
        
        log_path = conversion_info.get("log_path")
        
        async def event_generator():
            import aiofiles
            import asyncio as _asyncio
            sent_lines = 0
            p = None
            if log_path:
                from pathlib import Path as _Path
                p = _Path(log_path)
            # Loop until conversion status changes to success/error and we've emitted all lines
            while True:
                meta = await docling_service.get_conversion_by_id(conversion_id)
                status = meta.get("status") if meta else None

                if p and p.exists():
                    try:
                        async with aiofiles.open(p, 'r', encoding='utf-8') as f:
                            content = await f.read()
                    except Exception:
                        content = ""
                    lines = content.splitlines()
                    # Emit any new lines
                    while sent_lines < len(lines):
                        line = lines[sent_lines]
                        sent_lines += 1
                        yield f"data: {line}\n\n"
                # If conversion finished, send final status and break
                if status in ("success", "error"):
                    yield f"event: done\ndata: {status}\n\n"
                    break
                await _asyncio.sleep(0.5)
        
        return StreamingResponse(event_generator(), media_type="text/event-stream")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error streaming logs: {str(e)}")

@app.get("/api/conversions/{conversion_id}", dependencies=[Depends(get_current_user)])
async def get_conversion_info(conversion_id: str):
    """
    Get information about a document conversion
    """
    try:
        conversion_info = await docling_service.get_conversion_by_id(conversion_id)
        if not conversion_info:
            raise HTTPException(status_code=404, detail="Conversion not found")
        
        return JSONResponse(
            status_code=200,
            content=conversion_info
        )
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving conversion info: {str(e)}")

@app.get("/api/conversions/{conversion_id}/markdown", dependencies=[Depends(get_current_user)])
async def get_conversion_markdown(conversion_id: str):
    """
    Get the markdown content of a conversion
    """
    try:
        markdown_content = await docling_service.get_markdown_content(conversion_id)
        if markdown_content is None:
            raise HTTPException(status_code=404, detail="Conversion not found or failed")
        
        return JSONResponse(
            status_code=200,
            content={
                "conversion_id": conversion_id,
                "markdown_content": markdown_content
            }
        )
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving markdown content: {str(e)}")

class Entity(BaseModel):
    name: str
    prompt: str
    extracted: Optional[str] = None

class ExtractRequest(BaseModel):
    conversion_id: str
    deployment: Optional[str] = None
    entities: List[Entity]
    api_version: Optional[str] = None
    azure_endpoint: Optional[str] = None
    azure_api_key: Optional[str] = None
    max_tokens: int = 1024
    temperature: float = 0.0
    provider: Optional[str] = None
    gemini_model: Optional[str] = None

@app.post("/api/extract", dependencies=[Depends(get_current_user)])
async def extract_entities(request: ExtractRequest):
    """
    Run entity extraction for a list of entities using Azure OpenAI.
    """
    try:
        markdown = await docling_service.get_markdown_content(request.conversion_id)
        if markdown is None:
            raise HTTPException(status_code=404, detail="Conversion markdown not found or not ready")

        async def run_extraction(entity: Entity):
            result = await llm_service.extract_entities_from_markdown(
                markdown=markdown,
                extraction_prompt=entity.prompt,
                deployment=request.deployment,
                api_version=request.api_version,
                endpoint_override=request.azure_endpoint,
                api_key_override=request.azure_api_key,
                max_tokens=request.max_tokens,
                temperature=request.temperature,
                provider=request.provider,
                gemini_model=request.gemini_model
            )
            if result.get("success"):
                return {"name": entity.name, "extracted": result.get("content"), "meta": result.get("meta")}
            else:
                # Even on failure, the result might have useful metadata
                return {"name": entity.name, "extracted": f"Error: {result.get('error')}", "meta": result.get("meta")}

        tasks = [run_extraction(entity) for entity in request.entities]
        extracted_entities = await asyncio.gather(*tasks)

        return JSONResponse(
            status_code=200,
            content={
                "message": "Extraction completed",
                "extracted_entities": extracted_entities
            }
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error extracting entities: {str(e)}")

@app.get("/api/conversions", dependencies=[Depends(get_current_user)])
async def list_conversions():
    """
    List all document conversions
    """
    try:
        conversions = await docling_service.list_conversions()
        return JSONResponse(
            status_code=200,
            content={
                "conversions": conversions,
                "total": len(conversions)
            }
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error listing conversions: {str(e)}")

@app.delete("/api/conversions/{conversion_id}", dependencies=[Depends(get_current_user)])
async def delete_conversion(conversion_id: str):
    """
    Delete a document conversion and its associated files
    """
    try:
        success = await docling_service.delete_conversion(conversion_id)
        if not success:
            raise HTTPException(status_code=404, detail="Conversion not found")
        
        return JSONResponse(
            status_code=200,
            content={"message": "Conversion deleted successfully"}
        )
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error deleting conversion: {str(e)}")

class ServerConfig(BaseModel):
    is_azure_openai_configured: bool

@app.get("/api/server-config", response_model=ServerConfig, dependencies=[Depends(get_current_user)])
async def get_server_config():
    """
    Return server-side configuration status for features like Azure OpenAI.
    """
    # Check if the essential Azure OpenAI env vars are set and not empty
    is_configured = all([
        os.getenv("AZURE_OPENAI_ENDPOINT"),
        os.getenv("AZURE_OPENAI_KEY"),
        os.getenv("AZURE_OPENAI_DEPLOYMENT")
    ])

    return ServerConfig(is_azure_openai_configured=is_configured)



@app.get("/api/models", dependencies=[Depends(get_current_user)])
async def get_available_models():
    """
    Return list of Azure models configured via environment (secrets.toml)
    """
    models = []
    deployment = os.getenv("AZURE_OPENAI_DEPLOYMENT")
    model_name = os.getenv("AZURE_OPENAI_MODEL_NAME")
    api_version = os.getenv("AZURE_OPENAI_API_VERSION")
    if deployment and model_name:
        models.append({
            "id": f"azure-{deployment}",
            "name": model_name,
            "provider": "Azure",
            "description": f"Azure deployment of {model_name}",
            "deployment": deployment,
            "api_version": api_version
        })
    return JSONResponse(status_code=200, content=models)

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=True)
