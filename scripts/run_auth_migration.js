const fs = require('fs');
const path = require('path');
const db = require('../config/database');

async function runAuthMigration() {
    try {
        console.log('🔧 Starting authentication system migration...');
        
        // Read the SQL migration file
        const migrationPath = path.join(__dirname, '../database/migrations/001_create_auth_tables.sql');
        const sqlContent = fs.readFileSync(migrationPath, 'utf8');
        
        // Execute the migration
        console.log('📋 Executing SQL migration...');
        await db.query(sqlContent);
        
        console.log('✅ Authentication system migration completed successfully!');
        console.log('');
        console.log('📊 Migration Summary:');
        console.log('- Created roles table with 4 default roles (admin, manager, salesperson, user)');
        console.log('- Created permissions table with granular permissions');
        console.log('- Created role_permissions junction table');
        console.log('- Created users table with comprehensive user management');
        console.log('- Created user_sessions table for session management');
        console.log('- Created user_activity_log table for audit trail');
        console.log('- Added appropriate indexes and triggers');
        console.log('- Inserted default permissions and role assignments');
        console.log('');
        console.log('🔐 Default Admin Account Created:');
        console.log('- Username: admin');
        console.log('- Password: admin123');
        console.log('- Email: admin@company.com');
        console.log('');
        console.log('⚠️  SECURITY NOTICE:');
        console.log('Please change the default admin password immediately after first login!');
        console.log('');
        
        // Verify the migration by checking table counts
        console.log('🔍 Verifying migration...');
        const rolesCount = await db.query('SELECT COUNT(*) FROM leads_dashboard.roles');
        const permissionsCount = await db.query('SELECT COUNT(*) FROM leads_dashboard.permissions');
        const usersCount = await db.query('SELECT COUNT(*) FROM leads_dashboard.users');
        
        console.log(`- Roles created: ${rolesCount.rows[0].count}`);
        console.log(`- Permissions created: ${permissionsCount.rows[0].count}`);
        console.log(`- Users created: ${usersCount.rows[0].count}`);
        console.log('');
        console.log('🎉 Authentication system is ready for use!');
        
    } catch (error) {
        console.error('❌ Migration failed:', error);
        console.error('');
        console.error('💡 Troubleshooting tips:');
        console.error('1. Make sure the database is running and accessible');
        console.error('2. Verify database credentials in .env file');
        console.error('3. Ensure the leads_dashboard schema exists');
        console.error('4. Check if the update_updated_at_column() function exists in the database');
        process.exit(1);
    } finally {
        // Close database connection
        await db.pool.end();
    }
}

// Check if this script is being run directly
if (require.main === module) {
    runAuthMigration();
}

module.exports = { runAuthMigration }; 