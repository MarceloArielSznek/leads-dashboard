const xlsx = require('xlsx');
const db = require('../config/database');

const importController = {
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

    // Render the import form with branch selection
    renderImportForm: async (req, res) => {
        try {
            const branchesResult = await db.pool.query('SELECT id, name FROM leads_dashboard.branch ORDER BY name');
            res.render('import', { 
                branches: branchesResult.rows,
                campaignId: req.params.campaignId || null
            });
        } catch (error) {
            console.error('Error rendering import form:', error);
            res.status(500).render('error', { error: 'Failed to load import form' });
        }
    },

    importLeads: async (req, res) => {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        // Get branch_id from the form
        const branchId = req.body.branchId;
        if (!branchId) {
            return res.status(400).json({ error: 'Branch selection is required' });
        }

        // Get campaign_id if provided
        const campaignId = req.body.campaignId || null;

        console.log('=== INICIO DE IMPORTACIÓN ===');
        console.log('Archivo recibido:', req.file.originalname);
        console.log('Branch ID:', branchId);
        console.log('Campaign ID:', campaignId);

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

        // Iniciar transacción
        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');
            console.log('\n=== INICIANDO TRANSACCIÓN ===');

            for (const [index, row] of rows.entries()) {
                console.log(`\n--- Procesando fila ${index + 1}/${rows.length} ---`);
                console.log('Datos de la fila:', JSON.stringify(row, null, 2));

                try {
                    // 1. Insertar dirección
                    console.log('\n1. Insertando dirección...');
                    const addressResult = await client.query(
                        `INSERT INTO leads_dashboard.address 
                        (street, city, state, zip_code) 
                        VALUES ($1, $2, $3, $4) 
                        RETURNING id`,
                        [
                            row['Street Address (Contact)'] || '',
                            row['City (Contact)'] || '',
                            row['State (Contact)'] || '',
                            row['Zip (Contact)'] || ''
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
                        [row['Lead Status'] || 'New']
                    );
                    const leadStatusId = leadStatusResult.rows[0].id;
                    console.log('Lead Status ID:', leadStatusId, 'Nombre:', row['Lead Status'] || 'New');

                    // 4. Obtener o crear salesperson
                    console.log('\n4. Procesando Sales Person...');
                    const salesPersonResult = await client.query(
                        `INSERT INTO leads_dashboard.sales_person (name, branch_id) 
                        VALUES ($1, $2) 
                        ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name 
                        RETURNING id`,
                        [row['Salesperson'] || 'Unknown', branchId]
                    );
                    const salesPersonId = salesPersonResult.rows[0].id;
                    console.log('Sales Person ID:', salesPersonId, 'Nombre:', row['Salesperson'] || 'Unknown');

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
                        [row['Proposal Status'] || 'Pending']
                    );
                    const proposalStatusId = proposalStatusResult.rows[0].id;
                    console.log('Proposal Status ID:', proposalStatusId, 'Nombre:', row['Proposal Status'] || 'Pending');

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

                    // 8. Insertar lead
                    console.log('\n8. Insertando Lead...');
                    const leadResult = await client.query(
                        `INSERT INTO leads_dashboard.lead 
                        (name, created_date, lead_status_id, last_contacted, 
                        sales_person_id, source_id, proposal_status_id, 
                        customer_id, note, condition_id, final_proposal_amount,
                        branch_id, campaign_id) 
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) 
                        RETURNING id`,
                        [
                            row['Opportunity Title'] || '',
                            row['Created Date'] ? new Date(row['Created Date']) : new Date(),
                            leadStatusId,
                            row['Last Contacted'] ? new Date(row['Last Contacted']) : null,
                            salesPersonId,
                            sourceId,
                            proposalStatusId,
                            customerId,
                            row['Notes'] || '',
                            conditionId,
                            row['Final Proposal Amount'] || null,
                            branchId,
                            campaignId
                        ]
                    );
                    const leadId = leadResult.rows[0].id;
                    console.log('Lead creado con ID:', leadId);

                    // 9. Manejar tags
                    if (row['Tags']) {
                        console.log('\n9. Procesando Tags...');
                        const tags = row['Tags'].split(',').map(tag => tag.trim());
                        console.log('Tags encontrados:', tags);
                        
                        for (const tagName of tags) {
                            if (tagName) {
                                // Insertar tag si no existe
                                const tagResult = await client.query(
                                    `INSERT INTO leads_dashboard.tag (name) 
                                    VALUES ($1) 
                                    ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name 
                                    RETURNING id`,
                                    [tagName]
                                );
                                const tagId = tagResult.rows[0].id;
                                console.log('Tag procesado:', tagName, 'ID:', tagId);

                                // Crear relación lead-tag
                                await client.query(
                                    `INSERT INTO leads_dashboard.lead_tag (lead_id, tag_id) 
                                    VALUES ($1, $2) 
                                    ON CONFLICT DO NOTHING`,
                                    [leadId, tagId]
                                );
                                console.log('Relación lead-tag creada para:', tagName);
                            }
                        }
                    }

                    results.success++;
                    console.log('\n✓ Fila procesada exitosamente');
                } catch (error) {
                    console.error('\n❌ Error procesando fila:', error.message);
                    results.errors.push({
                        row: row,
                        error: error.message
                    });
                }
            }

            await client.query('COMMIT');
            console.log('\n=== IMPORTACIÓN COMPLETADA ===');
            console.log('Resumen:', results);
            
            res.json({
                message: 'Import completed',
                results: results
            });
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('\n❌ ERROR FATAL EN LA IMPORTACIÓN:', error.message);
            res.status(500).json({
                error: 'Import failed',
                message: error.message
            });
        } finally {
            client.release();
        }
    }
};

module.exports = importController; 