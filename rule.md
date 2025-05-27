# Development and Operation Rules for Leads Dashboard

## Code Style Guidelines

1. **JavaScript Style**
   - Use ES6+ features where appropriate
   - Follow camelCase for variable and function names
   - Use PascalCase for class names
   - Use clear, descriptive variable and function names

2. **File Structure**
   - Keep controllers focused on business logic
   - Keep routes focused on API definitions
   - Store reusable utilities in separate modules
   - Organize views by feature when possible

3. **Comments**
   - Add comments for complex logic
   - Document function parameters and return values
   - Comment SQL queries with explanation of intent
   - Keep comments up-to-date with code changes

## Database Guidelines

1. **Schema Management**
   - Use schema.sql for all database structure definitions
   - Document any manual schema changes
   - Use indexes for frequently queried fields
   - Follow naming conventions for database objects

2. **Query Optimization**
   - Use parameterized queries to prevent SQL injection
   - Optimize queries for large datasets
   - Use appropriate joins instead of multiple queries
   - Limit result sets when dealing with large tables

## Lead Management Rules

1. **Lead Creation**
   - Validate lead data before saving to database
   - Required fields: name, created_date
   - Normalize email addresses and phone numbers
   - Check for duplicate leads before creating

2. **Lead Status Updates**
   - Record timestamp with each status change
   - Only authorized users can update lead status
   - Maintain history of status changes
   - Validate status transitions

3. **Lead Assignment**
   - Assign leads based on branch and campaign
   - Distribute leads evenly among sales representatives
   - Allow manual reassignment by administrators
   - Notify sales representatives of new leads

## Campaign Management Rules

1. **Campaign Creation**
   - Validate campaign details before saving
   - Required fields: name, campaign_type_id
   - Associate campaigns with branches
   - Set appropriate defaults for campaign settings

2. **Campaign Operation**
   - Set clear start and end dates for campaigns
   - Define success metrics for each campaign
   - Monitor campaign performance regularly
   - Document campaign strategy and target audience

## Security Rules

1. **Authentication**
   - Use secure password hashing with bcrypt
   - Implement proper session management
   - Set secure and HttpOnly flags for cookies
   - Enforce password complexity requirements

2. **Authorization**
   - Implement role-based access control
   - Restrict sensitive operations to administrators
   - Validate user permissions for each operation
   - Log all security-related events

3. **Data Protection**
   - Sanitize all user inputs
   - Implement CSRF protection
   - Use HTTPS in production
   - Regularly backup database

## File Upload Rules

1. **Excel File Processing**
   - Validate file format before processing
   - Check for required columns
   - Set sensible limits for file size
   - Handle errors gracefully during processing

2. **Storage Management**
   - Store uploaded files in the uploads/ directory
   - Generate unique filenames to prevent collisions
   - Implement cleanup for old uploaded files
   - Validate file types using both extension and MIME type

## Deployment Rules

1. **Environment Configuration**
   - Use .env files for environment-specific configuration
   - Never commit sensitive information to version control
   - Set appropriate production environment variables
   - Document required environment variables

2. **Production Deployment**
   - Test thoroughly before deployment
   - Use a proper process manager (e.g., PM2)
   - Set up monitoring and error reporting
   - Document deployment procedures

## Maintenance Rules

1. **Logging**
   - Log application errors with stack traces
   - Log important business events
   - Implement proper log rotation
   - Review logs regularly for issues

2. **Updates**
   - Keep dependencies up-to-date
   - Schedule regular security updates
   - Test thoroughly after updates
   - Document version changes 