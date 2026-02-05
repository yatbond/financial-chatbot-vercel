# Financial Chatbot - Vercel Version

A modern, Vercel-compatible financial chatbot built with Next.js 14, React 18, and Tailwind CSS.

## Features

- 💬 **Chat Interface** - Natural language queries about financial data
- 📊 **Data Visualization** - Project summaries and category breakdowns
- 🚀 **Vercel Ready** - Optimized for serverless deployment
- 🎨 **Modern UI** - Beautiful gradient design with responsive layout

## Tech Stack

- **Frontend:** Next.js 14, React 18, Tailwind CSS
- **Icons:** Lucide React
- **Data:** CSV files from Google Drive

## Quick Start

### 1. Clone and Install

```bash
git clone https://github.com/yatbond/financial-chatbot-vercel.git
cd financial-chatbot-vercel
npm install
```

### 2. Configure Data Path

Edit `app/api/chat/route.ts` to point to your data directory:
```typescript
const dataDir = 'G:/My Drive/Ai Chatbot Knowledge Base'
```

### 3. Run Locally

```bash
npm run dev
```

Open http://localhost:3000

### 4. Deploy to Vercel

```bash
npm install -g vercel
vercel --prod
```

## Data Structure

Expected folder structure:
```
Ai Chatbot Knowledge Base/
└── [Year]/
    └── [Month]/
        └── *_flat.csv
```

CSV columns:
- Year, Month
- Sheet_Name, Financial_Type
- Item_Code, Trade
- Value

## Old Streamlit Version

The original Streamlit app is preserved at:
- GitHub: https://github.com/yatbond/Financial-chatbot
- Streamlit: https://share.streamlit.io

## License

MIT
