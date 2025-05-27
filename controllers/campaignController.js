const db = require('../config/database');

const campaignController = {
    // Get all campaigns
    getAllCampaigns: async (req, res) => {
        try {
            // Get campaigns with type information
            const result = await db.query(`
                SELECT c.*, ct.id as type_id, ct.name as type_name
                FROM leads_dashboard.campaign c
                LEFT JOIN leads_dashboard.campaign_type ct ON c.campaign_type_id = ct.id
                ORDER BY ct.name, c.created_at DESC
            `);
            
            // Format data for frontend and group by type
            const campaignsByType = {};
            
            result.rows.forEach(campaign => {
                const typeName = campaign.type_name || 'no_opportunity';
                if (!campaignsByType[typeName]) {
                    campaignsByType[typeName] = [];
                }
                
                campaignsByType[typeName].push({
                    id: campaign.id,
                    name: campaign.name,
                    description: campaign.description || '',
                    type: typeName,
                    type_id: campaign.type_id,
                    created_at: campaign.created_at,
                    updated_at: campaign.updated_at
                });
            });
            
            res.json(campaignsByType);
        } catch (error) {
            console.error('Error getting campaigns:', error);
            res.status(500).json({ error: error.message });
        }
    },

    // Get campaign by ID
    getCampaignById: async (req, res) => {
        try {
            const campaignId = parseInt(req.params.id);
            const result = await db.query(`
                SELECT c.*, ct.name as type_name
                FROM leads_dashboard.campaign c
                LEFT JOIN leads_dashboard.campaign_type ct ON c.campaign_type_id = ct.id
                WHERE c.id = $1
            `, [campaignId]);
            
            if (result.rows.length === 0) {
                return res.status(404).json({ error: 'Campaign not found' });
            }
            
            // Obtener las sucursales asociadas
            const branchesResult = await db.query(`
                SELECT b.id, b.name 
                FROM leads_dashboard.branch b
                JOIN leads_dashboard.campaign_branch cb ON b.id = cb.branch_id
                WHERE cb.campaign_id = $1
            `, [campaignId]);
            
            const campaign = {
                ...result.rows[0],
                type: result.rows[0].type_name || 'no_opportunity',
                branches: branchesResult.rows
            };
            
            res.json(campaign);
        } catch (error) {
            console.error('Error getting campaign by ID:', error);
            res.status(500).json({ error: error.message });
        }
    },

    // Get campaign types
    getCampaignTypes: async (req, res) => {
        try {
            const result = await db.query('SELECT * FROM leads_dashboard.campaign_type ORDER BY name');
            res.json(result.rows);
        } catch (error) {
            console.error('Error getting campaign types:', error);
            res.status(500).json({ error: error.message });
        }
    },

    // Get branches
    getBranches: async (req, res) => {
        try {
            const result = await db.query(`
                SELECT b.*, a.street, a.city, a.state, a.zip_code 
                FROM leads_dashboard.branch b 
                LEFT JOIN leads_dashboard.address a ON b.address_id = a.id 
                ORDER BY b.name
            `);
            
            // Formatear para tener la dirección completa
            const branches = result.rows.map(branch => {
                let address = '';
                if (branch.street) {
                    address = [branch.street, branch.city, branch.state, branch.zip_code]
                        .filter(Boolean)
                        .join(', ');
                }
                
                return {
                    ...branch,
                    address
                };
            });
            
            res.json(branches);
        } catch (error) {
            console.error('Error getting branches:', error);
            res.status(500).json({ error: error.message });
        }
    },

    // Get leads for a campaign
    getCampaignLeads: async (req, res) => {
        try {
            const campaignId = parseInt(req.params.id);
            const result = await db.query(`
                SELECT
                  l.id,
                  l.name,
                  l.created_date,
                  l.last_contacted,
                  l.recovered,
                  l.final_proposal_amount,
                  l.campaign_id,
                  l.branch_id,
                  l.note,
                  l.fued,
                  l.lead_status_id,
                  l.sales_person_id,
                  l.source_id,
                  l.proposal_status_id,
                  ps.name AS proposal_status,
                  c.first_name,
                  c.last_name,
                  c.email_address AS email_address,
                  CONCAT(a.street, ', ', a.city, ', ', a.state, ', ', a.zip_code) AS address,
                  sp.name AS sales_person,
                  s.name AS source,
                  array_remove(array_agg(t.name), NULL) AS tags
                FROM leads_dashboard.lead l
                LEFT JOIN leads_dashboard.customer c ON l.customer_id = c.id
                LEFT JOIN leads_dashboard.address a ON c.address_id = a.id
                LEFT JOIN leads_dashboard.sales_person sp ON l.sales_person_id = sp.id
                LEFT JOIN leads_dashboard.source s ON l.source_id = s.id
                LEFT JOIN leads_dashboard.proposal_status ps ON l.proposal_status_id = ps.id
                LEFT JOIN leads_dashboard.lead_tag lt ON l.id = lt.lead_id
                LEFT JOIN leads_dashboard.tag t ON lt.tag_id = t.id
                WHERE l.campaign_id = $1
                GROUP BY l.id, c.first_name, c.last_name, c.email_address, a.street, a.city, a.state, a.zip_code, sp.name, s.name, ps.name
                ORDER BY l.created_at DESC
            `, [campaignId]);
            res.json(result.rows);
        } catch (error) {
            console.error('Error getting campaign leads:', error);
            res.status(500).json({ error: error.message });
        }
    },

    // Get lead by ID
    getLeadById: async (req, res) => {
        try {
            const leadId = parseInt(req.params.id);
            const result = await db.query('SELECT * FROM leads_dashboard.lead WHERE id = $1', [leadId]);
            if (result.rows.length === 0) {
                return res.status(404).json({ error: 'Lead not found' });
            }
            res.json(result.rows[0]);
        } catch (error) {
            console.error('Error getting lead by ID:', error);
            res.status(500).json({ error: error.message });
        }
    },

    // Create new campaign
    createCampaign: async (req, res) => {
        console.log('[CREATE CAMPAIGN] Entrando a createCampaign');
        try {
            const { name, description, type, branch_ids } = req.body;
            console.log('[CREATE CAMPAIGN] Datos recibidos:', req.body);
            // Validación
            if (!name || name.trim() === '') {
                console.log('[CREATE CAMPAIGN] Validación fallida: name requerido');
                return res.status(400).json({ error: 'Campaign name is required' });
            }
            if (!type) {
                console.log('[CREATE CAMPAIGN] Validación fallida: type requerido');
                return res.status(400).json({ error: 'Campaign type is required' });
            }
            if (!Array.isArray(branch_ids) || branch_ids.length === 0) {
                console.log('[CREATE CAMPAIGN] Validación fallida: branch_ids requerido');
                return res.status(400).json({ error: 'At least one branch must be selected' });
            }
            // Insert campaign
            const result = await db.query(
                'INSERT INTO leads_dashboard.campaign (name, campaign_type_id, description) VALUES ($1, $2, $3) RETURNING *',
                [name, type, description || '']
            );
            const campaign = result.rows[0];
            console.log('[CREATE CAMPAIGN] Campaña insertada:', campaign);
            // Insert campaign-branch associations
            for (const branchId of branch_ids) {
                await db.query(
                    'INSERT INTO leads_dashboard.campaign_branch (campaign_id, branch_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                    [campaign.id, branchId]
                );
                console.log(`[CREATE CAMPAIGN] Asociación campaña-branch insertada: campaign_id=${campaign.id}, branch_id=${branchId}`);
            }
            // Obtener el tipo para devolver datos completos
            const typeResult = await db.query('SELECT name FROM leads_dashboard.campaign_type WHERE id = $1', [type]);
            const typeName = typeResult.rows.length > 0 ? typeResult.rows[0].name : '';
            // Formatear respuesta para el frontend
            const formattedCampaign = {
                id: campaign.id,
                name: campaign.name,
                description: campaign.description || '',
                type: typeName || 'no_opportunity',
                campaign_type_id: campaign.campaign_type_id,
                branch_ids: branch_ids,
                created_at: campaign.created_at,
                updated_at: campaign.updated_at
            };
            console.log('[CREATE CAMPAIGN] Respuesta enviada:', formattedCampaign);
            res.status(201).json(formattedCampaign);
        } catch (error) {
            console.error('[CREATE CAMPAIGN] Error:', error);
            res.status(500).json({ error: error.message });
        }
    },

    // Update lead
    updateLead: async (req, res) => {
        try {
            const leadId = parseInt(req.params.id);
            const fields = [
                'name', 'created_date', 'lead_status_id', 'last_contacted', 'sales_person_id', 'source_id',
                'proposal_status_id', 'customer_id', 'note', 'condition_id', 'final_proposal_amount', 'recovered',
                'branch_id', 'campaign_id'
            ];
            const updates = [];
            const values = [];
            let idx = 1;
            for (const field of fields) {
                if (req.body[field] !== undefined) {
                    updates.push(`${field} = $${idx}`);
                    values.push(req.body[field]);
                    idx++;
                }
            }
            if (updates.length === 0) {
                return res.status(400).json({ error: 'No fields to update' });
            }
            values.push(leadId);
            const query = `UPDATE leads_dashboard.lead SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${values.length} RETURNING *`;
            const result = await db.query(query, values);
            if (result.rows.length === 0) {
                return res.status(404).json({ error: 'Lead not found' });
            }
            res.json(result.rows[0]);
        } catch (error) {
            console.error('Error updating lead:', error);
            res.status(500).json({ error: error.message });
        }
    },

    // Delete lead
    deleteLead: async (req, res) => {
        try {
            const leadId = parseInt(req.params.id);
            const result = await db.query('DELETE FROM leads_dashboard.lead WHERE id = $1 RETURNING *', [leadId]);
            if (result.rows.length === 0) {
                return res.status(404).json({ error: 'Lead not found' });
            }
            res.status(204).send();
        } catch (error) {
            console.error('Error deleting lead:', error);
            res.status(500).json({ error: error.message });
        }
    },

    // Export campaign data
    exportCampaign: async (req, res) => {
        try {
            const campaignId = parseInt(req.params.id);
            const type = req.query.type || 'not_recovered';
            
            // Aquí iría la lógica para generar un archivo Excel/CSV
            // Por ahora solo enviaremos un mensaje simple
            res.send(`Export for campaign ${campaignId} (${type}) would be generated here`);
        } catch (error) {
            console.error('Error exporting campaign:', error);
            res.status(500).json({ error: error.message });
        }
    },

    // Upload leads for a campaign
    uploadLeads: async (req, res) => {
        const xlsx = require('xlsx');
        try {
            const campaignId = parseInt(req.params.id);
            if (!req.file) {
                return res.status(400).json({ error: 'No file uploaded' });
            }
            // Leer el archivo Excel (encabezados en la segunda fila, datos desde la tercera)
            const workbook = xlsx.readFile(req.file.path);
            const sheetName = workbook.SheetNames[0];
            const sheet = workbook.Sheets[sheetName];
            const rawRows = xlsx.utils.sheet_to_json(sheet, { defval: '', header: 1 });
            if (rawRows.length < 3) {
                return res.status(400).json({ error: 'El archivo no tiene suficientes filas de datos.' });
            }
            const headers = rawRows[1];
            const dataRows = rawRows.slice(2);
            const rows = dataRows.map(row => {
                const obj = {};
                headers.forEach((header, idx) => {
                    obj[header] = row[idx];
                });
                return obj;
            });
            // Función auxiliar para parsear fechas a YYYY-MM-DD
            function parseToISODate(val) {
                if (!val) return '';
                if (typeof val === 'number') {
                    const dateObj = xlsx.SSF.parse_date_code(val);
                    if (dateObj) {
                        const mm = String(dateObj.m).padStart(2, '0');
                        const dd = String(dateObj.d).padStart(2, '0');
                        return `${dateObj.y}-${mm}-${dd}`;
                    }
                }
                if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return val;
                const match = val.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
                if (match) {
                    const y = match[3];
                    const m = match[1].padStart(2, '0');
                    const d = match[2].padStart(2, '0');
                    return `${y}-${m}-${d}`;
                }
                return val;
            }
            // Obtener la primera branch de la campaña
            let branchIdForLeads = null;
            const branchRes = await db.query(
                `SELECT cb.branch_id FROM leads_dashboard.campaign_branch cb WHERE cb.campaign_id = $1 ORDER BY cb.branch_id LIMIT 1`,
                [campaignId]
            );
            if (branchRes.rows.length > 0) {
                branchIdForLeads = branchRes.rows[0].branch_id;
            }
            // Iniciar transacción
            await db.query('BEGIN');
            let created = 0, duplicated = 0, errors = 0;
            const duplicateEmails = [];
            for (const row of rows) {
                try {
                    // 1. Procesar fechas
                    let createdDate = parseToISODate(row['Created Date']);
                    let lastContacted = row['Last Contacted'] || '';
                    if (lastContacted) {
                        const match = lastContacted.match(/^(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/);
                        if (match) {
                            lastContacted = match[1];
                        } else {
                            lastContacted = lastContacted.split(' ')[0];
                        }
                        lastContacted = parseToISODate(lastContacted);
                    }
                    // 2. Buscar/crear catálogos
                    async function getOrCreate(table, name, extraFields = {}) {
                        if (!name || name.trim() === '') {
                            // Si es condition, devolver null
                            if (table === 'condition') return null;
                            // Para otros catálogos, usar un valor por defecto
                            name = table === 'lead_status' ? 'New' :
                                  table === 'proposal_status' ? 'Pending' :
                                  table === 'source' ? 'Unknown' : 'Default';
                        }
                        let result = await db.query(`SELECT id FROM leads_dashboard.${table} WHERE LOWER(name) = LOWER($1)`, [name]);
                        if (result.rows.length > 0) return result.rows[0].id;
                        result = await db.query(
                            `INSERT INTO leads_dashboard.${table} (name${Object.keys(extraFields).length ? ', ' + Object.keys(extraFields).join(', ') : ''}) VALUES ($1${Object.values(extraFields).length ? ', ' + Object.values(extraFields).map((_,i)=>`$${i+2}`).join(', ') : ''}) RETURNING id`,
                            [name, ...Object.values(extraFields)]
                        );
                        return result.rows[0].id;
                    }
                    // Limpiar el valor de Condition
                    const conditionValue = (row['Condition*'] || '').trim();
                    const leadStatusId = await getOrCreate('lead_status', row['Lead Status']);
                    const salesPersonId = await getOrCreate('sales_person', row['Salesperson']);
                    const sourceId = await getOrCreate('source', row['Source']);
                    const proposalStatusId = await getOrCreate('proposal_status', row['Proposal Status...']);
                    const conditionId = await getOrCreate('condition', conditionValue);

                    // Procesar final_proposal_amount con soporte para formato latino e inglés
                    let finalProposalAmount = null;
                    if (row['Final Proposal Amount*']) {
                        let raw = row['Final Proposal Amount*'].toString().replace(/[^0-9.,-]/g, '').trim();
                        let cleanAmount = raw;
                        if (raw.includes(',') && !raw.includes('.')) {
                            // Formato latino: 14.830,57
                            cleanAmount = raw.replace(/\./g, '').replace(',', '.');
                        } else if (raw.includes('.') && !raw.includes(',')) {
                            // Formato inglés: 2002701.00
                            cleanAmount = raw.replace(/,/g, '');
                        } else if (raw.includes('.') && raw.includes(',')) {
                            // Formato mixto: 1,234.56
                            cleanAmount = raw.replace(/,/g, '');
                        }
                        const amount = parseFloat(cleanAmount);
                        if (!isNaN(amount)) {
                            finalProposalAmount = amount;
                        }
                    }
                    // 3. Address
                    let addressId = null;
                    if (row['Street Address (Contact)'] || row['City (Contact)'] || row['State (Contact)'] || row['Zip (Contact)']) {
                        const addressRes = await db.query(
                            'INSERT INTO leads_dashboard.address (street, city, state, zip_code) VALUES ($1, $2, $3, $4) RETURNING id',
                            [row['Street Address (Contact)'] || '', row['City (Contact)'] || '', row['State (Contact)'] || '', row['Zip (Contact)'] || '']
                        );
                        addressId = addressRes.rows[0].id;
                    }
                    // 4. Customer (buscar por nombre y apellido)
                    let customerId = null;
                    if (row['First Name'] && row['Last Name']) {
                        let customerRes = await db.query(
                            'SELECT id FROM leads_dashboard.customer WHERE LOWER(first_name) = LOWER($1) AND LOWER(last_name) = LOWER($2)',
                            [row['First Name'], row['Last Name']]
                        );
                        if (customerRes.rows.length > 0) {
                            customerId = customerRes.rows[0].id;
                        } else {
                            customerRes = await db.query(
                                'INSERT INTO leads_dashboard.customer (first_name, last_name, email_address, cell_phone, phone, address_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
                                [row['First Name'], row['Last Name'], row['Email Address'] || '', row['Cell Phone'] || '', row['Phone'] || '', addressId]
                            );
                            customerId = customerRes.rows[0].id;
                        }
                    }
                    // 5. Duplicado: mismo email de cliente
                    if (row['Email Address']) {
                        const dupRes = await db.query('SELECT l.id FROM leads_dashboard.lead l JOIN leads_dashboard.customer c ON l.customer_id = c.id WHERE LOWER(c.email_address) = LOWER($1)', [row['Email Address']]);
                        if (dupRes.rows.length > 0) {
                            duplicated++;
                            duplicateEmails.push(row['Email Address']);
                            continue;
                        }
                    }
                    // 6. Crear lead
                    const leadRes = await db.query(
                        `INSERT INTO leads_dashboard.lead (
                            name, created_date, lead_status_id, last_contacted, sales_person_id, source_id, proposal_status_id, customer_id, note, condition_id, final_proposal_amount, campaign_id, fued, branch_id
                        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
                        [
                            row['Opportunity Title'] || '',
                            createdDate,
                            leadStatusId,
                            lastContacted,
                            salesPersonId,
                            sourceId,
                            proposalStatusId,
                            customerId,
                            row['Notes'] || '',
                            conditionId,
                            finalProposalAmount,
                            campaignId,
                            false,
                            branchIdForLeads
                        ]
                    );
                    const leadId = leadRes.rows[0].id;
                    // 7. Tags (crear si no existen y asociar)
                    if (row['Tags']) {
                        const tags = row['Tags'].split(',').map(t => t.trim()).filter(Boolean);
                        for (const tagName of tags) {
                            const tagId = await getOrCreate('tag', tagName);
                            await db.query('INSERT INTO leads_dashboard.lead_tag (lead_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [leadId, tagId]);
                        }
                    }
                    created++;
                } catch (err) {
                    errors++;
                    console.error('[UPLOAD LEADS] Error en fila:', err);
                }
            }
            await db.query('COMMIT');
            res.json({ message: `Importación finalizada. Leads creados: ${created}, duplicados: ${duplicated}, errores: ${errors}`, duplicateEmails });
        } catch (error) {
            await db.query('ROLLBACK');
            console.error('[UPLOAD LEADS] Error general:', error);
            res.status(500).json({ error: error.message });
        }
    },

    // Delete campaign
    deleteCampaign: async (req, res) => {
        try {
            const campaignId = parseInt(req.params.id);
            
            // First check if the campaign exists
            const campaignResult = await db.query('SELECT id FROM leads_dashboard.campaign WHERE id = $1', [campaignId]);
            if (campaignResult.rows.length === 0) {
                return res.status(404).json({ error: 'Campaign not found' });
            }
            
            // Delete campaign-branch associations first
            await db.query('DELETE FROM leads_dashboard.campaign_branch WHERE campaign_id = $1', [campaignId]);
            
            // Delete the campaign
            await db.query('DELETE FROM leads_dashboard.campaign WHERE id = $1', [campaignId]);
            
            res.status(204).send();
        } catch (error) {
            console.error('Error deleting campaign:', error);
            res.status(500).json({ error: error.message });
        }
    }
};

module.exports = campaignController; 