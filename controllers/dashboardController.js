/**
 * @fileoverview Dashboard Controller - Handles Mailchimp integration and dashboard operations
 * @description This controller manages Mailchimp API interactions for contact exports,
 * tag management, and list field configuration for the leads dashboard system.
 * @author Leads Dashboard Team
 * @version 1.0.0
 */

// Dependencies
const mailchimp = require('@mailchimp/mailchimp_marketing');
const crypto = require('crypto');

// =============================================================================
// CONFIGURATION
// =============================================================================

/**
 * Mailchimp API Configuration
 * @constant {Object} MAILCHIMP_CONFIG
 */
const MAILCHIMP_CONFIG = {
  apiKey: process.env.MAILCHIMP_API_KEY || '',
  server: process.env.MAILCHIMP_SERVER || 'us10',
  listId: process.env.MAILCHIMP_LIST_ID || ''
};

// Initialize Mailchimp configuration
mailchimp.setConfig({
  apiKey: MAILCHIMP_CONFIG.apiKey,
  server: MAILCHIMP_CONFIG.server,
});

// =============================================================================
// MAILCHIMP EXPORT OPERATIONS
// =============================================================================

/**
 * Exports contacts to Mailchimp with tags and merge fields
 * 
 * @async
 * @function exportToMailchimp
 * @description Processes an array of contacts and exports them to the configured 
 * Mailchimp list. Handles tag management by removing existing tags and applying 
 * new ones. Includes comprehensive logging for tracking export success/failure.
 * 
 * @param {Object} req - Express request object
 * @param {Object} req.body - Request body containing export data
 * @param {Array<Object>} req.body.contacts - Array of contact objects to export
 * @param {string} req.body.contacts[].email - Contact's email address
 * @param {string} req.body.contacts[].first_name - Contact's first name
 * @param {string} req.body.contacts[].last_name - Contact's last name
 * @param {Array<string>} req.body.tags - Array of tag names to apply to contacts
 * @param {Object} res - Express response object
 * 
 * @returns {Promise<void>} Returns JSON response with export results
 * 
 * @throws {Error} When Mailchimp API calls fail or contact processing errors occur
 * 
 * @example
 * // POST /mailchimp/export
 * {
 *   "contacts": [
 *     { "email": "user@example.com", "first_name": "John", "last_name": "Doe" }
 *   ],
 *   "tags": ["New Lead", "Website"]
 * }
 * 
 * @see {@link https://mailchimp.com/developer/marketing/api/list-members/} Mailchimp Members API
 */
exports.exportToMailchimp = async (req, res) => {
  const { contacts, tags } = req.body;
  const listId = MAILCHIMP_CONFIG.listId;
  
  // Validation
  if (!contacts || !Array.isArray(contacts) || contacts.length === 0) {
    return res.status(400).json({ 
      error: 'Invalid or empty contacts array provided' 
    });
  }
  
  try {
    const results = [];
    
    // Process each contact individually
    for (const contact of contacts) {
      try {
        // Generate MD5 hash for email (required by Mailchimp API)
        const emailHash = crypto
          .createHash('md5')
          .update(contact.email.toLowerCase())
          .digest('hex');
        
        // Fetch existing tags for the contact
        let currentTags = [];
        try {
          const tagResponse = await mailchimp.lists.getListMemberTags(listId, emailHash);
          currentTags = (tagResponse.tags || []).map(tag => tag.name);
        } catch (tagError) {
          // Contact doesn't exist yet, which is fine
          if (tagError.status !== 404) throw tagError;
        }
        
        // Remove all existing tags if any exist
        if (currentTags.length > 0) {
          const tagsToRemove = currentTags.map(name => ({ 
            name, 
            status: 'inactive' 
          }));
          await mailchimp.lists.updateListMemberTags(listId, emailHash, { 
            tags: tagsToRemove 
          });
        }
        
        // Prepare member data for Mailchimp
        const memberData = {
          email_address: contact.email,
          status: 'subscribed',
          merge_fields: {},
          tags: tags || []
        };
        
        // Add all contact fields (except email and tags) to merge_fields
        Object.entries(contact).forEach(([key, value]) => {
          if (key !== 'email' && key !== 'tags') {
            memberData.merge_fields[key] = value;
          }
        });
        
        // Add/update member in Mailchimp
        const response = await mailchimp.lists.addListMember(listId, memberData);
        results.push({ email: contact.email, status: 'success' });
        
      } catch (contactError) {
        console.error(`Error exporting contact: ${contact.email}`, contactError.message);
        results.push({ 
          email: contact.email, 
          status: 'error', 
          error: contactError.message 
        });
      }
    }
    
    res.json({ results });
    
  } catch (fatalError) {
    console.error('Fatal error in exportToMailchimp:', fatalError);
    res.status(500).json({ 
      error: 'Internal server error during export',
      details: fatalError.message 
    });
  }
};

// =============================================================================
// MAILCHIMP DATA RETRIEVAL OPERATIONS
// =============================================================================

/**
 * Retrieves available Mailchimp segments/tags filtered by criteria
 * 
 * @async
 * @function getMailchimpTags
 * @description Fetches all static segments from the configured Mailchimp list,
 * filtered to show only segments containing 'marcelo' in the name. Uses pagination
 * to retrieve all available segments beyond the default limit.
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * 
 * @returns {Promise<void>} Returns JSON array of segment objects
 * 
 * @throws {Error} When Mailchimp API calls fail
 * 
 * @example
 * // GET /mailchimp/tags
 * // Response:
 * [
 *   { "id": "12345", "name": "Marcelo Orange County" },
 *   { "id": "67890", "name": "Marcelo San Diego" }
 * ]
 * 
 * @see {@link https://mailchimp.com/developer/marketing/api/list-segments/} Mailchimp Segments API
 */
exports.getMailchimpTags = async (req, res) => {
  const listId = MAILCHIMP_CONFIG.listId;
  
  try {
    let allSegments = [];
    let offset = 0;
    const limit = 100; // Maximum allowed by Mailchimp API
    
    // Paginate through all segments
    while (true) {
      const response = await mailchimp.lists.listSegments(listId, {
        type: 'static',
        count: limit,
        offset: offset
      });
      
      // Filter segments containing 'marcelo' and format response
      const segments = response.segments
        .filter(segment => segment.name.toLowerCase().includes('marcelo'))
        .map(segment => ({
          id: segment.id,
          name: segment.name
        }));
      
      allSegments = [...allSegments, ...segments];
      
      // Break if we've received less than the limit (no more data)
      if (response.segments.length < limit) {
        break;
      }
      
      offset += limit;
    }
    
    res.json(allSegments);
    
  } catch (error) {
    console.error('Error retrieving Mailchimp tags:', error);
    res.status(500).json({ 
      error: 'Failed to retrieve Mailchimp tags',
      details: error.message 
    });
  }
};

/**
 * Retrieves Mailchimp list merge fields configuration
 * 
 * @async
 * @function getMailchimpListFields
 * @description Fetches all available merge fields from the configured Mailchimp list,
 * including the default EMAIL field. These fields define what data can be stored
 * for each contact in the list.
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * 
 * @returns {Promise<void>} Returns JSON array of field objects
 * 
 * @throws {Error} When Mailchimp API calls fail
 * 
 * @example
 * // GET /mailchimp/fields
 * // Response:
 * [
 *   { "tag": "EMAIL", "name": "Email Address", "type": "email", "required": true },
 *   { "tag": "FNAME", "name": "First Name", "type": "text", "required": false }
 * ]
 * 
 * @see {@link https://mailchimp.com/developer/marketing/api/list-merge-fields/} Mailchimp Merge Fields API
 */
exports.getMailchimpListFields = async (req, res) => {
  const listId = MAILCHIMP_CONFIG.listId;
  
  try {
    const response = await mailchimp.lists.getListMergeFields(listId);
    
    // Combine default EMAIL field with configured merge fields
    const fields = [
      {
        tag: 'EMAIL',
        name: 'Email Address',
        type: 'email',
        required: true
      },
      ...response.merge_fields.map(field => ({
        tag: field.tag,
        name: field.name,
        type: field.type,
        required: field.required
      }))
    ];
    
    res.json(fields);
    
  } catch (error) {
    console.error('Error retrieving Mailchimp list fields:', error);
    res.status(500).json({ 
      error: 'Failed to retrieve Mailchimp list fields',
      details: error.message 
    });
  }
}; 