# Leads Dashboard

A comprehensive lead management and analytics dashboard built with Node.js, Express, PostgreSQL, and Vue.js. This application provides powerful insights into sales performance, lead tracking, and campaign management with AI-powered database querying capabilities.

## 🚀 Features

### Core Functionality
- **Lead Management**: Track and manage leads through the entire sales pipeline
- **Campaign Management**: Create and monitor remarketing campaigns
- **Excel Import/Export**: Bulk import closed leads and export data
- **Branch Management**: Multi-branch support with performance analytics
- **Customer Management**: Comprehensive customer and address tracking

### Analytics & Insights
- **Closed Leads Dashboard**: Comprehensive view of closed deals with filtering and pagination
- **Salesperson Performance**: Track individual and team performance metrics
- **Job Type Analysis**: Performance breakdown by property types and job categories
- **Time to Close Analysis**: Distribution and trends of deal closing times
- **Tag-based Analytics**: Sales performance by tags and categories
- **Branch Performance**: Compare performance across different branches

### AI-Powered Features
- **GPT-4 Database Assistant**: Natural language querying of your database
- **Smart SQL Generation**: AI converts questions to SQL queries automatically
- **Intelligent Insights**: Ask complex questions about your data in plain English

### Technical Features
- **Responsive Design**: Modern, mobile-friendly interface
- **Real-time Updates**: Live data updates and notifications
- **Advanced Filtering**: Multi-criteria filtering and search
- **Pagination**: Efficient data handling for large datasets
- **Data Validation**: Comprehensive input validation and error handling

## 🛠️ Technology Stack

- **Backend**: Node.js, Express.js
- **Database**: PostgreSQL with comprehensive schema
- **Frontend**: Vue.js 3, Tailwind CSS, Font Awesome
- **AI Integration**: OpenAI GPT-4 API
- **File Processing**: Excel/CSV import with XLSX library
- **Email Integration**: Mailchimp API support

## 📋 Prerequisites

- Node.js (v14 or higher)
- PostgreSQL (v12 or higher)
- OpenAI API key (for AI chat features)

## 🔧 Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/leads-dashboard.git
   cd leads-dashboard
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up the database**
   - Create a PostgreSQL database
   - Run the schema file to create tables:
   ```bash
   psql -U your_username -d your_database -f schema.sql
   ```

4. **Configure environment variables**
   Create a `.env` file in the root directory:
   ```env
   DB_HOST=localhost
   DB_PORT=5432
   DB_NAME=your_database_name
   DB_USER=your_username
   DB_PASSWORD=your_password
   OPENAI_API_KEY=your_openai_api_key
   ```

5. **Start the application**
   ```bash
   npm start
   ```

6. **Access the application**
   Open your browser and navigate to `http://localhost:3000`

## 📊 Database Schema

The application uses a comprehensive PostgreSQL schema with the following main tables:

- **leads**: Core lead information and tracking
- **campaigns**: Marketing campaign management
- **customers**: Customer information and contact details
- **addresses**: Address management for customers
- **sales_person**: Sales team management
- **branches**: Multi-location support
- **lead_status**: Lead pipeline stages
- **sources**: Lead source tracking
- **tags**: Flexible tagging system
- **property_type**: Property classification

## 🎯 Usage

### Dashboard Navigation
- **Dashboard**: Main overview with key metrics
- **Campaigns**: Manage remarketing campaigns
- **Insights**: Advanced analytics and AI chat

### Importing Data
1. Navigate to the Insights page
2. Click "Import Closed Leads"
3. Select your branch
4. Upload Excel file with the required columns
5. Review import results

### AI Chat Assistant
1. Go to Insights → AI Chat tab
2. Ask questions in natural language:
   - "Who are my best performing salespeople this year?"
   - "Show me leads that took longer than 30 days to close"
   - "What's the revenue trend by month for each branch?"
   - "Find customers from California with deals over $50,000"

### Analytics Features
- **Filter by Branch**: View performance by specific locations
- **Date Range Filtering**: Analyze trends over time periods
- **Salesperson Analysis**: Individual and team performance metrics
- **Property Type Insights**: Performance by job categories

## 📁 Project Structure

```
leads-dashboard/
├── app.js                 # Main application entry point
├── package.json           # Dependencies and scripts
├── schema.sql            # Database schema
├── config/
│   ├── database.js       # Database configuration
│   └── openai.js         # OpenAI API configuration
├── controllers/
│   ├── campaignController.js
│   ├── dashboardController.js
│   └── insightController.js
├── routes/
│   ├── campaignRoutes.js
│   ├── dashboardRoutes.js
│   └── insightRoutes.js
├── views/
│   ├── dashboard.ejs
│   ├── campaigns.ejs
│   └── insights.ejs
└── public/
    └── styles/
        └── style.css
```

## 🔑 Key Features Explained

### Excel Import System
- Supports multiple column name variations (with/without asterisks, contact suffixes)
- Automatic data validation and cleaning
- Individual transaction processing to prevent total failures
- Comprehensive error reporting

### AI Database Assistant
- Powered by OpenAI GPT-4
- Context-aware with full database schema knowledge
- Generates optimized SQL queries
- Provides natural language explanations of results

### Analytics Engine
- Real-time calculations with Vue.js computed properties
- Negative value filtering for data integrity
- Comprehensive performance metrics
- Sortable and filterable results

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

If you encounter any issues or have questions:

1. Check the existing issues on GitHub
2. Create a new issue with detailed information
3. Include error logs and steps to reproduce

## 🔮 Future Enhancements

- [ ] Advanced reporting and dashboards
- [ ] Email automation and notifications
- [ ] Mobile app development
- [ ] Advanced AI features and predictions
- [ ] Integration with more CRM systems
- [ ] Real-time collaboration features

## 📈 Performance

- Optimized database queries with proper indexing
- Efficient pagination for large datasets
- Responsive design for all device sizes
- Fast Excel processing with streaming
- Cached AI responses for common queries

---

**Built with ❤️ for sales teams who need powerful insights and efficient lead management.** 