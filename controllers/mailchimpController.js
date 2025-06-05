const mailchimp = require('@mailchimp/mailchimp_marketing');
const db = require('../config/database');
const crypto = require('crypto');

// Initialize Mailchimp client
if (process.env.MAILCHIMP_API_KEY) {
    const apiKey = process.env.MAILCHIMP_API_KEY;
    const server = apiKey.split('-')[1]; // Extract server from API key
    
    mailchimp.setConfig({
        apiKey: apiKey,
        server: server,
    });
} else {
    console.warn('MAILCHIMP_API_KEY not found in environment variables');
}

const mailchimpController = {
    // Test Mailchimp connection
    testConnection: async (req, res) => {
        try {
            if (!process.env.MAILCHIMP_API_KEY) {
                return res.status(400).json({ 
                    error: 'Mailchimp API key not configured. Please add MAILCHIMP_API_KEY to your .env file.' 
                });
            }

            const response = await mailchimp.ping.get();
            res.json({ 
                success: true, 
                message: 'Successfully connected to Mailchimp!',
                health_status: response.health_status 
            });
        } catch (error) {
            console.error('Mailchimp connection error:', error);
            res.status(500).json({ 
                error: 'Failed to connect to Mailchimp. Please check your API key.',
                details: error.message 
            });
        }
    },

    // Get all Mailchimp audiences
    getAudiences: async (req, res) => {
        try {
            if (!process.env.MAILCHIMP_API_KEY) {
                return res.status(400).json({ 
                    error: 'Mailchimp API key not configured' 
                });
            }

            const response = await mailchimp.lists.getAllLists();
            res.json(response.lists || []);
        } catch (error) {
            console.error('Error fetching Mailchimp audiences:', error);
            res.status(500).json({ 
                error: 'Failed to fetch Mailchimp audiences',
                details: error.message 
            });
        }
    },

    // Get tags for a specific audience
    getAudienceTags: async (req, res) => {
        try {
            const { audienceId } = req.params;
            
            if (!process.env.MAILCHIMP_API_KEY) {
                return res.status(500).json({ error: 'Mailchimp API key not configured' });
            }
            
            if (!audienceId) {
                return res.status(400).json({ error: 'Audience ID is required' });
            }
            
            try {
                // Use the correct tagSearch method instead of getListTags
                const response = await mailchimp.lists.tagSearch(audienceId, {
                    // No name parameter returns all tags on the list
                });
                
                const tags = response.tags || [];
                
                // Format response
                const formattedTags = tags.map(tag => ({
                    id: tag.id,
                    name: tag.name
                }));
                
                res.json(formattedTags);
                
            } catch (audienceError) {
                if (audienceError.status === 404) {
                    return res.status(404).json({ error: 'Audience not found' });
                }
                throw audienceError;
            }
            
        } catch (error) {
            console.error('Error fetching audience tags:', error);
            res.status(500).json({ 
                error: 'Failed to fetch audience tags',
                details: error.message 
            });
        }
    },

    // Debug audience info
    debugAudience: async (req, res) => {
        try {
            const { audienceId } = req.params;
            console.log(`[DEBUG] Testing audience: ${audienceId}`);
            
            // Get audience info
            const audienceInfo = await mailchimp.lists.getList(audienceId);
            console.log(`[DEBUG] Audience: ${audienceInfo.name}, Members: ${audienceInfo.stats.member_count}`);
            
            // Get first 100 members with their tags (increased from 10)
            const membersResponse = await mailchimp.lists.getListMembersInfo(audienceId, {
                count: 100,
                fields: 'members.email_address,members.tags'
            });
            
            console.log(`[DEBUG] Retrieved ${membersResponse.members.length} members`);
            
            const membersWithTags = membersResponse.members.map(member => ({
                email: member.email_address,
                tagCount: member.tags ? member.tags.length : 0,
                tags: member.tags ? member.tags.map(t => t.name) : []
            }));
            
            res.json({
                audience: {
                    id: audienceInfo.id,
                    name: audienceInfo.name,
                    memberCount: audienceInfo.stats.member_count
                },
                sampleMembers: membersWithTags,
                totalSampleSize: membersResponse.members.length
            });
            
        } catch (error) {
            console.error('[DEBUG] Error:', error);
            res.status(500).json({ 
                error: error.message,
                details: error.response?.body || 'No additional details'
            });
        }
    },

    // Export group to new Mailchimp audience
    exportGroupToMailchimp: async (req, res) => {
        console.log('[MAILCHIMP EXPORT] Starting export process...');
        try {
            if (!process.env.MAILCHIMP_API_KEY) {
                return res.status(400).json({ 
                    error: 'Mailchimp API key not configured. Please add MAILCHIMP_API_KEY to your .env file.' 
                });
            }

            const { groupId, audienceName, description, permissionReminder, contactInfo } = req.body;

            console.log('[MAILCHIMP EXPORT] Request data:', { 
                groupId, 
                audienceName, 
                description: description?.substring(0, 50) + '...',
                hasContactInfo: !!contactInfo 
            });

            // Validation
            if (!groupId || !audienceName || !permissionReminder || !contactInfo) {
                return res.status(400).json({ 
                    error: 'Missing required fields: groupId, audienceName, permissionReminder, and contactInfo are required' 
                });
            }

            // Get group leads with email addresses
            const leadsResult = await db.query(`
                SELECT 
                    l.id,
                    l.name as lead_name,
                    COALESCE(c.first_name, '') as first_name,
                    COALESCE(c.last_name, '') as last_name,
                    COALESCE(c.email_address, '') as email_address,
                    COALESCE(c.phone, '') as customer_phone,
                    COALESCE(c.cell_phone, '') as customer_cell_phone,
                    COALESCE(a.street, '') as street,
                    COALESCE(a.city, '') as city,
                    COALESCE(a.state, '') as state,
                    COALESCE(a.zip_code, '') as zip_code,
                    CONCAT(COALESCE(a.street, ''), ' ', COALESCE(a.city, ''), ', ', COALESCE(a.state, ''), ' ', COALESCE(a.zip_code, '')) as full_address,
                    COALESCE(b.name, '') as branch_name,
                    l.final_proposal_amount,
                    l.proposal_tm,
                    CAST(0 as DECIMAL(10,2)) as sub_contractor_price,
                    l.created_date,
                    l.inspection_date,
                    lga.created_at as assigned_at,
                    COALESCE(sp.name, '') as salesperson,
                    COALESCE(ls.name, '') as lead_status,
                    COALESCE(s.name, '') as lead_source,
                    '' as tags,
                    COALESCE(cond.name, '') as condition,
                    l.recovered
                FROM leads_dashboard.lead_group_assignment lga
                JOIN leads_dashboard.lead l ON lga.lead_id = l.id
                LEFT JOIN leads_dashboard.customer c ON l.customer_id = c.id
                LEFT JOIN leads_dashboard.address a ON c.address_id = a.id
                LEFT JOIN leads_dashboard.branch b ON l.branch_id = b.id
                LEFT JOIN leads_dashboard.sales_person sp ON l.sales_person_id = sp.id
                LEFT JOIN leads_dashboard.lead_status ls ON l.lead_status_id = ls.id
                LEFT JOIN leads_dashboard.source s ON l.source_id = s.id
                LEFT JOIN leads_dashboard.condition cond ON l.condition_id = cond.id
                WHERE lga.group_id = $1
                AND COALESCE(c.email_address, '') != ''
                AND COALESCE(c.email_address, '') LIKE '%@%'
                ORDER BY l.created_date DESC
            `, [groupId]);

            console.log(`[MAILCHIMP EXPORT] Found ${leadsResult.rows.length} leads with valid email addresses`);

            if (leadsResult.rows.length === 0) {
                return res.status(400).json({ 
                    error: 'No leads with valid email addresses found in this group' 
                });
            }

            // Log sample lead data for debugging
            if (leadsResult.rows.length > 0) {
                const sampleLead = leadsResult.rows[0];
                console.log(`[MAILCHIMP EXPORT] Sample lead data:`, {
                    id: sampleLead.id,
                    lead_name: sampleLead.lead_name,
                    email: sampleLead.email_address,
                    branch: sampleLead.branch_name,
                    first_name: sampleLead.first_name,
                    last_name: sampleLead.last_name
                });
            }

            // Create Mailchimp audience
            console.log('[MAILCHIMP EXPORT] Creating Mailchimp audience...');
            const audienceResponse = await mailchimp.lists.createList({
                name: audienceName,
                contact: {
                    company: contactInfo.company || 'Attic Tech',
                    address1: contactInfo.address1 || '',
                    city: contactInfo.city || '',
                    state: contactInfo.state || '',
                    zip: contactInfo.zip || '',
                    country: contactInfo.country || 'US',
                },
                permission_reminder: permissionReminder,
                campaign_defaults: {
                    from_name: contactInfo.from_name || 'Attic Tech',
                    from_email: contactInfo.from_email || 'noreply@attic-tech.com',
                    subject: `Follow-up from ${contactInfo.company || 'Attic Tech'}`,
                    language: 'en'
                },
                email_type_option: true
            });

            const audienceId = audienceResponse.id;
            console.log(`[MAILCHIMP EXPORT] Created audience with ID: ${audienceId}`);

            // Prepare batch members for bulk import
            const members = leadsResult.rows.map(lead => {
                const firstName = lead.first_name || lead.lead_name?.split(' ')[0] || '';
                const lastName = lead.last_name || lead.lead_name?.split(' ').slice(1).join(' ') || '';
                
                return {
                    email_address: lead.email_address,
                    status: 'subscribed',
                    merge_fields: {
                        FNAME: firstName,
                        LNAME: lastName,
                        PHONE: '', // We don't have phone numbers in current schema
                        ADDRESS: lead.street,
                        CITY: lead.city,
                        STATE: lead.state,
                        ZIP: lead.zip_code
                    },
                    tags: [
                        'Lead Group Export',
                        lead.branch_name || 'Unknown Branch'
                    ]
                };
            });

            // Remove duplicate email addresses (Mailchimp requirement)
            const uniqueMembers = [];
            const seenEmails = new Set();
            let duplicatesRemoved = 0;

            members.forEach(member => {
                const email = member.email_address.toLowerCase();
                if (!seenEmails.has(email)) {
                    seenEmails.add(email);
                    uniqueMembers.push(member);
                } else {
                    duplicatesRemoved++;
                }
            });

            console.log(`[MAILCHIMP EXPORT] Removed ${duplicatesRemoved} duplicate email addresses`);
            console.log(`[MAILCHIMP EXPORT] Unique members for export: ${uniqueMembers.length}`);

            // Log the first member for debugging
            if (uniqueMembers.length > 0) {
                console.log('[MAILCHIMP EXPORT] Sample member merge_fields:', uniqueMembers[0].merge_fields);
                console.log(`[MAILCHIMP EXPORT] Sample member email: ${uniqueMembers[0].email_address}`);
                console.log(`[MAILCHIMP EXPORT] Sample member tags: ${JSON.stringify(uniqueMembers[0].tags)}`);
            }

            console.log(`[MAILCHIMP EXPORT] Prepared ${uniqueMembers.length} members for Mailchimp export`);

            // Add members in batches
            const batchSize = 500;
            let totalAdded = 0;
            let totalUpdated = 0;
            let totalErrors = 0;
            let errorDetails = [];

            for (let i = 0; i < uniqueMembers.length; i += batchSize) {
                const batch = uniqueMembers.slice(i, i + batchSize);
                const batchNum = Math.floor(i/batchSize) + 1;
                console.log(`[MAILCHIMP EXPORT] Processing batch ${batchNum} with ${batch.length} members...`);
                
                try {
                    const batchResponse = await mailchimp.lists.batchListMembers(audienceId, {
                        members: batch,
                        update_existing: true
                    });
                    
                    totalAdded += batchResponse.new_members.length;
                    totalUpdated += batchResponse.updated_members.length;
                    totalErrors += batchResponse.errors.length;
                    
                    console.log(`[MAILCHIMP EXPORT] Batch ${batchNum} results: ${batchResponse.new_members.length} new, ${batchResponse.updated_members.length} updated, ${batchResponse.errors.length} errors`);
                    
                    if (batchResponse.errors && batchResponse.errors.length > 0) {
                        console.log(`[MAILCHIMP EXPORT] Batch ${batchNum} errors:`, batchResponse.errors.slice(0, 3)); // Show first 3 errors
                        errorDetails.push(...batchResponse.errors);
                    }
                } catch (batchError) {
                    console.error(`[MAILCHIMP EXPORT] Batch ${batchNum} completely failed:`, batchError.message);
                    console.error(`[MAILCHIMP EXPORT] Full error details:`, {
                        status: batchError.status,
                        statusText: batchError.statusText,
                        response: batchError.response?.body || batchError.response,
                        title: batchError.title,
                        detail: batchError.detail,
                        instance: batchError.instance
                    });
                    
                    // Log sample data from the failed batch for debugging
                    console.log(`[MAILCHIMP EXPORT] Sample data from failed batch:`, {
                        first_member: batch[0] ? {
                            email: batch[0].email_address,
                            status: batch[0].status,
                            merge_fields_keys: Object.keys(batch[0].merge_fields || {}),
                            merge_fields_sample: Object.entries(batch[0].merge_fields || {}).slice(0, 3),
                            tags: batch[0].tags
                        } : 'No members in batch'
                    });
                    
                    totalErrors += batch.length;
                    errorDetails.push({
                        error: batchError.message,
                        full_error: batchError.response?.body || batchError.toString(),
                        batch: batchNum,
                        member_count: batch.length
                    });
                }
            }

            console.log(`[MAILCHIMP EXPORT] Final results: ${totalAdded} new, ${totalUpdated} updated, ${totalErrors} errors`);
            console.log(`[MAILCHIMP EXPORT] Original leads: ${leadsResult.rows.length}, Members prepared: ${uniqueMembers.length}, Total processed: ${totalAdded + totalUpdated + totalErrors}`);

            // Update group description to include Mailchimp info
            await db.query(`
                UPDATE leads_dashboard.lead_group 
                SET description = CONCAT(
                    COALESCE(description, ''), 
                    CASE 
                        WHEN COALESCE(description, '') = '' THEN ''
                        ELSE E'\n\n'
                    END,
                    'Exported to Mailchimp: ', $2, ' (', $3, ' contacts)'
                )
                WHERE id = $1
            `, [groupId, audienceName, totalAdded]);

            console.log(`[MAILCHIMP EXPORT] Export completed successfully`);

            res.json({
                success: true,
                message: `Successfully exported ${totalAdded} contacts to Mailchimp audience "${audienceName}"`,
                audience_id: audienceId,
                audience_name: audienceName,
                total_contacts: totalAdded,
                errors: totalErrors,
                error_details: totalErrors > 0 ? errorDetails : [],
                mailchimp_url: `https://us${mailchimp.config.server}.admin.mailchimp.com/lists/members/?id=${audienceId}`
            });

        } catch (error) {
            console.error('[MAILCHIMP EXPORT] Error:', error);
            res.status(500).json({ 
                error: 'Failed to export group to Mailchimp',
                details: error.message 
            });
        }
    },

    // Export group to existing Mailchimp audience
    exportGroupToExistingAudience: async (req, res) => {
        console.log('[MAILCHIMP EXPORT] Starting export to existing audience (new schema-based method)...');
        try {
            if (!process.env.MAILCHIMP_API_KEY) {
                return res.status(400).json({ 
                    error: 'Mailchimp API key not configured' 
                });
            }

            const { groupId, audienceId, tags = [] } = req.body;

            // Define required merge fields that we need in Mailchimp
            const requiredMergeFields = [
                { tag: 'STATUS', name: 'Lead Status', type: 'text' },
                { tag: 'SALESPERSO', name: 'Salesperson', type: 'text' },
                { tag: 'LEADSOURCE', name: 'Lead Source', type: 'text' },
                { tag: 'BRANCH', name: 'Branch', type: 'text' }
            ];

            // Check and create missing merge fields
            try {
                const mergeFieldResult = await mailchimpController.createMissingMergeFields(audienceId, requiredMergeFields);
                console.log('[MAILCHIMP EXPORT] Merge field check result:', mergeFieldResult);
                
                if (mergeFieldResult.created.length > 0) {
                    console.log('[MAILCHIMP EXPORT] Created new merge fields:', mergeFieldResult.created);
                }
                
                if (mergeFieldResult.errors.length > 0) {
                    console.log('[MAILCHIMP EXPORT] Some merge fields could not be created:', mergeFieldResult.errors);
                }
            } catch (mergeFieldError) {
                console.error('[MAILCHIMP EXPORT] Error checking/creating merge fields:', mergeFieldError);
                // Continue with export even if merge field creation fails
            }

            // Define the Mailchimp field schema
            const mailchimpFields = [
                { mailchimpField: 'SMSPHONE', dataType: 'smsphone', dbField: 'sms_phone' },
                { mailchimpField: 'MMERGE12', dataType: 'text', dbField: 'lead_name' },
                { mailchimpField: 'FNAME', dataType: 'text', dbField: 'first_name' },
                { mailchimpField: 'LNAME', dataType: 'text', dbField: 'last_name' },
                { mailchimpField: 'MMERGE4', dataType: 'date', dbField: 'created_date' },
                { mailchimpField: 'MMERGE6', dataType: 'number', dbField: 'final_proposal_amount' },
                { mailchimpField: 'MMERGE7', dataType: 'text', dbField: 'calculated_price_after_discount' },
                { mailchimpField: 'MMERGE9', dataType: 'number', dbField: 'calculated_discount_percent' },
                { mailchimpField: 'MMERGE5', dataType: 'zip', dbField: 'zip_code' },
                { mailchimpField: 'STATUS', dataType: 'text', dbField: 'lead_status' },
                { mailchimpField: 'SALESPERSO', dataType: 'text', dbField: 'salesperson' },
                { mailchimpField: 'LEADSOURCE', dataType: 'text', dbField: 'lead_source' },
                { mailchimpField: 'BRANCH', dataType: 'text', dbField: 'branch_name' }
            ];

            // Get group leads with email addresses
            const leadsResult = await db.query(`
                SELECT 
                    l.id,
                    l.name as lead_name,
                    COALESCE(c.first_name, '') as first_name,
                    COALESCE(c.last_name, '') as last_name,
                    COALESCE(c.email_address, '') as email_address,
                    COALESCE(c.phone, '') as customer_phone,
                    COALESCE(c.cell_phone, '') as customer_cell_phone,
                    COALESCE(c.cell_phone, c.phone, '') as sms_phone,
                    COALESCE(a.street, '') as street,
                    COALESCE(a.city, '') as city,
                    COALESCE(a.state, '') as state,
                    COALESCE(a.zip_code, '') as zip_code,
                    CONCAT(COALESCE(a.street, ''), ' ', COALESCE(a.city, ''), ', ', COALESCE(a.state, ''), ' ', COALESCE(a.zip_code, '')) as full_address,
                    COALESCE(b.name, '') as branch_name,
                    l.final_proposal_amount,
                    l.proposal_tm,
                    CAST(0 as DECIMAL(10,2)) as sub_contractor_price,
                    l.created_date,
                    l.inspection_date,
                    lga.created_at as assigned_at,
                    COALESCE(sp.name, '') as salesperson,
                    COALESCE(ls.name, '') as lead_status,
                    COALESCE(s.name, '') as lead_source,
                    '' as tags,
                    COALESCE(cond.name, '') as condition,
                    l.recovered
                FROM leads_dashboard.lead_group_assignment lga
                JOIN leads_dashboard.lead l ON lga.lead_id = l.id
                LEFT JOIN leads_dashboard.customer c ON l.customer_id = c.id
                LEFT JOIN leads_dashboard.address a ON c.address_id = a.id
                LEFT JOIN leads_dashboard.branch b ON l.branch_id = b.id
                LEFT JOIN leads_dashboard.sales_person sp ON l.sales_person_id = sp.id
                LEFT JOIN leads_dashboard.lead_status ls ON l.lead_status_id = ls.id
                LEFT JOIN leads_dashboard.source s ON l.source_id = s.id
                LEFT JOIN leads_dashboard.condition cond ON l.condition_id = cond.id
                WHERE lga.group_id = $1
                AND COALESCE(c.email_address, '') != ''
                AND COALESCE(c.email_address, '') LIKE '%@%'
                ORDER BY l.created_date DESC
            `, [groupId]);

            if (leadsResult.rows.length === 0) {
                return res.status(400).json({ 
                    error: 'No leads with valid email addresses found in this group' 
                });
            }

            // Conversion helpers
            function convertValue(value, type) {
                if (value === null || value === undefined) return '';
                switch (type) {
                    case 'email':
                        return String(value).trim();
                    case 'smsphone': {
                        let phone = String(value).replace(/\D/g, '');
                        if (phone.length === 10) return `(${phone.substr(0,3)}) ${phone.substr(3,3)}-${phone.substr(6,4)}`;
                        if (phone.length === 11 && phone[0] === '1') return `+1 (${phone.substr(1,3)}) ${phone.substr(4,3)}-${phone.substr(7,4)}`;
                        return phone;
                    }
                    case 'text': {
                        let str = String(value).trim();
                        return str.length > 255 ? str.substring(0, 255) : str;
                    }
                    case 'number': {
                        let num = parseFloat(value);
                        return isNaN(num) ? 0 : num;
                    }
                    case 'date': {
                        if (value instanceof Date) return value.toISOString().split('T')[0];
                        if (typeof value === 'string' && value.trim()) {
                            let d = new Date(value);
                            if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
                        }
                        return '';
                    }
                    case 'zip': {
                        let zip = String(value).replace(/\D/g, '').substr(0, 5);
                        return zip;
                    }
                    default:
                        return String(value);
                }
            }

            // Helper function for custom discount percentage rounding
            function roundDiscountPercent(percent) {
                const integer = Math.floor(percent);
                const decimal = percent - integer;
                
                if (decimal >= 0.8) {
                    // Round upward when >= 0.8
                    return integer + 1;
                } else if (decimal >= 0.3 && decimal <= 0.7) {
                    // Round to .5 when between 0.3-0.7
                    return integer + 0.5;
                } else {
                    // Round downward when 0.0-0.3
                    return integer;
                }
            }

            // Calculate derived fields for the lead (multiplier, discount percentage, price after discount)
            function calculateDiscounts(lead) {
                if (!lead.final_proposal_amount || !lead.proposal_tm) {
                    return {
                        calculated_discount_percent: 0,
                        calculated_price_after_discount: lead.final_proposal_amount || 0
                    };
                }
                
                const final = parseFloat(lead.final_proposal_amount);
                const tm = parseFloat(lead.proposal_tm);
                const subCost = parseFloat(lead.sub_contractor_price) || 0;
                
                if (final <= 0 || tm <= 0) {
                    return {
                        calculated_discount_percent: 0,
                        calculated_price_after_discount: final
                    };
                }
                
                // Use user's business logic for true multiplier
                let currentMultiplier;
                let costBasisForCalculation;
                
                if (subCost > 0) {
                    // Final price - (sub cost * 1.5) = Non-sub new final price
                    // Non-sub final price / T&M = true multiplier
                    const nonSubNewFinalPrice = final - (subCost * 1.5);
                    currentMultiplier = nonSubNewFinalPrice / tm;
                    costBasisForCalculation = tm;
                } else {
                    // No subcontractor: Final price / T&M = multiplier
                    currentMultiplier = final / tm;
                    costBasisForCalculation = tm;
                }
                
                // Business rules
                const minPrice = 3200;
                const minMultiplier = 2.0;
                const maxDiscountPercent = 15;
                
                let maxDiscount = 0;
                
                if (currentMultiplier > minMultiplier) {
                    // Rule 1: Final price after discount can't be lower than $3,200
                    const maxDiscountByMinPrice = Math.max(0, final - minPrice);
                    
                    // Rule 2: True multiplier must stay >= 2.0
                    let maxDiscountByMultiplier;
                    if (subCost > 0) {
                        const minAcceptableFinalPrice = (costBasisForCalculation * minMultiplier) + (subCost * 1.5);
                        maxDiscountByMultiplier = Math.max(0, final - minAcceptableFinalPrice);
                    } else {
                        const minAcceptableFinalPrice = costBasisForCalculation * minMultiplier;
                        maxDiscountByMultiplier = Math.max(0, final - minAcceptableFinalPrice);
                    }
                    
                    // Rule 3: Maximum 15% discount
                    const maxDiscountByPercent = final * (maxDiscountPercent / 100);
                    
                    // Take the most restrictive discount (smallest value)
                    maxDiscount = Math.min(maxDiscountByMinPrice, maxDiscountByMultiplier, maxDiscountByPercent);
                }
                
                let discountPercent = 0;
                if (maxDiscount > 0) {
                    discountPercent = (maxDiscount / final) * 100;
                }
                
                // Apply custom rounding to discount percentage
                const roundedDiscountPercent = roundDiscountPercent(discountPercent);
                
                // Calculate final price based on rounded discount percentage
                const finalDiscountAmount = final * (roundedDiscountPercent / 100);
                const finalDiscountedPrice = Math.round((final - finalDiscountAmount) * 100) / 100;
                
                return {
                    calculated_discount_percent: roundedDiscountPercent,
                    calculated_price_after_discount: finalDiscountedPrice
                };
            }

            // Build members array
            const members = leadsResult.rows.map(lead => {
                // Calculate derived fields
                const discounts = calculateDiscounts(lead);
                lead.calculated_discount_percent = discounts.calculated_discount_percent;
                lead.calculated_price_after_discount = discounts.calculated_price_after_discount;
                // Prefer cell phone for SMSPHONE, fallback to customer_phone
                lead.sms_phone = (lead.customer_cell_phone && lead.customer_cell_phone.trim() !== '')
                    ? lead.customer_cell_phone
                    : lead.customer_phone;
                // Build merge_fields
                const merge_fields = {};
                mailchimpFields.forEach(field => {
                    merge_fields[field.mailchimpField] = convertValue(lead[field.dbField], field.dataType);
                });
                
                return {
                    email_address: lead.email_address,
                    status: 'subscribed',
                    merge_fields,
                    tags: tags.filter(Boolean) // Only use user-selected tags, no automatic branch name
                };
            });

            // Remove duplicate email addresses (Mailchimp requirement)
            const uniqueMembers = [];
            const seenEmails = new Set();
            let duplicatesRemoved = 0;

            members.forEach(member => {
                const email = member.email_address.toLowerCase();
                if (!seenEmails.has(email)) {
                    seenEmails.add(email);
                    uniqueMembers.push(member);
                } else {
                    duplicatesRemoved++;
                }
            });

            console.log(`[MAILCHIMP EXPORT] Removed ${duplicatesRemoved} duplicate email addresses`);
            console.log(`[MAILCHIMP EXPORT] Unique members for export: ${uniqueMembers.length}`);

            // Log the first member for debugging
            if (uniqueMembers.length > 0) {
                console.log('[MAILCHIMP EXPORT] Sample member merge_fields:', uniqueMembers[0].merge_fields);
                console.log(`[MAILCHIMP EXPORT] Sample member email: ${uniqueMembers[0].email_address}`);
                console.log(`[MAILCHIMP EXPORT] Sample member tags: ${JSON.stringify(uniqueMembers[0].tags)}`);
            }

            console.log(`[MAILCHIMP EXPORT] Prepared ${uniqueMembers.length} members for Mailchimp export`);

            // Add members in batches
            const batchSize = 500;
            let totalAdded = 0;
            let totalUpdated = 0;
            let totalErrors = 0;
            let errorDetails = [];

            for (let i = 0; i < uniqueMembers.length; i += batchSize) {
                const batch = uniqueMembers.slice(i, i + batchSize);
                const batchNum = Math.floor(i/batchSize) + 1;
                console.log(`[MAILCHIMP EXPORT] Processing batch ${batchNum} with ${batch.length} members...`);
                
                try {
                    const batchResponse = await mailchimp.lists.batchListMembers(audienceId, {
                        members: batch,
                        update_existing: true
                    });
                    
                    totalAdded += batchResponse.new_members.length;
                    totalUpdated += batchResponse.updated_members.length;
                    totalErrors += batchResponse.errors.length;
                    
                    console.log(`[MAILCHIMP EXPORT] Batch ${batchNum} results: ${batchResponse.new_members.length} new, ${batchResponse.updated_members.length} updated, ${batchResponse.errors.length} errors`);
                    
                    if (batchResponse.errors && batchResponse.errors.length > 0) {
                        console.log(`[MAILCHIMP EXPORT] Batch ${batchNum} errors:`, batchResponse.errors.slice(0, 3)); // Show first 3 errors
                        errorDetails.push(...batchResponse.errors);
                    }
                } catch (batchError) {
                    console.error(`[MAILCHIMP EXPORT] Batch ${batchNum} completely failed:`, batchError.message);
                    console.error(`[MAILCHIMP EXPORT] Full error details:`, {
                        status: batchError.status,
                        statusText: batchError.statusText,
                        response: batchError.response?.body || batchError.response,
                        title: batchError.title,
                        detail: batchError.detail,
                        instance: batchError.instance
                    });
                    
                    // Log sample data from the failed batch for debugging
                    console.log(`[MAILCHIMP EXPORT] Sample data from failed batch:`, {
                        first_member: batch[0] ? {
                            email: batch[0].email_address,
                            status: batch[0].status,
                            merge_fields_keys: Object.keys(batch[0].merge_fields || {}),
                            merge_fields_sample: Object.entries(batch[0].merge_fields || {}).slice(0, 3),
                            tags: batch[0].tags
                        } : 'No members in batch'
                    });
                    
                    totalErrors += batch.length;
                    errorDetails.push({
                        error: batchError.message,
                        full_error: batchError.response?.body || batchError.toString(),
                        batch: batchNum,
                        member_count: batch.length
                    });
                }
            }

            console.log(`[MAILCHIMP EXPORT] Final results: ${totalAdded} new, ${totalUpdated} updated, ${totalErrors} errors`);
            console.log(`[MAILCHIMP EXPORT] Original leads: ${leadsResult.rows.length}, Members prepared: ${uniqueMembers.length}, Total processed: ${totalAdded + totalUpdated + totalErrors}`);

            res.json({
                success: true,
                message: `Successfully exported to existing audience: ${totalAdded} new, ${totalUpdated} updated`,
                audience_id: audienceId,
                new_contacts: totalAdded,
                updated_contacts: totalUpdated,
                errors: totalErrors,
                error_details: totalErrors > 0 ? errorDetails : [],
                mailchimp_url: `https://us${mailchimp.config.server}.admin.mailchimp.com/lists/members/?id=${audienceId}`
            });
        } catch (error) {
            res.status(500).json({ 
                error: 'Failed to export group to existing Mailchimp audience',
                details: error.message 
            });
        }
    },

    // Debug audience tags - comprehensive investigation
    debugAudienceTags: async (req, res) => {
        try {
            const { audienceId } = req.params;
            console.log(`[DEBUG TAGS] Investigating tags for audience: ${audienceId}`);
            
            if (!process.env.MAILCHIMP_API_KEY) {
                return res.status(400).json({ error: 'Mailchimp API key not configured' });
            }

            const debugInfo = {
                audience_id: audienceId,
                methods_tried: [],
                all_found_tags: [],
                members_with_test_tag: [],
                raw_responses: {}
            };

            // Method 1: Tag Search API
            try {
                console.log('[DEBUG TAGS] Method 1: Tag Search API');
                const tagSearchResponse = await mailchimp.lists.tagSearch(audienceId, {
                    count: 1000,
                    offset: 0
                });
                
                debugInfo.methods_tried.push('tagSearch');
                debugInfo.raw_responses.tagSearch = {
                    total_items: tagSearchResponse.total_items,
                    returned_count: tagSearchResponse.tags ? tagSearchResponse.tags.length : 0,
                    tags: tagSearchResponse.tags || []
                };
                
                console.log(`[DEBUG TAGS] Tag Search found ${tagSearchResponse.tags ? tagSearchResponse.tags.length : 0} tags`);
                if (tagSearchResponse.tags) {
                    debugInfo.all_found_tags.push(...tagSearchResponse.tags.map(t => ({source: 'tagSearch', ...t})));
                }
            } catch (error) {
                console.log('[DEBUG TAGS] Tag Search failed:', error.message);
                debugInfo.raw_responses.tagSearch = { error: error.message };
            }

            // Method 3: Search for "test" specifically
            try {
                console.log('[DEBUG TAGS] Method 3: Searching for "test" specifically');
                const testSearchResponse = await mailchimp.lists.tagSearch(audienceId, {
                    name: 'test'
                });
                
                debugInfo.methods_tried.push('testSearch');
                debugInfo.raw_responses.testSearch = testSearchResponse;
                
                console.log(`[DEBUG TAGS] Test search result:`, testSearchResponse);
                
            } catch (error) {
                console.log('[DEBUG TAGS] Test search failed:', error.message);
                debugInfo.raw_responses.testSearch = { error: error.message };
            }

            // Analyze all found tags
            const uniqueTagNames = [...new Set(debugInfo.all_found_tags.map(t => t.name))];
            const testTags = debugInfo.all_found_tags.filter(t => t.name.toLowerCase().includes('test'));
            
            debugInfo.summary = {
                total_unique_tag_names: uniqueTagNames.length,
                all_unique_names: uniqueTagNames.sort(),
                test_related_tags: testTags,
                has_test_tag: testTags.length > 0
            };

            console.log(`[DEBUG TAGS] Summary: Found ${uniqueTagNames.length} unique tags`);
            console.log(`[DEBUG TAGS] Test-related tags: ${testTags.length}`);
            console.log(`[DEBUG TAGS] All tag names:`, uniqueTagNames);
            
            res.json(debugInfo);

        } catch (error) {
            console.error('[DEBUG TAGS] Debug failed:', error);
            res.status(500).json({ 
                error: 'Debug failed',
                details: error.message 
            });
        }
    },

    // Debug field mappings and data conversion
    debugFieldMappings: async (req, res) => {
        try {
            const { groupId, fieldMappings = [] } = req.body;
            
            console.log('[DEBUG FIELDS] Testing field mappings for group:', groupId);
            console.log('[DEBUG FIELDS] Field mappings to test:', JSON.stringify(fieldMappings, null, 2));
            
            // Get one sample lead from the group
            const sampleLead = await db.query(`
                SELECT 
                    l.id,
                    l.name as lead_name,
                    COALESCE(c.first_name, '') as first_name,
                    COALESCE(c.last_name, '') as last_name,
                    COALESCE(c.email_address, '') as email_address,
                    COALESCE(c.phone, '') as customer_phone,
                    COALESCE(c.cell_phone, '') as customer_cell_phone,
                    COALESCE(a.street, '') as street,
                    COALESCE(a.city, '') as city,
                    COALESCE(a.state, '') as state,
                    COALESCE(a.zip_code, '') as zip_code,
                    COALESCE(b.name, '') as branch_name,
                    l.final_proposal_amount,
                    l.proposal_tm,
                    CAST(0 as DECIMAL(10,2)) as sub_contractor_price,
                    l.created_date,
                    l.inspection_date,
                    lga.created_at as assigned_at,
                    COALESCE(sp.name, '') as salesperson,
                    COALESCE(ls.name, '') as lead_status,
                    COALESCE(s.name, '') as lead_source,
                    COALESCE(cond.name, '') as condition,
                    l.recovered
                FROM leads_dashboard.lead_group_assignment lga
                JOIN leads_dashboard.lead l ON lga.lead_id = l.id
                LEFT JOIN leads_dashboard.customer c ON l.customer_id = c.id
                LEFT JOIN leads_dashboard.address a ON c.address_id = a.id
                LEFT JOIN leads_dashboard.branch b ON l.branch_id = b.id
                LEFT JOIN leads_dashboard.sales_person sp ON l.sales_person_id = sp.id
                LEFT JOIN leads_dashboard.lead_status ls ON l.lead_status_id = ls.id
                LEFT JOIN leads_dashboard.source s ON l.source_id = s.id
                LEFT JOIN leads_dashboard.condition cond ON l.condition_id = cond.id
                WHERE lga.group_id = $1
                LIMIT 1
            `, [groupId]);
            
            if (sampleLead.rows.length === 0) {
                return res.json({ error: 'No leads found in this group' });
            }
            
            const lead = sampleLead.rows[0];
            console.log('[DEBUG FIELDS] Sample lead from database:', lead);
            
            // Test each field mapping
            const results = [];
            
            fieldMappings.forEach(mapping => {
                const rawValue = lead[mapping.leadField];
                
                // Use the same formatValue function from the export
                const formatValue = (value, mailchimpFieldType = 'text') => {
                    if (value === null || value === undefined) {
                        switch (mailchimpFieldType) {
                            case 'FPAMOUNT':
                            case 'PADISCOUNT':
                            case 'TMAMOUNT':
                            case 'SUBPRICE':
                            case 'DISCOUNT':
                                return 0;
                            default:
                                return '';
                        }
                    }
                    
                    if (value === '') {
                        switch (mailchimpFieldType) {
                            case 'FPAMOUNT':
                            case 'PADISCOUNT':
                            case 'TMAMOUNT':
                            case 'SUBPRICE':
                            case 'DISCOUNT':
                                return 0;
                            default:
                                return '';
                        }
                    }
                    
                    switch (mailchimpFieldType) {
                        case 'FPAMOUNT':
                        case 'PADISCOUNT':
                        case 'TMAMOUNT':
                        case 'SUBPRICE':
                            const currencyNum = parseFloat(value);
                            return isNaN(currencyNum) ? 0 : currencyNum;
                            
                        case 'DISCOUNT':
                            const percentNum = parseFloat(value);
                            return isNaN(percentNum) ? 0 : percentNum;
                            
                        case 'PHONE':
                            const phoneStr = value.toString().replace(/\D/g, '');
                            if (phoneStr.length === 10) {
                                return `(${phoneStr.substr(0,3)}) ${phoneStr.substr(3,3)}-${phoneStr.substr(6,4)}`;
                            } else if (phoneStr.length === 11 && phoneStr[0] === '1') {
                                return `+1 (${phoneStr.substr(1,3)}) ${phoneStr.substr(4,3)}-${phoneStr.substr(7,4)}`;
                            } else if (phoneStr.length > 0) {
                                return phoneStr;
                            }
                            return '';
                            
                        case 'CDATE':
                        case 'INSPDATE':
                            if (value instanceof Date) {
                                return value.toISOString().split('T')[0];
                            } else if (typeof value === 'string' && value.trim()) {
                                try {
                                    const date = new Date(value);
                                    if (!isNaN(date.getTime())) {
                                        return date.toISOString().split('T')[0];
                                    }
                                } catch (e) {}
                            }
                            return '';
                            
                        case 'ZIP':
                            const zipStr = value.toString().replace(/\D/g, '').substr(0, 5);
                            return zipStr;
                            
                        default:
                            const textStr = value.toString().trim();
                            return textStr.length > 255 ? textStr.substring(0, 255) : textStr;
                    }
                };
                
                const formattedValue = formatValue(rawValue, mapping.mailchimpField);
                
                results.push({
                    leadField: mapping.leadField,
                    mailchimpField: mapping.mailchimpField,
                    rawValue: rawValue,
                    rawValueType: typeof rawValue,
                    formattedValue: formattedValue,
                    formattedValueType: typeof formattedValue,
                    isEmpty: formattedValue === '' || formattedValue === 0 || formattedValue === null || formattedValue === undefined
                });
            });
            
            res.json({
                groupId: groupId,
                sampleLead: lead,
                fieldMappingResults: results,
                summary: {
                    totalMappings: results.length,
                    emptyFields: results.filter(r => r.isEmpty).length,
                    populatedFields: results.filter(r => !r.isEmpty).length
                }
            });
            
        } catch (error) {
            console.error('[DEBUG FIELDS] Error:', error);
            res.status(500).json({ error: error.message });
        }
    },

    // Create missing merge fields in Mailchimp audience
    createMissingMergeFields: async (audienceId, requiredFields) => {
        try {
            console.log('[MAILCHIMP] Checking and creating missing merge fields...');
            
            // Get existing merge fields
            const mergeFieldsResponse = await mailchimp.lists.getListMergeFields(audienceId);
            const existingFields = mergeFieldsResponse.merge_fields.map(field => field.tag);
            
            console.log('[MAILCHIMP] Existing merge fields:', existingFields);
            console.log('[MAILCHIMP] Required fields:', requiredFields.map(f => f.tag));
            
            const missingFields = requiredFields.filter(field => !existingFields.includes(field.tag));
            
            if (missingFields.length === 0) {
                console.log('[MAILCHIMP] All required merge fields already exist');
                return { created: [], skipped: existingFields };
            }
            
            console.log('[MAILCHIMP] Missing fields to create:', missingFields.map(f => f.tag));
            
            const createdFields = [];
            const errors = [];
            
            for (const field of missingFields) {
                try {
                    console.log(`[MAILCHIMP] Creating merge field: ${field.tag} (${field.name})`);
                    
                    const newField = await mailchimp.lists.addListMergeField(audienceId, {
                        tag: field.tag,
                        name: field.name,
                        type: field.type || 'text',
                        required: field.required || false,
                        default_value: field.default_value || '',
                        public: field.public || true,
                        display_order: field.display_order || 1,
                        options: field.options || {}
                    });
                    
                    createdFields.push(newField.tag);
                    console.log(`[MAILCHIMP] Successfully created merge field: ${field.tag}`);
                    
                } catch (createError) {
                    console.error(`[MAILCHIMP] Error creating merge field ${field.tag}:`, createError.message);
                    errors.push({ field: field.tag, error: createError.message });
                }
            }
            
            return { 
                created: createdFields, 
                errors: errors,
                skipped: existingFields.filter(f => requiredFields.find(rf => rf.tag === f))
            };
            
        } catch (error) {
            console.error('[MAILCHIMP] Error in createMissingMergeFields:', error);
            throw error;
        }
    },

    // Get merge fields for a specific audience
    getAudienceMergeFields: async (req, res) => {
        try {
            if (!process.env.MAILCHIMP_API_KEY) {
                return res.status(400).json({ 
                    error: 'Mailchimp API key not configured' 
                });
            }

            const { audienceId } = req.params;
            
            if (!audienceId) {
                return res.status(400).json({ 
                    error: 'Audience ID is required' 
                });
            }

            console.log(`[MAILCHIMP] Getting merge fields for audience: ${audienceId}`);

            // Get merge fields from Mailchimp
            const mergeFieldsResponse = await mailchimp.lists.getListMergeFields(audienceId);
            
            const mergeFields = mergeFieldsResponse.merge_fields.map(field => ({
                tag: field.tag,
                name: field.name,
                type: field.type,
                required: field.required,
                default_value: field.default_value || '',
                options: field.options || {}
            }));

            console.log(`[MAILCHIMP] Found ${mergeFields.length} merge fields`);
            
            res.json({
                audience_id: audienceId,
                total_merge_fields: mergeFields.length,
                merge_fields: mergeFields
            });

        } catch (error) {
            console.error('[MAILCHIMP] Error fetching merge fields:', error);
            res.status(500).json({ 
                error: 'Failed to fetch audience merge fields',
                details: error.message 
            });
        }
    },

    // Sync leads with Mailchimp and update recovered status
    syncWithMailchimp: async (req, res) => {
        console.log('[MAILCHIMP SYNC] Starting sync process...');
        try {
            if (!process.env.MAILCHIMP_API_KEY) {
                return res.status(400).json({ 
                    error: 'Mailchimp API key not configured. Please add MAILCHIMP_API_KEY to your .env file.' 
                });
            }

            const { groupId, audienceId, tags } = req.body;

            console.log('[MAILCHIMP SYNC] Request data:', { 
                groupId, 
                audienceId,
                tags: tags?.length || 0,
                selectedTags: tags
            });

            // Validation
            if (!groupId || !audienceId) {
                return res.status(400).json({ 
                    error: 'Missing required fields: groupId and audienceId are required' 
                });
            }

            // CRITICAL: Prevent sync without tags to avoid marking all leads as recovered
            if (!tags || tags.length === 0) {
                return res.status(400).json({ 
                    error: 'At least one tag must be selected to proceed with sync. This prevents accidentally marking all leads as recovered.' 
                });
            }

            // Get group leads with email addresses (using correct table structure)
            const groupLeadsResult = await db.query(`
                SELECT 
                    l.id,
                    l.name as lead_name,
                    COALESCE(c.first_name, '') as first_name,
                    COALESCE(c.last_name, '') as last_name,
                    COALESCE(c.email_address, '') as email_address,
                    l.recovered,
                    COALESCE(l.texted, false) as texted
                FROM leads_dashboard.lead_group_assignment lga
                JOIN leads_dashboard.lead l ON lga.lead_id = l.id
                LEFT JOIN leads_dashboard.customer c ON l.customer_id = c.id
                WHERE lga.group_id = $1 
                AND COALESCE(c.email_address, '') != ''
                AND COALESCE(c.email_address, '') LIKE '%@%'
                ORDER BY l.id
            `, [groupId]);

            const groupLeads = groupLeadsResult.rows;
            console.log(`[MAILCHIMP SYNC] Found ${groupLeads.length} leads with email addresses in group`);

            if (groupLeads.length === 0) {
                return res.status(400).json({ 
                    error: 'No leads with valid email addresses found in this group' 
                });
            }

            // Get Mailchimp members with specific tags (if tags are specified)
            let mailchimpMembersWithTags = new Set();
            
            if (tags && tags.length > 0) {
                console.log(`[MAILCHIMP SYNC] Looking for members with tags: ${tags.join(', ')}`);
                
                // For each tag, get members who have that tag
                for (const tag of tags) {
                    try {
                        console.log(`[MAILCHIMP SYNC] Fetching members with tag: ${tag}`);
                        
                        // Get members with this specific tag using the segments API
                        // First, we need to get all members and then filter by tags
                        let allMembers = [];
                        let offset = 0;
                        const count = 1000; // Max per request
                        
                        while (true) {
                            const membersResponse = await mailchimp.lists.getListMembersInfo(audienceId, {
                                count: count,
                                offset: offset,
                                status: 'subscribed'
                            });
                            
                            if (membersResponse.members && membersResponse.members.length > 0) {
                                allMembers.push(...membersResponse.members);
                                console.log(`[MAILCHIMP SYNC] Fetched ${membersResponse.members.length} members (offset: ${offset})`);
                                
                                if (membersResponse.members.length < count) {
                                    break; // No more members
                                }
                                offset += count;
                            } else {
                                break;
                            }
                        }
                        
                        console.log(`[MAILCHIMP SYNC] Total members in audience: ${allMembers.length}`);
                        
                        // Filter members who have the specific tag
                        let membersWithTag = 0;
                        for (const member of allMembers) {
                            if (member.tags && member.tags.length > 0) {
                                const memberTags = member.tags.map(t => t.name.toLowerCase());
                                if (memberTags.includes(tag.toLowerCase())) {
                                    mailchimpMembersWithTags.add(member.email_address.toLowerCase());
                                    membersWithTag++;
                                }
                            }
                        }
                        
                        console.log(`[MAILCHIMP SYNC] Members with tag "${tag}": ${membersWithTag}`);
                        
                    } catch (tagError) {
                        console.error(`[MAILCHIMP SYNC] Error fetching members with tag "${tag}":`, tagError.message);
                        // Continue with other tags even if one fails
                    }
                }
                
                console.log(`[MAILCHIMP SYNC] Total unique members with specified tags: ${mailchimpMembersWithTags.size}`);
            } else {
                console.log(`[MAILCHIMP SYNC] No specific tags provided, will check all members in audience`);
            }

            // Check which leads exist in Mailchimp audience and update recovered status
            let syncedCount = 0;
            let recoveredCount = 0;
            let textedCount = 0;
            let errorCount = 0;
            const syncResults = [];

            for (const lead of groupLeads) {
                try {
                    const emailLower = lead.email_address.toLowerCase();
                    let shouldBeRecovered = lead.recovered; // Default to current status
                    let shouldBeTexted = lead.texted; // Default to current status
                    
                    // Get member's actual tags from Mailchimp to check individual tag presence
                    let memberTags = [];
                    let memberExists = false;
                    
                    try {
                        const memberHash = crypto.createHash('md5').update(emailLower).digest('hex');
                        const memberResponse = await mailchimp.lists.getListMember(audienceId, memberHash);
                        memberExists = memberResponse.status === 'subscribed' || memberResponse.status === 'unsubscribed';
                        memberTags = memberResponse.tags ? memberResponse.tags.map(t => t.name.toLowerCase()) : [];
                        console.log(`[MAILCHIMP SYNC] Lead ${lead.id} (${lead.email_address}) - Member exists: ${memberExists}, Tags: [${memberTags.join(', ')}]`);
                    } catch (memberError) {
                        if (memberError.status === 404) {
                            memberExists = false;
                            memberTags = [];
                            console.log(`[MAILCHIMP SYNC] Lead ${lead.id} (${lead.email_address}) - Member not found in Mailchimp`);
                        } else {
                            throw memberError;
                        }
                    }
                    
                    if (tags && tags.length > 0) {
                        // Classify the selected tags into different categories
                        const recoveryTags = tags.filter(tag => {
                            const tagLower = tag.toLowerCase();
                            return tagLower.includes('recover') || 
                                   tagLower.includes('sold') || 
                                   tagLower.includes('won') || 
                                   tagLower.includes('closed') ||
                                   tagLower.includes('success') ||
                                   tagLower.includes('complete');
                        });

                        const textingTags = tags.filter(tag => {
                            const tagLower = tag.toLowerCase();
                            return tagLower.includes('text') || 
                                   tagLower.includes('sms') || 
                                   tagLower.includes('message') ||
                                   tagLower.includes('contacted') ||
                                   tagLower.includes('reached');
                        });

                        console.log(`[MAILCHIMP SYNC] Lead ${lead.id} - Recovery tags to check: [${recoveryTags.join(', ')}], Texting tags to check: [${textingTags.join(', ')}]`);

                        // Only update recovered status if we're checking recovery-related tags
                        if (recoveryTags.length > 0) {
                            const hasRecoveryTag = recoveryTags.some(tag => memberTags.includes(tag.toLowerCase()));
                            shouldBeRecovered = hasRecoveryTag;
                            console.log(`[MAILCHIMP SYNC] Lead ${lead.id} - Has recovery tag: ${hasRecoveryTag}`);
                        }

                        // Only update texted status if we're checking texting-related tags
                        if (textingTags.length > 0) {
                            const hasTextingTag = textingTags.some(tag => memberTags.includes(tag.toLowerCase()));
                            shouldBeTexted = hasTextingTag;
                            console.log(`[MAILCHIMP SYNC] Lead ${lead.id} - Has texting tag: ${hasTextingTag}`);
                        }
                        
                        // If none of the selected tags match our categories, fall back to existence check
                        if (recoveryTags.length === 0 && textingTags.length === 0) {
                            console.log(`[MAILCHIMP SYNC] Lead ${lead.id} - No categorized tags found, using member existence for recovery status`);
                            shouldBeRecovered = memberExists;
                        }
                    } else {
                        // If no tags specified, only check member existence for recovery
                        shouldBeRecovered = memberExists;
                        console.log(`[MAILCHIMP SYNC] Lead ${lead.id} - No tags specified, using member existence: ${memberExists}`);
                    }

                    // Update recovered status if it changed
                    if (lead.recovered !== shouldBeRecovered) {
                        await db.query(`
                            UPDATE leads_dashboard.lead 
                            SET recovered = $1, updated_at = NOW()
                            WHERE id = $2
                        `, [shouldBeRecovered, lead.id]);

                        if (shouldBeRecovered) {
                            recoveredCount++;
                        }

                        console.log(`[MAILCHIMP SYNC] Updated lead ${lead.id} recovered status: ${lead.recovered} → ${shouldBeRecovered}`);
                    }

                    // Update texted status if it changed
                    if (lead.texted !== shouldBeTexted) {
                        await db.query(`
                            UPDATE leads_dashboard.lead 
                            SET texted = $1, updated_at = NOW()
                            WHERE id = $2
                        `, [shouldBeTexted, lead.id]);

                        if (shouldBeTexted) {
                            textedCount++;
                        }

                        console.log(`[MAILCHIMP SYNC] Updated lead ${lead.id} texted status: ${lead.texted} → ${shouldBeTexted}`);
                    }

                    syncResults.push({
                        leadId: lead.id,
                        email: lead.email_address,
                        name: lead.lead_name || `${lead.first_name} ${lead.last_name}`.trim(),
                        memberExists: memberExists,
                        memberTags: memberTags,
                        recoveredStatus: shouldBeRecovered,
                        textedStatus: shouldBeTexted,
                        recoveredUpdated: lead.recovered !== shouldBeRecovered,
                        textedUpdated: lead.texted !== shouldBeTexted
                    });

                    syncedCount++;

                } catch (error) {
                    console.error(`[MAILCHIMP SYNC] Error processing lead ${lead.id}:`, error);
                    errorCount++;
                    
                    syncResults.push({
                        leadId: lead.id,
                        email: lead.email_address,
                        error: error.message,
                        updated: false
                    });
                }
            }

            // Update group description with sync info
            const groupResult = await db.query('SELECT name FROM leads_dashboard.lead_group WHERE id = $1', [groupId]);
            const groupName = groupResult.rows[0]?.name || 'Unknown Group';

            const syncDescription = tags && tags.length > 0 
                ? `Synced with Mailchimp tags [${tags.join(', ')}]: ${new Date().toISOString().split('T')[0]} (${syncedCount} leads synced, ${recoveredCount} recovered, ${textedCount} texted)`
                : `Synced with Mailchimp: ${new Date().toISOString().split('T')[0]} (${syncedCount} leads synced, ${recoveredCount} recovered, ${textedCount} texted)`;

            await db.query(`
                UPDATE leads_dashboard.lead_group 
                SET description = CONCAT(
                    COALESCE(description, ''), 
                    CASE 
                        WHEN COALESCE(description, '') = '' THEN ''
                        ELSE E'\n\n'
                    END,
                    $2::text
                )
                WHERE id = $1
            `, [groupId, syncDescription]);

            console.log(`[MAILCHIMP SYNC] Sync completed successfully`);

            res.json({
                success: true,
                message: `Successfully synced ${syncedCount} leads with Mailchimp`,
                group_id: groupId,
                audience_id: audienceId,
                selected_tags: tags || [],
                total_synced: syncedCount,
                recovered_count: recoveredCount,
                texted_count: textedCount,
                error_count: errorCount,
                sync_results: syncResults,
                mailchimp_url: `https://us${mailchimp.config.server}.admin.mailchimp.com/lists/members/?id=${audienceId}`
            });

        } catch (error) {
            console.error('[MAILCHIMP SYNC] Error:', error);
            res.status(500).json({ 
                error: 'Failed to sync with Mailchimp',
                details: error.message 
            });
        }
    }
}

module.exports = mailchimpController;