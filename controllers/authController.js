const { body, validationResult } = require('express-validator');
const {
    getUserByCredential,
    comparePassword,
    generateAccessToken,
    generateRefreshToken,
    createSession,
    getSessionByRefreshToken,
    invalidateSession,
    invalidateAllUserSessions,
    updateUserLogin,
    isAccountLocked,
    logUserActivity,
    hashPassword,
    generateSecureToken,
    validatePasswordStrength,
    getUserPermissions
} = require('../utils/auth');
const db = require('../config/database');

/**
 * Login Controller
 */
const login = async (req, res) => {
    try {
        // Validate input
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'Validation failed',
                details: errors.array()
            });
        }

        const { credential, password, rememberMe = false } = req.body;
        const ipAddress = req.ip || req.connection.remoteAddress;
        const userAgent = req.get('User-Agent');

        // Get user by username or email
        const user = await getUserByCredential(credential);
        if (!user) {
            // Log failed login attempt (no user found)
            await logUserActivity(
                null,
                'login_failed',
                'auth',
                null,
                { credential, reason: 'user_not_found' },
                ipAddress,
                userAgent
            );

            return res.status(401).json({
                error: 'Invalid credentials',
                code: 'INVALID_CREDENTIALS'
            });
        }

        // Check if account is locked
        const lockStatus = await isAccountLocked(user.id);
        if (lockStatus.locked) {
            // Log locked account attempt
            await logUserActivity(
                user.id,
                'login_failed',
                'auth',
                null,
                { credential, reason: 'account_locked', until: lockStatus.until },
                ipAddress,
                userAgent
            );

            return res.status(423).json({
                error: 'Account is temporarily locked due to too many failed login attempts',
                code: 'ACCOUNT_LOCKED',
                lockedUntil: lockStatus.until,
                failedAttempts: lockStatus.attempts
            });
        }

        // Check password
        const isValidPassword = await comparePassword(password, user.password_hash);
        if (!isValidPassword) {
            // Update failed login attempts
            await updateUserLogin(user.id, false);

            // Log failed login attempt
            await logUserActivity(
                user.id,
                'login_failed',
                'auth',
                null,
                { credential, reason: 'invalid_password' },
                ipAddress,
                userAgent
            );

            return res.status(401).json({
                error: 'Invalid credentials',
                code: 'INVALID_CREDENTIALS'
            });
        }

        // Check if user account is active
        if (!user.is_active) {
            await logUserActivity(
                user.id,
                'login_failed',
                'auth',
                null,
                { credential, reason: 'account_inactive' },
                ipAddress,
                userAgent
            );

            return res.status(403).json({
                error: 'Account is deactivated',
                code: 'ACCOUNT_INACTIVE'
            });
        }

        // Generate tokens
        const accessTokenPayload = {
            userId: user.id,
            username: user.username,
            email: user.email,
            roleId: user.role_id,
            roleName: user.role_name,
            branchId: user.branch_id,
            salesPersonId: user.sales_person_id
        };

        const accessToken = generateAccessToken(accessTokenPayload);
        const refreshToken = generateRefreshToken();

        // Create session
        const session = await createSession(user.id, refreshToken, ipAddress, userAgent);

        // Update user login info (reset failed attempts, update last login)
        await updateUserLogin(user.id, true);

        // Get user permissions
        const permissions = await getUserPermissions(user.id);

        // Log successful login
        await logUserActivity(
            user.id,
            'login_success',
            'auth',
            null,
            { credential, session_id: session.id },
            ipAddress,
            userAgent
        );

        // Set refresh token in httpOnly cookie
        res.cookie('refreshToken', refreshToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: rememberMe ? 30 * 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000 // 30 days or 7 days
        });

        res.json({
            message: 'Login successful',
            accessToken,
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                firstName: user.first_name,
                lastName: user.last_name,
                role: {
                    id: user.role_id,
                    name: user.role_name,
                    displayName: user.role_display_name
                },
                branch: user.branch_name ? {
                    id: user.branch_id,
                    name: user.branch_name
                } : null,
                salesPerson: user.sales_person_name ? {
                    id: user.sales_person_id,
                    name: user.sales_person_name
                } : null,
                lastLogin: user.last_login,
                emailVerified: user.email_verified
            },
            permissions: permissions.map(p => ({
                name: p.name,
                resource: p.resource,
                action: p.action,
                displayName: p.display_name
            }))
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({
            error: 'Internal server error during login',
            code: 'LOGIN_ERROR'
        });
    }
};

/**
 * Refresh Token Controller
 */
const refreshToken = async (req, res) => {
    try {
        const refreshToken = req.cookies.refreshToken;
        
        if (!refreshToken) {
            return res.status(401).json({
                error: 'Refresh token not provided',
                code: 'REFRESH_TOKEN_MISSING'
            });
        }

        // Get session by refresh token
        const session = await getSessionByRefreshToken(refreshToken);
        if (!session) {
            return res.status(401).json({
                error: 'Invalid or expired refresh token',
                code: 'INVALID_REFRESH_TOKEN'
            });
        }

        // Generate new access token
        const accessTokenPayload = {
            userId: session.user_id,
            username: session.username,
            email: session.email,
            roleId: session.role_id,
            roleName: session.role_name,
            branchId: session.branch_id,
            salesPersonId: session.sales_person_id
        };

        const newAccessToken = generateAccessToken(accessTokenPayload);

        // Log token refresh
        await logUserActivity(
            session.user_id,
            'token_refresh',
            'auth',
            null,
            { session_id: session.id },
            req.ip,
            req.get('User-Agent')
        );

        res.json({
            message: 'Token refreshed successfully',
            accessToken: newAccessToken
        });

    } catch (error) {
        console.error('Token refresh error:', error);
        res.status(500).json({
            error: 'Internal server error during token refresh',
            code: 'TOKEN_REFRESH_ERROR'
        });
    }
};

/**
 * Logout Controller
 */
const logout = async (req, res) => {
    try {
        const refreshToken = req.cookies.refreshToken;
        const authHeader = req.headers['authorization'];
        const accessToken = authHeader && authHeader.split(' ')[1];

        if (refreshToken) {
            // Get session to log user activity
            const session = await getSessionByRefreshToken(refreshToken);
            if (session) {
                // Invalidate session
                await invalidateSession(session.session_token);

                // Log logout
                await logUserActivity(
                    session.user_id,
                    'logout',
                    'auth',
                    null,
                    { session_id: session.id },
                    req.ip,
                    req.get('User-Agent')
                );
            }
        }

        // Clear refresh token cookie
        res.clearCookie('refreshToken');

        res.json({
            message: 'Logged out successfully'
        });

    } catch (error) {
        console.error('Logout error:', error);
        res.status(500).json({
            error: 'Internal server error during logout',
            code: 'LOGOUT_ERROR'
        });
    }
};

/**
 * Logout All Devices Controller
 */
const logoutAll = async (req, res) => {
    try {
        const userId = req.user.id;

        // Invalidate all user sessions
        await invalidateAllUserSessions(userId);

        // Log logout all
        await logUserActivity(
            userId,
            'logout_all_devices',
            'auth',
            null,
            null,
            req.ip,
            req.get('User-Agent')
        );

        // Clear refresh token cookie
        res.clearCookie('refreshToken');

        res.json({
            message: 'Logged out from all devices successfully'
        });

    } catch (error) {
        console.error('Logout all error:', error);
        res.status(500).json({
            error: 'Internal server error during logout all',
            code: 'LOGOUT_ALL_ERROR'
        });
    }
};

/**
 * Get Current User Profile
 */
const getProfile = async (req, res) => {
    try {
        const userId = req.user.id;

        // Get fresh user data
        const query = `
            SELECT u.*, r.name as role_name, r.display_name as role_display_name,
                   b.name as branch_name, sp.name as sales_person_name
            FROM leads_dashboard.users u
            JOIN leads_dashboard.roles r ON u.role_id = r.id
            LEFT JOIN leads_dashboard.branch b ON u.branch_id = b.id
            LEFT JOIN leads_dashboard.sales_person sp ON u.sales_person_id = sp.id
            WHERE u.id = $1 AND u.is_active = true
        `;

        const result = await db.query(query, [userId]);
        const user = result.rows[0];

        if (!user) {
            return res.status(404).json({
                error: 'User not found',
                code: 'USER_NOT_FOUND'
            });
        }

        // Get user permissions
        const permissions = await getUserPermissions(userId);

        res.json({
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                firstName: user.first_name,
                lastName: user.last_name,
                role: {
                    id: user.role_id,
                    name: user.role_name,
                    displayName: user.role_display_name
                },
                branch: user.branch_name ? {
                    id: user.branch_id,
                    name: user.branch_name
                } : null,
                salesPerson: user.sales_person_name ? {
                    id: user.sales_person_id,
                    name: user.sales_person_name
                } : null,
                lastLogin: user.last_login,
                emailVerified: user.email_verified,
                createdAt: user.created_at
            },
            permissions: permissions.map(p => ({
                name: p.name,
                resource: p.resource,
                action: p.action,
                displayName: p.display_name
            }))
        });

    } catch (error) {
        console.error('Get profile error:', error);
        res.status(500).json({
            error: 'Internal server error',
            code: 'GET_PROFILE_ERROR'
        });
    }
};

/**
 * Change Password Controller
 */
const changePassword = async (req, res) => {
    try {
        // Validate input
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'Validation failed',
                details: errors.array()
            });
        }

        const { currentPassword, newPassword } = req.body;
        const userId = req.user.id;

        // Get current user
        const user = await getUserByCredential(req.user.username);
        if (!user) {
            return res.status(404).json({
                error: 'User not found',
                code: 'USER_NOT_FOUND'
            });
        }

        // Verify current password
        const isValidPassword = await comparePassword(currentPassword, user.password_hash);
        if (!isValidPassword) {
            await logUserActivity(
                userId,
                'password_change_failed',
                'auth',
                null,
                { reason: 'invalid_current_password' },
                req.ip,
                req.get('User-Agent')
            );

            return res.status(401).json({
                error: 'Current password is incorrect',
                code: 'INVALID_CURRENT_PASSWORD'
            });
        }

        // Validate new password strength
        const passwordValidation = validatePasswordStrength(newPassword);
        if (!passwordValidation.isValid) {
            return res.status(400).json({
                error: 'Password does not meet security requirements',
                code: 'WEAK_PASSWORD',
                details: passwordValidation.errors
            });
        }

        // Hash new password
        const hashedPassword = await hashPassword(newPassword);

        // Update password in database
        const updateQuery = `
            UPDATE leads_dashboard.users 
            SET password_hash = $1, updated_at = NOW()
            WHERE id = $2
        `;
        await db.query(updateQuery, [hashedPassword, userId]);

        // Log password change
        await logUserActivity(
            userId,
            'password_changed',
            'auth',
            null,
            null,
            req.ip,
            req.get('User-Agent')
        );

        res.json({
            message: 'Password changed successfully'
        });

    } catch (error) {
        console.error('Change password error:', error);
        res.status(500).json({
            error: 'Internal server error during password change',
            code: 'PASSWORD_CHANGE_ERROR'
        });
    }
};

/**
 * Validation rules for authentication endpoints
 */
const loginValidation = [
    body('credential')
        .notEmpty()
        .withMessage('Username or email is required')
        .isLength({ min: 3 })
        .withMessage('Credential must be at least 3 characters long'),
    body('password')
        .notEmpty()
        .withMessage('Password is required')
        .isLength({ min: 1 })
        .withMessage('Password cannot be empty')
];

const changePasswordValidation = [
    body('currentPassword')
        .notEmpty()
        .withMessage('Current password is required'),
    body('newPassword')
        .isLength({ min: 8 })
        .withMessage('New password must be at least 8 characters long')
        .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?])/)
        .withMessage('New password must contain at least one uppercase letter, one lowercase letter, one number, and one special character')
];

module.exports = {
    login,
    refreshToken,
    logout,
    logoutAll,
    getProfile,
    changePassword,
    loginValidation,
    changePasswordValidation
}; 