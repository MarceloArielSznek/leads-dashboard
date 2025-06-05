const NodeCache = require('node-cache');

// Business Intelligence Memory System for Attic Projects
class BusinessIntelligence {
    constructor() {
        // Different cache periods for different types of intelligence
        this.performanceMetrics = new NodeCache({ stdTTL: 3600 }); // 1 hour
        this.salesPatterns = new NodeCache({ stdTTL: 7200 }); // 2 hours
        this.customerInsights = new NodeCache({ stdTTL: 14400 }); // 4 hours
        this.marketTrends = new NodeCache({ stdTTL: 86400 }); // 24 hours
        this.businessContext = new NodeCache({ stdTTL: 86400 }); // 24 hours
        
        console.log('🧠 Business Intelligence system initialized for Attic Projects');
    }

    // Learn from each query to build business context
    learnFromQuery(question, results, sql) {
        try {
            const insight = {
                timestamp: new Date(),
                question: question,
                resultCount: results ? results.length : 0,
                sql: sql,
                category: this.categorizeBusinessQuestion(question),
                value: this.assessBusinessValue(question, results)
            };

            // Store in appropriate category
            this.storeInsight(insight);
            
            // Build performance metrics
            this.updatePerformanceMetrics(insight, results);
            
            console.log(`📊 Learned from query: ${insight.category} (value: ${insight.value})`);
        } catch (error) {
            console.error('❌ Error learning from query:', error);
        }
    }

    categorizeBusinessQuestion(question) {
        const q = question.toLowerCase();
        
        if (q.includes('revenue') || q.includes('sales') || q.includes('profit')) {
            return 'revenue_analysis';
        }
        if (q.includes('salesperson') || q.includes('sales person') || q.includes('rep')) {
            return 'sales_performance';
        }
        if (q.includes('branch') || q.includes('location')) {
            return 'branch_performance';
        }
        if (q.includes('lead') || q.includes('conversion') || q.includes('pipeline')) {
            return 'lead_management';
        }
        if (q.includes('time') || q.includes('days') || q.includes('follow')) {
            return 'timing_analysis';
        }
        if (q.includes('cost') || q.includes('margin') || q.includes('price')) {
            return 'cost_analysis';
        }
        if (q.includes('source') || q.includes('marketing')) {
            return 'marketing_analysis';
        }
        if (q.includes('customer') || q.includes('client')) {
            return 'customer_analysis';
        }
        
        return 'general_business';
    }

    assessBusinessValue(question, results) {
        const q = question.toLowerCase();
        let value = 'medium';

        // High value questions
        if (q.includes('profit') || q.includes('margin') || q.includes('cost')) value = 'high';
        if (q.includes('best') || q.includes('top') || q.includes('worst')) value = 'high';
        if (q.includes('trend') || q.includes('pattern') || q.includes('growth')) value = 'high';
        
        // Medium value questions
        if (q.includes('average') || q.includes('total') || q.includes('count')) value = 'medium';
        
        // Low value questions
        if (q.includes('list') || q.includes('show all') || q.includes('display')) value = 'low';

        return value;
    }

    storeInsight(insight) {
        const category = insight.category;
        const categoryInsights = this.businessContext.get(category) || [];
        
        // Add new insight
        categoryInsights.unshift(insight);
        
        // Keep only the most recent 50 insights per category
        this.businessContext.set(category, categoryInsights.slice(0, 50));
        
        // Also store recent high-value insights separately
        if (insight.value === 'high') {
            const highValueInsights = this.businessContext.get('high_value_insights') || [];
            highValueInsights.unshift(insight);
            this.businessContext.set('high_value_insights', highValueInsights.slice(0, 20));
        }
    }

    updatePerformanceMetrics(insight, results) {
        // Track query performance
        const metrics = this.performanceMetrics.get('query_stats') || {
            totalQueries: 0,
            byCategory: {},
            successfulQueries: 0,
            averageResultCount: 0
        };

        metrics.totalQueries++;
        metrics.byCategory[insight.category] = (metrics.byCategory[insight.category] || 0) + 1;
        
        if (results && results.length > 0) {
            metrics.successfulQueries++;
            metrics.averageResultCount = (metrics.averageResultCount + results.length) / 2;
        }

        this.performanceMetrics.set('query_stats', metrics);
    }

    // Get business context for AI responses
    getBusinessContext(currentQuestion) {
        const category = this.categorizeBusinessQuestion(currentQuestion);
        const recentInsights = this.businessContext.get(category) || [];
        const highValueInsights = this.businessContext.get('high_value_insights') || [];
        
        let context = '';
        
        // Add recent insights from the same category
        if (recentInsights.length > 0) {
            const recentQuestions = recentInsights.slice(0, 3).map(i => i.question);
            context += `\n🔍 **RECENT ${category.toUpperCase()} QUESTIONS**: ${recentQuestions.join(', ')}`;
        }

        // Add high-value insights
        if (highValueInsights.length > 0) {
            const highValueQuestions = highValueInsights.slice(0, 2).map(i => i.question);
            context += `\n💎 **RECENT HIGH-VALUE INSIGHTS**: ${highValueQuestions.join(', ')}`;
        }

        return context;
    }

    // Generate smart follow-up suggestions based on business intelligence
    getFollowUpSuggestions(currentQuestion, results) {
        const category = this.categorizeBusinessQuestion(currentQuestion);
        
        const suggestions = {
            revenue_analysis: [
                "Which months show the highest revenue growth?",
                "What's the profit margin breakdown by project type?",
                "How does revenue compare across branches?"
            ],
            sales_performance: [
                "Which salespeople have the highest conversion rates?",
                "What's the average deal size by salesperson?",
                "Who needs additional sales training or support?"
            ],
            branch_performance: [
                "Which branches are most profitable?",
                "What are the operational differences between top branches?",
                "Which locations have the best follow-up success rates?"
            ],
            lead_management: [
                "What's our lead-to-sale conversion rate?",
                "Which lead sources provide the highest quality prospects?",
                "How can we improve our pipeline efficiency?"
            ],
            timing_analysis: [
                "What's the optimal follow-up timing for each salesperson?",
                "Which time of year generates the most leads?",
                "How can we reduce time-to-close?"
            ],
            cost_analysis: [
                "Where can we optimize our pricing strategy?",
                "Which projects have the best profit margins?",
                "How can we reduce subcontractor costs?"
            ]
        };

        return suggestions[category] || [
            "What trends do you see in this data?",
            "How can we improve these results?",
            "What actions should we take based on this information?"
        ];
    }

    // Get performance insights for the dashboard
    getPerformanceInsights() {
        const stats = this.performanceMetrics.get('query_stats') || {};
        const insights = [];

        if (stats.totalQueries > 10) {
            const successRate = (stats.successfulQueries / stats.totalQueries) * 100;
            insights.push(`📊 Query Success Rate: ${successRate.toFixed(1)}%`);
        }

        if (stats.byCategory) {
            const topCategory = Object.keys(stats.byCategory).reduce((a, b) => 
                stats.byCategory[a] > stats.byCategory[b] ? a : b
            );
            insights.push(`🔥 Most Asked About: ${topCategory.replace('_', ' ')}`);
        }

        return insights;
    }

    // Business intelligence recommendations
    getBusinessRecommendations() {
        const recommendations = [];
        const stats = this.performanceMetrics.get('query_stats') || {};
        
        if (stats.byCategory) {
            const categories = Object.keys(stats.byCategory);
            
            if (!categories.includes('cost_analysis')) {
                recommendations.push("💡 Consider analyzing your profit margins and cost structure");
            }
            
            if (!categories.includes('timing_analysis')) {
                recommendations.push("⏰ Look into optimizing your follow-up timing for better conversions");
            }
            
            if (!categories.includes('sales_performance')) {
                recommendations.push("🎯 Analyze individual salesperson performance for training opportunities");
            }
        }

        return recommendations;
    }

    // Clear all business intelligence data
    clearAllData() {
        this.performanceMetrics.flushAll();
        this.salesPatterns.flushAll();
        this.customerInsights.flushAll();
        this.marketTrends.flushAll();
        this.businessContext.flushAll();
        console.log('🧹 All business intelligence data cleared');
    }

    // Export business intelligence summary
    exportSummary() {
        return {
            queryStats: this.performanceMetrics.get('query_stats'),
            businessCategories: Object.keys(this.businessContext.keys()),
            insights: this.getPerformanceInsights(),
            recommendations: this.getBusinessRecommendations(),
            timestamp: new Date()
        };
    }
}

// Singleton instance
const businessIntelligence = new BusinessIntelligence();

module.exports = businessIntelligence; 