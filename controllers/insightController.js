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

    // Render the insights page
    getInsightsPage: async (req, res) => {
        try {
            res.render('insights');
        } catch (error) {
            console.error('Error rendering insights page:', error);
            res.status(500).render('error', { error: 'Failed to load insights page' });
        }
    },

    // Get closed leads from the last year
    getClosedLeads: async (req, res) => {
        try {
            const query = `
                SELECT 
                    l.id,
                    l.name as opportunity_title,
                    l.created_date,
                    ls.name as lead_status,
                    sp.name as salesperson,
                    l.inspection_date,
                    l.sold_date,
                    CASE 
                        WHEN l.sold_date IS NOT NULL AND l.created_date IS NOT NULL 
                        THEN l.sold_date - l.created_date 
                        ELSE NULL 
                    END as days_to_sign,
                    l.final_proposal_amount,
                    l.proposal_tm as total_estimated_tm,
                    a.city,
                    a.state,
                    a.street as street_address,
                    a.zip_code,
                    s.name as source,
                    c.email_address,
                    c.first_name,
                    c.last_name,
                    c.phone,
                    STRING_AGG(t.name, ', ') as tags,
                    pt.name as property_type,
                    l.branch_id,
                    b.name as branch_name
                FROM leads_dashboard.lead l
                LEFT JOIN leads_dashboard.lead_status ls ON l.lead_status_id = ls.id
                LEFT JOIN leads_dashboard.sales_person sp ON l.sales_person_id = sp.id
                LEFT JOIN leads_dashboard.customer c ON l.customer_id = c.id
                LEFT JOIN leads_dashboard.address a ON c.address_id = a.id
                LEFT JOIN leads_dashboard.source s ON l.source_id = s.id
                LEFT JOIN leads_dashboard.property_type pt ON l.property_type_id = pt.id
                LEFT JOIN leads_dashboard.branch b ON l.branch_id = b.id
                LEFT JOIN leads_dashboard.lead_tag lt ON l.id = lt.lead_id
                LEFT JOIN leads_dashboard.tag t ON lt.tag_id = t.id
                WHERE l.sold_date IS NOT NULL 
                AND l.sold_date >= CURRENT_DATE - INTERVAL '1 year'
                GROUP BY l.id, l.name, l.created_date, ls.name, sp.name, l.inspection_date, 
                         l.sold_date, l.final_proposal_amount, l.proposal_tm, a.city, a.state, 
                         a.street, a.zip_code, s.name, c.email_address, c.first_name, 
                         c.last_name, c.phone, l.note, pt.name, l.branch_id, b.name
                ORDER BY l.sold_date DESC
            `;
            
            const result = await db.pool.query(query);
            res.json(result.rows);
        } catch (error) {
            console.error('Error fetching closed leads:', error);
            res.status(500).json({ error: 'Error fetching closed leads' });
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

        console.log('=== INICIO DE IMPORTACIÓN DE CLOSED LEADS ===');
        console.log('Archivo recibido:', req.file.originalname);
        console.log('Branch ID seleccionado:', branchId);

        const workbook = xlsx.readFile(req.file.path);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const rows = xlsx.utils.sheet_to_json(worksheet);

        console.log('\n=== DATOS LEÍDOS DEL EXCEL ===');
        console.log('Total de filas:', rows.length);
        console.log('Primera fila de ejemplo:', JSON.stringify(rows[0], null, 2));

        const results = {
            total: rows.length,
            success: 0,
            errors: []
        };

        console.log('\n=== INICIANDO PROCESAMIENTO ===');

        for (const [index, row] of rows.entries()) {
            console.log(`\n--- Procesando fila ${index + 1}/${rows.length} ---`);
            console.log('Datos de la fila:', JSON.stringify(row, null, 2));

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
                        [
                            row['Street Address (Contact)'] || row['Street Addres'] || row['Street Address'] || '',
                            row['City (Contact)'] || row['City'] || '',
                            row['State (Contact)'] || row['State'] || '',
                            row['Zip (Contact)'] || row['Zip'] || ''
                        ]
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
                        [
                            addressId,
                            row['First Name'] || '',
                            row['Last Name'] || '',
                            row['Email Address'] || '',
                            row['Phone'] || ''
                        ]
                    );
                    const customerId = customerResult.rows[0].id;
                    console.log('Cliente creado con ID:', customerId);

                    // 3. Obtener o crear status
                    console.log('\n3. Procesando Lead Status...');
                    const leadStatusResult = await client.query(
                        `INSERT INTO leads_dashboard.lead_status (name) 
                        VALUES ($1) 
                        ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name 
                        RETURNING id`,
                        [row['Lead Status'] || 'Closed']
                    );
                    const leadStatusId = leadStatusResult.rows[0].id;
                    console.log('Lead Status ID:', leadStatusId, 'Nombre:', row['Lead Status'] || 'Closed');

                    // 4. Obtener o crear salesperson
                    console.log('\n4. Procesando Sales Person...');
                    let salesPersonId;
                    const salesPersonName = row['Salesperson'] || 'Unknown';
                    
                    // Primero intentar encontrar el salesperson existente
                    const existingSalesPerson = await client.query(
                        `SELECT id FROM leads_dashboard.sales_person WHERE name = $1 LIMIT 1`,
                        [salesPersonName]
                    );
                    
                    if (existingSalesPerson.rows.length > 0) {
                        salesPersonId = existingSalesPerson.rows[0].id;
                        console.log('Sales Person encontrado con ID:', salesPersonId, 'Nombre:', salesPersonName);
                    } else {
                        // Si no existe, crear uno nuevo
                        const salesPersonResult = await client.query(
                            `INSERT INTO leads_dashboard.sales_person (name, branch_id) 
                            VALUES ($1, $2) 
                            RETURNING id`,
                            [salesPersonName, branchId]
                        );
                        salesPersonId = salesPersonResult.rows[0].id;
                        console.log('Sales Person creado con ID:', salesPersonId, 'Nombre:', salesPersonName);
                    }

                    // 5. Obtener o crear source
                    console.log('\n5. Procesando Source...');
                    const sourceResult = await client.query(
                        `INSERT INTO leads_dashboard.source (name) 
                        VALUES ($1) 
                        ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name 
                        RETURNING id`,
                        [row['Source'] || 'Unknown']
                    );
                    const sourceId = sourceResult.rows[0].id;
                    console.log('Source ID:', sourceId, 'Nombre:', row['Source'] || 'Unknown');

                    // 6. Obtener o crear proposal status
                    console.log('\n6. Procesando Proposal Status...');
                    const proposalStatusResult = await client.query(
                        `INSERT INTO leads_dashboard.proposal_status (name) 
                        VALUES ($1) 
                        ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name 
                        RETURNING id`,
                        [row['Proposal Status'] || 'Closed']
                    );
                    const proposalStatusId = proposalStatusResult.rows[0].id;
                    console.log('Proposal Status ID:', proposalStatusId, 'Nombre:', row['Proposal Status'] || 'Closed');

                    // 7. Obtener o crear condition
                    console.log('\n7. Procesando Condition...');
                    const conditionResult = await client.query(
                        `INSERT INTO leads_dashboard.condition (name) 
                        VALUES ($1) 
                        ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name 
                        RETURNING id`,
                        [row['Condition'] || 'Normal']
                    );
                    const conditionId = conditionResult.rows[0].id;
                    console.log('Condition ID:', conditionId, 'Nombre:', row['Condition'] || 'Normal');

                    // 8. Obtener o crear property type
                    console.log('\n8. Procesando Property Type...');
                    const propertyTypeResult = await client.query(
                        `INSERT INTO leads_dashboard.property_type (name) 
                        VALUES ($1) 
                        ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name 
                        RETURNING id`,
                        [row['Property Type*'] || row['Property Type'] || 'Unknown']
                    );
                    const propertyTypeId = propertyTypeResult.rows[0].id;
                    console.log('Property Type ID:', propertyTypeId, 'Nombre:', row['Property Type*'] || row['Property Type'] || 'Unknown');

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

                    const createdDate = parseDate(row['Created Date']) || new Date().toISOString().split('T')[0];
                    const inspectionDate = parseDate(row['Inspection Date*'] || row['Inspection Date']);
                    const soldDate = parseDate(row['Sold Date']);

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
                            row['Opportunity Title'] || '',
                            createdDate,
                            leadStatusId,
                            salesPersonId,
                            sourceId,
                            proposalStatusId,
                            customerId,
                            row['Notes'] || '',
                            conditionId,
                            propertyTypeId,
                            parseFloat(row['Final Proposal Amount*'] || row['Final Proposal Amount']) || 0,
                            parseFloat(row['Total Estimated T&M *'] || row['Total Estimated T&M']) || 0,
                            inspectionDate,
                            soldDate,
                            branchId
                        ]
                    );
                    const leadId = leadResult.rows[0].id;
                    console.log('Lead creado con ID:', leadId);

                    // 11. Manejar tags
                    if (row['Tags']) {
                        console.log('\n11. Procesando Tags...');
                        const tags = row['Tags'].split(',').map(tag => tag.trim()).filter(tag => tag);
                        
                        for (const tagName of tags) {
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
                        console.log('Tags procesados:', tags);
                    }

                    await client.query('COMMIT');
                    results.success++;
                    console.log(`✅ Fila ${index + 1} procesada exitosamente`);

                } catch (error) {
                    await client.query('ROLLBACK');
                    console.error(`❌ Error en fila ${index + 1}:`, error.message);
                    console.error('Stack trace:', error.stack);
                    console.error('Datos de la fila que falló:', JSON.stringify(row, null, 2));
                    results.errors.push({
                        row: index + 1,
                        data: row,
                        error: error.message,
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