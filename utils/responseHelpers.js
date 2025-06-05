/**
 * @fileoverview Response Helpers - Standardized API response utilities
 * @description This module provides utility functions for creating consistent
 * API responses across all controllers and endpoints in the application.
 * @author Leads Dashboard Team
 * @version 1.0.0
 */

// =============================================================================
// SUCCESS RESPONSE HELPERS
// =============================================================================

/**
 * Creates a standardized success response
 * 
 * @function successResponse
 * @description Generates a consistent success response object with optional data and metadata
 * 
 * @param {*} data - The data to include in the response
 * @param {string} message - Optional success message
 * @param {Object} meta - Optional metadata (pagination, counts, etc.)
 * @returns {Object} Standardized success response object
 * 
 * @example
 * const response = successResponse(leads, 'Leads retrieved successfully', { count: leads.length });
 * // Returns: { success: true, message: '...', data: [...], meta: { count: 5 } }
 */
function successResponse(data, message = 'Operation completed successfully', meta = null) {
  const response = {
    success: true,
    message,
    data
  };
  
  if (meta) {
    response.meta = meta;
  }
  
  return response;
}

/**
 * Creates a standardized success response for lists/arrays
 * 
 * @function listResponse
 * @description Generates a consistent response for list endpoints with automatic count metadata
 * 
 * @param {Array} items - Array of items to return
 * @param {string} message - Optional success message
 * @param {Object} additionalMeta - Optional additional metadata
 * @returns {Object} Standardized list response object
 * 
 * @example
 * const response = listResponse(leads, 'Leads retrieved successfully');
 * // Returns: { success: true, message: '...', data: [...], meta: { count: 5 } }
 */
function listResponse(items, message = 'Items retrieved successfully', additionalMeta = {}) {
  return successResponse(items, message, {
    count: items.length,
    ...additionalMeta
  });
}

/**
 * Creates a standardized success response for single item
 * 
 * @function itemResponse
 * @description Generates a consistent response for single item endpoints
 * 
 * @param {*} item - The item to return
 * @param {string} message - Optional success message
 * @returns {Object} Standardized item response object
 * 
 * @example
 * const response = itemResponse(lead, 'Lead retrieved successfully');
 * // Returns: { success: true, message: '...', data: { id: 1, ... } }
 */
function itemResponse(item, message = 'Item retrieved successfully') {
  return successResponse(item, message);
}

/**
 * Creates a standardized success response for creation operations
 * 
 * @function createdResponse
 * @description Generates a consistent response for resource creation endpoints
 * 
 * @param {*} item - The created item to return
 * @param {string} message - Optional success message
 * @returns {Object} Standardized creation response object
 * 
 * @example
 * const response = createdResponse(newNote, 'Note created successfully');
 * // Returns: { success: true, message: '...', data: { id: 1, ... } }
 */
function createdResponse(item, message = 'Resource created successfully') {
  return successResponse(item, message);
}

/**
 * Creates a standardized success response for update operations
 * 
 * @function updatedResponse
 * @description Generates a consistent response for resource update endpoints
 * 
 * @param {*} item - The updated item to return
 * @param {string} message - Optional success message
 * @returns {Object} Standardized update response object
 * 
 * @example
 * const response = updatedResponse(updatedLead, 'Lead status updated successfully');
 * // Returns: { success: true, message: '...', data: { id: 1, ... } }
 */
function updatedResponse(item, message = 'Resource updated successfully') {
  return successResponse(item, message);
}

// =============================================================================
// ERROR RESPONSE HELPERS
// =============================================================================

/**
 * Creates a standardized error response
 * 
 * @function errorResponse
 * @description Generates a consistent error response object with optional details
 * 
 * @param {string} message - Error message
 * @param {number} statusCode - HTTP status code (default: 500)
 * @param {*} details - Optional error details
 * @param {string} errorCode - Optional application-specific error code
 * @returns {Object} Standardized error response object
 * 
 * @example
 * const response = errorResponse('Lead not found', 404, null, 'LEAD_NOT_FOUND');
 * // Returns: { success: false, error: '...', statusCode: 404, errorCode: 'LEAD_NOT_FOUND' }
 */
function errorResponse(message, statusCode = 500, details = null, errorCode = null) {
  const response = {
    success: false,
    error: message,
    statusCode
  };
  
  if (details) {
    response.details = details;
  }
  
  if (errorCode) {
    response.errorCode = errorCode;
  }
  
  return response;
}

/**
 * Creates a standardized validation error response
 * 
 * @function validationErrorResponse
 * @description Generates a consistent response for validation errors with field details
 * 
 * @param {string} message - General validation error message
 * @param {Array|Object} validationErrors - Specific validation error details
 * @returns {Object} Standardized validation error response object
 * 
 * @example
 * const response = validationErrorResponse('Validation failed', [
 *   { field: 'email', message: 'Invalid email format' }
 * ]);
 */
function validationErrorResponse(message = 'Validation failed', validationErrors = []) {
  return errorResponse(message, 400, validationErrors, 'VALIDATION_ERROR');
}

/**
 * Creates a standardized not found error response
 * 
 * @function notFoundResponse
 * @description Generates a consistent response for resource not found errors
 * 
 * @param {string} resource - Name of the resource that wasn't found
 * @param {*} identifier - The identifier used to search for the resource
 * @returns {Object} Standardized not found error response object
 * 
 * @example
 * const response = notFoundResponse('Lead', 456);
 * // Returns: { success: false, error: 'Lead not found', ... }
 */
function notFoundResponse(resource = 'Resource', identifier = null) {
  const message = `${resource} not found`;
  const details = identifier ? { searchedFor: identifier } : null;
  return errorResponse(message, 404, details, 'RESOURCE_NOT_FOUND');
}

/**
 * Creates a standardized server error response
 * 
 * @function serverErrorResponse
 * @description Generates a consistent response for internal server errors
 * 
 * @param {string} message - Error message (optional, defaults to generic message)
 * @param {*} details - Optional error details (should not expose sensitive info in production)
 * @returns {Object} Standardized server error response object
 * 
 * @example
 * const response = serverErrorResponse('Database connection failed');
 */
function serverErrorResponse(message = 'Internal server error', details = null) {
  // In production, don't expose internal error details
  const productionSafeDetails = process.env.NODE_ENV === 'production' ? null : details;
  return errorResponse(message, 500, productionSafeDetails, 'INTERNAL_SERVER_ERROR');
}

// =============================================================================
// PAGINATION HELPERS
// =============================================================================

/**
 * Creates pagination metadata object
 * 
 * @function createPaginationMeta
 * @description Generates pagination metadata for list responses
 * 
 * @param {number} total - Total number of items
 * @param {number} page - Current page number
 * @param {number} limit - Items per page
 * @returns {Object} Pagination metadata object
 * 
 * @example
 * const meta = createPaginationMeta(150, 2, 20);
 * // Returns: { total: 150, page: 2, limit: 20, pages: 8, hasNext: true, hasPrev: true }
 */
function createPaginationMeta(total, page, limit) {
  const pages = Math.ceil(total / limit);
  
  return {
    total,
    page,
    limit,
    pages,
    hasNext: page < pages,
    hasPrev: page > 1
  };
}

/**
 * Creates a standardized paginated list response
 * 
 * @function paginatedResponse
 * @description Generates a consistent response for paginated list endpoints
 * 
 * @param {Array} items - Array of items for current page
 * @param {number} total - Total number of items across all pages
 * @param {number} page - Current page number
 * @param {number} limit - Items per page
 * @param {string} message - Optional success message
 * @returns {Object} Standardized paginated response object
 * 
 * @example
 * const response = paginatedResponse(leads, 150, 2, 20, 'Leads retrieved successfully');
 */
function paginatedResponse(items, total, page, limit, message = 'Items retrieved successfully') {
  const pagination = createPaginationMeta(total, page, limit);
  
  return successResponse(items, message, {
    count: items.length,
    pagination
  });
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  // Success responses
  successResponse,
  listResponse,
  itemResponse,
  createdResponse,
  updatedResponse,
  
  // Error responses
  errorResponse,
  validationErrorResponse,
  notFoundResponse,
  serverErrorResponse,
  
  // Pagination
  createPaginationMeta,
  paginatedResponse
}; 