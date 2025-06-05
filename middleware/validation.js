/**
 * @fileoverview Validation Middleware - Common request validation functions
 * @description This module provides reusable validation middleware for request parameters,
 * body validation, and common input sanitization across the application.
 * @author Leads Dashboard Team
 * @version 1.0.0
 */

// =============================================================================
// PARAMETER VALIDATION MIDDLEWARE
// =============================================================================

/**
 * Validates that a parameter is a positive integer
 * 
 * @function validatePositiveInteger
 * @description Middleware to validate that a specific parameter is a positive integer.
 * Returns 400 error if validation fails, otherwise continues to next middleware.
 * 
 * @param {string} paramName - Name of the parameter to validate
 * @returns {Function} Express middleware function
 * 
 * @example
 * // Use in routes
 * router.get('/leads/:id', validatePositiveInteger('id'), leadController.getLeadById);
 */
function validatePositiveInteger(paramName) {
  return (req, res, next) => {
    const value = req.params[paramName];
    const numValue = parseInt(value, 10);
    
    if (isNaN(numValue) || numValue <= 0) {
      return res.status(400).json({
        error: `Invalid ${paramName}. Must be a positive number.`,
        received: value
      });
    }
    
    // Store parsed value for use in controllers
    req.params[paramName] = numValue;
    next();
  };
}

/**
 * Validates that required body fields are present and non-empty
 * 
 * @function validateRequiredFields
 * @description Middleware to validate that specified fields exist in request body
 * and are not empty (for strings) or null/undefined.
 * 
 * @param {Array<string>} fields - Array of required field names
 * @returns {Function} Express middleware function
 * 
 * @example
 * // Use in routes
 * router.post('/leads/:id/notes', validateRequiredFields(['note']), leadController.addLeadNote);
 */
function validateRequiredFields(fields) {
  return (req, res, next) => {
    const missing = [];
    const empty = [];
    
    for (const field of fields) {
      if (!(field in req.body)) {
        missing.push(field);
      } else if (typeof req.body[field] === 'string' && req.body[field].trim().length === 0) {
        empty.push(field);
      } else if (req.body[field] === null || req.body[field] === undefined) {
        empty.push(field);
      }
    }
    
    if (missing.length > 0) {
      return res.status(400).json({
        error: 'Missing required fields',
        missing: missing
      });
    }
    
    if (empty.length > 0) {
      return res.status(400).json({
        error: 'Required fields cannot be empty',
        empty: empty
      });
    }
    
    next();
  };
}

// =============================================================================
// DATA TYPE VALIDATION MIDDLEWARE
// =============================================================================

/**
 * Validates that specific body fields are positive integers
 * 
 * @function validatePositiveIntegerFields
 * @description Middleware to validate that specified body fields are positive integers.
 * Useful for ID fields and numeric parameters in request bodies.
 * 
 * @param {Array<string>} fields - Array of field names to validate as positive integers
 * @returns {Function} Express middleware function
 * 
 * @example
 * // Use in routes
 * router.patch('/leads/:id/status', validatePositiveIntegerFields(['status_id']), leadController.updateLeadStatus);
 */
function validatePositiveIntegerFields(fields) {
  return (req, res, next) => {
    const invalid = [];
    
    for (const field of fields) {
      if (field in req.body) {
        const value = parseInt(req.body[field], 10);
        if (isNaN(value) || value <= 0) {
          invalid.push({
            field: field,
            received: req.body[field],
            expected: 'positive integer'
          });
        } else {
          // Store parsed value
          req.body[field] = value;
        }
      }
    }
    
    if (invalid.length > 0) {
      return res.status(400).json({
        error: 'Invalid field types',
        invalid: invalid
      });
    }
    
    next();
  };
}

/**
 * Validates that specific body fields are non-empty strings
 * 
 * @function validateStringFields
 * @description Middleware to validate that specified body fields are strings
 * and not empty after trimming whitespace.
 * 
 * @param {Array<string>} fields - Array of field names to validate as strings
 * @returns {Function} Express middleware function
 * 
 * @example
 * // Use in routes
 * router.post('/leads/:id/notes', validateStringFields(['note']), leadController.addLeadNote);
 */
function validateStringFields(fields) {
  return (req, res, next) => {
    const invalid = [];
    
    for (const field of fields) {
      if (field in req.body) {
        const value = req.body[field];
        if (typeof value !== 'string' || value.trim().length === 0) {
          invalid.push({
            field: field,
            received: value,
            expected: 'non-empty string'
          });
        } else {
          // Store trimmed value
          req.body[field] = value.trim();
        }
      }
    }
    
    if (invalid.length > 0) {
      return res.status(400).json({
        error: 'Invalid field types',
        invalid: invalid
      });
    }
    
    next();
  };
}

// =============================================================================
// GENERAL REQUEST VALIDATION MIDDLEWARE
// =============================================================================

/**
 * Validates JSON request body structure
 * 
 * @function validateJSON
 * @description Middleware to ensure request body is valid JSON and not empty.
 * Should be used before other body validation middleware.
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 * 
 * @example
 * // Use in routes that expect JSON body
 * router.post('/leads/:id/notes', validateJSON, validateRequiredFields(['note']), leadController.addLeadNote);
 */
function validateJSON(req, res, next) {
  if (req.method === 'POST' || req.method === 'PATCH' || req.method === 'PUT') {
    if (!req.body || Object.keys(req.body).length === 0) {
      return res.status(400).json({
        error: 'Request body is required and cannot be empty'
      });
    }
  }
  next();
}

/**
 * Sanitizes string inputs by trimming whitespace and limiting length
 * 
 * @function sanitizeStrings
 * @description Middleware to sanitize string inputs by trimming whitespace
 * and optionally limiting maximum length to prevent abuse.
 * 
 * @param {number} maxLength - Maximum allowed string length (default: 1000)
 * @returns {Function} Express middleware function
 * 
 * @example
 * // Use in routes with text input
 * router.post('/leads/:id/notes', sanitizeStrings(500), leadController.addLeadNote);
 */
function sanitizeStrings(maxLength = 1000) {
  return (req, res, next) => {
    const tooLong = [];
    
    for (const [key, value] of Object.entries(req.body)) {
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed.length > maxLength) {
          tooLong.push({
            field: key,
            length: trimmed.length,
            maxLength: maxLength
          });
        } else {
          req.body[key] = trimmed;
        }
      }
    }
    
    if (tooLong.length > 0) {
      return res.status(400).json({
        error: 'Fields exceed maximum length',
        tooLong: tooLong
      });
    }
    
    next();
  };
}

// =============================================================================
// EXPORTS
// =============================================================================

/**
 * Validates lead creation request
 */
function validateLeadCreate(req, res, next) {
    const requiredFields = ['name', 'branch_id'];
    return validateRequiredFields(requiredFields)(req, res, next);
}

/**
 * Validates lead update request
 */
function validateLeadUpdate(req, res, next) {
    // Allow any valid lead fields, but ensure they're properly formatted
    return validateJSON(req, res, next);
}

/**
 * Validates login request
 */
function validateLogin(req, res, next) {
    const requiredFields = ['username', 'password'];
    return validateRequiredFields(requiredFields)(req, res, next);
}

/**
 * Validates registration request
 */
function validateRegistration(req, res, next) {
    const requiredFields = ['username', 'email', 'password', 'role_id'];
    return validateRequiredFields(requiredFields)(req, res, next);
}

/**
 * Validates password reset request
 */
function validatePasswordReset(req, res, next) {
    const requiredFields = ['email'];
    return validateRequiredFields(requiredFields)(req, res, next);
}

/**
 * Validates user update request
 */
function validateUserUpdate(req, res, next) {
    return validateJSON(req, res, next);
}

module.exports = {
  validatePositiveInteger,
  validateRequiredFields,
  validatePositiveIntegerFields,
  validateStringFields,
  validateJSON,
  sanitizeStrings,
  validateLogin,
  validateRegistration,
  validatePasswordReset,
  validateUserUpdate,
  validateLeadCreate,
  validateLeadUpdate
}; 