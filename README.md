# Financial Chatbot - Vercel Version

A modern, Vercel-compatible financial chatbot built with Next.js 14, React 18, and Tailwind CSS. Integrates with Google Drive for cloud access to financial data.

## Features

- 💬 **Chat Interface** - Natural language queries about financial data
- 📊 **Data Visualization** - Project summaries and category breakdowns
- 🚀 **Vercel Ready** - Optimized for serverless deployment
- ☁️ **Google Drive Integration** - Reads CSV files directly from cloud
- 🎨 **Modern UI** - Beautiful gradient design with responsive layout

## Tech Stack

- **Frontend:** Next.js 14, React 18, Tailwind CSS
- **Icons:** Lucide React
- **Cloud Storage:** Google Drive API

## Prerequisites

1. **Google Cloud Console Project**
2. **Google Drive API enabled**
3. **Service Account credentials**

## Google Drive Setup

### 1. Create Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project or select existing
3. Enable **Google Drive API**

### 2. Create Service Account

1. Go to **IAM & Admin > Service Accounts**
2. Click **Create Service Account**
3. Grant role: **Editor** (or specific Drive access)
4. Create and download JSON key file

### 3. Share Folder with Service Account

1. Open your **Ai Chatbot Knowledge Base** folder in Google Drive
2. Click **Share**
3. Add the service account email (from JSON file, `client_email` field)
4. Grant **Editor** access

### 4. Configure Vercel Environment

1. In Vercel project settings, add environment variable:
   - **Name:** `GOOGLE_CREDENTIALS`
   - **Value:** Copy entire JSON content from your service account key file

### 5. Share Root Folder

**Important:** The service account needs access to the root folder "Ai Chatbot Knowledge Base".

Share this folder with the service account email address.

## Local Development

### 1. Clone and Install

```bash
git clone https://github.com/yatbond/financial-chatbot-vercel.git
cd financial-chatbot-vercel
npm install
```

### 2. Create .env.local

Create a `.env.local` file in the project root:

```env
GOOGLE_CREDENTIALS={
  "type": "service_account",
  "project_id": "your-project-id",
  "private_key_id": "your-private-key-id",
  "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
  "client_email": "your-service-account@your-project.iam.gserviceaccount.com",
  "client_id": "123456789",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token",
  ...
}
```

### 3. Run Locally

```bash
npm run dev
```

Open http://localhost:3000

## Deploy to Vercel

```bash
# Install Vercel CLI
npm install -g vercel

# Deploy
vercel --prod
```

Or connect your GitHub repo in Vercel dashboard and add the `GOOGLE_CREDENTIALS` environment variable.

## Data Structure

Expected Google Drive folder structure:
```
Ai Chatbot Knowledge Base/
└── [Year]/
    └── [Month (01-12)]/
        └── *_flat.csv
```

CSV columns:
- Sheet_Name, Financial_Type, Data_Type, Item_Code, Value

## Query Examples

- "What is the gross profit?"
- "Show projected gp"
- "Monthly materials for october"
- "Cash flow breakdown"
- "Business plan gp"
- "Net profit"

## Old Streamlit Version

The original Streamlit app is preserved at:
- GitHub: https://github.com/yatbond/Financial-chatbot
- Streamlit Cloud: https://share.streamlit.io

## License

MIT
