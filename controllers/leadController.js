/**
 * @fileoverview Lead Controller - Handles HTTP requests for lead management operations
 * @description This controller manages HTTP requests related to leads, delegating business logic
 * to the lead service layer. Handles request validation, response formatting, and error handling.
 * @author Leads Dashboard Team
 * @version 1.0.0
 */

// Dependencies
const leadService = require('../services/leadService');
const { 
  listResponse, 
  itemResponse, 
  updatedResponse, 
  createdResponse,
  notFoundResponse,
  serverErrorResponse,
  validationErrorResponse
} = require('../utils/responseHelpers');

// =============================================================================
// LEAD RETRIEVAL ENDPOINTS
// =============================================================================

/**
 * Get all leads for a specific campaign
 * 
 * @async
 * @function getLeadsByCampaign
 * @description HTTP endpoint to retrieve all leads associated with a campaign.
 * Returns leads ordered by creation date (newest first).
 * 
 * @param {Object} req - Express request object
 * @param {Object} req.params - Request parameters
 * @param {number} req.params.campaignId - Campaign ID to fetch leads for (validated by middleware)
 * @param {Object} res - Express response object
 * 
 * @returns {Promise<void>} JSON response with leads array or error message
 * 
 * @example
 * // GET /api/leads/campaign/123
 * // Response: { success: true, data: [...], meta: { count: 5 } }
 * 
 * @throws {500} When database operation fails
 */
exports.getLeadsByCampaign = async (req, res) => {
  try {
    const { campaignId } = req.params; // Already validated as positive integer by middleware
    
    // Fetch leads from service
    const leads = await leadService.getLeadsByCampaign(campaignId);
    
    res.json(listResponse(leads, 'Leads retrieved successfully'));
    
  } catch (error) {
    console.error('Error in getLeadsByCampaign:', error);
    res.status(500).json(serverErrorResponse('Failed to retrieve leads for campaign', error.message));
  }
};

/**
 * Get a single lead by ID
 * 
 * @async
 * @function getLeadById
 * @description HTTP endpoint to retrieve detailed information for a specific lead.
 * Used for lead detail views and individual lead operations.
 * 
 * @param {Object} req - Express request object
 * @param {Object} req.params - Request parameters
 * @param {number} req.params.id - Lead ID to fetch (validated by middleware)
 * @param {Object} res - Express response object
 * 
 * @returns {Promise<void>} JSON response with lead object or error message
 * 
 * @example
 * // GET /api/leads/456
 * // Response: { success: true, data: { id: 456, name: "Jane Smith", ... } }
 * 
 * @throws {404} When lead is not found
 * @throws {500} When database operation fails
 */
exports.getLeadById = async (req, res) => {
  try {
    const { id } = req.params; // Already validated as positive integer by middleware
    
    // Fetch lead from service
    const lead = await leadService.getLeadById(id);
    
    if (!lead) {
      return res.status(404).json(notFoundResponse('Lead', id));
    }
    
    res.json(itemResponse(lead, 'Lead retrieved successfully'));
    
  } catch (error) {
    console.error('Error in getLeadById:', error);
    res.status(500).json(serverErrorResponse('Failed to retrieve lead', error.message));
  }
};

// =============================================================================
// LEAD STATUS MANAGEMENT ENDPOINTS
// =============================================================================

/**
 * Update a lead's status
 * 
 * @async
 * @function updateLeadStatus
 * @description HTTP endpoint to change a lead's status. Updates the status ID
 * and modification timestamp for tracking lead lifecycle changes.
 * 
 * @param {Object} req - Express request object
 * @param {Object} req.params - Request parameters
 * @param {number} req.params.id - Lead ID to update (validated by middleware)
 * @param {Object} req.body - Request body
 * @param {number} req.body.status_id - New status ID to assign (validated by middleware)
 * @param {Object} res - Express response object
 * 
 * @returns {Promise<void>} JSON response with updated lead or error message
 * 
 * @example
 * // PATCH /api/leads/456/status
 * // Body: { "status_id": 3 }
 * // Response: { success: true, data: { id: 456, lead_status_id: 3, ... } }
 * 
 * @throws {404} When lead is not found
 * @throws {500} When database operation fails
 */
exports.updateLeadStatus = async (req, res) => {
  try {
    const { id } = req.params; // Already validated by middleware
    const { status_id } = req.body; // Already validated by middleware
    
    // Update lead status via service
    const updatedLead = await leadService.updateLeadStatus(id, status_id);
    
    if (!updatedLead) {
      return res.status(404).json(notFoundResponse('Lead', id));
    }
    
    res.json(updatedResponse(updatedLead, 'Lead status updated successfully'));
    
  } catch (error) {
    console.error('Error in updateLeadStatus:', error);
    res.status(500).json(serverErrorResponse('Failed to update lead status', error.message));
  }
};

// =============================================================================
// LEAD NOTES MANAGEMENT ENDPOINTS
// =============================================================================

/**
 * Add a note to a lead
 * 
 * @async
 * @function addLeadNote
 * @description HTTP endpoint to create a new note for a specific lead.
 * Notes are used for tracking interactions and important lead information.
 * 
 * @param {Object} req - Express request object
 * @param {Object} req.params - Request parameters
 * @param {number} req.params.id - Lead ID to add note to (validated by middleware)
 * @param {Object} req.body - Request body
 * @param {string} req.body.note - Note text content (validated by middleware)
 * @param {Object} res - Express response object
 * 
 * @returns {Promise<void>} JSON response with created note or error message
 * 
 * @example
 * // POST /api/leads/456/notes
 * // Body: { "note": "Called customer, left voicemail" }
 * // Response: { success: true, data: { id: 789, lead_id: 456, note: "...", ... } }
 * 
 * @throws {500} When database operation fails
 */
exports.addLeadNote = async (req, res) => {
  try {
    const { id } = req.params; // Already validated by middleware
    const { note } = req.body; // Already validated by middleware
    
    // Add note via service
    const createdNote = await leadService.addLeadNote(id, note);
    
    res.status(201).json(createdResponse(createdNote, 'Note added successfully'));
    
  } catch (error) {
    console.error('Error in addLeadNote:', error);
    res.status(500).json(serverErrorResponse('Failed to add note to lead', error.message));
  }
};

/**
 * Get all notes for a specific lead
 * 
 * @async
 * @function getLeadNotes
 * @description HTTP endpoint to retrieve all notes associated with a lead.
 * Returns notes ordered by creation date (newest first) for viewing interaction history.
 * 
 * @param {Object} req - Express request object
 * @param {Object} req.params - Request parameters
 * @param {number} req.params.id - Lead ID to fetch notes for (validated by middleware)
 * @param {Object} res - Express response object
 * 
 * @returns {Promise<void>} JSON response with notes array or error message
 * 
 * @example
 * // GET /api/leads/456/notes
 * // Response: { success: true, data: [...], meta: { count: 3 } }
 * 
 * @throws {500} When database operation fails
 */
exports.getLeadNotes = async (req, res) => {
  try {
    const { id } = req.params; // Already validated by middleware
    
    // Fetch notes from service
    const notes = await leadService.getLeadNotes(id);
    
    res.json(listResponse(notes, 'Lead notes retrieved successfully'));
    
  } catch (error) {
    console.error('Error in getLeadNotes:', error);
    res.status(500).json(serverErrorResponse('Failed to retrieve lead notes', error.message));
  }
}; 