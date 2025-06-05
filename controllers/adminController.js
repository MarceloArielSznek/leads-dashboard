const db = require('../config/database');
const { validationResult } = require('express-validator');
const { runLeadSyncProcess } = require('../fetch_leads.js'); // Corrected path

// Admin panel view
exports.getAdminPanel = (req, res) => {
    res.render('admin');
};

// Tags
exports.getTags = async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM leads_dashboard.tag ORDER BY name');
        res.json(result.rows);
    } catch (error) {
        console.error('Error getting tags:', error);
        res.status(500).json({ error: 'Error getting tags' });
    }
};

exports.createTag = async (req, res) => {
    try {
        const { name } = req.body;
        
        // Validate input
        if (!name || name.trim().length === 0) {
            return res.status(400).json({ error: 'Tag name is required' });
        }

        // Check if tag already exists
        const existingTag = await db.query('SELECT * FROM leads_dashboard.tag WHERE LOWER(name) = LOWER($1)', [name]);
        if (existingTag.rows.length > 0) {
            return res.status(400).json({ error: 'Tag already exists' });
        }

        const result = await db.query('INSERT INTO leads_dashboard.tag (name) VALUES ($1) RETURNING *', [name]);
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error creating tag:', error);
        res.status(500).json({ error: 'Error creating tag' });
    }
};

exports.deleteTag = async (req, res) => {
    try {
        const { id } = req.params;
        
        // Check if tag is being used
        const tagUsage = await db.query('SELECT COUNT(*) FROM leads_dashboard.lead_tag WHERE tag_id = $1', [id]);
        if (tagUsage.rows[0].count > 0) {
            return res.status(400).json({ error: 'Cannot delete tag that is being used by leads' });
        }

        await db.query('DELETE FROM leads_dashboard.tag WHERE id = $1', [id]);
        res.json({ message: 'Tag deleted successfully' });
    } catch (error) {
        console.error('Error deleting tag:', error);
        res.status(500).json({ error: 'Error deleting tag' });
    }
};

exports.updateTag = async (req, res) => {
    try {
        const { id } = req.params;
        const { name } = req.body;
        if (!name || name.trim().length === 0) {
            return res.status(400).json({ error: 'Tag name is required' });
        }
        const result = await db.query('UPDATE leads_dashboard.tag SET name = $1 WHERE id = $2 RETURNING *', [name, id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Tag not found' });
        }
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error updating tag:', error);
        res.status(500).json({ error: 'Error updating tag' });
    }
};

// Statuses
exports.getStatuses = async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM leads_dashboard.lead_status ORDER BY name');
        res.json(result.rows);
    } catch (error) {
        console.error('Error getting statuses:', error);
        res.status(500).json({ error: 'Error getting statuses' });
    }
};

exports.createStatus = async (req, res) => {
    try {
        const { name } = req.body;
        
        if (!name || name.trim().length === 0) {
            return res.status(400).json({ error: 'Status name is required' });
        }

        const existingStatus = await db.query('SELECT * FROM leads_dashboard.lead_status WHERE LOWER(name) = LOWER($1)', [name]);
        if (existingStatus.rows.length > 0) {
            return res.status(400).json({ error: 'Status already exists' });
        }

        const result = await db.query('INSERT INTO leads_dashboard.lead_status (name) VALUES ($1) RETURNING *', [name]);
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error creating status:', error);
        res.status(500).json({ error: 'Error creating status' });
    }
};

exports.deleteStatus = async (req, res) => {
    try {
        const { id } = req.params;
        
        const statusUsage = await db.query('SELECT COUNT(*) FROM leads_dashboard.lead WHERE lead_status_id = $1', [id]);
        if (statusUsage.rows[0].count > 0) {
            return res.status(400).json({ error: 'Cannot delete status that is being used by leads' });
        }

        await db.query('DELETE FROM leads_dashboard.lead_status WHERE id = $1', [id]);
        res.json({ message: 'Status deleted successfully' });
    } catch (error) {
        console.error('Error deleting status:', error);
        res.status(500).json({ error: 'Error deleting status' });
    }
};

exports.updateStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { name } = req.body;
        if (!name || name.trim().length === 0) {
            return res.status(400).json({ error: 'Status name is required' });
        }
        const result = await db.query('UPDATE leads_dashboard.lead_status SET name = $1 WHERE id = $2 RETURNING *', [name, id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Status not found' });
        }
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error updating status:', error);
        res.status(500).json({ error: 'Error updating status' });
    }
};

// Branches
exports.getBranches = async (req, res) => {
    try {
        const result = await db.query(`
            SELECT b.*, a.street, a.city, a.state, a.zip_code 
            FROM leads_dashboard.branch b 
            LEFT JOIN leads_dashboard.address a ON b.address_id = a.id 
            ORDER BY b.name
        `);
        res.json(result.rows);
    } catch (error) {
        console.error('Error getting branches:', error);
        res.status(500).json({ error: 'Error getting branches' });
    }
};

exports.createBranch = async (req, res) => {
    try {
        const { name, street, city, state, zip_code } = req.body;
        
        if (!name || name.trim().length === 0) {
            return res.status(400).json({ error: 'Branch name is required' });
        }

        // First create address
        const addressResult = await db.query('INSERT INTO leads_dashboard.address (street, city, state, zip_code) VALUES ($1, $2, $3, $4) RETURNING *', [street, city, state, zip_code]);
        const addressId = addressResult.rows[0].id;

        // Then create branch
        const result = await db.query('INSERT INTO leads_dashboard.branch (name, address_id) VALUES ($1, $2) RETURNING *', [name, addressId]);

        // Return branch with address info
        const branchWithAddress = {
            ...result.rows[0],
            street,
            city,
            state,
            zip_code
        };
        
        res.json(branchWithAddress);
    } catch (error) {
        console.error('Error creating branch:', error);
        res.status(500).json({ error: 'Error creating branch' });
    }
};

exports.deleteBranch = async (req, res) => {
    try {
        const { id } = req.params;
        
        // Check if branch is being used by leads
        const branchUsage = await db.query('SELECT COUNT(*) FROM leads_dashboard.lead WHERE branch_id = $1', [id]);
        if (branchUsage.rows[0].count > 0) {
            return res.status(400).json({ error: 'Cannot delete branch that is being used by leads' });
        }

        // Get address_id before deleting branch
        const branch = await db.query('SELECT address_id FROM leads_dashboard.branch WHERE id = $1', [id]);
        if (branch.rows.length === 0) {
            return res.status(404).json({ error: 'Branch not found' });
        }
        const addressId = branch.rows[0].address_id;

        // Delete branch first (due to foreign key constraint)
        await db.query('DELETE FROM leads_dashboard.branch WHERE id = $1', [id]);
        // Then delete associated address
            await db.query('DELETE FROM leads_dashboard.address WHERE id = $1', [addressId]);

        res.json({ message: 'Branch deleted successfully' });
    } catch (error) {
        console.error('Error deleting branch:', error);
        res.status(500).json({ error: 'Error deleting branch' });
    }
};

exports.updateBranch = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, street, city, state, zip_code } = req.body;
        if (!name || name.trim().length === 0) {
            return res.status(400).json({ error: 'Branch name is required' });
        }
        // Get address_id
        const branch = await db.query('SELECT address_id FROM leads_dashboard.branch WHERE id = $1', [id]);
        if (branch.rows.length === 0) {
            return res.status(404).json({ error: 'Branch not found' });
        }
        const addressId = branch.rows[0].address_id;
        // Update address
        await db.query('UPDATE leads_dashboard.address SET street = $1, city = $2, state = $3, zip_code = $4 WHERE id = $5', [street, city, state, zip_code, addressId]);
        // Update branch
        const result = await db.query('UPDATE leads_dashboard.branch SET name = $1 WHERE id = $2 RETURNING *', [name, id]);
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error updating branch:', error);
        res.status(500).json({ error: 'Error updating branch' });
    }
};

// Sales Persons
exports.getSalesPersons = async (req, res) => {
    try {
        const result = await db.query(`
            SELECT sp.*, b.name as branch_name 
            FROM leads_dashboard.sales_person sp 
            LEFT JOIN leads_dashboard.branch b ON sp.branch_id = b.id 
            ORDER BY sp.name
        `);
        res.json(result.rows);
    } catch (error) {
        console.error('Error getting sales persons:', error);
        res.status(500).json({ error: 'Error getting sales persons' });
    }
};

exports.createSalesPerson = async (req, res) => {
    try {
        const { name, branch_id } = req.body;
        console.log('[CREATE SALES PERSON] Body:', req.body);
        
        if (!name || name.trim().length === 0) {
            console.log('[CREATE SALES PERSON] Validation failed: name is required');
            return res.status(400).json({ error: 'Sales person name is required' });
        }

        const existingPerson = await db.query('SELECT * FROM leads_dashboard.sales_person WHERE LOWER(name) = LOWER($1)', [name]);
        if (existingPerson.rows.length > 0) {
            console.log('[CREATE SALES PERSON] Validation failed: name already exists');
            return res.status(400).json({ error: 'Sales person already exists' });
        }

        if (branch_id) {
            const branchExists = await db.query('SELECT * FROM leads_dashboard.branch WHERE id = $1', [branch_id]);
            if (branchExists.rows.length === 0) {
                console.log('[CREATE SALES PERSON] Validation failed: branch does not exist', branch_id);
                return res.status(400).json({ error: 'Branch does not exist' });
            }
        }

        const result = await db.query(
            'INSERT INTO leads_dashboard.sales_person (name, branch_id) VALUES ($1, $2) RETURNING *',
            [name, branch_id || null]
        );
        console.log('[CREATE SALES PERSON] Created:', result.rows[0]);
        res.json(result.rows[0]);
    } catch (error) {
        console.error('[CREATE SALES PERSON] Error:', error);
        res.status(500).json({ error: 'Error creating sales person' });
    }
};

exports.deleteSalesPerson = async (req, res) => {
    try {
        const { id } = req.params;
        
        const personUsage = await db.query('SELECT COUNT(*) FROM leads_dashboard.lead WHERE sales_person_id = $1', [id]);
        if (personUsage.rows[0].count > 0) {
            return res.status(400).json({ error: 'Cannot delete sales person that is assigned to leads' });
        }

        await db.query('DELETE FROM leads_dashboard.sales_person WHERE id = $1', [id]);
        res.json({ message: 'Sales person deleted successfully' });
    } catch (error) {
        console.error('Error deleting sales person:', error);
        res.status(500).json({ error: 'Error deleting sales person' });
    }
};

exports.updateSalesPerson = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, branch_id } = req.body;
        if (!name || name.trim().length === 0) {
            return res.status(400).json({ error: 'Sales person name is required' });
        }
        const result = await db.query('UPDATE leads_dashboard.sales_person SET name = $1, branch_id = $2 WHERE id = $3 RETURNING *', [name, branch_id || null, id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Sales person not found' });
        }
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error updating sales person:', error);
        res.status(500).json({ error: 'Error updating sales person' });
    }
};

// Conditions
exports.getConditions = async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM leads_dashboard.condition ORDER BY name');
        res.json(result.rows);
    } catch (error) {
        console.error('Error getting conditions:', error);
        res.status(500).json({ error: 'Error getting conditions' });
    }
};

exports.createCondition = async (req, res) => {
    try {
        const { name } = req.body;
        console.log('[CREATE CONDITION] Body:', req.body);
        
        if (!name || name.trim().length === 0) {
            console.log('[CREATE CONDITION] Validation failed: name is required');
            return res.status(400).json({ error: 'Condition name is required' });
        }

        const existingCondition = await db.query('SELECT * FROM leads_dashboard.condition WHERE LOWER(name) = LOWER($1)', [name]);
        if (existingCondition.rows.length > 0) {
            console.log('[CREATE CONDITION] Validation failed: name already exists');
            return res.status(400).json({ error: 'Condition already exists' });
        }

        const result = await db.query('INSERT INTO leads_dashboard.condition (name) VALUES ($1) RETURNING *', [name]);
        console.log('[CREATE CONDITION] Created:', result.rows[0]);
        res.json(result.rows[0]);
    } catch (error) {
        console.error('[CREATE CONDITION] Error:', error);
        res.status(500).json({ error: 'Error creating condition' });
    }
};

exports.deleteCondition = async (req, res) => {
    try {
        const { id } = req.params;
        
        const conditionUsage = await db.query('SELECT COUNT(*) FROM leads_dashboard.lead WHERE condition_id = $1', [id]);
        if (conditionUsage.rows[0].count > 0) {
            return res.status(400).json({ error: 'Cannot delete condition that is being used by leads' });
        }

        await db.query('DELETE FROM leads_dashboard.condition WHERE id = $1', [id]);
        res.json({ message: 'Condition deleted successfully' });
    } catch (error) {
        console.error('Error deleting condition:', error);
        res.status(500).json({ error: 'Error deleting condition' });
    }
};

exports.updateCondition = async (req, res) => {
    try {
        const { id } = req.params;
        const { name } = req.body;
        if (!name || name.trim().length === 0) {
            return res.status(400).json({ error: 'Condition name is required' });
        }
        const result = await db.query('UPDATE leads_dashboard.condition SET name = $1 WHERE id = $2 RETURNING *', [name, id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Condition not found' });
        }
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error updating condition:', error);
        res.status(500).json({ error: 'Error updating condition' });
    }
};

// Sources
exports.getSources = async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM leads_dashboard.source ORDER BY name');
        res.json(result.rows);
    } catch (error) {
        console.error('Error getting sources:', error);
        res.status(500).json({ error: 'Error getting sources' });
    }
};

exports.createSource = async (req, res) => {
    try {
        const { name } = req.body;
        console.log('[CREATE SOURCE] Body:', req.body);
        
        if (!name || name.trim().length === 0) {
            console.log('[CREATE SOURCE] Validation failed: name is required');
            return res.status(400).json({ error: 'Source name is required' });
        }

        const existingSource = await db.query('SELECT * FROM leads_dashboard.source WHERE LOWER(name) = LOWER($1)', [name]);
        if (existingSource.rows.length > 0) {
            console.log('[CREATE SOURCE] Validation failed: name already exists');
            return res.status(400).json({ error: 'Source already exists' });
        }

        const result = await db.query('INSERT INTO leads_dashboard.source (name) VALUES ($1) RETURNING *', [name]);
        console.log('[CREATE SOURCE] Created:', result.rows[0]);
        res.json(result.rows[0]);
    } catch (error) {
        console.error('[CREATE SOURCE] Error:', error);
        res.status(500).json({ error: 'Error creating source' });
    }
};

exports.deleteSource = async (req, res) => {
    try {
        const { id } = req.params;
        
        const sourceUsage = await db.query('SELECT COUNT(*) FROM leads_dashboard.lead WHERE source_id = $1', [id]);
        if (sourceUsage.rows[0].count > 0) {
            return res.status(400).json({ error: 'Cannot delete source that is being used by leads' });
        }

        await db.query('DELETE FROM leads_dashboard.source WHERE id = $1', [id]);
        res.json({ message: 'Source deleted successfully' });
    } catch (error) {
        console.error('Error deleting source:', error);
        res.status(500).json({ error: 'Error deleting source' });
    }
};

exports.updateSource = async (req, res) => {
    try {
        const { id } = req.params;
        const { name } = req.body;
        if (!name || name.trim().length === 0) {
            return res.status(400).json({ error: 'Source name is required' });
        }
        const result = await db.query('UPDATE leads_dashboard.source SET name = $1 WHERE id = $2 RETURNING *', [name, id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Source not found' });
        }
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error updating source:', error);
        res.status(500).json({ error: 'Error updating source' });
    }
};

// Proposal Statuses
exports.getProposalStatuses = async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM leads_dashboard.proposal_status ORDER BY name');
        res.json(result.rows);
    } catch (error) {
        console.error('Error getting proposal statuses:', error);
        res.status(500).json({ error: 'Error getting proposal statuses' });
    }
};

exports.createProposalStatus = async (req, res) => {
    try {
        const { name } = req.body;
        if (!name || name.trim().length === 0) {
            return res.status(400).json({ error: 'Proposal status name is required' });
        }
        const existing = await db.query('SELECT * FROM leads_dashboard.proposal_status WHERE LOWER(name) = LOWER($1)', [name]);
        if (existing.rows.length > 0) {
            return res.status(400).json({ error: 'Proposal status already exists' });
        }
        const result = await db.query('INSERT INTO leads_dashboard.proposal_status (name) VALUES ($1) RETURNING *', [name]);
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error creating proposal status:', error);
        res.status(500).json({ error: 'Error creating proposal status' });
    }
};

exports.updateProposalStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { name } = req.body;
        if (!name || name.trim().length === 0) {
            return res.status(400).json({ error: 'Proposal status name is required' });
        }
        const result = await db.query('UPDATE leads_dashboard.proposal_status SET name = $1 WHERE id = $2 RETURNING *', [name, id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Proposal status not found' });
        }
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error updating proposal status:', error);
        res.status(500).json({ error: 'Error updating proposal status' });
    }
};

exports.deleteProposalStatus = async (req, res) => {
    try {
        const { id } = req.params;
        // Check if any lead uses this proposal status
        const usage = await db.query('SELECT COUNT(*) FROM leads_dashboard.lead WHERE proposal_status_id = $1', [id]);
        if (usage.rows[0].count > 0) {
            return res.status(400).json({ error: 'Cannot delete proposal status that is being used by leads' });
        }
        await db.query('DELETE FROM leads_dashboard.proposal_status WHERE id = $1', [id]);
        res.json({ message: 'Proposal status deleted successfully' });
    } catch (error) {
        console.error('Error deleting proposal status:', error);
        res.status(500).json({ error: 'Error deleting proposal status' });
    }
};

// New method for API Lead Synchronization
exports.syncLeadsWithApi = async (req, res) => {
    console.log('--- ADMIN CONTROLLER: syncLeadsWithApi CALLED ---');
    console.log('Received sync configuration from UI:', JSON.stringify(req.body, null, 2));

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array(), message: "Validation errors occurred." });
    }

    try {
        const config = req.body; // Frontend sends the config object directly in the body
        
        // Basic validation for essential config properties (can be expanded)
        if (typeof config.daysToLookBack !== 'number' || 
            !Array.isArray(config.apiBranchIds) || 
            typeof config.matchByName !== 'boolean' || 
            typeof config.matchByAddress !== 'boolean' ||
            typeof config.skipAlreadyMatchedDBLeads !== 'boolean' ||
            typeof config.isDryRun !== 'boolean') {
            return res.status(400).json({ message: "Invalid configuration for lead sync." });
        }

        // Ensure apiBranchIds are numbers if they aren't already (though frontend should send numbers)
        config.apiBranchIds = config.apiBranchIds.map(id => Number(id));

        const summary = await runLeadSyncProcess(config);

        res.status(200).json({
            success: true,
            message: "Lead synchronization process completed.",
            summary: summary 
        });

    } catch (error) {
        console.error('Error during lead synchronization process:', error);
        res.status(500).json({
            success: false,
            message: "An unexpected error occurred during lead synchronization.",
            error: error.message,
            summary: { // Send a partial summary if available, or an error state
                logMessages: [`Error: ${error.message}`],
                errors: [`Unhandled controller error: ${error.message}`]
            }
        });
    }
}; 