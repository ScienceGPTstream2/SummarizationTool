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
endpoint = ""
model_name = ""
deployment = ""
api_key = ""
api_version = ""
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

Thank you for using the AI Document Summarization Tool! 🎊
