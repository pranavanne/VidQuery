# VidQuery

Semantic YouTube Q&A for asking questions about video content and jumping straight to the relevant timestamp.

## Features

- Paste a YouTube URL and load the video
- Parse and index transcript segments into Pinecone
- Ask questions in plain language
- Get answer excerpts with timestamp references
- Jump directly to the matching point in the player

## Tech stack

- TanStack Start
- React
- TypeScript
- Tailwind CSS
- OpenAI embeddings and chat
- Pinecone vector search

## Local development

Requires Node.js 22.12+.

```bash
npm install
npm run dev
```

Create a local `.env` file with:

```env
OPENAI_API_KEY=your_openai_key
PINECONE_API_KEY=your_pinecone_key
PINECONE_INDEX_NAME=your_pinecone_index
```

## Deployment

This project is ready for hosting on Vercel, with the required environment variables configured in the Vercel dashboard.
