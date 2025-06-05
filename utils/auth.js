const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const db = require('../config/database');

// JWT Configuration
const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d'; // Changed from '15m' to '7d' - Long-lived access token
const REFRESH_TOKEN_EXPIRES_IN = process.env.REFRESH_TOKEN_EXPIRES_IN || '7d'; // Long-lived refresh token
const BCRYPT_ROUNDS = 12;

// Account lockout configuration
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_TIME = 15 * 60 * 1000; // 15 minutes in milliseconds

/**
 * Generate JWT access token
 */
function generateAccessToken(payload) {
    return jwt.sign(payload, JWT_SECRET, {
        expiresIn: JWT_EXPIRES_IN,
        issuer: 'leads-dashboard',
        audience: 'leads-dashboard-users'
    });
}

/**
 * Generate refresh token
 */
function generateRefreshToken() {
    return crypto.randomBytes(64).toString('hex');
}

/**
 * Verify JWT token
 */
function verifyToken(token) {
    try {
        return jwt.verify(token, JWT_SECRET, {
            issuer: 'leads-dashboard',
            audience: 'leads-dashboard-users'
        });
    } catch (error) {
        throw new Error('Invalid or expired token');
    }
}

/**
 * Hash password using bcrypt
 */
async function hashPassword(password) {
    try {
        return await bcrypt.hash(password, BCRYPT_ROUNDS);
    } catch (error) {
        throw new Error('Error hashing password');
    }
}

/**
 * Compare password with hash
 */
async function comparePassword(password, hash) {
    try {
        return await bcrypt.compare(password, hash);
    } catch (error) {
        throw new Error('Error comparing password');
    }
}

/**
 * Generate secure random token for password reset/email verification
 */
function generateSecureToken() {
    return crypto.randomBytes(32).toString('hex');
}

/**
 * Create user session in database
 */
async function createSession(userId, refreshToken, ipAddress, userAgent) {
    try {
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
        
        const query = `
            INSERT INTO leads_dashboard.user_sessions 
            (user_id, session_token, refresh_token, ip_address, user_agent, expires_at, is_active)
            VALUES ($1, $2, $3, $4, $5, $6, true)
            RETURNING id, session_token, expires_at
        `;
        
        const sessionToken = crypto.randomBytes(32).toString('hex');
        const result = await db.query(query, [
            userId, sessionToken, refreshToken, ipAddress, userAgent, expiresAt
        ]);
        
        return result.rows[0];
    } catch (error) {
        throw new Error('Error creating session');
    }
}

/**
 * Get user session by refresh token
 */
async function getSessionByRefreshToken(refreshToken) {
    try {
        const query = `
            SELECT us.*, u.id as user_id, u.username, u.email, u.role_id, u.is_active,
                   u.branch_id, u.sales_person_id, 
                   r.name as role_name, r.display_name as role_display_name
            FROM leads_dashboard.user_sessions us
            JOIN leads_dashboard.users u ON us.user_id = u.id
            JOIN leads_dashboard.roles r ON u.role_id = r.id
            WHERE us.refresh_token = $1 
            AND us.is_active = true 
            AND us.expires_at > NOW()
            AND u.is_active = true
        `;
        
        const result = await db.query(query, [refreshToken]);
        return result.rows[0] || null;
    } catch (error) {
        throw new Error('Error retrieving session');
    }
}

/**
 * Invalidate user session
 */
async function invalidateSession(sessionToken) {
    try {
        const query = `
            UPDATE leads_dashboard.user_sessions 
            SET is_active = false 
            WHERE session_token = $1
        `;
        
        await db.query(query, [sessionToken]);
    } catch (error) {
        throw new Error('Error invalidating session');
    }
}

/**
 * Invalidate all user sessions (for logout all devices)
 */
async function invalidateAllUserSessions(userId) {
    try {
        const query = `
            UPDATE leads_dashboard.user_sessions 
            SET is_active = false 
            WHERE user_id = $1
        `;
        
        await db.query(query, [userId]);
    } catch (error) {
        throw new Error('Error invalidating all sessions');
    }
}

/**
 * Clean expired sessions
 */
async function cleanExpiredSessions() {
    try {
        const query = `
            DELETE FROM leads_dashboard.user_sessions 
            WHERE expires_at < NOW() OR is_active = false
        `;
        
        const result = await db.query(query);
        return result.rowCount;
    } catch (error) {
        console.error('Error cleaning expired sessions:', error);
        return 0;
    }
}

/**
 * Get user by username or email
 */
async function getUserByCredential(credential) {
    try {
        const query = `
            SELECT u.*, r.name as role_name, r.display_name as role_display_name,
                   b.name as branch_name, sp.name as sales_person_name
            FROM leads_dashboard.users u
            JOIN leads_dashboard.roles r ON u.role_id = r.id
            LEFT JOIN leads_dashboard.branch b ON u.branch_id = b.id
            LEFT JOIN leads_dashboard.sales_person sp ON u.sales_person_id = sp.id
            WHERE (u.username = $1 OR u.email = $1) AND u.is_active = true
        `;
        
        const result = await db.query(query, [credential]);
        return result.rows[0] || null;
    } catch (error) {
        throw new Error('Error retrieving user');
    }
}

/**
 * Update user login info
 */
async function updateUserLogin(userId, success = true) {
    try {
        if (success) {
            // Reset failed attempts and update last login
            const query = `
                UPDATE leads_dashboard.users 
                SET last_login = NOW(), failed_login_attempts = 0, locked_until = NULL
                WHERE id = $1
            `;
            await db.query(query, [userId]);
        } else {
            // Increment failed attempts
            const query = `
                UPDATE leads_dashboard.users 
                SET failed_login_attempts = failed_login_attempts + 1,
                    locked_until = CASE 
                        WHEN failed_login_attempts + 1 >= $2 THEN NOW() + INTERVAL '${LOCKOUT_TIME / 1000} seconds'
                        ELSE locked_until
                    END
                WHERE id = $1
            `;
            await db.query(query, [userId, MAX_LOGIN_ATTEMPTS]);
        }
    } catch (error) {
        throw new Error('Error updating user login info');
    }
}

/**
 * Check if user account is locked
 */
async function isAccountLocked(userId) {
    try {
        const query = `
            SELECT locked_until, failed_login_attempts
            FROM leads_dashboard.users
            WHERE id = $1
        `;
        
        const result = await db.query(query, [userId]);
        if (!result.rows[0]) return false;
        
        const { locked_until, failed_login_attempts } = result.rows[0];
        
        // Check if account is currently locked
        if (locked_until && new Date(locked_until) > new Date()) {
            return {
                locked: true,
                until: locked_until,
                attempts: failed_login_attempts
            };
        }
        
        return {
            locked: false,
            attempts: failed_login_attempts
        };
    } catch (error) {
        throw new Error('Error checking account lock status');
    }
}

/**
 * Get user permissions
 */
async function getUserPermissions(userId) {
    try {
        const query = `
            SELECT DISTINCT p.name, p.resource, p.action, p.display_name
            FROM leads_dashboard.users u
            JOIN leads_dashboard.roles r ON u.role_id = r.id
            JOIN leads_dashboard.role_permissions rp ON r.id = rp.role_id
            JOIN leads_dashboard.permissions p ON rp.permission_id = p.id
            WHERE u.id = $1 AND u.is_active = true AND r.is_active = true
        `;
        
        const result = await db.query(query, [userId]);
        return result.rows;
    } catch (error) {
        throw new Error('Error retrieving user permissions');
    }
}

/**
 * Log user activity
 */
async function logUserActivity(userId, action, resource = null, resourceId = null, details = null, ipAddress = null, userAgent = null) {
    try {
        const query = `
            INSERT INTO leads_dashboard.user_activity_log 
            (user_id, action, resource, resource_id, details, ip_address, user_agent)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
        `;
        
        await db.query(query, [
            userId, action, resource, resourceId, 
            details ? JSON.stringify(details) : null, 
            ipAddress, userAgent
        ]);
    } catch (error) {
        console.error('Error logging user activity:', error);
        // Don't throw error to avoid breaking main functionality
    }
}

/**
 * Validate password strength
 */
function validatePasswordStrength(password) {
    const errors = [];
    
    if (password.length < 8) {
        errors.push('Password must be at least 8 characters long');
    }
    
    if (!/[A-Z]/.test(password)) {
        errors.push('Password must contain at least one uppercase letter');
    }
    
    if (!/[a-z]/.test(password)) {
        errors.push('Password must contain at least one lowercase letter');
    }
    
    if (!/\d/.test(password)) {
        errors.push('Password must contain at least one number');
    }
    
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
        errors.push('Password must contain at least one special character');
    }
    
    return {
        isValid: errors.length === 0,
        errors
    };
}

module.exports = {
    generateAccessToken,
    generateRefreshToken,
    verifyToken,
    hashPassword,
    comparePassword,
    generateSecureToken,
    createSession,
    getSessionByRefreshToken,
    invalidateSession,
    invalidateAllUserSessions,
    cleanExpiredSessions,
    getUserByCredential,
    updateUserLogin,
    isAccountLocked,
    getUserPermissions,
    logUserActivity,
    validatePasswordStrength,
    JWT_SECRET,
    JWT_EXPIRES_IN,
    REFRESH_TOKEN_EXPIRES_IN,
    MAX_LOGIN_ATTEMPTS,
    LOCKOUT_TIME
}; 