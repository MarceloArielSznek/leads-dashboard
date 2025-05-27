const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const insightController = require('../controllers/insightController');

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-insights-' + file.originalname);
    }
});

const upload = multer({ 
    storage: storage,
    fileFilter: function (req, file, cb) {
        // Only allow Excel files
        if (file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || 
            file.mimetype === 'application/vnd.ms-excel') {
            cb(null, true);
        } else {
            cb(new Error('Only Excel files (.xlsx, .xls) are allowed'), false);
        }
    }
});

// Insight routes
router.get('/', insightController.getInsightsPage);
router.get('/branches', insightController.getBranches);
router.get('/closed-leads', insightController.getClosedLeads);
router.post('/import-closed-leads', upload.single('file'), insightController.importClosedLeads);
router.post('/ai-chat', insightController.handleAiChat);

module.exports = router; 