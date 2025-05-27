const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const dashboardController = require('../controllers/dashboardController');

// Tags
router.get('/tags', adminController.getTags);
router.post('/tags', adminController.createTag);
router.put('/tags/:id', adminController.updateTag);
router.delete('/tags/:id', adminController.deleteTag);

// Statuses
router.get('/statuses', adminController.getStatuses);
router.post('/statuses', adminController.createStatus);
router.put('/statuses/:id', adminController.updateStatus);
router.delete('/statuses/:id', adminController.deleteStatus);

// Branches
router.get('/branches', adminController.getBranches);
router.post('/branches', adminController.createBranch);
router.put('/branches/:id', adminController.updateBranch);
router.delete('/branches/:id', adminController.deleteBranch);

// Campaign Types
router.get('/campaign_types', adminController.getCampaignTypes);
router.post('/campaign_types', adminController.createCampaignType);
router.put('/campaign_types/:id', adminController.updateCampaignType);
router.delete('/campaign_types/:id', adminController.deleteCampaignType);

// Sales Persons
router.get('/sales_persons', adminController.getSalesPersons);
router.post('/sales_persons', adminController.createSalesPerson);
router.put('/sales_persons/:id', adminController.updateSalesPerson);
router.delete('/sales_persons/:id', adminController.deleteSalesPerson);

// Conditions
router.get('/conditions', adminController.getConditions);
router.post('/conditions', adminController.createCondition);
router.put('/conditions/:id', adminController.updateCondition);
router.delete('/conditions/:id', adminController.deleteCondition);

// Sources
router.get('/sources', adminController.getSources);
router.post('/sources', adminController.createSource);
router.put('/sources/:id', adminController.updateSource);
router.delete('/sources/:id', adminController.deleteSource);

// Proposal Statuses
router.get('/proposal_statuses', adminController.getProposalStatuses);
router.post('/proposal_statuses', adminController.createProposalStatus);
router.put('/proposal_statuses/:id', adminController.updateProposalStatus);
router.delete('/proposal_statuses/:id', adminController.deleteProposalStatus);

router.post('/export-to-mailchimp', dashboardController.exportToMailchimp);
router.get('/mailchimp-tags', dashboardController.getMailchimpTags);
router.get('/mailchimp-fields', dashboardController.getMailchimpListFields);

module.exports = router; 