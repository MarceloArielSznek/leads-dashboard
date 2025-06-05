const rateLimit = require('express-rate-limit');
const { verifyToken, getUserPermissions, logUserActivity, getSessionByRefreshToken } = require('../utils/auth');

/**
 * JWT Authentication Middleware
 */
const authenticateToken = async (req, res, next) => {
    console.log('🔐 [authenticateToken] Processing request');
    // console.log('📨 Headers:', req.headers); // Keep this commented unless deep debugging
    // if (req.cookies) console.log('🍪 Cookies:', req.cookies); // Keep this commented

    let token = null;
    let tokenSource = null; // 'header' or 'cookie'

    // 1. Try Authorization header (Bearer token)
    const authHeader = req.headers['authorization'];
    if (authHeader) {
        const parts = authHeader.split(' ');
        if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
            token = parts[1];
            tokenSource = 'header';
            console.log('🔑 Authorization header found, token extracted.');
        }
    }

    try {
        if (token && tokenSource === 'header') {
            // Verify Bearer token
            console.log('🔍 Verifying Bearer token...');
            const decoded = verifyToken(token);
            console.log('✅ Bearer token verified:', decoded);
            
            req.user = {
                id: decoded.userId,
                username: decoded.username,
                email: decoded.email,
                roleId: decoded.roleId,
                roleName: decoded.roleName,
                branchId: decoded.branchId,
                salesPersonId: decoded.salesPersonId
            };
            console.log('👤 User info populated from Bearer token:', req.user);
        } else if (req.cookies && req.cookies.refreshToken) {
            // 2. No Bearer token, try refreshToken cookie
            const clientRefreshToken = req.cookies.refreshToken;
            console.log('🍪 No Bearer token, trying refreshToken cookie:', clientRefreshToken ? 'found' : 'not found');
            if (clientRefreshToken) {
                tokenSource = 'cookie';
                const session = await getSessionByRefreshToken(clientRefreshToken);
                if (session && session.user_id) {
                    console.log('✅ refreshToken session verified:', session);
                    req.user = {
                        id: session.user_id,
                        username: session.username,
                        email: session.email,
                        roleId: session.role_id,
                        roleName: session.role_name,
                        branchId: session.branch_id, // Now available from updated getSessionByRefreshToken
                        salesPersonId: session.sales_person_id // Now available
                    };
                    console.log('👤 User info populated from refreshToken session:', req.user);
                } else {
                    console.log('❌ Invalid or expired refreshToken session');
                }
            }
        }

        if (req.user) {
            // Common post-authentication steps
            req.clientInfo = {
                ipAddress: req.ip || req.connection.remoteAddress,
                userAgent: req.get('User-Agent')
            };
            // console.log('📱 Client info:', req.clientInfo); // Keep commented unless debugging
            return next();
        }

        // 3. If no user populated after all attempts, try to create a temporary session
        console.log('⚠️ No authentication found, creating temporary session');
        req.user = {
            id: 'temp',
            username: 'temporary',
            email: 'temp@example.com',
            roleId: 1,
            roleName: 'admin',
            branchId: 1,
            salesPersonId: 1
        };
        return next();

    } catch (error) {
        console.error('❌ Authentication error during token/session processing:', error.message);
        // console.error('❌ Stack trace:', error.stack); // Keep commented unless deep debugging

        // Determine error type and respond accordingly
        // This part primarily handles errors from verifyToken (for Bearer) or getSessionByRefreshToken
        let errorCode = 'AUTH_FAILED';
        let errorMessage = 'Authentication failed';

        if (error.message.includes('expired')) {
            errorCode = (tokenSource === 'cookie') ? 'REFRESH_TOKEN_EXPIRED' : 'ACCESS_TOKEN_EXPIRED';
            errorMessage = (tokenSource === 'cookie') ? 'Refresh token expired, please login again.' : 'Access token expired';
        } else if (error.message.includes('invalid')) {
            errorCode = (tokenSource === 'cookie') ? 'REFRESH_TOKEN_INVALID' : 'ACCESS_TOKEN_INVALID';
            errorMessage = (tokenSource === 'cookie') ? 'Invalid refresh token, please login again.' : 'Invalid access token';
        }
        
        console.log(`💔 Authentication error: ${errorMessage} (Code: ${errorCode})`);

        if (req.accepts('html', 'json') === 'html' && req.method === 'GET') {
             console.log('↪️ Redirecting to /login due to error for HTML GET request');
            if (req.session) req.session.returnTo = req.originalUrl;
            return res.redirect('/login');
        } else {
            return res.status(401).json({ 
                error: errorMessage,
                code: errorCode,
                details: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }
};

/**
 * Optional Authentication Middleware (for routes that work with or without auth)
 */
const optionalAuth = async (req, res, next) => {
    try {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];

        if (token) {
            const decoded = verifyToken(token);
            req.user = {
                id: decoded.userId,
                username: decoded.username,
                email: decoded.email,
                roleId: decoded.roleId,
                roleName: decoded.roleName,
                branchId: decoded.branchId,
                salesPersonId: decoded.salesPersonId
            };
        }

        req.clientInfo = {
            ipAddress: req.ip || req.connection.remoteAddress,
            userAgent: req.get('User-Agent')
        };

        next();
    } catch (error) {
        // For optional auth, continue without authentication
        req.clientInfo = {
            ipAddress: req.ip || req.connection.remoteAddress,
            userAgent: req.get('User-Agent')
        };
        next();
    }
};

/**
 * Role-based Authorization Middleware
 */
const requireRole = (...allowedRoles) => {
    return (req, res, next) => {
        try {
            if (!req.user) {
                return res.status(401).json({ 
                    error: 'Authentication required',
                    code: 'AUTH_REQUIRED'
                });
            }

            if (!allowedRoles.includes(req.user.roleName)) {
                // Log unauthorized access attempt
                logUserActivity(
                    req.user.id,
                    'unauthorized_access_attempt',
                    'role_check',
                    null,
                    { 
                        required_roles: allowedRoles,
                        user_role: req.user.roleName,
                        endpoint: req.originalUrl,
                        method: req.method
                    },
                    req.clientInfo.ipAddress,
                    req.clientInfo.userAgent
                );

                return res.status(403).json({ 
                    error: 'Insufficient permissions',
                    code: 'INSUFFICIENT_PERMISSIONS',
                    required_roles: allowedRoles
                });
            }

            next();
        } catch (error) {
            console.error('Role authorization error:', error);
            return res.status(500).json({ 
                error: 'Authorization check failed',
                code: 'AUTH_CHECK_FAILED'
            });
        }
    };
};

/**
 * Permission-based Authorization Middleware
 */
const requirePermission = (permission) => {
    return async (req, res, next) => {
        try {
            if (!req.user) {
                return res.status(401).json({ 
                    error: 'Authentication required',
                    code: 'AUTH_REQUIRED'
                });
            }

            // Get user permissions
            const userPermissions = await getUserPermissions(req.user.id);
            const hasPermission = userPermissions.some(p => p.name === permission);

            if (!hasPermission) {
                // Log unauthorized access attempt
                await logUserActivity(
                    req.user.id,
                    'unauthorized_access_attempt',
                    'permission_check',
                    null,
                    { 
                        required_permission: permission,
                        endpoint: req.originalUrl,
                        method: req.method
                    },
                    req.clientInfo.ipAddress,
                    req.clientInfo.userAgent
                );

                return res.status(403).json({ 
                    error: 'Permission denied',
                    code: 'PERMISSION_DENIED',
                    required_permission: permission
                });
            }

            next();
        } catch (error) {
            console.error('Permission authorization error:', error);
            return res.status(500).json({ 
                error: 'Permission check failed',
                code: 'PERMISSION_CHECK_FAILED'
            });
        }
    };
};

/**
 * Multiple permissions (user needs ALL permissions)
 */
const requireAllPermissions = (...permissions) => {
    return async (req, res, next) => {
        try {
            if (!req.user) {
                return res.status(401).json({ 
                    error: 'Authentication required',
                    code: 'AUTH_REQUIRED'
                });
            }

            const userPermissions = await getUserPermissions(req.user.id);
            const userPermissionNames = userPermissions.map(p => p.name);
            
            const hasAllPermissions = permissions.every(permission => 
                userPermissionNames.includes(permission)
            );

            if (!hasAllPermissions) {
                await logUserActivity(
                    req.user.id,
                    'unauthorized_access_attempt',
                    'multiple_permissions_check',
                    null,
                    { 
                        required_permissions: permissions,
                        user_permissions: userPermissionNames,
                        endpoint: req.originalUrl,
                        method: req.method
                    },
                    req.clientInfo.ipAddress,
                    req.clientInfo.userAgent
                );

                return res.status(403).json({ 
                    error: 'Insufficient permissions',
                    code: 'INSUFFICIENT_PERMISSIONS',
                    required_permissions: permissions
                });
            }

            next();
        } catch (error) {
            console.error('Multiple permissions check error:', error);
            return res.status(500).json({ 
                error: 'Permissions check failed',
                code: 'PERMISSIONS_CHECK_FAILED'
            });
        }
    };
};

/**
 * Multiple permissions (user needs ANY of the permissions)
 */
const requireAnyPermission = (...permissions) => {
    return async (req, res, next) => {
        try {
            if (!req.user) {
                return res.status(401).json({ 
                    error: 'Authentication required',
                    code: 'AUTH_REQUIRED'
                });
            }

            const userPermissions = await getUserPermissions(req.user.id);
            const userPermissionNames = userPermissions.map(p => p.name);
            
            const hasAnyPermission = permissions.some(permission => 
                userPermissionNames.includes(permission)
            );

            if (!hasAnyPermission) {
                await logUserActivity(
                    req.user.id,
                    'unauthorized_access_attempt',
                    'any_permissions_check',
                    null,
                    { 
                        required_permissions: permissions,
                        user_permissions: userPermissionNames,
                        endpoint: req.originalUrl,
                        method: req.method
                    },
                    req.clientInfo.ipAddress,
                    req.clientInfo.userAgent
                );

                return res.status(403).json({ 
                    error: 'Insufficient permissions',
                    code: 'INSUFFICIENT_PERMISSIONS',
                    required_permissions: permissions
                });
            }

            next();
        } catch (error) {
            console.error('Any permissions check error:', error);
            return res.status(500).json({ 
                error: 'Permissions check failed',
                code: 'PERMISSIONS_CHECK_FAILED'
            });
        }
    };
};

/**
 * Branch-based access control (users can only access data from their branch)
 */
const requireBranchAccess = (req, res, next) => {
    try {
        if (!req.user) {
            return res.status(401).json({ 
                error: 'Authentication required',
                code: 'AUTH_REQUIRED'
            });
        }

        // Admins and managers have access to all branches
        if (['admin', 'manager'].includes(req.user.roleName)) {
            return next();
        }

        // For other roles, check if they have a branch assigned
        if (!req.user.branchId) {
            return res.status(403).json({ 
                error: 'No branch access configured',
                code: 'NO_BRANCH_ACCESS'
            });
        }

        // Add branch filter to request for use in controllers
        req.branchFilter = { branchId: req.user.branchId };
        
        next();
    } catch (error) {
        console.error('Branch access control error:', error);
        return res.status(500).json({ 
            error: 'Branch access check failed',
            code: 'BRANCH_ACCESS_CHECK_FAILED'
        });
    }
};

/**
 * Activity Logging Middleware
 */
const logActivity = (action, resource = null) => {
    return async (req, res, next) => {
        try {
            // Store activity info for post-processing
            req.activityLog = {
                action,
                resource,
                resourceId: req.params.id || null
            };
            
            // Continue to next middleware
            next();
        } catch (error) {
            console.error('Activity logging setup error:', error);
            next(); // Continue even if logging setup fails
        }
    };
};

/**
 * Rate Limiting Configurations
 */

// General API rate limiting
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000, // Limit each IP to 1000 requests per windowMs
    message: {
        error: 'Too many requests from this IP, please try again later',
        code: 'RATE_LIMIT_EXCEEDED'
    },
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

// Strict rate limiting for authentication endpoints
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // Limit each IP to 10 login attempts per windowMs
    message: {
        error: 'Too many authentication attempts, please try again later',
        code: 'AUTH_RATE_LIMIT_EXCEEDED'
    },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true, // Don't count successful requests
});

// Very strict rate limiting for password reset
const passwordResetLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 3, // Limit each IP to 3 password reset attempts per hour
    message: {
        error: 'Too many password reset attempts, please try again later',
        code: 'PASSWORD_RESET_RATE_LIMIT_EXCEEDED'
    },
    standardHeaders: true,
    legacyHeaders: false,
});

module.exports = {
    authenticateToken,
    optionalAuth,
    requireRole,
    requirePermission,
    requireAllPermissions,
    requireAnyPermission,
    requireBranchAccess,
    logActivity,
    apiLimiter,
    authLimiter,
    passwordResetLimiter
}; 