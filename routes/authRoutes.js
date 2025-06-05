const express = require('express');
const router = express.Router();
const {
    login,
    refreshToken,
    logout,
    logoutAll,
    getProfile,
    changePassword,
    loginValidation,
    changePasswordValidation
} = require('../controllers/authController');
const {
    authenticateToken,
    authLimiter,
    passwordResetLimiter,
    logActivity
} = require('../middleware/auth');

/**
 * Authentication Routes
 */

// Login endpoint with rate limiting
router.post('/login', 
    authLimiter,
    loginValidation,
    logActivity('login_attempt', 'auth'),
    login
);

// Refresh token endpoint
router.post('/refresh-token', 
    logActivity('token_refresh_attempt', 'auth'),
    refreshToken
);

// Logout endpoint
router.post('/logout', 
    logActivity('logout_attempt', 'auth'),
    logout
);

// Logout from all devices endpoint (requires authentication)
router.post('/logout-all', 
    authenticateToken,
    logActivity('logout_all_attempt', 'auth'),
    logoutAll
);

// Get current user profile (requires authentication)
router.get('/profile', 
    authenticateToken,
    logActivity('profile_access', 'auth'),
    getProfile
);

// Change password endpoint (requires authentication)
router.post('/change-password', 
    authenticateToken,
    authLimiter,
    changePasswordValidation,
    logActivity('password_change_attempt', 'auth'),
    changePassword
);

/**
 * Health check endpoint for authentication service
 */
router.get('/health', (req, res) => {
    res.json({
        service: 'Authentication Service',
        status: 'healthy',
        timestamp: new Date().toISOString()
    });
});

/**
 * Get authentication status (check if user is logged in)
 */
router.get('/status', authenticateToken, (req, res) => {
    res.json({
        authenticated: true,
        user: req.user
    });
});

module.exports = router; 