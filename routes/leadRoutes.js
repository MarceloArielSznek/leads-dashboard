/**
 * @fileoverview Lead Routes - HTTP route definitions for lead management
 * @description This module defines all HTTP routes for lead operations including
 * retrieval, status updates, and notes management. Routes delegate to the lead controller.
 * @author Leads Dashboard Team
 * @version 1.0.0
 */

// Dependencies
const express = require('express');
const leadController = require('../controllers/leadController');
const { 
    authenticateToken,
    validateLeadCreate, 
    validateLeadUpdate,
    validatePositiveInteger,
    validateJSON,
    validateRequiredFields,
    validatePositiveIntegerFields,
    validateStringFields,
    sanitizeStrings
} = require('../middleware');

// Initialize router
const router = express.Router();

// =============================================================================
// LEAD RETRIEVAL ROUTES
// =============================================================================

/**
 * @route GET /lead/campaign/:campaignId
 * @description Retrieve all leads for a specific campaign
 * @param {string} campaignId - Campaign ID to fetch leads for (must be positive integer)
 * @returns {Array<Object>} Array of lead objects
 * @example GET /lead/campaign/123
 */
router.get('/campaign/:campaignId', 
  validatePositiveInteger('campaignId'),
  leadController.getLeadsByCampaign
);

/**
 * @route GET /lead/:id
 * @description Retrieve a single lead by ID
 * @param {string} id - Lead ID to fetch (must be positive integer)
 * @returns {Object} Lead object with all details
 * @example GET /lead/456
 */
router.get('/:id', 
  validatePositiveInteger('id'),
  leadController.getLeadById
);

// =============================================================================
// LEAD STATUS MANAGEMENT ROUTES
// =============================================================================

/**
 * @route PATCH /lead/:id/status
 * @description Update a lead's status
 * @param {string} id - Lead ID to update (must be positive integer)
 * @body {number} status_id - New status ID to assign (must be positive integer)
 * @returns {Object} Updated lead object
 * @example PATCH /lead/456/status
 * Body: { "status_id": 3 }
 */
router.patch('/:id/status', 
  validatePositiveInteger('id'),
  validateJSON,
  validateRequiredFields(['status_id']),
  validatePositiveIntegerFields(['status_id']),
  leadController.updateLeadStatus
);

// =============================================================================
// LEAD NOTES MANAGEMENT ROUTES
// =============================================================================

/**
 * @route POST /lead/:id/notes
 * @description Add a new note to a lead
 * @param {string} id - Lead ID to add note to (must be positive integer)
 * @body {string} note - Note text content (required, max 1000 characters)
 * @returns {Object} Created note object
 * @example POST /lead/456/notes
 * Body: { "note": "Called customer, left voicemail" }
 */
router.post('/:id/notes', 
  validatePositiveInteger('id'),
  validateJSON,
  sanitizeStrings(1000),
  validateRequiredFields(['note']),
  validateStringFields(['note']),
  leadController.addLeadNote
);

/**
 * @route GET /lead/:id/notes
 * @description Retrieve all notes for a specific lead
 * @param {string} id - Lead ID to fetch notes for (must be positive integer)
 * @returns {Array<Object>} Array of note objects
 * @example GET /lead/456/notes
 */
router.get('/:id/notes', 
  validatePositiveInteger('id'),
  leadController.getLeadNotes
);

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = router; 