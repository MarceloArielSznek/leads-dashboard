const { Configuration, OpenAIApi } = require('openai');

// Initialize OpenAI client
const configuration = new Configuration({
    apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

// Database schema information for GPT-4 context
const DATABASE_SCHEMA = `
You are a PostgreSQL expert helping users query a leads management database. Here's the schema:

TABLES:
- leads_dashboard.lead: Main leads table
  - id, name (opportunity_title), created_date, sold_date, final_proposal_amount, proposal_tm
  - lead_status_id, sales_person_id, source_id, customer_id, branch_id, property_type_id
  
- leads_dashboard.sales_person: Sales team members
  - id, name, branch_id
  
- leads_dashboard.branch: Company branches
  - id, name
  
- leads_dashboard.customer: Customer information
  - id, first_name, last_name, email_address, phone, address_id
  
- leads_dashboard.address: Customer addresses
  - id, street, city, state, zip_code
  
- leads_dashboard.source: Lead sources
  - id, name
  
- leads_dashboard.property_type: Types of properties
  - id, name
  
- leads_dashboard.lead_status: Status of leads
  - id, name
  
- leads_dashboard.tag: Tags for categorization
  - id, name
  
- leads_dashboard.lead_tag: Many-to-many relationship between leads and tags
  - lead_id, tag_id

IMPORTANT RULES:
1. Always use the schema prefix "leads_dashboard."
2. For revenue calculations, use final_proposal_amount
3. For closed/sold leads, filter by "sold_date IS NOT NULL"
4. For date calculations, use PostgreSQL date functions
5. Always include proper JOINs for related data
6. Limit results to reasonable numbers (usually 10-20 max)
7. Use proper aggregation functions (SUM, AVG, COUNT)
8. Format currency and percentages appropriately
`;

async function generateSQLFromQuestion(question) {
    try {
        const response = await openai.createChatCompletion({
            model: "gpt-4",
            messages: [
                {
                    role: "system",
                    content: DATABASE_SCHEMA
                },
                {
                    role: "user",
                    content: `Convert this natural language question into a PostgreSQL query: "${question}"`
                }
            ],
            max_tokens: 1000,
            temperature: 0.1 // Low temperature for more consistent SQL generation
        });

        const sqlQuery = response.data.choices[0].message.content.trim();
        
        // Extract SQL from markdown code blocks if present
        const sqlMatch = sqlQuery.match(/```sql\n([\s\S]*?)\n```/) || sqlQuery.match(/```\n([\s\S]*?)\n```/);
        const cleanSQL = sqlMatch ? sqlMatch[1].trim() : sqlQuery;
        
        return cleanSQL;
    } catch (error) {
        console.error('Error generating SQL with GPT-4:', error);
        throw error;
    }
}

async function generateNaturalLanguageResponse(question, data, sql) {
    try {
        const dataPreview = data.slice(0, 3); // Show first 3 rows for context
        
        const response = await openai.createChatCompletion({
            model: "gpt-4",
            messages: [
                {
                    role: "system",
                    content: "You are a helpful business analyst. Provide clear, concise explanations of database query results. Focus on key insights and trends."
                },
                {
                    role: "user",
                    content: `The user asked: "${question}"
                    
The SQL query returned ${data.length} results. Here's a preview of the data:
${JSON.stringify(dataPreview, null, 2)}

Please provide a natural language summary of these results, highlighting key insights.`
                }
            ],
            max_tokens: 300,
            temperature: 0.3
        });

        return response.data.choices[0].message.content.trim();
    } catch (error) {
        console.error('Error generating natural language response:', error);
        return `Here are the results for your question: "${question}"`;
    }
}

module.exports = {
    generateSQLFromQuestion,
    generateNaturalLanguageResponse
}; 