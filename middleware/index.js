// Middleware Index - Central Export Point
// This file provides clean imports for all middleware functions

const { 
    authenticateToken, 
    authorizeRoles, 
    requireAuth,
    apiLimiter,
    authLimiter,
    passwordResetLimiter,
    optionalAuth,
    logActivity
} = require('./auth');

const { 
    validateLogin, 
    validateRegistration, 
    validatePasswordReset,
    validateUserUpdate,
    validateLeadCreate,
    validateLeadUpdate,
    validatePositiveInteger,
    validateRequiredFields,
    validatePositiveIntegerFields,
    validateStringFields,
    validateJSON,
    sanitizeStrings
} = require('./validation');

// Export all middleware
module.exports = {
    // Auth middleware
    authenticateToken,
    authorizeRoles,
    requireAuth,
    apiLimiter,
    authLimiter,
    passwordResetLimiter,
    optionalAuth,
    logActivity,
    
    // Validation middleware
    validateLogin,
    validateRegistration,
    validatePasswordReset,
    validateUserUpdate,
    validateLeadCreate,
    validateLeadUpdate,
    validatePositiveInteger,
    validateRequiredFields,
    validatePositiveIntegerFields,
    validateStringFields,
    validateJSON,
    sanitizeStrings
}; 