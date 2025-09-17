# AI Document Summarization Tool

A React-based web application for document summarization and entity extraction using AI models.

## Features

- Document upload (PDF support)
- Document processing with various parsers
- Entity extraction with customizable prompts
- Settings management for API keys and models
- Responsive design with dark/light mode support

## Prerequisites

Before you can run this application, you need to install Node.js and npm:

### Installing Node.js

1. **Download Node.js**: Visit [nodejs.org](https://nodejs.org/) and download the LTS version
2. **Install Node.js**: Run the installer and follow the installation wizard
3. **Verify installation**: Open a terminal/command prompt and run:
   ```bash
   node --version
   npm --version
   ```

## Getting Started

### 1. Install Dependencies

Navigate to the project directory and install the required packages:

```bash
cd "Figma download AI Document Summarization Tool"
npm install
```

### 2. Configure API Keys

1. Copy `secrets.toml` to a new file for your actual keys
2. Replace the placeholder values with your actual API keys:
   - OpenAI API Key
   - Google AI API Key
   - Anthropic API Key
   - Azure Document Intelligence credentials
   - Other provider keys as needed

### 3. Development Server

Start the development server:

```bash
npm run dev
```

The application will be available at `http://localhost:3000`

### 4. Build for Production

Create a production build:

```bash
npm run build
```

The built files will be in the `dist` directory.

### 5. Preview Production Build

Test the production build locally:

```bash
npm run preview
```

## Deployment Options

### Option 1: Static Site Hosting (Recommended)

Since this is a React SPA, you can deploy it to any static site hosting service:

1. **Netlify**:
   - Connect your GitHub repository
   - Build command: `npm run build`
   - Publish directory: `dist`

2. **Vercel**:
   - Import your GitHub repository
   - Framework preset: Vite
   - Build command: `npm run build`
   - Output directory: `dist`

3. **GitHub Pages**:
   - Enable GitHub Pages in repository settings
   - Use GitHub Actions for automated deployment

### Option 2: Cloud Platforms

1. **Azure Static Web Apps**
2. **AWS S3 + CloudFront**
3. **Google Cloud Storage + CDN**

### Option 3: VPS/Server Deployment

1. Upload the `dist` folder to your web server
2. Configure your web server (Apache/Nginx) to serve the files
3. Ensure proper routing for SPA (redirect all routes to index.html)

## Environment Variables

For production deployment, you may want to use environment variables instead of the `secrets.toml` file:

```bash
VITE_OPENAI_API_KEY=your_openai_key
VITE_GOOGLE_API_KEY=your_google_key
VITE_ANTHROPIC_API_KEY=your_anthropic_key
```

## Project Structure

```
├── components/           # React components
│   ├── ui/              # UI components (shadcn/ui)
│   ├── figma/           # Figma-specific components
│   ├── UploadPage.tsx   # File upload interface
│   ├── ProcessingPage.tsx # Document processing
│   └── EntityExtractionPage.tsx # Entity extraction
├── styles/              # CSS styles
├── templates/           # Document templates
├── guidelines/          # Processing guidelines
├── App.tsx             # Main application component
├── main.tsx            # Application entry point
└── index.html          # HTML template
```

## Technologies Used

- **React 18** - UI framework
- **TypeScript** - Type safety
- **Vite** - Build tool
- **Tailwind CSS** - Styling
- **shadcn/ui** - UI components
- **Lucide React** - Icons
- **Radix UI** - Accessible components

## Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run lint` - Run ESLint

## Security Notes

- Never commit API keys to version control
- Use environment variables for sensitive data
- Implement proper CORS policies
- Consider rate limiting for API calls

## Support

For deployment issues or questions, refer to:
- [Vite Deployment Guide](https://vitejs.dev/guide/static-deploy.html)
- [React Deployment Documentation](https://create-react-app.dev/docs/deployment/)
