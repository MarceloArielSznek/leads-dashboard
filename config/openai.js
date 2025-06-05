const { Configuration, OpenAIApi } = require('openai');
const NodeCache = require('node-cache');
const businessIntelligence = require('./businessIntelligence');

// Initialize OpenAI client
const configuration = new Configuration({
    apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

// Create cache instances for different types of data
const queryCache = new NodeCache({ stdTTL: 3600 }); // 1 hour cache for SQL queries
const responseCache = new NodeCache({ stdTTL: 1800 }); // 30 min cache for responses
const businessMemory = new NodeCache({ stdTTL: 86400 }); // 24 hour cache for business context

// Your Business Knowledge Base - This is where the AI learns about YOUR specific business
const BUSINESS_CONTEXT = `
🏢 **ATTIC PROJECTS - BUSINESS INTELLIGENCE SYSTEM**

**COMPANY PROFILE:**
- Name: Attic Projects
- Industry: Home Improvement/Construction
- Business Model: Residential and commercial renovation/construction services
- Geographic Coverage: Multiple branches across different locations

**KEY BUSINESS METRICS TO FOCUS ON:**
- Sales performance by individual salespeople
- Branch performance comparison
- Lead conversion rates and timing
- Revenue per project type
- Follow-up timing effectiveness
- Cost analysis (T&M vs Subcontractor costs)

**CRITICAL BUSINESS QUESTIONS YOU SHOULD PRIORITIZE:**
1. "Which salespeople are performing best this month/quarter?"
2. "What's our average deal size by branch?"
3. "How long does it take to close deals on average?"
4. "Which lead sources are most profitable?"
5. "What's our conversion rate from inspection to sale?"
6. "Which property types generate the most revenue?"
7. "How effective are our follow-up strategies?"

**BUSINESS RULES & INSIGHTS:**
- Minimum acceptable multiplier: 2.0x on T&M costs
- Minimum final price after discount: $3,200
- Maximum discount allowed: 15%
- Optimal follow-up timing varies by salesperson (track patterns)
- Subcontractor costs are marked up 1.5x
- Same-day closings are highly valuable

**YOUR SALES PROCESS:**
1. Lead Created → 2. Inspection Scheduled → 3. Proposal Sent → 4. Follow-up → 5. Closed (Won/Lost)

**PERFORMANCE INDICATORS:**
- High performers: Close deals quickly, maintain good multipliers
- Red flags: Long time to close, low multipliers, missed follow-ups
- Success patterns: Same-day closings, optimal follow-up timing

**LANGUAGE PREFERENCES:**
- Use "deals" and "jobs" interchangeably with "leads"
- Focus on actionable insights, not just data
- Highlight profit margins and business efficiency
- Always consider seasonal trends in construction
`;

// Enhanced database schema with business context
const DATABASE_SCHEMA = `
Hi! I'm your AI assistant for Attic Projects! 🏗️✨

I know your business inside and out. I understand your sales process, your team's performance patterns, and what matters most for your profitability and growth.

📊 **ATTIC PROJECTS DATABASE STRUCTURE:**

🏢 **CORE BUSINESS TABLES:**
- **leads_dashboard.lead**: Your project pipeline
  - id, name (project/opportunity title), created_date, sold_date, inspection_date
  - final_proposal_amount, proposal_tm (time & materials cost)
  - lead_status_id, sales_person_id, source_id, customer_id, branch_id, property_type_id
  
- **leads_dashboard.sales_person**: Your sales team (I track their individual patterns!)
  - id, name, branch_id
  
- **leads_dashboard.branch**: Your business locations
  - id, name
  
- **leads_dashboard.customer**: Your client base
  - id, first_name, last_name, email_address, phone, address_id
  
- **leads_dashboard.address**: Project locations
  - id, street, city, state, zip_code
  
- **leads_dashboard.source**: Lead generation channels
  - id, name (Website, Referral, Google Ads, etc.)
  
- **leads_dashboard.property_type**: Job categories
  - id, name (Residential, Commercial, Renovation, etc.)
  
- **leads_dashboard.lead_status**: Pipeline stages
  - id, name (New, Qualified, Proposal Sent, Sold, Lost)
  
- **leads_dashboard.tag**: Project categorization
  - id, name
  
- **leads_dashboard.lead_tag**: Project tag relationships
  - lead_id, tag_id

🎯 **WHAT I EXCEL AT FOR ATTIC PROJECTS:**

1. **Sales Performance Analysis**: I know which salespeople excel and when
2. **Profitability Insights**: I understand your pricing, costs, and margins
3. **Pipeline Management**: I can predict and optimize your sales process
4. **Business Intelligence**: I provide actionable insights, not just data
5. **Seasonal Patterns**: I understand construction business cycles
6. **Team Coaching**: I can identify training opportunities for your sales team

💡 **SMART BUSINESS RULES I FOLLOW:**
- Always use "leads_dashboard." prefix for all queries
- For revenue: use final_proposal_amount from SOLD leads only
- For profitability: factor in T&M costs and subcontractor markups
- For timing: analyze inspection_date → sold_date patterns
- For performance: consider both volume and profit margins
- Always provide actionable business recommendations

🧠 **MY MEMORY CAPABILITIES:**
- I remember your previous questions and build on them
- I learn your preferences and priorities
- I track patterns in your data over time
- I can reference our past conversations
- I understand your specific business challenges

I'm not just an AI - I'm your business intelligence partner who gets excited about helping Attic Projects succeed! 🚀
`;

// Cache key generators
function generateCacheKey(type, query, context = '') {
    const cleanQuery = query.toLowerCase().trim();
    return `${type}_${Buffer.from(cleanQuery + context).toString('base64').slice(0, 32)}`;
}

// Smart query categorization for speed optimization
function categorizeQuery(question) {
    const lowerQ = question.toLowerCase();
    
    // Fast/simple queries that can use cached patterns
    if (lowerQ.includes('count') || lowerQ.includes('how many')) {
        return { type: 'count', complexity: 'simple', model: 'gpt-3.5-turbo' };
    }
    
    if (lowerQ.includes('total') || lowerQ.includes('sum') || lowerQ.includes('revenue')) {
        return { type: 'aggregation', complexity: 'simple', model: 'gpt-3.5-turbo' };
    }
    
    if (lowerQ.includes('average') || lowerQ.includes('avg')) {
        return { type: 'average', complexity: 'simple', model: 'gpt-3.5-turbo' };
    }
    
    if (lowerQ.includes('best') || lowerQ.includes('top') || lowerQ.includes('highest')) {
        return { type: 'ranking', complexity: 'medium', model: 'gpt-3.5-turbo' };
    }
    
    // Teaching/help queries that need more intelligence
    if (lowerQ.includes('how should i') || lowerQ.includes('what should i') || lowerQ.includes('help me')) {
        return { type: 'teaching', complexity: 'complex', model: 'gpt-4' };
    }
    
    if (lowerQ.includes('prompt') || lowerQ.includes('ask') || lowerQ.includes('question')) {
        return { type: 'meta', complexity: 'complex', model: 'gpt-4' };
    }
    
    // Complex analysis queries
    if (lowerQ.includes('pattern') || lowerQ.includes('trend') || lowerQ.includes('analysis')) {
        return { type: 'analysis', complexity: 'complex', model: 'gpt-4' };
    }
    
    // Default to medium complexity
    return { type: 'general', complexity: 'medium', model: 'gpt-3.5-turbo' };
}

// Store and retrieve business memory
function rememberInteraction(question, answer, data) {
    const memory = {
        timestamp: new Date(),
        question: question,
        answer: answer,
        resultCount: data ? data.length : 0,
        category: categorizeQuery(question).type
    };
    
    // Store recent interactions
    const recentMemories = businessMemory.get('recent_interactions') || [];
    recentMemories.unshift(memory);
    
    // Keep only last 20 interactions
    businessMemory.set('recent_interactions', recentMemories.slice(0, 20));
    
    // Store frequently asked questions
    const faqKey = `faq_${categorizeQuery(question).type}`;
    const faqs = businessMemory.get(faqKey) || [];
    faqs.push(question);
    businessMemory.set(faqKey, faqs.slice(-10)); // Keep last 10 per category
}

function getBusinessContext() {
    const recentInteractions = businessMemory.get('recent_interactions') || [];
    const recentQuestions = recentInteractions.slice(0, 5).map(i => i.question).join(', ');
    
    // Enhanced context with business intelligence
    let context = recentQuestions ? `\n🧠 **RECENT CONVERSATION CONTEXT**: You recently helped with: ${recentQuestions}` : '';
    
    // Add business intelligence insights
    context += businessIntelligence.getBusinessContext('');
    
    // Add performance insights
    const performanceInsights = businessIntelligence.getPerformanceInsights();
    if (performanceInsights.length > 0) {
        context += `\n📈 **PERFORMANCE INSIGHTS**: ${performanceInsights.join(', ')}`;
    }
    
    return context;
}

async function generateSQLFromQuestion(question) {
    try {
        console.log('🤖 Processing question:', question);
        
        if (!process.env.OPENAI_API_KEY) {
            throw new Error('OpenAI API key not configured');
        }
        
        // Check cache first for speed
        const cacheKey = generateCacheKey('sql', question);
        const cachedSQL = queryCache.get(cacheKey);
        if (cachedSQL) {
            console.log('⚡ Found cached SQL query');
            return cachedSQL;
        }
        
        // Categorize query for optimization
        const queryInfo = categorizeQuery(question);
        console.log(`📊 Query type: ${queryInfo.type}, complexity: ${queryInfo.complexity}, using: ${queryInfo.model}`);
        
        // Get enhanced business context with BI
        const businessContext = businessIntelligence.getBusinessContext(question);
        const recentContext = getBusinessContext();
        
        const response = await openai.createChatCompletion({
            model: queryInfo.model,
            messages: [
                {
                    role: "system",
                    content: DATABASE_SCHEMA + BUSINESS_CONTEXT + businessContext + recentContext + `
                    
🎭 **YOUR ENHANCED PERSONALITY:**
You're an expert data analyst who specializes in the construction/home improvement industry. You understand Attic Projects' business model, challenges, and opportunities. You think like a business owner and provide insights that drive profitability and growth.

🧠 **ENHANCED INTELLIGENCE:**
- You learn from every interaction and build business context
- You remember patterns and preferences from previous conversations
- You prioritize high-value business questions that drive profitability
- You understand seasonal construction patterns and market dynamics
- You provide insights that help optimize operations and sales performance

🔧 **CRITICAL SQL GENERATION RULES:**
1. **ONLY RETURN SQL QUERIES** - No explanations, no conversational text
2. If the question is NOT about data querying, return this exact text: "CONVERSATIONAL_QUERY"
3. If you can't create a SQL query, return: "UNABLE_TO_CREATE_SQL"
4. For data questions, return ONLY the SQL query without markdown formatting
5. Always use "leads_dashboard." prefix for all table names
6. Focus on actionable business insights in your queries

**Examples:**
- "How many leads do we have?" → SELECT COUNT(*) FROM leads_dashboard.lead;
- "Hello, how are you?" → CONVERSATIONAL_QUERY
- "What's the weather like?" → CONVERSATIONAL_QUERY
- "Help me understand my data" → CONVERSATIONAL_QUERY

Query Category: ${queryInfo.type} | Complexity: ${queryInfo.complexity}

**REMEMBER: Return ONLY SQL code or the special keywords above. No other text!**`
                },
                {
                    role: "user",
                    content: `Help me with this business question: "${question}"`
                }
            ],
            max_tokens: queryInfo.complexity === 'simple' ? 500 : 1000,
            temperature: queryInfo.complexity === 'simple' ? 0.1 : 0.2
        });

        const sqlQuery = response.data.choices[0].message.content.trim();
        
        // Handle special conversational responses
        if (sqlQuery === 'CONVERSATIONAL_QUERY') {
            console.log('✅ AI identified this as a conversational question');
            return 'CONVERSATIONAL_QUERY';
        }
        
        if (sqlQuery === 'UNABLE_TO_CREATE_SQL') {
            console.log('✅ AI unable to create SQL for this question');
            return 'UNABLE_TO_CREATE_SQL';
        }
        
        // Extract SQL from markdown code blocks if present
        const sqlMatch = sqlQuery.match(/```sql\n([\s\S]*?)\n```/) || sqlQuery.match(/```\n([\s\S]*?)\n```/);
        const cleanSQL = sqlMatch ? sqlMatch[1].trim() : sqlQuery;
        
        // Additional validation: check if it's actually SQL
        const sqlPattern = /^(SELECT|INSERT|UPDATE|DELETE|WITH|CREATE|ALTER|DROP)\s+/i;
        if (!sqlPattern.test(cleanSQL.trim())) {
            console.log('⚠️ Generated response does not appear to be SQL:', cleanSQL);
            return 'CONVERSATIONAL_QUERY'; // Treat non-SQL as conversational
        }
        
        // Cache for faster future responses
        queryCache.set(cacheKey, cleanSQL);
        
        console.log('✅ Generated SQL:', cleanSQL);
        return cleanSQL;
    } catch (error) {
        console.error('❌ Error generating SQL with GPT:', error);
        
        // Handle specific OpenAI errors
        if (error.response) {
            console.error('OpenAI API Error:', error.response.status, error.response.data);
        }
        
        throw error;
    }
}

async function generateNaturalLanguageResponse(question, data, sql) {
    try {
        console.log('🤖 Crafting intelligent business response for', data.length, 'results');
        
        // Learn from this interaction FIRST
        businessIntelligence.learnFromQuery(question, data, sql);
        
        if (!process.env.OPENAI_API_KEY) {
            const insight = data.length > 0 ? " I found some great insights in your data!" : " The search didn't return results, but I can help you explore different angles.";
            return `Great question about your business! I found ${data.length} results for "${question}".${insight} Feel free to ask follow-up questions! 📊✨`;
        }
        
        // Check cache for similar responses
        const cacheKey = generateCacheKey('response', question, data.length.toString());
        const cachedResponse = responseCache.get(cacheKey);
        if (cachedResponse && data.length === cachedResponse.dataCount) {
            console.log('⚡ Using optimized cached response');
            return cachedResponse.text;
        }
        
        // Get enhanced business context and follow-up suggestions
        const businessContext = businessIntelligence.getBusinessContext(question);
        const followUpSuggestions = businessIntelligence.getFollowUpSuggestions(question, data);
        const queryInfo = categorizeQuery(question);
        
        const dataPreview = data.slice(0, 5); // Show first 5 rows for better context
        
        const response = await openai.createChatCompletion({
            model: queryInfo.complexity === 'complex' ? 'gpt-4' : 'gpt-3.5-turbo',
            messages: [
                {
                    role: "system",
                    content: `You're Attic Projects' AI business intelligence assistant. You understand their construction/home improvement business deeply and provide insights that drive growth and profitability.

🎯 **YOUR ENHANCED RESPONSE STYLE:**
- Think like a business consultant who knows Attic Projects intimately
- Provide specific, actionable business recommendations
- Highlight profit opportunities and efficiency improvements
- Consider seasonal construction patterns and market trends
- Reference past insights when relevant (you have memory!)
- Be enthusiastic about helping them grow their business
- Use construction/sales terminology they understand

📝 **RESPONSE STRUCTURE FOR BUSINESS VALUE:**
1. Start with a compelling business insight
2. Highlight the most important findings for their bottom line
3. Provide context about what this means for their business
4. Suggest specific actions they can take
5. Recommend follow-up questions that could provide more value

🎯 **FOCUS AREAS:**
- Profit margins and pricing optimization
- Sales team performance and training opportunities
- Lead conversion and pipeline efficiency
- Branch performance comparison
- Seasonal patterns and forecasting
- Competitive advantages and market positioning

${businessContext}

🔮 **SMART FOLLOW-UP SUGGESTIONS**: ${followUpSuggestions.slice(0, 2).join(', ')}

Remember: You're not just analyzing data - you're helping build a more profitable, efficient business with memory and learning capabilities!`
                },
                {
                    role: "user",
                    content: `Business Question: "${question}"

I found ${data.length} results. Here's the key data:
${JSON.stringify(dataPreview, null, 2)}

Please provide a comprehensive business analysis that helps Attic Projects make better decisions and grow their business. Include specific recommendations and suggest valuable follow-up questions.`
                }
            ],
            max_tokens: queryInfo.complexity === 'simple' ? 300 : 500,
            temperature: 0.4
        });

        const response_text = response.data.choices[0].message.content.trim();
        console.log('✅ Generated intelligent response:', response_text.substring(0, 100) + '...');
        
        // Cache the response for faster future similar queries
        responseCache.set(cacheKey, { text: response_text, dataCount: data.length });
        
        // Remember this interaction for future context (legacy)
        rememberInteraction(question, response_text, data);
        
        return response_text;
    } catch (error) {
        console.error('❌ Error generating natural language response:', error);
        
        // Enhanced fallback with business context
        const insight = data.length > 0 ? " I can see some interesting patterns in your Attic Projects data!" : " Let's try exploring your business data from a different angle.";
        const businessResponse = `Great question about your business! I found ${data.length} results for "${question}".${insight} 

As your AI business partner, I'm here to help you discover opportunities for growth and profitability. Feel free to ask me about sales performance, profit margins, team efficiency, or any other aspect of your business! 🏗️💡`;
        
        // Still remember the interaction even if response generation failed
        rememberInteraction(question, businessResponse, data);
        businessIntelligence.learnFromQuery(question, data, '');
        
        return businessResponse;
    }
}

module.exports = {
    generateSQLFromQuestion,
    generateNaturalLanguageResponse,
    businessIntelligence // Export BI for use in controllers
}; 