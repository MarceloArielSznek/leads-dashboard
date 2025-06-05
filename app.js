require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3000;

// Security middleware
app.use(helmet({
    contentSecurityPolicy: false, // Disable CSP for development
    crossOriginEmbedderPolicy: false
}));

// CORS configuration
app.use(cors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Trust proxy for rate limiting and IP detection
app.set('trust proxy', 1);

// Middleware
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

app.use(session({
    secret: process.env.SESSION_SECRET || 'your-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

// View engine setup
app.set('view engine', 'ejs');
app.set('views', require('path').join(__dirname, 'views'));

// Import authentication middleware
const { apiLimiter, optionalAuth, authenticateToken } = require('./middleware');

// Apply general rate limiting to all routes
app.use('/api', apiLimiter);

// Authentication routes (no auth required)
const authRoutes = require('./routes/authRoutes');
app.use('/api/auth', authRoutes);

// Import other routes
const campaignRoutes = require('./routes/campaignRoutes');
const leadRoutes = require('./routes/leadRoutes');
const adminRoutes = require('./routes/adminRoutes');
const importRoutes = require('./routes/importRoutes');
const insightRoutes = require('./routes/insightRoutes');
const mailchimpRoutes = require('./routes/mailchimpRoutes');

// Apply optional authentication to all routes (for logging and user context)
app.use(optionalAuth);

// API routes (will require authentication based on individual route needs)
app.use('/campaign', campaignRoutes);
app.use('/lead', leadRoutes);
app.use('/admin', adminRoutes);
app.use('/import', importRoutes);
app.use('/insights', insightRoutes);
app.use('/mailchimp', mailchimpRoutes);

// Create uploads directory if it doesn't exist
const fs = require('fs');
if (!fs.existsSync('uploads')) {
    fs.mkdirSync('uploads');
}

// Public routes (no authentication required)
app.get('/', (req, res) => {
    // Check if user is authenticated via optional auth middleware
    if (req.user) {
        res.redirect('/dashboard');
    } else {
        res.redirect('/login');
    }
});

// Login page route
app.get('/login', (req, res) => {
    // If user is already authenticated, redirect to dashboard
    if (req.user) {
        return res.redirect('/dashboard');
    }
    res.render('login');
});

// Dashboard route (publicly accessible page, authentication handled client-side)
app.get('/dashboard', (req, res) => {
    res.render('dashboard');
});

// Admin panel route (publicly accessible page, authentication handled client-side)
app.get('/admin-panel', (req, res) => {
    res.render('admin');
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        version: require('./package.json').version
    });
});

// API documentation endpoint (development only)
if (process.env.NODE_ENV !== 'production') {
    app.get('/api/docs', (req, res) => {
        res.json({
            message: 'Leads Dashboard API Documentation',
            version: '1.0.0',
            authentication: {
                login: 'POST /api/auth/login',
                refresh: 'POST /api/auth/refresh-token',
                logout: 'POST /api/auth/logout',
                profile: 'GET /api/auth/profile'
            },
            endpoints: {
                campaigns: '/campaign/*',
                leads: '/lead/*',
                admin: '/admin/*',
                insights: '/insights/*',
                mailchimp: '/mailchimp/*'
            },
            roles: ['admin', 'manager', 'salesperson', 'user'],
            rateLimit: {
                general: '1000 requests per 15 minutes',
                auth: '10 attempts per 15 minutes',
                passwordReset: '3 attempts per hour'
            }
        });
    });
}

// Insights route
app.get('/insights', (req, res) => {
    res.render('insights');
});

// Recovered leads route
app.get('/recovered-leads', (req, res) => {
    res.render('recovered-leads');
});

// Import route
app.get('/import', (req, res) => {
    res.render('import');
});

// Export route
app.get('/export', (req, res) => {
    res.render('export');
});

// Lead detail route
app.get('/lead/:id', (req, res) => {
    res.render('lead');
});

// 404 handler
app.use((req, res, next) => {
    res.status(404).json({
        error: 'Endpoint not found',
        path: req.path,
        method: req.method
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Error occurred:', {
        error: err.message,
        stack: err.stack,
        url: req.url,
        method: req.method,
        userAgent: req.get('User-Agent'),
        ip: req.ip
    });

    // Don't leak error details in production
    const isDevelopment = process.env.NODE_ENV !== 'production';
    
    res.status(err.status || 500).json({
        error: isDevelopment ? err.message : 'Internal server error',
        code: err.code || 'INTERNAL_ERROR',
        ...(isDevelopment && { stack: err.stack })
    });
});

// Graceful shutdown handling
process.on('SIGTERM', () => {
    console.log('SIGTERM received. Shutting down gracefully...');
    app.close(() => {
        console.log('Process terminated');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('SIGINT received. Shutting down gracefully...');
    process.exit(0);
});

// Clean up expired sessions periodically (every hour)
const { cleanExpiredSessions } = require('./utils/auth');
setInterval(async () => {
    try {
        const cleaned = await cleanExpiredSessions();
        if (cleaned > 0) {
            console.log(`Cleaned ${cleaned} expired sessions`);
        }
    } catch (error) {
        console.error('Error cleaning expired sessions:', error);
    }
}, 60 * 60 * 1000); // 1 hour

app.listen(port, () => {
    console.log(`🚀 Leads Dashboard Server started on port ${port}`);
    console.log(`📊 Dashboard: http://localhost:${port}/dashboard`);
    console.log(`🔐 Login: http://localhost:${port}/login`);
    console.log(`⚕️  Health: http://localhost:${port}/health`);
    console.log(`📖 API Docs: http://localhost:${port}/api/docs`);
    console.log(`🔑 Environment: ${process.env.NODE_ENV || 'development'}`);
}); 