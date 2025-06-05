const db = require('../config/database');

// Helper function to calculate price after discount (matches frontend logic)
const calculatePriceAfterDiscount = (finalAmount, tmAmount, subAmount = 0) => {
    if (!finalAmount || !tmAmount || finalAmount <= 0 || tmAmount <= 0) {
        return finalAmount || 0;
    }

    const final = parseFloat(finalAmount);
    const tm = parseFloat(tmAmount);
    const subCost = parseFloat(subAmount) || 0;
    const trueTotalCost = tm + subCost;

    // Calculate the "display/eligibility" multiplier
    let displayMultiplier;
    if (subCost > 0) {
        const adjustedFinalForDisplayMultiplier = final - (subCost * 1.5);
        displayMultiplier = tm > 0 ? adjustedFinalForDisplayMultiplier / tm : 0;
    } else {
        displayMultiplier = tm > 0 ? final / tm : 0;
    }

    const minPriceRule = 3200;
    const minMultiplierRule = 2.0;
    const maxDiscountPercentRule = 15;
    let maxAllowedDiscount = 0;

    if (displayMultiplier > minMultiplierRule) {
        const discountCapByMinPrice = Math.max(0, final - minPriceRule);
        let discountCapByMinMultiplier = Infinity;
        if (trueTotalCost > 0) {
            discountCapByMinMultiplier = Math.max(0, final - (minMultiplierRule * trueTotalCost));
        } else {
            discountCapByMinMultiplier = Math.max(0, final);
        }
        const discountCapByMaxPercent = final * (maxDiscountPercentRule / 100);
        maxAllowedDiscount = Math.min(discountCapByMinPrice, discountCapByMinMultiplier, discountCapByMaxPercent);
    }

    let calculatedDiscountPercent = 0;
    if (final > 0 && maxAllowedDiscount > 0) {
        calculatedDiscountPercent = (maxAllowedDiscount / final) * 100;
    }
    
    const roundedAppliedDiscountPercent = Math.round(calculatedDiscountPercent * 100) / 100;
    const finalDiscountAmount = final * (roundedAppliedDiscountPercent / 100);
    const finalDiscountedPrice = final - finalDiscountAmount;

    return parseFloat(finalDiscountedPrice.toFixed(2));
};

const campaignController = {
    // Get branches (still needed for lead filtering)
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

    // Get lead by ID (still needed)
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

    // Update lead (still needed)
    updateLead: async (req, res) => {
        try {
            const leadId = parseInt(req.params.id);
            const fields = [
                'name', 'created_date', 'lead_status_id', 'last_contacted', 'sales_person_id', 'source_id',
                'proposal_status_id', 'customer_id', 'note', 'condition_id', 'final_proposal_amount', 'recovered',
                'branch_id'
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

    // Delete lead (still needed)
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

    // Get available leads for campaign creation (matched leads only with filters)
    getAvailableLeads: async (req, res) => {
        console.log('[GET AVAILABLE LEADS] Request received with filters:', req.query);
        try {
            const { 
                branch_ids = [], 
                salesperson_ids = [], 
                status_ids = [], 
                date_from, 
                date_to,
                matched_only = true 
            } = req.query;

            // Build WHERE conditions
            let whereConditions = [];
            let queryParams = [];
            let paramCount = 0;

            // Always require matched leads (synced with API) and proposal amount > 10
            whereConditions.push(`COALESCE(l.matched, false) = true`);
            whereConditions.push(`COALESCE(l.final_proposal_amount, 0) > 10`);
            
            // Add business rule filters for follow-up viability:
            // 1. Must have valid T&M and Final Proposal values for calculation
            whereConditions.push(`COALESCE(l.proposal_tm, 0) > 0`);
            whereConditions.push(`COALESCE(l.final_proposal_amount, 0) > 0`);

            // Branch filter
            if (branch_ids && branch_ids.length > 0) {
                const branchArray = Array.isArray(branch_ids) ? branch_ids : [branch_ids];
                paramCount++;
                whereConditions.push(`l.branch_id = ANY($${paramCount})`);
                queryParams.push(branchArray.map(id => parseInt(id)));
            }

            // Salesperson filter
            if (salesperson_ids && salesperson_ids.length > 0) {
                const salespersonArray = Array.isArray(salesperson_ids) ? salesperson_ids : [salesperson_ids];
                paramCount++;
                whereConditions.push(`l.sales_person_id = ANY($${paramCount})`);
                queryParams.push(salespersonArray.map(id => parseInt(id)));
            }

            // Status filter
            if (status_ids && status_ids.length > 0) {
                const statusArray = Array.isArray(status_ids) ? status_ids : [status_ids];
                paramCount++;
                whereConditions.push(`l.lead_status_id = ANY($${paramCount})`);
                queryParams.push(statusArray.map(id => parseInt(id)));
            }

            // Date range filter
            if (date_from) {
                paramCount++;
                whereConditions.push(`l.created_date >= $${paramCount}`);
                queryParams.push(date_from);
            }

            if (date_to) {
                paramCount++;
                whereConditions.push(`l.created_date <= $${paramCount}`);
                queryParams.push(date_to);
            }

            const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

            // Main query - using WITH clause to calculate multiplier and discount, then filter
            const query = `
                WITH lead_calculations AS (
                    SELECT 
                        l.id,
                        l.name,
                        l.created_date,
                        COALESCE(l.final_proposal_amount, 0) as final_proposal_amount,
                        COALESCE(l.proposal_tm, 0) as proposal_tm,
                        COALESCE(l.sub_contractor_price, 0) as sub_contractor_price,
                        COALESCE(l.matched, false) as matched,
                        COALESCE(ls.name, 'No Status') as status,
                        COALESCE(sp.name, 'Unassigned') as salesperson,
                        COALESCE(b.name, 'No Branch') as branch,
                        CONCAT(COALESCE(c.first_name, ''), ' ', COALESCE(c.last_name, '')) as customer_name,
                        CONCAT(COALESCE(a.street, ''), ', ', COALESCE(a.city, ''), ', ', COALESCE(a.state, '')) as address,
                        COALESCE(s.name, 'Unknown Source') as source,
                        COALESCE(
                            (SELECT STRING_AGG(t.name, ', ') 
                             FROM leads_dashboard.lead_tag lt 
                             JOIN leads_dashboard.tag t ON lt.tag_id = t.id 
                             WHERE lt.lead_id = l.id), 
                            ''
                        ) as tags,
                        -- Calculate multiplier with new subcontractor logic
                        CASE 
                            WHEN COALESCE(l.sub_contractor_price, 0) > 0 THEN
                                CASE 
                                    WHEN COALESCE(l.proposal_tm, 0) > 0 THEN
                                        (COALESCE(l.final_proposal_amount, 0) - (COALESCE(l.sub_contractor_price, 0) * 1.5)) / COALESCE(l.proposal_tm, 0)
                                    ELSE 0
                                END
                            ELSE
                                CASE 
                                    WHEN COALESCE(l.proposal_tm, 0) > 0 THEN
                                        COALESCE(l.final_proposal_amount, 0) / COALESCE(l.proposal_tm, 0)
                                    ELSE 0
                                END
                        END as multiplier,
                        -- Calculate discount percentage
                        CASE 
                            WHEN COALESCE(l.sub_contractor_price, 0) > 0 THEN
                                CASE 
                                    WHEN COALESCE(l.proposal_tm, 0) > 0 THEN
                                        GREATEST(0, ROUND((1 - ((COALESCE(l.final_proposal_amount, 0) - (COALESCE(l.sub_contractor_price, 0) * 1.5)) / COALESCE(l.proposal_tm, 0)) / 3.0) * 100, 1))
                                    ELSE 0
                                END
                            ELSE
                                CASE 
                                    WHEN COALESCE(l.proposal_tm, 0) > 0 THEN
                                        GREATEST(0, ROUND((1 - (COALESCE(l.final_proposal_amount, 0) / COALESCE(l.proposal_tm, 0)) / 3.0) * 100, 1))
                                    ELSE 0
                                END
                        END as discount_percentage
                    FROM leads_dashboard.lead l
                    LEFT JOIN leads_dashboard.lead_status ls ON l.lead_status_id = ls.id
                    LEFT JOIN leads_dashboard.sales_person sp ON l.sales_person_id = sp.id
                    LEFT JOIN leads_dashboard.customer c ON l.customer_id = c.id
                    LEFT JOIN leads_dashboard.address a ON c.address_id = a.id
                    LEFT JOIN leads_dashboard.source s ON l.source_id = s.id
                    LEFT JOIN leads_dashboard.branch b ON l.branch_id = b.id
                    ${whereClause}
                )
                SELECT *
                FROM lead_calculations
                WHERE multiplier >= 2.0 
                AND discount_percentage > 0
                ORDER BY created_date DESC
            `;

            console.log('[GET AVAILABLE LEADS] Query:', query);
            console.log('[GET AVAILABLE LEADS] Params:', queryParams);

            const result = await db.query(query, queryParams);
            
            console.log(`[GET AVAILABLE LEADS] Found ${result.rows.length} leads with multiplier >= 2 and discount > 0%`);
            console.log(`[GET AVAILABLE LEADS] Filtered leads for follow-up viability`);
            
            res.json(result.rows);
            
        } catch (error) {
            console.error('Error getting available leads:', error);
            res.status(500).json({ error: error.message });
        }
    },

    // Create enhanced campaign with groups and lead assignments (REAL DATABASE IMPLEMENTATION)
    createEnhancedCampaign: async (req, res) => {
        console.log('[CREATE ENHANCED CAMPAIGN] Starting real implementation...');
        try {
            const { 
                group_name,
                description,
                selected_lead_ids = []
            } = req.body;

            console.log('[CREATE ENHANCED CAMPAIGN] Data received:', req.body);

            // Validation
            if (!group_name || group_name.trim() === '') {
                return res.status(400).json({ error: 'Group name is required' });
            }
            if (!Array.isArray(selected_lead_ids) || selected_lead_ids.length === 0) {
                return res.status(400).json({ error: 'At least one lead must be selected' });
            }

            // Validate that all lead IDs exist and meet our criteria
            const leadIds = selected_lead_ids.map(id => parseInt(id)).filter(id => !isNaN(id));
            if (leadIds.length === 0) {
                return res.status(400).json({ error: 'Invalid lead IDs provided' });
            }

            // Check if leads exist and meet criteria (matched=true, final_proposal_amount > 10)
            const leadValidationResult = await db.query(`
                WITH lead_calculations AS (
                    SELECT 
                        l.id, 
                        l.name, 
                        l.final_proposal_amount, 
                        l.matched,
                        COALESCE(l.proposal_tm, 0) as proposal_tm,
                        COALESCE(l.sub_contractor_price, 0) as sub_contractor_price,
                        -- Calculate multiplier with new subcontractor logic
                        CASE 
                            WHEN COALESCE(l.sub_contractor_price, 0) > 0 THEN
                                CASE 
                                    WHEN COALESCE(l.proposal_tm, 0) > 0 THEN
                                        (COALESCE(l.final_proposal_amount, 0) - (COALESCE(l.sub_contractor_price, 0) * 1.5)) / COALESCE(l.proposal_tm, 0)
                                    ELSE 0
                                END
                            ELSE
                                CASE 
                                    WHEN COALESCE(l.proposal_tm, 0) > 0 THEN
                                        COALESCE(l.final_proposal_amount, 0) / COALESCE(l.proposal_tm, 0)
                                    ELSE 0
                                END
                        END as multiplier,
                        -- Calculate discount percentage
                        CASE 
                            WHEN COALESCE(l.sub_contractor_price, 0) > 0 THEN
                                CASE 
                                    WHEN COALESCE(l.proposal_tm, 0) > 0 THEN
                                        GREATEST(0, ROUND((1 - ((COALESCE(l.final_proposal_amount, 0) - (COALESCE(l.sub_contractor_price, 0) * 1.5)) / COALESCE(l.proposal_tm, 0)) / 3.0) * 100, 1))
                                    ELSE 0
                                END
                            ELSE
                                CASE 
                                    WHEN COALESCE(l.proposal_tm, 0) > 0 THEN
                                        GREATEST(0, ROUND((1 - (COALESCE(l.final_proposal_amount, 0) / COALESCE(l.proposal_tm, 0)) / 3.0) * 100, 1))
                                    ELSE 0
                                END
                        END as discount_percentage
                    FROM leads_dashboard.lead l
                    WHERE l.id = ANY($1) 
                    AND COALESCE(l.matched, false) = true 
                    AND COALESCE(l.final_proposal_amount, 0) > 10
                    AND COALESCE(l.proposal_tm, 0) > 0
                )
                SELECT id, name, final_proposal_amount, matched, multiplier, discount_percentage
                FROM lead_calculations
                WHERE multiplier >= 2.0 
                AND discount_percentage > 0
            `, [leadIds]);

            if (leadValidationResult.rows.length !== leadIds.length) {
                const validIds = leadValidationResult.rows.map(row => row.id);
                const invalidIds = leadIds.filter(id => !validIds.includes(id));
                return res.status(400).json({ 
                    error: `Some leads don't meet follow-up criteria (must have multiplier >= 2.0 and discount > 0%) or don't exist: ${invalidIds.join(', ')}` 
                });
            }

            // Start database transaction
            await db.query('BEGIN');

            try {
                // 1. Create the group
                const groupResult = await db.query(`
                    INSERT INTO leads_dashboard.lead_group (name, description)
                    VALUES ($1, $2)
                    RETURNING id, name, description, created_at
                `, [group_name.trim(), description || '']);

                const group = groupResult.rows[0];
                console.log('[CREATE ENHANCED CAMPAIGN] Group created:', group);

                // 2. Assign leads to the group
                for (const leadId of leadIds) {
                    await db.query(`
                        INSERT INTO leads_dashboard.lead_group_assignment (lead_id, group_id)
                        VALUES ($1, $2)
                        ON CONFLICT (lead_id, group_id) DO NOTHING
                    `, [leadId, group.id]);
                    }

                console.log(`[CREATE ENHANCED CAMPAIGN] Assigned ${leadIds.length} leads to group ${group.id}`);

                // 3. Get the assigned leads data for response
                const assignedLeadsResult = await db.query(`
                    SELECT 
                        l.id,
                        l.name,
                        l.final_proposal_amount,
                        CONCAT(COALESCE(c.first_name, ''), ' ', COALESCE(c.last_name, '')) as customer_name,
                        COALESCE(sp.name, 'Unassigned') as salesperson,
                        COALESCE(b.name, 'No Branch') as branch
                    FROM leads_dashboard.lead_group_assignment lga
                    JOIN leads_dashboard.lead l ON lga.lead_id = l.id
                    LEFT JOIN leads_dashboard.customer c ON l.customer_id = c.id
                    LEFT JOIN leads_dashboard.sales_person sp ON l.sales_person_id = sp.id
                    LEFT JOIN leads_dashboard.branch b ON l.branch_id = b.id
                    WHERE lga.group_id = $1
                    ORDER BY l.name
                `, [group.id]);

                // Commit transaction
                await db.query('COMMIT');

                // Response with real group data
                const response = {
                    id: group.id,
                    name: group.name,
                    description: group.description,
                    type: 'lead_group',
                    assigned_leads_count: assignedLeadsResult.rows.length,
                    assigned_leads: assignedLeadsResult.rows,
                    created_at: group.created_at,
                    status: 'active'
                };

                console.log('[CREATE ENHANCED CAMPAIGN] Group created successfully:', response);
                res.status(201).json(response);

            } catch (error) {
                // Rollback transaction on error
                await db.query('ROLLBACK');
                throw error;
            }

        } catch (error) {
            console.error('Error in createEnhancedCampaign:', error);
            res.status(500).json({ error: error.message });
        }
    },

    // Get all lead groups with their assigned leads
    getAllGroups: async (req, res) => {
        console.log('📊 [getAllGroups] Request received');
        
        try {
            // Verify authentication
            if (!req.user) {
                console.log('❌ [getAllGroups] No user found in request');
                return res.status(401).json({ error: 'Authentication required' });
            }
            
            console.log('🔍 [getAllGroups] Querying database for groups...');
            
            // Get all groups with lead counts and calculated after-discount amounts
            const groupsResult = await db.query(`
                SELECT 
                    lg.id,
                    lg.name,
                    lg.description,
                    lg.created_at,
                    lg.updated_at,
                    COUNT(lga.lead_id) as assigned_leads_count,
                    COALESCE(SUM(
                        CASE 
                            WHEN l.final_proposal_amount IS NULL OR l.proposal_tm IS NULL 
                                OR l.final_proposal_amount <= 0 OR l.proposal_tm <= 0 
                            THEN 0
                            ELSE l.final_proposal_amount
                        END
                    ), 0) as total_proposal_amount,
                    COUNT(CASE WHEN l.recovered = true THEN 1 END) as recovered_leads_count,
                    -- Get raw data for recovered leads to calculate discount in JavaScript
                    JSON_AGG(
                        CASE 
                            WHEN l.recovered = true 
                            THEN JSON_BUILD_OBJECT(
                                'final_proposal_amount', l.final_proposal_amount,
                                'proposal_tm', l.proposal_tm,
                                'sub_contractor_price', l.sub_contractor_price
                            )
                            ELSE NULL
                        END
                    ) FILTER (WHERE l.recovered = true) as recovered_leads_data
                FROM leads_dashboard.lead_group lg
                LEFT JOIN leads_dashboard.lead_group_assignment lga ON lg.id = lga.group_id
                LEFT JOIN leads_dashboard.lead l ON lga.lead_id = l.id
                GROUP BY lg.id, lg.name, lg.description, lg.created_at, lg.updated_at
                ORDER BY lg.created_at DESC
            `);

            console.log('✅ [getAllGroups] Query successful');
            console.log('📊 Groups found:', groupsResult.rows.length);
            
            // Calculate recovered amounts using discount logic
            const groupsWithRecoveredAmounts = groupsResult.rows.map(group => {
                let recoveredAmount = 0;
                
                if (group.recovered_leads_data && Array.isArray(group.recovered_leads_data)) {
                    recoveredAmount = group.recovered_leads_data.reduce((sum, leadData) => {
                        if (leadData && leadData.final_proposal_amount && leadData.proposal_tm) {
                            const priceAfterDiscount = calculatePriceAfterDiscount(
                                leadData.final_proposal_amount,
                                leadData.proposal_tm,
                                leadData.sub_contractor_price
                            );
                            return sum + priceAfterDiscount;
                        }
                        return sum;
                    }, 0);
                }
                
                return {
                    ...group,
                    recovered_amount: Math.round(recoveredAmount * 100) / 100, // Round to 2 decimals
                    recovered_leads_data: undefined // Remove raw data from response
                };
            });
            
            if (groupsWithRecoveredAmounts.length > 0) {
                console.log('📊 First group:', {
                    id: groupsWithRecoveredAmounts[0].id,
                    name: groupsWithRecoveredAmounts[0].name,
                    leads: groupsWithRecoveredAmounts[0].assigned_leads_count,
                    recovered_amount: groupsWithRecoveredAmounts[0].recovered_amount
                });
            }

            res.json(groupsWithRecoveredAmounts);
        } catch (error) {
            console.error('❌ [getAllGroups] Error:', error);
            res.status(500).json({ error: error.message });
        }
    },

    // Get group by ID with assigned leads
    getGroupById: async (req, res) => {
        try {
            const groupId = parseInt(req.params.id);
            
            // Get group info
            const groupResult = await db.query(`
                SELECT id, name, description, created_at, updated_at
                FROM leads_dashboard.lead_group 
                WHERE id = $1
            `, [groupId]);

            if (groupResult.rows.length === 0) {
                return res.status(404).json({ error: 'Group not found' });
            }
            
            // Get assigned leads
            const leadsResult = await db.query(`
                SELECT 
                    l.id,
                    l.name,
                    l.created_date,
                    l.inspection_date,
                    l.final_proposal_amount,
                    l.proposal_tm,
                    l.sub_contractor_price,
                    l.recovered,
                    COALESCE(ls.name, 'No Status') as status,
                    COALESCE(ls.name, 'No Status') as lead_status,
                    COALESCE(sp.name, 'Unassigned') as salesperson,
                    COALESCE(b.name, 'No Branch') as branch,
                    COALESCE(b.name, 'No Branch') as branch_name,
                    COALESCE(c.first_name, '') as first_name,
                    COALESCE(c.last_name, '') as last_name,
                    COALESCE(c.email_address, '') as email_address,
                    COALESCE(c.phone, '') as customer_phone,
                    COALESCE(c.cell_phone, '') as customer_cell_phone,
                    CONCAT(COALESCE(c.first_name, ''), ' ', COALESCE(c.last_name, '')) as customer_name,
                    COALESCE(a.street, '') as street,
                    COALESCE(a.city, '') as city,
                    COALESCE(a.state, '') as state,
                    COALESCE(a.zip_code, '') as zip_code,
                    CONCAT(COALESCE(a.street, ''), ', ', COALESCE(a.city, ''), ', ', COALESCE(a.state, '')) as address,
                    COALESCE(s.name, 'Unknown Source') as source,
                    COALESCE(
                        (SELECT STRING_AGG(t.name, ', ') 
                         FROM leads_dashboard.lead_tag lt 
                         JOIN leads_dashboard.tag t ON lt.tag_id = t.id 
                         WHERE lt.lead_id = l.id), 
                        ''
                    ) as tags,
                    lga.created_at as assigned_at
                FROM leads_dashboard.lead_group_assignment lga
                JOIN leads_dashboard.lead l ON lga.lead_id = l.id
                LEFT JOIN leads_dashboard.lead_status ls ON l.lead_status_id = ls.id
                LEFT JOIN leads_dashboard.sales_person sp ON l.sales_person_id = sp.id
                LEFT JOIN leads_dashboard.branch b ON l.branch_id = b.id
                LEFT JOIN leads_dashboard.customer c ON l.customer_id = c.id
                LEFT JOIN leads_dashboard.address a ON c.address_id = a.id
                LEFT JOIN leads_dashboard.source s ON l.source_id = s.id
                WHERE lga.group_id = $1
                ORDER BY l.created_date DESC
            `, [groupId]);

            // Combine group info with leads
            const group = {
                ...groupResult.rows[0],
                leads: leadsResult.rows
            };

            res.json(group);
        } catch (error) {
            console.error('Error getting group by ID:', error);
            res.status(500).json({ error: error.message });
        }
    },

    // Delete group (and remove lead assignments)
    deleteGroup: async (req, res) => {
        try {
            const groupId = parseInt(req.params.id);
            
            // Check if group exists
            const groupResult = await db.query('SELECT id FROM leads_dashboard.lead_group WHERE id = $1', [groupId]);
            if (groupResult.rows.length === 0) {
                return res.status(404).json({ error: 'Group not found' });
            }
            
            // Delete group (CASCADE will remove assignments automatically)
            await db.query('DELETE FROM leads_dashboard.lead_group WHERE id = $1', [groupId]);
            
            res.status(204).send();
        } catch (error) {
            console.error('Error deleting group:', error);
            res.status(500).json({ error: error.message });
        }
    },

    // Remove lead from group
    removeLeadFromGroup: async (req, res) => {
        try {
            const groupId = parseInt(req.params.groupId);
            const leadId = parseInt(req.params.leadId);
            
            console.log(`[REMOVE LEAD] Removing lead ${leadId} from group ${groupId}`);
            
            // Check if the assignment exists
            const assignmentResult = await db.query(
                'SELECT group_id, lead_id FROM leads_dashboard.lead_group_assignment WHERE group_id = $1 AND lead_id = $2',
                [groupId, leadId]
            );
            
            if (assignmentResult.rows.length === 0) {
                return res.status(404).json({ error: 'Lead not found in this group' });
            }
            
            // Remove the assignment
            await db.query(
                'DELETE FROM leads_dashboard.lead_group_assignment WHERE group_id = $1 AND lead_id = $2',
                [groupId, leadId]
            );
            
            console.log(`✅ Lead ${leadId} removed from group ${groupId} successfully`);
            
            res.json({
                success: true,
                message: 'Lead removed from group successfully'
            });
            
        } catch (error) {
            console.error('Error removing lead from group:', error);
            res.status(500).json({ error: error.message });
        }
    },

    // Export multiple groups to CSV for manual Mailchimp upload
    exportGroupsToCsv: async (req, res) => {
        try {
            const { groupIds } = req.body;
            
            if (!groupIds || !Array.isArray(groupIds) || groupIds.length === 0) {
                return res.status(400).json({ error: 'Group IDs array is required' });
            }

            console.log(`[CSV EXPORT] Exporting ${groupIds.length} groups to CSV`);

            // Get all leads from the selected groups - NO EMAIL FILTERING
            const leadsResult = await db.query(`
                SELECT 
                    l.id,
                    COALESCE(c.email_address, '') as email_address,
                    COALESCE(l.name, '') as lead_title,
                    COALESCE(c.cell_phone, c.phone, '') as phone_number,
                    COALESCE(a.zip_code, '') as zip_code,
                    lg.name as group_name
                FROM leads_dashboard.lead_group_assignment lga
                JOIN leads_dashboard.lead l ON lga.lead_id = l.id
                JOIN leads_dashboard.lead_group lg ON lga.group_id = lg.id
                LEFT JOIN leads_dashboard.customer c ON l.customer_id = c.id
                LEFT JOIN leads_dashboard.address a ON c.address_id = a.id
                WHERE lga.group_id = ANY($1)
                ORDER BY group_name, lead_title
            `, [groupIds]);

            console.log(`[CSV EXPORT] Found ${leadsResult.rows.length} total leads (including those without email)`);

            if (leadsResult.rows.length === 0) {
                return res.status(400).json({ 
                    error: 'No leads found in selected groups' 
                });
            }

            // Generate CSV content
            const csvHeaders = ['Email', 'Lead Title', 'Phone Number', 'ZIP Code', 'Group Name'];
            const csvRows = leadsResult.rows.map(lead => [
                lead.email_address || '',
                lead.lead_title || '',
                lead.phone_number || '',
                lead.zip_code || '',
                lead.group_name || ''
            ]);

            // Convert to CSV format
            const csvContent = [
                csvHeaders.join(','),
                ...csvRows.map(row => 
                    row.map(field => {
                        // Escape fields containing commas, quotes, or newlines
                        if (typeof field === 'string' && (field.includes(',') || field.includes('"') || field.includes('\n'))) {
                            return `"${field.replace(/"/g, '""')}"`;
                        }
                        return field;
                    }).join(',')
                )
            ].join('\n');

            // Set headers for file download
            const filename = `mailchimp_export_${new Date().toISOString().slice(0, 10)}.csv`;
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            res.setHeader('Content-Length', Buffer.byteLength(csvContent));

            console.log(`[CSV EXPORT] Sending CSV file with ${leadsResult.rows.length} leads`);
            res.send(csvContent);

        } catch (error) {
            console.error('Error exporting groups to CSV:', error);
            res.status(500).json({ error: error.message });
        }
    },

    // Toggle lead recovered status
    toggleLeadRecoveredStatus: async (req, res) => {
        try {
            const leadId = parseInt(req.params.leadId);
            const { recovered } = req.body;
            
            if (typeof recovered !== 'boolean') {
                return res.status(400).json({ error: 'recovered field must be a boolean value' });
            }
            
            // Update the lead's recovered status
            const result = await db.query(`
                UPDATE leads_dashboard.lead 
                SET recovered = $1, updated_at = NOW()
                WHERE id = $2
                RETURNING id, recovered, final_proposal_amount
            `, [recovered, leadId]);
            
            if (result.rows.length === 0) {
                return res.status(404).json({ error: 'Lead not found' });
            }
            
            const updatedLead = result.rows[0];
            console.log(`Lead ${leadId} recovered status updated to: ${recovered}`);
            
            res.json({
                success: true,
                leadId: updatedLead.id,
                recovered: updatedLead.recovered,
                final_proposal_amount: updatedLead.final_proposal_amount,
                message: `Lead marked as ${recovered ? 'recovered' : 'not recovered'}`
            });
            
        } catch (error) {
            console.error('Error toggling lead recovered status:', error);
            res.status(500).json({ error: error.message });
        }
    },

    // Toggle lead texted status
    toggleLeadTextedStatus: async (req, res) => {
        try {
            const leadId = parseInt(req.params.leadId);
            const { texted } = req.body;
            
            if (typeof texted !== 'boolean') {
                return res.status(400).json({ error: 'texted field must be a boolean value' });
            }
            
            // Update the lead's texted status
            const result = await db.query(`
                UPDATE leads_dashboard.lead 
                SET texted = $1, updated_at = NOW()
                WHERE id = $2
                RETURNING id, texted, name
            `, [texted, leadId]);
            
            if (result.rows.length === 0) {
                return res.status(404).json({ error: 'Lead not found' });
            }
            
            const updatedLead = result.rows[0];
            console.log(`Lead ${leadId} texted status updated to: ${texted}`);
            
            res.json({
                success: true,
                leadId: updatedLead.id,
                texted: updatedLead.texted,
                name: updatedLead.name,
                message: `Lead marked as ${texted ? 'texted' : 'not texted'}`
            });
            
        } catch (error) {
            console.error('Error toggling lead texted status:', error);
            res.status(500).json({ error: error.message });
        }
    },

    // Get group leads
    getGroupLeads: async (req, res) => {
        try {
            const groupId = parseInt(req.params.id);
            const query = `
                SELECT 
                    l.*,
                    COALESCE(ls.name, 'No Status') as status,
                    COALESCE(sp.name, 'Unassigned') as salesperson,
                    b.name as branch_name,
                    CONCAT(c.first_name, ' ', c.last_name) as customer_name,
                    c.email_address,
                    c.phone as customer_phone,
                    CONCAT(a.street, ', ', a.city, ', ', a.state, ' ', a.zip_code) as full_address,
                    COALESCE(l.texted, false) as texted,
                    COALESCE(
                        (SELECT STRING_AGG(t.name, ', ') 
                         FROM leads_dashboard.lead_tag lt 
                         JOIN leads_dashboard.tag t ON lt.tag_id = t.id 
                         WHERE lt.lead_id = l.id), 
                        'No tags'
                    ) as tags
                FROM leads_dashboard.lead l
                LEFT JOIN leads_dashboard.lead_status ls ON l.lead_status_id = ls.id
                LEFT JOIN leads_dashboard.sales_person sp ON l.sales_person_id = sp.id
                LEFT JOIN leads_dashboard.branch b ON l.branch_id = b.id
                LEFT JOIN leads_dashboard.customer c ON l.customer_id = c.id
                LEFT JOIN leads_dashboard.address a ON c.address_id = a.id
                WHERE l.id IN (
                    SELECT lead_id 
                    FROM leads_dashboard.lead_group_assignment 
                    WHERE group_id = $1
                )
                ORDER BY l.created_date DESC`;
            
            const result = await db.query(query, [groupId]);
            res.json(result.rows);
        } catch (error) {
            console.error('Error getting group leads:', error);
            res.status(500).json({ error: error.message });
        }
    },
};

module.exports = campaignController; 