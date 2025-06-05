/**
 * @fileoverview Lead Service - Business logic for lead management operations
 * @description This service handles all lead-related business logic including CRUD operations,
 * status updates, notes management, and data validation for the leads dashboard system.
 * @author Leads Dashboard Team
 * @version 1.0.0
 */

// Dependencies
const db = require('../config/database');

// =============================================================================
// LEAD RETRIEVAL OPERATIONS
// =============================================================================

/**
 * Retrieves all leads for a specific campaign
 * 
 * @async
 * @function getLeadsByCampaign
 * @description Fetches all leads associated with a campaign ID, ordered by creation date (newest first).
 * This is commonly used for displaying campaign-specific lead lists in the dashboard.
 * 
 * @param {number} campaignId - The campaign ID to fetch leads for
 * @returns {Promise<Array<Object>>} Array of lead objects with all fields
 * 
 * @throws {Error} When database query fails
 * 
 * @example
 * const leads = await leadService.getLeadsByCampaign(123);
 * // Returns: [{ id: 1, name: "John Doe", email: "john@example.com", ... }]
 */
async function getLeadsByCampaign(campaignId) {
  try {
    const result = await db.query(
      'SELECT * FROM leads_dashboard.lead WHERE campaign_id = $1 ORDER BY created_at DESC',
      [campaignId]
    );
    return result.rows;
  } catch (error) {
    throw new Error(`Failed to fetch leads for campaign ${campaignId}: ${error.message}`);
  }
}

/**
 * Retrieves a single lead by ID
 * 
 * @async
 * @function getLeadById
 * @description Fetches detailed information for a specific lead by its unique identifier.
 * Used for lead detail views and individual lead operations.
 * 
 * @param {number} leadId - The unique lead identifier
 * @returns {Promise<Object|null>} Lead object if found, null if not found
 * 
 * @throws {Error} When database query fails
 * 
 * @example
 * const lead = await leadService.getLeadById(456);
 * // Returns: { id: 456, name: "Jane Smith", email: "jane@example.com", ... } or null
 */
async function getLeadById(leadId) {
  try {
    const result = await db.query(
      'SELECT * FROM leads_dashboard.lead WHERE id = $1',
      [leadId]
    );
    return result.rows.length > 0 ? result.rows[0] : null;
  } catch (error) {
    throw new Error(`Failed to fetch lead ${leadId}: ${error.message}`);
  }
}

// =============================================================================
// LEAD STATUS MANAGEMENT
// =============================================================================

/**
 * Updates a lead's status
 * 
 * @async
 * @function updateLeadStatus
 * @description Changes the status of a lead and updates the modification timestamp.
 * This is a critical operation for lead lifecycle management and reporting.
 * 
 * @param {number} leadId - The unique lead identifier
 * @param {number} statusId - The new status ID to assign
 * @returns {Promise<Object|null>} Updated lead object if successful, null if lead not found
 * 
 * @throws {Error} When database query fails or status update is invalid
 * 
 * @example
 * const updatedLead = await leadService.updateLeadStatus(456, 3);
 * // Returns: { id: 456, lead_status_id: 3, updated_at: "2024-01-15T10:30:00Z", ... }
 */
async function updateLeadStatus(leadId, statusId) {
  try {
    // Validate status ID exists (optional - can be added later)
    // TODO: Add status validation by checking against lead_status table
    
    const result = await db.query(
      'UPDATE leads_dashboard.lead SET lead_status_id = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [statusId, leadId]
    );
    
    return result.rows.length > 0 ? result.rows[0] : null;
  } catch (error) {
    throw new Error(`Failed to update status for lead ${leadId}: ${error.message}`);
  }
}

// =============================================================================
// LEAD NOTES OPERATIONS
// =============================================================================

/**
 * Adds a note to a lead
 * 
 * @async
 * @function addLeadNote
 * @description Creates a new note entry associated with a specific lead.
 * Notes are used for tracking interactions, updates, and important information about leads.
 * 
 * @param {number} leadId - The unique lead identifier
 * @param {string} noteText - The note content to add
 * @returns {Promise<Object>} Created note object with ID and timestamp
 * 
 * @throws {Error} When database insertion fails or note text is invalid
 * 
 * @example
 * const note = await leadService.addLeadNote(456, "Called customer, left voicemail");
 * // Returns: { id: 789, lead_id: 456, note: "Called customer...", created_at: "2024-01-15T10:30:00Z" }
 */
async function addLeadNote(leadId, noteText) {
  try {
    // Validate note text
    if (!noteText || typeof noteText !== 'string' || noteText.trim().length === 0) {
      throw new Error('Note text is required and cannot be empty');
    }
    
    const result = await db.query(
      'INSERT INTO lead_notes (lead_id, note, created_at) VALUES ($1, $2, NOW()) RETURNING *',
      [leadId, noteText.trim()]
    );
    
    return result.rows[0];
  } catch (error) {
    throw new Error(`Failed to add note to lead ${leadId}: ${error.message}`);
  }
}

/**
 * Retrieves all notes for a specific lead
 * 
 * @async
 * @function getLeadNotes
 * @description Fetches all notes associated with a lead, ordered by creation date (newest first).
 * Used for displaying lead interaction history and tracking communication.
 * 
 * @param {number} leadId - The unique lead identifier
 * @returns {Promise<Array<Object>>} Array of note objects ordered by creation date
 * 
 * @throws {Error} When database query fails
 * 
 * @example
 * const notes = await leadService.getLeadNotes(456);
 * // Returns: [
 * //   { id: 789, lead_id: 456, note: "Follow-up call scheduled", created_at: "2024-01-15T10:30:00Z" },
 * //   { id: 788, lead_id: 456, note: "Initial contact made", created_at: "2024-01-14T09:15:00Z" }
 * // ]
 */
async function getLeadNotes(leadId) {
  try {
    const result = await db.query(
      'SELECT * FROM lead_notes WHERE lead_id = $1 ORDER BY created_at DESC',
      [leadId]
    );
    return result.rows;
  } catch (error) {
    throw new Error(`Failed to fetch notes for lead ${leadId}: ${error.message}`);
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  getLeadsByCampaign,
  getLeadById,
  updateLeadStatus,
  addLeadNote,
  getLeadNotes
}; 