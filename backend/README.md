# Backend Environment Setup

This directory contains the FastAPI backend for the AI Document Summarization Tool. All Python dependencies must be installed into the dedicated virtual environment located at `backend/venv/` to isolate them from your system Python.

## Create and Activate the Virtual Environment

From the project root, run:

```bash
cd backend
python3 -m venv venv
```

Activate the environment:

- On macOS/Linux:
  ```bash
  source venv/bin/activate
  ```
- On Windows (PowerShell):
  ```powershell
  .\venv\Scripts\Activate.ps1
  ```

## Install Dependencies

With the virtual environment activated, install backend dependencies:

```bash
venv/bin/pip install --upgrade pip
venv/bin/pip install -r requirements.txt
```

## Running the Backend

Ensure the virtual environment is active, then start the FastAPI server:

```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

## Notes

- Always confirm you have activated `backend/venv/` before pip installing or running the backend.
- To deactivate the environment, simply run:
  ```bash
  deactivate
  ```
