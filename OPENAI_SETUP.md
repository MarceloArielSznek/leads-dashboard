# OpenAI GPT-4 Setup Guide

## 🚀 Your AI Chat is now powered by real GPT-4!

To enable the AI chat functionality, you need to add your OpenAI API key to the environment variables.

## Setup Steps:

### 1. Get your OpenAI API Key
- Go to [OpenAI Platform](https://platform.openai.com/api-keys)
- Sign in with your OpenAI account
- Click "Create new secret key"
- Copy the API key (starts with `sk-`)

### 2. Add the API Key to your environment

**Option A: Create a .env file (Recommended)**
Create a `.env` file in the root directory of your project:
```
OPENAI_API_KEY=sk-your-actual-api-key-here
```

**Option B: Set environment variable directly**
```bash
# Windows (PowerShell)
$env:OPENAI_API_KEY="sk-your-actual-api-key-here"

# Windows (Command Prompt)
set OPENAI_API_KEY=sk-your-actual-api-key-here

# macOS/Linux
export OPENAI_API_KEY="sk-your-actual-api-key-here"
```

### 3. Restart your application
```bash
npm start
```

## 🎉 What you can now do:

The AI chat can understand natural language and convert it to SQL queries. Try asking:

- **Complex questions**: "Show me salespeople who closed more than 10 deals worth over $25,000 each"
- **Time-based queries**: "What was our revenue growth month over month for the last 6 months?"
- **Comparative analysis**: "Compare the performance of different lead sources by conversion rate"
- **Custom filters**: "Find all leads from Texas that were closed in Q4 2023"
- **Trend analysis**: "Show me the average days to close by property type"

## 💰 Cost Information:

- GPT-4 API costs approximately $0.01-0.03 per query
- With your Pro account, you have higher rate limits
- Typical business queries cost less than $0.02 each

## 🔒 Security:

- Your API key is stored securely in environment variables
- Never commit your `.env` file to version control
- The AI only has access to your database schema, not external data

## 🛠️ Troubleshooting:

If you see "OpenAI API key is not configured":
1. Make sure your `.env` file is in the root directory
2. Restart your Node.js application
3. Check that your API key starts with `sk-`
4. Verify you have credits available in your OpenAI account 