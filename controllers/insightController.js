const xlsx = require('xlsx');
const db = require('../config/database');
const { generateSQLFromQuestion, generateNaturalLanguageResponse } = require('../config/openai');

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

    // Render the insights page
    getInsightsPage: async (req, res) => {
        try {
            res.render('insights');
        } catch (error) {
            console.error('Error rendering insights page:', error);
            res.status(500).render('error', { error: 'Failed to load insights page' });
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
                    COALESCE(l.retail_cost, 0) as retail_cost,
                    COALESCE(l.discount_provided, 0) as discount_provided,
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
            console.log(`Query returned ${result.rows.length} leads`);
            if (result.rows.length > 0) {
                console.log('First lead sample:', JSON.stringify(result.rows[0], null, 2));
            }
            res.json(result.rows);
        } catch (error) {
            console.error('Error fetching leads:', error);
            console.error('Error details:', error.message);
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
            errors: []
        };

        console.log('\n=== INICIANDO PROCESAMIENTO ===');

        for (const [index, row] of rows.entries()) {
            console.log(`\n--- Procesando fila ${index + 1}/${rows.length} ---`);
            console.log('Datos de la fila:', JSON.stringify(row, null, 2));

            // Extract values with flexible column mapping
            const opportunityTitle = getColumnValue(row, [
                'Opportunity Title', 'Opportunity', 'Lead Name', 'Name', 'Title', 'Job Title'
            ]);
            
            const salespersonName = getColumnValue(row, [
                'Salesperson', 'Sales Person', 'Salesman', 'Sales Rep', 'Rep', 'Agent'
            ]);
            
            const sourceName = getColumnValue(row, [
                'Source', 'Lead Source', 'Origin', 'Referral Source'
            ]);
            
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
            console.log('Salesperson:', salespersonName);
            console.log('Source:', sourceName);
            console.log('Lead Status:', leadStatusName);
            console.log('Tags:', tags);
            console.log('Customer:', firstName, lastName);
            console.log('Email:', email);
            console.log('Phone:', phone);

            // Usar una transacción individual para cada lead
            const client = await db.pool.connect();
            try {
                await client.query('BEGIN');
                console.log('Iniciando transacción individual para fila', index + 1);
                
                // 1. Insertar dirección
                console.log('\n1. Insertando dirección...');
                const addressResult = await client.query(
                    `INSERT INTO leads_dashboard.address 
                    (street, city, state, zip_code) 
                    VALUES ($1, $2, $3, $4) 
                    RETURNING id`,
                    [streetAddress, city, state, zipCode]
                );
                const addressId = addressResult.rows[0].id;
                console.log('Dirección creada con ID:', addressId);

                // 2. Insertar cliente
                console.log('\n2. Insertando cliente...');
                const customerResult = await client.query(
                    `INSERT INTO leads_dashboard.customer 
                    (address_id, first_name, last_name, email_address, phone) 
                    VALUES ($1, $2, $3, $4, $5) 
                    RETURNING id`,
                    [addressId, firstName, lastName, email, phone]
                );
                const customerId = customerResult.rows[0].id;
                console.log('Cliente creado con ID:', customerId);

                // 3. Obtener o crear lead status
                console.log('\n3. Procesando Lead Status...');
                const leadStatusNameFinal = (leadStatusName || 'New').trim();
                let leadStatusId;
                
                // Primero intentar encontrar el lead status existente (case-insensitive)
                const existingLeadStatus = await client.query(
                    `SELECT id FROM leads_dashboard.lead_status WHERE LOWER(name) = LOWER($1) LIMIT 1`,
                    [leadStatusNameFinal]
                );
                
                if (existingLeadStatus.rows.length > 0) {
                    leadStatusId = existingLeadStatus.rows[0].id;
                    console.log('Lead Status encontrado con ID:', leadStatusId, 'Nombre:', leadStatusNameFinal);
                } else {
                    // Si no existe, crear uno nuevo con manejo de conflictos
                    try {
                        const leadStatusResult = await client.query(
                            `INSERT INTO leads_dashboard.lead_status (name) 
                            VALUES ($1) 
                            RETURNING id`,
                            [leadStatusNameFinal]
                        );
                        leadStatusId = leadStatusResult.rows[0].id;
                        console.log('Lead Status creado con ID:', leadStatusId, 'Nombre:', leadStatusNameFinal);
                    } catch (statusError) {
                        // Si hay un error de duplicado, intentar obtener el existente
                        if (statusError.code === '23505') { // unique_violation
                            console.log('Lead Status ya existe, obteniendo ID existente...');
                            const retryResult = await client.query(
                                `SELECT id FROM leads_dashboard.lead_status WHERE LOWER(name) = LOWER($1) LIMIT 1`,
                                [leadStatusNameFinal]
                            );
                            if (retryResult.rows.length > 0) {
                                leadStatusId = retryResult.rows[0].id;
                                console.log('Lead Status encontrado en retry con ID:', leadStatusId, 'Nombre:', leadStatusNameFinal);
                            } else {
                                throw new Error(`No se pudo crear ni encontrar el lead status: ${leadStatusNameFinal}`);
                            }
                        } else {
                            throw statusError;
                        }
                    }
                }

                // 4. Obtener o crear salesperson
                console.log('\n4. Procesando Sales Person...');
                let salesPersonId;
                const salesPersonNameFinal = (salespersonName || 'Unknown').trim();
                
                // Primero intentar encontrar el salesperson existente (case-insensitive)
                const existingSalesPerson = await client.query(
                    `SELECT id FROM leads_dashboard.sales_person WHERE LOWER(name) = LOWER($1) LIMIT 1`,
                    [salesPersonNameFinal]
                );
                
                if (existingSalesPerson.rows.length > 0) {
                    salesPersonId = existingSalesPerson.rows[0].id;
                    console.log('Sales Person encontrado con ID:', salesPersonId, 'Nombre:', salesPersonNameFinal);
                } else {
                    // Si no existe, crear uno nuevo con manejo de conflictos
                    try {
                        const salesPersonResult = await client.query(
                            `INSERT INTO leads_dashboard.sales_person (name, branch_id) 
                            VALUES ($1, $2) 
                            RETURNING id`,
                            [salesPersonNameFinal, branchId]
                        );
                        salesPersonId = salesPersonResult.rows[0].id;
                        console.log('Sales Person creado con ID:', salesPersonId, 'Nombre:', salesPersonNameFinal);
                    } catch (salesPersonError) {
                        // Si hay un error, intentar obtener el existente
                        console.log('Error creando Sales Person, intentando obtener existente...');
                        const retryResult = await client.query(
                            `SELECT id FROM leads_dashboard.sales_person WHERE LOWER(name) = LOWER($1) LIMIT 1`,
                            [salesPersonNameFinal]
                        );
                        if (retryResult.rows.length > 0) {
                            salesPersonId = retryResult.rows[0].id;
                            console.log('Sales Person encontrado en retry con ID:', salesPersonId, 'Nombre:', salesPersonNameFinal);
                        } else {
                            throw new Error(`No se pudo crear ni encontrar el sales person: ${salesPersonNameFinal}`);
                        }
                    }
                }

                // 5. Obtener o crear source
                console.log('\n5. Procesando Source...');
                const sourceNameFinal = sourceName || 'Unknown';
                const sourceResult = await client.query(
                    `INSERT INTO leads_dashboard.source (name) 
                    VALUES ($1) 
                    ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name 
                    RETURNING id`,
                    [sourceNameFinal]
                );
                const sourceId = sourceResult.rows[0].id;
                console.log('Source ID:', sourceId, 'Nombre:', sourceNameFinal);

                // 6. Obtener o crear proposal status
                console.log('\n6. Procesando Proposal Status...');
                const proposalStatusFinal = proposalStatus || 'Closed';
                const proposalStatusResult = await client.query(
                    `INSERT INTO leads_dashboard.proposal_status (name) 
                    VALUES ($1) 
                    ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name 
                    RETURNING id`,
                    [proposalStatusFinal]
                );
                const proposalStatusId = proposalStatusResult.rows[0].id;
                console.log('Proposal Status ID:', proposalStatusId, 'Nombre:', proposalStatusFinal);

                // 7. Obtener o crear condition
                console.log('\n7. Procesando Condition...');
                const conditionFinal = condition || 'Normal';
                const conditionResult = await client.query(
                    `INSERT INTO leads_dashboard.condition (name) 
                    VALUES ($1) 
                    ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name 
                    RETURNING id`,
                    [conditionFinal]
                );
                const conditionId = conditionResult.rows[0].id;
                console.log('Condition ID:', conditionId, 'Nombre:', conditionFinal);

                // 8. Obtener o crear property type
                console.log('\n8. Procesando Property Type...');
                const propertyTypeFinal = propertyType || 'Unknown';
                const propertyTypeResult = await client.query(
                    `INSERT INTO leads_dashboard.property_type (name) 
                    VALUES ($1) 
                    ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name 
                    RETURNING id`,
                    [propertyTypeFinal]
                );
                const propertyTypeId = propertyTypeResult.rows[0].id;
                console.log('Property Type ID:', propertyTypeId, 'Nombre:', propertyTypeFinal);

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

                // 10. Insertar lead
                console.log('\n10. Insertando Lead...');
                const leadResult = await client.query(
                    `INSERT INTO leads_dashboard.lead 
                    (name, created_date, lead_status_id, sales_person_id, source_id, 
                    proposal_status_id, customer_id, note, condition_id, property_type_id, final_proposal_amount, proposal_tm, 
                    inspection_date, sold_date, branch_id) 
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) 
                    RETURNING id`,
                    [
                        opportunityTitle || `Lead ${index + 1}`,
                        createdDate,
                        leadStatusId,
                        salesPersonId,
                        sourceId,
                        proposalStatusId,
                        customerId,
                        notes,
                        conditionId,
                        propertyTypeId,
                        parseFloat(finalProposalAmount) || 0,
                        parseFloat(totalEstimatedTM) || 0,
                        inspectionDate,
                        soldDate,
                        branchId
                    ]
                );
                const leadId = leadResult.rows[0].id;
                console.log('Lead creado con ID:', leadId, 'Nombre:', opportunityTitle || `Lead ${index + 1}`);

                // 11. Manejar tags
                if (tags) {
                    console.log('\n11. Procesando Tags...');
                    const tagList = tags.split(',').map(tag => tag.trim()).filter(tag => tag);
                    
                    for (const tagName of tagList) {
                        // Crear o obtener tag
                        const tagResult = await client.query(
                            `INSERT INTO leads_dashboard.tag (name) 
                            VALUES ($1) 
                            ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name 
                            RETURNING id`,
                            [tagName]
                        );
                        const tagId = tagResult.rows[0].id;
                        
                        // Asociar tag con lead
                        await client.query(
                            `INSERT INTO leads_dashboard.lead_tag (lead_id, tag_id) 
                            VALUES ($1, $2) 
                            ON CONFLICT (lead_id, tag_id) DO NOTHING`,
                            [leadId, tagId]
                        );
                    }
                    console.log('Tags procesados:', tagList);
                }

                await client.query('COMMIT');
                results.success++;
                console.log(`✅ Fila ${index + 1} procesada exitosamente`);

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
        console.log(`✅ Leads insertados exitosamente: ${results.success}`);
        console.log(`❌ Leads que NO fueron insertados: ${results.errors.length}`);
        console.log(`📈 Total procesados: ${results.total}`);
        console.log(`📊 Tasa de éxito: ${((results.success / results.total) * 100).toFixed(1)}%`);
        
        if (results.errors.length > 0) {
            console.log('\n🔍 PRIMEROS 5 ERRORES:');
            results.errors.slice(0, 5).forEach((error, index) => {
                console.log(`${index + 1}. Fila ${error.row}: ${error.error}`);
            });
            if (results.errors.length > 5) {
                console.log(`... y ${results.errors.length - 5} errores más`);
            }
        }

        res.json(results);
    },

    // Handle AI chat queries with real GPT-4
    handleAiChat: async (req, res) => {
        try {
            const { question } = req.body;
            
            if (!question) {
                return res.status(400).json({ error: 'Question is required' });
            }

            console.log('AI Chat Question:', question);

            // Check if OpenAI API key is configured
            if (!process.env.OPENAI_API_KEY) {
                return res.json({
                    answer: 'OpenAI API key is not configured. Please add your OPENAI_API_KEY to the environment variables.',
                    data: [],
                    sql: null
                });
            }

            // Use GPT-4 to generate SQL from natural language
            const sqlQuery = await generateSQLFromQuestion(question);
            console.log('Generated SQL:', sqlQuery);

            // Execute the generated SQL query
            const result = await db.pool.query(sqlQuery);
            console.log('Query results:', result.rows.length, 'rows');

            // Generate natural language response
            const naturalResponse = await generateNaturalLanguageResponse(question, result.rows, sqlQuery);

            res.json({
                answer: naturalResponse,
                data: result.rows,
                sql: sqlQuery
            });

        } catch (error) {
            console.error('Error in AI chat:', error);
            
            // If it's a SQL error, try to provide helpful feedback
            if (error.message && error.message.includes('syntax error')) {
                res.json({
                    answer: 'I generated an invalid SQL query. Let me try a simpler approach. Could you rephrase your question or be more specific?',
                    data: [],
                    sql: null
                });
            } else if (error.message && error.message.includes('relation') && error.message.includes('does not exist')) {
                res.json({
                    answer: 'I tried to query a table that doesn\'t exist. Could you ask about leads, salespeople, branches, or customers?',
                    data: [],
                    sql: null
                });
            } else {
                res.json({ 
                    answer: 'Sorry, I encountered an error processing your question. Please try rephrasing it or ask something simpler.',
                    data: [],
                    sql: null
                });
            }
        }
    }
};

module.exports = insightController; 