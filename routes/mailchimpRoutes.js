const express = require('express');
const router = express.Router();
const mailchimpController = require('../controllers/mailchimpController');
const { authenticateToken } = require('../middleware');

// Test Mailchimp connection
router.get('/test-connection', authenticateToken, mailchimpController.testConnection);

// Test tags endpoint directly
router.get('/test-tags/:audienceId', authenticateToken, async (req, res) => {
    try {
        const { audienceId } = req.params;
        console.log(`[TEST] Testing tags for audience: ${audienceId}`);
        
        const response = await fetch(`http://localhost:3000/mailchimp/audiences/${audienceId}/tags`);
        const tags = await response.json();
        
        res.json({
            audienceId,
            tagCount: tags.length,
            tags: tags,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Debug audience info
router.get('/debug/:audienceId', authenticateToken, mailchimpController.debugAudience);

// Debug audience tags comprehensively
router.get('/debug-tags/:audienceId', authenticateToken, mailchimpController.debugAudienceTags);

// Get all Mailchimp audiences
router.get('/audiences', authenticateToken, mailchimpController.getAudiences);

// Get tags for a specific audience
router.get('/audiences/:audienceId/tags', authenticateToken, mailchimpController.getAudienceTags);

// Get merge fields for a specific audience
router.get('/audiences/:audienceId/merge-fields', authenticateToken, mailchimpController.getAudienceMergeFields);

// Export group to new Mailchimp audience
router.post('/export-group', authenticateToken, mailchimpController.exportGroupToMailchimp);

// Export group to existing Mailchimp audience
router.post('/export-to-existing', authenticateToken, mailchimpController.exportGroupToExistingAudience);

// Sync group with Mailchimp and update recovered status
router.post('/sync-with-mailchimp', authenticateToken, mailchimpController.syncWithMailchimp);

// Debug field mappings and data conversion
router.post('/debug-field-mappings', authenticateToken, mailchimpController.debugFieldMappings);

module.exports = router; 