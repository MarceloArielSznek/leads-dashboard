const https = require('https');
const db = require('../config/database');

// Branch mapping from API to your database
const BRANCH_MAPPING = {
    1: 'Orange County',    // Orange -> Orange County
    3: 'San Diego',        // San Diego -> San Diego  
    4: 'Everett',          // Everett -> Everett
    5: 'Seattle/Kent',     // Seattle/Kent -> Seattle/Kent
    7: 'San Bernandino'    // San Bernardino -> San Bernandino (note spelling difference)
};

const API_BRANCH_IDS = [1, 3, 4, 5, 7];

function makeHttpsRequest(url, headers) {
    return new Promise((resolve, reject) => {
        const req = https.request(url, { headers }, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                try {
                    const jsonData = JSON.parse(data);
                    resolve(jsonData);
                } catch (error) {
                    reject(new Error(`Failed to parse JSON: ${error.message}`));
                }
            });
        });
        
        req.on('error', (error) => {
            reject(error);
        });
        
        req.end();
    });
}

async function fetchLostLeadsFromAPI(branchId) {
    const allLeads = [];
    let start = 0;
    const limit = 100;
    let hasMoreData = true;

    try {
        console.log(`📡 Fetching lost leads from ${BRANCH_MAPPING[branchId]} (API Branch ${branchId})...`);
        
        while (hasMoreData) {
            const url = `https://admin.attic-tech.com/api/job-estimates?publicationState=live&filters[status][$eq]=Lost&filters[branch][id][$eq]=${branchId}&pagination[start]=${start}&pagination[limit]=${limit}&sort=updatedAt:desc&populate[0]=customer_info&populate[1]=branch_configuration&fields[0]=name&fields[1]=status&fields[2]=true_cost&fields[3]=labor_hours&fields[4]=address&fields[5]=retail_cost&fields[6]=final_price&fields[7]=discount_provided`;

            const data = await makeHttpsRequest(url, {
                "accept": "application/json, text/plain, */*",
                "authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MTU2LCJpYXQiOjE3NDcyNDY4MjEsImV4cCI6MTc0OTgzODgyMX0.1-zlsj5pxCdvyYB_PIsp89_L_dHiOTv0ICFxtvgdgDw",
                "Referer": "https://www.attic-tech.com/"
            });

            const pageLeads = data.data || [];
            
            if (pageLeads.length === 0) {
                hasMoreData = false;
                break;
            }
            
            const processedLeads = pageLeads.map(lead => {
                const a = lead.attributes;
                const multiplier = a.true_cost > 0 ? a.final_price / a.true_cost : null;

                return {
                    api_id: lead.id,
                    api_branch_id: branchId,
                    branch_name: BRANCH_MAPPING[branchId],
                    name: a.name || '',
                    status: a.status,
                    true_cost: a.true_cost || 0,
                    labor_hours: a.labor_hours || 0,
                    address: a.address || '',
                    retail_cost: a.retail_cost || 0,
                    final_price: a.final_price || 0,
                    discount_provided: a.discount_provided || 0,
                    multiplier: multiplier,
                    customer_info: a.customer_info?.data?.attributes || null,
                    branch_configuration: a.branch_configuration?.data?.attributes || null
                };
            });
            
            allLeads.push(...processedLeads);
            
            if (pageLeads.length < limit) {
                hasMoreData = false;
            } else {
                start += limit;
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }
        
        console.log(`   ✅ Found ${allLeads.length} lost leads`);
        return allLeads;

    } catch (error) {
        console.error(`❌ Error fetching ${BRANCH_MAPPING[branchId]}:`, error.message);
        return allLeads;
    }
}

async function getExistingLostLeads() {
    const client = await db.pool.connect();
    
    try {
        console.log('🔍 Fetching existing "Lost" leads from database...');
        
        const query = `
            SELECT 
                l.id,
                l.name,
                l.final_proposal_amount,
                l.retail_cost,
                l.discount_provided,
                l.matched,
                l.created_date,
                b.name as branch_name,
                sp.name as salesperson_name,
                c.first_name,
                c.last_name,
                a.street,
                a.city,
                a.state,
                a.zip_code
            FROM leads_dashboard.lead l
            JOIN leads_dashboard.lead_status ls ON l.lead_status_id = ls.id
            JOIN leads_dashboard.branch b ON l.branch_id = b.id
            LEFT JOIN leads_dashboard.sales_person sp ON l.sales_person_id = sp.id
            LEFT JOIN leads_dashboard.customer c ON l.customer_id = c.id
            LEFT JOIN leads_dashboard.address a ON c.address_id = a.id
            WHERE ls.name = 'Lost'
            ORDER BY b.name, l.name
        `;
        
        const result = await client.query(query);
        console.log(`   ✅ Found ${result.rows.length} existing lost leads in database`);
        
        return result.rows.map(row => ({
            db_id: row.id,
            name: row.name,
            final_proposal_amount: parseFloat(row.final_proposal_amount) || 0,
            retail_cost: parseFloat(row.retail_cost) || 0,
            discount_provided: parseFloat(row.discount_provided) || 0,
            matched: row.matched || false,
            created_date: row.created_date,
            branch_name: row.branch_name,
            salesperson_name: row.salesperson_name,
            customer_name: `${row.first_name || ''} ${row.last_name || ''}`.trim(),
            address: `${row.street || ''}, ${row.city || ''} ${row.state || ''} ${row.zip_code || ''}`.replace(/,\s*,/g, ',').trim(),
            raw_address: {
                street: row.street || '',
                city: row.city || '',
                state: row.state || '',
                zip_code: row.zip_code || ''
            }
        }));
        
    } finally {
        client.release();
    }
}

function normalizeLeadName(name) {
    return name
        .toLowerCase()
        .replace(/\s*-\s*[a-z0-9]+$/i, '')
        .replace(/[^\w\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeAddress(address) {
    return address
        .toLowerCase()
        .replace(/[^\w\s]/g, '')
        .replace(/\s+/g, ' ')
        .replace(/\b(street|st|avenue|ave|road|rd|drive|dr|lane|ln|boulevard|blvd|court|ct|place|pl)\b/g, '')
        .replace(/\b(apt|apartment|unit|ste|suite|#)\s*\w*\b/g, '')
        .trim();
}

function parseApiAddress(address) {
    const parts = address.split(', ');
    if (parts.length < 2) return { street: '', city: '', state: '', zip_code: '' };
    
    const street = parts[0] || '';
    const cityStateZip = parts[1] || '';
    
    const zipMatch = cityStateZip.match(/\b\d{5}(-\d{4})?\b$/);
    const zip_code = zipMatch ? zipMatch[0] : '';
    
    const cityState = cityStateZip.replace(/\b\d{5}(-\d{4})?\b$/, '').trim();
    const cityStateParts = cityState.split(' ');
    
    const state = cityStateParts.pop() || '';
    const city = cityStateParts.join(' ') || '';
    
    return { street, city, state, zip_code };
}

function addressesMatch(dbAddress, apiAddress) {
    const dbNormalized = normalizeAddress(dbAddress.street + ' ' + dbAddress.city);
    const apiParsed = parseApiAddress(apiAddress);
    const apiNormalized = normalizeAddress(apiParsed.street + ' ' + apiParsed.city);
    
    if (dbNormalized && apiNormalized && dbNormalized.length > 5 && apiNormalized.length > 5) {
        if (dbNormalized === apiNormalized) return true;
        if (dbNormalized.includes(apiNormalized) || apiNormalized.includes(dbNormalized)) return true;
        
        const dbStreetNum = dbAddress.street.match(/^\d+/);
        const apiStreetNum = apiParsed.street.match(/^\d+/);
        
        if (dbStreetNum && apiStreetNum && dbStreetNum[0] === apiStreetNum[0]) {
            const dbStreetName = normalizeAddress(dbAddress.street.replace(/^\d+\s*/, ''));
            const apiStreetName = normalizeAddress(apiParsed.street.replace(/^\d+\s*/, ''));
            
            if (dbStreetName && apiStreetName && 
                (dbStreetName.includes(apiStreetName) || apiStreetName.includes(dbStreetName))) {
                return true;
            }
        }
    }
    
    return false;
}

function findMatches(dbLeads, apiLeads) {
    const matches = [];
    const matchedDbIds = new Set();
    const matchedApiIds = new Set();
    
    console.log('🔍 Finding matches to update database records...');
    
    // Phase 1: Exact name and amount matches
    console.log('   📍 Phase 1: Exact name + amount matching...');
    for (const dbLead of dbLeads) {
        if (matchedDbIds.has(dbLead.db_id)) continue;
        
        const dbNameNormalized = normalizeLeadName(dbLead.name);
        
        for (const apiLead of apiLeads) {
            if (matchedApiIds.has(apiLead.api_id)) continue;
            
            const apiNameNormalized = normalizeLeadName(apiLead.name);
            
            if (dbNameNormalized === apiNameNormalized && 
                Math.abs(dbLead.final_proposal_amount - apiLead.final_price) < 0.01) {
                
                matches.push({
                    db_lead: dbLead,
                    api_lead: apiLead,
                    match_type: 'name_and_amount',
                    confidence: 'high'
                });
                
                matchedDbIds.add(dbLead.db_id);
                matchedApiIds.add(apiLead.api_id);
                break;
            }
        }
    }
    
    console.log(`      ✅ Found ${matches.length} exact matches`);
    
    // Phase 2: Name-only matches
    console.log('   📍 Phase 2: Name-only matching...');
    let nameOnlyMatches = 0;
    for (const dbLead of dbLeads) {
        if (matchedDbIds.has(dbLead.db_id)) continue;
        
        const dbNameNormalized = normalizeLeadName(dbLead.name);
        
        for (const apiLead of apiLeads) {
            if (matchedApiIds.has(apiLead.api_id)) continue;
            
            const apiNameNormalized = normalizeLeadName(apiLead.name);
            
            if (dbNameNormalized === apiNameNormalized) {
                matches.push({
                    db_lead: dbLead,
                    api_lead: apiLead,
                    match_type: 'name_only',
                    confidence: 'medium',
                    amount_diff: Math.abs(dbLead.final_proposal_amount - apiLead.final_price)
                });
                
                matchedDbIds.add(dbLead.db_id);
                matchedApiIds.add(apiLead.api_id);
                nameOnlyMatches++;
                break;
            }
        }
    }
    
    console.log(`      ✅ Found ${nameOnlyMatches} name-only matches`);
    
    // Phase 3: Address-based matching
    console.log('   📍 Phase 3: Address-based matching...');
    let addressMatches = 0;
    for (const dbLead of dbLeads) {
        if (matchedDbIds.has(dbLead.db_id)) continue;
        
        for (const apiLead of apiLeads) {
            if (matchedApiIds.has(apiLead.api_id)) continue;
            
            if (dbLead.branch_name === apiLead.branch_name && 
                addressesMatch(dbLead.raw_address, apiLead.address)) {
                
                matches.push({
                    db_lead: dbLead,
                    api_lead: apiLead,
                    match_type: 'address_only',
                    confidence: 'low',
                    name_diff: `"${dbLead.name}" vs "${apiLead.name}"`,
                    amount_diff: Math.abs(dbLead.final_proposal_amount - apiLead.final_price)
                });
                
                matchedDbIds.add(dbLead.db_id);
                matchedApiIds.add(apiLead.api_id);
                addressMatches++;
                break;
            }
        }
    }
    
    console.log(`      ✅ Found ${addressMatches} address-based matches`);
    console.log(`   🎯 Total matches found: ${matches.length}`);
    
    return matches;
}

async function updateMatchedLeads() {
    const client = await db.pool.connect();
    
    try {
        await client.query('BEGIN');
        console.log('🚀 Starting matched leads update process...\n');
        
        // Fetch existing lost leads from database
        const dbLeads = await getExistingLostLeads();
        
        // Fetch lost leads from API for all branches
        const allApiLeads = [];
        for (const branchId of API_BRANCH_IDS) {
            const branchLeads = await fetchLostLeadsFromAPI(branchId);
            allApiLeads.push(...branchLeads);
        }
        
        console.log('\n🔍 Finding matches between database and API leads...');
        
        // Find matches
        const matches = findMatches(dbLeads, allApiLeads);
        
        if (matches.length === 0) {
            console.log('\n⚠️  No matches found to update.');
            await client.query('ROLLBACK');
            return;
        }
        
        console.log(`\n📝 Updating ${matches.length} matched leads in database...`);
        
        let updatedCount = 0;
        let errorCount = 0;
        
        for (const match of matches) {
            try {
                const updateQuery = `
                    UPDATE leads_dashboard.lead 
                    SET 
                        final_proposal_amount = $1,
                        retail_cost = $2,
                        discount_provided = $3,
                        proposal_tm = $4,
                        matched = true
                    WHERE id = $5
                `;
                
                await client.query(updateQuery, [
                    match.api_lead.final_price,
                    match.api_lead.retail_cost,
                    match.api_lead.discount_provided,
                    match.api_lead.true_cost,
                    match.db_lead.db_id
                ]);
                
                updatedCount++;
                
                if (updatedCount % 50 === 0) {
                    console.log(`   ✅ Updated ${updatedCount}/${matches.length} leads...`);
                }
                
            } catch (error) {
                console.error(`   ❌ Error updating lead ID ${match.db_lead.db_id}:`, error.message);
                errorCount++;
            }
        }
        
        await client.query('COMMIT');
        
        console.log('\n🎉 Update completed successfully!');
        console.log(`📊 Summary:`);
        console.log(`   ✅ Successfully updated: ${updatedCount} leads`);
        console.log(`   ❌ Errors: ${errorCount} leads`);
        
        // Show breakdown by match type
        const exactMatches = matches.filter(m => m.match_type === 'name_and_amount').length;
        const nameMatches = matches.filter(m => m.match_type === 'name_only').length;
        const addressMatches = matches.filter(m => m.match_type === 'address_only').length;
        
        console.log(`\n📈 Match Type Breakdown:`);
        console.log(`   🎯 Exact matches (high confidence): ${exactMatches}`);
        console.log(`   📝 Name-only matches (medium confidence): ${nameMatches}`);
        console.log(`   🏠 Address-only matches (low confidence): ${addressMatches}`);
        
        // Show some examples of updates
        console.log(`\n💡 Sample Updates:`);
        matches.slice(0, 5).forEach((match, index) => {
            console.log(`   ${index + 1}. "${match.db_lead.name}" (${match.db_lead.branch_name})`);
            console.log(`      Old Amount: $${match.db_lead.final_proposal_amount}`);
            console.log(`      New Amount: $${match.api_lead.final_price}`);
            console.log(`      Retail Cost: $${match.api_lead.retail_cost}`);
            console.log(`      Discount: ${match.api_lead.discount_provided}%`);
            console.log(`      T&M (True Cost): $${match.api_lead.true_cost}`);
            console.log(`      Match Type: ${match.match_type}`);
        });
        
        return {
            updated: updatedCount,
            errors: errorCount,
            total_matches: matches.length,
            exact_matches: exactMatches,
            name_matches: nameMatches,
            address_matches: addressMatches
        };
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('💥 Update failed:', error);
        throw error;
    } finally {
        client.release();
    }
}

// Run the update
if (require.main === module) {
    updateMatchedLeads()
        .then((results) => {
            console.log('\n✨ Matched leads update completed!');
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n💥 Update failed:', error);
            process.exit(1);
        });
}

module.exports = { updateMatchedLeads }; 