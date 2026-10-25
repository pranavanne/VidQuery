# VidQuery

VidQuery helps users ask natural-language questions about YouTube videos and get precise, timestamped answers grounded in the video transcript. It indexes transcripts with Pinecone and uses OpenAI embeddings and chat completions to surface the most relevant moments instantly.

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
Add Link
