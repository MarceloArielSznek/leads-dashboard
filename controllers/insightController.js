const xlsx = require('xlsx');
const db = require('../config/database');
const { generateSQLFromQuestion, generateNaturalLanguageResponse, businessIntelligence } = require('../config/openai');

const insightController = {
    // Get all branches for the dropdown selection
    getBranches: async (req, res) => {
        try {
            const result = await db.pool.query('SELECT id, name FROM leads_dashboard.branch ORDER BY name');
            res.json(result.rows);
        } catch (error) {
            console.error('Error fetching branches:', error);
            res.status(500).json({ error: 'Error fetching branches' });
        }
    },

    // Get all lead statuses for the dropdown selection
    getLeadStatuses: async (req, res) => {
        try {
            const result = await db.pool.query('SELECT id, name FROM leads_dashboard.lead_status ORDER BY name');
            res.json(result.rows);
        } catch (error) {
            console.error('Error fetching lead statuses:', error);
            res.status(500).json({ error: 'Error fetching lead statuses' });
        }
    },

    // Get business intelligence summary
    getBusinessIntelligence: async (req, res) => {
        try {
            const summary = businessIntelligence.exportSummary();
            const insights = businessIntelligence.getPerformanceInsights();
            const recommendations = businessIntelligence.getBusinessRecommendations();
            
            res.json({
                summary,
                insights,
                recommendations,
                status: 'active',
                totalMemoryItems: summary.businessCategories?.length || 0
            });
        } catch (error) {
            console.error('Error getting business intelligence:', error);
            res.status(500).json({ error: 'Error fetching business intelligence data' });
        }
    },

    // Clear business intelligence memory
    clearBusinessIntelligence: async (req, res) => {
        try {
            businessIntelligence.clearAllData();
            res.json({ message: 'Business intelligence memory cleared successfully' });
        } catch (error) {
            console.error('Error clearing business intelligence:', error);
            res.status(500).json({ error: 'Error clearing business intelligence data' });
        }
    },

    // Get smart suggestions for questions
    getSmartSuggestions: async (req, res) => {
        try {
            const { category } = req.query;
            
            // Get suggestions based on category or provide general ones
            const suggestions = businessIntelligence.getFollowUpSuggestions(category || 'general_business', []);
            
            // Also get recent high-value questions as suggestions
            const summary = businessIntelligence.exportSummary();
            const recentHighValue = summary.insights || [];
            
            res.json({
                suggestions,
                recentHighValue: recentHighValue.slice(0, 3),
                category: category || 'general'
            });
        } catch (error) {
            console.error('Error getting smart suggestions:', error);
            res.status(500).json({ error: 'Error fetching suggestions' });
        }
    },

    // Render the insights page
    getInsightsPage: async (req, res) => {
        try {
            res.render('insights');
        } catch (error) {
            console.error('Error rendering insights page:', error);
            res.status(500).render('error', { error: 'Failed to load insights page' });
        }
    },

    // Render the recovered leads page
    getRecoveredLeadsPage: async (req, res) => {
        try {
            res.render('recovered-leads');
        } catch (error) {
            console.error('Error rendering recovered leads page:', error);
            res.status(500).render('error', { error: 'Failed to load recovered leads page' });
        }
    },

    // Get all recovered leads from all groups with insights
    getRecoveredLeads: async (req, res) => {
        try {
            const query = `
                SELECT 
                    l.id,
                    l.name as opportunity_title,
                    l.created_date,
                    l.recovered,
                    l.updated_at as recovered_date,
                    COALESCE(ls.name, 'No Status') as lead_status,
                    COALESCE(sp.name, 'Unassigned') as salesperson,
                    l.inspection_date,
                    l.sold_date,
                    CASE 
                        WHEN l.sold_date IS NOT NULL AND l.created_date IS NOT NULL 
                        THEN l.sold_date - l.created_date 
                        ELSE NULL 
                    END as days_to_sign,
                    COALESCE(l.final_proposal_amount, 0) as final_proposal_amount,
                    COALESCE(l.proposal_tm, 0) as proposal_tm,
                    COALESCE(l.sub_contractor_price, 0) as sub_contractor_price,
                    COALESCE(l.matched, false) as matched,
                    COALESCE(a.city, '') as city,
                    COALESCE(a.state, '') as state,
                    COALESCE(a.street, '') as street_address,
                    COALESCE(a.zip_code, '') as zip_code,
                    COALESCE(s.name, 'Unknown Source') as source,
                    COALESCE(c.email_address, '') as email_address,
                    COALESCE(c.first_name, '') as first_name,
                    COALESCE(c.last_name, '') as last_name,
                    COALESCE(c.phone, '') as phone,
                    COALESCE(pt.name, 'Unknown Type') as property_type,
                    l.branch_id,
                    COALESCE(b.name, 'No Branch') as branch_name,
                    lg.name as group_name,
                    lg.id as group_id,
                    COALESCE(
                        (SELECT STRING_AGG(t.name, ', ') 
                         FROM leads_dashboard.lead_tag lt 
                         JOIN leads_dashboard.tag t ON lt.tag_id = t.id 
                         WHERE lt.lead_id = l.id), 
                        ''
                    ) as tags
                FROM leads_dashboard.lead l
                INNER JOIN leads_dashboard.lead_group_assignment lga ON l.id = lga.lead_id
                INNER JOIN leads_dashboard.lead_group lg ON lga.group_id = lg.id
                LEFT JOIN leads_dashboard.lead_status ls ON l.lead_status_id = ls.id
                LEFT JOIN leads_dashboard.sales_person sp ON l.sales_person_id = sp.id
                LEFT JOIN leads_dashboard.customer c ON l.customer_id = c.id
                LEFT JOIN leads_dashboard.address a ON c.address_id = a.id
                LEFT JOIN leads_dashboard.source s ON l.source_id = s.id
                LEFT JOIN leads_dashboard.property_type pt ON l.property_type_id = pt.id
                LEFT JOIN leads_dashboard.branch b ON l.branch_id = b.id
                WHERE l.recovered = true
                ORDER BY l.updated_at DESC, l.created_date DESC
            `;
            
            const result = await db.pool.query(query);
            res.json(result.rows);
        } catch (error) {
            console.error('Error fetching recovered leads:', error);
            res.status(500).json({ error: 'Error fetching recovered leads', details: error.message });
        }
    },

    // Get total leads count across all groups for recovery rate calculation
    getTotalLeadsCount: async (req, res) => {
        try {
            const query = `
                SELECT 
                    COUNT(DISTINCT l.id) as total_leads,
                    COUNT(DISTINCT CASE WHEN l.recovered = true THEN l.id END) as recovered_leads_count
                FROM leads_dashboard.lead l
                INNER JOIN leads_dashboard.lead_group_assignment lga ON l.id = lga.lead_id
                INNER JOIN leads_dashboard.lead_group lg ON lga.group_id = lg.id
            `;
            
            const result = await db.pool.query(query);
            const stats = result.rows[0];
            
            // Calculate recovery rate
            const recoveryRate = stats.total_leads > 0 ? 
                (parseFloat(stats.recovered_leads_count) / parseFloat(stats.total_leads)) * 100 : 0;
                
            res.json({
                total_leads: parseInt(stats.total_leads),
                recovered_leads_count: parseInt(stats.recovered_leads_count),
                recovery_rate: Math.round(recoveryRate * 10) / 10 // Round to 1 decimal place
            });
        } catch (error) {
            console.error('Error fetching total leads count:', error);
            res.status(500).json({ error: 'Error fetching total leads count', details: error.message });
        }
    },

    // Get all leads from the last year
    getClosedLeads: async (req, res) => {
        try {
            const query = `
                SELECT 
                    l.id,
                    l.name as opportunity_title,
                    l.created_date,
                    COALESCE(ls.name, 'No Status') as lead_status,
                    COALESCE(sp.name, 'Unassigned') as salesperson,
                    l.inspection_date,
                    l.sold_date,
                    CASE 
                        WHEN l.sold_date IS NOT NULL AND l.created_date IS NOT NULL 
                        THEN l.sold_date - l.created_date 
                        ELSE NULL 
                    END as days_to_sign,
                    COALESCE(l.final_proposal_amount, 0) as final_proposal_amount,
                    COALESCE(l.proposal_tm, 0) as total_estimated_tm,
                    COALESCE(l.sub_contractor_price, 0) as sub_contractor_price,
                    COALESCE(l.matched, false) as matched,
                    COALESCE(a.city, '') as city,
                    COALESCE(a.state, '') as state,
                    COALESCE(a.street, '') as street_address,
                    COALESCE(a.zip_code, '') as zip_code,
                    COALESCE(s.name, 'Unknown Source') as source,
                    COALESCE(c.email_address, '') as email_address,
                    COALESCE(c.first_name, '') as first_name,
                    COALESCE(c.last_name, '') as last_name,
                    COALESCE(c.phone, '') as phone,
                    COALESCE(pt.name, 'Unknown Type') as property_type,
                    l.branch_id,
                    COALESCE(b.name, 'No Branch') as branch_name,
                    COALESCE(
                        (SELECT STRING_AGG(t.name, ', ') 
                         FROM leads_dashboard.lead_tag lt 
                         JOIN leads_dashboard.tag t ON lt.tag_id = t.id 
                         WHERE lt.lead_id = l.id), 
                        ''
                    ) as tags
                FROM leads_dashboard.lead l
                LEFT JOIN leads_dashboard.lead_status ls ON l.lead_status_id = ls.id
                LEFT JOIN leads_dashboard.sales_person sp ON l.sales_person_id = sp.id
                LEFT JOIN leads_dashboard.customer c ON l.customer_id = c.id
                LEFT JOIN leads_dashboard.address a ON c.address_id = a.id
                LEFT JOIN leads_dashboard.source s ON l.source_id = s.id
                LEFT JOIN leads_dashboard.property_type pt ON l.property_type_id = pt.id
                LEFT JOIN leads_dashboard.branch b ON l.branch_id = b.id
                ORDER BY l.created_date DESC
            `;
            
            const result = await db.pool.query(query);
            res.json(result.rows);
        } catch (error) {
            console.error('Error fetching leads:', error);
            res.status(500).json({ error: 'Error fetching leads', details: error.message });
        }
    },

    // Import closed leads from Excel file
    importClosedLeads: async (req, res) => {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        // Get branch_id from the form
        const branchId = req.body.branchId;
        
        if (!branchId) {
            return res.status(400).json({ error: 'Branch selection is required' });
        }

        console.log('=== INICIO DE IMPORTACIÓN DE LEADS ===');
        console.log('Archivo recibido:', req.file.originalname);
        console.log('Branch ID seleccionado:', branchId);

        const workbook = xlsx.readFile(req.file.path);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const rows = xlsx.utils.sheet_to_json(worksheet);

        console.log('\n=== DATOS LEÍDOS DEL EXCEL ===');
        console.log('Total de filas:', rows.length);
        if (rows.length > 0) {
            console.log('Columnas disponibles:', Object.keys(rows[0]));
            console.log('Primera fila de ejemplo:', JSON.stringify(rows[0], null, 2));
        }

        // Helper function to find column value with multiple possible names
        const getColumnValue = (row, possibleNames) => {
            for (const name of possibleNames) {
                if (row[name] !== undefined && row[name] !== null && row[name] !== '') {
                    return row[name];
                }
            }
            return '';
        };

        const results = {
            total: rows.length,
            success: 0,
            errors: [],
            updated: 0,          // Track updated leads
            created: 0,          // Track newly created leads
            autoSoldCount: 0     // Track leads automatically converted to "Sold"
        };

        console.log('\n=== INICIANDO PROCESAMIENTO ===');

        // Pre-fetch all lookup data to avoid repeated queries
        console.log('📋 Pre-loading lookup data for performance...');
        const lookupData = {
            leadStatuses: new Map(),
            salespeople: new Map(),
            sources: new Map(),
            proposalStatuses: new Map(),
            conditions: new Map(),
            propertyTypes: new Map(),
            tags: new Map()
        };

        // Pre-load existing data to avoid repeated lookups
        const existingLeadStatuses = await db.pool.query('SELECT id, LOWER(name) as name FROM leads_dashboard.lead_status');
        existingLeadStatuses.rows.forEach(row => lookupData.leadStatuses.set(row.name, row.id));

        const existingSalesspeople = await db.pool.query('SELECT id, LOWER(name) as name FROM leads_dashboard.sales_person');
        existingSalesspeople.rows.forEach(row => lookupData.salespeople.set(row.name, row.id));

        const existingSources = await db.pool.query('SELECT id, LOWER(name) as name FROM leads_dashboard.source');
        existingSources.rows.forEach(row => lookupData.sources.set(row.name, row.id));

        const existingProposalStatuses = await db.pool.query('SELECT id, LOWER(name) as name FROM leads_dashboard.proposal_status');
        existingProposalStatuses.rows.forEach(row => lookupData.proposalStatuses.set(row.name, row.id));

        const existingConditions = await db.pool.query('SELECT id, LOWER(name) as name FROM leads_dashboard.condition');
        existingConditions.rows.forEach(row => lookupData.conditions.set(row.name, row.id));

        const existingPropertyTypes = await db.pool.query('SELECT id, LOWER(name) as name FROM leads_dashboard.property_type');
        existingPropertyTypes.rows.forEach(row => lookupData.propertyTypes.set(row.name, row.id));

        const existingTags = await db.pool.query('SELECT id, LOWER(name) as name FROM leads_dashboard.tag');
        existingTags.rows.forEach(row => lookupData.tags.set(row.name, row.id));

        console.log('✅ Lookup data pre-loaded');

        for (const [index, row] of rows.entries()) {
            console.log(`\n--- Procesando fila ${index + 1}/${rows.length} ---`);
            console.log('Datos de la fila:', JSON.stringify(row, null, 2));

            // Extract values with flexible column mapping
            const opportunityTitle = getColumnValue(row, [
                'Opportunity Title', 'Opportunity', 'Lead Name', 'Name', 'Title', 'Job Title'
            ]);
            
            const salespersonNameRaw = getColumnValue(row, [
                'Salesperson', 'Sales Person', 'Salesman', 'Sales Rep', 'Rep', 'Agent'
            ]);
            
            const sourceNameRaw = getColumnValue(row, [
                'Source', 'Lead Source', 'Origin', 'Referral Source'
            ]);
            
            // Clean salespeople and sources - take only the first value before comma
            const salespersonName = salespersonNameRaw ? salespersonNameRaw.split(',')[0].trim() : '';
            const sourceName = sourceNameRaw ? sourceNameRaw.split(',')[0].trim() : '';
            
            const tags = getColumnValue(row, [
                'Tags', 'Tag', 'Job Type', 'Job Types', 'Categories', 'Category'
            ]);
            
            const firstName = getColumnValue(row, [
                'First Name', 'FirstName', 'Customer First Name', 'Contact First Name'
            ]);
            
            const lastName = getColumnValue(row, [
                'Last Name', 'LastName', 'Customer Last Name', 'Contact Last Name'
            ]);
            
            const email = getColumnValue(row, [
                'Email Address', 'Email', 'Customer Email', 'Contact Email'
            ]);
            
            const phone = getColumnValue(row, [
                'Phone', 'Phone Number', 'Customer Phone', 'Contact Phone', 'Mobile'
            ]);
            
            const streetAddress = getColumnValue(row, [
                'Street Address (Contact)', 'Street Address', 'Street Addres', 'Address', 'Street'
            ]);
            
            const city = getColumnValue(row, [
                'City (Contact)', 'City', 'Customer City', 'Contact City'
            ]);
            
            const state = getColumnValue(row, [
                'State (Contact)', 'State', 'Customer State', 'Contact State'
            ]);
            
            const zipCode = getColumnValue(row, [
                'Zip (Contact)', 'Zip', 'Zip Code', 'Postal Code', 'Customer Zip'
            ]);
            
            const createdDateStr = getColumnValue(row, [
                'Created Date', 'Date Created', 'Lead Date', 'Start Date'
            ]);
            
            const inspectionDateStr = getColumnValue(row, [
                'Inspection Date*', 'Inspection Date', 'Inspection', 'Visit Date'
            ]);
            
            const soldDateStr = getColumnValue(row, [
                'Sold Date', 'Close Date', 'Closed Date', 'Sale Date'
            ]);
            
            const finalProposalAmount = getColumnValue(row, [
                'Final Proposal Amount*', 'Final Proposal Amount', 'Proposal Amount', 'Amount', 'Price', 'Total'
            ]);
            
            const totalEstimatedTM = getColumnValue(row, [
                'Total Estimated T&M *', 'Total Estimated T&M', 'T&M', 'Time and Materials', 'TM'
            ]);
            
            const propertyType = getColumnValue(row, [
                'Property Type*', 'Property Type', 'Property', 'Building Type'
            ]);
            
            const notes = getColumnValue(row, [
                'Notes', 'Note', 'Comments', 'Description'
            ]);
            
            const proposalStatus = getColumnValue(row, [
                'Proposal Status', 'Status', 'Proposal State'
            ]);
            
            const condition = getColumnValue(row, [
                'Condition', 'Property Condition', 'State'
            ]);

            // Extract lead status from Excel row
            const leadStatusName = getColumnValue(row, [
                'Lead Status', 'Status', 'Current Status', 'Lead State'
            ]);

            console.log('\n=== VALORES EXTRAÍDOS ===');
            console.log('Opportunity Title:', opportunityTitle);
            console.log('Salesperson (raw):', salespersonNameRaw);
            console.log('Salesperson (cleaned):', salespersonName);
            console.log('Source (raw):', sourceNameRaw);
            console.log('Source (cleaned):', sourceName);
            console.log('Lead Status (from Excel):', leadStatusName);
            console.log('Sold Date (raw):', soldDateStr);
            console.log('Tags:', tags);
            console.log('Customer:', firstName, lastName);
            console.log('Email:', email);
            console.log('Phone:', phone);

            // Add better validation before processing
            
            // Skip rows with missing critical data
            if (!opportunityTitle && !firstName && !lastName) {
                console.log(`⚠️ Skipping row ${index + 1}: Missing essential data`);
                results.errors.push({
                    row: index + 1,
                    data: row,
                    error: 'Missing essential data: no opportunity title or customer name',
                    errorCode: 'VALIDATION_ERROR'
                });
                continue; // Skip this row
            }
            
            // Validate proposal amount
            const proposalAmount = parseFloat(finalProposalAmount) || 0;
            if (proposalAmount < 0) {
                console.log(`⚠️ Invalid proposal amount in row ${index + 1}: ${finalProposalAmount}`);
            }

            // Usar una transacción individual para cada lead
            const client = await db.pool.connect();
            try {
                await client.query('BEGIN');
                console.log('Iniciando transacción individual para fila', index + 1);
                
                // FIRST: Check for duplicate leads BEFORE creating any new records
                console.log('\n1. Checking for duplicate leads...');
                const leadName = opportunityTitle || `Lead ${index + 1}`;
                const proposalAmount = parseFloat(finalProposalAmount) || 0;

                // Check for duplicates using multiple criteria
                const duplicateCheck = await client.query(`
                    SELECT l.id, l.name, l.final_proposal_amount, l.customer_id,
                           c.first_name, c.last_name, c.email_address, c.address_id
                    FROM leads_dashboard.lead l
                    JOIN leads_dashboard.customer c ON l.customer_id = c.id
                    WHERE (
                        -- Match by opportunity name + branch + proposal amount
                        (LOWER(l.name) = LOWER($1) AND l.branch_id = $2 AND l.final_proposal_amount = $3)
                        OR
                        -- Match by customer email + branch (if email exists)
                        ($4 != '' AND LOWER(c.email_address) = LOWER($4) AND l.branch_id = $2)
                        OR
                        -- Match by customer name + address + branch (exact match)
                        (LOWER(c.first_name) = LOWER($5) AND LOWER(c.last_name) = LOWER($6) 
                         AND EXISTS (
                             SELECT 1 FROM leads_dashboard.address a 
                             WHERE a.id = c.address_id 
                             AND LOWER(a.street) = LOWER($7) 
                             AND LOWER(a.city) = LOWER($8)
                         ) AND l.branch_id = $2)
                    )
                    LIMIT 1
                `, [
                    leadName,           // $1
                    branchId,          // $2  
                    proposalAmount,    // $3
                    email || '',       // $4
                    firstName || '',   // $5
                    lastName || '',    // $6
                    streetAddress || '', // $7
                    city || ''         // $8
                ]);

                let addressId, customerId;
                let isUpdate = false;
                let leadId;

                if (duplicateCheck.rows.length > 0) {
                    // DUPLICATE FOUND - Use existing customer and address
                    const existingLead = duplicateCheck.rows[0];
                    leadId = existingLead.id;
                    customerId = existingLead.customer_id;
                    addressId = existingLead.address_id;
                    isUpdate = true;
                    
                    console.log('🔄 DUPLICATE LEAD DETECTED - UPDATING EXISTING LEAD');
                    console.log(`Using existing Lead ID: ${leadId}, Customer ID: ${customerId}, Address ID: ${addressId}`);
                    console.log(`Customer: ${existingLead.first_name} ${existingLead.last_name} (${existingLead.email_address})`);

                } else {
                    // NO DUPLICATES FOUND - Create new address and customer
                    console.log('✅ No duplicates found, creating new address and customer');
                    
                    // 2. Create new address
                    console.log('\n2. Creating new address...');
                    const addressResult = await client.query(
                        `INSERT INTO leads_dashboard.address 
                        (street, city, state, zip_code) 
                        VALUES ($1, $2, $3, $4) 
                        RETURNING id`,
                        [streetAddress, city, state, zipCode]
                    );
                    addressId = addressResult.rows[0].id;
                    console.log('Address created with ID:', addressId);

                    // 3. Create new customer
                    console.log('\n3. Creating new customer...');
                    const customerResult = await client.query(
                        `INSERT INTO leads_dashboard.customer 
                        (address_id, first_name, last_name, email_address, phone) 
                        VALUES ($1, $2, $3, $4, $5) 
                        RETURNING id`,
                        [addressId, firstName, lastName, email, phone]
                    );
                    customerId = customerResult.rows[0].id;
                    console.log('Customer created with ID:', customerId);
                }

                // 4. Get or create lead status (using cache)
                console.log('\n4. Processing Lead Status...');
                const leadStatusNameFinal = (leadStatusName || 'New').trim();
                const leadStatusKey = leadStatusNameFinal.toLowerCase();
                let leadStatusId;
                
                if (lookupData.leadStatuses.has(leadStatusKey)) {
                    leadStatusId = lookupData.leadStatuses.get(leadStatusKey);
                    console.log('Lead Status found in cache:', leadStatusId, 'Name:', leadStatusNameFinal);
                } else {
                    // Create new lead status
                    const leadStatusResult = await client.query(
                        `INSERT INTO leads_dashboard.lead_status (name) VALUES ($1) RETURNING id`,
                        [leadStatusNameFinal]
                    );
                    leadStatusId = leadStatusResult.rows[0].id;
                    lookupData.leadStatuses.set(leadStatusKey, leadStatusId);
                    console.log('Lead Status created:', leadStatusId, 'Name:', leadStatusNameFinal);
                }

                // 5. Get or create salesperson (using cache)
                console.log('\n5. Processing Sales Person...');
                const salesPersonNameFinal = (salespersonName || 'Unknown').trim();
                const salesPersonKey = salesPersonNameFinal.toLowerCase();
                let salesPersonId;
                
                if (lookupData.salespeople.has(salesPersonKey)) {
                    salesPersonId = lookupData.salespeople.get(salesPersonKey);
                    console.log('Sales Person found in cache:', salesPersonId, 'Name:', salesPersonNameFinal);
                } else {
                    // Create new salesperson
                    const salesPersonResult = await client.query(
                        `INSERT INTO leads_dashboard.sales_person (name, branch_id) VALUES ($1, $2) RETURNING id`,
                        [salesPersonNameFinal, branchId]
                    );
                    salesPersonId = salesPersonResult.rows[0].id;
                    lookupData.salespeople.set(salesPersonKey, salesPersonId);
                    console.log('Sales Person created:', salesPersonId, 'Name:', salesPersonNameFinal);
                }

                // 6. Get or create source (using cache)
                console.log('\n6. Processing Source...');
                const sourceNameFinal = sourceName || 'Unknown';
                const sourceKey = sourceNameFinal.toLowerCase();
                let sourceId;
                
                if (lookupData.sources.has(sourceKey)) {
                    sourceId = lookupData.sources.get(sourceKey);
                    console.log('Source found in cache:', sourceId, 'Name:', sourceNameFinal);
                } else {
                    const sourceResult = await client.query(
                        `INSERT INTO leads_dashboard.source (name) VALUES ($1) RETURNING id`,
                        [sourceNameFinal]
                    );
                    sourceId = sourceResult.rows[0].id;
                    lookupData.sources.set(sourceKey, sourceId);
                    console.log('Source created:', sourceId, 'Name:', sourceNameFinal);
                }

                // 7-9. Get or create other lookup values (using cache)
                const proposalStatusFinal = proposalStatus || 'Closed';
                const proposalStatusKey = proposalStatusFinal.toLowerCase();
                let proposalStatusId;
                if (lookupData.proposalStatuses.has(proposalStatusKey)) {
                    proposalStatusId = lookupData.proposalStatuses.get(proposalStatusKey);
                } else {
                    const result = await client.query(`INSERT INTO leads_dashboard.proposal_status (name) VALUES ($1) RETURNING id`, [proposalStatusFinal]);
                    proposalStatusId = result.rows[0].id;
                    lookupData.proposalStatuses.set(proposalStatusKey, proposalStatusId);
                }

                const conditionFinal = condition || 'Normal';
                const conditionKey = conditionFinal.toLowerCase();
                let conditionId;
                if (lookupData.conditions.has(conditionKey)) {
                    conditionId = lookupData.conditions.get(conditionKey);
                } else {
                    const result = await client.query(`INSERT INTO leads_dashboard.condition (name) VALUES ($1) RETURNING id`, [conditionFinal]);
                    conditionId = result.rows[0].id;
                    lookupData.conditions.set(conditionKey, conditionId);
                }

                const propertyTypeFinal = propertyType || 'Unknown';
                const propertyTypeKey = propertyTypeFinal.toLowerCase();
                let propertyTypeId;
                if (lookupData.propertyTypes.has(propertyTypeKey)) {
                    propertyTypeId = lookupData.propertyTypes.get(propertyTypeKey);
                } else {
                    const result = await client.query(`INSERT INTO leads_dashboard.property_type (name) VALUES ($1) RETURNING id`, [propertyTypeFinal]);
                    propertyTypeId = result.rows[0].id;
                    lookupData.propertyTypes.set(propertyTypeKey, propertyTypeId);
                }

                // 9. Parse dates
                const parseDate = (dateStr) => {
                    if (!dateStr) return null;
                    try {
                        // Handle Excel date formats
                        if (typeof dateStr === 'number') {
                            // Excel serial date
                            const excelEpoch = new Date(1900, 0, 1);
                            const date = new Date(excelEpoch.getTime() + (dateStr - 2) * 24 * 60 * 60 * 1000);
                            const result = date.toISOString().split('T')[0];
                            console.log(`Fecha parseada: ${dateStr} -> ${result}`);
                            return result;
                        }
                        const date = new Date(dateStr);
                        if (isNaN(date.getTime())) {
                            console.log(`Fecha inválida: ${dateStr}`);
                            return null;
                        }
                        const result = date.toISOString().split('T')[0];
                        console.log(`Fecha parseada: ${dateStr} -> ${result}`);
                        return result;
                    } catch (e) {
                        console.log(`Error parseando fecha: ${dateStr}, error: ${e.message}`);
                        return null;
                    }
                };

                const createdDate = parseDate(createdDateStr) || new Date().toISOString().split('T')[0];
                const inspectionDate = parseDate(inspectionDateStr);
                const soldDate = parseDate(soldDateStr);

                // AUTO-SOLD LOGIC: If sold date exists, override status to "Sold"
                let finalLeadStatusId = leadStatusId;
                if (soldDate) {
                    console.log('\n🎯 SOLD DATE DETECTED - Overriding status to "Sold"...');
                    console.log('Sold Date:', soldDate);
                    
                    // Find or create "Sold" status
                    const soldStatusResult = await client.query(
                        `SELECT id FROM leads_dashboard.lead_status WHERE LOWER(name) = 'sold' LIMIT 1`
                    );
                    
                    if (soldStatusResult.rows.length > 0) {
                        finalLeadStatusId = soldStatusResult.rows[0].id;
                        console.log('✅ Using existing "Sold" status ID:', finalLeadStatusId);
                    } else {
                        // Create "Sold" status if it doesn't exist
                        const createSoldResult = await client.query(
                            `INSERT INTO leads_dashboard.lead_status (name) VALUES ('Sold') RETURNING id`
                        );
                        finalLeadStatusId = createSoldResult.rows[0].id;
                        console.log('✅ Created new "Sold" status ID:', finalLeadStatusId);
                    }
                    
                    console.log(`🔄 Status changed from "${leadStatusNameFinal}" to "Sold" due to sold date`);
                    results.autoSoldCount++;
                }

                // Now handle the lead creation or update
                if (isUpdate) {
                    // UPDATE EXISTING LEAD
                    console.log('\n10. Updating existing lead...');
                    
                    // Update the existing lead (Excel data always wins)
                    await client.query(
                        `UPDATE leads_dashboard.lead 
                        SET name = $1,
                            created_date = $2,
                            lead_status_id = $3,
                            sales_person_id = $4,
                            source_id = $5,
                            proposal_status_id = $6,
                            note = $7,
                            condition_id = $8,
                            property_type_id = $9,
                            final_proposal_amount = $10,
                            proposal_tm = $11,
                            inspection_date = $12,
                            sold_date = $13,
                            updated_at = CURRENT_TIMESTAMP
                        WHERE id = $14`,
                        [
                            leadName,
                            createdDate,
                            finalLeadStatusId,
                            salesPersonId,
                            sourceId,
                            proposalStatusId,
                            notes,
                            conditionId,
                            propertyTypeId,
                            proposalAmount,
                            parseFloat(totalEstimatedTM) || 0,
                            inspectionDate,
                            soldDate,
                            leadId
                        ]
                    );

                    // Update customer information (Excel data always wins)
                    await client.query(
                        `UPDATE leads_dashboard.customer 
                        SET first_name = $1,
                            last_name = $2,
                            email_address = $3,
                            phone = $4
                        WHERE id = $5`,
                        [firstName, lastName, email, phone, customerId]
                    );

                    // Update address information (Excel data always wins)
                    await client.query(
                        `UPDATE leads_dashboard.address 
                        SET street = $1,
                            city = $2,
                            state = $3,
                            zip_code = $4
                        WHERE id = $5`,
                        [streetAddress, city, state, zipCode, addressId]
                    );

                    console.log('✅ Lead updated successfully');
                    
                } else {
                    // CREATE NEW LEAD
                    console.log('\n10. Creating new lead...');
                    const leadResult = await client.query(
                        `INSERT INTO leads_dashboard.lead 
                        (name, created_date, lead_status_id, sales_person_id, source_id, 
                        proposal_status_id, customer_id, note, condition_id, property_type_id, final_proposal_amount, proposal_tm, 
                        inspection_date, sold_date, branch_id) 
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) 
                        RETURNING id`,
                        [
                            leadName,
                            createdDate,
                            finalLeadStatusId, // Use the final status (either original or "Sold")
                            salesPersonId,
                            sourceId,
                            proposalStatusId,
                            customerId,
                            notes,
                            conditionId,
                            propertyTypeId,
                            proposalAmount,
                            parseFloat(totalEstimatedTM) || 0,
                            inspectionDate,
                            soldDate,
                            branchId
                        ]
                    );
                    leadId = leadResult.rows[0].id;
                    console.log('Lead created with ID:', leadId, 'Name:', leadName);
                }

                // 11. Handle tags (Excel data always wins - replace all existing tags)
                console.log('\n11. Processing Tags...');
                
                // First, remove all existing tags for this lead if it's an update
                if (isUpdate) {
                    await client.query(
                        `DELETE FROM leads_dashboard.lead_tag WHERE lead_id = $1`,
                        [leadId]
                    );
                    console.log('Removed existing tags for lead update');
                }
                
                // Then add the new tags from Excel
                if (tags) {
                    const tagList = tags.split(',').map(tag => tag.trim()).filter(tag => tag);
                    
                    for (const tagName of tagList) {
                        // Create or get tag (using cache)
                        const tagKey = tagName.toLowerCase();
                        let tagId;
                        
                        if (lookupData.tags.has(tagKey)) {
                            tagId = lookupData.tags.get(tagKey);
                        } else {
                            const tagResult = await client.query(
                                `INSERT INTO leads_dashboard.tag (name) VALUES ($1) RETURNING id`,
                                [tagName]
                            );
                            tagId = tagResult.rows[0].id;
                            lookupData.tags.set(tagKey, tagId);
                        }
                        
                        // Associate tag with lead
                        await client.query(
                            `INSERT INTO leads_dashboard.lead_tag (lead_id, tag_id) 
                            VALUES ($1, $2) 
                            ON CONFLICT (lead_id, tag_id) DO NOTHING`,
                            [leadId, tagId]
                        );
                    }
                    console.log('Tags processed:', tagList);
                } else {
                    console.log('No tags to add from Excel');
                }

                await client.query('COMMIT');
                results.success++;
                if (isUpdate) {
                    results.updated++;
                    console.log(`✅ Fila ${index + 1} - Lead actualizado exitosamente (ID: ${leadId})`);
                } else {
                    results.created++;
                    console.log(`✅ Fila ${index + 1} - Lead creado exitosamente (ID: ${leadId})`);
                }

            } catch (error) {
                await client.query('ROLLBACK');
                console.error(`❌ Error en fila ${index + 1}:`, error.message);
                console.error('Error code:', error.code);
                console.error('Error detail:', error.detail);
                console.error('Error constraint:', error.constraint);
                console.error('Stack trace:', error.stack);
                console.error('Datos de la fila que falló:', JSON.stringify(row, null, 2));
                
                // Provide more specific error messages
                let userFriendlyError = error.message;
                if (error.code === '23505') {
                    userFriendlyError = `Duplicate entry detected: ${error.detail || error.message}`;
                } else if (error.code === '23503') {
                    userFriendlyError = `Foreign key constraint violation: ${error.detail || error.message}`;
                } else if (error.code === '23502') {
                    userFriendlyError = `Required field missing: ${error.detail || error.message}`;
                }
                
                results.errors.push({
                    row: index + 1,
                    data: row,
                    error: userFriendlyError,
                    errorCode: error.code,
                    originalError: error.message,
                    stack: error.stack
                });
            } finally {
                client.release();
            }
        }

        console.log('\n=== PROCESAMIENTO COMPLETADO ===');
        console.log('📊 RESUMEN FINAL:');
        console.log(`✅ Leads procesados exitosamente: ${results.success}`);
        console.log(`🆕 Leads nuevos creados: ${results.created}`);
        console.log(`🔄 Leads existentes actualizados: ${results.updated}`);
        console.log(`❌ Errores de procesamiento: ${results.errors.length}`);
        console.log(`📈 Total procesados: ${results.total}`);
        console.log(`📊 Tasa de éxito: ${((results.success / results.total) * 100).toFixed(1)}%`);
        console.log(`📈 Leads automáticamente convertidos a "Sold": ${results.autoSoldCount}`);
        
        if (results.errors.length > 0) {
            console.log('\n🔍 DETALLES DE ERRORES:');
            console.log(`\n⚠️ ERRORES DE PROCESAMIENTO (${results.errors.length}):`);
            results.errors.slice(0, 5).forEach((error, index) => {
                console.log(`${index + 1}. Fila ${error.row}: ${error.error}`);
            });
            if (results.errors.length > 5) {
                console.log(`... y ${results.errors.length - 5} errores más`);
            }
        }

        res.json(results);
    },

    // Handle AI chat queries with enhanced business intelligence
    handleAiChat: async (req, res) => {
        try {
            const { question } = req.body;
            
            if (!question) {
                return res.status(400).json({ error: 'Question is required' });
            }

            console.log('🤖 Enhanced AI Chat Question:', question);

            // Check if OpenAI API key is configured
            if (!process.env.OPENAI_API_KEY) {
                return res.json({
                    answer: '🔑 OpenAI API key is not configured. Please add your OPENAI_API_KEY to the environment variables to enable AI capabilities.',
                    data: [],
                    sql: null,
                    suggestions: businessIntelligence.getFollowUpSuggestions('general_business', [])
                });
            }

            // Start timing for performance optimization
            const startTime = Date.now();

            try {
                // Use enhanced GPT system to generate SQL from natural language
                const sqlQuery = await generateSQLFromQuestion(question);
                console.log('🔍 Generated SQL:', sqlQuery);

                // Handle special responses from AI
                if (sqlQuery === 'CONVERSATIONAL_QUERY') {
                    console.log('💬 Handling as conversational question');
                    
                    // Generate a conversational response using the natural language function
                    const conversationalResponse = await generateNaturalLanguageResponse(question, [], '');
                    const responseTime = Date.now() - startTime;
                    
                    return res.json({
                        answer: conversationalResponse,
                        data: [],
                        sql: null,
                        suggestions: businessIntelligence.getFollowUpSuggestions(question, []),
                        performance: {
                            responseTime: responseTime,
                            resultCount: 0,
                            insights: businessIntelligence.getPerformanceInsights()
                        },
                        category: 'conversational',
                        isConversational: true
                    });
                }
                
                if (sqlQuery === 'UNABLE_TO_CREATE_SQL') {
                    console.log('⚠️ AI unable to create SQL');
                    
                    const responseTime = Date.now() - startTime;
                    return res.json({
                        answer: `I understand you're asking about "${question}", but I need more specific information to query your database. Let me suggest some ways to explore your Attic Projects data!`,
                        data: [],
                        sql: null,
                        suggestions: [
                            "How many leads do we have this month?",
                            "Who are our top salespeople by revenue?",
                            "What's the average deal size by branch?",
                            "Show me recent leads that need follow-up"
                        ],
                        performance: {
                            responseTime: responseTime,
                            resultCount: 0,
                            insights: businessIntelligence.getPerformanceInsights()
                        },
                        category: 'help',
                        isConversational: true
                    });
                }

                // Check if the response is actually SQL or conversational text
                const sqlPattern = /^(SELECT|INSERT|UPDATE|DELETE|WITH|CREATE|ALTER|DROP)\s+/i;
                const isValidSQL = sqlPattern.test(sqlQuery.trim());
                
                if (!isValidSQL) {
                    console.log('⚠️ AI returned conversational text instead of SQL:', sqlQuery);
                    
                    // Return conversational response without trying to execute SQL
                    const responseTime = Date.now() - startTime;
                    return res.json({
                        answer: sqlQuery, // The conversational response from AI
                        data: [],
                        sql: null,
                        suggestions: businessIntelligence.getFollowUpSuggestions(question, []),
                        performance: {
                            responseTime: responseTime,
                            resultCount: 0,
                            insights: businessIntelligence.getPerformanceInsights()
                        },
                        category: businessIntelligence.categorizeBusinessQuestion ? businessIntelligence.categorizeBusinessQuestion(question) : 'general',
                        isConversational: true
                    });
                }

                // Execute the generated SQL query
                const result = await db.pool.query(sqlQuery);
                console.log(`📊 Query results: ${result.rows.length} rows in ${Date.now() - startTime}ms`);

                // Generate enhanced natural language response with business intelligence
                const naturalResponse = await generateNaturalLanguageResponse(question, result.rows, sqlQuery);

                // Get smart follow-up suggestions based on business intelligence
                const followUpSuggestions = businessIntelligence.getFollowUpSuggestions(question, result.rows);

                // Get performance insights for this session
                const performanceInsights = businessIntelligence.getPerformanceInsights();

                const responseTime = Date.now() - startTime;
                console.log(`⚡ Total response time: ${responseTime}ms`);

                res.json({
                    answer: naturalResponse,
                    data: result.rows,
                    sql: sqlQuery,
                    suggestions: followUpSuggestions.slice(0, 3), // Top 3 suggestions
                    performance: {
                        responseTime: responseTime,
                        resultCount: result.rows.length,
                        insights: performanceInsights
                    },
                    category: businessIntelligence.categorizeBusinessQuestion ? businessIntelligence.categorizeBusinessQuestion(question) : 'general'
                });

            } catch (sqlError) {
                console.error('❌ SQL Generation or Execution Error:', sqlError);
                
                // If SQL generation fails, try to provide a helpful conversational response
                let fallbackResponse = '';
                let suggestions = [];
                
                if (sqlError.message && sqlError.message.includes('syntax error')) {
                    fallbackResponse = `I understand you're asking about "${question}", but I had trouble converting that into a database query. Let me help you ask a more specific question about your business data!`;
                    suggestions = [
                        "How many leads do we have this month?",
                        "Who are our top 3 salespeople by revenue?",
                        "What's the average deal size for each branch?",
                        "Show me leads created in the last 30 days"
                    ];
                } else if (sqlError.message && sqlError.message.includes('relation') && sqlError.message.includes('does not exist')) {
                    fallbackResponse = `I tried to access data that doesn't exist in your database. Let me help you explore the data we do have available for Attic Projects!`;
                    suggestions = [
                        "What tables are available in our database?",
                        "Show me all leads from this year",
                        "List our salespeople and their performance",
                        "What are our branch locations?"
                    ];
                } else {
                    // For other SQL errors, provide conversational response
                    fallbackResponse = `I understand your question about "${question}", but I need to approach it differently. Let me suggest some specific ways to explore your business data!`;
                    suggestions = businessIntelligence.getFollowUpSuggestions('general_business', []);
                }

                // Still learn from the interaction for future improvement
                businessIntelligence.learnFromQuery(question, [], '');

                const responseTime = Date.now() - startTime;
                
                res.json({
                    answer: fallbackResponse,
                    data: [],
                    sql: null,
                    suggestions: suggestions.slice(0, 4),
                    performance: {
                        responseTime: responseTime,
                        resultCount: 0,
                        insights: businessIntelligence.getPerformanceInsights()
                    },
                    category: 'conversational',
                    isConversational: true,
                    errorHandled: true
                });
            }

        } catch (error) {
            console.error('❌ Error in enhanced AI chat:', error);
            
            // Enhanced error handling with business intelligence
            let userFriendlyMessage = '';
            let suggestions = businessIntelligence.getFollowUpSuggestions('general_business', []);

            if (error.response && error.response.status === 429) {
                userFriendlyMessage = '⏱️ I\'m receiving too many requests right now. Please wait a moment and try again.';
            } else if (error.response && error.response.status === 401) {
                userFriendlyMessage = '🔑 There\'s an issue with the AI service authentication. Please check the API configuration.';
            } else {
                userFriendlyMessage = '😅 I encountered an unexpected error. Let\'s try a simpler question or approach this differently!';
                suggestions = [
                    "How many leads do we have?",
                    "Who are our salespeople?",
                    "What branches do we operate in?"
                ];
            }

            // Get the question from the request for learning (fix scoping issue)
            const questionFromRequest = req.body.question || 'unknown';
            
            // Still learn from the failed interaction
            businessIntelligence.learnFromQuery(questionFromRequest, [], '');

            res.json({ 
                answer: userFriendlyMessage,
                data: [],
                sql: null,
                suggestions: suggestions,
                error: true,
                errorType: error.response ? 'api_error' : 'general_error',
                performance: {
                    responseTime: 0,
                    resultCount: 0,
                    insights: businessIntelligence.getPerformanceInsights()
                },
                isConversational: true
            });
        }
    }
};

module.exports = insightController; 