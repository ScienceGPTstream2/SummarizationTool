# 🎨 AI Document Summarization Tool 🚀

Full-stack React + FastAPI application for AI-powered document summarization and entity extraction.  

🔗 For backend setup, configuration files, and secrets, see [Backend README](backend/README.md).

---

## ✨ Features

- 📄 Upload and process PDFs (and other document formats)  
- 🤖 Summarization using AI models  
- 🕵️‍♂️ Entity extraction with customizable prompts  
- ⚙️ Settings management for API keys and model choices  
- 🌙 Dark/light theme toggle for comfortable reading  

---

## 🛠 Prerequisites

- Node.js & npm (LTS recommended)  
- Python 3.x & pip  
- A valid `secrets.toml` and `users.toml` in project root (see Backend README)

---

## 🚀 Getting Started

1. Clone repository  
   ```bash
   git clone <repo-url> Summarization_tool
   cd Summarization_tool
   ```

2. Install Front-end dependencies  
   ```bash
   cd .
   npm install
   ```

3. Configure front-end environment variables (optional)  
   - Create a `.env` file or set in your shell:  
     ```
     VITE_API_BASE_URL=http://localhost:8000
     ```

4. Start Development Server  
   ```bash
   npm run dev
   ```
   App will be available at `http://localhost:3000`  

---

## 📂 Project Structure

```
├── backend/               # FastAPI server (see Backend README)
├── components/            # React UI components
├── styles/                # Global CSS
├── templates/             # Summarization templates
├── App.tsx                # Main application component
├── main.tsx               # Front-end entry point
├── index.html             # HTML template
└── README.md              # This file
```

---

## 🚀 Starting Both Servers

In separate terminals:

```bash
# Front-end (React/Vite)
VITE_API_BASE_URL="http://<PUBLIC_IP>:8000" npm run dev -- --host

# Backend (FastAPI)
cd backend && uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

---

## 📖 Deployment

Build for production:

```bash
npm run build
```

Serve `dist/` on any static host (Netlify, Vercel, GitHub Pages).

---

## 🙏 Thank You

Special thanks to:

- Health Canada Solutions Fund 💖  
- Shared Services Canada Science Cloud ☁️  

Thank you for choosing the AI Document Summarization Tool! 🎉
