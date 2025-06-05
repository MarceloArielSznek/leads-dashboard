const express = require('express');
const router = express.Router();
const campaignController = require('../controllers/campaignController');
const { authenticateToken } = require('../middleware');

// Enhanced campaign routes (Group Builder)
router.get('/available-leads', authenticateToken, campaignController.getAvailableLeads);
router.post('/enhanced', authenticateToken, campaignController.createEnhancedCampaign);

// Group management routes
router.get('/groups', authenticateToken, campaignController.getAllGroups);
router.get('/groups/:id', authenticateToken, campaignController.getGroupById);
router.get('/groups/:id/leads', authenticateToken, campaignController.getGroupLeads);
router.delete('/groups/:id', authenticateToken, campaignController.deleteGroup);
router.delete('/groups/:groupId/leads/:leadId', authenticateToken, campaignController.removeLeadFromGroup);

// CSV Export route
router.post('/export-csv', authenticateToken, campaignController.exportGroupsToCsv);

// Branch routes (still needed for filtering)
router.get('/branches', authenticateToken, campaignController.getBranches);

// Lead routes (still needed for lead management)
router.get('/lead/:id', authenticateToken, campaignController.getLeadById);
router.put('/lead/:id', authenticateToken, campaignController.updateLead);
router.delete('/lead/:id', authenticateToken, campaignController.deleteLead);

// Toggle lead recovered status
router.put('/lead/:leadId/toggle-recovered', authenticateToken, campaignController.toggleLeadRecoveredStatus);

// Toggle lead texted status
router.put('/lead/:leadId/toggle-texted', authenticateToken, campaignController.toggleLeadTextedStatus);

module.exports = router; 