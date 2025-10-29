# 🎨 AI Document Summarization Tool - Backend 🚀

Welcome to the **FastAPI** backend for the **AI Document Summarization Tool**! 🎉

---

## 🔧 Configuration Files

Place the following files in the project root:

### 🔒 secrets.toml

⚠️ This file contains sensitive credentials. Do not commit it to source control.

```toml
# Azure OpenAI secrets for Summarization_tool
[azure_openai]
endpoint = "https://your-resource.openai.azure.com/"
model_name = "gpt-5-mini"
deployment = "gpt-5-mini"
api_key = "YOUR_AZURE_OPENAI_API_KEY"
api_version = "2024-12-01-preview"

# Azure Document Intelligence configuration (document processing)
[azure_doc_intelligence]
endpoint = "https://your-resource.cognitiveservices.azure.com/"
key = "YOUR_AZURE_DOC_INTELLIGENCE_KEY"

# Vertex AI configuration (optional, for evaluation with Gemini)
[vertex_ai]
project = "your-gcp-project-id"
location = "us-central1"

# Security configuration (JWT tokens)
[security]
jwt_secret = "your-secret-key-here"
jwt_expiration_hours = 24
```

### 👥 users.toml

Define application users and whitelist of emails.

```toml
[[users]]
email = ""
hash = ""

[[users]]
email = ""
hash = ""

[whitelist]
emails = []
```

---

## 🐍 Backend Environment Setup

This directory contains the FastAPI backend for the AI Document Summarization Tool.

All Python dependencies must be installed into a dedicated virtual environment to isolate them from your system Python.

### 🛠️ Create and Activate the Virtual Environment

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

### 📥 Install Dependencies

With the virtual environment activated, install backend dependencies:

```bash
venv/bin/pip install --upgrade pip
venv/bin/pip install -r requirements.txt
```

---

## 🚀 Starting the App

Start the front-end dev server (in a separate terminal):

```bash
cd Summarization_tool/backend && VITE_API_BASE_URL="http://PUBLICIP:8000" npm run dev -- --host
```

Start the backend FastAPI server:

```bash
cd Summarization_tool/backend && uvicorn main:app --reload --port 8000 --host 0.0.0.0
```

---

## ✨ Features

### 📄 Document Processing
- Upload and process PDF documents
- Two processing engines:
  - **Azure Document Intelligence** - Premium processor with superior accuracy
  - **Docling** - Open-source fallback processor
- Extract markdown, tables, and figures
- Bounding box visualization

### 🤖 Entity Extraction
- Extract custom entities using Azure OpenAI GPT-5 Mini
- Define custom extraction prompts
- Concurrent batch extraction
- Token usage tracking

### 📊 G-Eval Evaluation (NEW!)
- Evaluate entity extractions using LLM-as-a-judge
- Support for Azure OpenAI and Vertex AI (Gemini)
- Built-in metrics:
  - **Correctness** - Factual accuracy vs ground truth
  - **Completeness** - Coverage of all key information  
  - **Relevance** - Focus on requested entities
- Custom metrics with domain-specific criteria
- Batch evaluation support
- Detailed scoring and reasoning

See [Evaluation Guide](docs/EVALUATION_GUIDE.md) for detailed documentation.

---

## 📚 Documentation

- **[Evaluation Guide](docs/EVALUATION_GUIDE.md)** - Complete guide to G-Eval metrics
- **[Examples](examples/)** - Python examples and usage patterns
- **[API Docs](http://localhost:8000/docs)** - Interactive API documentation (when server running)

---

## 📝 Notes

- Always confirm the virtual environment is active before pip installing or running the backend.
- To deactivate the environment, simply run:
  ```bash
  deactivate
  ```

---

## 🙏 Thank You

Special thanks to:

- Health Canada Solutions Fund 💖
- Shared Services Canada Science Cloud ☁️
