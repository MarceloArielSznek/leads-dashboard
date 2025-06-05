-- Authentication System Migration
-- File: 001_create_auth_tables.sql

-- Set search path to use the existing schema
SET search_path TO leads_dashboard;

-- Create Roles table
CREATE TABLE roles (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE,
    display_name VARCHAR(100) NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create Permissions table
CREATE TABLE permissions (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    display_name VARCHAR(150) NOT NULL,
    description TEXT,
    resource VARCHAR(50) NOT NULL, -- e.g., 'leads', 'campaigns', 'users', 'reports'
    action VARCHAR(50) NOT NULL,   -- e.g., 'create', 'read', 'update', 'delete', 'export'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create Role_Permissions junction table
CREATE TABLE role_permissions (
    role_id INTEGER REFERENCES roles(id) ON DELETE CASCADE,
    permission_id INTEGER REFERENCES permissions(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (role_id, permission_id)
);

-- Create Users table
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    role_id INTEGER REFERENCES roles(id) NOT NULL,
    branch_id INTEGER REFERENCES branch(id), -- Optional: link user to specific branch
    sales_person_id INTEGER REFERENCES sales_person(id), -- Optional: link user to sales person
    is_active BOOLEAN DEFAULT TRUE,
    email_verified BOOLEAN DEFAULT FALSE,
    last_login TIMESTAMP WITH TIME ZONE,
    password_reset_token VARCHAR(255),
    password_reset_expires TIMESTAMP WITH TIME ZONE,
    email_verification_token VARCHAR(255),
    email_verification_expires TIMESTAMP WITH TIME ZONE,
    failed_login_attempts INTEGER DEFAULT 0,
    locked_until TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create User_Sessions table for session management
CREATE TABLE user_sessions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    session_token VARCHAR(255) NOT NULL UNIQUE,
    refresh_token VARCHAR(255) UNIQUE,
    ip_address INET,
    user_agent TEXT,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create User_Activity_Log table for audit trail
CREATE TABLE user_activity_log (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    resource VARCHAR(100),
    resource_id INTEGER,
    details JSONB,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for better performance
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role_id ON users(role_id);
CREATE INDEX idx_users_branch_id ON users(branch_id);
CREATE INDEX idx_users_sales_person_id ON users(sales_person_id);
CREATE INDEX idx_users_is_active ON users(is_active);
CREATE INDEX idx_users_last_login ON users(last_login);

CREATE INDEX idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX idx_user_sessions_session_token ON user_sessions(session_token);
CREATE INDEX idx_user_sessions_refresh_token ON user_sessions(refresh_token);
CREATE INDEX idx_user_sessions_expires_at ON user_sessions(expires_at);
CREATE INDEX idx_user_sessions_is_active ON user_sessions(is_active);

CREATE INDEX idx_role_permissions_role_id ON role_permissions(role_id);
CREATE INDEX idx_role_permissions_permission_id ON role_permissions(permission_id);

CREATE INDEX idx_user_activity_log_user_id ON user_activity_log(user_id);
CREATE INDEX idx_user_activity_log_action ON user_activity_log(action);
CREATE INDEX idx_user_activity_log_resource ON user_activity_log(resource);
CREATE INDEX idx_user_activity_log_created_at ON user_activity_log(created_at);

-- Add triggers for updated_at columns
CREATE TRIGGER update_roles_updated_at
    BEFORE UPDATE ON roles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_permissions_updated_at
    BEFORE UPDATE ON permissions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_sessions_updated_at
    BEFORE UPDATE ON user_sessions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Insert default roles
INSERT INTO roles (name, display_name, description) VALUES
('admin', 'Administrator', 'Full system access with all permissions'),
('manager', 'Manager', 'Management access with reporting and team oversight'),
('salesperson', 'Salesperson', 'Sales access with lead management and limited reporting'),
('user', 'User', 'Basic user access with read-only permissions');

-- Insert default permissions
INSERT INTO permissions (name, display_name, description, resource, action) VALUES
-- Lead permissions
('leads.create', 'Create Leads', 'Create new leads', 'leads', 'create'),
('leads.read', 'View Leads', 'View lead information', 'leads', 'read'),
('leads.update', 'Update Leads', 'Edit lead information', 'leads', 'update'),
('leads.delete', 'Delete Leads', 'Delete leads', 'leads', 'delete'),
('leads.export', 'Export Leads', 'Export lead data', 'leads', 'export'),
('leads.import', 'Import Leads', 'Import lead data', 'leads', 'import'),

-- Campaign permissions
('campaigns.create', 'Create Campaigns', 'Create new campaigns', 'campaigns', 'create'),
('campaigns.read', 'View Campaigns', 'View campaign information', 'campaigns', 'read'),
('campaigns.update', 'Update Campaigns', 'Edit campaign information', 'campaigns', 'update'),
('campaigns.delete', 'Delete Campaigns', 'Delete campaigns', 'campaigns', 'delete'),
('campaigns.manage_groups', 'Manage Campaign Groups', 'Create and manage campaign groups', 'campaigns', 'manage_groups'),

-- User management permissions
('users.create', 'Create Users', 'Create new user accounts', 'users', 'create'),
('users.read', 'View Users', 'View user information', 'users', 'read'),
('users.update', 'Update Users', 'Edit user information', 'users', 'update'),
('users.delete', 'Delete Users', 'Delete user accounts', 'users', 'delete'),
('users.manage_roles', 'Manage User Roles', 'Assign and modify user roles', 'users', 'manage_roles'),

-- Reporting permissions
('reports.view', 'View Reports', 'Access reporting dashboard', 'reports', 'read'),
('reports.advanced', 'Advanced Reports', 'Access advanced reporting features', 'reports', 'advanced'),
('reports.export', 'Export Reports', 'Export report data', 'reports', 'export'),

-- System permissions
('system.admin', 'System Administration', 'Full system administration access', 'system', 'admin'),
('system.settings', 'System Settings', 'Modify system settings', 'system', 'settings'),
('system.audit', 'View Audit Logs', 'Access system audit logs', 'system', 'audit'),

-- Mailchimp permissions
('mailchimp.export', 'Mailchimp Export', 'Export data to Mailchimp', 'mailchimp', 'export'),
('mailchimp.sync', 'Mailchimp Sync', 'Sync data with Mailchimp', 'mailchimp', 'sync'),

-- Branch permissions
('branches.read', 'View Branches', 'View branch information', 'branches', 'read'),
('branches.update', 'Update Branches', 'Edit branch information', 'branches', 'update'),
('branches.manage', 'Manage Branches', 'Full branch management access', 'branches', 'manage');

-- Assign permissions to roles
-- Admin: All permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'admin';

-- Manager: Most permissions except user management and system admin
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'manager'
AND p.name NOT IN ('users.create', 'users.delete', 'users.manage_roles', 'system.admin', 'system.settings');

-- Salesperson: Lead and campaign read/update, basic reporting
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'salesperson'
AND p.name IN (
    'leads.create', 'leads.read', 'leads.update', 'leads.export',
    'campaigns.read', 'campaigns.manage_groups',
    'reports.view', 'reports.export',
    'mailchimp.export', 'mailchimp.sync',
    'branches.read'
);

-- User: Basic read permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'user'
AND p.name IN (
    'leads.read',
    'campaigns.read',
    'reports.view',
    'branches.read'
);

-- Create default admin user (password: admin123 - should be changed immediately)
-- Password hash for 'admin123' using bcrypt with salt rounds 12
INSERT INTO users (username, email, password_hash, first_name, last_name, role_id, is_active, email_verified)
SELECT 'admin', 'admin@company.com', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewQWP5kCFGOHlBhK', 'System', 'Administrator', r.id, true, true
FROM roles r
WHERE r.name = 'admin';

COMMENT ON TABLE roles IS 'User roles for role-based access control';
COMMENT ON TABLE permissions IS 'System permissions for granular access control';
COMMENT ON TABLE role_permissions IS 'Junction table linking roles to permissions';
COMMENT ON TABLE users IS 'User accounts with authentication and profile information';
COMMENT ON TABLE user_sessions IS 'Active user sessions for session management';
COMMENT ON TABLE user_activity_log IS 'Audit trail of user actions';

COMMENT ON COLUMN users.password_hash IS 'Bcrypt hashed password';
COMMENT ON COLUMN users.failed_login_attempts IS 'Number of consecutive failed login attempts';
COMMENT ON COLUMN users.locked_until IS 'Account locked until this timestamp';
COMMENT ON COLUMN user_sessions.session_token IS 'JWT or session token for authentication';
COMMENT ON COLUMN user_sessions.refresh_token IS 'Token for refreshing expired sessions'; 