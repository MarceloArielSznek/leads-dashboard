const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { authenticateToken } = require('../middleware');
const dashboardController = require('../controllers/dashboardController');

// Tags
router.get('/tags', authenticateToken, adminController.getTags);
router.post('/tags', authenticateToken, adminController.createTag);
router.put('/tags/:id', authenticateToken, adminController.updateTag);
router.delete('/tags/:id', authenticateToken, adminController.deleteTag);

// Statuses
router.get('/statuses', authenticateToken, adminController.getStatuses);
router.post('/statuses', authenticateToken, adminController.createStatus);
router.put('/statuses/:id', authenticateToken, adminController.updateStatus);
router.delete('/statuses/:id', authenticateToken, adminController.deleteStatus);

// Branches
router.get('/branches', authenticateToken, adminController.getBranches);
router.post('/branches', authenticateToken, adminController.createBranch);
router.put('/branches/:id', authenticateToken, adminController.updateBranch);
router.delete('/branches/:id', authenticateToken, adminController.deleteBranch);

// Sales Persons
router.get('/sales_persons', authenticateToken, adminController.getSalesPersons);
router.post('/sales_persons', authenticateToken, adminController.createSalesPerson);
router.put('/sales_persons/:id', authenticateToken, adminController.updateSalesPerson);
router.delete('/sales_persons/:id', authenticateToken, adminController.deleteSalesPerson);

// Conditions
router.get('/conditions', authenticateToken, adminController.getConditions);
router.post('/conditions', authenticateToken, adminController.createCondition);
router.put('/conditions/:id', authenticateToken, adminController.updateCondition);
router.delete('/conditions/:id', authenticateToken, adminController.deleteCondition);

// Sources
router.get('/sources', authenticateToken, adminController.getSources);
router.post('/sources', authenticateToken, adminController.createSource);
router.put('/sources/:id', authenticateToken, adminController.updateSource);
router.delete('/sources/:id', authenticateToken, adminController.deleteSource);

// Proposal Statuses
router.get('/proposal_statuses', authenticateToken, adminController.getProposalStatuses);
router.post('/proposal_statuses', authenticateToken, adminController.createProposalStatus);
router.put('/proposal_statuses/:id', authenticateToken, adminController.updateProposalStatus);
router.delete('/proposal_statuses/:id', authenticateToken, adminController.deleteProposalStatus);

// Route for API Lead Synchronization
router.post('/actions/sync-leads', authenticateToken, adminController.syncLeadsWithApi);

router.post('/export-to-mailchimp', authenticateToken, dashboardController.exportToMailchimp);
router.get('/mailchimp-tags', authenticateToken, dashboardController.getMailchimpTags);
router.get('/mailchimp-fields', authenticateToken, dashboardController.getMailchimpListFields);

module.exports = router; 