console.log('🔵 [routes/insightRoutes.js] File loaded and router being configured.');
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const insightController = require('../controllers/insightController');
const { authenticateToken } = require('../middleware');

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadPath = path.join(__dirname, '../uploads/insights');
        
        // Ensure the directory exists
        if (!fs.existsSync(uploadPath)) {
            fs.mkdirSync(uploadPath, { recursive: true });
        }
        
        cb(null, uploadPath);
    },
    filename: function (req, file, cb) {
        cb(null, `insights-${Date.now()}-${file.originalname}`);
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: (req, file, cb) => {
        // Accept CSV files and Excel files (.xls and .xlsx)
        const allowedMimeTypes = [
            'text/csv',                    // CSV files
            'application/vnd.ms-excel',    // Old Excel files (.xls)
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' // New Excel files (.xlsx)
        ];
        
        if (allowedMimeTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Only CSV and Excel files (.csv, .xls, .xlsx) are allowed'));
        }
    }
});

// Basic insight routes - all require authentication
router.get('/', authenticateToken, insightController.getInsightsPage);
router.get('/recovered-leads', authenticateToken, insightController.getRecoveredLeadsPage);
router.get('/branches', authenticateToken, insightController.getBranches);
router.get('/lead-statuses', authenticateToken, insightController.getLeadStatuses);
router.get('/closed-leads', authenticateToken, insightController.getClosedLeads);
router.get('/recovered-leads-data', authenticateToken, insightController.getRecoveredLeads);
router.get('/total-leads-count', authenticateToken, insightController.getTotalLeadsCount);
router.post('/import-closed-leads', authenticateToken, upload.single('file'), insightController.importClosedLeads);

// Enhanced AI and Business Intelligence routes
router.post('/ai-chat', authenticateToken, insightController.handleAiChat);
router.get('/business-intelligence', authenticateToken, insightController.getBusinessIntelligence);
router.post('/clear-business-intelligence', authenticateToken, insightController.clearBusinessIntelligence);
router.get('/smart-suggestions', authenticateToken, insightController.getSmartSuggestions);

module.exports = router; 